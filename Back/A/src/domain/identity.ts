// v2.4（goal-01 四任务产品交付轮）：受限邀请 / 客户联系人身份 / 客户目录 / 材料处理状态权威投影。
// 冻结契约：docs/product-delivery/goal-01/DESIGN.md 与 Back/CONTRACT.md §11。
// 纪律：邀请码/客户凭据仅存 sha256，明文只在创建/兑换响应出现一次；
// 客户联系人身份只能拿到单客户 grant，目录与内部读口对其关闭；
// 材料处理状态只收 kind=service 回执（runRef 内阶段严格递增，新 runRef=新尝试），不承载金额/授信语义。
import type { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { AppError, conflict, forbidden, invalid, notFound } from './errors.ts';
import { authenticate, requireVerified, type PrincipalVerifier } from './principal.ts';
import type { Principal } from '../config.ts';
import {
  lockCustomer, reqString, requireCustomerScope, requireDirectoryRole, requireHuman,
  scopeByRow, v2Helpers, withCommandV2, type RequestFrame,
} from './v2kit.ts';
import { newId, sha256 } from './util.ts';
import type { Kernel } from './kernel.ts';

const CUSTOMER_ROLES = ['customer-owner', 'customer-finance', 'customer-plant'] as const;
const STAGE_RANK: Record<string, number> = { received: 1, parsed: 2, analyzed: 3, needs_review: 4, failed: 4 };

/** 客户联系人身份（customer_identities）：目录分离后的第一批 DB 侧动态身份。
 *  projects=[] → 不获得任何 v1 项目授权；customers='grant' → 授权走 principal_customer_grants（撤权即刻生效）。
 *  §11.1（DEF-G04N-04 A 侧）：customer_identities 未命中再查 service_identities（交付运行时的
 *  kind=service 可认证主体）→ Principal {kind:'service', roles:['service'], tenants:[绑定租户], customers:'all'}；
 *  既有 service 三口（Gate 回执/分析运行/处理状态）门语义不变，此处只提供可认证主体。 */
export function chainCustomerIdentityVerifier(base: PrincipalVerifier | null, pool: Pool): PrincipalVerifier {
  return async (credential: string): Promise<Principal | null> => {
    if (base) {
      const viaBase = await base(credential);
      if (viaBase) return viaBase;
    }
    const res = await pool.query(
      `SELECT principal_id, tenant_id, customer_id, role FROM customer_identities
       WHERE credential_sha256=$1 AND status='active' LIMIT 1`, [sha256(credential)]);
    if (res.rows.length > 0) {
      const r = res.rows[0] as Record<string, string | undefined>;
      const principalId = r.principal_id;
      const tenantId = r.tenant_id;
      const customerId = r.customer_id;
      const role = r.role;
      if (!principalId || !tenantId || !customerId || !role) return null;
      // roles 只授 'customer'：受邀角色保存在 customer_identities（DB），不进 Principal.roles——
      // 否则会绕开"纯客户角色"边界检查（如 B13 证据清单），也不产生任何内部角色授权。
      return {
        principalId, kind: 'human', roles: ['customer'],
        projects: [], tenants: [tenantId], customers: 'grant', displayName: '',
      };
    }
    const svc = await pool.query(
      `SELECT principal_id, tenant_id, display_name FROM service_identities
       WHERE credential_sha256=$1 AND status='active' LIMIT 1`, [sha256(credential)]);
    if (svc.rows.length === 0) return null;
    const s = svc.rows[0] as Record<string, string | undefined>;
    if (!s.principal_id || !s.tenant_id) return null;
    return {
      principalId: s.principal_id, kind: 'service', roles: ['service'],
      projects: [], tenants: [s.tenant_id], customers: 'all', displayName: s.display_name ?? '',
    };
  };
}

export interface IdentityApi {
  listCustomersDirectory(credential: unknown, opts: { search?: string | null; limit?: unknown; cursor?: string | null }): Promise<Record<string, unknown>>;
  createInvitation(frame: RequestFrame, customerId: string): Promise<Record<string, unknown>>;
  listInvitations(credential: unknown, customerId: string): Promise<Record<string, unknown>>;
  revokeInvitation(frame: RequestFrame, invitationId: string): Promise<Record<string, unknown>>;
  redeemInvitation(frame: RequestFrame): Promise<Record<string, unknown>>;
  recordArtifactProcessing(frame: RequestFrame, customerId: string, artifactId: string): Promise<Record<string, unknown>>;
  getArtifactProcessing(credential: unknown, customerId: string, artifactId: string): Promise<Record<string, unknown>>;
  listMyMaterials(credential: unknown): Promise<Record<string, unknown>>;
  createServiceIdentity(frame: RequestFrame): Promise<Record<string, unknown>>;
  listServiceIdentities(credential: unknown): Promise<Record<string, unknown>>;
  disableServiceIdentity(frame: RequestFrame, principalId: string): Promise<Record<string, unknown>>;
}

type Row = Record<string, unknown>;

function encodeCursor(id: string): string {
  return Buffer.from(JSON.stringify({ id }), 'utf8').toString('base64url');
}
function decodeCursor(cursor: string): { id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { id?: unknown };
    if (typeof parsed.id !== 'string' || parsed.id.length === 0) throw new Error('bad');
    return { id: parsed.id };
  } catch {
    throw invalid('cursor 无效');
  }
}

