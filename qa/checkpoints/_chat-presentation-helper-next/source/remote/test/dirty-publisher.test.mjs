import test from "node:test";
import assert from "node:assert/strict";
import { SessionProjection } from "../projection.mjs";
import { PresentationPublisher } from "../updates.mjs";
import { RemoteAdapter } from "../client.mjs";

const event = (seq, type, data, surfaceOp) => ({
  seq,
  type,
  time: seq,
  data,
  ...(surfaceOp ? { surfaceOp } : {}),
});
function mirrorOf(projection) {
  const initial = projection.value();
  let messages = structuredClone(initial.messages);
  const notes = [];
  const apply = (method, params) => {
    if (method === "chatPresentationPatch") {
      const changes = params.payloadChanges;
      apply("messageRemove", { ids: changes.removes });
      for (const row of changes.upserts) apply("messageUpsert", row);
      for (const delta of changes.deltas ?? []) apply("messageDelta", delta);
    }
    if (method === "messageRemove")
      messages = messages.filter((row) => !params.ids.includes(row.id));
    if (method === "messageUpsert") {
      messages = messages.filter((row) => row.id !== params.message.id);
      messages.splice(params.index, 0, structuredClone(params.message));
    }
    if (method === "messageDelta") {
      const row = messages.find((row) => row.id === params.messageId);
      row.text += params.textAppend;
      row.reasoning = (row.reasoning ?? "") + params.reasoningAppend;
      row.reasoningDisplay =
        (row.reasoningDisplay ?? "") + params.reasoningDisplayAppend;
      row.streaming = params.streaming;
      if (params.textBlockIndex !== undefined)
        row.assistantBlocks[params.textBlockIndex].text += params.textAppend;
      if (params.reasoningBlockIndex !== undefined)
        row.assistantBlocks[params.reasoningBlockIndex].text +=
          params.reasoningAppend;
    }
  };
  const publisher = new PresentationPublisher((method, params) => {
    notes.push({ method, params });
    apply(method, params);
  });
  publisher.replace(initial);
  return {
    publisher,
    notes,
    flush() {
      publisher.patch(projection.pullUpdates());
      assert.deepEqual(messages, projection.value().messages);
    },
  };
}

test("metadata-only image, attachment and timing changes upsert the complete original block structure", () => {
  const notes = [],
    publisher = new PresentationPublisher((method, params) =>
      notes.push({ method, params }),
    );
  const image = {
    kind: "image",
    attachment: {
      attachmentId: "fixture-image",
      mediaType: "image/png",
      bytes: 12,
      width: 2,
      height: 3,
      name: "fixture.png",
    },
  };
  const base = {
    sessionId: "fixture-session",
    messages: [
      {
        id: "attempt:a",
        role: "assistant",
        text: "stable",
        reasoning: "",
        reasoningDisplay: "",
        streaming: true,
        assistantBlocks: [{ kind: "text", text: "stable" }],
      },
    ],
    pending: [],
    cursor: 1,
    running: true,
    hasMore: false,
  };
  publisher.replace(base);
  publisher.flush({
    ...base,
    messages: [
      {
        ...base.messages[0],
        assistantBlocks: [{ kind: "text", text: "stable" }, image],
      },
    ],
  });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].method, "messageUpsert");
  assert.deepEqual(notes[0].params.message.assistantBlocks[1], image);
  const updated = { ...notes[0].params.message, time: 123 };
  publisher.flush({ ...base, messages: [updated] });
  assert.equal(notes.at(-1).method, "messageUpsert");
  assert.equal(notes.at(-1).params.message.time, 123);
});

test("dirty publications replay text/reasoning blocks, tool settlement and positional replacement exactly", () => {
  const projection = new SessionProjection("fixture-session");
  projection.snapshot({
    cursor: 3,
    records: [
      {
        event: event(1, "user/message", {
          source: { kind: "user" },
          content: [{ type: "text", text: "first" }],
        }),
      },
      {
        event: event(2, "assistant/message", {
          message: { content: [{ type: "text", text: "old" }] },
        }),
      },
      {
        event: event(3, "user/message", {
          source: { kind: "user" },
          content: [{ type: "text", text: "last" }],
        }),
      },
    ],
  });
  const wire = mirrorOf(projection);
  let revision = 1,
    index = 0;
  projection.frame({
    type: "start",
    revision: revision++,
    attemptId: "a",
    turn: 1,
    step: 1,
  });
  const chunk = (chunk) =>
    projection.frame({
      type: "chunk",
      revision: revision++,
      attemptId: "a",
      index: index++,
      time: 10,
      chunk,
    });
  chunk({ type: "text-delta", index: 0, text: "hello" });
  wire.flush();
  chunk({ type: "text-delta", index: 0, text: " world" });
  wire.flush();
  assert.equal(wire.notes.at(-1).params.textBlockIndex, 0);
  chunk({ type: "block-start", index: 1, blockType: "reasoning" });
  chunk({ type: "reasoning-delta", index: 1, text: "Thinking" });
  wire.flush();
  chunk({ type: "reasoning-delta", index: 1, text: " more" });
  wire.flush();
  assert.equal(wire.notes.at(-1).params.reasoningBlockIndex, 1);
  chunk({
    type: "tool-call-delta",
    index: 2,
    id: "call-1",
    name: "fixture-tool",
    argumentsDelta: "{}",
  });
  wire.flush();
  projection.event(
    event(4, "tool/call", {
      callId: "call-1",
      name: "fixture-tool",
      arguments: "{}",
      turn: 1,
      step: 1,
    }),
  );
  wire.flush();
  projection.event(
    event(5, "assistant/message", {
      turn: 1,
      step: 1,
      message: {
        content: [
          { type: "text", text: "hello world" },
          { type: "reasoning", text: "Thinking more" },
        ],
      },
    }),
  );
  wire.flush();
  projection.event(
    event(
      6,
      "assistant/message",
      { message: { content: [{ type: "text", text: "replacement" }] } },
      { op: "replace", startSeq: 2, endSeq: 2 },
    ),
  );
  wire.flush();
  assert.equal(
    wire.notes.some((note) => note.method === "snapshot"),
    false,
  );
});

