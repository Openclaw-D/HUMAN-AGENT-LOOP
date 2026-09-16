// V4-LIFE 四域轻量协同内核类型 —— 契约唯一类型源
// 权威：docs/v4/CONTRACT.md（FROZEN FOR THIS SLICE / 2026-09-03）§1/§2/§6/§7/§8/§11/§12 逐字落地。
// 权威边界：Agent/模型 authority=none；正式状态变化只来自确定性规则或具名 Human Gate。
// 本文件只承载类型；实现见 engine.ts（内核）、event-log.ts（存储 port，Lane B）。

import type { V4LifeEventLog } from './event-log.ts';

// ---------------------------------------------------------------------------
// §1 对象与类型（exact）
// ---------------------------------------------------------------------------

export type V4LifeDomain = 'policy' | 'credit' | 'commerce' | 'asset';

export type V4LifeActorRole = 'business' | 'policy' | 'credit' | 'commerce' | 'asset' | 'system';

export type V4LifeEvidenceKind =
  | 'upstream_context'
  | 'financial_statement'
  | 'contract_draft'
  | 'asset_history_feedback'
  | 'supplement';

// ---------------------------------------------------------------------------
// P1 语义扩展类型（CANDIDATE —— 上位契约 versions/V4/P1_GOLDEN_CASE_CONTRACT.md §5/§8/§12
// ＋ 工程提案 docs/v4/P1_SCHEMA_EXTENSION_PROPOSAL.md A/B/C 节）
// 说明：以下语义中“角色/状态机/时间阈值”等仍待 §11.3（用户/有权专家）确认，落地时以 CANDIDATE 注记；
// 全部新字段可选、新命令旁路 —— 不注入新字段/不调新命令时引擎行为与 P0 逐字节一致（向后兼容）。
// ---------------------------------------------------------------------------

/** §5 Evidence 来源类型（CANDIDATE 枚举，随 §5 冻结） */
export type V4LifeEvidenceSourceType =
  | 'business_statement'
  | 'original_document'
  | 'existing_system'
  | 'authorized_external'
  | 'human_review'
  | 'model_derived';

/** §5 核验状态五分类；append 恒置 'claimed'，后续只能经 changeVerification 命令改变 */
export type V4LifeVerificationStatus = 'claimed' | 'unverified' | 'verified' | 'contradicted' | 'stale';

/** changeVerification 允许的目标状态（'claimed' 只能是 append 初始值，禁止本命令设置） */
export type V4LifeVerificationTarget = Exclude<V4LifeVerificationStatus, 'claimed'>;

/** D076 InputEvent 种类（CANDIDATE，随 §12 P1-01 冻结） */
export type V4LifeInputEventKind = 'document' | 'answer' | 'external_data' | 'correction';

/** D077 收集窗口批次状态机 OPEN→STABILIZING→SEALED（角色/迁移规则为 CANDIDATE，待 §11.3） */
export type V4LifeContextBatchStatus = 'OPEN' | 'STABILIZING' | 'SEALED';

/**
 * 收集窗口投影视图顶层状态。批次本身永远只能是三种 D077 状态；
 * 'NONE' 只出现在 V4LifeContextWindow 顶层，表示 strict 默认路径（p1CandidateSemantics='off'，
 * P1-BE-01 隔离）尚未开启任何批次 —— 自动封存/重开规则待 §11.3 用户确认，默认不预置批次。
 */
export type V4LifeContextWindowStatus = V4LifeContextBatchStatus | 'NONE';

/**
 * P1 Candidate 语义开关（P1-BE-01 隔离，Control Channel Rev 0003 裁决）：
 * - `'off'`（默认，正式权威路径）：五个 P1 candidate 命令（changeVerification + 收集窗口四命令）
 *   一律 INVALID_ENGINE_INPUT 失败关闭；初始化不自动产生隐含批次 major=1 SEALED（context 为
 *   status='NONE' 空窗口）。Evidence §5 扩展字段、新事件类型、投影字段与历史事件重放 graceful
 *   fallback 保持可用 —— 未注入新字段/不调用新命令时行为与 P0 一致（向后兼容）。
 * - `'demo'`：显式合成演示 Candidate —— 启用上述命令与种子隐含批次。其中精确 Human Role
 *   （四域核验、business open、policy stabilize/seal）与自动封存仍属 CANDIDATE，
 *   待 §11.3 用户/有权专家确认，不得宣称 FROZEN/ACCEPTED。
 */
