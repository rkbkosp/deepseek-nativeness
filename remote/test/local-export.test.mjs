import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import {
  LocalTransport,
  parseDownloadName,
  PLUGIN_MANAGER_DETAIL_FILE_PATH,
  SESSION_EXPORT_PATH,
} from "../local-transport.mjs";
import { LocalAdapter } from "../local-adapter.mjs";
import { RemoteAdapter } from "../client.mjs";

const ORIGIN = "http://127.0.0.1:40126";
const COOKIE = "{{SECRET_zc65it3q}}";

/** A ZIP-shaped fixture: only the leading signature matters here. */
const ZIP_BYTES = new Uint8Array([
  0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00,
]);

function zipResponse({ name = "dsh-session-session-1.zip", chunked = false } = {}) {
  const headers = {
    "content-type": "application/zip",
    "content-disposition": `attachment; filename="${name}"`,
  };
  if (!chunked) return new Response(ZIP_BYTES, { status: 200, headers });
  // A streamed body proves the bytes are written as they arrive.
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(ZIP_BYTES.subarray(0, 5));
      controller.enqueue(ZIP_BYTES.subarray(5));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers });
}

/** A transport whose mux never opens: downloads are plain GETs. */
function transport(fetchImpl) {
  class IdleSocket extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    send() {}
    close() {
      this.readyState = 3;
      this.emit("close");
    }
  }
  return new LocalTransport({
    origin: ORIGIN,
    cookie: COOKIE,
    mux: new URL(`${ORIGIN}/api/remote.mux`),
    protocol: { parseRemoteStreamServerMessage: (text) => JSON.parse(text) },
    sockets: () => new IdleSocket(),
    fetchImpl,
  });
}

/** Delete the file and the private directory the download created. */
async function discard(path) {
  await rm(dirname(path), { recursive: true, force: true });
}

test("the Host's content-disposition file name is used, nothing else is", () => {
  assert.equal(
    parseDownloadName('attachment; filename="dsh-session-s1.zip"', "s1.zip"),
    "dsh-session-s1.zip",
  );
  assert.equal(parseDownloadName("attachment; filename=dsh-session-s1.zip", "s1.zip"), "dsh-session-s1.zip");
  assert.equal(
    parseDownloadName("attachment; filename*=UTF-8''%E4%BC%9A%E8%AF%9D.zip", "s1.zip"),
    "会话.zip",
  );
  // No header at all falls back to the caller's name.
  assert.equal(parseDownloadName(undefined, "session-1.zip"), "session-1.zip");
  // A header can never choose a directory, a hidden file, or escape the dir.
  assert.equal(parseDownloadName('attachment; filename="../escape.zip"', "s1.zip"), "s1.zip");
  assert.equal(parseDownloadName('attachment; filename=".hidden"', "s1.zip"), "s1.zip");
  assert.equal(parseDownloadName('attachment; filename="sub/dir.zip"', "s1.zip"), "s1.zip");
});

test("the Session ZIP streams to a private temporary file", async () => {
  const seen = [];
  const local = transport(async (url, init) => {
    seen.push({ url: String(url), init });
    return zipResponse({ chunked: true });
  });
  try {
    const file = await local.downloadFile({
      apiPath: SESSION_EXPORT_PATH,
      query: { sessionId: "session-1", includeDescendants: "true" },
      fallbackName: "session-1.zip",
      accept: ["application/zip"],
    });
    assert.equal(seen.length, 1);
    const target = new URL(seen[0].url);
    assert.equal(target.origin, ORIGIN);
    assert.equal(target.pathname, SESSION_EXPORT_PATH);
    assert.equal(target.searchParams.get("sessionId"), "session-1");
    assert.equal(target.searchParams.get("includeDescendants"), "true");
    assert.equal(seen[0].init.method, "GET");
    assert.equal(seen[0].init.headers.cookie, COOKIE);
    // The file really holds the streamed bytes, in order, under its own dir.
    const written = await readFile(file.path);
    assert.deepEqual(new Uint8Array(written), ZIP_BYTES);
    assert.equal(file.bytes, ZIP_BYTES.byteLength);
    assert.equal(file.name, "dsh-session-session-1.zip");
    assert.equal(file.mediaType, "application/zip");
    assert.match(file.path, new RegExp(`^${tmpdir()}/native-dsh-download-`, "u"));
    // The temporary directory is private to this download.
    const directory = await stat(dirname(file.path));
    assert.equal(directory.mode & 0o077, 0, "temp dir is owner-only");
    await discard(file.path);
  } finally {
    await local.close();
  }
});

