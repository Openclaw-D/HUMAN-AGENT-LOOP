import type { V4CaseClassification } from './types.ts';
import type {
  CaseOpenedEvent,
  CandidateRecordedEvent,
  CreditApprovedEvent,
  NamedHumanDecisionFields,
  WorkAggregateInvalidReason,
  WorkAggregateProjection,
  WorkCandidateDraft,
  WorkEvent,
  WorkEventType,
  WorkLifecycleState,
  WorkHumanGate,
  WorkNamedHumanDecision,
} from './work-command-types.ts';

type DataRecord = Record<PropertyKey, unknown>;
type ParsedEvent = { ok: true; value: WorkEvent } | { ok: false };
type ApplyResult = { ok: true } | { ok: false; reason: WorkAggregateInvalidReason };

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const EVENT_TYPES = new Set<WorkEventType>([
  'case_opened',
  'evidence_accepted',
  'candidate_recorded',
  'pending_human_review',
  'supplement_requested',
  'supplement_resubmitted',
  'credit_approved',
  'attempt_rejected',
  'new_attempt_started',
  'final_vetoed',
  'credit_handoff_recorded',
]);
const BUSINESS_MODES = new Set(['direct', 'existing_return', 'new_return']);
const ACQUISITION_SOURCES = new Set([
  'supplier_referral',
  'existing_contract_list',
  'market_acquisition',
  'relationship_maintenance',
  'other',
]);
const REVIEW_PATHS = new Set(['standard', 'exception']);
const DUE_DILIGENCE_MODES = new Set([
  'business_site',
  'joint_business_credit_site',
  'remote_plus_site',
]);

const ENVELOPE_KEYS = [
  'eventId',
  'sequence',
  'eventType',
  'caseId',
  'attemptId',
  'contextVersion',
  'actorId',
  'organizationPath',
] as const;
const HUMAN_DECISION_KEYS = [
  'authoritySource',
  'authorityDecisionOutcome',
  'authorityDecisionId',
  'policyVersion',
  'decisionReceiptId',
] as const;
const EVENT_KEYS: Record<WorkEventType, readonly string[]> = {
  case_opened: [...ENVELOPE_KEYS, 'rootAttemptId', 'classification'],
  evidence_accepted: [
    ...ENVELOPE_KEYS,
    'previousContextVersion',
    'newContextVersion',
    'evidenceId',
    'evidenceKind',
    'evidenceReceiptId',
  ],
  candidate_recorded: [
    ...ENVELOPE_KEYS,
    'candidateId',
    'capabilityId',
    'capabilityVersion',
    'governanceVersion',
    'admissionDecisionId',
    'evidenceReceiptIds',
    'outputKind',
    'authority',
  ],
  pending_human_review: [...ENVELOPE_KEYS, 'gateId', 'requiredActorId'],
  supplement_requested: [
    ...ENVELOPE_KEYS,
    ...HUMAN_DECISION_KEYS,
    'requiredItems',
    'ownerActorId',
    'dueAt',
  ],
  supplement_resubmitted: [
    ...ENVELOPE_KEYS,
    'previousContextVersion',
    'newContextVersion',
    'supplementalEvidenceReceiptIds',
  ],
  credit_approved: [
    ...ENVELOPE_KEYS,
    ...HUMAN_DECISION_KEYS,
    'gateId',
    'candidateId',
    'evidenceReceiptIds',
    'rationale',
  ],
  attempt_rejected: [...ENVELOPE_KEYS, ...HUMAN_DECISION_KEYS],
  new_attempt_started: [
    ...ENVELOPE_KEYS,
    'rootAttemptId',
    'previousAttemptId',
    'newAttemptId',
    'newContextVersion',
    'inheritedEvidenceReceiptIds',
  ],
  final_vetoed: [...ENVELOPE_KEYS, ...HUMAN_DECISION_KEYS],
  credit_handoff_recorded: [
    ...ENVELOPE_KEYS,
    'handoffId',
    'sourceDecisionReceiptId',
    'destinationStage',
    'destinationAssignmentRef',
  ],
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

function normalizePath(value: unknown): string[] | null {
  if (!isExactArray(value) || value.length === 0) {
    return null;
  }
  const path: string[] = [];
  for (const segment of value) {
    if (!isNonEmptyString(segment)) {
      return null;
    }
    path.push(segment.trim());
  }
  return path;
}

function normalizeUniqueList(value: unknown, requireNonEmpty: boolean): string[] | null {
  if (!isExactArray(value) || (requireNonEmpty && value.length === 0)) {
    return null;
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isNonEmptyString(entry)) {
      return null;
    }
    const canonical = entry.trim();
    if (seen.has(canonical)) {
      return null;
    }
    seen.add(canonical);
    normalized.push(canonical);
  }
  return normalized.sort(ordinalCompare);
}

