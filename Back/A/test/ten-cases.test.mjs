// 收尾02 验收：十案例材料驱动闭环（真实 HTTP + PostgreSQL + worker 执行器）。
// 覆盖：十例独立期望检查点、授权过滤、材料关键值变更改判断、幂等/越权/旧版本、
// 补件选择性失效、核验登记语义（DEF-03-02/03-05）、08 预评估收口零额度、09/10 周期全生命周期边界。
// 全部走获准隔离栈（arrow_test 专用库），合成材料；独立期望在 materials/EXPECTED.json（手工推导）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTenCaseRuntime, } from '../scripts/ten-case-runtime.mjs';
import { CASES } from '../scripts/ten-cases-fixtures.mjs';
import { HUMAN, TENANT } from '../scripts/parallel-arrows-runtime.mjs';

const MATERIALS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/integration/2026-09-30-final/materials');

test('ten cases: material-driven checkpoints, authority directory and lifecycle boundaries', async t => {
  const run = randomUUID().slice(0, 8);
  const r = await createTenCaseRuntime({ dbUrl: process.env.ARROW_TEST_DB_URL, run, batch: 'checkpoint' });
  t.after(async () => { await r.advance.drain(); await r.close(); });
  const login = async credential => { const x = await fetch(r.baseUrl + '/api/jw/v2/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }) }); return (await x.json()).session.sessionId; };
  const sid = await login(HUMAN);
  const call = async (method, url, body, session = sid) => { const x = await fetch(r.baseUrl + '/api/jw/v2' + url, { method,
    headers: { 'content-type': 'application/json', 'x-jw-session': session, origin: r.baseUrl }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: x.status, body: await x.json() }; };
  const aCall = async (method, url, body, credential = HUMAN) => { const x = await fetch(r.aUrl + '/api/v2' + url, { method,
    headers: { 'content-type': 'application/json', 'x-principal-credential': credential }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: x.status, body: await x.json() }; };
  const byId = Object.fromEntries(r.cases.map(c => [c.caseId, c]));
  const expected = JSON.parse(await readFile(path.join(MATERIALS, 'EXPECTED.json'), 'utf8'));
  const expectedById = Object.fromEntries(expected.cases.map(c => [c.caseId, c]));

  await t.test('T1 十例检查点与独立期望一致；展示序/分类/业务名齐全；A 为权威清单来源', async () => {
    const x = await call('GET', '/arrow-cases');
    assert.equal(x.status, 200, JSON.stringify(x.body).slice(0, 400));
    assert.equal(x.body.manifestVersion, 'arrow-case-directory-v1');
    assert.equal(x.body.cases.length, 10);
    assert.deepEqual(x.body.cases.map(c => c.displayOrder), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(x.body.cases.map(c => c.category), ['差', '差', '差', '中', '中', '中', '中', '好', '好', '好']);
    for (const c of x.body.cases) {
      assert.equal(c.scenarioIsOutcome, false);
      assert.ok(c.businessName && c.summary, c.caseId);
      assert.equal(c.checkpoint.type, expectedById[c.caseId].expectedCheckpointType,
        `${c.caseId}: 实际=${c.checkpoint.type} 期望=${expectedById[c.caseId].expectedCheckpointType}（${JSON.stringify(c.checkpoint).slice(0, 300)}）`);
      assert.ok(c.checkpoint.label && c.checkpoint.detail && c.checkpoint.evidence, c.caseId);
      assert.ok(Array.isArray(c.nextActions), c.caseId);
      assert.equal(c.assistant.source, '案例说明');
      assert.equal(c.assistant.modelInvolved, false);
      assert.ok(c.assistant.currentFacts.length > 0 && c.assistant.basis.artifactCount > 0, c.caseId);
    }
    // 检查点证据可追溯：每例 evidence 指向真实作业/流程/周期/评估
    const c08 = x.body.cases.find(c => c.caseId === 'case-08');
    assert.equal(c08.checkpoint.evidence.kind, 'assessment');
    const c09 = x.body.cases.find(c => c.caseId === 'case-09');
    assert.equal(c09.progress.cycleState, 'awaiting_external_receipt');
  });

  await t.test('T2 授权过滤：跨租户为空、客户身份 403、detail 越权 404；材料 hash 与 MANIFEST 一致', async () => {
    const cross = await login('arrow-cross');
    const cx = await call('GET', '/arrow-cases', null, cross);
    assert.equal(cx.status, 200); assert.equal(cx.body.cases.length, 0);
    const inv = await r.kernel.identity.createInvitation({ credential: HUMAN, tenantId: TENANT, requestId: randomUUID(),
      role: 'customer-owner', allowedKinds: ['financial_statement'] }, byId['case-09'].customerId);
    const red = await r.kernel.identity.redeemInvitation({ requestId: randomUUID(), code: inv.invitation.code });
    assert.ok(red.credential, '兑换应返回客户凭据');
    const denied = await aCall('GET', '/arrow-cases', null, red.credential); // 客户身份 → A 目录 403
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
    const d = await aCall('GET', '/arrow-cases/case-09', null, red.credential);
    assert.ok([403, 404].includes(d.status), JSON.stringify(d));
    // 材料 hash：登记工件 originFile.sha256 == 材料包文件 hash
    const detail = await aCall('GET', '/arrow-cases/case-03');
    assert.equal(detail.status, 200);
    const fin = detail.body.case.assistant.basis.materialRefs.find(m => m.kind === 'financial_statement');
    const manifest = JSON.parse(await readFile(path.join(MATERIALS, 'MANIFEST.json'), 'utf8'));
    const registered = await r.pool.query('SELECT content FROM evidence_artifacts WHERE artifact_id=$1', [fin.artifactId]);
    const content = registered.rows[0].content;
    assert.equal(content.originFile.sha256, manifest.files['case-03/financial_summary.csv'].sha256);
    const disk = await readFile(path.join(MATERIALS, 'case-03', 'financial_summary.csv'), 'utf8');
    assert.equal(content.fileText, disk); // 登记全文与磁盘字节一致
  });

  await t.test('T3 材料关键值变更改变判断：case-01 收入降到线内后红线解除、可正常推进', async () => {
    const c = byId['case-01'];
    const before = await aCall('GET', '/arrow-cases/case-01');
    assert.equal(before.body.case.checkpoint.type, 'blocked_redline');
    const art = (await r.pool.query('SELECT artifact_id FROM evidence_artifacts WHERE customer_id=$1 AND fact_key=$2 AND superseded_by IS NULL', [c.customerId, 'revenue_annual_declared'])).rows[0];
    await r.kernel.v2.registerArtifact({ credential: HUMAN, tenantId: TENANT, requestId: randomUUID(), kind: 'financial_statement',
      factKey: 'revenue_annual_declared', grade: 'confirmed', supersedes: art.artifact_id,
      content: { value: 48000000, unit: 'CNY', sourceMode: 'human_verified_document', factKey: 'revenue_annual_declared', note: '更正：年报复核后收入 4800 万（合成）' },
      materialMeta: { subjectRef: c.customerId, unit: 'CNY', caliber: '人工核验原件后登记（合成）' } }, c.customerId);
    const after = await aCall('GET', '/arrow-cases/case-01');
    assert.notEqual(after.body.case.checkpoint.type, 'blocked_redline');
    assert.equal(after.body.case.checkpoint.type, 'ready_to_analyze');
    const plan = await call('GET', `/customers/${c.customerId}/advance-plan?domain=business`);
    assert.equal(plan.body.available, true, JSON.stringify(plan.body));
    assert.notEqual(plan.body.reason, 'CUSTOMER_REVENUE_REDLINE');
  });

  await t.test('T4 补件选择性失效（case-04）：仅 credit/policy 重算，其余区 selection 逐字节不变', async () => {
    const c = byId['case-04'];
    const before = await call('GET', `/customers/${c.customerId}/advance-rounds`);
    const saved = new Map(before.body.receipts.map(j => [j.domain, { roundId: j.roundId, selection: j.selection }]));
    assert.equal(before.body.receipts.find(j => j.domain === 'credit').state, 'waiting_evidence');
    const adopt = await call('POST', `/actions/customers/${c.customerId}/advance-rounds/${before.body.receipts.find(j => j.domain === 'credit').roundId}/decision`,
      { requestId: randomUUID(), decision: 'adopt', resultId: before.body.receipts.find(j => j.domain === 'credit').actions[0].result.resultId, expectedVersion: before.body.version });
    assert.equal(adopt.status, 409); // 缺件不可采用
    const runsBefore = Number((await r.pool.query('SELECT count(*) n FROM analysis_runs WHERE customer_id=$1', [c.customerId])).rows[0].n);
    const art = (await r.pool.query('SELECT artifact_id FROM evidence_artifacts WHERE customer_id=$1 AND fact_key=$2 AND superseded_by IS NULL', [c.customerId, 'monthly_operating_cash_flow'])).rows[0];
    await r.kernel.v2.registerArtifact({ credential: HUMAN, tenantId: TENANT, requestId: randomUUID(), kind: 'financial_statement',
      factKey: 'monthly_operating_cash_flow', grade: 'confirmed', supersedes: art.artifact_id,
      content: { value: 200000, unit: 'CNY', sourceMode: 'human_verified_document', factKey: 'monthly_operating_cash_flow', note: '补件：银行对账单（合成）' },
      materialMeta: { subjectRef: c.customerId, unit: 'CNY', caliber: '人工核验原件后登记（合成）' } }, c.customerId);
    const affected = (await call('GET', `/customers/${c.customerId}/advance-rounds`)).body.affectedDomains.sort();
    assert.deepEqual(affected, expectedById['case-04'].expectedAffectedAfterSupplement);
    const plan = await (await call('GET', `/customers/${c.customerId}/advance-plan?domain=credit`)).body;
    const adv = await call('POST', `/actions/customers/${c.customerId}/advance-rounds`, { requestId: randomUUID(), domain: 'credit',
      planId: plan.planId, planHash: plan.planHash, expectedVersion: plan.expectedVersion, roundNo: plan.roundNo, actionIds: plan.actionIds });
    assert.ok([200, 202].includes(adv.status), JSON.stringify(adv.body));
    await r.advance.drain();
    assert.equal(Number((await r.pool.query('SELECT count(*) n FROM analysis_runs WHERE customer_id=$1', [c.customerId])).rows[0].n), runsBefore + 2);
    const after = (await call('GET', `/customers/${c.customerId}/advance-rounds`)).body;
    for (const d of ['business', 'commerce', 'asset']) {
      const j = after.receipts.find(j => j.domain === d);
      assert.equal(j.roundId, saved.get(d).roundId); assert.deepEqual(j.selection, saved.get(d).selection);
    }
    assert.equal(after.receipts.find(j => j.domain === 'credit').state, 'awaiting_confirmation');
  });

  await t.test('T5 核验登记语义（DEF-03-02 确认）与 case-06 从核验待办到收口', async () => {
    const c = byId['case-06'];
    const before = await aCall('GET', '/arrow-cases/case-06');
    assert.equal(before.body.case.checkpoint.type, 'verification_pending');
    const next = before.body.case.nextActions[0];
    assert.equal(next.action, 'register-verification');
    assert.deepEqual(next.factKeys, ['revenue_annual_declared', 'entity_identity_verified', 'equipment_ownership_verified']);
    const runsBefore = Number((await r.pool.query('SELECT count(*) n FROM analysis_runs WHERE customer_id=$1', [c.customerId])).rows[0].n);
    for (const v of CASES.find(x => x.caseId === 'case-06').recipe.demoVerifications) {
      await r.kernel.v2.registerArtifact({ credential: HUMAN, tenantId: TENANT, requestId: randomUUID(),
        kind: v.factKey === 'revenue_annual_declared' ? 'financial_statement' : 'equipment_list', factKey: v.factKey, grade: v.grade,
        content: { value: v.value, unit: null, sourceMode: 'human_verified_document', factKey: v.factKey, note: v.note },
        materialMeta: { subjectRef: c.customerId, unit: null, caliber: '人工核验原件后登记（合成）' } }, c.customerId);
    }
    const affected = (await call('GET', `/customers/${c.customerId}/advance-rounds`)).body.affectedDomains.sort();
    assert.deepEqual(affected, expectedById['case-06'].expectedAffectedAfterVerification, 'DEF-03-02 语义：核验登记只失效消费三键的域');
    const plan = (await call('GET', `/customers/${c.customerId}/advance-plan?domain=business`)).body;
    const adv = await call('POST', `/actions/customers/${c.customerId}/advance-rounds`, { requestId: randomUUID(), domain: 'business',
      planId: plan.planId, planHash: plan.planHash, expectedVersion: plan.expectedVersion, roundNo: plan.roundNo, actionIds: plan.actionIds });
    assert.ok([200, 202].includes(adv.status), JSON.stringify(adv.body));
    await r.advance.drain();
    assert.equal(Number((await r.pool.query('SELECT count(*) n FROM analysis_runs WHERE customer_id=$1', [c.customerId])).rows[0].n), runsBefore + 3);
    const v = (await call('GET', `/customers/${c.customerId}/advance-rounds`)).body;
    assert.ok(v.domains.every(d => d.state === 'awaiting_confirmation'), JSON.stringify(v.domains));
  });

  await t.test('T6 case-08 预评估收口：确认前零额度，确认后 preassessment_confirmed 仍零额度', async () => {
    const c = byId['case-08'];
    const ledgers = async () => ({
      facilities: Number((await r.pool.query('SELECT count(*) n FROM credit_facilities WHERE customer_id=$1', [c.customerId])).rows[0].n),
      frs: Number((await r.pool.query('SELECT count(*) n FROM financing_requests WHERE customer_id=$1', [c.customerId])).rows[0].n),
      exposure: Number((await r.pool.query(`SELECT count(*) n FROM exposure_entries e JOIN financing_requests f ON f.fr_id=e.fr_id WHERE f.customer_id=$1`, [c.customerId])).rows[0].n) });
    const before = await aCall('GET', '/arrow-cases/case-08');
    assert.equal(before.body.case.checkpoint.type, 'preassessment_review');
    const zero0 = await ledgers();
    assert.deepEqual(zero0, { facilities: 0, frs: 0, exposure: 0 });
    const assessmentId = c.assessmentId;
    const a = await r.kernel.v2.getAssessment(HUMAN, assessmentId);
    const version = Number(a.assessment.version);
    const cand = await r.kernel.v2.listAssessmentCandidates(HUMAN, assessmentId);
    const revision = Number(cand.candidates.at(-1).revision);
    const confirm = await r.kernel.v2.confirmPreassessment({ credential: HUMAN, tenantId: TENANT, requestId: randomUUID(),
      outcome: 'support', assessmentVersion: version, candidateRevision: revision, rationale: '预评估收口（十案例种子）：预评估范围，不批准正式额度' }, assessmentId);
    assert.equal(confirm.ok, true);
    assert.equal(confirm.scope ?? 'preassessment_only', 'preassessment_only');
    assert.deepEqual(await ledgers(), zero0); // 确认后额度账本仍零写入
    const after = await aCall('GET', '/arrow-cases/case-08');
    assert.equal(after.body.case.checkpoint.type, 'preassessment_confirmed');
  });

  await t.test('T7 case-09 履约待回执：未确认不可结清；模拟回执（SIM 前缀+manual-attestation）确认后可结清', async () => {
    const c = byId['case-09'];
    const cycles = (await call('GET', `/customers/${c.customerId}/cycles`)).body.cycles;
    assert.equal(cycles[0].state, 'awaiting_external_receipt');
    assert.equal(cycles[0].externalIntegration.connected, false);
    const early = await call('POST', `/actions/customers/${c.customerId}/cycles/${c.cycleId}/settle`, { requestId: randomUUID() });
    assert.equal(early.status, 409); assert.ok(early.body.message.includes('SETTLE_REQUIRES_EXTERNAL_RECEIPT'));
    const rec = await call('POST', `/actions/customers/${c.customerId}/cycles/${c.cycleId}/external-receipt`,
      { requestId: randomUUID(), ref: 'SIM-WIRE-c09-0001', source: 'manual-attestation' });
    assert.equal(rec.status, 200, JSON.stringify(rec.body));
    assert.equal(rec.body.cycle.externalReceipt.source, 'manual-attestation');
    const st = await call('POST', `/actions/customers/${c.customerId}/cycles/${c.cycleId}/settle`, { requestId: randomUUID() });
    assert.equal(st.status, 200); assert.equal(st.body.cycle.state, 'settled');
    const view = await aCall('GET', '/arrow-cases/case-09');
    assert.equal(view.body.case.checkpoint.type, 'settled_reorderable');
  });

  await t.test('T8 case-10 返单边界：新周期独立（新五区流程），历史不覆盖；重演幂等', async () => {
    const c = byId['case-10'];
    const cycles = (await call('GET', `/customers/${c.customerId}/cycles`)).body.cycles;
    assert.equal(cycles[0].state, 'closed');
    assert.equal(cycles[0].externalReceipt.ref, 'SIM-WIRE-c10-0001');
    const early = await call('POST', `/actions/customers/${c.customerId}/cycles`, { requestId: randomUUID(), reorderOf: c.cycleId });
    assert.equal(early.status, 409); assert.ok(early.body.message.includes('REORDER_REQUIRES_FRESH_CASE'));
    // 返单：新一轮五区（新流程、独立依据）→ 采用 → reorder
    const plan = (await call('GET', `/customers/${c.customerId}/advance-plan?domain=business`)).body;
    const adv = await call('POST', `/actions/customers/${c.customerId}/advance-rounds`, { requestId: randomUUID(), domain: 'business',
      planId: plan.planId, planHash: plan.planHash, expectedVersion: plan.expectedVersion, roundNo: plan.roundNo, actionIds: plan.actionIds });
    assert.ok([200, 202].includes(adv.status), JSON.stringify(adv.body));
    await r.advance.drain();
    for (const d of ['business', 'policy', 'credit', 'commerce', 'asset']) {
      const v = (await call('GET', `/customers/${c.customerId}/advance-rounds?domain=${d}`)).body;
      const j = v.receipt;
      const x = await call('POST', `/actions/customers/${c.customerId}/advance-rounds/${j.roundId}/decision`,
        { requestId: randomUUID(), decision: 'adopt', resultId: j.actions[0].result.resultId, expectedVersion: v.version, rationale: '返单轮人工采用' });
      assert.equal(x.status, 200, JSON.stringify(x.body));
    }
    const reorder = await call('POST', `/actions/customers/${c.customerId}/cycles`, { requestId: randomUUID(), reorderOf: c.cycleId });
    assert.equal(reorder.status, 200, JSON.stringify(reorder.body));
    assert.equal(reorder.body.cycle.cycleNo, 2);
    assert.equal(reorder.body.cycle.reorderOfCycleId, c.cycleId);
    assert.notEqual(reorder.body.cycle.sourceProcessId, cycles[0].sourceProcessId);
    const all = (await call('GET', `/customers/${c.customerId}/cycles`)).body.cycles;
    assert.equal(all.length, 2); // 历史不覆盖：第1期仍 closed 可查
    assert.equal(all.find(x => x.cycleId === c.cycleId).state, 'closed');
  });

  await t.test('T9 幂等/越权/旧版本与硬阻断负例（跨例抽查）', async () => {
    // 幂等：案例登记重放（同载荷 reused:true）
    const reg = await fetch(r.aUrl + '/api/v2/arrow-case-registry', { method: 'POST', headers: { 'content-type': 'application/json', 'x-principal-credential': 'arrow-admin-admin' },
      body: JSON.stringify({ requestId: `ten:register:case-03`, caseId: 'case-03', customerId: byId['case-03'].customerId, displayOrder: 3,
        category: '差', businessName: '准噶尔包装制品厂', summary: CASES.find(c => c.caseId === 'case-03').summary, batch: 'checkpoint' }) });
    assert.equal((await reg.json()).reused, true);
    // 越权：单区角色不可登记案例；非 admin 403
    const reg2 = await fetch(r.aUrl + '/api/v2/arrow-case-registry', { method: 'POST', headers: { 'content-type': 'application/json', 'x-principal-credential': HUMAN },
      body: JSON.stringify({ requestId: randomUUID(), caseId: 'case-x', customerId: byId['case-03'].customerId, displayOrder: 99, category: '差', businessName: 'x', summary: 'x' }) });
    assert.equal(reg2.status, 403);
    // 旧版本：case-07 补证后旧候选确认 → 409 VERSION_CONFLICT
    const c7 = byId['case-07'];
    const v7 = (await call('GET', `/customers/${c7.customerId}/advance-rounds?domain=asset`)).body; // asset 未采用（awaiting_confirmation），补证后依据已变
    const stale = await call('POST', `/actions/customers/${c7.customerId}/advance-rounds/${v7.receipt.roundId}/decision`,
      { requestId: randomUUID(), decision: 'adopt', resultId: v7.receipt.actions[0].result.resultId, expectedVersion: v7.version, rationale: '基于旧依据确认应被拒' });
    assert.equal(stale.status, 409); assert.equal(stale.body.error, 'VERSION_CONFLICT');
    // 硬阻断：case-02 再次尝试采用仍被拒（审计已有首拒绝留痕）
    const c2 = byId['case-02'];
    const v2 = (await call('GET', `/customers/${c2.customerId}/advance-rounds?domain=asset`)).body;
    const hb = await call('POST', `/actions/customers/${c2.customerId}/advance-rounds/${v2.receipt.roundId}/decision`,
      { requestId: randomUUID(), decision: 'adopt', resultId: v2.receipt.actions[0].result.resultId, expectedVersion: v2.version, rationale: '高置信度声明也不能覆盖' });
    assert.equal(hb.status, 409); assert.ok(hb.body.message.includes('HARD_BLOCK_NOT_ADOPTABLE'));
    // 单事件并行证据（case-05 首轮五区）：独立线程+重叠
    const c5 = byId['case-05'];
    const times = (await r.pool.query(`SELECT result->'execution' exec FROM arrow_jobs j JOIN arrow_processes p ON p.process_id=j.process_id
      WHERE p.customer_id=$1 AND j.attempt=1 AND result IS NOT NULL`, [c5.customerId])).rows.map(x => x.exec);
    assert.equal(new Set(times.map(x => x.threadId)).size, 5);
    assert.ok(times.some((a, i) => times.some((b, j) => i !== j && Date.parse(a.startedAt) < Date.parse(b.finishedAt) && Date.parse(b.startedAt) < Date.parse(a.finishedAt))));
  });

  await t.test('T10 从头体验批次：fresh 只建客户+材料，检查点=材料就绪待分析', async () => {
    const fresh = await createTenCaseRuntime({ dbUrl: process.env.ARROW_TEST_DB_URL, run: randomUUID().slice(0, 8), batch: 'fresh' });
    try {
      const list = await fresh.advance.read ? null : null;
      const x = await fetch(fresh.baseUrl + '/api/jw/v2/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: HUMAN }) });
      const s = (await x.json()).session.sessionId;
      const dir = await fetch(fresh.baseUrl + '/api/jw/v2/arrow-cases', { headers: { 'x-jw-session': s, origin: fresh.baseUrl } });
      const body = await dir.json();
      assert.equal(body.cases.length, 10);
      for (const c of body.cases) {
        const expectedFresh = c.caseId === 'case-01' ? 'blocked_redline' : 'ready_to_analyze';
        assert.equal(c.checkpoint.type, expectedFresh, `${c.caseId}: ${c.checkpoint.type}`);
      }
      assert.equal(body.cases.every(c => c.batch === 'fresh'), true);
    } finally { await fresh.advance.drain(); await fresh.close(); }
  });
});
