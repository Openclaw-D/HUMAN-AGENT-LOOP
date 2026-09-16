// V4-LIFE 事件重放（Lane B）
// 契约：docs/v4/CONTRACT.md §9 ＋ §14.1（Projection.actors 来自 seed 名册，顺序一致）
// —— rebuildProjection 从 seed 骨架（workItems 全 blocked、gates 全 pending）
// 出发折叠事件流，产出与在线引擎 deepEqual（忽略 generatedAt）的 §8 Projection。
// 失败关闭：未知事件类型、未知字段、缺失载荷字段、seq 不连续、引用未知对象、非法状态迁移
// 一律抛 INVALID_ENGINE_INPUT，绝不静默跳过。rev = eventCount = events.length。

import { V4LifeError } from './engine.ts';
import type {
  V4LifeActor,
  V4LifeCandidate,
  V4LifeCaseMeta,
  V4LifeContextBatch,
  V4LifeContextBatchStatus,
  V4LifeContextWindow,
  V4LifeContextWindowStatus,
  V4LifeContribution,
  V4LifeDecision,
  V4LifeDependency,
  V4LifeDomain,
  V4LifeEvent,
  V4LifeEvidence,
  V4LifeGate,
  V4LifeProjection,
  V4LifeP1CandidateSemantics,
  V4LifeReceipt,
  V4LifeRiskThread,
  V4LifeSeedInput,
  V4LifeVerificationTarget,
  V4LifeWorkItem,
} from './types.ts';

const V4LIFE_DOMAINS: readonly V4LifeDomain[] = ['policy', 'credit', 'commerce', 'asset'];

const ACTOR_ROLES: ReadonlySet<string> = new Set([
  'business', 'policy', 'credit', 'commerce', 'asset', 'system',
]);
const EVIDENCE_KINDS: ReadonlySet<string> = new Set([
  'upstream_context', 'financial_statement', 'contract_draft', 'asset_history_feedback', 'supplement',
]);
const CONTRIBUTION_KINDS: ReadonlySet<string> = new Set([
  'evidence_review', 'cross_check', 'material_prep', 'risk_finding',
]);
const CANDIDATE_KINDS: ReadonlySet<string> = new Set(['contradiction', 'missing_document']);
const DEPENDENCY_KINDS: ReadonlySet<string> = new Set(['evidence', 'receipt', 'workitem']);
const EVENT_TYPES: ReadonlySet<string> = new Set([
  'CASE_INITIALIZED', 'EVIDENCE_ACCEPTED', 'WORK_ITEM_STARTED', 'WORK_ITEM_SUBMITTED',
  'CONTRIBUTION_RECORDED', 'CANDIDATE_ISSUED', 'GATE_OPENED', 'DECISION_RECORDED',
  'WORK_ITEM_COMPLETED', 'WORK_ITEM_STOPPED',
  // ---- P1 语义扩展事件（CANDIDATE；与 engine.ts applyEvent 逐分支同构） ----
  'EVIDENCE_VERIFICATION_CHANGED', 'CONTEXT_BATCH_OPENED', 'CONTEXT_BATCH_STABILIZED',
  'CONTEXT_BATCH_SEALED', 'INPUT_EVENT_APPENDED',
]);
// ---- P1 §5 Evidence 扩展枚举（CANDIDATE；与 engine.ts 同规则） ----
const EVIDENCE_SOURCE_TYPES: ReadonlySet<string> = new Set([
  'business_statement', 'original_document', 'existing_system', 'authorized_external', 'human_review', 'model_derived',
]);
const VERIFICATION_STATUSES: ReadonlySet<string> = new Set([
  'claimed', 'unverified', 'verified', 'contradicted', 'stale',
]);
const VERIFICATION_TARGETS: ReadonlySet<string> = new Set(['unverified', 'verified', 'contradicted', 'stale']);
const INPUT_EVENT_KINDS: ReadonlySet<string> = new Set(['document', 'answer', 'external_data', 'correction']);
/** §5 时间三元组格式：YYYY-MM-DD 或 YYYY-MM-DDTHH:mm:ss.sssZ（简单正则，与 engine.ts 一致） */
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}\.\d{3}Z)?$/;
// P1 §5 扩展字段上限（与 engine.ts 一致：subjectRefs ≤20×64、evidenceRef ≤200、riskThreadKey ≤64）
const MAX_SUBJECT_REFS = 20;
const MAX_SUBJECT_REF_LENGTH = 64;
const MAX_EVIDENCE_REF_LENGTH = 200;
const MAX_THREAD_KEY_LENGTH = 64;

/** D077 收集窗口批次内部状态（与 engine.ts ContextBatchState 同构） */
interface ContextBatchState {
  major: number;
  minor: number;
  status: V4LifeContextBatchStatus;
  openedAt?: string;
  sealedAt?: string;
}

/** P1 §8 Risk Thread 折叠状态（与 engine.ts RiskThreadState 同构；插入序 = key 首次出现序） */
interface RiskThreadState {
  riskThreadKey: string;
  evidenceIds: string[];
  workItemIds: string[];
  gateIds: string[];
  lastSeq: number;
}

function threadOf(map: Map<string, RiskThreadState>, key: string): RiskThreadState {
  let thread = map.get(key);
  if (thread === undefined) {
    thread = { riskThreadKey: key, evidenceIds: [], workItemIds: [], gateIds: [], lastSeq: 0 };
    map.set(key, thread);
  }
  return thread;
}

function touchThread(map: Map<string, RiskThreadState>, key: unknown, seq: number): void {
  if (typeof key !== 'string' || key.length === 0) {
    return;
  }
  threadOf(map, key).lastSeq = seq;
}

