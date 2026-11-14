import test from "node:test";
import assert from "node:assert/strict";
import { RemoteAdapter } from "../client.mjs";

test("existing events stream forwards only scoped invalidation names without payloads", async () => {
  const notifications = [];
  const adapter = new RemoteAdapter((method, params) =>
    notifications.push({ method, params }),
  );
  adapter.hostId = "fixture-host";
  adapter.connectionGeneration = 8;
  adapter.gateway = {
    open: async function* () {
      yield { type: "ready", clientId: "fixture-client" };
      yield {
        type: "emit",
        event: "settings/document-updated",
        args: [{ secret: "fixture-never-forward" }],
      };
      yield {
        type: "emit",
        event: "unrelated/private",
        args: ["fixture-never-forward"],
      };
    },
  };
  const ready = Promise.withResolvers();
  await assert.rejects(
    adapter.consumeEvents(new AbortController().signal, ready),
    (error) => error.code === "EVENT_STREAM_CLOSED",
  );
  await ready.promise;
  assert.deepEqual(notifications, [
    {
      method: "remoteInvalidation",
      params: {
        event: "settings/document-updated",
        hostId: "fixture-host",
        connectionGeneration: 8,
      },
    },
  ]);
  assert.equal(
    JSON.stringify(notifications).includes("fixture-never-forward"),
    false,
  );
});
