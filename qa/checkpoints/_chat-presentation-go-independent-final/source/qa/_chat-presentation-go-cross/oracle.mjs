import {SessionProjection} from '../../remote/projection.mjs';
import {PresentationPublisher} from '../../remote/updates.mjs';
import {original,summary,ClientAssistantStream} from '../_chat-presentation-cross/build/original.mjs';
const ev=(seq,type,data,surfaceOp)=>({seq,time:1700000000000+seq,type,data,...(surfaceOp?{surfaceOp}:{})});const row=event=>({type:'event',event});
const events=[ev(0,'turn/start',{turn:1}),ev(1,'step/start',{turn:1,step:1}),ev(2,'user/message',{id:'opening',source:{kind:'user'},content:[{type:'text',text:'Opening input'}]},'append')];
const p=new SessionProjection('go-cross'),fold=new ClientAssistantStream();p.snapshot({cursor:2,records:events.map(row),assistantStream:{revision:0}});const a=original(fold.replace(events.map(row)));let notes=[];const pub=new PresentationPublisher((method,params)=>notes.push({method,params}));pub.replace(p.value());notes.push({method:'snapshot',params:p.value()});const stages=[];
function apply(out){if(!out)return;if(out.type==='publish'||out.type==='transient'){a.append(out.entry);if(out.retireAttemptId)a.settleAssistant(out.retireAttemptId)}else if(out.type==='settlement')a.settleAssistant(out.attemptId,out.entry);else if(out.type==='abandonment')a.settleAssistant(out.attemptId);else throw Error('rebaseline');a.flush()}
function stage(name){pub.patch(p.pullUpdates());const source=summary(a);const expected=source.nodes.filter(n=>n.visibility==='visible'&&['user','assistant-step'].includes(n.kind)).sort((a,b)=>a.anchorSeq-b.anchorSeq).map(n=>n.kind==='assistant-step'?n.key+'/response':`event:${n.anchorSeq}/`);stages.push({name,notifications:JSON.parse(JSON.stringify(notes)),expected,snapshot:p.value()});notes=[]}
stage('initial');
for(const f of [{type:'start',revision:1,attemptId:'a',startedAfterSeq:2,turn:1,step:1},{type:'chunk',revision:2,attemptId:'a',index:0,time:1700000000003,chunk:{type:'text-delta',index:0,text:'Visible live reply'}}]){apply(fold.acceptFrame(f));p.frame(f)}
const steer=ev(3,'user/message',{id:'steer',source:{kind:'user'},content:[{type:'text',text:'Interleaved input'}]},'append');apply(fold.acceptDurable(row(steer)));p.event(steer);stage('live-with-input');
const durable=ev(4,'assistant/message',{turn:1,step:1,message:{id:'committed-assistant',source:{kind:'model',provider:'fixture',model:'fixture'},content:[{type:'text',text:'Settled visible reply'}]},stream:[]},'append');apply(fold.acceptDurable(row(durable)));p.event(durable);stage('staged');
const end={type:'end',revision:3,attemptId:'a',index:1,outcome:{kind:'committed',seq:4,eventType:'assistant/message'}};apply(fold.acceptFrame(end));p.frame(end);stage('retained');
const stepEnd=ev(5,'step/end',{turn:1,step:1});apply(fold.acceptDurable(row(stepEnd)));p.event(stepEnd);stage('released');
const turnEnd=ev(6,'turn/end',{turn:1,reason:{kind:'completed'}});apply(fold.acceptDurable(row(turnEnd)));p.event(turnEnd);stage('closed');
console.log(JSON.stringify({stages}));
