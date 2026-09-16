// V4-LIFE durable command journal 测试（Lane L-J，docs/v4/CONTRACT.md §15）。
// 覆盖：accepted 命令落 journal；核心验收——模拟重启（同 seed + 同 eventLog + 同 journal）后
// 重发同 commandId 同载荷命令返回 replayed（修复 §15.1 边界：work/decision 重启后 VERSION_CONFLICT
// 的 Codex newFinding）；无 journal 引擎行为不变（§15.1 失败关闭边界保持）；journal.append 抛错
// 命令整体失败关闭；journal 损坏行失败关闭；caseId 路径穿越拒绝；成对清盘。

import assert from 'node:assert/strict';
import test from 'node:test';
import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createV4LifeEngine, V4LifeError } from '../lib/v4life/engine.ts';
import { createV4LifeDemoSeed } from '../lib/v4life/seed.ts';
import { createFileEventLog } from '../lib/v4life/file-event-log.ts';
import { createCommandJournal } from '../lib/v4life/command-journal.ts';

const CASE = 'demo-sme-robot-500w';

function evidenceCommand(overrides = {}) {
  return {
    commandId: 'cmd-journal-evidence-1',
    expectedRev: undefined,
    evidenceId: 'ev-journal-supplement',
    kind: 'supplement',
    title: '跨重启幂等验证补充材料',
    submittedBy: 'actor-business-chen',
    payload: {
      summary: '用于验证 durable command journal 的合成补充材料。',
      tags: ['journal_check'],
    },
    ...overrides,
  };
}

function workCommand(overrides = {}) {
  return {
    commandId: 'cmd-journal-work-1',
    expectedRev: undefined,
    workItemId: 'WI-P1',
    actorId: 'actor-policy-li',
    outputSummary: '政策准入初核完成，提交准入 Gate。',
    ...overrides,
  };
}

function decisionCommand(overrides = {}) {
  return {
    commandId: 'cmd-journal-decision-1',
    expectedRev: undefined,
    gateId: 'PG-1',
    actorId: 'actor-policy-li',
    outcome: 'approved',
    reason: '准入要件齐备，同意进入信审。',
    ...overrides,
  };
}

/** boot：同目录成对注入 eventLog + commandJournal（全新适配器实例，模拟独立进程的持久化加载）。 */
function boot(dir) {
  return createV4LifeEngine(createV4LifeDemoSeed(), {
    eventLog: createFileEventLog({ dir }),
    commandJournal: createCommandJournal({ dir }),
  });
}

function expectV4LifeError(fn, code) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof V4LifeError, `应抛 V4LifeError，实际收到 ${String(error)}`);
    assert.equal(error.code, code, `错误码应为 ${code}`);
    return;
  }
  assert.fail(`应抛 V4LifeError(${code})，但命令正常返回`);
}

test('journal 记录：evidence/work/decision 命令接受后 journal 按顺序各有一条 accepted 记录', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'v4life-cjournal-'));
  const engine = boot(dir);
  const evidenceResult = engine.appendEvidence(evidenceCommand({ expectedRev: engine.rev }));
  assert.equal(evidenceResult.status, 'accepted', '前置：evidence 命令被接受');
  const workResult = engine.submitWork(workCommand({ expectedRev: engine.rev }));
  assert.equal(workResult.status, 'accepted', '前置：work 命令被接受');
  const decisionResult = engine.recordDecision(decisionCommand({ expectedRev: engine.rev }));
  assert.equal(decisionResult.status, 'accepted', '前置：decision 命令被接受');

  const records = createCommandJournal({ dir }).loadAll(CASE);
  assert.deepEqual(
    records.map((record) => record.command),
    ['evidence', 'work', 'decision'],
    'journal 应按接受顺序记录三类命令',
  );
  assert.deepEqual(
    records.map((record) => record.commandId),
    ['cmd-journal-evidence-1', 'cmd-journal-work-1', 'cmd-journal-decision-1'],
  );
  for (const record of records) {
    assert.equal(record.caseId, CASE);
    assert.equal(record.result.status, 'accepted');
    assert.equal(typeof record.commandKey, 'string');
    assert.ok(record.commandKey.length > 0, 'commandKey 必须非空');
    assert.equal(typeof record.at, 'string');
    assert.ok(record.at.length > 0, 'at 必须非空');
  }
});

