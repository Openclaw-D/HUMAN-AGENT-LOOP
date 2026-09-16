// V4-LIFE P1 语义扩展测试（Lane E / 2026-09-04）
// 上位契约：versions/V4/P1_GOLDEN_CASE_CONTRACT.md §5/§12 ＋ docs/v4/P1_SCHEMA_EXTENSION_PROPOSAL.md A/B/C 节。
// 覆盖：
//   1. Evidence 核验链路：P1 扩展字段（sourceType/subjectRefs/时间三元组/evidenceRef/confidence）+
//      changeVerification 全链路（claimed→verified→contradicted、业务角色拒绝、旧数据兼容、幂等/冲突）；
//   2. Context 批次窗口（D076/D077）：open→append×n（minor 递增）→stabilize→seal→seal 后 append 409→再 open major+1；
//   3. Risk Thread 投影折叠（evidenceIds/workItemIds/gateIds/lastSeq）；
//   4. 重放等价：rebuildProjection 与 getProjection 除 generatedAt 外 deepEqual；refold（eventLog 重建）等价；
//   5. 向后兼容：无新字段的老命令照常（Evidence 对象保持 P0 形状、自然键 replay 不漂移）；
//   6. durable command journal 记录 'verification' 类别 + 重启后核验命令 replay。
// 运行：node --experimental-strip-types --test --experimental-test-isolation=none test/v4life-p1-semantics.test.mjs
// 隔离：每个用例独立引擎/临时目录，不共享可变状态。

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createV4LifeEngine, V4LifeError } from '../lib/v4life/engine.ts';
import { createV4LifeDemoSeed } from '../lib/v4life/seed.ts';
import { rebuildProjection } from '../lib/v4life/replay.ts';
import { createFileEventLog } from '../lib/v4life/file-event-log.ts';
import { createCommandJournal } from '../lib/v4life/command-journal.ts';
import { parseChangeVerificationBody } from '../lib/v4life/http.ts';

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

let commandCounter = 0;
function nextCommandId(label) {
  commandCounter += 1;
  return `cmd-p1-${label}-${commandCounter}`;
}

/** 固定测试时钟：单调、可复现（时间戳本身不参与断言，仅避免依赖真实时钟） */
function makeClock() {
  let ticks = 0;
  const base = Date.UTC(2030, 8, 1, 0, 0, 0);
  return () => new Date(base + (++ticks) * 1000).toISOString();
}

function freshEngine(seed) {
  // P1-BE-01：candidate 语义默认关闭（正式权威路径），本文件专门测试 P1 Candidate 行为，
  // 因此统一显式 opt-in 'demo'；默认 strict 行为见 v4life-p1-isolation.test.mjs。
  return createV4LifeEngine(seed ?? createV4LifeDemoSeed(), {
    p1CandidateSemantics: 'demo',
    now: makeClock(),
  });
}

function expectCode(operation, code) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof V4LifeError, `应抛 V4LifeError，实际收到 ${String(error)}`);
    assert.equal(error.code, code, `错误码应为 ${code}`);
    return true;
  });
}

function evidenceOf(projection, evidenceId) {
  return projection.evidence.find((entry) => entry.evidenceId === evidenceId);
}

function stripGeneratedAt(projection) {
  const rest = structuredClone(projection);
  delete rest.generatedAt;
  return rest;
}

/** 内存事件账本（V4LifeEventLog port 的最小实现；refold/重放等价测试用） */
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