function parseClassification(value: unknown): V4CaseClassification | null {
  if (!hasExactDataShape(value, [
    'businessMode',
    'acquisitionSource',
    'reviewPath',
    'dueDiligenceMode',
  ])
    || typeof value.businessMode !== 'string'
    || !BUSINESS_MODES.has(value.businessMode)
    || typeof value.acquisitionSource !== 'string'
    || !ACQUISITION_SOURCES.has(value.acquisitionSource)
    || typeof value.reviewPath !== 'string'
    || !REVIEW_PATHS.has(value.reviewPath)
    || typeof value.dueDiligenceMode !== 'string'
    || !DUE_DILIGENCE_MODES.has(value.dueDiligenceMode)) {
    return null;
  }
  return {
    businessMode: value.businessMode as V4CaseClassification['businessMode'],
    acquisitionSource: value.acquisitionSource as V4CaseClassification['acquisitionSource'],
    reviewPath: value.reviewPath as V4CaseClassification['reviewPath'],
    dueDiligenceMode: value.dueDiligenceMode as V4CaseClassification['dueDiligenceMode'],
  };
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value !== value.trim()) {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (match === null) {
    return false;
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = month >= 1 && month <= 12
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 0;
  return day >= 1
    && day <= daysInMonth
    && hour <= 23
    && minute <= 59
    && second <= 59
    && Number.isFinite(Date.parse(value));
}

function eventTypeOf(value: unknown): WorkEventType | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, 'eventType');
  if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
    return null;
  }
  return typeof descriptor.value === 'string' && EVENT_TYPES.has(descriptor.value as WorkEventType)
    ? descriptor.value as WorkEventType
    : null;
}

function parseHumanDecisionFields(value: DataRecord): NamedHumanDecisionFields | null {
  if (value.authoritySource !== 'named_human'
    || value.authorityDecisionOutcome !== 'allowed'
    || !isNonEmptyString(value.authorityDecisionId)
    || !isNonEmptyString(value.policyVersion)
    || !isNonEmptyString(value.decisionReceiptId)) {
    return null;
  }
  return {
    authoritySource: 'named_human',
    authorityDecisionOutcome: 'allowed',
    authorityDecisionId: value.authorityDecisionId.trim(),
    policyVersion: value.policyVersion.trim(),
    decisionReceiptId: value.decisionReceiptId.trim(),
  };
}

