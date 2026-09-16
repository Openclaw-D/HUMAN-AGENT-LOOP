import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateCapabilityAdmission } from '../lib/v4/capability-admission.ts';
import { reduceCapabilityGovernance } from '../lib/v4/capability-governance-reducer.ts';

const CAPABILITY_ID = 'credit.material-gap-analyzer';
const VERSION = '1.0.0';
const SCOPE = ['group', 'credit'];

function envelope(eventType, governanceVersion) {
  return {
    eventType,
    eventId: `EVENT-${String(governanceVersion).padStart(3, '0')}`,
    capabilityId: CAPABILITY_ID,
    version: VERSION,
    governanceVersion,
    actorId: 'actor-governance-001',
    organizationScopePath: [...SCOPE],
  };
}

function registered(versionOverrides = {}) {
  return {
    ...envelope('version_registered', 1),
    definition: {
      capabilityId: CAPABILITY_ID,
      ownerActorId: 'actor-owner-001',
      ownerOrganizationUnitId: 'credit',
      kind: 'Analyzer',
      authority: 'none',
    },
    capabilityVersion: {
      capabilityId: CAPABILITY_ID,
      version: VERSION,
      definitionHash: 'sha256:definition-001',
      supportedStages: ['credit'],
      supportedBusinessModes: ['direct'],
      supportedReviewPaths: ['exception'],
      requiredEvidenceKinds: ['tax_record', 'business_license'],
      allowedOutputKinds: ['EvidenceDraft'],
      ...versionOverrides,
    },
  };
}

function governanceProjection(state = 'active', versionOverrides = {}) {
  const events = [registered(versionOverrides)];
  if (state !== 'draft') {
    events.push({ ...envelope('evaluation_passed', 2), evaluationId: 'EVALUATION-001' });
  }
  if (!['draft', 'evaluated'].includes(state)) {
    events.push({ ...envelope('approval_granted', 3), approvalReceiptId: 'APPROVAL-001' });
  }
  if (!['draft', 'evaluated', 'approved'].includes(state)) {
    events.push({ ...envelope('shadow_released', 4), approvalReceiptId: 'APPROVAL-001' });
  }
  if (!['draft', 'evaluated', 'approved', 'shadow'].includes(state)) {
    events.push({ ...envelope('activated', 5), releaseReceiptId: 'RELEASE-001' });
  }
  if (state === 'suspended') {
    events.push({ ...envelope('suspended', 6), reason: 'quality hold' });
  }
  if (state === 'rolled_back') {
    events.push({
      ...envelope('rolled_back', 6),
      rollbackReceiptId: 'ROLLBACK-001',
      targetVersion: '0.9.0',
    });
  }
  if (state === 'retired') {
    events.push({ ...envelope('retired', 6), retirementReceiptId: 'RETIREMENT-001' });
  }
  return reduceCapabilityGovernance(events);
}

function cycledProjection(state) {
  const events = [
    registered(),
    { ...envelope('evaluation_passed', 2), evaluationId: 'EVALUATION-001' },
    { ...envelope('approval_granted', 3), approvalReceiptId: 'APPROVAL-001' },
    { ...envelope('shadow_released', 4), approvalReceiptId: 'APPROVAL-001' },
    { ...envelope('activated', 5), releaseReceiptId: 'RELEASE-001' },
    { ...envelope('suspended', 6), reason: 'quality hold' },
    { ...envelope('resumed', 7), releaseReceiptId: 'RELEASE-001' },
  ];
  if (state === 'suspended') {
    events.push({ ...envelope('suspended', 8), reason: 'second quality hold' });
  }
  return reduceCapabilityGovernance(events);
}

function admissionRequest(overrides = {}) {
  const projection = overrides.governanceProjection ?? governanceProjection('active');
  return {
    caseId: 'CASE-001',
    attemptId: 'ATTEMPT-001',
    contextVersion: 'CONTEXT-007',
    currentContextVersion: 'CONTEXT-007',
    businessMode: 'direct',
    reviewPath: 'exception',
    currentStage: 'credit',
    caseOrganizationPath: ['group', 'credit', 'case-team'],
    availableEvidenceKinds: ['business_license', 'tax_record'],
    requestedOutputKind: 'EvidenceDraft',
    expectedCapabilityId: CAPABILITY_ID,
    expectedCapabilityVersion: VERSION,
    expectedGovernanceVersion: projection.governanceVersion,
    governanceProjection: projection,
    ...overrides,
  };
}

function assertReason(input, outcome, reasonCode) {
  const result = evaluateCapabilityAdmission(input);
  assert.equal(result.outcome, outcome);
  assert.equal(result.reasonCode, reasonCode);
  assert.equal(result.authority, 'none');
  return result;
}

