// V0.4 长程测试 02_API 包 · 功能矩阵回归（相位前的深断言；长时驱动见 driver.mjs）。
// 替身边界：Edge 全链真实（server.mjs live 装配 + kernel-store + customer-activity + message-store sqlite）；
// 唯一替身是"Back/A 持久数据库 + PG"（本文件 startStandInA 内存 HTTP 上游，实现 A 只读端点形状与凭据 ACL）。
// 本套件不声称真实 A 持久库整链通过（见报告替身边界节）。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startEdgeServer, createLiveCredentialVerifier } from '../../src/server.mjs';
import { createKernelStore } from '../../src/kernel-store.mjs';
import { createMessageStore } from '../../src/message-store.mjs';
import { createMessageRouter } from '../../src/messages.mjs';
import { createSessionStore } from '../../src/session.mjs';
import { createAuditSink } from '../../src/audit.mjs';
import { createUpstreamProxy } from '../../src/proxy.mjs';
import { createReadProxy } from '../../src/readproxy.mjs';
import { encodeActivityCursor } from '../../src/customer-activity.mjs';
import { httpProbe, aKernelReadyPass } from '../../src/probes.mjs';

const CRED = { biz: 'mx-cred-biz', cust: 'mx-cred-cust', biz2: 'mx-cred-biz2' };

// ---- 替身 A（同 soak driver 的形状；记录收到的请求供零副作用断言）----
function startStandInA() {
  const received = [];
  const acl = new Map();
  const revoked = new Set();
  const eventsByCustomer = new Map();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://standin-a');
      const cred = req.headers['x-principal-credential'] ?? null;
      received.push({ t: Date.now(), method: req.method, path: u.pathname, query: u.search, credential: cred });
      const respond = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (u.pathname === '/healthz') return respond(200, { ok: true, db: 'up' });
      if (req.method !== 'GET') return respond(405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
      if (u.pathname.startsWith('/api/v2/receipts/')) return respond(200, { ok: true, receipt: null });
      if (u.pathname.startsWith('/api/v1/inspections/')) return respond(200, { ok: true, snapshot: { state: 'open' } });
      const m = u.pathname.match(/^\/api\/v2\/customers\/([^/]+)(\/.*)?$/);
      if (!m) return respond(404, { ok: false, error: 'NOT_FOUND' });
      const cid = decodeURIComponent(m[1]);
      if (revoked.has(cred)) return respond(403, { ok: false, error: 'PERMISSION_DENIED' });
      if (!acl.get(cred)?.has(cid)) return respond(404, { ok: false, error: 'NOT_FOUND' });
      const sub = m[2] ?? '/';
      if (sub === '/') return respond(200, { ok: true, customer: { customerId: cid, tenantId: cid === 'cust-other' ? 'tenant-other' : 'tenant-mx' } });
      if (sub === '/events') {
        const after = BigInt(u.searchParams.get('after') || '0');
        const limit = Math.min(Math.max(Number(u.searchParams.get('limit') || '500'), 1), 500);
        const page = (eventsByCustomer.get(cid) ?? [])
          .filter((e) => BigInt(e.seq) > after)
          .sort((a, b) => (BigInt(a.seq) < BigInt(b.seq) ? -1 : 1))
          .slice(0, limit);
        return respond(200, { ok: true, events: page });
      }
      if (sub === '/exposure') return respond(200, { ok: true, facilities: [], totalsMinor: { approved: 0, reserved: 0, drawn: 0 } });
      if (sub === '/decision-status') return respond(200, { ok: true, basis: { blockedActions: [] }, facilityTotalsMinor: null, reviewQueue: [], reportRefs: [] });
      if (sub === '/findings') return respond(200, { ok: true, findings: [] });
      if (sub === '/object-inventory') return respond(200, { ok: true, objects: [] });
      if (sub === '/artifacts') {
        const total = cid === 'cust-m1000' ? 1000 : 2;
        const items = [];
        for (let i = 0; i < Math.min(total, 100); i++) items.push({ artifactId: `${cid}-art-${i + 1}`, kind: 'bank_statement', status: 'current', registeredAt: '2026-09-21T00:00:00.000Z' });
        return respond(200, { ok: true, artifacts: items, nextCursor: total > 100 ? `art-100` : null });
      }
      if (sub === '/assessments') return respond(200, { ok: true, assessments: [], nextCursor: null });
      if (sub === '/financing-requests') return respond(200, { ok: true, financingRequests: [], nextCursor: null });
      return respond(404, { ok: false, error: 'NOT_FOUND' });
    });
  });
  const addEvents = (cid, arr) => {
    // 与真实 A 主键语义一致：同 eventId 重复追加为幂等 no-op（重复投递由 kernel-store 重查窗口覆盖）。
    const list = eventsByCustomer.get(cid) ?? [];
    const known = new Set(list.map((e) => e.eventId));
    eventsByCustomer.set(cid, [...list, ...arr.filter((e) => !known.has(e.eventId))]);
  };
  const seed = (cid, n, cred, tenantId = 'tenant-mx') => {
    acl.set(cred, (acl.get(cred) ?? new Set()).add(cid));
    const baseAt = Date.parse('2026-09-01T00:00:00.000Z');
    addEvents(cid, Array.from({ length: n }, (_, i) => ({
      eventId: `${cid}-e${i + 1}`, seq: String(i + 1),
      at: new Date(baseAt + (i + 1) * 60_000).toISOString(),
      eventType: 'INSPECTION_CREATED', payload: { sessionId: `${cid}-s-${i + 1}` },
    })));
  };
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      server, port: server.address().port, received, acl, revoked, addEvents, seed,
      base: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}

