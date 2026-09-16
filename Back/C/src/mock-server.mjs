// V7 backend-next Lane C · 独立 loopback 假模型 API 服务（真实 socket，零依赖 node:http）。
//
// 边界声明（不可移除）：
// - 本服务只模拟 transport 响应形状与故障，供 B 路 transport 联调/故障演练/测试断言使用；
//   它不代表任何真实模型能力或训练效果。所有响应头带 x-mock-simulation: true。
// - 不读取任何环境变量密钥；API key 只经启动参数注入且永不完整回显（见 mock-redact.mjs）。
// - 只绑定 loopback；不得暴露公网。
// - 固定 seed 下同请求恒同响应（确定性），供可重放测试。
//
// 接口文档：见 ../MOCK_API.md（与本文件同步演进，改动须升版本并在 STATUS 落证据）。
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { describeAuth, maskSecret } from './mock-redact.mjs';

export const MOCK_API_VERSION = 'mock-api-v1';
export const DEFAULT_PORT = 3730;

/** 全部场景名（MOCK_API.md §场景表 的实现源）。 */
export const SCENARIOS = [
  'success',
  'missing_field',
  'format_error',
  'latency',
  'rate_limited',
  'server_error_500',
  'server_error_502',
  'server_error_503',
  'disconnect_before_response',
  'partial_response',
  'malformed_response',
  'invalid_credential',
];

const BODY_LIMIT_BYTES = 2 * 1024 * 1024;
const HARD_BODY_LIMIT_BYTES = 64 * 1024 * 1024; // 超此限直接断连（不再排空，防资源耗尽）
const LOG_RING_LIMIT = 500;
const MAX_DELAY_MS = 30000;

/**
 * 创建（不启动）mock 服务实例。
 * @param {object} [opts]
 * @param {number} [opts.port=3730] 监听端口（0=临时端口，测试用）
 * @param {string} [opts.host='127.0.0.1']
 * @param {string|null} [opts.apiKey=null] 配置后 /chat/completions 需 Bearer/x-api-key 匹配；null=不校验（loopback 测试默认）
 * @param {string} [opts.seed='jw-mock-night-20260916'] 确定性种子
 * @param {string[]} [opts.models] GET /models 返回的模型 id 列表（回显用，非真实模型）
 * @param {string} [opts.defaultScenario='success']
 * @param {number} [opts.latencyMs=0] latency 场景默认延迟
 * @param {number} [opts.retryAfterSec=1] 429 的 Retry-After
 */
export function createMockServer(opts = {}) {
  const startupConfig = {
    apiKey: typeof opts.apiKey === 'string' && opts.apiKey.length > 0 ? opts.apiKey : null,
    seed: opts.seed ?? 'jw-mock-night-20260916',
    models: Array.isArray(opts.models) && opts.models.length > 0 ? opts.models : ['mock-glm-5.2'],
  };
  const initialConfig = {
    defaultScenario: validScenario(opts.defaultScenario ?? 'success'),
    latencyMs: clampInt(opts.latencyMs ?? 0, 0, MAX_DELAY_MS),
    retryAfterSec: clampInt(opts.retryAfterSec ?? 1, 0, 300),
  };
  let config = { ...initialConfig };

  const state = {
    startedAt: null,
    counters: { total: 0, byScenario: {}, completions: 0 },
    log: [], // 脱敏请求环形日志（不含请求体原文）
    seq: 0,
  };

  const ctx = { startupConfig, initialConfig, configRef: () => config, setConfig: (c) => { config = c; }, state };
  const nodeServer = createServer(buildRequestHandler(ctx));

  return {
    MOCK_API_VERSION,
    /** 启动并解析实际端口。 */
    listen() {
      return new Promise((resolve, reject) => {
        nodeServer.once('error', reject);
        nodeServer.listen(opts.port ?? DEFAULT_PORT, opts.host ?? '127.0.0.1', () => {
          state.startedAt = new Date().toISOString();
          const addr = nodeServer.address();
          resolve({ port: addr.port, host: addr.address });
        });
      });
    },
    /** 停止并等待关闭。 */
    close() {
      return new Promise((resolve) => nodeServer.close(() => resolve()));
    },
    __state: state,
    __config: () => config,
  };
}

