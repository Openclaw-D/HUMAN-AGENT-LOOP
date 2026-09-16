import assert from 'node:assert/strict';
import test from 'node:test';
import { createSampleDefinition, getScenarioPack, scenarioPacks } from '../src/v2-scenarios.mjs';
import {
  V2_EVENT_TYPES,
  createV2SampleEvents,
  replayV2Events,
  selectV2View,
} from '../src/v2-projection.mjs';

const expectedPacks = [
  ['risk', '风控业务协同', 'progress'],
  ['dev', '需求开发协同', 'progress'],
  ['interaction', '人机交互协同', 'relation'],
  ['content', '内容生产协同', 'progress'],
  ['growth', '经营增长协同', 'matrix'],
  ['embodied', '物理智能协同', 'relation'],
  ['knowledge', '知识办公协同', 'progress'],
  ['service', '客户服务协同', 'progress'],
  ['supply-chain', '供应链履约协同', 'matrix'],
  ['healthcare', '医疗服务协同', 'progress'],
];

const requiredProjectionKeys = [
  'schemaVersion', 'projectionIdentity', 'dataOrigin', 'scenario', 'work', 'projectionVersion',
  'eventCursor', 'generatedAt', 'actors', 'relations', 'stages', 'matrix', 'evidence', 'artifacts',
  'challenges', 'gates', 'handoffs', 'actions', 'receipts', 'modelRuns', 'activities', 'availableCommands',
];

function assertDeepFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.ok(Object.isFrozen(value), `冻结输入未被冻结：${JSON.stringify(value)}`);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function cloneEvents(events) {
  return structuredClone(events);
}

function makeEvent(sequence, type, actorId, payload, eventId = `synthetic-${sequence}`) {
  return {
    eventId,
    sequence,
    type,
    occurredAt: `2026-01-02T00:00:${String(sequence % 60).padStart(2, '0')}.000Z`,
    actorId,
    payload,
  };
}

function identityOf(events) {
  return structuredClone(events[0].payload.identity);
}

test('十个场景包保持冻结顺序、差异、范围和模型禁权', () => {
  assert.equal(scenarioPacks.length, 10);
  assert.deepEqual(
    scenarioPacks.map((pack) => [pack.id, pack.displayName, pack.defaultView]),
    expectedPacks,
  );
  assertDeepFrozen(scenarioPacks);

  const displayTexts = new Set();
  const scopeTexts = new Set();
  for (const pack of scenarioPacks) {
    displayTexts.add(`${pack.displayName}|${pack.display.summary}|${pack.display.typicalLoop}`);
    scopeTexts.add(pack.scope);
    assert.ok(pack.stages.length >= 6, `${pack.id}阶段数不足`);
    const actorTypes = new Set(pack.roles.map((role) => role.type));
    for (const requiredType of ['human', 'agent', 'system']) assert.ok(actorTypes.has(requiredType));
    assert.ok(pack.loops.length >= 1);
    assert.ok(pack.matrix.columns.length >= 3);
    assert.ok(pack.matrix.rows.length >= 3);
    assert.ok(pack.evidenceScope.length >= 3);
    assert.ok(pack.metrics.length >= 3);
    assert.ok(pack.negativePath.trigger.length > 0);
    assert.ok(pack.modelPolicy.authority === 'none' || pack.modelPolicy.authority === '仅建议');
    const forbidden = pack.modelPolicy.forbiddenActions.join('；');
    assert.match(forbidden, /目标/);
    assert.match(forbidden, /责任/);
    assert.match(forbidden, /关口/);
    assert.match(forbidden, /外部动作/);
  }
  assert.equal(displayTexts.size, 10);
  assert.equal(scopeTexts.size, 10);

  const embodied = getScenarioPack('embodied');
  assert.match(embodied.scope, /智能网联汽车/);
  assert.ok(embodied.evidenceScope.includes('智能网联汽车'));
  const healthcare = getScenarioPack('healthcare');
  assert.match(healthcare.scope, /诊疗辅助、质控、随访/);
  assert.ok(healthcare.evidenceScope.includes('诊疗辅助、质控、随访'));

  const growth = getScenarioPack('growth');
  assert.deepEqual(
    growth.matrix.columns.map((column) => column.label),
    ['策略', '实验', '活动'],
  );
  const supplyChain = getScenarioPack('supply-chain');
  assert.deepEqual(
    supplyChain.matrix.columns.map((column) => column.label),
    ['订单', '物料', '异常任务'],
  );
});

