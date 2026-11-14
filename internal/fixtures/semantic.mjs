// Explicit local fixture: no sockets, identities, or Host operations.
import {createInterface} from 'node:readline';
import {SessionProjection} from '../../remote/projection.mjs';
import {PresentationPublisher} from '../../remote/updates.mjs';
const write=x=>process.stdout.write(JSON.stringify(x)+'\n');
createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line),p=new SessionProjection('semantic-fixture');
 const ev=(type,seq,data)=>p.event({type,seq,time:seq, data,surfaceOp:'append'});
 ev('user/message',1,{source:{kind:'user'},content:[{type:'text',text:'A visible user message mentioning <system-reminder> must stay visible.'}]});
 ev('turn/start',2,{turn:1});ev('step/start',3,{turn:1,step:1});
 ev('user/message',4,{source:{kind:'runtime',producer:'fixture'},content:[{type:'text',text:'Private fixture runtime context, folded by source kind.'}]});
 ev('tool/call',5,{turn:1,step:1,callId:'fixture-call',name:'read_file',arguments:'{"path":"fixture.txt"}'});
 ev('tool/result',6,{turn:1,step:1,callId:'fixture-call',message:{content:[{type:'text',text:'Fixture tool content'}],isError:false}});
 ev('assistant/message',7,{turn:1,step:1,message:{content:[{type:'reasoning',text:'Fixture thinking'},{type:'text',text:'**Fixture answer**'}]}});
 ev('turn/end',8,{turn:1,reason:'completed'});
 const pub=new PresentationPublisher((method,params)=>write({method,params}));pub.replace(p.value());write({method:'snapshot',params:p.value()});
 ev('turn/start',9,{turn:2});pub.flush(p.value());
 write({method:'fixtureComplete',params:{simulated:true}});write({id:r.id,result:{simulated:true}});
});