function buildRequestHandler(ctx) {
  return function requestHandler(req, res) {
    const chunks = [];
    let bytes = 0;
    let aborted = false; // 超限：排空请求体后在 end 时统一应答 413（保证客户端可读，消除早应答竞态）
    let destroyed = false; // 超硬限：直接断连防护
    req.on('data', (c) => {
      bytes += c.length;
      if (destroyed) return;
      if (bytes > HARD_BODY_LIMIT_BYTES) {
        destroyed = true;
        res.socket.destroy();
        return;
      }
      if (bytes > BODY_LIMIT_BYTES) {
        if (!aborted) { aborted = true; req.resume(); } // 丢弃后续数据，流式排空
        return;
      }
      if (!aborted) chunks.push(c);
    });
    req.on('end', () => {
      if (destroyed) return;
      if (aborted) {
        res.setHeader('connection', 'close');
        respondJson(req, res, 413, { error: { code: 'payload_too_large', message: `请求体超过 ${BODY_LIMIT_BYTES} 字节上限` } }, { scenario: 'body_limit' });
        return;
      }
      const bodyRaw = Buffer.concat(chunks).toString('utf8');
      try {
        route(req, res, bodyRaw, ctx);
      } catch (e) {
        respondJson(req, res, 500, { error: { code: 'handler_exception', message: String(e && e.message || e) } }, { scenario: 'handler_exception' });
      }
    });
    req.on('error', () => { /* 客户端中断：连接清理由 socket 负责 */ });
  };
}

function route(req, res, bodyRaw, ctx) {
  const url = new URL(req.url, 'http://loopback.invalid');
  const path = url.pathname;

  // —— 控制面（无鉴权；仅 loopback，文档明示不得暴露）——
  if (path === '/__mock__/health' && req.method === 'GET') return controlHealth(req, res, ctx);
  if (path === '/__mock__/config' && req.method === 'POST') return controlConfig(req, res, bodyRaw, ctx);
  if (path === '/__mock__/reset' && req.method === 'POST') return controlReset(req, res, ctx);
  if (path === '/__mock__/requests' && req.method === 'GET') return controlRequests(req, res, url, ctx);
  if (path === '/__mock__/projects' && req.method === 'GET') return controlProjects(req, res, ctx);
  if (path.startsWith('/__mock__/')) {
    return respondJson(req, res, 404, { error: { code: 'not_found', message: '未知控制面路径' } }, { scenario: 'control_404' });
  }

  // —— 模型列表端点（OpenAI 兼容形状）——
  if ((path === '/models' || path === '/v1/models') && req.method === 'GET') {
    return respondJson(req, res, 200, {
      object: 'list',
      data: ctx.startupConfig.models.map((m) => ({ id: m, object: 'model', owned_by: 'mock-simulation' })),
    }, { scenario: 'models_list' });
  }

  // —— 主端点：任意以 /chat/completions 结尾的路径（OpenAI 兼容形状）——
  if (path.endsWith('/chat/completions') && req.method === 'POST') {
    return handleCompletion(req, res, bodyRaw, ctx);
  }

  return respondJson(req, res, 404, { error: { code: 'not_found', message: `未知路径 ${path}` } }, { scenario: 'not_found' });
}

// ——————————————————————————————————————————————
// 主端点
// ——————————————————————————————————————————————

