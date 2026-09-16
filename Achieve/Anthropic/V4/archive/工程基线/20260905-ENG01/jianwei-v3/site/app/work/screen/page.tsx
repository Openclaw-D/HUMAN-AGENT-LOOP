'use client';

// /work/screen —— canonical 大屏镜像页（P5，比赛 3m×6m 大屏用，2026-09-04）
// 单一画面独立讲清「全周期、当前 Actor、风险、路由、Gate 与 Receipt」。
// 数据边界与 /work 一致：canonical state 只来自服务端 Projection（GET /api/v4life/cases/:caseId），
// 本页为纯 client 只读镜像：EventSource 订阅事件账本 SSE（每帧触发一次 500ms 节流的
// Projection 重取），不发送任何命令、不持有第二份业务状态、不虚构数据。
// 说明：本页是纯 client 页面，route segment 缓存配置与服务端 fetch 缓存语义均不适用；
// Projection API 响应自身已携带不缓存响应头，浏览器不会缓存权威状态。
// 权威边界：Agent/模型 authority=none；open Gate 一律显示为「等待 <角色> 决定」。
// v2（2026-09-04）：追加 Evidence 五类核验状态视图、Risk Thread 面板与 Context 版本徽章。
// v2 渐进契约：evidence/context/riskThreads 与核验新字段全部按可选处理，后端未落时
// 对应面板降级为「暂无数据」、Context 徽章不渲染；字段到达即渲染，不报错、不白屏、不伪造数据。

import * as React from 'react';

import styles from './screen.module.css';

// ---------------------------------------------------------------------------
// 本页局部结构类型（只描述画面所需字段的形状；不 import 内核与引擎模块）
// ---------------------------------------------------------------------------

type ScreenDomain = 'policy' | 'credit' | 'commerce' | 'asset';

type ScreenWorkItemStatus =
  | 'blocked'
  | 'in_progress'
  | 'awaiting_gate'
  | 'completed'
  | 'stopped_dependency';

type ScreenActorRole = 'business' | 'policy' | 'credit' | 'commerce' | 'asset' | 'system';

interface ScreenWorkItem {
  workItemId: string;
  domain: ScreenDomain;
  title: string;
  status: ScreenWorkItemStatus;
  assignedRole: ScreenActorRole;
}

interface ScreenGate {
  gateId: string;
  domain: ScreenDomain;
  title: string;
  requiredRole: ScreenActorRole;
  workItemId: string;
  status: 'pending' | 'open' | 'decided';
}

interface ScreenReceipt {
  receiptId: string;
  gateId: string;
  decision: {
    outcome: 'approved' | 'rejected' | 'returned';
    actorId: string;
    decidedAt: string;
  };
}

// —— v2 渐进契约（后端并行 lane 落地中；字段名冻结，全部按可选处理以优雅降级）——

type ScreenVerificationStatus = 'claimed' | 'unverified' | 'verified' | 'contradicted' | 'stale';

type ScreenSourceType =
  | 'business_statement'
  | 'original_document'
  | 'existing_system'
  | 'authorized_external'
  | 'human_review'
  | 'model_derived';

type ScreenContextStatus = 'OPEN' | 'STABILIZING' | 'SEALED';

interface ScreenEvidence {
  evidenceId: string;
  title?: string;
  sourceType?: ScreenSourceType;
  /** 缺省按 'claimed' 显示 */
  verificationStatus?: ScreenVerificationStatus;
}

interface ScreenContext {
  major: number;
  minor: number;
  status: ScreenContextStatus;
}

interface ScreenRiskThread {
  riskThreadKey: string;
  evidenceIds?: string[];
  workItemIds?: string[];
  gateIds?: string[];
  lastSeq?: number;
}

interface ScreenProjection {
  case: {
    caseId: string;
    displayName: string;
    disclaimer: string;
    financingAmountCny: number;
  };
  actors: Array<{ actorId: string; role: ScreenActorRole; displayName: string }>;
  rev: number;
  domains: Array<{
    domain: ScreenDomain;
    workItems: ScreenWorkItem[];
    gates: ScreenGate[];
  }>;
  openGates: ScreenGate[];
  receipts: ScreenReceipt[];
  contributions: Array<{ contributionId: string; actorId: string; domain: ScreenDomain }>;
  evidenceCount: number;
  eventCount: number;
  /** v2 渐进字段：缺失时核验视图 / Context 徽章 / Risk Thread 面板分别降级 */
  evidence?: ScreenEvidence[];
  context?: ScreenContext;
  riskThreads?: ScreenRiskThread[];
}

