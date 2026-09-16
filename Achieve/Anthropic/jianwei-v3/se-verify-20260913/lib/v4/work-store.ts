import type {
  V4AccessGrant,
  V4ActorIdentity,
  V4ExplicitDeny,
  V4RoleAssignment,
} from './authority-types.ts';
import { replayWorkAggregate } from './work-aggregate.ts';
import type {
  V4CandidateReceipt,
  V4CreditDecisionReceipt,
  V4EvidenceReceipt,
  V4WorkCommandResult,
  WorkAggregateProjection,
} from './work-command-types.ts';

export type V4WorkServerSession = {
  sessionId: string;
  actor: V4ActorIdentity;
  roleAssignments: V4RoleAssignment[];
  grants: V4AccessGrant[];
  denies: V4ExplicitDeny[];
  presentedInvitationId: string | null;
};

export type V4PreparedCandidateRecord = {
  preparedCandidateRef: string;
  candidateId: string;
  capabilityId: string;
  capabilityVersion: string;
  observedGovernanceVersion: number;
  caseId: string;
  attemptId: string;
  contextVersion: string;
  evidenceReceiptIds: string[];
  outputKind: 'CandidateDraft';
  authority: 'none';
};

export type V4CapabilityGovernanceHistory = {
  capabilityId: string;
  capabilityVersion: string;
  events: unknown[];
};

export type V4CreditReviewAssignment = {
  caseId: string;
  assignmentRef: string;
  requiredActorId: string;
};

export type V4WorkStoreSeed = {
  currentPolicyVersion: string;
  actors?: V4ActorIdentity[];
  sessions: V4WorkServerSession[];
  cases: Array<{
    caseId: string;
    events: unknown[];
  }>;
  preparedCandidates?: V4PreparedCandidateRecord[];
  capabilityGovernanceHistories?: V4CapabilityGovernanceHistory[];
  creditReviewAssignments?: V4CreditReviewAssignment[];
};

export type V4WorkIdempotencyRecord = {
  scopeKey: string;
  requestHash: string;
  result: V4WorkCommandResult;
};

export type V4WorkTransactionCaseState = {
  events: unknown[];
  evidenceReceipts: V4EvidenceReceipt[];
  candidateReceipts: V4CandidateReceipt[];
  decisionReceipts: V4CreditDecisionReceipt[];
  projection: WorkAggregateProjection;
  idempotencyRecords: Map<string, V4WorkIdempotencyRecord>;
};

export type V4WorkTransactionContext = {
  session: V4WorkServerSession | null;
  currentPolicyVersion: string;
  actors: Map<string, V4ActorIdentity>;
  caseState: V4WorkTransactionCaseState | null;
  preparedCandidates: Map<string, V4PreparedCandidateRecord>;
  capabilityGovernanceHistories: Map<string, unknown[]>;
  creditReviewAssignments: Map<string, V4CreditReviewAssignment>;
};

export type V4WorkTransactionOutcome<T> = {
  value: T;
  commit: boolean;
};

export type V4WorkStoreCaseSnapshot = {
  events: unknown[];
  evidenceReceipts: V4EvidenceReceipt[];
  candidateReceipts: V4CandidateReceipt[];
  decisionReceipts: V4CreditDecisionReceipt[];
  projection: WorkAggregateProjection;
  idempotencyRecords: V4WorkIdempotencyRecord[];
};

export type V4WorkStore = {
  transact<T>(
    sessionId: string,
    caseId: string,
    operation: (context: V4WorkTransactionContext) => V4WorkTransactionOutcome<T>,
  ): T;
  readCase(caseId: string): V4WorkStoreCaseSnapshot | null;
  __testOnlyFailNextTransaction(): void;
};

export class V4WorkStoreTransactionError extends Error {
  constructor() {
    super('WORK_STORE_TRANSACTION_FAILED');
    this.name = 'V4WorkStoreTransactionError';
  }
}

function cloneSession(value: V4WorkServerSession): V4WorkServerSession {
  return structuredClone(value);
}

function cloneIdempotencyRecord(value: V4WorkIdempotencyRecord): V4WorkIdempotencyRecord {
  return {
    scopeKey: value.scopeKey,
    requestHash: value.requestHash,
    result: structuredClone(value.result),
  };
}

function cloneCaseState(value: V4WorkTransactionCaseState): V4WorkTransactionCaseState {
  return {
    events: structuredClone(value.events),
    evidenceReceipts: structuredClone(value.evidenceReceipts),
    candidateReceipts: structuredClone(value.candidateReceipts),
    decisionReceipts: structuredClone(value.decisionReceipts),
    projection: structuredClone(value.projection),
    idempotencyRecords: new Map(
      [...value.idempotencyRecords.entries()].map(([key, record]) => (
        [key, cloneIdempotencyRecord(record)]
      )),
    ),
  };
}

