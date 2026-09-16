import { evaluateCapabilityAdmission } from './capability-admission.ts';
import { reduceCapabilityGovernance } from './capability-governance-reducer.ts';
import { evaluateV4Authority } from './authority-policy.ts';
import { replayWorkAggregate } from './work-aggregate.ts';
import {
  V4WorkCommandHandlerError,
  type CandidateRecordedEvent,
  type CreditApprovedEvent,
  type EvidenceAcceptedEvent,
  type V4CandidateReceipt,
  type V4CreditDecisionReceipt,
  type V4EvidenceReceipt,
  type V4WorkCommand,
  type V4WorkCommandHandlerErrorCode,
  type V4WorkCommandInput,
  type V4WorkCommandResult,
  type PendingHumanReviewEvent,
  type V4SubmitCreditDecisionCommandReceipt,
} from './work-command-types.ts';
import type {
  V4ActorIdentity,
} from './authority-types.ts';
import type {
  V4CreditReviewAssignment,
  V4PreparedCandidateRecord,
  V4WorkStore,
} from './work-store.ts';

type DataRecord = Record<PropertyKey, unknown>;

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const INPUT_KEYS = ['sessionId', 'command'] as const;
const COMMAND_KEYS = [
  'requestId',
  'idempotencyKey',
  'operation',
  'expectedContextVersion',
  'payload',
] as const;
const ACCEPT_EVIDENCE_PAYLOAD_KEYS = ['caseId', 'evidenceId', 'evidenceKind'] as const;
const RECORD_CANDIDATE_PAYLOAD_KEYS = ['caseId', 'preparedCandidateRef'] as const;
const SUBMIT_CREDIT_DECISION_PAYLOAD_KEYS = [
  'caseId',
  'action',
  'rationale',
] as const;
const PREPARED_CANDIDATE_KEYS = [
  'preparedCandidateRef',
  'candidateId',
  'capabilityId',
  'capabilityVersion',
  'observedGovernanceVersion',
  'caseId',
  'attemptId',
  'contextVersion',
  'evidenceReceiptIds',
  'outputKind',
  'authority',
] as const;
const ASSIGNMENT_KEYS = ['caseId', 'assignmentRef', 'requiredActorId'] as const;
const ACTOR_KEYS = ['actorId', 'kind', 'organizationPath', 'externalInvitation'] as const;
const EXTERNAL_INVITATION_KEYS = [
  'invitationId',
  'caseId',
  'organizationPath',
] as const;
const ID_MAX_LENGTH = 128;
const EVIDENCE_KIND_MAX_LENGTH = 64;
const RATIONALE_MAX_LENGTH = 2000;

function fail(code: V4WorkCommandHandlerErrorCode): never {
  throw new V4WorkCommandHandlerError(code);
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

function canonicalBounded(value: unknown, maximumLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const canonical = value.trim();
  return canonical.length > 0 && canonical.length <= maximumLength ? canonical : null;
}

function exactStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((item) => (
    typeof item === 'string'
    && item.trim().length > 0
    && item.trim().length <= ID_MAX_LENGTH
  ));
}

function isHumanGateActor(
  value: unknown,
  caseId: string,
  requiredActorId: string,
): value is V4ActorIdentity {
  if (!hasExactDataShape(value, ACTOR_KEYS)) {
    return false;
  }
  const actorId = canonicalBounded(value.actorId, ID_MAX_LENGTH);
  if (actorId === null || value.actorId !== actorId || actorId !== requiredActorId) {
    return false;
  }
  if (value.kind === 'internal_human') {
    return value.organizationPath !== null
      && exactStringArray(value.organizationPath)
      && value.organizationPath.length > 0
      && value.externalInvitation === null;
  }
  if (value.kind !== 'external_human') {
    return false;
  }
  if (value.organizationPath !== null || !hasExactDataShape(
    value.externalInvitation,
    EXTERNAL_INVITATION_KEYS,
  )) {
    return false;
  }
  const invitationId = canonicalBounded(
    value.externalInvitation.invitationId,
    ID_MAX_LENGTH,
  );
  const invitationCaseId = canonicalBounded(
    value.externalInvitation.caseId,
    ID_MAX_LENGTH,
  );
  return invitationId !== null
    && invitationCaseId === caseId
    && exactStringArray(value.externalInvitation.organizationPath)
    && value.externalInvitation.organizationPath.length > 0;
}

