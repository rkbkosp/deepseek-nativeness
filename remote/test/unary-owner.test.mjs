import test from "node:test";
import assert from "node:assert/strict";
import { RemoteAdapter } from "../client.mjs";
const pending = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

test("late unary values from a retired owner or Host are rejected before conversion or delivery", async () => {
  for (const retire of ["owner", "host"]) {
    const adapter = new RemoteAdapter();
    adapter.hostId = "fixture-host";
    adapter.projection = { sessionId: "fixture-session" };
    const deferred = pending();
    let invoked = false,
      signal;
    adapter.gateway = {
      invoke: async (request) => {
        invoked = true;
        signal = request.signal;
        return deferred.promise;
      },
    };
    await adapter.request("registerOwner", {
      ownerId: "fixture-owner",
      clientScope: {
        hostId: "fixture-host",
        generation: adapter.connectionGeneration,
        sessionId: "fixture-session",
      },
    });
    const scope = {
      hostId: "fixture-host",
      generation: adapter.connectionGeneration,
      sessionId: "fixture-session",
      ownerId: "fixture-owner",
    };
    const read = adapter.request("readFileBytes", {
      sessionId: "fixture-session",
      path: "fixture",
      clientScope: scope,
    });
    assert.equal(invoked, true);
    if (retire === "owner") adapter.closeOwnerStreams("fixture-owner");
    else {
      adapter.hostId = "other-host";
      adapter.connectionGeneration++;
    }
    let converted = false;
    deferred.resolve({
      get data() {
        converted = true;
        throw Error("retired payload converted");
      },
    });
    await assert.rejects(read, (error) => error.code === "STALE_CONTEXT");
    assert.equal(converted, false);
    if (retire === "owner") assert.equal(signal.aborted, true);
  }
});
