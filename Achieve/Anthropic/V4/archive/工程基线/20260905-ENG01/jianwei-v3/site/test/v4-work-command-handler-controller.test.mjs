import assert from 'node:assert/strict';
import test from 'node:test';

import { createV4WorkCommandHandler } from '../lib/v4/work-command-handler.ts';
import { createInMemoryV4WorkStore } from '../lib/v4/work-store.ts';

const caseId = 'CTRL-HANDLER-CASE';
const attemptId = 'CTRL-HANDLER-ATTEMPT';
const actorId = 'CTRL-HANDLER-ACTOR';
const sessionId = 'CTRL-HANDLER-SESSION';
const policyVersion = 'CTRL-HANDLER-POLICY';
const organizationPath = ['group', 'credit'];

const opened = {
  eventId: 'CTRL-HANDLER-EVENT-1',
  sequence: 1,
  eventType: 'case_opened',
  caseId,
  attemptId,
  contextVersion: 'V4-CONTEXT-000003',
  actorId: 'CTRL-OPENER',
  organizationPath,
  rootAttemptId: attemptId,
  classification: {
    businessMode: 'direct',
    acquisitionSource: 'supplier_referral',
    reviewPath: 'exception',
    dueDiligenceMode: 'business_site',
  },
};

const existingEvidence = {
  eventId: 'CTRL-HANDLER-EVENT-2',
  sequence: 2,
  eventType: 'evidence_accepted',
  caseId,
  attemptId,
  contextVersion: 'V4-CONTEXT-000004',
  actorId,
  organizationPath,
  previousContextVersion: 'V4-CONTEXT-000003',
  newContextVersion: 'V4-CONTEXT-000004',
  evidenceId: 'CTRL-EVIDENCE-OLD',
  evidenceKind: 'business_license',
  evidenceReceiptId: 'CTRL-EVIDENCE-RECEIPT-OLD',
};

test('server-generated ContextVersion never reuses any historical Context identity', () => {
  const store = createInMemoryV4WorkStore({
    currentPolicyVersion: policyVersion,
    sessions: [{
      sessionId,
      actor: {
        actorId,
        kind: 'internal_human',
        organizationPath,
        externalInvitation: null,
      },
      roleAssignments: [],
      grants: [{
        grantId: 'CTRL-HANDLER-GRANT',
        actorId,
        action: { family: 'prepare', name: 'prepare_evidence_draft' },
        resourceType: 'case',
        resourceId: caseId,
        organizationScope: { mode: 'exact', organizationPath },
        policyVersion,
        invitationId: null,
      }],
      denies: [],
      presentedInvitationId: null,
    }],
    cases: [{ caseId, events: [opened, existingEvidence] }],
  });
  const execute = createV4WorkCommandHandler(store);
  const historicalContexts = new Set([
    opened.contextVersion,
    existingEvidence.contextVersion,
    existingEvidence.previousContextVersion,
    existingEvidence.newContextVersion,
  ]);

  const result = execute({
    sessionId,
    command: {
      requestId: 'CTRL-HANDLER-REQUEST',
      idempotencyKey: 'CTRL-HANDLER-IDEMPOTENCY',
      operation: 'accept_evidence',
      expectedContextVersion: existingEvidence.newContextVersion,
      payload: {
        caseId,
        evidenceId: 'CTRL-EVIDENCE-NEW',
        evidenceKind: 'tax_record',
      },
    },
  });

  assert.equal(historicalContexts.has(result.receipt.newContextVersion), false);
  assert.equal(result.projection.contextVersion, result.receipt.newContextVersion);
});
