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

// =====================================================================
// R2 Goal 工作包7 变体 fixture:全部由上方成功 fixture 派生(只改被测维度,
// 结构不漂移)。用途:验证"部分失败/未知 usage/不可信引用/dissent 透传"的
// 全路径状态(含账本)。仍然全部合成、零网络、无真实报文特征。
//
// 证据引用约定(与测试的输入清单配套):
//   VALID_REF    = EV-001/v3/aa —— 测试输入清单中存在的合法引用;
//   DANGLING_REF = EV-999/v9/ff —— 输入清单之外,专用于触发 EVIDENCE_DANGLING。
// =====================================================================

export const VALID_REF = Object.freeze({ id: 'EV-001', version: 'v3', hash: 'aa' });
export const DANGLING_REF = Object.freeze({ id: 'EV-999', version: 'v9', hash: 'ff' });

/** 深拷贝既有 fixture 后按需变异,再冻结:派生 fixture 的骨架永不漂移。 */
function cloneFixture(base, mutate) {
  const copy = JSON.parse(JSON.stringify(base));
  mutate(copy);
  return Object.freeze(copy);
}

/** 派生 HTTP 成功形状 fixture:整体替换 choices[0].message.content 的 JSON 内容。 */
function httpGoodWithContent(output, idSuffix) {
  return cloneFixture(HTTP_GOOD, (copy) => {
    copy.id = `chatcmpl-fixture-${idSuffix}`;
    copy.choices[0].message.content = JSON.stringify(output);
  });
}

/** 派生 Dify 成功形状 fixture:整体替换 outputs.analysis_payload 的 JSON 内容。 */
function difyGoodWithPayload(output, runSuffix) {
  return cloneFixture(DIFY_GOOD, (copy) => {
    copy.task_id = `task-fixture-${runSuffix}`;
    copy.data.id = `run-fixture-${runSuffix}`;
    copy.data.outputs.analysis_payload = JSON.stringify(output);
  });
}

// ---- 1) 不可信引用:全部引用输入清单之外证据 → validate 必须判 EVIDENCE_DANGLING ----

export const HTTP_DANGLING_REF = httpGoodWithContent({
  findings: [
    { id: 'F1', text: '示例发现:该发现引用了本次输入清单之外的证据,应被守门整体拒绝。', evidenceRefs: [DANGLING_REF] },
  ],
  // 问句可以无引用(问句不是事实断言),用于证明失败只来自悬空引用本身
  questions: [
    { id: 'Q1', text: '请补充主要欠款方的对账单。', evidenceRefs: [] },
  ],
  evidenceRefs: [],
}, 'dangling-http-1');

export const DIFY_DANGLING_REF = difyGoodWithPayload({
  findings: [
    { id: 'F1', text: '示例发现:生产现场照片与申报产能存在差异,建议现场复核排班记录(引用了清单之外证据)。', evidenceRefs: [DANGLING_REF] },
  ],
  questions: [
    { id: 'Q1', text: '请说明近三个月两班倒的实际出勤人数。', evidenceRefs: [] },
  ],
  evidenceRefs: [],
}, 'dangling-dify-1');

// ---- 3) 部分失败:一条 finding 合法、一条悬空 → 整体 failed,合法条目绝不部分放行 ----

export const HTTP_PARTIAL_DANGLING = httpGoodWithContent({
  findings: [
    { id: 'F1', text: '示例发现:应收账款回款周期同比明显拉长,需核对主要欠款方结算条款。', evidenceRefs: [VALID_REF] },
    { id: 'F2', text: '示例发现:该发现引用了清单之外证据,应导致整体拒绝。', evidenceRefs: [DANGLING_REF] },
  ],
  questions: [
    { id: 'Q1', text: '请提供最近两期主要欠款方的对账单。', evidenceRefs: [] },
  ],
  evidenceRefs: [VALID_REF],
}, 'partial-dangling-1');

// ---- 2) 未知 usage:成功结构但响应缺失 usage/total_tokens → 账本 unknown_hold ----

export const HTTP_NO_USAGE = cloneFixture(HTTP_GOOD, (copy) => {
  copy.id = 'chatcmpl-fixture-no-usage-1';
  delete copy.usage; // 结构成功但 provider 未报告 usage:不记 0、不释放
});

