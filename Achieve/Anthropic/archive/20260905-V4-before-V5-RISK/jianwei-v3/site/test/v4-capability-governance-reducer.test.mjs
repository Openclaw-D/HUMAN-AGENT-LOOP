import assert from 'node:assert/strict';
import test from 'node:test';

import { reduceCapabilityGovernance } from '../lib/v4/capability-governance-reducer.ts';

const CAPABILITY_ID = 'credit.material-gap-analyzer';
const VERSION = '1.0.0';
const SCOPE = ['group', 'division-a', 'credit-team'];
const APPROVAL_ID = 'APPROVAL-001';
const RELEASE_ID = 'RELEASE-001';

function definition(overrides = {}) {
  return {
    capabilityId: CAPABILITY_ID,
    ownerActorId: 'actor-owner-001',
    ownerOrganizationUnitId: 'credit-team',
    kind: 'Analyzer',
    authority: 'none',
    ...overrides,
  };
}

function capabilityVersion(overrides = {}) {
  return {
    capabilityId: CAPABILITY_ID,
    version: VERSION,
    definitionHash: 'sha256:definition-001',
    supportedStages: ['credit', 'business', 'credit'],
    supportedBusinessModes: ['new_return', 'direct', 'direct'],
    supportedReviewPaths: ['standard', 'exception', 'standard'],
    requiredEvidenceKinds: ['tax_record', 'business_license', 'tax_record'],
    allowedOutputKinds: ['EvidenceDraft', 'CandidateDraft', 'EvidenceDraft'],
    ...overrides,
  };
}

function envelope(eventType, governanceVersion, overrides = {}) {
  return {
    eventType,
    eventId: `EVENT-${String(governanceVersion).padStart(3, '0')}`,
    capabilityId: CAPABILITY_ID,
    version: VERSION,
    governanceVersion,
    actorId: 'actor-governance-001',
    organizationScopePath: [...SCOPE],
    ...overrides,
  };
}

function registered(overrides = {}) {
  return {
    ...envelope('version_registered', 1),
    definition: definition(),
    capabilityVersion: capabilityVersion(),
    ...overrides,
  };
}

function nextEvent(history, eventType, overrides = {}) {
  const governanceVersion = history.length + 1;
  const base = envelope(eventType, governanceVersion);
  switch (eventType) {
    case 'version_registered':
      return { ...base, definition: definition(), capabilityVersion: capabilityVersion(), ...overrides };
    case 'evaluation_passed':
      return { ...base, evaluationId: 'EVALUATION-001', ...overrides };
    case 'approval_granted':
    case 'shadow_released':
      return { ...base, approvalReceiptId: APPROVAL_ID, ...overrides };
    case 'activated':
    case 'resumed':
      return { ...base, releaseReceiptId: RELEASE_ID, ...overrides };
    case 'suspended':
      return { ...base, reason: 'quality signal below threshold', ...overrides };
    case 'rolled_back':
      return {
        ...base,
        rollbackReceiptId: 'ROLLBACK-001',
        targetVersion: '0.9.0',
        ...overrides,
      };
    case 'retired':
      return { ...base, retirementReceiptId: 'RETIREMENT-001', ...overrides };
    default:
      throw new Error(`unknown event type: ${eventType}`);
  }
}

function append(history, eventType, overrides = {}) {
  return [...history, nextEvent(history, eventType, overrides)];
}

function historyForState(state) {
  let history = [registered()];
  if (state === 'draft') return history;
  history = append(history, 'evaluation_passed');
  if (state === 'evaluated') return history;
  history = append(history, 'approval_granted');
  if (state === 'approved') return history;
  history = append(history, 'shadow_released');
  if (state === 'shadow') return history;
  history = append(history, 'activated');
  if (state === 'active') return history;
  if (state === 'suspended') return append(history, 'suspended');
  if (state === 'rolled_back') return append(history, 'rolled_back');
  if (state === 'retired') return append(historyForState('approved'), 'retired');
  throw new Error(`unsupported state: ${state}`);
}

