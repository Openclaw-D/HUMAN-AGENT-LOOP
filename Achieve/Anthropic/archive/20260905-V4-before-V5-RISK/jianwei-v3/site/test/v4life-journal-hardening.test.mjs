// V4-LIFE durable command journal 双写加固测试（P1-BE-01，2026-09-04）。
// 覆盖事件账本与 journal 双写非原子窗口的可证明语义：
//   1. "事件已提交、journal 未提交"（journal.append 故障，同进程）：命令失败关闭（原错误上抛、
//      不伪造成功），但已接受命令的幂等语义不丢 —— 同 commandId+同载荷重发 → replayed，无重复事件；
//   2. "事件已提交、journal 记录缺失"（崩溃窗口，跨重启）：evidence 走 evidenceId 自然键 replayed
//      （无重复事件）；work/decision 由状态规则失败关闭（WORK_ITEM_NOT_ACTIVE / GATE_ALREADY_DECIDED），
//      不重复事件、不重复 Receipt；已入 journal 的其他命令照常 replayed；
//   3. 反向场景"journal 已写、事件缺失"（journal 超前/错配/账本被截断）：引擎构造即
//      INVALID_ENGINE_INPUT（rev 一致性守卫），不凭 journal 伪造幂等恢复；
//   4. 对照：合法成对 journal+eventLog 不受守卫影响。
// 诚实边界：文件适配器无法与事件追加做成一个原子事务（无真实事务数据库）；本组测试固化的是
// 当前可证明行为 —— 失败关闭、无重复写、幂等按可用账本最大恢复。
// 运行：node --experimental-strip-types --test --experimental-test-isolation=none test/v4life-journal-hardening.test.mjs

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createV4LifeEngine, V4LifeError } from '../lib/v4life/engine.ts';
import { createV4LifeDemoSeed } from '../lib/v4life/seed.ts';
import { createFileEventLog } from '../lib/v4life/file-event-log.ts';
import { createCommandJournal } from '../lib/v4life/command-journal.ts';

const CASE = 'demo-sme-robot-500w';

function makeClock() {
  let ticks = 0;
  const base = Date.UTC(2030, 8, 1, 0, 0, 0);
  return () => new Date(base + (++ticks) * 1000).toISOString();
}

function boot(dir, seedOptions = {}) {
  return createV4LifeEngine(createV4LifeDemoSeed(), {
    eventLog: createFileEventLog({ dir }),
    commandJournal: createCommandJournal({ dir }),
    now: makeClock(),
    ...seedOptions,
  });
}

function evidenceCommand(overrides = {}) {
  return {
    commandId: 'cmd-hard-evidence-1',
    expectedRev: 0,
    evidenceId: 'ev-hard-supplement',
    kind: 'supplement',
    title: '双写加固验证补充材料',
    submittedBy: 'actor-business-chen',
    payload: { summary: '用于双写故障注入的合成补充材料。', tags: ['hardening'] },
    ...overrides,
  };
}

function workCommand(overrides = {}) {
  return {
    commandId: 'cmd-hard-work-1',
    expectedRev: 0,
    workItemId: 'WI-P1',
    actorId: 'actor-policy-li',
    outputSummary: '政策准入初核完成。',
    ...overrides,
  };
}

function decisionCommand(overrides = {}) {
  return {
    commandId: 'cmd-hard-decision-1',
    expectedRev: 0,
    gateId: 'PG-1',
    actorId: 'actor-policy-li',
    outcome: 'approved',
    reason: '准入要件齐备。',
    ...overrides,
  };
}

