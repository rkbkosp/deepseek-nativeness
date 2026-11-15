/**
 * Local carrier to the Host this shell started.
 *
 * The frozen Remote client reaches a Host through a Remote server: identity,
 * credentials, device selection, WebRTC, and a `harness.remote.*` control
 * channel. When the Host runs in this process tree none of that exists, but the
 * Host still serves the very same Typert Remote surface over the routes the
 * browser client uses:
 *
 *   GET  /connect?token=…&interactions=answer  → 302 + authority-bound Cookie
 *   POST /api/<endpoint>                       → {type:"server-response", rpcId, result}
 *   WS   /api/remote.mux                       → logical stream frames
 *   POST /api/session/uploadFileBinary         → {ok:true,value} for raw file bytes
 *
 * This module implements exactly those routes as a drop-in replacement for the
 * frozen `RemoteClientCore` that `RemoteTypertGateway` consumes, so the
 * projection, notification and method layers stay one implementation.
 *
 * The last one is not a Typert method at all: the Host's file-upload service
 * registers it as an exact Fetch route on the same `/api` channel, which is why
 * the Remote-only `workspace.upload.*` chunker is unnecessary here — the bytes
 * travel once, streamed, instead of base64-chunked through JSON.
 *
 * Wire framing is not re-invented here: the Host's own
 * `@deepseek-ai/dsh-api-gateway/stream-protocol` parser and path constants are
 * loaded from the vendored runtime, and `ws` comes from the same tree.
 */

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

/** Stable Host id the local device advertises. */
export const LOCAL_HOST_ID = "local";

/** One stable identity/account scope: local mode has no accounts. */
export const LOCAL_ACCOUNT_SCOPE = "local";

/** Capabilities this carrier was verified to provide, and only those. */
const LOCAL_CAPABILITIES = ["workspace.upload.v1"];

/** Exact raw-byte upload route the Host's file-upload service registers. */
export const FILE_UPLOAD_PATH = "/api/session/uploadFileBinary";

/**
 * Session log ZIP route (a plain GET on the same `/api` channel): the Host
 * streams `application/zip` with `content-disposition` naming the archive.
 */
export const SESSION_EXPORT_PATH = "/api/session.export";

/** Bundle-relative detail image route (`{bundle,document,path,sources}`). */
export const PLUGIN_MANAGER_DETAIL_FILE_PATH =
  "/api/plugin-manager/detail-file";

/** Market-entry detail image route (`{document,path}`). */
export const PLUGIN_MARKET_DETAIL_FILE_PATH = "/api/plugin-market/detail-file";

/** Read granularity for one upload; also the progress cadence. */
const UPLOAD_CHUNK_BYTES = 64 * 1024;

/** Temp roots holding one downloaded resource each; the caller deletes them. */
const DOWNLOAD_DIRECTORY_PREFIX = "native-dsh-download-";

const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/;
const CONNECT_PATH = "/connect";

/** Reloadable slice of the runtime's official packages. */
export async function loadRuntimeProtocol(runtimeRoot) {
  if (!runtimeRoot) throw new Error("local: --runtime is required");
  const dsh = join(runtimeRoot, "dsh");
  const protocol = await import(
    pathToFileURL(
      join(
        dsh,
        "node_modules",
        "@deepseek-ai",
        "dsh-api-gateway",
        "lib",
        "types",
        "stream-protocol.js",
      ),
    ).href
  );
  if (
    typeof protocol.parseRemoteStreamServerMessage !== "function" ||
    typeof protocol.REMOTE_STREAM_MUX_PATH !== "string"
  ) {
    throw new Error("local: runtime does not export the Remote stream protocol");
  }
  return protocol;
}

/** Load the runtime's own `ws` build so the carrier matches the Host. */
export function loadRuntimeWebSocket(runtimeRoot) {
  const requireFromRuntime = createRequire(
    join(runtimeRoot, "dsh", "package.json"),
  );
  const loaded = requireFromRuntime("ws");
  return loaded.WebSocket ?? loaded;
}

function assertEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint === "")
    throw new TypeError("local: RPC endpoint must be a non-empty string");
  const segments = endpoint.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        !ENDPOINT_SEGMENT_PATTERN.test(segment),
    )
  )
    throw new TypeError(`local: invalid RPC endpoint ${JSON.stringify(endpoint)}`);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cookiePair(setCookie) {
  if (typeof setCookie !== "string") return undefined;
  const pair = setCookie.split(";", 1)[0].trim();
  return pair.includes("=") ? pair : undefined;
}

/** Exchange the Host's single launch token for an API Cookie. */
export async function exchangeLaunchToken(url, fetchImpl = globalThis.fetch) {
  let launch;
  try {
    launch = new URL(url);
  } catch {
    throw new Error("local: --url is not a URL");
  }
  const token = launch.searchParams.get("token");
  if (!token) throw new Error("local: the Host URL carries no launch token");
  const connect = new URL(CONNECT_PATH, launch.origin);
  connect.searchParams.set("token", token);
  // `answer` is required for the `$events` stream; `none` is unary-only.
  connect.searchParams.set("interactions", "answer");
  const response = await fetchImpl(connect, { redirect: "manual" });
  if (response.status !== 302) {
    throw new Error(
      `local: /connect returned HTTP ${response.status}; the launch token is not usable`,
    );
  }
  const cookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")];
  const cookie = cookies.map(cookiePair).find(Boolean);
  if (!cookie) throw new Error("local: /connect published no Cookie");
  const mux = new URL(
    response.headers.get("location") ?? "/api/remote.mux",
    connect,
  );
  return { origin: launch.origin, cookie, mux };
}

/**
 * Client transport for one local Host generation.
 *
 * The method surface is the frozen `RemoteClientCore` subset used by
 * `RemoteTypertGateway`: `rpc`, `onEvent`, `onClose`, `close` and `getStats`.
 */
export class LocalTransport {
  constructor({ origin, cookie, mux, protocol, sockets, fetchImpl }) {
    this.origin = origin;
    this.cookie = cookie;
    this.mux = mux;
    this.protocol = protocol;
    this.createSocket = sockets;
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
    this.socket = undefined;
    this.socketError = undefined;
    this.opening = undefined;
    this.closed = false;
    this.events = new Set();
    this.closers = new Set();
    this.closeEmitted = false;
    this.requests = 0;
    this.frames = 0;
  }

  /** Open the mux eagerly so a broken upgrade surfaces before the first call. */
  async ready() {
    await this.openSocket();
    return this;
  }

  async openSocket() {
    if (this.socket !== undefined) return this.socket;
    if (this.socketError !== undefined) throw this.socketError;
    if (this.opening !== undefined) return this.opening;
    this.opening = new Promise((resolve, reject) => {
      let socket;
      try {
        socket = this.createSocket(this.mux.href, {
          headers: { cookie: this.cookie },
        });
      } catch (error) {
        this.socketError = error;
        reject(error);
        return;
      }
      const settle = (error) => {
        if (error === undefined) resolve(socket);
        else {
          this.socketError = error;
          reject(error);
        }
      };
      socket.once("open", () => settle());
      socket.once("error", (error) => settle(error));
      socket.on("message", (data) => this.onFrame(data));
      socket.on("close", () => {
        // A closed mux disposes the Host Peer; no later call can succeed.
        this.socketError = new Error("local: the Host stream transport closed");
        this.socket = undefined;
        this.emitClose();
      });
      this.socket = socket;
      // Never keep the helper process alive only for the socket.
      socket.on("error", () => undefined);
    });
    return this.opening;
  }

