// V0.4 03-receipts · B transport 三分发送语义/载荷身份/凭据卫生 专项回归。
// 被测：Back/B/src/transport/glm.mjs（createModelTransport/buildModelRequest）。
// 出站次数一律以本地替身命中数断言（Back/B/test/v04-transport-stub.mjs），不以 HTTP 返回码代替。
// 替身形态验证协议语义，不构成真实模型质量测试；全程零真实外呼、零凭据。
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createModelTransport, buildModelRequest } from '../src/transport/glm.mjs';
import { startTransportStub } from './v04-transport-stub.mjs';

const baseRequest = (over = {}) => {
  const { request } = buildModelRequest({
    runId: 'run-v04', stepId: 'step-1', attempt: 1, role: 'credit', purpose: 'auxiliary_review',
    projectId: 'proj-v04', goalId: null, goalLabel: 'V04专项', factVersion: '0', evidenceRefs: [],
    ...over,
  });
  return request;
};

test('V04-TR-01 合法请求出站一次：替身命中1，请求身份/锚点齐备', async () => {
  const stub = await startTransportStub();
  try {
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: stub.url, timeoutMs: 2000, model: 'v04-offline' } });
    const request = baseRequest();
    const r = await t.complete(request);
    assert.equal(r.status, 'simulated');
    assert.equal(r.sentFlag, true);
    assert.equal(stub.hits(), 1);
    const captured = stub.requests[0];
    assert.equal(captured.headers['x-b-request-id'], request.requestId);
    const body = JSON.parse(captured.body);
    assert.equal(body.model, 'v04-offline', 'mock 请求体 model 取自 mock.model 配置');
    assert.equal(body.b_meta.requestId, request.requestId);
    assert.equal(captured.headers['x-jw-project'], 'proj-v04');
    assert.equal(captured.headers.authorization, undefined, 'mock 模式不带凭据头');
    assert.deepEqual(r.usage, { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });
  } finally { await stub.close(); }
});

test('V04-TR-02 transport 本身不去重：同请求两次调用两次出站（幂等属 Edge 回执层职责）', async () => {
  const stub = await startTransportStub();
  try {
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: stub.url, timeoutMs: 2000 } });
    const request = baseRequest();
    await t.complete(request);
    await t.complete(request);
    assert.equal(stub.hits(), 2);
    assert.equal(stub.requests[0].body, stub.requests[1].body, '同输入载荷逐字节确定，供回执层对账');
  } finally { await stub.close(); }
});

test('V04-TR-03 超时→发送后未知（RESULT_UNKNOWN_TIMEOUT），替身实证请求已到达，禁止自动重发', async () => {
  const stub = await startTransportStub();
  try {
    stub.control.delayMs = 800;
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: stub.url, timeoutMs: 200 } });
    const r = await t.complete(baseRequest());
    assert.equal(r.status, 'unknown');
    assert.equal(r.sentFlag, null);
    assert.equal(r.error.code, 'RESULT_UNKNOWN_TIMEOUT');
    assert.equal(stub.hits(), 1, '超时是发送后未知：替身必须已收到请求');
  } finally { await stub.close(); }
});

test('V04-TR-04 响应头前断连→发送后未知（RESULT_UNKNOWN_INTERRUPTED），替身命中1', async () => {
  const stub = await startTransportStub();
  try {
    stub.control.mode = 'destroy';
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: stub.url, timeoutMs: 2000 } });
    const r = await t.complete(baseRequest());
    assert.equal(r.status, 'unknown');
    assert.equal(r.sentFlag, null);
    assert.equal(r.error.code, 'RESULT_UNKNOWN_INTERRUPTED');
    assert.equal(stub.hits(), 1);
  } finally { await stub.close(); }
});

test('V04-TR-05 响应体中断→发送后未知（RESULT_UNKNOWN_TRUNCATED），替身命中1', async () => {
  const stub = await startTransportStub();
  try {
    stub.control.mode = 'partial';
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: stub.url, timeoutMs: 2000 } });
    const r = await t.complete(baseRequest());
    assert.equal(r.status, 'unknown');
    assert.equal(r.sentFlag, null);
    assert.equal(r.error.code, 'RESULT_UNKNOWN_TRUNCATED');
    assert.equal(stub.hits(), 1);
  } finally { await stub.close(); }
});

test('V04-TR-06 200+非JSON→确定已发送的失败（RESPONSE_CORRUPTED），替身命中1', async () => {
  const stub = await startTransportStub();
  try {
    stub.control.mode = 'malformed';
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: stub.url, timeoutMs: 2000 } });
    const r = await t.complete(baseRequest());
    assert.equal(r.status, 'failed');
    assert.equal(r.sentFlag, true, '上游已处理：确定已发送，不与未知混淆');
    assert.equal(r.error.code, 'RESPONSE_CORRUPTED');
    assert.equal(stub.hits(), 1);
  } finally { await stub.close(); }
});

test('V04-TR-07 5xx→确定失败（sentFlag=true，错误码透传响应体 error 字段）', async () => {
  const stub = await startTransportStub();
  try {
    stub.control.mode = 'status5xx';
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: stub.url, timeoutMs: 2000 } });
    const r = await t.complete(baseRequest());
    assert.equal(r.status, 'failed');
    assert.equal(r.sentFlag, true);
    assert.equal(r.error.code, 'UPSTREAM_BOOM');
    assert.equal(stub.hits(), 1);
  } finally { await stub.close(); }
});

