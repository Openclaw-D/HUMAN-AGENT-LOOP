// V6 REPAIR evening（A）· 共享事实层：固定演示与远程尽调共用同一演示项目事实。
// 契约：REPAIR_20260914_EVENING/main/INTERFACE.md v1。
// 设计要点（对齐 COMMON §状态）：
//  - 多存储保留（rows-store + remote-store），事实源分工：会话/证据/复核事实源 = remote-store；
//    rows-store 的投影（域标记/待办标记/消息）是派生视图，**可随时从 remote 记录重算重建**。
//  - 两次独立写不冒充事务：remote 先写、rows 后写；中断后原样重放（确定性 ID + 既有幂等表）或重算自愈。
//  - 投影不递增 overview.version（派生视图，非业务写入）；remoteVersion 语义不变（演示确定性写入 +1）。
//  - 全同步读改写（无 await 穿插），与既有 store 纪律一致；失败关闭：存储损坏按各自错误码上抛，
//    共享层不静默重置（GET 侧投影降级为只读 + sharedWarning，不阻塞首页浏览）。
// 模型 authority=none：本层只投影人工/演示控制动作，不产生任何"模型判断"结论。

import { createHash } from 'node:crypto';
import type { DomainId, OverviewMessage, ProjectOverview, TodoItem, WriteResponse } from './shared-types.ts';
import { readV5StoreState, writeV5StoreState, V5IdempotencyTable, type V5StoreState } from './store.ts';
import { readRemoteStoreState, persistRemoteStoreState, type RemoteStoreState } from './remote-store.ts';
import { createSeedOverview, deriveOverallDescription } from './service.ts';
import { DEMO_SESSION_ID, buildDemoSessionRecord, FIXTURES, renderFixtureSvg } from './remote-service.ts';
import { DEMO_STORY_START_STEP_ID } from './demo-story-data.ts';
import type { EvidenceRecord, ReviewRecord } from './remote-types.ts';

// ---------------------------------------------------------------------------
// 冻结映射（INTERFACE §1）
// ---------------------------------------------------------------------------

/** fixture → 受影响四域（政策域本轮无 fixture 挂点）。 */
const FIXTURE_DOMAIN: Record<string, DomainId> = {
  'fixture-inspection': 'asset',
  'fixture-equipment': 'credit',
  'fixture-contract': 'commerce',
};

export const DOMAIN_REVIEW_MARK = '证据纠正待复核';
export const TODO_REVIEW_MARK = '远程证据纠正待人工复核';

const CONTESTING_ACTIONS: readonly string[] = ['correct', 'request_resupply', 'request_retake', 'escalate_human'];
const ACTION_LABEL: Record<string, string> = {
  correct: '纠正',
  request_resupply: '要求补充',
  request_retake: '要求重拍',
  escalate_human: '转人工',
  confirm: '确认通过',
};

const DOMAIN_NAME: Record<DomainId, string> = { policy: '政策', credit: '信审', commerce: '商务', asset: '资产' };

// ---------------------------------------------------------------------------
// 事实计算（纯函数：remote 记录 → 共享事实视图）
// ---------------------------------------------------------------------------

export interface SharedFact {
  fixtureId: string;
  domain: DomainId;
  chainVersion: number;
  status: 'unverified' | 'human_verified' | 'contested';
  title: string;
  evidenceId: string;
}

export interface PendingReviewFact {
  fixtureId: string;
  domain: DomainId;
  reason: string;
  at: string;
}

export interface SharedFacts {
  demoSessionId: string;
  sessionStatus: string;
  facts: SharedFact[];
  pendingReview: PendingReviewFact[];
  evidenceCount: number;
  reviewCount: number;
}

interface ChainView {
  fixtureId: string;
  records: EvidenceRecord[];
  latest: EvidenceRecord;
  chainVersion: number;
}

function sessionEvidence(state: RemoteStoreState, sessionId: string): EvidenceRecord[] {
  return state.evidence.filter((e) => e.sessionId === sessionId);
}