/** 故障注入 journal：仅在第 failTimes 次 append 抛原错误（其余正常记账，可读回）。 */
function flakyJournal(failTimes) {
  let calls = 0;
  const records = [];
  return {
    append(caseId, record) {
      calls += 1;
      if (calls === failTimes) {
        throw new Error(`simulated journal failure #${calls}`);
      }
      records.push(structuredClone(record));
    },
    loadAll(caseId) {
      return structuredClone(records.filter((record) => record.caseId === caseId));
    },
  };
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

/** 模拟"事件已提交、journal 未提交"崩溃窗口：删除 journal 文件最后一条记录（删空后为空文件）。 */
function dropLastJournalRecord(dir) {
  const file = path.join(dir, `commands-${CASE}.jsonl`);
  const lines = readFileSync(file, 'utf8').split('\n').filter((line) => line.length > 0);
  assert.ok(lines.length >= 1, '前置：journal 至少有一条记录');
  const remaining = lines.slice(0, -1);
  writeFileSync(file, remaining.length > 0 ? `${remaining.join('\n')}\n` : '', 'utf8');
}

// ---------------------------------------------------------------------------
// 1｜journal.append 故障（同进程）：失败关闭 + 幂等不丢 + 无重复事件
// ---------------------------------------------------------------------------

test('加固｜appendEvidence：journal 故障 → 原错误上抛，事件恰好提交一次，同进程重发 → replayed', () => {
  const eventLog = createFileEventLog({ dir: mkdtempSync(path.join(tmpdir(), 'v4life-hard-')) });
  const journal = flakyJournal(1);
  const engine = createV4LifeEngine(createV4LifeDemoSeed(), {
    eventLog,
    commandJournal: journal,
    now: makeClock(),
  });
  const revBefore = engine.rev;
  const command = evidenceCommand({ expectedRev: engine.rev });
  assert.throws(
    () => engine.appendEvidence(command),
    (error) => error instanceof Error && /simulated journal failure #1/.test(error.message),
    'journal.append 故障必须原样上抛（不伪造成功）',
  );
  assert.equal(engine.rev, revBefore + 1, '事件已提交（不可回滚），rev 恰好 +1');

  // 同 commandId + 同载荷重发（fresh expectedRev）→ §6 步骤 3 replayed，进程内幂等语义不丢
  const retry = engine.appendEvidence({ ...command, expectedRev: engine.rev });
  assert.equal(retry.status, 'replayed');
  assert.equal(engine.rev, revBefore + 1, '重发不得追加任何新事件');
  assert.equal(engine.getEvents(0).events.length, revBefore + 1);
});

test('加固｜recordDecision：journal 故障（第 3 次 append）→ 失败关闭，重发 → replayed，Receipt 恰好 1 条', () => {
  const eventLog = createFileEventLog({ dir: mkdtempSync(path.join(tmpdir(), 'v4life-hard-')) });
  const journal = flakyJournal(3); // 故障精确命中第 3 条 accepted 命令（decision）
  const engine = createV4LifeEngine(createV4LifeDemoSeed(), {
    eventLog,
    commandJournal: journal,
    now: makeClock(),
  });
  assert.equal(engine.appendEvidence(evidenceCommand({ expectedRev: engine.rev })).status, 'accepted');
  assert.equal(engine.submitWork(workCommand({ expectedRev: engine.rev })).status, 'accepted');
  const revBeforeDecision = engine.rev;
  const decision = decisionCommand({ expectedRev: engine.rev });
  assert.throws(
    () => engine.recordDecision(decision),
    (error) => error instanceof Error && /simulated journal failure #3/.test(error.message),
    'journal.append 故障必须原样上抛（不伪造成功）',
  );
  assert.equal(engine.rev, revBeforeDecision + 2, 'decision 事件已提交（DECISION_RECORDED + WORK_ITEM_COMPLETED）');
  assert.equal(engine.getProjection().receipts.length, 1, 'Receipt 已随事件落账，恰好 1 条');

  // 同 commandId + 同载荷重发 → 进程内幂等缓存兜底 replayed；无重复 Receipt、无新事件
  const retry = engine.recordDecision({ ...decision, expectedRev: engine.rev });
  assert.equal(retry.status, 'replayed');
  assert.equal(retry.receipt.receiptId, 'rcpt-PG-1-1');
  assert.equal(engine.getProjection().receipts.length, 1, '重发不得重复 Receipt');
  assert.equal(engine.getEvents(0).events.length, engine.rev, '重发不得追加任何新事件');
});

// ---------------------------------------------------------------------------
// 2｜崩溃窗口（跨重启，journal 记录缺失）：状态规则失败关闭，无重复写
// ---------------------------------------------------------------------------

test('加固｜崩溃窗口重启：缺失 journal 记录的 decision 重发 → GATE_ALREADY_DECIDED（不重复 Receipt、不重复事件）；已入 journal 的命令照常 replayed', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'v4life-hard-'));
  const engine1 = boot(dir);
  const evidence = evidenceCommand({ expectedRev: engine1.rev });
  assert.equal(engine1.appendEvidence(evidence).status, 'accepted');
  const work = workCommand({ expectedRev: engine1.rev });
  assert.equal(engine1.submitWork(work).status, 'accepted');
  const decision = decisionCommand({ expectedRev: engine1.rev });
  const decisionFirst = engine1.recordDecision(decision);
  assert.equal(decisionFirst.status, 'accepted');
  const revAfter = engine1.rev;

  // 崩溃窗口：decision 是最后一条 journal 记录，事件已提交但记录缺失
  dropLastJournalRecord(dir);
  const engine2 = boot(dir);
  assert.equal(engine2.rev, revAfter, '事件账本完整恢复');

  // 已入 journal 的 evidence/work 命令：跨重启 replayed（对照）
  assert.equal(engine2.appendEvidence({ ...evidence, expectedRev: 0 }).status, 'replayed');
  assert.equal(engine2.submitWork({ ...work, expectedRev: 0 }).status, 'replayed');

  // 缺失记录的 decision：同 commandId + fresh expectedRev → 状态规则失败关闭（不是 replayed）
  expectV4LifeError(
    () => engine2.recordDecision({ ...decision, expectedRev: engine2.rev }),
    'GATE_ALREADY_DECIDED',
  );
  assert.equal(engine2.getProjection().receipts.length, 1, 'Receipt 不得重复');
  assert.equal(engine2.rev, revAfter, '失败关闭不得追加事件');
});

