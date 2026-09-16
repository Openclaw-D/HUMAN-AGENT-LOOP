#!/usr/bin/env node
// v4life HTTP quality 脚本（Lane D）
//
// 【进程内执行，不依赖网络服务】本脚本不启动 HTTP 服务、不 fetch 任何网络地址：
// 直接 import lib/v4life/runtime 与 app/api/v4life 的 Route Handler，
// 以进程内 new Request(...) 调用 handler 函数完成全部场景。
//
// 场景顺序：
//   S1 健康路径：契约 §11 fixture 全链路（初始 Evidence → 财务/合同 → C1/C2/P1 → PG-1 approved → C3 → CG-1 approved）
//   S2 失败矩阵：404 / 400 / 403（work+decision 越权）/ 409（乱序、VERSION_CONFLICT、EVIDENCE_CONFLICT、IDEMPOTENCY_CONFLICT）
//   S3 幂等重放一致性：同 commandId 双发（decision 与 evidence）→ 201/200 replayed，事件与 Projection 不变
//
// 逐项 assert，输出 PASS n / FAIL n 明细；存在失败时进程退出码为 1。
// 运行：node scripts/v4life-http-quality.mjs

import assert from 'node:assert/strict';

import { resetV4LifeRuntime, getV4LifeEngine, V4LIFE_DEMO_CASE_ID } from '../lib/v4life/runtime.ts';
import { GET as caseGET } from '../app/api/v4life/cases/[caseId]/route.ts';
import { POST as evidencePOST } from '../app/api/v4life/cases/[caseId]/evidence/route.ts';
import { POST as workPOST } from '../app/api/v4life/cases/[caseId]/work/route.ts';
import { POST as decisionsPOST } from '../app/api/v4life/cases/[caseId]/decisions/route.ts';
import { GET as eventsGET } from '../app/api/v4life/cases/[caseId]/events/route.ts';

const CASE_ID = V4LIFE_DEMO_CASE_ID;

const ACTORS = {
  business: 'actor-business-chen',
  policy: 'actor-policy-li',
  credit: 'actor-credit-zhang',
  commerce: 'actor-commerce-wang',
  asset: 'actor-asset-zhou',
};

const FINANCIAL = {
  evidenceId: 'ev-financial-statement',
  kind: 'financial_statement',
  title: '2025 年度审计报告摘要',
  submittedBy: ACTORS.business,
  payload: {
    summary: '营收同比下滑约 18%，经营现金流为负，账面货币资金约 320 万元。',
    tags: ['revenue_declining', 'audited'],
  },
};

const CONTRACT = {
  evidenceId: 'ev-contract-draft',
  kind: 'contract_draft',
  title: '设备采购与流动资金借款合同草案',
  submittedBy: ACTORS.business,
  payload: {
    summary: '借款金额 500 万元，期限 24 个月，按季度付息。',
    amountCny: 5_000_000,
    tags: ['draft'],
  },
};

// ---------------------------------------------------------------------------
// 结果收集
// ---------------------------------------------------------------------------

let passCount = 0;
let failCount = 0;
const failures = [];

async function step(name, fn) {
  try {
    await fn();
    passCount += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failCount += 1;
    const message = (error && error.message) ? error.message.split('\n').join(' | ') : String(error);
    failures.push({ name, message });
    console.log(`FAIL  ${name}`);
    console.log(`      -> ${message}`);
  }
}

// ---------------------------------------------------------------------------
// 进程内 HTTP 辅助（不启动服务，直接调用 Route Handler 函数）
// ---------------------------------------------------------------------------

function caseUrl(caseId = CASE_ID, suffix = '') {
  return `https://in-process.test/api/v4life/cases/${encodeURIComponent(caseId)}${suffix}`;
}

function ctx(caseId = CASE_ID) {
  return { params: Promise.resolve({ caseId }) };
}

