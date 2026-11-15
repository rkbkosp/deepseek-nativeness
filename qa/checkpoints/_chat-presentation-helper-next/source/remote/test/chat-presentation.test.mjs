import test from "node:test";
import assert from "node:assert/strict";
import { SessionProjection } from "../projection.mjs";
import { PresentationPublisher } from "../updates.mjs";
import { RemoteAdapter } from "../client.mjs";

// Schema-admissible source-derived journals, never captured Host/model output.
const text = (text) => ({ type: "text", text });
const event = (seq, type, data, surfaceOp) => ({
  seq,
  time: 1700000000000 + seq,
  type,
  data,
  ...(surfaceOp ? { surfaceOp } : {}),
});
const record = (event) => ({ type: "event", event });
const assistant = (seq, step, content, extra = {}) =>
  event(
    seq,
    "assistant/message",
    {
      turn: 1,
      step,
      message: {
        id: "message-" + seq,
        role: "assistant",
        source: { kind: "model", provider: "fixture", model: "fixture" },
        content,
      },
      stream: [],
      ...extra,
    },
    "append",
  );
const opening = [
  event(0, "turn/start", { turn: 1 }),
  event(1, "step/start", { turn: 1, step: 1 }),
  event(
    2,
    "user/message",
    {
      id: "human",
      role: "user",
      source: { kind: "user" },
      content: [text("prompt")],
    },
    "append",
  ),
];
function baseline(events = opening, activeAttempt) {
  return {
    type: "snapshot",
    cursor: events.at(-1)?.seq ?? -1,
    records: events.map(record),
    hasMore: false,
    assistantStream: {
      revision: 0,
      ...(activeAttempt ? { activeAttempt } : {}),
    },
  };
}
function fixture(events = opening) {
  const p = new SessionProjection("source-fixture");
  p.snapshot(baseline(events));
  let revision = 0,
    index = 0;
  return {
    p,
    start(extra = {}) {
      p.frame({
        type: "start",
        revision: ++revision,
        attemptId: "a",
        startedAfterSeq: 2,
        turn: 1,
        step: 1,
        ...extra,
      });
    },
    chunk(chunk) {
      p.frame({
        type: "chunk",
        revision: ++revision,
        attemptId: "a",
        index: index++,
        time: 1700000000003,
        chunk,
      });
    },
    end(outcome) {
      p.frame({
        type: "end",
        revision: ++revision,
        attemptId: "a",
        index,
        outcome,
      });
    },
  };
}
const meta = (p) => p.value().chatPresentation;

test("strict durable-before-end stays staged and commits one stable step; release is step/end", () => {
  const f = fixture(),
    { p } = f;
  f.start();
  f.chunk({ type: "text-delta", index: 0, text: "Live reply" });
  const anchor = meta(p).steps[0].anchorSeq;
  p.event(assistant(3, 1, [text("Committed reply")]));
  assert.equal(p.value().messages.at(-1).id, "attempt:a");
  assert.equal(meta(p).turns[0].spec.answerStep, null);
  f.end({ kind: "committed", seq: 3, eventType: "assistant/message" });
  assert.equal(
    p.value().messages.filter((m) => m.role === "assistant").length,
    1,
  );
  assert.equal(p.value().messages.at(-1).id, "event:3");
  assert.equal(meta(p).steps[0].nodeKey, "14:assistant-step1:1");
  assert.equal(meta(p).steps[0].anchorSeq, anchor);
  assert.equal(meta(p).steps[0].committedMessageId, "message-3");
  assert.equal(meta(p).turns[0].spec.answerStep, 1);
  assert.equal(p.attempt.retained, true);
  // The original fold has no active attempt after end; retained identity only
  // delays retirement. Late suffix/end frames must not mutate that prefix.
  f.chunk({ type: "text-delta", index: 0, text: "late ignored" });
  f.end({ kind: "committed", seq: 3, eventType: "assistant/message" });
  assert.equal(p.attempt.retained, true);
  assert.equal(meta(p).steps[0].anchorSeq, anchor);
  assert.equal(p.value().messages.at(-1).text, "Committed reply");
  assert.throws(() => f.start({ attemptId: "other" }), {
    code: "REBASELINE_REQUIRED",
  });
  p.event(event(4, "step/end", { turn: 1, step: 1 }));
  assert.equal(p.attempt, undefined);
  assert.equal(meta(p).steps[0].anchorSeq, 3);
});

