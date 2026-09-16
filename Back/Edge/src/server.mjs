// JW Edge thin 服务（任务04 S1/S2/S3 骨架）：
//   GET  /versionz                              版本封存（buildId/gitSha/sourceDigest/sourceDirty/contractVersion/migrationVersion/capabilities）
//   GET  /healthz/live                          liveness：只表示进程存活，不做任何依赖检查
//   GET  /healthz/ready                         readiness：逐依赖独立检查，DB down 不能包装为业务就绪
//   GET  /api/jw/v2/customers/:id/workspace     客户工作台快照（fixture store seam；真实投影待任务01冻结契约）
//   GET  /api/jw/v2/customers/:id/events        SSE 事件流：至少一次、Last-Event-ID 补取、游标过期→resync
//   POST /api/jw/v2/session                     凭据换不透明会话（服务端持映射；默认失败关闭）
//   POST /api/jw/v2/actions/**                  动作代理：白名单转发固定上游，requestId 必带，凭据不落浏览器
//   POST /api/jw/v2/customers/:id/messages      消息受众路由：customer/internal 分离，内部外发须显式确认+审计
//   GET  /api/jw/v2/audit                       审计只读（会话+audit:read）
//   GET  /harness/**                            browser-harness 静态页（路径穿越防护 + CSP）
// 读路径方法白名单仅 GET；写路径仅显式登记的 POST。未知路径 404。响应一律 no-store。
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readJsonBody } from './proxy.mjs';

const SSE_HEARTBEAT_MS = 15000;

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function parseCustomerId(urlObj) {
  const m = urlObj.pathname.match(/^\/api\/jw\/v2\/customers\/([^/]+)(\/.*)?$/);
  return m ? decodeURIComponent(m[1]) : null;
}

const denyAll = async () => ({ ok: false, reason: 'PRINCIPAL_UNTRUSTED' });