function activeHistory() {
  return historyForState('active');
}

function assertInvalid(events, reason) {
  const projection = reduceCapabilityGovernance(events);
  assert.equal(projection.state, 'invalid');
  assert.equal(projection.invalidReason, reason);
  assert.equal(projection.capabilityId, null);
  assert.equal(projection.eventCount, 0);
  return projection;
}

test('full replay rebuilds exact active identity, scope, snapshots and lineage', () => {
  const history = activeHistory();
  const before = structuredClone(history);
  const result = reduceCapabilityGovernance(history);

  assert.equal(result instanceof Promise, false);
  assert.equal(result.state, 'active');
  assert.equal(result.invalidReason, null);
  assert.equal(result.capabilityId, CAPABILITY_ID);
  assert.equal(result.version, VERSION);
  assert.equal(result.governanceVersion, 5);
  assert.deepEqual(result.organizationScopePath, SCOPE);
  assert.deepEqual(result.definition, definition());
  assert.equal(result.evaluationId, 'EVALUATION-001');
  assert.equal(result.approvalReceiptId, APPROVAL_ID);
  assert.equal(result.releaseReceiptId, RELEASE_ID);
  assert.equal(result.lastEventId, 'EVENT-005');
  assert.equal(result.eventCount, 5);
  assert.deepEqual(history, before);
});

test('opaque identifiers are trimmed before storage, lineage and duplicate comparison', () => {
  const paddedIdentity = {
    capabilityId: ` ${CAPABILITY_ID} `,
    version: ` ${VERSION} `,
    actorId: ' actor-governance-001 ',
    organizationScopePath: SCOPE.map((segment) => ` ${segment} `),
  };
  let history = [registered({
    ...paddedIdentity,
    eventId: ' EVENT-001 ',
    definition: definition({
      capabilityId: ` ${CAPABILITY_ID} `,
      ownerActorId: ' actor-owner-001 ',
      ownerOrganizationUnitId: ' credit-team ',
      kind: ' Analyzer ',
    }),
    capabilityVersion: capabilityVersion({
      capabilityId: ` ${CAPABILITY_ID} `,
      version: ` ${VERSION} `,
      definitionHash: ' sha256:definition-001 ',
      requiredEvidenceKinds: [' tax_record ', 'business_license', 'tax_record'],
    }),
  })];
  history = append(history, 'evaluation_passed', {
    ...paddedIdentity,
    eventId: ' EVENT-002 ',
    evaluationId: ' EVALUATION-001 ',
  });
  history = append(history, 'approval_granted', {
    ...paddedIdentity,
    eventId: ' EVENT-003 ',
    approvalReceiptId: ` ${APPROVAL_ID} `,
  });
  history = append(history, 'shadow_released', {
    ...paddedIdentity,
    eventId: ' EVENT-004 ',
    approvalReceiptId: ` ${APPROVAL_ID} `,
  });
  history = append(history, 'activated', {
    ...paddedIdentity,
    eventId: ' EVENT-005 ',
    releaseReceiptId: ` ${RELEASE_ID} `,
  });
  history = append(history, 'suspended', {
    ...paddedIdentity,
    eventId: ' EVENT-006 ',
    reason: ' quality signal below threshold ',
  });
  history = append(history, 'resumed', {
    ...paddedIdentity,
    eventId: ' EVENT-007 ',
    releaseReceiptId: ` ${RELEASE_ID} `,
  });
  history = append(history, 'suspended', {
    ...paddedIdentity,
    eventId: ' EVENT-008 ',
    reason: ' second suspension ',
  });
  history = append(history, 'rolled_back', {
    ...paddedIdentity,
    eventId: ' EVENT-009 ',
    rollbackReceiptId: ' ROLLBACK-001 ',
    targetVersion: ' 0.9.0 ',
  });
  history = append(history, 'retired', {
    ...paddedIdentity,
    eventId: ' EVENT-010 ',
    retirementReceiptId: ' RETIREMENT-001 ',
  });

  const projection = reduceCapabilityGovernance(history);
  assert.equal(projection.state, 'retired');
  assert.equal(projection.capabilityId, CAPABILITY_ID);
  assert.equal(projection.version, VERSION);
  assert.deepEqual(projection.organizationScopePath, SCOPE);
  assert.deepEqual(projection.definition, definition());
  assert.equal(projection.capabilityVersion.definitionHash, 'sha256:definition-001');
  assert.deepEqual(projection.capabilityVersion.requiredEvidenceKinds, [
    'business_license',
    'tax_record',
  ]);
  assert.equal(projection.evaluationId, 'EVALUATION-001');
  assert.equal(projection.approvalReceiptId, APPROVAL_ID);
  assert.equal(projection.releaseReceiptId, RELEASE_ID);
  assert.equal(projection.suspensionReason, 'second suspension');
  assert.equal(projection.rollbackReceiptId, 'ROLLBACK-001');
  assert.equal(projection.rollbackTargetVersion, '0.9.0');
  assert.equal(projection.retirementReceiptId, 'RETIREMENT-001');
  assert.equal(projection.lastEventId, 'EVENT-010');

  assertInvalid([
    registered({ eventId: ' EVENT-001 ' }),
    nextEvent([registered()], 'evaluation_passed', { eventId: 'EVENT-001' }),
  ], 'DUPLICATE_EVENT_ID');
});

