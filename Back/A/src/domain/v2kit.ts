// v2 客户授信域公共件（任务02 从 credit.ts 抽出；credit.ts 与本轮 review/package/reports 共用）。
// 不变量保持不变：锁序 客户行锁 → 设施行锁 → 工件共享锁；幂等作用域 = sha256(tenant|principal|action)；
// 权限校验先于任何缓存回执（A10/A11）；错误信息绝不回显凭据。
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AppError, conflict, forbidden, invalid, notFound } from './errors.ts';
import { canonicalHash, sha256 } from './util.ts';
import type { Config } from '../config.ts';
import { authenticate, authorizeCustomer, authorizeTenant, requireVerified } from './principal.ts';
import type { Kernel } from './kernel.ts';

/** 客户域金额上限（防溢出）：2^53-1 分。 */
export const MAX_AMOUNT = Number.MAX_SAFE_INTEGER;

/** 证据核验等级（低→高）；与 S1_ADR D8 的 grade 语义一致。 */
export const FACT_GRADES = ['unknown', 'unverified', 'inference', 'source_supported', 'confirmed'] as const;
export type FactGrade = (typeof FACT_GRADES)[number];

export function gradeRank(g: string): number {
  const i = (FACT_GRADES as readonly string[]).indexOf(g);
  if (i < 0) throw invalid(`未知核验等级：${g}`);
  return i;
}

export interface RequestFrame {
  credential?: unknown;
  requestId?: unknown;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// 校验工具
// ---------------------------------------------------------------------------

export function reqString(v: unknown, label: string, max = 2000, min = 1): string {
  if (typeof v !== 'string' || v.trim().length < min || v.length > max) throw invalid(`${label} 必须是 ${min}..${max} 长度的 string`);
  return v;
}
export function reqInt(v: unknown, label: string, max = MAX_AMOUNT): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) throw invalid(`${label} 必须是 0..${max} 的整数（金额单位：分）`);
  return v;
}
export function reqPosInt(v: unknown, label: string, max = MAX_AMOUNT): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0 || v > max) throw invalid(`${label} 必须是 1..${max} 的整数（金额单位：分）`);
  return v;
}
export function reqObject(v: unknown, label: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw invalid(`${label} 必须是对象`);
  return v as Record<string, unknown>;
}
export function reqCurrency(v: unknown, label = 'currency'): string {
  if (typeof v !== 'string' || !/^[A-Z]{3}$/.test(v)) throw invalid(`${label} 必须是 3 位大写币种代码（如 CNY）`);
  return v;
}
export function optDate(v: unknown, label: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw invalid(`${label} 必须是 YYYY-MM-DD`);
  return v;
}

// ---------------------------------------------------------------------------
// v2 作用域幂等（D6：scope=tenant|principal|action；权限校验先于回执返回）
// ---------------------------------------------------------------------------

export interface V2Ctx {
  actor: string;
  kind: 'human' | 'agent' | 'service';
  roles: string[];
  tenantId: string;
  customers: 'all' | 'grant';
  scopeHash: string;
  /** 锁内幂等复查（A08/A11）：并发同 requestId 时，后到事务在主锁内先查原效应，
   *  命中同载荷 → 返回原响应（外层 INSERT 幂等表 23505 → 统一 replayed 出口）；
   *  命中异载荷 → IDEMPOTENCY_REPLAY_CONFLICT；未命中 → null 继续执行。 */
  replayed(tx: PoolClient): Promise<Record<string, unknown> | null>;
}

/** 载荷哈希：body + 路径资源 ID 一并纳入（A09：同 requestId 打到不同资源 = 异载荷 → 冲突）。 */
export function hashOf(action: string, frame: RequestFrame, resource: Record<string, unknown> | undefined): string {
  return canonicalHash({ action, payload: withoutRequestCred(frame), resource: resource ?? {} });
}

export function withoutRequestCred(frame: RequestFrame): Record<string, unknown> {
  const { requestId, credential, ...payload } = frame;
  void requestId;
  void credential;
  return payload;
}

async function v2CtxOf(kernel: Kernel, frame: RequestFrame, action: string, tenantId: string, resource?: Record<string, unknown>): Promise<V2Ctx> {
  const auth = await authenticate(kernel.verifierForV2(), frame.credential);
  requireVerified(auth);
  authorizeTenant(auth.principal, tenantId);
  const scopeHash = sha256(canonicalHash({ tenant: tenantId, principal: auth.principal.principalId, action }));
  const payloadHash = hashOf(action, frame, resource);
  return {
    actor: auth.principal.principalId, kind: auth.principal.kind, roles: [...auth.principal.roles], tenantId,
    customers: auth.principal.customers, scopeHash,
    replayed: async (tx: PoolClient): Promise<Record<string, unknown> | null> => {
      const r = await tx.query(
        `SELECT payload_sha256, response FROM v2_idempotency WHERE scope_hash=$1 AND request_id=$2 FOR UPDATE`,
        [scopeHash, frame.requestId as string],
      );
      if (r.rows.length === 0) return null;
      const row = r.rows[0] as { payload_sha256: string; response: Record<string, unknown> };
      if (row.payload_sha256 !== payloadHash) {
        throw conflict('IDEMPOTENCY_REPLAY_CONFLICT', `requestId ${frame.requestId} 在本作用域已绑定不同载荷`, { requestId: frame.requestId });
      }
      return row.response;
    },
  };
}

