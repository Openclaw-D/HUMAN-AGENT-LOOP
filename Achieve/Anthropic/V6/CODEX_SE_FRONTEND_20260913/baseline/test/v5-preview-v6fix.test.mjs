// V6-CTRL 第一批修复 · 服务层/存储层进程内测试（真实逻辑执行）。
// 运行方式：node --experimental-strip-types --test test/v5-preview-v6fix.test.mjs
// 设计约束：3311 现场服务持有开发锁期间无法自起 HTTP 实例——本文件以进程内直调
// service/store 覆盖 A-D 修复语义（隔离数据目录，不触碰现场存储）；HTTP 全量回归
// 由 Codex 在隔离环境复验（见 REPORT"未运行项"）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 数据目录必须在导入被测模块前指向隔离临时目录（getV5PreviewDataDir 每次调用读取环境变量）。
const dataDir = mkdtempSync(join(tmpdir(), 'v6-ctrl-fix-data-'));
process.env.V5_PREVIEW_DATA_DIR = dataDir;

const svc = await import('../lib/v5-preview/service.ts');
const store = await import('../lib/v5-preview/store.ts');
// V6 BATCH_2 CP2-4/CP2-1：前端纯逻辑层（错误映射/版本门判定）同样真执行。
const logic = await import('../app/v5-preview/rows-logic.ts');

const NOTE_BASE = {
  todoId: 'todo-device-list',
  text: 'V6-CTRL 修复验证：合成补充说明。',
  actorRole: 'business',
};

/** 重置为指定情景种子并清空幂等表（直接写存储，绕过 HTTP）。 */
function resetTo(scenario) {
  store.writeV5StoreState({ overview: svc.createSeedOverview(scenario), idempotency: new store.V5IdempotencyTable() });
}

function current() {
  return svc.getProjectOverview();
}

