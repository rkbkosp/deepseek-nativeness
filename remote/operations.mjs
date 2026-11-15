// Explicit client wiring to the frozen Host's generated parameter names.
//
// Each entry names one Host endpoint and the exact payload the generated
// descriptor declares. Three optional markers decide who may call it:
//
//   blockedReason  the frozen Remote carrier cannot serve this endpoint (its
//                  allowlist or its legacy interception refuses it); the reason
//                  is shown to the user. The remote behaviour is unchanged.
//   localAllowed   the local carrier reaches the Host's own `/api/<endpoint>`
//                  route, so the frozen allowlist does not apply. Only an entry
//                  with this marker is reachable in local mode despite a
//                  `blockedReason`; the remote path still refuses it.
//   feature        a Host capability flag the carrier must advertise.
//
// Nothing here inspects the carrier: `client.mjs` decides, so the remote
// defaults stay the frozen ones.
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
const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);
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
  forkSession: w("session/fork", (p) => {
    needed(p, "sessionId");
    if (
      p.atSeq !== undefined &&
      (!Number.isSafeInteger(p.atSeq) || p.atSeq < 0)
    )
      throw Object.assign(Error("atSeq必须是非负安全整数"), {
        code: "INVALID_ARGUMENT",
      });
    if (p.allowMigration !== undefined && typeof p.allowMigration !== "boolean")
      throw Object.assign(Error("allowMigration必须是boolean"), {
        code: "INVALID_ARGUMENT",
      });
    return { request: take(p, ["sessionId", "atSeq", "allowMigration"]) };
  }),
  readSessionEvents: r(
    "session/events",
    request(["address", "throughSeq", "beforeSeq", "maxMessages"], ["address"]),
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
  // First-use default Workspace; the Host fixes the directory name, so this is
  // idempotent and never relocates an existing default.
  initializeDefaultWorkspace: w("workspace/initializeDefault", () => ({})),
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
  // Office preview: `render` converts one workspace file to PDF bytes through
  // the Session's ordinary filesystem authorization; `generation` is the
  // cache generation the Client compares before reusing a PDF it already has.
  renderOfficeToPdf: r("officeKit/render", (p) => {
    needed(p, "sessionId");
    const priority = p.priority ?? "foreground";
    if (!["foreground", "background"].includes(priority))
      throw Object.assign(Error("priority只能是foreground或background"), {
        code: "INVALID_ARGUMENT",
      });
    return {
      workspaceFileScopeId: p.sessionId,
      path: needed(p, "path"),
      priority,
    };
  }),
  officePdfGeneration: r("officeKit/generation", () => ({})),
  // Packaged ripgrep over one Session's workspace scope. All four request
  // members are required by the descriptor, so the defaults are sent.
  searchWorkspaceFiles: r(
    "workspaceFiles/search",
    (p) => {
      needed(p, "sessionId");
      const query = needed(p, "query");
      if (typeof query !== "string" || !query.trim())
        throw Object.assign(Error("query必须是非空文本"), {
          code: "INVALID_ARGUMENT",
        });
      if (p.excludedPaths !== undefined && !Array.isArray(p.excludedPaths))
        throw Object.assign(Error("excludedPaths必须是数组"), {
          code: "INVALID_ARGUMENT",
        });
      return {
        workspaceFileScopeId: p.sessionId,
        request: {
          query,
          excludedPaths: p.excludedPaths ?? [],
          includeHidden: p.includeHidden === true,
          respectGitignore: p.respectGitignore !== false,
        },
      };
    },
    {
      blockedReason: "冻结Remote未把文件搜索列入allowlist。",
      localAllowed: true,
    },
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
      localAllowed: true,
    },
  ),
  // Install/remove run the real pnpm lifecycle, so the caller confirms first.
  // The frozen Remote never exposed them; the local Host owns the profile.
  installBundle: w(
    "pluginManager/installBundle",
    flat(["spec", "options"], ["spec"]),
    {
      pluginWrite: true,
      blockedReason: "Remote未开放安装生命周期。",
      localAllowed: true,
    },
  ),
  removeBundle: w("pluginManager/removeBundle", flat(["name"], ["name"]), {
    pluginWrite: true,
    blockedReason: "Remote未开放卸载生命周期。",
    localAllowed: true,
  }),
  // Plugin market (Discover): index sources, then paged search and long
  // descriptions. `url` is one configured index, as `pluginMarketIndexes`
  // reports it.
  pluginMarketIndexes: r("pluginMarket/listIndexes", () => ({}), {
    blockedReason: "Remote没有插件市场发现接口。",
    localAllowed: true,
  }),
  searchPluginMarket: r(
    "pluginMarket/search",
    (p) => {
      const url = needed(p, "url");
      if (typeof url !== "string")
        throw Object.assign(Error("url必须是索引地址"), {
          code: "INVALID_ARGUMENT",
        });
      if (!isPlainObject(p.query))
        throw Object.assign(Error("query必须是对象"), {
          code: "INVALID_ARGUMENT",
        });
      return { url, query: p.query };
    },
    { blockedReason: "Remote没有插件市场发现接口。", localAllowed: true },
  ),
  readPluginMarketEntry: r(
    "pluginMarket/readEntryDetail",
    (p) => {
      needed(p, "url");
      needed(p, "name");
      needed(p, "version");
      return {
        url: p.url,
        name: p.name,
        version: p.version,
        language: p.language ?? "zh",
        ...take(p, ["options"]),
      };
    },
    { blockedReason: "Remote没有插件市场发现接口。", localAllowed: true },
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
  // Web search/fetch provider catalog (distinct namespace from llm providers):
  // availability does not filter the list, so it stays a pure read.
  listWebProviders: r("web/listProviders", () => ({}), {
    blockedReason: "冻结Remote未列入web provider目录。",
    localAllowed: true,
  }),
  // Root Session Team switch; the projection that reads the current selection
  // is already wired, only this write was outside the frozen allowlist.
  setTeamEnabled: w(
    "agentTeams/setEnabled",
    (p) => {
      needed(p, "sessionId");
      if (typeof p.enabled !== "boolean")
        throw Object.assign(Error("enabled必须是boolean"), {
          code: "INVALID_ARGUMENT",
        });
      return { agentId: p.sessionId, enabled: p.enabled };
    },
    { blockedReason: "Remote allowlist缺少Team写入接口。", localAllowed: true },
  ),
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
  listSessionReferences: r("sessionReferenceResolver/candidates", (p) => ({
    ...agent(p),
    query: p.query ?? "",
  })),
  listSkills: r("skills/list", request(["sessionId"], ["sessionId"])),
  listFeedback: r(
    "messageFeedback/list",
    request(["sessionId"], ["sessionId"]),
  ),
  putFeedback: w("messageFeedback/put", (p) => feedbackArgs(p, false)),
  deleteFeedback: w("messageFeedback/delete", (p) => feedbackArgs(p, true)),
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
      localAllowed: true,
    },
  ),
  editSchedule: w("schedule/edit", (p) => ({ request: needed(p, "request") })),
  // The Host has no `schedule/update` or `schedule/delete`: both are the
  // `update` / `delete` actions of `schedule/edit`, whose `patch` is the same
  // typed shape `createSchedule` takes. A miss or an `expectedUpdatedAt`
  // conflict comes back as a non-mutating result, never as a silent success.
  updateSchedule: w("schedule/edit", (p) => {
    needed(p, "id");
    const patch = p.patch;
    if (!isPlainObject(patch) || Object.keys(patch).length === 0)
      throw Object.assign(Error("patch必须是非空对象"), {
        code: "INVALID_ARGUMENT",
      });
    return {
      request: {
        id: p.id,
        action: "update",
        patch,
        ...take(p, ["expectedUpdatedAt"]),
      },
    };
  }),
  deleteSchedule: w("schedule/edit", (p) => ({
    request: {
      id: needed(p, "id"),
      action: "delete",
      ...take(p, ["expectedUpdatedAt"]),
    },
  })),
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
  // The Host's own name is `subagents/interruptByUser`: the caller is the
  // Session that owns the child, addressed by the child's Session id.
  interruptSubagent: w(
    "subagents/interruptByUser",
    flat(["childSessionId"], ["childSessionId"]),
  ),
  // Hold one live timed wait for an answer UI; closing the stream releases the
  // claim. The reply itself is steered through `$events/result`, which is
  // already wired as `answerQuestions`, so no duplicate `userQuestions/answer`
  // entry exists here.
  followQuestionWait: r(
    "userQuestions/attachWait",
    (p) => ({ agentId: needed(p, "sessionId"), callId: needed(p, "callId") }),
    { stream: true },
  ),
  // The calling Peer's access snapshot: one baseline, then upsert/remove
  // frames. `capabilities()` already consumes the baseline; this entry lets a
  // panel follow later grant changes.
  followRemoteAccess: r("remoteAccess/follow", () => ({}), { stream: true }),
  // Not wired because the shipped Host exposes no such descriptor (checked in
  // `build/runtime/dsh/node_modules/@deepseek-ai/*/lib/typert.host.js`):
  //   subagents/list           — no endpoint; child Sessions come from the
  //                              Session projection the client already holds.
  //   workspaceFiles/readAll   — `readFile` with an empty `range` is the whole
  //   workspaceFiles/readRelated  file; no "related files" endpoint exists.
  //   claudeCodeMods/watchBand — the mods service is not part of the runtime
  //   claudeCodeMods/pressBand   tree (only the frozen endpoint allowlist
  //                              names it), so a call cannot be served.
  //   userQuestions/answer     — duplicate of the wired `$events/result` path.
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