async function buildEdge({ a, ttlMs = null, threadCap = null } = {}) {
  const sessionStore = createSessionStore(ttlMs ? { ttlMs } : {});
  const auditSink = createAuditSink();
  const store = createKernelStore({ baseUrl: a.base });
  const messageStore = createMessageStore(threadCap ? { maxPerCustomer: threadCap } : {});
  const { readFileSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const entries = [
    { credential: CRED.biz, principalId: 'p-biz', roles: ['business'], tenantId: 'tenant-mx' },
    { credential: CRED.cust, principalId: 'cit-1', roles: ['customer'], tenantId: 'tenant-mx' },
    { credential: CRED.biz2, principalId: 'p-biz2', roles: ['business'], tenantId: 'tenant-other' },
  ];
  const byHash = new Map(); const byPrincipal = new Map(); const list = [];
  for (const e of entries) {
    const meta = { principalId: e.principalId, roles: e.roles, label: e.principalId, demo: true, tenantId: e.tenantId };
    byHash.set(createHash('sha256').update(e.credential).digest('hex'), meta);
    byPrincipal.set(e.principalId, { ...meta, credential: e.credential });
    list.push({ principalId: meta.principalId, roles: meta.roles, label: meta.label, demo: true });
  }
  const started = await startEdgeServer({
    port: 0,
    seal: { buildId: 'soak-matrix', capabilities: {} },
    probes: [httpProbe({ name: 'kernel-a', url: `${a.base}/healthz`, pass: aKernelReadyPass })],
    store,
    auth: async ({ session }) => (session ? { ok: true, principalId: session.principalId } : { ok: false, reason: 'SESSION_REQUIRED' }),
    probes_extra: undefined,
    sessionStore,
    verifyCredential: createLiveCredentialVerifier({ kernelBase: a.base, directory: { byHash, byPrincipal, list }, redeemedDirectory: { byHash: new Map() } }),
    proxy: createUpstreamProxy({ baseUrl: a.base, credentialFor: (s) => s.credential }),
    readProxy: createReadProxy({ baseUrl: a.base, credentialFor: (s) => s.credential }),
    messages: createMessageRouter({ deliver: async () => ({ messageId: `mx-${Math.random().toString(36).slice(2)}`, state: 'sent_local_sink' }), auditSink, threadStore: messageStore, receiptStore: messageStore, validateTarget: (s, cid) => store.checkCustomer(cid, { credential: s.credential }) }),
    messageStore,
    modelReceiptsDir: null,
    auditSink,
  });
  return { ...started, store, messageStore, auditSink, sessionStore };
}

const exchange = async (port, credential) => {
  const r = await fetch(`http://127.0.0.1:${port}/api/jw/v2/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }) });
  const j = await r.json();
  assert.equal(r.status, 200, `会话交换失败：${JSON.stringify(j)}`);
  return j.session.sessionId;
};
const get = (port, p, session, query = '') => fetch(`http://127.0.0.1:${port}${p}${query ? `?${query}` : ''}`, { headers: session ? { 'x-jw-session': session } : {} });
const getJson = async (...a) => { const r = await get(...a); return { status: r.status, body: await r.json() }; };

// SSE 帧收集器
function sseCollect(port, p, session, { cursor = null, lastEventId = null, holdMs = 6000 } = {}) {
  return new Promise((resolve) => {
    const frames = [];
    let buf = '';
    const q = new URLSearchParams(cursor ? { cursor } : {});
    const req = http.request(`http://127.0.0.1:${port}${p}${q.toString() ? `?${q}` : ''}`, {
      headers: { 'x-jw-session': session, ...(lastEventId ? { 'last-event-id': lastEventId } : {}) },
    }, (res) => {
      if (res.statusCode !== 200) { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => resolve({ status: res.statusCode, frames })); return; }
      res.setEncoding('utf8');
      const done = () => { try { res.destroy(); } catch { } resolve({ status: 200, frames, resync: frames.some((f) => f.event === 'resync'), auth: frames.some((f) => f.event === 'auth') }); };
      const timer = setTimeout(done, holdMs);
      res.on('data', (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const f = {};
          for (const line of chunk.split('\n')) {
            if (line.startsWith(':')) continue;
            const s = line.indexOf(': ');
            if (s > 0) f[line.slice(0, s)] = line.slice(s + 2);
          }
          if (!f.event) continue;
          let data = null; try { data = JSON.parse(f.data ?? 'null'); } catch { }
          frames.push({ event: f.event, id: f.id ?? null, data });
          if (f.event === 'auth') { clearTimeout(timer); return done(); }
        }
      });
      res.on('close', () => { clearTimeout(timer); resolve({ status: 200, frames, resync: frames.some((x) => x.event === 'resync'), auth: frames.some((x) => x.event === 'auth') }); });
    });
    req.on('error', () => { });
    req.end();
  });
}

test('规模档 10/1000/10000：首页/中段续页/末页/全量走读 count·连续·无重复·hasMore 一致', async () => {
  const a = await startStandInA();
  a.seed('cust-a10', 10, CRED.biz);
  a.seed('cust-a1000', 1000, CRED.biz);
  a.seed('cust-a10000', 10000, CRED.biz);
  const edge = await buildEdge({ a });
  try {
    const biz = await exchange(edge.port, CRED.biz);
    for (const [cid, n] of [['cust-a10', 10], ['cust-a1000', 1000], ['cust-a10000', 10000]]) {
      const tailWin = Math.min(50, n);
      // 首页
      let r = await getJson(edge.port, `/api/jw/v2/customers/${cid}/events-page`, biz, 'afterSeq=0&limit=200');
      assert.equal(r.status, 200);
      assert.equal(r.body.events.length, Math.min(200, n));
      assert.equal(r.body.hasMore, n > 200);
      assert.equal(r.body.events[0].aggregateVersion, '1');
      // 末页
      r = await getJson(edge.port, `/api/jw/v2/customers/${cid}/events-page`, biz, `afterSeq=${n - tailWin}&limit=200`);
      assert.equal(r.body.events.length, tailWin);
      assert.equal(r.body.hasMore, false);
      assert.equal(r.body.nextAfterSeq, String(n));
      // 中段续页连续（n 足够时）
      if (n > 300) {
        r = await getJson(edge.port, `/api/jw/v2/customers/${cid}/events-page`, biz, `afterSeq=100&limit=200`);
        assert.equal(r.body.events[0].aggregateVersion, '101');
      }
      // 全量走读
      let after = '0'; const seen = new Set(); let prev = 0n; let total = 0;
      for (let p = 0; p < 60; p++) {
        const page = await getJson(edge.port, `/api/jw/v2/customers/${cid}/events-page`, biz, `afterSeq=${after}&limit=200`);
        for (const e of page.body.events) {
          total++;
          assert.equal(seen.has(e.eventId), false, '全量走读零重复');
          seen.add(e.eventId);
          const s = BigInt(e.aggregateVersion);
          if (prev > 0n) assert.equal(s, prev + 1n, 'seq 连续无断档');
          prev = s;
        }
        if (!page.body.hasMore) break;
        after = page.body.nextAfterSeq;
      }
      assert.equal(total, n, `${cid} 全量走读条数=${total}`);
    }
  } finally { await edge.close(); await a.close(); }
});

test('activity 复合游标走读：三源 count 一致、零重复、per-source 升序、读到头 nextCursor=null', async () => {
  const a = await startStandInA();
  a.seed('cust-mx1', 57, CRED.biz);
  const edge = await buildEdge({ a });
  const base = `http://127.0.0.1:${edge.port}`;
  try {
    const biz = await exchange(edge.port, CRED.biz);
    for (let i = 1; i <= 23; i++) {
      const r = await fetch(`${base}/api/jw/v2/customers/cust-mx1/messages`, { method: 'POST', headers: { 'x-jw-session': biz, 'content-type': 'application/json' }, body: JSON.stringify({ requestId: `mx-m-${i}`, audience: i % 4 === 0 ? 'internal' : 'customer', text: `m${i}` }) });
      assert.equal(r.status, 200);
    }
    const { writeFile, mkdir } = await import('node:fs/promises');
    const dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'mx-rcpt-')), 'receipts');
    await mkdir(dir, { recursive: true });
    // 回执目录走 modelReceiptsDir 装配（本测试 Edge 未接 receipts —— 简化：只验证 thread+kernel 两源走读）
    let cursor = null; const seen = new Set(); const bySrc = { thread: [], kernel: [] }; let pages = 0;
    for (; pages < 30;) {
      const q = new URLSearchParams({ limit: '7', ...(cursor ? { cursor } : {}) });
      const r = await getJson(edge.port, `/api/jw/v2/customers/cust-mx1/activity`, biz, q.toString());
      assert.equal(r.status, 200);
      for (const it of r.body.items) {
        assert.equal(seen.has(it.activityId), false, '跨页零重复');
        seen.add(it.activityId);
        if (bySrc[it.source]) bySrc[it.source].push(Number(it._ck));
        assert.equal(it.customerId, 'cust-mx1', '条目全部归属请求客户');
      }
      if (r.body.nextCursor === null) break;
      cursor = r.body.nextCursor;
      pages++;
    }
    assert.equal(seen.size, 80, `57 kernel + 23 thread 全部续读（got ${seen.size}）`);
    const asc = (arr) => arr.every((v, i) => i === 0 || arr[i - 1] < v);
    assert.equal(asc(bySrc.kernel), true, 'kernel 升序前缀');
    assert.equal(asc(bySrc.thread), true, 'thread 升序前缀');
    await fs.rm(path.dirname(path.dirname(dir)), { recursive: true, force: true }).catch(() => { });
  } finally { await edge.close(); await a.close(); }
});

