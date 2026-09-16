// Lane D｜对抗性验收测试 —— v4life 四域后端垂直切片
// 权威依据：docs/v4/CONTRACT.md（FROZEN FOR THIS SLICE / 2026-09-03）
// 覆盖失败路径与核心证明点：越权（ROLE_MISMATCH/ACTOR_NOT_FOUND）、乱序（409 状态机）、
// 重复与同键异载荷（replay / EVIDENCE_CONFLICT / IDEMPOTENCY_CONFLICT）、并发版本竞争（VERSION_CONFLICT）、
// 缺失依赖硬等待、否决后贡献保留、退回重做、Candidate 不越权、事件重放与分页边界、深克隆边界。
// 途径：进程内直接调用引擎 + 直接 import Route Handler（new Request 调用，不起服务）。
// 隔离：所有 HTTP/runtime 用例先 resetV4LifeRuntime()；引擎直调用例使用独立 engine 实例。
// 运行：node --experimental-strip-types --test --experimental-test-isolation=none test/v4life-lane-d-adversarial.test.mjs

import assert from 'node:assert/strict';
import test from 'node:test';

import { createV4LifeEngine, V4LifeError } from '../lib/v4life/engine.ts';
import { createV4LifeDemoSeed } from '../lib/v4life/seed.ts';
import { resetV4LifeRuntime } from '../lib/v4life/runtime.ts';
import { rebuildProjection } from '../lib/v4life/replay.ts';

import { GET as caseGET } from '../app/api/v4life/cases/[caseId]/route.ts';
import { POST as evidencePOST } from '../app/api/v4life/cases/[caseId]/evidence/route.ts';
import { POST as workPOST } from '../app/api/v4life/cases/[caseId]/work/route.ts';
import { POST as decisionsPOST } from '../app/api/v4life/cases/[caseId]/decisions/route.ts';
import { GET as eventsGET } from '../app/api/v4life/cases/[caseId]/events/route.ts';

// ---------------------------------------------------------------------------
// 共享 fixture（契约 §11 Golden Case）
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
// 引擎侧辅助
// ---------------------------------------------------------------------------

function makeEngine() {
  return createV4LifeEngine(createV4LifeDemoSeed());
}

let cmdSeq = 0;
function nextCommandId(label) {
  cmdSeq += 1;
  return `cmd-laned-${label ?? 'x'}-${cmdSeq}`;
}

function appendOk(engine, extra, label) {
  return engine.appendEvidence({
    commandId: nextCommandId(label ?? 'append'),
    expectedRev: engine.rev,
    ...extra,
  });
}

function submitOk(engine, extra, label) {
  return engine.submitWork({
    commandId: nextCommandId(label ?? 'submit'),
    expectedRev: engine.rev,
    ...extra,
  });
}

function decideOk(engine, extra, label) {
  return engine.recordDecision({
    commandId: nextCommandId(label ?? 'decide'),
    expectedRev: engine.rev,
    ...extra,
  });
}

function expectEngineError(operation, code) {
  let threw = null;
  try {
    operation();
  } catch (error) {
    threw = error;
  }
  assert.ok(threw !== null, `expected engine error ${code}, but operation succeeded`);
  assert.ok(threw instanceof Error, `expected an Error, got ${typeof threw}`);
  const actual = threw.code ?? threw.message;
  assert.equal(
    actual,
    code,
    `expected error code ${code}, got ${actual} (${threw.message})`,
  );
  assert.ok(threw instanceof V4LifeError, `engine error should be V4LifeError instance`);
}

function getItem(projection, workItemId) {
  for (const domain of projection.domains) {
    const hit = domain.workItems.find((entry) => entry.workItemId === workItemId);
    if (hit !== undefined) return hit;
  }
  throw new Error(`unknown work item ${workItemId}`);
}

function statusOf(engine, workItemId) {
  return getItem(engine.getProjection(), workItemId).status;
}

function gateOf(engine, gateId) {
  for (const domain of engine.getProjection().domains) {
    const hit = domain.gates.find((entry) => entry.gateId === gateId);
    if (hit !== undefined) return hit;
  }
  throw new Error(`unknown gate ${gateId}`);
}

function candidatesOf(engine) {
  const all = [];
  for (const domain of engine.getProjection().domains) {
    all.push(...domain.candidates);
  }
  return all;
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
  if (collected.length > 100_000) throw new Error('event export did not terminate');
  return collected;
}

function appendFinancialAndContract(engine) {
  appendOk(engine, FINANCIAL, 'fin');
  appendOk(engine, CONTRACT, 'contract');
}

// 建链到 WI-C3 in_progress：financial+contract → C1/C2 完成 → P1 提交 → PG-1 approved → C3 启动。
function buildChainToC3InProgress(engine) {
  appendFinancialAndContract(engine);
  submitOk(engine, { workItemId: 'WI-C1', actorId: ACTORS.credit, outputSummary: '信审完整性核验完成。' });
  submitOk(engine, { workItemId: 'WI-C2', actorId: ACTORS.credit, outputSummary: '偿付能力交叉核验完成。' });
  submitOk(engine, { workItemId: 'WI-P1', actorId: ACTORS.policy, outputSummary: '政策准入初核完成，提请 Gate。' });
  const approved = decideOk(engine, {
    gateId: 'PG-1', actorId: ACTORS.policy, outcome: 'approved', reason: '行业不在禁入清单，准入通过。',
  });
  assert.equal(statusOf(engine, 'WI-C3'), 'in_progress');
  return approved;
}

// §11 fixture 走到 PG-1 rejected 之前的完整铺垫（含贡献形成）。
function buildVetoPrelude(engine) {
  appendFinancialAndContract(engine);
  submitOk(engine, { workItemId: 'WI-C1', actorId: ACTORS.credit, outputSummary: '完整性核验完成，形成补件清单与核验记录。' });
  submitOk(engine, { workItemId: 'WI-B1', actorId: ACTORS.commerce, outputSummary: '商务方案与报价制式核对完成。' });
  submitOk(engine, { workItemId: 'WI-A1', actorId: ACTORS.asset, outputSummary: '同客户历史资产表现反馈整理完成。' });
  submitOk(engine, { workItemId: 'WI-P1', actorId: ACTORS.policy, outputSummary: '政策准入初核完成，提请 Gate。' });
}

function stripGeneratedAt(projection) {
  const clone = structuredClone(projection);
  delete clone.generatedAt;
  return clone;
}

// ---------------------------------------------------------------------------
// 1｜越权（ROLE_MISMATCH / ACTOR_NOT_FOUND）
// ---------------------------------------------------------------------------

