// 目标协作内核（CONTRACT §2–§5）：全部写命令 = 事务内 幂等查 → 行锁 → 授权 → 状态机 →
// outbox/audit 同事务落库。目标不能自报完成：complete 最多 candidate_ready；accept/decide 仅人类验收/决定角色。
import type { Pool, PoolClient } from 'pg';
import { AppError, conflict, forbidden, invalid, notFound } from './errors.ts';
import { assertNoForbiddenKeys, canonicalHash, newId, sha256, uuid } from './util.ts';
import type { Config, Principal } from '../config.ts';
import { authenticate, authorizeProject, requireAdmin, requireRole, requireSensitive, requireVerified, type Auth, type PrincipalVerifier } from './principal.ts';
import { type GoalRow } from './status.ts';
import { findCycle, invalidateForEvidence, loadGoals, recomputeReady, type TxHelpers } from './recompute.ts';
import { computeStaleMap, type StaleInfo } from './staleness.ts';
import { buildCreditCommands, type CreditV2Api } from './credit.ts';
import { buildReviewCommands, type ReviewApi } from './review.ts';
import { buildPackageCommands, type PackageApi } from './package.ts';
import { buildReportCommands, type ReportsApi } from './reports.ts';
import { buildAnalysisCommands, type AnalysisApi } from './analysis.ts';
import { buildInspectionCommands, type InspectionApi } from './inspection.ts';

const MAX_BODY_JSON = 1 << 20;      // 1MB 请求体上限
const MAX_RESULT_JSON = 64 << 10;   // 候选结果上限（上下文限额守卫的一部分）
const PROVIDERS = ['simulation', 'real_http', 'calculation'];

export interface KernelOptions {
  config: Config;
  verifier: PrincipalVerifier | null;
}

/** Pool 与 PoolClient 的公共查询面（最小接口，兼容 pg 两者的 query 重载）。 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Queryable {
  query(sql: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

interface RequestFrame {
  credential?: unknown;
  requestId?: unknown;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// helpers（事务内）
// ---------------------------------------------------------------------------

function serializeTemplate(r: Record<string, unknown>): Record<string, unknown> {
  return {
    templateId: r.template_id, version: r.version, name: r.name, industry: r.industry,
    roles: r.roles, goals: r.goals, createdBy: r.created_by, createdAt: r.created_at,
  };
}

/** human_requests 行 → 契约驼峰投影（getProject 与 listHumanRequests 共用；OBS-1）。 */
function projectHumanRequestRow(h: Record<string, unknown>): Record<string, unknown> {
  return {
    hrequestId: h.hrequest_id,
    projectId: h.project_id,
    goalId: h.goal_id,
    kind: h.kind,
    question: h.question,
    requestedRole: h.requested_role,
    requiredEvidenceKinds: h.required_evidence_kinds,
    status: h.status,
    answer: h.answer,
    createdBy: h.created_by,
    createdAt: h.created_at,
  };
}

/** 幂等统一入口（CONTRACT §3.3 + 任务01 A1.3）：鉴权先于任何缓存回执（X03 反例关闭）；
 *  幂等归属绑定 principal（跨主体同 requestId → REQUEST_MISMATCH，不得读取他人回执）；
 *  miss → 执行写事务；同主体同载荷重放 → 原响应+replayed；异载荷/异主体 → REQUEST_MISMATCH。
 *  写入后唯一键冲突（并发同 requestId）→ 回滚本事务，重读重放（同一主体才可重放）。 */
