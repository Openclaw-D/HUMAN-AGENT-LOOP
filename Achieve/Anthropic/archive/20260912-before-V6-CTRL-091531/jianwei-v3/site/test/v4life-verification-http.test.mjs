// V4-LIFE ENG01 核验命令 HTTP 集成测试（TEST lane / TDD：verification route 尚未落地属预期，
// BE lane 落地后复跑本文件必须全绿；不得为变绿而创建被测文件以外的任何文件）。
//
// 被测冻结接口：POST /api/v4life/cases/[caseId]/verification
//   （app/api/v4life/cases/[caseId]/verification/route.ts，导出 POST(request, { params })，params 为 Promise）
// 请求体 { commandId, expectedRev, evidenceId, actorId, verificationStatus, reason }；
// 成功 201（accepted）/ 200（replayed），体为引擎结果 { status, rev, evidence }；错误体 { error: CODE }。
// 路由守卫：NODE_ENV=production → 404 CASE_NOT_FOUND；caseId ≠ demo → 404；引擎经 resolveV4LifeCaseEngine。
// engine.changeVerification 错误映射：INVALID_ENGINE_INPUT / ACTOR_NOT_FOUND → 400、ROLE_MISMATCH → 403、
// EVIDENCE_NOT_FOUND → 404、VERSION_CONFLICT / IDEMPOTENCY_CONFLICT → 409。
//
// 进程内模式（同 v4life-lane-c-http.test.mjs）：new Request(...) 直接调 route handler，
// 不启动网络服务、不发起真实网络请求。每个用例前 resetV4LifeRuntime() 隔离，并注入与 demo runtime
// 组合根同构的引擎：createV4LifeEngine(createV4LifeDemoSeed(), { p1CandidateSemantics: 'demo', now: 固定时钟 })
// 后 injectV4LifeEngine('demo-sme-robot-500w', engine)。
//
// G1 必测（覆盖矩阵）：
//   1. 合法核验 201 accepted；GET projection 核验状态更新、rev 恰 +1、事件流新增一条
//      EVIDENCE_VERIFICATION_CHANGED（actor=核验人）；
//   2. 同 commandId 同载荷重发 → 200 replayed，rev 与事件数不变；
//   3. 旧 expectedRev（新 commandId）→ 409 VERSION_CONFLICT；
//   4. business 演员 → 403 ROLE_MISMATCH；未知演员 → 400 ACTOR_NOT_FOUND；
//   5. verificationStatus='claimed'/'excellent'、reason 缺失/空串/空白、缺 commandId → 400；
//   6. 不存在 evidenceId → 404 EVIDENCE_NOT_FOUND；
//   7. 非 demo caseId → 404 CASE_NOT_FOUND；
//   8. NODE_ENV=production → 404 且状态不变（finally 恢复环境变量）；
//   9. 默认 strict 引擎（未开启 candidate）注入 → 400 且 rev 不变（G1：默认引擎不被请求打开 candidate）；
//   10. 同 commandId 异载荷 → 409 IDEMPOTENCY_CONFLICT。
//
// 运行：node --experimental-strip-types --test --experimental-test-isolation=none test/v4life-verification-http.test.mjs

import assert from 'node:assert/strict';
import test from 'node:test';

import { createV4LifeEngine } from '../lib/v4life/engine.ts';
import { createV4LifeDemoSeed } from '../lib/v4life/seed.ts';
import {
  V4LIFE_DEMO_CASE_ID,
  injectV4LifeEngine,
  resetV4LifeRuntime,
} from '../lib/v4life/runtime.ts';
import { GET as getCaseProjection } from '../app/api/v4life/cases/[caseId]/route.ts';
import { POST as postVerification } from '../app/api/v4life/cases/[caseId]/verification/route.ts';

const CASE = V4LIFE_DEMO_CASE_ID;
const CASE_PARAMS = { params: Promise.resolve({ caseId: CASE }) };
const VERIFICATION_PATH = `/api/v4life/cases/${CASE}/verification`;
const FIXED_NOW = () => '2026-09-04T08:00:00.000Z';

// ---------------------------------------------------------------------------
// 调用辅助
// ---------------------------------------------------------------------------

function postRequest(path, body) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getRequest(path) {
  return new Request(`http://localhost${path}`);
}

async function assertError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.deepEqual(body, { error: code });
  return body;
}

