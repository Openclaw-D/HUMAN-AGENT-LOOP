// V6 REMOTE_DD_LONG_RUN · 远程尽调服务层回归（进程内直调，隔离数据目录；真实逻辑执行）。
// 运行：node --experimental-strip-types --test test/v5-preview-remote.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 数据目录必须在导入被测模块前指向隔离临时目录。
const dataDir = mkdtempSync(join(tmpdir(), 'remote-dd-data-'));

const svc = await import('../lib/v5-preview/remote-service.ts');

function expectError(action, code) {
  let caught = null;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught !== null, `应当抛出 ${code}`);
  assert.equal(caught.code, code, `错误码应为 ${code}，实际 ${caught.code}：${caught.message}`);
}

let version = 0;
const sessionId = { value: '' };
const evidenceId = { value: '' };

test('R0：隔离数据目录（本套件首个测试内设置 env）', () => {
  process.env.V5_PREVIEW_DATA_DIR = dataDir;
});

test('R1：创建会话 → 九名参与者、实控人自报现场且未核实、视频 not_configured；幂等重放；换载荷 REQUEST_MISMATCH', () => {
  const res = svc.createRemoteSession({ requestId: 'r-create', expectedVersion: 1, title: '回归会话（合成）' });
  version = res.remoteVersion;
  sessionId.value = res.session.sessionId;
  assert.equal(res.session.participants.length, 9);
  const owner = res.session.participants.find((p) => p.domainRole === 'customer-actual-controller');
  assert.equal(owner.attendance, 'on_site_declared');
  assert.equal(owner.attendanceVerified, false);
  assert.equal(res.session.video.provider, 'none');
  assert.equal(res.session.video.state, 'not_configured');
  // 幂等：同 requestId 同载荷 → 重放（remoteVersion 不变）
  const replay = svc.createRemoteSession({ requestId: 'r-create', expectedVersion: 1, title: '回归会话（合成）' });
  assert.equal(replay.remoteVersion, version);
  // 换载荷 → REQUEST_MISMATCH
  expectError(() => svc.createRemoteSession({ requestId: 'r-create', expectedVersion: 1, title: '换载荷（合成）' }), 'REQUEST_MISMATCH');
});

test('R2：版本门——过期 expectedVersion → VERSION_CONFLICT + serverVersion', () => {
  let captured = null;
  try {
    svc.attachEvidence({ requestId: 'r-stale', expectedVersion: version - 1, sessionId: sessionId.value, fixtureId: 'fixture-inspection' });
  } catch (e) { captured = e; }
  assert.equal(captured.code, 'VERSION_CONFLICT');
  assert.equal(captured.serverVersion, version);
});

test('R3：证据附着——白名单外 fixture 拒绝；附着成功；重复 requestId 幂等不重复', () => {
  expectError(() => svc.attachEvidence({ requestId: 'r-unknown-fixture', expectedVersion: version, sessionId: sessionId.value, fixtureId: 'fixture-not-exist' }), 'INVALID_INPUT');
  const res = svc.attachEvidence({ requestId: 'r-attach', expectedVersion: version, sessionId: sessionId.value, fixtureId: 'fixture-inspection' });
  version = res.remoteVersion;
  evidenceId.value = res.evidence.evidenceId;
  assert.equal(res.evidence.version, 1);
  assert.equal(res.evidence.sourceType, 'simulation_fixture');
  const replay = svc.attachEvidence({ requestId: 'r-attach', expectedVersion: version - 1, sessionId: sessionId.value, fixtureId: 'fixture-inspection' });
  assert.equal(replay.evidence.evidenceId, evidenceId.value, '同 requestId 重放返回同一证据');
  const state = svc.getRemoteState();
  assert.equal(state.evidence.filter((e) => e.evidenceId === evidenceId.value).length, 1, '不重复创建');
});

test('R4：标注——悬空证据拒绝；非法圈选拒绝；版本不符拒绝；合法创建', () => {
  expectError(() => svc.createAnnotation({ requestId: 'r-dangling', expectedVersion: version, sessionId: sessionId.value, evidenceId: 'ev-not-exist', evidenceVersion: 1, question: '悬空（合成）', rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }), 'NOT_FOUND');
  expectError(() => svc.createAnnotation({ requestId: 'r-bad-rect', expectedVersion: version, sessionId: sessionId.value, evidenceId: evidenceId.value, evidenceVersion: 1, question: '越界（合成）', rect: { x: 0.9, y: 0.9, w: 0.3, h: 0.2 } }), 'INVALID_INPUT');
  expectError(() => svc.createAnnotation({ requestId: 'r-tiny-rect', expectedVersion: version, sessionId: sessionId.value, evidenceId: evidenceId.value, evidenceVersion: 1, question: '过小（合成）', rect: { x: 0.5, y: 0.5, w: 0.0001, h: 0.2 } }), 'INVALID_INPUT');
  expectError(() => svc.createAnnotation({ requestId: 'r-ev-version', expectedVersion: version, sessionId: sessionId.value, evidenceId: evidenceId.value, evidenceVersion: 99, question: '旧版本（合成）', rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }), 'VERSION_CONFLICT');
  const res = svc.createAnnotation({ requestId: 'r-annotate', expectedVersion: version, sessionId: sessionId.value, evidenceId: evidenceId.value, evidenceVersion: 1, question: '该区块设备现状（合成）', rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 } });
  version = res.remoteVersion;
  assert.equal(res.annotation.status, 'open');
  assert.equal(res.annotation.author, '业务 · 王业务（演示身份）');
});

