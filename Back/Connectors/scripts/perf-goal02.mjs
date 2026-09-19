// goal-02 · 性能对照脚本（同输入、同能力，只切换处理策略）。
// 两臂：
//   naive_full  = 现状基线形态（无解析缓存、每次事件四域全量重算、同键问题重复外发）
//   selective   = 本轮交付形态（解析去重缓存 + 域消费面签名选择性重算 + 同键问题幂等外发）
// 纪律（任务书 §六）：相同输入与相同能力；提速不得来自跳过必要核验——两臂最终 Gate 结论与
// 问题覆盖必须等价（脚本内断言），否则 exit 1。模型调用两臂恒 0（确定性管线）。
// 运行：cd Back/Connectors && node scripts/perf-goal02.mjs [输出目录]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pgAvailable, BASE_PG } from '../test/helpers.mjs';
import {
  TENANT, makeProcessingHarness, setupInvitation, uploadBytes, driveToEnd,
  bankCsvBytes, declCsvBytes, declTxtBytes, fakePdfBytes, makeZip,
} from '../test/processing-helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.argv[2] ?? join(__dirname, '..', '..', '..', 'docs', 'product-delivery', 'goal-02', 'evidence');
const CUST = 'cust-perf-1';

if (!(await pgAvailable())) {
  console.error('[perf] PG 127.0.0.1:15443 不可达：BLOCKED（不伪造数字）');
  process.exit(2);
}

/** 固定批次（DESIGN §2 扩展）：8 份流水×2（含重复）+4 声明件（1 件修正重传）+2 个 ZIP（各含 csv/txt/pdf）。 */
function buildBatch() {
  const batch = [];
  for (let i = 0; i < 8; i++) {
    const rows = [`交易日期,收入,支出,余额,摘要`];
    let bal = 100000;
    for (let d = 1; d <= 20; d++) {
      const inflow = (i * 7 + d * 13) % 9000;
      const outflow = (i * 5 + d * 7) % 3000;
      bal += inflow - outflow;
      rows.push(`2026-0${(d % 2) + 1}-${String(d).padStart(2, '0')},${inflow},${outflow},${bal},客户${i}`);
    }
    const bytes = Buffer.from(rows.join('\n'), 'utf8');
    batch.push({ name: `bank-${i}.csv`, kind: 'statement', bytes });
    if (i % 2 === 0) batch.push({ name: `bank-${i}-dup.csv`, kind: 'statement', bytes }); // 同字节重复上传
  }
  const decls = [
    { monthly_operating_cash_flow: '46000', monthly_debt_service: '18000', entity_identity_verified: 'yes', equipment_ownership_verified: 'yes' },
    { monthly_operating_cash_flow: '52000', monthly_debt_service: '21000', entity_identity_verified: 'yes', equipment_ownership_verified: 'yes' },
    { monthly_operating_cash_flow: '39000', monthly_debt_service: '15000', entity_identity_verified: 'yes', equipment_ownership_verified: 'yes' },
    { monthly_operating_cash_flow: '61000', monthly_debt_service: '24000', entity_identity_verified: 'yes', equipment_ownership_verified: 'yes' },
  ];
  decls.forEach((f, i) => batch.push({ name: `decl-${i}.txt`, kind: 'document', bytes: declTxtBytes(f) }));
  for (let z = 0; z < 2; z++) {
    batch.push({
      name: `scan-${z}.zip`, kind: 'document', bytes: makeZip([
        { name: `inner-bank-${z}.csv`, data: bankCsvBytes() },
        { name: `inner-decl-${z}.txt`, data: declTxtBytes({ equipment_model: `LX-10${z}`, equipment_ownership_verified: 'yes' }) },
        { name: `license-${z}.pdf`, data: fakePdfBytes() },
      ]),
    });
  }
  return batch;
}