// ---------------------------------------------------------------------------
// 展示常量（固定序 policy → credit → commerce → asset，与四域契约一致）
// ---------------------------------------------------------------------------

const DEFAULT_CASE_ID = 'demo-sme-robot-500w';

/** caseId 基本校验：仅接受安全 URL 片段字符，长度 ≤80；不合法一律回落默认 demo case。 */
const CASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

const DOMAIN_SEQUENCE: readonly ScreenDomain[] = ['policy', 'credit', 'commerce', 'asset'];

const DOMAIN_TITLES: Record<ScreenDomain, string> = {
  policy: '政策',
  credit: '信审',
  commerce: '商务',
  asset: '资产',
};

const ROLE_LABELS: Record<ScreenActorRole, string> = {
  business: '业务',
  policy: '政策',
  credit: '信审',
  commerce: '商务',
  asset: '资产',
  system: '系统',
};

/** 状态文案 + 图形记号（颜色 + 图形 + 文字三通道，10 米观看不单靠颜色）。 */
const STATUS_LABELS: Record<ScreenWorkItemStatus, string> = {
  blocked: '受阻',
  in_progress: '进行中',
  awaiting_gate: '等待人工决定',
  completed: '已完成',
  stopped_dependency: '已停止',
};

const STATUS_GLYPHS: Record<ScreenWorkItemStatus, string> = {
  blocked: '□',
  in_progress: '▶',
  awaiting_gate: '◇',
  completed: '●',
  stopped_dependency: '×',
};

const OUTCOME_LABELS: Record<ScreenReceipt['decision']['outcome'], string> = {
  approved: '批准',
  rejected: '否决',
  returned: '退回',
};

/** v2：核验状态五分类固定序（显示顺序固定，claimed 为缺省显示类别）。 */
const VERIFICATION_SEQUENCE: readonly ScreenVerificationStatus[] = [
  'claimed',
  'unverified',
  'verified',
  'contradicted',
  'stale',
];

const VERIFICATION_LABELS: Record<ScreenVerificationStatus, string> = {
  claimed: '自述',
  unverified: '未核验',
  verified: '已核验',
  contradicted: '矛盾',
  stale: '过期',
};

const SOURCE_TYPE_LABELS: Record<ScreenSourceType, string> = {
  business_statement: '业务陈述',
  original_document: '原始单证',
  existing_system: '既有系统',
  authorized_external: '授权外部',
  human_review: '人工复核',
  model_derived: '模型派生',
};

/** SSE 每帧触发后的 Projection 重取节流窗口（与服务端 500ms 推送轮询同频）。 */
const REFETCH_THROTTLE_MS = 500;

/** Receipt 流水只展示最近 5 条（新→旧）。 */
const RECENT_RECEIPT_LIMIT = 5;

type StreamState = 'connecting' | 'open' | 'reconnecting';

// ---------------------------------------------------------------------------
// 小型纯 helper
// ---------------------------------------------------------------------------

function resolveCaseIdFromQuery(search: string): string {
  const raw = new URLSearchParams(search).get('caseId')?.trim() ?? '';
  return CASE_ID_PATTERN.test(raw) ? raw : DEFAULT_CASE_ID;
}

/** 轻量形状校验：非预期载荷按「等待连接」处理，不渲染半份数据。 */
function isProjectionPayload(value: unknown): value is ScreenProjection {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.rev === 'number' &&
    record.case instanceof Object &&
    Array.isArray(record.actors) &&
    Array.isArray(record.domains) &&
    Array.isArray(record.openGates) &&
    Array.isArray(record.receipts) &&
    Array.isArray(record.contributions) &&
    typeof record.evidenceCount === 'number' &&
    typeof record.eventCount === 'number'
  );
}

function formatClock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('zh-CN', { hour12: false });
}

// ---------------------------------------------------------------------------
// v2 纯 helper：全部容错——新字段缺失/形状不符时回落空集，不抛错
// ---------------------------------------------------------------------------