test('suspend/resume, rollback from active or suspended, and retirement preserve lineage', () => {
  const suspended = append(activeHistory(), 'suspended');
  const resumed = append(suspended, 'resumed');
  const resumedProjection = reduceCapabilityGovernance(resumed);
  assert.equal(resumedProjection.state, 'active');
  assert.equal(resumedProjection.releaseReceiptId, RELEASE_ID);
  assert.equal(resumedProjection.suspensionReason, 'quality signal below threshold');

  for (const base of [activeHistory(), suspended]) {
    const rolledBack = reduceCapabilityGovernance(append(base, 'rolled_back'));
    assert.equal(rolledBack.state, 'rolled_back');
    assert.equal(rolledBack.rollbackReceiptId, 'ROLLBACK-001');
    assert.equal(rolledBack.rollbackTargetVersion, '0.9.0');
  }

  for (const state of ['approved', 'shadow', 'active', 'suspended', 'rolled_back']) {
    const retired = reduceCapabilityGovernance(append(historyForState(state), 'retired'));
    assert.equal(retired.state, 'retired', `retirement from ${state}`);
    assert.equal(retired.retirementReceiptId, 'RETIREMENT-001');
  }
});

test('duplicate event, non-contiguous version, identity and scope mismatches fail closed', () => {
  const draft = [registered()];
  assertInvalid(
    append(draft, 'evaluation_passed', { eventId: draft[0].eventId }),
    'DUPLICATE_EVENT_ID',
  );
  assertInvalid(
    append(draft, 'evaluation_passed', { governanceVersion: 3 }),
    'NON_CONTIGUOUS_GOVERNANCE_VERSION',
  );
  assertInvalid(
    append(draft, 'evaluation_passed', { capabilityId: 'capability-other' }),
    'IDENTITY_MISMATCH',
  );
  assertInvalid(
    append(draft, 'evaluation_passed', { version: '2.0.0' }),
    'IDENTITY_MISMATCH',
  );
  assertInvalid(
    append(draft, 'evaluation_passed', { organizationScopePath: ['group', 'other-team'] }),
    'SCOPE_MISMATCH',
  );
});

