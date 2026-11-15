import { preferenceIdentityScope } from "./auth-scope.mjs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  ClientConnection,
  ClientServerApi,
  IdentityStore,
  ServerCredentialStore,
  RemoteTypertGateway,
  resolveConfig,
  loadNodeRtcFactory,
  uploadRemoteFile,
} from "./dist/upstream.mjs";
import { SessionProjection } from "./projection.mjs";
import { PresentationPublisher } from "./updates.mjs";
import { OPERATIONS, operationArgs } from "./operations.mjs";
import { promptContent } from "./prompt-content.mjs";
import { MAX_REQUEST_BYTES } from "./framing.mjs";
import { collectSessionMarkdown } from "./session-markdown.mjs";
const fail = (code, message) => {
  throw Object.assign(new Error(message), { code, delivery: "rejected" });
};
const logger = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * Shape one local Host upload like the frozen uploader's accepted result, so a
 * caller reads the same `status`/`name`/`bytes` on either carrier. The Host's
 * staged receipt rides along: a later prompt cites that, not a path.
 */
function localUploadResult(upload) {
  return {
    status: "accepted",
    name: upload.file.name,
    bytes: upload.file.bytes,
    receiptId: upload.receiptId,
    file: upload.file,
  };
}

const PAGE_INVALIDATIONS = new Set([
  "schedule/changed",
  "settings/document-updated",
  "credentials/record-updated",
  "credentials/reference-updated",
  "llm/adapters-updated",
]);
export class RemoteAdapter {
  constructor(emit = () => {}) {
    this.emit = (method, params, scope = this.notificationScope()) =>
      emit(method, params, scope);
    this.publisher = new PresentationPublisher((method, params) =>
      this.emit(
        method,
        params,
        this.publicationScope ?? this.notificationScope(),
      ),
    );
    this.lifetime = new AbortController();
    this.pending = new Map();
    this.streams = new Map();
    this.streamContexts = new Map();
    this.sessionCache = new Map();
    this.sessionCacheLimit = 3;
    this.owners = new Map();
    this.terminalInputs = new Map();
    this.ledger = new Map();
    this.sessionRows = [];
    this.runningBySession = new Map();
    this.workspaceRows = [];
    this.closed = false;
    this.authenticated = false;
    this.connectionGeneration = 0;
    this.selectionGeneration = 0;
    this.controlSelection = {
      sessionId: undefined,
      baseline: undefined,
      changes: new Map(),
    };
  }
  notificationScope() {
    return Object.freeze({
      hostId: this.hostId ?? "",
      generation: this.connectionGeneration,
      accountScope: this.identityScope ?? "",
    });
  }
  isNotificationScope(scope) {
    return (
      scope.hostId === (this.hostId ?? "") &&
      scope.generation === this.connectionGeneration &&
      scope.accountScope === (this.identityScope ?? "")
    );
  }
  publish(scope, callback) {
    const previous = this.publicationScope;
    this.publicationScope = scope;
    try {
      return callback();
    } finally {
      this.publicationScope = previous;
    }
  }
  status() {
    return {
      connected:
        !!this.connected &&
        (this.readOnly === true || this.interactionReady === true),
      readOnly: this.readOnly === true,
      transportConnected: !!this.connected,
      authorized: this.authenticated,
      identityScope: this.identityScope ?? "",
      accountScope: this.identityScope ?? "",
      identityReady: !!this.identity,
      serverUrl: this.server?.baseUrl ?? "https://dsh.rkbkosp.cn",
      hostId: this.hostId ?? "",
      transport: this.connected?.client.getStats().mode ?? "Disconnected",
      detail: this.detail ?? "请先配置连接并登录",
      backend: "remote-only",
      protocol: "ds-harness-remote@0.6.4",
      connectionGeneration: this.connectionGeneration,
      transportLimits: {
        maxRequestBytes: MAX_REQUEST_BYTES,
        inlineImages: true,
        stagedFileAttachments: false,
      },
    };
  }
  notifyStatus(detail) {
    if (detail) this.detail = detail;
    this.emit("status", this.status());
  }
  async configure(p = {}) {
    await this.disconnect();
    this.server?.close();
    this.authenticated = false;
    this.identityScope = undefined;
    this.projection = undefined;
    this.clearSessionCache();
    this.sessionRows = [];
    this.workspaceRows = [];
    this.workspaceId = undefined;
    this.hostId = undefined;
    this.emit("sessions", []);
    this.emit("snapshot", this.snapshot());
    const serverUrl = p.serverUrl || "https://dsh.rkbkosp.cn";
    this.config = resolveConfig({
      role: "client",
      serverUrl,
      deviceName: p.deviceName || "Native DSH",
      hostControl: { enabled: false },
      forceRelay: p.forceRelay === true,
      codex: { enabled: false },
      cursor: { enabled: false },
      acp: { enabled: false },
    });
    const root = resolve(
      p.storageDirectory ||
        join(
          homedir(),
          "Library",
          "Application Support",
          "Native DSH",
          "remote",
        ),
    );
    const frozen = resolve(homedir(), ".dsh");
    if (root === frozen || root.startsWith(frozen + sep))
      fail(
        "FROZEN_STORAGE",
        "Client identity must use its own directory, outside ~/.dsh.",
      );
    const directory = join(
      root,
      createHash("sha256")
        .update(this.config.serverUrl)
        .digest("hex")
        .slice(0, 24),
    );
    this.identities = new IdentityStore({ directory, role: "client" });
    this.identity = await this.identities.loadOrCreate(this.config.deviceName);
    this.credentials = new ServerCredentialStore(directory);
    this.server = new ClientServerApi(this.config.serverUrl, this.credentials);
    this.server.bindIdentity(this.identity);
    const owner = this;
    this.connectionContext = {
      config: this.config,
      identities: this.identities,
      server: this.server,
      logger,
      requireIdentity: () => this.identity,
      rtcFactoryProvider: loadNodeRtcFactory,
      connectionProgressRun: 0,
      get connectionProgress() {
        return owner.progress;
      },
      set connectionProgress(value) {
        owner.progress = value;
        if (value)
          owner.notifyStatus(
            `连接中：${value.phase}${value.activeTransports ? " / " + value.activeTransports.join(", ") : ""}`,
          );
      },
    };
    this.connector = new ClientConnection(this.connectionContext);
    this.authenticated = await this.server.hasStoredAuthorization();
    await this.refreshIdentityScope();
    this.notifyStatus(
      this.authenticated ? "已保存登录，连接时验证" : "尚未授权，请登录",
    );
    return { ...this.status(), storageDirectory: directory };
  }
  async refreshIdentityScope() {
    const stored =
      this.credentials && this.identity
        ? await this.credentials.load(
            this.server.baseUrl,
            this.identity.deviceId,
          )
        : undefined;
    const nextScope = preferenceIdentityScope(
      this.server?.baseUrl,
      stored,
      this.identity?.deviceId,
    );
    if (nextScope !== this.identityScope) {
      // Retire the previous authorization carrier before publishing another principal.
      // disconnect emits the old account at its own generation; the new identity
      // must have a strictly later epoch in both notifications and RPC replies.
      if (this.connected) await this.disconnect();
      this.connectionGeneration++;
      this.selectionGeneration++;
      this.identityScope = nextScope;
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = undefined;
      this.projection = undefined;
      this.clearSessionCache();
      this.sessionRows = [];
      this.catalogRows = [];
      this.workspaceRows = [];
      this.workspaceId = undefined;
      this.hostId = undefined;
      this.runningBySession.clear();
      this.publisher.replace(this.snapshot());
    }
    return this.identityScope;
  }
  ensureConfigured() {
    if (!this.server) fail("NOT_CONFIGURED", "请先配置 Remote 服务地址。");
  }
  gatewayRequired() {
    if (!this.gateway) fail("NOT_CONNECTED", "尚未连接远程主机。");
    return this.gateway;
  }
  async request(method, p = {}) {
    if (p.clientScope && !["closeStream", "closeOwnerStreams"].includes(method))
      this.validateScope(p);
    if (this.closed && method !== "status") fail("CLOSED", "客户端已关闭。");
    if (OPERATIONS[method]) return this.runOperation(method, p);
    switch (method) {
      case "uploadWorkspaceFile":
        return this.uploadWorkspaceFile(p);
      case "registerOwner": {
        this.validateScope(p);
        this.gatewayRequired();
        const ownerId = requireString(p.ownerId, "ownerId");
        if (this.owners.size >= 16 && !this.owners.has(ownerId))
          fail("OWNER_LIMIT", "兼容窗口数量已达上限。");
        const binding = {
          hostId: this.hostId,
          generation: this.connectionGeneration,
          sessionId: p.clientScope?.sessionId,
        };
        const previous = this.owners.get(ownerId);
        if (
          previous &&
          (previous.hostId !== binding.hostId ||
            previous.generation !== binding.generation ||
            previous.sessionId !== binding.sessionId)
        )
          fail("STALE_CONTEXT", "窗口身份已被使用。");
        if (!previous)
          this.owners.set(ownerId, {
            ...binding,
            abort: new AbortController(),
          });
        return { registered: true, ownerId };
      }
      case "closeOwnerStreams":
        return this.closeOwnerStreams(p.ownerId);
      case "closeStream": {
        const context = this.streamContexts.get(p.subscriptionId);
        if (
          p.clientScope?.ownerId &&
          context &&
          context.ownerId !== p.clientScope.ownerId
        )
          fail("PERMISSION_DENIED", "不能关闭其他窗口的订阅。");
        this.closeStream(p.subscriptionId);
        return { closed: true };
      }
      case "runtimeStats":
        return {
          owners: this.owners.size,
          streams: this.streams.size,
          terminalInputAttachments: this.terminalInputs.size,
          durableReceipts: this.ledger.size,
        };
      case "presentation":
        return this.snapshot();
      case "capabilities":
        return this.capabilities(p);
      case "exportLoadedHistory":
        return this.exportLoadedHistory();
      case "exportSessionMarkdown":
        return this.exportSessionMarkdown(p);
      case "status":
        return this.status();
      case "configure":
        return this.configure(p);
      case "authStatus":
        this.ensureConfigured();
        await this.refreshIdentityScope();
        return {
          ...this.status(),
          authorized: await this.server.hasStoredAuthorization(),
        };
      case "authProviders":
        this.ensureConfigured();
        return (await this.server.oauthProviders()).map((x) => ({
          id: x.id,
          displayName: x.displayName,
          qrAvailable: !!x.qrStartUrl,
          devicePairing: !!x.devicePairing,
        }));
      case "login":
        this.ensureConfigured();
        await this.disconnect();
        this.identityScope = undefined;
        this.authenticated = false;
        this.projection = undefined;
        this.clearSessionCache();
        this.sessionRows = [];
        this.workspaceRows = [];
        this.workspaceId = undefined;
        this.hostId = undefined;
        this.emit("sessions", []);
        this.emit("snapshot", this.snapshot());
        await this.server.authorizeWithAccount(
          this.identity,
          requireString(p.email, "email"),
          requireString(p.password, "password"),
        );
        this.authenticated = true;
        await this.refreshIdentityScope();
        this.notifyStatus("已授权，请选择主机");
        return { ...this.status(), authorized: true };
      case "startQr":
        this.ensureConfigured();
        return this.server.startOAuthQrLogin(
          requireString(p.provider, "provider"),
        );
      case "pollQr": {
        this.ensureConfigured();
        const value = await this.server.pollOAuthQrLogin(
          this.identity,
          requireString(p.qrId, "qrId"),
        );
        if (value.status === "complete") {
          this.authenticated = true;
          await this.refreshIdentityScope();
          this.notifyStatus("已授权，请选择主机");
        }
        return {
          ...(value.status === "complete" ? this.status() : {}),
          status: value.status,
        };
      }
      case "devices":
        return this.devices();
      case "connect":
        return this.connect(requireString(p.hostId ?? p.deviceId, "hostId"), {
          readOnly: p.readOnly === true,
        });
      case "workspaces":
        return this.workspaces();
      case "selectWorkspace": {
        const id = requireString(p.workspaceId ?? p.id, "workspaceId");
        if (!this.workspaceRows.some((w) => w.workspaceId === id))
          fail("WORKSPACE_NOT_FOUND", "请选择现有远程工作区。");
        this.workspaceId = id;
        return this.sessions();
      }
      case "sessions":
        return this.sessions({ all: p.all === true });
      case "clearSession":
        return this.clearSession();
      case "openSession":
        return this.openSession(
          requireString(p.sessionId ?? p.id, "sessionId"),
        );
      case "history":
        return this.history(p);
      case "sendMessage":
        return this.sendMessage(p);
      case "cancel":
        return this.cancel(p);
      case "answerApproval":
        return this.answer(p, "approval");
      case "answerQuestions":
        return this.answer(p, "questions");
      case "disconnect":
        await this.disconnect();
        return this.status();
      case "close":
        await this.close();
        return { closed: true };
      default:
        fail("METHOD_NOT_FOUND", `未知客户端方法：${method}`);
    }
  }
  async devices() {
    this.ensureConfigured();
    const rows = await this.server.listDevices(this.lifetime.signal);
    this.authenticated = true;
    return Promise.all(
      rows.map(async (d) => ({
        id: d.deviceId,
        name: d.name,
        online: (
          await this.server
            .presenceFor(d.deviceId, this.lifetime.signal)
            .catch(() => ({ online: false }))
        ).online,
        platform: d.platform,
      })),
    );
  }
  async connect(hostId, { recover = false, readOnly = false } = {}) {
    this.ensureConfigured();
    if (!recover) this.reconnectStop?.abort();
    if (!recover) await this.disconnect();
    if (hostId !== this.hostId) {
      this.projection = undefined;
      this.sessionRows = [];
      this.workspaceRows = [];
      this.catalogRows = [];
      this.workspaceId = undefined;
      this.emit("snapshot", this.snapshot());
      this.emit("sessions", []);
    }
    this.readOnly = readOnly;
    this.runningBySession.clear();
    const generation = ++this.connectionGeneration;
    const remote = await this.connector.connect(hostId, this.lifetime.signal);
    if (generation !== this.connectionGeneration || this.closed) {
      await remote.client.close();
      fail("CANCELLED", "连接已被替换。");
    }
    if (!remote.features.remoteGateway || remote.features.sessionFormat !== 3) {
      await remote.client.close();
      fail(
        "HOST_INCOMPATIBLE",
        "此原型需要已安装的 Typert Remote / Session V3 能力。",
      );
    }
    this.connected = remote;
    this.interactionReady = false;
    this.gateway = new RemoteTypertGateway(
      remote.client,
      undefined,
      remote.harnessVersion,
      false,
    );
    this.hostId = hostId;
    const connectionScope = this.notificationScope();
    this.authenticated = true;
    remote.client.onClose(() => {
      if (this.connected !== remote) return;
      this.connected = undefined;
      this.interactionReady = false;
      this.gateway = undefined;
      this.eventsStop?.abort();
      this.controlStop?.abort();
      this.followStop?.abort();
      this.clearSessionCache();
      this.abandonPending();
      this.notifyStatus("连接已断开，正在恢复");
      if (!this.closed) void this.reconnect(hostId);
    });
    this.notifyStatus(
      readOnly ? "已建立只读连接" : "传输已连接，正在接管审批事件",
    );
    if (!readOnly) {
      const eventsStop = new AbortController();
      this.eventsStop = eventsStop;
      const ready = Promise.withResolvers();
      void this.consumeEvents(eventsStop.signal, ready).catch((error) => {
        ready.reject(error);
        if (this.eventsStop === eventsStop && !eventsStop.signal.aborted) {
          this.interactionReady = false;
          this.emit("error", {
            code: error.code ?? "EVENT_STREAM_FAILED",
            message: "审批事件流不可用，已暂停发送并重新连接。",
          });
          this.notifyStatus("审批事件流不可用");
          void remote.client.close();
        }
      });
      const cancelled = () =>
        ready.reject(
          Object.assign(new Error("连接已被取消。"), { code: "CANCELLED" }),
        );
      eventsStop.signal.addEventListener("abort", cancelled, { once: true });
      try {
        await ready.promise;
      } finally {
        eventsStop.signal.removeEventListener("abort", cancelled);
      }
      if (!this.isNotificationScope(connectionScope))
        fail("CANCELLED", "连接已被替换。");
      this.interactionReady = true;
    }
    if (!this.isNotificationScope(connectionScope))
      fail("CANCELLED", "连接已被替换。");
    this.notifyStatus(
      `${readOnly ? "只读连接" : "已连接"} ${remote.target.name}`,
    );
    await this.workspaces();
    if (!this.isNotificationScope(connectionScope))
      fail("CANCELLED", "连接已被替换。");
    await this.sessions();
    if (!this.isNotificationScope(connectionScope))
      fail("CANCELLED", "连接已被替换。");
    if (!readOnly) {
      const stop = new AbortController();
      this.controlStop = stop;
      void this.consumeControl(stop, generation).catch((error) => {
        if (!stop.signal.aborted)
          this.emit("projectionStatus", {
            live: false,
            code: error.code ?? "PROJECTION_STREAM_FAILED",
          });
      });
    }
    if (recover && this.projection)
      await this.openSession(this.projection.sessionId);
    return this.status();
  }
  async reconnect(hostId) {
    const stop = new AbortController();
    this.reconnectStop = stop;
    for (let attempt = 0; attempt < 5 && !stop.signal.aborted; attempt++) {
      try {
        await delay(Math.min(30000, 4000 * 2 ** attempt), undefined, {
          signal: stop.signal,
        });
        if (stop.signal.aborted) return;
        await this.connect(hostId, {
          recover: true,
          readOnly: this.readOnly === true,
        });
        return;
      } catch (error) {
        if (stop.signal.aborted) return;
        if (
          [
            "AUTH_INVALID",
            "DEVICE_REVOKED",
            "ACCOUNT_AUTH_REQUIRED",
            "AUTH_REQUIRED",
          ].includes(error.code)
        ) {
          this.authenticated = false;
          this.notifyStatus("远程授权失效，请重新登录");
          return;
        }
      }
    }
    if (!stop.signal.aborted) this.notifyStatus("恢复连接未成功，请手动重连");
  }
  async first(endpoint, args) {
    const stop = new AbortController();
    try {
      const source = await this.gatewayRequired().open(
        endpoint,
        { args },
        AbortSignal.any([this.lifetime.signal, stop.signal]),
      );
      for await (const frame of source) return frame;
      fail("STREAM_CLOSED", "远程流在快照前关闭。");
    } finally {
      stop.abort();
    }
  }
  async workspaces() {
    const generation = this.connectionGeneration;
    const scope = this.notificationScope();
    const frame = await this.first("workspace/follow", {});
    if (frame?.type !== "baseline" || !Array.isArray(frame.value?.items))
      fail("INVALID_SNAPSHOT", "远程工作区快照无效。");
    if (
      generation !== this.connectionGeneration ||
      !this.isNotificationScope(scope)
    )
      fail("CANCELLED", "远程主机已切换。");
    this.workspaceRows = frame.value.items;
    this.workspaceBaseline = frame.value;
    return this.workspaceRows.map((w) => ({
      ...w,
      id: w.workspaceId,
      name: w.title || w.path,
      path: w.path,
      sessionIds: w.sessionIds ?? [],
    }));
  }
  async sessions({ all = false } = {}) {
    const scope = this.notificationScope();
    const generation = this.connectionGeneration;
    const requestVersion = (this.catalogRequest ?? 0) + 1;
    this.catalogRequest = requestVersion;
    const value = await this.gatewayRequired().invoke({
      namespace: "session",
      method: "list",
      args: { _request: {} },
      signal: this.lifetime.signal,
    });
    if (
      !this.isNotificationScope(scope) ||
      generation !== this.connectionGeneration ||
      requestVersion !== this.catalogRequest
    )
      fail("CANCELLED", "远程会话目录请求已被替换。");
    this.catalogRows = value.items ?? [];
    const workspace = this.workspaceRows.find(
      (w) => w.workspaceId === this.workspaceId,
    );
    const ids = workspace ? new Set(workspace.sessionIds ?? []) : undefined;
    this.sessionRows = (value.items ?? [])
      .filter((s) => !s.parentSessionId && s.origin !== "subagent")
      .map((s) => ({
        ...s,
        id: s.sessionId,
        projections: s.projections,
        archived: (this.workspaceBaseline?.archivedSessionIds ?? []).includes(
          s.sessionId,
        ),
        pinned: (this.workspaceBaseline?.pinnedSessionIds ?? []).includes(
          s.sessionId,
        ),
        preset: s.projections?.values?.["agentPreset"],
        model: s.projections?.values?.["modelSelection"],
        title: s.title ?? s.projections?.values?.title ?? "新会话",
        running: this.runningBySession.get(s.sessionId) ?? !!s.running,
        workspaceId:
          this.workspaceRows.find((w) =>
            (w.sessionIds ?? []).includes(s.sessionId),
          )?.workspaceId ?? "",
        updatedAt: s.updatedAt,
      }));
    for (const row of this.sessionRows)
      if (!this.runningBySession.has(row.id))
        this.runningBySession.set(row.id, row.running);
    this.emit("sessions", this.sessionRows, scope);
    return all || !ids
      ? this.sessionRows
      : this.sessionRows.filter((s) => ids.has(s.id));
  }
  async clearSession() {
    this.controlSelection = {
      sessionId: undefined,
      baseline: undefined,
      changes: new Map(),
    };
    ++this.selectionGeneration;
    this.followStop?.abort();
    this.followStop = undefined;
    this.clearSessionCache();
    this.projection = undefined;
    await this.releasePending();
    if (!this.projection) {
      const empty = this.snapshot();
      this.publisher.replace(empty);
      this.emit("snapshot", empty);
    }
    return { cleared: true };
  }
  // Recently followed Sessions keep their follow stream and projection. The
  // Host has no resume cursor for session/follow, so dropping a projection made
  // every return visit replay a fresh history window; keeping a bounded set of
  // passive follows turns a return visit into a local re-publish.
  cacheSession(projection, stop) {
    if (!projection || !stop || stop.signal.aborted) return;
    this.sessionCache.delete(projection.sessionId);
    this.sessionCache.set(projection.sessionId, { projection, stop });
    this.pruneSessionCache();
  }
  pruneSessionCache() {
    for (const [sessionId, entry] of [...this.sessionCache]) {
      if (this.sessionCache.size <= this.sessionCacheLimit) return;
      if (entry.projection === this.projection) continue;
      this.sessionCache.delete(sessionId);
      entry.stop.abort();
    }
  }
  // Most recently used entry, or undefined when it was evicted or its stream
  // already closed.
  cachedSession(sessionId) {
    const entry = this.sessionCache.get(sessionId);
    if (!entry) return undefined;
    if (entry.stop.signal.aborted) {
      this.sessionCache.delete(sessionId);
      return undefined;
    }
    this.sessionCache.delete(sessionId);
    this.sessionCache.set(sessionId, entry);
    return entry;
  }
  forgetSession(sessionId, stop) {
    const entry = this.sessionCache.get(sessionId);
    if (!entry || (stop && entry.stop !== stop)) return;
    this.sessionCache.delete(sessionId);
  }
  clearSessionCache() {
    for (const entry of this.sessionCache.values()) entry.stop.abort();
    this.sessionCache.clear();
  }
  async openSession(sessionId) {
    const selection = ++this.selectionGeneration;
    if (!this.sessionRows.some((s) => s.id === sessionId))
      fail("SESSION_NOT_FOUND", "会话不在当前已加载的远程目录中。");
    const scope = this.notificationScope();
    const followed = this.projection,
      followedStop = this.followStop;
    const followedLive =
      !!followed && !!followedStop && !followedStop.signal.aborted;
    if (followedLive && followed.sessionId === sessionId) {
      // Re-selecting the followed Session is not a switch: restarting its
      // stream would replay the baseline and drop held interactions.
      this.controlSelection = {
        sessionId,
        baseline: undefined,
        changes: new Map(),
      };
      const value = this.snapshot();
      this.publish(scope, () => this.publisher.replace(value));
      this.emit("snapshot", value, scope);
      return value;
    }
    if (followedLive) this.cacheSession(followed, followedStop);
    this.followStop = undefined;
    this.controlSelection = {
      sessionId,
      baseline: undefined,
      changes: new Map(),
    };
    this.projection = undefined;
    const cached = this.cachedSession(sessionId);
    if (cached) {
      this.projection = cached.projection;
      this.followStop = cached.stop;
      this.projection.running =
        this.runningBySession.get(sessionId) ?? this.projection.running;
      await this.releasePending();
      if (selection !== this.selectionGeneration)
        fail("CANCELLED", "会话选择已被替换。");
      const value = this.snapshot();
      this.publish(scope, () => this.publisher.replace(value));
      this.emit("snapshot", value, scope);
      return value;
    }
    await this.releasePending();
    if (selection !== this.selectionGeneration)
      fail("CANCELLED", "会话选择已被替换。");
    const stop = new AbortController();
    this.followStop = stop;
    const projection = new SessionProjection(sessionId);
    this.projection = projection;
    projection.running =
      this.sessionRows.find((s) => s.id === sessionId)?.running ?? false;
    const ready = Promise.withResolvers();
    const onAbort = () =>
      ready.reject(
        Object.assign(new Error("会话打开已取消。"), { code: "CANCELLED" }),
      );
    stop.signal.addEventListener("abort", onAbort, { once: true });
    void this.consumeSession(projection, stop, ready).catch((error) => {
      ready.reject(error);
      this.forgetSession(sessionId, stop);
      if (!stop.signal.aborted && this.projection === projection)
        this.emit("error", {
          code: error.code ?? "SESSION_STREAM_FAILED",
          message: "会话流已中断，请重新打开。",
        });
    });
    return ready.promise.finally(() =>
      stop.signal.removeEventListener("abort", onAbort),
    );
  }
  async consumeControl(stop, generation) {
    const scope = this.notificationScope();
    const signal = AbortSignal.any([stop.signal, this.lifetime.signal]),
      gateway = this.gatewayRequired();
    const source = await gateway.open("session/control", { args: {} }, signal);
    for await (const frame of source) {
      if (
        signal.aborted ||
        generation !== this.connectionGeneration ||
        !this.isNotificationScope(scope)
      )
        return;
      const target =
        this.controlSelection.sessionId ?? this.projection?.sessionId;
      if (!target) continue;
      if (frame.type === "baseline") {
        const baseline = frame.value?.projections?.[target];
        if (baseline) {
          this.controlSelection.baseline = baseline;
          if (this.projection?.sessionId === target)
            this.projection.applyProjectionBaseline(baseline);
        }
      }
      if (frame.type === "projection" && frame.sessionId === target) {
        for (const change of frame.changes)
          this.controlSelection.changes.set(change.key, {
            seq: frame.seq,
            val: change.val,
          });
        if (this.projection?.sessionId === target)
          this.projection.applyProjectionUpdate(frame);
      }
      this.scheduleSnapshot();
    }
  }
  async consumeSession(projection, stop, ready) {
    const scope = this.notificationScope();
    const gateway = this.gatewayRequired();
    let opened = false;
    let baselinePublished = false;
    for (let repair = 0; repair < 3 && !stop.signal.aborted; repair++) {
      const attempt = new AbortController();
      const signal = AbortSignal.any([
        stop.signal,
        this.lifetime.signal,
        attempt.signal,
      ]);
      try {
        const stream = await gateway.open(
          "session/follow",
          {
            args: {
              request: {
                address: { kind: "session", sessionId: projection.sessionId },
                maxMessages: 80,
                assistantStream: true,
              },
            },
          },
          signal,
        );
        for await (const frame of stream) {
          if (signal.aborted || !this.isNotificationScope(scope)) return;
          // A cached follow keeps applying in the background so a return visit
          // is current; only the followed Session may publish.
          const active = this.projection === projection;
          if (frame.type === "snapshot") {
            projection.snapshot(frame);
            if (this.controlSelection.sessionId === projection.sessionId) {
              projection.applyProjectionBaseline(
                this.controlSelection.baseline,
              );
              for (const [key, change] of [
                ...this.controlSelection.changes,
              ].sort((a, b) => a[1].seq - b[1].seq))
                projection.applyProjectionUpdate({
                  seq: change.seq,
                  changes: [{ key, val: change.val }],
                });
            }
            projection.running =
              this.runningBySession.get(projection.sessionId) ??
              projection.running;
            opened = true;
            let value;
            if (active) {
              value = this.snapshot();
              this.publish(scope, () => this.publisher.replace(value));
              // Announce every new baseline on the notification conveyor before
              // its deltas or the duplicate RPC completion can reach the UI.
              this.emit("snapshot", value, scope);
            }
            if (!baselinePublished) {
              baselinePublished = true;
              this.cacheSession(projection, stop);
              ready.resolve(active ? value : projection.value());
            }
          } else if (!opened)
            fail("INVALID_SNAPSHOT", "会话增量出现在快照之前。");
          else if (frame.type === "assistant-stream")
            projection.frame(frame.frame);
          else if (frame.type === "event" || frame.type === "chunks")
            projection.event(frame.event);
          if (active) this.scheduleSnapshot();
        }
        if (!signal.aborted) fail("STREAM_CLOSED", "会话流已关闭。");
        return;
      } catch (error) {
        if (signal.aborted) return;
        if (error.code !== "REBASELINE_REQUIRED") throw error;
        opened = false;
      } finally {
        attempt.abort();
      }
    }
    if (!stop.signal.aborted)
      fail("REBASELINE_REQUIRED", "会话流多次不连续，请重新连接。");
  }
  snapshot() {
    if (!this.projection) return { sessionId: "", messages: [], pending: [] };
    this.projection.pending = [...this.pending.values()].map(
      ({ wire, abort, ...view }) => view,
    );
    return this.projection.value();
  }
  scheduleSnapshot() {
    const scope = this.notificationScope();
    const projection = this.projection;
    if (this.snapshotTimer) {
      if (
        this.isNotificationScope(this.snapshotTimerScope) &&
        this.snapshotTimerProjection === projection
      )
        return;
      clearTimeout(this.snapshotTimer);
    }
    this.snapshotTimerScope = scope;
    this.snapshotTimerProjection = projection;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = undefined;
      if (!this.isNotificationScope(scope) || projection !== this.projection)
        return;
      this.publish(scope, () => {
        if (
          !this.projection ||
          this.publisher.sessionId !== this.projection.sessionId
        )
          this.publisher.flush(this.snapshot());
        else {
          this.projection.pending = [...this.pending.values()].map(
            ({ wire, abort, ...view }) => view,
          );
          this.publisher.patch(this.projection.pullUpdates());
        }
      });
    }, 16);
  }
  async history(p) {
    const scope = this.notificationScope();
    const projection = this.projection;
    if (!projection) fail("NO_SESSION", "请先打开会话。");
    const first = [...projection.messages.values()]
      .filter((x) => Number.isSafeInteger(x.seq))
      .sort((a, b) => a.seq - b.seq)
      .at(0);
    const value = await this.gatewayRequired().invoke({
      namespace: "session",
      method: "page",
      args: {
        request: {
          address: { kind: "session", sessionId: projection.sessionId },
          throughSeq: p.throughSeq ?? projection.cursor,
          beforeSeq: p.beforeSeq ?? first?.seq,
          maxMessages: 80,
        },
      },
      signal: this.lifetime.signal,
    });
    if (!this.isNotificationScope(scope) || this.projection !== projection)
      fail("STALE_CONTEXT", "会话已经切换，已丢弃过期历史。");
    projection.mergeHistory(value.records ?? []);
    projection.hasMore = !!value.hasMore;
    const snapshot = this.snapshot();
    this.publish(scope, () => this.publisher.replace(snapshot));
    this.emit("snapshot", snapshot, scope);
    return snapshot;
  }
  async mutate(endpoint, request, operationId) {
    return this.mutateArgs(endpoint, { request }, operationId);
  }
  async mutateArgs(endpoint, args, operationId, scope) {
    const captured = {
      hostId: this.hostId,
      generation: this.connectionGeneration,
      gateway: this.gatewayRequired(),
      signal: scope?.ownerId
        ? AbortSignal.any([
            this.lifetime.signal,
            this.owners.get(scope.ownerId).abort.signal,
          ])
        : this.lifetime.signal,
      ownerId: scope?.ownerId,
      ownerTicket: this.owners.get(scope?.ownerId),
    };
    const key = requireString(operationId, "requestId");
    if (key.length < 16)
      fail("INVALID_REQUEST_ID", "requestId 至少需要 16 个字符。");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([captured.hostId, endpoint, args]))
      .digest("hex");
    const existing = this.ledger.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        fail("REQUEST_ID_CONFLICT", "相同 requestId 不能用于不同请求。");
      return existing.promise;
    }
    if (this.ledger.size >= 512)
      fail(
        "RECEIPT_LIMIT",
        "请求回执已达上限，请重新启动客户端并先核对远程状态。",
      );
    if (this.readOnly) fail("READ_ONLY", "当前是只读连接，不能执行此操作。");
    const gateway = captured.gateway;
    const entry = { fingerprint, promise: undefined };
    this.ledger.set(key, entry);
    entry.promise = Promise.resolve().then(() => {
      this.assertCaptured(captured);
      let response;
      try {
        response = gateway.dispatch(endpoint, { args }, captured.signal);
      } catch {
        return {
          status: "unknown",
          requestId: key,
          detail: "响应未确认；请先核对远程状态。",
        };
      }
      return Promise.resolve(response).then(
        (result) => {
          if (
            !result.ok &&
            endpoint === "session/fork" &&
            result.error.code === "session/workspace-attach-failed" &&
            !(
              typeof result.error.details?.sessionId === "string" &&
              result.error.details.sessionId.length > 0
            )
          )
            return {
              status: "unknown",
              requestId: key,
              hostId: captured.hostId,
              connectionGeneration: captured.generation,
              detail:
                "Host报告创建后归组失败但未给出子会话标识；请核对状态，不要重试。",
              error: { code: result.error.code },
            };
          if (
            !result.ok &&
            endpoint === "session/fork" &&
            result.error.code === "session/workspace-attach-failed" &&
            typeof result.error.details?.sessionId === "string" &&
            result.error.details.sessionId.length > 0
          )
            return {
              status: "partial",
              requestId: key,
              hostId: captured.hostId,
              connectionGeneration: captured.generation,
              value: {
                sessionId: result.error.details.sessionId,
                ...(typeof result.error.details.workspaceId === "string"
                  ? { workspaceId: result.error.details.workspaceId }
                  : {}),
              },
              error: {
                code: result.error.code,
                message:
                  "会话已创建，但未能加入工作区；请刷新核对，不要再次分叉。",
              },
            };
          if (!result.ok)
            throw Object.assign(new Error(result.error.message), {
              code: result.error.code,
              delivery: "rejected",
            });
          return {
            status: "accepted",
            requestId: key,
            value: result.value,
            hostId: captured.hostId,
            connectionGeneration: captured.generation,
          };
        },
        () => ({
          status: "unknown",
          requestId: key,
          detail: "响应未确认；请核对远程状态，不要以新requestId自动重试。",
        }),
      );
    });
    return entry.promise;
  }
  validateScope(p) {
    const scope = p.clientScope;
    if (!scope) return;
    if (scope.ownerId) {
      const owner = this.owners.get(scope.ownerId);
      if (
        !owner ||
        owner.hostId !== scope.hostId ||
        owner.generation !== scope.generation ||
        owner.sessionId !== scope.sessionId
      )
        fail("STALE_CONTEXT", "兼容窗口已经关闭或切换。");
    }
    if (
      scope.hostId !== this.hostId ||
      !Number.isSafeInteger(scope.generation) ||
      scope.generation !== this.connectionGeneration ||
      (scope.sessionId !== undefined &&
        scope.sessionId !== this.projection?.sessionId)
    )
      fail("STALE_CONTEXT", "页面绑定的主机或会话已经切换，请重新打开。");
  }
  assertCaptured(
    { hostId, generation, gateway, ownerId, ownerTicket },
    message = "请求尚未发送，远程连接已经切换。",
  ) {
    if (
      this.hostId !== hostId ||
      this.connectionGeneration !== generation ||
      this.gateway !== gateway ||
      (ownerId &&
        (!this.owners.has(ownerId) || this.owners.get(ownerId) !== ownerTicket))
    )
      fail("STALE_CONTEXT", message);
  }
  async runOperation(method, p) {
    this.validateScope(p);
    const operation = OPERATIONS[method],
      args = (() => {
        try {
          return operationArgs(method, p);
        } catch (error) {
          error.delivery = "rejected";
          throw error;
        }
      })();
    if (operation.blockedReason)
      fail("FROZEN_REMOTE_INCOMPATIBLE", operation.blockedReason);
    if (operation.feature && !this.connected?.features?.[operation.feature])
      fail("FEATURE_NOT_SUPPORTED", "Host未提供此功能。");
    if (operation.mode === "write" && this.readOnly)
      fail("READ_ONLY", "当前是只读连接，不能执行此操作。");
    if (operation.mode === "write" && !this.interactionReady)
      fail(
        "INTERACTIONS_UNAVAILABLE",
        "审批事件通道尚未就绪，不能执行写操作。",
      );
    if (method === "writeTerminal" || method === "resizeTerminal")
      return this.terminalInput(method, p, args);
    if (operation.mode === "write")
      return this.mutateArgs(
        operation.endpoint,
        args,
        requireString(p.requestId ?? p.operationId, "requestId"),
        p.clientScope,
      );
    if (operation.stream) return this.openOperation(method, p, args);
    const [namespace, name] = operation.endpoint.split("/");
    const bound = {
      clientScope: p.clientScope ? { ...p.clientScope } : undefined,
    };
    const owner = this.owners.get(bound.clientScope?.ownerId);
    const captured = {
      hostId: this.hostId,
      generation: this.connectionGeneration,
      gateway: this.gatewayRequired(),
      ownerId: bound.clientScope?.ownerId,
      ownerTicket: owner,
    };
    const signal = owner
      ? AbortSignal.any([this.lifetime.signal, owner.abort.signal])
      : this.lifetime.signal;
    const validate = () => {
      this.assertCaptured(
        captured,
        "读取结果对应的主机或窗口已经关闭，结果已丢弃。",
      );
      this.validateScope(bound);
    };
    let value;
    try {
      value = await captured.gateway.invoke({
        namespace,
        method: name,
        args,
        signal,
      });
    } catch (error) {
      validate();
      throw error;
    }
    validate();
    if (method === "readFileBytes")
      return {
        ...value,
        data: undefined,
        dataBase64: Buffer.from(value.data).toString("base64"),
      };
    if (method === "listCommands")
      return value.map((command) => ({
        ...command,
        ...(command.name === "export"
          ? { clientUnavailableReason: "Remote缺少原始日志下载资源" }
          : {}),
      }));
    return value;
  }
  closeStream(subscriptionId) {
    const context = this.streamContexts.get(subscriptionId);
    this.streams.get(subscriptionId)?.abort();
    this.streams.delete(subscriptionId);
    this.streamContexts.delete(subscriptionId);
    if (context?.inputKey) this.terminalInputs.delete(context.inputKey);
  }
  closeOwnerStreams(ownerId) {
    for (const [id, context] of this.streamContexts)
      if (context.ownerId === ownerId) this.closeStream(id);
    this.owners.get(ownerId)?.abort.abort();
    this.owners.delete(ownerId);
    for (const [key, state] of this.terminalInputs)
      if (state.ownerId === ownerId) this.terminalInputs.delete(key);
    return { closed: true, ownerId };
  }
  inputKey(p) {
    return JSON.stringify([
      p.clientScope?.ownerId,
      this.hostId,
      this.connectionGeneration,
      p.sessionId,
      p.terminalId,
      p.attachmentId,
    ]);
  }
  openOperation(method, p, args) {
    const scope = this.notificationScope();
    const gateway = this.gatewayRequired(),
      ownerId = p.clientScope?.ownerId;
    if (!ownerId || !this.owners.has(ownerId))
      fail("OWNER_REQUIRED", "订阅必须绑定已登记的窗口。");
    if (this.streams.size >= 16)
      fail("STREAM_LIMIT", "请先关闭不再使用的面板。");
    const subscriptionId = randomUUID(),
      stop = new AbortController(),
      generation = this.connectionGeneration;
    this.streams.set(subscriptionId, stop);
    this.streamContexts.set(subscriptionId, {
      ownerId,
      ...(method === "watchTerminal" ? { inputKey: this.inputKey(p) } : {}),
    });
    const signal = AbortSignal.any([
      stop.signal,
      this.lifetime.signal,
      this.owners.get(ownerId).abort.signal,
    ]);
    setImmediate(async () => {
      try {
        if (signal.aborted) return;
        const source = await gateway.open(
          OPERATIONS[method].endpoint,
          { args },
          signal,
        );
        for await (const frame of source) {
          if (
            signal.aborted ||
            generation !== this.connectionGeneration ||
            !this.isNotificationScope(scope) ||
            !this.owners.has(ownerId)
          )
            break;
          this.emit(
            "remoteStream",
            {
              subscriptionId,
              ownerId,
              method,
              sessionId: p.sessionId ?? p.request?.sessionId,
              frame,
            },
            scope,
          );
        }
        if (!signal.aborted && generation === this.connectionGeneration)
          this.emit(
            "remoteStreamEnd",
            { subscriptionId, ownerId, method },
            scope,
          );
      } catch (error) {
        if (!signal.aborted && generation === this.connectionGeneration)
          this.emit(
            "remoteStreamEnd",
            {
              subscriptionId,
              ownerId,
              method,
              error: { code: error.code ?? "STREAM_FAILED" },
            },
            scope,
          );
      } finally {
        if (this.streams.get(subscriptionId) === stop)
          this.closeStream(subscriptionId);
      }
    });
    return { subscriptionId, ownerId };
  }
  terminalInput(method, p, args) {
    if (this.readOnly) fail("READ_ONLY", "当前是只读连接，不能提交终端输入。");
    const key = this.inputKey(p),
      sequence = p.inputSequence,
      requestId = requireString(p.requestId, "requestId");
    if (!Number.isSafeInteger(sequence) || sequence < 1)
      fail("INVALID_INPUT_SEQUENCE", "终端输入必须携带原帧序号。");
    if (
      ![...this.streamContexts.values()].some(
        (context) => context.inputKey === key,
      )
    )
      fail("TERMINAL_DETACHED", "终端连接已经关闭，请重新连接。");
    let state = this.terminalInputs.get(key);
    if (!state) {
      state = {
        next: 1,
        recent: new Map(),
        pending: false,
        broken: false,
        ownerId: p.clientScope.ownerId,
      };
      this.terminalInputs.set(key, state);
    }
    const fingerprint = JSON.stringify([method, args, requestId]),
      prior = state.recent.get(sequence);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        fail("REQUEST_ID_CONFLICT", "相同输入序号不能改变内容。");
      return prior.promise;
    }
    if (state.broken)
      fail(
        "TERMINAL_INPUT_UNKNOWN",
        "终端输入回执未确认，必须重新连接且不能重放输入。",
      );
    if (sequence < state.next)
      fail("INPUT_RECEIPT_RETIRED", "旧输入回执已退休，禁止重放。");
    if (sequence !== state.next || state.pending)
      fail("INPUT_SEQUENCE_GAP", "终端输入必须有序等待确认。");
    const captured = {
      hostId: this.hostId,
      generation: this.connectionGeneration,
      gateway: this.gatewayRequired(),
      signal: AbortSignal.any([
        this.lifetime.signal,
        this.owners.get(p.clientScope.ownerId).abort.signal,
      ]),
      ownerId: p.clientScope.ownerId,
      ownerTicket: this.owners.get(p.clientScope.ownerId),
    };
    const entry = { fingerprint, promise: undefined };
    state.pending = true;
    state.recent.set(sequence, entry);
    entry.promise = Promise.resolve()
      .then(() => {
        this.assertCaptured(captured);
        if (
          ![...this.streamContexts.values()].some(
            (context) => context.inputKey === key,
          )
        )
          fail("TERMINAL_DETACHED", "终端已经断开。");
        return captured.gateway.dispatch(
          OPERATIONS[method].endpoint,
          { args },
          captured.signal,
        );
      })
      .then(
        (result) => {
          if (!result.ok)
            throw Object.assign(new Error(result.error.message), {
              code: result.error.code,
              delivery: "rejected",
            });
          state.next = sequence + 1;
          while (state.recent.size > 32)
            state.recent.delete(state.recent.keys().next().value);
          return {
            status: "accepted",
            requestId,
            value: result.value,
            inputSequence: sequence,
            hostId: captured.hostId,
            connectionGeneration: captured.generation,
          };
        },
        (error) => {
          if (error.delivery === "rejected") throw error;
          state.broken = true;
          return {
            status: "unknown",
            requestId,
            inputSequence: sequence,
            hostId: captured.hostId,
            connectionGeneration: captured.generation,
          };
        },
      )
      .finally(() => {
        state.pending = false;
      });
    return entry.promise;
  }
  async uploadWorkspaceFile(p) {
    this.validateScope(p);
    if (this.readOnly) fail("READ_ONLY", "当前是只读连接。");
    if (!this.interactionReady)
      fail("INTERACTIONS_UNAVAILABLE", "审批事件通道尚未就绪。");
    const client = this.connected?.client;
    if (!client) fail("NOT_CONNECTED", "尚未连接远程主机。");
    const sessionId = requireString(p.sessionId, "sessionId"),
      localPath = requireString(p.localPath, "localPath"),
      name = requireString(p.name, "name"),
      key = requireString(p.requestId, "requestId");
    if (key.length < 16) fail("INVALID_REQUEST_ID", "requestId至少16字符。");
    if (!this.sessionRows.some((row) => row.id === sessionId))
      fail("SESSION_NOT_FOUND", "会话不在远程目录中。");
    const fingerprint = createHash("sha256")
        .update(
          JSON.stringify([
            this.hostId,
            "workspace.upload",
            sessionId,
            localPath,
            name,
          ]),
        )
        .digest("hex"),
      prior = this.ledger.get(key);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        fail("REQUEST_ID_CONFLICT", "相同requestId不能用于不同请求。");
      return prior.promise;
    }
    if (this.ledger.size >= 512) fail("RECEIPT_LIMIT", "回执数已达上限。");
    const generation = this.connectionGeneration,
      hostId = this.hostId;
    const entry = {
      fingerprint,
      promise: Promise.resolve().then(async () => {
        const metadata = await client.rpc(
          "harness.transport.describe",
          {},
          this.lifetime.signal,
        );
        if (!metadata.capabilities?.includes("workspace.upload.v1"))
          fail("FEATURE_NOT_SUPPORTED", "Host未提供工作区文件上传。");
        const assertCurrent = () => {
          if (
            this.connected?.client !== client ||
            generation !== this.connectionGeneration
          )
            fail("STALE_CONNECTION", "连接已经切换。");
        };
        // The local carrier streams the bytes over the Host's own raw upload
        // route; a Remote server keeps the frozen chunked uploader unchanged.
        let value;
        try {
          value =
            typeof client.uploadFile === "function"
              ? localUploadResult(
                  await client.uploadFile({
                    sessionId,
                    path: localPath,
                    name,
                    signal: this.lifetime.signal,
                    onProgress: assertCurrent,
                  }),
                )
              : await uploadRemoteFile(
                  client,
                  sessionId,
                  localPath,
                  name,
                  this.lifetime.signal,
                  assertCurrent,
                );
        } catch (error) {
          // A Host refusal observed by the carrier proves nothing was staged,
          // so the caller may retry it; anything else stays uncertain.
          if (error?.rejected === true) error.delivery = "rejected";
          throw error;
        }
        return {
          ...value,
          requestId: key,
          hostId,
          connectionGeneration: generation,
          semantics: "workspace-file-path-reference",
          composerAttachment: false,
        };
      }),
    };
    this.ledger.set(key, entry);
    return entry.promise;
  }
  async capabilities(p = {}) {
    this.validateScope(p);
    const captured = {
        hostId: this.hostId,
        generation: this.connectionGeneration,
        gateway: this.gatewayRequired(),
      },
      client = this.connected?.client;
    const access = await this.first("remoteAccess/follow", {});
    this.assertCaptured(captured);
    const metadata = await client.rpc(
      "harness.transport.describe",
      {},
      this.lifetime.signal,
    );
    this.assertCaptured(captured);
    const operations = {
      uploadWorkspaceFile:
        metadata.capabilities?.includes("workspace.upload.v1") &&
        !this.readOnly &&
        this.interactionReady === true,
    };
    const details = {};
    for (const [method, operation] of Object.entries(OPERATIONS)) {
      const granted =
        access.owner === true ||
        (access.grants ?? []).some(
          (grant) =>
            grant.actions.includes(operation.endpoint) &&
            (grant.resource.kind === "global" ||
              grant.resource.id === p.sessionId ||
              grant.resource.id === p.workspaceId),
        );
      const available =
        !!this.connected &&
        !operation.blockedReason &&
        granted &&
        (!operation.feature ||
          this.connected.features?.[operation.feature] === true) &&
        (operation.mode !== "write" ||
          (!this.readOnly && this.interactionReady === true));
      operations[method] = available;
      details[method] = {
        endpoint: operation.endpoint,
        mode: operation.mode,
        available,
        source: "frozen-Remote-allowlist+Host-access-snapshot",
        ...(!available
          ? {
              reason:
                operation.blockedReason ??
                (!granted
                  ? "Host未授权"
                  : this.readOnly && operation.mode === "write"
                    ? "只读连接"
                    : operation.feature
                      ? "Host能力未提供"
                      : "连接尚未就绪"),
            }
          : {}),
      };
    }
    operations.exportSessionMarkdown =
      operations.readSessionEvents === true &&
      metadata.capabilities?.includes("remote.history.compact.v1") === true;
    details.exportSessionMarkdown = {
      endpoint: "session/events",
      mode: "read",
      available: operations.exportSessionMarkdown,
      source: "original-formatter+fixed-cut-full-history",
      ...(!operations.exportSessionMarkdown
        ? { reason: "Host未授权完整事件读取或未提供未压缩历史协商" }
        : {}),
    };
    return {
      operations,
      details,
      hostId: this.hostId,
      readOnly: this.readOnly === true,
      owner: access.owner === true,
      unsupported: [
        "sessionDelete",
        "markRead",
        "markUnread",
        "installPlugin",
        "uninstallPlugin",
        "arbitraryPluginPage",
        "rawSessionLogDownload",
        "workspaceFileWrite",
        "workspaceFileDelete",
        "workspaceFileRename",
        "workspaceFileSearch",
      ],
    };
  }
  async exportSessionMarkdown(p) {
    this.validateScope(p);
    const sessionId = requireString(p.sessionId, "sessionId");
    const scope = p.clientScope ? { ...p.clientScope } : undefined;
    const owner = this.owners.get(scope?.ownerId);
    if (!owner || scope.sessionId !== sessionId)
      fail("OWNER_REQUIRED", "完整Markdown读取必须绑定当前会话的临时窗口。");
    const captured = {
      hostId: this.hostId,
      generation: this.connectionGeneration,
      gateway: this.gatewayRequired(),
      ownerId: scope.ownerId,
      ownerTicket: owner,
    };
    const client = this.connected?.client;
    if (!client) fail("NOT_CONNECTED", "尚未连接远程主机。");
    const signal = AbortSignal.any([this.lifetime.signal, owner.abort.signal]);
    return collectSessionMarkdown({
      sessionId,
      gateway: captured.gateway,
      client,
      signal,
      assertCurrent: () => {
        this.assertCaptured(
          captured,
          "读取对应的主机或窗口已经关闭，Markdown结果已丢弃。",
        );
        this.validateScope({ clientScope: scope });
      },
    });
  }
  exportLoadedHistory() {
    if (!this.projection) fail("NO_SESSION", "请先打开会话。");
    return {
      label: "已加载的Remote会话片段",
      complete: false,
      hasMore: this.projection.hasMore,
      remoteMayCompactToolContent: true,
      sessionId: this.projection.sessionId,
      records: this.projection.trajectoryOrder.map((seq) =>
        this.projection.events.get(seq),
      ),
      markdown: this.projection
        .value()
        .messages.map((message) => "## " + message.kind + "\n\n" + message.text)
        .join("\n\n"),
    };
  }
  async sendMessage(p) {
    if (!this.interactionReady)
      fail(
        "INTERACTIONS_UNAVAILABLE",
        "审批事件通道尚未就绪，不能提交新消息。",
      );
    const sessionId = requireString(
      p.sessionId ?? this.projection?.sessionId,
      "sessionId",
    );
    if (!this.sessionRows.some((s) => s.id === sessionId))
      fail("SESSION_NOT_FOUND", "会话不在当前远程目录中。");
    const content = promptContent(p, this.projection, sessionId);
    const requestId = requireString(p.requestId, "requestId");
    const mode = p.mode ?? "queue";
    if (mode !== "queue" && mode !== "steer")
      fail("INVALID_MODE", "mode必须是queue或steer。");
    return this.mutate(
      "session/prompt",
      {
        sessionId,
        requestId,
        mode,
        content,
      },
      requestId,
    );
  }
  async cancel(p) {
    const sessionId = requireString(
      p.sessionId ?? this.projection?.sessionId,
      "sessionId",
    );
    if (!this.sessionRows.some((s) => s.id === sessionId))
      fail("SESSION_NOT_FOUND", "会话不在当前远程目录中。");
    return this.mutate(
      "session/cancel",
      { sessionId },
      requireString(p.requestId, "requestId"),
    );
  }
  async consumeEvents(signal, ready) {
    const scope = this.notificationScope();
    const gateway = this.gatewayRequired();
    const hostId = this.hostId,
      connectionGeneration = this.connectionGeneration;
    const stream = await gateway.open(
      "$events",
      { args: {} },
      AbortSignal.any([signal, this.lifetime.signal]),
    );
    let clientId;
    for await (const frame of stream) {
      if (signal.aborted || !this.isNotificationScope(scope)) return;
      if (frame.type === "ready") {
        clientId = frame.clientId;
        ready.resolve();
        continue;
      }
      if (!clientId) fail("INVALID_EVENTS", "事件流缺少 ready。");
      if (frame.type === "cancel") {
        this.pending.get(frame.eventId)?.abort.abort();
        this.pending.delete(frame.eventId);
        this.scheduleSnapshot();
        continue;
      }
      if (frame.type === "emit" && frame.event === "api-session/status") {
        const [id, running] = frame.args ?? [];
        this.runningBySession.set(id, !!running);
        for (const row of this.sessionRows)
          if (row.id === id) row.running = !!running;
        if (this.projection?.sessionId === id) {
          this.projection.running = !!running;
          this.scheduleSnapshot();
        }
        this.emit("sessions", this.sessionRows, scope);
        continue;
      }
      if (frame.type === "emit" && PAGE_INVALIDATIONS.has(frame.event)) {
        this.emit(
          "remoteInvalidation",
          {
            event: frame.event,
            hostId,
            connectionGeneration,
          },
          scope,
        );
        continue;
      }
      if (frame.type !== "waterfall") continue;
      const known =
        frame.event === "approval/request"
          ? "approval"
          : frame.event === "user-questions/request"
            ? "questions"
            : undefined;
      if (!known) {
        await gateway.dispatch(
          "$events/result",
          {
            args: {
              clientId,
              eventId: frame.eventId,
              outcome: { kind: "next" },
            },
          },
          signal,
        );
        continue;
      }
      const request = frame.request ?? {};
      if (!this.ownsSession(frame.agentId)) {
        await gateway.dispatch(
          "$events/result",
          {
            args: {
              clientId,
              eventId: frame.eventId,
              outcome: { kind: "next" },
            },
          },
          signal,
        );
        continue;
      }
      this.pending.set(frame.eventId, {
        id: frame.eventId,
        sessionId: frame.agentId,
        kind: known,
        title:
          known === "approval"
            ? (request.toolName ?? "工具执行审批")
            : "需要你的回答",
        reason: request.reason ?? "",
        questions: request.questions,
        abort: new AbortController(),
        wire: { clientId, eventId: frame.eventId },
      });
      this.scheduleSnapshot();
    }
    if (!signal.aborted) fail("EVENT_STREAM_CLOSED", "审批事件流已关闭。");
  }
  async answer(p, kind) {
    if (!this.interactionReady)
      fail("INTERACTIONS_UNAVAILABLE", "审批事件通道尚未就绪。");
    const id = requireString(p.requestId, "requestId");
    const pending = this.pending.get(id);
    if (!pending || pending.kind !== kind)
      fail("INTERACTION_EXPIRED", "该交互已取消、断开或不再有效。");
    const value =
      kind === "approval"
        ? validateApproval(p.outcome)
        : {
            answers:
              p.cancelled === true
                ? []
                : validateAnswers(p.answers, pending.questions),
          };
    const outcome =
      kind === "questions" && p.cancelled === true
        ? {
            kind: "rejected",
            error: {
              name: "Error",
              message: "the user cancelled ask_user_question",
              code: "ASK_CANCELLED",
            },
          }
        : { kind: "result", value };
    const result = await this.gatewayRequired().dispatch(
      "$events/result",
      { args: { ...pending.wire, outcome } },
      AbortSignal.any([this.lifetime.signal, pending.abort.signal]),
    );
    if (!result.ok)
      throw Object.assign(new Error(result.error.message), {
        code: result.error.code,
      });
    if (this.pending.get(id) === pending) this.pending.delete(id);
    this.scheduleSnapshot();
    return { answered: true };
  }
  ownsSession(sessionId) {
    const current = this.projection?.sessionId;
    if (!current || !this.interactionReady) return false;
    const visited = new Set();
    let id = sessionId;
    while (id && !visited.has(id)) {
      if (id === current) return true;
      visited.add(id);
      id = (this.catalogRows ?? []).find(
        (row) => row.sessionId === id,
      )?.parentSessionId;
    }
    return false;
  }
  async releasePending() {
    const gateway = this.gateway;
    const pending = [...this.pending.values()];
    this.pending.clear();
    if (gateway && !this.lifetime.signal.aborted)
      await Promise.allSettled(
        pending.map((row) =>
          gateway.dispatch(
            "$events/result",
            { args: { ...row.wire, outcome: { kind: "next" } } },
            AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(1500)]),
          ),
        ),
      );
    for (const row of pending) row.abort?.abort();
    this.scheduleSnapshot();
  }
  abandonPending() {
    for (const pending of this.pending.values()) pending.abort?.abort();
    this.pending.clear();
    this.scheduleSnapshot();
  }
  async disconnect() {
    this.connectionGeneration++;
    this.selectionGeneration++;
    this.followStop?.abort();
    this.controlStop?.abort();
    for (const stop of this.streams.values()) stop.abort();
    this.streams.clear();
    this.streamContexts.clear();
    for (const owner of this.owners.values()) owner.abort.abort();
    this.owners.clear();
    this.terminalInputs.clear();
    this.interactionReady = false;
    this.reconnectStop?.abort();
    await this.releasePending();
    this.eventsStop?.abort();
    this.followStop?.abort();
    this.clearSessionCache();
    const remote = this.connected;
    this.connected = undefined;
    this.gateway = undefined;
    this.abandonPending();
    await remote?.client.close().catch(() => {});
    this.notifyStatus("未连接远程主机");
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.lifetime.abort();
    await this.disconnect();
    this.server?.close();
    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = undefined;
  }
}
function requireString(value, name) {
  if (typeof value !== "string" || !value.trim())
    fail("INVALID_ARGUMENT", `缺少 ${name}`);
  return value;
}
function validateApproval(outcome) {
  if (!["allowed-once", "rejected", "cancelled"].includes(outcome))
    fail("INVALID_APPROVAL", "审批结果无效。");
  return outcome;
}
function validateAnswers(answers, questions) {
  if (
    !Array.isArray(answers) ||
    !Array.isArray(questions) ||
    answers.length !== questions.length
  )
    fail("INVALID_ANSWERS", "每个问题必须回答一次。");
  const seen = new Set();
  for (const a of answers) {
    const q = questions.find((q) => q.id === a.id);
    if (
      typeof a.id !== "string" ||
      seen.has(a.id) ||
      !q ||
      !Array.isArray(a.selected)
    )
      fail("INVALID_ANSWERS", "问题回答格式无效。");
    const labels = new Set((q.options ?? []).map((o) => o.label));
    if (
      new Set(a.selected).size !== a.selected.length ||
      a.selected.some((label) => !labels.has(label)) ||
      (!q.multiSelect && a.selected.length > 1) ||
      (!q.multiSelect && a.selected.length && a.custom?.trim())
    )
      fail("INVALID_ANSWERS", "问题选项或单选数量无效。");
    if (a.custom !== undefined && typeof a.custom !== "string")
      fail("INVALID_ANSWERS", "自定义回答必须是文本。");
    if (q.intent?.kind === "approval" && a.custom?.trim())
      fail("INVALID_ANSWERS", "审批问题只接受声明的选项。");
    if (!a.selected.length && !a.custom?.trim())
      fail("INVALID_ANSWERS", "请回答每个问题。");
    seen.add(a.id);
  }
  return answers;
}