test('越权｜recordDecision：PG-1 用非 policy 角色决定 → ROLE_MISMATCH，失败关闭不产生事件', () => {
  const engine = makeEngine();
  submitOk(engine, { workItemId: 'WI-P1', actorId: ACTORS.policy, outputSummary: '初核完成。' });
  assert.equal(gateOf(engine, 'PG-1').status, 'open');
  const eventsBefore = exportAllEvents(engine).length;

  for (const actorId of [ACTORS.business, ACTORS.credit, ACTORS.commerce, ACTORS.asset]) {
    expectEngineError(
      () => engine.recordDecision({
        commandId: nextCommandId('deny-pg'), expectedRev: engine.rev,
        gateId: 'PG-1', actorId, outcome: 'approved', reason: '越权尝试',
      }),
      'ROLE_MISMATCH',
    );
  }
  assert.equal(gateOf(engine, 'PG-1').status, 'open', '越权失败不得改变 Gate 状态');
  assert.equal(statusOf(engine, 'WI-P1'), 'awaiting_gate', '越权失败不得改变工作项状态');
  assert.equal(exportAllEvents(engine).length, eventsBefore, '失败关闭：不产生事件');
});

test('越权｜recordDecision：CG-1 用非 credit 角色（policy/business）决定 → ROLE_MISMATCH', () => {
  const engine = makeEngine();
  buildChainToC3InProgress(engine);
  submitOk(engine, { workItemId: 'WI-C3', actorId: ACTORS.credit, outputSummary: '正式信审意见完成。' });
  assert.equal(gateOf(engine, 'CG-1').status, 'open');

  for (const actorId of [ACTORS.policy, ACTORS.business]) {
    expectEngineError(
      () => engine.recordDecision({
        commandId: nextCommandId('deny-cg'), expectedRev: engine.rev,
        gateId: 'CG-1', actorId, outcome: 'approved', reason: '越权尝试',
      }),
      'ROLE_MISMATCH',
    );
  }
  assert.equal(statusOf(engine, 'WI-C3'), 'awaiting_gate');
  assert.equal(engine.getProjection().receipts.length, 1, '越权不得产生新 Receipt');
});

test('越权｜submitWork：WI-P1/WI-C1/WI-C2/WI-B1/WI-A1 各至少一条非 assignedRole 提交 → ROLE_MISMATCH', () => {
  const engine = makeEngine();
  // WI-P1(policy)/WI-C1(credit)/WI-A1(asset) 已由初始 Evidence 启动
  appendOk(engine, FINANCIAL, 'fin'); // WI-C2 启动
  appendOk(engine, CONTRACT, 'contract'); // WI-B1 启动
  const eventsBefore = exportAllEvents(engine).length;

  const attempts = [
    { workItemId: 'WI-P1', actorId: ACTORS.credit },
    { workItemId: 'WI-C1', actorId: ACTORS.policy },
    { workItemId: 'WI-A1', actorId: ACTORS.commerce },
    { workItemId: 'WI-C2', actorId: ACTORS.business },
    { workItemId: 'WI-B1', actorId: ACTORS.asset },
  ];
  for (const attempt of attempts) {
    expectEngineError(
      () => engine.submitWork({
        commandId: nextCommandId('deny-work'), expectedRev: engine.rev,
        ...attempt, outputSummary: '越权提交尝试',
      }),
      'ROLE_MISMATCH',
    );
  }
  assert.equal(exportAllEvents(engine).length, eventsBefore, '失败关闭：不产生事件');
  assert.equal(statusOf(engine, 'WI-P1'), 'in_progress');
  assert.equal(statusOf(engine, 'WI-C1'), 'in_progress');
  assert.equal(statusOf(engine, 'WI-C2'), 'in_progress');
  assert.equal(statusOf(engine, 'WI-B1'), 'in_progress');
  assert.equal(statusOf(engine, 'WI-A1'), 'in_progress');
});

test('越权｜submitWork：WI-C3 由非 credit 角色提交 → ROLE_MISMATCH', () => {
  const engine = makeEngine();
  buildChainToC3InProgress(engine);
  expectEngineError(
    () => engine.submitWork({
      commandId: nextCommandId('deny-c3'), expectedRev: engine.rev,
      workItemId: 'WI-C3', actorId: ACTORS.policy, outputSummary: '越权提交尝试',
    }),
    'ROLE_MISMATCH',
  );
  assert.equal(statusOf(engine, 'WI-C3'), 'in_progress');
});

test('越权｜未知 actorId → ACTOR_NOT_FOUND；字段校验先于 Actor 校验（INVALID_ENGINE_INPUT 优先）', () => {
  const engine = makeEngine();
  expectEngineError(
    () => engine.appendEvidence({
      commandId: nextCommandId('ghost-ev'), expectedRev: engine.rev,
      evidenceId: 'ev-ghost', kind: 'supplement', title: '幽灵提交',
      submittedBy: 'actor-ghost', payload: { summary: '未知人', tags: [] },
    }),
    'ACTOR_NOT_FOUND',
  );
  expectEngineError(
    () => engine.submitWork({
      commandId: nextCommandId('ghost-work'), expectedRev: engine.rev,
      workItemId: 'WI-C1', actorId: 'actor-ghost', outputSummary: '幽灵提交',
    }),
    'ACTOR_NOT_FOUND',
  );
  submitOk(engine, { workItemId: 'WI-P1', actorId: ACTORS.policy, outputSummary: '初核完成。' });
  expectEngineError(
    () => engine.recordDecision({
      commandId: nextCommandId('ghost-dec'), expectedRev: engine.rev,
      gateId: 'PG-1', actorId: 'actor-ghost', outcome: 'approved', reason: '幽灵决定',
    }),
    'ACTOR_NOT_FOUND',
  );
  // 字段校验（步骤1）先于 Actor 校验（步骤2）
  expectEngineError(
    () => engine.appendEvidence({
      commandId: nextCommandId('ghost-bad'), expectedRev: engine.rev,
      evidenceId: 'ev-ghost2', kind: 'supplement', title: '',
      submittedBy: 'actor-ghost', payload: { summary: '', tags: [] },
    }),
    'INVALID_ENGINE_INPUT',
  );
});

// ---------------------------------------------------------------------------
// 2｜乱序（状态机 409）
// ---------------------------------------------------------------------------

test('乱序｜blocked 工作项直接 submitWork → WORK_ITEM_NOT_ACTIVE（WI-C3/WI-C2/WI-B1）', () => {
  const engine = makeEngine();
  for (const workItemId of ['WI-C3', 'WI-C2', 'WI-B1']) {
    const assignedRole = { 'WI-C3': ACTORS.credit, 'WI-C2': ACTORS.credit, 'WI-B1': ACTORS.commerce }[workItemId];
    expectEngineError(
      () => engine.submitWork({
        commandId: nextCommandId('early-work'), expectedRev: engine.rev,
        workItemId, actorId: assignedRole, outputSummary: '依赖未满足即提交',
      }),
      'WORK_ITEM_NOT_ACTIVE',
    );
  }
  assert.equal(statusOf(engine, 'WI-C3'), 'blocked');
  assert.equal(statusOf(engine, 'WI-C2'), 'blocked');
  assert.equal(statusOf(engine, 'WI-B1'), 'blocked');
});

