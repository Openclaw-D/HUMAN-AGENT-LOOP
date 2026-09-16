'use client';

// /work 模型层（Lane W1）——共享契约 app/work/workspace-contract.ts 的唯一实现。
// 三部分：
//   1) 纯 selectors：全部从 canonical Projection 派生（§14.1），不自备第二状态、不虚构业务需求；
//   2) 命令 client：createWorkspaceClient（§14.4 命令纪律：每次动作生成 commandId、expectedRev、
//      传输失败 retryLast 复用同 commandId 同载荷，VERSION_CONFLICT 不自动重试）；
//   3) React hooks：useCaseProjection（首载 GET + 2.5s 轻量轮询、hidden 暂停、卸载 abort）与
//      useWorkspaceActions（pendingKeys 禁重复提交、feedback 以服务端响应为准，禁止 optimistic authority）。
// 权威边界：Agent/模型 authority=none；Human Gate 只能由匹配 requiredRole 的具名 Actor 决定；
// 错误保留 exact code；全部用户文案为中文。

import * as React from 'react';
import type {
  V4LifeActor,
  V4LifeActorRole,
  V4LifeAppendEvidenceResult,
  V4LifeCandidate,
  V4LifeContribution,
  V4LifeDecision,
  V4LifeDomain,
  V4LifeEvidence,
  V4LifeGate,
  V4LifeProjection,
  V4LifeReceipt,
  V4LifeRecordDecisionResult,
  V4LifeSubmitWorkResult,
  V4LifeWorkItem,
} from '../../lib/v4life/types.ts';
import {
  DOMAIN_LABELS,
  WorkspaceError,
  type CommandFeedback,
  type ConnectionState,
  type DomainView,
  type EventPage,
  type EvidenceDraft,
  type SupplementRequest,
  type WorkspaceActions,
  type WorkspaceSelectors,
} from './workspace-contract.ts';

export { WorkspaceError };
export type { CommandFeedback, ConnectionState, DomainView, EventPage, EvidenceDraft, SupplementRequest, WorkspaceActions, WorkspaceSelectors };

/** 四域固定序（§8：policy/credit/commerce/asset；业务角色不进入域看板）。 */
export const DOMAIN_ORDER: readonly V4LifeDomain[] = ['policy', 'credit', 'commerce', 'asset'];

const POLL_INTERVAL_MS = 2_500;

/** 角色中文名（§14.1：页面角色文案由 Projection.actors 派生，这里只做 role → 标签映射）。 */
const ROLE_LABELS: Record<V4LifeActorRole, string> = {
  business: '业务',
  policy: '政策',
  credit: '信审',
  commerce: '商务',
  asset: '资产',
  system: '系统',
};