export type V4LifeP1CandidateSemantics = 'off' | 'demo';

export interface V4LifeActor {
  actorId: string;
  role: V4LifeActorRole;
  displayName: string;
}

export interface V4LifeEvidencePayload {
  summary: string;
  amountCny?: number;
  tags: string[];
}

export interface V4LifeEvidence {
  evidenceId: string;
  caseId: string;
  kind: V4LifeEvidenceKind;
  title: string;
  submittedBy: string;
  submittedAt: string;
  version: 1;
  payload: V4LifeEvidencePayload;
  // ---- P1 §5 扩展（全部可选：缺省即 P0 旧形状，逐字节向后兼容） ----
  /** 来源类型（§5） */
  sourceType?: V4LifeEvidenceSourceType;
  /** 主体/关系/租赁物引用（每项 ≤64 字符，≤20 项） */
  subjectRefs?: string[];
  /** 时间三元组：观察/适用/过期（非空 ISO：YYYY-MM-DD 或 YYYY-MM-DDTHH:mm:ss.sssZ） */
  observedAt?: string;
  effectiveAt?: string;
  expiresAt?: string;
  /** 可回到来源的引用（≤200 字符） */
  evidenceRef?: string;
  /** 仅 sourceType==='model_derived' 时允许（0..1）；不得替代 verificationStatus */
  confidence?: number;
  /** 核验状态：append 时由引擎恒置 'claimed'（不接受客户端传入）；旧数据缺省视为 'claimed' */
  verificationStatus?: V4LifeVerificationStatus;
  /** P1 Risk Thread 关联键（≤64 字符；无 key 的对象不进线程） */
  riskThreadKey?: string;
}

export type V4LifeWorkItemStatus =
  | 'blocked'
  | 'in_progress'
  | 'awaiting_gate'
  | 'completed'
  | 'stopped_dependency';

export type V4LifeDependencyKind = 'evidence' | 'receipt' | 'workitem';

export interface V4LifeDependency {
  kind: V4LifeDependencyKind;
  id: string;
}

export interface V4LifeWorkItem {
  workItemId: string;
  caseId: string;
  domain: V4LifeDomain;
  title: string;
  dependencies: V4LifeDependency[];
  status: V4LifeWorkItemStatus;
  assignedRole: V4LifeActorRole;
  gateId?: string;
  outputSummary?: string;
  submittedBy?: string;
  submittedAt?: string;
  completedAt?: string;
  /** P1 Risk Thread 关联键（仅来自 seed 声明，≤64 字符；无 key 的对象不进线程） */
  riskThreadKey?: string;
}

export interface V4LifeGate {
  gateId: string;
  caseId: string;
  domain: V4LifeDomain;
  title: string;
  requiredRole: V4LifeActorRole;
  workItemId: string;
  status: 'pending' | 'open' | 'decided';
  openedAt?: string;
}

export interface V4LifeDecision {
  outcome: 'approved' | 'rejected' | 'returned';
  actorId: string;
  reason: string;
  decidedAt: string;
}

export interface V4LifeReceipt {
  receiptId: string;
  gateId: string;
  decision: V4LifeDecision;
}

export interface V4LifeCandidate {
  candidateId: string;
  caseId: string;
  domain: V4LifeDomain;
  workItemId?: string;
  kind: 'contradiction' | 'missing_document';
  summary: string;
  basis: string[];
  authority: 'none';
  producedBy: 'deterministic-v1';
  createdAt: string;
  dedupeKey: string;
}

export interface V4LifeContribution {
  contributionId: string;
  actorId: string;
  domain: V4LifeDomain;
  workItemId: string;
  kind: 'evidence_review' | 'cross_check' | 'material_prep' | 'risk_finding';
  summary: string;
  recordedAt: string;
  retainedAfterVeto: true;
}

