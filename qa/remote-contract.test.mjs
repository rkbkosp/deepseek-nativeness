import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteAdapter } from '../remote/client.mjs';
import { SessionProjection } from '../remote/projection.mjs';

function fixture(t, dispatch) {
  const adapter = new RemoteAdapter();
  adapter.hostId = 'fixture-host';
  adapter.interactionReady = true;
  adapter.sessionRows = [{ id: 'fixture-session' }];
  adapter.projection = new SessionProjection('fixture-session');
  adapter.gateway = { dispatch };
  t.after(() => adapter.close());
  return adapter;
}

test('prompt uses the official request envelope and one stable request id', async t => {
  const calls = [];
  const adapter = fixture(t, async (...args) => { calls.push(args); return { ok: true, value: { accepted: true } }; });
  const input = { sessionId: 'fixture-session', text: 'fixture text only', requestId: 'fixture-operation-0001' };
  await adapter.request('sendMessage', input);
  await adapter.request('sendMessage', input);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'session/prompt');
  assert.deepEqual(calls[0][1], { args: { request: { sessionId: input.sessionId, requestId: input.requestId, mode: 'queue', content: [{ type: 'text', text: input.text }] } } });
  await assert.rejects(adapter.request('sendMessage', { ...input, text: 'different input' }), { code: 'REQUEST_ID_CONFLICT' });
});

test('lost prompt receipt stays unknown and is not replayed on retry', async t => {
  let calls = 0;
  const adapter = fixture(t, async () => { calls++; throw new Error('fixture transport disconnected'); });
  const input = { sessionId: 'fixture-session', text: 'fixture text only', requestId: 'fixture-operation-0002' };
  assert.equal((await adapter.request('sendMessage', input)).status, 'unknown');
  assert.equal((await adapter.request('sendMessage', input)).status, 'unknown');
  assert.equal(calls, 1);
});

test('a pre-send disconnected failure cannot leave an undefined receipt', async t => {
  let calls = 0;
  const dispatch = async () => { calls++; return { ok: true, value: { accepted: true } }; };
  const adapter = fixture(t, dispatch);
  adapter.gateway = undefined;
  const input = { sessionId: 'fixture-session', text: 'fixture text only', requestId: 'fixture-operation-0003' };
  await assert.rejects(adapter.request('sendMessage', input), { code: 'NOT_CONNECTED' });
  adapter.gateway = { dispatch };
  const result = await adapter.request('sendMessage', input);
  assert.equal(result?.status, 'accepted');
  assert.equal(calls, 1);
});

test('explicit disconnect withdraws the interaction-ready state', async t => {
  const adapter = fixture(t, async () => ({ ok: true, value: null }));
  await adapter.request('disconnect');
  assert.equal(adapter.interactionReady, false);
  await assert.rejects(adapter.request('sendMessage', { sessionId: 'fixture-session', text: 'fixture text', requestId: 'fixture-operation-0004' }), { code: 'INTERACTIONS_UNAVAILABLE' });
});

test('approval returns the correlated waterfall result and expires after answer', async t => {
  const calls = [];
  const adapter = fixture(t, async (...args) => { calls.push(args); return { ok: true, value: null }; });
  adapter.pending.set('fixture-event', { id: 'fixture-event', kind: 'approval', sessionId: 'fixture-child-session', abort: new AbortController(), wire: { clientId: 'fixture-client', eventId: 'fixture-event' } });
  await adapter.request('answerApproval', { requestId: 'fixture-event', outcome: 'rejected' });
  assert.equal(calls[0][0], '$events/result');
  assert.deepEqual(calls[0][1], { args: { clientId: 'fixture-client', eventId: 'fixture-event', outcome: { kind: 'result', value: 'rejected' } } });
  await assert.rejects(adapter.request('answerApproval', { requestId: 'fixture-event', outcome: 'allowed-once' }), { code: 'INTERACTION_EXPIRED' });
  assert.equal(calls.length, 1);
});

test('unknown waterfall delegates while a cancelled approval cannot grant later', async t => {
  const calls = [];
  const adapter = fixture(t, async (...args) => { calls.push(args); return { ok: true, value: null }; });
  adapter.gateway.open = async function* () {
    yield { type: 'ready', clientId: 'fixture-client' };
    yield { type: 'waterfall', event: 'fixture/unknown', eventId: 'fixture-unknown', agentId: 'fixture-session', request: {} };
    yield { type: 'waterfall', event: 'approval/request', eventId: 'fixture-approval', agentId: 'fixture-session', request: { toolName: 'fixture-tool' } };
    yield { type: 'cancel', eventId: 'fixture-approval' };
  };
  const ready = Promise.withResolvers();
  await assert.rejects(adapter.consumeEvents(new AbortController().signal, ready), { code: 'EVENT_STREAM_CLOSED' });
  await ready.promise;
  assert.deepEqual(calls[0].slice(0, 2), ['$events/result', { args: { clientId: 'fixture-client', eventId: 'fixture-unknown', outcome: { kind: 'next' } } }]);
  await assert.rejects(adapter.request('answerApproval', { requestId: 'fixture-approval', outcome: 'allowed-once' }), { code: 'INTERACTION_EXPIRED' });
  assert.equal(calls.length, 1);
});

