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
const laterReviews=[3,4,5].map(n=>{const url=new URL(`./parity-gui-round${n}.json`,import.meta.url);return fs.existsSync(url)?{n,value:JSON.parse(fs.readFileSync(url,'utf8'))}:null}).filter(Boolean);
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
 }
}
const composerSourceStatus={1:'Host/account/session draft map and accepted-intent settlement implemented; fixture-qualified, persistence/restart parity partial.',2:'Per-session scroll state and navigation generation implemented; fixture-qualified, full restoration behavior not independently accepted.',3:'Native multiline/marked-text keyboard handling implemented and framework-fixture tested; round5 narrow-width failure and platform IME GUI remain open.',4:'Native trigger + original WK model panes implemented; round5 anchor passed, trigger/provider caption and WK fallback failed; source repairs await GUI.',5:'Original reasoning pane exists; native Default/named/retained-effort source fix tested, actual new package pending.',6:'Authoritative permission catalog/current value and command writer + risk gate implemented. Round5 wording failed; source-only label fix pending GUI.',7:'Native Host command text-completion exists; original plus-menu File/client actions and complete popup/chip parity remain incomplete.',8:'Not implemented: original composer attachment upload/preview/retry. Unsupported File effect is explicitly blocked and draft preserved.',9:'Not implemented: original image/file drag-paste intake.',10:'Host command execution and text completion implemented; original claim chips/parameter popup behavior incomplete; client-only effects blocked.',11:'Scoped @file path completion and quoted Unicode grammar implemented; original rich references/conversation-reference features incomplete.',12:'Idle/busy queue-steer keyboard policy implemented; five policy fixtures passed; no live prompt sent.',13:'Projected next-turn queue edit/remove/steer controls implemented and fixture checked; original complete queue presentation still unaccepted.',14:'Ordinary prompt and typed-command accepted receipts settle only captured account/Host/session matching draft; late receipt fixtures passed.',15:'Unknown prompt/command receipt preserves draft and stable intent and blocks blind redispatch; fixtures passed.',16:'Stop control uses scoped cancel mutation with stable receipt handling; no live cancellation exercised.',17:'Offline/write and scoped-read guards implemented. Round5 early-read race failed, source read-epoch repair fixture passed; packaged reconnect GUI pending.'};
for(const row of rows.filter(r=>r.domain==='composer'))row.currentNative=composerSourceStatus[Number(row.id.split('-').at(-1))];
const data={generatedAt:new Date().toISOString(),status:'NOT PARITY ACCEPTED',scope:'Source-grounded operation families. source-inventory.json records discovered packages, files, call sites and contributions for deeper coverage; dynamic third-party plugins cannot be exhaustively specified statically.',originalEvidenceDirectory:'/tmp/native-dsh-parity',guiReviews:guiRound1?['qa/parity-gui-round1.json']:[],viewport:{logical:[1280,820],physical:[2560,1640],theme:'dark'},testPolicy:{live:'Only passive reads and read-only UI navigation authorized in this audit',mutations:'Use fixture to verify exact wire and target identity. No live prompt/cancel/approve/rename/settings/new sessions.',performance:'M4 smoke and synthetic budget are developer evidence; M1 cross-machine CPU/memory still required'},priority:['Correct chat semantic projection and grouping','Dark theme and original shell/header/sidebar','Per-session draft/scroll, offline gating and operation target identity','Model/permission/queue/commands and real menus','Settings/plugins/files/terminal and hard capability boundaries'],hardFrozenBoundaries:rows.filter(r=>r.remoteSupport.startsWith('blocked:')||r.remoteSupport.startsWith('forbidden')).map(r=>r.id),rows};
data.guiReviews=[1,2,3,4,5].filter(n=>fs.existsSync(new URL(`./parity-gui-round${n}.json`,import.meta.url))).map(n=>`qa/parity-gui-round${n}.json`);
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
fs.writeFileSync(new URL('./parity-matrix.json',import.meta.url),JSON.stringify(data,null,2)+'\n');
console.log(JSON.stringify({operationFamilies:rows.length,hardFrozenBoundaries:data.hardFrozenBoundaries,status:data.status}));