test('示例定义是可变深拷贝并引用唯一场景身份', () => {
  const workIds = new Set();
  for (const [id] of expectedPacks) {
    const first = createSampleDefinition(id);
    const second = createSampleDefinition(id);
    assert.notEqual(first, second);
    assert.equal(Object.isFrozen(first), false);
    assert.equal(first.dataOrigin, 'sample');
    assert.equal(first.workId, `${id}-sample-work-v2`);
    workIds.add(first.workId);

    const pack = getScenarioPack(id);
    assert.deepEqual(first.actors.map((actor) => actor.id), pack.roles.map((actor) => actor.id));
    assert.deepEqual(first.stages.map((stage) => stage.id), pack.stages.map((stage) => stage.id));
    assert.deepEqual(
      first.matrix.rows.map((row) => row.actorId),
      pack.matrix.rows.map((row) => row.actorId),
    );
    assert.deepEqual(
      first.matrix.columns.map((column) => column.id),
      pack.matrix.columns.map((column) => column.id),
    );
    assert.equal(first.loops[0].id, pack.loops[0].id);
    assert.equal(first.sampleSignals.loopId, pack.loops[0].id);

    first.actors[0].name = '被修改的示例角色';
    first.stages[0].displayName = '被修改的示例阶段';
    first.matrix.rows[0].cells[0].label = '被修改的示例单元格';
    assert.notEqual(second.actors[0].name, first.actors[0].name);
    assert.notEqual(second.stages[0].displayName, first.stages[0].displayName);
    assert.notEqual(second.matrix.rows[0].cells[0].label, first.matrix.rows[0].cells[0].label);
    assert.equal(pack.roles[0].name, second.actors[0].name);
    assert.equal(pack.stages[0].displayName, second.stages[0].displayName);
    assert.equal(pack.matrix.rows[0].cells[0].label, second.matrix.rows[0].cells[0].label);
  }
  assert.equal(workIds.size, 10);
});

