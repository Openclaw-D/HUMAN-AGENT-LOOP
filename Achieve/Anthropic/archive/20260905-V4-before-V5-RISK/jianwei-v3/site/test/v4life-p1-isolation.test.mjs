// V4-LIFE P1 Candidate 语义隔离测试（P1-BE-01，2026-09-04，Control Channel Rev 0003）。
// 权威边界：versions/V4/P1_GOLDEN_CASE_CONTRACT.md 仍为 SCENARIO FROZEN / CONTENT CANDIDATE /
// USER ACCEPTANCE OPEN —— 精确 Human Role/Gate owner、自动封存、默认 seed 状态未经 §11.3 确认，
// 不得进入默认正式权威路径。本文件验证：
//   1. 默认 createV4LifeEngine()（p1CandidateSemantics='off'）：五个 candidate 命令失败关闭、
//      无种子隐含批次（context='NONE' 空窗口）、P0 行为逐字节不变；
//   2. 通用层（Evidence §5 扩展字段、新事件类型、投影、Risk Thread）在 strict 下保持可用；
//   3. graceful fallback：历史 verification 事件可重放进 strict 引擎；含收集窗口事件的流
//      因模式身份不接续而失败关闭（跨模式事件流移植不支持）；
//   4. 幂等跨模式：journal 中历史 candidate 命令在 strict 引擎上仍 replayed。
// 'demo' 显式 opt-in 行为详见 v4life-p1-semantics.test.mjs。
// 运行：node --experimental-strip-types --test --experimental-test-isolation=none test/v4life-p1-isolation.test.mjs

import assert from 'node:assert/strict';
import test from 'node:test';

import { createV4LifeEngine, V4LifeError } from '../lib/v4life/engine.ts';
import { createV4LifeDemoSeed } from '../lib/v4life/seed.ts';
import { rebuildProjection } from '../lib/v4life/replay.ts';

const ACTORS = {
  business: 'actor-business-chen',
  policy: 'actor-policy-li',
  credit: 'actor-credit-zhang',
  commerce: 'actor-commerce-wang',
  asset: 'actor-asset-zhou',
};
const CANDIDATE_DETAIL = 'P1 candidate command disabled';

let commandCounter = 0;
function nextCommandId(label) {
  commandCounter += 1;
  return `cmd-iso-${label}-${commandCounter}`;
}

function makeClock() {
  let ticks = 0;
  const base = Date.UTC(2030, 8, 1, 0, 0, 0);
  return () => new Date(base + (++ticks) * 1000).toISOString();
}

/** 内存事件账本（V4LifeEventLog port 最小实现） */
function createMemoryEventLog() {
  const byCase = new Map();
  return {
    append(caseId, revBefore, events) {
      const list = byCase.get(caseId) ?? [];
      if (list.length !== revBefore) {
        return { ok: false };
      }
      list.push(...structuredClone(events));
      byCase.set(caseId, list);
      return { ok: true };
    },
    loadAll(caseId) {
      return structuredClone(byCase.get(caseId) ?? []);
    },
  };
}

/** 内存命令 journal（V4LifeCommandJournal port 最小实现，测试可读回） */
function createMemoryJournal() {
  const records = [];
  return {
    append(caseId, record) {
      records.push(structuredClone(record));
    },
    loadAll(caseId) {
      return structuredClone(records.filter((record) => record.caseId === caseId));
    },
  };
}

function strictEngine(options = {}) {
  return createV4LifeEngine(createV4LifeDemoSeed(), { now: makeClock(), ...options });
}

function expectCandidateDisabled(operation, label) {
  try {
    operation();
  } catch (error) {
    assert.ok(error instanceof V4LifeError, `${label} 应抛 V4LifeError，实际收到 ${String(error)}`);
    assert.equal(error.code, 'INVALID_ENGINE_INPUT', `${label} 错误码应为 INVALID_ENGINE_INPUT`);
    assert.ok(
      String(error.detail ?? '').includes(CANDIDATE_DETAIL),
      `${label} 的 detail 应标注 candidate 语义被禁用，实际：${String(error.detail)}`,
    );
    return;
  }
  assert.fail(`${label} 在 strict 默认路径应失败关闭，但命令正常返回`);
}

