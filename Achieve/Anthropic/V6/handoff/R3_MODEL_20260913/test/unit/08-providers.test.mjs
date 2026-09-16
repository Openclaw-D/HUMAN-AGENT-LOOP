// provider 映射:通用 HTTP(OpenAI Chat Completions 形状)与 Dify Workflow 的
// build/parse 纯函数 + 脱敏 fixture + createProviderTransport(fake fetch)端到端。
// 声明:外部格式按官方文档实现(来源见各映射文件头);未对真实服务端点做过
// 兼容测试 —— 本文件只证明映射逻辑与 fixture 一致,不证明真实兼容。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChatCompletionsRequest, parseChatCompletionsResponse } from '../../src/providers/http-json.mjs';
import { buildDifyWorkflowRequest, parseDifyWorkflowResponse } from '../../src/providers/dify-workflow.mjs';
import { createProviderTransport } from '../../src/adapter.mjs';
import { createModelAdapter } from '../../src/adapter.mjs';
import { createMemoryLedger } from '../../src/ledger.mjs';
import {
  HTTP_GOOD, HTTP_ERROR_BODY, HTTP_EMPTY_CHOICES, HTTP_NON_JSON_CONTENT,
  DIFY_GOOD, DIFY_FAILED, DIFY_PARTIAL, DIFY_ERROR_BODY,
  // R2 Goal 工作包7 变体:部分失败 / 未知 usage / 不可信引用 / dissent / 错误体 usage
  HTTP_DANGLING_REF, DIFY_DANGLING_REF, HTTP_PARTIAL_DANGLING,
  HTTP_NO_USAGE, DIFY_NO_TOTAL_TOKENS, HTTP_ERROR_WITH_USAGE,
  HTTP_GOOD_WITH_DISSENT, HTTP_DISSENT_BAD_POSITION,
  VALID_REF, DANGLING_REF, successShapedFixtures,
} from '../../src/fixtures/provider-fixtures.mjs';
import { validateProviderOutput } from '../../src/validate-response.mjs';
import { makeEvidence, makeRequest } from '../helpers.mjs';

const ev = makeEvidence(2);
const request = makeRequest({}, { evidence: ev });

// ---- HTTP 映射 ----

test('HTTP build:POST /chat/completions,body 含 model/messages/response_format,凭据不落入载荷', () => {
  const payload = {
    protocol: 'jianwei.dd.analyze/v1', requestId: 'req-1', sessionId: 'sess-1',
    role: 'credit', roleLabel: '信审', purpose: 'risk_review', text: '【合成】文本',
    evidenceRefs: ev, generation: 1, contextVersion: 'ctx-1',
    instructions: { authority: 'none' },
  };
  const req = buildChatCompletionsRequest(payload, { baseUrl: 'https://example.invalid/v1', model: 'example-model-for-tests', getApiKey: () => 'DUMMY-KEY-FOR-STRUCTURE-TEST-ONLY' });
  assert.equal(req.method, 'POST');
  assert.equal(req.url, 'https://example.invalid/v1/chat/completions');
  assert.equal(req.body.model, 'example-model-for-tests');
  assert.equal(req.body.messages[0].role, 'system');
  assert.ok(req.body.messages[0].content.includes('没有审批权限'), '系统提示必须声明角色边界');
  assert.deepEqual(JSON.parse(req.body.messages[1].content), payload, '协议载荷必须原样进入 user 消息');
  assert.deepEqual(req.body.response_format, { type: 'json_object' });
  assert.ok(req.headers.Authorization.startsWith('Bearer '));
  // 载荷本体不得包含凭据
  assert.ok(!JSON.stringify(req.body).includes('DUMMY-KEY'), '凭据只能出现在 Authorization 头,不得进入消息体');
});

test('HTTP parse:合法 fixture → output 结构 + usage 数字映射(prompt_tokens→promptTokens)', () => {
  const parsed = parseChatCompletionsResponse(JSON.parse(JSON.stringify(HTTP_GOOD)));
  assert.ok(parsed.output);
  assert.equal(parsed.output.findings.length, 1);
  assert.deepEqual(parsed.usage, { promptTokens: 19, completionTokens: 10, totalTokens: 29 });
});

