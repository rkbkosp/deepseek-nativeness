import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  anchorConsumers,
  anchorBindings,
} from "../compat/menu-anchor-coverage.mjs";
const root = resolve(import.meta.dirname, ".."),
  input = resolve(
    process.argv[2] ?? `${root}/compat/dist-layout-next/source-manifest.json`,
  ),
  out = resolve(process.argv[3] ?? `${root}/compat/anchor-coverage-audit.json`),
  manifest = JSON.parse(await readFile(input)),
  budgets = JSON.parse(
    await readFile(input.replace("source-manifest.json", "route-budgets.json")),
  ),
  consumers = [],
  unknown = [];
for (const name of manifest.inputs.filter((p) => p.endsWith(".css"))) {
  const path = name.includes(":/")
      ? name.slice(name.indexOf(":/") + 1)
      : resolve(manifest.buildWorkingDirectory, name),
    raw = await readFile(path),
    text = raw.toString(),
    lines = text
      .split("\n")
      .map((text, index) => ({ line: index + 1, text: text.trim() }))
      .filter(({ text }) =>
        /(anchor-name|position-anchor|anchor\s*\(|anchor-size\s*\(|position-try|position-area)/.test(
          text,
        ),
      );
  if (!lines.length) continue;
  const key = Object.keys(anchorConsumers).find((key) => path.endsWith(key));
  if (!key) unknown.push(path);
  consumers.push({
    source: key ?? path,
    sha256: createHash("sha256").update(raw).digest("hex"),
    rules: lines,
    routes: budgets.routes
      .filter((r) => r.cssInputs.includes(name))
      .map((r) => r.entry),
    ...(key ? anchorConsumers[key] : { patch: "UNCLASSIFIED" }),
  });
}
const inlineBindings = [];
if (process.argv.includes("--inline")) {
  const seen = new Set();
  for (const name of manifest.inputs.filter(
    (p) => /\.[cm]?[jt]sx?$/.test(p) && !p.includes("node_modules"),
  )) {
    const path = name.includes(":/")
      ? name.slice(name.indexOf(":/") + 1)
      : resolve(manifest.buildWorkingDirectory, name);
    if (seen.has(path)) continue;
    seen.add(path);
    const raw = await readFile(path),
      lines = raw
        .toString()
        .split("\n")
        .map((text, index) => ({ line: index + 1, text: text.trim() }))
        .filter(
          ({ text }) =>
            !text.startsWith("//") &&
            !text.startsWith("*") &&
            /(positionAnchor|anchorName|anchor-name|position-anchor|anchor\s*\(|anchor-size\s*\(|--dsh-[\w-]*anchor)/.test(
              text,
            ),
        );
    if (!lines.length) continue;
    const key = Object.keys(anchorBindings).find((key) => path.endsWith(key));
    if (!key) unknown.push(path);
    inlineBindings.push({
      source: key ?? path,
      sha256: createHash("sha256").update(raw).digest("hex"),
      declarations: lines,
      classification: key ? anchorBindings[key] : "UNCLASSIFIED",
    });
  }
}
const report = {
  scope:
    "Exhaustive literal CSS anchor consumer inventory of the exact supplied build metafile, not a macOS15.8 or GUI acceptance claim.",
  baselineClassification:
    "GUI8 fields and requiredAdditionalAdapters describe the original GUI8 omissions; the follow-up source adapters and their separate tests are recorded in anchor-coverage-next-review.json.",
  sourceManifest: input,
  sourceManifestSHA256: createHash("sha256")
    .update(await readFile(input))
    .digest("hex"),
  consumers,
  inlineBindings,
  unknown,
  requiredAdditionalAdapters: consumers
    .filter((v) => v.GUI8?.includes("lacks fallback"))
    .map((v) => v.source),
};
await writeFile(out, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    out,
    consumers: consumers.length,
    unknown,
    requiredAdditionalAdapters: report.requiredAdditionalAdapters,
  }),
);
if (unknown.length) process.exitCode = 1;
