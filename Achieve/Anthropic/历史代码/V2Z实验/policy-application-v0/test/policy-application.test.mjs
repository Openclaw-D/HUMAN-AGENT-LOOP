import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PolicyApplicationError,
  buildPolicyApplication,
} from '../src/policy-application.mjs';

const KIND_ORDER = Object.freeze([
  'MODEL_SCORE',
  'STRATEGY',
  'ANTI_FRAUD',
  'RULE',
  'ENGINE',
  'DATA',
]);

const APPLIED_AT = '2026-08-28T10:30:00+08:00';

function artifactIdFor(kind) {
  return `artifact-${kind.toLowerCase()}`;
}

function makeArtifact(kind, result = 'CLEAR', overrides = {}) {
  return {
    kind,
    artifactId: artifactIdFor(kind),
    version: 'v1',
    result,
    evidenceRefs: [`evidence:${kind.toLowerCase()}`],
    ...overrides,
  };
}

function makeFullArtifacts(results = {}) {
  return [...KIND_ORDER]
    .reverse()
    .map((kind) => makeArtifact(kind, results[kind] ?? 'CLEAR'));
}

function makeInput(overrides = {}) {
  return {
    caseId: 'lease-case-001',
    appliedAt: APPLIED_AT,
    artifacts: makeFullArtifacts(),
    ...overrides,
  };
}

function expectedArtifactRef(kind, result = 'CLEAR') {
  return {
    kind,
    artifactId: artifactIdFor(kind),
    version: 'v1',
    result,
    evidenceRefs: [`evidence:${kind.toLowerCase()}`],
  };
}

function assertExactStringKeys(value, expectedKeys) {
  const keys = Reflect.ownKeys(value);
  assert.ok(keys.every((key) => typeof key === 'string'));
  assert.deepEqual([...keys].sort(), [...expectedKeys].sort());
}