function parseEvent(value: unknown): ParsedEvent {
  const eventType = eventTypeOf(value);
  if (eventType === null || !hasExactDataShape(value, EVENT_KEYS[eventType])) {
    return { ok: false };
  }
  const organizationPath = normalizePath(value.organizationPath);
  if (!isNonEmptyString(value.eventId)
    || !Number.isSafeInteger(value.sequence)
    || (value.sequence as number) <= 0
    || !isNonEmptyString(value.caseId)
    || !isNonEmptyString(value.attemptId)
    || !isNonEmptyString(value.contextVersion)
    || !isNonEmptyString(value.actorId)
    || organizationPath === null) {
    return { ok: false };
  }
  const envelope = {
    eventId: value.eventId.trim(),
    sequence: value.sequence as number,
    caseId: value.caseId.trim(),
    attemptId: value.attemptId.trim(),
    contextVersion: value.contextVersion.trim(),
    actorId: value.actorId.trim(),
    organizationPath,
  };

  switch (eventType) {
    case 'case_opened': {
      const classification = parseClassification(value.classification);
      return isNonEmptyString(value.rootAttemptId) && classification !== null
        ? {
            ok: true,
            value: {
              ...envelope,
              eventType,
              rootAttemptId: value.rootAttemptId.trim(),
              classification,
            },
          }
        : { ok: false };
    }
    case 'evidence_accepted':
      return isNonEmptyString(value.previousContextVersion)
        && isNonEmptyString(value.newContextVersion)
        && isNonEmptyString(value.evidenceId)
        && isNonEmptyString(value.evidenceKind)
        && isNonEmptyString(value.evidenceReceiptId)
        ? {
            ok: true,
            value: {
              ...envelope,
              eventType,
              previousContextVersion: value.previousContextVersion.trim(),
              newContextVersion: value.newContextVersion.trim(),
              evidenceId: value.evidenceId.trim(),
              evidenceKind: value.evidenceKind.trim(),
              evidenceReceiptId: value.evidenceReceiptId.trim(),
            },
          }
        : { ok: false };
    case 'candidate_recorded': {
      const evidenceReceiptIds = normalizeUniqueList(value.evidenceReceiptIds, true);
      return isNonEmptyString(value.candidateId)
        && isNonEmptyString(value.capabilityId)
        && isNonEmptyString(value.capabilityVersion)
        && Number.isSafeInteger(value.governanceVersion)
        && (value.governanceVersion as number) > 0
        && isNonEmptyString(value.admissionDecisionId)
        && evidenceReceiptIds !== null
        && value.outputKind === 'CandidateDraft'
        && value.authority === 'none'
        ? {
            ok: true,
            value: {
              ...envelope,
              eventType,
              candidateId: value.candidateId.trim(),
              capabilityId: value.capabilityId.trim(),
              capabilityVersion: value.capabilityVersion.trim(),
              governanceVersion: value.governanceVersion as number,
              admissionDecisionId: value.admissionDecisionId.trim(),
              evidenceReceiptIds,
              outputKind: 'CandidateDraft',
              authority: 'none',
            },
          }
        : { ok: false };
    }
    case 'pending_human_review':
      return isNonEmptyString(value.gateId) && isNonEmptyString(value.requiredActorId)
        ? {
            ok: true,
            value: {
              ...envelope,
              eventType,
              gateId: value.gateId.trim(),
              requiredActorId: value.requiredActorId.trim(),
            },
          }
        : { ok: false };
    case 'supplement_requested': {
      const authority = parseHumanDecisionFields(value);
      const requiredItems = normalizeUniqueList(value.requiredItems, true);
      return authority !== null
        && requiredItems !== null
        && isNonEmptyString(value.ownerActorId)
        && isIsoTimestamp(value.dueAt)
        ? {
            ok: true,
            value: {
              ...envelope,
              ...authority,
              eventType,
              requiredItems,
              ownerActorId: value.ownerActorId.trim(),
              dueAt: value.dueAt,
            },
          }
        : { ok: false };
    }
    case 'supplement_resubmitted': {
      const receiptIds = normalizeUniqueList(value.supplementalEvidenceReceiptIds, true);
      return isNonEmptyString(value.previousContextVersion)
        && isNonEmptyString(value.newContextVersion)
        && receiptIds !== null
        ? {
            ok: true,
            value: {
              ...envelope,
              eventType,
              previousContextVersion: value.previousContextVersion.trim(),
              newContextVersion: value.newContextVersion.trim(),
              supplementalEvidenceReceiptIds: receiptIds,
            },
          }
        : { ok: false };
    }
    case 'attempt_rejected':
    case 'final_vetoed': {
      const authority = parseHumanDecisionFields(value);
      return authority === null
        ? { ok: false }
        : { ok: true, value: { ...envelope, ...authority, eventType } };
    }
    case 'new_attempt_started': {
      const inheritedEvidenceReceiptIds = normalizeUniqueList(
        value.inheritedEvidenceReceiptIds,
        false,
      );
      return isNonEmptyString(value.rootAttemptId)
        && isNonEmptyString(value.previousAttemptId)
        && isNonEmptyString(value.newAttemptId)
        && isNonEmptyString(value.newContextVersion)
        && inheritedEvidenceReceiptIds !== null
        ? {
            ok: true,
            value: {
              ...envelope,
              eventType,
              rootAttemptId: value.rootAttemptId.trim(),
              previousAttemptId: value.previousAttemptId.trim(),
              newAttemptId: value.newAttemptId.trim(),
              newContextVersion: value.newContextVersion.trim(),
              inheritedEvidenceReceiptIds,
            },
          }
        : { ok: false };
    }
    case 'credit_approved': {
      const authority = parseHumanDecisionFields(value);
      const evidenceReceiptIds = normalizeUniqueList(value.evidenceReceiptIds, true);
      const rationale = typeof value.rationale === 'string'
        ? value.rationale.trim()
        : '';
      return authority !== null
        && isNonEmptyString(value.gateId)
        && isNonEmptyString(value.candidateId)
        && evidenceReceiptIds !== null
        && rationale.length >= 1
        && rationale.length <= 2000
        ? {
            ok: true,
            value: {
              ...envelope,
              ...authority,
              eventType,
              gateId: value.gateId.trim(),
              candidateId: value.candidateId.trim(),
              evidenceReceiptIds,
              rationale,
            },
          }
        : { ok: false };
    }
    case 'credit_handoff_recorded':
      return isNonEmptyString(value.handoffId)
        && isNonEmptyString(value.sourceDecisionReceiptId)
        && value.destinationStage === 'commercial'
        && isNonEmptyString(value.destinationAssignmentRef)
        ? {
            ok: true,
            value: {
              ...envelope,
              eventType,
              handoffId: value.handoffId.trim(),
              sourceDecisionReceiptId: value.sourceDecisionReceiptId.trim(),
              destinationStage: 'commercial',
              destinationAssignmentRef: value.destinationAssignmentRef.trim(),
            },
          }
        : { ok: false };
  }
}

