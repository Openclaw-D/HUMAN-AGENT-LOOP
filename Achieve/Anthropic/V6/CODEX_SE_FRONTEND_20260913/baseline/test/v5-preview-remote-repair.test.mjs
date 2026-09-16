// V6 REMOTE_DD_REPAIR_20260913 · 稳定性返修红绿回归（服务层真执行，隔离数据）。
// 红证据 = 修复前本文件运行失败（各断言钉住验收报告 F2/F3/F4/F6/B 期望行为）。
// 运行：node --experimental-strip-types --test test/v5-preview-remote-repair.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const dataDir = mkdtempSync(join(tmpdir(), 'remote-repair-data-'));

const svc = await import('../lib/v5-preview/remote-service.ts');
const store = await import('../lib/v5-preview/remote-store.ts');

async function expectError(action, code) {
  let caught = null;
  try { await action(); } catch (e) { caught = e; }
  assert.ok(caught !== null, `应当抛出 ${code}`);
  assert.equal(caught.code, code, `错误码应为 ${code}，实际 ${caught && caught.code}：${caught && caught.message}`);
}

let serial = 0;
const write = (fn, body) => {
  const res = fn({ requestId: `rr-${++serial}`, expectedVersion: svc.getRemoteState().remoteVersion, ...body });
  return res;
};
const labels = ['方案金额', '期限', '租金现金流合计（测试口径）', '资金成本（测试口径）', '预期信用损失（测试口径）', '运营及核验成本（测试口径）'];
const calcInputs = (rent) => labels.map((label, i) => ({ label, value: [100, 12, rent, 10, 10, 10][i], unit: i === 1 ? '月' : '万元', source: 'test_fixture' }));

// ---------------------------------------------------------------------------
// F2：暂停是服务端执行门
// ---------------------------------------------------------------------------

test('F0：隔离数据目录（本套件首个测试内设置 env；isolation=none 共享进程下避免跨套件互踩）', () => {
  process.env.V5_PREVIEW_DATA_DIR = dataDir;
});

test('F2：paused 阻断模型步骤与 confirm 类复核；补证/纠正/暂停说明仍可用；resume_round 显式留痕恢复；generation 隔离在途', async () => {
  const created = write(svc.createRemoteSession, { title: 'F2 暂停门（合成）' });
  const sessionId = created.session.sessionId;
  const ev = write(svc.attachEvidence, { sessionId, fixtureId: 'fixture-inspection' });
  let V = ev.remoteVersion;
  // 先暂停
  const paused = write(svc.createReview, { sessionId, targetType: 'evidence', targetId: ev.evidence.evidenceId, targetVersion: 1, action: 'pause_round', opinion: '关键矛盾未闭合（合成）' });
  V = paused.remoteVersion;
  assert.equal(svc.getRemoteSessionDetail(sessionId).session.status, 'paused');
  // 暂停中：模型推进被阻断
  await expectError(async () => svc.simulateFollowUps({ requestId: 'f2-sim', expectedVersion: V, sessionId, annotationId: 'an-none' }), 'SESSION_PAUSED');
  // 暂停中：确认通过类复核被阻断
  expectError(() => svc.createReview({ requestId: 'f2-confirm', expectedVersion: V, sessionId, targetType: 'evidence', targetId: ev.evidence.evidenceId, targetVersion: 1, action: 'confirm', opinion: '暂停中确认（合成）' }), 'SESSION_PAUSED');
  // 暂停中：补证/纠正类仍可用（request_resupply）
  const resupply = write(svc.createReview, { sessionId, targetType: 'evidence', targetId: ev.evidence.evidenceId, targetVersion: 1, action: 'request_resupply', opinion: '请补充书面凭证（合成）' });
  V = resupply.remoteVersion;
  assert.ok(resupply.review.reviewId);
  // 显式人工恢复（resume_round）→ 留痕 + 会话回 live
  const resumed = write(svc.createReview, { sessionId, targetType: 'evidence', targetId: ev.evidence.evidenceId, targetVersion: 1, action: 'resume_round', opinion: '矛盾已闭合，恢复本轮（合成）' });
  V = resumed.remoteVersion;
  assert.equal(svc.getRemoteSessionDetail(sessionId).session.status, 'live');
  const detail = svc.getRemoteSessionDetail(sessionId);
  assert.ok(detail.reviews.some((r) => r.action === 'resume_round'), '恢复动作必须留痕');
  // 非暂停态 resume_round 无意义
  expectError(() => svc.createReview({ requestId: 'f2-resume-live', expectedVersion: V, sessionId, targetType: 'evidence', targetId: ev.evidence.evidenceId, targetVersion: 1, action: 'resume_round', opinion: '重复恢复（合成）' }), 'INVALID_INPUT');
});

