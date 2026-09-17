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

/** 惰性到期 + 状态裁决 + 可用额推导。写路径传 expire:true（须持锁）。 */
export async function facilityView(tx: PoolClient, facilityRow: Record<string, unknown>, opts: { expire?: boolean; helpers?: V2Helpers; customerId?: string }): Promise<FacilityExposureView> {
  const facilityId = facilityRow.facility_id as string;
  if (opts.expire && opts.helpers && opts.customerId) {
    await lazyExpire(tx, facilityId, facilityRow.currency as string, opts.customerId, opts.helpers);
  }
  let status = facilityRow.status as string;
  const effectiveTo = facilityRow.effective_to as string | null;
  if (status === 'active' && effectiveTo !== null && new Date(`${effectiveTo}T23:59:59Z`).getTime() < Date.now()) {
    if (opts.expire) {
      await tx.query(`UPDATE credit_facilities SET status='expired', version=version+1, updated_at=now() WHERE facility_id=$1 AND status='active'`, [facilityId]);
    }
    status = 'expired';
  }
  const buckets = await computeBuckets(tx, facilityId);
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
  const basis = facilityRow.basis as { assessmentId?: string } | null;
  if (basis?.assessmentId) {
    const a = await tx.query(`SELECT stale, status FROM credit_assessments WHERE assessment_id=$1`, [basis.assessmentId]);
    const row = a.rows[0] as { stale: boolean; status: string } | undefined;
    if (row && (row.stale || row.status === 'stale' || row.status === 'superseded' || row.status === 'rejected')) {
      blockers.push('stale_basis');
    }
  }
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
  createAssessment(frame: V2Frame, customerId: string): Promise<Record<string, unknown>>;
  submitCandidate(frame: V2Frame, assessmentId: string): Promise<Record<string, unknown>>;
  submitForReview(frame: V2Frame, assessmentId: string): Promise<Record<string, unknown>>;
  decideAssessment(frame: V2Frame, assessmentId: string): Promise<Record<string, unknown>>;
  getAssessment(credential: unknown, assessmentId: string): Promise<Record<string, unknown>>;
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
          // 任务02：依据实质修订 → 通知消费方（评估/依据包须按新证据复核；B08 阻断新用信）
          await h.emit('ASSESSMENT_BASIS_REVISED', customerId, {
            reason: 'artifact_superseded', superseded: supersedes, newArtifactId: artifactId,
          });
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
      if (authArt.principal.roles.every((r) => r === 'customer')) {
        throw forbidden('PERMISSION_DENIED', '无权访问该资源');
      }
      const res = await kernel.pool.query(
        `SELECT a.artifact_id, a.kind, a.fact_key, a.sha256, a.supersedes, a.superseded_by, a.duplicate_of, a.created_at,
                a.provenance, a.object_ref, a.material_meta, f.value, f.grade
         FROM evidence_artifacts a LEFT JOIN fact_assertions f ON f.artifact_id = a.artifact_id
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
        })),
        factConflicts: (conflictRes.rows as Record<string, unknown>[]).map((r) => ({ factKey: r.fact_key, assertionCount: Number(r.n) })),
        independentProofs,
        derivationGaps,
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
          `INSERT INTO credit_assessments (assessment_id, tenant_id, customer_id, status, evidence_snapshot, snapshot_hash, rule_version, created_by)
           VALUES ($1,$2,$3,'collecting',$4::jsonb,$5,$6,$7)`,
          [assessmentId, tenantId, customerId, JSON.stringify(snapshot), snapshotHash, ruleVersion, ctx.actor],
        );
        await h.audit({
          actor: ctx.actor, action: 'assessment_created', targetType: 'assessment', targetId: assessmentId,
          summary: `授信评估创建（快照 ${snapshot.length} 件，规则 ${ruleVersion}）`, payload: { snapshotHash },
        });
        await h.emit('ASSESSMENT_CREATED', customerId, { assessmentId, snapshotHash, ruleVersion });
        return { ok: true, assessmentId, snapshotHash, snapshotCount: snapshot.length };
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
        const unknownKeys = Object.keys(cand).filter((k) => !['tendency', 'supportableAmountMinor', 'currency', 'conditions', 'rationale', 'producedBy', 'warnings'].includes(k));
        if (unknownKeys.length > 0) throw invalid(`candidate 含未声明字段：${unknownKeys.join(', ')}（严格 Schema）`);
        if (row.stale === true) throw conflict('STALE_BASIS', '评估依据已失效：请重建快照后重评');
        if (row.status !== 'collecting' && row.status !== 'draft') {
          throw conflict('NOT_READY', `评估当前 ${row.status}：仅 collecting 可提交候选`);
        }
        const stored = {
          authority: 'none' as const, tendency,
          supportableAmountMinor: amount, currency, conditions, rationale, producedBy, warnings,
        };
        await tx.query(
          `UPDATE credit_assessments SET candidate=$2::jsonb, status='candidate_ready', version=version+1, updated_at=now()
           WHERE assessment_id=$1`,
          [assessmentId, JSON.stringify(stored)],
        );
        await h.audit({
          actor: ctx.actor, action: 'assessment_candidate', targetType: 'assessment', targetId: assessmentId,
          summary: `候选产出（${producedBy}；authority=none；不改变正式状态）`, payload: { tendency },
        });
        await h.emit('ASSESSMENT_CANDIDATE_READY', row.customer_id as string, { assessmentId, producedBy });
        return { ok: true, status: 'candidate_ready', candidate: stored };
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

    getAssessment: async (credential: unknown, assessmentId: string) => {
      const res = await kernel.pool.query(`SELECT * FROM credit_assessments WHERE assessment_id=$1`, [assessmentId]);
      if (res.rows.length === 0) throw notFound('评估不存在');
      const row = res.rows[0] as Record<string, unknown>;
      await scopeByRow(kernel, { credential }, row.tenant_id as string, row.customer_id as string);
      return {
        ok: true,
        assessment: {
          assessmentId, customerId: row.customer_id, status: row.status, stale: row.stale,
          staleReasons: row.stale_reasons, evidenceSnapshot: row.evidence_snapshot, snapshotHash: row.snapshot_hash,
          ruleVersion: row.rule_version, candidate: row.candidate, version: Number(row.version),
          createdAt: row.created_at, updatedAt: row.updated_at,
        },
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
        // A3.4：预占提交点复查——未决差异先行（REVIEW_REQUIRED），再按依据包/兼容核拦截
        await assertFrUseGates(tx, cfgRef(), facilityRow, frRow, 'reserve');
        const txId = uuid();
        const ttl = facilityRow.reserve_ttl_seconds as number | null;
        const after0 = await computeBuckets(tx, frRow.facility_id as string);
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
        await h.emit('RESERVATION_PLACED', frRow.customer_id as string, { frId, facilityId: frRow.facility_id, amountMinor: amount, txId });
        await h.emit('LEDGER_ENTRY_APPENDED', frRow.customer_id as string, { entryType: 'reserve', amountMinor: amount, facilityId: frRow.facility_id, txId });
        await h.emit('USE_READINESS_CHANGED', frRow.customer_id as string,
          { frId, status: 'reserved', amountMinor: amount, exposure: { ...after0, approvedAmountMinor: Number(facilityRow.approved_amount_minor) } });
        const after = await computeBuckets(tx, frRow.facility_id as string);
        return { ok: true, frId, status: 'reserved', exposure: { ...after, approvedAmountMinor: Number(facilityRow.approved_amount_minor) } };
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
      await scopeByRow(kernel, { credential }, row.tenant_id as string, row.customer_id as string);
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
        const views: FacilityExposureView[] = [];
        for (const f of facilities.rows as Record<string, unknown>[]) {
          views.push(await facilityView(client, f, { expire: false }));
        }
        return {
          ok: true, customer: projectCustomer(customer),
          facilities: views.map((v, i) => ({ facilityId: (facilities.rows[i] as Record<string, unknown>).facility_id, ...v })),
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
        const normalizedRefs: string[] = [];
        let hasNew = false;
        for (const ref of evidenceRefs) {
          const artifactId = reqString(typeof ref === 'string' ? ref : reqObject(ref, 'evidenceRefs[]').artifactId, 'evidenceRefs[]', 64);
          const art = await tx.query(
            `SELECT customer_id, superseded_by, duplicate_of FROM evidence_artifacts WHERE artifact_id=$1`, [artifactId]);
          if (art.rows.length === 0) throw notFound(`证据工件不存在：${artifactId}`);
          const a = art.rows[0] as Record<string, unknown>;
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
 *  冷却不在其列：只影响向上申请/发布（K18），不冻结既有合法用信。 */
async function assertFrUseGates(
  tx: PoolClient, cfg: Config, facilityRow: Record<string, unknown>, frRow: Record<string, unknown>,
  action: 'reserve' | 'commit' | 'disburse',
): Promise<void> {
  // 设施硬状态（冷却不在其列）：暂停/过期/超限/依据失效 → 无新用信动作
  const view = await facilityView(tx, facilityRow, { expire: true });
  const hard = view.staleBlockers.filter((b) => b !== 'cooling_active');
  if (hard.length > 0) {
    throw conflict(
      hard.some((b) => b.startsWith('facility_status')) ? 'FACILITY_NOT_ACTIVE'
        : hard.includes('stale_basis') ? 'STALE_BASIS' : 'FACILITY_NOT_ACTIVE',
      `额度不可用：${hard.join(', ')}`, { blockers: hard });
  }
  await assertNoBlockingFindings(tx, frRow.customer_id as string, 'use_of_funds');
  const basis = facilityRow.basis as { packageId?: string } | null;
  if (action === 'disburse') return; // 已承诺敞口的执行：不回写历史决定，也不以当前性追溯冻结（K14c）
  if (basis?.packageId) {
    await checkPackageForAction(tx, frRow.customer_id as string, basis.packageId, 'use_of_funds');
  } else if (!cfg.allowLegacyBasis) {
    throw conflict('BASIS_PACKAGE_REQUIRED',
      '存量依据未绑定依据包：用信正式动作阻断（兼容核需显式 --allow-legacy-basis；旧数据只读保留）');
  }
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
  for (const ref of snapshot) {
    // FOR SHARE：与 supersede 的 FOR UPDATE 互斥——任一方先提交，另一方即见最新事实（A15 竞态封闭）
    const art = await tx.query(`SELECT superseded_by, duplicate_of FROM evidence_artifacts WHERE artifact_id=$1 FOR SHARE`, [ref.artifactId]);
    if (art.rows.length === 0) throw conflict('STALE_BASIS', `快照工件缺失：${ref.artifactId}`);
    const row = art.rows[0] as { superseded_by: string | null; duplicate_of: string | null };
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

function projectFr(row: Record<string, unknown>): Record<string, unknown> {
  return {
    frId: row.fr_id, customerId: row.customer_id, facilityId: row.facility_id, tenantId: row.tenant_id,
    productType: row.product_type, amountMinor: Number(row.amount_minor), currency: row.currency,
    equipmentRefs: row.equipment_refs, contractRefs: row.contract_refs, status: row.status,
    externalState: row.external_state, reservedUntil: row.reserved_until, version: Number(row.version),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
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
