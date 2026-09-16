// V4-LIFE §14.3 Demo reset 测试：进程内直调 route handler（new Request + Promise params），
// 不启动网络服务、不发起真实网络请求。每个测试前 resetV4LifeRuntime() 保证隔离。
// 覆盖：reset 成功回初态 / 旧引擎实例被丢弃（旧 rev → 409）/ caseId 不匹配 404 /
// NODE_ENV=production 失败关闭 / reset 只重建 demo 单例、不影响其他已注册引擎。

import assert from 'node:assert/strict';
import test from 'node:test';

import { createV4LifeEngine } from '../lib/v4life/engine.ts';
import { createV4LifeDemoSeed, V4LIFE_DEMO_CASE_ID } from '../lib/v4life/seed.ts';
import {
  getOrCreateV4LifeDemoEngine,
  getV4LifeEngine,
  injectV4LifeEngine,
  resetV4LifeRuntime,
} from '../lib/v4life/runtime.ts';
import { GET as getDemoReset, POST as postDemoReset } from '../app/api/v4life/demo/reset/route.ts';
import { POST as postWork } from '../app/api/v4life/cases/[caseId]/work/route.ts';
import { POST as postDecision } from '../app/api/v4life/cases/[caseId]/decisions/route.ts';

const CASE = V4LIFE_DEMO_CASE_ID;
const CASE_PARAMS = { params: Promise.resolve({ caseId: CASE }) };
const RESET_PATH = '/api/v4life/demo/reset';

// ---------------------------------------------------------------------------
// 调用辅助
// ---------------------------------------------------------------------------

function postRequest(path, body) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
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

function findWorkItem(projection, workItemId) {
  for (const domain of projection.domains) {
    const item = domain.workItems.find((entry) => entry.workItemId === workItemId);
    if (item !== undefined) {
      return item;
    }
  }
  throw new Error(`projection 中不存在工作项 ${workItemId}`);
}

/** 全新种子的初始 Projection（reset 后应与之同构）。 */
function freshInitialProjection() {
  return createV4LifeEngine(createV4LifeDemoSeed()).getProjection();
}

/** 经正式命令把 demo 状态推进：WI-C1 完成、WI-P1 完成并批准 PG-1（产生 Receipt）。 */
async function advanceDemoState() {
  const c1 = await postWork(postRequest(`/api/v4life/cases/${CASE}/work`, {
    commandId: 'cmd-reset-c1',
    expectedRev: getOrCreateV4LifeDemoEngine().rev,
    workItemId: 'WI-C1',
    actorId: 'actor-credit-zhang',
    outputSummary: 'reset 前推进：信审材料完整性核验完成。',
  }), CASE_PARAMS);
  assert.equal(c1.status, 200, '前置推进：WI-C1 提交应成功');

  const p1 = await postWork(postRequest(`/api/v4life/cases/${CASE}/work`, {
    commandId: 'cmd-reset-p1',
    expectedRev: getOrCreateV4LifeDemoEngine().rev,
    workItemId: 'WI-P1',
    actorId: 'actor-policy-li',
    outputSummary: 'reset 前推进：政策准入初核完成。',
  }), CASE_PARAMS);
  assert.equal(p1.status, 200, '前置推进：WI-P1 提交应成功');

  const approve = await postDecision(postRequest(`/api/v4life/cases/${CASE}/decisions`, {
    commandId: 'cmd-reset-dec-pg1',
    expectedRev: getOrCreateV4LifeDemoEngine().rev,
    gateId: 'PG-1',
    actorId: 'actor-policy-li',
    outcome: 'approved',
    reason: 'reset 前推进：政策准入批准。',
  }), CASE_PARAMS);
  assert.equal(approve.status, 201, '前置推进：PG-1 批准应成功');
}

// ---------------------------------------------------------------------------
// reset 成功
// ---------------------------------------------------------------------------

test('POST demo/reset：200 status=reset，projection 回到初始 rev/事件数，receipts 清空，WI-P1/WI-C1/WI-A1 回 in_progress', async () => {
  resetV4LifeRuntime();
  await advanceDemoState();
  const before = getOrCreateV4LifeDemoEngine().getProjection();
  assert.ok(before.receipts.length > 0, '前置：推进后应已产生 Receipt');
  assert.equal(findWorkItem(before, 'WI-P1').status, 'completed', '前置：WI-P1 应已完成');
  assert.equal(findWorkItem(before, 'WI-C1').status, 'completed', '前置：WI-C1 应已完成');
  assert.ok(before.rev > freshInitialProjection().rev, '前置：推进后 rev 应大于全新初态');

  const response = await postDemoReset(postRequest(RESET_PATH));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.status, 'reset');

  const fresh = freshInitialProjection();
  assert.equal(body.projection.rev, fresh.rev, 'rev 回到初始值');
  assert.equal(body.projection.eventCount, fresh.eventCount, '事件数回初态');
  assert.deepEqual(body.projection.receipts, [], 'receipts 清空');
  for (const workItemId of ['WI-P1', 'WI-C1', 'WI-A1']) {
    assert.equal(findWorkItem(body.projection, workItemId).status, 'in_progress', `${workItemId} 应回到 in_progress`);
  }
  assert.equal(body.projection.case.caseId, CASE, '返回的 projection 仍是 demo case');

  const registered = getOrCreateV4LifeDemoEngine();
  assert.equal(registered.getProjection().rev, fresh.rev, '注册表中的 demo 引擎已是全新初态');
});

