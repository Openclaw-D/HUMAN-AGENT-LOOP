// 检查会话域（任务一 · 联合尽调）：运行/收口双状态、缺口驱动 nextActions、调度代际与外发授权、
// 暂停/恢复/checkpoint、会后小结与补证接续。契约见 docs/INSPECTION_SESSION_V1.md。
// 复用 v1 机制（幂等表/乐观版本/outbox/audit/客户工件）；不建第二套事实源；
// 检查结束 ≠ 风险解除 ≠ 授信批准：本域不产生任何正式授信语义。
import type { PoolClient } from 'pg';
import { AppError, conflict, forbidden, invalid, notFound } from './errors.ts';
import { canonicalHash, newId, sha256, uuid } from './util.ts';
import { authenticate, authorizeProject, requireAdmin, requireVerified, type Auth } from './principal.ts';
import type { Kernel } from './kernel.ts';

const RUN_STATUSES = ['preparing', 'ready', 'in_progress', 'suspended', 'ended'] as const;
const CLOSURE_STATUSES = ['open', 'pending_evidence', 'pending_review', 'ready_for_assessment', 'closed'] as const;
const ITEM_STATUSES = ['pending', 'waiting_answer', 'answered', 'waiting_evidence', 'to_verify', 'verified', 'conflict', 'deferred', 'stale_review'] as const;
const AUDIENCES = ['customer', 'internal'] as const;
const OUTBOUND_STATUSES = ['authorized', 'sent', 'unknown', 'cancelled', 'cancel_unsupported'] as const;

const DEFAULT_CONFIG = { maxFollowUpsPerQuestion: 2, waitTimeoutSeconds: 300, maxQuestionsPerItem: 8 };
const MAX_ITEMS = 64;
const MAX_PLAN_JSON = 256 << 10; // 计划快照上限（引用 intake/assessment，不内嵌媒体）

interface RequestFrame {
  credential?: unknown;
  requestId?: unknown;
  [k: string]: unknown;
}

type RunStatus = (typeof RUN_STATUSES)[number];
type ClosureStatus = (typeof CLOSURE_STATUSES)[number];
type ItemStatus = (typeof ITEM_STATUSES)[number];

interface SessionRow {
  session_id: string; project_id: string; customer_id: string; tenant_id: string; site_id: string | null; title: string;
  run_status: RunStatus; closure_status: ClosureStatus;
  plan_version: number; scene_version: string; plan_snapshot: Record<string, unknown>; plan_snapshot_hash: string;
  roles: { roleKey: string; kind: 'human' | 'agent' }[]; participants: Record<string, { present: boolean; since: string }>;
  owner_role: string; outbound_paused: boolean; dispatch_generation: number;
  takeover_by: string | null; takeover_at: string | null;
  config: { maxFollowUpsPerQuestion: number; waitTimeoutSeconds: number; maxQuestionsPerItem: number };
  last_event_seq: number; closure_revision: number; version: number;
  created_by: string | null; created_at: string; updated_at: string;
}

interface ItemRow {
  item_id: string; session_id: string; item_key: string; title: string; required: boolean;
  responsible_role: string; target_role: string; requires_human_verification: boolean;
  expected_evidence_kinds: string[]; object_ref: string | null; status: ItemStatus;
  assigned_role: string | null; detail: Record<string, unknown>; anchors: Record<string, unknown>[];
  verified_at: string | null; verified_by: string | null; version: number;
}

interface QuestionRow {
  question_id: string; session_id: string; item_id: string | null; dedup_key: string;
  audience: 'customer' | 'internal'; target_role: string; requires_human: boolean;
  question: string; purpose: string; period: string | null; object_ref: string | null; fact_key: string | null;
  status: 'open' | 'sent' | 'answered' | 'closed'; follow_up_count: number;
  answer: Record<string, unknown> | null; created_by: string | null; created_at: string; answered_at: string | null;
}

interface OutboundRow {
  send_id: string; session_id: string; question_id: string | null; generation: number;
  request_id: string; channel: string; status: (typeof OUTBOUND_STATUSES)[number]; created_at: string; resulted_at: string | null;
}

interface FollowupRow {
  followup_id: string; session_id: string; item_id: string | null; owner_role: string;
  reason: string; next_action: string; closure_revision: number; status: 'open' | 'done';
  created_at: string; closed_at: string | null;
}

// ---------------------------------------------------------------------------
// 校验工具（与 kernel/credit 同风格）
// ---------------------------------------------------------------------------

function reqString(v: unknown, label: string, max = 2000, min = 1): string {
  if (typeof v !== 'string' || v.trim().length < min || v.length > max) throw invalid(`${label} 必须是 ${min}..${max} 长度的 string`);
  return v;
}
function reqInt(v: unknown, label: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw invalid(`${label} 必须是非负整数`);
  return v;
}
function reqObject(v: unknown, label: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw invalid(`${label} 必须是对象`);
  return v as Record<string, unknown>;
}
function reqStringArray(v: unknown, label: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || x.length === 0)) throw invalid(`${label} 必须是非空 string 数组`);
  return v;
}
function reqBool(v: unknown, label: string, fallback: boolean): boolean {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'boolean') throw invalid(`${label} 必须是 boolean`);
  return v;
}
function checkJsonSize(v: unknown, label: string, max: number): void {
  const size = JSON.stringify(v ?? null)?.length ?? 0;
  if (size > max) throw invalid(`${label} 超出 ${max} 字节限额`);
}
function withoutRequestCred(frame: RequestFrame): Record<string, unknown> {
  const { requestId, credential, __path, ...payload } = frame;
  void requestId; void credential; void __path;
  return payload;
}

// ---------------------------------------------------------------------------
// 事务与幂等（v1 全局幂等表：op+resource+payload 进载荷哈希）
// ---------------------------------------------------------------------------

interface IxHelpers {
  audit(entry: { actor: string | null; action: string; targetType: string; targetId: string; projectId: string | null; summary: string; payload?: unknown }): Promise<void>;
  emit(event: { eventType: string; projectId: string; customerId: string; payload: Record<string, unknown> }): Promise<void>;
}

