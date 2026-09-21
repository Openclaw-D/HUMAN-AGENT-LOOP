import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.ts';
import { tokenDirectoryVerifier } from '../src/domain/principal.ts';
import { Kernel } from '../src/domain/kernel.ts';
import { migrate } from '../src/db/db.ts';
import { startHttpServer } from '../src/http/server.ts';
import { startEdgeServer } from '../../Edge/src/server.mjs';
import { createSessionStore } from '../../Edge/src/session.mjs';
import { createUpstreamProxy } from '../../Edge/src/proxy.mjs';
import { createReadProxy } from '../../Edge/src/readproxy.mjs';

test('arrow HTTP: real Edge + A + isolated PG; report writes, recovery and safety', async t => {
  const dbUrl = process.env.ARROW_TEST_DB_URL;
  if (!dbUrl || !/^postgres:\/\/arrow_test:.*@127\.0\.0\.1:\d+\/arrow_test$/.test(dbUrl))
    throw new Error('ARROW_TEST_DB_URL must point to the dedicated arrow_test database/user');
  const pool = new pg.Pool({ connectionString: dbUrl, max: 20 });
  t.after(() => pool.end());
  await migrate(pool);
  const cfg = loadConfig(['--db',dbUrl,'--principal-tokens',[
    'arrow-biz=biz:human:business:all:t1', 'arrow-other=other:human:business:all:t1',
    'arrow-credit=credit:human:credit:all:t1', 'arrow-cross=cross:human:business:all:t2',
    'arrow-customer=customer:human:customer:all:t1', 'arrow-agent=agent:agent:business:all:t1',
  ].join(',')]);
  const verifier = tokenDirectoryVerifier(cfg.principals);
  const kernel = new Kernel(pool,{ config:cfg,verifier });
  let a = await startHttpServer(kernel,0);
  t.after(() => new Promise(resolve => a.close(resolve)));
  let edge;
  const startEdge = async () => {
    const base = `http://127.0.0.1:${a.address().port}`;
    return startEdgeServer({ port:0, seal:{buildId:'arrow-test'},probes:[],store:{},
      auth:async()=>({ok:true}),sessionStore:createSessionStore({}),
      verifyCredential: async ({credential}) => {
        const p = await verifier(credential);
        return p ? {ok:true,...p} : {ok:false};
      },
      proxy:createUpstreamProxy({baseUrl:base,credentialFor:s=>s.credential}),
      readProxy:createReadProxy({baseUrl:base,credentialFor:s=>s.credential}),
    });
  };
  edge = await startEdge();
  t.after(() => edge.close());
  const login = async (token='arrow-biz') => {
    const r = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/session`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({credential:token})});
    return (await r.json()).session.sessionId;
  };
  let sid = await login();
  const call = async (method, path, body, session=sid) => {
    const base=`http://127.0.0.1:${edge.port}`;
    const r=await fetch(base+'/api/jw/v2'+path,{method,headers:{'content-type':'application/json','x-jw-session':session,origin:base},...(body ? {body:JSON.stringify(body)}:{})});
    return {status:r.status,body:await r.json()};
  };
  let n=0;
  const runTag=randomUUID();
  const seed=async()=>{
    const c=await kernel.v2.createCustomer({credential:'arrow-biz',requestId:`seed-${runTag}-${++n}`,tenantId:'t1',displayName:'Synthetic Arrow',legalEntityRef:`SYNTHETIC-${runTag}-${n}`});
    await kernel.v2.registerArtifact({credential:'arrow-biz',requestId:`art-${runTag}-${n}`,tenantId:'t1',kind:'legal_document',content:{synthetic:true,n}},c.customerId);
    return c.customerId;
  };
  const plan=async cid => {
    const r=await call('GET',`/customers/${cid}/advance-plan?domain=business`);
    assert.equal(r.status,200,JSON.stringify(r.body));
    return r.body;
  };
  const bodyOf=(p,id)=>Object.fromEntries(['domain','planId','planHash','expectedVersion','roundNo','actionIds'].map(k=>[k,p[k]]).concat([['requestId',id]]));
  const count=async(sql,cid)=>Number((await pool.query(sql,[cid])).rows[0].n);
  const reportCount=cid=>count('SELECT count(*) n FROM report_views WHERE customer_id=$1',cid);
  const cid=await seed();
  let first;
  await t.test('plan and unexecuted column history are read-only; domain is explicit',async()=>{
    const p=await plan(cid); assert.equal(p.available,true);
    const history=await call('GET',`/customers/${cid}/advance-rounds?domain=policy`);
    assert.equal(history.body.domain,'policy');assert.equal(history.body.state,'not_started');assert.equal(history.body.receipt,null);
    assert.equal(await reportCount(cid),0);
    assert.equal(await count('SELECT count(*) n FROM advance_rounds WHERE customer_id=$1',cid),0);
  });
  await t.test('POST executes existing real report, stores results and downstream waiting task',async()=>{
    const p=await plan(cid);first=bodyOf(p,'round-first');
    const r=await call('POST',`/actions/customers/${cid}/advance-rounds`,first);
    assert.equal(r.status,202,JSON.stringify(r.body));
    assert.equal(r.body.receipt.state,'waiting_evidence',JSON.stringify(r.body));
    assert.equal(r.body.receipt.domain,'business');
    assert.equal(r.body.receipt.actions[0].state,'succeeded');
    assert.equal(r.body.receipt.eventRefs.length,2);
    assert.equal(r.body.receipt.actions[1].state,'succeeded',JSON.stringify(r.body));
    assert.equal(r.body.receipt.businessCandidate.assessment.authority,'none');
    assert.ok(r.body.receipt.businessCandidate.assessment.unknowns.length > 0);
    assert.equal(r.body.receipt.columnResults.length,4);
    for (const v of Object.values(r.body.receipt.views)) {
      assert.equal(v.roundId,r.body.receipt.roundId);
      assert.equal(v.version,r.body.receipt.version);
      assert.equal(v.serverUpdatedAt,r.body.receipt.updatedAt);
    }
    assert.equal(r.body.receipt.views.flow.events.at(-1).at,r.body.receipt.updatedAt);
    const outbox=(await pool.query('SELECT payload FROM outbox_events WHERE event_id=$1',[r.body.receipt.eventRefs.at(-1)])).rows[0];
    assert.equal(outbox.payload.at,r.body.receipt.updatedAt);
    assert.equal(outbox.payload.version,r.body.receipt.version);
    assert.equal(await reportCount(cid),1);
    assert.equal(r.body.receipt.downstream[0].state,'waiting_dependency');
    assert.ok(r.body.receipt.downstream[0].jobId);
    assert.equal(r.body.receipt.columnResults.find(x=>x.itemId==='completion').state,'blocked');
    assert.equal(await count("SELECT count(*) n FROM outbox_events WHERE customer_id=$1 AND event_type='ADVANCE_COLUMN_RESULT'",cid),1);
  });
  await t.test('same ID replay and new ID with valid existing basis do not write another report',async()=>{
    const a1=await call('POST',`/actions/customers/${cid}/advance-rounds`,first);
    assert.equal(a1.status,200);assert.equal(a1.body.reused,true);
    const p=await plan(cid);
    const a2=await call('POST',`/actions/customers/${cid}/advance-rounds`,bodyOf(p,'new-id'));
    assert.equal(a2.status,200);assert.equal(a2.body.receipt.roundId,a1.body.receipt.roundId);
    assert.equal(await reportCount(cid),1);
  });
  await t.test('payload conflict / version change / no forged identity or action subset',async()=>{
    assert.equal((await call('POST',`/actions/customers/${cid}/advance-rounds`,{...first,roundNo:100})).status,409);
    assert.equal((await call('POST',`/actions/customers/${cid}/advance-rounds`,{...first,requestId:'forged',tenantId:'t2'})).status,400);
    const fresh=await seed();const p=await plan(fresh);
    assert.equal((await call('POST',`/actions/customers/${fresh}/advance-rounds`,{...bodyOf(p,'subset'),actionIds:[]})).status,409);
    assert.equal((await call('POST',`/actions/customers/${fresh}/advance-rounds`,{...bodyOf(p,'malformed'),expectedVersion:null})).status,400);
    await kernel.v2.registerArtifact({credential:'arrow-biz',requestId:`changed-${runTag}`,tenantId:'t1',kind:'legal_document',content:{changed:true}},fresh);
    assert.equal((await call('POST',`/actions/customers/${fresh}/advance-rounds`,bodyOf(p,'old-version'))).status,409);
    assert.equal(await reportCount(fresh),0);
  });
  await t.test('cross tenant/person and non-human/customer permissions remain closed',async()=>{
    for(const token of ['arrow-cross','arrow-customer','arrow-agent']){
      const s=await login(token); const r=await call('GET',`/customers/${cid}/advance-plan`,undefined,s);
      assert.ok([403,404].includes(r.status),JSON.stringify(r));
    }
    const other=await login('arrow-other');
    const r=await call('GET',`/customers/${cid}/advance-rounds/by-request/round-first`,undefined,other);
    assert.equal(r.body.found,false);
    const cred=await login('arrow-credit');
    assert.equal((await call('POST',`/actions/customers/${cid}/advance-rounds`,first,cred)).status,403);
  });
  await t.test('parallel advance calls result in one durable action/report',async()=>{
    const c=await seed();const p=await plan(c);const b=bodyOf(p,'parallel');
    const rs=await Promise.all(Array.from({length:6},()=>call('POST',`/actions/customers/${c}/advance-rounds`,b)));
    assert.ok(rs.every(r=>[200,202].includes(r.status)),JSON.stringify(rs));
    assert.equal(await reportCount(c),1);
    assert.equal(await count('SELECT count(*) n FROM advance_rounds WHERE customer_id=$1',c),1);
  });
  await t.test('committed effect then lost response stays unknown; new ID cannot resend',async()=>{
    const c=await seed();const p=await plan(c);const b=bodyOf(p,'lost-response');
    const real=kernel.v2.generateReport;let hits=0;
    kernel.v2.generateReport=async(...args)=>{hits++;await real(...args);throw new Error('synthetic lost acknowledgement');};
    try{
      const r=await call('POST',`/actions/customers/${c}/advance-rounds`,b);
      assert.equal(r.body.receipt.state,'unknown');
      assert.equal((await call('POST',`/actions/customers/${c}/advance-rounds`,b)).body.reused,true);
      assert.equal((await call('POST',`/actions/customers/${c}/advance-rounds`,{...b,requestId:'bypass'})).status,409);
      assert.equal(hits,1);assert.equal(await reportCount(c),1);
    }finally{kernel.v2.generateReport=real;}
    await edge.close();await new Promise(resolve=>a.close(resolve));
    a=await startHttpServer(new Kernel(pool,{config:cfg,verifier}),0);edge=await startEdge();sid=await login();
    const read=await call('GET',`/customers/${c}/advance-rounds/active`);
    assert.equal(read.body.receipt.state,'unknown');
    assert.equal((await call('POST',`/actions/customers/${c}/advance-rounds`,b)).body.reused,true);
    assert.equal(await reportCount(c),1);
  });
  await t.test('GET history after server reconstruction recovers same persisted result and no writes',async()=>{
    const r=await call('GET',`/customers/${cid}/advance-rounds?domain=business`);
    assert.equal(r.body.receipt.requestId,'round-first');assert.equal(r.body.receipt.actions[0].state,'succeeded');
    assert.equal(await reportCount(cid),1);
    assert.equal(r.body.receipt.views.decisions.candidate.analysisRun.runId,r.body.receipt.actions[1].result.runId);
  });
  await t.test('formal credit rejection stops new advance and does not report success',async()=>{
    const c=await seed();
    const ass=await kernel.v2.createAssessment({credential:'arrow-credit',requestId:`reject-seed-${runTag}`,tenantId:'t1',ruleVersion:'synthetic-v1'},c);
    await pool.query("UPDATE credit_assessments SET status='awaiting_human_review' WHERE assessment_id=$1",[ass.assessmentId]);
    await kernel.v2.decideAssessment({credential:'arrow-credit',requestId:`reject-real-${runTag}`,tenantId:'t1',decision:'reject_assessment',rationale:'synthetic rejection test'},ass.assessmentId);
    const p=await plan(c);assert.equal(p.reason,'CREDIT_REJECTED');
    assert.equal((await call('POST',`/actions/customers/${c}/advance-rounds`,bodyOf(p,'reject-stop'))).status,409);
    assert.equal(await reportCount(c),0);
  });
});
