import type {
  CapabilityAdmissionDecision,
  CapabilityAdmissionOutcome,
  CapabilityAdmissionReasonCode,
  CapabilityAdmissionRequest,
  CapabilityBusinessMode,
  CapabilityGovernanceProjection,
  CapabilityOutputKind,
  CapabilityReviewPath,
  CapabilityStage,
} from './capability-admission-types.ts';

type DataRecord = Record<PropertyKey, unknown>;

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const BUSINESS_MODES = new Set<CapabilityBusinessMode>(['direct', 'existing_return', 'new_return']);
const REVIEW_PATHS = new Set<CapabilityReviewPath>(['standard', 'exception']);
const STAGES = new Set<CapabilityStage>(['business', 'credit', 'commercial', 'asset', 'commencement']);
const OUTPUT_KINDS = new Set<CapabilityOutputKind>(['EvidenceDraft', 'CandidateDraft']);
const GOVERNANCE_STATES = new Set([
  'draft',
  'evaluated',
  'approved',
  'shadow',
  'active',
  'suspended',
  'rolled_back',
  'retired',
  'invalid',
]);

const REQUEST_KEYS = [
  'caseId',
  'attemptId',
  'contextVersion',
  'currentContextVersion',
  'businessMode',
  'reviewPath',
  'currentStage',
  'caseOrganizationPath',
  'availableEvidenceKinds',
  'requestedOutputKind',
  'expectedCapabilityId',
  'expectedCapabilityVersion',
  'expectedGovernanceVersion',
  'governanceProjection',
] as const;

const PROJECTION_KEYS = [
  'state',
  'invalidReason',
  'invalidEventIndex',
  'capabilityId',
  'version',
  'governanceVersion',
  'organizationScopePath',
  'definition',
  'capabilityVersion',
  'evaluationId',
  'approvalReceiptId',
  'releaseReceiptId',
  'suspensionReason',
  'rollbackReceiptId',
  'rollbackTargetVersion',
  'retirementReceiptId',
  'lastEventId',
  'eventCount',
] as const;

const DEFINITION_KEYS = [
  'capabilityId',
  'ownerActorId',
  'ownerOrganizationUnitId',
  'kind',
  'authority',
] as const;

const VERSION_KEYS = [
  'capabilityId',
  'version',
  'definitionHash',
  'supportedStages',
  'supportedBusinessModes',
  'supportedReviewPaths',
  'requiredEvidenceKinds',
  'allowedOutputKinds',
] as const;

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainRecord(value: unknown): value is DataRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactDataShape(value: unknown, expectedKeys: readonly string[]): value is DataRecord {
  if (!isPlainRecord(value)) {
    return false;
  }

  const expected = new Set(expectedKeys);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== expected.size) {
    return false;
  }
  for (const key of ownKeys) {
    if (typeof key !== 'string' || DANGEROUS_KEYS.has(key) || !expected.has(key)) {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      return false;
    }
  }
  return true;
}

function isExactArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) {
    return false;
  }
  const expectedKeys = new Set<string>(['length']);
  for (let index = 0; index < value.length; index += 1) {
    expectedKeys.add(String(index));
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== expectedKeys.size) {
    return false;
  }
  for (const key of ownKeys) {
    if (typeof key !== 'string' || !expectedKeys.has(key)) {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || (key !== 'length' && !descriptor.enumerable)) {
      return false;
    }
  }
  return true;
}

