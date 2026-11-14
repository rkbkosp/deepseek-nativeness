#!/usr/bin/env node
import {
  createJsonLineInput,
  requestIdFromPrefix,
  MAX_REQUEST_BYTES,
} from "./framing.mjs";
import { RemoteAdapter } from "./client.mjs";
import { FixtureAdapter } from "./fixture.mjs";
const emit = (method, params, scope) =>
  process.stdout.write(
    JSON.stringify({ method, params, ...(scope ? { scope } : {}) }) + "\n",
  );
const adapter = process.argv.includes("--fixture")
  ? new FixtureAdapter(emit)
  : new RemoteAdapter(emit);
let input;
let closed = false;
const finish = async () => {
  if (closed) return;
  closed = true;
  input?.close();
  await adapter.close();
};
const dispatchLine = (line) => {
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
              message: safeMessage(error, req),
              ...(error?.delivery === "rejected"
                ? { delivery: "rejected" }
                : {}),
            },
          }) + "\n",
        );
      },
    );
};
input = createJsonLineInput(process.stdin, {
  onLine: dispatchLine,
  onOversize: (prefix) => {
    const id = requestIdFromPrefix(prefix),
      error = {
        code: "REQUEST_TOO_LARGE",
        message: "Client request exceeds " + MAX_REQUEST_BYTES + " bytes.",
        delivery: "rejected",
      };
    if (id === undefined) emit("error", error);
    else process.stdout.write(JSON.stringify({ id, error }) + "\n");
  },
  onClose: () => void finish(),
});
process.on("SIGTERM", () => void finish());
process.on("SIGINT", () => void finish());
function safeMessage(error, request) {
  const text =
    error instanceof Error ? error.message : "Remote operation failed.";
  // Error messages must never contain bearer credentials, passwords or key material.
  let safe = text.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  const literal =
    request?.method === "login"
      ? request.params?.password
      : request?.method === "setCredential"
        ? request.params?.value
        : undefined;
  if (typeof literal === "string" && literal)
    safe = safe.replaceAll(literal, "[redacted]");
  return safe.slice(0, 1000);
}
