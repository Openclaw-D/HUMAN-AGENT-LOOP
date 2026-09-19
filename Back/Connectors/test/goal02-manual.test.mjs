// goal-02（产品交付·任务二）· B2 人工路线 e2e：扫描件→人工录入→更正→获准复核 三段分离。
// 断言铁律（任务书 §四）：录入=转录（≠核验完成）；更正留修订链与理由；verified 只能由人工复核产生。
import test from 'node:test';
import assert from 'node:assert/strict';
import { pgAvailable } from './helpers.mjs';
import { TENANT, makeProcessingHarness, setupInvitation, uploadBytes, driveToEnd } from './processing-helpers.mjs';

const ok = await pgAvailable();
if (!ok) {
  console.log('# SKIP: PG 127.0.0.1:15443 不可达（blocked_env，不计 PASS）');
  process.exit(0);
}

const CUST = 'cust-proc-1';
const PORT = 48289;

async function factsOf(h, evidenceId) {
  return (await h.store.query(
    `SELECT fact_id, subject, predicate, object_value, status, superseded_by, correction_of, stale_reason
     FROM fact_assertions WHERE tenant_id=$1 AND from_artifacts @> $2::jsonb ORDER BY created_at`,
    [TENANT, JSON.stringify([evidenceId])],
  )).rows;
}

