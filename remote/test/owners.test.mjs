import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as turn } from "node:timers/promises";
import { RemoteAdapter } from "../client.mjs";
function setup() {
  const notes = [],
    a = new RemoteAdapter((method, params) => notes.push({ method, params }));
  a.hostId = "host";
  a.connectionGeneration = 2;
  a.interactionReady = true;
  a.projection = { sessionId: "session" };
  a.connected = {
    features: { terminal: true },
    client: { close: async () => {} },
  };
  let active = 0;
  a.gateway = {
    open: async function* (endpoint, payload, signal) {
      active++;
      try {
        yield { type: "snapshot" };
        await new Promise((resolve) =>
          signal.aborted
            ? resolve()
            : signal.addEventListener("abort", resolve, { once: true }),
        );
      } finally {
        active--;
      }
    },
    dispatch: async () => ({ ok: true, value: {} }),
  };
  const scope = { hostId: "host", generation: 2, sessionId: "session" };
  return { a, notes, scope, active: () => active };
}
test("twenty WK owner lifetimes leave no stream, owner or active carrier", async () => {
  const f = setup();
  for (let i = 0; i < 20; i++) {
    const ownerId = "fixture-owner-" + i;
    await f.a.request("registerOwner", { ownerId, clientScope: f.scope });
    await f.a.request("watchSession", {
      sessionId: "session",
      clientScope: { ...f.scope, ownerId },
    });
    await turn();
    assert.equal(f.active(), 1);
    assert.equal(f.a.streams.size, 1);
    await f.a.request("closeOwnerStreams", { ownerId });
    await turn();
    assert.equal(f.active(), 0);
    assert.equal(f.a.owners.size, 0);
    assert.equal(f.a.streams.size, 0);
    assert.equal(f.a.streamContexts.size, 0);
  }
  f.a.projection = undefined;
  await f.a.close();
});
test("owner destruction rejects an already queued Host setting write", async () => {
  const f = setup(),
    ownerId = "fixture-owner-close";
  await f.a.request("registerOwner", { ownerId, clientScope: f.scope });
  let writes = 0;
  f.a.gateway.dispatch = async () => {
    writes++;
    return { ok: true, value: {} };
  };
  const pending = f.a.request("mutateSettings", {
    ns: "permission",
    ops: [],
    requestId: "fixture-owner-setting-write",
    clientScope: { ...f.scope, ownerId },
  });
  await f.a.request("closeOwnerStreams", { ownerId });
  await assert.rejects(pending, {
    code: "STALE_CONTEXT",
    delivery: "rejected",
  });
  assert.equal(writes, 0);
  f.a.projection = undefined;
  await f.a.close();
});
test("terminal accepts over 512 ordered inputs with only bounded attachment receipts", async () => {
  const f = setup(),
    ownerId = "fixture-terminal-owner";
  await f.a.request("registerOwner", { ownerId, clientScope: f.scope });
  const target = {
    sessionId: "session",
    terminalId: "term",
    attachmentId: "attach",
    clientScope: { ...f.scope, ownerId },
  };
  await f.a.request("watchTerminal", target);
  await turn();
  let writes = 0;
  f.a.gateway.dispatch = async () => {
    writes++;
    return { ok: true, value: {} };
  };
  for (let inputSequence = 1; inputSequence <= 600; inputSequence++) {
    const p = {
      ...target,
      inputSequence,
      data: "x",
      requestId: "fixture-terminal-input-" + inputSequence,
    };
    const receipt = await f.a.request("writeTerminal", p);
    assert.equal(receipt.status, "accepted");
    await f.a.request("writeTerminal", p);
  }
  assert.equal(writes, 600);
  assert.equal(f.a.ledger.size, 0);
  const state = [...f.a.terminalInputs.values()][0];
  assert.equal(state.recent.size, 32);
  await assert.rejects(
    f.a.request("writeTerminal", {
      ...target,
      inputSequence: 1,
      data: "x",
      requestId: "fixture-terminal-input-1",
    }),
    { code: "INPUT_RECEIPT_RETIRED" },
  );
  assert.equal(writes, 600);
  await f.a.request("closeOwnerStreams", { ownerId });
  assert.equal(f.a.terminalInputs.size, 0);
  await turn();
  f.a.projection = undefined;
  await f.a.close();
});
test("a fresh terminal attachment refuses sequence zero or a skipped first frame", async () => {
  const f = setup(),
    ownerId = "fixture-first-sequence";
  await f.a.request("registerOwner", { ownerId, clientScope: f.scope });
  const target = {
    sessionId: "session",
    terminalId: "term",
    attachmentId: "attach",
    clientScope: { ...f.scope, ownerId },
  };
  await f.a.request("watchTerminal", target);
  await turn();
  let writes = 0;
  f.a.gateway.dispatch = async () => {
    writes++;
    return { ok: true, value: {} };
  };
  await assert.rejects(
    f.a.request("writeTerminal", {
      ...target,
      inputSequence: 0,
      data: "x",
      requestId: "fixture-first-zero",
    }),
    { code: "INVALID_INPUT_SEQUENCE" },
  );
  await assert.rejects(
    f.a.request("writeTerminal", {
      ...target,
      inputSequence: 2,
      data: "x",
      requestId: "fixture-first-skip",
    }),
    { code: "INPUT_SEQUENCE_GAP" },
  );
  assert.equal(writes, 0);
  await f.a.request("closeOwnerStreams", { ownerId });
  await turn();
  f.a.projection = undefined;
  await f.a.close();
});
