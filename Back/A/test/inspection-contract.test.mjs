// A1 边界 · 检查会话契约测试：状态映射、开始/暂停/结束幂等与版本门、计划变更门、权限面。
// 对应验收：A01（重复开始/恢复/结束）、A03（会前计划版本变化）、A06（口述≠材料≠核实）+ 权限转换。
// 运行：cd Back/A && JW_A_ADMIN_DB_URL='postgres://jwcc:jwcc-local-demo@127.0.0.1:15444/postgres' node --test test/inspection-contract.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { scaffold, startKernel, client, registerArtifact, assertOk, assertCode, uid, T } from './inspection-utils.mjs';

test('A1·脚手架：会话建立于 preparing/open，快照含覆盖与角色', async (t) => {
  const k = await startKernel();
  t.after(() => k.stop());
  const s = await scaffold({ base: k.base });
  const snap = await s.snapshot();
  assert.equal(snap.runStatus, 'preparing');
  assert.equal(snap.closureStatus, 'open');
  assert.equal(snap.planVersion, 1);
  assert.equal(snap.roles.length, 9);
  assert.equal(snap.coverage.required, 2);
  assert.equal(snap.items.length, 3);
  for (const it of snap.items) assert.equal(it.status, 'pending');
});

test('A01·重复开始（同 requestId）单次业务效果；错误版本拒绝；历史不重置', async (t) => {
  const k = await startKernel();
  t.after(() => k.stop());
  const s = await scaffold({ base: k.base });
  const snap0 = await s.snapshot();
  const rid = uid('start');
  const first = await s.own('POST', `/api/v1/inspections/${s.sessionId}/start`, { requestId: rid, expectedVersion: snap0.version, acceptedPlanVersion: 1 });
  assertOk(t, first, '首次 start');
  assert.equal(first.json.runStatus, 'in_progress');
  // 同 requestId 同载荷 → replayed:true，不产生新效果
  const replay = await s.own('POST', `/api/v1/inspections/${s.sessionId}/start`, { requestId: rid, expectedVersion: snap0.version, acceptedPlanVersion: 1 });
  assertOk(t, replay, '重放 start');
  assert.equal(replay.json.replayed, true);
  // 版本已推进：错误 expectedVersion → VERSION_CONFLICT（历史不重置）
  const snap1 = await s.snapshot();
  assert.equal(snap1.version, snap0.version + 1);
  assert.equal(snap1.runStatus, 'in_progress');
  const bad = await s.own('POST', `/api/v1/inspections/${s.sessionId}/start`, { requestId: uid('x'), expectedVersion: snap0.version, acceptedPlanVersion: 1 });
  assertCode(t, bad, 'VERSION_CONFLICT', '过期版本 start');
  assert.equal(bad.json.serverVersion, snap1.version);
});

test('A01·重复 pause/resume/end 同 requestId 均单次业务效果', async (t) => {
  const k = await startKernel();
  t.after(() => k.stop());
  const s = await scaffold({ base: k.base });
  let snap = await s.snapshot();
  assertOk(t, await s.own('POST', `/api/v1/inspections/${s.sessionId}/start`, { requestId: uid(), expectedVersion: snap.version, acceptedPlanVersion: 1 }), 'start');
  // pause ×2（同 requestId）
  snap = await s.snapshot();
  const pid = uid('pause');
  assertOk(t, await s.own('POST', `/api/v1/inspections/${s.sessionId}/pause`, { requestId: pid, expectedVersion: snap.version }), 'pause');
  const replayPause = await s.own('POST', `/api/v1/inspections/${s.sessionId}/pause`, { requestId: pid, expectedVersion: snap.version });
  assert.equal(replayPause.json.replayed, true);
  snap = await s.snapshot();
  assert.equal(snap.runStatus, 'suspended');
  const resumedAtVersion = snap.version;
  // resume
  const rid = uid('resume');
  assertOk(t, await s.own('POST', `/api/v1/inspections/${s.sessionId}/resume`, { requestId: rid, expectedVersion: snap.version }), 'resume');
  const replayResume = await s.own('POST', `/api/v1/inspections/${s.sessionId}/resume`, { requestId: rid, expectedVersion: snap.version });
  assert.equal(replayResume.json.replayed, true);
  snap = await s.snapshot();
  assert.equal(snap.runStatus, 'in_progress');
  // end
  const eid = uid('end');
  assertOk(t, await s.own('POST', `/api/v1/inspections/${s.sessionId}/end`, { requestId: eid, expectedVersion: snap.version }), 'end');
  const replayEnd = await s.own('POST', `/api/v1/inspections/${s.sessionId}/end`, { requestId: eid, expectedVersion: snap.version });
  assert.equal(replayEnd.json.replayed, true);
  snap = await s.snapshot();
  assert.equal(snap.runStatus, 'ended');
  assert.equal(snap.version, resumedAtVersion + 2, 'resume+end 各 +1，重放不再推进');
  // 已结束再 end（新 requestId）→ NOT_READY，不改变历史
  const again = await s.own('POST', `/api/v1/inspections/${s.sessionId}/end`, { requestId: uid(), expectedVersion: snap.version });
  assertCode(t, again, 'NOT_READY', '重复 end');
  assert.equal((await s.snapshot()).version, snap.version);
});

