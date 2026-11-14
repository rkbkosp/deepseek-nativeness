export const MAX_REQUEST_BYTES = 1024 * 1024;
const PREFIX_BYTES = 4096;

/** Retain at most one bounded frame; oversized input is drained without buffering its body. */
export function createJsonLineInput(
  stream,
  { maxBytes = MAX_REQUEST_BYTES, onLine, onOversize, onClose },
) {
  let parts = [],
    bytes = 0,
    prefix = Buffer.alloc(0),
    oversized = false,
    closed = false;
  const reset = () => {
    parts = [];
    bytes = 0;
    prefix = Buffer.alloc(0);
    oversized = false;
  };
  const append = (part) => {
    if (prefix.length < PREFIX_BYTES)
      prefix = Buffer.concat([
        prefix,
        part.subarray(0, PREFIX_BYTES - prefix.length),
      ]);
    if (oversized) return;
    bytes += part.length;
    if (bytes > maxBytes) {
      oversized = true;
      parts = [];
      return;
    }
    parts.push(Buffer.from(part));
  };
  const flush = () => {
    if (oversized) onOversize(prefix.toString("utf8"));
    else if (bytes) onLine(Buffer.concat(parts, bytes).toString("utf8"));
    reset();
  };
  const data = (chunk) => {
    if (closed) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let start = 0;
    for (
      let newline = buffer.indexOf(10, start);
      newline >= 0;
      newline = buffer.indexOf(10, start)
    ) {
      append(buffer.subarray(start, newline));
      flush();
      start = newline + 1;
      if (closed) return;
    }
    if (start < buffer.length) append(buffer.subarray(start));
  };
  const end = () => {
    if (closed) return;
    flush();
    onClose();
  };
  stream.on("data", data);
  stream.on("end", end);
  stream.on("error", end);
  return {
    stats: () => ({
      retainedBytes: oversized ? prefix.length : bytes + prefix.length,
      oversized,
    }),
    close() {
      if (closed) return;
      closed = true;
      stream.off("data", data);
      stream.off("end", end);
      stream.off("error", end);
      stream.pause?.();
      reset();
    },
  };
}
/** Native writes id first. The bounded prefix never needs to expose body/credentials. */
export function requestIdFromPrefix(prefix) {
  const match = prefix.match(
    /^\s*\{\s*"id"\s*:\s*("(?:[^"\\]|\\.){0,512}"|[0-9]{1,16})(?=\s*[,}])/s,
  );
  if (!match) return undefined;
  try {
    const id = JSON.parse(match[1]);
    return typeof id === "string" || Number.isSafeInteger(id) ? id : undefined;
  } catch {
    return undefined;
  }
}