function invalidProjection(
  reason: WorkAggregateInvalidReason,
  eventIndex: number | null,
): WorkAggregateProjection {
  return {
    state: 'invalid',
    invalidReason: reason,
    invalidEventIndex: eventIndex,
    caseId: null,
    attemptId: null,
    rootAttemptId: null,
    previousAttemptId: null,
    contextVersion: null,
    organizationPath: [],
    classification: null,
    currentStage: null,
    attemptStatus: null,
    workflowStatus: null,
    lifecycle: null,
    acceptedEvidence: [],
    inheritedEvidenceReceiptIds: [],
    candidateDraft: null,
    currentHumanGate: null,
    supplementRequest: null,
    namedHumanDecision: null,
    decisionReceiptId: null,
    handoff: null,
    eventCount: 0,
    lastEventId: null,
  };
}

function initialLifecycle(): WorkLifecycleState {
  return {
    creditStatus: 'in_review',
    commercialStatus: 'not_started',
    assetStatus: 'not_started',
    commencementStatus: 'not_started',
  };
}

function openCase(event: CaseOpenedEvent): WorkAggregateProjection | null {
  if (event.rootAttemptId !== event.attemptId) {
    return null;
  }
  return {
    state: 'valid',
    invalidReason: null,
    invalidEventIndex: null,
    caseId: event.caseId,
    attemptId: event.attemptId,
    rootAttemptId: event.rootAttemptId,
    previousAttemptId: null,
    contextVersion: event.contextVersion,
    organizationPath: [...event.organizationPath],
    classification: { ...event.classification },
    currentStage: 'credit',
    attemptStatus: 'active',
    workflowStatus: 'active',
    lifecycle: initialLifecycle(),
    acceptedEvidence: [],
    inheritedEvidenceReceiptIds: [],
    candidateDraft: null,
    currentHumanGate: null,
    supplementRequest: null,
    namedHumanDecision: null,
    decisionReceiptId: null,
    handoff: null,
    eventCount: 1,
    lastEventId: event.eventId,
  };
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((segment, index) => segment === right[index]);
}

function isContextChanging(event: WorkEvent): event is Extract<
  WorkEvent,
  { eventType: 'evidence_accepted' | 'supplement_resubmitted' }
> {
  return event.eventType === 'evidence_accepted' || event.eventType === 'supplement_resubmitted';
}

function hasValidIdentity(current: WorkAggregateProjection, event: WorkEvent): boolean {
  if (event.caseId !== current.caseId || !samePath(event.organizationPath, current.organizationPath)) {
    return false;
  }
  if (event.eventType === 'new_attempt_started') {
    return event.previousAttemptId === current.attemptId
      && event.rootAttemptId === current.rootAttemptId
      && event.newAttemptId !== current.attemptId
      && event.attemptId === event.newAttemptId
      && event.newContextVersion !== current.contextVersion
      && event.contextVersion === event.newContextVersion;
  }
  if (event.attemptId !== current.attemptId) {
    return false;
  }
  if (isContextChanging(event)) {
    return event.previousContextVersion === current.contextVersion
      && event.newContextVersion !== current.contextVersion
      && event.contextVersion === event.newContextVersion;
  }
  return event.contextVersion === current.contextVersion;
}

function receiptIds(current: WorkAggregateProjection): Set<string> {
  return new Set(current.acceptedEvidence.map((entry) => entry.evidenceReceiptId));
}

function isSubset(values: readonly string[], allowed: ReadonlySet<string>): boolean {
  return values.every((value) => allowed.has(value));
}

