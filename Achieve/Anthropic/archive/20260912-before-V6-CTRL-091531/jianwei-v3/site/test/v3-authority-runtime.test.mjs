import assert from 'node:assert/strict';
import test from 'node:test';

import { createV3AuthorityRuntime } from '../lib/v3-authority-runtime.ts';

const scenario = {
  scenarioRef: {
    scenarioId: 'JW-V3-DL-GOLDEN-001',
    scenarioVersion: '1.0.0-macro',
    seed: 'jw-v3-dl-golden-seed-001',
    businessItemType: 'FinancingLeasingCase',
    caseId: 'FL-DEMO-001',
    leaseMode: 'direct-lease',
    dataClass: 'synthetic_deidentified_demo',
  },
  cases: [
    { caseId: 'FL-DEMO-001', caseTier: 'golden', readOnly: false, commencementBand: 0, lifecycleStatus: 'pre_commencement' },
    { caseId: 'FL-BG-001', caseTier: 'background', readOnly: true, commencementBand: 1, lifecycleStatus: 'pre_commencement' },
    { caseId: 'FL-BG-003', caseTier: 'background', readOnly: true, commencementBand: 5, lifecycleStatus: 'active_lease' },
  ],
  processIds: ['opportunity', 'policy', 'credit', 'commercial', 'asset'],
};

function makeRuntime() {
  let tick = 0;
  let epoch = 0;
  return createV3AuthorityRuntime({
    scenario,
    now: () => new Date(Date.UTC(2026, 7, 29, 10, 0, tick++)).toISOString(),
    runtimeEpochFactory: () => `TEST-EPOCH-${++epoch}`,
  });
}

