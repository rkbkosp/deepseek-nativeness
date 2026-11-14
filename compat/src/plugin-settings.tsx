import { useMemo, useEffect } from "react";
import { PluginsSettingsSection } from "../../../deepseek-harness/packages/client/ui-settings-plugins/src/client/PluginsSettingsSection.tsx";
import { PluginInventorySettingsTab } from "../../../deepseek-harness/packages/client/ui-settings-plugin-inventory/src/client/PluginInventorySettingsTab.tsx";
import { zh as sectionZh } from "../../../deepseek-harness/packages/client/ui-settings-plugins/src/client/locales.ts";
import { zh as inventoryZh } from "../../../deepseek-harness/packages/client/ui-settings-plugin-inventory/src/client/locales.ts";
import { zh as presetZh } from "../../../deepseek-harness/packages/client/ui-agent-preset/src/client/locales.ts";
import { presetDisplayText } from "../../../deepseek-harness/packages/preset/agent-preset-registry/src/display.ts";
import settingsCss from "../../../deepseek-harness/packages/client/ui-settings-general/src/client/SettingsRoot.module.css";
import { hook, translate, resolveText } from "./presentation";
import { store } from "./bridge";
import { createPageRpc } from "./rpc-adapter";

export function createPluginSettings(ctx: any, call?: any) {
  const rpc = createPageRpc(ctx, call);
  return {
    tabs: store([{ id: "all", order: 10, label: inventoryZh.tab }]),
    // This compatibility page is a prebuilt local module. It does not run the
    // original dynamic Host client-module graph or claim its synchronization.
    clientSync: store({
      syncing: false,
      failures: [],
      provenance: "local-static-compat",
    }),
    list: async () => {
      const result = await rpc.read("pluginInventory");
      if (!result.ok) throw Error(result.error.message);
      return result.value;
    },
    dispose: () => rpc.dispose(),
  };
}
export default function PluginSettingsPage({ ctx }: { ctx: any }) {
  const face = useMemo(() => createPluginSettings(ctx), [ctx]);
  useEffect(() => () => face.dispose(), [face]);
  return (
    <main className={settingsCss.options} style={{ flex: 1 }}>
      <PluginsSettingsSection
        t={translate(sectionZh) as any}
        useTabs={hook(face.tabs)}
        renderSlot={(_name: any, _props: any, options: any) =>
          options?.only === "all" ? (
            <PluginInventorySettingsTab
              list={face.list}
              useClientSync={hook(face.clientSync)}
              retryClient={() => {}}
              resolveText={resolveText}
              presetName={(preset: any) =>
                presetDisplayText(preset, translate(presetZh) as any).name
              }
              t={translate(inventoryZh) as any}
            />
          ) : (
            (options?.fallback ?? null)
          )
        }
      />
    </main>
  );
}
