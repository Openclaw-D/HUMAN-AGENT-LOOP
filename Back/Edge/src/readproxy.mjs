// GET 只读透传（goal-03c 工作本）：白名单路径按会话留存的上游凭据转发 A，A 是唯一授权裁决方；
// Edge 不缓存、不加投影、不改错误语义——上游 4xx/5xx 原样透传，网络层未知 → 502 UPSTREAM_UNKNOWN。
// 与写面（proxy.mjs）同一纪律：绝不做任意 URL 代理；未登记路径明确拒绝。
// 注意：customer-only principal 对 artifacts/reports/内部读口的 403 由 A 结构保证（B13），Edge 原样呈现。

export const READ_ROUTES = [
  {
    pattern: /^\/api\/jw\/v2\/customers\/([^/]+)\/artifacts$/,
    action: 'artifacts:read',
    upstream: (m) => `/api/v2/customers/${encodeURIComponent(m[1])}/artifacts`,
  },
  {
    pattern: /^\/api\/jw\/v2\/customers\/([^/]+)\/reports$/,
    action: 'reports:read',
    upstream: (m) => `/api/v2/customers/${encodeURIComponent(m[1])}/reports`,
  },
  {
    // 单份报告内容（?format=json|markdown 原样转发；导出由前端持 JSON 自行落盘）
    pattern: /^\/api\/jw\/v2\/reports\/([^/]+)$/,
    action: 'reports:read',
    upstream: (m, search) => `/api/v2/reports/${encodeURIComponent(m[1])}${search || ''}`,
  },
  {
    pattern: /^\/api\/jw\/v2\/assessments\/([^/]+)$/,
    action: 'assessments:read',
    upstream: (m) => `/api/v2/assessments/${encodeURIComponent(m[1])}`,
  },
  {
    pattern: /^\/api\/jw\/v2\/facilities\/([^/]+)$/,
    action: 'facilities:read',
    upstream: (m) => `/api/v2/facilities/${encodeURIComponent(m[1])}`,
  },
  {
    pattern: /^\/api\/jw\/v2\/financing-requests\/([^/]+)\/use-readiness$/,
    action: 'use-readiness:read',
    upstream: (m) => `/api/v2/financing-requests/${encodeURIComponent(m[1])}/use-readiness`,
  },
  {
    pattern: /^\/api\/jw\/v2\/financing-requests\/([^/]+)$/,
    action: 'financing-requests:read',
    upstream: (m) => `/api/v2/financing-requests/${encodeURIComponent(m[1])}`,
  },
  {
    pattern: /^\/api\/jw\/v2\/decision-packages\/([^/]+)$/,
    action: 'decision-packages:read',
    upstream: (m) => `/api/v2/decision-packages/${encodeURIComponent(m[1])}`,
  },
  {
    pattern: /^\/api\/jw\/v2\/findings\/([^/]+)$/,
    action: 'findings:read',
    upstream: (m) => `/api/v2/findings/${encodeURIComponent(m[1])}`,
  },
  {
    // 检查会话读面（v1）：snapshot/next-actions/summary；audience=internal|customer、revision 由 A 裁决
    pattern: /^\/api\/jw\/v2\/inspections\/([^/]+)\/(snapshot|next-actions|summary)$/,
    action: 'inspections:read',
    upstream: (m, search) => `/api/v1/inspections/${encodeURIComponent(m[1])}${m[2] === 'snapshot' ? '' : `/${m[2]}${search || ''}`}`,
  },
  {
    pattern: /^\/api\/jw\/v2\/inspections\/([^/]+)$/,
    action: 'inspections:read',
    upstream: (m) => `/api/v1/inspections/${encodeURIComponent(m[1])}`,
  },
  // ---- goal-03c 受限邀请与材料处理状态（A CONTRACT §11 G2/G3 冻结面） ----
  {
    pattern: /^\/api\/jw\/v2\/customers\/([^/]+)\/invitations$/,
    action: 'invitations:read',
    upstream: (m) => `/api/v2/customers/${encodeURIComponent(m[1])}/invitations`,
  },
  {
    pattern: /^\/api\/jw\/v2\/customers\/([^/]+)\/artifacts\/([^/]+)\/processing$/,
    action: 'artifacts:read',
    upstream: (m) => `/api/v2/customers/${encodeURIComponent(m[1])}/artifacts/${encodeURIComponent(m[2])}/processing`,
  },
  {
    // 工件单件读回（IR-03-3 / CONTRACT §11.2 冻结面）：A 档案信封件预览数据源。
    // 只读回，不落对象存储、无写路径；404 语义（不存在/不属本客户/无授权）由 A 裁决并原样透传。
    pattern: /^\/api\/jw\/v2\/customers\/([^/]+)\/artifacts\/([^/]+)\/content$/,
    action: 'artifacts:read',
    upstream: (m) => `/api/v2/customers/${encodeURIComponent(m[1])}/artifacts/${encodeURIComponent(m[2])}/content`,
  },
  {
    // 客户联系人获准披露白名单投影（仅客户身份；内部 403 由 A 结构保证）
    pattern: /^\/api\/jw\/v2\/my\/materials$/,
    action: 'my-materials:read',
    upstream: () => `/api/v2/my/materials`,
  },
  // ---- goal-03d 决策链读面（A §8/A2 冻结面；四域意见/域当前性/缺口只读透传） ----
  {
    pattern: /^\/api\/jw\/v2\/customers\/([^/]+)\/decision-status$/,
    action: 'decision-status:read',
    upstream: (m) => `/api/v2/customers/${encodeURIComponent(m[1])}/decision-status`,
  },
  {
    pattern: /^\/api\/jw\/v2\/customers\/([^/]+)\/domain-exemptions$/,
    action: 'domain-exemptions:read',
    upstream: (m) => `/api/v2/customers/${encodeURIComponent(m[1])}/domain-exemptions`,
  },
];