function jsonRequest(url, body) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getProjection(caseId = CASE_ID) {
  const response = await caseGET(new Request(caseUrl(caseId)), ctx(caseId));
  assert.equal(response.status, 200, `GET projection 应 200，实际 ${response.status}`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json();
}

async function getRev() {
  return (await getProjection()).rev;
}

async function postEvidence(body, caseId = CASE_ID) {
  return evidencePOST(jsonRequest(caseUrl(caseId, '/evidence'), body), ctx(caseId));
}

async function postWork(body) {
  return workPOST(jsonRequest(caseUrl(CASE_ID, '/work'), body), ctx());
}

async function postDecision(body) {
  return decisionsPOST(jsonRequest(caseUrl(CASE_ID, '/decisions'), body), ctx());
}

async function assertError(response, status, code) {
  assert.equal(response.status, status, `期望 ${code}，实际 HTTP ${response.status}`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: code });
}

function stripGeneratedAt(projection) {
  const clone = structuredClone(projection);
  delete clone.generatedAt;
  return clone;
}

function getItem(projection, workItemId) {
  for (const domain of projection.domains) {
    const hit = domain.workItems.find((entry) => entry.workItemId === workItemId);
    if (hit !== undefined) return hit;
  }
  throw new Error(`unknown work item ${workItemId}`);
}

// 推进到 PG-1 open（financial+contract → C1/C2 完成 → P1 提交），返回最后响应体。
async function driveToGateOpen() {
  let rev = await getRev();
  let response = await postEvidence({ commandId: 'q-ev-fin', expectedRev: rev, ...FINANCIAL });
  assert.equal(response.status, 201);
  let body = await response.json();
  response = await postEvidence({ commandId: 'q-ev-con', expectedRev: body.rev, ...CONTRACT });
  assert.equal(response.status, 201);
  body = await response.json();
  for (const [workItemId, actorId, summary, commandId] of [
    ['WI-C1', ACTORS.credit, '完整性核验完成。', 'q-w-c1'],
    ['WI-C2', ACTORS.credit, '偿付能力交叉核验完成。', 'q-w-c2'],
    ['WI-P1', ACTORS.policy, '政策准入初核完成，提请 Gate。', 'q-w-p1'],
  ]) {
    response = await postWork({ commandId, expectedRev: body.rev, workItemId, actorId, outputSummary: summary });
    assert.equal(response.status, 200, `${workItemId} 提交应成功`);
    body = await response.json();
  }
  return body;
}

// ---------------------------------------------------------------------------
// S1 健康路径
// ---------------------------------------------------------------------------

