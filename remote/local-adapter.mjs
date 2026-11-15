/**
 * The native client's method surface, carried by the local Host.
 *
 * `RemoteAdapter` owns the whole presentation contract: method dispatch, the
 * session projection, notification scoping and the mutation ledger. None of
 * that is Remote-server specific. The only part that is, is the carrier: the
 * frozen client reaches a Host over a Remote server (identity, devices, WebRTC),
 * while a Host this shell started answers the same Typert Remote surface on
 * loopback HTTP and `/api/remote.mux`.
 *
 * `LocalAdapter` therefore replaces the carrier and nothing else. The frozen
 * `RemoteTypertGateway` is reused unchanged over `LocalTransport`, because it
 * only needs the `rpc`/`onEvent`/`onClose`/`close` subset that the transport
 * implements.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { RemoteAdapter } from "./client.mjs";
import {
  connectLocalHost,
  LOCAL_ACCOUNT_SCOPE,
  LOCAL_HOST_ID,
  PLUGIN_MARKET_DETAIL_FILE_PATH,
  PLUGIN_MANAGER_DETAIL_FILE_PATH,
  SESSION_EXPORT_PATH,
} from "./local-transport.mjs";

/** The Host's session wire format; the local runtime is the same release. */
const LOCAL_SESSION_FORMAT = 3;

/** Media types the Host's detail-image routes answer with. */
const IMAGE_TYPES = ["image/*"];

/** The archive the Host's Session log export route streams. */
const ZIP_TYPES = ["application/zip"];

/** One failure in the stdio protocol's shape. */
function refuse(code, message, details = {}) {
  return Object.assign(new Error(message), {
    code,
    details,
    delivery: "rejected",
  });
}

function required(value, name) {
  if (typeof value !== "string" || value.trim() === "")
    throw refuse("INVALID_ARGUMENT", `本地导出缺少 ${name}。`);
  return value;
}

function runtimeVersion(runtimeRoot) {
  try {
    const descriptor = JSON.parse(
      readFileSync(join(runtimeRoot, "dsh", "desktop-runtime.json"), "utf8"),
    );
    return typeof descriptor?.release?.version === "string"
      ? descriptor.release.version
      : undefined;
  } catch {
    return undefined;
  }
}

export class LocalAdapter extends RemoteAdapter {
  /**
   * @param emit - notification sink in the stdio protocol's shape.
   * @param options.url - the Host's `ready` URL, including its launch token.
   * @param options.runtimeRoot - the vendored runtime root holding the official
   *   stream-protocol and `ws` builds.
   * @param options.fetchImpl - transport override for tests.
   * @param options.webSocketImpl - transport override for tests.
   */
  constructor(emit = () => {}, options = {}) {
    super(emit);
    this.local = {
      url: options.url,
      runtimeRoot: options.runtimeRoot,
      fetchImpl: options.fetchImpl,
      webSocketImpl: options.webSocketImpl,
      inject: options.inject,
    };
    this.version = runtimeVersion(options.runtimeRoot);
    this.transport = undefined;
    // Local mode has no account system: the owner Peer always answers.
    this.authenticated = true;
    this.identityScope = LOCAL_ACCOUNT_SCOPE;
    this.identity = { deviceId: LOCAL_HOST_ID };
    this.server = {
      baseUrl: options.url ? new URL(options.url).origin : "local://host",
      close() {},
      async hasStoredAuthorization() {
        return true;
      },
    };
    // `RemoteAdapter.connect` only asks the connector for a carrier.
    this.connector = { connect: () => this.connectLocalHost() };
    /** Completed resource downloads, keyed by caller requestId. */
    this.downloads = new Map();
  }

  /**
   * The local carrier reaches the Host's own routes, so an endpoint the frozen
   * Remote allowlist refuses is still served here — but only when the entry
   * declares that its Host route exists (`localAllowed`). Remote mode keeps
   * every refusal: it never uses this class.
   */
  carrierRefusal(operation) {
    return operation.localAllowed === true ? undefined : operation.blockedReason;
  }

