// Root-owned independent source oracle. Synthetic events, never a Host replay.
import { SessionProjection } from '../remote/projection.mjs';
import { original, summary } from './_chat-process-audit/build/original.mjs';
const rec = (seq,type,data,surfaceOp) => ({type:'event',event:{seq,time:1700000000000+seq,type,data,...(surfaceOp?{surfaceOp}:{})}});
const text=text=>({type:'text',text});
const assistant=(seq,step,content,surfaceOp='append')=>rec(seq,'assistant/message',{turn:1,step,message:{id:'root-committed-'+seq,role:'assistant',source:{kind:'model',provider:'fixture-provider',model:'fixture-model'},content},stream:[]},surfaceOp);
const start=[rec(0,'turn/start',{turn:1}),rec(1,'step/start',{turn:1,step:1}),rec(2,'user/message',{id:'root-human',role:'user',source:{kind:'user'},content:[text('Independent source fixture')]},'append'),assistant(3,1,[text('Older reply must not become final')]),rec(4,'step/end',{turn:1,step:1}),rec(5,'step/start',{turn:1,step:2})];
const close=(seq,reason={kind:'completed'})=>[rec(seq,'step/end',{turn:1,step:2}),rec(seq+1,'turn/end',{turn:1,reason})];
const interruptedText=(value)=>{const entry=assistant(6,2,[{type:'reasoning',text:'Interrupted reasoning'},text(value)]);entry.event.data.interrupted=true;return [...start,entry,...close(7,{kind:'aborted',reason:{kind:'user'}})];};
const cases={
 latestEmptyStep:[...start,...close(6)],
 latestReasoningOnly:[...start,assistant(6,2,[{type:'reasoning',text:'Root private reasoning fixture'}]),...close(7)],
 latestWhitespace:[...start,assistant(6,2,[text('  \n\t')]),...close(7)],
 latestTextAndTool:[...start,assistant(6,2,[text('Tool preamble must join process'),{type:'tool-call',id:'root-call',name:'read',arguments:'{}'}]),...close(7)],
 latestUnknown:[...start,assistant(6,2,[{type:'file',attachment:{attachmentId:'root-file',name:'root-result.csv',bytes:4}}]),...close(7)],
 interruptedReasoning:[...start,assistant(6,2,[{type:'reasoning',text:'Root interrupted reasoning'}]),...close(7,{kind:'aborted',reason:{kind:'user'}})],
 mixedResponse:[...start,assistant(6,2,[text('Response A'),{type:'reasoning',text:'Reasoning middle'},text('Response B')]),...close(7)],
 interruptedBOM:interruptedText('\uFEFF'),
 interruptedNEL:interruptedText('\u0085'),
};
const output={};
for(const [name,records] of Object.entries(cases)) {const p=new SessionProjection('root-'+name);p.snapshot({cursor:records.at(-1).event.seq,records,hasMore:false,assistantStream:{revision:0}});const expected=summary(original(records));output[name]={snapshot:p.value(),original:expected,provenance:'Root-owned synthetic schema-admissible fixture from pinned original assembler; not live model/provider or Host evidence'};}
process.stdout.write(JSON.stringify(process.argv[2]?output[process.argv[2]]:output));