async function scenarioHealthyPath() {
  await step('S1.01 reset 后 runtime 为空，GET projection 按需创建 demo engine', async () => {
    resetV4LifeRuntime();
    assert.equal(getV4LifeEngine(CASE_ID), undefined, 'reset 后不得残留引擎实例');
    const projection = await getProjection();
    assert.equal(projection.case.caseId, CASE_ID);
    assert.ok(getV4LifeEngine(CASE_ID) !== undefined, 'GET 后应创建引擎');
  });

  await step('S1.02 Projection domains 固定顺序 policy/credit/commerce/asset，初始 Evidence 触发 R2', async () => {
    const projection = await getProjection();
    assert.deepEqual(projection.domains.map((domain) => domain.domain), ['policy', 'credit', 'commerce', 'asset']);
    const credit = projection.domains.find((domain) => domain.domain === 'credit');
    assert.ok(credit.candidates.some((candidate) => candidate.kind === 'missing_document'));
    for (const candidate of credit.candidates) assert.equal(candidate.authority, 'none');
    assert.equal(getItem(projection, 'WI-P1').status, 'in_progress');
    assert.equal(getItem(projection, 'WI-C1').status, 'in_progress');
    assert.equal(getItem(projection, 'WI-A1').status, 'in_progress');
    assert.equal(getItem(projection, 'WI-C3').status, 'blocked');
  });

  let body;
  await step('S1.03 POST evidence 财务报表 → 201 accepted', async () => {
    const response = await postEvidence({ commandId: 'h-ev-fin', expectedRev: await getRev(), ...FINANCIAL });
    assert.equal(response.status, 201);
    body = await response.json();
    assert.equal(body.status, 'accepted');
  });

  await step('S1.04 POST evidence 合同草案 → 201 accepted；R1 矛盾 Candidate 出现（authority=none）', async () => {
    const response = await postEvidence({ commandId: 'h-ev-con', expectedRev: body.rev, ...CONTRACT });
    assert.equal(response.status, 201);
    body = await response.json();
    const projection = await getProjection();
    const contradiction = projection.domains
      .find((domain) => domain.domain === 'credit')
      .candidates.find((candidate) => candidate.kind === 'contradiction');
    assert.ok(contradiction !== undefined, 'financial+contract 应触发 R1');
    assert.equal(contradiction.authority, 'none');
    assert.equal(getItem(projection, 'WI-C2').status, 'in_progress');
    assert.equal(getItem(projection, 'WI-B1').status, 'in_progress');
  });

  await step('S1.05 POST work WI-C1/WI-C2 完成（无 Gate 项直接 completed）', async () => {
    for (const [workItemId, summary, commandId] of [
      ['WI-C1', '完整性核验完成。', 'h-w-c1'],
      ['WI-C2', '偿付能力交叉核验完成。', 'h-w-c2'],
    ]) {
      const response = await postWork({ commandId, expectedRev: body.rev, workItemId, actorId: ACTORS.credit, outputSummary: summary });
      assert.equal(response.status, 200);
      body = await response.json();
      assert.equal(body.workItem.status, 'completed');
    }
    const projection = await getProjection();
    assert.equal(getItem(projection, 'WI-C3').status, 'blocked', '信审签批硬等待 PG-1 Receipt');
  });

  await step('S1.06 POST work WI-P1 → awaiting_gate，PG-1 open', async () => {
    const response = await postWork({
      commandId: 'h-w-p1', expectedRev: body.rev, workItemId: 'WI-P1',
      actorId: ACTORS.policy, outputSummary: '政策准入初核完成，提请 Gate。',
    });
    assert.equal(response.status, 200);
    body = await response.json();
    assert.equal(body.workItem.status, 'awaiting_gate');
    assert.ok(body.gate !== undefined);
    assert.equal(body.gate.status, 'open');
  });

  await step('S1.07 POST decision PG-1 approved → 201，产生 Receipt，WI-C3 启动', async () => {
    const response = await postDecision({
      commandId: 'h-dec-pg1', expectedRev: body.rev, gateId: 'PG-1',
      actorId: ACTORS.policy, outcome: 'approved', reason: '行业不在禁入清单，准入通过。',
    });
    assert.equal(response.status, 201);
    body = await response.json();
    assert.ok(body.receipt !== null && body.receipt !== undefined, '批准必须产生 Receipt');
    const projection = await getProjection();
    assert.equal(getItem(projection, 'WI-C3').status, 'in_progress', 'Receipt 依赖满足 + C1/C2 完成 → C3 启动');
  });

  await step('S1.08 POST work WI-C3 → awaiting_gate，CG-1 open', async () => {
    const response = await postWork({
      commandId: 'h-w-c3', expectedRev: body.rev, workItemId: 'WI-C3',
      actorId: ACTORS.credit, outputSummary: '正式信审意见完成。',
    });
    assert.equal(response.status, 200);
    body = await response.json();
    assert.equal(body.workItem.status, 'awaiting_gate');
    assert.equal(body.gate.gateId, 'CG-1');
  });

  await step('S1.09 POST decision CG-1 approved → 201，WI-C3 completed，Receipts 共 2 张', async () => {
    const response = await postDecision({
      commandId: 'h-dec-cg1', expectedRev: body.rev, gateId: 'CG-1',
      actorId: ACTORS.credit, outcome: 'approved', reason: '信审意见签发，附加回款核验条件。',
    });
    assert.equal(response.status, 201);
    body = await response.json();
    assert.ok(body.receipt !== null);
    const projection = await getProjection();
    assert.equal(getItem(projection, 'WI-C3').status, 'completed');
    assert.equal(projection.receipts.length, 2);
    assert.ok(projection.contributions.length >= 3, 'C1/C2/C3 贡献留痕');
    for (const contribution of projection.contributions) {
      assert.equal(contribution.retainedAfterVeto, true);
    }
  });

  await step('S1.10 事件分页完整走通：每页截断正确、hasMore 收敛为 false、拼接总数 === eventCount、seq 连续', async () => {
    const projection = await getProjection();
    const collected = [];
    let afterSeq = 0;
    for (let guard = 0; guard < 1000; guard += 1) {
      const response = await eventsGET(
        new Request(caseUrl(CASE_ID, `/events?afterSeq=${afterSeq}&limit=2`)),
        ctx(),
      );
      assert.equal(response.status, 200);
      const page = await response.json();
      assert.equal(typeof page.hasMore, 'boolean', 'hasMore 必须是布尔值（契约 §7）');
      if (page.hasMore) {
        assert.equal(page.events.length, 2, 'limit=2 时每页必须恰好截断为 2 条');
      }
      collected.push(...page.events);
      if (!page.hasMore) {
        assert.equal(page.nextSeq, projection.eventCount);
        break;
      }
      assert.ok(page.events.length > 0, 'hasMore=true 时不得返回空页');
      afterSeq = collected[collected.length - 1].seq;
    }
    assert.equal(collected.length, projection.eventCount);
    for (let index = 0; index < collected.length; index += 1) {
      assert.equal(collected[index].seq, index + 1);
    }
  });
}

