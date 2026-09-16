// provider 映射一:通用 HTTP 模型服务(OpenAI Chat Completions 兼容格式)。
// 纯映射函数:只做"协议载荷 ↔ 外部请求/响应"转换,不发请求、不持凭据。
//
// 外部格式来源(2026-09-13 检索):
// - OpenAI API OpenAPI spec v2.3.0,POST /v1/chat/completions
//   (platform.openai.com/docs/api-reference/chat/create;经 OpenAPI spec 工具核对,
//    请求体 CreateChatCompletionRequest:{model, messages:[{role, content}], response_format, stream, ...};
//    响应 CreateChatCompletionResponse:{id, object:'chat.completion', choices:[{index, message:{role, content}, finish_reason}], usage:{prompt_tokens, completion_tokens, total_tokens}};
//    错误体:{error:{message, type, code}};429/503 为速率/服务错误。)
// 本模块只用其"事实标准兼容面"(绝大多数通用 HTTP 模型网关都实现 chat/completions 形状);
// 未对真实服务端点做过兼容测试,见 REPORT 的 NOT TESTED 声明。

/** 约定的系统提示:声明角色边界与输出协议(模型无审批权;引用必须来自给定清单)。 */
function systemPromptFor(payload) {
  return [
    `你是远程尽调协作中的辅助分析角色(${payload.roleLabel ?? payload.role}),用途:${payload.purpose}。`,
    '边界:你没有审批权限,不得输出任何批准/核准/放款类决定;只能输出发现(findings)与追问(questions)。',
    '所有发现必须引用下面给出的证据清单中的证据(id/version/hash 完全一致);不得编造证据,不得输出清单之外的事实。',
    '输出语言:中文。输出必须是 JSON 对象:{"findings":[{"id","text","evidenceRefs":[{"id","version","hash"}]}],"questions":[{"id","text","evidenceRefs":[]}],"evidenceRefs":[]}',
  ].join('\n');
}

/**
 * 构造 Chat Completions 请求。
 * config: { baseUrl, model, apiKey?, getApiKey? }
 * 凭据纪律:优先 getApiKey 回调;两者都缺时用占位符 <BYO-API-KEY>,
 * 绝不在模块内读取环境变量或配置文件(取凭据是业务层职责)。
 */
export function buildChatCompletionsRequest(payload, config = {}) {
  if (!config.baseUrl) throw new TypeError('buildChatCompletionsRequest 缺少 config.baseUrl');
  if (!config.model) throw new TypeError('buildChatCompletionsRequest 缺少 config.model');
  const apiKey = typeof config.getApiKey === 'function' ? config.getApiKey() : config.apiKey ?? '<BYO-API-KEY>';
  const base = config.baseUrl.endsWith('/') ? config.baseUrl.slice(0, -1) : config.baseUrl;
  return {
    method: 'POST',
    url: `${base}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: {
      model: config.model,
      messages: [
        { role: 'system', content: systemPromptFor(payload) },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
      metadata: { requestId: payload.requestId, sessionId: payload.sessionId },
    },
  };
}

function normalizeUsage(u) {
  if (!u || typeof u !== 'object') return null;
  return {
    promptTokens: Number.isInteger(u.prompt_tokens) ? u.prompt_tokens : null,
    completionTokens: Number.isInteger(u.completion_tokens) ? u.completion_tokens : null,
    totalTokens: Number.isInteger(u.total_tokens) ? u.total_tokens : null,
  };
}

/**
 * 解析 Chat Completions 响应 → { output?, usage?, error? }(HTTP 形状恒可判定,不产生 indeterminate;
 * indeterminate 仅 Dify blocking 出现 running/paused 状态时由 dify-workflow.mjs 返回)。
 * - 错误体({error:{...}})→ { error };usage 若存在仍然带出(调用可能已计费)。
 * - choices[0].message.content 必须是 JSON 字符串(response_format json_object 约定);
 *   非 JSON → { error:{code:'PROVIDER_CONTENT_NOT_JSON'} }(适配器将判 failed,不伪装成功)。
 */
export function parseChatCompletionsResponse(raw) {
  const usage = normalizeUsage(raw && raw.usage);
  if (raw && raw.error) {
    return {
      error: {
        code: raw.error.code || raw.error.type || 'PROVIDER_ERROR',
        message: `外部模型服务返回错误:${raw.error.message || JSON.stringify(raw.error).slice(0, 200)}`,
      },
      usage,
    };
  }
  const content = raw && Array.isArray(raw.choices) && raw.choices[0] && raw.choices[0].message
    ? raw.choices[0].message.content
    : undefined;
  if (typeof content !== 'string' || content.length === 0) {
    return {
      error: { code: 'PROVIDER_EMPTY_CONTENT', message: '外部模型服务返回空内容(choices/message/content 缺失)' },
      usage,
    };
  }
  let output;
  try {
    output = JSON.parse(content);
  } catch {
    return {
      error: { code: 'PROVIDER_CONTENT_NOT_JSON', message: '外部模型服务返回的内容不是合法 JSON,已拒绝解析' },
      usage,
    };
  }
  return { output, usage };
}
