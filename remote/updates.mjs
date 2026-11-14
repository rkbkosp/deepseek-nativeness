// Keeps transport work proportional to changed content; completed history is shared by reference.
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
    snapshot.messages.forEach((message, index) => {
      const previous = this.messages.get(message.id);
      if (previous === message) return;
      if (
        previous &&
        message.id.startsWith("attempt:") &&
        message.text.startsWith(previous.text) &&
        String(message.reasoning ?? "").startsWith(previous.reasoning ?? "") &&
        String(message.reasoningDisplay ?? "").startsWith(
          previous.reasoningDisplay ?? "",
        )
      ) {
        const textAppend = message.text.slice(previous.text.length),
          reasoningAppend = String(message.reasoning ?? "").slice(
            String(previous.reasoning ?? "").length,
          );
        if (
          textAppend ||
          reasoningAppend ||
          message.streaming !== previous.streaming ||
          message.reasoningDisplay !== previous.reasoningDisplay
        )
          this.emit("messageDelta", {
            sessionId,
            messageId: message.id,
            textAppend,
            reasoningAppend,
            streaming: message.streaming,
            reasoningDisplayAppend: String(
              message.reasoningDisplay ?? "",
            ).slice(String(previous.reasoningDisplay ?? "").length),
          });
      } else this.emit("messageUpsert", { sessionId, message, index });
    });
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
  }
}
function stateKey(snapshot) {
  return JSON.stringify([snapshot.running, snapshot.cursor, snapshot.hasMore]);
}
// Remote event ids identify immutable requests; a changed request must have a new id.
function pendingKey(items) {
  return (items ?? []).map((item) => item.id).join("\0");
}
