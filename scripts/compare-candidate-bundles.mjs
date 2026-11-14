import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const [normalPath,forcedPath,outPath]=process.argv.slice(2),normal=JSON.parse(await readFile(normalPath)),forced=JSON.parse(await readFile(forcedPath));
assert.equal(normal.sourceCommit,forced.sourceCommit);assert.deepEqual(normal.nativeInputs,forced.nativeInputs);
const pair=JSON.parse(await readFile(resolve(import.meta.dirname,'../compat/anchor-qa-builds.json')));
const differences=[],sameNative=[];
for(const path of new Set([...Object.keys(normal.assets),...Object.keys(forced.assets)])){
 const a=normal.assets[path],b=forced.assets[path];
 if(path.startsWith('Contents/Resources/compat/'))continue;
 if(path==='Contents/Info.plist')continue;
 assert.deepEqual(a,b,`unexpected non-WK difference: ${path}`);sameNative.push(path);
}
for(const [candidate,resources]of [[normal,pair.normal.assets],[forced,pair.forced.assets]]){
 const actual=Object.fromEntries(Object.entries(candidate.assets).filter(([p])=>p.startsWith('Contents/Resources/compat/')).map(([p,v])=>[p.slice('Contents/Resources/compat/'.length),v]));assert.deepEqual(actual,resources,'packaged compatibility differs from frozen asset tree');
}
const plist=app=>JSON.parse(execFileSync('plutil',['-convert','json','-o','-',`${app}/Contents/Info.plist`],{encoding:'utf8'}));
const a=plist(normal.app),b=plist(forced.app),allowed=['CFBundleIdentifier','CFBundleName','CFBundleDisplayName'];
for(const key of new Set([...Object.keys(a),...Object.keys(b)])){if(allowed.includes(key)){differences.push({key,normal:a[key],forced:b[key]});continue}assert.deepEqual(a[key],b[key],`unexpected plist difference: ${key}`)}
assert.equal(b.CFBundleIdentifier,'cn.rkbkosp.native-dsh.remote.anchor-qa');assert.equal(a.CFBundleIdentifier,'cn.rkbkosp.native-dsh.remote');
const report={sourceCommit:normal.sourceCommit,normal:normal.app,forced:forced.app,identicalNonWKFiles:sameNative.length,sameGo:normal.assets['Contents/MacOS/native-dsh'],sameNode:normal.assets['Contents/MacOS/node'],sameHelper:normal.assets['Contents/Resources/remote/bridge.mjs'],plistDifferences:differences,compatibility:'Full packaged trees exactly match the separately frozen normal/compile-forced resource trees. Their source inputs are identical; compile define false/true is recorded in anchor-qa-builds.json.',actualAcceptance:'Static bundle comparison only; no application launched.'};
await writeFile(outPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(outPath);
