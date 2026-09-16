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
  kind: 'human' | 'agent';
  roles: string[];
  projects: 'all' | string[];
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
}

/** --principal-tokens 语法（合成测试身份，服务端仅存 sha256）：
 *  "tokA=alice:human:business+approver:all, tokB=worker1:agent:executor:p1+p2" */
export function parsePrincipalTokens(spec: string | undefined): Config['principals'] {
  if (!spec) return [];
  const out: Config['principals'] = [];
  for (const entry of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const eq = entry.indexOf('=');
    if (eq <= 0) throw new Error(`principal-tokens 条目缺少 "="：${entry.slice(0, 12)}…`);
    const credential = entry.slice(0, eq);
    const parts = entry.slice(eq + 1).split(':');
    const [principalId, kind, rolesSpec, projectsSpec] = parts;
    if (!principalId || !kind || !rolesSpec) throw new Error('principal-tokens 条目需要 credential=id:kind:roles[:projects]');
    if (kind !== 'human' && kind !== 'agent') throw new Error(`kind 必须 human|agent：${kind}`);
    const roles = rolesSpec === '-' ? [] : rolesSpec.split('+');
    const projects: 'all' | string[] = !projectsSpec || projectsSpec === 'all' ? 'all' : projectsSpec.split('+');
    out.push({
      credentialSha256: createHash('sha256').update(credential).digest('hex'),
      principal: { principalId, displayName: principalId, kind, roles, projects },
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
  return {
    httpPort,
    dbUrl,
    leaseSeconds: leaseArg !== undefined ? Number(leaseArg) : envInt('V7NEXT_A_LEASE_SECONDS', DEFAULTS.leaseSeconds),
    principals,
    modelTransport: null,
    outboxPollMs: envInt('V7NEXT_A_OUTBOX_POLL_MS', DEFAULTS.outboxPollMs),
    outboxMaxAttempts: envInt('V7NEXT_A_OUTBOX_MAX_ATTEMPTS', DEFAULTS.outboxMaxAttempts),
    withDispatcher: argv.includes('--dispatch'),
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
