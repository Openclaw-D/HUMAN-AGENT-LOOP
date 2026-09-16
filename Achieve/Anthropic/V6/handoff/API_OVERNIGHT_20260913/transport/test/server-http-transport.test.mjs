// B路 transport 本地模拟测试(整夜任务 · 2026-09-13,按 A 路 CONTRACT.md §1/§2/§4 对齐)。
// 只用 Node 内置 node:test + 注入桩 fetch,零外部依赖,不发任何真实网络请求、
// 不调用付费模型、不读任何凭据;密钥串是测试内造的假值。
// 运行:node test/run-all.mjs(或 node --test <显式文件>;Windows 下不传目录)。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SERVER_MODEL_ENV_KEYS,
  resolveServerModelConfig,
  describeServerModelConfig,
  createHttpJsonTransport,
} from '../server-http-transport.mjs';
// 产品源只读 import:引用越界/超时/stale 语义必须在真实适配器守门下验证。
import { createModelAdapter } from '../../../../../jianwei-v3/site/lib/v5-preview/model-adapter/adapter.mjs';

const FAKE_KEY = 'sk-test-not-a-real-key';
// CONTRACT §1 config 形状:凭据走 getApiKey 回调;另测 apiKey 字符串的等价通路。
const VALID_CONFIG = { baseUrl: 'https://mock.local/v1', model: 'demo-model', getApiKey: () => FAKE_KEY };

/** 手动时钟:adapter 竞速与 transport 可选 deadline 共用,advance 确定性触发。 */
function createManualClock() {
  let nowMs = 1_000_000;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => nowMs,
    setTimeout(fn, ms) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { fn, at: nowMs + Math.max(0, ms) });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      const target = nowMs + ms;
      for (;;) {
        let minId = null;
        let minAt = Infinity;
        for (const [id, t] of timers) {
          if (t.at <= target && t.at < minAt) {
            minAt = t.at;
            minId = id;
          }
        }
        if (minId === null) break;
        const t = timers.get(minId);
        timers.delete(minId);
        nowMs = t.at;
        t.fn();
      }
      nowMs = target;
    },
  };
}

const EVIDENCE_TEXT = '客户自述:2025年3月起应收账款回款周期从45天延长至90天。';
function demoRequest(patch = {}) {
  return {
    requestId: 'req-test-001',
    projectId: 'proj-demo',
    sessionId: 'sess-demo',
    generation: 1,
    contextVersion: 1,
    role: 'credit',
    purpose: 'credit_review',
    text: EVIDENCE_TEXT,
    evidenceRefs: [{ id: 'EV-001', version: 'v1', hash: 'h-001' }],
    ...patch,
  };
}
const demoContext = { snapshot: () => ({ generation: 1, contextVersion: 1, paused: false }) };

function goodOutput() {
  const ref = { id: 'EV-001', version: 'v1', hash: 'h-001' };
  return {
    findings: [{ id: 'F1', text: '回款周期显著延长,需核实原因与影响。', evidenceRefs: [ref] }],
    questions: [{ id: 'Q1', text: '请提供2025年1-6月应收账款账龄明细。', evidenceRefs: [ref] }],
    evidenceRefs: [ref],
  };
}

function completionBodyJson(output, usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }) {
  return JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(output) }, finish_reason: 'stop' }],
    usage,
  });
}

/** 可编程桩 fetch:记录调用;按脚本返回 Response 形状对象(不使用真实 fetch/网络)。 */
function stubFetch(script) {
  const calls = [];
  const state = { aborted: false, count: 0 };
  const fn = async (url, init) => {
    state.count += 1;
    calls.push({ url, init });
    if (script.signalAware) {
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          state.aborted = true;
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          err.code = 'ABORT_ERR';
          reject(err);
        });
      });
    }
    const r = typeof script.respond === 'function' ? script.respond({ url, init }) : script.respond;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? r.contentType ?? 'application/json' : null) },
      text: async () => r.body,
    };
  };
  fn.calls = calls;
  fn.state = state;
  return fn;
}

function assertNoSecret(value) {
  assert.ok(!JSON.stringify(value).includes(FAKE_KEY), '返回值/错误信息不得包含密钥');
}

