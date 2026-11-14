import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { TrajectoryView } from "../../../deepseek-harness/packages/client/ui-trajectory/src/client/TrajectoryView.tsx";
import { zh } from "../../../deepseek-harness/packages/client/ui-trajectory/src/client/locales.ts";
import { TrajectoryEngine } from "./trajectory-engine";
import { request, store } from "./bridge";
import { subscribeOwnedStream } from "./owned-stream";
const t = (key: string, params: Record<string, unknown> = {}) =>
  String((zh as any)[key] ?? key).replace(/\{(\w+)\}/g, (_, name) =>
    String(params[name] ?? ""),
  );
function selectorHook(source: any) {
  return function useSnapshot(selector: (state: any) => any) {
    return selector(useSyncExternalStore(source.subscribe, source.getSnapshot));
  };
}
export function TrajectoryPage({ ctx }: { ctx: any }) {
  const engine = useMemo(() => new TrajectoryEngine(), []),
    trajectory = useMemo(() => store<any>(engine.snapshot()), [engine]),
    session = useMemo(
      () =>
        store<any>({
          openState: "loading",
          loadingOlder: false,
          hasMore: false,
        }),
      [],
    ),
    duration = useMemo(() => store(false), []);
  const [error, setError] = useState(""),
    firstSeq = useMemo(() => ({ value: undefined as number | undefined }), []);
  useEffect(() => {
    if (error)
      void window.mygo
        ?.call("CompatAPI.ReportFailure")
        .catch(() => window.mygo?.call("CompatAPI.Close").catch(() => {}));
  }, [error]);
  const clientScope = useMemo(
    () => ({
      hostId: ctx.hostId,
      generation: ctx.connectionGeneration,
      sessionId: ctx.sessionId,
      ownerId: ctx.ownerId,
    }),
    [ctx.hostId, ctx.connectionGeneration, ctx.sessionId, ctx.ownerId],
  );
  useEffect(() => {
    const stream = subscribeOwnedStream(
      ctx,
      "watchSession",
      { sessionId: ctx.sessionId },
      (frame) => {
        if (frame.type === "snapshot") {
          firstSeq.value = frame.records[0]?.event.seq;
          trajectory.set(engine.replace(frame));
          session.set({
            ...session.getSnapshot(),
            openState: "ready",
            hasMore: frame.hasMore,
          });
        } else trajectory.set(engine.append(frame));
      },
      (cause) => {
        setError(cause.message);
        session.set({ ...session.getSnapshot(), openState: "error" });
      },
    );
    return stream.dispose;
  }, [ctx, engine, trajectory, session, firstSeq]);
  const loadOlder = useCallback(async () => {
    if (session.getSnapshot().loadingOlder || !session.getSnapshot().hasMore)
      return false;
    session.set({ ...session.getSnapshot(), loadingOlder: true });
    try {
      const page = await request("sessionPage", {
        sessionId: ctx.sessionId,
        beforeSeq: firstSeq.value,
        maxMessages: 80,
        clientScope,
      });
      firstSeq.value = page.records[0]?.event.seq ?? firstSeq.value;
      trajectory.set(engine.prepend(page.records, page.hasMore));
      session.set({ ...session.getSnapshot(), hasMore: page.hasMore });
      return page.records.length > 0;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      session.set({ ...session.getSnapshot(), loadingOlder: false });
    }
  }, [ctx.sessionId, clientScope, engine, trajectory, session, firstSeq]);
  const watchToolResult = useCallback(
    (seq: number, publish: (value: any) => void) =>
      subscribeOwnedStream(
        ctx,
        "watchToolResult",
        { request: { sessionId: ctx.sessionId, seq } },
        (value) => publish(value.available ? value.value : undefined),
        () => publish(undefined),
      ).dispose,
    [ctx],
  );
  const loadImage = useCallback(
    async (attachment: any) => {
      const value = await request("readAttachment", {
        sessionId: ctx.sessionId,
        attachment,
        clientScope,
      });
      return `data:${attachment.mediaType};base64,${value.data}`;
    },
    [ctx.sessionId, clientScope],
  );
  if (error)
    return (
      <p role="alert" className="notice">
        {error}
      </p>
    );
  return (
    <TrajectoryView
      {...({
        useSession: selectorHook(session),
        useTrajectory: selectorHook(trajectory),
        useDuration: selectorHook(duration),
        setActualDuration: (value: boolean) => duration.set(value),
        loadOlder,
        loadImage,
        watchToolResult,
        viewRequest: null,
        completeViewRequest: () => {},
        renderSlot: () => null,
        t,
      } as any)}
    />
  );
}
