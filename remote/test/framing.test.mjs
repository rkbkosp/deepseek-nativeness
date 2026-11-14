import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createJsonLineInput, requestIdFromPrefix } from "../framing.mjs";
import { spawn } from "node:child_process";

test("oversized frames retain only a bounded prefix, recover the id, then parse the next request", () => {
  const input = new PassThrough(),
    large = [],
    lines = [];
  const reader = createJsonLineInput(input, {
    maxBytes: 1024,
    onLine: (line) => lines.push(JSON.parse(line)),
    onOversize: (prefix) => large.push(requestIdFromPrefix(prefix)),
    onClose: () => {},
  });
  input.write('{"id":41,"method":"fixture","params":{"data":"');
  for (let i = 0; i < 100; i++) input.write(Buffer.alloc(512, 65));
  assert.equal(reader.stats().oversized, true);
  assert.ok(reader.stats().retainedBytes <= 4096);
  input.write('"}}\n{"id":42,"method":"status","params":{}}\n');
  assert.deepEqual(large, [41]);
  assert.deepEqual(lines, [{ id: 42, method: "status", params: {} }]);
  reader.close();
  assert.equal(input.listenerCount("data"), 0);
});

test(
  "the real helper returns correlated rejected oversize errors and remains usable",
  { timeout: 5000 },
  async () => {
    const child = spawn(
      process.execPath,
      [new URL("../bridge.mjs", import.meta.url).pathname, "--fixture"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const records = [];
    let buffer = "",
      resolveDone,
      rejectDone;
    const done = new Promise((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (!line) continue;
        const row = JSON.parse(line);
        records.push(row);
        if (row.id === 52) {
          child.stdin.end(
            JSON.stringify({ id: 53, method: "close", params: {} }) + "\n",
          );
          resolveDone();
        }
      }
    });
    child.on("error", rejectDone);
    child.stdin.write(
      JSON.stringify({
        id: 51,
        method: "sendMessage",
        params: { data: "A".repeat(1024 * 1024 + 1) },
      }) + "\n",
    );
    child.stdin.write(
      JSON.stringify({ id: 52, method: "status", params: {} }) + "\n",
    );
    try {
      await done;
      assert.equal(
        records.find((row) => row.id === 51).error.delivery,
        "rejected",
      );
      assert.equal(
        records.find((row) => row.id === 51).error.code,
        "REQUEST_TOO_LARGE",
      );
      assert.equal(
        records.find((row) => row.id === 52).result.transportLimits
          .maxRequestBytes,
        1024 * 1024,
      );
    } finally {
      child.kill();
    }
  },
);
