import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { V2Error, planV2Command } from '../src/v2-commands.mjs';
import { V2EventStore } from '../src/v2-event-store.mjs';
import { createV2SampleEvents, replayV2Events } from '../src/v2-projection.mjs';
import { scenarioPacks } from '../src/v2-scenarios.mjs';

const scenarioIds = scenarioPacks.map((pack) => pack.id);
const sampleWorkspaceId = 'p1-v2-sample-workspace';
const testDataExisted = existsSync('.test-data');
mkdirSync('.test-data', { recursive: true });
const testRoot = mkdtempSync(join('.test-data', 'v2-event-store-'), {
  recursive: true,
});
let pathCounter = 0;
const dbPaths = new Set();
const stores = new Set();

after(() => {
  for (const store of stores) store.close();
  for (const dbPath of dbPaths) {
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(`${dbPath}${suffix}`, { force: true });
    }
  }
  rmSync(testRoot, { recursive: true, force: true });
  if (!testDataExisted) {
    rmSync('.test-data', { recursive: true, force: true });
  }
});

function identityFor(scenarioId) {
  return {
    workspaceId: sampleWorkspaceId,
    workId: `${scenarioId}-sample-work-v2`,
  };
}

function makeDbPath(t) {
  pathCounter += 1;
  const dbPath = join(testRoot, `event-store-${pathCounter}.sqlite`);
  dbPaths.add(dbPath);
  return dbPath;
}

function seededStore(t, dbPath, options = {}) {
  const store = new V2EventStore({ dbPath, ...options });
  store.seedScenarioSamples();
  stores.add(store);
  return store;
}

function commandEnvelope(type, payload, version, suffix = '') {
  return {
    commandId: `cmd-${type}-${version}${suffix}`,
    idempotencyKey: `idem-${type}-${version}${suffix}`,
    expectedProjectionVersion: version,
    type,
    payload,
  };
}

function assertV2Error(action, statusCode, code) {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof V2Error, `应抛出V2Error，实际为：${error?.constructor?.name}`);
    assert.equal(error.statusCode, statusCode);
    assert.equal(error.code, code);
    assert.doesNotMatch(error.message, /[A-Za-z]/, '错误消息必须为简体中文');
    assert.equal(typeof error.details, 'object');
    assert.notEqual(error.details, null);
    return error;
  }
  throw new Error(`应抛出错误：${code}`);
}

function countEvents(store, identity) {
  return store.getEvents(identity).length;
}

function countReceipts(dbPath, identity) {
  const raw = new DatabaseSync(dbPath);
  try {
    return raw.prepare(`
      SELECT COUNT(*) AS count FROM v2_command_receipts
      WHERE workspace_id = ? AND work_id = ?
    `).get(identity.workspaceId, identity.workId).count;
  } finally {
    raw.close();
  }
}

test('十个样例按冻结顺序持久化，重启后仍可重放出相同投影', () => {
  const dbPath = makeDbPath(test);
  let store = seededStore(test, dbPath);

  const firstSeed = store.seedScenarioSamples();
  assert.deepEqual(firstSeed, {
    seededCount: 0,
    alreadyPresentCount: 10,
    totalCount: 10,
  });

  const originalProjections = new Map(scenarioIds.map((scenarioId) => {
    const events = createV2SampleEvents(scenarioId);
    return [scenarioId, replayV2Events(structuredClone(events))];
  }));

  const works = store.listWorks();
  assert.deepEqual(
    works.map((work) => [work.identity.workId, work.dataOrigin, work.scenarioId]),
    scenarioIds.map((scenarioId) => [
      `${scenarioId}-sample-work-v2`,
      'sample',
      scenarioId,
    ]),
  );

  for (const scenarioId of scenarioIds) {
    const identity = identityFor(scenarioId);
    const projection = store.getProjection(identity);
    assert.deepEqual(projection, originalProjections.get(scenarioId));
    assert.equal(projection.projectionVersion, store.getEvents(identity).length);
  }

  store.close();
  store = new V2EventStore({ dbPath });
  stores.add(store);

  const secondSeed = store.seedScenarioSamples();
  assert.deepEqual(secondSeed, {
    seededCount: 0,
    alreadyPresentCount: 10,
    totalCount: 10,
  });
  assert.deepEqual(
    store.listWorks().map((work) => work.identity.workId),
    scenarioIds.map((scenarioId) => `${scenarioId}-sample-work-v2`),
  );
  for (const scenarioId of scenarioIds) {
    assert.deepEqual(
      store.replayProjection(identityFor(scenarioId)),
      originalProjections.get(scenarioId),
    );
  }
});

