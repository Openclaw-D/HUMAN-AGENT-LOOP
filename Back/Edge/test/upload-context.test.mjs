import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createUploadContextReader } from '../src/upload-context.mjs';

async function fixture(t) {
  const state = { active:true, allowed:true, reads:0, principals:[], onRead:null };
  const reader = createUploadContextReader({
    sessionOf: req => req.headers['x-jw-session']==='session' && state.active ? {sessionId:'session',principalId:'person',credential:'server-only'} : null,
    authorizeUpload: async ({credential,principalId,customerId}) => {
      assert.equal(credential,'server-only');
      return {ok:state.allowed,canRead:true,canUpload:state.allowed,tenantId:'trusted-tenant',customerId,principalId};
    }, fetchContext: async identity => {
      state.reads++; state.principals.push(identity); await state.onRead?.();
      return {customerId:identity.customerId,available:true,reason:null,bindingRef:'opaque-b',invitationId:'opaque-i',
        allowedKinds:['invoice'],allowedObjects:[],expiresAt:'2030-01-01T00:00:00Z',token:'do-not-expose',providerUserId:'do-not-expose'};
    },
  });
  const server=http.createServer(async(req,res)=> {
    const url=new URL(req.url,'http://localhost');
    const result=await reader({req,customerId:url.searchParams.get('cid')});
    res.writeHead(result.status,{'content-type':'application/json'});res.end(JSON.stringify(result.body));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
  const get=async(headers={'x-jw-session':'session'})=> {
    const res=await fetch(`http://127.0.0.1:${server.address().port}/?cid=c&tid=forged`,{headers});
    return {status:res.status,...await res.json()};
  };
  return {state,get};
}
test('isolated HTTP refresh uses session identity and authoritative tenant; forged actor and secret fields ignored',async t=>{
  const f=await fixture(t);
  for(let i=0;i<2;i++) {
    const result=await f.get({'x-jw-session':'session','x-jw-actor-principal':'forged'});
    assert.equal(result.available,true);assert.equal(result.token,undefined);assert.equal(result.providerUserId,undefined);
  }
  assert.deepEqual(f.state.principals,[{tenantId:'trusted-tenant',customerId:'c',principalId:'person'},{tenantId:'trusted-tenant',customerId:'c',principalId:'person'}]);
});
test('missing session or upload grant never calls upstream, read permission is insufficient',async t=>{
  const f=await fixture(t);assert.equal((await f.get({})).status,401);
  f.state.allowed=false;assert.equal((await f.get()).status,403);assert.equal(f.state.reads,0);
  const missing=createUploadContextReader({sessionOf:()=>({principalId:'p'})});
  assert.equal((await missing({req:{},customerId:'c'})).status,503);
});
test('revocation during read suppresses recovered context',async t=>{
  const f=await fixture(t);f.state.onRead=()=>{f.state.allowed=false;};
  assert.equal((await f.get()).status,403);
  f.state.allowed=true;f.state.onRead=()=>{f.state.active=false;};
  assert.equal((await f.get()).status,401);
});
