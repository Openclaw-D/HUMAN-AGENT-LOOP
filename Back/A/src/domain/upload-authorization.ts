// V0.4 01 路：上传授权只读投影（契约：docs/v0.4/results/01-upload/CONTRACT.md V0.4-UPLOAD-AUTHZ-PROJ-1.0）。
// 从现有可信身份链（principal.ts/identity.ts）与 registerArtifact 正式上传写门（credit.ts）派生
// principalId/customerId/tenantId/canRead/canUpload/种类白名单；零写（只 SELECT，不碰幂等/审计/outbox），
// 不新建邀请、不续期、不登记材料；权限来源不足明确失败关闭，不造租户、不放宽授权。
import { invalid } from './errors.ts';
import { authenticate, requireVerified } from './principal.ts';
import type { Kernel } from './kernel.ts';

export type UploadAuthReason =
  | 'OK' | 'PRINCIPAL_MISMATCH' | 'CUSTOMER_NOT_FOUND'
  | 'CUSTOMER_SCOPE_VIOLATION' | 'NOT_HUMAN' | 'KIND_NOT_ALLOWED';

export interface UploadAuthQuery {
  credential: unknown;
  customerId: unknown;
  /** 可选：验证的材料种类（与 registerArtifact 的 kind 同口径，含 material. 前缀别名）。 */
  kind?: unknown;
  /** 可选：调用方声明的主体；仅作一致性核验（不符即拒），绝非授权来源。 */
  principalId?: unknown;
}

export interface UploadAuthGrant {
  ok: boolean;
  principalId: string;
  customerId: string;
  tenantId: string | null;
  canRead: boolean;
  canUpload: boolean;
  kind: string | null;
  kindRestricted: boolean;
  allowedKinds: string[] | null;
  kindAllowed: boolean | null;
  reason: UploadAuthReason;
}

/** 拒绝投影的统一装配：任何拒绝路径 tenantId 一律 null（不确认跨租户存在性）。 */
function deny(partial: Omit<UploadAuthGrant, 'tenantId' | 'canRead' | 'canUpload' | 'kindRestricted' | 'allowedKinds' | 'kindAllowed' | 'ok'>
  & { kindRestricted?: boolean; allowedKinds?: string[] | null; kind?: string | null }): UploadAuthGrant {
  return {
    ok: false, tenantId: null, canRead: false, canUpload: false,
    kindRestricted: partial.kindRestricted ?? false,
    allowedKinds: partial.allowedKinds ?? null,
    kind: partial.kind ?? null, kindAllowed: null,
    principalId: partial.principalId, customerId: partial.customerId, reason: partial.reason,
  };
}