function roleLabel(role: V4LifeActorRole): string {
  return ROLE_LABELS[role] ?? role;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// 纯 selectors（契约 WorkspaceSelectors 全部方法）
// ---------------------------------------------------------------------------

export function selectCaseMeta(
  projection: V4LifeProjection,
): V4LifeProjection['case'] & { eventCount: number; evidenceCount: number; rev: number } {
  return {
    ...projection.case,
    eventCount: projection.eventCount,
    evidenceCount: projection.evidenceCount,
    rev: projection.rev,
  };
}

export function selectActor(projection: V4LifeProjection, actorId: string): V4LifeActor | undefined {
  return projection.actors.find((actor) => actor.actorId === actorId);
}

export function selectWorkItem(projection: V4LifeProjection, workItemId: string): V4LifeWorkItem | undefined {
  for (const bucket of projection.domains) {
    const item = bucket.workItems.find((entry) => entry.workItemId === workItemId);
    if (item !== undefined) {
      return item;
    }
  }
  return undefined;
}

export function selectGate(projection: V4LifeProjection, gateId: string): V4LifeGate | undefined {
  for (const bucket of projection.domains) {
    const gate = bucket.gates.find((entry) => entry.gateId === gateId);
    if (gate !== undefined) {
      return gate;
    }
  }
  return undefined;
}

export function selectEvidenceList(projection: V4LifeProjection): V4LifeEvidence[] {
  return [...projection.evidence];
}

export function selectReceipts(projection: V4LifeProjection): V4LifeReceipt[] {
  return [...projection.receipts];
}

export function selectContributions(projection: V4LifeProjection): V4LifeContribution[] {
  return [...projection.contributions];
}

export function selectCandidates(projection: V4LifeProjection): V4LifeCandidate[] {
  return projection.domains.flatMap((bucket) => [...bucket.candidates]);
}

/** 已获批 凭证的 Gate 集合（receipt 依赖是否满足以此为准；returned/rejected 不算）。 */
function approvedReceiptGateIds(projection: V4LifeProjection): Set<string> {
  const ids = new Set<string>();
  for (const receipt of projection.receipts) {
    if (receipt.decision.outcome === 'approved') {
      ids.add(receipt.gateId);
    }
  }
  return ids;
}

/** blocked 项的真实等待原因：逐条列出缺失的 evidence / 未完成 workitem / 未获批 receipt。 */
function blockedWaitingReason(projection: V4LifeProjection, item: V4LifeWorkItem): string {
  const evidenceIds = new Set(projection.evidence.map((entry) => entry.evidenceId));
  const approvedReceipts = approvedReceiptGateIds(projection);
  const rejectedReceiptGateIds = new Set(
    projection.receipts.filter((receipt) => receipt.decision.outcome === 'rejected').map((receipt) => receipt.gateId),
  );
  const parts: string[] = [];
  for (const dep of item.dependencies) {
    if (dep.kind === 'evidence') {
      if (!evidenceIds.has(dep.id)) {
        parts.push(`缺少证据 ${dep.id}`);
      }
    } else if (dep.kind === 'workitem') {
      if (selectWorkItem(projection, dep.id)?.status !== 'completed') {
        parts.push(`等待工作项 ${dep.id} 完成`);
      }
    } else if (!approvedReceipts.has(dep.id)) {
      parts.push(
        rejectedReceiptGateIds.has(dep.id)
          ? `Gate ${dep.id} 已被否决`
          : `等待 Gate ${dep.id} 的批准凭证`,
      );
    }
  }
  if (parts.length === 0) {
    return '尚未开始：前置条件核验中。';
  }
  return `尚未开始：${parts.join('；')}。`;
}

/** 分档等待/不可操作原因（中文；全部事实来自 Projection，不虚构）。 */
export function waitingReasonOf(projection: V4LifeProjection, item: V4LifeWorkItem): string {
  switch (item.status) {
    case 'in_progress':
      return '进行中，可提交工作成果。';
    case 'completed':
      return '已完成。';
    case 'awaiting_gate': {
      const gate = item.gateId !== undefined ? selectGate(projection, item.gateId) : undefined;
      if (gate === undefined) {
        return `等待 Gate ${item.gateId ?? ''} 开启具名决定。`;
      }
      return `等待「${gate.title}」（${gate.gateId}）由${roleLabel(gate.requiredRole)}角色具名决定。`;
    }
    case 'stopped_dependency': {
      const rejected = projection.receipts.find(
        (receipt) =>
          receipt.decision.outcome === 'rejected' &&
          item.dependencies.some((dep) => dep.kind === 'receipt' && dep.id === receipt.gateId),
      );
      if (rejected !== undefined) {
        return `因上游 Gate ${rejected.gateId} 被否决而停止；已形成的贡献保留。`;
      }
      return '因上游依赖被否决而停止；已形成的贡献保留。';
    }
    case 'blocked':
      return blockedWaitingReason(projection, item);
    default:
      return '当前状态未知。';
  }
}

/** 动作可用性：仅由 Projection + selected actor 派生（§4 角色权限 + §3 状态机）。 */
export function canSubmitWork(
  projection: V4LifeProjection,
  actorId: string,
  item: V4LifeWorkItem,
): { allowed: boolean; reason: string } {
  const actor = selectActor(projection, actorId);
  if (actor === undefined) {
    return { allowed: false, reason: '未知名角色，无法执行操作。' };
  }
  if (item.status !== 'in_progress') {
    return { allowed: false, reason: waitingReasonOf(projection, item) };
  }
  if (actor.role !== item.assignedRole) {
    return { allowed: false, reason: `该工作项由${roleLabel(item.assignedRole)}角色负责，当前角色无权提交。` };
  }
  return { allowed: true, reason: '可以提交工作成果。' };
}

export function canDecide(
  projection: V4LifeProjection,
  actorId: string,
  gate: V4LifeGate,
): { allowed: boolean; reason: string } {
  const actor = selectActor(projection, actorId);
  if (actor === undefined) {
    return { allowed: false, reason: '未知名角色，无法执行操作。' };
  }
  if (gate.status === 'pending') {
    return { allowed: false, reason: `Gate「${gate.title}」尚未开启，需先完成前置工作。` };
  }
  if (gate.status === 'decided') {
    return { allowed: false, reason: `Gate「${gate.title}」本轮已决定，不能重复决定。` };
  }
  if (actor.role !== gate.requiredRole) {
    return {
      allowed: false,
      reason: `该 Gate 需${roleLabel(gate.requiredRole)}角色具名决定，当前角色无权决定。`,
    };
  }
  return { allowed: true, reason: '可以对该 Gate 作出决定。' };
}

/** 域内等待原因汇总文案：按状态计数，事实来自 Projection。 */
function domainWaitingReason(items: readonly V4LifeWorkItem[]): string {
  if (items.length === 0) {
    return '本域暂无工作项。';
  }
  const parts: string[] = [];
  const inProgress = items.filter((item) => item.status === 'in_progress').length;
  const awaitingGate = items.filter((item) => item.status === 'awaiting_gate').length;
  const blocked = items.filter((item) => item.status === 'blocked').length;
  const stopped = items.filter((item) => item.status === 'stopped_dependency').length;
  const completed = items.filter((item) => item.status === 'completed').length;
  if (inProgress > 0) {
    parts.push(`进行中 ${inProgress} 项`);
  }
  if (awaitingGate > 0) {
    parts.push(`等待 Gate 决定 ${awaitingGate} 项`);
  }
  if (blocked > 0) {
    parts.push(`前置受阻 ${blocked} 项`);
  }
  if (stopped > 0) {
    parts.push(`因否决停止 ${stopped} 项`);
  }
  if (completed > 0) {
    parts.push(`已完成 ${completed} 项`);
  }
  return `${parts.join('；')}。`;
}

/** 四域看板视图：固定序、actor 映射、openGate、nextItemId（该域第一个可操作 in_progress 项）。 */
export function selectDomainViews(projection: V4LifeProjection): DomainView[] {
  return DOMAIN_ORDER.map((domain) => {
    const bucket = projection.domains.find((entry) => entry.domain === domain) ?? {
      domain,
      workItems: [],
      gates: [],
      candidates: [],
    };
    const actor = projection.actors.find((entry) => entry.role === domain);
    const openGate = bucket.gates.find((gate) => gate.status === 'open');
    let nextItemId: string | undefined;
    for (const item of bucket.workItems) {
      if (item.status !== 'in_progress') {
        continue;
      }
      if (actor === undefined || canSubmitWork(projection, actor.actorId, item).allowed) {
        nextItemId = item.workItemId;
        break;
      }
    }
    return {
      domain,
      label: DOMAIN_LABELS[domain],
      actor,
      items: bucket.workItems,
      gates: bucket.gates,
      candidates: bucket.candidates,
      openGate,
      nextItemId,
      waitingReason: domainWaitingReason(bucket.workItems),
    };
  });
}

const SUPPLEMENT_EVIDENCE_KINDS: SupplementRequest['evidenceKind'][] = [
  'financial_statement',
  'contract_draft',
  'asset_history_feedback',
  'supplement',
];

/** 缺失证据依赖 id → 请求的 Evidence kind（按 id 语义线索映射，未知一律 supplement）。 */
function dependencyEvidenceKind(dependencyId: string): SupplementRequest['evidenceKind'] {
  const lower = dependencyId.toLowerCase();
  const matched = SUPPLEMENT_EVIDENCE_KINDS.find((kind) => {
    if (kind === 'financial_statement') {
      return lower.includes('financial');
    }
    if (kind === 'contract_draft') {
      return lower.includes('contract');
    }
    if (kind === 'asset_history_feedback') {
      return lower.includes('asset') && (lower.includes('history') || lower.includes('feedback'));
    }
    return false;
  });
  return matched ?? 'supplement';
}

/**
 * 业务端补件请求：只由 Candidate(missing_document) 与 blocked 项缺失的 evidence 依赖派生，
 * reason/basis 取自真实状态，不虚构需求。固定序：先按域序的 blocked 缺证，再按域序的缺件 Candidate。
 */
export function selectSupplementRequests(projection: V4LifeProjection): SupplementRequest[] {
  const requests: SupplementRequest[] = [];
  const seen = new Set<string>();
  for (const bucket of projection.domains) {
    for (const item of bucket.workItems) {
      if (item.status !== 'blocked') {
        continue;
      }
      for (const dep of item.dependencies) {
        if (dep.kind !== 'evidence') {
          continue;
        }
        if (projection.evidence.some((entry) => entry.evidenceId === dep.id)) {
          continue;
        }
        const key = `dependency|${dep.id}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        requests.push({
          evidenceKind: dependencyEvidenceKind(dep.id),
          title: `${item.title}（${item.workItemId}）待补材料`,
          reason: `工作项 ${item.workItemId} 尚未开始：缺少证据 ${dep.id}，补充受理后才能进入该环节。`,
          source: 'dependency',
          basis: [item.workItemId, dep.id],
        });
      }
    }
  }
  for (const bucket of projection.domains) {
    for (const candidate of bucket.candidates) {
      if (candidate.kind !== 'missing_document') {
        continue;
      }
      const key = `candidate|${candidate.candidateId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      requests.push({
        evidenceKind: 'supplement',
        title: candidate.workItemId !== undefined ? `补件请求（${candidate.workItemId}）` : '补件请求',
        reason: candidate.summary,
        source: 'candidate',
        basis: [...candidate.basis],
      });
    }
  }
  return requests;
}

/** 契约 WorkspaceSelectors 汇总对象（全部为纯函数）。 */
export const workspaceSelectors: WorkspaceSelectors = {
  selectCaseMeta,
  selectActor,
  selectDomainViews,
  selectWorkItem,
  selectGate,
  selectSupplementRequests,
  selectEvidenceList,
  selectReceipts,
  selectContributions,
  selectCandidates,
  waitingReasonOf,
  canSubmitWork,
  canDecide,
};

// ---------------------------------------------------------------------------
// 命令 client（§14.4 命令纪律）
// ---------------------------------------------------------------------------

export interface WorkspaceClientOptions {
  /** 缺省用 global fetch（进程内测试注入桩）。 */
  fetchImpl?: typeof fetch;
  /** 预留测试时钟；命令协议本身不携带时间戳。 */
  now?: () => string;
  /** 命令执行角色（submittedBy/actorId）；未配置时三类业务命令在客户端失败关闭。 */
  actorId?: string;
}

interface PendingCommandRecord {
  kind: CommandFeedback['kind'];
  url: string;
  body: Record<string, unknown>;
}

export interface WorkspaceClient {
  readonly caseId: string;
  readonly actorId: string | undefined;
  fetchProjection(signal?: AbortSignal): Promise<V4LifeProjection>;
  fetchEvents(afterSeq: number, limit?: number, signal?: AbortSignal): Promise<EventPage>;
  submitEvidence(draft: EvidenceDraft, rev: number): Promise<V4LifeAppendEvidenceResult>;
  submitWork(workItemId: string, outputSummary: string, rev: number): Promise<V4LifeSubmitWorkResult>;
  decide(
    gateId: string,
    outcome: V4LifeDecision['outcome'],
    reason: string,
    rev: number,
  ): Promise<V4LifeRecordDecisionResult>;
  resetDemo(): Promise<{ status: string; projection: V4LifeProjection }>;
  /** 是否存在传输失败、结果未知的未完成命令可重试。 */
  readonly hasPendingRetry: boolean;
  /** 未完成命令的种类（无则 null）。 */
  readonly pendingRetryKind: CommandFeedback['kind'] | null;
  /** 复用同 commandId 同 payload 重发上一个未完成命令（VERSION_CONFLICT 等确定性失败不进入此通道）。 */
  retryLast(): Promise<unknown>;
}

export function createWorkspaceClient(caseId: string, options: WorkspaceClientOptions = {}): WorkspaceClient {
  const fetchImpl: typeof fetch = options.fetchImpl ?? fetch.bind(globalThis);
  const caseBase = `/api/v4life/cases/${encodeURIComponent(caseId)}`;
  let lastPending: PendingCommandRecord | null = null;

  function requireActorId(): string {
    if (typeof options.actorId !== 'string' || options.actorId.length === 0) {
      throw new WorkspaceError('ACTOR_NOT_FOUND', 0, '客户端未配置执行角色（actorId），拒绝提交命令。');
    }
    return options.actorId;
  }

  /** 非 2xx 解析 { error } 抛 WorkspaceError(code, status)；2xx 但非 JSON 视为 INTERNAL_ERROR。 */
  async function parseEnvelope(response: Response): Promise<unknown> {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const code =
        isRecord(payload) && typeof payload.error === 'string' ? payload.error : 'INTERNAL_ERROR';
      throw new WorkspaceError(code, response.status);
    }
    if (payload === null) {
      throw new WorkspaceError('INTERNAL_ERROR', response.status, '服务响应不是合法 JSON。');
    }
    return payload;
  }

  async function guarded(run: () => Promise<Response>): Promise<unknown> {
    let response: Response;
    try {
      response = await run();
    } catch (cause) {
      if (cause instanceof WorkspaceError) {
        throw cause;
      }
      throw new WorkspaceError('NETWORK_ERROR', 0, '网络异常，命令结果未知。');
    }
    return parseEnvelope(response);
  }

  /** 发送命令并登记未完成记录：传输失败（NETWORK_ERROR）保留以便 retryLast；收到确定性响应即清除。 */
  async function sendCommand(
    url: string,
    body: Record<string, unknown>,
    kind: CommandFeedback['kind'],
    record: boolean,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (record) {
      lastPending = { kind, url, body: { ...body } };
    }
    try {
      const payload = await guarded(() =>
        fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          ...(signal !== undefined ? { signal } : {}),
        }),
      );
      if (record) {
        lastPending = null;
      }
      return payload;
    } catch (cause) {
      if (!(cause instanceof WorkspaceError)) {
        throw new WorkspaceError('INTERNAL_ERROR', 0);
      }
      if (cause.code !== 'NETWORK_ERROR' && record) {
        lastPending = null;
      }
      throw cause;
    }
  }

  return {
    caseId,
    get actorId(): string | undefined {
      return options.actorId;
    },
    async fetchProjection(signal?: AbortSignal): Promise<V4LifeProjection> {
      const payload = await guarded(() =>
        fetchImpl(caseBase, {
          method: 'GET',
          headers: { accept: 'application/json' },
          ...(signal !== undefined ? { signal } : {}),
        }),
      );
      return payload as V4LifeProjection;
    },
    async fetchEvents(afterSeq: number, limit?: number, signal?: AbortSignal): Promise<EventPage> {
      const search = new URLSearchParams({ afterSeq: String(afterSeq) });
      if (limit !== undefined) {
        search.set('limit', String(limit));
      }
      const payload = await guarded(() =>
        fetchImpl(`${caseBase}/events?${search.toString()}`, {
          method: 'GET',
          headers: { accept: 'application/json' },
          ...(signal !== undefined ? { signal } : {}),
        }),
      );
      return payload as EventPage;
    },
    async submitEvidence(draft: EvidenceDraft, rev: number): Promise<V4LifeAppendEvidenceResult> {
      const submittedBy = requireActorId();
      const payload: Record<string, unknown> = {
        summary: draft.payload.summary,
        tags: [...draft.payload.tags],
      };
      if (draft.payload.amountCny !== undefined) {
        payload.amountCny = draft.payload.amountCny;
      }
      const body: Record<string, unknown> = {
        commandId: crypto.randomUUID(),
        expectedRev: rev,
        evidenceId: draft.evidenceId,
        kind: draft.kind,
        title: draft.title,
        submittedBy,
        payload,
      };
      return (await sendCommand(`${caseBase}/evidence`, body, 'evidence', true)) as V4LifeAppendEvidenceResult;
    },
    async submitWork(workItemId: string, outputSummary: string, rev: number): Promise<V4LifeSubmitWorkResult> {
      const actorId = requireActorId();
      const body: Record<string, unknown> = {
        commandId: crypto.randomUUID(),
        expectedRev: rev,
        workItemId,
        actorId,
        outputSummary,
      };
      return (await sendCommand(`${caseBase}/work`, body, 'work', true)) as V4LifeSubmitWorkResult;
    },
    async decide(
      gateId: string,
      outcome: V4LifeDecision['outcome'],
      reason: string,
      rev: number,
    ): Promise<V4LifeRecordDecisionResult> {
      const actorId = requireActorId();
      const body: Record<string, unknown> = {
        commandId: crypto.randomUUID(),
        expectedRev: rev,
        gateId,
        actorId,
        outcome,
        reason,
      };
      return (await sendCommand(`${caseBase}/decisions`, body, 'decision', true)) as V4LifeRecordDecisionResult;
    },
    async resetDemo(): Promise<{ status: string; projection: V4LifeProjection }> {
      // reset 是演示态重置（§14.3），不是业务命令：不进入 retryLast 通道。
      const payload = await guarded(() =>
        fetchImpl('/api/v4life/demo/reset', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        }),
      );
      return payload as { status: string; projection: V4LifeProjection };
    },
    get hasPendingRetry(): boolean {
      return lastPending !== null;
    },
    get pendingRetryKind(): CommandFeedback['kind'] | null {
      return lastPending?.kind ?? null;
    },
    async retryLast(): Promise<unknown> {
      if (lastPending === null) {
        throw new WorkspaceError('NO_PENDING_COMMAND', 0, '当前没有可重试的未完成命令。');
      }
      const record = lastPending;
      return sendCommand(record.url, record.body, record.kind, true);
    },
  };
}

