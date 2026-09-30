import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import type { Kernel } from './kernel.ts';
import { authenticate, requireVerified } from './principal.ts';
import { lookupCustomer } from './v2kit.ts';
import { canonicalHash } from './util.ts';
import { conflict, forbidden, invalid, notFound } from './errors.ts';

type Data = Record<string, any>;
type Q = { query: (text: string, values?: readonly unknown[]) => Promise<any> };

export const CASE_DIRECTORY_VERSION = 'arrow-case-directory-v1';
const CATEGORIES = ['差', '中', '好'];
const BATCHES = ['checkpoint', 'fresh'];
/** 人工核验待办检查的申报事实（DEF-03-05 三类核验；等级未达 confirmed 即为待办）。 */
const VERIFICATION_KEYS = ['revenue_annual_declared', 'entity_identity_verified', 'equipment_ownership_verified'];

/** 收尾02：A 正式案例目录（arrow-cases 权威实现）。
 * 登记面只写"哪个客户、什么顺序、什么标题"（配置事实）；检查点/下一动作/助手摘要全部
 * 从该客户真实执行状态读时推导（arrow_processes/jobs/cycles/评估/Gate），不落库、不硬编码结论。
 * 授权：内部人类可见；客户身份 403；grant 模式不在册的客户按不存在处理（跨租户/越权 404 语义一致）。 */
