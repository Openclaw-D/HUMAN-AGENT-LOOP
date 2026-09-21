// 动作代理（任务04 S3 thin Edge E0）：固定上游 + 显式路由/方法白名单，绝不做任意 URL 代理。
// - 浏览器只持会话（X-JW-Session）；转发时由服务端映射回上游凭据，浏览器的凭据头一律不透传；
// - 动作必须带客户端 requestId（缺失即 400，绝不代生成新 ID——重复业务动作的根源）；
// - 上游网络层未知（超时/断连）→ 502 UPSTREAM_UNKNOWN + 原 requestId 回显，不自动重试；
//   客户端用同 requestId 重试安全（上游幂等表裁决），换新 ID 才危险。
// 上游 4xx/5xx 原样透传（后台再鉴权的结果不被 Edge 掩盖）。

// 白名单：Back/CONTRACT.md §4 v1 敏感写 + 任务三消费面（consumed-surface-v1.json）的
// v2 客户授信写与检查会话写。新内核路由以消费面快照为准登记，不做任意 URL 代理。
import { trustedActorHeaders } from './channel-authz.mjs';
import { ADVANCE_WRITE_ROUTES } from './advance-round.mjs';

export const ACTION_ROUTES = [
  ...ADVANCE_WRITE_ROUTES,
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
    pattern: /^\/api\/jw\/v2\/actions\/customers\/([^/]+)\/(artifacts|relationships|assessments|facilities|financing-requests|findings|decision-packages|reports)$/,
    upstream: (m) => `/api/v2/customers/${encodeURIComponent(m[1])}/${m[2]}`,
  },
  // ---- goal-03c 工作本写面：差异复核与决策闭环（consumed-surface 同步登记；鉴权/幂等全部由 A 再验证） ----
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/findings\/([^/]+)\/resolve$/,
    upstream: (m) => `/api/v2/findings/${encodeURIComponent(m[1])}/resolve`,
  },
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/decision-packages\/([^/]+)\/(revisions|domain-results|adoption|gate|refresh-currency)$/,
    upstream: (m) => `/api/v2/decision-packages/${encodeURIComponent(m[1])}/${m[2]}`,
  },
  // ---- goal-03d 决策链补面：必需域豁免登记（human；豁免引用在冻结时由 A 服务端解析） ----
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/customers\/([^/]+)\/domain-exemptions$/,
    upstream: (m) => `/api/v2/customers/${encodeURIComponent(m[1])}/domain-exemptions`,
  },
  // ---- IR-03-7 页面化撤权（admin 撤客户 grants 级联禁用客户身份；即刻生效） ----
  {
    method: 'DELETE',
    pattern: /^\/api\/jw\/v2\/actions\/customers\/([^/]+)\/grants\/([^/]+)$/,
    upstream: (m) => `/api/v2/customers/${encodeURIComponent(m[1])}/grants/${encodeURIComponent(m[2])}`,
  },
  // ---- goal-03c 受限邀请（A CONTRACT §11 G2；code 明文仅创建响应一次，Edge 不落日志） ----
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/customers\/([^/]+)\/invitations$/,
    upstream: (m) => `/api/v2/customers/${encodeURIComponent(m[1])}/invitations`,
  },
  // ---- 任务04 round-02：规则版本正式激活（A CONTRACT A2.7/K10；A 侧强制 human + policy/admin
  //      目录角色，Edge 只做白名单与会话凭据转发；换版审计/单激活约束由 A 服务端承担） ----
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/rule-pack-versions\/activate$/,
    upstream: () => `/api/v2/rule-pack-versions/activate`,
  },
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/invitations\/([^/]+)\/revoke$/,
    upstream: (m) => `/api/v2/invitations/${encodeURIComponent(m[1])}/revoke`,
  },
  // 受限原件上传（goal-03c；IR-03-3 临时约定 v0）：前端只发文件字段，Edge 服务端转换为
  // A 工件登记载荷（content.materialFile 信封 ≤512KB base64）。文件字节真实落 A jsonb；
  // 正式对象存储待任务01（IR-03-3a/b）落地后按版本化迁移替换本转换。
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/customers\/([^/]+)\/originals$/,
    upstream: (m) => `/api/v2/customers/${encodeURIComponent(m[1])}/artifacts`,
    transform: transformOriginals,
  },
  // ---- TAKEOFF-FA-1.0.0（A CONTRACT §13）：独立预评估确认——只产生 scope=preassessment_only
  //      结论，不触任何正式额度/融资/敞口写；鉴权/门序/幂等全部由 A 服务端裁决，Edge 只做
  //      会话/CSRF/白名单/可信actor/凭据服务端映射。行政撤回沿用既有 decide=withdraw_assessment。
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/assessments\/([^/]+)\/confirm-preassessment$/,
    upstream: (m) => `/api/v2/assessments/${encodeURIComponent(m[1])}/confirm-preassessment`,
  },
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/assessments\/([^/]+)\/(candidate|submit-review|decide|admission-request)$/,
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

