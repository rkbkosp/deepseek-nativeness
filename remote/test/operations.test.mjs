import { test } from "node:test";
import assert from "node:assert/strict";
import { RemoteAdapter } from "../client.mjs";
import { operationArgs } from "../operations.mjs";
test("frozen descriptors keep flat settings and lookup-scoped files", () => {
  assert.deepEqual(operationArgs("listFiles", { sessionId: "s", path: "" }), {
    workspaceFileScopeId: "s",
    path: ".",
  });
  assert.deepEqual(
    operationArgs("readFile", { sessionId: "s", path: "README.md" }),
    { workspaceFileScopeId: "s", path: "README.md", range: {} },
  );
  assert.deepEqual(
    operationArgs("updateSettings", {
      ns: "theme",
      patch: { enabled: false },
      expectedRevision: 2,
    }),
    { ns: "theme", patch: { enabled: false }, expectedRevision: 2 },
  );
  assert.throws(
    () =>
      operationArgs("updateSettings", { ns: "ds-harness-remote", patch: {} }),
    { code: "REMOTE_NAMESPACE_FROZEN" },
  );
  assert.throws(
    () => operationArgs("executeCommand", { sessionId: "s", line: "/export" }),
    { code: "UNSUPPORTED_REMOTE_RESOURCE" },
  );
});
test("new operations use actual ledger envelope and refuse writes on read-only connection", async () => {
  const a = new RemoteAdapter();
  a.hostId = "h";
  a.interactionReady = true;
  const calls = [];
  a.gateway = {
    dispatch: async (endpoint, payload) => {
      calls.push({ endpoint, payload });
      return { ok: true, value: {} };
    },
  };
  const p = {
    sessionId: "s",
    title: "new title",
    requestId: "fixture-rename-0000001",
  };
  await a.request("renameSession", p);
  await a.request("renameSession", p);
  assert.deepEqual(calls, [
    {
      endpoint: "session/rename",
      payload: { args: { request: { sessionId: "s", title: "new title" } } },
    },
  ]);
  a.readOnly = true;
  await assert.rejects(
    a.request("pinSession", {
      sessionId: "s",
      requestId: "fixture-pin-00000001",
    }),
    { code: "READ_ONLY" },
  );
  assert.equal(calls.length, 1);
  await a.close();
});
test("workspace-scoped reads never replace the all-workspace sidebar notification", async () => {
  const notes = [];
  const a = new RemoteAdapter((method, params) =>
    notes.push({ method, params }),
  );
  a.workspaceRows = [
    { workspaceId: "w1", sessionIds: ["s1"] },
    { workspaceId: "w2", sessionIds: ["s2"] },
  ];
  a.workspaceId = "w1";
  a.gateway = {
    invoke: async () => ({
      items: [
        {
          sessionId: "s1",
          blank: false,
          projections: {
            values: {
              title: "one",
              agentPreset: "preset",
              modelSelection: { provider: "p", model: "m" },
            },
          },
        },
        { sessionId: "s2", blank: true, projections: { values: {} } },
      ],
    }),
  };
  assert.equal((await a.sessions()).length, 1);
  assert.equal(a.sessionRows.length, 2);
  assert.equal(notes.at(-1).params.length, 2);
  assert.equal(a.sessionRows[0].preset, "preset");
  assert.deepEqual(a.sessionRows[0].model, { provider: "p", model: "m" });
  assert.equal((await a.sessions({ all: true })).length, 2);
  await a.close();
});
test("Host settings fields are flat, revision-fenced, and unknown receipts are not retried", async () => {
  const a = new RemoteAdapter();
  a.interactionReady = true;
  a.hostId = "h";
  const calls = [];
  a.gateway = {
    dispatch: async (endpoint, payload) => {
      calls.push({ endpoint, payload });
      throw Error("lost receipt");
    },
  };
  for (const [ns, key, value] of [
    ["permission", "defaultPreset", "read-only"],
    ["session-log-deepseek", "enabled", false],
  ]) {
    const p = {
      ns,
      ops: [{ op: "set", path: [key], value }],
      expectedRevision: 4,
      requestId: "fixture-settings-" + ns,
    };
    const receipt = await a.request("mutateSettings", p);
    assert.equal(receipt.status, "unknown");
    await a.request("mutateSettings", p);
    assert.deepEqual(calls.at(-1), {
      endpoint: "settings/mutate",
      payload: { args: { ns, ops: p.ops, expectedRevision: 4 } },
    });
  }
  assert.equal(calls.length, 2);
  await a.close();
});
test("prompt forwards queue/steer mode and refuses unknown modes before dispatch", async () => {
  const a = new RemoteAdapter();
  a.interactionReady = true;
  a.sessionRows = [{ id: "s" }];
  const calls = [];
  a.gateway = {
    dispatch: async (endpoint, payload) => {
      calls.push(payload);
      return { ok: true, value: {} };
    },
  };
  await a.request("sendMessage", {
    sessionId: "s",
    text: "fixture only",
    mode: "steer",
    requestId: "fixture-steer-000001",
  });
  assert.equal(calls[0].args.request.mode, "steer");
  await assert.rejects(
    a.request("sendMessage", {
      sessionId: "s",
      text: "fixture only",
      mode: "invalid",
      requestId: "fixture-steer-000002",
    }),
    { code: "INVALID_MODE" },
  );
  assert.equal(calls.length, 1);
  await a.close();
});
test("compat scope refuses a queued old Host before the first dispatch", async () => {
  const a = new RemoteAdapter();
  a.interactionReady = true;
  a.hostId = "old";
  a.connectionGeneration = 4;
  a.projection = { sessionId: "s" };
  let writes = 0;
  a.gateway = {
    dispatch: async () => {
      writes++;
      return { ok: true, value: {} };
    },
  };
  const pending = a.request("mutateSettings", {
    ns: "permission",
    ops: [],
    requestId: "scope-fixture-write-1",
    clientScope: { hostId: "old", sessionId: "s", generation: 4 },
  });
  a.hostId = "new";
  a.connectionGeneration = 5;
  a.gateway = {
    dispatch: async () => {
      writes++;
      return { ok: true, value: {} };
    },
  };
  await assert.rejects(pending, { code: "STALE_CONTEXT" });
  assert.equal(writes, 0);
  await assert.rejects(
    a.request("mutateSettings", {
      ns: "permission",
      ops: [],
      requestId: "scope-fixture-write-2",
      clientScope: { hostId: "old", sessionId: "s", generation: 4 },
    }),
    { code: "STALE_CONTEXT" },
  );
  assert.equal(writes, 0);
  a.projection = undefined;
  await a.close();
});
test("local validation and an explicit Host rejection are distinguished from unknown delivery", async () => {
  const a = new RemoteAdapter();
  a.interactionReady = true;
  a.gateway = {
    dispatch: async () => ({
      ok: false,
      error: { code: "settings/conflict", message: "revision changed" },
    }),
  };
  await assert.rejects(
    a.request("mutateSettings", {
      ns: "permission",
      ops: [],
      expectedRevision: 1,
      requestId: "fixture-conflict-0001",
    }),
    { code: "settings/conflict", delivery: "rejected" },
  );
  await assert.rejects(
    a.request("renameSession", {
      sessionId: "s",
      requestId: "fixture-invalid-0001",
    }),
    { code: "INVALID_ARGUMENT", delivery: "rejected" },
  );
  await a.close();
});
test("frozen carrier incompatibilities are rejected before any Host write", async () => {
  const a = new RemoteAdapter();
  a.interactionReady = true;
  let writes = 0;
  a.gateway = {
    dispatch: async () => {
      writes++;
      return { ok: true, value: {} };
    },
  };
  await assert.rejects(
    a.request("createSchedule", {
      title: "fixture",
      prompt: "fixture",
      timing: { kind: "once" },
      requestId: "fixture-schedule-blocked",
    }),
    { code: "FROZEN_REMOTE_INCOMPATIBLE", delivery: "rejected" },
  );
  await assert.rejects(
    a.request("updateBundle", {
      name: "fixture-plugin",
      version: "1.0.0",
      requestId: "fixture-plugin-update-blocked",
    }),
    { code: "FROZEN_REMOTE_INCOMPATIBLE", delivery: "rejected" },
  );
  assert.equal(writes, 0);
  await a.close();
});
