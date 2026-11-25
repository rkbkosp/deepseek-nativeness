# Chat presentation protocol v1

This is a frontend-only stdio extension. The frozen Remote transport and Host API
are unchanged. `SessionProjection` owns a body-free per-Turn/per-Step index over
its existing raw journal and passive follow. No original assembler, React,
WebKit, second connection, or interaction answerer is introduced.

The pinned semantic oracle is dsh `39163dd` `assistant.ts`, `turn-process.ts`,
`assistant-content.ts` and `ClientAssistantStream`. The full original assembler
is used **only by QA**, never imported by the helper runtime.

The alignment to dsh `0.2.2-rc.5` (`9c2670d3bce5275e0d1610272958121af87787bb`)
left `assistant.ts`, `turn-process.ts` and `turn-process-presentation.ts`
byte-identical to that pin, so the rules below still describe the bundled
runtime. `conversation/assembler.ts` differs only in a type-import path
(`dsh-llm/types` → `dsh-llm/brand`), not in behaviour.

## Baselines and ordering

A genuine snapshot, rebaseline or history-window merge mints a positive,
process-local monotonic `baselineSerial`; `presentationEpoch` is
`chat:<baselineSerial>` and `presentationRevision` starts at zero. `value()`,
publication and token reads do not mint baselines. All new baselines are emitted
as a `snapshot` notification after publisher replacement and before RPC readiness
or return, on the same notification conveyor as their increments.

The Go receiver additionally fences the helper-client pointer and captured
Host/generation/account stdio scope. Serial restart is permitted only behind that
existing client boundary. Reject an older serial; ignore a duplicate same-serial
baseline entirely, including one whose RPC callback arrives after a token suffix.
Validate a higher-serial baseline completely before adopting it. A higher-serial
patch without its baseline is invalid and must request rebaseline, never partially
apply. Unknown malformed frames retain the prior presentation.

`snapshot.chatPresentation` contains:

```ts
{
  schemaVersion: 1,
  baselineSerial: number,
  presentationEpoch: string,
  presentationRevision: number,
  turns: Turn[],
  steps: Step[]
}
```

`Turn` contains `turn`, `status` (`open`, `closed`, `partial`), `startLoaded`,
`latestStep` (integer or null), `endReasonKind` (string or null), `foldEligible`,
`alwaysOpen`, `hasInterleavedInput`, and `spec` (object or null). Optional
`startTime`/`endTime` are numeric milliseconds; unknown times are omitted.

`spec` contains `turn`, `controlAnchorSeq`, `processStartSeq`, `answerAnchorSeq`
(number or null), `answerStep` (integer or null), `inlineReasoning`,
`messageCount`, `toolCallCount`, and `subagentCount`.

`Step` contains `nodeKey`, `turn`, `step`, `payloadId`, `status` (`running`,
`settled`, `interrupted`), `anchorSeq`, `finalEventSeq` (integer or null),
`hasReply`, `hasReasoning`, `hasToolCall`, and optional `committedMessageId`.
Only materialized readable assistant nodes need Step records. Empty and successful
tool-only Steps still affect `Turn.latestStep` without a readable assistant node
and prevent an older reply becoming final. A closed live tool-only Step has the
original synthetic interrupted node and stopped marker, without reply eligibility.
`nodeKey` is `14:assistant-step<turn>:<step>` and remains stable at settlement.

`payloadId` references the existing messages arena; it does not copy message
content. `anchorSeq` may be fractional and is layout-only. `finalEventSeq` and
`committedMessageId` are separate durable identities, never synthesized from the
layout anchor. Human/raw nonassistant arena order is preserved. Assistant arena
rows absent from Step refs are hidden, not sent to a last-text fallback.

## Atomic updates

```ts
{method: 'chatPresentationPatch', params: {
  sessionId, schemaVersion: 1, baselineSerial, presentationEpoch,
  baseRevision, presentationRevision, // exactly baseRevision + 1
  turnUpserts: Turn[], turnRemoves: number[],
  stepUpserts: Step[], stepRemoves: string[],
  payloadChanges: {
    upserts: {message: Message, index: number}[],
    removes: string[],
    deltas?: MessageDelta[]
  },
  timelineTurnUpserts?: RawTimelineTurn[]
}}
```

`timelineTurnUpserts` uses the preexisting `snapshot.turns` record shape
(`turn`, optional start/end time/seq, status, optional full reason). Only dirty
Turn boundaries are sent. There is no incremental raw-Turn deletion producer;
a new baseline replaces the complete window. Receivers may support optional
`timelineTurnRemoves` for symmetric cleanup without inferring records from the
journal. Apply raw-Turn and presentation changes in the same transaction.

Validate revision, all refs and placements first, then commit body upserts,
removals, metadata and raw timeline changes in one UI transaction. No transient
missing body is acceptable. Ignore already-applied revisions; reject gaps.
Structural body corrections, removals and metadata changes never escape as naked
messageUpsert/messageRemove notifications in presentation v1.

An ordinary text/reasoning suffix retains `messageDelta` with
`schemaVersion`, `baselineSerial`, `presentationEpoch`, and the **current**
`presentationRevision`. It carries only changed suffixes and block indices.
`sessionState`, `pending`, `sessionProjections` and `trajectoryUpsert` use the same
header; apply the same causal fence before touching scalar or diagnostic state.
Legacy snapshots without chatPresentation retain their old path.

## Semantic and cost boundaries

The latest chronological Step is authoritative even if it has no visible body.
Its finalized node must contain reply content and no tool-call to become the
answer. There is no backward search for older text. Reasoning remains a separate
part of that same stable node. Unknown/file content remains readable JSON;
images retain structured attachments. Abort/error/interruption and interleaved
input keep process rows open. A loaded Turn end can establish closed/eligible
partial history even when its start is outside the window.

Exact durable settlement is staged until its matching stream end. Success keeps
the transient anchor until owning step/end, then retires transient evidence and
returns to the durable anchor while preserving node identity. Missing, mismatched,
duplicate or abandoned staged settlement requests rebaseline. Reconnect baselines
may already contain the exact committed seq. Retry clears current assistant
qualification but preserves recorded process evidence/counts. Only append-origin
assistant events establish committed Chat replies; model-surface replacement does
not replace those append-origin Chat nodes. Raw source events remain available.
Live assistant tool blocks retain identity only (`argsRaw: ''`); Tool nodes own
streamed argument text. A canonical block-end or durable message restores the
complete canonical arguments in its assistant block, matching the original fold.

The runtime stores only bounded per-event journal state already held by the
projection, per-step/turn metadata and an augmented scalar step-prefix index.
Body-free O(log steps) corrections avoid a growing active-Turn scan. Normal token
suffixes with unchanged visibility/eligibility do not update metadata, read past
messages/events, or serialize history. Baseline/history rebuilds are the explicit
full-window work boundary. The stable request-ID/unknown-delivery ledger is
unchanged.

## Reproduction

```sh
node --test remote/test/*.test.mjs
node qa/_chat-process-audit/build.mjs
node --test remote/test/chat-source-oracle.mjs
node --expose-gc remote/test/chat-presentation-bench.mjs
```

`fixtureChatPresentationStream` uses the real producer/publisher, emits snapshot
and atomic updates with `fixtureCheckpoint` markers (`live`, `staged`, `retained`,
`latest-empty`, `structured-final`), then `fixtureComplete` marker
`chat-presentation-v1`. RPC returns `{expected, checkpoints:[{marker,expected}]}`.
It is synthetic and performs no Host/network operation. Full App/M1/GUI acceptance
and baseline/page queue integration are separate gates.
