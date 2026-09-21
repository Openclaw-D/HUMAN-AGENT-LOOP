// V0.4 长程测试 02_API 包 · 长测驱动。
// 契约：docs/v0.4/soak/02_API.md。配额：总速率≤5req/s（目标4.5、桶容量5）、并发≤8、
// 单请求≤30s、长历史≤10000事件/1000材料元数据、内存预算1GB、测试数据/日志≤1GB。
// 进程拓扑：driver（限速/场景/采样/stand-in A）→ fork edge-child.mjs（源码快照上的真实 Edge live 装配）。
// 相位：P1 基线c1 → P2/P3/P4 并发2/4/8 → P5 故障恢复 → P6 持续混合 → P7 收尾稳定窗。
// 用法：node driver.mjs --phase P1 [--minutes 25] [--fresh-copy]；--plan full 全序列。
import { fork } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile, appendFile, rm, statfs, stat, symlink } from 'node:fs/promises';
import { existsSync, statSync, readFileSync, createWriteStream } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createStandInA } from './standin-a.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');
const ARG = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) ARG[process.argv[i].slice(2)] = (process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) ? process.argv[i + 1] : true;
}
const RUN_DIR = path.resolve(ARG['run-dir'] || path.join(REPO, '.local', 'soak-v04-api', 'run'));
const SRC_DEFAULT = path.join(REPO, 'Back', 'Edge', 'src');
const STATE = path.join(RUN_DIR, 'state');
const COPY = path.resolve(ARG['copy'] || path.join(RUN_DIR, 'copy'));
const REQ_TIMEOUT_MS = 30_000;
const SSE_MAX_CONCURRENT = 4;
let RATE_FACTOR = 1; // 宿主资源紧张时降为0.5（降载不降配额上限）

const CRED = {
  biz: 'soak-cred-biz-INTERNAL-TEST-ONLY',
  cust: 'soak-cred-cust-INTERNAL-TEST-ONLY',
  biz2: 'soak-cred-biz2-INTERNAL-TEST-ONLY',
};

const PLAN = {
  P1: { minutes: 25, conc: 1, title: '低载基线 c=1' },
  P2: { minutes: 30, conc: 2, title: '混合负载 c=2（晚到/重复/回执终态/游标走读）' },
  P3: { minutes: 30, conc: 4, title: '规模分页与撤权 c=4（10/1000/10000 首末续页）' },
  P4: { minutes: 30, conc: 8, title: '高并发与SSE c=8（重连/慢消费/主动断开/长连接）' },
  P5: { minutes: 30, conc: 2, title: '故障恢复窗口（A宕机/延迟/5xx、Edge重启/硬杀）' },
  P6: { minutes: 40, conc: 4, title: '持续混合轮换 c=2→4（场景矩阵补全）' },
  P7: { minutes: 65, conc: 2, title: '收尾稳定窗 c=2（≥60min无非预期错误）' },
};

