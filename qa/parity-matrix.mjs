import fs from 'node:fs';
const categories = [
  ['shell','ui-layout,ui-sidebar,ui-theme,ui-brand-official', 'client', ['深色/浅色/跟随系统主题','原版logo/窗口交通灯/拖动区域','侧栏宽度/收起/展开/Cmd+B','字体/图标/边界/悬浮/焦点','窗口缩放与最小宽度','上下文菜单Esc/外点关闭/键盘导航']],
  ['sidebar','ui-workspace,ui-sidebar,ui-entry-customization','workspace/follow;session/list', ['同时显示所有工作区分组','树形/工作区/单列表切换','手动/最近更新排序','相对时间与自动更新','名称搜索/结果跳转','工作区折叠并持久','置顶区域和顺序','隐藏/全部/仅归档筛选','会话hover动作/选中状态','运行spinner/已完成/错误状态','全局面板固定/取消固定','新建会话/工作区','拖动会话及工作区顺序']],
  ['session-menu','ui-workspace','session/rename;session/fork;workspace/pinSession;workspace/archiveSession', ['置顶/取消置顶','重命名对话框/确认/取消/错误','分叉会话与精确消息边界','复制Session ID','归档确认运行中任务/取消归档','捕获菜单打开时会话目标','已读/未读标记']],
  ['header','ui-conversation,ui-subagent,session-log-export,ui-open-in-app','client;agentPresets/read', ['原版标题/标准模式/层级导航','对话/轨迹实际切换','更多视图/插件视图','右侧栏开关','复制完整会话Markdown','下载原始Session ZIP','在应用中打开','会话反馈']],
  ['chat','ui-chat,ui-tool,ui-trajectory,ui-renderer','session/follow;session/page;session/events', ['用户消息与timestamp','按turn/step/process分组','上下文来源折叠','思考过程折叠','工具call/result合并及详情','工作步骤展示级别/收起时机/保留回复','流式文本/思考/工具状态增量','完成/失败/取消/重试/截断状态','轮次跳转条/定位滚动','分页前插后保持阅读位置','Markdown代码/表格/链接/图片','文本选区/复制/代码换行','消息复制/赞踩/分支','请求/响应usage缓存命中/上下文统计','轨迹请求表/筛选/展开','历史继承/压缩/恢复节点','工具专用文件/图片/终端/网页/差异卡片']],
  ['composer','ui-conversation,ui-model-selection,ui-permission-presets,ui-attachment,ui-commands,ui-reference','session/prompt;session/modelCatalog;session/selectModel;permissionPresets/catalog;commands/list;commands/execute', ['每会话独立草稿持久','每会话滚动/视图恢复','多行输入/IME/快捷键/焦点','模型提供商/模型选择','推理等级/默认模型初始化','访问权限catalog/选择语义','加号附件/指令菜单','文件上传/图片预览/移除/失败恢复','拖放/粘贴文件图片','斜杠命令chip与参数','@文件/会话引用与引用选区','运行中queue/steer与Cmd+Enter','队列列表/编辑/删除/顺序','发送确认后清正确草稿','unknown receipt保留并禁止盲重发','停止/取消实际路由会话','离线禁写/重连后可写状态']],
  ['interactions','ui-approval,ui-tool,ui-subagent','\u0024events;\u0024events/result;userQuestions/answer', ['审批允许/拒绝/下一处理者','审批原会话/子会话归属','审批失效/断线/切会话释放','问题单选/多选/自定义/取消','问题原id与来源保留','子会话只读/继续/中断','多客户端事件ready与所有权']],
  ['right-pane','ui-sidebar-right,ui-sidebar-files,ui-sidebar-terminal,ui-sidebar-browser,ui-sidebar-documentpreview','workspaceFiles/list;workspaceFiles/read;terminal-policy', ['文件树展开/隐藏文件/gitignore','全工作区文件名/路径搜索/排除规则','文本/二进制/图片/文档预览','文件变化监听与刷新','代码diff/本轮差异','终端目录/创建/输出/输入/resize/关闭','已有终端与设备所有权边界','网页打开/前进后退/外部浏览器','标签新增/关闭/切换/宽度与导航恢复']],
  ['settings','ui-settings-general,ui-theme,ui-shortcuts,ui-settings-session-log','client;settings/describe;settings/update;settings/replace;settings/mutate', ['通用/模型/内置插件/Agent预设导航','新会话默认权限模式','语言选择','外观主题','内容字号与字体设置','工作步骤展示/收起/回复','代码工作视图开关','快捷键查看/修改/冲突','链接默认打开方式','繁忙时发送行为','性能与用量详略','官方SessionLog上传偏好','更新渠道/当前版本','打开主机配置文件']],
  ['plugins','ui-plugin-manager,ui-plugin-market,ui-settings-plugin-inventory','pluginInventory/list;pluginManager/listBundles;pluginManager/readBundleDetail', ['已安装/发现tab','目录/详情/版本/错误','内置插件配置页','启停/更新/安装/卸载受权限控制','Remote自身不许远程停用更新','任意第三方Web UI及动态资源','插件自定义slots/工具/模型扩展']],
  ['extra','ui-goal,ui-plan,ui-schedule,ui-agent-preset,ui-settings-account,ui-account-notifications','goals/*;schedule/*;agentPresets/*', ['目标/计划显示及命令','自动化任务catalog/history','自动化创建/修改/删除/执行','Agent预设/子智能体/Team','账号菜单/设置/登录/反馈','新客户端Remote登录/主机/离线/身份隔离']],
];
const rows=[];
for(const [domain,packages,remote,actions] of categories)actions.forEach((action,i)=>rows.push({id:`${domain}-${i+1}`,domain,action,originalSource:packages.split(',').map(p=>`deepseek-harness/packages/${p==='session-log-export'?'session-query':'client'}/${p}/src/`),remoteSupport:remote,currentNative:'pending implementation and independent verification; prototype is partial',evidence:{source:true,freshOriginalCapture:domain==='shell'?'01':domain==='sidebar'?'01,02':domain==='session-menu'?'03':domain==='header'?'04':domain==='chat'?'01,05':domain==='composer'?'06,07,08':domain==='right-pane'?'09':domain==='settings'?'12':domain==='plugins'?'10':domain==='extra'?'11':null,nativeGui:false,fixture:false,live:false},acceptance:'Each control must change the intended state or invoke the exact allowed wire contract; matching labels or fixture-only success do not establish live parity.'}));
const edge=(pattern,support,note)=>rows.filter(r=>r.action.includes(pattern)).forEach(r=>{r.remoteSupport=support;r.constraint=note});
edge('下载原始','blocked:no resource bridge','Original authenticated GET /api/session.export includes durable raw logs, attachments and subagent archive; commands/export success only requests client download. Remote has no generic Fetch carrier.');
edge('复制完整','client-reconstruction possible; original route unavailable','Original GET /api/session.markdown unavailable through Remote. Can evaluate full session/events paging plus original formatter; partial UI rows must not be called complete.');
edge('已读/未读','blocked:sessionStatus/mark and follow absent','Local-only unread mark is not Host-equivalent state.');
edge('全工作区文件名/路径搜索','blocked:workspaceFiles/search absent','Original server-side workspace-wide filename/path search with rg ignore rules unavailable. A constrained client tree scan must be disclosed, not claimed exact for arbitrary workspace.');
edge('打开主机配置','blocked:settings/openSettingsDocument absent','Opening a config on the MacMini is not opening client preferences on the laptop.');
edge('任意第三方','blocked:no generic resource/module carrier','plugin.route.v1 allows reviewed POST api/bot only; plugin manager settings do not transport arbitrary frontend modules. Existing Remote Web fallback is a separate client identity/event channel.');
edge('Remote自身','forbidden by frozen Remote policy','Remote bundle cannot be enabled/disabled/updated remotely, even though pluginManager endpoints exist.');
edge('已有终端','conditional:terminal capability, policy and ownership','Remote terminal disabled unless already enabled; terminal/list filters device-owned terminals. Do not toggle Host policy for test.');
edge('上传偏好','settings namespace; write authorization required','Host session-log-deepseek preference is not client-local setting.');
edge('更新渠道','not same application updater','Native client version/updater cannot pretend to be official dsh Host updater.');
for(const row of rows.filter(r=>r.action==='下载原始Session ZIP'||r.action==='任意第三方Web UI及动态资源'))row.resourceCarrierQualification='The direct Remote API has no generic asset/export carrier. Remote also has optional HTTP/WS loopback proxy, restricted to pre-authorized ports. An already-running original HTTP frontend on an already-authorized port could be evaluated without backend change; this audit must verify that deployment condition before declaring an absolute blocker.';
rows.find(r=>r.action==='每会话独立草稿持久').currentNative='FAIL at baseline: app.draft is global; openSession does not save/restore by session id';
rows.find(r=>r.action==='同时显示所有工作区分组').currentNative='FAIL at baseline: selecting a workspace filters sessions instead of original grouped workspace list';
rows.find(r=>r.action==='对话/轨迹实际切换').currentNative='FAIL at baseline: text labels only; no trajectory view';
const guiRound1URL=new URL('./parity-gui-round1.json',import.meta.url);
const guiRound1=fs.existsSync(guiRound1URL)?JSON.parse(fs.readFileSync(guiRound1URL,'utf8')):null;
const guiRound2URL=new URL('./parity-gui-round2.json',import.meta.url);
const guiRound2=fs.existsSync(guiRound2URL)?JSON.parse(fs.readFileSync(guiRound2URL,'utf8')):null;
const laterReviews=[3,4,5,'5.1',6,'6.1',7,8,9].map(n=>{const url=new URL(`./parity-gui-round${n}.json`,import.meta.url);return fs.existsSync(url)?{n,value:JSON.parse(fs.readFileSync(url,'utf8'))}:null}).filter(Boolean);
const round4Rows={
 'real-history-render':['sidebar-1','header-1','chat-11','composer-3'],
 'real-file-read':['right-pane-1','right-pane-3'],
 'settings-live-read':['settings-2','settings-12'],
 'client-font-pref':['settings-5'],
 'model-current':['composer-4','composer-5'],
 'plugin-shared-connection':['plugins-1','plugins-2','plugins-3'],
 'compat-return':['header-3','plugins-3','extra-6'],
};
const observedDomains={shell:['typography'],sidebar:['catalog-scope'],header:['chat-layout'],chat:['chat-layout','trajectory-parity','typography'],composer:['chat-layout','remaining-actions'],settings:['settings-layout','remaining-actions'],'right-pane':['right-pane-layout'],plugins:['remaining-actions'],'session-menu':['remaining-actions']};
const round5Rows={
 'native-font-material':['shell-4','chat-11'], 'collapsed-caption':['shell-2','shell-3','header-1'],
 'anchored-model-popup':['composer-4','composer-5'], 'plugin-frame':['plugins-1','plugins-2','plugins-3'],
 'composer-stale-context':['composer-3','composer-17'], 'model-caption':['composer-4','composer-5'],
 'permission-caption':['composer-6'], 'terminal-visible-pane':['right-pane-6','right-pane-9'],
 'narrow-composer':['shell-5','composer-3','composer-4'], 'trajectory-gate':['header-2','chat-15'],
};
const round51Rows={'automatic-restore':['extra-6','composer-2'],'composer-scope-reload':['composer-3','composer-17'],'composer-model-caption':['composer-4','composer-5'],'permission-caption':['composer-6'],'trajectory-real-render':['header-2','chat-15'],'trajectory-search-collapse':['chat-15'],'trajectory-close':['header-2','composer-17']};
for(const row of rows){
 row.evidence.nativeGui={status:'not-observed'};
 if(guiRound1&&observedDomains[row.domain]){
  const findings=guiRound1.findings.filter(x=>observedDomains[row.domain].includes(x.id));
  row.evidence.nativeGui={status:findings.some(x=>x.result==='failed')?'observed-failed':'observed-incomplete',review:'qa/parity-gui-round1.json',candidateNativeSha256:guiRound1.candidateNativeSha256,findings:findings.map(x=>x.id),screenshots:[...new Set(findings.map(x=>x.evidence).filter(Boolean))],scope:'Domain view observed. This does not imply every individual action was exercised.',repairs:'New source fixes require a separately recorded real-app retest; round-one failures remain preserved.'};
 }
 if(guiRound2){
  row.evidence.nativeGui.retests=[];
  if(row.domain==='settings'){
   row.evidence.nativeGui.retests.push({review:'qa/parity-gui-round2.json',candidateNativeSha256:guiRound2.candidateNativeSha256,status:'observed-passed-subcheck',scope:'Only modal bounds, fixed header/rail and content clipping',screenshot:'/tmp/native-dsh-parity/31-native-core2-settings.png',remaining:'Exact typography, remaining disabled or unimplemented actions and full operation parity not accepted.'});
  }else if(['shell','sidebar','header','chat','composer','right-pane'].includes(row.domain)){
   row.evidence.nativeGui.retests.push({review:'qa/parity-gui-round2.json',candidateNativeSha256:guiRound2.candidateNativeSha256,status:'observed-failed-main-drawing',scope:'Main surface is blank, despite AX/history availability. All-workspace catalog improved in AX only.',screenshots:['/tmp/native-dsh-parity/30-native-core2-chat.png','/tmp/native-dsh-parity/30b-native-core2-chat.png']});
  }
 }
 for(const review of laterReviews){
  row.evidence.nativeGui.retests??=[];
  if(review.n===3){
   const ids=row.domain==='plugins'?['shared-compat-connection','compat-visuals']:row.domain==='composer'?['model-current-selection']:['shell','chat','header'].includes(row.domain)?['main-drawing']:[];
   for(const finding of review.value.findings.filter(x=>ids.includes(x.id)))row.evidence.nativeGui.retests.push({review:`qa/parity-gui-round${review.n}.json`,candidateNativeSha256:review.value.candidateNativeSha256,finding:finding.id,status:finding.status,evidence:finding.evidence??[],scope:finding.detail});
  }
  if(review.n===4){
   for(const check of review.value.passedSubchecks.filter(x=>round4Rows[x.id]?.includes(row.id))){
    row.evidence.nativeGui.retests.push({review:'qa/parity-gui-round4.json',candidateNativeSha256:review.value.candidateNativeSha256,finding:check.id,status:'observed-passed-subcheck',evidence:check.evidence??[],scope:check.detail,remaining:'Only the described behavior is accepted; remaining actions and exact visual parity stay open.'});
    row.evidence.live={status:'passed-live-subcheck',review:'qa/parity-gui-round4.json',id:check.id,scope:check.detail,hostMutationsTested:false};
    if(row.currentNative.startsWith('FAIL at baseline:'))row.baselineNative=row.currentNative;
    row.currentNative='Partial: round 4 has real subcheck evidence. Full operation family and visual parity remain unaccepted.';
   }
  }
  if(review.n===5){
   for(const [kind,checks] of [['passed',review.value.passedSubchecks??[]],['failed',review.value.failedSubchecks??[]]]){
    for(const check of checks.filter(x=>round5Rows[x.id]?.includes(row.id))){
     row.evidence.nativeGui.retests.push({review:'qa/parity-gui-round5.json',candidateNativeSha256:review.value.candidateNativeSha256,finding:check.id,status:kind==='passed'?'observed-passed-subcheck':'observed-failed-subcheck',evidence:check.evidence??[],scope:check.detail,remaining:'Source-only repairs require a separately packaged GUI retest; historical failures are retained.'});
     row.currentNative=`Partial implementation; round 5 ${kind} the specific ${check.id} subcheck. Full operation and visual parity remain unaccepted.`;
    }
   }
  }
  if(review.n==='5.1'){
   for(const check of (review.value.passedSubchecks??[]).filter(x=>round51Rows[x.id]?.includes(row.id))){
    row.evidence.nativeGui.retests.push({review:'qa/parity-gui-round5.1.json',candidateNativeSha256:review.value.candidateNativeSha256,finding:check.id,status:'observed-passed-subcheck',evidence:check.evidence??[],scope:check.detail,remaining:'Only the described read-only behavior is qualified. Remaining actions and exact visual parity stay open.'});
    row.currentNative=`Partial implementation; round 5.1 passed ${check.id}. Other operations and full visual parity remain unaccepted.`;
   }
  }
 }
}
const composerSourceStatus={1:'Host/account/session draft map and accepted-intent settlement implemented; fixture-qualified, persistence/restart parity partial.',2:'Per-session scroll state and navigation generation implemented; fixture-qualified, full restoration behavior not independently accepted.',3:'Native multiline/marked-text keyboard handling implemented and framework-fixture tested; round5 narrow-width failure and platform IME GUI remain open.',4:'Native trigger + original WK model panes implemented; round5 anchor passed, trigger/provider caption and WK fallback failed; source repairs await GUI.',5:'Original reasoning pane exists; native Default/named/retained-effort source fix tested, actual new package pending.',6:'Authoritative permission catalog/current value and command writer + risk gate implemented. Round5 wording failed; source-only label fix pending GUI.',7:'Native Host command text-completion exists; original plus-menu File/client actions and complete popup/chip parity remain incomplete.',8:'Not implemented: original composer attachment upload/preview/retry. Unsupported File effect is explicitly blocked and draft preserved.',9:'Not implemented: original image/file drag-paste intake.',10:'Host command execution and text completion implemented; original claim chips/parameter popup behavior incomplete; client-only effects blocked.',11:'Scoped @file path completion and quoted Unicode grammar implemented; original rich references/conversation-reference features incomplete.',12:'Idle/busy queue-steer keyboard policy implemented; five policy fixtures passed; no live prompt sent.',13:'Projected next-turn queue edit/remove/steer controls implemented and fixture checked; original complete queue presentation still unaccepted.',14:'Ordinary prompt and typed-command accepted receipts settle only captured account/Host/session matching draft; late receipt fixtures passed.',15:'Unknown prompt/command receipt preserves draft and stable intent and blocks blind redispatch; fixtures passed.',16:'Stop control uses scoped cancel mutation with stable receipt handling; no live cancellation exercised.',17:'Offline/write and scoped-read guards implemented. Round5 early-read race failed, source read-epoch repair fixture passed; packaged reconnect GUI pending.'};
for(const row of rows.filter(r=>r.domain==='composer'))row.currentNative=composerSourceStatus[Number(row.id.split('-').at(-1))];
const round51Status={'composer-2':'Same completed session automatically restored at startup in real GUI5.1; complete per-session draft/scroll semantics still require independent acceptance.','composer-3':'Framework multiline/IME/shortcut fixtures passed; real GUI5.1 scope reload passed. Narrow responsive source repair awaits packaged GUI.','composer-4':'Native current-model caption passed real GUI5.1; anchored WK passed GUI5 but its current-value fallback repair is still source-only. Selection writes not tested live.','composer-5':'Native Default caption passed real GUI5.1; original WK reasoning pane remains partial pending complete options/selection acceptance.','composer-6':'Catalog/current permission and original labels passed read-only GUI5.1. Selection/risk gate is fixture-only, no real permission changed.','composer-17':'Initial scoped-read race absent and trajectory return remained connected in real GUI5.1. Actual offline/reconnect write gating not fully qualified.'};
for(const row of rows)if(laterReviews.some(x=>x.n==='5.1')&&round51Status[row.id])row.currentNative=round51Status[row.id];
const reviewedSourceStatus={
 'sidebar-11':'Original global panel pin/unpin contribution UI is not implemented.',
 'header-4':'Right-pane toggle exists and was exercised in real GUI5; individual pane contents and layering remain partial.',
 'header-5':'Complete fixed-cursor event reconstruction with original Markdown formatter is implemented and independently fixture/lifecycle/read-only LAN checked; GUI8 enabled action observed. Host sourcePath block omitted; private clipboard not exercised.',
 'header-7':'Original open-in-application action is explicitly disabled/unimplemented.',
 'header-8':'Original Session-feedback dialog/action is incomplete; typed Host /feedback text is a separate command path.',
 'shell-1':'Client theme preferences and source tokens implemented; actual general/font subchecks exist, full light/system theme transitions unqualified.',
 'shell-6':'Native menus/popovers/modal Escape and outside-dismiss implementations exist; complete keyboard/focus parity unqualified.',
 'sidebar-2':'Grouping preferences are consumed by sidebar_rows.go; source verified, complete GUI menu matrix unqualified.',
 'sidebar-3':'Updated/manual sort preference is consumed by sidebar_rows.go; drag-reorder UX is separately incomplete.',
 'sidebar-4':'Relative age captions implemented; exact source cadence and all boundary labels unqualified.',
 'sidebar-5':'Loaded-catalog title filtering and selection implemented; full source search UX not accepted.',
 'sidebar-6':'Workspace disclosure uses private persisted Expanded preference and is consumed by row builder; source/fixture evidence only.',
 'sidebar-7':'Pin/unpin Host wrapper and selected/pinned row data exist; full order/presentation not independently exercised.',
 'sidebar-8':'Archived filter preference is consumed by row builder; source verified, real archive mutation not tested.',
 'sidebar-9':'Native hover menu/selected row implemented; real GUI views observed but complete hover/action matrix not accepted.',
 'sidebar-10':'Shared original spinner geometry uses paint-only scheduling; synthetic counters passed, actual M1 CPU/memory not measured.',
 'sidebar-12':'Native new-session/workspace paths implemented under capability gates; mutations fixture-only.',
 'sidebar-13':'Remote reorder wrappers exist; native drag-and-drop/reorder operation parity remains incomplete.',
 'session-menu-1':'Pin/unpin menu invokes exact Host operation with stable mutation receipt; no real mutation acceptance.',
 'session-menu-2':'Native rename draft/confirm/target guard implemented; fixture-only writes.',
 'session-menu-3':'Session-level fork wrapper exists; precise message-boundary fork UI remains incomplete.',
 'session-menu-4':'Native menu copies captured Session ID through clipboard API; complete clipboard GUI acceptance not recorded.',
 'session-menu-5':'Archive/unarchive Host wrappers exist; running-task confirmation and full operation parity unaccepted.',
 'session-menu-6':'Row callbacks capture session ID; Host/generation and mutation receipt guards exist, fixtures do not replace live write checks.',
 'chat-1':'Native user/assistant text and timestamp rows implemented; exact source styling/selection behavior still partial.',
 'chat-2':'Semantic turn/step/process grouping implemented; unique/stable row identity independent fixture passed.',
 'chat-3':'Source.kind/context producer/form-based folding implemented; no text-substring hiding; core fixtures passed.',
 'chat-4':'Reasoning display/fold state implemented; complete current model/tool combinations unqualified.',
 'chat-5':'Tool call/result merging and original semantic projection implemented; bespoke tool renderers remain incomplete.',
 'chat-6':'Existing fold state consumes detail/completion/next-input preferences; independent fixture passed.',
 'chat-7':'Incremental publisher/Go consumption fixture passed, old history not resent per chunk; real runningCount was zero, live stream remains untested.',
 'chat-12':'Native selection and code wrap/copy controls exist; complete original selection/clipboard matrix unaccepted.',
 'chat-13':'Copy control exists; source feedback and precise message fork controls still incomplete/disabled.',
 'chat-14':'Usage/context projections and footer presentation are not completed; no fabricated statistics.',
 'chat-8':'Basic running/settlement state exists; complete original failure/cancel/retry/truncation presentation is not accepted.',
 'chat-9':'Original WK trajectory renders in GUI5.1; all round/request jump-to-chat scroll behavior remains unqualified.',
 'chat-10':'History paging transport exists; exact prepend/scroll anchoring UX has not been independently qualified.',
 'chat-16':'Context provenance is retained by projection; full inherited-history/compaction/recovery node presentation remains incomplete.',
 'chat-17':'Basic native tool nodes and low-frequency original detail components are partial; all bespoke tool visualizations are not implemented.',
 'interactions-1':'Correlated approval result buttons and ready gate implemented; protocol fixtures passed, no real approval answered.',
 'interactions-2':'Selected-session/catalog-confirmed-child ownership implemented; independent protocol and Go provenance fixtures passed.',
 'interactions-3':'Cancellation/selection/disconnect release and expiry implemented; independent lifecycle fixtures passed, no live approval release drill.',
 'interactions-4':'Native single/multi/custom/cancel question forms implemented; fixtures passed, no real question answered.',
 'interactions-5':'Original question IDs and source session retained through projection and Go UI; cross-layer fixture passed.',
 'interactions-6':'Subagent Remote wrappers exist; complete native child navigation/continuation/interruption UX remains incomplete.',
 'interactions-7':'$events readiness and ownership guards implemented; independent simulated multi-context cases passed, live multi-client handoff not exercised.',
 'right-pane-4':'Manual file refresh and version-consistent paged reads implemented; live file-change watcher not completed.',
 'right-pane-5':'Original diff/workbench panel not completed.',
 'right-pane-7':'Terminal runtime preserves existing device-owned inventory boundary; no real terminal attached/created as QA.',
 'right-pane-8':'General web preview entry exists; original sidebar browser navigation/pane integration is partial.',
 'settings-1':'General native settings implemented; other sections use partial compatibility pages/placeholders, whole navigation not accepted.',
 'settings-3':'Only Chinese native locale currently implemented; language change explicitly disabled.',
 'settings-4':'Private client theme choices implemented and persisted; complete source visual parity remains open.',
 'settings-6':'Detail/collapse/reply preferences implemented and consumed by native grouping; fixtures passed.',
 'settings-7':'Private code-work-view preference exists; full original workbench behavior incomplete.',
 'settings-8':'Shortcut reference view exists; editing/conflict-resolution UX is incomplete.',
 'settings-9':'Link-open preference exists; all browser/pane routing cases are not independently verified.',
 'settings-10':'Busy Enter preference is consumed by native composer policy; five mode fixtures passed, no live prompt sent.',
 'settings-11':'Preference exists, complete source usage-detail display is not implemented.',
 'settings-13':'Native client identity/version is shown separately; official Host updater/channel controls are not equivalent.',
 'plugins-4':'Reviewed enable/update wrappers have explicit frozen/capability gates; install/uninstall/discover and live mutations remain unqualified.',
 'plugins-7':'Bundled reviewed components are partial; arbitrary contributed slots/custom renderers are not reproduced.',
 'extra-1':'Projected Plan chip and Host command writer exist; full goal/plan presentation and actions remain partial.',
 'extra-2':'Read-only schedule wrappers exist; full automation catalog/history frontend is incomplete and GUI5 entry remained disabled.',
 'extra-3':'Remote command wrappers exist but installed schedule/create signature mismatch is a frozen compatibility boundary; no live schedules created.',
 'extra-4':'Authoritative preset header label exists; full preset-management/child/team configuration is incomplete and team setter is capability-disabled.',
 'extra-5':'Separate Remote account connection UI works; original account settings/feedback/notifications surface remains partial.',
};
for(const row of rows){if(reviewedSourceStatus[row.id]&&(row.currentNative.startsWith('pending implementation')||row.currentNative.startsWith('FAIL at baseline'))){if(row.currentNative.startsWith('FAIL'))row.baselineNative=row.currentNative;row.currentNative=reviewedSourceStatus[row.id];}if(row.currentNative.startsWith('pending implementation')&&(row.remoteSupport.startsWith('blocked:')||row.remoteSupport.startsWith('forbidden')))row.currentNative='Unavailable through the current frozen direct Remote surface; see exact constraint and conditional resource-carrier qualification.';}
const data={generatedAt:new Date().toISOString(),status:'NOT PARITY ACCEPTED',scope:'Source-grounded operation families. source-inventory.json records discovered packages, files, call sites and contributions for deeper coverage; dynamic third-party plugins cannot be exhaustively specified statically.',originalEvidenceDirectory:'/tmp/native-dsh-parity',guiReviews:guiRound1?['qa/parity-gui-round1.json']:[],viewport:{logical:[1280,820],physical:[2560,1640],theme:'dark'},testPolicy:{live:'Only passive reads and read-only UI navigation authorized in this audit',mutations:'Use fixture to verify exact wire and target identity. No live prompt/cancel/approve/rename/settings/new sessions.',performance:'M4 smoke and synthetic budget are developer evidence; M1 cross-machine CPU/memory still required'},priority:['Correct chat semantic projection and grouping','Dark theme and original shell/header/sidebar','Per-session draft/scroll, offline gating and operation target identity','Model/permission/queue/commands and real menus','Settings/plugins/files/terminal and hard capability boundaries'],hardFrozenBoundaries:rows.filter(r=>r.remoteSupport.startsWith('blocked:')||r.remoteSupport.startsWith('forbidden')).map(r=>r.id),rows};
data.guiReviews=[1,2,3,4,5,'5.1',6,'6.1',7,8,9].filter(n=>fs.existsSync(new URL(`./parity-gui-round${n}.json`,import.meta.url))).map(n=>`qa/parity-gui-round${n}.json`);
const round4=laterReviews.find(x=>x.n===4)?.value;
const composerReportURL=new URL('./composer-component-results.json',import.meta.url);
if(fs.existsSync(composerReportURL)){
 const report=JSON.parse(fs.readFileSync(composerReportURL,'utf8'));
 for(const row of rows.filter(row=>row.domain==='composer')){
  row.evidence.authorComponent={report:'qa/composer-component-results.json',status:'self-tested-partial',independentAcceptance:false,liveMutations:false};
  row.authorImplementation='See component report for exact implemented behavior and remaining gaps. Author fixtures do not supersede historical GUI failures or establish full parity.';
 }
 data.latestComposer={status:report.status,authorSelfTestGroups:report.commands.find(x=>x.testGroups)?.testGroups,independentGui:'pending',remaining:report.remaining,gui5SourceRepair:report.gui5SourceRepair};
}
if(round4){data.latestCandidate={sha256:round4.candidateNativeSha256,status:round4.status};data.startupDiagnosis=round4.startup;data.remaining=round4.remaining;data.referenceFontDefaults={evidence:round4.referenceFontEvidence,textSize:14,codeSize:11,terminalSize:13,textFamily:'',codeFamily:'',terminalFamily:''};}
const round5=laterReviews.find(x=>x.n===5)?.value;if(round5){data.latestCandidate={sha256:round5.candidateNativeSha256,status:round5.status};data.remaining=round5.remaining;}
const round51=laterReviews.find(x=>x.n==='5.1')?.value;if(round51){data.latestCandidate={sha256:round51.candidateNativeSha256,status:round51.status};data.remaining=round51.remaining;}

