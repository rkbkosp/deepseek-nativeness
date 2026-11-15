import { test } from "node:test";
import assert from "node:assert/strict";
import { FixtureAdapter } from "../fixture.mjs";

test("workspace create is a fenced write the workspace catalog then reports", async () => {
  const a = new FixtureAdapter(() => {});
  try {
    await a.request("connect", { hostId: "fixture-host" });
    await assert.rejects(a.request("createWorkspace", { path: "/fixture/work" }), {
      code: "INVALID_ARGUMENT",
    });
    await assert.rejects(
      a.request("createWorkspace", { path: "/fixture/work", requestId: "short" }),
      { code: "INVALID_REQUEST_ID" },
    );
    await assert.rejects(
      a.request("createWorkspace", {
        path: "",
        requestId: "fixture-workspace-intent-empty",
      }),
      { code: "INVALID_ARGUMENT" },
    );

    const listing = await a.request("listDirectories", { path: "/fixture" });
    assert.equal(listing.path, "/fixture");
    assert.deepEqual(
      listing.entries.map((e) => e.path),
      ["/fixture/work"],
    );
    await assert.rejects(a.request("listDirectories", { path: "/elsewhere" }), {
      code: "directory-picker/unreadable",
    });

    const receipt = await a.request("createWorkspace", {
      path: "/fixture/work",
      requestId: "fixture-workspace-intent-0001",
    });
    assert.equal(receipt.status, "accepted");
    assert.equal(receipt.requestId, "fixture-workspace-intent-0001");
    assert.equal(receipt.value.created, true);
    const created = receipt.value.workspace.workspaceId;
    assert.equal(receipt.value.workspace.path, "/fixture/work");

    const repeat = await a.request("createWorkspace", {
      path: "/fixture/work",
      requestId: "fixture-workspace-intent-0002",
    });
    assert.equal(repeat.value.created, false);
    assert.equal(repeat.value.workspace.workspaceId, created);

    const rows = await a.request("workspaces", {});
    assert.ok(
      rows.some((w) => w.id === created && w.path === "/fixture/work"),
      "the created Workspace must appear in the next registry read",
    );
    const selected = await a.request("selectWorkspace", { workspaceId: created });
    assert.ok(Array.isArray(selected));
  } finally {
    await a.close();
  }
});
