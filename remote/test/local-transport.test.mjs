import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  exchangeLaunchToken,
  LocalTransport,
  parseEnvelope,
  parseBinaryResponse,
} from "../local-transport.mjs";
import { LocalAdapter } from "../local-adapter.mjs";

const ORIGIN = "http://127.0.0.1:40123";

// A response stand-in: only what the carrier reads (status/headers/json/formData).
function reply({ status = 200, contentType = "application/json", json, text, setCookie, location, form }) {
  const entries = new Map();
  if (contentType) entries.set("content-type", contentType);
  if (setCookie) entries.set("set-cookie", [setCookie]);
  if (location) entries.set("location", location);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => {
        const value = entries.get(String(name).toLowerCase());
        return Array.isArray(value) ? value[0] : (value ?? null);
      },
      getSetCookie: () => entries.get("set-cookie") ?? [],
    },
    json: async () => json,
    text: async () => text ?? JSON.stringify(json),
    formData: async () => form,
  };
}

function envelope(rpcId, result) {
  return {
    type: "server-response",
    rpcId,
    result,
  };
}

function ok(result) {
  return reply({ json: result });
}

class FakeSocket extends EventEmitter {
  static instances = [];

  constructor(url, options) {
    super();
    this.url = url;
    this.options = options;
    this.sent = [];
    this.readyState = 1;
    this.OPEN = 1;
    FakeSocket.instances.push(this);
    queueMicrotask(() => this.emit("open"));
  }

  send(text) {
    this.sent.push(JSON.parse(text));
  }

  close() {
    this.readyState = 3;
    this.emit("close");
  }

  deliver(frame) {
    this.emit("message", JSON.stringify(frame));
  }
}

function transport(fetchImpl) {
  FakeSocket.instances = [];
  return new LocalTransport({
    origin: ORIGIN,
    cookie: "dsh_test=test-cookie",
    mux: new URL(`${ORIGIN}/api/remote.mux`),
    protocol: { parseRemoteStreamServerMessage: (text) => JSON.parse(text) },
    sockets: (url, options) => new FakeSocket(url, options),
    fetchImpl,
  });
}

test("the launch token exchanges for an answering API cookie and the mux path", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init });
    return reply({
      status: 302,
      contentType: undefined,
      location: "./api/remote.mux",
      setCookie: "dsh_test=test-cookie; Path=/; HttpOnly; SameSite=Strict",
    });
  };
  const handshake = await exchangeLaunchToken(
    `${ORIGIN}/?token=launch-token`,
    fetchImpl,
  );
  assert.equal(seen.length, 1);
  const connect = new URL(seen[0].url);
  assert.equal(connect.origin, ORIGIN);
  assert.equal(connect.pathname, "/connect");
  assert.equal(connect.searchParams.get("token"), "launch-token");
  // `answer` is what makes `$events` legal; `none` would be unary-only.
  assert.equal(connect.searchParams.get("interactions"), "answer");
  assert.equal(seen[0].init.redirect, "manual");
  assert.equal(handshake.cookie, "dsh_test=test-cookie");
  assert.equal(handshake.mux.href, `${ORIGIN}/api/remote.mux`);
});

test("a refused handshake fails before any RPC is attempted", async () => {
  const fetchImpl = async () => reply({ status: 401, contentType: undefined, text: "unauthorized" });
  await assert.rejects(
    exchangeLaunchToken(`${ORIGIN}/?token=stale`, fetchImpl),
    /HTTP 401/u,
  );
});