// ---------------------------------------------------------------------------
// S2 失败矩阵
// ---------------------------------------------------------------------------

async function scenarioFailureMatrix() {
  await step('S2.01 reset 后：404 CASE_NOT_FOUND（GET 未知 case）', async () => {
    resetV4LifeRuntime();
    await assertError(
      await caseGET(new Request(caseUrl('unknown-case')), ctx('unknown-case')),
      404, 'CASE_NOT_FOUND',
    );
  });

  await step('S2.02 404 CASE_NOT_FOUND（POST evidence 未知 case）', async () => {
    await assertError(
      await postEvidence({ commandId: 'f-404', expectedRev: 0, ...FINANCIAL }, 'unknown-case'),
      404, 'CASE_NOT_FOUND',
    );
  });

  await step('S2.03 400 INVALID_ENGINE_INPUT（commandId 为空）', async () => {
    await getProjection(); // 确保 demo engine 已创建
    await assertError(
      await postEvidence({ commandId: '', expectedRev: await getRev(), ...FINANCIAL }),
      400, 'INVALID_ENGINE_INPUT',
    );
  });

  await step('S2.04 409 WORK_ITEM_NOT_ACTIVE（blocked 的 WI-C3 直接提交）', async () => {
    await assertError(
      await postWork({
        commandId: 'f-c3', expectedRev: await getRev(), workItemId: 'WI-C3',
        actorId: ACTORS.credit, outputSummary: '绕过硬等待',
      }),
      409, 'WORK_ITEM_NOT_ACTIVE',
    );
  });

  await step('S2.05 403 ROLE_MISMATCH（submitWork：WI-C1 用 policy 角色提交）', async () => {
    await assertError(
      await postWork({
        commandId: 'f-role-work', expectedRev: await getRev(), workItemId: 'WI-C1',
        actorId: ACTORS.policy, outputSummary: '越权提交',
      }),
      403, 'ROLE_MISMATCH',
    );
  });

  await step('S2.06 409 GATE_NOT_OPEN（PG-1 未开即决定）', async () => {
    await assertError(
      await postDecision({
        commandId: 'f-open', expectedRev: await getRev(), gateId: 'PG-1',
        actorId: ACTORS.policy, outcome: 'approved', reason: 'Gate 未开即决定',
      }),
      409, 'GATE_NOT_OPEN',
    );
  });

  await step('S2.07 推进到 PG-1 open（健康提交）', async () => {
    await driveToGateOpen();
  });

  await step('S2.08 403 ROLE_MISMATCH（recordDecision：PG-1 用 credit 角色决定）', async () => {
    await assertError(
      await postDecision({
        commandId: 'f-role-dec', expectedRev: await getRev(), gateId: 'PG-1',
        actorId: ACTORS.credit, outcome: 'approved', reason: '越权决定',
      }),
      403, 'ROLE_MISMATCH',
    );
  });

  // 竞争对使用全新 evidenceId：FINANCIAL/CONTRACT 已由 driveToGateOpen 提交，
  // 契约 §6 自然键语义下同 id 同载荷重发是 replay（200），不是新的 accepted（201）。
  const RACE_A = {
    evidenceId: 'ev-supp-race-a', kind: 'supplement', title: '经营现金流补充说明（竞争对 A）',
    submittedBy: ACTORS.business, payload: { summary: '补充近 6 个月回款流水说明。', tags: ['supplement'] },
  };
  const RACE_B = {
    evidenceId: 'ev-supp-race-b', kind: 'supplement', title: '设备采购背景补充（竞争对 B）',
    submittedBy: ACTORS.business, payload: { summary: '补充设备采购背景与订单意向。', tags: ['supplement'] },
  };

  await step('S2.09 409 VERSION_CONFLICT（两命令同一 expectedRev，第一条接受后第二条被拒）', async () => {
    const staleRev = await getRev();
    const first = await postEvidence({ commandId: 'f-race-a', expectedRev: staleRev, ...RACE_A });
    assert.equal(first.status, 201);
    await assertError(
      await postEvidence({ commandId: 'f-race-b', expectedRev: staleRev, ...RACE_B }),
      409, 'VERSION_CONFLICT',
    );
  });

  await step('S2.10 409 IDEMPOTENCY_CONFLICT（同 commandId 异载荷）', async () => {
    await assertError(
      await postEvidence({ commandId: 'f-race-a', expectedRev: await getRev(), ...RACE_B }),
      409, 'IDEMPOTENCY_CONFLICT',
    );
  });

  await step('S2.11 409 EVIDENCE_CONFLICT（同 evidenceId 异载荷，不同 commandId）', async () => {
    await assertError(
      await postEvidence({
        commandId: 'f-ev-forge', expectedRev: await getRev(),
        evidenceId: FINANCIAL.evidenceId, kind: FINANCIAL.kind,
        title: '被篡改的审计报告', submittedBy: ACTORS.business,
        payload: { summary: '同 id 异载荷', tags: ['forged'] },
      }),
      409, 'EVIDENCE_CONFLICT',
    );
  });

  await step('S2.12 失败后可恢复：修正 expectedRev 的合法命令仍被接受（失败关闭非永久卡死）', async () => {
    // CONTRACT 已在 S2.07 提交过，同内容重发按 §6 是 replay；恢复验证改用全新 supplement。
    const response = await postEvidence({
      commandId: 'f-recover', expectedRev: await getRev(),
      evidenceId: 'ev-supp-recover', kind: 'supplement', title: '失败关闭后恢复补充',
      submittedBy: ACTORS.business, payload: { summary: '失败关闭后按新 rev 恢复提交。', tags: ['supplement'] },
    });
    assert.equal(response.status, 201);
  });
}