test('十个确定性事件链重放出完整V2权威投影', () => {
  assert.deepEqual(V2_EVENT_TYPES, [
    'WorkCreated', 'MessageAppended', 'GoalChanged', 'EvidenceRequested', 'EvidenceProvided',
    'ArtifactProposed', 'ChallengeRaised', 'GateDecided', 'HandoffProposed', 'HandoffAccepted',
    'ActionIntentRequested', 'ReceiptRecorded', 'WorkPaused', 'WorkResumed', 'WorkRolledBack',
    'ModelRunRequested', 'ModelRunStarted', 'ModelRunArtifactProduced', 'ModelRunCompleted',
    'ModelRunFailed', 'ModelRunUnknown', 'ModelRunCancelRequested', 'ModelRunCancelled',
  ]);

  for (const [id] of expectedPacks) {
    const events = createV2SampleEvents(id);
    assert.deepEqual(events, createV2SampleEvents(id));
    assert.equal(events[0].type, 'WorkCreated');
    assert.deepEqual(events.map((item) => item.sequence), events.map((item, index) => index + 1));
    assert.equal(new Set(events.map((item) => item.eventId)).size, events.length);
    assert.ok(events.some((item) => item.type === 'MessageAppended'));
    assert.ok(events.some((item) => item.type === 'ModelRunRequested'));
    assert.ok(events.some((item) => item.type === 'ModelRunStarted'));
    assert.ok(events.some((item) => item.type === 'ModelRunArtifactProduced'));
    assert.ok(events.some((item) => item.type === 'ModelRunUnknown'));

    const projection = replayV2Events(events);
    assert.equal(projection.schemaVersion, 'work-projection.v2');
    for (const key of requiredProjectionKeys) assert.ok(Object.hasOwn(projection, key), `${id}缺少${key}`);
    assert.equal(projection.dataOrigin, 'sample');
    assert.equal(projection.projectionIdentity.workspaceId, 'p1-v2-sample-workspace');
    assert.equal(projection.projectionIdentity.workId, events[0].payload.identity.workId);
    assert.equal(projection.projectionVersion, events.length);
    assert.equal(projection.eventCursor, events.length);
    assert.equal(projection.generatedAt, events.at(-1).occurredAt);
    assert.equal(projection.work.goalVersion, id === 'dev' ? 2 : 1);
    assert.equal(projection.work.ownerActorId, `${id}-owner-human`);
    assert.equal(projection.work.stageId, getScenarioPack(id).loops[0].toStageId);
    assert.notEqual(projection.work.status, 'completed');
    assert.equal(projection.evidence.length, 1);
    assert.equal(projection.modelRuns.length, 1);
    assert.equal(projection.modelRuns[0].status, 'unknown');
    assert.equal(projection.receipts[0].status, 'unknown');
    assert.equal(projection.activities.length, events.length);
  }
});

test('三视图从同一投影纯选择且共享同一身份快照', () => {
  for (const [id] of expectedPacks) {
    const events = createV2SampleEvents(id);
    const projection = replayV2Events(events);
    const before = structuredClone(projection);
    const expectedIdentity = {
      workspaceId: projection.projectionIdentity.workspaceId,
      workId: projection.projectionIdentity.workId,
      goalVersion: projection.work.goalVersion,
      projectionVersion: projection.projectionVersion,
      eventCursor: projection.eventCursor,
      generatedAt: projection.generatedAt,
    };

    const relation = selectV2View(projection, 'relation');
    const progress = selectV2View(projection, 'progress');
    const matrix = selectV2View(projection, 'matrix');
    assert.deepEqual(relation.identity, expectedIdentity);
    assert.deepEqual(progress.identity, expectedIdentity);
    assert.deepEqual(matrix.identity, expectedIdentity);
    assert.equal(relation.view, 'relation');
    assert.equal(progress.view, 'progress');
    assert.equal(matrix.view, 'matrix');
    assert.ok(relation.nodes.length >= projection.actors.length + 1);
    assert.ok(relation.edges.length >= projection.relations.length + 1);
    assert.ok(progress.stages.length >= 6);
    assert.equal(progress.currentStageId, projection.work.stageId);
    assert.equal(progress.loops.length, projection.loops.length);
    assert.deepEqual(matrix.matrix, projection.matrix);
    assert.deepEqual(projection, before);
    assert.throws(() => selectV2View(projection, 'dashboard'), /未知视图/);
  }
});

test('普通消息非权威且不创建任何模型运行', () => {
  const events = createV2SampleEvents('risk').slice(0, 2);
  const projection = replayV2Events(events);
  assert.equal(events[1].type, 'MessageAppended');
  assert.equal(projection.modelRuns.length, 0);
  assert.equal(projection.activities.at(-1).authoritative, false);
  assert.equal(projection.work.status, 'active');
});

