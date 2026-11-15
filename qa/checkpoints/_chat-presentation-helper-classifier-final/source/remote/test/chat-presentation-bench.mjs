// Local M4 Node fixture only: not M1, RSS, transport scope bytes or full App.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { SessionProjection } from "../projection.mjs";
import { PresentationPublisher } from "../updates.mjs";
const text = (text) => ({ type: "text", text });
const ev = (seq, type, data, surfaceOp) => ({
  seq,
  time: 1700000000000 + seq,
  type,
  data,
  ...(surfaceOp ? { surfaceOp } : {}),
});
function historical(count, shape) {
  const out = [];
  if (shape === "one-long-active-turn") {
    out.push({ event: ev(0, "turn/start", { turn: 1 }) });
    for (let index = 0; index < count; index++) {
      const step = index + 1,
        seq = index * 3 + 1;
      for (const event of [
        ev(seq, "step/start", { turn: 1, step }),
        ev(
          seq + 1,
          "assistant/message",
          {
            turn: 1,
            step,
            message: {
              id: "history-" + index,
              content: [text("completed-history-" + index + "x".repeat(1024))],
            },
          },
          "append",
        ),
        ev(seq + 2, "step/end", { turn: 1, step }),
      ])
        out.push({ event });
    }
    return out;
  }
  for (let i = 0; i < count; i++) {
    const turn = i + 2,
      seq = i * 5;
    for (const e of [
      ev(seq, "turn/start", { turn }),
      ev(seq + 1, "step/start", { turn, step: 1 }),
      ev(
        seq + 2,
        "assistant/message",
        {
          turn,
          step: 1,
          message: {
            id: "history-" + i,
            content: [text("completed-history-" + i + "x".repeat(1024))],
          },
        },
        "append",
      ),
      ev(seq + 3, "step/end", { turn, step: 1 }),
      ev(seq + 4, "turn/end", { turn, reason: { kind: "completed" } }),
    ])
      out.push({ event: e });
  }
  return out;
}
function trial(count, mode, shape) {
  global.gc?.();
  const p = new SessionProjection("bench");
  const records = historical(count, shape);
  p.snapshot({
    cursor: records.at(-1).event.seq,
    records,
    assistantStream: { revision: 0 },
  });
  let bytes = 0,
    bodyBytes = 0,
    patches = 0,
    turnUpserts = 0,
    stepUpserts = 0,
    suffixes = 0,
    historicalReads = 0,
    historicalIterations = 0,
    peak = 0;
  const publisher = new PresentationPublisher((method, params) => {
    const json = JSON.stringify({ method, params });
    assert.ok(!json.includes("completed-history-"));
    bytes += Buffer.byteLength(json);
    const {
      schemaVersion,
      baselineSerial,
      presentationEpoch,
      presentationRevision,
      ...body
    } = params;
    bodyBytes += Buffer.byteLength(JSON.stringify({ method, params: body }));
    if (method === "chatPresentationPatch") {
      patches++;
      turnUpserts += params.turnUpserts.length;
      stepUpserts += params.stepUpserts.length;
    }
    if (method === "messageDelta") suffixes++;
  });
  publisher.replace(p.value());
  const boundary = records.at(-1).event.seq + 1;
  const firstStep = shape === "one-long-active-turn" ? count + 1 : 1;
  for (const map of [p.events, p.messages, p.trajectory]) {
    for (const key of ["values", "entries", "keys", Symbol.iterator]) {
      const own = map[key].bind(map);
      map[key] = function* () {
        for (const member of own()) {
          historicalIterations++;
          yield member;
        }
      };
    }
    const get = map.get.bind(map);
    map.get = (key) => {
      const value = get(key);
      if (value?.seq < boundary) historicalReads++;
      return value;
    };
  }
  let seq = boundary,
    revision = 0,
    index = 0;
  const send = (e) => p.event(e),
    flush = () => {
      publisher.patch(p.pullUpdates());
      peak = Math.max(peak, process.memoryUsage().heapUsed);
    };
  if (shape !== "one-long-active-turn")
    send(ev(seq++, "turn/start", { turn: 1 }));
  send(ev(seq++, "step/start", { turn: 1, step: firstStep }));
  flush();
  patches = turnUpserts = stepUpserts = bytes = bodyBytes = 0;
  const heapBefore = process.memoryUsage().heapUsed,
    metricBefore = p.chat.metrics.activeStepReads,
    start = performance.now();
  if (mode === "chunks") {
    p.frame({
      type: "start",
      revision: ++revision,
      attemptId: "a",
      startedAfterSeq: seq - 1,
      turn: 1,
      step: firstStep,
    });
    for (let i = 0; i < 100; i++) {
      p.frame({
        type: "chunk",
        revision: ++revision,
        attemptId: "a",
        index: index++,
        chunk: { type: "text-delta", index: 0, text: "12345678" },
      });
      flush();
    }
  } else
    for (let offset = 0; offset < 100; offset++) {
      const step = firstStep + offset;
      const id = "a-" + step;
      p.frame({
        type: "start",
        revision: ++revision,
        attemptId: id,
        startedAfterSeq: seq - 1,
        turn: 1,
        step,
      });
      p.frame({
        type: "chunk",
        revision: ++revision,
        attemptId: id,
        index: 0,
        chunk: { type: "text-delta", index: 0, text: "12345678" },
      });
      flush();
      const committed = seq++;
      send(
        ev(
          committed,
          "assistant/message",
          {
            turn: 1,
            step,
            message: { id: "live-" + step, content: [text("12345678")] },
          },
          "append",
        ),
      );
      p.frame({
        type: "end",
        revision: ++revision,
        attemptId: id,
        index: 1,
        outcome: {
          kind: "committed",
          seq: committed,
          eventType: "assistant/message",
        },
      });
      send(ev(seq++, "step/end", { turn: 1, step }));
      if (offset < 99)
        send(ev(seq++, "step/start", { turn: 1, step: step + 1 }));
      flush();
    }
  const elapsedMs = performance.now() - start;
  assert.equal(historicalIterations, 0);
  assert.ok(historicalReads <= 1);
  assert.ok(stepUpserts <= 200);
  if (mode === "chunks") {
    assert.equal(patches, 1);
    assert.ok(turnUpserts <= 1);
    assert.equal(stepUpserts, 1);
    assert.equal(suffixes, 99);
    assert.ok(bodyBytes < 25000);
  }
  return {
    completedMessages: count,
    historyShape: shape,
    operations: 100,
    mode,
    elapsedMs,
    heapPeakIncreaseBytes: Math.max(0, peak - heapBefore),
    historicalEventOrMessageIterations: historicalIterations,
    historicalTailRowLookups: historicalReads,
    activeStepMetadataReads: p.chat.metrics.activeStepReads - metricBefore,
    metadataPatches: patches,
    turnUpserts,
    stepUpserts,
    suffixes,
    methodParamsBytes: bytes,
    withoutPresentationHeaderBytes: bodyBytes,
  };
}
const result = {
  kind: "single-local-M4-Node-fixture",
  limits:
    "One synchronous sample; heap peak increase not cumulative allocation/RSS; no M1 or App performance claim; bytes omit stdio top-level account/Host scope.",
  rows: [],
};
for (const count of [1000, 10000])
  for (const shape of ["many-completed-turns", "one-long-active-turn"])
    for (const mode of ["chunks", "boundaries"])
      result.rows.push(trial(count, mode, shape));
console.log(JSON.stringify(result, null, 2));
