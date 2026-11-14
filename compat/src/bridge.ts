import { randomUUID } from "../../../deepseek-harness/packages/util/crypto/src/index.ts";
declare global {
  interface Window {
    mygo?: {
      call: (name: string, ...args: unknown[]) => Promise<any>;
      on: (event: string, fn: (data: any) => void) => () => void;
    };
  }
}
export async function context() {
  if (!window.mygo) throw Error("请从 Native DSH 打开此本地兼容页面。");
  return window.mygo.call("CompatAPI.GetContext");
}
export async function request(
  method: string,
  params: Record<string, unknown> = {},
) {
  if (!window.mygo) throw Error("原生连接不可用。");
  return window.mygo.call("CompatAPI.Request", method, params);
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
