import { test } from "node:test";
import assert from "node:assert/strict";
import { FixtureAdapter } from "../fixture.mjs";
import { RemoteAdapter } from "../client.mjs";

const SESSIONS = ["cache-a", "cache-b", "cache-c", "cache-d"];

// The fixture peer serves one Session. This subclass keeps its transport and
// handshake but serves four deterministic Sessions whose follows stay
// controllable, so follow opens and background frames are observable.
class CacheAdapter extends FixtureAdapter {
  constructor(emit) {
    super(emit);
    this.followLog = [];
    this.followStreams = new Map();
  }
  openSession(sessionId) {
    // Keep the real adapter's cache path: the fixture wrapper re-injects its
    // own approval/question rows and returns a fresh snapshot value.
    return RemoteAdapter.prototype.openSession.call(this, sessionId);
  }
  async connect(hostId, options) {
    const result = await super.connect(hostId, options);
    const gateway = this.gateway,
      invoke = gateway.invoke.bind(gateway),
      open = gateway.open.bind(gateway);
    gateway.invoke = (payload) =>
      payload.namespace === "session" && payload.method === "list"
        ? {
            items: SESSIONS.map((id) => ({
              sessionId: id,
              title: id,
              running: false,
              updatedAt: 1,
            })),
          }
        : invoke(payload);
    gateway.open = (endpoint, payload, signal) => {
      if (endpoint !== "session/follow") return open(endpoint, payload, signal);
      const sessionId = payload.args.request.address.sessionId;
      this.followLog.push(sessionId);
      return this.followStream(sessionId, signal);
    };
    await this.sessions();
    return result;
  }
  async *followStream(sessionId, signal) {
    const frames = [];
    let wake;
    signal.addEventListener("abort", () => wake?.(), { once: true });
    this.followStreams.set(sessionId, {
      push: (frame) => {
        frames.push(frame);
        wake?.();
        wake = undefined;
      },
    });
    try {
      yield {
        type: "snapshot",
        cursor: 1,
        hasMore: false,
        assistantStream: { revision: 0 },
        records: [
          {
            type: "event",
            event: { type: "session/title", seq: 0, time: 1, data: { title: sessionId } },
          },
          {
            type: "event",
            event: {
              type: "user/message",
              seq: 1,
              time: 2,
              surfaceOp: "append",
              data: {
                id: `${sessionId}-m1`,
                source: { kind: "user" },
                content: [{ type: "text", text: `${sessionId} first` }],
              },
            },
          },
        ],
      };
      for (;;) {
        if (signal.aborted) return;
        if (!frames.length) {
          await new Promise((resolve) => {
            wake = resolve;
          });
          continue;
        }
        yield frames.shift();
      }
    } finally {
      this.followStreams.delete(sessionId);
    }
  }
  pushMessage(sessionId, seq, text) {
    const stream = this.followStreams.get(sessionId);
    if (!stream) throw new Error(`no live follow for ${sessionId}`);
    stream.push({
      type: "event",
      event: {
        type: "user/message",
        seq,
        time: seq,
        surfaceOp: "append",
        data: {
          id: `${sessionId}-m${seq}`,
          source: { kind: "user" },
          content: [{ type: "text", text }],
        },
      },
    });
  }
}

// Frames and aborts travel through async iterators; poll the observable state
// instead of sleeping for a fixed slice.
const waitFor = async (label, predicate) => {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timeout waiting for ${label}`);
};

test("returning to a followed Session replays no baseline", async () => {
  const a = new CacheAdapter(() => {});
  try {
    await a.request("connect", { hostId: "fixture-host" });
    const first = await a.request("openSession", { sessionId: "cache-a" });
    assert.equal(first.messages.length, 1);

    await a.request("openSession", { sessionId: "cache-b" });
    const back = await a.request("openSession", { sessionId: "cache-a" });
    assert.equal(back.messages.length, 1);
    assert.deepEqual(a.followLog, ["cache-a", "cache-b"]);

    // Re-selecting the followed Session is not a switch either.
    await a.request("openSession", { sessionId: "cache-a" });
    assert.deepEqual(a.followLog, ["cache-a", "cache-b"]);
  } finally {
    await a.close();
  }
});

test("a cached follow keeps applying but never publishes", async () => {
  const emitted = [];
  const a = new CacheAdapter((method, params) => emitted.push({ method, params }));
  try {
    await a.request("connect", { hostId: "fixture-host" });
    await a.request("openSession", { sessionId: "cache-a" });
    await a.request("openSession", { sessionId: "cache-b" });

    a.pushMessage("cache-a", 2, "background-only");
    await waitFor(
      "the cached follow to ingest its frame",
      () =>
        a.sessionCache.get("cache-a")?.projection.value().messages.length === 2,
    );

    const after = emitted.filter((entry) => JSON.stringify(entry).includes("background-only"));
    assert.deepEqual(after, [], "a background follow must not reach the visible projection");
    assert.equal(a.snapshot().sessionId, "cache-b");
    assert.equal(a.snapshot().messages.length, 1);

    const back = await a.request("openSession", { sessionId: "cache-a" });
    assert.equal(back.messages.length, 2);
    assert.ok(back.messages.some((m) => m.text === "background-only"));
    assert.deepEqual(a.followLog, ["cache-a", "cache-b"]);
  } finally {
    await a.close();
  }
});

test("the Session cache is bounded and clear releases every follow", async () => {
  const a = new CacheAdapter(() => {});
  try {
    await a.request("connect", { hostId: "fixture-host" });
    for (const id of SESSIONS) await a.request("openSession", { sessionId: id });
    assert.deepEqual(a.followLog, SESSIONS);
    // Limit is three: the oldest entry was evicted and aborted.
    assert.equal(a.followStreams.has("cache-a"), false);
    assert.equal(a.followStreams.size, 3);

    await a.request("openSession", { sessionId: "cache-a" });
    assert.deepEqual(
      a.followLog.filter((id) => id === "cache-a"),
      ["cache-a", "cache-a"],
    );

    await a.request("clearSession", {});
    await waitFor("cached follows released", () => a.followStreams.size === 0);
    await a.request("openSession", { sessionId: "cache-b" });
    assert.deepEqual(
      a.followLog.filter((id) => id === "cache-b"),
      ["cache-b", "cache-b"],
    );
  } finally {
    await a.close();
  }
});