test('加固｜崩溃窗口重启：缺失 journal 记录的 evidence 重发 → evidenceId 自然键 replayed（无重复事件）', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'v4life-hard-'));
  const engine1 = boot(dir);
  const evidence = evidenceCommand({ expectedRev: engine1.rev });
  const first = engine1.appendEvidence(evidence);
  assert.equal(first.status, 'accepted');
  const revAfter = engine1.rev;

  dropLastJournalRecord(dir);
  const engine2 = boot(dir);
  assert.equal(engine2.rev, revAfter);
  const retry = engine2.appendEvidence({ ...evidence, expectedRev: engine2.rev });
  assert.equal(retry.status, 'replayed', 'evidenceId 自然键兜底（§15.1）');
  assert.equal(retry.rev, first.rev);
  assert.equal(engine2.rev, revAfter, '自然键 replay 不得追加事件');
});

// ---------------------------------------------------------------------------
// 3｜反向场景：journal 超前于事件流（错配/截断）→ 构造失败关闭
// ---------------------------------------------------------------------------

test('加固｜journal 记录 rev 超前事件流（账本被截断/错配）→ 引擎构造 INVALID_ENGINE_INPUT，不伪造幂等恢复', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'v4life-hard-'));
  const engine1 = boot(dir);
  assert.equal(engine1.appendEvidence(evidenceCommand({ expectedRev: engine1.rev })).status, 'accepted');

  // 模拟事件账本回退/替换：事件流回到种子初态（仅 6 条初始化事件），journal 却留着 rev 更大的记录
  createFileEventLog({ dir }).clear(CASE);

  expectV4LifeError(() => boot(dir), 'INVALID_ENGINE_INPUT');
});

test('加固｜rev 守卫精确性：journal rev 恰好等于事件流长度 → 合法；超过 1 → 失败关闭', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'v4life-hard-'));
  // 种子初态事件流 = 6 条（CASE_INITIALIZED + EVIDENCE_ACCEPTED + CANDIDATE_ISSUED + 3× WORK_ITEM_STARTED）
  const engine1 = boot(dir);
  assert.equal(engine1.rev, 6);

  const journal = createCommandJournal({ dir });
  const baseRecord = {
    caseId: CASE,
    commandId: 'cmd-hard-ghost',
    command: 'evidence',
    commandKey: '{"ghost":1}',
    result: { status: 'accepted', rev: 6, evidence: {}, startedWorkItemIds: [] },
    at: '2030-09-01T00:00:00.000Z',
  };
  journal.append(CASE, { ...baseRecord, result: { ...baseRecord.result, rev: 6 } });
  assert.doesNotThrow(() => boot(dir), 'rev 恰好等于事件流长度时合法（从属账本一致）');

  journal.append(CASE, { ...baseRecord, commandId: 'cmd-hard-ghost-2', result: { ...baseRecord.result, rev: 7 } });
  expectV4LifeError(() => boot(dir), 'INVALID_ENGINE_INPUT');
});

// ---------------------------------------------------------------------------
// 4｜对照：合法成对 journal+eventLog 不受守卫影响
// ---------------------------------------------------------------------------

test('加固｜对照：合法成对账本（journal rev ≤ 事件流长度）构造成功且幂等恢复', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'v4life-hard-'));
  const engine1 = boot(dir);
  const evidence = evidenceCommand({ expectedRev: engine1.rev });
  const first = engine1.appendEvidence(evidence);
  assert.equal(first.status, 'accepted');

  const engine2 = boot(dir);
  assert.equal(engine2.rev, engine1.rev, '成对账本完整恢复');
  const replay = engine2.appendEvidence({ ...evidence, expectedRev: 0 });
  assert.equal(replay.status, 'replayed', 'journal 恢复幂等语义');
  assert.equal(engine2.rev, engine1.rev, '对照场景不得追加事件');
});