function canApply(current: WorkAggregateProjection, eventType: WorkEventType): boolean {
  switch (eventType) {
    case 'case_opened':
      return false;
    case 'evidence_accepted':
      return current.attemptStatus === 'active'
        && current.currentStage === 'credit'
        && (current.workflowStatus === 'active'
          || current.workflowStatus === 'pending_human_review'
          || current.workflowStatus === 'supplement_requested');
    case 'candidate_recorded':
      return current.attemptStatus === 'active'
        && current.currentStage === 'credit'
        && current.workflowStatus === 'active'
        && current.candidateDraft === null
        && current.currentHumanGate === null
        && current.acceptedEvidence.length > 0;
    case 'pending_human_review':
      return current.attemptStatus === 'active'
        && current.currentStage === 'credit'
        && current.workflowStatus === 'active'
        && current.candidateDraft !== null
        && current.currentHumanGate === null;
    case 'supplement_requested':
    case 'credit_approved':
    case 'attempt_rejected':
    case 'final_vetoed':
      return current.attemptStatus === 'active'
        && current.currentStage === 'credit'
        && current.workflowStatus === 'pending_human_review'
        && current.candidateDraft !== null
        && current.currentHumanGate !== null;
    case 'supplement_resubmitted':
      return current.attemptStatus === 'active'
        && current.currentStage === 'credit'
        && current.workflowStatus === 'supplement_requested'
        && current.supplementRequest !== null;
    case 'new_attempt_started':
      return current.attemptStatus === 'rejected'
        && current.workflowStatus === 'attempt_rejected';
    case 'credit_handoff_recorded':
      return current.attemptStatus === 'active'
        && current.currentStage === 'credit'
        && current.workflowStatus === 'credit_approved'
        && current.namedHumanDecision?.action === 'approve_credit'
        && current.decisionReceiptId !== null;
  }
}

function candidateFrom(event: CandidateRecordedEvent): WorkCandidateDraft {
  return {
    candidateId: event.candidateId,
    capabilityId: event.capabilityId,
    capabilityVersion: event.capabilityVersion,
    governanceVersion: event.governanceVersion,
    admissionDecisionId: event.admissionDecisionId,
    caseId: event.caseId,
    attemptId: event.attemptId,
    contextVersion: event.contextVersion,
    evidenceReceiptIds: [...event.evidenceReceiptIds],
    outputKind: 'CandidateDraft',
    authority: 'none',
  };
}

function decisionFrom(
  current: WorkAggregateProjection,
  event: WorkEvent & NamedHumanDecisionFields,
  action: WorkNamedHumanDecision['action'],
): WorkNamedHumanDecision {
  return {
    action,
    actorId: event.actorId,
    authoritySource: 'named_human',
    authorityDecisionOutcome: 'allowed',
    authorityDecisionId: event.authorityDecisionId,
    policyVersion: event.policyVersion,
    caseId: current.caseId as string,
    attemptId: current.attemptId as string,
    contextVersion: current.contextVersion as string,
  };
}

function hasNamedHumanAuthority(
  current: WorkAggregateProjection,
  event: WorkEvent & NamedHumanDecisionFields,
): boolean {
  const gate = current.currentHumanGate;
  const candidate = current.candidateDraft;
  return gate !== null
    && candidate !== null
    && event.authoritySource === 'named_human'
    && event.authorityDecisionOutcome === 'allowed'
    && event.actorId === gate.requiredActorId
    && event.actorId !== candidate.capabilityId
    && event.actorId !== candidate.candidateId;
}

function hasFreshDecisionReceipt(
  event: WorkEvent & NamedHumanDecisionFields,
  usedAuthorityDecisionIds: ReadonlySet<string>,
  usedDecisionReceiptIds: ReadonlySet<string>,
  usedEvidenceReceiptIds: ReadonlySet<string>,
): boolean {
  return !usedAuthorityDecisionIds.has(event.authorityDecisionId)
    && !usedDecisionReceiptIds.has(event.decisionReceiptId)
    && !usedEvidenceReceiptIds.has(event.decisionReceiptId);
}

