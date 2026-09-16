import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  projectWorkbenchReadModel,
  toQuarterThreshold,
} from '../lib/v3-surfaces/workbench/projection.ts';
import { V3_SCENARIO_CASES } from '../lib/v3-demo-scenario.ts';

const integration = {
  authorityRuntime: { status: 'connected', implementation: 'shared-v3-demo-runtime', persistence: 'in-memory-demo' },
  chat: { status: 'connected', implementation: 'shared-authority-event-ledger' },
  sqlite: { status: 'pending_shared', owner: 'V3 Leadership Back', implementation: 'typed-adapter-only' },
};

const session = {
  sessionId: 'TEST-BUSINESS',
  principalId: 'business-owner',
  roleApplicationId: 'business',
};

function run(processId, status, readinessBand, evidenceCoverageBand) {
  return {
    runId: `RUN-${processId}`,
    caseId: 'FL-DEMO-001',
    processId,
    boundContextVersion: 'CTX-0003',
    sourceEventId: 'EVT-TRIGGER',
    status,
    readinessBand,
    riskBand: processId === 'policy' ? 'low' : 'medium',
    evidenceCoverageBand,
    gateState: status === 'ready_for_gate' ? 'ready' : 'not_ready',
    updatedAt: '2026-08-30T00:00:00.000Z',
  };
}

function goldenSnapshot() {
  const processRuns = [
    run('policy', 'partial', 1, 4),
    run('credit', 'ready_for_gate', 4, 1),
    run('commercial', 'needs_input', 2, 3),
    run('asset', 'completed', 4, 4),
  ];
  return {
    caseItem: structuredClone(V3_SCENARIO_CASES[0]),
    runtimeEpoch: 'RUNTIME-TEST',
    currentContext: {
      runtimeEpoch: 'RUNTIME-TEST',
      contextSeq: 3,
      contextVersion: 'CTX-0003',
      previousContextVersion: 'CTX-0002',
      transitionCode: 'T3',
      diffId: 'DIFF-3',
      sourceReceiptIds: [],
    },
    processRuns,
    receipts: [{
      receiptId: 'RCP-ASSET-REJECT',
      receiptType: 'human_gate',
      eventId: 'EVT-ASSET-REJECT',
      caseId: 'FL-DEMO-001',
      contextVersion: 'CTX-0003',
      principalId: 'risk-asset',
      processId: 'asset',
      actionType: 'professional_gate',
      status: 'reject',
      evidenceReceiptIds: ['RCP-EVIDENCE'],
      recordedAt: '2026-08-30T00:00:01.000Z',
      details: { gateMode: 'HUMAN_DECIDE' },
    }],
    events: processRuns.map((item) => ({
      eventId: `EVT-${item.processId}`,
      runtimeEpoch: 'RUNTIME-TEST',
      sequence: 1,
      caseId: 'FL-DEMO-001',
      scenarioVersion: 'test',
      type: 'PROCESS_RUN_STATUS_CHANGED',
      actor: { principalId: 'process-orchestrator', roleApplicationId: 'system', authority: 'none' },
      correlationId: `REQ-${item.processId}`,
      causationId: null,
      contextVersion: 'CTX-0003',
      recordedAt: '2026-08-30T00:00:00.000Z',
      payload: { runId: item.runId, summary: `${item.processId} candidate` },
    })),
  };
}

describe('V3 Case Workbench projection', () => {
  it('maps the four professional quadrants exactly', () => {
    const model = projectWorkbenchReadModel(goldenSnapshot(), session, 'business', integration);
    assert.deepEqual(model.businessOverview.professionalQuadrants, {
      policy: 'top-right',
      credit: 'bottom-right',
      commercial: 'bottom-left',
      asset: 'top-left',
    });
  });

  it('rolls up out-of-order and partial steps without enforcing sequence', () => {
    const model = projectWorkbenchReadModel(goldenSnapshot(), session, 'credit', integration);
    const policy = model.professionalProjections.policy;
    const credit = model.professionalProjections.credit;
    assert.deepEqual(policy.path.map((step) => step.completionPercent), [100, 25, 50, null]);
    assert.equal(policy.rollup.continuousPercent, 58.33);
    assert.equal(policy.rollup.quarterThreshold, 50);
    assert.deepEqual(credit.path.map((step) => step.completionPercent), [25, 100, 100, null]);
    assert.equal(credit.rollup.continuousPercent, 75);
    assert.equal(credit.rollup.quarterThreshold, 75);
  });

  it('keeps completion, status, result and Authority separate at 100% reject', () => {
    const asset = projectWorkbenchReadModel(goldenSnapshot(), session, 'asset', integration)
      .professionalProjections.asset;
    assert.equal(asset.rollup.continuousPercent, 100);
    assert.equal(asset.rollup.quarterThreshold, 100);
    assert.equal(asset.completionStatus, 'completed');
    assert.equal(asset.result, '已拒绝');
    assert.equal(asset.authority, 'confirmed_human');
    assert.equal(asset.modelCandidate.authority, 'none');
    assert.equal(asset.humanGate.receiptId, 'RCP-ASSET-REJECT');
  });

  it('fails closed for missing background data instead of inventing zero-valued results', () => {
    const background = structuredClone(V3_SCENARIO_CASES[1]);
    const model = projectWorkbenchReadModel({
      caseItem: background,
      runtimeEpoch: null,
      currentContext: null,
      processRuns: [],
      receipts: [],
      events: [],
    }, session, 'policy', integration);
    assert.equal(model.readOnly, true);
    assert.equal(model.contextVersion, null);
    for (const projection of Object.values(model.professionalProjections)) {
      assert.equal(projection.result, '未提供');
      assert.equal(projection.rollup.quarterThreshold, null);
      assert.ok(projection.evidenceSources.every((source) =>
        source.availability === 'missing' && source.sourceRef === '未提供'));
    }
  });

  it('emits only the five frozen quarter thresholds', () => {
    assert.deepEqual(
      [-1, 0, 24.999, 25, 49.999, 50, 74.999, 75, 99.999, 100, 101].map(toQuarterThreshold),
      [0, 0, 0, 25, 25, 50, 50, 75, 75, 100, 100],
    );
  });
});
