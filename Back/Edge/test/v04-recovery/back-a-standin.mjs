// 替身 A（R2-04 恢复验收专用）：只替代"Back/A 持久数据库"，不替代 Edge 聚合代码。
// 与既有 v04-activity-http.test.mjs 的替身同形状（GET /api/v2/customers/:id 与 /events、
// 凭据→客户 ACL、撤权开关），额外要求：替身存活于父测试进程——Edge 子进程重启时替身不重启，
// 与生产"A 独立持久服务、Edge 可重启"拓扑一致。仅此目录内使用，不进入产品代码。
import http from 'node:http';

// 受控身份（Edge verifyCredential 表）：业务 t1 / 客户 t1 / 业务 t2。
export const IDENTITY = {
  'cred-biz-t1': { ok: true, principalId: 'p-biz-t1', roles: ['business'], tenantId: 't1' },
  'cred-cust-c1': { ok: true, principalId: 'cit-1', roles: ['customer'], tenantId: 't1' },
  'cred-biz-t2': { ok: true, principalId: 'p-biz-t2', roles: ['business'], tenantId: 't2' },
};

// 替身 A 的凭据→客户 ACL（A 是唯一授权裁决方；未列客户一律 404，存在性不泄露）。
export const ACL = {
  'cred-biz-t1': new Set(['cust-1', 'cust-2']),
  'cred-cust-c1': new Set(['cust-1']),
  'cred-biz-t2': new Set(['cust-3']),
};

// 启动替身 A。返回 { port, received, state, addEvents, close }：
// received 逐条记录收到的请求（零模型调用断言依据：仅允许 GET customers/:id 与 /events）。
export function startStandInA() {
  const received = [];
  // revoked=凭据撤权开关；failEvents=仅事件源故障开关（customer 端点正常，模拟 A 局部断连）。
  const state = { revoked: new Set(), failEvents: false };
  const eventsByCustomer = new Map(); // cid -> [{eventId, seq, at?, eventType, payload}]
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://standin-a');
      const cred = req.headers['x-principal-credential'] ?? null;
      received.push({ method: req.method, path: u.pathname, query: u.search, credential: cred });
      const respond = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      const m = u.pathname.match(/^\/api\/v2\/customers\/([^/]+)(\/.*)?$/);
      if (!m) return respond(404, { ok: false, error: 'NOT_FOUND' });
      const cid = decodeURIComponent(m[1]);
      if (state.revoked.has(cred)) return respond(403, { ok: false, error: 'PERMISSION_DENIED' });
      if (!ACL[cred] || !ACL[cred].has(cid)) return respond(404, { ok: false, error: 'NOT_FOUND' });
      if (req.method !== 'GET') return respond(405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
      const sub = m[2] ?? '/';
      if (sub === '/') return respond(200, { ok: true, customer: { customerId: cid, tenantId: IDENTITY[cred]?.tenantId ?? null } });
      if (sub === '/events') {
        if (state.failEvents) return respond(503, { ok: false, error: 'EVENTS_SOURCE_DOWN' });
        const after = BigInt(u.searchParams.get('after') || '0');
        const limit = Math.min(Number(u.searchParams.get('limit') || '500'), 500);
        const page = (eventsByCustomer.get(cid) ?? [])
          .filter((e) => BigInt(e.seq) > after)
          .sort((a, b) => (BigInt(a.seq) < BigInt(b.seq) ? -1 : 1))
          .slice(0, limit);
        return respond(200, { ok: true, events: page });
      }
      return respond(404, { ok: false, error: 'NOT_FOUND' });
    });
  });
  const addEvents = (cid, arr) => eventsByCustomer.set(cid, [...(eventsByCustomer.get(cid) ?? []), ...arr]);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      server, port: server.address().port, received, state, addEvents,
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}
