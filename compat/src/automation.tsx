import { useMemo, useEffect, useState } from "react";
import { TaskManagerPage } from "../../../deepseek-harness/packages/client/ui-schedule/src/client/TaskManagerPage.tsx";
import { createCatalogSource } from "../../../deepseek-harness/packages/client/ui-schedule/src/client/catalog-source.ts";
import { createEditorStore } from "../../../deepseek-harness/packages/client/ui-schedule/src/client/editor-store.ts";
import { createClearEnded } from "../../../deepseek-harness/packages/client/ui-schedule/src/client/clear-ended.ts";
import {
  createDeleteToastSource,
  ScheduleDeleteToast,
} from "../../../deepseek-harness/packages/client/ui-schedule/src/client/DeleteToast.tsx";
import { zh } from "../../../deepseek-harness/packages/client/ui-schedule/src/client/task-manager-locales.ts";
import { sessionLinkState } from "../../../deepseek-harness/packages/client/ui-schedule/src/client/session-link.ts";
import { Toast } from "../../../deepseek-harness/packages/client/ui-primitives/src/Toast.tsx";
import { onNotification, store } from "./bridge";
import { hook, translate } from "./presentation";
import { createPageRpc } from "./rpc-adapter";
import { createPageLifetime } from "./page-lifetime";

function sessionState(rows: any[] | undefined) {
  return {
    phase: rows === undefined ? "pending" : "ready",
    ids: (rows ?? []).map((row) => row.id),
    byId: Object.fromEntries(
      (rows ?? []).map((row) => [
        row.id,
        { ...row, displayTitle: row.displayTitle ?? row.title ?? row.id },
      ]),
    ),
  };
}
function workspaceState(rows: any[] | undefined) {
  const items = (rows ?? []).map((row) => ({
    ...row,
    workspaceId: row.workspaceId ?? row.id,
  }));
  return {
    phase: rows === undefined ? "pending" : "ready",
    state: rows === undefined ? "pending" : "ready",
    items,
    archivedSessionIds: items.flatMap((row) => row.archivedSessionIds ?? []),
  };
}
export function createAutomation(
  ctx: any,
  call?: any,
  subscribe = onNotification,
) {
  const lifetime = createPageLifetime();
  const rpc = createPageRpc(ctx, call);
  lifetime.own(() => rpc.dispose());
  const subscribeInvalidation = (listener: () => void) =>
    subscribe((event: any) => {
      if (
        event.method === "remoteInvalidation" &&
        event.params.event === "schedule/changed" &&
        event.params.hostId === ctx.hostId &&
        event.params.connectionGeneration === ctx.connectionGeneration
      )
        listener();
    });
  const catalog = createCatalogSource<any>({
    list: () => rpc.read("scheduleCatalog"),
    remove: async (id: any) => {
      const result = await rpc.write("editSchedule", {
        request: { id, action: "delete" },
      });
      if (!result.ok) return result;
      return {
        ok: true,
        value:
          "deleted" in result.value
            ? { id, deleted: true }
            : { id, deleted: false, code: "schedule_not_found" },
      };
    },
    subscribeChanged: subscribeInvalidation,
    subscribeReset: () => () => {},
  });
  lifetime.guardStore(catalog.hooks.catalog);
  const refresh = () =>
    lifetime.active
      ? catalog.onRetry(catalog.hooks.catalog.getSnapshot().readRequest)
      : Promise.resolve();
  const toast = createDeleteToastSource();
  const clear = createClearEnded({
    removeInactive: () => rpc.write("deleteInactiveSchedules"),
    refresh,
  });
  const sessions = store(sessionState(ctx.sessions));
  const workspaces = store(workspaceState(ctx.workspaces));
  const editor = createEditorStore().create();
  lifetime.guardStore(sessions);
  lifetime.guardStore(workspaces);
  lifetime.guardStore(editor.store);
  const hostActions = {
    edit: async (request: any) => {
      const result = await rpc.write("editSchedule", { request });
      if (!result.ok) return { failed: "host.saveError" };
      await refresh();
      if (!("code" in result.value)) return "saved";
      return {
        failed:
          result.value.code === "schedule_conflict"
            ? "host.conflict"
            : "detail.missing",
      };
    },
    run: async (id: string) => {
      const result = await rpc.write("runSchedule", { id });
      if (!result.ok) return { failed: "host.runError" };
      await refresh();
      if (!("code" in result.value)) return "queued";
      return {
        failed:
          result.value.code === "schedule_execution_pending"
            ? "host.executionPending"
            : "detail.missing",
      };
    },
    loadNewSessionInterval: async () => {
      const result = await rpc.read("scheduleDeliveryLimits");
      return result.ok ? result.value.newSessionIntervalSeconds : undefined;
    },
  };
  return {
    catalog,
    toast,
    sessions,
    workspaces,
    editor,
    hostActions,
    onDelete: async (id: any) => {
      const outcome = await catalog.onDelete(id);
      if (lifetime.active) toast.report(outcome);
      return outcome;
    },
    onClearEnded: async () => {
      const outcome = await clear();
      if (lifetime.active) toast.reportClear(outcome);
    },
    loadHistory: (request: any) => rpc.read("scheduleHistory", request),
    acceptCatalog: (event: any) => {
      if (event.method === "sessions") sessions.set(sessionState(event.params));
      if (event.method === "workspaces")
        workspaces.set(workspaceState(event.params));
    },
    dispose: () => lifetime.dispose(),
  };
}

export default function AutomationPage({ ctx }: { ctx: any }) {
  const face = useMemo(() => createAutomation(ctx), [ctx]);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const off = onNotification(face.acceptCatalog);
    return () => {
      off();
      face.dispose();
    };
  }, [face]);
  const navigate = (method: string, ...params: any[]) => {
    void window.mygo
      ?.call(method, ...params)
      .catch((error: any) => setNotice(error.message));
  };
  const props: any = {
    useCatalog: hook(face.catalog.hooks.catalog),
    useStore: hook(face.editor),
    actions: face.editor.actions,
    useSessions: hook(face.sessions),
    useWorkspaces: hook(face.workspaces),
    onRetry: face.catalog.onRetry,
    onDelete: face.onDelete,
    onClearEnded: face.onClearEnded,
    loadHistory: face.loadHistory,
    hostActions: face.hostActions,
    onOpenSession: (id: string) => {
      if (
        sessionLinkState(
          id as any,
          face.sessions.getSnapshot() as any,
          face.workspaces.getSnapshot() as any,
        ) === "available" &&
        ctx.operations?.clientOpenSession
      )
        navigate("CompatAPI.OpenSession", id);
    },
    onNewTask: () => {
      if (ctx.operations?.clientStartDraft)
        navigate("CompatAPI.StartDraft", zh["host.createPrompt"]);
    },
    onCreateTask: async () => ({ failed: "host.createError" }),
    nativeManualCreateAvailable: false,
    nativeStartDraftAvailable: !!ctx.operations?.clientStartDraft,
    t: translate(zh),
  };
  return (
    <>
      <TaskManagerPage {...props} />
      <ScheduleDeleteToast
        useToast={hook(face.toast.hooks.toast)}
        dismiss={face.toast.dismiss}
        t={translate(zh) as any}
      />
      {notice ? <Toast text={notice} onDone={() => setNotice("")} /> : null}
    </>
  );
}
