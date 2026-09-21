// V0.4 长程测试 02_API 包 · Back/A 替身（stand-in）。
// 替身边界（必须随报告披露）：本文件是"Back/A 持久数据库 + PG"的本地内存 HTTP 替身，
// 只实现 Edge 只读链所需的上游端点形状与凭据 ACL；Edge 侧全链为真实代码
//（kernel-store / customer-activity / server 路由 / 会话 / message-store sqlite / 回执文件）。
// 控制面（仅供本包 driver 使用）：ACL、撤权、延迟/错误注入、事件追加（晚到/重复/反序）、
// 停机（拒绝连接）。收到的每个请求都记录（method/path/query/credential），供 GET 零副作用断言。
import http from 'node:http';

const OK = (body) => ({ status: 200, body: { ok: true, ...body } });

export function createStandInA({ log = () => { } } = {}) {
  const state = {
    acl: new Map(),        // credential -> Set(customerId)
    revoked: new Set(),    // credential（撤权：403）
    latencyMs: 0,          // 每响应附加延迟
    errorRate: 0,          // 0..1 比例返回 503（延迟后）
    down: false,           // 停机：直接销毁 socket（连接拒绝/未知）
    customerIdSeq: 0,
  };
  const received = [];     // { t, method, path, query, credential }
  const eventsByCustomer = new Map(); // cid -> [{eventId, seq(string), at?, eventType, payload}]
  const customers = new Map();        // cid -> { customerId, tenantId, name }

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const t = Date.now();
      const u = new URL(req.url, 'http://standin-a');
      const cred = req.headers['x-principal-credential'] ?? null;
      received.push({ t, method: req.method, path: u.pathname, query: u.search, credential: cred });
      const respond = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (state.down) { req.socket.destroy(); return; }
      if (state.latencyMs > 0) await new Promise((r) => setTimeout(r, state.latencyMs));
      if (state.errorRate > 0 && Math.random() < state.errorRate) return respond(503, { ok: false, error: 'STANDIN_INJECTED_5XX' });
      if (u.pathname === '/healthz') return respond(200, { ok: true, db: 'up' });
      if (req.method !== 'GET') return respond(405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
      if (u.pathname.startsWith('/api/v2/receipts/')) return respond(200, { ok: true, receipt: null }); // 探针端点
      if (u.pathname.startsWith('/api/v1/inspections/')) return respond(200, { ok: true, snapshot: { inspectionId: u.pathname.slice('/api/v1/inspections/'.length), state: 'open' } });
      const m = u.pathname.match(/^\/api\/v2\/customers\/([^/]+)(\/.*)?$/);
      if (!m) return respond(404, { ok: false, error: 'NOT_FOUND' });
      const cid = decodeURIComponent(m[1]);
      if (state.revoked.has(cred)) return respond(403, { ok: false, error: 'PERMISSION_DENIED' });
      if (!state.acl.get(cred)?.has(cid)) return respond(404, { ok: false, error: 'NOT_FOUND' }); // 存在性不泄露
      const sub = m[2] ?? '/';
      const enc = encodeURIComponent(cid);
      if (sub === '/') {
        const c = customers.get(cid);
        return respond(200, { ok: true, customer: c ?? { customerId: cid, tenantId: 'tenant-soak', name: ` soak-${cid}` } });
      }
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
        // 材料元数据规模档：cust-m1000 提供 1000 条元数据（单条 <1KB，总量受控），
        // 其余客户 3 条。limit 参数：上游只回前 100 条（workspace 请求 limit=100）。
        const total = cid === 'cust-m1000' ? 1000 : 3;
        const items = [];
        for (let i = 0; i < Math.min(total, 100); i++) {
          items.push({ artifactId: `${cid}-art-${i + 1}`, kind: 'bank_statement', status: 'current', registeredAt: '2026-09-21T00:00:00.000Z' });
        }
        return respond(200, { ok: true, artifacts: items, nextCursor: total > 100 ? `art-${100}` : null });
      }
      if (sub === '/assessments') return respond(200, { ok: true, assessments: [{ assessmentId: `${cid}-as-1`, status: 'awaiting_human_review' }], nextCursor: null });
      if (sub === '/financing-requests') return respond(200, { ok: true, financingRequests: [], nextCursor: null });
      return respond(404, { ok: false, error: 'NOT_FOUND' });
    });
  });
  // /api/v1/inspections/:id（workspace 会话引用回退面；无会话事件时不会被调用）
  server.on('request', () => { });

  const addEvents = (cid, arr) => {
    // 真实 A 的 eventId/seq 是存储主键：重复追加（重复投递模拟）按幂等 no-op 处理。
    // 重复 DELIVERY 的覆盖由 kernel-store 重查窗口（每轮重拉最后 128 seq）天然持续 exercising。
    const list = eventsByCustomer.get(cid) ?? [];
    const known = new Set(list.map((e) => e.eventId));
    const fresh = arr.filter((e) => !known.has(e.eventId));
    eventsByCustomer.set(cid, [...list, ...fresh]);
  };
  const eventCount = (cid) => (eventsByCustomer.get(cid) ?? []).length;
  // 规模档客户：n 条事件（seq 1..n，时间递增；payload 小于 300B）
  const seedScaleCustomer = (cid, n, credential, tenantId = 'tenant-soak') => {
    state.acl.set(credential, (state.acl.get(credential) ?? new Set()).add(cid));
    customers.set(cid, { customerId: cid, tenantId, name: `规模档 ${cid}` });
    const events = [];
    const baseAt = Date.parse('2026-09-01T00:00:00.000Z');
    for (let i = 1; i <= n; i++) {
      events.push({
        eventId: `${cid}-e${i}`, seq: String(i),
        at: new Date(baseAt + i * 60_000).toISOString(),
        eventType: i % 5 === 0 ? 'ASSESSMENT_CREATED' : 'INSPECTION_CREATED',
        payload: { assessmentId: i % 5 === 0 ? `${cid}-as-${i}` : undefined, sessionId: i % 5 !== 0 ? `${cid}-s-${i}` : undefined, note: `seq-${i}` },
      });
    }
    addEvents(cid, events);
  };

  return {
    server, state, received, addEvents, eventCount, seedScaleCustomer,
    listen: () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))),
    close: () => new Promise((r) => server.close(() => r())),
    base: () => `http://127.0.0.1:${server.address().port}`,
    /** 窗口内收到的请求（零副作用断言用） */
    receivedSince: (t) => received.filter((r) => r.t > t),
  };
}

export { OK };
