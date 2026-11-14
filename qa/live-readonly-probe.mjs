// Authorized post-login acceptance probe. Uses only Native DSH's private client
// identity, never ~/.dsh. No $events answerer or task mutation is permitted.
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { RemoteAdapter } from '../remote/client.mjs';

const [serverUrl, outputPath] = process.argv.slice(2);
if (!serverUrl || !outputPath) throw new Error('Usage: node qa/live-readonly-probe.mjs <serverUrl> <output.json>');
const identityHint = id => createHash('sha256').update(id).digest('hex').slice(0, 12);
const report = { startedAt: new Date().toISOString(), readOnly: true, interactionAnswerer: false, mutations: 0, stages: [], notificationCounts: {}, readEndpointCounts: {}, streamErrors: [] };
let phase = 'connection';
const adapter = new RemoteAdapter((method, params) => {
  const key = `${phase}:${method}`;
  report.notificationCounts[key] = (report.notificationCounts[key] ?? 0) + 1;
  if (method === 'error') report.streamErrors.push({ phase, code: params?.code ?? 'ERROR' });
});
const summarize = snapshot => ({
  sessionHint: identityHint(snapshot.sessionId), messages: snapshot.messages.length,
  uniqueMessageIds: new Set(snapshot.messages.map(message => message.id)).size,
  cursor: snapshot.cursor, hasMore: snapshot.hasMore, running: snapshot.running,
  pendingCount: snapshot.pending.length,
  streamingMessages: snapshot.messages.filter(message => message.streaming).length,
});
try {
  await adapter.configure({ serverUrl });
  const devices = await adapter.request('devices');
  const host = devices.find(device => device.online && /Mac-mini/i.test(device.name));
  if (!host) throw Object.assign(new Error('The authorized Mac mini is not online.'), { code: 'HOST_NOT_FOUND' });
  report.stages.push({ stage: 'devices', count: devices.length, onlineCount: devices.filter(device => device.online).length, selectedHostHint: identityHint(host.id) });
  const connection = await adapter.request('connect', { hostId: host.id, readOnly: true });
  if (!connection.readOnly || adapter.interactionReady || adapter.eventsStop) throw new Error('Read-only connection unexpectedly registered interactions.');
  const gateway = adapter.gateway;
  const allowed = new Set(['workspace/follow', 'session/list', 'session/page', 'session/follow']);
  for (const method of ['dispatch', 'open']) {
    const original = gateway[method].bind(gateway);
    gateway[method] = (endpoint, ...rest) => {
      if (!allowed.has(endpoint)) throw new Error(`Read-only probe refused endpoint ${endpoint}`);
      report.readEndpointCounts[endpoint] = (report.readEndpointCounts[endpoint] ?? 0) + 1;
      return original(endpoint, ...rest);
    };
  }
  const workspaces = await adapter.request('workspaces');
  const sessions = await adapter.request('sessions');
  report.stages.push({ stage: 'connected', transport: connection.transport, workspaceCount: workspaces.length, sessionCount: sessions.length, runningCount: sessions.filter(session => session.running).length });
  phase = 'completed-history';
  const completed = adapter.catalogRows.filter(session => !session.running && !session.blank && !session.parentSessionId && session.origin !== 'subagent').sort((left, right) => right.updatedAt - left.updatedAt);
  if (!completed.length) throw Object.assign(new Error('No completed root session is available for passive history acceptance.'), { code: 'NO_COMPLETED_SESSION' });
  const initial = await adapter.request('openSession', { sessionId: completed[0].sessionId });
  report.stages.push({ stage: 'completed-passive-follow', ...summarize(initial) });
  if (initial.messages.length !== new Set(initial.messages.map(message => message.id)).size) throw new Error('Completed history contains duplicate message identities.');
  await delay(1000);
  if (initial.hasMore) {
    const history = await adapter.request('history');
    report.stages.push({ stage: 'older-history-page', ...summarize(history) });
    if (history.messages.length !== new Set(history.messages.map(message => message.id)).size) throw new Error('Older history produced duplicate message identities.');
  }
  const running = adapter.catalogRows.filter(session => session.running && !session.parentSessionId && session.origin !== 'subagent').sort((left, right) => right.updatedAt - left.updatedAt);
  if (running.length) {
    phase = 'existing-running-session';
    const start = await adapter.request('openSession', { sessionId: running[0].sessionId });
    report.stages.push({ stage: 'running-passive-start', ...summarize(start) });
    await delay(15000);
    const end = adapter.snapshot();
    report.stages.push({ stage: 'running-passive-end', observationSeconds: 15, ...summarize(end), cursorAdvanced: end.cursor >= start.cursor });
    if (end.cursor < start.cursor) throw new Error('Live follow cursor regressed.');
    if (end.messages.length !== new Set(end.messages.map(message => message.id)).size) throw new Error('Live presentation contains duplicate message identities.');
  } else report.stages.push({ stage: 'running-passive-observation', status: 'unverified-no-existing-running-session' });
  if (report.streamErrors.length) throw new Error('A passive stream reported an error; inspect the recorded error codes.');
  report.pass = true;
} catch (error) {
  report.pass = false;
  report.failure = { phase, code: error.code ?? 'ERROR', message: error instanceof Error ? error.message : 'Probe failed' };
  process.exitCode = 1;
} finally {
  await adapter.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report));
}
