import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionProjection } from '../remote/projection.mjs';

// Wire vocabulary follows the frozen dsh sources:
// packages/core/session/src/types.ts, packages/llm/llm/src/types.ts,
// packages/api/session-controller/src/types.ts.
const user = (seq, text) => ({ type: 'user/message', seq, time: seq, data: { content: [{ type: 'text', text }] }, surfaceOp: 'append' });
const assistant = (seq, text, surfaceOp = 'append') => ({ type: 'assistant/message', seq, time: seq, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text }] }, stream: [] }, surfaceOp });
const baseline = records => ({ type: 'snapshot', cursor: records.at(-1)?.seq ?? -1, records: records.map(event => ({ type: 'event', event })), hasMore: false, assistantStream: { revision: 0 } });

test('replacement snapshot does not retain an earlier running flag', () => {
  const projection = new SessionProjection('session');
  projection.event({ type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } });
  assert.equal(projection.value().running, true);
  projection.snapshot(baseline([]));
  assert.equal(projection.value().running, false);
});

test('canonical block-end content supersedes the streamed partial block', () => {
  const projection = new SessionProjection('session');
  projection.frame({ type: 'start', attemptId: 'attempt', revision: 1, turn: 1, step: 1 });
  projection.frame({ type: 'chunk', attemptId: 'attempt', revision: 2, index: 0, chunk: { type: 'block-start', index: 0, blockType: 'text' } });
  projection.frame({ type: 'chunk', attemptId: 'attempt', revision: 3, index: 1, chunk: { type: 'text-delta', index: 0, text: 'partial' } });
  projection.frame({ type: 'chunk', attemptId: 'attempt', revision: 4, index: 2, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'complete' } } });
  assert.equal(projection.value().messages.at(-1).text, 'complete');
});

test('surface replacement uses the replaced position rather than appending by sequence', () => {
  const projection = new SessionProjection('session');
  projection.snapshot(baseline([user(1, 'first'), assistant(2, 'old'), user(3, 'last')]));
  projection.event(assistant(4, 'new', { op: 'replace', startSeq: 2, endSeq: 2 }));
  assert.deepEqual(projection.value().messages.map(message => message.text), ['first', 'new', 'last']);
});

test('a committed no-surface attempt retires transient presentation', () => {
  const projection = new SessionProjection('session');
  projection.frame({ type: 'start', attemptId: 'attempt', revision: 1, turn: 1, step: 1 });
  projection.frame({ type: 'chunk', attemptId: 'attempt', revision: 2, index: 0, chunk: { type: 'text-delta', index: 0, text: 'uncommitted' } });
  projection.event({ type: 'assistant/attempt', seq: 1, time: 1, data: { turn: 1, step: 1, stream: [] } });
  projection.frame({ type: 'end', attemptId: 'attempt', revision: 3, index: 1, outcome: { kind: 'committed', eventType: 'assistant/attempt', seq: 1 } });
  assert.equal(projection.value().messages.some(message => message.id === 'attempt:attempt'), false);
});

test('retained history is never silently truncated', () => {
  const projection = new SessionProjection('session');
  projection.snapshot(baseline(Array.from({ length: 301 }, (_, index) => user(index, `message ${index}`))));
  const value = projection.value();
  assert.ok(value.messages.length === 301 || value.truncated === true || value.hasMore === true, 'bounded history must report truncation or an older-page affordance');
});

test('revision gaps request rebaseline rather than showing an incomplete response', () => {
  const projection = new SessionProjection('session');
  assert.throws(() => projection.frame({ type: 'start', attemptId: 'attempt', revision: 2, turn: 1, step: 1 }), { code: 'REBASELINE_REQUIRED' });
});