// goal-03d Connectors 只读透传（IR-02-C 消费面）：处理分段进度/逐任务回执/原件预览签名 URL。
// 上游是 Connectors 服务令牌面（X-Service-Token，服务端持有）——与 A 读面同一纪律：
// 白名单路径、凭据不落浏览器、错误原样透传、网络层未知 → 502 UPSTREAM_UNKNOWN。
export const CONNECTORS_READ_ROUTES = [
  {
    pattern: /^\/api\/jw\/v2\/connectors\/processing\/status$/,
    action: 'channel:read',
    upstream: (m, search) => `/api/connectors/processing/status${search || ''}`,
  },
  {
    pattern: /^\/api\/jw\/v2\/connectors\/processing\/tasks\/([^/]+)$/,
    action: 'channel:read',
    upstream: (m, search) => `/api/connectors/processing/tasks/${encodeURIComponent(m[1])}${search || ''}`,
  },
  {
    // 原件预览（IR-03-3 归宿之一）：魔数嗅探 + 短时签名 downloadUrl；Edge 不经手字节、不落公开目录
    pattern: /^\/api\/jw\/v2\/connectors\/evidence\/preview$/,
    action: 'channel:read',
    upstream: (m, search) => `/api/connectors/evidence/preview${search || ''}`,
  },
  {
    // 通道原件字节（goal-03e 修复）：Connectors 签名 URL 为相对路径 /objects/:ref——同源 Edge 下
    // 会被前端托管兜底吞掉。本路由把签名 URL 归一到 Edge 代理（会话必需 + 签名/有效期仍由
    // Connectors 验证）；raw=true 按原始字节透传（content-type 原样），错误 JSON 也原样透传。
    pattern: /^\/api\/jw\/v2\/connectors\/objects\/([^/]+)$/,
    action: 'channel:read',
    upstream: (m, search) => `/objects/${encodeURIComponent(m[1])}${search || ''}`,
    raw: true,
  },
];

export function createReadProxy({
  baseUrl,
  credentialFor, // (session) => credential：服务端持有会话→上游凭据映射
  headerName = 'X-Principal-Credential', // goal-03d：Connectors 面用 X-Service-Token
  timeoutMs = 8000,
  fetchImpl = fetch,
  routes = READ_ROUTES,
}) {
  return {
    upstreamBaseUrl: baseUrl,
    routes,
    async handle({ res, urlObj, session, log = () => { } }) {
      const pathname = urlObj.pathname;
      const route = routes.find((r) => r.pattern.test(pathname));
      if (!route) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'PROXY_ROUTE_NOT_DECLARED', note: 'thin Edge 只透传白名单读面，不提供任意 URL 代理' }));
        return;
      }
      const m = pathname.match(route.pattern);
      const upstreamUrl = baseUrl.replace(/\/$/, '') + route.upstream(m, urlObj.search || '');
      const started = Date.now();
      let upRes;
      try {
        upRes = await fetchImpl(upstreamUrl, {
          method: 'GET',
          headers: {
            // 唯一放行的身份头：服务端映射的上游凭据（浏览器请求头不透传）。
            [headerName]: credentialFor(session),
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        const reason = e.name === 'TimeoutError' ? 'timeout' : String(e.cause?.code || e.message);
        log(`[read] ${pathname} upstream-unknown (${reason})`);
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'UPSTREAM_UNKNOWN', reason, note: '上游结果未知：稍后重试或经 requestId 对账' }));
        return;
      }
      if (route.raw) {
        // 原始字节面（objects/:ref）：按字节透传（不经文本解码，避免二进制损坏）——
        // 错误（签名失效等 JSON）与成功字节都原样回传，content-type 保留上游值。
        const buf = Buffer.from(await upRes.arrayBuffer());
        const upType = upRes.headers.get('content-type') || 'application/octet-stream';
        log(`[read] ${pathname} -> ${upRes.status} raw ${buf.length}B (${upType})`);
        res.writeHead(upRes.status, { 'Content-Type': upType, 'Cache-Control': 'no-store' });
        res.end(buf);
        return;
      }
      const text = await upRes.text();
      let body = null;
      try { body = JSON.parse(text); } catch { /* 透传状态码即可 */ }
      log(`[read] ${pathname} -> ${upRes.status} (${Date.now() - started}ms)`);
      res.writeHead(upRes.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(text || JSON.stringify({ ok: upRes.status < 400 }));
    },
  };
}