async function withCommand<T extends object>(
  kernel: Kernel, frame: RequestFrame, op: string,
  fn: (tx: PoolClient, helpers: TxHelpers, actor: string | null) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const { requestId, credential, __path, ...payload } = frame;
  void __path; // v1 幂等载荷哈希不含路径：保持 v1 行为不变（v2 在 credit.ts 内另行绑定路径资源）
  if (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 128) {
    throw invalid('requestId 必须是 1..128 长度的 string');
  }
  // A1.3：身份验证先于缓存查询；无效凭据在此失败（403），匿名按 'unverified' 主体参与归属
  const auth = await kernel.authOf(credential);
  const principalId = auth.principal.principalId;
  const isAdmin = auth.principal.roles.includes('admin');
  const payloadHash = canonicalHash({ op, payload, principal: principalId });
  const pool = kernel.pool;
  const prior = await pool.query(`SELECT payload_sha256, response, principal_id FROM idempotency WHERE request_id = $1`, [requestId]);
  if (prior.rows.length > 0) {
    const row = prior.rows[0] as { payload_sha256: string; response: Record<string, unknown>; principal_id: string | null };
    replayOwnership(row, principalId, requestId, isAdmin);
    if (row.payload_sha256 !== payloadHash) {
      throw conflict('REQUEST_MISMATCH', `requestId ${requestId} 已绑定不同载荷（幂等一致性保护）`);
    }
    return { ...row.response, replayed: true };
  }
  try {
    return await runTx(pool, async (tx) => {
      const actor = kernel.actorLabel(credential);
      const helpers = await txHelpers(tx, actor);
      const response = await fn(tx, helpers, actor);
      await tx.query(
        `INSERT INTO idempotency (request_id, payload_sha256, response, principal_id, op) VALUES ($1,$2,$3,$4,$5)`,
        [requestId, payloadHash, JSON.stringify(response), principalId, op],
      );
      return response;
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (isUniqueViolation(error)) {
      const again = await pool.query(`SELECT payload_sha256, response, principal_id FROM idempotency WHERE request_id = $1`, [requestId]);
      if (again.rows.length > 0) {
        const row = again.rows[0] as { payload_sha256: string; response: Record<string, unknown>; principal_id: string | null };
        replayOwnership(row, principalId, requestId, isAdmin);
        if (row.payload_sha256 === payloadHash) return { ...row.response, replayed: true };
        throw conflict('REQUEST_MISMATCH', `requestId ${requestId} 已绑定不同载荷（幂等一致性保护）`);
      }
    }
    throw error;
  }
}

/** 幂等回执归属（A1.3/A1.4）：同主体可重放查看；异主体/legacy 无主行 → REQUEST_MISMATCH（admin 豁免查看 legacy）。 */
function replayOwnership(row: { principal_id: string | null }, principalId: string, requestId: string, isAdmin: boolean): void {
  if (row.principal_id === principalId) return;
  if (row.principal_id === null && isAdmin) return; // legacy 行（迁移前）仅 admin 可读
  void requestId;
  throw conflict('REQUEST_MISMATCH', `requestId 属于其他 principal：不泄露他人回执`);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

async function runTx(pool: Pool, fn: (tx: PoolClient) => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
  const client = await pool.connect();
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

async function txHelpers(tx: PoolClient, actor: string | null): Promise<TxHelpers> {
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
        `INSERT INTO outbox_events (event_id, event_type, project_id, goal_id, payload) VALUES ($1,$2,$3,$4,$5)`,
        [uuid(), event.eventType, event.projectId, event.goalId, JSON.stringify(event.payload)],
      );
    },
  };
}

// 校验工具
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
function checkJsonSize(v: unknown, label: string, max: number): void {
  const size = JSON.stringify(v ?? null)?.length ?? 0;
  if (size > max) throw invalid(`${label} 超出 ${max} 字节限额（上下文/载荷守卫）`);
}

// ---------------------------------------------------------------------------
// Kernel
// ---------------------------------------------------------------------------

export class Kernel {
  readonly pool: Pool;
  private readonly config: Config;
  private readonly verifier: PrincipalVerifier | null;
  /** v2 客户授信 + 决策闭环命令面（任务01 授信 + 任务02 评审/依据包/报告 + 任务01 A2 可信回执通道）。 */
  readonly v2: CreditV2Api & ReviewApi & PackageApi & ReportsApi & AnalysisApi;
  /** 检查会话命令面（任务一；联合尽调会话的运行/收口/调度/恢复）。 */
  readonly ix: InspectionApi;
  /** 可信规则回执通道（任务01 A2）：规则版本激活/Gate 回执/分析运行登记。 */
  readonly analysis: AnalysisApi;

  constructor(pool: Pool, options: KernelOptions) {
    this.pool = pool;
    this.config = options.config;
    this.verifier = options.verifier;
    this.v2 = {
      ...buildCreditCommands(this),
      ...buildReviewCommands(this),
      ...buildPackageCommands(this),
      ...buildReportCommands(this),
    } as CreditV2Api & ReviewApi & PackageApi & ReportsApi & AnalysisApi;
    this.ix = buildInspectionCommands(this);
    this.analysis = buildAnalysisCommands(this);
  }

  /** v2 授信域访问可信身份源与配置（credit.ts 只经此读取，保持单一 Kernel 实例）。 */
  verifierForV2(): PrincipalVerifier | null {
    return this.verifier;
  }
  configForV2(): Config {
    return this.config;
  }

  /** 审计用 actor 标签（只记 principalId，绝不记凭据）。验证失败在 authenticate 内抛 403。 */
  async authOf(credential: unknown): Promise<Auth> {
    return authenticate(this.verifier, credential);
  }

  actorLabel(credential: unknown): string | null {
    if (typeof credential !== 'string' || credential.length === 0) return 'unverified';
    return `credential:${sha256(credential).slice(0, 12)}`;
  }

  // ---- 模板与项目 ----------------------------------------------------------

  createTemplate(frame: RequestFrame) {
    return withCommand(this, frame, 'create-template', async (tx, helpers) => {
      const auth = await this.authOf(frame.credential);
      requireAdmin(auth);
      const name = reqString(frame.name, 'name', 120);
      const industry = frame.industry === undefined || frame.industry === null ? null : reqString(frame.industry, 'industry', 64);
      const rolesRaw = Array.isArray(frame.roles) ? frame.roles : [];
      const roles = rolesRaw.map((r, i) => {
        const obj = reqObject(r, `roles[${i}]`);
        return {
          roleKey: reqString(obj.roleKey, `roles[${i}].roleKey`, 64),
          title: reqString(obj.title, `roles[${i}].title`, 120),
          isHumanRole: obj.isHumanRole === true,
        };
      });
      const roleKeys = new Set(roles.map((r) => r.roleKey));
      if (roles.length === 0) throw invalid('roles 不能为空');
      const goalsRaw = Array.isArray(frame.goals) ? frame.goals : [];
      if (goalsRaw.length === 0) throw invalid('goals 不能为空');
      const goals = goalsRaw.map((g, i) => {
        const obj = reqObject(g, `goals[${i}]`);
        const goalKey = reqString(obj.goalKey, `goals[${i}].goalKey`, 64);
        const responsibleRole = reqString(obj.responsibleRole, `goals[${i}].responsibleRole`, 64);
        const executorKind = obj.executorKind === 'human' ? 'human' : obj.executorKind === 'agent' ? 'agent' : null;
        if (executorKind === null) throw invalid(`goals[${i}].executorKind 必须 agent|human`);
        if (!roleKeys.has(responsibleRole)) throw invalid(`goals[${i}].responsibleRole 不在模板 roles 中`);
        const acceptanceRole = reqString(obj.acceptanceRole, `goals[${i}].acceptanceRole`, 64);
        const decisionRole = reqString(obj.decisionRole, `goals[${i}].decisionRole`, 64);
        for (const [label, rk] of [['acceptanceRole', acceptanceRole], ['decisionRole', decisionRole]] as const) {
          const role = roles.find((r) => r.roleKey === rk);
          if (role === undefined) throw invalid(`goals[${i}].${label} 不在模板 roles 中`);
          if (!role.isHumanRole) throw invalid(`goals[${i}].${label} 必须是人类角色（验收/决定权威不可授予 agent）`);
        }
        if (goalsRaw.slice(0, i).some((prev: Record<string, unknown>) => (prev as { goalKey?: string }).goalKey === goalKey)) {
          throw invalid(`goals[${i}].goalKey 重复：${goalKey}`);
        }
        return {
          goalKey,
          title: reqString(obj.title, `goals[${i}].title`, 200),
          description: reqString(obj.description ?? '', `goals[${i}].description`, 4000, 0),
          responsibleRole,
          executorKind,
          acceptanceRole,
          decisionRole,
          inputEvidenceKinds: reqStringArray(obj.inputEvidenceKinds ?? [], `goals[${i}].inputEvidenceKinds`),
          dependsOn: reqStringArray(obj.dependsOn ?? [], `goals[${i}].dependsOn`),
          params: reqObject(obj.params ?? {}, `goals[${i}].params`),
        };
      });
      for (const g of goals) {
        for (const dep of g.dependsOn) {
          if (!goals.some((x) => x.goalKey === dep)) throw invalid(`goal ${g.goalKey}.dependsOn 引用不存在的 goalKey：${dep}`);
        }
      }
      const edges = new Map<string, string[]>(goals.map((g) => [g.goalKey, g.dependsOn]));
      const cycle = findCycle(edges);
      if (cycle) throw conflict('DEPENDENCY_CYCLE', `模板依赖存在环：${cycle.join(' → ')}`);
      for (const g of goals) assertNoForbiddenKeys(g.params, `goals[${g.goalKey}].params`);
      const templateId = newId('tpl');
      await tx.query(
        `INSERT INTO goal_templates (template_id, version, name, industry, roles, goals, created_by)
         VALUES ($1,1,$2,$3,$4,$5,$6)`,
        [templateId, name, industry, JSON.stringify(roles), JSON.stringify(goals), auth.principal.principalId],
      );
      await helpers.audit({
        actor: auth.principal.principalId, action: 'template_created', targetType: 'template', targetId: templateId,
        projectId: null, summary: `模板 ${name}（${goals.length} 目标/${roles.length} 角色）`, payload: { name, industry },
      });
      await helpers.emit({ eventType: 'TEMPLATE_CREATED', projectId: null, goalId: null, payload: { templateId, name } });
      return { ok: true, templateId, template: { templateId, version: 1, name, industry, roles, goals } };
    });
  }

  async getTemplate(templateId: string, credential: unknown) {
    const auth = await this.authOf(credential);
    requireVerified(auth);
    const row = await this.pool.query(`SELECT * FROM goal_templates WHERE template_id = $1`, [templateId]);
    if (row.rows.length === 0) throw notFound('模板不存在');
    const r = row.rows[0] as Record<string, unknown>;
    return { ok: true, template: serializeTemplate(r) };
  }

  createProject(frame: RequestFrame) {
    return withCommand(this, frame, 'create-project', async (tx, helpers) => {
      const auth = await this.authOf(frame.credential);
      requireSensitive(auth, null);
      const templateId = reqString(frame.templateId, 'templateId', 64);
      const name = reqString(frame.name, 'name', 120);
      const tpl = await tx.query(`SELECT * FROM goal_templates WHERE template_id = $1`, [templateId]);
      if (tpl.rows.length === 0) throw notFound('模板不存在');
      const t = tpl.rows[0] as Record<string, unknown>;
      const roles = t.roles as { roleKey: string }[];
      const authorized = auth.principal.roles.includes('admin') || roles.some((r) => auth.principal.roles.includes(r.roleKey));
      if (!authorized) throw forbidden('ROLE_FORBIDDEN', 'principal 无该模板角色授权，不能创建项目');
      const projectId = newId('p');
      await tx.query(
        `INSERT INTO projects (project_id, template_id, template_version, name, input_version, created_by)
         VALUES ($1,$2,$3,$4,1,$5)`,
        [projectId, templateId, t.version as number, name, auth.principal.principalId],
      );
      await helpers.audit({
        actor: auth.principal.principalId, action: 'project_created', targetType: 'project', targetId: projectId,
        projectId, summary: `项目 ${name}（模板 ${templateId}）`, payload: { templateId, name },
      });
      await helpers.emit({ eventType: 'PROJECT_CREATED', projectId, goalId: null, payload: { projectId, name, templateId } });
      return { ok: true, projectId, projectInputVersion: 1 };
    });
  }

  async getProject(projectId: string, credential: unknown) {
    const auth = await this.authOf(credential);
    requireVerified(auth);
    authorizeProject(auth.principal, projectId);
    const pr = await this.pool.query(`SELECT * FROM projects WHERE project_id = $1`, [projectId]);
    if (pr.rows.length === 0) throw notFound('项目不存在');
    const project = pr.rows[0] as Record<string, unknown>;
    const goals = await loadGoals(this.pool, projectId);
    const evRes = await this.pool.query(
      `SELECT evidence_id, kind, version, content, sha256, supersedes, superseded_by, input_version, created_at
       FROM evidence WHERE project_id = $1 ORDER BY created_at`, [projectId],
    );
    const evidence = (evRes.rows as Record<string, unknown>[]).map((e) => ({
      evidenceId: e.evidence_id,
      kind: e.kind,
      version: e.version,
      content: e.content,
      sha256: e.sha256,
      supersedes: e.supersedes,
      supersededBy: e.superseded_by,
      inputVersion: e.input_version,
      createdAt: e.created_at,
      current: e.superseded_by === null,
    }));
    const hrRes = await this.pool.query(
      `SELECT * FROM human_requests WHERE project_id = $1 ORDER BY created_at`, [projectId],
    );
    const humanRequests = (hrRes.rows as Record<string, unknown>[]).map(projectHumanRequestRow);
    const smap = await this.staleMap(this.pool, projectId);
    return {
      ok: true,
      project: {
        projectId,
        templateId: project.template_id,
        templateVersion: project.template_version,
        name: project.name,
        status: project.status,
        projectInputVersion: project.input_version,
        createdAt: project.created_at,
        updatedAt: project.updated_at,
      },
      goals: goals.map((g) => this.goalProjection(g, smap.get(g.goal_id))),
      evidence,
      humanRequests,
    };
  }

  /** 事务/连接内计算项目级传递 staleness（DEF-01 v1.3 候选：读时计算，不落库标记）。 */
  private async staleMap(q: Queryable, projectId: string): Promise<Map<string, StaleInfo>> {
    const goals = await loadGoals(q, projectId);
    const ev = await q.query(`SELECT evidence_id, superseded_by FROM evidence WHERE project_id = $1`, [projectId]);
    const index: Map<string, boolean> = new Map();
    for (const row of ev.rows as { evidence_id: string; superseded_by: string | null }[]) {
      index.set(row.evidence_id, row.superseded_by !== null);
    }
    return computeStaleMap(goals, index);
  }

  private goalProjection(g: GoalRow, staleInfo?: StaleInfo): Record<string, unknown> {
    return {
      goalId: g.goal_id, projectId: g.project_id, goalKey: g.goal_key, title: g.title,
      responsibleRole: g.responsible_role, executorKind: g.executor_kind,
      acceptanceRole: g.acceptance_role, decisionRole: g.decision_role,
      params: g.params, dependsOn: g.depends_on,
      inputEvidenceKinds: g.input_evidence_kinds, inputEvidence: g.input_evidence, inputHash: g.input_hash,
      status: g.status, version: g.version,
      // stale 为读时计算的传递性标记（自身或传递依赖的输入已被取代），非持久状态
      stale: staleInfo !== undefined ? staleInfo.stale : g.stale,
      staleRoots: staleInfo !== undefined ? staleInfo.roots : undefined,
      result: g.result, formalDecision: g.formal_decision,
      receiptCount: g.receipt_count, assignedTo: g.assigned_to,
      createdAt: g.created_at, updatedAt: g.updated_at,
    };
  }

  // ---- 目标实例化 ----------------------------------------------------------

  createGoal(frame: RequestFrame, projectId: string) {
    return withCommand(this, frame, 'create-goal', async (tx, helpers) => {
      const auth = await this.authOf(frame.credential);
      authorizeProject(auth.principal, projectId);
      const goalKey = reqString(frame.goalKey, 'goalKey', 64);
      const params = reqObject(frame.params ?? {}, 'params');
      assertNoForbiddenKeys(params, 'params');
      const pr = await tx.query(`SELECT * FROM projects WHERE project_id = $1 FOR UPDATE`, [projectId]);
      if (pr.rows.length === 0) throw notFound('项目不存在');
      const project = pr.rows[0] as Record<string, unknown>;
      if (project.status !== 'active') throw conflict('PROJECT_PAUSED', `项目当前 ${project.status}：不能实例化目标`);
      const tpl = await tx.query(`SELECT * FROM goal_templates WHERE template_id = $1`, [project.template_id]);
      const template = tpl.rows[0] as Record<string, unknown>;
      const defs = template.goals as Record<string, unknown>[];
      const def = defs.find((d) => d.goalKey === goalKey);
      if (def === undefined) throw notFound(`模板中不存在 goalKey：${goalKey}`);
      const dup = await tx.query(`SELECT 1 FROM goals WHERE project_id = $1 AND goal_key = $2`, [projectId, goalKey]);
      if (dup.rows.length > 0) throw conflict('GOAL_EXISTS', `目标已实例化：${goalKey}`);
      // 解析模板依赖 → 已实例化的 goalId；未实例化的依赖 → 该目标保持 blocked 直到依赖实例化并验收
      const existing = await loadGoals(tx, projectId);
      const dependsOn: string[] = [];
      for (const depKey of def.dependsOn as string[]) {
        const dep = existing.find((g) => g.goal_key === depKey);
        dependsOn.push(dep !== undefined ? dep.goal_id : `unresolved:${depKey}`);
      }
      const goalId = newId('g');
      const mergedParams = { ...((def.params ?? {}) as Record<string, unknown>), ...params };
      await tx.query(
        `INSERT INTO goals (goal_id, project_id, goal_key, title, responsible_role, executor_kind,
           acceptance_role, decision_role, params, depends_on, input_evidence_kinds, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'blocked')`,
        [goalId, projectId, goalKey, def.title as string, def.responsibleRole as string, def.executorKind as string,
         def.acceptanceRole as string, def.decisionRole as string, JSON.stringify(mergedParams),
         JSON.stringify(dependsOn), JSON.stringify(def.inputEvidenceKinds ?? [])],
      );
      // 回填：先前实例化、依赖本 goalKey 的目标将 unresolved: 前缀替换为真实 goalId
      for (const other of existing) {
        if (other.depends_on.some((d) => d === `unresolved:${goalKey}`)) {
          const fixed = other.depends_on.map((d) => (d === `unresolved:${goalKey}` ? goalId : d));
          await tx.query(`UPDATE goals SET depends_on = $2 WHERE goal_id = $1`, [other.goal_id, JSON.stringify(fixed)]);
        }
      }
      await helpers.audit({
        actor: auth.principal.principalId, action: 'goal_created', targetType: 'goal', targetId: goalId,
        projectId, summary: `实例化目标 ${goalKey}`, payload: { goalKey, params, dependsOn },
      });
      await helpers.emit({ eventType: 'GOAL_CREATED', projectId, goalId, payload: { goalKey, dependsOn } });
      await recomputeReady(tx, projectId, helpers);
      const created = await tx.query(`SELECT * FROM goals WHERE goal_id = $1`, [goalId]);
      const smap = await this.staleMap(tx, projectId);
      return { ok: true, goal: this.goalProjection(created.rows[0] as GoalRow, smap.get(goalId)) };
    });
  }

  /** 依赖解析守卫：unresolved: 前缀在重算时由 byId.get 缺失自然视为未满足（重算读 depends_on）。 */

  // ---- 证据 ----------------------------------------------------------------

  submitEvidence(frame: RequestFrame, projectId: string) {
    return withCommand(this, frame, 'submit-evidence', async (tx, helpers) => {
      const auth = await this.authOf(frame.credential);
      authorizeProject(auth.principal, projectId);
      const kind = reqString(frame.kind, 'kind', 64);
      const content = reqObject(frame.content, 'content');
      // 证据是业务输入事实（如报价单），不套用候选结果的禁用键规则；权威分离只约束 params/result.output
      checkJsonSize(content, 'content', MAX_RESULT_JSON);
      const expectedVersion = reqInt(frame.expectedVersion, 'expectedVersion');
      // 原子版本门：仅当项目 inputVersion 与期望一致时递增（证据提交防并发静默覆盖）
      const pr = await tx.query(
        `UPDATE projects SET input_version = input_version + 1, updated_at = now()
         WHERE project_id = $1 AND status = 'active' AND input_version = $2 RETURNING input_version`,
        [projectId, expectedVersion],
      );
      if (pr.rows.length === 0) {
        const cur = await tx.query(`SELECT status, input_version FROM projects WHERE project_id = $1`, [projectId]);
        if (cur.rows.length === 0) throw notFound('项目不存在');
        const row = cur.rows[0] as { status: string; input_version: number };
        if (row.status !== 'active') throw conflict('PROJECT_PAUSED', `项目当前 ${row.status}：不能提交证据`);
        throw conflict('VERSION_CONFLICT', `项目输入版本已更新：客户端 v${expectedVersion}，服务端 v${row.input_version}`, { serverVersion: row.input_version });
      }
      const inputVersion = (pr.rows[0] as { input_version: number }).input_version;
      const evidenceId = newId('ev');
      await tx.query(
        `INSERT INTO evidence (evidence_id, project_id, version, kind, content, sha256, input_version)
         VALUES ($1,$2,1,$3,$4,$5,$6)`,
        [evidenceId, projectId, kind, JSON.stringify(content), canonicalHash({ kind, content }), inputVersion],
      );
      await helpers.audit({
        actor: auth.principal.principalId, action: 'evidence_submitted', targetType: 'evidence', targetId: evidenceId,
        projectId, summary: `证据 ${kind}（inputVersion=${inputVersion}）`, payload: { kind },
      });
      await helpers.emit({ eventType: 'EVIDENCE_SUBMITTED', projectId, goalId: null, payload: { evidenceId, kind, inputVersion } });
      await recomputeReady(tx, projectId, helpers);
      return { ok: true, evidenceId, projectInputVersion: inputVersion };
    });
  }

  supersedeEvidence(frame: RequestFrame, projectId: string, evidenceId: string) {
    return withCommand(this, frame, 'supersede-evidence', async (tx, helpers) => {
      const auth = await this.authOf(frame.credential);
      requireSensitive(auth, projectId);
      const content = reqObject(frame.content, 'content');
      checkJsonSize(content, 'content', MAX_RESULT_JSON);
      const old = await tx.query(`SELECT * FROM evidence WHERE evidence_id = $1 AND project_id = $2 FOR UPDATE`, [evidenceId, projectId]);
      if (old.rows.length === 0) throw notFound('证据不存在（跨项目不可访问）');
      const oldRow = old.rows[0] as Record<string, unknown>;
      if (oldRow.superseded_by !== null) {
        throw conflict('EVIDENCE_SUPERSEDED', `证据已被 ${oldRow.superseded_by} 取代`);
      }
      // 原子版本门：取代同样推进项目 inputVersion，需与期望一致（防止并发证据写被静默覆盖）
      const expectedVersion = reqInt(frame.expectedVersion, 'expectedVersion');
      const pr = await tx.query(
        `UPDATE projects SET input_version = input_version + 1, updated_at = now()
         WHERE project_id = $1 AND input_version = $2 RETURNING input_version`,
        [projectId, expectedVersion],
      );
      if (pr.rows.length === 0) {
        const cur = await tx.query(`SELECT input_version FROM projects WHERE project_id = $1`, [projectId]);
        if (cur.rows.length === 0) throw notFound('项目不存在');
        const serverVersion = (cur.rows[0] as { input_version: number }).input_version;
        throw conflict('VERSION_CONFLICT', `项目输入版本已更新：客户端 v${expectedVersion}，服务端 v${serverVersion}`, { serverVersion });
      }
      const inputVersion = (pr.rows[0] as { input_version: number }).input_version;
      const newId_ = newId('ev');
      await tx.query(
        `INSERT INTO evidence (evidence_id, project_id, version, kind, content, sha256, supersedes, input_version)
         VALUES ($1,$2,1,$3,$4,$5,$6,$7)`,
        [newId_, projectId, oldRow.kind, JSON.stringify(content), canonicalHash({ kind: oldRow.kind, content }), evidenceId, inputVersion],
      );
      await tx.query(`UPDATE evidence SET superseded_by = $2 WHERE evidence_id = $1`, [evidenceId, newId_]);
      // 定向失效 + 必要下游级联（同事务，保留历史，不碰无关目标）
      await invalidateForEvidence(tx, projectId, evidenceId, helpers);
      // 失效后重算：新证据若已补齐所需 kind → invalidated 目标回到 ready（绑定新版本）
      await recomputeReady(tx, projectId, helpers);
      await helpers.audit({
        actor: auth.principal.principalId, action: 'evidence_superseded', targetType: 'evidence', targetId: evidenceId,
        projectId, summary: `证据 ${oldRow.kind} 被取代 → ${newId_}`, payload: { newEvidenceId: newId_, kind: oldRow.kind },
      });
      await helpers.emit({
        eventType: 'EVIDENCE_SUPERSEDED', projectId, goalId: null,
        payload: { superseded: evidenceId, newEvidenceId: newId_, inputVersion },
      });
      return { ok: true, newEvidenceId: newId_, superseded: evidenceId, projectInputVersion: inputVersion };
    });
  }

  // ---- 领取 / 完成 / 失败（租约 + fencing）-----------------------------------

  async goalOr404(tx: Queryable, goalId: string, forUpdate = false): Promise<GoalRow> {
    const res = await tx.query(forUpdate
      ? `SELECT * FROM goals WHERE goal_id = $1 FOR UPDATE`
      : `SELECT * FROM goals WHERE goal_id = $1`, [goalId]);
    if (res.rows.length === 0) throw notFound('目标不存在');
    return res.rows[0] as GoalRow;
  }

  claim(frame: RequestFrame, goalId: string) {
    return withCommand(this, frame, 'claim', async (tx, helpers) => {
      const goal = await this.goalOr404(tx, goalId, true);
      const auth = await this.authOf(frame.credential);
      requireSensitive(auth, goal.project_id);
      requireRole(auth, goal.responsible_role, goal.executor_kind);
      const expected = reqInt(frame.expectedVersion, 'expectedVersion');
      this.requireVersion(goal, expected);
      const active = await tx.query(`SELECT status FROM projects WHERE project_id = $1`, [goal.project_id]);
      if ((active.rows[0] as { status: string } | undefined)?.status !== 'active') {
        throw conflict('PROJECT_PAUSED', '项目暂停中：不能领取任务');
      }
      // 过期租约的 leased 目标允许重领（恢复语义：lease 到期=任务可再分配，fencing 隔离旧 worker）
      if (goal.status === 'leased') {
        const held = await tx.query(`SELECT lease_until FROM task_assignments WHERE goal_id = $1`, [goalId]);
        const leaseUntil = (held.rows[0] as { lease_until: Date | string } | undefined)?.lease_until;
        if (leaseUntil === undefined || new Date(leaseUntil).getTime() > Date.now()) {
          throw conflict('NOT_READY', '目标已被其他执行者领取且租约未过期');
        }
      } else if (goal.status !== 'ready') {
        if (goal.status === 'decided') throw conflict('TERMINAL_STATE', '目标已终态（decided）');
        throw conflict('NOT_READY', `目标当前 ${goal.status}：仅 ready 可领取`);
      }
      const tokenRow = await tx.query(
        `INSERT INTO task_assignments (goal_id, assignee, kind, lease_until, fencing_token)
         VALUES ($1,$2,$3, now() + make_interval(secs => $4::int), 1)
         ON CONFLICT (goal_id) DO UPDATE SET assignee = $2, kind = $3,
           lease_until = now() + make_interval(secs => $4::int), fencing_token = task_assignments.fencing_token + 1,
           claimed_at = now()
         RETURNING fencing_token, lease_until`,
        [goalId, auth.principal.principalId, goal.executor_kind, this.config.leaseSeconds],
      );
      const assignment = tokenRow.rows[0] as { fencing_token: string; lease_until: string };
      await tx.query(
        `UPDATE goals SET status = 'leased', assigned_to = $2, version = version + 1, updated_at = now() WHERE goal_id = $1`,
        [goalId, auth.principal.principalId],
      );
      await tx.query(
        `INSERT INTO execution_receipts (receipt_id, goal_id, kind, actor_principal_id, fencing_token)
         VALUES ($1,$2,'claimed',$3,$4)`,
        [newId('rc'), goalId, auth.principal.principalId, assignment.fencing_token],
      );
      await tx.query(`UPDATE goals SET receipt_count = receipt_count + 1 WHERE goal_id = $1`, [goalId]);
      await helpers.audit({
        actor: auth.principal.principalId, action: 'goal_claimed', targetType: 'goal', targetId: goalId,
        projectId: goal.project_id, summary: `领取（fencing=${assignment.fencing_token}）`, payload: { fencingToken: Number(assignment.fencing_token) },
      });
      await helpers.emit({
        eventType: 'GOAL_CLAIMED', projectId: goal.project_id, goalId,
        payload: { goalKey: goal.goal_key, assignee: auth.principal.principalId, fencingToken: Number(assignment.fencing_token) },
      });
      return {
        ok: true, status: 'leased', fencingToken: Number(assignment.fencing_token),
        leaseUntil: assignment.lease_until, goalVersion: goal.version + 1,
      };
    });
  }

  /** fencing 校验：任何租约不连续（token 不符/租约过期/assignee 不符/分配已释放）→ 拒绝且零写入。 */
  private async requireFencedLease(tx: PoolClient, goal: GoalRow, principal: Principal, fencingToken: unknown): Promise<{ fencing_token: string }> {
    const res = await tx.query(`SELECT * FROM task_assignments WHERE goal_id = $1 FOR UPDATE`, [goal.goal_id]);
    if (res.rows.length === 0) {
      throw conflict('STALE_FENCING_TOKEN', '任务租约已被释放（takeover/失效）：写回被拒绝');
    }
    const a = res.rows[0] as { assignee: string; lease_until: Date | string; fencing_token: string };
    const token = reqInt(fencingToken, 'fencingToken');
    if (Number(a.fencing_token) !== token) {
      throw conflict('STALE_FENCING_TOKEN', `fencing token 过期：当前 ${a.fencing_token}，请求 ${token}（过期 worker 写回被拒绝）`);
    }
    if (new Date(a.lease_until).getTime() <= Date.now()) {
      throw conflict('LEASE_EXPIRED', '租约已过期：请重新领取（lease 恢复语义，不视为 API 未执行）');
    }
    if (a.assignee !== principal.principalId) {
      throw forbidden('ROLE_FORBIDDEN', '该租约属于其他 principal');
    }
    return a;
  }

  complete(frame: RequestFrame, goalId: string) {
    return withCommand(this, frame, 'complete', async (tx, helpers) => {
      const goal = await this.goalOr404(tx, goalId, true);
      const auth = await this.authOf(frame.credential);
      requireSensitive(auth, goal.project_id);
      // 门序（契约 §3.4）：终态 → fencing（旧 worker 确定性拒绝）→ 状态 → 版本 → 载荷
      if (goal.status === 'decided') throw conflict('TERMINAL_STATE', '目标已终态');
      await this.requireFencedLease(tx, goal, auth.principal, frame.fencingToken);
      if (goal.status !== 'leased') throw conflict('NOT_READY', `目标当前 ${goal.status}：仅 leased 可完成执行`);
      const expected = reqInt(frame.expectedVersion, 'expectedVersion');
      this.requireVersion(goal, expected);
      const resultIn = reqObject(frame.result, 'result');
      const provider = reqString(resultIn.provider, 'result.provider', 20);
      if (!PROVIDERS.includes(provider)) throw invalid(`result.provider 必须 ${PROVIDERS.join('/')}`);
      if (provider === 'real_http' && this.config.modelTransport === null) {
        throw conflict('MODEL_NOT_CONFIGURED', '模型 transport 未配置：real_http 结果不被接受（不静默 mock 成功）');
      }
      const output = reqObject(resultIn.output ?? {}, 'result.output');
      assertNoForbiddenKeys(output, 'result.output');
      checkJsonSize(output, 'result.output', MAX_RESULT_JSON);
      const notes = reqString(resultIn.notes ?? '', 'result.notes', 4000, 0);
      const evidenceRefs = reqStringArray(resultIn.evidenceRefs ?? [], 'result.evidenceRefs');
      for (const token of evidenceRefs) {
        const eid = String(token).split('@')[0];
        const ev = await tx.query(`SELECT 1 FROM evidence WHERE evidence_id = $1 AND project_id = $2`, [eid, goal.project_id]);
        if (ev.rows.length === 0) throw invalid(`result.evidenceRefs 引用不存在的证据：${token}`);
      }
      const result = { provider, output, evidenceRefs, notes, at: new Date().toISOString() };
      await tx.query(
        `UPDATE goals SET status = 'candidate_ready', result = $2, version = version + 1,
           receipt_count = receipt_count + 1, updated_at = now() WHERE goal_id = $1`,
        [goalId, JSON.stringify(result)],
      );
      await tx.query(
        `INSERT INTO execution_receipts (receipt_id, goal_id, kind, actor_principal_id, fencing_token, output, note)
         VALUES ($1,$2,'execution_completed',$3,$4,$5,$6)`,
        [newId('rc'), goalId, auth.principal.principalId, reqInt(frame.fencingToken, 'fencingToken'), JSON.stringify(output), notes],
      );
      await helpers.audit({
        actor: auth.principal.principalId, action: 'execution_completed', targetType: 'goal', targetId: goalId,
        projectId: goal.project_id, summary: '执行完成 → 候选就绪（待验收；不改变正式状态）', payload: { provider },
      });
      await helpers.emit({
        eventType: 'GOAL_CANDIDATE_READY', projectId: goal.project_id, goalId,
        payload: { goalKey: goal.goal_key, provider },
      });
      return { ok: true, status: 'candidate_ready', goalVersion: goal.version + 1 };
    });
  }

  failExecution(frame: RequestFrame, goalId: string) {
    return withCommand(this, frame, 'fail', async (tx, helpers) => {
      const goal = await this.goalOr404(tx, goalId, true);
      const auth = await this.authOf(frame.credential);
      requireSensitive(auth, goal.project_id);
      if (goal.status === 'decided') throw conflict('TERMINAL_STATE', '目标已终态');
      await this.requireFencedLease(tx, goal, auth.principal, frame.fencingToken);
      if (goal.status !== 'leased') throw conflict('NOT_READY', `目标当前 ${goal.status}：仅 leased 可报告失败`);
      const expected = reqInt(frame.expectedVersion, 'expectedVersion');
      this.requireVersion(goal, expected);
      const note = reqString(frame.note ?? '', 'note', 2000, 0);
      await tx.query(
        `UPDATE goals SET status = 'failed', assigned_to = NULL, version = version + 1,
           receipt_count = receipt_count + 1, updated_at = now() WHERE goal_id = $1`,
        [goalId],
      );
      await tx.query(`DELETE FROM task_assignments WHERE goal_id = $1`, [goalId]);
      await tx.query(
        `INSERT INTO execution_receipts (receipt_id, goal_id, kind, actor_principal_id, fencing_token, note)
         VALUES ($1,$2,'execution_failed',$3,$4,$5)`,
        [newId('rc'), goalId, auth.principal.principalId, reqInt(frame.fencingToken, 'fencingToken'), note],
      );
      await helpers.audit({
        actor: auth.principal.principalId, action: 'execution_failed', targetType: 'goal', targetId: goalId,
        projectId: goal.project_id, summary: `执行失败：${note || '（无备注）'}`, payload: { note },
      });
      await helpers.emit({ eventType: 'GOAL_FAILED', projectId: goal.project_id, goalId, payload: { goalKey: goal.goal_key, note } });
      return { ok: true, status: 'failed', goalVersion: goal.version + 1 };
    });
  }

  // ---- 验收 / 正式决定（目标不能自报完成）-------------------------------------

  accept(frame: RequestFrame, goalId: string) {
    return withCommand(this, frame, 'accept', async (tx, helpers) => {
      const goal = await this.goalOr404(tx, goalId, true);
      const auth = await this.authOf(frame.credential);
      requireSensitive(auth, goal.project_id);
      requireRole(auth, goal.acceptance_role, 'human');
      const expected = reqInt(frame.expectedVersion, 'expectedVersion');
      this.requireVersion(goal, expected);
      if (goal.status === 'decided') throw conflict('TERMINAL_STATE', '目标已终态（decided）');
      if (goal.status !== 'candidate_ready') throw conflict('NOT_READY', `目标当前 ${goal.status}：仅 candidate_ready 可验收`);
      // 执行者 ≠ 验收者（同一 principal 不得自报完成后再自验收）
      if (goal.assigned_to !== null && goal.assigned_to === auth.principal.principalId) {
        throw forbidden('ROLE_FORBIDDEN', '执行者不能验收同一目标（须由验收角色独立验收）');
      }
      const lastCompleted = await tx.query(
        `SELECT actor_principal_id FROM execution_receipts
         WHERE goal_id = $1 AND kind = 'execution_completed' ORDER BY at DESC LIMIT 1`, [goalId],
      );
      const executorId = (lastCompleted.rows[0] as { actor_principal_id: string } | undefined)?.actor_principal_id;
      if (executorId !== undefined && executorId === auth.principal.principalId) {
        throw forbidden('ROLE_FORBIDDEN', '执行完成者不能验收同一目标');
      }
      // DEF-01 v1.3 候选：传递 staleness 人工复核门（fail-closed；显式 ack 留痕后放行）
      const smap = await this.staleMap(tx, goal.project_id);
      const info = smap.get(goalId);
      await this.requireStaleReviewAck(info, frame, auth, tx, helpers, goal, 'accept');
      const note = reqString(frame.note ?? '', 'note', 2000, 0);
      await tx.query(
        `UPDATE goals SET status = 'accepted', version = version + 1, updated_at = now() WHERE goal_id = $1`,
        [goalId],
      );
      // 依赖释放与验收原子一致：同事务重算下游 blocked/invalidated → ready
      await recomputeReady(tx, goal.project_id, helpers);
      await helpers.audit({
        actor: auth.principal.principalId, action: 'goal_accepted', targetType: 'goal', targetId: goalId,
        projectId: goal.project_id, summary: `验收通过（${goal.goal_key}）${note ? `：${note}` : ''}`, payload: { note },
      });
      await helpers.emit({
        eventType: 'GOAL_ACCEPTED', projectId: goal.project_id, goalId,
        payload: { goalKey: goal.goal_key, acceptedBy: auth.principal.principalId },
      });
      return { ok: true, status: 'accepted', goalVersion: goal.version + 1 };
    });
  }

  decide(frame: RequestFrame, goalId: string) {
    return withCommand(this, frame, 'decide', async (tx, helpers) => {
      const goal = await this.goalOr404(tx, goalId, true);
      const auth = await this.authOf(frame.credential);
      requireSensitive(auth, goal.project_id);
      requireRole(auth, goal.decision_role, 'human');
      const expected = reqInt(frame.expectedVersion, 'expectedVersion');
      this.requireVersion(goal, expected);
      if (goal.status === 'decided') throw conflict('TERMINAL_STATE', '目标已是终态（decided 不可改写；重做=新建实例）');
      if (goal.status !== 'accepted') throw conflict('NOT_READY', `目标当前 ${goal.status}：仅 accepted 可作正式决定`);
      const decision = frame.decision;
      if (decision !== 'approved' && decision !== 'rejected' && decision !== 'withdrawn') {
        throw invalid('decision 必须 approved|rejected|withdrawn');
      }
      // DEF-01 v1.3 候选：正式决定同样受传递 staleness 复核门约束
      const smap = await this.staleMap(tx, goal.project_id);
      const info = smap.get(goalId);
      await this.requireStaleReviewAck(info, frame, auth, tx, helpers, goal, 'decide');
      const note = reqString(frame.note ?? '', 'note', 2000, 0);
      const formal = { decision, note, by: auth.principal.principalId, basedOnGoalVersion: goal.version, at: new Date().toISOString() };
      await tx.query(
        `UPDATE goals SET status = 'decided', formal_decision = $2, version = version + 1, updated_at = now() WHERE goal_id = $1`,
        [goalId, JSON.stringify(formal)],
      );
      await recomputeReady(tx, goal.project_id, helpers);
      await helpers.audit({
        actor: auth.principal.principalId, action: 'goal_decided', targetType: 'goal', targetId: goalId,
        projectId: goal.project_id, summary: `正式决定 ${decision}（终态，不可改写）`, payload: { decision, note },
      });
      await helpers.emit({
        eventType: 'GOAL_DECIDED', projectId: goal.project_id, goalId,
        payload: { goalKey: goal.goal_key, decision, by: auth.principal.principalId },
      });
      return { ok: true, status: 'decided', formalDecision: formal, goalVersion: goal.version + 1 };
    });
  }

  // ---- 暂停 / 接管 / 恢复 ----------------------------------------------------

  pauseGoal(frame: RequestFrame, goalId: string) {
    return withCommand(this, frame, 'pause-goal', async (tx, helpers) => {
      const goal = await this.goalOr404(tx, goalId, true);
      const auth = await this.authOf(frame.credential);
      requireSensitive(auth, goal.project_id);
      requireRole(auth, goal.responsible_role, 'human');
      const expected = reqInt(frame.expectedVersion, 'expectedVersion');
      this.requireVersion(goal, expected);
      if (goal.status === 'paused' || goal.status === 'decided') {
        throw conflict('NOT_READY', `目标当前 ${goal.status}：不可暂停`);
      }
      // 租约随暂停释放（token+1，老 worker 写回被 fence 掉）
      await tx.query(
        `INSERT INTO task_assignments (goal_id, assignee, kind, lease_until, fencing_token)
         VALUES ($1,'released','human', now(), 1)
         ON CONFLICT (goal_id) DO UPDATE SET assignee = 'released', lease_until = now(),
           fencing_token = task_assignments.fencing_token + 1, claimed_at = now()`,
        [goalId],
      );
      await tx.query(
        `UPDATE goals SET status = 'paused', assigned_to = NULL, version = version + 1, updated_at = now() WHERE goal_id = $1`,
        [goalId],
      );
      await helpers.audit({
        actor: auth.principal.principalId, action: 'goal_paused', targetType: 'goal', targetId: goalId,
        projectId: goal.project_id, summary: '人工暂停（租约释放+token 递增）', payload: {},
      });
      await helpers.emit({ eventType: 'GOAL_PAUSED', projectId: goal.project_id, goalId, payload: { goalKey: goal.goal_key } });
      return { ok: true, status: 'paused', goalVersion: goal.version + 1 };
    });
  }

  resumeGoal(frame: RequestFrame, goalId: string) {
    return withCommand(this, frame, 'resume-goal', async (tx, helpers) => {
      const goal = await this.goalOr404(tx, goalId, true);
      const auth = await this.authOf(frame.credential);
      requireSensitive(auth, goal.project_id);
      requireRole(auth, goal.responsible_role, 'human');
      const expected = reqInt(frame.expectedVersion, 'expectedVersion');
      this.requireVersion(goal, expected);
      if (goal.status !== 'paused' && goal.status !== 'failed') {
        throw conflict('NOT_READY', `目标当前 ${goal.status}：仅 paused|failed 可恢复`);
      }
      // 显式恢复：清除 held 状态后交给重算（→ ready 或 blocked）
      await tx.query(
        `UPDATE goals SET status = 'blocked', version = version + 1, updated_at = now() WHERE goal_id = $1`,
        [goalId],
      );
      await recomputeReady(tx, goal.project_id, helpers);
      const after = await tx.query(`SELECT status, version FROM goals WHERE goal_id = $1`, [goalId]);
      const row = after.rows[0] as { status: string; version: number };
      await helpers.audit({
        actor: auth.principal.principalId, action: 'goal_resumed', targetType: 'goal', targetId: goalId,
        projectId: goal.project_id, summary: `人工恢复 → ${row.status}`, payload: { from: goal.status, to: row.status },
      });
      await helpers.emit({ eventType: 'GOAL_RESUMED', projectId: goal.project_id, goalId, payload: { from: goal.status, to: row.status } });
      return { ok: true, status: row.status, goalVersion: row.version };
    });
  }

  takeover(frame: RequestFrame, goalId: string) {
    return withCommand(this, frame, 'takeover', async (tx, helpers) => {
      const goal = await this.goalOr404(tx, goalId, true);
      const auth = await this.authOf(frame.credential);
      requireSensitive(auth, goal.project_id);
      requireRole(auth, goal.responsible_role, 'human');
      if (goal.status !== 'leased') throw conflict('NOT_READY', `目标当前 ${goal.status}：无租约可接管`);
      // fence：token+1 且 assignee 置 released——原 worker 的 complete 按 STALE_FENCING_TOKEN 拒绝
      await tx.query(
        `INSERT INTO task_assignments (goal_id, assignee, kind, lease_until, fencing_token)
         VALUES ($1,'released','human', now(), 1)
         ON CONFLICT (goal_id) DO UPDATE SET assignee = 'released', lease_until = now(),
           fencing_token = task_assignments.fencing_token + 1, claimed_at = now()`,
        [goalId],
      );
      await tx.query(
        `UPDATE goals SET status = 'ready', assigned_to = NULL, version = version + 1, updated_at = now() WHERE goal_id = $1`,
        [goalId],
      );
      await helpers.audit({
        actor: auth.principal.principalId, action: 'goal_takeover', targetType: 'goal', targetId: goalId,
        projectId: goal.project_id, summary: `人工接管：释放租约（原 assignee=${goal.assigned_to ?? '未知'}）`, payload: {},
      });
      await helpers.emit({
        eventType: 'GOAL_TAKEOVER', projectId: goal.project_id, goalId,
        payload: { goalKey: goal.goal_key, releasedFrom: goal.assigned_to },
      });
      return { ok: true, status: 'ready', goalVersion: goal.version + 1 };
    });
  }

  // ---- 项目级暂停/恢复 --------------------------------------------------------

  projectPause(frame: RequestFrame, projectId: string) {
    return withCommand(this, frame, 'project-pause', async (tx, helpers) => {
      const auth = await this.authOf(frame.credential);
      requireSensitive(auth, projectId);
      requireRole(auth, 'admin', 'human');
      const res = await tx.query(`UPDATE projects SET status = 'paused', updated_at = now()
         WHERE project_id = $1 AND status = 'active' RETURNING project_id`, [projectId]);
      if (res.rows.length === 0) throw conflict('NOT_READY', '项目不在 active 状态');
      await helpers.audit({
        actor: auth.principal.principalId, action: 'project_paused', targetType: 'project', targetId: projectId,
        projectId, summary: '项目暂停（claim 拒绝，已有状态不变）', payload: {},
      });
      await helpers.emit({ eventType: 'PROJECT_PAUSED', projectId, goalId: null, payload: {} });
      return { ok: true, projectStatus: 'paused' };
    });
  }

  projectResume(frame: RequestFrame, projectId: string) {
    return withCommand(this, frame, 'project-resume', async (tx, helpers) => {
      const auth = await this.authOf(frame.credential);
      requireSensitive(auth, projectId);
      requireRole(auth, 'admin', 'human');
      const res = await tx.query(`UPDATE projects SET status = 'active', updated_at = now()
         WHERE project_id = $1 AND status = 'paused' RETURNING project_id`, [projectId]);
      if (res.rows.length === 0) throw conflict('NOT_READY', '项目不在 paused 状态');
      await helpers.audit({
        actor: auth.principal.principalId, action: 'project_resumed', targetType: 'project', targetId: projectId,
        projectId, summary: '项目恢复', payload: {},
      });
      await helpers.emit({ eventType: 'PROJECT_RESUMED', projectId, goalId: null, payload: {} });
      return { ok: true, projectStatus: 'active' };
    });
  }

  // ---- 人工待办 ---------------------------------------------------------------

  createHumanRequest(frame: RequestFrame, projectId: string) {
    return withCommand(this, frame, 'create-human-request', async (tx, helpers) => {
      const auth = await this.authOf(frame.credential);
      authorizeProject(auth.principal, projectId);
      const kind = frame.kind;
      if (kind !== 'missing_evidence' && kind !== 'decision' && kind !== 'clarification') {
        throw invalid('kind 必须 missing_evidence|decision|clarification');
      }
      const question = reqString(frame.question, 'question', 4000);
      const requestedRole = reqString(frame.requestedRole, 'requestedRole', 64);
      const requiredEvidenceKinds = reqStringArray(frame.requiredEvidenceKinds ?? [], 'requiredEvidenceKinds');
      let goalId: string | null = null;
      if (frame.goalId !== undefined && frame.goalId !== null) {
        goalId = reqString(frame.goalId, 'goalId', 64);
        await this.goalOr404(tx, goalId);
      }
      const hrId = newId('hr');
      await tx.query(
        `INSERT INTO human_requests (hrequest_id, project_id, goal_id, kind, question, requested_role, required_evidence_kinds, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [hrId, projectId, goalId, kind, question, requestedRole, JSON.stringify(requiredEvidenceKinds), auth.principal.principalId],
      );
      // 关联目标进入 waiting_human（仅 blocked/ready 可挂起；租约中/候选中不打断执行）
      if (goalId !== null) {
        const goal = await this.goalOr404(tx, goalId, true);
        if (goal.status === 'blocked' || goal.status === 'ready' || goal.status === 'invalidated') {
          await tx.query(
            `UPDATE goals SET status = 'waiting_human', version = version + 1, updated_at = now() WHERE goal_id = $1`,
            [goalId],
          );
          await helpers.emit({
            eventType: 'GOAL_WAITING_HUMAN', projectId, goalId,
            payload: { goalKey: goal.goal_key, hrequestId: hrId, kind },
          });
        }
      }
      await helpers.audit({
        actor: auth.principal.principalId, action: 'human_request_created', targetType: 'human_request', targetId: hrId,
        projectId, summary: `人工待办 ${kind} → ${requestedRole}`, payload: { goalId, kind },
      });
      await helpers.emit({
        eventType: 'HUMAN_REQUEST_CREATED', projectId, goalId,
        payload: { hrequestId: hrId, kind, requestedRole, question },
      });
      return { ok: true, hrequestId: hrId };
    });
  }

  respondHumanRequest(frame: RequestFrame, hrequestId: string) {
    return withCommand(this, frame, 'respond-human-request', async (tx, helpers) => {
      const hr = await tx.query(`SELECT * FROM human_requests WHERE hrequest_id = $1 FOR UPDATE`, [hrequestId]);
      if (hr.rows.length === 0) throw notFound('人工待办不存在');
      const row = hr.rows[0] as Record<string, unknown>;
      const auth = await this.authOf(frame.credential);
      requireSensitive(auth, row.project_id as string);
      requireRole(auth, row.requested_role as string, 'human');
      if (row.status !== 'open') throw conflict('HUMAN_REQUEST_CLOSED', `待办当前 ${row.status}：不可回应`);
      const answerIn = reqObject(frame.answer, 'answer');
      const text = reqString(answerIn.text, 'answer.text', 4000);
      const evidenceRefs = Array.isArray(answerIn.evidenceRefs) ? answerIn.evidenceRefs : [];
      const refs: { evidenceId: string; version: number }[] = [];
      for (const ref of evidenceRefs) {
        const obj = reqObject(ref, 'answer.evidenceRefs[]');
        const evidenceId = reqString(obj.evidenceId, 'evidenceId', 64);
        const version = reqInt(obj.version ?? 1, 'version');
        const ev = await tx.query(`SELECT version, superseded_by FROM evidence WHERE evidence_id = $1 AND project_id = $2`, [evidenceId, row.project_id]);
        if (ev.rows.length === 0) throw invalid(`answer.evidenceRefs 引用不存在的证据：${evidenceId}`);
        const serverVersion = (ev.rows[0] as { version: number }).version;
        if (serverVersion !== version) throw invalid(`证据版本不符：${evidenceId} 请求 v${version} 服务端 v${serverVersion}`);
        if ((ev.rows[0] as { superseded_by: string | null }).superseded_by !== null) {
          throw conflict('EVIDENCE_SUPERSEDED', `证据 ${evidenceId} 已被取代`);
        }
        refs.push({ evidenceId, version });
      }
      const answer = { text, evidenceRefs: refs, respondedBy: auth.principal.principalId, respondedAt: new Date().toISOString() };
      await tx.query(
        `UPDATE human_requests SET status = 'answered', answer = $2 WHERE hrequest_id = $1`,
        [hrequestId, JSON.stringify(answer)],
      );
      // 回应后重算关联目标（waiting_human → ready/blocked）；无关联则项目内常规重算
      const goalId = row.goal_id as string | null;
      if (goalId !== null) {
        const goal = await this.goalOr404(tx, goalId, true);
        if (goal.status === 'waiting_human') {
          await tx.query(`UPDATE goals SET status = 'blocked', version = version + 1, updated_at = now() WHERE goal_id = $1`, [goalId]);
        }
      }
      await recomputeReady(tx, row.project_id as string, helpers);
      const after = goalId !== null ? await tx.query(`SELECT status FROM goals WHERE goal_id = $1`, [goalId]) : null;
      const goalStatus = after !== null ? (after.rows[0] as { status: string } | undefined)?.status ?? null : null;
      await helpers.audit({
        actor: auth.principal.principalId, action: 'human_request_answered', targetType: 'human_request', targetId: hrequestId,
        projectId: row.project_id as string, summary: `人工回应（${text.slice(0, 40)}…）`, payload: { goalId, refs },
      });
      await helpers.emit({
        eventType: 'HUMAN_REQUEST_ANSWERED', projectId: row.project_id as string, goalId,
        payload: { hrequestId, goalStatus },
      });
      return { ok: true, status: 'answered', goalStatus };
    });
  }

  cancelHumanRequest(frame: RequestFrame, hrequestId: string) {
    return withCommand(this, frame, 'cancel-human-request', async (tx, helpers) => {
      const hr = await tx.query(`SELECT * FROM human_requests WHERE hrequest_id = $1 FOR UPDATE`, [hrequestId]);
      if (hr.rows.length === 0) throw notFound('人工待办不存在');
      const row = hr.rows[0] as Record<string, unknown>;
      const auth = await this.authOf(frame.credential);
      requireSensitive(auth, row.project_id as string);
      if (!auth.principal.roles.includes('admin') && auth.principal.principalId !== row.created_by) {
        throw forbidden('ROLE_FORBIDDEN', '仅创建者或 admin 可取消');
      }
      if (row.status !== 'open') throw conflict('HUMAN_REQUEST_CLOSED', `待办当前 ${row.status}`);
      await tx.query(`UPDATE human_requests SET status = 'cancelled' WHERE hrequest_id = $1`, [hrequestId]);
      const goalId = row.goal_id as string | null;
      if (goalId !== null) {
        const goal = await this.goalOr404(tx, goalId, true);
        if (goal.status === 'waiting_human') {
          await tx.query(`UPDATE goals SET status = 'blocked', version = version + 1, updated_at = now() WHERE goal_id = $1`, [goalId]);
          await recomputeReady(tx, row.project_id as string, helpers);
        }
      }
      await helpers.audit({
        actor: auth.principal.principalId, action: 'human_request_cancelled', targetType: 'human_request', targetId: hrequestId,
        projectId: row.project_id as string, summary: '人工待办取消', payload: {},
      });
      return { ok: true, status: 'cancelled' };
    });
  }

  async listHumanRequests(projectId: string, credential: unknown) {
    const auth = await this.authOf(credential);
    requireVerified(auth);
    authorizeProject(auth.principal, projectId);
    const res = await this.pool.query(`SELECT * FROM human_requests WHERE project_id = $1 ORDER BY created_at`, [projectId]);
    return { ok: true, humanRequests: (res.rows as Record<string, unknown>[]).map(projectHumanRequestRow) };
  }

  async getGoal(goalId: string, credential: unknown) {
    const goal = await this.goalOr404(this.pool, goalId);
    const auth = await this.authOf(credential);
    requireVerified(auth);
    authorizeProject(auth.principal, goal.project_id);
    const smap = await this.staleMap(this.pool, goal.project_id);
    const receipts = await this.pool.query(
      `SELECT receipt_id, kind, actor_principal_id, fencing_token, output, note, at
       FROM execution_receipts WHERE goal_id = $1 ORDER BY at`, [goalId],
    );
    const assignment = await this.pool.query(
      `SELECT assignee, kind, lease_until, fencing_token, claimed_at FROM task_assignments WHERE goal_id = $1`, [goalId],
    );
    const a = assignment.rows[0] as Record<string, unknown> | undefined;
    return {
      ok: true,
      goal: this.goalProjection(goal, smap.get(goal.goal_id)),
      receipts: (receipts.rows as Record<string, unknown>[]).map((r) => ({
        receiptId: r.receipt_id,
        kind: r.kind,
        actorPrincipalId: r.actor_principal_id,
        fencingToken: r.fencing_token === null || r.fencing_token === undefined ? null : Number(r.fencing_token),
        output: r.output,
        note: r.note,
        at: r.at,
      })),
      assignment: a === undefined ? null : {
        assignee: a.assignee,
        kind: a.kind,
        leaseUntil: a.lease_until,
        fencingToken: Number(a.fencing_token),
        claimedAt: a.claimed_at,
      },
    };
  }

  // ---- 事件 / 回执 / 订阅 / 健康 ------------------------------------------------

  /** 事件拉取（任务01 A1.2）：必须已验证身份；按 principal 的项目/租户/客户授权过滤——
   *  旧匿名全量事件口不得成为客户级数据旁路（F01/K03）。无 project/customer 的全局事件对所有已验证主体可见。 */
  async pullEvents(credential: unknown, afterSeq: number, limit: number) {
    const auth = await this.authOf(credential);
    requireVerified(auth);
    const p = auth.principal;
    const projects = p.projects === 'all' ? null : p.projects;
    const tenants = p.tenants === 'all' ? null : p.tenants;
    const res = await this.pool.query(
      `SELECT seq, event_id AS "eventId", at, event_type AS "eventType", project_id AS "projectId",
              customer_id AS "customerId", goal_id AS "goalId", payload, dispatch_state AS "dispatchState"
       FROM outbox_events o WHERE o.seq > $1 AND (
         (o.project_id IS NULL AND o.customer_id IS NULL)
         OR (o.project_id IS NOT NULL AND ($2::text IS NULL OR o.project_id = ANY($3::text[])))
         OR (o.customer_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM customers c WHERE c.customer_id = o.customer_id
                 AND ($4::text IS NULL OR c.tenant_id = ANY($5::text[]))
                 AND ($6::text = 'all' OR EXISTS (
                       SELECT 1 FROM principal_customer_grants g
                       WHERE g.principal_id = $7 AND g.customer_id = c.customer_id))))
       ) ORDER BY o.seq LIMIT $8`,
      [afterSeq, projects, projects ?? [], tenants, tenants ?? [], p.customers, p.principalId,
       Math.min(Math.max(limit, 1), 500)],
    );
    return { ok: true, events: res.rows };
  }

  subscribe(frame: RequestFrame) {
    return withCommand(this, frame, 'subscribe', async (tx, helpers) => {
      const auth = await this.authOf(frame.credential);
      requireAdmin(auth);
      const name = reqString(frame.name, 'name', 64);
      const url = reqString(frame.url, 'url', 500);
      if (!/^https?:\/\//.test(url)) throw invalid('url 必须 http(s)');
      if (!/^(http|ws):\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/.test(url) && !process.env.V7NEXT_ALLOW_REMOTE_SUBSCRIPTIONS) {
        throw invalid('订阅目标仅允许 loopback（隔离边界）');
      }
      const subId = newId('sub');
      await tx.query(`INSERT INTO subscriptions (sub_id, name, url) VALUES ($1,$2,$3)`, [subId, name, url]);
      // 新订阅只接收注册之后的事件（契约已说明）；补齐簿记起始位
      await tx.query(
        `INSERT INTO outbox_deliveries (sub_id, seq, state)
         SELECT $1, seq, 'delivered' FROM outbox_events WHERE dispatch_state = 'delivered'`,
        [subId],
      );
      await helpers.audit({
        actor: auth.principal.principalId, action: 'subscription_created', targetType: 'subscription', targetId: subId,
        projectId: null, summary: `订阅 ${name} → ${url}`, payload: { url },
      });
      return { ok: true, subId };
    });
  }

  /** 回执查询（A1.3/A1.4）：查看旧回执的权限与重新执行命令的权限分开——回执按归属 principal 过滤。 */
  async getReceipt(requestId: string, credential: unknown) {
    const auth = await this.authOf(credential);
    requireVerified(auth);
    const rows = auth.principal.roles.includes('admin')
      ? await this.pool.query(
          `SELECT request_id AS "requestId", payload_sha256, response, created_at FROM idempotency WHERE request_id = $1`,
          [requestId],
        )
      : await this.pool.query(
          `SELECT request_id AS "requestId", payload_sha256, response, created_at FROM idempotency
           WHERE request_id = $1 AND principal_id = $2`,
          [requestId, auth.principal.principalId],
        );
    if (rows.rows.length === 0) return { ok: true, found: false };
    return { ok: true, found: true, receipt: rows.rows[0] };
  }

  async health() {
    let db = 'down';
    try {
      await this.pool.query('SELECT 1');
      db = 'up';
    } catch { /* 保持 down */ }
    return {
      ok: true,
      db,
      model: this.config.modelTransport === null ? 'not_configured' : 'configured',
      principalVerifier: this.verifier === null ? 'not_configured' : 'configured',
      leaseSeconds: this.config.leaseSeconds,
      contractVersion: 'v1.3+v2.1-credit+decision-loop(task01+task02)',
      creditPolicy: {
        capCnyMinor: this.config.creditCapCnyMinor,
        matrixVersion: this.config.creditMatrixVersion,
        concentrationPolicyVersion: this.config.concentrationPolicyVersion,
        coolingSeconds: this.config.creditCoolingSeconds,
      },
      uptime: process.uptime(),
    };
  }

  private requireVersion(goal: GoalRow, expected: number): void {
    if (expected !== goal.version) {
      throw conflict('VERSION_CONFLICT', `目标版本已更新：客户端 v${expected}，服务端 v${goal.version}`, { serverVersion: goal.version });
    }
  }

  /** DEF-01 v1.3 候选（语义 PENDING-USER-RULING）：传递 staleness 人工复核门。
   *  自身或传递依赖的输入已被取代时，accept/decide 必须携带显式复核确认（人类验收/决定角色），
   *  否则 409 UPSTREAM_STALE——"无提示继续"结构性不可能；确认行为写审计，历史永不改写。 */
  private async requireStaleReviewAck(
    info: StaleInfo | undefined, frame: RequestFrame, auth: Auth,
    tx: PoolClient, helpers: TxHelpers, goal: GoalRow, op: 'accept' | 'decide',
  ): Promise<void> {
    if (info === undefined || !info.stale) return;
    const ack = frame.staleReviewAck;
    if (ack === undefined || ack === null) {
      throw conflict('UPSTREAM_STALE',
        `依据链含失效目标，需人工复核后显式确认：${info.roots.map((r) => `${r.goalKey}(${r.goalId})`).join(', ')}`,
        { staleRoots: info.roots });
    }
    const ackObj = reqObject(ack, 'staleReviewAck');
    const ackNote = reqString(ackObj.note ?? '', 'staleReviewAck.note', 2000, 0);
    await helpers.audit({
      actor: auth.principal.principalId, action: 'stale_review_acknowledged', targetType: 'goal', targetId: goal.goal_id,
      projectId: goal.project_id, summary: `人工复核确认失效依据后${op === 'accept' ? '验收' : '决定'}：${ackNote || '（无备注）'}`,
      payload: { op, staleRoots: info.roots, note: ackNote },
    });
  }
}
