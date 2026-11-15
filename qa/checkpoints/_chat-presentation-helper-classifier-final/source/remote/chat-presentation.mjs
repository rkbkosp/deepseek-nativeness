// Client-only presentation authority over the retained journal. No transport,
// DOM, original legacy ChatSnapshotBuilder, or second historical body arena.
// Rules pinned to dsh39163dd assistant.ts, turn-process.ts and assistant-content.ts.
import { StepSummaryIndex } from "./step-summary.mjs";
let baselineSerial = 0;
const nodeKey = (turn, step) => `14:assistant-step${turn}:${step}`;
const coordinates = (turn, step) => `${turn}:${step}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const visibleText = (value) => typeof value === "string" && value.trim() !== "";
function flags(blocks) {
  let reply = false,
    reasoning = false,
    tool = false;
  for (const block of blocks ?? []) {
    const kind = block.kind ?? block.type;
    if (kind === "tool-call") tool = true;
    else if (kind === "reasoning") reasoning ||= visibleText(block.text);
    else if (kind === "text") reply ||= visibleText(block.text);
    else reply = true;
  }
  return { hasReply: reply, hasReasoning: reasoning, hasToolCall: tool };
}
export class ChatPresentationIndex {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.baselineSerial = 0;
    this.presentationEpoch = "";
    this.presentationRevision = 0;
    this.turns = new Map();
    this.steps = new Map();
    this.turnViews = new Map();
    this.stepViews = new Map();
    this.dirtyTurns = new Map();
    this.dirtySteps = new Map();
    this.removedSteps = new Set();
    this.metrics = {
      historicalEventReads: 0,
      historicalMessageReads: 0,
      activeStepReads: 0,
    };
  }
  mintBaseline() {
    this.baselineSerial = ++baselineSerial;
    this.presentationEpoch = `chat:${this.baselineSerial}`;
    this.presentationRevision = 0;
  }
  turn(number) {
    if (!Number.isSafeInteger(number)) return undefined;
    let turn = this.turns.get(number);
    if (!turn) {
      turn = {
        turn: number,
        status: "partial",
        steps: new Map(),
        inputs: [],
        counts: new Map(),
        toolCallCount: 0,
        subagentCount: 0,
        summary: new StepSummaryIndex(() => this.metrics.activeStepReads++),
      };
      this.turns.set(number, turn);
    }
    return turn;
  }
  step(turnNumber, stepNumber, seq) {
    const turn = this.turn(turnNumber);
    if (!turn || !Number.isSafeInteger(stepNumber)) return undefined;
    const key = coordinates(turnNumber, stepNumber);
    let step = this.steps.get(key);
    if (!step) {
      step = {
        turn: turnNumber,
        step: stepNumber,
        nodeKey: nodeKey(turnNumber, stepNumber),
        firstSeq: seq,
        status: "running",
      };
      this.steps.set(key, step);
      turn.steps.set(stepNumber, step);
    }
    const order = step.startSeq ?? step.firstSeq;
    if (!turn.latest || order >= (turn.latest.startSeq ?? turn.latest.firstSeq))
      turn.latest = step;
    return step;
  }
  accept(
    event,
    inferredTurn,
    inferredStep,
    { publish = true, duplicate = false } = {},
  ) {
    const data = event.data ?? {},
      number = data.turn ?? inferredTurn;
    const turn = this.turn(number);
    if (!turn) return;
    const step = this.step(
      number,
      data.step ?? (event.type.startsWith("turn/") ? undefined : inferredStep),
      event.seq,
    );
    switch (event.type) {
      case "turn/start":
        turn.startSeq = event.seq;
        turn.startTime = event.time;
        turn.status = "open";
        break;
      case "turn/end":
        turn.status = "closed";
        turn.endSeq = event.seq;
        turn.endTime = event.time;
        turn.endReasonKind = data.reason?.kind ?? null;
        break;
      case "step/start":
        if (step) {
          step.startSeq = event.seq;
          turn.latest = step;
        }
        break;
      case "step/end":
        if (step) {
          step.endSeq = event.seq;
          step.endTime = event.time;
          step.closed = true;
        }
        break;
      case "user/message":
        if (
          data.source?.kind === "user" &&
          event.surfaceOp === "append" &&
          !duplicate
        )
          turn.inputs.push(event.seq);
        break;
      case "tool/call":
        if (!duplicate) {
          if (data.name === "subagent" || data.name?.startsWith("subagent_"))
            turn.subagentCount++;
          else turn.toolCallCount++;
        }
        turn.otherStartSeq = Math.min(
          turn.otherStartSeq ?? Infinity,
          event.seq,
        );
        break;
      case "tool/result":
        if (event.surfaceOp === "append")
          turn.otherStartSeq = Math.min(
            turn.otherStartSeq ?? Infinity,
            event.seq,
          );
        break;
      case "llm/retry":
        turn.otherStartSeq = Math.min(
          turn.otherStartSeq ?? Infinity,
          event.seq,
        );
        if (step) {
          step.final = undefined;
          step.finalFlags = undefined;
          step.payloadId = undefined;
          step.livePayloadId = undefined;
          step.liveFlags = undefined;
          step.firstLiveVisible = undefined;
          step.liveBlockFlags = new Map();
          step.liveCounts = { reply: 0, reasoning: 0, tool: 0 };
        }
        break;
      case "assistant/message":
        if (step && publish && event.surfaceOp === "append") {
          step.final = event;
          step.finalFlags = flags(data.message?.content);
          step.firstDurableVisible ??=
            step.finalFlags.hasReply || step.finalFlags.hasReasoning
              ? event.seq
              : undefined;
          if (!duplicate && step.finalFlags.hasReply)
            turn.counts.set(step.step, (turn.counts.get(step.step) ?? 0) + 1);
        }
        break;
    }
    this.refreshTurn(turn, step);
    if (step) this.refreshStep(step);
  }
  bindPayload(message, { live = false, anchorSeq, flags: liveFlags } = {}) {
    const step = this.steps.get(coordinates(message.turn, message.step));
    if (!step) return;
    if (live) {
      step.livePayloadId = message.id;
      step.liveFlags = liveFlags ?? flags(message.assistantBlocks);
      if (step.liveFlags.hasReply || step.liveFlags.hasReasoning)
        step.firstLiveVisible ??= anchorSeq;
    } else if (step.final?.seq === message.seq) {
      step.payloadId = message.id;
    } else return;
    const changed = this.refreshStep(step);
    if (changed) this.refreshTurn(this.turns.get(step.turn), step);
  }
  start(attempt, cursor) {
    const step = this.step(
      attempt.turn,
      attempt.step,
      attempt.startedAfterSeq ?? cursor,
    );
    if (!step) return;
    step.liveAttemptId = attempt.attemptId;
    step.liveFlags = {
      hasReply: false,
      hasReasoning: false,
      hasToolCall: false,
    };
    step.liveBlockFlags = new Map();
    step.liveCounts = { reply: 0, reasoning: 0, tool: 0 };
    this.refreshTurn(this.turns.get(step.turn), step);
  }
  chunk(attempt, chunk, cursor) {
    const step = this.steps.get(coordinates(attempt.turn, attempt.step));
    if (!step) return;
    const index = chunk.index ?? 0;
    const previous = step.liveBlockFlags.get(index) ?? {};
    let next = previous;
    if (chunk.type === "block-start")
      next = {
        kind: chunk.blockType,
        visible: !["text", "reasoning", "tool-call"].includes(chunk.blockType),
      };
    else if (chunk.type === "block-end") {
      const kind = chunk.block.type;
      next = {
        kind,
        visible:
          kind === "text" || kind === "reasoning"
            ? visibleText(chunk.block.text)
            : kind !== "tool-call",
      };
    } else if (
      chunk.type === "text-delta" ||
      chunk.type === "reasoning-delta"
    ) {
      const kind = chunk.type === "text-delta" ? "text" : "reasoning";
      next = {
        kind,
        visible:
          (previous.kind === kind && previous.visible) ||
          visibleText(chunk.text ?? chunk.delta),
      };
    } else if (chunk.type === "tool-call-delta")
      next = { kind: "tool-call", visible: false };
    else return;
    const contribution = (block) => ({
      reply: !!block.visible && block.kind !== "reasoning",
      reasoning: !!block.visible && block.kind === "reasoning",
      tool: block.kind === "tool-call",
    });
    const before = contribution(previous),
      after = contribution(next);
    for (const key of ["reply", "reasoning", "tool"])
      step.liveCounts[key] += Number(after[key]) - Number(before[key]);
    step.liveBlockFlags.set(index, next);
    step.liveFlags = {
      hasReply: step.liveCounts.reply > 0,
      hasReasoning: step.liveCounts.reasoning > 0,
      hasToolCall: step.liveCounts.tool > 0,
    };
    if (
      (step.liveFlags.hasReply || step.liveFlags.hasReasoning) &&
      step.firstLiveVisible === undefined
    ) {
      attempt.firstVisibleSeq ??=
        cursor +
        1 -
        1 /
          ((attempt.viewChunkCount ?? Math.max(attempt.nextIndex ?? 0, 1)) + 1);
      step.firstLiveVisible = attempt.firstVisibleSeq;
      step.processLiveEvidence ??= step.firstLiveVisible;
    }
    if (!same(before, after)) {
      this.refreshStep(step);
      this.refreshTurn(this.turns.get(step.turn), step);
    }
  }
  retire(attempt, { preserveFinal = false } = {}) {
    if (!attempt) return;
    const step = this.steps.get(coordinates(attempt.turn, attempt.step));
    if (!step) return;
    step.livePayloadId = undefined;
    step.liveAttemptId = undefined;
    step.liveFlags = undefined;
    if (!preserveFinal) {
      step.firstLiveVisible = undefined;
      step.processLiveEvidence = undefined;
    }
    this.refreshStep(step);
    this.refreshTurn(this.turns.get(step.turn), step);
  }
  refreshStep(step) {
    const turn = this.turns.get(step.turn);
    const final = step.final,
      state = final ? step.finalFlags : step.liveFlags;
    const interrupted =
      final?.data.interrupted === true ||
      !!this.interruptionFor(step.turn, step.step);
    const payloadId = final ? step.payloadId : step.livePayloadId;
    const visible = state?.hasReply || state?.hasReasoning || interrupted;
    const previous = this.stepViews.get(step.nodeKey);
    if (!payloadId || !visible) {
      if (previous) {
        this.stepViews.delete(step.nodeKey);
        this.dirtySteps.delete(step.nodeKey);
        this.removedSteps.add(step.nodeKey);
        return true;
      }
      return false;
    }
    const boundary = step.endSeq ?? turn.endSeq;
    const finalAnchor =
      final?.seq ??
      (interrupted && boundary !== undefined ? boundary - 0.9 : null);
    const view = {
      nodeKey: step.nodeKey,
      turn: step.turn,
      step: step.step,
      payloadId,
      status: interrupted ? "interrupted" : final ? "settled" : "running",
      anchorSeq: interrupted
        ? finalAnchor
        : (step.firstLiveVisible ?? final?.seq ?? step.firstSeq),
      finalEventSeq: final?.seq ?? null,
      ...(final?.data.message?.id === undefined
        ? {}
        : { committedMessageId: final.data.message.id }),
      hasReply: !!state?.hasReply,
      hasReasoning: !!state?.hasReasoning,
      hasToolCall: !!state?.hasToolCall,
    };
    if (same(previous, view)) return false;
    this.stepViews.set(step.nodeKey, view);
    this.dirtySteps.set(step.nodeKey, view);
    this.removedSteps.delete(step.nodeKey);
    return true;
  }
  interruptionFor(turnNumber, stepNumber) {
    const step = this.steps.get(coordinates(turnNumber, stepNumber));
    const turn = this.turns.get(turnNumber);
    const state = step?.liveFlags;
    if (
      !step ||
      step.final ||
      !(state?.hasReply || state?.hasReasoning || state?.hasToolCall)
    )
      return undefined;
    if (step.closed && step.endSeq !== undefined)
      return { seq: step.endSeq - 0.9, time: step.endTime };
    if (turn?.status === "closed" && turn.endSeq !== undefined)
      return { seq: turn.endSeq - 0.9, time: turn.endTime };
    return undefined;
  }
  refreshTurn(turn, changedStep) {
    if (!turn) return;
    if (changedStep) {
      const evidence = Math.min(
        changedStep.processLiveEvidence ?? Infinity,
        changedStep.firstDurableVisible ?? Infinity,
      );
      const messages = turn.counts.get(changedStep.step) ?? 0;
      if (
        changedStep.summaryEvidence !== evidence ||
        changedStep.summaryCount !== messages
      ) {
        turn.summary.set(changedStep.step, evidence, messages);
        changedStep.summaryEvidence = evidence;
        changedStep.summaryCount = messages;
      }
    }
    const latest = turn.latest;
    const latestFlags = latest?.finalFlags ?? latest?.liveFlags;
    const latestBoundary = latest?.endSeq ?? turn.endSeq;
    const syntheticFinal =
      !latest?.final &&
      latestBoundary !== undefined &&
      (latestFlags?.hasReply ||
        latestFlags?.hasReasoning ||
        latestFlags?.hasToolCall);
    const hasFinal = latest?.final !== undefined || syntheticFinal;
    const isAnswer = !!(
      hasFinal &&
      latestFlags?.hasReply &&
      !latestFlags?.hasToolCall
    );
    const earlier = isAnswer ? turn.summary.before(latest.step) : undefined;
    const messageCount = earlier?.messages ?? turn.summary.total;
    const evidence = Math.min(
      turn.summary.minimum,
      turn.otherStartSeq ?? Infinity,
    );
    const control = Number.isFinite(evidence) ? evidence : turn.startSeq;
    const answerAnchor = isAnswer
      ? (latest.final?.seq ?? latestBoundary - 0.9)
      : null;
    const external = Math.min(
      earlier?.evidence ?? Infinity,
      turn.otherStartSeq ?? Infinity,
    );
    const spec =
      control === undefined
        ? null
        : {
            turn: turn.turn,
            controlAnchorSeq: control,
            processStartSeq: isAnswer
              ? (turn.startSeq ??
                (Number.isFinite(external) ? external : answerAnchor))
              : control,
            answerAnchorSeq: answerAnchor,
            answerStep: isAnswer ? latest.step : null,
            inlineReasoning: isAnswer && !!latestFlags.hasReasoning,
            messageCount,
            toolCallCount: turn.toolCallCount,
            subagentCount: turn.subagentCount,
          };
    const opening =
      control === undefined
        ? undefined
        : turn.inputs
            .filter((seq) => control === turn.startSeq || seq < control)
            .at(-1);
    const hasInterleavedInput = turn.inputs.some(
      (seq) => opening === undefined || seq > opening,
    );
    const foldEligible =
      spec !== null &&
      (turn.startSeq !== undefined || turn.status === "closed");
    const view = {
      turn: turn.turn,
      status: turn.status,
      startLoaded: turn.startSeq !== undefined,
      latestStep: latest?.step ?? null,
      endReasonKind: turn.endReasonKind ?? null,
      foldEligible,
      alwaysOpen:
        !foldEligible ||
        turn.status === "open" ||
        ["aborted", "interrupted", "error"].includes(turn.endReasonKind) ||
        hasInterleavedInput,
      hasInterleavedInput,
      spec,
      ...(Number.isFinite(turn.startTime) ? { startTime: turn.startTime } : {}),
      ...(Number.isFinite(turn.endTime) ? { endTime: turn.endTime } : {}),
    };
    if (same(this.turnViews.get(turn.turn), view)) return;
    this.turnViews.set(turn.turn, view);
    this.dirtyTurns.set(turn.turn, view);
  }
  header() {
    return {
      schemaVersion: 1,
      baselineSerial: this.baselineSerial,
      presentationEpoch: this.presentationEpoch,
      presentationRevision: this.presentationRevision,
    };
  }
  value() {
    return {
      ...this.header(),
      turns: [...this.turnViews.values()],
      steps: [...this.stepViews.values()],
    };
  }
  acknowledge(revision = this.presentationRevision) {
    this.presentationRevision = revision;
    this.dirtyTurns.clear();
    this.dirtySteps.clear();
    this.removedSteps.clear();
  }
  patch() {
    const patch = {
      ...this.header(),
      turnUpserts: [...this.dirtyTurns.values()],
      turnRemoves: [],
      stepUpserts: [...this.dirtySteps.values()],
      stepRemoves: [...this.removedSteps],
    };
    Object.defineProperty(patch, "acknowledge", {
      value: (revision) => this.acknowledge(revision),
    });
    return patch;
  }
}
