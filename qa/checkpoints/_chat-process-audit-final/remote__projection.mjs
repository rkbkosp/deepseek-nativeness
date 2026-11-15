// Loaded event window plus the React-free presentation rules from the frozen dsh client.
import {
  contextProducer,
  contextForm,
  toAssistantBlocks,
  displayReasoningText,
  SteeringHistory,
} from "./dist/upstream.mjs";
export class SessionProjection {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.events = new Map();
    this.pending = [];
    this.cursor = -1;
    this.revision = 0;
    this.attempt = undefined;
    this.running = false;
    this.hasMore = false;
    this.resetSurface();
  }
  resetSurface() {
    this.messages = new Map();
    this.order = [];
    this.retired = new Set();
    this.seqKeys = new Map();
    this.tools = new Map();
    this.commands = new Map();
    this.trajectory = new Map();
    this.trajectoryOrder = [];
    this.turns = new Map();
    this.currentTurn = undefined;
    this.currentStep = undefined;
    this.steering = new SteeringHistory();
    this.positions = new Map();
    this.messageKeysById = new Map();
    this.dirtyMessages = new Set();
    this.removedMessages = new Set();
    this.dirtyTrajectory = new Map();
    this.lastActive = new Map();
    this.cachedActive = undefined;
    this.changeVersion = (this.changeVersion ?? 0) + 1;
  }
  snapshot(frame) {
    this.events.clear();
    this.resetSurface();
    this.running = false;
    this.cursor = frame.cursor;
    this.hasMore = !!frame.hasMore;
    for (const row of frame.records ?? []) this.event(row.event);
    this.revision = frame.assistantStream?.revision ?? 0;
    this.attempt = undefined;
    this.projections = frame.projections;
    const active = frame.assistantStream?.activeAttempt;
    if (active) {
      this.start(active);
      for (const r of active.stream ?? []) this.compact(r);
      this.attempt.nextIndex = active.nextIndex;
    }
  }
  applyProjectionBaseline(baseline) {
    if (!baseline) return;
    if (
      !this.projections ||
      (baseline.asOfSeq ?? -1) >= (this.projections.asOfSeq ?? -1)
    )
      this.projections = baseline;
  }
  applyProjectionUpdate(frame) {
    if (!this.projections || frame.seq < (this.projections.asOfSeq ?? -1))
      return;
    this.projections = {
      ...this.projections,
      asOfSeq: frame.seq,
      values: {
        ...this.projections.values,
        ...Object.fromEntries(frame.changes.map(({ key, val }) => [key, val])),
      },
    };
  }
  mergeHistory(records) {
    const attempt = this.attempt,
      revision = this.revision,
      running = this.running,
      cursor = this.cursor;
    for (const row of records ?? [])
      if (row.event) this.events.set(row.event.seq, row.event);
    const ordered = [...this.events.values()].sort((a, b) => a.seq - b.seq);
    this.events.clear();
    this.resetSurface();
    for (const event of ordered) this.event(event);
    this.attempt = attempt;
    this.revision = revision;
    this.running = running;
    this.cursor = cursor;
  }
  event(event) {
    if (!event || !Number.isSafeInteger(event.seq)) return;
    this.changeVersion++;
    this.cachedActive = undefined;
    const duplicate = this.events.has(event.seq);
    this.events.set(event.seq, event);
    const data = event.data ?? {};
    this.cursor = Math.max(this.cursor, event.seq);
    if (event.type === "turn/start") {
      this.running = true;
      this.currentTurn = data.turn;
      this.currentStep = undefined;
      this.turns.set(data.turn, {
        turn: data.turn,
        startTime: event.time,
        startSeq: event.seq,
        status: "open",
      });
    }
    if (event.type === "step/start") {
      this.currentTurn = data.turn;
      this.currentStep = data.step;
    }
    if (event.type === "turn/end") {
      this.running = false;
      this.turns.set(data.turn, {
        ...this.turns.get(data.turn),
        turn: data.turn,
        endTime: event.time,
        endSeq: event.seq,
        status: "closed",
        reason: data.reason,
      });
    }
    const turn = data.turn ?? this.currentTurn,
      step = data.step ?? this.currentStep;
    let steering = false;
    if (!duplicate && (event.type !== "user/message" || data.source))
      steering = this.steering.apply(event);
    const trajectory = {
      id: `event:${event.seq}`,
      seq: event.seq,
      type: event.type,
      time: event.time,
      turn,
      step,
      kind: event.type.split("/")[0],
      summary: trajectorySummary(event),
      data,
      ...(event.surfaceOp ? { surfaceOp: event.surfaceOp } : {}),
    };
    if (!this.trajectory.has(event.seq)) {
      const before =
        this.trajectoryOrder.length === 0 ||
        this.trajectoryOrder.at(-1) <= event.seq
          ? -1
          : this.trajectoryOrder.findIndex((seq) => seq > event.seq);
      this.trajectoryOrder.splice(
        before < 0 ? this.trajectoryOrder.length : before,
        0,
        event.seq,
      );
    }
    this.trajectory.set(event.seq, trajectory);
    this.dirtyTrajectory.set(event.seq, trajectory);
    let key = `event:${event.seq}`,
      id = key,
      position;
    if (this.retired.has(key)) return;
    if (!this.seqKeys.has(event.seq) && event.surfaceOp?.op === "replace") {
      const start = this.order.indexOf(
          this.seqKeys.get(event.surfaceOp.startSeq) ??
            `event:${event.surfaceOp.startSeq}`,
        ),
        end = this.order.indexOf(
          this.seqKeys.get(event.surfaceOp.endSeq) ??
            `event:${event.surfaceOp.endSeq}`,
        );
      if (start >= 0 && end >= start) {
        position = start;
        for (const old of this.order.splice(start, end - start + 1)) {
          const removed = this.messages.get(old);
          if (removed) {
            this.removedMessages.add(removed.id);
            this.messageKeysById.delete(removed.id);
          }
          this.messages.delete(old);
          this.positions.delete(old);
          this.retired.add(old);
        }
        this.reindexFrom(start);
      }
    }
    let role, kind, blocks, source, context, tool, command;
    if (event.type === "user/message") {
      source = data.source;
      blocks = data.content;
      if (source?.kind === "user") {
        role = "user";
        kind = steering ? "steering" : "user";
      } else {
        role = "context";
        kind =
          source?.kind === "compact-checkpoint"
            ? "compaction"
            : source?.kind === "retry" && !(blocks ?? []).length
              ? "turn-trigger"
              : "context";
        context = {
          producer: contextProducer(source),
          form: contextForm(source),
          defaultExpanded: false,
        };
      }
    }
    if (event.type === "developer/message") {
      role = "context";
      kind = "context";
      source = data.message?.source;
      blocks = data.message?.content;
      context = {
        producer: contextProducer(source),
        form: contextForm(source),
        defaultExpanded: false,
      };
    }
    // System prompt is model context, available in Trajectory, not a normal Chat bubble.
    if (event.type === "assistant/message") {
      role = "assistant";
      kind = "assistant";
      blocks = data.message?.content;
    }
    if (event.type === "assistant/attempt") {
      const prior = this.attempt;
      this.start({
        attemptId: "durable-attempt:" + event.seq,
        turn: data.turn,
        step: data.step,
      });
      for (const r of data.stream ?? []) this.compact(r);
      blocks = [...this.attempt.blocks.values()];
      this.attempt = prior;
      if (blocks.some((b) => b.type === "text" || b.type === "reasoning")) {
        role = "assistant";
        kind = "attempt";
      }
    }
    if (event.type === "tool/call" || event.type === "tool/result") {
      const callId = String(
        data.callId ?? data.message?.source?.callId ?? event.seq,
      );
      const existingKey = this.tools.get(callId);
      if (existingKey) {
        key = existingKey;
        position = undefined;
      } else this.tools.set(callId, key);
      id = `tool:${callId}`;
      const previous = this.messages.get(key),
        prior = previous?.tool;
      tool = {
        ...prior,
        callId,
        name: data.name ?? prior?.name ?? "",
        argsRaw: data.arguments ?? prior?.argsRaw ?? "",
        phase: event.type === "tool/call" ? "start" : "settled",
        ...(event.type === "tool/result"
          ? {
              content: data.message?.content ?? [],
              isError: data.message?.isError === true,
              error: data.error,
              meta: data.meta,
              resultSeq: event.seq,
              resultTime: event.time,
            }
          : {}),
        subCalls: prior?.subCalls ?? [],
      };
      blocks = tool.content ?? [];
      role = "tool";
      kind = "tool";
    }
    if (event.type === "command/run" || event.type === "command/done") {
      const commandId = String(data.commandId ?? event.seq);
      const existingKey = this.commands.get(commandId);
      if (existingKey) key = existingKey;
      else this.commands.set(commandId, key);
      id = `command:${commandId}`;
      const previous = this.messages.get(key)?.command;
      command = {
        ...previous,
        commandId,
        ...(event.type === "command/run"
          ? { name: data.name, args: data.args ?? null }
          : {
              outcome: {
                kind: data.kind,
                text: data.text,
                sourceEventSeq: data.sourceEventSeq,
              },
            }),
      };
      role = "command";
      kind = "command";
      blocks =
        typeof data.text === "string"
          ? [{ type: "text", text: data.text }]
          : [];
    }
    if (role) {
      const previous = this.messages.get(key);
      if (!previous) {
        if (position === undefined) {
          const last = this.order.at(-1);
          const later =
            last === undefined || this.messages.get(last).seq <= event.seq
              ? -1
              : this.order.findIndex(
                  (k) => this.messages.get(k).seq > event.seq,
                );
          position = later < 0 ? this.order.length : later;
        }
        this.order.splice(position, 0, key);
        this.reindexFrom(position);
      }
      const reasoning = reasoningText(blocks),
        text = role === "assistant" ? assistantText(blocks) : blockText(blocks);
      const message = {
        id,
        role,
        kind,
        text,
        reasoning,
        reasoningDisplay: displayReasoningText(reasoning),
        streaming: false,
        seq: previous?.seq ?? event.seq,
        time: previous?.time ?? event.time,
        turn: previous?.turn ?? turn,
        step: previous?.step ?? step,
        source,
        sourceMessageId: data.id ?? data.message?.id,
        blocks,
        ...(context ? { context, collapsed: true } : {}),
        ...(role === "assistant"
          ? {
              assistantBlocks: toAssistantBlocks(blocks ?? []),
              interrupted: data.interrupted === true,
              usage: data.usage,
            }
          : {}),
        ...(tool
          ? {
              tool,
              callId: tool.callId,
              toolName: tool.name,
              toolStatus:
                tool.phase === "start"
                  ? "running"
                  : tool.isError
                    ? "error"
                    : "done",
              args: tool.argsRaw,
              result: tool.content,
              collapsed: true,
            }
          : {}),
        ...(command ? { command, collapsed: true } : {}),
        ...(["context", "tool", "attempt"].includes(kind) && turn !== undefined
          ? { groupId: `process:${turn}:${step ?? 0}` }
          : {}),
      };
      this.messages.set(key, message);
      this.messageKeysById.set(message.id, key);
      this.dirtyMessages.add(key);
      this.removedMessages.delete(message.id);
      this.seqKeys.set(event.seq, key);
    }
    if (
      ["assistant/message", "assistant/attempt"].includes(event.type) &&
      this.attempt &&
      data.turn === this.attempt.turn &&
      data.step === this.attempt.step
    )
      this.attempt = undefined;
  }
  start(a) {
    this.changeVersion++;
    this.cachedActive = undefined;
    this.attempt = { ...a, nextIndex: 0, blocks: new Map() };
  }
  chunk(chunk) {
    if (!this.attempt) return;
    this.changeVersion++;
    this.cachedActive = undefined;
    const i = chunk.index ?? 0,
      old = this.attempt.blocks.get(i) ?? { type: "text", text: "" };
    if (chunk.type === "block-start")
      this.attempt.blocks.set(i, { type: chunk.blockType, text: "" });
    if (chunk.type === "block-end") this.attempt.blocks.set(i, chunk.block);
    if (chunk.type === "reasoning-delta")
      this.attempt.blocks.set(i, {
        type: "reasoning",
        text: old.text + (chunk.text ?? ""),
      });
    if (chunk.type === "tool-call-delta")
      this.attempt.blocks.set(i, {
        ...old,
        type: "tool-call",
        id: chunk.id ?? old.id,
        name: chunk.name ?? old.name ?? "",
        arguments: (old.arguments ?? "") + (chunk.argumentsDelta ?? ""),
      });
    if (chunk.type === "text-delta")
      this.attempt.blocks.set(i, {
        type: "text",
        text: old.text + (chunk.text ?? chunk.delta ?? ""),
      });
  }
  compact(record) {
    if (this.attempt && this.attempt.time === undefined)
      this.attempt.time = record.time0 ?? record.time;
    if (record.type === "reasoning-chunks")
      for (const text of record.texts ?? [])
        this.chunk({ type: "reasoning-delta", index: record.index, text });
    if (record.type === "text-chunks")
      for (const text of record.texts ?? [])
        this.chunk({ type: "text-delta", index: record.index, text });
    if (record.type === "tool-call-chunks")
      for (const argumentsDelta of record.args ?? [])
        this.chunk({
          type: "tool-call-delta",
          index: record.index,
          id: record.id,
          name: record.name,
          argumentsDelta,
        });
    if (record.type === "chunk") this.chunk(record.chunk);
  }
  frame(frame) {
    if (frame.revision !== this.revision + 1)
      throw Object.assign(
        new Error(
          "Assistant stream revision changed; reopen a complete baseline.",
        ),
        { code: "REBASELINE_REQUIRED" },
      );
    this.revision = frame.revision;
    if (frame.type === "start") this.start(frame);
    if (frame.type === "chunk" && this.attempt?.attemptId === frame.attemptId) {
      if (frame.index !== this.attempt.nextIndex)
        throw Object.assign(new Error("Assistant stream index gap."), {
          code: "REBASELINE_REQUIRED",
        });
      this.attempt.nextIndex++;
      this.attempt.time ??= frame.time;
      this.attempt.lastTime = frame.time;
      this.chunk(frame.chunk);
    }
    if (frame.type === "end" && this.attempt?.attemptId === frame.attemptId) {
      this.changeVersion++;
      this.cachedActive = undefined;
      if (frame.index !== this.attempt.nextIndex)
        throw Object.assign(new Error("Assistant stream settlement gap."), {
          code: "REBASELINE_REQUIRED",
        });
      if (
        frame.outcome.kind === "abandoned" ||
        this.seqKeys.has(frame.outcome.seq)
      )
        this.attempt = undefined;
      else this.attempt.streaming = false;
    }
  }
  reindexFrom(start) {
    for (let index = start; index < this.order.length; index++)
      this.positions.set(this.order[index], index);
  }
  markPublished(version = this.changeVersion, active = this.activeMessages()) {
    this.lastActive = new Map(active.map((message) => [message.id, message]));
    if (version !== this.changeVersion) return;
    this.dirtyMessages.clear();
    this.removedMessages.clear();
    this.dirtyTrajectory.clear();
  }
  pullUpdates() {
    const active = this.activeMessages();
    const currentActive = new Map(
      active.map((message) => [message.id, message]),
    );
    const removed = new Set(this.removedMessages);
    for (const id of this.lastActive.keys())
      if (!currentActive.has(id) && !this.messageKeysById.has(id))
        removed.add(id);
    const upserts = [];
    for (const key of this.dirtyMessages) {
      const message = this.messages.get(key);
      if (message) upserts.push({ message, index: this.positions.get(key) });
    }
    active.forEach((message, index) => {
      if (this.lastActive.get(message.id) !== message)
        upserts.push({ message, index: this.order.length + index });
    });
    const update = {
      sessionId: this.sessionId,
      upserts,
      removedIds: [...removed],
      trajectoryUpserts: [...this.dirtyTrajectory.values()],
      pending: this.pending,
      running: this.running,
      cursor: this.cursor,
      hasMore: this.hasMore,
      projections: this.projections,
    };
    this.markPublished(this.changeVersion, active);
    return update;
  }
  activeMessages() {
    if (this.cachedActive) return this.cachedActive;
    const messages = [];
    if (this.attempt) {
      const blocks = [...this.attempt.blocks.values()],
        reasoning = reasoningText(blocks);
      if (
        blocks.some(
          (b) =>
            b.type !== "tool-call" &&
            ((b.type !== "text" && b.type !== "reasoning") || b.text?.trim()),
        )
      )
        messages.push({
          id: `attempt:${this.attempt.attemptId}`,
          role: "assistant",
          kind: "assistant",
          text: assistantText(blocks),
          reasoning,
          reasoningDisplay: displayReasoningText(reasoning),
          streaming: this.attempt.streaming !== false,
          time: this.attempt.time,
          turn: this.attempt.turn,
          step: this.attempt.step,
          assistantBlocks: toAssistantBlocks(blocks),
        });
      for (const block of blocks)
        if (
          block.type === "tool-call" &&
          block.id &&
          !this.tools.has(String(block.id))
        ) {
          const tool = {
            callId: String(block.id),
            name: block.name ?? "",
            argsRaw: block.arguments ?? "",
            phase: "preparing",
            subCalls: [],
          };
          messages.push({
            id: `tool:${tool.callId}`,
            role: "tool",
            kind: "tool",
            text: "",
            reasoning: "",
            streaming: true,
            turn: this.attempt.turn,
            step: this.attempt.step,
            time: this.attempt.time,
            tool,
            callId: tool.callId,
            toolName: tool.name,
            toolStatus: "preparing",
            args: tool.argsRaw,
            collapsed: true,
            groupId: `process:${this.attempt.turn}:${this.attempt.step}`,
          });
        }
    }
    this.cachedActive = messages;
    return messages;
  }
  value() {
    const active = this.activeMessages(),
      version = this.changeVersion;
    const messages = [
      ...this.order.map((key) => this.messages.get(key)),
      ...active,
    ];
    const value = {
      sessionId: this.sessionId,
      messages,
      pending: this.pending,
      running: this.running,
      cursor: this.cursor,
      hasMore: this.hasMore,
      projections: this.projections,
      turns: [...this.turns.values()],
      trajectory: this.trajectoryOrder.map((seq) => this.trajectory.get(seq)),
    };
    Object.defineProperty(value, "acknowledge", {
      value: () => this.markPublished(version, active),
    });
    return value;
  }
}
export function blockText(blocks) {
  if (typeof blocks === "string") return blocks;
  return (Array.isArray(blocks) ? blocks : [])
    .map((b) =>
      b.type === "text"
        ? b.text
        : b.type === "tool-call"
          ? `[${b.name ?? "工具调用"}]`
          : b.type === "image"
            ? "[图片]"
            : b.type === "tool-result"
              ? blockText(b.content ?? b.result ?? [])
              : "",
    )
    .filter(Boolean)
    .join("\n");
}
function assistantText(blocks) {
  return blockText(
    (Array.isArray(blocks) ? blocks : []).filter((b) => b.type !== "tool-call"),
  );
}
function reasoningText(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .filter((b) => b.type === "reasoning")
    .map((b) => b.text ?? "")
    .join("\n");
}
function trajectorySummary(event) {
  const data = event.data ?? {};
  if (event.type === "user/message")
    return data.source?.kind === "user"
      ? "用户消息"
      : (contextProducer(data.source).label ?? "上下文注入");
  if (event.type === "tool/call") return data.name ?? "工具调用";
  if (event.type === "tool/result")
    return data.message?.isError ? "工具失败" : "工具结果";
  if (event.type === "assistant/message") return "模型回复";
  if (event.type === "turn/start") return "轮次开始";
  if (event.type === "turn/end") return "轮次结束";
  if (event.type === "command/run") return "/" + (data.name ?? "");
  return event.type;
}