// ---------------------------------------------------------------------------
// 1) 配置校验(CONTRACT §4):缺项列出 / 非法端点 / mode 报告 / 无秘密摘要
// ---------------------------------------------------------------------------
test('resolveServerModelConfig:三项全缺时列出全部缺项(含CONTRACT §4环境名),摘要无密钥', () => {
  const r = resolveServerModelConfig({});
  assert.equal(r.ok, false);
  const fields = r.missing.map((m) => m.field).sort();
  assert.deepEqual(fields, ['apiKey', 'baseUrl', 'model']);
  assert.equal(r.missing.find((m) => m.field === 'apiKey').env, 'JIANWEI_MODEL_API_KEY');
  assert.equal(r.sanitized.configured, false);
  assert.equal(r.sanitized.hasApiKey, false);
  assert.equal(r.sanitized.mode, 'simulation', 'mode 缺省 simulation(CONTRACT §4)');
  assertNoSecret(r);
});

test('resolveServerModelConfig:合法配置通过;mode=real 如实报告;mode 非法进 invalid', () => {
  const ok = resolveServerModelConfig({
    [SERVER_MODEL_ENV_KEYS.baseUrl]: 'https://mock.local/v1/',
    [SERVER_MODEL_ENV_KEYS.model]: 'demo-model',
    [SERVER_MODEL_ENV_KEYS.apiKey]: FAKE_KEY,
    [SERVER_MODEL_ENV_KEYS.mode]: 'real',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.config.apiKey, FAKE_KEY, 'config 是显式注入通道,携带密钥供 transport 使用');
  assert.equal(ok.sanitized.endpoint, 'https://mock.local/v1/chat/completions');
  assert.equal(ok.sanitized.hasApiKey, true);
  assert.equal(ok.sanitized.mode, 'real');
  assertNoSecret(ok.sanitized);

  const badMode = resolveServerModelConfig({
    [SERVER_MODEL_ENV_KEYS.baseUrl]: 'https://mock.local/v1',
    [SERVER_MODEL_ENV_KEYS.model]: 'm',
    [SERVER_MODEL_ENV_KEYS.apiKey]: FAKE_KEY,
    [SERVER_MODEL_ENV_KEYS.mode]: 'yes',
  });
  assert.equal(badMode.ok, false);
  assert.equal(badMode.invalid[0].field, 'mode');
});

test('resolveServerModelConfig:端点非法(非http/凭据内嵌/无法解析)单独报 invalid', () => {
  for (const bad of ['ftp://mock.local/v1', 'https://user:pass@mock.local/v1', 'not a url']) {
    const r = resolveServerModelConfig({
      [SERVER_MODEL_ENV_KEYS.baseUrl]: bad,
      [SERVER_MODEL_ENV_KEYS.model]: 'demo-model',
      [SERVER_MODEL_ENV_KEYS.apiKey]: FAKE_KEY,
    });
    assert.equal(r.ok, false, `端点 ${bad} 应判非法`);
    assert.equal(r.missing.length, 0);
    assert.equal(r.invalid[0].field, 'baseUrl');
  }
});

test('describeServerModelConfig:输出无秘密摘要,可安全进 STATUS/日志', () => {
  const d = describeServerModelConfig({ [SERVER_MODEL_ENV_KEYS.baseUrl]: 'https://mock.local/v1', [SERVER_MODEL_ENV_KEYS.model]: 'm' });
  assert.equal(d.configured, false);
  assert.equal(d.hasApiKey, false);
  assert.equal(d.model, 'm');
  assertNoSecret(d);
});

// ---------------------------------------------------------------------------
// 2) 未配置(CONTRACT §1:送出前失败 throw notSent:true;适配器判 cancelled)
// ---------------------------------------------------------------------------
test('transport 未配置:throw notSent TRANSPORT_NOT_CONFIGURED(缺项列全),fetch 桩零调用', async () => {
  const fetchImpl = stubFetch({ respond: { status: 200, body: '{}' } });
  const transport = createHttpJsonTransport({ config: null, fetchImpl });
  await assert.rejects(
    transport({ payload: demoRequest(), role: 'credit', purpose: 'credit_review' }),
    (err) => {
      assert.equal(err.notSent, true);
      assert.equal(err.code, 'TRANSPORT_NOT_CONFIGURED');
      assert.ok(err.message.includes('端点'));
      assert.ok(err.message.includes('模型名'));
      assert.ok(err.message.includes('密钥'));
      return true;
    },
  );
  assert.equal(fetchImpl.state.count, 0);
});

test('transport 仅缺密钥:同样送出前失败关闭,不回退占位符发送', async () => {
  const fetchImpl = stubFetch({ respond: { status: 200, body: '{}' } });
  const transport = createHttpJsonTransport({ config: { baseUrl: 'https://mock.local/v1', model: 'demo-model' }, fetchImpl });
  await assert.rejects(
    transport({ payload: demoRequest(), role: 'credit', purpose: 'credit_review' }),
    (err) => {
      assert.equal(err.notSent, true);
      assert.equal(err.code, 'TRANSPORT_NOT_CONFIGURED');
      assert.ok(err.message.includes('密钥'));
      return true;
    },
  );
  assert.equal(fetchImpl.state.count, 0);
});

test('未配置经适配器端到端:cancelled/CANCELLED_BEFORE_SEND,预留释放,原因进 details', async () => {
  const clock = createManualClock();
  const transport = createHttpJsonTransport({ config: null, fetchImpl: stubFetch({ respond: { status: 200, body: '{}' } }), clock });
  const adapter = createModelAdapter({ transport, timeoutMs: 5000, clock });
  const result = await adapter.analyze(demoRequest(), demoContext);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.error.code, 'CANCELLED_BEFORE_SEND');
  assert.ok(result.error.details.reason.includes('TRANSPORT_NOT_CONFIGURED') || result.error.details.reason.includes('未配置'), '未配置原因透传');
  assert.equal(result.costLedger.reservationState, 'released', '确定未发生外部调用,预留必须释放');
});

