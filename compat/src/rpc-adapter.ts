import { operationId, request } from "./bridge";

type Outcome =
  | { ok: true; value: any }
  | { ok: false; error: { code: string; message: string; delivery?: string } };
const safeRejections = new Set([
  "INVALID_ARGUMENT",
  "STALE_CONTEXT",
  "READ_ONLY",
  "NOT_CONNECTED",
  "UNSUPPORTED_OPERATION",
  "REMOTE_NAMESPACE_FROZEN",
  "REMOTE_PLUGIN_FROZEN",
]);

/** One owner keeps uncertain intents rather than minting a retry identity. */
export function createPageRpc(ctx: any, call = request) {
  let active = true;
  const intents = new Map<string, { id: string; promise: Promise<Outcome> }>();
  const scope = {
    hostId: ctx.hostId,
    generation: ctx.connectionGeneration,
    sessionId: ctx.sessionId,
    ownerId: ctx.ownerId,
  };
  const read = async (
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Outcome> => {
    if (!active)
      return {
        ok: false,
        error: {
          code: "PAGE_DISPOSED",
          message: "页面已关闭。",
          delivery: "rejected",
        },
      };
    try {
      const value = await call(method, { ...params, clientScope: scope });
      return active
        ? { ok: true, value }
        : {
            ok: false,
            error: { code: "PAGE_DISPOSED", message: "页面已关闭。" },
          };
    } catch (error: any) {
      return {
        ok: false,
        error: { code: error.code ?? "FAILED", message: error.message },
      };
    }
  };
  const write = (
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Outcome> => {
    if (!active)
      return Promise.resolve({
        ok: false,
        error: {
          code: "PAGE_DISPOSED",
          message: "页面已关闭。",
          delivery: "rejected",
        },
      });
    if (!ctx.operations?.[method])
      return Promise.resolve({
        ok: false,
        error: {
          code: "UNSUPPORTED_OPERATION",
          message: "当前远程连接未开放此操作。",
          delivery: "rejected",
        },
      });
    const key = JSON.stringify([method, params]);
    const existing = intents.get(key);
    if (existing) return existing.promise;
    const id = operationId();
    const entry = { id, promise: Promise.resolve(null as unknown as Outcome) };
    entry.promise = Promise.resolve().then(async () => {
      if (!active)
        return {
          ok: false,
          error: {
            code: "PAGE_DISPOSED",
            message: "页面已关闭。",
            delivery: "rejected",
          },
        } as Outcome;
      try {
        const result = await call(method, {
          ...params,
          requestId: id,
          clientScope: scope,
        });
        if (!active)
          return {
            ok: false,
            error: {
              code: "PAGE_DISPOSED",
              message: "页面已关闭，请在重新打开后核对操作结果。",
            },
          } as Outcome;
        if (result.status !== "accepted")
          return {
            ok: false,
            error: {
              code: "RECEIPT_UNKNOWN",
              message: "响应未确认。不会自动重发此操作，请先核对远程状态。",
            },
          } as Outcome;
        if (
          result.requestId !== id ||
          result.hostId !== ctx.hostId ||
          result.connectionGeneration !== ctx.connectionGeneration
        )
          return {
            ok: false,
            error: {
              code: "RECEIPT_SCOPE_MISMATCH",
              message: "响应来源与打开页面时的连接不一致，请核对状态。",
            },
          } as Outcome;
        intents.delete(key);
        return { ok: true, value: result.value } as Outcome;
      } catch (error: any) {
        const rejected =
          error.delivery === "rejected" || safeRejections.has(error.code);
        if (rejected) intents.delete(key);
        const literal =
          method === "setCredential" && typeof params.value === "string"
            ? params.value
            : "";
        const message = literal
          ? String(error.message).replaceAll(literal, "[已隐藏]")
          : error.message;
        return {
          ok: false,
          error: {
            code: error.code ?? "FAILED",
            message,
            ...(rejected ? { delivery: "rejected" } : {}),
          },
        } as Outcome;
      }
    });
    intents.set(key, entry);
    return entry.promise;
  };
  return {
    read,
    write,
    dispose() {
      active = false;
      intents.clear();
    },
  };
}
