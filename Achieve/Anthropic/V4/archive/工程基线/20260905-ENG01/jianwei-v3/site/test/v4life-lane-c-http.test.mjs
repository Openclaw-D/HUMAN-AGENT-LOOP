// V4-LIFE Lane C HTTP 集成测试（契约 §10 / §12）。
// 直接 import route handler，以 Request 对象 + { params: Promise } 进程内调用；
// 不启动网络服务、不发起真实网络请求。每个测试前 resetV4LifeRuntime() 保证隔离。
//
// 依赖 Lane A 的契约 §7 引擎接口（createV4LifeEngine(seed, options?)、命令带 commandId/expectedRev、
// V4LifeError.code 全码表、engine.rev、结果含 status/rev、getEvents(afterSeq, limit?) 分页含 hasMore）。
// 在引擎完成重写前，涉及命令提交与事件分页的用例会因旧 CANDIDATE 引擎缺少 rev 而失败（HTTP 层按
// 失败关闭返回 400）——Lane A 落地后须复跑本文件确认全绿。

import assert from 'node:assert/strict';
import test from 'node:test';

import { createV4LifeEngine } from '../lib/v4life/engine.ts';
import { createV4LifeDemoSeed } from '../lib/v4life/seed.ts';
import {
  V4LIFE_DEMO_CASE_ID,
  getOrCreateV4LifeDemoEngine,
  injectV4LifeEngine,
  resetV4LifeRuntime,
} from '../lib/v4life/runtime.ts';
import { GET as getCaseProjection } from '../app/api/v4life/cases/[caseId]/route.ts';
import { POST as postEvidence } from '../app/api/v4life/cases/[caseId]/evidence/route.ts';
import { POST as postWork } from '../app/api/v4life/cases/[caseId]/work/route.ts';
import { POST as postDecision } from '../app/api/v4life/cases/[caseId]/decisions/route.ts';
import { GET as getEventsRoute } from '../app/api/v4life/cases/[caseId]/events/route.ts';

const CASE = V4LIFE_DEMO_CASE_ID;
const PARAMS = { params: Promise.resolve({ caseId: CASE }) };

// ---------------------------------------------------------------------------
// 调用辅助
// ---------------------------------------------------------------------------

function postRequest(path, body) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function getRequest(path) {
  return new Request(`http://localhost${path}`);
}

function eventCount(engine) {
  return engine.getProjection().eventCount;
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

function findGate(projection, gateId) {
  for (const domain of projection.domains) {
    const gate = domain.gates.find((entry) => entry.gateId === gateId);
    if (gate !== undefined) {
      return gate;
    }
  }
  throw new Error(`projection 中不存在 Gate ${gateId}`);
}

function currentRev() {
  return getOrCreateV4LifeDemoEngine().rev;
}

function evidenceCommand(overrides = {}) {
  return {
    commandId: 'cmd-ev-fin-1',
    expectedRev: currentRev(),
    evidenceId: 'ev-financial-statement',
    kind: 'financial_statement',
    title: '2025 年度审计报告摘要',
    submittedBy: 'actor-business-chen',
    payload: {
      summary: '营收同比下滑约 18%，经营现金流为负，账面货币资金约 320 万元。',
      tags: ['revenue_declining', 'audited'],
      amountCny: 3200000,
    },
    ...overrides,
  };
}

function workCommand(overrides = {}) {
  return {
    commandId: 'cmd-work-c1',
    expectedRev: currentRev(),
    workItemId: 'WI-C1',
    actorId: 'actor-credit-zhang',
    outputSummary: '信审材料完整性核验完成，缺尽调报告标记已提补件。',
    ...overrides,
  };
}

async function submitWorkP1() {
  const response = await postWork(
    postRequest(`/api/v4life/cases/${CASE}/work`, workCommand({
      commandId: 'cmd-work-p1',
      workItemId: 'WI-P1',
      actorId: 'actor-policy-li',
      outputSummary: '政策准入规则符合性初核完成。',
    })),
    PARAMS,
  );
  assert.equal(response.status, 200, '提交 WI-P1 应打开 PG-1 Gate');
  return response.json();
}

function decisionCommand(overrides = {}) {
  return {
    commandId: 'cmd-dec-pg1-approve',
    expectedRev: currentRev(),
    gateId: 'PG-1',
    actorId: 'actor-policy-li',
    outcome: 'approved',
    reason: '政策准入符合现行制度要求。',
    ...overrides,
  };
}

async function assertError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.deepEqual(body, { error: code });
  return body;
}