// ---------------------------------------------------------------------------
// 3) 成功:transport 层 + 适配器端到端(SUCCEEDED 与模拟可区分、usage 结算、正文进请求)
// ---------------------------------------------------------------------------
test('成功(transport 层):POST chat/completions,证据正文进请求,Authorization 只发往服务端', async () => {
  const fetchImpl = stubFetch({ respond: { status: 200, body: completionBodyJson(goodOutput()) } });
  const transport = createHttpJsonTransport({ config: VALID_CONFIG, fetchImpl });
  const result = await transport({ payload: demoRequest(), role: 'credit', purpose: 'credit_review' });

  assert.equal(result.ok, true);
  assert.equal(result.modeName, 'http_json');
  assert.equal(result.output.findings[0].text, '回款周期显著延长,需核实原因与影响。');
  assert.deepEqual(result.usage, { promptTokens: 10, completionTokens: 5, totalTokens: 15 });

  const call = fetchImpl.calls[0];
  assert.equal(call.init.method, 'POST');
  assert.equal(call.url, 'https://mock.local/v1/chat/completions');
  assert.equal(call.init.headers.Authorization, `Bearer ${FAKE_KEY}`);
  const body = JSON.parse(call.init.body);
  assert.equal(body.model, 'demo-model');
  assert.equal(body.response_format.type, 'json_object');
  const userPayload = JSON.parse(body.messages[1].content);
  assert.ok(userPayload.text.includes('回款周期从45天延长至90天'), '证据正文必须进入请求,不能只发hash');
  assert.deepEqual(userPayload.evidenceRefs, [{ id: 'EV-001', version: 'v1', hash: 'h-001' }]);
  assertNoSecret(result);
});

test('成功(apiKey 字符串通路与 getApiKey 等价)', async () => {
  const fetchImpl = stubFetch({ respond: { status: 200, body: completionBodyJson(goodOutput()) } });
  const transport = createHttpJsonTransport({
    config: { baseUrl: 'https://mock.local/v1', model: 'demo-model', apiKey: FAKE_KEY },
    fetchImpl,
  });
  const result = await transport({ payload: demoRequest(), role: 'credit', purpose: 'credit_review' });
  assert.equal(result.ok, true);
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, `Bearer ${FAKE_KEY}`);
});

