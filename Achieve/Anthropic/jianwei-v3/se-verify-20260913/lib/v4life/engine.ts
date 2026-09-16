// V4-LIFE 四域事件溯源内核（契约 docs/v4/CONTRACT.md §2–§7/§11/§12 ＋ §14.1 Projection.actors；Lane A 重写版）
// 语义要点：
//   - 事件是唯一权威记录：每个状态变化都落为 §2 全量载荷事件（seq 从 1 单调、只追加、rev = 事件总数）；
//     同 seed + 同事件序列必然折叠出等价 Projection（§2/§9，deepEqual 忽略 generatedAt）。
//   - 校验顺序（§6，任何一步失败抛 V4LifeError 且不产生事件）：
//     1 字段校验 → 2 Actor 存在 → 3 commandId 幂等（同键同载荷 replay / 同键异载荷 IDEMPOTENCY_CONFLICT）
//     → 4 expectedRev 版本竞争 → 5 对象状态/权限规则（§3/§4）→ 6 evidenceId 自然键（EVIDENCE_CONFLICT）。
//   - §3 状态机与依赖三分法、§4 角色权限、§5 Candidate R1/R2 与 dedupeKey 去重（authority 恒 none）。
//   - options.eventLog 注入：构造时 loadAll 有事件则折叠重建（seed 必须同骨架）；每次追加先
//     log.append(caseId, 追加前 rev, newEvents)，返回 SEQ_CONFLICT 则回滚本轮派生状态并抛 V4LifeError('SEQ_CONFLICT')。
//   - 时间戳全部来自注入时钟（options.now，缺省系统时钟）；每次事件生成各取一次时。
// 已知运行期边界：commandId 幂等记录无法由事件重建（事件不携带命令）；注入 options.commandJournal
// （§15 durable command journal，实现见 command-journal.ts）时跨重启恢复，未注入时仅存活于当前进程；
// evidenceId 自然键可由事件全量重建。除此之外全部状态均可由 seed + 事件流重放恢复。
// P1-BE-01（2026-09-04）：p1CandidateSemantics 默认 'off' —— 五个 P1 candidate 命令与种子隐含
// 批次 major=1 SEALED 不进入默认正式权威路径（'demo' 显式 opt-in，语义仍为 CANDIDATE）；
// candidate 命令族同样以 'context_batch' 入 journal；journal 恢复带 rev 一致性守卫（错配失败关闭）。

import type {
  V4LifeActor,
  V4LifeAppendEvidenceCommand,
  V4LifeAppendEvidenceResult,
  V4LifeAppendInputEventCommand,
  V4LifeCandidate,
  V4LifeCaseMeta,
  V4LifeChangeVerificationCommand,
  V4LifeChangeVerificationResult,
  V4LifeCommandJournal,
  V4LifeCommandJournalRecord,
  V4LifeContextBatch,
  V4LifeContextBatchResult,
  V4LifeContextBatchStatus,
  V4LifeContextWindow,
  V4LifeContextWindowStatus,
  V4LifeContribution,
  V4LifeDecision,
  V4LifeDependency,
  V4LifeDomain,
  V4LifeEngine,
  V4LifeEngineOptions,
  V4LifeErrorCode,
  V4LifeEvent,
  V4LifeEventPayload,
  V4LifeEvidence,
  V4LifeEvidenceKind,
  V4LifeEvidencePayload,
  V4LifeGate,
  V4LifeOpenContextBatchCommand,
  V4LifeP1CandidateSemantics,
  V4LifeProjection,
  V4LifeReceipt,
  V4LifeRecordDecisionCommand,
  V4LifeRecordDecisionResult,
  V4LifeRiskThread,
  V4LifeSeedInitialEvidence,
  V4LifeSeedInput,
  V4LifeSealContextBatchCommand,
  V4LifeStabilizeContextBatchCommand,
  V4LifeSubmitWorkCommand,
  V4LifeSubmitWorkResult,
  V4LifeVerificationStatus,
  V4LifeVerificationTarget,
  V4LifeWorkItem,
} from './types.ts';
import type { V4LifeEventLog } from './event-log.ts';

export type {
  V4LifeAppendEvidenceCommand,
  V4LifeAppendEvidenceResult,
  V4LifeAppendInputEventCommand,
  V4LifeChangeVerificationCommand,
  V4LifeChangeVerificationResult,
  V4LifeCommand,
  V4LifeCommandStatus,
  V4LifeContextBatch,
  V4LifeContextBatchResult,
  V4LifeContextBatchStatus,
  V4LifeContextWindow,
  V4LifeDecision,
  V4LifeDomain,
  V4LifeEngine,
  V4LifeEngineOptions,
  V4LifeErrorCode,
  V4LifeEvent,
  V4LifeEventPayload,
  V4LifeEvidence,
  V4LifeInputEventKind,
  V4LifeOpenContextBatchCommand,
  V4LifeRecordDecisionCommand,
  V4LifeRecordDecisionResult,
  V4LifeRiskThread,
  V4LifeP1CandidateSemantics,
  V4LifeSeedGate,
  V4LifeSeedInitialEvidence,
  V4LifeSeedInput,
  V4LifeSeedWorkItem,
  V4LifeSealContextBatchCommand,
  V4LifeStabilizeContextBatchCommand,
  V4LifeSubmitWorkCommand,
  V4LifeSubmitWorkResult,
  V4LifeVerificationStatus,
  V4LifeVerificationTarget,
} from './types.ts';

/** §12 错误：code 与错误码总表一一对应；HTTP 层按 §12 映射状态码。 */
export class V4LifeError extends Error {
  readonly code: V4LifeErrorCode;

  constructor(code: V4LifeErrorCode) {
    super(code);
    this.name = 'V4LifeError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// 常量与基础校验辅助（失败关闭：一律 INVALID_ENGINE_INPUT）
// ---------------------------------------------------------------------------

const V4LIFE_DOMAINS: readonly V4LifeDomain[] = ['policy', 'credit', 'commerce', 'asset'];

const ACTOR_ROLES: ReadonlySet<string> = new Set([
  'business', 'policy', 'credit', 'commerce', 'asset', 'system',
]);
const EVIDENCE_KINDS: ReadonlySet<string> = new Set([
  'upstream_context', 'financial_statement', 'contract_draft', 'asset_history_feedback', 'supplement',
]);
const DEPENDENCY_KINDS: ReadonlySet<string> = new Set(['evidence', 'receipt', 'workitem']);
const CONTRIBUTION_KINDS: ReadonlySet<string> = new Set([
  'evidence_review', 'cross_check', 'material_prep', 'risk_finding',
]);
const CANDIDATE_KINDS: ReadonlySet<string> = new Set(['contradiction', 'missing_document']);
const DECISION_OUTCOMES: ReadonlySet<string> = new Set(['approved', 'rejected', 'returned']);
const EVENT_TYPES: ReadonlySet<string> = new Set([
  'CASE_INITIALIZED', 'EVIDENCE_ACCEPTED', 'WORK_ITEM_STARTED', 'WORK_ITEM_SUBMITTED',
  'CONTRIBUTION_RECORDED', 'CANDIDATE_ISSUED', 'GATE_OPENED', 'DECISION_RECORDED',
  'WORK_ITEM_COMPLETED', 'WORK_ITEM_STOPPED',
  // ---- P1 语义扩展事件（CANDIDATE；与 replay.ts rebuildProjection 一一对应） ----
  'EVIDENCE_VERIFICATION_CHANGED', 'CONTEXT_BATCH_OPENED', 'CONTEXT_BATCH_STABILIZED',
  'CONTEXT_BATCH_SEALED', 'INPUT_EVENT_APPENDED',
]);
// ---- P1 §5 Evidence 扩展枚举（CANDIDATE） ----
const EVIDENCE_SOURCE_TYPES: ReadonlySet<string> = new Set([
  'business_statement', 'original_document', 'existing_system', 'authorized_external', 'human_review', 'model_derived',
]);
const VERIFICATION_STATUSES: ReadonlySet<string> = new Set([
  'claimed', 'unverified', 'verified', 'contradicted', 'stale',
]);
/** changeVerification 允许的目标状态（'claimed' 只能是 append 初始值） */
const VERIFICATION_TARGETS: ReadonlySet<string> = new Set(['unverified', 'verified', 'contradicted', 'stale']);
/**
 * CANDIDATE（待 §11.3 确认）：允许执行 Human 核验的角色 —— 四域（policy/credit/commerce/asset）。
 * 业务（business）不得自核验、system（Agent/模型）authority=none 恒不得核验。
 */
const VERIFICATION_ROLES: ReadonlySet<string> = new Set(['policy', 'credit', 'commerce', 'asset']);
const INPUT_EVENT_KINDS: ReadonlySet<string> = new Set(['document', 'answer', 'external_data', 'correction']);

/** §5 时间三元组格式：YYYY-MM-DD 或 YYYY-MM-DDTHH:mm:ss.sssZ（简单正则，任务书约定） */
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}\.\d{3}Z)?$/;

/** §5 R2 必需 tags */
const R2_REQUIRED_TAGS: readonly string[] = ['business_license', 'due_diligence_report'];

const MAX_TITLE_LENGTH = 200;
const MAX_SUMMARY_LENGTH = 2000;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 64;
const MAX_EVENT_PAGE_LIMIT = 500;
const DEFAULT_EVENT_PAGE_LIMIT = 100;
// ---- P1 §5 扩展字段上限 ----
/** evidenceRef ≤200 字符 */
const MAX_EVIDENCE_REF_LENGTH = 200;
/** subjectRefs ≤20 项（与 tags 上限一致）、每项 ≤64 字符 */
const MAX_SUBJECT_REFS = MAX_TAGS;
const MAX_SUBJECT_REF_LENGTH = MAX_TAG_LENGTH;
/** riskThreadKey ≤64 字符 */
const MAX_THREAD_KEY_LENGTH = 64;

function fail(code: V4LifeErrorCode): never {
  throw new V4LifeError(code);
}

function invalidInput(): never {
  return fail('INVALID_ENGINE_INPUT');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requireNonEmptyString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalidInput();
  }
  return value;
}

function requireBoundedString(value: unknown, maxLength: number): string {
  const text = requireNonEmptyString(value);
  if (text.length > maxLength) {
    return invalidInput();
  }
  return text;
}

function requireNonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return invalidInput();
  }
  return value;
}

function isEvidenceKind(value: unknown): value is V4LifeEvidenceKind {
  return typeof value === 'string' && EVIDENCE_KINDS.has(value);
}

function isDecisionOutcome(value: unknown): value is V4LifeDecision['outcome'] {
  return typeof value === 'string' && DECISION_OUTCOMES.has(value);
}

function isV4LifeDomain(value: unknown): value is V4LifeDomain {
  return typeof value === 'string' && V4LIFE_DOMAINS.includes(value as V4LifeDomain);
}

