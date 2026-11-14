import { AgentLoopCard } from "../../../deepseek-harness/packages/client/ui-settings-agent-loop/src/client/AgentLoopCard.tsx";
import {
  AgentLoopCardController,
  AGENT_LOOP_NS,
} from "../../../deepseek-harness/packages/client/ui-settings-agent-loop/src/client/agent-loop-card-controller.ts";
import { zh as loopZh } from "../../../deepseek-harness/packages/client/ui-settings-agent-loop/src/client/locales.ts";
import { SubagentCard } from "../../../deepseek-harness/packages/client/ui-settings-subagent/src/client/SubagentCard.tsx";
import { SubagentLimitsCardController } from "../../../deepseek-harness/packages/client/ui-settings-subagent/src/client/subagent-limits-card-controller.ts";
import {
  SubagentModelSelectionCardController,
  SUBAGENT_MODEL_SELECTION_NS,
} from "../../../deepseek-harness/packages/client/ui-settings-subagent/src/client/subagent-model-selection-card-controller.ts";
import { subagentCardFace } from "../../../deepseek-harness/packages/client/ui-settings-subagent/src/client/subagent-card-controller.ts";
import { zh as subagentZh } from "../../../deepseek-harness/packages/client/ui-settings-subagent/src/client/locales.ts";
import { WebSearchCard } from "../../../deepseek-harness/packages/client/ui-settings-web-search/src/client/WebSearchCard.tsx";
import {
  WebSearchCardController,
  WEB_NS,
  WEB_API_NS,
  WEB_SEARCH_NS,
} from "../../../deepseek-harness/packages/client/ui-settings-web-search/src/client/web-search-card-controller.ts";
import { zh as webZh } from "../../../deepseek-harness/packages/client/ui-settings-web-search/src/client/locales.ts";
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { PluginManagerPage } from "../../../deepseek-harness/packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx";
import {
  packageView,
  sortPackages,
} from "../../../deepseek-harness/packages/client/ui-plugin-manager/src/client/manager-store.ts";
import { createPluginHeaderRef } from "../../../deepseek-harness/packages/client/ui-plugin-manager/src/client/header-scroll.ts";
import { zh as pluginZh } from "../../../deepseek-harness/packages/client/ui-plugin-manager/src/client/locales.ts";
import { ShellCard } from "../../../deepseek-harness/packages/client/ui-settings-shell/src/client/ShellCard.tsx";
import {
  ShellCardController,
  BASH_NS,
  PWSH_NS,
} from "../../../deepseek-harness/packages/client/ui-settings-shell/src/client/shell-card-controller.ts";
import { zh as shellZh } from "../../../deepseek-harness/packages/client/ui-settings-shell/src/client/locales.ts";
import { request, store, operationId } from "./bridge";
import { translate, resolveText, hook } from "./presentation";
function webSearchHook(source: any) {
  return function useWebSearchCard(selector: (s: any) => any) {
    const state = useSyncExternalStore(source.subscribe, source.getSnapshot);
    return selector({ ...state, selectionBlocked: true });
  };
}

