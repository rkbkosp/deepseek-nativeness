/** Carrier adapter for the frozen DSH terminal model; no DOM or Host runtime. */
import { TerminalView } from "../../../deepseek-harness/packages/api/terminal-controller/src/client/model.ts";
import { TerminalInventory } from "../../../deepseek-harness/packages/api/terminal-controller/src/client/inventory.ts";
import { TerminalWindowHold } from "../../../deepseek-harness/packages/api/terminal-controller/src/client/retention.ts";
import { RemoteStream } from "../../../deepseek-harness/packages/api/gateway/src/client/remote-stream.ts";
import type { TerminalInput } from "../../../deepseek-harness/packages/api/terminal-controller/src/types.ts";
import { request, operationId, onNotification, store } from "./bridge";
const failure = (message: string, code = "TERMINAL_FAILED") =>
  Object.assign(new Error(message), { code });

/** Same bounded screen queue as the frozen Remote terminal compatibility seam. */
export class TerminalFrameQueue<T> implements AsyncIterable<T> {
  private values: Array<{ value: T; bytes: number }> = [];
  private bytes = 0;
  private ended = false;
  private error: unknown;
  private wake?: () => void;
  push(value: T) {
    if (this.ended) return false;
    const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
    if (this.values.length >= 256 || this.bytes + bytes > 4 * 1024 * 1024) {
      this.close(
        failure("终端画面缓冲区已满，请重新连接。", "OUTPUT_OVERFLOW"),
      );
      return false;
    }
    this.values.push({ value, bytes });
    this.bytes += bytes;
    this.wake?.();
    return true;
  }
  close(error?: unknown) {
    if (this.ended) return;
    this.ended = true;
    this.error = error;
    this.wake?.();
  }
  async *[Symbol.asyncIterator]() {
    while (true) {
      const next = this.values.shift();
      if (next) {
        this.bytes -= next.bytes;
        yield next.value;
      } else if (this.ended) break;
      else
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
    }
    if (this.error) throw this.error;
  }
}

/** Accepted input is acknowledged only after the Host carrier's own ack. */
export function terminalMutationValue(
  receipt: any,
  id: string,
  inputSequence?: number,
) {
  if (
    receipt?.status !== "accepted" ||
    receipt?.requestId !== id ||
    (inputSequence !== undefined && receipt?.inputSequence !== inputSequence)
  )
    throw failure(
      "终端操作结果未确认；输入不会重放，请核对后重新连接。",
      "UNKNOWN_RECEIPT",
    );
  return receipt.value;
}