interface FoldState {
  caseId: string;
  caseMeta: V4LifeCaseMeta;
  actors: V4LifeActor[];
  workItems: Map<string, V4LifeWorkItem>;
  gates: Map<string, V4LifeGate>;
  evidence: V4LifeEvidence[];
  candidates: V4LifeCandidate[];
  contributions: V4LifeContribution[];
  receipts: V4LifeReceipt[];
  seenEvidenceIds: Set<string>;
  seenContributionIds: Set<string>;
  seenCandidateIds: Set<string>;
  seenDedupeKeys: Set<string>;
  /** EVIDENCE_VERIFICATION_CHANGED 定位用（与 evidence 数组同序） */
  evidenceById: Map<string, V4LifeEvidence>;
  /** P1/D077：收集窗口批次（key = major）；'demo' 模式预置 major=1 SEALED，'off' 默认为空 */
  contextBatches: Map<number, ContextBatchState>;
  contextCurrentMajor: number;
  /** P1 §8：Risk Thread 折叠状态 */
  riskThreads: Map<string, RiskThreadState>;
}

function invalidInput(detail: string): never {
  const error = new V4LifeError('INVALID_ENGINE_INPUT');
  (error as Error & { detail?: string }).detail = `v4life replay: ${detail}`;
  throw error;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(container: Record<string, unknown>, key: string, detail: string): string {
  const value = container[key];
  if (typeof value !== 'string' || value.length === 0) {
    invalidInput(`${detail} 字段 ${key} 必须是非空 string`);
  }
  return value;
}

function requireExactKeys(
  container: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  detail: string,
): void {
  for (const key of required) {
    if (!(key in container)) {
      invalidInput(`${detail} 缺少字段 ${key}`);
    }
  }
  for (const key of Object.keys(container)) {
    if (!required.includes(key) && !optional.includes(key)) {
      invalidInput(`${detail} 未知字段 ${key}`);
    }
  }
}

function requireDomain(value: unknown, detail: string): V4LifeDomain {
  if (typeof value !== 'string' || !V4LIFE_DOMAINS.includes(value as V4LifeDomain)) {
    invalidInput(`${detail} domain 非法`);
  }
  return value as V4LifeDomain;
}

function requireStringArray(value: unknown, detail: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    invalidInput(`${detail} 必须是非空 string 数组`);
  }
  return value as string[];
}

function requireAmountCny(value: unknown, detail: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    invalidInput(`${detail} amountCny 必须是 >= 0 的有限数`);
  }
  return value;
}

function validateEvidencePayloadShape(value: unknown, detail: string): void {
  if (!isObject(value)) {
    invalidInput(`${detail} payload 必须是对象`);
  }
  requireExactKeys(value, ['summary', 'tags'], ['amountCny'], detail);
  requireString(value, 'summary', detail);
  requireStringArray(value.tags, `${detail} tags`);
  requireAmountCny(value.amountCny, detail);
}

// ---------------------------------------------------------------------------
// P1 §5 扩展字段校验（与 engine.ts parseEvidenceExtension 同规则；失败关闭带 detail）
// ---------------------------------------------------------------------------

function requireBoundedStringArray(value: unknown, maxItems: number, maxLength: number, detail: string): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    invalidInput(`${detail} 必须是 ≤${maxItems} 项的数组`);
  }
  return (value as unknown[]).map((item) => {
    if (typeof item !== 'string' || item.length === 0 || item.length > maxLength) {
      invalidInput(`${detail} 每项必须是非空 string ≤${maxLength} 字符`);
    }
    return item;
  });
}

function requireIsoTimestamp(value: unknown, detail: string): string {
  if (typeof value !== 'string' || value.length === 0 || !ISO_TIMESTAMP_PATTERN.test(value)) {
    invalidInput(`${detail} 必须是 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm:ss.sssZ 格式`);
  }
  return value;
}

function validateEvidenceExtensionShape(value: Record<string, unknown>, detail: string): void {
  if (value.sourceType !== undefined) {
    const sourceType = value.sourceType;
    if (typeof sourceType !== 'string' || !EVIDENCE_SOURCE_TYPES.has(sourceType)) {
      invalidInput(`${detail} sourceType 非法`);
    }
  }
  if (value.subjectRefs !== undefined) {
    requireBoundedStringArray(value.subjectRefs, MAX_SUBJECT_REFS, MAX_SUBJECT_REF_LENGTH, `${detail} subjectRefs`);
  }
  if (value.observedAt !== undefined) {
    requireIsoTimestamp(value.observedAt, `${detail} observedAt`);
  }
  if (value.effectiveAt !== undefined) {
    requireIsoTimestamp(value.effectiveAt, `${detail} effectiveAt`);
  }
  if (value.expiresAt !== undefined) {
    requireIsoTimestamp(value.expiresAt, `${detail} expiresAt`);
  }
  if (value.evidenceRef !== undefined) {
    const evidenceRef = value.evidenceRef;
    if (typeof evidenceRef !== 'string' || evidenceRef.length === 0 || evidenceRef.length > MAX_EVIDENCE_REF_LENGTH) {
      invalidInput(`${detail} evidenceRef 必须是非空 string ≤${MAX_EVIDENCE_REF_LENGTH} 字符`);
    }
  }
  if (value.confidence !== undefined) {
    if (
      typeof value.confidence !== 'number' ||
      !Number.isFinite(value.confidence) ||
      value.confidence < 0 ||
      value.confidence > 1 ||
      value.sourceType !== 'model_derived'
    ) {
      invalidInput(`${detail} confidence 必须是 [0,1] 数且仅 sourceType='model_derived' 时允许`);
    }
  }
  if (value.verificationStatus !== undefined) {
    const status = value.verificationStatus;
    if (typeof status !== 'string' || !VERIFICATION_STATUSES.has(status)) {
      invalidInput(`${detail} verificationStatus 非法`);
    }
  }
  if (value.riskThreadKey !== undefined) {
    const key = value.riskThreadKey;
    if (typeof key !== 'string' || key.length === 0 || key.length > MAX_THREAD_KEY_LENGTH) {
      invalidInput(`${detail} riskThreadKey 必须是非空 string ≤${MAX_THREAD_KEY_LENGTH} 字符`);
    }
  }
}

