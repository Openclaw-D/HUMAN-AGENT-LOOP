// /work 检查轨（Lane W4，2026-09-03）
// Evidence / Candidate / Receipt / Event Ledger 四个 tab + Contribution 只读区。
// 权威边界：一切数据来自传入的 canonical Projection；事件账本经 props 注入的 loadEvents 分页读取；
// 本组件不自备第二状态、不 import model 实现、不产生任何决定。
// 协作发生过什么由 Event / Evidence / Contribution / Receipt 表达：没有静态聊天，没有假在线。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { DOMAIN_LABELS } from '../workspace-contract';
import type { EventPage, WorkspaceActionsProps } from '../workspace-contract';
import type {
  V4LifeCandidate,
  V4LifeContribution,
  V4LifeDecision,
  V4LifeEvidence,
  V4LifeEvent,
} from '../../../lib/v4life/types';
import { ConnectionDot, EmptyBlock, ErrorBlock, FeedbackBanner, LoadingBlock, StaleBanner } from './StatusPrimitives';
import styles from './inspection.module.css';

export interface InspectionRailProps extends WorkspaceActionsProps {
  /** 事件账本分页读取（由 shell 从 model 注入）：loadEvents(afterSeq, limit) → EventPage。 */
  loadEvents: (afterSeq: number, limit: number) => Promise<EventPage>;
  /** 当前选中事项（可选）：用于在候选 / 凭证 / 贡献中高亮关联记录。 */
  selectedWorkItemId?: string;
}

type TabId = 'evidence' | 'candidate' | 'receipt' | 'events';

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'evidence', label: '证据' },
  { id: 'candidate', label: '候选' },
  { id: 'receipt', label: '凭证' },
  { id: 'events', label: '事件账本' },
];

const PAGE_LIMIT = 50;

const EVIDENCE_KIND_LABELS: Record<V4LifeEvidence['kind'], string> = {
  upstream_context: '上游背景',
  financial_statement: '财务资料',
  contract_draft: '合同草案',
  asset_history_feedback: '资产历史反馈',
  supplement: '补充材料',
};

const CANDIDATE_KIND_LABELS: Record<V4LifeCandidate['kind'], string> = {
  contradiction: '矛盾点',
  missing_document: '缺失材料',
};

const OUTCOME_LABELS: Record<V4LifeDecision['outcome'], string> = {
  approved: '批准',
  rejected: '否决',
  returned: '退回',
};

const OUTCOME_CLASS: Record<V4LifeDecision['outcome'], string> = {
  approved: styles.outcomeApproved,
  rejected: styles.outcomeRejected,
  returned: styles.outcomeReturned,
};

const EVENT_TYPE_LABELS: Record<V4LifeEvent['payload']['type'], string> = {
  CASE_INITIALIZED: 'Case 初始化',
  EVIDENCE_ACCEPTED: '证据受理',
  WORK_ITEM_STARTED: '事项开始',
  WORK_ITEM_SUBMITTED: '事项提交',
  CONTRIBUTION_RECORDED: '贡献记录',
  CANDIDATE_ISSUED: '候选签发',
  GATE_OPENED: 'Gate 开启',
  DECISION_RECORDED: '决定记录',
  WORK_ITEM_COMPLETED: '事项完成',
  WORK_ITEM_STOPPED: '事项停止',
  // P1 语义扩展（Lane E 追加；纯标签映射，零行为变化）：payload 联合扩展后本 Record 需穷举新事件键
  EVIDENCE_VERIFICATION_CHANGED: '证据核验变更',
  CONTEXT_BATCH_OPENED: '收集窗口开启',
  CONTEXT_BATCH_STABILIZED: '收集窗口整编',
  CONTEXT_BATCH_SEALED: '收集窗口封存',
  INPUT_EVENT_APPENDED: '输入事件登记',
};

const CONTRIBUTION_KIND_LABELS: Record<V4LifeContribution['kind'], string> = {
  evidence_review: '证据复核',
  cross_check: '交叉核对',
  material_prep: '材料准备',
  risk_finding: '风险发现',
};

