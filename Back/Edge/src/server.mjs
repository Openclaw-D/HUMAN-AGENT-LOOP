// JW Edge thin 服务（任务04 S1/S2/S3 骨架）：
//   GET  /versionz                              版本封存（buildId/gitSha/sourceDigest/sourceDirty/contractVersion/migrationVersion/capabilities）
//   GET  /healthz/live                          liveness：只表示进程存活，不做任何依赖检查
//   GET  /healthz/ready                         readiness：逐依赖独立检查，DB down 不能包装为业务就绪
//   GET  /api/jw/v2/customers/:id/workspace     客户工作台快照（fixture store seam；真实投影待任务01冻结契约）
//   GET  /api/jw/v2/customers/:id/events        SSE 事件流：至少一次、Last-Event-ID 补取、游标过期→resync
//   POST /api/jw/v2/session                     凭据换不透明会话（服务端持映射；默认失败关闭）
//   POST /api/jw/v2/actions/**                  动作代理：白名单转发固定上游，requestId 必带，凭据不落浏览器
//   POST /api/jw/v2/customers/:id/messages      消息受众路由：customer/internal 分离，内部外发须显式确认+审计
//   GET  /api/jw/v2/customers/:id/messages      消息线程读（goal-03e）：受众按会话角色裁决，?after 增量续拉
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