function handleCompletion(req, res, bodyRaw, ctx) {
  const { startupConfig, state } = ctx;
  const config = ctx.configRef();

  const projectId = headerValue(req, 'x-jw-project') ?? 'unknown-project';
  const runId = headerValue(req, 'x-jw-run') ?? null;
  const scenarioName = validScenario(headerValue(req, 'x-mock-scenario') ?? config.defaultScenario);
  const authMasked = describeAuth(req.headers.authorization);
  const bodyHash = createHash('sha256').update(bodyRaw).digest('hex');

  const logEntry = {
    seq: ++state.seq,
    at: new Date().toISOString(),
    method: req.method,
    path: req.url,
    scenario: scenarioName,
    projectId,
    runId,
    auth: authMasked,
    credentialAnomaly: null,
    bodyHash,
    bytes: bodyRaw.length,
    processed: false,
    statusSent: null,
  };
  state.counters.total += 1;
  bump(state.counters.byScenario, scenarioName);
  state.log.push(logEntry);
  if (state.log.length > LOG_RING_LIMIT) state.log.shift();

  // —— 自然鉴权（配置了 key 才启用；真实 key 永不回显）——
  if (startupConfig.apiKey !== null) {
    const provided = headerValue(req, 'authorization')
      ? String(req.headers.authorization).replace(/^Bearer\s+/i, '')
      : headerValue(req, 'x-api-key');
    if (provided !== startupConfig.apiKey) {
      logEntry.statusSent = 401;
      const detail = (provided === null || provided === undefined || provided === '')
        ? '请求缺少 API key（需要 Authorization: Bearer <key> 或 x-api-key）。'
        : `提供的 API key 无效：${maskSecret(String(provided))}。请检查 Authorization: Bearer <key>。`;
      return respondJson(req, res, 401, { error: { code: 'invalid_api_key', message: detail } }, { scenario: scenarioName });
    }
  }

  // —— 凭据异常探针：请求体中出现配置 key（客户端把 key 泄漏进 prompt）→ 标记 ——
  let credentialAnomaly = null;
  if (startupConfig.apiKey !== null && bodyRaw.includes(startupConfig.apiKey)) {
    credentialAnomaly = 'api_key_found_in_request_body';
    logEntry.credentialAnomaly = credentialAnomaly;
  }

  const p = {
    req, res, ctx, state, config, logEntry, projectId, runId, scenarioName, bodyRaw, bodyHash, credentialAnomaly,
  };

  switch (scenarioName) {
    case 'missing_field':
      logEntry.processed = true; logEntry.statusSent = 400;
      return respondJson(req, res, 400, { error: { code: 'invalid_request', message: '模拟缺字段：缺少必填字段 messages（即使请求完整也按场景返回）' } }, { scenario: scenarioName });
    case 'format_error':
      logEntry.processed = true; logEntry.statusSent = 400;
      return respondJson(req, res, 400, { error: { code: 'malformed_json', message: '模拟格式错：请求体无法解析（场景强制）' } }, { scenario: scenarioName });
    case 'latency': {
      const delay = clampInt(parseInt(headerValue(req, 'x-mock-delay-ms') ?? '', 10) || config.latencyMs, 0, MAX_DELAY_MS);
      return setTimeout(() => {
        logEntry.processed = true; logEntry.statusSent = 200; state.counters.completions += 1;
        naturalValidationThenSuccess({ ...p, scenarioName: 'latency' });
      }, delay);
    }
    case 'rate_limited':
      logEntry.processed = true; logEntry.statusSent = 429;
      res.setHeader('Retry-After', String(config.retryAfterSec));
      return respondJson(req, res, 429, { error: { code: 'rate_limit_exceeded', message: '模拟：请求频率超限，请按 Retry-After 退避。' } }, { scenario: scenarioName });
    case 'server_error_500':
      logEntry.processed = true; logEntry.statusSent = 500;
      return respondJson(req, res, 500, { error: { code: 'internal_error', message: '模拟：上游内部错误。' } }, { scenario: scenarioName });
    case 'server_error_502':
      logEntry.processed = true; logEntry.statusSent = 502;
      return respondJson(req, res, 502, { error: { code: 'bad_gateway', message: '模拟：上游网关错误。' } }, { scenario: scenarioName });
    case 'server_error_503':
      logEntry.processed = true; logEntry.statusSent = 503;
      return respondJson(req, res, 503, { error: { code: 'service_unavailable', message: '模拟：上游暂不可用。' } }, { scenario: scenarioName });
    case 'disconnect_before_response':
      // 请求已完整接收（processed=true），但响应字节零发送即断连 → 客户端侧只能得到 unknown。
      logEntry.processed = true;
      return void res.socket.destroy();
    case 'partial_response':
      // 200 头 + 半截响应体后断连 → 客户端收到传输错误或截断体；请求确实已处理（unknown 家族）。
      logEntry.processed = true;
      return writePartialThenDestroy(p);
    case 'malformed_response':
      // 200 + 干净关闭 + 故意损坏的 JSON 体：传输层"完成"但响应不可解析 —— 必须与成功区分。
      logEntry.processed = true; logEntry.statusSent = 200;
      res.writeHead(200, baseHeaders({ scenario: scenarioName, requestId: reqId(bodyHash) }));
      return void res.end('{"id":"chatcmpl-mock-truncated","object":"chat.completion","choi');
    case 'invalid_credential':
      // 强制 401（即使鉴权通过也模拟）：错误信息只含掩码 key —— 供"异常 credential 不泄露"断言。
      logEntry.processed = true; logEntry.statusSent = 401;
      return respondJson(req, res, 401, {
        error: {
          code: 'invalid_api_key',
          message: startupConfig.apiKey === null
            ? '模拟凭据异常：服务未配置鉴权，仍按 invalid_credential 场景返回（掩码占位 ***）。'
            : `模拟凭据异常：提供的 API key 无效：${maskSecret(headerValue(req, 'x-api-key') ?? '')}。`,
        },
      }, { scenario: scenarioName });
    case 'success':
    default:
      logEntry.processed = true; logEntry.statusSent = 200; state.counters.completions += 1;
      return naturalValidationThenSuccess(p);
  }
}

