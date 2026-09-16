// G8 模型网关诚实：D-24 未配置如实拒绝 / D-26 mock-real强标记 / D-25 限额门 / D-27 unknown探针（B侧blocked留门）
// 探针来源：C路假API（D自有子进程实例，端口17930，seed固定）。
import { defineSuite, runSuite } from '../harness/runner.mjs';
import * as sutctl from '../harness/sutctl.mjs';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { makeHttp, verbs } from '../harness/http.mjs';
import { makeApi, ok, errCode, pick, reqId, dTemplate, setupProject, projectState, goalState, goalVersion, projectVersion, PRINCIPALS } from '../harness/adapter.mjs';

const C_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../C');

const B_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../B');
const B_CLI_PATH = path.join(B_ROOT, 'src', 'cli.mjs');
function B_ROOTX() { return B_ROOT; }

// —— D-25 预算反证辅助：D自有配置（含budget段）+ D自有data-dir 的 worker spawn ——
async function bBudgetWorker(ctx, s, { ledgerPath, budget, transportMode = 'mock', preLock = null } = {}) {
  const fsMod = await import('node:fs');
  const tag = 'd25-' + (ctx.store.b25Tag = (ctx.store.b25Tag || 0) + 1);
  const dataDir = path.join(ctx.runDir, 'b25-rt-' + tag);
  fsMod.mkdirSync(dataDir, { recursive: true });
  const cfgDir = path.join(ctx.runDir, 'b25-cfg-' + tag);
  fsMod.mkdirSync(cfgDir, { recursive: true });
  const { PRINCIPAL_TOKEN_SPEC } = await import('../harness/adapter.mjs');
  const spec = process.env.D_PRINCIPAL_SPEC || PRINCIPAL_TOKEN_SPEC;
  const cfg = {
    identity: { mode: 'synthetic' },
    transport: {
      mode: transportMode,
      mock: { baseUrl: mockBase(ctx), timeoutMs: 8000, model: 'mock-glm-5.2' },
      real: { endpoint: 'http://127.0.0.1:17934/chat/completions', model: 'GLM-5.2', apiKey: 'v7d-diag-only', timeoutMs: 8000, outboundAllow: [mockBase(ctx)], cost: { per1kInput: null, per1kOutput: null, currency: 'CNY' } },
      costLogPath: ledgerPath,
      ...(budget ? { budget } : {}),
    },
    routes: {
      roles: ['policy', 'credit', 'risk', 'asset', 'commerce', 'seekeeper', 'business'],
      rules: [{ ruleId: 'R-REVIEW-B', when: { taskKind: 'model_review', role: 'business' }, plan: [{ stepId: 'model:business:risk_review', kind: 'model', role: 'business', purpose: 'risk_review' }] }],
    },
    contract: { mode: 'http', baseUrl: s.apiBase, principalCredential: 'tok-agent' },
    worker: { workerId: 'v7d-b25-' + tag, concurrency: 2, pollIntervalMs: 300, taskTimeoutMs: 20000, maxReclaims: 1 },
  };
  const cfgPath = path.join(cfgDir, 'b-config.json');
  fsMod.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  // 预置 budget.lock（锁安全反证用）：内容 = `<pid> <at> <token>`
  if (preLock) {
    const lockPath = path.join(path.dirname(ledgerPath), 'budget.lock');
    fsMod.writeFileSync(lockPath, `${preLock.pid} ${Date.now()} ${preLock.token || 'deadbeefdeadbeef'}
`);
  }
  return {
    dataDir, cfgPath, cli: B_CLI_PATH,
    spawn: (label, cmd) => ctx.proc.spawnOwn('g8-' + label, process.execPath, [B_CLI_PATH, cmd, '--data-dir', dataDir, '--config', cfgPath], {
      cwd: B_ROOT, stdoutPath: path.join(ctx.runDir, label + '.log'),
    }),
  };
}
// C mock 实例（D自有17934）
async function startSlowMock(ctx, scenario = 'success', latencyMs = 0) {
  const mockScript = path.join(C_ROOT, 'scripts', 'start-mock.mjs');
  if (!existsSync(mockScript)) return { failed: 'C mock script missing' };
  let port = 17934;
  for (let attempt = 0; attempt < 6; attempt++) {
    const logP = path.join(ctx.runDir, `g8-mock${port}.log`);
    try {
      const m = await ctx.proc.spawnOwn(`g8-mock-${port}`, process.execPath, [mockScript, '--port', String(port), '--seed', 'v7d-d25', '--scenario', scenario, '--latency-ms', String(latencyMs)], {
        cwd: C_ROOT, stdoutPath: logP,
        readyProbe: async () => {
          const { makeHttp } = await import('../harness/http.mjs');
          const h = makeHttp(`http://127.0.0.1:${port}`, { defaultTimeoutMs: 2000 });
          const r = await h('GET', '/__mock__/health');
          return r.status === 200;
        },
        readyTimeoutMs: 20000,
      });
      ctx.store.mockPort = port;
      return m;
    } catch (e) {
      let tail = '';
      try { tail = readFileSync(logP, 'utf8').slice(-300); } catch { }
      if (/EADDRINUSE/i.test(tail) && attempt < 5) { port += 1; continue; }
      throw e;
    }
  }
  throw new Error('no free mock port');
}
function mockBase(ctx) { return `http://127.0.0.1:${ctx.store.mockPort || 17934}`; }
async function resetMock(base) {
  const { makeHttp } = await import('../harness/http.mjs');
  const h = makeHttp(base, { defaultTimeoutMs: 5000 });
  await h('POST', '/__mock__/reset');
}
async function mockTotalCalls(base) {
  const { makeHttp } = await import('../harness/http.mjs');
  const h = makeHttp(base, { defaultTimeoutMs: 5000 });
  const r = await h('GET', '/__mock__/requests?limit=200');
  return (r.json && typeof r.json.count === 'number') ? r.json.count : -1;
}
const MOCK_KEY = 'v7d-fake-mock-key-0000000000';

