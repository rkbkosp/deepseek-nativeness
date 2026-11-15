import { isDeepStrictEqual } from "node:util";
// Initial baselines scan history once; dirty publications touch only changed rows.
export class PresentationPublisher {
  constructor(emit) {
    this.emit = emit;
    this.messages = new Map();
    this.stateKey = "";
    this.pendingKey = "";
    this.sessionId = undefined;
    this.trajectory = new Map();
  }
  replace(snapshot) {
    this.sessionId = snapshot.sessionId;
    this.messages = new Map(
      snapshot.messages.map((message) => [message.id, message]),
    );
    this.stateKey = stateKey(snapshot);
    this.pendingKey = pendingKey(snapshot.pending);
    this.projections = snapshot.projections;
    this.trajectory = new Map(
      (snapshot.trajectory ?? []).map((event) => [event.id, event]),
    );
    snapshot.acknowledge?.();
  }
  message(sessionId, message, index) {
    const previous = this.messages.get(message.id);
    if (previous === message) return;
    const blockDelta =
      previous && message.id.startsWith("attempt:")
        ? safeBlockDelta(previous, message)
        : undefined;
    if (
      previous &&
      blockDelta &&
      message.text.startsWith(previous.text) &&
      String(message.reasoning ?? "").startsWith(previous.reasoning ?? "") &&
      String(message.reasoningDisplay ?? "").startsWith(
        previous.reasoningDisplay ?? "",
      )
    ) {
      const textAppend = message.text.slice(previous.text.length),
        reasoningAppend = String(message.reasoning ?? "").slice(
          String(previous.reasoning ?? "").length,
        ),
        reasoningDisplayAppend = String(message.reasoningDisplay ?? "").slice(
          String(previous.reasoningDisplay ?? "").length,
        );
      if (
        textAppend ||
        reasoningAppend ||
        reasoningDisplayAppend ||
        message.streaming !== previous.streaming
      )
        this.emit("messageDelta", {
          sessionId,
          messageId: message.id,
          textAppend,
          reasoningAppend,
          streaming: message.streaming,
          reasoningDisplayAppend,
          ...blockDelta,
        });
    } else this.emit("messageUpsert", { sessionId, message, index });
    this.messages.set(message.id, message);
  }
  state(snapshot) {
    const sessionId = snapshot.sessionId;
    if (snapshot.projections !== this.projections) {
      this.emit("sessionProjections", {
        sessionId,
        projections: snapshot.projections,
      });
      this.projections = snapshot.projections;
    }
    const state = stateKey(snapshot);
    if (state !== this.stateKey)
      this.emit("sessionState", {
        sessionId,
        running: snapshot.running,
        cursor: snapshot.cursor,
        hasMore: snapshot.hasMore,
      });
    const pending = pendingKey(snapshot.pending);
    if (pending !== this.pendingKey)
      this.emit("pending", { sessionId, items: snapshot.pending });
    this.stateKey = state;
    this.pendingKey = pending;
  }
  patch(update) {
    if (update.sessionId !== this.sessionId)
      throw Object.assign(
        Error("Presentation patch requires its published baseline."),
        { code: "REBASELINE_REQUIRED" },
      );
    const sessionId = update.sessionId;
    const removed = update.removedIds.filter((id) => this.messages.delete(id));
    if (removed.length) this.emit("messageRemove", { sessionId, ids: removed });
    for (const { message, index } of update.upserts)
      this.message(sessionId, message, index);
    for (const event of update.trajectoryUpserts ?? []) {
      if (this.trajectory.get(event.id) !== event)
        this.emit("trajectoryUpsert", { sessionId, event });
      this.trajectory.set(event.id, event);
    }
    this.state(update);
  }
  flush(snapshot) {
    if (snapshot.sessionId !== this.sessionId) {
      this.replace(snapshot);
      this.emit("snapshot", snapshot);
      return;
    }
    const sessionId = snapshot.sessionId;
    if (snapshot.projections !== this.projections) {
      this.emit("sessionProjections", {
        sessionId,
        projections: snapshot.projections,
      });
      this.projections = snapshot.projections;
    }
    const trajectory = new Map(
      (snapshot.trajectory ?? []).map((event) => [event.id, event]),
    );
    for (const [id, event] of trajectory)
      if (this.trajectory.get(id) !== event)
        this.emit("trajectoryUpsert", { sessionId, event });
    const retired = [...this.trajectory.keys()].filter(
      (id) => !trajectory.has(id),
    );
    if (retired.length)
      this.emit("trajectoryRemove", { sessionId, ids: retired });
    this.trajectory = trajectory;
    const current = new Map(
      snapshot.messages.map((message) => [message.id, message]),
    );
    const removed = [...this.messages.keys()].filter((id) => !current.has(id));
    if (removed.length) this.emit("messageRemove", { sessionId, ids: removed });
    snapshot.messages.forEach((message, index) =>
      this.message(sessionId, message, index),
    );
    const state = stateKey(snapshot);
    if (state !== this.stateKey)
      this.emit("sessionState", {
        sessionId,
        running: snapshot.running,
        cursor: snapshot.cursor,
        hasMore: snapshot.hasMore,
      });
    const pending = pendingKey(snapshot.pending);
    if (pending !== this.pendingKey)
      this.emit("pending", { sessionId, items: snapshot.pending });
    this.messages = current;
    this.stateKey = state;
    this.pendingKey = pending;
    snapshot.acknowledge?.();
  }
}
const TEXT_FIELDS = new Set([
  "text",
  "reasoning",
  "reasoningDisplay",
  "streaming",
  "assistantBlocks",
]);
function safeBlockDelta(previous, current) {
  for (const key of new Set([
    ...Object.keys(previous),
    ...Object.keys(current),
  ]))
    if (
      !TEXT_FIELDS.has(key) &&
      !isDeepStrictEqual(previous[key], current[key])
    )
      return undefined;
  const before = previous.assistantBlocks,
    after = current.assistantBlocks;
  if (before === undefined && after === undefined) return {};
  if (
    !Array.isArray(before) ||
    !Array.isArray(after) ||
    before.length !== after.length
  )
    return undefined;
  const indices = {};
  for (let index = 0; index < after.length; index++) {
    const old = before[index],
      block = after[index];
    if (old.kind !== block.kind) return undefined;
    if (block.kind === "text" || block.kind === "reasoning") {
      if (block.text === old.text) continue;
      if (!block.text.startsWith(old.text)) return undefined;
      const key =
        block.kind === "text" ? "textBlockIndex" : "reasoningBlockIndex";
      const field = block.kind === "text" ? "text" : "reasoning";
      if (
        indices[key] !== undefined ||
        block.text.slice(old.text.length) !==
          String(current[field] ?? "").slice(
            String(previous[field] ?? "").length,
          )
      )
        return undefined;
      indices[key] = index;
    } else if (!isDeepStrictEqual(old, block)) return undefined;
  }
  if (current.text !== previous.text && indices.textBlockIndex === undefined)
    return undefined;
  if (
    current.reasoning !== previous.reasoning &&
    indices.reasoningBlockIndex === undefined
  )
    return undefined;
  return indices;
}
function stateKey(snapshot) {
  return JSON.stringify([snapshot.running, snapshot.cursor, snapshot.hasMore]);
}
// Remote event ids identify immutable requests; a changed request must have a new id.
function pendingKey(items) {
  return (items ?? []).map((item) => item.id).join("\0");
}
