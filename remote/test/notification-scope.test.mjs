import test from "node:test";
import assert from "node:assert/strict";
import { RemoteAdapter } from "../client.mjs";
import { SessionProjection } from "../projection.mjs";

const deferred = () => Promise.withResolvers();
const configure = (adapter) => {
  adapter.hostId = "host";
  adapter.identityScope = "account-a";
  adapter.connectionGeneration = 2;
};
test("notifications retain their original account/Host generation after delivery is queued", async () => {
  const queue = [];
  const adapter = new RemoteAdapter((method, params, scope) =>
    queue.push({ method, params, scope }),
  );
  configure(adapter);
  adapter.sessionRows = [{ id: "old-session" }];
  adapter.emit("sessions", adapter.sessionRows);
  const original = adapter.notificationScope();
  adapter.identityScope = "account-b";
  adapter.connectionGeneration++;
  adapter.emit("sessions", [{ id: "new-session" }]);
  const current = adapter.notificationScope();
  assert.deepEqual(queue[0].scope, original);
  assert.notDeepEqual(original, current);
  assert.deepEqual(
    queue
      .filter(
        (event) => JSON.stringify(event.scope) === JSON.stringify(current),
      )
      .map((event) => event.params[0].id),
    ["new-session"],
  );
  assert.ok(Object.isFrozen(queue[0].scope));
});
test("late catalog result from a replaced account is discarded even on the same Host and generation", async () => {
  const adapter = new RemoteAdapter();
  configure(adapter);
  const result = deferred();
  adapter.gateway = { invoke: () => result.promise };
  const read = adapter.sessions();
  adapter.identityScope = "account-b";
  result.resolve({ items: [{ sessionId: "old" }] });
  await assert.rejects(read, (error) => error.code === "CANCELLED");
  assert.equal(adapter.sessionRows.length, 0);
});
test("scheduled publication is fenced by its captured scope and replaced selection can schedule immediately", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const notes = [];
  const adapter = new RemoteAdapter((method, params, scope) =>
    notes.push({ method, params, scope }),
  );
  configure(adapter);
  adapter.projection = new SessionProjection("old");
  adapter.scheduleSnapshot();
  adapter.identityScope = "account-b";
  adapter.connectionGeneration++;
  t.mock.timers.tick(16);
  assert.equal(notes.length, 0);
  adapter.projection = new SessionProjection("new");
  adapter.scheduleSnapshot();
  const scope = adapter.notificationScope();
  t.mock.timers.tick(16);
  assert.ok(notes.length > 0);
  assert.ok(
    notes.every((note) => JSON.stringify(note.scope) === JSON.stringify(scope)),
  );
});
test("late session frames cannot be relabelled to a new account", async () => {
  const notes = [];
  const adapter = new RemoteAdapter((method, params, scope) =>
    notes.push({ method, params, scope }),
  );
  configure(adapter);
  const opened = deferred(),
    next = deferred();
  adapter.gateway = {
    open: async () => {
      opened.resolve();
      return {
        async *[Symbol.asyncIterator]() {
          yield await next.promise;
        },
      };
    },
  };
  const projection = new SessionProjection("old");
  adapter.projection = projection;
  const run = adapter.consumeSession(
    projection,
    new AbortController(),
    deferred(),
  );
  await opened.promise;
  adapter.identityScope = "account-b";
  next.resolve({ type: "snapshot", cursor: 0, records: [] });
  await run;
  assert.equal(notes.length, 0);
  assert.equal(projection.cursor, -1);
});
