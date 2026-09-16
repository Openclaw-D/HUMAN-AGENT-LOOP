// Lane B｜Store 与事件重放 测试
// 契约：docs/v4/CONTRACT.md §2/§7/§8/§9/§11
// 运行：node --experimental-strip-types --test --experimental-test-isolation=none test/v4life-lane-b-store.test.mjs
// 说明：与在线引擎的等价断言（文件末尾两个 test）按 CONTRACT §2/§7/§8 做 feature detection；
//       若 Lane A 的 engine.ts 尚未落地新契约，则显式 skip 并标注 PENDING_LANE_A_INTEGRATION。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryEventLog } from '../lib/v4life/event-log.ts';
import { rebuildProjection } from '../lib/v4life/replay.ts';
import { createV4LifeDemoSeed } from '../lib/v4life/seed.ts';
import { createV4LifeEngine } from '../lib/v4life/engine.ts';

const CASE_ID = 'demo-sme-robot-500w';
const T = (suffix) => `2026-09-03T00:00:${suffix}.000Z`;

function ev(seq, at, actor, payload) {
  return { seq, at, actor, payload };
}

function withSeq(defs) {
  // defs: Array<[actor, at, payload]> → seq 从 1 连续编号
  return defs.map(([actor, at, payload], index) => ev(index + 1, at, actor, payload));
}

function invalidErrorCode(fn) {
  try {
    fn();
  } catch (error) {
    return error?.code ?? null;
  }
  return null;
}

// ---------- 合成 fixtures（全部载荷完整，与 CONTRACT §1/§2 一致） ----------

const evidenceUpstream = {
  evidenceId: 'ev-upstream-context',
  caseId: CASE_ID,
  kind: 'upstream_context',
  title: '上游受理与尽调核验后的项目 Context',
  submittedBy: 'actor-business-chen',
  submittedAt: T('02'),
  version: 1,
  payload: { summary: '企业成立于 2016 年，申请 500 万元。', amountCny: 5_000_000, tags: ['business_license'] },
};

const evidenceFinancial = {
  evidenceId: 'ev-financial-statement',
  caseId: CASE_ID,
  kind: 'financial_statement',
  title: '客户财务报表（合成）',
  submittedBy: 'actor-business-chen',
  submittedAt: T('10'),
  version: 1,
  payload: { summary: '营收连续两个季度下滑。', amountCny: 4_800_000, tags: ['revenue_declining'] },
};

const evidenceContract = {
  evidenceId: 'ev-contract-draft',
  caseId: CASE_ID,
  kind: 'contract_draft',
  title: '设备采购合同草案（合成）',
  submittedBy: 'actor-commerce-wang',
  submittedAt: T('12'),
  version: 1,
  payload: { summary: '合同金额 520 万元。', amountCny: 5_200_000, tags: ['equipment_purchase'] },
};

const candidateR2 = {
  candidateId: 'cand-missing-1',
  caseId: CASE_ID,
  domain: 'credit',
  workItemId: 'WI-C1',
  kind: 'missing_document',
  summary: '上游 Context 缺少核验标记：due_diligence_report，信审完整性核验需要补件。',
  basis: ['ev-upstream-context'],
  authority: 'none',
  producedBy: 'deterministic-v1',
  createdAt: T('03'),
  dedupeKey: 'missing_document|WI-C1|ev-upstream-context',
};

const candidateR1 = {
  candidateId: 'cand-contradiction-1',
  caseId: CASE_ID,
  domain: 'credit',
  workItemId: 'WI-C2',
  kind: 'contradiction',
  summary: '合同金额 5200000 元与财务报表“营收下滑”口径存在张力。',
  basis: ['ev-contract-draft', 'ev-financial-statement'],
  authority: 'none',
  producedBy: 'deterministic-v1',
  createdAt: T('13'),
  dedupeKey: 'contradiction|WI-C2|ev-contract-draft,ev-financial-statement',
};

function contribution(id, actorId, workItemId, at) {
  return {
    contributionId: id,
    actorId,
    domain: workItemId.startsWith('WI-P') ? 'policy' : 'credit',
    workItemId,
    kind: 'cross_check',
    summary: `${workItemId} 专业判断记录（保留于否决之后）`,
    recordedAt: at,
    retainedAfterVeto: true,
  };
}

const decisionP1Approved = {
  outcome: 'approved',
  actorId: 'actor-policy-li',
  reason: '政策准入核验通过。',
  decidedAt: T('40'),
};
const receiptP1Approved = { receiptId: 'rcpt-PG-1-1', gateId: 'PG-1', decision: decisionP1Approved };

const decisionP1Rejected = {
  outcome: 'rejected',
  actorId: 'actor-policy-li',
  reason: '政策准入不符，否决。',
  decidedAt: T('40'),
};
const receiptP1Rejected = { receiptId: 'rcpt-PG-1-1', gateId: 'PG-1', decision: decisionP1Rejected };

const decisionP1Returned = {
  outcome: 'returned',
  actorId: 'actor-policy-li',
  reason: '材料不完整，退回补件。',
  decidedAt: T('20'),
};