// ---------------------------------------------------------------------------
// React hooks（无新依赖，React 内建）
// ---------------------------------------------------------------------------

export interface UseCaseProjectionResult {
  projection: V4LifeProjection | null;
  connection: ConnectionState;
  error: WorkspaceError | null;
  refresh(): Promise<void>;
}

/**
 * canonical Projection 订阅：首载 GET + 2.5s 轻量轮询；document.hidden 暂停轮询、恢复可见立即刷新；
 * 卸载 abort。首载失败 → connection 'error'；已有数据后轮询失败 → 'stale'（保留最后一份权威数据）。
 */
export function useCaseProjection(caseId: string): UseCaseProjectionResult {
  const [projection, setProjection] = React.useState<V4LifeProjection | null>(null);
  const [connection, setConnection] = React.useState<ConnectionState>('loading');
  const [error, setError] = React.useState<WorkspaceError | null>(null);
  const client = React.useMemo(() => createWorkspaceClient(caseId), [caseId]);
  const projectionRef = React.useRef<V4LifeProjection | null>(null);
  const controllerRef = React.useRef<AbortController | null>(null);

  const load = React.useCallback(async (): Promise<void> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const next = await client.fetchProjection(controller.signal);
      if (controllerRef.current !== controller) {
        return;
      }
      projectionRef.current = next;
      setProjection(next);
      setError(null);
      setConnection('synced');
    } catch (cause) {
      if (controllerRef.current !== controller) {
        return;
      }
      const workspaceError =
        cause instanceof WorkspaceError ? cause : new WorkspaceError('INTERNAL_ERROR', 0);
      setError(workspaceError);
      setConnection(projectionRef.current === null ? 'error' : 'stale');
    }
  }, [client]);

  // 通过 ref 间接调用 loader（同 InspectionRail 模式）：effect 体不直接 setState，轮询/可见性回调取最新 loader。
  const loadRef = React.useRef(load);
  React.useEffect(() => {
    loadRef.current = load;
  });

  React.useEffect(() => {
    void loadRef.current();
    const intervalId = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      void loadRef.current();
    }, POLL_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        void loadRef.current();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    return () => {
      clearInterval(intervalId);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      controllerRef.current?.abort();
    };
  }, []);

  return { projection, connection, error, refresh: load };
}

