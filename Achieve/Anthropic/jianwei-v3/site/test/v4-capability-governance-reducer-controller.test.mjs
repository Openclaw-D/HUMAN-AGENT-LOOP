import assert from 'node:assert/strict';
import test from 'node:test';

import { reduceCapabilityGovernance } from '../lib/v4/capability-governance-reducer.ts';

function registered(overrides = {}) {
  return {
    eventType: 'version_registered',
    eventId: ' EVENT-001 ',
    capabilityId: ' capability.credit-review ',
    version: ' 1.0.0 ',
    governanceVersion: 1,
    actorId: ' actor-owner ',
    organizationScopePath: [' group ', ' credit '],
    definition: {
      capabilityId: ' capability.credit-review ',
      ownerActorId: ' actor-owner ',
      ownerOrganizationUnitId: ' credit ',
      kind: ' Analyzer ',
      authority: 'none',
    },
    capabilityVersion: {
      capabilityId: ' capability.credit-review ',
      version: ' 1.0.0 ',
      definitionHash: ' sha256:definition ',
      supportedStages: ['credit'],
      supportedBusinessModes: ['direct'],
      supportedReviewPaths: ['standard'],
      requiredEvidenceKinds: [' tax_record ', 'business_license', 'tax_record'],
      allowedOutputKinds: ['EvidenceDraft'],
    },
    ...overrides,
  };
}

test('controller: opaque identifiers and scope segments are trimmed before replay comparison', () => {
  const events = [
    registered(),
    {
      eventType: 'evaluation_passed',
      eventId: 'EVENT-002',
      capabilityId: 'capability.credit-review',
      version: '1.0.0',
      governanceVersion: 2,
      actorId: 'actor-evaluator',
      organizationScopePath: ['group', 'credit'],
      evaluationId: ' EVALUATION-001 ',
    },
  ];

  const projection = reduceCapabilityGovernance(events);
  assert.equal(projection.state, 'evaluated');
  assert.equal(projection.capabilityId, 'capability.credit-review');
  assert.equal(projection.version, '1.0.0');
  assert.deepEqual(projection.organizationScopePath, ['group', 'credit']);
  assert.equal(projection.definition.ownerActorId, 'actor-owner');
  assert.equal(projection.definition.kind, 'Analyzer');
  assert.equal(projection.evaluationId, 'EVALUATION-001');
  assert.deepEqual(projection.capabilityVersion.requiredEvidenceKinds, [
    'business_license',
    'tax_record',
  ]);
});

test('controller: duplicate event ids are detected after canonical trimming', () => {
  const events = [
    registered(),
    {
      eventType: 'evaluation_passed',
      eventId: 'EVENT-001',
      capabilityId: 'capability.credit-review',
      version: '1.0.0',
      governanceVersion: 2,
      actorId: 'actor-evaluator',
      organizationScopePath: ['group', 'credit'],
      evaluationId: 'EVALUATION-001',
    },
  ];

  const projection = reduceCapabilityGovernance(events);
  assert.equal(projection.state, 'invalid');
  assert.equal(projection.invalidReason, 'DUPLICATE_EVENT_ID');
  assert.equal(projection.invalidEventIndex, 1);
});
