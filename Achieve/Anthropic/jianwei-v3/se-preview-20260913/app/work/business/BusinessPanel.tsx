// 业务（陈经理）Mobile-first 协同面 —— Lane W2（E03–E08）
// 只消费冻结契约（app/work/workspace-contract.ts）与 V4Life 类型；不 import selector 实现，
// 不持有 canonical state：一切正式状态来自 props.projection，派生逻辑全部为本地纯函数。
// 硬边界：无批准/退回/否决按钮；无提交工作项按钮；无客户 CRM/商机/聊天/假在线；
// 业务只有 Evidence 提交与只读反馈，Human Gate 决定权始终属于匹配 requiredRole 的具名 Actor。

import { useId, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  DOMAIN_LABELS,
  type ConnectionState,
  type EvidenceDraft,
  type SupplementRequest,
  type WorkspaceActionsProps,
} from '../workspace-contract.ts';
import type {
  V4LifeDependency,
  V4LifeDomain,
  V4LifeEvidenceKind,
  V4LifeProjection,
  V4LifeWorkItemStatus,
} from '../../../lib/v4life/types.ts';
import styles from './business.module.css';

export interface BusinessPanelProps extends WorkspaceActionsProps {
  /** 当前具名 Actor 展示名（可选；缺省时组件自行从 projection.actors 解析）。 */
  selectedActorLabel?: string;
}

// ---------------------------------------------------------------------------
// 展示常量（状态不只靠颜色：一律文字 + 文字符号）
// ---------------------------------------------------------------------------

const DOMAIN_ORDER: readonly V4LifeDomain[] = ['policy', 'credit', 'commerce', 'asset'];

const STATUS_ORDER: readonly V4LifeWorkItemStatus[] = [
  'in_progress',
  'blocked',
  'awaiting_gate',
  'completed',
  'stopped_dependency',
];

const STATUS_LABELS: Record<V4LifeWorkItemStatus, string> = {
  blocked: '受阻',
  in_progress: '进行中',
  awaiting_gate: '待决定',
  completed: '已完成',
  stopped_dependency: '已停止',
};

const EVIDENCE_KIND_LABELS: Record<V4LifeEvidenceKind, string> = {
  upstream_context: '上游背景',
  financial_statement: '财务报表',
  contract_draft: '合同草案',
  asset_history_feedback: '资产历史反馈',
  supplement: '补充说明',
};

/** 业务可提交的 Evidence kind 及其对应的证据依赖 id（与 lib/v4life/seed.ts 依赖命名一致）。 */
const BUSINESS_REQUEST_KINDS: ReadonlyArray<{
  kind: SupplementRequest['evidenceKind'];
  label: string;
  depId: string | null;
}> = [
  { kind: 'financial_statement', label: '财务报表', depId: 'ev-financial-statement' },
  { kind: 'contract_draft', label: '合同草案', depId: 'ev-contract-draft' },
  { kind: 'asset_history_feedback', label: '资产历史反馈', depId: 'ev-asset-history-feedback' },
  { kind: 'supplement', label: '补充说明', depId: null },
];

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  loading: '同步中',
  synced: '已同步',
  stale: '状态已过期',
  error: '读取失败',
};

// ---------------------------------------------------------------------------
// 本地纯派生（全部来自 projection，不虚构）
// ---------------------------------------------------------------------------

function formatAmountCny(amountCny: number): string {
  if (!Number.isFinite(amountCny)) {
    return `${String(amountCny)} 元`;
  }
  if (amountCny >= 10000 && amountCny % 10000 === 0) {
    return `${(amountCny / 10000).toLocaleString('zh-CN')} 万元`;
  }
  return `${amountCny.toLocaleString('zh-CN')} 元`;
}

/** 固定格式时间戳，避免 SSR 与客户端 locale 差异导致的 hydration 不一致。 */
function formatStamp(iso: string): string {
  const stamp = `${iso.slice(0, 16)}Z`.replace('T', ' ').replace('Z', '');
  return stamp.length === 16 ? stamp : iso;
}

function actorNameOf(projection: V4LifeProjection, actorId: string): string {
  return projection.actors.find((actor) => actor.actorId === actorId)?.displayName ?? actorId;
}