export interface WorkspaceActionsHookOptions {
  /** 命令执行角色（submittedBy/actorId）。 */
  actorId?: string;
  /** 读取当前 expectedRev（通常取 useCaseProjection 的最新 projection.rev）；缺省时命令前先 GET 一次 Projection。 */
  getRev?: () => number | undefined;
  /** 命令受理后触发的 canonical Projection 刷新（接 useCaseProjection 的 refresh）。 */
  refresh?: () => void | Promise<void>;
}

export type WorkspaceActionsHook = WorkspaceActions & {
  feedback: CommandFeedback | null;
  /** 复用同 commandId 重发上一个传输失败的命令（无未完成命令时返回 NO_PENDING_COMMAND 反馈）。 */
  retryLast(): Promise<CommandFeedback>;
};

const ENGINE_ERROR_CODES: ReadonlySet<string> = new Set([
  'INVALID_ENGINE_INPUT',
  'ACTOR_NOT_FOUND',
  'EVIDENCE_INVALID',
  'CASE_NOT_FOUND',
  'WORK_ITEM_NOT_FOUND',
  'GATE_NOT_FOUND',
  'ROLE_MISMATCH',
  'EVIDENCE_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'VERSION_CONFLICT',
  'WORK_ITEM_NOT_ACTIVE',
  'GATE_NOT_OPEN',
  'GATE_ALREADY_DECIDED',
  'SEQ_CONFLICT',
  'INTERNAL_ERROR',
]);