const decisionCgApproved = {
  outcome: 'approved',
  actorId: 'actor-credit-zhang',
  reason: '信审签批通过。',
  decidedAt: T('60'),
};
const receiptCgApproved = { receiptId: 'rcpt-CG-1-1', gateId: 'CG-1', decision: decisionCgApproved };

// 覆盖全部 10 种事件类型的主干序列（CASE_INITIALIZED / EVIDENCE_ACCEPTED / CANDIDATE_ISSUED /
// WORK_ITEM_STARTED / WORK_ITEM_SUBMITTED / CONTRIBUTION_RECORDED / WORK_ITEM_COMPLETED /
// GATE_OPENED / DECISION_RECORDED；WORK_ITEM_STOPPED 与 returned 由独立序列覆盖）
function happyPathEvents() {
  return withSeq([
    ['system', T('01'), { type: 'CASE_INITIALIZED', caseId: CASE_ID }],
    ['actor-business-chen', T('02'), { type: 'EVIDENCE_ACCEPTED', evidence: structuredClone(evidenceUpstream) }],
    ['system', T('03'), { type: 'CANDIDATE_ISSUED', candidate: structuredClone(candidateR2) }],
    ['system', T('04'), { type: 'WORK_ITEM_STARTED', workItemId: 'WI-P1' }],
    ['system', T('05'), { type: 'WORK_ITEM_STARTED', workItemId: 'WI-C1' }],
    ['system', T('06'), { type: 'WORK_ITEM_STARTED', workItemId: 'WI-A1' }],
    ['actor-business-chen', T('10'), { type: 'EVIDENCE_ACCEPTED', evidence: structuredClone(evidenceFinancial) }],
    ['system', T('11'), { type: 'WORK_ITEM_STARTED', workItemId: 'WI-C2' }],
    ['actor-commerce-wang', T('12'), { type: 'EVIDENCE_ACCEPTED', evidence: structuredClone(evidenceContract) }],
    ['system', T('13'), { type: 'CANDIDATE_ISSUED', candidate: structuredClone(candidateR1) }],
    ['system', T('14'), { type: 'WORK_ITEM_STARTED', workItemId: 'WI-B1' }],
    ['actor-credit-zhang', T('20'), {
      type: 'WORK_ITEM_SUBMITTED', workItemId: 'WI-C1', actorId: 'actor-credit-zhang', outputSummary: '材料完整性核验完成。',
    }],
    ['system', T('20'), { type: 'CONTRIBUTION_RECORDED', contribution: contribution('contrib-1', 'actor-credit-zhang', 'WI-C1', T('20')) }],
    ['actor-credit-zhang', T('21'), { type: 'WORK_ITEM_COMPLETED', workItemId: 'WI-C1', by: 'actor-credit-zhang' }],
    ['actor-credit-zhang', T('22'), {
      type: 'WORK_ITEM_SUBMITTED', workItemId: 'WI-C2', actorId: 'actor-credit-zhang', outputSummary: '偿付能力交叉核验完成。',
    }],
    ['system', T('22'), { type: 'CONTRIBUTION_RECORDED', contribution: contribution('contrib-2', 'actor-credit-zhang', 'WI-C2', T('22')) }],
    ['actor-credit-zhang', T('23'), { type: 'WORK_ITEM_COMPLETED', workItemId: 'WI-C2', by: 'actor-credit-zhang' }],
    ['actor-policy-li', T('30'), {
      type: 'WORK_ITEM_SUBMITTED', workItemId: 'WI-P1', actorId: 'actor-policy-li', outputSummary: '政策准入初核完成。',
    }],
    ['system', T('30'), { type: 'CONTRIBUTION_RECORDED', contribution: contribution('contrib-3', 'actor-policy-li', 'WI-P1', T('30')) }],
    ['system', T('31'), { type: 'GATE_OPENED', gateId: 'PG-1', workItemId: 'WI-P1' }],
    ['actor-policy-li', T('40'), { type: 'DECISION_RECORDED', gateId: 'PG-1', decision: decisionP1Approved, receipt: receiptP1Approved }],
    ['actor-policy-li', T('41'), { type: 'WORK_ITEM_COMPLETED', workItemId: 'WI-P1', by: 'actor-policy-li' }],
    ['system', T('42'), { type: 'WORK_ITEM_STARTED', workItemId: 'WI-C3' }],
    ['actor-credit-zhang', T('50'), {
      type: 'WORK_ITEM_SUBMITTED', workItemId: 'WI-C3', actorId: 'actor-credit-zhang', outputSummary: '正式信审意见完成。',
    }],
    ['system', T('50'), { type: 'CONTRIBUTION_RECORDED', contribution: contribution('contrib-4', 'actor-credit-zhang', 'WI-C3', T('50')) }],
    ['system', T('51'), { type: 'GATE_OPENED', gateId: 'CG-1', workItemId: 'WI-C3' }],
    ['actor-credit-zhang', T('60'), { type: 'DECISION_RECORDED', gateId: 'CG-1', decision: decisionCgApproved, receipt: receiptCgApproved }],
    ['actor-credit-zhang', T('61'), { type: 'WORK_ITEM_COMPLETED', workItemId: 'WI-C3', by: 'actor-credit-zhang' }],
  ]);
}