test('成功(适配器端到端):SUCCEEDED(非 simulated)、usage 如实结算为 committed', async () => {
  const clock = createManualClock();
  const transport = createHttpJsonTransport({
    config: VALID_CONFIG,
    fetchImpl: stubFetch({ respond: { status: 200, body: completionBodyJson(goodOutput()) } }),
    clock,
  });
  const adapter = createModelAdapter({ transport, timeoutMs: 5000, clock });
  const result = await adapter.analyze(demoRequest(), demoContext);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.simulation, null);
  assert.equal(result.error, null);
  assert.equal(result.usage.totalTokens, 15);
  assert.equal(result.costLedger.reservationState, 'committed');
  assertNoSecret(result);
});

// ---------------------------------------------------------------------------
// 4) enrich(CONTRACT §2):正文并入载荷副本,不改冻结原件;null 不并;异常失败关闭
// ---------------------------------------------------------------------------
test('enrich 返回对象:context 并入发往模型的副本,原 payload 冻结原件不被修改', async () => {
  const fetchImpl = stubFetch({ respond: { status: 200, body: completionBodyJson(goodOutput()) } });
  const enrich = async (call) => ({
    evidence: [{ id: 'EV-001', version: 1, title: '访谈记录', text: '客户补充:回款延长的原因是下游客户资金紧张。' }],
    humanReplies: [{ author: '客户', text: '是下游资金紧张。', at: '2026-09-13T20:00:00+08:00' }],
    annotationQuestion: '应收账款回款周期为何显著延长?',
  });
  const transport = createHttpJsonTransport({ config: VALID_CONFIG, fetchImpl, enrich });
  const payload = Object.freeze(demoRequest()); // 适配器 buildPayload 产物为深冻结;此处以冻结件等价验证
  const result = await transport({ payload, role: 'credit', purpose: 'credit_review' });
  assert.equal(result.ok, true);

  const userPayload = JSON.parse(JSON.parse(fetchImpl.calls[0].init.body).messages[1].content);
  assert.equal(userPayload.context.evidence[0].text, '客户补充:回款延长的原因是下游客户资金紧张。');
  assert.equal(userPayload.context.annotationQuestion, '应收账款回款周期为何显著延长?');
  assert.ok(!('context' in payload), '冻结原件不得被并入 context');
  assert.ok(Object.isFrozen(payload), '原 payload 保持适配器深冻结语义');
});

test('enrich 返回 null:不并 context,照常发送(CONTRACT §2 找不到内容不臆造)', async () => {
  const fetchImpl = stubFetch({ respond: { status: 200, body: completionBodyJson(goodOutput()) } });
  const transport = createHttpJsonTransport({ config: VALID_CONFIG, fetchImpl, enrich: async () => null });
  const result = await transport({ payload: demoRequest(), role: 'credit', purpose: 'credit_review' });
  assert.equal(result.ok, true);
  const userPayload = JSON.parse(JSON.parse(fetchImpl.calls[0].init.body).messages[1].content);
  assert.ok(!('context' in userPayload));
});

test('enrich 抛异常:送出前失败关闭(notSent),fetch 零调用', async () => {
  const fetchImpl = stubFetch({ respond: { status: 200, body: '{}' } });
  const transport = createHttpJsonTransport({ config: VALID_CONFIG, fetchImpl, enrich: async () => { throw new Error('store 不可用'); } });
  await assert.rejects(
    transport({ payload: demoRequest(), role: 'credit', purpose: 'credit_review' }),
    (err) => {
      assert.equal(err.notSent, true);
      assert.equal(err.code, 'ENRICH_FAILED');
      assert.ok(err.message.includes('store 不可用'));
      return true;
    },
  );
  assert.equal(fetchImpl.state.count, 0);
});

// ---------------------------------------------------------------------------
// 5) 超时/取消(CONTRACT §1:signal 透传;超时由适配器竞速;deadlineAbort 为显式 opt-in)
// ---------------------------------------------------------------------------
test('超时(适配器竞速):unknown/TIMEOUT,预留 unknown_hold;opt-in deadlineAbort 真正中止 fetch', async () => {
  const clock = createManualClock();
  const fetchImpl = stubFetch({ signalAware: true });
  const transport = createHttpJsonTransport({ config: VALID_CONFIG, fetchImpl, clock, deadlineAbortMs: 5000 });
  const adapter = createModelAdapter({ transport, timeoutMs: 5000, clock });
  const pending = adapter.analyze(demoRequest(), demoContext);
  await Promise.resolve(); // 让适配器经微任务真正启动 transport(注册 deadline 计时器)再推时钟
  clock.advance(5000);
  const result = await pending;

  assert.equal(result.status, 'unknown');
  assert.equal(result.error.code, 'TIMEOUT');
  assert.equal(result.usageUnknown, true);
  assert.equal(result.costLedger.reservationState, 'unknown_hold');
  assert.ok(result.error.message.includes('人工核实'), '超时提示必须引导人工核实,不自动重试');
  assert.equal(fetchImpl.state.aborted, true, 'opt-in deadlineAbort 在送出 5000ms 后真正中止在途 fetch');
  assertNoSecret(result);
});