function parseInput(value: unknown): V4WorkCommandInput | null {
  try {
    if (!hasExactDataShape(value, INPUT_KEYS)
      || !hasExactDataShape(value.command, COMMAND_KEYS)) {
      return null;
    }
    const sessionId = canonicalBounded(value.sessionId, ID_MAX_LENGTH);
    const requestId = canonicalBounded(value.command.requestId, ID_MAX_LENGTH);
    const idempotencyKey = canonicalBounded(value.command.idempotencyKey, ID_MAX_LENGTH);
    const expectedContextVersion = canonicalBounded(
      value.command.expectedContextVersion,
      ID_MAX_LENGTH,
    );
    if (sessionId === null
      || requestId === null
      || idempotencyKey === null
      || expectedContextVersion === null) {
      return null;
    }

    if (value.command.operation === 'accept_evidence') {
      if (!hasExactDataShape(value.command.payload, ACCEPT_EVIDENCE_PAYLOAD_KEYS)) {
        return null;
      }
      const caseId = canonicalBounded(value.command.payload.caseId, ID_MAX_LENGTH);
      const evidenceId = canonicalBounded(value.command.payload.evidenceId, ID_MAX_LENGTH);
      const evidenceKind = canonicalBounded(
        value.command.payload.evidenceKind,
        EVIDENCE_KIND_MAX_LENGTH,
      );
      if (caseId === null || evidenceId === null || evidenceKind === null) {
        return null;
      }
      return {
        sessionId,
        command: {
          requestId,
          idempotencyKey,
          operation: 'accept_evidence',
          expectedContextVersion,
          payload: { caseId, evidenceId, evidenceKind },
        },
      };
    }

    if (value.command.operation === 'record_candidate') {
      if (!hasExactDataShape(value.command.payload, RECORD_CANDIDATE_PAYLOAD_KEYS)) {
        return null;
      }
      const caseId = canonicalBounded(value.command.payload.caseId, ID_MAX_LENGTH);
      const preparedCandidateRef = canonicalBounded(
        value.command.payload.preparedCandidateRef,
        ID_MAX_LENGTH,
      );
      if (caseId === null || preparedCandidateRef === null) {
        return null;
      }
      return {
        sessionId,
        command: {
          requestId,
          idempotencyKey,
          operation: 'record_candidate',
          expectedContextVersion,
          payload: { caseId, preparedCandidateRef },
        },
      };
    }

    if (value.command.operation === 'submit_credit_decision') {
      if (!hasExactDataShape(value.command.payload, SUBMIT_CREDIT_DECISION_PAYLOAD_KEYS)) {
        return null;
      }
      const caseId = canonicalBounded(value.command.payload.caseId, ID_MAX_LENGTH);
      const rationale = canonicalBounded(value.command.payload.rationale, RATIONALE_MAX_LENGTH);
      if (caseId === null
        || value.command.payload.action !== 'approve_credit'
        || rationale === null) {
        return null;
      }
      return {
        sessionId,
        command: {
          requestId,
          idempotencyKey,
          operation: 'submit_credit_decision',
          expectedContextVersion,
          payload: { caseId, action: 'approve_credit', rationale },
        },
      };
    }
    return null;
  } catch {
    return null;
  }
}

function requestHash(actorId: string, command: V4WorkCommand): string {
  return JSON.stringify({
    actorId,
    operation: command.operation,
    caseId: command.payload.caseId,
    expectedContextVersion: command.expectedContextVersion,
    payload: command.operation === 'accept_evidence'
      ? {
          caseId: command.payload.caseId,
          evidenceId: command.payload.evidenceId,
          evidenceKind: command.payload.evidenceKind,
        }
      : command.operation === 'record_candidate'
        ? {
            caseId: command.payload.caseId,
            preparedCandidateRef: command.payload.preparedCandidateRef,
          }
        : {
            action: command.payload.action,
            caseId: command.payload.caseId,
            rationale: command.payload.rationale,
          },
  });
}

function idempotencyScope(caseId: string, actorId: string, idempotencyKey: string): string {
  return JSON.stringify([caseId, actorId, idempotencyKey]);
}