/** 可选数组字段统一读取：缺失或非数组一律回落空数组（优雅降级）。 */
function readOptionalArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** 缺省/未知 verificationStatus 一律按 'claimed' 显示（契约：缺省按 claimed）。 */
function normalizeVerificationStatus(value: unknown): ScreenVerificationStatus {
  return VERIFICATION_SEQUENCE.includes(value as ScreenVerificationStatus)
    ? (value as ScreenVerificationStatus)
    : 'claimed';
}

interface ScreenVerificationGroup {
  status: ScreenVerificationStatus;
  count: number;
  items: ScreenEvidence[];
}

/** 五分类计数 + 各类下钻列表一次成形（固定序，缺省 claimed 兜底）。 */
function buildVerificationGroups(evidence: ScreenEvidence[]): ScreenVerificationGroup[] {
  const buckets = new Map<ScreenVerificationStatus, ScreenEvidence[]>();
  for (const status of VERIFICATION_SEQUENCE) {
    buckets.set(status, []);
  }
  for (const item of evidence) {
    buckets.get(normalizeVerificationStatus(item.verificationStatus))?.push(item);
  }
  return VERIFICATION_SEQUENCE.map((status) => {
    const items = buckets.get(status) ?? [];
    return { status, count: items.length, items };
  });
}

/** sourceType → 中文小标；未知/缺失返回 null（不渲染标签）。 */
function sourceTypeLabel(value: unknown): string | null {
  if (typeof value !== 'string' || !(value in SOURCE_TYPE_LABELS)) {
    return null;
  }
  return SOURCE_TYPE_LABELS[value as ScreenSourceType];
}

/** Context 轻量形状校验：不完整/缺失一律视为无 Context（徽章不渲染）。 */
function isValidContext(value: unknown): value is ScreenContext {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.major === 'number' &&
    typeof record.minor === 'number' &&
    (record.status === 'OPEN' || record.status === 'STABILIZING' || record.status === 'SEALED')
  );
}

// ---------------------------------------------------------------------------
// 画面组件
// ---------------------------------------------------------------------------

