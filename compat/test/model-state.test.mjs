import { test } from "node:test";
import assert from "node:assert/strict";
import { modelDirectoryState } from "../src/model-state.mjs";
const chosen = { provider: "magpie", model: "deepseek-flash" },
  catalog = {
    default: { provider: "official", model: "default" },
    groups: [
      {
        id: "magpie",
        name: "Magpie",
        models: [
          {
            id: "deepseek-flash",
            name: "DeepSeek-Flash · Qoder CN",
            reasoning: {
              defaultEffort: "default",
              efforts: [{ id: "default", name: "Default" }],
            },
          },
        ],
      },
    ],
    failures: [],
  };
test("selection uses the actual next wire view and reasoning metadata", () => {
  const state = modelDirectoryState(catalog, {
    kind: "sequenced",
    asOfSeq: 12,
    values: { modelSelection: { lastUsed: chosen, next: chosen } },
  });
  assert.deepEqual(state.current, chosen);
  assert.equal(state.routable, true);
  assert.equal(state.retainedEffort, "Default");
  assert.equal(state.groups, catalog.groups);
});
test("a blank valid projection uses Host default; missing projection is not invented", () => {
  assert.deepEqual(
    modelDirectoryState(catalog, {
      values: { modelSelection: { lastUsed: null, next: null } },
    }).current,
    catalog.default,
  );
  const missing = modelDirectoryState(catalog, null);
  assert.equal(missing.current, null);
  assert.equal(missing.status, "error");
});
