import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { writeFile,mkdir } from 'node:fs/promises';
import { runReadyDomains } from '../../B/src/worker/column-runner.mjs';
import { buildParallelAdvanceRounds } from '../src/domain/advance-round.ts';
import { createIsolatedArrowRuntime,seedCases,HUMAN,SERVICE,TENANT,DOMAINS } from '../scripts/parallel-arrows-runtime.mjs';

test('parallel arrow real HTTP lifecycle, existing commands and persisted versions',async t=>{
  const r=await createIsolatedArrowRuntime({dbUrl:process.env.ARROW_TEST_DB_URL,seedSuffix:randomUUID().slice(0,8),progression:'parallel'});
  t.after(()=>r.close());
  const login=async credential=>{const x=await fetch(r.baseUrl+'/api/jw/v2/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({credential})});return (await x.json()).session.sessionId;};
  const sid=await login(HUMAN);
  const call=async(method,url,body,session=sid)=>{const x=await fetch(r.baseUrl+'/api/jw/v2'+url,{method,
    headers:{'content-type':'application/json','x-jw-session':session,origin:r.baseUrl},...(body?{body:JSON.stringify(body)}:{})});return {status:x.status,body:await x.json()};};
  const get=async(c,domain)=>{const x=await call('GET',`/customers/${c.customerId}/advance-rounds${domain?'?domain='+domain:''}`);assert.equal(x.status,200,JSON.stringify(x.body));return x.body;};
  const start=async(c,domain='business')=>{
    const p=(await call('GET',`/customers/${c.customerId}/advance-plan?domain=${domain}`)).body;
    const b=Object.fromEntries(['domain','planId','planHash','expectedVersion','roundNo','actionIds'].map(k=>[k,p[k]]));b.requestId=randomUUID();
    const x=await call('POST',`/actions/customers/${c.customerId}/advance-rounds`,b);assert.ok([200,202].includes(x.status),JSON.stringify(x));
    await r.advance.drain();return {body:b,response:x,view:await get(c)};
  };
  const choose=async(c,domain,decision='adopt')=>{
    const v=await get(c,domain);const j=v.receipt;
    const b={requestId:randomUUID(),decision,resultId:j.actions[0].result.resultId,expectedVersion:j.version,rationale:'Explicit synthetic test human choice after reading candidate'};
    const x=await call('POST',`/actions/customers/${c.customerId}/advance-rounds/${j.roundId}/decision`,b);
    assert.equal(x.status,200,JSON.stringify(x));return {body:b,response:x,roundId:j.roundId};
  };
  const good=r.cases.find(c=>c.id==='good'),medium=r.cases.find(c=>c.id==='medium'),bad=r.cases.find(c=>c.id==='bad');
  let goodStart;
  await t.test('explicit case manifest maps stable fixture IDs to authorized customers, never inferred names or order',async()=>{
    const x=await call('GET','/arrow-cases');assert.equal(x.status,200);assert.equal(x.body.cases.length,3);
    assert.equal(x.body.cases.find(c=>c.caseId==='parallel-v1-good').customerId,good.customerId);
    assert.ok(x.body.cases.every(c=>c.scenarioIsOutcome===false&&c.transaction.region==='新疆喀什'));
    const cross=await login('arrow-cross');assert.deepEqual((await call('GET','/arrow-cases',null,cross)).body.cases,[]);
  });
  await t.test('five actual analyses execute in independent overlapping workers and await explicit human adoption',async()=>{
    goodStart=await start(good);const v=goodStart.view;
    assert.equal(v.domains.length,5);
    assert.ok(v.domains.every(d=>d.state==='awaiting_confirmation'),JSON.stringify(v.domains));
    const times=v.receipts.map(x=>x.candidate.execution);
    assert.equal(new Set(times.map(x=>x.threadId)).size,5);
    assert.ok(times.some((a,i)=>times.some((b,j)=>i!==j&&Date.parse(a.startedAt)<Date.parse(b.finishedAt)&&Date.parse(b.startedAt)<Date.parse(a.finishedAt))),JSON.stringify(times));
    for(const x of v.receipts){assert.equal(x.candidate.assessment.authority,'none');assert.equal(x.selection,null);
      assert.equal(x.actor.principalId,'arrow-local-service');
      for(const view of Object.values(x.views)){assert.equal(view.version,v.version);assert.equal(view.processId,v.processId);}}
    await mkdir('docs/v0.4/results/parallel-arrows-back',{recursive:true});
    await writeFile('docs/v0.4/results/parallel-arrows-back/PARALLEL_EVIDENCE.json',JSON.stringify({processId:v.processId,
      source:'real C assessStage in worker_threads; explicit synthetic inputs',jobs:v.receipts.map(x=>({domain:x.domain,roundId:x.roundId,
      aRunId:x.actions[0].result.runId,execution:x.candidate.execution}))},null,2));
  });
  await t.test('same HTTP request replays no command; left history reads no extra result',async()=>{
    const x=await call('POST',`/actions/customers/${good.customerId}/advance-rounds`,goodStart.body);
    assert.equal(x.status,200);assert.equal(x.body.reused,true);
    const before=(await r.pool.query('SELECT count(*) n FROM analysis_runs WHERE customer_id=$1',[good.customerId])).rows[0].n;
    await get(good,'business');await get(good,'policy');
    assert.equal((await r.pool.query('SELECT count(*) n FROM analysis_runs WHERE customer_id=$1',[good.customerId])).rows[0].n,before);
  });
  await t.test('business mapping accepts only business; service cannot adopt and candidate authority cannot escalate',async()=>{
    const j=(await get(good,'business')).receipt;const ref=j.actions[0].result;
    const db=(await r.pool.query('SELECT * FROM arrow_jobs WHERE job_id=$1',[j.roundId])).rows[0];
    const frame={tenantId:TENANT,requestId:randomUUID(),domain:'business',deps:db.input.deps,analysisRun:{runId:ref.runId},opinion:{authority:'none'}};
    await assert.rejects(()=>r.kernel.v2.recordDomainResult({...frame,credential:'arrow-only-policy'},ref.packageId),/business/);
    await assert.rejects(()=>r.kernel.v2.recordDomainResult({...frame,credential:HUMAN,requestId:randomUUID(),opinion:{authority:'approved'}},ref.packageId),/authority/);
    await assert.rejects(()=>r.kernel.v2.adoptDomainOpinion({credential:SERVICE,tenantId:TENANT,requestId:randomUUID(),domain:'business',decision:'adopt'},ref.packageId),/human|人类/i);
  });
  await t.test('explicit existing adoption commands produce stable selections and diamond only after five',async()=>{
    for(const domain of DOMAINS){const x=await choose(good,domain);const j=x.response.body.receipt;
      assert.equal(j.selection.candidateId,j.actions[0].result.resultId);
      assert.ok(j.eventRefs.includes(j.selection.eventId));assert.equal(j.selection.by,'arrow-reviewer');
      assert.equal((await call('POST',`/actions/customers/${good.customerId}/advance-rounds/${j.roundId}/decision`,x.body)).status,200);
    }
    const v=await get(good);assert.equal(v.caseOutcome.ending,'diamond');assert.ok(v.domains.every(d=>d.state==='completed'));
  });
  await t.test('medium evidence gap cannot be adopted; registered replacement drives real reevaluation',async()=>{
    await start(medium);let v=await get(medium,'credit');assert.equal(v.receipt.state,'waiting_evidence');
    const fail=await call('POST',`/actions/customers/${medium.customerId}/advance-rounds/${v.receipt.roundId}/decision`,{
      requestId:randomUUID(),decision:'adopt',resultId:v.receipt.actions[0].result.resultId,expectedVersion:v.version});assert.equal(fail.status,409);
    for(const d of ['business','policy','commerce','asset'])await choose(medium,d);
    const before=await get(medium);const saved=new Map(before.receipts.map(j=>[j.domain,{roundId:j.roundId,selection:j.selection,basisVersion:j.basisVersion}]));
    const countBefore=Number((await r.pool.query('SELECT count(*) n FROM analysis_runs WHERE customer_id=$1',[medium.customerId])).rows[0].n);
    await r.kernel.v2.registerArtifact({credential:HUMAN,tenantId:TENANT,requestId:randomUUID(),kind:'financial_statement',factKey:'unrelated_archive_note',grade:'unverified',content:{value:'unrelated fresh note'}},medium.customerId);
    assert.deepEqual((await get(medium)).affectedDomains,[]);
    await start(medium,'business');
    assert.equal(Number((await r.pool.query('SELECT count(*) n FROM analysis_runs WHERE customer_id=$1',[medium.customerId])).rows[0].n),countBefore);
    for(const j of (await get(medium)).receipts)assert.deepEqual(j.selection,saved.get(j.domain).selection);
    await r.kernel.v2.registerArtifact({credential:HUMAN,tenantId:TENANT,requestId:randomUUID(),kind:'financial_statement',factKey:'monthly_operating_cash_flow',grade:'confirmed',
      supersedes:medium.artifacts.monthly_operating_cash_flow,content:{value:200000,sourceMode:'synthetic',revision:2,verificationDocument:'synthetic bank reconciliation'},materialMeta:{unit:'CNY'}},medium.customerId);
    assert.deepEqual((await get(medium)).affectedDomains.sort(),['credit','policy']);
    await start(medium,'credit');v=await get(medium,'credit');assert.equal(v.receipt.state,'awaiting_confirmation',JSON.stringify(v.receipt.candidate));
    assert.equal(Number((await r.pool.query('SELECT count(*) n FROM analysis_runs WHERE customer_id=$1',[medium.customerId])).rows[0].n),countBefore+2);
    const after=await get(medium);assert.deepEqual(after.needsReselection.map(j=>j.domain).sort(),['credit','policy']);
    for(const d of ['business','commerce','asset']){
      const j=after.receipts.find(j=>j.domain===d);assert.equal(j.roundId,saved.get(d).roundId);assert.deepEqual(j.selection,saved.get(d).selection);assert.equal(j.current,true);
    }
    assert.equal(after.receipts.find(j=>j.domain==='policy').selection,null);
    for(const d of ['policy','credit'])await choose(medium,d);
    assert.equal((await get(medium)).caseOutcome.ending,'diamond');
  });
  await t.test('risk comes from low coverage; explicit credit rejection archives and stops later success',async()=>{
    await start(bad);const j=(await get(bad,'credit')).receipt;
    assert.ok(j.candidate.assessment.findingsSuspicion.length>0);
    await choose(bad,'credit','reject');const v=await get(bad);
    assert.equal(v.caseOutcome.ending,'rejection');assert.ok(v.caseOutcome.archiveRef);
    assert.equal(v.domains.find(d=>d.domain==='credit').state,'rejected');
    const p=(await call('GET',`/customers/${bad.customerId}/advance-plan?domain=commerce`)).body;
    assert.equal(p.available,false);assert.equal(p.reason,'CREDIT_REJECTED');
    assert.ok(v.domains.filter(d=>d.domain!=='credit').every(d=>d.state==='stopped'));
  });
  await t.test('read recovery on a new adapter preserves selection/events without launching workers',async()=>{
    let sends=0;const recovered=buildParallelAdvanceRounds(r.kernel,{serviceCredential:SERVICE,runBatch:async()=>{sends++;return [];}});
    const v=await recovered.read(HUMAN,good.customerId,{domain:'business'});
    assert.equal(v.caseOutcome.ending,'diamond');assert.ok(v.receipt.selection.eventId);assert.equal(sends,0);
    const cross=await login('arrow-cross');assert.ok([403,404].includes((await call('GET',`/customers/${good.customerId}/advance-rounds`,null,cross)).status));
  });
  await t.test('worker initialization/compute timeout terminates workers without retry',async()=>{
    const job=(await r.pool.query('SELECT input FROM arrow_jobs WHERE process_id=$1 LIMIT 1',[goodStart.view.processId])).rows[0];
    await assert.rejects(()=>runReadyDomains([{...job.input,jobId:'timeout-check',domain:'business'}],{timeoutMs:1}),/TIMEOUT_UNKNOWN/);
    const controller=new AbortController();controller.abort();
    await assert.rejects(()=>runReadyDomains([{...job.input,jobId:'cancel-check',domain:'business'}],{signal:controller.signal}),/CANCELLED_UNKNOWN/);
  });
  await t.test('active rule version invalidates every domain and unloaded policy never impersonates new rules',async()=>{
    const c=(await seedCases(r.kernel,{suffix:randomUUID().slice(0,8)}))[0];await start(c);
    try{
      await r.kernel.analysis.activateRulePack({credential:HUMAN,tenantId:TENANT,requestId:randomUUID(),version:'isolated-unloaded-v2'});
      assert.deepEqual((await get(c)).affectedDomains.sort(),[...DOMAINS].sort());
      const x=await start(c);assert.ok(x.view.domains.every(d=>d.state==='failed'),JSON.stringify(x.view.domains));
      assert.ok(x.view.receipts.filter(j=>j.roundNo===2).every(j=>j.candidate.reason==='RULE_PACK_VERSION_NOT_LOADED'));
    }finally{await r.kernel.analysis.activateRulePack({credential:HUMAN,tenantId:TENANT,requestId:randomUUID(),version:'1.0.0'});}
  });
  await t.test('credit rejection wins over a late policy result',async()=>{
    const c=(await seedCases(r.kernel,{suffix:randomUUID().slice(0,8)}))[2];
    const original=r.kernel.analysis.finishAnalysisRun;
    let release;const gate=new Promise(resolve=>{release=resolve;});
    let reached;const atPolicy=new Promise(resolve=>{reached=resolve;});
    r.kernel.analysis.finishAnalysisRun=async(frame,id)=>{
      const job=(await r.pool.query('SELECT domain FROM analysis_runs WHERE run_id=$1',[id])).rows[0];
      if(job.domain==='policy'){reached();await gate;}
      return original(frame,id);
    };
    try{
      const p=(await call('GET',`/customers/${c.customerId}/advance-plan?domain=business`)).body;
      const b=Object.fromEntries(['domain','planId','planHash','expectedVersion','roundNo','actionIds'].map(k=>[k,p[k]]));b.requestId=randomUUID();
      assert.equal((await call('POST',`/actions/customers/${c.customerId}/advance-rounds`,b)).status,202);
      await atPolicy;
      await choose(c,'credit','reject');release();await r.advance.drain();
      const v=await get(c,'policy');assert.equal(v.caseOutcome.ending,'rejection');assert.equal(v.receipt.state,'rejected');
      assert.equal(v.receipt.actions[0].result.resultId,null);assert.equal(v.receipt.views.platform.cells.at(-1).state,'rejected');
    }finally{release();r.kernel.analysis.finishAnalysisRun=original;}
  });
  await t.test('committed human adoption then lost response stays unknown and no new ID bypasses it',async()=>{
    const c=(await seedCases(r.kernel,{suffix:randomUUID().slice(0,8)}))[0];await start(c);
    const j=(await get(c,'business')).receipt;const original=r.kernel.v2.adoptDomainOpinion;let calls=0;
    const body={requestId:randomUUID(),decision:'adopt',resultId:j.actions[0].result.resultId,expectedVersion:j.version};
    r.kernel.v2.adoptDomainOpinion=async(...args)=>{calls++;await original(...args);throw new Error('synthetic lost committed adoption response');};
    try{
      const url=`/actions/customers/${c.customerId}/advance-rounds/${j.roundId}/decision`;
      assert.equal((await call('POST',url,body)).status,500);
      assert.equal((await call('POST',url,body)).status,200);
      const v=await get(c,'business');assert.equal(v.receipt.state,'unknown');
      assert.equal((await call('POST',url,{...body,requestId:randomUUID(),expectedVersion:v.version})).status,409);
      assert.equal(calls,1);
      assert.equal((await call('GET',`/customers/${c.customerId}/advance-plan?domain=business`)).body.reason,'ROUND_UNRESOLVED');
      const recovered=buildParallelAdvanceRounds(r.kernel,{serviceCredential:SERVICE,runBatch:runReadyDomains});
      assert.equal((await recovered.read(HUMAN,c.customerId,{domain:'business'})).receipt.state,'unknown');
    }finally{r.kernel.v2.adoptDomainOpinion=original;}
  });
  await t.test('actual Node process restart reads the same committed runs and replays without execution',async()=>{
    const seeded=await seedCases(r.kernel,{suffix:randomUUID().slice(0,8)});const c=seeded[0],interrupted=seeded[1];
    const code=`import {createIsolatedArrowRuntime} from './Back/A/scripts/parallel-arrows-runtime.mjs'; const r=await createIsolatedArrowRuntime({dbUrl:process.env.ARROW_TEST_DB_URL,seed:false});console.log(JSON.stringify({url:r.baseUrl}));`;
    const boot=()=>new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});let out='';
      const timeout=setTimeout(()=>{child.kill();reject(new Error('child runtime startup timeout'));},10000);
      child.once('error',e=>{clearTimeout(timeout);reject(e);});
      child.stdout.on('data',buf=>{out+=buf;const end=out.indexOf('\n');if(end>=0){clearTimeout(timeout);resolve({child,url:JSON.parse(out.slice(0,end)).url});}});
      child.stderr.on('data',()=>{});
    });
    const stop=async child=>{if(child.exitCode!==null)return;await new Promise(resolve=>{child.once('exit',resolve);child.kill();});};
    let child,url;let body,runIds;
    const http=async(method,path,body)=>{
      const s=await fetch(url+'/api/jw/v2/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({credential:HUMAN})});
      const sid=(await s.json()).session.sessionId;
      const res=await fetch(url+'/api/jw/v2'+path,{method,headers:{'content-type':'application/json','x-jw-session':sid,origin:url},...(body?{body:JSON.stringify(body)}:{})});
      return {status:res.status,body:await res.json()};
    };
    try{
      ({child,url}=await boot());const p=(await http('GET',`/customers/${c.customerId}/advance-plan?domain=business`)).body;
      body=Object.fromEntries(['domain','planId','planHash','expectedVersion','roundNo','actionIds'].map(k=>[k,p[k]]));body.requestId=randomUUID();
      assert.equal((await http('POST',`/actions/customers/${c.customerId}/advance-rounds`,body)).status,202);
      let v;const deadline=Date.now()+10000;
      do{v=(await http('GET',`/customers/${c.customerId}/advance-rounds`)).body;
        if(v.domains.every(d=>d.state==='awaiting_confirmation'))break;
        await new Promise(resolve=>setTimeout(resolve,50));
      }while(Date.now()<deadline);
      assert.ok(v.domains.every(d=>d.state==='awaiting_confirmation'),JSON.stringify(v.domains));
      runIds=v.receipts.map(j=>j.actions[0].result.runId).sort();await stop(child);
      ({child,url}=await boot());const recovered=(await http('GET',`/customers/${c.customerId}/advance-rounds`)).body;
      assert.deepEqual(recovered.receipts.map(j=>j.actions[0].result.runId).sort(),runIds);
      assert.equal((await http('POST',`/actions/customers/${c.customerId}/advance-rounds`,body)).status,200);
      assert.equal(Number((await r.pool.query('SELECT count(*) n FROM analysis_runs WHERE customer_id=$1',[c.customerId])).rows[0].n),5);
      const p2=(await http('GET',`/customers/${interrupted.customerId}/advance-plan?domain=business`)).body;
      const b2=Object.fromEntries(['domain','planId','planHash','expectedVersion','roundNo','actionIds'].map(k=>[k,p2[k]]));b2.requestId=randomUUID();
      assert.equal((await http('POST',`/actions/customers/${interrupted.customerId}/advance-rounds`,b2)).status,202);
      await stop(child);
      const before=Number((await r.pool.query('SELECT count(*) n FROM analysis_runs WHERE customer_id=$1',[interrupted.customerId])).rows[0].n);
      ({child,url}=await boot());
      const unknown=(await http('GET',`/customers/${interrupted.customerId}/advance-rounds/active`)).body;
      assert.equal(unknown.receipt.state,'unknown');
      assert.equal((await http('POST',`/actions/customers/${interrupted.customerId}/advance-rounds`,b2)).status,200);
      assert.equal(Number((await r.pool.query('SELECT count(*) n FROM analysis_runs WHERE customer_id=$1',[interrupted.customerId])).rows[0].n),before);
    }finally{if(child)await stop(child);}
  });
});
