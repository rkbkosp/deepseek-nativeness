// Explicit client wiring to the frozen Host's generated parameter names.
const needed = (p, key) => {
  if (
    p[key] === undefined ||
    p[key] === null ||
    (typeof p[key] === "string" && !p[key].trim())
  )
    throw Object.assign(new Error(`缺少 ${key}`), { code: "INVALID_ARGUMENT" });
  return p[key];
};
const take = (p, keys) =>
  Object.fromEntries(
    keys.filter((key) => p[key] !== undefined).map((key) => [key, p[key]]),
  );
const request =
  (keys, required = []) =>
  (p) => {
    for (const key of required) needed(p, key);
    return { request: take(p, keys) };
  };
const flat =
  (keys, required = []) =>
  (p) => {
    for (const key of required) needed(p, key);
    return take(p, keys);
  };
const r = (endpoint, args = () => ({}), extra = {}) => ({
  endpoint,
  mode: "read",
  args,
  ...extra,
});
const w = (endpoint, args, extra = {}) => ({
  endpoint,
  mode: "write",
  args,
  ...extra,
});
const agent = (p) => ({ agentId: needed(p, "sessionId") });
const file = (keys) => (p) => ({
  workspaceFileScopeId: needed(p, "sessionId"),
  path: p.path ?? "",
  ...take(p, keys),
});
export const OPERATIONS = {
  searchSessions: r("session/search", request(["query"], ["query"])),
  createSession: w(
    "session/create",
    request(["workspaceId", "cwd", "sessionId", "agentPreset"]),
  ),
  renameSession: w(
    "session/rename",
    request(["sessionId", "title"], ["sessionId", "title"]),
  ),
  forkSession: w(
    "session/fork",
    request(["sessionId", "atSeq", "allowMigration"], ["sessionId"]),
  ),
  updateQueue: w(
    "session/updateQueue",
    request(
      ["sessionId", "itemId", "action"],
      ["sessionId", "itemId", "action"],
    ),
  ),
  modelCatalog: r("session/modelCatalog"),
  selectModel: w(
    "session/selectModel",
    request(
      ["sessionId", "provider", "model", "reasoningEffort"],
      ["sessionId", "provider", "model"],
    ),
  ),
  sessionProjections: r(
    "session/projections",
    request(["sessionId"], ["sessionId"]),
  ),
  createWorkspace: w("workspace/create", request(["path"], ["path"])),
  renameWorkspace: w(
    "workspace/rename",
    request(["workspaceId", "title"], ["workspaceId", "title"]),
  ),
  deleteWorkspace: w(
    "workspace/delete",
    request(["workspaceId"], ["workspaceId"]),
  ),
  reorderWorkspace: w(
    "workspace/insertBefore",
    request(["workspaceId", "beforeWorkspaceId"], ["workspaceId"]),
  ),
  reorderSession: w(
    "workspace/insertSessionBefore",
    request(
      ["workspaceId", "sessionId", "beforeSessionId"],
      ["workspaceId", "sessionId"],
    ),
  ),
  archiveSession: w(
    "workspace/archiveSession",
    request(["sessionId", "stopActivity"], ["sessionId"]),
  ),
  unarchiveSession: w(
    "workspace/unarchiveSession",
    request(["sessionId"], ["sessionId"]),
  ),
  pinSession: w("workspace/pinSession", request(["sessionId"], ["sessionId"])),
  unpinSession: w(
    "workspace/unpinSession",
    request(["sessionId"], ["sessionId"]),
  ),
  listCommands: r("commands/list", agent),
  executeCommand: w("commands/execute", (p) => {
    const line = needed(p, "line");
    if (/^\/?export(?:\s|$)/.test(line))
      throw Object.assign(
        new Error(
          "Remote不提供原始Session日志下载资源；请使用明确标记的已加载片段导出。",
        ),
        { code: "UNSUPPORTED_REMOTE_RESOURCE" },
      );
    return { ...agent(p), line, submittedAttachments: [] };
  }),
  permissionCatalog: r("permissionPresets/catalog"),
  describeSettings: r("settings/describe"),
  updateSettings: w(
    "settings/update",
    flat(["ns", "patch", "expectedRevision"], ["ns", "patch"]),
    { hostSettings: true },
  ),
  replaceSettings: w(
    "settings/replace",
    flat(["ns", "section", "expectedRevision"], ["ns", "section"]),
    { hostSettings: true },
  ),
  mutateSettings: w(
    "settings/mutate",
    flat(["ns", "ops", "expectedRevision"], ["ns", "ops"]),
    { hostSettings: true },
  ),
  listFiles: r("workspaceFiles/list", (p) => ({
    ...file([])(p),
    path: p.path || ".",
  })),
  statFile: r("workspaceFiles/stat", file([])),
  readFile: r("workspaceFiles/read", (p) => ({
    ...file([])(p),
    range: p.range ?? {},
  })),
  readFileBytes: r("workspaceFiles/readBytes", (p) => ({
    ...file([])(p),
    options: p.options ?? {},
  })),
  readAttachment: r(
    "session/attachment",
    request(["sessionId", "attachment"], ["sessionId", "attachment"]),
  ),
  pluginInventory: r("pluginInventory/list"),
  listPlugins: r("pluginManager/listPlugins"),
  listBundles: r("pluginManager/listBundles"),
  listPluginVersions: r(
    "pluginManager/listVersions",
    flat(["name", "options"], ["name"]),
  ),
  readBundleDetail: r("pluginManager/readBundleDetail", (p) => ({
    name: needed(p, "name"),
    language: p.language ?? "zh",
    ...take(p, ["options"]),
  })),
  setPluginEnabled: w(
    "pluginManager/setPluginEnabled",
    flat(["id", "enabled"], ["id", "enabled"]),
    { pluginWrite: true },
  ),
  setBundleEnabled: w(
    "pluginManager/setBundleEnabled",
    flat(["name", "enabled"], ["name", "enabled"]),
    { pluginWrite: true },
  ),
  updateBundle: w(
    "pluginManager/updateBundle",
    flat(["name", "version", "options"], ["name", "version"]),
    {
      pluginWrite: true,
      blockedReason:
        "Remote0.6.4要求旧updatable:true，当前Host BundleInfo提供update字段；严格冻结下更新会被拒绝。",
    },
  ),
  listTerminals: r(
    "terminal/list",
    (p) => ({ sessionId: needed(p, "sessionId") }),
    { feature: "terminal" },
  ),
  terminalEnvironment: r("terminal/environment", agent, {
    feature: "terminal",
  }),
  terminalShells: r("terminal/shells", agent, { feature: "terminal" }),
  createTerminal: w(
    "terminal/create",
    (p) => ({ ...agent(p), request: needed(p, "terminal") }),
    { feature: "terminal" },
  ),
  renameTerminal: w(
    "terminal/rename",
    (p) => ({
      ...agent(p),
      id: needed(p, "terminalId"),
      title: needed(p, "title"),
    }),
    { feature: "terminal" },
  ),
  closeTerminal: w(
    "terminal/close",
    (p) => ({ ...agent(p), id: needed(p, "terminalId") }),
    { feature: "terminal" },
  ),
  writeTerminal: w(
    "terminal/write",
    (p) => ({
      ...agent(p),
      id: needed(p, "terminalId"),
      attachmentId: needed(p, "attachmentId"),
      data: needed(p, "data"),
    }),
    { feature: "terminal" },
  ),
  resizeTerminal: w(
    "terminal/resize",
    (p) => ({
      ...agent(p),
      id: needed(p, "terminalId"),
      attachmentId: needed(p, "attachmentId"),
      cols: needed(p, "cols"),
      rows: needed(p, "rows"),
    }),
    { feature: "terminal" },
  ),
  listAgentPresets: r("agentPresets/list"),
  readAgentPreset: r(
    "agentPresets/read",
    flat(["agentPreset"], ["agentPreset"]),
  ),
  selectAgentPreset: w("agentPresets/select", (p) => ({
    ...agent(p),
    agentPreset: needed(p, "agentPreset"),
  })),
  listProviders: r("llm/listProviders"),
  listConfigurableProviders: r("llm/listConfigurableProviders"),
  discoverModels: r(
    "llm/discoverModels",
    flat(["settingsNs", "request"], ["settingsNs", "request"]),
  ),
  describeCredentials: r("credentials/describe", flat(["refs"], ["refs"])),
  setCredential: w("credentials/set", flat(["ref", "value"], ["ref", "value"])),
  unsetCredential: w("credentials/unset", flat(["ref"], ["ref"])),
  listDirectories: r("directoryPicker/list", flat(["path"])),
  listFileReferences: r("fileReferences/list", (p) => ({
    ...agent(p),
    query: p.query ?? "",
  })),
  listSkills: r("skills/list", request(["sessionId"], ["sessionId"])),
  listFeedback: r(
    "messageFeedback/list",
    request(["sessionId"], ["sessionId"]),
  ),
  putFeedback: w(
    "messageFeedback/put",
    request(
      ["sessionId", "messageId", "rating", "note", "category", "ifVersion"],
      ["sessionId", "messageId", "rating"],
    ),
  ),
  deleteFeedback: w(
    "messageFeedback/delete",
    request(
      ["sessionId", "messageId", "ifVersion"],
      ["sessionId", "messageId", "ifVersion"],
    ),
  ),
  scheduleCatalog: r("schedule/catalog"),
  scheduleDeliveryLimits: r("schedule/deliveryLimits"),
  listSchedules: r("schedule/list", request(["active", "limit", "offset"])),
  scheduleHistory: r(
    "schedule/history",
    request(["id", "limit", "before"], ["id", "limit"]),
  ),
  createSchedule: w(
    "schedule/create",
    request(
      ["title", "prompt", "timing", "target"],
      ["title", "prompt", "timing"],
    ),
    {
      blockedReason:
        "Remote0.6.4截获创建为旧schedule.create(sessionId,request)，与当前Host typed timing/target接口不兼容。",
    },
  ),
  editSchedule: w("schedule/edit", (p) => ({ request: needed(p, "request") })),
  runSchedule: w("schedule/run", request(["id"], ["id"])),
  deleteInactiveSchedules: w("schedule/deleteInactive", () => ({})),
  createGoal: w("goals/create", (p) => ({
    ...agent(p),
    request: needed(p, "request"),
  })),
  editGoal: w("goals/edit", (p) => ({
    ...agent(p),
    ref: needed(p, "ref"),
    request: needed(p, "request"),
  })),
  pauseGoal: w("goals/pause", (p) => ({ ...agent(p), ref: needed(p, "ref") })),
  resumeGoal: w("goals/resume", (p) => ({
    ...agent(p),
    ref: needed(p, "ref"),
  })),
  completeGoal: w("goals/complete", (p) => ({
    ...agent(p),
    ref: needed(p, "ref"),
  })),
  clearGoal: w("goals/clear", (p) => ({ ...agent(p), ref: needed(p, "ref") })),
  promptSubagent: w("subagents/prompt", (p) => ({
    request: needed(p, "request"),
  })),
  killJob: w(
    "job/kill",
    request(["sessionId", "jobId"], ["sessionId", "jobId"]),
  ),
  sessionEvents: r("session/events", (p) => ({
    request: needed(p, "request"),
  })),
  initializeDefaultModel: w("session/initializeDefaultModel", () => ({})),
  canOpenWorkspacePath: r("session/canOpenWorkspacePath"),
  workspacePathApplications: r(
    "session/workspacePathApplications",
    request(["path"], ["path"]),
  ),
  watchSession: r(
    "session/follow",
    (p) => ({
      request: {
        address: { kind: "session", sessionId: needed(p, "sessionId") },
        maxMessages: 80,
        assistantStream: true,
      },
    }),
    { stream: true },
  ),
  sessionPage: r("session/page", (p) => ({
    request: {
      address: { kind: "session", sessionId: needed(p, "sessionId") },
      ...take(p, ["beforeSeq", "throughSeq", "maxMessages"]),
    },
  })),
  watchJobs: r("job/list", request(["sessionId"], ["sessionId"]), {
    stream: true,
  }),
  watchJob: r("job/follow", (p) => ({ request: needed(p, "request") }), {
    stream: true,
  }),
  watchToolResult: r(
    "toolResults/watch",
    (p) => ({ request: needed(p, "request") }),
    { stream: true },
  ),
  watchFile: r("workspaceFiles/changes", file([]), { stream: true }),
  watchTerminal: r(
    "terminal/follow",
    (p) => ({
      ...agent(p),
      id: needed(p, "terminalId"),
      attachmentId: needed(p, "attachmentId"),
    }),
    { stream: true, feature: "terminal" },
  ),
  retainTerminal: r(
    "terminal/retain",
    (p) => ({ sessionId: needed(p, "sessionId"), id: needed(p, "terminalId") }),
    { stream: true, feature: "terminal" },
  ),
};
export function operationArgs(method, params) {
  const operation = OPERATIONS[method];
  if (!operation)
    throw Object.assign(new Error("客户端尚未接入此操作。"), {
      code: "UNSUPPORTED_OPERATION",
    });
  if (
    operation.hostSettings &&
    ["ds-harness-remote", "dsh-remote"].includes(params.ns)
  )
    throw Object.assign(new Error("Remote连接配置只能在Host本机管理。"), {
      code: "REMOTE_NAMESPACE_FROZEN",
    });
  if (
    operation.pluginWrite &&
    (params.name ?? "").includes("ds-harness-remote")
  )
    throw Object.assign(new Error("Remote插件只能在Host本机管理。"), {
      code: "REMOTE_PLUGIN_FROZEN",
    });
  return operation.args(params);
}
