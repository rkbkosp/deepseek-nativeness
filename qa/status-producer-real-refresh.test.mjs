import test from'node:test';import assert from'node:assert/strict';import{RemoteAdapter}from'../remote/client.mjs';import{preferenceIdentityScope}from'../remote/auth-scope.mjs';
test('real password login refresh advances authority beyond every old-principal status and returns that epoch in RPC',async()=>{
 const notes=[];let principal='old@example.invalid';const url='fixture://local';
 const a=new RemoteAdapter((method,params,scope)=>notes.push({method,params,scope}));a.identity={deviceId:'fixture-device'};a.connectionGeneration=7;a.identityScope=preferenceIdentityScope(url,{account:principal},a.identity.deviceId);
 a.credentials={load:async()=>({account:principal,authorizationMethod:'account'})};a.server={baseUrl:url,authorizeWithAccount:async()=>{principal='new@example.invalid'}};
 const reply=await a.request('login',{email:'new@example.invalid',password:'fixture-only'});const statuses=notes.filter(x=>x.method==='status');
 assert.ok(statuses.length>=2);const old=statuses[0],fresh=statuses.at(-1);
 assert.notEqual(old.scope.accountScope,fresh.scope.accountScope);assert.ok(fresh.scope.generation>old.scope.generation);
 assert.equal(reply.connectionGeneration,fresh.scope.generation);assert.equal(reply.identityScope,fresh.scope.accountScope);assert.equal(reply.authorized,true);
 const epoch=a.connectionGeneration;await a.refreshIdentityScope();assert.equal(a.connectionGeneration,epoch,'same-principal refresh must retain epoch');
 console.log(JSON.stringify({actualRefresh:true,oldGeneration:old.scope.generation,newGeneration:fresh.scope.generation,rpcGeneration:reply.connectionGeneration,network:false}));
});
