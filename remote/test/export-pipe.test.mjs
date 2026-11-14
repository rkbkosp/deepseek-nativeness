import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const entries = [
  ["source", fileURLToPath(new URL("../bridge.mjs", import.meta.url))],
];
if (process.env.NATIVE_DSH_REMOTE_CANDIDATE)
  entries.push(["candidate", process.env.NATIVE_DSH_REMOTE_CANDIDATE]);
for (const [name, entry] of entries)
  test(
    `${name} JSON-lines helper exposes owner-scoped full Markdown without changing chat state`,
    { timeout: 5000 },
    async () => {
      const child = spawn(process.execPath, [entry, "--fixture"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      const pending = new Map();
      let buffer = "",
        sequence = 0;
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const value = JSON.parse(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
          if (value.id !== undefined) {
            const waiter = pending.get(value.id);
            pending.delete(value.id);
            if (value.error)
              waiter?.reject(
                Object.assign(Error(value.error.message), value.error),
              );
            else waiter?.resolve(value.result);
          }
        }
      });
      const call = (method, params = {}) =>
        new Promise((resolve, reject) => {
          const id = ++sequence,
            timer = setTimeout(
              () => reject(Error("fixture RPC timed out")),
              2000,
            );
          pending.set(id, {
            resolve: (value) => {
              clearTimeout(timer);
              resolve(value);
            },
            reject: (error) => {
              clearTimeout(timer);
              reject(error);
            },
          });
          child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
        });
      try {
        const status = await call("connect", { hostId: "fixture-host" });
        await call("openSession", { sessionId: "fixture-session" });
        const before = await call("presentation");
        const clientScope = {
          hostId: status.hostId,
          generation: status.connectionGeneration,
          sessionId: "fixture-session",
        };
        const capabilities = await call("capabilities", {
          sessionId: "fixture-session",
          clientScope,
        });
        assert.equal(capabilities.operations.exportSessionMarkdown, true);
        await call("registerOwner", {
          ownerId: "export-pipe-owner",
          clientScope,
        });
        const result = await call("exportSessionMarkdown", {
          sessionId: "fixture-session",
          clientScope: { ...clientScope, ownerId: "export-pipe-owner" },
        });
        assert.equal(result.complete, true);
        assert.equal(result.eventCount, 3);
        assert.equal(result.throughSeq, 2);
        assert.equal(result.sourcePathIncluded, false);
        assert.ok(result.markdown.startsWith("# 完整Markdown协议夹具\n"));
        assert.ok(result.markdown.includes("> 请保留界面风格和动效。"));
        assert.deepEqual(await call("presentation"), before);
        await call("closeOwnerStreams", { ownerId: "export-pipe-owner" });
        const stats = await call("runtimeStats");
        assert.equal(stats.owners, 0);
        assert.equal(stats.streams, 0);
      } finally {
        child.stdin.end();
        child.kill();
      }
    },
  );