const now = () => Date.now();
const iso = (t = now()) => new Date(t).toISOString();
const pct = (arr, p) => { if (!arr || arr.length === 0) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const sha = (p) => { try { return createHash('sha256').update(readFileSync(p)).digest('hex'); } catch { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Logger {
  constructor(file) { this.file = file; this.stream = createWriteStream(file, { flags: 'a' }); this.bytes = statSync(file, { throwIfNoEntry: false })?.size ?? 0; }
  log(...a) {
    const line = `${iso()} ${a.join(' ')}\n`;
    this.bytes += Buffer.byteLength(line);
    if (this.bytes > 20 * 1024 * 1024) {
      this.stream.end();
      this.stream = createWriteStream(this.file, { flags: 'w' });
      this.bytes = 0;
      this.stream.write(`${iso()} [rotate] 日志超限截断（轮转）\n`);
    }
    this.stream.write(line);
  }
  close() { this.stream.end(); }
}

// 令牌桶（全局共享；refill=4.5/s，burst=5 —— 平均速率严格低于5req/s上限）
function createBucket() {
  let tokens = 5; let last = now();
  return {
    async take() {
      for (;;) {
        const t = now(); const add = ((t - last) / 1000) * 4.5 * RATE_FACTOR;
        if (add > 0) { tokens = Math.min(5, tokens + add); last = t; }
        if (tokens >= 1) { tokens -= 1; return; }
        await sleep(20);
      }
    },
  };
}

function createResults() {
  return {
    pack: '02-api', version: 1, startedAt: null, endedAt: null,
    env: { node: process.version, platform: process.platform },
    copyHashes: null, whitelistHashStart: null, whitelistHashEnd: null,
    phases: {}, defects: [], faultWindows: [], slowClient: [], edgeRestarts: [],
  };
}
const resultsPath = () => path.join(STATE, 'results.json');
async function loadResults() { return existsSync(resultsPath()) ? JSON.parse(await readFile(resultsPath(), 'utf8')) : createResults(); }
async function saveResults(r) { await writeFile(resultsPath(), JSON.stringify(r, null, 1)); }

function request(base, pathname, { method = 'GET', session = null, body = null, query = '', timeoutMs = REQ_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const started = now();
    const req = http.request(`${base}${pathname}${query ? `?${query}` : ''}`, {
      method,
      headers: { ...(session ? { 'x-jw-session': session } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; if (raw.length > 8 * 1024 * 1024) req.destroy(); });
      res.on('end', () => {
        let json = null; try { json = JSON.parse(raw); } catch { }
        resolve({ status: res.statusCode, json, ms: now() - started, bodyBytes: Buffer.byteLength(raw) });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('client-timeout-30s')));
    req.on('error', (e) => resolve({ status: 0, error: String(e.message || e), ms: now() - started }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// SSE 客户端：解析 id/event/data 帧；auth 帧即返回；holdMs 后主动断开
function sseOpen(base, pathname, { session, cursor = null, lastEventId = null, holdMs = 8000, onFrame = null } = {}) {
  return new Promise((resolve) => {
    const frames = [];
    let resyncSeen = false, authSeen = false, firstCursor = null, slowOverflow = false, finished = false;
    const q = new URLSearchParams();
    if (cursor) q.set('cursor', cursor);
    const started = now();
    const req = http.request(`${base}${pathname}${q.toString() ? `?${q}` : ''}`, {
      headers: { 'x-jw-session': session, ...(lastEventId ? { 'last-event-id': lastEventId } : {}) },
    }, (res) => {
      if (res.statusCode !== 200) {
        let raw = ''; res.setEncoding('utf8'); res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode, frames, ms: now() - started, error: raw.slice(0, 200) }));
        return;
      }
      let buf = '';
      res.setEncoding('utf8');
      const finish = (why) => {
        if (finished) return; finished = true;
        clearTimeout(timer);
        try { res.destroy(); } catch { }
        resolve({ status: 200, frames, resyncSeen, authSeen, firstCursor, slowOverflow, why, ms: now() - started });
      };
      const timer = setTimeout(() => finish('hold-timeout'), holdMs);
      res.on('data', (c) => {
        if (finished) { try { res.destroy(); } catch { } return; }
        buf += c;
        let idx;
        while (!finished && (idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const frame = {};
          for (const line of chunk.split('\n')) {
            if (line.startsWith(':')) continue;
            const sep = line.indexOf(': ');
            if (sep > 0) frame[line.slice(0, sep)] = line.slice(sep + 2);
          }
          if (!frame.event) continue;
          let data = null; try { data = JSON.parse(frame.data ?? 'null'); } catch { }
          const f = { event: frame.event, id: frame.id ?? null, data };
          frames.push(f);
          if (frame.event === 'cursor') firstCursor = data?.eventCursor ?? null;
          if (frame.event === 'resync') { resyncSeen = true; if (data?.reason === 'slow_client_overflow') slowOverflow = true; }
          if (frame.event === 'auth') authSeen = true;
          onFrame?.(f);
          if (frame.event === 'auth') return finish('auth-frame');
        }
      });
      res.on('error', () => finish('stream-error'));
      res.on('close', () => finish('closed'));
    });
    req.setTimeout(REQ_TIMEOUT_MS, () => req.destroy(new Error('sse-client-timeout')));
    req.on('error', () => { });
    req.end();
  });
}

async function dirSize(p) {
  let total = 0;
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) await walk(fp);
      else total += (await stat(fp).catch(() => ({ size: 0 }))).size;
    }
  };
  await walk(p);
  return total;
}

// ---- 主驱动：单相位 ----
async function runPhase(phaseId, { minutes = null, fresh = false } = {}) {
  const plan = PLAN[phaseId];
  if (!plan) throw new Error(`未知相位 ${phaseId}`);
  const mins = minutes ?? plan.minutes;
  await mkdir(STATE, { recursive: true });
  const log = new Logger(path.join(STATE, `driver-${phaseId}.log`));
  const t0 = now();
  log.log(`=== 相位 ${phaseId}（${plan.title}）开始，计划 ${mins} 分钟 ===`);

  // 1) 源码快照副本（结果绑定副本 hash）。布局镜像 Back/：copy/Edge/src + copy/B/src，
  // 使 assistant-model 的 ../../B/... 相对导入在副本内自洽。
  const EDGE_SRC_COPY = path.join(COPY, 'Edge', 'src');
  if (!existsSync(path.join(EDGE_SRC_COPY, 'server.mjs')) || fresh) {
    await rm(COPY, { recursive: true, force: true });
    await cp(SRC_DEFAULT, EDGE_SRC_COPY, { recursive: true });
    // B 依赖（glm transport + @langchain）按契约复用已安装只读目录：junction 链接真实 Back/B
    //（模块 realpath 解析回真实路径，node_modules 依赖自然可用；副本内不含任何依赖拷贝）。
    const bLink = path.join(COPY, 'B');
    await rm(bLink, { recursive: true, force: true }).catch(() => { });
    await symlink(path.join(REPO, 'Back', 'B'), bLink, 'junction').catch(async (e) => {
      log.log(`[warn] junction 创建失败（${e.message}），回退为整目录拷贝（传递依赖可能缺 npm 包）`);
      await cp(path.join(REPO, 'Back', 'B', 'src'), path.join(COPY, 'B', 'src'), { recursive: true });
    });
    log.log(`源码快照复制完成 → ${COPY}（Edge/src + B/transport·graph）`);
  }
  const copyHashes = {};
  for (const f of (await readdir(EDGE_SRC_COPY)).filter((f) => f.endsWith('.mjs'))) copyHashes[f] = sha(path.join(EDGE_SRC_COPY, f));
  const results = await loadResults();
  results.startedAt ??= iso();
  if (!results.copyHashes) {
    results.copyHashes = { at: iso(), files: copyHashes };
    results.whitelistHashStart = {
      'kernel-store.mjs': sha(path.join(SRC_DEFAULT, 'kernel-store.mjs')),
      'customer-activity.mjs': sha(path.join(SRC_DEFAULT, 'customer-activity.mjs')),
    };
    log.log(`白名单轮始 hash：kernel-store=${results.whitelistHashStart['kernel-store.mjs'].slice(0, 12)} customer-activity=${results.whitelistHashStart['customer-activity.mjs'].slice(0, 12)}`);
  } else {
    const drift = Object.entries(copyHashes).filter(([f, h]) => results.copyHashes.files[f] !== h);
    if (drift.length > 0) {
      log.log(`[note] 副本与首相位 hash 漂移：${drift.map(([f]) => f).join(',')}（白名单修复后 --fresh-copy 重拷属预期）`);
      results.copyHashes = { at: iso(), files: copyHashes, note: 'phase-start refresh' };
    }
  }
  await saveResults(results);

  // 2) stand-in A（driver 进程内；替身=Back/A+PG，须在报告披露）
  const A = createStandInA({ log: (m) => log.log(`[standin-a] ${m}`) });
  const aPort = await A.listen();
  A.state.acl.set(CRED.biz, new Set(['cust-a10', 'cust-a1000', 'cust-a10000', 'cust-mix', 'cust-m1000']));
  A.state.acl.set(CRED.cust, new Set(['cust-mix']));
  A.state.acl.set(CRED.biz2, new Set(['cust-other']));
  A.seedScaleCustomer('cust-a10', 10, CRED.biz);
  A.seedScaleCustomer('cust-a1000', 1000, CRED.biz);
  A.seedScaleCustomer('cust-a10000', 10000, CRED.biz);
  A.seedScaleCustomer('cust-m1000', 24, CRED.biz);
  A.seedScaleCustomer('cust-other', 5, CRED.biz2, 'tenant-other');
  log.log(`stand-in A 就绪 @${aPort}（替身：Back/A 持久库+PG；Edge 全链真实）`);

  // 3) Edge 子进程（源码快照 live 装配）
  const runFiles = {
    auth: path.join(RUN_DIR, 'auth-file.json'), messages: path.join(RUN_DIR, 'messages-soak.sqlite'),
    receipts: path.join(RUN_DIR, 'model-receipts'), metrics: path.join(STATE, 'edge-metrics.jsonl'), edgeLog: path.join(STATE, 'edge-child.log'),
  };
  await mkdir(runFiles.receipts, { recursive: true });
  if (!existsSync(runFiles.auth)) {
    await writeFile(runFiles.auth, JSON.stringify({ entries: [
      { credential: CRED.biz, principalId: 'p-biz', roles: ['business'], tenantId: 'tenant-soak', label: 'soak 业务身份（合成测试）' },
      { credential: CRED.cust, principalId: 'cit-1', roles: ['customer'], tenantId: 'tenant-soak', label: 'soak 客户联系人（合成测试）' },
      { credential: CRED.biz2, principalId: 'p-biz2', roles: ['business'], tenantId: 'tenant-other', label: 'soak 他租户业务身份（合成测试）' },
    ] }, null, 1));
  }
  let edge = null;
  let edgePort = null;
  const forkEdge = () => new Promise((resolve, reject) => {
    const child = fork(path.join(HERE, 'edge-child.mjs'), [], {
      env: {
        ...process.env,
        SOAK_RUN_DIR: RUN_DIR, SOAK_SRC_DIR: EDGE_SRC_COPY, SOAK_A_PORT: String(aPort),
        SOAK_METRICS_FILE: runFiles.metrics, SOAK_AUTH_FILE: runFiles.auth,
        SOAK_MESSAGES_FILE: runFiles.messages, SOAK_RECEIPTS_DIR: runFiles.receipts, SOAK_EDGE_LOG: runFiles.edgeLog,
      },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const timer = setTimeout(() => reject(new Error('edge-child 启动超时')), 90_000);
    child.on('message', (m) => { if (m?.type === 'listening') { clearTimeout(timer); resolve({ child, port: m.port, pid: m.pid }); } });
    child.on('exit', (code, sig) => log.log(`edge-child(pid=${child.pid}) exit code=${code} sig=${sig}`));
  });
  edge = await forkEdge();
  edgePort = edge.port;

  // ctx：全部场景经 ctx.base 取当前端口（Edge 重启后端口可能变化）
  const ctx = {
    base: `http://127.0.0.1:${edgePort}`, A, log,
    rng: (() => { let s = 20260921 + phaseId.charCodeAt(1) * 7919; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; })(),
    postSeq: 100000 + Math.floor(Math.random() * 1000),
    revokeUntil: 0, // 撤权窗口结束时刻；窗口内 auth/403 为预期
    needReauth: false,
    sessions: {
      biz: { id: null, get() { return this.id; }, set(v) { this.id = v; } },
      cust: { id: null, get() { return this.id; }, set(v) { this.id = v; } },
    },
    biz() { return this.sessions.biz.get(); },
    cust() { return this.sessions.cust.get(); },
    async exchange(which) {
      const cred = CRED[which];
      const r = await request(this.base, '/api/jw/v2/session', { method: 'POST', body: { credential: cred } });
      if (r.status !== 200) throw new Error(`会话交换失败 ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
      this.sessions[which].set(r.json.session.sessionId);
      log.log(`会话交换 ${which} ok`);
    },
    async kernelCursor(cid) {
      const r = await request(this.base, `/api/jw/v2/customers/${cid}/workspace`, { session: this.biz() });
      return r.json?.eventCursor ?? null;
    },
    seqOf(cursorEventId) {
      const m = String(cursorEventId ?? '').match(/-(\d+)$/);
      return m ? m[1] : '0';
    },
  };

  const counters = {
    map: new Map(),
    record(ep, status, ms, ok) {
      let e = this.map.get(ep);
      if (!e) { e = { n: 0, ok: 0, expectedReject: 0, unexpected: 0, lat: [], status: {} }; this.map.set(ep, e); }
      e.n += 1; e.lat.push(ms); e.status[status] = (e.status[status] ?? 0) + 1;
      if (ok) e.ok += 1;
      else if ([400, 401, 403, 404, 405, 409, 502, 503].includes(status)) e.expectedReject += 1;
      else e.unexpected += 1;
      if (status === 401) ctx.needReauth = true;
    },
    mark(ep) { let e = this.map.get(ep); if (!e) { e = { n: 0, ok: 0, expectedReject: 0, unexpected: 0, lat: [], status: {} }; this.map.set(ep, e); } e.n += 1; e.ok += 1; },
    snapshot() {
      const out = {};
      for (const [ep, e] of this.map) out[ep] = { n: e.n, ok: e.ok, expectedReject: e.expectedReject, unexpected: e.unexpected, status: e.status, p50: pct(e.lat, 50), p95: pct(e.lat, 95), p99: pct(e.lat, 99), max: e.lat.length ? Math.max(...e.lat) : null };
      return out;
    },
  };
  const defectSeen = new Map();
  const defect = (kind, where, what, extra = {}) => {
    const key = `${kind}:${where}:${what}`;
    const c = (defectSeen.get(key) ?? 0) + 1;
    defectSeen.set(key, c);
    if (c <= 3) {
      results.defects.push({ at: iso(), phase: phaseId, kind, where, what, occurrences: c, ...extra });
      log.log(`[defect] ${kind} ${where}: ${what}（第${c}次）`);
    }
    return c;
  };

  await ctx.exchange('biz');
  await ctx.exchange('cust');

  // 4) 场景集（全部经 ctx.base 现取端口）
  const scaleCustomers = ['cust-a10', 'cust-a1000', 'cust-a10000', 'cust-mix', 'cust-m1000'];
  const EP = (ep, status, ms, ok) => counters.record(ep, status, ms, ok);
  const revokedNow = () => now() < ctx.revokeUntil;
  const sc = {};

  sc.healthz = { ep: 'healthz', async run() {
    const r = await request(ctx.base, '/healthz/live', {});
    EP('healthz', r.status, r.ms, r.status === 200 && r.json?.ok === true);
    if (ctx.rng() < 0.2) {
      const rr = await request(ctx.base, '/healthz/ready', {});
      const degraded = ctx.A.state.down || ctx.A.state.errorRate > 0 || ctx.A.state.latencyMs >= 5000;
      EP('healthz-ready', rr.status, rr.ms, rr.status === 200 && (degraded ? rr.json?.ok === false : rr.json?.ok === true));
    }
  } };
  sc.versionz = { ep: 'versionz', async run() {
    const r = await request(ctx.base, '/versionz', {});
    EP('versionz', r.status, r.ms, r.status === 200 && !!r.json?.buildId);
  } };
  sc.workspace = { ep: 'workspace', async run() {
    const cid = scaleCustomers[Math.floor(ctx.rng() * scaleCustomers.length)];
    const r = await request(ctx.base, `/api/jw/v2/customers/${cid}/workspace`, { session: ctx.biz() });
    const honest = r.status === 200 || r.status === 502 || r.status === 403 || r.status === 503;
    let inv = null;
    if (r.status === 200 && (r.json?.ok !== true || r.json?.customerId !== cid || r.json?.snapshot?.customer?.customerId !== cid)) inv = 'workspace 响应客户不匹配或结构缺失';
    EP('workspace', r.status, r.ms, honest && inv === null);
    if (inv) defect('INVARIANT', 'workspace', inv, { cid, status: r.status });
  } };
  sc.messages_get = { ep: 'messages-get', async run() {
    const audience = ctx.rng() < 0.5 ? 'customer' : '';
    const after = ctx.rng() < 0.4 ? Math.floor(ctx.rng() * 80) : null;
    const q = new URLSearchParams({ limit: '50', ...(audience ? { audience } : {}), ...(after !== null ? { after: String(after) } : {}) });
    const r = await request(ctx.base, `/api/jw/v2/customers/cust-mix/messages`, { session: ctx.biz(), query: q.toString() });
    let inv = null;
    if (r.status === 200) {
      const msgs = r.json?.messages ?? [];
      if (after !== null && msgs.some((m) => m.seq <= after)) inv = '增量读取返回 seq<=after';
      if (new Set(msgs.map((m) => m.messageId)).size !== msgs.length) inv = inv ?? 'messageId 页内重复';
    }
    EP('messages-get', r.status, r.ms, (r.status === 200 || r.status === 502 || r.status === 403) && inv === null);
    if (inv) defect('INVARIANT', 'messages-get', inv, { after, status: r.status });
  } };
  sc.messages_neg_internal = { ep: 'messages-neg', async run() {
    const r = await request(ctx.base, `/api/jw/v2/customers/cust-mix/messages`, { session: ctx.cust(), query: 'audience=internal' });
    EP('messages-neg', r.status, r.ms, r.status === 403);
    if (r.status !== 403) defect('LEAK', 'messages-neg', `客户身份读内部受众未403（got ${r.status}）`, {});
  } };
  sc.activity_first = { ep: 'activity-first', async run() {
    const cid = scaleCustomers[Math.floor(ctx.rng() * scaleCustomers.length)];
    const r = await request(ctx.base, `/api/jw/v2/customers/${cid}/activity`, { session: ctx.biz(), query: 'limit=30' });
    let inv = null;
    if (r.status === 200) {
      const items = r.json?.items ?? [];
      if (items.some((i) => i.customerId !== cid)) inv = 'activity 返回非请求客户条目（跨客户泄漏）';
      if (new Set(items.map((i) => i.activityId)).size !== items.length) inv = inv ?? 'activityId 页内重复';
      const bySrc = {};
      for (const it of items) (bySrc[it.source] ??= []).push(it._ck);
      for (const [s, cks] of Object.entries(bySrc)) {
        if (s !== 'model_receipt' && cks.some((v, i) => i > 0 && Number(v) < Number(cks[i - 1]))) inv = inv ?? `${s} 页内降序`;
      }
    }
    EP('activity-first', r.status, r.ms, (r.status === 200 || r.status === 502 || r.status === 403) && inv === null);
    if (inv) defect('INVARIANT', 'activity-first', inv, { cid, status: r.status });
  } };
  sc.activity_walk = { ep: 'activity-walk', async run() {
    const cid = ctx.rng() < 0.5 ? 'cust-mix' : 'cust-a1000';
    let cursor = null; const seen = new Set(); let pages = 0; let inv = null;
    for (; pages < 8; pages++) {
      const q = new URLSearchParams({ limit: '40', ...(cursor ? { cursor } : {}) });
      const r = await request(ctx.base, `/api/jw/v2/customers/${cid}/activity`, { session: ctx.biz(), query: q.toString() });
      EP('activity-walk', r.status, r.ms, r.status === 200 || r.status === 403);
      if (r.status !== 200) break;
      for (const it of r.json.items) {
        if (seen.has(it.activityId)) inv = inv ?? `跨页重复 activityId=${it.activityId}`;
        seen.add(it.activityId);
        if (it.customerId !== cid) inv = inv ?? '跨客户条目泄漏';
      }
      if (r.json.nextCursor === null) break;
      cursor = r.json.nextCursor;
      await sleep(30);
    }
    if (inv) defect('INVARIANT', 'activity-walk', inv, { cid, pages });
  } };
  sc.events_page = { ep: 'events-page', async run() {
    const cid = scaleCustomers[Math.floor(ctx.rng() * scaleCustomers.length)];
    const total = cid === 'cust-a10000' ? 10000 : cid === 'cust-a1000' ? 1000 : cid === 'cust-a10' ? 10 : 0;
    const mode = ctx.rng();
    let after = '0';
    if (total > 0 && mode < 0.3) after = String(total - 100);
    else if (total > 0 && mode < 0.6) after = String(Math.floor(ctx.rng() * total));
    const r = await request(ctx.base, `/api/jw/v2/customers/${cid}/events-page`, { session: ctx.biz(), query: `afterSeq=${after}&limit=200` });
    let inv = null;
    if (r.status === 200) {
      const evs = r.json?.events ?? [];
      if (evs.some((e) => BigInt(e.aggregateVersion) <= BigInt(after))) inv = 'events-page 返回 seq<=afterSeq';
      if (new Set(evs.map((e) => e.eventId)).size !== evs.length) inv = inv ?? '页内 eventId 重复';
      if (r.json.hasMore === true && evs.length !== r.json.limit) inv = inv ?? 'hasMore 与页满不一致';
    }
    EP('events-page', r.status, r.ms, (r.status === 200 || r.status === 502 || r.status === 403) && inv === null);
    if (inv) defect('INVARIANT', 'events-page', inv, { cid, after });
  } };
  sc.events_walk_full = { ep: 'events-walk', async run() {
    const cid = 'cust-a1000';
    let after = '0'; const seen = new Set(); let n = 0; let inv = null; let prev = -1n;
    for (let page = 0; page < 12; page++) {
      const r = await request(ctx.base, `/api/jw/v2/customers/${cid}/events-page`, { session: ctx.biz(), query: `afterSeq=${after}&limit=200` });
      if (page === 0) EP('events-walk', r.status, r.ms, r.status === 200 || r.status === 403); else counters.mark('events-walk');
      if (r.status !== 200) break;
      for (const e of r.json.events) {
        n++; if (seen.has(e.eventId)) inv = inv ?? '全量走读重复 eventId';
        seen.add(e.eventId);
        const s = BigInt(e.aggregateVersion);
        if (prev !== -1n && s !== prev + 1n) inv = inv ?? `seq 断档 ${prev}->${s}`;
        prev = s;
      }
      if (r.json.hasMore !== true) break;
      after = r.json.nextAfterSeq;
    }
    if (inv) defect('INVARIANT', 'events-walk', inv, { cid, n });
  } };
  sc.neg_invalid_cursor = { ep: 'neg-cursor', async run() {
    const r = await request(ctx.base, `/api/jw/v2/customers/cust-mix/activity`, { session: ctx.biz(), query: `cursor=${encodeURIComponent('garbage!!')}` });
    EP('neg-cursor', r.status, r.ms, r.status === 400 && r.json?.error === 'INVALID_CURSOR');
    if (r.status !== 400) defect('LEAK', 'neg-cursor', `非法游标未400（got ${r.status}）`, {});
  } };
  sc.neg_cross_tenant = { ep: 'neg-cross', async run() {
    const r1 = await request(ctx.base, `/api/jw/v2/customers/cust-other/activity`, { session: ctx.biz(), query: 'limit=5' });
    const r2 = await request(ctx.base, `/api/jw/v2/customers/cust-a10/workspace`, { session: ctx.cust() });
    EP('neg-cross', r1.status, r1.ms, revokedNow() ? r1.status === 403 : r1.status === 404);
    EP('neg-cross', r2.status, r2.ms, r2.status === 404);
    if (!revokedNow() && (r1.status !== 404 || r2.status !== 404)) defect('LEAK', 'neg-cross', `跨客户未404（activity=${r1.status} workspace=${r2.status}）`, {});
  } };
  sc.neg_sources = { ep: 'neg-sources', async run() {
    const r = await request(ctx.base, `/api/jw/v2/customers/cust-mix/activity`, { session: ctx.biz(), query: 'sources=bogus' });
    EP('neg-sources', r.status, r.ms, r.status === 400);
  } };
  sc.neg_customer_receipt = { ep: 'neg-receipt', async run() {
    const r = await request(ctx.base, `/api/jw/v2/customers/cust-mix/activity`, { session: ctx.cust(), query: 'sources=model_receipt' });
    EP('neg-receipt', r.status, r.ms, r.status === 403 && r.json?.error === 'ACTIVITY_SOURCE_FORBIDDEN');
    if (r.status !== 403) defect('LEAK', 'neg-receipt', `客户身份读模型回执未403（got ${r.status}）`, {});
  } };
  sc.activity_customer_view = { ep: 'activity-cust', async run() {
    const r = await request(ctx.base, `/api/jw/v2/customers/cust-mix/activity`, { session: ctx.cust(), query: 'limit=30' });
    let inv = null;
    if (r.status === 200) {
      if (r.json.items.some((i) => i.source === 'model_receipt')) inv = '客户视图混入模型回执';
      if (r.json.items.some((i) => i.source === 'thread' && i.refs?.audience === 'internal')) inv = inv ?? '客户视图混入内部消息';
    }
    EP('activity-cust', r.status, r.ms, (r.status === 200 || r.status === 502) && inv === null);
    if (inv) defect('LEAK', 'activity-cust', inv, {});
  } };
  sc.audit_read = { ep: 'audit-read', async run() {
    const r = await request(ctx.base, `/api/jw/v2/audit`, { session: ctx.biz(), query: 'limit=10' });
    EP('audit-read', r.status, r.ms, r.status === 200 && Array.isArray(r.json?.entries));
  } };
  sc.neg_method = { ep: 'neg-method', async run() {
    const r = await request(ctx.base, `/api/jw/v2/customers/cust-mix/activity`, { method: 'POST', session: ctx.biz(), body: {} });
    EP('neg-method', r.status, r.ms, r.status === 405);
  } };
  sc.sse_cycle = { ep: 'sse-cycle', sse: true, async run() {
    const cur = await ctx.kernelCursor('cust-mix');
    const r = await sseOpen(ctx.base, `/api/jw/v2/customers/cust-mix/events`, { session: ctx.biz(), cursor: cur, holdMs: 4000 + Math.floor(ctx.rng() * 4000) });
    const authExpected = revokedNow();
    EP('sse-cycle', r.status, r.ms, r.status === 200 && (authExpected ? r.authSeen : !r.authSeen));
    let inv = null;
    if (r.status === 200 && !authExpected) {
      for (const f of r.frames) {
        if (f.event === 'business' && f.data?.payloadRef?.seq && cur) {
          if (BigInt(f.data.payloadRef.seq) <= BigInt(ctx.seqOf(cur))) inv = inv ?? '回放含游标之前事件';
        }
        if (f.event === 'resync') inv = inv ?? '无裁剪/重启却收到 resync';
      }
    }
    if (inv) defect('INVARIANT', 'sse-cycle', inv, { cursor: cur, frames: r.frames.map((f) => `${f.event}:${f.id ?? f.data?.eventCursor ?? f.data?.payloadRef?.seq ?? ''}`).join('|') });
  } };
  sc.sse_reconnect = { ep: 'sse-reconnect', sse: true, async run() {
    const r1 = await sseOpen(ctx.base, `/api/jw/v2/customers/cust-mix/events`, { session: ctx.biz(), holdMs: 2500 });
    if (r1.status !== 200 || r1.authSeen) { EP('sse-reconnect', r1.status, r1.ms, revokedNow() ? r1.authSeen : r1.status === 200); return; }
    const lastId = r1.frames.filter((f) => f.event === 'business').at(-1)?.id ?? r1.firstCursor;
    const r2 = await sseOpen(ctx.base, `/api/jw/v2/customers/cust-mix/events`, { session: ctx.biz(), lastEventId: lastId, holdMs: 2500 });
    const okr = revokedNow() ? r2.authSeen : (r2.status === 200 && !r2.resyncSeen);
    EP('sse-reconnect', r2.status, r2.ms, okr);
    if (!revokedNow() && r2.resyncSeen) defect('INVARIANT', 'sse-reconnect', '有效游标重连被判过期 resync', { lastId });
  } };
  sc.sse_hold_long = { ep: 'sse-hold', sse: true, async run() {
    const r = await sseOpen(ctx.base, `/api/jw/v2/customers/cust-mix/events`, { session: ctx.biz(), holdMs: 15000 + Math.floor(ctx.rng() * 10000) });
    EP('sse-hold', r.status, r.ms, r.status === 200 && (revokedNow() ? r.authSeen : !r.authSeen));
  } };
  sc.thread_post = { ep: 'thread-post', write: true, async run() {
    const n = ++ctx.postSeq;
    const r = await request(ctx.base, `/api/jw/v2/customers/cust-mix/messages`, { method: 'POST', session: ctx.biz(), body: { requestId: `soak-post-${n}`, audience: ctx.rng() < 0.3 ? 'internal' : 'customer', text: `soak 周转消息 #${n}` } });
    EP('thread-post', r.status, r.ms, r.status === 200 || r.status === 409 || (revokedNow() && r.status === 403));
  } };

  const WEIGHTS = {
    P1: { healthz: 8, versionz: 5, workspace: 18, messages_get: 12, activity_first: 16, events_page: 14, neg_invalid_cursor: 4, neg_cross_tenant: 4, audit_read: 4, neg_method: 3, sse_cycle: 6, activity_customer_view: 6 },
    P2: { healthz: 4, workspace: 12, messages_get: 10, activity_first: 12, activity_walk: 10, events_page: 10, events_walk_full: 4, neg_invalid_cursor: 3, neg_cross_tenant: 3, neg_customer_receipt: 3, activity_customer_view: 5, sse_cycle: 6, sse_reconnect: 5, thread_post: 8, audit_read: 2, neg_method: 2 },
    P3: { healthz: 3, workspace: 10, messages_get: 8, activity_first: 10, activity_walk: 10, events_page: 12, events_walk_full: 6, neg_invalid_cursor: 3, neg_cross_tenant: 3, neg_customer_receipt: 3, sse_cycle: 6, sse_reconnect: 5, thread_post: 6, neg_sources: 3 },
    P4: { healthz: 2, workspace: 10, messages_get: 8, activity_first: 10, events_page: 10, activity_walk: 8, neg_invalid_cursor: 2, neg_cross_tenant: 2, neg_customer_receipt: 2, sse_cycle: 10, sse_reconnect: 10, sse_hold_long: 8, thread_post: 6, neg_sources: 2, neg_method: 2 },
    P5: { healthz: 6, workspace: 12, messages_get: 10, activity_first: 12, events_page: 12, neg_invalid_cursor: 3, neg_cross_tenant: 3, sse_cycle: 8, thread_post: 6, audit_read: 3 },
    P6: { healthz: 3, workspace: 10, messages_get: 9, activity_first: 10, activity_walk: 9, events_page: 10, events_walk_full: 5, neg_invalid_cursor: 3, neg_cross_tenant: 3, neg_customer_receipt: 3, activity_customer_view: 5, sse_cycle: 7, sse_reconnect: 6, sse_hold_long: 4, thread_post: 7, neg_sources: 2, neg_method: 2, audit_read: 2 },
    P7: { healthz: 4, versionz: 3, workspace: 14, messages_get: 11, activity_first: 13, activity_walk: 9, events_page: 12, neg_invalid_cursor: 3, neg_cross_tenant: 3, neg_customer_receipt: 3, activity_customer_view: 6, sse_cycle: 6, thread_post: 6, audit_read: 2, neg_method: 2 },
  };
  const weights = WEIGHTS[phaseId] ?? WEIGHTS.P1;
  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);
  const pick = () => { let x = ctx.rng() * weightSum; for (const [k, w] of Object.entries(weights)) { x -= w; if (x <= 0) return k; } return Object.keys(weights)[0]; };

  const bucket = createBucket();
  const sseActive = { n: 0 };
  const deadline = t0 + mins * 60_000;
  let stopped = false;
  const workers = [];
  for (let w = 0; w < plan.conc; w++) {
    workers.push((async () => {
      while (!stopped && now() < deadline) {
        if (ctx.needReauth) { ctx.needReauth = false; await ctx.exchange('biz').catch(() => { }); await ctx.exchange('cust').catch(() => { }); }
        const name = pick();
        const scenario = sc[name];
        if (!scenario) { await sleep(50); continue; }
        if (scenario.sse && sseActive.n >= SSE_MAX_CONCURRENT) { await sleep(500); continue; }
        try {
          await bucket.take();
          if (scenario.sse) { sseActive.n += 1; try { await scenario.run(); } finally { sseActive.n -= 1; } }
          else await scenario.run();
        } catch (e) {
          defect('WORKER-ERROR', name, String(e.message || e).slice(0, 200), {});
          await sleep(1000);
        }
      }
    })());
  }

  // 5) 数据演进与故障 ch urn（调度器）
  const churnJobs = [];
  const schedule = (everyMs, fn, label) => { const j = setInterval(() => { Promise.resolve().then(fn).catch((e) => log.log(`[churn:${label}] ${e.message}`)); }, everyMs); churnJobs.push(j); return j; };
  let churnSeq = 20000;

  schedule(150_000, async () => { // 晚到事件：旧时间新 seq → 尾页必见
    const cid = 'cust-mix';
    churnSeq += 1;
    A.addEvents(cid, [{ eventId: `${cid}-late-${churnSeq}`, seq: String(churnSeq), at: '2026-09-01T00:00:00.000Z', eventType: 'LATE_ARRIVAL_SOAK', payload: { note: `late-${churnSeq}` } }]);
    const r = await request(ctx.base, `/api/jw/v2/customers/${cid}/events-page`, { session: ctx.biz(), query: `afterSeq=${churnSeq - 1}&limit=50` });
    const got = (r.json?.events ?? []).some((e) => e.eventId === `${cid}-late-${churnSeq}`);
    counters.record('churn-late', got ? 200 : 500, r.ms, got);
    if (!got) defect('INVARIANT', 'churn-late', '晚到事件追加后尾页未读回', { seq: churnSeq });
  }, 'late');

  schedule(240_000, async () => { // 重复事件：重投最近已投递事件（同 eventId 同 seq）→ activity 条目数不变
    const cid = 'cust-mix';
    const r0 = await request(ctx.base, `/api/jw/v2/customers/${cid}/activity`, { session: ctx.biz(), query: 'sources=kernel&limit=200' });
    const before = r0.json?.items?.length ?? -1;
    const last = (r0.json?.items ?? []).at(-1);
    if (!last || before <= 0) return; // 尚无已投递 kernel 事件：本轮跳过（首个晚到事件落地后再重投）
    const dupId = last.sourceRecordId;
    A.addEvents(cid, [{ eventId: dupId, seq: last.refs?.seq ?? '1', at: '2026-09-01T00:01:00.000Z', eventType: 'INSPECTION_CREATED', payload: {} }]);
    await sleep(700);
    const r1 = await request(ctx.base, `/api/jw/v2/customers/${cid}/activity`, { session: ctx.biz(), query: 'sources=kernel&limit=200' });
    const items1 = r1.json?.items ?? [];
    // 断言去重本身（容忍并发 churn-late 在 700ms 窗口内追加的至多 1 条新事件）
    const dupCount = items1.filter((i) => i.sourceRecordId === dupId).length;
    const delta = items1.filter((i) => i.sourceRecordId !== dupId).length - (before - 1);
    const okDup = dupCount === 1 && delta <= 0;
    counters.record('churn-dup', r1.status, r1.ms, okDup);
    if (!okDup) defect('INVARIANT', 'churn-dup', `重复 eventId 去重异常：dup出现${dupCount}次/额外新增${delta}`, { dupId });
  }, 'dup');

  schedule(210_000, async () => { // 同ID回执终态：intent unknown → terminal failed
    const rid = `soak-rcpt-${phaseId}-${Date.now()}`;
    const { writeFile: wf, mkdir: md } = await import('node:fs/promises');
    const dir = path.join(runFiles.receipts, 'receipts');
    await md(dir, { recursive: true });
    const writeR = (name, rec) => wf(path.join(dir, `${encodeURIComponent(name)}.json`), JSON.stringify(rec));
    await writeR(`${rid}:intent`, { requestId: rid, customerId: 'cust-mix', tenantId: 'tenant-soak', assistant: 'credit', contextVersion: 'soak-v1', receiptVersion: 2, phase: 'intent', at: iso() });
    await sleep(300);
    const r1 = await request(ctx.base, `/api/jw/v2/customers/cust-mix/activity`, { session: ctx.biz(), query: 'sources=model_receipt&limit=50' });
    const st1 = r1.json?.items?.find((i) => i.sourceRecordId === rid)?.state;
    await writeR(rid, { requestId: rid, customerId: 'cust-mix', tenantId: 'tenant-soak', assistant: 'credit', contextVersion: 'soak-v1', receiptVersion: 2, configHash: 'soak', contextHash: 'soak', phase: 'terminal', at: iso(), outcome: { status: 'failed', sentFlag: false, findings: [], questions: [], evidenceRefs: [], usage: { totalTokens: 1 } } });
    await sleep(300);
    const r2 = await request(ctx.base, `/api/jw/v2/customers/cust-mix/activity`, { session: ctx.biz(), query: 'sources=model_receipt&limit=50' });
    const st2 = r2.json?.items?.find((i) => i.sourceRecordId === rid)?.state;
    const okst = st1 === 'unknown' && st2 === 'failed';
    counters.record('churn-receipt', r2.status, r2.ms, okst);
    if (!okst) defect('INVARIANT', 'churn-receipt', `同ID回执终态演进异常 intent=${st1} terminal=${st2}`, { rid });
  }, 'receipt');

  if (phaseId === 'P3' || phaseId === 'P6') {
    schedule(300_000, async () => { // 撤权窗口：撤→403→复权→200
      ctx.revokeUntil = now() + 10_000;
      A.state.revoked.add(CRED.biz);
      log.log('[churn:revoke] 撤权窗口开始（预期 403/auth）');
      await sleep(3000);
      const r1 = await request(ctx.base, `/api/jw/v2/customers/cust-mix/activity`, { session: ctx.biz(), query: 'limit=5' });
      counters.record('churn-revoke', r1.status, r1.ms, r1.status === 403);
      if (r1.status !== 403) defect('LEAK', 'churn-revoke', `撤权窗口内未403（got ${r1.status}）`, {});
      await sleep(7000);
      A.state.revoked.delete(CRED.biz);
      await sleep(1500);
      const r2 = await request(ctx.base, `/api/jw/v2/customers/cust-mix/activity`, { session: ctx.biz(), query: 'limit=5' });
      counters.record('churn-revoke', r2.status, r2.ms, r2.status === 200);
      if (r2.status !== 200) defect('INVARIANT', 'churn-revoke', `复权后未恢复200（got ${r2.status}）`, {});
      ctx.revokeUntil = 0;
      log.log('[churn:revoke] 撤权窗口结束（已复权）');
    }, 'revoke');
  }
  if (phaseId === 'P4' || phaseId === 'P6') {
    schedule(420_000, async () => { // SSE 订阅中撤权 → auth 帧 + 断开
      ctx.revokeUntil = now() + 15_000;
      const holder = sseOpen(ctx.base, `/api/jw/v2/customers/cust-a10/events`, { session: ctx.biz(), holdMs: 60_000 });
      await sleep(2500);
      A.state.revoked.add(CRED.biz);
      const r = await holder;
      A.state.revoked.delete(CRED.biz);
      counters.record('churn-sse-revoke', r.status, r.ms, r.authSeen === true);
      if (!r.authSeen) defect('INVARIANT', 'churn-sse-revoke', '订阅中撤权未收到 auth 帧', { frames: r.frames.map((f) => f.event).join(',') });
      else log.log('[churn:sse-revoke] 撤权断流验证通过');
      await sleep(2500);
      ctx.revokeUntil = 0;
    }, 'sse-revoke');
  }

  // 慢客户端背压（P4 一次）：暂停消费 + 一次 1500 事件 → 期望 resync(slow_client_overflow)
  const slowClient = async () => {
    log.log('[slow-client] 开始：暂停消费 + 追加 1500 事件');
    const holder = sseOpen(ctx.base, `/api/jw/v2/customers/cust-a10/events`, { session: ctx.biz(), holdMs: 45_000 });
    await sleep(2000);
    const batch = [];
    for (let i = 1; i <= 1500; i++) batch.push({ eventId: `cust-a10-burst-${churnSeq + i}`, seq: String(5000 + churnSeq + i), at: iso(), eventType: 'BURST_SOAK', payload: { note: `burst ${i}`, pad: 'x'.repeat(120) } });
    churnSeq += 1500;
    A.addEvents('cust-a10', batch);
    const r = await holder;
    const observed = { at: iso(), phase: phaseId, resyncSeen: r.resyncSeen, slowOverflow: r.slowOverflow, frames: r.frames.length, authSeen: r.authSeen, closedWhy: r.why };
    results.slowClient.push(observed);
    log.log(`[slow-client] 结果 ${JSON.stringify(observed)}`);
    counters.record('slow-client', 200, r.ms, true);
    await saveResults(results);
    if (!r.resyncSeen) defect('INVARIANT', 'slow-client', '慢客户端未触发服务端 resync/背压处置', { closedWhy: r.why });
  };
  if (phaseId === 'P4') setTimeout(() => slowClient().catch((e) => log.log(`[slow-client] ${e.message}`)), 8 * 60_000);

  // 故障窗口（P5）
  if (phaseId === 'P5') {
    const restartEdge = async (hard) => {
      const cursorBefore = await ctx.kernelCursor('cust-a10').catch(() => null);
      const msgBefore = await request(ctx.base, `/api/jw/v2/customers/cust-mix/messages`, { session: ctx.biz(), query: 'limit=1' });
      const cursorMsgBefore = msgBefore.json?.cursor;
      if (hard) { try { edge.child.kill('SIGKILL'); } catch { } }
      else { try { edge.child.send({ cmd: 'shutdown' }); } catch { } await sleep(4000); try { edge.child.kill('SIGKILL'); } catch { } }
      await sleep(2500);
      edge = await forkEdge();
      ctx.base = `http://127.0.0.1:${edge.port}`;
      await ctx.exchange('biz'); await ctx.exchange('cust'); // 新进程内存会话失效：立即重换
      const rMsg = await request(ctx.base, `/api/jw/v2/customers/cust-mix/messages`, { session: ctx.biz(), query: 'limit=1' });
      const msgPersisted = rMsg.status === 200 && rMsg.json?.cursor === cursorMsgBefore;
      const rHealth = await request(ctx.base, `/healthz/live`, {});
      const rr = cursorBefore ? await sseOpen(ctx.base, `/api/jw/v2/customers/cust-a10/events`, { session: ctx.biz(), cursor: cursorBefore, holdMs: 8000 }) : { resyncSeen: null };
      const entry = { at: iso(), phase: phaseId, hard, healthz: rHealth.status === 200, messagesCursorPreserved: msgPersisted, oldCursorResync: rr.resyncSeen, resyncReason: rr.frames?.find((f) => f.event === 'resync')?.data?.reason ?? null };
      results.edgeRestarts.push(entry);
      log.log(`[restart:${hard ? 'hard' : 'graceful'}] ${JSON.stringify(entry)}`);
      counters.record('edge-restart', rHealth.status, rHealth.ms, entry.healthz && msgPersisted === true);
      if (!msgPersisted) defect('DURABILITY', 'edge-restart', `重启后线程游标不一致 before=${cursorMsgBefore} after=${rMsg.json?.cursor}`, {});
      if (cursorBefore && !rr.resyncSeen) defect('INVARIANT', 'edge-restart', '重启后旧游标未触发 resync（可能静默续播）', {});
      await saveResults(results);
      return true;
    };
    const successProbe = async () => {
      for (let i = 0; i < 20; i++) {
        const r = await request(ctx.base, `/api/jw/v2/customers/cust-a10/workspace`, { session: ctx.biz() });
        if (r.status === 200) return true;
        await sleep(1000);
      }
      return false;
    };
    const fault = async (label, applyMs, inject, verify) => {
      const start = now();
      log.log(`[fault:${label}] 注入开始`);
      inject(true);
      await sleep(applyMs);
      inject(false);
      const recoverStart = now();
      const recovered = await verify();
      results.faultWindows.push({ label, phase: phaseId, start: iso(start), applyMs, recoveryMs: now() - recoverStart, recovered });
      log.log(`[fault:${label}] 恢复耗时 ${now() - recoverStart}ms recovered=${recovered}`);
      await saveResults(results);
    };
    setTimeout(() => fault('a-down', 20_000, (on) => { A.state.down = on; }, successProbe).catch((e) => log.log(`[fault] ${e.message}`)), 2 * 60_000);
    setTimeout(() => fault('a-latency-timeout', 25_000, (on) => { A.state.latencyMs = on ? 6000 : 0; }, async () => { A.state.latencyMs = 0; return successProbe(); }).catch((e) => log.log(`[fault] ${e.message}`)), 6 * 60_000);
    setTimeout(() => fault('a-5xx', 25_000, (on) => { A.state.errorRate = on ? 0.5 : 0; }, successProbe).catch((e) => log.log(`[fault] ${e.message}`)), 10 * 60_000);
    setTimeout(() => restartEdge(false).catch((e) => log.log(`[restart] ${e.message}`)), 14 * 60_000);
    setTimeout(() => restartEdge(true).catch((e) => log.log(`[restart] ${e.message}`)), 20 * 60_000);
  }

  // 6) 采样器（60s 宿主资源；5min 窗口聚合）
  const metricsPath = path.join(STATE, 'host-metrics.jsonl');
  let lastCpu = os.cpus().map((c) => ({ user: c.times.user, sys: c.times.sys, idle: c.times.idle }));
  let lastCpuT = now();
  const sampler = setInterval(() => {
    Promise.resolve().then(async () => {
      const mem = process.memoryUsage();
      const fs_ = await statfs(RUN_DIR).catch(() => null);
      const cpus = os.cpus();
      const t = now();
      const total = cpus.reduce((a, c, i) => a + (c.times.user - (lastCpu[i]?.user ?? 0)) + (c.times.sys - (lastCpu[i]?.sys ?? 0)) + (c.times.idle - (lastCpu[i]?.idle ?? 0)), 0);
      const busy = cpus.reduce((a, c, i) => a + (c.times.user - (lastCpu[i]?.user ?? 0)) + (c.times.sys - (lastCpu[i]?.sys ?? 0)), 0);
      lastCpu = cpus.map((c) => ({ user: c.times.user, sys: c.times.sys, idle: c.times.idle }));
      lastCpuT = t;
      const row = {
        ts: iso(), driverRss: mem.rss, hostFreeMem: os.freemem(), hostTotalMem: os.totalmem(),
        hostCpuPct: total > 0 ? Number(((busy / total) * 100).toFixed(1)) : null,
        diskFree: fs_ ? Number(fs_.bfree * fs_.bsize) : null,
        runDirBytes: await dirSize(RUN_DIR), sseActive: sseActive.n,
      };
      await appendFile(metricsPath, `${JSON.stringify(row)}\n`);
      if (os.freemem() < 2e9 || os.freemem() < os.totalmem() * 0.1) { RATE_FACTOR = 0.5; log.log('[guard] 可用内存<2GB/10%：桶速率降至50%'); }
      else RATE_FACTOR = 1;
    }).catch(() => { });
  }, 60_000);

  const windowsPath = path.join(STATE, `windows-${phaseId}.jsonl`);
  let lastWindowT = t0;
  const winTimer = setInterval(() => {
    Promise.resolve().then(async () => {
      const snap = counters.snapshot();
      const row = { ts: iso(), phase: phaseId, windowSec: Math.round((now() - lastWindowT) / 1000), byEp: snap };
      lastWindowT = now();
      await appendFile(windowsPath, `${JSON.stringify(row)}\n`);
      await saveResults(results);
      const totN = Object.values(snap).reduce((a, e) => a + e.n, 0);
      const totU = Object.values(snap).reduce((a, e) => a + e.unexpected, 0);
      log.log(`[window] 累计请求=${totN} 累计非预期=${totU}`);
    }).catch(() => { });
  }, 300_000);

  // 7) 等相位结束 → 收尾
  await sleep(Math.max(1000, deadline - now()));
  stopped = true;
  await Promise.allSettled(workers);
  for (const j of churnJobs) clearInterval(j);
  clearInterval(sampler); clearInterval(winTimer);

  await sleep(3000); // 静止窗口：等待连接释放
  const metricTail = (await readFile(runFiles.metrics, 'utf8').catch(() => '')).trim().split('\n').slice(-2).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  log.log(`[close] Edge 尾部指标 conns=${metricTail.at(-1)?.serverConns} handles=${metricTail.at(-1)?.activeHandles} rss=${metricTail.at(-1)?.rss}`);

  try { edge.child.send({ cmd: 'shutdown' }); } catch { }
  await sleep(3000);
  try { edge.child.kill('SIGKILL'); } catch { }
  await A.close();

  const phaseResult = {
    id: phaseId, title: plan.title, startedAt: iso(t0), endedAt: iso(), seconds: Math.round((now() - t0) / 1000),
    plannedMinutes: mins, concurrency: plan.conc, byEndpoint: counters.snapshot(),
    defectsInPhase: results.defects.filter((d) => d.phase === phaseId).length,
    edgeTail: metricTail.at(-1) ?? null,
  };
  results.phases[phaseId] = phaseResult;
  results.endedAt = iso();
  await saveResults(results);
  log.log(`=== 相位 ${phaseId} 结束：${phaseResult.seconds}s，缺陷条目 ${phaseResult.defectsInPhase} ===`);
  log.close();
  return phaseResult;
}

// ---- CLI ----
const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const phaseId = ARG.phase ?? null;
  const order = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];
  (async () => {
    if (ARG.plan === 'full') { for (const p of order) await runPhase(p); }
    else if (phaseId) await runPhase(String(phaseId), { minutes: ARG.minutes ? Number(ARG.minutes) : null, fresh: ARG['fresh-copy'] === true });
    else { console.error('用法：--phase <P1..P7> [--minutes N] [--fresh-copy] | --plan full'); process.exit(2); }
    process.exit(0);
  })().catch((e) => { console.error(`[driver] 致命：${e.stack || e.message}`); process.exit(1); });
}
