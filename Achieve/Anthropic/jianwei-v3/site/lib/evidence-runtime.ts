import { deriveSharedContextProjection } from './shared-context-projection.ts';
import type { SharedContextProjection } from './shared-context-projection.ts';
import {
  appendAuthorityEvent,
  resetAuthorityEventLedger,
} from './authority-event-ledger.ts';
import {
  getLatestCandidateStageRuns,
  recordCandidateStageRuns,
  resetCandidateStageRuns,
} from './stage-run-runtime.ts';

export type EvidenceInput = {
  caseId: string;
  requestId: string;
  evidenceId: string;
  kind: string;
  title: string;
  summary: string;
  actor: string;
};

export type EvidenceReceipt = {
  receiptId: string;
  evidenceEventId: string;
  caseId: 'FL-DEMO-001';
  evidenceId: string;
  contextVersion: string;
  kind: string;
  title: string;
  summary: string;
  actor: string;
  status: 'accepted';
  consumerCount: 4;
  requestId: string;
  acceptedAt: string;
};

export type ConfirmedFactContext = {
  factId: string;
  actor: string;
  contextVersion: string;
  contextEventId: string;
};

export type ConfirmedFactInput = {
  factId: string;
  actor: string;
  requestId: string;
};

const CASE_ID = 'FL-DEMO-001';
const INITIAL_CONTEXT_VERSION = 'CTX-0001';
const INITIAL_EVIDENCE_EVENT_ID = 'evidence-event-bootstrap';
const MAX_EVIDENCE_ID_LENGTH = 160;
const MAX_REQUEST_ID_LENGTH = 160;
const MAX_FACT_ACTOR_LENGTH = 80;
const COMPLETED_STEP_COUNT_BY_STAGE = Object.freeze({ policy: 1, credit: 2, commerce: 3, asset: 4 });

let contextSequence = 1;
let evidenceSequence = 0;
let factConfirmationSequence = 0;
let currentContextVersion = INITIAL_CONTEXT_VERSION;
let currentContextEventId = INITIAL_EVIDENCE_EVENT_ID;
let latestReceipt: EvidenceReceipt | undefined;
type EvidenceRecord = { signature: string; receipt: EvidenceReceipt };
type RequestRecord = { evidenceId: string; signature: string; receipt: EvidenceReceipt };
type FactConfirmationRecord = { actor: string; context: ConfirmedFactContext };
let requests = new Map<string, RequestRecord>();
let evidenceIds = new Map<string, EvidenceRecord>();
let factConfirmations = new Map<string, FactConfirmationRecord>();

function recordStageRuns(
  contextVersion: string,
  sourceEventId: string,
  correlationId: string,
): void {
  recordCandidateStageRuns({
    caseId: CASE_ID,
    contextVersion,
    sourceEventId,
    completedStepCountByStage: { ...COMPLETED_STEP_COUNT_BY_STAGE },
  });
  appendAuthorityEvent({
    eventId: `stage-runs-${contextVersion}`,
    caseId: CASE_ID,
    type: 'STAGE_RUNS_STARTED',
    actor: { kind: 'system', id: 'jianwei-harness', authority: 'none' },
    correlationId,
    causationId: sourceEventId,
    contextVersion,
    payload: { consumerCount: '4', status: 'candidate_ready' },
  });
}

function seedRuntimeLedgers(): void {
  recordStageRuns(
    INITIAL_CONTEXT_VERSION,
    INITIAL_EVIDENCE_EVENT_ID,
    'bootstrap-FL-DEMO-001',
  );
}

function failure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function evidenceSignature(input: ReturnType<typeof validateInput>): string {
  return JSON.stringify({
    caseId: CASE_ID,
    evidenceId: input.evidenceId,
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    actor: input.actor,
  });
}