test('显式模型链只产生待审候选且不能改权威边界', () => {
  const events = createV2SampleEvents('content');
  const beforeModel = replayV2Events(events.slice(0, 6));
  const afterUnknown = replayV2Events(events.slice(0, 10));
  const ownerBefore = beforeModel.work.ownerActorId;
  const goalVersionBefore = beforeModel.work.goalVersion;
  const gatesBefore = structuredClone(beforeModel.gates);
  const actionsBefore = structuredClone(beforeModel.actions);
  const receiptsBefore = structuredClone(beforeModel.receipts);

  assert.equal(afterUnknown.modelRuns.length, 1);
  assert.equal(afterUnknown.modelRuns[0].status, 'unknown');
  const candidate = afterUnknown.artifacts.find((artifact) => artifact.modelRunId === afterUnknown.modelRuns[0].id);
  assert.equal(candidate.state, 'pending_review');
  assert.equal(candidate.pendingHumanReview, true);
  assert.equal(afterUnknown.work.ownerActorId, ownerBefore);
  assert.equal(afterUnknown.work.goalVersion, goalVersionBefore);
  assert.deepEqual(afterUnknown.gates, gatesBefore);
  assert.deepEqual(afterUnknown.actions, actionsBefore);
  assert.deepEqual(afterUnknown.receipts, receiptsBefore);
  assert.notEqual(afterUnknown.work.status, 'completed');

  const goalByAgent = cloneEvents(createV2SampleEvents('content').slice(0, 2));
  goalByAgent.push(makeEvent(3, 'GoalChanged', 'content-assistant-agent', {
    identity: identityOf(goalByAgent),
    goal: '智能体试图改变目标',
    reason: '禁权测试',
  }));
  assert.throws(() => replayV2Events(goalByAgent), /要求具名人类|要求当前负责人/);

  const modelStartByHuman = cloneEvents(createV2SampleEvents('content').slice(0, 7));
  modelStartByHuman.push(makeEvent(8, 'ModelRunStarted', 'content-owner-human', {
    identity: identityOf(modelStartByHuman),
    runId: 'content-model-run-001',
  }));
  assert.throws(() => replayV2Events(modelStartByHuman), /要求具名智能体/);
});

test('目标漂移影响旧候选、人工关口和外部动作', () => {
  const events = createV2SampleEvents('dev');
  const goalEventIndex = events.findIndex((item) => item.type === 'GoalChanged');
  assert.ok(goalEventIndex > 0);
  const projection = replayV2Events(events.slice(0, goalEventIndex + 1));
  assert.equal(projection.work.goalVersion, 2);
  assert.equal(projection.work.goalChange.changedByActorId, 'dev-owner-human');
  for (const artifact of projection.artifacts) {
    assert.equal(artifact.pendingHumanReview, true);
    assert.equal(artifact.impactedByGoalVersion, 2);
  }
  for (const gate of projection.gates) {
    assert.equal(gate.validAgainstGoalVersion, false);
    assert.equal(gate.impactedByGoalVersion, 2);
  }
  for (const action of projection.actions) {
    assert.equal(action.state, 'blocked_by_goal_change');
    assert.equal(action.validAgainstGoalVersion, false);
  }
});

test('运行未知和回执未知都不能静默变成成功', () => {
  const events = createV2SampleEvents('healthcare');
  const beforeRollback = replayV2Events(events.slice(0, events.findIndex((item) => item.type === 'WorkRolledBack')));
  assert.equal(beforeRollback.modelRuns[0].status, 'unknown');
  assert.equal(beforeRollback.receipts[0].status, 'unknown');
  assert.equal(beforeRollback.work.status, 'unknown');
  assert.notEqual(beforeRollback.work.status, 'completed');
  const full = replayV2Events(events);
  assert.equal(full.modelRuns[0].status, 'unknown');
  assert.equal(full.receipts[0].status, 'unknown');
  assert.notEqual(full.work.status, 'completed');
});

