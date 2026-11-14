import { build } from "esbuild";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = dirname(fileURLToPath(import.meta.url));
const reference = resolve(root, "../remote_reference");
const output = resolve(
  root,
  process.argv.includes("--out-perf-next")
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
        tag: "v0.6.4",
        dshCommit: "39163dd30f703a79079e2d2446545cff3c453738",
        commit: "4670ae67cde91e1ac4c9df9d3400fb317c8eedf7",
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
    },
    null,
    2,
  ) + "\n",
);
