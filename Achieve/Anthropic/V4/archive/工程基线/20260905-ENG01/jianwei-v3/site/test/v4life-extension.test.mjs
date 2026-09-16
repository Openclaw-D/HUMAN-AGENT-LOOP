// V4-LIFE Workspace 最小扩展测试（契约 docs/v4/CONTRACT.md §14.1/§14.2，2026-09-04 冻结）
// 覆盖：Projection.actors（§14.1：存在/seed 顺序/深克隆）、§14.2 四域正式承接链
//       （WI-B2/WI-A2/BG-1/AG-1 的初态硬等待、全链路 happy path 至 AG-1 Receipt、
//        PG-1 否决只停真实依赖项而 WI-B2/WI-A2 保持 blocked、贡献保留）、
//       全链路 replay 等价（rebuildProjection 与 getProjection deepEqual 忽略 generatedAt，actors 一致）。
// 运行：node --experimental-strip-types --test --experimental-test-isolation=none test/v4life-extension.test.mjs
// 隔离：每个用例独立 createV4LifeEngine(createV4LifeDemoSeed())，不共享可变状态。

import assert from 'node:assert/strict';
import test from 'node:test';

import { createV4LifeEngine } from '../lib/v4life/engine.ts';
import { createV4LifeDemoSeed } from '../lib/v4life/seed.ts';
import { rebuildProjection } from '../lib/v4life/replay.ts';

// ---------------------------------------------------------------------------
// 共享辅助
// ---------------------------------------------------------------------------

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