// ---------------------------------------------------------------------------
// 1｜默认 strict：candidate 命令失败关闭、无隐含批次、P0 不变
// ---------------------------------------------------------------------------

test('P1 隔离｜默认（无 options）五个 candidate 命令失败关闭：INVALID_ENGINE_INPUT + detail，事件与 rev 不变', () => {
  const engine = strictEngine();
  const revBefore = engine.rev;
  expectCandidateDisabled(
    () =>
      engine.changeVerification({
        commandId: nextCommandId('ver'),
        expectedRev: engine.rev,
        evidenceId: 'ev-financial-statement',
        actorId: ACTORS.credit,
        verificationStatus: 'verified',
        reason: 'strict 下应被闸门拒绝。',
      }),
    'changeVerification',
  );
  expectCandidateDisabled(
    () =>
      engine.openContextBatch({
        commandId: nextCommandId('open'),
        expectedRev: engine.rev,
        actorId: ACTORS.business,
        reason: 'strict 下应被闸门拒绝。',
      }),
    'openContextBatch',
  );
  expectCandidateDisabled(
    () =>
      engine.appendInputEvent({
        commandId: nextCommandId('in'),
        expectedRev: engine.rev,
        batchId: '1',
        actorId: ACTORS.business,
        inputEventId: 'in-1',
        kind: 'document',
        summary: 'strict 下应被闸门拒绝。',
      }),
    'appendInputEvent',
  );
  expectCandidateDisabled(
    () =>
      engine.stabilizeContextBatch({
        commandId: nextCommandId('stab'),
        expectedRev: engine.rev,
        batchId: '1',
        actorId: ACTORS.policy,
        reason: 'strict 下应被闸门拒绝。',
      }),
    'stabilizeContextBatch',
  );
  expectCandidateDisabled(
    () =>
      engine.sealContextBatch({
        commandId: nextCommandId('seal'),
        expectedRev: engine.rev,
        batchId: '1',
        actorId: ACTORS.policy,
        reason: 'strict 下应被闸门拒绝。',
      }),
    'sealContextBatch',
  );
  assert.equal(engine.rev, revBefore, '闸门拒绝不得产生任何事件');
});

test('P1 隔离｜strict 投影：context 为 NONE 空窗口（无种子隐含批次），riskThreads 空且 P0 形状不变', () => {
  const engine = strictEngine();
  const projection = engine.getProjection();
  assert.deepEqual(projection.context, { major: 0, minor: 0, status: 'NONE', batches: [] });
  assert.deepEqual(projection.riskThreads, []);
  assert.equal(engine.rev, 6, '初始化事件数与 P0 完全一致（不新增种子批次事件）');
  const evidence = projection.evidence[0];
  assert.deepEqual(
    Object.keys(evidence).sort(),
    ['caseId', 'evidenceId', 'kind', 'payload', 'submittedAt', 'submittedBy', 'title', 'version'].sort(),
    '旧种子 Evidence 不注入 P1 字段',
  );
});

test('P1 隔离｜options.p1CandidateSemantics 非法值 → 构造即 INVALID_ENGINE_INPUT', () => {
  assert.throws(
    () => createV4LifeEngine(createV4LifeDemoSeed(), { p1CandidateSemantics: 'yes' }),
    (error) => error instanceof V4LifeError && error.code === 'INVALID_ENGINE_INPUT',
  );
});

// ---------------------------------------------------------------------------
// 2｜通用层在 strict 下保持可用（Rev 0003 允许的向后兼容 Candidate）
// ---------------------------------------------------------------------------

