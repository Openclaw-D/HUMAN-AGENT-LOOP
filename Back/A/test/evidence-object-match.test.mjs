// goal-01 · A1 验收：证据匹配落实设备对象锚定（不变量 4；验收清单"错设备材料"）。
// 语义：核验项锚定 objectRef 时——
//   ① 显式锚定到其他对象的材料作为答案引用 → 409 EVIDENCE_OBJECT_MISMATCH，零状态变更；
//   ② 锚定项的"自动核实"（requires_human_verification=false）只认对象匹配材料；
//   ③ 晚到材料只重开对象匹配的锚定项；收口不被错设备材料推进；
//   ④ 未锚定项与人工核验路径行为不变（回归护栏）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startKernel, scaffold, client, registerArtifact, assertOk, assertCode, uid, T } from './inspection-utils.mjs';

/** 起会话 + 对指定核验项建一个 customer 问答。 */
async function startWithQuestion(s, itemKey) {
  let snap = await s.snapshot();
  assertOk(t, await s.own('POST', `/api/v1/inspections/${s.sessionId}/start`,
    { requestId: uid(), expectedVersion: snap.version, acceptedPlanVersion: 1 }), 'start');
  snap = await s.snapshot();
  const item = snap.items.find((i) => i.itemKey === itemKey);
  assert.ok(item, `核验项 ${itemKey} 存在`);
  const q = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: uid(), itemId: item.itemId, audience: 'customer', targetRole: 'director',
    purpose: 'equipment_confirm', question: `请确认 ${item.objectRef ?? item.itemKey} 并附照片。`,
  });
  assertOk(t, q, '建问');
  return { item, qid: q.json.questionId };
}
// node --test 下各用例独立回调；断言助手只需要一个非空占位（真实失败经 throw 上报）
const t = { pass() {}, fail() {} };

test('G2-1·错设备材料作为答案引用 → 409 EVIDENCE_OBJECT_MISMATCH，核验项状态不变', async () => {
  const k = await startKernel();
  try {
    const s = await scaffold({ base: k.base, items: autoItems('lathe-01') });
    const { item, qid } = await startWithQuestion(s, 'device_auto');
    const wrongDevice = await registerArtifact(k.base, s.customerId, 'equipment_photo',
      { deviceId: 'lathe-02' }, { objectId: 'lathe-02', sceneVersion: 'scene-1' });
    const director = client(k.base, T.director);
    const r = await director('POST', `/api/v1/inspections/${s.sessionId}/questions/${qid}/answer`, {
      requestId: uid(), answer: { text: '这是车床-02 的照片。', evidenceRefs: [wrongDevice] },
    });
    assertCode(t, r, 'EVIDENCE_OBJECT_MISMATCH', '错设备引用被拒');
    assert.equal(r.json.itemObject, 'lathe-01');
    const snap = await s.snapshot();
    assert.equal(snap.items.find((i) => i.itemId === item.itemId).status, 'waiting_answer', '拒绝后核验项不动');
  } finally { await k.stop(); }
});

test('G2-2·自动核验项：未锚定材料不满足对象锚定（保持 waiting_evidence）；对象匹配材料经晚到登记 → verified', async () => {
  const k = await startKernel();
  try {
    const s = await scaffold({ base: k.base, items: autoItems('lathe-01') });
    const { item, qid } = await startWithQuestion(s, 'device_auto');
    const unanchored = await registerArtifact(k.base, s.customerId, 'equipment_photo', { deviceId: 'unknown' });
    const director = client(k.base, T.director);
    assertOk(t, await director('POST', `/api/v1/inspections/${s.sessionId}/questions/${qid}/answer`, {
      requestId: uid(), answer: { text: '在用。', evidenceRefs: [unanchored] },
    }), '回答（未锚定材料允许引用）');
    let snap = await s.snapshot();
    assert.equal(snap.items.find((i) => i.itemId === item.itemId).status, 'waiting_evidence', '锚定项缺对象匹配材料：不自动核实');
    const anchored = await registerArtifact(k.base, s.customerId, 'equipment_photo',
      { deviceId: 'lathe-01' }, { objectId: 'lathe-01', sceneVersion: 'scene-1' });
    const late = await s.own('POST', `/api/v1/inspections/${s.sessionId}/evidence`, { requestId: uid(), artifactId: anchored });
    assertOk(t, late, '晚到材料');
    assert.deepEqual(late.json.reopened, [item.itemId], '对象匹配材料重开锚定项');
    snap = await s.snapshot();
    assert.equal(snap.items.find((i) => i.itemId === item.itemId).status, 'verified', '对象匹配 → 自动核实');
    assert.equal(snap.coverage.verified, 1);
  } finally { await k.stop(); }
});