function domainOf(projection, domain) {
  return projection.domains.find((entry) => entry.domain === domain);
}
function workItemOf(projection, workItemId) {
  for (const entry of projection.domains) {
    const found = entry.workItems.find((item) => item.workItemId === workItemId);
    if (found !== undefined) return found;
  }
  return undefined;
}
function gateOf(projection, gateId) {
  for (const entry of projection.domains) {
    const found = entry.gates.find((gate) => gate.gateId === gateId);
    if (found !== undefined) return found;
  }
  return undefined;
}
function stripGeneratedAt(projection) {
  const clone = structuredClone(projection);
  delete clone.generatedAt;
  return clone;
}

// ---------- 1. 事件账本：条件追加 ----------

test('event log append: expectedLastSeq 命中成功、过期返回 SEQ_CONFLICT 且不部分写入、seq 严格单调', () => {
  const log = createInMemoryEventLog();
  const first = ev(1, T('01'), 'system', { type: 'CASE_INITIALIZED', caseId: CASE_ID });
  const second = ev(2, T('02'), 'actor-business-chen', { type: 'EVIDENCE_ACCEPTED', evidence: structuredClone(evidenceUpstream) });
  const third = ev(3, T('03'), 'system', { type: 'WORK_ITEM_STARTED', workItemId: 'WI-P1' });

  assert.deepEqual(log.append(CASE_ID, 0, [first]), { ok: true });
  assert.deepEqual(log.append(CASE_ID, 1, [second, third]), { ok: true });

  // 过期 expectedLastSeq → SEQ_CONFLICT + 当前 lastSeq，不写入
  const stale = log.append(CASE_ID, 0, [ev(4, T('04'), 'system', { type: 'WORK_ITEM_STARTED', workItemId: 'WI-C1' })]);
  assert.deepEqual(stale, { ok: false, reason: 'SEQ_CONFLICT', lastSeq: 3 });
  assert.equal(log.loadAll(CASE_ID).length, 3);

  // 批内跳号 → SEQ_CONFLICT，绝不部分写入
  const gap = log.append(CASE_ID, 3, [
    ev(4, T('04'), 'system', { type: 'WORK_ITEM_STARTED', workItemId: 'WI-C1' }),
    ev(6, T('06'), 'system', { type: 'WORK_ITEM_STARTED', workItemId: 'WI-A1' }),
  ]);
  assert.deepEqual(gap, { ok: false, reason: 'SEQ_CONFLICT', lastSeq: 3 });
  assert.equal(log.loadAll(CASE_ID).length, 3);

  // 超前单个事件 → SEQ_CONFLICT
  const ahead = log.append(CASE_ID, 3, [ev(5, T('05'), 'system', { type: 'WORK_ITEM_STARTED', workItemId: 'WI-A1' })]);
  assert.deepEqual(ahead, { ok: false, reason: 'SEQ_CONFLICT', lastSeq: 3 });

  // 命中后续写：seq 严格 +1
  assert.deepEqual(log.append(CASE_ID, 3, [
    ev(4, T('04'), 'system', { type: 'WORK_ITEM_STARTED', workItemId: 'WI-C1' }),
    ev(5, T('05'), 'system', { type: 'WORK_ITEM_STARTED', workItemId: 'WI-A1' }),
  ]), { ok: true });
  assert.deepEqual(log.loadAll(CASE_ID).map((event) => event.seq), [1, 2, 3, 4, 5]);

  // 未知 case 的 loadAll 为空数组；listCaseIds 记录出现过的 case
  assert.deepEqual(log.loadAll('no-such-case'), []);
  assert.ok(log.listCaseIds().includes(CASE_ID));
});

test('event log snapshots: export/import 往返 deepEqual，快照与读取均为深克隆', () => {
  const source = createInMemoryEventLog();
  const events = happyPathEvents().slice(0, 6);
  assert.deepEqual(source.append(CASE_ID, 0, events), { ok: true });

  const snapshot = source.exportSnapshot(CASE_ID);
  assert.ok(Array.isArray(snapshot));
  assert.equal(snapshot.length, 6);

  // 快照是深克隆：改动返回值不影响账本
  snapshot[1].payload.evidence.payload.tags.push('MUTATED');
  assert.equal(source.loadAll(CASE_ID)[1].payload.evidence.payload.tags.includes('MUTATED'), false);

  const target = createInMemoryEventLog();
  target.importSnapshot(CASE_ID, source.exportSnapshot(CASE_ID));
  assert.deepEqual(target.loadAll(CASE_ID), source.loadAll(CASE_ID));

  // import 之后可以按 lastSeq 继续条件追加
  const lastSeq = target.loadAll(CASE_ID).length;
  assert.deepEqual(target.append(CASE_ID, lastSeq, [
    ev(lastSeq + 1, T('07'), 'system', { type: 'WORK_ITEM_STARTED', workItemId: 'WI-P1' }),
  ]), { ok: true });
  assert.equal(target.loadAll(CASE_ID).length, lastSeq + 1);

  // 读取是深克隆：改动读结果不影响账本
  const loaded = target.loadAll(CASE_ID);
  loaded[0].payload.caseId = 'HACKED';
  assert.equal(target.loadAll(CASE_ID)[0].payload.caseId, CASE_ID);

  // 未知 case → null
  assert.equal(source.exportSnapshot('no-such-case'), null);
});

