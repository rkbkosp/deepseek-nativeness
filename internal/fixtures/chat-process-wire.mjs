// Local-only real projection/publisher peer. No Remote transport, identity,
// network or Host task. RPC baselines intentionally race the same event queue.
import { createInterface } from "node:readline";
import { SessionProjection } from "../../remote/projection.mjs";
import { PresentationPublisher } from "../../remote/updates.mjs";
const scope = { hostId: "chat-fixture-host", generation: 1, accountScope: "chat-fixture-account" };
const write = value => process.stdout.write(JSON.stringify(value) + "\n");
const copy = value => JSON.parse(JSON.stringify(value));
const event = (seq, type, data) => ({ seq, time: 1700000000000 + seq, type, data, surfaceOp: "append" });
const records = [event(0, "turn/start", { turn: 1 }), event(1, "step/start", { turn: 1, step: 1 }),
  event(2, "user/message", { source: { kind: "user" }, content: [{ type: "text", text: "Local source fixture" }] }),
  event(3, "assistant/message", { turn: 1, step: 1, message: { id: "first-committed", content: [{ type: "text", text: "Earlier reply" }] }, stream: [] }),
  event(4, "step/end", { turn: 1, step: 1 })];
createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", line => {
  const request = JSON.parse(line);
  if (request.method !== "fixture.chat") { write({ id: request.id, error: { code: "FIXTURE_ONLY", message: "Fixture only." } }); return; }
  const p = new SessionProjection("chat-wire-session");
  p.snapshot({ cursor: 4, hasMore: true, records: records.map(event => ({ type: "event", event })), assistantStream: { revision: 0 } });
  const emit = (method, params) => write({ method, params, scope });
  const pub = new PresentationPublisher(emit);
  const oldBaseline = copy(p.value()); pub.replace(p.value()); emit("snapshot", oldBaseline);
  p.event(event(5, "step/start", { turn: 1, step: 2 }));
  p.event(event(6, "assistant/message", { turn: 1, step: 2, message: { id: "second-committed", content: [{ type: "reasoning", text: "Independent block" }, { type: "file", attachment: { name: "fixture.csv", attachmentId: "local-only", bytes: 4 } }] }, stream: [] }));
  p.event(event(7, "step/end", { turn: 1, step: 2 }));p.event(event(8, "turn/end", { turn: 1, reason: { kind: "completed" } }));
  pub.patch(p.pullUpdates());
  // A real rebaseline mints a higher serial. Its notification precedes every
  // dependent publication; either RPC copy can be consumed at any later point.
  const fullRecords = [...records, event(5, "step/start", { turn: 1, step: 2 }), event(6, "assistant/message", { turn: 1, step: 2, message: { id: "second-committed", content: [{ type: "reasoning", text: "Independent block" }, { type: "file", attachment: { name: "fixture.csv", attachmentId: "local-only", bytes: 4 } }] }, stream: [] }), event(7, "step/end", { turn: 1, step: 2 }), event(8, "turn/end", { turn: 1, reason: { kind: "completed" } }), event(9, "turn/start", { turn: 2 }), event(10, "step/start", { turn: 2, step: 1 })];
  p.snapshot({ cursor: 10, hasMore: false, records: fullRecords.map(event => ({ type: "event", event })), assistantStream: { revision: 0 } });
  const newBaseline = copy(p.value());pub.replace(p.value());emit("snapshot", newBaseline);
  p.frame({ type: "start", attemptId: "wire-live", revision: 1, turn: 2, step: 1 });
  p.frame({ type: "chunk", attemptId: "wire-live", revision: 2, index: 0, chunk: { type: "block-start", index: 0, blockType: "text" } });
  p.frame({ type: "chunk", attemptId: "wire-live", revision: 3, index: 1, chunk: { type: "text-delta", index: 0, text: "Live" } });pub.patch(p.pullUpdates());
  p.frame({ type: "chunk", attemptId: "wire-live", revision: 4, index: 2, chunk: { type: "text-delta", index: 0, text: " suffix" } });pub.patch(p.pullUpdates());
  emit("fixtureComplete", { marker: "chat-wire" });
  write({ id: request.id, result: { oldBaseline, newBaseline, expected: p.value() } });
});
