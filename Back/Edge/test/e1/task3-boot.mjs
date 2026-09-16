// 任务三 E1 共享引导：隔离 PG（v7d- 前缀）→ 全部迁移 → 合成开发权限矩阵 →
// 九角色 A 内核（179xx 段）→ live Edge（kernel-store 投影 + 会话凭据服务端映射）。
// 与 e1-d02 同端口纪律：15434 / 17919；用后即毁；不触碰 48080/15432 旧实例。
import { execFile, spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACK_ROOT = path.resolve(EDGE_ROOT, '..');
const REPO_ROOT = path.resolve(BACK_ROOT, '..');

export const NINE_PRINCIPALS = [
  // 任务书九角色（客户侧三角色以合成 human principal 参与真实会话；权限仍由 A 目录/矩阵裁决）
  'tok-biz1=biz1:human:business:all:t1',     // 业务
  'tok-jw1=jw1:human:jianwei:all:t1',        // 见微（无默认额度权限）
  'tok-pol1=pol1:human:policy:all:t1',       // 政策
  'tok-cred1=cred1:human:credit:all:t1',     // 信审
  'tok-comm1=comm1:human:commerce:all:t1',   // 商务
  'tok-asset1=asset1:human:asset:all:t1',    // 资产
  'tok-app1=app1:human:approver:all:t1',     // 有权人类（授信正式流程）
  'tok-dir1=dir1:human:director:all:t1',     // 厂长
  'tok-cust1=cust1:human:customer:all:t1',   // 客户实控人
  'tok-adm1=adm1:human:admin:all:all',       // 建模板/项目用管理（不计九角色矩阵）
].join(',');

export const ROLE_LABELS = {
  biz1: '业务', jw1: '见微', pol1: '政策', cred1: '信审', comm1: '商务',
  asset1: '资产', app1: '有权人类(approver)', dir1: '厂长', cust1: '客户实控人', adm1: 'admin(-setup)',
};

export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { windowsHide: true, timeout: opts.timeout || 60000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} exit: ${String(stderr || err.message).slice(0, 300)}`));
      resolve({ stdout, stderr });
    });
    if (opts.input !== undefined) { child.stdin.write(opts.input); child.stdin.end(); }
  });
}

export async function waitHttp(url, ok, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); if (ok(r)) return true; } catch { }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const wan = (n) => n * 1_000_000;

export async function bootStack({ t, runName }) {
  const RUN_DIR = path.join(EDGE_ROOT, '.run', runName);
  const DB = `v7d_${runName.replace(/-/g, '_')}`;
  const PG_PORT = 15434;
  const API_PORT = 17919;
  mkdirSync(RUN_DIR, { recursive: true });

  // 1) 隔离 PG + 迁移（001/002/003 必需；004 属任务二在制品，失败则记入 notes 不阻断本路消费面）
  const pgctl = await import('../../../D/harness/pgctl.mjs');
  const pg = await pgctl.ensurePg({ runDir: RUN_DIR, port: PG_PORT, db: 'v7d_boot' });
  // 幂等引导：上次失败运行可能残留同名库——先强制丢弃再建（只影响本测试家族 v7d_ 隔离库）
  await run('docker', ['exec', pg.name, 'psql', '-U', 'v7next', '-d', 'v7d_boot', '-c', `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`]);
  await pgctl.createDb(pg.name, DB);
  // 2) 迁移由 A 内核启动时自动应用（A 是迁移的唯一 writer；手动预应用会与其簿记冲突）。
  //    此处只记录迁移清单供证据；004 属任务二在制品，内核启动失败即如实报错。
  const migDir = path.join(BACK_ROOT, 'A', 'migrations');
  const applied = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
  const migrationNotes = applied.includes('004_decision_loop.sql')
    ? ['004_decision_loop.sql 属任务二在制品：随内核启动应用，本路不消费其路由']
    : [];

  // 3) A 内核（九角色 + admin；合成政策位）
  const dsn = `postgres://v7next:v7next@127.0.0.1:${PG_PORT}/${DB}`;
  const kernelLogFd = openSync(path.join(RUN_DIR, 'kernel.log'), 'w');
  const api = spawn(process.execPath, [path.join(BACK_ROOT, 'A', 'src', 'index.ts'), '--port', String(API_PORT), '--db', dsn,
    '--principal-tokens', NINE_PRINCIPALS, '--credit-matrix', 'matrix-e1-task3', '--credit-concentration', 'conc-e1-task3'],
    { windowsHide: true, stdio: ['ignore', kernelLogFd, kernelLogFd] });
  api.unref();
  const kernelBase = `http://127.0.0.1:${API_PORT}`;
  const kernelReady = await waitHttp(`${kernelBase}/healthz`, (r) => r.status === 200);
  if (!kernelReady) throw new Error('A 内核未就绪（详见 kernel.log）');

  // 3b) 合成开发权限矩阵（内核建表后播种；明确非公司制度，生产矩阵须公司批准录入）
  await run('docker', ['exec', pg.name, 'psql', '-U', 'v7next', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-c', `
    INSERT INTO permission_matrix (matrix_version, role, action, allowed, max_amount_minor) VALUES
      ('matrix-e1-task3','approver','facility.approve',true,${wan(1000)}),
      ('matrix-e1-task3','approver','facility.activate',true,NULL),
      ('matrix-e1-task3','approver','facility.suspend',true,NULL),
      ('matrix-e1-task3','approver','facility.reduce',true,NULL),
      ('matrix-e1-task3','business','fr.confirm-external',true,${wan(1000)})
    ON CONFLICT (matrix_version, role, action) DO NOTHING;`]);

  // 4) live Edge（进程内组装，与 scripts/server main --live 相同组件）
  const { startEdgeServer } = await import('../../src/server.mjs');
  const { createKernelStore } = await import('../../src/kernel-store.mjs');
  const { tcpProbe, httpProbe, aKernelReadyPass } = await import('../../src/probes.mjs');
  const { collectVersionSeal } = await import('../../src/version.mjs');
  const { createSessionStore } = await import('../../src/session.mjs');
  const { createAuditSink } = await import('../../src/audit.mjs');
  const { createUpstreamProxy } = await import('../../src/proxy.mjs');
  const { createMessageRouter } = await import('../../src/messages.mjs');

  const seal = await collectVersionSeal({ repoRoot: REPO_ROOT, capabilities: { note: `e1-${runName}` } });
  const store = createKernelStore({ baseUrl: kernelBase, log: () => { } });
  const sessionStore = createSessionStore({});
  const principalByToken = new Map();
  for (const entry of NINE_PRINCIPALS.split(',')) {
    const [token, spec] = entry.split('=');
    const [principalId, kind, rolesSpec] = spec.split(':');
    principalByToken.set(token, { principalId, kind, roles: rolesSpec.split(',') });
  }
  const verifyCredential = async ({ credential }) => {
    const hit = principalByToken.get(String(credential));
    return hit ? { ok: true, ...hit } : { ok: false, reason: 'PRINCIPAL_UNTRUSTED' };
  };
  const sent = [];
  const auditSink = createAuditSink();
  const proxy = createUpstreamProxy({ baseUrl: kernelBase, credentialFor: (s) => s.credential });
  const messages = createMessageRouter({ deliver: async (m) => { sent.push(m); return { messageId: `m-${sent.length}`, state: 'sent_local_sink' }; }, auditSink });
  const edge = await startEdgeServer({
    port: 0, seal, store,
    probes: [
      httpProbe({ name: 'kernel-a', url: `${kernelBase}/healthz`, pass: aKernelReadyPass }),
      tcpProbe({ name: 'db', port: PG_PORT }),
    ],
    auth: async ({ session }) => (session ? { ok: true, principalId: session.principalId } : { ok: false, reason: 'SESSION_REQUIRED' }),
    sessionStore, verifyCredential, proxy, messages, auditSink, staticHandler: null,
  });
  const base = `http://127.0.0.1:${edge.port}`;

  // 5) 九个独立 Edge 会话（C02 自动化矩阵）
  const sessions = {};
  for (const [token, info] of principalByToken) {
    const r = await fetch(`${base}/api/jw/v2/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: token }) });
    const j = await r.json();
    if (!j.ok) throw new Error(`会话交换失败 ${info.principalId}: ${JSON.stringify(j)}`);
    sessions[info.principalId] = { sessionId: j.session.sessionId, roles: j.session.roles, token };
  }

  /** Edge 调用助手：会话头 + JSON。 */
  const call = async (who, method, path, body) => {
    const s = sessions[who];
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(s ? { 'x-jw-session': s.sessionId } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await r.json(); } catch { }
    return { status: r.status, json };
  };
  /** 直连 A（仅 setup 用：建模板/项目）。 */
  const aCall = async (who, method, path, body) => {
    const token = who ? sessions[who].token : 'tok-adm1';
    const r = await fetch(`${kernelBase}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-principal-credential': token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await r.json(); } catch { }
    return { status: r.status, json };
  };

  const cleanup = async () => {
    try { await edge.close(); } catch { }
    if (api?.pid) { try { process.kill(api.pid); } catch { } }
    try { await pgctl.destroyPg(pg.name); } catch { }
  };

  // C07 注入助手：停内核（kill）/ 原参重启（同库同端口），日志落 RUN_DIR。
  const kernelArgs = [path.join(BACK_ROOT, 'A', 'src', 'index.ts'), '--port', String(API_PORT), '--db', dsn,
    '--principal-tokens', NINE_PRINCIPALS, '--credit-matrix', 'matrix-e1-task3', '--credit-concentration', 'conc-e1-task3'];
  let restartSeq = 0;
  const killKernel = () => { try { process.kill(api.pid); } catch { } };
  const restartKernel = async () => {
    restartSeq += 1;
    const fd = openSync(path.join(RUN_DIR, `kernel-restart-${restartSeq}.log`), 'w');
    const child = spawn(process.execPath, kernelArgs, { windowsHide: true, stdio: ['ignore', fd, fd] });
    child.unref();
    const ok2 = await waitHttp(`${kernelBase}/healthz`, (r) => r.status === 200, 60000);
    if (!ok2) throw new Error('内核重启未就绪');
    return child;
  };

  if (t) t.after(cleanup);

  return {
    base, kernelBase, sessions, call, aCall, sent, auditSink, store,
    api, pg, RUN_DIR, applied, migrationNotes, cleanup, edge,
    killKernel, restartKernel,
  };
}