test("one thousand and ten thousand completed rows are never visited by one hundred chunk publications", () => {
  for (const historyCount of [1000, 10000]) {
    const projection = new SessionProjection("fixture-session");
    projection.snapshot({
      cursor: historyCount,
      records: Array.from({ length: historyCount }, (_, i) => ({
        event: event(i + 1, "user/message", {
          source: { kind: "user" },
          content: [
            { type: "text", text: "completed-" + i + "-" + "x".repeat(1024) },
          ],
        }),
      })),
    });
    const notes = [],
      publisher = new PresentationPublisher((method, params) =>
        notes.push({ method, params }),
      );
    publisher.replace(projection.value());
    let historyReads = 0;
    const getMessage = projection.messages.get.bind(projection.messages),
      getEvent = projection.trajectory.get.bind(projection.trajectory);
    projection.messages.get = (key) => {
      historyReads++;
      return getMessage(key);
    };
    projection.trajectory.get = (key) => {
      historyReads++;
      return getEvent(key);
    };
    projection.frame({
      type: "start",
      revision: 1,
      attemptId: "a",
      turn: 1,
      step: 1,
    });
    for (let i = 0; i < 100; i++) {
      projection.frame({
        type: "chunk",
        revision: i + 2,
        attemptId: "a",
        index: i,
        chunk: { type: "text-delta", index: 0, text: "12345678" },
      });
      publisher.patch(projection.pullUpdates());
    }
    assert.equal(historyReads, 0);
    const serialized = notes.map((note) => JSON.stringify(note));
    assert.equal(
      serialized.some((note) => note.includes("completed-")),
      false,
    );
    assert.ok(
      // Versioned scope/header adds a fixed per-frame cost; history stays absent.
      serialized.reduce((n, line) => n + Buffer.byteLength(line), 0) < 50000,
    );
    const withoutFixedHeader = notes.map(({ method, params }) => {
      const {
        schemaVersion,
        baselineSerial,
        presentationEpoch,
        presentationRevision,
        ...body
      } = params;
      return JSON.stringify({ method, params: body });
    });
    assert.ok(
      withoutFixedHeader.reduce(
        (sum, line) => sum + Buffer.byteLength(line),
        0,
      ) < 25000,
    );
    assert.equal(publisher.messages.size, historyCount + 1);
  }
});

test("the real scheduled adapter path consumes dirty updates without constructing a history snapshot", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const projection = new SessionProjection("fixture-session");
  projection.snapshot({
    cursor: 10000,
    records: Array.from({ length: 10000 }, (_, i) => ({
      event: event(i + 1, "user/message", {
        source: { kind: "user" },
        content: [{ type: "text", text: "history-" + i }],
      }),
    })),
  });
  projection.running = true;
  const frames = [],
    adapter = new RemoteAdapter((method, params) =>
      frames.push({ method, params }),
    );
  adapter.projection = projection;
  adapter.publisher.replace(projection.value());
  adapter.snapshot = () => {
    throw Error("A chunk flush rebuilt full history");
  };
  let historyReads = 0;
  const get = projection.messages.get.bind(projection.messages);
  projection.messages.get = (key) => {
    historyReads++;
    return get(key);
  };
  projection.frame({
    type: "start",
    revision: 1,
    attemptId: "a",
    turn: 1,
    step: 1,
  });
  for (let i = 0; i < 100; i++) {
    projection.frame({
      type: "chunk",
      revision: i + 2,
      attemptId: "a",
      index: i,
      chunk: { type: "text-delta", index: 0, text: "12345678" },
    });
    adapter.scheduleSnapshot();
    t.mock.timers.tick(16);
  }
  assert.equal(historyReads, 0);
  assert.equal(
    frames.filter((frame) => frame.method === "chatPresentationPatch").length,
    1,
  );
  assert.equal(
    frames.filter((frame) => frame.method === "messageDelta").length,
    99,
  );
  assert.equal(
    frames.some((frame) => frame.method === "snapshot"),
    false,
  );
});