test('event log importSnapshot: 跳号/重复/不从 1/非法载荷 一律 INVALID_ENGINE_INPUT 拒绝', () => {
  const log = createInMemoryEventLog();
  const base = happyPathEvents().slice(0, 3);

  const gap = structuredClone(base);
  gap[1].seq = 3;
  assert.equal(invalidErrorCode(() => log.importSnapshot(CASE_ID, gap)), 'INVALID_ENGINE_INPUT');

  const duplicate = structuredClone(base);
  duplicate[1].seq = 1;
  assert.equal(invalidErrorCode(() => log.importSnapshot(CASE_ID, duplicate)), 'INVALID_ENGINE_INPUT');

  const notFromOne = structuredClone(base);
  notFromOne[0].seq = 2;
  assert.equal(invalidErrorCode(() => log.importSnapshot(CASE_ID, notFromOne)), 'INVALID_ENGINE_INPUT');

  assert.equal(invalidErrorCode(() => log.importSnapshot(CASE_ID, [{ at: T('01'), actor: 'system', payload: {} }])), 'INVALID_ENGINE_INPUT');
  assert.equal(invalidErrorCode(() => log.importSnapshot(CASE_ID, 'not-an-array')), 'INVALID_ENGINE_INPUT');
  assert.equal(invalidErrorCode(() => log.importSnapshot('', base)), 'INVALID_ENGINE_INPUT');

  // 被拒绝的导入不留下半写状态
  assert.deepEqual(log.loadAll(CASE_ID), []);
  assert.deepEqual(log.listCaseIds(), []);
});

// ---------- 2. rebuildProjection：手工全量事件折叠 ----------

test('rebuildProjection: 全事件类型序列折叠出契约 §8 Projection（状态/receipts/contributions/candidates/rev）', () => {
  const seed = createV4LifeDemoSeed();
  const events = happyPathEvents();
  const projection = rebuildProjection(seed, events, T('99'));

  assert.equal(projection.rev, events.length);
  assert.equal(projection.eventCount, events.length);
  assert.equal(projection.evidenceCount, 3);
  assert.deepEqual(projection.case, structuredClone(seed.case));
  assert.deepEqual(projection.domains.map((entry) => entry.domain), ['policy', 'credit', 'commerce', 'asset']);

  // policy 域：WI-P1 经 PG-1 批准完成
  const wiP1 = workItemOf(projection, 'WI-P1');
  assert.equal(wiP1.status, 'completed');
  assert.equal(wiP1.outputSummary, '政策准入初核完成。');
  assert.equal(wiP1.submittedBy, 'actor-policy-li');
  assert.equal(wiP1.submittedAt, T('30'));
  assert.equal(wiP1.completedAt, T('41'));
  const pg1 = gateOf(projection, 'PG-1');
  assert.equal(pg1.status, 'decided');
  assert.equal(pg1.openedAt, T('31'));
  assert.deepEqual(domainOf(projection, 'policy').candidates, []);

  // credit 域：WI-C1/WI-C2 无 Gate 直完成；WI-C3 硬等待 PG-1 Receipt 后完成
  assert.equal(workItemOf(projection, 'WI-C1').status, 'completed');
  assert.equal(workItemOf(projection, 'WI-C1').completedAt, T('21'));
  assert.equal(workItemOf(projection, 'WI-C2').status, 'completed');
  const wiC3 = workItemOf(projection, 'WI-C3');
  assert.equal(wiC3.status, 'completed');
  assert.equal(wiC3.submittedAt, T('50'));
  const cg1 = gateOf(projection, 'CG-1');
  assert.equal(cg1.status, 'decided');
  assert.equal(cg1.openedAt, T('51'));
  assert.deepEqual(
    domainOf(projection, 'credit').candidates.map((candidate) => candidate.candidateId),
    ['cand-missing-1', 'cand-contradiction-1'],
  );

  // 无依赖跨域并行项不受 Gate 流程影响
  assert.equal(workItemOf(projection, 'WI-B1').status, 'in_progress');
  assert.equal(workItemOf(projection, 'WI-A1').status, 'in_progress');

  // receipts / contributions 按事件出现顺序；无 open gates
  assert.deepEqual(projection.receipts.map((receipt) => receipt.receiptId), ['rcpt-PG-1-1', 'rcpt-CG-1-1']);
  assert.equal(projection.receipts[0].decision.outcome, 'approved');
  assert.deepEqual(
    projection.contributions.map((entry) => entry.contributionId),
    ['contrib-1', 'contrib-2', 'contrib-3', 'contrib-4'],
  );
  for (const entry of projection.contributions) {
    assert.equal(entry.retainedAfterVeto, true);
  }
  assert.deepEqual(projection.openGates, []);
  assert.equal(projection.generatedAt, T('99'));

  // 同输入两次折叠 deepEqual（确定性）
  assert.deepEqual(rebuildProjection(seed, events, T('99')), projection);
});