test('every unsupported lifecycle transition and repeated registration is rejected', () => {
  const states = ['draft', 'evaluated', 'approved', 'shadow', 'active', 'suspended', 'rolled_back', 'retired'];
  const transitionEvents = [
    'evaluation_passed',
    'approval_granted',
    'shadow_released',
    'activated',
    'suspended',
    'resumed',
    'rolled_back',
    'retired',
  ];
  const allowed = {
    draft: new Set(['evaluation_passed']),
    evaluated: new Set(['approval_granted']),
    approved: new Set(['shadow_released', 'retired']),
    shadow: new Set(['activated', 'retired']),
    active: new Set(['suspended', 'rolled_back', 'retired']),
    suspended: new Set(['resumed', 'rolled_back', 'retired']),
    rolled_back: new Set(['retired']),
    retired: new Set(),
  };

  for (const state of states) {
    const history = historyForState(state);
    assertInvalid(append(history, 'version_registered'), 'ILLEGAL_TRANSITION');
    for (const eventType of transitionEvents) {
      if (!allowed[state].has(eventType)) {
        assertInvalid(append(history, eventType), 'ILLEGAL_TRANSITION');
      }
    }
  }

  for (const eventType of transitionEvents) {
    assertInvalid([nextEvent([], eventType)], 'FIRST_EVENT_NOT_REGISTERED');
  }
});

test('approval, release and rollback lineage mismatches are rejected', () => {
  assertInvalid(
    append(historyForState('approved'), 'shadow_released', { approvalReceiptId: 'APPROVAL-WRONG' }),
    'LINEAGE_MISMATCH',
  );
  assertInvalid(
    append(historyForState('suspended'), 'resumed', { releaseReceiptId: 'RELEASE-WRONG' }),
    'LINEAGE_MISMATCH',
  );
  assertInvalid(
    append(activeHistory(), 'rolled_back', { targetVersion: VERSION }),
    'SAME_VERSION_ROLLBACK',
  );
  assertInvalid(
    append(historyForState('evaluated'), 'approval_granted', { approvalReceiptId: '   ' }),
    'MALFORMED_EVENT',
  );
});

test('exact event shapes reject extra, non-enumerable, symbol, accessor and dangerous keys', () => {
  const extra = { ...registered(), extra: true };

  const nonEnumerable = registered();
  Object.defineProperty(nonEnumerable, 'hidden', { value: true, enumerable: false });

  const symbol = registered();
  symbol[Symbol('hidden')] = true;

  const accessor = registered();
  Object.defineProperty(accessor, 'eventId', {
    enumerable: true,
    configurable: true,
    get() {
      throw new Error('accessor must not execute');
    },
  });

  const dangerous = registered();
  Object.defineProperty(dangerous, '__proto__', { value: {}, enumerable: true });

  const nestedExtra = registered({ definition: { ...definition(), active: true } });

  const arrayExtra = registered();
  arrayExtra.capabilityVersion.requiredEvidenceKinds.extra = true;

  for (const value of [extra, nonEnumerable, symbol, accessor, dangerous, nestedExtra, arrayExtra]) {
    const expectedReason = value === nestedExtra
      ? 'INVALID_DEFINITION'
      : value === arrayExtra
        ? 'INVALID_VERSION_SNAPSHOT'
        : 'MALFORMED_EVENT';
    assertInvalid([value], expectedReason);
  }
});

test('numeric coercion and empty or whitespace identifiers and paths are malformed', () => {
  assertInvalid([registered({ governanceVersion: '1' })], 'MALFORMED_EVENT');
  assertInvalid([registered({ organizationScopePath: [] })], 'MALFORMED_EVENT');
  assertInvalid([registered({ organizationScopePath: ['group', '   '] })], 'MALFORMED_EVENT');

  for (const field of ['eventId', 'capabilityId', 'version', 'actorId']) {
    assertInvalid([registered({ [field]: '   ' })], 'MALFORMED_EVENT');
  }
  for (const field of ['capabilityId', 'ownerActorId', 'ownerOrganizationUnitId', 'kind']) {
    assertInvalid([registered({ definition: definition({ [field]: '   ' }) })], 'INVALID_DEFINITION');
  }
  for (const field of ['capabilityId', 'version', 'definitionHash']) {
    assertInvalid(
      [registered({ capabilityVersion: capabilityVersion({ [field]: '   ' }) })],
      'INVALID_VERSION_SNAPSHOT',
    );
  }
});

