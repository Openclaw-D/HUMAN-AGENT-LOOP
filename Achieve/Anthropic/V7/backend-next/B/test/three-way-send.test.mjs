// 三分发送语义 + transport 契约测试(真实 loopback socket)。
// 覆盖:未发送(not_configured/出站拒绝/连接拒绝) ≠ 确定失败(4xx/5xx) ≠ 发送后未知(超时/断连/badjson);
// mock 强标记;最小上下文;成本记录;桥接的违规升级与 noFindings 策略。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelTransport, buildModelRequest } from '../src/transport/glm.mjs';
import { bridgeTransportResult } from '../src/transport/bridge.mjs';
import { startMockApi } from './helpers.mjs';

test('transport 未配置 → not_configured,零网络动作,不静默 mock', async () => {
  const t = createModelTransport({});
  assert.equal(t.mode, 'not_configured');
  const r = await t.complete({ requestId: 'r1', evidenceRefs: [] });
  assert.equal(r.status, 'not_configured');
  assert.equal(r.sentFlag, false);
  assert.equal(r.error.code, 'PROVIDER_NOT_CONFIGURED');
  const b = bridgeTransportResult(r);
  assert.equal(b.state, 'not_configured');
  assert.equal(b.sentFlag, false);
});

test('transport 非法 mode 构造即拒绝', () => {
  assert.throws(() => createModelTransport({ mode: 'silent_success' }));
  assert.throws(() => createModelTransport({ mode: 'real' })); // 缺 endpoint
  assert.throws(() => createModelTransport({ mode: 'mock' })); // 缺 baseUrl
});

test('mock 模式(真实 loopback socket):成功 → simulated + mock 强标记 + 成本记录', async () => {
  const api = await startMockApi({ mode: 'ok' });
  try {
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: api.baseUrl, timeoutMs: 3000 } });
    const req = buildModelRequest({
      runId: 'run1', stepId: 'model:credit:risk_review', attempt: 0, role: 'credit', purpose: 'risk_review',
      projectId: 'p1', goalId: 'g1', goalLabel: 'model_review', factVersion: '3', evidenceRefs: [{ id: 'e1', version: '2', hash: 'h1' }],
    });
    const r = await t.complete(req.request);
    assert.equal(r.status, 'simulated');
    assert.equal(r.source.mode, 'mock');
    assert.equal(r.sentFlag, true);
    assert.equal(r.findings[0].text, 'mock-ok p1');
    assert.ok(t.costSnapshot().length >= 1);
    assert.equal(t.costSnapshot()[0].mode, 'mock');
    // mock 请求:OpenAI 形状 + x-jw 隔离头 + b_meta 上下文标签
    assert.equal(api.requests[0].headers['x-jw-project'], 'p1');
    assert.equal(api.requests[0].headers['x-jw-run'], 'run1');
    assert.deepEqual(api.requests[0].body.b_meta.contextTags, { projectId: 'p1', goalId: 'g1', runId: 'run1', role: 'credit' });
    assert.equal(api.requests[0].body.messages[0].role, 'user');
    assert.equal(r.source.simulationOnly, true); // C mock simulationOnly 强标记被消费
    const b = bridgeTransportResult(r);
    assert.equal(b.state, 'simulated');
    assert.equal(b.simulated, true);
    assert.equal(b.candidate.recommendedHumanAction, 'none'); // 无问题 → 无建议
  } finally { await api.close(); }
});

test('real 模式:端点不在 outboundAllow → 拒绝且未发送(无网络请求)', async () => {
  const api = await startMockApi({ mode: 'ok' });
  try {
    const t = createModelTransport({
      mode: 'real',
      real: { endpoint: `${api.baseUrl}/v1/chat`, model: 'GLM-5.2', apiKey: 'sk-test-injected', timeoutMs: 2000, outboundAllow: ['https://allowed.example'] },
    });
    const before = api.requests.length;
    const r = await t.complete({ requestId: 'r2', evidenceRefs: [] });
    assert.equal(r.status, 'failed');
    assert.equal(r.sentFlag, false);
    assert.equal(r.error.code, 'OUTBOUND_NOT_ALLOWED');
    assert.equal(api.requests.length, before); // 零出站
  } finally { await api.close(); }
});

test('real 模式:端点在允许列表 → 成功,apiKey 只进请求头', async () => {
  const api = await startMockApi({ mode: 'ok' });
  try {
    const t = createModelTransport({
      mode: 'real',
      real: { endpoint: `${api.baseUrl}/v1/chat`, model: 'GLM-5.2', apiKey: 'sk-secret-injected-value', timeoutMs: 3000, outboundAllow: [api.baseUrl], cost: { per1kInput: 0.01, per1kOutput: 0.03, currency: 'CNY' } },
    });
    const r = await t.complete({ requestId: 'r3', evidenceRefs: [] });
    assert.equal(r.status, 'succeeded');
    assert.equal(r.source.mode, 'real');
    assert.equal(api.requests[0].headers.authorization, 'Bearer sk-secret-injected-value');
    // 错误/指纹路径不回显密钥
    const fp = JSON.stringify(t.configFingerprint());
    assert.ok(!fp.includes('sk-secret'));
    const cost = t.costSnapshot()[0];
    assert.equal(cost.mode, 'real');
    assert.ok(cost.cost.estimated > 0);
  } finally { await api.close(); }
});

