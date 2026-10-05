// 02-execution 轮综合验收：五区真实执行链（真实 HTTP + PostgreSQL + worker 执行器）。
// 覆盖任务书验收清单：正常推进/材料缺失/相互矛盾/收入红线/人工拒绝/补证解除/不可豁免阻断/
// 反馈重算/重启恢复/重复提交/权限撤销/旧结果晚到 + 输入敏感性 + 周期生命周期。
// 全部走获准隔离栈（arrow_test 专用库），合成数据；不读任何答案文件，标签不进执行面。
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runReadyDomains } from '../../B/src/worker/column-runner.mjs';
import { buildParallelAdvanceRounds } from '../src/domain/advance-round.ts';
import { createIsolatedArrowRuntime,seedCases,HUMAN,SERVICE,TENANT,DOMAINS } from '../scripts/parallel-arrows-runtime.mjs';

const BASE_FACTS={ entity_identity_verified:true,equipment_ownership_verified:true,equipment_exists_observed:true,
  nameplate_serial:'SYNTHETIC-MACHINE-x',equipment_deal_amount:3000000,
  revenue_annual_declared:22000000,new_order_amount_declared:3000000,litigation_pending_declared:false,
  total_assets_declared:15000000,total_liabilities_declared:6000000,
  monthly_operating_cash_flow:200000,monthly_debt_service:100000,
  top1_customer_revenue_share:30,proposed_monthly_rent:10000,lease_term_months:36,funding_cost_annual:0.03,fees_known:true };
const TRANSACTION={orgType:'commercial_leasing',product:'sale_leaseback',region:'新疆喀什',customerRange:'standard'};
const RUN=randomUUID().slice(0,8); // 每次运行唯一：幂等表/法人编号绝不跨运行复用