function validateEvidenceShape(value: unknown, state: FoldState, detail: string): V4LifeEvidence {
  if (!isObject(value)) {
    invalidInput(`${detail} evidence 必须是对象`);
  }
  requireExactKeys(
    value,
    ['evidenceId', 'caseId', 'kind', 'title', 'submittedBy', 'submittedAt', 'version', 'payload'],
    // P1 §5 扩展字段全部可选（缺省兼容旧事件）
    ['sourceType', 'subjectRefs', 'observedAt', 'effectiveAt', 'expiresAt', 'evidenceRef', 'confidence', 'verificationStatus', 'riskThreadKey'],
    detail,
  );
  const evidenceId = requireString(value, 'evidenceId', detail);
  const caseId = requireString(value, 'caseId', detail);
  if (caseId !== state.caseId) {
    invalidInput(`${detail} evidence.caseId 与 case 不一致`);
  }
  const kind = value.kind;
  if (typeof kind !== 'string' || !EVIDENCE_KINDS.has(kind)) {
    invalidInput(`${detail} kind 非法`);
  }
  requireString(value, 'title', detail);
  requireString(value, 'submittedBy', detail);
  requireString(value, 'submittedAt', detail);
  if (value.version !== 1) {
    invalidInput(`${detail} version 必须是 1`);
  }
  validateEvidencePayloadShape(value.payload, detail);
  validateEvidenceExtensionShape(value, detail);
  if (state.seenEvidenceIds.has(evidenceId)) {
    invalidInput(`${detail} evidenceId 重复`);
  }
  return value as unknown as V4LifeEvidence;
}

function validateDecisionShape(value: unknown, detail: string): V4LifeDecision {
  if (!isObject(value)) {
    invalidInput(`${detail} decision 必须是对象`);
  }
  requireExactKeys(value, ['outcome', 'actorId', 'reason', 'decidedAt'], [], detail);
  const outcome = value.outcome;
  if (outcome !== 'approved' && outcome !== 'rejected' && outcome !== 'returned') {
    invalidInput(`${detail} outcome 非法`);
  }
  requireString(value, 'actorId', detail);
  requireString(value, 'reason', detail);
  requireString(value, 'decidedAt', detail);
  return value as unknown as V4LifeDecision;
}

function validateReceiptShape(value: unknown, gateId: string, detail: string): V4LifeReceipt {
  if (!isObject(value)) {
    invalidInput(`${detail} receipt 必须是对象`);
  }
  requireExactKeys(value, ['receiptId', 'gateId', 'decision'], [], detail);
  requireString(value, 'receiptId', detail);
  const receiptGateId = requireString(value, 'gateId', detail);
  if (receiptGateId !== gateId) {
    invalidInput(`${detail} receipt.gateId 与事件 gateId 不一致`);
  }
  validateDecisionShape(value.decision, `${detail} receipt.decision`);
  return value as unknown as V4LifeReceipt;
}

function validateContributionShape(value: unknown, state: FoldState, detail: string): V4LifeContribution {
  if (!isObject(value)) {
    invalidInput(`${detail} contribution 必须是对象`);
  }
  requireExactKeys(
    value,
    ['contributionId', 'actorId', 'domain', 'workItemId', 'kind', 'summary', 'recordedAt', 'retainedAfterVeto'],
    [],
    detail,
  );
  const contributionId = requireString(value, 'contributionId', detail);
  requireString(value, 'actorId', detail);
  requireDomain(value.domain, detail);
  const workItemId = requireString(value, 'workItemId', detail);
  if (!state.workItems.has(workItemId)) {
    invalidInput(`${detail} 引用未知 workItemId ${workItemId}`);
  }
  const kind = value.kind;
  if (typeof kind !== 'string' || !CONTRIBUTION_KINDS.has(kind)) {
    invalidInput(`${detail} kind 非法`);
  }
  requireString(value, 'summary', detail);
  requireString(value, 'recordedAt', detail);
  if (value.retainedAfterVeto !== true) {
    invalidInput(`${detail} retainedAfterVeto 必须是 true`);
  }
  if (state.seenContributionIds.has(contributionId)) {
    invalidInput(`${detail} contributionId 重复`);
  }
  return value as unknown as V4LifeContribution;
}

