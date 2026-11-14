import{readdir,readFile,writeFile}from'node:fs/promises';
import{resolve,join,relative}from'node:path';
import{createHash}from'node:crypto';
import{execFileSync}from'node:child_process';
const root=resolve(process.argv[4]??resolve(import.meta.dirname,'..')),app=resolve(process.argv[2]??join(root,'build/Native DSH Remote.app')),out=resolve(process.argv[3]??join(root,'build/candidate-manifest.json'));
const files={};
async function walk(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())await walk(path);else if(entry.isFile()){const data=await readFile(path);files[relative(app,path)]={bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};}}}
await walk(app);
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const status=execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'}).trim();
const nativeInputs={};
for(const name of execFileSync('git',['ls-files','-z','*.go','go.mod','go.sum','assets'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean)){
 const data=await readFile(join(root,name));nativeInputs[name]=createHash('sha256').update(data).digest('hex');
}
await writeFile(out,JSON.stringify({createdAt:new Date().toISOString(),app,sourceCommit,trackedSourceDirty:!!status,nativeInputs,assets:files},null,2)+'\n',{mode:0o600});
console.log(out);