// （占位工具已移除：版本断言直接写明语义）

test('A03·会前计划版本前移：拒绝过时开始，显式接受新计划才能开始', async (t) => {
  const k = await startKernel();
  t.after(() => k.stop());
  const s = await scaffold({ base: k.base });
  // 会前修订计划（plan_version → 2）
  const rev = await s.own('POST', `/api/v1/inspections/${s.sessionId}/plan`, {
    requestId: uid(), planSnapshot: { inspectionPlanVersion: 8, source: 'pre_review_v2' },
    items: [
      { itemKey: 'equipment_verify', title: '设备实物核验（锚定车床-01）', responsibleRole: 'asset', targetRole: 'director', expectedEvidenceKinds: ['equipment_photo'], objectRef: 'lathe-01' },
      { itemKey: 'financial_answers', title: '财务口径问答', responsibleRole: 'credit', targetRole: 'finance', expectedEvidenceKinds: ['bank_statement'] },
      { itemKey: 'new_item_after_revision', title: '修订新增：环保许可核对', responsibleRole: 'policy', targetRole: 'director', expectedEvidenceKinds: [] },
    ],
  });
  assertOk(t, rev, '计划修订');
  assert.equal(rev.json.planVersion, 2);
  // 拒绝过时开始
  let snap = await s.snapshot();
  const stale = await s.own('POST', `/api/v1/inspections/${s.sessionId}/start`, { requestId: uid(), expectedVersion: snap.version, acceptedPlanVersion: 1 });
  assertCode(t, stale, 'PLAN_CHANGED', '过时计划开始');
  assert.equal(stale.json.currentPlanVersion, 2);
  // 显式采用新计划 → 开始（新计划项生效，不混用旧项）
  snap = await s.snapshot();
  assertOk(t, await s.own('POST', `/api/v1/inspections/${s.sessionId}/start`, { requestId: uid(), expectedVersion: snap.version, acceptedPlanVersion: 2 }), '显式接受新计划');
  snap = await s.snapshot();
  const keys = snap.items.map((i) => i.itemKey).sort();
  assert.deepEqual(keys, ['equipment_verify', 'financial_answers', 'new_item_after_revision']);
});