test('乱序｜Gate 未开（linked item 未提交）时决定 → GATE_NOT_OPEN（PG-1/CG-1）', () => {
  const engine = makeEngine();
  assert.equal(gateOf(engine, 'PG-1').status, 'pending');
  expectEngineError(
    () => engine.recordDecision({
      commandId: nextCommandId('early-pg'), expectedRev: engine.rev,
      gateId: 'PG-1', actorId: ACTORS.policy, outcome: 'approved', reason: 'Gate 未开即决定',
    }),
    'GATE_NOT_OPEN',
  );
  expectEngineError(
    () => engine.recordDecision({
      commandId: nextCommandId('early-cg'), expectedRev: engine.rev,
      gateId: 'CG-1', actorId: ACTORS.credit, outcome: 'approved', reason: 'Gate 未开即决定',
    }),
    'GATE_NOT_OPEN',
  );
  assert.equal(gateOf(engine, 'PG-1').status, 'pending');
  assert.equal(gateOf(engine, 'CG-1').status, 'pending');
  assert.equal(statusOf(engine, 'WI-P1'), 'in_progress', '乱序决定不得改变工作项状态');
});

test('乱序｜Gate 已 decided 后重复决定 → GATE_ALREADY_DECIDED', () => {
  const engine = makeEngine();
  submitOk(engine, { workItemId: 'WI-P1', actorId: ACTORS.policy, outputSummary: '初核完成。' });
  decideOk(engine, { gateId: 'PG-1', actorId: ACTORS.policy, outcome: 'approved', reason: '准入通过。' });
  expectEngineError(
    () => engine.recordDecision({
      commandId: nextCommandId('again-pg'), expectedRev: engine.rev,
      gateId: 'PG-1', actorId: ACTORS.policy, outcome: 'approved', reason: '重复决定',
    }),
    'GATE_ALREADY_DECIDED',
  );
  assert.equal(engine.getProjection().receipts.length, 1, '重复决定不得追加 Receipt');
});

// ---------------------------------------------------------------------------
// 3｜重复 / 幂等 / 同键异载荷
// ---------------------------------------------------------------------------

test('幂等｜同 commandId 双发 appendEvidence → 第二条 replayed，事件总数不变，rev 为原接受时 rev', () => {
  const engine = makeEngine();
  const command = { commandId: nextCommandId('idem-ev'), expectedRev: engine.rev, ...FINANCIAL };
  const first = engine.appendEvidence(command);
  assert.equal(first.status, 'accepted');
  const eventsAfterFirst = exportAllEvents(engine).length;

  const second = engine.appendEvidence({ ...command, expectedRev: engine.rev });
  assert.equal(second.status, 'replayed');
  assert.equal(second.rev, first.rev, 'replay 的 rev 必须等于原接受时的 rev');
  assert.deepEqual(second.evidence, first.evidence);
  assert.equal(exportAllEvents(engine).length, eventsAfterFirst, 'replay 不追加事件');
});

test('幂等｜同 commandId 双发 submitWork → replayed，事件总数不变', () => {
  const engine = makeEngine();
  const command = {
    commandId: nextCommandId('idem-work'), expectedRev: engine.rev,
    workItemId: 'WI-C1', actorId: ACTORS.credit, outputSummary: '完整性核验完成。',
  };
  const first = engine.submitWork(command);
  assert.equal(first.status, 'accepted');
  const eventsAfterFirst = exportAllEvents(engine).length;

  const second = engine.submitWork({ ...command, expectedRev: engine.rev });
  assert.equal(second.status, 'replayed');
  assert.deepEqual(second.workItem, first.workItem);
  assert.equal(exportAllEvents(engine).length, eventsAfterFirst);
  assert.equal(statusOf(engine, 'WI-C1'), 'completed');
});

test('幂等｜同 commandId 双发 recordDecision → replayed 且 Receipt 一致，幂等优先于 GATE_ALREADY_DECIDED', () => {
  const engine = makeEngine();
  submitOk(engine, { workItemId: 'WI-P1', actorId: ACTORS.policy, outputSummary: '初核完成。' });
  const command = {
    commandId: nextCommandId('idem-dec'), expectedRev: engine.rev,
    gateId: 'PG-1', actorId: ACTORS.policy, outcome: 'approved', reason: '准入通过。',
  };
  const first = engine.recordDecision(command);
  assert.equal(first.status, 'accepted');
  assert.ok(first.receipt !== null && first.receipt !== undefined);
  const eventsAfterFirst = exportAllEvents(engine).length;
  assert.equal(gateOf(engine, 'PG-1').status, 'decided');

  // Gate 已 decided：普通重发会 GATE_ALREADY_DECIDED；同 commandId 必须走幂等重放（校验顺序 §6 步骤3 先于步骤5）。
  const second = engine.recordDecision({ ...command, expectedRev: engine.rev });
  assert.equal(second.status, 'replayed');
  assert.deepEqual(second.receipt, first.receipt);
  assert.equal(second.rev, first.rev);
  assert.equal(exportAllEvents(engine).length, eventsAfterFirst, 'replay 不追加事件');
  assert.equal(engine.getProjection().receipts.length, 1);
});

test('同键异载荷｜同 evidenceId + 异 payload（不同 commandId）→ EVIDENCE_CONFLICT', () => {
  const engine = makeEngine();
  appendOk(engine, FINANCIAL, 'fin-1');
  const eventsBefore = exportAllEvents(engine).length;
  expectEngineError(
    () => engine.appendEvidence({
      commandId: nextCommandId('ev-conflict'), expectedRev: engine.rev,
      evidenceId: FINANCIAL.evidenceId, kind: FINANCIAL.kind,
      title: '被篡改的审计报告标题', submittedBy: ACTORS.business,
      payload: { summary: '同 id 异载荷', tags: ['forged'] },
    }),
    'EVIDENCE_CONFLICT',
  );
  assert.equal(exportAllEvents(engine).length, eventsBefore, '冲突失败关闭：不产生事件');
});

test('同键异载荷｜同 commandId + 异 payload → IDEMPOTENCY_CONFLICT（append 与 submit 两条路径）', () => {
  const engine = makeEngine();
  // appendEvidence 路径
  const evCommandId = nextCommandId('idem-conflict-ev');
  engine.appendEvidence({ commandId: evCommandId, expectedRev: engine.rev, ...FINANCIAL });
  expectEngineError(
    () => engine.appendEvidence({
      commandId: evCommandId, expectedRev: engine.rev,
      evidenceId: CONTRACT.evidenceId, kind: CONTRACT.kind, title: CONTRACT.title,
      submittedBy: ACTORS.business, payload: CONTRACT.payload,
    }),
    'IDEMPOTENCY_CONFLICT',
  );
  // submitWork 路径
  const workCommandId = nextCommandId('idem-conflict-work');
  engine.submitWork({
    commandId: workCommandId, expectedRev: engine.rev,
    workItemId: 'WI-C1', actorId: ACTORS.credit, outputSummary: '原口径核验结论。',
  });
  expectEngineError(
    () => engine.submitWork({
      commandId: workCommandId, expectedRev: engine.rev,
      workItemId: 'WI-C1', actorId: ACTORS.credit, outputSummary: '被篡改的核验结论。',
    }),
    'IDEMPOTENCY_CONFLICT',
  );
});