export default function ScreenPage() {
  const [projection, setProjection] = React.useState<ScreenProjection | null>(null);
  const [streamState, setStreamState] = React.useState<StreamState>('connecting');
  const [fetchFailed, setFetchFailed] = React.useState(false);

  React.useEffect(() => {
    // caseId 来自 URL query（基本校验，不合法回落默认 demo case）；只在 effect 读取 window，
    // 首帧（服务端 + 客户端水合）完全一致，不产生 hydration 分歧。
    const caseId = resolveCaseIdFromQuery(window.location.search);
    const controller = new AbortController();
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let lastFetchStartedAt = 0;
    let disposed = false;

    const refresh = async (): Promise<void> => {
      lastFetchStartedAt = Date.now();
      try {
        const response = await fetch(`/api/v4life/cases/${encodeURIComponent(caseId)}`, {
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`projection HTTP ${response.status}`);
        }
        const payload: unknown = await response.json();
        if (!isProjectionPayload(payload)) {
          throw new Error('projection payload shape unexpected');
        }
        if (disposed) {
          return;
        }
        setProjection(payload);
        setFetchFailed(false);
      } catch {
        // 失败关闭：保留画面上已有的一份权威数据，只把状态切为「等待连接」，不崩溃、不清空。
        if (disposed || controller.signal.aborted) {
          return;
        }
        setFetchFailed(true);
      }
    };

    /** SSE 每帧都触发重取意图，这里做 500ms 节流合并（心跳注释帧不会触发 message）。 */
    const scheduleThrottledRefresh = (): void => {
      if (refreshTimer !== undefined) {
        return;
      }
      const wait = Math.max(0, REFETCH_THROTTLE_MS - (Date.now() - lastFetchStartedAt));
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        void refresh();
      }, wait);
    };

    void refresh();

    // 事件账本 SSE：断线由 EventSource 原生自动重连，这里不 close、只切换提示。
    const source = new EventSource(`/api/v4life/cases/${encodeURIComponent(caseId)}/events/stream`);
    source.onopen = () => {
      if (!disposed) {
        setStreamState('open');
      }
    };
    source.onmessage = () => {
      if (!disposed) {
        scheduleThrottledRefresh();
      }
    };
    source.onerror = () => {
      if (!disposed) {
        setStreamState('reconnecting');
      }
    };

    return () => {
      disposed = true;
      if (refreshTimer !== undefined) {
        clearTimeout(refreshTimer);
      }
      controller.abort();
      source.close();
    };
  }, []);

  const waiting = projection === null || fetchFailed;
  const connectionLabel = waiting
    ? '等待连接'
    : streamState === 'open'
      ? '实时同步'
      : '自动重连中';

  if (projection === null) {
    // 首载 / 数据未到达：大字「等待连接」，不崩溃、不伪造数据。
    return (
      <main className={styles.screen} aria-busy="true" aria-live="polite">
        <h1 className={styles.waitingTitle}>等待连接</h1>
        <p className={styles.waitingNote}>正在读取 canonical Projection · 合成演示，非真实客户</p>
      </main>
    );
  }

  const caseMeta = projection.case;
  const actorByRole = new Map(
    projection.actors.map((actor) => [actor.role, actor.displayName] as const),
  );
  const recentReceipts = projection.receipts.slice(-RECENT_RECEIPT_LIMIT).reverse();
  const contributionCount = projection.contributions.length;

  // v2 渐进字段派生：缺失/形状不符一律回落空集或 null，对应面板降级，不报错。
  const evidenceItems = readOptionalArray<ScreenEvidence>(projection.evidence).filter(
    (item) => typeof item?.evidenceId === 'string' && item.evidenceId.length > 0,
  );
  const verificationGroups = buildVerificationGroups(evidenceItems);
  const riskThreads = readOptionalArray<ScreenRiskThread>(projection.riskThreads).filter(
    (thread) => typeof thread?.riskThreadKey === 'string' && thread.riskThreadKey.length > 0,
  );
  const contextMeta = isValidContext(projection.context) ? projection.context : null;

  return (
    <main className={styles.screen}>
      {/* 顶部：案例名 + rev + 免责声明小字 */}
      <header className={styles.header}>
        <div className={styles.headerRow}>
          <h1 className={styles.caseName}>{caseMeta.displayName}</h1>
          <span className={styles.revBadge}>rev {projection.rev}</span>
          <span className={styles.connBadge} data-state={waiting ? 'waiting' : streamState}>
            {connectionLabel}
          </span>
          {contextMeta !== null && (
            <span className={styles.contextBadge} data-context-status={contextMeta.status}>
              Context v{contextMeta.major}.{contextMeta.minor} · {contextMeta.status}
            </span>
          )}
        </div>
        <p className={styles.headerMeta}>
          拟融资金额 ¥{caseMeta.financingAmountCny.toLocaleString('zh-CN')} · 材料{' '}
          {projection.evidenceCount} · 事件 {projection.eventCount} · 贡献 {contributionCount}
        </p>
        <p className={styles.disclaimer}>合成演示 · {caseMeta.disclaimer}</p>
      </header>

      <div className={styles.body}>
        {/* 主体：四域泳道（全周期路由：每个 WorkItem 的标题 + 状态） */}
        <div className={styles.lanes} aria-label="四域工作项泳道">
          {DOMAIN_SEQUENCE.map((domain) => {
            const bucket =
              projection.domains.find((entry) => entry.domain === domain) ?? {
                domain,
                workItems: [],
                gates: [],
              };
            return (
              <section key={domain} className={styles.lane} data-domain={domain}>
                <header className={styles.laneHead}>
                  <span className={styles.laneTitle}>{DOMAIN_TITLES[domain]}</span>
                  <span className={styles.laneActor}>
                    {actorByRole.get(domain) ?? '—'}
                  </span>
                </header>
                <ul className={styles.itemList}>
                  {bucket.workItems.map((item) => (
                    <li
                      key={item.workItemId}
                      className={
                        item.status === 'awaiting_gate' ? styles.itemAwaitingGate : styles.item
                      }
                      data-status={item.status}
                    >
                      <span className={styles.itemGlyph} aria-hidden="true">
                        {STATUS_GLYPHS[item.status]}
                      </span>
                      <span className={styles.itemTitle}>{item.title}</span>
                      <span className={styles.itemStatus}>{STATUS_LABELS[item.status]}</span>
                    </li>
                  ))}
                  {bucket.workItems.length === 0 && (
                    <li className={styles.itemEmpty}>本域暂无工作项</li>
                  )}
                </ul>
              </section>
            );
          })}
        </div>

        {/* 侧栏：待决 Gate（大字高亮）+ 最近 Receipt 流水 */}
        <aside className={styles.sidebar}>
          <section className={styles.gateZone} aria-label="待决 Gate">
            <h2 className={styles.zoneTitle}>待决 Gate</h2>
            {projection.openGates.length === 0 ? (
              <p className={styles.zoneEmpty}>当前没有等待人工决定的 Gate</p>
            ) : (
              projection.openGates.map((gate) => (
                <div key={gate.gateId} className={styles.gateCard}>
                  <span className={styles.gateName}>
                    {gate.title}（{gate.gateId}）
                  </span>
                  <strong className={styles.gateWait}>
                    等待 {ROLE_LABELS[gate.requiredRole]} 决定
                  </strong>
                </div>
              ))
            )}
          </section>

          <section className={styles.receiptZone} aria-label="最近 Receipt 流水">
            <h2 className={styles.zoneTitle}>Receipt 流水（最近）</h2>
            {recentReceipts.length === 0 ? (
              <p className={styles.zoneEmpty}>暂无已生成凭证</p>
            ) : (
              recentReceipts.map((receipt) => (
                <div key={receipt.receiptId} className={styles.receiptRow}>
                  <span className={styles.receiptGate}>{receipt.gateId}</span>
                  <span className={styles.receiptOutcome} data-outcome={receipt.decision.outcome}>
                    {OUTCOME_LABELS[receipt.decision.outcome]}
                  </span>
                  <span className={styles.receiptTime}>
                    {formatClock(receipt.decision.decidedAt)}
                  </span>
                </div>
              ))
            )}
          </section>

          <section className={styles.contribZone} aria-label="贡献计数">
            <span className={styles.contribNumber}>{contributionCount}</span>
            <span className={styles.contribLabel}>条已保留贡献 · 材料 {projection.evidenceCount} 份</span>
          </section>
        </aside>
      </div>

      {/* v2 下排：Evidence 五类核验状态视图 + Risk Thread 面板（缺失降级「暂无数据」） */}
      <div className={styles.lower}>
        <section className={styles.verifyZone} aria-label="材料核验状态">
          <h2 className={styles.zoneTitle}>材料核验状态</h2>
          {evidenceItems.length === 0 ? (
            <p className={styles.zoneEmpty}>暂无数据</p>
          ) : (
            <div className={styles.verifyGrid}>
              {verificationGroups.map((group) => (
                <div
                  key={group.status}
                  className={styles.verifyGroup}
                  data-verification={group.status}
                >
                  <span className={styles.verifyNumber}>{group.count}</span>
                  <span className={styles.verifyLabel}>{VERIFICATION_LABELS[group.status]}</span>
                  {group.items.length === 0 ? (
                    <span className={styles.verifyNone}>无</span>
                  ) : (
                    <ul className={styles.verifyList}>
                      {group.items.map((item) => {
                        const source = sourceTypeLabel(item.sourceType);
                        return (
                          <li key={item.evidenceId} className={styles.verifyItem}>
                            <span className={styles.verifyItemId}>{item.evidenceId}</span>
                            <span className={styles.verifyItemTitle}>
                              {item.title ?? item.evidenceId}
                            </span>
                            {source !== null && (
                              <span className={styles.verifySource}>{source}</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={styles.threadZone} aria-label="Risk Thread 风险线索">
          <h2 className={styles.zoneTitle}>Risk Thread 风险线索</h2>
          {riskThreads.length === 0 ? (
            <p className={styles.zoneEmpty}>暂无数据</p>
          ) : (
            <ul className={styles.threadList}>
              {riskThreads.map((thread) => (
                <li key={thread.riskThreadKey} className={styles.threadRow}>
                  <span className={styles.threadGlyph} aria-hidden="true">
                    ◆
                  </span>
                  <span className={styles.threadKey}>{thread.riskThreadKey}</span>
                  <span className={styles.threadMeta}>
                    材料 {thread.evidenceIds?.length ?? 0} · 工作项{' '}
                    {thread.workItemIds?.length ?? 0} · Gate {thread.gateIds?.length ?? 0}
                  </span>
                  <span className={styles.threadSeq}>seq {thread.lastSeq ?? '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