export function createEdgeServer({
  seal,
  probes = [],
  store,
  auth,
  log = () => { },
  // S3 扩展（均可选；未配置时相应路由失败关闭）
  sessionStore = null,
  verifyCredential = null,
  proxy = null,
  messages = null,
  auditSink = null,
  staticHandler = null,
  // CSRF 防护（D17）：额外允许的 Origin（如未来 staging 域名）；默认仅同源（Host 头比对）+ 无头非浏览器客户端
  allowedOrigins = [],
}) {
  // auth 可传 verify 函数或 {verify} 对象；缺省一律失败关闭。
  const verify = typeof auth === 'function' ? auth : (auth?.verify ?? denyAll);
  const sessionOf = (req) => sessionStore?.resolve(req.headers['x-jw-session']);
  const extraOrigins = new Set(allowedOrigins.map((o) => String(o).replace(/\/$/, '')));

  // CSRF 守卫：只作用于写方法（POST）。判据（D17 种子，浏览器层全链路待 S3 剩余）：
  //   1) Sec-Fetch-Site 存在时必须为 same-origin（浏览器真实性信号）；
  //   2) Origin 与 Host 同源 → 放行；在显式允许列表 → 放行；
  //   3) Origin 与 Sec-Fetch-Site 均缺省 → 视为非浏览器客户端（curl/CI/harness），放行；
  //   4) 其余组合（跨站 Origin、null origin、有 Sec-Fetch-Site 却无 Origin）→ 拒绝。
  const csrfCheck = (req) => {
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin') return `sec-fetch-site=${site}`;
    const origin = req.headers.origin;
    if (!origin) return site ? 'sec-fetch-site 存在但 origin 缺失' : null;
    if (origin === 'null') return 'null origin';
    const host = req.headers.host ? String(req.headers.host).toLowerCase() : null;
    try {
      const o = new URL(origin);
      if (host && o.host === host) return null;
      if (extraOrigins.has(origin.replace(/\/$/, ''))) return null;
      return `跨站 origin=${origin.slice(0, 60)}`;
    } catch {
      return 'origin 不可解析';
    }
  };

  const runReadiness = async () => {
    const checks = await Promise.all(probes.map((p) => p().catch((e) => ({ name: p.name || 'probe', ok: false, detail: { error: String(e) } }))));
    return { ok: checks.every((c) => c.ok), checks, capabilities: seal?.capabilities ?? {}, checkedAt: new Date().toISOString() };
  };

  // CORS（任务三跨端口/跨机前端接线）：仅对显式允许列表源（--allowed-origin / JW_EDGE_ALLOWED_ORIGINS）
  // 返回许可头并应答 OPTIONS 预检；缺省不带任何 CORS 头（同源部署形态无需配置，跨站不可访问）。
  const corsHeaders = (req) => {
    const origin = req.headers.origin;
    if (!origin || !extraOrigins.has(String(origin).replace(/\/$/, ''))) return null;
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'content-type, x-jw-session, last-event-id',
      'Access-Control-Max-Age': '600',
      'Vary': 'Origin',
    };
  };

  // 上游/凭据错误映射：Edge 不掩盖内核拒绝——状态码与错误码原样回传（消费面语义）。
  const sendUpstreamError = (res, e) => {
    if (e && e.noCredential) return sendJson(res, 401, { ok: false, error: 'SESSION_REQUIRED', note: 'live 投影需要会话：先 POST /api/jw/v2/session' });
    if (e && e.upstream) return sendJson(res, e.upstream.status, { ok: false, error: e.upstream.code, reason: e.upstream.reason ?? undefined });
    throw e;
  };

  const handleWorkspace = async (req, res, customerId) => {
    const session = sessionOf(req);
    const verdict = await verify({ req, customerId, action: 'workspace:read', session });
    if (!verdict.ok) return sendJson(res, 403, { ok: false, error: verdict.reason || 'FORBIDDEN' });
    let ws;
    try {
      ws = await store.getWorkspace(customerId, { credential: session?.credential });
    } catch (e) {
      return sendUpstreamError(res, e);
    }
    if (!ws) return sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
    return sendJson(res, 200, { ok: true, ...ws });
  };

  const writeSse = (res, event, data, id) => {
    let frame = '';
    if (id) frame += `id: ${id}\n`;
    frame += `event: ${event}\n`;
    frame += `data: ${JSON.stringify(data)}\n\n`;
    res.write(frame);
  };

  const handleEvents = async (req, res, customerId, urlObj) => {
    const session = sessionOf(req);
    const verdict = await verify({ req, customerId, action: 'events:subscribe', session });
    if (!verdict.ok) return sendJson(res, 403, { ok: false, error: verdict.reason || 'FORBIDDEN' });
    let ws;
    try {
      ws = await store.getWorkspace(customerId, { credential: session?.credential });
    } catch (e) {
      return sendUpstreamError(res, e);
    }
    if (!ws) return sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });

    const cursor = urlObj.searchParams.get('cursor') || urlObj.searchParams.get('lastEventId') || req.headers['last-event-id'] || null;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const push = (env) => { if (!closeStream.dead) writeSse(res, 'business', env, env.eventId); };
    const closeStream = { dead: false };
    let unsubscribe = null;
    const heartbeat = setInterval(() => {
      if (!closeStream.dead) res.write(`: hb ${Date.now()}\n\n`);
    }, SSE_HEARTBEAT_MS);

    const finish = () => {
      if (closeStream.dead) return;
      closeStream.dead = true;
      clearInterval(heartbeat);
      if (unsubscribe) unsubscribe();
      try { res.end(); } catch { }
    };
    req.once('close', finish);

    // 无游标：以 workspace 基线游标起步——先订阅（after=基线，内核存储会先补缓冲缺口）再发
    // cursor 帧；客户端记录基线后只消费后续事件，重复帧按 eventId 去重（至少一次语义）。
    if (!cursor) {
      unsubscribe = store.subscribe(customerId, push, { credential: session?.credential, after: ws.eventCursor });
      writeSse(res, 'cursor', { eventCursor: ws.eventCursor, snapshotVersion: ws.snapshotVersion });
    } else {
      const replay = store.replayFrom(customerId, cursor);
      if (replay.expired) {
        // 游标失效：显式 resync，不允许从当前时点静默漏事件（任务04 D05）。
        writeSse(res, 'resync', { reason: replay.reason, hint: 'GET workspace then resubscribe with new eventCursor' });
        return finish();
      }
      unsubscribe = store.subscribe(customerId, push, { credential: session?.credential, after: cursor });
      for (const env of replay.events) writeSse(res, 'business', env, env.eventId);
    }

    log(`[sse] customer=${customerId} cursor=${cursor || '<head>'} source=${ws.source || 'fixture'}`);
  };

  const requireSession = (req, res) => {
    const session = sessionOf(req);
    if (!session) {
      sendJson(res, 401, { ok: false, error: 'SESSION_REQUIRED', note: '先 POST /api/jw/v2/session 换取不透明会话' });
      return null;
    }
    return session;
  };

  const handleSessionExchange = async (req, res) => {
    if (!sessionStore || !verifyCredential) {
      return sendJson(res, 403, { ok: false, error: 'PRINCIPAL_UNTRUSTED', note: '未配置身份验证器，失败关闭' });
    }
    const read = await readJsonBody(req);
    if (read.err) return sendJson(res, 400, { ok: false, error: read.err });
    const credential = read.body.credential;
    if (typeof credential !== 'string' || credential.length === 0 || credential.length > 256) {
      return sendJson(res, 400, { ok: false, error: 'INVALID_CREDENTIAL' });
    }
    const result = await sessionStore.exchange(verifyCredential, credential);
    if (!result.ok) return sendJson(res, 403, { ok: false, error: result.reason || 'PRINCIPAL_UNTRUSTED' });
    // 只返回不透明会话；凭据原文不再出现于任何响应。
    return sendJson(res, 200, { ok: true, session: result.session });
  };

  const handleMessages = async (req, res, customerId) => {
    const session = requireSession(req, res);
    if (!session) return;
    const verdict = await verify({ req, customerId, action: 'messages:send', session });
    if (!verdict.ok) return sendJson(res, 403, { ok: false, error: verdict.reason || 'FORBIDDEN' });
    const read = await readJsonBody(req);
    if (read.err) return sendJson(res, 400, { ok: false, error: read.err });
    const result = await messages.handle({ session, customerId, body: read.body, log });
    return sendJson(res, result.status, result.body);
  };

  return http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, 'http://localhost');
    const pathname = urlObj.pathname;
    try {
      const cors = corsHeaders(req);
      if (cors) {
        const origWriteHead = res.writeHead.bind(res);
        res.writeHead = (status, headers) => origWriteHead(status, { ...cors, ...(headers || {}) });
      }
      if (req.method === 'OPTIONS') {
        if (!cors) return sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED', note: '源不在允许列表（--allowed-origin）' });
        res.writeHead(204);
        res.end();
        return;
      }
      const customerId = parseCustomerId(urlObj);
      const knownRead = pathname === '/versionz' || pathname === '/healthz/live' || pathname === '/healthz/ready'
        || (customerId && (pathname.endsWith('/workspace') || pathname.endsWith('/events')));

      if (req.method !== 'GET' && knownRead) {
        return sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED', allow: 'GET' });
      }

      if (req.method === 'GET') {
        if (pathname === '/versionz') return sendJson(res, 200, seal);
        if (pathname === '/healthz/live') return sendJson(res, 200, { ok: true, liveness: true, uptimeSec: Math.round(process.uptime()) });
        if (pathname === '/healthz/ready') return sendJson(res, 200, await runReadiness());

        if (customerId && pathname.endsWith('/workspace')) return await handleWorkspace(req, res, customerId);
        if (customerId && pathname.endsWith('/events')) return await handleEvents(req, res, customerId, urlObj);

        if (pathname === '/api/jw/v2/audit') {
          const session = requireSession(req, res);
          if (!session) return;
          const verdict = await verify({ req, customerId: null, action: 'audit:read', session });
          if (!verdict.ok) return sendJson(res, 403, { ok: false, error: verdict.reason || 'FORBIDDEN' });
          const limit = Math.min(Number(urlObj.searchParams.get('limit')) || 100, 500);
          return sendJson(res, 200, { ok: true, entries: auditSink ? auditSink.list({ limit, customerId: urlObj.searchParams.get('customerId') || undefined }) : [] });
        }

        // 回执对账（C05）：动作丢响应后客户端先查回执再决定重试；A 按 (tenant, principal) 归属过滤。
        if (pathname.startsWith('/api/jw/v2/receipts/')) {
          const session = requireSession(req, res);
          if (!session) return;
          const requestId = pathname.slice('/api/jw/v2/receipts/'.length);
          if (!requestId || requestId.includes('/')) return sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
          const kernelBase = proxy?.upstreamBaseUrl ?? `http://127.0.0.1:${process.env.JW_A_PORT || 48180}`;
          try {
            const upRes = await fetch(`${kernelBase.replace(/\/$/, '')}/api/v2/receipts/${encodeURIComponent(requestId)}`, {
              headers: { 'x-principal-credential': session.credential },
              signal: AbortSignal.timeout(5000),
            });
            let body = null;
            try { body = await upRes.json(); } catch { }
            return sendJson(res, upRes.status, body ?? { ok: upRes.status < 400 });
          } catch (e) {
            const reason = e.name === 'TimeoutError' ? 'timeout' : String(e.cause?.code || e.message);
            return sendJson(res, 502, { ok: false, error: 'UPSTREAM_UNKNOWN', requestId, reason });
          }
        }

        if (staticHandler && (pathname === '/harness' || pathname.startsWith('/harness/'))) {
          return staticHandler.handle({ res, urlObj });
        }

        return sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
      }

      if (req.method === 'POST') {
        // 写路由 CSRF 守卫：所有 POST 一律先过 Origin/Sec-Fetch-Site 校验（GET 只读面不受影响）。
        const csrfFail = csrfCheck(req);
        if (csrfFail) {
          log(`[csrf] rejected POST ${pathname}: ${csrfFail}`);
          return sendJson(res, 403, { ok: false, error: 'CSRF_ORIGIN_REJECTED', detail: csrfFail });
        }
        if (pathname === '/api/jw/v2/session') return await handleSessionExchange(req, res);
        if (customerId && pathname.endsWith('/messages')) {
          if (!messages) return sendJson(res, 501, { ok: false, error: 'NOT_CONFIGURED' });
          return await handleMessages(req, res, customerId);
        }
        if (pathname.startsWith('/api/jw/v2/actions/')) {
          if (!proxy) return sendJson(res, 501, { ok: false, error: 'NOT_CONFIGURED' });
          const session = requireSession(req, res);
          if (!session) return;
          return await proxy.handle({ res, urlObj, session, log });
        }
        return sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
      }

      return sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
    } catch (e) {
      log(`[error] ${req.method} ${pathname}: ${e.message}`);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'INTERNAL' });
      else try { res.end(); } catch { }
    }
  });
}

