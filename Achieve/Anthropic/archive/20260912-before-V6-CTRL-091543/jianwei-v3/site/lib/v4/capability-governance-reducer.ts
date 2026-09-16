import type {
  CapabilityBusinessMode,
  CapabilityDefinition,
  CapabilityGovernanceEvent,
  CapabilityGovernanceInvalidReason,
  CapabilityGovernanceProjection,
  CapabilityGovernanceState,
  CapabilityOutputKind,
  CapabilityReviewPath,
  CapabilityStage,
  CapabilityVersion,
} from './capability-admission-types.ts';

type DataRecord = Record<string, unknown>;

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: CapabilityGovernanceInvalidReason };

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const EVENT_TYPES = new Set<CapabilityGovernanceEvent['eventType']>([
  'version_registered',
  'evaluation_passed',
  'approval_granted',
  'shadow_released',
  'activated',
  'suspended',
  'resumed',
  'rolled_back',
  'retired',
]);
const CAPABILITY_STAGES = new Set<CapabilityStage>([
  'business',
  'credit',
  'commercial',
  'asset',
  'commencement',
]);
const BUSINESS_MODES = new Set<CapabilityBusinessMode>([
  'direct',
  'existing_return',
  'new_return',
]);
const REVIEW_PATHS = new Set<CapabilityReviewPath>(['standard', 'exception']);
const OUTPUT_KINDS = new Set<CapabilityOutputKind>(['EvidenceDraft', 'CandidateDraft']);

const ENVELOPE_KEYS = [
  'eventType',
  'eventId',
  'capabilityId',
  'version',
  'governanceVersion',
  'actorId',
  'organizationScopePath',
] as const;

const EVENT_KEYS: Record<CapabilityGovernanceEvent['eventType'], readonly string[]> = {
  version_registered: [...ENVELOPE_KEYS, 'definition', 'capabilityVersion'],
  evaluation_passed: [...ENVELOPE_KEYS, 'evaluationId'],
  approval_granted: [...ENVELOPE_KEYS, 'approvalReceiptId'],
  shadow_released: [...ENVELOPE_KEYS, 'approvalReceiptId'],
  activated: [...ENVELOPE_KEYS, 'releaseReceiptId'],
  suspended: [...ENVELOPE_KEYS, 'reason'],
  resumed: [...ENVELOPE_KEYS, 'releaseReceiptId'],
  rolled_back: [...ENVELOPE_KEYS, 'rollbackReceiptId', 'targetVersion'],
  retired: [...ENVELOPE_KEYS, 'retirementReceiptId'],
};

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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
  const ownKeys = Reflect.ownKeys(value);
  const expectedKeys = new Set<string>(['length']);
  for (let index = 0; index < value.length; index += 1) {
    expectedKeys.add(String(index));
  }
  if (ownKeys.length !== expectedKeys.size) {
    return false;
  }
  for (const key of ownKeys) {
    if (typeof key !== 'string' || !expectedKeys.has(key)) {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) {
      return false;
    }
    if (key !== 'length' && !descriptor.enumerable) {
      return false;
    }
  }
  return true;
}

function normalizeStringList<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T> | null,
  requireNonEmpty: boolean,
): T[] | null {
  if (!isExactArray(value) || (requireNonEmpty && value.length === 0)) {
    return null;
  }
  const normalized: T[] = [];
  for (const entry of value) {
    if (!isNonEmptyString(entry) || (allowed !== null && !allowed.has(entry as T))) {
      return null;
    }
    normalized.push((allowed === null ? entry.trim() : entry) as T);
  }
  return [...new Set(normalized)].sort(ordinalCompare);
}

function normalizePath(value: unknown): string[] | null {
  if (!isExactArray(value) || value.length === 0 || !value.every(isNonEmptyString)) {
    return null;
  }
  return value.map((segment) => segment.trim());
}

function parseDefinition(value: unknown): ParseResult<CapabilityDefinition> {
  if (!hasExactDataShape(value, [
    'capabilityId',
    'ownerActorId',
    'ownerOrganizationUnitId',
    'kind',
    'authority',
  ])) {
    return { ok: false, reason: 'INVALID_DEFINITION' };
  }
  if (!isNonEmptyString(value.capabilityId)
    || !isNonEmptyString(value.ownerActorId)
    || !isNonEmptyString(value.ownerOrganizationUnitId)
    || !isNonEmptyString(value.kind)
    || value.authority !== 'none') {
    return { ok: false, reason: 'INVALID_DEFINITION' };
  }
  return {
    ok: true,
    value: {
      capabilityId: value.capabilityId.trim(),
      ownerActorId: value.ownerActorId.trim(),
      ownerOrganizationUnitId: value.ownerOrganizationUnitId.trim(),
      kind: value.kind.trim(),
      authority: 'none',
    },
  };
}