test('G2-3·晚到错设备材料不重开锚定项；收口保持 pending_evidence 不当作通过', async () => {
  const k = await startKernel();
  try {
    const s = await scaffold({ base: k.base, items: autoItems('lathe-01') });
    const { item, qid } = await startWithQuestion(s, 'device_auto');
    const director = client(k.base, T.director);
    assertOk(t, await director('POST', `/api/v1/inspections/${s.sessionId}/questions/${qid}/answer`, {
      requestId: uid(), answer: { text: '口述在用（暂无照片）。' },
    }), '纯口述回答');
    let snap = await s.snapshot();
    assert.equal(snap.items.find((i) => i.itemId === item.itemId).status, 'waiting_evidence');
    assertOk(t, await s.own('POST', `/api/v1/inspections/${s.sessionId}/end`, { requestId: uid(), expectedVersion: snap.version }), 'end');
    snap = await s.snapshot();
    assert.equal(snap.items.find((i) => i.itemId === item.itemId).status, 'deferred', 'end 时等待材料项转会后待办');
    assert.equal(snap.closureStatus, 'pending_evidence', '必要项未核实 → 收口不就绪');
    const wrong = await registerArtifact(k.base, s.customerId, 'equipment_photo',
      { deviceId: 'lathe-02' }, { objectId: 'lathe-02', sceneVersion: 'scene-1' });
    const late = await s.own('POST', `/api/v1/inspections/${s.sessionId}/evidence`, { requestId: uid(), artifactId: wrong });
    assertOk(t, late, '晚到材料命令本身成功');
    assert.deepEqual(late.json.reopened, [], '错设备材料不重开锚定项');
    snap = await s.snapshot();
    assert.equal(snap.items.find((i) => i.itemId === item.itemId).status, 'deferred', '项保持转办状态');
    assert.equal(snap.closureStatus, 'pending_evidence', '收口不被错设备材料推进');
  } finally { await k.stop(); }
});

test('G2-4·未锚定项与人工核验路径行为不变（回归护栏）', async () => {
  const k = await startKernel();
  try {
    const s = await scaffold({ base: k.base }); // standardItems：financial_answers 未锚定 + 人工核验
    let snap = await s.snapshot();
    assertOk(t, await s.own('POST', `/api/v1/inspections/${s.sessionId}/start`,
      { requestId: uid(), expectedVersion: snap.version, acceptedPlanVersion: 1 }), 'start');
    snap = await s.snapshot();
    const fin = snap.items.find((i) => i.itemKey === 'financial_answers');
    const q = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
      requestId: uid(), itemId: fin.itemId, audience: 'internal', targetRole: 'finance',
      purpose: 'cashflow_check', question: '请确认现金流口径。',
    });
    assertOk(t, q, '建问');
    const stmt = await registerArtifact(k.base, s.customerId, 'bank_statement', { bank: 'x' });
    const finance = client(k.base, T.finance);
    assertOk(t, await finance('POST', `/api/v1/inspections/${s.sessionId}/questions/${q.json.questionId}/answer`, {
      requestId: uid(), answer: { text: '流水正常。', evidenceRefs: [stmt] },
    }), '回答附材料');
    snap = await s.snapshot();
    assert.equal(snap.items.find((i) => i.itemId === fin.itemId).status, 'to_verify', '未锚定项：口述+材料齐 → 待人工核验（行为不变）');
    const credit = client(k.base, T.credit);
    const v = await credit('POST', `/api/v1/inspections/${s.sessionId}/items/${fin.itemId}/verify`,
      { requestId: uid(), verdict: 'confirmed', note: 'ok' });
    assertOk(t, v, '人工核验');
    assert.equal(v.json.itemStatus, 'verified');
  } finally { await k.stop(); }
});

test('G2-5·拒绝响应零写入：被拒答案不推进问题/核验项/会话版本', async () => {
  const k = await startKernel();
  try {
    const s = await scaffold({ base: k.base, items: autoItems('lathe-01') });
    const { qid } = await startWithQuestion(s, 'device_auto');
    const wrong = await registerArtifact(k.base, s.customerId, 'equipment_photo',
      { deviceId: 'lathe-02' }, { objectId: 'lathe-02', sceneVersion: 'scene-1' });
    const director = client(k.base, T.director);
    const before = await s.snapshot();
    const r = await director('POST', `/api/v1/inspections/${s.sessionId}/questions/${qid}/answer`, {
      requestId: uid(), answer: { text: 'x', evidenceRefs: [wrong] },
    });
    assertCode(t, r, 'EVIDENCE_OBJECT_MISMATCH', '错设备引用被拒');
    const after = await s.snapshot();
    assert.equal(after.version, before.version, '会话版本不变（零写入）');
    assert.deepEqual(after.items, before.items, '核验项状态不变');
    assert.deepEqual(after.openQuestions, before.openQuestions, '问题保持 open');
  } finally { await k.stop(); }
});

function autoItems(objectRef) {
  return [
    {
      itemKey: 'device_auto', title: '设备自动核验（锚定车床-01）', required: true,
      responsibleRole: 'asset', targetRole: 'director', requiresHumanVerification: false,
      expectedEvidenceKinds: ['equipment_photo'], objectRef,
      detail: { whyNeeded: '自动核验路径必须对象匹配', stopCondition: '对象匹配材料齐备' },
    },
  ];
}
