// V7-B 回环 HTTP 证据:本地 mock OpenAI Chat Completions 服务(仅 127.0.0.1 随机端口)
// + V6 既有 createProviderTransport/http-json 映射 + B 编排模型步 = 真实 socket 端到端。
// ⚠️ 这是回环传输证据,不是真实模型 provider 验证:真实 provider 凭据未获授权(0 次真实调用)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createScriptedTransport, createHarness, cleanupDir, EVIDENCE } from './helpers.mjs';
import { createProviderTransport } from '../../../../V6/handoff/PARALLEL_MODEL_ADAPTER_20260913/src/adapter.mjs';
import { buildChatCompletionsRequest, parseChatCompletionsResponse } from '../../../../V6/handoff/PARALLEL_MODEL_ADAPTER_20260913/src/providers/http-json.mjs';

test('回环 HTTP:mock OpenAI 形状服务 + 真实 provider transport + 编排全链路', async () => {
  // 1) 本地 mock provider(OpenAI Chat Completions 响应形状;内容合成)
  const seen = { authHeader: null, bodies: [] };
  const mock = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      seen.authHeader = req.headers.authorization ?? null;
      seen.bodies.push(JSON.parse(raw || '{}'));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        id: 'chatcmpl-mock', object: 'chat.completion', created: Math.floor(Date.now() / 1000),
        model: 'synthetic-mock', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({
          findings: [{ id: 'f-loop', text: '回环证据:模型通道传输层工作正常', evidenceRefs: [{ id: 'ev-001', version: '2', hash: 'aaaa1111' }] }],
          questions: [],
        }) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 42, completion_tokens: 17, total_tokens: 59 },
      }));
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const port = mock.address().port;

  try {
    // 2) V6 既有 provider transport(与真实接入同一条代码路径;fetch 注入)
    const transport = createProviderTransport({
      buildRequest: (payload) => buildChatCompletionsRequest(payload, {
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: 'synthetic-mock',
        getApiKey: () => 'LOOPBACK-TEST-TOKEN-not-a-real-credential',
      }),
      parseResponse: parseChatCompletionsResponse,
      modeName: 'http-chat-completions',
      fetchImpl: fetch,
    });

    // 3) 编排跑一个真实 socket 模型步
    const h = await createHarness({ transport });
    try {
      const v = await h.thin.start({ runId: 'loop-1', projectId: 'proj-1', eventType: 'new_application', evidenceRefs: EVIDENCE });
      assert.equal(v.state, 'completed');
      assert.equal(v.steps[0].state, 'succeeded');
      // 传输层真实发生:mock 收到 Authorization 头与载荷
      assert.match(seen.authHeader ?? '', /^Bearer /);
      assert.equal(seen.bodies.length, 1);
      assert.equal(seen.bodies[0].model, 'synthetic-mock');
      assert.ok(seen.bodies[0].messages.length >= 1);
      // 候选意见 authority=none;观察文本来自真实往返的模型响应
      assert.equal(v.candidate.authority, 'none');
      assert.ok(v.candidate.observations.some((o) => o.includes('回环证据')), '观察必须来自 mock 模型响应');
    } finally { await cleanupDir(h.dataDir); }
  } finally {
    await new Promise((r) => mock.close(r));
  }
});