/** success/latency 场景：先做自然请求校验（缺字段/格式错 → 400），再返回确定性 200。 */
function naturalValidationThenSuccess(p) {
  const parsed = tryParseJson(p.bodyRaw);
  if (!parsed.ok) {
    p.logEntry.statusSent = 400;
    return respondJson(p.req, p.res, 400, { error: { code: 'malformed_json', message: `请求体不是合法 JSON：${parsed.error}` } }, { scenario: p.scenarioName });
  }
  const body = parsed.value;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    p.logEntry.statusSent = 400;
    return respondJson(p.req, p.res, 400, { error: { code: 'invalid_request', message: '请求体必须是 JSON 对象' } }, { scenario: p.scenarioName });
  }
  const missing = [];
  if (typeof body.model !== 'string' || body.model.trim() === '') missing.push('model');
  if (!Array.isArray(body.messages) || body.messages.length === 0) missing.push('messages');
  if (missing.length > 0) {
    p.logEntry.statusSent = 400;
    return respondJson(p.req, p.res, 400, { error: { code: 'invalid_request', message: `缺少必填字段：${missing.join(', ')}` } }, { scenario: p.scenarioName });
  }
  const payload = successPayload(p);
  const headers = baseHeaders({ scenario: p.scenarioName, requestId: reqId(p.bodyHash) });
  if (p.credentialAnomaly) headers['x-mock-credential-anomaly'] = p.credentialAnomaly;
  p.res.writeHead(200, headers);
  p.res.end(JSON.stringify(payload));
}

function writePartialThenDestroy(p) {
  const full = JSON.stringify(successPayload(p));
  p.res.writeHead(200, baseHeaders({ scenario: p.scenarioName, requestId: reqId(p.bodyHash) }));
  p.res.write(full.slice(0, Math.max(1, Math.floor(full.length / 2))), 'utf8');
  setTimeout(() => {
    p.logEntry.statusSent = 200;
    p.res.socket.destroy();
  }, 20);
}