function validateCandidateShape(value: unknown, state: FoldState, detail: string): V4LifeCandidate {
  if (!isObject(value)) {
    invalidInput(`${detail} candidate 必须是对象`);
  }
  const required = [
    'candidateId', 'caseId', 'domain', 'kind', 'summary', 'basis',
    'authority', 'producedBy', 'createdAt', 'dedupeKey',
  ] as const;
  requireExactKeys(value, required, ['workItemId'], detail);
  const candidateId = requireString(value, 'candidateId', detail);
  const caseId = requireString(value, 'caseId', detail);
  if (caseId !== state.caseId) {
    invalidInput(`${detail} candidate.caseId 与 case 不一致`);
  }
  requireDomain(value.domain, detail);
  const kind = value.kind;
  if (typeof kind !== 'string' || !CANDIDATE_KINDS.has(kind)) {
    invalidInput(`${detail} kind 非法`);
  }
  requireString(value, 'summary', detail);
  requireStringArray(value.basis, `${detail} basis`);
  if (value.authority !== 'none') {
    invalidInput(`${detail} authority 必须是 'none'`);
  }
  if (value.producedBy !== 'deterministic-v1') {
    invalidInput(`${detail} producedBy 必须是 'deterministic-v1'`);
  }
  requireString(value, 'createdAt', detail);
  const dedupeKey = requireString(value, 'dedupeKey', detail);
  if (value.workItemId !== undefined) {
    const workItemId = requireString(value, 'workItemId', detail);
    if (!state.workItems.has(workItemId)) {
      invalidInput(`${detail} 引用未知 workItemId ${workItemId}`);
    }
  }
  if (state.seenCandidateIds.has(candidateId)) {
    invalidInput(`${detail} candidateId 重复`);
  }
  if (state.seenDedupeKeys.has(dedupeKey)) {
    invalidInput(`${detail} dedupeKey 重复（引擎应去重后不再发）`);
  }
  return value as unknown as V4LifeCandidate;
}

