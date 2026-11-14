/** The native compatibility page composes the original terminal UI. */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import type { TerminalView } from "../../../deepseek-harness/packages/api/terminal-controller/src/client/model.ts";
import type { WebTerminalInfo } from "../../../deepseek-harness/packages/api/terminal-controller/src/types.ts";
import { LazyTerminalBody } from "../../../deepseek-harness/packages/client/ui-sidebar-terminal/src/client/LazyTerminalBody.tsx";
import { TerminalGuide } from "../../../deepseek-harness/packages/client/ui-sidebar-terminal/src/client/TerminalGuide.tsx";
import { TerminalTitle } from "../../../deepseek-harness/packages/client/ui-sidebar-terminal/src/client/TerminalTitle.tsx";
import {
  preferredShell,
  rememberShell,
} from "../../../deepseek-harness/packages/api/terminal-controller/src/client/shell-preference.ts";
import { zh } from "../../../deepseek-harness/packages/client/ui-sidebar-terminal/src/client/locales.ts";
import { createTerminalRuntime } from "./terminal-runtime";
import { operationId } from "./bridge";
const t = (key: string, params: Record<string, unknown> = {}) =>
  String((zh as any)[key] ?? key).replace(/\{(\w+)\}/g, (_, name) =>
    String(params[name] ?? ""),
  );
const failure = (message: string) => new Error(message);
function terminalStateHook(view: (id: string) => TerminalView) {
  return function useTerminal(
    id: string,
    select: (value: any) => any = (value: any) => value,
  ) {
    const model = view(id);
    return select(
      useSyncExternalStore(model.state.subscribe, model.state.getSnapshot),
    );
  };
}

/** The chrome only selects a terminal; the original DSH body owns rendering. */
export function TerminalPage({ ctx }: { ctx: any }) {
  const [visible, setVisible] = useState(
    () => document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  const [error, setError] = useState(""),
    [items, setItems] = useState<WebTerminalInfo[]>([]),
    [active, setActive] = useState<string>(),
    [busy, setBusy] = useState(false);
  const runtime = useMemo(() => {
    try {
      return createTerminalRuntime({
        hostId: ctx.hostId,
        sessionId: ctx.sessionId,
        connectionGeneration: ctx.connectionGeneration,
        ownerId: ctx.ownerId,
      });
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [ctx.hostId, ctx.sessionId, ctx.connectionGeneration, ctx.ownerId]);
  const refresh = useCallback(async () => {
    if ("error" in runtime || !ctx.operations?.listTerminals) return;
    setBusy(true);
    setError("");
    try {
      setItems(await runtime.list());
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [runtime, ctx.operations?.listTerminals]);
  useEffect(() => {
    void refresh();
    return () => {
      if (!("error" in runtime)) void runtime.dispose();
    };
  }, [refresh, runtime]);
  const launch = useCallback(
    (_: string, options?: any) => {
      if ("error" in runtime) return;
      const id = operationId();
      runtime.getView(id, true, options?.params?.shellPath);
      setActive(id);
    },
    [runtime],
  );
  const useTabInfo = useCallback(
    () => ({
      tab: {
        id: active ?? "terminal-guide",
        title: "终端",
        visible,
        actions: { openTab: launch },
      },
    }),
    [active, launch, visible],
  );
  const view = useCallback(
    (id: string) => {
      if ("error" in runtime) throw failure(runtime.error);
      return runtime.getView(id);
    },
    [runtime],
  );
  const useTerminal = useMemo(() => terminalStateHook(view), [view]);
  const theme = useMemo(
    () => ({
      preference: ctx.theme ?? "system",
      fontSizes: {
        text: ctx.fontSize ?? 14,
        code: ctx.codeFontSize ?? 11,
        terminal: ctx.terminalFontSize ?? 13,
      },
      fontFamilies: {
        text: ctx.textFontFamily ?? "",
        code: ctx.codeFontFamily ?? "",
        terminal: ctx.terminalFontFamily ?? "",
      },
      active: {
        id: ctx.theme ?? "system",
        colorScheme: ctx.theme === "dark" ? "dark" : "light",
        tokens: {},
      },
      themes: [],
      revision: 0,
    }),
    [ctx],
  );
  const useTheme = useCallback(
    (select: (value: any) => any = (value: any) => value) => select(theme),
    [theme],
  );
  if ("error" in runtime)
    return (
      <p role="alert" className="notice">
        {runtime.error}
      </p>
    );
  if (!ctx.operations?.listTerminals || !ctx.operations?.watchTerminal)
    return (
      <p role="status" className="notice">
        当前主机未开放远程终端。
      </p>
    );
  const canCreate = ctx.operations?.createTerminal === true;
  const props: any = { useTabInfo, useTerminal, useTheme, view, t };
  return (
    <section
      style={{
        display: "flex",
        flex: 1,
        minHeight: 0,
        flexDirection: "column",
      }}
      aria-label="终端"
    >
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {active ? (
        <>
          <header
            data-dockkit-tab
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              flex: "none",
              minWidth: 0,
              borderBottom: "0.5px solid var(--dsw-alias-border-l2)",
            }}
          >
            <TerminalTitle {...props} />
            <span style={{ flex: 1 }} />
            <Button variant="ghost" onClick={() => setActive(undefined)}>
              终端列表
            </Button>
            <Button
              variant="ghost"
              disabled={!ctx.operations?.closeTerminal}
              onClick={() => {
                void view(active)
                  .close()
                  .then(
                    () => {
                      setActive(undefined);
                      void refresh();
                    },
                    (error) => setError(error.message),
                  );
              }}
            >
              关闭终端
            </Button>
          </header>
          {visible && <LazyTerminalBody {...props} />}
        </>
      ) : (
        <div
          style={{
            padding: 24,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            overflow: "auto",
            minHeight: 0,
          }}
        >
          {canCreate ? (
            <TerminalGuide
              {...({
                title: "新建终端",
                description: zh.description,
                kind: "terminal",
                useTabInfo,
                t,
                useShortcuts: (select: any) => select([]),
                loadShells: async () => {
                  const result = await runtime.remote.shells();
                  if (!result.ok) throw result.error;
                  return {
                    shells: result.value,
                    selectedShell: preferredShell() ?? undefined,
                  };
                },
                selectShell: rememberShell,
              } as any)}
            />
          ) : null}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void refresh()}
          >
            刷新终端列表
          </Button>
          {items.map((info) => (
            <Button
              key={info.id}
              variant="ghost"
              onClick={() => {
                runtime.getView(info.id, false);
                setActive(info.id);
              }}
            >
              {info.title} · {info.state === "running" ? "运行中" : "已退出"}
            </Button>
          ))}
          {!busy && items.length === 0 && (
            <p role="status">此设备没有可恢复的终端。</p>
          )}
        </div>
      )}
    </section>
  );
}
