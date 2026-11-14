import{createInterface}from'node:readline';
const records=[];for await(const line of createInterface({input:process.stdin})){const q=JSON.parse(line);if(q.method==='stats'){process.stdout.write(JSON.stringify({id:q.id,result:records})+'\n');continue}
if(q.method!=='sendMessage'){process.stdout.write(JSON.stringify({id:q.id,error:{code:'INVALID_ARGUMENT',message:'unexpected fixture RPC',delivery:'rejected'}})+'\n');continue}
if(!q.params.content||'text'in q.params||!q.params.clientScope?.hostId)throw Error('invalid content wire');records.push(q.params);const status=q.params.content.some(p=>p.type==='text'&&p.text==='unknown')?'unknown':'accepted';process.stdout.write(JSON.stringify({id:q.id,result:{status,requestId:q.params.requestId}})+'\n');}
