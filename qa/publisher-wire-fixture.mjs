// Explicitly simulated peer. Exercises the real projection and publisher over
// stdio; it never authenticates, opens a socket, or reads an installed identity.
import { createInterface } from 'node:readline';
import { SessionProjection } from '../remote/projection.mjs';
import { PresentationPublisher } from '../remote/updates.mjs';

const write = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const emit = (method, params) => write({ method, params });
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
  const request = JSON.parse(line);
  if (request.method !== 'fixture.run') {
    write({ id: request.id, error: { code: 'FIXTURE_ONLY', message: 'Only fixture.run is available.' } });
    return;
  }
  const projection = new SessionProjection('fixture-session');
  projection.snapshot({ cursor: 2, hasMore: false, assistantStream: { revision: 0 }, records: [
    { type: 'event', event: { type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: 'Keep historical content' }] }, surfaceOp: 'append' } },
    { type: 'event', event: { type: 'assistant/message', seq: 2, time: 2, data: { turn: 0, step: 1, message: { content: [{ type: 'text', text: 'Historical answer' }] }, stream: [] }, surfaceOp: 'append' } },
  ] });
  const publisher = new PresentationPublisher(emit);
  publisher.replace(projection.value());
  emit('snapshot', projection.value());
  projection.frame({ type: 'start', attemptId: 'fixture-attempt', revision: 1, turn: 1, step: 1 });
  projection.frame({ type: 'chunk', attemptId: 'fixture-attempt', revision: 2, index: 0, chunk: { type: 'block-start', index: 0, blockType: 'text' } });
  projection.frame({ type: 'chunk', attemptId: 'fixture-attempt', revision: 3, index: 1, chunk: { type: 'text-delta', index: 0, text: 'Hello' } });
  publisher.flush(projection.value());
  projection.frame({ type: 'chunk', attemptId: 'fixture-attempt', revision: 4, index: 2, chunk: { type: 'text-delta', index: 0, text: ' worl?' } });
  publisher.flush(projection.value());
  projection.frame({ type: 'chunk', attemptId: 'fixture-attempt', revision: 5, index: 3, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello world!' } } });
  publisher.flush(projection.value());
  projection.event({ type: 'assistant/message', seq: 3, time: 3, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Hello world!' }] }, stream: [] }, surfaceOp: 'append' });
  projection.frame({ type: 'end', attemptId: 'fixture-attempt', revision: 6, index: 4, outcome: { kind: 'committed', eventType: 'assistant/message', seq: 3 } });
  projection.pending = [{ id: 'fixture-question', kind: 'questions', sessionId: 'fixture-child', title: 'Fixture question', questions: [{ id: 'scope', question: 'Choose a scope', options: [{ label: 'Client only', description: 'Keep backend frozen' }] }] }];
  publisher.flush(projection.value());
  emit('fixtureComplete', { sessionId: 'fixture-session', simulated: true });
  write({ id: request.id, result: { complete: true, simulated: true } });
});
