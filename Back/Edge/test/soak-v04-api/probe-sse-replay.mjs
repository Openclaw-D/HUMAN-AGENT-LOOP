// 独立探针：复现 sse-cycle「回放含游标之前事件」。进程内 Edge+stand-in A，模拟 driver 的
// churn（晚到+重复重投）+ 反复 kernelCursor→subscribe(cursor) 流程，输出违规帧全文。
import http from 'node:http';
import { startEdgeServer, createLiveCredentialVerifier } from '../../src/server.mjs';
import { createKernelStore } from '../../src/kernel-store.mjs';
import { createSessionStore } from '../../src/session.mjs';
import { createAuditSink } from '../../src/audit.mjs';
import { createMessageRouter } from '../../src/messages.mjs';
import { createMessageStore } from '../../src/message-store.mjs';
import { httpProbe, aKernelReadyPass } from '../../src/probes.mjs';

const CRED = 'probe-cred-biz';
function startStandInA() {
  const received = [];
  const acl = new Map([[CRED, new Set(['cust-mix'])]]);
  let events = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://s');
    const cred = req.headers['x-principal-credential'] ?? null;
    received.push({ path: u.pathname });
    const respond = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (u.pathname === '/healthz') return respond(200, { ok: true, db: 'up' });
    if (u.pathname.startsWith('/api/v2/receipts/')) return respond(200, { ok: true });
    if (u.pathname.startsWith('/api/v1/inspections/')) return respond(200, { ok: true, snapshot: {} });
    const m = u.pathname.match(/^\/api\/v2\/customers\/([^/]+)(\/.*)?$/);
    if (!m) return respond(404, { ok: false });
    const cid = decodeURIComponent(m[1]);
    if (!acl.get(cred)?.has(cid)) return respond(404, { ok: false });
    const sub = m[2] ?? '/';
    if (sub === '/') return respond(200, { ok: true, customer: { customerId: cid, tenantId: 't' } });
    if (sub === '/events') {
      const after = BigInt(u.searchParams.get('after') || '0');
      const limit = Math.min(Math.max(Number(u.searchParams.get('limit') || '500'), 1), 500);
      const page = events.filter((e) => BigInt(e.seq) > after).sort((a, b) => (BigInt(a.seq) < BigInt(b.seq) ? -1 : 1)).slice(0, limit);
      return respond(200, { ok: true, events: page });
    }
    if (sub === '/exposure') return respond(200, { ok: true, facilities: [], totalsMinor: null });
    if (sub === '/decision-status') return respond(200, { ok: true, basis: {}, reviewQueue: [], reportRefs: [] });
    if (sub === '/findings') return respond(200, { ok: true, findings: [] });
    if (sub === '/object-inventory') return respond(200, { ok: true, objects: [] });
    if (sub === '/artifacts') return respond(200, { ok: true, artifacts: [], nextCursor: null });
    if (sub === '/assessments') return respond(200, { ok: true, assessments: [], nextCursor: null });
    if (sub === '/financing-requests') return respond(200, { ok: true, financingRequests: [], nextCursor: null });
    return respond(404, { ok: false });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, add: (e) => (events = [...events, e]), base: `http://127.0.0.1:${server.address().port}` }));
  });
}

function sseOpen(base, session, cursor, holdMs) {
  return new Promise((resolve) => {
    const frames = [];
    let buf = '';
    let settled = false;
    const finish = (why) => { if (settled) return; settled = true; resolve({ status: why === 'timeout' ? -1 : 200, frames, why }); };
    const req = http.request(`${base}/api/jw/v2/customers/cust-mix/events?cursor=${encodeURIComponent(cursor)}`, { headers: { 'x-jw-session': session } }, (res) => {
      if (res.statusCode !== 200) { let raw = ''; res.setEncoding('utf8'); res.on('data', (c) => raw += c); res.on('end', () => { frames.push({ event: `status-${res.statusCode}:${raw.slice(0, 80)}` }); finish('non200'); }); return; }
      res.setEncoding('utf8');
      const done = () => { try { res.destroy(); } catch { } finish('closed'); };
      const t = setTimeout(done, holdMs);
      res.on('data', (c) => {
        buf += c; let i;
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
          frames.push({ event: f.event, id: f.id, data });
          if (f.event === 'auth') { clearTimeout(t); finish('auth'); }
        }
      });
      res.on('close', () => { clearTimeout(t); finish('closed'); });
    });
    req.setTimeout(5000, () => { try { req.destroy(new Error('probe-timeout')); } catch { } finish('timeout'); });
    req.on('error', () => finish('error'));
    req.end();
  });
}