test('rebuildProjection: PG-1 rejected → WI-C3 stopped_dependency，贡献保留，无关域不受影响', () => {
  const seed = createV4LifeDemoSeed();
  const events = withSeq([
    ['system', T('01'), { type: 'CASE_INITIALIZED', caseId: CASE_ID }],
    ['actor-business-chen', T('02'), { type: 'EVIDENCE_ACCEPTED', evidence: structuredClone(evidenceUpstream) }],
    ['system', T('03'), { type: 'WORK_ITEM_STARTED', workItemId: 'WI-P1' }],
    ['system', T('04'), { type: 'WORK_ITEM_STARTED', workItemId: 'WI-C1' }],
    ['system', T('05'), { type: 'WORK_ITEM_STARTED', workItemId: 'WI-A1' }],
    ['system', T('06'), { type: 'CANDIDATE_ISSUED', candidate: structuredClone(candidateR2) }],
    ['actor-credit-zhang', T('20'), {
      type: 'WORK_ITEM_SUBMITTED', workItemId: 'WI-C1', actorId: 'actor-credit-zhang', outputSummary: '材料完整性核验完成。',
    }],
    ['system', T('20'), { type: 'CONTRIBUTION_RECORDED', contribution: contribution('contrib-1', 'actor-credit-zhang', 'WI-C1', T('20')) }],
    ['actor-credit-zhang', T('21'), { type: 'WORK_ITEM_COMPLETED', workItemId: 'WI-C1', by: 'actor-credit-zhang' }],
    ['actor-policy-li', T('30'), {
      type: 'WORK_ITEM_SUBMITTED', workItemId: 'WI-P1', actorId: 'actor-policy-li', outputSummary: '政策准入初核完成。',
    }],
    ['system', T('30'), { type: 'CONTRIBUTION_RECORDED', contribution: contribution('contrib-2', 'actor-policy-li', 'WI-P1', T('30')) }],
    ['system', T('31'), { type: 'GATE_OPENED', gateId: 'PG-1', workItemId: 'WI-P1' }],
    ['actor-policy-li', T('40'), { type: 'DECISION_RECORDED', gateId: 'PG-1', decision: decisionP1Rejected, receipt: receiptP1Rejected }],
    ['actor-policy-li', T('41'), { type: 'WORK_ITEM_COMPLETED', workItemId: 'WI-P1', by: 'actor-policy-li' }],
    ['system', T('42'), { type: 'WORK_ITEM_STOPPED', workItemId: 'WI-C3', reason: 'upstream_gate_rejected' }],
  ]);
  const projection = rebuildProjection(seed, events, T('99'));

  assert.equal(events.length, 15);
  assert.equal(projection.rev, 15);
  assert.equal(projection.eventCount, 15);
  assert.equal(workItemOf(projection, 'WI-C3').status, 'stopped_dependency');
  assert.equal(workItemOf(projection, 'WI-C1').status, 'completed');
  assert.equal(workItemOf(projection, 'WI-C2').status, 'blocked');
  assert.equal(workItemOf(projection, 'WI-A1').status, 'in_progress');
  assert.equal(workItemOf(projection, 'WI-B1').status, 'blocked');

  // 否决后贡献保留：contrib-1（WI-C1）与 contrib-2（WI-P1）都在
  assert.deepEqual(
    projection.contributions.map((entry) => entry.contributionId),
    ['contrib-1', 'contrib-2'],
  );
  // Candidate 不越权：保留但状态不变
  assert.equal(domainOf(projection, 'credit').candidates.length, 1);
  assert.equal(domainOf(projection, 'credit').candidates[0].authority, 'none');

  // Receipt 为否决 Receipt，gate decided，无 open gates
  assert.equal(projection.receipts.length, 1);
  assert.equal(projection.receipts[0].decision.outcome, 'rejected');
  assert.equal(gateOf(projection, 'PG-1').status, 'decided');
  assert.deepEqual(projection.openGates, []);
});

