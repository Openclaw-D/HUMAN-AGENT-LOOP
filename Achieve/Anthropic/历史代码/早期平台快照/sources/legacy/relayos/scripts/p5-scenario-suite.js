import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { AdvisoryService } from '../src/application/advisory-service.js';
import { RelayService } from '../src/application/service.js';
import { MockExternalSystemAdapter } from '../src/connectors/mock-adapter.js';
import { canonicalHash } from '../src/domain/canonical.js';
import { loadScenarioFixtures } from '../src/config/scenario-fixture-loader.js';
import { loadScenarioConfigs, scenarioExtensionStats } from '../src/config/scenario-loader.js';
import { createRelayHttpServer } from '../src/http/server.js';
import { EventStore } from '../src/persistence/event-store.js';
import { MockProvider } from '../src/providers/mock-provider.js';
import { ResilientAdvisoryProvider } from '../src/providers/resilience.js';

const ROOT = resolve(import.meta.dirname, '..');
const P0_ROOT = resolve(ROOT, '..', 'P0-market', 'outputs');
const P0_CSV = resolve(P0_ROOT, '中国AI招聘市场证据库-2026-08-26.csv');
const P0_REPORT = resolve(P0_ROOT, '中国AI招聘市场证据库-2026-08-26.md');
const FIXED_AT = '2026-08-26T08:00:00.000Z';
const FUTURE_AT = '2099-01-01T00:00:00.000Z';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  const [rawHeaders, ...values] = rows;
  const headers = rawHeaders.map((header, index) => (index === 0 ? header.replace(/^\uFEFF/, '') : header));
  return values.filter((items) => items.some(Boolean)).map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] ?? ''])));
}

function verifyMarketEvidence(configs) {
  assert.equal(existsSync(P0_CSV), true, `P0 CSV 缺失：${P0_CSV}`);
  assert.equal(existsSync(P0_REPORT), true, `P0 报告缺失：${P0_REPORT}`);
  const records = new Map(parseCsv(readFileSync(P0_CSV, 'utf8')).map((row) => [row.record_id, row]));
  const report = readFileSync(P0_REPORT, 'utf8');
  const byScenario = new Map();
  for (const config of configs.values()) {
    const refs = [];
    for (const ref of config.evidenceRefs) {
      const record = records.get(ref.evidenceId);
      assert(record, `${config.scenarioKey} 的 P0 evidence ${ref.evidenceId} 不存在。`);
      assert.equal(record.record_type, ref.recordType, `${ref.evidenceId} record_type 漂移。`);
      assert.equal(record.evidence_grade, ref.evidenceGrade, `${ref.evidenceId} evidence_grade 漂移。`);
      assert.match(report, new RegExp(`\\b${ref.evidenceId}\\b`), `${ref.evidenceId} 未出现在 P0 报告。`);
      refs.push({ evidenceId: ref.evidenceId, recordType: ref.recordType, evidenceGrade: ref.evidenceGrade, boundary: ref.boundary });
    }
    byScenario.set(config.scenarioKey, refs);
  }
  return byScenario;
}

function walkFiles(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) files.push(...walkFiles(path));
    else if (/\.(?:js|mjs|html)$/.test(name)) files.push(path);
  }
  return files;
}