/** 确定性时间格式（不依赖运行环境 locale，避免水合抖动）。 */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 从未知异常中提取 exact code（不读 stack / 内部对象）。 */
function errorCodeOf(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) {
      return code;
    }
  }
  return fallback;
}

function errorMessageOf(error: unknown): string | undefined {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return undefined;
}

export function InspectionRail(props: InspectionRailProps) {
  const { projection, actions, connection, feedback, loadEvents, selectedWorkItemId } = props;
  const [activeTab, setActiveTab] = useState<TabId>('evidence');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // --- 事件账本分页状态（唯一本地状态，仅承载读取结果，不作 canonical truth） ---
  const [ledger, setLedger] = useState<EventPage | null>(null);
  const [ledgerState, setLedgerState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [ledgerErrorCode, setLedgerErrorCode] = useState('EVENT_LEDGER_FETCH_FAILED');
  const [ledgerErrorMessage, setLedgerErrorMessage] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadEventsRef = useRef(loadEvents);
  const projectionRef = useRef(projection);
  const latestLedgerRef = useRef<EventPage | null>(null);
  const requestSeqRef = useRef(0);
  const lastLedgerSyncRef = useRef<{ caseId: string; rev: number } | null>(null);

  useEffect(() => {
    loadEventsRef.current = loadEvents;
    projectionRef.current = projection;
    latestLedgerRef.current = ledger;
  });

  const markLedgerSynced = () => {
    lastLedgerSyncRef.current = {
      caseId: projectionRef.current.case.caseId,
      rev: projectionRef.current.rev,
    };
  };

  const fetchInitial = useCallback(async () => {
    const requestId = ++requestSeqRef.current;
    setLedgerState('loading');
    setLedgerErrorMessage(undefined);
    try {
      const page = await loadEventsRef.current(0, PAGE_LIMIT);
      if (requestId !== requestSeqRef.current) {
        return;
      }
      setLedger(page);
      setLedgerState('ready');
      markLedgerSynced();
    } catch (error) {
      if (requestId !== requestSeqRef.current) {
        return;
      }
      setLedgerErrorCode(errorCodeOf(error, 'EVENT_LEDGER_FETCH_FAILED'));
      setLedgerErrorMessage(errorMessageOf(error));
      setLedgerState('error');
    }
  }, []);

  const loadMore = useCallback(async () => {
    const current = latestLedgerRef.current;
    if (!current || !current.hasMore) {
      return;
    }
    const requestId = ++requestSeqRef.current;
    setLoadingMore(true);
    setLedgerErrorMessage(undefined);
    try {
      const page = await loadEventsRef.current(current.nextSeq, PAGE_LIMIT);
      if (requestId !== requestSeqRef.current) {
        return;
      }
      setLedger({
        events: [...current.events, ...page.events],
        nextSeq: page.nextSeq,
        hasMore: page.hasMore,
      });
      setLedgerState('ready');
      markLedgerSynced();
    } catch (error) {
      if (requestId !== requestSeqRef.current) {
        return;
      }
      setLedgerErrorCode(errorCodeOf(error, 'EVENT_LEDGER_FETCH_FAILED'));
      setLedgerErrorMessage(errorMessageOf(error));
      setLedgerState('error');
    } finally {
      if (requestId === requestSeqRef.current) {
        setLoadingMore(false);
      }
    }
  }, []);

  // 挂载时加载第一页（afterSeq=0, limit=50）。
  const fetchInitialRef = useRef(fetchInitial);
  useEffect(() => {
    fetchInitialRef.current = fetchInitial;
  });
  useEffect(() => {
    void fetchInitialRef.current();
  }, []);

  // Case 变更或 rev 回退（demo reset）时账本必须重读，否则会展示已被重置的序列。
  const caseId = projection.case.caseId;
  const rev = projection.rev;
  useEffect(() => {
    const last = lastLedgerSyncRef.current;
    if (!last) {
      return;
    }
    if (last.caseId !== caseId || rev < last.rev) {
      lastLedgerSyncRef.current = null;
      void fetchInitialRef.current();
    }
  }, [caseId, rev]);

  // --- 派生数据（全部来自 Projection，纯计算） ---
  const actorNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const actor of projection.actors) {
      map.set(actor.actorId, actor.displayName);
    }
    return map;
  }, [projection.actors]);

  const actorName = useCallback(
    (actorId: string) => actorNames.get(actorId) ?? actorId,
    [actorNames],
  );

  const gateInfo = useMemo(() => {
    const map = new Map<string, { title: string; workItemId: string }>();
    for (const domain of projection.domains) {
      for (const gate of domain.gates) {
        map.set(gate.gateId, { title: gate.title, workItemId: gate.workItemId });
      }
    }
    return map;
  }, [projection.domains]);

  const candidates = useMemo<V4LifeCandidate[]>(
    () => projection.domains.flatMap((domain) => domain.candidates),
    [projection.domains],
  );

  const contributions = projection.contributions;

  const countOf = (id: TabId): number => {
    switch (id) {
      case 'evidence':
        return projection.evidence.length;
      case 'candidate':
        return candidates.length;
      case 'receipt':
        return projection.receipts.length;
      case 'events':
        return ledger?.events.length ?? 0;
    }
  };

  // --- 键盘左右切换（roving tabindex + selection follows focus） ---
  const handleTablistKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const currentIndex = TABS.findIndex((tab) => tab.id === activeTab);
    let nextIndex = -1;
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % TABS.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = TABS.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const nextTab = TABS[nextIndex];
    if (!nextTab) {
      return;
    }
    setActiveTab(nextTab.id);
    tabRefs.current[nextIndex]?.focus();
  };

  const retryLedger = () => {
    if (ledger && ledger.events.length > 0) {
      void loadMore();
    } else {
      void fetchInitial();
    }
  };

  return (
    <section className={styles.rail} aria-label="检查轨：证据、候选、凭证与事件账本">
      <header className={styles.railHeader}>
        <div className={styles.railTitleBlock}>
          <h2 className={styles.railTitle}>检查轨</h2>
          <p className={styles.railSubtitle}>
            {projection.case.displayName} · rev {projection.rev} · 事件 {projection.eventCount} 条
          </p>
        </div>
        <ConnectionDot connection={connection} />
      </header>

      {connection === 'stale' ? <StaleBanner onRefresh={() => void actions.refresh()} /> : null}

      <FeedbackBanner feedback={feedback} />

      <div className={styles.tablistWrap}>
        <div className={styles.tablist} role="tablist" aria-label="检查轨视图" onKeyDown={handleTablistKeyDown}>
          {TABS.map((tab, index) => (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`inspection-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={`inspection-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              className={styles.tab}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              <span className={styles.tabCount}>{countOf(tab.id)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Evidence */}
      <div
        role="tabpanel"
        id="inspection-panel-evidence"
        aria-labelledby="inspection-tab-evidence"
        tabIndex={0}
        className={styles.tabPanel}
        hidden={activeTab !== 'evidence'}
      >
        {projection.evidence.length === 0 ? (
          <EmptyBlock title="暂无证据" hint={`「${projection.case.displayName}」还没有受理任何 Evidence。`} />
        ) : (
          <ul className={styles.cardList}>
            {projection.evidence.map((item) => (
              <li key={item.evidenceId} className={styles.recordCard}>
                <div className={styles.cardHead}>
                  <span className={styles.kindBadge}>{EVIDENCE_KIND_LABELS[item.kind]}</span>
                  <strong className={styles.cardTitle}>{item.title}</strong>
                  <span className={styles.versionBadge}>v{item.version}</span>
                </div>
                <p className={styles.summaryText}>{item.payload.summary}</p>
                {typeof item.payload.amountCny === 'number' ? (
                  <p className={styles.metaLine}>金额：¥{item.payload.amountCny.toLocaleString('zh-CN')}</p>
                ) : null}
                <div className={styles.cardMeta}>
                  <span>提交人 {actorName(item.submittedBy)}</span>
                  <time dateTime={item.submittedAt}>{formatTimestamp(item.submittedAt)}</time>
                  <span className={styles.mono}>{item.evidenceId}</span>
                </div>
                {item.payload.tags.length > 0 ? (
                  <ul className={styles.tagList}>
                    {item.payload.tags.map((tag) => (
                      <li key={tag} className={styles.tagChip}>
                        {tag}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Candidate */}
      <div
        role="tabpanel"
        id="inspection-panel-candidate"
        aria-labelledby="inspection-tab-candidate"
        tabIndex={0}
        className={styles.tabPanel}
        hidden={activeTab !== 'candidate'}
      >
        {candidates.length === 0 ? (
          <EmptyBlock
            title="暂无候选"
            hint="内核尚未签发 Candidate；候选由确定性规则产生（authority=none），仅作提示，不作任何决定。"
          />
        ) : (
          <ul className={styles.cardList}>
            {candidates.map((candidate) => {
              const highlighted = Boolean(
                selectedWorkItemId && candidate.workItemId && candidate.workItemId === selectedWorkItemId,
              );
              return (
                <li
                  key={candidate.candidateId}
                  className={highlighted ? `${styles.recordCard} ${styles.highlightCard}` : styles.recordCard}
                >
                  <div className={styles.cardHead}>
                    <span className={styles.domainBadge}>{DOMAIN_LABELS[candidate.domain]}</span>
                    <span className={styles.kindBadge}>{CANDIDATE_KIND_LABELS[candidate.kind]}</span>
                    {highlighted ? <span className={styles.highlightMark}>关联当前选中事项</span> : null}
                  </div>
                  <p className={styles.summaryText}>{candidate.summary}</p>
                  <div className={styles.basisBlock}>
                    <span className={styles.basisLabel}>依据</span>
                    <ol className={styles.basisList}>
                      {candidate.basis.map((line, index) => (
                        <li key={`basis-${index}`}>{line}</li>
                      ))}
                    </ol>
                  </div>
                  <div className={styles.cardMeta}>
                    <span className={styles.authorityBadge}>authority=none</span>
                    <span>
                      产生方式 <span className={styles.mono}>{candidate.producedBy}</span>
                    </span>
                    <time dateTime={candidate.createdAt}>{formatTimestamp(candidate.createdAt)}</time>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Receipt */}
      <div
        role="tabpanel"
        id="inspection-panel-receipt"
        aria-labelledby="inspection-tab-receipt"
        tabIndex={0}
        className={styles.tabPanel}
        hidden={activeTab !== 'receipt'}
      >
        {projection.receipts.length === 0 ? (
          <EmptyBlock
            title="暂无 Receipt"
            hint={`「${projection.case.displayName}」还没有签发凭证。Gate 的「退回」不产生 Receipt；只有批准 / 否决会签发。`}
          />
        ) : (
          <ul className={styles.cardList}>
            {projection.receipts.map((receipt) => {
              const gate = gateInfo.get(receipt.gateId);
              const highlighted = Boolean(selectedWorkItemId && gate && gate.workItemId === selectedWorkItemId);
              return (
                <li
                  key={receipt.receiptId}
                  className={highlighted ? `${styles.recordCard} ${styles.highlightCard}` : styles.recordCard}
                >
                  <div className={styles.cardHead}>
                    <span className={`${styles.outcomeBadge} ${OUTCOME_CLASS[receipt.decision.outcome]}`}>
                      {OUTCOME_LABELS[receipt.decision.outcome]}
                    </span>
                    <strong className={styles.cardTitle}>{gate?.title ?? receipt.gateId}</strong>
                    {highlighted ? <span className={styles.highlightMark}>关联当前选中事项</span> : null}
                  </div>
                  <p className={styles.summaryText}>{receipt.decision.reason}</p>
                  <div className={styles.cardMeta}>
                    <span>决定人 {actorName(receipt.decision.actorId)}</span>
                    <time dateTime={receipt.decision.decidedAt}>{formatTimestamp(receipt.decision.decidedAt)}</time>
                    <span className={styles.mono}>{receipt.receiptId}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Event Ledger */}
      <div
        role="tabpanel"
        id="inspection-panel-events"
        aria-labelledby="inspection-tab-events"
        tabIndex={0}
        className={styles.tabPanel}
        hidden={activeTab !== 'events'}
      >
        {ledgerState === 'loading' && (!ledger || ledger.events.length === 0) ? (
          <LoadingBlock label="正在读取事件账本…" />
        ) : null}

        {ledgerState === 'error' && (!ledger || ledger.events.length === 0) ? (
          <ErrorBlock
            code={ledgerErrorCode}
            message={ledgerErrorMessage}
            onRetry={() => void fetchInitial()}
          />
        ) : null}

        {ledger && ledger.events.length > 0 ? (
          <>
            <ol className={styles.ledgerList}>
              {ledger.events.map((event) => (
                <li key={event.seq} className={styles.ledgerRow}>
                  <span className={styles.seqCell}>#{event.seq}</span>
                  <span className={styles.typeCell}>
                    <span className={styles.typeLabel}>{EVENT_TYPE_LABELS[event.payload.type]}</span>
                    <span className={styles.typeRaw}>{event.payload.type}</span>
                  </span>
                  <span className={styles.actorCell}>{actorName(event.actor)}</span>
                  <time className={styles.timeCell} dateTime={event.at}>
                    {formatTimestamp(event.at)}
                  </time>
                </li>
              ))}
            </ol>
            <div className={styles.ledgerFoot}>
              <span className={styles.ledgerCount}>
                已加载 {ledger.events.length} / 共 {projection.eventCount} 条
              </span>
              {ledger.hasMore ? (
                <button
                  type="button"
                  className={styles.smallButton}
                  onClick={() => void loadMore()}
                  disabled={loadingMore || ledgerState === 'loading'}
                >
                  {loadingMore ? '正在加载…' : '加载更多'}
                </button>
              ) : null}
              <button
                type="button"
                className={styles.smallButton}
                onClick={() => void fetchInitial()}
                disabled={ledgerState === 'loading'}
              >
                从头重新加载
              </button>
            </div>
            {ledgerState === 'error' ? (
              <ErrorBlock code={ledgerErrorCode} message={ledgerErrorMessage} onRetry={retryLedger} />
            ) : null}
          </>
        ) : null}

        {ledger && ledger.events.length === 0 && ledgerState === 'ready' ? (
          <EmptyBlock title="账本暂无事件" hint={`「${projection.case.displayName}」还没有任何事件记录。`} />
        ) : null}
      </div>

      {/* Contribution：只读呈现 */}
      <section className={styles.contributionSection} aria-label="贡献记录">
        <h3 className={styles.sectionTitle}>贡献记录</h3>
        <p className={styles.sectionNote}>贡献保留记录，非绩效排名；Gate 被否决时，人的既有工作价值不归零。</p>
        {contributions.length === 0 ? (
          <EmptyBlock title="暂无贡献记录" hint="事项完成并提交后，会在这里留下可审计的贡献记录。" />
        ) : (
          <ul className={styles.cardList}>
            {contributions.map((contribution) => {
              const highlighted = Boolean(selectedWorkItemId && contribution.workItemId === selectedWorkItemId);
              return (
                <li
                  key={contribution.contributionId}
                  className={highlighted ? `${styles.recordCard} ${styles.highlightCard}` : styles.recordCard}
                >
                  <div className={styles.cardHead}>
                    <span className={styles.domainBadge}>{DOMAIN_LABELS[contribution.domain]}</span>
                    <span className={styles.kindBadge}>{CONTRIBUTION_KIND_LABELS[contribution.kind]}</span>
                    <span className={styles.retainedBadge}>否决后保留</span>
                    {highlighted ? <span className={styles.highlightMark}>关联当前选中事项</span> : null}
                  </div>
                  <p className={styles.summaryText}>{contribution.summary}</p>
                  <div className={styles.cardMeta}>
                    <span>贡献人 {actorName(contribution.actorId)}</span>
                    <span>
                      事项 <span className={styles.mono}>{contribution.workItemId}</span>
                    </span>
                    <time dateTime={contribution.recordedAt}>{formatTimestamp(contribution.recordedAt)}</time>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}