function buildSkeleton(seed: V4LifeSeedInput, p1CandidateSemantics: V4LifeP1CandidateSemantics): FoldState {
  if (!isObject(seed as unknown)) {
    invalidInput('seed 必须是对象');
  }
  const seedRecord = seed as unknown as Record<string, unknown>;
  if (!isObject(seedRecord.case)) {
    invalidInput('seed.case 必须是对象');
  }
  const caseRecord = seedRecord.case;
  requireExactKeys(
    caseRecord,
    ['caseId', 'displayName', 'disclaimer', 'financingAmountCny', 'purpose', 'upstreamNote'],
    [],
    'seed.case',
  );
  const caseId = requireString(caseRecord, 'caseId', 'seed.case');
  requireString(caseRecord, 'displayName', 'seed.case');
  requireString(caseRecord, 'disclaimer', 'seed.case');
  const amount = caseRecord.financingAmountCny;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    invalidInput('seed.case.financingAmountCny 必须是 >= 0 的有限数');
  }
  requireString(caseRecord, 'purpose', 'seed.case');
  requireString(caseRecord, 'upstreamNote', 'seed.case');
  const caseMeta: V4LifeCaseMeta = {
    caseId,
    displayName: caseRecord.displayName as string,
    disclaimer: caseRecord.disclaimer as string,
    financingAmountCny: amount,
    purpose: caseRecord.purpose as string,
    upstreamNote: caseRecord.upstreamNote as string,
  };

  if (!Array.isArray(seedRecord.actors)) {
    invalidInput('seed.actors 必须是数组');
  }
  const actors: V4LifeActor[] = [];
  (seedRecord.actors as unknown[]).forEach((actor, index) => {
    if (!isObject(actor)) {
      invalidInput(`seed.actors[${index}] 必须是对象`);
    }
    requireExactKeys(actor, ['actorId', 'role', 'displayName'], [], `seed.actors[${index}]`);
    const actorId = requireString(actor, 'actorId', `seed.actors[${index}]`);
    const role = actor.role;
    if (typeof role !== 'string' || !ACTOR_ROLES.has(role)) {
      invalidInput(`seed.actors[${index}] role 非法`);
    }
    const displayName = requireString(actor, 'displayName', `seed.actors[${index}]`);
    actors.push({ actorId, role: role as V4LifeActor['role'], displayName });
  });

  if (!Array.isArray(seedRecord.gates)) {
    invalidInput('seed.gates 必须是数组');
  }
  const gates = new Map<string, V4LifeGate>();
  (seedRecord.gates as unknown[]).forEach((raw, index) => {
    if (!isObject(raw)) {
      invalidInput(`seed.gates[${index}] 必须是对象`);
    }
    requireExactKeys(raw, ['gateId', 'domain', 'title', 'requiredRole', 'workItemId'], [], `seed.gates[${index}]`);
    const gateId = requireString(raw, 'gateId', `seed.gates[${index}]`);
    if (gates.has(gateId)) {
      invalidInput(`seed.gates[${index}] gateId 重复`);
    }
    const domain = requireDomain(raw.domain, `seed.gates[${index}]`);
    requireString(raw, 'title', `seed.gates[${index}]`);
    const requiredRole = raw.requiredRole;
    if (typeof requiredRole !== 'string' || !ACTOR_ROLES.has(requiredRole)) {
      invalidInput(`seed.gates[${index}] requiredRole 非法`);
    }
    const workItemId = requireString(raw, 'workItemId', `seed.gates[${index}]`);
    gates.set(gateId, {
      gateId,
      caseId,
      domain,
      title: raw.title as string,
      requiredRole: requiredRole as V4LifeGate['requiredRole'],
      workItemId,
      status: 'pending',
    });
  });

  if (!Array.isArray(seedRecord.workItems)) {
    invalidInput('seed.workItems 必须是数组');
  }
  const workItems = new Map<string, V4LifeWorkItem>();
  (seedRecord.workItems as unknown[]).forEach((raw, index) => {
    if (!isObject(raw)) {
      invalidInput(`seed.workItems[${index}] 必须是对象`);
    }
    requireExactKeys(
      raw,
      ['workItemId', 'domain', 'title', 'dependencies', 'assignedRole'],
      ['gateId', 'riskThreadKey'],
      `seed.workItems[${index}]`,
    );
    const workItemId = requireString(raw, 'workItemId', `seed.workItems[${index}]`);
    if (workItems.has(workItemId)) {
      invalidInput(`seed.workItems[${index}] workItemId 重复`);
    }
    const domain = requireDomain(raw.domain, `seed.workItems[${index}]`);
    requireString(raw, 'title', `seed.workItems[${index}]`);
    if (!Array.isArray(raw.dependencies)) {
      invalidInput(`seed.workItems[${index}].dependencies 必须是数组`);
    }
    const dependencies: V4LifeDependency[] = (raw.dependencies as unknown[]).map((dep, depIndex) => {
      if (!isObject(dep)) {
        invalidInput(`seed.workItems[${index}].dependencies[${depIndex}] 必须是对象`);
      }
      requireExactKeys(dep, ['kind', 'id'], [], `seed.workItems[${index}].dependencies[${depIndex}]`);
      const kind = dep.kind;
      if (typeof kind !== 'string' || !DEPENDENCY_KINDS.has(kind)) {
        invalidInput(`seed.workItems[${index}].dependencies[${depIndex}].kind 非法`);
      }
      return { kind: kind as V4LifeDependency['kind'], id: requireString(dep, 'id', `seed.workItems[${index}].dependencies[${depIndex}]`) };
    });
    const assignedRole = raw.assignedRole;
    if (typeof assignedRole !== 'string' || !ACTOR_ROLES.has(assignedRole)) {
      invalidInput(`seed.workItems[${index}] assignedRole 非法`);
    }
    let gateId: string | undefined;
    if (raw.gateId !== undefined) {
      gateId = requireString(raw, 'gateId', `seed.workItems[${index}]`);
      if (!gates.has(gateId)) {
        invalidInput(`seed.workItems[${index}] 引用未知 gateId ${gateId}`);
      }
    }
    // P1 §8：seed work item 可声明 riskThreadKey（≤64 字符；缺省不进线程）
    let riskThreadKey: string | undefined;
    if (raw.riskThreadKey !== undefined) {
      const key = raw.riskThreadKey;
      if (typeof key !== 'string' || key.length === 0 || key.length > MAX_THREAD_KEY_LENGTH) {
        invalidInput(`seed.workItems[${index}].riskThreadKey 必须是非空 string ≤${MAX_THREAD_KEY_LENGTH} 字符`);
      }
      riskThreadKey = key;
    }
    workItems.set(workItemId, {
      workItemId,
      caseId,
      domain,
      title: raw.title as string,
      dependencies,
      status: 'blocked',
      assignedRole: assignedRole as V4LifeWorkItem['assignedRole'],
      ...(gateId !== undefined ? { gateId } : {}),
      ...(riskThreadKey !== undefined ? { riskThreadKey } : {}),
    });
  });

  for (const gate of gates.values()) {
    if (!workItems.has(gate.workItemId)) {
      invalidInput(`seed.gates[${gate.gateId}] 引用未知 workItemId ${gate.workItemId}`);
    }
  }

  // P1 §8：Risk Thread 折叠骨架（seed 声明的 workItemIds/gateIds 先入线程，lastSeq=0）
  const riskThreads = new Map<string, RiskThreadState>();
  for (const item of workItems.values()) {
    if (item.riskThreadKey === undefined) {
      continue;
    }
    const thread = threadOf(riskThreads, item.riskThreadKey);
    thread.workItemIds.push(item.workItemId);
    if (item.gateId !== undefined && !thread.gateIds.includes(item.gateId)) {
      thread.gateIds.push(item.gateId);
    }
  }

  // P1/D077 收集窗口种子行为（P1-BE-01 隔离，与 engine.buildSkeletonState 同构）：
  // 仅 p1CandidateSemantics='demo' 时预置隐含批次 major=1 SEALED；默认 'off'（正式权威路径）
  // 不预置批次 —— context 投影为 'NONE' 空窗口（自动封存/重开规则待 §11.3 用户确认）。
  const contextBatches = new Map<number, ContextBatchState>();
  let contextCurrentMajor = 0;
  if (p1CandidateSemantics === 'demo') {
    contextBatches.set(1, { major: 1, minor: 0, status: 'SEALED' });
    contextCurrentMajor = 1;
  }

  return {
    caseId,
    caseMeta,
    actors,
    workItems,
    gates,
    evidence: [],
    candidates: [],
    contributions: [],
    receipts: [],
    seenEvidenceIds: new Set<string>(),
    seenContributionIds: new Set<string>(),
    seenCandidateIds: new Set<string>(),
    seenDedupeKeys: new Set<string>(),
    evidenceById: new Map<string, V4LifeEvidence>(),
    contextBatches,
    contextCurrentMajor,
    riskThreads,
  };
}