test('exact active, fresh, in-scope and evidence-complete request is eligible with bound identity', () => {
  const input = admissionRequest();
  const before = structuredClone(input);
  const result = assertReason(input, 'eligible', 'ELIGIBLE');

  assert.deepEqual(result, {
    outcome: 'eligible',
    reasonCode: 'ELIGIBLE',
    caseId: 'CASE-001',
    attemptId: 'ATTEMPT-001',
    contextVersion: 'CONTEXT-007',
    capabilityId: CAPABILITY_ID,
    version: VERSION,
    governanceVersion: 5,
    requestedOutputKind: 'EvidenceDraft',
    authority: 'none',
    missingEvidenceKinds: [],
  });
  assert.deepEqual(input, before);
  assert.equal(result instanceof Promise, false);
});

test('fixed priority pairs keep every earlier failure ahead of later failures', () => {
  const invalidProjection = structuredClone(governanceProjection('active'));
  invalidProjection.definition.authority = 'write';
  const invalidInput = { ...admissionRequest({ governanceProjection: invalidProjection }), extra: true };
  assertReason(invalidInput, 'unknown', 'INVALID_ADMISSION_INPUT');

  assertReason(
    admissionRequest({ governanceProjection: invalidProjection, expectedGovernanceVersion: 999 }),
    'unknown',
    'INVALID_GOVERNANCE_PROJECTION',
  );
  assertReason(
    admissionRequest({
      governanceProjection: governanceProjection('suspended'),
      expectedGovernanceVersion: 5,
    }),
    'unknown',
    'STALE_GOVERNANCE',
  );
  assertReason(
    admissionRequest({
      governanceProjection: governanceProjection('draft'),
      currentContextVersion: 'CONTEXT-008',
    }),
    'denied',
    'CAPABILITY_INACTIVE',
  );
  assertReason(
    admissionRequest({ currentContextVersion: 'CONTEXT-008', caseOrganizationPath: ['sibling'] }),
    'unknown',
    'CASE_CONTEXT_MISMATCH',
  );
  assertReason(
    admissionRequest({ caseOrganizationPath: ['sibling'], currentStage: 'asset' }),
    'denied',
    'ORGANIZATION_SCOPE_DENIED',
  );
  assertReason(
    admissionRequest({ currentStage: 'asset', businessMode: 'new_return' }),
    'ineligible',
    'STAGE_NOT_SUPPORTED',
  );
  assertReason(
    admissionRequest({ businessMode: 'new_return', reviewPath: 'standard' }),
    'ineligible',
    'BUSINESS_MODE_NOT_SUPPORTED',
  );
  assertReason(
    admissionRequest({ reviewPath: 'standard', availableEvidenceKinds: [] }),
    'ineligible',
    'REVIEW_PATH_NOT_SUPPORTED',
  );
  assertReason(
    admissionRequest({ availableEvidenceKinds: [], requestedOutputKind: 'CandidateDraft' }),
    'ineligible',
    'REQUIRED_EVIDENCE_MISSING',
  );
  assertReason(
    admissionRequest({ requestedOutputKind: 'CandidateDraft' }),
    'denied',
    'OUTPUT_NOT_ALLOWED',
  );
});

test('invalid reducer projections, corrupt snapshots and fake active claims remain unknown', () => {
  assertReason(
    admissionRequest({ governanceProjection: reduceCapabilityGovernance([]), expectedGovernanceVersion: 1 }),
    'unknown',
    'INVALID_GOVERNANCE_PROJECTION',
  );

  for (const mutate of [
    (projection) => { projection.definition = null; },
    (projection) => { projection.invalidReason = 'MALFORMED_EVENT'; },
    (projection) => { projection.capabilityVersion.capabilityId = 'other-capability'; },
    (projection) => { projection.releaseReceiptId = null; },
    (projection) => { projection.eventCount = 4; },
  ]) {
    const projection = structuredClone(governanceProjection('active'));
    mutate(projection);
    assertReason(
      admissionRequest({ governanceProjection: projection }),
      'unknown',
      'INVALID_GOVERNANCE_PROJECTION',
    );
  }

  const selfAttestedActive = governanceProjection('draft');
  selfAttestedActive.state = 'active';
  assertReason(
    admissionRequest({ governanceProjection: selfAttestedActive }),
    'unknown',
    'INVALID_GOVERNANCE_PROJECTION',
  );
  assertReason(
    admissionRequest({ governanceProjection: { active: true }, expectedGovernanceVersion: 1 }),
    'unknown',
    'INVALID_ADMISSION_INPUT',
  );
});

