// 脱敏响应 fixtures:结构取自官方文档示例(来源见各 provider 映射文件头注释),
// 内容全部改写为合成尽调场景,不含任何真实客户数据、真实凭据、真实端点。
// 用途:在无真实服务/密钥时验证映射函数与适配器协议;不构成真实兼容性证明。

/** 与 evidence/ 中合成证据字节对应的 hash 由 helpers 现算;fixture 只需要结构合法。 */

// ---- OpenAI Chat Completions 形状(官方示例结构,usage 数字沿用官方示例 19/10/29) ----

export const HTTP_GOOD = Object.freeze({
  id: 'chatcmpl-fixture-good-1',
  object: 'chat.completion',
  created: 1757400000,
  model: 'example-model-for-tests',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        // content 是 JSON 字符串:发现引用本次输入证据 EV-001,中文文本,无越权词
        content: JSON.stringify({
          findings: [
            {
              id: 'F1',
              text: '示例发现:该客户应收账款回款周期同比明显拉长,需核对主要欠款方的结算条款。',
              evidenceRefs: [{ id: 'EV-001', version: 'v3', hash: 'aa' }],
            },
          ],
          questions: [
            { id: 'Q1', text: '请提供最近两期主要欠款方的对账单。', evidenceRefs: [{ id: 'EV-001', version: 'v3', hash: 'aa' }] },
          ],
          evidenceRefs: [{ id: 'EV-001', version: 'v3', hash: 'aa' }],
        }),
        refusal: null,
      },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 19, completion_tokens: 10, total_tokens: 29 },
  service_tier: 'default',
});

export const HTTP_ERROR_BODY = Object.freeze({
  error: {
    message: '示例错误:该模型当前不可用(脱敏 fixture,非真实报文)',
    type: 'server_error',
    code: 'model_overloaded',
  },
});

export const HTTP_EMPTY_CHOICES = Object.freeze({
  id: 'chatcmpl-fixture-empty-1',
  object: 'chat.completion',
  choices: [],
  usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
});

export const HTTP_NON_JSON_CONTENT = Object.freeze({
  id: 'chatcmpl-fixture-nonjson-1',
  object: 'chat.completion',
  choices: [
    { index: 0, message: { role: 'assistant', content: '抱歉,我无法按要求输出 JSON。' }, finish_reason: 'stop' },
  ],
  usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
});

// ---- Dify Workflow blocking 响应形状(官方示例结构,字段名与状态值一致) ----

export const DIFY_GOOD = Object.freeze({
  task_id: 'c3800678-fixture-task',
  workflow_run_id: 'fb47b2e6-fixture-run',
  data: {
    id: 'fb47b2e6-fixture-run',
    workflow_id: '7c3e33d4-fixture-workflow',
    status: 'succeeded',
    outputs: {
      analysis_payload: JSON.stringify({
        findings: [
          {
            id: 'F1',
            text: '示例发现:生产现场照片与申报产能存在差异,建议现场复核排班记录。',
            evidenceRefs: [{ id: 'EV-001', version: 'v3', hash: 'aa' }],
          },
        ],
        questions: [{ id: 'Q1', text: '请说明近三个月两班倒的实际出勤人数。', evidenceRefs: [] }],
        evidenceRefs: [{ id: 'EV-001', version: 'v3', hash: 'aa' }],
      }),
    },
    error: null,
    elapsed_time: 1.23,
    total_steps: 3,
    total_tokens: 150,
    created_at: 1757400000,
    finished_at: 1757400001,
  },
});

export const DIFY_FAILED = Object.freeze({
  task_id: 'task-fixture-2',
  workflow_run_id: 'run-fixture-2',
  data: {
    id: 'run-fixture-2',
    workflow_id: 'wf-fixture-2',
    status: 'failed',
    outputs: null,
    error: '示例错误:下游模型节点超时(脱敏 fixture)',
    elapsed_time: 0.8,
    total_steps: 2,
    total_tokens: 64,
    created_at: 1757400000,
    finished_at: 1757400001,
  },
});

export const DIFY_PARTIAL = Object.freeze({
  task_id: 'task-fixture-3',
  workflow_run_id: 'run-fixture-3',
  data: {
    id: 'run-fixture-3',
    workflow_id: 'wf-fixture-3',
    status: 'partial-succeeded',
    outputs: { analysis_payload: JSON.stringify({ findings: [], questions: [], evidenceRefs: [] }) },
    error: null,
    elapsed_time: 1.0,
    total_steps: 4,
    total_tokens: 88,
    created_at: 1757400000,
    finished_at: 1757400001,
  },
});

export const DIFY_ERROR_BODY = Object.freeze({
  code: 'invalid_param',
  message: 'Arg user must be provided.',
  status: 400,
});