test('缺省(不启用 deadlineAbort):transport 不另设计时器,超时分类完全由适配器竞速给出', async () => {
  const clock = createManualClock();
  const fetchImpl = stubFetch({ signalAware: true });
  const transport = createHttpJsonTransport({ config: VALID_CONFIG, fetchImpl, clock });
  const adapter = createModelAdapter({ transport, timeoutMs: 1234, clock });
  const pending = adapter.analyze(demoRequest(), demoContext);
  clock.advance(1234);
  const result = await pending;
  assert.equal(result.status, 'unknown');
  assert.equal(result.error.code, 'TIMEOUT');
  assert.equal(fetchImpl.state.aborted, false, 'CONTRACT §1:transport 自身不设双超时,fetch 不被 transport 中止');
});

test('送出后 opt-in deadline 到点:transport 返回 ok:indeterminate(结果不可知)', async () => {
  const clock = createManualClock();
  const fetchImpl = stubFetch({ signalAware: true });
  const transport = createHttpJsonTransport({ config: VALID_CONFIG, fetchImpl, clock, deadlineAbortMs: 50 });
  const pending = transport({ payload: demoRequest(), role: 'credit', purpose: 'credit_review' });
  clock.advance(50);
  const result = await pending;
  assert.equal(result.ok, 'indeterminate');
});

test('取消·送出前:适配器直接 cancelled(transport 未调用);transport 自查 throw notSent', async () => {
  const clock = createManualClock();
  const fetchImpl = stubFetch({ respond: { status: 200, body: completionBodyJson(goodOutput()) } });
  const transport = createHttpJsonTransport({ config: VALID_CONFIG, fetchImpl, clock });
  const adapter = createModelAdapter({ transport, timeoutMs: 5000, clock });
  const controller = new AbortController();
  controller.abort();
  const result = await adapter.analyze(demoRequest(), { ...demoContext, signal: controller.signal });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.error.code, 'CANCELLED_BEFORE_SEND');
  assert.equal(result.costLedger.reservationState, 'none', '送出前取消未预留,账本保持 none');
  assert.equal(fetchImpl.state.count, 0);

  await assert.rejects(
    transport({ payload: demoRequest(), role: 'credit', purpose: 'credit_review', signal: controller.signal }),
    (err) => {
      assert.equal(err.notSent, true);
      assert.equal(err.code, 'CANCELLED_BEFORE_SEND');
      return true;
    },
  );
});

test('取消·送出后外部中止:signal 透传,transport 返回 indeterminate(不谎称未发生外部调用)', async () => {
  const clock = createManualClock();
  const fetchImpl = stubFetch({ signalAware: true });
  const transport = createHttpJsonTransport({ config: VALID_CONFIG, fetchImpl, clock });
  const controller = new AbortController();
  const pending = transport({ payload: demoRequest(), role: 'credit', purpose: 'credit_review', signal: controller.signal });
  controller.abort();
  const result = await pending;
  assert.equal(result.ok, 'indeterminate');
});

// ---------------------------------------------------------------------------
// 6) HTTP 错误:非2xx 一律失败;JSON 错误体复用既有解析;错误也如实计费;消息截断
// ---------------------------------------------------------------------------
test('HTTP 401(JSON 错误体):sent:true,错误码透传,适配器判 failed/TRANSPORT_ERROR', async () => {
  const clock = createManualClock();
  const transport = createHttpJsonTransport({
    config: VALID_CONFIG,
    clock,
    fetchImpl: stubFetch({
      respond: { status: 401, body: JSON.stringify({ error: { message: '无效的密钥', code: 'invalid_api_key' } }) },
    }),
  });
  const adapter = createModelAdapter({ transport, timeoutMs: 5000, clock });
  const result = await adapter.analyze(demoRequest(), demoContext);
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'TRANSPORT_ERROR');
  assert.equal(result.error.details.code, 'invalid_api_key');
  assert.ok(result.error.message.includes('无效的密钥'));
  assertNoSecret(result);

  const direct = await transport({ payload: demoRequest(), role: 'credit', purpose: 'credit_review' });
  assert.equal(direct.ok, false);
  assert.equal(direct.sent, true);
  assert.equal(direct.httpStatus, 401);
  assert.equal(direct.error.httpStatus, 401);
});

