// 目标执行图(编排器)集成测试:mock transport + 真实落盘回执/checkpoint。
// 覆盖:NO_ROUTE 升级 / 成功链(candidate_ready+模拟标记) / waiting_evidence→provide_evidence 重锚 /
// unknown 零盲重发+显式人工重试 / 陈旧结果丢弃 / 取消语义 / checkpoint 零凭据。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createBRuntime } from '../src/runtime.mjs';
import { createModelTransport } from '../src/transport/glm.mjs';
import { startMockApi, tmpDir, rmDir, testRoutes, testVerifier, sleep } from './helpers.mjs';

async function makeRuntime({ api, dir, verifier = testVerifier(), authorizer }) {
  const rt = createBRuntime({
    dataDir: dir,
    config: {
      transport: api ? { mode: 'mock', mock: { baseUrl: api.baseUrl, timeoutMs: 5000 } } : {},
      routes: testRoutes(),
      contract: { mode: 'stub' },
    },
    overrides: { principalVerifier: verifier, authorizer, logger: () => {} },
  });
  return rt;
}

async function seed(rt, { goalId = 'g1', projectId = 'p1', factVersion = '1', tasks }) {
  for (const t of tasks) {
    await rt.contract.seedGoal({
      goalId: t.taskId, projectId, goalKey: t.taskKind, role: t.role, purpose: t.purpose,
      params: t.inputs ?? {}, inputVersions: { factVersion, ruleVersion: '1' }, version: Number(factVersion),
    });
  }
}

test('NO_ROUTE:未知任务种类 → human_required 终局 + noRoute 标记,零模型调用', async () => {
  const api = await startMockApi({ mode: 'ok' });
  const dir = await tmpDir('graph-noroute-');
  try {
    const rt = await makeRuntime({ api, dir });
    await seed(rt, { tasks: [{ taskId: 't-alien', taskKind: 'alien_kind', role: 'credit' }] });
    const claim = await rt.contract.pollWork({ workerId: 'w' });
    const view = await rt.orchestrator.start({ taskRunId: 'tr:nr', goalId: 't-alien', projectId: 'p1', assignment: claim.assignment, task: claim.task });
    assert.equal(view.state, 'human_required');
    assert.equal(view.terminal.noRoute, true);
    assert.equal(api.requests.length, 0);
  } finally { await api.close(); await rmDir(dir); }
});

test('成功链(model+tool):candidate_ready,模拟整包标记,工具结果入候选', async () => {
  const api = await startMockApi({ mode: 'ok' });
  const dir = await tmpDir('graph-ok-');
  try {
    const rt = await makeRuntime({ api, dir });
    await seed(rt, { tasks: [{ taskId: 't-rc', taskKind: 'review_with_calc', inputs: { monthlyOperatingCashFlow: 120000, monthlyDebtService: 100000, currency: 'CNY' } }] });
    const claim = await rt.contract.pollWork({ workerId: 'w' });
    const view = await rt.orchestrator.start({ taskRunId: 'tr:ok', taskId: 't-rc', goalId: 't-rc', projectId: 'p1', assignment: claim.assignment, task: claim.task });
    assert.equal(view.state, 'completed');
    assert.equal(view.ruleId, 'R-REVIEW-CALC');
    assert.equal(view.candidate.sourceMode, 'simulated'); // 模拟步 → 整包显著标记
    assert.ok(view.candidate.observations.some((o) => o.includes('coverageRatio')));
    assert.equal(view.candidate.authority, 'none');
    assert.equal(api.requests.length, 1); // 恰一次模型调用
  } finally { await api.close(); await rmDir(dir); }
});

test('补证等待:仅提问 → waiting_evidence;provide_evidence 重锚后重跑成功(新 attempt)', async () => {
  // 第一次:服务器返回仅问题;第二次:返回观察
  const api = await startMockApi({ mode: 'ok' });
  let callCount = 0;
  const origHandler = api.server.listeners('request')[0];
  api.server.removeAllListeners('request');
  api.server.on('request', (req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      callCount += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      const mk = (obs, qs) => JSON.stringify({
        model: 'mock-glm-5.2',
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ observations: obs, questions: qs, evidenceRefs: [] }) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        mock: { simulationOnly: true, realModelCapability: false },
      });
      if (callCount === 1) res.end(mk([], ['请补充现金流凭证']));
      else res.end(mk(['ok-2nd'], []));
    });
  });
  void origHandler;
  const dir = await tmpDir('graph-evidence-');
  try {
    const rt = await makeRuntime({ api, dir });
    await seed(rt, { tasks: [{ taskId: 't-ev', taskKind: 'model_review', role: 'credit' }] });
    const claim = await rt.contract.pollWork({ workerId: 'w' });
    const v1 = await rt.orchestrator.start({ taskRunId: 'tr:ev', taskId: 't-ev', goalId: 't-ev', projectId: 'p1', assignment: claim.assignment, task: claim.task });
    assert.equal(v1.state, 'waiting_evidence');
    // provide_evidence(可信身份)→ 重锚定 + 重跑
    const v2 = await rt.orchestrator.resume('tr:ev', {
      principalCredential: 'cred:boss', action: 'provide_evidence',
      payload: { newEvidenceRefs: [{ id: 'e-new', version: '1', hash: 'h' }], newFactVersion: '1' },
    });
    assert.equal(v2.state, 'completed', `v2=${JSON.stringify(v2.terminal)}`);
    assert.equal(v2.generation, 2);
    assert.ok(v2.humanActions[0].principal.principalId === 'boss');
    assert.equal(callCount, 2); // 第二次模型调用发生在显式人工重锚之后
  } finally { await api.close(); await rmDir(dir); }
});