// ---------------------------------------------------------------------------
// 4｜并发版本竞争
// ---------------------------------------------------------------------------

test('并发｜两命令携带同一 expectedRev：第一条接受后第二条 → VERSION_CONFLICT，失败后可恢复推进', () => {
  const engine = makeEngine();
  const staleRev = engine.rev;
  const first = engine.appendEvidence({
    commandId: nextCommandId('race-1'), expectedRev: staleRev, ...FINANCIAL,
  });
  assert.equal(first.status, 'accepted');
  const revAfterFirst = first.rev;
  assert.equal(engine.rev, revAfterFirst, 'engine.rev 等于事件总数');
  const eventsAfterFirst = exportAllEvents(engine).length;

  expectEngineError(
    () => engine.appendEvidence({
      commandId: nextCommandId('race-2'), expectedRev: staleRev, ...CONTRACT,
    }),
    'VERSION_CONFLICT',
  );
  assert.equal(exportAllEvents(engine).length, eventsAfterFirst, '版本冲突失败关闭：不产生事件');
  assert.equal(engine.rev, revAfterFirst, '冲突失败后 rev 保持第一条接受后的值');

  // 修正 expectedRev 后可正常推进（非永久卡死）
  const third = engine.appendEvidence({
    commandId: nextCommandId('race-3'), expectedRev: engine.rev, ...CONTRACT,
  });
  assert.equal(third.status, 'accepted');
});

// ---------------------------------------------------------------------------
// 5｜缺失依赖（硬等待）
// ---------------------------------------------------------------------------

test('缺失依赖｜WI-C3 在 PG-1 未批准前任何尝试都不可推进：状态保持 blocked，提交一律 409', () => {
  const engine = makeEngine();
  assert.equal(statusOf(engine, 'WI-C3'), 'blocked');

  appendFinancialAndContract(engine);
  submitOk(engine, { workItemId: 'WI-C1', actorId: ACTORS.credit, outputSummary: '完整性核验完成。' });
  submitOk(engine, { workItemId: 'WI-C2', actorId: ACTORS.credit, outputSummary: '偿付能力交叉核验完成。' });
  assert.equal(statusOf(engine, 'WI-C1'), 'completed');
  assert.equal(statusOf(engine, 'WI-C2'), 'completed');
  assert.equal(statusOf(engine, 'WI-C3'), 'blocked', '信审前置完成也不得解除 Receipt 硬等待');

  expectEngineError(
    () => engine.submitWork({
      commandId: nextCommandId('c3-early'), expectedRev: engine.rev,
      workItemId: 'WI-C3', actorId: ACTORS.credit, outputSummary: '未到 Receipt 即提交',
    }),
    'WORK_ITEM_NOT_ACTIVE',
  );

  submitOk(engine, { workItemId: 'WI-P1', actorId: ACTORS.policy, outputSummary: '政策准入初核完成，提请 Gate。' });
  assert.equal(gateOf(engine, 'PG-1').status, 'open');
  assert.equal(statusOf(engine, 'WI-C3'), 'blocked', 'Gate 已开但未决定，WI-C3 仍 blocked');
  expectEngineError(
    () => engine.submitWork({
      commandId: nextCommandId('c3-early-2'), expectedRev: engine.rev,
      workItemId: 'WI-C3', actorId: ACTORS.credit, outputSummary: 'Gate 未落定即提交',
    }),
    'WORK_ITEM_NOT_ACTIVE',
  );
  assert.equal(statusOf(engine, 'WI-C3'), 'blocked', 'stopped 之前始终为 blocked');
});

// ---------------------------------------------------------------------------
// 6｜否决后贡献保留（§11 fixture：PG-1 rejected）
// ---------------------------------------------------------------------------

test('否决级联｜PG-1 rejected → WI-C3 stopped_dependency；贡献/Evidence/Candidate 全保留；事件只增不删；WI-B1/WI-A1 不受影响', () => {
  const engine = makeEngine();
  buildVetoPrelude(engine);

  const eventsBefore = exportAllEvents(engine);
  const projectionBefore = engine.getProjection();

  const rejected = decideOk(engine, {
    gateId: 'PG-1', actorId: ACTORS.policy, outcome: 'rejected',
    reason: '营收持续下滑且经营现金流为负，不符合现行小微准入政策。',
  });

  // Receipt 与级联
  assert.ok(rejected.receipt !== null && rejected.receipt !== undefined, '否决必须产生不可变 Receipt');
  assert.equal(rejected.receipt.gateId, 'PG-1');
  assert.equal(rejected.receipt.decision.outcome, 'rejected');
  assert.deepEqual(rejected.stoppedWorkItemIds, ['WI-C3'], '否决只级联真实依赖该 Receipt 的 blocked 项');
  assert.equal(statusOf(engine, 'WI-C3'), 'stopped_dependency');

  // 受影响项与无关项
  assert.equal(statusOf(engine, 'WI-P1'), 'completed', 'Gate 落定后 linked item 由引擎落成');
  assert.equal(statusOf(engine, 'WI-B1'), 'completed', '无依赖的商务工作不受否决影响');
  assert.equal(statusOf(engine, 'WI-A1'), 'completed', '无依赖的资产工作不受否决影响');
  assert.equal(statusOf(engine, 'WI-C1'), 'completed');

  // 贡献保留
  const contributions = engine.getProjection().contributions;
  const c1 = contributions.find((entry) => entry.workItemId === 'WI-C1');
  const b1 = contributions.find((entry) => entry.workItemId === 'WI-B1');
  assert.ok(c1 !== undefined, 'WI-C1 的贡献必须保留');
  assert.ok(b1 !== undefined, 'WI-B1 的贡献必须保留');
  assert.equal(c1.retainedAfterVeto, true);
  assert.equal(b1.retainedAfterVeto, true);
  assert.ok(contributions.length >= 3, 'WI-A1 的贡献同样保留');

  // Evidence 保留
  const projectionAfter = engine.getProjection();
  const evidenceIds = projectionAfter.evidence.map((entry) => entry.evidenceId);
  assert.deepEqual(
    evidenceIds.sort(),
    ['ev-contract-draft', 'ev-financial-statement', 'ev-upstream-context'].sort(),
  );
  assert.equal(projectionAfter.evidenceCount, 3);
  assert.equal(projectionAfter.receipts.length, 1);

  // Candidate 保留（R1 矛盾 + R2 缺件）
  const candidates = candidatesOf(engine);
  const contradiction = candidates.find((entry) => entry.kind === 'contradiction');
  const missing = candidates.find((entry) => entry.kind === 'missing_document');
  assert.ok(contradiction !== undefined, 'R1 Candidate 必须保留');
  assert.ok(missing !== undefined, 'R2 Candidate 必须保留');
  assert.deepEqual(contradiction.basis, ['ev-financial-statement', 'ev-contract-draft']);
  for (const candidate of candidates) {
    assert.equal(candidate.authority, 'none');
  }

  // 事件只增不删：前缀完全一致
  const eventsAfter = exportAllEvents(engine);
  assert.ok(eventsAfter.length > eventsBefore.length);
  assert.deepEqual(
    eventsAfter.slice(0, eventsBefore.length),
    eventsBefore,
    '否决不得删除或改写既有事件',
  );

  // Evidence 保留检查：否决前后的证据对象一致
  assert.deepEqual(projectionAfter.evidence, projectionBefore.evidence);

  // 否决后再补充材料：stopped_dependency 不被重置、也不复活
  appendOk(engine, {
    evidenceId: 'ev-supplement-1', kind: 'supplement', title: '补充经营现金流说明',
    submittedBy: ACTORS.business, payload: { summary: '补充材料。', tags: ['supplement'] },
  }, 'supplement');
  assert.equal(statusOf(engine, 'WI-C3'), 'stopped_dependency', '补充材料不得绕过否决级联');
});

