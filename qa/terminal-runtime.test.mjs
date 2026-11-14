import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const desktop=path.resolve(import.meta.dirname,'..'),source=path.join(desktop,'../deepseek-harness');
const {build}=await import(pathToFileURL(path.join(desktop,'compat/node_modules/esbuild/lib/main.js')));
const packages=new Map(execFileSync('rg',['--files','packages','-g','package.json'],{cwd:source,encoding:'utf8'}).trim().split('\n').map(file=>{const pkg=JSON.parse(fs.readFileSync(path.join(source,file),'utf8'));return[pkg.name,{pkg,dir:path.dirname(path.join(source,file))}];}));
const out=path.join(import.meta.dirname,'runtime-results/terminal-runtime-fixture.mjs');
fs.mkdirSync(path.dirname(out),{recursive:true});
await build({stdin:{contents:'export {createTerminalRuntime,TerminalFrameQueue,terminalMutationValue} from "./src/terminal-runtime.ts";',resolveDir:path.join(desktop,'compat'),sourcefile:'terminal-test-entry.ts'},outfile:out,bundle:true,format:'esm',platform:'browser',target:'safari17.4',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},nodePaths:[path.join(desktop,'compat/node_modules')],loader:{'.css':'empty','.svg':'text','.woff2':'empty','.woff':'empty','.ttf':'empty'},plugins:[{name:'frozen-source-alias',setup(b){b.onResolve({filter:/^@deepseek-ai\//},args=>{if(args.path==='@deepseek-ai/dsh-api-gateway/client'&&args.importer.endsWith('/api/terminal-controller/src/client/model.ts'))return{path:path.join(source,'packages/api/gateway/src/client/stream-client.ts')};const name=args.path.split('/').slice(0,2).join('/'),entry=packages.get(name);if(!entry)return;const sub=args.path.slice(name.length);let target=entry.pkg.exports?.[sub?'./'+sub.slice(1):'.'];if(typeof target==='object')target=target.browser??target.import??target.default;if(typeof target!=='string')target=sub?'lib'+sub+'.js':entry.pkg.main??'lib/index.js';target=target.replace(/^\.\//,'').replace(/^lib\//,'src/').replace(/\.js$/,'.ts');if(!fs.existsSync(path.join(entry.dir,target))&&/^src\/client\.(browser|node)\.ts$/.test(target))target='src/client/index.ts';if(!fs.existsSync(path.join(entry.dir,target)))target=target.replace(/^src\/types\//,'src/');if(!fs.existsSync(path.join(entry.dir,target))&&fs.existsSync(path.join(entry.dir,target.replace(/\.ts$/,'.tsx'))))target=target.replace(/\.ts$/,'.tsx');return{path:path.join(entry.dir,target)};});}}]});
const {createTerminalRuntime,TerminalFrameQueue,terminalMutationValue}=await import(pathToFileURL(out));

const until=async(check)=>{for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}assert.fail('fixture condition did not settle');};
function fixture({existing=true,unknownInput=false}={}){
 const listeners=new Set(),calls=[],subscriptions=new Map();let counter=0;
 const info={id:'terminal-one',title:'fixture terminal',shell:{path:'/fixture/sh',args:[],name:'Fixture shell'},cwd:'/fixture',cols:80,rows:24,state:'running',exitCode:null,origin:'user',control:'user'};
 const emit=(method,params)=>{for(const fn of [...listeners])fn({method,params});};
 const call=async(method,p={})=>{
  calls.push({method,params:p});
  assert.deepEqual(p.clientScope,{hostId:'fixture-host',generation:7,sessionId:'fixture-session',ownerId:'fixture-page'});
  assert.equal(p.ownerId,'fixture-page');
  if(method==='listTerminals')return existing?[info]:[];
  if(method==='terminalEnvironment')return{cwd:'/fixture',maxInputBytes:4096,maxBufferedBytes:65536,maxCols:200,maxRows:80,scrollback:100};
  if(method==='terminalShells')return[info.shell];
  if(method==='createTerminal')return{status:'accepted',requestId:p.requestId,value:{...info,id:p.terminal.id}};
  if(method==='retainTerminal'||method==='watchTerminal'){
   const subscriptionId='stream-'+(++counter);subscriptions.set(method,subscriptionId);
   // Deliberately emit before the open RPC promise settles.
   queueMicrotask(()=>emit('remoteStream',{subscriptionId,method,sessionId:'fixture-session',frame:method==='retainTerminal'?{type:'retained'}:{type:'snapshot',sequence:7,screen:'fixture screen',info:{...info,id:p.terminalId},writable:true}}));
   return{subscriptionId};
  }
  if(method==='writeTerminal'||method==='resizeTerminal')return unknownInput?{status:'unknown',requestId:p.requestId}:{status:'accepted',requestId:p.requestId,inputSequence:p.inputSequence,value:{ok:true}};
  if(method==='closeStream')return{closed:true};
  if(method==='renameTerminal'||method==='closeTerminal')return{status:'accepted',requestId:p.requestId,value:{ok:true}};
  assert.fail('unexpected terminal method '+method);
 };
 const runtime=createTerminalRuntime({hostId:'fixture-host',sessionId:'fixture-session',connectionGeneration:7,ownerId:'fixture-page'},call,fn=>{listeners.add(fn);return()=>listeners.delete(fn);});
 return{runtime,calls,emit,subscriptions,info};
}

test('original terminal model receives baseline and ordered output through the new bridge',async()=>{
 const f=fixture(),view=f.runtime.getView('terminal-one',false),detach=view.mount();
 await until(()=>view.state.getSnapshot().render?.frame.type==='snapshot');
 let state=view.state.getSnapshot();assert.equal(state.phase,'connected');assert.equal(state.render.frame.screen,'fixture screen');view.acknowledge(state.render.revision);
 f.emit('remoteStream',{subscriptionId:f.subscriptions.get('watchTerminal'),method:'watchTerminal',sessionId:'fixture-session',frame:{type:'output',sequence:8,data:'more output'}});
 await until(()=>view.state.getSnapshot().render?.frame.type==='output');state=view.state.getSnapshot();assert.equal(state.render.frame.data,'more output');view.acknowledge(state.render.revision);
 view.write('a',true);view.resize(100,30);
 await until(()=>f.calls.some(x=>x.method==='resizeTerminal'));
 const inputs=f.calls.filter(x=>['writeTerminal','resizeTerminal'].includes(x.method));assert.deepEqual(inputs.map(x=>x.params.inputSequence),[1,2]);assert.ok(inputs.every(x=>x.params.attachmentId===inputs[0].params.attachmentId));
 detach();await f.runtime.dispose();assert.equal(f.calls.filter(x=>x.method==='createTerminal'||x.method==='closeTerminal').length,0);assert.equal(f.calls.filter(x=>x.method==='closeStream').length,2);
});

test('restoring a missing terminal never creates a replacement process',async()=>{
 const f=fixture({existing:false}),view=f.runtime.getView('missing',false),detach=view.mount();
 await until(()=>view.state.getSnapshot().issue==='missingTerminal');assert.equal(f.calls.some(x=>x.method==='createTerminal'),false);detach();await f.runtime.dispose();
});

test('unknown terminal input receipt stops further input without replay',async()=>{
 const f=fixture({unknownInput:true}),view=f.runtime.getView('terminal-one',false),detach=view.mount();
 await until(()=>view.state.getSnapshot().render?.frame.type==='snapshot');view.acknowledge(view.state.getSnapshot().render.revision);
 view.write('first',true);await until(()=>view.state.getSnapshot().phase==='failed');view.write('second',true);
 await new Promise(resolve=>setTimeout(resolve,5));assert.equal(f.calls.filter(x=>x.method==='writeTerminal').length,1);assert.equal(view.state.getSnapshot().writable,false);detach();await f.runtime.dispose();
});

test('bounded terminal queue terminates explicitly instead of reporting complete truncated output',async()=>{
 const queue=new TerminalFrameQueue();for(let i=0;i<256;i++)assert.equal(queue.push({type:'output',data:String(i)}),true);assert.equal(queue.push({type:'output',data:'overflow'}),false);
 let count=0;await assert.rejects(async()=>{for await(const frame of queue)count++;},{code:'OUTPUT_OVERFLOW'});assert.equal(count,256);
 assert.throws(()=>terminalMutationValue({status:'accepted',requestId:'wrong'},'original'),{code:'UNKNOWN_RECEIPT'});
});

test('terminal input uses one attachment sequence beyond the durable ledger size',async()=>{
 const f=fixture(),view=f.runtime.getView('terminal-one',false),detach=view.mount();
 await until(()=>view.state.getSnapshot().render?.frame.type==='snapshot');view.acknowledge(view.state.getSnapshot().render.revision);
 for(let i=0;i<600;i++)view.write('x',true);
 await until(()=>f.calls.filter(x=>x.method==='writeTerminal').length===600);
 assert.equal(view.state.getSnapshot().phase,'connected');assert.deepEqual(f.calls.filter(x=>x.method==='writeTerminal').map(x=>x.params.inputSequence),Array.from({length:600},(_,i)=>i+1));detach();await f.runtime.dispose();
});

test('connection-generation change invalidates a mounted terminal rather than sending to the new Host',async()=>{
 const f=fixture(),view=f.runtime.getView('terminal-one',false),detach=view.mount();
 await until(()=>view.state.getSnapshot().render?.frame.type==='snapshot');view.acknowledge(view.state.getSnapshot().render.revision);
 f.emit('status',{hostId:'fixture-host',connectionGeneration:8,connected:true});
 await until(()=>view.state.getSnapshot().phase==='failed');view.write('do not forward',true);assert.equal(f.calls.some(x=>x.method==='writeTerminal'),false);detach();await f.runtime.dispose();
});
