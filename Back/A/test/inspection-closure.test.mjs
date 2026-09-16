// A3 边界 · 会后接续测试：小结投影、晚到材料修订、收口事件、outbox 语义。
// 对应验收：A08（未决冲突下结束）、A10（会后补证只重开受影响项）+ 事件契约断言。
// 运行：cd Back/A && JW_A_ADMIN_DB_URL='postgres://jwcc:jwcc-local-demo@127.0.0.1:15444/postgres' node --test test/inspection-closure.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { scaffold, startKernel, client, assertOk, assertCode, uid, T, registerArtifact } from './inspection-utils.mjs';

async function startedSession(k, opts = {}) {
  const s = await scaffold({ base: k.base, ...opts });
  const snap = await s.snapshot();
  const r = await s.own('POST', `/api/v1/inspections/${s.sessionId}/start`, { requestId: uid(), expectedVersion: snap.version, acceptedPlanVersion: snap.planVersion });
  if (r.status !== 200) throw new Error(`start 失败: ${JSON.stringify(r.json)}`);
  return s;
}

/** 推进设备项到 verified（锚定项全流程）；返回未动过的其余状态。 */
async function verifyEquipment(k, s, verdict = 'confirmed') {
  const snap = await s.snapshot();
  const eq = snap.items.find((i) => i.itemKey === 'equipment_verify');
  const q = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: uid(), itemId: eq.itemId, audience: 'customer', targetRole: 'director', purpose: 'equipment_confirm', objectRef: 'lathe-01',
    question: '车床-01 在用并附照片？',
  });
  await s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/grant`, { requestId: uid(), questionId: q.json.questionId, generation: 0, channel: 'chat' });
  const photo = await registerArtifact(k.base, s.customerId, 'equipment_photo', { deviceId: 'lathe-01' });
  const director = client(k.base, T.director);
  const ansRes = await director('POST', `/api/v1/inspections/${s.sessionId}/questions/${q.json.questionId}/answer`, {
    requestId: uid(), answer: { text: '确认在用。', evidenceRefs: [photo] },
  });
  if (ansRes.status !== 200) throw new Error(`设备回答失败: ${JSON.stringify(ansRes.json)}`);
  const asset = client(k.base, T.asset);
  const v = await asset('POST', `/api/v1/inspections/${s.sessionId}/items/${eq.itemId}/verify`, { requestId: uid(), verdict });
  return { eq, v };
}

test('A08·未决冲突下结束视频：会议可结束；收口 pending_review；不能宣称全部通过', async (t) => {
  const k = await startKernel();
  t.after(() => k.stop());
  const s = await startedSession(k);
  const { v } = await verifyEquipment(k, s, 'confirmed');
  assertOk(t, v, '设备项 verified');
  // 财务项制造冲突：回答自报 conflict
  const snap = await s.snapshot();
  const fin = snap.items.find((i) => i.itemKey === 'financial_answers');
  const q = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: uid(), itemId: fin.itemId, audience: 'internal', targetRole: 'finance', purpose: 'cashflow_conflict', question: '流水口径与报表不一致？',
  });
  await s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/grant`, { requestId: uid(), questionId: q.json.questionId, generation: 0, channel: 'chat' });
  const finance = client(k.base, T.finance);
  assertOk(t, await finance('POST', `/api/v1/inspections/${s.sessionId}/questions/${q.json.questionId}/answer`, {
    requestId: uid(), answer: { text: '两个口径对不上，需要重新拉流水。', conflict: true },
  }), '冲突回答');
  let now = await s.snapshot();
  assert.equal(now.items.find((i) => i.itemKey === 'financial_answers').status, 'conflict');
  // 冲突未决 → 结束会议允许
  const end = await s.own('POST', `/api/v1/inspections/${s.sessionId}/end`, { requestId: uid(), expectedVersion: now.version });
  assertOk(t, end, '冲突下可结束会议');
  assert.equal(end.json.closureStatus, 'pending_review', '收口=待复核');
  now = await s.snapshot();
  assert.equal(now.closureStatus, 'pending_review');
  assert.notEqual(now.closureStatus, 'ready_for_assessment');
  // 小结不得宣称全部核实：conflict 项在 unresolvedConflicts；ready 事件不存在
  const ownToken = client(k.base, T.owner);
  const summary = (await ownToken('GET', `/api/v1/inspections/${s.sessionId}/summary?audience=internal`)).json.summaries;
  assert.equal(summary.length, 1, 'revision 1 小结已固化');
  const content = summary[0].content;
  assert.equal(content.unresolvedConflicts.some((c) => c.itemKey === 'financial_answers'), true, '冲突列入未解决');
  const verifiedTitles = content.verified.map((x) => x.itemKey);
  assert.deepEqual(verifiedTitles, ['equipment_verify'], '只列真实 verified 项');
  // 事件面：无 READY_FOR_ASSESSMENT（收口未过评估门）
  const evs = await eventsOf(k);
  const types = evs.map((e) => e.eventType);
  assert.ok(types.includes('INSPECTION_ENDED'));
  assert.ok(!types.includes('INSPECTION_READY_FOR_ASSESSMENT'), '未决冲突不得发 ready_for_assessment');
  assert.ok(types.includes('FOLLOWUP_REQUIRED'), '未决项转待办有事件');
});