test('rebuildProjection: returned → gate 回 pending、linked item 回 in_progress；重做轮可再开再批', () => {
  const seed = createV4LifeDemoSeed();
  const events = withSeq([
    ['system', T('01'), { type: 'CASE_INITIALIZED', caseId: CASE_ID }],
    ['actor-business-chen', T('02'), { type: 'EVIDENCE_ACCEPTED', evidence: structuredClone(evidenceUpstream) }],
    ['system', T('03'), { type: 'WORK_ITEM_STARTED', workItemId: 'WI-P1' }],
    ['actor-policy-li', T('10'), {
      type: 'WORK_ITEM_SUBMITTED', workItemId: 'WI-P1', actorId: 'actor-policy-li', outputSummary: '政策准入初核 v1。',
    }],
    ['system', T('10'), { type: 'CONTRIBUTION_RECORDED', contribution: contribution('contrib-1', 'actor-policy-li', 'WI-P1', T('10')) }],
    ['system', T('11'), { type: 'GATE_OPENED', gateId: 'PG-1', workItemId: 'WI-P1' }],
    ['actor-policy-li', T('20'), { type: 'DECISION_RECORDED', gateId: 'PG-1', decision: decisionP1Returned, receipt: null }],
    ['actor-policy-li', T('30'), {
      type: 'WORK_ITEM_SUBMITTED', workItemId: 'WI-P1', actorId: 'actor-policy-li', outputSummary: '政策准入初核 v2（补件后重做）。',
    }],
    ['system', T('30'), { type: 'CONTRIBUTION_RECORDED', contribution: contribution('contrib-2', 'actor-policy-li', 'WI-P1', T('30')) }],
    ['system', T('31'), { type: 'GATE_OPENED', gateId: 'PG-1', workItemId: 'WI-P1' }],
    ['actor-policy-li', T('40'), { type: 'DECISION_RECORDED', gateId: 'PG-1', decision: decisionP1Approved, receipt: receiptP1Approved }],
    ['actor-policy-li', T('41'), { type: 'WORK_ITEM_COMPLETED', workItemId: 'WI-P1', by: 'actor-policy-li' }],
  ]);

  // 退回后前缀：gate 回 pending、linked item 回 in_progress、无 Receipt
  const afterReturn = rebuildProjection(seed, events.slice(0, 7), T('98'));
  assert.equal(gateOf(afterReturn, 'PG-1').status, 'pending');
  assert.deepEqual(afterReturn.openGates, []);
  assert.equal(workItemOf(afterReturn, 'WI-P1').status, 'in_progress');
  assert.deepEqual(afterReturn.receipts, []);
  assert.deepEqual(
    afterReturn.contributions.map((entry) => entry.contributionId),
    ['contrib-1'],
  );

  // 重做轮：重新提交再开 Gate，同一 Gate 批准后 Receipt 按轮次追加
  const projection = rebuildProjection(seed, events, T('99'));
  assert.equal(events.length, 12);
  assert.equal(projection.rev, 12);
  const pg1 = gateOf(projection, 'PG-1');
  assert.equal(pg1.status, 'decided');
  assert.equal(pg1.openedAt, T('31'));
  const wiP1 = workItemOf(projection, 'WI-P1');
  assert.equal(wiP1.status, 'completed');
  assert.equal(wiP1.outputSummary, '政策准入初核 v2（补件后重做）。');
  assert.equal(wiP1.submittedAt, T('30'));
  assert.deepEqual(projection.receipts.map((receipt) => receipt.receiptId), ['rcpt-PG-1-1']);
  assert.equal(projection.receipts[0].decision.decidedAt, T('40'));
  assert.deepEqual(projection.openGates, []);
});

test('rebuildProjection: 输出与输入深克隆隔离（改事件不改投影，改投影不复算污染）', () => {
  const seed = createV4LifeDemoSeed();
  const events = happyPathEvents();
  const first = rebuildProjection(seed, events, T('99'));
  const second = rebuildProjection(seed, events, T('99'));
  assert.deepEqual(first, second);

  // 改输入事件流：已产出的投影不受影响，重新折叠也与先前一致
  events[1].payload.evidence.payload.tags.push('MUTATED');
  events[3].payload.workItemId = 'WI-HACKED';
  assert.equal(first.evidence[0].payload.tags.includes('MUTATED'), false);
  const third = rebuildProjection(seed, happyPathEvents(), T('99'));
  assert.deepEqual(third, second);

  // 改输出投影：不影响重新折叠结果
  first.domains[0].workItems[0].status = 'HACKED';
  first.receipts.push({ receiptId: 'fake', gateId: 'PG-1', decision: {} });
  const fourth = rebuildProjection(seed, happyPathEvents(), T('99'));
  assert.deepEqual(fourth, second);
});

// ---------- 3. rebuildProjection 失败关闭 ----------