const CLIENT_ERROR_CODES: ReadonlySet<string> = new Set([
  'NETWORK_ERROR',
  'NO_PENDING_COMMAND',
  'COMMAND_IN_FLIGHT',
]);

const ERROR_MESSAGES: Record<string, string> = {
  NETWORK_ERROR: '网络异常：命令是否送达未知，可重试（将复用同一命令编号与内容）。',
  NO_PENDING_COMMAND: '当前没有可重试的未完成命令。',
  COMMAND_IN_FLIGHT: '相同命令仍在进行中，请等待其完成后再试。',
  INVALID_ENGINE_INPUT: '提交内容未通过校验，请检查后重试。',
  ACTOR_NOT_FOUND: '未知的执行角色，请刷新后重试。',
  EVIDENCE_INVALID: '证据内容未通过校验，请检查摘要、标记与金额后重试。',
  CASE_NOT_FOUND: '案例不存在或未开放。',
  WORK_ITEM_NOT_FOUND: '工作项不存在，请刷新最新状态。',
  GATE_NOT_FOUND: 'Gate 不存在，请刷新最新状态。',
  ROLE_MISMATCH: '当前角色无权执行该操作。',
  EVIDENCE_CONFLICT: '该证据编号已存在且内容不同，请更换编号或核对内容。',
  IDEMPOTENCY_CONFLICT: '命令编号冲突：同一编号对应了不同内容，请刷新页面后重试。',
  VERSION_CONFLICT: '状态版本已变化：已为你刷新最新 Projection，请确认后再提交（不会自动重放）。',
  WORK_ITEM_NOT_ACTIVE: '该工作项当前状态不允许提交。',
  GATE_NOT_OPEN: '该 Gate 尚未开启，不能决定。',
  GATE_ALREADY_DECIDED: '该 Gate 本轮已决定，不能重复决定。',
  SEQ_CONFLICT: '服务端事件账本写入冲突，请刷新后重试。',
  INTERNAL_ERROR: '服务暂时不可用（INTERNAL_ERROR），请稍后重试。',
};

