import { build } from "esbuild";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = dirname(fileURLToPath(import.meta.url));
/**
 * The ds-harness-remote checkout the transport modules are selected from.
 * `../remote_reference` stays the default; `--reference <path>` repoints at a
 * different pinned checkout without editing the reference tree in place.
 */
const referenceFlag = process.argv.indexOf("--reference");
const reference = resolve(
  root,
  referenceFlag >= 0 && process.argv[referenceFlag + 1]
    ? process.argv[referenceFlag + 1]
    : "../remote_reference",
);
/** The exact reference tag/commit actually bundled, read from the checkout. */
function referencePin() {
  try {
    return {
      tag: execSync("git describe --tags --exact-match HEAD", {
        cwd: reference,
        encoding: "utf8",
      }).trim(),
      commit: execSync("git rev-parse HEAD", {
        cwd: reference,
        encoding: "utf8",
      }).trim(),
    };
  } catch {
    return { tag: "unknown", commit: "unknown" };
  }
}
const pinned = referencePin();
const output = resolve(
  root,
  process.argv.includes("--out-chat-process-next")
    ? "dist-chat-process-next"
    : process.argv.includes("--out-export-next")
      ? "dist-export-next"
      : process.argv.includes("--out-perf-next")
        ? "dist-perf-next"
        : process.argv.includes("--out-next")
          ? "dist-next"
          : "dist",
);
const { mkdir } = await import("node:fs/promises");
await mkdir(output, { recursive: true });
await build({
  entryPoints: [resolve(root, "src/upstream.ts")],
  outfile: resolve(output, "upstream.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  banner: {
    js: 'import { createRequire as __nativeDSHRequire } from "node:module"; const require = __nativeDSHRequire(import.meta.url);',
  },
  alias: Object.fromEntries(
    ["client-core", "crypto", "protocol", "webrtc"].map((name) => [
      `@dsh-remote/${name}`,
      resolve(reference, `packages/${name}/src/index.ts`),
    ]),
  ),
  nodePaths: [resolve(root, "node_modules")],
  external: ["@roamhq/wrtc", "werift"],
  metafile: true,
  legalComments: "eof",
}).then(async (result) => {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    resolve(output, "build-meta.json"),
    JSON.stringify(
      {
        upstream: "https://github.com/liguobao/ds-harness-remote",
        tag: pinned.tag,
        dshCommit:
          process.env.DSH_COMMIT ?? "9c2670d3bce5275e0d1610272958121af87787bb",
        commit: pinned.commit,
        inputs: Object.keys(result.metafile.inputs),
        outputs: result.metafile.outputs,
      },
      null,
      2,
    ) + "\n",
  );
});

const helperBuild = await build({
  entryPoints: [resolve(root, "bridge.mjs")],
  outfile: resolve(output, "bridge.bundle.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  external: ["@roamhq/wrtc", "werift"],
  plugins: [
    {
      name: "selected-upstream-output",
      setup(b) {
        b.onResolve({ filter: /[\/]dist[\/]upstream\.mjs$/ }, () => ({
          path: resolve(output, "upstream.mjs"),
        }));
      },
    },
  ],
  legalComments: "eof",
  metafile: true,
});
// The local helper shares the client, projection and publisher sources with the
// Remote helper; only its carrier differs. `ws` stays external because the
// runtime tree this helper is packaged beside supplies the Host's own build.
const localBuild = await build({
  entryPoints: [resolve(root, "local-bridge.mjs")],
  outfile: resolve(output, "local-bridge.bundle.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  external: ["ws", "@roamhq/wrtc", "werift"],
  plugins: [
    {
      name: "selected-upstream-output",
      setup(b) {
        b.onResolve({ filter: /[\/]dist[\/]upstream\.mjs$/ }, () => ({
          path: resolve(output, "upstream.mjs"),
        }));
      },
    },
  ],
  legalComments: "eof",
  metafile: true,
});
const { readFile, writeFile } = await import("node:fs/promises");
const meta = JSON.parse(
  await readFile(resolve(output, "build-meta.json"), "utf8"),
);
const clientSourceHashes = {};
for (const input of Object.keys(helperBuild.metafile.inputs)) {
  const path = resolve(input);
  if (!path.startsWith(root + "/") || path.includes("/node_modules/")) continue;
  const source = await readFile(path);
  clientSourceHashes[path.slice(root.length + 1)] = {
    bytes: source.length,
    sha256: createHash("sha256").update(source).digest("hex"),
  };
}
const helper = await readFile(resolve(output, "bridge.bundle.mjs"));
const localHelper = await readFile(resolve(output, "local-bridge.bundle.mjs"));
await writeFile(
  resolve(output, "build-meta.json"),
  JSON.stringify(
    {
      ...meta,
      clientInputs: Object.keys(helperBuild.metafile.inputs),
      clientOutputs: helperBuild.metafile.outputs,
      clientSourceHashes,
      helper: {
        bytes: helper.length,
        sha256: createHash("sha256").update(helper).digest("hex"),
      },
      localHelper: {
        bytes: localHelper.length,
        sha256: createHash("sha256").update(localHelper).digest("hex"),
      },
    },
    null,
    2,
  ) + "\n",
);