/** P1 扩展字段齐备的 Evidence 命令（kind 缺省 supplement：不触发确定性 Candidate） */
function p1EvidenceCommand(overrides = {}) {
  return {
    commandId: nextCommandId('ev'),
    expectedRev: 0,
    evidenceId: 'ev-p1-statement',
    kind: 'supplement',
    title: '业务陈述：实控人口述关联关系',
    submittedBy: ACTORS.business,
    payload: {
      summary: '实控人陈述其配偶持有某关联企业 40% 股权（合成信息）。',
      tags: ['interview_note'],
    },
    sourceType: 'business_statement',
    subjectRefs: ['subject-borrower', 'subject-spouse'],
    observedAt: '2026-09-01T08:00:00.000Z',
    effectiveAt: '2026-09-01',
    expiresAt: '2026-12-31',
    evidenceRef: 'interview/2026-09-01/page-3',
    riskThreadKey: 'thread-disclosure',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1｜Evidence P1 扩展字段 + changeVerification 全链路
// ---------------------------------------------------------------------------

test('P1｜appendEvidence 注入扩展字段：verificationStatus 恒置 claimed，扩展字段进 Projection', () => {
  const engine = freshEngine();
  const command = p1EvidenceCommand({ expectedRev: engine.rev });
  const result = engine.appendEvidence(command);
  assert.equal(result.status, 'accepted');
  assert.equal(result.evidence.verificationStatus, 'claimed', 'append 恒置 claimed');
  assert.equal(result.evidence.sourceType, 'business_statement');
  assert.deepEqual(result.evidence.subjectRefs, ['subject-borrower', 'subject-spouse']);
  assert.equal(result.evidence.observedAt, '2026-09-01T08:00:00.000Z');
  assert.equal(result.evidence.effectiveAt, '2026-09-01');
  assert.equal(result.evidence.expiresAt, '2026-12-31');
  assert.equal(result.evidence.evidenceRef, 'interview/2026-09-01/page-3');
  assert.equal(result.evidence.riskThreadKey, 'thread-disclosure');

  const projected = evidenceOf(engine.getProjection(), 'ev-p1-statement');
  assert.equal(projected.verificationStatus, 'claimed', 'verificationStatus 进 Projection');
});

test('P1｜changeVerification 全链路：claimed→verified→contradicted，事件载荷携带 from/to/reason', () => {
  const engine = freshEngine();
  engine.appendEvidence(p1EvidenceCommand({ expectedRev: engine.rev }));

  const revBefore = engine.rev;
  const verified = engine.changeVerification({
    commandId: nextCommandId('ver'),
    expectedRev: engine.rev,
    evidenceId: 'ev-p1-statement',
    actorId: ACTORS.credit,
    verificationStatus: 'verified',
    reason: '原件与业务陈述一致（合成核验）。',
  });
  assert.equal(verified.status, 'accepted');
  assert.equal(verified.rev, revBefore + 1, 'rev 递增 1');
  assert.equal(verified.evidence.verificationStatus, 'verified');

  const contradicted = engine.changeVerification({
    commandId: nextCommandId('ver'),
    expectedRev: engine.rev,
    evidenceId: 'ev-p1-statement',
    actorId: ACTORS.asset,
    verificationStatus: 'contradicted',
    reason: '权属登记与陈述矛盾。',
  });
  assert.equal(contradicted.evidence.verificationStatus, 'contradicted');
  assert.equal(evidenceOf(engine.getProjection(), 'ev-p1-statement').verificationStatus, 'contradicted');

  const events = engine.getEvents(0, 500).events;
  const verificationEvents = events.filter((event) => event.payload.type === 'EVIDENCE_VERIFICATION_CHANGED');
  assert.equal(verificationEvents.length, 2);
  assert.deepEqual(
    verificationEvents.map((event) => [event.payload.from, event.payload.to]),
    [['claimed', 'verified'], ['verified', 'contradicted']],
  );
  assert.equal(verificationEvents[0].actor, ACTORS.credit, '核验事件 actor = 核验人');
  assert.equal(verificationEvents[0].payload.evidenceId, 'ev-p1-statement');
  assert.ok(verificationEvents[0].payload.reason.length > 0);
});

test('P1｜业务不得自核验（ROLE_MISMATCH）＋ 未知 actor/evidence 与非法目标状态失败关闭', () => {
  const engine = freshEngine();
  engine.appendEvidence(p1EvidenceCommand({ expectedRev: engine.rev }));
  const base = () => ({
    commandId: nextCommandId('ver'),
    expectedRev: engine.rev,
    evidenceId: 'ev-p1-statement',
    actorId: ACTORS.business,
    verificationStatus: 'verified',
    reason: '业务自行核验应被拒绝。',
  });
  // CANDIDATE（待 §11.3）：业务不得自核验
  expectCode(() => engine.changeVerification(base()), 'ROLE_MISMATCH');
  expectCode(
    () => engine.changeVerification({ ...base(), commandId: nextCommandId('ver'), actorId: 'actor-ghost' }),
    'ACTOR_NOT_FOUND',
  );
  expectCode(
    () =>
      engine.changeVerification({
        ...base(),
        commandId: nextCommandId('ver'),
        actorId: ACTORS.policy,
        evidenceId: 'ev-ghost',
      }),
    'EVIDENCE_NOT_FOUND',
  );
  expectCode(
    () =>
      engine.changeVerification({
        ...base(),
        commandId: nextCommandId('ver'),
        actorId: ACTORS.policy,
        verificationStatus: 'claimed',
      }),
    'INVALID_ENGINE_INPUT',
    "'claimed' 只能是初始值，禁止 changeVerification 设置",
  );
  expectCode(
    () =>
      engine.changeVerification({
        ...base(),
        commandId: nextCommandId('ver'),
        actorId: ACTORS.policy,
        verificationStatus: 'excellent',
      }),
    'INVALID_ENGINE_INPUT',
  );
});

test('P1｜changeVerification 幂等与冲突：同 commandId 同载荷 replayed、异载荷 IDEMPOTENCY_CONFLICT、旧 rev VERSION_CONFLICT', () => {
  const engine = freshEngine();
  engine.appendEvidence(p1EvidenceCommand({ expectedRev: engine.rev }));
  const command = {
    commandId: 'cmd-p1-ver-fixed',
    expectedRev: engine.rev,
    evidenceId: 'ev-p1-statement',
    actorId: ACTORS.credit,
    verificationStatus: 'verified',
    reason: '首次核验通过。',
  };
  const first = engine.changeVerification(command);
  assert.equal(first.status, 'accepted');
  const replay = engine.changeVerification({ ...command, expectedRev: 0 });
  assert.equal(replay.status, 'replayed', '幂等先于版本竞争');
  assert.equal(replay.rev, first.rev);
  assert.deepEqual(replay.evidence, first.evidence);
  expectCode(
    () =>
      engine.changeVerification({
        ...command,
        commandId: 'cmd-p1-ver-fixed',
        verificationStatus: 'stale',
      }),
    'IDEMPOTENCY_CONFLICT',
  );
  expectCode(
    () =>
      engine.changeVerification({
        commandId: nextCommandId('ver'),
        expectedRev: 0,
        evidenceId: 'ev-p1-statement',
        actorId: ACTORS.credit,
        verificationStatus: 'stale',
        reason: '新命令、旧 rev。',
      }),
    'VERSION_CONFLICT',
  );
});

test('P1｜扩展字段校验失败关闭：confidence 仅 model_derived、ISO 时间格式、subjectRefs 上限、verificationStatus 不接受客户端传入', () => {
  const engine = freshEngine();
  // confidence 仅 model_derived 可带
  expectCode(
    () =>
      engine.appendEvidence(
        p1EvidenceCommand({ expectedRev: engine.rev, evidenceId: 'ev-bad-conf', sourceType: 'human_review', confidence: 0.8 }),
      ),
    'INVALID_ENGINE_INPUT',
  );
  // confidence 越界
  expectCode(
    () =>
      engine.appendEvidence(
        p1EvidenceCommand({
          expectedRev: engine.rev,
          evidenceId: 'ev-bad-conf2',
          sourceType: 'model_derived',
          confidence: 1.5,
        }),
      ),
    'INVALID_ENGINE_INPUT',
  );
  // model_derived + confidence 合法
  const derived = engine.appendEvidence(
    p1EvidenceCommand({
      expectedRev: engine.rev,
      evidenceId: 'ev-derived',
      sourceType: 'model_derived',
      confidence: 0.42,
      observedAt: undefined,
    }),
  );
  assert.equal(derived.evidence.confidence, 0.42);
  assert.equal(derived.evidence.verificationStatus, 'claimed');
  // 时间三元组格式
  expectCode(
    () =>
      engine.appendEvidence(
        p1EvidenceCommand({ expectedRev: engine.rev, evidenceId: 'ev-bad-time', observedAt: '2026/09/01' }),
      ),
    'INVALID_ENGINE_INPUT',
  );
  // subjectRefs 超 20 项 / 单项超 64 字符
  expectCode(
    () =>
      engine.appendEvidence(
        p1EvidenceCommand({
          expectedRev: engine.rev,
          evidenceId: 'ev-bad-refs',
          subjectRefs: Array.from({ length: 21 }, (_, index) => `s-${index}`),
        }),
      ),
    'INVALID_ENGINE_INPUT',
  );
  expectCode(
    () =>
      engine.appendEvidence(
        p1EvidenceCommand({
          expectedRev: engine.rev,
          evidenceId: 'ev-bad-ref-len',
          subjectRefs: ['x'.repeat(65)],
        }),
      ),
    'INVALID_ENGINE_INPUT',
  );
  // 客户端传入 verificationStatus 一律拒绝（append 恒置 claimed）
  expectCode(
    () =>
      engine.appendEvidence(
        p1EvidenceCommand({ expectedRev: engine.rev, evidenceId: 'ev-bad-vs', verificationStatus: 'verified' }),
      ),
    'INVALID_ENGINE_INPUT',
  );
  // evidenceRef 超 200
  expectCode(
    () =>
      engine.appendEvidence(
        p1EvidenceCommand({ expectedRev: engine.rev, evidenceId: 'ev-bad-ref200', evidenceRef: 'x'.repeat(201) }),
      ),
    'INVALID_ENGINE_INPUT',
  );
});

test('P1｜旧数据兼容：无新字段的老命令照常，Evidence 保持 P0 形状，核验命令仍可作用于旧 Evidence（from=claimed）', () => {
  const engine = freshEngine();
  const oldEvidence = engine.appendEvidence({
    commandId: nextCommandId('old-ev'),
    expectedRev: engine.rev,
    evidenceId: 'ev-old-style',
    kind: 'supplement',
    title: '老形状补充材料',
    submittedBy: ACTORS.business,
    payload: { summary: '未注入任何 P1 字段的老命令。', tags: ['legacy'] },
  });
  const expectedKeys = [
    'evidenceId', 'caseId', 'kind', 'title', 'submittedBy', 'submittedAt', 'version', 'payload',
  ].sort();
  assert.deepEqual(Object.keys(oldEvidence.evidence).sort(), expectedKeys, '老命令产出的 Evidence 必须与 P0 逐字段一致');

  // 自然键 replay 不漂移：同载荷异 commandId 重发 → replayed（键含扩展字段但缺省时与 P0 键一致）
  const naturalReplay = engine.appendEvidence({
    commandId: nextCommandId('old-ev-2'),
    expectedRev: engine.rev,
    evidenceId: 'ev-old-style',
    kind: 'supplement',
    title: '老形状补充材料',
    submittedBy: ACTORS.business,
    payload: { summary: '未注入任何 P1 字段的老命令。', tags: ['legacy'] },
  });
  assert.equal(naturalReplay.status, 'replayed');
  // 同 id 异载荷 → EVIDENCE_CONFLICT
  expectCode(
    () =>
      engine.appendEvidence({
        commandId: nextCommandId('old-ev-3'),
        expectedRev: engine.rev,
        evidenceId: 'ev-old-style',
        kind: 'supplement',
        title: '同 id 异载荷',
        submittedBy: ACTORS.business,
        payload: { summary: '不同内容。', tags: ['legacy'] },
      }),
    'EVIDENCE_CONFLICT',
  );

  // 旧 Evidence（无 verificationStatus 字段）可被核验：from 记为逻辑初始值 'claimed'
  const verified = engine.changeVerification({
    commandId: nextCommandId('ver-old'),
    expectedRev: engine.rev,
    evidenceId: 'ev-old-style',
    actorId: ACTORS.commerce,
    verificationStatus: 'stale',
    reason: '材料超过时效阈值（演示）。',
  });
  assert.equal(verified.evidence.verificationStatus, 'stale');
  const event = engine
    .getEvents(0, 500)
    .events.find((entry) => entry.payload.type === 'EVIDENCE_VERIFICATION_CHANGED');
  assert.equal(event.payload.from, 'claimed');
  assert.equal(event.payload.to, 'stale');
  // 其余 8 个老形状字段不变
  const projected = evidenceOf(engine.getProjection(), 'ev-old-style');
  assert.equal(Object.keys(projected).length, 9, '老 Evidence 仅新增 verificationStatus 一个字段');
});

// ---------------------------------------------------------------------------
// 2｜Context 批次窗口（D076/D077）
// ---------------------------------------------------------------------------

test('P1｜种子隐含批次：初始化即 batch major=1 SEALED（openedAt=sealedAt=初始化事件 at）', () => {
  const engine = freshEngine();
  const projection = engine.getProjection();
  assert.deepEqual(projection.context, {
    major: 1,
    minor: 0,
    status: 'SEALED',
    batches: [{ major: 1, minor: 0, status: 'SEALED', openedAt: projection.context.batches[0].openedAt, sealedAt: projection.context.batches[0].sealedAt }],
  });
  const initEvent = engine.getEvents(0, 10).events[0];
  assert.equal(initEvent.payload.type, 'CASE_INITIALIZED');
  assert.equal(projection.context.batches[0].openedAt, initEvent.at, 'openedAt 取 CASE_INITIALIZED at');
  assert.equal(projection.context.batches[0].sealedAt, initEvent.at, 'sealedAt 取 CASE_INITIALIZED at');
});

test('P1｜批次窗口全生命周期：open→append×2→stabilize→seal→seal 后 append 409→再 open major+1', () => {
  const engine = freshEngine();
  // SEALED 批次不可写入
  expectCode(
    () =>
      engine.appendInputEvent({
        commandId: nextCommandId('in'),
        expectedRev: engine.rev,
        batchId: '1',
        actorId: ACTORS.business,
        inputEventId: 'in-1',
        kind: 'document',
        summary: '批复后新到司法资料。',
      }),
    'CONTEXT_WINDOW_NOT_OPEN',
    'seal 后 append 必须 409',
  );
  // batchId 不存在 / 非规范形式 → 404
  for (const badBatchId of ['99', 'abc', '01']) {
    expectCode(
      () =>
        engine.appendInputEvent({
          commandId: nextCommandId('in'),
          expectedRev: engine.rev,
          batchId: badBatchId,
          actorId: ACTORS.business,
          inputEventId: 'in-x',
          kind: 'document',
          summary: 'x',
        }),
      'CONTEXT_BATCH_NOT_FOUND',
    );
  }
  // open 角色校验（CANDIDATE：仅 business）
  expectCode(
    () =>
      engine.openContextBatch({
        commandId: nextCommandId('open'),
        expectedRev: engine.rev,
        actorId: ACTORS.policy,
        reason: '政策不能开窗。',
      }),
    'ROLE_MISMATCH',
  );
  const opened = engine.openContextBatch({
    commandId: nextCommandId('open'),
    expectedRev: engine.rev,
    actorId: ACTORS.business,
    reason: '批复后收到新的外部资料，开新批次收集。',
  });
  assert.equal(opened.status, 'accepted');
  assert.deepEqual(
    { major: opened.batch.major, minor: opened.batch.minor, status: opened.batch.status },
    { major: 2, minor: 0, status: 'OPEN' },
  );
  assert.ok(opened.batch.openedAt.length > 0);
  assert.equal(opened.batch.sealedAt, undefined, '新批次尚无 sealedAt');
  let projection = engine.getProjection();
  assert.deepEqual(
    projection.context.batches.map((batch) => batch.major),
    [2, 1],
    '最新批次在前',
  );
  assert.equal(projection.context.status, 'OPEN');

  // append×2：minor 递增
  for (const [index, kind] of [['in-1', 'document'], ['in-2', 'external_data']].entries()) {
    const appended = engine.appendInputEvent({
      commandId: nextCommandId('in'),
      expectedRev: engine.rev,
      batchId: '2',
      actorId: ACTORS.business,
      inputEventId: kind[0],
      kind: kind[1],
      summary: `外部变化 ${index + 1}（合成）`,
      subjectRefs: ['subject-borrower'],
    });
    assert.equal(appended.status, 'accepted');
    assert.equal(appended.batch.minor, index + 1, `第 ${index + 1} 次 append 后 minor 递增`);
  }
  projection = engine.getProjection();
  assert.deepEqual(
    { major: projection.context.major, minor: projection.context.minor, status: projection.context.status },
    { major: 2, minor: 2, status: 'OPEN' },
  );
  // append 字段校验
  expectCode(
    () =>
      engine.appendInputEvent({
        commandId: nextCommandId('in'),
        expectedRev: engine.rev,
        batchId: '2',
        actorId: ACTORS.business,
        inputEventId: 'in-bad',
        kind: 'rumor',
        summary: '非法 kind',
      }),
    'INVALID_ENGINE_INPUT',
  );
  expectCode(
    () =>
      engine.appendInputEvent({
        commandId: nextCommandId('in'),
        expectedRev: engine.rev,
        batchId: '2',
        actorId: 'actor-ghost',
        inputEventId: 'in-bad-2',
        kind: 'correction',
        summary: '未知 actor',
      }),
    'ACTOR_NOT_FOUND',
  );

  // stabilize：角色（CANDIDATE：policy）与状态机（仅 OPEN→STABILIZING）
  expectCode(
    () =>
      engine.stabilizeContextBatch({
        commandId: nextCommandId('stab'),
        expectedRev: engine.rev,
        batchId: '2',
        actorId: ACTORS.commerce,
        reason: '商务不能整编。',
      }),
    'ROLE_MISMATCH',
  );
  expectCode(
    () =>
      engine.stabilizeContextBatch({
        commandId: nextCommandId('stab'),
        expectedRev: engine.rev,
        batchId: '1',
        actorId: ACTORS.policy,
        reason: 'SEALED 批次不能整编。',
      }),
    'CONTEXT_BATCH_INVALID_TRANSITION',
  );
  const stabilized = engine.stabilizeContextBatch({
    commandId: nextCommandId('stab'),
    expectedRev: engine.rev,
    batchId: '2',
    actorId: ACTORS.policy,
    reason: '进入整编。',
  });
  assert.equal(stabilized.batch.status, 'STABILIZING');
  expectCode(
    () =>
      engine.stabilizeContextBatch({
        commandId: nextCommandId('stab-2'),
        expectedRev: engine.rev,
        batchId: '2',
        actorId: ACTORS.policy,
        reason: '重复整编。',
      }),
    'CONTEXT_BATCH_INVALID_TRANSITION',
  );
  expectCode(
    () =>
      engine.stabilizeContextBatch({
        commandId: nextCommandId('stab-3'),
        expectedRev: engine.rev,
        batchId: '404',
        actorId: ACTORS.policy,
        reason: '未知批次。',
      }),
    'CONTEXT_BATCH_NOT_FOUND',
  );
  // STABILIZING 期间不可 append
  expectCode(
    () =>
      engine.appendInputEvent({
        commandId: nextCommandId('in'),
        expectedRev: engine.rev,
        batchId: '2',
        actorId: ACTORS.business,
        inputEventId: 'in-late',
        kind: 'answer',
        summary: '整编期写入应被拒绝。',
      }),
    'CONTEXT_WINDOW_NOT_OPEN',
  );

  // seal：仅 STABILIZING→SEALED
  const sealed = engine.sealContextBatch({
    commandId: nextCommandId('seal'),
    expectedRev: engine.rev,
    batchId: '2',
    actorId: ACTORS.policy,
    reason: '整编完成，封存为不可变版本。',
  });
  assert.equal(sealed.batch.status, 'SEALED');
  assert.ok(sealed.batch.sealedAt.length > 0, 'seal 后写入 sealedAt');
  expectCode(
    () =>
      engine.sealContextBatch({
        commandId: nextCommandId('seal-2'),
        expectedRev: engine.rev,
        batchId: '2',
        actorId: ACTORS.policy,
        reason: '重复封存。',
      }),
    'CONTEXT_BATCH_INVALID_TRANSITION',
  );
  // seal 后 append → 409
  expectCode(
    () =>
      engine.appendInputEvent({
        commandId: nextCommandId('in'),
        expectedRev: engine.rev,
        batchId: '2',
        actorId: ACTORS.business,
        inputEventId: 'in-after-seal',
        kind: 'document',
        summary: '封存后写入。',
      }),
    'CONTEXT_WINDOW_NOT_OPEN',
  );

  // 再 open：major+1
  const reopened = engine.openContextBatch({
    commandId: nextCommandId('open-2'),
    expectedRev: engine.rev,
    actorId: ACTORS.business,
    reason: '新变化触发再收集。',
  });
  assert.equal(reopened.batch.major, 3, '新批次 major = 上一 major + 1');
  assert.equal(reopened.batch.minor, 0);
  projection = engine.getProjection();
  assert.deepEqual(
    projection.context.batches.map((batch) => [batch.major, batch.status]),
    [[3, 'OPEN'], [2, 'SEALED'], [1, 'SEALED']],
  );
  // 新批次直接 seal（跳过 stabilize）→ 非法迁移
  expectCode(
    () =>
      engine.sealContextBatch({
        commandId: nextCommandId('seal-3'),
        expectedRev: engine.rev,
        batchId: '3',
        actorId: ACTORS.policy,
        reason: '未整编直接封存。',
      }),
    'CONTEXT_BATCH_INVALID_TRANSITION',
  );

  // 事件流形状：五个窗口事件齐全，INPUT_EVENT_APPENDED 载荷完整
  const payloadTypes = engine.getEvents(0, 500).events.map((event) => event.payload.type);
  for (const expected of ['CONTEXT_BATCH_OPENED', 'INPUT_EVENT_APPENDED', 'CONTEXT_BATCH_STABILIZED', 'CONTEXT_BATCH_SEALED']) {
    assert.ok(payloadTypes.includes(expected), `事件流应包含 ${expected}`);
  }
  const inputEvent = engine.getEvents(0, 500).events.find((event) => event.payload.type === 'INPUT_EVENT_APPENDED');
  assert.equal(inputEvent.payload.major, 2);
  assert.equal(inputEvent.payload.minor, 1);
  assert.equal(inputEvent.payload.inputEventId, 'in-1');
  assert.equal(inputEvent.payload.kind, 'document');
});

test('P1｜窗口命令幂等：同 commandId 同载荷 replayed；stabilize/seal 同 commandId 异命令 IDEMPOTENCY_CONFLICT', () => {
  const engine = freshEngine();
  engine.openContextBatch({
    commandId: 'cmd-p1-open-fixed',
    expectedRev: engine.rev,
    actorId: ACTORS.business,
    reason: '开窗（固定 id）。',
  });
  const reopened = engine.openContextBatch({
    commandId: 'cmd-p1-open-fixed',
    expectedRev: 0,
    actorId: ACTORS.business,
    reason: '开窗（固定 id）。',
  });
  assert.equal(reopened.status, 'replayed', 'open 幂等重放，且不得再开新批次');
  assert.equal(engine.getProjection().context.major, 2);

  engine.appendInputEvent({
    commandId: 'cmd-p1-in-fixed',
    expectedRev: engine.rev,
    batchId: '2',
    actorId: ACTORS.business,
    inputEventId: 'in-fixed',
    kind: 'document',
    summary: '固定 id 的输入事件。',
  });
  const reAppended = engine.appendInputEvent({
    commandId: 'cmd-p1-in-fixed',
    expectedRev: 0,
    batchId: '2',
    actorId: ACTORS.business,
    inputEventId: 'in-fixed',
    kind: 'document',
    summary: '固定 id 的输入事件。',
  });
  assert.equal(reAppended.status, 'replayed');
  assert.equal(engine.getProjection().context.minor, 1, '幂等重放不得重复递增 minor');

  engine.stabilizeContextBatch({
    commandId: 'cmd-p1-transition',
    expectedRev: engine.rev,
    batchId: '2',
    actorId: ACTORS.policy,
    reason: '整编。',
  });
  expectCode(
    () =>
      engine.sealContextBatch({
        commandId: 'cmd-p1-transition',
        expectedRev: engine.rev,
        batchId: '2',
        actorId: ACTORS.policy,
        reason: '载荷不同但 id 相同。',
      }),
    'IDEMPOTENCY_CONFLICT',
    '同 commandId 异载荷（stabilize→seal）必须冲突',
  );
});

// ---------------------------------------------------------------------------
// 3｜Risk Thread 投影
// ---------------------------------------------------------------------------

/** seed 扩展：WI-P1 → thread-policy；WI-C1/WI-C2 → thread-credit */
function seedWithThreads() {
  const seed = createV4LifeDemoSeed();
  const keyById = { 'WI-P1': 'thread-policy', 'WI-C1': 'thread-credit', 'WI-C2': 'thread-credit' };
  return {
    ...seed,
    workItems: seed.workItems.map((item) =>
      keyById[item.workItemId] !== undefined ? { ...item, riskThreadKey: keyById[item.workItemId] } : item,
    ),
  };
}

test('P1｜Risk Thread 折叠：seed workItem 进线程，Evidence 按 key 折叠，lastSeq 取关联对象最大事件序', () => {
  const engine = freshEngine(seedWithThreads());
  let projection = engine.getProjection();
  // 初始化事件序：1 init / 2 seed Evidence / 3 R2 Candidate / 4 WI-P1 started / 5 WI-C1 started / 6 WI-A1 started
  assert.equal(engine.rev, 6);
  assert.deepEqual(projection.riskThreads, [
    { riskThreadKey: 'thread-policy', evidenceIds: [], workItemIds: ['WI-P1'], gateIds: ['PG-1'], lastSeq: 4 },
    {
      riskThreadKey: 'thread-credit',
      evidenceIds: [],
      workItemIds: ['WI-C1', 'WI-C2'],
      gateIds: [],
      lastSeq: 5,
    },
  ], 'seed 声明先入线程（seed 序）；lastSeq 取初始化启动事件序');

  // Evidence 按 key 折叠
  const evA = engine.appendEvidence(
    p1EvidenceCommand({ expectedRev: engine.rev, evidenceId: 'ev-thread-a', riskThreadKey: 'thread-credit' }),
  );
  projection = engine.getProjection();
  let creditThread = projection.riskThreads.find((thread) => thread.riskThreadKey === 'thread-credit');
  assert.deepEqual(creditThread.evidenceIds, ['ev-thread-a']);
  assert.equal(creditThread.lastSeq, evA.rev, 'lastSeq = EVIDENCE_ACCEPTED 事件序');

  // 同 key 第二条 Evidence
  engine.appendEvidence(
    p1EvidenceCommand({ expectedRev: engine.rev, evidenceId: 'ev-thread-b', riskThreadKey: 'thread-credit' }),
  );
  // 核验触碰线程 → lastSeq 推进
  const verified = engine.changeVerification({
    commandId: nextCommandId('ver'),
    expectedRev: engine.rev,
    evidenceId: 'ev-thread-a',
    actorId: ACTORS.credit,
    verificationStatus: 'verified',
    reason: '核验通过。',
  });
  projection = engine.getProjection();
  creditThread = projection.riskThreads.find((thread) => thread.riskThreadKey === 'thread-credit');
  assert.deepEqual(creditThread.evidenceIds, ['ev-thread-a', 'ev-thread-b']);
  assert.equal(creditThread.lastSeq, verified.rev, '核验事件推进 lastSeq');

  // 工作项事件推进 lastSeq（WI-C1 提交后无 gate → completed，两次触碰取最大）
  const submitted = engine.submitWork({
    commandId: nextCommandId('work'),
    expectedRev: engine.rev,
    workItemId: 'WI-C1',
    actorId: ACTORS.credit,
    outputSummary: '完整性核验完成。',
  });
  projection = engine.getProjection();
  creditThread = projection.riskThreads.find((thread) => thread.riskThreadKey === 'thread-credit');
  assert.equal(creditThread.lastSeq, submitted.rev, 'workItem 事件推进 lastSeq（提交+完成取最大）');

  // 无 key 的对象不进线程；新 key 按首次出现序追加
  engine.appendEvidence({
    commandId: nextCommandId('ev'),
    expectedRev: engine.rev,
    evidenceId: 'ev-no-thread',
    kind: 'supplement',
    title: '无 key 材料',
    submittedBy: ACTORS.business,
    payload: { summary: '不含 riskThreadKey。', tags: ['plain'] },
  });
  engine.appendEvidence(
    p1EvidenceCommand({ expectedRev: engine.rev, evidenceId: 'ev-thread-c', riskThreadKey: 'thread-new' }),
  );
  projection = engine.getProjection();
  assert.deepEqual(
    projection.riskThreads.map((thread) => thread.riskThreadKey),
    ['thread-policy', 'thread-credit', 'thread-new'],
    'key 按首次出现序',
  );
  assert.ok(!projection.riskThreads.some((thread) => thread.evidenceIds.includes('ev-no-thread')),'无 key 的对象不进线程');
});

// ---------------------------------------------------------------------------
// 4｜重放等价（rebuildProjection / refold）
// ---------------------------------------------------------------------------

/** 全场景：老命令 + P1 命令混合，产出事件流供重放等价断言 */
function runFullScenario(engine) {
  engine.appendEvidence({
    commandId: nextCommandId('old-fin'),
    expectedRev: engine.rev,
    evidenceId: 'ev-financial-statement',
    kind: 'financial_statement',
    title: '2025 年度审计报告摘要',
    submittedBy: ACTORS.business,
    payload: {
      summary: '营收同比下滑约 18%，经营现金流为负。',
      tags: ['revenue_declining', 'audited'],
    },
  });
  engine.appendEvidence(
    p1EvidenceCommand({
      expectedRev: engine.rev,
      evidenceId: 'ev-contract-draft',
      kind: 'contract_draft',
      title: '设备采购与流动资金借款合同草案',
      sourceType: 'original_document',
      subjectRefs: ['subject-borrower'],
      observedAt: '2026-09-02',
      evidenceRef: 'contracts/draft-v2',
      riskThreadKey: 'thread-contract',
      payload: {
        summary: '借款金额 500 万元，期限 24 个月。',
        amountCny: 5_000_000,
        tags: ['draft'],
      },
    }),
  );
  engine.changeVerification({
    commandId: nextCommandId('ver'),
    expectedRev: engine.rev,
    evidenceId: 'ev-contract-draft',
    actorId: ACTORS.credit,
    verificationStatus: 'contradicted',
    reason: '合同金额与报表口径矛盾（演示核验）。',
  });
  engine.openContextBatch({
    commandId: nextCommandId('open'),
    expectedRev: engine.rev,
    actorId: ACTORS.business,
    reason: '批复后新资料开窗。',
  });
  engine.appendInputEvent({
    commandId: nextCommandId('in'),
    expectedRev: engine.rev,
    batchId: '2',
    actorId: ACTORS.business,
    inputEventId: 'in-suite-1',
    kind: 'external_data',
    summary: '新增涉诉信息（合成）。',
  });
  engine.stabilizeContextBatch({
    commandId: nextCommandId('stab'),
    expectedRev: engine.rev,
    batchId: '2',
    actorId: ACTORS.policy,
    reason: '整编。',
  });
  engine.sealContextBatch({
    commandId: nextCommandId('seal'),
    expectedRev: engine.rev,
    batchId: '2',
    actorId: ACTORS.policy,
    reason: '封存。',
  });
  engine.submitWork({
    commandId: nextCommandId('work'),
    expectedRev: engine.rev,
    workItemId: 'WI-P1',
    actorId: ACTORS.policy,
    outputSummary: '政策准入初核完成。',
  });
  engine.recordDecision({
    commandId: nextCommandId('dec'),
    expectedRev: engine.rev,
    gateId: 'PG-1',
    actorId: ACTORS.policy,
    outcome: 'approved',
    reason: '准入要件齐备。',
  });
  return engine;
}

test('P1｜重放等价：全场景事件 rebuildProjection 与 getProjection 除 generatedAt 外 deepEqual（含 riskThreadKey seed）', () => {
  const seed = seedWithThreads();
  const engine = runFullScenario(freshEngine(seed));
  const projection = engine.getProjection();
  const events = engine.getEvents(0, 500).events;
  const rebuilt = rebuildProjection(seed, events, '2030-09-01T00:00:00.000Z', { p1CandidateSemantics: 'demo' });
  assert.deepEqual(
    stripGeneratedAt(rebuilt),
    stripGeneratedAt(projection),
    'rebuildProjection 与 getProjection 必须重放等价（context/riskThreads 含在内）',
  );
  assert.ok(rebuilt.context.batches.length >= 2);
  assert.ok(rebuilt.riskThreads.length >= 3);
  assert.equal(evidenceOf(rebuilt, 'ev-contract-draft').verificationStatus, 'contradicted');
});

test('P1｜refold 等价：注入 eventLog 的第二只引擎折叠同一事件流后投影 deepEqual', () => {
  const seed = seedWithThreads();
  const eventLog = createMemoryEventLog();
  const engine1 = createV4LifeEngine(seed, { p1CandidateSemantics: 'demo', eventLog, now: makeClock() });
  runFullScenario(engine1);
  // 模拟重启：全新引擎从同一 eventLog refold
  const engine2 = createV4LifeEngine(seed, { p1CandidateSemantics: 'demo', eventLog, now: makeClock() });
  assert.equal(engine2.rev, engine1.rev, '重启后 rev 恢复');
  assert.deepEqual(
    stripGeneratedAt(engine2.getProjection()),
    stripGeneratedAt(engine1.getProjection()),
    'refold 与在线投影必须等价',
  );
});

// ---------------------------------------------------------------------------
// 5｜向后兼容（P0 行为逐字节不变）
// ---------------------------------------------------------------------------

test('P1｜向后兼容：全新 demo 引擎初始化事件数不变、无新增事件、projection 新增字段为种子缺省值', () => {
  const engine = freshEngine();
  // P0 基线：init + seed Evidence + R2 Candidate + 3 个依赖启动 = 6 个事件（本 lane 未新增任何初始化事件）
  assert.equal(engine.rev, 6, '初始化事件数与 P0 完全一致');
  const projection = engine.getProjection();
  assert.equal(projection.eventCount, 6);
  assert.equal(projection.evidenceCount, 1);
  const seedEvidence = projection.evidence[0];
  assert.equal(seedEvidence.verificationStatus, undefined, '旧种子 Evidence 不注入新字段');
  assert.deepEqual(
    Object.keys(seedEvidence).sort(),
    ['caseId', 'evidenceId', 'kind', 'payload', 'submittedAt', 'submittedBy', 'title', 'version'].sort(),
  );
  assert.equal(projection.context.status, 'SEALED');
  assert.deepEqual(projection.riskThreads, [], '无 key seed 无线程');
  const events = engine.getEvents(0, 10).events;
  assert.deepEqual(
    events.map((event) => event.payload.type),
    ['CASE_INITIALIZED', 'EVIDENCE_ACCEPTED', 'CANDIDATE_ISSUED', 'WORK_ITEM_STARTED', 'WORK_ITEM_STARTED', 'WORK_ITEM_STARTED'],
    '事件类型序列与 P0 完全一致',
  );
});

test('P1｜向后兼容：老命令全链路（append→submit→decision）行为不变', () => {
  const engine = freshEngine();
  engine.appendEvidence({
    commandId: nextCommandId('compat-fin'),
    expectedRev: engine.rev,
    evidenceId: 'ev-financial-statement',
    kind: 'financial_statement',
    title: '2025 年度审计报告摘要',
    submittedBy: ACTORS.business,
    payload: { summary: '营收同比下滑约 18%。', tags: ['revenue_declining', 'audited'] },
  });
  const submitted = engine.submitWork({
    commandId: nextCommandId('compat-work'),
    expectedRev: engine.rev,
    workItemId: 'WI-P1',
    actorId: ACTORS.policy,
    outputSummary: '政策准入初核完成。',
  });
  assert.equal(submitted.status, 'accepted');
  assert.equal(submitted.gate.status, 'open');
  const decided = engine.recordDecision({
    commandId: nextCommandId('compat-dec'),
    expectedRev: engine.rev,
    gateId: 'PG-1',
    actorId: ACTORS.policy,
    outcome: 'approved',
    reason: '准入要件齐备。',
  });
  assert.equal(decided.receipt.receiptId, 'rcpt-PG-1-1', 'Receipt 编号规则不变');
});

// ---------------------------------------------------------------------------
// 6｜durable command journal：'verification' 类别 + 重启 replay
// ---------------------------------------------------------------------------

const JOURNAL_CASE = 'demo-sme-robot-500w';

test('P1｜commandJournal 记录 verification/context_batch 类别；重启后同 commandId 重发 → replayed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'v4life-p1-journal-'));
  const boot = () =>
    createV4LifeEngine(createV4LifeDemoSeed(), {
      p1CandidateSemantics: 'demo',
      eventLog: createFileEventLog({ dir }),
      commandJournal: createCommandJournal({ dir }),
      now: makeClock(),
    });
  const engine1 = boot();
  engine1.appendEvidence(p1EvidenceCommand({ expectedRev: engine1.rev, evidenceId: 'ev-journal-p1' }));
  const verification = {
    commandId: 'cmd-p1-journal-ver',
    expectedRev: engine1.rev,
    evidenceId: 'ev-journal-p1',
    actorId: ACTORS.credit,
    verificationStatus: 'verified',
    reason: '核验通过（journal 验证）。',
  };
  const first = engine1.changeVerification(verification);
  assert.equal(first.status, 'accepted');
  // P1-BE-01：窗口命令族同样以 'context_batch' 入 journal（此前仅进程内缓存，重启后幂等丢失）
  const open = engine1.openContextBatch({
    commandId: 'cmd-p1-journal-open',
    expectedRev: engine1.rev,
    actorId: ACTORS.business,
    reason: '开窗。',
  });
  assert.equal(open.status, 'accepted');

  const records = createCommandJournal({ dir }).loadAll(JOURNAL_CASE);
  assert.deepEqual(
    records.map((record) => record.command),
    ['evidence', 'verification', 'context_batch'],
    "journal 应按序记录 'evidence'、'verification' 与 'context_batch'",
  );
  assert.equal(records[1].commandId, 'cmd-p1-journal-ver');
  assert.equal(records[1].result.status, 'accepted');
  assert.equal(records[2].commandId, 'cmd-p1-journal-open');

  // 模拟重启：同目录成对注入，refold + journal 恢复
  const engine2 = boot();
  assert.equal(engine2.rev, engine1.rev, '重启后 rev 必须恢复');
  const replay = engine2.changeVerification({ ...verification, expectedRev: 0 });
  assert.equal(replay.status, 'replayed', '重启后核验命令必须 replayed');
  assert.equal(replay.rev, first.rev);
  assert.equal(replay.evidence.verificationStatus, 'verified');
  // 窗口命令族重启后同样 replayed（P1-BE-01 加固）
  const openReplay = engine2.openContextBatch({
    commandId: 'cmd-p1-journal-open',
    expectedRev: 0,
    actorId: ACTORS.business,
    reason: '开窗。',
  });
  assert.equal(openReplay.status, 'replayed', '重启后收集窗口命令必须 replayed');
  assert.equal(openReplay.batch.major, 2);
  assert.equal(openReplay.batch.status, 'OPEN');
});

// ---------------------------------------------------------------------------
// 7｜http.ts：changeVerification body 解析器（仅追加部分）
// ---------------------------------------------------------------------------

test('P1｜parseChangeVerificationBody：合法 body 通过；claimed/缺字段/非法值 → INVALID_ENGINE_INPUT', () => {
  const baseBody = {
    commandId: 'cmd-http-2',
    expectedRev: 0,
    evidenceId: 'ev-1',
    actorId: ACTORS.credit,
    verificationStatus: 'verified',
    reason: 'x',
  };
  const ok = parseChangeVerificationBody({
    commandId: 'cmd-http-1',
    expectedRev: 3,
    evidenceId: 'ev-1',
    actorId: ACTORS.credit,
    verificationStatus: 'verified',
    reason: '核验通过。',
  });
  assert.deepEqual(ok, {
    ok: true,
    command: {
      commandId: 'cmd-http-1',
      expectedRev: 3,
      evidenceId: 'ev-1',
      actorId: ACTORS.credit,
      verificationStatus: 'verified',
      reason: '核验通过。',
    },
  });
  // 任一必填字段缺失 → 失败关闭
  for (const key of Object.keys(baseBody)) {
    const missing = { ...baseBody };
    delete missing[key];
    const result = parseChangeVerificationBody(missing);
    assert.deepEqual(
      result,
      { ok: false, code: 'INVALID_ENGINE_INPUT' },
      `缺失字段 ${key} 应失败关闭`,
    );
  }
  for (const bad of [
    { verificationStatus: 'claimed' },
    { verificationStatus: 'excellent' },
    { verificationStatus: 1 },
    { reason: '' },
    { expectedRev: -1 },
    { expectedRev: 1.5 },
  ]) {
    const result = parseChangeVerificationBody({ ...baseBody, ...bad });
    assert.deepEqual(result, { ok: false, code: 'INVALID_ENGINE_INPUT' }, `非法输入应失败关闭：${JSON.stringify(bad)}`);
  }
});