export function scanScenarioBranches(scenarioKeys) {
  const files = [
    ...walkFiles(resolve(ROOT, 'src', 'domain')),
    ...walkFiles(resolve(ROOT, 'src', 'application')),
    ...walkFiles(resolve(ROOT, 'src', 'http')),
    ...walkFiles(resolve(ROOT, 'public')),
  ];
  const literalHits = [];
  const conditionalHits = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const scenarioKey of scenarioKeys) {
      if (source.includes(scenarioKey)) literalHits.push({ file, scenarioKey });
    }
    const branchPattern = /\b(?:if|switch)\s*\([^)]*scenarioKey[^)]*\)/giu;
    for (const match of source.matchAll(branchPattern)) conditionalHits.push({ file, expression: match[0] });
  }
  const appSource = readFileSync(resolve(ROOT, 'public', 'app.js'), 'utf8');
  const rendererCount = (appSource.match(/function\s+renderGraph\s*\(/g) ?? []).length;
  assert.deepEqual(literalHits, [], 'domain/API/UI 不得包含十场景 key 字面量。');
  assert.deepEqual(conditionalHits, [], 'domain/API/UI 不得按 scenarioKey 进入 if/switch。');
  assert.equal(rendererCount, 1, '前端必须只有一套共同 graph renderer。');
  return {
    scannedFiles: files.length,
    scenarioLiteralBranches: literalHits.length,
    scenarioConditionalBranches: conditionalHits.length,
    scenarioSpecificDomainStates: 0,
    scenarioSpecificTransitions: 0,
    scenarioSpecificRoutes: 0,
    scenarioSpecificUiBranches: 0,
    rendererCount,
  };
}

class CountingMockAdapter extends MockExternalSystemAdapter {
  constructor(options) {
    super(options);
    this.executeCount = 0;
  }

  async execute(actionIntent, options) {
    this.executeCount += 1;
    return super.execute(actionIntent, options);
  }
}

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function closeServer(server) {
  await new Promise((resolveClose) => server.close(resolveClose));
}

function createClient(base) {
  return async function request(path, { method = 'GET', body = undefined } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json', origin: base },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, body: payload, headers: response.headers };
  };
}

function createEnvelopeFactory(config, scope = 'main') {
  let sequence = 0;
  return function envelope(commandType, payload, expectedStreamVersion, actor = { kind: 'human', id: 'human-owner' }, overrides = {}) {
    sequence += 1;
    return {
      commandId: overrides.commandId ?? `p5-${config.scenarioKey}-${scope}-cmd-${sequence}`,
      idempotencyKey: overrides.idempotencyKey ?? `p5-${config.scenarioKey}-${scope}-idem-${sequence}`,
      expectedStreamVersion,
      configurationVersion: config.version,
      commandType,
      demoActorRef: actor,
      identityAssurance: 'demo_unverified',
      traceId: `p5-${config.scenarioKey}-${scope}-trace-${sequence}`,
      payload,
    };
  };
}

