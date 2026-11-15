import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { OPERATIONS, operationArgs } from "../operations.mjs";
import { RemoteAdapter } from "../client.mjs";
import { LocalAdapter } from "../local-adapter.mjs";
import { LocalTransport } from "../local-transport.mjs";

const ORIGIN = "http://127.0.0.1:40125";
// Local mode has no account credential: this is the shape of the Host's own
// launch-token exchange result, so a fixture literal is enough.
const COOKIE = "dsh-local-session=fixture";

// A response stand-in: only what the unary carrier reads.
function reply({ status = 200, contentType = "application/json", json }) {
  const entries = new Map();
  if (contentType) entries.set("content-type", contentType);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => entries.get(String(name).toLowerCase()) ?? null },
    json: async () => json,
    text: async () => JSON.stringify(json),
  };
}

function envelope(rpcId, result) {
  return { type: "server-response", rpcId, result };
}

/** A transport whose mux never opens: every case here is a unary call. */
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
    protocol: { parseRemoteStreamServerMessage: (text) => JSON.parse(text) },
    sockets: () => new IdleSocket(),
    fetchImpl,
  });
}

/**
 * Wire shapes of the endpoints this batch wired, taken from the Host's own
 * generated descriptors (`@deepseek-ai/<package>/lib/typert.host.js`). Every parameter
 * name below is the descriptor's `wire` name, not the Node method's argument
 * name — the two differ for the `lookup` parameters (`agent` → `agentId`,
 * `workspaceFileScope` → `workspaceFileScopeId`).
 */
const WIRE_CASES = [
  // A. Host-exposed endpoints the client did not wire yet.
  [
    "initializeDefaultWorkspace",
    {},
    "workspace/initializeDefault",
    {},
  ],
  [
    "renderOfficeToPdf",
    { sessionId: "s", path: "docs/a.docx" },
    "officeKit/render",
    { workspaceFileScopeId: "s", path: "docs/a.docx", priority: "foreground" },
  ],
  [
    "renderOfficeToPdf",
    { sessionId: "s", path: "a.xlsx", priority: "background" },
    "officeKit/render",
    { workspaceFileScopeId: "s", path: "a.xlsx", priority: "background" },
  ],
  ["officePdfGeneration", {}, "officeKit/generation", {}],
  [
    "interruptSubagent",
    { childSessionId: "child-1" },
    "subagents/interruptByUser",
    { childSessionId: "child-1" },
  ],
  [
    "followQuestionWait",
    { sessionId: "s", callId: "call-1" },
    "userQuestions/attachWait",
    { agentId: "s", callId: "call-1" },
  ],
  ["followRemoteAccess", {}, "remoteAccess/follow", {}],
  // `schedule/update` and `schedule/delete` are the `update`/`delete` actions
  // of `schedule/edit`; the Host has no endpoints by those names.
  [
    "updateSchedule",
    { id: "task-1", patch: { timing: { kind: "every", every_seconds: 60 } } },
    "schedule/edit",
    {
      request: {
        id: "task-1",
        action: "update",
        patch: { timing: { kind: "every", every_seconds: 60 } },
      },
    },
  ],
  [
    "updateSchedule",
    { id: "task-1", patch: { title: "t" }, expectedUpdatedAt: "2026-11-15T00:00:00.000Z" },
    "schedule/edit",
    {
      request: {
        id: "task-1",
        action: "update",
        patch: { title: "t" },
        expectedUpdatedAt: "2026-11-15T00:00:00.000Z",
      },
    },
  ],
  [
    "deleteSchedule",
    { id: "task-1" },
    "schedule/edit",
    { request: { id: "task-1", action: "delete" } },
  ],
  // B. Frozen-Remote gaps the local Host serves itself.
  [
    "createSchedule",
    {
      title: "t",
      prompt: "p",
      timing: { kind: "daily", daily: { time: "09:00:00", time_zone: "Asia/Shanghai" } },
      target: { kind: "new_once" },
    },
    "schedule/create",
    {
      request: {
        title: "t",
        prompt: "p",
        timing: { kind: "daily", daily: { time: "09:00:00", time_zone: "Asia/Shanghai" } },
        target: { kind: "new_once" },
      },
    },
  ],
  [
    "searchWorkspaceFiles",
    { sessionId: "s", query: "needle" },
    "workspaceFiles/search",
    {
      workspaceFileScopeId: "s",
      request: {
        query: "needle",
        excludedPaths: [],
        includeHidden: false,
        respectGitignore: true,
      },
    },
  ],
  [
    "searchWorkspaceFiles",
    {
      sessionId: "s",
      query: "a/",
      excludedPaths: ["dist"],
      includeHidden: true,
      respectGitignore: false,
    },
    "workspaceFiles/search",
    {
      workspaceFileScopeId: "s",
      request: {
        query: "a/",
        excludedPaths: ["dist"],
        includeHidden: true,
        respectGitignore: false,
      },
    },
  ],
  ["listWebProviders", {}, "web/listProviders", {}],
  ["pluginMarketIndexes", {}, "pluginMarket/listIndexes", {}],
  [
    "searchPluginMarket",
    { url: "https://index.example/i.json", query: { text: "pdf" } },
    "pluginMarket/search",
    { url: "https://index.example/i.json", query: { text: "pdf" } },
  ],
  [
    "readPluginMarketEntry",
    { url: "https://index.example/i.json", name: "dsh-pdf", version: "1.2.0" },
    "pluginMarket/readEntryDetail",
    {
      url: "https://index.example/i.json",
      name: "dsh-pdf",
      version: "1.2.0",
      language: "zh",
    },
  ],
  ["installBundle", { spec: "dsh-pdf@1.2.0" }, "pluginManager/installBundle", { spec: "dsh-pdf@1.2.0" }],
  ["removeBundle", { name: "dsh-pdf" }, "pluginManager/removeBundle", { name: "dsh-pdf" }],
  [
    "updateBundle",
    { name: "dsh-pdf", version: "1.2.1" },
    "pluginManager/updateBundle",
    { name: "dsh-pdf", version: "1.2.1" },
  ],
  [
    "setTeamEnabled",
    { sessionId: "s", enabled: true },
    "agentTeams/setEnabled",
    { agentId: "s", enabled: true },
  ],
];