function requireInternal(ctxRoles: string[] | Principal['roles'], what: string): void {
  if (ctxRoles.some((r) => r === 'customer')) {
    throw forbidden('PERMISSION_DENIED', `${what} 仅限内部身份（客户联系人身份无此权限）`);
  }
}

export function buildIdentityCommands(kernel: Kernel): IdentityApi {
  return {
    // ---- G1 客户目录（权威分页查询；J1.1） --------------------------------

    async listCustomersDirectory(credential, opts) {
      const auth = await authenticate(kernel.verifierForV2(), credential);
      requireVerified(auth);
      requireInternal(auth.principal.roles, '客户目录');
      const limitRaw = opts.limit === undefined || opts.limit === null || opts.limit === '' ? 20 : Number(opts.limit);
      if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 100) throw invalid('limit 必须 1..100');
      const conds: string[] = [];
      const vals: unknown[] = [];
      if (auth.principal.tenants !== 'all') {
        vals.push(auth.principal.tenants);
        conds.push(`c.tenant_id = ANY($${vals.length})`);
      }
      if (auth.principal.customers === 'grant') {
        vals.push(auth.principal.principalId);
        conds.push(`EXISTS (SELECT 1 FROM principal_customer_grants g WHERE g.principal_id=$${vals.length} AND g.customer_id=c.customer_id)`);
      }
      const search = (opts.search ?? '').trim();
      if (search.length > 0) {
        if (search.length > 100) throw invalid('search 过长（≤100）');
        vals.push(`%${search}%`);
        conds.push(`c.display_name ILIKE $${vals.length}`);
      }
      if (opts.cursor) {
        const cur = decodeCursor(opts.cursor);
        vals.push(cur.id);
        conds.push(`c.customer_id > $${vals.length}`);
        // 键集只用 customer_id（全局唯一、时间戳前缀≈时序）：created_at 是 PG 微秒精度，
        // 经 JS ISO(毫秒) 游标编码会截断导致边界行跨页重复，不可用作游标键。
      }
      vals.push(limitRaw + 1);
      const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
      const res = await kernel.pool.query(
        `SELECT c.customer_id, c.display_name, c.status, c.created_by, c.created_at
         FROM customers c ${where}
         ORDER BY c.customer_id LIMIT $${vals.length}`, vals);
      const rows = res.rows as Row[];
      const hasMore = rows.length > limitRaw;
      const page = hasMore ? rows.slice(0, limitRaw) : rows;
      const last = page[page.length - 1] as Row | undefined;
      return {
        ok: true,
        customers: page.map((r) => ({
          customerId: r.customer_id, displayName: r.display_name, status: r.status,
          createdBy: r.created_by, createdAt: r.created_at,
        })),
        nextCursor: hasMore && last ? encodeCursor(String(last.customer_id)) : null,
      };
    },

    // ---- G2 受限邀请（J1.1；过期/撤销在兑换口拒绝） ------------------------

    createInvitation: (frame, customerId) => {
      return withCommandV2(kernel, frame, 'invitation.create', frame.tenantId as string, async (tx, h, ctx) => {
        requireHuman(ctx, 'invitation.create');
        requireDirectoryRole(ctx, ['business', 'admin'], 'invitation.create');
        const customer = await lockCustomer(tx, customerId, ctx.tenantId);
        await requireCustomerScope(ctx, customerId, tx);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        const role = reqString(frame.role, 'role', 32);
        if (!CUSTOMER_ROLES.includes(role as never)) {
          throw invalid('role 必须 customer-owner|customer-finance|customer-plant');
        }
        if (!Array.isArray(frame.allowedKinds) || frame.allowedKinds.length < 1 || frame.allowedKinds.length > 32) {
          throw invalid('allowedKinds 必须是非空数组（≤32 项）');
        }
        const allowedKinds = frame.allowedKinds.map((k) => reqString(k, 'allowedKinds[]', 64));
        const subjectRef = frame.subjectRef === undefined || frame.subjectRef === null ? null : reqString(frame.subjectRef, 'subjectRef', 128);
        const note = frame.note === undefined || frame.note === null ? null : reqString(frame.note, 'note', 256);
        let expiresInHours = 168;
        if (frame.expiresInHours !== undefined && frame.expiresInHours !== null) {
          expiresInHours = Number(frame.expiresInHours);
          if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 720) {
            throw invalid('expiresInHours 必须 1..720（小时）');
          }
        }
        const invitationId = newId('inv');
        const code = randomBytes(24).toString('base64url');
        const expiresAt = new Date(Date.now() + expiresInHours * 3_600_000);
        await tx.query(
          `INSERT INTO customer_invitations
             (invitation_id, tenant_id, customer_id, role, allowed_kinds, subject_ref, note, code_sha256, expires_at, created_by)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)`,
          [invitationId, customer.tenant_id, customerId, role, JSON.stringify(allowedKinds),
            subjectRef, note, sha256(code), expiresAt, ctx.actor],
        );
        await h.audit({
          actor: ctx.actor, action: 'invitation_created', targetType: 'invitation', targetId: invitationId,
          summary: `受限邀请（${role}）`, payload: { customerId, role, allowedKinds },
        });
        await h.emit('INVITATION_CREATED', customerId, { invitationId, role });
        return {
          ok: true,
          invitation: { invitationId, role, allowedKinds, subjectRef, note, expiresAt, code },
        };
      });
    },

    async listInvitations(credential, customerId) {
      const auth = await authenticate(kernel.verifierForV2(), credential);
      requireVerified(auth);
      requireInternal(auth.principal.roles, '邀请列表');
      const customerRow = await kernel.pool.query(`SELECT * FROM customers WHERE customer_id=$1`, [customerId]);
      if (customerRow.rows.length === 0) throw notFound('客户不存在');
      const tenantId = (customerRow.rows[0] as Row).tenant_id as string;
      await scopeByRow(kernel, { credential }, tenantId, customerId);
      const res = await kernel.pool.query(
        `SELECT invitation_id, role, allowed_kinds, subject_ref, note, expires_at, status, created_by, created_at, used_at, used_principal_id
         FROM customer_invitations WHERE customer_id=$1 ORDER BY created_at DESC, invitation_id`, [customerId]);
      return {
        ok: true,
        invitations: (res.rows as Row[]).map((r) => ({
          invitationId: r.invitation_id, role: r.role, allowedKinds: r.allowed_kinds, subjectRef: r.subject_ref,
          note: r.note, expiresAt: r.expires_at, status: r.status, createdBy: r.created_by,
          createdAt: r.created_at, usedAt: r.used_at, usedPrincipalId: r.used_principal_id,
        })),
      };
    },

    revokeInvitation: (frame, invitationId) => {
      return withCommandV2(kernel, frame, 'invitation.revoke', frame.tenantId as string, async (tx, h, ctx) => {
        requireHuman(ctx, 'invitation.revoke');
        requireDirectoryRole(ctx, ['business', 'admin'], 'invitation.revoke');
        const inv = await tx.query(`SELECT * FROM customer_invitations WHERE invitation_id=$1 FOR UPDATE`, [invitationId]);
        if (inv.rows.length === 0) throw notFound('邀请不存在');
        const row = inv.rows[0] as Row;
        await requireCustomerScope(ctx, row.customer_id as string, tx);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        const upd = await tx.query(
          `UPDATE customer_invitations SET status='revoked' WHERE invitation_id=$1 AND status='active'`,
          [invitationId]);
        if (upd.rowCount === 0) {
          const status = row.status as string;
          if (status === 'used') throw conflict('INVITATION_ALREADY_USED', '邀请已兑换，不能撤销（如需停用请联系 admin 撤权）');
          throw conflict('INVITATION_ALREADY_USED', '邀请已撤销');
        }
        await h.audit({
          actor: ctx.actor, action: 'invitation_revoked', targetType: 'invitation', targetId: invitationId,
          summary: '受限邀请撤销（即刻生效）', payload: { customerId: row.customer_id },
        });
        await h.emit('INVITATION_REVOKED', row.customer_id as string, { invitationId });
        return { ok: true, invitationId, revoked: true };
      });
    },

    /** 唯一匿名 v2 写口：凭 code 兑换为客户联系人身份。恰一次由 status='active' 行级竞争保证。 */
    async redeemInvitation(frame) {
      const code = reqString(frame.code, 'code', 128, 8);
      let requestId: string | null = null;
      if (frame.requestId !== undefined && frame.requestId !== null) {
        requestId = reqString(frame.requestId, 'requestId', 128);
      }
      const client = await kernel.pool.connect();
      try {
        await client.query('BEGIN');
        const h = v2Helpers(client);
        const hit = await client.query(
          `SELECT * FROM customer_invitations WHERE code_sha256=$1 FOR UPDATE`, [sha256(code)]);
        if (hit.rows.length === 0) {
          await client.query('ROLLBACK');
          throw new AppError('INVITATION_NOT_FOUND', '邀请码无效或已失效');
        }
        const inv = hit.rows[0] as Row;
        const status = inv.status as string;
        if (status === 'used') {
          await client.query('ROLLBACK');
          // 响应丢失对账：同 requestId 重放 → 返回既成事实（不含明文凭据——凭据只在首次响应发出）。
          if (requestId !== null && inv.redeem_request_id === requestId) {
            return {
              ok: true, replayed: true, principalId: inv.used_principal_id, customerId: inv.customer_id,
              role: inv.role, allowedKinds: inv.allowed_kinds,
              note: '该邀请已用此 requestId 兑换过；凭据已随首次响应发出，请使用已保存的凭据或联系业务重发邀请',
            };
          }
          throw conflict('INVITATION_ALREADY_USED', '邀请已被兑换');
        }
        if (status === 'revoked') {
          await client.query('ROLLBACK');
          throw new AppError('INVITATION_REVOKED', '邀请已被撤销，请联系业务重发');
        }
        if (new Date(inv.expires_at as string).getTime() <= Date.now()) {
          await client.query('ROLLBACK');
          throw new AppError('INVITATION_EXPIRED', '邀请已过期，请联系业务重发');
        }
        const principalId = newId('ci');
        const credential = `cit_${randomBytes(24).toString('base64url')}`;
        const upd = await client.query(
          `UPDATE customer_invitations
           SET status='used', used_at=now(), used_principal_id=$2, redeem_request_id=$3
           WHERE invitation_id=$1 AND status='active'`, [inv.invitation_id, principalId, requestId]);
        if (upd.rowCount === 0) {
          await client.query('ROLLBACK');
          throw conflict('INVITATION_ALREADY_USED', '邀请已被兑换');
        }
        await client.query(
          `INSERT INTO customer_identities
             (principal_id, tenant_id, customer_id, role, allowed_kinds, credential_sha256, created_invitation_id)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
          [principalId, inv.tenant_id, inv.customer_id, inv.role, JSON.stringify(inv.allowed_kinds),
            sha256(credential), inv.invitation_id],
        );
        await client.query(
          `INSERT INTO principal_customer_grants (tenant_id, principal_id, customer_id, created_by)
           VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [inv.tenant_id, principalId, inv.customer_id, principalId],
        );
        await h.audit({
          actor: principalId, action: 'invitation_redeemed', targetType: 'invitation', targetId: inv.invitation_id as string,
          summary: `邀请兑换为客户联系人身份（${inv.role}）`, payload: { customerId: inv.customer_id, role: inv.role },
        });
        await h.emit('INVITATION_REDEEMED', inv.customer_id as string, { invitationId: inv.invitation_id, role: inv.role });
        const cname = await client.query(`SELECT display_name FROM customers WHERE customer_id=$1`, [inv.customer_id]);
        await client.query('COMMIT');
        return {
          ok: true,
          credential,
          principalId,
          customerId: inv.customer_id,
          customerName: cname.rows.length > 0 ? (cname.rows[0] as Row).display_name : null,
          role: inv.role,
          allowedKinds: inv.allowed_kinds,
        };
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch { /* 已回滚 */ }
        throw e;
      } finally {
        client.release();
      }
    },

    // ---- G3 材料处理状态（服务身份回执制 + 获准披露） ----------------------

    recordArtifactProcessing: (frame, customerId, artifactId) => {
      return withCommandV2(kernel, frame, 'artifact.processing.record', frame.tenantId as string, async (tx, h, ctx) => {
        if (ctx.kind !== 'service') {
          throw forbidden('PERMISSION_DENIED', '材料处理状态只接受获准服务身份（kind=service）回执，不许伪造进度');
        }
        const customer = await lockCustomer(tx, customerId, ctx.tenantId);
        await requireCustomerScope(ctx, customerId, tx);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        const art = await tx.query(
          `SELECT 1 FROM evidence_artifacts WHERE artifact_id=$1 AND customer_id=$2`, [artifactId, customerId]);
        if (art.rows.length === 0) throw notFound('材料不存在');
        const rawStages = Array.isArray(frame.stages) ? frame.stages : [frame];
        if (rawStages.length < 1 || rawStages.length > 20) throw invalid('stages 必须 1..20 项');
        let current: Row | null = null;
        for (const raw of rawStages) {
          const item = (raw ?? {}) as Row;
          const stage = reqString(item.stage, 'stage', 32);
          const rank = STAGE_RANK[stage];
          if (rank === undefined) throw invalid(`stage 必须 ${Object.keys(STAGE_RANK).join('|')}`);
          const runRef = reqString(item.runRef, 'runRef', 128);
          const detail = item.detail === undefined || item.detail === null ? null : reqString(item.detail, 'detail', 512);
          const failureReason = item.failureReason === undefined || item.failureReason === null ? null : reqString(item.failureReason, 'failureReason', 256);
          const nextAction = item.nextAction === undefined || item.nextAction === null ? null : reqString(item.nextAction, 'nextAction', 256);
          if (stage === 'failed' && failureReason === null) throw invalid('stage=failed 必须给 failureReason（页面要能解释下一动作）');
          if ((stage === 'failed' || stage === 'needs_review') && nextAction === null) {
            throw invalid(`stage=${stage} 必须给 nextAction（页面要能解释下一动作）`);
          }
          const prior = await tx.query(
            `SELECT max(stage_rank) AS top FROM artifact_processing WHERE artifact_id=$1 AND run_ref=$2`,
            [artifactId, runRef]);
          const top = (prior.rows[0] as Row | undefined)?.top;
          if (top !== null && top !== undefined && rank <= Number(top)) {
            throw conflict('PROCESSING_STAGE_REGRESSION', `运行 ${runRef} 内阶段不可回退或重复（当前档位 ${top}，请求 ${stage}）`, { runRef, stage });
          }
          await tx.query(
            `INSERT INTO artifact_processing
               (tenant_id, customer_id, artifact_id, run_ref, stage, stage_rank, detail, failure_reason, next_action, registered_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [customer.tenant_id, customerId, artifactId, runRef, stage, rank, detail, failureReason, nextAction, ctx.actor],
          );
          current = { stage, runRef, failureReason, nextAction };
        }
        await h.audit({
          actor: ctx.actor, action: 'artifact_processing_recorded', targetType: 'artifact', targetId: artifactId,
          summary: `材料处理状态 → ${current?.stage}`, payload: { customerId, artifactId, current },
        });
        await h.emit('ARTIFACT_PROCESSING_UPDATED', customerId, { artifactId, ...(current as Row) });
        return { ok: true, artifactId, current, recorded: rawStages.length };
      });
    },

    async getArtifactProcessing(credential, customerId, artifactId) {
      const auth = await authenticate(kernel.verifierForV2(), credential);
      requireVerified(auth);
      requireInternal(auth.principal.roles, '处理历史明细');
      const art = await kernel.pool.query(
        `SELECT c.tenant_id FROM evidence_artifacts a JOIN customers c ON c.customer_id=a.customer_id
         WHERE a.artifact_id=$1 AND a.customer_id=$2`, [artifactId, customerId]);
      if (art.rows.length === 0) throw notFound('材料不存在');
      await scopeByRow(kernel, { credential }, (art.rows[0] as Row).tenant_id as string, customerId);
      const res = await kernel.pool.query(
        `SELECT run_ref, stage, detail, failure_reason, next_action, registered_by, registered_at
         FROM artifact_processing WHERE artifact_id=$1 ORDER BY id`, [artifactId]);
      const history = res.rows as Row[];
      const lastRow: Row | undefined = history[history.length - 1];
      return {
        ok: true,
        artifactId,
        current: lastRow ? {
          stage: lastRow.stage, runRef: lastRow.run_ref,
          failureReason: lastRow.failure_reason, nextAction: lastRow.next_action,
        } : null,
        history: history.map((r) => ({
          runRef: r.run_ref, stage: r.stage, detail: r.detail, failureReason: r.failure_reason,
          nextAction: r.next_action, registeredBy: r.registered_by, registeredAt: r.registered_at,
        })),
      };
    },

    /** 客户联系人专用获准披露视图：只含白名单进度字段，不含 grade/事实值/来源链/内部摘要（B13 边界 + J1.2）。 */
    async listMyMaterials(credential) {
      const auth = await authenticate(kernel.verifierForV2(), credential);
      requireVerified(auth);
      if (!auth.principal.roles.includes('customer')) {
        throw forbidden('PERMISSION_DENIED', '该视图仅客户联系人身份使用');
      }
      const ident = await kernel.pool.query(
        `SELECT customer_id, tenant_id FROM customer_identities WHERE principal_id=$1 AND status='active'`,
        [auth.principal.principalId]);
      if (ident.rows.length === 0) throw forbidden('PERMISSION_DENIED', '客户联系人身份无效或已停用');
      const customerId = (ident.rows[0] as Row).customer_id as string;
      const res = await kernel.pool.query(
        `SELECT a.artifact_id, a.kind, a.created_at, a.duplicate_of,
                p.stage, p.failure_reason, p.next_action
         FROM evidence_artifacts a
         LEFT JOIN LATERAL (
           SELECT stage, failure_reason, next_action FROM artifact_processing ap
           WHERE ap.artifact_id=a.artifact_id ORDER BY ap.id DESC LIMIT 1
         ) p ON true
         WHERE a.customer_id=$1 AND a.superseded_by IS NULL
         ORDER BY a.created_at DESC, a.artifact_id`, [customerId]);
      return {
        ok: true,
        customerId,
        materials: (res.rows as Row[]).map((r) => ({
          artifactId: r.artifact_id, kind: r.kind, createdAt: r.created_at,
          duplicateOf: r.duplicate_of,
          stage: r.stage ?? 'registered',
          failureReason: r.failure_reason, nextAction: r.next_action,
        })),
      };
    },

    // ---- §11.1 交付运行时服务身份（DEF-G04N-04 A 侧；admin 人类专用） ----------------

    createServiceIdentity: (frame) => {
      return withCommandV2(kernel, frame, 'service-identity.create', frame.tenantId as string, async (tx, h, ctx) => {
        requireHuman(ctx, 'service-identity.create');
        requireDirectoryRole(ctx, ['admin'], 'service-identity.create');
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        const displayName = frame.displayName === undefined || frame.displayName === null
          ? '' : reqString(frame.displayName, 'displayName', 128);
        const principalId = newId('svc');
        // 凭据仅存 sha256；明文只在本次响应出现（纪律同邀请码；重放不重发明文）
        const credential = `svc_${randomBytes(24).toString('base64url')}`;
        await tx.query(
          `INSERT INTO service_identities (principal_id, tenant_id, display_name, credential_sha256, created_by)
           VALUES ($1,$2,$3,$4,$5)`,
          [principalId, ctx.tenantId, displayName, sha256(credential), ctx.actor],
        );
        await h.audit({
          actor: ctx.actor, action: 'service_identity_created', targetType: 'service_identity', targetId: principalId,
          summary: `签发交付运行时服务身份（租户 ${ctx.tenantId}${displayName ? `；${displayName}` : ''}）`,
          payload: { tenantId: ctx.tenantId },
        });
        await h.emit('SERVICE_IDENTITY_CREATED', null, { principalId, tenantId: ctx.tenantId });
        return { ok: true, principalId, credential, tenantId: ctx.tenantId, displayName, status: 'active' };
      });
    },

    async listServiceIdentities(credential) {
      const auth = await authenticate(kernel.verifierForV2(), credential);
      requireVerified(auth);
      requireInternal(auth.principal.roles, '服务身份列表');
      if (!auth.principal.roles.includes('admin')) {
        throw forbidden('PERMISSION_DENIED', '服务身份列表仅限 admin');
      }
      const res = await kernel.pool.query(
        `SELECT principal_id, tenant_id, display_name, status, created_by, created_at, disabled_at, disabled_by
         FROM service_identities ORDER BY created_at DESC, principal_id`);
      return {
        ok: true,
        identities: (res.rows as Row[]).map((r) => ({
          principalId: r.principal_id, tenantId: r.tenant_id, displayName: r.display_name,
          status: r.status, createdBy: r.created_by, createdAt: r.created_at,
          disabledAt: r.disabled_at, disabledBy: r.disabled_by,
        })),
      };
    },

    disableServiceIdentity: (frame, principalId) => {
      return withCommandV2(kernel, frame, 'service-identity.disable', frame.tenantId as string, async (tx, h, ctx) => {
        requireHuman(ctx, 'service-identity.disable');
        requireDirectoryRole(ctx, ['admin'], 'service-identity.disable');
        const row0 = await tx.query(`SELECT tenant_id, status FROM service_identities WHERE principal_id=$1`, [principalId]);
        if (row0.rows.length === 0) throw notFound('服务身份不存在');
        const owner = row0.rows[0] as Row;
        if (owner.tenant_id !== ctx.tenantId) throw notFound('服务身份不存在');
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        if (owner.status !== 'active') {
          throw conflict('NOT_READY', `服务身份当前 ${owner.status}：仅 active 可禁用`);
        }
        await tx.query(
          `UPDATE service_identities SET status='disabled', disabled_at=now(), disabled_by=$2 WHERE principal_id=$1`,
          [principalId, ctx.actor],
        );
        await h.audit({
          actor: ctx.actor, action: 'service_identity_disabled', targetType: 'service_identity', targetId: principalId,
          summary: '服务身份停用（即刻不可认证；重放同样 403）', payload: {},
        });
        await h.emit('SERVICE_IDENTITY_DISABLED', null, { principalId });
        return { ok: true, principalId, status: 'disabled' };
      });
    },
  };
}
