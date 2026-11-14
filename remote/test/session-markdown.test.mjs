import test from "node:test";
import assert from "node:assert/strict";
import { RemoteAdapter } from "../client.mjs";
import { SessionProjection } from "../projection.mjs";
import {
  collectSessionMarkdown,
  SESSION_MARKDOWN_LIMITS,
} from "../session-markdown.mjs";
import { formatSessionMarkdown } from "../../../deepseek-harness/packages/session-query/session-log-export/src/markdown.ts";
const event = (seq, type, data, surfaceOp) => ({
  seq,
  type,
  time: seq,
  data,
  ...(surfaceOp ? { surfaceOp } : {}),
});
const events = [
  event(0, "session/title", { title: "Fork inherited heading" }),
  event(1, "turn/start", { turn: 1 }),
  event(
    2,
    "user/message",
    {
      id: "user-id",
      source: { kind: "user" },
      content: [{ type: "text", text: "human prompt" }],
    },
    "append",
  ),
  event(
    3,
    "user/message",
    {
      id: "injected-id",
      source: { kind: "tool" },
      content: [{ type: "text", text: "private injected context omitted" }],
    },
    "append",
  ),
  event(
    4,
    "assistant/message",
    {
      message: {
        id: "assistant-first",
        content: [
          { type: "reasoning", text: "reasoning omitted" },
          { type: "text", text: "intermediate" },
          { type: "tool-call", id: "call", name: "inspect", arguments: "{}" },
        ],
      },
    },
    "append",
  ),
  event(5, "tool/call", {
    callId: "call",
    name: "inspect",
    arguments: JSON.stringify({ body: "full-arguments-" + "x".repeat(900) }),
  }),
  event(
    6,
    "tool/result",
    {
      message: {
        toolCallId: "call",
        isError: false,
        content: [{ type: "text", text: "full-output-" + "y".repeat(900) }],
      },
    },
    "append",
  ),
  event(
    7,
    "assistant/message",
    {
      message: {
        id: "assistant-final",
        content: [
          { type: "text", text: "final reply" },
          {
            type: "image",
            attachment: { name: "image.png", width: 1, height: 2, bytes: 4 },
          },
          { type: "file", attachment: { name: "file.txt", bytes: 8 } },
        ],
      },
    },
    "append",
  ),
  event(8, "turn/end", { turn: 1 }),
  event(9, "feedback/message-put", {
    sessionId: "session",
    item: { note: "feedback omitted" },
  }),
  event(
    10,
    "assistant/message",
    {
      message: {
        content: [{ type: "text", text: "surface replacement omitted" }],
      },
    },
    { op: "replace", startSeq: 4, endSeq: 7 },
  ),
  event(11, "session/title", { title: "Latest title" }),
];
const page = (rows, cursor = 11, hasMore = false) => ({
  cursor,
  hasMore,
  records: rows.map((event) => ({ type: "event", event })),
});
const setup = async (pages) => {
  const adapter = new RemoteAdapter();
  adapter.hostId = "host";
  adapter.connectionGeneration = 4;
  adapter.identityScope = "account";
  const projection = new SessionProjection("session");
  projection.snapshot({ cursor: 11, records: [] });
  adapter.projection = projection;
  const calls = [];
  let configured = 0;
  adapter.gateway = {
    invoke: async (request) => {
      calls.push(request);
      return pages[calls.length - 1];
    },
  };
  adapter.connected = {
    client: {
      rpc: async (method, args) => {
        assert.equal(method, "remote.history.configure");
        assert.deepEqual(args, { compact: false });
        configured++;
        return { compact: false };
      },
      getStats: () => ({ mode: "Fixture" }),
      close: async () => {},
    },
  };
  const scope = {
    hostId: "host",
    generation: 4,
    sessionId: "session",
    ownerId: "export-owner",
  };
  await adapter.request("registerOwner", {
    ownerId: scope.ownerId,
    clientScope: {
      hostId: scope.hostId,
      generation: scope.generation,
      sessionId: scope.sessionId,
    },
  });
  return { adapter, calls, scope, projection, configured: () => configured };
};
test("full Markdown reads a fixed canonical cut through overlapping pages and uses the unchanged original formatter", async () => {
  const { adapter, calls, scope, projection, configured } = await setup([
    page(events.slice(8), 11, true),
    page(events.slice(4, 9), 11, true),
    page(events.slice(0, 5)),
  ]);
  const result = await adapter.request("exportSessionMarkdown", {
    sessionId: "session",
    clientScope: scope,
  });
  assert.equal(result.complete, true);
  assert.equal(result.eventCount, 12);
  assert.equal(result.throughSeq, 11);
  assert.equal(result.markdown, formatSessionMarkdown(events));
  assert.equal(result.sourcePathIncluded, false);
  assert.ok(result.markdown.includes("full-output-" + "y".repeat(900)));
  assert.ok(result.markdown.includes("full-arguments-" + "x".repeat(900)));
  assert.ok(result.markdown.includes("[Image: image.png"));
  assert.ok(result.markdown.includes("[File: file.txt"));
  assert.equal(result.markdown.includes("private injected"), false);
  assert.equal(result.markdown.includes("reasoning omitted"), false);
  assert.equal(result.markdown.includes("surface replacement"), false);
  assert.deepEqual(
    calls.map((call) => call.args.request),
    [
      { address: { kind: "session", sessionId: "session" }, maxMessages: 200 },
      {
        address: { kind: "session", sessionId: "session" },
        maxMessages: 200,
        throughSeq: 11,
        beforeSeq: 8,
      },
      {
        address: { kind: "session", sessionId: "session" },
        maxMessages: 200,
        throughSeq: 11,
        beforeSeq: 4,
      },
    ],
  );
  assert.equal(configured(), 1);
  assert.equal(projection.events.size, 0);
  assert.equal(adapter.streams.size, 0);
  assert.equal(adapter.owners.size, 1);
  await adapter.close();
});
test("missing, changing, conflicting and non-advancing history never produce a falsely complete transcript", async () => {
  for (const [pages, code] of [
    [[page(events.slice(1))], "INCOMPLETE_HISTORY"],
    [
      [page(events.slice(8), 11, true), page(events.slice(0, 8), 12)],
      "INCONSISTENT_HISTORY",
    ],
    [
      [page(events.slice(8), 11, true), page([events[8]], 11, true)],
      "INCONSISTENT_HISTORY",
    ],
    [
      [
        page(events.slice(8), 11, true),
        page([...events.slice(0, 8), { ...events[8], type: "changed" }]),
      ],
      "INCONSISTENT_HISTORY",
    ],
    [[{ cursor: 11, hasMore: false, records: [] }], "INCOMPLETE_HISTORY"],
  ]) {
    const { adapter, scope } = await setup(pages);
    await assert.rejects(
      adapter.request("exportSessionMarkdown", {
        sessionId: "session",
        clientScope: scope,
      }),
      (error) => error.code === code && error.delivery === "rejected",
    );
    await adapter.close();
  }
});
test("export has explicit event, byte, page and stdout-result budgets instead of silent truncation", async () => {
  for (const limit of [
    { maxEvents: 10 },
    { maxEventBytes: 1 },
    { maxPages: 1 },
    { maxResultBytes: 1 },
  ]) {
    let reads = 0;
    const pages = [page(events.slice(8), 11, true), page(events.slice(0, 8))];
    await assert.rejects(
      collectSessionMarkdown({
        sessionId: "session",
        gateway: { invoke: async () => pages[reads++] },
        client: { rpc: async () => ({ compact: false }) },
        signal: new AbortController().signal,
        assertCurrent() {},
        limits: { ...SESSION_MARKDOWN_LIMITS, ...limit },
      }),
      (error) => error.code === "EXPORT_LIMIT" && error.delivery === "rejected",
    );
  }
});
test("a retired owner or Host aborts and rejects late export pages before reading their body", async () => {
  for (const retire of ["owner", "host"]) {
    const { adapter, scope } = await setup([]);
    const held = Promise.withResolvers();
    let signal;
    adapter.gateway.invoke = (request) => {
      signal = request.signal;
      return held.promise;
    };
    const read = adapter.request("exportSessionMarkdown", {
      sessionId: "session",
      clientScope: scope,
    });
    await Promise.resolve();
    await Promise.resolve();
    if (retire === "owner") adapter.closeOwnerStreams(scope.ownerId);
    else adapter.connectionGeneration++;
    let inspected = false;
    held.resolve({
      get cursor() {
        inspected = true;
        throw Error("late body accessed");
      },
    });
    await assert.rejects(read, (error) => error.code === "STALE_CONTEXT");
    assert.equal(inspected, false);
    if (retire === "owner") assert.equal(signal.aborted, true);
    await adapter.close();
  }
});
test("read-only export is supported but requires a registered session owner and confirmed uncompacted history", async () => {
  const { adapter, scope } = await setup([page([], -1)]);
  adapter.readOnly = true;
  const result = await adapter.request("exportSessionMarkdown", {
    sessionId: "session",
    clientScope: scope,
  });
  assert.equal(result.complete, true);
  assert.equal(result.eventCount, 0);
  await assert.rejects(
    adapter.request("exportSessionMarkdown", { sessionId: "session" }),
    { code: "OWNER_REQUIRED" },
  );
  adapter.connected.client.rpc = async () => ({ compact: true });
  await assert.rejects(
    adapter.request("exportSessionMarkdown", {
      sessionId: "session",
      clientScope: scope,
    }),
    { code: "UNCOMPACTED_HISTORY_REQUIRED" },
  );
  await adapter.close();
});
