import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createAssistantModel } from '../src/assistant-model.mjs';
import { createDecisionFeedbackStore, validateDecisionCandidates, validateForecastCandidates } from '../src/decision-feedback-store.mjs';
import { prepareEvidence } from '../src/assistant-evidence.mjs';
import { startEdgeServer } from '../src/server.mjs';
import { createFixtureStore } from '../src/store.mjs';
import { createSessionStore } from '../src/session.mjs';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jw-decisions-'));
  t.after(async () => { assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(dir, { recursive: true, force: true }); });
  const text = '合成客户申请设备回租；开票与经营流水期间不同，需核对期间与重复交易。';
  const hash = createHash('sha256').update(text).digest('hex');
  const state = { hits: 0, prompts: [], permitted: true, onSend: null, invalid: false, drop: false, forecast: null };
  const mock = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    state.hits++;
    const prompt = JSON.parse(raw).messages[0].content; state.prompts.push(prompt);
    const pack = JSON.parse(prompt.split('[服务端获准证据包] ')[1]);
    await state.onSend?.();
    if (state.drop) { req.socket.destroy(); return; }
    const forecast = { targetState: '待补证后复核', conditions: ['补齐列明资料并由有权人员核验'], horizon: '下一次办理步骤' };
    const decisions = state.forecast === 'missing' ? [
      { id: 'branch_1', label: '可能进入补证后复核状态', confidence: .6, impact: '条件成立后阻断是否消除', evidenceRefIds: [pack.snippets[0].id],
        forecast: { targetState: '待补证后复核', conditions: ['补齐列明资料并由有权人员核验'] } },
    ] : state.forecast === 'fakeref' ? [
      { id: 'branch_1', label: '可能进入补证后复核状态', confidence: .6, impact: '条件成立后阻断是否消除', evidenceRefIds: ['invented'], forecast },
    ] : state.forecast ? [
      { id: 'branch_1', label: '可能进入补证后复核状态', confidence: .6, impact: '条件成立后阻断是否消除', evidenceRefIds: [pack.snippets[0].id], forecast },
      { id: 'branch_2', label: '可能按现行材料有条件推进', confidence: .85, impact: '条件成立后进入复核队列', evidenceRefIds: [pack.snippets[0].id],
        forecast: { targetState: '有条件推进', conditions: ['阻断项清零', '有权人员确认'], horizon: '本轮预评估' } },
    ] : [
      { id: 'period', label: '先统一收入期间', confidence: .65, impact: '核对流水与开票起止日期', evidenceRefIds: [pack.snippets[0].id] },
      { id: 'duplicate', label: '先核对重复交易', confidence: .85, impact: '核对同笔收入是否重复计入', evidenceRefIds: [state.invalid ? 'invented' : pack.snippets[0].id] },
      { id: 'review', label: '交专业人员核对', confidence: null, impact: '确认材料口径', evidenceRefIds: [pack.snippets[0].id] },
    ];
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ decisions, observations: [], questions: [] }) } }], usage: { prompt_tokens: 100, completion_tokens: 30 } }));
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  t.after(() => { mock.closeAllConnections(); return new Promise(r => mock.close(r)); });
  const configPath = path.join(dir, 'config.json');
  await fs.writeFile(configPath, JSON.stringify({ transport: { mode: 'mock', mock: { baseUrl: `http://127.0.0.1:${mock.address().port}`, timeoutMs: 500 } }, evidencePolicy: { allowedHashes: [hash] } }));
  const model = await createAssistantModel({ configPath, receiptsDir: dir, requireEvidence: true });
  const store = createFixtureStore();
  const snapshot = { customer: { name: '合成客户' }, admission: { scope: { tenantId: 'tenant' }, inputVersion: 1, cells: [], blockers: [] } };
  store.upsertCustomer('customer', snapshot);
  const evidence = async ({ tenantId, customerId, revision }) => prepareEvidence({ tenantId, customerId, revision, allowedHashes: [hash], materials: [
    { tenantId, customerId, hash, artifactId: 'original', evidenceId: 'evidence', parserVersion: 'test-v1', current: true, text },
  ] });
  const sessions = createSessionStore({});
  const edge = await startEdgeServer({ port: 0, seal: {}, probes: [], store, sessionStore: sessions,
    verifyCredential: async ({ credential }) => ({ ok: true, principalId: credential, roles: credential === 'visitor' ? ['customer'] : ['credit'], tenantId: 'tenant' }),
    auth: async ({ session }) => ({ ok: !!session && state.permitted }), assistantModel: model, assistantEvidence: evidence,
    decisionRepository: createDecisionFeedbackStore(dir) });
  t.after(() => { edge.server.closeAllConnections(); return new Promise(r => edge.server.close(r)); });
  const base = `http://127.0.0.1:${edge.port}`;
  async function login(credential) {
    const r = await fetch(base + '/api/jw/v2/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }) });
    return (await r.json()).session.sessionId;
  }
  const sid = await login('operator');
  async function call(body, suffix = '', token = sid, headers = {}) {
    const r = await fetch(base + (body ? '/api/jw/v2/actions' : '/api/jw/v2') + '/customers/customer/assistant/decisions' + suffix + (body ? '' : '?assistant=credit'), {
      method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-jw-session': token, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, ...(await r.json()) };
  }
  const analyze = (revision = 0, operationId = 'analyze_0001') => call({ assistant: 'credit', operationId, expectedRevision: revision, question: '下一步核对什么？' });
  return { dir, state, store, snapshot, sessions, sid, call, analyze, login };
}

test('candidate schema rejects ungrounded, duplicate and out-of-range values; null confidence remains unknown', () => {
  const c = { id: 'a', label: '核对', impact: '补证', confidence: null, evidenceRefIds: ['ref'] }, pack = { snippets: [{ id: 'ref' }] };
  assert.equal(validateDecisionCandidates([c], pack)[0].confidence, null);
  for (const value of [[c, c], [{ ...c, confidence: 1.01 }], [{ ...c, confidence: NaN }], [{ ...c, evidenceRefIds: [] }], [{ ...c, evidenceRefIds: ['fake'] }]])
    assert.throws(() => validateDecisionCandidates(value, pack), /INVALID_DECISION_OUTPUT/);
});

test('HTTP/model/receipt/feedback: sorted candidates, no default feedback, persistent selection, undo and next analysis sees feedback', async t => {
  const f = await fixture(t);
  const first = await f.analyze();
  assert.equal(first.status, 200); assert.equal(first.latest.current, true); assert.equal(first.latest.candidates[0].id, 'duplicate');
  assert.equal(first.latest.feedback, null); assert.equal(f.state.hits, 1);
  const body = { assistant: 'credit', operationId: 'feedback_0001', expectedRevision: first.revision, decisionSetId: first.latest.id, action: 'select', candidateId: 'period', reason: '先核实期间' };
  const selected = await f.call(body, '/feedback'); assert.equal(selected.latest.feedback.candidateId, 'period');
  const replay = await f.call(body, '/feedback'); assert.equal(replay.revision, selected.revision);
  const stored = await createDecisionFeedbackStore(f.dir).read({ tenantId: 'tenant', customerId: 'customer', principalId: 'operator', assistant: 'credit' });
  assert.equal(stored.latest.feedback.candidateId, 'period');
  assert.equal(stored.events.find(e => e.type === 'analysis_finished').result.candidates[0].confidence, .85);
  const next = await f.analyze(selected.revision, 'analyze_0002');
  assert.equal(f.state.hits, 2); assert.match(f.state.prompts[1], /先核实期间/); assert.equal(next.latest.feedbackUsed, 'feedback:feedback_0001');
  assert.equal(next.latest.feedback, null); // old choice remains a logged input, not fake acceptance of new options
  const none = await f.call({ ...body, decisionSetId: next.latest.id, operationId: 'feedback_0002', expectedRevision: next.revision, action: 'none', candidateId: null }, '/feedback');
  const undo = await f.call({ ...body, decisionSetId: next.latest.id, operationId: 'feedback_0003', expectedRevision: none.revision, action: 'undo', candidateId: null }, '/feedback');
  assert.equal(undo.latest.feedback, null);
  assert.equal((await f.call()).revision, undo.revision);
});

test('authorization, forged candidates, CSRF, stale evidence and concurrent feedback are rejected', async t => {
  const f = await fixture(t); const first = await f.analyze();
  const body = { assistant: 'credit', operationId: 'feedback_0001', expectedRevision: first.revision, decisionSetId: first.latest.id, action: 'select', candidateId: 'period' };
  assert.equal((await f.call({ ...body, candidateId: 'invented' }, '/feedback')).status, 400);
  assert.equal((await f.call(body, '/feedback', await f.login('visitor'))).status, 403);
  assert.equal((await f.call(body, '/feedback', await f.login('other'))).status, 409);
  assert.equal((await f.call(body, '/feedback', f.sid, { origin: 'https://evil.example' })).status, 403);
  const responses = await Promise.all([f.call(body, '/feedback'), f.call({ ...body, operationId: 'feedback_0002', candidateId: 'duplicate' }, '/feedback')]);
  assert.equal(responses.filter(r => r.status === 200).length, 1);
  assert.equal(responses.filter(r => r.status === 409).length, 1);
  f.snapshot.admission.inputVersion++; f.store.upsertCustomer('customer', f.snapshot);
  const stale = await f.call(); assert.equal(stale.latest.current, false); assert.deepEqual(stale.latest.candidates, []);
  assert.equal((await f.call({ ...body, expectedRevision: stale.revision }, '/feedback')).status, 409);
  f.state.permitted = false; assert.equal((await f.call()).status, 403);
});

test('invalid output is not selectable; unknown send survives reload and blocks a new operation without resend', async t => {
  const f = await fixture(t); f.state.invalid = true;
  const invalid = await f.analyze(); assert.equal(invalid.latest.current, false); assert.equal(invalid.latest.model.error, 'INVALID_DECISION_OUTPUT');
  f.state.invalid = false; f.state.drop = true;
  const unknown = await f.analyze(invalid.revision, 'analyze_0002'); assert.ok(unknown.pending); assert.equal(f.state.hits, 2);
  assert.ok((await f.call()).pending);
  assert.equal((await f.analyze(unknown.revision, 'analyze_0003')).status, 409);
  const reconcile = await f.analyze(unknown.revision, 'analyze_0002'); assert.ok(reconcile.pending); assert.equal(f.state.hits, 2);
  f.snapshot.admission.inputVersion++; f.store.upsertCustomer('customer', f.snapshot);
  const changed = await f.analyze(unknown.revision, 'analyze_0002'); assert.ok(changed.pending); assert.equal(f.state.hits, 2);
});

test('revocation during inference does not disclose candidates', async t => {
  const f = await fixture(t); f.state.onSend = () => { f.state.permitted = false; };
  assert.equal((await f.analyze()).status, 403); assert.equal(f.state.hits, 1);
});

test('forecast schema: 缺目标/条件/时间范围、空串、超长、超5条、伪引用均拒绝；合法预测保留结构与边界值', () => {
  const pack = { snippets: [{ id: 'ref' }] };
  const base = { id: 'b1', label: '可能进入补证后复核状态', impact: '条件成立后的预计变化', confidence: null, evidenceRefIds: ['ref'] };
  const ok = { targetState: '待补证后复核', conditions: ['补齐列明资料并由有权人员核验'], horizon: '下一次办理步骤' };
  const one = c => validateForecastCandidates([c], pack)[0];
  assert.deepEqual(one({ ...base, forecast: ok }).forecast, ok);
  assert.equal(one({ ...base, forecast: ok }).confidenceKind, 'model_estimate_uncalibrated');
  for (const bad of [
    { ...base },
    { ...base, forecast: { ...ok, targetState: '' } },
    { ...base, forecast: { ...ok, targetState: '   ' } },
    { ...base, forecast: { ...ok, targetState: 'x'.repeat(241) } },
    { ...base, forecast: { ...ok, conditions: [] } },
    { ...base, forecast: { ...ok, conditions: ['a', 'b', 'c', 'd', 'e', 'f'] } },
    { ...base, forecast: { ...ok, conditions: ['x'.repeat(241)] } },
    { ...base, forecast: { ...ok, conditions: ['  '] } },
    { ...base, forecast: { ...ok, horizon: '' } },
    { ...base, forecast: { ...ok, horizon: 'x'.repeat(121) } },
    { ...base, forecast: { ...ok, horizon: 7 } },
    { ...base, evidenceRefIds: ['fake'], forecast: ok },
    { ...base, id: '非法 id!', forecast: ok },
  ]) assert.throws(() => validateForecastCandidates([bad], pack), /INVALID_DECISION_OUTPUT/, JSON.stringify(bad).slice(0, 60));
  assert.ok(one({ ...base, forecast: { targetState: 'x'.repeat(240), conditions: ['a', 'b', 'c', 'd', 'e'], horizon: 'y'.repeat(120) } }), '边界值240/5条件/120通过');
  assert.deepEqual(one({ ...base, forecast: { targetState: ' 待补证后复核 ', conditions: [' 补齐资料 '], horizon: ' 下一步 ' } }).forecast,
    { targetState: '待补证后复核', conditions: ['补齐资料'], horizon: '下一步' });
  const two = validateForecastCandidates([
    { ...base, id: 'b1', confidence: .5, evidenceRefIds: ['ref', 'ref'], forecast: ok },
    { ...base, id: 'b2', confidence: .9, forecast: { ...ok, targetState: '可能进入有条件推进状态' } },
  ], pack);
  assert.equal(two[0].id, 'b2', '按支持把握降序');
  assert.deepEqual(two[0].evidenceRefIds, ['ref'], '引用去重');
});

test('taskKind: 旧客户端缺省按next_action兼容；未知kind 400且零模型调用；GET投影不回写历史', async t => {
  const f = await fixture(t);
  const first = await f.analyze();
  assert.equal(first.status, 200);
  assert.equal(first.latest.taskKind, 'next_action', '缺kind按next_action投影');
  assert.equal(first.latest.candidates[0].id, 'duplicate', '行动候选契约保持');
  assert.equal((await f.call()).latest.taskKind, 'next_action');
  const bad = await f.call({ assistant: 'credit', operationId: 'analyze_bad01', expectedRevision: first.revision, question: 'q', taskKind: 'path' });
  assert.equal(bad.status, 400);
  assert.equal(bad.error, 'INVALID_TASK_KIND');
  assert.equal(f.state.hits, 1, '未知kind零出站');
});

test('taskKind: path_forecast合法预测保留结构；缺字段/伪引用拒绝不降级；材料变化失效', async t => {
  const f = await fixture(t);
  f.state.forecast = 'ok';
  const fc = await f.call({ assistant: 'credit', operationId: 'forecast_0001', expectedRevision: 0, question: '若补齐材料可能进入哪些状态？', taskKind: 'path_forecast' });
  assert.equal(fc.status, 200);
  assert.equal(fc.latest.taskKind, 'path_forecast');
  assert.equal(fc.latest.candidates[0].id, 'branch_2');
  assert.equal(fc.latest.candidates[0].confidenceKind, 'model_estimate_uncalibrated');
  assert.deepEqual(fc.latest.candidates[0].forecast, { targetState: '有条件推进', conditions: ['阻断项清零', '有权人员确认'], horizon: '本轮预评估' });
  f.state.forecast = 'missing';
  const miss = await f.call({ assistant: 'credit', operationId: 'forecast_0002', expectedRevision: fc.revision, question: '再预测一次', taskKind: 'path_forecast' });
  assert.equal(miss.latest.model.error, 'INVALID_DECISION_OUTPUT');
  assert.equal(miss.latest.valid, false);
  assert.deepEqual(miss.latest.candidates, []);
  f.state.forecast = 'fakeref';
  const fakeRef = await f.call({ assistant: 'credit', operationId: 'forecast_0003', expectedRevision: miss.revision, question: '再预测一次', taskKind: 'path_forecast' });
  assert.equal(fakeRef.latest.model.error, 'INVALID_DECISION_OUTPUT');
  f.snapshot.admission.inputVersion++; f.store.upsertCustomer('customer', f.snapshot);
  const stale = await f.call();
  assert.equal(stale.latest.current, false);
  assert.deepEqual(stale.latest.candidates, []);
  assert.equal(stale.latest.taskKind, 'path_forecast', '失效仍保留kind投影');
});

test('taskKind: 同operationId换kind幂等冲突；未知pending跨kind/跨operationId不重发；反馈按kind隔离；撤权拒绝', async t => {
  const f = await fixture(t);
  const a = await f.analyze(0, 'analyze_0001');
  const fb = { assistant: 'credit', operationId: 'feedback_0001', expectedRevision: a.revision, decisionSetId: a.latest.id, action: 'select', candidateId: 'period', reason: '先核实期间' };
  await f.call(fb, '/feedback');
  const clash = await f.call({ assistant: 'credit', operationId: 'analyze_0001', expectedRevision: a.revision, question: '下一步核对什么？', taskKind: 'path_forecast' });
  assert.equal(clash.status, 409);
  assert.equal(clash.error, 'IDEMPOTENCY_CONFLICT', '同operationId换kind幂等冲突');
  assert.equal(f.state.hits, 1);
  f.state.forecast = 'ok';
  const cur = await f.call();
  const fcst = await f.call({ assistant: 'credit', operationId: 'forecast_0002', expectedRevision: cur.revision, question: '下一步核对什么？', taskKind: 'path_forecast' });
  assert.equal(fcst.status, 200);
  assert.equal(fcst.latest.feedbackUsed, null, '跨kind反馈不混用');
  assert.equal(fcst.latest.feedback, null);
  assert.ok(!f.state.prompts.at(-1).includes('先核实期间'), '预测提示词不带next_action反馈');
  const reverse = await f.call({ assistant: 'credit', operationId: 'forecast_0002', expectedRevision: fcst.revision, question: '下一步核对什么？' });
  assert.equal(reverse.status, 409, 'forecast操作换缺省kind同样冲突');
  const fbf = { ...fb, operationId: 'feedback_0002', expectedRevision: fcst.revision, decisionSetId: fcst.latest.id, candidateId: 'branch_2', reason: '先看条件推进' };
  const fbed = await f.call(fbf, '/feedback');
  f.state.forecast = null;
  const back = await f.analyze(fbed.revision, 'analyze_0005');
  assert.equal(back.latest.feedbackUsed, null, 'next_action不带forecast反馈');
  assert.ok(!f.state.prompts.at(-1).includes('先看条件推进'));
  const replayDone = await f.analyze(0, 'analyze_0005');
  assert.equal(replayDone.replayed, true, '同operationId同kind重放零出站');
  assert.equal(f.state.hits, 3);
  f.state.forecast = 'ok';
  f.state.onSend = () => { f.state.permitted = false; };
  const revoked = await f.call({ assistant: 'credit', operationId: 'forecast_0010', expectedRevision: back.revision, question: '再问一次', taskKind: 'path_forecast' });
  assert.equal(revoked.status, 403, '撤权拒绝且不泄露预测候选');
  assert.equal(f.state.hits, 4);
  f.state.onSend = null; f.state.permitted = true;
  const after = await f.call();
  f.state.drop = true;
  const unknown = await f.call({ assistant: 'credit', operationId: 'forecast_0011', expectedRevision: after.revision, question: '下一步核对什么？', taskKind: 'path_forecast' });
  assert.ok(unknown.pending);
  assert.equal(unknown.pending.taskKind, 'path_forecast');
  const hits = f.state.hits;
  assert.equal((await f.analyze(unknown.revision, 'analyze_0099')).status, 409);
  assert.equal((await f.call({ assistant: 'credit', operationId: 'forecast_0011', expectedRevision: unknown.revision, question: '下一步核对什么？' })).status, 409, 'pending未知时同opId换kind同样阻断');
  assert.equal(f.state.hits, hits, '未知pending无论换kind或operationId都不重发');
});
