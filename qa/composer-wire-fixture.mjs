// Explicit local synthetic peer: real RemoteAdapter validation and ledger,
// mocked Host gateway, no network/authentication/identity or shell access.
import {createInterface} from 'node:readline';
import {RemoteAdapter} from '../remote/client.mjs';
const calls=[],requests=[];
const adapter=new RemoteAdapter(()=>{});
adapter.hostId='composer-host';adapter.connectionGeneration=7;adapter.interactionReady=true;
adapter.projection={sessionId:'composer-session'};adapter.sessionRows=[{id:'composer-session'}];
adapter.connected={client:{close:async()=>{}}};
let inbox=[{id:'q1',content:[{type:'text',text:'First queued input'}],source:{kind:'user'}},{id:'q2',content:[{type:'text',text:'Second queued input'}],source:{kind:'user'}}];
const projections=()=>({kind:'sequenced',asOfSeq:10,values:{permissions:{currentValue:'workspace-write'},modelSelection:{next:{provider:'fixture-provider',model:'fixture-model',reasoningEffort:'default'}},inbox:{'next-turn':inbox,'next-step':[]}}});
adapter.gateway={
 invoke:async({namespace,method,args})=>{
  calls.push({kind:'read',endpoint:namespace+'/'+method,args});
  if(namespace==='session'&&method==='projections')return projections();
  if(namespace==='session'&&method==='modelCatalog')return{default:{provider:'fixture-provider',model:'fixture-model'},groups:[{id:'fixture-provider',name:'Fixture Provider',models:[{id:'fixture-model',name:'Fixture Model',reasoning:{defaultEffort:'default',efforts:[{id:'default',name:'Default'}]}}]}]};
  if(namespace==='permissionPresets'&&method==='catalog')return{options:[{value:'read-only',name:'Read Only'},{value:'workspace-write',name:'Workspace Write'},{value:'danger-full-access',name:'Full Access'},{value:'auto',name:'auto'}]};
  if(namespace==='commands'&&method==='list')return[{definitionId:'fixture.permission',name:'permission',description:'Fixture permission command'},{definitionId:'fixture.help',name:'help',description:'Fixture help'}];
  if(namespace==='fileReferences'&&method==='list')return[{path:'docs/中文 file.md',kind:'file'},{path:'docs/with space',kind:'directory'}];
  throw Error('Unexpected fixture read '+namespace+'/'+method);
 },
 dispatch:async(endpoint,payload)=>{
  calls.push({kind:'write',endpoint,args:payload.args});
  if(endpoint==='commands/execute'){
   if(payload.args.line==='/unknown')throw Error('Explicit fixture lost receipt');
   if(payload.args.line==='/reject')return{ok:false,error:{code:'fixture/rejected',message:'Explicit fixture rejected'}};
   return{ok:true,value:{matched:true,result:{kind:'success'}}};
  }
  if(endpoint==='session/updateQueue'){
   const req=payload.args.request;
   if(req.action.kind==='remove'||req.action.kind==='steer')inbox=inbox.filter(row=>row.id!==req.itemId);
   else inbox=inbox.map(row=>row.id===req.itemId?{...row,content:req.action.content}:row);
   return{ok:true,value:{updated:true}};
  }
  if(endpoint==='session/prompt'||endpoint==='session/cancel')return{ok:true,value:{fixture:true}};
  throw Error('Unexpected fixture dispatch '+endpoint);
 }
};
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
input.on('line',async line=>{const req=JSON.parse(line);try{
 if(req.method==='fixture.calls'){process.stdout.write(JSON.stringify({id:req.id,result:{calls,requests}})+'\n');return}
 if(req.method==='fixture.reset'){calls.length=0;requests.length=0;process.stdout.write(JSON.stringify({id:req.id,result:{reset:true}})+'\n');return}
 if(req.method==='fixture.select'){adapter.projection.sessionId=req.params.sessionId;adapter.sessionRows=[{id:req.params.sessionId}];process.stdout.write(JSON.stringify({id:req.id,result:{selected:true}})+'\n');return}
 requests.push({method:req.method,params:req.params});
 const result=await adapter.request(req.method,req.params??{});
 process.stdout.write(JSON.stringify({id:req.id,result})+'\n');
 }catch(error){process.stdout.write(JSON.stringify({id:req.id,error:{code:error.code??'FIXTURE_ERROR',message:error.message,delivery:error.delivery}})+'\n')}});
input.on('close',()=>{adapter.projection=undefined;void adapter.close()});
