// V0.4 长程测试 02_API 包 · Edge 子进程。
// 从"隔离运行副本"（SOAK_SRC_DIR，源码快照，hash 见 state/copy-hashes.json）导入真实 Edge 模块，
// 以 live 形态装配完整服务（kernel-store + 会话 + 审计 + 消息路由 + 消息线程 sqlite + 回执目录 +
// A 面 proxy/readProxy）——与 src/server.mjs main() 的 live 装配同构，唯一替身仍是 stand-in A。
// 自采样每 30s 写 SOAK_METRICS_FILE（JSONL）：RSS/heap/事件循环滞后/句柄/连接/桶/上游查询计数。
// 优雅停机走 IPC {cmd:'shutdown'}（Windows 下 kill() 不执行优雅处理器）；消息线程种子在启动时
// 经 messageStore.append 直接落库（fixture 播种，与 GET 零副作用口径分开披露）。
import { performance } from 'node:perf_hooks';
import { appendFileSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RUN_DIR = process.env.SOAK_RUN_DIR;
const SRC = process.env.SOAK_SRC_DIR;
const A_PORT = Number(process.env.SOAK_A_PORT);
const METRICS = process.env.SOAK_METRICS_FILE;
const AUTH_FILE = process.env.SOAK_AUTH_FILE;
const MESSAGES_FILE = process.env.SOAK_MESSAGES_FILE;
const RECEIPTS_DIR = process.env.SOAK_RECEIPTS_DIR;
const EDGE_LOG = process.env.SOAK_EDGE_LOG;

const mod = (p) => import(pathToFileURL(path.join(SRC, p)).href);
const logLine = (m) => { try { appendFileSync(EDGE_LOG, `${new Date().toISOString()} ${m}\n`); } catch { } };

const { startEdgeServer, createLiveCredentialVerifier } = await mod('server.mjs');
const { createKernelStore } = await mod('kernel-store.mjs');
const { createSessionStore } = await mod('session.mjs');
const { createAuditSink } = await mod('audit.mjs');
const { createUpstreamProxy } = await mod('proxy.mjs');
const { createReadProxy } = await mod('readproxy.mjs');
const { createMessageRouter } = await mod('messages.mjs');
const { createMessageStore } = await mod('message-store.mjs');
const { httpProbe, aKernelReadyPass, tcpProbe } = await mod('probes.mjs');
const { collectVersionSeal } = await mod('version.mjs');

const kernelBase = `http://127.0.0.1:${A_PORT}`;
const store = createKernelStore({ baseUrl: kernelBase, log: logLine });
const sessionStore = createSessionStore({});
const auditSink = createAuditSink();
const messageStore = createMessageStore({ file: MESSAGES_FILE });
const liveVerifier = createLiveCredentialVerifier({
  kernelBase,
  directory: await (async () => {
    // 与 main() loadDirectory 同形：auth-file → byHash/byPrincipal（凭据只进服务端内存）。
    const { createHash } = await import('node:crypto');
    const parsed = JSON.parse(readFileSync(AUTH_FILE, 'utf8'));
    const byHash = new Map(); const byPrincipal = new Map(); const list = [];
    for (const e of parsed.entries ?? []) {
      const meta = { principalId: e.principalId, roles: e.roles ?? [], label: e.label ?? e.principalId, demo: false, tenantId: e.tenantId ?? null };
      byHash.set(createHash('sha256').update(e.credential).digest('hex'), meta);
      byPrincipal.set(e.principalId, { ...meta, credential: e.credential });
      list.push({ principalId: meta.principalId, roles: meta.roles, label: meta.label, demo: false });
    }
    return { byHash, byPrincipal, list };
  })(),
  redeemedDirectory: { byHash: new Map() },
});

let deliverCount = 0;
const messages = createMessageRouter({
  deliver: async (msg) => ({ messageId: `local-${++deliverCount}`, state: 'sent_local_sink' }),
  auditSink,
  threadStore: messageStore,
  receiptStore: messageStore,
  validateTarget: (session, customerId) => store.checkCustomer(customerId, { credential: session.credential }),
});

const seal = await collectVersionSeal({ repoRoot: path.resolve(SRC, '..', '..', '..', '..'), capabilities: { note: 'soak-v04-api run copy' } }).catch(() => ({ buildId: 'soak-run-copy', capabilities: {} }));
const proxies = {
  proxy: createUpstreamProxy({ baseUrl: kernelBase, credentialFor: (s) => s.credential }),
  readProxy: createReadProxy({ baseUrl: kernelBase, credentialFor: (s) => s.credential }),
};

const started = await startEdgeServer({
  port: 0,
  seal,
  store,
  auth: async ({ session, action }) => (session ? { ok: true, principalId: session.principalId } : { ok: false, reason: 'SESSION_REQUIRED' }),
  probes: [
    httpProbe({ name: 'kernel-a', url: `${kernelBase}/healthz`, pass: aKernelReadyPass }),
    tcpProbe({ name: 'db', port: A_PORT }), // stand-in A 的 TCP 存活（本包无独立 PG）
  ],
  sessionStore,
  verifyCredential: liveVerifier,
  messages,
  messageStore,
  modelReceiptsDir: RECEIPTS_DIR,
  auditSink,
  ...proxies,
  log: logLine,
});

// fixture 播种：线程数据（真实 messageStore.append 落库；与 GET 零副作用口径分开披露）。
// cust-mix 播 60 条（customer/internal 混合），其余规模档客户各 6 条。
function seed(cid, n, mixInternal = false) {
  for (let i = 1; i <= n; i++) {
    messageStore.append({
      customerId: cid,
      audience: mixInternal && i % 3 === 0 ? 'internal' : 'customer',
      text: `种子消息 ${cid} #${i}（soak fixture）`,
      requestId: `seed-${cid}-${i}`,
      senderPrincipalId: 'p-biz',
      senderRoles: ['business'],
    });
  }
}
seed('cust-mix', 60, true);
seed('cust-a10', 6);
seed('cust-a1000', 6);
seed('cust-a10000', 6);
seed('cust-m1000', 6);
seed('cust-other', 3);

// ---- 自采样（30s）----
const metricsFile = METRICS;
let lastLoopCheck = performance.now();
setInterval(() => { lastLoopCheck = performance.now(); }, 1000).unref();
async function sample() {
  const t0 = performance.now();
  await new Promise((r) => setImmediate(r));
  const lag = performance.now() - t0;
  const mem = process.memoryUsage();
  const conns = await new Promise((r) => started.server.getConnections((e, n) => r(e ? -1 : n)));
  const buckets = store._stats();
  const q = store._qCounters();
  const row = {
    ts: new Date().toISOString(), pid: process.pid,
    rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, external: mem.external,
    eventloopLagMs: Number(lag.toFixed(2)),
    activeHandles: (process.getActiveResourcesInfo?.() ?? []).length,
    serverConns: conns, uptimeSec: Math.round(process.uptime()),
    kernelBuckets: buckets.length, kernelBuffered: buckets.reduce((a, b) => a + b.envelopes, 0),
    kernelSubs: buckets.reduce((a, b) => a + b.subs, 0),
    qTotal: q.total, qSnapshot: q.snapshot, qEvents: q.events, qDetail: q.detail, qOther: q.other,
    sessions: sessionStore._size(), messageStats: messageStore.stats(),
  };
  try { appendFileSync(metricsFile, `${JSON.stringify(row)}\n`); } catch { }
}
const samplerTimer = setInterval(sample, 30_000);
samplerTimer.unref();

mkdirSync(path.dirname(metricsFile), { recursive: true });
writeFileSync(metricsFile, '');
await sample();

// 本文件仅经 child_process.fork 作为子进程运行：优雅停机走 IPC。
process.on('message', async (m) => {
  if (m && m.cmd === 'shutdown') {
    clearInterval(samplerTimer);
    try { messageStore.close(); } catch { }
    await started.close();
    process.exit(0);
  }
});
process.on('uncaughtException', (e) => { logLine(`[uncaught] ${e.stack || e.message}`); });
process.on('unhandledRejection', (e) => { logLine(`[unhandled] ${String(e && (e.stack || e.message) || e)}`); });

if (process.send) process.send({ type: 'listening', port: started.port, pid: process.pid });
logLine(`[edge-child] listening on 127.0.0.1:${started.port}`);