test('HTTP parse:错误体({error:{...}})→ error(适配器将判 failed),usage 仍带出', () => {
  const parsed = parseChatCompletionsResponse(JSON.parse(JSON.stringify(HTTP_ERROR_BODY)));
  assert.ok(parsed.error);
  assert.match(parsed.error.message, /外部模型服务返回错误/);
  assert.equal(parsed.output, undefined);
});

test('HTTP parse:空 choices → PROVIDER_EMPTY_CONTENT(不得当成功)', () => {
  const parsed = parseChatCompletionsResponse(JSON.parse(JSON.stringify(HTTP_EMPTY_CHOICES)));
  assert.equal(parsed.error.code, 'PROVIDER_EMPTY_CONTENT');
});

test('HTTP parse:content 非 JSON → PROVIDER_CONTENT_NOT_JSON', () => {
  const parsed = parseChatCompletionsResponse(JSON.parse(JSON.stringify(HTTP_NON_JSON_CONTENT)));
  assert.equal(parsed.error.code, 'PROVIDER_CONTENT_NOT_JSON');
});

// ---- Dify 映射 ----

test('Dify build:POST /workflows/run,inputs + response_mode=blocking + user', () => {
  const payload = {
    protocol: 'jianwei.dd.analyze/v1', requestId: 'req-1', sessionId: 'sess-demo-1',
    role: 'asset', roleLabel: '资产', purpose: 'asset_review', text: '【合成】文本',
    evidenceRefs: ev, generation: 1, contextVersion: 'ctx-1',
    instructions: { authority: 'none' },
  };
  const req = buildDifyWorkflowRequest(payload, { baseUrl: 'http://127.0.0.1:9999/v1', getApiKey: () => 'DUMMY-DIFY-KEY' });
  assert.equal(req.method, 'POST');
  assert.ok(req.url.endsWith('/workflows/run'));
  assert.equal(req.body.response_mode, 'blocking');
  assert.equal(req.body.user, 'jianwei-adapter:sess-demo-1');
  const inner = JSON.parse(req.body.inputs.analysis_payload);
  assert.equal(inner.requestId, 'req-1');
  assert.equal(req.body.inputs.role_boundary && JSON.parse(req.body.inputs.role_boundary).authority, 'none');
});

test('Dify parse:succeeded fixture → output + total_tokens→totalTokens', () => {
  const parsed = parseDifyWorkflowResponse(JSON.parse(JSON.stringify(DIFY_GOOD)));
  assert.ok(parsed.output);
  assert.equal(parsed.output.findings.length, 1);
  assert.deepEqual(parsed.usage, { promptTokens: null, completionTokens: null, totalTokens: 150 });
});

test('Dify parse:failed → error(DIFY_STATUS_FAILED)且 usage 带出(调用已发生)', () => {
  const parsed = parseDifyWorkflowResponse(JSON.parse(JSON.stringify(DIFY_FAILED)));
  assert.equal(parsed.error.code, 'DIFY_STATUS_FAILED');
  assert.equal(parsed.usage.totalTokens, 64);
});

test('Dify parse:partial-succeeded → 明确失败,不得当成功', () => {
  const parsed = parseDifyWorkflowResponse(JSON.parse(JSON.stringify(DIFY_PARTIAL)));
  assert.equal(parsed.error.code, 'DIFY_STATUS_PARTIAL_SUCCEEDED');
  assert.match(parsed.error.message, /部分失败不允许当成功/);
});

test('Dify parse:错误体 {code,message,status} → error', () => {
  const parsed = parseDifyWorkflowResponse(JSON.parse(JSON.stringify(DIFY_ERROR_BODY)));
  assert.equal(parsed.error.code, 'invalid_param');
});

test('Dify parse:data.status=running 出现在 blocking 应答 → indeterminate', () => {
  const parsed = parseDifyWorkflowResponse({ data: { status: 'running', total_tokens: 0 } });
  assert.equal(parsed.indeterminate, true);
});

// ---- createProviderTransport 端到端(fake fetch,零网络) ----

function fakeFetch(responseBody, { capture = [] } = {}) {
  return async (url, init) => {
    capture.push({ url, init });
    return { json: async () => responseBody };
  };
}