function requireExactKeys(
  container: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): void {
  for (const key of required) {
    if (!(key in container)) {
      invalidInput();
    }
  }
  for (const key of Object.keys(container)) {
    if (!required.includes(key) && !optional.includes(key)) {
      invalidInput();
    }
  }
}

function requireStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    return invalidInput();
  }
  return value as string[];
}

// ---------------------------------------------------------------------------
// P1 语义扩展基础校验（失败关闭：一律 INVALID_ENGINE_INPUT；与 replay.ts 同规则）
// ---------------------------------------------------------------------------

/** 有界字符串数组：≤maxItems 项、每项非空 ≤maxLength 字符 */
function requireBoundedStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    return invalidInput();
  }
  return value.map((item) => requireBoundedString(item, maxLength));
}

/** §5 时间三元组：YYYY-MM-DD 或 YYYY-MM-DDTHH:mm:ss.sssZ */
function requireIsoTimestamp(value: unknown): string {
  const text = requireNonEmptyString(value);
  if (!ISO_TIMESTAMP_PATTERN.test(text)) {
    return invalidInput();
  }
  return text;
}

function isVerificationStatus(value: unknown): value is V4LifeVerificationStatus {
  return typeof value === 'string' && VERIFICATION_STATUSES.has(value);
}

function isVerificationTarget(value: unknown): value is V4LifeVerificationTarget {
  return typeof value === 'string' && VERIFICATION_TARGETS.has(value);
}

/** P1 §5 Evidence 扩展字段键（自然键组成部分；旧数据缺省时键与 P0 逐字节一致） */
const EVIDENCE_EXTENSION_KEYS: readonly string[] = [
  'sourceType', 'subjectRefs', 'observedAt', 'effectiveAt', 'expiresAt', 'evidenceRef', 'confidence',
  'verificationStatus', 'riskThreadKey',
];

/** 从 Evidence 对象提取已注入的 P1 扩展字段（canonicalize 会跳过 undefined，缺省即 P0 键） */
function evidenceExtensionOf(evidence: object): Record<string, unknown> {
  const source = evidence as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of EVIDENCE_EXTENSION_KEYS) {
    if (source[key] !== undefined) {
      out[key] = source[key];
    }
  }
  return out;
}

/**
 * P1 §5 命令级扩展字段解析（appendEvidence 用；全部可选、校验失败关闭）。
 * 关键规则：confidence 仅 sourceType==='model_derived' 时允许（否则 INVALID_ENGINE_INPUT）；
 * verificationStatus 不在本解析范围 —— append 恒置 'claimed'，不接受客户端传入（调用方先行拒绝）。
 */
function parseEvidenceExtension(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (source.sourceType !== undefined) {
    if (typeof source.sourceType !== 'string' || !EVIDENCE_SOURCE_TYPES.has(source.sourceType)) {
      return invalidInput();
    }
    out.sourceType = source.sourceType;
  }
  if (source.subjectRefs !== undefined) {
    out.subjectRefs = requireBoundedStringArray(source.subjectRefs, MAX_SUBJECT_REFS, MAX_SUBJECT_REF_LENGTH);
  }
  if (source.observedAt !== undefined) {
    out.observedAt = requireIsoTimestamp(source.observedAt);
  }
  if (source.effectiveAt !== undefined) {
    out.effectiveAt = requireIsoTimestamp(source.effectiveAt);
  }
  if (source.expiresAt !== undefined) {
    out.expiresAt = requireIsoTimestamp(source.expiresAt);
  }
  if (source.evidenceRef !== undefined) {
    out.evidenceRef = requireBoundedString(source.evidenceRef, MAX_EVIDENCE_REF_LENGTH);
  }
  if (source.confidence !== undefined) {
    if (
      typeof source.confidence !== 'number' ||
      !Number.isFinite(source.confidence) ||
      source.confidence < 0 ||
      source.confidence > 1
    ) {
      return invalidInput();
    }
    if (out.sourceType !== 'model_derived') {
      return invalidInput();
    }
    out.confidence = source.confidence;
  }
  if (source.riskThreadKey !== undefined) {
    out.riskThreadKey = requireBoundedString(source.riskThreadKey, MAX_THREAD_KEY_LENGTH);
  }
  return out;
}

/** P1 §5 事件级 Evidence 扩展校验（与 parseEvidenceExtension 同规则，重放失败关闭） */
function validateEvidenceExtensionObject(evidence: Record<string, unknown>): void {
  if (evidence.sourceType !== undefined) {
    if (typeof evidence.sourceType !== 'string' || !EVIDENCE_SOURCE_TYPES.has(evidence.sourceType)) {
      return invalidInput();
    }
  }
  if (evidence.subjectRefs !== undefined) {
    requireBoundedStringArray(evidence.subjectRefs, MAX_SUBJECT_REFS, MAX_SUBJECT_REF_LENGTH);
  }
  if (evidence.observedAt !== undefined) {
    requireIsoTimestamp(evidence.observedAt);
  }
  if (evidence.effectiveAt !== undefined) {
    requireIsoTimestamp(evidence.effectiveAt);
  }
  if (evidence.expiresAt !== undefined) {
    requireIsoTimestamp(evidence.expiresAt);
  }
  if (evidence.evidenceRef !== undefined) {
    requireBoundedString(evidence.evidenceRef, MAX_EVIDENCE_REF_LENGTH);
  }
  if (evidence.confidence !== undefined) {
    if (
      typeof evidence.confidence !== 'number' ||
      !Number.isFinite(evidence.confidence) ||
      evidence.confidence < 0 ||
      evidence.confidence > 1 ||
      evidence.sourceType !== 'model_derived'
    ) {
      return invalidInput();
    }
  }
  if (evidence.verificationStatus !== undefined && !isVerificationStatus(evidence.verificationStatus)) {
    return invalidInput();
  }
  if (evidence.riskThreadKey !== undefined) {
    requireBoundedString(evidence.riskThreadKey, MAX_THREAD_KEY_LENGTH);
  }
}

/** §6.1 命令载荷 payload：summary ≤2000 非空、tags ≤20×64 非空、amountCny 缺省或有限数 ≥0。 */
function requireCommandEvidencePayload(value: unknown): V4LifeEvidencePayload {
  if (!isObject(value)) {
    return invalidInput();
  }
  const summary = requireBoundedString(value.summary, MAX_SUMMARY_LENGTH);
  if (!Array.isArray(value.tags) || value.tags.length > MAX_TAGS) {
    return invalidInput();
  }
  const tags = value.tags.map((tag) => requireBoundedString(tag, MAX_TAG_LENGTH));
  if (value.amountCny === undefined) {
    return { summary, tags };
  }
  if (typeof value.amountCny !== 'number' || !Number.isFinite(value.amountCny) || value.amountCny < 0) {
    return invalidInput();
  }
  return { summary, tags, amountCny: value.amountCny };
}

// ---------------------------------------------------------------------------
// 规范化 payload（§6：去 commandId/expectedRev 后按键名递归排序的稳定 JSON）
// ---------------------------------------------------------------------------

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry === undefined) {
        continue;
      }
      out[key] = canonicalize(entry);
    }
    return out;
  }
  return value;
}

function normalizedJson(source: Record<string, unknown>): string {
  return JSON.stringify(canonicalize(source));
}

/**
 * evidenceId 自然键 / commandId 幂等键：命令去除 commandId/expectedRev 后的五个契约字段
 * ＋ P1 §5 扩展字段（extension；canonicalize 跳过 undefined，未注入扩展字段时与 P0 键逐字节一致，
 * 保证既有 durable journal / 旧事件流的键不漂移）。
 */
function evidenceCommandKey(
  evidenceId: string,
  kind: V4LifeEvidenceKind,
  title: string,
  submittedBy: string,
  payload: V4LifeEvidencePayload,
  extension: Record<string, unknown> = {},
): string {
  return normalizedJson({ evidenceId, kind, title, submittedBy, payload, ...extension });
}

// ---------------------------------------------------------------------------
// 引擎内部状态（派生缓存；事件是唯一权威记录，可由 seed + 事件流完全重建）
// ---------------------------------------------------------------------------

interface EvidenceRecord {
  evidence: V4LifeEvidence;
  commandKey: string;
  acceptedRev: number;
}

/** D077 收集窗口批次内部状态（投影视图见 V4LifeContextBatch） */
interface ContextBatchState {
  major: number;
  minor: number;
  status: V4LifeContextBatchStatus;
  openedAt?: string;
  sealedAt?: string;
}

/** P1 §8 Risk Thread 折叠状态（无 riskThreadKey 的对象不进线程；lastSeq 取关联对象最大事件序） */
interface RiskThreadState {
  riskThreadKey: string;
  evidenceIds: string[];
  workItemIds: string[];
  gateIds: string[];
  lastSeq: number;
}

/** 取/建线程折叠项（engine 与 replay 同构；插入序 = key 首次出现序） */
function threadOf(map: Map<string, RiskThreadState>, key: string): RiskThreadState {
  let thread = map.get(key);
  if (thread === undefined) {
    thread = { riskThreadKey: key, evidenceIds: [], workItemIds: [], gateIds: [], lastSeq: 0 };
    map.set(key, thread);
  }
  return thread;
}

/** 关联对象被事件触碰时更新 lastSeq（事件 seq 单调递增，直接赋值即可） */
function touchThread(map: Map<string, RiskThreadState>, key: unknown, seq: number): void {
  if (typeof key !== 'string' || key.length === 0) {
    return;
  }
  threadOf(map, key).lastSeq = seq;
}

interface EngineState {
  caseMeta: V4LifeCaseMeta;
  actors: Map<string, V4LifeActor>;
  workItems: Map<string, V4LifeWorkItem>;
  gates: Map<string, V4LifeGate>;
  evidence: Map<string, EvidenceRecord>;
  candidates: V4LifeCandidate[];
  contributions: V4LifeContribution[];
  receipts: V4LifeReceipt[];
  /** 每 Gate 最近一次决定 outcome（returned 也记录；receipt 依赖按此判定满足/否决） */
  gateOutcomes: Map<string, V4LifeDecision['outcome']>;
  receiptCounters: Map<string, number>;
  candidateCounters: Map<string, number>;
  contributionCounter: number;
  candidateIds: Set<string>;
  contributionIds: Set<string>;
  dedupeKeys: Set<string>;
  /** P1/D077：收集窗口批次（key = major）；种子骨架恒含 major=1 SEALED（隐含封存的演示材料） */
  contextBatches: Map<number, ContextBatchState>;
  /** P1/D077：最新批次 major（新开启批次 = 本值 + 1） */
  contextCurrentMajor: number;
  /** P1 §8：Risk Thread 折叠状态（key 首次出现序） */
  riskThreads: Map<string, RiskThreadState>;
  events: V4LifeEvent[];
}

type StoredCommandResult =
  | V4LifeAppendEvidenceResult
  | V4LifeSubmitWorkResult
  | V4LifeRecordDecisionResult
  | V4LifeChangeVerificationResult
  | V4LifeContextBatchResult;

// ---------------------------------------------------------------------------
// createV4LifeEngine（§7 frozen API）
// ---------------------------------------------------------------------------

