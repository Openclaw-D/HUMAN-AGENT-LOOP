// V6 REPAIR evening · 共享状态闭环测试（A 路；REPAIR_20260914_EVENING/main/INTERFACE.md v1）。
// 覆盖（对应 goal 证据链 + COMMON R-05/R-06/R-07）：
//   ① 全链：首页（story）进入尽调 → 证据挂接/升版（演示步 + 尽调页同后端动作）→ 人工纠正 →
//      旧意见待复核 → 受影响域/待办/消息投影到首页 → 刷新/返回一致（游标稳定）；
//   ② 重开隔离：仅清除专属演示会话，其他会话与其记录保留；
//   ③ 并发重复请求：同 requestId 重放 / 异载荷 REQUEST_MISMATCH（rows 与 remote 两侧）；
//   ④ 故障中断恢复：remote 写成功后 rows 写丢失 → 同 requestId 原样重试自愈 + 投影重算重建；
//   ⑤ 降级：remote 存储损坏 → GET 诚实降级（sharedWarning），rows 数据不阻塞只读浏览。
// 运行（单独执行；本文件自设 V5_PREVIEW_DATA_DIR 隔离目录）：
//   node --experimental-strip-types --test --experimental-test-isolation=none test/v5-preview-shared-facts.test.mjs

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'jw-shared-facts-test-'));
process.env.V5_PREVIEW_DATA_DIR = dataDir;

const { DEMO_STORY_STEPS } = await import('../lib/v5-preview/demo-story-data.ts');
const { createSeedOverview, submitNote } = await import('../lib/v5-preview/service.ts');
const { getStoryState, runStoryCommand } = await import('../lib/v5-preview/demo-story-service.ts');
const {
  syncSharedProjection,
  getSharedFactsView,
  computeSharedFacts,
  resetDemoRun,
} = await import('../lib/v5-preview/shared-facts.ts');
const remoteStore = await import('../lib/v5-preview/remote-store.ts');
const remoteService = await import('../lib/v5-preview/remote-service.ts');
const { DEMO_SESSION_ID } = remoteService;
const storeMod = await import('../lib/v5-preview/store.ts');

after(() => {
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* 临时目录清理失败不影响判定 */ }
});

const byId = new Map(DEMO_STORY_STEPS.map((s) => [s.stepId, s]));
const DD_DECISION = 's09-dd-07';

function remoteVersion() {
  return remoteStore.readRemoteStoreState().version;
}

function evidenceOf(sessionId) {
  return remoteStore.readRemoteStoreState().evidence.filter((e) => e.sessionId === sessionId);
}

function rowsOverview() {
  return storeMod.readV5StoreState({ seed: () => createSeedOverview('approval') }).overview;
}

/** 回到 approval 种子（cursor=s00、todo 待补充；共享游标语义与 seedScenario 一致）。 */
function resetStoreToApprovalSeed() {
  const seed = createSeedOverview('approval');
  storeMod.writeV5StoreState({
    overview: seed,
    idempotency: new storeMod.V5IdempotencyTable(),
    storyCursor: { stepId: DEMO_STORY_STEPS[0].stepId, updatedAt: new Date().toISOString() },
    sharedDemo: { sessionId: null },
  });
}

let walkSeq = 0;
function advance(fromStepId, expectedVersion) {
  return runStoryCommand({ action: 'advance', requestId: `sf-walk-${walkSeq++}`, expectedVersion, fromStepId });
}

// ---------- ① 全链：演示步 → 真实证据版本；纠正 → 真实复核；投影到首页 ----------