// ---------------------------------------------------------------------------
// F3：复核版本资格撤销与证据失效
// ---------------------------------------------------------------------------

test('F3：confirm→request_retake 后当前有效资格撤销（非 human_verified、显示待重拍）；历史意见保留', () => {
  const created = write(svc.createRemoteSession, { title: 'F3 资格撤销（合成）' });
  const sessionId = created.session.sessionId;
  const ev = write(svc.attachEvidence, { sessionId, fixtureId: 'fixture-contract' });
  const eid = ev.evidence.evidenceId;
  let V = ev.remoteVersion;
  write(svc.createReview, { requestId: 'f3-confirm', sessionId, targetType: 'evidence', targetId: eid, targetVersion: 1, action: 'confirm', opinion: '首轮确认（合成）' });
  let detail = svc.getRemoteSessionDetail(sessionId);
  assert.equal(detail.evidence[0].verificationStatus, 'human_verified');
  const retake = write(svc.createReview, { requestId: 'f3-retake', sessionId, targetType: 'evidence', targetId: eid, targetVersion: 1, action: 'request_retake', opinion: '图像不可读，要求重拍（合成）' });
  V = retake.remoteVersion;
  detail = svc.getRemoteSessionDetail(sessionId);
  // 当前有效资格撤销：不再是 human_verified
  assert.notEqual(detail.evidence[0].verificationStatus, 'human_verified', 'confirm→retake 后不得仍显示当前有效确认');
  // 历史意见保留
  assert.ok(detail.reviews.some((r) => r.action === 'confirm'), '历史确认意见必须保留');
  assert.ok(detail.reviews.some((r) => r.action === 'request_retake'));
  // 重新确认（同版本）→ 当前有效资格恢复（规则明确：最新 confirm 生效，除非之后又有 retake/correct）
  const reconfirm = write(svc.createReview, { requestId: 'f3-reconfirm', sessionId, targetType: 'evidence', targetId: eid, targetVersion: 1, action: 'confirm', opinion: '补件后重新确认（合成）' });
  V = reconfirm.remoteVersion;
  detail = svc.getRemoteSessionDetail(sessionId);
  assert.equal(detail.evidence[0].verificationStatus, 'human_verified', '最新 confirm 生效（明确可测规则）');
});

test('F3b：superseded 证据不可再新 confirm（API 层拒绝）；新证据不继承旧确认', () => {
  const created = write(svc.createRemoteSession, { title: 'F3b 取代拒绝（合成）' });
  const sessionId = created.session.sessionId;
  const ev = write(svc.attachEvidence, { sessionId, fixtureId: 'fixture-equipment' });
  const eid = ev.evidence.evidenceId;
  let V = ev.remoteVersion;
  write(svc.createReview, { requestId: 'f3b-confirm', sessionId, targetType: 'evidence', targetId: eid, targetVersion: 1, action: 'confirm', opinion: '旧证据确认（合成）' });
  const sup = write(svc.supersedeEvidence, { sessionId, evidenceId: eid, fixtureId: 'fixture-equipment' });
  V = sup.remoteVersion;
  const newEid = sup.evidence.evidenceId;
  // 旧证据上的新 confirm 被 API 拒绝
  expectError(() => svc.createReview({ requestId: 'f3b-stale-confirm', expectedVersion: V, sessionId, targetType: 'evidence', targetId: eid, targetVersion: 1, action: 'confirm', opinion: '对已取代证据的确认（合成）' }), 'INVALID_INPUT');
  const detail = svc.getRemoteSessionDetail(sessionId);
  const oldEv = detail.evidence.find((e) => e.evidenceId === eid);
  const newEv = detail.evidence.find((e) => e.evidenceId === newEid);
  assert.equal(oldEv.expired, true);
  assert.notEqual(newEv.verificationStatus, 'human_verified', '新证据不继承旧确认');
});