test('HTTP 401 超长错误消息:截断到 200 字符内(CONTRACT §1 脱敏),不回显全文', async () => {
  const longMsg = 'x'.repeat(500);
  const transport = createHttpJsonTransport({
    config: VALID_CONFIG,
    fetchImpl: stubFetch({
      respond: { status: 401, body: JSON.stringify({ error: { message: longMsg, code: 'invalid_api_key' } }) },
    }),
  });
  const result = await transport({ payload: demoRequest(), role: 'credit', purpose: 'credit_review' });
  assert.equal(result.ok, false);
  assert.ok(result.error.message.length <= 210, `消息应被截断,实际 ${result.error.message.length}`);
  assert.ok(!result.error.message.includes('x'.repeat(300)), '500字符原文不得回显');
});

test('HTTP 429 错误体带 usage:调用已发生,usage 仍如实结算(committed)', async () => {
  const clock = createManualClock();
  const transport = createHttpJsonTransport({
    config: VALID_CONFIG,
    clock,
    fetchImpl: stubFetch({
      respond: {
        status: 429,
        body: JSON.stringify({ error: { message: '额度不足', code: 'insufficient_quota' }, usage: { prompt_tokens: 7, completion_tokens: 0, total_tokens: 7 } }),
      },
    }),
  });
  const adapter = createModelAdapter({ transport, timeoutMs: 5000, clock });
  const result = await adapter.analyze(demoRequest(), demoContext);
  assert.equal(result.status, 'failed');
  assert.equal(result.usage.totalTokens, 7, '失败的调用若已计费,usage 不得丢失');
  assert.equal(result.costLedger.reservationState, 'committed');
});

test('HTTP 503(非JSON错误体):报 HTTP_503,不回显原始响应体', async () => {
  const transport = createHttpJsonTransport({
    config: VALID_CONFIG,
    fetchImpl: stubFetch({ respond: { status: 503, body: '<html><body>upstream error page</body></html>', contentType: 'text/html' } }),
  });
  const result = await transport({ payload: demoRequest(), role: 'credit', purpose: 'credit_review' });
  assert.equal(result.ok, false);
  assert.equal(result.sent, true);
  assert.equal(result.error.code, 'HTTP_503');
  assert.ok(!JSON.stringify(result).includes('<html>'), '原始错误体不得回显');
  assert.ok(!JSON.stringify(result).includes('upstream error page'), '错误页内容不得回显');
});

// ---------------------------------------------------------------------------
// 7) 非JSON:2xx 响应体非JSON → SERVER_HTTP_NOT_JSON;content 非JSON → 复用既有码
// ---------------------------------------------------------------------------
test('2xx 响应体非JSON:SERVER_HTTP_NOT_JSON,适配器判 failed', async () => {
  const clock = createManualClock();
  const transport = createHttpJsonTransport({
    config: VALID_CONFIG,
    clock,
    fetchImpl: stubFetch({ respond: { status: 200, body: '<html>not json</html>', contentType: 'text/html' } }),
  });
  const direct = await transport({ payload: demoRequest(), role: 'credit', purpose: 'credit_review' });
  assert.equal(direct.ok, false);
  assert.equal(direct.sent, true);
  assert.equal(direct.error.code, 'SERVER_HTTP_NOT_JSON');

  const adapter = createModelAdapter({ transport, timeoutMs: 5000, clock });
  const result = await adapter.analyze(demoRequest(), demoContext);
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'TRANSPORT_ERROR');
});

