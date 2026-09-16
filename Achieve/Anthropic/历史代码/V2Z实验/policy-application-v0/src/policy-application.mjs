const SCHEMA_VERSION = 'policy-application.lab.v0';

const KIND_ORDER = Object.freeze([
  'MODEL_SCORE',
  'STRATEGY',
  'ANTI_FRAUD',
  'RULE',
  'ENGINE',
  'DATA',
]);

const ALLOWED_RESULTS = Object.freeze([
  'CLEAR',
  'HIT',
  'UNKNOWN',
]);

export class PolicyApplicationError extends Error {
  constructor(code, details, message) {
    super(message);
    this.name = 'PolicyApplicationError';
    this.code = code;
    this.details = details;
  }
}

function isPlainObject(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactOwnKeys(value, expectedKeys) {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== expectedKeys.length) {
    return false;
  }

  return expectedKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  );
}

function isExactArray(value) {
  if (!Array.isArray(value)) {
    return false;
  }

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length) {
    return false;
  }

  return ownKeys.every((key) => {
    return typeof key === 'string' &&
      /^\d+$/.test(key) &&
      Number(key) < value.length;
  });
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function daysInMonth(year, month) {
  if (month === 2) {
    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeapYear ? 29 : 28;
  }

  if (month === 4 || month === 6 || month === 9 || month === 11) {
    return 30;
  }

  return 31;
}

function isValidAppliedAt(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))(?:Z|[+-](\d{2}):(\d{2}))$/,
  );
  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const timezoneHour = match[8] === undefined ? 0 : Number(match[8]);
  const timezoneMinute = match[9] === undefined ? 0 : Number(match[9]);

  if (month < 1 || month > 12) {
    return false;
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return false;
  }
  if (hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  if (timezoneHour > 23 || timezoneMinute > 59) {
    return false;
  }

  return true;
}

function invalidInput(details, message) {
  throw new PolicyApplicationError('INVALID_INPUT', details, message);
}

function validateInput(input) {
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    !isPlainObject(input) ||
    !hasExactOwnKeys(input, ['caseId', 'appliedAt', 'artifacts'])
  ) {
    invalidInput({ field: 'input' }, 'Invalid policy application input');
  }

  if (!isNonEmptyString(input.caseId)) {
    invalidInput({ field: 'caseId' }, 'caseId must be a non-empty string');
  }

  if (!isNonEmptyString(input.appliedAt) || !isValidAppliedAt(input.appliedAt)) {
    invalidInput(
      { field: 'appliedAt' },
      'appliedAt must be a timezone-aware ISO-8601 datetime',
    );
  }

  if (!isExactArray(input.artifacts)) {
    invalidInput({ field: 'artifacts' }, 'artifacts must be an array');
  }
}

function validateArtifacts(artifacts) {
  const seenKinds = new Set();

  for (let index = 0; index < artifacts.length; index += 1) {
    const artifact = artifacts[index];
    const artifactField = { field: 'artifacts', index };

    if (
      artifact === null ||
      typeof artifact !== 'object' ||
      Array.isArray(artifact) ||
      !isPlainObject(artifact) ||
      !hasExactOwnKeys(artifact, [
        'kind',
        'artifactId',
        'version',
        'result',
        'evidenceRefs',
      ])
    ) {
      throw new PolicyApplicationError(
        'INVALID_INPUT',
        artifactField,
        'Invalid artifact',
      );
    }

    if (
      !KIND_ORDER.includes(artifact.kind) ||
      !isNonEmptyString(artifact.artifactId) ||
      !isNonEmptyString(artifact.version) ||
      !ALLOWED_RESULTS.includes(artifact.result) ||
      !isExactArray(artifact.evidenceRefs) ||
      !artifact.evidenceRefs.every(isNonEmptyString)
    ) {
      throw new PolicyApplicationError(
        'INVALID_INPUT',
        artifactField,
        'Invalid artifact field or enum value',
      );
    }

    if (seenKinds.has(artifact.kind)) {
      throw new PolicyApplicationError(
        'DUPLICATE_ARTIFACT_KIND',
        { kind: artifact.kind },
        'Duplicate artifact kind',
      );
    }
    seenKinds.add(artifact.kind);
  }
}

export function buildPolicyApplication(input) {
  validateInput(input);
  validateArtifacts(input.artifacts);

  const artifactsByKind = new Map();
  for (const artifact of input.artifacts) {
    artifactsByKind.set(artifact.kind, artifact);
  }

  const artifactRefs = [];
  const missingKinds = [];
  const exceptionReasons = [];

  for (const kind of KIND_ORDER) {
    const artifact = artifactsByKind.get(kind);
    if (artifact === undefined) {
      missingKinds.push(kind);
      continue;
    }

    artifactRefs.push({
      kind: artifact.kind,
      artifactId: artifact.artifactId,
      version: artifact.version,
      result: artifact.result,
      evidenceRefs: [...artifact.evidenceRefs],
    });

    if (artifact.result === 'HIT' || artifact.result === 'UNKNOWN') {
      exceptionReasons.push({
        kind: artifact.kind,
        result: artifact.result,
      });
    }
  }

  let readiness;
  if (missingKinds.length > 0) {
    readiness = 'POLICY_INPUT_INCOMPLETE';
  } else if (exceptionReasons.length > 0) {
    readiness = 'POLICY_EXCEPTION_REQUIRED';
  } else {
    readiness = 'READY_FOR_CREDIT_REVIEW';
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    caseId: input.caseId,
    appliedAt: input.appliedAt,
    artifactRefs,
    readiness,
    missingKinds,
    exceptionReasons,
    authority: {
      policyHumanApprovalRequired: false,
      projectDecisionAuthority: 'NONE',
      consumer: 'CREDIT_REVIEW',
    },
  };
}
