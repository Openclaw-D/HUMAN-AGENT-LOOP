import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateCapabilityAdmission } from '../lib/v4/capability-admission.ts';
import { reduceCapabilityGovernance } from '../lib/v4/capability-governance-reducer.ts';

const CAPABILITY_ID = 'credit.controller-check';
const VERSION = '1.0.0';
const SCOPE = ['group', 'credit'];

function event(eventType, governanceVersion, fields = {}) {
  return {
    eventType,
    eventId: `EVENT-${governanceVersion}`,
    capabilityId: CAPABILITY_ID,
    version: VERSION,
    governanceVersion,
    actorId: 'actor-governance',
    organizationScopePath: [...SCOPE],
    ...fields,
  };
}

function activeProjection() {
  return reduceCapabilityGovernance([
    event('version_registered', 1, {
      definition: {
        capabilityId: CAPABILITY_ID,
        ownerActorId: 'actor-owner',
        ownerOrganizationUnitId: 'credit',
        kind: 'Analyzer',
        authority: 'none',
      },
      capabilityVersion: {
        capabilityId: CAPABILITY_ID,
        version: VERSION,
        definitionHash: 'sha256:controller',
        supportedStages: ['credit'],
        supportedBusinessModes: ['direct'],
        supportedReviewPaths: ['standard'],
        requiredEvidenceKinds: [],
        allowedOutputKinds: ['CandidateDraft'],
      },
    }),
    event('evaluation_passed', 2, { evaluationId: 'EVALUATION-1' }),
    event('approval_granted', 3, { approvalReceiptId: 'APPROVAL-1' }),
    event('shadow_released', 4, { approvalReceiptId: 'APPROVAL-1' }),
    event('activated', 5, { releaseReceiptId: 'RELEASE-1' }),
  ]);
}

function admissionRequest(governanceProjection) {
  return {
    caseId: 'CASE-1',
    attemptId: 'ATTEMPT-1',
    contextVersion: 'CONTEXT-1',
    currentContextVersion: 'CONTEXT-1',
    businessMode: 'direct',
    reviewPath: 'standard',
    currentStage: 'credit',
    caseOrganizationPath: [...SCOPE, 'team-a'],
    availableEvidenceKinds: [],
    requestedOutputKind: 'CandidateDraft',
    expectedCapabilityId: CAPABILITY_ID,
    expectedCapabilityVersion: VERSION,
    expectedGovernanceVersion: governanceProjection.governanceVersion,
    governanceProjection,
  };
}

test('controller: an active projection with impossible lifecycle depth is rejected as unverified', () => {
  const impossible = activeProjection();
  impossible.governanceVersion = 1;
  impossible.eventCount = 1;

  const decision = evaluateCapabilityAdmission(admissionRequest(impossible));
  assert.equal(decision.outcome, 'unknown');
  assert.equal(decision.reasonCode, 'INVALID_GOVERNANCE_PROJECTION');
});
