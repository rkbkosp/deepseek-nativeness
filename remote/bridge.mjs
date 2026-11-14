#!/usr/bin/env node
import { createInterface } from "node:readline";
import { RemoteAdapter } from "./client.mjs";
import { FixtureAdapter } from "./fixture.mjs";
const emit = (method, params) =>
  process.stdout.write(JSON.stringify({ method, params }) + "\n");
const adapter = process.argv.includes("--fixture")
  ? new FixtureAdapter(emit)
  : new RemoteAdapter(emit);
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let closed = false;
const finish = async () => {
  if (closed) return;
  closed = true;
  input.close();
  await adapter.close();
};
input.on("line", (line) => {
  if (Buffer.byteLength(line) > 1024 * 1024) {
    emit("error", {
      code: "REQUEST_TOO_LARGE",
      message: "Client request exceeds 1 MiB.",
    });
    return;
  }
  let req;
  try {
    req = JSON.parse(line);
    if (
      !req ||
      !["string", "number"].includes(typeof req.id) ||
      typeof req.method !== "string"
    )
      throw Error();
  } catch {
    emit("error", {
      code: "INVALID_REQUEST",
      message: "Expected a JSON-lines request with id, method and params.",
    });
    return;
  }
  Promise.resolve()
    .then(() => adapter.request(req.method, req.params ?? {}))
    .then(
      (result) => {
        process.stdout.write(JSON.stringify({ id: req.id, result }) + "\n");
        if (req.method === "close") void finish();
      },
      (error) => {
        process.stdout.write(
          JSON.stringify({
            id: req.id,
            error: {
              code:
                typeof error?.code === "string" ? error.code : "REMOTE_ERROR",
              message: safeMessage(error),
              ...(error?.delivery === "rejected"
                ? { delivery: "rejected" }
                : {}),
            },
          }) + "\n",
        );
      },
    );
});
input.on("close", () => void finish());
process.on("SIGTERM", () => void finish());
process.on("SIGINT", () => void finish());
function safeMessage(error) {
  const text =
    error instanceof Error ? error.message : "Remote operation failed.";
  // Error messages must never contain bearer credentials, passwords or key material.
  return text.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 1000);
}
