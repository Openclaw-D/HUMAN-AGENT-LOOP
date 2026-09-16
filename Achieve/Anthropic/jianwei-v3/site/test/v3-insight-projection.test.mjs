import assert from 'node:assert/strict';
import test from 'node:test';

import { buildInsightProjection } from '../lib/v3-surfaces/insight/projection.ts';
import { readSharedInsightRuntimeInput } from '../lib/v3-surfaces/insight/shared-adapter.ts';
import { createV3DemoSession } from '../lib/v3-demo-backend.ts';

function fixture() {
  return {
    scenarioRef: {
      caseId: 'CASE-1',
      scenarioId: 'SCENARIO-1',
      scenarioVersion: '1',
      dataClass: 'synthetic_deidentified_demo',
    },
    runtimeEpoch: 'EPOCH-1',
    currentContext: {
      runtimeEpoch: 'EPOCH-1',
      contextSeq: 1,
      contextVersion: 'CTX-1',
      previousContextVersion: 'CTX-0',
      transitionCode: 'T1',
      diffId: 'DIFF-1',
      sourceReceiptIds: [],
    },
    cases: [{ caseId: 'CASE-1' }],
    processRuns: [
      {
        runId: 'RUN-POLICY',
        caseId: 'CASE-1',
        processId: 'policy',
        boundContextVersion: 'CTX-1',
        sourceEventId: 'EVENT-1',
        status: 'ready_for_gate',
        readinessBand: 4,
        riskBand: 'medium',
        evidenceCoverageBand: 4,
        gateState: 'ready',
        startedAt: '2026-08-30T10:00:00.000Z',
        updatedAt: '2026-08-30T10:10:00.000Z',
      },
      {
        runId: 'RUN-CREDIT',
        caseId: 'CASE-1',
        processId: 'credit',
        boundContextVersion: 'CTX-1',
        sourceEventId: 'EVENT-1',
        status: 'needs_input',
        readinessBand: 2,
        riskBand: 'high',
        evidenceCoverageBand: 2,
        gateState: 'not_ready',
        startedAt: '2026-08-30T10:00:00.000Z',
        updatedAt: '2026-08-30T10:20:00.000Z',
      },
    ],
    receipts: [],
    events: [
      {
        eventId: 'EVENT-1',
        runtimeEpoch: 'EPOCH-1',
        sequence: 1,
        caseId: 'CASE-1',
        scenarioVersion: '1',
        type: 'PROCESS_RUN_STATUS_CHANGED',
        actor: { principalId: 'process-run-runtime', roleApplicationId: 'system', authority: 'none' },
        correlationId: 'CORR-1',
        causationId: null,
        contextVersion: 'CTX-1',
        recordedAt: '2026-08-30T10:10:00.000Z',
        payload: { processId: 'policy' },
      },
      {
        eventId: 'EVENT-2',
        runtimeEpoch: 'EPOCH-1',
        sequence: 2,
        caseId: 'CASE-1',
        scenarioVersion: '1',
        type: 'HUMAN_GATE_RECORDED',
        actor: { principalId: 'risk-policy', roleApplicationId: 'risk', authority: 'confirmed' },
        correlationId: 'CORR-2',
        causationId: 'EVENT-1',
        contextVersion: 'CTX-1',
        recordedAt: '2026-08-30T10:15:00.000Z',
        payload: { processId: 'policy', decision: 'confirm' },
      },
    ],
    collaboration: {
      threadId: 'THREAD-1',
      members: [
        { principalId: 'risk-policy', processId: 'policy', label: '政策', ownerLabel: '林澄' },
        { principalId: 'risk-credit', processId: 'credit', label: '信审', ownerLabel: '周岚' },
      ],
      entries: [],
      workItems: [
        { processId: 'policy', label: '政策', task: '核对政策', runStatus: 'ready_for_gate', gateState: 'ready' },
        { processId: 'credit', label: '信审', task: '补齐证据', runStatus: 'needs_input', gateState: 'not_ready' },
      ],
    },
    sourceMode: 'in_memory_demo',
    telemetryContract: {
      humanTakeoverDenominatorComplete: true,
      slaTargetMinutes: 30,
      forecastThroughputPerHour: 3,
      scenarioThroughputPerHour: 4,
    },
  };
}

test('builds a deterministic System Runtime graph with complete node and edge references', () => {
  const input = fixture();
  const first = buildInsightProjection(input);
  const second = buildInsightProjection(structuredClone(input));

  assert.deepEqual(second, first);
  assert.equal(first.grain, 'system-runtime');
  assert.equal(first.grainLabel, 'System Runtime');
  assert.equal(first.defaultGrain, 'system-runtime');
  assert.deepEqual(new Set(first.graph.nodes.map((node) => node.kind)), new Set(['human', 'agent', 'system', 'task']));
  const nodeIds = new Set(first.graph.nodes.map((node) => node.id));
  for (const edge of first.graph.edges) {
    assert.ok(nodeIds.has(edge.source), `missing source ${edge.source}`);
    assert.ok(nodeIds.has(edge.target), `missing target ${edge.target}`);
    assert.equal(edge.authority, 'none');
  }
  assert.equal(first.productionStatus, 'local_in_memory_demo_only');
});