// ---------------------------------------------------------------------------
// 7｜退回重做
// ---------------------------------------------------------------------------

test('退回重做｜PG-1 returned 不发 Receipt → WI-P1 回 in_progress → 重提交再批准产生新 Receipt → WI-C3 才启动', () => {
  const engine = makeEngine();
  appendFinancialAndContract(engine);
  submitOk(engine, { workItemId: 'WI-C1', actorId: ACTORS.credit, outputSummary: '完整性核验完成。' });
  submitOk(engine, { workItemId: 'WI-C2', actorId: ACTORS.credit, outputSummary: '偿付能力交叉核验完成。' });
  submitOk(engine, { workItemId: 'WI-P1', actorId: ACTORS.policy, outputSummary: '政策准入初核完成，提请 Gate。' });

  const returned = decideOk(engine, {
    gateId: 'PG-1', actorId: ACTORS.policy, outcome: 'returned', reason: '补充行业政策依据后再报。',
  });
  assert.equal(returned.receipt, null, '退回不发 Receipt（契约 §7：returned 时 receipt 为 null）');
  assert.equal(engine.getProjection().receipts.length, 0);
  assert.equal(gateOf(engine, 'PG-1').status, 'pending', '退回后 Gate 回到 pending');
  assert.equal(statusOf(engine, 'WI-P1'), 'in_progress', '退回后工作项回到 in_progress');

  // Gate 已回 pending：未重新提交前决定 → GATE_NOT_OPEN
  expectEngineError(
    () => engine.recordDecision({
      commandId: nextCommandId('redo-early'), expectedRev: engine.rev,
      gateId: 'PG-1', actorId: ACTORS.policy, outcome: 'approved', reason: '未重新提交即决定',
    }),
    'GATE_NOT_OPEN',
  );

  // 重新提交 → Gate 再开
  submitOk(engine, { workItemId: 'WI-P1', actorId: ACTORS.policy, outputSummary: '补充行业政策依据后重新提交。' });
  assert.equal(gateOf(engine, 'PG-1').status, 'open');

  // 第二轮：approved 产生新 Receipt
  const approved = decideOk(engine, {
    gateId: 'PG-1', actorId: ACTORS.policy, outcome: 'approved', reason: '补充材料齐备，准入通过。',
  });
  assert.ok(approved.receipt !== null, '第二次 approved 必须产生新 Receipt');
  assert.match(approved.receipt.receiptId, /^rcpt-PG-1-\d+$/, 'receiptId 格式 rcpt-<gateId>-<n>（§7）');
  assert.equal(statusOf(engine, 'WI-P1'), 'completed');
  assert.equal(engine.getProjection().receipts.length, 1);
  assert.equal(statusOf(engine, 'WI-C3'), 'in_progress', 'Receipt 依赖满足 + C1/C2 完成 → WI-C3 才启动');

  // 信审签批链路闭环
  submitOk(engine, { workItemId: 'WI-C3', actorId: ACTORS.credit, outputSummary: '正式信审意见完成。' });
  assert.equal(gateOf(engine, 'CG-1').status, 'open');
  const signed = decideOk(engine, {
    gateId: 'CG-1', actorId: ACTORS.credit, outcome: 'approved', reason: '信审意见签发，附加回款核验条件。',
  });
  assert.ok(signed.receipt !== null);
  assert.match(signed.receipt.receiptId, /^rcpt-CG-1-\d+$/, 'receiptId 格式 rcpt-<gateId>-<n>（§7）');
  assert.equal(statusOf(engine, 'WI-C3'), 'completed');
  assert.equal(engine.getProjection().receipts.length, 2, 'Receipt 按轮次追加');
});

// ---------------------------------------------------------------------------
// 8｜Candidate 不越权
// ---------------------------------------------------------------------------

test('Candidate 不越权｜R1/R2 触发后无任何 workItem 状态因 Candidate 变化；authority 全部 none', () => {
  const engine = makeEngine();
  // 初始状态：WI-P1/WI-C1/WI-A1 因 Evidence 启动；WI-C2/WI-B1/WI-C3 blocked
  assert.equal(statusOf(engine, 'WI-C2'), 'blocked');
  assert.equal(statusOf(engine, 'WI-B1'), 'blocked');

  appendFinancialAndContract(engine); // 触发 R1（financial+contract）与 R2（初始 context 缺 tag）

  const candidates = candidatesOf(engine);
  assert.ok(candidates.length >= 2, 'R1 与 R2 均应触发');
  const contradiction = candidates.find((entry) => entry.kind === 'contradiction');
  const missing = candidates.find((entry) => entry.kind === 'missing_document');
  assert.ok(contradiction !== undefined);
  assert.ok(missing !== undefined);
  for (const candidate of candidates) {
    assert.equal(candidate.authority, 'none', 'Candidate authority 恒为 none');
    assert.equal(candidate.producedBy, 'deterministic-v1');
  }
  assert.equal(contradiction.workItemId, 'WI-C2');
  assert.deepEqual(contradiction.basis, ['ev-financial-statement', 'ev-contract-draft'], 'R1 basis 顺序按 §5');
  assert.equal(missing.workItemId, 'WI-C1');

  // Candidate 只发提醒：工作项状态只按 Evidence 依赖规则变化
  assert.equal(statusOf(engine, 'WI-C2'), 'in_progress', 'WI-C2 启动来自 evidence 依赖，而非 Candidate');
  assert.equal(statusOf(engine, 'WI-C1'), 'in_progress');
  assert.equal(statusOf(engine, 'WI-B1'), 'in_progress');
  assert.equal(statusOf(engine, 'WI-C3'), 'blocked');
  assert.equal(statusOf(engine, 'WI-P1'), 'in_progress');
  assert.equal(statusOf(engine, 'WI-A1'), 'in_progress');
  const projection = engine.getProjection();
  for (const domain of projection.domains) {
    for (const item of domain.workItems) {
      assert.ok(
        !['completed', 'awaiting_gate', 'stopped_dependency'].includes(item.status),
        `Candidate 不得驱动工作项进入正式终态：${item.workItemId}=${item.status}`,
      );
    }
  }
  assert.equal(projection.receipts.length, 0);
});