function parseCapabilityVersion(value: unknown): ParseResult<CapabilityVersion> {
  if (!hasExactDataShape(value, [
    'capabilityId',
    'version',
    'definitionHash',
    'supportedStages',
    'supportedBusinessModes',
    'supportedReviewPaths',
    'requiredEvidenceKinds',
    'allowedOutputKinds',
  ])) {
    return { ok: false, reason: 'INVALID_VERSION_SNAPSHOT' };
  }
  if (!isNonEmptyString(value.capabilityId)
    || !isNonEmptyString(value.version)
    || !isNonEmptyString(value.definitionHash)) {
    return { ok: false, reason: 'INVALID_VERSION_SNAPSHOT' };
  }

  const supportedStages = normalizeStringList(value.supportedStages, CAPABILITY_STAGES, true);
  const supportedBusinessModes = normalizeStringList(
    value.supportedBusinessModes,
    BUSINESS_MODES,
    true,
  );
  const supportedReviewPaths = normalizeStringList(value.supportedReviewPaths, REVIEW_PATHS, true);
  const requiredEvidenceKinds = normalizeStringList<string>(
    value.requiredEvidenceKinds,
    null,
    false,
  );
  const allowedOutputKinds = normalizeStringList(value.allowedOutputKinds, OUTPUT_KINDS, true);
  if (allowedOutputKinds === null) {
    return { ok: false, reason: 'OUTPUT_BOUNDARY_VIOLATION' };
  }
  if (supportedStages === null
    || supportedBusinessModes === null
    || supportedReviewPaths === null
    || requiredEvidenceKinds === null) {
    return { ok: false, reason: 'INVALID_VERSION_SNAPSHOT' };
  }

  return {
    ok: true,
    value: {
      capabilityId: value.capabilityId.trim(),
      version: value.version.trim(),
      definitionHash: value.definitionHash.trim(),
      supportedStages,
      supportedBusinessModes,
      supportedReviewPaths,
      requiredEvidenceKinds,
      allowedOutputKinds,
    },
  };
}

function eventTypeOf(value: unknown): CapabilityGovernanceEvent['eventType'] | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, 'eventType');
  if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
    return null;
  }
  return typeof descriptor.value === 'string' && EVENT_TYPES.has(descriptor.value as CapabilityGovernanceEvent['eventType'])
    ? descriptor.value as CapabilityGovernanceEvent['eventType']
    : null;
}

function parseEvent(value: unknown): ParseResult<CapabilityGovernanceEvent> {
  const eventType = eventTypeOf(value);
  if (eventType === null || !hasExactDataShape(value, EVENT_KEYS[eventType])) {
    return { ok: false, reason: 'MALFORMED_EVENT' };
  }

  const organizationScopePath = normalizePath(value.organizationScopePath);
  if (!isNonEmptyString(value.eventId)
    || !isNonEmptyString(value.capabilityId)
    || !isNonEmptyString(value.version)
    || !Number.isSafeInteger(value.governanceVersion)
    || (value.governanceVersion as number) <= 0
    || !isNonEmptyString(value.actorId)
    || organizationScopePath === null) {
    return { ok: false, reason: 'MALFORMED_EVENT' };
  }

  const envelope = {
    eventType,
    eventId: value.eventId.trim(),
    capabilityId: value.capabilityId.trim(),
    version: value.version.trim(),
    governanceVersion: value.governanceVersion as number,
    actorId: value.actorId.trim(),
    organizationScopePath,
  };

  switch (eventType) {
    case 'version_registered': {
      const definition = parseDefinition(value.definition);
      if (!definition.ok) {
        return definition;
      }
      const capabilityVersion = parseCapabilityVersion(value.capabilityVersion);
      if (!capabilityVersion.ok) {
        return capabilityVersion;
      }
      return {
        ok: true,
        value: { ...envelope, eventType, definition: definition.value, capabilityVersion: capabilityVersion.value },
      };
    }
    case 'evaluation_passed':
      return isNonEmptyString(value.evaluationId)
        ? { ok: true, value: { ...envelope, eventType, evaluationId: value.evaluationId.trim() } }
        : { ok: false, reason: 'MALFORMED_EVENT' };
    case 'approval_granted':
    case 'shadow_released':
      return isNonEmptyString(value.approvalReceiptId)
        ? { ok: true, value: { ...envelope, eventType, approvalReceiptId: value.approvalReceiptId.trim() } }
        : { ok: false, reason: 'MALFORMED_EVENT' };
    case 'activated':
    case 'resumed':
      return isNonEmptyString(value.releaseReceiptId)
        ? { ok: true, value: { ...envelope, eventType, releaseReceiptId: value.releaseReceiptId.trim() } }
        : { ok: false, reason: 'MALFORMED_EVENT' };
    case 'suspended':
      return isNonEmptyString(value.reason)
        ? { ok: true, value: { ...envelope, eventType, reason: value.reason.trim() } }
        : { ok: false, reason: 'MALFORMED_EVENT' };
    case 'rolled_back':
      return isNonEmptyString(value.rollbackReceiptId) && isNonEmptyString(value.targetVersion)
        ? {
            ok: true,
            value: {
              ...envelope,
              eventType,
              rollbackReceiptId: value.rollbackReceiptId.trim(),
              targetVersion: value.targetVersion.trim(),
            },
          }
        : { ok: false, reason: 'MALFORMED_EVENT' };
    case 'retired':
      return isNonEmptyString(value.retirementReceiptId)
        ? { ok: true, value: { ...envelope, eventType, retirementReceiptId: value.retirementReceiptId.trim() } }
        : { ok: false, reason: 'MALFORMED_EVENT' };
  }
}