test("every wired endpoint sends the descriptor's wire names", () => {
  for (const [method, params, endpoint, args] of WIRE_CASES) {
    const operation = OPERATIONS[method];
    assert.ok(operation !== undefined, `${method} has no operation entry`);
    assert.equal(operation.endpoint, endpoint, `${method} endpoint`);
    assert.deepEqual(operationArgs(method, params), args, `${method} args`);
  }
});

test("each wired entry posts its args to /api/<endpoint> on the local carrier", async () => {
  const calls = [];
  const local = transport(async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), body });
    return reply({ json: envelope(body.rpcId, { ok: true, value: {} }) });
  });
  try {
    for (const [method, params, endpoint, args] of WIRE_CASES) {
      calls.length = 0;
      await local.rpc("harness.remote.call", {
        endpoint,
        payload: { args: operationArgs(method, params) },
      });
      assert.equal(calls.length, 1, `${method} made one call`);
      assert.equal(calls[0].url, `${ORIGIN}/api/${endpoint}`, method);
      assert.equal(calls[0].body.type, "client-request");
      assert.equal(calls[0].body.method, endpoint);
      assert.deepEqual(calls[0].body.payload.args, args, `${method} body.args`);
    }
  } finally {
    await local.close();
  }
});

test("argument validation refuses before any call is made", () => {
  assert.throws(
    () => operationArgs("updateSchedule", { id: "t", patch: {} }),
    { code: "INVALID_ARGUMENT" },
  );
  assert.throws(() => operationArgs("deleteSchedule", {}), {
    code: "INVALID_ARGUMENT",
  });
  assert.throws(
    () => operationArgs("renderOfficeToPdf", { sessionId: "s", path: "a", priority: "now" }),
    { code: "INVALID_ARGUMENT" },
  );
  assert.throws(
    () => operationArgs("searchWorkspaceFiles", { sessionId: "s", query: "  " }),
    { code: "INVALID_ARGUMENT" },
  );
  assert.throws(
    () => operationArgs("setTeamEnabled", { sessionId: "s", enabled: "yes" }),
    { code: "INVALID_ARGUMENT" },
  );
  assert.throws(
    () => operationArgs("searchPluginMarket", { url: "https://i/x.json" }),
    { code: "INVALID_ARGUMENT" },
  );
  assert.throws(
    () => operationArgs("readPluginMarketEntry", { url: "https://i/x.json", name: "n" }),
    { code: "INVALID_ARGUMENT" },
  );
  // The genuinely absent Host endpoints stay unimplemented instead of
  // pretending to exist.
  for (const method of ["listSubagents", "readAllFiles", "readRelatedFiles", "watchClaudeCodeBand", "pressClaudeCodeBand", "answerQuestion"])
    assert.equal(OPERATIONS[method], undefined, method);
});

