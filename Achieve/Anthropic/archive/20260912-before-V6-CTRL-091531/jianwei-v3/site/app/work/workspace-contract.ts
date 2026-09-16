// /work 共享契约（主 Agent 冻结，2026-09-04）
// 五角色 responsive 工作台的组件 props、selector 与命令纪律契约。
// 权威边界：canonical state 只来自服务端 Projection；组件不得自备第二状态；
// Agent/模型 authority=none；Human Gate 只能由匹配 requiredRole 的具名 Actor 决定。
// 约束：不引入新依赖；中文为主；错误保留 exact code。

import type {
  V4LifeActor,
  V4LifeCandidate,
  V4LifeContribution,
  V4LifeDecision,
  V4LifeDomain,
  V4LifeEvidence,
  V4LifeEvent,
  V4LifeGate,
  V4LifeProjection,
  V4LifeReceipt,
  V4LifeWorkItem,
} from '../../lib/v4life/types.ts';

export type {
  V4LifeActor,
  V4LifeCandidate,
  V4LifeContribution,
  V4LifeDecision,
  V4LifeDomain,
  V4LifeEvidence,
  V4LifeEvent,
  V4LifeGate,
  V4LifeProjection,
  V4LifeReceipt,
  V4LifeWorkItem,
};

/** 五个 demo 角色入口（顺序固定：业务在首，四域随后）。 */
export const WORK_ACTOR_ORDER = [
  'actor-business-chen',
  'actor-policy-li',
  'actor-credit-zhang',
  'actor-commerce-wang',
  'actor-asset-zhou',
] as const;

export type WorkActorId = (typeof WORK_ACTOR_ORDER)[number];

export const DOMAIN_LABELS: Record<V4LifeDomain, string> = {
  policy: '政策',
  credit: '信审',
  commerce: '商务',
  asset: '资产',
};

export type WorkItemStatus = V4LifeWorkItem['status'];
export type ConnectionState = 'loading' | 'synced' | 'stale' | 'error';

/** 命令反馈：一切成功/失败以服务端响应为准，禁止 optimistic authority。 */
export interface CommandFeedback {
  kind: 'evidence' | 'work' | 'decision' | 'reset';
  status: 'accepted' | 'replayed' | 'error';
  errorCode?: string;
  message: string;
  receipt?: V4LifeReceipt;
  stoppedWorkItemIds?: readonly string[];
}

/** 业务端补件请求：由 Candidate 与 blocked 原因派生，不硬编码。 */
export interface SupplementRequest {
  evidenceKind: 'financial_statement' | 'contract_draft' | 'asset_history_feedback' | 'supplement';
  title: string;
  reason: string;
  source: 'candidate' | 'dependency';
  basis: readonly string[];
}

/** 域看板视图（四域 network 与 workbench 共用）。 */
export interface DomainView {
  domain: V4LifeDomain;
  label: string;
  actor?: V4LifeActor;
  items: V4LifeWorkItem[];
  gates: V4LifeGate[];
  candidates: V4LifeCandidate[];
  openGate?: V4LifeGate;
  nextItemId?: string;
  waitingReason: string;
}

/** 事件账本分页结果。 */
export interface EventPage {
  events: V4LifeEvent[];
  nextSeq: number;
  hasMore: boolean;
}

/** 命令载荷（提交前由 UI 组装，commandId/expectedRev 由 client 注入）。 */
export interface EvidenceDraft {
  evidenceId: string;
  kind: V4LifeEvidence['kind'];
  title: string;
  payload: { summary: string; tags: string[]; amountCny?: number };
}

/** 组件统一的动作入口（由 useWorkspaceActions 提供）。 */
export interface WorkspaceActions {
  submitEvidence(draft: EvidenceDraft): Promise<CommandFeedback>;
  submitWork(workItemId: string, outputSummary: string): Promise<CommandFeedback>;
  decide(gateId: string, outcome: V4LifeDecision['outcome'], reason: string): Promise<CommandFeedback>;
  refresh(): Promise<void>;
  resetDemo(): Promise<CommandFeedback>;
  /** 正在进行的命令 key（如 `evidence:ev-1`），用于禁用重复提交。 */
  pendingKeys: ReadonlySet<string>;
}

export interface WorkspaceActionsProps {
  projection: V4LifeProjection;
  actorId: WorkActorId;
  actions: WorkspaceActions;
  connection: ConnectionState;
  feedback: CommandFeedback | null;
}

/** 纯 selector 契约（W1 实现；全部为纯函数，可独立测试）。 */
export interface WorkspaceSelectors {
  selectCaseMeta(projection: V4LifeProjection): V4LifeProjection['case'] & { eventCount: number; evidenceCount: number; rev: number };
  selectActor(projection: V4LifeProjection, actorId: string): V4LifeActor | undefined;
  selectDomainViews(projection: V4LifeProjection): DomainView[];
  selectWorkItem(projection: V4LifeProjection, workItemId: string): V4LifeWorkItem | undefined;
  selectGate(projection: V4LifeProjection, gateId: string): V4LifeGate | undefined;
  selectSupplementRequests(projection: V4LifeProjection): SupplementRequest[];
  selectEvidenceList(projection: V4LifeProjection): V4LifeEvidence[];
  selectReceipts(projection: V4LifeProjection): V4LifeReceipt[];
  selectContributions(projection: V4LifeProjection): V4LifeContribution[];
  selectCandidates(projection: V4LifeProjection): V4LifeCandidate[];
  /** blocked / awaiting_gate / completed / stopped_dependency 项的真实等待或不可操作原因（中文）。 */
  waitingReasonOf(projection: V4LifeProjection, item: V4LifeWorkItem): string;
  /** 动作可用性：仅由 Projection + selected actor 派生。 */
  canSubmitWork(projection: V4LifeProjection, actorId: string, item: V4LifeWorkItem): { allowed: boolean; reason: string };
  canDecide(projection: V4LifeProjection, actorId: string, gate: V4LifeGate): { allowed: boolean; reason: string };
}

/** 错误对象：HTTP/引擎错误统一映射，保留 exact code。 */
export class WorkspaceError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message?: string) {
    super(message ?? code);
    this.code = code;
    this.status = status;
  }
}