function cloneDefinition(value: CapabilityDefinition): CapabilityDefinition {
  return { ...value };
}

function cloneCapabilityVersion(value: CapabilityVersion): CapabilityVersion {
  return {
    ...value,
    supportedStages: [...value.supportedStages],
    supportedBusinessModes: [...value.supportedBusinessModes],
    supportedReviewPaths: [...value.supportedReviewPaths],
    requiredEvidenceKinds: [...value.requiredEvidenceKinds],
    allowedOutputKinds: [...value.allowedOutputKinds],
  };
}

function invalidProjection(
  reason: CapabilityGovernanceInvalidReason,
  eventIndex: number | null,
): CapabilityGovernanceProjection {
  return {
    state: 'invalid',
    invalidReason: reason,
    invalidEventIndex: eventIndex,
    capabilityId: null,
    version: null,
    governanceVersion: 0,
    organizationScopePath: [],
    definition: null,
    capabilityVersion: null,
    evaluationId: null,
    approvalReceiptId: null,
    releaseReceiptId: null,
    suspensionReason: null,
    rollbackReceiptId: null,
    rollbackTargetVersion: null,
    retirementReceiptId: null,
    lastEventId: null,
    eventCount: 0,
  };
}

function cloneProjection(value: CapabilityGovernanceProjection): CapabilityGovernanceProjection {
  return {
    ...value,
    organizationScopePath: [...value.organizationScopePath],
    definition: value.definition === null ? null : cloneDefinition(value.definition),
    capabilityVersion: value.capabilityVersion === null
      ? null
      : cloneCapabilityVersion(value.capabilityVersion),
  };
}

function isAllowedTransition(
  state: CapabilityGovernanceState,
  eventType: CapabilityGovernanceEvent['eventType'],
): boolean {
  switch (eventType) {
    case 'evaluation_passed':
      return state === 'draft';
    case 'approval_granted':
      return state === 'evaluated';
    case 'shadow_released':
      return state === 'approved';
    case 'activated':
      return state === 'shadow';
    case 'suspended':
      return state === 'active';
    case 'resumed':
      return state === 'suspended';
    case 'rolled_back':
      return state === 'active' || state === 'suspended';
    case 'retired':
      return state === 'approved'
        || state === 'shadow'
        || state === 'active'
        || state === 'suspended'
        || state === 'rolled_back';
    case 'version_registered':
      return false;
  }
}

