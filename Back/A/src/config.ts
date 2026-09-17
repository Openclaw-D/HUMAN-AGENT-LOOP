import { createHash } from 'node:crypto';
import { Pool } from 'pg';

export const DEFAULTS = {
  port: 48080,
  dbPort: 15432,
  leaseSeconds: 90,
  outboxPollMs: 500,
  outboxMaxAttempts: 8,
};

export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export interface Principal {
  principalId: string;
  displayName: string;
  kind: 'human' | 'agent' | 'service';
  roles: string[];
  projects: 'all' | string[];
  /** v2 授信域租户范围（'all' 仅限合成测试目录；生产必须显式列出）。缺省 'all' 保持 v1 行为。 */
  tenants: 'all' | string[];
  /** 客户级范围（任务01 A1）：'all'=租户内全部客户（合成目录/旧行为）；'grant'=仅 principal_customer_grants
   *  登记的客户（可撤销；撤权后重放不借缓存）。缺省 'all'。 */
  customers: 'all' | 'grant';
}

export interface Config {
  httpPort: number;
  dbUrl: string;
  leaseSeconds: number;
  /** 合成 principal 目录：credential 的 sha256 → principal 描述；为空 = 无可信身份源（敏感写失败关闭）。 */
  principals: { credentialSha256: string; principal: Principal }[];
  /** GLM-5.2 transport 预留：本轮恒为 null（未配置），相关命令如实 MODEL_NOT_CONFIGURED。 */
  modelTransport: null;
  outboxPollMs: number;
  outboxMaxAttempts: number;
  withDispatcher: boolean;
  // ---- v2 客户授信内核（任务01）----
  /** 客户级人民币产品上限（整数分；1,000 万元 = 1_000_000_000 分）。用户产品方向，非监管限额。 */
  creditCapCnyMinor: number;
  /** 激活的权限矩阵版本；未配置 = 正式动作一律 policy_pending（fail-closed，P-05）。 */
  creditMatrixVersion: string | null;
  /** 激活的集中度政策版本；未配置 = 批准前 POLICY_PENDING（P-03）。 */
  concentrationPolicyVersion: string | null;
  /** 关联组合计上限（整数分）；NULL=未配置组上限（仍需 concentrationPolicyVersion 存在才可批准）。 */
  groupCapMinor: number | null;
  // ---- 任务02 决策闭环 ----
  /** 提额冷却秒数；NULL=冷却机制未配置（不启用，也不编造默认值；B11 测试用显式合成值）。 */
  creditCoolingSeconds: number | null;
  // ---- 任务01 A2/A3（审核 F02/F03/F06/F10 修复）----
  /** 必需域政策版本（domain_requirement_policies）；NULL=未配置 → 依据包冻结一律 POLICY_PENDING（fail-closed）。 */
  requiredDomainsPolicyVersion: string | null;
  /** 显式兼容核：允许无依据包的存量（legacy）basis 走评估复查路径批准/用信。默认拒绝。 */
  allowLegacyBasis: boolean;
  /** 提额（再评估）请求窗口限制：窗口天数内最多次数；NULL=不按次数限制。 */
  limitIncreaseMaxPerWindow: number | null;
  /** 提额请求次数窗口（天）。 */
  limitIncreaseWindowDays: number | null;
  /** 提额被驳回后的再申请间隔（小时）→ next_eligible_at；NULL=不设。 */
  limitIncreaseRetryHours: number | null;
}

/** --principal-tokens 语法（合成测试身份，服务端仅存 sha256）：
 *  "tokA=alice:human:business+approver:all, tokB=worker1:agent:executor:p1+p2, tokC=cai:human:credit:all:t1+t2"
 *  第5段可选 = 租户范围（v2 授信域）；缺省 'all'。 */