function applyEvent(
  current: WorkAggregateProjection,
  event: Exclude<WorkEvent, CaseOpenedEvent>,
  usedAuthorityDecisionIds: Set<string>,
  usedDecisionReceiptIds: Set<string>,
  usedHandoffIds: Set<string>,
  usedEvidenceIds: Set<string>,
  usedEvidenceReceiptIds: Set<string>,
  usedCandidateIds: Set<string>,
  usedAdmissionDecisionIds: Set<string>,
  usedGateIds: Set<string>,
  supplementalEvidenceReceiptIds: Set<string>,
): ApplyResult {
  if (!canApply(current, event.eventType)) {
    return { ok: false, reason: 'ILLEGAL_TRANSITION' };
  }

  const evidenceReceipts = receiptIds(current);
  if (event.eventType === 'evidence_accepted') {
    if (usedEvidenceIds.has(event.evidenceId)
      || usedEvidenceReceiptIds.has(event.evidenceReceiptId)
      || usedDecisionReceiptIds.has(event.evidenceReceiptId)) {
      return { ok: false, reason: 'PROVENANCE_MISMATCH' };
    }
  } else if (event.eventType === 'candidate_recorded') {
    if (event.authority !== 'none'
      || event.outputKind !== 'CandidateDraft'
      || !isSubset(event.evidenceReceiptIds, evidenceReceipts)
      || usedCandidateIds.has(event.candidateId)
      || usedAdmissionDecisionIds.has(event.admissionDecisionId)) {
      return { ok: false, reason: 'PROVENANCE_MISMATCH' };
    }
  } else if (event.eventType === 'supplement_resubmitted') {
    if (!isSubset(event.supplementalEvidenceReceiptIds, evidenceReceipts)
      || !isSubset(event.supplementalEvidenceReceiptIds, supplementalEvidenceReceiptIds)) {
      return { ok: false, reason: 'PROVENANCE_MISMATCH' };
    }
  } else if (event.eventType === 'new_attempt_started') {
    if (!isSubset(event.inheritedEvidenceReceiptIds, evidenceReceipts)) {
      return { ok: false, reason: 'PROVENANCE_MISMATCH' };
    }
  }

  if (event.eventType === 'pending_human_review') {
    const candidate = current.candidateDraft as WorkCandidateDraft;
    if (event.requiredActorId === candidate.capabilityId
      || event.requiredActorId === candidate.candidateId
      || usedGateIds.has(event.gateId)) {
      return { ok: false, reason: 'HUMAN_AUTHORITY_VIOLATION' };
    }
  }

  const isFormalDecision = event.eventType === 'supplement_requested'
    || event.eventType === 'credit_approved'
    || event.eventType === 'attempt_rejected'
    || event.eventType === 'final_vetoed';
  if (isFormalDecision) {
    const formal = event as typeof event & NamedHumanDecisionFields;
    if (!hasNamedHumanAuthority(current, formal)) {
      return { ok: false, reason: 'HUMAN_AUTHORITY_VIOLATION' };
    }
    if (formal.eventType === 'credit_approved') {
      const approved = formal as CreditApprovedEvent;
      const gate = current.currentHumanGate as WorkHumanGate;
      const candidate = current.candidateDraft as WorkCandidateDraft;
      if (approved.gateId !== gate.gateId
        || approved.candidateId !== candidate.candidateId
        || approved.evidenceReceiptIds.length !== candidate.evidenceReceiptIds.length
        || !approved.evidenceReceiptIds.every((receiptId, index) => (
          receiptId === candidate.evidenceReceiptIds[index]
        ))
        || !isSubset(approved.evidenceReceiptIds, evidenceReceipts)) {
        return { ok: false, reason: 'HUMAN_AUTHORITY_VIOLATION' };
      }
    }
    const creditApproved = isFormalDecision && event.eventType === 'credit_approved'
      ? event as CreditApprovedEvent
      : null;
    if (creditApproved !== null) {
      const candidate = current.candidateDraft as WorkCandidateDraft;
      const gate = current.currentHumanGate as WorkHumanGate;
      const reservedIds = new Set([
        ...current.acceptedEvidence.map((entry) => entry.evidenceReceiptId),
        candidate.admissionDecisionId,
        candidate.candidateId,
        candidate.capabilityId,
        gate.gateId,
      ]);
      if (reservedIds.has(creditApproved.authorityDecisionId)
        || reservedIds.has(creditApproved.decisionReceiptId)) {
        return { ok: false, reason: 'RECEIPT_HANDOFF_LINEAGE_MISMATCH' };
      }
    }
    if (!hasFreshDecisionReceipt(
      formal,
      usedAuthorityDecisionIds,
      usedDecisionReceiptIds,
      usedEvidenceReceiptIds,
    )) {
      return { ok: false, reason: 'RECEIPT_HANDOFF_LINEAGE_MISMATCH' };
    }
  }

  if (event.eventType === 'credit_handoff_recorded') {
    if (event.destinationStage !== 'commercial'
      || event.sourceDecisionReceiptId !== current.decisionReceiptId
      || usedHandoffIds.has(event.handoffId)) {
      return { ok: false, reason: 'RECEIPT_HANDOFF_LINEAGE_MISMATCH' };
    }
  }

  current.eventCount = event.sequence;
  current.lastEventId = event.eventId;
  switch (event.eventType) {
    case 'evidence_accepted': {
      const isSupplementEvidence = current.workflowStatus === 'supplement_requested';
      current.contextVersion = event.newContextVersion;
      current.acceptedEvidence.push({
        evidenceId: event.evidenceId,
        evidenceKind: event.evidenceKind,
        evidenceReceiptId: event.evidenceReceiptId,
      });
      usedEvidenceIds.add(event.evidenceId);
      usedEvidenceReceiptIds.add(event.evidenceReceiptId);
      if (isSupplementEvidence) {
        supplementalEvidenceReceiptIds.add(event.evidenceReceiptId);
      }
      current.candidateDraft = null;
      current.currentHumanGate = null;
      if (current.workflowStatus !== 'supplement_requested') {
        current.workflowStatus = 'active';
        current.lifecycle = initialLifecycle();
      }
      break;
    }
    case 'candidate_recorded':
      current.candidateDraft = candidateFrom(event);
      usedCandidateIds.add(event.candidateId);
      usedAdmissionDecisionIds.add(event.admissionDecisionId);
      break;
    case 'pending_human_review':
      current.currentHumanGate = {
        gateId: event.gateId,
        requiredActorId: event.requiredActorId,
        contextVersion: event.contextVersion,
      };
      current.workflowStatus = 'pending_human_review';
      (current.lifecycle as WorkLifecycleState).creditStatus = 'pending_human_review';
      usedGateIds.add(event.gateId);
      break;
    case 'supplement_requested':
      current.namedHumanDecision = decisionFrom(current, event, 'return_for_supplement');
      current.decisionReceiptId = event.decisionReceiptId;
      current.supplementRequest = {
        requiredItems: [...event.requiredItems],
        ownerActorId: event.ownerActorId,
        dueAt: event.dueAt,
        requestedByActorId: event.actorId,
        authorityDecisionId: event.authorityDecisionId,
        decisionReceiptId: event.decisionReceiptId,
      };
      current.candidateDraft = null;
      current.currentHumanGate = null;
      current.workflowStatus = 'supplement_requested';
      (current.lifecycle as WorkLifecycleState).creditStatus = 'supplement_requested';
      usedAuthorityDecisionIds.add(event.authorityDecisionId);
      usedDecisionReceiptIds.add(event.decisionReceiptId);
      supplementalEvidenceReceiptIds.clear();
      break;
    case 'supplement_resubmitted':
      if (event.actorId !== current.supplementRequest?.ownerActorId) {
        return { ok: false, reason: 'HUMAN_AUTHORITY_VIOLATION' };
      }
      current.contextVersion = event.newContextVersion;
      current.supplementRequest = null;
      current.candidateDraft = null;
      current.currentHumanGate = null;
      current.workflowStatus = 'active';
      current.lifecycle = initialLifecycle();
      supplementalEvidenceReceiptIds.clear();
      break;
    case 'credit_approved':
      current.namedHumanDecision = decisionFrom(current, event, 'approve_credit');
      current.decisionReceiptId = event.decisionReceiptId;
      current.supplementRequest = null;
      current.currentHumanGate = null;
      current.workflowStatus = 'credit_approved';
      (current.lifecycle as WorkLifecycleState).creditStatus = 'approved';
      usedAuthorityDecisionIds.add(event.authorityDecisionId);
      usedDecisionReceiptIds.add(event.decisionReceiptId);
      break;
    case 'attempt_rejected':
      current.namedHumanDecision = decisionFrom(current, event, 'reject_current_attempt');
      current.decisionReceiptId = event.decisionReceiptId;
      current.attemptStatus = 'rejected';
      current.workflowStatus = 'attempt_rejected';
      current.currentHumanGate = null;
      (current.lifecycle as WorkLifecycleState).creditStatus = 'rejected_current_attempt';
      usedAuthorityDecisionIds.add(event.authorityDecisionId);
      usedDecisionReceiptIds.add(event.decisionReceiptId);
      break;
    case 'new_attempt_started': {
      const allowed = new Set(event.inheritedEvidenceReceiptIds);
      current.previousAttemptId = event.previousAttemptId;
      current.attemptId = event.newAttemptId;
      current.contextVersion = event.newContextVersion;
      current.attemptStatus = 'active';
      current.workflowStatus = 'active';
      current.currentStage = 'credit';
      current.lifecycle = initialLifecycle();
      current.acceptedEvidence = current.acceptedEvidence.filter((entry) => (
        allowed.has(entry.evidenceReceiptId)
      ));
      current.inheritedEvidenceReceiptIds = [...event.inheritedEvidenceReceiptIds];
      current.candidateDraft = null;
      current.currentHumanGate = null;
      current.supplementRequest = null;
      current.namedHumanDecision = null;
      current.decisionReceiptId = null;
      current.handoff = null;
      supplementalEvidenceReceiptIds.clear();
      break;
    }
    case 'final_vetoed':
      current.namedHumanDecision = decisionFrom(current, event, 'veto_final');
      current.decisionReceiptId = event.decisionReceiptId;
      current.attemptStatus = 'final_vetoed';
      current.workflowStatus = 'final_vetoed';
      current.currentHumanGate = null;
      (current.lifecycle as WorkLifecycleState).creditStatus = 'vetoed_final';
      usedAuthorityDecisionIds.add(event.authorityDecisionId);
      usedDecisionReceiptIds.add(event.decisionReceiptId);
      break;
    case 'credit_handoff_recorded':
      current.handoff = {
        handoffId: event.handoffId,
        sourceDecisionReceiptId: event.sourceDecisionReceiptId,
        destinationStage: 'commercial',
        destinationAssignmentRef: event.destinationAssignmentRef,
      };
      current.currentStage = 'commercial';
      current.workflowStatus = 'credit_handed_off';
      (current.lifecycle as WorkLifecycleState).commercialStatus = 'pending';
      usedHandoffIds.add(event.handoffId);
      break;
  }
  return { ok: true };
}