// goal-03d Connectors 写面（IR-02-C 消费面）：处理通道邀请/绑定、人工录入/更正、问答与获准复核、
// 暂停。上游是 Connectors 服务令牌面（X-Service-Token，服务端持有）——requestId 纪律与 A 面一致
// （Edge 强制携带；确定性拒绝 4xx 原样透传，A/通道结果未知 502 先对账）。
//
// 任务04 §三·逐资源授权元数据（Edge 是会话→服务令牌的唯一换权点，必须在转发前裁决）：
//   access: 'internal'    仅内部角色（customer-only 会话一律 403 ROLE_FORBIDDEN）；
//   access: 'customer'    内部与客户身份皆可，但目标客户必须对本会话凭据可读（A 逐请求裁决）；
//   access: 'open'        邀请令牌本身就是授权（accept：持 token 才可调），不再叠加客户校验；
//   customerOf: 从路径/query/载荷提取目标客户——非空则逐资源校验，缺失则 400 失败关闭。
//   actorField: 上游人工动作面的 actor 归属字段（Connectors IR-04-2A-3 token→调用方绑定语义：
//     Edge 令牌是 mayDelegateActor 网关，body 自报即被采信）——转发前必须用会话派生 principal
//     覆写，浏览器伪造的 body actor 不得经网关流入审计。
export const CONNECTORS_ACTION_ROUTES = [
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/connectors\/intake\/invitations$/,
    upstream: () => `/api/connectors/intake/invitations`,
    access: 'internal',
    customerOf: (m, urlObj, body) => body?.customerId ?? null,
  },
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/connectors\/intake\/accept$/,
    upstream: () => `/api/connectors/intake/accept`,
    access: 'open',
    customerOf: null,
  },
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/connectors\/evidence\/upload$/,
    upstream: () => `/api/connectors/evidence/upload`,
    access: 'customer',
    customerOf: (m, urlObj, body) => body?.customerId ?? null,
  },
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/connectors\/evidence\/manual-entry$/,
    upstream: () => `/api/connectors/evidence/manual-entry`,
    access: 'internal',
    customerOf: (m, urlObj, body) => body?.customerId ?? null,
    actorField: 'enteredBy',
  },
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/connectors\/evidence\/correct-fact$/,
    upstream: () => `/api/connectors/evidence/correct-fact`,
    access: 'internal',
    customerOf: (m, urlObj, body) => body?.customerId ?? null,
    actorField: 'correctedBy',
  },
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/connectors\/questions\/answer$/,
    upstream: () => `/api/connectors/questions/answer`,
    access: 'customer',
    customerOf: (m, urlObj, body) => body?.customerId ?? null,
    actorField: 'answerer',
  },
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/connectors\/questions\/verify$/,
    upstream: () => `/api/connectors/questions/verify`,
    access: 'internal',
    customerOf: (m, urlObj, body) => body?.customerId ?? null,
    actorField: 'verifiedBy',
  },
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/connectors\/processing\/pause$/,
    upstream: () => `/api/connectors/processing/pause`,
    access: 'internal',
    customerOf: (m, urlObj, body) => body?.customerId ?? null,
    actorField: 'actor',
  },
  // ---- 任务02 受控客户映射登记（IR-04-2C 方案 R 映射场景；同 ID 场景由处理链权威核验自动接通，
  //      页面无需调用）：internal 动作 + 目标客户逐资源校验。legalEntityRef 归属证明由上游
  //      Connectors 经 A 档案一致后才落库，Edge 只做会话角色与客户可读裁决。
  {
    method: 'POST',
    pattern: /^\/api\/jw\/v2\/actions\/connectors\/customers\/link$/,
    upstream: () => `/api/connectors/customers/link`,
    access: 'internal',
    customerOf: (m, urlObj, body) => body?.customerId ?? null,
    actorField: 'requestedBy',
  },
];

