// Source/runtime equivalence fixture only. No account, Host or peer is opened.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{spawn,spawnSync}from'node:child_process';
import{FixtureAdapter}from'../remote/fixture.mjs';
const root=path.resolve(import.meta.dirname,'..'),runtime=path.join(root,'build/runtime-chat-process-next');
const sourceNotes=[],source=new FixtureAdapter((method,params)=>sourceNotes.push({method,params}));
const expected=await source.request('fixtureChatPresentationStream');
const child=spawn(path.join(runtime,'node'),[path.join(runtime,'remote/bridge.mjs'),'--fixture'],{cwd:runtime,stdio:['pipe','pipe','pipe']});
let pending='',stderr='',result,closeResult;const notes=[];
const done=Promise.withResolvers();const timer=setTimeout(()=>{child.kill();done.reject(Error('Fixture runtime timed out'));},5000);
child.stderr.on('data',b=>stderr+=b.toString());
child.stdout.on('data',data=>{pending+=data;let i;while((i=pending.indexOf('\n'))>=0){const line=pending.slice(0,i);pending=pending.slice(i+1);if(!line)continue;const message=JSON.parse(line);if(message.id===1){if(message.error){done.reject(Error(message.error.code));child.kill();return;}result=message.result;child.stdin.write(JSON.stringify({id:2,method:'close',params:{}})+'\n');}else if(message.id===2){closeResult=message;child.stdin.end();}else if(!result)notes.push({method:message.method,params:message.params});}});
child.on('error',done.reject);child.on('exit',(code,signal)=>{clearTimeout(timer);if(code!==0)done.reject(Error('Runtime exit '+code+'/'+signal));else done.resolve();});
child.stdin.write(JSON.stringify({id:1,method:'fixtureChatPresentationStream',params:{}})+'\n');
await done.promise;assert.ok(closeResult&&!closeResult.error);assert.deepEqual(result,JSON.parse(JSON.stringify(expected)));assert.deepEqual(notes,JSON.parse(JSON.stringify(sourceNotes)));assert.equal(stderr,'');
const rtc=spawnSync(path.join(runtime,'node'),['-e',`const w=require(${JSON.stringify(path.join(runtime,'remote/node_modules/@roamhq/wrtc'))});console.log(JSON.stringify({node:process.version,platform:process.platform,architecture:process.arch,rtcLoaded:typeof w.RTCPeerConnection==='function',peerConstructed:false}));`],{encoding:'utf8',timeout:5000});
assert.equal(rtc.status,0,rtc.stderr);const loaded=JSON.parse(rtc.stdout);assert.equal(loaded.rtcLoaded,true);assert.equal(loaded.peerConstructed,false);
const report={kind:'exact-bundled-runtime-local-fixture',hostOrNetwork:false,newPeer:false,sourceMatchesBundle:true,checkpoints:result.checkpoints.map(({marker,expected})=>({marker,baselineSerial:expected.chatPresentation.baselineSerial,presentationRevision:expected.chatPresentation.presentationRevision})),notificationCount:notes.length,methods:[...new Set(notes.map(x=>x.method))],loaded,exitCode:0};
fs.writeFileSync(path.join(root,'qa/checkpoints/_helper-chat-runtime-build/fixture-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
