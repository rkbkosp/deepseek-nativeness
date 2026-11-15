// Explicit local signing stage only. It cannot submit notarization or publish.
import { cp, mkdir, readdir, readFile, writeFile, lstat, realpath, readlink } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { FixtureAdapter } from "../remote/fixture.mjs";

const root=resolve(import.meta.dirname,".."),source=resolve(process.argv[2]??join(root,"build/Native DSH Remote GUI11.app"));
const destination=resolve(process.argv[3]??join(root,"build/signed-gui11/Native DSH Remote.app"));
const audit=join(root,"build/signed-gui11-audit"),identity="152AB464732D868D81B7D7829E1C4FC9F803178E",team="8U6DAJ62JT";
const nativeBuiltAt="1feddef",entitlements=join(root,"scripts/node-runtime-entitlements.plist");
const components=["Contents/Resources/remote/node_modules/@roamhq/wrtc-darwin-arm64/wrtc.node","Contents/MacOS/node","Contents/MacOS/native-dsh"];
// Older reviewed bundles have no native indicator library. Sign it explicitly
// when present so hardened library validation keeps the same team identity.
const indicatorLibrary="Contents/Frameworks/libNativeDSHIndicators.dylib";
try { await lstat(join(source,indicatorLibrary)); components.push(indicatorLibrary); }
catch(error) { if(error.code!=="ENOENT") throw error; }
const sha=value=>createHash("sha256").update(value).digest("hex");
const commands=[];
function command(program,args,options={}){
 const result=spawnSync(program,args,{encoding:"utf8",timeout:60000,...options});
 const record={command:[program,...args],status:result.status,signal:result.signal,stdout:result.stdout??"",stderr:result.stderr??""};commands.push(record);
 if(result.error||result.status!==0)throw Object.assign(Error(record.stderr||result.error?.message||`${program} failed`),{record});
 return record;
}
function plistJSON(bytes){return JSON.parse(execFileSync("plutil",["-convert","json","-o","-","-"],{input:bytes,encoding:"utf8"}));}
async function inventory(directory){const entries={};async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name),key=relative(directory,path);if(entry.isSymbolicLink())entries[key]={symlink:await readlink(path)};else if(entry.isDirectory())await walk(path);else if(entry.isFile()){const data=await readFile(path);entries[key]={bytes:data.length,sha256:sha(data)}}}}await walk(directory);return Object.fromEntries(Object.keys(entries).sort().map(key=>[key,entries[key]]));}
// Capture every file-backed Mach-O section, not merely __text. Signature
// blobs are in __LINKEDIT outside the section list and may legitimately change.
function sections(data){
 assert.equal(data.readUInt32LE(0),0xfeedfacf,"expected thin arm64 Mach-O");assert.equal(data.readUInt32LE(4),0x100000c);
 const count=data.readUInt32LE(16),out={};let offset=32;
 for(let i=0;i<count;i++){
  const cmd=data.readUInt32LE(offset),size=data.readUInt32LE(offset+4);assert.ok(size>=8&&offset+size<=data.length);
  if(cmd===0x19){const n=data.readUInt32LE(offset+64);for(let j=0;j<n;j++){
   const section=offset+72+j*80;assert.ok(section+80<=offset+size);
   const name=data.subarray(section,section+16).toString().replace(/\0.*$/s,""),segment=data.subarray(section+16,section+32).toString().replace(/\0.*$/s,"");
   const bytes=Number(data.readBigUInt64LE(section+40)),fileOffset=data.readUInt32LE(section+48),flags=data.readUInt32LE(section+64),type=flags&255,zeroFill=[1,12,18].includes(type);
   assert.ok(Number.isSafeInteger(bytes));if(!zeroFill)assert.ok(fileOffset+bytes<=data.length);
   out[segment+","+name]={bytes,flags,zeroFill,...zeroFill?{}:{sha256:sha(data.subarray(fileOffset,fileOffset+bytes))}};
  }}offset+=size;
 }
 assert.ok(out["__TEXT,__text"]);return out;
}
async function fixture(app){
 const sourceNotes=[],adapter=new FixtureAdapter((method,params)=>sourceNotes.push({method,params}));
 const expected=await adapter.request("fixtureChatPresentationStream");
 const node=join(app,"Contents/MacOS/node"),helper=join(app,"Contents/Resources/remote/bridge.mjs");
 const child=spawn(node,[helper,"--fixture"],{cwd:app,stdio:["pipe","pipe","pipe"]});
 let pending="",stderr="",result,closed;const notes=[];
 const done=Promise.withResolvers(),timer=setTimeout(()=>{child.kill();done.reject(Error("Signed runtime fixture timed out"));},10000);
 child.stderr.on("data",data=>stderr+=data.toString());child.on("error",done.reject);
 child.stdout.on("data",data=>{pending+=data;let end;while((end=pending.indexOf("\n"))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);if(!line)continue;const message=JSON.parse(line);if(message.id===1){if(message.error){child.kill();done.reject(Error(message.error.code));return}result=message.result;child.stdin.write(JSON.stringify({id:2,method:"close",params:{}})+"\n")}else if(message.id===2){closed=message;child.stdin.end()}else if(!result)notes.push({method:message.method,params:message.params})}});
 child.on("exit",(code,signal)=>{clearTimeout(timer);if(code!==0)done.reject(Error(`Signed runtime exited ${code}/${signal}: ${stderr}`));else done.resolve()});
 child.stdin.write(JSON.stringify({id:1,method:"fixtureChatPresentationStream",params:{}})+"\n");await done.promise;
 assert.ok(closed&&!closed.error);assert.equal(stderr,"");assert.deepEqual(result,JSON.parse(JSON.stringify(expected)));assert.deepEqual(notes,JSON.parse(JSON.stringify(sourceNotes)));
 const loaded=JSON.parse(command(node,["-e",`const w=require(${JSON.stringify(join(app,"Contents/Resources/remote/node_modules/@roamhq/wrtc"))});console.log(JSON.stringify({node:process.version,arch:process.arch,rtcLoaded:typeof w.RTCPeerConnection==='function',peerConstructed:false}));`]).stdout);
 assert.equal(loaded.rtcLoaded,true);assert.equal(loaded.peerConstructed,false);
 return{hostOrNetwork:false,guiLaunched:false,peerConstructed:false,sourceMatchesSignedRuntime:true,notificationCount:notes.length,checkpoints:result.checkpoints.map(({marker,expected})=>({marker,revision:expected.chatPresentation.presentationRevision})),loaded};
}

