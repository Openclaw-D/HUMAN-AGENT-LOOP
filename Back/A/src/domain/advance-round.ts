import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import type { Kernel } from './kernel.ts';
import { authenticate, requireVerified } from './principal.ts';
import { lookupCustomer, v2Helpers } from './v2kit.ts';
import { canonicalHash, newId } from './util.ts';
import { computeDomainDigest } from './decision-support.ts';
import { conflict, forbidden, invalid, notFound } from './errors.ts';

type Data = Record<string, any>;
const DOMAINS = ['business', 'policy', 'credit', 'commerce', 'asset'];
const POLICY = 'arrow-business-column-v2';
const ACTION = 'report.customer_supplement';
const ACTIONS = [ACTION, 'business.column.evaluate'];
const field = (v: unknown, name: string) => {
  if (typeof v !== 'string' || !v.length || v.length > 128) throw invalid(`${name} 必须为1..128字符`);
  return v;
};

/** First real slice: authorized business supplement report, not a fabricated completed column.
 * Unknown intent is durable before the existing command. No lease stealing or automatic resend.
 * Downstream tasks are real persisted handoffs waiting for authorized executors, never fake running.
 */
export function buildAdvanceRounds(kernel: Kernel, options: {
  execute?: (frame: Data, customerId: string) => Promise<Data>;
} = {}) {
  const inFlight = new Set<string>();
  const execute = options.execute ?? ((frame, customerId) => kernel.v2.generateReport(frame, customerId));

  async function authorize(credential: unknown, customerId: string, write = false) {
    const auth = await authenticate(kernel.verifierForV2(), credential);
    requireVerified(auth);
    const p = auth.principal;
    if (p.kind !== 'human' || p.roles.includes('customer') ||
        !p.roles.some(r => ['business','policy','credit','commerce','asset','admin','jianwei','approver'].includes(r)))
      throw forbidden('PERMISSION_DENIED', '专业列记录仅供获准内部人类身份读取');
    if (write && !p.roles.some(r => ['business','admin'].includes(r)))
      throw forbidden('PERMISSION_DENIED', '本切片仅业务身份可生成业务补件清单');
    const customer = await lookupCustomer(kernel, credential, customerId);
    return { p, customer };
  }

  async function basis(q: Pick<PoolClient, 'query'>, customerId: string) {
    const customer = (await q.query('SELECT customer_id,tenant_id,legal_entity_ref,status,version FROM customers WHERE customer_id=$1', [customerId])).rows[0];
    const materials = (await q.query('SELECT artifact_id,sha256,kind,content,created_at,superseded_by,duplicate_of FROM evidence_artifacts WHERE customer_id=$1 ORDER BY artifact_id', [customerId])).rows;
    const facts = (await q.query('SELECT assertion_id,artifact_id,fact_key,value,grade,created_by,created_at FROM fact_assertions WHERE customer_id=$1 ORDER BY assertion_id', [customerId])).rows;
    const findings = (await q.query('SELECT * FROM decision_findings WHERE customer_id=$1 ORDER BY finding_id', [customerId])).rows;
    const assessments = (await q.query('SELECT assessment_id,status,version,stale FROM credit_assessments WHERE customer_id=$1 ORDER BY assessment_id', [customerId])).rows;
    const confirmations = (await q.query('SELECT pc.confirmation_id,pc.outcome FROM preassessment_confirmations pc JOIN credit_assessments a ON a.assessment_id=pc.assessment_id WHERE a.customer_id=$1 ORDER BY pc.confirmation_id', [customerId])).rows;
    const hash = canonicalHash({ customer, materials, facts, findings, assessments, confirmations });
    return { customer, materials, facts, findings, hash,
      rejected: assessments.some(a => a.status === 'rejected') || confirmations.some(c => c.outcome === 'not_support') };
  }

  async function tx<T>(fn: (q: PoolClient) => Promise<T>): Promise<T> {
    const q = await kernel.pool.connect();
    try { await q.query('BEGIN'); const result = await fn(q); await q.query('COMMIT'); return result; }
    catch (e) { await q.query('ROLLBACK').catch(() => {}); throw e; }
    finally { q.release(); }
  }

  async function project(row: Data, credential: unknown, customerId: string): Promise<Data> {
    const { p } = await authorize(credential, customerId);
    if (row.principal_id !== p.principalId) throw notFound('轮次不存在');
    const current = await basis(kernel.pool, customerId);
    const receipt = structuredClone(row.receipt);
    receipt.current = receipt.basisVersion.dependencyDigest === current.hash;
    if (inFlight.has(receipt.roundId)) receipt.state = 'running';
    receipt.downstream = (await kernel.pool.query('SELECT job_id AS "jobId",domain,state,reason,dependency_hash AS "dependencyDigest" FROM advance_column_tasks WHERE round_id=$1 ORDER BY domain', [receipt.roundId])).rows;
    if (current.rejected) {
      receipt.state = 'rejected'; receipt.next = { canAdvance: false, reason: 'CREDIT_REJECTED' };
      receipt.downstream = receipt.downstream.map((job: Data) => ({ ...job, state: 'stopped', reason: 'CREDIT_REJECTED' }));
    }
    const context = { customerId, processId: receipt.processId, roundId: receipt.roundId,
      domain: receipt.domain, version: receipt.version, basisVersion: receipt.basisVersion,
      current: receipt.current, serverUpdatedAt: receipt.updatedAt };
    receipt.views = {
      platform: { ...context, state: receipt.state, cells: receipt.columnResults, downstream: receipt.downstream, next: receipt.next },
      materials: { ...context, items: receipt.materialRefs },
      decisions: { ...context, candidate: receipt.businessCandidate ?? null, authority: 'none', selection: null,
        reason: 'HUMAN_VERIFICATION_REQUIRED' },
      flow: { ...context, events: receipt.timeline ?? [], eventRefs: receipt.eventRefs },
      history: { ...context, actor: receipt.actor, acceptedAt: receipt.acceptedAt, actions: receipt.actions },
    };
    await authorize(credential, customerId);
    return receipt;
  }

  async function getPlan(credential: unknown, customerId: string, domain = 'business') {
    if (!DOMAINS.includes(domain)) throw invalid('未知专业列');
    const { p, customer } = await authorize(credential, customerId);
    const b = await basis(kernel.pool, customerId);
    const rows = (await kernel.pool.query('SELECT * FROM advance_rounds WHERE customer_id=$1 ORDER BY round_no DESC', [customerId])).rows;
    const active = rows.find(r => r.receipt.state === 'unknown');
    const prior = rows.find(r => r.domain === domain && r.basis_hash === b.hash && r.principal_id === p.principalId && r.receipt.state !== 'unknown');
    const reason = b.rejected ? 'CREDIT_REJECTED' : active ? 'ROUND_UNRESOLVED' :
      !String(customer.legal_entity_ref).startsWith('SYNTHETIC-') ? 'SYNTHETIC_ONLY' :
      domain !== 'business' ? 'COLUMN_EXECUTOR_NOT_CONNECTED' :
      !p.roles.some(r => ['business','admin'].includes(r)) ? 'ROLE_FORBIDDEN' :
      !b.materials.some(a => !a.superseded_by && !a.duplicate_of) ? 'MATERIALS_REQUIRED' : null;
    const expectedVersion = { customerRevision: Number(customer.version), dependencyDigest: b.hash };
    const planHash = canonicalHash({ policy: POLICY, customerId, principalId: p.principalId, domain, expectedVersion, actionIds: ACTIONS });
    await authorize(credential, customerId);
    return { ok: true, customerId, domain, processId: `arrow:${customerId}`, available: !reason,
      reason, state: reason === 'CREDIT_REJECTED' ? 'rejected' : prior?.receipt.state ?? (active ? 'unknown' : 'not_started'),
      planId: planHash, planHash, policyVersion: POLICY, expectedVersion,
      roundNo: prior?.round_no ?? Number(rows[0]?.round_no ?? 0) + 1,
      reused: Boolean(prior), resultRef: prior?.round_id ?? null,
      summary: '生成业务补件报告并执行有来源的商机候选分析；材料核验及意见采用仍需有权人确认',
      actionIds: ACTIONS, allowedActions: [{ actionId: ACTION, commandKind: 'report.generate', requiresHumanConfirmation: false },
        { actionId: 'business.column.evaluate', commandKind: 'business.column.evaluate', requiresHumanConfirmation: false, authority: 'none' }],
      materialRefs: b.materials.map(a => ({ artifactId: a.artifact_id, hash: a.sha256, supersededBy: a.superseded_by, domain: null })),
      downstreamPlan: [{ domain: 'policy', state: 'waiting_dependency', reason: 'AUTHORIZED_POLICY_EXECUTOR_REQUIRED' }],
      fullColumnReady: false,
      completionBlockers: [{ code: 'HUMAN_VERIFICATION_REQUIRED', message: '本次候选尚无独立人工核验/采用回执，整列不可办结' }],
      blockers: reason ? [{ code: reason }] : [] };
  }

  async function advance(frame: Data, customerId: string): Promise<Data> {
    const requestId = field(frame.requestId, 'requestId');
    const domain = field(frame.domain, 'domain');
    const { p, customer } = await authorize(frame.credential, customerId, true);
    if (domain !== 'business') throw conflict('NOT_READY', 'COLUMN_EXECUTOR_NOT_CONNECTED');
    const allowed = new Set(['credential','__path','requestId','domain','planId','planHash','expectedVersion','roundNo','actionIds']);
    if (Object.keys(frame).some(k => !allowed.has(k))) throw invalid('推进不接受客户端身份、任意动作或结果字段');
    field(frame.planId, 'planId');
    field(frame.planHash, 'planHash');
    if (!frame.expectedVersion || typeof frame.expectedVersion !== 'object' ||
        !Number.isInteger(frame.expectedVersion.customerRevision) || typeof frame.expectedVersion.dependencyDigest !== 'string' ||
        !Number.isInteger(frame.roundNo) || frame.roundNo < 1 || !Array.isArray(frame.actionIds) ||
        !frame.actionIds.every((id: unknown) => typeof id === 'string')) throw invalid('推进计划字段无效');
    const payloadHash = canonicalHash({ domain, planId: frame.planId, planHash: frame.planHash,
      expectedVersion: frame.expectedVersion, roundNo: frame.roundNo, actionIds: frame.actionIds });
    const claimed = await tx(async q => {
      await q.query('SELECT customer_id FROM customers WHERE customer_id=$1 FOR UPDATE', [customerId]);
      const prior = (await q.query('SELECT * FROM advance_rounds WHERE tenant_id=$1 AND customer_id=$2 AND principal_id=$3 AND request_id=$4', [customer.tenant_id, customerId, p.principalId, requestId])).rows[0];
      if (prior) {
        if (prior.payload_hash !== payloadHash) throw conflict('IDEMPOTENCY_REPLAY_CONFLICT', '同ID载荷不同');
        return { row: prior, reused: true };
      }
      const plan = await getPlan(frame.credential, customerId, domain);
      if (!plan.available) throw conflict('NOT_READY', plan.reason ?? 'NOT_READY');
      if (frame.planId !== plan.planId || frame.planHash !== plan.planHash || canonicalHash(frame.expectedVersion) !== canonicalHash(plan.expectedVersion) ||
          frame.roundNo !== plan.roundNo || canonicalHash(frame.actionIds) !== canonicalHash(plan.actionIds))
        throw conflict('VERSION_CONFLICT', '计划、列动作或依据已改变，请重新读取');
      if (plan.reused) {
        const row = (await q.query('SELECT * FROM advance_rounds WHERE round_id=$1', [plan.resultRef])).rows[0];
        return { row, reused: true };
      }
      const roundId = newId('round');
      const eventId = randomUUID();
      const at = new Date().toISOString();
      const receipt = { requestId, roundId, processId: `arrow:${customerId}`, customerId, tenantId: customer.tenant_id,
        domain, roundNo: plan.roundNo, version: 1, domainVersion: plan.expectedVersion.dependencyDigest,
        actor: { principalId: p.principalId, roles: p.roles }, acceptedAt: at, updatedAt: at,
        state: 'unknown', current: true, basisVersion: plan.expectedVersion, materialRefs: plan.materialRefs,
        actions: [{ actionId: ACTION, requestId: `${roundId}:report`, state: 'unknown', sent: null },
          { actionId: 'business.column.evaluate', requestId: `${roundId}:business`, state: 'pending', sent: false }],
        timeline: [{ eventId, type: 'ADVANCE_ROUND_ACCEPTED', at, domain, roundId, version: 1, actor: p.principalId }],
        columnResults: [], eventRefs: [eventId], confidence: { value: null, calibration: 'unknown' },
        next: { canAdvance: false, reason: 'ROUND_UNRESOLVED' } };
      await q.query('INSERT INTO advance_rounds(round_id,tenant_id,customer_id,principal_id,request_id,domain,round_no,basis_hash,payload_hash,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [roundId,customer.tenant_id,customerId,p.principalId,requestId,domain,plan.roundNo,plan.expectedVersion.dependencyDigest,payloadHash,JSON.stringify(receipt)]);
      await q.query('INSERT INTO outbox_events(event_id,event_type,customer_id,payload) VALUES($1,$2,$3,$4)', [eventId,'ADVANCE_ROUND_ACCEPTED',customerId,JSON.stringify({ roundId,domain,requestId,actor: p.principalId,at })]);
      await v2Helpers(q).audit({ actor: p.principalId, action: 'advance.accepted', targetType: 'round', targetId: roundId, summary: '业务列补件清单请求持久接受' });
      return { row: { round_id: roundId, principal_id: p.principalId, receipt }, reused: false };
    });
    const row = claimed.row;
    if (claimed.reused) return { ok: true, reused: true, receipt: await project(row, frame.credential, customerId) };
    inFlight.add(row.round_id);
    try {
      await authorize(frame.credential, customerId, true);
      const before = await basis(kernel.pool, customerId);
      if (before.rejected || before.hash !== row.receipt.basisVersion.dependencyDigest)
        throw conflict('VERSION_CONFLICT', '发送前依据已变更，未发送');
      const result = await execute({ credential: frame.credential, requestId: `${row.round_id}:report`,
        tenantId: customer.tenant_id, kind: 'customer_supplement', subjectId: customerId }, customerId);
      const evaluatedAt = new Date().toISOString();
      const { runBusinessColumn } = await import(new URL('../../../B/src/worker/column-runner.mjs', import.meta.url).href);
      const candidate = runBusinessColumn({ ...before, evaluatedAt });
      await authorize(frame.credential, customerId, true);
      const after = await basis(kernel.pool, customerId);
      const resultEventId = randomUUID();
      const receipt = { ...row.receipt, version: 2, updatedAt: evaluatedAt,
        eventRefs: [...row.receipt.eventRefs, resultEventId],
        businessCandidate: candidate,
        timeline: [...row.receipt.timeline, { eventId: resultEventId, type: 'ADVANCE_COLUMN_RESULT', at: evaluatedAt,
          domain, roundId: row.round_id, version: 2, actor: p.principalId, reportId: result.reportId }],
        state: after.rejected ? 'rejected' : after.hash !== before.hash ? 'needs_reassessment' :
          !candidate.ok || candidate.assessment?.unknowns.length || candidate.assessment?.contradictions.length ||
          candidate.assessment?.findingsSuspicion.length || candidate.unreadable?.length ||
          after.findings.some(f => f.status === 'open') ? 'waiting_evidence' : 'awaiting_confirmation',
        current: after.hash === before.hash,
        actions: [{ actionId: ACTION, requestId: `${row.round_id}:report`, state: 'succeeded', sent: true, result },
          { actionId: 'business.column.evaluate', requestId: `${row.round_id}:business`, state: candidate.ok ? 'succeeded' : 'failed', sent: true,
            result: { runId: candidate.analysisRun?.runId ?? null, authority: 'none', reason: candidate.reason ?? null } }],
        columnResults: [
          { itemId: 'materials', state: 'recorded', materialRefs: row.receipt.materialRefs },
          { itemId: 'analysis', state: candidate.ok ? 'completed' : 'blocked', authority: 'none',
            resultRef: candidate.analysisRun?.runId ?? null, result: candidate },
          { itemId: 'verification', state: 'awaiting_confirmation', reason: 'HUMAN_VERIFICATION_REQUIRED' },
          { itemId: 'completion', state: 'blocked', reason: 'REQUIRED_COLUMN_RESULTS_INCOMPLETE' }],
        next: { canAdvance: false, reason: 'REQUIRED_COLUMN_RESULTS_INCOMPLETE' } };
      await tx(async q => {
        await q.query('UPDATE advance_rounds SET receipt=$2 WHERE round_id=$1', [row.round_id,JSON.stringify(receipt)]);
        const jobId = `${row.round_id}:policy`;
        await q.query('INSERT INTO advance_column_tasks(job_id,round_id,domain,dependency_hash,state,reason) VALUES($1,$2,$3,$4,$5,$6)',
          [jobId,row.round_id,'policy',after.hash,after.rejected ? 'stopped' : 'waiting_dependency',after.rejected ? 'CREDIT_REJECTED' : 'AUTHORIZED_POLICY_EXECUTOR_REQUIRED']);
        await q.query('INSERT INTO outbox_events(event_id,event_type,customer_id,payload) VALUES($1,$2,$3,$4)',
          [resultEventId,'ADVANCE_COLUMN_RESULT',customerId,JSON.stringify({ roundId: row.round_id, domain, version: receipt.version,
            at: receipt.updatedAt, actor: p.principalId, requestId, reportId: result.reportId, candidateRunId: candidate.analysisRun?.runId ?? null,
            state: receipt.state, jobId })]);
        return null;
      });
      row.receipt = receipt;
    } catch {
      // Intent remains durable unknown even on ambiguous command/storage failure. Never resend.
    } finally { inFlight.delete(row.round_id); }
    return { ok: true, reused: false, receipt: await project(row, frame.credential, customerId) };
  }

  async function read(credential: unknown, customerId: string, query: { domain?: string; roundId?: string; requestId?: string; active?: boolean } = {}) {
    const { p } = await authorize(credential, customerId);
    if (query.domain && !DOMAINS.includes(query.domain)) throw invalid('未知专业列');
    const rows = (await kernel.pool.query('SELECT * FROM advance_rounds WHERE customer_id=$1 AND principal_id=$2 ORDER BY round_no DESC', [customerId,p.principalId])).rows;
    const matching = rows.filter(r => (!query.domain || r.domain === query.domain) && (!query.roundId || r.round_id === query.roundId) && (!query.requestId || r.request_id === query.requestId) && (!query.active || r.receipt.state === 'unknown'));
    const receipts = [];
    for (const row of matching) receipts.push(await project(row, credential, customerId));
    await authorize(credential,customerId);
    return { ok: true, customerId, domain: query.domain ?? null, found: receipts.length > 0,
      state: receipts[0]?.state ?? 'not_started', receipt: receipts[0] ?? null, receipts };
  }
  return { getPlan, advance, read };
}

/** Full synthetic process adapter, injected only by the isolated runtime with an explicit service identity. */
export function buildParallelAdvanceRounds(kernel: Kernel, options: { serviceCredential: string;
  progression?: 'column' | 'parallel';
  runBatch: (inputs: Data[]) => Promise<Data[]> }) {
  const busy = new Set<string>();
  const pending = new Set<Promise<unknown>>();
  const policy = 'parallel-columns-v1';
  async function tx<T>(fn: (q: PoolClient) => Promise<T>) {
    const q = await kernel.pool.connect();
    try { await q.query('BEGIN'); const v=await fn(q);await q.query('COMMIT');return v; }
    catch(e) { await q.query('ROLLBACK');throw e; } finally {q.release();}
  }
  async function auth(credential: unknown, cid: string, domain?: string) {
    const a=await authenticate(kernel.verifierForV2(),credential);requireVerified(a);
    if(a.principal.kind!=='human'||a.principal.roles.includes('customer')) throw forbidden('PERMISSION_DENIED','内部人类身份必需');
    if(domain&&!a.principal.roles.includes(domain)) throw forbidden('PERMISSION_DENIED',`需要 ${domain} 角色`);
    const customer=await lookupCustomer(kernel,credential,cid);
    if(!String(customer.legal_entity_ref).startsWith('SYNTHETIC-')) throw forbidden('PERMISSION_DENIED','仅隔离合成演练');
    return {p:a.principal,customer};
  }
  async function input(cid: string,q: any=kernel.pool) {
    const customer=(await q.query('SELECT * FROM customers WHERE customer_id=$1',[cid])).rows[0];
    const materials=(await q.query('SELECT * FROM evidence_artifacts WHERE customer_id=$1 AND superseded_by IS NULL AND duplicate_of IS NULL ORDER BY artifact_id',[cid])).rows;
    const facts=(await q.query('SELECT f.* FROM fact_assertions f JOIN evidence_artifacts a ON a.artifact_id=f.artifact_id WHERE f.customer_id=$1 AND a.superseded_by IS NULL AND a.duplicate_of IS NULL ORDER BY f.assertion_id',[cid])).rows;
    const rule=(await q.query("SELECT version FROM rule_pack_versions WHERE status='active' LIMIT 1")).rows[0]?.version;
    const deps={artifactIds:materials.map((m: Data)=>m.artifact_id),factKeys:[...new Set(facts.map((f: Data)=>f.fact_key))] as string[],rulePackVersion:rule??null};
    const {describeColumnDependencies}=await import(new URL('../../../B/src/worker/column-dependencies.mjs',import.meta.url).href);
    const domains:Data=describeColumnDependencies({customer,materials,facts,ruleVersion:rule??null});
    for(const d of DOMAINS)domains[d].hash=canonicalHash({version:domains[d].version,semantic:domains[d].semanticHash,
      commandDigest:await computeDomainDigest(q,cid,domains[d].deps)});
    const hash=canonicalHash(Object.fromEntries(DOMAINS.map(d=>[d,domains[d].hash])));
    return {customer,materials,facts,deps,hash,domains};
  }
  async function processFor(cid: string,principal: string,q: any=kernel.pool) {
    return (await q.query('SELECT * FROM arrow_processes WHERE customer_id=$1 AND principal_id=$2 ORDER BY created_at DESC LIMIT 1',[cid,principal])).rows[0];
  }
  async function emit(q: PoolClient,pid: string,type: string,domain: string|null,jobId: string|null,payload: Data,eventId?: string) {
    const p=(await q.query('UPDATE arrow_processes SET version=version+1,updated_at=clock_timestamp() WHERE process_id=$1 RETURNING *',[pid])).rows[0];
    const eid=eventId??randomUUID(); const at=p.updated_at.toISOString();
    const body={...payload,processId:pid,version:p.version,at,domain,jobId};
    await q.query('INSERT INTO arrow_events(event_id,process_id,version,event_type,domain,job_id,payload,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[eid,pid,p.version,type,domain,jobId,JSON.stringify(body),at]);
    await q.query('INSERT INTO outbox_events(event_id,event_type,customer_id,payload) VALUES($1,$2,$3,$4)',[eid,type,p.customer_id,JSON.stringify(body)]);
    return eid;
  }
  const latestJobs=(rows: Data[])=>DOMAINS.map(d=>rows.find(r=>r.domain===d)).filter(Boolean) as Data[];
  async function getPlan(credential: unknown,cid: string,domain='business') {
    if(!DOMAINS.includes(domain)) throw invalid('未知专业');
    const {p}=await auth(credential,cid);const b=await input(cid);const proc=await processFor(cid,p.principalId);
    const jobs=proc?latestJobs((await kernel.pool.query('SELECT * FROM arrow_jobs WHERE process_id=$1 ORDER BY attempt DESC',[proc.process_id])).rows):[];
    const hit=jobs.find(j=>j.domain===domain);const unknown=jobs.some(j=>['unknown','running','queued'].includes(j.state));
    const revenue=b.facts.filter((f:Data)=>f.fact_key==='revenue_annual_declared').map((f:Data)=>f.value?.value??f.value);
    const reason=proc?.state==='rejected'?'CREDIT_REJECTED':proc?.state==='completed'?'CASE_COMPLETED':
      revenue.some((v:unknown)=>typeof v==='number'&&v>50000000)?'CUSTOMER_REVENUE_REDLINE':
      !p.roles.includes(domain)?'ROLE_FORBIDDEN':!b.deps.rulePackVersion?'RULES_NOT_CONFIGURED':!b.materials.length?'MATERIALS_REQUIRED':
      unknown?'ROUND_UNRESOLVED':hit&&hit.basis_hash===b.domains[domain].hash&&hit.state==='awaiting_confirmation'?'HUMAN_SELECTION_REQUIRED':null;
    const expectedVersion={processVersion:proc?.version??0,dependencyDigest:b.hash};
    const planHash=canonicalHash({policy,cid,principal:p.principalId,domain,expectedVersion});
    return {ok:true,customerId:cid,processId:proc?.process_id??null,domain,available:!reason,reason,
      state:hit?.state??'not_started',expectedVersion,planId:planHash,planHash,policyVersion:policy,
      roundNo:(hit?.attempt??0)+1,actionIds:['columns.evaluate'],reused:Boolean(hit&&hit.basis_hash===b.domains[domain].hash&&hit.state==='completed'),
      affectedDomains:DOMAINS.filter(d=>{const j=jobs.find(j=>j.domain===d);return !j||j.basis_hash!==b.domains[d].hash;}),
      resultRef:hit?.job_id??null,allowedActions:[{actionId:'columns.evaluate',commandKind:'columns.evaluate',requiresHumanConfirmation:false,authority:'none'}],
      requiredDecision:hit?.state==='awaiting_confirmation'?{roundId:hit.job_id,resultId:hit.result_id,choices:['adopt','set_aside',...(domain==='credit'?['reject']:[])]}:hit?.state==='waiting_evidence'&&domain==='credit'&&hit.result_id?{roundId:hit.job_id,resultId:hit.result_id,choices:['reject']}:null,
      materialRefs:b.materials.map((m:Data)=>({artifactId:m.artifact_id,hash:m.sha256})),
      summary:'按就绪依赖执行专业候选；已有有效结果复用，明确选择后调用人类采用命令'};
  }
  async function read(credential:unknown,cid:string,query:{domain?:string;roundId?:string;requestId?:string;active?:boolean}={}) {
    const {p}=await auth(credential,cid);if(query.domain&&!DOMAINS.includes(query.domain))throw invalid('未知专业');
    // One repeatable-read snapshot supplies every view and every domain, including timeline.
    const snapshot=await tx(async q=>{
      await q.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const proc=await processFor(cid,p.principalId,q);if(!proc)return null;
      const rows=(await q.query('SELECT * FROM arrow_jobs WHERE process_id=$1 ORDER BY attempt DESC,domain',[proc.process_id])).rows;
      const events=(await q.query('SELECT * FROM arrow_events WHERE process_id=$1 ORDER BY version',[proc.process_id])).rows;
      const request=query.requestId?(await q.query('SELECT * FROM arrow_requests WHERE process_id=$1 AND request_id=$2',[proc.process_id,query.requestId])).rows[0]:null;
      return {proc,rows,events,request,basis:await input(cid,q)};
    });
    if(!snapshot)return {ok:true,found:false,state:'not_started',receipt:null,receipts:[],domains:[]};
    const {proc,rows,events,request,basis}=snapshot;
    const latest=latestJobs(rows);
    const status=(j:Data)=>j.state==='rejected'?'rejected':proc.state==='rejected'&&j.state!=='completed'?'stopped':proc.state!=='in_progress'?j.state:j.basis_hash!==basis.domains[j.domain].hash?'stale':
      ['running','queued'].includes(j.state)&&!busy.has(proc.process_id)?'unknown':j.state;
    const domains=DOMAINS.map(domain=>{const j=latest.find(j=>j.domain===domain);return {domain,state:j?status(j):'not_started',roundId:j?.job_id??null};});
    const affectedDomains=latest.filter(j=>j.basis_hash!==basis.domains[j.domain].hash||
      (j.attempt>1&&!['completed','rejected','stopped'].includes(j.state))).map(j=>j.domain);
    const changedEvent=[...events].reverse().find(e=>e.event_type==='COLUMN_DEPENDENCIES_CHANGED');
    const dependencyChange=changedEvent?{eventId:changedEvent.event_id,...changedEvent.payload}:null;
    const needsReselection=latest.filter(j=>j.state==='awaiting_confirmation'&&j.basis_hash===basis.domains[j.domain].hash).map(j=>({domain:j.domain,roundId:j.job_id,resultId:j.result_id,reason:'新结果需明确选择'}));
    const outcome={processId:proc.process_id,status:proc.state,version:proc.version,terminalEventId:proc.terminal_ref,archiveRef:proc.archive_ref,
      ending:proc.state==='completed'?'diamond':proc.state==='rejected'?'rejection':null,sourceMode:'synthetic'};
    const receipts=rows.filter(j=>(!query.domain||j.domain===query.domain)&&(!query.roundId||j.job_id===query.roundId)&&
      (!query.requestId||request?.job_id===j.job_id)&&(!query.active||['running','queued','unknown'].includes(j.state))).map(j=>{
      const context={customerId:cid,processId:proc.process_id,roundId:j.job_id,domain:j.domain,version:proc.version,
        basisVersion:j.basis_hash,current:j.basis_hash===basis.domains[j.domain].hash,serverUpdatedAt:proc.updated_at};
      const candidate=j.result?.assessment??null; const actualState=status(j);
      const currentState=actualState==='queued'?'accepted':actualState==='stale'?'needs_reassessment':actualState==='stopped'?'rejected':actualState;
      const materials=j.input.materials.filter((a:Data)=>j.input.deps.artifactIds.includes(a.artifact_id)).map((a:Data)=>({artifactId:a.artifact_id,hash:a.sha256,kind:a.kind,content:a.content}));
      const cells=[{itemId:'materials',state:materials.length?'completed':'waiting_evidence',materialRefs:materials.map((m:Data)=>({artifactId:m.artifactId,hash:m.hash}))},
        {itemId:'analysis',state:j.result?.ok?'completed':currentState,resultRef:j.analysis_run_id},
        {itemId:'verification',state:j.selection?.decision==='adopt'?'completed':'awaiting_confirmation',selection:j.selection},
        {itemId:'completion',state:currentState==='completed'?'completed':currentState,reason:j.reason}];
      const timeline=events.map(e=>({eventId:e.event_id,type:e.event_type,...e.payload}));
      return {...context,requestId:query.requestId??j.input.requestId??null,roundNo:j.attempt,state:currentState,updatedAt:proc.updated_at,
        actor:{principalId:j.result?.execution?.actor??proc.principal_id},requestedBy:proc.principal_id,columnResults:cells,businessCandidate:j.domain==='business'?j.result:null,candidate:j.result,
        selection:j.selection,materialRefs:materials,caseOutcome:outcome,domains,affectedDomains,needsReselection,dependencyChange,
        dependencyVersion:j.input.domains?.[j.domain]?.version??'legacy-all-inputs',
        changeReason:affectedDomains.includes(j.domain)?'本专业事实、来源等级、适用范围、规则或全局质量依据已变化':null,
        downstream:domains.filter(d=>d.domain!==j.domain),
        eventRefs:events.map(e=>e.event_id),next:{canAdvance:currentState==='completed',reason:j.reason},
        actions:[{actionId:'columns.evaluate',state:j.result?'succeeded':currentState,result:{runId:j.analysis_run_id,resultId:j.result_id,packageId:j.package_id}}],
        views:{platform:{...context,state:currentState,cells,domains,caseOutcome:outcome,affectedDomains,needsReselection,dependencyChange},materials:{...context,items:materials},
          decisions:{...context,candidate,selection:j.selection,authority:'none',confidence:{value:null,calibration:'unknown'},
            requiredDecision:proc.state==='in_progress'&&context.current?(j.state==='awaiting_confirmation'?{roundId:j.job_id,resultId:j.result_id,choices:['adopt','set_aside',...(j.domain==='credit'?['reject']:[])]}:j.state==='waiting_evidence'&&j.domain==='credit'&&j.result_id?{roundId:j.job_id,resultId:j.result_id,choices:['reject']}:null):null},
          flow:{...context,events:timeline},history:{...context,events:timeline,startedAt:j.started_at,finishedAt:j.finished_at},
          chat:{...context,records:timeline.map(e=>({id:e.eventId,at:e.at,domain:e.domain,type:e.type,source:'server_event'}))}}};
    });
    await auth(credential,cid);
    return {ok:true,customerId:cid,processId:proc.process_id,version:proc.version,domain:query.domain??null,found:!!receipts.length,
      state:receipts[0]?.state??'not_started',receipt:receipts[0]??null,receipts,domains,affectedDomains,needsReselection,dependencyChange,caseOutcome:outcome};
  }
  async function run(pid:string,cid:string,credential:unknown) {
    try {
      const proc=(await kernel.pool.query('SELECT * FROM arrow_processes WHERE process_id=$1',[pid])).rows[0];
      const jobs=(await kernel.pool.query("SELECT * FROM arrow_jobs WHERE process_id=$1 AND state='queued' ORDER BY domain",[pid])).rows;
      if(!jobs.length)return;
      const b=jobs[0].input;const human={credential,tenantId:proc.tenant_id};
      await auth(credential,cid);
      const svc=await authenticate(kernel.verifierForV2(),options.serviceCredential);requireVerified(svc);
      if(svc.principal.kind!=='service'||jobs.some(j=>!svc.principal.roles.includes(j.domain)))throw forbidden('PERMISSION_DENIED','本实例专业执行服务未授权');
      // Packages and runs use existing command authorization. No direct writes to authority tables.
      const pkg=await kernel.v2.createPackage({...human,requestId:`${jobs[0].job_id}:package`,
        domainDeps:DOMAINS.map(domain=>({domain,...b.domains[domain].deps})),candidate:{producedBy:policy}},cid);
      const runnable:Data[]=[];
      for(const j of jobs){
        await auth(credential,cid,j.domain);
        const started=await kernel.analysis.startAnalysisRun({credential:options.serviceCredential,tenantId:proc.tenant_id,
          requestId:`${j.job_id}:start`,domain:j.domain,deps:j.input.deps,providerMode:'deterministic'},cid);
        await tx(async q=>{const p=(await q.query('SELECT state FROM arrow_processes WHERE process_id=$1 FOR UPDATE',[pid])).rows[0];
          if(p.state!=='in_progress')return;
          await q.query("UPDATE arrow_jobs SET state='running',analysis_run_id=$2,package_id=$3,started_at=clock_timestamp() WHERE job_id=$1",[j.job_id,started.runId,pkg.packageId]);
          await emit(q,pid,'COLUMN_STARTED',j.domain,j.job_id,{actor:svc.principal.principalId,runId:started.runId});
          runnable.push({...j.input,jobId:j.job_id,domain:j.domain,runId:started.runId,basisHash:j.basis_hash});});
      }
      const outputs=await options.runBatch(runnable);
      for(const output of outputs){
        const j=runnable.find(j=>j.jobId===output.jobId)!;
        await kernel.analysis.finishAnalysisRun({credential:options.serviceCredential,tenantId:proc.tenant_id,requestId:`${j.jobId}:finish`,executionStatus:output.result.ok?'completed':'failed'},j.runId);
        const fresh=await input(cid);const p=(await kernel.pool.query('SELECT state FROM arrow_processes WHERE process_id=$1',[pid])).rows[0];
        let record:Data|null=null;
        if(output.result.ok&&p.state==='in_progress'&&fresh.domains[j.domain].hash===j.basisHash){
          await auth(credential,cid,j.domain);
          record=await kernel.v2.recordDomainResult({credential:options.serviceCredential,tenantId:proc.tenant_id,
            requestId:`${j.jobId}:result`,domain:j.domain,deps:j.deps,analysisRun:{runId:j.runId},opinion:output.result.assessment},String(pkg.packageId));
        }
        await tx(async q=>{
          const p=(await q.query('SELECT * FROM arrow_processes WHERE process_id=$1 FOR UPDATE',[pid])).rows[0];
          const assessment=output.result.assessment;
          const missing=assessment?.unknowns?.length||assessment?.contradictions?.length||output.result.unreadable?.length;
          const state=p.state!=='in_progress'?'stopped':fresh.domains[j.domain].hash!==j.basisHash?'stale':!output.result.ok?'failed':missing?'waiting_evidence':'awaiting_confirmation';
          await q.query('UPDATE arrow_jobs SET state=$2,result=$3,result_id=$4,finished_at=clock_timestamp(),reason=$5 WHERE job_id=$1',
            [j.jobId,state,JSON.stringify({...output.result,execution:{actor:svc.principal.principalId,startedAt:output.startedAt,finishedAt:output.finishedAt,threadId:output.threadId}}),record?.resultId??null,
              state==='waiting_evidence'?'EVIDENCE_GAP':state==='awaiting_confirmation'?'HUMAN_SELECTION_REQUIRED':state]);
          await emit(q,pid,'COLUMN_RESULT',j.domain,j.jobId,{state,actor:svc.principal.principalId,resultId:record?.resultId??null,execution:{startedAt:output.startedAt,finishedAt:output.finishedAt,threadId:output.threadId}});
        });
      }
    }catch(e){
      await tx(async q=>{await q.query("UPDATE arrow_jobs SET state='unknown',reason=$2 WHERE process_id=$1 AND state IN ('queued','running')",[pid,e instanceof Error?e.message.slice(0,300):'EXECUTION_UNKNOWN']);
        await emit(q,pid,'COLUMN_UNKNOWN',null,null,{reason:e instanceof Error?e.message.slice(0,300):'EXECUTION_UNKNOWN'});});
    }finally{busy.delete(pid);}
  }
  async function advance(frame:Data,cid:string) {
    const domain=field(frame.domain,'domain');if(!DOMAINS.includes(domain))throw invalid('未知专业');
    const requestId=field(frame.requestId,'requestId');const {p,customer}=await auth(frame.credential,cid,domain);
    const allowed=['credential','__path','requestId','domain','planId','planHash','expectedVersion','roundNo','actionIds'];
    if(Object.keys(frame).some(k=>!allowed.includes(k)))throw invalid('未知推进字段');
    const hash=canonicalHash(Object.fromEntries(allowed.filter(k=>!['credential','__path','requestId'].includes(k)).map(k=>[k,frame[k]])));
    const claim=await tx(async q=>{
      await q.query('SELECT customer_id FROM customers WHERE customer_id=$1 FOR UPDATE',[cid]);
      let proc=await processFor(cid,p.principalId,q);
      if(proc){const old=(await q.query('SELECT * FROM arrow_requests WHERE process_id=$1 AND request_id=$2',[proc.process_id,requestId])).rows[0];
        if(old){if(old.payload_hash!==hash)throw conflict('IDEMPOTENCY_REPLAY_CONFLICT','同ID载荷改变');return {proc,reused:true};}}
      const plan=await getPlan(frame.credential,cid,domain);
      if(!plan.available)throw conflict('NOT_READY',plan.reason??'NOT_READY');
      if(frame.planId!==plan.planId||frame.planHash!==plan.planHash||canonicalHash(frame.expectedVersion)!==canonicalHash(plan.expectedVersion)||
        canonicalHash(frame.actionIds)!==canonicalHash(plan.actionIds)||frame.roundNo!==plan.roundNo)throw conflict('VERSION_CONFLICT','计划已改变');
      if(!proc)proc=(await q.query('INSERT INTO arrow_processes(process_id,customer_id,tenant_id,principal_id) VALUES($1,$2,$3,$4) RETURNING *',[newId('process'),cid,customer.tenant_id,p.principalId])).rows[0];
      const b=await input(cid,q);const rows=(await q.query('SELECT * FROM arrow_jobs WHERE process_id=$1 ORDER BY attempt DESC',[proc.process_id])).rows;
      const jobs=latestJobs(rows);let selected=jobs.find(j=>j.domain===domain)?.job_id;
      const affected=jobs.filter(j=>j.basis_hash!==b.domains[j.domain].hash).map(j=>j.domain);
      let queuedCount=0;
      if(affected.length)await emit(q,proc.process_id,'COLUMN_DEPENDENCIES_CHANGED',null,null,{affectedDomains:affected,
        reason:'材料事实、来源等级、规则、交易范围或全局质量发生变化；只重评受影响专业',dependencyVersion:'column-deps-v1',
        previousResults:jobs.filter(j=>affected.includes(j.domain)).map(j=>({domain:j.domain,roundId:j.job_id,resultId:j.result_id,basisVersion:j.basis_hash}))});
      for(const d of DOMAINS.filter(d=>p.roles.includes(d)&&(options.progression!=='column'||d===domain||affected.includes(d)))){
        const prior=jobs.find(j=>j.domain===d);
        if(prior?.basis_hash===b.domains[d].hash)continue;
        const jobId=newId('column');
        queuedCount++;
        await q.query("INSERT INTO arrow_jobs(job_id,process_id,domain,attempt,state,basis_hash,input) VALUES($1,$2,$3,$4,'queued',$5,$6)",[jobId,proc.process_id,d,(prior?.attempt??0)+1,b.domains[d].hash,JSON.stringify({...b,deps:b.domains[d].deps,requestId})]);
        await emit(q,proc.process_id,'COLUMN_QUEUED',d,jobId,{actor:p.principalId,dependencies:b.domains[d].deps.artifactIds,dependencyVersion:b.domains[d].version});
        if(d===domain)selected=jobId;
      }
      await q.query('INSERT INTO arrow_requests(process_id,request_id,payload_hash,domain,job_id) VALUES($1,$2,$3,$4,$5)',[proc.process_id,requestId,hash,domain,selected]);
      return {proc,reused:queuedCount===0};
    });
    if(!claim.reused&&!busy.has(claim.proc.process_id)){
      busy.add(claim.proc.process_id);const task=run(claim.proc.process_id,cid,frame.credential);pending.add(task);void task.finally(()=>pending.delete(task));
    }
    const view=await read(frame.credential,cid,{requestId});
    return {...view,ok:true,reused:claim.reused};
  }
  async function decide(frame:Data,cid:string,jobId:string){
    const requestId=field(frame.requestId,'requestId');const decision=field(frame.decision,'decision');
    if(!['adopt','set_aside','reject'].includes(decision))throw invalid('未知选择');
    if(Object.keys(frame).some(k=>!['credential','__path','requestId','decision','rationale','resultId','expectedVersion'].includes(k)))throw invalid('未知确认字段');
    const {p,customer}=await auth(frame.credential,cid);
    const proc=await processFor(cid,p.principalId);if(!proc)throw notFound('流程不存在');
    const job=(await kernel.pool.query('SELECT * FROM arrow_jobs WHERE process_id=$1 AND job_id=$2',[proc.process_id,jobId])).rows[0];
    if(!job)throw notFound('专业结果不存在');await auth(frame.credential,cid,job.domain);
    const payloadHash=canonicalHash({jobId,decision,resultId:frame.resultId,rationale:frame.rationale,expectedVersion:frame.expectedVersion});
    const claim=await tx(async q=>{
      const locked=(await q.query('SELECT * FROM arrow_processes WHERE process_id=$1 FOR UPDATE',[proc.process_id])).rows[0];
      const old=(await q.query('SELECT * FROM arrow_requests WHERE process_id=$1 AND request_id=$2',[proc.process_id,requestId])).rows[0];
      if(old){if(old.payload_hash!==payloadHash)throw conflict('IDEMPOTENCY_REPLAY_CONFLICT','同ID确认不同');return false;}
      if(locked.state!=='in_progress')throw conflict('NOT_READY','流程已终止');
      if(frame.expectedVersion!==locked.version||frame.resultId!==job.result_id||job.basis_hash!==(await input(cid,q)).domains[job.domain].hash)throw conflict('VERSION_CONFLICT','确认依据已改变');
      if(!['awaiting_confirmation','waiting_evidence'].includes(job.state)||!job.result_id)throw conflict('NOT_READY','没有可确认结果');
      if(decision==='adopt'&&job.state==='waiting_evidence')throw conflict('NOT_READY','需先补证重评');
      if(decision==='reject'&&job.domain!=='credit')throw forbidden('PERMISSION_DENIED','明确拒绝须信审角色');
      const unresolved=(await q.query("SELECT 1 FROM arrow_requests WHERE process_id=$1 AND command_state='unknown' LIMIT 1",[proc.process_id])).rows[0];
      if(unresolved)throw conflict('NOT_READY','未知确认不可换ID重发');
      await q.query("INSERT INTO arrow_requests(process_id,request_id,payload_hash,domain,job_id,command_state) VALUES($1,$2,$3,$4,$5,'unknown')",[proc.process_id,requestId,payloadHash,job.domain,jobId]);
      await q.query("UPDATE arrow_jobs SET state='unknown',reason='HUMAN_DECISION_PENDING' WHERE job_id=$1",[jobId]);
      await emit(q,proc.process_id,'COLUMN_DECISION_PENDING',job.domain,jobId,{actor:p.principalId,requestId});
      return true;
    });
    if(!claim)return {...await read(frame.credential,cid,{roundId:jobId}),reused:true};
    const human={credential:frame.credential,tenantId:customer.tenant_id};
    let result:Data;
    if(decision==='reject'){
      const ass=await kernel.v2.createAssessment({...human,requestId:`${requestId}:assessment`,ruleVersion:job.input.deps.rulePackVersion},cid);
      await kernel.v2.submitCandidate({...human,requestId:`${requestId}:candidate`,candidate:{tendency:'no_do',producedBy:policy,rationale:String(frame.rationale??''),basisRefs:job.input.deps.artifactIds}},String(ass.assessmentId));
      await kernel.v2.submitForReview({...human,requestId:`${requestId}:review`},String(ass.assessmentId));
      result=await kernel.v2.decideAssessment({...human,requestId:`${requestId}:reject`,decision:'reject_assessment',rationale:String(frame.rationale??'')},String(ass.assessmentId));
    }else result=await kernel.v2.adoptDomainOpinion({...human,requestId:`${requestId}:adopt`,domain:job.domain,decision,rationale:String(frame.rationale??''),basisRefs:job.input.deps.artifactIds},job.package_id);
    await tx(async q=>{
      const locked=(await q.query('SELECT * FROM arrow_processes WHERE process_id=$1 FOR UPDATE',[proc.process_id])).rows[0];
      const selectionEventId=randomUUID();
      const selection={decision,candidateId:job.result_id,eventId:selectionEventId,by:p.principalId,actor:p.principalId,
        at:new Date().toISOString(),rationale:frame.rationale??'',result};
      const current=job.basis_hash===(await input(cid,q)).domains[job.domain].hash;
      const state=decision==='reject'?'rejected':!current?'stale':decision==='adopt'?'completed':'waiting_evidence';
      if(locked.state==='in_progress')await q.query('UPDATE arrow_jobs SET state=$2,selection=$3,reason=$4 WHERE job_id=$1',[jobId,state,JSON.stringify(selection),decision==='set_aside'?'HUMAN_SET_ASIDE':null]);
      await q.query("UPDATE arrow_requests SET command_state='completed' WHERE process_id=$1 AND request_id=$2",[proc.process_id,requestId]);
      const eid=await emit(q,proc.process_id,'COLUMN_HUMAN_DECISION',job.domain,jobId,{selection,actor:p.principalId},selectionEventId);
      if(decision==='reject'){
        const archiveRef=newId('archive');await q.query("UPDATE arrow_processes SET state='rejected',terminal_ref=$2,archive_ref=$3 WHERE process_id=$1",[proc.process_id,eid,archiveRef]);
        await q.query("UPDATE arrow_jobs SET state='stopped',reason='CREDIT_REJECTED' WHERE process_id=$1 AND state NOT IN ('completed','rejected')",[proc.process_id]);
        await emit(q,proc.process_id,'CASE_REJECTED_ARCHIVED','credit',jobId,{archiveRef,decisionRef:result});
      }else{
        const now=latestJobs((await q.query('SELECT * FROM arrow_jobs WHERE process_id=$1 ORDER BY attempt DESC',[proc.process_id])).rows);
        const b=await input(cid,q);
        if(now.length===5&&now.every(j=>j.state==='completed'&&j.basis_hash===b.domains[j.domain].hash)&&locked.state==='in_progress'){
          const end=await emit(q,proc.process_id,'CASE_COMPLETED',null,null,{domainCompletionRefs:now.map(j=>j.job_id)});
          await q.query("UPDATE arrow_processes SET state='completed',terminal_ref=$2 WHERE process_id=$1",[proc.process_id,end]);
        }
      }
    });
    return {...await read(frame.credential,cid,{roundId:jobId}),reused:false};
  }
  return {getPlan,read,advance,decide,drain:()=>Promise.all([...pending])};
}