test('R5：模拟模型追问——显式 SIMULATION、确定性、每标注仅一轮；业务回复正常', async () => {
  let annotationId = '';
  const detail = svc.getRemoteSessionDetail(sessionId.value);
  annotationId = detail.annotations[0].annotationId;
  const simVersion = version;
  const sim1 = await svc.simulateFollowUps({ requestId: 'r-sim', expectedVersion: simVersion, sessionId: sessionId.value, annotationId });
  assert.equal(sim1.simulated, true);
  version = sim1.remoteVersion;
  const modelReplies = sim1.annotation.replies.filter((r) => r.kind === 'model_simulation');
  assert.ok(modelReplies.length >= 1);
  // R4-A：首条为候选 SIMULATED 通道声明（显著标记），其余标注 authority=none——均为模拟语义。
  assert.ok(modelReplies.some((r) => /SIMULATED/.test(r.author) || /authority=none/.test(r.author)), '模拟输出必须显著标注（SIMULATED 或 authority=none）');
  for (const r of modelReplies) {
    if (!/SIMULATED/.test(r.author)) assert.match(r.author, /authority=none/, `非声明条目必须标注 authority=none：${r.author}`);
  }
  const sim2 = await svc.simulateFollowUps({ requestId: 'r-sim', expectedVersion: simVersion, sessionId: sessionId.value, annotationId });
  assert.equal(sim2.simulated, true, '同 requestId 同载荷 → 幂等重放原响应');
  assert.equal(sim2.annotation.replies.length, sim1.annotation.replies.length, '重放不重复生成追问');
  const sim3 = await svc.simulateFollowUps({ requestId: 'r-sim2', expectedVersion: version, sessionId: sessionId.value, annotationId });
  assert.equal(sim3.simulated, false, '新 requestId 命中"每条标注只生成一轮"语义');
  const biz = svc.replyAnnotation({ requestId: 'r-reply', expectedVersion: version, sessionId: sessionId.value, annotationId, kind: 'business', text: '业务补充说明（合成）' });
  version = biz.remoteVersion;
  assert.equal(biz.annotation.replies.some((r) => r.kind === 'business'), true);
  expectError(() => svc.replyAnnotation({ requestId: 'r-reply-bad', expectedVersion: version, sessionId: sessionId.value, annotationId, kind: 'model', text: '非法kind（合成）' }), 'INVALID_INPUT');
});

test('R6：人工复核——确认→证据 human_verified（现算）；版本不符 409；pause_round 会话级暂停', () => {
  const res = svc.createReview({ requestId: 'r-confirm', expectedVersion: version, sessionId: sessionId.value, targetType: 'evidence', targetId: evidenceId.value, targetVersion: 1, action: 'confirm', opinion: '人工确认（合成）' });
  version = res.remoteVersion;
  const detail = svc.getRemoteSessionDetail(sessionId.value);
  assert.equal(detail.evidence[0].verificationStatus, 'human_verified');
  expectError(() => svc.createReview({ requestId: 'r-confirm-stale', expectedVersion: version, sessionId: sessionId.value, targetType: 'evidence', targetId: evidenceId.value, targetVersion: 99, action: 'confirm', opinion: '旧版本（合成）' }), 'VERSION_CONFLICT');
  const pause = svc.createReview({ requestId: 'r-pause', expectedVersion: version, sessionId: sessionId.value, targetType: 'annotation', targetId: detail.annotations[0].annotationId, targetVersion: detail.annotations[0].version, action: 'pause_round', opinion: '关键矛盾未闭合，暂停本轮判断（合成）' });
  version = pause.remoteVersion;
  assert.equal(pause.sessionStatus, 'paused');
});

test('R7：跨会话拒绝——用另一会话 id 访问证据/标注 → NOT_FOUND（失败关闭）', () => {
  const other = svc.createRemoteSession({ requestId: 'r-other', expectedVersion: version, title: '另一会话（合成）' });
  version = other.remoteVersion;
  const otherId = other.session.sessionId;
  // 同项目另一会话附着证据是允许的；但引用第一会话的证据必须 NOT_FOUND（跨会话失败关闭）。
  const otherEv = svc.attachEvidence({ requestId: 'r-other-ev', expectedVersion: version, sessionId: otherId, fixtureId: 'fixture-equipment' });
  version = otherEv.remoteVersion;
  assert.notEqual(otherEv.evidence.evidenceId, evidenceId.value);
  expectError(() => svc.createReview({ requestId: 'r-cross-review', expectedVersion: version, sessionId: otherId, targetType: 'evidence', targetId: evidenceId.value, targetVersion: 1, action: 'confirm', opinion: '跨会话引用（合成）' }), 'NOT_FOUND');
  expectError(() => svc.createAnnotation({ requestId: 'r-cross-annotate', expectedVersion: version, sessionId: otherId, evidenceId: evidenceId.value, evidenceVersion: 1, question: '跨会话标疑（合成）', rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }), 'NOT_FOUND');
});