/** One adapter bound to a fake carrier: the access snapshot is the owner. */
function adapterOf(Type) {
  const adapter = new Type(() => {}, {
    url: `${ORIGIN}/?token=launch`,
    runtimeRoot: "build/runtime",
  });
  const invoked = [];
  adapter.hostId = "local";
  adapter.interactionReady = true;
  adapter.connected = {
    client: {
      rpc: async (method) =>
        method === "harness.transport.describe"
          ? { capabilities: ["workspace.upload.v1"] }
          : assert.fail(`unexpected carrier call ${method}`),
      getStats: () => ({ mode: "Local" }),
      close: async () => {},
    },
    features: {},
  };
  adapter.gateway = {
    async *open() {
      yield { type: "baseline", owner: true };
    },
    invoke: async (request) => {
      invoked.push(request);
      return methodResult(request);
    },
    dispatch: async (endpoint, payload) => {
      invoked.push({ endpoint, args: payload.args });
      return { ok: true, value: { accepted: true } };
    },
  };
  return { adapter, invoked };
}

function methodResult({ method }) {
  if (method === "list") return [{ name: "export" }, { name: "model" }];
  return { ok: true };
}

const GAP_OPERATIONS = [
  "createSchedule",
  "updateBundle",
  "installBundle",
  "removeBundle",
  "pluginMarketIndexes",
  "searchPluginMarket",
  "readPluginMarketEntry",
  "setTeamEnabled",
  "listWebProviders",
  "searchWorkspaceFiles",
];

test("a gap the frozen Remote refuses is refused on the remote carrier, unchanged", async () => {
  const { adapter, invoked } = adapterOf(RemoteAdapter);
  try {
    const capabilities = await adapter.request("capabilities", {});
    for (const method of GAP_OPERATIONS) {
      assert.equal(capabilities.operations[method], false, method);
      assert.match(capabilities.details[method].reason, /冻结|Remote|allowlist/u, method);
      await assert.rejects(adapter.request(method, gapParams(method)), {
        code: "FROZEN_REMOTE_INCOMPATIBLE",
        delivery: "rejected",
      });
    }
    assert.deepEqual(invoked, [], "no refusal reached the Host");
    // The frozen resource list still names the two resources Remote cannot proxy.
    assert.ok(capabilities.unsupported.includes("rawSessionLogDownload"));
    assert.ok(capabilities.unsupported.includes("workspaceFileSearch"));
    assert.equal(capabilities.operations.exportSessionZip, false);
    assert.equal(capabilities.details.exportSessionZip.reason, "Remote缺少原始日志下载资源");
    assert.equal(capabilities.operations.readDetailImage, false);
  } finally {
    await adapter.close();
  }
});