function ixHelpers(tx: PoolClient): IxHelpers {
  return {
    async audit(entry): Promise<void> {
      await tx.query(
        `INSERT INTO audit_events (actor_principal_id, action, target_type, target_id, project_id, summary, payload_sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [entry.actor, entry.action, entry.targetType, entry.targetId, entry.projectId, entry.summary, canonicalHash(entry.payload ?? {})],
      );
    },
    async emit(event): Promise<void> {
      await tx.query(
        `INSERT INTO outbox_events (event_id, event_type, project_id, customer_id, goal_id, payload)
         VALUES ($1,$2,$3,$4,NULL,$5)`,
        [uuid(), event.eventType, event.projectId, event.customerId, JSON.stringify(event.payload)],
      );
    },
  };
}

async function runIxTx(kernel: Kernel, fn: (tx: PoolClient) => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
  const client = await kernel.pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* 连接已断，不掩盖原错误 */ }
    throw error;
  } finally {
    client.release();
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

async function withIxCommand(
  kernel: Kernel, frame: RequestFrame, op: string, resource: Record<string, unknown>,
  fn: (tx: PoolClient, h: IxHelpers, auth: Auth) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const { requestId } = frame;
  if (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 128) {
    throw invalid('requestId 必须是 1..128 长度的 string');
  }
  const payloadHash = canonicalHash({ op, resource, payload: withoutRequestCred(frame) });
  const prior = await kernel.pool.query(`SELECT payload_sha256, response FROM idempotency WHERE request_id = $1`, [requestId]);
  if (prior.rows.length > 0) {
    const row = prior.rows[0] as { payload_sha256: string; response: Record<string, unknown> };
    if (row.payload_sha256 !== payloadHash) throw conflict('REQUEST_MISMATCH', `requestId ${requestId} 已绑定不同载荷（幂等一致性保护）`);
    return { ...row.response, replayed: true };
  }
  try {
    return await runIxTx(kernel, async (tx) => {
      const auth = await kernel.authOf(frame.credential);
      const h = ixHelpers(tx);
      const response = await fn(tx, h, auth);
      await tx.query(`INSERT INTO idempotency (request_id, payload_sha256, response) VALUES ($1,$2,$3)`, [requestId, payloadHash, JSON.stringify(response)]);
      return response;
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (isUniqueViolation(error)) {
      const again = await kernel.pool.query(`SELECT payload_sha256, response FROM idempotency WHERE request_id = $1`, [requestId]);
      if (again.rows.length > 0) {
        const row = again.rows[0] as { payload_sha256: string; response: Record<string, unknown> };
        if (row.payload_sha256 === payloadHash) return { ...row.response, replayed: true };
        throw conflict('REQUEST_MISMATCH', `requestId ${requestId} 已绑定不同载荷（幂等一致性保护）`);
      }
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// 行加载与会话守卫
// ---------------------------------------------------------------------------

async function sessionOr404(tx: PoolClient, sessionId: string, forUpdate = false): Promise<SessionRow> {
  const res = await tx.query(forUpdate ? `SELECT * FROM inspection_sessions WHERE session_id = $1 FOR UPDATE` : `SELECT * FROM inspection_sessions WHERE session_id = $1`, [sessionId]);
  if (res.rows.length === 0) throw notFound('检查会话不存在');
  return res.rows[0] as unknown as SessionRow;
}

async function loadItems(tx: PoolClient, sessionId: string): Promise<ItemRow[]> {
  const res = await tx.query(`SELECT * FROM inspection_items WHERE session_id = $1 ORDER BY created_at`, [sessionId]);
  return res.rows as unknown as ItemRow[];
}

async function loadQuestions(tx: PoolClient, sessionId: string): Promise<QuestionRow[]> {
  const res = await tx.query(`SELECT * FROM inspection_questions WHERE session_id = $1 ORDER BY created_at`, [sessionId]);
  return res.rows as unknown as QuestionRow[];
}

async function loadOutbound(tx: PoolClient, sessionId: string): Promise<OutboundRow[]> {
  const res = await tx.query(`SELECT * FROM inspection_outbound WHERE session_id = $1 ORDER BY created_at`, [sessionId]);
  return res.rows as unknown as OutboundRow[];
}

async function loadFollowups(tx: PoolClient, sessionId: string): Promise<FollowupRow[]> {
  const res = await tx.query(`SELECT * FROM inspection_followups WHERE session_id = $1 ORDER BY created_at`, [sessionId]);
  return res.rows as unknown as FollowupRow[];
}

/** 名册内角色：principal 必须具备该角色且身份种类与名册一致（权限撤销/改派边界都走这里）。 */
function requireRosterRole(auth: Auth, session: SessionRow, role: string): void {
  requireVerified(auth);
  const entry = session.roles.find((r) => r.roleKey === role);
  if (entry === undefined) throw forbidden('ROLE_FORBIDDEN', `角色不在会话名册中：${role}`);
  if (auth.principal.kind !== entry.kind) {
    throw forbidden('ROLE_FORBIDDEN', `角色 ${role} 要求 ${entry.kind} principal（当前 ${auth.principal.kind}）`);
  }
  if (!auth.principal.roles.includes(role)) {
    throw forbidden('ROLE_FORBIDDEN', `principal 缺少角色授权：${role}`);
  }
}

function requireOwner(auth: Auth, session: SessionRow): void {
  requireVerified(auth);
  requireRosterRole(auth, session, session.owner_role);
}

function requireVersion(session: SessionRow, expected: unknown): void {
  const v = reqInt(expected, 'expectedVersion');
  if (v !== session.version) {
    throw conflict('VERSION_CONFLICT', `会话版本已更新：客户端 v${v}，服务端 v${session.version}`, { serverVersion: session.version });
  }
}

function requireRunning(session: SessionRow): void {
  if (session.run_status !== 'in_progress') {
    throw conflict('SESSION_NOT_RUNNING', `会话当前 ${session.run_status}：该命令要求 in_progress`);
  }
}

function requireNotClosed(session: SessionRow): void {
  if (session.closure_status === 'closed') {
    throw conflict('INSPECTION_CLOSED', '会话已收口（closed）：业务写被拒绝');
  }
}

/** 按运行/收口状态推导当前可用动作（服务端真相；actual 权限在每个命令内按名册/owner 校验）。 */
function availableActionsOf(session: SessionRow): string[] {
  if (session.closure_status === 'closed') return ['summary'];
  switch (session.run_status) {
    case 'preparing':
    case 'ready':
      return ['plan', 'scene', 'start'];
    case 'in_progress':
      return ['pause', 'end', 'plan', 'scene', 'question', 'answer', 'verify', 'reassign', 'takeover', 'grant', 'sweep', 'checkpoint'];
    case 'suspended':
      return ['resume', 'end', 'takeover', 'checkpoint'];
    case 'ended':
      return ['close', 'evidence', 'verify', 'sweep', 'summary'];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// 核验项状态推导与收口推导（唯一事实源：items/questions/evidence_artifacts）
// ---------------------------------------------------------------------------

async function currentArtifactKinds(tx: PoolClient, customerId: string): Promise<Set<string>> {
  const res = await tx.query(
    `SELECT kind FROM evidence_artifacts WHERE customer_id = $1 AND superseded_by IS NULL AND duplicate_of IS NULL`,
    [customerId],
  );
  return new Set((res.rows as { kind: string }[]).map((r) => r.kind));
}

/** 写后重算：非终态核验项按 开放问题/已答问题/材料齐备 三事实推导状态。
 *  口述已登记（answered）≠ 材料已取得（waiting_evidence 解除）≠ 事实已核实（to_verify→人工 verify）。 */
async function refreshItems(tx: PoolClient, session: SessionRow, h: IxHelpers, actorLabel: string | null): Promise<string[]> {
  const items = await loadItems(tx, session.session_id);
  const questions = await loadQuestions(tx, session.session_id);
  const kinds = await currentArtifactKinds(tx, session.customer_id);
  const changed: string[] = [];
  for (const it of items) {
    if (['verified', 'conflict', 'deferred', 'stale_review', 'to_verify'].includes(it.status)) continue;
    const openQ = questions.find((q) => q.item_id === it.item_id && (q.status === 'open' || q.status === 'sent'));
    const answeredQ = questions.filter((q) => q.item_id === it.item_id && q.status === 'answered').pop();
    const allPresent = it.expected_evidence_kinds.every((k) => kinds.has(k));
    let next: ItemStatus = it.status;
    if (openQ !== undefined) {
      next = 'waiting_answer';
    } else if (answeredQ !== undefined) {
      if (!allPresent) next = 'waiting_evidence';
      else if (it.requires_human_verification) next = 'to_verify';
      else next = 'verified';
    } else {
      next = 'pending';
    }
    if (next !== it.status) {
      const verifiedFields = next === 'verified' ? `, verified_at = now(), verified_by = $3` : '';
      await tx.query(
        `UPDATE inspection_items SET status = $2, version = version + 1, updated_at = now()${verifiedFields} WHERE item_id = $1`,
        next === 'verified' ? [it.item_id, next, 'system:auto_recompute'] : [it.item_id, next],
      );
      await h.audit({
        actor: actorLabel, action: 'inspection_item_status', targetType: 'inspection_item', targetId: it.item_id,
        projectId: session.project_id, summary: `核验项 ${it.item_key}：${it.status} → ${next}`, payload: { from: it.status, to: next },
      });
      await h.emit({
        eventType: 'INSPECTION_ITEM_STATUS', projectId: session.project_id, customerId: session.customer_id,
        payload: { sessionId: session.session_id, itemId: it.item_id, itemKey: it.item_key, from: it.status, to: next },
      });
      changed.push(it.item_id);
    }
  }
  return changed;
}

/** 收口推导（仅 ended 会话）：conflict/stale_review → pending_review；有未核实必核项 → pending_evidence；
 *  必核项全部 verified → ready_for_assessment（事件只陈述事实，不含"自动批准"）。 */
async function recomputeClosure(tx: PoolClient, session: SessionRow, h: IxHelpers): Promise<ClosureStatus | null> {
  if (session.run_status !== 'ended' || session.closure_status === 'closed') return null;
  const items = await loadItems(tx, session.session_id);
  const required = items.filter((i) => i.required);
  const hasReview = required.some((i) => i.status === 'conflict' || i.status === 'stale_review');
  const hasOpen = required.some((i) => i.status !== 'verified');
  const next: ClosureStatus = hasReview ? 'pending_review' : hasOpen ? 'pending_evidence' : 'ready_for_assessment';
  if (next === session.closure_status) return null;
  await tx.query(
    `UPDATE inspection_sessions SET closure_status = $2, updated_at = now() WHERE session_id = $1`,
    [session.session_id, next],
  );
  await h.audit({
    actor: null, action: 'inspection_closure_status', targetType: 'inspection_session', targetId: session.session_id,
    projectId: session.project_id, summary: `收口状态 ${session.closure_status} → ${next}`, payload: { from: session.closure_status, to: next },
  });
  if (next === 'ready_for_assessment') {
    await h.emit({
      eventType: 'INSPECTION_READY_FOR_ASSESSMENT', projectId: session.project_id, customerId: session.customer_id,
      payload: {
        sessionId: session.session_id, closureRevision: session.closure_revision,
        completedRequiredItems: required.filter((i) => i.status === 'verified').map((i) => i.item_key),
        note: '仅表示必要核验项完成；不构成风险解除或授信批准',
      },
    });
  }
  return next;
}

// ---------------------------------------------------------------------------
// checkpoint（暂停/结束/手动；媒体只存 artifactId 引用）
// ---------------------------------------------------------------------------

async function writeCheckpoint(tx: PoolClient, session: SessionRow, reason: 'pause' | 'end' | 'manual' | 'takeover'): Promise<string> {
  const items = await loadItems(tx, session.session_id);
  const questions = await loadQuestions(tx, session.session_id);
  const outbound = await loadOutbound(tx, session.session_id);
  const followups = await loadFollowups(tx, session.session_id);
  const seq = await tx.query(`SELECT COALESCE(MAX(seq), 0) AS seq FROM outbox_events`);
  const lastEventSeq = Number((seq.rows[0] as { seq: string }).seq);
  const payload = {
    planVersion: session.plan_version,
    sceneVersion: session.scene_version,
    runStatus: session.run_status,
    closureStatus: session.closure_status,
    dispatchGeneration: session.dispatch_generation,
    outboundPaused: session.outbound_paused,
    items: items.map((i) => ({ itemId: i.item_id, itemKey: i.item_key, status: i.status, version: i.version })),
    openQuestions: questions.filter((q) => q.status === 'open' || q.status === 'sent').map((q) => q.question_id),
    inFlight: outbound.filter((o) => ['authorized', 'sent', 'unknown'].includes(o.status)).map((o) => ({ sendId: o.send_id, status: o.status })),
    lastEventSeq,
    followups: followups.filter((f) => f.status === 'open').map((f) => f.followup_id),
  };
  const checkpointId = newId('ck');
  await tx.query(
    `INSERT INTO inspection_checkpoints (checkpoint_id, session_id, reason, payload) VALUES ($1,$2,$3,$4)`,
    [checkpointId, session.session_id, reason, JSON.stringify(payload)],
  );
  await tx.query(`UPDATE inspection_sessions SET last_event_seq = $2 WHERE session_id = $1`, [session.session_id, lastEventSeq]);
  return checkpointId;
}

// ---------------------------------------------------------------------------
// 小结投影（确定性：从真实事项/问题/待办投影；不经过任何模型）
// ---------------------------------------------------------------------------

function projectSummary(
  session: SessionRow, items: ItemRow[], questions: QuestionRow[], followups: FollowupRow[], audience: 'internal' | 'customer',
): Record<string, unknown> {
  const byItem = (itemId: string | null) => questions.filter((q) => q.item_id === itemId);
  const reviewed = items.filter((i) => byItem(i.item_id).length > 0);
  const verified = items.filter((i) => i.status === 'verified');
  const oralOnly = items.filter((i) => i.status === 'answered' || i.status === 'to_verify' || i.status === 'waiting_evidence');
  const unknown = items.filter((i) => ['pending', 'waiting_answer', 'deferred'].includes(i.status));
  const conflicts = items.filter((i) => i.status === 'conflict' || i.status === 'stale_review');
  const openFollowups = followups.filter((f) => f.status === 'open');
  const customerVisible = (itemId: string | null) => byItem(itemId).some((q) => q.audience === 'customer');
  return {
    sessionId: session.session_id,
    closureRevision: session.closure_revision,
    audience,
    basis: 'projection_from_tasks',
    generatedAt: new Date().toISOString(),
    lookedAt: reviewed.map((i) => ({ itemKey: i.item_key, title: i.title })),
    verified: verified.map((i) => ({ itemKey: i.item_key, title: i.title, verifiedBy: i.verified_by, verifiedAt: i.verified_at })),
    oralOnlyNotVerified: oralOnly.map((i) => ({ itemKey: i.item_key, title: i.title, status: i.status })),
    stillUnknown: unknown
      .filter((i) => audience === 'internal' || customerVisible(i.item_id))
      .map((i) => ({ itemKey: i.item_key, title: i.title, status: i.status })),
    unresolvedConflicts: conflicts
      .filter((i) => audience === 'internal' || customerVisible(i.item_id))
      .map((i) => ({ itemKey: i.item_key, title: i.title, status: i.status })),
    openFollowups: openFollowups
      .filter((f) => audience === 'internal' || (f.item_id !== null && customerVisible(f.item_id)))
      .map((f) => ({ followupId: f.followup_id, ownerRole: f.owner_role, reason: f.reason, nextAction: f.next_action })),
    humanReviewDistinctFromModelSuggestion: {
      humanVerifiedCount: verified.filter((i) => (i.verified_by ?? '').startsWith('principal') || i.verified_by === 'system:auto_recompute' ? i.verified_by !== 'system:auto_recompute' : true).length,
      note: 'verified 由人类核验动作产生；模型/Agent 产出恒为候选，不计入 verified',
    },
    restrictions: audience === 'internal'
      ? ['检查结束不等于风险已解除，不等于授信已批准；未决事项保留评估限制']
      : ['请按待办清单补充材料；补充后仅重开相关核验事项'],
  };
}

async function storeSummaries(tx: PoolClient, session: SessionRow): Promise<void> {
  // 小结按收口修订固化：会议未结束（revision 语义未定）不落小结
  if (session.run_status !== 'ended') return;
  const items = await loadItems(tx, session.session_id);
  const questions = await loadQuestions(tx, session.session_id);
  const followups = await loadFollowups(tx, session.session_id);
  for (const audience of AUDIENCES) {
    const content = projectSummary(session, items, questions, followups, audience);
    await tx.query(
      `INSERT INTO inspection_summaries (summary_id, session_id, closure_revision, audience, content)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (session_id, closure_revision, audience) DO NOTHING`,
      [newId('sum'), session.session_id, session.closure_revision, audience, JSON.stringify(content)],
    );
  }
}

// ---------------------------------------------------------------------------
// 计划项展开（create / plan 修订共用）
// ---------------------------------------------------------------------------

interface PlanItemInput {
  itemKey: string; title: string; required: boolean; responsibleRole: string; targetRole: string;
  requiresHumanVerification: boolean; expectedEvidenceKinds: string[]; objectRef: string | null;
  detail: Record<string, unknown>;
}

function parsePlanItems(raw: unknown): PlanItemInput[] {
  if (!Array.isArray(raw) || raw.length === 0) throw invalid('items 不能为空（计划至少需要一个核验项）');
  if (raw.length > MAX_ITEMS) throw invalid(`items 超出 ${MAX_ITEMS} 项上限`);
  const seen = new Set<string>();
  return raw.map((r, i) => {
    const obj = reqObject(r, `items[${i}]`);
    const itemKey = reqString(obj.itemKey, `items[${i}].itemKey`, 64);
    if (seen.has(itemKey)) throw invalid(`items[${i}].itemKey 重复：${itemKey}`);
    seen.add(itemKey);
    return {
      itemKey,
      title: reqString(obj.title, `items[${i}].title`, 200),
      required: reqBool(obj.required, `items[${i}].required`, true),
      responsibleRole: reqString(obj.responsibleRole, `items[${i}].responsibleRole`, 64),
      targetRole: reqString(obj.targetRole, `items[${i}].targetRole`, 64),
      requiresHumanVerification: reqBool(obj.requiresHumanVerification, `items[${i}].requiresHumanVerification`, true),
      expectedEvidenceKinds: reqStringArray(obj.expectedEvidenceKinds ?? [], `items[${i}].expectedEvidenceKinds`),
      objectRef: obj.objectRef === undefined || obj.objectRef === null ? null : reqString(obj.objectRef, `items[${i}].objectRef`, 200),
      detail: reqObject(obj.detail ?? {}, `items[${i}].detail`),
    };
  });
}

async function insertItems(tx: PoolClient, sessionId: string, entries: PlanItemInput[]): Promise<void> {
  for (const e of entries) {
    await tx.query(
      `INSERT INTO inspection_items (item_id, session_id, item_key, title, required, responsible_role, target_role,
         requires_human_verification, expected_evidence_kinds, object_ref, detail, anchors)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [newId('it'), sessionId, e.itemKey, e.title, e.required, e.responsibleRole, e.targetRole,
       e.requiresHumanVerification, JSON.stringify(e.expectedEvidenceKinds), e.objectRef,
       JSON.stringify(e.detail), JSON.stringify(e.objectRef === null ? [] : [{ objectRef: e.objectRef, boundAt: new Date().toISOString() }])],
    );
  }
}

function parseRoster(raw: unknown): { roleKey: string; kind: 'human' | 'agent' }[] {
  if (!Array.isArray(raw) || raw.length === 0) throw invalid('roles 不能为空（会话至少一个角色）');
  const seen = new Set<string>();
  return raw.map((r, i) => {
    const obj = reqObject(r, `roles[${i}]`);
    const roleKey = reqString(obj.roleKey, `roles[${i}].roleKey`, 64);
    const kind = obj.kind === 'agent' ? 'agent' : obj.kind === 'human' ? 'human' : null;
    if (kind === null) throw invalid(`roles[${i}].kind 必须 human|agent`);
    if (seen.has(roleKey)) throw invalid(`roles[${i}].roleKey 重复：${roleKey}`);
    seen.add(roleKey);
    return { roleKey, kind };
  });
}

async function touchEventSeq(tx: PoolClient, sessionId: string): Promise<void> {
  await tx.query(
    `UPDATE inspection_sessions SET last_event_seq = (SELECT COALESCE(MAX(seq),0) FROM outbox_events) WHERE session_id = $1`,
    [sessionId],
  );
}

// ---------------------------------------------------------------------------
// 对外命令面
// ---------------------------------------------------------------------------

export interface InspectionApi {
  createSession(frame: RequestFrame, projectId: string): Promise<Record<string, unknown>>;
  getSession(sessionId: string): Promise<Record<string, unknown>>;
  getNextActions(sessionId: string): Promise<Record<string, unknown>>;
  revisePlan(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>>;
  reviseScene(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>>;
  startSession(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>>;
  pauseSession(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>>;
  resumeSession(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>>;
  endSession(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>>;
  closeSession(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>>;
  setPresence(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>>;
  takeoverSession(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>>;
  addItem(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>>;
  verifyItem(frame: RequestFrame, sessionId: string, itemId: string): Promise<Record<string, unknown>>;
  rebindItem(frame: RequestFrame, sessionId: string, itemId: string): Promise<Record<string, unknown>>;
  reassignItem(frame: RequestFrame, sessionId: string, itemId: string): Promise<Record<string, unknown>>;
  createQuestion(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>>;
  answerQuestion(frame: RequestFrame, sessionId: string, questionId: string): Promise<Record<string, unknown>>;
  reaskQuestion(frame: RequestFrame, sessionId: string, questionId: string): Promise<Record<string, unknown>>;
  grantOutbound(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>>;
  outboundResult(frame: RequestFrame, sessionId: string, sendId: string): Promise<Record<string, unknown>>;
  sweep(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>>;
  addLateEvidence(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>>;
  writeCheckpointCommand(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>>;
  getSummaries(sessionId: string, audience: string | null, revision: number | null, credential: unknown): Promise<Record<string, unknown>>;
}

export function buildInspectionCommands(kernel: Kernel): InspectionApi {
  // ---- 会话生命周期 ---------------------------------------------------------

  async function createSession(frame: RequestFrame, projectId: string): Promise<Record<string, unknown>> {
    return withIxCommand(kernel, frame, 'inspection-create', { projectId }, async (tx, h, auth) => {
      requireVerified(auth);
      authorizeProject(auth.principal, projectId);
      const pr = await tx.query(`SELECT * FROM projects WHERE project_id = $1 FOR UPDATE`, [projectId]);
      if (pr.rows.length === 0) throw notFound('项目不存在');
      if ((pr.rows[0] as { status: string }).status !== 'active') throw conflict('PROJECT_PAUSED', '项目暂停中：不能创建检查会话');
      const customer = await tx.query(`SELECT * FROM customers WHERE customer_id = $1`, [reqString(frame.customerId, 'customerId', 64)]);
      if (customer.rows.length === 0) throw notFound('客户不存在');
      const customerId = (customer.rows[0] as { customer_id: string }).customer_id;
      const tenantId = (customer.rows[0] as { tenant_id: string }).tenant_id;
      const roster = parseRoster(frame.roles);
      const ownerRole = reqString(frame.ownerRole ?? 'business', 'ownerRole', 64);
      const ownerEntry = roster.find((r) => r.roleKey === ownerRole);
      if (ownerEntry === undefined) throw invalid('ownerRole 必须在 roles 名册中');
      if (ownerEntry.kind !== 'human') throw invalid('ownerRole 必须是人类角色（会话推进权威属于人）');
      const planItems = parsePlanItems(frame.items);
      for (const it of planItems) {
        if (!roster.some((r) => r.roleKey === it.responsibleRole)) throw invalid(`items[${it.itemKey}].responsibleRole 不在名册中`);
        if (!roster.some((r) => r.roleKey === it.targetRole)) throw invalid(`items[${it.itemKey}].targetRole 不在名册中`);
      }
      const planSnapshot = reqObject(frame.planSnapshot ?? {}, 'planSnapshot');
      checkJsonSize(planSnapshot, 'planSnapshot', MAX_PLAN_JSON);
      const configIn = frame.config === undefined ? {} : reqObject(frame.config, 'config');
      const config = {
        maxFollowUpsPerQuestion: reqInt(configIn.maxFollowUpsPerQuestion ?? DEFAULT_CONFIG.maxFollowUpsPerQuestion, 'config.maxFollowUpsPerQuestion'),
        waitTimeoutSeconds: reqInt(configIn.waitTimeoutSeconds ?? DEFAULT_CONFIG.waitTimeoutSeconds, 'config.waitTimeoutSeconds'),
        maxQuestionsPerItem: reqInt(configIn.maxQuestionsPerItem ?? DEFAULT_CONFIG.maxQuestionsPerItem, 'config.maxQuestionsPerItem'),
      };
      const sessionId = newId('ins');
      const snapshotHash = canonicalHash(planSnapshot);
      await tx.query(
        `INSERT INTO inspection_sessions (session_id, project_id, customer_id, tenant_id, site_id, title, scene_version, plan_snapshot, plan_snapshot_hash, roles, owner_role, config, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [sessionId, projectId, customerId, tenantId,
         frame.siteId === undefined || frame.siteId === null ? null : reqString(frame.siteId, 'siteId', 120),
         reqString(frame.title, 'title', 200),
         reqString(frame.sceneVersion ?? 'scene-0', 'sceneVersion', 120),
         JSON.stringify(planSnapshot), snapshotHash, JSON.stringify(roster), ownerRole, JSON.stringify(config), auth.principal.principalId],
      );
      await insertItems(tx, sessionId, planItems);
      await h.audit({
        actor: auth.principal.principalId, action: 'inspection_created', targetType: 'inspection_session', targetId: sessionId,
        projectId, summary: `创建检查会话（${planItems.length} 核验项）`, payload: { customerId, planVersion: 1 },
      });
      await h.emit({
        eventType: 'INSPECTION_CREATED', projectId, customerId,
        payload: { sessionId, customerId, planVersion: 1, sceneVersion: frame.sceneVersion ?? 'scene-0', items: planItems.map((i) => i.itemKey) },
      });
      await touchEventSeq(tx, sessionId);
      return { ok: true, sessionId, runStatus: 'preparing', closureStatus: 'open', planVersion: 1 };
    });
  }

  async function getSession(sessionId: string): Promise<Record<string, unknown>> {
    const client = await kernel.pool.connect();
    try {
      const session = await sessionOr404(client, sessionId);
      return { ok: true, snapshot: await snapshotOf(client, session) };
    } finally {
      client.release();
    }
  }

  async function snapshotOf(tx: PoolClient, session: SessionRow): Promise<Record<string, unknown>> {
    const items = await loadItems(tx, session.session_id);
    const questions = await loadQuestions(tx, session.session_id);
    const outbound = await loadOutbound(tx, session.session_id);
    const followups = await loadFollowups(tx, session.session_id);
    const required = items.filter((i) => i.required);
    const inFlight = outbound.filter((o) => ['authorized', 'sent', 'unknown'].includes(o.status));
    return {
      sessionId: session.session_id,
      projectId: session.project_id,
      customerId: session.customer_id,
      siteId: session.site_id,
      title: session.title,
      runStatus: session.run_status,
      closureStatus: session.closure_status,
      planVersion: session.plan_version,
      sceneVersion: session.scene_version,
      planSnapshotHash: session.plan_snapshot_hash,
      roles: session.roles,
      participants: session.participants,
      ownerRole: session.owner_role,
      // 服务端 availableActions（前端按钮以此为准，不据角色图标自行授权；角色校验仍在每个命令内强制）
      availableActions: availableActionsOf(session),
      coverage: {
        total: items.length, required: required.length,
        verified: required.filter((i) => i.status === 'verified').length,
        open: required.filter((i) => i.status !== 'verified').length,
      },
      items: items.map((i) => ({
        itemId: i.item_id, itemKey: i.item_key, title: i.title, required: i.required,
        status: i.status, responsibleRole: i.assigned_role ?? i.responsible_role, targetRole: i.target_role,
        requiresHumanVerification: i.requires_human_verification,
        expectedEvidenceKinds: i.expected_evidence_kinds, objectRef: i.object_ref,
      })),
      openQuestions: questions.filter((q) => q.status === 'open' || q.status === 'sent').length,
      followups: followups.filter((f) => f.status === 'open').map((f) => ({
        followupId: f.followup_id, itemId: f.item_id, ownerRole: f.owner_role, reason: f.reason, nextAction: f.next_action,
      })),
      outbound: {
        paused: session.outbound_paused,
        dispatchGeneration: session.dispatch_generation,
        inFlight: inFlight.map((o) => ({ sendId: o.send_id, questionId: o.question_id, generation: o.generation, status: o.status })),
      },
      takeover: session.takeover_by === null ? null : { by: session.takeover_by, at: session.takeover_at },
      lastEventSeq: Number(session.last_event_seq),
      closureRevision: session.closure_revision,
      version: session.version,
    };
  }

  /** 缺口驱动的下一步：由必要核验项/依赖/负责角色/目标回答人/当前证据版本推导；不由动画或固定脚本驱动。 */
  async function getNextActions(sessionId: string): Promise<Record<string, unknown>> {
    const client = await kernel.pool.connect();
    try {
      const session = await sessionOr404(client, sessionId);
      const items = await loadItems(client, session.session_id);
      const questions = await loadQuestions(client, session.session_id);
      const followups = await loadFollowups(client, session.session_id);
      const kinds = await currentArtifactKinds(client, session.customer_id);
      const present = (role: string): boolean => session.participants[role]?.present !== false;
      const actions = items.map((it) => {
        const itemQs = questions.filter((q) => q.item_id === it.item_id);
        const openQ = itemQs.find((q) => q.status === 'open' || q.status === 'sent');
        const answered = itemQs.some((q) => q.status === 'answered');
        const missingKinds = it.expected_evidence_kinds.filter((k) => !kinds.has(k));
        let blockedReason: string | null = null;
        let waitingFor: Record<string, unknown> | null = null;
        if (it.status === 'verified') {
          // 已核实：无需动作
        } else if (it.status === 'stale_review') {
          blockedReason = 'stale_review:场景版本已前移，须显式重新关联对象（不能按名称相似自动换绑）';
          waitingFor = { role: it.responsible_role, action: 'rebind' };
        } else if (it.status === 'conflict') {
          blockedReason = 'conflict:存在未解决冲突，等待人工复核';
          waitingFor = { role: it.responsible_role, action: 'verify' };
        } else if (it.status === 'deferred') {
          blockedReason = `deferred:已转会后待办（${followups.find((f) => f.item_id === it.item_id && f.status === 'open')?.followup_id ?? 'followup'}）`;
          waitingFor = { role: it.responsible_role, action: 'followup' };
        } else if (openQ !== undefined && openQ.status === 'open') {
          blockedReason = 'waiting_dispatch:问题已建立待外发授权';
          waitingFor = { role: 'dispatcher', questionId: openQ.question_id };
        } else if (openQ !== undefined && openQ.status === 'sent') {
          if (!present(it.target_role)) {
            blockedReason = `waiting_participant:${it.target_role} 暂离（其在线前该问保持等待，不自动完成）`;
            waitingFor = { role: it.target_role, questionId: openQ.question_id };
          } else {
            blockedReason = 'waiting_answer:问题已外发，等待回答';
            waitingFor = { role: it.target_role, questionId: openQ.question_id };
          }
        } else if (answered && missingKinds.length > 0) {
          blockedReason = `waiting_evidence:口述已登记，材料未取得（缺 ${missingKinds.join(',')}）`;
          waitingFor = { role: it.target_role, evidenceKinds: missingKinds };
        } else if (it.status === 'to_verify') {
          blockedReason = 'needs_human_verification:材料齐备，等待人工核验';
          waitingFor = { role: it.responsible_role, action: 'verify' };
        } else if (it.status === 'pending') {
          blockedReason = 'waiting_question:尚未建立核验问题';
          waitingFor = { role: it.responsible_role, action: 'create_question' };
        }
        return {
          itemId: it.item_id, itemKey: it.item_key, title: it.title, status: it.status,
          required: it.required,
          whyNeeded: (it.detail as { whyNeeded?: string }).whyNeeded ?? `必要核验项 ${it.item_key}`,
          expectedEvidence: it.expected_evidence_kinds,
          stopCondition: (it.detail as { stopCondition?: string }).stopCondition ?? null,
          responsibleRole: it.assigned_role ?? it.responsible_role,
          targetRole: it.target_role,
          objectRef: it.object_ref,
          blockedReason,
          waitingFor,
        };
      });
      const sessionBlocked: string[] = [];
      if (session.outbound_paused) sessionBlocked.push('outbound_paused:自动外发已暂停');
      if (session.run_status === 'preparing') sessionBlocked.push('not_started:会话尚未开始');
      if (session.run_status === 'suspended') sessionBlocked.push('suspended:会话已暂停');
      if (session.run_status === 'ended') sessionBlocked.push('ended:会议已结束，进入会后接续');
      if (session.takeover_by !== null) sessionBlocked.push(`human_takeover:${session.takeover_by}`);
      return {
        ok: true,
        runStatus: session.run_status,
        nextActions: actions.filter((a) => a.status !== 'verified'),
        verifiedCount: actions.filter((a) => a.status === 'verified').length,
        blockedReasons: sessionBlocked,
      };
    } finally {
      client.release();
    }
  }

  // ---- 计划/场景修订 ---------------------------------------------------------

  async function revisePlan(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>> {
    return withIxCommand(kernel, frame, 'inspection-plan', { sessionId }, async (tx, h, auth) => {
      const session = await sessionOr404(tx, sessionId, true);
      requireOwner(auth, session);
      requireNotClosed(session);
      if (session.run_status === 'ended' || session.run_status === 'suspended') {
        throw conflict('SESSION_NOT_RUNNING', `会话当前 ${session.run_status}：计划修订仅 preparing|in_progress 可用`);
      }
      const planSnapshot = reqObject(frame.planSnapshot ?? session.plan_snapshot, 'planSnapshot');
      checkJsonSize(planSnapshot, 'planSnapshot', MAX_PLAN_JSON);
      const roster = frame.roles === undefined ? session.roles : parseRoster(frame.roles);
      const newVersion = session.plan_version + 1;
      if (session.run_status === 'preparing') {
        // 会前：整体替换计划项（尚无问题/回答，不存在历史混用）
        const planItems = parsePlanItems(frame.items ?? []);
        for (const it of planItems) {
          if (!roster.some((r) => r.roleKey === it.responsibleRole)) throw invalid(`items[${it.itemKey}].responsibleRole 不在名册中`);
          if (!roster.some((r) => r.roleKey === it.targetRole)) throw invalid(`items[${it.itemKey}].targetRole 不在名册中`);
        }
        await tx.query(`DELETE FROM inspection_items WHERE session_id = $1`, [sessionId]);
        await insertItems(tx, sessionId, planItems);
        await tx.query(
          `UPDATE inspection_sessions SET plan_version = $2, plan_snapshot = $3, plan_snapshot_hash = $4, roles = $5, updated_at = now() WHERE session_id = $1`,
          [sessionId, newVersion, JSON.stringify(planSnapshot), canonicalHash(planSnapshot), JSON.stringify(roster)],
        );
      } else {
        // 会间：只增补（历史问题/回答不动，不悄悄混用新旧计划语义）
        const added = frame.items === undefined ? [] : parsePlanItems(frame.items);
        for (const it of added) {
          if (!roster.some((r) => r.roleKey === it.responsibleRole)) throw invalid(`items[${it.itemKey}].responsibleRole 不在名册中`);
          if (!roster.some((r) => r.roleKey === it.targetRole)) throw invalid(`items[${it.itemKey}].targetRole 不在名册中`);
        }
        const existing = await loadItems(tx, sessionId);
        const fresh = added.filter((a) => !existing.some((e) => e.item_key === a.itemKey));
        await insertItems(tx, sessionId, fresh);
        await tx.query(
          `UPDATE inspection_sessions SET plan_version = $2, plan_snapshot = $3, plan_snapshot_hash = $4, roles = $5, updated_at = now() WHERE session_id = $1`,
          [sessionId, newVersion, JSON.stringify(planSnapshot), canonicalHash(planSnapshot), JSON.stringify(roster)],
        );
      }
      await h.audit({
        actor: auth.principal.principalId, action: 'inspection_plan_revised', targetType: 'inspection_session', targetId: sessionId,
        projectId: session.project_id, summary: `计划修订 → v${newVersion}`, payload: { planVersion: newVersion },
      });
      await h.emit({
        eventType: 'INSPECTION_PLAN_REVISED', projectId: session.project_id, customerId: session.customer_id,
        payload: { sessionId, planVersion: newVersion },
      });
      await touchEventSeq(tx, sessionId);
      return { ok: true, planVersion: newVersion, sessionVersion: session.version + 1 };
    });
  }

  async function reviseScene(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>> {
    return withIxCommand(kernel, frame, 'inspection-scene', { sessionId }, async (tx, h, auth) => {
      const session = await sessionOr404(tx, sessionId, true);
      requireOwner(auth, session);
      requireNotClosed(session);
      const sceneVersion = reqString(frame.sceneVersion, 'sceneVersion', 120);
      if (sceneVersion === session.scene_version) return { ok: true, sceneVersion, unchanged: true, sessionVersion: session.version };
      await tx.query(
        `UPDATE inspection_sessions SET scene_version = $2, plan_version = plan_version + 1, updated_at = now() WHERE session_id = $1`,
        [sessionId, sceneVersion],
      );
      // 场景前移：对象锚定不确定 → 未核实的锚定项进入复核（保留原引用，要求重新关联；不做相似名称自动换绑）
      const items = await loadItems(tx, sessionId);
      const anchored = items.filter((i) => i.object_ref !== null && i.status !== 'verified' && i.status !== 'stale_review');
      for (const it of anchored) {
        await tx.query(
          `UPDATE inspection_items SET status = 'stale_review', version = version + 1, updated_at = now() WHERE item_id = $1`,
          [it.item_id],
        );
      }
      await h.audit({
        actor: auth.principal.principalId, action: 'inspection_scene_revised', targetType: 'inspection_session', targetId: sessionId,
        projectId: session.project_id, summary: `场景版本 ${session.scene_version} → ${sceneVersion}（${anchored.length} 项进入复核）`,
        payload: { from: session.scene_version, to: sceneVersion, staleItems: anchored.map((i) => i.item_id) },
      });
      await h.emit({
        eventType: 'INSPECTION_PLAN_REVISED', projectId: session.project_id, customerId: session.customer_id,
        payload: { sessionId, sceneVersion, planVersion: session.plan_version + 1, staleItemIds: anchored.map((i) => i.item_id), reason: 'scene_revised' },
      });
      await touchEventSeq(tx, sessionId);
      return { ok: true, sceneVersion, staleReviewItems: anchored.map((i) => i.item_id), sessionVersion: session.version + 1 };
    });
  }

  // ---- 开始/暂停/恢复/结束/收口 ------------------------------------------------

  async function startSession(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>> {
    return withIxCommand(kernel, frame, 'inspection-start', { sessionId }, async (tx, h, auth) => {
      const session = await sessionOr404(tx, sessionId, true);
      requireOwner(auth, session);
      requireVersion(session, frame.expectedVersion);
      if (session.run_status !== 'preparing' && session.run_status !== 'ready') {
        throw conflict('NOT_READY', `会话当前 ${session.run_status}：仅 preparing|ready 可开始`);
      }
      // A03：计划版本必须显式对齐——不悄悄混用新旧计划
      const acceptedPlanVersion = reqInt(frame.acceptedPlanVersion ?? session.plan_version, 'acceptedPlanVersion');
      if (acceptedPlanVersion !== session.plan_version) {
        throw conflict('PLAN_CHANGED', `计划版本已前移：客户端 v${acceptedPlanVersion}，服务端 v${session.plan_version}（显式 acceptedPlanVersion 才能采用新计划）`,
          { currentPlanVersion: session.plan_version });
      }
      // 必要前提：plan_snapshot.prerequisites（kind 数组）须有当前工件；缺失给具体原因
      const prerequisites = Array.isArray((session.plan_snapshot as { prerequisites?: unknown }).prerequisites)
        ? ((session.plan_snapshot as { prerequisites: unknown[] }).prerequisites as unknown[]).map(String)
        : [];
      const kinds = await currentArtifactKinds(tx, session.customer_id);
      const missing = prerequisites.filter((k) => !kinds.has(k));
      if (missing.length > 0) {
        throw conflict('NOT_READY', `计划必要前提未满足：缺材料 ${missing.join(', ')}`, { missing });
      }
      const items = await loadItems(tx, sessionId);
      if (items.length === 0) throw conflict('NOT_READY', '计划无核验项：不能开始');
      await tx.query(
        `UPDATE inspection_sessions SET run_status = 'in_progress', version = version + 1, updated_at = now() WHERE session_id = $1`,
        [sessionId],
      );
      await refreshItems(tx, { ...session, run_status: 'in_progress' }, h, auth.principal.principalId);
      await h.audit({
        actor: auth.principal.principalId, action: 'inspection_started', targetType: 'inspection_session', targetId: sessionId,
        projectId: session.project_id, summary: `开始检查（计划 v${session.plan_version}，场景 ${session.scene_version}）`, payload: { planVersion: session.plan_version },
      });
      await h.emit({
        eventType: 'INSPECTION_STARTED', projectId: session.project_id, customerId: session.customer_id,
        payload: { sessionId, planVersion: session.plan_version, sceneVersion: session.scene_version },
      });
      await touchEventSeq(tx, sessionId);
      return { ok: true, runStatus: 'in_progress', sessionVersion: session.version + 1 };
    });
  }

  async function pauseSession(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>> {
    return withIxCommand(kernel, frame, 'inspection-pause', { sessionId }, async (tx, h, auth) => {
      const session = await sessionOr404(tx, sessionId, true);
      requireOwner(auth, session);
      requireVersion(session, frame.expectedVersion);
      if (session.run_status !== 'in_progress') {
        throw conflict('NOT_READY', `会话当前 ${session.run_status}：仅 in_progress 可暂停`);
      }
      // A04 线性化点：本事务提交后——①不再授予该会话新的自动外发；②调度代际 +1（旧调度者凭旧代际被拒）。
      // 此前已授权/已发送的请求为在途，如实列出；不声称已发语音/消息可撤回。
      const generation = session.dispatch_generation + 1;
      await tx.query(
        `UPDATE inspection_sessions SET run_status = 'suspended', outbound_paused = true, dispatch_generation = $2, version = version + 1, updated_at = now() WHERE session_id = $1`,
        [sessionId, generation],
      );
      const checkpointId = await writeCheckpoint(tx, { ...session, outbound_paused: true, dispatch_generation: generation }, 'pause');
      await h.audit({
        actor: auth.principal.principalId, action: 'inspection_paused', targetType: 'inspection_session', targetId: sessionId,
        projectId: session.project_id, summary: `暂停（代际 → ${generation}；在途单独列明）`, payload: { generation, checkpointId },
      });
      await h.emit({
        eventType: 'INSPECTION_PAUSED', projectId: session.project_id, customerId: session.customer_id,
        payload: { sessionId, generation, checkpointId },
      });
      await touchEventSeq(tx, sessionId);
      return { ok: true, runStatus: 'suspended', dispatchGeneration: generation, checkpointId, sessionVersion: session.version + 1 };
    });
  }

  async function resumeSession(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>> {
    return withIxCommand(kernel, frame, 'inspection-resume', { sessionId }, async (tx, h, auth) => {
      const session = await sessionOr404(tx, sessionId, true);
      requireOwner(auth, session);
      requireVersion(session, frame.expectedVersion);
      if (session.run_status !== 'suspended') {
        throw conflict('NOT_READY', `会话当前 ${session.run_status}：仅 suspended 可恢复`);
      }
      // 恢复先读 checkpoint 与既有事实/回执，重新校验版本与场景映射；保留已完成核验，陈旧锚定项进入复核；
      // 不整轮重做、不自动重发已问问题、不因重新入房改变客户/设备绑定。
      const cp = await tx.query(
        `SELECT payload FROM inspection_checkpoints WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1`, [sessionId],
      );
      const checkpoint = cp.rows.length > 0 ? (cp.rows[0] as { payload: Record<string, unknown> }).payload : null;
      const drift: Record<string, unknown> = {};
      if (checkpoint !== null) {
        if (Number(checkpoint.planVersion) !== session.plan_version) {
          drift.planVersion = { atCheckpoint: checkpoint.planVersion, now: session.plan_version };
        }
        if (checkpoint.sceneVersion !== session.scene_version) {
          drift.sceneVersion = { atCheckpoint: checkpoint.sceneVersion, now: session.scene_version };
        }
      }
      let staleReviewItems: string[] = [];
      if (drift.sceneVersion !== undefined) {
        const items = await loadItems(tx, sessionId);
        staleReviewItems = items.filter((i) => i.object_ref !== null && i.status !== 'verified' && i.status !== 'stale_review').map((i) => i.item_id);
        for (const itemId of staleReviewItems) {
          await tx.query(`UPDATE inspection_items SET status = 'stale_review', version = version + 1, updated_at = now() WHERE item_id = $1`, [itemId]);
        }
      }
      await tx.query(
        `UPDATE inspection_sessions SET run_status = 'in_progress', outbound_paused = false, version = version + 1, updated_at = now() WHERE session_id = $1`,
        [sessionId],
      );
      await h.audit({
        actor: auth.principal.principalId, action: 'inspection_resumed', targetType: 'inspection_session', targetId: sessionId,
        projectId: session.project_id, summary: `恢复（代际保持 ${session.dispatch_generation}；旧代际申请外发仍被拒）`,
        payload: { generation: session.dispatch_generation, drift, staleReviewItems },
      });
      await h.emit({
        eventType: 'INSPECTION_RESUMED', projectId: session.project_id, customerId: session.customer_id,
        payload: { sessionId, generation: session.dispatch_generation, drift, staleReviewItems },
      });
      await touchEventSeq(tx, sessionId);
      return { ok: true, runStatus: 'in_progress', drift, staleReviewItems, sessionVersion: session.version + 1 };
    });
  }

  async function endSession(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>> {
    return withIxCommand(kernel, frame, 'inspection-end', { sessionId }, async (tx, h, auth) => {
      const session = await sessionOr404(tx, sessionId, true);
      requireOwner(auth, session);
      requireVersion(session, frame.expectedVersion);
      if (session.run_status === 'ended') throw conflict('NOT_READY', '会话已结束');
      if (session.run_status === 'preparing' || session.run_status === 'ready') {
        throw conflict('NOT_READY', `会话当前 ${session.run_status}：尚未开始，不能结束会议`);
      }
      // 存在未闭合事项允许结束会议，但必须形成会后待办（每事项至多一条 open）并保留评估限制。
      const items = await loadItems(tx, sessionId);
      const unclosed = items.filter((i) => i.required && i.status !== 'verified' && i.status !== 'deferred');
      const followupIds: string[] = [];
      for (const it of unclosed) {
        const fid = newId('fu');
        const reason = it.status === 'conflict' || it.status === 'stale_review'
          ? `未决冲突/复核：${it.title}`
          : `必要核验未完成：${it.title}`;
        await tx.query(
          `INSERT INTO inspection_followups (followup_id, session_id, item_id, owner_role, reason, next_action, closure_revision)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [fid, sessionId, it.item_id, it.assigned_role ?? it.responsible_role, reason,
           it.status === 'conflict' || it.status === 'stale_review' ? '人工复核/重新关联后 verify' : '补齐材料后重开核验', session.closure_revision],
        );
        followupIds.push(fid);
        if (it.status !== 'conflict' && it.status !== 'stale_review') {
          await tx.query(`UPDATE inspection_items SET status = 'deferred', version = version + 1, updated_at = now() WHERE item_id = $1`, [it.item_id]);
        }
      }
      await tx.query(`UPDATE inspection_sessions SET run_status = 'ended', closure_revision = 1, version = version + 1, updated_at = now() WHERE session_id = $1`, [sessionId]);
      const ended = { ...session, run_status: 'ended' as RunStatus, closure_revision: 1 };
      await refreshItems(tx, ended, h, auth.principal.principalId);
      const closure = await recomputeClosure(tx, ended, h);
      await writeCheckpoint(tx, ended, 'end');
      await storeSummaries(tx, ended);
      for (const fid of followupIds) {
        await h.emit({
          eventType: 'FOLLOWUP_REQUIRED', projectId: session.project_id, customerId: session.customer_id,
          payload: { sessionId, followupId: fid, closureRevision: 1 },
        });
      }
      await h.audit({
        actor: auth.principal.principalId, action: 'inspection_ended', targetType: 'inspection_session', targetId: sessionId,
        projectId: session.project_id, summary: `结束会议（未决 ${unclosed.length} 项 → 会后待办；收口 ${closure ?? session.closure_status}）`,
        payload: { followups: followupIds, closureStatus: closure ?? session.closure_status },
      });
      await h.emit({
        eventType: 'INSPECTION_ENDED', projectId: session.project_id, customerId: session.customer_id,
        payload: { sessionId, closureStatus: closure ?? session.closure_status, followups: followupIds, closureRevision: 1 },
      });
      await touchEventSeq(tx, sessionId);
      return { ok: true, runStatus: 'ended', closureStatus: closure ?? session.closure_status, followups: followupIds, sessionVersion: session.version + 1 };
    });
  }

  async function closeSession(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>> {
    return withIxCommand(kernel, frame, 'inspection-close', { sessionId }, async (tx, h, auth) => {
      const session = await sessionOr404(tx, sessionId, true);
      requireOwner(auth, session);
      requireVersion(session, frame.expectedVersion);
      if (session.run_status !== 'ended') throw conflict('NOT_READY', `会话当前 ${session.run_status}：会议结束后才能收口`);
      if (session.closure_status === 'closed') throw conflict('INSPECTION_CLOSED', '会话已收口');
      await tx.query(
        `UPDATE inspection_sessions SET closure_status = 'closed', version = version + 1, updated_at = now() WHERE session_id = $1`, [sessionId],
      );
      await h.audit({
        actor: auth.principal.principalId, action: 'inspection_closed', targetType: 'inspection_session', targetId: sessionId,
        projectId: session.project_id, summary: `收口 closed（revision ${session.closure_revision}；不携带自动批准语义）`, payload: {},
      });
      await h.emit({
        eventType: 'INSPECTION_CLOSED', projectId: session.project_id, customerId: session.customer_id,
        payload: { sessionId, closureRevision: session.closure_revision },
      });
      await touchEventSeq(tx, sessionId);
      return { ok: true, closureStatus: 'closed', sessionVersion: session.version + 1 };
    });
  }

  // ---- 在线/接管 --------------------------------------------------------------

  async function setPresence(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>> {
    return withIxCommand(kernel, frame, 'inspection-presence', { sessionId }, async (tx, h, auth) => {
      const session = await sessionOr404(tx, sessionId, true);
      const role = reqString(frame.role, 'role', 64);
      if (auth.principal.roles.includes('admin') === false) requireRosterRole(auth, session, role);
      else requireVerified(auth);
      const present = reqBool(frame.present, 'present', true);
      const participants = { ...session.participants, [role]: { present, since: new Date().toISOString() } };
      await tx.query(
        `UPDATE inspection_sessions SET participants = $2, version = version + 1, updated_at = now() WHERE session_id = $1`,
        [sessionId, JSON.stringify(participants)],
      );
      // 角色离开只影响依赖其输入的事项的推进提示；不自动完成任何核验项，不清全局状态。
      await h.audit({
        actor: auth.principal.principalId, action: 'inspection_presence', targetType: 'inspection_session', targetId: sessionId,
        projectId: session.project_id, summary: `${role} ${present ? '上线' : '暂离'}`, payload: { role, present },
      });
      return { ok: true, role, present, sessionVersion: session.version + 1 };
    });
  }

  async function takeoverSession(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>> {
    return withIxCommand(kernel, frame, 'inspection-takeover', { sessionId }, async (tx, h, auth) => {
      const session = await sessionOr404(tx, sessionId, true);
      requireOwner(auth, session);
      if (session.run_status !== 'in_progress' && session.run_status !== 'suspended') {
        throw conflict('NOT_READY', `会话当前 ${session.run_status}：无可接管状态`);
      }
      // 人工接管：持久化接管者；同时暂停自动外发并推进代际（人接管后旧调度代际立即失效）。
      const generation = session.dispatch_generation + 1;
      await tx.query(
        `UPDATE inspection_sessions SET takeover_by = $2, takeover_at = now(), outbound_paused = true,
           dispatch_generation = $3, version = version + 1, updated_at = now() WHERE session_id = $1`,
        [sessionId, auth.principal.principalId, generation],
      );
      const checkpointId = await writeCheckpoint(tx, { ...session, outbound_paused: true, dispatch_generation: generation }, 'takeover');
      await h.audit({
        actor: auth.principal.principalId, action: 'inspection_takeover', targetType: 'inspection_session', targetId: sessionId,
        projectId: session.project_id, summary: `人工接管（代际 → ${generation}；不改身份本身）`, payload: { generation, checkpointId },
      });
      await h.emit({
        eventType: 'INSPECTION_PAUSED', projectId: session.project_id, customerId: session.customer_id,
        payload: { sessionId, generation, checkpointId, reason: 'human_takeover' },
      });
      await touchEventSeq(tx, sessionId);
      return { ok: true, takeoverBy: auth.principal.principalId, dispatchGeneration: generation, sessionVersion: session.version + 1 };
    });
  }

  // ---- 核验项动作 --------------------------------------------------------------

  async function addItem(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>> {
    return withIxCommand(kernel, frame, 'inspection-item-add', { sessionId }, async (tx, h, auth) => {
      const session = await sessionOr404(tx, sessionId, true);
      requireOwner(auth, session);
      requireNotClosed(session);
      const entries = parsePlanItems([frame]);
      const entry = entries[0];
      if (entry === undefined) throw invalid('核验项不能为空');
      const existing = await loadItems(tx, sessionId);
      if (existing.some((e) => e.item_key === entry.itemKey)) throw conflict('GOAL_EXISTS', `核验项已存在：${entry.itemKey}`);
      if (existing.length + 1 > MAX_ITEMS) throw invalid(`核验项超出 ${MAX_ITEMS} 项上限`);
      await insertItems(tx, sessionId, entries);
      await tx.query(`UPDATE inspection_sessions SET version = version + 1, updated_at = now() WHERE session_id = $1`, [sessionId]);
      await h.audit({
        actor: auth.principal.principalId, action: 'inspection_item_added', targetType: 'inspection_item', targetId: entry.itemKey,
        projectId: session.project_id, summary: `增补核验项 ${entry.itemKey}`, payload: { itemKey: entry.itemKey },
      });
      return { ok: true, itemKey: entry.itemKey, sessionVersion: session.version + 1 };
    });
  }

  async function verifyItem(frame: RequestFrame, sessionId: string, itemId: string): Promise<Record<string, unknown>> {
    return withIxCommand(kernel, frame, 'inspection-verify', { sessionId, itemId }, async (tx, h, auth) => {
      const session = await sessionOr404(tx, sessionId, true);
      requireNotClosed(session);
      const item = await tx.query(`SELECT * FROM inspection_items WHERE item_id = $1 AND session_id = $2 FOR UPDATE`, [itemId, sessionId]);
      if (item.rows.length === 0) throw notFound('核验项不存在');
      const it = item.rows[0] as unknown as ItemRow;
      // 真人关键核验不得由 Agent 冒充完成
      if (it.requires_human_verification) requireRosterRole(auth, session, it.responsible_role);
      else requireRosterRole(auth, session, it.responsible_role);
      if (it.status === 'stale_review') throw conflict('SCENE_ANCHOR_STALE', `核验项锚定已陈旧（场景 ${session.scene_version}）：先 rebind 重新关联，不得直接核验`);
      if (it.status !== 'to_verify' && it.status !== 'conflict') {
        throw conflict('NOT_READY', `核验项当前 ${it.status}：仅 to_verify|conflict 可人工核验`);
      }
      const verdict = frame.verdict;
      if (verdict !== 'confirmed' && verdict !== 'conflict') throw invalid('verdict 必须 confirmed|conflict');
      const note = reqString(frame.note ?? '', 'note', 2000, 0);
      const next: ItemStatus = verdict === 'confirmed' ? 'verified' : 'conflict';
      await tx.query(
        `UPDATE inspection_items SET status = $2, verified_at = CASE WHEN $2 = 'verified' THEN now() ELSE verified_at END,
           verified_by = CASE WHEN $2 = 'verified' THEN $3 ELSE verified_by END, version = version + 1, updated_at = now() WHERE item_id = $1`,
        [itemId, next, `principal:${auth.principal.principalId}`],
      );
      const after = { ...session };
      await h.audit({
        actor: auth.principal.principalId, action: 'inspection_item_verified', targetType: 'inspection_item', targetId: itemId,
        projectId: session.project_id, summary: `人工核验 ${it.item_key}: ${verdict}${note ? `（${note}）` : ''}`, payload: { verdict, note },
      });
      await h.emit({
        eventType: 'INSPECTION_ITEM_STATUS', projectId: session.project_id, customerId: session.customer_id,
        payload: { sessionId, itemId, itemKey: it.item_key, from: it.status, to: next, by: auth.principal.principalId },
      });
      const closure = await recomputeClosure(tx, after, h);
      await storeSummaries(tx, after);
      await touchEventSeq(tx, sessionId);
      return { ok: true, itemStatus: next, closureStatus: closure ?? session.closure_status, sessionVersion: session.version + 1 };
    });
  }

  async function rebindItem(frame: RequestFrame, sessionId: string, itemId: string): Promise<Record<string, unknown>> {
    return withIxCommand(kernel, frame, 'inspection-rebind', { sessionId, itemId }, async (tx, h, auth) => {
      const session = await sessionOr404(tx, sessionId, true);
      requireNotClosed(session);
      const item = await tx.query(`SELECT * FROM inspection_items WHERE item_id = $1 AND session_id = $2 FOR UPDATE`, [itemId, sessionId]);
      if (item.rows.length === 0) throw notFound('核验项不存在');
      const it = item.rows[0] as unknown as ItemRow;
      requireRosterRole(auth, session, it.responsible_role);
      if (it.status !== 'stale_review') throw conflict('NOT_READY', `核验项当前 ${it.status}：仅 stale_review 需要重新关联`);
      const objectRef = reqString(frame.objectRef, 'objectRef', 200);
      const anchors = [...it.anchors, { objectRef, sceneVersion: session.scene_version, boundAt: new Date().toISOString(), by: auth.principal.principalId }];
      // 显式重关联：保留原锚定历史（不覆盖、不按相似名称自动换绑）；重关联后重新走核验流程。
      await tx.query(
        `UPDATE inspection_items SET object_ref = $2, anchors = $3, status = 'pending', version = version + 1, updated_at = now() WHERE item_id = $1`,
        [itemId, objectRef, JSON.stringify(anchors)],
      );
      // 旧锚定下的开放问题随之关闭（对象已变，旧回答不应再计入）；新锚定需新建问题（dedup 键含对象）
      await tx.query(
        `UPDATE inspection_questions SET status = 'closed' WHERE item_id = $1 AND status IN ('open','sent')`,
        [itemId],
      );
      await h.audit({
        actor: auth.principal.principalId, action: 'inspection_item_rebound', targetType: 'inspection_item', targetId: itemId,
        projectId: session.project_id, summary: `重新关联 → ${objectRef}（场景 ${session.scene_version}；原引用保留于 anchors）`,
        payload: { objectRef, previousObjectRef: it.object_ref },
      });
      await h.emit({
        eventType: 'INSPECTION_ITEM_STATUS', projectId: session.project_id, customerId: session.customer_id,
        payload: { sessionId, itemId, itemKey: it.item_key, from: 'stale_review', to: 'pending', reboundTo: objectRef },
      });
      return { ok: true, itemStatus: 'pending', anchors, sessionVersion: session.version + 1 };
    });
  }

  async function reassignItem(frame: RequestFrame, sessionId: string, itemId: string): Promise<Record<string, unknown>> {
    return withIxCommand(kernel, frame, 'inspection-reassign', { sessionId, itemId }, async (tx, h, auth) => {
      const session = await sessionOr404(tx, sessionId, true);
      requireOwner(auth, session);
      requireNotClosed(session);
      const item = await tx.query(`SELECT * FROM inspection_items WHERE item_id = $1 AND session_id = $2 FOR UPDATE`, [itemId, sessionId]);
      if (item.rows.length === 0) throw notFound('核验项不存在');
      const it = item.rows[0] as unknown as ItemRow;
      const toRole = reqString(frame.toRole, 'toRole', 64);
      if (!session.roles.some((r) => r.roleKey === toRole)) throw invalid('toRole 不在会话名册中（改派只在已有权限内发生）');
      const fromRole = it.assigned_role ?? it.responsible_role;
      const reason = reqString(frame.reason ?? '', 'reason', 500, 0);
      await tx.query(
        `UPDATE inspection_items SET assigned_role = $2, version = version + 1, updated_at = now() WHERE item_id = $1`,
        [itemId, toRole],
      );
      await h.audit({
        actor: auth.principal.principalId, action: 'inspection_item_reassigned', targetType: 'inspection_item', targetId: itemId,
        projectId: session.project_id, summary: `改派 ${fromRole} → ${toRole}${reason ? `（${reason}）` : ''}`,
        payload: { fromRole, toRole, reason },
      });
      return { ok: true, fromRole, toRole, sessionVersion: session.version + 1 };
    });
  }

  // ---- 问题/回答/追问 -----------------------------------------------------------

  function dedupKeyOf(objectRef: string | null, period: string | null, purpose: string, audience: string, targetRole: string): string {
    // 去重键 = 对象|期间|目的|受众|回答权限：任一不同 → 键不同 → 保留差异（相似文本不合并）
    return sha256(canonicalHash({ objectRef, period, purpose, audience, targetRole }));
  }

  async function createQuestion(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>> {
    return withIxCommand(kernel, frame, 'inspection-question-create', { sessionId }, async (tx, h, auth) => {
      const session = await sessionOr404(tx, sessionId, true);
      requireNotClosed(session);
      requireRunning(session);
      const audience = frame.audience;
      if (audience !== 'customer' && audience !== 'internal') throw invalid('audience 必须 customer|internal');
      const targetRole = reqString(frame.targetRole, 'targetRole', 64);
      const rosterEntry = session.roles.find((r) => r.roleKey === targetRole);
      if (rosterEntry === undefined) throw invalid('targetRole 不在会话名册中');
      const requiresHuman = reqBool(frame.requiresHuman, 'requiresHuman', rosterEntry.kind === 'human');
      let itemId: string | null = null;
      if (frame.itemId !== undefined && frame.itemId !== null) {
        itemId = reqString(frame.itemId, 'itemId', 64);
        const it = await tx.query(`SELECT 1 FROM inspection_items WHERE item_id = $1 AND session_id = $2`, [itemId, sessionId]);
        if (it.rows.length === 0) throw notFound('核验项不存在');
        const cnt = await tx.query(`SELECT COUNT(*) AS n FROM inspection_questions WHERE item_id = $1`, [itemId]);
        if (Number((cnt.rows[0] as { n: string }).n) >= session.config.maxQuestionsPerItem) {
          throw conflict('FOLLOWUP_LIMIT_REACHED', `核验项问题数已达上限 ${session.config.maxQuestionsPerItem}`);
        }
      }
      const objectRef = frame.objectRef === undefined || frame.objectRef === null ? null : reqString(frame.objectRef, 'objectRef', 200);
      const period = frame.period === undefined || frame.period === null ? null : reqString(frame.period, 'period', 120);
      const purpose = reqString(frame.purpose ?? 'clarify', 'purpose', 64);
      const dedupKey = dedupKeyOf(objectRef, period, purpose, audience, targetRole);
      // 去重：同键开放问题已存在 → 返回原问题（不新建）；键不同 → 保留为独立问题
      const dup = await tx.query(
        `SELECT question_id FROM inspection_questions WHERE session_id = $1 AND dedup_key = $2 AND status IN ('open','sent')`,
        [sessionId, dedupKey],
      );
      if (dup.rows.length > 0) {
        return { ok: true, duplicate: true, questionId: (dup.rows[0] as { question_id: string }).question_id };
      }
      const questionId = newId('q');
      await tx.query(
        `INSERT INTO inspection_questions (question_id, session_id, item_id, dedup_key, audience, target_role, requires_human,
           question, purpose, period, object_ref, fact_key, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [questionId, sessionId, itemId, dedupKey, audience, targetRole, requiresHuman,
         reqString(frame.question, 'question', 4000), purpose, period, objectRef,
         frame.factKey === undefined || frame.factKey === null ? null : reqString(frame.factKey, 'factKey', 200),
         auth.principal.principalId],
      );
      if (itemId !== null) await refreshItems(tx, session, h, auth.principal.principalId);
      await h.audit({
        actor: auth.principal.principalId, action: 'inspection_question_created', targetType: 'inspection_question', targetId: questionId,
        projectId: session.project_id, summary: `问题（${audience}/${targetRole}${requiresHuman ? '/需真人' : ''}）`, payload: { itemId, purpose },
      });
      return { ok: true, duplicate: false, questionId, sessionVersion: session.version + 1 };
    });
  }

  async function answerQuestion(frame: RequestFrame, sessionId: string, questionId: string): Promise<Record<string, unknown>> {
    return withIxCommand(kernel, frame, 'inspection-question-answer', { sessionId, questionId }, async (tx, h, auth) => {
      const session = await sessionOr404(tx, sessionId, true);
      requireNotClosed(session);
      const qr = await tx.query(`SELECT * FROM inspection_questions WHERE question_id = $1 AND session_id = $2 FOR UPDATE`, [questionId, sessionId]);
      if (qr.rows.length === 0) throw notFound('问题不存在');
      const q = qr.rows[0] as unknown as QuestionRow;
      // A11：锚定已陈旧（场景前移未重关联）→ 旧锚定的回答被拒；设备问题不得移到别的对象
      if (q.item_id !== null) {
        const itemRow = await tx.query(`SELECT status FROM inspection_items WHERE item_id = $1`, [q.item_id]);
        const st = (itemRow.rows[0] as { status: ItemStatus } | undefined)?.status;
        if (st === 'stale_review') {
          throw conflict('SCENE_ANCHOR_STALE', '该核验项锚定已陈旧（场景版本前移）：须显式重新关联后重新提问，不接受旧锚定的回答');
        }
      }
      // 真人关键核验不得由 Agent 冒充：先于名册判定给出明确语义
      if (q.requires_human && auth.principal.kind !== 'human') {
        throw forbidden('ANSWER_REQUIRES_HUMAN', '该问题要求真人回答（关键核验不得由 Agent 冒充完成）');
      }
      // 回答权限 = 目标回答角色
      requireRosterRole(auth, session, q.target_role);
      if (q.status === 'answered' || q.status === 'closed') {
        // A05：重复回调不重复记账——同 requestId 幂等重放在外层已处理；新 requestId 视为冲突
        throw conflict('QUESTION_CLOSED', `问题当前 ${q.status}：不接受重复回答（不重复记账）`);
      }
      const answerIn = reqObject(frame.answer ?? {}, 'answer');
      const text = reqString(answerIn.text ?? '', 'answer.text', 4000, 0);
      const conflictFlag = reqBool(answerIn.conflict, 'answer.conflict', false);
      const refs: { artifactId: string }[] = [];
      for (const ref of Array.isArray(answerIn.evidenceRefs) ? answerIn.evidenceRefs as unknown[] : []) {
        const artifactId = reqString(typeof ref === 'string' ? ref : reqObject(ref, 'evidenceRefs[]').artifactId, 'artifactId', 64);
        const art = await tx.query(
          `SELECT artifact_id FROM evidence_artifacts WHERE artifact_id = $1 AND customer_id = $2 AND superseded_by IS NULL`,
          [artifactId, session.customer_id],
        );
        if (art.rows.length === 0) throw invalid(`answer.evidenceRefs 引用不存在/已取代的材料：${artifactId}`);
        refs.push({ artifactId });
      }
      const answer = { text, evidenceRefs: refs, conflict: conflictFlag, answeredBy: auth.principal.principalId, answeredAt: new Date().toISOString() };
      await tx.query(
        `UPDATE inspection_questions SET status = 'answered', answer = $2, answered_at = now() WHERE question_id = $1`,
        [questionId, JSON.stringify(answer)],
      );
      if (conflictFlag && q.item_id !== null) {
        await tx.query(`UPDATE inspection_items SET status = 'conflict', version = version + 1, updated_at = now() WHERE item_id = $1`, [q.item_id]);
      }
      if (q.item_id !== null) await refreshItems(tx, session, h, auth.principal.principalId);
      await h.audit({
        actor: auth.principal.principalId, action: 'inspection_question_answered', targetType: 'inspection_question', targetId: questionId,
        projectId: session.project_id, summary: `回答登记（${text.slice(0, 40)}${text.length > 40 ? '…' : ''}）`, payload: { conflict: conflictFlag, refs },
      });
      await h.emit({
        eventType: 'INSPECTION_QUESTION_ANSWERED', projectId: session.project_id, customerId: session.customer_id,
        payload: { sessionId, questionId, itemId: q.item_id, conflict: conflictFlag },
      });
      await touchEventSeq(tx, sessionId);
      return { ok: true, status: 'answered', sessionVersion: session.version + 1 };
    });
  }

  async function reaskQuestion(frame: RequestFrame, sessionId: string, questionId: string): Promise<Record<string, unknown>> {
    return withIxCommand(kernel, frame, 'inspection-question-reask', { sessionId, questionId }, async (tx, h, auth) => {
      const session = await sessionOr404(tx, sessionId, true);
      requireRunning(session);
      requireNotClosed(session);
      requireRosterRole(auth, session, session.owner_role);
      const qr = await tx.query(`SELECT * FROM inspection_questions WHERE question_id = $1 AND session_id = $2 FOR UPDATE`, [questionId, sessionId]);
      if (qr.rows.length === 0) throw notFound('问题不存在');
      const q = qr.rows[0] as unknown as QuestionRow;
      // 发送结果未知 → 先对账或转人工，不得换 requestId 再问一次
      const outbound = await loadOutbound(tx, sessionId);
      const unknown = outbound.find((o) => o.question_id === questionId && o.status === 'unknown');
      if (unknown !== undefined) {
        throw conflict('SEND_UNKNOWN_RECONCILE', `发送结果未知（send ${unknown.send_id}）：先对账或转人工，不得直接重问`, { sendId: unknown.send_id });
      }
      if (q.status === 'answered' || q.status === 'closed') {
        throw conflict('QUESTION_CLOSED', `问题当前 ${q.status}：追问请新建问题（目的/对象不同将保留差异）`);
      }
      if (q.follow_up_count >= session.config.maxFollowUpsPerQuestion) {
        throw conflict('FOLLOWUP_LIMIT_REACHED', `追问已达上限 ${session.config.maxFollowUpsPerQuestion}：转待办（sweep），不无限重试`);
      }
      await tx.query(
        `UPDATE inspection_questions SET follow_up_count = follow_up_count + 1, status = 'open' WHERE question_id = $1`,
        [questionId],
      );
      await h.audit({
        actor: auth.principal.principalId, action: 'inspection_question_reasked', targetType: 'inspection_question', targetId: questionId,
        projectId: session.project_id, summary: `追问（第 ${q.follow_up_count + 1} 次）`, payload: {},
      });
      return { ok: true, followUpCount: q.follow_up_count + 1, questionStatus: 'open', sessionVersion: session.version + 1 };
    });
  }

  // ---- 外发授权（A04/A05 的发送控制点） -------------------------------------------

  async function grantOutbound(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>> {
    return withIxCommand(kernel, frame, 'inspection-outbound-grant', { sessionId }, async (tx, h, auth) => {
      const session = await sessionOr404(tx, sessionId, true);
      requireVerified(auth);
      // 调度者（agent）或会话人类角色都可申请；但必须携带当前调度代际
      if (session.outbound_paused) {
        throw conflict('OUTBOUND_PAUSED', '会话外发已暂停：不授予新的自动外发（在途请求单独列明）');
      }
      if (session.run_status !== 'in_progress') {
        throw conflict('SESSION_NOT_RUNNING', `会话当前 ${session.run_status}：不授予外发`);
      }
      const generation = reqInt(frame.generation, 'generation');
      if (generation !== session.dispatch_generation) {
        throw conflict('STALE_DISPATCH_GENERATION', `调度代际过期：当前 ${session.dispatch_generation}，请求 ${generation}（旧调度者不得绕过暂停）`,
          { currentGeneration: session.dispatch_generation });
      }
      const questionId = reqString(frame.questionId, 'questionId', 64);
      const qr = await tx.query(`SELECT * FROM inspection_questions WHERE question_id = $1 AND session_id = $2 FOR UPDATE`, [questionId, sessionId]);
      if (qr.rows.length === 0) throw notFound('问题不存在');
      const q = qr.rows[0] as unknown as QuestionRow;
      if (q.status !== 'open') {
        throw conflict('NOT_READY', `问题当前 ${q.status}：仅 open 可授权外发（重复授权同 requestId 幂等重放，不产生新外发）`);
      }
      if (session.takeover_by !== null) {
        throw conflict('OUTBOUND_PAUSED', `会话处于人工接管（${session.takeover_by}）：不授予自动外发`);
      }
      const channel = reqString(frame.channel ?? 'chat', 'channel', 32);
      const sendId = newId('send');
      await tx.query(
        `INSERT INTO inspection_outbound (send_id, session_id, question_id, generation, request_id, channel) VALUES ($1,$2,$3,$4,$5,$6)`,
        [sendId, sessionId, questionId, generation, reqString(frame.requestId, 'requestId', 128), channel],
      );
      await tx.query(`UPDATE inspection_questions SET status = 'sent' WHERE question_id = $1`, [questionId]);
      await h.audit({
        actor: auth.principal.principalId, action: 'inspection_outbound_granted', targetType: 'inspection_outbound', targetId: sendId,
        projectId: session.project_id, summary: `外发授权（问题 ${questionId}；代际 ${generation}；渠道 ${channel}）`, payload: { generation, channel },
      });
      await h.emit({
        eventType: 'INSPECTION_OUTBOUND_GRANTED', projectId: session.project_id, customerId: session.customer_id,
        payload: { sessionId, sendId, questionId, generation, channel },
      });
      return { ok: true, sendId, questionId, generation, status: 'authorized', sessionVersion: session.version };
    });
  }

  async function outboundResult(frame: RequestFrame, sessionId: string, sendId: string): Promise<Record<string, unknown>> {
    return withIxCommand(kernel, frame, 'inspection-outbound-result', { sessionId, sendId }, async (tx, h, auth) => {
      const session = await sessionOr404(tx, sessionId, true);
      requireVerified(auth);
      const or = await tx.query(`SELECT * FROM inspection_outbound WHERE send_id = $1 AND session_id = $2 FOR UPDATE`, [sendId, sessionId]);
      if (or.rows.length === 0) throw notFound('外发记录不存在');
      const o = or.rows[0] as unknown as OutboundRow;
      if (o.status !== 'authorized') {
        // A05：重复回调不重复记账（同 requestId 幂等重放由外层处理；异 requestId 结果变更需人工）
        throw conflict('QUESTION_CLOSED', `外发记录当前 ${o.status}：结果已登记，不重复记账`);
      }
      const outcome = frame.outcome;
      if (outcome !== 'sent' && outcome !== 'unknown' && outcome !== 'cancelled' && outcome !== 'cancel_unsupported') {
        throw invalid('outcome 必须 sent|unknown|cancelled|cancel_unsupported');
      }
      await tx.query(
        `UPDATE inspection_outbound SET status = $2, resulted_at = now() WHERE send_id = $1`, [sendId, outcome],
      );
      const note = reqString(frame.note ?? '', 'note', 500, 0);
      await h.audit({
        actor: auth.principal.principalId, action: 'inspection_outbound_result', targetType: 'inspection_outbound', targetId: sendId,
        projectId: session.project_id, summary: `外发结果 ${outcome}${note ? `（${note}）` : ''}`, payload: { outcome },
      });
      await h.emit({
        eventType: 'INSPECTION_OUTBOUND_RESULT', projectId: session.project_id, customerId: session.customer_id,
        payload: { sessionId, sendId, questionId: o.question_id, outcome, generation: o.generation },
      });
      // unknown 保持问题 sent 态：等待对账，不盲重问
      return { ok: true, sendId, status: outcome };
    });
  }

  // ---- 等待/追问边界（A07） ------------------------------------------------------

  async function sweep(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>> {
    return withIxCommand(kernel, frame, 'inspection-sweep', { sessionId }, async (tx, h, auth) => {
      const session = await sessionOr404(tx, sessionId, true);
      requireVerified(auth);
      requireNotClosed(session);
      const questions = await loadQuestions(tx, sessionId);
      const items = await loadItems(tx, sessionId);
      const outbound = await loadOutbound(tx, sessionId);
      const followups = await loadFollowups(tx, sessionId);
      const deferred: { itemId: string; followupId: string }[] = [];
      for (const q of questions) {
        if (q.status !== 'sent' || q.item_id === null) continue;
        const it = items.find((i) => i.item_id === q.item_id);
        if (it === undefined || ['verified', 'conflict', 'deferred', 'stale_review'].includes(it.status)) continue;
        // 参与者被要求分批补证/系统故障都不是客户失信：待办如实标注原因类别
        const sends = outbound.filter((o) => o.question_id === q.question_id);
        const hasUnknown = sends.some((o) => o.status === 'unknown');
        const lastSend = sends.length > 0 ? sends[sends.length - 1] : undefined;
        const lastSendAt = lastSend !== undefined ? lastSend.created_at : q.created_at;
        const ageSeconds = (Date.now() - new Date(lastSendAt).getTime()) / 1000;
        const overWait = ageSeconds > session.config.waitTimeoutSeconds;
        const overFollowUps = q.follow_up_count >= session.config.maxFollowUpsPerQuestion;
        if (!overWait && !overFollowUps) continue;
        const openFu = followups.find((f) => f.item_id === it.item_id && f.status === 'open');
        if (openFu !== undefined) continue; // 每事项至多一条 open 待办
        const fid = newId('fu');
        const reason = hasUnknown
          ? `系统/渠道发送结果未知（对账中，非客户失信）：${it.title}`
          : overFollowUps
            ? `追问已达上限（${q.follow_up_count} 次）：${it.title}`
            : `等待回答超时（>${session.config.waitTimeoutSeconds}s）：${it.title}`;
        await tx.query(
          `INSERT INTO inspection_followups (followup_id, session_id, item_id, owner_role, reason, next_action, closure_revision)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [fid, sessionId, it.item_id, it.assigned_role ?? it.responsible_role, reason,
           hasUnknown ? '人工对账发送回执后再处理' : '人工跟进后重问或改派', session.closure_revision],
        );
        await tx.query(`UPDATE inspection_items SET status = 'deferred', version = version + 1, updated_at = now() WHERE item_id = $1`, [it.item_id]);
        await tx.query(`UPDATE inspection_questions SET status = 'closed' WHERE question_id = $1`, [q.question_id]);
        deferred.push({ itemId: it.item_id, followupId: fid });
        await h.emit({
          eventType: 'FOLLOWUP_REQUIRED', projectId: session.project_id, customerId: session.customer_id,
          payload: { sessionId, followupId: fid, itemId: it.item_id, reasonKind: hasUnknown ? 'send_unknown' : overFollowUps ? 'followup_limit' : 'wait_timeout' },
        });
      }
      if (deferred.length > 0) {
        await refreshItems(tx, session, h, auth.principal.principalId);
        const closure = await recomputeClosure(tx, session, h);
        await storeSummaries(tx, session);
        await touchEventSeq(tx, sessionId);
        return { ok: true, deferred, closureStatus: closure ?? session.closure_status };
      }
      return { ok: true, deferred: [] };
    });
  }

  // ---- 会后接续（A10） -----------------------------------------------------------

  async function addLateEvidence(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>> {
    return withIxCommand(kernel, frame, 'inspection-late-evidence', { sessionId }, async (tx, h, auth) => {
      const session = await sessionOr404(tx, sessionId, true);
      requireOwner(auth, session);
      requireNotClosed(session);
      const artifactId = reqString(frame.artifactId, 'artifactId', 64);
      const art = await tx.query(
        `SELECT artifact_id, kind FROM evidence_artifacts WHERE artifact_id = $1 AND customer_id = $2 AND superseded_by IS NULL AND duplicate_of IS NULL`,
        [artifactId, session.customer_id],
      );
      if (art.rows.length === 0) throw notFound('材料不存在或已被取代');
      const kind = (art.rows[0] as { kind: string }).kind;
      // 只重开受影响事项：期望材料 kind 命中且当前处于等待材料/已转待办状态
      const items = await loadItems(tx, sessionId);
      const affected = items.filter((i) =>
        i.expected_evidence_kinds.includes(kind) && ['waiting_evidence', 'deferred', 'answered'].includes(i.status));
      const reopened: string[] = [];
      for (const it of affected) {
        await tx.query(
          `UPDATE inspection_items SET status = 'answered', version = version + 1, updated_at = now() WHERE item_id = $1`,
          [it.item_id],
        );
        reopened.push(it.item_id);
        await h.emit({
          eventType: 'INSPECTION_ITEM_REOPENED', projectId: session.project_id, customerId: session.customer_id,
          payload: { sessionId, itemId: it.item_id, itemKey: it.item_key, by: artifactId, closureRevision: session.closure_revision },
        });
      }
      let newRevision = session.closure_revision;
      if (session.run_status === 'ended' && reopened.length > 0) {
        newRevision = session.closure_revision + 1;
        await tx.query(
          `UPDATE inspection_sessions SET closure_revision = $2, version = version + 1, updated_at = now() WHERE session_id = $1`,
          [sessionId, newRevision],
        );
        // 历史小结不改写（inspection_summaries 按修订固化）；新修订的新小结由 end/verify 后的 recompute 生成
      }
      const after = { ...session, closure_revision: newRevision };
      if (reopened.length > 0) await refreshItems(tx, after, h, auth.principal.principalId);
      const closure = await recomputeClosure(tx, after, h);
      await storeSummaries(tx, after);
      await h.audit({
        actor: auth.principal.principalId, action: 'inspection_late_evidence', targetType: 'inspection_session', targetId: sessionId,
        projectId: session.project_id, summary: `晚到材料 ${artifactId}（${kind}）：重开 ${reopened.length} 项；revision → ${newRevision}`,
        payload: { artifactId, kind, reopened, closureRevision: newRevision },
      });
      if (closure === 'ready_for_assessment') {
        // recomputeClosure 已发 INSPECTION_READY_FOR_ASSESSMENT（携带新 revision）
      }
      await touchEventSeq(tx, sessionId);
      return { ok: true, reopened, closureRevision: newRevision, closureStatus: closure ?? session.closure_status, sessionVersion: session.version + 1 };
    });
  }

  async function writeCheckpointCommand(frame: RequestFrame, sessionId: string): Promise<Record<string, unknown>> {
    return withIxCommand(kernel, frame, 'inspection-checkpoint', { sessionId }, async (tx, h, auth) => {
      const session = await sessionOr404(tx, sessionId, true);
      requireOwner(auth, session);
      const checkpointId = await writeCheckpoint(tx, session, 'manual');
      await h.audit({
        actor: auth.principal.principalId, action: 'inspection_checkpoint', targetType: 'inspection_session', targetId: sessionId,
        projectId: session.project_id, summary: `手动 checkpoint ${checkpointId}`, payload: { checkpointId },
      });
      return { ok: true, checkpointId, lastEventSeq: Number(session.last_event_seq) };
    });
  }

  async function getSummaries(sessionId: string, audience: string | null, revision: number | null, credential: unknown): Promise<Record<string, unknown>> {
    const client = await kernel.pool.connect();
    try {
      const session = await sessionOr404(client, sessionId);
      const wanted = audience === null || audience === undefined ? null : reqString(audience, 'audience', 16);
      if (wanted !== null && wanted !== 'internal' && wanted !== 'customer') throw invalid('audience 必须 internal|customer');
      // 内部版含获准风险依据：仅 admin 或会话名册角色可读；客户版放开给已验证身份
      if (wanted !== 'customer') {
        const auth = await kernel.authOf(credential);
        requireVerified(auth);
        const isRoster = auth.principal.roles.includes('admin') || session.roles.some((r) => auth.principal.roles.includes(r.roleKey));
        if (!isRoster) throw forbidden('ROLE_FORBIDDEN', '内部小结仅会话名册角色/admin 可读');
      }
      const rows = await client.query(
        `SELECT summary_id, closure_revision, audience, content, created_at FROM inspection_summaries
         WHERE session_id = $1 ${wanted !== null ? 'AND audience = $2' : ''} ORDER BY closure_revision, audience`,
        wanted !== null ? [sessionId, wanted] : [sessionId],
      );
      // 契约：响应一律驼峰投影（不外泄蛇形列名）
      let list = (rows.rows as Record<string, unknown>[]).map((r) => ({
        summaryId: r.summary_id,
        closureRevision: Number(r.closure_revision),
        audience: r.audience,
        content: r.content,
        createdAt: r.created_at,
      }));
      if (revision !== null && revision !== undefined && Number.isFinite(revision)) {
        list = list.filter((r) => r.closureRevision === revision);
      }
      return { ok: true, summaries: list };
    } finally {
      client.release();
    }
  }

  return {
    createSession, getSession, getNextActions,
    revisePlan, reviseScene, startSession, pauseSession, resumeSession, endSession, closeSession,
    setPresence, takeoverSession,
    addItem, verifyItem, rebindItem, reassignItem,
    createQuestion, answerQuestion, reaskQuestion,
    grantOutbound, outboundResult, sweep,
    addLateEvidence, writeCheckpointCommand, getSummaries,
  };
}