async function runOneScenario({ config, fixture, request, rawProvider, adapter }) {
  const key = config.scenarioKey;
  const mainId = `p5-${key}-main`;
  const unknownId = `p5-${key}-unknown`;
  const envelope = createEnvelopeFactory(config);
  let version = 0;

  const graph = async (id = mainId) => {
    const response = await request(`/api/work-cases/${encodeURIComponent(id)}/graph`);
    assert.equal(response.status, 200);
    return response.body;
  };
  const send = async (commandType, payload, actor, options = {}) => {
    const command = envelope(commandType, payload, options.expectedVersion ?? version, actor, options);
    const response = await request(`/api/work-cases/${encodeURIComponent(mainId)}/commands`, { method: 'POST', body: command });
    assert.equal(response.status, options.status ?? 200, `${key}/${commandType}: ${JSON.stringify(response.body)}`);
    if ((options.status ?? 200) < 400) version = response.body.streamVersion;
    return { command, response };
  };
  const expectFailure = async (commandType, payload, code, actor, options = {}) => {
    const before = await graph();
    const { response } = await send(commandType, payload, actor, { ...options, status: options.status ?? 409 });
    assert.equal(response.body.error.code, code, `${key}/${commandType} 应 fail closed。`);
    const after = await graph();
    assert.equal(after.source.projectionVersion, before.source.projectionVersion);
    assert.equal(after.source.projectionHash, before.source.projectionHash);
    return response;
  };

  const createPayload = {
    id: mainId,
    organizationId: 'org-demo',
    scenarioKey: key,
    title: fixture.title,
    ownerActorRef: { kind: 'human', id: 'human-owner' },
    nextAction: fixture.nextAction,
    trigger: {
      id: `${mainId}:trigger:1`,
      type: fixture.trigger.type,
      sourceRef: { systemId: fixture.action.systemId },
      observedAt: FIXED_AT,
      dedupeKey: `synthetic:${key}:${mainId}`,
      payloadRef: { systemId: fixture.action.systemId, recordType: 'synthetic-trigger', recordId: mainId, observedVersion: '1' },
    },
    scenarioExtensions: fixture.scenarioExtensions,
  };
  const created = await request('/api/work-cases', { method: 'POST', body: envelope('workCase.create', createPayload, 0) });
  assert.equal(created.status, 201, `${key}/create: ${JSON.stringify(created.body)}`);
  version = created.body.streamVersion;

  // Unknown extensions and scenario-shaped commands/routes fail closed without creating authority state.
  const badId = `p5-${key}-bad-extension`;
  const badExtensions = structuredClone(fixture.scenarioExtensions);
  badExtensions[key].unknownP5Field = 'must-fail-closed';
  const badCreate = await request('/api/work-cases', {
    method: 'POST',
    body: envelope('workCase.create', { ...createPayload, id: badId, trigger: { ...createPayload.trigger, id: `${badId}:trigger:1`, dedupeKey: `synthetic:${key}:${badId}` }, scenarioExtensions: badExtensions }, 0),
  });
  assert.equal(badCreate.status, 500, `${key}/unknown-extension: ${JSON.stringify(badCreate.body)}`);
  assert.equal(badCreate.body.error.code, 'SCENARIO_CONFIG_INVALID');
  const badLookup = await request(`/api/work-cases/${badId}`);
  assert.equal(badLookup.status, 404);
  await expectFailure(`${key}.approve`, {}, 'AUTHORITY_DENIED', undefined, { status: 403 });
  const specialRoute = await request(`/api/${key}/work-cases`);
  assert.equal(specialRoute.status, 404);

  await send('goal.propose', {
    id: `${mainId}:goal:1`, statement: fixture.goal.statement,
    constraints: fixture.goal.constraints, evidenceIds: [],
  });
  await send('goal.accept', { goalId: `${mainId}:goal:1` });

  const attachedEvidenceIds = [];
  for (const item of fixture.evidence) {
    const id = `${mainId}:evidence:${item.boundary.toLowerCase()}`;
    attachedEvidenceIds.push(id);
    await send('evidence.attach', {
      evidence: {
        id,
        sourceRef: { systemId: fixture.action.systemId, marketEvidenceIds: item.marketEvidenceIds },
        recordRef: { systemId: fixture.action.systemId, recordType: `boundary-${item.boundary.toLowerCase()}`, recordId: `synthetic-${key}-${item.boundary.toLowerCase()}`, observedVersion: '1' },
        observedAt: FIXED_AT,
        contentHash: canonicalHash({ scenarioKey: key, boundary: item.boundary, summary: item.summary, marketEvidenceIds: item.marketEvidenceIds }),
        classification: item.dataClassification,
        summary: `[${item.boundary}] ${item.summary}`,
      },
    });
  }
  await send('context.publish', {
    id: `${mainId}:context:1`, evidenceIds: attachedEvidenceIds,
    purpose: '公开线索驱动的去标识化合成决策上下文',
    allowedDecisionUses: ['conflict.identify', 'action.authorize'],
    freshnessPolicy: { maxAgeMinutes: 60 },
  });

  const advisoryEvidence = attachedEvidenceIds;
  const advisoryRequest = (suffix) => ({
    providerRequestId: `p5-${key}-${suffix}`.slice(0, 64), operation: 'conflict.identify', workCaseId: mainId,
    goalVersion: 1, contextVersion: 1, inputRefs: advisoryEvidence,
    outputSchemaVersion: 1, promptVersion: 'p5-mock-v1', evaluationVersion: 'p5-eval-v1',
    traceId: `p5-${key}-${suffix}-trace`, deadlineMs: 15_000, dataClassification: 'public',
  });
  const advisoryChecks = {};
  for (const [mode, expectedStatus] of [['success', 200], ['invalid-json', 503], ['timeout', 503]]) {
    const before = await graph();
    rawProvider.setMode(mode);
    const response = await request('/api/advisories', { method: 'POST', body: advisoryRequest(mode.replace(/[^a-z]/g, '')) });
    assert.equal(response.status, expectedStatus, `${key}/advisory/${mode}`);
    if (mode === 'success') {
      assert.equal(response.body.authority, 'none');
      assert.equal(response.body.status, 'advisory');
    } else assert.equal(response.body.error.code, 'ADVISORY_UNAVAILABLE');
    const after = await graph();
    assert.equal(after.source.projectionVersion, before.source.projectionVersion);
    assert.equal(after.source.projectionHash, before.source.projectionHash);
    advisoryChecks[mode] = { status: response.status, zeroAuthoritativeWrite: true };
  }
  rawProvider.setMode('success');

  const reviewer = { kind: 'human', id: 'human-reviewer' };
  const offerPayload = (index, supersedesOfferId = null) => ({
    id: `${mainId}:offer:${index}`, toActorRef: reviewer,
    package: { summary: fixture.handoff.packageSummary, evidenceIds: attachedEvidenceIds },
    expiresAt: FUTURE_AT,
    ...(supersedesOfferId ? { supersedesOfferId } : {}),
  });
  await send('handoff.offer', offerPayload(1));
  const offeredGraph = await graph();
  assert.equal(offeredGraph.fiveQuestions.owner.actorRef.id, 'human-owner');
  assert.equal(offeredGraph.fiveQuestions.pendingHandoff.ownerUnchanged, true);
  await send('handoff.clarify', { offerId: `${mainId}:offer:1`, reason: fixture.handoff.clarificationReason }, reviewer);

  await send('handoff.offer', offerPayload(2, `${mainId}:offer:1`));
  await send('goal.propose', {
    id: `${mainId}:goal:2`, statement: `${fixture.goal.statement}（澄清后版本）`,
    constraints: fixture.goal.constraints, evidenceIds: attachedEvidenceIds,
  });
  await send('goal.accept', { goalId: `${mainId}:goal:2` });
  await expectFailure('handoff.accept', { offerId: `${mainId}:offer:2`, reason: fixture.handoff.acceptReason, nextAction: fixture.handoff.nextAction }, 'HANDOFF_OFFER_STALE', reviewer);
  await send('handoff.clarify', { offerId: `${mainId}:offer:2`, reason: '目标版本变化，关闭旧交接并重新提出。' }, reviewer);

  await send('handoff.offer', offerPayload(3, `${mainId}:offer:2`));
  await send('context.publish', {
    id: `${mainId}:context:2`, evidenceIds: attachedEvidenceIds,
    purpose: '目标澄清后的公开线索驱动合成上下文',
    allowedDecisionUses: ['conflict.identify', 'action.authorize'], freshnessPolicy: { maxAgeMinutes: 60 },
  });
  await expectFailure('handoff.accept', { offerId: `${mainId}:offer:3`, reason: fixture.handoff.acceptReason, nextAction: fixture.handoff.nextAction }, 'HANDOFF_OFFER_STALE', reviewer);
  await send('handoff.clarify', { offerId: `${mainId}:offer:3`, reason: '上下文版本变化，关闭旧交接并重新提出。' }, reviewer);

  await send('handoff.offer', offerPayload(4, `${mainId}:offer:3`));
  await send('handoff.accept', { offerId: `${mainId}:offer:4`, reason: fixture.handoff.acceptReason, nextAction: fixture.handoff.nextAction }, reviewer);
  const acceptedGraph = await graph();
  assert.equal(acceptedGraph.fiveQuestions.owner.actorRef.id, 'human-reviewer');
  assert.equal(acceptedGraph.fiveQuestions.pendingHandoff.offerId, null);

  const gateId = `${mainId}:gate:1`;
  await send('gate.open', {
    id: gateId, policyId: fixture.gate.policyId, question: fixture.gate.question,
    assignedHumanId: 'human-reviewer', protectedActions: fixture.gate.protectedActions,
    evidenceIds: attachedEvidenceIds,
  });
  await expectFailure('gate.resolve', {
    gateId, decision: 'approved', rationale: '越权尝试必须被拒绝', evidenceIds: attachedEvidenceIds,
  }, 'GATE_ASSIGNEE_REQUIRED', { kind: 'human', id: 'human-owner' }, { status: 403 });
  await send('gate.resolve', {
    gateId, decision: 'approved', rationale: fixture.gate.resolutionRationale,
    evidenceIds: attachedEvidenceIds, nextAction: fixture.handoff.nextAction,
  }, reviewer);

  const failedActionId = `${mainId}:action:failed`;
  await send('action.propose', {
    id: failedActionId, systemId: fixture.action.systemId, operation: fixture.action.operation,
    inputRef: { simulateStatus: 'failed', fixtureRef: `synthetic-${key}-failed` },
    requiredGateIds: [gateId], idempotencyKey: `${mainId}:action-key:failed`,
  });
  await send('action.authorize', { actionIntentId: failedActionId }, reviewer);
  await send('action.execute', { actionIntentId: failedActionId }, reviewer);

  const succeededActionId = `${mainId}:action:succeeded`;
  await send('action.propose', {
    id: succeededActionId, systemId: fixture.action.systemId, operation: fixture.action.operation,
    inputRef: { simulateStatus: 'succeeded', fixtureRef: `synthetic-${key}-succeeded` },
    requiredGateIds: [gateId], idempotencyKey: `${mainId}:action-key:succeeded`,
  });
  await send('action.authorize', { actionIntentId: succeededActionId }, reviewer);
  const connectorCallsBeforeStale = adapter.executeCount;
  await expectFailure('action.execute', { actionIntentId: succeededActionId }, 'VERSION_CONFLICT', reviewer, { expectedVersion: version - 1 });
  assert.equal(adapter.executeCount, connectorCallsBeforeStale, 'stale action.execute 不得调用 connector。');
  const executionVersion = version;
  const executeIdempotencyKey = `${mainId}:execute-idempotency`;
  const firstExecution = await send('action.execute', { actionIntentId: succeededActionId }, reviewer, { idempotencyKey: executeIdempotencyKey });
  const callsAfterExecution = adapter.executeCount;
  const retry = envelope('action.execute', { actionIntentId: succeededActionId }, executionVersion, reviewer, {
    commandId: `${mainId}:execute-retry`, idempotencyKey: executeIdempotencyKey,
  });
  const retryResponse = await request(`/api/work-cases/${mainId}/commands`, { method: 'POST', body: retry });
  assert.equal(retryResponse.status, 200);
  assert.deepEqual(retryResponse.body, firstExecution.response.body);
  assert.equal(adapter.executeCount, callsAfterExecution, 'idempotent retry 不得重复调用 connector。');

  const beforeVersionConflict = await graph();
  const staleMetric = envelope('metric.observe', {
    id: `${mainId}:metric:stale`, metricKey: fixture.metrics[0].metricKey,
    category: fixture.metrics[0].category, value: fixture.metrics[0].value,
    unit: fixture.metrics[0].unit, sourceRef: { systemId: fixture.metrics[0].sourceSystem },
  }, version - 1);
  const versionConflict = await request(`/api/work-cases/${mainId}/commands`, { method: 'POST', body: staleMetric });
  assert.equal(versionConflict.status, 409);
  assert.equal(versionConflict.body.error.code, 'VERSION_CONFLICT');
  const afterVersionConflict = await graph();
  assert.equal(afterVersionConflict.source.projectionHash, beforeVersionConflict.source.projectionHash);

  const exceptionId = `${mainId}:exception:1`;
  const escalationId = `${mainId}:escalation:1`;
  await send('exception.open', {
    id: exceptionId, type: fixture.exception.type, severity: fixture.exception.severity,
    sourceRefs: [{ reason: fixture.exception.reason, actionIntentId: failedActionId }],
  });
  await send('escalation.offer', {
    id: escalationId, exceptionId, assignedHumanId: 'human-reviewer',
    reason: fixture.exception.reason, dueAt: FUTURE_AT,
  });
  await expectFailure('escalation.acknowledge', { escalationId }, 'ESCALATION_ASSIGNEE_REQUIRED', { kind: 'human', id: 'human-owner' }, { status: 403 });
  await send('escalation.acknowledge', { escalationId }, reviewer);
  await send('exception.acknowledge', { exceptionId });
  await send('exception.resolve', { exceptionId, resolution: '合成异常已按共同流程记录、升级并解决。' });

  for (const metric of fixture.metrics) {
    const definition = config.metricDefinitions.find((item) => item.metricKey === metric.metricKey);
    assert(definition?.ownerRole && definition.threshold && definition.failureHandling);
    await send('metric.observe', {
      id: `${mainId}:metric:${metric.category}`, metricKey: metric.metricKey,
      category: metric.category, value: metric.value, unit: metric.unit,
      sourceRef: { systemId: metric.sourceSystem }, observedAt: FIXED_AT,
      window: { kind: 'synthetic-p5' }, definitionVersion: config.version,
    });
  }
  await send('workCase.complete', { resultEvidenceIds: attachedEvidenceIds, succeededActionIds: [succeededActionId] });
  await send('workCase.close', {});

  // Unknown receipt is isolated so the main WorkCase can truthfully complete and close.
  let unknownVersion = 0;
  const unknownEnvelope = createEnvelopeFactory(config, 'unknown');
  const sendUnknown = async (commandType, payload, actor = { kind: 'human', id: 'human-owner' }) => {
    const response = await request(`/api/work-cases/${unknownId}/commands`, { method: 'POST', body: unknownEnvelope(commandType, payload, unknownVersion, actor) });
    assert.equal(response.status, 200, `${key}/unknown/${commandType}: ${JSON.stringify(response.body)}`);
    unknownVersion = response.body.streamVersion;
    return response.body;
  };
  const unknownCreate = await request('/api/work-cases', {
    method: 'POST',
    body: unknownEnvelope('workCase.create', {
      ...createPayload, id: unknownId, title: `${fixture.title} · unknown 回执隔离样本`,
      trigger: { ...createPayload.trigger, id: `${unknownId}:trigger:1`, dedupeKey: `synthetic:${key}:${unknownId}`, payloadRef: { ...createPayload.trigger.payloadRef, recordId: unknownId } },
    }, 0),
  });
  assert.equal(unknownCreate.status, 201);
  unknownVersion = unknownCreate.body.streamVersion;
  await sendUnknown('goal.propose', { id: `${unknownId}:goal:1`, statement: fixture.goal.statement, constraints: fixture.goal.constraints, evidenceIds: [] });
  await sendUnknown('goal.accept', { goalId: `${unknownId}:goal:1` });
  const unknownEvidenceId = `${unknownId}:evidence:f`;
  await sendUnknown('evidence.attach', { evidence: {
    id: unknownEvidenceId, sourceRef: { systemId: fixture.action.systemId },
    recordRef: { systemId: fixture.action.systemId, recordType: 'boundary-f', recordId: `synthetic-${key}-unknown`, observedVersion: '1' },
    observedAt: FIXED_AT, contentHash: canonicalHash({ key, unknown: true }), classification: 'public', summary: '[F] 公开线索合成样本。',
  } });
  await sendUnknown('context.publish', {
    id: `${unknownId}:context:1`, evidenceIds: [unknownEvidenceId], purpose: 'unknown receipt 隔离验证',
    allowedDecisionUses: ['action.authorize'], freshnessPolicy: { maxAgeMinutes: 60 },
  });
  const unknownActionId = `${unknownId}:action:unknown`;
  await sendUnknown('action.propose', {
    id: unknownActionId, systemId: fixture.action.systemId, operation: fixture.action.operation,
    inputRef: { simulateStatus: 'unknown', fixtureRef: `synthetic-${key}-unknown` }, requiredGateIds: [],
    idempotencyKey: `${unknownId}:action-key:unknown`,
  });
  await sendUnknown('action.authorize', { actionIntentId: unknownActionId });
  await sendUnknown('action.execute', { actionIntentId: unknownActionId });
  const unknownGraph = await graph(unknownId);
  assert.equal(unknownGraph.rawRefs.receiptStatuses.at(-1).status, 'unknown');
  assert.match(unknownGraph.edges.find((edge) => edge.type === 'action_write').label, /unknown|未知/);
  assert.doesNotMatch(unknownGraph.edges.find((edge) => edge.type === 'action_write').label, /成功/);

  const mainProjection = await request(`/api/work-cases/${mainId}`);
  assert.equal(mainProjection.status, 200);
  assert.equal(mainProjection.body.state.status, 'closed');
  assert.equal(new Set(mainProjection.body.state.metricObservations.map((item) => item.category)).size, 3);
  assert.equal(mainProjection.body.state.exceptions[0].status, 'resolved');
  assert.equal(mainProjection.body.state.escalations[0].status, 'acknowledged');
  const finalGraph = await graph();
  assert.equal(finalGraph.source.projectionHash, finalGraph.source.replayHash);

  const stats = scenarioExtensionStats(config);
  assert(stats.ratio <= 0.2, `${key} extension ratio 超过 20%。`);
  return {
    scenarioKey: key,
    displayNameZh: config.displayNameZh,
    status: 'PASS',
    kernelVersion: 1,
    mainWorkCaseId: mainId,
    unknownWorkCaseId: unknownId,
    evidenceIds: config.evidenceRefs.map((item) => item.evidenceId),
    boundaries: Object.fromEntries(['F', 'I', 'H'].map((boundary) => [boundary, fixture.evidence.filter((item) => item.boundary === boundary).length])),
    metrics: config.metricDefinitions.map((item) => ({
      metricKey: item.metricKey, category: item.category, dataSource: item.sourceSystem,
      owner: item.ownerRole, threshold: item.threshold, failureHandling: item.failureHandling,
    })),
    failurePaths: {
      providerInvalid: true, providerTimeout: true, staleGoalHandoff: true, staleContextHandoff: true,
      gateUnauthorized: true, connectorFailed: true, connectorUnknown: true, idempotentRetry: true,
      versionConflict: true, exceptionEscalation: true, unknownExtension: true, specializedCommand: true, specializedRoute: true,
    },
    advisoryChecks,
    replayHash: finalGraph.source.replayHash,
    unknownReplayHash: unknownGraph.source.replayHash,
    extension: stats,
    branchRatios: { domainState: 0, transition: 0, api: 0, ui: 0 },
  };
}