test('unknown 零盲重发:断连 → unknown 中断;显式 retry_step 恰好一次新调用(新 attempt)', async () => {
  const apiBad = await startMockApi({ mode: 'close' });
  const dir = await tmpDir('graph-unknown-');
  try {
    const rt = await makeRuntime({ api: apiBad, dir });
    await seed(rt, { tasks: [{ taskId: 't-un', taskKind: 'model_review', role: 'credit' }] });
    const claim = await rt.contract.pollWork({ workerId: 'w' });
    const v1 = await rt.orchestrator.start({ taskRunId: 'tr:un', taskId: 't-un', goalId: 't-un', projectId: 'p1', assignment: claim.assignment, task: claim.task });
    assert.equal(v1.state, 'unknown');
    assert.equal(v1.steps[0].state, 'unknown');
    // 系统续跑对终局 run 是 no-op(不自动重发)
    const cont = await rt.orchestrator.continueRun('tr:un');
    assert.equal(cont.continued, false);
    // 换好服务,人工显式重试 → 恰好一次新调用,attempt 推进
    const apiGood = await startMockApi({ mode: 'ok' });
    try {
      const rt2 = createBRuntime({
        dataDir: dir, // 同目录:同回执/checkpoint
        config: { transport: { mode: 'mock', mock: { baseUrl: apiGood.baseUrl, timeoutMs: 5000 } }, routes: testRoutes(), contract: { mode: 'stub' } },
        overrides: { principalVerifier: testVerifier(), logger: () => {} },
      });
      const v2 = await rt2.orchestrator.resume('tr:un', { principalCredential: 'cred:boss', action: 'retry_step', stepId: 'model:credit:risk_review' });
      assert.equal(v2.state, 'completed');
      const step = v2.steps[0];
      assert.equal(step.attempt, 1); // 新 attempt
      assert.equal(step.requestId.endsWith('::a1'), true); // 新 requestId
      assert.equal(apiGood.requests.length, 1); // 恰一次,不盲发
    } finally { await apiGood.close(); }
  } finally { await apiBad.close(); await rmDir(dir); }
});

test('陈旧结果丢弃:执行中事实版本变化 → stale,human_required,候选不出', async () => {
  const api = await startMockApi({ mode: 'slow', delayMs: 700 });
  const dir = await tmpDir('graph-stale-');
  try {
    const rt = await makeRuntime({ api, dir });
    await seed(rt, { tasks: [{ taskId: 't-st', taskKind: 'model_review', role: 'credit' }] });
    const claim = await rt.contract.pollWork({ workerId: 'w' });
    // 执行中途(模型调用在途)注入事实版本变化(模拟证据更新失效)
    const startPromise = rt.orchestrator.start({ taskRunId: 'tr:st', taskId: 't-st', goalId: 't-st', projectId: 'p1', assignment: claim.assignment, task: claim.task });
    await sleep(150);
    await rt.contract.seedGoal({ goalId: 't-st', projectId: 'p1', goalKey: 'model_review', version: 2 });
    const view = await startPromise;
    assert.equal(view.state, 'human_required');
    assert.equal(view.terminal.stale, true);
    assert.match(view.terminal.reasonZh, /陈旧结果丢弃/);
    assert.equal(view.candidate, null);
  } finally { await api.close(); await rmDir(dir); }
}, { timeout: 20000 });

test('checkpoint 零凭据:resume 后 checkpoint 文件不含凭据字符串', async () => {
  // 先让运行停在人工门(仅提问→waiting_evidence),再授权 provide_evidence 重跑
  const api = await startMockApi({ mode: 'ok' });
  let callCount = 0;
  api.server.removeAllListeners('request');
  api.server.on('request', (req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      callCount += 1;
      const content = callCount === 1
        ? JSON.stringify({ observations: [], questions: ['请补充凭证'] })
        : JSON.stringify({ observations: ['ok-2nd'], questions: [], evidenceRefs: [] });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'mock-glm-5.2', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    });
  });
  const dir = await tmpDir('graph-cred-');
  try {
    const rt = await makeRuntime({ api, dir });
    await seed(rt, { tasks: [{ taskId: 't-cd', taskKind: 'model_review', role: 'credit' }] });
    const claim = await rt.contract.pollWork({ workerId: 'w' });
    const v1 = await rt.orchestrator.start({ taskRunId: 'tr:cd', taskId: 't-cd', goalId: 't-cd', projectId: 'p1', assignment: claim.assignment, task: claim.task });
    assert.equal(v1.state, 'waiting_evidence', '应停在补证等待(人工门)');
    const secret = 'cred:boss-secret-token-xyz';
    const v2 = await rt.orchestrator.resume('tr:cd', {
      principalCredential: secret, action: 'provide_evidence',
      payload: { newEvidenceRefs: [{ id: 'e', version: '1', hash: 'h' }], newFactVersion: '1' },
    });
    assert.equal(v2.state, 'completed');
    const { fs } = await import('../src/deps.mjs');
    let found = false;
    for (const d of await fs.readdir(`${dir}/checkpoints`, { recursive: true })) {
      const full = `${dir}/checkpoints/${d}`;
      if ((await fs.stat(full)).isFile()) {
        const text = await fs.readFile(full, 'utf8').catch(() => '');
        // base64 序列化也可能带出;检查原文与 base64 两种形态
        if (text.includes(secret) || Buffer.from(secret).toString('base64').slice(0, 20) && text.includes(Buffer.from(secret).toString('base64').slice(0, 20))) found = true;
      }
    }
    assert.equal(found, false, 'checkpoint 中发现凭据');
  } finally { await api.close(); await rmDir(dir); }
});
