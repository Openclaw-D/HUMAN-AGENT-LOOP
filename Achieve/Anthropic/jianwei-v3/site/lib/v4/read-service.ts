import { evaluateV4Authority } from './authority-policy.ts';
import { evaluateCapabilityAdmission } from './capability-admission.ts';
import { reduceCapabilityGovernance } from './capability-governance-reducer.ts';
import {
  getServerReadSnapshot,
  resolveServerReadSession,
  type ServerCaseRecord,
  type ServerReadSession,
  type ServerReadSnapshot,
} from './server-read-context.ts';
import {
  V4ReadServiceError,
  type V4CapabilityAdmissionSummary,
  type V4ManagementProjectionDto,
  type V4ReadServiceErrorCode,
  type V4WorkProjectionDto,
} from './read-model-types.ts';

type DataRecord = Record<PropertyKey, unknown>;

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const CASE_INPUT_KEYS = ['sessionId', 'caseId'] as const;
const MANAGEMENT_INPUT_KEYS = ['sessionId', 'scopeId'] as const;
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
const STAGES = new Set(['business', 'credit', 'commercial', 'asset', 'commencement']);
const CREDIT_STATUSES = new Set([
  'not_started',
  'rule_screening',
  'pending_human_review',
  'returned_for_supplement',
  'resubmitted',
  'approved_by_rule',
  'approved_by_human',
  'rejected_current_attempt',
  'vetoed_final',
]);
const READINESS_STATUSES = new Set(['not_started', 'pending', 'ready', 'blocked']);
const COMMENCEMENT_STATUSES = new Set(['not_started', 'pending', 'commenced', 'failed', 'unknown']);

function fail(code: V4ReadServiceErrorCode): never {
  throw new V4ReadServiceError(code);
}

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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseInput(
  input: unknown,
  identifierKey: 'caseId' | 'scopeId',
): { sessionId: string; identifier: string } {
  try {
    const keys = identifierKey === 'caseId' ? CASE_INPUT_KEYS : MANAGEMENT_INPUT_KEYS;
    if (!hasExactDataShape(input, keys)
      || !isNonEmptyString(input.sessionId)
      || !isNonEmptyString(input[identifierKey])) {
      return fail('INVALID_READ_INPUT');
    }
    return {
      sessionId: input.sessionId.trim(),
      identifier: input[identifierKey].trim(),
    };
  } catch (error) {
    if (error instanceof V4ReadServiceError) {
      throw error;
    }
    return fail('INVALID_READ_INPUT');
  }
}

function canonical(value: string): boolean {
  return value.length > 0 && value === value.trim();
}

function canonicalPath(value: readonly string[]): boolean {
  return value.length > 0 && value.every(canonical);
}