test('rebuildProjection fail-closed: 未知类型/未知字段/缺失字段/seq 断裂/非法配对 一律 INVALID_ENGINE_INPUT', () => {
  const seed = createV4LifeDemoSeed();
  const prefix = happyPathEvents().slice(0, 20); // 到 GATE_OPENED PG-1 为止

  const expectInvalid = (name, events) => {
    const code = invalidErrorCode(() => rebuildProjection(seed, events, T('99')));
    assert.equal(code, 'INVALID_ENGINE_INPUT', name);
  };

  // 未知事件类型
  expectInvalid('unknown type', [...prefix, ev(21, T('40'), 'system', { type: 'SOMETHING_ELSE' })]);
  // 缺失 payload 字段
  expectInvalid('missing field', [...prefix, ev(21, T('40'), 'actor-policy-li', { type: 'WORK_ITEM_COMPLETED', workItemId: 'WI-P1' })]);
  // 未知 payload 字段
  expectInvalid('unknown field', [...prefix, ev(21, T('40'), 'system', { type: 'GATE_OPENED', gateId: 'CG-1', workItemId: 'WI-C3', extra: 1 })]);
  // seq 断裂
  const gapSeq = happyPathEvents();
  gapSeq[4].seq = 9;
  expectInvalid('seq gap', gapSeq);
  // 事件 envelope 未知字段
  const envelopeExtra = happyPathEvents();
  envelopeExtra[2].extra = true;
  expectInvalid('envelope unknown field', envelopeExtra);
  // approved 必须带 receipt
  expectInvalid('approved without receipt', [
    ...prefix,
    ev(21, T('40'), 'actor-policy-li', { type: 'DECISION_RECORDED', gateId: 'PG-1', decision: decisionP1Approved, receipt: null }),
  ]);
  // returned 不得带 receipt
  expectInvalid('returned with receipt', [
    ...prefix,
    ev(21, T('40'), 'actor-policy-li', { type: 'DECISION_RECORDED', gateId: 'PG-1', decision: decisionP1Returned, receipt: receiptP1Rejected }),
  ]);
  // receipt.gateId 与事件不一致
  expectInvalid('receipt gateId mismatch', [
    ...prefix,
    ev(21, T('40'), 'actor-policy-li', {
      type: 'DECISION_RECORDED', gateId: 'PG-1', decision: decisionP1Approved,
      receipt: { receiptId: 'rcpt-PG-1-1', gateId: 'CG-1', decision: decisionP1Approved },
    }),
  ]);
  // WORK_ITEM_STOPPED 非法 reason
  expectInvalid('bad stop reason', [
    ...happyPathEvents().slice(0, 22),
    ev(23, T('42'), 'system', { type: 'WORK_ITEM_STOPPED', workItemId: 'WI-C3', reason: 'other_reason' }),
  ]);
  // Evidence 缺 version
  const missingVersion = happyPathEvents();
  delete missingVersion[1].payload.evidence.version;
  expectInvalid('evidence missing version', missingVersion);
  // GATE_OPENED workItemId 与 gate 关联项不一致
  const wrongLink = happyPathEvents();
  wrongLink[19].payload.workItemId = 'WI-C3';
  expectInvalid('gate opened wrong link', wrongLink);
  // 未知 workItemId 引用
  expectInvalid('unknown workItemId', [...prefix, ev(21, T('40'), 'system', { type: 'WORK_ITEM_COMPLETED', workItemId: 'WI-NOPE', by: 'x' })]);
  // seed 本身非法（重复 workItemId）
  const badSeed = createV4LifeDemoSeed();
  badSeed.workItems = [...badSeed.workItems, { ...badSeed.workItems[0] }];
  assert.equal(invalidErrorCode(() => rebuildProjection(badSeed, happyPathEvents(), T('99'))), 'INVALID_ENGINE_INPUT');
  // generatedAt 非法
  assert.equal(invalidErrorCode(() => rebuildProjection(seed, happyPathEvents(), 123)), 'INVALID_ENGINE_INPUT');
});

// ---------- 4. 引擎等价性（依赖 Lane A 的 engine.ts 按 CONTRACT §2/§7/§8 落地） ----------

// feature detection：旧 candidate engine（无 rev/payload.type/hasMore）→ skip 并标注待整合复跑
function detectContractEngine() {
  try {
    const seed = createV4LifeDemoSeed();
    const engine = createV4LifeEngine(seed);
    const page = typeof engine.getEvents === 'function' ? engine.getEvents(0, 500) : null;
    const projection = engine.getProjection();
    const first = page?.events?.[0];
    const ready =
      Boolean(first?.payload && typeof first.payload.type === 'string') && // §2 全量载荷
      typeof projection.rev === 'number' && // §8 rev
      Array.isArray(projection.evidence) && // §8 evidence
      typeof page?.hasMore === 'boolean' && // §7 getEvents 分页
      typeof engine.rev === 'number'; // §7 engine.rev
    return { seed, engine, ready };
  } catch (error) {
    return { seed: null, engine: null, ready: false, error };
  }
}