test('A10·会后补证：新修订只重开受影响项；旧小结与旧结论保留', async (t) => {
  const k = await startKernel();
  t.after(() => k.stop());
  const s = await startedSession(k);
  await verifyEquipment(k, s, 'confirmed');
  // 财务项：回答但缺流水 → waiting_evidence；此时结束 → pending_evidence（revision 1）
  let snap = await s.snapshot();
  const fin = snap.items.find((i) => i.itemKey === 'financial_answers');
  const q = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: uid(), itemId: fin.itemId, audience: 'internal', targetRole: 'finance', purpose: 'cashflow_late', question: '请补流水。',
  });
  await s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/grant`, { requestId: uid(), questionId: q.json.questionId, generation: 0, channel: 'chat' });
  const finance = client(k.base, T.finance);
  assertOk(t, await finance('POST', `/api/v1/inspections/${s.sessionId}/questions/${q.json.questionId}/answer`, {
    requestId: uid(), answer: { text: '口径确认，流水会后补。' },
  }), '财务口述');
  snap = await s.snapshot();
  const end = await s.own('POST', `/api/v1/inspections/${s.sessionId}/end`, { requestId: uid(), expectedVersion: snap.version });
  assertOk(t, end, 'end');
  assert.equal(end.json.closureStatus, 'pending_evidence');
  const ownToken = client(k.base, T.owner);
  const oldSummaries = (await ownToken('GET', `/api/v1/inspections/${s.sessionId}/summary?audience=internal`)).json.summaries;
  assert.equal(oldSummaries.length, 1);
  const oldContent = oldSummaries[0].content;
  assert.ok(oldContent.stillUnknown.some((x) => x.itemKey === 'financial_answers'), '旧小结如实记录未知');
  // 会后补交流水（只命中 financial_answers；设备项已 verified 不动）
  const bankId = await registerArtifact(k.base, s.customerId, 'bank_statement', { month: '2026-08' });
  const late = await s.own('POST', `/api/v1/inspections/${s.sessionId}/evidence`, { requestId: uid(), artifactId: bankId });
  assertOk(t, late, '晚到材料');
  assert.equal(late.json.closureRevision, 2, '新修订');
  assert.equal(late.json.reopened.length, 1, '只重开受影响项');
  snap = await s.snapshot();
  assert.equal(snap.items.find((i) => i.itemKey === 'financial_answers').status, 'to_verify', '材料齐 → 待人工核验');
  assert.equal(snap.items.find((i) => i.itemKey === 'equipment_verify').status, 'verified', '已完成项不动');
  // 材料齐 → 人工核验（信审负责该项）→ 必要项全 verified → 收口 ready_for_assessment（revision 2）
  const credit = client(k.base, T.credit);
  const finItem = snap.items.find((i) => i.itemKey === 'financial_answers');
  const vr = await credit('POST', `/api/v1/inspections/${s.sessionId}/items/${finItem.itemId}/verify`, { requestId: uid(), verdict: 'confirmed' });
  assertOk(t, vr, '复核流水');
  assert.equal(vr.json.closureStatus, 'ready_for_assessment', '新修订达到评估门');
  assert.equal(vr.json.sessionVersion, snap.version + 1);
  // 旧小结（revision 1）不改写；新小结（revision 2）已生成
  const sums = (await ownToken('GET', `/api/v1/inspections/${s.sessionId}/summary?audience=internal`)).json.summaries;
  assert.equal(sums.length, 2, 'revision 1 与 2 并存');
  assert.equal(sums[0].content.stillUnknown.some((x) => x.itemKey === 'financial_answers'), true, '旧小结历史保留，不被改写');
  assert.equal(sums[1].closureRevision, 2);
  // 事件面：新修订的 READY_FOR_ASSESSMENT 携带 revision 2；事件不含"自动批准"
  const evs = await eventsOf(k);
  const ready = evs.filter((e) => e.eventType === 'INSPECTION_READY_FOR_ASSESSMENT');
  assert.equal(ready.length, 1);
  assert.equal(ready[0].payload.closureRevision, 2);
  assert.match(String(ready[0].payload.note), /不构成.*批准/);
  // 收口 closed
  snap = await s.snapshot();
  const close = await s.own('POST', `/api/v1/inspections/${s.sessionId}/close`, { requestId: uid(), expectedVersion: snap.version });
  assertOk(t, close, 'close');
  // closed 后业务写被拒
  const q2r = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: uid(), audience: 'internal', targetRole: 'finance', purpose: 'after_close', question: '收口后问题。',
  });
  assertCode(t, q2r, 'INSPECTION_CLOSED', 'closed 后业务写');
  // 客户版小结不含内部风险依据条目（restrictions 文案不同、无 unresolved 内部冲突细节）
  const custSum = (await client(k.base, T.customer)('GET', `/api/v1/inspections/${s.sessionId}/summary?audience=customer`)).json.summaries;
  assert.ok(custSum.length >= 1);
  assert.equal(custSum.at(-1).content.audience, 'customer');
});

test('A3·outbox 事件契约：必发事件齐备、重复投递可按 eventId 幂等去重', async (t) => {
  const k = await startKernel();
  t.after(() => k.stop());
  const s = await startedSession(k);
  await verifyEquipment(k, s, 'confirmed');
  let snap = await s.snapshot();
  // 财务项到 to_verify（回答+材料）
  const fin = snap.items.find((i) => i.itemKey === 'financial_answers');
  const q = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: uid(), itemId: fin.itemId, audience: 'internal', targetRole: 'finance', purpose: 'cashflow_final', question: '最终口径？',
  });
  await s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/grant`, { requestId: uid(), questionId: q.json.questionId, generation: 0, channel: 'chat' });
  const bankId = await registerArtifact(k.base, s.customerId, 'bank_statement', { month: '2026-09' });
  const finance = client(k.base, T.finance);
  assertOk(t, await finance('POST', `/api/v1/inspections/${s.sessionId}/questions/${q.json.questionId}/answer`, {
    requestId: uid(), answer: { text: '确认。', evidenceRefs: [bankId] },
  }), '财务回答附材料');
  const credit = client(k.base, T.credit);
  snap = await s.snapshot();
  const finItem = snap.items.find((i) => i.itemKey === 'financial_answers');
  assertOk(t, await credit('POST', `/api/v1/inspections/${s.sessionId}/items/${finItem.itemId}/verify`, { requestId: uid(), verdict: 'confirmed' }), '核验');
  // 暂停/恢复（事件面）
  snap = await s.snapshot();
  assertOk(t, await s.own('POST', `/api/v1/inspections/${s.sessionId}/pause`, { requestId: uid(), expectedVersion: snap.version }), 'pause');
  snap = await s.snapshot();
  assertOk(t, await s.own('POST', `/api/v1/inspections/${s.sessionId}/resume`, { requestId: uid(), expectedVersion: snap.version }), 'resume');
  // 计划修订（会间增补；增补项为可选，不影响必要项覆盖）
  assertOk(t, await s.own('POST', `/api/v1/inspections/${s.sessionId}/plan`, {
    requestId: uid(), items: [{ itemKey: 'env_permit', title: '环保许可核对', required: false, responsibleRole: 'policy', targetRole: 'director', expectedEvidenceKinds: [] }],
  }), '会间计划增补');
  snap = await s.snapshot();
  assertOk(t, await s.own('POST', `/api/v1/inspections/${s.sessionId}/end`, { requestId: uid(), expectedVersion: snap.version }), 'end');
  const evs = await eventsOf(k);
  const types = new Set(evs.map((e) => e.eventType));
  for (const required of ['INSPECTION_PLAN_REVISED', 'INSPECTION_PAUSED', 'INSPECTION_RESUMED', 'INSPECTION_ENDED', 'INSPECTION_READY_FOR_ASSESSMENT']) {
    assert.ok(types.has(required), `缺少必发事件 ${required}`);
  }
  // eventId 唯一（重复消费方可去重）
  const ids = evs.map((e) => e.eventId);
  assert.equal(new Set(ids).size, ids.length, 'eventId 全局唯一');
  // 事件重复投递语义：同 payload 幂等由消费方按 eventId 去重（pull 通道按 seq 排序）
  const seqs = evs.map((e) => Number(e.seq));
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'seq 单调');
});

async function eventsOf(k) {
  const r = await client(k.base, T.admin)('GET', '/api/v1/events?after=0&limit=500');
  return r.json.events;
}