export const DIFY_NO_TOTAL_TOKENS = cloneFixture(DIFY_GOOD, (copy) => {
  copy.task_id = 'task-fixture-no-tokens';
  copy.data.id = 'run-fixture-no-tokens';
  delete copy.data.total_tokens; // Dify blocking 响应缺 total_tokens 字段
});

// ---- 4) 错误体 usage 传播:错误响应携带 usage(调用已发生、可能已计费) ----

export const HTTP_ERROR_WITH_USAGE = Object.freeze({
  error: {
    message: '示例错误:请求超过模型上下文长度上限(脱敏 fixture,非真实报文)',
    type: 'invalid_request_error',
    code: 'context_length_exceeded',
  },
  usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
});
// Dify 侧复用 DIFY_FAILED(data.status='failed' 且 total_tokens=64):usage 随失败带出。

// ---- 5) dissent 透传(R2 新增):合法异议照常通过;position 非法整体拒绝 ----

export const HTTP_GOOD_WITH_DISSENT = httpGoodWithContent({
  findings: [
    { id: 'F1', text: '示例发现:应收账款回款周期同比明显拉长,需核对主要欠款方结算条款。', evidenceRefs: [VALID_REF] },
  ],
  questions: [
    { id: 'Q1', text: '请提供最近两期主要欠款方的对账单。', evidenceRefs: [] },
  ],
  evidenceRefs: [VALID_REF],
  dissent: [
    {
      position: 'dissenting',
      text: '示例异议:基于同一份流水节选,本人判断回款周期拉长更可能源自下游客户账期整体调整,建议补充访谈后再定风险等级。',
      evidenceRefs: [VALID_REF],
      conflictsWith: ['F1'],
    },
  ],
}, 'dissent-good-1');

export const HTTP_DISSENT_BAD_POSITION = httpGoodWithContent({
  findings: [
    { id: 'F1', text: '示例发现:应收账款回款周期同比明显拉长,需核对主要欠款方结算条款。', evidenceRefs: [VALID_REF] },
  ],
  questions: [
    { id: 'Q1', text: '请提供最近两期主要欠款方的对账单。', evidenceRefs: [] },
  ],
  evidenceRefs: [VALID_REF],
  dissent: [
    {
      position: 'veto', // 非法 position:协议只允许 'original' | 'dissenting'
      text: '示例异议:position 值超出协议允许集合,应触发 MALFORMED_OUTPUT。',
      evidenceRefs: [VALID_REF],
    },
  ],
}, 'dissent-bad-position-1');

/**
 * 成功形状 fixture 登记表(元断言用,防 fixture 漂移):
 * 所有"provider 应答为成功形状"的 fixture 都必须登记于此;测试逐项断言
 * content/outputs 是合法 JSON 且 findings/questions 结构字段齐全。
 * DIFY_PARTIAL 的 outputs 由测试单独直查(其运行状态是失败,但输出变量仍须结构合法)。
 */
export function successShapedFixtures() {
  return [
    { name: 'HTTP_GOOD', provider: 'http-chat-completions', raw: HTTP_GOOD },
    { name: 'HTTP_DANGLING_REF', provider: 'http-chat-completions', raw: HTTP_DANGLING_REF },
    { name: 'HTTP_PARTIAL_DANGLING', provider: 'http-chat-completions', raw: HTTP_PARTIAL_DANGLING },
    { name: 'HTTP_NO_USAGE', provider: 'http-chat-completions', raw: HTTP_NO_USAGE },
    { name: 'HTTP_GOOD_WITH_DISSENT', provider: 'http-chat-completions', raw: HTTP_GOOD_WITH_DISSENT },
    { name: 'HTTP_DISSENT_BAD_POSITION', provider: 'http-chat-completions', raw: HTTP_DISSENT_BAD_POSITION },
    { name: 'DIFY_GOOD', provider: 'dify-workflow', raw: DIFY_GOOD },
    { name: 'DIFY_DANGLING_REF', provider: 'dify-workflow', raw: DIFY_DANGLING_REF },
    { name: 'DIFY_NO_TOTAL_TOKENS', provider: 'dify-workflow', raw: DIFY_NO_TOTAL_TOKENS },
  ];
}
