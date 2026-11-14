import test from "node:test";
import assert from "node:assert/strict";
import { createModelSettings } from "../.test-build/model-settings.mjs";
import { createAgentPresets } from "../.test-build/agent-presets.mjs";
import { createAutomation } from "../.test-build/automation.mjs";
import { createPageRpc } from "../.test-build/rpc-adapter.mjs";

const ctx = {
  hostId: "fixture-host",
  sessionId: "fixture-session",
  connectionGeneration: 7,
  ownerId: "fixture-owner",
  operations: {
    updateSettings: true,
    mutateSettings: true,
    setCredential: true,
    unsetCredential: true,
    editSchedule: true,
    runSchedule: true,
    deleteInactiveSchedules: true,
  },
};
const accepted = (params, value) => ({
  status: "accepted",
  requestId: params.requestId,
  hostId: ctx.hostId,
  connectionGeneration: ctx.connectionGeneration,
  value,
});
const namespace = (ns, value, revision = 9) => ({
  ns,
  value,
  revision,
  base: {},
  schema: { type: "object", dict: {} },
  secrets: [],
  applies: "live",
  autoGenerate: true,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test("original model settings store joins provider/credential facts and uses fenced writes", async () => {
  const calls = [];
  const modelNs = namespace("llm-fixture", { apiKeyEnv: "FIXTURE_API_KEY" });
  const face = createModelSettings(ctx, async (method, params) => {
    calls.push({ method, params });
    assert.deepEqual(params.clientScope, {
      hostId: ctx.hostId,
      sessionId: ctx.sessionId,
      generation: 7,
      ownerId: ctx.ownerId,
    });
    if (method === "listProviders")
      return [{ id: "fixture", name: "Fixture Provider" }];
    if (method === "listConfigurableProviders")
      return [
        {
          provider: "fixture",
          displayName: "Fixture Provider",
          settingsNs: "llm-fixture",
          settingsPath: [],
        },
      ];
    if (method === "describeSettings")
      return { writable: true, hasDocument: true, namespaces: [modelNs] };
    if (method === "describeCredentials")
      return { FIXTURE_API_KEY: { configured: false, writable: true } };
    if (method === "mutateSettings")
      return accepted(params, { ...modelNs, revision: 10 });
    if (method === "setCredential" || method === "unsetCredential")
      return accepted(params, undefined);
    throw Error(method);
  });
  await face.controller.load();
  const snapshot = face.controller.store.getSnapshot();
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.rows[0].entry.displayName, "Fixture Provider");
  assert.equal(snapshot.rows[0].credential.configured, false);
  assert.equal(snapshot.namespaces.get("llm-fixture").revision, 9);
  const result = await face.operations.writeSettings(
    "llm-fixture",
    [{ op: "set", path: ["baseURL"], value: "https://fixture.invalid" }],
    9,
  );
  assert.equal(result.kind, "written");
  assert.equal(
    calls.find((call) => call.method === "mutateSettings").params
      .expectedRevision,
    9,
  );
  assert.equal(
    await face.operations.storeCredential(
      "FIXTURE_API_KEY",
      "fixture-only-literal",
    ),
    undefined,
  );
  assert.equal(
    await face.operations.removeCredential("FIXTURE_API_KEY"),
    undefined,
  );
  face.dispose();
});

test("original preset controller writes selectedDefault with the mirror revision and reads declarations", async () => {
  const calls = [];
  let selected = "standard";
  const face = createAgentPresets(ctx, async (method, params) => {
    calls.push({ method, params });
    if (method === "listAgentPresets")
      return {
        presets: [
          {
            id: "standard",
            name: "Standard",
            isDefault: selected === "standard",
          },
          { id: "fixture", name: "Fixture", isDefault: selected === "fixture" },
        ],
      };
    if (method === "describeSettings")
      return {
        writable: true,
        hasDocument: true,
        namespaces: [
          namespace("agent-preset-registry", { selectedDefault: selected }),
          namespace("ui-settings", { enabled: true }),
        ],
      };
    if (method === "readAgentPreset")
      return { name: "Fixture", content: "plugins:\n  - fixture" };
    if (method === "updateSettings") {
      selected = params.patch.selectedDefault;
      return accepted(
        params,
        namespace(params.ns, { selectedDefault: selected }, 10),
      );
    }
    throw Error(method);
  });
  await Promise.all([face.controller.load(), face.mirror.ensure()]);
  await face.controller.makeDefault("fixture");
  const write = calls.find((call) => call.method === "updateSettings");
  assert.deepEqual(write.params.patch, { selectedDefault: "fixture" });
  assert.equal(write.params.ns, "agent-preset-registry");
  assert.equal(write.params.expectedRevision, 9);
  assert.equal(
    face.controller.store.getSnapshot().rows.find((row) => row.id === "fixture")
      .isDefault,
    true,
  );
  await face.controller.view("fixture");
  assert.equal(
    face.controller.store.getSnapshot().view.content,
    "plugins:\n  - fixture",
  );
  face.dispose();
});

test("disposing model and preset owners fences late controller and mirror publications", async () => {
  for (const create of [createModelSettings, createAgentPresets]) {
    const pending = deferred();
    let updates = 0;
    const face = create(ctx, () => pending.promise);
    face.controller.store.subscribe(() => updates++);
    const load = Promise.all([face.controller.load(), face.mirror.ensure()]);
    face.dispose();
    const baseline = face.controller.store.getSnapshot(),
      mirrorBaseline = face.mirror.getSnapshot(),
      count = updates;
    pending.resolve([]);
    await load;
    assert.equal(face.controller.store.getSnapshot(), baseline);
    assert.equal(face.mirror.getSnapshot(), mirrorBaseline);
    assert.equal(updates, count);
  }
});

test("closing a page before its queued write reaches the binding never dispatches", async () => {
  let calls = 0;
  const rpc = createPageRpc(ctx, async () => {
    calls++;
    return {};
  });
  const pending = rpc.write("mutateSettings", {
    ns: "fixture",
    ops: [],
    expectedRevision: 1,
  });
  rpc.dispose();
  assert.equal((await pending).error.delivery, "rejected");
  assert.equal(calls, 0);
});

test("uncertain owner intents do not resend, explicit rejection permits a new attempt, and secrets stay out of errors", async () => {
  let calls = 0;
  const rpc = createPageRpc(ctx, async () => {
    calls++;
    return { status: "unknown" };
  });
  const a = await rpc.write("setCredential", {
    ref: "FIXTURE_API_KEY",
    value: "fixture-only-literal",
  });
  const b = await rpc.write("setCredential", {
    ref: "FIXTURE_API_KEY",
    value: "fixture-only-literal",
  });
  assert.equal(a, b);
  assert.equal(calls, 1);
  const rejected = createPageRpc(ctx, async () => {
    calls++;
    throw Object.assign(Error("Rejected fixture-only-literal"), {
      code: "credential/rejected",
      delivery: "rejected",
    });
  });
  const error = await rejected.write("setCredential", {
    ref: "FIXTURE_API_KEY",
    value: "fixture-only-literal",
  });
  assert.equal(JSON.stringify(error).includes("fixture-only-literal"), false);
  await rejected.write("setCredential", {
    ref: "FIXTURE_API_KEY",
    value: "fixture-only-literal",
  });
  assert.equal(calls, 3);
  rpc.dispose();
  rejected.dispose();
});

test("original schedule catalog, editor, CAS action/history adapters and close cleanup share one owner", async () => {
  const calls = [],
    listeners = new Set();
  let rows = [
    { id: "fixture-schedule", title: "Fixture", updatedAt: "revision-1" },
  ];
  const face = createAutomation(
    { ...ctx, sessions: [], workspaces: [] },
    async (method, params) => {
      calls.push({ method, params });
      if (method === "scheduleCatalog") return rows;
      if (method === "scheduleDeliveryLimits")
        return { newSessionIntervalSeconds: 60 };
      if (method === "scheduleHistory")
        return {
          id: params.id,
          records: [],
          earlierRecordsUnavailable: false,
          earlierRecordsPruned: false,
        };
      if (method === "editSchedule") {
        assert.ok(["delete", "update"].includes(params.request.action));
        if (params.request.action === "delete") {
          rows = [];
          return accepted(params, { deleted: true });
        }
        return accepted(params, rows[0]);
      }
      if (method === "runSchedule") return accepted(params, {});
      if (method === "deleteInactiveSchedules")
        return accepted(params, { deleted: 0 });
      throw Error(method);
    },
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  );
  const off = face.catalog.hooks.catalog.subscribe(() => {});
  await face.catalog.onRetry();
  assert.equal(face.catalog.hooks.catalog.getSnapshot().records.length, 1);
  assert.equal(
    await face.hostActions.edit({
      id: "fixture-schedule",
      action: "update",
      expectedUpdatedAt: "revision-1",
      patch: { title: "Edited" },
    }),
    "saved",
  );
  assert.equal(await face.hostActions.run("fixture-schedule"), "queued");
  assert.equal(await face.hostActions.loadNewSessionInterval(), 60);
  assert.equal(
    (await face.loadHistory({ id: "fixture-schedule", limit: 20 })).ok,
    true,
  );
  face.editor.actions.setDraft("task:fixture-schedule", {
    draft: { title: "Retained draft" },
  });
  assert.equal(
    face.editor.getSnapshot().drafts["task:fixture-schedule"].draft.title,
    "Retained draft",
  );
  assert.equal(await face.onDelete("fixture-schedule"), "deleted");
  assert.equal(
    calls.some((call) => call.method === "createSchedule"),
    false,
  );
  assert.equal(listeners.size, 1);
  face.dispose();
  off();
  assert.equal(listeners.size, 0);
});
