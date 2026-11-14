import test from 'node:test';
import assert from 'node:assert/strict';
import {RemoteAdapter} from '../remote/client.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const until=async(check)=>{for(let i=0;i<100;i++){if(check())return;await tick();}assert.fail('fixture did not settle');};

function peer(t){
 const events=[],calls=[],a=new RemoteAdapter((method,params)=>events.push({method,params}));
 a.hostId='qa-host';a.connectionGeneration=3;a.interactionReady=true;a.projection={sessionId:'qa-session'};
 a.connected={features:{terminal:true},client:{close:async()=>{}}};
 let active=0,opened=0;
 a.gateway={open:async function*(endpoint,args,signal){opened++;active++;try{yield{type:'fixture-baseline',endpoint};await new Promise(resolve=>signal.aborted?resolve():signal.addEventListener('abort',resolve,{once:true}));}finally{active--;}},dispatch:async(endpoint,args,signal)=>{calls.push({endpoint,args,signal});return{ok:true,value:{}};}};
 const scope={hostId:'qa-host',generation:3,sessionId:'qa-session'};
 const owner=async(id)=>{await a.request('registerOwner',{ownerId:id,clientScope:scope});return{...scope,ownerId:id};};
 t.after(async()=>{a.projection=undefined;await a.close();});
 return{a,scope,owner,events,calls,active:()=>active,opened:()=>opened};
}

test('independent 20 mixed page lifetimes retire owners, iterators, stream contexts and input state',async t=>{
 const f=peer(t);
 for(let i=0;i<20;i++){
  const ownerId='qa-window-'+i,clientScope=await f.owner(ownerId);
  await f.a.request('watchSession',{sessionId:'qa-session',clientScope});
  await f.a.request('watchTerminal',{sessionId:'qa-session',terminalId:'term',attachmentId:'attachment-'+i,clientScope});
  await until(()=>f.active()===2);
  await f.a.request('writeTerminal',{sessionId:'qa-session',terminalId:'term',attachmentId:'attachment-'+i,clientScope,inputSequence:1,data:'fixture-only',requestId:'qa-input-operation-'+i});
  const prior=f.events.length;await f.a.request('closeOwnerStreams',{ownerId});await until(()=>f.active()===0);await tick();
  assert.equal(f.events.length,prior,'destroyed window emitted a late frame');
  assert.deepEqual(await f.a.request('runtimeStats'),{owners:0,streams:0,terminalInputAttachments:0,durableReceipts:0});
  assert.equal(f.a.streamContexts.size,0);
 }
 assert.equal(f.opened(),40);
});

test('closing before deferred stream open never touches the carrier',async t=>{
 const f=peer(t),clientScope=await f.owner('qa-before-open');
 await f.a.request('watchSession',{sessionId:'qa-session',clientScope});
 await f.a.request('closeOwnerStreams',{ownerId:clientScope.ownerId});await tick();
 assert.equal(f.opened(),0);assert.equal(f.events.length,0);assert.equal(f.a.streams.size,0);
});

test('same owner label cannot revive a queued write after its ticket was destroyed',async t=>{
 const f=peer(t),clientScope=await f.owner('qa-reused-label');
 const pending=f.a.request('mutateSettings',{ns:'permission',ops:[],expectedRevision:1,requestId:'qa-reused-owner-write',clientScope});
 const rejected=assert.rejects(pending,{code:'STALE_CONTEXT',delivery:'rejected'});
 void f.a.request('closeOwnerStreams',{ownerId:clientScope.ownerId});
 await f.a.request('registerOwner',{ownerId:clientScope.ownerId,clientScope:f.scope});
 await rejected;assert.equal(f.calls.length,0);
});

test('queued Host write and stale scope reject before dispatch after Host replacement',async t=>{
 const f=peer(t),clientScope=await f.owner('qa-old-host');
 const pending=f.a.request('mutateSettings',{ns:'permission',ops:[],requestId:'qa-host-race-write-001',clientScope});
 const rejected=assert.rejects(pending,{code:'STALE_CONTEXT',delivery:'rejected'});
 let newCalls=0;f.a.hostId='qa-new-host';f.a.connectionGeneration++;f.a.gateway={dispatch:async()=>{newCalls++;return{ok:true,value:{}};}};
 await rejected;await assert.rejects(f.a.request('mutateSettings',{ns:'permission',ops:[],requestId:'qa-host-race-write-002',clientScope}),{code:'STALE_CONTEXT',delivery:'rejected'});
 assert.equal(f.calls.length,0);assert.equal(newCalls,0);
});

test('one scoped page cannot close another page stream',async t=>{
 const f=peer(t),first=await f.owner('qa-owner-one'),second=await f.owner('qa-owner-two');
 const stream=await f.a.request('watchSession',{sessionId:'qa-session',clientScope:first});await until(()=>f.active()===1);
 await assert.rejects(f.a.request('closeStream',{subscriptionId:stream.subscriptionId,clientScope:second}),{code:'PERMISSION_DENIED',delivery:'rejected'});
 assert.equal(f.a.streams.size,1);await f.a.request('closeOwnerStreams',{ownerId:first.ownerId});await until(()=>f.active()===0);
});

test('explicit Host rejection is rejected while transport uncertainty remains cached unknown',async t=>{
 const f=peer(t),clientScope=await f.owner('qa-receipts');let dispatches=0;
 f.a.gateway.dispatch=async()=>{dispatches++;return{ok:false,error:{code:'settings/conflict',message:'fixture revision changed'}};};
 const rejected={ns:'permission',ops:[],expectedRevision:1,requestId:'qa-settings-rejected-001',clientScope};
 await assert.rejects(f.a.request('mutateSettings',rejected),{code:'settings/conflict',delivery:'rejected'});await assert.rejects(f.a.request('mutateSettings',rejected),{code:'settings/conflict'});assert.equal(dispatches,1);
 f.a.gateway.dispatch=async()=>{dispatches++;throw Error('fixture lost receipt');};
 const unknown={...rejected,requestId:'qa-settings-unknown-0001'};
 assert.equal((await f.a.request('mutateSettings',unknown)).status,'unknown');assert.equal((await f.a.request('mutateSettings',unknown)).status,'unknown');assert.equal(dispatches,2);
});

test('owner teardown aborts an in-flight setting carrier and never retries it',async t=>{
 const f=peer(t),clientScope=await f.owner('qa-inflight');let started=false,aborted=false,dispatches=0;
 f.a.gateway.dispatch=async(_endpoint,_args,signal)=>{started=true;dispatches++;await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('fixture owner closed'));},{once:true}));};
 const pending=f.a.request('mutateSettings',{ns:'permission',ops:[],requestId:'qa-inflight-setting-01',clientScope});await until(()=>started);
 await f.a.request('closeOwnerStreams',{ownerId:clientScope.ownerId});assert.equal((await pending).status,'unknown');assert.equal(aborted,true);assert.equal(dispatches,1);assert.equal(f.a.owners.size,0);
});

test('read-only mode fences special terminal input independently of readiness',async t=>{
 const f=peer(t),clientScope=await f.owner('qa-readonly-input');const params={sessionId:'qa-session',terminalId:'term',attachmentId:'a',clientScope};
 await f.a.request('watchTerminal',params);await until(()=>f.active()===1);f.a.readOnly=true;
 await assert.rejects(f.a.request('writeTerminal',{...params,inputSequence:1,data:'fixture-only',requestId:'qa-readonly-input-001'}),{code:'READ_ONLY',delivery:'rejected'});
 assert.equal(f.calls.length,0);
});
