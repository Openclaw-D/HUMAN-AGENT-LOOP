// B路(V6-API-TRANSPORT)· 服务端 HTTP 模型 transport(2026-09-13 整夜任务)。
//
// 契约对齐:V6/handoff/API_OVERNIGHT_20260913/CONTRACT.md §1/§2/§4(A路 2026-09-13 23:10 冻结)。
// A 集成方式:本文件经 A 审查后复制为 site/lib/v5-preview/model-adapter/providers/http-fetch.mjs,
// 并把下方唯一一条 import 改为 './http-json.mjs'(其余零改动、零依赖)。
//
// 复用(只读 import 自产品源纯映射,语义不改):
// - providers/http-json.mjs:buildChatCompletionsRequest(载荷→Chat Completions请求)
//   parseChatCompletionsResponse(响应体→{output|error,usage})
//
// 在产品 createProviderTransport 之外、由本层补齐的服务端必要项:
// - 配置校验:端点/模型/密钥缺失 → 送出前抛 { notSent:true } 的 TRANSPORT_NOT_CONFIGURED
//   (中文列出缺项);端点必须是合法 http/https URL 且不得内嵌凭据(user:pass@);
// - enrich 注入(CONTRACT §2):enrich(call) 的证据正文/人工回复并入发往模型的载荷
//   **副本**( {...payload, context} ),不改冻结原件、不影响适配器 payloadHash 语义;
//   enrich 返回 null → 不并 context 照常发送;enrich 抛异常/返回非法类型 → 送出前失败关闭;
// - HTTP 状态判定:非 2xx 一律失败(带 httpStatus),错误体 JSON 复用既有解析取
//   {error.code,message,usage};错误信息一律截断到 200 字符、不回显原始响应体;
// - 响应体非 JSON(2xx):显式 SERVER_HTTP_NOT_JSON;
// - 取消/超时(CONTRACT §1):透传 call.signal 到 fetch;超时由候选适配器 timeoutMs 竞速,
//   transport 自身不另设双超时(默认无内部计时器)。可选 deadlineAbortMs(缺省关闭):
//   显式启用后在送出该毫秒数仍无响应时真正 abort 在途 fetch 并返回 ok:'indeterminate';
//   送出后中止/超时一律 ok:'indeterminate'(适配器判 unknown,不谎称未计费);
//   可证明未建立连接(ENOTFOUND/ECONNREFUSED 等)才抛 { notSent:true }(适配器判
//   cancelled 并释放预留,这是诚实的"未发生外部调用");
// - 脱敏:任何返回值/错误信息不含 Authorization、不回显原始响应体;网络错误只报错误码。
//
// 凭据纪律:本模块不读 process.env、不读任何本地软件凭据;密钥只经显式注入的
// config.getApiKey()(契约形状)或 config.apiKey 字符串传入。
import {
  buildChatCompletionsRequest,
  parseChatCompletionsResponse,
} from '../../../../jianwei-v3/site/lib/v5-preview/model-adapter/providers/http-json.mjs';

/** 服务端配置键(CONTRACT §4 冻结名;本表是 source 对象的字段名,便于 A 从其自有 env 组装)。 */
export const SERVER_MODEL_ENV_KEYS = Object.freeze({
  baseUrl: 'JIANWEI_MODEL_BASE_URL', // 端点 base,例:https://host/v1
  model: 'JIANWEI_MODEL_NAME',       // 模型名
  apiKey: 'JIANWEI_MODEL_API_KEY',   // 产品密钥(仅服务端;不得 NEXT_PUBLIC)
  mode: 'JIANWEI_MODEL_MODE',        // real | simulation(缺省 simulation;非 real 不发起真实调用)
});

const FIELD_LABELS = Object.freeze({
  baseUrl: '端点(baseUrl)',
  model: '模型名(model)',
  apiKey: '密钥(apiKey/getApiKey)',
});