test('Candidate 不越权｜引擎无 Candidate 驱动正式状态的入口（记录性断言：frozen API surface §7）', () => {
  const engine = makeEngine();
  const names = engineApiNames(engine).sort();
  // P1 语义扩展（Lane E）：§7 frozen surface 追加 5 个新命令方法（changeVerification + 收集窗口四命令，
  // 见 docs/v4/P1_SCHEMA_EXTENSION_PROPOSAL.md A/C 节与 CONTRACT §16.3）；记录性断言随契约面同步更新，
  // 反 Candidate 越权断言保持不变。
  assert.deepEqual(
    names,
    [
      'appendEvidence', 'appendInputEvent', 'caseId', 'changeVerification', 'getEvents',
      'getProjection', 'openContextBatch', 'recordDecision', 'rev', 'sealContextBatch',
      'stabilizeContextBatch', 'submitWork',
    ],
    '引擎公共 API 必须与契约 §7 frozen surface 完全一致',
  );
  for (const name of names) {
    assert.ok(!/candidate/i.test(name), `引擎不得暴露 candidate 入口：${name}`);
  }
});

function engineApiNames(engine) {
  const names = new Set(Object.getOwnPropertyNames(engine));
  let proto = Object.getPrototypeOf(engine);
  while (proto !== null && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name !== 'constructor') names.add(name);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return [...names];
}

// ---------------------------------------------------------------------------
// 9｜事件重放与分页边界、深克隆
// ---------------------------------------------------------------------------

test('事件重放｜全量导出 rebuildProjection(seed, events) 与 getProjection() deepEqual（忽略 generatedAt）', () => {
  const engine = makeEngine();
  buildVetoPrelude(engine);
  decideOk(engine, {
    gateId: 'PG-1', actorId: ACTORS.policy, outcome: 'rejected', reason: '否决级联重放素材。',
  });

  const events = exportAllEvents(engine);
  assert.ok(events.length >= 15, `事件应足够丰富，实际 ${events.length}`);
  assert.equal(events[0].payload.type, 'CASE_INITIALIZED', '事件载荷形状按 §2：payload.type');
  for (let index = 0; index < events.length; index += 1) {
    assert.equal(events[index].seq, index + 1, 'seq 从 1 起连续递增不可跳号');
  }

  const live = engine.getProjection();
  const rebuilt = rebuildProjection(createV4LifeDemoSeed(), events);
  assert.deepEqual(
    stripGeneratedAt(rebuilt),
    stripGeneratedAt(live),
    '重放 Projection 必须与在线 Projection 等价（忽略 generatedAt）',
  );
  const rebuiltWithStamp = rebuildProjection(createV4LifeDemoSeed(), events, live.generatedAt);
  assert.deepEqual(rebuiltWithStamp, live, '显式传入 generatedAt 时应整体相等');
});

test('事件分页｜afterSeq 超出末尾 → 空数组 hasMore=false；limit 截断正确；默认 limit 返回全量余量', () => {
  const engine = makeEngine();
  appendFinancialAndContract(engine);
  const all = engine.getEvents(0, 500);
  assert.ok(all.events.length >= 8);
  assert.equal(all.hasMore, false);

  // limit 截断
  const page1 = engine.getEvents(0, 3);
  assert.equal(page1.events.length, 3);
  assert.deepEqual(page1.events, all.events.slice(0, 3));
  assert.equal(page1.hasMore, true);
  assert.equal(page1.nextSeq, all.nextSeq);
  const page2 = engine.getEvents(3, 3);
  assert.deepEqual(page2.events, all.events.slice(3, 6));
  assert.equal(page2.hasMore, all.nextSeq > 6);
  assert.ok(page2.events.every((event) => event.seq > 3));

  // 默认 limit（100）
  const defaulted = engine.getEvents(0);
  assert.deepEqual(defaulted.events, all.events.slice(0, Math.min(100, all.nextSeq)));

  // afterSeq 超出末尾
  const beyond = engine.getEvents(all.nextSeq + 100, 500);
  assert.deepEqual(beyond.events, []);
  assert.equal(beyond.hasMore, false);
  assert.equal(beyond.nextSeq, all.nextSeq);
});

test('深克隆｜Projection/Events 返回深克隆：外部变异不得污染引擎内部状态', () => {
  const engine = makeEngine();
  appendFinancialAndContract(engine);
  submitOk(engine, { workItemId: 'WI-C1', actorId: ACTORS.credit, outputSummary: '完整性核验完成。' });

  const p1 = engine.getProjection();
  p1.domains[0].workItems[0].status = 'completed';
  p1.contributions.push({ contributionId: 'fake', retainedAfterVeto: false });
  if (Array.isArray(p1.evidence)) p1.evidence.pop();
  p1.receipts.push({ receiptId: 'fake-receipt' });

  const p2 = engine.getProjection();
  assert.notEqual(p2.domains[0].workItems[0].status, 'completed', 'Projection 必须返回深克隆');
  assert.equal(p2.evidence.length, 3, '外部 pop 不得污染 Evidence 列表');
  assert.equal(p2.contributions.length, 1, '外部 push 不得污染贡献列表');
  assert.equal(p2.receipts.length, 0, '外部 push 不得污染 Receipt 列表');
  assert.deepEqual(stripGeneratedAt(p2), stripGeneratedAt(engine.getProjection()), '连续两次读取等价');

  const events = engine.getEvents(0, 500);
  const before = engine.getEvents(0, 500).events.length;
  events.events.pop();
  events.events[0].seq = 999;
  assert.equal(engine.getEvents(0, 500).events.length, before, '外部变更事件数组不得影响引擎');
});

// ---------------------------------------------------------------------------
// 10｜HTTP 层（Route Handler 进程内调用，不起服务；每例先 resetV4LifeRuntime）
// ---------------------------------------------------------------------------

const HTTP_CASE = 'demo-sme-robot-500w';

function httpCaseUrl(caseId = HTTP_CASE, suffix = '') {
  return `https://in-process.test/api/v4life/cases/${encodeURIComponent(caseId)}${suffix}`;
}

function httpContext(caseId = HTTP_CASE) {
  return { params: Promise.resolve({ caseId }) };
}

function httpJson(url, body) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function httpGetProjection(caseId = HTTP_CASE) {
  const response = await caseGET(new Request(httpCaseUrl(caseId)), httpContext(caseId));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json();
}

async function httpRev() {
  return (await httpGetProjection()).rev;
}

async function assertErrorEnvelope(response, status, code) {
  assert.equal(response.status, status, `期望 ${code}，HTTP 状态不符`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: code });
}

