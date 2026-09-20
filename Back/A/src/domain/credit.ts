// 客户级授信内核（任务01 v2；设计依据 docs/customer-next/S1_*.md）。
// 不变量：客户不能通过新建项目重复获得额度；重复/并发请求不能超占额度；
// 模型候选和资料数量不能直接变成正式授信（authority=none；正式动作仅人类命令通道）。
// 并发防线：所有客户域写命令按固定锁序 客户行锁 → 设施行锁 → 工件共享锁；
// 幂等作用域 = sha256(tenant|principal|action)；权限校验先于任何缓存回执（A10/A11）。
import type { PoolClient } from 'pg';
import { AppError, conflict, forbidden, invalid, notFound } from './errors.ts';
import { canonicalHash, newId, uuid } from './util.ts';
import type { Config } from '../config.ts';
import type { Kernel } from './kernel.ts';
import { authenticate, requireVerified } from './principal.ts';
import {
  reqString, reqInt, reqPosInt, reqObject, reqCurrency, optDate, gradeRank,
  withCommandV2, withoutRequestCred, requireHuman, requireDirectoryRole, requireMatrixPermission, requireCustomerScope,
  scopeByRow, lockCustomer, lookupCustomer, insertDecision, runTxV2,
  FACT_GRADES, MAX_AMOUNT,
  type RequestFrame, type V2Helpers,
} from './v2kit.ts';
import { independentProofCount, type ArtifactLite } from './decision-support.ts';
import { checkPackageForAction, packageActionBlockers, assertNoBlockingFindings } from './package.ts';

const PRODUCT_TYPES = ['direct_lease', 'sale_leaseback'] as const;
const TENDENCIES = ['do', 'cautious_do', 'do_with_adjusted_terms', 'no_do'] as const;

// ---------------------------------------------------------------------------
// 账本推导（D4：余额=账目推导值；惰性过期只清理"确定未发送/未承诺"的预占）
// ---------------------------------------------------------------------------

export interface BucketView {
  reservedMinor: number;
  committedMinor: number;
  outstandingMinor: number;
  lifetimeDisbursedMinor: number;
  exposureNowMinor: number;
}

async function lazyExpire(tx: PoolClient, facilityId: string, currency: string, customerId: string, h: V2Helpers): Promise<number> {
  // 仅 external_state='none' 且仍 reserved 的请求可自动过期；unknown/已承诺绝不自动清理（A12）
  const expired = await tx.query(
    `WITH victims AS (
       SELECT fr.fr_id, e.amount_minor, e.request_scope, e.request_id, e.actor
       FROM financing_requests fr
       JOIN exposure_entries e ON e.fr_id = fr.fr_id AND e.entry_type = 'reserve'
       WHERE fr.facility_id = $1 AND fr.status = 'reserved' AND fr.external_state = 'none'
         AND fr.reserved_until IS NOT NULL AND fr.reserved_until < now()
       FOR UPDATE OF fr SKIP LOCKED
     )
     UPDATE financing_requests fr
       SET status = 'cancelled', reserved_until = NULL, version = version + 1, updated_at = now()
     FROM victims v WHERE fr.fr_id = v.fr_id
     RETURNING v.fr_id, v.amount_minor, v.request_scope, v.request_id, v.actor`,
    [facilityId],
  );
  let n = 0;
  for (const row of expired.rows as Record<string, unknown>[]) {
      const tenantRow = await tx.query(`SELECT tenant_id FROM credit_facilities WHERE facility_id=$1`, [facilityId]);
      const tenantId = (tenantRow.rows[0] as { tenant_id: string }).tenant_id;
      await tx.query(
        `INSERT INTO exposure_entries (entry_id, tenant_id, customer_id, facility_id, fr_id, entry_type, amount_minor, currency, request_scope, request_id, tx_id, actor)
         VALUES ($1,$2,$3,$4,$5,'reserve_expire',$6,$7,$8,$9,$10,$11)`,
        [newId('le'), tenantId, customerId, facilityId, row.fr_id, Number(row.amount_minor), currency, row.request_scope, row.request_id, uuid(), row.actor],
      );
    await h.emit('RESERVATION_EXPIRED', customerId, { frId: row.fr_id, facilityId, amountMinor: Number(row.amount_minor) });
    n += 1;
  }
  return n;
}

/** 桶推导。调用方必须已持锁（写路径）或接受读已提交快照（只读路径）。 */
export async function computeBuckets(tx: PoolClient, facilityId: string): Promise<BucketView> {
  const res = await tx.query(
    `SELECT entry_type, SUM(amount_minor)::bigint AS total FROM exposure_entries WHERE facility_id=$1 GROUP BY entry_type`,
    [facilityId],
  );
  const sum: Record<string, number> = {};
  for (const r of res.rows as { entry_type: string; total: string }[]) {
    const n = Number(r.total);
    // F12/K16：bigint 聚合不得无条件转不安全 Number——显式失败优于静默舍入
    if (!Number.isSafeInteger(n)) {
      throw new AppError('INTERNAL', `账目聚合超出安全整数范围（facility ${facilityId}，${r.entry_type}）：拒绝推导，不静默舍入`);
    }
    sum[r.entry_type] = n;
  }
  return buildBucketView(facilityId, sum);
}

/** goal-01 P1：批量路径的桶推导（无 DB 访问；与 computeBuckets 同一算术，单一事实源）。 */
export function buildBucketView(_facilityId: string, sum: Record<string, number>): BucketView {
  const n = (k: string): number => sum[k] ?? 0;
  const reserved = n('reserve') - n('reserve_release') - n('reserve_expire') - n('reserve_commit');
  const committed = n('reserve_commit') - n('commit_cancel') - n('disburse');
  const outstanding = n('disburse') - n('settle');
  const lifetimeDisbursed = n('disburse');
  return {
    reservedMinor: reserved,
    committedMinor: committed,
    outstandingMinor: outstanding,
    lifetimeDisbursedMinor: lifetimeDisbursed,
    exposureNowMinor: reserved + committed + outstanding,
  };
}

export interface FacilityExposureView extends BucketView {
  approvedAmountMinor: number;
  currency: string;
  status: string;
  availableForNewDrawMinor: number;
  overLimit: boolean;
  staleBlockers: string[];
}

/** goal-01 P1：视图组装纯函数（桶与依据状态由调用方提供；写路径 facilityView 与批量读路径共用）。 */
export function buildFacilityView(
  facilityRow: Record<string, unknown>, buckets: BucketView, basisStale: boolean,
  _opts: { expire?: boolean } = {},
): FacilityExposureView {
  const facilityId = facilityRow.facility_id as string;
  let status = facilityRow.status as string;
  const effectiveTo = facilityRow.effective_to as string | null;
  if (status === 'active' && effectiveTo !== null && new Date(`${effectiveTo}T23:59:59Z`).getTime() < Date.now()) {
    status = 'expired';
  }
  const approved = Number(facilityRow.approved_amount_minor);
  const revolving = facilityRow.revolving === true;
  const overLimit = buckets.exposureNowMinor > approved;
  const rawAvailable = revolving
    ? approved - buckets.outstandingMinor - buckets.committedMinor - buckets.reservedMinor
    : approved - buckets.lifetimeDisbursedMinor - buckets.committedMinor - buckets.reservedMinor;
  const blockers: string[] = [];
  if (status !== 'active') blockers.push(`facility_status:${status}`);
  if (overLimit) blockers.push('over_limit');
  // 任务02 B11：提额冷却未到 → cooling_active 如实展示（激活/向上申请另有 COOLING_ACTIVE 硬门）；
  // 任务01 A3/K18：冷却不再冻结既有合法用信的可用额——hardBlockers 才清零可用
  const coolingUntil = facilityRow.cooling_until as string | Date | null | undefined;
  const coolingActive = coolingUntil !== null && coolingUntil !== undefined && new Date(coolingUntil).getTime() > Date.now();
  if (coolingActive) blockers.push('cooling_active');
  const hardBlockers = blockers.filter((b) => b !== 'cooling_active');
  // 依据失效阻断新增支用（S4）：basis 评估 stale/非待审 → 新支用 0
  if (basisStale) blockers.push('stale_basis');
  return {
    ...buckets,
    approvedAmountMinor: approved,
    currency: facilityRow.currency as string,
    status,
    availableForNewDrawMinor: hardBlockers.length === 0 ? Math.max(0, rawAvailable) : 0,
    overLimit,
    staleBlockers: blockers,
  };
}

/** 依据评估失效判定（facilityView 批量化共用）：评估 stale 或进入确定性否定状态。 */
function assessmentIsStale(row: { stale: boolean; status: string } | undefined): boolean {
  return !!row && (row.stale || row.status === 'stale' || row.status === 'superseded' || row.status === 'rejected');
}

/** 惰性到期 + 状态裁决 + 可用额推导。写路径传 expire:true（须持锁）。 */
export async function facilityView(tx: PoolClient, facilityRow: Record<string, unknown>, opts: { expire?: boolean; helpers?: V2Helpers; customerId?: string }): Promise<FacilityExposureView> {
  const facilityId = facilityRow.facility_id as string;
  if (opts.expire && opts.helpers && opts.customerId) {
    await lazyExpire(tx, facilityId, facilityRow.currency as string, opts.customerId, opts.helpers);
  }
  let status = facilityRow.status as string;
  const effectiveTo = facilityRow.effective_to as string | null;
  if (opts.expire && status === 'active' && effectiveTo !== null && new Date(`${effectiveTo}T23:59:59Z`).getTime() < Date.now()) {
    await tx.query(`UPDATE credit_facilities SET status='expired', version=version+1, updated_at=now() WHERE facility_id=$1 AND status='active'`, [facilityId]);
    status = 'expired';
  }
  const buckets = await computeBuckets(tx, facilityId);
  const basis = facilityRow.basis as { assessmentId?: string } | null;
  let basisStale = false;
  if (basis?.assessmentId) {
    const a = await tx.query(`SELECT stale, status FROM credit_assessments WHERE assessment_id=$1`, [basis.assessmentId]);
    basisStale = assessmentIsStale(a.rows[0] as { stale: boolean; status: string } | undefined);
  }
  return buildFacilityView({ ...facilityRow, status }, buckets, basisStale, opts);
}

// ---------------------------------------------------------------------------
// v2 命令注册（锁序：客户 → 设施 → 工件）
// ---------------------------------------------------------------------------

export type V2Frame = Record<string, unknown> & { credential?: unknown; requestId?: unknown };

export interface CreditV2Api {
  createCustomer(frame: V2Frame): Promise<Record<string, unknown>>;
  /** 任务01 A1：客户级授权登记/撤销（admin；'grant' 模式 principal 的可见客户）。 */
  grantCustomerAccess(frame: V2Frame, customerId: string): Promise<Record<string, unknown>>;
  revokeCustomerAccess(frame: V2Frame, customerId: string, granteePrincipalId: string): Promise<Record<string, unknown>>;
  getCustomer(credential: unknown, customerId: string): Promise<Record<string, unknown>>;
  declareRelationship(frame: V2Frame, customerId: string): Promise<Record<string, unknown>>;
  listRelationships(credential: unknown, customerId: string): Promise<Record<string, unknown>>;
  registerArtifact(frame: V2Frame, customerId: string): Promise<Record<string, unknown>>;
  listArtifacts(credential: unknown, customerId: string): Promise<Record<string, unknown>>;
  /** §11.2（IR-03-3）：单件读回——原件预览数据源（Edge 受控代理）；只读回，不落对象存储。 */
  getArtifactContent(credential: unknown, customerId: string, artifactId: string): Promise<Record<string, unknown>>;
  createAssessment(frame: V2Frame, customerId: string): Promise<Record<string, unknown>>;
  /** v2.6 §12（Back/CONTRACT §13.5）：首次回租需求修正（评估级客户表述；非融资申请）。 */
  updateAdmissionRequest(frame: V2Frame, assessmentId: string): Promise<Record<string, unknown>>;
  submitCandidate(frame: V2Frame, assessmentId: string): Promise<Record<string, unknown>>;
  submitForReview(frame: V2Frame, assessmentId: string): Promise<Record<string, unknown>>;
  decideAssessment(frame: V2Frame, assessmentId: string): Promise<Record<string, unknown>>;
  /** TAKEOFF-FA-1.0.0 v2.6（§13）：有权人员确认预评估结论；scope=preassessment_only，不产生任何授信效力。 */
  confirmPreassessment(frame: V2Frame, assessmentId: string): Promise<Record<string, unknown>>;
  /** TAKEOFF-FA-1.0.0 v2.6（§13.2）：候选修订历史读回（内部读）。 */
  listAssessmentCandidates(credential: unknown, assessmentId: string): Promise<Record<string, unknown>>;
  getAssessment(credential: unknown, assessmentId: string): Promise<Record<string, unknown>>;
  /** 任务03 IR-03-A ②：按客户权威分页清单（Edge 快照引用改走权威查询，替代事件窗口发现）。 */
  listCustomerAssessments(credential: unknown, customerId: string, opts: { limit?: unknown; cursor?: unknown }): Promise<Record<string, unknown>>;
  listCustomerFinancingRequests(credential: unknown, customerId: string, opts: { limit?: unknown; cursor?: unknown }): Promise<Record<string, unknown>>;
  proposeFacility(frame: V2Frame, customerId: string): Promise<Record<string, unknown>>;
  approveFacility(frame: V2Frame, facilityId: string): Promise<Record<string, unknown>>;
  activateFacility(frame: V2Frame, facilityId: string): Promise<Record<string, unknown>>;
  suspendFacility(frame: V2Frame, facilityId: string): Promise<Record<string, unknown>>;
  reduceFacility(frame: V2Frame, facilityId: string): Promise<Record<string, unknown>>;
  getFacility(credential: unknown, facilityId: string): Promise<Record<string, unknown>>;
  createFinancingRequest(frame: V2Frame, customerId: string): Promise<Record<string, unknown>>;
  reserveFinancing(frame: V2Frame, frId: string): Promise<Record<string, unknown>>;
  releaseFinancing(frame: V2Frame, frId: string): Promise<Record<string, unknown>>;
  commitFinancing(frame: V2Frame, frId: string): Promise<Record<string, unknown>>;
  disburseFinancing(frame: V2Frame, frId: string): Promise<Record<string, unknown>>;
  settleFinancing(frame: V2Frame, frId: string): Promise<Record<string, unknown>>;
  confirmExternal(frame: V2Frame, frId: string): Promise<Record<string, unknown>>;
  getFinancingRequest(credential: unknown, frId: string): Promise<Record<string, unknown>>;
  getUseReadiness(credential: unknown, frId: string): Promise<Record<string, unknown>>;
  getCustomerExposure(credential: unknown, customerId: string): Promise<Record<string, unknown>>;
  listCustomerEvents(credential: unknown, customerId: string, afterSeq: number, limit: number): Promise<Record<string, unknown>>;
  getV2Receipt(credential: unknown, requestId: string): Promise<Record<string, unknown>>;
  /** 任务01 A3.7/F10/K17：客户级提额（再评估）请求。 */
  createLimitIncreaseRequest(frame: V2Frame, customerId: string): Promise<Record<string, unknown>>;
  resolveLimitIncreaseRequest(frame: V2Frame, requestId: string): Promise<Record<string, unknown>>;
}

