import { test } from "node:test";
import assert from "node:assert/strict";
import { RemoteAdapter } from "../client.mjs";
function adapter() {
  const a = new RemoteAdapter();
  a.interactionReady = true;
  a.hostId = "host";
  a.sessionRows = [{ id: "s" }];
  return a;
}
test("submitting while interaction channel is unavailable is refused before dispatch", async () => {
  const a = adapter();
  a.interactionReady = false;
  let calls = 0;
  a.gateway = {
    dispatch() {
      calls++;
    },
  };
  await assert.rejects(
    a.request("sendMessage", {
      sessionId: "s",
      text: "hello",
      requestId: "1234567890123456",
    }),
    { code: "INTERACTIONS_UNAVAILABLE" },
  );
  assert.equal(calls, 0);
  await a.close();
});
test("same explicit requestId deduplicates mutations and refuses changed content", async () => {
  const a = adapter();
  let calls = 0;
  a.gateway = {
    dispatch: async () => {
      calls++;
      return { ok: true, value: {} };
    },
  };
  const p = { sessionId: "s", text: "hello", requestId: "1234567890123456" };
  await Promise.all([a.request("sendMessage", p), a.request("sendMessage", p)]);
  assert.equal(calls, 1);
  await assert.rejects(a.request("sendMessage", { ...p, text: "changed" }), {
    code: "REQUEST_ID_CONFLICT",
  });
  await a.close();
});
test("lost response yields unknown receipt and never retries", async () => {
  const a = adapter();
  let calls = 0;
  a.gateway = {
    dispatch: async () => {
      calls++;
      throw Error("offline");
    },
  };
  const p = { sessionId: "s", text: "hello", requestId: "1234567890123456" };
  assert.equal((await a.request("sendMessage", p)).status, "unknown");
  assert.equal((await a.request("sendMessage", p)).status, "unknown");
  assert.equal(calls, 1);
  await a.close();
});
test("approval returns string outcome; cancellation makes a late answer invalid", async () => {
  const a = adapter();
  let sent;
  a.gateway = {
    dispatch: async (endpoint, payload) => {
      sent = { endpoint, payload };
      return { ok: true, value: {} };
    },
  };
  a.pending.set("event", {
    id: "event",
    kind: "approval",
    abort: new AbortController(),
    wire: { clientId: "client", eventId: "event" },
  });
  await a.request("answerApproval", {
    requestId: "event",
    outcome: "allowed-once",
  });
  assert.deepEqual(sent, {
    endpoint: "$events/result",
    payload: {
      args: {
        clientId: "client",
        eventId: "event",
        outcome: { kind: "result", value: "allowed-once" },
      },
    },
  });
  await assert.rejects(
    a.request("answerApproval", {
      requestId: "event",
      outcome: "allowed-once",
    }),
    { code: "INTERACTION_EXPIRED" },
  );
  await a.close();
});
test("questions retain option labels and cancel through rejected ASK_CANCELLED", async () => {
  const a = adapter();
  let sent;
  a.gateway = {
    dispatch: async (endpoint, payload) => {
      sent = payload;
      return { ok: true, value: {} };
    },
  };
  const pending = () => ({
    id: "event",
    kind: "questions",
    questions: [{ id: "q", options: [{ label: "yes" }] }],
    abort: new AbortController(),
    wire: { clientId: "client", eventId: "event" },
  });
  a.pending.set("event", pending());
  await a.request("answerQuestions", {
    requestId: "event",
    answers: [{ id: "q", selected: ["yes"] }],
  });
  assert.deepEqual(sent.args.outcome.value, {
    answers: [{ id: "q", selected: ["yes"] }],
  });
  a.pending.set("event", pending());
  await a.request("answerQuestions", { requestId: "event", cancelled: true });
  assert.equal(sent.args.outcome.kind, "rejected");
  assert.equal(sent.args.outcome.error.code, "ASK_CANCELLED");
  await a.close();
});

test("session catalog uses frozen Host generated _request parameter name", async () => {
  const a = new RemoteAdapter();
  try {
    let args;
    a.gateway = {
      invoke: async (request) => {
        args = request.args;
        return { items: [] };
      },
    };
    await a.request("sessions");
    assert.deepEqual(args, { _request: {} });
  } finally {
    await a.close();
  }
});