test('核心验收：重启（同 seed + 同 eventLog + 同 journal）后重发同 commandId 同载荷命令 → replayed', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'v4life-cjournal-'));
  const engine1 = boot(dir);
  const evidence = evidenceCommand({ expectedRev: engine1.rev });
  const evidenceFirst = engine1.appendEvidence(evidence);
  const work = workCommand({ expectedRev: engine1.rev });
  const workFirst = engine1.submitWork(work);
  const decision = decisionCommand({ expectedRev: engine1.rev });
  const decisionFirst = engine1.recordDecision(decision);
  assert.equal(evidenceFirst.status, 'accepted');
  assert.equal(workFirst.status, 'accepted');
  assert.equal(decisionFirst.status, 'accepted');
  assert.equal(decisionFirst.receipt?.receiptId, 'rcpt-PG-1-1');
  const revAfter = engine1.rev;

  // 模拟重启：全新适配器实例 + 全新引擎（同 seed、同目录），从 eventLog refold + 从 journal 恢复幂等缓存
  const engine2 = boot(dir);
  assert.equal(engine2.rev, revAfter, '重启后 rev 必须恢复');

  // §6 重试语义：复用完全相同 commandId+payload（含原 expectedRev）重发 → replayed
  const evidenceReplay = engine2.appendEvidence(evidence);
  assert.equal(evidenceReplay.status, 'replayed');
  assert.equal(evidenceReplay.rev, evidenceFirst.rev);
  assert.deepEqual(evidenceReplay.evidence, evidenceFirst.evidence);

  const workReplay = engine2.submitWork(work);
  assert.equal(workReplay.status, 'replayed', 'work 命令重启后必须 replayed（修复 §15.1 VERSION_CONFLICT 边界）');
  assert.equal(workReplay.rev, workFirst.rev);
  assert.equal(workReplay.workItem.status, 'awaiting_gate');
  assert.equal(workReplay.gate.status, 'open');

  const decisionReplay = engine2.recordDecision(decision);
  assert.equal(decisionReplay.status, 'replayed', 'decision 命令重启后必须 replayed');
  assert.deepEqual(decisionReplay.receipt, decisionFirst.receipt);
  assert.deepEqual(decisionReplay.completedWorkItemIds, decisionFirst.completedWorkItemIds);

  assert.equal(engine2.getEvents(0).events.length, revAfter, '重发不得追加任何新事件');

  // 同 commandId 异载荷 → IDEMPOTENCY_CONFLICT（commandKey 随 journal 跨重启恢复）
  expectV4LifeError(
    () => engine2.recordDecision(decisionCommand({ expectedRev: engine2.rev, reason: '口径不同的重发' })),
    'IDEMPOTENCY_CONFLICT',
  );
});

test('无 journal 引擎行为不变：重启后重发 work 命令仍是 §15.1 失败关闭边界（VERSION_CONFLICT）', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'v4life-cjournal-'));
  const engine1 = createV4LifeEngine(createV4LifeDemoSeed(), { eventLog: createFileEventLog({ dir }) });
  const evidence = evidenceCommand({ expectedRev: engine1.rev });
  assert.equal(engine1.appendEvidence(evidence).status, 'accepted');
  const work = workCommand({ expectedRev: engine1.rev });
  assert.equal(engine1.submitWork(work).status, 'accepted');

  const engine2 = createV4LifeEngine(createV4LifeDemoSeed(), { eventLog: createFileEventLog({ dir }) });
  assert.equal(engine2.rev, engine1.rev, '前置：重启后 rev 恢复（缺的只是幂等缓存）');
  expectV4LifeError(
    () => engine2.submitWork(work),
    'VERSION_CONFLICT',
  );
  // evidenceId 自然键兜底不受影响（§15.1）：evidence 同载荷重发仍 replayed
  const evidenceReplay = engine2.appendEvidence(evidenceCommand({ expectedRev: engine2.rev }));
  assert.equal(evidenceReplay.status, 'replayed');
});

