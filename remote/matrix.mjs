import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OPERATIONS } from "./operations.mjs";
const root = dirname(fileURLToPath(import.meta.url));
/** `--reference <path>` repoints at another pinned ds-harness-remote checkout. */
const referenceFlag = process.argv.indexOf("--reference");
const reference = resolve(
  root,
  referenceFlag >= 0 && process.argv[referenceFlag + 1]
    ? process.argv[referenceFlag + 1]
    : "../remote_reference",
);
const source = await readFile(
  resolve(reference, "packages/plugin/src/harness-remote-bridge.ts"),
  "utf8",
);
/** Never record a pin the checkout does not actually carry. */
function referenceCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: reference, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}
const remoteCommit = referenceCommit();
const dshCommit =
  process.env.DSH_COMMIT ?? "9c2670d3bce5275e0d1610272958121af87787bb";
const section = source.match(
  /export const HARNESS_REMOTE_ALLOWLIST = \[([\s\S]*?)\] as const/,
)[1];
const endpoints = [...section.matchAll(/^\s*'([^']+)'/gm)].map(
  (match) => match[1],
);
const wired = new Map(
  Object.entries(OPERATIONS).map(([method, op]) => [op.endpoint, method]),
);
const core = {
  $events: "internal interaction channel",
  "session/control": "internal Native composer projection stream",
  "session/list": "sessions",
  "workspace/follow": "workspaces",
  "session/page": "history",
  "session/follow": "openSession",
  "session/prompt": "sendMessage",
  "session/cancel": "cancel",
  "$events/result": "answerApproval/answerQuestions",
};
const gaps = [
  [
    "scheduleCreate",
    "schedule/create",
    "Frozen Remote intercepts legacy schedule.create(sessionId,request), incompatible with current Host typed timing/target API",
  ],
  [
    "updateBundle",
    "pluginManager/updateBundle",
    "Frozen Remote requires updatable:true; current Host reports update registry/git instead",
  ],
  [
    "teamModeWrite",
    "agentTeams/setEnabled",
    "Remote allowlist omits this API; current Team projection can be read",
  ],
  [
    "webProviderCatalog",
    "web/listProviders",
    "Remote allowlist omits provider discovery; settings sections remain readable",
  ],
  [
    "pluginDiscover",
    "pluginMarket/*",
    "Remote has no market discovery API; tab shown disabled when Host enabled it",
  ],
  ["sessionDelete", "session/delete", "Remote未开放且冻结Host无此通用入口"],
  ["markRead/unread", "sessionStatus/mark", "Remote allowlist无此API"],
  [
    "install/uninstallPlugin",
    "pluginManager/install/uninstall",
    "Remote未开放安装及卸载生命周期",
  ],
  [
    "arbitraryPluginPage",
    "frontend modules/static route",
    "无通用静态模块/资源代理；compat只能本地pin具体组件",
  ],
  [
    "originalRawSessionLogDownload",
    "GET /api/session.export",
    "仅commands/export返回请求，实际资源GET不在Remote carrier",
  ],
  ["fileSearch", "workspaceFiles/search", "冻结Remote未列入allowlist"],
  [
    "fileWrite/delete/rename",
    "workspaceFiles write family",
    "文件服务只读，Remote无对应入口",
  ],
  [
    "bundleRelativeImages",
    "api/plugin-manager/detail-file",
    "资源GET不在Remote pluginRoute allowlist",
  ],
];
const data = {
  remoteCommit,
  dshCommit,
  scope:
    "Source capability inventory; not runtime availability, UI parity, or live-write acceptance.",
  typert: endpoints.map((endpoint) => ({
    endpoint,
    frontend: wired.get(endpoint) ?? core[endpoint] ?? null,
    status: Object.values(OPERATIONS).find((op) => op.endpoint === endpoint)
      ?.blockedReason
      ? "blocked-frozen-compatibility"
      : wired.has(endpoint) || core[endpoint]
        ? "wired"
        : "allowed-not-yet-wired",
  })),
  composed: [
    {
      frontend: "exportSessionMarkdown",
      status: "wired-fixture-only-ui-pending",
      endpoints: ["session/events", "remote.history.configure"],
      semantics:
        "complete fixed-cut canonical logical events through original formatSessionMarkdown; optional Host sourcePath metadata omitted; no raw ZIP",
    },
  ],
  dedicated: [
    {
      endpoint: "workspace.upload.open/chunk/commit/abort",
      status: "wired-fixture-verified-no-live-upload",
      frontend: "uploadWorkspaceFile",
      semantics:
        "regular local file to Host workspace, device-owned transfer; reference returned workspace path; not composer image attachment receipt",
      source: "remote_reference/packages/plugin/src/remote-file-upload.ts",
    },
    {
      endpoint: "terminal/follow,retain + write,resize",
      status: "policy-conditional",
      semantics:
        "Remote TerminalCarrierCompat; current device-owned terminals only; Host must already enable terminal capability",
    },
    {
      endpoint: "loopback.call describe/http/ws",
      status: "protocol-supported-current-deployment-unavailable",
      evidence:
        "dist/live-loopback.json: existing allowedPortCount=0; no configuration changed",
    },
    {
      endpoint: "plugin.route.v1 POST api/bot",
      status: "restricted",
      semantics:
        "Reviewed bot operations only, no arbitrary route or static UI proxy",
    },
  ],
  gaps: gaps.map(([feature, endpoint, reason]) => ({
    feature,
    endpoint,
    status: "blocked-frozen-remote",
    reason,
  })),
  compat: {
    built: [
      "original PluginManagerPage installed list/detail",
      "original ModelSelect provider/model/reasoning picker",
      "original Shell/Subagent/AgentLoop/WebSearch cards and revision-fenced staged controllers",
      "original Trajectory assembler/definitions/snapshot/Timeline/Table/View with ephemeral passive follow",
      "original TerminalView/Inventory/WindowHold/RemoteStream and xterm renderer with bounded sequential input",
      "original ModelSelect embedded composer popover with exact source transform",
      "original ModelsSection, AgentPresetSection and TaskManagerPage with owner-scoped adapters",
      "original PluginsSettingsSection and PluginInventorySettingsTab in settings content",
    ],
    missing: [
      "unported third-party settings and resources",
      "arbitrary third-party slot modules",
      "relative bundle detail images",
      "plugin install/remove",
    ],
  },
  writeValidation: "fixture-only; no real Host mutations",
  liveReads: "dist/live-surfaces.json",
};
await writeFile(
  new URL("./capability-matrix.json", import.meta.url),
  JSON.stringify(data, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    typert: data.typert.length,
    wired: data.typert.filter((r) => r.status === "wired").length,
    gaps: data.gaps.length,
  }),
);