function applyEvent(state: FoldState, event: unknown, index: number): void {
  const detail = `events[${index}]`;
  if (!isObject(event)) {
    invalidInput(`${detail} 必须是事件对象`);
  }
  requireExactKeys(event, ['seq', 'at', 'actor', 'payload'], [], detail);
  const seq = event.seq;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq !== index + 1) {
    invalidInput(`${detail} seq=${String(seq)} 违反“从 1 开始连续单调”`);
  }
  const at = requireString(event, 'at', detail);
  requireString(event, 'actor', detail);
  const payload = event.payload;
  if (!isObject(payload)) {
    invalidInput(`${detail} payload 必须是对象`);
  }
  const type = payload.type;
  if (typeof type !== 'string' || !EVENT_TYPES.has(type)) {
    invalidInput(`${detail} 未知事件类型 ${String(type)}`);
  }

  switch (type) {
    case 'CASE_INITIALIZED': {
      requireExactKeys(payload, ['type', 'caseId'], [], detail);
      const caseId = requireString(payload, 'caseId', detail);
      if (caseId !== state.caseId) {
        invalidInput(`${detail} caseId 与 seed 不一致`);
      }
      // P1 种子行为：隐含批次 major=1 SEALED 的 openedAt/sealedAt 取初始化事件 at（重放等价）
      const seedBatch = state.contextBatches.get(1);
      if (seedBatch !== undefined) {
        seedBatch.openedAt = at;
        seedBatch.sealedAt = at;
      }
      return;
    }
    case 'EVIDENCE_ACCEPTED': {
      requireExactKeys(payload, ['type', 'evidence'], [], detail);
      const evidence = validateEvidenceShape(payload.evidence, state, `${detail} evidence`);
      state.seenEvidenceIds.add(evidence.evidenceId);
      state.evidence.push(structuredClone(evidence));
      state.evidenceById.set(evidence.evidenceId, state.evidence[state.evidence.length - 1]);
      // P1 §8：Risk Thread 折叠（无 key 不进线程）
      if (evidence.riskThreadKey !== undefined) {
        const thread = threadOf(state.riskThreads, evidence.riskThreadKey);
        thread.evidenceIds.push(evidence.evidenceId);
        thread.lastSeq = seq;
      }
      return;
    }
    case 'WORK_ITEM_STARTED': {
      requireExactKeys(payload, ['type', 'workItemId'], [], detail);
      const workItemId = requireString(payload, 'workItemId', detail);
      const item = state.workItems.get(workItemId);
      if (item === undefined) {
        invalidInput(`${detail} 引用未知 workItemId ${workItemId}`);
      }
      if (item.status !== 'blocked') {
        invalidInput(`${detail} workItem ${workItemId} 状态 ${item.status} 不允许 started`);
      }
      item.status = 'in_progress';
      touchThread(state.riskThreads, item.riskThreadKey, seq);
      return;
    }
    case 'WORK_ITEM_SUBMITTED': {
      requireExactKeys(payload, ['type', 'workItemId', 'actorId', 'outputSummary'], [], detail);
      const workItemId = requireString(payload, 'workItemId', detail);
      const item = state.workItems.get(workItemId);
      if (item === undefined) {
        invalidInput(`${detail} 引用未知 workItemId ${workItemId}`);
      }
      if (item.status !== 'in_progress') {
        invalidInput(`${detail} workItem ${workItemId} 状态 ${item.status} 不允许 submitted`);
      }
      const actorId = requireString(payload, 'actorId', detail);
      const outputSummary = requireString(payload, 'outputSummary', detail);
      item.outputSummary = outputSummary;
      item.submittedBy = actorId;
      item.submittedAt = at;
      touchThread(state.riskThreads, item.riskThreadKey, seq);
      return;
    }
    case 'CONTRIBUTION_RECORDED': {
      requireExactKeys(payload, ['type', 'contribution'], [], detail);
      const contribution = validateContributionShape(payload.contribution, state, `${detail} contribution`);
      state.seenContributionIds.add(contribution.contributionId);
      state.contributions.push(structuredClone(contribution));
      return;
    }
    case 'CANDIDATE_ISSUED': {
      requireExactKeys(payload, ['type', 'candidate'], [], detail);
      const candidate = validateCandidateShape(payload.candidate, state, `${detail} candidate`);
      state.seenCandidateIds.add(candidate.candidateId);
      state.seenDedupeKeys.add(candidate.dedupeKey);
      state.candidates.push(structuredClone(candidate));
      return;
    }
    case 'GATE_OPENED': {
      requireExactKeys(payload, ['type', 'gateId', 'workItemId'], [], detail);
      const gateId = requireString(payload, 'gateId', detail);
      const gate = state.gates.get(gateId);
      if (gate === undefined) {
        invalidInput(`${detail} 引用未知 gateId ${gateId}`);
      }
      const workItemId = requireString(payload, 'workItemId', detail);
      if (workItemId !== gate.workItemId) {
        invalidInput(`${detail} workItemId 与 gate 关联项不一致`);
      }
      const item = state.workItems.get(workItemId);
      if (item === undefined || item.status !== 'in_progress') {
        invalidInput(`${detail} 关联工作项 ${workItemId} 未处于 in_progress，不能开启 Gate`);
      }
      item.status = 'awaiting_gate';
      gate.status = 'open';
      gate.openedAt = at;
      touchThread(state.riskThreads, item.riskThreadKey, seq);
      return;
    }
    case 'DECISION_RECORDED': {
      requireExactKeys(payload, ['type', 'gateId', 'decision', 'receipt'], [], detail);
      const gateId = requireString(payload, 'gateId', detail);
      const gate = state.gates.get(gateId);
      if (gate === undefined) {
        invalidInput(`${detail} 引用未知 gateId ${gateId}`);
      }
      if (gate.status !== 'open') {
        invalidInput(`${detail} gate ${gateId} 状态 ${gate.status} 不允许决定`);
      }
      const decision = validateDecisionShape(payload.decision, `${detail} decision`);
      const linked = state.workItems.get(gate.workItemId);
      if (linked === undefined || linked.status !== 'awaiting_gate') {
        invalidInput(`${detail} gate ${gateId} 关联工作项未处于 awaiting_gate`);
      }
      if (decision.outcome === 'returned') {
        if (payload.receipt !== null) {
          invalidInput(`${detail} returned 决定不得携带 receipt`);
        }
        gate.status = 'pending';
        linked.status = 'in_progress';
        touchThread(state.riskThreads, linked.riskThreadKey, seq);
        return;
      }
      const receipt = validateReceiptShape(payload.receipt, gateId, `${detail} receipt`);
      gate.status = 'decided';
      state.receipts.push(structuredClone(receipt));
      linked.status = 'completed';
      linked.completedAt = decision.decidedAt;
      touchThread(state.riskThreads, linked.riskThreadKey, seq);
      return;
    }
    case 'WORK_ITEM_COMPLETED': {
      requireExactKeys(payload, ['type', 'workItemId', 'by'], [], detail);
      const workItemId = requireString(payload, 'workItemId', detail);
      const item = state.workItems.get(workItemId);
      if (item === undefined) {
        invalidInput(`${detail} 引用未知 workItemId ${workItemId}`);
      }
      requireString(payload, 'by', detail);
      // 引擎在 Gate 批准/否决落定时会先由 DECISION_RECORDED 完成关联项，再补发本事件；
      // 允许 completed → completed 幂等确认，completedAt 以专属完成事件的 at 为准（最后写入）。
      if (item.status !== 'in_progress' && item.status !== 'awaiting_gate' && item.status !== 'completed') {
        invalidInput(`${detail} workItem ${workItemId} 状态 ${item.status} 不允许 completed`);
      }
      item.status = 'completed';
      item.completedAt = at;
      touchThread(state.riskThreads, item.riskThreadKey, seq);
      return;
    }
    case 'WORK_ITEM_STOPPED': {
      requireExactKeys(payload, ['type', 'workItemId', 'reason'], [], detail);
      const workItemId = requireString(payload, 'workItemId', detail);
      const item = state.workItems.get(workItemId);
      if (item === undefined) {
        invalidInput(`${detail} 引用未知 workItemId ${workItemId}`);
      }
      if (payload.reason !== 'upstream_gate_rejected') {
        invalidInput(`${detail} reason 只允许 upstream_gate_rejected`);
      }
      if (item.status !== 'blocked') {
        invalidInput(`${detail} workItem ${workItemId} 状态 ${item.status} 不允许 stopped`);
      }
      item.status = 'stopped_dependency';
      touchThread(state.riskThreads, item.riskThreadKey, seq);
      return;
    }
    // ---------------------------------------------------------------------
    // P1 语义扩展事件（CANDIDATE；与 engine.ts applyEvent 逐分支同构，重放等价）
    // ---------------------------------------------------------------------
    case 'EVIDENCE_VERIFICATION_CHANGED': {
      requireExactKeys(payload, ['type', 'evidenceId', 'from', 'to', 'reason'], [], detail);
      const evidenceId = requireString(payload, 'evidenceId', detail);
      const evidence = state.evidenceById.get(evidenceId);
      if (evidence === undefined) {
        invalidInput(`${detail} 引用未知 evidenceId ${evidenceId}`);
      }
      const from = payload.from;
      const to = payload.to;
      if (typeof from !== 'string' || !VERIFICATION_STATUSES.has(from)) {
        invalidInput(`${detail} from 非法`);
      }
      if (typeof to !== 'string' || !VERIFICATION_TARGETS.has(to)) {
        invalidInput(`${detail} to 非法（'claimed' 只能是初始值，不得由本事件设置）`);
      }
      requireString(payload, 'reason', detail);
      // from 必须与当前状态一致（旧数据缺省 verificationStatus 视为 'claimed'）——失败关闭
      if ((evidence.verificationStatus ?? 'claimed') !== from) {
        invalidInput(`${detail} from=${from} 与当前核验状态 ${evidence.verificationStatus ?? 'claimed'} 不一致`);
      }
      evidence.verificationStatus = to as V4LifeVerificationTarget;
      touchThread(state.riskThreads, evidence.riskThreadKey, seq);
      return;
    }
    case 'CONTEXT_BATCH_OPENED': {
      requireExactKeys(payload, ['type', 'major'], [], detail);
      const major = payload.major;
      if (typeof major !== 'number' || !Number.isInteger(major) || major !== state.contextCurrentMajor + 1) {
        invalidInput(`${detail} major 必须是 ${state.contextCurrentMajor + 1}（新批次 = 最新 major+1）`);
      }
      // D077：新批次 minor=0、OPEN；openedAt 取事件 at
      state.contextBatches.set(major, { major, minor: 0, status: 'OPEN', openedAt: at });
      state.contextCurrentMajor = major;
      return;
    }
    case 'CONTEXT_BATCH_STABILIZED': {
      requireExactKeys(payload, ['type', 'major'], [], detail);
      const major = payload.major;
      if (typeof major !== 'number' || !Number.isInteger(major)) {
        invalidInput(`${detail} major 必须是整数`);
      }
      const batch = state.contextBatches.get(major);
      if (batch === undefined) {
        invalidInput(`${detail} 引用未知批次 major=${major}`);
      }
      if (batch.status !== 'OPEN') {
        invalidInput(`${detail} 批次 ${major} 状态 ${batch.status} 不允许 stabilize（仅 OPEN→STABILIZING）`);
      }
      batch.status = 'STABILIZING';
      return;
    }
    case 'CONTEXT_BATCH_SEALED': {
      requireExactKeys(payload, ['type', 'major'], [], detail);
      const major = payload.major;
      if (typeof major !== 'number' || !Number.isInteger(major)) {
        invalidInput(`${detail} major 必须是整数`);
      }
      const batch = state.contextBatches.get(major);
      if (batch === undefined) {
        invalidInput(`${detail} 引用未知批次 major=${major}`);
      }
      if (batch.status !== 'STABILIZING') {
        invalidInput(`${detail} 批次 ${major} 状态 ${batch.status} 不允许 seal（仅 STABILIZING→SEALED）`);
      }
      // D077：SEALED 只说明该版本不可变；sealedAt 取事件 at
      batch.status = 'SEALED';
      batch.sealedAt = at;
      return;
    }
    case 'INPUT_EVENT_APPENDED': {
      requireExactKeys(payload, ['type', 'major', 'minor', 'inputEventId', 'actorId', 'kind', 'summary'], ['subjectRefs'], detail);
      const major = payload.major;
      if (typeof major !== 'number' || !Number.isInteger(major)) {
        invalidInput(`${detail} major 必须是整数`);
      }
      const batch = state.contextBatches.get(major);
      if (batch === undefined) {
        invalidInput(`${detail} 引用未知批次 major=${major}`);
      }
      if (batch.status !== 'OPEN') {
        invalidInput(`${detail} 批次 ${major} 状态 ${batch.status} 不允许写入 InputEvent`);
      }
      const minor = payload.minor;
      if (minor !== batch.minor + 1) {
        invalidInput(`${detail} minor 必须是 ${batch.minor + 1}（递增 1）`);
      }
      requireString(payload, 'inputEventId', detail);
      requireString(payload, 'actorId', detail);
      const kind = payload.kind;
      if (typeof kind !== 'string' || !INPUT_EVENT_KINDS.has(kind)) {
        invalidInput(`${detail} kind 非法`);
      }
      requireString(payload, 'summary', detail);
      if (payload.subjectRefs !== undefined) {
        requireBoundedStringArray(payload.subjectRefs, MAX_SUBJECT_REFS, MAX_SUBJECT_REF_LENGTH, `${detail} subjectRefs`);
      }
      batch.minor = minor;
      return;
    }
    default: {
      invalidInput(`${detail} 未知事件类型 ${String(type)}`);
    }
  }
}

