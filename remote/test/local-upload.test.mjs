import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FILE_UPLOAD_PATH,
  LocalTransport,
  parseUploadResponse,
} from "../local-transport.mjs";
import { RemoteAdapter } from "../client.mjs";

const ORIGIN = "http://127.0.0.1:40124";
const COOKIE = "dsh-browser-session=local-upload-test";

/** A response stand-in: only what the upload carrier reads. */
function reply({ status = 200, contentType = "application/json", json, text }) {
  const entries = new Map();
  if (contentType) entries.set("content-type", contentType);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => entries.get(String(name).toLowerCase()) ?? null,
    },
    json: async () => {
      if (json === undefined) throw new SyntaxError("not JSON");
      return json;
    },
    text: async () => text ?? JSON.stringify(json),
  };
}

const receipt = (bytes, name = "fixture.bin") => ({
  ok: true,
  value: {
    receiptId: "receipt-1",
    file: { attachmentId: "attachment-1", name, bytes },
  },
});

/** A transport whose `ws` never opens: uploads are unary and need no stream. */
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
    protocol: { parseRemoteStreamMessage: (text) => JSON.parse(text) },
    sockets: () => new IdleSocket(),
    fetchImpl,
  });
}

/** Consume whatever body the carrier attached, whichever shape it has. */
async function drain(body) {
  const chunks = [];
  if (body === undefined) return Buffer.alloc(0);
  if (body instanceof Uint8Array) return Buffer.from(body);
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function fixtureFile(bytes, name = "fixture.bin") {
  const dir = await mkdtemp(join(tmpdir(), "native-dsh-local-upload-"));
  const file = join(dir, name);
  await writeFile(file, bytes);
  return { dir, file };
}

test("local describe advertises only the upload capability it actually serves", async () => {
  const local = transport(async () => assert.fail("describe is local"));
  const metadata = await local.rpc("harness.transport.describe", {});
  assert.deepEqual(metadata.capabilities, ["workspace.upload.v1"]);
  assert.equal(metadata.transport, "local-mux");
  await local.close();
});

test("a file streams once to the Host's raw upload route and returns its receipt", async () => {
  const payload = Buffer.from("hello local host\n".repeat(4096));
  const { dir, file } = await fixtureFile(payload);
  const seen = [];
  const local = transport(async (url, init) => {
    const body = await drain(init.body);
    seen.push({ url: String(url), init, body });
    return reply({ json: receipt(payload.byteLength) });
  });
  try {
    const progress = [];
    const value = await local.uploadFile({
      sessionId: "session-1",
      path: file,
      name: "fixture.bin",
      onProgress: (bytes) => progress.push(bytes),
    });
    assert.equal(seen.length, 1);
    const target = new URL(seen[0].url);
    assert.equal(target.origin, ORIGIN);
    assert.equal(target.pathname, FILE_UPLOAD_PATH);
    assert.equal(target.searchParams.get("sessionId"), "session-1");
    assert.equal(target.searchParams.get("name"), "fixture.bin");
    assert.equal(seen[0].init.method, "POST");
    assert.equal(seen[0].init.headers["content-type"], "application/octet-stream");
    assert.equal(seen[0].init.headers.cookie, COOKIE);
    assert.equal(seen[0].init.duplex, "half");
    assert.equal(createHash("sha256").update(seen[0].body).digest("hex"),
      createHash("sha256").update(payload).digest("hex"));
    assert.deepEqual(value, receipt(payload.byteLength).value);
    // The last progress value is the whole file; every step is forward-only.
    assert.equal(progress.at(-1), payload.byteLength);
    assert.deepEqual([...progress].sort((a, b) => a - b), progress);
  } finally {
    await local.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a ~5 MiB file crosses as ordered bytes instead of a base64 envelope", async () => {
  const size = 5 * 1024 * 1024 + 123;
  const payload = Buffer.allocUnsafe(size);
  for (let index = 0; index < size; index += 1) payload[index] = (index * 31 + 7) & 0xff;
  const { dir, file } = await fixtureFile(payload);
  let received;
  let chunks = 0;
  const local = transport(async (url, init) => {
    const parts = [];
    for await (const chunk of init.body) {
      chunks += 1;
      parts.push(Buffer.from(chunk));
    }
    received = Buffer.concat(parts);
    return reply({ json: receipt(received.byteLength) });
  });
  try {
    const value = await local.uploadFile({ sessionId: "s", path: file, name: "big.bin" });
    assert.equal(value.file.bytes, size);
    assert.equal(received.byteLength, size);
    assert.equal(createHash("sha256").update(received).digest("hex"),
      createHash("sha256").update(payload).digest("hex"));
    // Ordered chunks, never one 5 MiB buffer.
    assert.ok(chunks > 1, `expected several chunks, saw ${chunks}`);
    assert.ok(chunks <= Math.ceil(size / 65536) + 1, `unexpected chunk count ${chunks}`);
  } finally {
    await local.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a zero-byte file still stages a receipt over an empty body", async () => {
  const { dir, file } = await fixtureFile(Buffer.alloc(0), "empty.bin");
  const seen = [];
  const local = transport(async (url, init) => {
    seen.push({ init, body: await drain(init.body) });
    return reply({ json: receipt(0, "empty.bin") });
  });
  try {
    const value = await local.uploadFile({ sessionId: "s", path: file, name: "empty.bin" });
    assert.equal(value.file.bytes, 0);
    assert.equal(seen[0].body.byteLength, 0);
    // No stream body, no duplex handshake: an empty byte body is enough.
    assert.equal(seen[0].init.duplex, undefined);
    assert.ok(seen[0].init.body instanceof Uint8Array);
  } finally {
    await local.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a Host refusal keeps its code and marks the upload as not staged", async () => {
  const { dir, file } = await fixtureFile(Buffer.from("tiny"));
  const local = transport(async () => reply({
    json: {
      ok: false,
      error: {
        code: "session/attachment-invalid",
        message: "Session is not live.",
        details: { sessionId: "s" },
      },
    },
  }));
  try {
    await assert.rejects(
      local.uploadFile({ sessionId: "s", path: file, name: "tiny.txt" }),
      (error) => {
        assert.equal(error.code, "session/attachment-invalid");
        assert.equal(error.rejected, true);
        assert.deepEqual(error.details, { sessionId: "s" });
        return true;
      },
    );
  } finally {
    await local.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("HTTP failures map to coded rejections instead of a silent success", async () => {
  const { dir, file } = await fixtureFile(Buffer.from("tiny"));
  const cases = [
    [401, "AUTH_REQUIRED"],
    [403, "PERMISSION_DENIED"],
    [404, "FEATURE_NOT_SUPPORTED"],
    [413, "REQUEST_TOO_LARGE"],
    [415, "PROTOCOL_ERROR"],
    [500, "UPLOAD_FAILED"],
  ];
  try {
    for (const [status, code] of cases) {
      const local = transport(async () => reply({ status, contentType: "text/plain", text: "no" }));
      await assert.rejects(
        local.uploadFile({ sessionId: "s", path: file, name: "tiny.txt" }),
        { code, rejected: true },
        `HTTP ${status}`,
      );
      await local.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unreadable answer or a byte-count mismatch is a protocol error", async () => {
  const { dir, file } = await fixtureFile(Buffer.from("0123456789"));
  try {
    const notJson = transport(async () => reply({ contentType: "text/plain", text: "ok" }));
    await assert.rejects(
      notJson.uploadFile({ sessionId: "s", path: file, name: "n.txt" }),
      { code: "PROTOCOL_ERROR" },
    );
    await notJson.close();

    const shortReceipt = transport(async () => reply({ json: receipt(3) }));
    await assert.rejects(
      shortReceipt.uploadFile({ sessionId: "s", path: file, name: "n.txt" }),
      { code: "PROTOCOL_ERROR" },
    );
    await shortReceipt.close();

    await assert.rejects(
      parseUploadResponse(reply({ json: { ok: true, value: { receiptId: "" } } })),
      { code: "PROTOCOL_ERROR" },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unreadable local path is refused before any request is sent", async () => {
  let calls = 0;
  const local = transport(async () => {
    calls += 1;
    return reply({ json: receipt(0) });
  });
  await assert.rejects(
    local.uploadFile({ sessionId: "s", path: join(tmpdir(), "native-dsh-absent-file"), name: "x" }),
    { code: "INVALID_LOCAL_UPLOAD_FILE" },
  );
  await assert.rejects(
    local.uploadFile({ sessionId: "", path: "/tmp/x", name: "x" }),
    { code: "INVALID_ARGUMENT" },
  );
  assert.equal(calls, 0);
  await local.close();
});

test("a directory is not an uploadable file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "native-dsh-local-upload-dir-"));
  const local = transport(async () => assert.fail("no request for a directory"));
  try {
    await assert.rejects(
      local.uploadFile({ sessionId: "s", path: dir, name: "dir" }),
      { code: "INVALID_LOCAL_UPLOAD_FILE" },
    );
  } finally {
    await local.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("uploadWorkspaceFile rides the local carrier and keeps its receipt shape", async () => {
  const { dir, file } = await fixtureFile(Buffer.alloc(70, 7));
  const rpcCalls = [];
  const uploads = [];
  const adapter = new RemoteAdapter();
  adapter.hostId = "local";
  adapter.interactionReady = true;
  adapter.sessionRows = [{ id: "session-1" }];
  adapter.connected = {
    client: {
      getStats: () => ({ mode: "Local" }),
      close: async () => {},
      rpc: async (method, params) => {
        rpcCalls.push(method);
        if (method === "harness.transport.describe")
          return { capabilities: ["workspace.upload.v1"] };
        throw new Error(`unexpected Remote carrier call ${method}`);
      },
      uploadFile: async (options) => {
        uploads.push(options);
        return {
          receiptId: "receipt-local-1",
          file: { attachmentId: "attachment-local-1", name: options.name, bytes: 70 },
        };
      },
    },
  };
  try {
    const params = {
      sessionId: "session-1",
      localPath: file,
      name: "chosen.txt",
      requestId: "local-upload-request-0001",
    };
    const first = await adapter.request("uploadWorkspaceFile", params);
    assert.equal(first.status, "accepted");
    assert.equal(first.name, "chosen.txt");
    assert.equal(first.bytes, 70);
    assert.equal(first.receiptId, "receipt-local-1");
    assert.deepEqual(first.file, {
      attachmentId: "attachment-local-1",
      name: "chosen.txt",
      bytes: 70,
    });
    assert.equal(first.requestId, "local-upload-request-0001");
    assert.equal(first.hostId, "local");
    assert.equal(first.connectionGeneration, adapter.connectionGeneration);
    assert.equal(first.semantics, "workspace-file-path-reference");
    assert.equal(first.composerAttachment, false);
    // The Remote chunker is never reached on the local carrier.
    assert.deepEqual(rpcCalls, ["harness.transport.describe"]);
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].sessionId, "session-1");
    assert.equal(uploads[0].path, file);
    assert.equal(uploads[0].name, "chosen.txt");
    assert.equal(typeof uploads[0].onProgress, "function");

    const second = await adapter.request("uploadWorkspaceFile", params);
    assert.deepEqual(second, first);
    assert.equal(uploads.length, 1, "one receipt per requestId");
    await assert.rejects(
      adapter.request("uploadWorkspaceFile", { ...params, name: "other.txt" }),
      { code: "REQUEST_ID_CONFLICT" },
    );
  } finally {
    await adapter.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a local refusal reaches the caller as a retryable rejection", async () => {
  const { dir, file } = await fixtureFile(Buffer.from("x"));
  const adapter = new RemoteAdapter();
  adapter.hostId = "local";
  adapter.interactionReady = true;
  adapter.sessionRows = [{ id: "session-1" }];
  const exchanged = [];
  adapter.connected = {
    client: {
      getStats: () => ({ mode: "Local" }),
      close: async () => {},
      rpc: async () => ({ capabilities: ["workspace.upload.v1"] }),
      uploadFile: async (options) => {
        exchanged.push(options);
        throw Object.assign(new Error("Session is not live."), {
          code: "session/attachment-invalid",
          details: {},
          rejected: true,
        });
      },
    },
  };
  try {
    await assert.rejects(
      adapter.request("uploadWorkspaceFile", {
        sessionId: "session-1",
        localPath: file,
        name: "x.txt",
        requestId: "local-upload-request-0002",
      }),
      { code: "session/attachment-invalid", delivery: "rejected" },
    );
  } finally {
    await adapter.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a local carrier still refuses the upload when the Host does not advertise it", async () => {
  const { dir, file } = await fixtureFile(Buffer.from("x"));
  const adapter = new RemoteAdapter();
  adapter.hostId = "local";
  adapter.interactionReady = true;
  adapter.sessionRows = [{ id: "session-1" }];
  adapter.connected = {
    client: {
      getStats: () => ({ mode: "Local" }),
      close: async () => {},
      rpc: async () => ({ capabilities: [] }),
      uploadFile: async () => assert.fail("capability gate must come first"),
    },
  };
  try {
    await assert.rejects(
      adapter.request("uploadWorkspaceFile", {
        sessionId: "session-1",
        localPath: file,
        name: "x.txt",
        requestId: "local-upload-request-0003",
      }),
      { code: "FEATURE_NOT_SUPPORTED" },
    );
  } finally {
    await adapter.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("a cancelled transfer stops reading and reports the caller's reason", async () => {
  const payload = Buffer.alloc(3 * 1024 * 1024, 9);
  const { dir, file } = await fixtureFile(payload);
  const local = transport(async (url, init) => {
    for await (const _chunk of init.body) {
      // Only the carrier drains the body; the abort below ends it.
    }
    return reply({ json: receipt(payload.byteLength) });
  });
  try {
    const stop = new AbortController();
    const reason = Object.assign(new Error("replaced"), { code: "CANCELLED" });
    await assert.rejects(
      local.uploadFile({
        sessionId: "s",
        path: file,
        name: "3mb.bin",
        signal: stop.signal,
        onProgress: (sent) => {
          if (sent >= 128 * 1024) stop.abort(reason);
        },
      }),
      (error) => error === reason,
    );
  } finally {
    await local.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a progress check fault survives the carrier's own wrapper", async () => {
  const payload = Buffer.alloc(256 * 1024, 1);
  const { dir, file } = await fixtureFile(payload);
  const local = transport(async (url, init) => {
    for await (const _chunk of init.body) {
      // Drains until the guard throws.
    }
    return reply({ json: receipt(payload.byteLength) });
  });
  try {
    await assert.rejects(
      local.uploadFile({
        sessionId: "s",
        path: file,
        name: "guard.bin",
        onProgress: () => {
          throw Object.assign(new Error("连接已经切换。"), {
            code: "STALE_CONNECTION",
            details: {},
          });
        },
      }),
      { code: "STALE_CONNECTION" },
    );
  } finally {
    await local.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a file truncated mid-transfer is refused instead of silently shortened", async () => {
  const payload = Buffer.alloc(512 * 1024, 2);
  const { dir, file } = await fixtureFile(payload);
  let truncated = false;
  const local = transport(async (url, init) => {
    for await (const _chunk of init.body) {
      // Drains until the shrunken file ends the stream.
    }
    return reply({ json: receipt(payload.byteLength) });
  });
  try {
    await assert.rejects(
      local.uploadFile({
        sessionId: "s",
        path: file,
        name: "shrinking.bin",
        onProgress: () => {
          if (truncated) return;
          truncated = true;
          writeFileSync(file, Buffer.alloc(1024, 2));
        },
      }),
      { code: "LOCAL_UPLOAD_FILE_CHANGED" },
    );
  } finally {
    await local.close();
    await rm(dir, { recursive: true, force: true });
  }
});