function applyEvent(
  current: CapabilityGovernanceProjection,
  event: Exclude<CapabilityGovernanceEvent, { eventType: 'version_registered' }>,
  eventIndex: number,
): CapabilityGovernanceProjection {
  if (!isAllowedTransition(current.state, event.eventType)) {
    return invalidProjection('ILLEGAL_TRANSITION', eventIndex);
  }

  const next = cloneProjection(current);
  next.governanceVersion = event.governanceVersion;
  next.lastEventId = event.eventId;
  next.eventCount = eventIndex + 1;

  switch (event.eventType) {
    case 'evaluation_passed':
      next.state = 'evaluated';
      next.evaluationId = event.evaluationId;
      break;
    case 'approval_granted':
      next.state = 'approved';
      next.approvalReceiptId = event.approvalReceiptId;
      break;
    case 'shadow_released':
      if (current.approvalReceiptId === null
        || event.approvalReceiptId !== current.approvalReceiptId) {
        return invalidProjection('LINEAGE_MISMATCH', eventIndex);
      }
      next.state = 'shadow';
      break;
    case 'activated':
      next.state = 'active';
      next.releaseReceiptId = event.releaseReceiptId;
      break;
    case 'suspended':
      next.state = 'suspended';
      next.suspensionReason = event.reason;
      break;
    case 'resumed':
      if (current.releaseReceiptId === null
        || event.releaseReceiptId !== current.releaseReceiptId) {
        return invalidProjection('LINEAGE_MISMATCH', eventIndex);
      }
      next.state = 'active';
      break;
    case 'rolled_back':
      if (event.targetVersion === current.version) {
        return invalidProjection('SAME_VERSION_ROLLBACK', eventIndex);
      }
      next.state = 'rolled_back';
      next.rollbackReceiptId = event.rollbackReceiptId;
      next.rollbackTargetVersion = event.targetVersion;
      break;
    case 'retired':
      next.state = 'retired';
      next.retirementReceiptId = event.retirementReceiptId;
      break;
  }
  return next;
}

export function reduceCapabilityGovernance(
  events: readonly unknown[],
): CapabilityGovernanceProjection {
  try {
    if (!isExactArray(events)) {
      return invalidProjection('MALFORMED_EVENT', null);
    }
    if (events.length === 0) {
      return invalidProjection('EMPTY_HISTORY', null);
    }

    const seenEventIds = new Set<string>();
    let current: CapabilityGovernanceProjection | null = null;

    for (let index = 0; index < events.length; index += 1) {
      const parsed = parseEvent(events[index]);
      if (!parsed.ok) {
        return invalidProjection(parsed.reason, index);
      }
      const event = parsed.value;

      if (seenEventIds.has(event.eventId)) {
        return invalidProjection('DUPLICATE_EVENT_ID', index);
      }
      seenEventIds.add(event.eventId);

      if (event.governanceVersion !== index + 1) {
        return invalidProjection('NON_CONTIGUOUS_GOVERNANCE_VERSION', index);
      }
      if (index === 0 && event.eventType !== 'version_registered') {
        return invalidProjection('FIRST_EVENT_NOT_REGISTERED', index);
      }

      if (event.eventType === 'version_registered') {
        if (index !== 0) {
          return invalidProjection('ILLEGAL_TRANSITION', index);
        }
        if (event.definition.capabilityId !== event.capabilityId
          || event.capabilityVersion.capabilityId !== event.capabilityId
          || event.capabilityVersion.version !== event.version) {
          return invalidProjection('SNAPSHOT_IDENTITY_MISMATCH', index);
        }
        current = {
          state: 'draft',
          invalidReason: null,
          invalidEventIndex: null,
          capabilityId: event.capabilityId,
          version: event.version,
          governanceVersion: event.governanceVersion,
          organizationScopePath: [...event.organizationScopePath],
          definition: cloneDefinition(event.definition),
          capabilityVersion: cloneCapabilityVersion(event.capabilityVersion),
          evaluationId: null,
          approvalReceiptId: null,
          releaseReceiptId: null,
          suspensionReason: null,
          rollbackReceiptId: null,
          rollbackTargetVersion: null,
          retirementReceiptId: null,
          lastEventId: event.eventId,
          eventCount: 1,
        };
        continue;
      }

      if (current === null) {
        return invalidProjection('FIRST_EVENT_NOT_REGISTERED', index);
      }
      if (event.capabilityId !== current.capabilityId || event.version !== current.version) {
        return invalidProjection('IDENTITY_MISMATCH', index);
      }
      if (!samePath(event.organizationScopePath, current.organizationScopePath)) {
        return invalidProjection('SCOPE_MISMATCH', index);
      }

      current = applyEvent(current, event, index);
      if (current.state === 'invalid') {
        return current;
      }
    }

    return current === null
      ? invalidProjection('EMPTY_HISTORY', null)
      : cloneProjection(current);
  } catch {
    return invalidProjection('MALFORMED_EVENT', null);
  }
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((segment, index) => segment === right[index]);
}
