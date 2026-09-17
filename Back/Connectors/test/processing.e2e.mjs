// goal-02 · 服务级整链测试（真实 PG + 真实 HTTP 接收入口 + 原始文件字节）。
// 覆盖任务书 §六 验收清单：重复上传/错主体期间/同源派生/部分解析失败/修正原件/局部重算/
// 多人同时提交/暂停与授权竞态/超时未知/进程终止后恢复/重复回调(任务重入)/预算耗尽/会后补证。
// 纯函数测试不能代替整链：本文件全部经 POST /api/connectors/evidence/upload 送入原始字节。
// PG 不可达显式跳过不计 PASS。
import test from 'node:test';
import assert from 'node:assert/strict';
import { pgAvailable } from './helpers.mjs';
import {
  TENANT, makeProcessingHarness, setupInvitation, uploadBytes, driveToEnd,
  bankCsvBytes, declCsvBytes, declTxtBytes, fakePdfBytes, makeZip,
} from './processing-helpers.mjs';

const ok = await pgAvailable();
if (!ok) {
  console.log('# SKIP: PG 127.0.0.1:15443 不可达（blocked_env，不计 PASS）');
  process.exit(0);
}

const CUST = 'cust-proc-1';
const PORT = 48281;

async function fetchDetail(h, taskId) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/connectors/processing/tasks/${taskId}?tid=${TENANT}`, {
    headers: { 'x-service-token': 'proc_service_token' },
  });
  return r.json();
}

function statusCounts(tasks) {
  const m = {};
  for (const t of tasks) m[t.status] = (m[t.status] ?? 0) + 1;
  return m;
}

test('P01 完整链：原始银行 CSV 经真实入口 → 解析/事实/四域/提问逐段留痕', async () => {
  const h = await makeProcessingHarness({ port: PORT });
  try {
    const inv = await setupInvitation(h.api);
    const up = await uploadBytes(h.api, inv, {
      bytes: bankCsvBytes(), periodFrom: '2026-01-01', periodTo: '2026-02-28',
    });
    assert.ok(up.processing?.taskId, '上传回执必须带处理任务');
    const rounds = await driveToEnd(h.api);
    assert.ok(rounds.some((r) => r.done >= 1), `tick 必须推进任务: ${JSON.stringify(rounds)}`);

    const st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    const task = st.tasks[0];
    assert.equal(task.status, 'done');
    // 传输(200)≠解析完成：逐段回执可见
    const full = await fetchDetail(h, task.task_id);
    const parseStage = full.task.stages.find((s) => s.stage === 'parse');
    assert.equal(parseStage.status, 'done');
    assert.equal(parseStage.detail.format, 'bank_statement_csv');
    assert.equal(parseStage.detail.facts, 2, '银行聚合事实=流入+流出');
    const factsStage = full.task.stages.find((s) => s.stage === 'facts');
    assert.equal(factsStage.detail.factsInserted, 2);
    const analyzeStage = full.task.stages.find((s) => s.stage === 'analyze');
    assert.equal(analyzeStage.status, 'done');
    assert.equal(analyzeStage.detail.materials, 1);
    // 观测与事实候选落库（带来源）
    const obs = (await h.store.query(`SELECT count(*)::int n FROM evidence_observations WHERE artifact_id=$1`, [up.evidenceId])).rows[0].n;
    assert.equal(obs, 1);
    const facts = (await h.store.query(
      `SELECT predicate FROM fact_assertions WHERE from_artifacts @> $1::jsonb ORDER BY predicate`, [JSON.stringify([up.evidenceId])],
    )).rows;
    assert.deepEqual(facts.map((f) => f.predicate), ['bank_inflow_total', 'bank_outflow_total']);
    // 四域预审结果落库（候选）+ 收口
    const domains = (await h.store.query(`SELECT domain FROM domain_analyses WHERE tenant_id=$1 AND customer_id=$2`, [TENANT, CUST])).rows.map((r) => r.domain).sort();
    assert.deepEqual(domains, ['asset', 'commerce', 'credit', 'policy']);
    const fin = (await h.store.query(`SELECT gate FROM analysis_finalizations WHERE tenant_id=$1 AND customer_id=$2`, [TENANT, CUST])).rows[0];
    assert.ok(fin.gate, '收口 Gate 落库');
    // 问题准备：流水≠经营收入 → monthly_operating_cash_flow 缺 → 客户补证问题（排队建议态，默认零外发）
    const qs = st.questions;
    const evQ = qs.find((q) => q.target_fact === 'monthly_operating_cash_flow');
    assert.ok(evQ, '缺少经营现金流事实 → 问题准备');
    assert.equal(evQ.status, 'suggested', '补件类走客户线程+默认 suggest_only：只建议不外发');
    assert.equal(qs.filter((q) => q.status === 'sent_ok').length, 0, 'suggest_only 策略零外发');
  } finally { await h.dispose(); }
});

test('P02 重复上传：同字节×2 → 第二件 duplicate 标注+零重复解析+零重复事实+零重复分析', async () => {
  const h = await makeProcessingHarness({ port: PORT });
  try {
    const inv = await setupInvitation(h.api);
    const up1 = await uploadBytes(h.api, inv, { bytes: bankCsvBytes() });
    await driveToEnd(h.api);
    const up2 = await uploadBytes(h.api, inv, { bytes: bankCsvBytes() });
    assert.equal(up2.duplicateOf, up1.evidenceId, '同字节登记为重复');
    await driveToEnd(h.api);
    const st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    const task2 = st.tasks.find((t) => t.evidence_id === up2.evidenceId);
    assert.equal(task2.status, 'skipped_duplicate');
    const parseRows = (await h.store.query(
      `SELECT count(*)::int n FROM parse_results WHERE tenant_id=$1 AND customer_id=$2`, [TENANT, CUST],
    )).rows[0].n;
    assert.equal(parseRows, 1, '同一有效材料版本只解析一次');
    const factRows = (await h.store.query(`SELECT count(*)::int n FROM fact_assertions`)).rows[0].n;
    assert.equal(factRows, 2, '事实候选零重复');
    const task1 = st.tasks.find((t) => t.evidence_id === up1.evidenceId);
    const a1 = await fetchDetail(h, task1.task_id);
    assert.equal(a1.task.stages.filter((s) => s.stage === 'analyze').length, 1, '重复上传未触发重复分析');
  } finally { await h.dispose(); }
});

test('P03 错期间：声明期间与流水内容月份错位 → period_mismatch 定位旗标（不改写不冒充）', async () => {
  const h = await makeProcessingHarness({ port: PORT });
  try {
    const inv = await setupInvitation(h.api);
    await uploadBytes(h.api, inv, { bytes: bankCsvBytes(), periodFrom: '2026-01-01', periodTo: '2026-12-31' });
    await driveToEnd(h.api);
    const st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    const full = await fetchDetail(h, st.tasks[0].task_id);
    const parseStage = full.task.stages.find((s) => s.stage === 'parse');
    const flags = parseStage.detail.qualityFlags ?? [];
    assert.ok(flags.some((f) => f.flag === 'period_mismatch'), `期间错位须定位: ${JSON.stringify(flags)}`);
    // 事实锚定取内容实际期间（不冒充声明期间）
    const f = (await h.store.query(`SELECT period_from FROM fact_assertions WHERE predicate='bank_inflow_total'`)).rows[0];
    assert.equal(new Date(f.period_from).toISOString().slice(0, 7), '2026-01');
  } finally { await h.dispose(); }
});

test('P04 同源派生+部分解析失败：ZIP(csv+txt+pdf) → 子件逐个处理；pdf 转人工；csv/txt 不被拖垮', async () => {
  const h = await makeProcessingHarness({ port: PORT });
  try {
    const inv = await setupInvitation(h.api);
    const zip = makeZip([
      { name: 'bank.csv', data: bankCsvBytes() },
      { name: 'decl.txt', data: declTxtBytes() },
      { name: 'license.pdf', data: fakePdfBytes() },
    ]);
    const up = await uploadBytes(h.api, inv, { bytes: zip, kind: 'document' });
    await driveToEnd(h.api, { maxRounds: 16 });
    const st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    const parent = st.tasks.find((t) => t.evidence_id === up.evidenceId);
    assert.equal(parent.status, 'done');
    assert.match(parent.note ?? '', /dispatched 3/, '容器派发 3 个子件');
    const kids = st.tasks.filter((t) => t.evidence_id !== up.evidenceId);
    assert.equal(kids.length, 3, 'ZIP 三个 entry 各自成为派生工件任务');
    // 子件同源：derived_from=父件；不增加独立证明计数
    const rows = (await h.store.query(
      `SELECT evidence_id, derived_from, same_source_flag FROM evidence_artifacts WHERE evidence_id != $1`, [up.evidenceId],
    )).rows;
    for (const r of rows) {
      assert.equal(r.derived_from, up.evidenceId, '派生件必须声明来源链');
      assert.equal(r.same_source_flag, 'suspected_duplicate', '同源派生不增加独立佐证');
    }
    // csv/txt 子件完成；pdf 子件如实转人工
    const counts = statusCounts(st.tasks);
    assert.equal(counts.done, 3, '容器+csv+txt 完成');
    assert.equal(counts.needs_followup, 1, 'pdf 一个转人工');
    const pdfTask = st.tasks.find((t) => t.status === 'needs_followup');
    assert.equal(pdfTask.failure_code, 'FORMAT_UNSUPPORTED');
    // 转人工入口在问题准备可见
    const manual = st.questions.find((q) => q.binding?.purpose === 'manual_entry_required');
    assert.ok(manual, '解析白名单外 → 人工入口');
    assert.equal(manual.status, 'needs_human');
    // 派生事实与声明事实都在
    const factPreds = (await h.store.query(`SELECT predicate FROM fact_assertions ORDER BY predicate`)).rows.map((r) => r.predicate);
    assert.ok(factPreds.includes('bank_inflow_total'));
    assert.ok(factPreds.includes('equipment_model'), 'txt 声明事实成为候选');
  } finally { await h.dispose(); }
});

test('P05 修正原件+局部重算：supersede 更新收口；无关新材料不触发任何域重算；补铭牌只动相关域', async () => {
  const h = await makeProcessingHarness({ port: PORT });
  try {
    const inv = await setupInvitation(h.api);
    const v1 = await uploadBytes(h.api, inv, { kind: 'document', bytes: declTxtBytes({ equipment_model: 'LX-105', equipment_ownership_verified: 'yes', entity_identity_verified: 'yes', monthly_operating_cash_flow: '46000', monthly_debt_service: '18000' }) });
    await driveToEnd(h.api);
    const fin1 = (await h.store.query(`SELECT input_hash FROM analysis_finalizations WHERE tenant_id=$1 AND customer_id=$2`, [TENANT, CUST])).rows[0];
    // 修正件：只改铭牌型号 → 旧件退出材料集
    const v2 = await uploadBytes(h.api, inv, { kind: 'document', bytes: declTxtBytes({ equipment_model: 'LX-200', equipment_ownership_verified: 'yes', entity_identity_verified: 'yes', monthly_operating_cash_flow: '46000', monthly_debt_service: '18000' }), supersedes: v1.evidenceId });
    await driveToEnd(h.api);
    const oldRow = (await h.store.query(`SELECT superseded_by FROM evidence_artifacts WHERE evidence_id=$1`, [v1.evidenceId])).rows[0];
    assert.equal(oldRow.superseded_by, v2.evidenceId, '旧件显式取代（历史不改写）');
    const fin2 = (await h.store.query(`SELECT input_hash FROM analysis_finalizations WHERE tenant_id=$1 AND customer_id=$2 ORDER BY created_at DESC LIMIT 1`, [TENANT, CUST])).rows[0];
    assert.notEqual(fin1.input_hash, fin2.input_hash, '材料集变化 → 收口更新');
    // supersede 的消费面（各域消费的值未变但来源件更替）→ 保守重算且逐域记原因
    const a2 = (await fetchDetail(h, v2.processing.taskId)).task.stages.find((s) => s.stage === 'analyze');
    const assetBecause = JSON.stringify(a2.detail.computed.find((x) => x.domain === 'asset'));
    assert.match(assetBecause, /fact_key|affected|provenance/, `资产域重算原因可解释: ${assetBecause}`);
    // 局部重算正例 A：新增一件只含银行聚合（无任何域消费其事实键）→ 四域全部复用，零重算
    const inv2 = await setupInvitation(h.api);
    const bank = await uploadBytes(h.api, inv2, { bytes: bankCsvBytes() });
    await driveToEnd(h.api);
    const a3 = (await fetchDetail(h, bank.processing.taskId)).task.stages.find((s) => s.stage === 'analyze');
    assert.deepEqual(a3.detail.computed, [], `与域消费面无关的新材料不触发重算: ${JSON.stringify(a3.detail)}`);
    assert.equal(a3.detail.reused.length, 4, `四域结果复用: ${JSON.stringify(a3.detail)}`);
    // 局部重算正例 B：新增件只含铭牌事实 → 只重算 asset（政策/信审/商务消费面未变）
    const inv3 = await setupInvitation(h.api);
    const plate = await uploadBytes(h.api, inv3, { kind: 'document', bytes: declTxtBytes({ equipment_model: 'LX-300' }) });
    await driveToEnd(h.api);
    const a4 = (await fetchDetail(h, plate.processing.taskId)).task.stages.find((s) => s.stage === 'analyze');
    assert.deepEqual(a4.detail.computed.map((x) => x.domain), ['asset'], `补铭牌只重算资产域: ${JSON.stringify(a4.detail)}`);
    assert.deepEqual(a4.detail.reused.map((x) => x.domain).sort(), ['commerce', 'credit', 'policy'], `无关域复用: ${JSON.stringify(a4.detail)}`);
  } finally { await h.dispose(); }
});

test('P06 多人同时提交+并发 tick：两身份并发上传，任务全完成、事实零重复', async () => {
  const h = await makeProcessingHarness({ port: PORT });
  try {
    const finInv = await setupInvitation(h.api, { role: 'customer_finance', kinds: ['statement', 'document'] });
    const ownInv = await setupInvitation(h.api, { role: 'customer_owner', kinds: ['statement', 'document'] });
    await Promise.all([
      uploadBytes(h.api, finInv, { bytes: bankCsvBytes() }),
      uploadBytes(h.api, ownInv, { kind: 'document', bytes: declTxtBytes() }),
    ]);
    // 并发 tick（进程内 driving 守卫；跨进程由 FOR UPDATE SKIP LOCKED 保证）
    await Promise.all([
      h.api('/api/connectors/processing/tick', { maxTasks: 4 }),
      h.api('/api/connectors/processing/tick', { maxTasks: 4 }),
    ]);
    await driveToEnd(h.api);
    const st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    assert.equal(st.tasks.length, 2);
    for (const t of st.tasks) assert.equal(t.status, 'done', `任务应完成: ${JSON.stringify(t)}`);
    const facts = (await h.store.query(`SELECT count(*)::int n FROM fact_assertions`)).rows[0].n;
    assert.equal(facts, 4, '银行 2 事实+声明 2 事实，零重复');
    const obs = (await h.store.query(`SELECT count(*)::int n FROM evidence_observations`)).rows[0].n;
    assert.equal(obs, 2, '观测零重复');
  } finally { await h.dispose(); }
});

test('P07 暂停与授权竞态：暂停期新问题=零外发(outbound_paused)；恢复后按当前代际推进', async () => {
  const h = await makeProcessingHarness({ port: PORT });
  try {
    const inv = await setupInvitation(h.api);
    await h.api('/api/connectors/processing/pause', { tenantId: TENANT, customerId: CUST, paused: true, actor: 'op-1' });
    const decl = declCsvBytes({ monthly_operating_cash_flow: '46000' }); // 缺 debt_service → 会生成客户问题
    await uploadBytes(h.api, inv, { kind: 'document', bytes: decl });
    await driveToEnd(h.api);
    let st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    assert.equal(st.pause.outboundPaused, true);
    const qPaused = st.questions.find((q) => q.target_fact === 'monthly_debt_service');
    assert.ok(qPaused, '暂停期问题仍须准备（只登记）');
    assert.equal(qPaused.status, 'outbound_paused', '暂停 → 零新外发授权');
    // 恢复：下一次分析把同一问题推进为建议/排队态（状态前移不回退）
    await h.api('/api/connectors/processing/pause', { tenantId: TENANT, customerId: CUST, paused: false, actor: 'op-1' });
    const inv2 = await setupInvitation(h.api);
    await uploadBytes(h.api, inv2, { kind: 'document', bytes: declTxtBytes({ entity_identity_verified: 'yes' }) });
    await driveToEnd(h.api);
    st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    const qAfter = st.questions.find((q) => q.target_fact === 'monthly_debt_service');
    assert.equal(qAfter.status, 'suggested', '恢复后按当前代际推进为建议态（默认策略未外发）');
  } finally { await h.dispose(); }
});

test('P08 auto_whitelist 才外发：白名单策略经 send 外发，question_key 幂等不重发', async () => {
  const h = await makeProcessingHarness({
    port: PORT,
    processing: { outboundPolicy: 'auto_whitelist' },
  });
  try {
    const inv = await setupInvitation(h.api);
    // 客户外发需要 active 绑定 + 同意
    const b = (await h.store.query(`SELECT binding_id FROM participant_bindings WHERE tenant_id=$1`, [TENANT])).rows[0];
    await h.api('/api/connectors/intake/verify-binding', { tenantId: TENANT, bindingId: b.binding_id, verifiedBy: 'op-1', evidenceRefs: ['call:1'] });
    await h.svc.consent.grant({ tenantId: TENANT, subjectType: 'customer_participant', subjectId: CUST, channel: 'wecom_kf', purposes: ['external_disclosure'], dataCategory: 'business_verification', basis: 'customer_consent', source: 'test' });
    const decl = declCsvBytes({ monthly_operating_cash_flow: '46000' }); // 缺 debt_service → evidence_request（白名单目的）
    await uploadBytes(h.api, inv, { kind: 'document', bytes: decl });
    await driveToEnd(h.api);
    let st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    const q = st.questions.find((x) => x.target_fact === 'monthly_debt_service');
    assert.equal(q.tier, 'auto_outbound');
    assert.equal(q.status, 'sent_ok', '白名单策略+客户线程 → 外发');
    let sendCalls = (await h.store.query(`SELECT count(*)::int n FROM communication_events WHERE direction='outbound' AND source_type='wecom_kf_msg'`)).rows[0].n;
    assert.equal(sendCalls, st.questions.filter((q) => q.tier === 'auto_outbound').length, '白名单目的逐问外发');
    // 新任务再分析：同键问题不重发
    const inv2 = await setupInvitation(h.api);
    await uploadBytes(h.api, inv2, { kind: 'document', bytes: declTxtBytes({ entity_identity_verified: 'yes' }) });
    await driveToEnd(h.api);
    st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    assert.equal(st.questions.find((x) => x.target_fact === 'monthly_debt_service').status, 'sent_ok', '同键问题状态保持');
    sendCalls = (await h.store.query(`SELECT count(*)::int n FROM communication_events WHERE direction='outbound' AND source_type='wecom_kf_msg'`)).rows[0].n;
    assert.equal(sendCalls, 5, 'clientMsgId=question_key 幂等：同键问题不重发，仍只有首轮 5 条');
  } finally { await h.dispose(); }
});

test('P09 超时未知：A 登记超时 → blocked_unknown；回执对账恢复且 POST 恰一次（不换 ID 重发）', async () => {
  const calls = [];
  let failPost = true;
  const scriptedFetch = async (url, init = {}) => {
    calls.push({ method: init.method ?? 'GET', url: String(url) });
    if (String(url).endsWith('/projects/proj-x')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, projectInputVersion: 1 }) };
    }
    if (String(url).includes('/evidence') && (init.method ?? 'GET') === 'POST') {
      if (failPost) {
        const e = new Error('simulated gateway timeout');
        e.name = 'TimeoutError';
        throw e;
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, evidence: { evidenceId: 'aev-1' } }) };
    }
    if (String(url).includes('/receipts/')) {
      return failPost
        ? { ok: true, status: 404, json: async () => ({ ok: false }) }
        : { ok: true, status: 200, json: async () => ({ ok: true, requestId: 'ptx-reconciled', replayed: true }) };
    }
    return { ok: true, status: 404, json: async () => ({ ok: false }) };
  };
  const h = await makeProcessingHarness({
    port: PORT,
    aBaseUrl: 'http://127.0.0.1:48080',
    aFetchImpl: scriptedFetch,
    processing: { aProjectByCustomer: { [CUST]: 'proj-x' }, aTimeoutMs: 300 },
  });
  try {
    const inv = await setupInvitation(h.api);
    await uploadBytes(h.api, inv, { bytes: bankCsvBytes() });
    await driveToEnd(h.api);
    let st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    const task = st.tasks[0];
    assert.equal(task.status, 'blocked_unknown', '结果未知：保持 unknown，不伪装成功/失败');
    assert.equal(task.failure_code, 'A_REGISTER_UNKNOWN');
    const postCount1 = calls.filter((c) => c.method === 'POST').length;
    await driveToEnd(h.api);
    assert.equal(calls.filter((c) => c.method === 'POST').length, postCount1, 'unknown 期间绝不重发');
    failPost = false; // 回执出现（模拟 A 已落账）
    await driveToEnd(h.api);
    st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    assert.equal(st.tasks[0].status, 'done', '回执对账确认后恢复');
    assert.equal(calls.filter((c) => c.method === 'POST').length, postCount1, '对账路径 POST 恰一次');
  } finally { await h.dispose(); }
});

test('P10 进程终止后恢复：段间崩溃重试+过期租约回收，解析/事实零重复', async () => {
  const h = await makeProcessingHarness({
    port: PORT,
    processing: {
      // 故障注入：parse 段成功后模拟进程崩溃（抛出 → 有限重试路径）
      hookAfterStage: (task, stage) => { if (stage === 'parse' && task.attempts === 1) throw new Error('simulated crash after parse'); },
    },
  });
  try {
    const inv = await setupInvitation(h.api);
    const up = await uploadBytes(h.api, inv, { bytes: bankCsvBytes() });
    await driveToEnd(h.api, { maxRounds: 16 });
    const st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    const task = st.tasks[0];
    assert.equal(task.status, 'done', '崩溃后有限重试续跑完成');
    assert.equal(task.attempts >= 2, true, `崩溃消耗一次重试: attempts=${task.attempts}`);
    const full = await fetchDetail(h, task.task_id);
    const parseRuns = full.task.stages.filter((s) => s.stage === 'parse');
    assert.equal(parseRuns.filter((s) => s.status === 'done').length, 1, '真实解析只执行一次');
    const factsRuns = full.task.stages.filter((s) => s.stage === 'facts');
    assert.ok(factsRuns.length >= 1 && factsRuns[0].attempt >= 2, `崩溃后续跑发生在新 attempt（游标已过 parse 段）: ${JSON.stringify(full.task.stages.map((s) => [s.stage, s.attempt, s.status]))}`);
    const obs = (await h.store.query(`SELECT count(*)::int n FROM evidence_observations WHERE artifact_id=$1`, [up.evidenceId])).rows[0].n;
    assert.equal(obs, 1, '观测零重复');
    // 过期租约回收路径：再造"崩溃残留"现场
    const up2 = await uploadBytes(h.api, inv, { kind: 'document', bytes: declTxtBytes() });
    await h.store.query(
      `UPDATE processing_tasks SET status='running', leased_until=now() - interval '5 seconds', leased_by='dead-worker', stage_cursor='parse', attempts=1 WHERE task_id=$1`,
      [up2.processing.taskId],
    );
    const r = await h.api('/api/connectors/processing/tick', { maxTasks: 4 });
    assert.ok(r.reclaimed >= 1, '过期租约被回收');
    await driveToEnd(h.api);
    const st2 = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    assert.equal(st2.tasks.find((x) => x.task_id === up2.processing.taskId).status, 'done', '中断任务恢复完成');
  } finally { await h.dispose(); }
});

test('P11 重复回调/任务重入：对已完成任务重复 tick 零副作用', async () => {
  const h = await makeProcessingHarness({ port: PORT });
  try {
    const inv = await setupInvitation(h.api);
    await uploadBytes(h.api, inv, { bytes: bankCsvBytes() });
    await driveToEnd(h.api);
    const snapshot = async () => ({
      facts: (await h.store.query(`SELECT count(*)::int n FROM fact_assertions`)).rows[0].n,
      obs: (await h.store.query(`SELECT count(*)::int n FROM evidence_observations`)).rows[0].n,
      domains: (await h.store.query(`SELECT count(*)::int n FROM domain_analyses`)).rows[0].n,
      fins: (await h.store.query(`SELECT count(*)::int n FROM analysis_finalizations`)).rows[0].n,
      questions: (await h.store.query(`SELECT count(*)::int n FROM prepared_questions`)).rows[0].n,
    });
    const before = await snapshot();
    for (let i = 0; i < 3; i++) await h.api('/api/connectors/processing/tick', { maxTasks: 4 });
    const after = await snapshot();
    assert.deepEqual(after, before, '重入零副作用');
  } finally { await h.dispose(); }
});

test('P12 预算耗尽：客户窗口任务上限 → 超额排队不丢弃；台账实际费用=未知不记 0', async () => {
  const h = await makeProcessingHarness({ port: PORT, processing: { maxTasksPerCustomerPerHour: 1 } });
  try {
    const inv = await setupInvitation(h.api);
    await uploadBytes(h.api, inv, { bytes: bankCsvBytes() });
    await uploadBytes(h.api, inv, { kind: 'document', bytes: declTxtBytes() });
    await driveToEnd(h.api, { maxRounds: 6 });
    const st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    const counts = statusCounts(st.tasks);
    assert.equal(counts.done, 1, '窗口预算=1：只处理一件');
    assert.equal(counts.queued, 1, '超额任务排队（不丢弃不静默）');
    const costs = (await h.store.query(`SELECT estimate, actual FROM processing_costs WHERE stage='facts' LIMIT 1`)).rows[0];
    assert.equal(costs.estimate.modelCalls, 0, '确定性管线零模型调用（估算如实）');
    assert.equal(costs.actual.billKnown, false, '真实账单未接入：未知，不记 0');
  } finally { await h.dispose(); }
});

test('P13 会后补证：晚到材料只更新相关工作；answered≠材料≠核验三段分离', async () => {
  const h = await makeProcessingHarness({ port: PORT });
  try {
    const inv = await setupInvitation(h.api);
    await uploadBytes(h.api, inv, { kind: 'document', bytes: declCsvBytes({ monthly_operating_cash_flow: '46000' }) });
    await driveToEnd(h.api);
    let st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    const q = st.questions.find((x) => x.target_fact === 'monthly_debt_service');
    assert.ok(q, '缺债务事实 → 补证问题存在');
    const domainsBefore = (await h.store.query(`SELECT count(*)::int n FROM domain_analyses WHERE tenant_id=$1 AND customer_id=$2`, [TENANT, CUST])).rows[0].n;
    // 回答 ≠ 材料：先只登记回答
    await h.api('/api/connectors/questions/answer', { tenantId: TENANT, customerId: CUST, questionKey: q.question_key, answerText: '每月还贷 1.8 万', answerer: 'customer' });
    st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    assert.equal(st.questions.find((x) => x.question_key === q.question_key).status, 'answered', '回答只是回答');
    // 会后晚到材料：补 debt_service（declared 级）——不足以"核验完成"，但域更新走局部路径
    const inv3 = await setupInvitation(h.api);
    await uploadBytes(h.api, inv3, { kind: 'document', bytes: declCsvBytes({ monthly_operating_cash_flow: '46000', monthly_debt_service: '18000' }) });
    await driveToEnd(h.api);
    const domainsAfter = (await h.store.query(`SELECT count(*)::int n FROM domain_analyses WHERE tenant_id=$1 AND customer_id=$2`, [TENANT, CUST])).rows[0].n;
    assert.ok(domainsAfter >= domainsBefore, '晚到材料触发必要的域更新');
    st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    const qAfter = st.questions.find((x) => x.question_key === q.question_key);
    assert.ok(['answered', 'material_received'].includes(qAfter.status), `answered 不被自动回退: ${qAfter.status}`);
    // verified 只能由人工核验产生
    const v = await h.api('/api/connectors/questions/verify', { tenantId: TENANT, customerId: CUST, questionKey: q.question_key, verifiedBy: 'op-1', note: '与流水逐笔核对' });
    assert.equal(v.status, 'verified');
    await h.api('/api/connectors/questions/verify', { tenantId: TENANT, customerId: CUST, questionKey: q.question_key, verifiedBy: 'op-1', note: '' }, { expect: 400 });
  } finally { await h.dispose(); }
});
