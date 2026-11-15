import test from 'node:test';
import assert from 'node:assert/strict';
const {SessionProjection} = await import(process.env.CROSS_PROJECTION_BUNDLE || '../remote/projection.mjs');
import {PresentationPublisher} from '../remote/updates.mjs';
import {RemoteAdapter} from '../remote/client.mjs';
import {original,summary,ClientAssistantStream,contextProducer,contextForm,toAssistantBlocks} from './_chat-presentation-cross/build/original.mjs';
const ev=(seq,type,data,surfaceOp)=>({seq,time:1700000000000+seq,type,data,...(surfaceOp?{surfaceOp}:{})});
const row=event=>({type:'event',event});const text=text=>({type:'text',text});
const assistant=(seq,content,step=1,surfaceOp='append')=>ev(seq,'assistant/message',{turn:1,step,message:{id:'m'+seq,role:'assistant',source:{kind:'model',provider:'fixture',model:'fixture'},content},stream:[]},surfaceOp);
const user=(seq,value)=>ev(seq,'user/message',{id:'u'+seq,role:'user',source:{kind:'user'},content:[text(value)]},'append');
const opening=[ev(0,'turn/start',{turn:1}),ev(1,'step/start',{turn:1,step:1}),user(2,'first')];
const baseline=events=>({type:'snapshot',cursor:events.at(-1)?.seq??-1,records:events.map(row),assistantStream:{revision:0}});
function equal(p,a,label){
 const old=summary(a),current=p.value(),chat=current.chatPresentation;
 assert.deepEqual(chat.turns.find(t=>t.turn===1)?.spec??null,old.process??null,label+' process');
 const expected=old.nodes.filter(n=>n.kind==='assistant-step'&&n.visibility==='visible');
 const actual=chat.steps.map(s=>({key:s.nodeKey,status:s.status,anchor:s.anchorSeq,final:s.finalEventSeq}));
 assert.deepEqual(actual.sort((a,b)=>a.key.localeCompare(b.key)),expected.map(n=>({key:n.key,status:n.status,anchor:n.anchorSeq,final:Number.isSafeInteger(n.final?.seq)?n.final.seq:null})).sort((a,b)=>a.key.localeCompare(b.key)),label+' visible assistant nodes');
 for(const x of expected){const s=chat.steps.find(s=>s.nodeKey===x.key),m=current.messages.find(m=>m.id===s.payloadId);assert.ok(m,label+' payload ref');assert.deepEqual(m.assistantBlocks,x.blocks,label+' exact blocks')}
}
function streaming(events=opening){const fold=new ClientAssistantStream(),p=new SessionProjection('cross');p.snapshot(baseline(events));const a=original(fold.replace(events.map(row)));let rev=0,index=0;
 const apply=out=>{if(!out)return;if(out.type==='publish'||out.type==='transient'){a.append(out.entry);if(out.retireAttemptId)a.settleAssistant(out.retireAttemptId)}else if(out.type==='settlement')a.settleAssistant(out.attemptId,out.entry);else if(out.type==='abandonment')a.settleAssistant(out.attemptId);else throw Error('oracle rebaseline');a.flush()};
 return{p,a,start(){const f={type:'start',revision:++rev,attemptId:'a',startedAfterSeq:events.at(-1).seq,turn:1,step:1};apply(fold.acceptFrame(f));p.frame(f)},chunk(chunk){const f={type:'chunk',revision:++rev,attemptId:'a',index:index++,time:1700000000003,chunk};apply(fold.acceptFrame(f));p.frame(f)},event(e){apply(fold.acceptDurable(row(e)));p.event(e)},end(outcome){const f={type:'end',revision:++rev,attemptId:'a',index,outcome};apply(fold.acceptFrame(f));p.frame(f)}}
}
test('pinned actual oracle preserves first/old/last for model-surface replacement; old independent QA stays unchanged',()=>{
 const events=[...opening,assistant(3,[text('old')]),user(4,'last'),assistant(5,[text('new')],1,{op:'replace',startSeq:3,endSeq:3})],p=new SessionProjection('replacement');p.snapshot(baseline(events));const a=original(events.map(row));equal(p,a,'replace');
 const expected=summary(a).nodes.filter(n=>['user','assistant-step'].includes(n.kind)&&n.visibility==='visible').sort((a,b)=>a.anchorSeq-b.anchorSeq).map(n=>n.kind==='assistant-step'?n.blocks.map(b=>b.text??'').join(''):events.find(e=>e.seq===n.anchorSeq).data.content[0].text);
 assert.deepEqual(expected,['first','old','last']);assert.deepEqual(p.value().messages.map(m=>m.text),expected);
});
test('retry resets current state but preserves process evidence/counts through new chunks and abandonment',()=>{
 const s=streaming();s.start();s.chunk({type:'text-delta',index:0,text:'prior'});equal(s.p,s.a,'visible before retry');s.event(ev(3,'llm/retry',{turn:1,step:1,reason:{kind:'retry'}}));equal(s.p,s.a,'reset');s.chunk({type:'reasoning-delta',index:0,text:'next'});equal(s.p,s.a,'new reasoning');s.end({kind:'abandoned'});equal(s.p,s.a,'abandoned');
});
test('tool-only stream followed by closed boundary retains original interrupted step without final-answer qualification',()=>{
 const s=streaming(opening.slice(0,2));s.start();s.chunk({type:'tool-call-delta',index:0,id:'call',name:'read',argumentsDelta:'{}'});s.event(ev(2,'step/end',{turn:1,step:1}));s.event(ev(3,'turn/end',{turn:1,reason:{kind:'aborted'}}));equal(s.p,s.a,'tool-only closed');assert.equal(s.p.value().chatPresentation.turns[0].spec.answerStep,null);
});
test('durable staged->successful retained->step end and raw timeline patch share an atomic baseline revision',()=>{
 const s=streaming(),notes=[],pub=new PresentationPublisher((method,params)=>notes.push({method,params}));pub.replace(s.p.value());s.start();s.chunk({type:'text-delta',index:0,text:'live'});pub.patch(s.p.pullUpdates());equal(s.p,s.a,'live');const before=s.p.value().chatPresentation.steps[0].anchorSeq;
 s.event(assistant(3,[text('final')]));pub.patch(s.p.pullUpdates());equal(s.p,s.a,'staged');s.end({kind:'committed',seq:3,eventType:'assistant/message'});pub.patch(s.p.pullUpdates());equal(s.p,s.a,'retained');assert.equal(s.p.value().chatPresentation.steps[0].anchorSeq,before);
 s.event(ev(4,'step/end',{turn:1,step:1}));s.event(ev(5,'turn/end',{turn:1,reason:{kind:'completed'}}));pub.patch(s.p.pullUpdates());equal(s.p,s.a,'step release');const patch=notes.filter(n=>n.method==='chatPresentationPatch').at(-1).params;assert.equal(patch.timelineTurnUpserts[0].status,'closed');assert.equal(patch.turnUpserts[0].status,'closed');assert.equal(patch.stepUpserts[0].anchorSeq,3);assert.equal(patch.presentationRevision,patch.baseRevision+1);assert.ok(!notes.some(n=>['messageUpsert','messageRemove'].includes(n.method)));
});
test('initial and older-page actual adapter publish baseline before all patches and before RPC completion',async()=>{
 const notes=[],a=new RemoteAdapter((method,params)=>notes.push({method,params}));a.sessionRows=[{id:'s'}];let release;const held=new Promise(r=>release=r);a.gateway={async open(){return(async function*(){yield baseline(opening.slice(1));yield{type:'event',event:assistant(3,[text('done')])};await held})()},async invoke(){return{records:[row(opening[0])],hasMore:false}}};
 try{const initial=await a.openSession('s');notes.push({method:'openRpc',params:initial});await new Promise(r=>setTimeout(r,35));const page=await a.history({});notes.push({method:'historyRpc',params:page});a.projection.event(ev(4,'step/end',{turn:1,step:1}));a.scheduleSnapshot();await new Promise(r=>setTimeout(r,35));let active;for(const n of notes){if(n.method==='snapshot')active=n.params.chatPresentation.baselineSerial;if(['chatPresentationPatch','messageDelta','sessionState','trajectoryUpsert'].includes(n.method))assert.equal(n.params.baselineSerial,active,n.method+' requires prior baseline')}assert.equal(notes[0].method,'snapshot');for(const method of ['openRpc','historyRpc']){const index=notes.findIndex(n=>n.method===method),serial=notes[index].params.chatPresentation.baselineSerial;assert.ok(notes.slice(0,index).some(n=>n.method==='snapshot'&&n.params.chatPresentation.baselineSerial===serial))}assert.ok(page.chatPresentation.baselineSerial>initial.chatPresentation.baselineSerial)}finally{a.followStop?.abort();a.lifetime.abort();release();clearTimeout(a.snapshotTimer)}
});
test('source body classifier/structured blocks equal pinned direct source including opaque unknown values',()=>{
 const sources=[{kind:'agent-instructions',changes:[{path:'A'},{path:'A'},{path:'B'}],form:'instructions'},{kind:'session-reference',references:[{label:'one'},{label:'two'}],form:'recall'},{kind:'skill-invocation',name:'fixture'},{kind:'future-producer',form:'future-form'},{kind:'retry'},null];
 for(const [i,source]of sources.entries()){const p=new SessionProjection('classify');p.snapshot(baseline([ev(i,'user/message',{id:'u'+i,source,content:[text('opaque')]},'append')]));const m=p.value().messages[0];assert.deepEqual(m.context.producer,contextProducer(source));assert.equal(m.context.form,contextForm(source))}
 const blocks=[text('A'),{type:'reasoning',text:'r'},{type:'image',attachment:{attachmentId:'i',mediaType:'image/png',bytes:1,width:1,height:1}},{type:'file',attachment:{attachmentId:'f',bytes:1,name:'f'}},{type:'future',data:{x:1}}],p=new SessionProjection('blocks');p.snapshot(baseline([...opening,assistant(3,blocks)]));assert.deepEqual(p.value().messages.at(-1).assistantBlocks,toAssistantBlocks(blocks));
});
test('100 token suffixes neither read historical source body nor iterate retained historical arenas',()=>{
 const events=[ev(0,'turn/start',{turn:1})];for(let i=0;i<1000;i++)events.push(ev(events.length,'step/start',{turn:1,step:i+1}),assistant(events.length+1,[text('private-history-'+i)],i+1),ev(events.length+2,'step/end',{turn:1,step:i+1}));const p=new SessionProjection('cost');p.snapshot(baseline(events));const notes=[],pub=new PresentationPublisher((method,params)=>notes.push({method,params}));pub.replace(p.value());
 const originalVersions=[...p.messages.values()];for(const m of originalVersions){for(const name of ['blocks','assistantBlocks','text','reasoning']){const v=m[name];Object.defineProperty(m,name,{get(){throw Error('historical body read '+name)},enumerable:true,configurable:true})}}
 for(const map of [p.events,p.messages,p.trajectory])for(const key of ['values','keys','entries',Symbol.iterator])map[key]=()=>{throw Error('retained arena scanned')};
 let revision=0;p.frame({type:'start',revision:++revision,attemptId:'cost',startedAfterSeq:p.cursor,turn:1,step:1001});for(let i=0;i<100;i++){p.frame({type:'chunk',revision:++revision,attemptId:'cost',index:i,chunk:{type:'text-delta',index:0,text:'x'}});pub.patch(p.pullUpdates())}
 assert.equal(notes.filter(n=>n.method==='chatPresentationPatch').length,1);assert.equal(notes.filter(n=>n.method==='messageDelta').length,99);const wire=JSON.stringify(notes);assert.ok(!wire.includes('private-history-'));assert.ok(Buffer.byteLength(wire)<50000);
});

test('transient block-start uses pinned empty-block classifier before canonical block-end',async t=>{
 for(const blockType of ['tool-call','image','file']) await t.test(blockType,()=>{
  const s=streaming();s.start();s.chunk({type:'text-delta',index:0,text:'visible'});s.chunk({type:'block-start',index:1,blockType});equal(s.p,s.a,'pending '+blockType);
  const block=blockType==='tool-call'?{type:blockType,id:'call',name:'read',arguments:'{"canonical":true}'}:blockType==='image'?{type:blockType,attachment:{attachmentId:'i',mediaType:'image/png',bytes:1,width:1,height:1}}:{type:blockType,attachment:{attachmentId:'f',name:'f',bytes:1}};
  s.chunk({type:'block-end',index:1,block});equal(s.p,s.a,'canonical '+blockType);
 });
});