test('GET demo/reset → 405 Method Not Allowed（reset 仅接受 POST）', async () => {
  resetV4LifeRuntime();
  const response = await getDemoReset(getRequest(RESET_PATH));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

// ---------------------------------------------------------------------------
// 旧引擎实例被丢弃
// ---------------------------------------------------------------------------

test('POST demo/reset：旧引擎被丢弃——reset 后用旧 projection 的 rev 经路由写命令 → 409 VERSION_CONFLICT', async () => {
  resetV4LifeRuntime();
  const oldEngine = getOrCreateV4LifeDemoEngine();
  await advanceDemoState();
  const staleRev = oldEngine.rev;
  const freshRev = freshInitialProjection().rev;
  assert.ok(staleRev > freshRev, '前置：旧引擎 rev 应大于全新初态 rev');

  const response = await postDemoReset(postRequest(RESET_PATH));
  assert.equal(response.status, 200);

  const stale = await postWork(postRequest(`/api/v4life/cases/${CASE}/work`, {
    commandId: 'cmd-reset-stale-rev',
    expectedRev: staleRev,
    workItemId: 'WI-C1',
    actorId: 'actor-credit-zhang',
    outputSummary: 'reset 后仍持旧 rev 提交，应被新引擎拒绝。',
  }), CASE_PARAMS);
  await assertError(stale, 409, 'VERSION_CONFLICT');
  assert.notEqual(getV4LifeEngine(CASE), oldEngine, '注册表中的 demo 引擎不再是旧实例');
});

// ---------------------------------------------------------------------------
// caseId 不匹配 / production 失败关闭
// ---------------------------------------------------------------------------

test('POST demo/reset：caseId 与 demo 不匹配 → 404 CASE_NOT_FOUND，且不重建引擎', async () => {
  resetV4LifeRuntime();
  const engine = getOrCreateV4LifeDemoEngine();
  const response = await postDemoReset(postRequest(RESET_PATH, { caseId: 'other-case' }));
  await assertError(response, 404, 'CASE_NOT_FOUND');
  assert.equal(getV4LifeEngine(CASE), engine, '失败关闭路径不得替换 demo 引擎');
});

test('POST demo/reset：NODE_ENV=production 失败关闭 → 404 CASE_NOT_FOUND（finally 恢复原值）', async () => {
  resetV4LifeRuntime();
  getOrCreateV4LifeDemoEngine();
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const post = await postDemoReset(postRequest(RESET_PATH));
    await assertError(post, 404, 'CASE_NOT_FOUND');

    const get = await getDemoReset(getRequest(RESET_PATH));
    await assertError(get, 404, 'CASE_NOT_FOUND');
  } finally {
    if (original === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = original;
    }
  }
});

// ---------------------------------------------------------------------------
// reset 只影响 demo 单例
// ---------------------------------------------------------------------------

test('POST demo/reset：不影响其他已注册引擎（other-case 实例与可读性保持）', async () => {
  resetV4LifeRuntime();
  const seed = createV4LifeDemoSeed();
  const otherEngine = createV4LifeEngine({ ...seed, case: { ...seed.case, caseId: 'other-case' } });
  injectV4LifeEngine('other-case', otherEngine);

  const response = await postDemoReset(postRequest(RESET_PATH));
  assert.equal(response.status, 200);

  const preserved = getV4LifeEngine('other-case');
  assert.ok(preserved !== undefined, 'other-case 引擎仍可读取（不为 undefined）');
  assert.equal(preserved, otherEngine, 'reset 不得替换其他 case 的引擎实例');
  assert.equal(preserved.getProjection().case.caseId, 'other-case');

  const demo = getV4LifeEngine(CASE);
  assert.ok(demo !== undefined, 'demo case 在 reset 后仍已注册');
  assert.notEqual(demo, otherEngine, 'demo 与 other-case 仍是不同实例');
});

test('POST reset：非法 JSON body 走宽容模式 → 仍按省略语义重置成功', async () => {
  resetV4LifeRuntime();
  const response = await postDemoReset(
    postRequest(RESET_PATH, '{not-json'),
    CASE_PARAMS,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.status, 'reset');
  assert.equal(payload.projection.receipts.length, 0);
});

test('POST reset：超大 body 即使宽容模式也 413（资源守卫不放宽）', async () => {
  resetV4LifeRuntime();
  const response = await postDemoReset(
    new Request(`http://localhost${RESET_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(1_000_001),
    }),
    CASE_PARAMS,
  );
  assert.equal(response.status, 413);
  const payload = await response.json();
  assert.equal(payload.error, 'REQUEST_BODY_TOO_LARGE');
});
