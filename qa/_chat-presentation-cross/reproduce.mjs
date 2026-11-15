import {SessionProjection} from '../../remote/projection.mjs';
import {original,summary,ClientAssistantStream} from './build/original.mjs';
const e=(seq,type,data,surfaceOp)=>({type:'event',event:{seq,time:1700000000000+seq,type,data,...(surfaceOp?{surfaceOp}:{})}});
const opening=[e(0,'turn/start',{turn:1}),e(1,'step/start',{turn:1,step:1})];
const p=new SessionProjection('s'),fold=new ClientAssistantStream();p.snapshot({cursor:1,records:opening,assistantStream:{revision:0}});const a=original(fold.replace(opening));
for(const f of [{type:'start',revision:1,attemptId:'a',startedAfterSeq:1,turn:1,step:1},{type:'chunk',revision:2,attemptId:'a',index:0,time:1700000000002,chunk:{type:'tool-call-delta',index:0,id:'call',name:'read',argumentsDelta:'{}'}}]){const out=fold.acceptFrame(f);if(out?.entry)a.append(out.entry);p.frame(f);a.flush()}
for(const x of [e(2,'step/end',{turn:1,step:1}),e(3,'turn/end',{turn:1,reason:{kind:'aborted'}})]){const out=fold.acceptDurable(x);if(out?.entry)a.append(out.entry);a.flush();p.event(x.event)}
console.log(JSON.stringify({original:summary(a),current:p.value().chatPresentation},null,2));