test('registered snapshots bind identity, normalize opaque evidence and enforce output boundary', () => {
  const projected = reduceCapabilityGovernance([registered()]);
  assert.equal(projected.state, 'draft');
  assert.deepEqual(projected.capabilityVersion.requiredEvidenceKinds, [
    'business_license',
    'tax_record',
  ]);
  assert.deepEqual(projected.capabilityVersion.supportedStages, ['business', 'credit']);
  assert.deepEqual(projected.capabilityVersion.supportedBusinessModes, ['direct', 'new_return']);
  assert.deepEqual(projected.capabilityVersion.supportedReviewPaths, ['exception', 'standard']);
  assert.deepEqual(projected.capabilityVersion.allowedOutputKinds, ['CandidateDraft', 'EvidenceDraft']);
  assert.equal(projected.definition.authority, 'none');

  assertInvalid(
    [registered({ definition: definition({ capabilityId: 'different-capability' }) })],
    'SNAPSHOT_IDENTITY_MISMATCH',
  );
  assertInvalid(
    [registered({ capabilityVersion: capabilityVersion({ version: '2.0.0' }) })],
    'SNAPSHOT_IDENTITY_MISMATCH',
  );
  assertInvalid(
    [registered({ capabilityVersion: capabilityVersion({ allowedOutputKinds: ['ActionIntent'] }) })],
    'OUTPUT_BOUNDARY_VIOLATION',
  );
  assertInvalid(
    [registered({ capabilityVersion: capabilityVersion({ supportedStages: [' credit '] }) })],
    'INVALID_VERSION_SNAPSHOT',
  );
  assertInvalid(
    [registered({ definition: definition({ authority: ' none ' }) })],
    'INVALID_DEFINITION',
  );
});

test('replay is deterministic and input/output nested data are defensively isolated', () => {
  const history = activeHistory();
  const pristine = structuredClone(history);
  const first = reduceCapabilityGovernance(history);
  const second = reduceCapabilityGovernance(history);

  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(first.definition, history[0].definition);
  assert.notEqual(first.capabilityVersion, history[0].capabilityVersion);
  assert.notEqual(first.organizationScopePath, history[0].organizationScopePath);

  first.organizationScopePath.push('mutated-output');
  first.definition.kind = 'mutated-output';
  first.capabilityVersion.requiredEvidenceKinds.push('mutated-output');
  assert.deepEqual(reduceCapabilityGovernance(pristine), second);

  history[0].definition.kind = 'mutated-input';
  history[0].capabilityVersion.requiredEvidenceKinds.push('mutated-input');
  history[0].organizationScopePath.push('mutated-input');
  assert.deepEqual(reduceCapabilityGovernance(pristine), second);
});

test('empty or corrupt history returns one deterministic invalid projection and cannot be repaired later', () => {
  const emptyFirst = reduceCapabilityGovernance([]);
  const emptySecond = reduceCapabilityGovernance([]);
  assert.deepEqual(emptyFirst, emptySecond);
  assert.equal(emptyFirst instanceof Promise, false);
  assert.equal(emptyFirst.invalidReason, 'EMPTY_HISTORY');

  assertInvalid([null], 'MALFORMED_EVENT');
  assertInvalid([{}, registered({ governanceVersion: 2 })], 'MALFORMED_EVENT');
  assertInvalid([nextEvent([], 'evaluation_passed'), registered({ governanceVersion: 2 })], 'FIRST_EVENT_NOT_REGISTERED');

  const nonArray = reduceCapabilityGovernance(null);
  assert.equal(nonArray.state, 'invalid');
  assert.equal(nonArray.invalidReason, 'MALFORMED_EVENT');
});