/** 按 fixture 聚合取代链（root = supersedes 缺省；链深 = 第 N 次采集）。 */
function chainViews(evidence: EvidenceRecord[]): ChainView[] {
  const byFixture = new Map<string, EvidenceRecord[]>();
  for (const e of evidence) {
    const list = byFixture.get(e.fixtureId) ?? [];
    list.push(e);
    byFixture.set(e.fixtureId, list);
  }
  const views: ChainView[] = [];
  for (const [fixtureId, list] of byFixture) {
    const sorted = [...list].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.evidenceId.localeCompare(b.evidenceId));
    const root = sorted.find((e) => e.supersedes === undefined || e.supersedes === null);
    if (root === undefined) continue;
    // 沿 supersededBy 链走（防环：步数 ≤ 记录数）。
    const chain: EvidenceRecord[] = [root];
    let guard = 0;
    while (guard <= sorted.length) {
      guard += 1;
      const cur = chain[chain.length - 1];
      if (cur.supersededBy === null) break;
      const next = sorted.find((e) => e.evidenceId === cur.supersededBy);
      if (next === undefined || chain.includes(next)) break;
      chain.push(next);
    }
    views.push({ fixtureId, records: chain, latest: chain[chain.length - 1], chainVersion: chain.length });
  }
  return views;
}

function reviewTargetsChain(review: ReviewRecord, chain: ChainView, annotations: { annotationId: string; evidenceId: string }[]): boolean {
  if (review.targetType === 'evidence') {
    return chain.records.some((e) => e.evidenceId === review.targetId);
  }
  const annotation = annotations.find((a) => a.annotationId === review.targetId);
  return annotation !== undefined && chain.records.some((e) => e.evidenceId === annotation.evidenceId);
}

export function computeSharedFacts(state: RemoteStoreState, sessionId: string): SharedFacts | null {
  const session = state.sessions.find((s) => s.sessionId === sessionId);
  if (session === undefined) return null;
  const evidence = sessionEvidence(state, sessionId);
  const annotations = state.annotations.filter((a) => a.sessionId === sessionId);
  const reviews = state.reviews.filter((r) => r.sessionId === sessionId)
    // 与 remote-service evidenceVerificationStatus 同语义：按时间排序，同刻保持插入序（stable sort）。
    .sort((a, b) => a.at.localeCompare(b.at));
  const views = chainViews(evidence);
  const facts: SharedFact[] = views.map((chain) => {
    const relevant = reviews.filter((r) => reviewTargetsChain(r, chain, annotations));
    const last = relevant[relevant.length - 1];
    let status: SharedFact['status'] = 'unverified';
    if (last !== undefined) {
      if (last.action === 'confirm') status = 'human_verified';
      else if (CONTESTING_ACTIONS.includes(last.action)) status = 'contested';
    }
    return {
      fixtureId: chain.fixtureId,
      domain: FIXTURE_DOMAIN[chain.fixtureId] ?? 'asset',
      chainVersion: chain.chainVersion,
      status,
      title: chain.latest.title,
      evidenceId: chain.latest.evidenceId,
    };
  });
  const pendingReview: PendingReviewFact[] = [];
  for (const fact of facts) {
    if (fact.status !== 'contested') continue;
    const chain = views.find((c) => c.fixtureId === fact.fixtureId);
    if (chain === undefined) continue;
    const relevant = reviews.filter((r) => reviewTargetsChain(r, chain, annotations) && CONTESTING_ACTIONS.includes(r.action));
    const last = relevant[relevant.length - 1];
    if (last === undefined) continue;
    pendingReview.push({ fixtureId: fact.fixtureId, domain: fact.domain, reason: last.action, at: last.at });
  }
  return {
    demoSessionId: sessionId,
    sessionStatus: session.status,
    facts,
    pendingReview,
    evidenceCount: evidence.length,
    reviewCount: reviews.length,
  };
}

// ---------------------------------------------------------------------------
// 投影应用（rows overview ← 共享事实）：确定性、幂等，可从 remote 重算重建
// ---------------------------------------------------------------------------

