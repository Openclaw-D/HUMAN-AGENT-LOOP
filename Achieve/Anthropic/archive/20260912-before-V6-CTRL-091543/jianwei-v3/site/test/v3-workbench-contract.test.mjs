import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { classifyWorkbenchError } from '../lib/v3-surfaces/workbench/errors.ts';
import { createWorkbenchService } from '../lib/v3-surfaces/workbench/service.ts';
import { V3_SCENARIO_CASES } from '../lib/v3-demo-scenario.ts';

const integration = {
  authorityRuntime: { status: 'connected', implementation: 'canonical-shared-sqlite', persistence: 'sqlite-local-demo' },
  chat: { status: 'connected', implementation: 'shared-v3-sqlite-chat' },
  sqlite: { status: 'connected', owner: 'V3 Shared Runtime', implementation: 'canonical-shared-sqlite' },
};

const business = { sessionId: 'BUSINESS', principalId: 'business-owner', roleApplicationId: 'business' };
const policy = { sessionId: 'POLICY', principalId: 'risk-policy', roleApplicationId: 'risk' };
const credit = { sessionId: 'CREDIT', principalId: 'risk-credit', roleApplicationId: 'risk' };

function snapshot(caseItem = V3_SCENARIO_CASES[0]) {
  return {
    caseItem: structuredClone(caseItem),
    runtimeEpoch: caseItem.caseTier === 'golden' ? 'RUNTIME-CONTRACT' : null,
    currentContext: caseItem.caseTier === 'golden' ? {
      runtimeEpoch: 'RUNTIME-CONTRACT',
      contextSeq: 3,
      contextVersion: 'CTX-0003',
      previousContextVersion: 'CTX-0002',
      transitionCode: 'T3',
      diffId: 'DIFF-3',
      sourceReceiptIds: ['EVIDENCE-1'],
    } : null,
    processRuns: [],
    receipts: [],
    events: [],
  };
}

function fakeAdapter() {
  const calls = { chat: [], gates: [] };
  return {
    calls,
    integration,
    async readCase(caseId) {
      const item = V3_SCENARIO_CASES.find((candidate) => candidate.caseId === caseId);
      if (!item) throw Object.assign(new Error('事项不存在'), { code: 'CASE_NOT_FOUND' });
      return snapshot(item);
    },
    async recordCoordinationAction(input) {
      calls.chat.push(structuredClone(input));
      return { eventId: `CHAT-${calls.chat.length}`, contextVersion: input.contextVersion, status: 'routed', authority: 'none' };
    },
    async recordProfessionalGate(input) {
      calls.gates.push(structuredClone(input));
      return {
        receiptId: `GATE-${calls.gates.length}`,
        eventId: `GATE-EVT-${calls.gates.length}`,
        contextVersion: input.expectedContextVersion,
        principalId: input.actor.principalId,
        processId: input.processId,
        status: input.decision,
      };
    },
  };
}