export interface V4LifeCaseMeta {
  caseId: string;
  displayName: string;
  disclaimer: string;
  financingAmountCny: number;
  purpose: string;
  upstreamNote: string;
}

// ---------------------------------------------------------------------------
// §2 事件（唯一权威记录，全量载荷；seq 从 1 单调递增，rev = 事件总数）
// ---------------------------------------------------------------------------

export type V4LifeEventPayload =
  | { type: 'CASE_INITIALIZED'; caseId: string }
  | { type: 'EVIDENCE_ACCEPTED'; evidence: V4LifeEvidence }
  | { type: 'WORK_ITEM_STARTED'; workItemId: string }
  | { type: 'WORK_ITEM_SUBMITTED'; workItemId: string; actorId: string; outputSummary: string }
  | { type: 'CONTRIBUTION_RECORDED'; contribution: V4LifeContribution }
  | { type: 'CANDIDATE_ISSUED'; candidate: V4LifeCandidate }
  | { type: 'GATE_OPENED'; gateId: string; workItemId: string }
  | { type: 'DECISION_RECORDED'; gateId: string; decision: V4LifeDecision; receipt: V4LifeReceipt | null }
  | { type: 'WORK_ITEM_COMPLETED'; workItemId: string; by: string }
  | { type: 'WORK_ITEM_STOPPED'; workItemId: string; reason: 'upstream_gate_rejected' }
  // ---- P1 语义扩展事件（CANDIDATE；与 refold/rebuildProjection 一一对应，重放等价） ----
  /** Human 核验命令结果：from 为变更前状态（旧数据缺省视为 'claimed'），to 为目标状态 */
  | {
      type: 'EVIDENCE_VERIFICATION_CHANGED';
      evidenceId: string;
      from: V4LifeVerificationStatus;
      to: V4LifeVerificationTarget;
      reason: string;
    }
  /** D077 收集窗口：开启新批次（major=上一 major+1、minor=0、OPEN；openedAt 取事件 at） */
  | { type: 'CONTEXT_BATCH_OPENED'; major: number }
  /** D077：OPEN→STABILIZING（CANDIDATE：仅 policy 角色） */
  | { type: 'CONTEXT_BATCH_STABILIZED'; major: number }
  /** D077：STABILIZING→SEALED（sealedAt 取事件 at） */
  | { type: 'CONTEXT_BATCH_SEALED'; major: number }
  /** D076 InputEvent：批复后外部变化，仅写入 OPEN 批次（minor 递增；不改正式状态） */
  | {
      type: 'INPUT_EVENT_APPENDED';
      major: number;
      minor: number;
      inputEventId: string;
      actorId: string;
      kind: V4LifeInputEventKind;
      summary: string;
      subjectRefs?: string[];
    };

export interface V4LifeEvent {
  seq: number;
  at: string;
  actor: string;
  payload: V4LifeEventPayload;
}

// ---------------------------------------------------------------------------
// §6 命令（幂等 key = commandId；乐观并发 = expectedRev）
// ---------------------------------------------------------------------------

export interface V4LifeCommand {
  commandId: string;
  expectedRev: number;
}

export interface V4LifeAppendEvidenceCommand extends V4LifeCommand {
  evidenceId: string;
  kind: V4LifeEvidenceKind;
  title: string;
  submittedBy: string;
  payload: V4LifeEvidencePayload;
  // ---- P1 §5 扩展（全部可选；verificationStatus 不接受客户端传入，append 恒置 'claimed'） ----
  sourceType?: V4LifeEvidenceSourceType;
  subjectRefs?: string[];
  observedAt?: string;
  effectiveAt?: string;
  expiresAt?: string;
  evidenceRef?: string;
  /** 仅 sourceType==='model_derived' 时允许（0..1），否则 INVALID_ENGINE_INPUT */
  confidence?: number;
  /** P1 Risk Thread 关联键（≤64 字符） */
  riskThreadKey?: string;
}

export interface V4LifeSubmitWorkCommand extends V4LifeCommand {
  workItemId: string;
  actorId: string;
  outputSummary: string;
}

