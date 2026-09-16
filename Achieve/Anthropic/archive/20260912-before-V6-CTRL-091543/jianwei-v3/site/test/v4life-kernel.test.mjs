// V4-LIFE 内核测试（契约 docs/v4/CONTRACT.md §2/§3/§5/§6/§7/§11/§12）
// 覆盖：四个核心证明点、命令幂等（commandId）、自然键冲突（evidenceId）、版本竞争（expectedRev）、
//       确定性 Candidate（R1/R2/dedupeKey/authority=none）、退回重做、深克隆、事件分页、时钟注入。
// 运行：node --experimental-strip-types --test --experimental-test-isolation=none test/v4life-kernel.test.mjs
// 隔离：每个用例独立 createV4LifeEngine(createV4LifeDemoSeed())，不共享可变状态。

import assert from 'node:assert/strict';
import test from 'node:test';

import { createV4LifeEngine, V4LifeError } from '../lib/v4life/engine.ts';
import { createV4LifeDemoSeed, V4LIFE_DEMO_CASE_ID } from '../lib/v4life/seed.ts';

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
  return `cmd-kernel-${label}-${commandCounter}`;
}

function expectCode(operation, code) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof V4LifeError);
    assert.equal(error.code, code);
    return true;
  });
}

function freshEngine(options) {
  return createV4LifeEngine(createV4LifeDemoSeed(), options);
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

function candidatesOf(engine) {
  const projection = engine.getProjection();
  return projection.domains.flatMap((domain) => [...domain.candidates]);
}

function allEvents(engine) {
  return engine.getEvents(0, 500).events;
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

// ---------------------------------------------------------------------------
// 种子 fixture（契约 §11）
// ---------------------------------------------------------------------------

test('种子 fixture 符合契约 §11＋§14.2：demo caseId、5 个 Actor、8 个工作项（含 WI-B2/WI-A2 承接链）、4 个 Gate（含 BG-1/AG-1）、初始 evidence tags 恰为 business_license', () => {
  const seed = createV4LifeDemoSeed();
  assert.equal(seed.case.caseId, 'demo-sme-robot-500w');
  assert.equal(seed.case.financingAmountCny, 5_000_000);
  assert.equal(seed.actors.length, 5);
  assert.deepEqual(
    seed.actors.map((actor) => actor.actorId),
    [
      'actor-business-chen',
      'actor-policy-li',
      'actor-credit-zhang',
      'actor-commerce-wang',
      'actor-asset-zhou',
    ],
  );
  assert.equal(seed.workItems.length, 8);
  assert.equal(seed.gates.length, 4);
  const c3 = seed.workItems.find((item) => item.workItemId === 'WI-C3');
  assert.deepEqual([...c3.dependencies], [
    { kind: 'receipt', id: 'PG-1' },
    { kind: 'workitem', id: 'WI-C1' },
    { kind: 'workitem', id: 'WI-C2' },
  ]);
  assert.equal(c3.gateId, 'CG-1');
  assert.equal(seed.initialEvidence.length, 1);
  assert.equal(seed.initialEvidence[0].evidenceId, 'ev-upstream-context');
  assert.deepEqual([...seed.initialEvidence[0].payload.tags], ['business_license']);
});

// ---------------------------------------------------------------------------
// 核心证明点（契约 §11 四点）
// ---------------------------------------------------------------------------

test('核心证明点①｜初始 upstream_context 到达即三域并行启动，其余工作项保持 blocked', () => {
  const engine = freshEngine();
  assert.equal(engine.caseId, V4LIFE_DEMO_CASE_ID);
  const projection = engine.getProjection();
  assert.deepEqual(
    projection.domains.map((domain) => domain.domain),
    ['policy', 'credit', 'commerce', 'asset'],
  );
  assert.equal(statusOf(engine, 'WI-P1'), 'in_progress');
  assert.equal(statusOf(engine, 'WI-C1'), 'in_progress');
  assert.equal(statusOf(engine, 'WI-A1'), 'in_progress');
  assert.equal(statusOf(engine, 'WI-C2'), 'blocked');
  assert.equal(statusOf(engine, 'WI-C3'), 'blocked');
  assert.equal(statusOf(engine, 'WI-B1'), 'blocked');

  const startedIds = allEvents(engine)
    .filter((event) => event.payload.type === 'WORK_ITEM_STARTED')
    .map((event) => event.payload.workItemId)
    .sort();
  assert.deepEqual(startedIds, ['WI-A1', 'WI-C1', 'WI-P1']);
  assert.equal(engine.rev, projection.eventCount, 'rev 恒等于事件总数');
});

test('核心证明点②｜硬等待：WI-C1/WI-C2 已完成且 PG-1 未决时，WI-C3 仍 blocked', () => {
  const engine = freshEngine();
  appendOk(engine, FINANCIAL);
  appendOk(engine, CONTRACT_DRAFT);
  assert.equal(statusOf(engine, 'WI-C2'), 'in_progress');
  assert.equal(statusOf(engine, 'WI-B1'), 'in_progress');

  submitOk(engine, {
    workItemId: 'WI-C1',
    actorId: ACTORS.credit,
    outputSummary: '补件清单已发出，营业执照核验通过；尽调报告标记缺失待业务补传。',
  });
  submitOk(engine, {
    workItemId: 'WI-C2',
    actorId: ACTORS.credit,
    outputSummary: '偿付能力交叉核验完成：现金流覆盖季度付息存在缺口。',
  });
  assert.equal(statusOf(engine, 'WI-C1'), 'completed');
  assert.equal(statusOf(engine, 'WI-C2'), 'completed');
  assert.equal(statusOf(engine, 'WI-C3'), 'blocked', 'workitem 依赖满足但 receipt 依赖未满足');

  submitOk(engine, {
    workItemId: 'WI-P1',
    actorId: ACTORS.policy,
    outputSummary: '行业不在禁入清单；500 万元额度属分行权限，进入政策准入 Gate。',
  });
  assert.equal(itemOf(engine, 'WI-P1').status, 'awaiting_gate');
  assert.equal(gateOf(engine, 'PG-1').status, 'open');
  assert.equal(statusOf(engine, 'WI-C3'), 'blocked', 'PG-1 未决时 WI-C3 必须硬等待');
  assert.equal(engine.getProjection().receipts.length, 0);
});

test('核心证明点③｜PG-1 rejected：WI-C3 stopped_dependency、已完成贡献保留、无依赖工作不受影响、Receipt 留痕', () => {
  const engine = freshEngine();
  appendOk(engine, FINANCIAL);
  appendOk(engine, CONTRACT_DRAFT);
  submitOk(engine, {
    workItemId: 'WI-C1',
    actorId: ACTORS.credit,
    outputSummary: '完整性核验完成，形成补件与核验记录。',
  });
  submitOk(engine, {
    workItemId: 'WI-B1',
    actorId: ACTORS.commerce,
    outputSummary: '商务方案与报价制式核对完成。',
  });
  submitOk(engine, {
    workItemId: 'WI-P1',
    actorId: ACTORS.policy,
    outputSummary: '初核完成，提请政策准入 Gate。',
  });

  const rejected = decideOk(engine, {
    gateId: 'PG-1',
    actorId: ACTORS.policy,
    outcome: 'rejected',
    reason: '营收持续下滑且经营现金流为负，不符合现行小微准入政策要求。',
  });
  assert.ok(rejected.receipt !== null, '否决必须产生 Receipt');
  assert.equal(rejected.receipt.gateId, 'PG-1');
  assert.equal(rejected.receipt.decision.outcome, 'rejected');
  assert.deepEqual(rejected.stoppedWorkItemIds, ['WI-C3'], '否决只级联真实依赖该 Receipt 的 blocked 项');
  assert.deepEqual(rejected.completedWorkItemIds, ['WI-P1'], '否决落定后链接工作项完成');

  assert.equal(statusOf(engine, 'WI-C3'), 'stopped_dependency');
  assert.equal(statusOf(engine, 'WI-B1'), 'completed', '无依赖工作不受否决影响');
  assert.equal(statusOf(engine, 'WI-A1'), 'in_progress', '资产域不受政策否决影响');
  assert.equal(statusOf(engine, 'WI-C1'), 'completed', '已完成工作不回滚');

  const contributions = engine.getProjection().contributions;
  const c1Contribution = contributions.find((entry) => entry.workItemId === 'WI-C1');
  const b1Contribution = contributions.find((entry) => entry.workItemId === 'WI-B1');
  assert.ok(c1Contribution !== undefined, 'WI-C1 贡献保留');
  assert.ok(b1Contribution !== undefined, 'WI-B1 贡献保留');
  assert.equal(c1Contribution.retainedAfterVeto, true);
  assert.equal(b1Contribution.retainedAfterVeto, true);

  const receipts = engine.getProjection().receipts;
  assert.equal(receipts.length, 1);
  const decisionEvent = allEvents(engine).find((event) => event.payload.type === 'DECISION_RECORDED');
  assert.ok(decisionEvent !== undefined, '决定必须留痕为 DECISION_RECORDED 事件');
  assert.equal(decisionEvent.payload.gateId, 'PG-1');
  assert.equal(decisionEvent.payload.receipt.receiptId, receipts[0].receiptId);
});

test('核心证明点④｜PG-1 approved → WI-C3 启动 → submitWork → CG-1 approved → completed', () => {
  const engine = freshEngine();
  appendOk(engine, FINANCIAL);
  appendOk(engine, CONTRACT_DRAFT);
  submitOk(engine, { workItemId: 'WI-C1', actorId: ACTORS.credit, outputSummary: '完整性核验完成。' });
  submitOk(engine, { workItemId: 'WI-C2', actorId: ACTORS.credit, outputSummary: '偿付能力交叉核验完成。' });
  submitOk(engine, {
    workItemId: 'WI-P1',
    actorId: ACTORS.policy,
    outputSummary: '初核完成，提请政策准入 Gate。',
  });

  const approved = decideOk(engine, {
    gateId: 'PG-1',
    actorId: ACTORS.policy,
    outcome: 'approved',
    reason: '行业不在禁入清单，额度在权限内；偿付缺口转入信审意见约束。',
  });
  assert.ok(approved.receipt !== null);
  assert.equal(statusOf(engine, 'WI-C3'), 'in_progress', 'Receipt 依赖满足后 WI-C3 启动');

  const submitted = submitOk(engine, {
    workItemId: 'WI-C3',
    actorId: ACTORS.credit,
    outputSummary: '同意授信意见：金额 500 万、期限 24 个月，增加季度回款核验条件。',
  });
  assert.equal(itemOf(engine, 'WI-C3').status, 'awaiting_gate');
  assert.ok(submitted.gate !== undefined);
  assert.equal(submitted.gate.gateId, 'CG-1');
  assert.equal(gateOf(engine, 'CG-1').status, 'open');

  const signed = decideOk(engine, {
    gateId: 'CG-1',
    actorId: ACTORS.credit,
    outcome: 'approved',
    reason: '信审意见签发，附加回款核验条件。',
  });
  assert.ok(signed.receipt !== null);
  assert.deepEqual(signed.completedWorkItemIds, ['WI-C3']);
  assert.equal(statusOf(engine, 'WI-C3'), 'completed');
  assert.equal(engine.getProjection().receipts.length, 2, 'PG-1 与 CG-1 各留一条 Receipt');
});

// ---------------------------------------------------------------------------
// 幂等与冲突（契约 §6 校验顺序、§12 错误码）
// ---------------------------------------------------------------------------

test('幂等｜同 commandId 同载荷重放 appendEvidence：status=replayed、事件总数不变、rev 为原接受时的 rev', () => {
  const engine = freshEngine();
  const command = {
    commandId: nextCommandId('idem-ev'),
    expectedRev: engine.rev,
    ...FINANCIAL,
  };
  const first = engine.appendEvidence(command);
  assert.equal(first.status, 'accepted');
  const eventsBefore = engine.getProjection().eventCount;

  const second = engine.appendEvidence({ ...command, expectedRev: engine.rev });
  assert.equal(second.status, 'replayed');
  assert.equal(second.rev, first.rev, 'replay 的 rev 必须等于原接受时的 rev');
  assert.equal(second.evidence.evidenceId, 'ev-financial-statement');
  assert.equal(engine.getProjection().eventCount, eventsBefore, '重放不追加事件');
  assert.equal(engine.rev, first.rev);
});

test('幂等｜同 commandId 重放 submitWork 与 recordDecision：replayed 且幂等优先于状态检查', () => {
  const engine = freshEngine();
  appendOk(engine, FINANCIAL);
  appendOk(engine, CONTRACT_DRAFT);

  const submitCommand = {
    commandId: nextCommandId('idem-work'),
    expectedRev: engine.rev,
    workItemId: 'WI-C1',
    actorId: ACTORS.credit,
    outputSummary: '完整性核验完成。',
  };
  const firstSubmit = engine.submitWork(submitCommand);
  assert.equal(firstSubmit.status, 'accepted');
  const eventsAfterSubmit = engine.getProjection().eventCount;
  const secondSubmit = engine.submitWork({ ...submitCommand, expectedRev: engine.rev });
  assert.equal(secondSubmit.status, 'replayed');
  assert.equal(secondSubmit.rev, firstSubmit.rev);
  assert.equal(engine.getProjection().eventCount, eventsAfterSubmit);
  expectCode(
    () =>
      engine.submitWork({
        commandId: nextCommandId('dup-work'),
        expectedRev: engine.rev,
        workItemId: 'WI-C1',
        actorId: ACTORS.credit,
        outputSummary: '非幂等路径的重复提交。',
      }),
    'WORK_ITEM_NOT_ACTIVE',
  );

  submitOk(engine, {
    workItemId: 'WI-P1',
    actorId: ACTORS.policy,
    outputSummary: '初核完成，提请政策准入 Gate。',
  });
  const decideCommand = {
    commandId: nextCommandId('idem-decide'),
    expectedRev: engine.rev,
    gateId: 'PG-1',
    actorId: ACTORS.policy,
    outcome: 'rejected',
    reason: '不符合现行准入政策。',
  };
  const firstDecision = engine.recordDecision(decideCommand);
  assert.equal(firstDecision.status, 'accepted');
  const eventsAfterDecision = engine.getProjection().eventCount;
  // Gate 已 decided：同 commandId 必须走幂等重放（§6 步骤 3 先于步骤 5）
  const secondDecision = engine.recordDecision({ ...decideCommand, expectedRev: engine.rev });
  assert.equal(secondDecision.status, 'replayed');
  assert.deepEqual(secondDecision.receipt, firstDecision.receipt, 'replay 返回原 Receipt');
  assert.equal(engine.getProjection().eventCount, eventsAfterDecision);
  expectCode(
    () =>
      engine.recordDecision({
        commandId: nextCommandId('dup-decide'),
        expectedRev: engine.rev,
        gateId: 'PG-1',
        actorId: ACTORS.policy,
        outcome: 'rejected',
        reason: '非幂等路径的重复决定。',
      }),
    'GATE_ALREADY_DECIDED',
  );
});

test('幂等｜同 commandId 异载荷 → IDEMPOTENCY_CONFLICT，失败关闭不产生事件', () => {
  const engine = freshEngine();
  const evidenceCommandId = nextCommandId('conflict-ev');
  engine.appendEvidence({ commandId: evidenceCommandId, expectedRev: engine.rev, ...FINANCIAL });

  let eventsBefore = engine.getProjection().eventCount;
  expectCode(
    () =>
      engine.appendEvidence({
        commandId: evidenceCommandId,
        expectedRev: engine.rev,
        ...CONTRACT_DRAFT,
      }),
    'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(engine.getProjection().eventCount, eventsBefore);

  submitOk(engine, {
    workItemId: 'WI-C1',
    actorId: ACTORS.credit,
    outputSummary: '完整性核验完成。',
  });
  const workCommandId = nextCommandId('conflict-work');
  engine.submitWork({
    commandId: workCommandId,
    expectedRev: engine.rev,
    workItemId: 'WI-C2',
    actorId: ACTORS.credit,
    outputSummary: '交叉核验完成。',
  });
  eventsBefore = engine.getProjection().eventCount;
  expectCode(
    () =>
      engine.submitWork({
        commandId: workCommandId,
        expectedRev: engine.rev,
        workItemId: 'WI-B1',
        actorId: ACTORS.commerce,
        outputSummary: '交叉核验完成。',
      }),
    'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(engine.getProjection().eventCount, eventsBefore);
});

test('幂等｜同 evidenceId 异载荷（不同 commandId）→ EVIDENCE_CONFLICT，失败关闭不产生事件', () => {
  const engine = freshEngine();
  appendOk(engine, FINANCIAL);
  const eventsBefore = engine.getProjection().eventCount;
  expectCode(
    () =>
      engine.appendEvidence({
        commandId: nextCommandId('ev-forge'),
        expectedRev: engine.rev,
        evidenceId: FINANCIAL.evidenceId,
        kind: FINANCIAL.kind,
        title: '被篡改的审计报告标题',
        submittedBy: ACTORS.business,
        payload: { summary: '同 id 异载荷', tags: ['forged'] },
      }),
    'EVIDENCE_CONFLICT',
  );
  assert.equal(engine.getProjection().eventCount, eventsBefore, '冲突失败关闭');
  assert.equal(engine.getProjection().evidenceCount, 2, '证据集合不变（初始 + 财务）');
});

// ---------------------------------------------------------------------------
// 版本竞争（契约 §6 步骤 4）
// ---------------------------------------------------------------------------

test('版本｜过期 expectedRev → VERSION_CONFLICT 且失败关闭；正确 expectedRev 接受且 rev 与事件总数一致', () => {
  const engine = freshEngine();
  const staleRev = engine.rev;
  appendOk(engine, FINANCIAL);
  assert.ok(engine.rev > staleRev, '接受命令后 rev 前进');

  const eventsBefore = engine.getProjection().eventCount;
  expectCode(
    () =>
      engine.appendEvidence({
        commandId: nextCommandId('stale'),
        expectedRev: staleRev,
        ...CONTRACT_DRAFT,
      }),
    'VERSION_CONFLICT',
  );
  assert.equal(engine.getProjection().eventCount, eventsBefore, '版本冲突失败关闭');

  const second = appendOk(engine, CONTRACT_DRAFT);
  assert.equal(second.rev, engine.rev, '结果 rev 与引擎 rev 一致');
  assert.equal(engine.rev, engine.getProjection().eventCount);
  assert.equal(engine.rev, allEvents(engine).length, 'rev 恒等于事件总数');
});

// ---------------------------------------------------------------------------
// 确定性 Candidate（契约 §5）
// ---------------------------------------------------------------------------

test('Candidate｜R2 初始必触发：upstream_context 缺 due_diligence_report → missing_document 面向 WI-C1', () => {
  const engine = freshEngine();
  const missing = candidatesOf(engine).find((candidate) => candidate.kind === 'missing_document');
  assert.ok(missing !== undefined, '初始 evidence tags 恰为 business_license，必须触发 R2');
  assert.equal(missing.workItemId, 'WI-C1');
  assert.deepEqual([...missing.basis], ['ev-upstream-context']);
  assert.equal(missing.dedupeKey, 'missing_document|WI-C1|ev-upstream-context');
  assert.equal(missing.authority, 'none');
  assert.equal(missing.producedBy, 'deterministic-v1');
  assert.ok(
    allEvents(engine).some((event) => event.payload.type === 'CANDIDATE_ISSUED'),
    'Candidate 发出必须留痕 CANDIDATE_ISSUED',
  );
});

test('Candidate｜R1 仅在财务+合同齐备后触发：basis 顺序与 dedupeKey 符合 §5', () => {
  const engine = freshEngine();
  appendOk(engine, FINANCIAL);
  assert.equal(
    candidatesOf(engine).filter((candidate) => candidate.kind === 'contradiction').length,
    0,
    '只有财务时 R1 不触发',
  );
  appendOk(engine, CONTRACT_DRAFT);
  const contradictions = candidatesOf(engine).filter(
    (candidate) => candidate.kind === 'contradiction',
  );
  assert.equal(contradictions.length, 1, '财务+合同齐备后 R1 恰好发一次');
  const contradiction = contradictions[0];
  assert.equal(contradiction.workItemId, 'WI-C2');
  assert.deepEqual([...contradiction.basis], ['ev-financial-statement', 'ev-contract-draft']);
  assert.equal(contradiction.dedupeKey, 'contradiction|WI-C2|ev-contract-draft,ev-financial-statement');
  assert.equal(contradiction.authority, 'none');
  assert.equal(contradiction.producedBy, 'deterministic-v1');
});

test('Candidate 去重｜重复提交同类证据不重复发（同 commandId 重放零新事件零新 Candidate）', () => {
  const engine = freshEngine();
  const command = {
    commandId: nextCommandId('dup-financial'),
    expectedRev: engine.rev,
    ...FINANCIAL,
  };
  engine.appendEvidence(command);
  const candidatesBefore = candidatesOf(engine).length;
  const eventsBefore = engine.getProjection().eventCount;

  const replay = engine.appendEvidence({ ...command, expectedRev: engine.rev });
  assert.equal(replay.status, 'replayed');
  assert.equal(candidatesOf(engine).length, candidatesBefore, '重放不重复发 Candidate');
  assert.equal(engine.getProjection().eventCount, eventsBefore);

  appendOk(engine, CONTRACT_DRAFT);
  assert.equal(
    candidatesOf(engine).filter((candidate) => candidate.kind === 'contradiction').length,
    1,
    'R1 只发出一次',
  );
});

test('Candidate 不越权｜authority 恒为 none，工作项状态只按 Evidence 依赖规则变化', () => {
  const engine = freshEngine();
  assert.equal(statusOf(engine, 'WI-C2'), 'blocked');
  assert.equal(statusOf(engine, 'WI-B1'), 'blocked');

  appendOk(engine, FINANCIAL);
  appendOk(engine, CONTRACT_DRAFT);
  const candidates = candidatesOf(engine);
  assert.ok(candidates.length >= 2, 'R1 与 R2 均应存在');
  for (const candidate of candidates) {
    assert.equal(candidate.authority, 'none');
    assert.equal(candidate.producedBy, 'deterministic-v1');
  }
  assert.equal(statusOf(engine, 'WI-C2'), 'in_progress', 'WI-C2 启动来自 evidence 依赖而非 Candidate');
  assert.equal(statusOf(engine, 'WI-B1'), 'in_progress');
  assert.equal(statusOf(engine, 'WI-C3'), 'blocked', 'Candidate 不可能解除 receipt 硬等待');
  assert.equal(statusOf(engine, 'WI-P1'), 'in_progress');
  assert.equal(engine.getProjection().receipts.length, 0, 'Candidate 不产生 Receipt');
});

// ---------------------------------------------------------------------------
// 退回重做（契约 §3 退回语义）
// ---------------------------------------------------------------------------

test('退回重做｜PG-1 returned → receipt 为 null、WI-P1 回 in_progress → 重新提交 Gate 重开 → 再批准产生新 Receipt → WI-C3 启动', () => {
  const engine = freshEngine();
  appendOk(engine, FINANCIAL);
  appendOk(engine, CONTRACT_DRAFT);
  submitOk(engine, { workItemId: 'WI-C1', actorId: ACTORS.credit, outputSummary: '完整性核验完成。' });
  submitOk(engine, { workItemId: 'WI-C2', actorId: ACTORS.credit, outputSummary: '偿付能力交叉核验完成。' });
  submitOk(engine, {
    workItemId: 'WI-P1',
    actorId: ACTORS.policy,
    outputSummary: '政策准入初核完成，提请 Gate。',
  });

  const returned = decideOk(engine, {
    gateId: 'PG-1',
    actorId: ACTORS.policy,
    outcome: 'returned',
    reason: '补充行业政策依据后再报。',
  });
  assert.equal(returned.receipt, null, '退回不发 Receipt（§7 returned 时 receipt 为 null）');
  assert.equal(engine.getProjection().receipts.length, 0);
  assert.equal(gateOf(engine, 'PG-1').status, 'pending', '退回后 Gate 回到 pending');
  assert.equal(statusOf(engine, 'WI-P1'), 'in_progress', '退回后工作项回到 in_progress');
  assert.equal(statusOf(engine, 'WI-C3'), 'blocked', 'receipt 依赖 returned 继续等待');

  expectCode(
    () =>
      engine.recordDecision({
        commandId: nextCommandId('redo-early'),
        expectedRev: engine.rev,
        gateId: 'PG-1',
        actorId: ACTORS.policy,
        outcome: 'approved',
        reason: '未重新提交即决定。',
      }),
    'GATE_NOT_OPEN',
  );

  submitOk(engine, {
    workItemId: 'WI-P1',
    actorId: ACTORS.policy,
    outputSummary: '补充行业政策依据后重新提交。',
  });
  assert.equal(gateOf(engine, 'PG-1').status, 'open', '重新提交后同一 Gate 重开新一轮');

  const approved = decideOk(engine, {
    gateId: 'PG-1',
    actorId: ACTORS.policy,
    outcome: 'approved',
    reason: '补充材料齐备，准入通过。',
  });
  assert.ok(approved.receipt !== null, '第二轮 approved 必须产生新 Receipt');
  assert.match(approved.receipt.receiptId, /^rcpt-PG-1-\d+$/, 'receiptId 格式 rcpt-<gateId>-<n>（§7）');
  assert.equal(statusOf(engine, 'WI-P1'), 'completed');
  assert.equal(engine.getProjection().receipts.length, 1);
  assert.equal(statusOf(engine, 'WI-C3'), 'in_progress', 'Receipt 依赖满足 + C1/C2 完成 → WI-C3 启动');

  submitOk(engine, {
    workItemId: 'WI-C3',
    actorId: ACTORS.credit,
    outputSummary: '正式信审意见完成。',
  });
  const signed = decideOk(engine, {
    gateId: 'CG-1',
    actorId: ACTORS.credit,
    outcome: 'approved',
    reason: '信审意见签发，附加回款核验条件。',
  });
  assert.ok(signed.receipt !== null);
  assert.match(signed.receipt.receiptId, /^rcpt-CG-1-\d+$/, 'receiptId 格式 rcpt-<gateId>-<n>（§7）');
  assert.equal(statusOf(engine, 'WI-C3'), 'completed');
  assert.equal(engine.getProjection().receipts.length, 2, 'Receipt 按轮次追加');
});

// ---------------------------------------------------------------------------
// 深克隆边界（契约 §2/§8）
// ---------------------------------------------------------------------------

test('深克隆｜修改 getProjection() 返回对象不影响引擎后续状态', () => {
  const engine = freshEngine();
  appendOk(engine, FINANCIAL);

  const tampered = engine.getProjection();
  tampered.case.displayName = '被篡改的显示名';
  tampered.domains[0].workItems[0].status = 'completed';
  tampered.domains[0].workItems[0].title = '被篡改的标题';
  tampered.receipts.push({
    receiptId: 'fake-rcpt',
    gateId: 'PG-1',
    decision: { outcome: 'approved', actorId: 'ghost', reason: 'ghost', decidedAt: 'ghost' },
  });
  tampered.evidence.pop();
  tampered.eventCount = 999;
  tampered.contributions.push({
    contributionId: 'fake-contrib',
    actorId: 'ghost',
    domain: 'policy',
    workItemId: 'WI-P1',
    kind: 'material_prep',
    summary: 'ghost',
    recordedAt: 'ghost',
    retainedAfterVeto: true,
  });

  const fresh = engine.getProjection();
  assert.notEqual(tampered, fresh, '每次查询必须返回新引用');
  assert.equal(fresh.case.displayName, '某四足机器人科技企业·流动资金与设备采购（合成演示案例）');
  assert.equal(fresh.domains[0].workItems[0].workItemId, 'WI-P1');
  assert.equal(fresh.domains[0].workItems[0].status, 'in_progress');
  assert.equal(fresh.receipts.length, 0);
  assert.equal(fresh.evidence.length, 2, '证据集合不受外部篡改影响');
  assert.equal(fresh.contributions.length, 0);
  assert.equal(fresh.eventCount, engine.rev);

  submitOk(engine, {
    workItemId: 'WI-C1',
    actorId: ACTORS.credit,
    outputSummary: '信审完整性核验完成（篡改后引擎仍按真实状态推进）。',
  });
  assert.equal(statusOf(engine, 'WI-C1'), 'completed', '篡改后引擎仍按真实状态推进');

  const eventsPage = engine.getEvents(0, 5);
  eventsPage.events[0].actor = 'tampered';
  eventsPage.events[0].payload = { type: 'TAMPERED' };
  const eventsAgain = engine.getEvents(0, 5);
  assert.equal(eventsAgain.events[0].actor, 'system', 'getEvents 也必须返回克隆');
  assert.equal(eventsAgain.events[0].payload.type, 'CASE_INITIALIZED');
});

// ---------------------------------------------------------------------------
// 事件分页（契约 §7 getEvents）
// ---------------------------------------------------------------------------

test('getEvents 分页｜seq 连续单调、limit 截断、hasMore、afterSeq 与默认 limit', () => {
  const engine = freshEngine();
  appendOk(engine, FINANCIAL);
  appendOk(engine, CONTRACT_DRAFT);

  const all = engine.getEvents(0, 500);
  const total = all.nextSeq;
  assert.equal(all.hasMore, false, 'limit 500 覆盖全量时无更多');
  assert.equal(all.events.length, total);
  assert.equal(engine.rev, total, 'rev 恒等于事件总数');
  for (let index = 0; index < all.events.length; index += 1) {
    assert.equal(all.events[index].seq, index + 1, 'seq 从 1 起连续不可跳号');
  }
  assert.equal(all.events[0].payload.type, 'CASE_INITIALIZED');
  assert.ok(all.events.some((event) => event.payload.type === 'EVIDENCE_ACCEPTED'));
  assert.ok(all.events.some((event) => event.payload.type === 'CANDIDATE_ISSUED'));

  const page1 = engine.getEvents(0, 3);
  assert.deepEqual(page1.events.map((event) => event.seq), [1, 2, 3], 'limit 截断');
  assert.equal(page1.hasMore, true);
  assert.equal(page1.nextSeq, total, 'nextSeq 是当前事件总数而非页尾');

  const page2 = engine.getEvents(3, 3);
  assert.deepEqual(page2.events.map((event) => event.seq), [4, 5, 6]);
  assert.equal(page2.hasMore, total > 6);
  assert.equal(page2.nextSeq, total);

  const tail = engine.getEvents(6, 500);
  assert.equal(tail.events.length, total - 6, 'afterSeq 只返回更靠后的事件');
  assert.ok(tail.events.every((event) => event.seq > 6));
  assert.equal(tail.hasMore, false);

  const beyond = engine.getEvents(total + 10);
  assert.equal(beyond.events.length, 0, 'afterSeq 超出末尾返回空');
  assert.equal(beyond.hasMore, false);
  assert.equal(beyond.nextSeq, total);

  const defaulted = engine.getEvents(0);
  assert.equal(defaulted.events.length, Math.min(100, total), '默认 limit 为 100');
  assert.equal(defaulted.hasMore, total > 100);
});

// ---------------------------------------------------------------------------
// 时钟注入（契约 §7 options.now）
// ---------------------------------------------------------------------------

test('时钟注入｜options.now 单调生效：事件、证据与 Receipt 时间戳全部来自注入时钟', () => {
  let ticks = 0;
  const base = Date.UTC(2030, 0, 1, 0, 0, 0);
  const engine = freshEngine({
    now: () => new Date(base + (++ticks) * 1000).toISOString(),
  });

  appendOk(engine, FINANCIAL);
  submitOk(engine, {
    workItemId: 'WI-C1',
    actorId: ACTORS.credit,
    outputSummary: '完整性核验完成。',
  });
  submitOk(engine, {
    workItemId: 'WI-P1',
    actorId: ACTORS.policy,
    outputSummary: '初核完成，提请政策准入 Gate。',
  });
  const decided = decideOk(engine, {
    gateId: 'PG-1',
    actorId: ACTORS.policy,
    outcome: 'rejected',
    reason: '不符合现行准入政策。',
  });

  const events = allEvents(engine);
  assert.ok(events.length >= 2);
  for (let index = 1; index < events.length; index += 1) {
    assert.ok(
      events[index].at >= events[index - 1].at,
      '事件时间戳随时序单调不减',
    );
  }
  assert.ok(events[0].at < events[events.length - 1].at, '时钟随命令推进');
  for (const event of events) {
    assert.ok(
      event.at.startsWith('2030-01-01T00:00:'),
      `事件时间戳来自注入时钟：${event.at}`,
    );
  }

  const financial = engine
    .getProjection()
    .evidence.find((entry) => entry.evidenceId === 'ev-financial-statement');
  assert.ok(financial !== undefined);
  assert.ok(financial.submittedAt.startsWith('2030-01-01T00:00:'), '证据 submittedAt 来自注入时钟');
  assert.ok(decided.receipt !== null);
  assert.ok(
    decided.receipt.decision.decidedAt.startsWith('2030-01-01T00:00:'),
    'Receipt 决定时间来自注入时钟',
  );
  assert.ok(ticks >= events.length, '每次取时推进注入时钟');
});
