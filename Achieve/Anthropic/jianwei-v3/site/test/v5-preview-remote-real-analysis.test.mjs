// V6 API_OVERNIGHT 20260913 · A路真实模型辅助分析回归（CONTRACT §1–§7；隔离数据、无网络、无密钥）。
// 覆盖：未配置/MODE未real、注入transport成功链路（model_real 落库+basedOn+usage）、证据正文进请求
//（enrich 含人工纠正）、同 requestId 幂等、新 requestId 再分析读到新内容、transport 各失败形态
//（HTTP错误/非JSON/越权输出/取消/配置缺失）、等待期间暂停/人工纠正/证据取代 → MODEL_RESULT_STALE、
// 预算上限、配置状态不泄密、store 读写兼容（旧记录无 model_real 仍可读）。
// 运行：node --experimental-strip-types --test test/v5-preview-remote-real-analysis.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'real-analysis-data-'));

const svc = await import('../lib/v5-preview/remote-service.ts');
// B 路 transport 已集成（原 server-http-transport.mjs → providers/http-fetch.mjs，仅 import 一处改动）
const { createHttpJsonTransport } = await import('../lib/v5-preview/model-adapter/providers/http-fetch.mjs');

let serial = 0;
let serialReq = 0;
const write = (fn, body) => fn({ requestId: `ra-${++serial}`, expectedVersion: svc.getRemoteState().remoteVersion, ...body });
const nextRequestId = () => `ra-req-${++serialReq}`;

const MODEL_ENV_KEYS = ['JIANWEI_MODEL_BASE_URL', 'JIANWEI_MODEL_NAME', 'JIANWEI_MODEL_API_KEY', 'JIANWEI_MODEL_MODE'];
function withModelEnv(overrides, fn) {
  const saved = Object.fromEntries(MODEL_ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of MODEL_ENV_KEYS) delete process.env[k];
  Object.assign(process.env, overrides);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of MODEL_ENV_KEYS) delete process.env[k];
      for (const [k, v] of Object.entries(saved)) {
        if (v !== undefined) process.env[k] = v;
      }
    });
}

function setupSession({ question = 'RA 默认访谈问题（合成）：设备清单与现场是否一致？' } = {}) {
  const created = write(svc.createRemoteSession, { title: 'RA 真实分析（合成）' });
  const sessionId = created.session.sessionId;
  const ev = write(svc.attachEvidence, { sessionId, fixtureId: 'fixture-equipment' });
  const ann = write(svc.createAnnotation, {
    sessionId, evidenceId: ev.evidence.evidenceId, evidenceVersion: 1, question, rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
  });
  return { sessionId, evidence: ev.evidence, annotationId: ann.annotation.annotationId, question };
}

const REAL_ENV = { JIANWEI_MODEL_BASE_URL: 'https://model.example.invalid/v1', JIANWEI_MODEL_NAME: 'test-model', JIANWEI_MODEL_API_KEY: 'sk-test-FAKE-KEY', JIANWEI_MODEL_MODE: 'real' };

/** 脚本化候选 transport：返回合法 provider 输出（引用回显输入 evidenceRefs）。 */
function scriptedOkTransport(options = {}) {
  return async (call) => {
    if (options.capture !== undefined) options.capture.calls.push(call);
    if (options.hang !== undefined) await options.hang.promise;
    if (options.impl !== undefined) return options.impl(call);
    const ref = call.payload.evidenceRefs[0];
    return {
      ok: true, sent: true,
      output: {
        findings: [{ id: 'F1', text: '设备数量与现场陈述存在差异（合成测试疑点）', evidenceRefs: [ref] }],
        questions: [{ id: 'Q1', text: '请补充说明差异原因与时间线（合成测试追问）', evidenceRefs: [] }],
      },
      usage: { promptTokens: 120, completionTokens: 45, totalTokens: 165 },
    };
  };
}

/** 生产组合 transport：interim transport + 生产 enrich 工厂 + 假 fetchImpl（HTTP 边界伪造）。
 *  覆盖 CONTRACT 全链路：enrich 进请求体、chat/completions 映射、usage 带出。 */