export function createTerminalRuntime(
  ctx: any,
  call: typeof request = request,
  subscribe: typeof onNotification = onNotification,
) {
  const sessionId = String(ctx.sessionId ?? ""),
    hostId = String(ctx.hostId ?? ""),
    connectionGeneration = ctx.connectionGeneration,
    ownerId = String(ctx.ownerId ?? "");
  if (
    !sessionId ||
    !hostId ||
    !ownerId ||
    !Number.isSafeInteger(connectionGeneration)
  )
    throw failure("终端连接上下文已失效，请重新打开页面。", "STALE_CONTEXT");
  const clientScope = Object.freeze({
    hostId,
    generation: connectionGeneration,
    sessionId,
    ownerId,
  });
  const generation = store<number | undefined>(connectionGeneration);
  const views = new Map<string, TerminalView>(),
    holds = new Map<string, TerminalWindowHold>(),
    handles = new Set<{ dispose(): void }>();
  const mutationIds = new Map<string, string>();
  let disposed = false;
  const invoke = async (
    method: string,
    params: Record<string, unknown> = {},
  ) => {
    if (disposed) throw failure("终端页面已关闭。", "CLOSED");
    return call(method, { ...params, sessionId, clientScope, ownerId });
  };
  const mutate = async (
    method: string,
    params: Record<string, unknown>,
    key?: string,
  ) => {
    const id = key ? (mutationIds.get(key) ?? operationId()) : operationId();
    if (key) mutationIds.set(key, id);
    return terminalMutationValue(
      await invoke(method, { ...params, requestId: id }),
      id,
    );
  };
  const result = async (fn: () => Promise<any>) => {
    try {
      return { ok: true as const, value: await fn() };
    } catch (error) {
      return { ok: false as const, error };
    }
  };
  const open = (
    method: "watchTerminal" | "retainTerminal",
    terminalId: string,
    signal: AbortSignal,
  ) => {
    const queue = new TerminalFrameQueue<any>();
    const attachmentId = operationId();
    let subscriptionId: string | undefined,
      closed = false,
      opening = true;
    let early: any[] = [];
    let earlyBytes = 0;
    let writes = Promise.resolve();
    let off = () => {};
    let abort = () => {};
    const handle = {
      dispose() {
        if (closed) return;
        closed = true;
        queue.close();
        off();
        signal.removeEventListener("abort", abort);
        handles.delete(handle);
        if (subscriptionId)
          void call("closeStream", {
            subscriptionId,
            clientScope,
            ownerId,
          }).catch(() => {});
      },
      end() {
        handle.dispose();
      },
      send(input: TerminalInput) {
        if (closed || signal.aborted)
          throw failure("终端连接已结束；输入不会重放。", "CLOSED");
        const id = operationId();
        writes = writes
          .then(async () => {
            if (closed || signal.aborted) return;
            const method =
              input.type === "write" ? "writeTerminal" : "resizeTerminal";
            const args =
              input.type === "write"
                ? { data: input.data }
                : { cols: input.cols, rows: input.rows };
            terminalMutationValue(
              await invoke(method, {
                terminalId,
                attachmentId,
                ...args,
                inputSequence: input.sequence,
                requestId: id,
              }),
              id,
              input.sequence,
            );
            if (
              !closed &&
              !signal.aborted &&
              !queue.push({ type: "ack", sequence: input.sequence })
            )
              handle.dispose();
          })
          .catch((error) => {
            queue.close(error);
            handle.dispose();
          });
      },
      async *[Symbol.asyncIterator]() {
        try {
          yield* queue;
        } finally {
          handle.dispose();
        }
      },
    };
    const receive = (event: any) => {
      const p = event?.params ?? event;
      if (
        event?.method === "status" &&
        (p.hostId !== hostId ||
          p.connectionGeneration !== connectionGeneration ||
          p.connected === false)
      ) {
        generation.set(undefined);
        queue.close(
          failure("远程连接已改变，请重新打开终端页面。", "STALE_CONTEXT"),
        );
        handle.dispose();
        return;
      }
      if (
        !["remoteStream", "remoteStreamEnd"].includes(event?.method) ||
        p.method !== method ||
        p.sessionId !== sessionId
      )
        return;
      if (!subscriptionId) {
        if (opening) {
          earlyBytes += new TextEncoder().encode(JSON.stringify(event)).length;
          if (early.length >= 256 || earlyBytes > 4 * 1024 * 1024) {
            queue.close(failure("终端打开期间收到过多帧。", "OUTPUT_OVERFLOW"));
            handle.dispose();
          } else early.push(event);
        }
        return;
      }
      if (p.subscriptionId !== subscriptionId) return;
      if (event.method === "remoteStreamEnd") {
        queue.close(
          p.error
            ? failure(p.error.message ?? "终端画面通道已结束。", p.error.code)
            : undefined,
        );
        handle.dispose();
      } else if (!queue.push(p.frame)) handle.dispose();
    };
    abort = () => handle.dispose();
    off = subscribe(receive);
    handles.add(handle);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      handle.dispose();
      return handle;
    }
    void invoke(method, {
      terminalId,
      ...(method === "watchTerminal" ? { attachmentId } : {}),
    }).then(
      (value) => {
        opening = false;
        subscriptionId = value?.subscriptionId;
        if (!subscriptionId) {
          queue.close(failure("终端订阅响应无效。", "INVALID_STREAM"));
          handle.dispose();
          return;
        }
        if (closed) {
          void call("closeStream", {
            subscriptionId,
            clientScope,
            ownerId,
          }).catch(() => {});
          return;
        }
        for (const event of early) receive(event);
        early = [];
      },
      (error) => {
        opening = false;
        queue.close(error);
        handle.dispose();
      },
    );
    return handle;
  };
  const remote: any = {
    environment: () => result(() => invoke("terminalEnvironment")),
    shells: () => result(() => invoke("terminalShells")),
    create: (_session: string, terminal: any) =>
      result(() =>
        mutate("createTerminal", { terminal }, "create:" + terminal.id),
      ),
    rename: (_session: string, terminalId: string, title: string) =>
      result(() =>
        mutate(
          "renameTerminal",
          { terminalId, title },
          "rename:" + terminalId + ":" + title,
        ),
      ),
    close: (_session: string, terminalId: string) =>
      result(async () => {
        const value = await mutate(
          "closeTerminal",
          { terminalId },
          "close:" + terminalId,
        );
        void holds.get(terminalId)?.dispose();
        holds.delete(terminalId);
        return value;
      }),
    attach: (_session: string, id: string, signal: AbortSignal) =>
      open("watchTerminal", id, signal),
    retain: (_session: string, id: string, signal: AbortSignal) =>
      open("retainTerminal", id, signal),
  };
  const gateway: any = {
    $stream: (options: any) => new RemoteStream({ generation } as any, options),
  };
  const inventory = new TerminalInventory(
    () => result(() => invoke("listTerminals")) as any,
  );
  const getView = (id: string, create = false, shellPath?: string) => {
    let model = views.get(id);
    if (model) return model;
    model = new TerminalView(
      sessionId as any,
      remote,
      gateway,
      inventory,
      id as any,
      create,
      shellPath,
      async (signal) => {
        let hold = holds.get(id);
        if (!hold || hold.failed) {
          void hold?.dispose();
          hold = new TerminalWindowHold(
            gateway,
            remote,
            sessionId as any,
            id as any,
          );
          holds.set(id, hold);
        }
        await hold.ready(signal);
      },
    );
    views.set(id, model);
    return model;
  };
  return {
    inventory,
    remote,
    gateway,
    getView,
    async list(refresh = true) {
      return [...(await inventory.read(refresh)).values()];
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const handle of [...handles]) handle.dispose();
      await Promise.allSettled(
        [...views.values()].map((view) => view.dispose()),
      );
      await Promise.allSettled(
        [...holds.values()].map((hold) => hold.dispose()),
      );
      await inventory.dispose();
      views.clear();
      holds.clear();
    },
  };
}
