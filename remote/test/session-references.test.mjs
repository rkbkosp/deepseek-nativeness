import test from "node:test";
import assert from "node:assert/strict";
import { RemoteAdapter } from "../client.mjs";
import { operationArgs } from "../operations.mjs";

test("session mention discovery uses the lookup-scoped Host endpoint and preserves its canonical mention", async () => {
  const args = operationArgs("listSessionReferences", {
    sessionId: "fixture-current",
    query: "Fixture",
  });
  assert.deepEqual(args, { agentId: "fixture-current", query: "Fixture" });
  const mention =
    "@[Fixture](dsh-session:" +
    Buffer.from(JSON.stringify("fixture-reference")).toString("base64url") +
    ")";
  const rows = [
    {
      sessionId: "fixture-reference",
      label: "Fixture",
      displayTitle: "Fixture",
      mention,
    },
  ];
  const adapter = new RemoteAdapter();
  const calls = [];
  adapter.gateway = {
    invoke: async (request) => {
      calls.push(request);
      return rows;
    },
  };
  const value = await adapter.request("listSessionReferences", {
    sessionId: "fixture-current",
    query: "Fixture",
  });
  assert.equal(value, rows);
  assert.equal(value[0].mention, mention);
  assert.equal(calls[0].namespace, "sessionReferenceResolver");
  assert.equal(calls[0].method, "candidates");
  assert.deepEqual(calls[0].args, args);
});