/**
 * 从 seed 骨架折叠事件流重建 §8 Projection（与在线引擎 getProjection 重放等价，忽略 generatedAt）。
 * @param generatedAt 覆盖投影时间戳（测试等价断言用）；缺省取当前时钟。
 * @param options.p1CandidateSemantics 与 createV4LifeEngine 一致（P1-BE-01）：'off'（默认）不预置
 *   隐含批次 major=1 SEALED；重建 'demo' 引擎的事件流时必须显式传 'demo'，否则含收集窗口事件的
 *   流会因 major 不接续失败关闭（模式属于引擎身份，跨模式事件流移植不被支持）。
 */
export function rebuildProjection(
  seed: V4LifeSeedInput,
  events: V4LifeEvent[],
  generatedAt?: string,
  options?: { p1CandidateSemantics?: V4LifeP1CandidateSemantics },
): V4LifeProjection {
  const p1CandidateSemantics = options?.p1CandidateSemantics ?? 'off';
  if (p1CandidateSemantics !== 'off' && p1CandidateSemantics !== 'demo') {
    invalidInput('options.p1CandidateSemantics 只允许 \'off\' | \'demo\'');
  }
  const state = buildSkeleton(seed, p1CandidateSemantics);
  if (!Array.isArray(events)) {
    invalidInput('events 必须是数组');
  }
  (events as unknown[]).forEach((event, index) => applyEvent(state, event, index));

  let at: string;
  if (generatedAt === undefined) {
    at = new Date().toISOString();
  } else if (typeof generatedAt === 'string' && generatedAt.length > 0) {
    at = generatedAt;
  } else {
    invalidInput('generatedAt 必须是非空 string');
  }

  const workItemList = [...state.workItems.values()];
  const gateList = [...state.gates.values()];
  // P1/D077：窗口投影 = 最新批次（major 最大）+ 全部批次（最新在前，major 降序）——与 engine.getProjection 同构；
  // strict 默认路径（'off'）未开启任何批次时输出 'NONE' 空窗口，不伪造状态。
  const currentBatch = state.contextBatches.get(state.contextCurrentMajor);
  const context: V4LifeContextWindow =
    currentBatch === undefined
      ? { major: 0, minor: 0, status: 'NONE' as V4LifeContextWindowStatus, batches: [] }
      : {
          major: currentBatch.major,
          minor: currentBatch.minor,
          status: currentBatch.status,
          batches: [...state.contextBatches.values()]
            .sort((a, b) => b.major - a.major)
            .map((batch): V4LifeContextBatch => {
              const view: V4LifeContextBatch = { major: batch.major, minor: batch.minor, status: batch.status };
              if (batch.openedAt !== undefined) {
                view.openedAt = batch.openedAt;
              }
              if (batch.sealedAt !== undefined) {
                view.sealedAt = batch.sealedAt;
              }
              return view;
            }),
        };
  // P1 §8：Risk Thread 投影（key 首次出现序；无 key 的对象不进线程）
  const riskThreads: V4LifeRiskThread[] = [...state.riskThreads.values()];
  const projection: V4LifeProjection = {
    case: { ...state.caseMeta },
    actors: [...state.actors],
    rev: events.length,
    domains: V4LIFE_DOMAINS.map((domain) => ({
      domain,
      workItems: workItemList.filter((item) => item.domain === domain),
      gates: gateList.filter((gate) => gate.domain === domain),
      candidates: state.candidates.filter((candidate) => candidate.domain === domain),
    })),
    openGates: gateList.filter((gate) => gate.status === 'open'),
    receipts: [...state.receipts],
    contributions: [...state.contributions],
    evidence: [...state.evidence],
    evidenceCount: state.evidence.length,
    eventCount: events.length,
    context,
    riskThreads,
    generatedAt: at,
  };
  return structuredClone(projection);
}