/** 确定性成功载荷：同 seed + 同请求体 → 恒同 id/content/created。 */
function successPayload({ ctx, projectId, scenarioName, bodyRaw, bodyHash, credentialAnomaly }) {
  const parsed = tryParseJson(bodyRaw);
  const body = parsed.ok ? parsed.value : {};
  const model = typeof body.model === 'string' ? body.model : 'unknown';

  const seedHash = createHash('sha256').update(`${ctx.startupConfig.seed}|${bodyHash}`).digest('hex');
  const canary = projectCanary(ctx.startupConfig.seed, projectId);

  // 脚本指令：最后一条 user 消息含 MOCK_RESPOND_JSON <json> → 原样返回该 JSON（脚本化 transport，
  // 内容来自调用方脚本，不代表模型能力——文档明示）。
  const directive = extractRespondDirective(body);

  const messagesCount = Array.isArray(body.messages) ? body.messages.length : 0;
  const content = directive !== null
    ? JSON.stringify(directive, null, 2)
    : [
        '[MOCK-SIMULATION] 确定性模拟响应，不代表真实模型能力或训练效果。',
        `request=${seedHash.slice(0, 16)} model=${typeof body.model === 'string' ? body.model : 'unknown'} messages=${messagesCount}`,
        `project=${projectId}`,
        `[[${canary}]]`,
        '仅用于传输层联调与故障演练（V7 backend-next Lane C）。',
      ].join('\n');

  return {
    id: `chatcmpl-mock-${seedHash.slice(0, 24)}`,
    object: 'chat.completion',
    created: parseInt(seedHash.slice(24, 34), 16), // 确定性"时间戳"（非真实时钟）
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: JSON.stringify(body.messages ?? []).length,
      completion_tokens: content.length,
      total_tokens: JSON.stringify(body.messages ?? []).length + content.length,
    },
    mock: {
      simulationOnly: true,
      realModelCapability: false,
      apiVersion: MOCK_API_VERSION,
      scenario: scenarioName,
      seed: ctx.startupConfig.seed,
      projectId,
      canary,
      canonicalRequestHash: bodyHash,
      responseSeedHash: seedHash,
      credentialAnomaly: credentialAnomaly ?? null,
    },
  };
}

// ——————————————————————————————————————————————
// 控制面
// ——————————————————————————————————————————————

function controlHealth(req, res, ctx) {
  const { state, startupConfig } = ctx;
  respondJson(req, res, 200, {
    ok: true,
    simulationOnly: true,
    realModelCapability: false,
    apiVersion: MOCK_API_VERSION,
    startedAt: state.startedAt,
    uptimeSec: state.startedAt === null ? 0 : Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000),
    seed: startupConfig.seed,
    authRequired: startupConfig.apiKey !== null,
    authKeyMasked: maskSecret(startupConfig.apiKey ?? ''),
    config: ctx.configRef(),
    counters: state.counters,
    scenarios: SCENARIOS,
  }, { scenario: 'control' });
}

function controlConfig(req, res, bodyRaw, ctx) {
  const parsed = tryParseJson(bodyRaw);
  if (!parsed.ok || parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return respondJson(req, res, 400, { error: { code: 'invalid_request', message: '配置体必须是 JSON 对象' } }, { scenario: 'control' });
  }
  const body = parsed.value;
  const next = { ...ctx.configRef() };
  const errors = [];
  if (body.defaultScenario !== undefined) {
    if (SCENARIOS.includes(body.defaultScenario)) next.defaultScenario = body.defaultScenario;
    else errors.push(`defaultScenario 必须是 ${SCENARIOS.join('|')} 之一`);
  }
  if (body.latencyMs !== undefined) {
    const v = Number(body.latencyMs);
    if (Number.isInteger(v) && v >= 0 && v <= MAX_DELAY_MS) next.latencyMs = v;
    else errors.push(`latencyMs 必须是 0..${MAX_DELAY_MS} 整数`);
  }
  if (body.retryAfterSec !== undefined) {
    const v = Number(body.retryAfterSec);
    if (Number.isInteger(v) && v >= 0 && v <= 300) next.retryAfterSec = v;
    else errors.push('retryAfterSec 必须是 0..300 整数');
  }
  if (errors.length > 0) {
    return respondJson(req, res, 400, { error: { code: 'invalid_request', message: errors.join('；') } }, { scenario: 'control' });
  }
  ctx.setConfig(next);
  respondJson(req, res, 200, { ok: true, config: ctx.configRef() }, { scenario: 'control' });
}

