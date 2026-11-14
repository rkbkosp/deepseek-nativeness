import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionProjection } from "../projection.mjs";
const row = (seq, type, data) => ({
  type: "event",
  event: { seq, type, data, time: 1000 + seq, surfaceOp: "append" },
});
test("durable source drives context/steering instead of hiding strings", () => {
  const p = new SessionProjection("s");
  p.snapshot({
    cursor: 5,
    records: [
      row(1, "user/message", {
        source: { kind: "user" },
        content: [
          {
            type: "text",
            text: "<system-reminder> user text </system-reminder>",
          },
        ],
      }),
      row(2, "turn/start", { turn: 1 }),
      row(3, "user/message", {
        source: {
          kind: "skill-invocation",
          name: "review",
          form: "instructions",
        },
        content: [{ type: "text", text: "complete skill original" }],
      }),
      row(4, "assistant/message", {
        turn: 1,
        step: 1,
        message: {
          content: [
            { type: "reasoning", text: "think" },
            { type: "text", text: "answer" },
          ],
        },
      }),
      row(5, "turn/end", { turn: 1, reason: "completed" }),
    ],
  });
  const v = p.value();
  assert.equal(v.messages[0].kind, "user");
  assert.match(v.messages[0].text, /system-reminder/);
  assert.equal(v.messages[1].kind, "context");
  assert.equal(v.messages[1].context.producer.label, "review");
  assert.equal(v.messages[1].context.form, "instructions");
  assert.equal(v.messages[1].text, "complete skill original");
  assert.equal(v.messages[1].collapsed, true);
  assert.deepEqual(v.messages[2].assistantBlocks, [
    { kind: "reasoning", text: "think" },
    { kind: "text", text: "answer" },
  ]);
  assert.equal(v.trajectory.length, 5);
  assert.equal(v.turns[0].status, "closed");
});
test("tool call/result become one anchored row and retain both raw trajectory records", () => {
  const p = new SessionProjection("s");
  p.snapshot({
    cursor: 3,
    records: [
      row(1, "tool/call", {
        callId: "call",
        name: "read",
        arguments: '{"path":"a"}',
        turn: 2,
        step: 1,
      }),
      row(2, "tool/result", {
        callId: "call",
        name: "read",
        message: {
          content: [{ type: "text", text: "whole result" }],
          isError: false,
        },
      }),
      row(3, "system/message", { content: [{ type: "text", text: "prompt" }] }),
    ],
  });
  const v = p.value();
  assert.equal(v.messages.length, 1);
  assert.equal(v.messages[0].id, "tool:call");
  assert.equal(v.messages[0].seq, 1);
  assert.equal(v.messages[0].tool.argsRaw, '{"path":"a"}');
  assert.equal(v.messages[0].tool.phase, "settled");
  assert.equal(v.messages[0].text, "whole result");
  assert.equal(v.trajectory.length, 3);
});
test("Host projection baselines and sequenced control changes do not depend on loaded history", () => {
  const p = new SessionProjection("s");
  const baseline = {
    kind: "sequenced",
    asOfSeq: 30,
    values: {
      modelSelection: { lastUsed: null, next: { provider: "p", model: "m" } },
      permissions: { currentValue: "read-only" },
      inbox: { "next-step": [], "next-turn": [] },
    },
  };
  p.snapshot({ cursor: 30, records: [], projections: baseline });
  assert.equal(p.value().projections, baseline);
  p.applyProjectionUpdate({
    seq: 31,
    changes: [
      {
        key: "inbox",
        val: {
          "next-step": [],
          "next-turn": [
            {
              id: "queued",
              content: [{ type: "text", text: "fixture pending" }],
            },
          ],
        },
      },
    ],
  });
  p.applyProjectionUpdate({
    seq: 29,
    changes: [{ key: "permissions", val: { currentValue: "stale" } }],
  });
  assert.equal(p.value().projections.values.inbox["next-turn"][0].id, "queued");
  assert.equal(
    p.value().projections.values.permissions.currentValue,
    "read-only",
  );
  p.mergeHistory([]);
  assert.equal(p.value().projections.asOfSeq, 31);
});
