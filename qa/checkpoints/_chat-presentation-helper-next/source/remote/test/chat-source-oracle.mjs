// Explicit QA-only gate: build pinned source closure with
// node qa/_chat-process-audit/build.mjs before running this file.
import test from "node:test";
import assert from "node:assert/strict";
import { SessionProjection } from "../projection.mjs";
import {
  original,
  summary,
  ClientAssistantStream,
} from "../../qa/_chat-process-audit/build/original.mjs";
const r = (seq, type, data, surfaceOp) => ({
  type: "event",
  event: {
    seq,
    time: 1700000000000 + seq,
    type,
    data,
    ...(surfaceOp ? { surfaceOp } : {}),
  },
});
const text = (text) => ({ type: "text", text });
const assistant = (seq, step, content, extra = {}) =>
  r(
    seq,
    "assistant/message",
    {
      turn: 1,
      step,
      message: {
        id: "message-" + seq,
        role: "assistant",
        source: {
          kind: "model",
          provider: "source-fixture",
          model: "source-fixture",
        },
        content,
      },
      stream: [],
      ...extra,
    },
    "append",
  );
const opening = [
  r(0, "turn/start", { turn: 1 }),
  r(1, "step/start", { turn: 1, step: 1 }),
  r(
    2,
    "user/message",
    {
      id: "human",
      role: "user",
      source: { kind: "user" },
      content: [text("fixture")],
    },
    "append",
  ),
];
const close = (seq, step = 2) => [
  r(seq, "step/end", { turn: 1, step }),
  r(seq + 1, "turn/end", { turn: 1, reason: { kind: "completed" } }),
];
const first = [
  ...opening,
  assistant(3, 1, [text("earlier")]),
  r(4, "step/end", { turn: 1, step: 1 }),
  r(5, "step/start", { turn: 1, step: 2 }),
];
const content = {
  empty: [],
  reasoning: [{ type: "reasoning", text: "reasoning" }],
  whitespace: [text(" \n\t")],
  unknown: [
    { type: "file", attachment: { attachmentId: "f", bytes: 1, name: "f" } },
  ],
  image: [
    {
      type: "image",
      attachment: {
        attachmentId: "i",
        mediaType: "image/png",
        bytes: 1,
        width: 2,
        height: 2,
      },
    },
  ],
  mixed: [text("A"), { type: "reasoning", text: "middle" }, text("B")],
  textAndTool: [
    text("tool preamble"),
    { type: "tool-call", id: "c", name: "read", arguments: "{}" },
  ],
};
function check(p, a, label) {
  const expected = summary(a),
    actual = p.value().chatPresentation;
  assert.deepEqual(
    actual.turns[0]?.spec,
    expected.process ?? null,
    label + " spec",
  );
  for (const node of expected.nodes.filter(
    (n) => n.kind === "assistant-step" && n.visibility === "visible",
  )) {
    const step = actual.steps.find((x) => x.nodeKey === node.key);
    assert.ok(step, label + " visible " + node.key);
    assert.equal(step.anchorSeq, node.anchorSeq, label + " anchor");
    assert.equal(step.status, node.status, label + " status");
    assert.equal(
      step.finalEventSeq,
      node.final?.seq ?? null,
      label + " final identity",
    );
  }
  return actual;
}

test("latest-step, structured closing content, counts and partial windows match pinned pure original", () => {
  for (const [name, blocks] of Object.entries(content)) {
    const records = [...first, assistant(6, 2, blocks), ...close(7)];
    const p = new SessionProjection(name);
    p.snapshot({ cursor: 8, records, assistantStream: { revision: 0 } });
    check(p, original(records), name);
  }
  for (const records of [
    [...first, ...close(6)],
    [assistant(6, 2, content.unknown), ...close(7)],
    [
      ...first,
      assistant(6, 2, content.mixed),
      r(7, "llm/retry", { turn: 1, step: 2 }),
      ...close(8),
    ],
  ]) {
    const p = new SessionProjection("partial");
    p.snapshot({
      cursor: records.at(-1).event.seq,
      records,
      assistantStream: { revision: 0 },
    });
    check(p, original(records), "partial/retry");
  }
});

test("actual ClientAssistantStream stages, retains, retires and reanchors stable node identically", () => {
  const fold = new ClientAssistantStream(),
    p = new SessionProjection("retained");
  p.snapshot({ cursor: 2, records: opening, assistantStream: { revision: 0 } });
  const a = original(fold.replace(opening));
  const start = {
    type: "start",
    revision: 1,
    attemptId: "a",
    startedAfterSeq: 2,
    turn: 1,
    step: 1,
  };
  fold.acceptFrame(start);
  p.frame(start);
  const chunk = {
    type: "chunk",
    revision: 2,
    attemptId: "a",
    index: 0,
    time: 1700000000003,
    chunk: { type: "text-delta", index: 0, text: "live" },
  };
  a.append(fold.acceptFrame(chunk).entry);
  a.flush();
  p.frame(chunk);
  check(p, a, "live");
  const durable = assistant(3, 1, [text("settled")]);
  assert.equal(fold.acceptDurable(durable), undefined);
  p.event(durable.event);
  check(p, a, "staged");
  const end = {
    type: "end",
    revision: 3,
    attemptId: "a",
    index: 1,
    outcome: { kind: "committed", seq: 3, eventType: "assistant/message" },
  };
  a.append(fold.acceptFrame(end).entry);
  a.flush();
  p.frame(end);
  check(p, a, "retained");
  const step = r(4, "step/end", { turn: 1, step: 1 }),
    release = fold.acceptDurable(step);
  a.append(release.entry);
  a.settleAssistant(release.retireAttemptId);
  a.flush();
  p.event(step.event);
  check(p, a, "released");
});

test("raw append origin survives model-surface replacement with exact original answer identity", () => {
  const records = [
    ...opening,
    assistant(3, 1, [text("original")]),
    {
      ...assistant(4, 1, [text("model replacement")]),
      event: {
        ...assistant(4, 1, [text("model replacement")]).event,
        surfaceOp: { op: "replace", startSeq: 3, endSeq: 3 },
      },
    },
    ...close(5, 1),
  ];
  const p = new SessionProjection("replace");
  p.snapshot({ cursor: 6, records, assistantStream: { revision: 0 } });
  check(p, original(records), "replace");
  assert.equal(
    p.value().chatPresentation.steps[0].committedMessageId,
    "message-3",
  );
});