/** 与 lib/v4life/runtime.ts demo 组合根同构的引擎（P1 candidate 语义显式开启 + 固定时钟），注入后路由可解析。 */
function makeDemoSemanticsEngine() {
  const engine = createV4LifeEngine(createV4LifeDemoSeed(), {
    p1CandidateSemantics: 'demo',
    now: FIXED_NOW,
  });
  injectV4LifeEngine(CASE, engine);
  return engine;
}

let commandSeq = 0;

/** 合法核验命令基形：种子初始证据 ev-upstream-context + 政策演员（§11 seed 实际 id，不猜）。 */
function verificationCommand(engine, overrides = {}) {
  commandSeq += 1;
  return {
    commandId: `cmd-ver-${commandSeq}`,
    expectedRev: engine.rev,
    evidenceId: 'ev-upstream-context',
    actorId: 'actor-policy-li',
    verificationStatus: 'verified',
    reason: '政策准入核验：上游受理与尽调 Context 与现行制度要求一致（合成演示）。',
    ...overrides,
  };
}

function postVerificationCommand(engine, overrides = {}, caseId = CASE) {
  return postVerification(
    postRequest(`/api/v4life/cases/${caseId}/verification`, verificationCommand(engine, overrides)),
    { params: Promise.resolve({ caseId }) },
  );
}

function eventCount(engine) {
  return engine.getProjection().eventCount;
}

function evidenceOf(projection, evidenceId) {
  const record = projection.evidence.find((entry) => entry.evidenceId === evidenceId);
  assert.ok(record !== undefined, `projection 中不存在证据 ${evidenceId}`);
  return record;
}

// ---------------------------------------------------------------------------
// 1. 合法核验：201 accepted + 投影/rev/事件流
// ---------------------------------------------------------------------------

test('POST verification：合法核验 → 201 accepted，rev 恰 +1，投影核验状态更新，事件流新增一条 EVIDENCE_VERIFICATION_CHANGED（actor=核验人）', async () => {
  resetV4LifeRuntime();
  const engine = makeDemoSemanticsEngine();
  const revBefore = engine.rev;
  const eventsBefore = eventCount(engine);
  assert.ok(revBefore > 0, '前置：全新种子初始化后 rev 应大于 0');

  const response = await postVerificationCommand(engine);
  assert.equal(response.status, 201, 'accepted 必须 201');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.status, 'accepted');
  assert.equal(body.rev, revBefore + 1, '核验命令恰产生一条事件，rev +1');
  assert.equal(body.evidence.evidenceId, 'ev-upstream-context');
  assert.equal(body.evidence.verificationStatus, 'verified');

  const projectionResponse = await getCaseProjection(getRequest(`/api/v4life/cases/${CASE}`), CASE_PARAMS);
  assert.equal(projectionResponse.status, 200);
  const projection = await projectionResponse.json();
  assert.equal(projection.rev, revBefore + 1, 'GET projection 的 rev 恰 +1');
  assert.equal(projection.eventCount, eventsBefore + 1, '事件流恰新增一条');
  assert.equal(evidenceOf(projection, 'ev-upstream-context').verificationStatus, 'verified', '投影核验状态已更新');

  const added = engine.getEvents(revBefore).events;
  assert.equal(added.length, 1, 'revBefore 之后恰有一条新事件');
  assert.equal(added[0].actor, 'actor-policy-li', '事件 actor 为核验人');
  assert.equal(added[0].payload.type, 'EVIDENCE_VERIFICATION_CHANGED');
  assert.equal(added[0].payload.evidenceId, 'ev-upstream-context');
  assert.equal(added[0].payload.from, 'claimed', '种子证据未经核验，from 为 claimed');
  assert.equal(added[0].payload.to, 'verified');
  assert.ok(typeof added[0].payload.reason === 'string' && added[0].payload.reason.length > 0, '事件载荷携带核验理由');
});

// ---------------------------------------------------------------------------
// 2. 幂等重放 / 10. 幂等冲突
// ---------------------------------------------------------------------------