test("strict missing, wrong, duplicate and abandoned staged settlements request rebaseline", () => {
  for (const scenario of ["missing", "wrong", "duplicate", "abandoned"]) {
    const f = fixture();
    f.start();
    f.chunk({ type: "text-delta", index: 0, text: "x" });
    const durable = assistant(3, 1, [text("done")]);
    if (scenario !== "missing") f.p.event(durable);
    const action =
      scenario === "duplicate"
        ? () => f.p.event(durable)
        : () =>
            f.end(
              scenario === "abandoned"
                ? { kind: "abandoned" }
                : {
                    kind: "committed",
                    seq: 3,
                    eventType:
                      scenario === "wrong"
                        ? "assistant/attempt"
                        : "assistant/message",
                  },
            );
    assert.throws(action, { code: "REBASELINE_REQUIRED" }, scenario);
  }
});

test("published reconnect settlement retires only active prefix and preserves durable body", () => {
  const p = new SessionProjection("s"),
    durable = assistant(3, 1, [text("already durable")]);
  p.snapshot(
    baseline([...opening, durable], {
      attemptId: "a",
      turn: 1,
      step: 1,
      startedAfterSeq: 2,
      nextIndex: 1,
      stream: [
        {
          type: "text-chunks",
          index: 0,
          texts: ["prefix"],
          time0: 1700000000003,
        },
      ],
    }),
  );
  p.frame({
    type: "end",
    revision: 1,
    attemptId: "a",
    index: 1,
    outcome: { kind: "committed", seq: 3, eventType: "assistant/message" },
  });
  assert.equal(p.attempt, undefined);
  assert.deepEqual(
    p
      .value()
      .messages.filter((m) => m.role === "assistant")
      .map((m) => m.text),
    ["already durable"],
  );
  assert.equal(meta(p).steps[0].payloadId, "event:3");
});

test("discarded attempts never become committed replies; replacement is not matching settlement", () => {
  const f = fixture();
  f.start();
  f.chunk({ type: "text-delta", index: 0, text: "discard me" });
  f.p.event(event(3, "assistant/attempt", { turn: 1, step: 1, stream: [] }));
  f.end({ kind: "committed", seq: 3, eventType: "assistant/attempt" });
  assert.equal(
    f.p.value().messages.some((m) => m.role === "assistant"),
    false,
  );
  assert.equal(meta(f.p).steps.length, 0);
  const g = fixture();
  g.start();
  g.p.event({
    ...assistant(3, 1, [text("surface correction")]),
    surfaceOp: { op: "replace", startSeq: 2, endSeq: 2 },
  });
  assert.equal(g.p.pendingAssistant.size, 0);
  assert.ok(g.p.attempt);
});

test("retry clears final qualification without hiding raw records and partial history remains readable", () => {
  const p = new SessionProjection("s");
  p.snapshot(baseline([...opening, assistant(3, 1, [text("old reply")])]));
  p.event(
    event(4, "llm/retry", { turn: 1, step: 1, reason: { kind: "retry" } }),
  );
  assert.equal(meta(p).steps.length, 0);
  assert.equal(meta(p).turns[0].spec.answerStep, null);
  assert.ok(p.events.has(3));
  const q = new SessionProjection("q");
  q.snapshot(
    baseline([
      assistant(3, 1, [
        {
          type: "file",
          attachment: { attachmentId: "f", bytes: 1, name: "f" },
        },
      ]),
      event(4, "step/end", { turn: 1, step: 1 }),
      event(5, "turn/end", { turn: 1, reason: { kind: "completed" } }),
    ]),
  );
  assert.equal(meta(q).turns[0].status, "closed");
  assert.equal(meta(q).turns[0].startLoaded, false);
  assert.equal(meta(q).turns[0].foldEligible, true);
  assert.equal(meta(q).turns[0].spec.answerStep, 1);
  assert.equal(meta(q).steps[0].hasReply, true);
});