export interface V4LifeRecordDecisionCommand extends V4LifeCommand {
  gateId: string;
  actorId: string;
  outcome: V4LifeDecision['outcome'];
  reason: string;
}

// ---- P1 语义扩展命令（CANDIDATE；幂等/expectedRev/命令日志语义与既有命令完全一致） ----

/** Human 核验命令：目标仅 'unverified'|'verified'|'contradicted'|'stale'（'claimed' 禁止） */
export interface V4LifeChangeVerificationCommand extends V4LifeCommand {
  evidenceId: string;
  actorId: string;
  verificationStatus: V4LifeVerificationTarget;
  reason: string;
}

/**
 * D077 收集窗口命令共享结果：batch 为命令完成后的目标批次视图。
 * batchId 约定：批次 major 的十进制字符串（如 '1'），与 Projection context.batches[].major 一一对应。
 */
export interface V4LifeContextBatchResult {
  status: V4LifeCommandStatus;
  rev: number;
  batch: V4LifeContextBatch;
}

export interface V4LifeOpenContextBatchCommand extends V4LifeCommand {
  actorId: string;
  reason: string;
}

export interface V4LifeAppendInputEventCommand extends V4LifeCommand {
  batchId: string;
  actorId: string;
  inputEventId: string;
  kind: V4LifeInputEventKind;
  summary: string;
  subjectRefs?: string[];
}

export interface V4LifeStabilizeContextBatchCommand extends V4LifeCommand {
  batchId: string;
  actorId: string;
  reason: string;
}

