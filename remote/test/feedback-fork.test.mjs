import test from "node:test";
import assert from "node:assert/strict";
import { RemoteAdapter } from "../client.mjs";
import { SessionProjection } from "../projection.mjs";
const setup = () => {
  const adapter = new RemoteAdapter();
  adapter.hostId = "host";
  adapter.connectionGeneration = 2;
  adapter.interactionReady = true;
  return adapter;
};
const id = "fixture-request-0001";
test("feedback uses the durable source message id, exact nested envelope and explicit observed version", async () => {
  const adapter = setup();
  const projection = new SessionProjection("session");
  projection.snapshot({
    cursor: 0,
    records: [
      {
        event: {
          seq: 0,
          type: "assistant/message",
          surfaceOp: "append",
          data: {
            message: {
              id: "opaque-original-message",
              content: [{ type: "text", text: "final" }],
            },
          },
        },
      },
    ],
  });
  const message = projection.value().messages[0];
  assert.equal(message.id, "event:0");
  assert.equal(message.sourceMessageId, "opaque-original-message");
  const calls = [];
  adapter.gateway = {
    dispatch: async (endpoint, payload) => {
      calls.push({ endpoint, payload });
      return {
        ok: true,
        value: {
          ok: true,
          value: {
            messageId: payload.args.request.messageId,
            version: "observed-2",
          },
        },
      };
    },
  };
  const params = {
    sessionId: "session",
    messageId: message.sourceMessageId,
    rating: "positive",
    ifVersion: null,
    requestId: id,
  };
  const result = await adapter.request("putFeedback", params);
  assert.equal(result.value.ok, true);
  assert.deepEqual(calls[0], {
    endpoint: "messageFeedback/put",
    payload: {
      args: {
        request: {
          sessionId: "session",
          messageId: "opaque-original-message",
          rating: "positive",
          ifVersion: null,
        },
      },
    },
  });
  await adapter.request("putFeedback", params);
  assert.equal(calls.length, 1);
  await adapter.request("deleteFeedback", {
    sessionId: "session",
    messageId: message.sourceMessageId,
    ifVersion: "observed-2",
    requestId: id + "delete",
  });
  assert.deepEqual(calls[1].payload, {
    args: {
      request: {
        sessionId: "session",
        messageId: "opaque-original-message",
        ifVersion: "observed-2",
      },
    },
  });
  await adapter.close();
});
test("missing feedback CAS, unknown ratings/categories and invalid fork cuts reject before any dispatch", async () => {
  const adapter = setup();
  let calls = 0;
  adapter.gateway = {
    dispatch: async () => {
      calls++;
      return { ok: true, value: {} };
    },
  };
  for (const [method, params] of [
    [
      "putFeedback",
      { sessionId: "session", messageId: "message", rating: "positive" },
    ],
    [
      "putFeedback",
      {
        sessionId: "session",
        messageId: "message",
        rating: "unknown",
        ifVersion: null,
      },
    ],
    [
      "putFeedback",
      {
        sessionId: "session",
        messageId: "message",
        rating: "negative",
        ifVersion: null,
        category: "guess",
      },
    ],
    [
      "deleteFeedback",
      { sessionId: "session", messageId: "message", ifVersion: null },
    ],
    ["forkSession", { sessionId: "session", atSeq: -1 }],
    ["forkSession", { sessionId: "session", allowMigration: "false" }],
  ])
    await assert.rejects(
      adapter.request(method, { ...params, requestId: id }),
      (error) =>
        error.code === "INVALID_ARGUMENT" && error.delivery === "rejected",
    );
  assert.equal(calls, 0);
  await adapter.close();
});
test("feedback business conflicts and target misses remain explicit inside a delivered receipt", async () => {
  const adapter = setup();
  adapter.gateway = {
    dispatch: async () => ({
      ok: true,
      value: {
        ok: false,
        error: {
          code: "version-conflict",
          current: { version: "current-host-version", rating: "negative" },
        },
      },
    }),
  };
  const result = await adapter.request("putFeedback", {
    sessionId: "session",
    messageId: "message",
    rating: "positive",
    ifVersion: "old",
    requestId: id,
  });
  assert.equal(result.status, "accepted");
  assert.equal(result.value.ok, false);
  assert.equal(result.value.error.current.version, "current-host-version");
  await adapter.close();
});
test("fork preserves exact source/boundary and a partial created child is cached without another creation", async () => {
  const adapter = setup();
  const calls = [];
  adapter.gateway = {
    dispatch: async (endpoint, payload) => {
      calls.push({ endpoint, payload });
      return {
        ok: false,
        error: {
          code: "session/workspace-attach-failed",
          message: "sensitive path is not copied",
          details: { sessionId: "created-child", workspaceId: "workspace" },
        },
      };
    },
  };
  const params = {
    sessionId: "source-session",
    atSeq: 17,
    allowMigration: false,
    increaseTitle: true,
    requestId: id,
  };
  const partial = await adapter.request("forkSession", params);
  assert.equal(partial.status, "partial");
  assert.equal(partial.value.sessionId, "created-child");
  assert.equal(partial.hostId, "host");
  assert.equal(partial.connectionGeneration, 2);
  assert.equal(partial.requestId, id);
  assert.equal(partial.error.message.includes("sensitive"), false);
  assert.deepEqual(calls[0], {
    endpoint: "session/fork",
    payload: {
      args: {
        request: {
          sessionId: "source-session",
          atSeq: 17,
          allowMigration: false,
        },
      },
    },
  });
  assert.deepEqual(await adapter.request("forkSession", params), partial);
  assert.equal(calls.length, 1);
  await adapter.close();
});
test("unknown fork/feedback delivery never replays, while a definite fork refusal is distinguishable", async () => {
  for (const method of ["forkSession", "putFeedback"]) {
    const adapter = setup();
    let calls = 0;
    adapter.gateway = {
      dispatch: async () => {
        calls++;
        throw Error("transport lost");
      },
    };
    const params = {
      sessionId: "session",
      requestId: id,
      ...(method === "putFeedback"
        ? { messageId: "message", rating: "positive", ifVersion: null }
        : {}),
    };
    assert.equal((await adapter.request(method, params)).status, "unknown");
    await adapter.request(method, params);
    assert.equal(calls, 1);
    await adapter.close();
  }
  const adapter = setup();
  adapter.gateway = {
    dispatch: async () => ({
      ok: false,
      error: {
        code: "session/fork-unavailable",
        message: "no completed turn",
        details: {},
      },
    }),
  };
  await assert.rejects(
    adapter.request("forkSession", { sessionId: "session", requestId: id }),
    (error) =>
      error.code === "session/fork-unavailable" &&
      error.delivery === "rejected",
  );
  await adapter.close();
});

test("an attach-failed response missing its created identity is cached unknown rather than retryable rejection", async () => {
  const adapter = setup();
  let calls = 0;
  adapter.gateway = {
    dispatch: async () => {
      calls++;
      return {
        ok: false,
        error: {
          code: "session/workspace-attach-failed",
          message: "created but lost identity",
          details: {},
        },
      };
    },
  };
  const params = { sessionId: "session", requestId: id };
  const result = await adapter.request("forkSession", params);
  assert.equal(result.status, "unknown");
  assert.equal(result.error.code, "session/workspace-attach-failed");
  await adapter.request("forkSession", params);
  assert.equal(calls, 1);
  await adapter.close();
});