test("history rebuild mints once, keeps staged publication and live anchor, reads mint nothing", () => {
  const f = fixture(opening.slice(1));
  f.start();
  f.chunk({ type: "text-delta", index: 0, text: "live" });
  const before = meta(f.p),
    anchor = before.steps[0].anchorSeq;
  f.p.event(assistant(3, 1, [text("durable")]));
  f.p.mergeHistory([record(opening[0])]);
  const after = meta(f.p);
  assert.ok(after.baselineSerial > before.baselineSerial);
  assert.equal(after.steps[0].anchorSeq, anchor);
  assert.equal(f.p.value().messages.at(-1).id, "attempt:a");
  for (let i = 0; i < 5; i++) {
    f.p.value();
    f.p.pullUpdates();
  }
  assert.equal(meta(f.p).baselineSerial, after.baselineSerial);
  f.end({ kind: "committed", seq: 3, eventType: "assistant/message" });
  assert.equal(meta(f.p).steps[0].payloadId, "event:3");
});

test("structural arena changes and eligibility are one atomic patch; suffix is metadata-free", () => {
  const f = fixture(),
    notes = [];
  const publisher = new PresentationPublisher((method, params) =>
    notes.push({ method, params }),
  );
  publisher.replace(f.p.value());
  f.start();
  f.chunk({ type: "text-delta", index: 0, text: "one" });
  publisher.patch(f.p.pullUpdates());
  let patch = notes.find((x) => x.method === "chatPresentationPatch").params;
  assert.equal(patch.baseRevision, 0);
  assert.equal(patch.presentationRevision, 1);
  assert.equal(
    patch.stepUpserts[0].payloadId,
    patch.payloadChanges.upserts[0].message.id,
  );
  notes.length = 0;
  f.chunk({ type: "text-delta", index: 0, text: " two" });
  publisher.patch(f.p.pullUpdates());
  assert.equal(
    notes.filter((x) => x.method === "chatPresentationPatch").length,
    0,
  );
  assert.equal(notes[0].method, "messageDelta");
  assert.equal(notes[0].params.presentationRevision, 1);
  notes.length = 0;
  f.p.event(assistant(3, 1, [text("final")]));
  publisher.patch(f.p.pullUpdates());
  assert.equal(
    notes.some((x) => x.method === "chatPresentationPatch"),
    false,
  );
  f.end({ kind: "committed", seq: 3, eventType: "assistant/message" });
  publisher.patch(f.p.pullUpdates());
  patch = notes.find((x) => x.method === "chatPresentationPatch").params;
  assert.equal(patch.baseRevision, 1);
  assert.equal(patch.presentationRevision, 2);
  assert.deepEqual(patch.payloadChanges.removes, ["attempt:a"]);
  assert.equal(patch.payloadChanges.upserts[0].message.id, "event:3");
  assert.equal(patch.stepUpserts[0].payloadId, "event:3");
  assert.equal(patch.turnUpserts[0].spec.answerStep, 1);
});

test("actual adapter initial-open and older-page announce baseline before RPC return or deltas", async () => {
  const order = [],
    frames = [];
  const adapter = new RemoteAdapter((method, params) => {
    order.push(method);
    frames.push({ method, params });
  });
  adapter.sessionRows = [{ id: "s" }];
  let stopStream;
  const held = new Promise((resolve) => {
    stopStream = resolve;
  });
  adapter.gateway = {
    async open(endpoint, payload, signal) {
      assert.equal(endpoint, "session/follow");
      assert.equal(payload.args.request.activate, undefined);
      return (async function* () {
        yield baseline(opening.slice(1));
        await held;
      })();
    },
    async invoke() {
      return {
        records: [record(opening[0])],
        hasMore: false,
      };
    },
  };
  const result = await adapter.openSession("s");
  order.push("open-rpc");
  assert.equal(order[0], "snapshot");
  assert.equal(order[1], "open-rpc");
  const serial = result.chatPresentation.baselineSerial;
  const older = await adapter.history({});
  order.push("history-rpc");
  assert.equal(order.at(-2), "snapshot");
  assert.equal(order.at(-1), "history-rpc");
  assert.ok(older.chatPresentation.baselineSerial > serial);
  assert.equal(
    frames.at(-1).params.chatPresentation.baselineSerial,
    older.chatPresentation.baselineSerial,
  );
  adapter.followStop.abort();
  adapter.lifetime.abort();
  stopStream();
  clearTimeout(adapter.snapshotTimer);
});
