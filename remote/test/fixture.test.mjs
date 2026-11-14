import { test } from "node:test";
import assert from "node:assert/strict";
import { FixtureAdapter } from "../fixture.mjs";
test("explicit fixture uses real workspace, requestId and question validation", async () => {
  const a = new FixtureAdapter(() => {});
  try {
    await a.request("connect", { hostId: "fixture-host" });
    await assert.rejects(
      a.request("selectWorkspace", { workspaceID: "fixture-workspace" }),
      { code: "INVALID_ARGUMENT" },
    );
    await a.request("selectWorkspace", { workspaceId: "fixture-workspace" });
    const snapshot = await a.request("openSession", {
      sessionId: "fixture-session",
    });
    assert.equal(snapshot.pending.length, 2);
    await assert.rejects(
      a.request("sendMessage", { sessionId: "fixture-session", text: "hello" }),
      { code: "INVALID_ARGUMENT" },
    );
    await assert.rejects(
      a.request("answerQuestions", {
        requestId: "fixture-question",
        answers: [{ id: "choice", selected: ["wrong-option"] }],
      }),
      { code: "INVALID_ANSWERS" },
    );
    await a.request("answerQuestions", {
      requestId: "fixture-question",
      answers: [{ id: "choice", selected: ["保留动效"] }],
    });
    assert.equal(a.snapshot().pending.length, 1);
    assert.equal(a.status().dataSource, "fixture");
  } finally {
    await a.close();
  }
});