export function parsePrincipalTokens(spec: string | undefined): Config['principals'] {
  if (!spec) return [];
  const out: Config['principals'] = [];
  for (const entry of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const eq = entry.indexOf('=');
    if (eq <= 0) throw new Error(`principal-tokens 条目缺少 "="：${entry.slice(0, 12)}…`);
    const credential = entry.slice(0, eq);
    const parts = entry.slice(eq + 1).split(':');
    const [principalId, kind, rolesSpec, projectsSpec, tenantsSpec, customersSpec] = parts;
    if (!principalId || !kind || !rolesSpec) throw new Error('principal-tokens 条目需要 credential=id:kind:roles[:projects[:tenants[:customers]]]');
    if (kind !== 'human' && kind !== 'agent' && kind !== 'service') throw new Error(`kind 必须 human|agent|service：${kind}`);
    const roles = rolesSpec === '-' ? [] : rolesSpec.split('+');
    const projects: 'all' | string[] = !projectsSpec || projectsSpec === 'all' ? 'all' : projectsSpec.split('+');
    const tenants: 'all' | string[] = !tenantsSpec || tenantsSpec === 'all' ? 'all' : tenantsSpec.split('+');
    const customers: 'all' | 'grant' = !customersSpec || customersSpec === 'all' ? 'all' : customersSpec === 'grant' ? 'grant' : 'all';
    out.push({
      credentialSha256: createHash('sha256').update(credential).digest('hex'),
      principal: { principalId, displayName: principalId, kind, roles, projects, tenants, customers },
    });
  }
  return out;
}

export function loadConfig(argv: string[]): Config {
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const httpPort = arg('port') !== undefined ? Number(arg('port')) : envInt('V7NEXT_A_PORT', DEFAULTS.port);
  const dbPort = envInt('V7NEXT_A_DB_PORT', DEFAULTS.dbPort);
  const dbUrl = arg('db') ?? process.env.V7NEXT_A_DB_URL ?? `postgres://v7next:v7next@127.0.0.1:${dbPort}/v7next_a`;
  const principals = parsePrincipalTokens(arg('principal-tokens') ?? process.env.V7NEXT_A_PRINCIPAL_TOKENS);
  const leaseArg = arg('lease-seconds');
  const capArg = arg('credit-cap-minor') ?? process.env.V7NEXT_A_CREDIT_CAP_MINOR;
  const groupCapArg = arg('credit-group-cap-minor') ?? process.env.V7NEXT_A_CREDIT_GROUP_CAP_MINOR;
  return {
    httpPort,
    dbUrl,
    leaseSeconds: leaseArg !== undefined ? Number(leaseArg) : envInt('V7NEXT_A_LEASE_SECONDS', DEFAULTS.leaseSeconds),
    principals,
    modelTransport: null,
    outboxPollMs: envInt('V7NEXT_A_OUTBOX_POLL_MS', DEFAULTS.outboxPollMs),
    outboxMaxAttempts: envInt('V7NEXT_A_OUTBOX_MAX_ATTEMPTS', DEFAULTS.outboxMaxAttempts),
    withDispatcher: argv.includes('--dispatch'),
    creditCapCnyMinor: capArg !== undefined ? Number(capArg) : 1_000_000_000, // 1,000 万元 = 1e9 分
    creditMatrixVersion: arg('credit-matrix') ?? process.env.V7NEXT_A_CREDIT_MATRIX ?? null,
    concentrationPolicyVersion: arg('credit-concentration') ?? process.env.V7NEXT_A_CREDIT_CONCENTRATION ?? null,
    groupCapMinor: groupCapArg !== undefined ? Number(groupCapArg) : null,
    creditCoolingSeconds: arg('credit-cooling-seconds') !== undefined
      ? Number(arg('credit-cooling-seconds'))
      : (process.env.V7NEXT_A_CREDIT_COOLING_SECONDS !== undefined && process.env.V7NEXT_A_CREDIT_COOLING_SECONDS !== ''
          ? Number(process.env.V7NEXT_A_CREDIT_COOLING_SECONDS)
          : null),
    requiredDomainsPolicyVersion: arg('required-domains-policy') ?? process.env.V7NEXT_A_REQUIRED_DOMAINS_POLICY ?? null,
    allowLegacyBasis: argv.includes('--allow-legacy-basis'),
    limitIncreaseMaxPerWindow: arg('limit-increase-max-per-window') !== undefined ? Number(arg('limit-increase-max-per-window')) : null,
    limitIncreaseWindowDays: arg('limit-increase-window-days') !== undefined ? Number(arg('limit-increase-window-days')) : null,
    limitIncreaseRetryHours: arg('limit-increase-retry-hours') !== undefined ? Number(arg('limit-increase-retry-hours')) : null,
  };
}

export function openPool(dbUrl: string): Pool {
  return new Pool({
    connectionString: dbUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}
