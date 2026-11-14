import test from "node:test";
import assert from "node:assert/strict";
import { context, request } from "../.test-build/bridge.mjs";

test("WK V2 preserves explicit rejection delivery without exposing a submitted credential", async () => {
  const calls = [];
  globalThis.window = {
    mygo: {
      call: async (method, ...params) => {
        calls.push(method);
        if (method === "CompatAPI.GetContext") return { rpcVersion: 2 };
        if (params[0] === "setCredential")
          return {
            ok: false,
            error: {
              code: "credential/rejected",
              message: "Rejected fixture-only-literal",
              delivery: "rejected",
            },
          };
        return {
          ok: true,
          value: { status: "unknown", requestId: "fixture-intent" },
        };
      },
    },
  };
  await context();
  await assert.rejects(
    request("setCredential", { value: "fixture-only-literal" }),
    (error) =>
      error.code === "credential/rejected" &&
      error.delivery === "rejected" &&
      !error.message.includes("fixture-only-literal"),
  );
  assert.equal((await request("mutateSettings", {})).status, "unknown");
  assert.deepEqual(calls, [
    "CompatAPI.GetContext",
    "CompatAPI.RequestV2",
    "CompatAPI.RequestV2",
  ]);
  delete globalThis.window;
});