/** §14.4：错误映射为中文并保留 exact code；未知错误只显示 INTERNAL_ERROR。 */
function displayErrorCode(code: string): string {
  if (ENGINE_ERROR_CODES.has(code) || CLIENT_ERROR_CODES.has(code)) {
    return code;
  }
  return 'INTERNAL_ERROR';
}

function buildErrorFeedback(kind: CommandFeedback['kind'], error: WorkspaceError): CommandFeedback {
  const code = displayErrorCode(error.code);
  const message = ERROR_MESSAGES[code] ?? `操作失败（${code}），请稍后重试。`;
  return { kind, status: 'error', errorCode: code, message };
}

function commandSuccessMessage(kind: CommandFeedback['kind'], result: unknown): string {
  switch (kind) {
    case 'evidence':
      return '证据已提交并被受理。';
    case 'work': {
      if (!isRecord(result)) {
        return '工作已提交并被受理。';
      }
      const gate = result.gate;
      if (isRecord(gate) && typeof gate.gateId === 'string') {
        const title = typeof gate.title === 'string' ? gate.title : gate.gateId;
        return `工作已提交，Gate「${title}」（${gate.gateId}）已开启，等待具名决定。`;
      }
      if (isRecord(result.workItem) && result.workItem.status === 'completed') {
        return '工作已提交，该工作项已完成。';
      }
      return '工作已提交并被受理。';
    }
    case 'decision': {
      if (!isRecord(result)) {
        return '决定已记录。';
      }
      const receipt = result.receipt;
      if (receipt === null || receipt === undefined) {
        return '决定已记录：退回修改；本轮不生成凭证。';
      }
      if (isRecord(receipt) && isRecord(receipt.decision) && receipt.decision.outcome === 'approved') {
        const receiptId = typeof receipt.receiptId === 'string' ? receipt.receiptId : '';
        return `决定已记录：批准；凭证 ${receiptId} 已生成。`;
      }
      const stoppedCount = Array.isArray(result.stoppedWorkItemIds) ? result.stoppedWorkItemIds.length : 0;
      return stoppedCount > 0
        ? `决定已记录：否决；${stoppedCount} 项依赖工作已停止，已形成的贡献保留。`
        : '决定已记录：否决。';
    }
    default:
      return '命令已受理。';
  }
}

