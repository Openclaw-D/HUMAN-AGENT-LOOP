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
} from '../../src/fixtures/provider-fixtures.mjs';
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