async function runMode(strategy, port) {
  const h = await makeProcessingHarness({ port, processing: { strategy, outboundPolicy: 'auto_whitelist' } });
  try {
    const inv = await setupInvitation(h.api, { customerId: CUST });
    // 外发通道前置：active 绑定 + 同意（两臂同条件；差异只来自处理策略）
    const b = (await h.store.query('SELECT binding_id FROM participant_bindings WHERE tenant_id=$1', [TENANT])).rows[0];
    await h.api('/api/connectors/intake/verify-binding', { tenantId: TENANT, bindingId: b.binding_id, verifiedBy: 'op-1', evidenceRefs: ['perf:binding'] });
    await h.svc.consent.grant({ tenantId: TENANT, subjectType: 'customer_participant', subjectId: CUST, channel: 'wecom_kf', purposes: ['external_disclosure'], dataCategory: 'business_verification', basis: 'customer_consent', source: 'perf' });
    const batch = buildBatch();
    const tUpload0 = Date.now();
    for (const item of batch) {
      // eslint-disable-next-line no-await-in-loop
      await uploadBytes(h.api, inv, { customerId: CUST, kind: item.kind, bytes: item.bytes });
    }
    const uploadMs = Date.now() - tUpload0;
    const tProcess0 = Date.now();
    await driveToEnd(h.api, { maxRounds: 40, maxTasks: 4 });
    const processMs = Date.now() - tProcess0;

    const metrics = {
      strategy,
      uploads: batch.length,
      uploadMs,
      processMs,
      parseExecuted: (await h.store.query(`SELECT count(*)::int n FROM processing_stage_runs WHERE stage='parse' AND status='done'`)).rows[0].n,
      parseCached: (await h.store.query(`SELECT count(*)::int n FROM processing_stage_runs WHERE stage='parse' AND status='skipped_duplicate'`)).rows[0].n,
      domainComputeRuns: (await h.store.query(`SELECT COALESCE(SUM(jsonb_array_length(detail->'computed')),0)::int n FROM processing_stage_runs WHERE stage='analyze' AND status='done'`)).rows[0].n,
      domainReuseRuns: (await h.store.query(`SELECT COALESCE(SUM(jsonb_array_length(detail->'reused')),0)::int n FROM processing_stage_runs WHERE stage='analyze' AND status='done'`)).rows[0].n,
      factsInserted: (await h.store.query(`SELECT COALESCE(SUM((detail->>'factsInserted')::int),0) n FROM processing_stage_runs WHERE stage='facts'`)).rows[0].n,
      needsFollowup: (await h.store.query(`SELECT count(*)::int n FROM processing_tasks WHERE status='needs_followup'`)).rows[0].n,
      outboundSends: (await h.store.query(`SELECT count(*)::int n FROM communication_events WHERE direction='outbound' AND source_type='wecom_kf_msg'`)).rows[0].n,
      questionRows: (await h.store.query(`SELECT count(*)::int n FROM prepared_questions`)).rows[0].n,
      taskRows: (await h.store.query(`SELECT count(*)::int n FROM processing_tasks`)).rows[0].n,
      memHeapUsedMb: Number((process.memoryUsage().heapUsed / 1048576).toFixed(1)),
      modelCalls: 0, // 确定性管线零模型调用（两臂同）；真实账单未接入=未知，不记 0
    };
    // 核验覆盖集合（等价性断言用，按状态集合粒度）：
    // 两臂出现的 Gate 结论集合、问题覆盖（去重键级）集合必须一致——提速不得来自跳过必要核验
    // Gate 语义投影（材料无关、时间无关）：result+ruleIds+域状态+释放条件类型——跨臂可比较
    const fins = (await h.store.query(
      `SELECT gate FROM analysis_finalizations WHERE tenant_id=$1 AND customer_id=$2`, [TENANT, CUST],
    )).rows;
    metrics.gateSemantics = [...new Set(fins.map(({ gate }) => JSON.stringify({
      result: gate.result ?? null,
      ruleIds: [...(gate.ruleIds ?? [])].sort(),
      domainStatus: Object.entries(gate.domainStatus ?? {}).map(([d, st]) => [d, st.status ?? null]).sort(),
      release: (gate.releaseConditions ?? []).map((rc) => [rc.type, rc.factKey ?? null, rc.ruleId ?? null]).sort(),
    })))].sort();
    // 转人工覆盖按内容级（sha 去重）比较：重复件在 naive 臂会被重复处理（基线语义），不按行数比
    metrics.needsFollowupSha = (await h.store.query(
      `SELECT DISTINCT a.sha256 FROM processing_tasks t JOIN evidence_artifacts a ON a.tenant_id=t.tenant_id AND a.evidence_id=t.evidence_id
       WHERE t.tenant_id=$1 AND t.customer_id=$2 AND t.status='needs_followup' ORDER BY a.sha256`, [TENANT, CUST],
    )).rows.map((r) => r.sha256);
    metrics.questionTargetSet = (await h.store.query(
      `SELECT DISTINCT target_fact FROM prepared_questions WHERE tenant_id=$1 AND customer_id=$2 AND target_fact IS NOT NULL ORDER BY target_fact`, [TENANT, CUST],
    )).rows.map((r) => r.target_fact);
    // 转人工覆盖按内容级（去重材料 sha 集合）比较：naive 臂重复件重复登记属基线语义
    metrics.manualEntrySha = (await h.store.query(
      `SELECT DISTINCT a.sha256 FROM prepared_questions q
       JOIN evidence_artifacts a ON a.tenant_id=q.tenant_id AND a.evidence_id=q.binding->>'objectRef'
       WHERE q.tenant_id=$1 AND q.customer_id=$2 AND q.binding->>'purpose'='manual_entry_required' ORDER BY a.sha256`, [TENANT, CUST],
    )).rows.map((r) => r.sha256);
    return { metrics, dispose: () => h.dispose() };
  } catch (e) {
    await h.dispose();
    throw e;
  }
}