  onFrame(data) {
    if (this.closed) return;
    let text;
    if (typeof data === "string") text = data;
    else if (Buffer.isBuffer(data)) text = data.toString("utf8");
    else if (Array.isArray(data)) text = Buffer.concat(data).toString("utf8");
    else if (data instanceof ArrayBuffer) text = Buffer.from(data).toString("utf8");
    else return;
    let frame;
    try {
      frame = this.protocol.parseRemoteStreamServerMessage(text);
    } catch {
      // A frame this build cannot parse is a protocol break, not a retryable
      // condition: fail the physical carrier so the client reconnects.
      this.socketError = new Error("local: the Host sent an invalid stream frame");
      try {
        this.socket?.close();
      } catch {
        /* already gone */
      }
      return;
    }
    this.frames += 1;
    if (frame.type === "item") {
      this.emitEvent({
        event: "harness.remote.frame",
        data: {
          streamId: frame.streamId,
          hasValue: Object.hasOwn(frame, "value"),
          ...(Object.hasOwn(frame, "value") ? { value: frame.value } : {}),
        },
      });
      return;
    }
    if (frame.type === "end") {
      this.emitEvent({
        event: "harness.remote.stream.closed",
        data: { streamId: frame.streamId, reason: "ended" },
      });
      return;
    }
    this.emitEvent({
      event: "harness.remote.stream.closed",
      data: {
        streamId: frame.streamId,
        reason: "failed",
        failure: frame.error,
      },
    });
  }

  onEvent(listener) {
    this.events.add(listener);
    return () => {
      this.events.delete(listener);
    };
  }

  onClose(listener) {
    this.closers.add(listener);
    return () => {
      this.closers.delete(listener);
    };
  }

  emitEvent(event) {
    for (const listener of [...this.events]) {
      try {
        listener(event);
      } catch {
        /* a producer-side listener fault must not break framing */
      }
    }
  }

  emitClose() {
    // One physical carrier produces exactly one close observation.
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    for (const listener of [...this.closers]) {
      try {
        listener();
      } catch {
        /* see emitEvent */
      }
    }
  }

  getStats() {
    return {
      mode: "Local",
      origin: this.origin,
      socket: this.socket === undefined ? "closed" : "open",
      requests: this.requests,
      frames: this.frames,
    };
  }

  /** One Remote control call, as the frozen gateway issues them. */
  async rpc(method, params, signal, options) {
    if (this.closed) throw localFailure("CANCELLED", "本地 Host 连接已关闭。");
    switch (method) {
      case "harness.transport.describe":
        return { capabilities: [...LOCAL_CAPABILITIES], transport: "local-mux" };
      case "harness.remote.call":
        return this.call(params, signal, options);
      case "harness.remote.stream.open":
        return this.openStream(params, signal);
      case "harness.remote.stream.close":
        return this.closeStream(params);
      default:
        throw localFailure(
          "UNSUPPORTED_OPERATION",
          `本地传输不支持 ${method}。`,
        );
    }
  }

