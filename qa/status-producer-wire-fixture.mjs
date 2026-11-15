// Local protocol fixture using the real authorization transition/refresh producer.
// Only the credential store and server authorization/list transport are mocked.
import{createInterface}from'node:readline';import{RemoteAdapter}from'../remote/client.mjs';import{preferenceIdentityScope}from'../remote/auth-scope.mjs';
const notes=[];let principal='old@example.invalid';const url='fixture://local';
const a=new RemoteAdapter((method,params,scope)=>notes.push({method,params,scope}));
a.identity={deviceId:'fixture-device'};a.connectionGeneration=7;
a.identityScope=preferenceIdentityScope(url,{account:principal},a.identity.deviceId);
a.credentials={load:async()=>({account:principal,authorizationMethod:'account'})};
a.server={baseUrl:url,authorizeWithAccount:async()=>{principal='new@example.invalid'},hasStoredAuthorization:async()=>true,listDevices:async()=>[]};
const write=x=>process.stdout.write(JSON.stringify(x)+'\n');
createInterface({input:process.stdin}).on('line',async line=>{const r=JSON.parse(line);try{
 let result;
 if(r.method==='fixture.initial')result=a.status();
 else if(r.method==='fixture.notes')result=notes;
 else if(r.method==='fixture.flushOld'){write(notes.filter(x=>x.method==='status')[0]);result=true}
 else if(r.method==='fixture.flushFresh'){write(notes.filter(x=>x.method==='status').at(-1));result=true}
 else result=await a.request(r.method,r.params??{});
 write({id:r.id,result});
}catch(error){write({id:r.id,error:{code:error.code??'FIXTURE_ERROR',message:error.message}})}});