test('全链：专属会话懒建；演示补充步生成真实证据链（s03 建链、s05 升版第2次采集）', () => {
  // 初始 GET（等价首页加载）：触发 ensure + 迁移。
  const st = getStoryState();
  assert.equal(st.mode, 'story');
  const sessionId = storeMod.readV5StoreState({ seed: () => createSeedOverview('approval') }).sharedDemo.sessionId;
  assert.equal(sessionId, DEMO_SESSION_ID, '专属演示会话指针已建立');
  const remote = remoteStore.readRemoteStoreState();
  assert.ok(remote.sessions.some((s) => s.sessionId === DEMO_SESSION_ID), 'remote 侧专属会话已建');

  // s00 →(链)→ s03（发起访谈：建 inspection 链 v1）。
  let res = advance(DEMO_STORY_STEPS[0].stepId, st.version);
  assert.equal(res.step.stepId, 's03-dd-01');
  let ev = evidenceOf(DEMO_SESSION_ID).filter((e) => e.fixtureId === 'fixture-inspection');
  assert.equal(ev.length, 1, 's03 建立现场巡检证据链');
  assert.equal(ev[0].evidenceId, `ev-demo-s03dd01-${DEMO_SESSION_ID}`, '确定性证据 ID');

  // s03 → s05（现场补充：同一链升版 = supersede root）。
  res = advance('s03-dd-01', res.overview.version);
  assert.equal(res.step.stepId, 's05-dd-03');
  ev = evidenceOf(DEMO_SESSION_ID).filter((e) => e.fixtureId === 'fixture-inspection');
  assert.equal(ev.length, 2, '现场补充生成第 2 条证据（取代链）');
  const root = ev.find((e) => e.supersedes === undefined || e.supersedes === null);
  const second = ev.find((e) => e.evidenceId !== root.evidenceId);
  assert.equal(root.supersededBy, second.evidenceId, 'root.supersededBy 指向补充版本（旧内容保留）');
  assert.equal(second.supersedes, root.evidenceId, '补充版本携带反向指针');
});

test('全链：尽调页同后端纠正（人工）→ 旧意见待复核 → 资产域/待办/消息投影首页 → 刷新返回一致', () => {
  // 与真实 DD 页相同的后端命令：对当前 inspection 链做人工纠正（requestId 幂等 + remoteVersion 门）。
  const before = remoteVersion();
  const latest = evidenceOf(DEMO_SESSION_ID).find((e) => e.fixtureId === 'fixture-inspection' && e.supersededBy === null);
  const res = remoteService.createReview({
    requestId: 'dd-user-correct-1',
    expectedVersion: before,
    sessionId: DEMO_SESSION_ID,
    targetType: 'evidence',
    targetId: latest.evidenceId,
    targetVersion: latest.version,
    action: 'correct',
    opinion: '巡检照片时点与陈述不一致，要求更正（测试）',
    reviewer: '资产 · 李资产（合成）',
  });
  assert.equal(res.ok, true);
  assert.equal(remoteVersion(), before + 1);

  // 首页等价读取（GET project 路由内同款同步）：投影把受影响域标待复核。
  const sync = syncSharedProjection();
  assert.equal(sync.degraded, null);
  const overview = rowsOverview();
  const asset = overview.domains.find((d) => d.domainId === 'asset');
  assert.ok(asset.judgmentText.includes('证据纠正待复核'), `资产域投影待复核（实际：${asset.judgmentText}）`);
  // 人工门：投影只加文字标记，不改判断灯颜色（当前步 s05 资产预设=gray，投影后仍=gray，不升绿）。
  const presetAsset = byId.get(getStoryState().step.stepId).domains.find((d) => d.domainId === 'asset');
  assert.equal(asset.judgmentStatus, presetAsset.judgmentStatus, '投影不改判断灯颜色（与步表预设一致）');
  assert.notEqual(asset.judgmentStatus, 'green', '投影不把判断灯改为绿色');
  // 用户动作的 reviewId 由服务端生成（随机）；投影消息以其确定性派生（重算不重复），此处取实际 id 断言。
  const userReview = remoteStore.readRemoteStoreState().reviews.find((r) => r.sessionId === DEMO_SESSION_ID && r.action === 'correct');
  assert.ok(userReview !== undefined, '人工纠正复核记录已落库');
  assert.ok(
    overview.messages.some((m) => m.id === `msg-shared-rev-${userReview.reviewId}`),
    '人工纠正投影为共享尽调消息（reviewId 派生确定性 ID）',
  );
  assert.ok(overview.messages.some((m) => m.id.startsWith('msg-shared-ev-')), '证据挂接投影消息在列');

  // shared-state 出口（首页事实条 / 尽调页会话选择的唯一来源）。
  const view = getSharedFactsView();
  assert.equal(view.ok, true);
  assert.equal(view.demoSessionId, DEMO_SESSION_ID);
  const inspection = view.facts.find((f) => f.fixtureId === 'fixture-inspection');
  assert.equal(inspection.chainVersion, 2, '取代链深度 = 第 2 次采集');
  assert.equal(inspection.status, 'contested');
  assert.equal(view.pendingReview.length, 1);
  assert.equal(view.pendingReview[0].domain, 'asset');

  // 刷新/返回一致：重复 GET story 稳定同一步（投影不移动游标、不重复投影）。
  const s1 = getStoryState();
  const s2 = getStoryState();
  assert.equal(s1.step.stepId, s2.step.stepId);
  assert.equal(s1.mode, 'story');
  const overview2 = rowsOverview();
  assert.equal(
    overview2.messages.filter((m) => m.id === `msg-shared-rev-${userReview.reviewId}`).length,
    1,
    '重复同步不产生重复消息（确定性 ID 去重）',
  );

  // 幂等重放：同 requestId 同载荷 → 重放，不新增复核/不再次 bump remote 版本。
  const replay = remoteService.createReview({
    requestId: 'dd-user-correct-1',
    expectedVersion: before,
    sessionId: DEMO_SESSION_ID,
    targetType: 'evidence',
    targetId: latest.evidenceId,
    targetVersion: latest.version,
    action: 'correct',
    opinion: '巡检照片时点与陈述不一致，要求更正（测试）',
    reviewer: '资产 · 李资产（合成）',
  });
  assert.deepEqual(replay, res, '重放返回原响应（remote 侧重放不加 replayed 标记）');
  assert.equal(remoteVersion(), before + 1, '重放不重复写入');

  // 人工确认闭合：最新动作 confirm → contested 解除（投影标记消失，旧记录保留）。
  const v2 = remoteVersion();
  remoteService.createReview({
    requestId: 'dd-user-confirm-1',
    expectedVersion: v2,
    sessionId: DEMO_SESSION_ID,
    targetType: 'evidence',
    targetId: latest.evidenceId,
    targetVersion: latest.version,
    action: 'confirm',
    opinion: '更正后材料已核对通过（测试）',
    reviewer: '资产 · 李资产（合成）',
  });
  syncSharedProjection();
  const view2 = getSharedFactsView();
  assert.equal(view2.facts.find((f) => f.fixtureId === 'fixture-inspection').status, 'human_verified');
  assert.equal(view2.pendingReview.length, 0, '人工确认后待复核清单清空');
  const asset2 = rowsOverview().domains.find((d) => d.domainId === 'asset');
  assert.equal(asset2.judgmentText.includes('证据纠正待复核'), false, '闭合后域标记消失（回到步表基准文案）');
});