function dedupe(list: readonly string[]): string[] {
  return [...new Set(list)];
}

interface DomainFeedbackRow {
  domain: V4LifeDomain;
  label: string;
  statusLine: string;
  waitingReasons: string[];
  askFromBusiness: string | null;
  candidateCount: number;
}

function waitingReasonOfDependency(
  dep: V4LifeDependency,
  acceptedKinds: ReadonlySet<V4LifeEvidenceKind>,
): string | null {
  if (dep.kind === 'receipt') {
    return `等待 ${dep.id} 的具名决定`;
  }
  if (dep.kind === 'workitem') {
    return `等待 ${dep.id} 完成`;
  }
  const match = BUSINESS_REQUEST_KINDS.find((entry) => entry.depId === dep.id);
  if (match === undefined) {
    return `等待证据 ${dep.id}`;
  }
  if (acceptedKinds.has(match.kind)) {
    return null;
  }
  return `等待业务补充「${match.label}」`;
}

function deriveDomainFeedback(projection: V4LifeProjection): DomainFeedbackRow[] {
  const acceptedKinds = new Set(projection.evidence.map((entry) => entry.kind));
  return DOMAIN_ORDER.map((domain) => {
    const bucket = projection.domains.find((entry) => entry.domain === domain);
    const items = bucket?.workItems ?? [];
    const counts = STATUS_ORDER.map((status) => {
      const count = items.filter((item) => item.status === status).length;
      return count > 0 ? `${STATUS_LABELS[status]} ${count}` : null;
    }).filter((entry): entry is string => entry !== null);
    const waitingReasons: string[] = [];
    for (const item of items) {
      if (item.status === 'awaiting_gate') {
        waitingReasons.push(item.gateId !== undefined ? `待 ${item.gateId} 具名决定` : '等待具名决定');
        continue;
      }
      if (item.status !== 'blocked') {
        continue;
      }
      for (const dep of item.dependencies) {
        const reason = waitingReasonOfDependency(dep, acceptedKinds);
        if (reason !== null) {
          waitingReasons.push(reason);
        }
      }
    }
    const candidates = bucket?.candidates ?? [];
    const missingAsks = candidates
      .filter((candidate) => candidate.kind === 'missing_document')
      .map((candidate) => candidate.summary);
    return {
      domain,
      label: DOMAIN_LABELS[domain],
      statusLine: counts.length > 0 ? counts.join(' · ') : '暂无工作项',
      waitingReasons: dedupe(waitingReasons),
      askFromBusiness: missingAsks.length > 0 ? missingAsks.join(' ') : null,
      candidateCount: candidates.length,
    };
  });
}

/**
 * 补件请求：由 blocked 工作项的真实证据依赖（source=dependency）与
 * missing_document 候选（source=candidate）派生，形状为契约 SupplementRequest。
 */
function deriveSupplementRequests(projection: V4LifeProjection): SupplementRequest[] {
  const requests: SupplementRequest[] = [];
  const seen = new Set<string>();
  const acceptedKinds = new Set(projection.evidence.map((entry) => entry.kind));

  for (const bucket of projection.domains) {
    for (const item of bucket.workItems) {
      if (item.status !== 'blocked') {
        continue;
      }
      for (const dep of item.dependencies) {
        if (dep.kind !== 'evidence') {
          continue;
        }
        const match = BUSINESS_REQUEST_KINDS.find((entry) => entry.depId === dep.id);
        if (match === undefined || acceptedKinds.has(match.kind) || seen.has(match.kind)) {
          continue;
        }
        seen.add(match.kind);
        requests.push({
          evidenceKind: match.kind,
          title: `${match.label}（${item.title}）`,
          reason: `${DOMAIN_LABELS[bucket.domain]}域「${item.title}」正在等待该材料，补充并受理后可继续推进。`,
          source: 'dependency',
          basis: [dep.id],
        });
      }
    }
  }

  for (const bucket of projection.domains) {
    for (const candidate of bucket.candidates) {
      if (candidate.kind !== 'missing_document' || seen.has(`candidate:${candidate.candidateId}`)) {
        continue;
      }
      seen.add(`candidate:${candidate.candidateId}`);
      requests.push({
        evidenceKind: 'supplement',
        title: `补充说明（${DOMAIN_LABELS[bucket.domain]}域补件建议）`,
        reason: candidate.summary,
        source: 'candidate',
        basis: [...candidate.basis],
      });
    }
  }

  return requests;
}

