import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createIsolatedArrowRuntime,HUMAN} from '../scripts/parallel-arrows-runtime.mjs';

test('column progression starts locked, evaluates one new domain, preserves human selection and replays once',async t=>{
 const r=await createIsolatedArrowRuntime({dbUrl:process.env.ARROW_TEST_DB_URL,seedSuffix:`step-${randomUUID().slice(0,8)}`});
 t.after(()=>r.close());const cid=r.cases.find(c=>c.id==='good').customerId;
 const login=await fetch(r.baseUrl+'/api/jw/v2/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({credential:HUMAN})});const sid=(await login.json()).session.sessionId;
 const call=async(method,path,body)=>{const res=await fetch(r.baseUrl+'/api/jw/v2'+path,{method,headers:{'x-jw-session':sid,origin:r.baseUrl,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await res.json();assert.ok(res.ok,JSON.stringify(data));return data;};
 const read=()=>call('GET',`/customers/${cid}/advance-rounds`);
 assert.equal((await read()).receipts.length,0);
 for(const [index,domain] of ['business','policy','credit','commerce','asset'].entries()){
  const p=await call('GET',`/customers/${cid}/advance-plan?domain=${domain}`);
  const body={requestId:randomUUID(),...Object.fromEntries(['domain','planId','planHash','expectedVersion','roundNo','actionIds'].map(k=>[k,p[k]]))};
  const path=`/actions/customers/${cid}/advance-rounds`;await call('POST',path,body);await r.advance.drain();await call('POST',path,body);
  let v=await read();assert.equal(v.receipts.length,index+1);const row=v.receipts.find(x=>x.domain===domain);
  assert.equal(row.state,'awaiting_confirmation');assert.equal(row.selection,null);
  assert.ok(v.domains.slice(index+1).every(x=>x.state==='not_started'));
  await call('POST',`/actions/customers/${cid}/advance-rounds/${row.roundId}/decision`,{requestId:randomUUID(),decision:'adopt',resultId:row.views.decisions.requiredDecision.resultId,expectedVersion:row.version,rationale:'Explicit test choice after reading this domain'});
  v=await read();assert.equal(v.receipts.find(x=>x.domain===domain).state,'completed');
 }
 const final=await read();assert.equal(final.caseOutcome.status,'completed');assert.equal(final.caseOutcome.ending,'diamond');
 assert.ok(final.receipts.every(x=>x.selection?.decision==='adopt'));
});