export function buildCreditCommands(kernel: Kernel): CreditV2Api {
  const cfgRef = (): Config => kernel.configForV2();

  return {
    createCustomer: (frame: V2Frame) => {
      const tenantId = reqString(frame.tenantId, 'tenantId', 64);
      return withCommandV2(kernel, frame, 'customer.create', tenantId, async (tx, h, ctx) => {
        requireHuman(ctx, 'customer.create');
        const legalEntityRef = reqString(frame.legalEntityRef, 'legalEntityRef', 128);
        const displayName = reqString(frame.displayName, 'displayName', 200);
        const customerId = newId('cust');
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        try {
          await tx.query('SAVEPOINT sp_cust_insert');
          await tx.query(
            `INSERT INTO customers (customer_id, tenant_id, legal_entity_ref, display_name, created_by)
             VALUES ($1,$2,$3,$4,$5)`,
            [customerId, tenantId, legalEntityRef, displayName, ctx.actor],
          );
          await tx.query('RELEASE SAVEPOINT sp_cust_insert');
        } catch (error) {
          await tx.query('ROLLBACK TO SAVEPOINT sp_cust_insert').catch(() => {});
          if (typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505') {
            // 先查是否为本人同 requestId 重放（响应丢失重试），再按重复建档拒绝
            const prior = await tx.query(
              `SELECT payload_sha256, response FROM v2_idempotency WHERE scope_hash=$1 AND request_id=$2 FOR UPDATE`,
              [ctx.scopeHash, frame.requestId as string],
            );
            if (prior.rows.length > 0) {
              const row = prior.rows[0] as { payload_sha256: string; response: Record<string, unknown> };
              if (row.payload_sha256 === canonicalHash({ action: 'customer.create', payload: withoutRequestCred(frame) })) {
                return row.response;
              }
            }
            throw conflict('CUSTOMER_EXISTS', `同一租户下已存在该法定主体的客户档案（不自动合并）：${legalEntityRef}`);
          }
          throw error;
        }
        await h.audit({
          actor: ctx.actor, action: 'customer_created', targetType: 'customer', targetId: customerId,
          summary: `客户建档 ${displayName}（${legalEntityRef}）`, payload: { tenantId },
        });
        await h.emit('CUSTOMER_CREATED', customerId, { customerId, tenantId, legalEntityRef, displayName });
        return { ok: true, customerId, tenantId };
      });
    },

    /** A1.1/K03：客户级授权登记（admin）。'grant' 模式 principal 仅可见登记客户；撤销即刻生效。 */
    grantCustomerAccess: (frame: V2Frame, customerId: string) => {
      const tenantId = reqString(frame.tenantId, 'tenantId', 64);
      return withCommandV2(kernel, frame, 'customer.grant', tenantId, async (tx, h, ctx) => {
        requireHuman(ctx, 'customer.grant');
        requireDirectoryRole(ctx, ['admin'], 'customer.grant');
        const customer = await lockCustomer(tx, customerId, tenantId);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        void customer;
        const grantee = reqString(frame.principalId, 'principalId', 64);
        await tx.query(
          `INSERT INTO principal_customer_grants (tenant_id, principal_id, customer_id, created_by)
           VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [ctx.tenantId, grantee, customerId, ctx.actor],
        );
        await h.audit({
          actor: ctx.actor, action: 'customer_grant_created', targetType: 'customer', targetId: customerId,
          summary: `客户授权登记 → ${grantee}`, payload: { grantee },
        });
        return { ok: true, customerId, principalId: grantee };
      });
    },

    revokeCustomerAccess: async (frame: V2Frame, customerId: string, granteePrincipalId: string) => {
      const f = (frame ?? {}) as V2Frame;
      const auth = await authenticate(kernel.verifierForV2(), f.credential);
      requireVerified(auth);
      if (!auth.principal.roles.includes('admin')) {
        throw forbidden('ROLE_FORBIDDEN', '仅 admin 可撤销客户授权');
      }
      const c = await kernel.pool.query(`SELECT tenant_id FROM customers WHERE customer_id=$1`, [customerId]);
      if (c.rows.length === 0) throw notFound('客户不存在');
      const tenantId = (c.rows[0] as { tenant_id: string }).tenant_id;
      if (auth.principal.tenants !== 'all' && !auth.principal.tenants.includes(tenantId)) {
        throw notFound('客户不存在');
      }
      const grantee = reqString(granteePrincipalId, 'principalId', 64);
      return await runTxV2(kernel.pool, async (tx) => {
        await tx.query(`DELETE FROM principal_customer_grants WHERE customer_id=$1 AND principal_id=$2`, [customerId, grantee]);
        // v2.4 G2：客户联系人身份级联停用（撤权即刻生效；重放经鉴权链同样拒绝）
        await tx.query(
          `UPDATE customer_identities SET status='disabled' WHERE principal_id=$2 AND customer_id=$1 AND status='active'`,
          [customerId, grantee],
        );
        await tx.query(
          `INSERT INTO audit_events (actor_principal_id, action, target_type, target_id, project_id, summary, payload_sha256)
           VALUES ($1,'customer_grant_revoked','customer',$2,NULL,$3,$4)`,
          [auth.principal.principalId, customerId, `客户授权撤销 → ${grantee}`, canonicalHash({ grantee })],
        );
        return { ok: true, customerId, principalId: grantee, revoked: true };
      });
    },

    getCustomer: async (credential: unknown, customerId: string) => {
      const row = await lookupCustomer(kernel, credential, customerId);
      return { ok: true, customer: projectCustomer(row) };
    },

    declareRelationship: (frame: RequestFrame, customerId: string) => {
      return withCommandV2(kernel, frame, 'relationship.declare', frame.tenantId as string, async (tx, h, ctx) => {
        requireHuman(ctx, 'relationship.declare');
        const customer = await lockCustomer(tx, customerId, ctx.tenantId);
        await requireCustomerScope(ctx, customerId, tx);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        const tenantId = customer.tenant_id as string;
        const type = reqString(frame.type, 'type', 32);
        if (!['control', 'guarantee', 'supplier', 'related_group', 'contact'].includes(type)) {
          throw invalid('type 必须 control|guarantee|supplier|related_group|contact');
        }
        const toCustomerId = frame.toCustomerId === undefined || frame.toCustomerId === null ? null : reqString(frame.toCustomerId, 'toCustomerId', 64);
        const externalEntityRef = frame.externalEntityRef === undefined || frame.externalEntityRef === null ? null : reqString(frame.externalEntityRef, 'externalEntityRef', 128);
        const contactRef = frame.contactRef === undefined || frame.contactRef === null ? null : reqString(frame.contactRef, 'contactRef', 128);
        if (toCustomerId === null && externalEntityRef === null && contactRef === null) {
          throw invalid('关系必须指向 toCustomerId / externalEntityRef / contactRef 之一');
        }
        if (toCustomerId !== null) {
          const other = await tx.query(`SELECT 1 FROM customers WHERE customer_id=$1 AND tenant_id=$2`, [toCustomerId, tenantId]);
          if (other.rows.length === 0) throw notFound('关系对方客户不存在（跨租户不可引用）');
        }
        const relId = newId('rel');
        await tx.query(
          `INSERT INTO customer_relationships
             (relationship_id, tenant_id, from_customer_id, to_customer_id, external_entity_ref, contact_ref, type, evidence_refs, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
          [relId, tenantId, customerId, toCustomerId, externalEntityRef, contactRef, type, JSON.stringify(frame.evidenceRefs ?? []), ctx.actor],
        );
        // 联系人/关系声明绝不合并客户档案（A02/A03）：不存在任何 UPDATE customers 的路径
        await h.audit({
          actor: ctx.actor, action: 'relationship_declared', targetType: 'relationship', targetId: relId,
          summary: `客户关系 ${type}`, payload: { customerId, toCustomerId, type },
        });
        await h.emit('RELATIONSHIP_DECLARED', customerId, { relationshipId: relId, type });
        return { ok: true, relationshipId: relId };
      });
    },

    listRelationships: async (credential: unknown, customerId: string) => {
      const customer = await lookupCustomer(kernel, credential, customerId);
      const res = await kernel.pool.query(
        `SELECT relationship_id, to_customer_id, external_entity_ref, contact_ref, type, evidence_refs, verification_status, valid_from, valid_to, created_at
         FROM customer_relationships WHERE from_customer_id=$1 ORDER BY created_at`, [customerId],
      );
      return {
        ok: true, customer: projectCustomer(customer),
        relationships: (res.rows as Record<string, unknown>[]).map((r) => ({
          relationshipId: r.relationship_id, toCustomerId: r.to_customer_id, externalEntityRef: r.external_entity_ref,
          contactRef: r.contact_ref, type: r.type, evidenceRefs: r.evidence_refs,
          verificationStatus: r.verification_status, validFrom: r.valid_from, validTo: r.valid_to, createdAt: r.created_at,
        })),
      };
    },

    // ---- S2：证据工件与事实断言（D8：并存；显式 supersede；重复材料只关联） ----

    registerArtifact: (frame: RequestFrame, customerId: string) => {
      return withCommandV2(kernel, frame, 'artifact.register', frame.tenantId as string, async (tx, h, ctx) => {
        requireHuman(ctx, 'artifact.register');
        const customer = await lockCustomer(tx, customerId, ctx.tenantId);
        await requireCustomerScope(ctx, customerId, tx);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        const tenantId = customer.tenant_id as string;
        const kind = reqString(frame.kind, 'kind', 64);
        // v2.4 G2：邀请兑换的客户联系人身份按授予面限制材料种类（服务端强制）。
        // 仅约束 customer_identities 成员；既有合成客户 principal（目录种子，非邀请路径）保持旧行为零变更。
        // DEF-G04N-02（04 路接口对齐项）：处理桥（02 coordinator）可能以 `material.<kind>` 命名空间登记，
        // 比对按剥离前缀后的原始种类执行，落库保持调用方原样——两侧任一收敛均安全，不会双拒。
        if (ctx.roles.includes('customer')) {
          const ident = await tx.query(
            `SELECT allowed_kinds FROM customer_identities WHERE principal_id=$1 AND status='active'`, [ctx.actor]);
          if (ident.rows.length > 0) {
            const allowed = (ident.rows[0].allowed_kinds as string[] | undefined) ?? [];
            const bareKind = kind.startsWith('material.') ? kind.slice('material.'.length) : kind;
            if (!allowed.includes(bareKind)) {
              throw forbidden('PERMISSION_DENIED', `邀请未授予材料种类 ${kind}（客户联系人仅能提交获准种类）`);
            }
          }
        }
        const factKey = frame.factKey === undefined || frame.factKey === null ? null : reqString(frame.factKey, 'factKey', 128);
        const content = reqObject(frame.content, 'content');
        const grade = frame.grade === undefined || frame.grade === null ? 'unverified' : reqString(frame.grade, 'grade', 32);
        if (!FACT_GRADES.includes(grade as never)) throw invalid(`grade 必须 ${FACT_GRADES.join('/')}`);
        // A1.5/K04：核验等级提升只能来自获准核验角色；客户申报不产生等级（未核验声明恒为 unverified）
        const GRADE_AUTHORITY_ROLES = ['credit', 'business', 'policy', 'commerce', 'asset', 'admin'];
        if (gradeRank(grade) > gradeRank('unverified') && !ctx.roles.some((r) => GRADE_AUTHORITY_ROLES.includes(r))) {
          throw forbidden('PERMISSION_DENIED', '核验等级提升需要获准核验角色（客户申报材料不产生等级）');
        }
        // 任务02 3.1：同源派生 / 对象绑定 / 材料口径元数据（全部可选；旧调用零变更）
        let provenance: Record<string, unknown> | null = null;
        if (frame.provenance !== undefined && frame.provenance !== null) {
          const pv = reqObject(frame.provenance, 'provenance');
          const derivedFrom = Array.isArray(pv.derivedFrom)
            ? pv.derivedFrom.map((x) => reqString(x, 'provenance.derivedFrom[]', 64))
            : [];
          if (derivedFrom.length === 0) throw invalid('provenance.derivedFrom 必须是非空数组（派生材料必须声明上游原件）');
          for (const up of derivedFrom) {
            const u = await tx.query(
              `SELECT a.customer_id, (SELECT f.grade FROM fact_assertions f WHERE f.artifact_id = a.artifact_id LIMIT 1) AS grade
               FROM evidence_artifacts a WHERE a.artifact_id=$1`, [up]);
            if (u.rows.length === 0) throw notFound(`派生上游工件不存在：${up}`);
            const ur = u.rows[0] as { customer_id: string; grade: string };
            if (ur.customer_id !== customerId) throw notFound(`派生上游工件不属于该客户：${up}`);
            // B01：派生材料不产生新证明力——核验等级不得高于其上游
            if (gradeRank(grade) > gradeRank(ur.grade)) {
              throw invalid(`派生材料核验等级不得高于上游：${up} 为 ${ur.grade}，请求 ${grade}`);
            }
          }
          provenance = {
            derivedFrom,
            generator: reqString(pv.generator ?? 'unspecified', 'provenance.generator', 128),
            generationKind: reqString(pv.generationKind ?? 'derived', 'provenance.generationKind', 64),
          };
        }
        let objectRef: Record<string, unknown> | null = null;
        if (frame.objectRef !== undefined && frame.objectRef !== null) {
          const o = reqObject(frame.objectRef, 'objectRef');
          objectRef = {
            objectId: reqString(o.objectId, 'objectRef.objectId', 128),
            sceneVersion: reqString(o.sceneVersion, 'objectRef.sceneVersion', 64),
            sceneId: o.sceneId === undefined || o.sceneId === null ? null : reqString(o.sceneId, 'objectRef.sceneId', 128),
          };
        }
        let materialMeta: Record<string, unknown> | null = null;
        if (frame.materialMeta !== undefined && frame.materialMeta !== null) {
          const m = reqObject(frame.materialMeta, 'materialMeta');
          const optStr = (v: unknown, label: string): string | null =>
            v === undefined || v === null ? null : reqString(v, label, 128);
          materialMeta = {
            subjectRef: optStr(m.subjectRef, 'materialMeta.subjectRef'),
            periodFrom: optStr(m.periodFrom, 'materialMeta.periodFrom'),
            periodTo: optStr(m.periodTo, 'materialMeta.periodTo'),
            unit: optStr(m.unit, 'materialMeta.unit'),
            caliber: optStr(m.caliber, 'materialMeta.caliber'),
            page: optStr(m.page, 'materialMeta.page'),
            timeSpan: optStr(m.timeSpan, 'materialMeta.timeSpan'),
          };
        }
        const contentSha = canonicalHash(content);
        const supersedes = frame.supersedes === undefined || frame.supersedes === null ? null : reqString(frame.supersedes, 'supersedes', 64);
        const projectId = frame.projectId === undefined || frame.projectId === null ? null : reqString(frame.projectId, 'projectId', 64);
        if (projectId !== null) {
          const p = await tx.query(`SELECT 1 FROM projects WHERE project_id=$1`, [projectId]);
          if (p.rows.length === 0) throw notFound('关联项目不存在');
        }
        let duplicateOf: string | null = null;
        if (supersedes !== null) {
          const old = await tx.query(`SELECT artifact_id, superseded_by, sha256, customer_id FROM evidence_artifacts WHERE artifact_id=$1 FOR UPDATE`, [supersedes]);
          if (old.rows.length === 0) throw notFound('被取代工件不存在');
          const o = old.rows[0] as { superseded_by: string | null; sha256: string; customer_id: string };
          if (o.customer_id !== customerId) throw notFound('被取代工件不属于该客户');
          if (o.superseded_by !== null) throw conflict('ARTIFACT_SUPERSEDED', `工件已被 ${o.superseded_by} 取代`);
          if (o.sha256 === contentSha) throw invalid('更正版内容与原件相同：不构成取代（请用重复提交）');
        } else {
          // 同客户同内容重复提交（A04）：指向首件，不产生新证明力；提交痕迹保留
          const dup = await tx.query(
            `SELECT artifact_id FROM evidence_artifacts WHERE customer_id=$1 AND sha256=$2 AND duplicate_of IS NULL AND superseded_by IS NULL`,
            [customerId, contentSha],
          );
          if (dup.rows.length > 0) duplicateOf = (dup.rows[0] as { artifact_id: string }).artifact_id;
        }
        const artifactId = newId('art');
        await tx.query(
          `INSERT INTO evidence_artifacts (artifact_id, tenant_id, customer_id, project_id, kind, fact_key, content, sha256, supersedes, duplicate_of, created_by, provenance, object_ref, material_meta)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb)`,
          [artifactId, tenantId, customerId, projectId, kind, factKey, JSON.stringify(content), contentSha, supersedes, duplicateOf, ctx.actor,
           JSON.stringify(provenance), JSON.stringify(objectRef), JSON.stringify(materialMeta)],
        );
        if (supersedes !== null) {
          await tx.query(`UPDATE evidence_artifacts SET superseded_by=$2 WHERE artifact_id=$1`, [supersedes, artifactId]);
          // S4：依据失效按依赖映射传播 → 引用被取代工件的评估标 stale（历史保留，不自动改写）
          await tx.query(
            `UPDATE credit_assessments SET stale=true, version=version+1, updated_at=now()
             WHERE customer_id=$1 AND stale=false AND evidence_snapshot @> $2::jsonb`,
            [customerId, JSON.stringify([{ artifactId: supersedes }])],
          );
          // TAKEOFF v2.6（§4/§13.1）：输入版本前移（同一命中集，不含 stale 守卫——每次取代都是一次输入前移）
          await tx.query(
            `UPDATE credit_assessments SET input_version = input_version + 1
             WHERE customer_id=$1 AND evidence_snapshot @> $2::jsonb`,
            [customerId, JSON.stringify([{ artifactId: supersedes }])],
          );
          // 已确认预评估 → 仅标"需复核"（历史确认永不覆盖/删除；不默认重开正式决定）
          const flagged = await tx.query(
            `UPDATE preassessment_confirmations pc SET needs_review=true, review_reason=$2, review_marked_at=now()
             WHERE pc.needs_review=false AND pc.assessment_id IN (
               SELECT assessment_id FROM credit_assessments WHERE customer_id=$1 AND evidence_snapshot @> $3::jsonb
             ) RETURNING pc.confirmation_id, pc.assessment_id`,
            [customerId, 'snapshot_artifact_superseded', JSON.stringify([{ artifactId: supersedes }])],
          );
          // 任务02：依据实质修订 → 通知消费方（评估/依据包须按新证据复核；B08 阻断新用信）
          await h.emit('ASSESSMENT_BASIS_REVISED', customerId, {
            reason: 'artifact_superseded', superseded: supersedes, newArtifactId: artifactId,
          });
          for (const fr of flagged.rows as { confirmation_id: string; assessment_id: string }[]) {
            await h.emit('PREASSESSMENT_REVIEW_FLAGGED', customerId, {
              confirmationId: fr.confirmation_id, assessmentId: fr.assessment_id,
              reason: 'snapshot_artifact_superseded', superseded: supersedes, newArtifactId: artifactId,
            });
          }
        }
        if (duplicateOf === null) {
          await tx.query(
            `INSERT INTO fact_assertions (assertion_id, tenant_id, customer_id, fact_key, value, grade, artifact_id, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [newId('fact'), tenantId, customerId, factKey ?? kind, JSON.stringify(content), grade, artifactId, ctx.actor],
          );
        }
        await h.audit({
          actor: ctx.actor, action: 'artifact_registered', targetType: 'artifact', targetId: artifactId,
          summary: `证据工件 ${kind}${duplicateOf !== null ? '（重复提交，关联首件）' : ''}${supersedes !== null ? '（更正版）' : ''}`,
          payload: { kind, factKey, duplicateOf, supersedes },
        });
        await h.emit(
          duplicateOf !== null ? 'ARTIFACT_DUPLICATE_LINKED' : (supersedes !== null ? 'ARTIFACT_SUPERSEDED' : 'ARTIFACT_REGISTERED'),
          customerId, { artifactId, kind, factKey, duplicateOf, supersedes },
        );
        return { ok: true, artifactId, duplicateOf, supersedes };
      });
    },

    listArtifacts: async (credential: unknown, customerId: string) => {
      await lookupCustomer(kernel, credential, customerId);
      // B13：客户角色不授予证据清单地址（内部证据元数据不外泄）
      const authArt = await authenticate(kernel.verifierForV2(), credential);
      requireVerified(authArt);
      // B13：客户角色不授予证据清单地址（内部证据元数据不外泄）。some 口径：混合角色同样拒绝（v2.4 加固）。
      if (authArt.principal.roles.some((r) => r === 'customer')) {
        throw forbidden('PERMISSION_DENIED', '无权访问该资源');
      }
      const res = await kernel.pool.query(
        `SELECT a.artifact_id, a.kind, a.fact_key, a.sha256, a.supersedes, a.superseded_by, a.duplicate_of, a.created_at,
                a.provenance, a.object_ref, a.material_meta, f.value, f.grade,
                p.stage AS proc_stage, p.run_ref AS proc_run_ref, p.failure_reason AS proc_failure_reason, p.next_action AS proc_next_action
         FROM evidence_artifacts a LEFT JOIN fact_assertions f ON f.artifact_id = a.artifact_id
         LEFT JOIN LATERAL (
           SELECT stage, run_ref, failure_reason, next_action FROM artifact_processing ap
           WHERE ap.artifact_id = a.artifact_id ORDER BY ap.id DESC LIMIT 1
         ) p ON true
         WHERE a.customer_id=$1 ORDER BY a.created_at`, [customerId],
      );
      // 独立证明计数（3.1/B01）：派生链按根归并；同一声明的清单/生成场景/截图只计一件
      const allArts = await kernel.pool.query(
        `SELECT artifact_id, kind, fact_key, provenance, superseded_by, duplicate_of
         FROM evidence_artifacts WHERE customer_id=$1`, [customerId],
      );
      // A2.9/K11：派生缺口具体可见——上游被取代/缺失的派生件逐件列出（不把派生件当新根掩盖）
      const statusById = new Map<string, { superseded_by: string | null; duplicate_of: string | null }>();
      for (const r of allArts.rows as Record<string, unknown>[]) {
        statusById.set(String(r.artifact_id), { superseded_by: (r.superseded_by as string | null), duplicate_of: (r.duplicate_of as string | null) });
      }
      const derivationGaps: Record<string, unknown>[] = [];
      for (const r of allArts.rows as Record<string, unknown>[]) {
        const provenance = (r.provenance ?? null) as { derivedFrom?: string[] } | null;
        for (const up of provenance?.derivedFrom ?? []) {
          const st = statusById.get(String(up));
          if (st === undefined) {
            derivationGaps.push({ artifactId: String(r.artifact_id), reason: 'upstream_missing', upstreamArtifactId: String(up) });
          } else if (st.superseded_by !== null || st.duplicate_of !== null) {
            derivationGaps.push({ artifactId: String(r.artifact_id), reason: 'upstream_superseded', upstreamArtifactId: String(up) });
          }
        }
      }
      const independentProofs = independentProofCount((allArts.rows as Record<string, unknown>[]).map((a) => ({
        artifactId: String(a.artifact_id), sha256: '', kind: String(a.kind),
        factKey: a.fact_key === null ? null : String(a.fact_key), grade: 'unverified',
        provenance: (a.provenance ?? null) as ArtifactLite['provenance'],
        supersededBy: a.superseded_by === null ? null : String(a.superseded_by),
        duplicateOf: a.duplicate_of === null ? null : String(a.duplicate_of),
      })));
      // 冲突视图（A20）：同一 fact_key 下多个"未被取代且非重复"的断言 → 显式冲突，绝不 last-write-wins
      const conflictRes = await kernel.pool.query(
        `SELECT f.fact_key, COUNT(DISTINCT f.assertion_id)::int AS n
         FROM fact_assertions f JOIN evidence_artifacts a ON a.artifact_id = f.artifact_id
         WHERE f.customer_id=$1 AND a.superseded_by IS NULL AND a.duplicate_of IS NULL
           AND NOT (a.kind LIKE 'material.%' AND f.fact_key = 'material:' || substring(a.kind from 10)
             AND a.content ? 'connectorRef'
             AND (a.content - ARRAY['connectorRef','sha256','sourceProvider','uploadSource','completeness','objectRefCount','derivedFromLocalId','depth']) = '{}'::jsonb)
         GROUP BY f.fact_key HAVING COUNT(DISTINCT f.assertion_id) > 1`, [customerId],
      );
      return {
        ok: true,
        artifacts: (res.rows as Record<string, unknown>[]).map((r) => ({
          artifactId: r.artifact_id, kind: r.kind, factKey: r.fact_key, sha256: r.sha256,
          supersedes: r.supersedes, supersededBy: r.superseded_by, duplicateOf: r.duplicate_of,
          value: r.value, grade: r.grade, createdAt: r.created_at,
          provenance: r.provenance, objectRef: r.object_ref, materialMeta: r.material_meta,
          current: r.superseded_by === null,
          // 任务03（IR-03-A ②"必要的处理引用"）：登记后无处理记录 = null（页面按 registered 展示，口径同 §11 my/materials）
          processing: r.proc_stage === null || r.proc_stage === undefined ? null : {
            stage: r.proc_stage, runRef: r.proc_run_ref, failureReason: r.proc_failure_reason, nextAction: r.proc_next_action,
          },
        })),
        factConflicts: (conflictRes.rows as Record<string, unknown>[]).map((r) => ({ factKey: r.fact_key, assertionCount: Number(r.n) })),
        independentProofs,
        derivationGaps,
      };
    },

    /** §11.2（IR-03-3）单件读回：原件预览数据源。内部 principal 专用（客户角色 403，B13 口径）；
     *  只读回 content JSON（信封 v0 投影 materialFile），不落对象存储、无写路径；被取代/重复件同样可读。 */
    getArtifactContent: async (credential: unknown, customerId: string, artifactId: string) => {
      await lookupCustomer(kernel, credential, customerId);
      const authRead = await authenticate(kernel.verifierForV2(), credential);
      requireVerified(authRead);
      if (authRead.principal.roles.some((r) => r === 'customer')) {
        throw forbidden('PERMISSION_DENIED', '无权访问该资源');
      }
      const res = await kernel.pool.query(
        `SELECT artifact_id, customer_id, kind, fact_key, sha256, content, superseded_by, duplicate_of, created_by, created_at
         FROM evidence_artifacts WHERE artifact_id=$1 AND customer_id=$2`, [artifactId, customerId],
      );
      if (res.rows.length === 0) throw notFound('材料不存在');
      const r = res.rows[0] as Record<string, unknown>;
      const content = (r.content ?? null) as Record<string, unknown> | null;
      const rawFile = content !== null && typeof content === 'object' && !Array.isArray(content)
        ? (content as { materialFile?: unknown }).materialFile
        : undefined;
      // 信封 v0 投影：字段白名单原样取出（不转码、不落对象存储）；非信封件 materialFile=null
      const materialFile = rawFile !== null && typeof rawFile === 'object' && !Array.isArray(rawFile)
        ? {
            name: (rawFile as { name?: unknown }).name ?? null,
            mime: (rawFile as { mime?: unknown }).mime ?? null,
            size: (rawFile as { size?: unknown }).size ?? null,
            encoding: (rawFile as { encoding?: unknown }).encoding ?? null,
            data: (rawFile as { data?: unknown }).data ?? null,
          }
        : null;
      return {
        ok: true,
        artifact: {
          artifactId: r.artifact_id, customerId: r.customer_id, kind: r.kind, factKey: r.fact_key,
          sha256: r.sha256, createdBy: r.created_by, createdAt: r.created_at,
          supersededBy: r.superseded_by, duplicateOf: r.duplicate_of,
          content, materialFile,
        },
      };
    },

    // ---- S2/S3：评估（D3：候选 authority=none，终点=待人类审阅） ----------------

    createAssessment: (frame: RequestFrame, customerId: string) => {
      return withCommandV2(kernel, frame, 'assessment.create', frame.tenantId as string, async (tx, h, ctx) => {
        requireHuman(ctx, 'assessment.create');
        requireDirectoryRole(ctx, ['credit'], 'assessment.create');
        const customer = await lockCustomer(tx, customerId, ctx.tenantId);
        await requireCustomerScope(ctx, customerId, tx);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        const tenantId = customer.tenant_id as string;
        const ruleVersion = reqString(frame.ruleVersion, 'ruleVersion', 64);
        // v2.6 §12：可选首次回租需求（客户表述；严格 Schema；绝不写 financing_requests）
        const admissionRequest = frame.request === undefined || frame.request === null ? null : parseAdmissionRequest(frame.request);
        if (admissionRequest !== null) {
          admissionRequest.declaredBy = ctx.actor;
          admissionRequest.declaredAt = new Date().toISOString();
          admissionRequest.updatedAt = admissionRequest.declaredAt;
        }
        const snapshotIn = Array.isArray(frame.evidenceSnapshot) ? frame.evidenceSnapshot : [];
        const snapshot: { artifactId: string; sha256: string; factKey: string | null }[] = [];
        const seen = new Set<string>();
        for (const ref of snapshotIn) {
          const artifactId = reqString(reqObject(ref, 'evidenceSnapshot[]').artifactId, 'artifactId', 64);
          if (seen.has(artifactId)) continue; // 快照按工件去重（A04：同一材料不计多份证明）
          seen.add(artifactId);
          const a = await tx.query(
            `SELECT sha256, fact_key, customer_id, superseded_by, duplicate_of FROM evidence_artifacts WHERE artifact_id=$1`,
            [artifactId],
          );
          if (a.rows.length === 0) throw notFound(`快照引用的工件不存在：${artifactId}`);
          const row = a.rows[0] as { sha256: string; fact_key: string | null; customer_id: string; superseded_by: string | null; duplicate_of: string | null };
          if (row.customer_id !== customerId) throw notFound(`工件不属于该客户：${artifactId}`);
          if (row.superseded_by !== null || row.duplicate_of !== null) continue; // 被取代/重复件不入快照
          snapshot.push({ artifactId, sha256: row.sha256, factKey: row.fact_key });
        }
        const assessmentId = newId('ass');
        const snapshotHash = canonicalHash(snapshot);
        await tx.query(
          `INSERT INTO credit_assessments (assessment_id, tenant_id, customer_id, status, evidence_snapshot, snapshot_hash, rule_version, created_by, admission_request, admission_request_revision)
           VALUES ($1,$2,$3,'collecting',$4::jsonb,$5,$6,$7,$8::jsonb,$9)`,
          [assessmentId, tenantId, customerId, JSON.stringify(snapshot), snapshotHash, ruleVersion, ctx.actor,
           admissionRequest === null ? null : JSON.stringify(admissionRequest), admissionRequest === null ? 0 : 1],
        );
        await h.audit({
          actor: ctx.actor, action: 'assessment_created', targetType: 'assessment', targetId: assessmentId,
          summary: `授信评估创建（快照 ${snapshot.length} 件，规则 ${ruleVersion}${admissionRequest !== null ? '；含首次回租需求' : ''}）`, payload: { snapshotHash },
        });
        await h.emit('ASSESSMENT_CREATED', customerId, { assessmentId, snapshotHash, ruleVersion });
        return { ok: true, assessmentId, snapshotHash, snapshotCount: snapshot.length };
      });
    },

    /** v2.6 §12：首次回租需求登记/修正（评估创建后；人类 business/credit；乐观锁；历史不改写只留审计）。 */
    updateAdmissionRequest: (frame: RequestFrame, assessmentId: string) => {
      return withCommandV2(kernel, frame, 'assessment.admission-request', frame.tenantId as string, async (tx, h, ctx) => {
        const a = await tx.query(`SELECT * FROM credit_assessments WHERE assessment_id=$1 FOR UPDATE`, [assessmentId]);
        if (a.rows.length === 0) throw notFound('评估不存在');
        const row = a.rows[0] as Record<string, unknown>;
        await scopeByRow(kernel, frame, row.tenant_id as string, row.customer_id as string);
        requireHuman(ctx, 'assessment.admission-request');
        requireDirectoryRole(ctx, ['business', 'credit'], 'assessment.admission-request');
        const storedReq = await ctx.replayed(tx);
        if (storedReq !== null) return storedReq;
        const request = parseAdmissionRequest(frame.request);
        if (typeof frame.assessmentVersion !== 'number' || !Number.isInteger(frame.assessmentVersion) || (frame.assessmentVersion as number) < 1) {
          throw invalid('assessmentVersion 必须是 ≥1 的整数（当前评估行版本，见 GET /assessments/:id）');
        }
        const currentVersion = Number(row.version);
        if ((frame.assessmentVersion as number) !== currentVersion) {
          throw conflict('VERSION_CONFLICT', `评估版本已前移：请求 ${frame.assessmentVersion}，当前 ${currentVersion}`, { serverVersion: currentVersion });
        }
        const status = String(row.status);
        if (!['draft', 'collecting', 'candidate_ready', 'awaiting_human_review'].includes(status)) {
          throw conflict('NOT_READY', `评估当前 ${status}：预评估结论已确认或评估已终结，需求不再变更`);
        }
        const prev = (row.admission_request ?? null) as Record<string, unknown> | null;
        const revision = Number(row.admission_request_revision ?? 0) + 1;
        request.declaredBy = ctx.actor;
        request.declaredAt = prev !== null && typeof prev.declaredAt === 'string' ? prev.declaredAt : new Date().toISOString();
        request.updatedAt = new Date().toISOString();
        const nextVersion = currentVersion + 1;
        await tx.query(
          `UPDATE credit_assessments SET admission_request=$2::jsonb, admission_request_revision=$3, version=$4, updated_at=now()
           WHERE assessment_id=$1`,
          [assessmentId, JSON.stringify(request), revision, nextVersion],
        );
        await h.audit({
          actor: ctx.actor, action: 'admission_request_updated', targetType: 'assessment', targetId: assessmentId,
          summary: `首次回租需求修订 r${revision}（${request.requestedAmountMinor === null ? '金额未定' : `${request.requestedAmountMinor} 分`}）`, payload: { revision },
        });
        await h.emit('ADMISSION_REQUEST_UPDATED', row.customer_id as string, { assessmentId, revision });
        return {
          ok: true, assessmentId, revision, assessmentVersion: nextVersion,
          request: { ...request, revision },
        };
      });
    },

    submitCandidate: (frame: RequestFrame, assessmentId: string) => {
      return withCommandV2(kernel, frame, 'assessment.candidate', frame.tenantId as string, async (tx, h, ctx) => {
        const a = await tx.query(`SELECT * FROM credit_assessments WHERE assessment_id=$1 FOR UPDATE`, [assessmentId]);
        if (a.rows.length === 0) throw notFound('评估不存在');
        const row = a.rows[0] as Record<string, unknown>;
        await scopeByRow(kernel, frame, row.tenant_id as string, row.customer_id as string);
        // 候选可由 agent/模型 principal 产出（A18）：authority=none 由服务端强制，正式动作另有通道
        const storedCand = await ctx.replayed(tx);
        if (storedCand !== null) return storedCand;
        // 严格 Schema（字段白名单 + 类型）先于状态门：坏载荷无论状态一律 400（A18）
        // TAKEOFF v2.6（§13.2）：白名单加法扩展期限/价格及口径/依据/运行引用/规则版本/变化理由
        const cand = reqObject(frame.candidate, 'candidate');
        if ('authority' in cand) throw invalid('candidate 不得携带 authority 字段（服务端强制 authority=none）');
        const tendency = reqString(cand.tendency, 'candidate.tendency', 32);
        if (!TENDENCIES.includes(tendency as never)) throw invalid(`candidate.tendency 必须 ${TENDENCIES.join('/')}`);
        const amount = cand.supportableAmountMinor === undefined || cand.supportableAmountMinor === null
          ? null : reqInt(cand.supportableAmountMinor, 'candidate.supportableAmountMinor');
        const currency = cand.currency === undefined || cand.currency === null ? 'CNY' : reqCurrency(cand.currency, 'candidate.currency');
        const conditions = Array.isArray(cand.conditions) ? cand.conditions.map((c) => reqString(c, 'conditions[]', 500)) : [];
        const rationale = reqString(cand.rationale ?? '', 'candidate.rationale', 4000, 0);
        const producedBy = reqString(cand.producedBy, 'candidate.producedBy', 128);
        const warnings = Array.isArray(cand.warnings) ? cand.warnings.map((w) => reqString(w, 'warnings[]', 500)) : [];
        // ---- v2.6 加法字段（全部可选；既有调用零变更）----
        const term = cand.suggestedTermMonths === undefined || cand.suggestedTermMonths === null
          ? null : reqPosInt(cand.suggestedTermMonths, 'candidate.suggestedTermMonths', 240);
        const price = cand.referencePriceMinor === undefined || cand.referencePriceMinor === null
          ? null : reqInt(cand.referencePriceMinor, 'candidate.referencePriceMinor');
        const priceUnit = cand.priceUnit === undefined || cand.priceUnit === null ? null : reqString(cand.priceUnit, 'candidate.priceUnit', 64);
        const priceBasis = cand.priceBasis === undefined || cand.priceBasis === null ? null : reqString(cand.priceBasis, 'candidate.priceBasis', 128);
        if (price !== null && (priceUnit === null || priceBasis === null)) {
          throw invalid('candidate.referencePriceMinor 提供时必须同时给出 priceUnit 与 priceBasis（参考价格必须带口径）');
        }
        const basisRefs: string[] = [];
        if (cand.basisRefs !== undefined && cand.basisRefs !== null) {
          if (!Array.isArray(cand.basisRefs)) throw invalid('candidate.basisRefs 必须是数组');
          if (cand.basisRefs.length > 50) throw invalid('candidate.basisRefs 最多 50 件');
          for (const ref of cand.basisRefs) basisRefs.push(reqString(ref, 'candidate.basisRefs[]', 64));
        }
        const runRefs: string[] = [];
        if (cand.runRefs !== undefined && cand.runRefs !== null) {
          if (!Array.isArray(cand.runRefs)) throw invalid('candidate.runRefs 必须是数组');
          if (cand.runRefs.length > 20) throw invalid('candidate.runRefs 最多 20 条');
          for (const ref of cand.runRefs) runRefs.push(reqString(ref, 'candidate.runRefs[]', 128));
        }
        const changeReason = cand.changeReason === undefined || cand.changeReason === null ? null : reqString(cand.changeReason, 'candidate.changeReason', 500);
        const candRuleVersion = cand.ruleVersion === undefined || cand.ruleVersion === null ? null : reqString(cand.ruleVersion, 'candidate.ruleVersion', 64);
        const unknownKeys = Object.keys(cand).filter((k) => !['tendency', 'supportableAmountMinor', 'currency', 'conditions', 'rationale', 'producedBy', 'warnings',
          'suggestedTermMonths', 'referencePriceMinor', 'priceUnit', 'priceBasis', 'basisRefs', 'runRefs', 'changeReason', 'ruleVersion'].includes(k));
        if (unknownKeys.length > 0) throw invalid(`candidate 含未声明字段：${unknownKeys.join(', ')}（严格 Schema）`);
        if (row.stale === true) throw conflict('STALE_BASIS', '评估依据已失效：请重建快照后重评');
        // v2.6：awaiting_human_review 亦可提交候选修订（补证重算→方案修订；状态保持不回退）；既有 collecting/draft 语义不变
        const status = String(row.status);
        const isRevision = status === 'awaiting_human_review';
        if (status !== 'collecting' && status !== 'draft' && !isRevision) {
          throw conflict('NOT_READY', `评估当前 ${status}：仅 collecting/draft 可提交候选（awaiting_human_review 可提交候选修订）`);
        }
        // basisRefs 逐件校验：属本客户且现行（与快照同口径；被取代/重复件不得作为现行依据）
        if (basisRefs.length > 0) {
          const arts = await tx.query(
            `SELECT artifact_id, customer_id, superseded_by, duplicate_of FROM evidence_artifacts WHERE artifact_id = ANY($1)`, [basisRefs]);
          const byId = new Map<string, Record<string, unknown>>((arts.rows as Record<string, unknown>[]).map((r) => [r.artifact_id as string, r]));
          for (const artifactId of basisRefs) {
            const b = byId.get(artifactId);
            if (b === undefined) throw notFound(`候选依据工件不存在：${artifactId}`);
            if (b.customer_id !== row.customer_id) throw notFound(`候选依据工件不属于该客户：${artifactId}`);
            if (b.superseded_by !== null || b.duplicate_of !== null) throw conflict('ARTIFACT_SUPERSEDED', `候选依据工件已失效：${artifactId}`);
          }
        }
        // 服务端盖章：修订号与输入版本（调用方不得自报；历史追加不改写）
        const revRes = await tx.query(`SELECT COALESCE(MAX(revision),0)+1 AS next FROM assessment_candidates WHERE assessment_id=$1`, [assessmentId]);
        const revision = Number((revRes.rows[0] as { next: string | number }).next);
        const inputVersion = Number(row.input_version ?? 0);
        const stored = {
          authority: 'none' as const, tendency,
          supportableAmountMinor: amount, currency, conditions, rationale, producedBy, warnings,
          suggestedTermMonths: term, referencePriceMinor: price, priceUnit, priceBasis,
          basisRefs, runRefs, changeReason, ruleVersion: candRuleVersion,
          revision, inputVersion,
        };
        await tx.query(
          `INSERT INTO assessment_candidates (candidate_id, tenant_id, customer_id, assessment_id, revision, tendency, suggested_amount_minor, currency,
             suggested_term_months, reference_price_minor, price_unit, price_basis, conditions, rationale, produced_by, warnings,
             basis_refs, run_refs, change_reason, rule_version, input_version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19,$20,$21)`,
          [newId('cand'), row.tenant_id, row.customer_id, assessmentId, revision, tendency, amount, currency,
           term, price, priceUnit, priceBasis, JSON.stringify(conditions), rationale, producedBy, JSON.stringify(warnings),
           JSON.stringify(basisRefs), JSON.stringify(runRefs), changeReason, candRuleVersion, inputVersion],
        );
        // legacy candidate 列继续承载"当前版"（含加法字段）：老消费者零破坏
        await tx.query(
          `UPDATE credit_assessments SET candidate=$2::jsonb, status=$3, version=version+1, updated_at=now()
           WHERE assessment_id=$1`,
          [assessmentId, JSON.stringify(stored), isRevision ? 'awaiting_human_review' : 'candidate_ready'],
        );
        await h.audit({
          actor: ctx.actor, action: 'assessment_candidate', targetType: 'assessment', targetId: assessmentId,
          summary: `候选修订 r${revision} 产出（${producedBy}；authority=none；不改变正式状态）`, payload: { tendency, revision },
        });
        await h.emit('ASSESSMENT_CANDIDATE_READY', row.customer_id as string, { assessmentId, producedBy, revision });
        return { ok: true, status: isRevision ? 'awaiting_human_review' : 'candidate_ready', candidate: stored, revision, inputVersion };
      });
    },

    submitForReview: (frame: RequestFrame, assessmentId: string) => {
      return withCommandV2(kernel, frame, 'assessment.submit-review', frame.tenantId as string, async (tx, h, ctx) => {
        const a = await tx.query(`SELECT * FROM credit_assessments WHERE assessment_id=$1 FOR UPDATE`, [assessmentId]);
        if (a.rows.length === 0) throw notFound('评估不存在');
        const row = a.rows[0] as Record<string, unknown>;
        await scopeByRow(kernel, frame, row.tenant_id as string, row.customer_id as string);
        requireHuman(ctx, 'assessment.submit-review');
        requireDirectoryRole(ctx, ['credit'], 'assessment.submit-review');
        const storedReview = await ctx.replayed(tx);
        if (storedReview !== null) return storedReview;
        if (row.stale === true) throw conflict('STALE_BASIS', '评估依据已失效：请重建快照后重评');
        if (row.status !== 'candidate_ready') throw conflict('NOT_READY', `评估当前 ${row.status}：仅 candidate_ready 可提交人工审阅`);
        await tx.query(`UPDATE credit_assessments SET status='awaiting_human_review', version=version+1, updated_at=now() WHERE assessment_id=$1`, [assessmentId]);
        await h.audit({
          actor: ctx.actor, action: 'assessment_submitted', targetType: 'assessment', targetId: assessmentId,
          summary: '评估提交人工审阅（候选不产生额度效力）', payload: {},
        });
        await h.emit('ASSESSMENT_SUBMITTED_FOR_REVIEW', row.customer_id as string, { assessmentId });
        return { ok: true, status: 'awaiting_human_review' };
      });
    },

    decideAssessment: (frame: RequestFrame, assessmentId: string) => {
      return withCommandV2(kernel, frame, 'assessment.decide', frame.tenantId as string, async (tx, h, ctx) => {
        const a = await tx.query(`SELECT * FROM credit_assessments WHERE assessment_id=$1 FOR UPDATE`, [assessmentId]);
        if (a.rows.length === 0) throw notFound('评估不存在');
        const row = a.rows[0] as Record<string, unknown>;
        await scopeByRow(kernel, frame, row.tenant_id as string, row.customer_id as string);
        requireHuman(ctx, 'assessment.decide');
        requireDirectoryRole(ctx, ['credit'], 'assessment.decide');
        const storedDecide = await ctx.replayed(tx);
        if (storedDecide !== null) return storedDecide;
        const decision = frame.decision;
        if (decision !== 'reject_assessment' && decision !== 'withdraw_assessment') {
          throw invalid('decision 必须 reject_assessment|withdraw_assessment（批准走额度命令通道，不在评估层）');
        }
        if (row.status !== 'awaiting_human_review') throw conflict('NOT_READY', `评估当前 ${row.status}：仅 awaiting_human_review 可决定`);
        const rationale = reqString(frame.rationale ?? '', 'rationale', 2000, 0);
        const next = decision === 'reject_assessment' ? 'rejected' : 'superseded';
        await tx.query(`UPDATE credit_assessments SET status=$2, version=version+1, updated_at=now() WHERE assessment_id=$1`, [assessmentId, next]);
        const decisionId = newId('dec');
        await insertDecision(tx, {
          decisionId, tenantId: row.tenant_id as string, actor: ctx.actor, roleRef: 'credit',
          permissionRef: 'directory:credit', action: decision, subjectType: 'assessment', subjectId: assessmentId,
          customerId: row.customer_id as string, ruleVersion: row.rule_version as string, basisRef: null,
          rationale, beforeVersion: Number(row.version), afterVersion: Number(row.version) + 1,
        });
        await h.audit({
          actor: ctx.actor, action: 'assessment_decided', targetType: 'assessment', targetId: assessmentId,
          summary: `评估正式决定 ${decision}（不映射为通过/拒绝额度）`, payload: { decision },
        });
        await h.emit('DECISION_RECORDED', row.customer_id as string, { decisionId, decision, subjectId: assessmentId });
        return { ok: true, status: next, decisionId };
      });
    },

    // ---- TAKEOFF-FA-1.0.0 v2.6（§13）：预评估结论人工确认 ------------------------
    // 终点=有权人员确认预评估结论；scope=preassessment_only：不创建/激活/预占任何正式额度，
    // 不建融资申请，不写敞口账本（credit_facilities / financing_requests / exposure_entries 零写入）。
    // 旧 decide（reject/withdraw）语义不变；行政撤回仍走 decide withdraw_assessment。

    confirmPreassessment: (frame: RequestFrame, assessmentId: string) => {
      return withCommandV2(kernel, frame, 'assessment.confirm-preassessment', frame.tenantId as string, async (tx, h, ctx) => {
        // 1) 与证据/Gate 登记使用相同客户锁，避免核验与确认之间插入新依据。
        // 固定锁序：客户 → 评估（越权统一 404，不泄露存在性）。
        const located = await tx.query(`SELECT customer_id, tenant_id FROM credit_assessments WHERE assessment_id=$1`, [assessmentId]);
        if (located.rows.length === 0) throw notFound('评估不存在');
        const location = located.rows[0] as { customer_id: string; tenant_id: string };
        await scopeByRow(kernel, frame, location.tenant_id, location.customer_id);
        await lockCustomer(tx, location.customer_id, location.tenant_id);
        const a = await tx.query(`SELECT * FROM credit_assessments WHERE assessment_id=$1 FOR UPDATE`, [assessmentId]);
        if (a.rows.length === 0) throw notFound('评估不存在');
        const row = a.rows[0] as Record<string, unknown>;
        await scopeByRow(kernel, frame, row.tenant_id as string, row.customer_id as string);
        // 2) 人类身份 + 服务端目录信审角色（业务角色默认无确认权；agent/service 403；载荷声明无效）
        requireHuman(ctx, 'assessment.confirm-preassessment');
        requireDirectoryRole(ctx, ['credit'], 'assessment.confirm-preassessment');
        // 3) 锁内幂等复查（撤权/改派后重放不借缓存；同号同载荷单效果）
        const storedConfirm = await ctx.replayed(tx);
        if (storedConfirm !== null) return storedConfirm;
        // 4) 严格 Schema（未知字段 400；__path/credential/requestId 为传输层字段不参与）
        const ALLOWED = new Set(['tenantId', 'assessmentVersion', 'outcome', 'candidateRevision', 'inputVersion', 'ruleVersion', 'snapshotHash', 'conditions', 'rationale']);
        const unknown = Object.keys(frame).filter((k) => !ALLOWED.has(k) && k !== 'requestId' && k !== 'credential' && k !== 'principalCredential' && k !== '__path');
        if (unknown.length > 0) throw invalid(`confirm-preassessment 含未声明字段：${unknown.join(', ')}（严格 Schema）`);
        const outcome = reqString(frame.outcome, 'outcome', 32);
        if (!['support', 'support_with_conditions', 'not_support'].includes(outcome)) {
          throw invalid('outcome 必须 support|support_with_conditions|not_support');
        }
        if (typeof frame.assessmentVersion !== 'number' || !Number.isInteger(frame.assessmentVersion) || (frame.assessmentVersion as number) < 1) {
          throw invalid('assessmentVersion 必须是 ≥1 的整数（当前评估行版本，见 GET /assessments/:id）');
        }
        const conditions = Array.isArray(frame.conditions) ? frame.conditions.map((c) => reqString(c, 'conditions[]', 500)) : [];
        if (outcome === 'support_with_conditions' && conditions.length === 0) {
          throw invalid('outcome=support_with_conditions 必须至少给出一条条件');
        }
        if (outcome !== 'support_with_conditions' && conditions.length > 0) {
          throw invalid(`outcome=${outcome} 不携带条件（附条件只属于 support_with_conditions）`);
        }
        const rationale = reqString(frame.rationale, 'rationale', 2000);
        // 5) 版本门（乐观锁；冲突响应附服务端当前值，供前端刷新重试）
        const currentVersion = Number(row.version);
        if ((frame.assessmentVersion as number) !== currentVersion) {
          throw conflict('VERSION_CONFLICT', `评估版本已前移：请求 ${frame.assessmentVersion}，当前 ${currentVersion}`, { serverVersion: currentVersion });
        }
        const candRes = await tx.query(`SELECT * FROM assessment_candidates WHERE assessment_id=$1 ORDER BY revision DESC LIMIT 1`, [assessmentId]);
        const candRow = (candRes.rows[0] ?? null) as Record<string, unknown> | null;
        const currentRevision: number | null = candRow === null ? null : Number(candRow.revision);
        let candRevision: number | null;
        if (candRow === null) {
          if (frame.candidateRevision !== undefined && frame.candidateRevision !== null) {
            throw invalid('评估尚无候选方案：candidateRevision 必须省略（not_support 可在无候选时记录）');
          }
          candRevision = null;
        } else {
          candRevision = reqPosInt(frame.candidateRevision, 'candidateRevision', 1_000_000);
          if (candRevision !== currentRevision) {
            throw conflict('VERSION_CONFLICT', `候选修订已前移：请求 ${candRevision}，当前 ${currentRevision}`,
              { scope: 'candidate', serverCandidateRevision: currentRevision });
          }
        }
        // 6) 状态门（按结果区分；预评估结论一旦确认即为终态）
        const status = String(row.status);
        if (outcome === 'not_support') {
          // 有依据的负面终结：不要求无决策价值的工作先刷绿
          if (!['collecting', 'candidate_ready', 'awaiting_human_review'].includes(status)) {
            throw conflict('NOT_READY', `评估当前 ${status}：预评估结论已确认或评估已终结，不可再次确认`);
          }
        } else {
          if (status !== 'awaiting_human_review') {
            if (['draft', 'collecting', 'candidate_ready'].includes(status)) {
              throw conflict('NOT_READY', `评估当前 ${status}：正/附条件确认前须先提交人工审阅（submit-review）`);
            }
            throw conflict('NOT_READY', `评估当前 ${status}：预评估结论已确认或评估已终结，不可再次确认`);
          }
          if (candRow === null) throw conflict('NOT_READY', '评估尚无候选方案：正/附条件结论必须绑定候选修订');
        }
        // 7) 生效规则版本 = 候选声明优先，缺省评估行；显式期望不符 → STALE_BASIS
        const effectiveRuleVersion = candRow !== null && candRow.rule_version !== null && candRow.rule_version !== undefined && String(candRow.rule_version).length > 0
          ? String(candRow.rule_version) : String(row.rule_version);
        if (frame.inputVersion !== undefined && frame.inputVersion !== null) {
          const iv = frame.inputVersion;
          if (typeof iv !== 'number' || !Number.isInteger(iv) || iv < 0) throw invalid('inputVersion 必须是 ≥0 的整数');
          if (iv !== Number(row.input_version ?? 0)) {
            throw conflict('STALE_BASIS', `输入版本已前移：请求 ${iv}，当前 ${Number(row.input_version ?? 0)}`, { serverInputVersion: Number(row.input_version ?? 0) });
          }
        }
        if (frame.ruleVersion !== undefined && frame.ruleVersion !== null) {
          const rv = reqString(frame.ruleVersion, 'ruleVersion', 64);
          if (rv !== effectiveRuleVersion) {
            throw conflict('STALE_BASIS', `规则版本已变化：请求 ${rv}，当前 ${effectiveRuleVersion}`, { serverRuleVersion: effectiveRuleVersion });
          }
        }
        if (frame.snapshotHash !== undefined && frame.snapshotHash !== null) {
          const sh = reqString(frame.snapshotHash, 'snapshotHash', 128);
          if (sh !== String(row.snapshot_hash)) throw conflict('STALE_BASIS', '证据快照哈希与当前不符', { serverSnapshotHash: String(row.snapshot_hash) });
        }
        // 8) 结果相关硬门：仅正/附条件适用（冻结/冲突阻断正面确认；负面终结不适用，快照按当时实况入档）
        if (outcome !== 'not_support') {
          if (row.stale === true) throw conflict('STALE_BASIS', '评估依据已失效：快照工件被取代，须重新评估后确认');
          if (candRow !== null && Number(candRow.input_version) !== Number(row.input_version ?? 0)) {
            throw conflict('STALE_BASIS', '候选方案基于旧输入版本：须按当前输入重算/修订后再确认');
          }
          const snapshot = (row.evidence_snapshot ?? []) as { artifactId: string }[];
          const ids = snapshot.map((r) => r.artifactId);
          if (ids.length > 0) {
            const arts = await tx.query(
              `SELECT artifact_id, superseded_by, duplicate_of FROM evidence_artifacts WHERE artifact_id = ANY($1) FOR SHARE`, [ids]);
            const found = new Map<string, { superseded_by: string | null; duplicate_of: string | null }>(
              (arts.rows as { artifact_id: string; superseded_by: string | null; duplicate_of: string | null }[]).map((r) => [r.artifact_id, r]),
            );
            for (const ref of ids) {
              const art = found.get(ref);
              if (art === undefined) throw conflict('STALE_BASIS', `快照工件缺失：${ref}`);
              if (art.superseded_by !== null || art.duplicate_of !== null) {
                throw conflict('STALE_BASIS', `快照工件已失效：${ref}，须重新评估后确认`, { artifactId: ref });
              }
            }
          }
          // 正面确认必须有可信 CLEAR；缺失不能解释为通过。
          // 回执与候选须使用同一激活规则，并覆盖完全相同的证据快照。
          const gateRows = await tx.query(
            `SELECT receipt_id, result, ruleset_version, reason_codes, rule_ids, evidence_refs
             FROM rule_gate_receipts WHERE customer_id=$1 AND tenant_id=$2 ORDER BY created_at DESC, receipt_id DESC LIMIT 1`,
            [row.customer_id as string, row.tenant_id as string]);
          const gate = (gateRows.rows[0] ?? null) as Record<string, unknown> | null;
          if (gate === null) throw conflict('GATE_BLOCKED', '缺少规则 Gate 回执：须完成规则核验后才能正面确认', { gateResult: 'MISSING' });
          if (gate !== null) {
            const gateResult = String(gate.result);
            if (gateResult !== 'CLEAR') {
              throw conflict('GATE_BLOCKED',
                `Gate 硬门 ${gateResult}（回执 ${gate.receipt_id}）：不可豁免门阻断正面预评估确认；纠正事实/补证并重新收口后才能确认`,
                { gateReceiptId: gate.receipt_id, gateResult, ruleIds: gate.rule_ids ?? [], reasonCodes: gate.reason_codes ?? [] });
            }
            const activeRes = await tx.query(`SELECT version FROM rule_pack_versions WHERE status='active' LIMIT 1 FOR SHARE`);
            const activeVersion = (activeRes.rows[0] as { version: string } | undefined)?.version ?? null;
            if (activeVersion === null || String(gate.ruleset_version) !== activeVersion || effectiveRuleVersion !== activeVersion) {
              throw conflict('STALE_BASIS',
                `Gate 回执 ${gate.receipt_id} 依据规则 ${gate.ruleset_version}，当前激活 ${activeVersion}：须按当前规则重新收口后才能正面确认`,
                { gateReceiptId: gate.receipt_id, rulePackVersion: String(gate.ruleset_version), activeRulePackVersion: activeVersion, candidateRuleVersion: effectiveRuleVersion });
            }
            const refs = Array.isArray(gate.evidence_refs) ? gate.evidence_refs : [];
            const gateIds = new Set(refs.filter((ref): ref is string => typeof ref === 'string' && ref.length > 0));
            const snapshotIds = new Set(ids);
            if (snapshotIds.size === 0 || refs.length !== gateIds.size || gateIds.size !== snapshotIds.size ||
                [...snapshotIds].some((id) => !gateIds.has(id))) {
              throw conflict('STALE_BASIS', 'Gate 证据与本次评估快照不一致：须按当前证据重新收口', { gateReceiptId: gate.receipt_id });
            }
          }
          // 客户级未处理关键差异（复用决策闭环差异门；复核不等待冷却）
          await assertNoBlockingFindings(tx, row.customer_id as string, 'preassessment.confirm');
          // 快照内同一事实键多份现行断言 = 未解决冲突 → 阻断正面确认（解冻走补证/纠正/复核，不可一键豁免）
          const conflicts = await tx.query(
            `SELECT f.fact_key, COUNT(DISTINCT f.assertion_id)::int AS n
             FROM fact_assertions f JOIN evidence_artifacts art ON art.artifact_id = f.artifact_id
             WHERE art.customer_id=$1 AND art.superseded_by IS NULL AND art.duplicate_of IS NULL AND art.artifact_id = ANY($2)
             GROUP BY f.fact_key HAVING COUNT(DISTINCT f.assertion_id) > 1`, [row.customer_id as string, ids.length > 0 ? ids : ['']]);
          if (conflicts.rows.length > 0) {
            const list = (conflicts.rows as { fact_key: string; n: number }[]).map((c) => ({ factKey: c.fact_key, assertionCount: Number(c.n) }));
            throw conflict('REVIEW_REQUIRED',
              `快照存在未解决事实冲突：${list.map((c) => c.factKey).join(', ')}——补证/纠正/复核后才能正面确认`, { conflicts: list });
          }
        }
        // 9) 写入（同事务；失败零部分写入）：评估状态/版本 → 确认记录 → 决定 → 审计 → 事件
        const confirmationId = newId('pac');
        const nextVersion = currentVersion + 1;
        await tx.query(
          `UPDATE credit_assessments SET status='preassessment_confirmed', version=version+1, updated_at=now() WHERE assessment_id=$1`,
          [assessmentId],
        );
        const ins = await tx.query(
          `INSERT INTO preassessment_confirmations (confirmation_id, tenant_id, customer_id, assessment_id, outcome, scope,
             assessment_version, candidate_revision, input_version, snapshot_hash, rule_version, conditions, rationale,
             confirmed_by, role_ref, permission_ref)
           VALUES ($1,$2,$3,$4,$5,'preassessment_only',$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15)
           RETURNING confirmed_at`,
          [confirmationId, row.tenant_id, row.customer_id, assessmentId, outcome, currentVersion, candRevision,
           Number(row.input_version ?? 0), String(row.snapshot_hash), effectiveRuleVersion, JSON.stringify(conditions), rationale,
           ctx.actor, 'credit', 'directory:credit'],
        );
        // confirmedAt 以 DB 时间为权威：响应与后续读回逐字一致（读方不得见到两个"确认时刻"）
        const confirmedAt = (ins.rows[0] as { confirmed_at: string }).confirmed_at;
        await insertDecision(tx, {
          decisionId: newId('dec'), tenantId: row.tenant_id as string, actor: ctx.actor, roleRef: 'credit',
          permissionRef: 'directory:credit', action: 'preassessment.confirm', subjectType: 'assessment', subjectId: assessmentId,
          customerId: row.customer_id as string, ruleVersion: effectiveRuleVersion,
          basisRef: `${assessmentId}@${String(row.snapshot_hash)}`,
          rationale, beforeVersion: currentVersion, afterVersion: nextVersion,
        });
        await h.audit({
          actor: ctx.actor, action: 'preassessment_confirmed', targetType: 'assessment', targetId: assessmentId,
          summary: `预评估结论确认 ${outcome}（scope=preassessment_only；不产生授信效力）`, payload: { outcome, confirmationId },
        });
        await h.emit('PREASSESSMENT_CONFIRMED', row.customer_id as string, {
          confirmationId, assessmentId, customerId: row.customer_id, outcome, candidateRevision: candRevision,
          scope: 'preassessment_only', confirmedBy: ctx.actor,
        });
        return {
          ok: true, confirmationId, scope: 'preassessment_only', assessmentId, customerId: row.customer_id,
          tenantId: row.tenant_id, outcome, status: 'preassessment_confirmed',
          assessmentVersion: nextVersion, candidateRevision: candRevision, inputVersion: Number(row.input_version ?? 0),
          snapshotHash: String(row.snapshot_hash), ruleVersion: effectiveRuleVersion, conditions, rationale,
          confirmedBy: ctx.actor, confirmedAt,
        };
      });
    },

    /** v2.6 §13.2：候选修订历史读回（内部读；权限同评估单件——客户联系人 403、越权 404）。 */
    listAssessmentCandidates: async (credential: unknown, assessmentId: string) => {
      const res = await kernel.pool.query(`SELECT * FROM credit_assessments WHERE assessment_id=$1`, [assessmentId]);
      if (res.rows.length === 0) throw notFound('评估不存在');
      const row = res.rows[0] as Record<string, unknown>;
      await scopeByRow(kernel, { credential }, row.tenant_id as string, row.customer_id as string);
      await requireInternalRead(kernel, credential, '候选修订历史');
      const his = await kernel.pool.query(`SELECT * FROM assessment_candidates WHERE assessment_id=$1 ORDER BY revision`, [assessmentId]);
      const rows = his.rows as Record<string, unknown>[];
      const maxRev = rows.length === 0 ? null : Number((rows[rows.length - 1] as Record<string, unknown>).revision);
      return {
        ok: true, assessmentId,
        currentRevision: maxRev,
        candidates: rows.map((r) => projectCandidate({ ...r, is_current: maxRev !== null && Number(r.revision) === maxRev })),
      };
    },

    getAssessment: async (credential: unknown, assessmentId: string) => {
      const res = await kernel.pool.query(`SELECT * FROM credit_assessments WHERE assessment_id=$1`, [assessmentId]);
      if (res.rows.length === 0) throw notFound('评估不存在');
      const row = res.rows[0] as Record<string, unknown>;
      // 任务03：单件读与清单读同权（内部专用；客户联系人身份 403——B13 口径，先按租户/grant 裁决 404 再拦角色）。
      await scopeByRow(kernel, { credential }, row.tenant_id as string, row.customer_id as string);
      await requireInternalRead(kernel, credential, '评估');
      // v2.6 加法读回：输入版本/当前候选修订/预评估确认（含需复核投影）；既有字段不变
      const pc = await kernel.pool.query(`SELECT * FROM preassessment_confirmations WHERE assessment_id=$1`, [assessmentId]);
      const rev = await kernel.pool.query(`SELECT MAX(revision) AS rev FROM assessment_candidates WHERE assessment_id=$1`, [assessmentId]);
      const pcRow = (pc.rows[0] ?? null) as Record<string, unknown> | null;
      return {
        ok: true,
        assessment: {
          assessmentId, customerId: row.customer_id, status: row.status, stale: row.stale,
          staleReasons: row.stale_reasons, evidenceSnapshot: row.evidence_snapshot, snapshotHash: row.snapshot_hash,
          ruleVersion: row.rule_version, candidate: row.candidate, version: Number(row.version),
          inputVersion: Number(row.input_version ?? 0),
          candidateRevision: (rev.rows[0] as { rev: string | number | null }).rev === null ? null : Number((rev.rows[0] as { rev: string | number }).rev),
          preassessment: pcRow === null ? null : projectPreassessment(pcRow),
          // v2.6 §12：首次回租需求读回（request 为规范形状；requestedAmountMinor 为消费方既有读取路径的镜像，同值）
          request: projectAdmissionRequest(row, row.admission_request_revision),
          requestedAmountMinor: projectAdmissionRequest(row, row.admission_request_revision)?.requestedAmountMinor ?? null,
          createdAt: row.created_at, updatedAt: row.updated_at,
        },
      };
    },

    // ---- 任务03 IR-03-A ②：按客户权威分页清单（assessments / financing-requests） ----------------
    // 事件窗口只能"发现"引用（refsExhaustive=false）；权威清单以业务表为准：租户/grant/角色过滤、
    // 键集分页只基于业务 id（id 前缀含毫秒时间戳，字典序≈创建时间倒序；created_at 微秒经 JS 毫秒
    // 编码有截断，禁止用作游标键——口径同 §11 客户目录）。重启/长历史/撤权后同一查询语义不变。

    listCustomerAssessments: async (credential, customerId, opts) => {
      await lookupCustomer(kernel, credential, customerId);
      await requireInternalRead(kernel, credential, '评估清单');
      const limitRaw = opts.limit === undefined || opts.limit === null || opts.limit === '' ? 20 : Number(opts.limit);
      if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 100) throw invalid('limit 必须 1..100');
      const conds: string[] = ['a.customer_id=$1'];
      const params: unknown[] = [customerId];
      if (opts.cursor !== undefined && opts.cursor !== null && opts.cursor !== '') {
        params.push(decodeListCursor(opts.cursor));
        conds.push(`a.assessment_id < $${params.length}`);
      }
      params.push(limitRaw + 1);
      const res = await kernel.pool.query(
        `SELECT a.assessment_id, a.status, a.stale, a.stale_reasons, a.evidence_snapshot, a.snapshot_hash, a.rule_version,
                a.candidate, a.version, a.input_version, a.created_at, a.updated_at,
                a.admission_request AS a_req, a.admission_request_revision AS a_rev,
                pc.confirmation_id AS pc_id, pc.outcome AS pc_outcome, pc.scope AS pc_scope, pc.conditions AS pc_conditions,
                pc.rationale AS pc_rationale, pc.confirmed_by AS pc_by, pc.confirmed_at AS pc_at,
                pc.assessment_version AS pc_ass_ver, pc.candidate_revision AS pc_cand_rev, pc.input_version AS pc_input_ver,
                pc.snapshot_hash AS pc_snapshot, pc.rule_version AS pc_rule, pc.needs_review AS pc_needs_review,
                pc.review_reason AS pc_review_reason, pc.review_marked_at AS pc_review_at,
                c.max_rev AS cand_rev
         FROM credit_assessments a
         LEFT JOIN preassessment_confirmations pc ON pc.assessment_id = a.assessment_id
         LEFT JOIN (SELECT assessment_id, MAX(revision) AS max_rev FROM assessment_candidates GROUP BY assessment_id) c ON c.assessment_id = a.assessment_id
         WHERE ${conds.join(' AND ')}
         ORDER BY a.assessment_id DESC LIMIT $${params.length}`, params);
      const rows = res.rows as Record<string, unknown>[];
      const hasMore = rows.length > limitRaw;
      const page = hasMore ? rows.slice(0, limitRaw) : rows;
      const last = page[page.length - 1] as Record<string, unknown> | undefined;
      return {
        ok: true,
        customerId,
        assessments: page.map((r) => ({
          assessmentId: r.assessment_id, status: r.status, stale: r.stale, staleReasons: r.stale_reasons,
          evidenceSnapshot: r.evidence_snapshot, snapshotHash: r.snapshot_hash, ruleVersion: r.rule_version,
          candidate: r.candidate, version: Number(r.version), createdAt: r.created_at, updatedAt: r.updated_at,
          inputVersion: Number(r.input_version ?? 0),
          candidateRevision: r.cand_rev === null || r.cand_rev === undefined ? null : Number(r.cand_rev),
          preassessment: r.pc_id === null || r.pc_id === undefined ? null : projectPreassessment(r),
          request: projectAdmissionRequest(r, r.a_rev),
          requestedAmountMinor: projectAdmissionRequest(r, r.a_rev)?.requestedAmountMinor ?? null,
        })),
        nextCursor: hasMore && last ? encodeListCursor(String(last.assessment_id)) : null,
      };
    },

    listCustomerFinancingRequests: async (credential, customerId, opts) => {
      await lookupCustomer(kernel, credential, customerId);
      await requireInternalRead(kernel, credential, '融资申请清单');
      const limitRaw = opts.limit === undefined || opts.limit === null || opts.limit === '' ? 20 : Number(opts.limit);
      if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 100) throw invalid('limit 必须 1..100');
      const conds: string[] = ['customer_id=$1'];
      const params: unknown[] = [customerId];
      if (opts.cursor !== undefined && opts.cursor !== null && opts.cursor !== '') {
        params.push(decodeListCursor(opts.cursor));
        conds.push(`fr_id < $${params.length}`);
      }
      params.push(limitRaw + 1);
      const res = await kernel.pool.query(
        `SELECT fr_id, facility_id, product_type, amount_minor, currency, equipment_refs, contract_refs,
                status, external_state, external_ref, reserved_until, version, created_at, updated_at
         FROM financing_requests WHERE ${conds.join(' AND ')} ORDER BY fr_id DESC LIMIT $${params.length}`, params);
      const rows = res.rows as Record<string, unknown>[];
      const hasMore = rows.length > limitRaw;
      const page = hasMore ? rows.slice(0, limitRaw) : rows;
      const last = page[page.length - 1] as Record<string, unknown> | undefined;
      return {
        ok: true,
        customerId,
        financingRequests: page.map(projectFr),
        nextCursor: hasMore && last ? encodeListCursor(String(last.fr_id)) : null,
      };
    },

    // ---- S3/S4：额度设施（批准=人类+矩阵+集中度+依据复查；A14/A15 提交点统一裁决） ----

    proposeFacility: (frame: RequestFrame, customerId: string) => {
      return withCommandV2(kernel, frame, 'facility.propose', frame.tenantId as string, async (tx, h, ctx) => {
        requireHuman(ctx, 'facility.propose');
        requireDirectoryRole(ctx, ['credit'], 'facility.propose');
        const customer = await lockCustomer(tx, customerId, ctx.tenantId);
        const storedProp = await ctx.replayed(tx);
        if (storedProp !== null) return storedProp;
        const tenantId = customer.tenant_id as string;
        const assessmentId = reqString(frame.assessmentId, 'assessmentId', 64);
        // 任务02 3.4 + 任务01 A2/K07：提案必须绑定依据包；legacy 通道只在显式兼容核开启
        let packageId: string | null = null;
        let basisVersion: string | null = null;
        if (frame.packageId !== undefined && frame.packageId !== null) {
          packageId = reqString(frame.packageId, 'packageId', 64);
          const pk = await tx.query(`SELECT customer_id, revision FROM decision_packages WHERE package_id=$1`, [packageId]);
          if (pk.rows.length === 0) throw notFound('依据包不存在');
          const pr = pk.rows[0] as { customer_id: string; revision: number };
          if (pr.customer_id !== customerId) throw notFound('依据包不属于该客户');
          basisVersion = `${packageId}:${Number(pr.revision)}`;
        } else if (!cfgRef().allowLegacyBasis) {
          throw conflict('BASIS_PACKAGE_REQUIRED',
            '正式提案必须绑定依据包（packageId）：不能通过省略绕过新权威门（兼容核需显式 --allow-legacy-basis）');
        }
        const a = await tx.query(`SELECT status, stale, customer_id, rule_version, snapshot_hash FROM credit_assessments WHERE assessment_id=$1`, [assessmentId]);
        if (a.rows.length === 0) throw notFound('依据评估不存在');
        const ar = a.rows[0] as Record<string, unknown>;
        if (ar.customer_id !== customerId) throw notFound('评估不属于该客户');
        if (ar.status !== 'awaiting_human_review') throw conflict('NOT_READY', `依据评估当前 ${ar.status}：仅 awaiting_human_review 可提案额度`);
        if (ar.stale === true) throw conflict('STALE_BASIS', '依据评估已失效');
        const facilityId = newId('fac');
        await tx.query(
          `INSERT INTO credit_facilities (facility_id, tenant_id, customer_id, approved_amount_minor, currency, effective_from, effective_to,
             revolving, reserve_ttl_seconds, product_scope, conditions, basis, status, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,'proposed',$13)`,
          [facilityId, tenantId, customerId, reqInt(frame.approvedAmountMinor, 'approvedAmountMinor'), reqCurrency(frame.currency),
           optDate(frame.effectiveFrom, 'effectiveFrom'), optDate(frame.effectiveTo, 'effectiveTo'),
           frame.revolving === true, frame.reserveTtlSeconds === undefined || frame.reserveTtlSeconds === null ? null : reqInt(frame.reserveTtlSeconds, 'reserveTtlSeconds', 86400 * 30),
           JSON.stringify(frame.productScope ?? ['direct_lease', 'sale_leaseback']),
           JSON.stringify(frame.conditions ?? []),
           JSON.stringify({ assessmentId, ruleVersion: ar.rule_version, snapshotHash: ar.snapshot_hash, packageId, basisVersion }),
           ctx.actor],
        );
        await h.audit({
          actor: ctx.actor, action: 'facility_proposed', targetType: 'facility', targetId: facilityId,
          summary: '额度提案（无任何占用效力）', payload: { assessmentId },
        });
        await h.emit('FACILITY_PROPOSED', customerId, { facilityId, assessmentId });
        return { ok: true, facilityId, status: 'proposed' };
      });
    },

    approveFacility: (frame: RequestFrame, facilityId: string) => {
      return withCommandV2(kernel, frame, 'facility.approve', frame.tenantId as string, async (tx, h, ctx) => {
        const f0 = await tx.query(`SELECT tenant_id, customer_id FROM credit_facilities WHERE facility_id=$1`, [facilityId]);
        if (f0.rows.length === 0) throw notFound('额度设施不存在');
        await scopeByRow(kernel, frame, (f0.rows[0] as Record<string, unknown>).tenant_id as string, (f0.rows[0] as Record<string, unknown>).customer_id as string);
        await lockCustomer(tx, (f0.rows[0] as Record<string, unknown>).customer_id as string); // 固定锁序：客户 → 设施
        const facilityRow = await lockFacility(tx, facilityId);
        const rationale = reqString(frame.rationale ?? '', 'rationale', 2000, 0);
        const cfg = cfgRef();
        // 1) 领域不变量优先（A06）：币种与产品上限——任何权限都无法批准超上限/错币种的额度
        const currency = facilityRow.currency as string;
        const amount = Number(facilityRow.approved_amount_minor);
        if (currency !== 'CNY') throw conflict('CURRENCY_MISMATCH', `额度上限配置以 CNY 计；当前币种 ${currency} 需另行政策（本轮拒绝）`, { currency });
        if (amount > cfg.creditCapCnyMinor) {
          throw conflict('PRODUCT_CAP_EXCEEDED',
            `超出客户级产品上限：请求 ${amount} 分（=${amount / 100} 元）> 上限 ${cfg.creditCapCnyMinor} 分（=${cfg.creditCapCnyMinor / 100} 元，人民币）`,
            { requestedMinor: amount, capMinor: cfg.creditCapCnyMinor, currency: 'CNY', unit: 'minor（分）' });
        }
        // 2) 客户主上限：全部非终态设施合计不超上限（A01/A24：新建项目/多设施不能放大总额）
        const totals = await tx.query(
          `SELECT COALESCE(SUM(approved_amount_minor),0)::bigint AS total FROM credit_facilities
           WHERE customer_id=$1 AND status IN ('proposed','approved_inactive','active','suspended') AND facility_id <> $2`,
          [facilityRow.customer_id, facilityId],
        );
        const existingTotal = Number((totals.rows[0] as { total: string }).total);
        if (existingTotal + amount > cfg.creditCapCnyMinor) {
          throw conflict('PRODUCT_CAP_EXCEEDED',
            `客户级合计超额：已有 ${existingTotal} 分 + 请求 ${amount} 分 > 上限 ${cfg.creditCapCnyMinor} 分`,
            { existingTotalMinor: existingTotal, requestedMinor: amount, capMinor: cfg.creditCapCnyMinor, currency: 'CNY', unit: 'minor（分）' });
        }
        // 3) 集中度政策（P-03：未配置 → policy_pending 阻断；有关联组且配置组上限 → 合计校验）
        await requireConcentrationOk(tx, cfg, facilityRow);
        // 4) 人类 + 服务端矩阵（A19：载荷角色声明无效；矩阵缺失 → policy_pending）
        const perm = await requireMatrixPermission(tx, cfg, ctx, 'facility.approve', amount);
        // 5) 锁内幂等复查（A11/A08）：权限重验先于缓存回执
        const storedApprove = await ctx.replayed(tx);
        if (storedApprove !== null) return storedApprove;
        // 6) 依据复查（A15）：评估仍待审、未 stale、快照工件仍现行（共享锁防"检查后提交前被取代"）
        await reverifyBasis(tx, facilityRow);
        // 6.4) 客户级未决差异（3.2/B11）：阻断当前动作，不等待冷却；包绑定与否一律机械复查
        await assertNoBlockingFindings(tx, facilityRow.customer_id as string, 'approve_facility');
        // 6.5) 依据包提交点复查（任务02 3.4/B07 + 任务01 A2/K07）：当前性、Gate、未决差异在批准事务内重算
        const pkgBasis = facilityRow.basis as { packageId?: string } | null;
        if (pkgBasis?.packageId) {
          await checkPackageForAction(tx, facilityRow.customer_id as string, pkgBasis.packageId, 'approve_facility');
        } else if (!cfg.allowLegacyBasis) {
          throw conflict('BASIS_PACKAGE_REQUIRED',
            '存量依据未绑定依据包：批准阻断（旧数据只读可解释；兼容核需显式 --allow-legacy-basis）');
        }
        // 6.6) 提额冷却（B11；冷却秒数未配置=机制未启用，不编造默认）：提额批准进入冷却
        if (cfg.creditCoolingSeconds !== null && cfg.creditCoolingSeconds > 0) {
          const prevMax = await tx.query(
            `SELECT COALESCE(MAX(approved_amount_minor),0) AS m FROM credit_facilities
             WHERE customer_id=$1 AND status IN ('proposed','approved_inactive','active','suspended') AND facility_id<>$2`,
            [facilityRow.customer_id, facilityId],
          );
          const prevMaxMinor = Number((prevMax.rows[0] as { m: string }).m);
          if (prevMaxMinor > 0 && amount > prevMaxMinor) {
            await tx.query(
              `UPDATE credit_facilities SET cooling_until = now() + make_interval(secs => $2::int) WHERE facility_id=$1`,
              [facilityId, cfg.creditCoolingSeconds],
            );
          }
        }
        // 7) 状态门：proposed → approved_inactive（拒绝是评估决定，不存在"被拒额度"）
        if (facilityRow.status !== 'proposed') throw conflict('NOT_READY', `额度当前 ${facilityRow.status}：仅 proposed 可批准`);
        const decisionId = newId('dec');
        await tx.query(
          `UPDATE credit_facilities SET status='approved_inactive', approval_chain=$2::jsonb, version=version+1, updated_at=now()
           WHERE facility_id=$1`,
          [facilityId, JSON.stringify([decisionId])],
        );
        await insertDecision(tx, {
          decisionId, tenantId: facilityRow.tenant_id as string, actor: ctx.actor, roleRef: perm.role,
          permissionRef: perm.ref, action: 'facility.approve', subjectType: 'facility', subjectId: facilityId,
          customerId: facilityRow.customer_id as string,
          ruleVersion: (facilityRow.basis as { ruleVersion?: string })?.ruleVersion ?? null,
          basisRef: `${(facilityRow.basis as { assessmentId?: string })?.assessmentId}@${(facilityRow.basis as { snapshotHash?: string })?.snapshotHash}`,
          rationale, beforeVersion: Number(facilityRow.version), afterVersion: Number(facilityRow.version) + 1,
        });
        await h.audit({
          actor: ctx.actor, action: 'facility_approved', targetType: 'facility', targetId: facilityId,
          summary: `额度批准 ${amount} 分（approved_inactive，未激活）`, payload: { decisionId },
        });
        await h.emit('FACILITY_APPROVED', facilityRow.customer_id as string, { facilityId, decisionId });
        await h.emit('FORMAL_DECISION_RECORDED', facilityRow.customer_id as string,
          { decisionId, action: 'facility.approve', subjectType: 'facility', subjectId: facilityId });
        return { ok: true, facilityId, status: 'approved_inactive', decisionId };
      });
    },

    activateFacility: (frame: RequestFrame, facilityId: string) => {
      return withCommandV2(kernel, frame, 'facility.activate', frame.tenantId as string, async (tx, h, ctx) => {
        const f0 = await tx.query(`SELECT tenant_id, customer_id FROM credit_facilities WHERE facility_id=$1`, [facilityId]);
        if (f0.rows.length === 0) throw notFound('额度设施不存在');
        await scopeByRow(kernel, frame, (f0.rows[0] as Record<string, unknown>).tenant_id as string, (f0.rows[0] as Record<string, unknown>).customer_id as string);
        await lockCustomer(tx, (f0.rows[0] as Record<string, unknown>).customer_id as string);
        const facilityRow = await lockFacility(tx, facilityId);
        const rationale = reqString(frame.rationale ?? '', 'rationale', 2000, 0);
        const cfg = cfgRef();
        const perm = await requireMatrixPermission(tx, cfg, ctx, 'facility.activate', Number(facilityRow.approved_amount_minor));
        const storedAct = await ctx.replayed(tx);
        if (storedAct !== null) return storedAct;
        await requireConcentrationOk(tx, cfg, facilityRow);
        await reverifyBasis(tx, facilityRow);
        // 任务02 3.4 + 任务01 A2/K07：绑定依据包的激活按包复查当前性（B08：不能沿用旧批准绕过当前 Gate）；
        // 未绑定包的存量在默认核下阻断（K07），显式兼容核按评估复查路径放行
        const pkgBasisAct = facilityRow.basis as { packageId?: string } | null;
        if (pkgBasisAct?.packageId) {
          await checkPackageForAction(tx, facilityRow.customer_id as string, pkgBasisAct.packageId, 'activate_facility');
        } else if (!cfg.allowLegacyBasis) {
          throw conflict('BASIS_PACKAGE_REQUIRED', '存量依据未绑定依据包：激活阻断（兼容核需显式 --allow-legacy-basis）');
        }
        // B11：未决差异先于冷却阻断（复核不等待冷却）；冷却未到 → 激活/恢复不得生效
        await assertNoBlockingFindings(tx, facilityRow.customer_id as string, 'activate_facility');
        // activate 承载两种人类恢复语义：approved_inactive→active（首次激活）；suspended→active（复核后恢复）
        if (facilityRow.status !== 'approved_inactive' && facilityRow.status !== 'suspended') {
          throw conflict('NOT_READY', `额度当前 ${facilityRow.status}：仅 approved_inactive|suspended 可激活/恢复`);
        }
        // B11：提额冷却未到 → 激活/恢复不得生效（冷却不豁免差异复核；复核动作不受冷却影响）
        const coolingUntilAct = facilityRow.cooling_until as string | Date | null | undefined;
        if (coolingUntilAct !== null && coolingUntilAct !== undefined && new Date(coolingUntilAct).getTime() > Date.now()) {
          throw conflict('COOLING_ACTIVE',
            `提额冷却期内：激活/恢复不得生效（至 ${new Date(coolingUntilAct).toISOString()}）；差异复核不受冷却影响`,
            { coolingUntil: new Date(coolingUntilAct).toISOString() });
        }
        const decisionId = newId('dec');
        await tx.query(`UPDATE credit_facilities SET status='active', version=version+1, updated_at=now() WHERE facility_id=$1`, [facilityId]);
        await insertDecision(tx, {
          decisionId, tenantId: facilityRow.tenant_id as string, actor: ctx.actor, roleRef: perm.role,
          permissionRef: perm.ref, action: 'facility.activate', subjectType: 'facility', subjectId: facilityId,
          customerId: facilityRow.customer_id as string, ruleVersion: null,
          basisRef: (facilityRow.basis as { assessmentId?: string })?.assessmentId ?? null,
          rationale, beforeVersion: Number(facilityRow.version), afterVersion: Number(facilityRow.version) + 1,
        });
        await h.audit({
          actor: ctx.actor, action: 'facility_activated', targetType: 'facility', targetId: facilityId,
          summary: '额度激活', payload: { decisionId },
        });
        await h.emit('FACILITY_ACTIVATED', facilityRow.customer_id as string, { facilityId, decisionId });
        await h.emit('FORMAL_DECISION_RECORDED', facilityRow.customer_id as string,
          { decisionId, action: 'facility.activate', subjectType: 'facility', subjectId: facilityId });
        return { ok: true, facilityId, status: 'active', decisionId };
      });
    },

    suspendFacility: (frame: RequestFrame, facilityId: string) => {
      return withCommandV2(kernel, frame, 'facility.suspend', frame.tenantId as string, async (tx, h, ctx) => {
        const f0 = await tx.query(`SELECT tenant_id, customer_id FROM credit_facilities WHERE facility_id=$1`, [facilityId]);
        if (f0.rows.length === 0) throw notFound('额度设施不存在');
        await scopeByRow(kernel, frame, (f0.rows[0] as Record<string, unknown>).tenant_id as string, (f0.rows[0] as Record<string, unknown>).customer_id as string);
        await lockCustomer(tx, (f0.rows[0] as Record<string, unknown>).customer_id as string);
        const facilityRow = await lockFacility(tx, facilityId);
        const rationale = reqString(frame.rationale ?? '', 'rationale', 2000, 0);
        const cfg = cfgRef();
        const perm = await requireMatrixPermission(tx, cfg, ctx, 'facility.suspend', null);
        const storedSusp = await ctx.replayed(tx);
        if (storedSusp !== null) return storedSusp;
        if (facilityRow.status !== 'active' && facilityRow.status !== 'approved_inactive') {
          throw conflict('NOT_READY', `额度当前 ${facilityRow.status}：不可暂停`);
        }
        const decisionId = newId('dec');
        await tx.query(`UPDATE credit_facilities SET status='suspended', version=version+1, updated_at=now() WHERE facility_id=$1`, [facilityId]);
        await insertDecision(tx, {
          decisionId, tenantId: facilityRow.tenant_id as string, actor: ctx.actor, roleRef: perm.role,
          permissionRef: perm.ref, action: 'facility.suspend', subjectType: 'facility', subjectId: facilityId,
          customerId: facilityRow.customer_id as string, ruleVersion: null, basisRef: null,
          rationale, beforeVersion: Number(facilityRow.version), afterVersion: Number(facilityRow.version) + 1,
        });
        await h.audit({
          actor: ctx.actor, action: 'facility_suspended', targetType: 'facility', targetId: facilityId,
          summary: `额度暂停：${rationale || '（无备注）'}`, payload: { decisionId },
        });
        await h.emit('FACILITY_SUSPENDED', facilityRow.customer_id as string, { facilityId, decisionId });
        await h.emit('FORMAL_DECISION_RECORDED', facilityRow.customer_id as string,
          { decisionId, action: 'facility.suspend', subjectType: 'facility', subjectId: facilityId });
        return { ok: true, facilityId, status: 'suspended', decisionId };
      });
    },

    reduceFacility: (frame: RequestFrame, facilityId: string) => {
      return withCommandV2(kernel, frame, 'facility.reduce', frame.tenantId as string, async (tx, h, ctx) => {
        const f0 = await tx.query(`SELECT tenant_id, customer_id FROM credit_facilities WHERE facility_id=$1`, [facilityId]);
        if (f0.rows.length === 0) throw notFound('额度设施不存在');
        await scopeByRow(kernel, frame, (f0.rows[0] as Record<string, unknown>).tenant_id as string, (f0.rows[0] as Record<string, unknown>).customer_id as string);
        await lockCustomer(tx, (f0.rows[0] as Record<string, unknown>).customer_id as string);
        const facilityRow = await lockFacility(tx, facilityId);
        const rationale = reqString(frame.rationale ?? '', 'rationale', 2000, 0);
        const cfg = cfgRef();
        const newAmount = reqInt(frame.approvedAmountMinor, 'approvedAmountMinor');
        const perm = await requireMatrixPermission(tx, cfg, ctx, 'facility.reduce', newAmount);
        const storedReduce = await ctx.replayed(tx);
        if (storedReduce !== null) return storedReduce;
        if (facilityRow.status !== 'active' && facilityRow.status !== 'approved_inactive') {
          throw conflict('NOT_READY', `额度当前 ${facilityRow.status}：不可降额`);
        }
        if (newAmount >= Number(facilityRow.approved_amount_minor)) throw invalid('降额金额必须小于当前批准额');
        const decisionId = newId('dec');
        await tx.query(
          `UPDATE credit_facilities SET approved_amount_minor=$2, version=version+1, updated_at=now() WHERE facility_id=$1`,
          [facilityId, newAmount],
        );
        await insertDecision(tx, {
          decisionId, tenantId: facilityRow.tenant_id as string, actor: ctx.actor, roleRef: perm.role,
          permissionRef: perm.ref, action: 'facility.reduce', subjectType: 'facility', subjectId: facilityId,
          customerId: facilityRow.customer_id as string, ruleVersion: null, basisRef: null,
          rationale: `${rationale}（降额 ${Number(facilityRow.approved_amount_minor)} → ${newAmount} 分；存量敞口保留，超额如实显示）`,
          beforeVersion: Number(facilityRow.version), afterVersion: Number(facilityRow.version) + 1,
        });
        await h.audit({
          actor: ctx.actor, action: 'facility_reduced', targetType: 'facility', targetId: facilityId,
          summary: `额度降额 ${Number(facilityRow.approved_amount_minor)} → ${newAmount} 分`, payload: { decisionId },
        });
        await h.emit('FACILITY_REDUCED', facilityRow.customer_id as string, { facilityId, decisionId, newAmount });
        await h.emit('FORMAL_DECISION_RECORDED', facilityRow.customer_id as string,
          { decisionId, action: 'facility.reduce', subjectType: 'facility', subjectId: facilityId });
        // A16：降额低于存量敞口 → 视图如实显示 over_limit，历史敞口不篡改
        const view = await facilityView(tx, { ...facilityRow, approved_amount_minor: newAmount }, { expire: true, helpers: h, customerId: facilityRow.customer_id as string });
        return { ok: true, facilityId, approvedAmountMinor: newAmount, exposure: view, decisionId };
      });
    },

    getFacility: async (credential: unknown, facilityId: string) => {
      const f0 = await kernel.pool.query(`SELECT * FROM credit_facilities WHERE facility_id=$1`, [facilityId]);
      if (f0.rows.length === 0) throw notFound('额度设施不存在');
      const facility = f0.rows[0] as Record<string, unknown>;
      await scopeByRow(kernel, { credential }, facility.tenant_id as string, facility.customer_id as string);
      const client = await kernel.pool.connect();
      try {
        const view = await facilityView(client, facility, { expire: false });
        return { ok: true, facility: projectFacility(facility), exposure: view };
      } finally {
        client.release();
      }
    },

    // ---- S3：融资申请与额度占用（客户行锁串行；作用域幂等；unknown 不释放） ----

    createFinancingRequest: (frame: RequestFrame, customerId: string) => {
      return withCommandV2(kernel, frame, 'fr.create', frame.tenantId as string, async (tx, h, ctx) => {
        requireHuman(ctx, 'fr.create');
        requireDirectoryRole(ctx, ['business', 'credit'], 'fr.create');
        const customer = await lockCustomer(tx, customerId, ctx.tenantId);
        await requireCustomerScope(ctx, customerId, tx);
        const storedFr = await ctx.replayed(tx);
        if (storedFr !== null) return storedFr;
        const tenantId = customer.tenant_id as string;
        const facilityId = reqString(frame.facilityId, 'facilityId', 64);
        const productType = reqString(frame.productType, 'productType', 32);
        if (!PRODUCT_TYPES.includes(productType as never)) throw invalid(`productType 必须 ${PRODUCT_TYPES.join('/')}`);
        const amountMinor = reqPosInt(frame.amountMinor, 'amountMinor');
        const currency = reqCurrency(frame.currency);
        const facility = await tx.query(`SELECT currency, product_scope FROM credit_facilities WHERE facility_id=$1`, [facilityId]);
        if (facility.rows.length === 0) throw notFound('额度设施不存在');
        const fr0 = facility.rows[0] as Record<string, unknown>;
        if (fr0.currency !== currency) throw conflict('CURRENCY_MISMATCH', `设施币种 ${fr0.currency} 与申请币种 ${currency} 不一致`);
        const scope = fr0.product_scope as string[];
        if (Array.isArray(scope) && scope.length > 0 && !scope.includes(productType)) {
          throw invalid(`产品 ${productType} 不在额度范围内：${scope.join('/')}`);
        }
        const frId = newId('fr');
        await tx.query(
          `INSERT INTO financing_requests (fr_id, tenant_id, customer_id, facility_id, product_type, amount_minor, currency, equipment_refs, contract_refs, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)`,
          [frId, tenantId, customerId, facilityId, productType, amountMinor, currency,
           JSON.stringify(frame.equipmentRefs ?? []), JSON.stringify(frame.contractRefs ?? []), ctx.actor],
        );
        // A01：新建项目/新渠道不产生任何额度；只有后续 reserve 通道受客户锁与账本约束
        if (frame.projectId !== undefined && frame.projectId !== null) {
          const pid = reqString(frame.projectId, 'projectId', 64);
          await tx.query(`UPDATE projects SET customer_id=$2 WHERE project_id=$1 AND customer_id IS NULL`, [pid, customerId]);
        }
        await h.audit({
          actor: ctx.actor, action: 'fr_created', targetType: 'financing_request', targetId: frId,
          summary: `融资申请 ${productType} ${amountMinor} 分`, payload: { facilityId, productType },
        });
        await h.emit('FR_SUBMITTED', customerId, { frId, facilityId, productType, amountMinor });
        await h.emit('USE_READINESS_CHANGED', customerId, { frId, status: 'submitted', amountMinor });
        return { ok: true, frId, status: 'submitted' };
      });
    },

    reserveFinancing: (frame: RequestFrame, frId: string) => {
      return withCommandV2(kernel, frame, 'fr.reserve', frame.tenantId as string, async (tx, h, ctx) => {
        const fr = await tx.query(`SELECT * FROM financing_requests WHERE fr_id=$1`, [frId]);
        if (fr.rows.length === 0) throw notFound('融资申请不存在');
        const frLoc = fr.rows[0] as Record<string, unknown>;
        await scopeByRow(kernel, frame, frLoc.tenant_id as string, frLoc.customer_id as string);
        requireHuman(ctx, 'fr.reserve');
        requireDirectoryRole(ctx, ['business', 'credit'], 'fr.reserve');
        await lockCustomer(tx, frLoc.customer_id as string); // A07/A24：客户级串行点
        const facilityRow = await lockFacility(tx, frLoc.facility_id as string);
        const frRow = await lockFr(tx, frId); // A3.1：锁内新读
        const storedReserve = await ctx.replayed(tx);
        if (storedReserve !== null) return storedReserve;
        const view = await facilityView(tx, facilityRow, { expire: true, helpers: h, customerId: frRow.customer_id as string });
        if (frRow.status !== 'submitted') throw conflict('NOT_READY', `申请当前 ${frRow.status}：仅 submitted 可预占`);
        if (frRow.currency !== facilityRow.currency) throw conflict('CURRENCY_MISMATCH', '申请与设施币种不一致');
        // 冷却不在硬阻断列（K18：只影响向上申请/发布）；状态/超限/依据失效才是
        const hardBlockers = view.staleBlockers.filter((b) => b !== 'cooling_active');
        if (hardBlockers.length > 0) {
          throw conflict(
            hardBlockers.includes('stale_basis') ? 'STALE_BASIS' : 'FACILITY_NOT_ACTIVE',
            `额度不可用：${hardBlockers.join(', ')}`, { blockers: hardBlockers });
        }
        const amount = Number(frRow.amount_minor);
        if (amount > view.availableForNewDrawMinor) {
          throw conflict('INSUFFICIENT_AVAILABLE_AMOUNT',
            `可用额不足：请求 ${amount} 分，可用 ${view.availableForNewDrawMinor} 分`,
            { requestedMinor: amount, availableMinor: view.availableForNewDrawMinor, currency: frRow.currency });
        }
        // A3.4：预占提交点复查——未决差异先行（REVIEW_REQUIRED），再按依据包/兼容核拦截（复用门内视图，不重复聚合）
        const gateView = await assertFrUseGates(tx, cfgRef(), facilityRow, frRow, 'reserve', view);
        const txId = uuid();
        const ttl = facilityRow.reserve_ttl_seconds as number | null;
        await insertEntry(tx, {
          tenantId: frRow.tenant_id as string, customerId: frRow.customer_id as string, facilityId: frRow.facility_id as string,
          frId, entryType: 'reserve', amountMinor: amount, currency: frRow.currency as string,
          scopeHash: ctx.scopeHash, requestId: frame.requestId as string, txId, actor: ctx.actor,
        });
        await tx.query(
          `UPDATE financing_requests SET status='reserved', reserved_until = CASE WHEN $2::int IS NULL THEN NULL ELSE now() + make_interval(secs => $2::int) END,
             version=version+1, updated_at=now() WHERE fr_id=$1`,
          [frId, ttl],
        );
        await h.audit({
          actor: ctx.actor, action: 'reservation_placed', targetType: 'financing_request', targetId: frId,
          summary: `预占 ${amount} 分`, payload: { facilityId: frRow.facility_id, txId },
        });
        // goal-01 P2：同事务内本命令是唯一写者，门内快照 + 本笔增量即提交后状态（与重读聚合逐字段一致）
        const exposureAfter = {
          reservedMinor: gateView.reservedMinor + amount,
          committedMinor: gateView.committedMinor,
          outstandingMinor: gateView.outstandingMinor,
          lifetimeDisbursedMinor: gateView.lifetimeDisbursedMinor,
          exposureNowMinor: gateView.exposureNowMinor + amount,
          approvedAmountMinor: Number(facilityRow.approved_amount_minor),
        };
        for (const v of [exposureAfter.reservedMinor, exposureAfter.exposureNowMinor]) {
          if (!Number.isSafeInteger(v)) {
            throw new AppError('INTERNAL', `预占后桶值超出安全整数范围（facility ${frRow.facility_id}）：拒绝推导，不静默舍入`);
          }
        }
        await h.emit('RESERVATION_PLACED', frRow.customer_id as string, { frId, facilityId: frRow.facility_id, amountMinor: amount, txId });
        await h.emit('LEDGER_ENTRY_APPENDED', frRow.customer_id as string, { entryType: 'reserve', amountMinor: amount, facilityId: frRow.facility_id, txId });
        await h.emit('USE_READINESS_CHANGED', frRow.customer_id as string,
          { frId, status: 'reserved', amountMinor: amount, exposure: { ...exposureAfter } });
        return { ok: true, frId, status: 'reserved', exposure: { ...exposureAfter } };
      });
    },

    releaseFinancing: (frame: RequestFrame, frId: string) => {
      return withCommandV2(kernel, frame, 'fr.release', frame.tenantId as string, async (tx, h, ctx) => {
        const fr = await tx.query(`SELECT * FROM financing_requests WHERE fr_id=$1`, [frId]);
        if (fr.rows.length === 0) throw notFound('融资申请不存在');
        const frLoc = fr.rows[0] as Record<string, unknown>;
        await scopeByRow(kernel, frame, frLoc.tenant_id as string, frLoc.customer_id as string);
        requireHuman(ctx, 'fr.release');
        requireDirectoryRole(ctx, ['business', 'credit'], 'fr.release');
        await lockCustomer(tx, frLoc.customer_id as string);
        await lockFacility(tx, frLoc.facility_id as string);
        const frRow = await lockFr(tx, frId); // A3.1：锁内新读
        const storedRelease = await ctx.replayed(tx);
        if (storedRelease !== null) return storedRelease;
        if (frRow.status !== 'reserved' && frRow.status !== 'submitted') {
          // 外部出账已介入（sent/unknown/confirmed）→ 即使状态可释放也必须走对账通道（A12）
          if (frRow.external_state !== 'none') {
            throw conflict('RESERVATION_IRREVERSIBLE_STATE', `外部出账状态 ${frRow.external_state}：禁止直接释放，须经对账复核命令`);
          }
          throw conflict('NOT_READY', `申请当前 ${frRow.status}：仅 submitted|reserved 可释放`);
        }
        if (frRow.external_state !== 'none') {
          throw conflict('RESERVATION_IRREVERSIBLE_STATE', `外部出账状态 ${frRow.external_state}：禁止直接释放，须经对账复核命令`);
        }
        if (frRow.status === 'submitted') {
          await tx.query(`UPDATE financing_requests SET status='cancelled', version=version+1, updated_at=now() WHERE fr_id=$1`, [frId]);
          await h.audit({
            actor: ctx.actor, action: 'fr_cancelled', targetType: 'financing_request', targetId: frId,
            summary: '取消未预占申请（无账目）', payload: {},
          });
          return { ok: true, frId, status: 'cancelled' };
        }
        if (frRow.status !== 'reserved') throw conflict('NOT_READY', `申请当前 ${frRow.status}：仅 submitted|reserved 可释放`);
        const orig = await tx.query(
          `SELECT request_scope, request_id FROM exposure_entries WHERE fr_id=$1 AND entry_type='reserve' ORDER BY seq DESC LIMIT 1`, [frId],
        );
        const o = orig.rows[0] as { request_scope: string; request_id: string };
        const txId = uuid();
        await insertEntry(tx, {
          tenantId: frRow.tenant_id as string, customerId: frRow.customer_id as string, facilityId: frRow.facility_id as string,
          frId, entryType: 'reserve_release', amountMinor: Number(frRow.amount_minor), currency: frRow.currency as string,
          scopeHash: o.request_scope, requestId: o.request_id, txId, actor: ctx.actor,
        });
        await tx.query(`UPDATE financing_requests SET status='cancelled', reserved_until=NULL, version=version+1, updated_at=now() WHERE fr_id=$1`, [frId]);
        await h.audit({
          actor: ctx.actor, action: 'reservation_released', targetType: 'financing_request', targetId: frId,
          summary: `释放预占 ${Number(frRow.amount_minor)} 分`, payload: { txId },
        });
        await h.emit('RESERVATION_RELEASED', frRow.customer_id as string, { frId, txId });
        await h.emit('USE_READINESS_CHANGED', frRow.customer_id as string, { frId, status: 'cancelled' });
        return { ok: true, frId, status: 'cancelled' };
      });
    },

    commitFinancing: (frame: RequestFrame, frId: string) => {
      return withCommandV2(kernel, frame, 'fr.commit', frame.tenantId as string, async (tx, h, ctx) => {
        const fr = await tx.query(`SELECT * FROM financing_requests WHERE fr_id=$1`, [frId]);
        if (fr.rows.length === 0) throw notFound('融资申请不存在');
        const frLoc = fr.rows[0] as Record<string, unknown>;
        await scopeByRow(kernel, frame, frLoc.tenant_id as string, frLoc.customer_id as string);
        requireHuman(ctx, 'fr.commit');
        requireDirectoryRole(ctx, ['business'], 'fr.commit');
        await lockCustomer(tx, frLoc.customer_id as string);
        const facilityRow = await lockFacility(tx, frLoc.facility_id as string);
        const frRow = await lockFr(tx, frId); // A3.1：锁内新读
        const storedCommit = await ctx.replayed(tx);
        if (storedCommit !== null) return storedCommit;
        if (frRow.status !== 'reserved') throw conflict('NOT_READY', `申请当前 ${frRow.status}：仅 reserved 可承诺`);
        // A3.4/K14/K15：提交点机械复查——设施状态/依据当前性/未决差异（复核先提交则后续动作被阻断）
        await assertFrUseGates(tx, kernel.configForV2(), facilityRow, frRow, 'commit');
        const o = await lastEntryScope(tx, frId, 'reserve');
        const txId = uuid();
        await insertEntry(tx, {
          tenantId: frRow.tenant_id as string, customerId: frRow.customer_id as string, facilityId: frRow.facility_id as string,
          frId, entryType: 'reserve_commit', amountMinor: Number(frRow.amount_minor), currency: frRow.currency as string,
          scopeHash: o.request_scope, requestId: o.request_id, txId, actor: ctx.actor,
        });
        await tx.query(`UPDATE financing_requests SET status='committed', reserved_until=NULL, version=version+1, updated_at=now() WHERE fr_id=$1`, [frId]);
        await h.audit({
          actor: ctx.actor, action: 'fr_committed', targetType: 'financing_request', targetId: frId,
          summary: `承诺未出账 ${Number(frRow.amount_minor)} 分`, payload: { txId },
        });
        await h.emit('FR_COMMITTED', frRow.customer_id as string, { frId, txId });
        await h.emit('USE_READINESS_CHANGED', frRow.customer_id as string, { frId, status: 'committed' });
        await h.emit('LEDGER_ENTRY_APPENDED', frRow.customer_id as string, { entryType: 'reserve_commit', amountMinor: Number(frRow.amount_minor), facilityId: frRow.facility_id, txId });
        return { ok: true, frId, status: 'committed' };
      });
    },

    disburseFinancing: (frame: RequestFrame, frId: string) => {
      return withCommandV2(kernel, frame, 'fr.disburse', frame.tenantId as string, async (tx, h, ctx) => {
        const fr = await tx.query(`SELECT * FROM financing_requests WHERE fr_id=$1`, [frId]);
        if (fr.rows.length === 0) throw notFound('融资申请不存在');
        const frLoc = fr.rows[0] as Record<string, unknown>;
        await scopeByRow(kernel, frame, frLoc.tenant_id as string, frLoc.customer_id as string);
        requireHuman(ctx, 'fr.disburse');
        requireDirectoryRole(ctx, ['business'], 'fr.disburse');
        await lockCustomer(tx, frLoc.customer_id as string);
        const facilityRow = await lockFacility(tx, frLoc.facility_id as string);
        const frRow = await lockFr(tx, frId); // A3.1：锁内新读
        const storedDisburse = await ctx.replayed(tx);
        if (storedDisburse !== null) return storedDisburse;
        if (frRow.status !== 'committed') throw conflict('NOT_READY', `申请当前 ${frRow.status}：仅 committed 可出账`);
        // A3.4/K14：出账提交点同门（模拟与实际资金明确区分；unknown 不动桶）
        await assertFrUseGates(tx, kernel.configForV2(), facilityRow, frRow, 'disburse');
        // P-07：本轮只对接受控模拟适配器；simulationMode=unknown 模拟"已发送、结果未知"
        const mode = frame.simulationMode === 'unknown' ? 'unknown' : 'succeed';
        const txId = uuid();
        if (mode === 'unknown') {
          // 不产生账目、不移动桶；占用保持持有（A12）
          await tx.query(
            `UPDATE financing_requests SET status='disbursing_unknown', external_state='unknown', external_ref=$2, version=version+1, updated_at=now() WHERE fr_id=$1`,
            [frId, txId],
          );
          await h.audit({
            actor: ctx.actor, action: 'disburse_unknown', targetType: 'financing_request', targetId: frId,
            summary: '模拟出账已发送、结果未知：占用保持，等待对账（不盲重发/不自动释放）', payload: { txId },
          });
          await h.emit('SETTLE_UNKNOWN_RECONCILE_OPENED', frRow.customer_id as string, { frId, txId });
          return { ok: true, frId, status: 'disbursing_unknown', externalRef: txId };
        }
        const o = await lastEntryScope(tx, frId, 'reserve_commit');
        await insertEntry(tx, {
          tenantId: frRow.tenant_id as string, customerId: frRow.customer_id as string, facilityId: frRow.facility_id as string,
          frId, entryType: 'disburse', amountMinor: Number(frRow.amount_minor), currency: frRow.currency as string,
          scopeHash: o.request_scope, requestId: o.request_id, txId, actor: ctx.actor,
        });
        await tx.query(
          `UPDATE financing_requests SET status='disbursed', external_state='confirmed', external_ref=$2, version=version+1, updated_at=now() WHERE fr_id=$1`,
          [frId, txId],
        );
        await h.audit({
          actor: ctx.actor, action: 'disburse_confirmed', targetType: 'financing_request', targetId: frId,
          summary: `模拟出账确认 ${Number(frRow.amount_minor)} 分（进入 outstanding）`, payload: { txId },
        });
        await h.emit('SETTLE_CONFIRMED', frRow.customer_id as string, { frId, txId, kind: 'disburse' });
        await h.emit('USE_READINESS_CHANGED', frRow.customer_id as string, { frId, status: 'disbursed' });
        await h.emit('LEDGER_ENTRY_APPENDED', frRow.customer_id as string, { entryType: 'disburse', amountMinor: Number(frRow.amount_minor), facilityId: frRow.facility_id, txId });
        return { ok: true, frId, status: 'disbursed' };
      });
    },

    settleFinancing: (frame: RequestFrame, frId: string) => {
      return withCommandV2(kernel, frame, 'fr.settle', frame.tenantId as string, async (tx, h, ctx) => {
        const fr = await tx.query(`SELECT * FROM financing_requests WHERE fr_id=$1`, [frId]);
        if (fr.rows.length === 0) throw notFound('融资申请不存在');
        const frLoc = fr.rows[0] as Record<string, unknown>;
        await scopeByRow(kernel, frame, frLoc.tenant_id as string, frLoc.customer_id as string);
        requireHuman(ctx, 'fr.settle');
        requireDirectoryRole(ctx, ['business'], 'fr.settle');
        await lockCustomer(tx, frLoc.customer_id as string);
        await lockFacility(tx, frLoc.facility_id as string);
        const frRow = await lockFr(tx, frId); // A3.1：锁内新读
        const storedSettle = await ctx.replayed(tx);
        if (storedSettle !== null) return storedSettle;
        if (frRow.status !== 'disbursed') {
          throw conflict('NOT_READY', `申请当前 ${frRow.status}：仅 disbursed 可结算还款（重复回调由此拒绝）`);
        }
        const o = await lastEntryScope(tx, frId, 'disburse');
        const txId = uuid();
        await insertEntry(tx, {
          tenantId: frRow.tenant_id as string, customerId: frRow.customer_id as string, facilityId: frRow.facility_id as string,
          frId, entryType: 'settle', amountMinor: Number(frRow.amount_minor), currency: frRow.currency as string,
          scopeHash: o.request_scope, requestId: o.request_id, txId, actor: ctx.actor,
        });
        // P-02：非循环额度还款不恢复可用额（推导公式 lifetimeDisbursed 不因 settle 减少）
        await tx.query(`UPDATE financing_requests SET status='settled', version=version+1, updated_at=now() WHERE fr_id=$1`, [frId]);
        await h.audit({
          actor: ctx.actor, action: 'fr_settled', targetType: 'financing_request', targetId: frId,
          summary: `结算还款 ${Number(frRow.amount_minor)} 分`, payload: { txId },
        });
        await h.emit('LEDGER_ENTRY_APPENDED', frRow.customer_id as string, { entryType: 'settle', amountMinor: Number(frRow.amount_minor), facilityId: frRow.facility_id, txId });
        return { ok: true, frId, status: 'settled' };
      });
    },

    confirmExternal: (frame: RequestFrame, frId: string) => {
      return withCommandV2(kernel, frame, 'fr.confirm-external', frame.tenantId as string, async (tx, h, ctx) => {
        const fr = await tx.query(`SELECT * FROM financing_requests WHERE fr_id=$1`, [frId]);
        if (fr.rows.length === 0) throw notFound('融资申请不存在');
        const frLoc = fr.rows[0] as Record<string, unknown>;
        await scopeByRow(kernel, frame, frLoc.tenant_id as string, frLoc.customer_id as string);
        const outcome = frame.outcome;
        if (outcome !== 'confirmed' && outcome !== 'release_after_review') {
          throw invalid('outcome 必须 confirmed|release_after_review（unknown 不允许无人工复核的第三路径）');
        }
        const cfg = cfgRef();
        const perm = await requireMatrixPermission(tx, cfg, ctx, 'fr.confirm-external', Number(frLoc.amount_minor));
        await lockCustomer(tx, frLoc.customer_id as string);
        await lockFacility(tx, frLoc.facility_id as string);
        const frRow = await lockFr(tx, frId); // A3.1：锁内新读
        const storedConfirm = await ctx.replayed(tx);
        if (storedConfirm !== null) return storedConfirm;
        if (frRow.status !== 'disbursing_unknown') throw conflict('NOT_READY', `申请当前 ${frRow.status}：仅 disbursing_unknown 可对账确认`);
        const rationale = reqString(frame.rationale ?? '', 'rationale', 2000, 0);
        const txId = uuid();
        if (outcome === 'confirmed') {
          const o = await lastEntryScope(tx, frId, 'reserve_commit');
          await insertEntry(tx, {
            tenantId: frRow.tenant_id as string, customerId: frRow.customer_id as string, facilityId: frRow.facility_id as string,
            frId, entryType: 'disburse', amountMinor: Number(frRow.amount_minor), currency: frRow.currency as string,
            scopeHash: o.request_scope, requestId: o.request_id, txId, actor: ctx.actor,
          });
          await tx.query(
            `UPDATE financing_requests SET status='disbursed', external_state='confirmed', version=version+1, updated_at=now() WHERE fr_id=$1`, [frId],
          );
          const confirmDecisionId = newId('dec');
          await insertDecision(tx, {
            decisionId: confirmDecisionId, tenantId: frRow.tenant_id as string, actor: ctx.actor, roleRef: perm.role,
            permissionRef: perm.ref, action: 'fr.confirm-external', subjectType: 'financing_request', subjectId: frId,
            customerId: frRow.customer_id as string, ruleVersion: null, basisRef: null,
            rationale: `对账确认出账：${rationale}`, beforeVersion: Number(frRow.version), afterVersion: Number(frRow.version) + 1,
          });
          await h.emit('SETTLE_CONFIRMED', frRow.customer_id as string, { frId, txId, kind: 'reconcile_confirm' });
          await h.emit('FORMAL_DECISION_RECORDED', frRow.customer_id as string,
            { decisionId: confirmDecisionId, action: 'fr.confirm-external', subjectType: 'financing_request', subjectId: frId });
          await h.emit('LEDGER_ENTRY_APPENDED', frRow.customer_id as string, { entryType: 'disburse', amountMinor: Number(frRow.amount_minor), facilityId: frRow.facility_id, txId });
          return { ok: true, frId, status: 'disbursed' };
        }
        // release_after_review：人工复核后放弃该笔出账 → 释放被持有的承诺（唯一合法的 unknown 退出路径）
        const o = await lastEntryScope(tx, frId, 'reserve_commit');
        await insertEntry(tx, {
          tenantId: frRow.tenant_id as string, customerId: frRow.customer_id as string, facilityId: frRow.facility_id as string,
          frId, entryType: 'commit_cancel', amountMinor: Number(frRow.amount_minor), currency: frRow.currency as string,
          scopeHash: o.request_scope, requestId: o.request_id, txId, actor: ctx.actor,
        });
        await tx.query(
          `UPDATE financing_requests SET status='cancelled', external_state='none', version=version+1, updated_at=now() WHERE fr_id=$1`, [frId],
        );
        await insertDecision(tx, {
          decisionId: newId('dec'), tenantId: frRow.tenant_id as string, actor: ctx.actor, roleRef: perm.role,
          permissionRef: perm.ref, action: 'fr.confirm-external', subjectType: 'financing_request', subjectId: frId,
          customerId: frRow.customer_id as string, ruleVersion: null, basisRef: null,
          rationale: `对账复核后放弃出账并释放占用：${rationale}`, beforeVersion: Number(frRow.version), afterVersion: Number(frRow.version) + 1,
        });
        await h.emit('RESERVATION_RELEASED', frRow.customer_id as string, { frId, txId, via: 'reconcile_release' });
        return { ok: true, frId, status: 'cancelled' };
      });
    },

    getFinancingRequest: async (credential: unknown, frId: string) => {
      const fr = await kernel.pool.query(`SELECT * FROM financing_requests WHERE fr_id=$1`, [frId]);
      if (fr.rows.length === 0) throw notFound('融资申请不存在');
      const row = fr.rows[0] as Record<string, unknown>;
      // 任务03：单件读与清单读同权（内部专用；客户联系人身份 403——B13 口径，先按租户/grant 裁决 404 再拦角色）。
      await scopeByRow(kernel, { credential }, row.tenant_id as string, row.customer_id as string);
      await requireInternalRead(kernel, credential, '融资申请');
      return { ok: true, financingRequest: projectFr(row) };
    },

    /** 用信准备视图（3.4/3.5/B3）：纯读、无副作用；与 reserve 同一判据（服务端为准，非前端检查）。 */
    getUseReadiness: async (credential: unknown, frId: string) => {
      const fr = await kernel.pool.query(`SELECT * FROM financing_requests WHERE fr_id=$1`, [frId]);
      if (fr.rows.length === 0) throw notFound('融资申请不存在');
      const frRow = fr.rows[0] as Record<string, unknown>;
      await scopeByRow(kernel, { credential }, frRow.tenant_id as string, frRow.customer_id as string);
      const fac = await kernel.pool.query(`SELECT * FROM credit_facilities WHERE facility_id=$1`, [frRow.facility_id as string]);
      if (fac.rows.length === 0) throw notFound('额度设施不存在');
      const facilityRow = fac.rows[0] as Record<string, unknown>;
      const client = await kernel.pool.connect();
      try {
        const view = await facilityView(client, facilityRow, { expire: false });
        const blockers: { code: string; message: string }[] = view.staleBlockers.map((b) => ({
          code: b, message: `额度阻断：${b}`,
        }));
        // 依据包当前性/差异/Gate（与 reserve 提交点同一判据；不改任何状态）
        const pkgBasis = facilityRow.basis as { packageId?: string } | null;
        let basis: Record<string, unknown> | null = null;
        if (pkgBasis?.packageId) {
          const pk = await client.query(`SELECT package_id, revision, status FROM decision_packages WHERE package_id=$1`, [pkgBasis.packageId]);
          basis = pk.rows.length > 0
            ? { packageId: pkgBasis.packageId, revision: Number((pk.rows[0] as { revision: number }).revision), status: (pk.rows[0] as { status: string }).status }
            : null;
          const pkgBlockers = await packageActionBlockers(client, frRow.customer_id as string, pkgBasis.packageId, 'use_of_funds');
          for (const b of pkgBlockers) blockers.push({ code: b.code, message: b.message });
        }
        // 交易方式与合同/设备要件（D2：实质条件在交易层核验；缺要件不得输出"已可支付"）
        const equipmentRefCount = Array.isArray(frRow.equipment_refs) ? (frRow.equipment_refs as unknown[]).length : 0;
        const contractRefCount = Array.isArray(frRow.contract_refs) ? (frRow.contract_refs as unknown[]).length : 0;
        if (equipmentRefCount === 0 && contractRefCount === 0) {
          blockers.push({ code: 'TRANSACTION_TERMS_MISSING', message: '缺少租赁物/合同引用：缺正式交易条件时不得出账' });
        }
        const amount = Number(frRow.amount_minor);
        if (amount > view.availableForNewDrawMinor && !blockers.some((b) => b.code.startsWith('facility_status') || b.code === 'over_limit')) {
          blockers.push({ code: 'INSUFFICIENT_AVAILABLE_AMOUNT', message: `可用额不足：请求 ${amount} 分，可用 ${view.availableForNewDrawMinor} 分` });
        }
        const frStatus = String(frRow.status);
        const usableStatus = frStatus === 'submitted' || frStatus === 'reserved' || frStatus === 'committed';
        if (!usableStatus) blockers.push({ code: 'FR_STATE', message: `申请状态 ${frStatus} 不在可推进用信的状态` });
        const canProceed = blockers.length === 0;
        return {
          ok: true,
          frId, status: frStatus, externalState: frRow.external_state,
          productType: frRow.product_type, amountMinor: amount, currency: frRow.currency,
          facility: { facilityId: facilityRow.facility_id, status: facilityRow.status, approvedAmountMinor: Number(facilityRow.approved_amount_minor) },
          exposure: view,
          basis,
          transactionConditions: {
            productType: frRow.product_type, equipmentRefCount, contractRefCount,
            facilityConditions: facilityRow.conditions,
            paymentReady: canProceed && frStatus === 'committed',
          },
          canProceed,
          blockers,
        };
      } finally {
        client.release();
      }
    },

    getCustomerExposure: async (credential: unknown, customerId: string) => {
      const customer = await lookupCustomer(kernel, credential, customerId);
      const client = await kernel.pool.connect();
      try {
        const facilities = await client.query(`SELECT * FROM credit_facilities WHERE customer_id=$1 ORDER BY created_at`, [customerId]);
        const rows = facilities.rows as Record<string, unknown>[];
        // goal-01 P1：批量桶推导 + 批量依据状态（原 per-facility facilityView 是 O(N) 查询的 N+1）
        const ids = rows.map((f) => f.facility_id as string);
        const bucketSums = new Map<string, Record<string, number>>();
        const basisStaleByFacility = new Map<string, boolean>();
        if (ids.length > 0) {
          const bucketRows = await client.query(
            `SELECT facility_id, entry_type, SUM(amount_minor)::bigint AS total
             FROM exposure_entries WHERE facility_id = ANY($1) GROUP BY facility_id, entry_type`, [ids]);
          for (const r of bucketRows.rows as { facility_id: string; entry_type: string; total: string }[]) {
            const n = Number(r.total);
            // F12/K16 同口径：不安全整数显式失败，不静默舍入
            if (!Number.isSafeInteger(n)) {
              throw new AppError('INTERNAL', `账目聚合超出安全整数范围（facility ${r.facility_id}，${r.entry_type}）：拒绝推导，不静默舍入`);
            }
            const m = bucketSums.get(r.facility_id) ?? {};
            m[r.entry_type] = n;
            bucketSums.set(r.facility_id, m);
          }
          const basisIds = rows
            .map((f) => (f.basis as { assessmentId?: string } | null)?.assessmentId)
            .filter((x): x is string => typeof x === 'string');
          if (basisIds.length > 0) {
            const basisRows = await client.query(
              `SELECT assessment_id, stale, status FROM credit_assessments WHERE assessment_id = ANY($1)`, [basisIds]);
            const byId = new Map<string, { stale: boolean; status: string }>(
              (basisRows.rows as { assessment_id: string; stale: boolean; status: string }[]).map((r) => [r.assessment_id, { stale: r.stale, status: r.status }]),
            );
            for (const f of rows) {
              const aid = (f.basis as { assessmentId?: string } | null)?.assessmentId;
              basisStaleByFacility.set(f.facility_id as string, assessmentIsStale(typeof aid === 'string' ? byId.get(aid) : undefined));
            }
          }
        }
        const views: FacilityExposureView[] = rows.map((f) =>
          buildFacilityView(f, buildBucketView(f.facility_id as string, bucketSums.get(f.facility_id as string) ?? {}),
            basisStaleByFacility.get(f.facility_id as string) ?? false, { expire: false }));
        return {
          ok: true, customer: projectCustomer(customer),
          facilities: views.map((v, i) => ({ facilityId: (rows[i] as Record<string, unknown>).facility_id, ...v })),
          totalsMinor: {
            exposureNow: views.reduce((s, v) => s + v.exposureNowMinor, 0),
            outstanding: views.reduce((s, v) => s + v.outstandingMinor, 0),
            committed: views.reduce((s, v) => s + v.committedMinor, 0),
            reserved: views.reduce((s, v) => s + v.reservedMinor, 0),
          },
        };
      } finally {
        client.release();
      }
    },

    listCustomerEvents: async (credential: unknown, customerId: string, afterSeq: number, limit: number) => {
      await lookupCustomer(kernel, credential, customerId);
      // B13：客户角色（customer-only principal）不授予内部事件流——元数据/阈值也不经错误或列表泄漏
      const authEv = await authenticate(kernel.verifierForV2(), credential);
      requireVerified(authEv);
      if (authEv.principal.roles.every((r) => r === 'customer')) {
        throw forbidden('PERMISSION_DENIED', '无权访问该资源');
      }
      const res = await kernel.pool.query(
        `SELECT seq, event_id AS "eventId", at, event_type AS "eventType", customer_id AS "customerId", payload
         FROM outbox_events WHERE customer_id=$1 AND seq > $2 ORDER BY seq LIMIT $3`,
        [customerId, afterSeq, Math.min(Math.max(limit, 1), 500)],
      );
      return { ok: true, events: res.rows };
    },

    getV2Receipt: async (credential: unknown, requestId: string) => {
      const auth = await authenticate(kernel.verifierForV2(), credential);
      requireVerified(auth);
      // A10：回执按归属 principal 过滤；租户范围取目录声明（'all' 仅合成目录）
      const tenants = auth.principal.tenants;
      const res = tenants === 'all'
        ? await kernel.pool.query(
            `SELECT request_id AS "requestId", action, response, created_at FROM v2_idempotency
             WHERE request_id=$1 AND principal_id=$2`, [requestId, auth.principal.principalId])
        : await kernel.pool.query(
            `SELECT request_id AS "requestId", action, response, created_at FROM v2_idempotency
             WHERE request_id=$1 AND principal_id=$2 AND tenant_id = ANY($3)`, [requestId, auth.principal.principalId, tenants]);
      if (res.rows.length === 0) return { ok: true, found: false };
      return { ok: true, found: true, receipt: res.rows[0] };
    },

    /** A3.7/F10/K17：客户级提额（再评估）请求——在途唯一、次数窗口、实质新证据、next_eligible_at；
     *  客户级限制跨渠道/业务员不可绕行；重试经 requestId 幂等不重复计数；非法载荷零写入不扣次数。 */
    createLimitIncreaseRequest: (frame: V2Frame, customerId: string) => {
      const tenantId = reqString(frame.tenantId, 'tenantId', 64);
      return withCommandV2(kernel, frame, 'limit-increase.request', tenantId, async (tx, h, ctx) => {
        requireHuman(ctx, 'limit-increase.request');
        requireDirectoryRole(ctx, ['business', 'credit'], 'limit-increase.request');
        const customer = await lockCustomer(tx, customerId, tenantId);
        await requireCustomerScope(ctx, customerId, tx);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        void customer;
        const cfg = cfgRef();
        const amountMinor = reqPosInt(frame.requestedAmountMinor, 'requestedAmountMinor');
        const currency = reqCurrency(frame.currency);
        // 1) 冷却期内不受理向上申请（K18；既有合法用信与差异复核不受冷却影响）
        const cooling = await tx.query(
          `SELECT facility_id FROM credit_facilities WHERE customer_id=$1 AND cooling_until IS NOT NULL AND cooling_until > now() LIMIT 1`,
          [customerId],
        );
        if (cooling.rows.length > 0) {
          throw conflict('COOLING_ACTIVE', '提额冷却期内：向上申请不受理（既有合法用信不受影响）');
        }
        // 2) 在途唯一（客户级；跨业务员/渠道同一约束）
        const inflight = await tx.query(
          `SELECT request_id FROM credit_limit_requests WHERE customer_id=$1 AND status='open'`, [customerId]);
        if (inflight.rows.length > 0) {
          throw conflict('LIMIT_INCREASE_IN_FLIGHT', '已存在在途提额请求（客户级唯一）',
            { requestId: (inflight.rows[0] as { request_id: string }).request_id });
        }
        // 3) 再申请间隔与次数窗口
        const lastResolved = await tx.query(
          `SELECT next_eligible_at FROM credit_limit_requests
           WHERE customer_id=$1 AND status <> 'open' AND next_eligible_at IS NOT NULL
           ORDER BY resolved_at DESC LIMIT 1`, [customerId]);
        const ne = (lastResolved.rows[0] as { next_eligible_at: string | null } | undefined)?.next_eligible_at;
        if (ne !== null && ne !== undefined && new Date(ne).getTime() > Date.now()) {
          throw conflict('LIMIT_INCREASE_WINDOW', `再申请间隔未到（至 ${new Date(ne).toISOString()}）`,
            { nextEligibleAt: new Date(ne).toISOString() });
        }
        const windowDays = cfg.limitIncreaseWindowDays;
        const maxPerWindow = cfg.limitIncreaseMaxPerWindow;
        if (maxPerWindow !== null && windowDays !== null) {
          const inWindow = await tx.query(
            `SELECT created_at FROM credit_limit_requests
             WHERE customer_id=$1 AND created_at > now() - make_interval(days => $2::int)`, [customerId, windowDays]);
          if (inWindow.rows.length >= maxPerWindow) {
            const times = (inWindow.rows as { created_at: string }[]).map((r) => new Date(r.created_at).getTime()).sort((a, b) => a - b);
            const oldest = times[0];
            if (oldest === undefined) throw conflict('LIMIT_INCREASE_WINDOW', '提额次数窗口已用尽', {});
            const nextAt = new Date(oldest + windowDays * 86_400_000).toISOString();
            throw conflict('LIMIT_INCREASE_WINDOW', `提额次数窗口（${maxPerWindow} 次/${windowDays} 天）已用尽`, { nextEligibleAt: nextAt });
          }
        }
        // 4) 实质新证据：至少一件未在本客户任何历史提额请求中引用过的现行工件
        const evidenceRefs = Array.isArray(frame.evidenceRefs) ? frame.evidenceRefs : [];
        if (evidenceRefs.length === 0) throw invalid('evidenceRefs 必须是非空数组（提额请求须引用实质依据）');
        const priorUsed = await tx.query(`SELECT evidence_refs FROM credit_limit_requests WHERE customer_id=$1`, [customerId]);
        const used = new Set<string>();
        for (const row of priorUsed.rows as { evidence_refs: string[] }[]) {
          for (const e of row.evidence_refs ?? []) used.add(String(e));
        }
        // goal-01 P3：批量校验证据引用（一次 ANY 查询替代逐件查询；校验口径不变）
        const requestedIds: string[] = [];
        for (const ref of evidenceRefs) {
          requestedIds.push(reqString(typeof ref === 'string' ? ref : reqObject(ref, 'evidenceRefs[]').artifactId, 'evidenceRefs[]', 64));
        }
        const artRows = await tx.query(
          `SELECT artifact_id, customer_id, superseded_by, duplicate_of FROM evidence_artifacts WHERE artifact_id = ANY($1)`, [requestedIds]);
        const artById = new Map<string, Record<string, unknown>>(
          (artRows.rows as Record<string, unknown>[]).map((r) => [r.artifact_id as string, r]),
        );
        const normalizedRefs: string[] = [];
        let hasNew = false;
        for (const artifactId of requestedIds) {
          const a = artById.get(artifactId);
          if (a === undefined) throw notFound(`证据工件不存在：${artifactId}`);
          if (a.customer_id !== customerId) throw notFound('证据工件不属于该客户');
          if (a.superseded_by !== null || a.duplicate_of !== null) throw conflict('ARTIFACT_SUPERSEDED', `证据工件已失效：${artifactId}`);
          normalizedRefs.push(artifactId);
          if (!used.has(artifactId)) hasNew = true;
        }
        if (!hasNew) {
          throw conflict('LIMIT_INCREASE_NO_NEW_EVIDENCE', '无实质新证据：重试不得重复计数，须引用新证据');
        }
        const lirId = newId('lir');
        await tx.query(
          `INSERT INTO credit_limit_requests (request_id, tenant_id, customer_id, requested_amount_minor, currency, evidence_refs, requested_by)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
          [lirId, tenantId, customerId, amountMinor, currency, JSON.stringify(normalizedRefs), ctx.actor],
        );
        await h.audit({
          actor: ctx.actor, action: 'limit_increase_requested', targetType: 'credit_limit_request', targetId: lirId,
          summary: `提额请求 ${amountMinor} 分（证据 ${normalizedRefs.length} 件）`, payload: { amountMinor },
        });
        await h.emit('LIMIT_INCREASE_REQUESTED', customerId, { requestId: lirId, amountMinor, currency });
        return { ok: true, requestId: lirId, status: 'open' };
      });
    },

    /** A3.7/K17：提额请求处置（credit/approver 人类）；驳回按配置写 next_eligible_at。 */
    resolveLimitIncreaseRequest: (frame: V2Frame, requestId: string) => {
      const tenantId = reqString(frame.tenantId, 'tenantId', 64);
      return withCommandV2(kernel, frame, 'limit-increase.resolve', tenantId, async (tx, h, ctx) => {
        requireHuman(ctx, 'limit-increase.resolve');
        requireDirectoryRole(ctx, ['credit', 'approver'], 'limit-increase.resolve');
        const r0 = await tx.query(`SELECT * FROM credit_limit_requests WHERE request_id=$1 FOR UPDATE`, [requestId]);
        if (r0.rows.length === 0) throw notFound('提额请求不存在');
        const row = r0.rows[0] as Record<string, unknown>;
        if (row.tenant_id !== tenantId) throw notFound('提额请求不存在');
        await requireCustomerScope(ctx, row.customer_id as string, tx);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        if (row.status !== 'open') throw conflict('NOT_READY', `提额请求当前 ${row.status}：仅 open 可处置`);
        const outcome = reqString(frame.outcome, 'outcome', 16);
        if (!['approved', 'rejected', 'withdrawn'].includes(outcome)) {
          throw invalid('outcome 必须 approved|rejected|withdrawn');
        }
        const note = reqString(frame.note ?? '', 'note', 2000, 0);
        const retryHours = cfgRef().limitIncreaseRetryHours;
        const nextEligible = outcome === 'rejected' && retryHours !== null
          ? new Date(Date.now() + retryHours * 3_600_000)
          : null;
        await tx.query(
          `UPDATE credit_limit_requests SET status=$2, resolved_at=now(), resolved_by=$3, resolution_note=$4, next_eligible_at=$5
           WHERE request_id=$1`,
          [requestId, outcome, ctx.actor, note, nextEligible],
        );
        await h.audit({
          actor: ctx.actor, action: 'limit_increase_resolved', targetType: 'credit_limit_request', targetId: requestId,
          summary: `提额请求处置 ${outcome}${note ? `：${note}` : ''}`, payload: { outcome },
        });
        await h.emit('LIMIT_INCREASE_RESOLVED', row.customer_id as string,
          { requestId, status: outcome, nextEligibleAt: nextEligible === null ? null : nextEligible.toISOString() });
        return {
          ok: true, requestId, status: outcome,
          nextEligibleAt: nextEligible === null ? null : nextEligible.toISOString(),
        };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

/** A3.4/K14/K15：用信提交点机械复查。次序：客户级未决差异（REVIEW_REQUIRED 先行，复核不等待冷却）
 *  → 依据包当前性/Gate（commit 及 reserve；disburse 为已承诺义务的执行，不再重复当前性门）。
 *  冷却不在其列：只影响向上申请/发布（K18），不冻结既有合法用信。
 *  goal-01 P2：调用方已持有同事务内 facilityView 时经 viewOverride 复用，避免重复聚合（省 2 查询/命令）。 */
async function assertFrUseGates(
  tx: PoolClient, cfg: Config, facilityRow: Record<string, unknown>, frRow: Record<string, unknown>,
  action: 'reserve' | 'commit' | 'disburse', viewOverride?: FacilityExposureView,
): Promise<FacilityExposureView> {
  // 设施硬状态（冷却不在其列）：暂停/过期/超限/依据失效 → 无新用信动作
  const view = viewOverride ?? await facilityView(tx, facilityRow, { expire: true });
  const hard = view.staleBlockers.filter((b) => b !== 'cooling_active');
  if (hard.length > 0) {
    throw conflict(
      hard.some((b) => b.startsWith('facility_status')) ? 'FACILITY_NOT_ACTIVE'
        : hard.includes('stale_basis') ? 'STALE_BASIS' : 'FACILITY_NOT_ACTIVE',
      `额度不可用：${hard.join(', ')}`, { blockers: hard });
  }
  await assertNoBlockingFindings(tx, frRow.customer_id as string, 'use_of_funds');
  const basis = facilityRow.basis as { packageId?: string } | null;
  if (action === 'disburse') return view; // 已承诺敞口的执行：不回写历史决定，也不以当前性追溯冻结（K14c）
  if (basis?.packageId) {
    await checkPackageForAction(tx, frRow.customer_id as string, basis.packageId, 'use_of_funds');
  } else if (!cfg.allowLegacyBasis) {
    throw conflict('BASIS_PACKAGE_REQUIRED',
      '存量依据未绑定依据包：用信正式动作阻断（兼容核需显式 --allow-legacy-basis；旧数据只读保留）');
  }
  return view;
}

/** 集中度（P-03）：政策版本未配置 → POLICY_PENDING；有关联组且配置组上限 → 合计校验。 */
async function requireConcentrationOk(tx: PoolClient, cfg: Config, facilityRow: Record<string, unknown>): Promise<void> {
  if (cfg.concentrationPolicyVersion === null) {
    throw conflict('POLICY_PENDING', '集中度政策未配置：批准拒绝（不因未达产品上限默认可放；P-03）');
  }
  if (cfg.groupCapMinor === null) return; // 政策版本存在但未设组上限 → 组约束不适用
  const customerId = facilityRow.customer_id as string;
  const facilityId = facilityRow.facility_id as string;
  const group = await tx.query(
    `SELECT DISTINCT LEAST(r.from_customer_id, r.to_customer_id) AS a, GREATEST(r.from_customer_id, r.to_customer_id) AS b
     FROM customer_relationships r
     WHERE r.type='related_group' AND (r.from_customer_id=$1 OR r.to_customer_id=$1)`, [customerId],
  );
  if (group.rows.length === 0) return; // 无关联组：组集中度不适用
  const memberIds = new Set<string>();
  for (const g of group.rows as { a: string; b: string }[]) { memberIds.add(g.a); memberIds.add(g.b); }
  // 排除当前设施自身：提案行已在表内，否则双重计入
  const totals = await tx.query(
    `SELECT COALESCE(SUM(approved_amount_minor),0)::bigint AS total FROM credit_facilities
     WHERE status IN ('proposed','approved_inactive','active','suspended') AND customer_id = ANY($1) AND facility_id <> $2`,
    [[...memberIds], facilityId],
  );
  const total = Number((totals.rows[0] as { total: string }).total) + Number(facilityRow.approved_amount_minor);
  if (total > cfg.groupCapMinor) {
    throw conflict('CONCENTRATION_BLOCKED', `关联组合计 ${total} 分超组上限 ${cfg.groupCapMinor} 分`, { groupTotalMinor: total, groupCapMinor: cfg.groupCapMinor });
  }
}

/** A15：批准/激活事务内复查依据——评估仍待审、未 stale、快照哈希一致、快照工件仍现行。 */
async function reverifyBasis(tx: PoolClient, facilityRow: Record<string, unknown>): Promise<void> {
  const basis = facilityRow.basis as { assessmentId?: string; snapshotHash?: string } | null;
  if (!basis?.assessmentId) throw conflict('STALE_BASIS', '额度缺少可复查依据');
  const a = await tx.query(`SELECT status, stale, snapshot_hash FROM credit_assessments WHERE assessment_id=$1 FOR UPDATE`, [basis.assessmentId]);
  if (a.rows.length === 0) throw conflict('STALE_BASIS', '依据评估不存在');
  const ar = a.rows[0] as { status: string; stale: boolean; snapshot_hash: string };
  if (ar.status !== 'awaiting_human_review' || ar.stale) {
    throw conflict('STALE_BASIS', `依据评估状态 ${ar.status}${ar.stale ? '（stale）' : ''}：须重新评估后再批准`);
  }
  if (ar.snapshot_hash !== basis.snapshotHash) {
    // legacy 导入行（--allow-legacy-basis）的 basis 不携带快照哈希：按评估状态+工件现行复查，不做哈希比对
    if (!(basis.snapshotHash === undefined || basis.snapshotHash === null)) {
      throw conflict('STALE_BASIS', '依据快照哈希已变化：须重新评估');
    }
  }
  const snap = await tx.query(`SELECT evidence_snapshot FROM credit_assessments WHERE assessment_id=$1`, [basis.assessmentId]);
  const snapshot = (snap.rows[0] as { evidence_snapshot: { artifactId: string }[] }).evidence_snapshot ?? [];
  // goal-01 P3：快照工件批量取共享锁（一次 ANY 查询替代逐件循环；锁语义不变，封闭 A15 竞态）
  const ids = snapshot.map((ref) => ref.artifactId);
  const found = new Map<string, { superseded_by: string | null; duplicate_of: string | null }>();
  if (ids.length > 0) {
    const arts = await tx.query(
      `SELECT artifact_id, superseded_by, duplicate_of FROM evidence_artifacts WHERE artifact_id = ANY($1) FOR SHARE`, [ids]);
    for (const r of arts.rows as { artifact_id: string; superseded_by: string | null; duplicate_of: string | null }[]) {
      found.set(r.artifact_id, r);
    }
  }
  for (const ref of snapshot) {
    const row = found.get(ref.artifactId);
    if (row === undefined) throw conflict('STALE_BASIS', `快照工件缺失：${ref.artifactId}`);
    if (row.superseded_by !== null || row.duplicate_of !== null) {
      throw conflict('STALE_BASIS', `快照工件已失效：${ref.artifactId}`, { artifactId: ref.artifactId });
    }
  }
}

async function insertEntry(tx: PoolClient, e: {
  tenantId: string; customerId: string; facilityId: string; frId: string; entryType: string;
  amountMinor: number; currency: string; scopeHash: string; requestId: string; txId: string; actor: string;
}): Promise<void> {
  await tx.query(
    `INSERT INTO exposure_entries (entry_id, tenant_id, customer_id, facility_id, fr_id, entry_type, amount_minor, currency, request_scope, request_id, tx_id, actor)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [newId('le'), e.tenantId, e.customerId, e.facilityId, e.frId, e.entryType, e.amountMinor, e.currency, e.scopeHash, e.requestId, e.txId, e.actor],
  );
}

async function lastEntryScope(tx: PoolClient, frId: string, entryType: string): Promise<{ request_scope: string; request_id: string }> {
  const res = await tx.query(
    `SELECT request_scope, request_id FROM exposure_entries WHERE fr_id=$1 AND entry_type=$2 ORDER BY seq DESC LIMIT 1`,
    [frId, entryType],
  );
  if (res.rows.length === 0) throw conflict('NOT_READY', `缺少 ${entryType} 账目（状态与账目不一致）`);
  return res.rows[0] as { request_scope: string; request_id: string };
}

function projectCustomer(row: Record<string, unknown>): Record<string, unknown> {
  return {
    customerId: row.customer_id, tenantId: row.tenant_id, legalEntityRef: row.legal_entity_ref,
    displayName: row.display_name, status: row.status, version: Number(row.version),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function projectFacility(row: Record<string, unknown>): Record<string, unknown> {
  return {
    facilityId: row.facility_id, customerId: row.customer_id, tenantId: row.tenant_id,
    approvedAmountMinor: Number(row.approved_amount_minor), currency: row.currency,
    effectiveFrom: row.effective_from, effectiveTo: row.effective_to, revolving: row.revolving,
    reserveTtlSeconds: row.reserve_ttl_seconds, productScope: row.product_scope, conditions: row.conditions,
    approvalChain: row.approval_chain, basis: row.basis, status: row.status, version: Number(row.version),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/** v2.6 §12：首次回租需求（客户表述；严格 Schema；本轮产品恒 sale_leaseback）。 */
function parseAdmissionRequest(v: unknown): Record<string, unknown> {
  const r = reqObject(v, 'request');
  const productType = reqString(r.productType, 'request.productType', 32);
  if (productType !== 'sale_leaseback') throw invalid('request.productType 本轮仅支持 sale_leaseback（首次回租准入）');
  const amount = r.requestedAmountMinor === undefined || r.requestedAmountMinor === null ? null : reqPosInt(r.requestedAmountMinor, 'request.requestedAmountMinor');
  const currency = r.currency === undefined || r.currency === null ? 'CNY' : reqCurrency(r.currency, 'request.currency');
  const term = r.requestedTermMonths === undefined || r.requestedTermMonths === null ? null : reqPosInt(r.requestedTermMonths, 'request.requestedTermMonths', 240);
  const purpose = r.purpose === undefined || r.purpose === null ? null : reqString(r.purpose, 'request.purpose', 200);
  const equipmentScope: string[] = [];
  if (r.equipmentScope !== undefined && r.equipmentScope !== null) {
    if (!Array.isArray(r.equipmentScope)) throw invalid('request.equipmentScope 必须是数组');
    if (r.equipmentScope.length > 50) throw invalid('request.equipmentScope 最多 50 项');
    for (const e of r.equipmentScope) equipmentScope.push(reqString(e, 'request.equipmentScope[]', 128));
  }
  const note = r.note === undefined || r.note === null ? null : reqString(r.note, 'request.note', 500);
  const unknown = Object.keys(r).filter((k) => !['productType', 'requestedAmountMinor', 'currency', 'requestedTermMonths', 'purpose', 'equipmentScope', 'note'].includes(k));
  if (unknown.length > 0) throw invalid(`request 含未声明字段：${unknown.join(', ')}（严格 Schema）`);
  return { productType, requestedAmountMinor: amount, currency, requestedTermMonths: term, purpose, equipmentScope, note };
}

/** v2.6 §12：需求读回投影（getAssessment 用原始行；清单用别名行）。 */
function projectAdmissionRequest(r: Record<string, unknown>, revision: unknown): Record<string, unknown> | null {
  const raw = r.admission_request ?? r.a_req;
  if (raw === null || raw === undefined) return null;
  const q = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
  return {
    productType: q.productType, requestedAmountMinor: q.requestedAmountMinor ?? null, currency: q.currency ?? 'CNY',
    requestedTermMonths: q.requestedTermMonths ?? null, purpose: q.purpose ?? null, equipmentScope: q.equipmentScope ?? [],
    note: q.note ?? null,
    revision: Number(revision ?? 0), declaredBy: q.declaredBy ?? null, declaredAt: q.declaredAt ?? null, updatedAt: q.updatedAt ?? null,
  };
}

function projectFr(row: Record<string, unknown>): Record<string, unknown> {
  return {
    frId: row.fr_id, customerId: row.customer_id, facilityId: row.facility_id, tenantId: row.tenant_id,
    productType: row.product_type, amountMinor: Number(row.amount_minor), currency: row.currency,
    equipmentRefs: row.equipment_refs, contractRefs: row.contract_refs, status: row.status,
    externalState: row.external_state, reservedUntil: row.reserved_until, version: Number(row.version),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/** v2.6：候选修订历史投影（assessment_candidates 行 → camelCase）。 */
function projectCandidate(r: Record<string, unknown>): Record<string, unknown> {
  return {
    revision: Number(r.revision),
    tendency: r.tendency,
    suggestedAmountMinor: r.suggested_amount_minor === null || r.suggested_amount_minor === undefined ? null : Number(r.suggested_amount_minor),
    currency: r.currency,
    suggestedTermMonths: r.suggested_term_months === null || r.suggested_term_months === undefined ? null : Number(r.suggested_term_months),
    referencePriceMinor: r.reference_price_minor === null || r.reference_price_minor === undefined ? null : Number(r.reference_price_minor),
    priceUnit: r.price_unit, priceBasis: r.price_basis,
    conditions: r.conditions, rationale: r.rationale, producedBy: r.produced_by, warnings: r.warnings,
    basisRefs: r.basis_refs, runRefs: r.run_refs, changeReason: r.change_reason,
    ruleVersion: r.rule_version, inputVersion: Number(r.input_version ?? 0),
    producedAt: r.produced_at,
    isCurrent: r.is_current === true,
  };
}

/** v2.6：预评估确认投影（preassessment_confirmations 行；getAssessment 用原始行，清单用别名行）。 */
function projectPreassessment(r: Record<string, unknown>): Record<string, unknown> {
  return {
    confirmationId: r.confirmation_id ?? r.pc_id,
    outcome: r.outcome ?? r.pc_outcome,
    scope: r.scope ?? r.pc_scope ?? 'preassessment_only',
    conditions: r.conditions ?? r.pc_conditions,
    rationale: r.rationale ?? r.pc_rationale,
    confirmedBy: r.confirmed_by ?? r.pc_by,
    confirmedAt: r.confirmed_at ?? r.pc_at,
    assessmentVersion: r.assessment_version !== undefined ? Number(r.assessment_version) : (r.pc_ass_ver === null || r.pc_ass_ver === undefined ? null : Number(r.pc_ass_ver)),
    candidateRevision: r.candidate_revision !== undefined
      ? (r.candidate_revision === null ? null : Number(r.candidate_revision))
      : (r.pc_cand_rev === null || r.pc_cand_rev === undefined ? null : Number(r.pc_cand_rev)),
    inputVersion: Number(r.input_version ?? r.pc_input_ver ?? 0),
    snapshotHash: r.snapshot_hash ?? r.pc_snapshot,
    ruleVersion: r.rule_version ?? r.pc_rule,
    needsReview: r.needs_review ?? r.pc_needs_review ?? false,
    reviewReason: r.review_reason ?? r.pc_review_reason ?? null,
    reviewMarkedAt: r.review_marked_at ?? r.pc_review_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// 任务03 IR-03-A ②：权威清单公共件（键集分页 + 内部读权限）。
// 游标仅基于业务 id（全局唯一、前缀含毫秒时间戳）；created_at 微秒精度经 JS 毫秒编码有截断，
// 禁止用作游标键（口径同 §11 客户目录）。重启/长历史/撤权后同一游标语义不变。
// ---------------------------------------------------------------------------

function encodeListCursor(id: string): string {
  return Buffer.from(JSON.stringify({ id }), 'utf8').toString('base64url');
}

function decodeListCursor(cursor: unknown): string {
  if (typeof cursor !== 'string' || cursor.length === 0) throw invalid('cursor 无效');
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { id?: unknown };
    if (typeof parsed.id !== 'string' || parsed.id.length === 0) throw new Error('bad');
    return parsed.id;
  } catch {
    throw invalid('cursor 无效');
  }
}

/** 内部读权限（B13 口径，some 语义）：客户联系人身份对 v2 信用域内部读一律 403 PERMISSION_DENIED；
 *  匿名/未验证由 authenticate+requireVerified 拒绝。越权（非本租户/grant）已在 scopeByRow/lookupCustomer 统一 404。 */
async function requireInternalRead(kernel: Kernel, credential: unknown, what: string): Promise<void> {
  const auth = await authenticate(kernel.verifierForV2(), credential);
  requireVerified(auth);
  if (auth.principal.roles.some((r) => r === 'customer')) {
    throw forbidden('PERMISSION_DENIED', `${what}仅限内部身份访问`);
  }
}

/** A3.1/K12：加锁后重读申请行——首次读仅用于定位/授权；业务合法性判断一律用客户锁内新读
 *  （Read Committed 下，加锁前缓存的状态不得用于门判断）。 */
async function lockFr(tx: PoolClient, frId: string): Promise<Record<string, unknown>> {
  const res = await tx.query(`SELECT * FROM financing_requests WHERE fr_id=$1 FOR UPDATE`, [frId]);
  if (res.rows.length === 0) throw notFound('融资申请不存在');
  return res.rows[0] as Record<string, unknown>;
}

async function lockFacility(tx: PoolClient, facilityId: string): Promise<Record<string, unknown>> {
  const res = await tx.query(`SELECT * FROM credit_facilities WHERE facility_id=$1 FOR UPDATE`, [facilityId]);
  if (res.rows.length === 0) throw notFound('额度设施不存在');
  return res.rows[0] as Record<string, unknown>;
}
