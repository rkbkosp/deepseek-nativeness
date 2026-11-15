import test from "node:test";
import assert from "node:assert/strict";
import { RemoteAdapter } from "../client.mjs";

// The helper's catalog is a snapshot of the Host's list read. The Host clears a
// Session's blank flag on turn/start, but the cached row keeps the value it had
// before the Turn, and only a selected blank row is listed. The status event is
// the earliest signal the helper gets, so it must clear blank there — otherwise
// a reader who switches away loses the row until another list read happens.
function fixture(statuses) {
  const notifications = [];
  const adapter = new RemoteAdapter((method, params) =>
    notifications.push({ method, params }),
  );
  adapter.hostId = "fixture-host";
  adapter.connectionGeneration = 8;
  adapter.sessionRows = [
    { id: "session-a", blank: true, running: false, updatedAt: 5 },
    { id: "session-b", blank: false, running: false, updatedAt: 9 },
  ];
  adapter.gateway = {
    open: async function* () {
      yield { type: "ready", clientId: "fixture-client" };
      for (const args of statuses)
        yield { type: "emit", event: "api-session/status", args };
    },
  };
  return { adapter, notifications };
}

async function drain({ adapter }) {
  const ready = Promise.withResolvers();
  await assert.rejects(
    adapter.consumeEvents(new AbortController().signal, ready),
    (error) => error.code === "EVENT_STREAM_CLOSED",
  );
  await ready.promise;
}

test("a started Turn clears the cached row's blank flag", async () => {
  const f = fixture([["session-a", true]]);
  await drain(f);
  const pushes = f.notifications.filter((n) => n.method === "sessions");
  assert.equal(pushes.length, 1);
  const row = pushes[0].params.find((r) => r.id === "session-a");
  assert.equal(row.blank, false);
  assert.equal(row.running, true);
  assert.ok(row.updatedAt > 5, "the row kept its pre-Turn activity stamp");
  // Another Session keeps its blank flag.
  assert.equal(pushes[0].params.find((r) => r.id === "session-b").blank, false);
});

test("the end of a Turn never restores blank", async () => {
  const f = fixture([
    ["session-a", true],
    ["session-a", false],
  ]);
  await drain(f);
  const pushes = f.notifications.filter((n) => n.method === "sessions");
  assert.equal(pushes.length, 2);
  for (const push of pushes) {
    assert.equal(push.params.find((r) => r.id === "session-a").blank, false);
  }
  assert.equal(f.adapter.sessionRows[0].running, false);
  // The second push is a state change, not a new prompt: it must not bump the
  // activity stamp again.
  const first = pushes[0].params.find((r) => r.id === "session-a").updatedAt;
  const last = pushes[1].params.find((r) => r.id === "session-a").updatedAt;
  assert.equal(last, first);
});