function driveGoldenScenario(engine) {
  // 场景：初始 evidence（引擎构造时内部追加）→ 提交财务+合同 → submitWork WI-C1/WI-C2/WI-P1
  //       → PG-1 approved → WI-C3 submitWork → CG-1 approved
  engine.appendEvidence({
    commandId: 'cmd-fin-1', expectedRev: engine.rev,
    evidenceId: 'ev-financial-statement', kind: 'financial_statement', title: '客户财务报表（合成）',
    submittedBy: 'actor-business-chen',
    payload: { summary: '营收连续两个季度下滑。', amountCny: 4_800_000, tags: ['revenue_declining'] },
  });
  engine.appendEvidence({
    commandId: 'cmd-con-1', expectedRev: engine.rev,
    evidenceId: 'ev-contract-draft', kind: 'contract_draft', title: '设备采购合同草案（合成）',
    submittedBy: 'actor-commerce-wang',
    payload: { summary: '合同金额 520 万元。', amountCny: 5_200_000, tags: ['equipment_purchase'] },
  });
  for (const [workItemId, actorId] of [
    ['WI-C1', 'actor-credit-zhang'],
    ['WI-C2', 'actor-credit-zhang'],
    ['WI-P1', 'actor-policy-li'],
  ]) {
    engine.submitWork({
      commandId: `cmd-sw-${workItemId}`, expectedRev: engine.rev,
      workItemId, actorId, outputSummary: `${workItemId} 专业工作完成（合成）。`,
    });
  }
  engine.recordDecision({
    commandId: 'cmd-dec-pg1', expectedRev: engine.rev,
    gateId: 'PG-1', actorId: 'actor-policy-li', outcome: 'approved', reason: '政策准入核验通过。',
  });
  engine.submitWork({
    commandId: 'cmd-sw-WI-C3', expectedRev: engine.rev,
    workItemId: 'WI-C3', actorId: 'actor-credit-zhang', outputSummary: '正式信审意见完成（合成）。',
  });
  engine.recordDecision({
    commandId: 'cmd-dec-cg1', expectedRev: engine.rev,
    gateId: 'CG-1', actorId: 'actor-credit-zhang', outcome: 'approved', reason: '信审签批通过。',
  });
}

test('engine equivalence: rebuildProjection(seed, engine.getEvents(0,500).events) deepEqual engine.getProjection()（忽略 generatedAt）', (t) => {
  const { seed, engine, ready } = detectContractEngine();
  if (!ready) {
    t.skip('PENDING_LANE_A_INTEGRATION: engine.ts 尚未按 CONTRACT §2/§7/§8 落地（payload.type 全量载荷 / rev / evidence / getEvents.hasMore）。引擎等价断言待整合复跑。');
    return;
  }
  driveGoldenScenario(engine);

  const page = engine.getEvents(0, 500);
  assert.equal(page.hasMore, false);
  const projection = engine.getProjection();
  const rebuilt = rebuildProjection(seed, page.events);

  assert.equal(rebuilt.rev, page.events.length);
  assert.equal(rebuilt.eventCount, page.events.length);
  assert.equal(rebuilt.rev, projection.rev);
  assert.deepEqual(stripGeneratedAt(rebuilt), stripGeneratedAt(projection));
});

test('engine + eventLog: 快照 import 进新 log 后 createV4LifeEngine(seed,{eventLog}) 折叠等价，且新追加写入 log', (t) => {
  const detection = detectContractEngine();
  if (!detection.ready) {
    t.skip('PENDING_LANE_A_INTEGRATION: engine.ts 尚未支持 CONTRACT §7 options（eventLog 注入 + 构造折叠）。待整合复跑。');
    return;
  }
  const { seed, engine } = detection;
  driveGoldenScenario(engine);
  const projection = engine.getProjection();
  const events = engine.getEvents(0, 500).events;

  const log = createInMemoryEventLog();
  log.importSnapshot(detection.seed.case.caseId, structuredClone(events));

  const rebuiltEngine = createV4LifeEngine(seed, { eventLog: log });
  const rebuiltProjectionFromEngine = rebuiltEngine.getProjection();
  const foldedExisting =
    typeof rebuiltProjectionFromEngine.rev === 'number' &&
    rebuiltProjectionFromEngine.rev === events.length;
  if (!foldedExisting) {
    t.skip('PENDING_LANE_A_INTEGRATION: createV4LifeEngine 尚未在构造时折叠 eventLog 已有事件。待整合复跑。');
    return;
  }
  assert.deepEqual(stripGeneratedAt(rebuiltProjectionFromEngine), stripGeneratedAt(projection));

  // 纯重放闭环：log 里的事件折叠出的投影与引擎内投影等价
  const replayed = rebuildProjection(seed, log.loadAll(detection.seed.case.caseId));
  assert.deepEqual(stripGeneratedAt(replayed), stripGeneratedAt(projection));

  // 注入 eventLog 后，新命令的事件经过 log 条件追加
  const before = log.loadAll(detection.seed.case.caseId).length;
  const result = rebuiltEngine.appendEvidence({
    commandId: 'cmd-sup-1', expectedRev: rebuiltEngine.rev,
    evidenceId: 'ev-supplement-1', kind: 'supplement', title: '补充尽调说明（合成）',
    submittedBy: 'actor-business-chen',
    payload: { summary: '补充尽调报告说明。', tags: ['due_diligence_report'] },
  });
  assert.equal(result.status, 'accepted');
  const after = log.loadAll(detection.seed.case.caseId).length;
  assert.equal(after, rebuiltEngine.rev, 'eventLog 注入后新事件必须写入 log（每次追加先过 log）');
  assert.ok(after > before);

  // 再折叠一次仍然等价
  const finalReplay = rebuildProjection(seed, log.loadAll(detection.seed.case.caseId));
  assert.deepEqual(stripGeneratedAt(finalReplay), stripGeneratedAt(rebuiltEngine.getProjection()));
});