// goal-03c：本实例经手兑换的客户联系人凭据登记（A 动态身份的本地镜像，仅内存 sha256 指纹）。
// 语义：live 校验 = 静态目录 ∪ 兑换登记，且都必须通过 A 目录探针；A 撤权级联后探针失败即终止。
const redeemedDirectory = { byHash: new Map() };

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
  readProxy = null, // goal-03c：GET 只读透传（白名单；A 是唯一授权裁决方）
  connectorsProxy = null, // goal-03d：处理通道（Connectors IR-02-C）写面代理（X-Service-Token 服务端持有）
  connectorsReadProxy = null, // goal-03d：处理通道读面代理（分段进度/任务回执/原件预览）
  messages = null,
  messageStore = null, // goal-03e：页内消息线程存储（GET 读端点；发送侧入栈在消息路由内）
  auditSink = null,
  identityDirectory = null, // goal-03c：受控身份目录 {list:[{principalId,roles,label,demo}], byPrincipal:Map}（不含凭据明文于响应）
  staticHandler = null,
  frontHandler = null, // goal-03 C3：同源受控前端（--serve-front <dir>；仅非 API 路径，SPA 回退 index.html）
  // CSRF 防护（D17）：额外允许的 Origin（如未来 staging 域名）；默认仅同源（Host 头比对）+ 无头非浏览器客户端
  allowedOrigins = [],
}) {
  // auth 可传 verify 函数或 {verify} 对象；缺省一律失败关闭。
  const verify = typeof auth === 'function' ? auth : (auth?.verify ?? denyAll);
  const sessionOf = (req) => sessionStore?.resolve(req.headers['x-jw-session']);
  const extraOrigins = new Set(allowedOrigins.map((o) => String(o).replace(/\/$/, '')));

  // CSRF 守卫（任务03 C2/X08 修复 + T6 裁决收紧）：只作用于写方法（POST）。判定顺序——
  //   1) Origin 与 Host 同源 → 放行；
  //   2) Origin 在显式允许列表 → 放行（先于 Sec-Fetch-Site 判定：合法跨端口/staging 浏览器
  //      会带 sec-fetch-site=cross-site，不得被 same-site/cross-site 条件先拦——X08 反例修复）；
  //   3) Origin 与 Sec-Fetch-Site 均缺省 → 非浏览器客户端（curl/CI/harness），放行（身份由会话承担）；
  //   4) Sec-Fetch-Site=same-origin：无 Origin（X08 客户端被代理剥头）→ 放行；
  //      携带 Origin 时必须与 Host 同源或在允许列表——声明与信号不一致仍拒绝（T6 裁决，防伪造声明）；
  //   5) 其余（跨站 Origin、same-site 未列白名单、null origin、有 site 无 origin 非 same-origin）→ 拒绝。
  const csrfCheck = (req) => {
    const site = req.headers['sec-fetch-site'] ? String(req.headers['sec-fetch-site']) : null;
    const origin = req.headers.origin ? String(req.headers.origin) : null;
    const host = req.headers.host ? String(req.headers.host).toLowerCase() : null;
    if (origin && origin !== 'null' && host) {
      try {
        if (new URL(origin).host.toLowerCase() === host) return null;
      } catch { /* 落到下方拒绝 */ }
    }
    if (origin && extraOrigins.has(origin.replace(/\/$/, ''))) return null;
    if (!origin && !site) return null;
    if (site === 'same-origin') {
      if (!origin) return null; // X08：same-origin 声明 + Origin 被中间层剥除
      return `origin=${origin.slice(0, 60)} sec-fetch-site=same-origin 声明与 Origin 不一致`;
    }
    return `origin=${origin ? origin.slice(0, 60) : '<缺>'} sec-fetch-site=${site ?? '<缺>'}`;
  };

  const runReadiness = async () => {
    const checks = await Promise.all(probes.map((p) => p().catch((e) => ({ name: p.name || 'probe', ok: false, detail: { error: String(e) } }))));
    // 聚合语义：advisory 检查（如"处理通道未配置"）如实显示但不参与聚合——Edge 的 ok 表示
    // "已配置依赖全部就绪"；全链就绪由交付编排（delivery-up）在通道作为必需依赖时把关。
    const gating = checks.filter((c) => !c.advisory);
    return { ok: gating.every((c) => c.ok), checks, capabilities: seal?.capabilities ?? {}, checkedAt: new Date().toISOString() };
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
      ws = await store.getWorkspace(customerId, { credential: session?.credential, principalId: session?.principalId });
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

  // 慢客户端背压上限（C1.5）：Node 缓冲的超限即判定为跟不上实时流——显式 resync 后断开，
  // 客户端带游标重连补取；不以无界内存维持假实时。
  const MAX_SSE_PENDING_BYTES = 256 * 1024;

  const handleEvents = async (req, res, customerId, urlObj) => {
    const session = sessionOf(req);
    const verdict = await verify({ req, customerId, action: 'events:subscribe', session });
    if (!verdict.ok) return sendJson(res, 403, { ok: false, error: verdict.reason || 'FORBIDDEN' });
    let ws;
    try {
      ws = await store.getWorkspace(customerId, { credential: session?.credential, principalId: session?.principalId });
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

    const closeStream = { dead: false };
    const hadSession = Boolean(session);
    let unsubscribe = null;
    const heartbeat = setInterval(() => {
      if (closeStream.dead) return;
      // 会话生命周期复检（C1.2）：TTL 过期/被撤销 → auth 帧后终止，长连接不豁免
      //（仅对建立时确有会话的流；fixture 放行形态无会话概念，不受此检影响）
      if (hadSession && sessionStore && !sessionOf(req)) {
        writeSse(res, 'auth', { code: 'SESSION_EXPIRED', note: '会话已过期或被撤销：终止订阅，请重新认证' });
        log(`[sse] session expired mid-stream customer=${customerId}`);
        return finish();
      }
      res.write(`: hb ${Date.now()}\n\n`);
    }, SSE_HEARTBEAT_MS);

    const finish = () => {
      if (closeStream.dead) return;
      closeStream.dead = true;
      clearInterval(heartbeat);
      if (unsubscribe) unsubscribe();
      try { res.end(); } catch { }
    };
    req.once('close', finish);

    // 授权事件分发（C1.1/C1.2）：回调只收本身份桶的事件；凭据被 A 拒绝（撤权/过期）→
    // auth 帧后终止本连接——不因其他身份仍有权限而继续推送。
    const push = (env) => {
      if (closeStream.dead) return;
      if (res.writableLength > MAX_SSE_PENDING_BYTES) {
        writeSse(res, 'resync', { reason: 'slow_client_overflow', hint: 'GET workspace then resubscribe with eventCursor' });
        return finish();
      }
      writeSse(res, 'business', env, env.eventId);
    };
    const onAuthFail = (code) => {
      if (closeStream.dead) return;
      writeSse(res, 'auth', { code: code || 'EVENTS_UNAUTHORIZED', note: '权限变更或凭据失效：终止订阅，请重新认证' });
      log(`[sse] auth-terminated customer=${customerId} code=${code}`);
      finish();
    };

    // 无游标：以 workspace 基线游标起步——先订阅（after=基线，内核存储会先补缓冲缺口）再发
    // cursor 帧；客户端记录基线后只消费后续事件，重复帧按 eventId 去重（至少一次语义）。
    if (!cursor) {
      unsubscribe = store.subscribe(customerId, push, { credential: session?.credential, principalId: session?.principalId, after: ws.eventCursor, onAuthFail });
      writeSse(res, 'cursor', { eventCursor: ws.eventCursor, snapshotVersion: ws.snapshotVersion });
    } else {
      const replay = store.replayFrom(customerId, cursor, { credential: session?.credential, principalId: session?.principalId });
      if (replay.expired) {
        // 游标失效：显式 resync，不允许从当前时点静默漏事件（任务04 D05）。
        writeSse(res, 'resync', { reason: replay.reason, hint: 'GET workspace then resubscribe with new eventCursor' });
        return finish();
      }
      unsubscribe = store.subscribe(customerId, push, { credential: session?.credential, principalId: session?.principalId, after: cursor, onAuthFail });
      for (const env of replay.events) writeSse(res, 'business', env, env.eventId);
    }

    log(`[sse] customer=${customerId} principal=${session?.principalId ?? 'unknown'} cursor=${cursor || '<head>'} source=${ws.source || 'fixture'}`);
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
    // 两种受控登录（goal-03c）：{credential} 手输凭据；{principalId} 受控身份目录选择
    //（凭据由 Edge 服务端按目录查得，绝不回传）。两者都过同一 verifyCredential（live 下含 A 目录探针）。
    let credential = typeof read.body.credential === 'string' ? read.body.credential : null;
    if (!credential && typeof read.body.principalId === 'string') {
      const entry = identityDirectory?.byPrincipal?.get(read.body.principalId);
      if (!entry) return sendJson(res, 403, { ok: false, error: 'PRINCIPAL_UNTRUSTED', note: 'principalId 不在受控身份目录中' });
      credential = entry.credential;
    }
    if (typeof credential !== 'string' || credential.length === 0 || credential.length > 256) {
      return sendJson(res, 400, { ok: false, error: 'INVALID_CREDENTIAL' });
    }
    const result = await sessionStore.exchange(verifyCredential, credential);
    if (!result.ok) return sendJson(res, 403, { ok: false, error: result.reason || 'PRINCIPAL_UNTRUSTED' });
    // 只返回不透明会话；凭据原文不再出现于任何响应。
    return sendJson(res, 200, { ok: true, session: result.session });
  };

  // 受控身份目录（goal-03c 路径一）：只列 principalId/roles/label/demo 元数据，凭据永不外泄；
  // 未配置目录（既无 --auth-file 也非 fixture）→ 404 失败关闭，登录页退化为仅手输凭据。
  const handleIdentities = async (res) => {
    if (!identityDirectory) return sendJson(res, 404, { ok: false, error: 'IDENTITY_DIRECTORY_NOT_CONFIGURED', note: '未配置受控身份目录：仅支持手输凭据登录' });
    return sendJson(res, 200, { ok: true, identities: identityDirectory.list });
  };

  // 客户目录（goal-03c 路径一）：上游 A 尚无清单端点（IR-03-1）。前向兼容——探测上游
  // GET /api/v2/customers；上游 404/405（未实现）→ 501 显式缺口 + 接口编号，不伪造目录。
  const handleDirectory = async (req, res, urlObj) => {
    const session = requireSession(req, res);
    if (!session) return;
    if (!readProxy) {
      return sendJson(res, 501, { ok: false, error: 'UPSTREAM_DIRECTORY_NOT_AVAILABLE', interfaceRequest: 'IR-03-1', note: 'A 尚无客户清单端点：目录页使用搜索（按客户标识直查）/新建/最近访问' });
    }
    try {
      const upRes = await fetch(`${readProxy.upstreamBaseUrl.replace(/\/$/, '')}/api/v2/customers${urlObj.search || ''}`, {
        headers: { 'X-Principal-Credential': session.credential },
        signal: AbortSignal.timeout(5000),
      });
      if (upRes.status === 404 || upRes.status === 405) {
        return sendJson(res, 501, { ok: false, error: 'UPSTREAM_DIRECTORY_NOT_AVAILABLE', interfaceRequest: 'IR-03-1', note: 'A 尚无客户清单端点：目录页使用搜索（按客户标识直查）/新建/最近访问' });
      }
      const text = await upRes.text();
      return sendJson(res, upRes.status, text ? JSON.parse(text) : { ok: upRes.status < 400 });
    } catch (e) {
      const reason = e.name === 'TimeoutError' ? 'timeout' : String(e.cause?.code || e.message);
      return sendJson(res, 502, { ok: false, error: 'UPSTREAM_UNKNOWN', reason });
    }
  };

  // 受限邀请兑换（A CONTRACT §11 G2 的唯一匿名 v2 写口）：无会话必需（受邀人尚未有身份），
  // 仍过 CSRF 写口守卫。code→凭据明文只经此一次转发给兑换者本人，Edge 不落日志、不存储；
  // 已用/撤销/过期错误语义（409/410）原样透传。requestId 对账锚点由 A 记录。
  const handleInvitationRedeem = async (req, res) => {
    const read = await readJsonBody(req);
    if (read.err) return sendJson(res, 400, { ok: false, error: read.err });
    const code = read.body.code;
    if (typeof code !== 'string' || code.length < 8 || code.length > 128) {
      return sendJson(res, 400, { ok: false, error: 'INVALID_INVITATION_CODE' });
    }
    if (!proxy) return sendJson(res, 501, { ok: false, error: 'NOT_CONFIGURED' });
    const upstreamUrl = `${proxy.upstreamBaseUrl.replace(/\/$/, '')}/api/v2/invitations/redeem`;
    try {
      const upRes = await fetch(upstreamUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, ...(typeof read.body.requestId === 'string' ? { requestId: read.body.requestId } : {}) }),
        signal: AbortSignal.timeout(8000),
      });
      const text = await upRes.text();
      // A 是客户动态身份的唯一权威；Edge 仅登记"经本实例兑换"的凭据指纹，供会话交换的
      // 目录侧双重校验使用（凭据明文只进服务端内存，永不落日志/响应外）。
      try {
        const okBody = text ? JSON.parse(text) : null;
        if (upRes.status === 200 && okBody?.ok === true && typeof okBody.credential === 'string' && typeof okBody.principalId === 'string') {
          const { createHash } = await import('node:crypto');
          redeemedDirectory.byHash.set(createHash('sha256').update(String(okBody.credential)).digest('hex'), {
            principalId: String(okBody.principalId),
            roles: ['customer'],
            label: `客户联系人 ${String(okBody.customerId ?? '')}（${String(okBody.role ?? 'customer')}）`,
            demo: false,
          });
        }
      } catch { /* 登记失败不影响兑换响应 */ }
      log(`[redeem] -> ${upRes.status}（凭据明文不落日志）`);
      return sendJson(res, upRes.status, text ? JSON.parse(text) : { ok: upRes.status < 400 });
    } catch (e) {
      const reason = e.name === 'TimeoutError' ? 'timeout' : String(e.cause?.code || e.message);
      return sendJson(res, 502, { ok: false, error: 'UPSTREAM_UNKNOWN', reason });
    }
  };

  const handleMessages = async (req, res, customerId) => {
    const session = requireSession(req, res);
    if (!session) return;
    const verdict = await verify({ req, customerId, action: 'messages:send', session });
    if (!verdict.ok) return sendJson(res, 403, { ok: false, error: verdict.reason || 'FORBIDDEN' });
    const read = await readJsonBody(req);
    if (read.err) return sendJson(res, 400, { ok: false, error: read.err });
    // 内部内容外发豁免不是万能开关（C2.5/U07）：除受众守卫外，还须单独持
    // messages:external-send 权限（Edge 权限点，默认拒绝）；审计由消息路由强制落。
    if (read.body.audience === 'customer' && read.body.internalContent === true && read.body.confirmExternalSend === true) {
      const gv = await verify({ req, customerId, action: 'messages:external-send', session });
      if (!gv.ok) {
        return sendJson(res, 403, {
          ok: false,
          error: 'EXTERNAL_SEND_NOT_PERMITTED',
          note: '内部内容外发需要显式外发权限（messages:external-send），confirmExternalSend 本身不构成豁免',
        });
      }
    }
    const result = await messages.handle({ session, customerId, body: read.body, log });
    return sendJson(res, result.status, result.body);
  };

  // 页内消息线程读（goal-03e，DEF-G04N-05）：GET /api/jw/v2/customers/:id/messages
  // 会话必需 + messages:read + 目标客户对本会话凭据可读（与发送同源校验，fail-closed）。
  // 受众边界由服务端强制：customer-only 会话只见 audience=customer（显式请求 internal → 403，
  // 不以静默过滤掩盖越权）；?after=<cursor> 增量续拉（不漏不重），?limit 有界（≤500）。
  const handleMessagesRead = async (req, res, customerId, urlObj) => {
    const session = requireSession(req, res);
    if (!session) return;
    const verdict = await verify({ req, customerId, action: 'messages:read', session });
    if (!verdict.ok) return sendJson(res, 403, { ok: false, error: verdict.reason || 'FORBIDDEN' });
    if (!messageStore) return sendJson(res, 501, { ok: false, error: 'NOT_CONFIGURED', note: '消息线程读面未配置' });
    const customerOnly = (session.roles ?? []).length > 0 && (session.roles ?? []).every((r) => r === 'customer');
    const audienceParam = urlObj.searchParams.get('audience');
    if (audienceParam !== null && audienceParam !== 'customer' && audienceParam !== 'internal') {
      return sendJson(res, 400, { ok: false, error: 'INVALID_AUDIENCE', note: 'audience 必须是 customer|internal' });
    }
    if (customerOnly && audienceParam === 'internal') {
      return sendJson(res, 403, { ok: false, error: 'FORBIDDEN', note: '客户联系人身份不可读内部协作消息' });
    }
    const audience = customerOnly ? 'customer' : audienceParam;
    // 目标可读校验（与发送面同源）：live 用 store.checkCustomer（A 逐请求裁决）；fixture 放行。
    if (typeof store?.checkCustomer === 'function') {
      const target = await store.checkCustomer(customerId, { credential: session.credential }).catch((e) => ({ ok: false, code: 'UPSTREAM_UNKNOWN', status: 502, reason: String(e?.message || e) }));
      if (!target?.ok) {
        const status = target?.status === 403 ? 403 : target?.status === 404 ? 404 : 502;
        return sendJson(res, status, { ok: false, error: target?.code || 'TARGET_UNVERIFIED', note: '目标客户对本会话不可读或校验失败：不返回消息' });
      }
    }
    const { messages: items, cursor } = messageStore.list(customerId, {
      audience,
      afterSeq: Number(urlObj.searchParams.get('after')) || 0,
      limit: Number(urlObj.searchParams.get('limit')) || 200,
    });
    return sendJson(res, 200, { ok: true, customerId, audience: audience ?? 'all', messages: items, cursor });
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

        if (pathname === '/api/jw/v2/auth/identities') return await handleIdentities(res);
        if (pathname === '/api/jw/v2/customers') return await handleDirectory(req, res, urlObj);
        if (customerId && pathname.endsWith('/messages')) return await handleMessagesRead(req, res, customerId, urlObj);

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

        // 大历史分页（C1.3/U04）：A 的 after/limit 逐页透传，逐请求凭据鉴权；
        // fixture 存储无上游分页源 → 如实 NOT_SUPPORTED，不伪造历史。
        if (customerId && pathname.endsWith('/events-page')) {
          const session = requireSession(req, res);
          if (!session) return;
          if (typeof store.pageEvents !== 'function') {
            return sendJson(res, 501, { ok: false, error: 'NOT_SUPPORTED', note: '分页事件直读仅 live（kernel）模式提供' });
          }
          const verdict = await verify({ req, customerId, action: 'events:read', session });
          if (!verdict.ok) return sendJson(res, 403, { ok: false, error: verdict.reason || 'FORBIDDEN' });
          try {
            const page = await store.pageEvents(customerId, {
              afterSeq: urlObj.searchParams.get('afterSeq') || '0',
              limit: Number(urlObj.searchParams.get('limit')) || 200,
            }, { credential: session.credential, principalId: session.principalId });
            return sendJson(res, 200, page);
          } catch (e) {
            return sendUpstreamError(res, e);
          }
        }

        if (pathname.startsWith('/api/jw/v2/')) {
          // goal-03d 分流：处理通道（Connectors IR-02-C）读面走服务令牌代理；其余仍为 A 读面。
          if (pathname.startsWith('/api/jw/v2/connectors/')) {
            // 未配置处理通道时显式 503，不落入 A 读面误报 PROXY_ROUTE_NOT_DECLARED（任务04 问题3 根因链）。
            if (!connectorsReadProxy) {
              return sendJson(res, 503, { ok: false, error: 'CHANNEL_NOT_CONFIGURED', note: '处理通道未配置（--connectors-url + --connectors-token-file）：处理分段/预览/人工路线如实标未接入' });
            }
            const session = requireSession(req, res);
            if (!session) return;
            return await connectorsReadProxy.handle({ res, urlObj, session, log });
          }
          if (readProxy) {
            const session = requireSession(req, res);
            if (!session) return;
            return await readProxy.handle({ res, urlObj, session, log });
          }
        }

        if (staticHandler && (pathname === '/harness' || pathname.startsWith('/harness/'))) {
          return staticHandler.handle({ res, urlObj });
        }

        // 同源受控前端（goal-03 C3）：只接管非 API/健康/审计路径；API 未知路径保持 JSON 404。
        if (frontHandler && !pathname.startsWith('/api/') && pathname !== '/versionz' && !pathname.startsWith('/healthz')) {
          return frontHandler.handle({ res, urlObj });
        }

        return sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
      }

      if (req.method === 'POST' || req.method === 'DELETE') {
        // 写路由 CSRF 守卫：所有 POST/DELETE 一律先过 Origin/Sec-Fetch-Site 校验（GET 只读面不受影响）。
        const csrfFail = csrfCheck(req);
        if (csrfFail) {
          log(`[csrf] rejected ${req.method} ${pathname}: ${csrfFail}`);
          return sendJson(res, 403, { ok: false, error: 'CSRF_ORIGIN_REJECTED', detail: csrfFail });
        }
        if (pathname === '/api/jw/v2/session') return await handleSessionExchange(req, res);
        if (pathname === '/api/jw/v2/invitations/redeem') return await handleInvitationRedeem(req, res);
        if (customerId && pathname.endsWith('/messages')) {
          if (!messages) return sendJson(res, 501, { ok: false, error: 'NOT_CONFIGURED' });
          return await handleMessages(req, res, customerId);
        }
        if (pathname.startsWith('/api/jw/v2/actions/')) {
          // goal-03d 分流：处理通道写面（邀请/绑定/录入/更正/问答/暂停）走 Connectors 服务令牌代理。
          if (pathname.startsWith('/api/jw/v2/actions/connectors/')) {
            if (!connectorsProxy) {
              return sendJson(res, 503, { ok: false, error: 'CHANNEL_NOT_CONFIGURED', note: '处理通道未配置（--connectors-url + --connectors-token-file）：处理动作如实标未接入' });
            }
            const session = requireSession(req, res);
            if (!session) return;
            return await connectorsProxy.handle({ res, urlObj, session, log });
          }
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
//           [--auth-file path] [--fixture-auth] [--serve-front <dir>] [--marker xxx --heartbeat path]
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
  const { createUpstreamProxy, CONNECTORS_ACTION_ROUTES } = await import('./proxy.mjs');
  const { createReadProxy, CONNECTORS_READ_ROUTES } = await import('./readproxy.mjs');
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
      channel: (typeof args['connectors-url'] === 'string' && args['connectors-url'].length > 0)
        ? 'wired (--connectors-url 配置；实际处理以 Connectors 驱动与 A bridge 运行为准)'
        : 'not_wired (处理通道未配置)',
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

  // 身份目录（live）：--auth-file JSON {entries:[{credential, principalId, roles, label?, demo?}]};
  // 只存服务端内存。交换时以 A 只读探针（/api/v2/receipts/__jw-edge-probe__）复核凭据在 A 目录仍有效
  // ——目录与 A 双重校验。goal-03c：目录同时支撑受控登录（按 principalId 选择，凭据服务端查得）。
  const loadDirectory = async (p) => {
    const fs = await import('node:fs');
    const { createHash } = await import('node:crypto');
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    const byHash = new Map();
    const byPrincipal = new Map();
    const list = [];
    for (const e of parsed.entries ?? []) {
      if (typeof e.credential !== 'string' || typeof e.principalId !== 'string') continue;
      const roles = Array.isArray(e.roles) ? e.roles : [];
      const meta = { principalId: e.principalId, roles, label: typeof e.label === 'string' && e.label ? e.label : e.principalId, demo: e.demo === true };
      byHash.set(createHash('sha256').update(e.credential).digest('hex'), meta);
      byPrincipal.set(e.principalId, { ...meta, credential: e.credential });
      list.push({ principalId: meta.principalId, roles: meta.roles, label: meta.label, demo: meta.demo });
    }
    return { byHash, byPrincipal, list };
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
  const liveVerifier = (live && (directory || redeemedDirectory))
    ? async ({ credential }) => {
      const { createHash } = await import('node:crypto');
      const h = createHash('sha256').update(credential).digest('hex');
      const entry = directory?.byHash.get(h) ?? redeemedDirectory.byHash.get(h);
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

  // goal-03c 受控身份目录：live=auth-file 目录；fixture=单一合成演示身份。凭据只进 byPrincipal（服务端）。
  let identityDirectory = null;
  if (live && directory) {
    identityDirectory = { list: directory.list, byPrincipal: directory.byPrincipal };
  } else if (!live && fixtureVerifier) {
    identityDirectory = {
      list: [{ principalId: 'harness-admin', roles: ['admin'], label: '合成演示 · 管理员（训练）', demo: true }],
      byPrincipal: new Map([['harness-admin', { credential: 'harness-demo-cred' }]]),
    };
  }

  // workspace/events 鉴权：live = 会话必需（真实客户/租户授权由 A 每请求裁决，Edge 不缓存）；
  // fixture = 语义自检放行。messages:external-send 是独立 Edge 权限点（C2.5）：
  // 默认拒绝（fail-closed），仅 --external-send-roles / JW_EDGE_EXTERNAL_SEND_ROLES 显式列出的
  // 角色可豁免外发守卫；fixture 形态仅 admin 演示角色可过（只证明语义，不用于真实身份）。
  const externalSendRoles = [
    ...argv.flatMap((a, i) => (a === '--external-send-roles' && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1].split(',').map((s) => s.trim()).filter(Boolean) : [])),
    ...(process.env.JW_EDGE_EXTERNAL_SEND_ROLES ? process.env.JW_EDGE_EXTERNAL_SEND_ROLES.split(',').map((s) => s.trim()).filter(Boolean) : []),
  ];
  const scopeAuth = live
    ? async ({ session, action }) => {
      if (!session) return { ok: false, reason: 'SESSION_REQUIRED' };
      if (action === 'messages:external-send') {
        const allowed = externalSendRoles.length > 0 && session.roles.some((r) => externalSendRoles.includes(r));
        if (!allowed) return { ok: false, reason: 'EXTERNAL_SEND_NOT_PERMITTED' };
      }
      return { ok: true, principalId: session.principalId };
    }
    : (args['fixture-auth'] && fixtureVerifier
      ? async ({ session, action }) => {
        if (!session) return { ok: false, reason: 'PRINCIPAL_UNTRUSTED' };
        if (action === 'messages:external-send' && !session.roles.includes('admin')) return { ok: false, reason: 'EXTERNAL_SEND_NOT_PERMITTED' };
        return { ok: true, principalId: session.principalId };
      }
      : async () => ({ ok: true }));

  // E0 消息投递 seam：内存 sink；真实通道（企微客服/存档）属任务02。
  // messageId 必须全局唯一（任务04 旅程缺陷修复：此前按进程内计数器 fixture-N 生成，
  // 消息持久化后重启计数归零 → 与已存记录 UNIQUE 冲突，客户消息发送 500 INTERNAL）。
  const { randomUUID: _uuid } = await import('node:crypto');
  const sentMessages = [];
  const deliver = async (msg) => {
    const messageId = `local-${_uuid()}`;
    sentMessages.push({ ...msg, messageId });
    return { messageId, state: 'sent_local_sink' };
  };

  // 页内消息线程存储（goal-03e；任务04 §四持久化）：--messages-file <path>（.run 下，Git 排除）
  // → node:sqlite 文件库（WAL），重启可恢复；未指定 → 进程内（E0 语义自检兼容）。
  // 同一实例兼任消息 requestId 幂等回执的持久层（receiptStore）。
  const { createMessageStore } = await import('./message-store.mjs');
  const messagesFile = typeof args['messages-file'] === 'string' && args['messages-file'].length > 0 ? String(args['messages-file']) : null;
  const messageStore = createMessageStore(messagesFile ? { file: messagesFile } : {});

  const auditSink = createAuditSink();
  const sessionStore = createSessionStore({});
  const proxy = createUpstreamProxy({
    baseUrl: kernelBase,
    // live：转发会话建立时服务端留存的上游凭据（浏览器只见不透明会话）；
    // fixture：E0 占位（真实凭据映射随 --live 落地）。
    credentialFor: live ? (session) => session.credential : (session) => `session:${session.principalId}`,
  });
  // goal-03c 只读透传：仅 live 形态提供（fixture 无上游真实面，路由保持 404/501 如实拒绝）。
  const readProxy = live
    ? createReadProxy({ baseUrl: kernelBase, credentialFor: (session) => session.credential })
    : null;

  // goal-03d 处理通道（Connectors）代理：--connectors-url + 令牌文件（--connectors-token-file）
  // 或 JW_CONNECTORS_TOKEN 环境变量。令牌只进服务端内存，不落日志/前端；未配置时相应面显式 503
  // CHANNEL_NOT_CONFIGURED（不再落入 A 面代理误报 PROXY_ROUTE_NOT_DECLARED），页面如实标"处理通道未接入"。
  //
  // 任务04 §三·逐资源授权（Edge 是会话→服务令牌的唯一换权点，转发前必须裁决）：
  //   - 角色边界：customer-only 会话仅可执行 access='customer'|'open' 的动作（上传/问答/接受邀请）；
  //     access='internal'（邀请签发/人工转录/更正/获准复核/暂停恢复）一律 403 ROLE_FORBIDDEN；
  //   - 客户归属：带目标客户（customerId/cid）的读写一律先以本会话凭据经 A checkCustomer 裁决
  //     （A 逐请求授权，Edge 不缓存结论）；拒绝/不可读 → 不转发；缺失 → 400 失败关闭；
  //   - 任务详情归属：页面只持 taskId——服务端先取回任务归属（customer_id）再校验，不可读 → 404
  //     （不泄露存在性）；仅持有他人 taskId/evidenceId、改 query/body 的 customerId 都拿不到数据。
  let connectorsProxy = null;
  let connectorsReadProxy = null;
  const connectorsUrl = typeof args['connectors-url'] === 'string' ? args['connectors-url'] : null;
  if (live && connectorsUrl) {
    let token = process.env.JW_CONNECTORS_TOKEN || null;
    if (!token && typeof args['connectors-token-file'] === 'string') {
      const { readFileSync } = await import('node:fs');
      token = readFileSync(String(args['connectors-token-file']), 'utf8').trim();
    }
    const { createChannelAuthorizers } = await import('./channel-authz.mjs');
    const { writeAuthorize: connectorsWriteAuthorize, readAuthorize: connectorsReadAuthorize } = createChannelAuthorizers({ store, log: (m) => console.error(m) });
    connectorsProxy = createUpstreamProxy({
      baseUrl: connectorsUrl,
      credentialFor: () => token ?? '',
      headerName: 'X-Service-Token',
      routes: CONNECTORS_ACTION_ROUTES,
      authorize: connectorsWriteAuthorize,
    });
    connectorsReadProxy = createReadProxy({
      baseUrl: connectorsUrl,
      credentialFor: () => token ?? '',
      headerName: 'X-Service-Token',
      routes: CONNECTORS_READ_ROUTES,
      authorize: connectorsReadAuthorize,
    });
  }

  // 任务04 §三·健康检查分项：处理通道进程（http）与通道鉴权前置（服务令牌 + 处理面可达）作为
  // 独立 readiness 检查。处理驱动常驻与 A bridge 业务链路无法由 Edge 外部直接观测——不冒充
  // "已验证"，驱动/桥接以页面处理推进与交付编排报告为准（驱动 lastTick 需求已交任务02）。
  if (live && connectorsUrl) {
    const connectorsTenant = typeof args['connectors-tenant'] === 'string' && args['connectors-tenant'] ? args['connectors-tenant'] : 'tenant_demo';
    let channelToken = process.env.JW_CONNECTORS_TOKEN || null;
    if (!channelToken && typeof args['connectors-token-file'] === 'string') {
      const { readFileSync } = await import('node:fs');
      channelToken = readFileSync(String(args['connectors-token-file']), 'utf8').trim();
    }
    probes.push(httpProbe({
      name: 'connectors', url: `${connectorsUrl}/healthz`,
      pass: (b, s) => s === 200 && b?.ok === true,
      detailFields: ['ok', 'service', 'realWeCom', 'realTrtc'],
    }));
    probes.push(channelToken
      ? httpProbe({
        name: 'connectors-channel',
        url: `${connectorsUrl}/api/connectors/processing/status?tid=${encodeURIComponent(connectorsTenant)}&cid=__edge_probe__`,
        headers: { 'X-Service-Token': channelToken },
        pass: (b, s) => s === 200 && b?.ok === true,
        detailFields: ['ok', 'coordinatorVersion', 'rulesetVersion'],
      })
      : async () => ({ name: 'connectors-channel', ok: false, detail: { error: '服务令牌未配置（--connectors-token-file / JW_CONNECTORS_TOKEN）：通道鉴权前置不成立' } }));
  } else if (live) {
    probes.push(async () => ({ name: 'connectors', advisory: true, ok: false, detail: { configured: false, note: '处理通道未配置：相应读写在 Edge 侧显式 503 CHANNEL_NOT_CONFIGURED' } }));
  }
  const messages = createMessageRouter({
    deliver, auditSink, threadStore: messageStore, receiptStore: messageStore,
    // live：发往客户前以本会话凭据校验目标客户可读（A 逐请求裁决，防错 customerId/越权外发）；
    // fixture：无上游目标面 → 不接校验（E0 语义自检）。
    validateTarget: live && typeof store.checkCustomer === 'function'
      ? (session, customerId) => store.checkCustomer(customerId, { credential: session.credential })
      : null,
  });

  const harnessDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'D', 'browser-harness', 'public');
  const staticHandler = createStaticHandler({ rootDir: harnessDir });
  // goal-03 C3 同源受控入口：--serve-front <dir>（如 Front/dist）→ 由 Edge 同源托管前端构建产物。
  // 默认关闭；CSP connect-src 'self' 不放宽，不改变任何认证/CSRF 语义（同源 POST 走既有判定）。
  let frontHandler = null;
  if (args['serve-front'] && typeof args['serve-front'] === 'string') {
    const frontDir = path.resolve(String(args['serve-front']));
    frontHandler = createStaticHandler({ rootDir: frontDir, urlPrefix: '' });
  }

  const started = await startEdgeServer({
    port, seal, probes, store,
    auth: scopeAuth,
    sessionStore, verifyCredential, proxy, readProxy, connectorsProxy, connectorsReadProxy, identityDirectory, messages, messageStore, auditSink, staticHandler, frontHandler,
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
    console.log(`[edge] live：A 内核 ${kernelBase}；workspace/events 需会话；受控身份目录=${directory ? 'auth-file(可按 principalId 登录)' : '未配置(仅手输凭据，会话交换失败关闭)'}`);
    console.log('[edge] 消费面契约：Back/Edge/contract/consumed-surface-v1.json（上游漂移将原样报错，不伪装）');
    console.log('[edge] 工作本读面：/api/jw/v2/customers/:id/{artifacts,reports}、/api/jw/v2/{reports,assessments,facilities,financing-requests,decision-packages,findings,inspections}/**（白名单透传，A 逐请求裁决）');
    console.log('[edge] 受限原件上传：POST /api/jw/v2/actions/customers/:id/originals（≤512KB，IR-03-3 临时约定 v0；预览待上游单件读端点）');
    console.log(connectorsProxy
      ? `[edge] 处理通道：${connectorsUrl}（IR-02-C 消费面：/api/jw/v2/connectors/** 读、/api/jw/v2/actions/connectors/** 写；服务令牌只存服务端）`
      : '[edge] 处理通道：未配置（--connectors-url + --connectors-token-file）；处理分段/预览/人工路线如实标未接入');
  } else {
    console.log('[edge] fixture 语义自检形态：加 --live 接真实内核投影');
  }
  console.log('[edge] readiness 目标：A内核 /healthz(db=up) + PG TCP；当前环境未就绪时 /healthz/ready 会如实报 not ready');
  console.log(`[edge] harness: http://127.0.0.1:${started.port}/harness/  fixture-auth=${!live && fixtureVerifier ? 'ON(仅合成演示身份)' : 'OFF(失败关闭)'}`);
  if (frontHandler) console.log(`[edge] 同源前端：http://127.0.0.1:${started.port}/ ← ${args['serve-front']}（CSP connect-src 'self'，同源部署无需 CORS 配置）`);
}

// 直接运行入口（node src/server.mjs --port ...）；被 import 时不启动。
const invoked = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (invoked) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`[edge] 启动失败: ${e.message}`);
    process.exit(2);
  });
}