test('HTTP｜健康路径：fixture 全链路经 Route Handler 至 CG-1 approved，事件分页可完整走通', async () => {
  resetV4LifeRuntime();

  const p0 = await httpGetProjection();
  assert.equal(p0.case.caseId, HTTP_CASE);
  assert.deepEqual(p0.domains.map((domain) => domain.domain), ['policy', 'credit', 'commerce', 'asset']);
  const credit0 = p0.domains.find((domain) => domain.domain === 'credit');
  assert.ok(credit0.candidates.some((candidate) => candidate.kind === 'missing_document'), '初始 Evidence 触发 R2');

  let rev = p0.rev;
  let response = await evidencePOST(
    httpJson(httpCaseUrl(HTTP_CASE, '/evidence'), { commandId: 'hq-ev-fin', expectedRev: rev, ...FINANCIAL }),
    httpContext(),
  );
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  let body = await response.json();
  assert.equal(body.status, 'accepted');

  response = await evidencePOST(
    httpJson(httpCaseUrl(HTTP_CASE, '/evidence'), { commandId: 'hq-ev-con', expectedRev: body.rev, ...CONTRACT }),
    httpContext(),
  );
  assert.equal(response.status, 201);
  body = await response.json();

  for (const [workItemId, actorId, summary, commandId] of [
    ['WI-C1', ACTORS.credit, '完整性核验完成。', 'hq-w-c1'],
    ['WI-C2', ACTORS.credit, '偿付能力交叉核验完成。', 'hq-w-c2'],
    ['WI-P1', ACTORS.policy, '政策准入初核完成，提请 Gate。', 'hq-w-p1'],
  ]) {
    response = await workPOST(
      httpJson(httpCaseUrl(HTTP_CASE, '/work'), { commandId, expectedRev: body.rev, workItemId, actorId, outputSummary: summary }),
      httpContext(),
    );
    assert.equal(response.status, 200, `${workItemId} 提交应成功`);
    body = await response.json();
  }

  response = await decisionsPOST(
    httpJson(httpCaseUrl(HTTP_CASE, '/decisions'), {
      commandId: 'hq-dec-pg1', expectedRev: body.rev, gateId: 'PG-1',
      actorId: ACTORS.policy, outcome: 'approved', reason: '行业不在禁入清单，准入通过。',
    }),
    httpContext(),
  );
  assert.equal(response.status, 201);
  body = await response.json();
  assert.ok(body.receipt !== null && body.receipt !== undefined, '批准必须返回 Receipt');

  let projection = await httpGetProjection();
  assert.equal(getItem(projection, 'WI-C3').status, 'in_progress', 'Receipt 依赖满足后 WI-C3 启动');

  response = await workPOST(
    httpJson(httpCaseUrl(HTTP_CASE, '/work'), {
      commandId: 'hq-w-c3', expectedRev: body.rev, workItemId: 'WI-C3',
      actorId: ACTORS.credit, outputSummary: '正式信审意见完成。',
    }),
    httpContext(),
  );
  assert.equal(response.status, 200);
  body = await response.json();
  assert.equal(body.workItem.status, 'awaiting_gate');

  response = await decisionsPOST(
    httpJson(httpCaseUrl(HTTP_CASE, '/decisions'), {
      commandId: 'hq-dec-cg1', expectedRev: body.rev, gateId: 'CG-1',
      actorId: ACTORS.credit, outcome: 'approved', reason: '信审意见签发。',
    }),
    httpContext(),
  );
  assert.equal(response.status, 201);
  body = await response.json();
  assert.ok(body.receipt !== null);

  const pEnd = await httpGetProjection();
  assert.equal(getItem(pEnd, 'WI-C3').status, 'completed');
  assert.equal(pEnd.receipts.length, 2);

  // 事件分页完整走通
  const collected = [];
  let afterSeq = 0;
  for (let guard = 0; guard < 100; guard += 1) {
    const pageResponse = await eventsGET(
      new Request(httpCaseUrl(HTTP_CASE, `/events?afterSeq=${afterSeq}&limit=100`)),
      httpContext(),
    );
    assert.equal(pageResponse.status, 200);
    const page = await pageResponse.json();
    collected.push(...page.events);
    if (!page.hasMore) {
      assert.equal(page.nextSeq, pEnd.eventCount);
      break;
    }
    afterSeq = collected[collected.length - 1].seq;
  }
  assert.equal(collected.length, pEnd.eventCount, '分页拼出的全量事件数必须等于 eventCount');
  for (let index = 0; index < collected.length; index += 1) {
    assert.equal(collected[index].seq, index + 1);
  }
});

test('HTTP｜幂等重放一致性：同 commandId 双发 → 201/200 replayed，事件与 Projection 不变', async () => {
  resetV4LifeRuntime();
  let rev = await httpRev();

  let response = await evidencePOST(
    httpJson(httpCaseUrl(HTTP_CASE, '/evidence'), { commandId: 'hq-idem-fin', expectedRev: rev, ...FINANCIAL }),
    httpContext(),
  );
  assert.equal(response.status, 201);
  let body = await response.json();

  for (const [workItemId, actorId, summary, commandId] of [
    ['WI-C1', ACTORS.credit, '完整性核验完成。', 'hq-idem-w1'],
    ['WI-C2', ACTORS.credit, '偿付能力交叉核验完成。', 'hq-idem-w2'],
    ['WI-P1', ACTORS.policy, '政策准入初核完成，提请 Gate。', 'hq-idem-w3'],
  ]) {
    response = await workPOST(
      httpJson(httpCaseUrl(HTTP_CASE, '/work'), { commandId, expectedRev: body.rev, workItemId, actorId, outputSummary: summary }),
      httpContext(),
    );
    body = await response.json();
  }

  const decisionBody = {
    commandId: 'hq-idem-dec', expectedRev: body.rev, gateId: 'PG-1',
    actorId: ACTORS.policy, outcome: 'approved', reason: '准入通过。',
  };
  const first = await decisionsPOST(httpJson(httpCaseUrl(HTTP_CASE, '/decisions'), decisionBody), httpContext());
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  assert.ok(firstBody.receipt !== null);

  const snapshotBefore = await httpGetProjection();

  const second = await decisionsPOST(httpJson(httpCaseUrl(HTTP_CASE, '/decisions'), decisionBody), httpContext());
  assert.equal(second.status, 200, '重放返回 200');
  const secondBody = await second.json();
  assert.equal(secondBody.status, 'replayed');
  assert.equal(secondBody.rev, firstBody.rev);
  assert.deepEqual(secondBody.receipt, firstBody.receipt);

  const snapshotAfter = await httpGetProjection();
  assert.deepEqual(stripGeneratedAt(snapshotAfter), stripGeneratedAt(snapshotBefore), '重放后 Projection 不变');

  // evidence 同 commandId 双发
  const evidenceBody = { commandId: 'hq-idem-con', expectedRev: await httpRev(), ...CONTRACT };
  const evFirst = await evidencePOST(httpJson(httpCaseUrl(HTTP_CASE, '/evidence'), evidenceBody), httpContext());
  assert.equal(evFirst.status, 201);
  const evSecond = await evidencePOST(httpJson(httpCaseUrl(HTTP_CASE, '/evidence'), evidenceBody), httpContext());
  assert.equal(evSecond.status, 200, 'evidence 重放返回 200');
  const evSecondBody = await evSecond.json();
  assert.equal(evSecondBody.status, 'replayed');
  assert.equal(evSecondBody.rev, (await evFirst.json()).rev);
});

