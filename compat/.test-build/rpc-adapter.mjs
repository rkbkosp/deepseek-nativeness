// deepseek-harness/packages/util/crypto/src/index.ts
function randomUUID() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (byte, index) => {
    const pinned = index === 6 ? byte & 15 | 64 : index === 8 ? byte & 63 | 128 : byte;
    return pinned.toString(16).padStart(2, "0");
  }).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// desktop/compat/src/bridge.ts
async function request(method, params = {}) {
  if (!window.mygo) throw Error("\u539F\u751F\u8FDE\u63A5\u4E0D\u53EF\u7528\u3002");
  return window.mygo.call("CompatAPI.Request", method, params);
}
var operationId = () => randomUUID();

// desktop/compat/src/rpc-adapter.ts
var safeRejections = /* @__PURE__ */ new Set(["INVALID_ARGUMENT", "STALE_CONTEXT", "READ_ONLY", "NOT_CONNECTED", "UNSUPPORTED_OPERATION", "REMOTE_NAMESPACE_FROZEN", "REMOTE_PLUGIN_FROZEN"]);
function createPageRpc(ctx, call = request) {
  const intents = /* @__PURE__ */ new Map();
  const scope = { hostId: ctx.hostId, generation: ctx.connectionGeneration, sessionId: ctx.sessionId, ownerId: ctx.ownerId };
  const read = async (method, params = {}) => {
    try {
      return { ok: true, value: await call(method, { ...params, clientScope: scope }) };
    } catch (error) {
      return { ok: false, error: { code: error.code ?? "FAILED", message: error.message } };
    }
  };
  const write = (method, params = {}) => {
    if (!ctx.operations?.[method]) return Promise.resolve({ ok: false, error: { code: "UNSUPPORTED_OPERATION", message: "\u5F53\u524D\u8FDC\u7A0B\u8FDE\u63A5\u672A\u5F00\u653E\u6B64\u64CD\u4F5C\u3002", delivery: "rejected" } });
    const key = JSON.stringify([method, params]);
    const existing = intents.get(key);
    if (existing) return existing.promise;
    const id = operationId();
    const entry = { id, promise: Promise.resolve(null) };
    entry.promise = Promise.resolve().then(async () => {
      try {
        const result = await call(method, { ...params, requestId: id, clientScope: scope });
        if (result.status !== "accepted") return { ok: false, error: { code: "RECEIPT_UNKNOWN", message: "\u54CD\u5E94\u672A\u786E\u8BA4\u3002\u4E0D\u4F1A\u81EA\u52A8\u91CD\u53D1\u6B64\u64CD\u4F5C\uFF0C\u8BF7\u5148\u6838\u5BF9\u8FDC\u7A0B\u72B6\u6001\u3002" } };
        if (result.requestId !== id || result.hostId !== ctx.hostId || result.connectionGeneration !== ctx.connectionGeneration) return { ok: false, error: { code: "RECEIPT_SCOPE_MISMATCH", message: "\u54CD\u5E94\u6765\u6E90\u4E0E\u6253\u5F00\u9875\u9762\u65F6\u7684\u8FDE\u63A5\u4E0D\u4E00\u81F4\uFF0C\u8BF7\u6838\u5BF9\u72B6\u6001\u3002" } };
        intents.delete(key);
        return { ok: true, value: result.value };
      } catch (error) {
        const rejected = error.delivery === "rejected" || safeRejections.has(error.code);
        if (rejected) intents.delete(key);
        return { ok: false, error: { code: error.code ?? "FAILED", message: error.message, ...rejected ? { delivery: "rejected" } : {} } };
      }
    });
    intents.set(key, entry);
    return entry.promise;
  };
  return { read, write };
}
export {
  createPageRpc
};