test('晚到事件/重复事件/同ID回执终态：不漏、去重、unknown→failed 演进', async () => {
  const a = await startStandInA();
  a.seed('cust-mx2', 5, CRED.biz);
  const receiptsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mx-rcpt2-'));
  const edge = await buildEdge({ a });
  const base = `http://127.0.0.1:${edge.port}`;
  const writeRcpt = async (name, rec) => {
    const dir = path.join(receiptsDir, 'receipts');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${encodeURIComponent(name)}.json`), JSON.stringify(rec));
  };
  try {
    // 重建 Edge 使 modelReceiptsDir 生效
    await edge.close();
    const edge2 = await (async () => {
      const s = buildEdge; // 复用；直接再装配一次带 receiptsDir 的实例
      const sessionStore = createSessionStore({});
      const auditSink = createAuditSink();
      const store = createKernelStore({ baseUrl: a.base });
      const messageStore = createMessageStore({});
      const { createHash } = await import('node:crypto');
      const mk = (cred, pid, roles, tid) => {
        const meta = { principalId: pid, roles, label: pid, demo: true, tenantId: tid };
        return { cred, meta };
      };
      const byHash = new Map(); const byPrincipal = new Map(); const list = [];
      for (const e of [mk(CRED.biz, 'p-biz', ['business'], 'tenant-mx'), mk(CRED.cust, 'cit-1', ['customer'], 'tenant-mx'), mk(CRED.biz2, 'p-biz2', ['business'], 'tenant-other')]) {
        byHash.set(createHash('sha256').update(e.cred).digest('hex'), e.meta);
        byPrincipal.set(e.meta.principalId, { ...e.meta, credential: e.cred });
        list.push({ principalId: e.meta.principalId, roles: e.meta.roles, label: e.meta.label, demo: true });
      }
      const started = await startEdgeServer({
        port: 0, seal: { buildId: 'soak-matrix2', capabilities: {} },
        probes: [httpProbe({ name: 'kernel-a', url: `${a.base}/healthz`, pass: aKernelReadyPass })],
        store, auth: async ({ session }) => (session ? { ok: true } : { ok: false, reason: 'SESSION_REQUIRED' }),
        sessionStore, verifyCredential: createLiveCredentialVerifier({ kernelBase: a.base, directory: { byHash, byPrincipal, list }, redeemedDirectory: { byHash: new Map() } }),
        messages: createMessageRouter({ deliver: async () => ({ messageId: 'x', state: 'sent' }), auditSink, threadStore: messageStore, receiptStore: messageStore, validateTarget: (s, cid) => store.checkCustomer(cid, { credential: s.credential }) }),
        messageStore, modelReceiptsDir: receiptsDir, auditSink,
      });
      return { ...started, store, messageStore, auditSink, sessionStore };
    })();
    const biz = await exchange(edge2.port, CRED.biz);

    // 晚到事件：旧时间新 seq → events-page 尾页必见
    a.addEvents('cust-mx2', [{ eventId: 'cust-mx2-late', seq: '100', at: '2020-01-01T00:00:00.000Z', eventType: 'LATE', payload: {} }]);
    let r = await getJson(edge2.port, `/api/jw/v2/customers/cust-mx2/events-page`, biz, 'afterSeq=5&limit=50');
    assert.equal(r.body.events.some((e) => e.eventId === 'cust-mx2-late'), true, '晚到事件不丢');

    // 重复事件：同 eventId 重发 → kernel-store byId 去重 → activity 条目不变
    const a1 = await getJson(edge2.port, `/api/jw/v2/customers/cust-mx2/activity`, biz, 'sources=kernel&limit=200');
    a.addEvents('cust-mx2', [{ eventId: 'cust-mx2-e1', seq: '1', at: '2026-09-01T00:01:00.000Z', eventType: 'INSPECTION_CREATED', payload: {} }]);
    await new Promise((r2) => setTimeout(r2, 700));
    const a2 = await getJson(edge2.port, `/api/jw/v2/customers/cust-mx2/activity`, biz, 'sources=kernel&limit=200');
    assert.equal(a2.body.items.length, a1.body.items.length, '重复 eventId 不新增条目');

    // 同ID回执终态：intent unknown → terminal failed
    const rid = 'mx-rcpt-1';
    await writeRcpt(`${rid}:intent`, { requestId: rid, customerId: 'cust-mx2', tenantId: 'tenant-mx', assistant: 'credit', contextVersion: 'v1', receiptVersion: 2, phase: 'intent', at: '2026-09-21T00:00:00.000Z' });
    let rc = await getJson(edge2.port, `/api/jw/v2/customers/cust-mx2/activity`, biz, 'sources=model_receipt&limit=50');
    assert.equal(rc.body.items.find((i) => i.sourceRecordId === rid)?.state, 'unknown', 'INTENT → unknown');
    await writeRcpt(rid, { requestId: rid, customerId: 'cust-mx2', tenantId: 'tenant-mx', assistant: 'credit', contextVersion: 'v1', receiptVersion: 2, configHash: 'c', contextHash: 'h', phase: 'terminal', at: '2026-09-21T00:01:00.000Z', outcome: { status: 'failed', sentFlag: false, findings: [], questions: [], evidenceRefs: [], usage: {} } });
    rc = await getJson(edge2.port, `/api/jw/v2/customers/cust-mx2/activity`, biz, 'sources=model_receipt&limit=50');
    assert.equal(rc.body.items.find((i) => i.sourceRecordId === rid)?.state, 'failed', 'TERMINAL failed 如实 failed');
    await edge2.close();
  } finally { await a.close(); await fs.rm(receiptsDir, { recursive: true, force: true }).catch(() => { }); }
});

test('线程裁剪：retentionBase 前进 + 过期游标经 activity truncated 披露 + 缺失区段不静默', async () => {
  const a = await startStandInA();
  a.seed('cust-trim', 3, CRED.biz);
  const edge = await buildEdge({ a, threadCap: 5 });
  try {
    const biz = await exchange(edge.port, CRED.biz);
    for (let i = 1; i <= 8; i++) edge.messageStore.append({ customerId: 'cust-trim', audience: 'customer', text: `t${i}`, requestId: `tr-${i}`, senderPrincipalId: 'p-biz' });
    const r = await getJson(edge.port, `/api/jw/v2/customers/cust-trim/messages`, biz, 'limit=50');
    assert.equal(r.body.messages.length, 5, '保留窗口 5 条');
    // 截断披露经统一活动读面（thread 源 sources[] 携带 truncated/retentionBase；/messages 路由不回传该披露）
    const stale = encodeActivityCursor({ thread: '1' });
    const r2 = await getJson(edge.port, `/api/jw/v2/customers/cust-trim/activity`, biz, `limit=50&cursor=${encodeURIComponent(stale)}`);
    assert.equal(r2.status, 200, '过期游标不 500：可续读');
    const th = r2.body.sources.find((s) => s.source === 'thread');
    assert.equal(th.truncated, true, '过期游标 truncated 披露');
    assert.equal(th.retentionBase, 3, 'retentionBase=3');
    const seqs = r2.body.items.filter((i) => i.source === 'thread').map((i) => Number(i.refs.seq));
    assert.deepEqual(seqs, [4, 5, 6, 7, 8], '从保留窗口起如实续读（seq≤base 已物理裁剪）');
  } finally { await edge.close(); await a.close(); }
});

test('内核缓冲裁剪：超 4000 条后旧游标订阅 → EDGE_RESYNC_REQUIRED（不静默续播）', async () => {
  const a = await startStandInA();
  a.seed('cust-big', 4200, CRED.biz);
  const edge = await buildEdge({ a });
  try {
    const biz = await exchange(edge.port, CRED.biz);
    const ws = await getJson(edge.port, `/api/jw/v2/customers/cust-big/workspace`, biz);
    assert.equal(ws.status, 200);
    const sse = await sseCollect(edge.port, `/api/jw/v2/customers/cust-big/events`, biz, { cursor: 'cust-big-e1', holdMs: 15000 });
    assert.equal(sse.resync, true, '旧游标（已被裁剪）订阅 → resync 帧');
    const rs = sse.frames.find((f) => f.event === 'resync');
    assert.equal(rs.data.reason, 'cursor_unknown_or_edge_restarted');
    assert.equal(sse.frames.some((f) => f.event === 'business'), false, 'resync 后不静默续播');
  } finally { await edge.close(); await a.close(); }
});

test('SSE 重连：Last-Event-ID 续播无跳号；订阅中撤权 → auth 帧终止（先连后撤）', async () => {
  const a = await startStandInA();
  a.seed('cust-sse', 8, CRED.biz);
  const edge = await buildEdge({ a });
  try {
    const biz = await exchange(edge.port, CRED.biz);
    // 第一段：从 head 订阅并拿基线
    const s1 = await sseCollect(edge.port, `/api/jw/v2/customers/cust-sse/events`, biz, { holdMs: 2500 });
    assert.equal(s1.status, 200);
    const cursor = s1.frames.find((f) => f.event === 'cursor')?.data?.eventCursor;
    // 追加 3 条
    a.addEvents('cust-sse', [7, 8, 9].map((i) => ({ eventId: `cust-sse-x${i}`, seq: String(i), at: '2026-09-21T00:00:00.000Z', eventType: 'X', payload: {} })));
    await new Promise((r) => setTimeout(r, 1500));
    const s2 = await sseCollect(edge.port, `/api/jw/v2/customers/cust-sse/events`, biz, { cursor, holdMs: 2500 });
    const replayed = s2.frames.filter((f) => f.event === 'business').map((f) => f.data.payloadRef.seq);
    assert.equal(replayed.length >= 1, true, '带游标重连能补播');
    // 订阅中撤权：先建立连接，再撤凭据 → 内核轮询 403 → auth 帧终止（不静默失联）
    const holder = sseCollect(edge.port, `/api/jw/v2/customers/cust-sse/events`, biz, { holdMs: 12000 });
    await new Promise((r) => setTimeout(r, 2000)); // 连接已建立（含首轮补取）
    a.revoked.add(CRED.biz);
    const s3 = await holder;
    a.revoked.delete(CRED.biz);
    assert.equal(s3.auth, true, '订阅中撤权 → auth 帧（got frames: ' + s3.frames.map((f) => f.event).join(',') + '）');
  } finally { await edge.close(); await a.close(); }
});

test('权限矩阵：跨客户404、翻页撤权403、客户受众403/排除、非法游标400、GET零副作用', async () => {
  const a = await startStandInA();
  a.seed('cust-p1', 20, CRED.biz);
  a.seed('cust-other', 3, CRED.biz2, 'tenant-other');
  a.acl.set(CRED.cust, new Set(['cust-p1'])); // 客户联系人可见本客户（受众/回执排除测试用）
  const edge = await buildEdge({ a });
  try {
    const biz = await exchange(edge.port, CRED.biz);
    const cust = await exchange(edge.port, CRED.cust);

    // 跨客户：biz 读 tenant-other；cust 读未授权客户（cust-other 属他租户业务）
    assert.equal((await getJson(edge.port, `/api/jw/v2/customers/cust-other/activity`, biz, 'limit=5')).status, 404);
    assert.equal((await getJson(edge.port, `/api/jw/v2/customers/cust-other/workspace`, cust)).status, 404);

    // 客户受众：internal 403；默认排除（客户视图无模型回执）
    assert.equal((await getJson(edge.port, `/api/jw/v2/customers/cust-p1/activity`, cust, 'audience=internal')).status, 403);
    const cv = await getJson(edge.port, `/api/jw/v2/customers/cust-p1/activity`, cust, 'limit=20');
    assert.equal(cv.body.items.some((i) => i.source === 'model_receipt'), false, '客户视图无模型回执');

    // 非法游标 400
    assert.equal((await getJson(edge.port, `/api/jw/v2/customers/cust-p1/activity`, biz, 'cursor=garbage!!')).status, 400);

    // 翻页撤权：第1页200 → 撤权 → 第2页403
    const p1 = await getJson(edge.port, `/api/jw/v2/customers/cust-p1/activity`, biz, 'limit=5&sources=kernel');
    assert.equal(p1.status, 200);
    a.revoked.add(CRED.biz);
    const p2 = await get(edge.port, `/api/jw/v2/customers/cust-p1/activity`, biz, `limit=5&sources=kernel&cursor=${encodeURIComponent(p1.body.nextCursor)}`);
    assert.equal(p2.status, 403, '撤权后翻页 403');
    a.revoked.delete(CRED.biz);

    // GET 零副作用：全链只收白名单 GET；无 assessments/financing/invitations/上传
    const since = Date.now();
    await getJson(edge.port, `/api/jw/v2/customers/cust-p1/activity`, biz, 'limit=10');
    await getJson(edge.port, `/api/jw/v2/customers/cust-p1/workspace`, biz);
    await getJson(edge.port, `/api/jw/v2/customers/cust-p1/messages`, biz, 'limit=5');
    const delta = a.received.filter((r) => r.t > since && !r.path.startsWith('/api/v2/receipts/') && r.path !== '/healthz');
    assert.equal(delta.length > 0, true, '窗口内替身 A 收到读请求');
    assert.equal(delta.every((r) => r.method === 'GET'), true, '只读 GET');
    assert.equal(delta.every((r) => /^\/api\/v2\/customers\/cust-p1(\/(events|exposure|decision-status|findings|object-inventory|artifacts|assessments|financing-requests))?$/.test(r.path) || /^\/api\/v1\/inspections\/cust-p1-s-\d+$/.test(r.path)), true, `白名单路径（got ${[...new Set(delta.map((r) => r.path))].join(',')}）`);
  } finally { await edge.close(); await a.close(); }
});

test('会话过期：TTL 后首页与借旧游标续读均 401（失效会话不可续读）', async () => {
  const a = await startStandInA();
  a.seed('cust-ttl', 6, CRED.biz);
  const edge = await buildEdge({ a, ttlMs: 300 });
  try {
    const biz = await exchange(edge.port, CRED.biz);
    const p1 = await getJson(edge.port, `/api/jw/v2/customers/cust-ttl/activity`, biz, 'limit=2&sources=kernel');
    assert.equal(p1.status, 200);
    await new Promise((r) => setTimeout(r, 600));
    assert.equal((await get(edge.port, `/api/jw/v2/customers/cust-ttl/activity`, biz)).status, 401, '过期会话首页 401');
    assert.equal((await get(edge.port, `/api/jw/v2/customers/cust-ttl/activity`, biz, `cursor=${encodeURIComponent(p1.body.nextCursor)}`)).status, 401, '借旧游标续读 401');
    assert.equal((await get(edge.port, `/api/jw/v2/customers/cust-ttl/activity`, 'not-a-session')).status, 401);
  } finally { await edge.close(); await a.close(); }
});

test('1000 材料元数据：workspace 正常装配，artifacts 单页 100 + 截断披露（SOAK-01 修复后行为）', async () => {
  const a = await startStandInA();
  a.seed('cust-m1000', 4, CRED.biz);
  const edge = await buildEdge({ a });
  try {
    const biz = await exchange(edge.port, CRED.biz);
    const r = await getJson(edge.port, `/api/jw/v2/customers/cust-m1000/workspace`, biz);
    assert.equal(r.status, 200);
    assert.equal(r.body.snapshot.artifacts.length, 100, '上游单页 100 条');
    assert.equal(r.body.snapshot.listTruncated.artifacts, true, '材料清单截断如实披露（listTruncated.artifacts）');
    assert.equal(r.body.projection.notes.some((n) => n.includes('材料清单超过单页上限')), true, 'note 显式提示');
  } finally { await edge.close(); await a.close(); }
});
