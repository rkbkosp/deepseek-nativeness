import React,{useEffect,useMemo,useCallback,useState} from "react";
import {ModelSelect} from "../../../deepseek-harness/packages/client/ui-model-selection/src/client/ModelSelect.tsx";
import {zh as modelZh} from "../../../deepseek-harness/packages/client/ui-model-selection/src/client/locales.ts";
import {TeamModeToggle,TeamModePane} from "../../../deepseek-harness/packages/client/ui-agent-team/src/client/TeamModeToggle.tsx";
import {zh as teamZh} from "../../../deepseek-harness/packages/client/ui-agent-team/src/client/locales.ts";
import {modelDirectoryState} from "./model-state.mjs";
import {request,store,operationId,onNotification} from "./bridge";
import {translate,resolveText,no} from "./presentation";
export default function Models({ ctx }: { ctx: any }) {
  useEffect(() => {
    if (new URLSearchParams(location.search).get("page") !== "model-menu")
      return;
    document.body.dataset.nativeModelMenu = "";
    let pending = 0;
    const measure = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        const menu = document.querySelector<HTMLElement>("[data-model-menu]");
        if (!menu) return;
        const rect = menu.getBoundingClientRect();
        void window.mygo
          ?.call(
            "CompatAPI.ResizeModelMenu",
            Math.ceil(rect.width),
            Math.ceil(rect.height),
          )
          .catch(() => {});
      });
    };
    const observer = new ResizeObserver(measure),
      root = document.body;
    const watch = new MutationObserver(() => {
      const menu = root.querySelector("[data-model-menu]");
      if (menu) observer.observe(menu);
      measure();
    });
    watch.observe(root, { childList: true, subtree: true });
    measure();
    return () => {
      observer.disconnect();
      watch.disconnect();
      cancelAnimationFrame(pending);
    };
  }, []);
  const [projected, setProjected] = useState<any>({});
  const catalogSnapshot = useMemo(() => ({ value: null as any }), []);
  const directory = useMemo(
    () =>
      store<any>({
        current: null,
        routable: null,
        groups: [],
        failures: [],
        status: "idle",
        pending: null,
        error: null,
      }),
    [],
  );
  const load = useCallback(async () => {
    directory.set({
      ...directory.getSnapshot(),
      status: "loading",
      error: null,
    });
    try {
      const [catalog, projection] = await Promise.all([
        request("modelCatalog"),
        ctx.sessionId
          ? request("sessionProjections", { sessionId: ctx.sessionId })
          : Promise.resolve(null),
      ]);
      catalogSnapshot.value = catalog;
      setProjected(projection?.values ?? {});
      directory.set(modelDirectoryState(catalog, projection));
    } catch (e: any) {
      directory.set({
        ...directory.getSnapshot(),
        status: "error",
        error: e.message,
      });
    }
  }, [ctx.sessionId, directory, catalogSnapshot]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(
    () =>
      onNotification((event) => {
        if (
          event.method !== "sessionProjections" ||
          event.params.sessionId !== ctx.sessionId
        )
          return;
        setProjected(event.params.projections?.values ?? {});
        if (catalogSnapshot.value) {
          const previous = directory.getSnapshot();
          directory.set({
            ...modelDirectoryState(
              catalogSnapshot.value,
              event.params.projections,
            ),
            ...(previous.status === "selecting"
              ? { status: "selecting", pending: previous.pending }
              : {}),
          });
        }
      }),
    [ctx.sessionId, directory, catalogSnapshot],
  );
  const select = async (selection: any) => {
    directory.set({
      ...directory.getSnapshot(),
      status: "selecting",
      pending: selection,
    });
    try {
      const receipt = await request("selectModel", {
        ...selection,
        sessionId: ctx.sessionId,
        requestId: operationId(),
      });
      if (receipt.status !== "accepted")
        throw Error("响应未确认，请先核对远程状态。");
      await load();
      return { ok: true, value: undefined };
    } catch (e: any) {
      directory.set({
        ...directory.getSnapshot(),
        status: "error",
        pending: null,
        error: e.message,
      });
      return {
        ok: false,
        error: { code: e.code ?? "FAILED", message: e.message },
      };
    }
  };
  return (
    <main className="model-page">
      {!ctx.sessionId ? (
        <p>请先选择会话。</p>
      ) : (
        <ModelSelect
          locked={!ctx.operations?.selectModel}
          available={!!ctx.operations?.modelCatalog}
          directory={directory as any}
          load={() => void load()}
          select={select}
          resolveText={resolveText}
          t={translate(modelZh) as any}
          renderSlot={createModelSlot(ctx,projected)}
        />
      )}
    </main>
  );
}

export function createModelSlot(ctx:any,projected:any) {
 return (name:any,props:any,options:any)=>{
            const common = {
              ...props,
              sessionId: ctx.sessionId,
              useProjection: (key: string) => projected[key],
              useSession: (select: any) => select({ subagent: null }),
              useSessions: (select: any) => select({ byId: {} }),
              t: translate(teamZh),
            };
            return name === "conversation.input.model.options" ? (
              <div title="当前Remote未开放团队开关API">
                <TeamModeToggle {...common} />
              </div>
            ) : name === "conversation.input.model.pane" ? (
              <div title="当前Remote未开放agentTeams/setEnabled">
                <TeamModePane
                  {...common}
                  locked={true}
                  selectTeamMode={async () => "Remote未开放此操作"}
                  requestDisableConfirmation={no}
                />
              </div>
            ) : options?.fallback ?? null;
 };
}