// ---------------------------------------------------------------------------
// S3 幂等重放一致性
// ---------------------------------------------------------------------------

async function scenarioIdempotentReplay() {
  await step('S3.01 reset 后推进到 PG-1 open', async () => {
    resetV4LifeRuntime();
    await driveToGateOpen();
  });

  let snapshotBefore;
  let firstBody;
  await step('S3.02 POST decision PG-1 approved（首次）→ 201 accepted，记录快照', async () => {
    const response = await postDecision({
      commandId: 'q-idem-dec', expectedRev: await getRev(), gateId: 'PG-1',
      actorId: ACTORS.policy, outcome: 'approved', reason: '准入通过。',
    });
    assert.equal(response.status, 201);
    firstBody = await response.json();
    assert.ok(firstBody.receipt !== null);
    snapshotBefore = await getProjection();
  });

  await step('S3.03 同 commandId 重发 decision → 200 replayed，Receipt 一致，Projection 与事件数不变', async () => {
    const response = await postDecision({
      commandId: 'q-idem-dec', expectedRev: await getRev(), gateId: 'PG-1',
      actorId: ACTORS.policy, outcome: 'approved', reason: '准入通过。',
    });
    assert.equal(response.status, 200, 'replay 返回 200');
    const replayBody = await response.json();
    assert.equal(replayBody.status, 'replayed');
    assert.equal(replayBody.rev, firstBody.rev, 'replay 的 rev 为原接受时的 rev');
    assert.deepEqual(replayBody.receipt, firstBody.receipt, 'replay 返回原 Receipt');
    const snapshotAfter = await getProjection();
    assert.deepEqual(stripGeneratedAt(snapshotAfter), stripGeneratedAt(snapshotBefore), '重放后 Projection 不变');
  });

  let evFirstBody;
  await step('S3.04 POST evidence 补充材料（首次）→ 201 accepted', async () => {
    // CONTRACT 已由 S3.01 driveToGateOpen 提交，幂等重放验证改用全新 evidenceId。
    const response = await postEvidence({
      commandId: 'q-idem-ev', expectedRev: await getRev(),
      evidenceId: 'ev-supp-idem', kind: 'supplement', title: '幂等重放验证补充',
      submittedBy: ACTORS.business, payload: { summary: '用于验证同 commandId 重放一致性。', tags: ['supplement'] },
    });
    assert.equal(response.status, 201);
    evFirstBody = await response.json();
    assert.equal(evFirstBody.status, 'accepted');
  });

  await step('S3.05 同 commandId 重发 evidence → 200 replayed，Evidence 一致，事件总数不变', async () => {
    const before = await getProjection();
    const response = await postEvidence({
      commandId: 'q-idem-ev', expectedRev: await getRev(),
      evidenceId: 'ev-supp-idem', kind: 'supplement', title: '幂等重放验证补充',
      submittedBy: ACTORS.business, payload: { summary: '用于验证同 commandId 重放一致性。', tags: ['supplement'] },
    });
    assert.equal(response.status, 200, 'evidence replay 返回 200');
    const replayBody = await response.json();
    assert.equal(replayBody.status, 'replayed');
    assert.equal(replayBody.rev, evFirstBody.rev);
    assert.deepEqual(replayBody.evidence, evFirstBody.evidence);
    const after = await getProjection();
    assert.equal(after.eventCount, before.eventCount, '重放不追加事件');
    assert.deepEqual(stripGeneratedAt(after), stripGeneratedAt(before));
  });
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

console.log('== v4life HTTP quality（进程内执行，不依赖网络服务）==');
console.log(`caseId: ${CASE_ID}`);
console.log('');

await scenarioHealthyPath();
console.log('');
await scenarioFailureMatrix();
console.log('');
await scenarioIdempotentReplay();

console.log('');
console.log(`== 结果：PASS ${passCount} / FAIL ${failCount} ==`);
if (failCount > 0) {
  console.log('失败明细：');
  for (const failure of failures) {
    console.log(`  - ${failure.name}: ${failure.message}`);
  }
  process.exitCode = 1;
} else {
  process.exitCode = 0;
}