export interface V4LifeSealContextBatchCommand extends V4LifeCommand {
  batchId: string;
  actorId: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// §7 引擎公共 API 与结果类型（frozen，不得改名/改签名）
// ---------------------------------------------------------------------------

export type V4LifeCommandStatus = 'accepted' | 'replayed';

export interface V4LifeAppendEvidenceResult {
  status: V4LifeCommandStatus;
  rev: number;
  evidence: V4LifeEvidence;
  startedWorkItemIds: string[];
}

export interface V4LifeSubmitWorkResult {
  status: V4LifeCommandStatus;
  rev: number;
  workItem: V4LifeWorkItem;
  gate?: V4LifeGate;
}

export interface V4LifeRecordDecisionResult {
  status: V4LifeCommandStatus;
  rev: number;
  /** returned 时为 null（不发 Receipt） */
  receipt: V4LifeReceipt | null;
  stoppedWorkItemIds: string[];
  completedWorkItemIds: string[];
}

/** P1 Human 核验命令结果：evidence 为核验变更后的完整 Evidence */
export interface V4LifeChangeVerificationResult {
  status: V4LifeCommandStatus;
  rev: number;
  evidence: V4LifeEvidence;
}

// ---------------------------------------------------------------------------
// §15 Durable command journal（跨重启的 commandId 幂等；port 定义，文件适配器见 command-journal.ts）
// ---------------------------------------------------------------------------

/**
 * journal 记录：一条 accepted 命令的幂等键与原始接受结果。
 * 字段与 engine 内部 commandRecords 值结构（commandKey + 完整 result）对齐：
 * §6 步骤 3 的 replay 是“原始 accepted 结果换 status 后整体返回”，仅记 seq/rev 无法复现。
 */
export interface V4LifeCommandJournalRecord {
  caseId: string;
  commandId: string;
  /** 命令去除 commandId/expectedRev 后的规范化载荷键（engine canonicalize，§6 步骤 3） */
  commandKey: string;
  /** 原始 accepted 结果；replay 时按 command 种类换 status='replayed' 后整体返回 */
  result:
    | V4LifeAppendEvidenceResult
    | V4LifeSubmitWorkResult
    | V4LifeRecordDecisionResult
    | V4LifeChangeVerificationResult
    | V4LifeContextBatchResult;
  /** journal 记录时间（引擎注入时钟） */
  at: string;
  /**
   * 命令种类（决定 replay 时换装哪种结果类型）。
   * P1：'verification'（Human 核验命令）＋ 'context_batch'（open/appendInputEvent/stabilize/seal
   * 收集窗口命令族，P1-BE-01 起同样入 journal —— 此前仅进程内缓存，重启后丢失幂等）。
   */
  command: 'evidence' | 'work' | 'decision' | 'verification' | 'context_batch';}

export interface V4LifeCommandJournal {
  /**
   * accepted 命令在事件 commit 成功后同步调用。实现必须尽量可靠：抛错将使命令整体失败关闭，
   * 而此时事件已入账本、无法原子回滚（非原子性见 engine.ts recordAcceptedCommand 注记）。
   */
  append(caseId: string, record: V4LifeCommandJournalRecord): void;
  /** 构造恢复用：按 append 顺序返回（同 commandId 多条时引擎以最后一条为准）；深克隆 */
  loadAll(caseId: string): V4LifeCommandJournalRecord[];
}

export interface V4LifeEngineOptions {
  /** §9 存储 port；注入则每次追加先过 log（append(caseId, 追加前 rev, newEvents)） */
  eventLog?: V4LifeEventLog;
  /** §15 durable command journal port；注入则 accepted 命令落 journal，重启后 commandId 幂等恢复 */
  commandJournal?: V4LifeCommandJournal;
  /** 测试时钟；所有事件/凭证时间戳必须来自它 */
  now?: () => string;
  /** P1 Candidate 语义开关（默认 'off' = 正式权威路径；'demo' = 显式合成演示 Candidate，见类型注记） */
  p1CandidateSemantics?: V4LifeP1CandidateSemantics;
}

export interface V4LifeEngine {
  caseId: string;
  rev: number;
  appendEvidence(command: V4LifeAppendEvidenceCommand): V4LifeAppendEvidenceResult;
  submitWork(command: V4LifeSubmitWorkCommand): V4LifeSubmitWorkResult;
  recordDecision(command: V4LifeRecordDecisionCommand): V4LifeRecordDecisionResult;
  /** P1：Human 核验命令（CANDIDATE：业务不得自核验，待 §11.3 确认） */
  changeVerification(command: V4LifeChangeVerificationCommand): V4LifeChangeVerificationResult;
  /** P1/D077：收集窗口命令族（角色/状态机 CANDIDATE，待 §11.3 确认） */
  openContextBatch(command: V4LifeOpenContextBatchCommand): V4LifeContextBatchResult;
  appendInputEvent(command: V4LifeAppendInputEventCommand): V4LifeContextBatchResult;
  stabilizeContextBatch(command: V4LifeStabilizeContextBatchCommand): V4LifeContextBatchResult;
  sealContextBatch(command: V4LifeSealContextBatchCommand): V4LifeContextBatchResult;
  getProjection(): V4LifeProjection;
  getEvents(afterSeq: number, limit?: number): { events: V4LifeEvent[]; nextSeq: number; hasMore: boolean };
}

// ---------------------------------------------------------------------------
// §8 Projection（全部数组为深克隆新引用；domains 固定 policy/credit/commerce/asset）
// ---------------------------------------------------------------------------

/** D077 收集窗口批次视图（batchId 即 major 的十进制字符串） */
export interface V4LifeContextBatch {
  major: number;
  minor: number;
  status: V4LifeContextBatchStatus;
  /** 开启时间；种子隐含批次（major=1，对应既有演示材料的隐含封存）取 CASE_INITIALIZED 事件 at */
  openedAt?: string;
  /** 封存时间；种子隐含批次同取 CASE_INITIALIZED 事件 at */
  sealedAt?: string;
}

/** D076/D077 共享 Context 收集窗口投影：major/minor/status 恒等于最新（major 最大）批次；
 *  strict 默认路径（p1CandidateSemantics='off'）未开启任何批次时为 { major:0, minor:0, status:'NONE', batches:[] }。 */
export interface V4LifeContextWindow {
  major: number;
  minor: number;
  status: V4LifeContextWindowStatus;
  /** 全部批次，最新批次在前（major 降序） */
  batches: V4LifeContextBatch[];
}

/** P1 §8 Risk Thread 投影（按 riskThreadKey 折叠；无 key 的对象不进线程；lastSeq 取关联对象最大事件序） */
export interface V4LifeRiskThread {
  riskThreadKey: string;
  evidenceIds: string[];
  workItemIds: string[];
  /** 关联工作项声明的 gateId（去重，按 seed 声明序） */
  gateIds: string[];
  lastSeq: number;
}

export interface V4LifeProjection {
  case: V4LifeCaseMeta;
  /** §14.1：只读 actor 名册（深克隆，顺序同 seed）；页面角色 ID/姓名一律由此派生 */
  actors: V4LifeActor[];
  rev: number;
  domains: Array<{
    domain: V4LifeDomain;
    workItems: V4LifeWorkItem[];
    gates: V4LifeGate[];
    candidates: V4LifeCandidate[];
  }>;
  openGates: V4LifeGate[];
  receipts: V4LifeReceipt[];
  contributions: V4LifeContribution[];
  evidence: V4LifeEvidence[];
  evidenceCount: number;
  eventCount: number;
  /** P1/D076-D077：收集窗口投影（p1CandidateSemantics='demo' 种子隐含批次 major=1 SEALED；默认 'off' 为 'NONE' 空窗口） */
  context: V4LifeContextWindow;
  /** P1 §8：跨域 Risk Thread 投影（按 riskThreadKey 折叠，key 首次出现序） */
  riskThreads: V4LifeRiskThread[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// 种子输入（§7：字段维持现状，同 §11 fixture 骨架）
// ---------------------------------------------------------------------------

export interface V4LifeSeedWorkItem {
  workItemId: string;
  domain: V4LifeDomain;
  title: string;
  dependencies: V4LifeDependency[];
  assignedRole: V4LifeActorRole;
  gateId?: string;
  /** P1 Risk Thread 关联键（≤64 字符；可选，缺省不进线程） */
  riskThreadKey?: string;
}

export interface V4LifeSeedGate {
  gateId: string;
  domain: V4LifeDomain;
  title: string;
  requiredRole: V4LifeActorRole;
  workItemId: string;
}

export interface V4LifeSeedInitialEvidence {
  evidenceId: string;
  kind: V4LifeEvidenceKind;
  title: string;
  submittedBy: string;
  payload: V4LifeEvidencePayload;
}

export interface V4LifeSeedInput {
  case: V4LifeCaseMeta;
  actors: readonly V4LifeActor[];
  workItems: ReadonlyArray<V4LifeSeedWorkItem>;
  gates: ReadonlyArray<V4LifeSeedGate>;
  initialEvidence?: ReadonlyArray<V4LifeSeedInitialEvidence>;
}

// ---------------------------------------------------------------------------
// §12 错误码总表（V4LifeError 类实现位于 engine.ts，供 event-log/replay/http 复用）
// ---------------------------------------------------------------------------

export type V4LifeErrorCode =
  | 'INVALID_ENGINE_INPUT'
  | 'ACTOR_NOT_FOUND'
  | 'EVIDENCE_INVALID'
  | 'CASE_NOT_FOUND'
  | 'WORK_ITEM_NOT_FOUND'
  | 'GATE_NOT_FOUND'
  | 'ROLE_MISMATCH'
  | 'EVIDENCE_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'VERSION_CONFLICT'
  | 'WORK_ITEM_NOT_ACTIVE'
  | 'GATE_NOT_OPEN'
  | 'GATE_ALREADY_DECIDED'
  | 'SEQ_CONFLICT'
  | 'REQUEST_BODY_TOO_LARGE'
  | 'REQUEST_BODY_TIMEOUT'
  | 'INVALID_JSON'
  | 'INTERNAL_ERROR'
  // ---- P1 语义扩展错误码（§12 错误码总表追加；HTTP 映射见 http.ts） ----
  /** 核验命令引用不存在的 Evidence（映射 404） */
  | 'EVIDENCE_NOT_FOUND'
  /** D077：目标批次不处于 OPEN，拒绝写入 InputEvent（映射 409） */
  | 'CONTEXT_WINDOW_NOT_OPEN'
  /** D077：batchId 不存在（映射 404） */
  | 'CONTEXT_BATCH_NOT_FOUND'
  /** D077：批次状态迁移非法（仅 OPEN→STABILIZING→SEALED，映射 409） */
  | 'CONTEXT_BATCH_INVALID_TRANSITION';