test('V04-TR-08 4xx→请求未被处理（sentFlag=false，确定未送达处理）', async () => {
  const stub = await startTransportStub();
  try {
    stub.control.mode = 'status4xx';
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: stub.url, timeoutMs: 2000 } });
    const r = await t.complete(baseRequest());
    assert.equal(r.status, 'failed');
    assert.equal(r.sentFlag, false, '4xx=请求被拒未被处理，属未发送家族');
    assert.equal(r.error.code, 'INVALID_REQUEST_SYNTHETIC');
    assert.equal(stub.hits(), 1);
  } finally { await stub.close(); }
});

test('V04-TR-09 连接未建立即失败→确定未发送（TRANSPORT_UNREACHABLE，sentFlag=false）', async () => {
  // 占一个端口再关闭，得到一个确定无监听的回环端口
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const deadPort = probe.address().port;
  await new Promise((r) => probe.close(r));
  const t = createModelTransport({ mode: 'mock', mock: { baseUrl: `http://127.0.0.1:${deadPort}`, timeoutMs: 2000 } });
  const r = await t.complete(baseRequest());
  assert.equal(r.status, 'failed');
  assert.equal(r.sentFlag, false);
  assert.equal(r.error.code, 'TRANSPORT_UNREACHABLE');
});

test('V04-TR-10 上下文锚点隔离：不同 projectId 的载荷与 x-jw-project 头互不串线', async () => {
  const stub = await startTransportStub();
  try {
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: stub.url, timeoutMs: 2000 } });
    await t.complete(baseRequest({ projectId: 'proj-A' }));
    await t.complete(baseRequest({ projectId: 'proj-B' }));
    assert.equal(stub.hits(), 2);
    const [a, b] = stub.requests.map((r) => JSON.parse(r.body));
    assert.equal(a.b_meta.contextTags.projectId, 'proj-A');
    assert.equal(b.b_meta.contextTags.projectId, 'proj-B');
    assert.notEqual(stub.requests[0].headers['x-jw-project'], stub.requests[1].headers['x-jw-project']);
    assert.notEqual(a.b_meta.contextTags.runId, undefined);
  } finally { await stub.close(); }
});

test('V04-TR-11 载荷身份：同输入 payloadHash 稳定；contextBrief 变化→载荷变化', () => {
  const a = buildModelRequest({ runId: 'r', stepId: 's', attempt: 1, role: 'credit', purpose: 'p', projectId: 'c', goalId: null, factVersion: '0', contextBrief: '同一段简要' });
  const b = buildModelRequest({ runId: 'r', stepId: 's', attempt: 1, role: 'credit', purpose: 'p', projectId: 'c', goalId: null, factVersion: '0', contextBrief: '同一段简要' });
  const c = buildModelRequest({ runId: 'r', stepId: 's', attempt: 1, role: 'credit', purpose: 'p', projectId: 'c', goalId: null, factVersion: '0', contextBrief: '另一段简要' });
  assert.equal(a.payloadHash, b.payloadHash);
  assert.notEqual(a.payloadHash, c.payloadHash);
  assert.notEqual(a.request.text, c.request.text);
});

test('V04-TR-12 凭据卫生（real 模式打本地替身）：凭据只进 Authorization 头，指纹/账本/错误均不落', async () => {
  const KEY = 'SYNTHETIC-v04-key-never-real';
  const stub = await startTransportStub();
  try {
    const origin = new URL(stub.url).origin;
    const t = createModelTransport({
      mode: 'real',
      real: { endpoint: stub.url + '/chat/completions', model: 'stub-glm', apiKey: KEY, timeoutMs: 2000,
        outboundAllow: [origin], maxOutputTokens: 77,
        cost: { per1kInput: 0.008, per1kOutput: 0.028, currency: 'CNY' } },
    });
    const ok = await t.complete(baseRequest());
    assert.equal(ok.status, 'succeeded');
    assert.equal(stub.requests.at(-1).headers.authorization, `Bearer ${KEY}`);
    const okBody = JSON.parse(stub.requests.at(-1).body);
    assert.equal(okBody.max_tokens, 77, 'real 模式 maxOutputTokens 随请求体下发');
    // 指纹与账本不得含凭据
    const fingerprint = JSON.stringify(t.configFingerprint());
    const snapshot = JSON.stringify(t.costSnapshot());
    assert.ok(!fingerprint.includes(KEY));
    assert.ok(!snapshot.includes(KEY));
    // 错误路径同样不回显凭据
    stub.control.mode = 'status5xx';
    const bad = await t.complete(baseRequest({ attempt: 2 }));
    assert.equal(bad.status, 'failed');
    assert.ok(!JSON.stringify(bad).includes(KEY), '错误结果不得含凭据');
    assert.ok(!stub.requests.at(-1).body.includes(KEY), '请求体不含凭据（只进头）');
  } finally { await stub.close(); }
});

test('V04-TR-13 real 出站白名单：端点不在 outboundAllow→确定未发送，零出站', async () => {
  const stub = await startTransportStub();
  try {
    const t = createModelTransport({
      mode: 'real',
      real: { endpoint: stub.url + '/chat/completions', model: 'stub-glm', apiKey: 'k', outboundAllow: ['http://elsewhere.example'] },
    });
    const r = await t.complete(baseRequest());
    assert.equal(r.status, 'failed');
    assert.equal(r.sentFlag, false);
    assert.equal(r.error.code, 'OUTBOUND_NOT_ALLOWED');
    assert.equal(stub.hits(), 0);
  } finally { await stub.close(); }
});