function expectCode(operation, code) {
  assert.throws(operation, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

const customerInvitation = {
  invitationId: 'INV-CUSTOMER-RISK-001',
  caseId: 'FL-DEMO-001',
  principalId: 'external-customer',
  workstepProcessId: 'opportunity',
  allowedActionTypes: ['chat', 'submit_evidence', 'confirm_fact'],
  status: 'active',
};

const supplierInvitation = {
  invitationId: 'INV-SUPPLIER-DEVICE-001',
  caseId: 'FL-DEMO-001',
  principalId: 'external-supplier',
  workstepProcessId: 'commercial',
  allowedActionTypes: ['chat', 'submit_evidence', 'confirm_fact'],
  status: 'active',
};

function accept(runtime, requestId, actor, evidenceId, processId, invitation) {
  return runtime.acceptEvidence({
    requestId,
    evidenceId,
    evidenceType: 'scenario-fact',
    sourceRef: `scenario://${evidenceId}`,
    contentHash: `hash-${evidenceId}`,
    processId,
    invitation,
    ...actor,
  });
}

function currentRuns(runtime) {
  const snapshot = runtime.snapshot();
  return snapshot.processRuns.filter((run) =>
    run.boundContextVersion === snapshot.currentContext.contextVersion && run.status !== 'superseded');
}

function moveRuns(runtime, transitionCode) {
  const runs = currentRuns(runtime);
  for (const run of runs) {
    runtime.updateProcessRun({
      requestId: `${transitionCode}-${run.processId}-running`,
      runId: run.runId,
      status: 'running',
      readinessBand: 0,
      riskBand: 'unknown',
      evidenceCoverageBand: 0,
      summary: `${run.processId} running`,
    });
    const isT2Credit = transitionCode === 'T2' && run.processId === 'credit';
    const isT3Professional = transitionCode === 'T3' && run.processId !== 'opportunity';
    runtime.updateProcessRun({
      requestId: `${transitionCode}-${run.processId}-result`,
      runId: run.runId,
      status: isT2Credit ? 'needs_input' : isT3Professional ? 'ready_for_gate' : transitionCode === 'T3' ? 'completed' : 'partial',
      readinessBand: isT2Credit ? 2 : transitionCode === 'T1' && run.processId === 'credit' ? 3 : isT3Professional ? 4 : 2,
      riskBand: isT2Credit ? 'high' : 'medium',
      evidenceCoverageBand: isT2Credit ? 2 : isT3Professional ? 4 : 2,
      summary: `${run.processId} ${transitionCode} result`,
    });
  }
}

function runThroughT3(runtime) {
  const business = { roleApplicationId: 'business', principalId: 'business-owner' };
  const customer = { roleApplicationId: 'external', principalId: 'external-customer' };
  const supplier = { roleApplicationId: 'external', principalId: 'external-supplier' };

  const t1Evidence = accept(runtime, 'ev-t1', business, 'EV-T1', 'opportunity');
  const t1 = runtime.commitContext({
    ...business,
    requestId: 'commit-t1',
    transitionCode: 'T1',
    expectedContextVersion: 'CTX-0000',
    evidenceReceiptIds: [t1Evidence.receiptId],
    confirmedFactIds: ['FACT-OPPORTUNITY-001'],
    rationale: '确认商机事实包',
  });
  assert.equal(t1.runs.length, 5);
  moveRuns(runtime, 'T1');

  const t2Evidence = accept(runtime, 'ev-t2', customer, 'EV-T2', 'opportunity', customerInvitation);
  const t2 = runtime.commitContext({
    ...customer,
    invitation: customerInvitation,
    requestId: 'commit-t2',
    transitionCode: 'T2',
    expectedContextVersion: 'CTX-0001',
    evidenceReceiptIds: [t2Evidence.receiptId],
    confirmedFactIds: ['FACT-RISK-001'],
    rationale: '确认订单覆盖偏差',
  });
  assert.equal(t2.runs.length, 5);
  moveRuns(runtime, 'T2');

  const customerT3 = accept(runtime, 'ev-t3-customer', customer, 'EV-T3-C', 'opportunity', customerInvitation);
  const supplierT3 = accept(runtime, 'ev-t3-supplier', supplier, 'EV-T3-S', 'commercial', supplierInvitation);
  const t3 = runtime.commitContext({
    ...business,
    requestId: 'commit-t3',
    transitionCode: 'T3',
    expectedContextVersion: 'CTX-0002',
    evidenceReceiptIds: [customerT3.receiptId, supplierT3.receiptId],
    confirmedFactIds: ['FACT-EVIDENCE-BATCH-003'],
    rationale: '确认客户与供应商补强材料属于同一批次',
  });
  assert.equal(t3.runs.length, 5);
  moveRuns(runtime, 'T3');
  return { customerT3, supplierT3 };
}

test('Evidence staging is idempotent and does not advance Context', () => {
  const runtime = makeRuntime();
  const business = { roleApplicationId: 'business', principalId: 'business-owner' };
  const first = accept(runtime, 'ev-t1', business, 'EV-T1', 'opportunity');
  const replay = accept(runtime, 'ev-t1', business, 'EV-T1', 'opportunity');
  assert.deepEqual(replay, first);
  assert.equal(runtime.snapshot().currentContext.contextVersion, 'CTX-0000');
  const canonicalReplay = accept(runtime, 'ev-t1-second-request', business, 'EV-T1', 'opportunity');
  assert.equal(canonicalReplay.receiptId, first.receiptId);
  assert.equal(runtime.snapshot().receipts.length, 1);
  expectCode(
    () => runtime.acceptEvidence({
      ...business,
      requestId: 'ev-t1-conflicting-evidence-id',
      evidenceId: 'EV-T1',
      evidenceType: 'scenario-fact',
      sourceRef: 'scenario://EV-T1',
      contentHash: 'different-hash',
      processId: 'opportunity',
    }),
    'EVIDENCE_ID_CONFLICT',
  );
  assert.equal(runtime.snapshot().contexts.length, 1);
  expectCode(
    () => accept(runtime, 'ev-t1', business, 'EV-T1-CHANGED', 'opportunity'),
    'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(runtime.snapshot().receipts.length, 1);
  const message = runtime.recordMessage({
    ...business,
    requestId: 'message-1',
    message: '请按当前商机事实继续准备候选结果',
    processId: 'opportunity',
  });
  assert.equal(message.type, 'MESSAGE_RECEIVED');
  assert.equal(message.actor.authority, 'none');
  assert.equal(runtime.snapshot().currentContext.contextVersion, 'CTX-0000');
});

test('requires an external workstep and validates formal Gate schema', () => {
  const runtime = makeRuntime();
  expectCode(
    () => runtime.acceptEvidence({
      roleApplicationId: 'external',
      principalId: 'external-customer',
      invitation: customerInvitation,
      requestId: 'external-missing-process',
      evidenceId: 'EV-MISSING-PROCESS',
      evidenceType: 'scenario-fact',
      sourceRef: 'scenario://EV-MISSING-PROCESS',
      contentHash: 'hash-missing-process',
    }),
    'INVITATION_SCOPE_DENIED',
  );
  const { customerT3 } = runThroughT3(runtime);
  const base = {
    roleApplicationId: 'risk',
    principalId: 'risk-policy',
    expectedContextVersion: 'CTX-0003',
    processId: 'policy',
    rationale: '政策专业确认',
    evidenceReceiptIds: [customerT3.receiptId],
  };
  expectCode(
    () => runtime.recordHumanGate({ ...base, requestId: 'invalid-mode', gateMode: 'NOT_A_GATE_MODE', decision: 'confirm' }),
    'INVALID_GATE_MODE',
  );
  expectCode(
    () => runtime.recordHumanGate({ ...base, requestId: 'invalid-decision', gateMode: 'HUMAN_CONFIRM', decision: 'NOT_A_DECISION' }),
    'INVALID_GATE_DECISION',
  );
  expectCode(
    () => runtime.recordHumanGate({ ...base, requestId: 'empty-evidence', gateMode: 'HUMAN_CONFIRM', decision: 'confirm', evidenceReceiptIds: [] }),
    'EVIDENCE_REQUIRED',
  );
  assert.equal(runtime.snapshot().receipts.filter((receipt) => receipt.receiptType === 'human_gate').length, 0);
});

test('uses the latest professional Gate decision for commencement', () => {
  const runtime = makeRuntime();
  const { customerT3, supplierT3 } = runThroughT3(runtime);
  const evidenceReceiptIds = [customerT3.receiptId, supplierT3.receiptId];
  const confirmations = [];
  for (const [processId, principalId] of [['policy', 'risk-policy'], ['credit', 'risk-credit'], ['commercial', 'risk-commercial']]) {
    confirmations.push(runtime.recordHumanGate({
      roleApplicationId: 'risk', principalId, requestId: `initial-${processId}`, expectedContextVersion: 'CTX-0003', processId,
      gateMode: 'HUMAN_CONFIRM', decision: 'confirm', rationale: `${processId} confirm`, evidenceReceiptIds,
    }));
  }
  runtime.recordHumanGate({
    roleApplicationId: 'risk', principalId: 'risk-commercial', requestId: 'commercial-later-reject', expectedContextVersion: 'CTX-0003', processId: 'commercial',
    gateMode: 'HUMAN_DECIDE', decision: 'reject', rationale: '最新商务判断退回', evidenceReceiptIds,
  });
  expectCode(
    () => runtime.recordCommencement({
      roleApplicationId: 'risk', principalId: 'risk-commercial', requestId: 'commencement-after-reject', expectedContextVersion: 'CTX-0003', conditionSetVersion: 'DIRECT-LEASE-DEMO-1',
      requiredReceiptIds: confirmations.map((receipt) => receipt.receiptId), rationale: '不得使用历史 confirm 起租',
    }),
    'COMMENCEMENT_NOT_READY',
  );
  assert.equal(runtime.snapshot().commencement.status, 'pre_commencement');
});

test('runs T1/T2/T3, preserves stale history and reaches formal commencement', () => {
  const runtime = makeRuntime();
  const { customerT3, supplierT3 } = runThroughT3(runtime);
  const beforeGates = runtime.snapshot();
  assert.deepEqual(beforeGates.contexts.map((context) => context.transitionCode), ['BASELINE', 'T1', 'T2', 'T3']);
  assert.equal(beforeGates.currentContext.contextVersion, 'CTX-0003');
  assert.equal(beforeGates.processRuns.filter((run) => run.status === 'superseded').length, 10);
  assert.equal(beforeGates.processRuns.filter((run) => run.boundContextVersion === 'CTX-0003').length, 5);
  const t2Credit = beforeGates.processRuns.find((run) => run.processId === 'credit' && run.boundContextVersion === 'CTX-0002');
  assert.equal(t2Credit.status, 'superseded');
  assert.equal(t2Credit.readinessBand, 2);
  assert.equal(t2Credit.supersededByContextVersion, 'CTX-0003');

  const gatePrincipals = {
    policy: 'risk-policy',
    credit: 'risk-credit',
    commercial: 'risk-commercial',
    asset: 'risk-asset',
  };
  const gateReceipts = [];
  for (const [processId, principalId] of Object.entries(gatePrincipals)) {
    gateReceipts.push(runtime.recordHumanGate({
      roleApplicationId: 'risk',
      principalId,
      requestId: `gate-${processId}`,
      expectedContextVersion: 'CTX-0003',
      processId,
      gateMode: 'HUMAN_CONFIRM',
      decision: 'confirm',
      rationale: `${processId} 专业确认`,
      evidenceReceiptIds: [customerT3.receiptId, supplierT3.receiptId],
    }));
  }
  const management = runtime.recordManagementAction({
    roleApplicationId: 'leadership',
    principalId: 'collaboration-manager',
    requestId: 'management-1',
    expectedContextVersion: 'CTX-0003',
    actionCode: 'REQUEST_PRIORITY_REVIEW',
    targetPrincipalIds: ['risk-credit', 'business-owner'],
    rationale: '确认起租窗口并持续关注订单集中度',
    evidenceOrProjectionRefs: ['KPI-SMALL-MICRO-LEASE-START'],
  });
  assert.equal(management.receiptType, 'management_action');

  const commencement = runtime.recordCommencement({
    roleApplicationId: 'risk',
    principalId: 'risk-commercial',
    requestId: 'commencement-1',
    expectedContextVersion: 'CTX-0003',
    conditionSetVersion: 'DIRECT-LEASE-DEMO-1',
    requiredReceiptIds: [...gateReceipts.map((receipt) => receipt.receiptId), customerT3.receiptId, supplierT3.receiptId],
    rationale: '合同、付款、查验与必要专业 Gate 已满足，确认正式起租',
  });
  assert.equal(commencement.receiptType, 'commencement');

  const final = runtime.snapshot();
  assert.equal(final.contexts.length, 4, 'Gate and Action must not create Context versions');
  assert.equal(final.commencement.band, 5);
  assert.equal(final.commencement.status, 'commenced');
  assert.equal(final.commencement.lifecycleStatus, 'active_lease');
  assert.equal(final.events.at(-1).type, 'LEASE_COMMENCEMENT_RECORDED');
  assert.deepEqual(final.events.map((event) => event.sequence), final.events.map((_, index) => index + 1));
  assert.ok(final.receipts.some((receipt) => receipt.receiptType === 'management_action'));
  assert.ok(final.receipts.some((receipt) => receipt.receiptType === 'commencement'));
});

test('fails closed for T3 missing supplier, cross-professional Gate and incomplete commencement refs', () => {
  const runtime = makeRuntime();
  const business = { roleApplicationId: 'business', principalId: 'business-owner' };
  const customer = { roleApplicationId: 'external', principalId: 'external-customer' };
  const t1Evidence = accept(runtime, 'ev-t1', business, 'EV-T1', 'opportunity');
  runtime.commitContext({ ...business, requestId: 'commit-t1', transitionCode: 'T1', expectedContextVersion: 'CTX-0000', evidenceReceiptIds: [t1Evidence.receiptId], rationale: 'T1' });
  const t2Evidence = accept(runtime, 'ev-t2', customer, 'EV-T2', 'opportunity', customerInvitation);
  runtime.commitContext({ ...customer, invitation: customerInvitation, requestId: 'commit-t2', transitionCode: 'T2', expectedContextVersion: 'CTX-0001', evidenceReceiptIds: [t2Evidence.receiptId], rationale: 'T2' });
  const customerT3 = accept(runtime, 'ev-t3-customer', customer, 'EV-T3-C', 'opportunity', customerInvitation);
  expectCode(
    () => runtime.commitContext({ ...business, requestId: 'commit-t3', transitionCode: 'T3', expectedContextVersion: 'CTX-0002', evidenceReceiptIds: [customerT3.receiptId], rationale: 'missing supplier' }),
    'EVIDENCE_SCOPE_DENIED',
  );
  assert.equal(runtime.snapshot().currentContext.contextVersion, 'CTX-0002');
  expectCode(
    () => runtime.recordHumanGate({
      roleApplicationId: 'risk',
      principalId: 'risk-policy',
      requestId: 'bad-gate',
      expectedContextVersion: 'CTX-0002',
      processId: 'credit',
      gateMode: 'HUMAN_CONFIRM',
      decision: 'confirm',
      rationale: '越权',
      evidenceReceiptIds: [],
    }),
    'PROCESS_SCOPE_DENIED',
  );
});

test('reset starts a new epoch and removes the previous run state', () => {
  const runtime = makeRuntime();
  const business = { roleApplicationId: 'business', principalId: 'business-owner' };
  accept(runtime, 'ev-t1', business, 'EV-T1', 'opportunity');
  const firstEpoch = runtime.snapshot().runtimeEpoch;
  const reset = runtime.reset();
  assert.notEqual(reset.runtimeEpoch, firstEpoch);
  assert.equal(reset.contexts.length, 1);
  assert.equal(reset.receipts.length, 0);
  assert.equal(reset.processRuns.length, 0);
  assert.equal(reset.events.length, 1);
  assert.equal(reset.events[0].type, 'SCENARIO_BASELINE_INITIALIZED');
});