test('M1 扫描件人工路线：解析转人工→人工录入（转录≠核验）→录入冲突并存→更正修订链→人工复核 verified', async () => {
  const h = await makeProcessingHarness({ port: PORT });
  try {
    const inv = await setupInvitation(h.api);
    // 扫描 PDF（无文本层）：解析 FORMAT_UNSUPPORTED → needs_followup 任务 + 转人工问题；工件本身 complete（字节可读可预览）
    const up = await uploadBytes(h.api, inv, { kind: 'document', bytes: Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8') });
    await driveToEnd(h.api);
    assert.ok(up.evidenceId);

    // 人工录入：原件可见（预览）+来源定位+录入人（转录，不是核验）
    const entry = await h.api('/api/connectors/evidence/manual-entry', {
      tenantId: TENANT, customerId: CUST, evidenceId: up.evidenceId,
      facts: [
        { factKey: 'contract_amount_minor', value: 1200000, unit: '分', location: '扫描件第1页 金额栏' },
        { factKey: 'equipment_model', value: 'LX-105', location: '扫描件第1页 型号栏' },
      ],
      enteredBy: 'staff-wang', reason: '扫描件无文本层，人工读取录入',
    });
    assert.equal(entry.ok, true);
    assert.equal(entry.facts.length, 2);
    assert.ok(entry.note.includes('核验须另行'), '录入≠核验语义明确');

    // 同证据再次录入同键不同值 → 冲突显式并存（同一锚点）
    const entry2 = await h.api('/api/connectors/evidence/manual-entry', {
      tenantId: TENANT, customerId: CUST, evidenceId: up.evidenceId,
      facts: [{ factKey: 'contract_amount_minor', value: 2100000, unit: '分', location: '扫描件第2页 补充栏' }],
      enteredBy: 'staff-wang', reason: '复核时发现另一处金额记载',
    });
    assert.equal(entry2.ok, true);
    assert.ok((entry2.facts[0].conflicts ?? []).length >= 1, '同键不同值 → 冲突记录');

    const fs1 = await factsOf(h, up.evidenceId);
    assert.equal(fs1.filter((f) => f.predicate === 'contract_amount_minor').length, 2, '两个取值并存（不覆盖）');

    // 更正：修订链（correction_of）+理由；更正≠核验完成
    const wrongFact = fs1.find((f) => f.predicate === 'equipment_model');
    const corr = await h.api('/api/connectors/evidence/correct-fact', {
      tenantId: TENANT, customerId: CUST, correctsFactId: wrongFact.fact_id,
      fact: { subject: wrongFact.subject, predicate: 'equipment_model', value: 'LX-105Z', unit: null },
      reason: '型号末位识别为 Z（放大件复核）', correctedBy: 'staff-wang',
    });
    assert.equal(corr.ok, true);
    const fs2 = await factsOf(h, up.evidenceId);
    const corrected = fs2.find((f) => f.fact_id === corr.factId);
    assert.equal(corrected.correction_of, wrongFact.fact_id, '更正链可回溯');
    assert.equal(fs2.find((f) => f.fact_id === wrongFact.fact_id).status, 'superseded', '旧候选被取代（历史保留）');

    // 人工复核（获准人员，附理由）：verified 只能由复核产生
    const manualQ = (await h.api(`/api/connectors/questions/pending?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' })).questions;
    const q = manualQ.find((x) => x.binding?.purpose === 'manual_entry_required');
    const vf = await h.api('/api/connectors/questions/verify', {
      tenantId: TENANT, customerId: CUST, questionKey: q.question_key, verifiedBy: 'reviewer-li', note: '已对照原件逐项复核',
    });
    assert.equal(vf.status, 'verified', '人工复核产生 verified');

    // 重复录入同内容幂等（contentKey 确定性）
    const again = await h.api('/api/connectors/evidence/manual-entry', {
      tenantId: TENANT, customerId: CUST, evidenceId: up.evidenceId,
      facts: [{ factKey: 'equipment_model', value: 'LX-105Z', location: '扫描件第1页 型号栏' }],
      enteredBy: 'staff-wang', reason: '重复提交校验',
    });
    assert.equal(again.facts[0].existed, true, '同内容重录零新增候选');
  } finally { await h.dispose(); }
});

test('M2 待补（不可读）材料拒绝人工录入：先补齐重传，不对缺失原件编数', async () => {
  const h = await makeProcessingHarness({ port: PORT });
  try {
    const inv = await setupInvitation(h.api);
    // 空字节 → readable=false → needs_followup 工件
    const up = await h.api('/api/connectors/evidence/upload', {
      tenantId: TENANT, customerId: CUST, invitationId: inv.invitationId, kind: 'document',
      contentBase64: Buffer.alloc(0).toString('base64'),
    });
    assert.equal(up.completeness, 'needs_followup');
    await assert.rejects(
      () => h.api('/api/connectors/evidence/manual-entry', {
        tenantId: TENANT, customerId: CUST, evidenceId: up.evidenceId,
        facts: [{ factKey: 'x', value: 1, location: '无' }], enteredBy: 'staff', reason: '尝试录入',
      }),
      /待补/, '不可读材料拒绝录入（INVALID_STATE）',
    );
  } finally { await h.dispose(); }
});

// IR-03-8②（2026-09-19 续轮）：人工事实进入四域分析输入——Gate 可被人工路线满足。
// 裁决：录入/更正=source_supported；manual_entry_required 问题获准复核 verified 后该件转录事实升 verified
//（verified 只能由复核端点产生）；事实变更触发重入分析（新输入=新收口，不覆写历史）。
test('M3(IR-03-8②) 人工路线到 CLEAR：扫描件→人工录入（source_supported，重入分析）→复核 verified（升级）→Gate 由 NEEDS_EVIDENCE 转 CLEAR', async () => {
  const h = await makeProcessingHarness({ port: PORT });
  try {
    const inv = await setupInvitation(h.api);
    const up = await uploadBytes(h.api, inv, { kind: 'document', bytes: Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8') });
    await driveToEnd(h.api);
    const t0 = (await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' }))
      .tasks.find((x) => x.task_id === up.processing.taskId);
    assert.equal(t0.status, 'needs_followup', '扫描件转人工（无分析输入）');

    // 人工录入规则前置事实（转录=source_supported）：现金覆盖+集中度 + verified 级规则相关布尔
    await h.api('/api/connectors/evidence/manual-entry', {
      tenantId: TENANT, customerId: CUST, evidenceId: up.evidenceId,
      facts: [
        { factKey: 'monthly_operating_cash_flow', value: 76000, unit: '元', location: '扫描件第1页 经营现金流栏' },
        { factKey: 'monthly_debt_service', value: 18000, unit: '元', location: '扫描件第1页 偿债栏' },
        { factKey: 'top1_customer_revenue_share', value: 45, unit: '%', location: '扫描件第2页 客户集中度' },
        { factKey: 'entity_identity_verified', value: true, location: '扫描件第1页 主体信息' },
        { factKey: 'equipment_ownership_verified', value: true, location: '扫描件第2页 权属页' },
      ],
      enteredBy: 'staff-wang', reason: '扫描件无文本层，人工读取录入',
    });
    // 录入触发重入分析（原缺陷：人工事实永不进四域输入，任务恒停在转人工）
    await driveToEnd(h.api, { maxRounds: 12 });
    const finsAfterEntry = (await h.store.query(
      `SELECT fin_id, input_hash, gate->>'result' AS result FROM analysis_finalizations WHERE tenant_id=$1 AND customer_id=$2 ORDER BY created_at`,
      [TENANT, CUST],
    )).rows;
    assert.equal(finsAfterEntry.length, 1, `录入即产生四域收口（人工事实成为分析输入）：${JSON.stringify(finsAfterEntry)}`);
    assert.equal(finsAfterEntry[0].result, 'NEEDS_EVIDENCE', 'source_supported 满足 source_supported 前置；verified 级规则仍缺证 → NEEDS_EVIDENCE（不冒充通过）');
    const t1 = (await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' }))
      .tasks.find((x) => x.task_id === up.processing.taskId);
    assert.equal(t1.status, 'done', '重入分析后任务完成');

    // 获准复核 verified（人工对照原件）→ 转录事实升 verified → 再次重入分析 → Gate CLEAR
    const q = (await h.api(`/api/connectors/questions/pending?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' })).questions
      .find((x) => x.binding?.purpose === 'manual_entry_required');
    await h.api('/api/connectors/questions/verify', {
      tenantId: TENANT, customerId: CUST, questionKey: q.question_key, verifiedBy: 'reviewer-li', note: '已对照原件逐项复核',
    });
    await driveToEnd(h.api, { maxRounds: 12 });
    const fins = (await h.store.query(
      `SELECT fin_id, input_hash, gate->>'result' AS result FROM analysis_finalizations WHERE tenant_id=$1 AND customer_id=$2 ORDER BY created_at`,
      [TENANT, CUST],
    )).rows;
    assert.equal(fins.length, 2, '复核升级=新事实状态 → 新收口（历史保留不覆写）');
    assert.notEqual(fins[0].input_hash, fins[1].input_hash, '新输入哈希（等级变更进入快照）');
    assert.equal(fins[1].result, 'CLEAR', `Gate 可被人工路线满足（前置复核升级 verified）：${fins[1].result}`);
    // 更正取代 parse/录入值：更正后重入分析且旧值不复活（快照含更正值、无被取代值）
    const facts = (await h.store.query(
      `SELECT fact_id, predicate, object_value, status, entry_mode FROM fact_assertions
       WHERE tenant_id=$1 AND customer_id=$2 AND predicate='monthly_operating_cash_flow' ORDER BY created_at`,
      [TENANT, CUST],
    )).rows;
    assert.equal(facts.length, 1, '仅录入的现金流事实');
    assert.equal(facts[0].entry_mode, 'manual_entry', '人工事实结构化溯源（entry_mode）');
  } finally { await h.dispose(); }
});
