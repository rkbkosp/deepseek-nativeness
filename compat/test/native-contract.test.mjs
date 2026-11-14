import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PAGE_CONTRACTS } from "../page-contracts.mjs";
import { OPERATIONS } from "../../remote/operations.mjs";

test("each packaged page RPC is present in both helper registry and native allowlist", async () => {
  const desktop = new URL("../../", import.meta.url);
  const native = (
    await Promise.all(
      (await readdir(desktop))
        .filter(
          (name) =>
            name.startsWith("compat") &&
            name.endsWith(".go") &&
            !name.endsWith("_test.go"),
        )
        .map((name) => readFile(new URL(name, desktop), "utf8")),
    )
  ).join("\n");
  const section =
    native.match(
      /var compatMethods = map\[string\]bool\{([\s\S]*?)\n\}/,
    )?.[1] ?? "";
  const allowed = new Set(
    [...section.matchAll(/"([^"]+)":\s*true/g)].map((match) => match[1]),
  );
  const internal = new Set(["closeStream"]);
  for (const [page, contract] of Object.entries(PAGE_CONTRACTS))
    for (const method of [...contract.read, ...contract.write]) {
      assert.ok(
        OPERATIONS[method] || internal.has(method),
        `${page}: helper ${method}`,
      );
      assert.ok(allowed.has(method), `${page}: native ${method}`);
    }
  for (const [page, contract] of Object.entries(PAGE_CONTRACTS))
    for (const binding of contract.native)
      assert.match(
        native,
        new RegExp(`func \\(api \\*CompatAPI\\) ${binding}\\(`),
        `${page}: binding ${binding}`,
      );
  assert.match(native, /func \(api \*CompatAPI\) RequestV2\(/);
});