function snapshotOf(value: V4WorkTransactionCaseState): V4WorkStoreCaseSnapshot {
  return {
    events: structuredClone(value.events),
    evidenceReceipts: structuredClone(value.evidenceReceipts),
    candidateReceipts: structuredClone(value.candidateReceipts),
    decisionReceipts: structuredClone(value.decisionReceipts),
    projection: structuredClone(value.projection),
    idempotencyRecords: [...value.idempotencyRecords.values()]
      .map(cloneIdempotencyRecord)
      .sort((left, right) => (
        left.scopeKey < right.scopeKey ? -1 : left.scopeKey > right.scopeKey ? 1 : 0
      )),
  };
}

function canonicalConstructionKey(value: string): string {
  const canonical = value.trim();
  if (canonical.length === 0) {
    throw new Error('INVALID_WORK_STORE_SEED');
  }
  return canonical;
}

function capabilityHistoryKey(capabilityId: string, capabilityVersion: string): string {
  return JSON.stringify([
    canonicalConstructionKey(capabilityId),
    canonicalConstructionKey(capabilityVersion),
  ]);
}

function addUnique<T>(map: Map<string, T>, key: string, value: T): void {
  if (map.has(key)) {
    throw new Error('DUPLICATE_WORK_STORE_KEY');
  }
  map.set(key, structuredClone(value));
}

function cloneMap<T>(value: ReadonlyMap<string, T>): Map<string, T> {
  return new Map([...value.entries()].map(([key, entry]) => [key, structuredClone(entry)]));
}

class InMemoryV4WorkStore implements V4WorkStore {
  private readonly actors = new Map<string, V4ActorIdentity>();
  private readonly sessions = new Map<string, V4WorkServerSession>();
  private readonly cases = new Map<string, V4WorkTransactionCaseState>();
  private readonly preparedCandidates = new Map<string, V4PreparedCandidateRecord>();
  private readonly capabilityGovernanceHistories = new Map<string, unknown[]>();
  private readonly creditReviewAssignments = new Map<string, V4CreditReviewAssignment>();
  private readonly currentPolicyVersion: string;
  private failNextTransaction = false;

  constructor(seed: V4WorkStoreSeed) {
    this.currentPolicyVersion = seed.currentPolicyVersion;
    for (const session of seed.sessions) {
      addUnique(this.sessions, canonicalConstructionKey(session.sessionId), session);
    }
    for (const entry of seed.cases) {
      const caseKey = canonicalConstructionKey(entry.caseId);
      if (this.cases.has(caseKey)) {
        throw new Error('DUPLICATE_WORK_STORE_KEY');
      }
      const events = structuredClone(entry.events);
      this.cases.set(caseKey, {
        events,
        evidenceReceipts: [],
        candidateReceipts: [],
        decisionReceipts: [],
        projection: replayWorkAggregate(events),
        idempotencyRecords: new Map(),
      });
    }
    for (const actor of seed.actors ?? []) {
      addUnique(this.actors, canonicalConstructionKey(actor.actorId), actor);
    }
    for (const record of seed.preparedCandidates ?? []) {
      addUnique(
        this.preparedCandidates,
        canonicalConstructionKey(record.preparedCandidateRef),
        record,
      );
    }
    for (const history of seed.capabilityGovernanceHistories ?? []) {
      addUnique(
        this.capabilityGovernanceHistories,
        capabilityHistoryKey(history.capabilityId, history.capabilityVersion),
        history.events,
      );
    }
    for (const assignment of seed.creditReviewAssignments ?? []) {
      addUnique(
        this.creditReviewAssignments,
        canonicalConstructionKey(assignment.caseId),
        assignment,
      );
    }
  }

  transact<T>(
    sessionId: string,
    caseId: string,
    operation: (context: V4WorkTransactionContext) => V4WorkTransactionOutcome<T>,
  ): T {
    const storedSession = this.sessions.get(sessionId);
    const storedCase = this.cases.get(caseId);
    const draft = storedCase === undefined ? null : cloneCaseState(storedCase);
    const outcome = operation({
      session: storedSession === undefined ? null : cloneSession(storedSession),
      currentPolicyVersion: this.currentPolicyVersion,
      actors: cloneMap(this.actors),
      caseState: draft,
      preparedCandidates: cloneMap(this.preparedCandidates),
      capabilityGovernanceHistories: cloneMap(this.capabilityGovernanceHistories),
      creditReviewAssignments: cloneMap(this.creditReviewAssignments),
    });

    if (!outcome.commit) {
      return structuredClone(outcome.value);
    }
    if (draft === null) {
      throw new V4WorkStoreTransactionError();
    }
    if (this.failNextTransaction) {
      this.failNextTransaction = false;
      throw new V4WorkStoreTransactionError();
    }

    this.cases.set(caseId, draft);
    return structuredClone(outcome.value);
  }

  readCase(caseId: string): V4WorkStoreCaseSnapshot | null {
    const value = this.cases.get(caseId);
    return value === undefined ? null : snapshotOf(value);
  }

  __testOnlyFailNextTransaction(): void {
    this.failNextTransaction = true;
  }
}

export function createInMemoryV4WorkStore(seed: V4WorkStoreSeed): V4WorkStore {
  return new InMemoryV4WorkStore(structuredClone(seed));
}
