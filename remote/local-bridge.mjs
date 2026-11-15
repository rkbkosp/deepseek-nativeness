#!/usr/bin/env node
/**
 * Native client helper for a Host this shell started.
 *
 * Same stdio JSON-lines contract as `bridge.mjs` — the Go client cannot tell
 * which helper it is talking to — but the carrier is loopback HTTP and
 * `/api/remote.mux` instead of a Remote server, so there is no login, no device
 * list and no WebRTC.
 *
 *   node local-bridge.mjs --url http://127.0.0.1:PORT/?token=… \
 *                         --runtime /path/to/Contents/Resources/runtime
 */

import {
  createJsonLineInput,
  requestIdFromPrefix,
  MAX_REQUEST_BYTES,
} from "./framing.mjs";
import { LocalAdapter } from "./local-adapter.mjs";

function parseArgs(argv) {
  const options = { url: undefined, runtime: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--url") {
      if (value === undefined || value === "") throw new Error("--url needs a value");
      options.url = value;
      index += 1;
    } else if (key === "--runtime") {
      if (value === undefined || value === "") throw new Error("--runtime needs a value");
      options.runtime = value;
      index += 1;
    } else {
      throw new Error(`local-bridge: unknown argument ${key}`);
    }
  }
  if (options.url === undefined) throw new Error("local-bridge: --url is required");
  if (options.runtime === undefined) throw new Error("local-bridge: --runtime is required");
  return options;
}

const options = (() => {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`local-bridge: ${error.message}\n`);
    process.exit(64);
  }
})();

const emit = (method, params, scope) =>
  process.stdout.write(
    JSON.stringify({ method, params, ...(scope ? { scope } : {}) }) + "\n",
  );

const adapter = new LocalAdapter(emit, {
  url: options.url,
  runtimeRoot: options.runtime,
});

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
              message: safeMessage(error),
              ...(error?.delivery === "rejected"
                ? { delivery: "rejected" }
                : {}),
            },
          }) + "\n",
        );
      },
    );
};

// Local mode has no password or credential literal to redact; only bearer-like
// text could reach a message through a Host refusal.
function safeMessage(error) {
  const text =
    error instanceof Error ? error.message : "Remote operation failed.";
  return text.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 1000);
}

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

adapter.notifyStatus("本地 Host 已就绪");