test('execution chain 02: five zones real HTTP lifecycle with recovery, feedback, cycles and sensitivity',async t=>{
  const r=await createIsolatedArrowRuntime({dbUrl:process.env.ARROW_TEST_DB_URL,seedSuffix:randomUUID().slice(0,8),progression:'parallel'});
  t.after(async()=>{await r.advance.drain();await r.close();});
  const login=async credential=>{const x=await fetch(r.baseUrl+'/api/jw/v2/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({credential})});return (await x.json()).session.sessionId;};
  const sid=await login(HUMAN);
  const call=async(method,url,body,session=sid)=>{const x=await fetch(r.baseUrl+'/api/jw/v2'+url,{method,
    headers:{'content-type':'application/json','x-jw-session':session,origin:r.baseUrl},...(body?{body:JSON.stringify(body)}:{})});return {status:x.status,body:await x.json()};};
  const get=async(c,domain)=>{const x=await call('GET',`/customers/${c.customerId}/advance-rounds${domain?'?domain='+domain:''}`);assert.equal(x.status,200,JSON.stringify(x.body));return x.body;};
  const plan=async(c,domain='business')=>(await call('GET',`/customers/${c.customerId}/advance-plan?domain=${domain}`)).body;
  const start=async(c,domain='business')=>{
    const p=await plan(c,domain);
    const b=Object.fromEntries(['domain','planId','planHash','expectedVersion','roundNo','actionIds'].map(k=>[k,p[k]]));b.requestId=randomUUID();
    const x=await call('POST',`/actions/customers/${c.customerId}/advance-rounds`,b);
    assert.ok([200,202].includes(x.status),JSON.stringify(x));
    await r.advance.drain();return {body:b,response:x,view:await get(c)};
  };
  const choose=async(c,domain,decision='adopt',session=sid)=>{
    const v=await get(c,domain);const j=v.receipt;
    const b={requestId:randomUUID(),decision,resultId:j.actions[0].result.resultId,expectedVersion:j.version,rationale:'明确人工选择：已阅读候选与依据'};
    const x=await call('POST',`/actions/customers/${c.customerId}/advance-rounds/${j.roundId}/decision`,b,session);
    return {status:x.status,body:x.body,roundId:j.roundId};
  };
  const adoptAll=async c=>{for(const d of DOMAINS){const x=await choose(c,d);assert.equal(x.status,200,JSON.stringify(x.body));}return get(c);};
  const mkCustomer=async(suffix,facts=BASE_FACTS,grades={})=>{
    const cred={credential:HUMAN,tenantId:TENANT};
    const c=await r.kernel.v2.createCustomer({...cred,requestId:`${RUN}:${suffix}:customer`,displayName:`隔离合成执行链-${suffix}`,legalEntityRef:`SYNTHETIC-ARROW-${RUN}-${suffix}`});
    const artifacts={};
    for(const [k,v] of Object.entries({...facts,transaction_scope:TRANSACTION}))
      artifacts[k]=(await r.kernel.v2.registerArtifact({...cred,requestId:`${RUN}:${suffix}:${k}`,kind:'financial_statement',factKey:k,grade:grades[k]??'confirmed',
        content:{value:v,sourceMode:'synthetic',factKey:k},materialMeta:{unit:typeof v==='number'?'CNY':null,caliber:'synthetic_declared'}},c.customerId)).artifactId;
    return {...c,artifacts};
  };
  const reg=async(cid,factKey,value,grade='confirmed')=>r.kernel.v2.registerArtifact({credential:HUMAN,tenantId:TENANT,requestId:randomUUID(),
    kind:'financial_statement',factKey,grade,content:{value,sourceMode:'synthetic',factKey},materialMeta:{unit:typeof value==='number'?'CNY':null,caliber:'synthetic_declared'}},cid);
  const runs=async cid=>Number((await r.pool.query('SELECT count(*) n FROM analysis_runs WHERE customer_id=$1',[cid])).rows[0].n);
  const maxOverlap=intervals=>{
    const ev=intervals.flatMap(x=>[{t:Date.parse(x.startedAt),d:1},{t:Date.parse(x.finishedAt),d:-1}]).sort((a,b)=>a.t-b.t||a.d-b.d);
    let cur=0,max=0;for(const e of ev){cur+=e.d;max=Math.max(max,cur);}return max;};
  const latestProc=async cid=>(await r.pool.query('SELECT process_id FROM arrow_processes WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 1',[cid])).rows[0].process_id;

  const good=r.cases.find(c=>c.id==='good'),medium=r.cases.find(c=>c.id==='medium'),bad=r.cases.find(c=>c.id==='bad');

  await t.test('S1 正常推进：五区真实执行、候选rule_rank、执行清单与并发上限声明',async()=>{
    const s=await start(good);const v=s.view;
    assert.equal(v.domains.length,5);
    assert.ok(v.domains.every(d=>d.state==='awaiting_confirmation'),JSON.stringify(v.domains));
    const manifest=(await plan(good)).zoneManifest;
    assert.equal(manifest.manifestVersion,'zone-manifest-v1');
    assert.equal(manifest.zones.length,5);
    assert.equal(manifest.concurrency.maxParallelDomains,4);
    for(const z of manifest.zones){
      assert.ok(z.inputs&&z.executionIdentity&&z.executor&&z.tools&&z.outputs&&z.gapHandling&&z.humanConfirmation&&z.downstreamTriggers,z.domain);
      assert.equal(z.humanConfirmation.required,true);
    }
    for(const j of v.receipts){
      assert.equal(j.candidate.authority,'none');
      const zc=j.zoneCandidates;
      assert.ok(zc&&zc.ok,JSON.stringify(zc));
      assert.ok(zc.options.length>=1&&zc.options.length<=5,JSON.stringify(zc.options));
      assert.equal(zc.gate.result,'CLEAR');
      for(const o of zc.options){
        assert.equal(o.scoreType,'rule_rank');
        assert.ok(Number.isInteger(o.score));
        assert.ok(!('confidence' in o)&&!('probability' in o),o.label);
      }
    }
    const times=v.receipts.map(x=>x.candidate.execution);
    assert.equal(new Set(times.map(x=>x.threadId)).size,5);
    const overlap=maxOverlap(times);
    assert.ok(overlap<=4&&overlap>=2,`overlap=${overlap}`);
    // 语义辅助未配置：如实409，零出站、零mock
    const jobId=v.receipts[0].roundId;
    const sem=await call('POST',`/actions/customers/${good.customerId}/advance-rounds/${jobId}/semantic`,{requestId:randomUUID()});
    assert.equal(sem.status,409);
    assert.equal(sem.body.error,'MODEL_NOT_CONFIGURED');
  });

  await t.test('S2 材料缺失：无材料拒绝推进；缺关键事实的区如实等待补证',async()=>{
    const cred={credential:HUMAN,tenantId:TENANT};
    const empty=await r.kernel.v2.createCustomer({...cred,requestId:`${RUN}:exec-empty`,displayName:'隔离合成执行链-空材料',legalEntityRef:`SYNTHETIC-ARROW-${RUN}-EMPTY`});
    const p=await plan(empty);assert.equal(p.available,false);assert.equal(p.reason,'MATERIALS_REQUIRED');
    const px=await call('POST',`/actions/customers/${empty.customerId}/advance-rounds`,{requestId:randomUUID(),domain:'business',planId:p.planId,planHash:p.planHash,expectedVersion:p.expectedVersion,roundNo:p.roundNo,actionIds:p.actionIds});
    assert.equal(px.status,409);
    const partial={...BASE_FACTS};delete partial.new_order_amount_declared;
    const c=await mkCustomer('exec-gap',partial);
    const s=await start(c);const j=s.view.receipts.find(j=>j.domain==='business');
    assert.equal(j.state,'waiting_evidence');
    assert.ok(j.candidate.assessment.unknowns.some(u=>u.includes('新订单')),JSON.stringify(j.candidate.assessment.unknowns));
    assert.equal(j.next.reason,'EVIDENCE_GAP');
  });

  await t.test('S3 相互矛盾：来源冲突保留并升级人工核验，冲突未解不可采用',async()=>{
    const c=await mkCustomer('exec-conflict');
    await reg(c.customerId,'equipment_deal_amount',9900000,'confirmed');
    const s=await start(c,'asset');const j=s.view.receipts.find(j=>j.domain==='asset');
    assert.equal(j.state,'waiting_evidence');
    assert.ok(j.candidate.assessment.contradictions.some(x=>x.factKey==='equipment_deal_amount'));
    assert.ok(j.candidate.zoneCandidates.options.some(o=>o.kind==='investigate'));
    const x=await choose(c,'asset');assert.equal(x.status,409);
  });

  await t.test('S4 收入红线：确定性检查阻断推进',async()=>{
    const c=await mkCustomer('exec-redline',{...BASE_FACTS,revenue_annual_declared:60000000});
    const p=await plan(c);assert.equal(p.available,false);assert.equal(p.reason,'CUSTOMER_REVENUE_REDLINE');
    const x=await call('POST',`/actions/customers/${c.customerId}/advance-rounds`,{requestId:randomUUID(),domain:'business',planId:p.planId,planHash:p.planHash,expectedVersion:p.expectedVersion,roundNo:p.roundNo,actionIds:p.actionIds});
    assert.equal(x.status,409);assert.equal(x.body.error,'NOT_READY');
  });

  await t.test('S5 人工拒绝：信审正式拒绝归档流程并停止其余区',async()=>{
    await start(bad);
    const x=await choose(bad,'credit','reject');assert.equal(x.status,200);
    const v=await get(bad);
    assert.equal(v.caseOutcome.ending,'rejection');assert.ok(v.caseOutcome.archiveRef);
    assert.equal(v.domains.find(d=>d.domain==='credit').state,'rejected');
    const p=await plan(bad,'commerce');assert.equal(p.available,false);assert.equal(p.reason,'CREDIT_REJECTED');
  });

  await t.test('S6 补证解除：仅受影响区真实重算，补证后解除并Diamond',async()=>{
    await start(medium);
    let v=await get(medium,'credit');
    assert.equal(v.receipt.state,'waiting_evidence');
    const fail=await choose(medium,'credit');assert.equal(fail.status,409);
    for(const d of ['business','policy','commerce','asset'])await choose(medium,d);
    const before=await runs(medium.customerId);
    const saved=new Map((await get(medium)).receipts.map(j=>[j.domain,{roundId:j.roundId,selection:j.selection}]));
    await reg(medium.customerId,'unrelated_archive_note','与业务无关的新笔记','unverified');
    assert.deepEqual((await get(medium)).affectedDomains,[]);
    const n1=await start(medium,'business');
    assert.equal(await runs(medium.customerId),before);
    for(const j of n1.view.receipts)assert.deepEqual(j.selection,saved.get(j.domain).selection);
    await r.kernel.v2.registerArtifact({credential:HUMAN,tenantId:TENANT,requestId:randomUUID(),kind:'financial_statement',factKey:'monthly_operating_cash_flow',grade:'confirmed',
      supersedes:medium.artifacts.monthly_operating_cash_flow,content:{value:200000,sourceMode:'synthetic',revision:2,verificationDocument:'synthetic bank reconciliation'},materialMeta:{unit:'CNY'}},medium.customerId);
    const affected=(await get(medium)).affectedDomains.sort();
    assert.deepEqual(affected,['credit','policy']);
    await start(medium,'credit');
    assert.equal(await runs(medium.customerId),before+2);
    const vc=await get(medium,'credit');
    assert.equal(vc.receipt.state,'awaiting_confirmation');
    assert.deepEqual((await get(medium)).needsReselection.map(j=>j.domain).sort(),['credit','policy']);
    for(const d of ['policy','credit'])await choose(medium,d);
    assert.equal((await get(medium)).caseOutcome.ending,'diamond');
  });

  await t.test('S7 不可豁免阻断：HARD_BLOCK 不可被采用或置信度覆盖，事实纠正后解除',async()=>{
    const c=await mkCustomer('exec-hardblock',{...BASE_FACTS,equipment_ownership_verified:false});
    const s=await start(c,'asset');const j=s.view.receipts.find(x=>x.domain==='asset');
    assert.equal(j.candidate.zoneCandidates.hardBlock,true,JSON.stringify(j.candidate.zoneCandidates));
    assert.equal(j.candidate.zoneCandidates.gate.result,'HARD_BLOCK');
    const first=j.candidate.zoneCandidates.options[0];
    assert.equal(first.blocking,true);assert.equal(first.score,0);
    const x=await choose(c,'asset');assert.equal(x.status,409);
    const v=await get(c,'asset');
    const x2=await call('POST',`/actions/customers/${c.customerId}/advance-rounds/${v.receipt.roundId}/decision`,
      {requestId:randomUUID(),decision:'adopt',resultId:v.receipt.actions[0].result.resultId,expectedVersion:v.receipt.version,rationale:'人工声明置信度极高，申请覆盖硬阻断'});
    assert.equal(x2.status,409);
    assert.ok(x2.body.message.includes('HARD_BLOCK_NOT_ADOPTABLE'));
    await r.kernel.v2.registerArtifact({credential:HUMAN,tenantId:TENANT,requestId:randomUUID(),kind:'financial_statement',factKey:'equipment_ownership_verified',grade:'confirmed',
      supersedes:c.artifacts.equipment_ownership_verified,content:{value:true,sourceMode:'synthetic',verificationDocument:'synthetic registration check'},materialMeta:{unit:null}},c.customerId);
    const affected=(await get(c)).affectedDomains.sort();
    assert.deepEqual(affected,['asset','policy']);// 权属同时进入政策区规则前提，两区真实重算
    const s2=await start(c,'asset');
    const j2=s2.view.receipts.find(x=>x.domain==='asset');
    assert.equal(j2.state,'awaiting_confirmation');
    assert.equal(j2.zoneCandidates.hardBlock,false);
    const x3=await choose(c,'asset');assert.equal(x3.status,200);
  });

  await t.test('S8 反馈重算：反馈只重算语义层（新运行标识），确定性结果零变化且同版本幂等',async()=>{
    const calls=[];const seen=new Map();
    const stub={describe:()=>({configured:true,model:'stub-semantic@exec02'}),run:async ctx=>{
      // 对齐真实 zone-semantic：同一确定性requestId → 回执复用零出站
      if(seen.has(ctx.requestId))return {...seen.get(ctx.requestId),replayed:true};
      const receipt={status:'succeeded',authority:'none',decisions:[{id:'f1',label:'核对现金流银行回单',impact:'确认覆盖率输入',evidenceRefIds:[],confidence:null}]};
      seen.set(ctx.requestId,receipt);
      calls.push({requestId:ctx.requestId,feedback:ctx.feedback.map(f=>({domain:f.domain,decision:f.decision}))});
      return receipt;
    }};
    const sem=buildParallelAdvanceRounds(r.kernel,{serviceCredential:SERVICE,runBatch:runReadyDomains,semantic:stub});
    const c=await mkCustomer('exec-feedback');
    const p=await sem.getPlan(HUMAN,c.customerId,'business');
    const frame={credential:HUMAN,requestId:randomUUID(),domain:'business',planId:p.planId,planHash:p.planHash,
      expectedVersion:p.expectedVersion,roundNo:p.roundNo,actionIds:p.actionIds};
    await sem.advance(frame,c.customerId);await sem.drain();
    const proc=await latestProc(c.customerId);
    const creditJob=(await r.pool.query("SELECT job_id,state,result,semantic,result_id FROM arrow_jobs WHERE process_id=$1 AND domain='credit' ORDER BY attempt DESC",[proc])).rows[0];
    assert.equal(creditJob.state,'awaiting_confirmation');
    assert.ok(creditJob.semantic&&creditJob.semantic.requestId.endsWith(':semantic-v3:r0'),JSON.stringify(creditJob.semantic));
    assert.equal(creditJob.semantic.status,'succeeded');
    assert.equal(creditJob.semantic.authority,'none');
    const beforeCalls=calls.length;const resultSnapshot=JSON.stringify(creditJob.result);
    // 采纳 business（产生跨区反馈）→ 对仍待确认的 credit 语义层以新反馈版本重算（正确范围：仅语义）
    const bizJob=(await r.pool.query("SELECT job_id,result_id FROM arrow_jobs WHERE process_id=$1 AND domain='business' ORDER BY attempt DESC",[proc])).rows[0];
    const procVersion=Number((await r.pool.query('SELECT version FROM arrow_processes WHERE process_id=$1',[proc])).rows[0].version);
    await sem.decide({credential:HUMAN,requestId:randomUUID(),decision:'adopt',resultId:bizJob.result_id,
      expectedVersion:procVersion,rationale:'采纳商机候选'},c.customerId,bizJob.job_id);
    const rr=await sem.semantic({credential:HUMAN,requestId:randomUUID()},c.customerId,creditJob.job_id);
    assert.equal(rr.ok,true,JSON.stringify(rr));
    assert.ok(rr.receipt.requestId.endsWith(':semantic-v3:r1'),JSON.stringify(rr.receipt));
    assert.ok(calls.at(-1).feedback.some(f=>f.domain==='business'&&f.decision==='adopt'),JSON.stringify(calls.at(-1)));
    assert.equal(calls.length,beforeCalls+1);
    // 同一反馈版本再次请求：确定性请求ID → 回执复用，零新调用
    const replay=await sem.semantic({credential:HUMAN,requestId:randomUUID()},c.customerId,creditJob.job_id);
    assert.equal(replay.receipt.replayed,true);
    assert.equal(calls.length,beforeCalls+1);
    // 确定性结果与状态零变化
    const after=(await r.pool.query('SELECT state,result FROM arrow_jobs WHERE job_id=$1',[creditJob.job_id])).rows[0];
    assert.equal(after.state,'awaiting_confirmation');
    assert.equal(JSON.stringify(after.result),resultSnapshot);
  });

  await t.test('S9 重启恢复：中断先对账为未知；同ID只读重放；新ID产生新尝试并真实执行',async()=>{
    const c=await mkCustomer('exec-recover');
    let release;const blocked=new Promise(res=>{release=res;});
    const stuck=buildParallelAdvanceRounds(r.kernel,{serviceCredential:SERVICE,runBatch:async()=>{await blocked;return [];}});
    const p=await stuck.getPlan(HUMAN,c.customerId,'business');
    const f1={credential:HUMAN,requestId:randomUUID(),domain:'business',planId:p.planId,planHash:p.planHash,expectedVersion:p.expectedVersion,roundNo:p.roundNo,actionIds:p.actionIds};
    await stuck.advance(f1,c.customerId);
    const proc=await latestProc(c.customerId);
    for(let i=0;i<250;i++){const n=Number((await r.pool.query("SELECT count(*) n FROM arrow_jobs WHERE process_id=$1 AND state='running'",[proc])).rows[0].n);if(n===5)break;await new Promise(res=>setTimeout(res,20));}
    assert.equal(Number((await r.pool.query("SELECT count(*) n FROM arrow_jobs WHERE process_id=$1 AND state='running'",[proc])).rows[0].n),5);
    // “进程死亡”：新适配器（其 busy 为空）。同ID重放=只读：不执行、不对账。
    const fresh=buildParallelAdvanceRounds(r.kernel,{serviceCredential:SERVICE,runBatch:runReadyDomains});
    const before=await runs(c.customerId);
    const replay=await fresh.advance({...f1},c.customerId);
    assert.equal(replay.reused,true);
    assert.equal(await runs(c.customerId),before);
    assert.equal(Number((await r.pool.query("SELECT count(*) n FROM outbox_events WHERE event_type='COLUMN_RECONCILED' AND customer_id=$1",[c.customerId])).rows[0].n),0);
    // 新ID推进：先对账（running→unknown+outbox留痕），再以新尝试重排并真实执行
    const p2=await fresh.getPlan(HUMAN,c.customerId,'business');
    assert.equal(p2.available,true,JSON.stringify({reason:p2.reason}));
    assert.ok(p2.recoveryHint);
    const f2={credential:HUMAN,requestId:randomUUID(),domain:'business',planId:p2.planId,planHash:p2.planHash,expectedVersion:p2.expectedVersion,roundNo:p2.roundNo,actionIds:p2.actionIds};
    await fresh.advance(f2,c.customerId);await fresh.drain();
    assert.equal(Number((await r.pool.query("SELECT count(*) n FROM outbox_events WHERE event_type='COLUMN_RECONCILED' AND customer_id=$1",[c.customerId])).rows[0].n),1);
    const jobs=(await r.pool.query('SELECT domain,attempt,state,reason FROM arrow_jobs WHERE process_id=$1 ORDER BY domain,attempt',[proc])).rows;
    for(const d of DOMAINS){
      const old=jobs.find(j=>j.domain===d&&j.attempt===1),now=jobs.find(j=>j.domain===d&&j.attempt===2);
      assert.equal(old.state,'unknown');assert.equal(old.reason,'INTERRUPTED_EXECUTION_RECONCILED');
      assert.equal(now.state,'awaiting_confirmation');
    }
    assert.equal(await runs(c.customerId),before+5);
    release(); // 释放被卡住的旧执行（其结果因尝试过期被丢弃，不覆盖新版本）
  });

  await t.test('S10 重复提交：同ID幂等重放、同ID异载荷拒绝、零重复执行',async()=>{
    const c=await mkCustomer('exec-idem');
    const p=await plan(c);
    const b={requestId:randomUUID(),domain:'business',planId:p.planId,planHash:p.planHash,expectedVersion:p.expectedVersion,roundNo:p.roundNo,actionIds:p.actionIds};
    const x1=await call('POST',`/actions/customers/${c.customerId}/advance-rounds`,b);
    assert.equal(x1.status,202);
    await r.advance.drain();
    const n1=await runs(c.customerId);
    const x2=await call('POST',`/actions/customers/${c.customerId}/advance-rounds`,b);
    assert.equal(x2.status,200);assert.equal(x2.body.reused,true);
    assert.equal(await runs(c.customerId),n1);
    const x3=await call('POST',`/actions/customers/${c.customerId}/advance-rounds`,{...b,planId:'tampered'});
    assert.equal(x3.status,409);assert.equal(x3.body.error,'IDEMPOTENCY_REPLAY_CONFLICT');
    assert.equal(await runs(c.customerId),n1);
  });

  await t.test('S11 权限：单区身份越权拒绝、跨租户不可见、客户授权可撤销',async()=>{
    const c=await mkCustomer('exec-perm');
    const creditOnly=await login('arrow-only-credit');
    const x1=await call('GET',`/customers/${c.customerId}/advance-plan?domain=business`,null,creditOnly);
    assert.equal(x1.status,200);assert.equal(x1.body.available,false);assert.equal(x1.body.reason,'ROLE_FORBIDDEN');
    const x2=await call('POST',`/actions/customers/${c.customerId}/advance-rounds`,{requestId:randomUUID(),domain:'business'},creditOnly);
    assert.equal(x2.status,403);
    const cross=await login('arrow-cross');
    const x3=await call('GET',`/customers/${c.customerId}/advance-rounds`,null,cross);
    assert.ok([403,404].includes(x3.status),JSON.stringify(x3));
    // 撤权纪律：撤销命令仅 admin 可执行（HUMAN 撤销 → 403）；员工类身份按租户+角色裁决，
    // 档案级 grants 约束客户类身份（既定设计），故此处验证撤销命令的权限结构与生效回执。
    await assert.rejects(()=>r.kernel.v2.revokeCustomerAccess({credential:HUMAN,tenantId:TENANT,requestId:randomUUID()},c.customerId,'arrow-reviewer'),
      /admin|ROLE_FORBIDDEN/);
    const rv=await r.kernel.v2.revokeCustomerAccess({credential:'arrow-admin-admin',tenantId:TENANT,requestId:randomUUID()},c.customerId,'arrow-reviewer');
    assert.equal(rv.ok,true);
    // 跨租户写入同样拒绝（未知客户/越权一致失败关闭）
    const x5=await call('POST',`/actions/customers/${c.customerId}/advance-rounds`,{requestId:randomUUID(),domain:'business'},cross);
    assert.ok([403,404].includes(x5.status),JSON.stringify(x5));// 越权一致失败关闭（404=不泄露存在性）
  });

  await t.test('S12 旧结果晚到：拒绝已落地后晚到的其他区结果不得写入',async()=>{
    const c=await mkCustomer('exec-late',{...BASE_FACTS,monthly_operating_cash_flow:40000});
    let release;const gate=new Promise(res=>{release=res;});
    let reached;const atPolicy=new Promise(res=>{reached=res;});
    const orig=r.kernel.analysis.finishAnalysisRun;
    r.kernel.analysis.finishAnalysisRun=async(frame,id)=>{
      const row=(await r.pool.query('SELECT domain FROM analysis_runs WHERE run_id=$1',[id])).rows[0];
      if(row?.domain==='policy'){reached();await gate;}
      return orig(frame,id);
    };
    try{
      const p=await plan(c,'business');
      const b={requestId:randomUUID(),domain:'business',planId:p.planId,planHash:p.planHash,expectedVersion:p.expectedVersion,roundNo:p.roundNo,actionIds:p.actionIds};
      assert.equal((await call('POST',`/actions/customers/${c.customerId}/advance-rounds`,b)).status,202);
      await atPolicy;
      const x=await choose(c,'credit','reject');assert.equal(x.status,200,JSON.stringify(x.body));
      release();await r.advance.drain();
      const proc=await latestProc(c.customerId);
      const policyJob=(await r.pool.query("SELECT state,result_id FROM arrow_jobs WHERE process_id=$1 AND domain='policy' ORDER BY attempt DESC",[proc])).rows[0];
      assert.equal(policyJob.state,'stopped');
      assert.equal(policyJob.result_id,null);
      const v=await get(c,'policy');
      assert.equal(v.caseOutcome.ending,'rejection');
      assert.equal(v.receipt.state,'rejected');
    }finally{r.kernel.analysis.finishAnalysisRun=orig;}
  });

  await t.test('S13 输入敏感性：金额变化改变确定性输出；改名/无关文字零影响',async()=>{
    const c=await mkCustomer('exec-sens');
    const s1=await start(c,'credit');
    const credit1=s1.view.receipts.find(j=>j.domain==='credit').candidate;
    assert.ok(credit1.assessment.knownFacts.some(k=>k.includes('现金流覆盖率 2')),JSON.stringify(credit1.assessment.knownFacts));
    const business1=s1.view.receipts.find(j=>j.domain==='business').candidate;
    await reg(c.customerId,'monthly_operating_cash_flow',90000);
    const affected=(await get(c)).affectedDomains;
    assert.ok(affected.includes('credit'),JSON.stringify(affected));
    assert.ok(!affected.includes('business'));
    const s2=await start(c,'credit');
    const credit2=s2.view.receipts.find(j=>j.domain==='credit').candidate;
    assert.ok(credit2.assessment.knownFacts.some(k=>k.includes('现金流覆盖率 0.9')),JSON.stringify(credit2.assessment.knownFacts));
    assert.notEqual(credit2.assessment.summary,credit1.assessment.summary);
    const business2=s2.view.receipts.find(j=>j.domain==='business').candidate;
    assert.equal(JSON.stringify(business2),JSON.stringify(business1));
    await r.pool.query('UPDATE customers SET display_name=$2 WHERE customer_id=$1',[c.customerId,'改名-不应影响确定性判断']);
    assert.deepEqual((await plan(c)).affectedDomains,[]);
    const business3=(await get(c)).receipts.find(j=>j.domain==='business').candidate;
    assert.equal(JSON.stringify(business3),JSON.stringify(business1));
  });

  await t.test('S14 周期生命周期：履约→待外部回执（如实停）→人工确认回执→结清→关闭→返单',async()=>{
    const v=await adoptAll(good);
    assert.equal(v.caseOutcome.ending,'diamond');
    const open=await call('POST',`/actions/customers/${good.customerId}/cycles`,{requestId:randomUUID()});
    assert.equal(open.status,200,JSON.stringify(open.body));
    const cycle=open.body.cycle;
    assert.equal(cycle.state,'active');assert.equal(cycle.cycleNo,1);
    assert.equal(cycle.basis.adoptedDomains.length,5);
    assert.equal(cycle.externalIntegration.connected,false);
    const fu=await call('POST',`/actions/customers/${good.customerId}/cycles/${cycle.cycleId}/fulfill`,{requestId:randomUUID()});
    assert.equal(fu.status,200);assert.equal(fu.body.cycle.state,'awaiting_external_receipt');
    assert.equal(fu.body.cycle.internalFulfillment.refs.length,5);
    const early=await call('POST',`/actions/customers/${good.customerId}/cycles/${cycle.cycleId}/settle`,{requestId:randomUUID()});
    assert.equal(early.status,409);
    assert.ok(early.body.message.includes('SETTLE_REQUIRES_EXTERNAL_RECEIPT'));
    const v2=await call('GET',`/customers/${good.customerId}/cycles`);
    assert.equal(v2.body.cycles[0].state,'awaiting_external_receipt');
    const rec=await call('POST',`/actions/customers/${good.customerId}/cycles/${cycle.cycleId}/external-receipt`,
      {requestId:randomUUID(),ref:'WIRE-20260925-0001',source:'manual-attestation'});
    assert.equal(rec.status,200);assert.equal(rec.body.cycle.externalReceipt.recordedBy,'arrow-reviewer');
    const st=await call('POST',`/actions/customers/${good.customerId}/cycles/${cycle.cycleId}/settle`,{requestId:randomUUID()});
    assert.equal(st.status,200);assert.equal(st.body.cycle.state,'settled');
    const ro1=await call('POST',`/actions/customers/${good.customerId}/cycles`,{requestId:randomUUID(),reorderOf:cycle.cycleId});
    assert.equal(ro1.status,409);
    assert.ok(ro1.body.message.includes('REORDER_REQUIRES_FRESH_CASE'));
    const cl=await call('POST',`/actions/customers/${good.customerId}/cycles/${cycle.cycleId}/close`,{requestId:randomUUID()});
    assert.equal(cl.status,200);assert.equal(cl.body.cycle.state,'closed');
    // 返单：新一轮五区（新流程、独立依据）完成后开第2期
    const s2=await start(good,'business');
    assert.ok(s2.view.domains.every(d=>d.state==='awaiting_confirmation'),JSON.stringify(s2.view.domains));
    await adoptAll(good);
    const ro2=await call('POST',`/actions/customers/${good.customerId}/cycles`,{requestId:randomUUID(),reorderOf:cycle.cycleId});
    assert.equal(ro2.status,200,JSON.stringify(ro2.body));
    assert.equal(ro2.body.cycle.cycleNo,2);
    assert.equal(ro2.body.cycle.reorderOfCycleId,cycle.cycleId);
    assert.notEqual(ro2.body.cycle.sourceProcessId,cycle.sourceProcessId);
  });

  await t.test('S15 GET零写入与事件追溯：GET前后写表行数不变；by-request返回request/eventJobs并绑定材料版本',async()=>{
    const c=await mkCustomer('exec-getrw');
    const tables=['outbox_events','arrow_events','arrow_jobs','arrow_processes','arrow_requests','analysis_runs','evidence_artifacts','fact_assertions','credit_assessments','decision_packages','package_domain_results','rule_gate_receipts','customers'];
    const count=async t=>Number((await r.pool.query(`SELECT count(*) n FROM ${t}`)).rows[0].n);
    const s=await start(c);
    const afterWrite={};for(const t of tables)afterWrite[t]=await count(t);
    await plan(c);await get(c);await get(c,'credit');await get(c,'business');
    await call('GET',`/customers/${c.customerId}/advance-rounds/active`);
    const byReq=await call('GET',`/customers/${c.customerId}/advance-rounds/by-request/${s.body.requestId}`);
    assert.equal(byReq.status,200,JSON.stringify(byReq.body));
    assert.equal(byReq.body.request.requestId,s.body.requestId);
    assert.equal(byReq.body.request.domain,'business');
    assert.ok(byReq.body.request.jobId);
    assert.equal(byReq.body.request.commandState,'accepted');
    assert.equal(byReq.body.eventJobs.length,5,JSON.stringify(byReq.body.eventJobs));
    for(const j of byReq.body.eventJobs){
      assert.ok(j.jobId&&j.domain&&j.attempt===1,JSON.stringify(j));
      assert.ok(['awaiting_confirmation','waiting_evidence'].includes(j.state),JSON.stringify(j));
      assert.ok(j.basisHash&&j.dependencyVersion==='column-deps-v2',JSON.stringify(j));
      assert.ok(Array.isArray(j.artifactIds)&&j.artifactIds.length>0,JSON.stringify(j));
    }
    const biz=byReq.body.eventJobs.find(j=>j.domain==='business');
    const bizRef=s.view.receipts.find(j=>j.domain==='business');
    assert.deepEqual([...biz.artifactIds].sort(),bizRef.materialRefs.map(m=>m.artifactId).sort());// 步骤绑定材料集合=该区依据实际引用
    for(const t of tables)assert.equal(await count(t),afterWrite[t],`GET 不得写入 ${t}`);
  });

  await t.test('S16 旧依据拒绝：补证后旧候选读面标陈旧；旧依据上的人工确认 409 VERSION_CONFLICT 且零写入',async()=>{
    const c=await mkCustomer('exec-stalebasis');
    const s=await start(c,'credit');
    const j=s.view.receipts.find(j=>j.domain==='credit');
    assert.equal(j.state,'awaiting_confirmation');
    await reg(c.customerId,'monthly_operating_cash_flow',95000);
    const v=await get(c,'credit');
    assert.equal(v.receipt.state,'needs_reassessment',String(v.receipt?.state));// 旧候选标陈旧
    const x=await call('POST',`/actions/customers/${c.customerId}/advance-rounds/${j.roundId}/decision`,
      {requestId:randomUUID(),decision:'adopt',resultId:j.actions[0].result.resultId,expectedVersion:j.version,rationale:'基于旧依据的人工确认应被整体拒绝'});
    assert.equal(x.status,409,JSON.stringify(x.body));
    assert.equal(x.body.error,'VERSION_CONFLICT');
    const db=(await r.pool.query('SELECT state,selection FROM arrow_jobs WHERE job_id=$1',[j.roundId])).rows[0];
    assert.equal(db.state,'awaiting_confirmation');assert.equal(db.selection,null);// 拒绝零写入
  });

  await t.test('S17 周期边界与单效果：未履约不可回执；跨客户 404 不可操作；同ID重放零重复事件',async()=>{
    const list=await call('GET',`/customers/${good.customerId}/cycles`);
    assert.equal(list.status,200);
    const active=list.body.cycles.find(cy=>cy.state==='active');
    assert.ok(active,JSON.stringify(list.body.cycles.map(cy=>[cy.cycleNo,cy.state])));
    const early=await call('POST',`/actions/customers/${good.customerId}/cycles/${active.cycleId}/external-receipt`,{requestId:randomUUID(),ref:'EARLY-S17'});
    assert.equal(early.status,409);assert.ok(early.body.message.includes('RECEIPT_REQUIRES_AWAITING'));
    const mlist=await call('GET',`/customers/${medium.customerId}/cycles`);
    assert.equal(mlist.status,200);assert.equal(mlist.body.found,false);
    const cross=await call('POST',`/actions/customers/${medium.customerId}/cycles/${active.cycleId}/fulfill`,{requestId:randomUUID()});
    assert.ok([403,404].includes(cross.status),JSON.stringify(cross));
    const rid=randomUUID();
    const f1=await call('POST',`/actions/customers/${good.customerId}/cycles/${active.cycleId}/fulfill`,{requestId:rid});
    assert.equal(f1.status,200,JSON.stringify(f1.body));assert.equal(f1.body.cycle.state,'awaiting_external_receipt');
    const ev=async type=>Number((await r.pool.query("SELECT count(*) n FROM outbox_events WHERE event_type=$1 AND customer_id=$2",[type,good.customerId])).rows[0].n);
    const nAwait=await ev('ARROW_CYCLE_AWAITING_EXTERNAL');
    const f2=await call('POST',`/actions/customers/${good.customerId}/cycles/${active.cycleId}/fulfill`,{requestId:rid});
    assert.equal(f2.status,200);assert.equal(f2.body.reused,true);
    assert.equal(await ev('ARROW_CYCLE_AWAITING_EXTERNAL'),nAwait);// 重放单效果
    const rrid=randomUUID();
    const r1=await call('POST',`/actions/customers/${good.customerId}/cycles/${active.cycleId}/external-receipt`,{requestId:rrid,ref:'WIRE-S17',source:'manual-attestation'});
    assert.equal(r1.status,200,JSON.stringify(r1.body));
    const r2=await call('POST',`/actions/customers/${good.customerId}/cycles/${active.cycleId}/external-receipt`,{requestId:rrid,ref:'WIRE-S17',source:'manual-attestation'});
    assert.equal(r2.status,200);assert.equal(r2.body.reused,true);
    const st=await call('POST',`/actions/customers/${good.customerId}/cycles/${active.cycleId}/settle`,{requestId:randomUUID()});
    assert.equal(st.status,200,JSON.stringify(st.body));assert.equal(st.body.cycle.state,'settled');
    assert.equal(st.body.cycle.externalReceipt.ref,'WIRE-S17');
  });
});
