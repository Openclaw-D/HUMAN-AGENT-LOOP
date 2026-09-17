// 动作代理（任务04 S3 thin Edge E0）：固定上游 + 显式路由/方法白名单，绝不做任意 URL 代理。
// - 浏览器只持会话（X-JW-Session）；转发时由服务端映射回上游凭据，浏览器的凭据头一律不透传；
// - 动作必须带客户端 requestId（缺失即 400，绝不代生成新 ID——重复业务动作的根源）；
// - 上游网络层未知（超时/断连）→ 502 UPSTREAM_UNKNOWN + 原 requestId 回显，不自动重试；
//   客户端用同 requestId 重试安全（上游幂等表裁决），换新 ID 才危险。
// 上游 4xx/5xx 原样透传（后台再鉴权的结果不被 Edge 掩盖）。

// 白名单：Back/CONTRACT.md §4 v1 敏感写 + 任务三消费面（consumed-surface-v1.json）的
// v2 客户授信写与检查会话写。新内核路由以消费面快照为准登记，不做任意 URL 代理。
export const ACTION_ROUTES = [
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/goals\/([^/]+)\/(claim|complete|fail|accept|decide|pause|resume|takeover)$/,
    upstream: (m) => `/api/v1/goals/${encodeURIComponent(m[1])}/${m[2]}`,
  },
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/projects\/([^/]+)\/(pause|resume)$/,
    upstream: (m) => `/api/v1/projects/${encodeURIComponent(m[1])}/${m[2]}`,
  },
  // ---- v2 客户授信面（任务一前作；requestId 幂等/鉴权全部由 A 再验证） ----
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/customers$/,
    upstream: () => `/api/v2/customers`,
  },
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/customers\/([^/]+)\/(artifacts|relationships|assessments|facilities|financing-requests)$/,
    upstream: (m) => `/api/v2/customers/${encodeURIComponent(m[1])}/${m[2]}`,
  },
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/assessments\/([^/]+)\/(candidate|submit-review|decide)$/,
    upstream: (m) => `/api/v2/assessments/${encodeURIComponent(m[1])}/${m[2]}`,
  },
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/facilities\/([^/]+)\/(approve|activate|suspend|reduce)$/,
    upstream: (m) => `/api/v2/facilities/${encodeURIComponent(m[1])}/${m[2]}`,
  },
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/financing-requests\/([^/]+)\/(reserve|release|commit|disburse|settle|confirm-external)$/,
    upstream: (m) => `/api/v2/financing-requests/${encodeURIComponent(m[1])}/${m[2]}`,
  },
  // ---- 检查会话面（任务一；注意：具体路径在前，通配动词在后，find 首中即用） ----
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/projects\/([^/]+)\/inspections$/,
    upstream: (m) => `/api/v1/projects/${encodeURIComponent(m[1])}/inspections`,
  },
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/inspections\/([^/]+)\/outbound\/grant$/,
    upstream: (m) => `/api/v1/inspections/${encodeURIComponent(m[1])}/outbound/grant`,
  },
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/inspections\/([^/]+)\/outbound\/([^/]+)\/result$/,
    upstream: (m) => `/api/v1/inspections/${encodeURIComponent(m[1])}/outbound/${encodeURIComponent(m[2])}/result`,
  },
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/inspections\/([^/]+)\/items\/([^/]+)\/(verify|rebind|reassign)$/,
    upstream: (m) => `/api/v1/inspections/${encodeURIComponent(m[1])}/items/${encodeURIComponent(m[2])}/${m[3]}`,
  },
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/inspections\/([^/]+)\/questions\/([^/]+)\/(answer|reask)$/,
    upstream: (m) => `/api/v1/inspections/${encodeURIComponent(m[1])}/questions/${encodeURIComponent(m[2])}/${m[3]}`,
  },
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/inspections\/([^/]+)\/(start|pause|resume|end|close|sweep|takeover|checkpoint|evidence|presence|questions|items)$/,
    upstream: (m) => `/api/v1/inspections/${encodeURIComponent(m[1])}/${m[2]}`,
  },
];

export function readJsonBody(req, { limitBytes = 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    let aborted = false;
    req.on('data', (c) => {
      if (aborted) return;
      size += c.length;
      if (size > limitBytes) {
        aborted = true;
        resolve({ err: 'BODY_TOO_LARGE' });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({ body: {} });
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return resolve({ err: 'INVALID_JSON' });
        resolve({ body: parsed });
      } catch {
        resolve({ err: 'INVALID_JSON' });
      }
    });
    req.on('error', () => { if (!aborted) { aborted = true; resolve({ err: 'BODY_READ_FAILED' }); } });
  });
}

export function createUpstreamProxy({
  baseUrl,
  credentialFor, // (session) => credential：服务端持有会话→上游凭据映射
  timeoutMs = 8000,
  fetchImpl = fetch,
  routes = ACTION_ROUTES,
}) {
  return {
    upstreamBaseUrl: baseUrl,
    async handle({ res, urlObj, session, log = () => { } }) {
      const pathname = urlObj.pathname;
      const route = routes.find((r) => r.method === 'POST' && r.pattern.test(pathname));
      if (!route) {
        // 白名单语义：未登记的路径不是 404-透传代理，而是明确拒绝。
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'PROXY_ROUTE_NOT_DECLARED', note: 'thin Edge 只代理白名单动作，不提供任意 URL 代理' }));
        return;
      }
      const m = pathname.match(route.pattern);
      const read = await readJsonBody(res.req);
      if (read.err) {
        res.writeHead(read.err === 'BODY_TOO_LARGE' ? 413 : 400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: read.err }));
        return;
      }
      const body = read.body;
      const requestId = body.requestId;
      if (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 128) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'REQUEST_ID_REQUIRED', note: '动作必须携带客户端 requestId（1..128），响应丢失后用同 ID 重试' }));
        return;
      }

      const upstreamUrl = baseUrl.replace(/\/$/, '') + route.upstream(m);
      const started = Date.now();
      let upRes;
      try {
        upRes = await fetchImpl(upstreamUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            // 唯一放行的身份头：服务端映射的上游凭据。浏览器请求头不透传（含其伪造的凭据头）。
            'X-Principal-Credential': credentialFor(session),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        const reason = e.name === 'TimeoutError' ? 'timeout' : String(e.cause?.code || e.message);
        log(`[proxy] ${pathname} upstream-unknown (${reason}) requestId=${requestId}`);
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({
          ok: false,
          error: 'UPSTREAM_UNKNOWN',
          requestId,
          reason,
          note: '结果未知：用同 requestId 安全重试（不生成新 ID）。v2 授信面可先查 GET /api/jw/v2/receipts/:requestId 对账；v1 族（检查会话/目标）以上游幂等表 + expectedVersion 门裁决重发',
        }));
        return;
      }

      let upBody = null;
      try { upBody = await upRes.json(); } catch { /* 透传状态码即可 */ }
      log(`[proxy] ${pathname} -> ${upRes.status} (${Date.now() - started}ms) requestId=${requestId}`);
      res.writeHead(upRes.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(upBody ?? { ok: upRes.status < 400 }));
    },
  };
}
