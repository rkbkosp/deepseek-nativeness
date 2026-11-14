// Existing allowed ports only; no auth URLs/tokens, no bodies, no configuration writes.
import { RemoteAdapter } from "./client.mjs";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
const [serverUrl, outputPath] = process.argv.slice(2);
if (!serverUrl || !outputPath)
  throw Error("Usage: node remote/probe-loopback.mjs SERVER_URL OUTPUT_JSON");
const report = {
    readOnly: true,
    mutations: 0,
    interactionAnswerer: false,
    protocol: "existing Remote loopback HTTP/WS carrier",
    startedAt: new Date().toISOString(),
  },
  adapter = new RemoteAdapter();
try {
  await adapter.configure({ serverUrl });
  const devices = await adapter.devices();
  const host = devices.find((d) => d.online && /Mac-mini/i.test(d.name));
  if (!host) throw Object.assign(Error(), { code: "HOST_NOT_FOUND" });
  await adapter.request("connect", { hostId: host.id, readOnly: true });
  const client = adapter.connected.client;
  const description = await client.rpc(
    "loopback.call",
    { op: "describe" },
    adapter.lifetime.signal,
  );
  report.allowedPortCount = description.ports.length;
  report.httpProbes = [];
  for (const port of description.ports) {
    const id = randomUUID();
    try {
      const head = await client.rpc(
        "loopback.call",
        { op: "http.open", id, port, path: "/", method: "HEAD", headers: [] },
        AbortSignal.timeout(5000),
      );
      report.httpProbes.push({
        reachable: true,
        status: head.status,
        html: head.headers.some(
          ([k, v]) =>
            k.toLowerCase() === "content-type" && v.includes("text/html"),
        ),
      });
    } catch (e) {
      report.httpProbes.push({ reachable: false, code: e.code ?? "ERROR" });
    } finally {
      await client
        .rpc("loopback.call", { op: "close", id }, AbortSignal.timeout(2000))
        .catch(() => {});
    }
  }
  report.originalDshHttpEntry =
    description.ports.length === 0
      ? "unavailable-no-existing-allowed-port"
      : "unverified-cannot-identify-original-app-from-HEAD";
  report.pass = true;
} catch (e) {
  report.pass = false;
  report.code = e.code ?? "ERROR";
} finally {
  await adapter.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(JSON.stringify(report));
}