async function sut(ctx) {
  if (!ctx.store.sut) {
    const mockScript = path.join(C_ROOT, 'scripts', 'start-mock.mjs');
    ctx.store.sut = await sutctl.startSut(ctx, {
      suiteTag: 'g8', apiPort: 17918,
      fakeApi: existsSync(mockScript)
        ? { cmd: process.execPath, args: [mockScript, '--port', '17930', '--api-key', MOCK_KEY, '--seed', 'v7d-seed-fixed'], cwd: C_ROOT, port: 17930, optional: true }
        : null,
    });
  }
  return ctx.store.sut;
}
async function candidateGoal(ctx, api) {
  const a = ctx.assert;
  const { projectId, goals } = await setupProject(api, a, { projectName: 'D-8x' });
  const ps = await projectState(api, projectId);
  ok(a, await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('ev'), expectedVersion: ps.version, kind: 'facts', content: { ok: 1 } }), '提证');
  const gs = await goalState(api, goals.collect);
  const cl = ok(a, await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${goals.collect}/claim`, { requestId: reqId('c'), expectedVersion: gs.version }), 'claim');
  return { projectId, goalId: goals.collect, fencing: pick(cl, 'fencingToken'), version: goalVersion(cl) ?? gs.version + 1 };
}

const suite = defineSuite('g8_gateway', [
  {
    id: 'D-24', title: '模型未配置如实拒绝：real_http→409 MODEL_NOT_CONFIGURED；无静默mock成功', severity: 'P0', owner: 'A', timeoutMs: 240000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const h = ok(a, await api.get('/api/v1/health'), 'health');
      a.eq(pick(h, 'model'), 'not_configured', 'health model=not_configured');
      const { goalId, fencing, version } = await candidateGoal(ctx, api);
      const r = await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${goalId}/complete`, {
        requestId: reqId('real'), expectedVersion: version, fencingToken: fencing,
        result: { provider: 'real_http', output: { fabricated: 'would-be model answer' } },
      });
      errCode(a, r, 'MODEL_NOT_CONFIGURED', 'real_http无transport→409 MODEL_NOT_CONFIGURED');
      // 拒绝后目标不变成candidate（无假成功）
      const gs = await goalState(api, goalId);
      a.notEq(gs.status, 'candidate_ready', '未静默mock成功（仍leased）', { actual: gs.status });
      // 正常calculation仍可完成（业务面不受网关未配置影响）
      ok(a, await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${goalId}/complete`, {
        requestId: reqId('calc'), expectedVersion: gs.version, fencingToken: fencing,
        result: { provider: 'calculation', output: { ok: 1 } },
      }), 'calculation路径不受影响');
    },
  },
  {
    id: 'D-26', title: 'mock/real来源强标记：provider字段落库可读；C假API响应带simulation标记头', severity: 'P1', owner: 'A', timeoutMs: 240000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const { goalId, fencing, version } = await candidateGoal(ctx, api);
      ok(a, await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${goalId}/complete`, {
        requestId: reqId('sim'), expectedVersion: version, fencingToken: fencing,
        result: { provider: 'simulation', output: { scripted: 'MOCK_RESPOND_JSON' } },
      }), 'simulation提交');
      const gs = await goalState(api, goalId);
      a.eq(gs.status, 'candidate_ready', 'simulation→candidate_ready', { actual: gs.status });
      const provider = pick(gs.json, 'provider');
      a.eq(provider, 'simulation', 'result.provider=simulation 强标记可读', { got: provider });
      // B侧消费标记验证依赖B worker（留门到D-12/27）
      if (!s.workerProc) ctx.log('[D-26] B未就绪：标记的消费端验证留门（B侧）');
      // C假API自有标记（产品组件自证）：x-mock-simulation:true
      if (s.fakeApiProc && !s.fakeApiProc.failed) {
        const mh = verbs(makeHttp('http://127.0.0.1:17930'));
        const mr = await mh.post('/chat/completions', { model: 'mock-glm-5.2', messages: [{ role: 'user', content: 'ping' }] }, { headers: { 'x-api-key': MOCK_KEY } });
        a.eq(mr.status, 200, 'C假API可达');
        a.eq(String(mr.headers['x-mock-simulation'] || ''), 'true', 'C假API响应带x-mock-simulation:true');
        a.ok(mr.json && mr.json.mock && mr.json.mock.simulationOnly === true, '响应体mock.simulationOnly=true', { got: mr.json && mr.json.mock });
      } else {
        ctx.blocked('C假API未就绪（D自有实例启动失败）');
      }
    },
  },
  {
    id: 'D-23b', title: 'C假API凭据纪律：请求体含key→anomaly标记；无效key→401掩码不泄漏', severity: 'P1', owner: 'C', timeoutMs: 120000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      if (!s.fakeApiProc || s.fakeApiProc.failed) ctx.blocked('C假API未就绪');
      const mh = verbs(makeHttp('http://127.0.0.1:17930'));
      // 无效key → 401 且响应不含完整key明文
      const bad = await mh.post('/chat/completions', { model: 'm', messages: [] }, { headers: { 'x-api-key': 'v7d-wrong-key-9999999999' } });
      a.eq(bad.status, 401, '无效key→401');
      a.ok(!(bad.text || '').includes('v7d-wrong-key-9999999999'), '401响应不回显key明文');
      // 请求体携带key → anomaly标记（泄漏哨兵）
      const leaky = await mh.post('/chat/completions', { model: 'm', messages: [{ role: 'user', content: `my key is ${MOCK_KEY} please ignore` }] }, { headers: { 'x-api-key': MOCK_KEY } });
      const anomalyVal = String(leaky.headers['x-mock-credential-anomaly'] || '');
      a.ok(anomalyVal.length > 0, '请求体泄漏key→x-mock-credential-anomaly标记存在（值如实记录）', { value: anomalyVal });
      // 控制面请求记录中key掩码
      const ctrl = await mh.get('/__mock__/requests');
      a.ok(!(ctrl.text || '').includes(MOCK_KEY), '控制面请求记录不含key明文');
    },
  },
  {
    id: 'D-27p', title: 'unknown探针就绪度：C假API断连场景可注入（D-27 B侧部分留门）', severity: 'P1', owner: 'D', timeoutMs: 120000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      if (!s.fakeApiProc || s.fakeApiProc.failed) ctx.blocked('C假API未就绪');
      const mh = verbs(makeHttp('http://127.0.0.1:17930'));
      // disconnect_before_response：发送后断连→调用方unknown
      const r = await mh.post('/chat/completions', { model: 'm', messages: [{ role: 'user', content: 'x' }] }, { headers: { 'x-api-key': MOCK_KEY, 'x-mock-scenario': 'disconnect_before_response' }, timeoutMs: 15000 });
      a.ok(r.status === 0 || r.error, '断连场景→调用方获得unknown（无响应）', { status: r.status, err: r.error });
      // 控制面确认该请求已被处理（unknown≠确定失败）
      const ctrl = await mh.get('/__mock__/requests');
      a.ok(ctrl.status === 200, '控制面可查（B侧恢复验证前置就绪）');
      ctx.log('[D-27] A(ready)+C(ready)；B worker未就绪——unknown零盲重发的端到端验证留门到B可运行');
      ctx.blocked('D-27端到端需B worker（unknown零盲重发是B执行器行为）；探针就绪度已验证');
    },
  },
  {
    id: 'D-25a', title: '跨进程并发预算门：预算1/1，3 worker同抢3目标→恰1次mock调用，其余诚实失败', severity: 'P0', owner: 'B', timeoutMs: 420000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      if (!ctx.store.mock2734) ctx.store.mock2734 = await startSlowMock(ctx, 'success', 0);
      await resetMock(mockBase(ctx));
      const ledger = path.join(ctx.runDir, 'd25a-ledger.jsonl');
      const bws = [];
      const goalIds = [];
      const pids = [];
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const tpl = dTemplate({ name: 'D-25a 并发预算' });
      tpl.goals = [{ goalKey: 'model_review', title: '模型复核', description: '', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: ['facts'], dependsOn: [], params: {} }];
      const t = ok(a, await api.post('/api/v1/templates', tpl), '模板');
      const tid = pick(t, 'templateId');
      for (let i = 0; i < 3; i++) {
        bws.push(await bBudgetWorker(ctx, s, { ledgerPath: ledger, budget: { maxTotalCost: 1, perCallEstimate: 1, currency: 'CNY' } }));
        const proj = ok(a, await api.post('/api/v1/projects', { requestId: reqId('p' + i), templateId: tid, name: 'D-25a-' + i }), '项目' + i);
        const pid = pick(proj, 'projectId'); pids.push(pid);
        const pv = projectVersion(proj) ?? 1;
        goalIds.push(pick(ok(a, await api.post(`/api/v1/projects/${pid}/goals`, { requestId: reqId('g' + i), expectedVersion: pv, goalKey: 'model_review' }), '目标' + i), 'goalId'));
      }
      // 3 worker同时启动（真跨进程并发），然后近同时产生3笔GOAL_READY
      const workers = [];
      for (let i = 0; i < 3; i++) workers.push(await bws[i].spawn('d25a-worker' + i, 'worker'));
      await ctx.sleep(1500);
      for (let i = 0; i < 3; i++) ok(a, await api.post(`/api/v1/projects/${pids[i]}/evidence`, { requestId: reqId('ev' + i), expectedVersion: (await projectState(api, pids[i])).version, kind: 'facts', content: { i } }), '提证' + i);
      await ctx.sleep(25000);
      const totalCalls = await mockTotalCalls(mockBase(ctx));
      const states = [];
      for (let i = 0; i < 3; i++) states.push((await goalState(api, goalIds[i])).status);
      ctx.log(`[D-25a] states=${states} totalCalls=${totalCalls}`);
      a.eq(totalCalls, 1, '并发预算门：恰1次模型调用（预算1/1，跨进程不绕过）', { totalCalls, states });
      const candCount = states.filter(st => st === 'candidate_ready').length;
      a.ok(candCount >= 1, '恰胜出目标到candidate_ready（若为0且存在事后翻转→DEF-05观察）', { states, candCount });
      a.ok(states.filter(st => st === 'failed').length >= 2, '其余目标诚实失败（BUDGET_EXCEEDED，不悬挂不盲发）', { states });
      for (const w of workers) await ctx.proc.stopOwn({ pid: w.pid });
    },
  },
  {
    id: 'D-25b', title: '账本不可读失败关闭：costLogPath指向目录→0调用+目标诚实失败', severity: 'P0', owner: 'B', timeoutMs: 300000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      if (!ctx.store.mock2734) ctx.store.mock2734 = await startSlowMock(ctx, 'success', 0);
      await resetMock(mockBase(ctx));
      const dirLedger = path.join(ctx.runDir, 'd25b-ledger-dir');
      mkdirSync(dirLedger, { recursive: true });
      const bw = await bBudgetWorker(ctx, s, { ledgerPath: dirLedger, budget: { maxTotalCost: 1, perCallEstimate: 1, currency: 'CNY' } });
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const tpl = dTemplate({ name: 'D-25b 目录账本' });
      tpl.goals = [{ goalKey: 'model_review', title: '模型复核', description: '', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: ['facts'], dependsOn: [], params: {} }];
      const t = ok(a, await api.post('/api/v1/templates', tpl), '模板');
      const proj = ok(a, await api.post('/api/v1/projects', { requestId: reqId('p'), templateId: pick(t, 'templateId'), name: 'D-25b' }), '项目');
      const pid = pick(proj, 'projectId');
      const wp = await bw.spawn('d25b-worker', 'worker');
      await ctx.sleep(1500);
      const gIns = ok(a, await api.post(`/api/v1/projects/${pid}/goals`, { requestId: reqId('g'), expectedVersion: projectVersion(proj), goalKey: 'model_review' }), '目标');
      const goalId = pick(gIns, 'goalId');
      ok(a, await api.post(`/api/v1/projects/${pid}/evidence`, { requestId: reqId('ev'), expectedVersion: projectVersion(proj), kind: 'facts', content: { ok: 1 } }), '提证');
      await ctx.sleep(15000);
      const totalCalls = await mockTotalCalls(mockBase(ctx));
      const fin = await goalState(api, goalId);
      ctx.log(`[D-25b] calls=${totalCalls} goal=${fin.status}`);
      a.eq(totalCalls, 0, '目录账本→0模型调用（失败关闭，不静默放行）', { totalCalls, goal: fin.status });
      a.ok(['failed', 'waiting_human'].includes(fin.status), '目标诚实失败/等待而非candidate', { actual: fin.status });
      await ctx.proc.stopOwn({ pid: wp.pid });
    },
  },
  {
    id: 'D-25c', title: '坏账本失败关闭：损坏行+超限有效行→0调用（不静默跳过放行）', severity: 'P0', owner: 'B', timeoutMs: 300000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      if (!ctx.store.mock2734) ctx.store.mock2734 = await startSlowMock(ctx, 'success', 0);
      await resetMock(mockBase(ctx));
      const ledger = path.join(ctx.runDir, 'd25c-ledger.jsonl');
      writeFileSync(ledger, 'this-is-garbage-not-json\n{"amount": "not-a-number"}\n{"type":"reserve","amount":999}\n');
      const bw = await bBudgetWorker(ctx, s, { ledgerPath: ledger, budget: { maxTotalCost: 1, perCallEstimate: 1, currency: 'CNY' } });
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const tpl = dTemplate({ name: 'D-25c 坏账本' });
      tpl.goals = [{ goalKey: 'model_review', title: '模型复核', description: '', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: ['facts'], dependsOn: [], params: {} }];
      const t = ok(a, await api.post('/api/v1/templates', tpl), '模板');
      const proj = ok(a, await api.post('/api/v1/projects', { requestId: reqId('p'), templateId: pick(t, 'templateId'), name: 'D-25c' }), '项目');
      const pid = pick(proj, 'projectId');
      const wp = await bw.spawn('d25c-worker', 'worker');
      await ctx.sleep(1500);
      const gIns = ok(a, await api.post(`/api/v1/projects/${pid}/goals`, { requestId: reqId('g'), expectedVersion: projectVersion(proj), goalKey: 'model_review' }), '目标');
      const goalId = pick(gIns, 'goalId');
      ok(a, await api.post(`/api/v1/projects/${pid}/evidence`, { requestId: reqId('ev'), expectedVersion: projectVersion(proj), kind: 'facts', content: { ok: 1 } }), '提证');
      await ctx.sleep(15000);
      const totalCalls = await mockTotalCalls(mockBase(ctx));
      const fin = await goalState(api, goalId);
      ctx.log(`[D-25c] calls=${totalCalls} goal=${fin.status}`);
      a.eq(totalCalls, 0, '坏账本（损坏行+超限有效行）→0调用（不静默放行）', { totalCalls, goal: fin.status });
      await ctx.proc.stopOwn({ pid: wp.pid });
    },
  },
  {
    id: 'D-25d', title: '非法预算失败关闭：maxTotalCost为字符串→worker构造即拒绝（exit≠0）且0调用', severity: 'P0', owner: 'B', timeoutMs: 300000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      if (!ctx.store.mock2734) ctx.store.mock2734 = await startSlowMock(ctx, 'success', 0);
      await resetMock(mockBase(ctx));
      const ledger = path.join(ctx.runDir, 'd25d-ledger.jsonl');
      const bw = await bBudgetWorker(ctx, s, { ledgerPath: ledger, budget: { maxTotalCost: '100', perCallEstimate: 1, currency: 'CNY' } });
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const tpl = dTemplate({ name: 'D-25d 非法预算' });
      tpl.goals = [{ goalKey: 'model_review', title: '模型复核', description: '', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: ['facts'], dependsOn: [], params: {} }];
      const t = ok(a, await api.post('/api/v1/templates', tpl), '模板');
      const proj = ok(a, await api.post('/api/v1/projects', { requestId: reqId('p'), templateId: pick(t, 'templateId'), name: 'D-25d' }), '项目');
      const pid = pick(proj, 'projectId');
      const wp = await bw.spawn('d25d-worker', 'worker');
      await ctx.sleep(3000);
      const exited = wp.proc.exitCode;
      a.ok(exited !== null && exited !== 0, '非法预算（字符串maxTotalCost）→worker构造即拒绝退出（失败关闭）', { exit: exited });
      const gIns = await api.post(`/api/v1/projects/${pid}/goals`, { requestId: reqId('g'), expectedVersion: projectVersion(proj), goalKey: 'model_review' });
      if (gIns.json && gIns.json.ok) {
        ok(a, await api.post(`/api/v1/projects/${pid}/evidence`, { requestId: reqId('ev'), expectedVersion: projectVersion(proj), kind: 'facts', content: { ok: 1 } }), '提证');
        await ctx.sleep(10000);
      }
      const totalCalls = await mockTotalCalls(mockBase(ctx));
      a.eq(totalCalls, 0, '非法预算→0模型调用（绝不静默无限额）', { totalCalls });
    },
  },
  {
    id: 'D-25e', title: '预算重启持久：第一笔消耗后重启worker，第二目标BUDGET_EXCEEDED（账本持久不绕过）', severity: 'P0', owner: 'B', timeoutMs: 420000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      if (!ctx.store.mock2734) ctx.store.mock2734 = await startSlowMock(ctx, 'success', 0);
      await resetMock(mockBase(ctx));
      const ledger = path.join(ctx.runDir, 'd25e-ledger.jsonl');
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const tpl = dTemplate({ name: 'D-25e 重启' });
      tpl.goals = [{ goalKey: 'model_review', title: '模型复核', description: '', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: ['facts'], dependsOn: [], params: {} }];
      const t = ok(a, await api.post('/api/v1/templates', tpl), '模板');
      const tid = pick(t, 'templateId');
      const bw = await bBudgetWorker(ctx, s, { ledgerPath: ledger, budget: { maxTotalCost: 1, perCallEstimate: 1, currency: 'CNY' } });
      const mkGoal = async (name) => {
        const proj = ok(a, await api.post('/api/v1/projects', { requestId: reqId('p' + name), templateId: tid, name: 'D-25e-' + name }), '项目' + name);
        const pid = pick(proj, 'projectId');
        const gIns = ok(a, await api.post(`/api/v1/projects/${pid}/goals`, { requestId: reqId('g' + name), expectedVersion: projectVersion(proj), goalKey: 'model_review' }), '目标' + name);
        ok(a, await api.post(`/api/v1/projects/${pid}/evidence`, { requestId: reqId('ev' + name), expectedVersion: projectVersion(proj), kind: 'facts', content: { n: name } }), '提证' + name);
        return pick(gIns, 'goalId');
      };
      const g1 = await mkGoal('A');
      const g2 = await mkGoal('B');
      const wp1 = await bw.spawn('d25e-worker1', 'worker');
      const d1 = Date.now() + 30000;
      let s1 = null;
      while (Date.now() < d1) { s1 = (await goalState(api, g1)).status; if (s1 === 'candidate_ready' || s1 === 'failed') break; await ctx.sleep(800); }
      await ctx.proc.stopOwn({ pid: wp1.pid });
      const wp2 = await bw.spawn('d25e-worker2', 'worker');
      await ctx.sleep(18000);
      const s2 = (await goalState(api, g2)).status;
      const totalCalls = await mockTotalCalls(mockBase(ctx));
      ctx.log(`[D-25e] 重启后 g2=${s2} totalCalls=${totalCalls}`);
      a.eq(totalCalls, 1, '重启不绕过：总调用仍1（账本持久）', { totalCalls });
      const pair = [s1, s2];
      a.eq(pair.filter(st => st === 'candidate_ready').length, 1, '两目标恰1个到candidate（预算1/1的确定性语义；领取顺序非确定）', { pair });
      a.eq(pair.filter(st => st === 'failed').length, 1, '另一目标BUDGET_EXCEEDED诚实失败', { pair });
      await ctx.proc.stopOwn({ pid: wp2.pid });
    },
  },
]);

runSuite(suite, import.meta.url);

runSuite(suite, import.meta.url);