test("a Host without a file name header falls back to <sessionId>.zip", async () => {
  const local = transport(
    async () =>
      new Response(ZIP_BYTES, {
        status: 200,
        headers: { "content-type": "application/zip" },
      }),
  );
  try {
    const file = await local.downloadFile({
      apiPath: SESSION_EXPORT_PATH,
      query: { sessionId: "session-9" },
      fallbackName: "session-9.zip",
      accept: ["application/zip"],
    });
    assert.equal(file.name, "session-9.zip");
    assert.equal(file.bytes, ZIP_BYTES.byteLength);
    await discard(file.path);
  } finally {
    await local.close();
  }
});

test("refusals map to distinct codes instead of a silent empty archive", async () => {
  const cases = [
    [401, "AUTH_REQUIRED"],
    [403, "PERMISSION_DENIED"],
    [404, "NOT_FOUND"],
    [500, "DOWNLOAD_FAILED"],
  ];
  for (const [status, code] of cases) {
    const local = transport(async () => new Response(`error ${status}`, { status }));
    try {
      await assert.rejects(
        local.downloadFile({
          apiPath: SESSION_EXPORT_PATH,
          query: { sessionId: "missing" },
          fallbackName: "missing.zip",
          accept: ["application/zip"],
        }),
        (error) => {
          assert.equal(error.code, code, `HTTP ${status}`);
          assert.equal(error.details?.status, status);
          assert.equal(error.details?.route, SESSION_EXPORT_PATH);
          assert.match(error.details?.detail ?? "", new RegExp(String(status), "u"));
          return true;
        },
      );
    } finally {
      await local.close();
    }
  }
});

test("a non-ZIP body is a protocol error, not a saved file", async () => {
  const local = transport(
    async () =>
      new Response("<html>not an archive</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
  );
  try {
    await assert.rejects(
      local.downloadFile({
        apiPath: SESSION_EXPORT_PATH,
        query: { sessionId: "s1" },
        fallbackName: "s1.zip",
        accept: ["application/zip"],
      }),
      { code: "PROTOCOL_ERROR" },
    );
  } finally {
    await local.close();
  }
});

test("only /api routes are downloadable, and a cancelled call downloads nothing", async () => {
  let called = 0;
  const local = transport(async () => {
    called += 1;
    return zipResponse();
  });
  try {
    await assert.rejects(
      local.downloadFile({ apiPath: "https://evil.example/steal", fallbackName: "x.zip" }),
      { code: "INVALID_ARGUMENT" },
    );
    await assert.rejects(
      local.downloadFile({ apiPath: "/connect?token=x", fallbackName: "x.zip" }),
      { code: "INVALID_ARGUMENT" },
    );
    const stop = new AbortController();
    const reason = Object.assign(new Error("replaced"), { code: "CANCELLED" });
    stop.abort(reason);
    await assert.rejects(
      local.downloadFile({
        apiPath: SESSION_EXPORT_PATH,
        query: { sessionId: "s1" },
        fallbackName: "s1.zip",
        signal: stop.signal,
      }),
      (error) => error === reason,
    );
    assert.equal(called, 0);
  } finally {
    await local.close();
  }
});

/** An adapter already bound to a carrier with a stubbed download method. */
function adapterWith(download) {
  const adapter = new LocalAdapter(() => {}, {
    url: `${ORIGIN}/?token=launch`,
    runtimeRoot: "build/runtime",
  });
  adapter.hostId = "local";
  adapter.interactionReady = true;
  adapter.connected = {
    client: {
      downloadFile: download,
      rpc: async () => ({ capabilities: ["workspace.upload.v1"] }),
      getStats: () => ({ mode: "Local" }),
      close: async () => {},
    },
    features: {},
  };
  adapter.gateway = {
    async *open() {
      yield { type: "baseline", owner: true };
    },
    invoke: async () => assert.fail("a download is not a Typert call"),
    dispatch: async () => assert.fail("a download is not a Typert mutation"),
  };
  return adapter;
}

test("exportSessionZip returns the completed file and reuses it per requestId", async () => {
  const calls = [];
  const adapter = adapterWith(async (options) => {
    calls.push(options);
    return {
      path: "/tmp/native-dsh-download-fixture/dsh-session-session-1.zip",
      bytes: 4096,
      name: "dsh-session-session-1.zip",
      mediaType: "application/zip",
    };
  });
  try {
    const first = await adapter.request("exportSessionZip", {
      sessionId: "session-1",
      requestId: "export-session-request-01",
    });
    assert.equal(first.status, "completed");
    assert.equal(first.path, "/tmp/native-dsh-download-fixture/dsh-session-session-1.zip");
    assert.equal(first.bytes, 4096);
    assert.equal(first.name, "dsh-session-session-1.zip");
    assert.equal(first.requestId, "export-session-request-01");
    assert.equal(first.hostId, "local");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].apiPath, SESSION_EXPORT_PATH);
    assert.deepEqual(calls[0].query, { sessionId: "session-1" });
    assert.equal(calls[0].fallbackName, "session-1.zip");
    assert.deepEqual(calls[0].accept, ["application/zip"]);

    const again = await adapter.request("exportSessionZip", {
      sessionId: "session-1",
      requestId: "export-session-request-01",
    });
    assert.deepEqual(again, first);
    assert.equal(calls.length, 1, "one download per requestId");

    await assert.rejects(
      adapter.request("exportSessionZip", {
        sessionId: "session-2",
        requestId: "export-session-request-01",
      }),
      { code: "REQUEST_ID_CONFLICT" },
    );
    await assert.rejects(
      adapter.request("exportSessionZip", { sessionId: "" }),
      { code: "INVALID_ARGUMENT" },
    );
    await assert.rejects(
      adapter.request("exportSessionZip", { sessionId: "s", requestId: "short" }),
      { code: "INVALID_REQUEST_ID" },
    );
  } finally {
    await adapter.close();
  }
});