function isStringArrayShape(value: unknown): value is string[] {
  return isExactArray(value) && value.every((entry) => typeof entry === 'string');
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableSafeInteger(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function normalizeOpaqueList(value: unknown, requireNonEmpty: boolean): string[] | null {
  if (!isStringArrayShape(value) || (requireNonEmpty && value.length === 0)) {
    return null;
  }
  const normalized: string[] = [];
  for (const entry of value) {
    const canonical = entry.trim();
    if (canonical.length === 0) {
      return null;
    }
    normalized.push(canonical);
  }
  return [...new Set(normalized)].sort(ordinalCompare);
}

function normalizePath(value: unknown): string[] | null {
  if (!isStringArrayShape(value) || value.length === 0) {
    return null;
  }
  const normalized = value.map((segment) => segment.trim());
  return normalized.every((segment) => segment.length > 0) ? normalized : null;
}

function hasDefinitionShape(value: unknown): boolean {
  return hasExactDataShape(value, DEFINITION_KEYS)
    && typeof value.capabilityId === 'string'
    && typeof value.ownerActorId === 'string'
    && typeof value.ownerOrganizationUnitId === 'string'
    && typeof value.kind === 'string'
    && typeof value.authority === 'string';
}

function hasVersionShape(value: unknown): boolean {
  return hasExactDataShape(value, VERSION_KEYS)
    && typeof value.capabilityId === 'string'
    && typeof value.version === 'string'
    && typeof value.definitionHash === 'string'
    && isStringArrayShape(value.supportedStages)
    && isStringArrayShape(value.supportedBusinessModes)
    && isStringArrayShape(value.supportedReviewPaths)
    && isStringArrayShape(value.requiredEvidenceKinds)
    && isStringArrayShape(value.allowedOutputKinds);
}

function parseProjectionShape(value: unknown): CapabilityGovernanceProjection | null {
  if (!hasExactDataShape(value, PROJECTION_KEYS)
    || typeof value.state !== 'string'
    || !GOVERNANCE_STATES.has(value.state)
    || !isNullableString(value.invalidReason)
    || !isNullableSafeInteger(value.invalidEventIndex)
    || !isNullableString(value.capabilityId)
    || !isNullableString(value.version)
    || !Number.isSafeInteger(value.governanceVersion)
    || (value.governanceVersion as number) < 0
    || !isStringArrayShape(value.organizationScopePath)
    || !(value.definition === null || hasDefinitionShape(value.definition))
    || !(value.capabilityVersion === null || hasVersionShape(value.capabilityVersion))
    || !isNullableString(value.evaluationId)
    || !isNullableString(value.approvalReceiptId)
    || !isNullableString(value.releaseReceiptId)
    || !isNullableString(value.suspensionReason)
    || !isNullableString(value.rollbackReceiptId)
    || !isNullableString(value.rollbackTargetVersion)
    || !isNullableString(value.retirementReceiptId)
    || !isNullableString(value.lastEventId)
    || !Number.isSafeInteger(value.eventCount)
    || (value.eventCount as number) < 0) {
    return null;
  }
  return value as unknown as CapabilityGovernanceProjection;
}

function parseRequest(value: unknown): CapabilityAdmissionRequest | null {
  if (!hasExactDataShape(value, REQUEST_KEYS)
    || !isNonEmptyString(value.caseId)
    || !isNonEmptyString(value.attemptId)
    || !isNonEmptyString(value.contextVersion)
    || !isNonEmptyString(value.currentContextVersion)
    || !BUSINESS_MODES.has(value.businessMode as CapabilityBusinessMode)
    || !REVIEW_PATHS.has(value.reviewPath as CapabilityReviewPath)
    || !STAGES.has(value.currentStage as CapabilityStage)
    || !OUTPUT_KINDS.has(value.requestedOutputKind as CapabilityOutputKind)
    || !isNonEmptyString(value.expectedCapabilityId)
    || !isNonEmptyString(value.expectedCapabilityVersion)
    || !Number.isSafeInteger(value.expectedGovernanceVersion)
    || (value.expectedGovernanceVersion as number) <= 0) {
    return null;
  }

  const caseOrganizationPath = normalizePath(value.caseOrganizationPath);
  const availableEvidenceKinds = normalizeOpaqueList(value.availableEvidenceKinds, false);
  const governanceProjection = parseProjectionShape(value.governanceProjection);
  if (caseOrganizationPath === null
    || availableEvidenceKinds === null
    || governanceProjection === null) {
    return null;
  }

  return {
    caseId: value.caseId.trim(),
    attemptId: value.attemptId.trim(),
    contextVersion: value.contextVersion.trim(),
    currentContextVersion: value.currentContextVersion.trim(),
    businessMode: value.businessMode as CapabilityBusinessMode,
    reviewPath: value.reviewPath as CapabilityReviewPath,
    currentStage: value.currentStage as CapabilityStage,
    caseOrganizationPath,
    availableEvidenceKinds,
    requestedOutputKind: value.requestedOutputKind as CapabilityOutputKind,
    expectedCapabilityId: value.expectedCapabilityId.trim(),
    expectedCapabilityVersion: value.expectedCapabilityVersion.trim(),
    expectedGovernanceVersion: value.expectedGovernanceVersion as number,
    governanceProjection,
  };
}

function isCanonicalOpaque(value: string): boolean {
  return value.length > 0 && value === value.trim();
}

function isCanonicalNullable(value: string | null): boolean {
  return value === null || isCanonicalOpaque(value);
}

function isCanonicalSortedUnique(
  value: readonly string[],
  allowed: ReadonlySet<string> | null,
  requireNonEmpty: boolean,
): boolean {
  if ((requireNonEmpty && value.length === 0)
    || value.some((entry) => !isCanonicalOpaque(entry) || (allowed !== null && !allowed.has(entry)))) {
    return false;
  }
  return value.every((entry, index) => index === 0 || ordinalCompare(value[index - 1], entry) < 0);
}

function hasCoherentLineage(projection: CapabilityGovernanceProjection): boolean {
  const evaluation = projection.evaluationId !== null;
  const approval = projection.approvalReceiptId !== null;
  const release = projection.releaseReceiptId !== null;
  const suspension = projection.suspensionReason !== null;
  const rollbackReceipt = projection.rollbackReceiptId !== null;
  const rollbackTarget = projection.rollbackTargetVersion !== null;
  const retirement = projection.retirementReceiptId !== null;

  switch (projection.state) {
    case 'draft':
      return !evaluation && !approval && !release && !suspension
        && !rollbackReceipt && !rollbackTarget && !retirement;
    case 'evaluated':
      return evaluation && !approval && !release && !suspension
        && !rollbackReceipt && !rollbackTarget && !retirement;
    case 'approved':
    case 'shadow':
      return evaluation && approval && !release && !suspension
        && !rollbackReceipt && !rollbackTarget && !retirement;
    case 'active':
      return evaluation && approval && release && !rollbackReceipt && !rollbackTarget && !retirement;
    case 'suspended':
      return evaluation && approval && release && suspension
        && !rollbackReceipt && !rollbackTarget && !retirement;
    case 'rolled_back':
      return evaluation && approval && release && rollbackReceipt && rollbackTarget && !retirement;
    case 'retired':
      return evaluation && approval && retirement
        && rollbackReceipt === rollbackTarget
        && (!rollbackReceipt || release)
        && (!suspension || release);
    case 'invalid':
      return false;
  }
}

function hasReachableLifecycleDepth(projection: CapabilityGovernanceProjection): boolean {
  const depth = projection.governanceVersion;
  switch (projection.state) {
    case 'draft':
      return depth === 1;
    case 'evaluated':
      return depth === 2;
    case 'approved':
      return depth === 3;
    case 'shadow':
      return depth === 4;
    case 'active':
      return depth >= 5 && depth % 2 === 1;
    case 'suspended':
      return depth >= 6 && depth % 2 === 0;
    case 'rolled_back':
      return depth >= 6;
    case 'retired':
      return depth >= 4;
    case 'invalid':
      return false;
  }
}

function isValidGovernanceProjection(projection: CapabilityGovernanceProjection): boolean {
  if (projection.state === 'invalid'
    || projection.invalidReason !== null
    || projection.invalidEventIndex !== null
    || projection.capabilityId === null
    || projection.version === null
    || projection.definition === null
    || projection.capabilityVersion === null
    || projection.governanceVersion <= 0
    || projection.eventCount !== projection.governanceVersion
    || !hasReachableLifecycleDepth(projection)
    || projection.organizationScopePath.length === 0
    || !isCanonicalOpaque(projection.capabilityId)
    || !isCanonicalOpaque(projection.version)
    || !projection.organizationScopePath.every(isCanonicalOpaque)
    || projection.lastEventId === null
    || !isCanonicalOpaque(projection.lastEventId)
    || !isCanonicalNullable(projection.evaluationId)
    || !isCanonicalNullable(projection.approvalReceiptId)
    || !isCanonicalNullable(projection.releaseReceiptId)
    || !isCanonicalNullable(projection.suspensionReason)
    || !isCanonicalNullable(projection.rollbackReceiptId)
    || !isCanonicalNullable(projection.rollbackTargetVersion)
    || !isCanonicalNullable(projection.retirementReceiptId)) {
    return false;
  }

  const definition = projection.definition;
  const version = projection.capabilityVersion;
  if (!isCanonicalOpaque(definition.capabilityId)
    || !isCanonicalOpaque(definition.ownerActorId)
    || !isCanonicalOpaque(definition.ownerOrganizationUnitId)
    || !isCanonicalOpaque(definition.kind)
    || definition.authority !== 'none'
    || !isCanonicalOpaque(version.capabilityId)
    || !isCanonicalOpaque(version.version)
    || !isCanonicalOpaque(version.definitionHash)
    || definition.capabilityId !== projection.capabilityId
    || version.capabilityId !== projection.capabilityId
    || version.version !== projection.version
    || !isCanonicalSortedUnique(version.supportedStages, STAGES, true)
    || !isCanonicalSortedUnique(version.supportedBusinessModes, BUSINESS_MODES, true)
    || !isCanonicalSortedUnique(version.supportedReviewPaths, REVIEW_PATHS, true)
    || !isCanonicalSortedUnique(version.requiredEvidenceKinds, null, false)
    || !isCanonicalSortedUnique(version.allowedOutputKinds, OUTPUT_KINDS, true)) {
    return false;
  }

  return hasCoherentLineage(projection);
}

function canonicalProjectionIdentity(value: string | null): string | null {
  return value !== null && isCanonicalOpaque(value) ? value : null;
}

function decision(
  request: CapabilityAdmissionRequest | null,
  outcome: CapabilityAdmissionOutcome,
  reasonCode: CapabilityAdmissionReasonCode,
  missingEvidenceKinds: readonly string[] = [],
): CapabilityAdmissionDecision {
  if (request === null) {
    return {
      outcome,
      reasonCode,
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
  }

  const projection = request.governanceProjection;
  return {
    outcome,
    reasonCode,
    caseId: request.caseId,
    attemptId: request.attemptId,
    contextVersion: request.contextVersion,
    capabilityId: canonicalProjectionIdentity(projection.capabilityId),
    version: canonicalProjectionIdentity(projection.version),
    governanceVersion: projection.governanceVersion > 0 ? projection.governanceVersion : 0,
    requestedOutputKind: request.requestedOutputKind,
    authority: 'none',
    missingEvidenceKinds: [...missingEvidenceKinds],
  };
}

function isWithinScope(casePath: readonly string[], capabilityPath: readonly string[]): boolean {
  return casePath.length >= capabilityPath.length
    && capabilityPath.every((segment, index) => casePath[index] === segment);
}

export function evaluateCapabilityAdmission(input: unknown): CapabilityAdmissionDecision {
  try {
    const request = parseRequest(input);
    if (request === null) {
      return decision(null, 'unknown', 'INVALID_ADMISSION_INPUT');
    }

    const projection = request.governanceProjection;
    if (!isValidGovernanceProjection(projection)) {
      return decision(request, 'unknown', 'INVALID_GOVERNANCE_PROJECTION');
    }
    const version = projection.capabilityVersion;
    if (version === null) {
      return decision(request, 'unknown', 'INVALID_GOVERNANCE_PROJECTION');
    }
    if (request.expectedGovernanceVersion !== projection.governanceVersion) {
      return decision(request, 'unknown', 'STALE_GOVERNANCE');
    }
    if (projection.state !== 'active') {
      if (projection.state === 'suspended') {
        return decision(request, 'denied', 'CAPABILITY_SUSPENDED');
      }
      if (projection.state === 'rolled_back' || projection.state === 'retired') {
        return decision(request, 'denied', 'CAPABILITY_RETIRED');
      }
      return decision(request, 'denied', 'CAPABILITY_INACTIVE');
    }
    if (request.expectedCapabilityId !== projection.capabilityId
      || request.expectedCapabilityVersion !== projection.version
      || request.contextVersion !== request.currentContextVersion) {
      return decision(request, 'unknown', 'CASE_CONTEXT_MISMATCH');
    }
    if (!isWithinScope(request.caseOrganizationPath, projection.organizationScopePath)) {
      return decision(request, 'denied', 'ORGANIZATION_SCOPE_DENIED');
    }

    if (!version.supportedStages.includes(request.currentStage)) {
      return decision(request, 'ineligible', 'STAGE_NOT_SUPPORTED');
    }
    if (!version.supportedBusinessModes.includes(request.businessMode)) {
      return decision(request, 'ineligible', 'BUSINESS_MODE_NOT_SUPPORTED');
    }
    if (!version.supportedReviewPaths.includes(request.reviewPath)) {
      return decision(request, 'ineligible', 'REVIEW_PATH_NOT_SUPPORTED');
    }

    const availableEvidenceKinds = new Set(request.availableEvidenceKinds);
    const missingEvidenceKinds = version.requiredEvidenceKinds.filter(
      (evidenceKind) => !availableEvidenceKinds.has(evidenceKind),
    );
    if (missingEvidenceKinds.length > 0) {
      return decision(request, 'ineligible', 'REQUIRED_EVIDENCE_MISSING', missingEvidenceKinds);
    }
    if (!version.allowedOutputKinds.includes(request.requestedOutputKind)) {
      return decision(request, 'denied', 'OUTPUT_NOT_ALLOWED');
    }
    return decision(request, 'eligible', 'ELIGIBLE');
  } catch {
    return decision(null, 'unknown', 'INVALID_ADMISSION_INPUT');
  }
}