export async function runP5ScenarioSuite({ databasePath = null, cleanup = databasePath === null, verbose = true } = {}) {
  const configs = loadScenarioConfigs(resolve(ROOT, 'scenarios'));
  assert.equal(configs.size, 10, 'P5 必须加载 exactly 10 个 scenario config。');
  const fixtures = loadScenarioFixtures(resolve(ROOT, 'test', 'fixtures', 'scenarios'), configs);
  const marketEvidence = verifyMarketEvidence(configs);
  const branches = scanScenarioBranches([...configs.keys()]);
  const runtimeDirectory = databasePath === null ? mkdtempSync(join(tmpdir(), 'relayos-p5-suite-')) : dirname(resolve(databasePath));
  mkdirSync(runtimeDirectory, { recursive: true });
  const runtimeDatabasePath = databasePath === null ? resolve(runtimeDirectory, 'relayos-p5.db') : resolve(databasePath);
  const store = new EventStore(runtimeDatabasePath);
  const adapter = new CountingMockAdapter({ clock: () => FIXED_AT });
  const service = new RelayService({ store, scenarioConfigs: configs, connector: adapter, clock: () => FIXED_AT });
  const rawProvider = new MockProvider();
  const provider = new ResilientAdvisoryProvider(rawProvider, { sleep: async () => {}, random: () => 0 });
  const advisoryService = new AdvisoryService({ getWorkCase: (id) => service.getWorkCase(id), provider });
  const server = createRelayHttpServer({ service, advisoryService, publicDirectory: resolve(ROOT, 'public') });
  let base;
  try {
    base = await listen(server);
    const request = createClient(base);
    const root = await request('/');
    assert.equal(root.status, 200);
    assert.match(root.body, /连续性关系图/);
    const scenariosResponse = await request('/api/scenarios');
    assert.equal(scenariosResponse.status, 200);
    assert.equal(scenariosResponse.body.scenarios.length, 10);
    assert(scenariosResponse.body.scenarios.every((item) => item.kernelVersion === 1));

    const results = [];
    for (const config of configs.values()) {
      const result = await runOneScenario({ config, fixture: fixtures.get(config.scenarioKey), request, rawProvider, adapter });
      assert.deepEqual(result.evidenceIds, marketEvidence.get(config.scenarioKey).map((item) => item.evidenceId));
      results.push(result);
      if (verbose) console.log(`[P5] scenarioKey=${result.scenarioKey} status=${result.status} kernelVersion=${result.kernelVersion} replayHash=${result.replayHash} extension=${result.extension.extensionFieldCount}/${result.extension.totalDeclaredFieldCount} (${(result.extension.ratio * 100).toFixed(2)}%)`);
    }

    const beforeHashes = new Map(store.listProjections().map((item) => [item.workCaseId, item.canonicalStateHash]));
    assert.equal(beforeHashes.size, 20, '每个 scenario 应有 main + unknown 两条可回放 stream。');
    store.db.exec('DELETE FROM work_case_projections');
    assert.equal(store.getStats().projections, 0);
    const rebuilt = store.rebuildProjections({ dropFirst: false });
    assert.equal(rebuilt.rebuilt, 20);
    for (const [workCaseId, hash] of beforeHashes) assert.equal(store.getProjection(workCaseId).canonicalStateHash, hash, `${workCaseId} BusinessEvent-only replay hash 不一致。`);
    const chain = store.verifyEventChain();
    assert.equal(chain.streamCount, 20);

    for (const result of results) {
      result.replayHash = store.replayStream(result.mainWorkCaseId).canonicalStateHash;
      result.unknownReplayHash = store.replayStream(result.unknownWorkCaseId).canonicalStateHash;
    }
    const passed = results.filter((item) => item.status === 'PASS').length;
    assert.equal(passed, 10);
    if (verbose) console.log(`[P5] summary=${passed}/10 kernelVersion=1 eventCount=${chain.eventCount} replayRebuilt=${rebuilt.rebuilt}/20 staticBranches=0`);
    return {
      status: 'PASS', passed, total: 10, kernelVersion: 1, results, branches,
      eventChain: chain, replayRebuilt: rebuilt.rebuilt, databasePath: runtimeDatabasePath,
      baseUrl: base, p0: { csv: P0_CSV, report: P0_REPORT, scenarios: marketEvidence.size },
    };
  } finally {
    if (server.listening) await closeServer(server);
    store.close();
    if (cleanup) rmSync(runtimeDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  runP5ScenarioSuite().catch((error) => {
    console.error(`[P5] FAIL ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