function buildSuccessFeedback(kind: CommandFeedback['kind'], result: unknown): CommandFeedback {
  if (kind === 'reset') {
    return { kind: 'reset', status: 'accepted', message: '合成演示已重置：演示数据已用种子重建（这不是业务回滚）。' };
  }
  const replayed = isRecord(result) && result.status === 'replayed';
  const status = replayed ? 'replayed' : 'accepted';
  const message = replayed
    ? kind === 'evidence'
      ? '该证据提交此前已受理，本次为幂等重放，未产生新变化。'
      : kind === 'work'
        ? '该工作提交此前已受理，本次为幂等重放，未产生新变化。'
        : '该决定此前已记录，本次为幂等重放，未产生新变化。'
    : commandSuccessMessage(kind, result);
  if (kind === 'decision' && isRecord(result)) {
    return {
      kind,
      status,
      message,
      ...(result.receipt instanceof Object && !Array.isArray(result.receipt)
        ? { receipt: result.receipt as unknown as V4LifeReceipt }
        : {}),
      ...(Array.isArray(result.stoppedWorkItemIds)
        ? { stoppedWorkItemIds: result.stoppedWorkItemIds as string[] }
        : {}),
    };
  }
  return { kind, status, message };
}

/**
 * 统一动作入口：pendingKeys 禁止重复提交；一切成功/失败以服务端响应为准；
 * 成功后触发 refresh；VERSION_CONFLICT 先刷新 Projection 并返回 error feedback，不自动重放用户意图。
 */