function controlReset(req, res, ctx) {
  ctx.setConfig({ ...ctx.initialConfig });
  ctx.state.log = [];
  ctx.state.counters = { total: 0, byScenario: {}, completions: 0 };
  ctx.state.seq = 0;
  respondJson(req, res, 200, { ok: true, reset: true, config: ctx.configRef() }, { scenario: 'control' });
}

function controlRequests(req, res, url, ctx) {
  const project = url.searchParams.get('project');
  const limit = clampInt(parseInt(url.searchParams.get('limit') ?? '200', 10) || 200, 1, LOG_RING_LIMIT);
  let items = ctx.state.log;
  if (project !== null) items = items.filter((e) => e.projectId === project);
  respondJson(req, res, 200, { count: items.length, requests: items.slice(-limit) }, { scenario: 'control' });
}

function controlProjects(req, res, ctx) {
  const byProject = {};
  for (const e of ctx.state.log) {
    const p = byProject[e.projectId] ?? (byProject[e.projectId] = {
      projectId: e.projectId,
      canary: projectCanary(ctx.startupConfig.seed, e.projectId),
      requests: 0,
    });
    p.requests += 1;
  }
  respondJson(req, res, 200, { projects: Object.values(byProject) }, { scenario: 'control' });
}

// ——————————————————————————————————————————————
// 公共小件
// ——————————————————————————————————————————————

/** 项目 canary：仅由 seed+projectId 决定 —— 跨项目串线探针的锚点。 */
export function projectCanary(seed, projectId) {
  return `canary-${createHash('sha256').update(`${seed}::project::${projectId}`).digest('hex').slice(0, 12)}`;
}

/** 提取最后一条 user 消息中的 MOCK_RESPOND_JSON 指令；无/非法 → null。 */
export function extractRespondDirective(body) {
  if (!Array.isArray(body?.messages)) return null;
  for (let i = body.messages.length - 1; i >= 0; i--) {
    const m = body.messages[i];
    if (m?.role !== 'user') continue;
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
    const idx = text.indexOf('MOCK_RESPOND_JSON ');
    if (idx === -1) continue;
    const raw = text.slice(idx + 'MOCK_RESPOND_JSON '.length).trim();
    const parsed = tryParseJson(raw);
    return parsed.ok ? parsed.value : null;
  }
  return null;
}

function reqId(bodyHash) { return `mock-req-${bodyHash.slice(0, 12)}`; }

function baseHeaders({ scenario, requestId }) {
  return {
    'content-type': 'application/json; charset=utf-8',
    'x-mock-simulation': 'true',
    'x-mock-api-version': MOCK_API_VERSION,
    'x-mock-scenario': scenario,
    'x-request-id': requestId,
  };
}

function respondJson(req, res, status, body, { scenario }) {
  if (!res.headersSent) res.writeHead(status, baseHeaders({ scenario: scenario ?? 'unknown', requestId: `mock-req-sync-${Date.now().toString(16)}` }));
  res.end(JSON.stringify(body));
}

function bump(obj, key) { obj[key] = (obj[key] ?? 0) + 1; }

function headerValue(req, name) {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function validScenario(name) {
  return SCENARIOS.includes(name) ? name : 'success';
}

function clampInt(v, min, max) {
  if (!Number.isInteger(v)) return min;
  return Math.min(max, Math.max(min, v));
}

function tryParseJson(text) {
  try { return { ok: true, value: JSON.parse(text) }; }
  catch (e) { return { ok: false, error: String(e.message ?? e) }; }
}