  async call(params, signal, options) {
    const endpoint = params?.endpoint;
    assertEndpoint(endpoint);
    const rpcId = randomUUID();
    const body = JSON.stringify({
      type: "client-request",
      rpcId,
      method: endpoint,
      payload: params.payload,
    });
    this.requests += 1;
    // A per-call deadline is additive: the caller's signal still wins.
    const callSignal =
      options?.timeoutMs === undefined
        ? signal
        : AbortSignal.any([
            signal ?? new AbortController().signal,
            AbortSignal.timeout(options.timeoutMs),
          ]);
    let response;
    try {
      response = await this.fetchImpl(`${this.origin}/api/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: this.cookie },
        body,
        ...(callSignal === undefined ? {} : { signal: callSignal }),
      });
    } catch (error) {
      if (callSignal?.aborted) throw callSignal.reason ?? error;
      throw localFailure("TRANSPORT_CLOSED", "无法连接本地 Host。", {
        cause: String(error?.message ?? error),
      });
    }
    if (!response.ok) throw httpFailure(response.status, endpoint);
    const mediaType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    const envelope =
      mediaType === "multipart/form-data"
        ? await parseBinaryResponse(response)
        : parseEnvelope(await response.json());
    if (envelope.rpcId !== rpcId)
      throw localFailure("PROTOCOL_ERROR", "本地 Host 的 RPC 回包标识不匹配。", {
        endpoint,
      });
    return envelope.result;
  }

  async openStream(params, signal) {
    const endpoint = params?.endpoint;
    assertEndpoint(endpoint);
    const streamId = params?.streamId;
    if (typeof streamId !== "string" || streamId === "")
      throw localFailure("PROTOCOL_ERROR", "本地 Host 的流缺少标识。");
    if (signal?.aborted) throw signal.reason;
    const socket = await this.openSocket();
    socket.send(
      JSON.stringify({
        type: "open",
        streamId,
        endpoint,
        payload: params.payload,
      }),
    );
    return { opened: true };
  }

  async closeStream(params) {
    const streamId = params?.streamId;
    if (typeof streamId !== "string" || streamId === "") return { closed: false };
    const socket = this.socket;
    if (socket === undefined) return { closed: false };
    if (socket.readyState === socket.OPEN)
      socket.send(JSON.stringify({ type: "cancel", streamId }));
    return { closed: true };
  }

  /**
   * Stream one local regular file to the Host's raw-byte upload route.
   *
   * The Host stores the exact submitted bytes under the Session's Agent scope
   * and answers with `{ok:true,value:{receiptId,file:{attachmentId,name,bytes}}}`.
   * The body is one ordered chunk stream, so a file of any size crosses without
   * a base64 envelope or a buffered JSON cap; a zero-byte file is an empty body
   * that still produces a receipt.
   *
   * @param options.sessionId - Session whose Agent scope owns the receipt.
   * @param options.path - local path of the file to read (never the Host's name).
   * @param options.name - optional display name; the Host sanitizes it.
   * @param options.signal - caller cancellation, also aborts the file reads.
   * @param options.onProgress - called with the bytes handed to the carrier.
   * @returns the Host's `FileUploadValue`.
   */
  async uploadFile({ sessionId, path, name, signal, onProgress } = {}) {
    if (this.closed) throw localFailure("CANCELLED", "本地 Host 连接已关闭。");
    const session = requireNonEmptyString(sessionId, "sessionId");
    const localPath = requireNonEmptyString(path, "path");
    const target = new URL(FILE_UPLOAD_PATH, this.origin);
    target.searchParams.set("sessionId", session);
    if (typeof name === "string" && name !== "")
      target.searchParams.set("name", name);
    signal?.throwIfAborted();
    let handle;
    try {
      handle = await open(
        localPath,
        constants.O_RDONLY |
          (constants.O_NOFOLLOW ?? 0) |
          (constants.O_NONBLOCK ?? 0),
      );
    } catch (error) {
      throw localFailure(
        "INVALID_LOCAL_UPLOAD_FILE",
        "无法读取要上传的本地文件。",
        { cause: String(error?.code ?? error?.message ?? error) },
      );
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile())
        throw localFailure("INVALID_LOCAL_UPLOAD_FILE", "只能上传普通文件。");
      if (!Number.isSafeInteger(stat.size) || stat.size < 0)
        throw localFailure("INVALID_LOCAL_UPLOAD_FILE", "本地文件长度无效。");
      const size = stat.size;
      const request = {
        method: "POST",
        headers: { "content-type": "application/octet-stream", cookie: this.cookie },
        ...(signal === undefined ? {} : { signal }),
        ...(size === 0
          ? { body: new Uint8Array(0) }
          : {
              // An async iterable body needs half duplex, and it keeps the
              // carrier honest: nothing is buffered whole before sending.
              body: readFileChunks(handle, size, signal, onProgress),
              duplex: "half",
            }),
      };
      this.requests += 1;
      let response;
      try {
        response = await this.fetchImpl(target, request);
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        const fault = codedFault(error);
        if (fault !== undefined) throw fault;
        // The bytes may have been partially accepted before the carrier broke,
        // so this is not a proven rejection.
        throw localFailure("TRANSPORT_CLOSED", "无法连接本地 Host。", {
          cause: String(error?.message ?? error),
        });
      }
      const value = await parseUploadResponse(response);
      // The Host stores verbatim bytes, so its receipt must report our size.
      if (value.file.bytes !== size)
        throw localFailure(
          "PROTOCOL_ERROR",
          "本地 Host 保存的字节数与本地文件不一致。",
          { expected: size, actual: value.file.bytes },
        );
      return value;
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  /**
   * Download one Host resource route to a fresh temporary file.
   *
   * The Host serves some resources as plain authenticated GETs rather than
   * Typert endpoints — the Session log ZIP and the plugin detail images. Those
   * bodies can exceed the stdio helpers' request/response framing (a ZIP is
   * megabytes), so they never cross as JSON or base64: the bytes are streamed
   * to a private temporary directory and the path is returned instead.
   *
   * The caller owns the returned file and its directory and must delete it.
   *
   * @param options.apiPath - one `/api/...` route on this Host.
   * @param options.query - optional query parameters; `undefined` is omitted.
   * @param options.fallbackName - file name when the Host sends no
   *   `content-disposition` file name.
   * @param options.accept - media types accepted, each exact or `type/*`.
   * @param options.signal - caller cancellation, also ends the body stream.
   * @returns `{path, bytes, name, mediaType}` for the written file.
   */
  async downloadFile({ apiPath, query = {}, fallbackName, accept = [], signal } = {}) {
    if (this.closed) throw localFailure("CANCELLED", "本地 Host 连接已关闭。");
    const route = requireApiPath(apiPath);
    const target = new URL(route, this.origin);
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined && value !== null)
        target.searchParams.set(name, String(value));
    }
    signal?.throwIfAborted();
    this.requests += 1;
    let response;
    try {
      response = await this.fetchImpl(target, {
        method: "GET",
        headers: { cookie: this.cookie },
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      throw localFailure("TRANSPORT_CLOSED", "无法连接本地 Host。", {
        cause: String(error?.message ?? error),
      });
    }
    if (!response.ok) throw await downloadHttpFailure(response, route);
    const mediaType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (!mediaTypeAccepted(mediaType, accept)) {
      await cancelBody(response.body);
      throw localFailure(
        "PROTOCOL_ERROR",
        "本地 Host 返回的资源类型与请求不符。",
        { mediaType: mediaType ?? null, accept: [...accept] },
      );
    }
    const directory = await mkdtemp(join(tmpdir(), DOWNLOAD_DIRECTORY_PREFIX));
    const name = parseDownloadName(
      response.headers.get("content-disposition"),
      fallbackName,
    );
    const path = join(directory, name);
    let handle;
    try {
      handle = await open(path, "wx", 0o600);
      let bytes = 0;
      for await (const chunk of bodyChunks(response.body)) {
        signal?.throwIfAborted();
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        let offset = 0;
        while (offset < buffer.byteLength)
          offset += (await handle.write(buffer, offset)).bytesWritten;
        bytes += buffer.byteLength;
      }
      await handle.sync();
      await handle.close();
      handle = undefined;
      return { path, bytes, name, mediaType };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      if (signal?.aborted) throw signal.reason ?? error;
      const fault = codedFault(error);
      if (fault !== undefined) throw fault;
      throw localFailure("DOWNLOAD_FAILED", "本地资源的落盘写入失败。", {
        cause: String(error?.message ?? error),
      });
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.events.clear();
    const socket = this.socket;
    this.socket = undefined;
    this.socketError = new Error("local: the Host stream transport closed");
    if (socket !== undefined) {
      try {
        socket.close();
      } catch {
        /* already gone */
      }
    }
    this.emitClose();
    this.closers.clear();
  }
}

/** Open one local Host generation. */
export async function connectLocalHost({
  url,
  runtimeRoot,
  fetchImpl,
  webSocketImpl,
  inject,
}) {
  const protocol = inject?.protocol ?? (await loadRuntimeProtocol(runtimeRoot));
  const WebSocket = webSocketImpl ?? inject?.sockets ?? loadRuntimeWebSocket(runtimeRoot);
  const handshake = await exchangeLaunchToken(url, fetchImpl);
  const transport = new LocalTransport({
    ...handshake,
    protocol,
    sockets: (target, options) => new WebSocket(target, options),
    fetchImpl,
  });
  await transport.ready();
  return transport;
}

function localFailure(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function httpFailure(status, endpoint) {
  if (status === 401)
    return localFailure("AUTH_REQUIRED", "本地 Host 拒绝了启动凭据。", {
      status,
      endpoint,
    });
  if (status === 403)
    return localFailure("PERMISSION_DENIED", "本地 Host 拒绝了该请求。", {
      status,
      endpoint,
    });
  return localFailure("TRANSPORT_CLOSED", `本地 Host 返回 HTTP ${status}。`, {
    status,
    endpoint,
  });
}

function requireNonEmptyString(value, name) {
  if (typeof value !== "string" || value === "")
    throw localFailure("INVALID_ARGUMENT", `本地上传缺少 ${name}。`);
  return value;
}

/** One route on this Host's `/api` channel, never another origin. */
function requireApiPath(apiPath) {
  if (
    typeof apiPath !== "string" ||
    !apiPath.startsWith("/api/") ||
    apiPath.startsWith("/api/../") ||
    /[\s\u0000-\u001f]/u.test(apiPath)
  )
    throw localFailure("INVALID_ARGUMENT", "本地资源路由必须是 /api/ 下的路径。");
  return apiPath;
}

/** Whether a response media type is one the caller accepts. */
function mediaTypeAccepted(mediaType, accept) {
  if (accept.length === 0) return true;
  if (typeof mediaType !== "string" || mediaType === "") return false;
  return accept.some((entry) =>
    entry.endsWith("/*")
      ? mediaType.startsWith(`${entry.slice(0, -1)}`)
      : mediaType === entry,
  );
}

async function cancelBody(body) {
  if (body === null || body === undefined) return;
  if (typeof body.cancel === "function") {
    await body.cancel().catch(() => undefined);
    return;
  }
  try {
    for await (const _chunk of body) {
      // Drain so the carrier can release the connection.
    }
  } catch {
    /* a refused resource body is discarded either way */
  }
}

/** Ordered bytes of one response body, whichever stream shape it has. */
async function* bodyChunks(body) {
  if (body === null || body === undefined) return;
  if (typeof body.getReader === "function") {
    const reader = body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done === true) return;
        yield value;
      }
    } finally {
      reader.releaseLock?.();
    }
  } else {
    for await (const chunk of body) yield chunk;
  }
}

/**
 * The file name a download is written under.
 *
 * The Host names the archive in `content-disposition`; only the trailing file
 * name of that header is used, so a header can never choose a directory.
 *
 * @param contentDisposition - the response header, when the Host sent one.
 * @param fallbackName - used when the header carries no usable file name.
 */
export function parseDownloadName(contentDisposition, fallbackName) {
  const fallback = requireDownloadName(fallbackName);
  if (typeof contentDisposition !== "string") return fallback;
  const extended = /filename\*\s*=\s*([^;]+)/iu.exec(contentDisposition);
  if (extended !== null) {
    const value = extended[1].trim().replace(/^"(.*)"$/u, "$1");
    // RFC 5987: charset'language'percent-encoded-name
    const encoded = /^[^']*'[^']*'(.*)$/u.exec(value);
    try {
      return requireDownloadName(
        encoded === null ? value : decodeURIComponent(encoded[1]),
      );
    } catch {
      return encoded === null ? fallback : requireDownloadName(encoded[1]);
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/iu.exec(contentDisposition);
  if (plain === null) return fallback;
  try {
    return requireDownloadName((plain[2] ?? plain[1]).trim());
  } catch {
    return fallback;
  }
}

/** One safe file name, never a path segment or a hidden file. */
function requireDownloadName(value) {
  if (typeof value !== "string")
    throw localFailure("INVALID_ARGUMENT", "下载文件名缺失。");
  // Header values arrive percent-encoded for non-ASCII names, so decode before
  // judging the segments; RFC 5987 may already have decoded them.
  let name = value.trim();
  try {
    if (/%[0-9A-Fa-f]{2}/u.test(name)) name = decodeURIComponent(name);
  } catch {
    /* keep the undecoded name and let the checks below refuse it */
  }
  const segment = basename(name);
  if (
    segment === "" ||
    segment === "." ||
    segment === ".." ||
    segment !== name ||
    segment.startsWith(".") ||
    /[\\/\u0000-\u001f]/u.test(segment)
  )
    throw localFailure("INVALID_ARGUMENT", "下载文件名不能是路径或隐藏文件。");
  return segment;
}

async function downloadHttpFailure(response, route) {
  const body = await response.text?.().catch(() => undefined);
  const detail = typeof body === "string" ? body.slice(0, 120) : undefined;
  const details = {
    status: response.status,
    route,
    ...(detail ? { detail } : {}),
  };
  if (response.status === 401)
    return localFailure("AUTH_REQUIRED", "本地 Host 拒绝了启动凭据。", details);
  if (response.status === 403)
    return localFailure("PERMISSION_DENIED", "本地 Host 拒绝了该资源请求。", details);
  if (response.status === 404)
    return localFailure(
      "NOT_FOUND",
      "本地 Host 没有该资源：路由未启用，或会话/文件不存在。",
      details,
    );
  if (response.status === 400)
    return localFailure("INVALID_ARGUMENT", "本地 Host 拒绝了资源请求参数。", details);
  return localFailure(
    "DOWNLOAD_FAILED",
    `本地 Host 返回 HTTP ${response.status}。`,
    details,
  );
}

/**
 * Ordered bytes of one file, bounded to the size observed before the upload.
 * A file that shrank stops the transfer instead of uploading its prefix.
 */
async function* readFileChunks(handle, size, signal, onProgress) {
  let offset = 0;
  while (offset < size) {
    signal?.throwIfAborted();
    const length = Math.min(UPLOAD_CHUNK_BYTES, size - offset);
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    if (bytesRead === 0)
      throw localFailure(
        "LOCAL_UPLOAD_FILE_CHANGED",
        "本地文件在上传过程中改变了。",
      );
    offset += bytesRead;
    if (typeof onProgress === "function") onProgress(offset);
    yield buffer.subarray(0, bytesRead);
  }
}

/**
 * The carrier wraps one body-stream fault in `TypeError: fetch failed`; keep the
 * coded failure this module raised so a cancelled progress check stays visible.
 */
function codedFault(error) {
  let node = error;
  for (let depth = 0; node !== undefined && depth < 4; depth += 1) {
    if (typeof node.code === "string" && node.code !== "" && isRecord(node.details))
      return node;
    node = node.cause;
  }
  return undefined;
}

/** A Host refusal this carrier observed: the bytes were not stored. */
function uploadFailure(code, message, details = {}) {
  return Object.assign(localFailure(code, message, details), { rejected: true });
}

function uploadHttpFailure(status) {
  if (status === 401)
    return uploadFailure("AUTH_REQUIRED", "本地 Host 拒绝了启动凭据。", {
      status,
    });
  if (status === 403)
    return uploadFailure("PERMISSION_DENIED", "本地 Host 拒绝了该上传。", {
      status,
    });
  if (status === 404)
    return uploadFailure(
      "FEATURE_NOT_SUPPORTED",
      "本地 Host 未提供文件上传路由。",
      { status },
    );
  if (status === 405 || status === 415)
    return uploadFailure("PROTOCOL_ERROR", "本地 Host 拒绝了上传请求形状。", {
      status,
    });
  if (status === 413)
    return uploadFailure("REQUEST_TOO_LARGE", "上传超过 Host 的请求体上限。", {
      status,
    });
  return uploadFailure("UPLOAD_FAILED", `本地 Host 返回 HTTP ${status}。`, {
    status,
  });
}

/**
 * Validate one raw-byte upload answer.
 *
 * The route answers `{ok:true,value}` / `{ok:false,error}` with HTTP 200 after
 * request validation, so the two channels are discriminated exactly like a
 * unary envelope's `result` — but without an `rpcId`, because this route is
 * request-shaped rather than RPC-shaped.
 */
export async function parseUploadResponse(response) {
  if (!response.ok) throw uploadHttpFailure(response.status);
  const mediaType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json")
    throw localFailure("PROTOCOL_ERROR", "本地 Host 的上传回包不是 JSON。", {
      mediaType: mediaType ?? null,
    });
  let body;
  try {
    body = await response.json();
  } catch {
    throw localFailure("PROTOCOL_ERROR", "本地 Host 的上传回包无法解析。");
  }
  if (!isRecord(body))
    throw localFailure("PROTOCOL_ERROR", "本地 Host 的上传回包形状无效。");
  if (body.ok === false) {
    const error = isRecord(body.error) ? body.error : {};
    throw uploadFailure(
      typeof error.code === "string" && error.code !== ""
        ? error.code
        : "UPLOAD_FAILED",
      typeof error.message === "string" && error.message !== ""
        ? error.message
        : "本地 Host 拒绝了这个上传。",
      isRecord(error.details) ? error.details : {},
    );
  }
  const value = body.value;
  const file = isRecord(value) ? value.file : undefined;
  if (
    body.ok !== true ||
    !isRecord(value) ||
    typeof value.receiptId !== "string" ||
    value.receiptId === "" ||
    !isRecord(file) ||
    typeof file.attachmentId !== "string" ||
    file.attachmentId === "" ||
    typeof file.name !== "string" ||
    !Number.isSafeInteger(file.bytes) ||
    file.bytes < 0
  )
    throw localFailure("PROTOCOL_ERROR", "本地 Host 的上传回执形状无效。");
  return {
    receiptId: value.receiptId,
    file: {
      attachmentId: file.attachmentId,
      name: file.name,
      bytes: file.bytes,
    },
  };
}

/** Validate one JSON unary envelope. */
export function parseEnvelope(value) {
  if (!isRecord(value) || value.type !== "server-response")
    throw new TypeError("local: invalid server-response envelope");
  if (typeof value.rpcId !== "string")
    throw new TypeError("local: server-response has no rpcId");
  const result = value.result;
  if (!isRecord(result))
    throw new TypeError("local: server-response has no result");
  if (result.ok === true)
    return { rpcId: value.rpcId, result: { ok: true, value: result.value } };
  if (result.ok !== false || !isRecord(result.error))
    throw new TypeError("local: invalid server-response result");
  const error = result.error;
  if (
    typeof error.code !== "string" ||
    typeof error.message !== "string" ||
    !isRecord(error.details)
  )
    throw new TypeError("local: invalid server-response failure");
  return {
    rpcId: value.rpcId,
    result: {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    },
  };
}

/**
 * Restore byte attachments from a multipart unary response, the same way the
 * browser carrier does, so endpoints that return file bytes keep working.
 */
export async function parseBinaryResponse(response) {
  const form = await response.formData();
  const fields = new Map();
  for (const [name, value] of form) {
    if (fields.has(name)) throw new TypeError("local: duplicate multipart field");
    fields.set(name, value);
  }
  const metadata = fields.get("metadata");
  fields.delete("metadata");
  if (typeof metadata !== "string")
    throw new TypeError("local: missing multipart metadata");
  const envelope = JSON.parse(metadata);
  const full = parseEnvelope(envelope);
  if (
    !full.result.ok ||
    !isRecord(envelope) ||
    !Array.isArray(envelope.attachments) ||
    envelope.attachments.length === 0
  )
    throw new TypeError("local: invalid multipart result");
  const root = { value: full.result.value };
  for (const attachment of envelope.attachments) {
    if (
      !isRecord(attachment) ||
      attachment.codec !== "bytes" ||
      typeof attachment.part !== "string" ||
      !Array.isArray(attachment.path)
    )
      throw new TypeError("local: invalid multipart attachment");
    const data = fields.get(attachment.part);
    fields.delete(attachment.part);
    if (!(data instanceof Blob))
      throw new TypeError("local: missing multipart attachment part");
    let parent = root;
    let key = "value";
    for (const segment of attachment.path) {
      const value = parent[key];
      if (typeof value !== "object" || value === null)
        throw new TypeError("local: invalid multipart attachment path");
      if (Array.isArray(value)) {
        if (
          typeof segment !== "number" ||
          !Number.isSafeInteger(segment) ||
          segment < 0 ||
          segment >= value.length
        )
          throw new TypeError("local: invalid multipart attachment path");
      } else if (typeof segment !== "string") {
        throw new TypeError("local: invalid multipart attachment path");
      }
      if (!Object.hasOwn(value, segment))
        throw new TypeError("local: invalid multipart attachment path");
      parent = value;
      key = segment;
    }
    if (parent[key] !== null)
      throw new TypeError("local: invalid multipart attachment placeholder");
    Object.defineProperty(parent, key, {
      value: new Uint8Array(await data.arrayBuffer()),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  if (fields.size !== 0) throw new TypeError("local: unexpected multipart fields");
  return {
    rpcId: full.rpcId,
    result: { ok: true, value: root.value },
  };
}
