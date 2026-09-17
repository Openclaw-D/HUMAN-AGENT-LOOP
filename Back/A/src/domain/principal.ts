import { createHash } from 'node:crypto';
import type { Config, Principal } from '../config.ts';
import { forbidden } from './errors.ts';

/** 身份验证器：credential → principal。可注入异步实现（CONTRACT §3.8）；
 *  A 内置实现为合成 token 目录（仅存 sha256），供测试与窄闭环使用。 */
export type PrincipalVerifier = (credential: string) => Promise<Principal | null>;

export function tokenDirectoryVerifier(directory: Config['principals']): PrincipalVerifier {
  return async (credential: string): Promise<Principal | null> => {
    const sha = createHash('sha256').update(credential).digest('hex');
    const hit = directory.find((e) => e.credentialSha256 === sha);
    return hit ? { ...hit.principal } : null;
  };
}

export const ANONYMOUS: Principal = {
  principalId: 'unverified',
  displayName: 'unverified',
  kind: 'agent',
  roles: [],
  projects: 'all',
  tenants: 'all',
  customers: 'all',
};

export interface Auth {
  principal: Principal;
  verified: boolean;
}

/** 解析请求身份：凭据无效 → 403（不区分"不存在"避免枚举）；无凭据 → 匿名（角色检查必然失败）。 */
export async function authenticate(verifier: PrincipalVerifier | null, credential: unknown): Promise<Auth> {
  if (typeof credential !== 'string' || credential.length === 0) {
    return { principal: { ...ANONYMOUS }, verified: false };
  }
  if (verifier === null) {
    // 有凭据但无可信身份源：失败关闭（凭据不可验证即不可信）。
    throw forbidden('PRINCIPAL_UNTRUSTED', '无可信身份验证器：凭据不可验证（失败关闭）');
  }
  let verdict: Principal | null = null;
  try {
    verdict = await verifier(credential);
  } catch (error) {
    // 验证器异常文本可能内嵌凭据（旧 D-10 教训）：只回固定文案，不透传 error。
    void error;
    throw forbidden('PRINCIPAL_UNTRUSTED', 'principal 验证器异常（失败关闭；详情见服务端日志，不回显凭据）');
  }
  if (!verdict || verdict.principalId === undefined) {
    throw forbidden('PRINCIPAL_UNTRUSTED', 'principal 凭据验证失败');
  }
  return { principal: verdict, verified: true };
}

export function authorizeProject(principal: Principal, projectId: string): void {
  if (principal.projects === 'all') return;
  if (!principal.projects.includes(projectId)) {
    throw forbidden('PROJECT_FORBIDDEN', `principal 无该项目授权：${projectId}`);
  }
}

/** v2 授信域租户范围校验（A10）：范围外一律 NOT_FOUND 语义由调用方处理，这里只判权。 */
export function authorizeTenant(principal: Principal, tenantId: string): void {
  if (principal.tenants === 'all') return;
  if (!principal.tenants.includes(tenantId)) {
    throw forbidden('CUSTOMER_SCOPE_VIOLATION', 'principal 无该租户授权');
  }
}

/** 客户级范围校验（任务01 A1/K03）：customers='grant' → 必须 principal_customer_grants 在册。
 *  DB 查询面由调用方传入（pool/tx 均可）；撤销授权即刻生效（重放路径同样经过此处）。 */
export async function authorizeCustomer(
  principal: Principal, customerId: string,
  q: { query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }> },
): Promise<void> {
  if (principal.customers === 'all') return;
  const r = await q.query(
    `SELECT 1 FROM principal_customer_grants WHERE principal_id=$1 AND customer_id=$2`,
    [principal.principalId, customerId],
  );
  if (r.rows.length === 0) {
    throw forbidden('CUSTOMER_SCOPE_VIOLATION', 'principal 无该客户授权');
  }
}

export function requireVerified(auth: Auth): void {
  if (!auth.verified) {
    throw forbidden('PRINCIPAL_UNTRUSTED', '敏感命令需要可信 principal（无可信身份源 = 默认拒绝）');
  }
}

export function requireRole(auth: Auth, role: string, kind?: Principal['kind']): void {
  requireVerified(auth);
  if (kind && auth.principal.kind !== kind) {
    throw forbidden('ROLE_FORBIDDEN', `该命令要求 ${kind} principal（当前 ${auth.principal.kind}）`);
  }
  if (!auth.principal.roles.includes(role)) {
    throw forbidden('ROLE_FORBIDDEN', `principal 缺少角色授权：${role}`);
  }
}

export function requireAdmin(auth: Auth): void {
  requireVerified(auth);
  if (!auth.principal.roles.includes('admin')) {
    throw forbidden('ROLE_FORBIDDEN', '该命令要求 admin 角色');
  }
}

/** 敏感命令统一入口：verified + 项目授权；角色由各命令进一步限定。 */
export function requireSensitive(auth: Auth, projectId: string | null): void {
  requireVerified(auth);
  if (projectId !== null) authorizeProject(auth.principal, projectId);
}