const no = () => {};
const idlestate = {
  open: false,
  spec: "",
  registries: null,
  registry: { kind: "offered", registry: null },
  registryOpen: false,
  registryError: false,
  attempts: null,
  phase: "idle",
  inputError: null,
  subject: null,
  runs: [],
  detailsOpen: false,
  logPath: null,
  installed: null,
  installedVersion: null,
  restartRequired: false,
  failure: null,
  approvedBuilds: [],
  enabling: false,
};
export default function Plugins({ ctx }: { ctx: any }) {
  const [notice, setNotice] = useState("");
  const manager = useMemo(
    () =>
      store<any>({
        status: "idle",
        refreshStatus: "idle",
        packages: [],
        busy: [],
        notice: null,
        install: idlestate,
        confirm: null,
        highlight: null,
        versions: {},
        update: null,
      }),
    [],
  );
  const navigation = useMemo(
    () => store<any>({ view: { kind: "list" }, tab: "installed" }),
    [],
  );
  const details = useMemo(() => store<any>({}), []);
  const configurations = useMemo(() => store<any>({ view: undefined }), []);
  const forms = useMemo(() => new Map<string, any>(), []);
  const ledger = useMemo(
    () => store<any>({ items: [], bundles: new Set(), rows: new Set() }),
    [],
  );
  const tabs = useMemo(() => store<any[]>([]), []),
    locale = useMemo(
      () => store({ active: ctx.language ?? "zh" }),
      [ctx.language],
    );
  const controllers = useMemo(() => new Map<string, any>(), []);
  const unsupported = () =>
    setNotice(
      "当前 Remote 0.6.4 未开放插件安装/卸载及任意第三方配置页面；此入口不可用。",
    );
  const remoteResult = async (method: string, params: any = {}) => {
    try {
      const value = await request(method, params);
      if (value?.status === "unknown")
        return {
          ok: false,
          error: {
            code: "RECEIPT_UNKNOWN",
            message: "响应未确认，请刷新核对。",
          },
        };
      return {
        ok: true,
        value: value?.status === "accepted" ? value.value : value,
      };
    } catch (e: any) {
      return {
        ok: false,
        error: { code: e.code ?? "FAILED", message: e.message },
      };
    }
  };
  const remoteContext: any = {
    remote: {
      session: { modelCatalog: () => remoteResult("modelCatalog") },
      credentials: {
        describe: (refs: string[]) =>
          remoteResult("describeCredentials", { refs }),
        set: (ref: string, value: string) =>
          remoteResult("setCredential", {
            ref,
            value,
            requestId: operationId(),
          }),
      },
      web: {
        listProviders: async () => ({
          ok: false,
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "当前Remote未开放web/listProviders",
          },
        }),
      },
    },
    locale: { resolveText },
  };
  const configForm = (ns: string) => {
    if (!forms.has(ns)) {
      const source = store<any>({
        status: "loading",
        writable: false,
        value: undefined,
        user: undefined,
        base: undefined,
        revision: undefined,
      });
      let tail = Promise.resolve();
      const scope = {
        ...source,
        mutate: (ops: any, expectedRevision?: number) => {
          const execute = async () => {
            const snapshot = source.getSnapshot();
            if (!snapshot.writable) return false;
            try {
              const result = await request("mutateSettings", {
                ns,
                ops,
                expectedRevision: expectedRevision ?? snapshot.revision,
                requestId: operationId(),
              });
              if (result.status !== "accepted") {
                setNotice("保存响应未确认，请刷新后核对；不会自动重发。");
                return false;
              }
              await loadSettings();
              return true;
            } catch (e: any) {
              setNotice(e.message);
              await loadSettings();
              return false;
            }
          };
          const next = tail.then(execute);
          tail = next.then(
            () => {},
            () => {},
          );
          return next;
        },
      };
      forms.set(ns, scope);
    }
    return forms.get(ns);
  };
  const loadSettings = async () => {
    const view = await request("describeSettings");
    configurations.set({ view });
    for (const ns of view.namespaces) {
      const scope = configForm(ns.ns);
      scope.set({
        status: "ready",
        value: ns.value,
        base: ns.base,
        user: ns.user,
        revision: ns.revision,
        writable:
          view.writable &&
          !!ctx.operations?.mutateSettings &&
          !["ds-harness-remote", "dsh-remote"].includes(ns.ns),
      });
    }
    const served = new Set(view.namespaces.map((n: any) => n.ns));
    for (const [ns, scope] of forms)
      if (!served.has(ns))
        scope.set({
          ...scope.getSnapshot(),
          status: "unavailable",
          writable: false,
        });
    const items: any[] = [];
    if (served.has("subagent") || served.has(SUBAGENT_MODEL_SELECTION_NS)) {
      if (!controllers.has("subagent")) {
        const limits = new SubagentLimitsCardController(configForm("subagent")),
          models = new SubagentModelSelectionCardController(
            configForm(SUBAGENT_MODEL_SELECTION_NS),
            remoteContext,
          );
        controllers.set("subagent", {
          inject: () => subagentCardFace(limits.inject(), models.inject()),
          dispose: () => {
            limits.dispose();
            models.dispose();
          },
        });
      }
      items.push({ id: "subagent", label: subagentZh.subagentTitle });
    }
    if (served.has(WEB_NS)) {
      if (!controllers.has("web-search"))
        controllers.set(
          "web-search",
          new WebSearchCardController(
            {
              web: configForm(WEB_NS),
              api: configForm(WEB_API_NS),
              legacy: configForm(WEB_SEARCH_NS),
            },
            remoteContext,
          ),
        );
      items.push({ id: "web-search", label: webZh.title });
    }
    if (served.has(AGENT_LOOP_NS)) {
      if (!controllers.has("agent-loop"))
        controllers.set(
          "agent-loop",
          new AgentLoopCardController(configForm(AGENT_LOOP_NS)),
        );
      items.push({ id: "agent-loop", label: loopZh.title });
    }
    const shell = view.namespaces.find((n: any) =>
      [BASH_NS, PWSH_NS].includes(n.ns),
    );
    if (shell) {
      if (!controllers.has("shell"))
        controllers.set("shell", new ShellCardController(configForm(shell.ns)));
      items.push({ id: "shell", label: shellZh.title });
    }
    ledger.set({ items, bundles: new Set(), rows: new Set() });
  };
  const refresh = async () => {
    manager.set({
      ...manager.getSnapshot(),
      status: manager.getSnapshot().packages.length ? "ready" : "loading",
      refreshStatus: "refreshing",
    });
    try {
      const [bundles, plugins] = await Promise.all([
        request("listBundles"),
        request("listPlugins"),
        loadSettings(),
      ]);
      tabs.set(
        bundles.some((b: any) => b.name.includes("plugin-market") && b.enabled)
          ? [{ id: "discover", label: "发现" }]
          : [],
      );
      manager.set({
        ...manager.getSnapshot(),
        status: "ready",
        refreshStatus: "idle",
        packages: sortPackages(
          [
            ...bundles,
            {
              name: "ds-harness-remote",
              official: false,
              availability: "profile",
              installed: true,
              enabled: true,
              optional: false,
              removable: false,
              rows: [],
              readOnlyReason: "management-required",
              meta: {
                title: "DS Harness Remote",
                description:
                  "当前远程连接组件。Host按策略隐藏此包的管理记录；仅显示连接状态，不能远程修改。",
              },
              clientProvenance: "active-remote-connection",
            },
          ].map((bundle: any) => {
            const pkg = packageView(bundle, plugins);
            return {
              ...pkg,
              removable: false,
              update: ctx.operations?.updateBundle ? pkg.update : undefined,
              readOnlyReason: ctx.operations?.setBundleEnabled
                ? pkg.readOnlyReason
                : "management-required",
              rows: pkg.rows.map((row) => ({
                ...row,
                readOnlyReason: ctx.operations?.setPluginEnabled
                  ? row.readOnlyReason
                  : "management-required",
              })),
            };
          }),
        ),
      });
    } catch (e: any) {
      manager.set({
        ...manager.getSnapshot(),
        status: "error",
        refreshStatus: "failed",
      });
      setNotice(e.message);
    }
  };
  const loadDetail = async (
    name: string,
    version: string | undefined,
    language: string,
    force = false,
  ) => {
    const key = JSON.stringify([name, version ?? null, language]);
    if (details.getSnapshot()[key] && !force) return;
    details.set({ ...details.getSnapshot(), [key]: { status: "loading" } });
    try {
      const detail = await request("readBundleDetail", { name, language });
      details.set({
        ...details.getSnapshot(),
        [key]: { status: "ready", detail },
      });
    } catch {
      details.set({
        ...details.getSnapshot(),
        [key]: { status: "error", failure: "other" },
      });
    }
  };
  const write = async (method: string, params: any) => {
    manager.set({ ...manager.getSnapshot(), busy: [params.name ?? params.id] });
    try {
      const receipt = await request(method, {
        ...params,
        requestId: operationId(),
      });
      if (receipt.status !== "accepted")
        setNotice("响应未确认，请刷新并核对远程状态；不会自动重发。");
      await refresh();
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      manager.set({ ...manager.getSnapshot(), busy: [] });
    }
  };
  const refreshOnMount = useRef(refresh);
  useEffect(() => {
    void refreshOnMount.current();
    return () => {
      for (const controller of controllers.values()) controller.dispose();
    };
  }, [controllers]);
  useEffect(() => {
    const disable = () => {
      for (const button of document.querySelectorAll<HTMLButtonElement>(
        "button",
      )) {
        if (
          button.getAttribute("role") === "tab" &&
          button.textContent?.trim() === "发现"
        ) {
          button.disabled = true;
          button.title = "当前Remote未开放插件索引API";
        }
        const label = button.getAttribute("aria-label");
        if (
          [pluginZh.addPlugin, pluginZh.chooseAddMethod].includes(label ?? "")
        ) {
          button.disabled = true;
          button.title = "Remote未开放安装接口";
        }
      }
    };
    const observer = new MutationObserver(disable);
    observer.observe(document.getElementById("root")!, {
      childList: true,
      subtree: true,
    });
    disable();
    return () => observer.disconnect();
  }, []);
  const renderSlot = (name: string, props: any, select: any) => {
    if (name === "plugins.item") {
      const id = select?.only,
        controller = controllers.get(id);
      if (!controller) return null;
      const face = controller.inject();
      if (id === "shell")
        return (
          <ShellCard
            {...props}
            {...face}
            useShellCard={hook(face.hooks.shellCard)}
            t={translate(shellZh) as any}
          />
        );
      if (id === "agent-loop")
        return (
          <AgentLoopCard
            {...props}
            {...face}
            useAgentLoopCard={hook(face.hooks.agentLoopCard)}
            t={translate(loopZh) as any}
          />
        );
      if (id === "subagent")
        return (
          <SubagentCard
            {...props}
            {...face}
            useSubagentLimitsCard={hook(face.hooks.subagentLimitsCard)}
            useSubagentModelSelectionCard={hook(
              face.hooks.subagentModelSelectionCard,
            )}
            t={translate(subagentZh) as any}
          />
        );
      if (id === "web-search")
        return (
          <div
            title={
              props.view === "page"
                ? "当前Remote未开放提供方目录，提供方选择不可用"
                : undefined
            }
          >
            <WebSearchCard
              {...props}
              {...face}
              useWebSearchCard={webSearchHook(face.hooks.webSearchCard)}
              t={translate(webZh) as any}
            />
          </div>
        );
    }
    return null;
  };
  const props: any = {
    t: translate(pluginZh),
    resolveText,
    renderSlot,
    SessionProvider: React.Fragment,
    useConfigurations: hook(configurations),
    configForm,
    usePluginManager: hook(manager),
    useConfigLedger: hook(ledger),
    useStore: hook(navigation),
    actions: {
      setView: (view: any) =>
        navigation.set({ ...navigation.getSnapshot(), view }),
      setTab: (tab: string) =>
        navigation.set({ ...navigation.getSnapshot(), tab }),
    },
    usePluginTabs: hook(tabs),
    useBundleDetails: hook(details),
    useLocale: hook(locale),
    createHeaderRef: createPluginHeaderRef,
    ensure: no,
    refresh: () => void refresh(),
    clearHighlight: no,
    dismissNotice: no,
    loadDetail: (...p: any[]) => void loadDetail(p[0], p[1], p[2]),
    retryDetail: (...p: any[]) => void loadDetail(p[0], p[1], p[2], true),
    detailImage: () => undefined,
    setEnabled: (name: string, enabled: boolean) =>
      void write("setBundleEnabled", { name, enabled }),
    setRowEnabled: (id: string, enabled: boolean) =>
      void write("setPluginEnabled", { id, enabled }),
    update: unsupported,
    uninstall: unsupported,
    openInstall: unsupported,
    ensureVersions: no,
    checkVersions: no,
    openUpdate: unsupported,
    installFrom: unsupported,
    openGitUpdate: unsupported,
  };
  return (
    <>
      {notice ? (
        <p role="status" className="notice">
          {notice}
          <button onClick={() => setNotice("")}>关闭</button>
        </p>
      ) : null}
      <PluginManagerPage {...props} />
    </>
  );
}