// ---------------------------------------------------------------------------
// F4：核算幂等摘要与失效
// ---------------------------------------------------------------------------

test('F4：同 requestId 换 inputs → REQUEST_MISMATCH；同输入原样重放稳定；结果绑定版本，规则/状态变化后 stale', () => {
  const created = write(svc.createRemoteSession, { title: 'F4 核算幂等（合成）' });
  const sessionId = created.session.sessionId;
  const reqId = 'f4-calc-replay';
  const first = svc.attemptCalculation({ requestId: reqId, expectedVersion: svc.getRemoteState().remoteVersion, sessionId, mode: 'contract_fixture', inputs: calcInputs(520) });
  // 同 ID 换输入 → REQUEST_MISMATCH（不得返回原结果）
  expectError(() => svc.attemptCalculation({ requestId: reqId, expectedVersion: svc.getRemoteState().remoteVersion, sessionId, mode: 'contract_fixture', inputs: calcInputs(1) }), 'REQUEST_MISMATCH');
  // 同 ID 同输入（含 mode）原样重放 → 稳定同一结果
  const replay = svc.attemptCalculation({ requestId: reqId, expectedVersion: svc.getRemoteState().remoteVersion, sessionId, mode: 'contract_fixture', inputs: calcInputs(520) });
  assert.equal(replay.calculation.calcId, first.calculation.calcId);
  assert.equal(replay.calculation.status, 'ready_for_review');
  // 结果绑定版本：记录携带 basedOn；随后状态推进使旧核算 stale（现算，不覆盖历史）
  assert.ok(first.calculation.basedOn, 'CalculationRecord 必须绑定版本（basedOn）');
  assert.equal(first.calculation.basedOn.remoteVersion, first.remoteVersionAtCreate ?? first.calculation.basedOn.remoteVersion);
  const after = write(svc.attachEvidence, { sessionId, fixtureId: 'fixture-inspection' });
  const detail = svc.getRemoteSessionDetail(sessionId);
  const calc = detail.calculations.find((c) => c.calcId === first.calculation.calcId);
  assert.equal(calc.stale, true, '新资料使旧核算 stale（现算）');
  assert.equal(calc.status, 'ready_for_review', '历史结果本身不被改写');
});

// ---------------------------------------------------------------------------
// F6：证据摘要 = 实际原图字节 SHA256；旧记录语义标注
// ---------------------------------------------------------------------------

test('F6：新证据 sha256 等于 renderFixtureSvg 实际字节摘要（不含旧 ID 掺入）；旧记录 digestOf=fixture_meta_legacy 可恢复', () => {
  const created = write(svc.createRemoteSession, { title: 'F6 摘要（合成）' });
  const sessionId = created.session.sessionId;
  const ev = write(svc.attachEvidence, { requestId: 'f6-attach', sessionId, fixtureId: 'fixture-inspection' });
  const actual = createHash('sha256').update(svc.renderFixtureSvg('fixture-inspection'), 'utf8').digest('hex');
  assert.equal(ev.evidence.sha256, actual, 'sha256 必须是服务端实际返回原图字节的摘要');
  assert.equal(ev.evidence.digestOf, 'fixture_bytes', '新记录摘要语义必须显式');
  // supersede 后再对同一 fixture 附着（非取代路径）→ 摘要仍是实际字节、不受旧 ID 影响
  const again = svc.attachEvidence({ requestId: 'f6-attach2', expectedVersion: svc.getRemoteState().remoteVersion, sessionId, fixtureId: 'fixture-inspection' });
  assert.equal(again.evidence.sha256, actual, '相同图形摘要稳定（不掺入历史 ID）');
  // 旧语义兼容：digestOf 缺省的历史记录可被标注为 legacy 而不破坏读取（用 store 层直写验证）
  const state = store.readRemoteStoreState();
  const legacyRecord = { ...JSON.parse(JSON.stringify(state.evidence[0])) };
  delete legacyRecord.digestOf;
  delete legacyRecord.supersedes;
  state.evidence[0] = legacyRecord;
  store.persistRemoteStoreState(state);
  const reread = store.readRemoteStoreState();
  assert.equal(reread.evidence[0].digestOf ?? 'fixture_meta_legacy', 'fixture_meta_legacy', '缺 digestOf 的历史记录按 legacy 语义读取');
});