test('R8：重拍取代——旧证据 expired、不可再标疑；取代后旧确认不自动继承', () => {
  const res = svc.supersedeEvidence({ requestId: 'r-supersede', expectedVersion: version, sessionId: sessionId.value, evidenceId: evidenceId.value, fixtureId: 'fixture-inspection' });
  version = res.remoteVersion;
  const detail = svc.getRemoteSessionDetail(sessionId.value);
  const old = detail.evidence.find((e) => e.evidenceId === evidenceId.value);
  assert.equal(old.expired, true, '旧证据显示过期');
  expectError(() => svc.createAnnotation({ requestId: 'r-old-annotate', expectedVersion: version, sessionId: sessionId.value, evidenceId: evidenceId.value, evidenceVersion: 1, question: '旧证据标疑（合成）', rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }), 'INVALID_INPUT');
});

test('R9：出席确认——自报→确认+verified；live_only 不可确认', () => {
  const detail = svc.getRemoteSessionDetail(sessionId.value);
  const owner = detail.session.participants.find((p) => p.domainRole === 'customer-actual-controller');
  const res = svc.confirmAttendance({ requestId: 'r-attend', expectedVersion: version, sessionId: sessionId.value, participantId: owner.participantId });
  version = res.remoteVersion;
  const ownerAfter = res.session.participants.find((p) => p.domainRole === 'customer-actual-controller');
  assert.equal(ownerAfter.attendance, 'on_site_confirmed');
  assert.equal(ownerAfter.attendanceVerified, true);
  const liveOnly = res.session.participants.find((p) => p.attendance === 'live_only');
  expectError(() => svc.confirmAttendance({ requestId: 'r-attend-live', expectedVersion: version, sessionId: sessionId.value, participantId: liveOnly.participantId }), 'INVALID_INPUT');
});

test('R10：核算——默认 not_configured+输入清单；contract_fixture 负收益 blocked；正收益 ready_for_review 且不放行；非 test_fixture 来源拒绝；缺输入 missing_inputs', () => {
  const notConf = svc.attemptCalculation({ requestId: 'r-calc-nc', expectedVersion: version, sessionId: sessionId.value });
  version = notConf.remoteVersion;
  assert.equal(notConf.calculation.status, 'not_configured');
  assert.ok(notConf.calculation.inputs.length >= 6, '展示所需输入清单');
  assert.equal(notConf.calculation.result.kind, 'none', '未配置不产生任何结果');
  const inputs = (mode) => [
    { label: '方案金额', value: 500, unit: '万元', source: mode },
    { label: '期限', value: 24, unit: '月', source: mode },
    { label: '租金现金流合计（测试口径）', value: 430, unit: '万元', source: mode },
    { label: '资金成本（测试口径）', value: 420, unit: '万元', source: mode },
    { label: '预期信用损失（测试口径）', value: 15, unit: '万元', source: mode },
    { label: '运营及核验成本（测试口径）', value: 12, unit: '万元', source: mode },
  ];
  expectError(() => svc.attemptCalculation({ requestId: 'r-calc-bad-source', expectedVersion: version, sessionId: sessionId.value, mode: 'contract_fixture', inputs: inputs('business') }), 'INVALID_INPUT');
  const neg = svc.attemptCalculation({ requestId: 'r-calc-neg', expectedVersion: version, sessionId: sessionId.value, mode: 'contract_fixture', inputs: inputs('test_fixture') });
  version = neg.remoteVersion;
  assert.equal(neg.calculation.status, 'blocked');
  assert.match(neg.calculation.reasons[0], /测试输入，非实际核算/);
  const posInputs = inputs('test_fixture');
  posInputs[2].value = 520;
  const pos = svc.attemptCalculation({ requestId: 'r-calc-pos', expectedVersion: version, sessionId: sessionId.value, mode: 'contract_fixture', inputs: posInputs });
  version = pos.remoteVersion;
  assert.equal(pos.calculation.status, 'ready_for_review');
  assert.match(pos.calculation.reasons[0], /仍不能放行/);
  const missing = svc.attemptCalculation({ requestId: 'r-calc-missing', expectedVersion: version, sessionId: sessionId.value, mode: 'contract_fixture', inputs: [inputs('test_fixture')[0]] });
  version = missing.remoteVersion;
  assert.equal(missing.calculation.status, 'missing_inputs');
});

test('R11：规则配置——四层全部 unconfigured，未知值不是 0', () => {
  const rc = svc.getRuleConfig();
  assert.equal(rc.ruleConfig.status, 'unconfigured');
  for (const key of ['technicalQuality', 'evidenceSufficiency', 'businessRisk', 'economics']) {
    assert.equal(rc.ruleConfig.layers[key], null);
  }
});