test('全链：演示纠正决定（s09 correct）写真实复核 → 信审外的第二域投影；演示推进保留投影不丢失', () => {
  // 从当前步（s05）推进到 s09 决定点；s09 correct → inspection 链复核（correct）。
  let st = getStoryState();
  let res = advance('s05-dd-03', st.version);
  assert.equal(res.step.stepId, DD_DECISION);
  const remoteBefore = remoteVersion();
  res = runStoryCommand({ action: 'decide', requestId: 'sf-decide-correct', expectedVersion: res.overview.version, fromStepId: DD_DECISION, decision: 'correct', note: '演示纠正（测试）' });
  assert.equal(res.step.stepId, 's13-dd-08');
  const reviews = remoteStore.readRemoteStoreState().reviews.filter((r) => r.sessionId === DEMO_SESSION_ID);
  assert.ok(reviews.some((r) => r.reviewId === `rev-demo-s09correct-${DEMO_SESSION_ID}`), '演示纠正生成确定性复核记录');
  assert.equal(remoteVersion(), remoteBefore + 1, '演示复核写入 bump remote 版本（同一命令区）');

  // 投影：asset 域再次 contested（响应内已含投影）。
  const asset = res.overview.domains.find((d) => d.domainId === 'asset');
  assert.ok(asset.judgmentText.includes('证据纠正待复核'), '决定响应内投影已生效');

  // 演示推进（s13 → s14/s15 链）：步表替换 domains/todo 后投影重放，标记不丢失。
  res = advance('s13-dd-08', res.overview.version);
  assert.equal(res.step.stepId, 's15-sg-02');
  const assetAfterAdvance = res.overview.domains.find((d) => d.domainId === 'asset');
  assert.ok(assetAfterAdvance.judgmentText.includes('证据纠正待复核'), '推进后共享投影重放（不因步表覆盖丢失）');
});