test('journal.append 抛错 → 命令整体失败关闭（不伪造成功）', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'v4life-cjournal-'));
  const boom = new Error('simulated disk failure');
  const engine = createV4LifeEngine(createV4LifeDemoSeed(), {
    eventLog: createFileEventLog({ dir }),
    commandJournal: {
      append() {
        throw boom;
      },
      loadAll: () => [],
    },
  });
  assert.throws(
    () => engine.appendEvidence(evidenceCommand({ expectedRev: engine.rev })),
    (error) => error === boom,
    'journal.append 抛错必须原样向上抛出',
  );
});

test('options 校验：commandJournal 缺 append/loadAll 函数 → INVALID_ENGINE_INPUT（失败关闭）', () => {
  expectV4LifeError(
    () => createV4LifeEngine(createV4LifeDemoSeed(), { commandJournal: {} }),
    'INVALID_ENGINE_INPUT',
  );
});

test('损坏行失败关闭：journal 文件出现非法 JSON 行 → loadAll 与引擎构造均 INVALID_ENGINE_INPUT', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'v4life-cjournal-'));
  const engine = boot(dir);
  engine.appendEvidence(evidenceCommand({ expectedRev: engine.rev }));
  appendFileSync(path.join(dir, `commands-${CASE}.jsonl`), 'not-json-at-all\n', 'utf8');

  expectV4LifeError(() => createCommandJournal({ dir }).loadAll(CASE), 'INVALID_ENGINE_INPUT');
  expectV4LifeError(() => boot(dir), 'INVALID_ENGINE_INPUT');
});

test('损坏行失败关闭：合法 JSON 但缺字段的行同样 INVALID_ENGINE_INPUT', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'v4life-cjournal-'));
  const engine = boot(dir);
  engine.appendEvidence(evidenceCommand({ expectedRev: engine.rev }));
  appendFileSync(path.join(dir, `commands-${CASE}.jsonl`), `${JSON.stringify({ caseId: CASE })}\n`, 'utf8');

  expectV4LifeError(() => boot(dir), 'INVALID_ENGINE_INPUT');
});

test('caseId 路径穿越拒绝：非法 caseId → INVALID_ENGINE_INPUT', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'v4life-cjournal-'));
  const journal = createCommandJournal({ dir });
  expectV4LifeError(() => journal.loadAll('../escape'), 'INVALID_ENGINE_INPUT');
  expectV4LifeError(() => journal.loadAll('..'), 'INVALID_ENGINE_INPUT');
  expectV4LifeError(() => journal.loadAll('a/b'), 'INVALID_ENGINE_INPUT');
});

test('成对清盘：eventLog.clear + journal.clear 后新引擎回到种子初态，旧命令记录不复活', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'v4life-cjournal-'));
  const engine1 = boot(dir);
  engine1.appendEvidence(evidenceCommand({ expectedRev: engine1.rev }));
  assert.ok(createCommandJournal({ dir }).loadAll(CASE).length > 0, '前置：journal 已有记录');

  createFileEventLog({ dir }).clear(CASE);
  createCommandJournal({ dir }).clear(CASE);

  const engine2 = boot(dir);
  const fresh = createV4LifeEngine(createV4LifeDemoSeed());
  assert.equal(engine2.rev, fresh.rev, '成对清盘后 rev 与全新种子引擎一致');
  assert.deepEqual(createCommandJournal({ dir }).loadAll(CASE), [], 'journal 记录已随 clear 移除');
});