test('P1 隔离｜strict 仍接受 Evidence §5 扩展字段与 riskThreadKey 折叠，append 恒置 claimed', () => {
  const engine = strictEngine();
  const result = engine.appendEvidence({
    commandId: nextCommandId('ev'),
    expectedRev: engine.rev,
    evidenceId: 'ev-iso-extended',
    kind: 'supplement',
    title: 'strict 下的扩展字段 Evidence',
    submittedBy: ACTORS.business,
    payload: { summary: '扩展字段属于通用层，不依赖 candidate 命令。', tags: ['iso'] },
    sourceType: 'business_statement',
    subjectRefs: ['subject-borrower'],
    observedAt: '2026-09-01',
    evidenceRef: 'iso/ref-1',
    riskThreadKey: 'thread-iso',
  });
  assert.equal(result.status, 'accepted');
  assert.equal(result.evidence.verificationStatus, 'claimed', 'append 恒置 claimed（引擎行为，不属 candidate 闸门）');
  assert.equal(result.evidence.sourceType, 'business_statement');
  const projection = engine.getProjection();
  assert.deepEqual(projection.riskThreads, [
    { riskThreadKey: 'thread-iso', evidenceIds: ['ev-iso-extended'], workItemIds: [], gateIds: [], lastSeq: 7 },
  ]);
  assert.equal(projection.context.status, 'NONE', '扩展字段不改变 strict 窗口状态');
});

test('P1 隔离｜strict refold/rebuild 等价：P0-only 流在默认 off 下与在线投影 deepEqual（忽略 generatedAt）', () => {
  const seed = createV4LifeDemoSeed();
  const eventLog = createMemoryEventLog();
  const engine1 = strictEngine({ eventLog });
  engine1.appendEvidence({
    commandId: nextCommandId('ev'),
    expectedRev: engine1.rev,
    evidenceId: 'ev-iso-refold',
    kind: 'supplement',
    title: 'refold 等价验证',
    submittedBy: ACTORS.business,
    payload: { summary: 'P0-only 流。', tags: ['iso'] },
  });
  const engine2 = strictEngine({ eventLog });
  assert.equal(engine2.rev, engine1.rev);
  const left = engine2.getProjection();
  const right = engine1.getProjection();
  delete left.generatedAt;
  delete right.generatedAt;
  assert.deepEqual(left, right, 'refold（默认 off 骨架）与在线投影等价');
  const events = engine1.getEvents(0, 500).events;
  const rebuilt = rebuildProjection(seed, events, '2030-09-01T00:00:00.000Z');
  delete rebuilt.generatedAt;
  const live = engine1.getProjection();
  delete live.generatedAt;
  assert.deepEqual(rebuilt, live, 'rebuildProjection 默认 off 与 strict 引擎等价');
});

// ---------------------------------------------------------------------------
// 3｜graceful fallback：历史事件重放边界
// ---------------------------------------------------------------------------

test('P1 隔离｜历史 verification 事件可重放进 strict 引擎（通用事件层）；含收集窗口事件的流失败关闭', () => {
  const seed = createV4LifeDemoSeed();
  // (a) 仅 verification 事件的流：strict 引擎照常 refold（事件层 graceful fallback）
  const logA = createMemoryEventLog();
  const demoA = createV4LifeEngine(seed, { p1CandidateSemantics: 'demo', eventLog: logA, now: makeClock() });
  demoA.appendEvidence({
    commandId: nextCommandId('ev'),
    expectedRev: demoA.rev,
    evidenceId: 'ev-iso-fallback',
    kind: 'supplement',
    title: '历史核验来源',
    submittedBy: ACTORS.business,
    payload: { summary: 'demo 时代提交。', tags: ['iso'] },
  });
  const verification = {
    commandId: 'cmd-iso-historic-ver',
    expectedRev: demoA.rev,
    evidenceId: 'ev-iso-fallback',
    actorId: ACTORS.credit,
    verificationStatus: 'verified',
    reason: 'demo 时代核验。',
  };
  demoA.changeVerification(verification);
  const strictA = createV4LifeEngine(seed, { eventLog: logA, now: makeClock() });
  const fallback = strictA.getProjection().evidence.find((entry) => entry.evidenceId === 'ev-iso-fallback');
  assert.equal(fallback.verificationStatus, 'verified', 'strict 引擎可重放历史 verification 事件');

  // (b) 含收集窗口事件的流：strict 引擎构造失败关闭（模式属于引擎身份；跨模式移植不支持）
  const logB = createMemoryEventLog();
  const demoB = createV4LifeEngine(seed, { p1CandidateSemantics: 'demo', eventLog: logB, now: makeClock() });
  demoB.openContextBatch({
    commandId: nextCommandId('open'),
    expectedRev: demoB.rev,
    actorId: ACTORS.business,
    reason: 'demo 时代开窗。',
  });
  assert.throws(
    () => createV4LifeEngine(seed, { eventLog: logB, now: makeClock() }),
    (error) => error instanceof V4LifeError && error.code === 'INVALID_ENGINE_INPUT',
    'strict 引擎不得静默重放不接续的收集窗口事件流',
  );
});

