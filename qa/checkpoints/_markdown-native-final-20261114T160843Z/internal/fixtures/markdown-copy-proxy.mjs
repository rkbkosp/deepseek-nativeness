// Test-only metadata proxy around the actual --fixture helper. Never used by a normal app.
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';
const helper=process.env.NATIVE_DSH_REMOTE_CANDIDATE || fileURLToPath(new URL('../../remote/bridge.mjs',import.meta.url));
const child=spawn(process.execPath,[helper,'--fixture'],{stdio:['pipe','pipe','pipe']});
child.stderr.pipe(process.stderr);
const counts={},exportIds=new Set(),held=[];let holdExportResults=false;
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
const input=readline.createInterface({input:process.stdin});
input.on('line',line=>{const request=JSON.parse(line);
 if(request.method==='fixtureProxyStats'){emit({id:request.id,result:{counts,heldResults:held.length}});return;}
 if(request.method==='fixtureProxyControl'){
  holdExportResults=request.params?.holdExportResults===true;
  if(!holdExportResults)for(const result of held.splice(0))process.stdout.write(result+'\n');
  emit({id:request.id,result:{holdExportResults}});return;
 }
 counts[request.method]=(counts[request.method]??0)+1;
 if(request.method==='exportSessionMarkdown')exportIds.add(request.id);
 child.stdin.write(line+'\n');
});
const output=readline.createInterface({input:child.stdout});
output.on('line',line=>{const result=JSON.parse(line);
 if(result.id!==undefined&&exportIds.has(result.id)&&holdExportResults){held.push(line);return;}
 process.stdout.write(line+'\n');
});
input.on('close',()=>child.stdin.end());
child.on('exit',code=>{input.close();process.exitCode=code??0;});
process.on('SIGTERM',()=>{child.kill();process.exit();});