// ---------------------------------------------------------------------------
// GET projection
// ---------------------------------------------------------------------------

test('GET projection：demo case 返回 200 Projection，no-store', async () => {
  resetV4LifeRuntime();
  const response = await getCaseProjection(getRequest(`/api/v4life/cases/${CASE}`), PARAMS);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const projection = await response.json();
  assert.equal(projection.case.caseId, CASE);
  assert.ok(Array.isArray(projection.domains));
  assert.ok(Array.isArray(projection.receipts));
  assert.equal(projection.eventCount, eventCount(getOrCreateV4LifeDemoEngine()));
});

test('GET projection：未知 caseId 返回 404 CASE_NOT_FOUND', async () => {
  resetV4LifeRuntime();
  const response = await getCaseProjection(
    getRequest('/api/v4life/cases/no-such-case'),
    { params: Promise.resolve({ caseId: 'no-such-case' }) },
  );
  await assertError(response, 404, 'CASE_NOT_FOUND');
});

// ---------------------------------------------------------------------------
// POST evidence：accepted / replayed / 冲突 / 校验
// ---------------------------------------------------------------------------

test('POST evidence：accepted 201（含 startedWorkItemIds）→ 同 commandId 同载荷重放 200 replayed 且事件数不变', async () => {
  resetV4LifeRuntime();
  const engine = getOrCreateV4LifeDemoEngine();
  const command = evidenceCommand();

  const first = await postEvidence(postRequest(`/api/v4life/cases/${CASE}/evidence`, command), PARAMS);
  assert.equal(first.status, 201);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  const firstBody = await first.json();
  assert.equal(firstBody.status, 'accepted');
  assert.equal(firstBody.rev, command.expectedRev + 2, '财务证据合法产生 EVIDENCE_ACCEPTED + WI-C2 WORK_ITEM_STARTED 两条事件');
  assert.equal(firstBody.evidence.evidenceId, 'ev-financial-statement');
  assert.ok(Array.isArray(firstBody.startedWorkItemIds), 'accepted 结果应含 startedWorkItemIds');
  assert.ok(firstBody.startedWorkItemIds.includes('WI-C2'), '证据到达应启动依赖它的 WI-C2');

  const eventsBefore = eventCount(engine);
  const replay = await postEvidence(postRequest(`/api/v4life/cases/${CASE}/evidence`, command), PARAMS);
  assert.equal(replay.status, 200);
  const replayBody = await replay.json();
  assert.equal(replayBody.status, 'replayed');
  assert.equal(replayBody.rev, firstBody.rev, 'replay 返回原接受时的 rev');
  assert.equal(eventCount(engine), eventsBefore, '重放不得追加事件');
});

test('POST evidence：同 commandId 异载荷 → 409 IDEMPOTENCY_CONFLICT', async () => {
  resetV4LifeRuntime();
  const command = evidenceCommand();
  const first = await postEvidence(postRequest(`/api/v4life/cases/${CASE}/evidence`, command), PARAMS);
  assert.equal(first.status, 201);

  const conflict = await postEvidence(
    postRequest(`/api/v4life/cases/${CASE}/evidence`, { ...command, title: '被篡改的标题' }),
    PARAMS,
  );
  await assertError(conflict, 409, 'IDEMPOTENCY_CONFLICT');
});

test('POST evidence：同 evidenceId 异载荷（新 commandId）→ 409 EVIDENCE_CONFLICT', async () => {
  resetV4LifeRuntime();
  const first = await postEvidence(
    postRequest(`/api/v4life/cases/${CASE}/evidence`, evidenceCommand()),
    PARAMS,
  );
  assert.equal(first.status, 201);

  const second = await postEvidence(
    postRequest(`/api/v4life/cases/${CASE}/evidence`, evidenceCommand({
      commandId: 'cmd-ev-fin-2',
      expectedRev: currentRev(),
      payload: {
        summary: '口径不同的财务摘要。',
        tags: ['audited'],
        amountCny: 1,
      },
    })),
    PARAMS,
  );
  await assertError(second, 409, 'EVIDENCE_CONFLICT');
});