test('HTTP provider 端到端:transport 组装请求、fixture 响应解析为标准结果(零真实网络)', async () => {
  // fixture 输出引用的证据三元组必须在本次输入清单中(协议:引用必须真实存在于输入)
  const evFixture = [{ id: 'EV-001', version: 'v3', hash: 'aa' }];
  const requestForFixture = makeRequest({}, { evidence: evFixture });
  const capture = [];
  const transport = createProviderTransport({
    buildRequest: (payload) => buildChatCompletionsRequest(payload, { baseUrl: 'https://example.invalid/v1', model: 'example-model-for-tests', getApiKey: () => 'DUMMY-KEY' }),
    parseResponse: parseChatCompletionsResponse,
    modeName: 'http-chat-completions',
    fetchImpl: fakeFetch(JSON.parse(JSON.stringify(HTTP_GOOD)), { capture }),
  });
  const adapter = createModelAdapter({ transport, ledger: createMemoryLedger({}), timeoutMs: 5000 });
  const r = await adapter.analyze(requestForFixture, {});
  assert.equal(r.status, 'succeeded');
  assert.equal(r.findings.length, 1);
  assert.deepEqual(r.usage, { promptTokens: 19, completionTokens: 10, totalTokens: 29, providerReported: true });
  assert.equal(capture.length, 1);
  assert.equal(capture[0].url, 'https://example.invalid/v1/chat/completions');
  assert.equal(capture[0].init.method, 'POST');
});

test('Dify provider 端到端:partial-succeeded fixture → 整体 failed(部分失败不当成功)', async () => {
  const transport = createProviderTransport({
    buildRequest: (payload) => buildDifyWorkflowRequest(payload, { baseUrl: 'http://127.0.0.1:9999/v1', getApiKey: () => 'DUMMY-DIFY-KEY' }),
    parseResponse: parseDifyWorkflowResponse,
    modeName: 'dify-workflow',
    fetchImpl: fakeFetch(JSON.parse(JSON.stringify(DIFY_PARTIAL))),
  });
  const adapter = createModelAdapter({ transport, ledger: createMemoryLedger({}), timeoutMs: 5000 });
  const r = await adapter.analyze(request, {});
  assert.equal(r.status, 'failed');
  // 顶层错误码统一为 TRANSPORT_ERROR;provider 的具体状态在 details.code 与中文 message 中
  assert.equal(r.error.code, 'TRANSPORT_ERROR');
  assert.equal(r.error.details.code, 'DIFY_STATUS_PARTIAL_SUCCEEDED');
  assert.match(r.error.message, /部分失败/);
  assert.equal(r.usage.totalTokens, 88, 'partial 也是真实调用,usage 照常结算');
});

test('缺 fetchImpl:transport 抛 notSent → cancelled(部署配置缺失,不是模型失败,不计成本)', async () => {
  const transport = createProviderTransport({
    buildRequest: (payload) => buildChatCompletionsRequest(payload, { baseUrl: 'https://example.invalid/v1', model: 'm' }),
    parseResponse: parseChatCompletionsResponse,
    modeName: 'http-chat-completions',
    // fetchImpl 故意缺失
  });
  const adapter = createModelAdapter({ transport, ledger: createMemoryLedger({}), timeoutMs: 5000 });
  const r = await adapter.analyze(request, {});
  assert.equal(r.status, 'cancelled');
  assert.equal(r.error.code, 'CANCELLED_BEFORE_SEND');
  assert.equal(r.costLedger.reservationState, 'released');
});

// =====================================================================
// R2 Goal 工作包7 补强:全路径状态明确(fixture + 纯函数,零网络)。
// 全路径 = provider parse 纯函数 → validateProviderOutput → createModelAdapter.analyze
// → 内存账本结算;每层状态都显式断言,不留"部分通过"的灰色地带。
// mock/fixture 只证明协议映射与守门逻辑,不证明真实服务兼容(NOT TESTED)。
// =====================================================================

// 与 fixture 引用配套的输入清单:只包含 EV-001/v3/aa;EV-999/v9/ff 在清单之外
const FIXTURE_REFS = [{ ...VALID_REF }];
const requestForFixture = makeRequest({}, { evidence: FIXTURE_REFS });

