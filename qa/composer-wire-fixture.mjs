// Explicit local synthetic peer: real RemoteAdapter validation and ledger,
// mocked Host gateway, no network/authentication/identity or shell access.
import {createInterface} from 'node:readline';
import {RemoteAdapter} from '../remote/client.mjs';
const calls=[],requests=[];
const adapter=new RemoteAdapter(()=>{});
adapter.hostId='composer-host';adapter.connectionGeneration=7;adapter.interactionReady=true;
const imageLimits={maxImageBytes:262144,maxImagesPerMessage:4,maxMessageImageBytes:524288,maxImagePixels:1048576,maxImageDimension:1024,mediaTypes:['image/png','image/jpeg','image/webp','image/gif']};
adapter.projection={sessionId:'composer-session',projections:{asOfSeq:10,values:{imageLimits}}};adapter.sessionRows=[{id:'composer-session'}];
adapter.connected={client:{close:async()=>{}}};
let permission='workspace-write';
let releasePrompt,promptEntered;
const promptStarted=new Promise(resolve=>promptEntered=resolve);
let inbox=[{id:'q1',content:[{type:'text',text:'First queued input'}],source:{kind:'user'}},{id:'q2',content:[{type:'text',text:'Second queued input'}],source:{kind:'user'}}];
const projections=()=>({kind:'sequenced',asOfSeq:10,values:{imageLimits,permissions:{currentValue:permission},modelSelection:{next:{provider:'fixture-provider',model:'fixture-model',reasoningEffort:'default'}},inbox:{'next-turn':inbox,'next-step':[]}}});
adapter.gateway={
 invoke:async({namespace,method,args})=>{
  calls.push({kind:'read',endpoint:namespace+'/'+method,args});
  if(namespace==='session'&&method==='projections')return projections();
  if(namespace==='session'&&method==='modelCatalog')return{default:{provider:'fixture-provider',model:'fixture-model'},groups:[{id:'fixture-provider',name:'Fixture Provider',models:[{id:'fixture-model',name:'Fixture Model',reasoning:{defaultEffort:'default',efforts:[{id:'default',name:'Default'}]}}]}]};
  if(namespace==='permissionPresets'&&method==='catalog')return{options:[{value:'read-only',name:'Read Only'},{value:'workspace-write',name:'Workspace Write'},{value:'danger-full-access',name:'Full Access'},{value:'auto',name:'auto'}]};
  if(namespace==='commands'&&method==='list')return[{definitionId:'fixture.permission',name:'permission',description:'Fixture permission command'},{definitionId:'fixture.help',name:'help',description:'Fixture help'}];
  if(namespace==='fileReferences'&&method==='list')return[{path:'docs/中文 file.md',kind:'file'},{path:'docs/with space',kind:'directory'}];
  if(namespace==='sessionReferenceResolver'&&method==='candidates')return[{sessionId:'other-session',label:'Fixture source',displayTitle:'Fixture source',sameWorkspace:true,createdAt:1,mention:'@[Fixture source](dsh-session:'+Buffer.from(JSON.stringify('other-session')).toString('base64url')+')'}];
  throw Error('Unexpected fixture read '+namespace+'/'+method);
 },
 dispatch:async(endpoint,payload)=>{
  calls.push({kind:'write',endpoint,args:payload.args});
  if(endpoint==='commands/execute'){
   if(payload.args.line==='/unknown')throw Error('Explicit fixture lost receipt');
   if(payload.args.line==='/reject')return{ok:false,error:{code:'fixture/rejected',message:'Explicit fixture rejected'}};
   // The frozen Host answers with the settled execution, and with no value when the
   // line names no command. `{matched}` is the Web client's own shorthand, never a
   // field of this wire.
   if(payload.args.line==='/unresolved')return{ok:true,value:undefined};
   if(payload.args.line.startsWith('/permission '))permission=payload.args.line.slice('/permission '.length);
   return{ok:true,value:{commandId:'fixture-command-1',result:{kind:'success'}}};
  }
  if(endpoint==='session/updateQueue'){
   const req=payload.args.request;
   if(req.action.kind==='remove'||req.action.kind==='steer')inbox=inbox.filter(row=>row.id!==req.itemId);
   else inbox=inbox.map(row=>row.id===req.itemId?{...row,content:req.action.content}:row);
   return{ok:true,value:{updated:true}};
  }
  if(endpoint==='session/prompt'){
   if(payload.args.request.content?.some(x=>x.text==='fixture delayed image')){promptEntered();await new Promise(resolve=>releasePrompt=resolve);}
   if(payload.args.request.content?.some(x=>x.text==='fixture image unknown'))throw Error('Fixture image receipt lost');
   return{ok:true,value:{fixture:true}};
  }
  if(endpoint==='session/cancel')return{ok:true,value:{fixture:true}};
  throw Error('Unexpected fixture dispatch '+endpoint);
 }
};
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
input.on('line',async line=>{const req=JSON.parse(line);try{
 if(req.method==='fixture.calls'){process.stdout.write(JSON.stringify({id:req.id,result:{calls,requests}})+'\n');return}
 if(req.method==='fixture.waitPrompt'){await promptStarted;process.stdout.write(JSON.stringify({id:req.id,result:true})+'\n');return}
 if(req.method==='fixture.releasePrompt'){releasePrompt?.();process.stdout.write(JSON.stringify({id:req.id,result:true})+'\n');return}
 if(req.method==='fixture.reset'){calls.length=0;requests.length=0;process.stdout.write(JSON.stringify({id:req.id,result:{reset:true}})+'\n');return}
 if(req.method==='fixture.select'){adapter.projection.sessionId=req.params.sessionId;adapter.sessionRows=[{id:req.params.sessionId}];process.stdout.write(JSON.stringify({id:req.id,result:{selected:true}})+'\n');return}
 requests.push({method:req.method,params:req.params});
 const result=await adapter.request(req.method,req.params??{});
 process.stdout.write(JSON.stringify({id:req.id,result})+'\n');
 }catch(error){process.stdout.write(JSON.stringify({id:req.id,error:{code:error.code??'FIXTURE_ERROR',message:error.message,delivery:error.delivery}})+'\n')}});
input.on('close',()=>{adapter.projection=undefined;void adapter.close()});