function validateInput(input: EvidenceInput) {
  if (input?.caseId !== CASE_ID) throw failure('CASE_NOT_FOUND', '事项不存在');
  const requestId = trimmed(input?.requestId);
  const evidenceId = trimmed(input?.evidenceId);
  const kind = trimmed(input?.kind);
  const title = trimmed(input?.title);
  const summary = trimmed(input?.summary);
  const actor = trimmed(input?.actor);
  if (!requestId) throw failure('INVALID_REQUEST_ID', '请求标识无效');
  if (requestId.length > MAX_REQUEST_ID_LENGTH) throw failure('INVALID_REQUEST_ID', '请求标识过长');
  if (!evidenceId) throw failure('INVALID_EVIDENCE_ID', '证据标识无效');
  if (evidenceId.length > MAX_EVIDENCE_ID_LENGTH) throw failure('INVALID_EVIDENCE_ID', '证据标识过长');
  if (!kind || kind.length > 80) throw failure('INVALID_KIND', '证据类型无效');
  if (!title || title.length > 120) throw failure('INVALID_TITLE', '证据标题无效');
  if (!summary || summary.length > 1200) throw failure('INVALID_SUMMARY', '证据摘要无效');
  if (!actor || actor.length > 80) throw failure('INVALID_ACTOR', '接入人必须是非空具名人类');
  return { requestId, evidenceId, kind, title, summary, actor };
}

export function acceptEvidence(input: EvidenceInput): EvidenceReceipt {
  const clean = validateInput(input);
  const signature = evidenceSignature(clean);
  const existingRequest = requests.get(clean.requestId);
  if (existingRequest) {
    if (existingRequest.signature !== signature) throw failure('IDEMPOTENCY_CONFLICT', '同一请求标识已绑定其他证据');
    return structuredClone(existingRequest.receipt);
  }
  const existingEvidence = evidenceIds.get(clean.evidenceId);
  if (existingEvidence) {
    if (existingEvidence.signature !== signature) throw failure('EVIDENCE_ID_CONFLICT', '证据标识已绑定其他内容');
    requests.set(clean.requestId, { evidenceId: clean.evidenceId, signature, receipt: existingEvidence.receipt });
    return structuredClone(existingEvidence.receipt);
  }
  if (clean.summary.toLowerCase().includes('[error]')) throw failure('EVIDENCE_PROCESSING_FAILED', '证据接入失败，版本未推进');

  evidenceSequence += 1;
  contextSequence += 1;
  const nextContextVersion = `CTX-${String(contextSequence).padStart(4, '0')}`;
  const nextEventId = `evidence-event-${String(evidenceSequence).padStart(4, '0')}`;
  const receipt: EvidenceReceipt = {
    receiptId: `evidence-receipt-${String(evidenceSequence).padStart(4, '0')}`,
    evidenceEventId: nextEventId,
    caseId: CASE_ID,
    evidenceId: clean.evidenceId,
    contextVersion: nextContextVersion,
    kind: clean.kind,
    title: clean.title,
    summary: clean.summary,
    actor: clean.actor,
    status: 'accepted',
    consumerCount: 4,
    requestId: clean.requestId,
    acceptedAt: new Date().toISOString(),
  };
  recordCandidateStageRuns({
    caseId: CASE_ID,
    contextVersion: nextContextVersion,
    sourceEventId: nextEventId,
    completedStepCountByStage: { ...COMPLETED_STEP_COUNT_BY_STAGE },
  });
  appendAuthorityEvent({
    eventId: nextEventId,
    caseId: CASE_ID,
    type: 'EVIDENCE_ACCEPTED',
    actor: { kind: 'human', id: clean.actor, authority: 'confirmed' },
    correlationId: receipt.receiptId,
    causationId: clean.requestId,
    contextVersion: nextContextVersion,
    payload: {
      evidenceId: clean.evidenceId,
      kind: clean.kind,
      status: receipt.status,
      title: clean.title,
    },
  });
  appendAuthorityEvent({
    eventId: `stage-runs-${nextContextVersion}`,
    caseId: CASE_ID,
    type: 'STAGE_RUNS_STARTED',
    actor: { kind: 'system', id: 'jianwei-harness', authority: 'none' },
    correlationId: receipt.receiptId,
    causationId: nextEventId,
    contextVersion: nextContextVersion,
    payload: { consumerCount: '4', status: 'candidate_ready' },
  });
  currentContextVersion = nextContextVersion;
  currentContextEventId = nextEventId;
  latestReceipt = receipt;
  evidenceIds.set(clean.evidenceId, { signature, receipt });
  requests.set(clean.requestId, { evidenceId: clean.evidenceId, signature, receipt });
  return structuredClone(receipt);
}

