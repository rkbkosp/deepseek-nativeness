import {useMemo,useCallback,useEffect} from "react";
import {AgentPresetSection} from "../../../deepseek-harness/packages/client/ui-agent-preset/src/client/AgentPresetSection.tsx";
import {AgentPresetSectionController} from "../../../deepseek-harness/packages/client/ui-agent-preset/src/client/section-store.ts";
import {zh} from "../../../deepseek-harness/packages/client/ui-agent-preset/src/client/locales.ts";
import {SettingsDescribeMirror} from "../../../deepseek-harness/packages/client/ui-settings/src/client/settings-mirror.ts";
import {store} from "./bridge";
import {createPageRpc} from "./rpc-adapter";
import {hook,translate} from "./presentation";
import "./settings-frame.css";

export default function AgentPresetsPage({ctx}:{ctx:any}) {
  const state=useMemo(()=>{
    const rpc=createPageRpc(ctx);
    let mirror:SettingsDescribeMirror;
    const remote={settings:{describe:()=>rpc.read("describeSettings"),update:async(ns:string,patch:any,expectedRevision?:number)=>{
      const revision=expectedRevision??mirror.getSnapshot().view?.namespaces.find(row=>row.ns===ns)?.revision;
      if(revision===undefined)return {ok:false,error:{code:"STALE_CONTEXT",message:"尚未读取当前配置修订，请刷新后重试。"}};
      const result=await rpc.write("updateSettings",{ns,patch,expectedRevision:revision});
      if(result.ok)mirror.acceptView(result.value);
      return result;
    }},agentPresets:{list:()=>rpc.read("listAgentPresets"),read:(agentPreset:string)=>rpc.read("readAgentPreset",{agentPreset})}};
    mirror=new SettingsDescribeMirror({remote} as any);
    const controller=new AgentPresetSectionController({remote} as any);
    const developerTools=store(false);
    return {controller,mirror,developerTools};
  },[ctx]);
  const load=useCallback(async()=>{
    await Promise.all([state.controller.load(),state.mirror.ensure()]);
    const view=state.mirror.getSnapshot().view;
    state.developerTools.set(view?.namespaces.find(ns=>ns.ns==="ui-settings")?.value?.enabled??false);
  },[state]);
  useEffect(()=>()=>state.controller.closeView(),[state]);
  const makeDefault=useCallback(async(id:string)=>{
    await state.mirror.ensure();
    const view=state.mirror.getSnapshot().view;
    const namespace=view?.namespaces.find(ns=>ns.ns==="agent-preset-registry");
    if(!view?.writable||!namespace||!ctx.operations?.updateSettings){state.controller.store.set({...state.controller.store.getSnapshot(),error:"当前Host不允许更改预设默认值。"});return;}
    // The original controller supplies the write semantics; capture the current
    // revision in its context's settings call through the mirror-backed adapter.
    await state.controller.makeDefault(id);
    await state.mirror.load();
  },[ctx.operations,state]);
  return <main className="compat-settings-frame"><AgentPresetSection
    useAgentPresetSection={hook(state.controller.store)}
    useDeveloperTools={hook(state.developerTools)}
    load={load}
    view={(id:string)=>state.controller.view(id)}
    closeView={()=>state.controller.closeView()}
    makeDefault={makeDefault}
    close={()=>{}}
    {...ctx.operations?.clientStartDraft?{startCreatorDraft:()=>void window.mygo?.call("CompatAPI.StartDraft","","cordis")}: {}}
    t={translate(zh) as any}
  /></main>;
}