export function createV4LifeEngine(seed: V4LifeSeedInput, options?: V4LifeEngineOptions): V4LifeEngine {
  if (options !== undefined && (typeof options !== 'object' || options === null || Array.isArray(options))) {
    invalidInput();
  }
  const eventLog: V4LifeEventLog | undefined = options?.eventLog;
  if (eventLog !== undefined && (typeof eventLog.append !== 'function' || typeof eventLog.loadAll !== 'function')) {
    invalidInput();
  }
  const commandJournal: V4LifeCommandJournal | undefined = options?.commandJournal;
  if (
    commandJournal !== undefined &&
    (typeof commandJournal.append !== 'function' || typeof commandJournal.loadAll !== 'function')
  ) {
    invalidInput();
  }
  const nowOption = options?.now;
  if (nowOption !== undefined && typeof nowOption !== 'function') {
    invalidInput();
  }
  const clock = (): string => (nowOption ? nowOption() : new Date().toISOString());
  // P1-BE-01 隔离（Control Channel Rev 0003）：candidate 语义默认关闭 —— 正式权威路径不启用
  // 未确认的 Human Role 指派、自动封存与默认 seed 状态；'demo' 为显式合成演示 opt-in。
  const p1CandidateSemantics: V4LifeP1CandidateSemantics = options?.p1CandidateSemantics ?? 'off';
  if (p1CandidateSemantics !== 'off' && p1CandidateSemantics !== 'demo') {
    invalidInput();
  }

  let state: EngineState = buildSkeletonState(seed);
  const caseId = state.caseMeta.caseId;

  // 运行期幂等缓存：commandId → { 规范化载荷, 原接受结果 }。事件不携带命令，无法由重放重建；
  // 注入 commandJournal 时由 journal 在构造尾部恢复（§15），否则仅存活于当前进程。
  // refold（eventLog 重建 / SEQ_CONFLICT 回滚）不清理本缓存；未注入 journal 时跨重启（eventLog 重建）
  // 后旧命令的 replay 不再命中，由对象状态规则与自然键兜底。
  const commandRecords = new Map<string, { commandKey: string; result: StoredCommandResult }>();

  let staged: V4LifeEvent[] = [];
  let revBefore = 0;

  // ---------------------------------------------------------------------------
  // 事件应用（与 §2/§3 一一对应；fail-closed：非法事件/非法迁移 → INVALID_ENGINE_INPUT）
  // ---------------------------------------------------------------------------

  function validateEvidenceObject(value: unknown): V4LifeEvidence {
    if (!isObject(value)) {
      return invalidInput();
    }
    requireExactKeys(
      value,
      ['evidenceId', 'caseId', 'kind', 'title', 'submittedBy', 'submittedAt', 'version', 'payload'],
      // P1 §5 扩展字段全部可选（缺省兼容旧事件；注入时按同规则失败关闭校验）
      ['sourceType', 'subjectRefs', 'observedAt', 'effectiveAt', 'expiresAt', 'evidenceRef', 'confidence', 'verificationStatus', 'riskThreadKey'],
    );
    const evidenceId = requireNonEmptyString(value.evidenceId);
    if (requireNonEmptyString(value.caseId) !== caseId) {
      return invalidInput();
    }
    if (!isEvidenceKind(value.kind)) {
      return invalidInput();
    }
    requireNonEmptyString(value.title);
    requireNonEmptyString(value.submittedBy);
    requireNonEmptyString(value.submittedAt);
    if (value.version !== 1) {
      return invalidInput();
    }
    const payload = value.payload;
    if (!isObject(payload)) {
      return invalidInput();
    }
    requireExactKeys(payload, ['summary', 'tags'], ['amountCny']);
    requireNonEmptyString(payload.summary);
    requireStringArray(payload.tags);
    if (
      payload.amountCny !== undefined &&
      (typeof payload.amountCny !== 'number' || !Number.isFinite(payload.amountCny) || payload.amountCny < 0)
    ) {
      return invalidInput();
    }
    validateEvidenceExtensionObject(value);
    if (state.evidence.has(evidenceId)) {
      return invalidInput();
    }
    return value as unknown as V4LifeEvidence;
  }

  function validateDecisionObject(value: unknown): V4LifeDecision {
    if (!isObject(value)) {
      return invalidInput();
    }
    requireExactKeys(value, ['outcome', 'actorId', 'reason', 'decidedAt'], []);
    if (!isDecisionOutcome(value.outcome)) {
      return invalidInput();
    }
    requireNonEmptyString(value.actorId);
    requireNonEmptyString(value.reason);
    requireNonEmptyString(value.decidedAt);
    return value as unknown as V4LifeDecision;
  }

  function validateReceiptObject(value: unknown, gateId: string): V4LifeReceipt {
    if (!isObject(value)) {
      return invalidInput();
    }
    requireExactKeys(value, ['receiptId', 'gateId', 'decision'], []);
    requireNonEmptyString(value.receiptId);
    if (requireNonEmptyString(value.gateId) !== gateId) {
      return invalidInput();
    }
    validateDecisionObject(value.decision);
    return value as unknown as V4LifeReceipt;
  }

  function validateContributionObject(value: unknown): V4LifeContribution {
    if (!isObject(value)) {
      return invalidInput();
    }
    requireExactKeys(
      value,
      ['contributionId', 'actorId', 'domain', 'workItemId', 'kind', 'summary', 'recordedAt', 'retainedAfterVeto'],
      [],
    );
    const contributionId = requireNonEmptyString(value.contributionId);
    requireNonEmptyString(value.actorId);
    if (!isV4LifeDomain(value.domain)) {
      return invalidInput();
    }
    const workItemId = requireNonEmptyString(value.workItemId);
    if (!state.workItems.has(workItemId)) {
      return invalidInput();
    }
    if (typeof value.kind !== 'string' || !CONTRIBUTION_KINDS.has(value.kind)) {
      return invalidInput();
    }
    requireNonEmptyString(value.summary);
    requireNonEmptyString(value.recordedAt);
    if (value.retainedAfterVeto !== true) {
      return invalidInput();
    }
    if (state.contributionIds.has(contributionId)) {
      return invalidInput();
    }
    return value as unknown as V4LifeContribution;
  }

  function validateCandidateObject(value: unknown): V4LifeCandidate {
    if (!isObject(value)) {
      return invalidInput();
    }
    requireExactKeys(
      value,
      ['candidateId', 'caseId', 'domain', 'kind', 'summary', 'basis', 'authority', 'producedBy', 'createdAt', 'dedupeKey'],
      ['workItemId'],
    );
    const candidateId = requireNonEmptyString(value.candidateId);
    if (requireNonEmptyString(value.caseId) !== caseId) {
      return invalidInput();
    }
    if (!isV4LifeDomain(value.domain)) {
      return invalidInput();
    }
    if (typeof value.kind !== 'string' || !CANDIDATE_KINDS.has(value.kind)) {
      return invalidInput();
    }
    requireNonEmptyString(value.summary);
    requireStringArray(value.basis);
    if (value.authority !== 'none') {
      return invalidInput();
    }
    if (value.producedBy !== 'deterministic-v1') {
      return invalidInput();
    }
    requireNonEmptyString(value.createdAt);
    const dedupeKey = requireNonEmptyString(value.dedupeKey);
    if (value.workItemId !== undefined) {
      const workItemId = requireNonEmptyString(value.workItemId);
      if (!state.workItems.has(workItemId)) {
        return invalidInput();
      }
    }
    if (state.candidateIds.has(candidateId) || state.dedupeKeys.has(dedupeKey)) {
      return invalidInput();
    }
    return value as unknown as V4LifeCandidate;
  }

  function dependencySatisfied(dep: V4LifeDependency): boolean {
    if (dep.kind === 'evidence') {
      return state.evidence.has(dep.id);
    }
    if (dep.kind === 'workitem') {
      return state.workItems.get(dep.id)?.status === 'completed';
    }
    return state.gateOutcomes.get(dep.id) === 'approved';
  }

  function applyEvent(event: V4LifeEvent): void {
    if (!isObject(event)) {
      return invalidInput();
    }
    requireExactKeys(event, ['seq', 'at', 'actor', 'payload'], []);
    if (typeof event.seq !== 'number' || !Number.isInteger(event.seq) || event.seq < 1) {
      return invalidInput();
    }
    requireNonEmptyString(event.at);
    requireNonEmptyString(event.actor);
    const payload = event.payload;
    if (!isObject(payload)) {
      return invalidInput();
    }
    const type = payload.type;
    if (typeof type !== 'string' || !EVENT_TYPES.has(type)) {
      return invalidInput();
    }

    switch (type) {
      case 'CASE_INITIALIZED': {
        requireExactKeys(payload, ['type', 'caseId'], []);
        if (requireNonEmptyString(payload.caseId) !== caseId) {
          return invalidInput();
        }
        // P1 种子行为：初始化自动产生的隐含批次 major=1 SEALED（对应既有演示材料的隐含封存）
        // 其 openedAt/sealedAt 取 CASE_INITIALIZED 事件 at —— 时间戳随事件流重放恢复，保证
        // engine refold 与 replay.ts rebuildProjection 重放等价（不引入时钟依赖）。
        const seedBatch = state.contextBatches.get(1);
        if (seedBatch !== undefined) {
          seedBatch.openedAt = event.at;
          seedBatch.sealedAt = event.at;
        }
        return;
      }
      case 'EVIDENCE_ACCEPTED': {
        requireExactKeys(payload, ['type', 'evidence'], []);
        const evidence = validateEvidenceObject(payload.evidence);
        state.evidence.set(evidence.evidenceId, {
          evidence: clone(evidence),
          commandKey: evidenceCommandKey(
            evidence.evidenceId,
            evidence.kind,
            evidence.title,
            evidence.submittedBy,
            evidence.payload,
            // P1：自然键携带扩展字段（缺省时与 P0 键逐字节一致）
            evidenceExtensionOf(evidence),
          ),
          acceptedRev: event.seq,
        });
        // P1 §8：Risk Thread 折叠（无 key 不进线程）
        if (evidence.riskThreadKey !== undefined) {
          const thread = threadOf(state.riskThreads, evidence.riskThreadKey);
          thread.evidenceIds.push(evidence.evidenceId);
          thread.lastSeq = event.seq;
        }
        return;
      }
      case 'WORK_ITEM_STARTED': {
        requireExactKeys(payload, ['type', 'workItemId'], []);
        const item = state.workItems.get(requireNonEmptyString(payload.workItemId));
        if (item === undefined || item.status !== 'blocked') {
          return invalidInput();
        }
        item.status = 'in_progress';
        touchThread(state.riskThreads, item.riskThreadKey, event.seq);
        return;
      }
      case 'WORK_ITEM_SUBMITTED': {
        requireExactKeys(payload, ['type', 'workItemId', 'actorId', 'outputSummary'], []);
        const item = state.workItems.get(requireNonEmptyString(payload.workItemId));
        if (item === undefined || item.status !== 'in_progress') {
          return invalidInput();
        }
        const actorId = requireNonEmptyString(payload.actorId);
        const outputSummary = requireNonEmptyString(payload.outputSummary);
        item.outputSummary = outputSummary;
        item.submittedBy = actorId;
        item.submittedAt = event.at;
        touchThread(state.riskThreads, item.riskThreadKey, event.seq);
        return;
      }
      case 'CONTRIBUTION_RECORDED': {
        requireExactKeys(payload, ['type', 'contribution'], []);
        const contribution = validateContributionObject(payload.contribution);
        state.contributionIds.add(contribution.contributionId);
        state.contributionCounter += 1;
        state.contributions.push(clone(contribution));
        return;
      }
      case 'CANDIDATE_ISSUED': {
        requireExactKeys(payload, ['type', 'candidate'], []);
        const candidate = validateCandidateObject(payload.candidate);
        state.candidateIds.add(candidate.candidateId);
        state.dedupeKeys.add(candidate.dedupeKey);
        state.candidateCounters.set(candidate.kind, (state.candidateCounters.get(candidate.kind) ?? 0) + 1);
        state.candidates.push(clone(candidate));
        return;
      }
      case 'GATE_OPENED': {
        requireExactKeys(payload, ['type', 'gateId', 'workItemId'], []);
        const gate = state.gates.get(requireNonEmptyString(payload.gateId));
        if (gate === undefined) {
          return invalidInput();
        }
        const workItemId = requireNonEmptyString(payload.workItemId);
        if (workItemId !== gate.workItemId) {
          return invalidInput();
        }
        const item = state.workItems.get(workItemId);
        if (item === undefined || item.status !== 'in_progress') {
          return invalidInput();
        }
        item.status = 'awaiting_gate';
        gate.status = 'open';
        gate.openedAt = event.at;
        touchThread(state.riskThreads, item.riskThreadKey, event.seq);
        return;
      }
      case 'DECISION_RECORDED': {
        requireExactKeys(payload, ['type', 'gateId', 'decision', 'receipt'], []);
        const gate = state.gates.get(requireNonEmptyString(payload.gateId));
        if (gate === undefined || gate.status !== 'open') {
          return invalidInput();
        }
        const decision = validateDecisionObject(payload.decision);
        const linked = state.workItems.get(gate.workItemId);
        if (linked === undefined || linked.status !== 'awaiting_gate') {
          return invalidInput();
        }
        if (decision.outcome === 'returned') {
          if (payload.receipt !== null) {
            return invalidInput();
          }
          gate.status = 'pending';
          linked.status = 'in_progress';
          state.gateOutcomes.set(gate.gateId, 'returned');
          touchThread(state.riskThreads, linked.riskThreadKey, event.seq);
          return;
        }
        const receipt = validateReceiptObject(payload.receipt, gate.gateId);
        gate.status = 'decided';
        state.receipts.push(clone(receipt));
        state.receiptCounters.set(gate.gateId, (state.receiptCounters.get(gate.gateId) ?? 0) + 1);
        state.gateOutcomes.set(gate.gateId, decision.outcome);
        linked.status = 'completed';
        linked.completedAt = decision.decidedAt;
        touchThread(state.riskThreads, linked.riskThreadKey, event.seq);
        return;
      }
      case 'WORK_ITEM_COMPLETED': {
        requireExactKeys(payload, ['type', 'workItemId', 'by'], []);
        const item = state.workItems.get(requireNonEmptyString(payload.workItemId));
        if (item === undefined) {
          return invalidInput();
        }
        requireNonEmptyString(payload.by);
        if (item.status !== 'in_progress' && item.status !== 'awaiting_gate' && item.status !== 'completed') {
          return invalidInput();
        }
        item.status = 'completed';
        item.completedAt = event.at;
        touchThread(state.riskThreads, item.riskThreadKey, event.seq);
        return;
      }
      case 'WORK_ITEM_STOPPED': {
        requireExactKeys(payload, ['type', 'workItemId', 'reason'], []);
        const item = state.workItems.get(requireNonEmptyString(payload.workItemId));
        if (item === undefined) {
          return invalidInput();
        }
        if (payload.reason !== 'upstream_gate_rejected') {
          return invalidInput();
        }
        if (item.status !== 'blocked') {
          return invalidInput();
        }
        item.status = 'stopped_dependency';
        touchThread(state.riskThreads, item.riskThreadKey, event.seq);
        return;
      }
      // -----------------------------------------------------------------------
      // P1 语义扩展事件（CANDIDATE；与 replay.ts rebuildProjection 逐分支同构，重放等价）
      // -----------------------------------------------------------------------
      case 'EVIDENCE_VERIFICATION_CHANGED': {
        requireExactKeys(payload, ['type', 'evidenceId', 'from', 'to', 'reason'], []);
        const record = state.evidence.get(requireNonEmptyString(payload.evidenceId));
        if (record === undefined) {
          return invalidInput();
        }
        if (!isVerificationStatus(payload.from) || !isVerificationTarget(payload.to)) {
          return invalidInput();
        }
        requireNonEmptyString(payload.reason);
        // from 必须与当前状态一致（旧数据缺省 verificationStatus 视为 'claimed'）——失败关闭
        if ((record.evidence.verificationStatus ?? 'claimed') !== payload.from) {
          return invalidInput();
        }
        record.evidence.verificationStatus = payload.to;
        touchThread(state.riskThreads, record.evidence.riskThreadKey, event.seq);
        return;
      }
      case 'CONTEXT_BATCH_OPENED': {
        requireExactKeys(payload, ['type', 'major'], []);
        const major = payload.major;
        if (typeof major !== 'number' || !Number.isInteger(major) || major !== state.contextCurrentMajor + 1) {
          return invalidInput();
        }
        // D077：新批次 minor=0、OPEN；openedAt 取事件 at（不重复入载荷）
        state.contextBatches.set(major, { major, minor: 0, status: 'OPEN', openedAt: event.at });
        state.contextCurrentMajor = major;
        return;
      }
      case 'CONTEXT_BATCH_STABILIZED': {
        requireExactKeys(payload, ['type', 'major'], []);
        const major = payload.major;
        if (typeof major !== 'number' || !Number.isInteger(major)) {
          return invalidInput();
        }
        const batch = state.contextBatches.get(major);
        if (batch === undefined || batch.status !== 'OPEN') {
          return invalidInput();
        }
        batch.status = 'STABILIZING';
        return;
      }
      case 'CONTEXT_BATCH_SEALED': {
        requireExactKeys(payload, ['type', 'major'], []);
        const major = payload.major;
        if (typeof major !== 'number' || !Number.isInteger(major)) {
          return invalidInput();
        }
        const batch = state.contextBatches.get(major);
        if (batch === undefined || batch.status !== 'STABILIZING') {
          return invalidInput();
        }
        // D077：SEALED 只说明该版本不可变（不表达“内容已正确”）；sealedAt 取事件 at
        batch.status = 'SEALED';
        batch.sealedAt = event.at;
        return;
      }
      case 'INPUT_EVENT_APPENDED': {
        requireExactKeys(payload, ['type', 'major', 'minor', 'inputEventId', 'actorId', 'kind', 'summary'], ['subjectRefs']);
        const major = payload.major;
        if (typeof major !== 'number' || !Number.isInteger(major)) {
          return invalidInput();
        }
        const batch = state.contextBatches.get(major);
        if (batch === undefined || batch.status !== 'OPEN') {
          return invalidInput();
        }
        if (payload.minor !== batch.minor + 1) {
          return invalidInput();
        }
        requireNonEmptyString(payload.inputEventId);
        requireNonEmptyString(payload.actorId);
        if (typeof payload.kind !== 'string' || !INPUT_EVENT_KINDS.has(payload.kind)) {
          return invalidInput();
        }
        requireNonEmptyString(payload.summary);
        if (payload.subjectRefs !== undefined) {
          requireBoundedStringArray(payload.subjectRefs, MAX_SUBJECT_REFS, MAX_SUBJECT_REF_LENGTH);
        }
        batch.minor = payload.minor;
        return;
      }
      default: {
        return invalidInput();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 种子骨架（§7/§11：items 全 blocked、gates 全 pending；与 §9 rebuildProjection 同构）
  // ---------------------------------------------------------------------------

  function validateSeedCase(value: unknown): V4LifeCaseMeta {
    if (!isObject(value)) {
      return invalidInput();
    }
    requireExactKeys(
      value,
      ['caseId', 'displayName', 'disclaimer', 'financingAmountCny', 'purpose', 'upstreamNote'],
      [],
    );
    const caseMetaId = requireNonEmptyString(value.caseId);
    const displayName = requireNonEmptyString(value.displayName);
    const disclaimer = requireNonEmptyString(value.disclaimer);
    const financingAmountCny = value.financingAmountCny;
    if (typeof financingAmountCny !== 'number' || !Number.isFinite(financingAmountCny) || financingAmountCny < 0) {
      return invalidInput();
    }
    const purpose = requireNonEmptyString(value.purpose);
    const upstreamNote = requireNonEmptyString(value.upstreamNote);
    return { caseId: caseMetaId, displayName, disclaimer, financingAmountCny, purpose, upstreamNote };
  }

  function buildSkeletonState(input: V4LifeSeedInput): EngineState {
    if (!isObject(input)) {
      return invalidInput();
    }
    const caseMeta = validateSeedCase(input.case);

    if (!Array.isArray(input.actors)) {
      return invalidInput();
    }
    const actors = new Map<string, V4LifeActor>();
    input.actors.forEach((raw) => {
      if (!isObject(raw)) {
        return invalidInput();
      }
      requireExactKeys(raw, ['actorId', 'role', 'displayName'], []);
      const actorId = requireNonEmptyString(raw.actorId);
      if (typeof raw.role !== 'string' || !ACTOR_ROLES.has(raw.role)) {
        return invalidInput();
      }
      const displayName = requireNonEmptyString(raw.displayName);
      actors.set(actorId, { actorId, role: raw.role as V4LifeActor['role'], displayName });
    });

    if (!Array.isArray(input.gates)) {
      return invalidInput();
    }
    const gates = new Map<string, V4LifeGate>();
    input.gates.forEach((raw) => {
      if (!isObject(raw)) {
        return invalidInput();
      }
      requireExactKeys(raw, ['gateId', 'domain', 'title', 'requiredRole', 'workItemId'], []);
      const gateId = requireNonEmptyString(raw.gateId);
      if (gates.has(gateId)) {
        return invalidInput();
      }
      if (!isV4LifeDomain(raw.domain)) {
        return invalidInput();
      }
      const title = requireNonEmptyString(raw.title);
      if (typeof raw.requiredRole !== 'string' || !ACTOR_ROLES.has(raw.requiredRole)) {
        return invalidInput();
      }
      const workItemId = requireNonEmptyString(raw.workItemId);
      gates.set(gateId, {
        gateId,
        caseId: caseMeta.caseId,
        domain: raw.domain,
        title,
        requiredRole: raw.requiredRole as V4LifeGate['requiredRole'],
        workItemId,
        status: 'pending',
      });
    });

    if (!Array.isArray(input.workItems)) {
      return invalidInput();
    }
    const workItems = new Map<string, V4LifeWorkItem>();
    input.workItems.forEach((raw) => {
      if (!isObject(raw)) {
        return invalidInput();
      }
      requireExactKeys(raw, ['workItemId', 'domain', 'title', 'dependencies', 'assignedRole'], ['gateId', 'riskThreadKey']);
      const workItemId = requireNonEmptyString(raw.workItemId);
      if (workItems.has(workItemId)) {
        return invalidInput();
      }
      if (!isV4LifeDomain(raw.domain)) {
        return invalidInput();
      }
      const title = requireNonEmptyString(raw.title);
      if (!Array.isArray(raw.dependencies)) {
        return invalidInput();
      }
      const dependencies: V4LifeDependency[] = raw.dependencies.map((dep) => {
        if (!isObject(dep)) {
          return invalidInput();
        }
        requireExactKeys(dep, ['kind', 'id'], []);
        if (typeof dep.kind !== 'string' || !DEPENDENCY_KINDS.has(dep.kind)) {
          return invalidInput();
        }
        return { kind: dep.kind as V4LifeDependency['kind'], id: requireNonEmptyString(dep.id) };
      });
      if (typeof raw.assignedRole !== 'string' || !ACTOR_ROLES.has(raw.assignedRole)) {
        return invalidInput();
      }
      let gateId: string | undefined;
      if (raw.gateId !== undefined) {
        gateId = requireNonEmptyString(raw.gateId);
        if (!gates.has(gateId)) {
          return invalidInput();
        }
      }
      // P1 §8：seed work item 可声明 riskThreadKey（≤64 字符；缺省不进线程）
      let riskThreadKey: string | undefined;
      if (raw.riskThreadKey !== undefined) {
        riskThreadKey = requireBoundedString(raw.riskThreadKey, MAX_THREAD_KEY_LENGTH);
      }
      workItems.set(workItemId, {
        workItemId,
        caseId: caseMeta.caseId,
        domain: raw.domain,
        title,
        dependencies,
        status: 'blocked',
        assignedRole: raw.assignedRole as V4LifeWorkItem['assignedRole'],
        ...(gateId !== undefined ? { gateId } : {}),
        ...(riskThreadKey !== undefined ? { riskThreadKey } : {}),
      });
    });

    for (const gate of gates.values()) {
      if (!workItems.has(gate.workItemId)) {
        return invalidInput();
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

    // P1/D077 收集窗口种子行为（P1-BE-01 隔离）：仅 p1CandidateSemantics='demo'（显式合成演示
    // Candidate）时初始化自动产生隐含批次 major=1 SEALED（对应既有演示材料的隐含封存），
    // contextVersion={major:1,minor:0}；openedAt/sealedAt 由 CASE_INITIALIZED 事件补齐（见 applyEvent），
    // 不在此引入时钟，保证 refold/rebuild 重放等价。默认 'off'（正式权威路径）不预置任何批次 ——
    // 自动封存/重开规则待 §11.3 用户确认，context 投影为 status='NONE' 空窗口。
    const contextBatches = new Map<number, ContextBatchState>();
    let contextCurrentMajor = 0;
    if (p1CandidateSemantics === 'demo') {
      contextBatches.set(1, { major: 1, minor: 0, status: 'SEALED' });
      contextCurrentMajor = 1;
    }

    return {
      caseMeta,
      actors,
      workItems,
      gates,
      evidence: new Map<string, EvidenceRecord>(),
      candidates: [],
      contributions: [],
      receipts: [],
      gateOutcomes: new Map<string, V4LifeDecision['outcome']>(),
      receiptCounters: new Map<string, number>(),
      candidateCounters: new Map<string, number>(),
      contributionCounter: 0,
      candidateIds: new Set<string>(),
      contributionIds: new Set<string>(),
      dedupeKeys: new Set<string>(),
      contextBatches,
      contextCurrentMajor,
      riskThreads,
      events: [],
    };
  }

  /** 回滚 / 重建：丢弃当前派生状态，从 seed 骨架重放已提交事件（staged 不含在内）。 */
  function refold(committed: V4LifeEvent[]): void {
    state = buildSkeletonState(seed);
    committed.forEach((event, index) => {
      if (!isObject(event) || event.seq !== index + 1) {
        return invalidInput();
      }
      applyEvent(event);
    });
    state.events = committed;
  }

  // ---------------------------------------------------------------------------
  // 事件发射与提交（注入 eventLog 时每次追加先过 log；失败回滚本轮派生状态）
  // ---------------------------------------------------------------------------

  function emit(actor: string, payload: V4LifeEventPayload, at: string): void {
    const event: V4LifeEvent = { seq: revBefore + staged.length + 1, at, actor, payload };
    applyEvent(event);
    staged.push(event);
  }

  function commit<T>(build: () => T): T {
    revBefore = state.events.length;
    staged = [];
    try {
      const value = build();
      if (eventLog !== undefined && staged.length > 0) {
        const appendResult = eventLog.append(caseId, revBefore, staged);
        if (!appendResult.ok) {
          fail('SEQ_CONFLICT');
        }
      }
      state.events.push(...staged);
      staged = [];
      return value;
    } catch (error) {
      if (staged.length > 0) {
        refold(state.events);
      }
      staged = [];
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 依赖三分法（§3）与 Candidate 确定性规则（§5）
  // ---------------------------------------------------------------------------

  /** 扫描全部 blocked 项：receipt 依赖被拒 → stopped_dependency；依赖全满足 → in_progress。按种子顺序。 */
  function recomputeBlockedWorkItems(): { startedWorkItemIds: string[]; stoppedWorkItemIds: string[] } {
    const startedWorkItemIds: string[] = [];
    const stoppedWorkItemIds: string[] = [];
    for (const item of state.workItems.values()) {
      if (item.status !== 'blocked') {
        continue;
      }
      const vetoed = item.dependencies.some(
        (dep) => dep.kind === 'receipt' && state.gateOutcomes.get(dep.id) === 'rejected',
      );
      if (vetoed) {
        emit('system', { type: 'WORK_ITEM_STOPPED', workItemId: item.workItemId, reason: 'upstream_gate_rejected' }, clock());
        stoppedWorkItemIds.push(item.workItemId);
        continue;
      }
      if (item.dependencies.every(dependencySatisfied)) {
        emit('system', { type: 'WORK_ITEM_STARTED', workItemId: item.workItemId }, clock());
        startedWorkItemIds.push(item.workItemId);
      }
    }
    return { startedWorkItemIds, stoppedWorkItemIds };
  }

  function issueCandidate(
    kind: 'contradiction' | 'missing_document',
    workItemId: string,
    basis: string[],
    summary: string,
  ): void {
    const dedupeKey = `${kind}|${workItemId}|${[...basis].sort().join(',')}`;
    if (state.dedupeKeys.has(dedupeKey)) {
      return;
    }
    const at = clock();
    const ordinal = (state.candidateCounters.get(kind) ?? 0) + 1;
    const prefix = kind === 'contradiction' ? 'cand-contradiction' : 'cand-missing';
    const candidate: V4LifeCandidate = {
      candidateId: `${prefix}-${ordinal}`,
      caseId,
      domain: 'credit',
      workItemId,
      kind,
      summary,
      basis: [...basis],
      authority: 'none',
      producedBy: 'deterministic-v1',
      createdAt: at,
      dedupeKey,
    };
    emit('system', { type: 'CANDIDATE_ISSUED', candidate }, at);
  }

  /** 只在 EVIDENCE_ACCEPTED 后扫描：R1 contradiction（→ WI-C2）、R2 missing_document（→ WI-C1）。 */
  function scanDeterministicCandidates(): void {
    const evidenceList = [...state.evidence.values()].map((record) => record.evidence);
    const financial = evidenceList.find(
      (entry) => entry.kind === 'financial_statement' && entry.payload.tags.includes('revenue_declining'),
    );
    const contract = evidenceList.find(
      (entry) =>
        entry.kind === 'contract_draft' &&
        typeof entry.payload.amountCny === 'number' &&
        entry.payload.amountCny >= 1_000_000,
    );
    if (financial !== undefined && contract !== undefined) {
      issueCandidate(
        'contradiction',
        'WI-C2',
        [financial.evidenceId, contract.evidenceId],
        `合同金额 ${contract.payload.amountCny} 元与财务报表“营收下滑”口径存在张力。`,
      );
    }
    const context = evidenceList.find((entry) => entry.kind === 'upstream_context');
    if (context !== undefined) {
      const missing = R2_REQUIRED_TAGS.filter((tag) => !context.payload.tags.includes(tag));
      if (missing.length > 0) {
        issueCandidate(
          'missing_document',
          'WI-C1',
          [context.evidenceId],
          `上游 Context 缺少核验标记：${missing.join('、')}，信审完整性核验需要补件。`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 幂等记录（§6 步骤 3）与 Actor 解析（§6 步骤 2）
  // ---------------------------------------------------------------------------

  function requireActor(actorId: string): V4LifeActor {
    const actor = state.actors.get(actorId);
    if (actor === undefined) {
      return fail('ACTOR_NOT_FOUND');
    }
    return actor;
  }

  /**
   * P1 candidate 命令闸门（P1-BE-01）：p1CandidateSemantics='off'（默认正式权威路径）时，
   * 五个 candidate 命令一律 INVALID_ENGINE_INPUT 失败关闭 —— 精确 Human Role（四域核验、
   * business open、policy stabilize/seal）与自动封存待 §11.3 用户确认前不得进入默认路径。
   * 历史上已接受的 candidate 命令不受影响：幂等 replay 走 §6 步骤 3 缓存/journal，先于本闸门。
   */
  function requireP1CandidateEnabled(): void {
    if (p1CandidateSemantics !== 'demo') {
      const error = new V4LifeError('INVALID_ENGINE_INPUT');
      (error as Error & { detail?: string }).detail =
        'v4life engine: P1 candidate command disabled (p1CandidateSemantics=off; semantics pending §11.3 user confirmation)';
      throw error;
    }
  }

  function lookupReplay(commandId: string, commandKey: string): StoredCommandResult | undefined {
    const record = commandRecords.get(commandId);
    if (record === undefined) {
      return undefined;
    }
    if (record.commandKey !== commandKey) {
      return fail('IDEMPOTENCY_CONFLICT');
    }
    return record.result;
  }

  /**
   * §15：accepted 命令的幂等落账 —— 注入 commandJournal 时先写 durable journal，再更新进程内缓存。
   * 双写非原子窗口（P1-BE-01 加固后的可证明语义）：
   *   - journal.append 成功 → 两态一致，跨重启 replay 由 journal 恢复；
   *   - journal.append 抛错 → 事件已提交（commit 在先，不可回滚），命令结果仍真实成立：
     进程内缓存照常写入（同进程重发同 commandId+同载荷按 §6 步骤 3 replayed，幂等语义不丢），
     同时把 journal 错误原样上抛（fail-closed：调用方看到失败，不伪造成功）。durable 记录缺失窗口
     仅剩 journal 自身故障/进程崩溃，重启后重发由事件状态规则兜底失败关闭（不重复事件、不重复
     Receipt）—— 文件适配器单次 appendFileSync 已把该窗口缩至最小；真实事务数据库是持久化部署前置。
   */
  function recordAcceptedCommand(
    commandId: string,
    command: V4LifeCommandJournalRecord['command'],
    commandKey: string,
    result: StoredCommandResult,
  ): void {
    if (commandJournal !== undefined) {
      try {
        commandJournal.append(caseId, {
          caseId,
          commandId,
          command,
          commandKey,
          result: clone(result),
          at: clock(),
        });
      } catch (error) {
        commandRecords.set(commandId, { commandKey, result: clone(result) });
        throw error;
      }
    }
    commandRecords.set(commandId, { commandKey, result: clone(result) });
  }

  function replayAppendResult(stored: StoredCommandResult): V4LifeAppendEvidenceResult {
    const result = stored as V4LifeAppendEvidenceResult;
    return {
      status: 'replayed',
      rev: result.rev,
      evidence: clone(result.evidence),
      startedWorkItemIds: clone(result.startedWorkItemIds),
    };
  }

  function replaySubmitResult(stored: StoredCommandResult): V4LifeSubmitWorkResult {
    const result = stored as V4LifeSubmitWorkResult;
    const replay: V4LifeSubmitWorkResult = {
      status: 'replayed',
      rev: result.rev,
      workItem: clone(result.workItem),
    };
    if (result.gate !== undefined) {
      replay.gate = clone(result.gate);
    }
    return replay;
  }

  function replayDecisionResult(stored: StoredCommandResult): V4LifeRecordDecisionResult {
    const result = stored as V4LifeRecordDecisionResult;
    return {
      status: 'replayed',
      rev: result.rev,
      receipt: result.receipt === null ? null : clone(result.receipt),
      stoppedWorkItemIds: clone(result.stoppedWorkItemIds),
      completedWorkItemIds: clone(result.completedWorkItemIds),
    };
  }

  /** P1 核验命令 replay：原始 accepted 结果换 status 后整体返回（§6 步骤 3，与既有命令一致） */
  function replayVerificationResult(stored: StoredCommandResult): V4LifeChangeVerificationResult {
    const result = stored as V4LifeChangeVerificationResult;
    return {
      status: 'replayed',
      rev: result.rev,
      evidence: clone(result.evidence),
    };
  }

  /** P1/D077 收集窗口命令族 replay（open/append/stabilize/seal 共用同一结果形状） */
  function replayContextBatchResult(stored: StoredCommandResult): V4LifeContextBatchResult {
    const result = stored as V4LifeContextBatchResult;
    return {
      status: 'replayed',
      rev: result.rev,
      batch: clone(result.batch),
    };
  }

  // ---------------------------------------------------------------------------
  // 命令一：appendEvidence（§6 校验顺序 → EVIDENCE_ACCEPTED → Candidate 扫描 → 依赖启动）
  // ---------------------------------------------------------------------------

  function appendEvidence(command: V4LifeAppendEvidenceCommand): V4LifeAppendEvidenceResult {
    if (!isObject(command)) {
      return invalidInput();
    }
    // 步骤 1：字段校验
    const commandId = requireNonEmptyString(command.commandId);
    requireNonNegativeInteger(command.expectedRev);
    const evidenceId = requireNonEmptyString(command.evidenceId);
    if (!isEvidenceKind(command.kind)) {
      return invalidInput();
    }
    const kind: V4LifeEvidenceKind = command.kind;
    const title = requireBoundedString(command.title, MAX_TITLE_LENGTH);
    const submittedBy = requireNonEmptyString(command.submittedBy);
    const payload = requireCommandEvidencePayload(command.payload);
    // P1 §5 扩展字段（全部可选）：verificationStatus 不接受客户端传入 —— append 恒置 'claimed'
    if ('verificationStatus' in command) {
      return invalidInput();
    }
    const extension = parseEvidenceExtension(command);
    // 步骤 2：Actor 存在
    const actor = requireActor(submittedBy);
    // 步骤 3：commandId 幂等（自然键含扩展字段；未注入扩展字段时与 P0 键逐字节一致）
    const commandKey = evidenceCommandKey(evidenceId, kind, title, submittedBy, payload, extension);
    const replay = lookupReplay(commandId, commandKey);
    if (replay !== undefined) {
      return replayAppendResult(replay);
    }
    // 步骤 4：版本竞争
    if (command.expectedRev !== state.events.length) {
      return fail('VERSION_CONFLICT');
    }
    // 步骤 6：evidenceId 自然键（本命令无 §3/§4 状态规则）
    const existing = state.evidence.get(evidenceId);
    if (existing !== undefined) {
      if (existing.commandKey !== commandKey) {
        return fail('EVIDENCE_CONFLICT');
      }
      return {
        status: 'replayed',
        rev: existing.acceptedRev,
        evidence: clone(existing.evidence),
        startedWorkItemIds: [],
      };
    }

    const result = commit<V4LifeAppendEvidenceResult>(() => {
      const at = clock();
      const base: V4LifeEvidence = {
        evidenceId,
        caseId,
        kind,
        title,
        submittedBy: actor.actorId,
        submittedAt: at,
        version: 1,
        payload: clone(payload),
      };
      // P1 §5：任一扩展字段出现即按 P1 形状落账，verificationStatus 由引擎恒置 'claimed'；
      // 未注入任何扩展字段时保持 P0 旧形状（逐字节向后兼容，旧事件/旧 journal 不受影响）。
      const evidence: V4LifeEvidence =
        Object.keys(extension).length > 0
          ? { ...base, ...(clone(extension) as Partial<V4LifeEvidence>), verificationStatus: 'claimed' }
          : base;
      emit(actor.actorId, { type: 'EVIDENCE_ACCEPTED', evidence }, at);
      scanDeterministicCandidates();
      const cascade = recomputeBlockedWorkItems();
      return {
        status: 'accepted',
        rev: revBefore + staged.length,
        evidence: clone(evidence),
        startedWorkItemIds: cascade.startedWorkItemIds,
      };
    });
    // 自然键 replay 的 rev 与同载荷 commandId replay 对齐：记录本次命令完成时的 rev
    // （refold 后回落为 EVIDENCE_ACCEPTED 事件的 seq，仅影响重建后不同 commandId 的自然键重放）。
    const acceptedRecord = state.evidence.get(evidenceId);
    if (acceptedRecord !== undefined) {
      acceptedRecord.acceptedRev = result.rev;
    }
    recordAcceptedCommand(commandId, 'evidence', commandKey, result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // 命令二：submitWork（in_progress → awaiting_gate（有 gate）或 completed（无 gate））
  // ---------------------------------------------------------------------------

  function submitWork(command: V4LifeSubmitWorkCommand): V4LifeSubmitWorkResult {
    if (!isObject(command)) {
      return invalidInput();
    }
    // 步骤 1：字段校验
    const commandId = requireNonEmptyString(command.commandId);
    requireNonNegativeInteger(command.expectedRev);
    const workItemId = requireNonEmptyString(command.workItemId);
    const actorId = requireNonEmptyString(command.actorId);
    const outputSummary = requireBoundedString(command.outputSummary, MAX_SUMMARY_LENGTH);
    // 步骤 2：Actor 存在
    const actor = requireActor(actorId);
    // 步骤 3：commandId 幂等
    const commandKey = normalizedJson({ workItemId, actorId, outputSummary });
    const replay = lookupReplay(commandId, commandKey);
    if (replay !== undefined) {
      return replaySubmitResult(replay);
    }
    // 步骤 4：版本竞争
    if (command.expectedRev !== state.events.length) {
      return fail('VERSION_CONFLICT');
    }
    // 步骤 5：状态与权限（§3/§4）
    const item = state.workItems.get(workItemId);
    if (item === undefined) {
      return fail('WORK_ITEM_NOT_FOUND');
    }
    if (item.status !== 'in_progress') {
      return fail('WORK_ITEM_NOT_ACTIVE');
    }
    if (actor.role !== item.assignedRole) {
      return fail('ROLE_MISMATCH');
    }

    const result = commit<V4LifeSubmitWorkResult>(() => {
      const submittedAt = clock();
      emit(actorId, { type: 'WORK_ITEM_SUBMITTED', workItemId, actorId, outputSummary }, submittedAt);
      const contributionAt = clock();
      const contribution: V4LifeContribution = {
        contributionId: `contrib-${state.contributionCounter + 1}`,
        actorId,
        domain: item.domain,
        workItemId,
        kind: 'cross_check',
        summary: outputSummary,
        recordedAt: contributionAt,
        retainedAfterVeto: true,
      };
      emit('system', { type: 'CONTRIBUTION_RECORDED', contribution }, contributionAt);
      if (item.gateId === undefined) {
        emit(actorId, { type: 'WORK_ITEM_COMPLETED', workItemId, by: actorId }, clock());
        recomputeBlockedWorkItems();
        return { status: 'accepted', rev: revBefore + staged.length, workItem: clone(item) };
      }
      const gate = state.gates.get(item.gateId);
      if (gate === undefined) {
        return fail('GATE_NOT_FOUND');
      }
      emit('system', { type: 'GATE_OPENED', gateId: gate.gateId, workItemId }, clock());
      return {
        status: 'accepted',
        rev: revBefore + staged.length,
        workItem: clone(item),
        gate: clone(gate),
      };
    });
    recordAcceptedCommand(commandId, 'work', commandKey, result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // 命令三：recordDecision（open → decided（approved/rejected，产生 Receipt）或 pending（returned））
  // ---------------------------------------------------------------------------

  function recordDecision(command: V4LifeRecordDecisionCommand): V4LifeRecordDecisionResult {
    if (!isObject(command)) {
      return invalidInput();
    }
    // 步骤 1：字段校验
    const commandId = requireNonEmptyString(command.commandId);
    requireNonNegativeInteger(command.expectedRev);
    const gateId = requireNonEmptyString(command.gateId);
    const actorId = requireNonEmptyString(command.actorId);
    if (!isDecisionOutcome(command.outcome)) {
      return invalidInput();
    }
    const outcome: V4LifeDecision['outcome'] = command.outcome;
    const reason = requireBoundedString(command.reason, MAX_SUMMARY_LENGTH);
    // 步骤 2：Actor 存在
    const actor = requireActor(actorId);
    // 步骤 3：commandId 幂等（先于 GATE_ALREADY_DECIDED 等状态规则）
    const commandKey = normalizedJson({ gateId, actorId, outcome, reason });
    const replay = lookupReplay(commandId, commandKey);
    if (replay !== undefined) {
      return replayDecisionResult(replay);
    }
    // 步骤 4：版本竞争
    if (command.expectedRev !== state.events.length) {
      return fail('VERSION_CONFLICT');
    }
    // 步骤 5：Gate 状态与权限（§3/§4）
    const gate = state.gates.get(gateId);
    if (gate === undefined) {
      return fail('GATE_NOT_FOUND');
    }
    if (gate.status === 'pending') {
      return fail('GATE_NOT_OPEN');
    }
    if (gate.status === 'decided') {
      return fail('GATE_ALREADY_DECIDED');
    }
    if (actor.role !== gate.requiredRole) {
      return fail('ROLE_MISMATCH');
    }

    const result = commit<V4LifeRecordDecisionResult>(() => {
      const decidedAt = clock();
      const decision: V4LifeDecision = { outcome, actorId, reason, decidedAt };
      const stoppedWorkItemIds: string[] = [];
      const completedWorkItemIds: string[] = [];
      let receipt: V4LifeReceipt | null = null;
      if (outcome === 'returned') {
        // 退回不发 Receipt：Gate 回 pending、linked item 回 in_progress
        emit(actorId, { type: 'DECISION_RECORDED', gateId, decision, receipt: null }, decidedAt);
      } else {
        const ordinal = (state.receiptCounters.get(gateId) ?? 0) + 1;
        receipt = { receiptId: `rcpt-${gateId}-${ordinal}`, gateId, decision };
        emit(actorId, { type: 'DECISION_RECORDED', gateId, decision, receipt }, decidedAt);
        // Gate 落定后 linked item 由引擎完成（专属完成事件 at = 完成时刻）
        emit(actorId, { type: 'WORK_ITEM_COMPLETED', workItemId: gate.workItemId, by: actorId }, clock());
        completedWorkItemIds.push(gate.workItemId);
        // 否决级联只作用于 blocked 且真实依赖该 Receipt 的项；其余照常依赖启动
        const cascade = recomputeBlockedWorkItems();
        stoppedWorkItemIds.push(...cascade.stoppedWorkItemIds);
      }
      return {
        status: 'accepted',
        rev: revBefore + staged.length,
        receipt: receipt === null ? null : clone(receipt),
        stoppedWorkItemIds,
        completedWorkItemIds,
      };
    });
    recordAcceptedCommand(commandId, 'decision', commandKey, result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // 命令四：changeVerification（P1 Human 核验；产 EVIDENCE_VERIFICATION_CHANGED，rev 递增）
  // CANDIDATE（待 §11.3 确认）：核验是四域 Human 职责 —— 业务不得自核验；Agent/模型 authority=none
  // 恒不得核验（role ∈ policy/credit/commerce/asset）。
  // ---------------------------------------------------------------------------

  function changeVerification(command: V4LifeChangeVerificationCommand): V4LifeChangeVerificationResult {
    if (!isObject(command)) {
      return invalidInput();
    }
    // 步骤 1：字段校验（目标仅 'unverified'|'verified'|'contradicted'|'stale'；'claimed' 禁止本命令设置）
    const commandId = requireNonEmptyString(command.commandId);
    requireNonNegativeInteger(command.expectedRev);
    const evidenceId = requireNonEmptyString(command.evidenceId);
    const actorId = requireNonEmptyString(command.actorId);
    if (!isVerificationTarget(command.verificationStatus)) {
      return invalidInput();
    }
    const target = command.verificationStatus;
    const reason = requireBoundedString(command.reason, MAX_SUMMARY_LENGTH);
    // 步骤 2：Actor 存在
    const actor = requireActor(actorId);
    // 步骤 3：commandId 幂等（op 判别符防跨命令族键冲突）
    const commandKey = normalizedJson({
      op: 'changeVerification', evidenceId, actorId, verificationStatus: target, reason,
    });
    const replay = lookupReplay(commandId, commandKey);
    if (replay !== undefined) {
      return replayVerificationResult(replay);
    }
    // P1-BE-01 闸门：默认正式路径失败关闭（核验角色矩阵待 §11.3 确认）。
    // 位置在幂等 lookup 之后：历史上已接受的 candidate 命令跨模式重发仍按 §6 步骤 3 replayed。
    requireP1CandidateEnabled();
    // 步骤 4：版本竞争
    if (command.expectedRev !== state.events.length) {
      return fail('VERSION_CONFLICT');
    }
    // 步骤 5：对象状态与权限（§6 顺序：对象存在 → 角色）
    const record = state.evidence.get(evidenceId);
    if (record === undefined) {
      return fail('EVIDENCE_NOT_FOUND');
    }
    if (!VERIFICATION_ROLES.has(actor.role)) {
      return fail('ROLE_MISMATCH');
    }

    const result = commit<V4LifeChangeVerificationResult>(() => {
      const at = clock();
      const from: V4LifeVerificationStatus = record.evidence.verificationStatus ?? 'claimed';
      emit(actor.actorId, { type: 'EVIDENCE_VERIFICATION_CHANGED', evidenceId, from, to: target, reason }, at);
      return {
        status: 'accepted',
        rev: revBefore + staged.length,
        evidence: clone(record.evidence),
      };
    });
    recordAcceptedCommand(commandId, 'verification', commandKey, result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // P1/D076-D077 收集窗口命令族（open → append×n → stabilize → seal）
  // P1-BE-01 闸门：p1CandidateSemantics='off'（默认）时整族失败关闭 —— 精确 Human Role
  // （open=业务、stabilize/seal=政策）与自动封存规则均为 CANDIDATE（待 §11.3 确认）；
  // 'demo' 时启用：InputEvent 提交人不限角色（仅要求具名 actor，业务/四域皆可登记批复后外部变化）。
  // batchId 约定 = 批次 major 的十进制字符串（如 '1'），与 Projection context.batches[].major 一一对应。
  // journal 注记：本命令族经 recordAcceptedCommand 以 'context_batch' 类别入 durable journal
  //（P1-BE-01 加固；此前仅进程内缓存，重启后幂等丢失），重启后同 commandId 重发 → replayed。
  // ---------------------------------------------------------------------------

  /** batchId（major 十进制字符串）→ 批次；非规范形式或不存在一律 CONTEXT_BATCH_NOT_FOUND（404）。 */
  function requireContextBatch(batchId: string): ContextBatchState {
    const major = Number(batchId);
    if (!Number.isInteger(major) || String(major) !== batchId) {
      return fail('CONTEXT_BATCH_NOT_FOUND');
    }
    const batch = state.contextBatches.get(major);
    if (batch === undefined) {
      return fail('CONTEXT_BATCH_NOT_FOUND');
    }
    return batch;
  }

  /** 批次投影视图（深克隆前构造；openedAt/sealedAt 缺省省略） */
  function batchView(batch: ContextBatchState): V4LifeContextBatch {
    const view: V4LifeContextBatch = { major: batch.major, minor: batch.minor, status: batch.status };
    if (batch.openedAt !== undefined) {
      view.openedAt = batch.openedAt;
    }
    if (batch.sealedAt !== undefined) {
      view.sealedAt = batch.sealedAt;
    }
    return view;
  }

  function openContextBatch(command: V4LifeOpenContextBatchCommand): V4LifeContextBatchResult {
    if (!isObject(command)) {
      return invalidInput();
    }
    // 步骤 1：字段校验
    const commandId = requireNonEmptyString(command.commandId);
    requireNonNegativeInteger(command.expectedRev);
    const actorId = requireNonEmptyString(command.actorId);
    const reason = requireBoundedString(command.reason, MAX_SUMMARY_LENGTH);
    // 步骤 2：Actor 存在
    const actor = requireActor(actorId);
    // 步骤 3：commandId 幂等
    const commandKey = normalizedJson({ op: 'openContextBatch', actorId, reason });
    const replay = lookupReplay(commandId, commandKey);
    if (replay !== undefined) {
      return replayContextBatchResult(replay);
    }
    // P1-BE-01 闸门（幂等 lookup 之后，历史命令跨模式 replay 不受影响）
    requireP1CandidateEnabled();
    // 步骤 4：版本竞争
    if (command.expectedRev !== state.events.length) {
      return fail('VERSION_CONFLICT');
    }
    // 步骤 5：角色（CANDIDATE，待 §11.3）：开启收集窗口是业务动作，仅 business
    if (actor.role !== 'business') {
      return fail('ROLE_MISMATCH');
    }

    const result = commit<V4LifeContextBatchResult>(() => {
      const at = clock();
      // 无状态前置：任何时刻都可开启新批次（major=上一 major+1、minor=0、OPEN）
      emit(actor.actorId, { type: 'CONTEXT_BATCH_OPENED', major: state.contextCurrentMajor + 1 }, at);
      const batch = state.contextBatches.get(state.contextCurrentMajor);
      if (batch === undefined) {
        // 不变式违例（applyEvent 已保证批次存在）；失败关闭
        return invalidInput();
      }
      return { status: 'accepted', rev: revBefore + staged.length, batch: batchView(batch) };
    });
    recordAcceptedCommand(commandId, 'context_batch', commandKey, result);
    return result;
  }

  function appendInputEvent(command: V4LifeAppendInputEventCommand): V4LifeContextBatchResult {
    if (!isObject(command)) {
      return invalidInput();
    }
    // 步骤 1：字段校验
    const commandId = requireNonEmptyString(command.commandId);
    requireNonNegativeInteger(command.expectedRev);
    const batchId = requireNonEmptyString(command.batchId);
    const actorId = requireNonEmptyString(command.actorId);
    const inputEventId = requireNonEmptyString(command.inputEventId);
    if (typeof command.kind !== 'string' || !INPUT_EVENT_KINDS.has(command.kind)) {
      return invalidInput();
    }
    const kind = command.kind;
    const summary = requireBoundedString(command.summary, MAX_SUMMARY_LENGTH);
    const subjectRefs =
      command.subjectRefs === undefined
        ? undefined
        : requireBoundedStringArray(command.subjectRefs, MAX_SUBJECT_REFS, MAX_SUBJECT_REF_LENGTH);
    // 步骤 2：Actor 存在
    const actor = requireActor(actorId);
    // 步骤 3：commandId 幂等
    const commandKey = normalizedJson({
      op: 'appendInputEvent', batchId, actorId, inputEventId, kind, summary, subjectRefs,
    });
    const replay = lookupReplay(commandId, commandKey);
    if (replay !== undefined) {
      return replayContextBatchResult(replay);
    }
    // P1-BE-01 闸门（幂等 lookup 之后，历史命令跨模式 replay 不受影响）
    requireP1CandidateEnabled();
    // 步骤 4：版本竞争
    if (command.expectedRev !== state.events.length) {
      return fail('VERSION_CONFLICT');
    }
    // 步骤 5：批次存在（404）→ 窗口开启（409）
    const batch = requireContextBatch(batchId);
    if (batch.status !== 'OPEN') {
      return fail('CONTEXT_WINDOW_NOT_OPEN');
    }
    const major = batch.major;

    const result = commit<V4LifeContextBatchResult>(() => {
      const at = clock();
      emit(
        actor.actorId,
        {
          type: 'INPUT_EVENT_APPENDED',
          major,
          minor: batch.minor + 1,
          inputEventId,
          actorId,
          kind,
          summary,
          ...(subjectRefs !== undefined ? { subjectRefs } : {}),
        },
        at,
      );
      return { status: 'accepted', rev: revBefore + staged.length, batch: batchView(batch) };
    });
    recordAcceptedCommand(commandId, 'context_batch', commandKey, result);
    return result;
  }

  function stabilizeContextBatch(command: V4LifeStabilizeContextBatchCommand): V4LifeContextBatchResult {
    if (!isObject(command)) {
      return invalidInput();
    }
    // 步骤 1：字段校验
    const commandId = requireNonEmptyString(command.commandId);
    requireNonNegativeInteger(command.expectedRev);
    const batchId = requireNonEmptyString(command.batchId);
    const actorId = requireNonEmptyString(command.actorId);
    const reason = requireBoundedString(command.reason, MAX_SUMMARY_LENGTH);
    // 步骤 2：Actor 存在
    const actor = requireActor(actorId);
    // 步骤 3：commandId 幂等（op 判别符：stabilize/seal 载荷形状相同，同 commandId 异命令必冲突）
    const commandKey = normalizedJson({ op: 'stabilizeContextBatch', batchId, actorId, reason });
    const replay = lookupReplay(commandId, commandKey);
    if (replay !== undefined) {
      return replayContextBatchResult(replay);
    }
    // P1-BE-01 闸门（幂等 lookup 之后，历史命令跨模式 replay 不受影响）
    requireP1CandidateEnabled();
    // 步骤 4：版本竞争
    if (command.expectedRev !== state.events.length) {
      return fail('VERSION_CONFLICT');
    }
    // 步骤 5：批次存在 → 角色（CANDIDATE，待 §11.3：policy）→ 状态机（仅 OPEN→STABILIZING）
    const batch = requireContextBatch(batchId);
    if (actor.role !== 'policy') {
      return fail('ROLE_MISMATCH');
    }
    if (batch.status !== 'OPEN') {
      return fail('CONTEXT_BATCH_INVALID_TRANSITION');
    }
    const major = batch.major;

    const result = commit<V4LifeContextBatchResult>(() => {
      const at = clock();
      emit(actor.actorId, { type: 'CONTEXT_BATCH_STABILIZED', major }, at);
      return { status: 'accepted', rev: revBefore + staged.length, batch: batchView(batch) };
    });
    recordAcceptedCommand(commandId, 'context_batch', commandKey, result);
    return result;
  }

  function sealContextBatch(command: V4LifeSealContextBatchCommand): V4LifeContextBatchResult {
    if (!isObject(command)) {
      return invalidInput();
    }
    // 步骤 1：字段校验
    const commandId = requireNonEmptyString(command.commandId);
    requireNonNegativeInteger(command.expectedRev);
    const batchId = requireNonEmptyString(command.batchId);
    const actorId = requireNonEmptyString(command.actorId);
    const reason = requireBoundedString(command.reason, MAX_SUMMARY_LENGTH);
    // 步骤 2：Actor 存在
    const actor = requireActor(actorId);
    // 步骤 3：commandId 幂等
    const commandKey = normalizedJson({ op: 'sealContextBatch', batchId, actorId, reason });
    const replay = lookupReplay(commandId, commandKey);
    if (replay !== undefined) {
      return replayContextBatchResult(replay);
    }
    // P1-BE-01 闸门（幂等 lookup 之后，历史命令跨模式 replay 不受影响）
    requireP1CandidateEnabled();
    // 步骤 4：版本竞争
    if (command.expectedRev !== state.events.length) {
      return fail('VERSION_CONFLICT');
    }
    // 步骤 5：批次存在 → 角色（CANDIDATE，待 §11.3：policy）→ 状态机（仅 STABILIZING→SEALED）
    const batch = requireContextBatch(batchId);
    if (actor.role !== 'policy') {
      return fail('ROLE_MISMATCH');
    }
    if (batch.status !== 'STABILIZING') {
      return fail('CONTEXT_BATCH_INVALID_TRANSITION');
    }
    const major = batch.major;

    const result = commit<V4LifeContextBatchResult>(() => {
      const at = clock();
      emit(actor.actorId, { type: 'CONTEXT_BATCH_SEALED', major }, at);
      return { status: 'accepted', rev: revBefore + staged.length, batch: batchView(batch) };
    });
    recordAcceptedCommand(commandId, 'context_batch', commandKey, result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // 初始化：注入 eventLog 且已有事件 → 折叠重建；否则发出 CASE_INITIALIZED + 种子初始证据
  // ---------------------------------------------------------------------------

  function acceptInitialEvidence(item: V4LifeSeedInitialEvidence): void {
    // 种子内部追加：豁免 commandId/expectedRev，但事件载荷完整（§6）
    const evidenceId = requireNonEmptyString(item.evidenceId);
    if (!isEvidenceKind(item.kind)) {
      return invalidInput();
    }
    const title = requireBoundedString(item.title, MAX_TITLE_LENGTH);
    const submittedBy = requireNonEmptyString(item.submittedBy);
    const payload = requireCommandEvidencePayload(item.payload);
    const actor = requireActor(submittedBy);
    const existing = state.evidence.get(evidenceId);
    if (existing !== undefined) {
      const commandKey = evidenceCommandKey(evidenceId, item.kind, title, submittedBy, payload);
      if (existing.commandKey !== commandKey) {
        return fail('EVIDENCE_CONFLICT');
      }
      return;
    }
    const at = clock();
    const evidence: V4LifeEvidence = {
      evidenceId,
      caseId,
      kind: item.kind,
      title,
      submittedBy: actor.actorId,
      submittedAt: at,
      version: 1,
      payload: clone(payload),
    };
    emit(actor.actorId, { type: 'EVIDENCE_ACCEPTED', evidence }, at);
    scanDeterministicCandidates();
  }

  function initializeCase(): void {
    commit<void>(() => {
      emit('system', { type: 'CASE_INITIALIZED', caseId }, clock());
      for (const item of seed.initialEvidence ?? []) {
        acceptInitialEvidence(item);
      }
      recomputeBlockedWorkItems();
    });
  }

  if (eventLog !== undefined) {
    const existing = eventLog.loadAll(caseId);
    if (existing.length > 0) {
      const first = existing[0];
      if (!isObject(first) || !isObject(first.payload) || first.payload.type !== 'CASE_INITIALIZED') {
        invalidInput();
      }
      refold(existing);
    } else {
      initializeCase();
    }
  } else {
    initializeCase();
  }

  // §15：注入 commandJournal 时恢复跨重启的 commandId 幂等缓存。执行顺序在 refold/初始化之后
  // （refold 不清理 commandRecords，恢复值不受影响）；journal 记录按 loadAll 顺序合并，
  // 同 commandId 以最后一条为准（journal 为 durable 权威）。journal 与 eventLog 预期成对注入、
  // 成对清空；loadAll 为空时行为与不注入完全一致。
  if (commandJournal !== undefined) {
    for (const record of commandJournal.loadAll(caseId)) {
      if (
        !isObject(record) ||
        typeof record.commandId !== 'string' ||
        record.commandId.length === 0 ||
        typeof record.commandKey !== 'string' ||
        record.commandKey.length === 0 ||
        !isObject(record.result)
      ) {
        invalidInput();
      }
      // §15 一致性守卫（P1-BE-01）：journal 是事件提交后的从属账本，其记录 rev 必然 ≤ 当前事件流
      // 长度。rev 超前 = journal 与 eventLog 错配、事件账本被截断/替换或跨 case 混用 —— 失败关闭，
      // 不凭 journal 伪造幂等恢复（"journal 已写、事件缺失"的反向场景由此阻断）。
      const restored = record.result as { status?: unknown; rev?: unknown };
      if (
        restored.status !== 'accepted' ||
        typeof restored.rev !== 'number' ||
        !Number.isInteger(restored.rev) ||
        restored.rev < 1 ||
        restored.rev > state.events.length
      ) {
        invalidInput();
      }
      commandRecords.set(record.commandId, { commandKey: record.commandKey, result: clone(record.result) });
    }
  }

  // ---------------------------------------------------------------------------
  // 查询（§7/§8：深克隆，不暴露内部可变引用）
  // ---------------------------------------------------------------------------

  function getProjection(): V4LifeProjection {
    const workItemList = [...state.workItems.values()];
    const gateList = [...state.gates.values()];
    // P1/D077：窗口投影 = 最新批次（major 最大）+ 全部批次（最新在前，major 降序）；
    // strict 默认路径（P1-BE-01）未开启任何批次时输出 'NONE' 空窗口，不伪造状态。
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
              .map((batch) => batchView(batch)),
          };
    // P1 §8：Risk Thread 投影（key 首次出现序；无 key 的对象不进线程）
    const riskThreads: V4LifeRiskThread[] = [...state.riskThreads.values()];
    const projection: V4LifeProjection = {
      case: { ...state.caseMeta },
      // §14.1：actor 名册按 seed 顺序输出（actors Map 即按 seed 插入序），随整体 clone 深克隆
      actors: [...state.actors.values()],
      rev: state.events.length,
      domains: V4LIFE_DOMAINS.map((domain) => ({
        domain,
        workItems: workItemList.filter((item) => item.domain === domain),
        gates: gateList.filter((gate) => gate.domain === domain),
        candidates: state.candidates.filter((candidate) => candidate.domain === domain),
      })),
      openGates: gateList.filter((gate) => gate.status === 'open'),
      receipts: [...state.receipts],
      contributions: [...state.contributions],
      evidence: [...state.evidence.values()].map((record) => record.evidence),
      evidenceCount: state.evidence.size,
      eventCount: state.events.length,
      context,
      riskThreads,
      generatedAt: clock(),
    };
    return clone(projection);
  }

  function getEvents(afterSeq: number, limit?: number): { events: V4LifeEvent[]; nextSeq: number; hasMore: boolean } {
    requireNonNegativeInteger(afterSeq);
    let pageLimit = DEFAULT_EVENT_PAGE_LIMIT;
    if (limit !== undefined) {
      requireNonNegativeInteger(limit);
      if (limit < 1) {
        return invalidInput();
      }
      pageLimit = Math.min(limit, MAX_EVENT_PAGE_LIMIT);
    }
    const total = state.events.length;
    const available = afterSeq >= total ? 0 : total - afterSeq;
    const count = Math.min(pageLimit, available);
    const events = state.events.slice(afterSeq, afterSeq + count).map((event) => clone(event));
    return { events, nextSeq: total, hasMore: available > count };
  }

  return {
    caseId,
    get rev() {
      return state.events.length;
    },
    appendEvidence,
    submitWork,
    recordDecision,
    changeVerification,
    openContextBatch,
    appendInputEvent,
    stabilizeContextBatch,
    sealContextBatch,
    getProjection,
    getEvents,
  };
}