// ---- 运行两臂 ----
const naive = await runMode('naive_full', 48391);
await naive.dispose();
const selective = await runMode('selective', 48392);
await selective.dispose();

// 等价性断言：提速不得来自跳过必要核验
const eq = {
  gateSemanticsEqual: JSON.stringify(naive.metrics.gateSemantics) === JSON.stringify(selective.metrics.gateSemantics),
  questionCoverageEqual: JSON.stringify(naive.metrics.questionTargetSet) === JSON.stringify(selective.metrics.questionTargetSet),
  manualEntryShaEqual: JSON.stringify(naive.metrics.manualEntrySha) === JSON.stringify(selective.metrics.manualEntrySha),
  needsFollowupShaEqual: JSON.stringify(naive.metrics.needsFollowupSha) === JSON.stringify(selective.metrics.needsFollowupSha),
};
if (!eq.gateSemanticsEqual || !eq.questionCoverageEqual || !eq.manualEntryShaEqual || !eq.needsFollowupShaEqual) {
  console.error('[perf] 两臂最终核验覆盖不等价（禁止）：', JSON.stringify(eq));
  console.error('naive gateSemantics:', JSON.stringify(naive.metrics.gateSemantics));
  console.error('selective gateSemantics:', JSON.stringify(selective.metrics.gateSemantics));
  console.error('naive qTargets:', JSON.stringify(naive.metrics.questionTargetSet));
  console.error('selective qTargets:', JSON.stringify(selective.metrics.questionTargetSet));
  console.error('naive needsSha:', JSON.stringify(naive.metrics.needsFollowupSha), 'selective needsSha:', JSON.stringify(selective.metrics.needsFollowupSha));
  process.exit(1);
}

const report = {
  runAt: new Date().toISOString(),
  batchDesign: '8 流水 CSV（其中 4 份同字节重复）+4 声明 txt+2 ZIP(各含 csv/txt/pdf) = 22 次上传 → 约 30 个处理任务',
  equivalence: eq,
  modelCalls: { naive_full: 0, selective: 0, note: '确定性管线零模型调用（两臂同）；真实账单未接入=未知，不记 0' },
  naive_full: naive.metrics,
  selective: selective.metrics,
};

mkdirSync(OUT_DIR, { recursive: true });
const jsonPath = join(OUT_DIR, `perf-goal02-${Date.now()}.json`);
writeFileSync(jsonPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  equivalence: eq,
  uploadMs: { naive: naive.metrics.uploadMs, selective: selective.metrics.uploadMs },
  processMs: { naive: naive.metrics.processMs, selective: selective.metrics.processMs },
  parseExecuted: { naive: naive.metrics.parseExecuted, selective: selective.metrics.parseExecuted },
  domainComputeRuns: { naive: naive.metrics.domainComputeRuns, selective: selective.metrics.domainComputeRuns },
  outboundSends: { naive: naive.metrics.outboundSends, selective: selective.metrics.outboundSends },
  jsonPath,
}, null, 1));