test('A06·口述已登记 ≠ 材料已取得：回答成功但核验项与评估门仍未完成', async (t) => {
  const k = await startKernel();
  t.after(() => k.stop());
  const s = await scaffold({ base: k.base });
  let snap = await s.snapshot();
  assertOk(t, await s.own('POST', `/api/v1/inspections/${s.sessionId}/start`, { requestId: uid(), expectedVersion: snap.version, acceptedPlanVersion: 1 }), 'start');
  snap = await s.snapshot();
  const fin = snap.items.find((i) => i.itemKey === 'financial_answers');
  // 财务问题建立并外发
  const q = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: uid(), itemId: fin.itemId, audience: 'internal', targetRole: 'finance', purpose: 'cashflow_clarify',
    question: '请说明本季度经营现金流口径，并附银行流水。',
  });
  assertOk(t, q, '建问题');
  const finToken = client(k.base, T.finance);
  // 财务口头回答（无材料）
  assertOk(t, await finToken('POST', `/api/v1/inspections/${s.sessionId}/questions/${q.json.questionId}/answer`, {
    requestId: uid(), answer: { text: '口径是银行流水净额，材料明天补交。' },
  }), '财务回答');
  snap = await s.snapshot();
  const finItem = snap.items.find((i) => i.itemId === fin.itemId);
  assert.equal(finItem.status, 'waiting_evidence', '口述已登记但材料未取得 → waiting_evidence');
  // 评估门：此时结束会议 → 收口 pending_evidence，不 ready_for_assessment
  const end = await s.own('POST', `/api/v1/inspections/${s.sessionId}/end`, { requestId: uid(), expectedVersion: snap.version });
  assertOk(t, end, 'end（允许存在未决）');
  assert.equal(end.json.closureStatus, 'pending_evidence');
  assert.equal(end.json.followups.length >= 1, true, '未决项形成会后待办');
  const snapAfter = await s.snapshot();
  assert.equal(snapAfter.closureStatus, 'pending_evidence');
  assert.notEqual(snapAfter.closureStatus, 'ready_for_assessment');
});

test('A1·权限面：需真人的问题 Agent 不能代答；名册外/无角色 principal 被拒；非 owner 不能暂停', async (t) => {
  const k = await startKernel();
  t.after(() => k.stop());
  const s = await scaffold({ base: k.base });
  let snap = await s.snapshot();
  assertOk(t, await s.own('POST', `/api/v1/inspections/${s.sessionId}/start`, { requestId: uid(), expectedVersion: snap.version, acceptedPlanVersion: 1 }), 'start');
  snap = await s.snapshot();
  const eq = snap.items.find((i) => i.itemKey === 'equipment_verify');
  const q = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: uid(), itemId: eq.itemId, audience: 'customer', targetRole: 'director', requiresHuman: true,
    purpose: 'equipment_confirm', objectRef: 'lathe-01',
    question: '请确认车床-01 当前在用并拍摄铭牌。',
  });
  assertOk(t, q, '建问题');
  // Agent 冒充厂长回答 → 403 ANSWER_REQUIRES_HUMAN
  const agent = client(k.base, T.agent);
  const r1 = await agent('POST', `/api/v1/inspections/${s.sessionId}/questions/${q.json.questionId}/answer`, {
    requestId: uid(), answer: { text: '我确认在用（Agent 代答）' },
  });
  assertCode(t, r1, 'ANSWER_REQUIRES_HUMAN', 'Agent 代答真人核验');
  // 名册外角色回答 → ROLE_FORBIDDEN
  const customer = client(k.base, T.customer);
  const r2 = await customer('POST', `/api/v1/inspections/${s.sessionId}/questions/${q.json.questionId}/answer`, {
    requestId: uid(), answer: { text: '我是客户不是厂长' },
  });
  assertCode(t, r2, 'ROLE_FORBIDDEN', '名册外角色回答');
  // 厂长（目标角色、人类）回答 → 成功
  const director = client(k.base, T.director);
  assertOk(t, await director('POST', `/api/v1/inspections/${s.sessionId}/questions/${q.json.questionId}/answer`, {
    requestId: uid(), answer: { text: '确认在用，铭牌已拍。' },
  }), '厂长回答');
  // 非 owner 暂停 → ROLE_FORBIDDEN（ownerRole=business；director 无权暂停会话）
  snap = await s.snapshot();
  const r3 = await director('POST', `/api/v1/inspections/${s.sessionId}/pause`, { requestId: uid(), expectedVersion: snap.version });
  assertCode(t, r3, 'ROLE_FORBIDDEN', '非 owner 暂停');
  // owner 暂停 → 成功
  assertOk(t, await s.own('POST', `/api/v1/inspections/${s.sessionId}/pause`, { requestId: uid(), expectedVersion: snap.version }), 'owner 暂停');
});

