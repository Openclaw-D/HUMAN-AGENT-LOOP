import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorizeOpportunityBusinessAction,
  buildOpportunityReadModel,
  createOpportunitySharedPort,
  opportunityEmptyState,
  opportunityErrorState,
  opportunityLoadingState,
  opportunityReadyState,
  sendOpportunityChatMessage,
} from '../lib/v3-surfaces/opportunity/index.ts';
import { createV3SharedRuntime } from '../lib/v3-runtime/shared-runtime.ts';
import {
  V3_SHARED_DEMO_CASES,
  V3_SHARED_SCENARIO_REF,
} from '../lib/v3-surfaces/shared/demo-fixtures.ts';

function session(principalId = 'business-owner', roleApplicationId = 'business') {
  return { sessionId: 'SESSION-OPPORTUNITY-TEST', principalId, roleApplicationId, invitation: null };
}

function harness() {
  let tick = 0;
  const runtime = createV3SharedRuntime({
    databasePath: ':memory:',
    now: () => `2026-08-30T00:00:${String(tick++).padStart(2, '0')}.000Z`,
  });
  return { runtime, port: createOpportunitySharedPort(runtime) };
}

test('projects deterministic Opportunity-grain models only from shared SQLite fixture IDs', (t) => {
  const { runtime, port } = harness();
  t.after(() => runtime.close());
  const actor = session();
  for (const fixture of V3_SHARED_DEMO_CASES) {
    const first = buildOpportunityReadModel(actor, `OPP-${fixture.caseId}`, port);
    const second = buildOpportunityReadModel(actor, `OPP-${fixture.caseId}`, port);
    assert.deepEqual(second, first);
    assert.equal(first.grain, 'Opportunity');
    assert.equal(first.caseId, fixture.caseId);
    assert.equal(first.title, fixture.label);
    assert.equal(first.stage, fixture.phase);
    assert.equal(first.nextAction, '未提供');
    assert.deepEqual(first.scenarioRef, V3_SHARED_SCENARIO_REF);
  }
});

test('keeps graph edges consistent and does not invent customer or supplier relationships', (t) => {
  const { runtime, port } = harness();
  t.after(() => runtime.close());
  const projection = buildOpportunityReadModel(session(), 'OPP-FL-DEMO-001', port);
  const nodeIds = new Set(projection.relationships.nodes.map((item) => item.nodeId));
  for (const edge of projection.relationships.edges) {
    assert.equal(nodeIds.has(edge.fromNodeId), true);
    assert.equal(nodeIds.has(edge.toNodeId), true);
  }
  assert.deepEqual(projection.relationships.nodes.map((item) => item.kind), [
    'customer', 'opportunity', 'supplier', 'case',
  ]);
  assert.deepEqual(projection.relationships.unavailableRelationships, ['customer', 'supplier']);
  assert.equal(projection.relationships.edges.some((item) => item.relationship === 'customer_for'), false);
  assert.equal(projection.relationships.edges.some((item) => item.relationship === 'supplier_for'), false);
  for (const kind of ['customer', 'supplier']) {
    const node = projection.relationships.nodes.find((item) => item.kind === kind);
    assert.deepEqual(node && { label: node.label, availability: node.availability }, {
      label: '未提供', availability: 'unavailable',
    });
  }
});

test('keeps absent material completeness unavailable instead of converting it to zero', (t) => {
  const { runtime, port } = harness();
  t.after(() => runtime.close());
  for (const fixture of V3_SHARED_DEMO_CASES) {
    const projection = buildOpportunityReadModel(session(), `OPP-${fixture.caseId}`, port);
    assert.deepEqual(projection.materials, {
      items: [],
      completeness: {
        availability: 'unavailable',
        value: null,
        display: '未提供',
        unit: 'evidence-coverage-band',
        valueClass: null,
        source: null,
        provenance: [],
        asOf: null,
      },
      emptyDisplay: '未提供',
    });
  }
});

test('allows six business orchestration actions but denies professional review and Gate', (t) => {
  const { runtime, port } = harness();
  t.after(() => runtime.close());
  for (const action of ['initiate', 'organize', 'assign', 'remind', 'supplement', 'terminate']) {
    assert.deepEqual(authorizeOpportunityBusinessAction({ actorRole: 'business', action }), {
      allowed: true,
      authority: 'orchestration-only',
    });
  }
  assert.throws(
    () => authorizeOpportunityBusinessAction({ actorRole: 'business', action: 'professional_review' }),
    { code: 'PROFESSIONAL_AUTHORITY_DENIED' },
  );
  assert.throws(
    () => authorizeOpportunityBusinessAction({ actorRole: 'business', action: 'professional_gate' }),
    { code: 'PROFESSIONAL_AUTHORITY_DENIED' },
  );
  assert.throws(
    () => authorizeOpportunityBusinessAction({ actorRole: 'credit', action: 'assign' }),
    { code: 'OPPORTUNITY_ACTION_DENIED' },
  );
  const projection = buildOpportunityReadModel(session(), 'OPP-FL-DEMO-001', port);
  assert.deepEqual(projection.responsibilityMatrix, [
    { role: 'business', responsibility: 'orchestrates', canSubmitProfessionalGate: false },
    { role: 'policy', responsibility: 'professional-judgment', canSubmitProfessionalGate: true },
    { role: 'credit', responsibility: 'professional-judgment', canSubmitProfessionalGate: true },
    { role: 'commercial', responsibility: 'professional-judgment', canSubmitProfessionalGate: true },
    { role: 'asset', responsibility: 'professional-judgment', canSubmitProfessionalGate: true },
  ]);
});

