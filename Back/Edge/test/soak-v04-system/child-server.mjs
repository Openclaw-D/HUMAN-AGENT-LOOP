// soak-v04-system 被测子进程：导入本包固定快照的真实产品模块（messages.mjs/message-store.mjs），
// 按 server.mjs 同构装配（threadStore=receiptStore=同一 store 实例；deliver=外发替身 HTTP 调用），
// 暴露最小 HTTP 面 + 受控故障钩子。所有端口系统分配、绑定 127.0.0.1；不读凭据、无真实外发。
// 故障钩子按 requestId 精确触发：crash_before（claim 后出站前退出）/crash_after（出站后 finalize 前
// 退出）/error（deliver 抛错）/hang_ms（延迟返回，供断连场景）/none。
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const env = process.env;
const SNAPSHOT = env.SOAK_SNAPSHOT_DIR; // 含 messages.mjs / message-store.mjs 的目录
const DB_FILE = env.SOAK_DB || null;    // 缺省 :memory:（与产品 E0 兼容形态一致）
const SINK = env.SOAK_SINK;             // 外发替身 baseUrl
const INSTANCE = env.SOAK_INSTANCE || 'A';
const LEASE_MS = Number(env.SOAK_LEASE_MS || 15 * 60 * 1000);
const STORE_OPTS = JSON.parse(env.SOAK_STORE_OPTS || '{}');

const { createMessageRouter } = await import(pathToFileURL(path.join(SNAPSHOT, 'messages.mjs')).href);
const { createMessageStore } = await import(pathToFileURL(path.join(SNAPSHOT, 'message-store.mjs')).href);

const store = createMessageStore(DB_FILE ? { file: DB_FILE, ...STORE_OPTS } : { ...STORE_OPTS });
const auditFile = env.SOAK_AUDIT_FILE;
const auditSink = {
  append(entry) {
    if (!auditFile) return;
    try { appendFileSync(auditFile, JSON.stringify({ at: new Date().toISOString(), instance: INSTANCE, ...entry }) + '\n'); } catch { /* 审计尽力而为 */ }
  },
};

// 故障臂：requestId -> {mode, hangMs, once}。命中即清（once），SIGKILL 由驱动直接杀进程。
const armed = new Map();