function composedTransport({ sessionId, annotationId, evidence, capture, hang, replyBody }) {
  return createHttpJsonTransport({
    config: { baseUrl: REAL_ENV.JIANWEI_MODEL_BASE_URL, model: REAL_ENV.JIANWEI_MODEL_NAME, getApiKey: () => REAL_ENV.JIANWEI_MODEL_API_KEY },
    fetchImpl: async (url, init) => {
      if (capture !== undefined) capture.requests.push({ url, init });
      if (hang !== undefined) await hang.promise;
      const content = JSON.stringify({
        findings: [{ id: 'F1', text: '设备数量与现场陈述存在差异（合成测试疑点）', evidenceRefs: [{ id: evidence.evidenceId, version: '1', hash: evidence.sha256 }] }],
        questions: [{ id: 'Q1', text: '请补充说明差异原因与时间线（合成测试追问）', evidenceRefs: [] }],
        ...(replyBody ?? {}),
      });
      return new Response(JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
    enrich: svc.buildEvidenceContext(sessionId, annotationId, evidence),
  });
}

function expectModelerror(code) {
  return (error) => {
    assert.ok(error instanceof svc.RemoteModelServiceError, `应抛 RemoteModelServiceError，实际 ${error}`);
    assert.equal(error.code, code);
    return true;
  };
}

// ---------------------------------------------------------------------------

test('RA0：隔离数据目录（本套件首个测试内设置 env；isolation=none 共享进程下避免跨套件互踩）', () => {
  process.env.V5_PREVIEW_DATA_DIR = dataDir;
  assert.ok(dataDir.length > 0);
});

test('RA1：未配置（端点/模型名/密钥缺失）→ MODEL_NOT_CONFIGURED，列全缺项，不发起调用', async () => {
  const s = setupSession();
  await withModelEnv({}, async () => {
    await assert.rejects(
      () => svc.analyzeAnnotation({ requestId: nextRequestId(), expectedVersion: svc.getRemoteState().remoteVersion, sessionId: s.sessionId, annotationId: s.annotationId }),
      (error) => {
        expectModelerror('MODEL_NOT_CONFIGURED')(error);
        assert.deepEqual([...error.details.missing].sort(), ['JIANWEI_MODEL_API_KEY', 'JIANWEI_MODEL_BASE_URL', 'JIANWEI_MODEL_NAME']);
        return true;
      },
    );
  });
});

test('RA2：已配置但 MODE 未设 real → MODEL_NOT_CONFIGURED（绝不静默降级/升级）', async () => {
  const s = setupSession();
  await withModelEnv({ ...REAL_ENV, JIANWEI_MODEL_MODE: '' }, async () => {
    await assert.rejects(
      () => svc.analyzeAnnotation({ requestId: nextRequestId(), expectedVersion: svc.getRemoteState().remoteVersion, sessionId: s.sessionId, annotationId: s.annotationId }),
      expectModelerror('MODEL_NOT_CONFIGURED'),
    );
  });
  await withModelEnv({ ...REAL_ENV, JIANWEI_MODEL_MODE: 'simulation' }, async () => {
    await assert.rejects(
      () => svc.analyzeAnnotation({ requestId: nextRequestId(), expectedVersion: svc.getRemoteState().remoteVersion, sessionId: s.sessionId, annotationId: s.annotationId }),
      expectModelerror('MODEL_NOT_CONFIGURED'),
    );
  });
});

test('RA3：成功链路（生产组合 transport + 假HTTP边界）→ source=real、model_real 落库、basedOn/usage 如实', async () => {
  const s = setupSession();
  await withModelEnv(REAL_ENV, async () => {
    const capture = { requests: [] };
    const versionBefore = svc.getRemoteState().remoteVersion;
    const response = await svc.analyzeAnnotation(
      { requestId: nextRequestId(), expectedVersion: versionBefore, sessionId: s.sessionId, annotationId: s.annotationId },
      { transport: composedTransport({ sessionId: s.sessionId, annotationId: s.annotationId, evidence: s.evidence, capture }) },
    );
    assert.equal(response.ok, true);
    assert.equal(response.source, 'real');
    assert.deepEqual(response.basedOn, { evidenceVersion: 1, remoteVersion: versionBefore, generation: 0 });
    assert.deepEqual(response.usage, { totalTokens: 165, usageUnknown: false });
    const modelReplies = response.annotation.replies.filter((r) => r.kind === 'model_real');
    assert.ok(modelReplies.length >= 3, `至少声明+发现+追问 3 条，实际 ${modelReplies.length}`);
    assert.ok(modelReplies[0].text.includes('source=real'));
    assert.ok(modelReplies[0].text.includes('真实模型'));
    assert.ok(modelReplies.some((r) => r.text.includes('合成测试疑点')));
    assert.ok(modelReplies.every((r) => r.author.includes('authority=none')));
    // 持久化读回（CONTRACT：保存并刷新读回）
    const detail = svc.getRemoteSessionDetail(s.sessionId);
    const stored = detail.annotations.find((a) => a.annotationId === s.annotationId);
    assert.ok(stored.replies.some((r) => r.kind === 'model_real' && r.text.includes('合成测试疑点')));
    assert.equal(svc.getRemoteState().remoteVersion, versionBefore + 1);
    // 证据正文确实进入发往模型的请求体（CONTRACT §2）
    assert.equal(capture.requests.length, 1);
    assert.equal(capture.requests[0].url, 'https://model.example.invalid/v1/chat/completions');
    assert.equal(capture.requests[0].init.headers.Authorization, 'Bearer sk-test-FAKE-KEY');
    const userContent = JSON.parse(JSON.parse(capture.requests[0].init.body).messages[1].content);
    assert.equal(userContent.context.synthetic, true);
    assert.equal(userContent.context.annotationQuestion, s.question);
    assert.equal(userContent.context.evidence[0].id, s.evidence.evidenceId);
    assert.equal(userContent.context.evidence[0].version, 1);
    assert.equal(JSON.parse(capture.requests[0].init.body).model, 'test-model');
  });
});

test('RA4：enrich 带上人工纠正（business/domain 回复进请求；模型历史回复不回灌）', async () => {
  const s = setupSession();
  await withModelEnv(REAL_ENV, async () => {
    // 第一轮真实分析
    await svc.analyzeAnnotation(
      { requestId: nextRequestId(), expectedVersion: svc.getRemoteState().remoteVersion, sessionId: s.sessionId, annotationId: s.annotationId },
      { transport: composedTransport({ sessionId: s.sessionId, annotationId: s.annotationId, evidence: s.evidence }) },
    );
    // 人工纠正（复用既有记录路径，business 身份）
    write(svc.replyAnnotation, { sessionId: s.sessionId, annotationId: s.annotationId, kind: 'business', text: '人工纠正：客户补充说明设备已于 8 月搬迁至新厂房（合成）。' });
    const capture = { requests: [] };
    await svc.analyzeAnnotation(
      { requestId: nextRequestId(), expectedVersion: svc.getRemoteState().remoteVersion, sessionId: s.sessionId, annotationId: s.annotationId },
      { transport: composedTransport({ sessionId: s.sessionId, annotationId: s.annotationId, evidence: s.evidence, capture }) },
    );
    const userContent = JSON.parse(JSON.parse(capture.requests[0].init.body).messages[1].content);
    assert.ok(userContent.context.humanReplies.some((r) => r.text.includes('8 月搬迁')), '人工纠正必须进入模型请求正文');
    assert.ok(!JSON.stringify(userContent.context).includes('合成测试疑点'), '上一轮模型输出不回灌（避免回声）');
  });
});

test('RA5：同 requestId 重复提交（同载荷原样重试）→ 幂等返回原响应，不重复追加', async () => {
  const s = setupSession();
  await withModelEnv(REAL_ENV, async () => {
    const requestId = nextRequestId();
    const versionBefore = svc.getRemoteState().remoteVersion;
    const body = { requestId, expectedVersion: versionBefore, sessionId: s.sessionId, annotationId: s.annotationId };
    const first = await svc.analyzeAnnotation(body, { transport: composedTransport({ sessionId: s.sessionId, annotationId: s.annotationId, evidence: s.evidence }) });
    const versionAfterFirst = svc.getRemoteState().remoteVersion;
    const second = await svc.analyzeAnnotation(body);
    assert.equal(second.remoteVersion, first.remoteVersion);
    assert.equal(svc.getRemoteState().remoteVersion, versionAfterFirst, '重复请求不得推进版本');
    const stored = svc.getRemoteSessionDetail(s.sessionId).annotations.find((a) => a.annotationId === s.annotationId);
    assert.equal(stored.replies.filter((r) => r.kind === 'model_real' && r.text.includes('source=real')).length, 1, '不重复追加声明回复');
  });
});

test('RA6：transport 失败形态映射 MODEL_CALL_FAILED，且不写库（HTTP错误/非JSON/越权输出/网络异常）', async () => {
  const cases = [
    { name: 'HTTP 500', impl: () => ({ ok: false, sent: true, error: { code: 'PROVIDER_HTTP_500', message: '外部模型服务返回 HTTP 500' } }) },
    { name: '非JSON', impl: () => ({ ok: false, sent: true, error: { code: 'PROVIDER_HTTP_NOT_JSON', message: '外部模型服务响应不是合法 JSON' } }) },
    {
      name: '越权输出',
      impl: (call) => ({ ok: true, sent: true, output: { findings: [{ id: 'F1', text: '审批通过（越权表述）', evidenceRefs: call.payload.evidenceRefs }], questions: [] } }),
    },
    { name: 'transport异常', impl: () => { throw Object.assign(new Error('模型服务网络错误:connection refused'), { code: 'NETWORK_ERROR' }); } },
  ];
  for (const c of cases) {
    const s = setupSession();
    await withModelEnv(REAL_ENV, async () => {
      const versionBefore = svc.getRemoteState().remoteVersion;
      await assert.rejects(
        () => svc.analyzeAnnotation(
          { requestId: nextRequestId(), expectedVersion: versionBefore, sessionId: s.sessionId, annotationId: s.annotationId },
          { transport: scriptedOkTransport({ impl: c.impl }) },
        ),
        expectModelerror('MODEL_CALL_FAILED'),
      );
      assert.equal(svc.getRemoteState().remoteVersion, versionBefore, `${c.name}：失败不得写库`);
      const detail = svc.getRemoteSessionDetail(s.sessionId);
      assert.ok(detail.annotations.find((a) => a.annotationId === s.annotationId).replies.every((r) => r.kind !== 'model_real'), `${c.name}：失败不得冒充结论`);
    });
  }
});

test('RA7：等待期间会话暂停 → MODEL_RESULT_STALE，结果不落库', async () => {
  const s = setupSession();
  await withModelEnv(REAL_ENV, async () => {
    let release;
    const hang = { promise: new Promise((resolve) => { release = resolve; }) };
    const pending = svc.analyzeAnnotation(
      { requestId: nextRequestId(), expectedVersion: svc.getRemoteState().remoteVersion, sessionId: s.sessionId, annotationId: s.annotationId },
      { transport: scriptedOkTransport({ hang }) },
    );
    // 等待期间人工暂停（复用既有复核路径）
    const detail = svc.getRemoteSessionDetail(s.sessionId);
    write(svc.createReview, {
      sessionId: s.sessionId, targetType: 'annotation', targetId: s.annotationId, targetVersion: 1, action: 'pause_round', opinion: 'RA7 暂停（合成）',
    });
    release({ ok: true, sent: true, output: { findings: [{ id: 'F1', text: '迟到的成功结果', evidenceRefs: [] }], questions: [] } });
    await assert.rejects(() => pending, expectModelerror('MODEL_RESULT_STALE'));
    const stored = svc.getRemoteSessionDetail(s.sessionId).annotations.find((a) => a.annotationId === s.annotationId);
    assert.ok(stored.replies.every((r) => !r.text.includes('迟到的成功结果')), '暂停后的迟到结果不得成为有效结论');
  });
});

test('RA8：等待期间人工纠正（store 版本推进）→ 迟到成功结果改判 MODEL_RESULT_STALE', async () => {
  const s = setupSession();
  await withModelEnv(REAL_ENV, async () => {
    let release;
    const hang = { promise: new Promise((resolve) => { release = resolve; }) };
    const versionBefore = svc.getRemoteState().remoteVersion;
    const pending = svc.analyzeAnnotation(
      { requestId: nextRequestId(), expectedVersion: versionBefore, sessionId: s.sessionId, annotationId: s.annotationId },
      { transport: scriptedOkTransport({ hang }) },
    );
    write(svc.replyAnnotation, { sessionId: s.sessionId, annotationId: s.annotationId, kind: 'domain', text: 'RA8 等待期间人工纠正（合成）。' });
    const ref = { id: s.evidence.evidenceId, version: '1', hash: s.evidence.sha256 };
    release({ ok: true, sent: true, output: { findings: [{ id: 'F1', text: '迟到结果（须被拒）', evidenceRefs: [ref] }], questions: [] } });
    await assert.rejects(() => pending, expectModelerror('MODEL_RESULT_STALE'));
    assert.ok(svc.getRemoteState().remoteVersion > versionBefore, '人工纠正已推进版本');
    const stored = svc.getRemoteSessionDetail(s.sessionId).annotations.find((a) => a.annotationId === s.annotationId);
    assert.ok(stored.replies.every((r) => !r.text.includes('迟到结果')), '过期结果不落库');
  });
});

test('RA9：等待期间证据被取代 → MODEL_RESULT_STALE（-1 哨兵触发版本门）', async () => {
  const s = setupSession();
  await withModelEnv(REAL_ENV, async () => {
    let release;
    const hang = { promise: new Promise((resolve) => { release = resolve; }) };
    const pending = svc.analyzeAnnotation(
      { requestId: nextRequestId(), expectedVersion: svc.getRemoteState().remoteVersion, sessionId: s.sessionId, annotationId: s.annotationId },
      { transport: scriptedOkTransport({ hang }) },
    );
    const detail = svc.getRemoteSessionDetail(s.sessionId);
    write(svc.supersedeEvidence, { sessionId: s.sessionId, evidenceId: s.evidence.evidenceId, fixtureId: 'fixture-equipment' });
    release({ ok: true, sent: true, output: { findings: [{ id: 'F1', text: '过期证据上的结果', evidenceRefs: [] }], questions: [] } });
    await assert.rejects(() => pending, (error) => {
      expectModelerror('MODEL_RESULT_STALE')(error);
      return true;
    });
  });
});

test('RA10：getModelConfigStatus 只报布尔/缺项，不泄露密钥值', async () => {
  await withModelEnv(REAL_ENV, () => {
    const status = svc.getModelConfigStatus();
    assert.equal(status.configured, true);
    assert.equal(status.mode, 'real');
    assert.equal(status.keyConfigured, true);
    assert.equal(status.missing.length, 0);
    assert.ok(!JSON.stringify(status).includes('sk-test-FAKE-KEY'), '任何秘密值不得出现在状态对象里');
  });
  await withModelEnv({}, () => {
    const status = svc.getModelConfigStatus();
    assert.equal(status.configured, false);
    assert.equal(status.mode, 'simulation');
    assert.equal(status.missing.length, 3);
  });
});

test('RA11：store 读写兼容——model_real 记录原子落盘后再读不损坏（含旧记录共存）', async () => {
  const s = setupSession();
  await withModelEnv(REAL_ENV, async () => {
    await svc.analyzeAnnotation(
      { requestId: nextRequestId(), expectedVersion: svc.getRemoteState().remoteVersion, sessionId: s.sessionId, annotationId: s.annotationId },
      { transport: scriptedOkTransport() },
    );
    // 模拟通道（旧 kind）与真实记录共存后再读：失败关闭校验不得误伤
    await svc.simulateFollowUps({ requestId: nextRequestId(), expectedVersion: svc.getRemoteState().remoteVersion, sessionId: s.sessionId, annotationId: s.annotationId });
    const detail = svc.getRemoteSessionDetail(s.sessionId);
    const kinds = new Set(detail.annotations.find((a) => a.annotationId === s.annotationId).replies.map((r) => r.kind));
    assert.ok(kinds.has('model_real') && kinds.has('model_simulation'), '两类模型记录共存可读');
  });
});

test('RA11b：F-001 回归——并发同标注 simulate 互不覆盖（两条回复并存、版本一致）', async () => {
  const s = setupSession();
  const detail = svc.getRemoteSessionDetail(s.sessionId);
  write(svc.attachEvidence, { sessionId: s.sessionId, fixtureId: 'fixture-contract' });
  // 并发发起两个不同 requestId 的 simulate（同标注，无既有模拟回复）
  const [a, b] = await Promise.all([
    svc.simulateFollowUps({ requestId: 'dqa-race-a', expectedVersion: svc.getRemoteState().remoteVersion, sessionId: s.sessionId, annotationId: s.annotationId }),
    svc.simulateFollowUps({ requestId: 'dqa-race-b', expectedVersion: svc.getRemoteState().remoteVersion, sessionId: s.sessionId, annotationId: s.annotationId }),
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  const stored = svc.getRemoteSessionDetail(s.sessionId).annotations.find((x) => x.annotationId === s.annotationId);
  const simReplies = stored.replies.filter((r) => r.kind === 'model_simulation');
  // F-001 判别：新实现串行合并 → 版本两次各自推进（旧实现两者同版本且后 persist 者覆盖前者）
  const versions = [a.remoteVersion, b.remoteVersion].sort((x, y) => x - y);
  assert.equal(versions[1] - versions[0], 1, '并发两次写入必须各自基于最新版本推进（无覆盖回退）');
  assert.equal(svc.getRemoteState().remoteVersion, versions[1], '最终 store 版本 = 后落盘者');
  // 后完成者的响应快照包含双方回复；落盘数量与之一致（无一方回复凭空消失）
  const laterCount = Math.max(a.annotation.replies.length, b.annotation.replies.length);
  assert.equal(simReplies.length, laterCount, `并发请求的回复必须并存（预期 ${laterCount}，实际 ${simReplies.length}）`);
});

test('RA12：预算上限（20 次）先到即停 → MODEL_BUDGET_EXHAUSTED（本套件最后执行）', async () => {
  const s = setupSession();
  await withModelEnv(REAL_ENV, async () => {
    const usedBefore = svc.getRealModelCallLedger().length;
    for (let i = usedBefore; i < svc.REAL_MODEL_CALL_BUDGET; i += 1) {
      await svc.analyzeAnnotation(
        { requestId: nextRequestId(), expectedVersion: svc.getRemoteState().remoteVersion, sessionId: s.sessionId, annotationId: s.annotationId },
        { transport: scriptedOkTransport() },
      );
    }
    assert.equal(svc.getRealModelCallLedger().length, svc.REAL_MODEL_CALL_BUDGET);
    await assert.rejects(
      () => svc.analyzeAnnotation(
        { requestId: nextRequestId(), expectedVersion: svc.getRemoteState().remoteVersion, sessionId: s.sessionId, annotationId: s.annotationId },
        { transport: scriptedOkTransport() },
      ),
      expectModelerror('MODEL_BUDGET_EXHAUSTED'),
    );
    const entry = svc.getRealModelCallLedger()[0];
    assert.equal(entry.outcome, 'ok');
    assert.equal(entry.totalTokens, 165);
  });
});

// ---------------------------------------------------------------------------
// http-fetch-interim transport 直接回归（注入 fetchImpl；覆盖 CONTRACT §1 输出/取消/脱敏）
// ---------------------------------------------------------------------------

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('RA13：transport 正常链路——payload+context 进请求体、Authorization 注入、usage 带出', async () => {
  let seenRequest = null;
  const transport = createHttpJsonTransport({
    config: { baseUrl: 'https://model.example.invalid/v1', model: 'test-model', getApiKey: () => 'sk-test-FAKE-KEY' },
    fetchImpl: async (url, init) => {
      seenRequest = { url, init };
      return jsonResponse({ choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ findings: [{ id: 'F1', text: 'x' }], questions: [] }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
    },
    enrich: () => ({ synthetic: true, annotationQuestion: '问题（合成）' }),
  });
  const result = await transport({ payload: { requestId: 'r1', evidenceRefs: [{ id: 'e1', version: '1', hash: 'h1' }] }, role: 'credit' });
  assert.equal(result.ok, true);
  assert.equal(result.usage.totalTokens, 15);
  assert.equal(seenRequest.url, 'https://model.example.invalid/v1/chat/completions');
  assert.equal(seenRequest.init.headers.Authorization, 'Bearer sk-test-FAKE-KEY');
  const outbound = JSON.parse(seenRequest.init.body);
  assert.equal(outbound.model, 'test-model');
  const userContent = JSON.parse(outbound.messages[1].content);
  assert.equal(userContent.context.synthetic, true, '证据正文必须并入发往模型的载荷');
});

test('RA14：transport 失败与脱敏——错误码映射/非JSON/空内容/配置缺失/取消→indeterminate（B路 http-fetch.mjs 语义）', async () => {
  const secret = 'sk-test-FAKE-KEY';
  const make = (fetchImpl) => createHttpJsonTransport({
    config: { baseUrl: 'https://model.example.invalid/v1', model: 'm', getApiKey: () => secret },
    fetchImpl,
  });

  // 错误体 JSON：code/message 透出（截断），其余字段不倒出
  const httpError = await make(async () => jsonResponse({
    error: { code: 'invalid_api_key', message: 'quota exceeded', rawDebug: 'TOPSECRET-RAW' },
  }, 401))({ payload: { evidenceRefs: [] }, role: 'credit' });
  assert.equal(httpError.ok, false);
  assert.equal(httpError.error.code, 'invalid_api_key');
  assert.ok(httpError.error.message.includes('quota exceeded'), 'error.message 是唯一透出通道');
  assert.ok(!JSON.stringify(httpError).includes('TOPSECRET-RAW'), '原始体的其余字段不得回显');
  assert.equal(httpError.httpStatus, 401);

  const notJson = await make(async () => new Response('<html>not json</html>', { status: 200 }))({ payload: { evidenceRefs: [] }, role: 'credit' });
  assert.equal(notJson.error.code, 'SERVER_HTTP_NOT_JSON');

  const emptyContent = await make(async () => jsonResponse({ choices: [] }))({ payload: { evidenceRefs: [] }, role: 'credit' });
  assert.equal(emptyContent.error.code, 'PROVIDER_EMPTY_CONTENT');

  const providerError = await make(async () => jsonResponse({ error: { type: 'server_error', message: 'boom' } }))({ payload: { evidenceRefs: [] }, role: 'credit' });
  assert.equal(providerError.ok, false);
  assert.ok(providerError.error.message.includes('boom'));

  // 配置缺失 → 同步抛出且声明未发送（TRANSPORT_NOT_CONFIGURED）
  const missing = createHttpJsonTransport({ config: {}, fetchImpl: async () => jsonResponse({}) });
  await assert.rejects(
    () => missing({ payload: { evidenceRefs: [] }, role: 'credit' }),
    (error) => error.notSent === true && error.code === 'TRANSPORT_NOT_CONFIGURED',
  );

  // 送出后被取消：ok:'indeterminate'（适配器判 unknown，不谎称未计费；A 路由层归 MODEL_CALL_FAILED）
  const controller = new AbortController();
  const cancelling = make(async (url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
  }));
  const cancelled = cancelling({ payload: { evidenceRefs: [] }, role: 'credit', signal: controller.signal });
  controller.abort();
  assert.deepEqual(await cancelled, { ok: 'indeterminate' });
});