test('an unselected session approval delegates without claiming the interaction', async t => {
  const calls = [];
  const adapter = fixture(t, async (...args) => { calls.push(args); return { ok: true, value: null }; });
  adapter.projection = undefined;
  adapter.gateway.open = async function* () {
    yield { type: 'ready', clientId: 'fixture-client' };
    yield { type: 'waterfall', event: 'approval/request', eventId: 'fixture-unselected', agentId: 'fixture-session', request: { toolName: 'fixture-tool' } };
  };
  const ready = Promise.withResolvers();
  await assert.rejects(adapter.consumeEvents(new AbortController().signal, ready), { code: 'EVENT_STREAM_CLOSED' });
  await ready.promise;
  assert.equal(adapter.pending.size, 0);
  assert.deepEqual(calls[0].slice(0, 2), ['$events/result', { args: { clientId: 'fixture-client', eventId: 'fixture-unselected', outcome: { kind: 'next' } } }]);
});

test('only the selected session and catalog-confirmed descendants own interactions', t => {
  const adapter = fixture(t, async () => ({ ok: true, value: null }));
  adapter.catalogRows = [
    { sessionId: 'fixture-session' },
    { sessionId: 'fixture-child', parentSessionId: 'fixture-session' },
    { sessionId: 'unrelated' },
    { sessionId: 'cycle-a', parentSessionId: 'cycle-b' },
    { sessionId: 'cycle-b', parentSessionId: 'cycle-a' },
  ];
  assert.equal(adapter.ownsSession('fixture-session'), true);
  assert.equal(adapter.ownsSession('fixture-child'), true);
  assert.equal(adapter.ownsSession('unrelated'), false);
  assert.equal(adapter.ownsSession('unknown'), false);
  assert.equal(adapter.ownsSession('cycle-a'), false);
});

test('a read-only connection does not register an interaction answerer and refuses mutation', async t => {
  const adapter = fixture(t, async () => ({ ok: true, value: null }));
  adapter.server = { close() {} };
  adapter.connector = { connect: async () => ({
    features: { remoteGateway: true, sessionFormat: 3 }, target: { name: 'fixture-host' },
    client: { onClose() {}, getStats: () => ({ mode: 'Relay' }), close: async () => {} },
  }) };
  adapter.workspaces = async () => [];
  adapter.sessions = async () => [];
  let answererRegistered = false;
  adapter.consumeEvents = async () => { answererRegistered = true; };
  const state = await adapter.request('connect', { hostId: 'fixture-host', readOnly: true });
  assert.equal(state.readOnly, true);
  assert.equal(state.connected, true);
  assert.equal(answererRegistered, false);
  adapter.sessionRows = [{ id: 'fixture-session' }];
  await assert.rejects(adapter.request('cancel', { sessionId: 'fixture-session', requestId: 'fixture-operation-0005' }), { code: 'READ_ONLY' });
});

test('a bounded history snapshot preserves the latest Host running status', async t => {
  const adapter = fixture(t, async () => ({ ok: true, value: null }));
  adapter.runningBySession.set('fixture-session', true);
  adapter.gateway.open = async function* (_endpoint, _payload, signal) {
    yield { type: 'snapshot', cursor: -1, records: [], hasMore: true, assistantStream: { revision: 0 } };
    if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
  };
  const stop = new AbortController();
  const ready = Promise.withResolvers();
  const consume = adapter.consumeSession(adapter.projection, stop, ready);
  try { assert.equal((await ready.promise).running, true); }
  finally { stop.abort(); await consume; }
});

test('session catalog uses the frozen Host descriptor parameter name', async t => {
  const adapter = fixture(t, async () => ({ ok: true, value: null }));
  let invocation;
  adapter.gateway.invoke = async request => {
    invocation = request;
    return { items: [{ sessionId: 'fixture-session', running: false, projections: { values: { title: 'Fixture session' } } }] };
  };
  await adapter.request('sessions');
  assert.equal(invocation.namespace, 'session');
  assert.equal(invocation.method, 'list');
  assert.deepEqual(invocation.args, { _request: {} });
});