test('POST verification：同 commandId 同载荷重发 → 200 replayed，rev 与事件数不变（不重复事件）', async () => {
  resetV4LifeRuntime();
  const engine = makeDemoSemanticsEngine();
  const command = verificationCommand(engine, { commandId: 'cmd-ver-replay' });

  const first = await postVerification(postRequest(VERIFICATION_PATH, command), CASE_PARAMS);
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  assert.equal(firstBody.status, 'accepted');
  const revAfterFirst = engine.rev;
  const eventsAfterFirst = eventCount(engine);

  const replay = await postVerification(postRequest(VERIFICATION_PATH, command), CASE_PARAMS);
  assert.equal(replay.status, 200, 'replayed 必须 200');
  assert.equal(replay.headers.get('cache-control'), 'no-store');
  const replayBody = await replay.json();
  assert.equal(replayBody.status, 'replayed');
  assert.equal(replayBody.rev, firstBody.rev, 'replay 返回原接受时的 rev');
  assert.equal(engine.rev, revAfterFirst, '重放不推进 rev');
  assert.equal(eventCount(engine), eventsAfterFirst, '重放不追加事件');
  assert.equal(evidenceOf(engine.getProjection(), 'ev-upstream-context').verificationStatus, 'verified', '重放不改变核验状态');
});

test('POST verification：同 commandId 异载荷（篡改 reason）→ 409 IDEMPOTENCY_CONFLICT', async () => {
  resetV4LifeRuntime();
  const engine = makeDemoSemanticsEngine();
  const command = verificationCommand(engine, { commandId: 'cmd-ver-idem' });

  const first = await postVerification(postRequest(VERIFICATION_PATH, command), CASE_PARAMS);
  assert.equal(first.status, 201);
  const revAfter = engine.rev;

  const conflict = await postVerification(
    postRequest(VERIFICATION_PATH, { ...command, reason: '被篡改的核验理由。' }),
    CASE_PARAMS,
  );
  await assertError(conflict, 409, 'IDEMPOTENCY_CONFLICT');
  assert.equal(engine.rev, revAfter, '幂等冲突不得推进 rev');
  assert.equal(eventCount(engine), revAfter, '幂等冲突不得追加事件');
});

// ---------------------------------------------------------------------------
// 3. 版本冲突
// ---------------------------------------------------------------------------

test('POST verification：旧 expectedRev（新 commandId）→ 409 VERSION_CONFLICT，状态不变', async () => {
  resetV4LifeRuntime();
  const engine = makeDemoSemanticsEngine();
  const revBefore = engine.rev;
  assert.ok(revBefore >= 1, '前置：rev 应至少为 1');

  const response = await postVerificationCommand(engine, {
    commandId: 'cmd-ver-stale',
    expectedRev: revBefore - 1,
  });
  await assertError(response, 409, 'VERSION_CONFLICT');
  assert.equal(engine.rev, revBefore, '版本冲突不得推进 rev');
  assert.equal(eventCount(engine), revBefore, '版本冲突不得追加事件');
});

// ---------------------------------------------------------------------------
// 4. 角色 / 演员
// ---------------------------------------------------------------------------

test('POST verification：business 演员核验 → 403 ROLE_MISMATCH；未知演员 → 400 ACTOR_NOT_FOUND', async () => {
  resetV4LifeRuntime();
  const engine = makeDemoSemanticsEngine();
  const revBefore = engine.rev;

  // 核验是四域 Human 职责：业务（actor-business-chen，role=business）不得自核验。
  const business = await postVerificationCommand(engine, {
    commandId: 'cmd-ver-business',
    actorId: 'actor-business-chen',
  });
  await assertError(business, 403, 'ROLE_MISMATCH');

  const ghost = await postVerificationCommand(engine, {
    commandId: 'cmd-ver-ghost',
    actorId: 'actor-ghost',
  });
  await assertError(ghost, 400, 'ACTOR_NOT_FOUND');

  assert.equal(engine.rev, revBefore, '被拒命令不得推进 rev');
  assert.equal(eventCount(engine), revBefore, '被拒命令不得追加事件');
});

// ---------------------------------------------------------------------------
// 5. 字段校验（失败关闭）
// ---------------------------------------------------------------------------

test('POST verification：verificationStatus=claimed/excellent、reason 缺失/空串/空白、缺 commandId → 400 INVALID_ENGINE_INPUT', async () => {
  resetV4LifeRuntime();
  const engine = makeDemoSemanticsEngine();
  const revBefore = engine.rev;

  // 'claimed' 只能是 append 初始值，禁止本命令设置；'excellent' 不在五分类。
  const invalidCases = [
    // verificationStatus 非法目标
    { commandId: 'cmd-ver-claimed', verificationStatus: 'claimed' },
    { commandId: 'cmd-ver-excellent', verificationStatus: 'excellent' },
    // reason 缺失 / 空串 / 仅空白（JSON.stringify 丢弃 undefined 键）
    { commandId: 'cmd-ver-no-reason', reason: undefined },
    { commandId: 'cmd-ver-empty-reason', reason: '' },
    { commandId: 'cmd-ver-blank-reason', reason: '   ' },
    // 缺 commandId
    { commandId: undefined },
  ];

  for (const overrides of invalidCases) {
    const response = await postVerificationCommand(engine, overrides);
    await assertError(response, 400, 'INVALID_ENGINE_INPUT');
  }

  assert.equal(engine.rev, revBefore, '非法输入不得推进 rev');
  assert.equal(eventCount(engine), revBefore, '非法输入不得追加事件');
});