function projectedMessages(state: RemoteStoreState, sessionId: string): OverviewMessage[] {
  const at = new Date().toISOString();
  const marks = ['共享尽调'];
  const out: OverviewMessage[] = [];
  const evidence = sessionEvidence(state, sessionId);
  const views = chainViews(evidence);
  for (const e of evidence) {
    const view = views.find((v) => v.records.some((r) => r.evidenceId === e.evidenceId));
    const ordinal = view !== undefined ? view.records.indexOf(e) + 1 : 1;
    const domain = FIXTURE_DOMAIN[e.fixtureId] ?? 'asset';
    out.push({
      id: `msg-shared-ev-${e.evidenceId}`,
      fromKind: 'system',
      fromName: '系统',
      text: `共享尽调 · ${DOMAIN_NAME[domain]}域：现场证据「${e.title}」已挂接（第 ${ordinal} 次采集），待人工复核。`,
      at,
      marks,
    });
  }
  for (const r of state.reviews.filter((x) => x.sessionId === sessionId)) {
    const label = ACTION_LABEL[r.action] ?? r.action;
    if (r.action !== 'confirm' && !CONTESTING_ACTIONS.includes(r.action)) continue; // 会话级暂停/恢复不投影为域消息。
    const targetTitle = reviewTargetTitle(state, r);
    out.push({
      id: `msg-shared-rev-${r.reviewId}`,
      fromKind: 'system',
      fromName: '系统',
      text:
        r.action === 'confirm'
          ? `共享尽调 · 人工复核：证据「${targetTitle}」确认通过（人工动作，合成演示）。`
          : `共享尽调 · 人工复核：证据「${targetTitle}」被人工「${label}」，旧结论转入待复核（人工动作，合成演示）。`,
      at,
      marks,
    });
  }
  return out;
}

function reviewTargetTitle(state: RemoteStoreState, review: ReviewRecord): string {
  if (review.targetType === 'evidence') {
    return state.evidence.find((e) => e.evidenceId === review.targetId)?.title ?? review.targetId;
  }
  const annotation = state.annotations.find((a) => a.annotationId === review.targetId);
  const evidence = annotation !== undefined ? state.evidence.find((e) => e.evidenceId === annotation.evidenceId) : undefined;
  return evidence?.title ?? review.targetId;
}

/** 把共享事实投影到 overview（不递增版本；返回原对象=无变化）。幂等：重复应用结果一致。 */
export function applySharedFacts(overview: ProjectOverview, facts: SharedFacts, remoteState: RemoteStoreState): ProjectOverview {
  const contestedDomains = new Set<DomainId>(facts.pendingReview.map((p) => p.domain));
  let changed = false;

  const domains = overview.domains.map((d) => {
    if (contestedDomains.has(d.domainId)) {
      if (!d.judgmentText.includes(DOMAIN_REVIEW_MARK)) {
        changed = true;
        return { ...d, judgmentText: `${d.judgmentText}；${DOMAIN_REVIEW_MARK}` };
      }
    } else if (d.judgmentText.includes(DOMAIN_REVIEW_MARK)) {
      // 争议闭合（最新动作=confirm）→ 标记消失；投影永不改判断灯颜色（人工门）。
      changed = true;
      return { ...d, judgmentText: d.judgmentText.split(`；${DOMAIN_REVIEW_MARK}`).join('') };
    }
    return d;
  });

  let todo: TodoItem | null = overview.todo;
  if (todo !== null && todo.relatedDomain !== null) {
    const contested = contestedDomains.has(todo.relatedDomain);
    if (contested && !todo.detail.includes(TODO_REVIEW_MARK)) {
      todo = { ...todo, detail: `${todo.detail}；${TODO_REVIEW_MARK}` };
      changed = true;
    } else if (!contested && todo.detail.includes(TODO_REVIEW_MARK)) {
      todo = { ...todo, detail: todo.detail.split(`；${TODO_REVIEW_MARK}`).join('') };
      changed = true;
    }
  }

  const existing = new Set(overview.messages.map((m) => m.id));
  const fresh = projectedMessages(remoteState, facts.demoSessionId).filter((m) => !existing.has(m.id));
  const messages = fresh.length > 0 ? [...overview.messages, ...fresh] : overview.messages;
  if (fresh.length > 0) changed = true;

  if (!changed) return overview;
  return {
    ...overview,
    domains,
    todo,
    messages,
    overall: { ...overview.overall, description: deriveOverallDescription(domains) },
  };
}

// ---------------------------------------------------------------------------
// 专属演示会话（懒建）与投影同步入口
// ---------------------------------------------------------------------------

/** 读取 rows 状态并确保专属演示会话存在（remote 建会话 + rows 指针回填，各落盘一次）。
 *  remote 存储损坏/不可用 → 上抛（调用方决定降级）。 */