export function useWorkspaceActions(
  caseId: string,
  options: WorkspaceActionsHookOptions = {},
): WorkspaceActionsHook {
  const [pendingKeys, setPendingKeys] = React.useState<ReadonlySet<string>>(() => new Set<string>());
  const [feedback, setFeedback] = React.useState<CommandFeedback | null>(null);
  const client = React.useMemo(
    () => createWorkspaceClient(caseId, { actorId: options.actorId }),
    [caseId, options.actorId],
  );
  const pendingRef = React.useRef<Set<string>>(new Set());
  const optionsRef = React.useRef<WorkspaceActionsHookOptions>(options);
  React.useEffect(() => {
    optionsRef.current = options;
  });

  const setPending = React.useCallback((key: string, pending: boolean): void => {
    const next = new Set(pendingRef.current);
    if (pending) {
      next.add(key);
    } else {
      next.delete(key);
    }
    pendingRef.current = next;
    setPendingKeys(next);
  }, []);

  const resolveRev = React.useCallback(async (): Promise<number> => {
    const viaOption = optionsRef.current.getRev?.();
    if (typeof viaOption === 'number' && Number.isInteger(viaOption) && viaOption >= 0) {
      return viaOption;
    }
    const fresh = await client.fetchProjection();
    return fresh.rev;
  }, [client]);

  const runFeedback = React.useCallback(
    async (
      kind: CommandFeedback['kind'],
      key: string,
      run: () => Promise<unknown>,
    ): Promise<CommandFeedback> => {
      if (pendingRef.current.has(key)) {
        const busy = buildErrorFeedback(kind, new WorkspaceError('COMMAND_IN_FLIGHT', 0));
        setFeedback(busy);
        return busy;
      }
      setPending(key, true);
      try {
        const result = await run();
        const accepted = buildSuccessFeedback(kind, result);
        setFeedback(accepted);
        void optionsRef.current.refresh?.();
        return accepted;
      } catch (cause) {
        const workspaceError =
          cause instanceof WorkspaceError ? cause : new WorkspaceError('INTERNAL_ERROR', 0);
        if (workspaceError.code === 'VERSION_CONFLICT') {
          // 命令纪律 §14.4：VERSION_CONFLICT 先刷新 Projection，不自动重放用户意图。
          void optionsRef.current.refresh?.();
        }
        const failed = buildErrorFeedback(kind, workspaceError);
        setFeedback(failed);
        return failed;
      } finally {
        setPending(key, false);
      }
    },
    [setPending],
  );

  const runCommand = React.useCallback(
    (kind: CommandFeedback['kind'], key: string, execute: (rev: number) => Promise<unknown>) =>
      runFeedback(kind, key, async () => execute(await resolveRev())),
    [resolveRev, runFeedback],
  );

  return {
    submitEvidence: (draft: EvidenceDraft) =>
      runCommand('evidence', `evidence:${draft.evidenceId}`, (rev) => client.submitEvidence(draft, rev)),
    submitWork: (workItemId: string, outputSummary: string) =>
      runCommand('work', `work:${workItemId}`, (rev) => client.submitWork(workItemId, outputSummary, rev)),
    decide: (gateId: string, outcome: V4LifeDecision['outcome'], reason: string) =>
      runCommand('decision', `decision:${gateId}`, (rev) => client.decide(gateId, outcome, reason, rev)),
    refresh: async (): Promise<void> => {
      await optionsRef.current.refresh?.();
    },
    resetDemo: () => runFeedback('reset', 'reset', () => client.resetDemo()),
    retryLast: () => {
      const kind = client.pendingRetryKind;
      if (kind === null) {
        const empty = buildErrorFeedback('evidence', new WorkspaceError('NO_PENDING_COMMAND', 0));
        setFeedback(empty);
        return Promise.resolve(empty);
      }
      return runFeedback(kind, `retry:${kind}`, () => client.retryLast());
    },
    pendingKeys,
    feedback,
  };
}
