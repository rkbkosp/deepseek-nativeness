import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),compat=join(root,'compat');
const normal=JSON.parse(await readFile(join(compat,'dist-layout-next/source-manifest.json'))),forced=JSON.parse(await readFile(join(compat,'dist-layout-forced-test/source-manifest.json')));
assert.deepEqual(normal.inputs,forced.inputs);assert.equal(normal.buildWorkingDirectory,forced.buildWorkingDirectory);
assert.deepEqual(normal.compileDefines,{NATIVE_DSH_FORCE_MENU_ANCHOR_FALLBACK:'false'});assert.deepEqual(forced.compileDefines,{NATIVE_DSH_FORCE_MENU_ANCHOR_FALLBACK:'true'});
const sha256=data=>createHash('sha256').update(data).digest('hex'),inputs={};
for(const name of normal.inputs){const namespace=name.indexOf(':/'),path=namespace>=0?name.slice(namespace+1):resolve(normal.buildWorkingDirectory,name),data=await readFile(path);inputs[name]={bytes:data.length,sha256:sha256(data)}}
async function files(directory){const out={};async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const path=join(dir,e.name);if(e.isDirectory())await walk(path);else if(e.isFile()){const data=await readFile(path);out[relative(directory,path)]={bytes:data.length,sha256:sha256(data)}}}}await walk(directory);return out}
const report={createdAt:new Date().toISOString(),sourcePathBase:normal.buildWorkingDirectory,scope:'Identical compatibility source inputs; only esbuild NATIVE_DSH_FORCE_MENU_ANCHOR_FALLBACK is false versus true. Production retains native feature detection, QA forces the same fallback hooks. No runtime option.',acceptance:'7 deterministic fallback/compile-gate fixtures and 25 compatibility tests; actual WK composed screen, macOS 15.8 and M1 remain pending.',inputs,normal:{directory:'compat/dist-layout-next',compileDefines:normal.compileDefines,assets:await files(join(compat,'dist-layout-next'))},forced:{directory:'compat/dist-layout-forced-test',compileDefines:forced.compileDefines,bundleName:'Native DSH Remote Anchor QA',bundleId:'cn.rkbkosp.native-dsh.remote.anchor-qa',assets:await files(join(compat,'dist-layout-forced-test'))}};
const out=join(compat,'anchor-qa-builds.json');await writeFile(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sourceInputs:Object.keys(inputs).length,normalFiles:Object.keys(report.normal.assets).length,forcedFiles:Object.keys(report.forced.assets).length,normalApp:report.normal.assets['app.js'],forcedApp:report.forced.assets['app.js'],normalManifest:report.normal.assets['source-manifest.json'],forcedManifest:report.forced.assets['source-manifest.json'],pairReportSHA256:sha256(await readFile(out))},null,2));
