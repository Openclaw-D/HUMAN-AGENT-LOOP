// S3 测试共享夹具：Edge 全接线（会话+代理+消息+审计+静态 harness）+ 可控上游。
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HARNESS_PUBLIC = path.resolve(EDGE_ROOT, '..', 'D', 'browser-harness', 'public');

// 可控上游：记录收到的请求（路径/凭据头/载荷）；hang=true 时永不应答（触发代理超时路径）。
export function startFixtureUpstream({ hang = false } = {}) {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({
        path: req.url,
        method: req.method,
        credential: req.headers['x-principal-credential'] || null,
        contentType: req.headers['content-type'] || null,
        body: body ? JSON.parse(body) : null,
      });
      if (hang) return; // 永不应答
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, echo: body ? JSON.parse(body) : null, upstreamSaw: received.length }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, received, port: server.address().port, close: () => new Promise((r) => server.close(r)) }));
  });
}

export async function buildEdge({ upstreamPort, proxyTimeoutMs = 300 } = {}) {
  const { startEdgeServer } = await import('../src/server.mjs');
  const { createFixtureStore } = await import('../src/store.mjs');
  const { createSessionStore } = await import('../src/session.mjs');
  const { createAuditSink } = await import('../src/audit.mjs');
  const { createUpstreamProxy } = await import('../src/proxy.mjs');
  const { createMessageRouter } = await import('../src/messages.mjs');
  const { createStaticHandler } = await import('../src/static.mjs');

  const store = createFixtureStore();
  store.upsertCustomer('cust-1001', {
    name: '合成客户一',
    domains: { policy: 'in_progress', credit: 'candidate_ready', commerce: 'in_progress', asset: 'not_started' },
    missing: [{ kind: 'invoice', status: 'missing', owner: 'business' }],
  });

  const auditSink = createAuditSink();
  const sessionStore = createSessionStore({});
  const verifyCredential = async ({ credential }) => (credential === 'tok-demo'
    ? { ok: true, principalId: 'demo-user', roles: ['admin'] }
    : { ok: false, reason: 'PRINCIPAL_UNTRUSTED' });

  const sent = [];
  const deliver = async (m) => {
    sent.push(m);
    return { messageId: `m-${sent.length}`, state: 'sent_local_sink' };
  };

  const proxy = createUpstreamProxy({
    baseUrl: `http://127.0.0.1:${upstreamPort}`,
    credentialFor: (session) => `cred-for-${session.principalId}`,
    timeoutMs: proxyTimeoutMs,
  });
  const messages = createMessageRouter({ deliver, auditSink });
  const staticHandler = createStaticHandler({ rootDir: HARNESS_PUBLIC });

  const started = await startEdgeServer({
    port: 0,
    seal: { buildId: 'test', capabilities: { note: 'test' } },
    probes: [],
    store,
    auth: async () => ({ ok: true }), // 读面放行（S2 已测）；S3 测会话与代理面
    sessionStore,
    verifyCredential,
    proxy,
    messages,
    auditSink,
    staticHandler,
  });
  return { ...started, auditSink, sent, store };
}