function httpTransportFor(rawBody) {
  return createProviderTransport({
    buildRequest: (payload) => buildChatCompletionsRequest(payload, { baseUrl: 'https://example.invalid/v1', model: 'example-model-for-tests', getApiKey: () => 'DUMMY-KEY' }),
    parseResponse: parseChatCompletionsResponse,
    modeName: 'http-chat-completions',
    fetchImpl: fakeFetch(JSON.parse(JSON.stringify(rawBody))),
  });
}

function difyTransportFor(rawBody) {
  return createProviderTransport({
    buildRequest: (payload) => buildDifyWorkflowRequest(payload, { baseUrl: 'http://127.0.0.1:9999/v1', getApiKey: () => 'DUMMY-DIFY-KEY' }),
    parseResponse: parseDifyWorkflowResponse,
    modeName: 'dify-workflow',
    fetchImpl: fakeFetch(JSON.parse(JSON.stringify(rawBody))),
  });
}

// ---- 1) 不可信引用全路径 ----

test('全路径·HTTP 悬空引用:parse 成功 → validate EVIDENCE_DANGLING → adapter failed/EVIDENCE_DANGLING', async () => {
  // 第 1 层:协议解析只解析形状,不核查引用 → output 正常产出(失败不发生在这一层)
  const parsed = parseChatCompletionsResponse(JSON.parse(JSON.stringify(HTTP_DANGLING_REF)));
  assert.ok(parsed.output, 'parse 层应成功产出 output(引用核查不属于协议解析)');
  assert.deepEqual(parsed.usage, { promptTokens: 19, completionTokens: 10, totalTokens: 29 });
  // 第 2 层:输出守门判定引用悬空
  const v = validateProviderOutput({ output: parsed.output, request: requestForFixture });
  assert.equal(v.ok, false);
  assert.equal(v.violations.length, 1);
  assert.equal(v.violations[0].code, 'EVIDENCE_DANGLING');
  assert.equal(v.violations[0].path, 'findings[0].evidenceRefs[0]');
  assert.deepEqual(v.violations[0].detail, { ...DANGLING_REF });
  // 第 3 层:适配器全链路 → 整体 failed,且账本按已知 usage 结算(调用真实发生)
  const adapter = createModelAdapter({ transport: httpTransportFor(HTTP_DANGLING_REF), ledger: createMemoryLedger({}), timeoutMs: 5000 });
  const r = await adapter.analyze(requestForFixture, {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'EVIDENCE_DANGLING');
  assert.equal(r.findings.length, 0, '不可信引用输出绝不部分放行');
  assert.deepEqual(r.dissent, []);
  assert.equal(r.usageUnknown, false);
  assert.equal(r.costLedger.reservationState, 'committed', 'usage 已知:该次调用照常结算,不是 unknown');
  assert.equal(adapter.ledger.totals().committedTokens, 29);
});

test('全路径·Dify 悬空引用:parse 成功 → validate EVIDENCE_DANGLING → adapter failed/EVIDENCE_DANGLING', async () => {
  const parsed = parseDifyWorkflowResponse(JSON.parse(JSON.stringify(DIFY_DANGLING_REF)));
  assert.ok(parsed.output, 'Dify parse 层应成功产出 output');
  assert.equal(parsed.usage.totalTokens, 150);
  const v = validateProviderOutput({ output: parsed.output, request: requestForFixture });
  assert.equal(v.ok, false);
  assert.equal(v.violations[0].code, 'EVIDENCE_DANGLING');
  const adapter = createModelAdapter({ transport: difyTransportFor(DIFY_DANGLING_REF), ledger: createMemoryLedger({}), timeoutMs: 5000 });
  const r = await adapter.analyze(requestForFixture, {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'EVIDENCE_DANGLING');
  assert.equal(r.findings.length, 0);
  assert.equal(r.costLedger.reservationState, 'committed');
  assert.equal(adapter.ledger.totals().committedTokens, 150);
});

// ---- 2) 未知 usage 全路径 ----

test('全路径·HTTP 无 usage:输出合法但 provider 未报 usage → succeeded 且 usageUnknown、unknown_hold(不记0不释放)', async () => {
  const parsed = parseChatCompletionsResponse(JSON.parse(JSON.stringify(HTTP_NO_USAGE)));
  assert.ok(parsed.output);
  assert.equal(parsed.usage, null, 'HTTP parse 层:usage 缺失规范为 null,不伪造 0');
  const adapter = createModelAdapter({ transport: httpTransportFor(HTTP_NO_USAGE), ledger: createMemoryLedger({}), timeoutMs: 5000 });
  const r = await adapter.analyze(requestForFixture, {});
  assert.equal(r.status, 'succeeded', '输出本身合法:结果状态 succeeded;成本侧单独标未知');
  assert.equal(r.usageUnknown, true);
  assert.equal(r.usage, null, 'usage 缺失不得折算为 0');
  assert.equal(r.costLedger.reservationState, 'unknown_hold');
  const totals = adapter.ledger.totals();
  assert.ok(totals.unknownHoldTokens > 0, 'unknown_hold 必须保留预留占用(estimateTokens 默认 1000)');
  assert.equal(totals.committedTokens, 0, '不得按 0 记账');
  assert.equal(totals.releasedTokens, 0, '不得释放');
  const entry = adapter.ledger.entries()[0];
  assert.equal(entry.state, 'unknown_hold');
  assert.equal(entry.usageTokens, null);
});

test('全路径·Dify 缺 total_tokens:输出合法但 usage 数字缺失 → usageUnknown、unknown_hold(不记0不释放)', async () => {
  const parsed = parseDifyWorkflowResponse(JSON.parse(JSON.stringify(DIFY_NO_TOTAL_TOKENS)));
  assert.ok(parsed.output);
  assert.deepEqual(parsed.usage, { promptTokens: null, completionTokens: null, totalTokens: null }, 'total_tokens 缺失 → 三元组全 null,不伪造 0');
  const adapter = createModelAdapter({ transport: difyTransportFor(DIFY_NO_TOTAL_TOKENS), ledger: createMemoryLedger({}), timeoutMs: 5000 });
  const r = await adapter.analyze(requestForFixture, {});
  assert.equal(r.status, 'succeeded');
  assert.equal(r.usageUnknown, true);
  assert.deepEqual(r.usage, { promptTokens: null, completionTokens: null, totalTokens: null, providerReported: true });
  assert.equal(r.costLedger.reservationState, 'unknown_hold');
  const totals = adapter.ledger.totals();
  assert.ok(totals.unknownHoldTokens > 0);
  assert.equal(totals.committedTokens, 0);
  assert.equal(totals.releasedTokens, 0);
});

// ---- 3) 部分失败全路径 ----

test('全路径·HTTP 部分失败:一条 finding 合法一条悬空 → 整体 failed 且 result.findings===[]', async () => {
  const parsed = parseChatCompletionsResponse(JSON.parse(JSON.stringify(HTTP_PARTIAL_DANGLING)));
  assert.ok(parsed.output);
  const v = validateProviderOutput({ output: parsed.output, request: requestForFixture });
  assert.equal(v.ok, false);
  assert.equal(v.violations.length, 1, '合法条目不得产生 violation,悬空条目恰好一条');
  assert.equal(v.violations[0].code, 'EVIDENCE_DANGLING');
  assert.equal(v.violations[0].path, 'findings[1].evidenceRefs[0]');
  const adapter = createModelAdapter({ transport: httpTransportFor(HTTP_PARTIAL_DANGLING), ledger: createMemoryLedger({}), timeoutMs: 5000 });
  const r = await adapter.analyze(requestForFixture, {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'EVIDENCE_DANGLING');
  assert.equal(r.findings.length, 0, '部分失败绝不部分放行:合法 finding 也不得绕过整体失败');
  assert.deepEqual(r.questions, []);
  assert.deepEqual(r.evidenceRefs, []);
  assert.deepEqual(r.error.details.violations, v.violations, '违规明细随 error.details 带出,供人工核对');
  assert.equal(r.costLedger.reservationState, 'committed');
});
// Dify 部分失败(partial-succeeded → failed/DIFY_STATUS_PARTIAL_SUCCEEDED, details.code)
// 已由上方既有端到端测试覆盖,此处不重复。

// ---- 4) 错误体 usage 传播 ----

test('全路径·HTTP 错误体带 usage:transport 层 parse 保留 usage → failed/TRANSPORT_ERROR 且按 usage committed', async () => {
  const parsed = parseChatCompletionsResponse(JSON.parse(JSON.stringify(HTTP_ERROR_WITH_USAGE)));
  assert.ok(parsed.error, 'transport 解析层保留错误体');
  assert.equal(parsed.output, undefined);
  assert.deepEqual(parsed.usage, { promptTokens: 7, completionTokens: 3, totalTokens: 10 }, '错误体 usage 必须在 parse 层带出(调用可能已计费)');
  const adapter = createModelAdapter({ transport: httpTransportFor(HTTP_ERROR_WITH_USAGE), ledger: createMemoryLedger({}), timeoutMs: 5000 });
  const r = await adapter.analyze(requestForFixture, {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'TRANSPORT_ERROR');
  assert.equal(r.error.details.code, 'context_length_exceeded');
  assert.deepEqual(r.usage, { promptTokens: 7, completionTokens: 3, totalTokens: 10, providerReported: true });
  assert.equal(r.usageUnknown, false);
  assert.equal(r.costLedger.reservationState, 'committed', '错误响应的 usage 已知:按其结算,不进 unknown_hold');
  assert.equal(adapter.ledger.totals().committedTokens, 10);
});

test('全路径·Dify failed 带 total_tokens:usage 随失败带出 → failed/TRANSPORT_ERROR/DIFY_STATUS_FAILED 且 committed', async () => {
  const parsed = parseDifyWorkflowResponse(JSON.parse(JSON.stringify(DIFY_FAILED)));
  assert.equal(parsed.error.code, 'DIFY_STATUS_FAILED');
  assert.equal(parsed.usage.totalTokens, 64);
  const adapter = createModelAdapter({ transport: difyTransportFor(DIFY_FAILED), ledger: createMemoryLedger({}), timeoutMs: 5000 });
  const r = await adapter.analyze(requestForFixture, {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'TRANSPORT_ERROR');
  assert.equal(r.error.details.code, 'DIFY_STATUS_FAILED');
  assert.deepEqual(r.usage, { promptTokens: null, completionTokens: null, totalTokens: 64, providerReported: true });
  assert.equal(r.usageUnknown, false);
  assert.equal(r.costLedger.reservationState, 'committed');
  assert.equal(adapter.ledger.totals().committedTokens, 64);
});

// ---- 5) dissent 透传(R2 新增) ----

test('全路径·HTTP 合法 dissent:succeeded 且 dissent 透传(position/evidenceRefs/conflictsWith 经校验归一)', async () => {
  const adapter = createModelAdapter({ transport: httpTransportFor(HTTP_GOOD_WITH_DISSENT), ledger: createMemoryLedger({}), timeoutMs: 5000 });
  const r = await adapter.analyze(requestForFixture, {});
  assert.equal(r.status, 'succeeded', '合法 dissent 是协作输入,绝不影响 succeeded 判定');
  assert.equal(r.dissent.length, 1);
  assert.equal(r.dissent[0].position, 'dissenting');
  assert.ok(r.dissent[0].text.includes('异议'), '中文异议文本透传');
  assert.deepEqual(r.dissent[0].evidenceRefs, [{ id: 'EV-001', version: 'v3', hash: 'aa' }], 'dissent 引用经守门核查后透传');
  assert.deepEqual(r.dissent[0].conflictsWith, ['F1']);
  assert.equal(r.findings.length, 1, 'findings 照常透传');
  assert.equal(r.costLedger.reservationState, 'committed');
});

test('全路径·HTTP dissent.position 非法 → failed/MALFORMED_OUTPUT(验证失败不伪装成功)', async () => {
  const parsed = parseChatCompletionsResponse(JSON.parse(JSON.stringify(HTTP_DISSENT_BAD_POSITION)));
  assert.ok(parsed.output, 'parse 层成功:position 合法性属于输出守门职责');
  const v = validateProviderOutput({ output: parsed.output, request: requestForFixture });
  assert.equal(v.ok, false);
  assert.equal(v.violations[0].code, 'MALFORMED_OUTPUT');
  assert.equal(v.violations[0].path, 'dissent[0].position');
  const adapter = createModelAdapter({ transport: httpTransportFor(HTTP_DISSENT_BAD_POSITION), ledger: createMemoryLedger({}), timeoutMs: 5000 });
  const r = await adapter.analyze(requestForFixture, {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'MALFORMED_OUTPUT');
  assert.equal(r.dissent.length, 0, '违规 dissent 绝不透传');
  assert.equal(r.findings.length, 0, '存在 dissent 违规时整体拒绝,合法 findings 也不放行');
  assert.equal(r.costLedger.reservationState, 'committed');
});

// ---- 6) 元断言:成功形状 fixture 结构复验(防 fixture 漂移) ----

/** 协议输出结构断言:findings/questions 字段齐全;引用与 dissent 只查形状(position 合法性属守门职责)。 */
function assertProtocolOutputShape(output, label) {
  assert.ok(output !== null && typeof output === 'object' && !Array.isArray(output), `${label}:输出必须是 JSON 对象`);
  for (const key of ['findings', 'questions']) {
    assert.ok(Array.isArray(output[key]), `${label}.${key} 必须是数组`);
    output[key].forEach((item, i) => {
      assert.equal(typeof item.id, 'string', `${label}.${key}[${i}].id 必须是字符串`);
      assert.equal(typeof item.text, 'string', `${label}.${key}[${i}].text 必须是字符串`);
      assert.ok(item.text.trim() !== '', `${label}.${key}[${i}].text 不得为空`);
      assert.ok(Array.isArray(item.evidenceRefs), `${label}.${key}[${i}].evidenceRefs 必须是数组`);
      item.evidenceRefs.forEach((ref, j) => {
        for (const f of ['id', 'version', 'hash']) {
          assert.equal(typeof ref[f], 'string', `${label}.${key}[${i}].evidenceRefs[${j}].${f} 必须是字符串`);
        }
      });
    });
  }
  if (output.evidenceRefs !== undefined) {
    assert.ok(Array.isArray(output.evidenceRefs), `${label}.evidenceRefs 必须是数组`);
  }
  if (output.dissent !== undefined && output.dissent !== null) {
    assert.ok(Array.isArray(output.dissent), `${label}.dissent 必须是数组`);
    output.dissent.forEach((d, i) => {
      assert.equal(typeof d.position, 'string', `${label}.dissent[${i}].position 必须是字符串`);
      assert.equal(typeof d.text, 'string', `${label}.dissent[${i}].text 必须是字符串`);
      assert.ok(d.text.trim() !== '', `${label}.dissent[${i}].text 不得为空`);
      assert.ok(Array.isArray(d.evidenceRefs), `${label}.dissent[${i}].evidenceRefs 必须是数组`);
    });
  }
}

test('元断言·成功形状 fixture 结构复验:content/outputs 均为合法 JSON 且 findings/questions 字段齐全(防漂移)', () => {
  // 结构依据(2026-09-13 复核):HTTP 侧 OpenAI OpenAPI spec v2.3.0 CreateChatCompletionResponse
  // (content 为 JSON 字符串是 response_format=json_object 约定);Dify 侧 docs.dify.ai
  // Workflow App API /workflows/run blocking 响应(outputs.analysis_payload)。
  for (const { name, provider, raw } of successShapedFixtures()) {
    const clone = JSON.parse(JSON.stringify(raw)); // 可无损 JSON 往返本身即"合法报文形状"
    const parsed = provider === 'http-chat-completions'
      ? parseChatCompletionsResponse(clone)
      : parseDifyWorkflowResponse(clone);
    assert.equal(parsed.error, undefined, `${name}:成功形状 fixture 必须能被对应 parse 层无错解析`);
    assert.ok(parsed.output, `${name}:必须产出 output`);
    assertProtocolOutputShape(parsed.output, name);
    // usage 数字防漂移:字段出现时必须是非负整数(缺失允许,由未知 usage 路径覆盖)
    if (raw.usage) {
      for (const f of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
        assert.ok(Number.isInteger(raw.usage[f]) && raw.usage[f] >= 0, `${name}.usage.${f} 必须是非负整数`);
      }
    }
    if (raw.data && raw.data.total_tokens !== undefined) {
      assert.ok(Number.isInteger(raw.data.total_tokens) && raw.data.total_tokens >= 0, `${name}.data.total_tokens 必须是非负整数`);
    }
  }
  // Dify 补充:DIFY_PARTIAL 运行状态是失败,但其输出变量同样必须是合法 JSON 且结构齐全
  assertProtocolOutputShape(JSON.parse(DIFY_PARTIAL.data.outputs.analysis_payload), 'DIFY_PARTIAL.outputs');
});