async function deliver(msg) {
  const f = armed.get(msg.requestId);
  if (f) {
    if (f.mode === 'crash_before') { armed.delete(msg.requestId); console.error(`[fault] crash_before requestId=${msg.requestId}`); process.exit(70); }
    if (f.mode === 'hang_ms') { await new Promise((r) => setTimeout(r, f.hangMs ?? 3000)); armed.delete(msg.requestId); }
    if (f.mode === 'error') { armed.delete(msg.requestId); throw new Error('soak injected deliver error'); }
  }
  // 真实外发：调用替身 sink（逐条计数与落盘）。
  const resp = await fetch(`${SINK}/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(msg),
    signal: AbortSignal.timeout(10_000),
  });
  const sinkResp = await resp.json();
  if (f && f.mode === 'crash_after') { armed.delete(msg.requestId); console.error(`[fault] crash_after requestId=${msg.requestId}`); process.exit(70); }
  if (!resp.ok || !sinkResp.ok) return { messageId: sinkResp.messageId ?? 'unknown', state: 'failed' };
  return { messageId: sinkResp.messageId, state: 'sent_local_sink' };
}

// validateTarget：镜像 live 面"目标客户对本会话可读"；soak 规则：'x-' 前缀客户不可读（确定性负例）。
const validateTarget = async (_session, customerId) => (String(customerId).startsWith('x-')
  ? { ok: false, code: 'CUSTOMER_NOT_READABLE', status: 403 }
  : { ok: true });

const router = createMessageRouter({
  deliver, auditSink, threadStore: store, receiptStore: store, validateTarget,
  pendingLeaseMs: LEASE_MS,
});

let eventLoopLagMs = 0;
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  eventLoopLagMs = Math.max(eventLoopLagMs * 0.5, now - lastTick - 1000);
  lastTick = now;
}, 1000).unref();

const readBody = (req) => new Promise((resolve, reject) => {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > 1e6) { reject(new Error('body too large')); req.destroy(); } });
  req.on('end', () => resolve(b));
  req.on('error', reject);
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const sendJson = (status, obj) => {
    try {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    } catch { /* 客户端断连：处理逻辑已完成，仅响应失败 */ }
  };
  try {
    if (req.method === 'POST' && url.pathname === '/messages') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const out = await router.handle({
        session: body.session ?? {},
        customerId: body.customerId,
        body: body.body ?? {},
        log: (m) => console.error(`[messages] ${INSTANCE} ${m}`),
      });
      sendJson(out.status, out.body);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/messages') {
      const cid = url.searchParams.get('customerId');
      if (!cid) { sendJson(400, { ok: false, error: 'CUSTOMER_REQUIRED' }); return; }
      // 只读面镜像 server.mjs GET 端点：受众过滤、增量游标、分页 limit。
      const audience = url.searchParams.get('audience');
      const after = url.searchParams.get('after');
      const limit = url.searchParams.get('limit');
      const out = store.list(cid, {
        ...(audience === 'customer' || audience === 'internal' ? { audience } : {}),
        ...(after !== null ? { afterSeq: Number(after) } : {}),
        ...(limit !== null ? { limit: Number(limit) } : {}),
      });
      sendJson(200, { ok: true, ...out });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/__ctl/stats') {
      const m = process.memoryUsage();
      sendJson(200, {
        ok: true, instance: INSTANCE, pid: process.pid, uptimeSec: process.uptime(),
        rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal, external: m.external,
        eventLoopLagMs: Math.round(eventLoopLagMs * 10) / 10,
        store: store.stats(),
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/__ctl/receipt') {
      const rid = url.searchParams.get('requestId');
      sendJson(200, { ok: true, record: store.getReceiptRecord(rid) });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/__ctl/receipt-dump') {
      sendJson(200, { ok: true, stats: store.stats() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/__ctl/arm') {
      const b = JSON.parse((await readBody(req)) || '{}');
      armed.set(String(b.requestId), { mode: String(b.mode || 'none'), hangMs: Number(b.hangMs || 3000) });
      sendJson(200, { ok: true, armed: armed.size });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/__ctl/seed-legacy') {
      // 旧无作用域回执种子（兼容面 putReceipt 直写：principal_id='' → 路由失败关闭）。
      const b = JSON.parse((await readBody(req)) || '{}');
      store.putReceipt(String(b.requestId), String(b.fingerprint), b.result ?? { ok: true, legacy: true }, { customerId: String(b.customerId ?? '') });
      sendJson(200, { ok: true });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/__ctl/expire-pending') {
      // 显式租约回收（恢复验证用）：等价于租约到期后的原子收敛。
      const b = JSON.parse((await readBody(req)) || '{}');
      const changed = store.expirePendingReceipt(String(b.requestId), Number(b.maxAgeMs ?? 0), b.unknownResult ?? {
        ok: true, requestId: String(b.requestId), audience: 'customer', delivery: { messageId: 'unknown', state: 'unknown' },
        note: 'soak 租约收敛',
      });
      sendJson(200, { ok: true, changed });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/__ctl/token') { sendJson(200, { ok: true, token: randomUUID() }); return; }
    sendJson(404, { ok: false, error: 'NOT_FOUND' });
  } catch (e) {
    sendJson(500, { ok: false, error: 'CHILD_INTERNAL', note: String(e?.message ?? e) });
  }
});

server.requestTimeout = 60_000;
server.headersTimeout = 65_000;
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  console.log(JSON.stringify({ ready: true, instance: INSTANCE, pid: process.pid, port, db: DB_FILE ? path.basename(DB_FILE) : ':memory:', leaseMs: LEASE_MS, storeOpts: STORE_OPTS }));
});
process.on('SIGTERM', () => { try { store.close(); } catch { /* 幂等 */ } process.exit(0); });