test('2xx JSON 但 content 字符串非JSON:复用既有 PROVIDER_CONTENT_NOT_JSON,不伪装成功', async () => {
  const transport = createHttpJsonTransport({
    config: VALID_CONFIG,
    fetchImpl: stubFetch({
      respond: { status: 200, body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: '抱歉,我无法输出JSON' } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }) },
    }),
  });
  const result = await transport({ payload: demoRequest(), role: 'credit', purpose: 'credit_review' });
  assert.equal(result.ok, false);
  assert.equal(result.sent, true);
  assert.equal(result.error.code, 'PROVIDER_CONTENT_NOT_JSON');
  assert.equal(result.usage.totalTokens, 5);
});

// ---------------------------------------------------------------------------
// 8) 引用越界:模型引用未提供的证据 → 适配器守门失败关闭,绝不放行
// ---------------------------------------------------------------------------
test('引用越界(适配器端到端):EVIDENCE_DANGLING,违规输出不得放行,usage 仍如实结算', async () => {
  const clock = createManualClock();
  const ghost = {
    findings: [{ id: 'F1', text: '据称客户另有未披露借款。', evidenceRefs: [{ id: 'EV-GHOST', version: 'v9', hash: 'h-ghost' }] }],
    questions: [],
    evidenceRefs: [{ id: 'EV-GHOST', version: 'v9', hash: 'h-ghost' }],
  };
  const transport = createHttpJsonTransport({
    config: VALID_CONFIG,
    clock,
    fetchImpl: stubFetch({ respond: { status: 200, body: completionBodyJson(ghost) } }),
  });
  const adapter = createModelAdapter({ transport, timeoutMs: 5000, clock });
  const result = await adapter.analyze(demoRequest(), demoContext);
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'EVIDENCE_DANGLING');
  assert.ok(result.error.message.includes('EV-GHOST'));
  assert.equal(result.costLedger.reservationState, 'committed', '守门拒绝不等于未计费');
  assert.equal(result.findings.length, 0, '违规输出不得作为 findings 放行');
});

test('无来源发现(引用为空):同样失败关闭 UNSOURCED_FINDING', async () => {
  const clock = createManualClock();
  const unsourced = {
    findings: [{ id: 'F1', text: '客户经营状况良好。', evidenceRefs: [] }],
    questions: [],
  };
  const transport = createHttpJsonTransport({
    config: VALID_CONFIG,
    clock,
    fetchImpl: stubFetch({ respond: { status: 200, body: completionBodyJson(unsourced) } }),
  });
  const adapter = createModelAdapter({ transport, timeoutMs: 5000, clock });
  const result = await adapter.analyze(demoRequest(), demoContext);
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'UNSOURCED_FINDING');
});

// ---------------------------------------------------------------------------
// 9) 网络错误分级:可证明未送达 → notSent(适配器 cancelled);连接后异常 → indeterminate
// ---------------------------------------------------------------------------
test('网络错误·连接被拒(ECONNREFUSED):throw notSent,适配器判 cancelled 并释放预留', async () => {
  const clock = createManualClock();
  const fetchImpl = async () => {
    const err = new TypeError('fetch failed');
    err.cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' });
    throw err;
  };
  const transport = createHttpJsonTransport({ config: VALID_CONFIG, fetchImpl, clock });
  await assert.rejects(
    transport({ payload: demoRequest(), role: 'credit', purpose: 'credit_review' }),
    (err) => {
      assert.equal(err.notSent, true);
      assert.equal(err.code, 'SERVER_HTTP_CONNECT_FAILED');
      assert.ok(err.message.includes('ECONNREFUSED'));
      assert.ok(!err.message.includes('fetch failed'), '底层 message 不透传,只报错误码');
      return true;
    },
  );

  const adapter = createModelAdapter({ transport, timeoutMs: 5000, clock });
  const r2 = await adapter.analyze(demoRequest(), demoContext);
  assert.equal(r2.status, 'cancelled');
  assert.equal(r2.costLedger.reservationState, 'released');
});

test('网络错误·连接后中断(无错误码):indeterminate,不谎称失败或未计费', async () => {
  const clock = createManualClock();
  const fetchImpl = async () => {
    throw new TypeError('fetch failed');
  };
  const transport = createHttpJsonTransport({ config: VALID_CONFIG, fetchImpl, clock });
  const result = await transport({ payload: demoRequest(), role: 'credit', purpose: 'credit_review' });
  assert.equal(result.ok, 'indeterminate');
});