/** 客户域写命令统一入口：鉴权 → 事务（客户锁 → 业务 → 幂等/账本/outbox/audit 同事务）→ 冲突重放。 */
export async function withCommandV2(
  kernel: Kernel, frame: RequestFrame, action: string, tenantId: string,
  fn: (tx: PoolClient, h: V2Helpers, ctx: V2Ctx) => Promise<Record<string, unknown>>,
  resource?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { requestId, credential, ...payload } = frame;
  void payload;
  if (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 128) {
    throw invalid('requestId 必须是 1..128 长度的 string');
  }
  const ctx = await v2CtxOf(kernel, frame, action, tenantId, resource);
  const payloadHash = hashOf(action, frame, resource);
  const pool = kernel.pool;
  const prior = await pool.query(
    `SELECT response, payload_sha256 FROM v2_idempotency WHERE scope_hash=$1 AND request_id=$2`,
    [ctx.scopeHash, requestId],
  );
  if (prior.rows.length > 0) {
    const row = prior.rows[0] as { payload_sha256: string; response: Record<string, unknown> };
    if (row.payload_sha256 !== payloadHash) {
      throw conflict('IDEMPOTENCY_REPLAY_CONFLICT', `requestId ${requestId} 在本作用域已绑定不同载荷`, { requestId });
    }
    // A1.3/K02：外层命中不直接返回——落回事务，fn 的授权门（客户授权/角色/矩阵/状态）先重验，
    // 再由 ctx.replayed 在锁内返回原回执。撤权/改派后重放不得借缓存绕权。
  }
  try {
    return await runTxV2(pool, async (tx) => {
      const h = v2Helpers(tx);
      const response = await fn(tx, h, ctx);
      await tx.query(
        `INSERT INTO v2_idempotency (scope_hash, request_id, tenant_id, principal_id, action, payload_sha256, response)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [ctx.scopeHash, requestId, tenantId, ctx.actor, action, payloadHash, JSON.stringify(response)],
      );
      return response;
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505') {
      const again = await pool.query(
        `SELECT response, payload_sha256 FROM v2_idempotency WHERE scope_hash=$1 AND request_id=$2`,
        [ctx.scopeHash, requestId],
      );
      if (again.rows.length > 0) {
        const row = again.rows[0] as { payload_sha256: string; response: Record<string, unknown> };
        if (row.payload_sha256 === payloadHash) return { ...row.response, replayed: true };
        throw conflict('IDEMPOTENCY_REPLAY_CONFLICT', `requestId ${requestId} 在本作用域已绑定不同载荷`, { requestId });
      }
    }
    throw error;
  }
}

export async function runTxV2(pool: { connect: () => Promise<PoolClient> }, fn: (tx: PoolClient) => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* 连接已断 */ }
    throw error;
  } finally {
    client.release();
  }
}

export interface V2Helpers {
  audit(entry: { actor: string; action: string; targetType: string; targetId: string; summary: string; payload?: unknown }): Promise<void>;
  emit(eventType: string, customerId: string | null, payload: Record<string, unknown>): Promise<void>;
}

export function v2Helpers(tx: PoolClient): V2Helpers {
  return {
    async audit(entry): Promise<void> {
      await tx.query(
        `INSERT INTO audit_events (actor_principal_id, action, target_type, target_id, project_id, summary, payload_sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [entry.actor, entry.action, entry.targetType, entry.targetId, null, entry.summary, canonicalHash(entry.payload ?? {})],
      );
    },
    async emit(eventType, customerId, payload): Promise<void> {
      await tx.query(
        `INSERT INTO outbox_events (event_id, event_type, customer_id, payload) VALUES ($1,$2,$3,$4)`,
        [randomUUID(), eventType, customerId, JSON.stringify(payload)],
      );
    },
  };
}


// ---------------------------------------------------------------------------
// 身份与权限辅助
// ---------------------------------------------------------------------------

export function requireHuman(ctx: V2Ctx, action: string): void {
  if (ctx.kind !== 'human') {
    throw forbidden('PERMISSION_DENIED', `动作 ${action} 仅限人类 principal（agent 无正式动作权限；A18/A19）`);
  }
}

/** 目录角色检查（候选阶段命令；正式动作另走矩阵）。角色来自服务端身份目录，载荷声明无效。 */
export function requireDirectoryRole(ctx: V2Ctx, allowed: string[], action: string): void {
  if (!ctx.roles.some((r) => allowed.includes(r))) {
    throw forbidden('PERMISSION_DENIED', `动作 ${action} 需要服务端目录角色 ${allowed.join('/')}（载荷声明无效）`);
  }
}

export interface MatrixHit { role: string; ref: string }

/** 正式动作权限（D7/P-05）：矩阵版本未配置或条目缺失 → POLICY_PENDING；金额档不足 → PERMISSION_DENIED。 */
export async function requireMatrixPermission(
  tx: PoolClient, cfg: Config, ctx: V2Ctx, action: string, amountMinor: number | null,
): Promise<MatrixHit> {
  requireHuman(ctx, action);
  if (cfg.creditMatrixVersion === null) {
    throw conflict('POLICY_PENDING', `权限矩阵未配置：动作 ${action} 拒绝（fail-closed；不猜测公司制度）`);
  }
  const res = await tx.query(
    `SELECT role, max_amount_minor FROM permission_matrix
     WHERE matrix_version=$1 AND action=$2 AND allowed=true AND role = ANY($3)
     ORDER BY max_amount_minor NULLS LAST LIMIT 1`,
    [cfg.creditMatrixVersion, action, ctx.roles],
  );
  if (res.rows.length === 0) {
    throw conflict('POLICY_PENDING', `权限矩阵 ${cfg.creditMatrixVersion} 无 ${action} 的授权条目（角色：${ctx.roles.join('/') || '无'}）：拒绝`);
  }
  const hit = res.rows[0] as { role: string; max_amount_minor: string | null };
  if (amountMinor !== null && hit.max_amount_minor !== null && Number(hit.max_amount_minor) < amountMinor) {
    throw forbidden('PERMISSION_DENIED',
      `角色 ${hit.role} 的 ${action} 金额档不足：请求 ${amountMinor} 分 > 档位 ${hit.max_amount_minor} 分`);
  }
  return { role: hit.role, ref: `${cfg.creditMatrixVersion}|${hit.role}|${action}` };
}

/** 行级租户+客户鉴权（A10 + 任务01 A1/K03）：越权统一 NOT_FOUND（不泄露存在性）。
 *  customerId 提供时同时执行客户级授权（'grant' 模式查 principal_customer_grants，撤权即刻生效）。 */
export async function scopeByRow(
  kernel: Kernel, frame: { credential?: unknown }, tenantId: string, customerId?: string,
): Promise<void> {
  const auth = await authenticate(kernel.verifierForV2(), frame.credential);
  requireVerified(auth);
  try {
    authorizeTenant(auth.principal, tenantId);
    if (customerId !== undefined) await authorizeCustomer(auth.principal, customerId, kernel.pool);
  } catch {
    throw notFound('资源不存在');
  }
}

/** 命令内客户级授权（create 型命令：customerId 在路径上、行锁后执行；'grant' 模式查登记表）。
 *  越权统一 NOT_FOUND（A10/K03：不区分"不存在"与"无权"，不泄露存在性）。 */
export async function requireCustomerScope(
  ctx: V2Ctx, customerId: string,
  q: { query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }> },
): Promise<void> {
  if (ctx.customers === 'all') return;
  const r = await q.query(
    `SELECT 1 FROM principal_customer_grants WHERE principal_id=$1 AND customer_id=$2`,
    [ctx.actor, customerId],
  );
  if (r.rows.length === 0) {
    throw notFound('客户不存在');
  }
}

/** 客户行锁。expectedTenantId 提供时，客户不在该租户 → NOT_FOUND（A10：不泄露跨租户存在性）。 */
export async function lockCustomer(tx: PoolClient, customerId: string, expectedTenantId?: string): Promise<Record<string, unknown>> {
  const res = await tx.query(`SELECT * FROM customers WHERE customer_id=$1 FOR UPDATE`, [customerId]);
  if (res.rows.length === 0) throw notFound('客户不存在');
  const row = res.rows[0] as Record<string, unknown>;
  if (expectedTenantId !== undefined && row.tenant_id !== expectedTenantId) throw notFound('客户不存在');
  return row;
}

export async function lookupCustomer(kernel: Kernel, credential: unknown, customerId: string): Promise<Record<string, unknown>> {
  const res = await kernel.pool.query(`SELECT * FROM customers WHERE customer_id=$1`, [customerId]);
  if (res.rows.length === 0) throw notFound('客户不存在');
  const row = res.rows[0] as Record<string, unknown>;
  await scopeByRow(kernel, { credential }, row.tenant_id as string, customerId);
  return row;
}

export async function insertDecision(tx: PoolClient, d: {
  decisionId: string; tenantId: string; actor: string; roleRef: string; permissionRef: string; action: string;
  subjectType: string; subjectId: string; customerId: string; ruleVersion: string | null; basisRef: string | null;
  rationale: string; beforeVersion: number; afterVersion: number;
}): Promise<void> {
  await tx.query(
    `INSERT INTO decision_records (decision_id, tenant_id, actor_principal, actor_kind, role_ref, permission_ref, action, subject_type, subject_id, customer_id, rule_version, basis_ref, rationale, before_version, after_version)
     VALUES ($1,$2,$3,'human',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [d.decisionId, d.tenantId, d.actor, d.roleRef, d.permissionRef, d.action, d.subjectType, d.subjectId,
     d.customerId, d.ruleVersion, d.basisRef, d.rationale, d.beforeVersion, d.afterVersion],
  );
}
