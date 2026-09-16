// S3 E0：写路由 CSRF 守卫（任务04 §5 / D17 种子）。
// 覆盖全部 POST 面（session / actions / messages）：
//   - 同源放行（Origin.host === Host）；
//   - Sec-Fetch-Site 存在必须 same-origin；跨站/同站/scheme 组合拒绝；
//   - 非浏览器客户端（Origin 与 Sec-Fetch-Site 均缺省）放行——curl/CI/harness 兼容；
//   - 有 Sec-Fetch-Site 无 Origin、null origin、跨站 Origin 一律 403 CSRF_ORIGIN_REJECTED；
//   - 显式 allowedOrigins 放行（staging 形态预留）；GET 只读面不受守卫影响。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startFixtureUpstream, buildEdge } from './helpers.mjs';

const post = async (base, path, headers, body = {}) => {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

async function withEdge(fn) {
  const up = await startFixtureUpstream();
  const edge = await buildEdge({ upstreamPort: up.port });
  try {
    return await fn(`http://127.0.0.1:${edge.port}`, edge);
  } finally {
    await edge.close();
    await up.close();
  }
}

test('同源 POST 放行（Origin.host === Host）', async () => {
  await withEdge(async (base) => {
    const r = await post(base, '/api/jw/v2/session', { origin: `http://127.0.0.1:${new URL(base).port}` }, { credential: 'tok-demo' });
    assert.equal(r.status, 200, '同源会话交换应通过 CSRF 守卫');
  });
});

test('跨站 Origin：三条 POST 路由全部 403 CSRF_ORIGIN_REJECTED', async () => {
  await withEdge(async (base) => {
    const H = { origin: 'http://evil.example' };
    assert.equal((await post(base, '/api/jw/v2/session', H, { credential: 'tok-demo' })).body.error, 'CSRF_ORIGIN_REJECTED');
    assert.equal((await post(base, '/api/jw/v2/actions/goals/g1/claim', H, { requestId: 'x' })).body.error, 'CSRF_ORIGIN_REJECTED');
    assert.equal((await post(base, '/api/jw/v2/customers/cust-1001/messages', H, { requestId: 'x', audience: 'internal', text: 't' })).body.error, 'CSRF_ORIGIN_REJECTED');
  });
});

test('Sec-Fetch-Site：cross-site/same-site/none 拒绝；same-origin 放行；与同源 Origin 组合不一致也拒绝', async () => {
  await withEdge(async (base) => {
    const port = new URL(base).port;
    assert.equal((await post(base, '/api/jw/v2/session', { 'sec-fetch-site': 'cross-site' }, { credential: 'tok-demo' })).body.error, 'CSRF_ORIGIN_REJECTED');
    assert.equal((await post(base, '/api/jw/v2/session', { 'sec-fetch-site': 'same-site' }, { credential: 'tok-demo' })).body.error, 'CSRF_ORIGIN_REJECTED');
    assert.equal((await post(base, '/api/jw/v2/session', { 'sec-fetch-site': 'none' }, { credential: 'tok-demo' })).body.error, 'CSRF_ORIGIN_REJECTED');
    const ok = await post(base, '/api/jw/v2/session', { 'sec-fetch-site': 'same-origin', origin: `http://127.0.0.1:${port}` }, { credential: 'tok-demo' });
    assert.equal(ok.status, 200, 'same-origin 信号+同源 Origin 放行');
    const inconsistent = await post(base, '/api/jw/v2/session', { 'sec-fetch-site': 'same-origin', origin: 'http://evil.example' }, { credential: 'tok-demo' });
    assert.equal(inconsistent.body.error, 'CSRF_ORIGIN_REJECTED', '声称 same-origin 但 Origin 跨站 → 拒绝');
  });
});

test('非浏览器客户端（无 Origin 无 Sec-Fetch-Site）放行；有 Sec-Fetch-Site 无 Origin 拒绝；null origin 拒绝', async () => {
  await withEdge(async (base) => {
    const plain = await post(base, '/api/jw/v2/session', {}, { credential: 'tok-demo' });
    assert.equal(plain.status, 200, '无浏览器头的客户端（curl/CI）不受影响');
    const sfsOnly = await post(base, '/api/jw/v2/session', { 'sec-fetch-site': 'same-origin' }, { credential: 'tok-demo' });
    assert.equal(sfsOnly.body.error, 'CSRF_ORIGIN_REJECTED', '浏览器必然携带 Origin；缺失即不一致');
    const nullOrigin = await post(base, '/api/jw/v2/session', { origin: 'null' }, { credential: 'tok-demo' });
    assert.equal(nullOrigin.body.error, 'CSRF_ORIGIN_REJECTED');
  });
});

test('localhost 变体同源放行；未知 Host 的同端口 Origin 拒绝（防端口探针跨源）', async () => {
  await withEdge(async (base) => {
    const port = new URL(base).port;
    // fetch 禁止覆盖 Host 头；Host 变体用 node:http 原始请求。
    const rawPost = (hostHeader, originHeader) => new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/api/jw/v2/session', method: 'POST' },
        (res) => {
          let b = '';
          res.on('data', (d) => (b += d));
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
        },
      );
      req.on('error', reject);
      req.setHeader('host', hostHeader);
      if (originHeader) req.setHeader('origin', originHeader);
      req.setHeader('content-type', 'application/json');
      req.end(JSON.stringify({ credential: 'tok-demo' }));
    });
    const r = await rawPost(`localhost:${port}`, `http://localhost:${port}`);
    assert.equal(r.status, 200, 'localhost:同端口 与 Host 同源');
    // Host 被伪造为其它域名时，Origin 需与该 Host 同源才算同源
    const r2 = await rawPost('internal-admin.example', `http://127.0.0.1:${port}`);
    assert.equal(r2.body.error, 'CSRF_ORIGIN_REJECTED', 'Origin 与 Host 不同源 → 拒绝');
  });
});

test('显式 allowedOrigins 放行（staging 预留）；GET 只读面不受 CSRF 守卫影响', async () => {
  const up = await startFixtureUpstream();
  const { startEdgeServer } = await import('../src/server.mjs');
  const { createFixtureStore } = await import('../src/store.mjs');
  const store = createFixtureStore();
  store.upsertCustomer('c1', { name: 'x' });
  const edge = await startEdgeServer({
    port: 0, seal: { buildId: 't', capabilities: {} }, probes: [], store,
    auth: async () => ({ ok: true }),
    allowedOrigins: ['https://jw-staging.example'],
  });
  try {
    const base = `http://127.0.0.1:${edge.port}`;
    const allowed = await post(base, '/api/jw/v2/session', { origin: 'https://jw-staging.example' }, { credential: 'whatever' });
    assert.notEqual(allowed.body.error, 'CSRF_ORIGIN_REJECTED', '允许列表中的 Origin 通过守卫（后续逻辑照常）');
    const read = await fetch(`${base}/versionz`, { headers: { origin: 'http://evil.example' } });
    assert.equal(read.status, 200, 'GET 只读面不做 Origin 拦截（无 CORS 头时浏览器读不到响应）');
  } finally {
    await edge.close();
    await up.close();
  }
});