/** 网络层"可证明未送达"的错误码(连接从未建立;连接后中断一律按可能已送达处理)。 */
const CONNECT_NEVER_ESTABLISHED = Object.freeze(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT']);

const MESSAGE_CAP = 200; // CONTRACT §1:错误信息脱敏,不回显超过 200 字符的内容

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 送出前失败的唯一形态:throw 带 notSent:true(适配器判 cancelled 并释放预留)。 */
function notSentError(code, message) {
  return Object.assign(new Error(message), { notSent: true, code });
}

function capMessage(s) {
  if (typeof s !== 'string') return s;
  return s.length > MESSAGE_CAP ? `${s.slice(0, MESSAGE_CAP)}…(已截断)` : s;
}

const systemTimers = Object.freeze({
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
});

/** 端点合法性:http/https、URL 可解析、不内嵌凭据。返回 null 或中文原因。 */
function endpointProblem(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return '端点不是合法 URL';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '端点仅允许 http/https';
  if (url.username || url.password) return '端点不允许内嵌凭据(user:pass@)';
  return null;
}

/** 凭据是否显式在场:apiKey 非空字符串,或 getApiKey 回调(CONTRACT §1 形状)。 */
function credentialPresent(config) {
  return (typeof config.apiKey === 'string' && config.apiKey.trim() !== '')
    || typeof config.getApiKey === 'function';
}

/** 对已构造的 config 做逐项检查(纯函数;resolve 与 transport 每次调用共用)。 */
function configProblems(config) {
  if (!isPlainObject(config)) {
    return { missing: ['baseUrl', 'model', 'apiKey'], invalid: [] };
  }
  const missing = [];
  const invalid = [];
  const baseUrl = typeof config.baseUrl === 'string' ? config.baseUrl.trim() : '';
  const model = typeof config.model === 'string' ? config.model.trim() : '';
  if (baseUrl === '') missing.push('baseUrl');
  else {
    const p = endpointProblem(baseUrl);
    if (p) invalid.push({ field: 'baseUrl', reason: p });
  }
  if (model === '') missing.push('model');
  if (!credentialPresent(config)) missing.push('apiKey');
  return { missing, invalid };
}

/**
 * 从显式注入的 source(A路路由层自持的服务端配置对象,通常取自其自有 env)解析配置。
 * 本函数绝不自己读 process.env。返回:
 *   { ok:true,  config:{ baseUrl, model, apiKey }, sanitized:{...无秘密摘要} }
 *   { ok:false, missing:[{field,env,label}], invalid:[{field,reason}], sanitized:{...} }
 * sanitized 可直接用于 STATUS/日志:只含端点、模型名、mode、hasApiKey 布尔,绝不含密钥值。
 * mode 仅报告不裁决:是否发起真实调用由 A 在路由/bridge 侧按 CONTRACT §4 决定(非 real 不调)。
 */
export function resolveServerModelConfig(source) {
  const src = isPlainObject(source) ? source : {};
  const rawBaseUrl = typeof src[SERVER_MODEL_ENV_KEYS.baseUrl] === 'string' ? src[SERVER_MODEL_ENV_KEYS.baseUrl].trim() : '';
  const rawModel = typeof src[SERVER_MODEL_ENV_KEYS.model] === 'string' ? src[SERVER_MODEL_ENV_KEYS.model].trim() : '';
  const rawApiKey = typeof src[SERVER_MODEL_ENV_KEYS.apiKey] === 'string' ? src[SERVER_MODEL_ENV_KEYS.apiKey].trim() : '';
  const rawMode = typeof src[SERVER_MODEL_ENV_KEYS.mode] === 'string' ? src[SERVER_MODEL_ENV_KEYS.mode].trim() : '';
  const config = { baseUrl: rawBaseUrl, model: rawModel, apiKey: rawApiKey };
  const { missing, invalid } = configProblems(config);
  if (rawMode !== '' && rawMode !== 'real' && rawMode !== 'simulation') {
    invalid.push({ field: 'mode', reason: 'JIANWEI_MODEL_MODE 仅允许 real / simulation(缺省 simulation)' });
  }
  const sanitized = {
    configured: missing.length === 0 && invalid.length === 0,
    mode: rawMode === '' ? 'simulation' : rawMode,
    baseUrl: rawBaseUrl === '' ? null : rawBaseUrl,
    endpoint: rawBaseUrl === '' ? null : `${rawBaseUrl.replace(/\/+$/, '')}/chat/completions`,
    model: rawModel === '' ? null : rawModel,
    hasApiKey: rawApiKey !== '',
  };
  if (missing.length > 0 || invalid.length > 0) {
    return {
      ok: false,
      missing: missing.map((field) => ({ field, env: SERVER_MODEL_ENV_KEYS[field], label: FIELD_LABELS[field] })),
      invalid,
      sanitized,
    };
  }
  return { ok: true, config, sanitized };
}

/** 供 STATUS 页/日志使用的无秘密摘要;source 未配置时同样安全。 */
export function describeServerModelConfig(source) {
  return resolveServerModelConfig(source).sanitized;
}

/**
 * 服务端 HTTP transport(CONTRACT §1 目标形状,CandidateTransport 兼容):
 *   createHttpJsonTransport({ config:{ baseUrl, model, getApiKey, timeoutMs? }, fetchImpl?, enrich? })
 *   返回 async (call) => transportResult;call = { payload, role, signal? }
 *   transportResult = { ok:true, output, usage? }
 *                   | { ok:false, sent:true, error:{ code, message, httpStatus? }, usage? }
 *                   | { ok:'indeterminate' }            —— 送出后超时/中止,结果不可知(适配器判 unknown)
 *   送出前失败:throw { notSent:true, code, message }(适配器判 cancelled 并释放预留)。
 *
 * 说明:
 * - config.timeoutMs 仅透传给适配器竞速使用(A 侧接线),本 transport 默认不另设双超时;
 *   可选 deadlineAbortMs(缺省关闭)用于显式启用"到点真正 abort 在途 fetch"。
 * - enrich(call)(CONTRACT §2):A 提供;返回 { evidence, humanReplies, annotationQuestion }
 *   或 null。返回对象时以 {...payload, context} 副本发往模型;不改冻结原件。
 * - 依赖注入:fetchImpl(测试桩/网关 fetch,缺省 globalThis.fetch)、clock(测试手动时钟)。
 */
export function createHttpJsonTransport({
  config = null,
  fetchImpl = null,
  enrich = null,
  deadlineAbortMs = null,
  clock = systemTimers,
  modeName = 'http_json',
} = {}) {
  return async function httpJsonTransport(call) {
    // 1) 配置校验(每次调用都查;缺失/非法 → 送出前失败,列出缺项,不伪装)。
    const { missing, invalid } = configProblems(config);
    if (missing.length > 0 || invalid.length > 0) {
      const missText = missing.map((f) => FIELD_LABELS[f] ?? f).concat(
        invalid.map((x) => `${FIELD_LABELS[x.field] ?? x.field}:${x.reason}`),
      );
      throw notSentError(
        'TRANSPORT_NOT_CONFIGURED',
        `未配置模型服务,未发生任何外部调用;待补齐:${missText.join('、') || '配置整体缺失'}`,
      );
    }
    if (!isPlainObject(call) || !isPlainObject(call.payload)) {
      throw notSentError('PAYLOAD_INVALID', 'transport 收到非法 call/payload,未发生外部调用');
    }
    // 2) 送出前已取消 → 确定未发送。
    if (call.signal && call.signal.aborted) {
      throw notSentError('CANCELLED_BEFORE_SEND', '送出前已取消,未发生外部调用');
    }
    // 3) enrich(CONTRACT §2):证据正文并入载荷副本;冻结原件不动、payloadHash 语义不变。
    let outgoing = call.payload;
    if (enrich !== null) {
      let enriched;
      try {
        enriched = await enrich(call);
      } catch (err) {
        throw notSentError('ENRICH_FAILED', `enrich(call) 抛出异常,请求未发送:${capMessage(String((err && err.message) || err))}`);
      }
      if (enriched !== null && enriched !== undefined) {
        if (!isPlainObject(enriched)) {
          throw notSentError('ENRICH_FAILED', 'enrich(call) 返回类型非法(需对象或 null),请求未发送');
        }
        outgoing = { ...call.payload, context: enriched };
      }
    }
    // 4) 组装请求(复用产品映射;缺端点/模型已在上一步拦截)。
    let req;
    try {
      req = buildChatCompletionsRequest(outgoing, config);
    } catch (err) {
      throw notSentError('TRANSPORT_NOT_CONFIGURED', `请求构造失败,未发生外部调用:${capMessage(String((err && err.message) || err))}`);
    }

    const controller = new AbortController();
    let timerId = null;
    let onExternalAbort = null;
    let deadlineHit = false;
    const settle = () => {
      if (timerId !== null) clock.clearTimeout(timerId);
      timerId = null;
      if (onExternalAbort) call.signal.removeEventListener('abort', onExternalAbort);
      onExternalAbort = null;
    };

    // 5) 送出。外部调用从这里开始可能发生。
    let res;
    try {
      if (Number.isFinite(deadlineAbortMs) && deadlineAbortMs > 0) {
        timerId = clock.setTimeout(() => {
          deadlineHit = true;
          controller.abort();
        }, deadlineAbortMs);
      }
      if (call.signal) {
        onExternalAbort = () => controller.abort();
        call.signal.addEventListener('abort', onExternalAbort, { once: true });
      }
      const doFetch = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch;
      if (typeof doFetch !== 'function') {
        throw notSentError('TRANSPORT_NOT_CONFIGURED', '未注入 fetchImpl 且运行时无 fetch:这是部署配置缺失,不是模型失败');
      }
      res = await doFetch(req.url, {
        method: req.method || 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: controller.signal,
      });
    } catch (err) {
      settle();
      if (err && err.notSent === true) throw err;
      // 送出后超时/中止:外部调用可能已发生,结果不可知(适配器判 unknown,不做自动重试)。
      if (deadlineHit || err.name === 'AbortError' || err.code === 'ABORT_ERR' || err.name === 'TimeoutError') {
        return { ok: 'indeterminate' };
      }
      // 网络·可证明未送达(连接从未建立):请求确定未到服务端,notSent 是诚实的。
      let netCode = null;
      let cursor = err;
      for (let depth = 0; cursor && depth < 4; depth += 1) {
        if (typeof cursor.code === 'string' && CONNECT_NEVER_ESTABLISHED.includes(cursor.code)) {
          netCode = cursor.code;
          break;
        }
        cursor = cursor.cause;
      }
      if (netCode !== null) {
        throw notSentError('SERVER_HTTP_CONNECT_FAILED', `连接模型服务失败(${netCode}):连接未建立,请求未送达`);
      }
      // 其余网络错误:连接可能已建立,状态不可知,不谎称失败或未计费。
      return { ok: 'indeterminate' };
    }

    try {
      const rawText = await res.text();
      // 6) HTTP 状态判定:非 2xx 一律失败。错误体 JSON 时复用既有解析(取 code/message/usage),
      //    其余只报状态码与内容类型;消息截断到 200 字符,绝不回显原始响应体(脱敏)。
      if (!res.ok) {
        let bodyJson = null;
        try {
          bodyJson = JSON.parse(rawText);
        } catch {
          bodyJson = null;
        }
        if (isPlainObject(bodyJson) && isPlainObject(bodyJson.error)) {
          const mapped = parseChatCompletionsResponse(bodyJson);
          return {
            ok: false,
            sent: true,
            httpStatus: res.status,
            usage: mapped.usage ?? undefined,
            error: {
              code: (mapped.error && mapped.error.code) || `HTTP_${res.status}`,
              message: capMessage((mapped.error && mapped.error.message) || `外部模型服务返回 HTTP ${res.status}`),
              httpStatus: res.status,
            },
          };
        }
        const contentType = res.headers && typeof res.headers.get === 'function'
          ? res.headers.get('content-type') || '未知类型'
          : '未知类型';
        return {
          ok: false,
          sent: true,
          httpStatus: res.status,
          error: {
            code: `HTTP_${res.status}`,
            message: capMessage(`外部模型服务返回 HTTP ${res.status},响应体非 JSON(${contentType}),原文不回显`),
            httpStatus: res.status,
          },
        };
      }
      // 7) 2xx 但响应体非 JSON:显式失败,不吞成含混异常。
      let raw;
      try {
        raw = JSON.parse(rawText);
      } catch {
        return {
          ok: false,
          sent: true,
          httpStatus: res.status,
          error: { code: 'SERVER_HTTP_NOT_JSON', message: '外部模型服务返回的响应体不是合法 JSON,已拒绝解析', httpStatus: res.status },
        };
      }
      // 8) 响应解析(复用产品映射):错误形状/空内容/内容非 JSON → 失败;否则透传 output+usage。
      const parsed = parseChatCompletionsResponse(raw);
      if (parsed.indeterminate) return { ok: 'indeterminate' };
      if (parsed.error) {
        return {
          ok: false,
          sent: true,
          httpStatus: res.status,
          usage: parsed.usage ?? undefined,
          error: { code: parsed.error.code, message: capMessage(parsed.error.message), httpStatus: res.status },
        };
      }
      return { ok: true, modeName, output: parsed.output, usage: parsed.usage ?? undefined };
    } finally {
      settle();
    }
  };
}
