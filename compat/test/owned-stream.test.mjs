import { test } from "node:test";
import assert from "node:assert/strict";
import { subscribeOwnedStream } from "../.test-build/owned-stream.mjs";
test("20 UI opens buffer first frame before RPC reply and release every listener", async () => {
  const listeners = new Set(),
    calls = [],
    ctx = {
      hostId: "h",
      sessionId: "s",
      connectionGeneration: 2,
      ownerId: "owner",
    };
  let frames = 0;
  for (let i = 0; i < 20; i++) {
    const transport = {
      subscribe: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      call: async (method, p) => {
        calls.push(method);
        if (method === "closeStream") return { closed: true };
        for (const receive of listeners)
          receive({
            method: "remoteStream",
            params: {
              ownerId: "owner",
              method,
              subscriptionId: "stream-" + i,
              frame: { type: "snapshot" },
            },
          });
        return { subscriptionId: "stream-" + i };
      },
    };
    const stream = subscribeOwnedStream(
      ctx,
      "watchSession",
      { sessionId: "s" },
      () => frames++,
      (e) => {
        throw e;
      },
      transport,
    );
    await stream.ready;
    assert.equal(frames, i + 1);
    stream.dispose();
    assert.equal(listeners.size, 0);
  }
  assert.equal(calls.filter((c) => c === "closeStream").length, 20);
});
test("failed open removes the pending listener and another owner cannot deliver content", async () => {
  const listeners = new Set(),
    ctx = {
      hostId: "h",
      sessionId: "s",
      connectionGeneration: 2,
      ownerId: "owner",
    };
  let frames = 0,
    errors = 0;
  const stream = subscribeOwnedStream(
    ctx,
    "watchSession",
    {},
    () => frames++,
    () => errors++,
    {
      subscribe: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      call: async (method) => {
        for (const receive of listeners)
          receive({
            method: "remoteStream",
            params: {
              ownerId: "other-owner",
              method,
              subscriptionId: "x",
              frame: { type: "snapshot" },
            },
          });
        throw Error("fixture open failure");
      },
    },
  );
  await stream.ready;
  assert.equal(frames, 0);
  assert.equal(errors, 1);
  assert.equal(listeners.size, 0);
});