test('HTTP｜失败矩阵：404/400/403/409 全类别，错误 envelope 统一 {error: CODE}', async () => {
  resetV4LifeRuntime();

  // 404 CASE_NOT_FOUND（GET 与 POST 两条路径）
  await assertErrorEnvelope(
    await caseGET(new Request(httpCaseUrl('unknown-case')), httpContext('unknown-case')),
    404, 'CASE_NOT_FOUND',
  );
  await assertErrorEnvelope(
    await evidencePOST(
      httpJson(httpCaseUrl('unknown-case', '/evidence'), { commandId: 'x', expectedRev: 0, ...FINANCIAL }),
      httpContext('unknown-case'),
    ),
    404, 'CASE_NOT_FOUND',
  );

  let rev = await httpRev();

  // 400 INVALID_ENGINE_INPUT（空 commandId）
  await assertErrorEnvelope(
    await evidencePOST(
      httpJson(httpCaseUrl(HTTP_CASE, '/evidence'), { commandId: '', expectedRev: rev, ...FINANCIAL }),
      httpContext(),
    ),
    400, 'INVALID_ENGINE_INPUT',
  );

  // 409 WORK_ITEM_NOT_ACTIVE（blocked 项直接提交）
  await assertErrorEnvelope(
    await workPOST(
      httpJson(httpCaseUrl(HTTP_CASE, '/work'), {
        commandId: 'hq-f-c3', expectedRev: rev, workItemId: 'WI-C3',
        actorId: ACTORS.credit, outputSummary: '绕过硬等待',
      }),
      httpContext(),
    ),
    409, 'WORK_ITEM_NOT_ACTIVE',
  );

  // 403 ROLE_MISMATCH（submitWork 越权）
  await assertErrorEnvelope(
    await workPOST(
      httpJson(httpCaseUrl(HTTP_CASE, '/work'), {
        commandId: 'hq-f-role', expectedRev: rev, workItemId: 'WI-C1',
        actorId: ACTORS.policy, outputSummary: '越权提交',
      }),
      httpContext(),
    ),
    403, 'ROLE_MISMATCH',
  );

  // 409 GATE_NOT_OPEN（linked item 未提交即决定）
  await assertErrorEnvelope(
    await decisionsPOST(
      httpJson(httpCaseUrl(HTTP_CASE, '/decisions'), {
        commandId: 'hq-f-open', expectedRev: rev, gateId: 'PG-1',
        actorId: ACTORS.policy, outcome: 'approved', reason: 'Gate 未开',
      }),
      httpContext(),
    ),
    409, 'GATE_NOT_OPEN',
  );

  // 推进到 PG-1 open
  let response = await workPOST(
    httpJson(httpCaseUrl(HTTP_CASE, '/work'), {
      commandId: 'hq-f-p1', expectedRev: rev, workItemId: 'WI-P1',
      actorId: ACTORS.policy, outputSummary: '政策准入初核完成，提请 Gate。',
    }),
    httpContext(),
  );
  assert.equal(response.status, 200);

  // 403 ROLE_MISMATCH（recordDecision 越权）
  await assertErrorEnvelope(
    await decisionsPOST(
      httpJson(httpCaseUrl(HTTP_CASE, '/decisions'), {
        commandId: 'hq-f-dec-role', expectedRev: await httpRev(), gateId: 'PG-1',
        actorId: ACTORS.credit, outcome: 'approved', reason: '越权决定',
      }),
      httpContext(),
    ),
    403, 'ROLE_MISMATCH',
  );

  // 409 VERSION_CONFLICT（两命令同一 expectedRev，第一条接受）
  rev = await httpRev();
  response = await evidencePOST(
    httpJson(httpCaseUrl(HTTP_CASE, '/evidence'), { commandId: 'hq-race-a', expectedRev: rev, ...FINANCIAL }),
    httpContext(),
  );
  assert.equal(response.status, 201);
  await assertErrorEnvelope(
    await evidencePOST(
      httpJson(httpCaseUrl(HTTP_CASE, '/evidence'), { commandId: 'hq-race-b', expectedRev: rev, ...CONTRACT }),
      httpContext(),
    ),
    409, 'VERSION_CONFLICT',
  );

  // 409 IDEMPOTENCY_CONFLICT（同 commandId 异载荷）
  await assertErrorEnvelope(
    await evidencePOST(
      httpJson(httpCaseUrl(HTTP_CASE, '/evidence'), { commandId: 'hq-race-a', expectedRev: await httpRev(), ...CONTRACT }),
      httpContext(),
    ),
    409, 'IDEMPOTENCY_CONFLICT',
  );

  // 409 EVIDENCE_CONFLICT（同 evidenceId 异载荷，不同 commandId）
  await assertErrorEnvelope(
    await evidencePOST(
      httpJson(httpCaseUrl(HTTP_CASE, '/evidence'), {
        commandId: 'hq-ev-forge', expectedRev: await httpRev(),
        evidenceId: FINANCIAL.evidenceId, kind: FINANCIAL.kind,
        title: '被篡改的标题', submittedBy: ACTORS.business,
        payload: { summary: '伪造载荷', tags: ['forged'] },
      }),
      httpContext(),
    ),
    409, 'EVIDENCE_CONFLICT',
  );
});

test('HTTP｜事件分页参数：limit 截断正确、afterSeq 越界返回空数组 hasMore=false', async () => {
  resetV4LifeRuntime();
  let rev = await httpRev();
  let response = await evidencePOST(
    httpJson(httpCaseUrl(HTTP_CASE, '/evidence'), { commandId: 'hq-page-fin', expectedRev: rev, ...FINANCIAL }),
    httpContext(),
  );
  assert.equal(response.status, 201);
  response = await evidencePOST(
    httpJson(httpCaseUrl(HTTP_CASE, '/evidence'), { commandId: 'hq-page-con', expectedRev: (await response.json()).rev, ...CONTRACT }),
    httpContext(),
  );
  assert.equal(response.status, 201);

  const fullResponse = await eventsGET(
    new Request(httpCaseUrl(HTTP_CASE, '/events?afterSeq=0&limit=500')),
    httpContext(),
  );
  assert.equal(fullResponse.status, 200);
  const full = await fullResponse.json();
  assert.ok(full.events.length >= 8);

  const limitedResponse = await eventsGET(
    new Request(httpCaseUrl(HTTP_CASE, '/events?afterSeq=0&limit=2')),
    httpContext(),
  );
  const limited = await limitedResponse.json();
  assert.equal(limited.events.length, 2, 'limit 截断');
  assert.deepEqual(limited.events, full.events.slice(0, 2));
  assert.equal(limited.hasMore, true);
  assert.equal(limited.nextSeq, full.nextSeq);

  const beyondResponse = await eventsGET(
    new Request(httpCaseUrl(HTTP_CASE, `/events?afterSeq=${full.nextSeq + 99}&limit=5`)),
    httpContext(),
  );
  assert.equal(beyondResponse.status, 200);
  const beyond = await beyondResponse.json();
  assert.deepEqual(beyond.events, []);
  assert.equal(beyond.hasMore, false);
  assert.equal(beyond.nextSeq, full.nextSeq);
});
