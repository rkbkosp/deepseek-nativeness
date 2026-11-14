import { useMemo, useEffect } from "react";
import { ModelsSection } from "../../../deepseek-harness/packages/client/ui-settings-models/src/client/ModelsSection.tsx";
import { ModelsSettingsStore } from "../../../deepseek-harness/packages/client/ui-settings-models/src/client/store.ts";
import { createModelsOperations } from "../../../deepseek-harness/packages/client/ui-settings-models/src/client/operations.ts";
import { createSettingsSchemaOperations } from "../../../deepseek-harness/packages/client/ui-settings-models/src/client/schema-operations.ts";
import { SettingsSchemaService } from "../../../deepseek-harness/packages/client/ui-settings/src/client/schema.ts";
import { SettingsDescribeMirror } from "../../../deepseek-harness/packages/client/ui-settings/src/client/settings-mirror.ts";
import { zh } from "../../../deepseek-harness/packages/client/ui-settings-models/src/client/locales.ts";
import { createPageRpc } from "./rpc-adapter";
import { hook, translate } from "./presentation";
import { createPageLifetime } from "./page-lifetime";
import { onNotification } from "./bridge";
import settingsCss from "../../../deepseek-harness/packages/client/ui-settings-general/src/client/SettingsRoot.module.css";

export function createModelSettings(ctx: any, call?: any) {
  const lifetime = createPageLifetime();
  const rpc = createPageRpc(ctx, call);
  lifetime.own(() => rpc.dispose());
  let mirror: SettingsDescribeMirror;
  const remote = {
    llm: {
      listProviders: () => rpc.read("listProviders"),
      listConfigurableProviders: () => rpc.read("listConfigurableProviders"),
      discoverModels: (settingsNs: string, request: any) =>
        rpc.read("discoverModels", { settingsNs, request }),
    },
    session: { modelCatalog: () => rpc.read("modelCatalog") },
    credentials: {
      describe: (refs: string[]) => rpc.read("describeCredentials", { refs }),
      set: (ref: string, value: string) =>
        rpc.write("setCredential", { ref, value }),
      unset: (ref: string) => rpc.write("unsetCredential", { ref }),
    },
    settings: {
      describe: async () => {
        const result = await rpc.read("describeSettings");
        return result.ok
          ? {
              ...result,
              value: {
                ...result.value,
                writable:
                  result.value.writable && !!ctx.operations?.mutateSettings,
              },
            }
          : result;
      },
      mutate: async (ns: string, ops: any, expectedRevision?: number) => {
        const result = await rpc.write("mutateSettings", {
          ns,
          ops,
          expectedRevision,
        });
        if (result.ok) mirror.acceptView(result.value);
        return result;
      },
    },
  };
  const facade = { remote } as any;
  mirror = new SettingsDescribeMirror(facade);
  const schema = createSettingsSchemaOperations(
    new SettingsSchemaService(undefined as any),
  );
  const controller = new ModelsSettingsStore(facade, schema, mirror);
  lifetime.guardStore(controller.store);
  lifetime.guardStore((mirror as any).store);
  const operations = createModelsOperations(facade);
  return {
    controller,
    operations,
    schema,
    mirror,
    dispose: () => lifetime.dispose(),
    invalidate: async () => {
      await mirror.load();
      if (lifetime.active) await controller.load();
    },
  };
}

export default function ModelSettingsPage({ ctx }: { ctx: any }) {
  const face = useMemo(() => createModelSettings(ctx), [ctx]);
  useEffect(() => {
    const off = onNotification((event) => {
      if (
        event.method === "remoteInvalidation" &&
        event.params.hostId === ctx.hostId &&
        event.params.connectionGeneration === ctx.connectionGeneration &&
        event.params.event !== "schedule/changed"
      )
        void face.invalidate();
    });
    return () => {
      off();
      face.dispose();
    };
  }, [ctx, face]);
  return (
    <main className={settingsCss.options} style={{ flex: 1 }}>
      <ModelsSection
        {...face}
        useSnapshot={hook(face.controller.store)}
        t={translate(zh) as any}
        renderSlot={(_name: any, _props: any, options: any) =>
          options?.fallback ?? null
        }
      />
    </main>
  );
}