test('P1 隔离｜journal 中历史 candidate 命令在 strict 引擎上仍 replayed（幂等跨模式）', () => {
  const seed = createV4LifeDemoSeed();
  const eventLog = createMemoryEventLog();
  const commandJournal = createMemoryJournal();
  const demo = createV4LifeEngine(seed, {
    p1CandidateSemantics: 'demo',
    eventLog,
    commandJournal,
    now: makeClock(),
  });
  demo.appendEvidence({
    commandId: nextCommandId('ev'),
    expectedRev: demo.rev,
    evidenceId: 'ev-iso-cross',
    kind: 'supplement',
    title: '跨模式幂等来源',
    submittedBy: ACTORS.business,
    payload: { summary: 'demo 时代。', tags: ['iso'] },
  });
  const verification = {
    commandId: 'cmd-iso-cross-ver',
    expectedRev: demo.rev,
    evidenceId: 'ev-iso-cross',
    actorId: ACTORS.commerce,
    verificationStatus: 'stale',
    reason: 'demo 时代核验。',
  };
  const first = demo.changeVerification(verification);
  assert.equal(first.status, 'accepted');

  // "重启"为 strict 引擎（同 eventLog + 同 journal）：历史 candidate 命令重发 → replayed
  const strict = createV4LifeEngine(seed, { eventLog, commandJournal, now: makeClock() });
  const replay = strict.changeVerification({ ...verification, expectedRev: 0 });
  assert.equal(replay.status, 'replayed', '已接受命令的幂等语义不随模式切换丢失');
  assert.equal(replay.rev, first.rev);
  assert.equal(replay.evidence.verificationStatus, 'stale');
  // 新命令仍被闸门拒绝
  expectCandidateDisabled(
    () =>
      strict.changeVerification({
        commandId: nextCommandId('new-ver'),
        expectedRev: strict.rev,
        evidenceId: 'ev-iso-cross',
        actorId: ACTORS.credit,
        verificationStatus: 'verified',
        reason: 'strict 下新核验命令应被拒绝。',
      }),
    'strict 新命令',
  );
});

// ---------------------------------------------------------------------------
// 4｜demo 显式 opt-in（最小对照；完整行为见 v4life-p1-semantics）
// ---------------------------------------------------------------------------

test('P1 隔离｜demo 显式 opt-in：种子隐含批次存在、candidate 命令可用（对照 strict）', () => {
  const engine = createV4LifeEngine(createV4LifeDemoSeed(), {
    p1CandidateSemantics: 'demo',
    now: makeClock(),
  });
  const projection = engine.getProjection();
  assert.equal(projection.context.status, 'SEALED');
  assert.equal(projection.context.batches[0].major, 1);
  const opened = engine.openContextBatch({
    commandId: nextCommandId('open'),
    expectedRev: engine.rev,
    actorId: ACTORS.business,
    reason: 'demo opt-in 下可开窗。',
  });
  assert.equal(opened.status, 'accepted');
  assert.equal(opened.batch.major, 2, 'demo 种子批次 major=1 之上开启 major=2');
});