describe('V3 Case Workbench contract', () => {
  it('exposes one deterministic read route and one action route for each of the five entries', async () => {
    for (const perspective of ['business', 'policy', 'credit', 'commercial', 'asset']) {
      const readRoute = await readFile(new URL(
        `../app/api/v3/${perspective}/cases/[caseId]/workbench/route.ts`,
        import.meta.url,
      ), 'utf8');
      const actionRoute = await readFile(new URL(
        `../app/api/v3/${perspective}/cases/[caseId]/actions/route.ts`,
        import.meta.url,
      ), 'utf8');
      assert.match(readRoute, new RegExp(`handleWorkbenchGet\\(request, caseId, '${perspective}'\\)`));
      assert.match(actionRoute, new RegExp(`handleWorkbenchAction\\(request, caseId, '${perspective}'\\)`));
    }
  });

  it('returns one read model for all five entries and changes only default perspective', async () => {
    const adapter = fakeAdapter();
    const service = createWorkbenchService(adapter);
    const entries = ['business', 'policy', 'credit', 'commercial', 'asset'];
    const models = await Promise.all(entries.map((entry) => service.read(business, 'FL-DEMO-001', entry)));
    const normalized = models.map((model) => ({ ...model, defaultPerspective: 'normalized' }));
    for (const model of normalized.slice(1)) assert.deepEqual(model, normalized[0]);
    assert.deepEqual(models.map((model) => model.defaultPerspective), entries);
    assert.equal(models[0].integration.sqlite.status, 'connected');
  });

  it('allows only the six frozen business actions and records them as authority-none routes', async () => {
    const adapter = fakeAdapter();
    const service = createWorkbenchService(adapter);
    for (const actionType of ['initiate', 'organize', 'assign', 'remind', 'request-supplement', 'terminate']) {
      const result = await service.act(business, 'FL-DEMO-001', 'business', {
        requestId: `REQ-${actionType}`,
        expectedContextVersion: 'CTX-0003',
        actionType,
        targetPrincipalId: 'risk-credit',
        message: '请按当前 Context 处理',
      });
      assert.equal(result.authority, 'none');
      assert.equal(result.authoritativeStateChanged, false);
      assert.equal(result.receiptId, null);
    }
    assert.equal(adapter.calls.chat.length, 6);
  });

  it('enforces named professional RBAC and separates Evidence request from Human Gate', async () => {
    const adapter = fakeAdapter();
    const service = createWorkbenchService(adapter);
    await assert.rejects(
      service.act(credit, 'FL-DEMO-001', 'policy', {
        requestId: 'REQ-WRONG-PROFESSION',
        expectedContextVersion: 'CTX-0003',
        actionType: 'confirm',
        rationale: '不应允许',
        evidenceReceiptIds: ['EVIDENCE-1'],
      }),
      (error) => error.code === 'ACTION_SCOPE_DENIED',
    );
    const request = await service.act(policy, 'FL-DEMO-001', 'policy', {
      requestId: 'REQ-EVIDENCE',
      expectedContextVersion: 'CTX-0003',
      actionType: 'request-evidence',
      targetPrincipalId: 'business-owner',
      message: '请补充政策例外说明',
    });
    assert.equal(request.authority, 'none');
    assert.equal(adapter.calls.gates.length, 0);

    const gate = await service.act(policy, 'FL-DEMO-001', 'policy', {
      requestId: 'REQ-GATE',
      expectedContextVersion: 'CTX-0003',
      actionType: 'reject',
      rationale: '规则例外条件不成立',
      evidenceReceiptIds: ['EVIDENCE-1'],
    });
    assert.equal(gate.authority, 'confirmed_human');
    assert.equal(gate.receiptId, 'GATE-1');
    assert.equal(adapter.calls.gates[0].decision, 'reject');
  });

  it('keeps background actions and stale Context fail closed with zero writes', async () => {
    const adapter = fakeAdapter();
    const service = createWorkbenchService(adapter);
    await assert.rejects(
      service.act(business, 'FL-BG-001', 'business', {
        requestId: 'REQ-BG',
        expectedContextVersion: 'CTX-0003',
        actionType: 'assign',
        targetPrincipalId: 'risk-credit',
        message: '不应写入',
      }),
      (error) => error.code === 'BACKGROUND_CASE_READ_ONLY',
    );
    await assert.rejects(
      service.act(business, 'FL-DEMO-001', 'business', {
        requestId: 'REQ-STALE',
        expectedContextVersion: 'CTX-0002',
        actionType: 'assign',
        targetPrincipalId: 'risk-credit',
        message: '不应写入',
      }),
      (error) => error.code === 'CONTEXT_VERSION_CONFLICT',
    );
    assert.equal(adapter.calls.chat.length, 0);
    assert.equal(adapter.calls.gates.length, 0);
  });

  it('classifies shared busy/unavailable errors as retryable without retrying inside the service', () => {
    assert.deepEqual(
      classifyWorkbenchError(Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' })),
      { status: 503, retryable: true },
    );
    assert.deepEqual(
      classifyWorkbenchError(Object.assign(new Error('invalid'), { code: 'INVALID_INPUT' })),
      { status: null, retryable: false },
    );
  });
});
