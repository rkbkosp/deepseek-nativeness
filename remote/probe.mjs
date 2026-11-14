#!/usr/bin/env node
// Uses only the new app identity. No event answerer is registered and no mutation is submitted.
import { RemoteAdapter } from "./client.mjs";
const [serverUrl, hostId, sessionId] = process.argv.slice(2);
if (!serverUrl)
  throw Error("Usage: node remote/probe.mjs <serverUrl> [hostId] [sessionId]");
const adapter = new RemoteAdapter();
try {
  await adapter.configure({ serverUrl });
  const devices = await adapter.request("devices");
  console.log(
    JSON.stringify({
      stage: "devices",
      count: devices.length,
      devices: devices.map(({ id, name, online }) => ({ id, name, online })),
    }),
  );
  if (hostId) {
    const connection = await adapter.request("connect", {
      hostId,
      readOnly: true,
    });
    console.log(
      JSON.stringify({
        stage: "connected",
        connected: connection.connected,
        readOnly: connection.readOnly,
        transport: connection.transport,
      }),
    );
    const workspaces = await adapter.request("workspaces");
    const sessions = await adapter.request("sessions");
    console.log(
      JSON.stringify({
        stage: "catalogs",
        workspaceCount: workspaces.length,
        sessionCount: sessions.length,
      }),
    );
    if (sessionId) {
      const snapshot = await adapter.request("openSession", { sessionId });
      console.log(
        JSON.stringify({
          stage: "passive-follow",
          sessionId: snapshot.sessionId,
          messages: snapshot.messages.length,
          cursor: snapshot.cursor,
          hasMore: snapshot.hasMore,
          pending: snapshot.pending.length,
        }),
      );
    }
  }
} catch (error) {
  console.error(
    JSON.stringify({
      stage: "probe-failed",
      code: error.code ?? "ERROR",
      message: error.message,
    }),
  );
  process.exitCode = 1;
} finally {
  await adapter.close();
}