// ---------------------------------------------------------------------------
// 6. 证据不存在
// ---------------------------------------------------------------------------

test('POST verification：不存在的 evidenceId → 404 EVIDENCE_NOT_FOUND（rev 不变）', async () => {
  resetV4LifeRuntime();
  const engine = makeDemoSemanticsEngine();
  const revBefore = engine.rev;

  const response = await postVerificationCommand(engine, {
    commandId: 'cmd-ver-no-evidence',
    evidenceId: 'ev-nope',
  });
  await assertError(response, 404, 'EVIDENCE_NOT_FOUND');
  assert.equal(engine.rev, revBefore, '证据不存在不得推进 rev');
  assert.equal(eventCount(engine), revBefore, '证据不存在不得追加事件');
});

// ---------------------------------------------------------------------------
// 7. 非 demo caseId
// ---------------------------------------------------------------------------

test('POST verification：非 demo caseId（other-case）→ 404 CASE_NOT_FOUND，且 demo 状态不变', async () => {
  resetV4LifeRuntime();
  const engine = makeDemoSemanticsEngine();
  const revBefore = engine.rev;

  const response = await postVerificationCommand(engine, { commandId: 'cmd-ver-other' }, 'other-case');
  await assertError(response, 404, 'CASE_NOT_FOUND');
  assert.equal(engine.rev, revBefore, '非 demo case 的请求不得改变 demo 状态');
  assert.equal(eventCount(engine), revBefore);
});

// ---------------------------------------------------------------------------
// 8. NODE_ENV=production 失败关闭（照 v4life-reset.test.mjs 模式，finally 恢复）
// ---------------------------------------------------------------------------

test('POST verification：NODE_ENV=production 失败关闭 → 404 CASE_NOT_FOUND 且状态不变（finally 恢复环境变量）', async () => {
  resetV4LifeRuntime();
  const engine = makeDemoSemanticsEngine();
  const revBefore = engine.rev;
  const eventsBefore = eventCount(engine);

  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const response = await postVerificationCommand(engine, { commandId: 'cmd-ver-prod' });
    await assertError(response, 404, 'CASE_NOT_FOUND');
    assert.equal(engine.rev, revBefore, '失败关闭路径不得改变状态');
    assert.equal(eventCount(engine), eventsBefore, '失败关闭路径不得追加事件');
  } finally {
    if (original === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = original;
    }
  }
});

// ---------------------------------------------------------------------------
// 9. G1：默认 strict 引擎不被请求打开 candidate
// ---------------------------------------------------------------------------

test('POST verification：默认 strict 引擎（p1CandidateSemantics 未开启）注入 demo caseId → 400 INVALID_ENGINE_INPUT 且 rev/投影不变（G1 闸门）', async () => {
  resetV4LifeRuntime();
  const strictEngine = createV4LifeEngine(createV4LifeDemoSeed(), { now: FIXED_NOW });
  injectV4LifeEngine(CASE, strictEngine);
  const revBefore = strictEngine.rev;

  const command = {
    commandId: 'cmd-ver-strict',
    expectedRev: strictEngine.rev,
    evidenceId: 'ev-upstream-context',
    actorId: 'actor-policy-li',
    verificationStatus: 'verified',
    reason: '形状完全合法的核验命令；默认路径 candidate 闸门必须失败关闭。',
  };
  const response = await postVerification(postRequest(VERIFICATION_PATH, command), CASE_PARAMS);
  await assertError(response, 400, 'INVALID_ENGINE_INPUT');

  assert.equal(strictEngine.rev, revBefore, 'candidate 闸门失败关闭：rev 不变');
  assert.equal(eventCount(strictEngine), revBefore, 'candidate 闸门失败关闭：不追加事件');
  assert.notEqual(
    evidenceOf(strictEngine.getProjection(), 'ev-upstream-context').verificationStatus,
    'verified',
    'candidate 闸门失败关闭：核验状态不得被打开',
  );
});
