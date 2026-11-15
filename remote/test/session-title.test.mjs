import test from "node:test";
import assert from "node:assert/strict";
import { RemoteAdapter } from "../client.mjs";

test("a live title projection renames the cached list row", () => {
  const adapter = new RemoteAdapter(() => {});
  adapter.sessionRows = [{ id: "s", title: "新会话" }, { id: "other", title: "其他" }];
  adapter.syncRowTitle({
    sessionId: "s",
    projections: { asOfSeq: 4, values: { title: "修复会话名" } },
  });
  assert.equal(adapter.sessionRows[0].title, "修复会话名");
  assert.equal(adapter.sessionRows[1].title, "其他");
});

test("the publisher path also renames the row and emits the projection", () => {
  const notices = [];
  const adapter = new RemoteAdapter((method, params) => notices.push({ method, params }));
  adapter.hostId = "host";
  adapter.connectionGeneration = 1;
  adapter.sessionRows = [{ id: "s", title: "新会话" }];
  const snapshot = (revision, title) => ({
    sessionId: "s",
    messages: [],
    pending: [],
    trajectory: [],
    projections: { asOfSeq: revision, values: { title } },
    running: false,
    cursor: 0,
    hasMore: false,
  });
  adapter.publisher.replace(snapshot(1, "旧标题"));
  adapter.publisher.state(snapshot(2, "新标题"));
  assert.equal(adapter.sessionRows[0].title, "新标题");
  const projection = notices.find(n => n.method === "sessionProjections");
  assert.equal(projection.params.projections.values.title, "新标题");
});

test("empty or absent titles never erase the row name", () => {
  const adapter = new RemoteAdapter(() => {});
  adapter.sessionRows = [{ id: "s", title: "保留" }];
  for (const projections of [
    { asOfSeq: 1, values: { title: "" } },
    { asOfSeq: 1, values: { title: "   " } },
    { asOfSeq: 1, values: {} },
    { asOfSeq: 1 },
    undefined,
  ]) {
    adapter.syncRowTitle({ sessionId: "s", projections });
  }
  assert.equal(adapter.sessionRows[0].title, "保留");
});
