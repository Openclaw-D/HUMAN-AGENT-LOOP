// 测试工具：隔离测试数据库 + 受控内核进程 + HTTP 客户端。
// 每个 suite：DROP/CREATE v7next_a_test_<uniq> → 起内核进程(随机端口) → 跑用例 → 杀进程+DROP库。
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const A_ROOT = path.resolve(__dirname, '..');
// 管理库可经 JW_A_ADMIN_DB_URL 指向本任务的隔离容器（如 jw-cc-kernel-pg@15444）；
// 未设置时保持历史默认（v7next-a-pg@15432），旧流程行为不变。
const ADMIN_DB = process.env.JW_A_ADMIN_DB_URL ?? 'postgres://v7next:v7next@127.0.0.1:15432/postgres';
const BASE_PORT = 48100;

export const TOKENS = {
  admin: 'tok-admin',
  business: 'tok-business',
  agent: 'tok-agent',
  approver: 'tok-approver',
  agent2: 'tok-agent2',
};
export const PRINCIPAL_SPEC = [
  `${TOKENS.admin}=alice:human:admin:all`,
  `${TOKENS.business}=bob:human:business+config:all`,
  `${TOKENS.agent}=worker1:agent:business:all`,
  `${TOKENS.agent2}=worker2:agent:business:all`,
  `${TOKENS.approver}=carol:human:approver:all`,
  'tok-limited=larry:human:business:restricted-proj-x',
  // C 模板六角色（human 岗位；供 run-c-plans 等组合场景使用）
  'tok-jianwei=jane:human:jianwei:all',
  'tok-policy=paul:human:policy:all',
  'tok-credit=cindy:human:credit:all',
  'tok-commerce=connor:human:commerce:all',
  'tok-asset=adam:human:asset:all',
].join(',');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function createTestDb(prefix = 'v7next_a_test') {
  const name = `${prefix}_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: ADMIN_DB });
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const base = new URL(ADMIN_DB);
  base.pathname = `/${name}`;
  return { name, url: base.toString() };
}

export async function dropTestDb(name) {
  const admin = new pg.Pool({ connectionString: ADMIN_DB });
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
}

/** 启动内核进程；返回 {port, stop, dbUrl, pool(直连DB, 白盒时间操纵用)}。keepDb=true 时 stop 不删库（重启测试用）。
 *  principalSpec 可选：v2 授信域测试需租户限定身份（第5段 tenants），默认保持 v1 合成目录。
 *  随机端口偶发与本机常驻服务（如 Edge 面板@48200）碰撞：EADDRINUSE 时自动换口重试（goal-01）。 */
export async function startKernel({ portOffset = 0, leaseSeconds = 90, dispatch = false, dbUrl = null, keepDb = false, extraArgs = [], principalSpec = PRINCIPAL_SPEC } = {}) {
  const db = dbUrl === null ? await createTestDb() : { name: null, url: dbUrl };
  try {
    for (let attempt = 1; ; attempt++) {
      const port = BASE_PORT + Math.floor(Math.random() * 400) + portOffset;
      const args = ['src/index.ts', '--port', String(port), '--db', db.url, '--principal-tokens', principalSpec,
        '--lease-seconds', String(leaseSeconds)];
      if (dispatch) args.push('--dispatch');
      if (extraArgs.length > 0) args.push(...extraArgs);
      const child = spawn('node', args, { cwd: A_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
      const logs = [];
      child.stdout.on('data', (d) => logs.push(d.toString()));
      child.stderr.on('data', (d) => logs.push(d.toString()));
      const base = `http://127.0.0.1:${port}`;
      // 等健康检查通过
      let up = false;
      for (let i = 0; i < 60; i++) {
        try {
          const r = await fetch(`${base}/healthz`);
          if (r.status === 200) { up = true; break; }
        } catch { /* 未起 */ }
        await sleep(250);
      }
      if (up) {
        const pool = new pg.Pool({ connectionString: db.url });
        return {
          port, base, dbUrl: db.url, dbName: db.name, child, logs,
          pool,
          async stop() {
            child.kill('SIGTERM');
            await sleep(300);
            if (!child.killed) child.kill('SIGKILL');
            try { await pool.end(); } catch { /* 已断 */ }
            if (db.name !== null && !keepDb) await dropTestDb(db.name);
          },
        };
      }
      child.kill('SIGKILL');
      const logText = logs.join('');
      if (attempt < 3 && logText.includes('EADDRINUSE')) continue; // 端口碰撞：换口重来
      throw new Error(`kernel 启动失败：\n${logText}`);
    }
  } catch (error) {
    if (db.name !== null && !keepDb) { try { await dropTestDb(db.name); } catch { /* 尽力清理 */ } }
    throw error;
  }
}

/** HTTP 客户端：默认带 principal credential。 */
export function client(base, token = TOKENS.admin) {
  return async (method, path, body) => {
    const headers = { 'content-type': 'application/json' };
    if (token !== null) headers['x-principal-credential'] = token;
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await res.json(); } catch { /* 非JSON */ }
    return { status: res.status, json };
  };
}

/** 最小可用模板（非行业：审阅→批准 两目标）。 */
export function simpleTemplate(name = 'tpl-simple') {
  return {
    requestId: `tpl-${randomBytes(4).toString('hex')}`,
    name,
    roles: [
      { roleKey: 'business', title: '业务', isHumanRole: false },
      { roleKey: 'approver', title: '审批人', isHumanRole: true },
    ],
    goals: [
      { goalKey: 'review', title: '审阅', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: ['doc'], dependsOn: [], params: {} },
      { goalKey: 'approve', title: '批准建议', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: [], dependsOn: ['review'], params: {} },
    ],
  };
}

export const newId = (p) => `${p}-${randomBytes(6).toString('hex')}`;
export { sleep };