// Keep every historical failed subcheck; passing later slices qualify only the
// exact operations observed by the independent root GUI reviewer.
const inputSource={
 'composer-7':'Native File picture action, Host command menu and permission parameter picker implemented; author fixture-qualified, full original chip/menu parity remains incomplete.',
 'composer-8':'Inline pictures: native picker, rail/remove/lightbox, Host six-limit admission, bounded ImageIO thumbnails and strict actual RemoteAdapter carrier implemented; author fixtures only. Generic staged-file receipt remains unavailable.',
 'composer-9':'Framework PNG paste and local file drop intake implemented and author-tested; real macOS clipboard/drop GUI remains pending, no live upload performed.',
 'composer-10':'Native permission parameter picker has actual commands/execute branch and accepted-only captured draft settlement. Other rich parameter/chip branches incomplete.',
 'composer-11':'Scoped @file plus real Host sessionReferenceResolver/candidates canonical mentions implemented; author cross-layer fixtures, not live reference lookup or full rich-selection parity.'
};
for(const row of rows)if(inputSource[row.id])row.currentNative=inputSource[row.id];
const reviewMap={
 'terminal-real-empty-state':['right-pane-6','right-pane-7'], 'terminal-close':['right-pane-9'],
 'narrow-composer':['composer-3'], 'models-settings-read':['settings-1'],
 'preset-settings-read':['extra-4','settings-1'], 'settings-release':['settings-1'],
 'automation-read-filter':['extra-2'], 'split-model-popup':['composer-4','composer-5'],
 'settings-background-clip':['settings-1'], 'builtin-settings-route':['settings-1','plugins-3'],
 'settings-visual-clip':['settings-1'], 'plugin-settings-correct-page':['settings-1','plugins-3'],
 'plugin-inventory-interaction':['plugins-2','plugins-3'], 'settings-button-close':['settings-1'],
 'settings-wk-escape':['settings-1','shell-6'],
 'activation-auto-restore':['shell-2','composer-1','composer-2'],
 'settings-nested-escape':['settings-1','shell-6'],
 'narrow-chat-axis':['chat-11','composer-3'],
 'local-image-picker-preview-remove':['composer-7','composer-8'],
 'session-reference-draft':['composer-11'],
 'code-toolbar-icons':['chat-11','chat-12'],
 'narrow-table-clipping':['chat-11'],
 'reference-chip-presentation':['composer-11'],
 'header-preset-label':['header-1','extra-4'],
 'narrow-table-wrapping':['chat-11'],
 'complete-markdown-menu':['header-5'],
 'model-menu-read':['composer-4'],
 'forced-menu-placement-escape':['settings-1','plugins-3','shell-6'],
 'structured-replay-gallery':['chat-11'],
 'structured-replay-unknown-stop':['chat-8','chat-11'],
 'forced-dark-native-sidebar':['shell-1','settings-4']
};
for(const n of [6,'6.1',7,8,9]){
 const review=laterReviews.find(x=>x.n===n)?.value;if(!review)continue;
 for(const [field,status]of [['passedSubchecks','observed-passed-subcheck'],['failedSubchecks','observed-failed-subcheck']]){
  for(const check of review[field]??[]){for(const id of reviewMap[check.id]??[]){
   const row=rows.find(x=>x.id===id);if(!row)continue;
   row.evidence.nativeGui??={};row.evidence.nativeGui.retests??=[];
   row.evidence.nativeGui.retests.push({review:'qa/parity-gui-round'+n+'.json',candidateNativeSha256:review.candidateNativeSha256,finding:check.id,status,scope:check.detail,evidence:check.evidence??[],remaining:'Only this observed subcheck is qualified; full parity remains unaccepted.'});
   row.currentNative+=' GUI '+n+' '+check.id+': '+status+'.';
  }}
 }
 data.latestCandidate={sha256:review.candidateNativeSha256,status:review.status};data.remaining=review.remaining;
}
data.platformTarget={minimumMacOS:'15.8',architecture:'Apple Silicon',performanceTarget:'MacBook Air M1',qualification:'User-selected deployment target; no 15.8 or M1 acceptance implied. Earlier 13.x/14.x minimum-floor review retained as historical superseded target evidence.'};
data.sourceOnlyFollowups=['qa/chat-rows-budget-source-followup.json','qa/publisher-metadata-source-followup.json','qa/structured-publisher-source-followup.json'].filter(p=>fs.existsSync(new URL('../'+p,import.meta.url)));

fs.writeFileSync(new URL('./parity-matrix.json',import.meta.url),JSON.stringify(data,null,2)+'\n');
console.log(JSON.stringify({operationFamilies:rows.length,hardFrozenBoundaries:data.hardFrozenBoundaries,status:data.status}));
