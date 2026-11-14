// desktop/compat/src/bridge.ts
async function request(method, params = {}) {
  if (!window.mygo) throw Error("\u539F\u751F\u8FDE\u63A5\u4E0D\u53EF\u7528\u3002");
  return window.mygo.call("CompatAPI.Request", method, params);
}
function onNotification(fn) {
  return window.mygo?.on("notification", fn) ?? (() => {
  });
}

// desktop/compat/src/owned-stream.ts
function subscribeOwnedStream(ctx, method, params, frame, error, transport = { call: request, subscribe: onNotification }) {
  const clientScope = {
    hostId: ctx.hostId,
    generation: ctx.connectionGeneration,
    sessionId: ctx.sessionId,
    ownerId: ctx.ownerId
  };
  let stopped = false, id, early = [], bytes = 0, off = () => {
  };
  const close = () => {
    if (id)
      void transport.call("closeStream", { subscriptionId: id, clientScope }).catch(() => {
      });
  };
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    off();
    early = [];
    bytes = 0;
    close();
  };
  const fail = (cause) => {
    if (stopped) return;
    try {
      error(cause instanceof Error ? cause : Error(String(cause)));
    } finally {
      dispose();
    }
  };
  const receive = (event) => {
    const p = event.params;
    if (stopped || p?.ownerId !== ctx.ownerId || p.method !== method || !["remoteStream", "remoteStreamEnd"].includes(event.method))
      return;
    if (!id) {
      bytes += new TextEncoder().encode(JSON.stringify(event)).length;
      if (early.length >= 256 || bytes > 16 * 1024 * 1024) {
        fail(Error("\u8BA2\u9605\u5F00\u5934\u8D85\u8FC7\u7F13\u51B2\u4E0A\u9650\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u3002"));
        return;
      }
      early.push(event);
      return;
    }
    if (p.subscriptionId !== id) return;
    if (event.method === "remoteStreamEnd") {
      fail(Error(p.error?.code ?? "\u8BA2\u9605\u5DF2\u7ED3\u675F\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u3002"));
      return;
    }
    try {
      frame(p.frame);
    } catch (cause) {
      fail(cause instanceof Error ? cause : Error("\u65E0\u6CD5\u663E\u793A\u8FDC\u7A0B\u8BB0\u5F55\u3002"));
    }
  };
  off = transport.subscribe(receive);
  if (stopped) off();
  const ready = Promise.resolve().then(() => transport.call(method, { ...params, clientScope })).then((value) => {
    id = value?.subscriptionId;
    if (!id) throw Error("\u8BA2\u9605\u56DE\u6267\u65E0\u6548\u3002");
    if (stopped) {
      close();
      return;
    }
    const pending = early;
    early = [];
    bytes = 0;
    for (const event of pending) receive(event);
  }, fail).catch(fail);
  return { dispose, ready };
}
export {
  subscribeOwnedStream
};