await mkdir(audit,{recursive:true});
const sourceCommit=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
try{
 assert.notEqual(source,destination);await assert.rejects(lstat(destination),{code:"ENOENT"});
 command("codesign",["--verify","--deep","--strict","--verbose=2",source]);
 const before=await inventory(source),beforeSections={};for(const name of components)beforeSections[name]=sections(await readFile(join(source,name)));
 const vendor=command("codesign",["-d","--entitlements",":-",join(source,"Contents/MacOS/node")]);
 const vendorEntitlements=plistJSON(vendor.stdout),approved=plistJSON(await readFile(entitlements));
 const expected={...vendorEntitlements};assert.equal(expected["com.apple.security.get-task-allow"],true);delete expected["com.apple.security.get-task-allow"];assert.deepEqual(approved,expected,"Node grants must differ from actual vendor only by get-task-allow removal");
 await writeFile(join(audit,"node-vendor-entitlements.plist"),vendor.stdout,{mode:0o600});await writeFile(join(audit,"node-sign-entitlements.plist"),await readFile(entitlements),{mode:0o600});
 await mkdir(resolve(destination,".."),{recursive:true});await cp(source,destination,{recursive:true,force:false,errorOnExist:true,verbatimSymlinks:true,preserveTimestamps:true});
 for(const name of components){const path=join(destination,name);assert.ok((await lstat(path)).isFile());assert.ok((await realpath(path)).startsWith((await realpath(destination))+"/"));}
 const base=["--force","--sign",identity,"--options","runtime","--timestamp"];
 for(const name of components.filter(name=>name!=="Contents/MacOS/node"&&name!=="Contents/MacOS/native-dsh")) command("codesign",[...base,join(destination,name)]);
 command("codesign",[...base,"--entitlements",entitlements,join(destination,components[1])]);
 command("codesign",[...base,destination]);
 command("codesign",["--verify","--deep","--strict","--verbose=2",destination]);
 const signatures=[];for(const name of components){const path=join(destination,name);command("codesign",["--verify","--strict","--verbose=2",path]);const details=command("codesign",["-dvvv",path]).stderr;assert.match(details,new RegExp("TeamIdentifier="+team));assert.match(details,/flags=.*runtime/);assert.match(details,/Timestamp=/);
  const ent=command("codesign",["-d","--entitlements",":-",path]),grants=ent.stdout.trim()?plistJSON(ent.stdout):{};assert.notEqual(grants["com.apple.security.get-task-allow"],true);if(name.endsWith("/node"))assert.deepEqual(grants,approved);else assert.deepEqual(grants,{},"Do not add Go/wrtc exception entitlements");
  signatures.push({path:name,team,hardenedRuntime:true,secureTimestamp:true,getTaskAllow:{present:Object.hasOwn(grants,"com.apple.security.get-task-allow"),value:false},entitlements:grants,details});
 }
 const after=await inventory(destination),comparison=[];for(const name of new Set([...Object.keys(before),...Object.keys(after)])){
  if(name==="Contents/_CodeSignature/CodeResources")continue;
  if(components.includes(name)){const signedSections=sections(await readFile(join(destination,name)));assert.deepEqual(signedSections,beforeSections[name],"Mach-O code/data section changed: "+name);comparison.push({path:name,before:before[name],after:after[name],allCodeDataSectionsIdentical:true,sections:signedSections});continue}
  assert.deepEqual(after[name],before[name],"non-signature resource changed: "+name);
 }
 assert.deepEqual(await inventory(source),before,"signing mutated the QA source app");
 const buildIDBefore=command("go",["tool","buildid",join(source,"Contents/MacOS/native-dsh")]).stdout.trim(),buildIDAfter=command("go",["tool","buildid",join(destination,"Contents/MacOS/native-dsh")]).stdout.trim();assert.equal(buildIDAfter,buildIDBefore);
 const runtimeFixture=await fixture(destination);assert.deepEqual(await inventory(destination),after,"fixture changed sealed files");
 const minimum=command("plutil",["-extract","LSMinimumSystemVersion","raw","-o","-",join(destination,"Contents/Info.plist")]).stdout.trim();assert.equal(minimum,"15.8");
 for(const name of components){const build=command("xcrun",["vtool","-show-build",join(destination,name)]).stdout;const min=build.match(/minos\s+([\d.]+)/)?.[1];assert.ok(min);const[a,b]=min.split(".").map(Number);assert.ok(a<15||a===15&&b<=8)}
 const report={createdAt:new Date().toISOString(),nativeBuiltAt,signingScriptCommit:sourceCommit,source,destination,certificateFingerprint:identity,team,minimumSystemVersion:minimum,nodeEntitlements:{actualVendor:vendorEntitlements,signed:approved,removedOnly:["com.apple.security.get-task-allow"]},signatures,comparison,goBuildID:{before:buildIDBefore,after:buildIDAfter},resources:{before,after,allNonSignatureResourcesAndSymlinksIdentical:true,qaSourceUnchanged:true},runtimeFixture,commands,notarization:{submitted:false},guiAcceptance:"Pending root hardened-runtime real Remote read-only UI; script never launches the GUI."};
 await writeFile(join(audit,"signing-review.json"),JSON.stringify(report,null,2)+"\n",{mode:0o600});console.log(JSON.stringify({destination,signingScriptCommit:sourceCommit,nativeBuiltAt,team,strictVerification:true,sourceSectionsAndResourcesMatch:true,runtimeFixture:true,notarizationSubmitted:false}));
}catch(error){await writeFile(join(audit,"signing-failure.json"),JSON.stringify({sourceCommit,source,destination,error:String(error),command:error.record??null,commands},null,2)+"\n",{mode:0o600});console.error(error.message);process.exitCode=1}