test("unary calls post the browser envelope to /api/<endpoint> and return its result", async () => {
  const calls = [];
  const local = transport(async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), init, body });
    return ok(envelope(body.rpcId, { ok: true, value: { items: [] } }));
  });
  const result = await local.rpc("harness.remote.call", {
    endpoint: "workspace/follow",
    payload: { args: {} },
  });
  assert.deepEqual(result, { ok: true, value: { items: [] } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${ORIGIN}/api/workspace/follow`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.cookie, "dsh_test=test-cookie");
  assert.equal(calls[0].init.headers["content-type"], "application/json");
  assert.equal(calls[0].body.type, "client-request");
  assert.equal(calls[0].body.method, "workspace/follow");
  assert.deepEqual(calls[0].body.payload, { args: {} });
});

test("a Host refusal crosses the carrier as the frozen result shape", async () => {
  const local = transport(async (url, init) => {
    const body = JSON.parse(init.body);
    return ok(
      envelope(body.rpcId, {
        ok: false,
        error: { code: "gateway/input-invalid", message: "bad", details: {} },
      }),
    );
  });
  const result = await local.rpc("harness.remote.call", {
    endpoint: "session/list",
    payload: { args: { _request: {} } },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "gateway/input-invalid");
});

test("a mismatched rpcId is a protocol error, never a business answer", async () => {
  const local = transport(async () => ok(envelope("someone-else", { ok: true })));
  await assert.rejects(
    local.rpc("harness.remote.call", {
      endpoint: "session/list",
      payload: { args: {} },
    }),
    { code: "PROTOCOL_ERROR" },
  );
});

test("an unauthenticated Host maps to AUTH_REQUIRED instead of a crash", async () => {
  const local = transport(async () => reply({ status: 401, contentType: undefined, text: "unauthorized" }));
  await assert.rejects(
    local.rpc("harness.remote.call", {
      endpoint: "session/list",
      payload: { args: {} },
    }),
    { code: "AUTH_REQUIRED" },
  );
});

test("endpoint paths cannot escape /api", async () => {
  const local = transport(async () => ok(envelope("x", { ok: true })));
  await assert.rejects(
    local.rpc("harness.remote.call", {
      endpoint: "../connect",
      payload: { args: {} },
    }),
    TypeError,
  );
});

test("stream open uses the documented mux frame and routes frames by stream", async () => {
  const local = transport(async () => assert.fail("no HTTP in this test"));
  const frames = [];
  local.onEvent((event) => frames.push(event));
  await local.rpc("harness.transport.describe", {});
  await local.rpc("harness.remote.stream.open", {
    streamId: "s1",
    endpoint: "$events",
    payload: { args: {} },
  });
  const socket = FakeSocket.instances.at(-1);
  assert.equal(socket.url, `${ORIGIN}/api/remote.mux`);
  assert.equal(socket.options.headers.cookie, "dsh_test=test-cookie");
  assert.deepEqual(socket.sent, [
    { type: "open", streamId: "s1", endpoint: "$events", payload: { args: {} } },
  ]);

  socket.deliver({ type: "item", streamId: "s1", value: { type: "ready" } });
  socket.deliver({ type: "item", streamId: "s2", value: 1 });
  socket.deliver({ type: "end", streamId: "s1" });
  socket.deliver({
    type: "error",
    streamId: "s3",
    error: { code: "gateway/cancelled", message: "x", details: {} },
  });

  assert.deepEqual(frames, [
    {
      event: "harness.remote.frame",
      data: { streamId: "s1", hasValue: true, value: { type: "ready" } },
    },
    { event: "harness.remote.frame", data: { streamId: "s2", hasValue: true, value: 1 } },
    {
      event: "harness.remote.stream.closed",
      data: { streamId: "s1", reason: "ended" },
    },
    {
      event: "harness.remote.stream.closed",
      data: {
        streamId: "s3",
        reason: "failed",
        failure: { code: "gateway/cancelled", message: "x", details: {} },
      },
    },
  ]);

  await local.rpc("harness.remote.stream.close", { streamId: "s1" });
  assert.deepEqual(socket.sent.at(-1), { type: "cancel", streamId: "s1" });

  let closed = 0;
  local.onClose(() => {
    closed += 1;
  });
  socket.close();
  assert.equal(closed, 1);
  await local.close();
  assert.equal(closed, 1, "close is idempotent for listeners");
});

test("a byte attachment is restored where the JSON placeholder stood", async () => {
  const form = new FormData();
  form.set(
    "metadata",
    JSON.stringify({
      type: "server-response",
      rpcId: "r1",
      result: { ok: true, value: { path: "a.txt", data: null } },
      attachments: [{ path: ["data"], codec: "bytes", part: "bytes-0" }],
    }),
  );
  form.set("bytes-0", new Blob([new Uint8Array([1, 2, 3])]));
  const parsed = await parseBinaryResponse(reply({ contentType: "multipart/form-data", form }));
  assert.equal(parsed.rpcId, "r1");
  assert.deepEqual(Array.from(parsed.result.value.data), [1, 2, 3]);
});

test("local mode advertises one Host and never asks for a server", async () => {
  const adapter = new LocalAdapter(() => {}, {
    url: `${ORIGIN}/?token=launch`,
    runtimeRoot: "build/runtime",
  });
  const devices = await adapter.devices();
  assert.deepEqual(
    devices.map((device) => device.id),
    ["local"],
  );
  const status = adapter.status();
  assert.equal(status.authorized, true);
  assert.equal(status.backend, "local-mux");
  assert.equal(status.serverUrl, ORIGIN);
  await adapter.close();
});

test("connecting to any host other than the local one is refused locally", async () => {
  const adapter = new LocalAdapter(() => {}, {
    url: `${ORIGIN}/?token=launch`,
    runtimeRoot: "build/runtime",
  });
  await assert.rejects(adapter.connect("some-remote-host"), {
    code: "HOST_NOT_FOUND",
    delivery: "rejected",
  });
  await adapter.close();
});