function ensureDemoSessionRows(rows: V5StoreState): V5StoreState {
  const remote = readRemoteStoreState();
  let sessionId = rows.sharedDemo.sessionId;
  if (sessionId === null || !remote.sessions.some((s) => s.sessionId === sessionId)) {
    // 指针为空或指向已消失的会话（重开清除后/外部删除）→ 重建固定专属会话（幂等：已存在即复用）。
    if (!remote.sessions.some((s) => s.sessionId === DEMO_SESSION_ID)) {
      const now = new Date().toISOString();
      remote.sessions.push(buildDemoSessionRecord(DEMO_SESSION_ID, now));
      remote.version += 1;
      persistRemoteStoreState(remote);
    }
    sessionId = DEMO_SESSION_ID;
    const nextRows: V5StoreState = { ...rows, sharedDemo: { sessionId } };
    writeV5StoreState(nextRows);
    return nextRows;
  }
  return rows;
}

export interface SyncResult {
  rows: V5StoreState;
  degraded: string | null;
}

/** 共享投影同步：ensure 会话 → 计算事实 → 应用到 rows（有变化才落盘）。
 *  remote 不可用时降级：返回 degraded 原因，rows 原样返回（首页只读浏览不被阻塞）。 */
export function syncSharedProjection(): SyncResult {
  let rows = readV5StoreState({ seed: () => createSeedOverview('approval') });
  try {
    rows = ensureDemoSessionRows(rows);
    const sessionId = rows.sharedDemo.sessionId;
    if (sessionId === null) return { rows, degraded: null };
    const remote = readRemoteStoreState();
    const facts = computeSharedFacts(remote, sessionId);
    if (facts === null) return { rows, degraded: null };
    const projected = applySharedFacts(rows.overview, facts, remote);
    if (projected !== rows.overview) {
      const nextRows: V5StoreState = { ...rows, overview: projected };
      writeV5StoreState(nextRows);
      return { rows: nextRows, degraded: null };
    }
    return { rows, degraded: null };
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { rows, degraded: `远程尽调数据暂不可用：共享尽调事实未同步（${detail}）` };
  }
}

/** 共享事实只读出口（INTERFACE §3）。remote 存储不可用时诚实降级（空事实 + sharedWarning）。 */
export function getSharedFactsView(): Record<string, unknown> {
  const sync = syncSharedProjection();
  const sessionId = sync.rows.sharedDemo.sessionId;
  const warning = sync.degraded;
  if (sessionId !== null && warning === null) {
    try {
      const remote = readRemoteStoreState();
      const facts = computeSharedFacts(remote, sessionId);
      if (facts !== null) {
        return { ok: true, ...facts };
      }
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      return emptySharedView(`远程尽调数据暂不可用：共享尽调事实未同步（${detail}）`);
    }
  }
  return emptySharedView(warning);
}

function emptySharedView(warning: string | null): Record<string, unknown> {
  return {
    ok: true,
    projectId: 'JW-2026-018',
    demoSessionId: null,
    sessionStatus: null,
    facts: [],
    pendingReview: [],
    evidenceCount: 0,
    reviewCount: 0,
    ...(warning !== null ? { sharedWarning: warning } : {}),
  };
}

// ---------------------------------------------------------------------------
// 演示确定性写入（固定演示经同一命令区写真实证据/复核；INTERFACE §4）
// ---------------------------------------------------------------------------

export type StoryFactOp =
  | { kind: 'attach'; stepToken: string; fixtureId: string }
  | { kind: 'supersede-root'; stepToken: string; fixtureId: string }
  | { kind: 'correct'; stepToken: string; fixtureId: string };

