import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, statSync, createReadStream } from 'node:fs';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DecisionStore } from './store.mjs';
import { InputError, object, text } from './analysis.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ROLES = { facilitator: '协调者', contributor: '参与者', observer: '观察者' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
export function createApp({ dbPath = resolve(ROOT, '.run/decisions.sqlite'), frontDir = resolve(ROOT, 'Front/dist') } = {}) {
  const store = new DecisionStore(dbPath), sessions = new Map();
  function send(res, status, data) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); }
  const server = createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-frame-options', 'DENY');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/healthz') {
        store.db.prepare('SELECT count(*) AS n FROM cases').get();
        return send(res, 200, { ok: true, service: 'human-decision-simulator', sourceMode: 'synthetic', storage: 'sqlite', assistantMode: 'simulated', model: 'not_configured' });
      }
      if (!url.pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) throw new InputError('不支持的请求方法', 405, 'METHOD_NOT_ALLOWED');
        const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
        let file = resolve(frontDir, relative || 'index.html');
        if (file !== resolve(frontDir) && !file.startsWith(resolve(frontDir) + sep)) throw new InputError('文件不存在', 404, 'NOT_FOUND');
        if (!existsSync(file) || !statSync(file).isFile()) {
          if (extname(relative)) throw new InputError('文件不存在', 404, 'NOT_FOUND');
          file = resolve(frontDir, 'index.html');
        }
        if (!existsSync(file)) throw new InputError('请先执行 npm run build', 503, 'BUILD_REQUIRED');
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'" });
        if (req.method === 'HEAD') return res.end();
        const stream = createReadStream(file); stream.on('error', () => res.destroy()); stream.pipe(res); return;
      }
      const token = String(req.headers.cookie ?? '').split(';').map(v => v.trim()).find(v => v.startsWith('decision_session='))?.slice('decision_session='.length);
      for (const [k, s] of sessions) if (s.expires < Date.now()) sessions.delete(k);
      let session = token && sessions.get(token);
      let body;
      if (req.method === 'POST') {
        if (req.headers.origin !== `http://${req.headers.host}`) throw new InputError('请求来源不匹配', 403, 'ORIGIN_REJECTED');
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new InputError('需要 JSON 请求', 415, 'JSON_REQUIRED');
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 16384) throw new InputError('请求超过 16KB', 413, 'BODY_TOO_LARGE'); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new InputError('JSON 格式无效'); }
      }
      if (url.pathname === '/api/session' && req.method === 'POST') {
        object(body, ['role', 'displayName'], '模拟参与者');
        if (!Object.hasOwn(ROLES, body.role)) throw new InputError('未知模拟角色');
        const t = randomUUID();
        const displayName = text(body.displayName ?? ROLES[body.role], '参与者代号', 1, 40);
        session = { id: randomUUID(), displayName, role: body.role, label: ROLES[body.role], expires: Date.now() + 8 * 3600000 };
        if (token) sessions.delete(token);
        if (sessions.size >= 1024) sessions.delete(sessions.keys().next().value);
        sessions.set(t, session);
        res.setHeader('set-cookie', `decision_session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
        return send(res, 200, { ok: true, session: { role: session.role, label: session.label, displayName: session.displayName }, sourceMode: 'synthetic' });
      }
      if (!session) throw new InputError('请先选择本机模拟角色', 401, 'SESSION_REQUIRED');
      if (url.pathname === '/api/session' && req.method === 'GET') return send(res, 200, { ok: true, session: { role: session.role, label: session.label, displayName: session.displayName } });
      if (url.pathname === '/api/cases' && req.method === 'GET') return send(res, 200, { ok: true, cases: store.list() });
      const match = url.pathname.match(/^\/api\/cases\/([a-z0-9-]+)(?:\/(analyze|evidence|decide|feedback|discuss|ask))?$/);
      if (match && !match[2] && req.method === 'GET') return send(res, 200, { ok: true, case: store.get(match[1]) });
      if (match?.[2] && req.method === 'POST') return send(res, 200, store.command(match[1], match[2], body, session));
      throw new InputError('接口不存在', 404, 'NOT_FOUND');
    } catch (e) {
      if (res.headersSent) { res.destroy(); return; }
      if (!(e instanceof InputError)) console.error('[decision-simulator] request failed:', e.message);
      send(res, e instanceof InputError ? e.status : 500, { ok: false, error: e instanceof InputError ? e.code : 'INTERNAL_ERROR', message: e instanceof InputError ? e.message : '操作未完成，请检查服务日志' });
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return { server, store, close: () => new Promise(resolveClose => { server.close(() => { store.close(); resolveClose(); }); server.closeIdleConnections(); }) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.DECISION_PORT ?? 48431);
  const app = createApp({ dbPath: process.env.DECISION_DB_PATH ?? resolve(ROOT, '.run/decisions.sqlite') });
  app.server.listen(port, '127.0.0.1', () => console.log(`模拟协作决策服务已启动，port=${port}；仅供本机合成场景。`));
  app.server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? '端口已被占用，保留原进程；请调整 DECISION_PORT。' : e.message); app.store.close(); process.exitCode = 1; });
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (closing) return; closing = true; await app.close(); });
}
