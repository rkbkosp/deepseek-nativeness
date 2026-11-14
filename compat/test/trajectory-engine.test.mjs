import { test } from "node:test";
import assert from "node:assert/strict";
import { TrajectoryEngine } from "../.test-build/trajectory-engine.mjs";
const event = (seq, type, data, time = 1000 + seq * 10, surfaceOp) => ({
  type: "event",
  event: { seq, type, data, time, ...(surfaceOp ? { surfaceOp } : {}) },
});
const initial = () => [
  event(1, "turn/start", { turn: 1 }),
  event(2, "step/start", { turn: 1, step: 1 }),
  event(3, "request/header", {
    turn: 1,
    step: 1,
    reason: "initial",
    header: {
      config: { provider: "fixture", model: "fixture-model" },
      tools: [],
    },
  }),
  event(
    4,
    "user/message",
    {
      id: "user-1",
      source: { kind: "user" },
      content: [{ type: "text", text: "fixture prompt" }],
    },
    1040,
    "append",
  ),
];
const assistant = () =>
  event(
    7,
    "assistant/message",
    {
      turn: 1,
      step: 1,
      message: {
        id: "assistant-1",
        role: "assistant",
        source: { kind: "model", provider: "fixture", model: "fixture-model" },
        content: [
          { type: "reasoning", text: "reason" },
          { type: "text", text: "answer" },
        ],
      },
      stream: [
        {
          type: "chunk",
          time: 1045,
          chunk: { type: "text-delta", index: 0, text: "answer" },
        },
      ],
      usage: { inputTokens: 12, outputTokens: 5, cacheReadTokens: 3 },
    },
    1100,
    "append",
  );
test("original target assembles context, tool, assistant requests and timing into Maps", () => {
  const e = new TrajectoryEngine();
  const records = [
    ...initial(),
    event(5, "tool/call", {
      turn: 1,
      step: 1,
      callId: "call",
      name: "read",
      arguments: '{"path":"fixture"}',
    }),
    event(
      6,
      "tool/result",
      {
        turn: 1,
        step: 1,
        message: {
          role: "tool",
          source: { kind: "tool-call", callId: "call" },
          toolCallId: "call",
          content: [{ type: "text", text: "fixture result" }],
        },
      },
      1060,
      "append",
    ),
    assistant(),
    event(8, "step/end", { turn: 1, step: 1 }),
    event(9, "turn/end", { turn: 1, reason: { kind: "completed" } }),
  ];
  const snapshot = e.replace({
    cursor: 9,
    hasMore: false,
    records,
    assistantStream: { revision: 0 },
  });
  assert.ok(snapshot.eventLocations instanceof Map);
  assert.ok(snapshot.callSchemas instanceof Map);
  assert.ok(snapshot.eventNodes.some((node) => node.kind === "user"));
  assert.ok(snapshot.eventNodes.some((node) => node.kind === "tool-result"));
  assert.ok(snapshot.eventNodes.some((node) => node.kind === "assistant"));
  assert.equal(snapshot.requests.length, 1);
  assert.equal(snapshot.requests[0].usage.inputTokens, 12);
  assert.equal(snapshot.requests[0].providerMetadata.provider, "fixture");
});
test("original transient fold settles exactly once and detects revision gaps", () => {
  const e = new TrajectoryEngine();
  e.replace({
    cursor: 4,
    hasMore: true,
    records: initial(),
    assistantStream: { revision: 0 },
  });
  e.append({
    type: "assistant-stream",
    frame: {
      type: "start",
      revision: 1,
      attemptId: "attempt",
      turn: 1,
      step: 1,
      startedAfterSeq: 4,
    },
  });
  e.append({
    type: "assistant-stream",
    frame: {
      type: "chunk",
      revision: 2,
      index: 0,
      attemptId: "attempt",
      time: 1045,
      chunk: { type: "text-delta", index: 0, text: "answer" },
    },
  });
  assert.ok(e.snapshot().partial);
  const final = assistant();
  e.append(final);
  e.append({
    type: "assistant-stream",
    frame: {
      type: "end",
      revision: 3,
      index: 1,
      attemptId: "attempt",
      outcome: { kind: "committed", seq: 7, eventType: "assistant/message" },
    },
  });
  e.append(event(8, "step/end", { turn: 1, step: 1 }));
  assert.equal(e.snapshot().partial, null);
  assert.equal(
    e.snapshot().eventNodes.filter((node) => node.kind === "assistant").length,
    1,
  );
  assert.throws(
    () =>
      e.append({
        type: "assistant-stream",
        frame: {
          type: "start",
          revision: 7,
          attemptId: "gap",
          turn: 2,
          step: 1,
          startedAfterSeq: 8,
        },
      }),
    { code: "REBASELINE_REQUIRED" },
  );
});
