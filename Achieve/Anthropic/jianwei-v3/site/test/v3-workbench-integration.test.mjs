import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createV3DemoSession,
  getV3DemoRuntime,
  resetV3DemoRuntime,
  advanceV3DemoProcessRun,
} from '../lib/v3-demo-backend.ts';
import { createWorkbenchService } from '../lib/v3-surfaces/workbench/service.ts';

function workbenchSession(principalId) {
  const session = createV3DemoSession(principalId);
  return {
    sessionId: session.sessionId,
    principalId: session.principalId,
    roleApplicationId: session.roleApplicationId,
  };
}

async function advanceCurrentRuns(transition) {
  const runtime = getV3DemoRuntime();
  const current = runtime.snapshot().currentContext.contextVersion;
  const runs = runtime.snapshot().processRuns.filter((run) =>
    run.boundContextVersion === current && run.status !== 'superseded');
  for (const run of runs) {
    advanceV3DemoProcessRun({ requestId: `${transition}-${run.processId}-start`, runId: run.runId, phase: 'start' });
    advanceV3DemoProcessRun({ requestId: `${transition}-${run.processId}-result`, runId: run.runId, phase: 'result' });
  }
}

function runtimeActor(session) {
  return {
    principalId: session.principalId,
    roleApplicationId: session.roleApplicationId,
    invitation: session.invitation ?? undefined,
  };
}

describe('V3 Case Workbench shared-runtime integration', () => {
  it('shares Case/chat identity and provides idempotent coordination routing', async () => {
    resetV3DemoRuntime();
    const service = createWorkbenchService();
    const business = workbenchSession('business-owner');
    const before = await service.read(business, 'FL-DEMO-001', 'business');
    const action = {
      requestId: 'WB-INTEGRATION-REMIND',
      expectedContextVersion: before.contextVersion,
      actionType: 'remind',
      targetPrincipalId: 'risk-credit',
      message: '请复核订单稳定性 Evidence',
    };
    const first = await service.act(business, 'FL-DEMO-001', 'business', action);
    const replay = await service.act(business, 'FL-DEMO-001', 'business', action);
    assert.equal(replay.eventId, first.eventId);
    const after = await service.read(business, 'FL-DEMO-001', 'credit');
    assert.equal(after.defaultPerspective, 'credit');
    assert.equal(after.currentChatContext.entries.filter((entry) => entry.eventId === first.eventId).length, 1);
    assert.equal(after.integration.chat.status, 'connected');
    assert.equal(after.integration.sqlite.status, 'connected');
    assert.equal(after.provenance.source, 'shared-v3-sqlite');

    await assert.rejects(
      service.act(business, 'FL-DEMO-001', 'business', { ...action, message: '同 key 不同 payload' }),
      (error) => error.code === 'IDEMPOTENCY_CONFLICT',
    );
  });

  it('binds a named professional reject to T3 Context and Receipt while keeping model authority none', async () => {
    resetV3DemoRuntime();
    const runtime = getV3DemoRuntime();
    const businessDemo = createV3DemoSession('business-owner');
    const customerDemo = createV3DemoSession('external-customer');
    const supplierDemo = createV3DemoSession('external-supplier');

    const t1Evidence = runtime.acceptEvidence({
      ...runtimeActor(businessDemo),
      requestId: 'WB-T1-EVIDENCE',
      evidenceId: 'WB-EV-T1',
      evidenceType: 'business-fact-pack',
      sourceRef: 'synthetic://business/t1',
      contentHash: 'hash-wb-t1',
      processId: 'policy',
    });
    runtime.commitContext({
      ...runtimeActor(businessDemo),
      requestId: 'WB-T1-COMMIT',
      transitionCode: 'T1',
      expectedContextVersion: 'CTX-0000',
      evidenceReceiptIds: [t1Evidence.receiptId],
      rationale: '确认 T1 合成事实包',
    });
    await advanceCurrentRuns('WB-T1');

    const t2Evidence = runtime.acceptEvidence({
      ...runtimeActor(customerDemo),
      requestId: 'WB-T2-EVIDENCE',
      evidenceId: 'WB-EV-T2',
      evidenceType: 'customer-risk-fact',
      sourceRef: 'synthetic://customer/t2',
      contentHash: 'hash-wb-t2',
      processId: 'opportunity',
    });
    runtime.commitContext({
      ...runtimeActor(customerDemo),
      requestId: 'WB-T2-COMMIT',
      transitionCode: 'T2',
      expectedContextVersion: 'CTX-0001',
      evidenceReceiptIds: [t2Evidence.receiptId],
      rationale: '客户确认 T2 合成风险事实',
    });
    await advanceCurrentRuns('WB-T2');

    const customerT3 = runtime.acceptEvidence({
      ...runtimeActor(customerDemo),
      requestId: 'WB-T3-CUSTOMER',
      evidenceId: 'WB-EV-T3-CUSTOMER',
      evidenceType: 'customer-confirmation',
      sourceRef: 'synthetic://customer/t3',
      contentHash: 'hash-wb-t3-customer',
      processId: 'opportunity',
    });
    const supplierT3 = runtime.acceptEvidence({
      ...runtimeActor(supplierDemo),
      requestId: 'WB-T3-SUPPLIER',
      evidenceId: 'WB-EV-T3-SUPPLIER',
      evidenceType: 'supplier-device-confirmation',
      sourceRef: 'synthetic://supplier/t3',
      contentHash: 'hash-wb-t3-supplier',
      processId: 'commercial',
    });
    runtime.commitContext({
      ...runtimeActor(businessDemo),
      requestId: 'WB-T3-COMMIT',
      transitionCode: 'T3',
      expectedContextVersion: 'CTX-0002',
      evidenceReceiptIds: [customerT3.receiptId, supplierT3.receiptId],
      rationale: '业务确认客户与供应商 T3 合成批次',
    });
    await advanceCurrentRuns('WB-T3');

    const service = createWorkbenchService();
    const asset = workbenchSession('risk-asset');
    const before = await service.read(asset, 'FL-DEMO-001', 'asset');
    assert.equal(before.contextVersion, 'CTX-0003');
    const result = await service.act(asset, 'FL-DEMO-001', 'asset', {
      requestId: 'WB-ASSET-REJECT',
      expectedContextVersion: before.contextVersion,
      actionType: 'reject',
      rationale: '设备权属证据不足，拒绝当前候选',
      evidenceReceiptIds: [customerT3.receiptId],
    });
    assert.equal(result.authority, 'confirmed_human');
    assert.ok(result.receiptId);

    const projection = await service.read(asset, 'FL-DEMO-001', 'asset');
    const assetView = projection.professionalProjections.asset;
    assert.equal(assetView.humanGate.status, 'rejected');
    assert.equal(assetView.humanGate.receiptId, result.receiptId);
    assert.equal(assetView.humanGate.authority, 'confirmed_human');
    assert.equal(assetView.modelCandidate.authority, 'none');
    assert.equal(projection.integration.sqlite.status, 'connected');
  });
});