export function buildCaseDirectory(kernel: Kernel) {
  async function auth(credential: unknown, cid?: string) {
    const a = await authenticate(kernel.verifierForV2(), credential); requireVerified(a);
    if (a.principal.kind !== 'human' || a.principal.roles.includes('customer')) throw forbidden('PERMISSION_DENIED', '案例目录仅供获准内部人类身份读取');
    const customer = cid ? await lookupCustomer(kernel, credential, cid) : null;
    return { p: a.principal, customer };
  }

  function field(v: unknown, name: string, max = 128): string {
    if (typeof v !== 'string' || !v.length || v.length > max) throw invalid(`${name} 必须为1..${max}字符`);
    return v;
  }

  /** 登记/更新案例展示登记（admin 人类；requestId 幂等；displayOrder 同租户唯一冲突→409）。 */
  async function register(frame: Data) {
    const requestId = field(frame.requestId, 'requestId');
    const { p } = await auth(frame.credential);
    if (!p.roles.includes('admin')) throw forbidden('PERMISSION_DENIED', '案例登记仅 admin 人类身份');
    for (const [k, v] of [['caseId', frame.caseId], ['customerId', frame.customerId], ['businessName', frame.businessName]] as const) field(v, k);
    const category = field(frame.category, 'category', 8);
    if (!CATEGORIES.includes(category)) throw invalid(`category 必须 ${CATEGORIES.join('/')}`);
    const batch = frame.batch === undefined || frame.batch === null ? 'checkpoint' : field(frame.batch, 'batch', 16);
    if (!BATCHES.includes(batch)) throw invalid(`batch 必须 ${BATCHES.join('/')}`);
    if (!Number.isInteger(frame.displayOrder) || (frame.displayOrder as number) < 1) throw invalid('displayOrder 必须是 ≥1 的整数');
    const summary = field(frame.summary, 'summary', 500);
    const payloadHash = canonicalHash({ caseId: frame.caseId, customerId: frame.customerId, displayOrder: frame.displayOrder, category, businessName: frame.businessName, summary, batch });
    const q = await kernel.pool.connect();
    try {
      await q.query('BEGIN');
      await q.query('SELECT customer_id FROM customers WHERE customer_id=$1 FOR UPDATE', [frame.customerId]);
      const prior = (await q.query('SELECT * FROM arrow_case_registry WHERE case_id=$1', [frame.caseId])).rows[0];
      if (prior) {
        if (canonicalHash({ caseId: prior.case_id, customerId: prior.customer_id, displayOrder: prior.display_order, category: prior.category, businessName: prior.business_name, summary: prior.summary, batch: prior.batch }) !== payloadHash)
          throw conflict('IDEMPOTENCY_REPLAY_CONFLICT', '同案例号登记内容不同');
        await q.query('COMMIT');
        return { ok: true, reused: true, caseId: prior.case_id, customerId: prior.customer_id };
      }
      const tenantRow = (await q.query('SELECT tenant_id FROM customers WHERE customer_id=$1', [frame.customerId])).rows[0];
      await q.query(`INSERT INTO arrow_case_registry(case_id,tenant_id,customer_id,display_order,category,business_name,summary,batch,config,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [frame.caseId, tenantRow.tenant_id, frame.customerId, frame.displayOrder, category, frame.businessName, summary, batch,
         JSON.stringify({ sourceMode: 'synthetic', scenarioIsOutcome: false }), p.principalId]);
      await q.query('INSERT INTO outbox_events(event_id,event_type,customer_id,payload) VALUES($1,$2,$3,$4)',
        [randomUUID(), 'ARROW_CASE_REGISTERED', frame.customerId, JSON.stringify({ caseId: frame.caseId, displayOrder: frame.displayOrder, category, at: new Date().toISOString() })]);
      await q.query('COMMIT');
      return { ok: true, reused: false, caseId: frame.caseId, customerId: frame.customerId };
    } catch (e) { await q.query('ROLLBACK').catch(() => {}); throw e; } finally { q.release(); }
  }

  /** 红线复算（与 advance-round getPlan 同口径：年收入申报 >5000 万，单位归一 wan→CNY）。 */
  function overRedline(facts: Data[]): boolean {
    return facts.some((f: Data) => {
      if (f.fact_key !== 'revenue_annual_declared') return false;
      const v = f.value && typeof f.value === 'object' && Object.hasOwn(f.value, 'value') ? f.value.value : f.value;
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return false;
      const unit = f.value && typeof f.value === 'object' && f.value.unit != null ? String(f.value.unit) : null;
      return n * (unit === 'wan' ? 10000 : 1) > 50000000;
    });
  }

  /** 从真实执行状态推导检查点（读时计算，无结论落库）。返回 null=尚无可展示检查点。 */
  async function deriveCheckpoint(q: Q, cid: string): Promise<Data | null> {
    const facts = (await q.query(`SELECT f.fact_key,f.value,f.grade,f.artifact_id FROM fact_assertions f
      JOIN evidence_artifacts a ON a.artifact_id=f.artifact_id WHERE f.customer_id=$1 AND a.superseded_by IS NULL AND a.duplicate_of IS NULL`, [cid])).rows;
    const proc = (await q.query(`SELECT * FROM arrow_processes WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 1`, [cid])).rows[0] ?? null;
    const jobs = proc ? (await q.query(`SELECT DISTINCT ON (domain) * FROM arrow_jobs WHERE process_id=$1 ORDER BY domain, attempt DESC`, [proc.process_id])).rows : [];
    const byDomain = Object.fromEntries(jobs.map((j: Data) => [j.domain, j]));

    if (overRedline(facts)) return { type: 'blocked_redline', label: '已分析：年收入超5000万红线，推进被阻断',
      detail: '确定性红线检查（读取时复算）；须纠正收入事实后重新评估，不可强制通过', evidence: { kind: 'plan_reason', reason: 'CUSTOMER_REVENUE_REDLINE' } };

    const asset = byDomain['asset'];
    if (asset?.result?.zoneCandidates?.hardBlock === true && !['completed', 'rejected'].includes(asset.state))
      return { type: 'blocked_hard', label: '已核验：权属核验不通过，硬阻断不可豁免',
        detail: `权属核验结论与申报冲突（gate=${asset.result.zoneCandidates.gate?.result}）；任何采用/置信度声明被拒并留痕`,
        evidence: { kind: 'job', jobId: asset.job_id, gate: asset.result.zoneCandidates.gate } };

    const credit = byDomain['credit'];
    if (credit?.state === 'rejected' || proc?.state === 'rejected')
      return { type: 'rejected', label: '已分析：信审明确拒绝，流程归档',
        detail: '依据性拒绝（规则计算的风险意见 + 有权信审人工拒绝）；其余区停止，后续推进硬挡',
        evidence: { kind: 'process', processId: proc?.process_id, archiveRef: proc?.archive_ref } };

    if (credit?.state === 'waiting_evidence')
      return { type: 'awaiting_evidence', label: '已分析：信审待补件',
        detail: `现金流输入未达核验等级（${(credit.result?.assessment?.unknowns ?? []).length} 项 unknown）；补件后仅相关域失效重算`,
        evidence: { kind: 'job', jobId: credit.job_id, unknowns: credit.result?.assessment?.unknowns ?? [] } };

    const conflicting = jobs.find((j: Data) => (j.result?.assessment?.contradictions ?? []).length > 0 && j.state !== 'completed');
    if (conflicting)
      return { type: 'conflict_review', label: '分析已识别冲突：金额/口径待核实',
        detail: `${conflicting.domain} 区来源冲突保留未合并（${conflicting.result.assessment.contradictions.map((c: Data) => c.factKey).join(',')}）；核实后按新版本重算`,
        evidence: { kind: 'job', jobId: conflicting.job_id, contradictions: conflicting.result.assessment.contradictions } };

    const risky = credit?.state === 'awaiting_confirmation' && (credit.result?.assessment?.findingsSuspicion ?? []).length > 0;
    if (risky)
      return { type: 'risk_decision', label: '已分析：偿债风险意见待决定',
        detail: '覆盖率不足由规则计算（findingsSuspicion 非空）；有权信审可明确拒绝（留痕归档）或补证后重评',
        evidence: { kind: 'job', jobId: credit.job_id, suspicion: credit.result.assessment.findingsSuspicion } };

    const verified = new Map<string, string>(facts.filter((f: Data) => VERIFICATION_KEYS.includes(f.fact_key)).map((f: Data) => [f.fact_key, String(f.grade)]));
    const pending = VERIFICATION_KEYS.filter(k => verified.get(k) === undefined || !['confirmed'].includes(verified.get(k)!));
    if (proc && pending.length > 0 && Object.keys(byDomain).length > 0 && Object.values(byDomain).some((j: Data) => ['waiting_evidence', 'awaiting_confirmation'].includes(j.state)))
      return { type: 'verification_pending', label: '材料/分析已就绪：收入·主体·权属人工核验待办',
        detail: `申报≠核验：${pending.join(', ')} 未达 confirmed 等级；从页面完成核验登记后受影响区重算`,
        evidence: { kind: 'fact_grades', grades: Object.fromEntries(verified), pending } };

    const staleJobs = proc ? (await q.query(`SELECT j.domain,j.job_id FROM arrow_jobs j WHERE j.process_id=$1 AND j.state='completed' AND j.selection IS NOT NULL
       AND EXISTS (SELECT 1 FROM evidence_artifacts e
                   JOIN evidence_artifacts newer ON newer.artifact_id = e.superseded_by
                   WHERE e.customer_id=$2 AND e.superseded_by IS NOT NULL AND newer.created_at > j.finished_at)`, [proc.process_id, cid])).rows : [];
    if (staleJobs.length > 0)
      return { type: 'stale_review', label: '补证后：历史判断保留，当前结论标陈旧',
        detail: `新证据晚于 ${staleJobs.map((j: Data) => j.domain).join('/')} 的已采用结果；旧候选不可继续采用，受影响区按新依据重算`,
        evidence: { kind: 'jobs', jobIds: staleJobs.map((j: Data) => j.job_id) } };

    const assessment = (await q.query(`SELECT a.* FROM credit_assessments a WHERE a.customer_id=$1 ORDER BY created_at DESC LIMIT 1`, [cid])).rows[0] ?? null;
    if (assessment?.status === 'preassessment_confirmed')
      return { type: 'preassessment_confirmed', label: '首次预评估已收口（preassessment_only）',
        detail: '有权信审已确认预评估结论；未创建/激活任何正式额度（机器断言零写入）',
        evidence: { kind: 'assessment', assessmentId: assessment.assessment_id } };
    if (assessment?.status === 'awaiting_human_review' && proc?.state === 'completed')
      return { type: 'preassessment_review', label: '五区已协同完成：首次预评估结论待最终人类确认',
        detail: '评估已提交人工审阅（awaiting_human_review）；确认走 confirm-preassessment（credit 角色），不批准正式额度',
        evidence: { kind: 'assessment', assessmentId: assessment.assessment_id } };

    const cycle = (await q.query(`SELECT * FROM arrow_cycles WHERE customer_id=$1 ORDER BY cycle_no DESC LIMIT 1`, [cid])).rows[0] ?? null;
    if (cycle?.state === 'awaiting_external_receipt')
      return { type: 'awaiting_external', label: '履约完成：等待外部回执（外部收付款未连接）',
        detail: '内部义务已完成；实收须有权人类对回执手工确认，未确认不可结清',
        evidence: { kind: 'cycle', cycleId: cycle.cycle_id, cycleNo: cycle.cycle_no } };
    if (cycle?.state === 'settled')
      return { type: 'settled_reorderable', label: '已结清：可演示返单',
        detail: '结清基于已确认外部回执；返单开启独立新周期（新五区流程、历史不覆盖）',
        evidence: { kind: 'cycle', cycleId: cycle.cycle_id, cycleNo: cycle.cycle_no } };
    if (cycle?.state === 'closed')
      return { type: 'closed_reorderable', label: '已结清并关闭：可演示返单',
        detail: '完整周期留痕（履约→回执确认→结清→关闭）；返单须先完成新一轮五区流程',
        evidence: { kind: 'cycle', cycleId: cycle.cycle_id, cycleNo: cycle.cycle_no } };

    if (proc?.state === 'completed')
      return { type: 'case_completed', label: '五区已全部采用：案例收口（diamond）',
        detail: '五区候选经有权人类逐区采用；可开启业务周期或预评估收口',
        evidence: { kind: 'process', processId: proc.process_id, terminalEventId: proc.terminal_ref } };
    if (jobs.length > 0 && Object.values(byDomain).every((j: Data) => j.state === 'awaiting_confirmation'))
      return { type: 'awaiting_confirmation', label: '已分析：五区候选待人工逐区采用',
        detail: '候选为确定性排序（rule_rank，非置信度）；采用=有权人类显式选择并绑定版本',
        evidence: { kind: 'process', processId: proc?.process_id } };
    if (jobs.length > 0)
      return { type: 'in_progress', label: '分析推进中',
        detail: `各区状态：${Object.entries(byDomain).map(([d, j]: [string, Data]) => `${d}=${j.state}`).join(', ')}`,
        evidence: { kind: 'process', processId: proc?.process_id } };
    if (facts.length > 0)
      return { type: 'ready_to_analyze', label: '材料就绪：待提交分析事件',
        detail: `已登记 ${facts.length} 条现行事实；一次业务事件可并发推进无依赖步骤`,
        evidence: { kind: 'facts', count: facts.length } };
    return { type: 'not_started', label: '未开始', detail: '尚无登记材料', evidence: { kind: 'none' } };
  }

  /** 流程级当前依据哈希（保留给未来精确口径；当前 stale 判定用 supersede 时间对比）。 */
  void 0;

  /** 下一动作（按检查点类型给可执行事件清单；均映射到既有授权 API）。 */
  function nextActions(cp: Data | null): Data[] {
    switch (cp?.type) {
      case 'blocked_redline': return [{ action: 'correct-fact', label: '纠正收入事实（supersede 材料后重新评估）', hint: '红线内方可推进；不可强制通过' }];
      case 'blocked_hard': return [{ action: 'correct-fact', label: '重新权属核验（事实纠正）或按制度处置', hint: 'HARD_BLOCK 不可被采用/置信度覆盖' }];
      case 'rejected': return [];
      case 'awaiting_evidence': return [{ action: 'supplement', label: '登记核验补件（supersedes 旧申报）', domain: 'credit', hint: '仅受影响域失效重算' }];
      case 'conflict_review': return [{ action: 'verify-and-supersede', label: '核实口径后登记更正版材料', hint: '冲突未解不可采用该区候选' }];
      case 'risk_decision': return [{ action: 'decision', label: '信审人工决定', domain: 'credit', choices: ['reject', 'set_aside'], hint: 'reject 产生正式拒绝并归档' }];
      case 'verification_pending': return [{ action: 'register-verification', label: '页面完成收入·主体·权属核验登记', factKeys: VERIFICATION_KEYS, hint: '申报≠核验；核验后受影响区重算' }];
      case 'stale_review': return [{ action: 'advance', label: '对受影响区重新推进（新 attempt 真实重算）', hint: '旧候选标陈旧不可采用' }];
      case 'preassessment_review': return [{ action: 'confirm-preassessment', label: '信审确认预评估结论', hint: 'scope=preassessment_only；不批准正式额度' }];
      case 'preassessment_confirmed': return [{ action: 'open-cycle', label: '开启业务周期（履约→回执→结清）' }];
      case 'awaiting_external': return [{ action: 'external-receipt', label: '有权人类确认外部回执', hint: '模拟回执须标明出处；未确认不可结清' }, { action: 'settle-blocked', label: '（结清在回执确认后开放）' }];
      case 'settled_reorderable': case 'closed_reorderable': return [{ action: 'reorder', label: '返单：开启独立新周期', hint: '须先完成新一轮五区流程（独立依据）' }, { action: 'close', label: '关闭已结清周期' }];
      case 'case_completed': return [{ action: 'open-cycle', label: '开启业务周期' }, { action: 'create-assessment', label: '发起首次预评估（credit 角色）' }];
      case 'awaiting_confirmation': return [{ action: 'decision', label: '逐区人工采用（adopt/set_aside；credit 可 reject）' }];
      case 'ready_to_analyze': return [{ action: 'advance', label: '提交分析业务事件', hint: '单事件并发推进全部无依赖步骤' }];
      default: return [];
    }
  }

  /** 助手投影：无模型的确定性说明（来源=案例说明；不伪装模型回答/校准概率）。 */
  async function assistantBrief(q: Q, cid: string, cp: Data | null): Promise<Data> {
    const facts = (await q.query(`SELECT f.fact_key,f.value,f.grade FROM fact_assertions f
      JOIN evidence_artifacts a ON a.artifact_id=f.artifact_id WHERE f.customer_id=$1 AND a.superseded_by IS NULL AND a.duplicate_of IS NULL ORDER BY f.fact_key`, [cid])).rows;
    const arts = (await q.query(`SELECT artifact_id,sha256,kind FROM evidence_artifacts WHERE customer_id=$1 AND superseded_by IS NULL AND duplicate_of IS NULL ORDER BY artifact_id`, [cid])).rows;
    const KEY = new Set(['revenue_annual_declared', 'monthly_operating_cash_flow', 'monthly_debt_service', 'equipment_ownership_verified', 'entity_identity_verified', 'equipment_deal_amount', 'lease_term_months', 'proposed_monthly_rent']);
    return {
      source: '案例说明', modelInvolved: false,
      note: '确定性说明：由现行事实、材料依据与规则门状态投影生成；不含模型回答，不含校准概率',
      currentFacts: facts.filter((f: Data) => KEY.has(f.fact_key)).map((f: Data) => ({
        factKey: f.fact_key, value: f.value && typeof f.value === 'object' && Object.hasOwn(f.value, 'value') ? f.value.value : f.value,
        grade: f.grade, verification: f.grade === 'confirmed' ? '已核验' : f.grade === 'source_supported' ? '有据申报（未核验）' : '申报' })),
      basis: { artifactCount: arts.length, materialRefs: arts.map((a: Data) => ({ artifactId: a.artifact_id, sha256: a.sha256, kind: a.kind })) },
      blockers: cp && ['blocked_redline', 'blocked_hard', 'awaiting_evidence', 'conflict_review', 'verification_pending'].includes(cp.type) ? [{ checkpoint: cp.type, detail: cp.detail }] : [],
      next: nextActions(cp),
    };
  }

  /** 权威案例清单（arrow-cases）：登记表 ∩ 授权，读时推导检查点/下一动作/助手摘要。 */
  async function list(credential: unknown) {
    const { p } = await auth(credential);
    const rows = (await kernel.pool.query(`SELECT * FROM arrow_case_registry WHERE tenant_id=$1 ORDER BY display_order`, [p.tenants[0] ?? null])).rows;
    const visible: Data[] = [];
    for (const row of rows) {
      try { await lookupCustomer(kernel, credential, row.customer_id); } catch { continue; } // grant 不在册→整体不可见
      const q = kernel.pool;
      const cp = await deriveCheckpoint(q, row.customer_id);
      const customer = (await q.query('SELECT display_name,legal_entity_ref FROM customers WHERE customer_id=$1', [row.customer_id])).rows[0];
      const artCount = Number((await q.query('SELECT count(*) n FROM evidence_artifacts WHERE customer_id=$1 AND superseded_by IS NULL AND duplicate_of IS NULL', [row.customer_id])).rows[0].n);
      visible.push({
        caseId: row.case_id, customerId: row.customer_id, tenantId: row.tenant_id,
        displayOrder: row.display_order, category: row.category, businessName: row.business_name, summary: row.summary,
        batch: row.batch, displayName: customer?.display_name ?? row.business_name,
        scenarioIsOutcome: false, sourceMode: 'synthetic',
        checkpoint: cp, nextActions: nextActions(cp),
        assistant: await assistantBrief(q, row.customer_id, cp),
        progress: { registeredArtifacts: artCount, processState: (await q.query('SELECT state FROM arrow_processes WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 1', [row.customer_id])).rows[0]?.state ?? null,
          cycleState: (await q.query('SELECT state FROM arrow_cycles WHERE customer_id=$1 ORDER BY cycle_no DESC LIMIT 1', [row.customer_id])).rows[0]?.state ?? null },
        updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
      });
    }
    return { ok: true, manifestVersion: CASE_DIRECTORY_VERSION, authority: 'A arrow_case_registry（Edge 不再维护第二份清单）', count: visible.length, cases: visible };
  }

  /** 单案例详情：检查点+轨迹摘要（事件/材料/决策引用），供进入案例页与追溯。 */
  async function detail(credential: unknown, caseId: string) {
    const row = (await kernel.pool.query('SELECT * FROM arrow_case_registry WHERE case_id=$1', [field(caseId, 'caseId')])).rows[0];
    if (!row) throw notFound('案例不存在');
    const { p, customer } = await auth(credential, row.customer_id);
    if (!customer || customer.customer_id !== row.customer_id) throw notFound('案例不存在');
    const q = kernel.pool;
    const cp = await deriveCheckpoint(q, row.customer_id);
    const proc = (await q.query('SELECT * FROM arrow_processes WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 1', [row.customer_id])).rows[0] ?? null;
    const events = proc ? (await q.query('SELECT event_id,event_type,domain,job_id,payload,created_at FROM arrow_events WHERE process_id=$1 ORDER BY version', [proc.process_id])).rows : [];
    const jobs = proc ? (await q.query('SELECT job_id,domain,attempt,state,basis_hash,result_id FROM arrow_jobs WHERE process_id=$1 ORDER BY domain,attempt', [proc.process_id])).rows : [];
    const materials = (await q.query('SELECT artifact_id,sha256,kind,created_at,superseded_by FROM evidence_artifacts WHERE customer_id=$1 ORDER BY artifact_id', [row.customer_id])).rows;
    const cycles = (await q.query('SELECT cycle_id,cycle_no,state,source_process_id,created_at FROM arrow_cycles WHERE customer_id=$1 ORDER BY cycle_no', [row.customer_id])).rows;
    return { ok: true, manifestVersion: CASE_DIRECTORY_VERSION,
      case: { caseId: row.case_id, customerId: row.customer_id, displayOrder: row.display_order, category: row.category,
        businessName: row.business_name, summary: row.summary, batch: row.batch, checkpoint: cp, nextActions: nextActions(cp),
        assistant: await assistantBrief(q, row.customer_id, cp) },
      trace: { processId: proc?.process_id ?? null, processState: proc?.state ?? null,
        jobs: jobs.map((j: Data) => ({ jobId: j.job_id, domain: j.domain, attempt: j.attempt, state: j.state, basisHash: j.basis_hash, resultId: j.result_id })),
        events: events.map((e: Data) => ({ eventId: e.event_id, type: e.event_type, domain: e.domain, jobId: e.job_id, at: e.created_at?.toISOString?.() ?? e.created_at })),
        materials: materials.map((m: Data) => ({ artifactId: m.artifact_id, sha256: m.sha256, kind: m.kind, supersededBy: m.superseded_by })),
        cycles }, principalId: p.principalId };
  }

  return { register, list, detail };
}
