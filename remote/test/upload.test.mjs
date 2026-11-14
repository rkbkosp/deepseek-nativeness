import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RemoteAdapter } from "../client.mjs";
test("existing dedicated upload protocol sends bounded chunks once and caches its receipt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "native-dsh-upload-fixture-"));
  const file = join(dir, "fixture.txt");
  const bytes = 70000;
  await writeFile(file, "x".repeat(bytes));
  const calls = [];
  const a = new RemoteAdapter();
  a.hostId = "fixture-host";
  a.interactionReady = true;
  a.sessionRows = [{ id: "s" }];
  a.connected = {
    client: {
      getStats: () => ({ mode: "LAN" }),
      close: async () => {},
      rpc: async (method, p) => {
        calls.push(method);
        if (method === "harness.transport.describe")
          return { capabilities: ["workspace.upload.v1"] };
        if (method === "workspace.upload.open")
          return { uploadId: p.uploadId, chunkBytes: 65536 };
        if (method === "workspace.upload.chunk")
          return {
            uploadId: p.uploadId,
            receivedBytes: p.offset + Buffer.from(p.data, "base64").length,
          };
        if (method === "workspace.upload.commit")
          return { name: "fixture.txt", path: ".fixture/fixture.txt", bytes };
      },
    },
  };
  try {
    const p = {
      sessionId: "s",
      localPath: file,
      name: "fixture.txt",
      requestId: "fixture-upload-00000001",
    };
    const first = await a.request("uploadWorkspaceFile", p);
    assert.equal(first.status, "accepted");
    assert.equal(first.composerAttachment, false);
    assert.equal(first.bytes, bytes);
    assert.equal(
      (await a.request("uploadWorkspaceFile", p)).status,
      "accepted",
    );
    assert.equal(calls.filter((m) => m === "workspace.upload.chunk").length, 2);
    assert.equal(
      calls.filter((m) => m === "workspace.upload.commit").length,
      1,
    );
  } finally {
    await a.close();
    await rm(dir, { recursive: true, force: true });
  }
});
