import { randomUUID } from "../../../deepseek-harness/packages/util/crypto/src/index.ts";
declare global {
  interface Window {
    mygo?: {
      call: (name: string, ...args: unknown[]) => Promise<any>;
      on: (event: string, fn: (data: any) => void) => () => void;
    };
  }
}
let rpcVersion = 1;
export async function context() {
  if (!window.mygo) throw Error("请从 Native DSH 打开此本地兼容页面。");
  const value = await window.mygo.call("CompatAPI.GetContext");
  rpcVersion = value.rpcVersion ?? 1;
  return value;
}
export async function request(
  method: string,
  params: Record<string, unknown> = {},
) {
  if (!window.mygo) throw Error("原生连接不可用。");
  try {
    if (rpcVersion < 2)
      return await window.mygo.call("CompatAPI.Request", method, params);
    const outcome = await window.mygo.call(
      "CompatAPI.RequestV2",
      method,
      params,
    );
    if (!outcome?.ok)
      throw Object.assign(
        new Error(outcome?.error?.message ?? "远程请求未确认。"),
        { code: outcome?.error?.code, delivery: outcome?.error?.delivery },
      );
    return outcome.value;
  } catch (error: any) {
    const literal =
      method === "setCredential" && typeof params.value === "string"
        ? params.value
        : "";
    if (literal)
      throw Object.assign(
        new Error(String(error.message).replaceAll(literal, "[已隐藏]")),
        { code: error.code, delivery: error.delivery },
      );
    throw error;
  }
}
export const operationId = () => randomUUID();
export function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set: (next: T) => {
      value = next;
      for (const fn of listeners) fn();
    },
  };
}

export function onNotification(fn: (event: any) => void) {
  return window.mygo?.on("notification", fn) ?? (() => {});
}