function generatedId(prefix: string, sequence: number, used: ReadonlySet<string>): string {
  const base = `${prefix}-${String(sequence).padStart(6, '0')}`;
  if (!used.has(base)) {
    return base;
  }
  for (let suffix = 1; suffix <= used.size + 1; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  throw new Error('GENERATED_ID_EXHAUSTED');
}

function historicalContextVersions(events: readonly unknown[]): Set<string> {
  const values = new Set<string>();
  const fields = ['contextVersion', 'previousContextVersion', 'newContextVersion'] as const;
  for (const event of events) {
    if (!isPlainRecord(event)) {
      continue;
    }
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(event, field);
      if (descriptor && 'value' in descriptor && typeof descriptor.value === 'string') {
        values.add(descriptor.value.trim());
      }
    }
  }
  return values;
}

function canonicalServerId(value: unknown): string | null {
  const canonical = canonicalBounded(value, ID_MAX_LENGTH);
  return canonical !== null && canonical === value ? canonical : null;
}

function canonicalUniqueServerIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const canonical: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const identifier = canonicalServerId(entry);
    if (identifier === null || seen.has(identifier)) {
      return null;
    }
    seen.add(identifier);
    canonical.push(identifier);
  }
  return canonical;
}

function parsePreparedCandidate(value: unknown): V4PreparedCandidateRecord | null {
  if (!hasExactDataShape(value, PREPARED_CANDIDATE_KEYS)) {
    return null;
  }
  const preparedCandidateRef = canonicalServerId(value.preparedCandidateRef);
  const candidateId = canonicalServerId(value.candidateId);
  const capabilityId = canonicalServerId(value.capabilityId);
  const capabilityVersion = canonicalServerId(value.capabilityVersion);
  const caseId = canonicalServerId(value.caseId);
  const attemptId = canonicalServerId(value.attemptId);
  const contextVersion = canonicalServerId(value.contextVersion);
  const evidenceReceiptIds = canonicalUniqueServerIds(value.evidenceReceiptIds);
  if (preparedCandidateRef === null
    || candidateId === null
    || capabilityId === null
    || capabilityVersion === null
    || !Number.isSafeInteger(value.observedGovernanceVersion)
    || (value.observedGovernanceVersion as number) <= 0
    || caseId === null
    || attemptId === null
    || contextVersion === null
    || evidenceReceiptIds === null
    || value.outputKind !== 'CandidateDraft'
    || value.authority !== 'none') {
    return null;
  }
  return {
    preparedCandidateRef,
    candidateId,
    capabilityId,
    capabilityVersion,
    observedGovernanceVersion: value.observedGovernanceVersion as number,
    caseId,
    attemptId,
    contextVersion,
    evidenceReceiptIds,
    outputKind: 'CandidateDraft',
    authority: 'none',
  };
}

function parseCreditReviewAssignment(value: unknown): V4CreditReviewAssignment | null {
  if (!hasExactDataShape(value, ASSIGNMENT_KEYS)) {
    return null;
  }
  const caseId = canonicalServerId(value.caseId);
  const assignmentRef = canonicalServerId(value.assignmentRef);
  const requiredActorId = canonicalServerId(value.requiredActorId);
  return caseId === null || assignmentRef === null || requiredActorId === null
    ? null
    : { caseId, assignmentRef, requiredActorId };
}

function capabilityHistoryKey(capabilityId: string, capabilityVersion: string): string {
  return JSON.stringify([capabilityId, capabilityVersion]);
}

function collectStoredStrings(
  value: unknown,
  values: Set<string>,
  visited: WeakSet<object>,
): void {
  if (typeof value === 'string') {
    values.add(value.trim());
    return;
  }
  if (typeof value !== 'object' || value === null || visited.has(value)) {
    return;
  }
  visited.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStoredStrings(entry, values, visited);
    }
    return;
  }
  if (value instanceof Map) {
    for (const [key, entry] of value.entries()) {
      collectStoredStrings(key, values, visited);
      collectStoredStrings(entry, values, visited);
    }
    return;
  }
  if (!isPlainRecord(value)) {
    return;
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) {
      collectStoredStrings(descriptor.value, values, visited);
    }
  }
}

function historicalIdentityNamespace(...sources: readonly unknown[]): Set<string> {
  const values = new Set<string>();
  const visited = new WeakSet<object>();
  for (const source of sources) {
    collectStoredStrings(source, values, visited);
  }
  return values;
}