function feedbackArgs(p, deleting) {
  needed(p, "sessionId");
  needed(p, "messageId");
  if (
    !(typeof p.ifVersion === "string" && p.ifVersion.trim()) &&
    (deleting || p.ifVersion !== null)
  )
    throw Object.assign(Error("ifVersion必须是已观察版本；新反馈显式传null"), {
      code: "INVALID_ARGUMENT",
    });
  if (!deleting) {
    if (!["positive", "negative"].includes(p.rating))
      throw Object.assign(Error("rating必须是positive或negative"), {
        code: "INVALID_ARGUMENT",
      });
    if (p.note !== undefined && (typeof p.note !== "string" || !p.note.trim()))
      throw Object.assign(Error("note必须是非空文本或省略"), {
        code: "INVALID_ARGUMENT",
      });
    if (
      p.category !== undefined &&
      ![
        "task-result",
        "instruction-following",
        "product-interaction",
        "service-stability",
        "resource-cost",
        "security-privacy-permission",
        "other",
      ].includes(p.category)
    )
      throw Object.assign(Error("未知feedback category"), {
        code: "INVALID_ARGUMENT",
      });
  }
  return {
    request: take(
      p,
      deleting
        ? ["sessionId", "messageId", "ifVersion"]
        : ["sessionId", "messageId", "rating", "note", "category", "ifVersion"],
    ),
  };
}