test('uses explicit throughput and SLA definitions without merging actual, forecast and scenario', () => {
  const projection = buildInsightProjection(fixture());

  assert.equal(projection.throughput.series.length, 1);
  assert.equal(projection.throughput.series[0].observedCount, 2);
  assert.equal(projection.throughput.series[0].asOf, '2026-08-30T10:15:00.000Z');
  assert.equal(projection.throughput.actual.valueClass, 'actual');
  assert.equal(projection.throughput.actual.unit, 'authority-events/hour');
  assert.equal(projection.throughput.forecast.valueClass, 'forecast');
  assert.equal(projection.throughput.scenario.valueClass, 'scenario');
  assert.equal(projection.sla.observed.value, 15);
  assert.equal(projection.sla.target.value, 30);
  assert.equal(projection.sla.status, 'within-target');
  for (const value of [projection.throughput.actual, projection.throughput.forecast, projection.throughput.scenario, projection.sla.target]) {
    assert.ok(value.source);
    assert.ok(value.provenance);
    assert.ok('asOf' in value);
  }
});

test('gates the human takeover donut on denominator completeness', () => {
  const complete = buildInsightProjection(fixture());
  assert.equal(complete.humanTakeover.numerator, 1);
  assert.equal(complete.humanTakeover.denominator, 2);
  assert.equal(complete.humanTakeover.ratio, 0.5);
  assert.equal(complete.humanTakeover.denominatorCompleteness, 'complete');

  const incompleteInput = fixture();
  incompleteInput.telemetryContract.humanTakeoverDenominatorComplete = false;
  const incomplete = buildInsightProjection(incompleteInput);
  assert.equal(incomplete.humanTakeover.denominator, null);
  assert.equal(incomplete.humanTakeover.ratio, null);
  assert.equal(incomplete.humanTakeover.displayValue, '未提供');
  assert.equal(incomplete.humanTakeover.denominatorCompleteness, 'incomplete');
});

test('separates event, proposal, decision and task authority sources', () => {
  const projection = buildInsightProjection(fixture());
  assert.ok(projection.authorityTypeCounts.event > 0);
  assert.ok(projection.authorityTypeCounts.proposal > 0);
  assert.ok(projection.authorityTypeCounts.decision > 0);
  assert.ok(projection.authorityTypeCounts.task > 0);
  for (const record of projection.authorityRecords) {
    if (record.source.kind === 'agent' || record.source.kind === 'system') assert.equal(record.authority, 'none');
    if (record.authorityType === 'decision') {
      assert.equal(record.source.kind, 'human');
      assert.equal(record.authority, 'confirmed');
    }
  }

  const invalid = fixture();
  invalid.events[0].actor = { principalId: 'candidate-agent', roleApplicationId: 'system', authority: 'confirmed' };
  assert.throws(
    () => buildInsightProjection(invalid),
    (error) => error.code === 'AUTHORITY_SOURCE_INVALID',
  );

  const invalidReceipt = fixture();
  invalidReceipt.receipts.push({
    receiptId: 'RECEIPT-FAKE',
    receiptType: 'human_gate',
    eventId: 'EVENT-1',
    caseId: 'CASE-1',
    contextVersion: 'CTX-1',
    principalId: 'candidate-agent',
    processId: 'policy',
    status: 'confirm',
    evidenceReceiptIds: [],
    recordedAt: '2026-08-30T10:10:00.000Z',
    details: {},
  });
  assert.throws(
    () => buildInsightProjection(invalidReceipt),
    (error) => error.code === 'RECEIPT_AUTHORITY_INVALID',
  );
});

test('fails closed for missing metrics instead of fabricating zero or success', () => {
  const input = fixture();
  input.events = [];
  input.processRuns = [];
  input.telemetryContract = {
    humanTakeoverDenominatorComplete: false,
    slaTargetMinutes: null,
    forecastThroughputPerHour: null,
    scenarioThroughputPerHour: null,
  };
  const projection = buildInsightProjection(input, { grain: 'case', caseId: 'CASE-1' });

  assert.equal(projection.focusCaseId, 'CASE-1');
  assert.equal(projection.throughput.actual.value, null);
  assert.equal(projection.throughput.actual.displayValue, '未提供');
  assert.equal(projection.sla.target.value, null);
  assert.equal(projection.sla.status, 'unknown');
  assert.ok(projection.missingData.includes('sla.targetMinutes'));
});

test('does not project the golden Case collaboration tasks into a different focused Case', () => {
  const input = fixture();
  input.cases.push({ caseId: 'CASE-2' });
  input.events.push({
    ...input.events[0],
    eventId: 'EVENT-CASE-2',
    sequence: 3,
    caseId: 'CASE-2',
    recordedAt: '2026-08-30T11:00:00.000Z',
  });
  const projection = buildInsightProjection(input, { grain: 'case', caseId: 'CASE-2' });

  assert.equal(projection.focusCaseId, 'CASE-2');
  assert.equal(projection.graph.nodes.some((node) => node.kind === 'task'), false);
  assert.ok(projection.authorityRecords.every((record) => record.caseId === 'CASE-2'));
});

test('consumes the shared local runtime through the typed adapter without writing it', () => {
  const session = createV3DemoSession('collaboration-manager');
  const input = readSharedInsightRuntimeInput(session);
  const before = structuredClone(input);
  const projection = buildInsightProjection(input);

  assert.equal(projection.runtimeEpoch, input.runtimeEpoch);
  assert.equal(projection.contextVersion, input.currentContext.contextVersion);
  assert.ok(projection.graph.nodes.some((node) => node.kind === 'task'));
  assert.equal(projection.humanTakeover.denominatorCompleteness, 'incomplete');
  assert.deepEqual(input, before);
});