test('存储只有事件与幂等收据，投影只从事件重放且篡改失败关闭', () => {
  const dbPath = makeDbPath(test);
  const store = seededStore(test, dbPath);
  const identity = identityFor('risk');
  const events = store.getEvents(identity);
  const replayed = replayV2Events(structuredClone(events));
  assert.deepEqual(replayed, store.getProjection(identity));

  const missingIdentity = { workspaceId: sampleWorkspaceId, workId: 'not-created-work' };
  assertV2Error(() => store.getProjection(missingIdentity), 404, 'WORK_NOT_FOUND');
  assertV2Error(() => store.commitCommand({
    identity,
    actorId: 'risk-owner-human',
    command: {
      idempotencyKey: 'idem-validation-error',
      expectedProjectionVersion: 1,
      type: 'append_message',
      payload: {},
    },
  }), 400, 'VALIDATION_ERROR');

  const raw = new DatabaseSync(dbPath);
  const tables = raw.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row) => row.name);
  assert.deepEqual(tables, ['v2_command_receipts', 'v2_events']);
  assert.throws(
    () => raw.exec("UPDATE v2_events SET occurred_at = '2020-01-01T00:00:00.000Z'"),
    /append-only/,
  );
  raw.close();

  const identityDbPath = makeDbPath(test);
  let identityStore = seededStore(test, identityDbPath);
  identityStore.close();
  let tamperDb = new DatabaseSync(identityDbPath);
  tamperDb.exec('DROP TRIGGER v2_events_no_update');
  tamperDb.exec('PRAGMA ignore_check_constraints = ON');
  tamperDb.prepare(`
    UPDATE v2_events
    SET payload = json_set(payload, '$.identity.workId', 'tampered-work')
    WHERE sequence = 2
  `).run();
  tamperDb.exec('PRAGMA ignore_check_constraints = OFF');
  tamperDb.close();
  identityStore = new V2EventStore({ dbPath: identityDbPath });
  stores.add(identityStore);
  assertV2Error(
    () => identityStore.replayProjection(identityFor('risk')),
    500,
    'EVENT_STORE_INTEGRITY',
  );

  const sequenceDbPath = makeDbPath(test);
  let sequenceStore = seededStore(test, sequenceDbPath);
  sequenceStore.close();
  tamperDb = new DatabaseSync(sequenceDbPath);
  tamperDb.exec('DROP TRIGGER v2_events_no_update');
  tamperDb.prepare('UPDATE v2_events SET sequence = 999 WHERE sequence = 2').run();
  tamperDb.close();
  sequenceStore = new V2EventStore({ dbPath: sequenceDbPath });
  stores.add(sequenceStore);
  assertV2Error(
    () => sequenceStore.getProjection(identityFor('risk')),
    500,
    'EVENT_STORE_INTEGRITY',
  );
});

test('普通消息只追加一个非权威事件，且不产生任何模型运行事件', () => {
  const dbPath = makeDbPath(test);
  const store = seededStore(test, dbPath);
  const identity = identityFor('risk');
  const before = store.getProjection(identity);
  const beforeEvents = store.getEvents(identity);
  const command = commandEnvelope('append_message', {
    body: '负责人补充一条普通消息；该消息不触发智能体运行。',
  }, before.projectionVersion);

  const result = store.commitCommand({
    identity,
    actorId: 'risk-owner-human',
    command,
  });
  const afterEvents = store.getEvents(identity);
  const after = store.getProjection(identity);

  assert.equal(result.accepted, true);
  assert.equal(afterEvents.length, beforeEvents.length + 1);
  assert.equal(result.eventIds.length, 1);
  assert.equal(result.eventIds[0], afterEvents.at(-1).eventId);
  assert.equal(afterEvents.at(-1).type, 'MessageAppended');
  assert.equal(afterEvents.at(-1).actorId, 'risk-owner-human');
  assert.equal(afterEvents.at(-1).payload.body, command.payload.body);
  assert.equal(after.modelRuns.length, before.modelRuns.length);
  assert.equal(after.projectionVersion, before.projectionVersion + 1);
  assert.equal(after.activities.at(-1).authoritative, false);
  assert.deepEqual(result.projection, after);

  const repeatedSeed = store.seedScenarioSamples();
  assert.equal(repeatedSeed.alreadyPresentCount, 10);
  assert.equal(repeatedSeed.seededCount, 0);
  assert.equal(countEvents(store, identity), afterEvents.length);
});