function cloneProjection(value: WorkAggregateProjection): WorkAggregateProjection {
  return structuredClone(value);
}

export function replayWorkAggregate(events: readonly unknown[]): WorkAggregateProjection {
  try {
    if (!isExactArray(events)) {
      return invalidProjection('MALFORMED_EVENT', null);
    }
    if (events.length === 0) {
      return invalidProjection('EMPTY_HISTORY', null);
    }

    const seenEventIds = new Set<string>();
    const usedAuthorityDecisionIds = new Set<string>();
    const usedDecisionReceiptIds = new Set<string>();
    const usedHandoffIds = new Set<string>();
    const usedEvidenceIds = new Set<string>();
    const usedEvidenceReceiptIds = new Set<string>();
    const usedCandidateIds = new Set<string>();
    const usedAdmissionDecisionIds = new Set<string>();
    const usedGateIds = new Set<string>();
    const supplementalEvidenceReceiptIds = new Set<string>();
    let current: WorkAggregateProjection | null = null;

    for (let index = 0; index < events.length; index += 1) {
      const parsed = parseEvent(events[index]);
      if (!parsed.ok) {
        return invalidProjection('MALFORMED_EVENT', index);
      }
      const event = parsed.value;

      if (seenEventIds.has(event.eventId)) {
        return invalidProjection('DUPLICATE_EVENT_ID', index);
      }
      seenEventIds.add(event.eventId);

      if (event.sequence !== index + 1) {
        return invalidProjection('NON_CONTIGUOUS_SEQUENCE', index);
      }
      if (index === 0 && event.eventType !== 'case_opened') {
        return invalidProjection('FIRST_EVENT_NOT_CASE_OPENED', index);
      }

      if (event.eventType === 'case_opened') {
        if (index !== 0) {
          return invalidProjection('ILLEGAL_TRANSITION', index);
        }
        current = openCase(event);
        if (current === null) {
          return invalidProjection('IDENTITY_LINEAGE_MISMATCH', index);
        }
        continue;
      }

      if (current === null) {
        return invalidProjection('FIRST_EVENT_NOT_CASE_OPENED', index);
      }
      if (!hasValidIdentity(current, event)) {
        return invalidProjection('IDENTITY_LINEAGE_MISMATCH', index);
      }

      const result = applyEvent(
        current,
        event,
        usedAuthorityDecisionIds,
        usedDecisionReceiptIds,
        usedHandoffIds,
        usedEvidenceIds,
        usedEvidenceReceiptIds,
        usedCandidateIds,
        usedAdmissionDecisionIds,
        usedGateIds,
        supplementalEvidenceReceiptIds,
      );
      if (!result.ok) {
        return invalidProjection(result.reason, index);
      }
    }

    return current === null
      ? invalidProjection('EMPTY_HISTORY', null)
      : cloneProjection(current);
  } catch {
    return invalidProjection('MALFORMED_EVENT', null);
  }
}
