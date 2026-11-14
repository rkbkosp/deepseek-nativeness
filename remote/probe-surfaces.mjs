// Only Native DSH's private identity and passive/read endpoints. No task or settings mutations.
import { writeFile } from "node:fs/promises";
import { RemoteAdapter } from "./client.mjs";
const [serverUrl, outputPath] = process.argv.slice(2);
if (!serverUrl || !outputPath)
  throw Error("Usage: node remote/probe-surfaces.mjs SERVER_URL OUTPUT_JSON");
const report = {
  startedAt: new Date().toISOString(),
  readOnly: true,
  interactionAnswerer: false,
  mutations: 0,
  methods: [],
};
const adapter = new RemoteAdapter();
function shape(value) {
  if (Array.isArray(value))
    return {
      type: "array",
      count: value.length,
      entryKeys:
        value[0] && typeof value[0] === "object"
          ? Object.keys(value[0]).sort()
          : [],
    };
  if (value && typeof value === "object")
    return {
      type: "object",
      keys: Object.keys(value).sort(),
      arrays: Object.fromEntries(
        Object.entries(value)
          .filter(([, v]) => Array.isArray(v))
          .map(([k, v]) => [k, v.length]),
      ),
    };
  return { type: typeof value };
}
async function read(method, params = {}) {
  try {
    const value = await adapter.request(method, params);
    report.methods.push({ method, reachable: true, ...shape(value) });
    return value;
  } catch (error) {
    report.methods.push({
      method,
      reachable: false,
      code: error.code ?? "ERROR",
    });
    return undefined;
  }
}
try {
  await adapter.configure({ serverUrl });
  const devices = await adapter.request("devices");
  const host = devices.find((d) => d.online && /Mac-mini/i.test(d.name));
  if (!host) throw Object.assign(Error(), { code: "HOST_NOT_FOUND" });
  const status = await adapter.request("connect", {
    hostId: host.id,
    readOnly: true,
  });
  report.transport = status.transport;
  const sessions = await adapter.request("sessions", { all: true });
  const session = sessions
    .filter((s) => !s.running)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!session) throw Object.assign(Error(), { code: "NO_COMPLETED_SESSION" });
  const sessionId = session.id;
  await read("capabilities", { sessionId, workspaceId: session.workspaceId });
  await read("modelCatalog");
  await read("permissionCatalog");
  await read("listCommands", { sessionId });
  await read("pluginInventory");
  await read("listPlugins");
  const bundles = await read("listBundles");
  const bundle = bundles?.find(
    (b) => b.availability === "available" || b.installed,
  );
  if (bundle) await read("readBundleDetail", { name: bundle.name });
  const listing = await read("listFiles", { sessionId, path: "" });
  const file = listing?.entries.find(
    (e) =>
      e.type === "file" &&
      e.size < 131072 &&
      /^(README(?:\.[\w-]+)?|AGENTS\.md|package\.json|go\.mod)$/i.test(e.name),
  );
  if (file) {
    const path = [listing.path, file.name].filter(Boolean).join("/");
    await read("statFile", { sessionId, path });
    await read("readFile", { sessionId, path, range: { offset: 1, limit: 5 } });
  } else
    report.methods.push({
      method: "readFile",
      reachable: null,
      reason: "no-safe-small-root-document",
    });
  await read("terminalEnvironment", { sessionId });
  await read("terminalShells", { sessionId });
  await read("listTerminals", { sessionId });
  await read("describeSettings");
  report.pass = report.methods.every((m) => m.reachable !== false);
} catch (error) {
  report.pass = false;
  report.failure = { code: error.code ?? "ERROR" };
} finally {
  await adapter.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(JSON.stringify(report));
  if (!report.pass) process.exitCode = 1;
}
