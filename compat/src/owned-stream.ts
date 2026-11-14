import { request, onNotification } from "./bridge";
/** Handles the reply/first-frame race and releases listeners even if opening fails. Go owns final WK teardown. */
export function subscribeOwnedStream(
  ctx: any,
  method: string,
  params: any,
  frame: (value: any) => void,
  error: (cause: Error) => void,
  transport = { call: request, subscribe: onNotification },
) {
  const clientScope = {
    hostId: ctx.hostId,
    generation: ctx.connectionGeneration,
    sessionId: ctx.sessionId,
    ownerId: ctx.ownerId,
  };
  let stopped = false,
    id: string | undefined,
    early: any[] = [],
    bytes = 0,
    off = () => {};
  const close = () => {
    if (id)
      void transport
        .call("closeStream", { subscriptionId: id, clientScope })
        .catch(() => {});
  };
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    off();
    early = [];
    bytes = 0;
    close();
  };
  const fail = (cause: Error) => {
    if (stopped) return;
    try {
      error(cause instanceof Error ? cause : Error(String(cause)));
    } finally {
      dispose();
    }
  };
  const receive = (event: any) => {
    const p = event.params;
    if (
      stopped ||
      p?.ownerId !== ctx.ownerId ||
      p.method !== method ||
      !["remoteStream", "remoteStreamEnd"].includes(event.method)
    )
      return;
    if (!id) {
      bytes += new TextEncoder().encode(JSON.stringify(event)).length;
      if (early.length >= 256 || bytes > 16 * 1024 * 1024) {
        fail(Error("订阅开头超过缓冲上限，请重新打开。"));
        return;
      }
      early.push(event);
      return;
    }
    if (p.subscriptionId !== id) return;
    if (event.method === "remoteStreamEnd") {
      fail(Error(p.error?.code ?? "订阅已结束，请重新打开。"));
      return;
    }
    try {
      frame(p.frame);
    } catch (cause) {
      fail(cause instanceof Error ? cause : Error("无法显示远程记录。"));
    }
  };
  off = transport.subscribe(receive);
  if (stopped) off();
  const ready = Promise.resolve()
    .then(() => transport.call(method, { ...params, clientScope }))
    .then((value) => {
      id = value?.subscriptionId;
      if (!id) throw Error("订阅回执无效。");
      if (stopped) {
        close();
        return;
      }
      const pending = early;
      early = [];
      bytes = 0;
      for (const event of pending) receive(event);
    }, fail)
    .catch(fail);
  return { dispose, ready };
}