test('全链：notes 通道兼容共存——投影标记下提交补充说明照常；信审待办不受演示纠正影响时不变', () => {
  resetStoreToApprovalSeed();
  syncSharedProjection(); // 路由等价：notes 路由在提交前同步共享投影。
  const overview = rowsOverview();
  const res = submitNote({
    requestId: 'sf-note-1',
    expectedVersion: overview.version,
    todoId: overview.todo.id,
    text: '补充说明与共享事实共存（测试）',
    actorRole: 'business',
  });
  assert.equal(res.ok, true);
  assert.ok(
    res.overview.messages.some((m) => m.id.startsWith('msg-shared-')),
    'notes 写入后共享尽调消息保留',
  );
});

// ---------- ② 重开隔离 ----------

test('重开隔离：reset 仅清除专属演示会话数据；其他会话与记录保留；主线回起点游标 s00', () => {
  // 其他会话（保留对象）：用户手建会话 + 一条证据 + 一条复核。
  const v = remoteVersion();
  const other = remoteService.createRemoteSession({ requestId: 'other-session-1', expectedVersion: v, title: '其他会话（保留对照）' });
  const otherId = other.session.sessionId;
  remoteService.attachEvidence({ requestId: 'other-ev-1', expectedVersion: remoteVersion(), sessionId: otherId, fixtureId: 'fixture-contract' });

  const before = {
    sessions: remoteStore.readRemoteStoreState().sessions.map((s) => s.sessionId),
    evidence: remoteStore.readRemoteStoreState().evidence.length,
    rowsVersion: rowsOverview().version,
  };
  const res = resetDemoRun();
  assert.equal(res.ok, true);

  const after = remoteStore.readRemoteStoreState();
  assert.equal(after.sessions.some((s) => s.sessionId === DEMO_SESSION_ID), false, '专属演示会话已清除');
  assert.equal(after.evidence.some((e) => e.sessionId === DEMO_SESSION_ID), false, '专属会话证据已清除');
  assert.equal(after.reviews.some((r) => r.sessionId === DEMO_SESSION_ID), false, '专属会话复核已清除');
  assert.ok(after.sessions.some((s) => s.sessionId === otherId), '其他会话保留');
  assert.equal(after.evidence.some((e) => e.sessionId === otherId), true, '其他会话证据保留');

  const rows = storeMod.readV5StoreState({ seed: () => createSeedOverview('approval') });
  assert.equal(rows.storyCursor.stepId, DEMO_STORY_STEPS[0].stepId, '主线游标回起点');
  assert.equal(rows.overview.version, before.rowsVersion + 1, '主线版本单调 +1（不复用）');
  assert.equal(rows.sharedDemo.sessionId, null, '专属会话指针清除（下次进入懒建）');

  // 懒建自愈：再次首页 GET → 新专属会话（同 ID、空记录）。
  const st = getStoryState();
  assert.equal(st.mode, 'story');
  const view = getSharedFactsView();
  assert.equal(view.demoSessionId, DEMO_SESSION_ID, '专属会话重建（重开后干净起点）');
  assert.equal(view.facts.length, 0, '重开后专属会话无历史证据');
  assert.ok(storeMod.readV5StoreState({ seed: () => createSeedOverview('approval') }).overview.messages.every((m) => !m.id.startsWith('msg-shared-')), '重开后投影消息清零（不复活）');
});

// ---------- ③ 并发重复请求 ----------

test('并发重复请求：story 同 requestId 重放/异载荷 mismatch；remote attach 同 requestId 重放', () => {
  const st = getStoryState();
  const body = { action: 'advance', requestId: 'sf-dup-1', expectedVersion: st.version, fromStepId: st.step.stepId };
  const first = runStoryCommand(body);
  const replay = runStoryCommand(body);
  assert.equal(replay.replayed, true);
  assert.equal(replay.overview.version, first.overview.version, '重放不重复推进');
  assert.throws(
    () => runStoryCommand({ ...body, decision: 'confirm' }),
    (e) => e.code === 'REQUEST_MISMATCH',
    '同 requestId 异载荷 → REQUEST_MISMATCH',
  );

  const rv = remoteVersion();
  const attach = { requestId: 'sf-dup-ev', expectedVersion: remoteVersion(), sessionId: DEMO_SESSION_ID, fixtureId: 'fixture-equipment' };
  const a1 = remoteService.attachEvidence(attach);
  const a2 = remoteService.attachEvidence(attach);
  assert.deepEqual(a2, a1, '重放返回原响应（remote 侧重放不加 replayed 标记，响应逐字节一致）');
  assert.equal(remoteVersion(), rv + 1, '重复 attach 只落一次');
});