test('POST evidence：过期 expectedRev → 409 VERSION_CONFLICT', async () => {
  resetV4LifeRuntime();
  assert.ok(currentRev() > 0, 'demo 引擎初始化后 rev 应大于 0');
  const response = await postEvidence(
    postRequest(`/api/v4life/cases/${CASE}/evidence`, evidenceCommand({
      commandId: 'cmd-ev-stale',
      expectedRev: currentRev() - 1,
    })),
    PARAMS,
  );
  await assertError(response, 409, 'VERSION_CONFLICT');
});

test('POST evidence：缺字段 / 坏 tags / 超长 / 非法 amountCny / 坏 expectedRev → 400', async () => {
  resetV4LifeRuntime();

  const missingTitle = await postEvidence(
    postRequest(`/api/v4life/cases/${CASE}/evidence`, evidenceCommand({ title: undefined })),
    PARAMS,
  );
  await assertError(missingTitle, 400, 'INVALID_ENGINE_INPUT');

  const missingCommandId = await postEvidence(
    postRequest(`/api/v4life/cases/${CASE}/evidence`, evidenceCommand({ commandId: undefined })),
    PARAMS,
  );
  await assertError(missingCommandId, 400, 'INVALID_ENGINE_INPUT');

  const badRev = await postEvidence(
    postRequest(`/api/v4life/cases/${CASE}/evidence`, evidenceCommand({ commandId: 'cmd-bad-rev', expectedRev: -1 })),
    PARAMS,
  );
  await assertError(badRev, 400, 'INVALID_ENGINE_INPUT');

  const longTitle = await postEvidence(
    postRequest(`/api/v4life/cases/${CASE}/evidence`, evidenceCommand({
      commandId: 'cmd-long-title',
      title: '长'.repeat(201),
    })),
    PARAMS,
  );
  await assertError(longTitle, 400, 'INVALID_ENGINE_INPUT');

  const tagsNotArray = await postEvidence(
    postRequest(`/api/v4life/cases/${CASE}/evidence`, evidenceCommand({
      commandId: 'cmd-bad-tags',
      payload: { summary: '摘要', tags: 'revenue_declining' },
    })),
    PARAMS,
  );
  await assertError(tagsNotArray, 400, 'EVIDENCE_INVALID');

  const tagsBadItem = await postEvidence(
    postRequest(`/api/v4life/cases/${CASE}/evidence`, evidenceCommand({
      commandId: 'cmd-bad-tags-2',
      payload: { summary: '摘要', tags: ['ok', ''] },
    })),
    PARAMS,
  );
  await assertError(tagsBadItem, 400, 'EVIDENCE_INVALID');

  const tagsTooMany = await postEvidence(
    postRequest(`/api/v4life/cases/${CASE}/evidence`, evidenceCommand({
      commandId: 'cmd-bad-tags-3',
      payload: { summary: '摘要', tags: Array.from({ length: 21 }, (_, i) => `tag-${i}`) },
    })),
    PARAMS,
  );
  await assertError(tagsTooMany, 400, 'EVIDENCE_INVALID');

  const negativeAmount = await postEvidence(
    postRequest(`/api/v4life/cases/${CASE}/evidence`, evidenceCommand({
      commandId: 'cmd-negative-amount',
      payload: { summary: '摘要', tags: ['ok'], amountCny: -1 },
    })),
    PARAMS,
  );
  await assertError(negativeAmount, 400, 'EVIDENCE_INVALID');

  const longSummary = await postEvidence(
    postRequest(`/api/v4life/cases/${CASE}/evidence`, evidenceCommand({
      commandId: 'cmd-long-summary',
      payload: { summary: '长'.repeat(2001), tags: ['ok'] },
    })),
    PARAMS,
  );
  await assertError(longSummary, 400, 'EVIDENCE_INVALID');

  const badKind = await postEvidence(
    postRequest(`/api/v4life/cases/${CASE}/evidence`, evidenceCommand({ commandId: 'cmd-bad-kind', kind: 'gossip' })),
    PARAMS,
  );
  await assertError(badKind, 400, 'INVALID_ENGINE_INPUT');
});