test('lifecycle depth must be reachable under reducer transitions before admission', () => {
  const impossibleDepths = [
    ['draft', 2],
    ['evaluated', 1],
    ['approved', 2],
    ['shadow', 3],
    ['active', 1],
    ['active', 6],
    ['suspended', 5],
    ['suspended', 7],
    ['rolled_back', 5],
    ['retired', 3],
  ];
  for (const [state, depth] of impossibleDepths) {
    const projection = governanceProjection(state);
    projection.governanceVersion = depth;
    projection.eventCount = depth;
    assertReason(
      admissionRequest({ governanceProjection: projection }),
      'unknown',
      'INVALID_GOVERNANCE_PROJECTION',
    );
  }

  const resumedActive = cycledProjection('active');
  assert.equal(resumedActive.governanceVersion, 7);
  assertReason(
    admissionRequest({ governanceProjection: resumedActive }),
    'eligible',
    'ELIGIBLE',
  );
  const resuspended = cycledProjection('suspended');
  assert.equal(resuspended.governanceVersion, 8);
  assertReason(
    admissionRequest({ governanceProjection: resuspended }),
    'denied',
    'CAPABILITY_SUSPENDED',
  );
});

test('stale governance and Case context or capability identity mismatches are distinct', () => {
  assertReason(admissionRequest({ expectedGovernanceVersion: 4 }), 'unknown', 'STALE_GOVERNANCE');
  for (const overrides of [
    { expectedCapabilityId: 'other-capability' },
    { expectedCapabilityVersion: '2.0.0' },
    { currentContextVersion: 'CONTEXT-008' },
  ]) {
    assertReason(admissionRequest(overrides), 'unknown', 'CASE_CONTEXT_MISMATCH');
  }
});

test('suspended, inactive, rolled-back and retired states map to frozen denied outcomes', () => {
  assertReason(
    admissionRequest({ governanceProjection: governanceProjection('suspended') }),
    'denied',
    'CAPABILITY_SUSPENDED',
  );
  for (const state of ['draft', 'evaluated', 'approved', 'shadow']) {
    assertReason(
      admissionRequest({ governanceProjection: governanceProjection(state) }),
      'denied',
      'CAPABILITY_INACTIVE',
    );
  }
  for (const state of ['rolled_back', 'retired']) {
    assertReason(
      admissionRequest({ governanceProjection: governanceProjection(state) }),
      'denied',
      'CAPABILITY_RETIRED',
    );
  }
});

test('organization scope allows equality and descendants but denies siblings and ancestors', () => {
  for (const path of [SCOPE, [...SCOPE, 'case-team'], [...SCOPE, 'case-team', 'work-item']]) {
    assertReason(admissionRequest({ caseOrganizationPath: path }), 'eligible', 'ELIGIBLE');
  }
  for (const path of [['group'], ['group', 'risk'], ['other', 'credit']]) {
    assertReason(
      admissionRequest({ caseOrganizationPath: path }),
      'denied',
      'ORGANIZATION_SCOPE_DENIED',
    );
  }
});

test('typed support mismatches are independently ineligible in stage, mode, path order', () => {
  assertReason(admissionRequest({ currentStage: 'asset' }), 'ineligible', 'STAGE_NOT_SUPPORTED');
  assertReason(
    admissionRequest({ businessMode: 'existing_return' }),
    'ineligible',
    'BUSINESS_MODE_NOT_SUPPORTED',
  );
  assertReason(
    admissionRequest({ reviewPath: 'standard' }),
    'ineligible',
    'REVIEW_PATH_NOT_SUPPORTED',
  );
  assertReason(
    admissionRequest({ currentStage: 'asset', businessMode: 'new_return', reviewPath: 'standard' }),
    'ineligible',
    'STAGE_NOT_SUPPORTED',
  );
});

test('missing evidence uses canonical set difference and output denial waits for evidence', () => {
  const missing = assertReason(
    admissionRequest({ availableEvidenceKinds: ['unrelated'], requestedOutputKind: 'CandidateDraft' }),
    'ineligible',
    'REQUIRED_EVIDENCE_MISSING',
  );
  assert.deepEqual(missing.missingEvidenceKinds, ['business_license', 'tax_record']);

  const outputDenied = assertReason(
    admissionRequest({ requestedOutputKind: 'CandidateDraft' }),
    'denied',
    'OUTPUT_NOT_ALLOWED',
  );
  assert.deepEqual(outputDenied.missingEvidenceKinds, []);
});

