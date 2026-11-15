import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..'),dir=import.meta.dirname,build=path.join(dir,'build');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifest=process.argv[2];assert.ok(manifest,'Pass the author frozen manifest path after READY.');
const manifestBytes=await fs.readFile(path.resolve(root,manifest));
const authorManifest=JSON.parse(manifestBytes);
for(const source of authorManifest.sources) {
 const b=await fs.readFile(path.resolve(root,source.path));
 assert.equal(sha(b),source.sha256,'author frozen source mismatch: '+source.path);
 assert.equal(b.length,source.bytes,'author source size mismatch: '+source.path);
}
const sources=(await fs.readdir(path.join(root,'composer_native'))).filter(x=>x.endsWith('.swift')||x.endsWith('.go')).sort();
async function hashes(){const out={};for(const name of sources)out['composer_native/'+name]=sha(await fs.readFile(path.join(root,'composer_native',name)));return out;}
const before=await hashes();await fs.mkdir(build,{recursive:true});
const commands=[];let failed=false;
function run(program,args,env={}) {
 const r=spawnSync(program,args,{cwd:root,encoding:'utf8',timeout:120000,env:{...process.env,...env}});
 commands.push({command:[program,...args],status:r.status,signal:r.signal,stdout:r.stdout??'',stderr:r.stderr??'',error:r.error?.message??null});
 if(r.status!==0)failed=true;return r.status===0;
}
run('sw_vers',['-productVersion']);run('uname',['-m']);run('swiftc',['--version']);
const swift=sources.filter(x=>x.endsWith('.swift')).map(x=>'composer_native/'+x);
const executable=path.join(build,'native-hot-cross');
if(run('swiftc',['-swift-version','5','-target','arm64-apple-macos15.8',...swift,path.join(dir,'main.swift'),'-o',executable])) {
 run(executable,[path.join(build,'native-results.json')]);
 const overlay=path.join(build,'overlay.json');
 await fs.writeFile(overlay,JSON.stringify({Replace:{[path.join(root,'composer_native','qa_hot_cross_test.go')]:path.join(dir,'receiver.gotest')}},null,2)+'\n');
 run('go',['test','-overlay='+overlay,'./composer_native','-run','^TestCross','-count=1','-v'],{CGO_ENABLED:'0',NATIVE_HOT_CROSS_DIR:build});
 run('go',['vet','-overlay='+overlay,'./composer_native'],{CGO_ENABLED:'0'});
}
const after=await hashes();assert.deepEqual(before,after,'sources changed while cross tests ran; result is not frozen');
const independentTestInputs={};for(const name of ['main.swift','receiver.gotest','run.mjs'])independentTestInputs[name]=sha(await fs.readFile(path.join(dir,name)));
const regression=await fs.readFile(path.join(build,'without-lazy-fix/results.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
if(regression) {
 assert.equal(regression.checks['first-large-restored-read-not-overlapping-or-duplicated'],false);
 assert.equal(regression.firstReadDiagnostics.expectedDigest,regression.firstReadDiagnostics.secondDigest);
 assert.notEqual(regression.firstReadDiagnostics.firstDigest,regression.firstReadDiagnostics.expectedDigest);
}
const output={createdAt:new Date().toISOString(),authorManifest:{path:manifest,sha256:sha(manifestBytes),allFrozenSourcesMatch:true,count:authorManifest.sources.length},sources:before,independentTestInputs,sourceStable:true,commands,pass:!failed,guiLaunched:false,hostAccess:false,
 regressionProof:regression?{path:'qa/native-hot-activation-cross/build/without-lazy-fix/results.json',expectedFailure:'first-large-restored-read-not-overlapping-or-duplicated',firstReadDiagnostics:regression.firstReadDiagnostics,note:'Private QA-only regression variant removed pre-enumeration ensureAttributesAreFixed; no business source was modified. This counterexample is distinct from final frozen-source test results.'}:null,
 scope:'Actual ComposerOwner headless AppKit command plus actual Go receiver/Store overlay; no visible NSWindow or native editor proof launch.',limits:['This component is not imported into the production app.','Invalid/oversize body preservation here is same-native-owner hot navigation only. Closing that owner still clears its documents; durable export/persistence and recovery in a new owner are not guaranteed by this primitive.','No actual macOS 15.8 or M1 GUI/typing acceptance is claimed.','Swift commands and Go receiver are connected by captured actual native response corpus; public Go ActivateHot FFI dispatch is source-reviewed here, with author integration gates separate.']};
await fs.writeFile(path.join(dir,'review.json'),JSON.stringify(output,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({pass:!failed,review:path.join(dir,'review.json'),commands:commands.map(({command,status})=>({command,status}))},null,2));
if(failed)process.exitCode=1;