function stableUnique(values: readonly string[]): string[] | null {
  if (!values.every(canonical) || new Set(values).size !== values.length) {
    return null;
  }
  return [...values].sort(ordinalCompare);
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function pathContains(scopePath: readonly string[], resourcePath: readonly string[]): boolean {
  return resourcePath.length >= scopePath.length
    && scopePath.every((segment, index) => resourcePath[index] === segment);
}

function assertAuthorityAllowed(
  session: ServerReadSession,
  snapshot: ServerReadSnapshot,
  target: 'case' | 'organization',
): void {
  const caseRecord = snapshot.caseRecord;
  const isCase = target === 'case';
  const authority = evaluateV4Authority({
    actor: session.actor,
    roleAssignments: session.roleAssignments,
    action: isCase
      ? { family: 'observe', name: 'observe_case' }
      : { family: 'observe', name: 'observe_organization' },
    resource: isCase
      ? {
          resourceType: 'case',
          resourceId: caseRecord.case.caseId,
          organizationPath: caseRecord.organizationPath,
        }
      : {
          resourceType: 'organization',
          resourceId: snapshot.managementScope.scopeId,
          organizationPath: snapshot.managementScope.scopePath,
        },
    grants: session.grants,
    denies: session.denies,
    policyVersion: session.policyVersion,
    currentPolicyVersion: snapshot.currentPolicyVersion,
    expectedContextVersion: isCase ? caseRecord.case.contextVersion : null,
    currentContextVersion: isCase ? caseRecord.case.contextVersion : null,
    presentedInvitationId: null,
  });
  if (authority.outcome !== 'allowed') {
    fail('READ_DENIED');
  }
}

function assertCaseRecordConsistency(record: ServerCaseRecord): void {
  const current = record.case;
  if (!canonical(current.caseId)
    || !canonical(current.attemptId)
    || !canonical(current.contextVersion)
    || !canonicalPath(record.organizationPath)
    || !canonical(record.currentOwnerActorId)
    || !BUSINESS_MODES.has(current.classification.businessMode)
    || !ACQUISITION_SOURCES.has(current.classification.acquisitionSource)
    || !REVIEW_PATHS.has(current.classification.reviewPath)
    || !DUE_DILIGENCE_MODES.has(current.classification.dueDiligenceMode)
    || !STAGES.has(current.currentStage)
    || !CREDIT_STATUSES.has(current.lifecycle.creditStatus)
    || !READINESS_STATUSES.has(current.lifecycle.commercialStatus)
    || !READINESS_STATUSES.has(current.lifecycle.assetStatus)
    || !COMMENCEMENT_STATUSES.has(current.lifecycle.commencementStatus)
    || stableUnique(record.assignmentRefs) === null
    || stableUnique(record.anomalyCodes) === null
    || record.decisionReceipt !== null
    || record.handoff !== null) {
    fail('PROJECTION_INVALID');
  }

  const identity = [current.caseId, current.attemptId, current.contextVersion];
  for (const evidence of record.evidence) {
    if (!canonical(evidence.evidenceId)
      || !canonical(evidence.evidenceKind)
      || evidence.status !== 'accepted'
      || !sameValues(
        [evidence.caseId, evidence.attemptId, evidence.contextVersion],
        identity,
      )) {
      fail('PROJECTION_INVALID');
    }
  }
  if (new Set(record.evidence.map((entry) => entry.evidenceId)).size !== record.evidence.length) {
    fail('PROJECTION_INVALID');
  }

  const evidenceKinds = [...new Set(record.evidence.map((entry) => entry.evidenceKind))].sort(ordinalCompare);
  const availableEvidenceKinds = stableUnique(record.availableEvidenceKinds);
  if (availableEvidenceKinds === null || !sameValues(evidenceKinds, availableEvidenceKinds)) {
    fail('PROJECTION_INVALID');
  }

  const candidate = record.candidateDraft;
  if (!canonical(candidate.capabilityId)
    || !canonical(candidate.version)
    || candidate.authority !== 'none'
    || !sameValues([candidate.caseId, candidate.attemptId, candidate.contextVersion], identity)) {
    fail('PROJECTION_INVALID');
  }
  const gate = record.currentHumanGate;
  if (!canonical(gate.gateId)
    || !canonical(gate.requiredActorId)
    || gate.gateType !== 'credit_professional_review'
    || gate.status !== 'pending'
    || !sameValues([gate.caseId, gate.attemptId, gate.contextVersion], identity)) {
    fail('PROJECTION_INVALID');
  }
}

function deriveCapabilitySummary(snapshot: ServerReadSnapshot): V4CapabilityAdmissionSummary {
  const record = snapshot.caseRecord;
  const projection = reduceCapabilityGovernance(snapshot.governanceEvents);
  if (projection.state === 'invalid'
    || projection.capabilityId === null
    || projection.version === null
    || projection.capabilityVersion === null) {
    return fail('PROJECTION_INVALID');
  }

  const admission = evaluateCapabilityAdmission({
    caseId: record.case.caseId,
    attemptId: record.case.attemptId,
    contextVersion: record.case.contextVersion,
    currentContextVersion: record.case.contextVersion,
    businessMode: record.case.classification.businessMode,
    reviewPath: record.case.classification.reviewPath,
    currentStage: record.case.currentStage,
    caseOrganizationPath: record.organizationPath,
    availableEvidenceKinds: record.availableEvidenceKinds,
    requestedOutputKind: record.requestedOutputKind,
    expectedCapabilityId: record.candidateDraft.capabilityId,
    expectedCapabilityVersion: record.candidateDraft.version,
    expectedGovernanceVersion: projection.governanceVersion,
    governanceProjection: projection,
  });
  if (admission.outcome === 'unknown'
    || admission.capabilityId !== projection.capabilityId
    || admission.version !== projection.version
    || admission.governanceVersion !== projection.governanceVersion
    || record.candidateDraft.capabilityId !== projection.capabilityId
    || record.candidateDraft.version !== projection.version
    || record.candidateDraft.contextVersion !== record.case.contextVersion) {
    return fail('PROJECTION_INVALID');
  }

  return {
    capabilityId: projection.capabilityId,
    version: projection.version,
    governanceVersion: projection.governanceVersion,
    state: projection.state,
    admissionOutcome: admission.outcome,
    admissionReasonCode: admission.reasonCode,
    requestedOutputKind: record.requestedOutputKind,
    authority: 'none',
  };
}

function prepareRead(
  request: { sessionId: string; identifier: string },
  target: 'case' | 'organization',
): { snapshot: ServerReadSnapshot; capability: V4CapabilityAdmissionSummary } {
  const session = resolveServerReadSession(request.sessionId);
  if (session === null) {
    return fail('SESSION_NOT_FOUND');
  }
  const snapshot = getServerReadSnapshot();
  if (target === 'case' && request.identifier !== snapshot.caseRecord.case.caseId) {
    return fail('CASE_NOT_FOUND');
  }
  if (target === 'organization' && request.identifier !== snapshot.managementScope.scopeId) {
    return fail('SCOPE_NOT_FOUND');
  }

  assertAuthorityAllowed(session, snapshot, target);
  try {
    assertCaseRecordConsistency(snapshot.caseRecord);
    if (!canonical(snapshot.currentPolicyVersion)
      || !canonical(snapshot.managementScope.scopeId)
      || !canonicalPath(snapshot.managementScope.scopePath)
      || !pathContains(snapshot.managementScope.scopePath, snapshot.caseRecord.organizationPath)) {
      return fail('PROJECTION_INVALID');
    }
    return { snapshot, capability: deriveCapabilitySummary(snapshot) };
  } catch (error) {
    if (error instanceof V4ReadServiceError) {
      throw error;
    }
    return fail('PROJECTION_INVALID');
  }
}

function evidenceSort(
  left: { evidenceKind: string; evidenceId: string },
  right: { evidenceKind: string; evidenceId: string },
): number {
  return ordinalCompare(left.evidenceKind, right.evidenceKind)
    || ordinalCompare(left.evidenceId, right.evidenceId);
}

export function readV4CaseProjection(input: unknown): V4WorkProjectionDto {
  const request = parseInput(input, 'caseId');
  const { snapshot, capability } = prepareRead(request, 'case');
  const record = snapshot.caseRecord;
  const current = record.case;
  return {
    caseId: current.caseId,
    attemptId: current.attemptId,
    contextVersion: current.contextVersion,
    classification: { ...current.classification },
    lifecycle: { ...current.lifecycle },
    currentStage: current.currentStage,
    organizationPath: [...record.organizationPath],
    currentOwnerActorId: record.currentOwnerActorId,
    assignmentRefs: [...record.assignmentRefs].sort(ordinalCompare),
    evidence: record.evidence
      .map(({ evidenceKind, evidenceId }) => ({ evidenceKind, evidenceId }))
      .sort(evidenceSort),
    candidateDraft: {
      capabilityId: record.candidateDraft.capabilityId,
      version: record.candidateDraft.version,
      contextVersion: record.candidateDraft.contextVersion,
      authority: 'none',
    },
    currentHumanGate: {
      gateId: record.currentHumanGate.gateId,
      gateType: record.currentHumanGate.gateType,
      requiredActorId: record.currentHumanGate.requiredActorId,
      status: record.currentHumanGate.status,
    },
    decisionReceipt: null,
    handoff: null,
    capabilityAdmission: { ...capability },
  };
}

export function readV4ManagementProjection(input: unknown): V4ManagementProjectionDto {
  const request = parseInput(input, 'scopeId');
  const { snapshot, capability } = prepareRead(request, 'organization');
  const current = snapshot.caseRecord.case;
  const cases = [{
    caseId: current.caseId,
    attemptId: current.attemptId,
    contextVersion: current.contextVersion,
    currentStage: current.currentStage,
    lifecycle: { ...current.lifecycle },
    anomalyCodes: [...snapshot.caseRecord.anomalyCodes].sort(ordinalCompare),
  }].sort((left, right) => ordinalCompare(left.caseId, right.caseId)
    || ordinalCompare(left.attemptId, right.attemptId));

  return {
    scopeId: snapshot.managementScope.scopeId,
    scopePath: [...snapshot.managementScope.scopePath],
    policyVersion: snapshot.currentPolicyVersion,
    cases,
    capabilityAdmission: { ...capability },
  };
}