const CONTRACT_DRAFT = {
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

let commandCounter = 0;
function nextCommandId(label) {
  commandCounter += 1;
  return `cmd-ext-${label}-${commandCounter}`;
}

/** 固定测试时钟：单调、可复现（时间戳本身不参与断言，仅避免依赖真实时钟） */
function makeClock() {
  let ticks = 0;
  const base = Date.UTC(2030, 5, 1, 0, 0, 0);
  return () => new Date(base + (++ticks) * 1000).toISOString();
}

function freshEngine() {
  return createV4LifeEngine(createV4LifeDemoSeed(), { now: makeClock() });
}

function itemOf(engine, workItemId) {
  const projection = engine.getProjection();
  for (const domain of projection.domains) {
    const item = domain.workItems.find((entry) => entry.workItemId === workItemId);
    if (item !== undefined) {
      return item;
    }
  }
  throw new Error(`projection 中不存在工作项 ${workItemId}`);
}

function statusOf(engine, workItemId) {
  return itemOf(engine, workItemId).status;
}

function gateOf(engine, gateId) {
  const projection = engine.getProjection();
  for (const domain of projection.domains) {
    const gate = domain.gates.find((entry) => entry.gateId === gateId);
    if (gate !== undefined) {
      return gate;
    }
  }
  throw new Error(`projection 中不存在 Gate ${gateId}`);
}

function exportAllEvents(engine) {
  const collected = [];
  let afterSeq = 0;
  for (let guard = 0; guard < 1000; guard += 1) {
    const page = engine.getEvents(afterSeq, 500);
    collected.push(...page.events);
    if (!page.hasMore) break;
    afterSeq = collected[collected.length - 1].seq;
  }
  return collected;
}

function appendOk(engine, extra) {
  const result = engine.appendEvidence({
    commandId: nextCommandId('append'),
    expectedRev: engine.rev,
    ...extra,
  });
  assert.equal(result.status, 'accepted');
  return result;
}

function submitOk(engine, extra) {
  const result = engine.submitWork({
    commandId: nextCommandId('submit'),
    expectedRev: engine.rev,
    ...extra,
  });
  assert.equal(result.status, 'accepted');
  return result;
}

function decideOk(engine, extra) {
  const result = engine.recordDecision({
    commandId: nextCommandId('decide'),
    expectedRev: engine.rev,
    ...extra,
  });
  assert.equal(result.status, 'accepted');
  return result;
}

function stripGeneratedAt(projection) {
  const clone = structuredClone(projection);
  delete clone.generatedAt;
  return clone;
}

/** §14.2 全链路铺垫：财务+合同证据 → WI-C1/WI-C2/WI-B1/WI-A1 提交完成 → WI-P1 提交 → PG-1 approved */
function buildThroughPg1Approved(engine) {
  appendOk(engine, FINANCIAL);
  appendOk(engine, CONTRACT_DRAFT);
  submitOk(engine, { workItemId: 'WI-C1', actorId: ACTORS.credit, outputSummary: '信审材料完整性核验完成。' });
  submitOk(engine, { workItemId: 'WI-C2', actorId: ACTORS.credit, outputSummary: '客户偿付能力交叉核验完成。' });
  submitOk(engine, { workItemId: 'WI-B1', actorId: ACTORS.commerce, outputSummary: '商务方案与报价制式核对完成。' });
  submitOk(engine, { workItemId: 'WI-A1', actorId: ACTORS.asset, outputSummary: '同客户历史资产表现反馈整理完成。' });
  submitOk(engine, {
    workItemId: 'WI-P1',
    actorId: ACTORS.policy,
    outputSummary: '政策准入初核完成，提请政策准入 Gate。',
  });
  return decideOk(engine, {
    gateId: 'PG-1',
    actorId: ACTORS.policy,
    outcome: 'approved',
    reason: '行业不在禁入清单，额度在权限内；偿付缺口转入信审意见约束。',
  });
}

// ---------------------------------------------------------------------------
// §14.1 Projection.actors
// ---------------------------------------------------------------------------

test('§14.1｜Projection.actors 存在、顺序与内容同 seed 名册（5 个角色）', () => {
  const seed = createV4LifeDemoSeed();
  const engine = freshEngine();
  const projection = engine.getProjection();
  assert.ok(Array.isArray(projection.actors), 'actors 必须是数组');
  assert.equal(projection.actors.length, seed.actors.length);
  assert.deepEqual(projection.actors, structuredClone([...seed.actors]), '内容与顺序均同 seed');

  // replay 侧同样输出 seed 顺序 actors
  const rebuilt = rebuildProjection(seed, exportAllEvents(engine));
  assert.deepEqual(rebuilt.actors, structuredClone([...seed.actors]), 'rebuildProjection.actors 与 seed 一致');
});

test('§14.1｜actors 深克隆：篡改返回值不影响引擎与后续读取', () => {
  const engine = freshEngine();
  const tampered = engine.getProjection();
  tampered.actors[0].displayName = '被篡改的姓名';
  tampered.actors[0].role = 'system';
  tampered.actors.pop();
  tampered.actors.push({ actorId: 'actor-ghost', role: 'system', displayName: '幽灵' });

  const fresh = engine.getProjection();
  assert.equal(fresh.actors.length, 5, '外部 pop/push 不得污染 actor 名册');
  assert.equal(fresh.actors[0].actorId, 'actor-business-chen');
  assert.equal(fresh.actors[0].displayName, '陈经理（业务）');
  assert.equal(fresh.actors[0].role, 'business');
  assert.deepEqual(
    fresh.actors.map((actor) => actor.actorId),
    [
      'actor-business-chen',
      'actor-policy-li',
      'actor-credit-zhang',
      'actor-commerce-wang',
      'actor-asset-zhou',
    ],
    '篡改后引擎仍按真实名册输出',
  );

  // 篡改后引擎照常可推进：权限校验仍以真实名册为准
  submitOk(engine, { workItemId: 'WI-P1', actorId: ACTORS.policy, outputSummary: '初核完成，提请 Gate。' });
  assert.equal(statusOf(engine, 'WI-P1'), 'awaiting_gate');
  // 篡改注入的幽灵 actor 不被引擎接受
  assert.throws(
    () =>
      engine.appendEvidence({
        commandId: nextCommandId('ghost-ev'),
        expectedRev: engine.rev,
        evidenceId: 'ev-ghost',
        kind: 'supplement',
        title: '幽灵提交',
        submittedBy: 'actor-ghost',
        payload: { summary: '未知人提交', tags: [] },
      }),
    (error) => error instanceof Error && error.code === 'ACTOR_NOT_FOUND',
    '外部篡改无法把幽灵 actor 注入引擎名册',
  );
});

test('§14.1｜未知 actorId 仍 ACTOR_NOT_FOUND：actors 名册不扩大 authority 空间', () => {
  const engine = freshEngine();
  assert.throws(
    () =>
      engine.submitWork({
        commandId: nextCommandId('ghost-work'),
        expectedRev: engine.rev,
        workItemId: 'WI-P1',
        actorId: 'actor-ghost',
        outputSummary: '幽灵提交',
      }),
    (error) => error instanceof Error && error.code === 'ACTOR_NOT_FOUND',
    '不在 seed 名册中的 actorId 一律拒绝',
  );
});

// ---------------------------------------------------------------------------
// §14.2 初态硬等待
// ---------------------------------------------------------------------------

test('§14.2｜初态：WI-B2/WI-A2 双重等待（receipt 未决且前置 workitem 未完成）保持 blocked', () => {
  const engine = freshEngine();
  assert.equal(statusOf(engine, 'WI-B2'), 'blocked', 'CG-1 未决且 WI-B1 未完成 → WI-B2 等待');
  assert.equal(statusOf(engine, 'WI-A2'), 'blocked', 'BG-1 未决且 WI-A1 未完成 → WI-A2 等待');
  assert.equal(gateOf(engine, 'BG-1').status, 'pending');
  assert.equal(gateOf(engine, 'AG-1').status, 'pending');

  // 初始事件里只有 §11 的三域并行启动，不含 WI-B2/WI-A2
  const startedIds = exportAllEvents(engine)
    .filter((event) => event.payload.type === 'WORK_ITEM_STARTED')
    .map((event) => event.payload.workItemId)
    .sort();
  assert.deepEqual(startedIds, ['WI-A1', 'WI-C1', 'WI-P1'], '承接链项不得随初始 Context 提前启动');

  // 单独满足 workitem 依赖不解除等待：WI-B1/WI-A1 完成后仍须等各自 Receipt
  appendOk(engine, CONTRACT_DRAFT); // 启动 WI-B1
  submitOk(engine, { workItemId: 'WI-B1', actorId: ACTORS.commerce, outputSummary: '商务方案与报价制式核对完成。' });
  submitOk(engine, { workItemId: 'WI-A1', actorId: ACTORS.asset, outputSummary: '同客户历史资产表现反馈整理完成。' });
  assert.equal(statusOf(engine, 'WI-B1'), 'completed');
  assert.equal(statusOf(engine, 'WI-A1'), 'completed');
  assert.equal(statusOf(engine, 'WI-B2'), 'blocked', 'WI-B1 已完成但 CG-1 未决，WI-B2 仍等待');
  assert.equal(statusOf(engine, 'WI-A2'), 'blocked', 'WI-A1 已完成但 BG-1 未决，WI-A2 仍等待');

  // blocked 项直接提交 → WORK_ITEM_NOT_ACTIVE（§3 失败关闭）
  assert.throws(
    () =>
      engine.submitWork({
        commandId: nextCommandId('early-b2'),
        expectedRev: engine.rev,
        workItemId: 'WI-B2',
        actorId: ACTORS.commerce,
        outputSummary: '依赖未满足即提交',
      }),
    (error) => error instanceof Error && error.code === 'WORK_ITEM_NOT_ACTIVE',
  );
});

// ---------------------------------------------------------------------------
// §14.2 扩展 happy path：全链路至 AG-1 Receipt
// ---------------------------------------------------------------------------

test('§14.2｜扩展 happy path：PG-1 → CG-1 → BG-1 → AG-1 逐级 Receipt，WI-B2/WI-A2 由既有依赖机制自动启动', () => {
  const engine = freshEngine();

  // 财务+合同证据 → WI-C2 / WI-B1 启动
  appendOk(engine, FINANCIAL);
  assert.equal(statusOf(engine, 'WI-C2'), 'in_progress');
  appendOk(engine, CONTRACT_DRAFT);
  assert.equal(statusOf(engine, 'WI-B1'), 'in_progress');

  // WI-C1/WI-C2/WI-B1/WI-A1 提交完成（无 Gate 项 submitWork 即完成）
  submitOk(engine, { workItemId: 'WI-C1', actorId: ACTORS.credit, outputSummary: '信审材料完整性核验完成。' });
  submitOk(engine, { workItemId: 'WI-C2', actorId: ACTORS.credit, outputSummary: '客户偿付能力交叉核验完成。' });
  submitOk(engine, { workItemId: 'WI-B1', actorId: ACTORS.commerce, outputSummary: '商务方案与报价制式核对完成。' });
  submitOk(engine, { workItemId: 'WI-A1', actorId: ACTORS.asset, outputSummary: '同客户历史资产表现反馈整理完成。' });
  assert.equal(statusOf(engine, 'WI-C1'), 'completed');
  assert.equal(statusOf(engine, 'WI-C2'), 'completed');
  assert.equal(statusOf(engine, 'WI-B1'), 'completed');
  assert.equal(statusOf(engine, 'WI-A1'), 'completed');
  assert.equal(statusOf(engine, 'WI-C3'), 'blocked', 'C1/C2 完成不解除 PG-1 硬等待');
  assert.equal(statusOf(engine, 'WI-B2'), 'blocked');
  assert.equal(statusOf(engine, 'WI-A2'), 'blocked');

  // WI-P1 提交 → PG-1 open → approved：WI-C3 启动；WI-B2/WI-A2 不受影响
  submitOk(engine, {
    workItemId: 'WI-P1',
    actorId: ACTORS.policy,
    outputSummary: '政策准入初核完成，提请政策准入 Gate。',
  });
  assert.equal(itemOf(engine, 'WI-P1').status, 'awaiting_gate');
  assert.equal(gateOf(engine, 'PG-1').status, 'open');

  const pg1 = decideOk(engine, {
    gateId: 'PG-1',
    actorId: ACTORS.policy,
    outcome: 'approved',
    reason: '行业不在禁入清单，额度在权限内；偿付缺口转入信审意见约束。',
  });
  assert.equal(pg1.receipt?.receiptId, 'rcpt-PG-1-1', 'PG-1 approved 产生不可变 Receipt');
  assert.deepEqual(pg1.completedWorkItemIds, ['WI-P1']);
  assert.deepEqual(pg1.stoppedWorkItemIds, []);
  assert.equal(statusOf(engine, 'WI-P1'), 'completed');
  assert.equal(statusOf(engine, 'WI-C3'), 'in_progress', 'PG-1 Receipt ＋ C1/C2 完成 → WI-C3 启动');
  assert.equal(statusOf(engine, 'WI-B2'), 'blocked', 'CG-1 未决，WI-B2 继续等待');
  assert.equal(statusOf(engine, 'WI-A2'), 'blocked');

  // WI-C3 提交 → CG-1 open → approved：WI-C3 完成，WI-B2 自动启动（CG-1 approved ＋ WI-B1 completed）
  const c3Submitted = submitOk(engine, {
    workItemId: 'WI-C3',
    actorId: ACTORS.credit,
    outputSummary: '正式信审意见完成：金额 500 万、期限 24 个月，增加季度回款核验条件。',
  });
  assert.equal(itemOf(engine, 'WI-C3').status, 'awaiting_gate');
  assert.equal(c3Submitted.gate?.gateId, 'CG-1');
  assert.equal(gateOf(engine, 'CG-1').status, 'open');

  const cg1 = decideOk(engine, {
    gateId: 'CG-1',
    actorId: ACTORS.credit,
    outcome: 'approved',
    reason: '信审意见签发，附加回款核验条件。',
  });
  assert.equal(cg1.receipt?.receiptId, 'rcpt-CG-1-1');
  assert.deepEqual(cg1.completedWorkItemIds, ['WI-C3']);
  assert.deepEqual(cg1.stoppedWorkItemIds, []);
  assert.equal(statusOf(engine, 'WI-C3'), 'completed');
  assert.equal(statusOf(engine, 'WI-B2'), 'in_progress', 'CG-1 Receipt ＋ WI-B1 完成 → WI-B2 自动启动，引擎无需特判');
  assert.equal(statusOf(engine, 'WI-A2'), 'blocked', 'BG-1 未决，WI-A2 继续等待');

  // WI-B2 提交 → BG-1 open → approved：WI-B2 完成，WI-A2 自动启动（BG-1 approved ＋ WI-A1 completed）
  const b2Submitted = submitOk(engine, {
    workItemId: 'WI-B2',
    actorId: ACTORS.commerce,
    outputSummary: '商务条款确认与合同承接完成：付款节奏与违约条款按信审条件落入合同。',
  });
  assert.equal(itemOf(engine, 'WI-B2').status, 'awaiting_gate');
  assert.equal(b2Submitted.gate?.gateId, 'BG-1');
  assert.equal(gateOf(engine, 'BG-1').status, 'open');

  const bg1 = decideOk(engine, {
    gateId: 'BG-1',
    actorId: ACTORS.commerce,
    outcome: 'approved',
    reason: '商务条款与合同承接确认，按签批条件执行。',
  });
  assert.equal(bg1.receipt?.receiptId, 'rcpt-BG-1-1');
  assert.deepEqual(bg1.completedWorkItemIds, ['WI-B2']);
  assert.deepEqual(bg1.stoppedWorkItemIds, []);
  assert.equal(statusOf(engine, 'WI-B2'), 'completed');
  assert.equal(statusOf(engine, 'WI-A2'), 'in_progress', 'BG-1 Receipt ＋ WI-A1 完成 → WI-A2 自动启动');

  // WI-A2 提交 → AG-1 open → approved：全链路落成
  const a2Submitted = submitOk(engine, {
    workItemId: 'WI-A2',
    actorId: ACTORS.asset,
    outputSummary: '租赁物条件与贷后巡检计划确认完成：设备验收标准与巡检节奏落档。',
  });
  assert.equal(itemOf(engine, 'WI-A2').status, 'awaiting_gate');
  assert.equal(a2Submitted.gate?.gateId, 'AG-1');
  assert.equal(gateOf(engine, 'AG-1').status, 'open');

  const ag1 = decideOk(engine, {
    gateId: 'AG-1',
    actorId: ACTORS.asset,
    outcome: 'approved',
    reason: '租赁物条件与贷后巡检计划确认通过。',
  });
  assert.equal(ag1.receipt?.receiptId, 'rcpt-AG-1-1', 'Golden Case happy path 延伸至 AG-1 Receipt');
  assert.deepEqual(ag1.completedWorkItemIds, ['WI-A2']);
  assert.deepEqual(ag1.stoppedWorkItemIds, []);
  assert.equal(statusOf(engine, 'WI-A2'), 'completed');

  // 终态：8 个工作项全部完成；4 条 Receipt 按 PG-1/CG-1/BG-1/AG-1 顺序留痕；无 open Gate
  const projection = engine.getProjection();
  assert.deepEqual(
    projection.domains.flatMap((domain) => domain.workItems.map((item) => `${item.workItemId}=${item.status}`)),
    [
      'WI-P1=completed',
      'WI-C1=completed',
      'WI-C2=completed',
      'WI-C3=completed',
      'WI-B1=completed',
      'WI-B2=completed',
      'WI-A1=completed',
      'WI-A2=completed',
    ],
    '四域正式承接链全部完成',
  );
  assert.deepEqual(
    projection.receipts.map((receipt) => receipt.receiptId),
    ['rcpt-PG-1-1', 'rcpt-CG-1-1', 'rcpt-BG-1-1', 'rcpt-AG-1-1'],
  );
  assert.deepEqual(projection.openGates, []);
  for (const gateId of ['PG-1', 'CG-1', 'BG-1', 'AG-1']) {
    assert.equal(gateOf(engine, gateId).status, 'decided');
  }
  // 每次提交留痕贡献（8 次 submitWork），且否决后保留语义字段恒真
  assert.equal(projection.contributions.length, 8);
  for (const contribution of projection.contributions) {
    assert.equal(contribution.retainedAfterVeto, true);
  }
});

// ---------------------------------------------------------------------------
// §14.2 否决传播：只停真实依赖项
// ---------------------------------------------------------------------------

test('§14.2｜否决传播：PG-1 rejected → WI-C3 stopped_dependency；WI-B2/WI-A2 保持 blocked；WI-B1/WI-A1 贡献保留', () => {
  const engine = freshEngine();
  appendOk(engine, FINANCIAL);
  appendOk(engine, CONTRACT_DRAFT);
  submitOk(engine, { workItemId: 'WI-C1', actorId: ACTORS.credit, outputSummary: '信审材料完整性核验完成。' });
  submitOk(engine, { workItemId: 'WI-B1', actorId: ACTORS.commerce, outputSummary: '商务方案与报价制式核对完成。' });
  submitOk(engine, { workItemId: 'WI-A1', actorId: ACTORS.asset, outputSummary: '同客户历史资产表现反馈整理完成。' });
  submitOk(engine, {
    workItemId: 'WI-P1',
    actorId: ACTORS.policy,
    outputSummary: '政策准入初核完成，提请政策准入 Gate。',
  });

  const rejected = decideOk(engine, {
    gateId: 'PG-1',
    actorId: ACTORS.policy,
    outcome: 'rejected',
    reason: '营收持续下滑且经营现金流为负，不符合现行小微准入政策要求。',
  });
  assert.ok(rejected.receipt !== null, '否决产生不可变 Receipt');
  assert.equal(rejected.receipt.gateId, 'PG-1');
  assert.equal(rejected.receipt.decision.outcome, 'rejected');
  assert.deepEqual(rejected.stoppedWorkItemIds, ['WI-C3'], '否决只级联真实依赖 PG-1 Receipt 的 blocked 项');

  assert.equal(statusOf(engine, 'WI-C3'), 'stopped_dependency');
  assert.equal(
    statusOf(engine, 'WI-B2'),
    'blocked',
    'WI-B2 的 receipt 依赖是 CG-1 而非 PG-1：未被否决、只是未满足 → 保持 blocked',
  );
  assert.equal(
    statusOf(engine, 'WI-A2'),
    'blocked',
    'WI-A2 的 receipt 依赖是 BG-1 而非 PG-1：未被否决、只是未满足 → 保持 blocked',
  );
  assert.equal(statusOf(engine, 'WI-B1'), 'completed', '已完成工作不回滚');
  assert.equal(statusOf(engine, 'WI-A1'), 'completed');
  assert.equal(gateOf(engine, 'CG-1').status, 'pending', '未决 Gate 不受上游否决影响');
  assert.equal(gateOf(engine, 'BG-1').status, 'pending');
  assert.equal(gateOf(engine, 'AG-1').status, 'pending');

  // WI-B1/WI-A1 已完成贡献保留
  const contributions = engine.getProjection().contributions;
  const b1 = contributions.find((entry) => entry.workItemId === 'WI-B1');
  const a1 = contributions.find((entry) => entry.workItemId === 'WI-A1');
  assert.ok(b1 !== undefined, 'WI-B1 贡献保留');
  assert.ok(a1 !== undefined, 'WI-A1 贡献保留');
  assert.equal(b1.retainedAfterVeto, true);
  assert.equal(a1.retainedAfterVeto, true);

  // 否决后补充材料：WI-C3 不复活，WI-B2/WI-A2 仍只是等待
  appendOk(engine, {
    evidenceId: 'ev-supplement-1',
    kind: 'supplement',
    title: '补充经营现金流说明',
    submittedBy: ACTORS.business,
    payload: { summary: '补充材料。', tags: ['supplement'] },
  });
  assert.equal(statusOf(engine, 'WI-C3'), 'stopped_dependency', '补充材料不得绕过否决级联');
  assert.equal(statusOf(engine, 'WI-B2'), 'blocked');
  assert.equal(statusOf(engine, 'WI-A2'), 'blocked');
});

// ---------------------------------------------------------------------------
// §14.2 replay 等价（含 actors）
// ---------------------------------------------------------------------------

test('§14.2｜replay 等价：全链路事件 rebuildProjection 与 getProjection deepEqual（忽略 generatedAt），actors 一致', () => {
  const seed = createV4LifeDemoSeed();
  const engine = freshEngine();

  // 走完 §11＋§14.2 全链路至 AG-1 Receipt
  buildThroughPg1Approved(engine);
  submitOk(engine, {
    workItemId: 'WI-C3',
    actorId: ACTORS.credit,
    outputSummary: '正式信审意见完成：金额 500 万、期限 24 个月，增加季度回款核验条件。',
  });
  decideOk(engine, {
    gateId: 'CG-1',
    actorId: ACTORS.credit,
    outcome: 'approved',
    reason: '信审意见签发，附加回款核验条件。',
  });
  submitOk(engine, {
    workItemId: 'WI-B2',
    actorId: ACTORS.commerce,
    outputSummary: '商务条款确认与合同承接完成。',
  });
  decideOk(engine, {
    gateId: 'BG-1',
    actorId: ACTORS.commerce,
    outcome: 'approved',
    reason: '商务条款与合同承接确认。',
  });
  submitOk(engine, {
    workItemId: 'WI-A2',
    actorId: ACTORS.asset,
    outputSummary: '租赁物条件与贷后巡检计划确认完成。',
  });
  decideOk(engine, {
    gateId: 'AG-1',
    actorId: ACTORS.asset,
    outcome: 'approved',
    reason: '租赁物条件与贷后巡检计划确认通过。',
  });

  const events = exportAllEvents(engine);
  assert.ok(events.length >= 30, `全链路事件应足够丰富，实际 ${events.length}`);
  const live = engine.getProjection();
  const rebuilt = rebuildProjection(seed, events);

  assert.equal(rebuilt.rev, events.length);
  assert.equal(rebuilt.eventCount, events.length);
  assert.equal(rebuilt.rev, live.rev);
  assert.deepEqual(rebuilt.actors, live.actors, 'actors 在重放侧与在线侧一致（seed 顺序）');
  assert.deepEqual(
    stripGeneratedAt(rebuilt),
    stripGeneratedAt(live),
    '扩展后全链路重放必须与在线引擎 deepEqual（忽略 generatedAt）',
  );

  // 显式传入 generatedAt 时整体相等
  const rebuiltWithStamp = rebuildProjection(seed, events, live.generatedAt);
  assert.deepEqual(rebuiltWithStamp, live);
});