test('命令幂等重放原结果，同键不同请求和版本冲突均为零写入', () => {
  const dbPath = makeDbPath(test);
  let store = seededStore(test, dbPath);
  const identity = identityFor('content');
  const projection = store.getProjection(identity);
  const request = {
    identity,
    actorId: 'content-owner-human',
    command: commandEnvelope('append_message', {
      body: '重复点击的普通消息必须被幂等收据折叠。',
    }, projection.projectionVersion),
  };

  const first = store.commitCommand(structuredClone(request));
  const eventCount = countEvents(store, identity);
  const replayed = store.commitCommand(structuredClone(request));
  assert.deepEqual(replayed, first);
  assert.equal(countEvents(store, identity), eventCount);

  store.close();
  store = new V2EventStore({ dbPath });
  stores.add(store);
  const replayedAfterReopen = store.commitCommand(structuredClone(request));
  assert.deepEqual(replayedAfterReopen, first);
  assert.equal(countEvents(store, identity), eventCount);

  const differentRequest = structuredClone(request);
  differentRequest.command = {
    ...differentRequest.command,
    commandId: 'cmd-idempotency-different',
  };
  assertV2Error(
    () => store.commitCommand(differentRequest),
    409,
    'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(countEvents(store, identity), eventCount);

  const staleRequest = structuredClone(request);
  staleRequest.command = {
    ...staleRequest.command,
    commandId: 'cmd-version-conflict',
    idempotencyKey: 'idem-version-conflict',
    expectedProjectionVersion: projection.projectionVersion + 99,
  };
  assertV2Error(
    () => store.commitCommand(staleRequest),
    409,
    'PROJECTION_VERSION_CONFLICT',
  );
  assert.equal(countEvents(store, identity), eventCount);
});

test('目标、证据、交接、暂停恢复和回退命令都通过事件重放生效', () => {
  const dbPath = makeDbPath(test);
  const store = seededStore(test, dbPath);
  const identity = identityFor('interaction');
  let projection = store.getProjection(identity);
  const historicalEvidence = structuredClone(projection.evidence[0]);

  let result = store.commitCommand({
    identity,
    actorId: 'interaction-gate-human',
    command: commandEnvelope('request_evidence', {
      evidenceId: 'interaction-evidence-goal-v1-001',
      subject: '旧目标版本证据',
      reason: '先在目标版本一请求证据，再验证目标变更后的失败关闭。',
      requestedFromActorId: 'interaction-state-system',
    }, projection.projectionVersion),
  });
  projection = result.projection;
  const afterGoalChangeBefore = (() => {
    const changeResult = store.commitCommand({
      identity,
      actorId: 'interaction-owner-human',
      command: commandEnvelope('change_goal', {
        goal: '目标先变更为版本二，旧证据请求不能再提供。',
        reason: '验证证据必须绑定当前目标版本。',
      }, projection.projectionVersion),
    });
    projection = changeResult.projection;
    return {
      events: countEvents(store, identity),
      receipts: countReceipts(dbPath, identity),
    };
  })();

  assert.deepEqual(projection.evidence[0], historicalEvidence);
  const staleEvidenceError = assertV2Error(() => store.commitCommand({
    identity,
    actorId: 'interaction-state-system',
    command: commandEnvelope('provide_evidence', {
      evidenceId: 'interaction-evidence-goal-v1-001',
      version: 'interaction-evidence-goal-v1-version',
      summary: '旧目标版本的证据不能继续提供。',
    }, projection.projectionVersion, '-stale-goal'),
  }), 400, 'VALIDATION_ERROR');
  assert.match(staleEvidenceError.message, /证据请求属于旧目标版本/);
  assert.deepEqual(staleEvidenceError.details, {
    evidenceId: 'interaction-evidence-goal-v1-001',
    evidenceGoalVersion: 1,
    currentGoalVersion: 2,
  });
  assert.equal(countEvents(store, identity), afterGoalChangeBefore.events);
  assert.equal(countReceipts(dbPath, identity), afterGoalChangeBefore.receipts);

  assertV2Error(() => store.commitCommand({
    identity,
    actorId: 'interaction-gate-human',
    command: commandEnvelope('change_goal', {
      goal: '关口人不能直接变更负责人目标。',
      reason: '越权命令必须失败关闭。',
    }, projection.projectionVersion, '-denied'),
  }), 403, 'AUTHORITY_DENIED');
  assert.equal(countEvents(store, identity), afterGoalChangeBefore.events);
  assert.equal(countReceipts(dbPath, identity), afterGoalChangeBefore.receipts);

  result = store.commitCommand({
    identity,
    actorId: 'interaction-owner-human',
    command: commandEnvelope('change_goal', {
      goal: '目标变更为：先补齐证据，再重新进行人工复核。',
      reason: '负责人确认目标需要漂移。',
    }, projection.projectionVersion),
  });
  projection = result.projection;
  assert.equal(projection.work.goalVersion, 3);
  assert.equal(store.getEvents(identity).at(-1).type, 'GoalChanged');

  result = store.commitCommand({
    identity,
    actorId: 'interaction-gate-human',
    command: commandEnvelope('request_evidence', {
      evidenceId: 'interaction-evidence-command-001',
      subject: '用户确认边界',
      reason: '缺少用户确认，不能继续交接执行。',
      requestedFromActorId: 'interaction-state-system',
    }, projection.projectionVersion),
  });
  projection = result.projection;
  assert.equal(projection.work.status, 'awaiting_evidence');
  assert.equal(store.getEvents(identity).at(-1).type, 'EvidenceRequested');

  result = store.commitCommand({
    identity,
    actorId: 'interaction-state-system',
    command: commandEnvelope('provide_evidence', {
      evidenceId: 'interaction-evidence-command-001',
      version: 'interaction-evidence-command-v1',
      summary: '系统回传了用户确认边界的证据。',
    }, projection.projectionVersion),
  });
  projection = result.projection;
  assert.equal(store.getEvents(identity).at(-1).type, 'EvidenceProvided');

  result = store.commitCommand({
    identity,
    actorId: 'interaction-owner-human',
    command: commandEnvelope('propose_handoff', {
      handoffId: 'interaction-handoff-command-001',
      recipientActorId: 'interaction-gate-human',
      context: '人工复核后由关口人继续负责核验。',
    }, projection.projectionVersion),
  });
  projection = result.projection;
  result = store.commitCommand({
    identity,
    actorId: 'interaction-gate-human',
    command: commandEnvelope('accept_handoff', {
      handoffId: 'interaction-handoff-command-001',
    }, projection.projectionVersion),
  });
  projection = result.projection;
  assert.equal(projection.work.ownerActorId, 'interaction-gate-human');

  result = store.commitCommand({
    identity,
    actorId: 'interaction-gate-human',
    command: commandEnvelope('pause_work', {}, projection.projectionVersion),
  });
  projection = result.projection;
  assert.equal(projection.work.status, 'paused');
  result = store.commitCommand({
    identity,
    actorId: 'interaction-gate-human',
    command: commandEnvelope('resume_work', {}, projection.projectionVersion),
  });
  projection = result.projection;
  assert.notEqual(projection.work.status, 'paused');

  result = store.commitCommand({
    identity,
    actorId: 'interaction-gate-human',
    command: commandEnvelope('rollback_work', {
      toStageId: 'interaction-stage-1',
      reason: '目标变更后需要回到初始阶段重新确认边界。',
    }, projection.projectionVersion),
  });
  assert.equal(result.projection.work.lastRollback.toStageId, 'interaction-stage-1');
  assert.deepEqual(store.getProjection(identity), result.projection);
});

test('关口、动作与回执命令可重放；未知回执重试和非法状态零写入', () => {
  const dbPath = makeDbPath(test);
  const store = seededStore(test, dbPath);
  const identity = identityFor('risk');
  const projection = store.getProjection(identity);
  const before = countEvents(store, identity);

  assertV2Error(() => store.commitCommand({
    identity,
    actorId: 'risk-state-system',
    command: commandEnvelope('record_receipt', {
      receiptId: 'risk-receipt-retry-001',
      actionIntentId: 'risk-action-001',
      status: 'succeeded',
      summary: '不能把未知回执直接改写为成功。',
    }, projection.projectionVersion, '-unknown-retry'),
  }), 409, 'INVALID_TRANSITION');
  assertV2Error(() => store.commitCommand({
    identity,
    actorId: 'risk-owner-human',
    command: commandEnvelope('request_action', {
      actionIntentId: 'risk-action-retry-001',
      actionLabel: '重复请求资金处置',
      targetActorId: 'risk-state-system',
      gateId: 'risk-gate-001',
    }, projection.projectionVersion, '-unknown-retry'),
  }), 409, 'INVALID_TRANSITION');
  assertV2Error(() => store.commitCommand({
    identity,
    actorId: 'risk-owner-human',
    command: commandEnvelope('resume_work', {}, projection.projectionVersion, '-illegal'),
  }), 409, 'INVALID_TRANSITION');
  assert.equal(countEvents(store, identity), before);

  let result = store.commitCommand({
    identity,
    actorId: 'risk-gate-human',
    command: commandEnvelope('decide_gate', {
      gateId: 'risk-gate-command-001',
      decision: 'approved',
      basis: '关口人复核了当前证据和候选限制。',
      impact: '仅授权一个新的外部动作意图。',
    }, projection.projectionVersion),
  });
  assert.equal(store.getEvents(identity).at(-1).type, 'GateDecided');

  result = store.commitCommand({
    identity,
    actorId: 'risk-owner-human',
    command: commandEnvelope('request_action', {
      actionIntentId: 'risk-action-command-001',
      actionLabel: '生成资金处置核验动作意图',
      targetActorId: 'risk-state-system',
      gateId: 'risk-gate-command-001',
    }, result.projection.projectionVersion),
  });
  assert.equal(result.projection.work.status, 'awaiting_receipt');
  assert.equal(store.getEvents(identity).at(-1).type, 'ActionIntentRequested');

  result = store.commitCommand({
    identity,
    actorId: 'risk-state-system',
    command: commandEnvelope('record_receipt', {
      receiptId: 'risk-receipt-command-001',
      actionIntentId: 'risk-action-command-001',
      status: 'succeeded',
      summary: '外部系统返回了可核验的成功回执。',
    }, result.projection.projectionVersion),
  });
  assert.equal(result.projection.work.status, 'completed');
  assert.equal(store.getEvents(identity).at(-1).type, 'ReceiptRecorded');
  assert.deepEqual(store.getProjection(identity), result.projection);
});

test('显式请求模型运行在本分区失败关闭且零写入', () => {
  const dbPath = makeDbPath(test);
  const store = seededStore(test, dbPath);
  const identity = identityFor('knowledge');
  const projection = store.getProjection(identity);
  const before = countEvents(store, identity);
  const actorId = 'knowledge-owner-human';
  const command = commandEnvelope('request_model_run', {
    task: '请求智能体复核当前证据。',
  }, projection.projectionVersion);

  assertV2Error(
    () => planV2Command(projection, actorId, command),
    409,
    'MODEL_RUNTIME_REQUIRED',
  );
  assertV2Error(
    () => store.commitCommand({ identity, actorId, command }),
    409,
    'MODEL_RUNTIME_REQUIRED',
  );
  assert.equal(countEvents(store, identity), before);
  assert.equal(store.getProjection(identity).modelRuns.length, 1);
});

test('内部模型事件入口可用且幂等；追加失败时不留下部分事件', () => {
  const successDbPath = makeDbPath(test);
  const store = seededStore(test, successDbPath, {
    clock: () => '2026-02-01T00:00:00.000Z',
    eventIdFactory: (() => {
      let value = 0;
      return () => `internal-model-event-${value += 1}`;
    })(),
  });
  const identity = identityFor('growth');
  let projection = store.getProjection(identity);
  const historicalEvidence = structuredClone(projection.evidence[0]);

  let result = store.commitCommand({
    identity,
    actorId: 'growth-owner-human',
    command: commandEnvelope('change_goal', {
      goal: '目标变更为：新目标版本必须重新请求并提供证据。',
      reason: '旧目标版本证据不能作为新模型运行输入。',
    }, projection.projectionVersion),
  });
  projection = result.projection;
  assert.deepEqual(projection.evidence[0], historicalEvidence);

  result = store.commitCommand({
    identity,
    actorId: 'growth-owner-human',
    command: commandEnvelope('request_evidence', {
      evidenceId: 'growth-evidence-goal-v2-001',
      subject: '新目标版本证据',
      reason: '新目标版本必须重新取得证据。',
      requestedFromActorId: 'growth-state-system',
    }, projection.projectionVersion),
  });
  projection = result.projection;
  result = store.commitCommand({
    identity,
    actorId: 'growth-state-system',
    command: commandEnvelope('provide_evidence', {
      evidenceId: 'growth-evidence-goal-v2-001',
      version: 'growth-evidence-goal-v2-version',
      summary: '新目标版本的证据已经重新提供。',
    }, projection.projectionVersion),
  });
  projection = result.projection;
  assert.equal(projection.evidence.at(-1).goalVersion, 2);
  assert.equal(projection.evidence.at(-1).status, 'provided');

  const staleBefore = {
    events: countEvents(store, identity),
    receipts: countReceipts(successDbPath, identity),
  };
  const staleRunId = 'growth-model-run-stale-evidence-001';
  const staleRequest = {
    identity,
    actorId: 'growth-owner-human',
    command: commandEnvelope(
      'append_model_run_events',
      {},
      projection.projectionVersion,
      '-stale-evidence',
    ),
    plannedEvents: [
      {
        type: 'ModelRunRequested',
        actorId: 'growth-owner-human',
        payload: {
          runId: staleRunId,
          agentActorId: 'growth-assistant-agent',
          task: '引用旧目标版本证据的请求必须失败关闭。',
          goalVersion: projection.work.goalVersion,
          projectionVersion: projection.projectionVersion + 1,
          inputEvidenceIds: ['growth-evidence-001'],
          idempotencyIdentity: 'growth-model-run-stale-evidence-once',
        },
      },
    ],
  };
  const staleRunError = assertV2Error(
    () => store.commitPlannedEvents(staleRequest),
    400,
    'VALIDATION_ERROR',
  );
  assert.match(staleRunError.message, /模型输入证据必须属于当前目标版本/);
  assert.deepEqual(staleRunError.details, {
    evidenceId: 'growth-evidence-001',
    evidenceGoalVersion: 1,
    currentGoalVersion: 2,
  });
  assert.equal(countEvents(store, identity), staleBefore.events);
  assert.equal(countReceipts(successDbPath, identity), staleBefore.receipts);
  assert.equal(
    projection.modelRuns.some((run) => run.id === staleRunId),
    false,
  );

  const internalRequest = {
    identity,
    actorId: 'growth-owner-human',
    command: {
      commandId: 'cmd-internal-model-run',
      idempotencyKey: 'idem-internal-model-run',
      expectedProjectionVersion: projection.projectionVersion,
      type: 'append_model_run_events',
      payload: {},
    },
    plannedEvents: [
      {
        type: 'ModelRunRequested',
        actorId: 'growth-owner-human',
        payload: {
          runId: 'growth-model-run-command-001',
          agentActorId: 'growth-assistant-agent',
          task: '运行时分区完成策略校验后的受控请求。',
          goalVersion: projection.work.goalVersion,
          projectionVersion: projection.projectionVersion + 1,
          inputEvidenceIds: ['growth-evidence-goal-v2-001'],
          idempotencyIdentity: 'growth-model-run-command-once',
        },
      },
      {
        type: 'ModelRunStarted',
        actorId: 'growth-assistant-agent',
        payload: {
          runId: 'growth-model-run-command-001',
          modelVersion: 'runtime-controlled',
        },
      },
    ],
  };

  const invalidBefore = countEvents(store, identity);
  const invalidRequest = structuredClone(internalRequest);
  invalidRequest.command.commandId = 'cmd-internal-model-run-invalid-version';
  invalidRequest.command.idempotencyKey = 'idem-internal-model-run-invalid-version';
  invalidRequest.plannedEvents[0].payload.projectionVersion = projection.projectionVersion;
  const validationError = assertV2Error(
    () => store.commitPlannedEvents(invalidRequest),
    400,
    'VALIDATION_ERROR',
  );
  assert.deepEqual(validationError.details, {
    field: 'plannedEvents[0].payload.projectionVersion',
    eventIndex: 0,
    eventType: 'ModelRunRequested',
    expectedProjectionVersion: projection.projectionVersion + 1,
    actualProjectionVersion: projection.projectionVersion,
  });
  assert.equal(countEvents(store, identity), invalidBefore);
  const invalidRaw = new DatabaseSync(successDbPath);
  const invalidReceiptCount = invalidRaw.prepare(`
    SELECT COUNT(*) AS count FROM v2_command_receipts
    WHERE workspace_id = ? AND work_id = ? AND idempotency_key = ?
  `).get(sampleWorkspaceId, identity.workId, invalidRequest.command.idempotencyKey).count;
  invalidRaw.close();
  assert.equal(invalidReceiptCount, 0);

  const first = store.commitPlannedEvents(structuredClone(internalRequest));
  const eventCount = countEvents(store, identity);
  assert.equal(eventCount, invalidBefore + 2);
  assert.equal(first.eventIds.length, 2);
  assert.equal(first.projection.modelRuns.at(-1).status, 'running');
  const requestedEvent = store.getEvents(identity).at(-2);
  assert.equal(requestedEvent.payload.projectionVersion, requestedEvent.sequence);
  assert.deepEqual(
    store.getEvents(identity).slice(-2).map((event) => event.type),
    ['ModelRunRequested', 'ModelRunStarted'],
  );
  const replayed = store.commitPlannedEvents(structuredClone(internalRequest));
  assert.deepEqual(replayed, first);
  assert.equal(countEvents(store, identity), eventCount);

  const atomicDbPath = makeDbPath(test);
  let callCount = 0;
  const atomicStore = seededStore(test, atomicDbPath, {
    clock: () => '2026-02-01T00:01:00.000Z',
    eventIdFactory: () => {
      callCount += 1;
      return callCount === 1 ? 'atomic-first-event' : 'growth-event-001';
    },
  });
  const atomicIdentity = identityFor('dev');
  const atomicProjection = atomicStore.getProjection(atomicIdentity);
  const atomicBefore = countEvents(atomicStore, atomicIdentity);
  const failingRequest = {
    identity: atomicIdentity,
    actorId: 'dev-owner-human',
    command: {
      commandId: 'cmd-atomic-failure',
      idempotencyKey: 'idem-atomic-failure',
      expectedProjectionVersion: atomicProjection.projectionVersion,
      type: 'append_model_run_events',
      payload: {},
    },
    plannedEvents: [
      {
        type: 'ModelRunRequested',
        actorId: 'dev-owner-human',
        payload: {
          runId: 'dev-model-run-atomic-001',
          agentActorId: 'dev-assistant-agent',
          task: '第二事件插入失败以验证事务回滚。',
          goalVersion: atomicProjection.work.goalVersion,
          projectionVersion: atomicProjection.projectionVersion + 1,
          inputEvidenceIds: [],
          idempotencyIdentity: 'dev-model-run-atomic-once',
        },
      },
      {
        type: 'ModelRunStarted',
        actorId: 'dev-assistant-agent',
        payload: {
          runId: 'dev-model-run-atomic-001',
          modelVersion: 'runtime-controlled',
        },
      },
    ],
  };

  assertV2Error(
    () => atomicStore.commitPlannedEvents(failingRequest),
    503,
    'EVENT_STORE_UNAVAILABLE',
  );
  assert.equal(countEvents(atomicStore, atomicIdentity), atomicBefore);
  assert.equal(
    atomicStore.getProjection(atomicIdentity).modelRuns.some((run) => run.id === 'dev-model-run-atomic-001'),
    false,
  );

  const raw = new DatabaseSync(atomicDbPath);
  const partialCount = raw.prepare(`
    SELECT COUNT(*) AS count FROM v2_events
    WHERE workspace_id = ? AND work_id = ? AND event_id = 'atomic-first-event'
  `).get(sampleWorkspaceId, atomicIdentity.workId).count;
  const receiptCount = raw.prepare(`
    SELECT COUNT(*) AS count FROM v2_command_receipts
    WHERE workspace_id = ? AND work_id = ? AND idempotency_key = 'idem-atomic-failure'
  `).get(sampleWorkspaceId, atomicIdentity.workId).count;
  raw.close();
  assert.equal(partialCount, 0);
  assert.equal(receiptCount, 0);
});