test("a refused download leaves no receipt behind, so a retry can run", async () => {
  let attempts = 0;
  const adapter = adapterWith(async () => {
    attempts += 1;
    if (attempts === 1)
      throw Object.assign(new Error("本地 Host 没有该资源。"), {
        code: "NOT_FOUND",
        details: { status: 404 },
        rejected: true,
      });
    return {
      path: "/tmp/native-dsh-download-fixture/dsh-session-s.zip",
      bytes: 12,
      name: "dsh-session-s.zip",
      mediaType: "application/zip",
    };
  });
  try {
    await assert.rejects(
      adapter.request("exportSessionZip", {
        sessionId: "s",
        requestId: "export-retry-request-01",
      }),
      { code: "NOT_FOUND" },
    );
    const retried = await adapter.request("exportSessionZip", {
      sessionId: "s",
      requestId: "export-retry-request-01",
    });
    assert.equal(retried.status, "completed");
    assert.equal(attempts, 2);
  } finally {
    await adapter.close();
  }
});

test("a detail image uses the bundle route and its query", async () => {
  const calls = [];
  const adapter = adapterWith(async (options) => {
    calls.push(options);
    return {
      path: "/tmp/native-dsh-download-fixture/logo.png",
      bytes: 512,
      name: "logo.png",
      mediaType: "image/png",
    };
  });
  try {
    const image = await adapter.request("readDetailImage", {
      bundle: "dsh-pdf",
      document: "README.zh.md",
      path: "docs/logo.png",
      sources: ["jsdelivr"],
    });
    assert.equal(image.status, "completed");
    assert.equal(image.mediaType, "image/png");
    assert.equal(image.name, "logo.png");
    assert.equal(calls[0].apiPath, PLUGIN_MANAGER_DETAIL_FILE_PATH);
    assert.deepEqual(calls[0].query, {
      bundle: "dsh-pdf",
      document: "README.zh.md",
      path: "docs/logo.png",
      sources: "jsdelivr",
    });
    assert.deepEqual(calls[0].accept, ["image/*"]);

    await assert.rejects(
      adapter.request("readDetailImage", { document: "README.md", path: "a.png" }),
      { code: "INVALID_ARGUMENT" },
    );
  } finally {
    await adapter.close();
  }
});

test("the remote carrier keeps refusing raw downloads", async () => {
  const adapter = new RemoteAdapter(() => {});
  adapter.interactionReady = true;
  adapter.gateway = {
    invoke: async () => assert.fail("nothing is downloaded over Remote"),
    dispatch: async () => assert.fail("nothing is downloaded over Remote"),
  };
  try {
    await assert.rejects(adapter.request("exportSessionZip", { sessionId: "s" }), {
      code: "UNSUPPORTED_REMOTE_RESOURCE",
      message: "Remote缺少原始日志下载资源",
    });
    await assert.rejects(
      adapter.request("readDetailImage", { bundle: "b", document: "d", path: "p" }),
      { code: "UNSUPPORTED_REMOTE_RESOURCE" },
    );
  } finally {
    await adapter.close();
  }
});