// 供 edge-start.mjs 与测试共用的启动封装。heartbeatPath/marker 用于安全停止的启动标识复核。
export async function startEdgeServer({
  port = 48200,
  host = '127.0.0.1',
  heartbeatPath = null,
  marker = null,
  ...deps
}) {
  const server = createEdgeServer(deps);
  let heartbeatTimer = null;
  const touch = () => {
    if (!heartbeatPath || !marker) return;
    writeFileSync(heartbeatPath, JSON.stringify({
      pid: process.pid, marker, port, startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(),
    }));
  };
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const actualPort = server.address().port;
  if (heartbeatPath && marker) {
    mkdirSync(path.dirname(heartbeatPath), { recursive: true });
    touch();
    heartbeatTimer = setInterval(touch, 5000);
  }
  const shutdown = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('SIGBREAK', shutdown);
  return { server, port: actualPort, close: () => new Promise((r) => server.close(r)) };
}

// 直接运行：node src/server.mjs [--port 48200] [--live] [--kernel-port 48180] [--db-port 15442]
//           [--auth-file path] [--fixture-auth] [--marker xxx --heartbeat path]
// --live：真实内核投影（kernel-store）+ 会话必需 + 身份目录（--auth-file）+ 凭据服务端映射。
//         缺 --auth-file 时会话交换失败关闭（不启用 --fixture-auth 即无合成身份）。
// 默认（无 --live）：fixture 存储语义自检形态（E0 测试兼容），能力位如实标注 not_wired。
export async function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
  }
  const port = Number(args.port || process.env.JW_EDGE_PORT || 48200);
  const kernelPort = Number(args['kernel-port'] || process.env.JW_A_PORT || 48180);
  const live = args.live === true;
  const { collectVersionSeal } = await import('./version.mjs');
  const { tcpProbe, httpProbe, aKernelReadyPass } = await import('./probes.mjs');
  const { createSessionStore } = await import('./session.mjs');
  const { createAuditSink } = await import('./audit.mjs');
  const { createUpstreamProxy } = await import('./proxy.mjs');
  const { createMessageRouter } = await import('./messages.mjs');
  const { createStaticHandler } = await import('./static.mjs');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

  const capabilities = live
    ? {
      model: 'not_configured',
      video: 'blocked_external_access',
      recording: 'blocked_external_access',
      policy: 'simulation_rule_pack_v1.0.0 (boundary=simulation_only)',
      credit: 'v2_kernel (policy bits synthetic; 生产矩阵须公司批准录入)',
      note: '能力位逐一独立报告，永不汇总为 all_ok；受限能力见 contract/consumed-surface-v1.json',
    }
    : {
      model: 'not_configured', video: 'not_wired', recording: 'not_wired', policy: 'not_wired', credit: 'not_wired',
      note: 'fixture 语义自检形态（未启用 --live）',
    };
  const seal = await collectVersionSeal({ repoRoot, capabilities });
  const probes = [
    httpProbe({ name: 'kernel-a', url: `http://127.0.0.1:${kernelPort}/healthz`, pass: aKernelReadyPass }),
    tcpProbe({ name: 'db', port: Number(args['db-port'] || 15442) }),
  ];

  const kernelBase = `http://127.0.0.1:${kernelPort}`;

  // 存储：live = 真实内核投影；否则 fixture（传输语义自检）。
  let store;
  if (live) {
    const { createKernelStore } = await import('./kernel-store.mjs');
    store = createKernelStore({ baseUrl: kernelBase, log: (m) => console.error(m) });
  } else {
    const { createFixtureStore } = await import('./store.mjs');
    store = createFixtureStore();
  }

  // 身份目录（live）：--auth-file JSON {entries:[{credential, principalId, roles}]}; 只存服务端内存。
  // 交换时以 A 只读探针（/api/v2/receipts/__jw-edge-probe__）复核凭据在 A 目录仍有效——目录与 A 双重校验。
  const loadDirectory = async (p) => {
    const fs = await import('node:fs');
    const { createHash } = await import('node:crypto');
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    const map = new Map();
    for (const e of parsed.entries ?? []) {
      if (typeof e.credential !== 'string' || typeof e.principalId !== 'string') continue;
      map.set(createHash('sha256').update(e.credential).digest('hex'), { principalId: e.principalId, roles: Array.isArray(e.roles) ? e.roles : [] });
    }
    return map;
  };
  const directory = live && args['auth-file'] ? await loadDirectory(String(args['auth-file'])) : null;
  const probeKernelCredential = async (credential) => {
    try {
      const r = await fetch(`${kernelBase}/api/v2/receipts/${encodeURIComponent('__jw-edge-probe__')}`, {
        headers: { 'x-principal-credential': credential }, signal: AbortSignal.timeout(4000),
      });
      return r.status === 200;
    } catch { return false; }
  };
  const liveVerifier = (live && directory)
    ? async ({ credential }) => {
      const { createHash } = await import('node:crypto');
      const entry = directory.get(createHash('sha256').update(credential).digest('hex'));
      if (!entry) return { ok: false, reason: 'PRINCIPAL_UNTRUSTED' };
      if (!(await probeKernelCredential(credential))) return { ok: false, reason: 'PRINCIPAL_UNTRUSTED', note: 'A 目录探针未通过' };
      return { ok: true, principalId: entry.principalId, roles: entry.roles };
    }
    : null;

  // 合成演示身份（仅 --fixture-auth 时启用）：仿 A 内核 tok-* 公开合成凭据模式，禁止用于真实身份。
  const fixtureVerifier = args['fixture-auth']
    ? async ({ credential }) => (credential === 'harness-demo-cred'
      ? { ok: true, principalId: 'harness-admin', roles: ['admin'] }
      : { ok: false, reason: 'PRINCIPAL_UNTRUSTED' })
    : null;
  const verifyCredential = live ? liveVerifier : fixtureVerifier;

  // workspace/events 鉴权：live = 会话必需（真实客户/租户授权由 A 每请求裁决，Edge 不缓存）；
  // fixture = 语义自检放行。
  const scopeAuth = live
    ? async ({ session }) => (session ? { ok: true, principalId: session.principalId } : { ok: false, reason: 'SESSION_REQUIRED' })
    : (args['fixture-auth'] && fixtureVerifier
      ? async ({ session }) => (session ? { ok: true, principalId: session.principalId } : { ok: false, reason: 'PRINCIPAL_UNTRUSTED' })
      : async () => ({ ok: true }));

  // E0 消息投递 seam：内存 sink；真实通道（企微客服/存档）属任务02。
  const sentMessages = [];
  const deliver = async (msg) => {
    const messageId = `fixture-${sentMessages.length + 1}`;
    sentMessages.push({ ...msg, messageId });
    return { messageId, state: 'sent_local_sink' };
  };

  const auditSink = createAuditSink();
  const sessionStore = createSessionStore({});
  const proxy = createUpstreamProxy({
    baseUrl: kernelBase,
    // live：转发会话建立时服务端留存的上游凭据（浏览器只见不透明会话）；
    // fixture：E0 占位（真实凭据映射随 --live 落地）。
    credentialFor: live ? (session) => session.credential : (session) => `session:${session.principalId}`,
  });
  const messages = createMessageRouter({ deliver, auditSink });

  const harnessDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'D', 'browser-harness', 'public');
  const staticHandler = createStaticHandler({ rootDir: harnessDir });

  const started = await startEdgeServer({
    port, seal, probes, store,
    auth: scopeAuth,
    sessionStore, verifyCredential, proxy, messages, auditSink, staticHandler,
    // CSRF 额外允许源：--allowed-origin 可重复，或 JW_EDGE_ALLOWED_ORIGINS 逗号分隔（staging 域名用）
    allowedOrigins: [
      ...argv.flatMap((a, i) => (a === '--allowed-origin' && argv[i + 1] && !argv[i + 1].startsWith('--') ? [argv[i + 1]] : [])),
      ...(process.env.JW_EDGE_ALLOWED_ORIGINS ? process.env.JW_EDGE_ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : []),
    ],
    heartbeatPath: args.heartbeat || null, marker: args.marker || null,
    log: (m) => console.error(m),
  });
  console.log(`[edge] jw-edge listening on http://127.0.0.1:${started.port} (pid=${process.pid}) mode=${live ? 'live(kernel)' : 'fixture'}`);
  if (live) {
    console.log(`[edge] live：A 内核 ${kernelBase}；workspace/events 需会话；身份目录=${directory ? 'auth-file' : '未配置(会话交换失败关闭)'}`);
    console.log('[edge] 消费面契约：Back/Edge/contract/consumed-surface-v1.json（上游漂移将原样报错，不伪装）');
  } else {
    console.log('[edge] fixture 语义自检形态：加 --live 接真实内核投影');
  }
  console.log('[edge] readiness 目标：A内核 /healthz(db=up) + PG TCP；当前环境未就绪时 /healthz/ready 会如实报 not ready');
  console.log(`[edge] harness: http://127.0.0.1:${started.port}/harness/  fixture-auth=${!live && fixtureVerifier ? 'ON(仅合成演示身份)' : 'OFF(失败关闭)'}`);
}

// 直接运行入口（node src/server.mjs --port ...）；被 import 时不启动。
const invoked = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (invoked) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`[edge] 启动失败: ${e.message}`);
    process.exit(2);
  });
}