function failAdmission(outcome: 'ineligible' | 'denied' | 'unknown'): never {
  switch (outcome) {
    case 'ineligible':
      return fail('ADMISSION_INELIGIBLE');
    case 'denied':
      return fail('ADMISSION_DENIED');
    case 'unknown':
      return fail('ADMISSION_UNKNOWN');
  }
}

export type V4WorkCommandExecutor = (
  input: unknown,
) => V4WorkCommandResult;

export function createV4WorkCommandHandler(store: V4WorkStore): V4WorkCommandExecutor {
  return function executeV4WorkCommand(input: unknown): V4WorkCommandResult {
    const parsed = parseInput(input);
    if (parsed === null) {
      return fail('INVALID_COMMAND');
    }
    const { sessionId, command } = parsed;
    const caseId = command.payload.caseId;

    try {
      return store.transact(sessionId, caseId, (transaction) => {
        const session = transaction.session;
        if (session === null) {
          return fail('SESSION_NOT_FOUND');
        }
        const caseState = transaction.caseState;
        if (caseState === null) {
          return fail('CASE_NOT_FOUND');
        }

        const current = replayWorkAggregate(caseState.events);
        if (current.state !== 'valid'
          || current.caseId === null
          || current.caseId !== caseId
          || current.attemptId === null
          || current.contextVersion === null) {
          return fail('CORRUPT_HISTORY');
        }

        const actorId = session.actor.actorId.trim();
        const scopeKey = idempotencyScope(caseId, actorId, command.idempotencyKey);
        const canonicalHash = requestHash(actorId, command);
        const existing = caseState.idempotencyRecords.get(scopeKey);
        if (existing !== undefined) {
          if (existing.requestHash !== canonicalHash) {
            return fail('IDEMPOTENCY_CONFLICT');
          }
          return { value: existing.result, commit: false };
        }

        const authority = evaluateV4Authority({
          actor: session.actor,
          roleAssignments: session.roleAssignments,
          action: command.operation === 'submit_credit_decision'
            ? { family: 'professional_decide', name: 'credit_decide' }
            : {
                family: 'prepare',
                name: command.operation === 'accept_evidence'
                  ? 'prepare_evidence_draft'
                  : 'prepare_candidate_draft',
              },
          resource: {
            resourceType: 'case',
            resourceId: current.caseId,
            organizationPath: [...current.organizationPath],
          },
          grants: session.grants,
          denies: session.denies,
          policyVersion: transaction.currentPolicyVersion,
          currentPolicyVersion: transaction.currentPolicyVersion,
          expectedContextVersion: current.contextVersion,
          currentContextVersion: current.contextVersion,
          presentedInvitationId: session.presentedInvitationId,
        });
        if (authority.outcome === 'unknown') {
          return fail('AUTHORITY_UNKNOWN');
        }
        if (authority.outcome !== 'allowed') {
          return fail('AUTHORITY_DENIED');
        }
        if (command.expectedContextVersion !== current.contextVersion) {
          return fail('STALE_CONTEXT');
        }

        if (command.operation === 'submit_credit_decision') {
          const gate = current.currentHumanGate;
          if (current.workflowStatus !== 'pending_human_review'
            || gate === null
            || gate.contextVersion !== current.contextVersion) {
            return fail('HUMAN_GATE_NOT_PENDING');
          }
          if (!isHumanGateActor(session.actor, current.caseId, actorId)
            || actorId !== gate.requiredActorId) {
            return fail('HUMAN_GATE_ACTOR_MISMATCH');
          }

          const candidate = current.candidateDraft;
          const acceptedReceiptIds = new Set(
            current.acceptedEvidence.map((entry) => entry.evidenceReceiptId),
          );
          if (candidate === null
            || candidate.caseId !== current.caseId
            || candidate.attemptId !== current.attemptId
            || candidate.contextVersion !== current.contextVersion
            || candidate.evidenceReceiptIds.length === 0
            || !candidate.evidenceReceiptIds.every(
              (receiptId) => acceptedReceiptIds.has(receiptId),
            )) {
            return fail('DECISION_LINEAGE_INVALID');
          }

          const assignment = parseCreditReviewAssignment(
            transaction.creditReviewAssignments.get(current.caseId),
          );
          const matchingCandidateReceipts = caseState.candidateReceipts.filter((receipt) => (
            receipt.caseId === current.caseId
            && receipt.attemptId === current.attemptId
            && receipt.contextVersion === current.contextVersion
            && receipt.candidateId === candidate.candidateId
            && receipt.gateId === gate.gateId
            && receipt.requiredActorId === gate.requiredActorId
            && receipt.evidenceReceiptIds.length === candidate.evidenceReceiptIds.length
            && receipt.evidenceReceiptIds.every((id, index) => id === candidate.evidenceReceiptIds[index])
          ));
          const projectionEvidence = new Map(
            current.acceptedEvidence.map((entry) => [entry.evidenceReceiptId, entry]),
          );
          const canonicalEvidence = candidate.evidenceReceiptIds.every((receiptId) => {
            const projectionEntry = projectionEvidence.get(receiptId);
            const stored = caseState.evidenceReceipts.filter((receipt) => (
              receipt.evidenceReceiptId === receiptId
              && receipt.caseId === current.caseId
              && receipt.attemptId === current.attemptId
              && receipt.status === 'committed'
            ));
            return projectionEntry !== undefined && stored.length === 1;
          });
          if (assignment === null
            || assignment.caseId !== current.caseId
            || assignment.requiredActorId !== actorId
            || assignment.requiredActorId !== gate.requiredActorId
            || matchingCandidateReceipts.length !== 1
            || matchingCandidateReceipts[0].assignmentRef !== assignment.assignmentRef
            || !canonicalEvidence) {
            return fail('DECISION_LINEAGE_INVALID');
          }

          const sequence = current.eventCount + 1;
          const usedIds = historicalIdentityNamespace(
            caseState.events,
            caseState.evidenceReceipts,
            caseState.candidateReceipts,
            caseState.decisionReceipts,
            caseState.idempotencyRecords,
            transaction.actors,
            transaction.preparedCandidates,
            transaction.capabilityGovernanceHistories,
            transaction.creditReviewAssignments,
            transaction.currentPolicyVersion,
          );
          const eventId = generatedId('V4-WORK-EVENT', sequence, usedIds);
          usedIds.add(eventId);
          const authorityDecisionId = generatedId(
            'V4-AUTHORITY-DECISION',
            sequence,
            usedIds,
          );
          usedIds.add(authorityDecisionId);
          const decisionReceiptId = generatedId(
            'V4-DECISION-RECEIPT',
            sequence,
            usedIds,
          );

          const event: CreditApprovedEvent = {
            eventId,
            sequence,
            eventType: 'credit_approved',
            caseId: current.caseId,
            attemptId: current.attemptId,
            contextVersion: current.contextVersion,
            actorId,
            organizationPath: [...current.organizationPath],
            authoritySource: 'named_human',
            authorityDecisionOutcome: 'allowed',
            authorityDecisionId,
            policyVersion: transaction.currentPolicyVersion,
            decisionReceiptId,
            gateId: gate.gateId,
            candidateId: candidate.candidateId,
            evidenceReceiptIds: [...candidate.evidenceReceiptIds],
            rationale: command.payload.rationale,
          };
          const nextEvents = [...caseState.events, event];
          const projection = replayWorkAggregate(nextEvents);
          if (projection.state !== 'valid'
            || projection.caseId !== current.caseId
            || projection.attemptId !== current.attemptId
            || projection.contextVersion !== current.contextVersion
            || projection.lastEventId !== eventId
            || projection.eventCount !== sequence
            || projection.workflowStatus !== 'credit_approved'
            || projection.currentHumanGate !== null
            || projection.namedHumanDecision?.action !== 'approve_credit'
            || projection.namedHumanDecision.actorId !== actorId
            || projection.decisionReceiptId !== decisionReceiptId
            || projection.lifecycle?.creditStatus !== 'approved'
            || projection.lifecycle.commercialStatus !== 'not_started'
            || projection.lifecycle.assetStatus !== 'not_started'
            || projection.lifecycle.commencementStatus !== 'not_started') {
            return fail('TRANSACTION_FAILED');
          }

          const decisionReceipt: V4CreditDecisionReceipt = {
            decisionReceiptId,
            receiptType: 'credit_decision',
            status: 'committed',
            action: 'approve_credit',
            caseId: current.caseId,
            attemptId: current.attemptId,
            actorId,
            contextVersion: current.contextVersion,
            authoritySource: 'named_human',
            authorityDecisionOutcome: 'allowed',
            authorityDecisionId,
            policyVersion: transaction.currentPolicyVersion,
            gateId: gate.gateId,
            candidateId: candidate.candidateId,
            evidenceReceiptIds: [...candidate.evidenceReceiptIds],
            rationale: command.payload.rationale,
            eventId,
            sequence,
          };
          const receipt: V4SubmitCreditDecisionCommandReceipt = {
            status: 'committed',
            requestId: command.requestId,
            idempotencyKey: command.idempotencyKey,
            operation: 'submit_credit_decision',
            caseId: current.caseId,
            attemptId: current.attemptId,
            actorId,
            policyVersion: transaction.currentPolicyVersion,
            contextVersion: current.contextVersion,
            decisionReceiptId,
            authorityDecisionId,
            gateId: gate.gateId,
            candidateId: candidate.candidateId,
            evidenceReceiptIds: [...candidate.evidenceReceiptIds],
            rationale: command.payload.rationale,
            eventId,
            sequence,
          };
          const result: V4WorkCommandResult = { receipt, projection };

          caseState.events = nextEvents;
          caseState.decisionReceipts.push(decisionReceipt);
          caseState.projection = projection;
          caseState.idempotencyRecords.set(scopeKey, {
            scopeKey,
            requestHash: canonicalHash,
            result,
          });
          return { value: result, commit: true };
        }

        if (command.operation === 'accept_evidence') {
          if (current.acceptedEvidence.some(
            (entry) => entry.evidenceId === command.payload.evidenceId,
          )) {
            return fail('INVALID_COMMAND');
          }

        const sequence = current.eventCount + 1;
        const usedEventIds = new Set(
          caseState.events.map((event) => (
            isPlainRecord(event) && typeof event.eventId === 'string' ? event.eventId : ''
          )),
        );
        const usedReceiptIds = new Set(
          caseState.evidenceReceipts.map((receipt) => receipt.evidenceReceiptId),
        );
        const eventId = generatedId('V4-WORK-EVENT', sequence, usedEventIds);
        const evidenceReceiptId = generatedId(
          'V4-EVIDENCE-RECEIPT',
          sequence,
          usedReceiptIds,
        );
        const contextCandidates = historicalContextVersions(caseState.events);
        const newContextVersion = generatedId('V4-CONTEXT', sequence, contextCandidates);
        const event: EvidenceAcceptedEvent = {
          eventId,
          sequence,
          eventType: 'evidence_accepted',
          caseId: current.caseId,
          attemptId: current.attemptId,
          contextVersion: newContextVersion,
          actorId,
          organizationPath: [...current.organizationPath],
          previousContextVersion: current.contextVersion,
          newContextVersion,
          evidenceId: command.payload.evidenceId,
          evidenceKind: command.payload.evidenceKind,
          evidenceReceiptId,
        };
        const nextEvents = [...caseState.events, event];
        const projection = replayWorkAggregate(nextEvents);
        if (projection.state !== 'valid'
          || projection.caseId !== event.caseId
          || projection.attemptId !== event.attemptId
          || projection.contextVersion !== event.newContextVersion
          || projection.lastEventId !== event.eventId
          || projection.eventCount !== event.sequence) {
          return fail('TRANSACTION_FAILED');
        }

        const evidenceReceipt: V4EvidenceReceipt = {
          evidenceReceiptId,
          receiptType: 'evidence_accepted',
          status: 'committed',
          caseId: event.caseId,
          attemptId: event.attemptId,
          actorId,
          evidenceId: event.evidenceId,
          evidenceKind: event.evidenceKind,
          previousContextVersion: event.previousContextVersion,
          newContextVersion: event.newContextVersion,
          eventId: event.eventId,
          sequence: event.sequence,
        };
        const result: V4WorkCommandResult = {
          receipt: {
            status: 'committed',
            requestId: command.requestId,
            idempotencyKey: command.idempotencyKey,
            operation: 'accept_evidence',
            caseId: event.caseId,
            attemptId: event.attemptId,
            actorId,
            policyVersion: transaction.currentPolicyVersion,
            previousContextVersion: event.previousContextVersion,
            newContextVersion: event.newContextVersion,
            eventId: event.eventId,
            evidenceReceiptId,
          },
          projection,
        };

        caseState.events = nextEvents;
        caseState.evidenceReceipts.push(evidenceReceipt);
        caseState.projection = projection;
        caseState.idempotencyRecords.set(scopeKey, {
          scopeKey,
          requestHash: canonicalHash,
          result,
        });
          return { value: result, commit: true };
        }

        const preparedRaw = transaction.preparedCandidates.get(
          command.payload.preparedCandidateRef,
        );
        if (preparedRaw === undefined) {
          return fail('PREPARED_CANDIDATE_NOT_FOUND');
        }
        const prepared = parsePreparedCandidate(preparedRaw);
        if (prepared === null
          || prepared.preparedCandidateRef !== command.payload.preparedCandidateRef
          || prepared.caseId !== current.caseId
          || prepared.attemptId !== current.attemptId
          || prepared.contextVersion !== current.contextVersion) {
          return fail('CANDIDATE_PROVENANCE_INVALID');
        }
        const acceptedReceiptIds = new Set(
          current.acceptedEvidence.map((evidence) => evidence.evidenceReceiptId),
        );
        if (!prepared.evidenceReceiptIds.every((receiptId) => acceptedReceiptIds.has(receiptId))) {
          return fail('CANDIDATE_PROVENANCE_INVALID');
        }

        const governanceHistory = transaction.capabilityGovernanceHistories.get(
          capabilityHistoryKey(prepared.capabilityId, prepared.capabilityVersion),
        );
        if (governanceHistory === undefined) {
          return fail('GOVERNANCE_INVALID');
        }
        const governance = reduceCapabilityGovernance(governanceHistory);
        if (governance.state === 'invalid'
          || governance.capabilityId !== prepared.capabilityId
          || governance.version !== prepared.capabilityVersion) {
          return fail('GOVERNANCE_INVALID');
        }
        if (prepared.observedGovernanceVersion !== governance.governanceVersion) {
          return fail('GOVERNANCE_STALE');
        }
        if (current.classification === null || current.currentStage === null) {
          return fail('CORRUPT_HISTORY');
        }

        const admission = evaluateCapabilityAdmission({
          caseId: current.caseId,
          attemptId: current.attemptId,
          contextVersion: current.contextVersion,
          currentContextVersion: current.contextVersion,
          businessMode: current.classification.businessMode,
          reviewPath: current.classification.reviewPath,
          currentStage: current.currentStage,
          caseOrganizationPath: [...current.organizationPath],
          availableEvidenceKinds: current.acceptedEvidence.map((evidence) => evidence.evidenceKind),
          requestedOutputKind: 'CandidateDraft',
          expectedCapabilityId: prepared.capabilityId,
          expectedCapabilityVersion: prepared.capabilityVersion,
          expectedGovernanceVersion: prepared.observedGovernanceVersion,
          governanceProjection: governance,
        });
        if (admission.outcome !== 'eligible') {
          return failAdmission(admission.outcome);
        }
        if (admission.reasonCode !== 'ELIGIBLE') {
          return fail('ADMISSION_UNKNOWN');
        }

        const assignmentRaw = transaction.creditReviewAssignments.get(current.caseId);
        const assignment = parseCreditReviewAssignment(assignmentRaw);
        if (assignment === null
          || assignment.caseId !== current.caseId
          || assignment.requiredActorId === prepared.capabilityId
          || assignment.requiredActorId === prepared.candidateId) {
          return fail('HUMAN_GATE_ASSIGNMENT_MISSING');
        }

        const candidateSequence = current.eventCount + 1;
        const gateSequence = candidateSequence + 1;
        const usedIds = historicalIdentityNamespace(
          caseState.events,
          caseState.evidenceReceipts,
          caseState.candidateReceipts,
          transaction.preparedCandidates,
          transaction.capabilityGovernanceHistories,
          transaction.creditReviewAssignments,
        );
        const candidateEventId = generatedId('V4-WORK-EVENT', candidateSequence, usedIds);
        usedIds.add(candidateEventId);
        const gateEventId = generatedId('V4-WORK-EVENT', gateSequence, usedIds);
        usedIds.add(gateEventId);
        const admissionDecisionId = generatedId(
          'V4-ADMISSION-DECISION',
          candidateSequence,
          usedIds,
        );
        usedIds.add(admissionDecisionId);
        const candidateReceiptId = generatedId(
          'V4-CANDIDATE-RECEIPT',
          candidateSequence,
          usedIds,
        );
        usedIds.add(candidateReceiptId);
        const gateId = generatedId('V4-HUMAN-GATE', gateSequence, usedIds);

        const assignedActor = transaction.actors.get(assignment.requiredActorId);
        if (
          assignedActor === undefined
          || !isHumanGateActor(assignedActor, current.caseId, assignment.requiredActorId)
        ) {
          return fail('HUMAN_GATE_ASSIGNMENT_MISSING');
        }

        const candidateEvent: CandidateRecordedEvent = {
          eventId: candidateEventId,
          sequence: candidateSequence,
          eventType: 'candidate_recorded',
          caseId: current.caseId,
          attemptId: current.attemptId,
          contextVersion: current.contextVersion,
          actorId,
          organizationPath: [...current.organizationPath],
          candidateId: prepared.candidateId,
          capabilityId: prepared.capabilityId,
          capabilityVersion: prepared.capabilityVersion,
          governanceVersion: governance.governanceVersion,
          admissionDecisionId,
          evidenceReceiptIds: [...prepared.evidenceReceiptIds],
          outputKind: 'CandidateDraft',
          authority: 'none',
        };
        const gateEvent: PendingHumanReviewEvent = {
          eventId: gateEventId,
          sequence: gateSequence,
          eventType: 'pending_human_review',
          caseId: current.caseId,
          attemptId: current.attemptId,
          contextVersion: current.contextVersion,
          actorId,
          organizationPath: [...current.organizationPath],
          gateId,
          requiredActorId: assignment.requiredActorId,
        };
        const nextEvents = [...caseState.events, candidateEvent, gateEvent];
        const projection = replayWorkAggregate(nextEvents);
        if (projection.state !== 'valid'
          || projection.caseId !== current.caseId
          || projection.attemptId !== current.attemptId
          || projection.contextVersion !== current.contextVersion
          || projection.lastEventId !== gateEventId
          || projection.eventCount !== gateSequence
          || projection.workflowStatus !== 'pending_human_review'
          || projection.candidateDraft?.candidateId !== prepared.candidateId
          || projection.currentHumanGate?.gateId !== gateId
          || projection.currentHumanGate.requiredActorId !== assignment.requiredActorId) {
          return fail('TRANSACTION_FAILED');
        }

        const candidateReceipt: V4CandidateReceipt = {
          candidateReceiptId,
          receiptType: 'candidate_recorded',
          status: 'committed',
          caseId: current.caseId,
          attemptId: current.attemptId,
          actorId,
          contextVersion: current.contextVersion,
          preparedCandidateRef: prepared.preparedCandidateRef,
          candidateId: prepared.candidateId,
          capabilityId: prepared.capabilityId,
          capabilityVersion: prepared.capabilityVersion,
          governanceVersion: governance.governanceVersion,
          admissionDecisionId,
          evidenceReceiptIds: [...prepared.evidenceReceiptIds],
          candidateEventId,
          gateEventId,
          gateId,
          requiredActorId: assignment.requiredActorId,
          assignmentRef: assignment.assignmentRef,
        };
        const result: V4WorkCommandResult = {
          receipt: {
            status: 'committed',
            requestId: command.requestId,
            idempotencyKey: command.idempotencyKey,
            operation: 'record_candidate',
            caseId: current.caseId,
            attemptId: current.attemptId,
            actorId,
            policyVersion: transaction.currentPolicyVersion,
            contextVersion: current.contextVersion,
            preparedCandidateRef: prepared.preparedCandidateRef,
            candidateId: prepared.candidateId,
            capabilityId: prepared.capabilityId,
            capabilityVersion: prepared.capabilityVersion,
            governanceVersion: governance.governanceVersion,
            admissionDecisionId,
            candidateReceiptId,
            candidateEventId,
            gateEventId,
            gateId,
            requiredActorId: assignment.requiredActorId,
            assignmentRef: assignment.assignmentRef,
          },
          projection,
        };

        caseState.events = nextEvents;
        caseState.candidateReceipts.push(candidateReceipt);
        caseState.projection = projection;
        caseState.idempotencyRecords.set(scopeKey, {
          scopeKey,
          requestHash: canonicalHash,
          result,
        });
        return { value: result, commit: true };
      });
    } catch (error) {
      if (error instanceof V4WorkCommandHandlerError) {
        throw error;
      }
      return fail('TRANSACTION_FAILED');
    }
  };
}