function expectServiceError(action, code) {
  try {
    action();
    assert.fail(`应当抛出 ${code}`);
  } catch (error) {
    assert.equal(error.code, code, `错误码应为 ${code}，实际 ${error.code}：${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// A：postMessage 乐观并发门（幂等重放之后、任何写入之前）
// ---------------------------------------------------------------------------

test('A1：消息版本过期（expectedVersion=0，服务端 v7）→ VERSION_CONFLICT，不追加不递增', () => {
  resetTo('approval');
  expectServiceError(
    () => svc.postMessage({ requestId: 'a-stale', expectedVersion: 0, text: '旧版本沟通', actorRole: 'business' }),
    'VERSION_CONFLICT',
  );
  const after = current();
  assert.equal(after.version, 7, '版本不得递增');
  assert.equal(after.messages.length, 2, '不得追加消息');
});

test('A2：消息正确版本 → 接受（v8）；同 requestId 同载荷重放 → replayed 不重复记账', () => {
  resetTo('approval');
  const req = { requestId: 'a-ok', expectedVersion: 7, text: '正常项目沟通（合成）。', actorRole: 'business' };
  const res = svc.postMessage(req);
  assert.equal(res.overview.version, 8);
  assert.equal(res.overview.messages.length, 3);
  const replay = svc.postMessage(req);
  assert.equal(replay.replayed, true, '同 requestId 同载荷必须幂等重放');
  const after = current();
  assert.equal(after.version, 8, '重放不得再次递增版本');
  assert.equal(after.messages.length, 3, '重放不得重复追加');
});

test('A3：同 requestId 换载荷 → REQUEST_MISMATCH（不得用新并发语义规避）', () => {
  resetTo('approval');
  svc.postMessage({ requestId: 'a-swap', expectedVersion: 7, text: '第一条（合成）。', actorRole: 'business' });
  expectServiceError(
    () => svc.postMessage({ requestId: 'a-swap', expectedVersion: 8, text: '第二条换载荷（合成）。', actorRole: 'business' }),
    'REQUEST_MISMATCH',
  );
});

// ---------------------------------------------------------------------------
// B：持久化文件完整失败关闭校验（深递归，非顶层浅检查）
// ---------------------------------------------------------------------------

const VALID_OVERVIEW = svc.createSeedOverview('approval');

function writeStoreRaw(overviewPatch, idempotency) {
  const file = store.getV5PreviewStoreFilePath();
  const base = typeof overviewPatch === 'function' ? overviewPatch(structuredClone(VALID_OVERVIEW)) : overviewPatch;
  writeFileSync(file, JSON.stringify({ schema: store.V5_STORE_SCHEMA, overview: base, idempotency: idempotency ?? [] }), 'utf8');
}

test('B0：合法种子总览必须通过新校验（基线不回归）', () => {
  resetTo('approval');
  const state = current();
  assert.equal(state.version, 7);
  assert.equal(state.domains.length, 4);
});

const corruptCases = [
  ['四个 null 域（Codex 探针原样本）', (o) => { o.domains = [null, null, null, null]; }],
  ['域顺序错乱（信审在前）', (o) => { const d = o.domains; o.domains = [d[1], d[0], d[2], d[3]]; }],
  ['段状态非法（finished）', (o) => { o.domains[0].segments = ['done', 'finished', 'pending', 'pending']; }],
  ['段名缺失（空字符串）', (o) => { o.domains[1].segmentLabels = ['', '一致性核验', '偿付覆盖', '信审意见']; }],
  ['判断状态非法（blue）', (o) => { o.domains[2].judgmentStatus = 'blue'; }],
  ['判断文本为空', (o) => { o.domains[3].judgmentText = ''; }],
  ['todo 以数字伪装对象', (o) => { o.todo = 5; }],
  ['消息 fromKind 非法', (o) => { o.messages[0].fromKind = 'robot'; }],
  ['消息时间为非法字符串', (o) => { o.messages[0].at = 'not-a-time'; }],
  ['情景非法', (o) => { o.scenario = 'unknown'; }],
  ['updatedAt 不可解析', (o) => { o.updatedAt = '昨天'; }],
];

for (const [name, patch] of corruptCases) {
  test(`B：畸形总览必须 STORE_CORRUPT 且不静默重置——${name}`, () => {
    writeStoreRaw(patch);
    try {
      current();
      assert.fail('应当抛出 STORE_CORRUPT');
    } catch (error) {
      assert.equal(error.code, 'STORE_CORRUPT', `实际 ${error.code}：${error.message}`);
    }
    // 不静默重置：损坏文件仍在磁盘（读取持续失败），服务端不得悄悄重建。
    const file = store.getV5PreviewStoreFilePath();
    assert.equal(readFileSync(file, 'utf8').length > 0, true, '损坏文件必须保留原样');
  });
}

test('B：畸形幂等响应（response.overview 缺失 / replayed 非 boolean）→ STORE_CORRUPT', () => {
  const entryBase = { requestId: 'x-1', hash: 'a'.repeat(64) };
  const badResponseCases = [
    [{ ...entryBase, response: { ok: true } }],
    [{ ...entryBase, response: { ok: true, overview: { projectId: 'x', version: 1, domains: [null, null, null, null] }, replayed: false } }],
    [{ ...entryBase, response: { ok: true, overview: VALID_OVERVIEW, replayed: 'yes' } }],
  ];
  for (const idempotency of badResponseCases) {
    writeStoreRaw(VALID_OVERVIEW, idempotency);
    try {
      current();
      assert.fail('应当抛出 STORE_CORRUPT');
    } catch (error) {
      assert.equal(error.code, 'STORE_CORRUPT', `实际 ${error.code}：${error.message}`);
    }
  }
});

// ---------------------------------------------------------------------------
// C（服务端侧）：网络结果未知后重放"完整原请求"→ 幂等命中，不产生 REQUEST_MISMATCH
// ---------------------------------------------------------------------------

test('C：轮询更新后以"完整原载荷"重试 → replayed 命中且不回退服务端真相', () => {
  resetTo('approval');
  // 首次发送（expectedVersion=7），响应丢失但服务端已落账 → v8。
  const original = { requestId: 'lost-resp', expectedVersion: 7, text: '丢失响应后原样重试（合成）。', actorRole: 'business' };
  const first = svc.postMessage(original);
  assert.equal(first.overview.version, 8);
  // 前端轮询后页面已在 v8；按 V6-CTRL C 以"完整原载荷"（expectedVersion 仍为 7）重试：
  const replay = svc.postMessage(original);
  assert.equal(replay.replayed, true, '原载荷重试必须命中幂等重放，而非 REQUEST_MISMATCH');
  assert.equal(replay.overview.version, 8, '重放返回旧版本 overview（服务端真相未回退）');
  assert.equal(current().version, 8, '服务端不得重复记账');
});

// ---------------------------------------------------------------------------
// D：情景切换的版本隔离（全局单调，不复用已发出的 version）
// ---------------------------------------------------------------------------

test('D：切换往返后旧批次 expectedVersion=7 必须 VERSION_CONFLICT，不得写入新批次', () => {
  resetTo('approval');
  assert.equal(current().version, 7);
  svc.seedScenario({ scenario: 'post-rental' });
  const afterPost = current();
  assert.equal(afterPost.scenario, 'post-rental');
  assert.equal(afterPost.version, 8, 'seed 版本必须全局单调递增（不得复用固定 23）');
  svc.seedScenario({ scenario: 'approval' });
  const backToApproval = current();
  assert.equal(backToApproval.scenario, 'approval');
  assert.equal(backToApproval.version, 9, '切回审批不得回到固定 7');
  expectServiceError(
    () => svc.submitNote({ requestId: 'd-stale', expectedVersion: 7, ...NOTE_BASE }),
    'VERSION_CONFLICT',
  );
  assert.equal(current().version, 9, '旧批次请求不得写入');
});

test('D：切换后的正确版本可正常写入；seed 三连切换版本持续单调', () => {
  resetTo('approval');
  const versions = [current().version];
  for (const scenario of ['post-rental', 'settled', 'approval']) {
    svc.seedScenario({ scenario });
    versions.push(current().version);
  }
  for (let i = 1; i < versions.length; i += 1) {
    assert.ok(versions[i] > versions[i - 1], `版本必须单调递增：${versions.join(' → ')}`);
  }
  const res = svc.postMessage({ requestId: 'd-after-switch', expectedVersion: current().version, text: '切换后正常沟通（合成）。', actorRole: 'business' });
  assert.equal(res.overview.version, current().version);
});

// ---------------------------------------------------------------------------
// E（服务端侧）：中文收口与摘要同步
// ---------------------------------------------------------------------------

test('E：种子与全部用户可见消息不得出现 Decision/Receipt 英文边界词', () => {
  for (const scenario of ['approval', 'post-rental', 'settled']) {
    const overview = svc.createSeedOverview(scenario);
    assert.doesNotMatch(overview.overall.description, /Decision|Receipt/);
    for (const m of overview.messages) {
      assert.doesNotMatch(m.text, /Decision|Receipt/);
    }
  }
});

test('E：补充说明提交后总体说明同步反映"待复核"，且与黄灯一致', () => {
  resetTo('approval');
  const res = svc.submitNote({ requestId: 'e-desc', expectedVersion: 7, ...NOTE_BASE });
  assert.match(res.overview.overall.description, /信审待复核/, '总体说明必须反映信审待复核');
  const credit = res.overview.domains.find((d) => d.domainId === 'credit');
  assert.equal(credit.judgmentStatus, 'yellow', '仍为黄灯（不自动变绿）');
  assert.equal(credit.judgmentText, '待复核');
  assert.match(res.overview.overall.description, /合成演示/);
});

// ---------------------------------------------------------------------------
// V6 BATCH_2 CP2 · 真实行为回归（服务层真执行，非源码搜索）
// ---------------------------------------------------------------------------

test('CP2-2 服务端行为：待复核后同 requestId 原载荷重放仍确认成功，不影响后续状态', () => {
  resetTo('approval');
  const body = { requestId: 'cp2-2-lost', expectedVersion: current().version, todoId: 'todo-device-list', text: '响应丢失后确认（合成）。', actorRole: 'business' };
  const first = svc.submitNote(body);
  assert.equal(first.overview.todo.status, '待复核');
  // 待办已转待复核；原载荷重放必须仍命中幂等（这就是"确认结果"按钮的服务端语义）。
  const replay = svc.submitNote(body);
  assert.equal(replay.replayed, true);
  assert.equal(replay.overview.todo.status, '待复核');
  assert.equal(current().version, first.overview.version, '重放不得再递增');
  // 待复核状态下新的普通提交被拒（不开放新入口的服务端保证）。
  expectServiceError(
    () => svc.submitNote({ requestId: 'cp2-2-new', expectedVersion: current().version, todoId: 'todo-device-list', text: '待复核新提交（合成）。', actorRole: 'business' }),
    'NOT_FOUND',
  );
});

test('CP2-3 服务端行为：资产待办提交后资产域转待复核（黄），信审不受影响', () => {
  resetTo('post-rental');
  const ov = current();
  assert.equal(ov.todo.relatedDomain, 'asset');
  const res = svc.submitNote({ requestId: 'cp2-3-asset', expectedVersion: ov.version, todoId: ov.todo.id, text: '巡检安排确认（合成）。', actorRole: 'business' });
  const asset = res.overview.domains.find((d) => d.domainId === 'asset');
  const credit = res.overview.domains.find((d) => d.domainId === 'credit');
  assert.equal(asset.judgmentText, '待复核');
  assert.equal(asset.judgmentStatus, 'yellow');
  assert.equal(credit.judgmentText, '已通过', '信审不得被错误指认');
  assert.match(res.overview.overall.description, /资产待复核/);
});

test('CP2-4 行为：NOT_FOUND 话术不含内部 todoId；错误映射白名单拒绝内部标识', () => {
  resetTo('approval');
  let caught = null;
  try {
    // 真触发 NOT_FOUND：todoId 不存在（当前开放待办是 todo-device-list）。
    svc.submitNote({ requestId: 'cp2-4-nf', expectedVersion: current().version, todoId: 'todo-not-exist', text: '触发（合成）。', actorRole: 'business' });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught !== null, '应当抛错');
  assert.equal(caught.code, 'NOT_FOUND', `实际 ${caught.code}：${caught.message}`);
  assert.doesNotMatch(caught.message, /todo-device-list/, '服务端话术不得含内部待办 ID');
  // 纯逻辑白名单行为（真实执行，非源码搜索）
  assert.equal(logic.isSafeServerMessage('待办不存在或已非开放状态：todo-device-list'), false);
  assert.equal(logic.isSafeServerMessage('当前情景没有开放待办'), true);
  assert.equal(logic.userFacingErrorMessage('ROLE_FORBIDDEN', '待办不存在或已非开放状态：todo-device-list'), '当前演示身份无权执行该操作');
  assert.equal(logic.userFacingErrorMessage('STORE_CORRUPT', 'v5-preview 存储文件损坏（overview.domains[0] 必须是对象）'), '演示数据暂不可用，请稍后重试');
  assert.equal(logic.userFacingLoadError('NETWORK', undefined), '无法连接演示服务：请确认本地演示服务已启动，然后点击重试。');
});

test('CP2-1 行为：shouldApplyOverview 全入口判定（GET/写入/重放共用）', () => {
  assert.equal(logic.shouldApplyOverview(9, 15), false, '旧 GET 晚到不得回退');
  assert.equal(logic.shouldApplyOverview(15, 15), true, '相同版本可应用（幂等不重复渲染由 updatedAt 判断承担）');
  assert.equal(logic.shouldApplyOverview(16, 15), true, '新版本应用');
});

test('CP2-5 服务端行为：切换后旧批次请求被拒（含消息），未确认请求不得污染新情景', () => {
  resetTo('approval');
  const staleVersion = current().version;
  svc.seedScenario({ scenario: 'settled' });
  expectServiceError(
    () => svc.postMessage({ requestId: 'cp2-5-stale-msg', expectedVersion: staleVersion, text: '旧批次沟通（合成）。', actorRole: 'business' }),
    'VERSION_CONFLICT',
  );
  expectServiceError(
    () => svc.submitNote({ requestId: 'cp2-5-stale-note', expectedVersion: staleVersion, todoId: 'todo-device-list', text: '旧批次说明（合成）。', actorRole: 'business' }),
    'VERSION_CONFLICT',
  );
  assert.equal(current().scenario, 'settled');
  assert.equal(current().version, staleVersion + 1, '被拒请求不得写入新批次');
});