// 受限原件上传转换（goal-03c；IR-03-3 临时约定 v0）：只接受显式文件字段，产出 A 工件登记载荷。
// 业务输入事实字段（factKey/objectRef/materialMeta 等）与信封并列透传；核验等级由 A 侧权威裁决。
const MAX_ORIGINAL_BYTES = 512 * 1024;
export class TransformError extends Error {
  constructor(code, note) {
    super(note || code);
    this.code = code;
    this.note = note;
  }
}
export function transformOriginals(body) {
  const file = body.file;
  if (!file || typeof file !== 'object' || Array.isArray(file)) {
    throw new TransformError('FILE_REQUIRED', '缺少 file 字段（{name, mime?, dataBase64}）');
  }
  if (typeof file.name !== 'string' || file.name.length === 0 || file.name.length > 200) {
    throw new TransformError('FILE_NAME_INVALID', 'file.name 必须是 1..200 字符');
  }
  if (typeof file.dataBase64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.dataBase64)) {
    throw new TransformError('FILE_ENCODING_INVALID', 'file.dataBase64 必须是标准 base64 字符串');
  }
  const bytes = Buffer.from(file.dataBase64, 'base64');
  if (bytes.length === 0) throw new TransformError('FILE_EMPTY', '文件内容为空');
  if (bytes.length > MAX_ORIGINAL_BYTES) {
    throw new TransformError('FILE_TOO_LARGE', `原件上限 ${MAX_ORIGINAL_BYTES} 字节（IR-03-3 临时约定 v0；正式存储待任务01）`);
  }
  const mime = typeof file.mime === 'string' && file.mime.length > 0 && file.mime.length <= 100 ? file.mime : 'application/octet-stream';
  const out = {
    requestId: body.requestId,
    kind: typeof body.kind === 'string' && body.kind.length > 0 ? body.kind : 'original_upload',
    content: {
      materialFile: { name: file.name, mime, size: bytes.length, encoding: 'base64', data: file.dataBase64 },
    },
  };
  for (const k of ['tenantId', 'factKey', 'grade', 'objectRef', 'materialMeta', 'projectId', 'provenance', 'supersedes', 'duplicateOf']) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  return out;
}

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
  headerName = 'X-Principal-Credential', // goal-03d：Connectors 面用 X-Service-Token
  timeoutMs = 8000,
  fetchImpl = fetch,
  routes = ACTION_ROUTES,
  authorize = null, // 任务04 §三：async ({route, m, urlObj, body, session}) => null|{status, body}；转发前逐资源裁决
}) {
  return {
    upstreamBaseUrl: baseUrl,
    async handle({ res, urlObj, session, log = () => { } }) {
      const pathname = urlObj.pathname;
      const method = res.req?.method || 'POST';
      const route = routes.find((r) => r.method === method && r.pattern.test(pathname));
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
      // 逐资源授权（任务04 §三）：先于任何上游转发；裁决拒绝不触达上游、不泄露上游存在性。
      if (authorize) {
        const verdict = await authorize({ route, m, urlObj, body, session });
        if (verdict) {
          log(`[proxy] ${pathname} authorize-reject ${verdict.status} requestId=${requestId}`);
          res.writeHead(verdict.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(verdict.body));
          return;
        }
      }
      // 转换型路由（如受限原件上传）：Edge 侧载荷重组，校验失败按 400 显式拒绝（不改写 requestId 语义）。
      let outBody = body;
      if (route.transform) {
        try {
          outBody = route.transform(body);
        } catch (e) {
          const code = e instanceof TransformError ? e.code : 'TRANSFORM_FAILED';
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ ok: false, error: code, note: e.message }));
          return;
        }
      }
      // actor 归属覆写（IR-04-2A-3）：Edge 令牌在 Connectors 是 mayDelegateActor 网关——body 自报
      // actor 会被采信，故转发前必须以会话派生 principal 覆写，浏览器伪造值不得经网关流入审计。
      if (route.actorField && typeof session?.principalId === 'string' && session.principalId.length > 0) {
        outBody = { ...outBody, [route.actorField]: session.principalId };
      }

      const upstreamUrl = baseUrl.replace(/\/$/, '') + route.upstream(m);
      const started = Date.now();
      let upRes;
      try {
        upRes = await fetchImpl(upstreamUrl, {
          method,
          headers: {
            'content-type': 'application/json',
            // 唯一放行的身份头：服务端映射的上游凭据。浏览器请求头不透传（含其伪造的凭据头）。
            [headerName]: credentialFor(session),
            // 可信调用上下文（IR-04-2A-3）：服务端从会话派生，浏览器不可伪造；上游归属/留痕以此为准。
            ...trustedActorHeaders(session),
          },
          body: JSON.stringify(outBody),
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