export function buildUploadAuthorization(kernel: Kernel): { authorizeUpload(query: UploadAuthQuery): Promise<UploadAuthGrant> } {
  return {
    async authorizeUpload(query: UploadAuthQuery): Promise<UploadAuthGrant> {
      if (typeof query.customerId !== 'string' || query.customerId.length < 1 || query.customerId.length > 64) {
        throw invalid('customerId 必须是 1..64 长度的 string');
      }
      let kind: string | null = null;
      if (query.kind !== undefined && query.kind !== null) {
        kind = query.kind as string;
        if (typeof kind !== 'string' || kind.trim().length < 1 || kind.length > 64) {
          throw invalid('kind 必须是 1..64 长度的 string');
        }
      }
      // ① 身份：与写门同源（authenticate + requireVerified）——无凭据/凭据不可验证/验证器异常
      //    一律 PRINCIPAL_UNTRUSTED 失败关闭，不回显凭据（authenticate 内已保证固定文案）。
      const auth = await authenticate(kernel.verifierForV2(), query.credential);
      requireVerified(auth);
      const principal = auth.principal;
      const customerId = query.customerId;
      // ③ 主体声明核验（写门无此声明字段；本门是调用方防混淆护栏，不符即拒）。
      if (typeof query.principalId === 'string' && query.principalId.length > 0 && query.principalId !== principal.principalId) {
        return deny({ principalId: principal.principalId, customerId, kind, reason: 'PRINCIPAL_MISMATCH' });
      }
      // ④ 客户行（对应写门 lockCustomer 的存在性事实）。
      const c = await kernel.pool.query(`SELECT tenant_id FROM customers WHERE customer_id=$1`, [customerId]);
      if (c.rows.length === 0) {
        return deny({ principalId: principal.principalId, customerId, kind, reason: 'CUSTOMER_NOT_FOUND' });
      }
      const tenantId = (c.rows[0] as { tenant_id: string }).tenant_id;
      // ⑤ 租户范围（对应写门 authorizeTenant + lockCustomer 租户匹配；投影按客户行租户判）。
      if (principal.tenants !== 'all' && !principal.tenants.includes(tenantId)) {
        return deny({ principalId: principal.principalId, customerId, kind, reason: 'CUSTOMER_SCOPE_VIOLATION' });
      }
      // ⑥ 客户 grant（与写门 requireCustomerScope 同一查询：principal_id+customer_id 精确匹配）。
      if (principal.customers === 'grant') {
        const g = await kernel.pool.query(
          `SELECT 1 FROM principal_customer_grants WHERE principal_id=$1 AND customer_id=$2`,
          [principal.principalId, customerId],
        );
        if (g.rows.length === 0) {
          return deny({ principalId: principal.principalId, customerId, kind, reason: 'CUSTOMER_SCOPE_VIOLATION' });
        }
      }
      // ⑦ 人类门（对应写门 requireHuman：agent/service 一律不可正式上传）。
      const isHuman = principal.kind === 'human';
      // ⑧ 种类白名单（与写门同查询：roles 含 customer 且存在 active customer_identities 行才受限；
      //    material. 前缀剥离比对规则逐字同源 credit.ts registerArtifact）。
      let kindRestricted = false;
      let allowedKinds: string[] | null = null;
      if (principal.roles.includes('customer')) {
        const ident = await kernel.pool.query(
          `SELECT allowed_kinds FROM customer_identities WHERE principal_id=$1 AND status='active'`,
          [principal.principalId],
        );
        if (ident.rows.length > 0) {
          const allowed = (ident.rows[0] as { allowed_kinds: string[] | undefined }).allowed_kinds ?? [];
          kindRestricted = true;
          allowedKinds = allowed;
        }
      }
      let kindAllowed: boolean | null = null;
      if (kind !== null) {
        if (!kindRestricted) {
          kindAllowed = true;
        } else {
          const bareKind = kind.startsWith('material.') ? kind.slice('material.'.length) : kind;
          kindAllowed = allowedKinds !== null && allowedKinds.includes(bareKind);
        }
      }
      const canRead = true;
      const canUpload = isHuman && (kindAllowed === null || kindAllowed);
      // 从紧口径（契约 §1）：任何拒绝路径 tenantId 一律 null（即使 canRead=true 也不回显）。
      if (!isHuman) {
        return {
          ok: false, principalId: principal.principalId, customerId, tenantId: null,
          canRead, canUpload: false, kind, kindRestricted, allowedKinds, kindAllowed, reason: 'NOT_HUMAN',
        };
      }
      if (kindAllowed === false) {
        return {
          ok: false, principalId: principal.principalId, customerId, tenantId: null,
          canRead, canUpload: false, kind, kindRestricted, allowedKinds, kindAllowed: false, reason: 'KIND_NOT_ALLOWED',
        };
      }
      // ⑨ 汇总：全部权限门通过。
      return {
        ok: true, principalId: principal.principalId, customerId, tenantId,
        canRead: true, canUpload: true, kind, kindRestricted, allowedKinds, kindAllowed, reason: 'OK',
      };
    },
  };
}
