import test from 'node:test';import assert from 'node:assert/strict';
import {RemoteAdapter} from '../remote/client.mjs';
test('diagnostic: actual password login emits old/new account status at the same connection generation',async()=>{
 const notes=[];const a=new RemoteAdapter((method,params,scope)=>notes.push({method,params,scope}));
 a.identityScope='fixture-account-old';a.connectionGeneration=7;a.identity={deviceId:'fixture-device'};a.server={baseUrl:'fixture://local',authorizeWithAccount:async()=>{}};
 a.refreshIdentityScope=async()=>{a.identityScope='fixture-account-new';return a.identityScope};
 await a.request('login',{email:'fixture@example.invalid',password:'local-fixture'});
 const status=notes.filter(x=>x.method==='status');
 assert.equal(status.length,2);assert.equal(status[0].scope.accountScope,'fixture-account-old');assert.equal(status[1].scope.accountScope,'fixture-account-new');
 assert.equal(status[0].scope.generation,status[1].scope.generation);
 console.log(JSON.stringify({diagnostic:'same-generation-account-transition',oldGeneration:status[0].scope.generation,newGeneration:status[1].scope.generation,network:false}));
});