function assertPolicyError(action, expectedCode) {
  let error;
  try {
    action();
  } catch (caught) {
    error = caught;
  }

  assert.ok(error, 'expected the call to throw synchronously');
  assert.ok(error instanceof Error);
  assert.ok(error instanceof PolicyApplicationError);
  assert.equal(error.constructor.name, 'PolicyApplicationError');
  assert.equal(error.name, 'PolicyApplicationError');
  assert.equal(error.code, expectedCode);
  assert.equal(typeof error.details, 'object');
  assert.notEqual(error.details, null);
  assert.equal(Array.isArray(error.details), false);
  assert.equal(Object.getPrototypeOf(error.details), Object.prototype);
  return error;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

test('all CLEAR artifacts produce the exact credit-review-ready result in fixed order', () => {
  const input = makeInput();
  const output = buildPolicyApplication(input);

  assert.ok(!(output instanceof Promise));
  assert.notEqual(typeof output?.then, 'function');
  assert.deepEqual(output, {
    schemaVersion: 'policy-application.lab.v0',
    caseId: 'lease-case-001',
    appliedAt: APPLIED_AT,
    artifactRefs: KIND_ORDER.map((kind) => expectedArtifactRef(kind)),
    readiness: 'READY_FOR_CREDIT_REVIEW',
    missingKinds: [],
    exceptionReasons: [],
    authority: {
      policyHumanApprovalRequired: false,
      projectDecisionAuthority: 'NONE',
      consumer: 'CREDIT_REVIEW',
    },
  });

  assertExactStringKeys(output, [
    'schemaVersion',
    'caseId',
    'appliedAt',
    'artifactRefs',
    'readiness',
    'missingKinds',
    'exceptionReasons',
    'authority',
  ]);
  for (const ref of output.artifactRefs) {
    assertExactStringKeys(ref, [
      'kind',
      'artifactId',
      'version',
      'result',
      'evidenceRefs',
    ]);
  }
  assertExactStringKeys(output.authority, [
    'policyHumanApprovalRequired',
    'projectDecisionAuthority',
    'consumer',
  ]);
});

test('a missing kind takes precedence over a present HIT and reports ordered gaps', () => {
  const output = buildPolicyApplication(makeInput({
    artifacts: [
      makeArtifact('ENGINE'),
      makeArtifact('MODEL_SCORE', 'HIT'),
    ],
  }));

  assert.equal(output.readiness, 'POLICY_INPUT_INCOMPLETE');
  assert.deepEqual(output.missingKinds, [
    'STRATEGY',
    'ANTI_FRAUD',
    'RULE',
    'DATA',
  ]);
  assert.deepEqual(output.artifactRefs.map(({ kind }) => kind), [
    'MODEL_SCORE',
    'ENGINE',
  ]);
  assert.deepEqual(output.exceptionReasons, [
    { kind: 'MODEL_SCORE', result: 'HIT' },
  ]);
});

test('a complete set containing HIT requires a policy exception without rejecting the project', () => {
  const output = buildPolicyApplication(makeInput({
    artifacts: makeFullArtifacts({ RULE: 'HIT' }),
  }));

  assert.equal(output.readiness, 'POLICY_EXCEPTION_REQUIRED');
  assert.deepEqual(output.missingKinds, []);
  assert.deepEqual(output.exceptionReasons, [
    { kind: 'RULE', result: 'HIT' },
  ]);
  assert.deepEqual(output.authority, {
    policyHumanApprovalRequired: false,
    projectDecisionAuthority: 'NONE',
    consumer: 'CREDIT_REVIEW',
  });
  assert.equal('projectApproved' in output, false);
  assert.equal('projectRejected' in output, false);
});

test('UNKNOWN results require a policy exception and remain in fixed kind order', () => {
  const output = buildPolicyApplication(makeInput({
    artifacts: makeFullArtifacts({
      STRATEGY: 'UNKNOWN',
      DATA: 'UNKNOWN',
    }),
  }));

  assert.equal(output.readiness, 'POLICY_EXCEPTION_REQUIRED');
  assert.deepEqual(output.exceptionReasons, [
    { kind: 'STRATEGY', result: 'UNKNOWN' },
    { kind: 'DATA', result: 'UNKNOWN' },
  ]);
});

test('duplicate artifact kind throws the dedicated synchronous error', () => {
  const input = makeInput({
    artifacts: [
      ...makeFullArtifacts(),
      makeArtifact('RULE', 'CLEAR', { artifactId: 'artifact-rule-duplicate' }),
    ],
  });

  assertPolicyError(
    () => buildPolicyApplication(input),
    'DUPLICATE_ARTIFACT_KIND',
  );
});

for (const [label, input] of [
  ['invalid kind', makeInput({ artifacts: [makeArtifact('NOT_A_KIND')] })],
  ['invalid result', makeInput({ artifacts: [makeArtifact('MODEL_SCORE', 'PASS')] })],
]) {
  test(`${label} throws INVALID_INPUT before readiness calculation`, () => {
    assertPolicyError(() => buildPolicyApplication(input), 'INVALID_INPUT');
  });
}

for (const [label, input] of [
  ['empty caseId', makeInput({ caseId: '' })],
  ['empty artifactId', makeInput({
    artifacts: [makeArtifact('MODEL_SCORE', 'CLEAR', { artifactId: '' })],
  })],
  ['empty version', makeInput({
    artifacts: [makeArtifact('MODEL_SCORE', 'CLEAR', { version: '' })],
  })],
  ['empty evidenceRef', makeInput({
    artifacts: [makeArtifact('MODEL_SCORE', 'CLEAR', { evidenceRefs: [''] })],
  })],
  ['non-string evidenceRef', makeInput({
    artifacts: [makeArtifact('MODEL_SCORE', 'CLEAR', { evidenceRefs: [42] })],
  })],
]) {
  test(`${label} throws INVALID_INPUT`, () => {
    assertPolicyError(() => buildPolicyApplication(input), 'INVALID_INPUT');
  });
}

for (const appliedAt of [
  'not-a-date',
  '2026-02-30T00:00:00Z',
  '2026-08-28',
  '2026-08-28T10:30:00',
]) {
  test(`invalid ISO-8601 datetime ${appliedAt} throws INVALID_INPUT`, () => {
    assertPolicyError(
      () => buildPolicyApplication(makeInput({ appliedAt })),
      'INVALID_INPUT',
    );
  });
}

test('overall and artifact shapes are exact and reject additional fields', () => {
  assertPolicyError(
    () => buildPolicyApplication({ ...makeInput(), unexpected: true }),
    'INVALID_INPUT',
  );
  assertPolicyError(
    () => buildPolicyApplication(makeInput({
      artifacts: [
        { ...makeArtifact('MODEL_SCORE'), unexpected: true },
      ],
    })),
    'INVALID_INPUT',
  );
});

test('the API is synchronous and never returns a Promise or thenable', () => {
  const output = buildPolicyApplication(makeInput());
  assert.equal(output instanceof Promise, false);
  assert.notEqual(typeof output?.then, 'function');
});

test('deeply frozen input is accepted without mutation', () => {
  const input = deepFreeze(makeInput());
  const before = JSON.stringify(input);

  buildPolicyApplication(input);

  assert.equal(JSON.stringify(input), before);
});

test('artifact objects and nested evidenceRefs are isolated in both directions', () => {
  const input = makeInput();
  const output = buildPolicyApplication(input);
  const inputArtifact = input.artifacts.find(({ kind }) => kind === 'MODEL_SCORE');
  const outputArtifact = output.artifactRefs.find(({ kind }) => kind === 'MODEL_SCORE');

  assert.notStrictEqual(output.artifactRefs, input.artifacts);
  assert.notStrictEqual(outputArtifact, inputArtifact);
  assert.notStrictEqual(outputArtifact.evidenceRefs, inputArtifact.evidenceRefs);

  outputArtifact.evidenceRefs.push('output-only');
  assert.deepEqual(inputArtifact.evidenceRefs, ['evidence:model_score']);

  inputArtifact.evidenceRefs.push('input-only');
  assert.deepEqual(outputArtifact.evidenceRefs, [
    'evidence:model_score',
    'output-only',
  ]);
});

test('an own __proto__ key is rejected without prototype pollution', () => {
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(({}).polluted, undefined);

  const maliciousArtifact = JSON.parse(`{
    "kind":"MODEL_SCORE",
    "artifactId":"artifact-model_score",
    "version":"v1",
    "result":"CLEAR",
    "evidenceRefs":["evidence:model_score"],
    "__proto__":{"polluted":"yes"}
  }`);
  const artifacts = makeFullArtifacts();
  artifacts[artifacts.findIndex(({ kind }) => kind === 'MODEL_SCORE')] = maliciousArtifact;

  assertPolicyError(
    () => buildPolicyApplication(makeInput({ artifacts })),
    'INVALID_INPUT',
  );
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(({}).polluted, undefined);
});
