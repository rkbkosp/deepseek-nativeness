import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionProjection } from "../projection.mjs";
const ev = (seq, type, data = {}, surfaceOp = "append") => ({
  type: "event",
  event: { seq, type, data, surfaceOp },
});
const snapshot = (records = [], activeAttempt) => ({
  type: "snapshot",
  cursor: records.at(-1)?.event.seq ?? -1,
  records,
  hasMore: false,
  assistantStream: { revision: 0, ...(activeAttempt ? { activeAttempt } : {}) },
});
test("ordered durable surfaces replace in-place without retaining superseded text", () => {
  const p = new SessionProjection("s");
  p.snapshot(
    snapshot([
      ev(1, "user/message", { content: [{ type: "text", text: "hello" }] }),
      ev(2, "assistant/message", {
        message: { content: [{ type: "text", text: "old" }] },
      }),
    ]),
  );
  p.event(
    ev(
      3,
      "assistant/message",
      { message: { content: [{ type: "text", text: "new" }] } },
      { op: "replace", startSeq: 2, endSeq: 2 },
    ).event,
  );
  assert.deepEqual(
    p.value().messages.map((m) => m.text),
    ["hello", "new"],
  );
  p.event(
    ev(3, "assistant/message", {
      message: { content: [{ type: "text", text: "new" }] },
    }).event,
  );
  assert.equal(p.value().messages.length, 2);
});
test("current block-start/deltas/end and durable-before-stream-end have one surface", () => {
  const p = new SessionProjection("s");
  p.snapshot(snapshot());
  p.frame({ type: "start", revision: 1, attemptId: "a", turn: 1, step: 1 });
  p.frame({
    type: "chunk",
    revision: 2,
    attemptId: "a",
    index: 0,
    chunk: { type: "block-start", index: 0, blockType: "text" },
  });
  p.frame({
    type: "chunk",
    revision: 3,
    attemptId: "a",
    index: 1,
    chunk: { type: "text-delta", index: 0, text: "hello" },
  });
  assert.equal(p.value().messages[0].text, "hello");
  p.event(
    ev(1, "assistant/message", {
      turn: 1,
      step: 1,
      message: { content: [{ type: "text", text: "hello" }] },
    }).event,
  );
  p.frame({
    type: "end",
    revision: 4,
    attemptId: "a",
    index: 2,
    outcome: { kind: "committed", seq: 1, eventType: "assistant/message" },
  });
  assert.equal(p.value().messages.length, 1);
  assert.equal(p.value().messages[0].streaming, false);
});
test("stream-end-before-durable settles once; revision gap requires rebaseline", () => {
  const p = new SessionProjection("s");
  p.snapshot(snapshot());
  p.frame({ type: "start", revision: 1, attemptId: "a", turn: 1, step: 1 });
  p.frame({
    type: "chunk",
    revision: 2,
    attemptId: "a",
    index: 0,
    chunk: { type: "text-delta", index: 0, text: "answer" },
  });
  p.frame({
    type: "end",
    revision: 3,
    attemptId: "a",
    index: 1,
    outcome: { kind: "committed", seq: 1, eventType: "assistant/message" },
  });
  assert.equal(p.value().messages[0].streaming, false);
  p.event(
    ev(1, "assistant/message", {
      turn: 1,
      step: 1,
      message: { content: [{ type: "text", text: "answer" }] },
    }).event,
  );
  assert.equal(p.value().messages.length, 1);
  assert.throws(() => p.frame({ type: "start", revision: 5, attemptId: "b" }), {
    code: "REBASELINE_REQUIRED",
  });
});
test("reconnect baseline restores compact text and reasoning; fresh idle snapshot clears running", () => {
  const p = new SessionProjection("s");
  p.running = true;
  p.snapshot(
    snapshot([], {
      attemptId: "a",
      turn: 1,
      step: 1,
      nextIndex: 2,
      stream: [
        { type: "text-chunks", index: 0, texts: ["a", "b"] },
        { type: "reasoning-chunks", index: 1, texts: ["why"] },
      ],
    }),
  );
  assert.equal(p.value().messages[0].text, "ab");
  assert.equal(p.value().messages[0].reasoning, "why");
  assert.equal(p.running, false);
});
