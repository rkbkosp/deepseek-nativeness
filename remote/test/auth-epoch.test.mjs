import test from "node:test";
import assert from "node:assert/strict";
import { RemoteAdapter } from "../client.mjs";
const setup = async () => {
  const notes = [];
  const adapter = new RemoteAdapter((method, params, scope) =>
    notes.push({ method, params, scope }),
  );
  let account = "old-account";
  adapter.identity = { deviceId: "fixture-device" };
  adapter.credentials = { load: async () => ({ account }) };
  adapter.server = {
    baseUrl: "fixture://local",
    close() {},
    hasStoredAuthorization: async () => true,
    authorizeWithAccount: async () => {
      account = "new-account";
    },
    pollOAuthQrLogin: async () => {
      account = "qr-account";
      return { status: "complete" };
    },
  };
  await adapter.refreshIdentityScope();
  adapter.authenticated = true;
  adapter.connectionGeneration = 7;
  adapter.hostId = "fixture-host";
  adapter.connected = {
    client: { getStats: () => ({ mode: "Fixture" }), close: async () => {} },
  };
  adapter.notifyStatus("old");
  notes.length = 0;
  return {
    adapter,
    notes,
    setAccount: (value) => {
      account = value;
    },
  };
};
test("actual account login returns an authoritative epoch newer than every old-account status", async () => {
  const { adapter, notes } = await setup();
  const oldScope = adapter.identityScope;
  const reply = await adapter.request("login", {
    email: "fixture",
    password: "fixture",
  });
  const old = notes.filter(
    (note) => note.method === "status" && note.scope.accountScope === oldScope,
  );
  const fresh = notes
    .filter(
      (note) =>
        note.method === "status" &&
        note.scope.accountScope === reply.identityScope,
    )
    .at(-1);
  assert.ok(old.length > 0);
  assert.ok(fresh);
  assert.ok(
    old.every((note) => note.scope.generation < reply.connectionGeneration),
  );
  assert.equal(fresh.scope.generation, reply.connectionGeneration);
  assert.equal(reply.connected, false);
  assert.equal(reply.hostId, "");
  assert.equal(reply.accountScope, reply.identityScope);
  // RPC callback can run first: the queued old status is now strictly stale.
  let accepted = reply;
  for (const note of [...old, fresh])
    if (note.scope.generation >= accepted.connectionGeneration)
      accepted = note.params;
  assert.equal(accepted.identityScope, reply.identityScope);
  await adapter.close();
});
test("QR account replacement retires the old carrier and data; same-principal refresh preserves epoch", async () => {
  const { adapter, notes } = await setup();
  const oldGeneration = adapter.connectionGeneration;
  adapter.projection = { sessionId: "old-private-session" };
  adapter.sessionRows = [{ id: "old" }];
  adapter.workspaceRows = [{ id: "old" }];
  const reply = await adapter.request("pollQr", { qrId: "fixture" });
  assert.equal(reply.status, "complete");
  assert.ok(reply.connectionGeneration > oldGeneration + 1);
  assert.equal(adapter.connected, undefined);
  assert.equal(adapter.projection, undefined);
  assert.equal(adapter.sessionRows.length, 0);
  assert.equal(adapter.workspaceRows.length, 0);
  const before = adapter.connectionGeneration;
  await adapter.refreshIdentityScope();
  assert.equal(adapter.connectionGeneration, before);
  const auth = await adapter.request("authStatus");
  assert.equal(auth.connectionGeneration, before);
  assert.equal(auth.identityScope, reply.identityScope);
  assert.ok(
    notes.filter((note) => note.method === "status").at(-1).scope.generation ===
      before,
  );
  await adapter.close();
});