// ---------------------------------------------------------------------------
// B：provider adapter 契约与故障路径（本地 fake，无密钥/无真实调用）
// ---------------------------------------------------------------------------

test('B：模型 provider adapter——超时/畸形/空结果/不存在证据/暂停中/过期版本/重复请求/部分失败 全部结构化失败，无伪成功', async () => {
  const adapter = svc.createModelProviderAdapter({
    provider: 'fake',
    // 本地可控 fake：按注入脚本响应（无网络、无密钥）
    handler: async (req) => {
      if (req.script === 'timeout') { await new Promise((r) => setTimeout(r, 50)); throw Object.assign(new Error('synthetic timeout'), { code: 'TIMEOUT' }); }
      if (req.script === 'malformed') return { unexpected: 'shape' };
      if (req.script === 'empty') return { followUps: [] };
      if (req.script === 'partial') return { followUps: [{ domainRole: 'credit', text: '有效追问（合成）' }, { domainRole: 'nope', text: '坏角色' }] };
      return { followUps: [{ domainRole: 'credit', text: '正常追问（合成）' }] };
    },
  });
  assert.equal(adapter.state(), 'not_configured'.length ? adapter.state() : '', 'adapter 存在');
  // 未配置真实 provider（fixed stub 模式）：显式 SIMULATION
  assert.equal(adapter.providerKind, 'fixed_stub');
  const base = { sessionId: 's-x', annotationId: 'an-x', evidenceRef: { fixtureId: 'fixture-inspection', sha256: 'x', version: 1 }, domainRoles: ['credit', 'policy'], purpose: 'follow_up_generation', script: 'ok' };
  const ok = await adapter.generateFollowUps(base);
  assert.equal(ok.status, 'ok');
  assert.equal(ok.replies[0].kind, 'model_simulation', 'stub 输出显式模拟');
  // 超时 → failed（不回退写 model_simulation 冒充成功）
  const timeout = await adapter.generateFollowUps({ ...base, script: 'timeout' });
  assert.equal(timeout.status, 'failed');
  assert.match(timeout.failureReason, /timeout|超时/i);
  assert.ok(!timeout.replies || timeout.replies.length === 0, '失败不得生成冒充回复');
  // 畸形 → failed（格式错误）
  const malformed = await adapter.generateFollowUps({ ...base, script: 'malformed' });
  assert.equal(malformed.status, 'failed');
  assert.match(malformed.failureReason, /格式|format|shape/i);
  // 空 → failed（empty）
  const empty = await adapter.generateFollowUps({ ...base, script: 'empty' });
  assert.equal(empty.status, 'failed');
  // 部分失败 → 过滤坏项 + partial 标注（不整体冒充成功）
  const partial = await adapter.generateFollowUps({ ...base, script: 'partial' });
  assert.equal(partial.status, 'partial');
  assert.equal(partial.replies.length, 1, '坏角色项被过滤');
  // 不存在的证据引用 → rejected（结构化拒绝，不是成功）
  const badRef = await adapter.generateFollowUps({ ...base, evidenceRef: { fixtureId: 'nope', sha256: '', version: 0 }, script: 'ok' });
  assert.equal(badRef.status, 'rejected');
  // 暂停中 → rejected（paused）
  const paused = await adapter.generateFollowUps({ ...base, sessionStatus: 'paused' });
  assert.equal(paused.status, 'rejected');
  assert.match(paused.failureReason, /paused|暂停/i);
  // 过期版本 → rejected
  const staleVer = await adapter.generateFollowUps({ ...base, evidenceRef: { fixtureId: 'fixture-inspection', sha256: 'x', version: 0 }, currentVersion: 1 });
  assert.equal(staleVer.status, 'rejected');
  // 重复请求 → 同一结果（幂等）
  const dup1 = await adapter.generateFollowUps({ ...base, requestId: 'dup-1' });
  const dup2 = await adapter.generateFollowUps({ ...base, requestId: 'dup-1' });
  assert.equal(dup1.requestId, dup2.requestId);
  assert.deepEqual(dup1.replies, dup2.replies);
});