test('A1·完整核验闭环（契约级）：建问→授权外发→回答→材料齐→人工核验→verified', async (t) => {
  const k = await startKernel();
  t.after(() => k.stop());
  const s = await scaffold({ base: k.base });
  let snap = await s.snapshot();
  assertOk(t, await s.own('POST', `/api/v1/inspections/${s.sessionId}/start`, { requestId: uid(), expectedVersion: snap.version, acceptedPlanVersion: 1 }), 'start');
  snap = await s.snapshot();
  const eq = snap.items.find((i) => i.itemKey === 'equipment_verify');
  const q = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: uid(), itemId: eq.itemId, audience: 'customer', targetRole: 'director', purpose: 'equipment_confirm', objectRef: 'lathe-01',
    question: '请确认车床-01 在用并附照片。',
  });
  const qid = q.json.questionId;
  // 外发授权（generation=0）；同 requestId 重放 → 幂等，不产生第二个 send
  const grantReq = { requestId: uid('grant'), questionId: qid, generation: 0, channel: 'chat' };
  const grant = await s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/grant`, grantReq);
  assertOk(t, grant, '外发授权');
  const replayGrant = await s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/grant`, grantReq);
  assertOk(t, replayGrant, '重放外发授权');
  assert.equal(replayGrant.json.replayed, true);
  snap = await s.snapshot();
  assert.equal(snap.outbound.inFlight.length, 1, '在途外发恰一条');
  // 发送结果回执
  assertOk(t, await s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/${snap.outbound.inFlight[0].sendId}/result`, {
    requestId: uid(), outcome: 'sent',
  }), '发送结果');
  // 厂长回答 + 材料登记
  const director = client(k.base, T.director);
  const photoId = await registerArtifact(k.base, s.customerId, 'equipment_photo', { deviceId: 'lathe-01' });
  assertOk(t, await director('POST', `/api/v1/inspections/${s.sessionId}/questions/${qid}/answer`, {
    requestId: uid(), answer: { text: '确认在用。', evidenceRefs: [photoId] },
  }), '回答附材料');
  snap = await s.snapshot();
  assert.equal(snap.items.find((i) => i.itemId === eq.itemId).status, 'to_verify', '口述+材料齐 → 待人工核验');
  // 人工核验（资产专员，responsible=asset）
  const asset = client(k.base, T.asset);
  const v = await asset('POST', `/api/v1/inspections/${s.sessionId}/items/${eq.itemId}/verify`, {
    requestId: uid(), verdict: 'confirmed', note: '铭牌与现场一致',
  });
  assertOk(t, v, '人工核验');
  assert.equal(v.json.itemStatus, 'verified');
  snap = await s.snapshot();
  assert.equal(snap.coverage.verified, 1);
});

test('A1·问题去重：同对象/期间/目的/受众去重返回原问题；目的不同保留差异', async (t) => {
  const k = await startKernel();
  t.after(() => k.stop());
  const s = await scaffold({ base: k.base });
  let snap = await s.snapshot();
  assertOk(t, await s.own('POST', `/api/v1/inspections/${s.sessionId}/start`, { requestId: uid(), expectedVersion: snap.version, acceptedPlanVersion: 1 }), 'start');
  const base1 = { requestId: uid(), audience: 'customer', targetRole: 'director', purpose: 'equipment_confirm', objectRef: 'lathe-01', question: '车床-01 在用吗？' };
  const q1 = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, base1);
  assertOk(t, q1, '问题1');
  assert.equal(q1.json.duplicate, false);
  const q2 = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, { ...base1, requestId: uid(), question: '车床01在用吗（相似文本）' });
  assertOk(t, q2, '同键问题去重');
  assert.equal(q2.json.duplicate, true);
  assert.equal(q2.json.questionId, q1.json.questionId, '返回原问题，不新建');
  // 目的不同 → 保留为独立问题（相似文本不合并）
  const q3 = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, { ...base1, requestId: uid(), purpose: 'ownership_check', question: '车床-01 在用吗？' });
  assertOk(t, q3, '不同目的问题');
  assert.equal(q3.json.duplicate, false);
  assert.notEqual(q3.json.questionId, q1.json.questionId);
  // 对象不同 → 独立问题
  const q4 = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, { ...base1, requestId: uid(), objectRef: 'lathe-02' });
  assertOk(t, q4, '不同对象问题');
  assert.equal(q4.json.duplicate, false);
});