  /** The local Host serves the two raw resources the frozen Remote cannot. */
  resourceRefusal() {
    return undefined;
  }

  /** The Host's own `export` command is complete here: no archive relay needed. */
  commandRefusal() {
    return undefined;
  }

  /** What no carrier can offer, minus the two the local Host serves itself. */
  unsupportedOperations() {
    return super
      .unsupportedOperations()
      .filter(
        (name) =>
          name !== "rawSessionLogDownload" && name !== "workspaceFileSearch",
      );
  }

  /** Configuration is the Host's own; nothing to configure or persist. */
  ensureConfigured() {}

  async configure() {
    return { ...this.status(), storageDirectory: "" };
  }

  async authStatus() {
    return { ...this.status(), authorized: true };
  }

  async authProviders() {
    return [];
  }

  /** One synthetic device: the Host this shell started. */
  async devices() {
    this.authenticated = true;
    return [
      {
        id: LOCAL_HOST_ID,
        name: this.deviceName(),
        online: true,
        platform: process.platform,
      },
    ];
  }

  deviceName() {
    return this.version ? `本地 Host · dsh ${this.version}` : "本地 Host";
  }

  /** Open the local carrier, shaped like the frozen connector's result. */
  async connectLocalHost() {
    if (this.transport !== undefined) await this.transport.close();
    const transport = await connectLocalHost({
      url: this.local.url,
      runtimeRoot: this.local.runtimeRoot,
      fetchImpl: this.local.fetchImpl,
      webSocketImpl: this.local.webSocketImpl,
      inject: this.local.inject,
    });
    this.transport = transport;
    return {
      client: transport,
      features: { remoteGateway: true, sessionFormat: LOCAL_SESSION_FORMAT },
      harnessVersion: this.version,
      target: {
        hostId: LOCAL_HOST_ID,
        name: this.deviceName(),
        origin: transport.origin,
      },
    };
  }

  async connect(hostId) {
    if (hostId !== undefined && hostId !== LOCAL_HOST_ID)
      throw Object.assign(new Error("本地模式只有一个 Host。"), {
        code: "HOST_NOT_FOUND",
        delivery: "rejected",
      });
    return super.connect(LOCAL_HOST_ID, {});
  }

  status() {
    const status = super.status();
    return {
      ...status,
      backend: "local-mux",
      protocol: "dsh-host@local",
      serverUrl: this.local.url ? new URL(this.local.url).origin : "local://host",
      deviceName: this.deviceName(),
      runtimeVersion: this.version ?? "",
    };
  }

  /**
   * Write the Session's complete log ZIP to a temporary file and return it.
   *
   * The Host answers `GET /api/session.export?sessionId=…[&includeDescendants=
   * true]` with `application/zip`, so the archive is streamed to disk inside
   * the helper rather than through the stdio JSON framing: the bytes can exceed
   * both the request cap and the response scan. The caller owns the file and
   * deletes it after saving or copying it.
   *
   * @param params.sessionId - Session whose log is exported.
   * @param params.includeDescendants - include child Session logs too.
   * @param params.requestId - optional caller identity; a repeat returns the
   *   same file instead of downloading it twice.
   * @returns `{status:"completed", path, bytes, name}`.
   */
  async exportSessionZip(p = {}) {
    const sessionId = required(p.sessionId, "sessionId");
    const includeDescendants = p.includeDescendants === true;
    return this.downloadResource({
      kind: "exportSessionZip",
      fingerprint: ["session.export", sessionId, includeDescendants],
      requestId: p.requestId,
      signal: this.lifetime.signal,
      download: (transport, signal) =>
        transport.downloadFile({
          apiPath: SESSION_EXPORT_PATH,
          query: {
            sessionId,
            ...(includeDescendants ? { includeDescendants: "true" } : {}),
          },
          fallbackName: `${sessionId}.zip`,
          accept: ZIP_TYPES,
          signal,
        }),
    });
  }