test('补充交接、暂停恢复、取消、完成和失败生命周期', () => {
  const source = createV2SampleEvents('risk');
  const identity = identityOf(source);

  const handoffEvents = cloneEvents(source.slice(0, 11));
  handoffEvents.push(makeEvent(12, 'HandoffProposed', 'risk-owner-human', {
    identity,
    handoffId: 'risk-handoff-001',
    recipientActorId: 'risk-gate-human',
    context: '人工复核后由关口人继续负责核验。',
  }));
  handoffEvents.push(makeEvent(13, 'HandoffAccepted', 'risk-gate-human', {
    identity,
    handoffId: 'risk-handoff-001',
  }));
  handoffEvents.push(makeEvent(14, 'WorkPaused', 'risk-gate-human', { identity }));
  handoffEvents.push(makeEvent(15, 'WorkResumed', 'risk-gate-human', { identity }));
  const handoff = replayV2Events(handoffEvents);
  assert.equal(handoff.work.ownerActorId, 'risk-gate-human');
  assert.equal(handoff.handoffs[0].state, 'accepted');
  assert.equal(handoff.work.status, 'active');

  const cancelEvents = cloneEvents(source.slice(0, 9));
  cancelEvents.push(makeEvent(10, 'ModelRunCancelRequested', 'risk-owner-human', {
    identity,
    runId: 'risk-model-run-001',
    reason: '负责人显式取消示例运行。',
  }));
  cancelEvents.push(makeEvent(11, 'ModelRunCancelled', 'risk-owner-human', {
    identity,
    runId: 'risk-model-run-001',
  }));
  assert.equal(replayV2Events(cancelEvents).modelRuns[0].status, 'cancelled');

  const completedEvents = cloneEvents(source.slice(0, 9));
  completedEvents.push(makeEvent(10, 'ModelRunCompleted', 'risk-assistant-agent', {
    identity,
    runId: 'risk-model-run-001',
    usage: { tokens: 128 },
  }));
  const completed = replayV2Events(completedEvents);
  assert.equal(completed.modelRuns[0].status, 'completed');
  assert.notEqual(completed.work.status, 'completed');

  const failedEvents = cloneEvents(source.slice(0, 9));
  failedEvents.push(makeEvent(10, 'ModelRunFailed', 'risk-assistant-agent', {
    identity,
    runId: 'risk-model-run-001',
    reason: '示例模型适配器返回受控失败。',
  }));
  assert.equal(replayV2Events(failedEvents).modelRuns[0].status, 'failed');
});

test('非法事件、身份、终态转换、视图和场景包失败关闭', () => {
  const source = createV2SampleEvents('knowledge');
  const identity = identityOf(source);

  const unknownType = cloneEvents(source);
  unknownType[1] = { ...unknownType[1], type: 'NotAProjectionEvent' };
  assert.throws(() => replayV2Events(unknownType), /未知事件类型/);

  const duplicateCreate = cloneEvents(source);
  duplicateCreate.push(makeEvent(duplicateCreate.length + 1, 'WorkCreated', 'knowledge-owner-human', structuredClone(source[0].payload)));
  assert.throws(() => replayV2Events(duplicateCreate), /WorkCreated/);

  const gap = cloneEvents(source);
  gap[1] = { ...gap[1], sequence: 3 };
  assert.throws(() => replayV2Events(gap), /连续递增/);

  const mismatch = cloneEvents(source);
  mismatch[1].payload.identity.workId = 'another-work';
  assert.throws(() => replayV2Events(mismatch), /身份不一致/);

  const terminalTransition = cloneEvents(source);
  terminalTransition.push(makeEvent(terminalTransition.length + 1, 'ModelRunCompleted', 'knowledge-assistant-agent', {
    identity,
    runId: 'knowledge-model-run-001',
  }));
  assert.throws(() => replayV2Events(terminalTransition), /运行中状态/);

  assert.throws(() => replayV2Events([]), /非空数组/);
  assert.throws(() => getScenarioPack('catalog-only'), /未知场景包/);
  assert.throws(() => createSampleDefinition('catalog-only'), /未知场景包/);
  assert.throws(() => createV2SampleEvents('catalog-only'), /未知场景包/);
});