export function recordConfirmedFact(input: ConfirmedFactInput): ConfirmedFactContext {
  const factId = trimmed(input?.factId);
  const actor = trimmed(input?.actor);
  const requestId = trimmed(input?.requestId);
  if (!factId) throw failure('FACT_NOT_FOUND', '候选事实不存在');
  if (!requestId || requestId.length > MAX_REQUEST_ID_LENGTH) throw failure('INVALID_REQUEST_ID', '请求标识无效');
  if (!actor || actor.length > MAX_FACT_ACTOR_LENGTH) throw failure('INVALID_ACTOR', '确认人必须是非空具名人类');

  const existing = factConfirmations.get(factId);
  if (existing) {
    if (existing.actor !== actor) throw failure('FACT_ALREADY_CONFIRMED', '事实已由其他具名人员确认');
    return structuredClone(existing.context);
  }

  contextSequence += 1;
  factConfirmationSequence += 1;
  const context: ConfirmedFactContext = {
    factId,
    actor,
    contextVersion: `CTX-${String(contextSequence).padStart(4, '0')}`,
    contextEventId: `fact-confirmation-event-${String(factConfirmationSequence).padStart(4, '0')}`,
  };
  recordCandidateStageRuns({
    caseId: CASE_ID,
    contextVersion: context.contextVersion,
    sourceEventId: context.contextEventId,
    completedStepCountByStage: { ...COMPLETED_STEP_COUNT_BY_STAGE },
  });
  appendAuthorityEvent({
    eventId: context.contextEventId,
    caseId: CASE_ID,
    type: 'FACT_CONFIRMED',
    actor: { kind: 'human', id: actor, authority: 'confirmed' },
    correlationId: requestId,
    causationId: factId,
    contextVersion: context.contextVersion,
    payload: { factId, status: 'confirmed' },
  });
  appendAuthorityEvent({
    eventId: `stage-runs-${context.contextVersion}`,
    caseId: CASE_ID,
    type: 'STAGE_RUNS_STARTED',
    actor: { kind: 'system', id: 'jianwei-harness', authority: 'none' },
    correlationId: requestId,
    causationId: context.contextEventId,
    contextVersion: context.contextVersion,
    payload: { consumerCount: '4', status: 'candidate_ready' },
  });
  currentContextVersion = context.contextVersion;
  currentContextEventId = context.contextEventId;
  factConfirmations.set(factId, { actor, context });
  return structuredClone(context);
}

export function getSharedContextSnapshot(): {
  sharedContext: { contextVersion: string; evidenceEventId: string; consumerCount: 4 };
  projection: SharedContextProjection;
  latestEvidenceReceipt?: EvidenceReceipt;
} {
  const projection = deriveSharedContextProjection({
    contextVersion: currentContextVersion,
    completedStepCountByStage: { ...COMPLETED_STEP_COUNT_BY_STAGE },
  });
  const latestRuns = getLatestCandidateStageRuns();
  const runsConsistent = latestRuns.length === 4
    && latestRuns.every((run) => run.contextVersion === currentContextVersion)
    && projection.stagePreparations.every((preparation) => {
      const run = latestRuns.find((candidate) => candidate.stageId === preparation.stageId);
      return run?.processRunId === preparation.processRunId
        && run.currentFlowId === preparation.currentFlowId
        && run.prepProgressPercent === preparation.prepProgressPercent;
    });
  if (!runsConsistent) {
    throw failure('RUNTIME_INCONSISTENT', '四板块候选处理记录与共享上下文不一致');
  }
  return structuredClone({
    sharedContext: { contextVersion: currentContextVersion, evidenceEventId: currentContextEventId, consumerCount: 4 as const },
    projection,
    ...(latestReceipt ? { latestEvidenceReceipt: latestReceipt } : {}),
  });
}

export function resetEvidenceRuntime(): void {
  contextSequence = 1;
  evidenceSequence = 0;
  factConfirmationSequence = 0;
  currentContextVersion = INITIAL_CONTEXT_VERSION;
  currentContextEventId = INITIAL_EVIDENCE_EVENT_ID;
  latestReceipt = undefined;
  requests = new Map();
  evidenceIds = new Map();
  factConfirmations = new Map();
  resetAuthorityEventLedger();
  resetCandidateStageRuns();
  seedRuntimeLedgers();
}

seedRuntimeLedgers();