test("the local carrier serves those gaps and reaches the Host's own route", async () => {
  const { adapter, invoked } = adapterOf(LocalAdapter);
  try {
    const capabilities = await adapter.request("capabilities", {});
    for (const method of GAP_OPERATIONS)
      assert.equal(capabilities.operations[method], true, method);
    for (const method of [
      "exportSessionZip",
      "readDetailImage",
      "updateSchedule",
      "deleteSchedule",
      "interruptSubagent",
      "followQuestionWait",
      "followRemoteAccess",
      "renderOfficeToPdf",
      "officePdfGeneration",
      "initializeDefaultWorkspace",
    ])
      assert.equal(capabilities.operations[method], true, method);
    assert.ok(!capabilities.unsupported.includes("rawSessionLogDownload"));
    assert.ok(!capabilities.unsupported.includes("workspaceFileSearch"));
    // Everything the local carrier still cannot do stays listed.
    assert.ok(capabilities.unsupported.includes("arbitraryPluginPage"));
    assert.ok(capabilities.unsupported.includes("workspaceFileWrite"));

    await adapter.request("searchWorkspaceFiles", {
      sessionId: "s",
      query: "needle",
    });
    assert.equal(invoked.length, 1);
    assert.equal(invoked[0].namespace, "workspaceFiles");
    assert.equal(invoked[0].method, "search");
    assert.equal(invoked[0].args.workspaceFileScopeId, "s");

    await adapter.request("pluginMarketIndexes", {});
    await adapter.request("listWebProviders", {});
    await adapter.request("officePdfGeneration", {});
    assert.deepEqual(
      invoked.slice(1).map((row) => `${row.namespace}/${row.method}`),
      ["pluginMarket/listIndexes", "web/listProviders", "officeKit/generation"],
    );
  } finally {
    await adapter.close();
  }
});

test("local writes keep the read-only and interaction gates", async () => {
  const { adapter, invoked } = adapterOf(LocalAdapter);
  try {
    adapter.readOnly = true;
    await assert.rejects(
      adapter.request("installBundle", { spec: "dsh-pdf@1.2.0", requestId: "local-install-000001" }),
      { code: "READ_ONLY" },
    );
    adapter.readOnly = false;
    adapter.interactionReady = false;
    await assert.rejects(
      adapter.request("setTeamEnabled", {
        sessionId: "s",
        enabled: false,
        requestId: "local-team-request-0001",
      }),
      { code: "INTERACTIONS_UNAVAILABLE" },
    );
    assert.deepEqual(invoked, []);
    // The frozen Remote plugin may never be managed from any carrier.
    adapter.interactionReady = true;
    await assert.rejects(
      adapter.request("removeBundle", {
        name: "ds-harness-remote",
        requestId: "local-remove-remote-0001",
      }),
      { code: "REMOTE_PLUGIN_FROZEN" },
    );
  } finally {
    await adapter.close();
  }
});

test("local command list drops the Remote-only export warning", async () => {
  const local = adapterOf(LocalAdapter);
  const remote = adapterOf(RemoteAdapter);
  try {
    const localCommands = await local.adapter.request("listCommands", { sessionId: "s" });
    assert.deepEqual(localCommands, [{ name: "export" }, { name: "model" }]);
    const remoteCommands = await remote.adapter.request("listCommands", { sessionId: "s" });
    assert.deepEqual(remoteCommands, [
      { name: "export", clientUnavailableReason: "Remote缺少原始日志下载资源" },
      { name: "model" },
    ]);
  } finally {
    await local.adapter.close();
    await remote.adapter.close();
  }
});

function gapParams(method) {
  switch (method) {
    case "createSchedule":
      return {
        title: "t",
        prompt: "p",
        timing: { kind: "every", every_seconds: 60 },
        requestId: "gap-create-schedule-0001",
      };
    case "updateBundle":
    case "installBundle":
    case "removeBundle":
    case "setTeamEnabled":
      return {
        name: "dsh-pdf",
        version: "1.2.0",
        spec: "dsh-pdf@1.2.0",
        sessionId: "s",
        enabled: true,
        requestId: "gap-plugin-request-0001",
      };
    case "searchWorkspaceFiles":
      return { sessionId: "s", query: "needle" };
    case "searchPluginMarket":
      return { url: "https://index.example/i.json", query: { text: "" } };
    case "readPluginMarketEntry":
      return { url: "https://index.example/i.json", name: "dsh-pdf", version: "1.2.0" };
    default:
      return {};
  }
}