test('POST evidence：非法 JSON body → 400 INVALID_JSON（防护对齐：显式区分 body 损坏与字段缺失）', async () => {
  resetV4LifeRuntime();
  const response = await postEvidence(
    postRequest(`/api/v4life/cases/${CASE}/evidence`, '{not-json'),
    PARAMS,
  );
  await assertError(response, 400, 'INVALID_JSON');
});

test('POST evidence：未知 caseId → 404 CASE_NOT_FOUND', async () => {
  resetV4LifeRuntime();
  const response = await postEvidence(
    postRequest('/api/v4life/cases/no-such-case/evidence', evidenceCommand()),
    { params: Promise.resolve({ caseId: 'no-such-case' }) },
  );
  await assertError(response, 404, 'CASE_NOT_FOUND');
});

// ---------------------------------------------------------------------------
// POST work
// ---------------------------------------------------------------------------

test('POST work：正常提交 200，无 Gate 项完成', async () => {
  resetV4LifeRuntime();
  const response = await postWork(postRequest(`/api/v4life/cases/${CASE}/work`, workCommand()), PARAMS);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.status, 'accepted');
  assert.equal(body.workItem.workItemId, 'WI-C1');
  assert.equal(body.workItem.status, 'completed', '无 Gate 项提交后直接完成');
  assert.equal(body.gate, undefined);
});

test('POST work：角色不符 → 403 ROLE_MISMATCH', async () => {
  resetV4LifeRuntime();
  const response = await postWork(
    postRequest(`/api/v4life/cases/${CASE}/work`, workCommand({
      commandId: 'cmd-work-role',
      actorId: 'actor-business-chen',
    })),
    PARAMS,
  );
  await assertError(response, 403, 'ROLE_MISMATCH');
});

test('POST work：blocked 项提交 → 409 WORK_ITEM_NOT_ACTIVE', async () => {
  resetV4LifeRuntime();
  const response = await postWork(
    postRequest(`/api/v4life/cases/${CASE}/work`, workCommand({
      commandId: 'cmd-work-c3',
      workItemId: 'WI-C3',
      outputSummary: '试图跳过硬等待。',
    })),
    PARAMS,
  );
  await assertError(response, 409, 'WORK_ITEM_NOT_ACTIVE');
});

test('POST work：未知工作项 → 404 WORK_ITEM_NOT_FOUND', async () => {
  resetV4LifeRuntime();
  const response = await postWork(
    postRequest(`/api/v4life/cases/${CASE}/work`, workCommand({
      commandId: 'cmd-work-unknown',
      workItemId: 'WI-NOPE',
    })),
    PARAMS,
  );
  await assertError(response, 404, 'WORK_ITEM_NOT_FOUND');
});

test('POST work：缺字段 → 400 INVALID_ENGINE_INPUT', async () => {
  resetV4LifeRuntime();
  const response = await postWork(
    postRequest(`/api/v4life/cases/${CASE}/work`, workCommand({ outputSummary: undefined })),
    PARAMS,
  );
  await assertError(response, 400, 'INVALID_ENGINE_INPUT');
});

// ---------------------------------------------------------------------------
// POST decisions
// ---------------------------------------------------------------------------

test('POST decisions：Gate 未开 → 409 GATE_NOT_OPEN', async () => {
  resetV4LifeRuntime();
  const response = await postDecision(
    postRequest(`/api/v4life/cases/${CASE}/decisions`, decisionCommand()),
    PARAMS,
  );
  await assertError(response, 409, 'GATE_NOT_OPEN');
});