test('persists shared chat and shared JW/professional replies only as candidates with authority none', async (t) => {
  const { runtime, port } = harness();
  t.after(() => runtime.close());
  const result = await sendOpportunityChatMessage({
    session: session(),
    opportunityId: 'OPP-FL-DEMO-001',
    requestId: 'opportunity-chat-candidate-001',
    message: '@JW @信审 请检查当前材料缺口',
    port,
  });
  assert.equal(result.message.actorKind, 'human');
  assert.equal(result.message.authority, 'none');
  assert.deepEqual(result.candidates.map((item) => item.routedTo), ['jw', 'credit']);
  assert.equal(result.candidates.every((item) =>
    item.status === 'candidate' &&
    item.authority === 'none' &&
    item.disclaimer === 'AI candidate · authority none'), true);
  assert.equal(result.chatContext.source, 'shared-v3-sqlite-chat');
  assert.equal(result.chatContext.messages.some((item) => item.messageId === result.message.messageId), true);
  for (const candidate of result.candidates) {
    assert.equal(result.chatContext.messages.some((item) => item.messageId === candidate.candidateId), true);
  }
});

test('preserves shared idempotent replay and rejects same requestId with a different payload', async (t) => {
  const { runtime, port } = harness();
  t.after(() => runtime.close());
  const input = {
    session: session(),
    opportunityId: 'OPP-FL-DEMO-001',
    requestId: 'opportunity-idempotent-001',
    message: '@JW 检查当前上下文',
    port,
  };
  const beforeProjection = buildOpportunityReadModel(session(), input.opportunityId, port);
  const first = await sendOpportunityChatMessage(input);
  const replay = await sendOpportunityChatMessage(input);
  const afterProjection = buildOpportunityReadModel(session(), input.opportunityId, port);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.message.messageId, first.message.messageId);
  assert.equal(replay.receiptId, first.receiptId);
  assert.equal(replay.chatContext.messages.length, first.chatContext.messages.length);
  assert.notEqual(afterProjection.projectionVersion, beforeProjection.projectionVersion);
  assert.equal(afterProjection.chatContext.messages.length, first.chatContext.messages.length);
  await assert.rejects(
    sendOpportunityChatMessage({ ...input, message: '@JW 不同内容' }),
    { code: 'IDEMPOTENCY_CONFLICT' },
  );
});

test('fails closed for background writes, missing input, unknown IDs and invalid shared results', async (t) => {
  const { runtime, port } = harness();
  t.after(() => runtime.close());
  await assert.rejects(sendOpportunityChatMessage({
    session: session(), opportunityId: 'OPP-FL-BG-001', requestId: 'bg-write', message: '不应写入', port,
  }), { code: 'BACKGROUND_CASE_READ_ONLY' });
  await assert.rejects(sendOpportunityChatMessage({
    session: session(), opportunityId: 'OPP-FL-DEMO-001', requestId: 'empty', message: ' ', port,
  }), { code: 'INVALID_MESSAGE' });
  assert.throws(() => buildOpportunityReadModel(session(), 'OPP-FL-UNKNOWN-999', port), {
    code: 'OPPORTUNITY_NOT_FOUND',
  });

  const brokenPort = {
    ...port,
    async sendMessage(input) {
      const result = await port.sendMessage(input);
      return { ...result, message: { ...result.message, authority: 'confirmed' } };
    },
  };
  await assert.rejects(sendOpportunityChatMessage({
    session: session(),
    opportunityId: 'OPP-FL-DEMO-001',
    requestId: 'broken-shared-result',
    message: '@JW 检查',
    port: brokenPort,
  }), { code: 'SHARED_CHAT_CONTRACT_VIOLATION' });
});

test('uses the shared loading/ready/empty/error union without leaking data into failure states', () => {
  assert.deepEqual(opportunityLoadingState(), {
    status: 'loading', data: null, error: null, empty: null,
  });
  assert.deepEqual(opportunityReadyState({ id: 'OPP-1' }), {
    status: 'ready', data: { id: 'OPP-1' }, error: null, empty: null,
  });
  assert.deepEqual(opportunityEmptyState(), {
    status: 'empty', data: null, error: null, empty: { message: '未提供' },
  });
  assert.deepEqual(opportunityErrorState(Object.assign(new Error('共享投影不可用'), { code: 'SHARED_UNAVAILABLE' })), {
    status: 'error',
    data: null,
    error: { code: 'SHARED_UNAVAILABLE', message: '共享投影不可用', retryable: false },
    empty: null,
  });
});