/** 幂等执行演示事实写入：确定性 ID 已存在即跳过（重放/重试安全）。session 必须已 ensure。 */
export function applyStoryFactOps(sessionId: string, ops: readonly StoryFactOp[]): void {
  if (ops.length === 0) return;
  const state = readRemoteStoreState();
  let changed = false;
  const now = new Date().toISOString();
  const sessionProjectId = state.sessions.find((s) => s.sessionId === sessionId)?.projectId ?? 'JW-2026-018';
  for (const op of ops) {
    if (op.kind === 'attach' || op.kind === 'supersede-root') {
      const evidenceId = `ev-demo-${op.stepToken}-${sessionId}`;
      if (state.evidence.some((e) => e.evidenceId === evidenceId)) continue;
      const fixture = FIXTURES.find((f) => f.fixtureId === op.fixtureId);
      if (fixture === undefined) continue;
      const sha256 = createHash('sha256').update(renderFixtureSvg(op.fixtureId) ?? '', 'utf8').digest('hex');
      if (op.kind === 'attach') {
        state.evidence.push({
          evidenceId,
          projectId: sessionProjectId,
          sessionId,
          fixtureId: op.fixtureId,
          title: fixture.title,
          sourceType: 'simulation_fixture',
          capturedAt: now,
          receivedAt: now,
          mime: 'image/svg+xml',
          width: fixture.width,
          height: fixture.height,
          sha256,
          version: 1,
          supersededBy: null,
          digestOf: 'fixture_bytes',
        });
        changed = true;
      } else {
        // supersede-root：现场补充 = 同一链升版（root 未被取代时才执行；已被取代说明链上已有更新版本，跳过）。
        const root = state.evidence
          .filter((e) => e.sessionId === sessionId && e.fixtureId === op.fixtureId && (e.supersedes === undefined || e.supersedes === null))
          .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))[0];
        if (root === undefined || root.supersededBy !== null) continue;
        root.supersededBy = evidenceId;
        state.evidence.push({
          evidenceId,
          projectId: sessionProjectId,
          sessionId,
          fixtureId: op.fixtureId,
          title: `${fixture.title}（现场补充，取代 ${root.evidenceId}）`,
          sourceType: 'simulation_fixture',
          capturedAt: now,
          receivedAt: now,
          mime: 'image/svg+xml',
          width: fixture.width,
          height: fixture.height,
          sha256,
          version: 1,
          supersededBy: null,
          supersedes: root.evidenceId,
          digestOf: 'fixture_bytes',
        });
        changed = true;
      }
    } else {
      const reviewId = `rev-demo-${op.stepToken}-${sessionId}`;
      if (state.reviews.some((r) => r.reviewId === reviewId)) continue;
      const latest = state.evidence
        .filter((e) => e.sessionId === sessionId && e.fixtureId === op.fixtureId && e.supersededBy === null)
        .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))[0];
      if (latest === undefined) continue; // 无证据可纠正：诚实跳过（不虚构引用）。
      state.reviews.push({
        reviewId,
        sessionId,
        targetType: 'evidence',
        targetId: latest.evidenceId,
        targetVersion: latest.version,
        action: 'correct',
        opinion: '演示人工纠正：按人工纠正意见更正现场结论（合成演示；模型 authority=none）',
        reviewer: '业务（演示身份）',
        at: now,
      });
      changed = true;
    }
  }
  if (changed) {
    state.version += 1;
    persistRemoteStoreState(state);
  }
}

// ---------------------------------------------------------------------------
// 重开（当前专属演示）：主线回起点 + 清除专属会话数据；其他会话与记录不动（INTERFACE §2）
// ---------------------------------------------------------------------------

export function resetDemoRun(): WriteResponse {
  // 先读 rows：损坏失败关闭（与 seed 同纪律，不静默重置）。
  const rows = readV5StoreState({ seed: () => createSeedOverview('approval') });
  const sessionId = rows.sharedDemo.sessionId ?? DEMO_SESSION_ID;
  // 顺序 = 先清 remote 后重置 rows（非事务，INTERFACE §2）：
  //  - remote 清除失败 → 整体上抛，rows 未动，重试安全（清除幂等：目标不存在 = 无操作）；
  //  - rows 写失败（remote 已清）→ 指针仍指已清会话，下次 ensure 懒建自愈。
  const remote = readRemoteStoreState();
  const hadSession = remote.sessions.some((s) => s.sessionId === sessionId);
  remote.sessions = remote.sessions.filter((s) => s.sessionId !== sessionId);
  remote.evidence = remote.evidence.filter((e) => e.sessionId !== sessionId);
  remote.annotations = remote.annotations.filter((a) => a.sessionId !== sessionId);
  remote.reviews = remote.reviews.filter((r) => r.sessionId !== sessionId);
  remote.calculations = remote.calculations.filter((c) => c.sessionId !== sessionId);
  if (hadSession) {
    remote.version += 1;
    persistRemoteStoreState(remote);
  }
  const fresh = createSeedOverview('approval');
  fresh.version = rows.overview.version + 1;
  fresh.updatedAt = new Date().toISOString();
  writeV5StoreState({
    overview: fresh,
    idempotency: new V5IdempotencyTable(),
    storyCursor: { stepId: DEMO_STORY_START_STEP_ID, updatedAt: fresh.updatedAt },
    sharedDemo: { sessionId: null },
  });
  return { ok: true, overview: fresh };
}