// ---------- ④ 故障中断恢复 ----------

test('中断恢复：remote 写成功后 rows 写丢失 → 同 requestId 原样重试自愈；投影从 remote 重算重建', () => {
  const st = getStoryState();
  const rowsFile = storeMod.getV5PreviewStoreFilePath();
  const snapshot = readFileSync(rowsFile, 'utf8'); // 模拟 rows 写入前的磁盘状态

  const body = { action: 'advance', requestId: 'sf-crash-1', expectedVersion: st.version, fromStepId: st.step.stepId };
  const first = runStoryCommand(body);
  const evidenceCountBefore = evidenceOf(DEMO_SESSION_ID).length;

  // 模拟部分失败：remote 已写（本链 advance 含 s05 现场补充 supersede 写入），rows 整体回滚到命令前。
  writeFileSync(rowsFile, snapshot, 'utf8');
  assert.equal(rowsOverview().messages.some((m) => m.id.includes('sf-crash-1')), false, '前置：rows 已回滚（命令消息不在）');

  // 原样重试（同 requestId）：remote 侧确定性 ID 跳过（不重复），rows 侧补写成功。
  const retried = runStoryCommand(body);
  assert.equal(retried.overview.version, first.overview.version, '重试落到同一版本（不重复应用）');
  assert.equal(evidenceOf(DEMO_SESSION_ID).length, evidenceCountBefore, 'remote 确定性写入不重复（幂等）');

  // 投影重算重建：清掉 rows 中全部投影消息（模拟投影丢失），GET 等价同步后从 remote 完整重建。
  const rows = storeMod.readV5StoreState({ seed: () => createSeedOverview('approval') });
  const stripped = { ...rows, overview: { ...rows.overview, messages: rows.overview.messages.filter((m) => !m.id.startsWith('msg-shared-')) } };
  storeMod.writeV5StoreState(stripped);
  syncSharedProjection();
  const healed = rowsOverview();
  const remoteNow = remoteStore.readRemoteStoreState();
  const expectedSharedIds = new Set(
    remoteNow.reviews.filter((r) => r.sessionId === DEMO_SESSION_ID).map((r) => `msg-shared-rev-${r.reviewId}`)
      .concat(evidenceOf(DEMO_SESSION_ID).map((e) => `msg-shared-ev-${e.evidenceId}`)),
  );
  for (const id of expectedSharedIds) {
    assert.ok(healed.messages.some((m) => m.id === id), `投影重建：${id}`);
  }
  const facts = computeSharedFacts(remoteNow, DEMO_SESSION_ID);
  const expectedContested = [...new Set(facts.pendingReview.map((p) => p.domain))].sort();
  const contestedDomains = healed.domains.filter((d) => d.judgmentText.includes('证据纠正待复核')).map((d) => d.domainId).sort();
  assert.deepEqual(contestedDomains, expectedContested, '投影重建：受影响域标记与 remote 争议状态一致');
});

// ---------- ⑤ 降级 ----------

test('降级：remote 存储损坏 → 同步诚实降级 + sharedWarning；rows 数据不阻塞只读浏览', () => {
  const remoteFile = join(dataDir, 'remote-store.json');
  const good = readFileSync(remoteFile, 'utf8');
  try {
    writeFileSync(remoteFile, '{"schema":"v5-preview-remote-store@1","version":1,"sessions":"不是数组"}', 'utf8');
    const sync = syncSharedProjection();
    assert.ok(String(sync.degraded).includes('远程尽调数据暂不可用'), '同步返回降级说明');
    const view = getSharedFactsView();
    assert.equal(view.ok, true);
    assert.deepEqual(view.facts, []);
    assert.ok(String(view.sharedWarning).includes('远程尽调数据暂不可用'), 'shared-state 出口诚实降级');
    assert.equal(rowsOverview().messages.length > 0, true, 'rows 数据仍在（首页只读浏览不阻塞）');
  } finally {
    writeFileSync(remoteFile, good, 'utf8');
  }
  // 恢复后同步回到正常（不再降级）。
  assert.equal(syncSharedProjection().degraded, null);
});