test('连接拒绝(端口未监听)→ 确定失败且未发送(不是 unknown)', async () => {
  // 取一个空闲端口并立即释放:连接被拒
  const api = await startMockApi({ mode: 'ok' });
  const { port } = api;
  await api.close();
  const t = createModelTransport({ mode: 'mock', mock: { baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 2000 } });
  const r = await t.complete({ requestId: 'r4', evidenceRefs: [] });
  assert.equal(r.status, 'failed');
  assert.equal(r.sentFlag, false);
  assert.equal(r.error.code, 'TRANSPORT_UNREACHABLE');
  const b = bridgeTransportResult(r);
  assert.equal(b.state, 'failed');
  assert.equal(b.sentFlag, false);
});

test('响应超时(请求已发出、响应未达)→ unknown,禁止自动重试', async () => {
  const api = await startMockApi({ mode: 'slow', delayMs: 5000 });
  try {
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: api.baseUrl, timeoutMs: 300 } });
    const r = await t.complete({ requestId: 'r5', evidenceRefs: [] });
    assert.equal(r.status, 'unknown');
    assert.equal(r.sentFlag, null);
    assert.match(r.error.code, /RESULT_UNKNOWN/);
    const b = bridgeTransportResult(r);
    assert.equal(b.state, 'unknown');
    assert.equal(b.sentFlag, null);
  } finally { await api.close(); }
});

test('发送后连接被对端切断 → unknown', async () => {
  const api = await startMockApi({ mode: 'close' });
  try {
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: api.baseUrl, timeoutMs: 3000 } });
    const r = await t.complete({ requestId: 'r6', evidenceRefs: [] });
    assert.equal(r.status, 'unknown');
    assert.equal(r.error.code, 'RESULT_UNKNOWN_INTERRUPTED');
  } finally { await api.close(); }
});

test('HTTP 429=未被处理(sent=false)/5xx=上游错误(sent=true)', async () => {
  const api429 = await startMockApi({ mode: 'http429' });
  try {
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: api429.baseUrl, timeoutMs: 3000 } });
    const r = await t.complete({ requestId: 'r-429', evidenceRefs: [] });
    assert.equal(r.status, 'failed');
    assert.equal(r.sentFlag, false); // C MOCK_API §3:限流=请求未被处理
    assert.equal(r.error.code, 'RATE_LIMITED');
  } finally { await api429.close(); }
  const api500 = await startMockApi({ mode: 'http500' });
  try {
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: api500.baseUrl, timeoutMs: 3000 } });
    const r = await t.complete({ requestId: 'r-500', evidenceRefs: [] });
    assert.equal(r.status, 'failed');
    assert.equal(r.sentFlag, true); // 5xx=上游错误,结果倾向失败
    assert.equal(r.error.code, 'INTERNAL');
  } finally { await api500.close(); }
});

test('200 但 body 非 JSON → RESPONSE_CORRUPTED(上游已处理,与 unknown 区分);缺 choices → human_violation(经桥接)', async () => {
  const api1 = await startMockApi({ mode: 'badjson' });
  try {
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: api1.baseUrl, timeoutMs: 3000 } });
    const r = await t.complete({ requestId: 'r7', evidenceRefs: [] });
    assert.equal(r.status, 'failed');
    assert.equal(r.sentFlag, true);
    assert.equal(r.error.code, 'RESPONSE_CORRUPTED');
  } finally { await api1.close(); }
  const api2 = await startMockApi({ mode: 'malformed' });
  try {
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: api2.baseUrl, timeoutMs: 3000 } });
    const r = await t.complete({ requestId: 'r8', evidenceRefs: [] });
    assert.equal(r.status, 'failed');
    assert.equal(r.error.code, 'MALFORMED_OUTPUT');
    const b = bridgeTransportResult(r);
    assert.equal(b.state, 'human_violation'); // 违规不是普通失败
  } finally { await api2.close(); }
});

test('桥接:仅提问无观察 → waiting_evidence(编排层不替模型下结论)', () => {
  const b = bridgeTransportResult({
    status: 'succeeded', sentFlag: true, source: { mode: 'real' },
    findings: [], questions: [{ text: 'Q1' }],
  });
  assert.equal(b.state, 'waiting_evidence');
  assert.equal(b.candidate.uncertainty[0], 'Q1');
  const b2 = bridgeTransportResult({
    status: 'succeeded', sentFlag: true, source: { mode: 'real' },
    findings: [], questions: [{ text: 'Q1' }],
  }, { escalation: { noFindings: 'succeeded' } });
  assert.equal(b2.state, 'succeeded');
});

test('最小上下文:请求只含当前目标标签与证据引用,不含历史/仓库路径', () => {
  const { request, payloadHash } = buildModelRequest({
    runId: 'run9', stepId: 's1', attempt: 0, role: 'credit', purpose: 'risk_review',
    projectId: 'p9', goalId: 'g9', goalLabel: 'L', factVersion: '7',
    evidenceRefs: [{ id: 'e9', version: '1', hash: 'hh' }],
  });
  const s = JSON.stringify(request);
  assert.ok(!s.includes('chat_history') && !s.includes('C:/') && !s.includes('repo'));
  assert.deepEqual(request.contextTags, { projectId: 'p9', goalId: 'g9', runId: 'run9', role: 'credit' });
  assert.deepEqual(request.evidenceRefs, [{ id: 'e9', version: '1', hash: 'hh' }]);
  // 确定性:同输入同载荷哈希
  const again = buildModelRequest({
    runId: 'run9', stepId: 's1', attempt: 0, role: 'credit', purpose: 'risk_review',
    projectId: 'p9', goalId: 'g9', goalLabel: 'L', factVersion: '7',
    evidenceRefs: [{ id: 'e9', version: '1', hash: 'hh' }],
  });
  assert.equal(payloadHash, again.payloadHash);
  assert.equal(request.requestId, 'run9::s1::a0');
});
