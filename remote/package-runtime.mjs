// Copies an already-built helper and locked production dependencies into an app resource directory.
import { cp, mkdir, readFile, stat, writeFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(fileURLToPath(import.meta.url));
if (!process.argv[2])
  throw Error("Usage: node remote/package-runtime.mjs <destination>");
const destination = resolve(process.argv[2]);
const buildDirectory = process.argv.includes("--source-export-next")
  ? "dist-export-next"
  : process.argv.includes("--source-perf-next")
    ? "dist-perf-next"
    : process.argv.includes("--source-next")
      ? "dist-next"
      : "dist";
if (destination === root || root.startsWith(destination + "/"))
  throw Error("Choose a separate staging destination.");
await mkdir(destination, { recursive: true });
await cp(
  join(root, buildDirectory, "bridge.bundle.mjs"),
  join(destination, "bridge.mjs"),
);
const lock = JSON.parse(
  await readFile(join(root, "package-lock.json"), "utf8"),
);
let packages = 0;
for (const [path, metadata] of Object.entries(lock.packages)) {
  if (!path.startsWith("node_modules/") || metadata.dev === true) continue;
  const source = join(root, path);
  try {
    await access(source);
  } catch {
    continue;
  }
  const target = join(destination, path);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
  packages++;
}
await cp(join(root, "UPSTREAM-LICENSE"), join(destination, "UPSTREAM-LICENSE"));
await cp(join(root, "DSH-LICENSE"), join(destination, "DSH-LICENSE"));
await cp(
  join(root, buildDirectory, "build-meta.json"),
  join(destination, "source-manifest.json"),
);
await writeFile(
  join(destination, "runtime-manifest.json"),
  JSON.stringify(
    {
      helper: "bridge.mjs",
      upstream: {
        name: "ds-harness-remote",
        version: "0.6.4",
        commit: "4670ae67cde91e1ac4c9df9d3400fb317c8eedf7",
      },
      nodeRequired: ">=24.9",
      packages,
      backend: "none",
      webviewRequired: false,
      extraRtcProcess: false,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    destination,
    packages,
    helperBytes: (await stat(join(destination, "bridge.mjs"))).size,
  }),
);