  /**
   * Write one detail image — beside a bundle's document or beside a market
   * entry's long description — to a temporary file.
   *
   * The two routes differ only in their query: `/api/plugin-manager/detail-file`
   * names the bundle and the npm file CDNs to ask for an offered version, the
   * market route names the document id `pluginMarket/readEntryDetail` returned.
   *
   * @param params.source - `pluginManager` (default) or `pluginMarket`.
   * @param params.bundle - bundle package name (pluginManager only).
   * @param params.document - document path or market document id.
   * @param params.path - image path relative to that document.
   * @param params.sources - optional npm file CDNs to ask first.
   * @returns `{status:"completed", path, bytes, name, mediaType}`.
   */
  async readDetailImage(p = {}) {
    const source = p.source === "pluginMarket" ? "pluginMarket" : "pluginManager";
    const document = required(p.document, "document");
    const imagePath = required(p.path, "path");
    const bundle =
      source === "pluginManager" ? required(p.bundle, "bundle") : undefined;
    if (p.sources !== undefined && !Array.isArray(p.sources))
      throw refuse("INVALID_ARGUMENT", "sources必须是CDN名称数组。");
    return this.downloadResource({
      kind: "detailImage",
      fingerprint: [source, bundle, document, imagePath, p.sources ?? []],
      requestId: p.requestId,
      signal: this.lifetime.signal,
      download: (transport, signal) =>
        transport.downloadFile({
          apiPath:
            source === "pluginMarket"
              ? PLUGIN_MARKET_DETAIL_FILE_PATH
              : PLUGIN_MANAGER_DETAIL_FILE_PATH,
          query:
            source === "pluginMarket"
              ? { document, path: imagePath }
              : {
                  bundle,
                  document,
                  path: imagePath,
                  ...(Array.isArray(p.sources) && p.sources.length > 0
                    ? { sources: p.sources.join(",") }
                    : {}),
                },
          fallbackName: "detail-image",
          accept: IMAGE_TYPES,
          signal,
        }),
    });
  }

  /**
   * One deduplicated resource download: a repeat `requestId` returns the file
   * already on disk, a different payload under the same id is refused.
   */
  async downloadResource({ kind, fingerprint, requestId, signal, download }) {
    const client = this.connected?.client;
    if (!client || typeof client.downloadFile !== "function")
      throw refuse("NOT_CONNECTED", "尚未连接本地 Host。");
    const key = requestId === undefined ? undefined : required(requestId, "requestId");
    if (key !== undefined && key.length < 16)
      throw refuse("INVALID_REQUEST_ID", "requestId 至少需要 16 个字符。");
    const digest = createHash("sha256")
      .update(JSON.stringify([this.hostId, kind, fingerprint]))
      .digest("hex");
    if (key !== undefined) {
      const prior = this.downloads.get(key);
      if (prior !== undefined) {
        if (prior.fingerprint !== digest)
          throw refuse("REQUEST_ID_CONFLICT", "相同requestId不能用于不同请求。");
        return prior.promise;
      }
      if (this.downloads.size >= 32)
        throw refuse(
          "RECEIPT_LIMIT",
          "下载回执已达上限，请先清理已落盘的文件。",
        );
    }
    const hostId = this.hostId,
      generation = this.connectionGeneration;
    const entry = {
      fingerprint: digest,
      promise: Promise.resolve()
        .then(async () => {
          const file = await download(client, signal);
          if (
            this.connected?.client !== client ||
            generation !== this.connectionGeneration
          )
            throw refuse("STALE_CONNECTION", "连接已经切换，已下载的文件作废。");
          return {
            status: "completed",
            path: file.path,
            bytes: file.bytes,
            name: file.name,
            ...(file.mediaType === undefined
              ? {}
              : { mediaType: file.mediaType }),
            hostId,
            connectionGeneration: generation,
            ...(key === undefined ? {} : { requestId: key }),
          };
        })
        .catch((error) => {
          // A refused download produced no usable file; let a retry through.
          if (key !== undefined) this.downloads.delete(key);
          throw error;
        }),
    };
    if (key !== undefined) this.downloads.set(key, entry);
    return entry.promise;
  }

  async close() {
    await super.close();
    const transport = this.transport;
    this.transport = undefined;
    if (transport !== undefined) await transport.close().catch(() => {});
  }
}