test('request and nested data shapes reject extras, symbols, accessors and coercion', () => {
  const candidates = [];
  candidates.push({ ...admissionRequest(), extra: true });

  const symbol = admissionRequest();
  symbol[Symbol('hidden')] = true;
  candidates.push(symbol);

  const nonEnumerable = admissionRequest();
  Object.defineProperty(nonEnumerable, 'hidden', { value: true, enumerable: false });
  candidates.push(nonEnumerable);

  const dangerous = admissionRequest();
  Object.defineProperty(dangerous, '__proto__', { value: true, enumerable: true });
  candidates.push(dangerous);

  const numeric = admissionRequest({ expectedGovernanceVersion: '5' });
  candidates.push(numeric);

  const nestedExtra = admissionRequest();
  nestedExtra.governanceProjection.definition.extra = true;
  candidates.push(nestedExtra);

  const requestArrayExtra = admissionRequest();
  requestArrayExtra.availableEvidenceKinds.extra = true;
  candidates.push(requestArrayExtra);

  const projectionArrayExtra = admissionRequest();
  projectionArrayExtra.governanceProjection.capabilityVersion.requiredEvidenceKinds.extra = true;
  candidates.push(projectionArrayExtra);

  for (const candidate of candidates) {
    const result = assertReason(candidate, 'unknown', 'INVALID_ADMISSION_INPUT');
    assert.equal(result.caseId, null);
    assert.equal(result.capabilityId, null);
    assert.equal(result.governanceVersion, 0);
  }

  let reads = 0;
  const accessor = admissionRequest();
  Object.defineProperty(accessor, 'caseId', {
    enumerable: true,
    get() {
      reads += 1;
      return 'CASE-001';
    },
  });
  assertReason(accessor, 'unknown', 'INVALID_ADMISSION_INPUT');
  assert.equal(reads, 0);
});

test('request opaque values normalize but typed enums stay exact and corrupt projections are not repaired', () => {
  const result = assertReason(admissionRequest({
    caseId: ' CASE-001 ',
    attemptId: ' ATTEMPT-001 ',
    contextVersion: ' CONTEXT-007 ',
    currentContextVersion: ' CONTEXT-007 ',
    caseOrganizationPath: [' group ', ' credit ', ' case-team '],
    availableEvidenceKinds: [' tax_record ', 'business_license', 'tax_record'],
    expectedCapabilityId: ` ${CAPABILITY_ID} `,
    expectedCapabilityVersion: ` ${VERSION} `,
  }), 'eligible', 'ELIGIBLE');
  assert.equal(result.caseId, 'CASE-001');
  assert.equal(result.attemptId, 'ATTEMPT-001');
  assert.equal(result.contextVersion, 'CONTEXT-007');

  for (const overrides of [
    { currentStage: ' credit ' },
    { businessMode: ' direct ' },
    { reviewPath: ' exception ' },
    { requestedOutputKind: ' EvidenceDraft ' },
  ]) {
    assertReason(admissionRequest(overrides), 'unknown', 'INVALID_ADMISSION_INPUT');
  }

  const corruptProjection = structuredClone(governanceProjection('active'));
  corruptProjection.organizationScopePath[1] = ' credit ';
  assertReason(
    admissionRequest({ governanceProjection: corruptProjection }),
    'unknown',
    'INVALID_GOVERNANCE_PROJECTION',
  );
  const corruptEvidence = structuredClone(governanceProjection('active'));
  corruptEvidence.capabilityVersion.requiredEvidenceKinds[1] = ' tax_record ';
  assertReason(
    admissionRequest({ governanceProjection: corruptEvidence }),
    'unknown',
    'INVALID_GOVERNANCE_PROJECTION',
  );
});

test('decisions are deterministic deep clones and input or output mutation cannot leak', () => {
  const pristine = admissionRequest({ availableEvidenceKinds: [] });
  const input = structuredClone(pristine);
  const before = structuredClone(input);
  const first = evaluateCapabilityAdmission(input);
  const second = evaluateCapabilityAdmission(input);

  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(first.missingEvidenceKinds, second.missingEvidenceKinds);
  assert.deepEqual(input, before);

  first.missingEvidenceKinds.push('mutated-output');
  assert.deepEqual(evaluateCapabilityAdmission(pristine), second);

  input.availableEvidenceKinds.push('business_license', 'tax_record');
  input.governanceProjection.capabilityVersion.requiredEvidenceKinds.push('mutated-input');
  assert.deepEqual(evaluateCapabilityAdmission(pristine), second);
});

test('malformed values never throw and return one synchronous deterministic null binding', () => {
  const expected = {
    outcome: 'unknown',
    reasonCode: 'INVALID_ADMISSION_INPUT',
    caseId: null,
    attemptId: null,
    contextVersion: null,
    capabilityId: null,
    version: null,
    governanceVersion: 0,
    requestedOutputKind: null,
    authority: 'none',
    missingEvidenceKinds: [],
  };
  for (const value of [null, undefined, [], {}, 'request', 42]) {
    const result = evaluateCapabilityAdmission(value);
    assert.deepEqual(result, expected);
    assert.equal(result instanceof Promise, false);
  }
});
