// Explicit stdio peer for native intent-state tests; no identity or networking.
import {createInterface} from 'node:readline';
const counts={};const write=x=>process.stdout.write(JSON.stringify(x)+'\n');
createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line),p=r.params;
 if(r.method==='stats'){write({id:r.id,result:counts});return}
 counts[p.sessionId]=(counts[p.sessionId]??0)+1;
 if(p.sessionId==='rejected'&&counts.rejected===1){write({id:r.id,error:{code:'PIN_REJECTED',delivery:'rejected',message:'Explicit fixture rejection'}});return}
 const receipt={requestId:p.requestId,hostId:'fixture-host',connectionGeneration:7};
 write({id:r.id,result:p.sessionId==='unknown'?{...receipt,status:'unknown',detail:'Simulated lost receipt'}:{...receipt,status:'accepted',value:{pinned:true}}});
});