test('POST decisions：角色不符 403 → approved 201 含 Receipt → 重复决定 409 GATE_ALREADY_DECIDED', async () => {
  resetV4LifeRuntime();
  await submitWorkP1();

  const wrongRole = await postDecision(
    postRequest(`/api/v4life/cases/${CASE}/decisions`, decisionCommand({
      commandId: 'cmd-dec-pg1-wrong-role',
      actorId: 'actor-credit-zhang',
    })),
    PARAMS,
  );
  await assertError(wrongRole, 403, 'ROLE_MISMATCH');

  const approve = await postDecision(
    postRequest(`/api/v4life/cases/${CASE}/decisions`, decisionCommand()),
    PARAMS,
  );
  assert.equal(approve.status, 201);
  assert.equal(approve.headers.get('cache-control'), 'no-store');
  const approveBody = await approve.json();
  assert.equal(approveBody.status, 'accepted');
  assert.ok(approveBody.receipt, 'approved 必须产生 Receipt');
  assert.equal(approveBody.receipt.gateId, 'PG-1');
  assert.equal(approveBody.receipt.decision.outcome, 'approved');
  assert.ok(approveBody.completedWorkItemIds.includes('WI-P1'), '批准后链接工作项完成');

  const replay = await postDecision(
    postRequest(`/api/v4life/cases/${CASE}/decisions`, decisionCommand()),
    PARAMS,
  );
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).status, 'replayed', '同 commandId 同载荷幂等重放优先于状态检查');

  const second = await postDecision(
    postRequest(`/api/v4life/cases/${CASE}/decisions`, decisionCommand({ commandId: 'cmd-dec-pg1-second' })),
    PARAMS,
  );
  await assertError(second, 409, 'GATE_ALREADY_DECIDED');
});

test('POST decisions：returned → 201 且 receipt=null、不发 Receipt、Gate 回到 pending、工作项回到 in_progress', async () => {
  resetV4LifeRuntime();
  await submitWorkP1();

  const engine = getOrCreateV4LifeDemoEngine();
  const response = await postDecision(
    postRequest(`/api/v4life/cases/${CASE}/decisions`, decisionCommand({
      commandId: 'cmd-dec-pg1-return',
      outcome: 'returned',
      reason: '政策依据引用不完整，退回补充。',
    })),
    PARAMS,
  );
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.status, 'accepted');
  assert.equal(body.receipt, null, '退回不发 Receipt');

  const projection = engine.getProjection();
  assert.equal(projection.receipts.length, 0, '退回后不得出现 Receipt');
  assert.equal(findGate(projection, 'PG-1').status, 'pending', '退回后 Gate 回到 pending');
  assert.equal(findWorkItem(projection, 'WI-P1').status, 'in_progress', '退回后工作项回到可继续状态');
});

test('POST decisions：非法 outcome / 缺字段 → 400 INVALID_ENGINE_INPUT', async () => {
  resetV4LifeRuntime();

  const badOutcome = await postDecision(
    postRequest(`/api/v4life/cases/${CASE}/decisions`, decisionCommand({
      commandId: 'cmd-dec-bad-outcome',
      outcome: 'maybe',
    })),
    PARAMS,
  );
  await assertError(badOutcome, 400, 'INVALID_ENGINE_INPUT');

  const missingReason = await postDecision(
    postRequest(`/api/v4life/cases/${CASE}/decisions`, decisionCommand({
      commandId: 'cmd-dec-missing-reason',
      reason: undefined,
    })),
    PARAMS,
  );
  await assertError(missingReason, 400, 'INVALID_ENGINE_INPUT');

  const longReason = await postDecision(
    postRequest(`/api/v4life/cases/${CASE}/decisions`, decisionCommand({
      commandId: 'cmd-dec-long-reason',
      reason: '长'.repeat(2001),
    })),
    PARAMS,
  );
  await assertError(longReason, 400, 'INVALID_ENGINE_INPUT');
});

// ---------------------------------------------------------------------------
// GET events 分页
// ---------------------------------------------------------------------------

