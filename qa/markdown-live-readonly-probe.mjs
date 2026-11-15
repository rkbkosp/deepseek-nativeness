// Root acceptance only: private Native DSH identity; passive existing completed session.
// No Host task, settings, feedback, fork, clipboard or file-export write.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {RemoteAdapter} from '../remote/client.mjs';
const output=process.argv[2];
if(!output)throw Error('Pass a private result JSON path.');
const hint=x=>createHash('sha256').update(x).digest('hex').slice(0,12);
const report={startedAt:new Date().toISOString(),readOnly:true,interactionAnswerer:false,remoteMutations:0,scope:'Live source adapter acceptance plus separately tested exact candidate pipe; not actual clipboard/UI export',sourceFiles:{},stages:[]};
for(const f of ['remote/client.mjs','remote/session-markdown.mjs'])report.sourceFiles[f]=createHash('sha256').update(await fs.readFile(new URL('../'+f,import.meta.url))).digest('hex');
const adapter=new RemoteAdapter();
const timer=setTimeout(()=>void adapter.close(),45000);
try{
 const prefs=JSON.parse(await fs.readFile(path.join(os.homedir(),'Library/Application Support/Native DSH Remote/preferences.json'),'utf8'));
 const status=await adapter.configure({serverUrl:prefs.serverUrl});
 if(!status.authorized)throw Object.assign(Error('Native client has no saved authorization'),{code:'AUTH_REQUIRED'});
 const saved=prefs.selections?.[status.accountScope??status.identityScope];
 if(!saved?.hostId||!saved?.sessionId)throw Object.assign(Error('No current-account saved session'),{code:'NO_SAVED_SESSION'});
 const devices=await adapter.request('devices');
 if(!devices.some(d=>d.id===saved.hostId&&d.online))throw Object.assign(Error('Saved Host offline'),{code:'HOST_OFFLINE'});
 const connected=await adapter.request('connect',{hostId:saved.hostId,readOnly:true});
 if(!connected.readOnly||adapter.interactionReady||adapter.eventsStop)throw Error('Unexpected interaction channel');
 const sessions=await adapter.request('sessions',{all:true});
 const target=sessions.find(s=>s.id===saved.sessionId);
 if(!target||target.running||target.blank)throw Object.assign(Error('Saved target is not a completed session'),{code:'TARGET_NOT_COMPLETED'});
 report.stages.push({stage:'connected',hostHint:hint(saved.hostId),sessionHint:hint(saved.sessionId),readOnly:connected.readOnly,transport:connected.transport});
 await adapter.request('openSession',{sessionId:saved.sessionId});
 const clientScope={hostId:saved.hostId,generation:adapter.connectionGeneration,sessionId:saved.sessionId};
 const caps=await adapter.request('capabilities',{sessionId:saved.sessionId,clientScope});
 if(!caps.operations.exportSessionMarkdown)throw Object.assign(Error('Complete export capability unavailable'),{code:'UNAVAILABLE'});
 const ownerId='root-readonly-markdown-'+Date.now();
 await adapter.request('registerOwner',{ownerId,clientScope});
 try{
   const result=await adapter.request('exportSessionMarkdown',{sessionId:saved.sessionId,clientScope:{...clientScope,ownerId}});
   if(result.complete!==true||result.eventCount!==result.throughSeq+1||result.sourcePathIncluded!==false)throw Error('Invalid complete-export evidence');
   report.stages.push({stage:'complete-markdown',complete:result.complete,throughSeq:result.throughSeq,eventCount:result.eventCount,sourcePathIncluded:false,utf8Bytes:Buffer.byteLength(result.markdown),sha256:createHash('sha256').update(result.markdown).digest('hex'),contentSaved:false});
 }finally{await adapter.request('closeOwnerStreams',{ownerId});}
 report.remainingOwners=adapter.owners.size;report.pass=report.remainingOwners===0;
}catch(e){report.pass=false;report.failure={code:e.code??'ERROR',message:e.message};process.exitCode=1;}
finally{
 clearTimeout(timer);await adapter.close();
 report.finishedAt=new Date().toISOString();
 await fs.writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(report));
}