const a = await startStandInA();
const store = createKernelStore({ baseUrl: a.base });
const sessionStore = createSessionStore({});
const auditSink = createAuditSink();
const messageStore = createMessageStore({});
const { createHash } = await import('node:crypto');
const meta = { principalId: 'p-biz', roles: ['business'], label: 'x', demo: true, tenantId: 't' };
const byHash = new Map([[createHash('sha256').update(CRED).digest('hex'), meta]]);
const edge = await startEdgeServer({
  port: 0, seal: { buildId: 'probe', capabilities: {} },
  probes: [httpProbe({ name: 'a', url: `${a.base}/healthz`, pass: aKernelReadyPass })],
  store, auth: async ({ session }) => (session ? { ok: true } : { ok: false }),
  sessionStore, verifyCredential: createLiveCredentialVerifier({ kernelBase: a.base, directory: { byHash, byPrincipal: new Map(), list: [] }, redeemedDirectory: { byHash: new Map() } }),
  messages: createMessageRouter({ deliver: async () => ({ messageId: 'x', state: 'sent' }), auditSink, threadStore: messageStore, receiptStore: messageStore }),
  messageStore, auditSink,
});
const base = `http://127.0.0.1:${edge.port}`;
console.log('[probe] edge up', base);
const sess = (await (await fetch(`${base}/api/jw/v2/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: CRED }) })).json()).session.sessionId;
console.log('[probe] session ok');

let seqN = 20000;
const workspace = async () => (await (await fetch(`${base}/api/jw/v2/customers/cust-mix/workspace`, { headers: { 'x-jw-session': sess } })).json());
const seqOf = (id) => String(id ?? '').match(/-(\d+)$/)?.[1] ?? '0';

let violations = 0;
let churnSeq = 20000;
for (let iter = 0; iter < 400; iter++) {
  // churn：与 driver churn-late 同形（晚到事件，新 eventId 新 seq）
  if (iter % 4 === 0) {
    churnSeq += 1;
    a.add({ eventId: `cust-mix-late-${churnSeq}`, seq: String(churnSeq), at: '2026-09-01T00:00:00.000Z', eventType: 'LATE_ARRIVAL_SOAK', payload: { note: `late-${churnSeq}` } });
  }
  const ws = await workspace();
  const cur = ws.eventCursor;
  const hold = 4000 + Math.floor((iter * 7919 % 4000));
  const r = await sseOpen(base, sess, cur, hold);
  for (const f of r.frames) {
    if (f.event === 'business' && f.data?.payloadRef?.seq && cur) {
      if (BigInt(f.data.payloadRef.seq) <= BigInt(seqOf(cur))) {
        violations++;
        console.log(`VIOLATION iter=${iter} cursor=${cur}(seq=${seqOf(cur)}) hold=${hold}`);
        console.log('  frames:', r.frames.map((x) => `${x.event}:${x.id ?? x.data?.eventCursor ?? x.data?.payloadRef?.seq ?? ''}`).join(' | '));
        if (violations >= 3) process.exit(0);
      }
    }
    if (f.event === 'resync') console.log(`resync iter=${iter} cursor=${cur} reason=${f.data?.reason}`);
  }
  await new Promise((r2) => setTimeout(r2, 40));
}
console.log(`done. violations=${violations}`);
process.exit(0);