function deriveRecentReceipts(projection: V4LifeProjection) {
  return projection.receipts.slice(-3).reverse();
}

function deriveStoppedItems(projection: V4LifeProjection): Array<{ workItemId: string; title: string; reason: string }> {
  return projection.domains
    .flatMap((bucket) => bucket.workItems)
    .filter((item) => item.status === 'stopped_dependency')
    .map((item) => {
      const receiptIds = item.dependencies
        .filter((dep) => dep.kind === 'receipt')
        .map((dep) => dep.id);
      return {
        workItemId: item.workItemId,
        title: item.title,
        reason:
          receiptIds.length > 0
            ? `依赖的 ${receiptIds.join('、')} 决定未通过，本项停止；既有贡献保留。`
            : '上游 Gate 决定未通过，本项停止；既有贡献保留。',
      };
    });
}

function outcomeLabel(outcome: 'approved' | 'rejected' | 'returned'): string {
  if (outcome === 'approved') {
    return '✓ 通过';
  }
  return outcome === 'rejected' ? '✕ 否决' : '↻ 退回';
}

function newEvidenceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `ev-biz-${crypto.randomUUID()}`;
  }
  return `ev-biz-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// 快速补件使用契约 §11 规范 Evidence id：依赖图（WI-C2/WI-B1 等）按固定 id 满足，
// 只有自由补充材料才使用生成 id。同 id 同载荷重发由引擎按幂等语义处理（replayed）。
const CANONICAL_EVIDENCE_IDS: Record<string, string> = {
  financial_statement: 'ev-financial-statement',
  contract_draft: 'ev-contract-draft',
  asset_history_feedback: 'ev-asset-history-feedback',
};

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

interface RequestFormState {
  kind: V4LifeEvidenceKind;
  title: string;
  summary: string;
}

type RequestFormMap = Record<string, RequestFormState>;

export function BusinessPanel(props: BusinessPanelProps) {
  const { projection, actorId, actions, connection, feedback, selectedActorLabel } = props;

  const [formMap, setFormMap] = useState<RequestFormMap>({});
  const [pendingRequestKey, setPendingRequestKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [evidenceScope, setEvidenceScope] = useState<'mine' | 'all'>('mine');

  const titleId = useId();
  const domainId = useId();
  const requestId = useId();
  const evidenceId2 = useId();
  const footerId = useId();

  const domainRows = deriveDomainFeedback(projection);
  const supplementRequests = deriveSupplementRequests(projection);
  const recentReceipts = deriveRecentReceipts(projection);
  const stoppedItems = deriveStoppedItems(projection);

  const actorLabel = selectedActorLabel ?? actorNameOf(projection, actorId);
  const myEvidence = projection.evidence.filter((entry) => entry.submittedBy === actorId);
  const visibleEvidence = evidenceScope === 'mine' ? myEvidence : projection.evidence;

  const anyPending = pendingRequestKey !== null || actions.pendingKeys.size > 0;

  function formOf(request: SupplementRequest, key: string): RequestFormState {
    return formMap[key] ?? { kind: request.evidenceKind, title: request.title, summary: '' };
  }

  function updateForm(key: string, request: SupplementRequest, patch: Partial<RequestFormState>): void {
    setFormMap((prev) => ({ ...prev, [key]: { ...formOf(request, key), ...patch } }));
  }

  function handleRefresh(): void {
    if (refreshing) {
      return;
    }
    setRefreshing(true);
    void actions.refresh().finally(() => setRefreshing(false));
  }

  async function handleSubmitEvidence(request: SupplementRequest, key: string, form: RequestFormState): Promise<void> {
    if (anyPending) {
      return;
    }
    const summary = form.summary.trim();
    if (summary.length === 0) {
      return;
    }
    setPendingRequestKey(key);
    try {
      const draft: EvidenceDraft = {
        evidenceId: CANONICAL_EVIDENCE_IDS[form.kind] ?? newEvidenceId(),
        kind: form.kind,
        title: form.title.trim() || request.title,
        payload: { summary, tags: ['supplement'] },
      };
      const result = await actions.submitEvidence(draft);
      if (result.status !== 'error') {
        updateForm(key, request, { summary: '' });
      }
    } finally {
      setPendingRequestKey(null);
    }
  }

  return (
    <section className={styles.panel} aria-label="业务协同面板">
      <header className={styles.caseCard}>
        <div className={styles.caseTop}>
          <span className={styles.demoBadge}>合成演示 · 非真实客户</span>
          <span className={styles.connChip} data-state={connection}>{CONNECTION_LABELS[connection]}</span>
        </div>
        <h2 id={titleId} className={styles.caseTitle}>{projection.case.displayName}</h2>
        <p className={styles.casePurpose}>
          金额：{formatAmountCny(projection.case.financingAmountCny)} · 用途：{projection.case.purpose}
        </p>
        <dl className={styles.metaGrid}>
          <div><dt>修订 rev</dt><dd>{projection.rev}</dd></div>
          <div><dt>事件数</dt><dd>{projection.eventCount}</dd></div>
          <div><dt>材料数</dt><dd>{projection.evidenceCount}</dd></div>
          <div><dt>当前身份</dt><dd>{actorLabel}</dd></div>
        </dl>
        <p className={styles.disclaimer}>{projection.case.disclaimer}</p>
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={handleRefresh}
          disabled={refreshing || connection === 'loading'}
        >
          {refreshing || connection === 'loading' ? '刷新中…' : '手动刷新'}
        </button>
      </header>

      <div className={styles.liveArea} role="status" aria-live="polite">
        {feedback !== null ? (
          <p className={styles.banner} data-status={feedback.status}>
            <strong>
              {feedback.status === 'accepted'
                ? '✓ 已受理'
                : feedback.status === 'replayed'
                  ? '↻ 重复命令（此前已受理）'
                  : '✕ 提交失败'}
            </strong>
            <span>
              {feedback.message}
              {feedback.errorCode !== undefined ? `（代码 ${feedback.errorCode}）` : ''}
            </span>
          </p>
        ) : null}
      </div>

      <section className={styles.section} aria-labelledby={domainId}>
        <h3 id={domainId} className={styles.sectionTitle}>四域反馈</h3>
        <ul className={styles.domainList}>
          {domainRows.map((row) => (
            <li key={row.domain} className={styles.domainRow}>
              <div className={styles.domainHead}>
                <strong>{row.label}</strong>
                <span className={styles.domainStatus}>{row.statusLine}</span>
              </div>
              <p className={styles.domainWait}>
                {row.waitingReasons.length > 0 ? `等待：${row.waitingReasons.join('；')}` : '当前无等待，按依赖推进。'}
              </p>
              {row.askFromBusiness !== null ? (
                <p className={styles.domainAsk}>对业务的补充要求：{row.askFromBusiness}</p>
              ) : null}
              <small className={styles.domainMeta}>候选 {row.candidateCount} 条 · authority none</small>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby={requestId}>
        <h3 id={requestId} className={styles.sectionTitle}>补件请求</h3>
        <p className={styles.sectionNote}>
          请求来自四域候选（authority none）或真实依赖缺口；提交后以服务端受理结果为准。
        </p>
        {supplementRequests.length === 0 ? (
          <p className={styles.emptyNote}>当前没有待补充的材料请求。</p>
        ) : (
          <ul className={styles.requestList}>
            {supplementRequests.map((request, index) => {
              const key = `${request.source}-${request.evidenceKind}-${index}`;
              const form = formOf(request, key);
              const pending = pendingRequestKey === key;
              return (
                <li key={key} className={styles.requestCard}>
                  <details>
                    <summary>
                      <span className={styles.reqTitle}>{request.title}</span>
                      <span className={styles.reqSource}>
                        {request.source === 'candidate' ? '来源：域候选' : '来源：依赖缺口'}
                      </span>
                    </summary>
                    <p className={styles.reqReason}>{request.reason}</p>
                    {request.basis.length > 0 ? (
                      <p className={styles.reqBasis}>依据：{request.basis.join('、')}</p>
                    ) : null}
                    <div className={styles.reqForm}>
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>材料类型（已预选）</span>
                        <select
                          className={styles.select}
                          value={form.kind}
                          disabled={pending}
                          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                            updateForm(key, request, { kind: event.target.value as V4LifeEvidenceKind })
                          }
                        >
                          {BUSINESS_REQUEST_KINDS.map((entry) => (
                            <option key={entry.kind} value={entry.kind}>{entry.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>标题（已预填，可改）</span>
                        <input
                          className={styles.input}
                          type="text"
                          value={form.title}
                          disabled={pending}
                          onChange={(event: ChangeEvent<HTMLInputElement>) =>
                            updateForm(key, request, { title: event.target.value })
                          }
                        />
                      </label>
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>摘要（必填）</span>
                        <textarea
                          className={styles.textarea}
                          rows={3}
                          value={form.summary}
                          placeholder="简述材料内容、口径与时间范围"
                          disabled={pending}
                          onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                            updateForm(key, request, { summary: event.target.value })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className={styles.submitBtn}
                        disabled={anyPending || form.summary.trim().length === 0}
                        aria-busy={pending}
                        onClick={() => void handleSubmitEvidence(request, key, form)}
                      >
                        {pending ? '提交中…' : '提交材料'}
                      </button>
                      <small className={styles.reqHint}>
                        tags 默认 supplement · 结果以服务端 accepted / replayed 为准 · 本面板不含任何审批动作
                      </small>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby={evidenceId2}>
        <div className={styles.sectionHead}>
          <h3 id={evidenceId2} className={styles.sectionTitle}>我的材料</h3>
          <div className={styles.scopeSwitch} role="group" aria-label="材料查看范围">
            <button
              type="button"
              className={styles.scopeBtn}
              aria-pressed={evidenceScope === 'mine'}
              onClick={() => setEvidenceScope('mine')}
            >
              我的
            </button>
            <button
              type="button"
              className={styles.scopeBtn}
              aria-pressed={evidenceScope === 'all'}
              onClick={() => setEvidenceScope('all')}
            >
              全部
            </button>
          </div>
        </div>
        {visibleEvidence.length === 0 ? (
          <p className={styles.emptyNote}>
            {evidenceScope === 'mine'
              ? '暂无我提交的材料；可切换「全部」查看该 Case 已有材料。'
              : '该 Case 尚无任何材料。'}
          </p>
        ) : (
          <ul className={styles.evidenceList}>
            {visibleEvidence.map((entry) => (
              <li key={entry.evidenceId} className={styles.evidenceRow}>
                <span className={styles.evKind}>{EVIDENCE_KIND_LABELS[entry.kind]}</span>
                <span className={styles.evTitle}>{entry.title}</span>
                <span className={styles.evMeta}>
                  {formatStamp(entry.submittedAt)} · V{entry.version}
                  {evidenceScope === 'all' ? ` · ${actorNameOf(projection, entry.submittedBy)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby={footerId}>
        <h3 id={footerId} className={styles.sectionTitle}>决定与回执摘要（只读）</h3>
        {recentReceipts.length === 0 ? (
          <p className={styles.emptyNote}>
            暂无 Receipt：尚未形成正式 Gate 决定；退回不产生 Receipt，被退回的工作项会回到「进行中」。
          </p>
        ) : (
          <ul className={styles.receiptList}>
            {recentReceipts.map((receipt) => (
              <li key={receipt.receiptId} className={styles.receiptRow} data-outcome={receipt.decision.outcome}>
                <span className={styles.receiptOutcome}>{outcomeLabel(receipt.decision.outcome)}</span>
                <span className={styles.receiptBody}>
                  <strong>{receipt.gateId}</strong>
                  <span>{receipt.decision.reason}</span>
                  <small>
                    {formatStamp(receipt.decision.decidedAt)} · {actorNameOf(projection, receipt.decision.actorId)} ·{' '}
                    {receipt.receiptId}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        )}
        {stoppedItems.length > 0 ? (
          <ul className={styles.stopList}>
            {stoppedItems.map((entry) => (
              <li key={entry.workItemId}>
                ✕ 已停止：{entry.title}（{entry.workItemId}）——{entry.reason}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </section>
  );
}

export default BusinessPanel;