test('GET events：afterSeq/limit 分页正确，hasMore 与 nextSeq 语义正确', async () => {
  resetV4LifeRuntime();
  const engine = getOrCreateV4LifeDemoEngine();
  const total = engine.rev;
  assert.ok(total >= 3, 'demo 初始化事件数应 ≥3');

  const page1 = await getEventsRoute(getRequest(`/api/v4life/cases/${CASE}/events?afterSeq=0&limit=2`), PARAMS);
  assert.equal(page1.status, 200);
  assert.equal(page1.headers.get('cache-control'), 'no-store');
  const page1Body = await page1.json();
  assert.equal(page1Body.events.length, 2);
  assert.equal(page1Body.events[0].seq, 1);
  assert.equal(page1Body.events[1].seq, 2);
  assert.equal(page1Body.hasMore, true);
  assert.equal(page1Body.nextSeq, total);

  const lastPage = await getEventsRoute(
    getRequest(`/api/v4life/cases/${CASE}/events?afterSeq=${total - 1}&limit=100`),
    PARAMS,
  );
  const lastBody = await lastPage.json();
  assert.equal(lastBody.events.length, 1);
  assert.equal(lastBody.events[0].seq, total);
  assert.equal(lastBody.hasMore, false);
  assert.equal(lastBody.nextSeq, total);

  const beyond = await getEventsRoute(getRequest(`/api/v4life/cases/${CASE}/events?afterSeq=${total}`), PARAMS);
  const beyondBody = await beyond.json();
  assert.equal(beyondBody.events.length, 0);
  assert.equal(beyondBody.hasMore, false);
  assert.equal(beyondBody.nextSeq, total);

  const all = await getEventsRoute(getRequest(`/api/v4life/cases/${CASE}/events?afterSeq=0`), PARAMS);
  const allBody = await all.json();
  assert.equal(allBody.events.length, total, '缺省 limit=100 应取回全部事件');
  assert.equal(allBody.hasMore, false);
});

test('GET events：非法 afterSeq / limit → 400 INVALID_ENGINE_INPUT', async () => {
  resetV4LifeRuntime();

  for (const query of [
    '?afterSeq=-1',
    '?afterSeq=abc',
    '?afterSeq=1.5',
    '?afterSeq=',
    '?afterSeq=0&limit=-2',
    '?afterSeq=0&limit=501',
    '?afterSeq=0&limit=abc',
  ]) {
    const response = await getEventsRoute(getRequest(`/api/v4life/cases/${CASE}/events${query}`), PARAMS);
    await assertError(response, 400, 'INVALID_ENGINE_INPUT');
  }
});

// ---------------------------------------------------------------------------
// runtime 测试隔离
// ---------------------------------------------------------------------------

test('injectV4LifeEngine：可替换运行时引擎实例，路由读到替换后的状态', async () => {
  resetV4LifeRuntime();
  const submitted = await postWork(postRequest(`/api/v4life/cases/${CASE}/work`, workCommand()), PARAMS);
  assert.equal(submitted.status, 200);

  const replacement = createV4LifeEngine(createV4LifeDemoSeed());
  injectV4LifeEngine(CASE, replacement);

  const response = await getCaseProjection(getRequest(`/api/v4life/cases/${CASE}`), PARAMS);
  assert.equal(response.status, 200);
  const projection = await response.json();
  assert.equal(findWorkItem(projection, 'WI-C1').status, 'in_progress', '替换后的引擎是全新种子状态：§11 初始证据即启动 WI-C1');
  assert.equal(projection.receipts.length, 0);
});

// ---------------------------------------------------------------------------
// 防护对齐（readJsonBody → readBoundedJsonBody）：资源类守卫显式 413/408，不再静默
// ---------------------------------------------------------------------------

test('POST evidence：声明 body 超过 1MB → 413 REQUEST_BODY_TOO_LARGE', async () => {
  resetV4LifeRuntime();
  const response = await postEvidence(
    new Request(`http://localhost/api/v4life/cases/${CASE}/evidence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(1_000_001),
    }),
    PARAMS,
  );
  await assertError(response, 413, 'REQUEST_BODY_TOO_LARGE');
});

test('POST evidence：chunked 无声明 body 超限 → 413（流式累计上限，不依赖 Content-Length）', async () => {
  resetV4LifeRuntime();
  const chunk = new Uint8Array(700_000).fill(0x78);
  let sent = false;
  const stream = new ReadableStream({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(chunk);
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
  });
  const response = await postEvidence(
    new Request(`http://localhost/api/v4life/cases/${CASE}/evidence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    }),
    PARAMS,
  );
  await assertError(response, 413, 'REQUEST_BODY_TOO_LARGE');
});
