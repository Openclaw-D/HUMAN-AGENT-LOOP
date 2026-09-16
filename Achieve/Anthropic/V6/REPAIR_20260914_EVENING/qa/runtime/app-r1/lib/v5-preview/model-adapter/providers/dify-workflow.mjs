// provider 映射二:Dify Workflow(Service API,Workflow 应用)。
// 纯映射函数:只做"协议载荷 ↔ Dify 请求/响应"转换,不发请求、不持凭据、不改 Dify 配置。
//
// 外部格式来源(2026-09-13 检索):docs.dify.ai → API Reference → Workflow Runs → Run Workflow
//   POST /workflows/run;请求体 WorkflowExecutionRequest:{inputs(必填), response_mode('blocking'|'streaming',缺省 blocking), user(必填), files?}
//   blocking 响应:{task_id, workflow_run_id, data:{id, workflow_id, status, outputs, error, elapsed_time, total_steps, total_tokens, created_at, finished_at}}
//   data.status ∈ running|succeeded|failed|stopped|partial-succeeded|paused
//   错误体:{code, message, status};400 invalid_param 等,429 rate_limit_error,500 internal_server_error
// 约定:Workflow 的 End 节点输出变量必须命名为 analysis_payload(JSON 字符串,内容为协议输出结构);
//       若部署方用其他变量名,需在 config.outputVariable 指定。
// 未对真实 Dify 实例做端到端兼容测试,见 REPORT 的 NOT TESTED 声明。

function systemNoteFor(payload) {
  // Dify Workflow 内部编排由部署方定义;这里把角色边界随 inputs 传入,供 workflow 内提示词使用。
  return {
    role: payload.role,
    roleLabel: payload.roleLabel,
    purpose: payload.purpose,
    authority: 'none',
    forbidApprovalOutput: true,
    onlyUseListedEvidence: true,
    outputLanguage: 'zh-CN',
  };
}

/**
 * 构造 Dify Workflow Run 请求。
 * config: { baseUrl, apiKey?, getApiKey? }
 * 凭据纪律:优先 getApiKey 回调;缺省占位 <BYO-DIFY-APP-KEY>。绝不读环境变量/配置文件。
 */
export function buildDifyWorkflowRequest(payload, config = {}) {
  if (!config.baseUrl) throw new TypeError('buildDifyWorkflowRequest 缺少 config.baseUrl');
  const apiKey = typeof config.getApiKey === 'function' ? config.getApiKey() : config.apiKey ?? '<BYO-DIFY-APP-KEY>';
  const base = config.baseUrl.endsWith('/') ? config.baseUrl.slice(0, -1) : config.baseUrl;
  return {
    method: 'POST',
    url: `${base}/workflows/run`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: {
      inputs: {
        analysis_payload: JSON.stringify(payload),
        role_boundary: JSON.stringify(systemNoteFor(payload)),
      },
      response_mode: 'blocking',
      user: `jianwei-adapter:${payload.sessionId}`,
    },
  };
}

function normalizeUsage(data) {
  if (!data || typeof data !== 'object') return null;
  // Dify Workflow blocking 响应只提供 total_tokens,无 prompt/completion 拆分。
  return {
    promptTokens: null,
    completionTokens: null,
    totalTokens: Number.isInteger(data.total_tokens) ? data.total_tokens : null,
  };
}

/**
 * 解析 Dify blocking 响应 → { output?, usage?, error?, indeterminate? }。
 * - 错误体({code,message,status})→ { error }(usage 无)。
 * - data.status='succeeded' → 从 outputs[config.outputVariable ?? 'analysis_payload'] 解析 JSON。
 * - 'failed'/'stopped'/'partial-succeeded' → { error }(usage 带出:调用已发生、可能已计费)。
 *   partial-succeeded 明确映射为失败:协议要求"部分失败不得当成功"。
 * - 'running'/'paused' 出现在 blocking 应答属于协议异常 → { indeterminate:true }。
 */
export function parseDifyWorkflowResponse(raw, config = {}) {
  if (raw && typeof raw === 'object' && typeof raw.code === 'string' && !raw.data) {
    return {
      error: { code: raw.code, message: `Dify Workflow 返回错误:${raw.message || raw.code}` },
      usage: null,
    };
  }
  const data = raw && typeof raw === 'object' ? raw.data : undefined;
  if (!data || typeof data !== 'object') {
    return { error: { code: 'DIFY_RESPONSE_MALFORMED', message: 'Dify Workflow 响应缺少 data 对象' }, usage: null };
  }
  const usage = normalizeUsage(data);
  if (data.status === 'succeeded') {
    const variable = config.outputVariable ?? 'analysis_payload';
    const outputs = data.outputs && typeof data.outputs === 'object' ? data.outputs : {};
    const content = outputs[variable];
    if (typeof content !== 'string' || content.length === 0) {
      return {
        error: { code: 'DIFY_OUTPUT_VARIABLE_MISSING', message: `Dify Workflow 输出缺少约定变量 ${variable}(JSON 字符串)` },
        usage,
      };
    }
    let output;
    try {
      output = JSON.parse(content);
    } catch {
      return { error: { code: 'DIFY_OUTPUT_NOT_JSON', message: `Dify Workflow 输出变量 ${variable} 不是合法 JSON` }, usage };
    }
    return { output, usage };
  }
  if (data.status === 'failed' || data.status === 'stopped' || data.status === 'partial-succeeded') {
    const code = `DIFY_STATUS_${data.status.toUpperCase().replace(/-/g, '_')}`;
    const zh = { failed: '执行失败', stopped: '执行被停止', 'partial-succeeded': '部分成功(部分失败不允许当成功)' }[data.status];
    return {
      error: { code, message: `Dify Workflow ${zh}:status=${data.status}${data.error ? `,error=${data.error}` : ''}` },
      usage,
    };
  }
  // running / paused 或未知状态出现在 blocking 应答:无法判定结果
  return { indeterminate: true, usage };
}
