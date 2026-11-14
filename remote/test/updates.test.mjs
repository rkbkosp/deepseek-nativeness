import { test } from "node:test";
import assert from "node:assert/strict";
import { PresentationPublisher } from "../updates.mjs";
test("stream notifications serialize only changed suffix, regardless of completed history size", () => {
  const frames = [];
  const publisher = new PresentationPublisher((method, params) =>
    frames.push({ method, params }),
  );
  const history = Array.from({ length: 1000 }, (_, i) => ({
    id: `event:${i}`,
    role: "assistant",
    text: "completed-history-" + String(i) + "-" + "x".repeat(1024),
    streaming: false,
  }));
  const state = {
    sessionId: "s",
    messages: history,
    pending: [],
    running: true,
    cursor: 999,
    hasMore: true,
  };
  publisher.replace(state);
  let text = "";
  for (let i = 0; i < 100; i++) {
    text += "12345678";
    publisher.flush({
      ...state,
      messages: [
        ...history,
        {
          id: "attempt:a",
          role: "assistant",
          text,
          reasoning: "",
          streaming: true,
        },
      ],
    });
  }
  const wire = frames.map((frame) => JSON.stringify(frame));
  const bytes = wire.reduce((sum, value) => sum + Buffer.byteLength(value), 0);
  assert.equal(frames.filter((f) => f.method === "snapshot").length, 0);
  assert.equal(frames.filter((f) => f.method === "messageUpsert").length, 1);
  assert.equal(frames.filter((f) => f.method === "messageDelta").length, 99);
  assert.ok(wire.every((value) => !value.includes("completed-history-")));
  assert.ok(bytes < 20000, `incremental wire bytes=${bytes}`);
  console.log(
    JSON.stringify({
      test: "incremental-wire-budget",
      completedMessages: 1000,
      chunkFlushes: 100,
      notifications: frames.length,
      bytes,
    }),
  );
});
test("canonical block corrections upsert only that message; settlement removes transient", () => {
  const frames = [];
  const p = new PresentationPublisher((method, params) =>
    frames.push({ method, params }),
  );
  const base = {
    sessionId: "s",
    messages: [
      { id: "attempt:a", role: "assistant", text: "partial", streaming: true },
    ],
    pending: [],
    running: true,
    cursor: 0,
    hasMore: false,
  };
  p.replace(base);
  p.flush({
    ...base,
    messages: [
      { id: "attempt:a", role: "assistant", text: "correct", streaming: true },
    ],
  });
  assert.equal(frames[0].method, "messageUpsert");
  p.flush({
    ...base,
    messages: [
      { id: "event:1", role: "assistant", text: "correct", streaming: false },
    ],
  });
  assert.equal(frames[1].method, "messageRemove");
  assert.deepEqual(frames[1].params.ids, ["attempt:a"]);
  assert.equal(frames[2].method, "messageUpsert");
});
