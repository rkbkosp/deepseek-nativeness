import { createInterface } from "node:readline";
import { SessionProjection } from "../../remote/projection.mjs";
import { PresentationPublisher } from "../../remote/updates.mjs";
// Local actual producer only; no transport, credentials, Host or original app.
const write=value=>process.stdout.write(JSON.stringify(value)+"\n");
const scope={hostId:"retained-fixture",generation:1,accountScope:"retained-account"};
const emit=(method,params)=>write({method,params,scope});
const event=(seq,type,data)=>({seq,type,time:1700000000000+seq,data,surfaceOp:"append"});
createInterface({input:process.stdin,crlfDelay:Infinity}).on("line",line=>{
 const request=JSON.parse(line),p=new SessionProjection("retained-session"),pub=new PresentationPublisher(emit),checkpoints=[];
 p.snapshot({cursor:2,records:[event(0,"turn/start",{turn:1}),event(1,"step/start",{turn:1,step:1}),event(2,"user/message",{source:{kind:"user"},content:[{type:"text",text:"Opening fixture input"}]})].map(event=>({event})),assistantStream:{revision:0}});
 pub.replace(p.value());emit("snapshot",p.value());
 p.frame({type:"start",revision:1,attemptId:"retained-attempt",turn:1,step:1,startedAfterSeq:2});
 p.frame({type:"chunk",revision:2,attemptId:"retained-attempt",index:0,chunk:{type:"text-delta",index:0,text:"Retained fixture response"}});
 pub.patch(p.pullUpdates());
 p.event(event(3,"user/message",{source:{kind:"user"},content:[{type:"text",text:"Later fixture input"}]}));
 p.event(event(4,"assistant/message",{turn:1,step:1,message:{id:"retained-committed",content:[{type:"text",text:"Retained fixture response"}]},stream:[]}));
 p.frame({type:"end",revision:3,attemptId:"retained-attempt",index:1,outcome:{kind:"committed",eventType:"assistant/message",seq:4}});
 pub.patch(p.pullUpdates());checkpoints.push({marker:"retained",expected:p.value()});emit("fixtureCheckpoint",{marker:"retained"});
 p.event(event(5,"step/end",{turn:1,step:1}));pub.patch(p.pullUpdates());checkpoints.push({marker:"settled",expected:p.value()});emit("fixtureCheckpoint",{marker:"settled"});
 emit("fixtureComplete",{marker:"retained-layout"});write({id:request.id,result:{checkpoints}});
});
