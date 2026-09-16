// G4 故障恢复：D-13 API重启持久 / D-14 DB重启持久 / D-12 杀worker恢复（B侧留门） / D-15 checkpoint凭据泄漏（B侧留门）
import { defineSuite, runSuite } from '../harness/runner.mjs';
import * as sutctl from '../harness/sutctl.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { makeApi, ok, pick, reqId, dTemplate, setupProject, projectState, goalState, projectVersion, PRINCIPALS } from '../harness/adapter.mjs';
import { scanMarkers } from '../harness/leakscan.mjs';

const B_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../B');

function discoverWorkerEntry() {
  // 只读探测B的worker入口：package.json scripts.bin/dist 产物
  try {
    const pkg = JSON.parse(readFileSync(path.join(B_ROOT, 'package.json'), 'utf8'));
    const script = pkg.scripts && (pkg.scripts['worker'] || pkg.scripts['start:worker'] || pkg.scripts['start']);
    const bin = pkg.bin && (typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.worker);
    for (const cand of [bin, script && script.split(/\s+/).filter(a => /\.m?js$/.test(a))[0]]) {
      if (!cand) continue;
      const abs = path.join(B_ROOT, cand);
      if (existsSync(abs)) return { cmd: process.execPath, args: [abs], rel: cand };
    }
    for (const guess of ['src/worker/worker.mjs', 'dist/worker.js', 'dist/index.js', 'src/worker.mjs']) {
      if (existsSync(path.join(B_ROOT, guess))) return { cmd: process.execPath, args: [path.join(B_ROOT, guess)], rel: guess };
    }
    if (script) return { cmd: 'npm', args: ['run', script.includes('worker') ? (pkg.scripts['worker'] ? 'worker' : 'start:worker') : 'start'], rel: `script:${script}` };
  } catch { }
  return null;
}

async function sut(ctx) {
  if (!ctx.store.sut) {
    const mockScript = path.join(B_ROOT, '..', 'C', 'scripts', 'start-mock.mjs');
    ctx.store.sut = await sutctl.startSut(ctx, {
      suiteTag: 'g4', apiPort: 17919, leaseSeconds: 30,
      fakeApi: existsSync(mockScript)
        ? { cmd: process.execPath, args: [mockScript, '--port', '17930', '--seed', 'v7d-g4-seed'], cwd: path.join(B_ROOT, '..', 'C'), port: 17930, optional: true }
        : null,
    });
  }
  return ctx.store.sut;
}
// D自有B worker配置与运行时目录（B支持 --config/--data-dir 全覆盖，B源码零写入）
async function bWorkerSetup(ctx, s, { mockBase = 'http://127.0.0.1:17930', extraRules = [], credential = PRINCIPALS.agent } = {}) {
  const fsMod = await import('node:fs');
  const dataDir = path.join(ctx.runDir, 'b-runtime-' + (ctx.store.bRunTag = (ctx.store.bRunTag || 0) + 1));
  fsMod.mkdirSync(dataDir, { recursive: true });
  const cfgDir = path.join(ctx.runDir, 'b-config-' + ctx.store.bRunTag);
  fsMod.mkdirSync(cfgDir, { recursive: true });
  const credMarker = ctx.store.bCredMarker || (ctx.store.bCredMarker = ctx.marker('BKEY'));
  const cfg = {
    transport: {
      mode: 'mock',
      mock: { baseUrl: mockBase, timeoutMs: 8000, model: 'mock-glm-5.2' },
      real: { endpoint: 'http://127.0.0.1:17930/chat/completions', model: 'GLM-5.2', apiKey: credMarker, timeoutMs: 8000, outboundAllow: ['http://127.0.0.1:17930'], cost: { per1kInput: null, per1kOutput: null, currency: 'CNY' } },
    },
    routes: {
      roles: ['policy', 'credit', 'risk', 'asset', 'commerce', 'seekeeper', 'business'],
      rules: [
        { ruleId: 'R-CALC-ONLY', when: { taskKind: 'cash_flow_coverage' }, plan: [{ stepId: 'tool:calc:cash-flow-coverage', kind: 'tool', toolName: 'calc:cash-flow-coverage' }] },
        { ruleId: 'R-CREDIT-REVIEW', when: { taskKind: 'model_review', role: 'credit' }, plan: [{ stepId: 'model:credit:risk_review', kind: 'model', role: 'credit', purpose: 'risk_review' }] },
        ...extraRules,
      ],
    },
    contract: { mode: 'http', baseUrl: s.apiBase, principalCredential: credential },
    identity: { mode: 'synthetic' },
    worker: { workerId: 'v7d-b-worker', concurrency: 2, pollIntervalMs: 300, taskTimeoutMs: 20000, maxReclaims: 1 },
  };
  const cfgPath = path.join(cfgDir, 'b-config.json');
  fsMod.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const cli = path.join(B_ROOT, 'src', 'cli.mjs');
  const spawn = (label, args) => ctx.proc.spawnOwn(label, process.execPath, [cli, ...args, '--data-dir', dataDir, '--config', cfgPath], {
    cwd: B_ROOT, stdoutPath: path.join(ctx.runDir, label + '.log'),
  });
  return { dataDir, cfgPath, credMarker, spawn, cli };
}
// 建立丰富状态：项目+证据+candidate目标+开启的人工待办
async function richState(ctx, api) {
  const a = ctx.assert;
  const { projectId, goals } = await setupProject(api, a, { projectName: 'D-13/14 持久' });
  const ps = await projectState(api, projectId);
  const ev = ok(a, await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('ev'), expectedVersion: ps.version, kind: 'facts', content: { durable: true } }), '证据');
  const gs = await goalState(api, goals.collect);
  const cl = ok(a, await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${goals.collect}/claim`, { requestId: reqId('c'), expectedVersion: gs.version }), 'claim');
  ok(a, await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${goals.collect}/complete`, {
    requestId: reqId('x'), expectedVersion: gs.version + 1, fencingToken: pick(cl, 'fencingToken'),
    result: { provider: 'calculation', output: { persisted: 'yes' } },
  }), 'complete');
  const hr = ok(a, await api.post(`/api/v1/projects/${projectId}/human-requests`, {
    requestId: reqId('hr'), goalId: goals.review, kind: 'decision', question: 'D-13 持久性探针', requestedRole: 'approver',
  }), '人工待办');
  return { projectId, goals, evidenceId: pick(ev, 'evidenceId'), hrequestId: pick(hr, 'hrequestId') };
}

async function mockRequestCount(base) {
  const { makeHttp } = await import('../harness/http.mjs');
  const h = makeHttp(base, { defaultTimeoutMs: 5000 });
  const r = await h('GET', '/__mock__/requests');
  const j = r.json;
  const arr = (j && (j.requests ?? j.items ?? j.list)) || (Array.isArray(j) ? j : []);
  return Array.isArray(arr) ? arr.length : -1;
}
// C mock 在响应完成时才记账：被杀worker的在途请求不会入账 → 按runId过滤才可判定重发次数
async function mockRequestsByRun(base, runId) {
  const { makeHttp } = await import('../harness/http.mjs');
  const h = makeHttp(base, { defaultTimeoutMs: 5000 });
  const r = await h('GET', '/__mock__/requests?limit=200');
  const j = r.json;
  const arr = (j && (j.requests ?? j.items ?? j.list)) || [];
  return Array.isArray(arr) ? arr.filter(e => e && e.runId === runId).length : -1;
}

const suite = defineSuite('g4_recovery', [
  {
    id: 'D-13', title: '杀API重启：目标/待办/证据/回执全量持久，版本不变', severity: 'P0', owner: 'A', timeoutMs: 300000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const st = await richState(ctx, api);
      // 重启前快照
      const before = {
        project: JSON.stringify((await api.get(`/api/v1/projects/${st.projectId}`)).json),
        collect: JSON.stringify((await api.get(`/api/v1/goals/${st.goals.collect}`)).json),
        review: JSON.stringify((await api.get(`/api/v1/goals/${st.goals.review}`)).json),
        hrs: JSON.stringify((await api.get(`/api/v1/projects/${st.projectId}/human-requests`)).json),
      };
      // 杀API进程 → 同参重启
      await s.restartApi();
      await ctx.sleep(300);
      // 全量比对
      const after = {
        project: JSON.stringify((await api.get(`/api/v1/projects/${st.projectId}`)).json),
        collect: JSON.stringify((await api.get(`/api/v1/goals/${st.goals.collect}`)).json),
        review: JSON.stringify((await api.get(`/api/v1/goals/${st.goals.review}`)).json),
        hrs: JSON.stringify((await api.get(`/api/v1/projects/${st.projectId}/human-requests`)).json),
      };
      for (const k of Object.keys(before)) {
        a.eq(after[k], before[k], `重启后${k}投影逐字节一致`, { before: before[k].slice(0, 200), after: after[k].slice(0, 200) });
      }
      const cs = await goalState(api, st.goals.collect);
      a.eq(cs.status, 'candidate_ready', 'candidate态跨重启', { actual: cs.status });
      // 重启后写能力正常
      const ps = await projectState(api, st.projectId);
      ok(a, await api.post(`/api/v1/projects/${st.projectId}/evidence`, { requestId: reqId('post'), expectedVersion: ps.version, kind: 'facts', content: { after: 'restart' } }), '重启后可写');
      // 待办可回应（跨重启的功能完整性）
      ok(a, await api.as(PRINCIPALS.approver).post(`/api/v1/human-requests/${st.hrequestId}/respond`, { requestId: reqId('r'), answer: { text: '重启后回应' } }), '重启后待办可回应');
    },
  },
  {
    id: 'D-14', title: '重启DB容器：数据完整、API自动恢复、新写正常', severity: 'P0', owner: 'A', timeoutMs: 300000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const st = await richState(ctx, api);
      const beforeCollect = JSON.stringify((await api.get(`/api/v1/goals/${st.goals.collect}`)).json);
      // 重启D自有PG容器（v7d-前缀，仅D资源）
      await sutctl.pgctl.restartPg(s.pg.name, { downMs: 2000 });
      // API恢复：health db=up（连接池自动重连）
      const deadline = Date.now() + 45000;
      let h = null;
      while (Date.now() < deadline) {
        h = await api.get('/api/v1/health');
        if (h.json && h.json.ok === true && (pick(h.json, 'db') === 'up' || h.status === 200 && !/down/.test(h.text))) break;
        await ctx.sleep(1000);
      }
      a.ok(h && h.json && h.json.ok === true, 'DB重启后health可达', { status: h && h.status, body: h && h.text.slice(0, 120) });
      a.ok(!/down/.test(h.text || ''), 'db非down', { body: h.text.slice(0, 120) });
      // 数据完整
      const afterCollect = JSON.stringify((await api.get(`/api/v1/goals/${st.goals.collect}`)).json);
      a.eq(afterCollect, beforeCollect, 'DB重启后目标投影逐字节一致');
      // 新写正常
      const ps = await projectState(api, st.projectId);
      ok(a, await api.post(`/api/v1/projects/${st.projectId}/evidence`, { requestId: reqId('postdb'), expectedVersion: ps.version, kind: 'facts', content: { after: 'db-restart' } }), 'DB重启后可写');
    },
  },
  {
    id: 'D-12', title: '运行中杀worker→恢复续跑：已回执步不重执行、unknown零盲重发（B侧）', severity: 'P0', owner: 'B', timeoutMs: 420000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      if (!s.fakeApiProc || s.fakeApiProc.failed) ctx.blocked('C假API未就绪（B transport mock依赖）');
      const bw = await bWorkerSetup(ctx, s);
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      async function mockRequestCount(base) {
  const { makeHttp } = await import('../harness/http.mjs');
  const h = makeHttp(base, { defaultTimeoutMs: 5000 });
  const r = await h('GET', '/__mock__/requests');
  const j = r.json;
  const arr = (j && (j.requests ?? j.items ?? j.list)) || (Array.isArray(j) ? j : []);
  return Array.isArray(arr) ? arr.length : -1;
}
// C mock 在响应完成时才记账：被杀worker的在途请求不会入账 → 按runId过滤才可判定重发次数
async function mockRequestsByRun(base, runId) {
  const { makeHttp } = await import('../harness/http.mjs');
  const h = makeHttp(base, { defaultTimeoutMs: 5000 });
  const r = await h('GET', '/__mock__/requests?limit=200');
  const j = r.json;
  const arr = (j && (j.requests ?? j.items ?? j.list)) || [];
  return Array.isArray(arr) ? arr.filter(e => e && e.runId === runId).length : -1;
}
// 专用单目标模板（worker启动后才实例化，确保事件在游标之后）；calc-only路由（B规则R-CALC-ONLY）
      const tpl = dTemplate({ name: 'D-12 杀worker' });
      tpl.goals = [{
        goalKey: 'cash_flow_coverage', title: '现金流覆盖计算', description: 'B worker端到端任务',
        responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver',
        inputEvidenceKinds: ['facts'], dependsOn: [], params: {},
      }];
      const t = ok(a, await api.post('/api/v1/templates', tpl), '模板');
      const proj = ok(a, await api.post('/api/v1/projects', { requestId: reqId('p'), templateId: pick(t, 'templateId'), name: 'D-12' }), '项目');
      const projectId = pick(proj, 'projectId');
      const goals = {};
      // worker启动（恢复扫描→主循环）
      (ctx.store.bRuntimeDirs ||= []).push(bw.dataDir);
      const wp = await bw.spawn('g4-worker-cli', ['worker']);
      await ctx.sleep(2000);
      if (wp.proc.exitCode !== null) ctx.blocked(`B worker CLI启动即退（exit=${wp.proc.exitCode}），log=g4-worker-cli.log`);
      // 实例化（带taskKind参数）→ 提证 → ready事件 → worker应领取
      const gIns = ok(a, await api.post(`/api/v1/projects/${projectId}/goals`, { requestId: reqId('g-task'), expectedVersion: projectVersion(proj), goalKey: 'cash_flow_coverage', params: { monthlyOperatingCashFlow: 120000, monthlyDebtService: 100000, currency: 'CNY' } }), '实例化calc任务目标（params透传工具确定性输入,契约§2）');
      goals.review = pick(gIns, 'goalId');
      ok(a, await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('ev'), expectedVersion: projectVersion(proj), kind: 'facts', content: { monthlyOperatingCashFlow: 120000, monthlyDebtService: 100000, currency: 'CNY' } }), '提证触发ready（含calc工具输入+币种）');
      const deadline0 = Date.now() + 30000;
      let leased = null;
      while (Date.now() < deadline0) {
        leased = await goalState(api, goals.review);
        if (leased.status === 'leased' || leased.status === 'candidate_ready') break;
        await ctx.sleep(800);
      }
      a.ok(['leased', 'candidate_ready'].includes(leased.status), 'B worker经真实HTTP领取任务', { actual: leased.status, log: 'g4-worker-cli.log' });
      if (leased.status === 'candidate_ready') ctx.log('[D-12] 任务过快完成，kill窗口未捕获——改验证重启后recoverAll幂等');
      // mid-run SIGKILL worker
      await ctx.proc.stopOwn({ pid: wp.pid });
      const killedState = await goalState(api, goals.review);
      ctx.log(`[D-12] kill时状态=${killedState.status}`);
      // 重启worker（recoverAll→续跑）
      const wp2 = await bw.spawn('g4-worker-cli2', ['worker']);
      const deadline = Date.now() + 60000;
      let finalStatus = null;
      while (Date.now() < deadline) {
        finalStatus = (await goalState(api, goals.review)).status;
        if (finalStatus === 'candidate_ready' || finalStatus === 'failed') break;
        await ctx.sleep(1000);
      }
      if (finalStatus !== 'candidate_ready') {
        const gr = await api.get(`/api/v1/goals/${goals.review}`);
        ctx.log('[D-12] 诊断receipts:' + JSON.stringify(pick(gr.json, 'receipts') || gr.json).slice(0, 900));
      }
      a.eq(finalStatus, 'candidate_ready', '杀worker后恢复续跑至candidate_ready', { finalStatus, killedState: killedState.status });
      // 回执无盲重堆积
      const after = await api.get(`/api/v1/goals/${goals.review}`);
      const rc = pick(after.json, 'receiptCount');
      a.ok(typeof rc !== 'number' || rc <= 3, '回执无盲重堆积', { rc });
      // 候选provider标记（mock transport→simulation，D-26 B侧消费验证）
      const prov = pick(after.json, 'provider');
      a.ok(prov === undefined || prov === 'simulation' || prov === 'calculation', '候选provider标记如实', { prov });
      // 停第二worker（避免影响D-15）
      await ctx.proc.stopOwn({ pid: wp2.pid });
    },
  },
  {
    id: 'D-15', title: 'checkpoint与worker存储凭据零泄漏（B侧；A侧审计/事件面已由D-23覆盖）', severity: 'P0', owner: 'B', timeoutMs: 120000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      // 复用D-12的B运行时目录（config内已注入DLEAK假apiKey，mock模式不外发）+ checkpoint落盘
      const dirs = (ctx.store.bRuntimeDirs || []).concat(['runtime'].map(d => path.join(B_ROOT, d)).filter(d => existsSync(d)));
      if (!ctx.store.bRuntimeDirs) {
        // D-12未先跑（单测模式）：快速起worker跑一笔再扫
        ctx.log('[D-15] 单测模式：先跑一笔calc任务生成checkpoint');
        const bw = await bWorkerSetup(ctx, s);
        (ctx.store.bRuntimeDirs ||= []).push(bw.dataDir);
        const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
        const { projectId, goals } = await setupProject(api, a, { projectName: 'D-15 checkpoint' });
        const ps0 = await projectState(api, projectId);
        ok(a, await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('ev'), expectedVersion: ps0.version, kind: 'facts', content: { ok: 1 } }), '提证');
        await api.post(`/api/v1/projects/${projectId}/goals`, { requestId: reqId('g'), expectedVersion: (await projectState(api, projectId)).version, goalKey: 'review', params: { taskKind: 'cash_flow_coverage' } });
        const wp = await bw.spawn('g4-d15-worker', ['worker']);
        await ctx.sleep(12000);
        await ctx.proc.stopOwn({ pid: wp.pid });
      }
      const dirsAll = (ctx.store.bRuntimeDirs || []).concat(['runtime'].map(d => path.join(B_ROOT, d)).filter(d => existsSync(d)));
      a.ok(dirsAll.length > 0, 'B运行时数据目录可得（D自有+产品默认）', { dirs: dirsAll });
      const hits = scanMarkers(dirsAll, [ctx.store.bCredMarker || 'v7d-transport-fake-key-LEAKSCAN-77aa']);
      a.eq(hits.filter(h => /bCred|BKEY/.test(h.marker) || true).length && hits.filter(h => h.marker === (ctx.store.bCredMarker || 'v7d-transport-fake-key-LEAKSCAN-77aa')).length, 0, 'checkpoint/运行时目录零凭据标记', { hits: hits.map(h => h.file + ':' + h.count) });
    },
  },
  {
    id: 'D-12b', title: 'mid-flight击杀：model步8s延迟窗口内SIGKILL→重启→C mock恰收1次调用（零盲重发）+诚实终态', severity: 'P0', owner: 'B', timeoutMs: 420000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      if (!s.fakeApiProc || s.fakeApiProc.failed) ctx.blocked('C假API未就绪');
      // D自有第二C mock实例：latency 8s（制造mid-flight窗口）
      const mockSlow = await ctx.proc.spawnOwn('g4-mock-slow', process.execPath, [
        path.join(B_ROOT, '..', 'C', 'scripts', 'start-mock.mjs'), '--port', '17932', '--seed', 'v7d-g4-kill', '--scenario', 'latency', '--latency-ms', '8000',
      ], {
        cwd: path.join(B_ROOT, '..', 'C'), stdoutPath: path.join(ctx.runDir, 'g4-mock-slow.log'),
        readyProbe: async () => { const { makeHttp } = await import('../harness/http.mjs'); const h = makeHttp('http://127.0.0.1:17932', { defaultTimeoutMs: 2000 }); const r = await h('GET', '/__mock__/health'); return r.status === 200; },
        readyTimeoutMs: 20000,
      });
      const bw = await bWorkerSetup(ctx, s, {
        mockBase: 'http://127.0.0.1:17932',
        extraRules: [{ ruleId: 'R-REVIEW-B', when: { taskKind: 'model_review', role: 'business' }, plan: [{ stepId: 'model:business:risk_review', kind: 'model', role: 'business', purpose: 'risk_review' }] }],
      });
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const tpl = dTemplate({ name: 'D-12b 击杀' });
      tpl.goals = [{ goalKey: 'model_review', title: '模型复核', description: '', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: ['facts'], dependsOn: [], params: {} }];
      const t = ok(a, await api.post('/api/v1/templates', tpl), '模板');
      const proj = ok(a, await api.post('/api/v1/projects', { requestId: reqId('p'), templateId: pick(t, 'templateId'), name: 'D-12b' }), '项目');
      const projectId = pick(proj, 'projectId');
      const wp = await bw.spawn('g4-kill-worker', ['worker']);
      await ctx.sleep(2000);
      if (wp.proc.exitCode !== null) ctx.blocked('B worker CLI启动即退');
      const gIns = ok(a, await api.post(`/api/v1/projects/${projectId}/goals`, { requestId: reqId('g'), expectedVersion: projectVersion(proj), goalKey: 'model_review' }), '实例化model目标');
      const goalId = pick(gIns, 'goalId');
      ok(a, await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('ev'), expectedVersion: projectVersion(proj), kind: 'facts', content: { monthlyOperatingCashFlow: 120000, monthlyDebtService: 100000, currency: 'CNY' } }), '提证');
      // 等model步进入in-flight（C mock延迟8s）
      await ctx.sleep(4000);
      const inFlight = await goalState(api, goalId);
      ctx.log(`[D-12b] 击杀前状态=${inFlight.status}`);
      // SIGKILL worker（请求在途）
      await ctx.proc.stopOwn({ pid: wp.pid });
      const killMockCount = await mockRequestCount('http://127.0.0.1:17932');
      ctx.log(`[D-12b] 击杀时mock收到=${killMockCount}`);
      // 重启worker（recoverAll→投影视图→unknown不自动重发）
      const wp2 = await bw.spawn('g4-kill-worker2', ['worker']);
      await ctx.sleep(20000); // 足够长：若有盲重发，mock计数会涨
      const afterCount = await mockRequestCount('http://127.0.0.1:17932');
      const fin = await goalState(api, goalId);
      ctx.log(`[D-12b] 重启后20s：mock计数${killMockCount}→${afterCount}，goal=${fin.status}`);
      a.eq(afterCount, killMockCount, '零盲重发：重启后C mock收到的模型调用数不增（unknown永不自动重发）', { before: killMockCount, after: afterCount });
      a.ok(['failed', 'candidate_ready', 'waiting_human', 'ready', 'blocked'].includes(fin.status), '诚实终态（不悬挂在leased）', { actual: fin.status });
      a.ok(fin.status !== 'candidate_ready', '中断的model步不得无人工介入变成candidate（unknown不盲重发的一致推论；若实现为checkpoint续跑成功亦记录）', { actual: fin.status });
      await ctx.proc.stopOwn({ pid: wp2.pid });
    },
  },
  {
    id: 'D-27b', title: 'unknown人工恢复端到端：中断→零盲重发→无凭据resume被拒→带凭据retry_step恰一次重发→candidate', severity: 'P0', owner: 'B', timeoutMs: 420000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      if (!s.fakeApiProc || s.fakeApiProc.failed) ctx.blocked('C假API未就绪');
      const mockSlow = await ctx.proc.spawnOwn('g4-mock-slow27', process.execPath, [
        path.join(B_ROOT, '..', 'C', 'scripts', 'start-mock.mjs'), '--port', '17933', '--seed', 'v7d-g4-d27', '--scenario', 'latency', '--latency-ms', '6000',
      ], {
        cwd: path.join(B_ROOT, '..', 'C'), stdoutPath: path.join(ctx.runDir, 'g4-mock-slow27.log'),
        readyProbe: async () => { const { makeHttp } = await import('../harness/http.mjs'); const h = makeHttp('http://127.0.0.1:17933', { defaultTimeoutMs: 2000 }); const r = await h('GET', '/__mock__/health'); return r.status === 200; },
        readyTimeoutMs: 20000,
      });
      const bw = await bWorkerSetup(ctx, s, {
        mockBase: 'http://127.0.0.1:17933',
        extraRules: [{ ruleId: 'R-REVIEW-B', when: { taskKind: 'model_review', role: 'business' }, plan: [{ stepId: 'model:business:risk_review', kind: 'model', role: 'business', purpose: 'risk_review' }] }],
      });
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const tpl = dTemplate({ name: 'D-27b unknown恢复' });
      tpl.goals = [{ goalKey: 'model_review', title: '模型复核', description: '', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: ['facts'], dependsOn: [], params: {} }];
      const t = ok(a, await api.post('/api/v1/templates', tpl), '模板');
      const proj = ok(a, await api.post('/api/v1/projects', { requestId: reqId('p'), templateId: pick(t, 'templateId'), name: 'D-27b' }), '项目');
      const projectId = pick(proj, 'projectId');
      const wp = await bw.spawn('g4-d27-worker', ['worker']);
      await ctx.sleep(2000);
      const gIns = ok(a, await api.post(`/api/v1/projects/${projectId}/goals`, { requestId: reqId('g'), expectedVersion: projectVersion(proj), goalKey: 'model_review' }), '实例化');
      const goalId = pick(gIns, 'goalId');
      ok(a, await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('ev'), expectedVersion: projectVersion(proj), kind: 'facts', content: { monthlyOperatingCashFlow: 120000, monthlyDebtService: 100000, currency: 'CNY' } }), '提证');
      await ctx.sleep(4000);
      await ctx.proc.stopOwn({ pid: wp.pid });
      // 场景1：杀后不结算（不起worker），重启观察期——零盲重发
      const wp2 = await bw.spawn('g4-d27-worker2', ['worker']);
      await ctx.sleep(15000);
      const countAfterRestart = await mockRequestCount('http://127.0.0.1:17933');
      const fin1 = (await goalState(api, goalId)).status;
      ctx.log(`[D-27b] 中断恢复后：mock=${countAfterRestart} goal=${fin1}`);
      a.ok(countAfterRestart <= 1, '恢复后零盲重发（计数≤1）', { countAfterRestart });
      // 场景2（结算前本地恢复）：新目标→kill→租约窗口内带凭据resume→恰一次重发→candidate
      const proj2 = ok(a, await api.post(`/api/v1/projects`, { requestId: reqId('p2'), templateId: pick(t, 'templateId'), name: 'D-27b-2' }), '第二项目（同模板goalKey唯一）');
      const projectId2 = pick(proj2, 'projectId');
      const gIns2 = ok(a, await api.post(`/api/v1/projects/${projectId2}/goals`, { requestId: reqId('g2'), expectedVersion: projectVersion(proj2), goalKey: 'model_review' }), '第二个model目标');
      const goalId2 = pick(gIns2, 'goalId');
      const wpB = await bw.spawn('g4-d27-workerB', ['worker']);
      await ctx.sleep(2000);
      ok(a, await api.post(`/api/v1/projects/${projectId2}/evidence`, { requestId: reqId('ev2'), expectedVersion: projectVersion(proj2), kind: 'facts', content: { monthlyOperatingCashFlow: 90000, monthlyDebtService: 100000, currency: 'CNY' } }), '提证2');
      await ctx.sleep(5000); // workerB领取并进入model步（6s延迟在途）
      await ctx.proc.stopOwn({ pid: wpB.pid }); // 中断（未结算：无其他worker运行recoverAll）
      const runsPath = path.join(bw.dataDir, 'worker', 'runs.json');
      const runs = JSON.parse(readFileSync(runsPath, 'utf8'));
      const entries = Object.entries(runs).filter(([k, v]) => k !== '#cursor' && v.goalId === goalId2);
      const taskRunId = entries[0] && entries[0][0];
      a.ok(taskRunId, 'taskRunId可得（registry）', { taskRunId, all: Object.keys(runs).length });
      const stepId = 'model:business:risk_review';
      const runCli = (envExtra) => spawnSync(process.execPath, [bw.cli, 'resume', taskRunId, 'retry_step', '--step', stepId, '--data-dir', bw.dataDir, '--config', bw.cfgPath], { cwd: B_ROOT, encoding: 'utf8', timeout: 90000, windowsHide: true, env: { ...process.env, ...envExtra } });
      const countBase = await mockRequestCount('http://127.0.0.1:17933');
      // 负向：无凭据 → 拒绝（D-9失败关闭）
      const noCred = runCli({});
      a.ok(noCred.status !== 0 || /被拒绝/.test(noCred.stdout || ''), '无凭据resume被拒（D-9失败关闭）', { status: noCred.status, out: String(noCred.stdout || '').slice(0, 150) });
      const countNoCred = await mockRequestCount('http://127.0.0.1:17933');
      a.eq(countNoCred, countBase, '被拒的resume零副作用', { countNoCred });
      // 正向：带合成人工凭据 → retry_step恰一次重发（6s延迟等待）
      const withCred = runCli({ B_RESUME_CREDENTIAL: 'cred:v7d-human-reviewer' });
      ctx.log(`[D-27b] resume exit=${withCred.status} out=${String(withCred.stdout || '').slice(0, 260)}`);
      await ctx.sleep(3000);
      // 按runId过滤（C在响应完成时才记账，被杀在途请求不入账——总计数会低估）
      const run2Calls = await mockRequestsByRun('http://127.0.0.1:17933', taskRunId);
      a.eq(run2Calls, 1, '人工授权重发恰一次（run2在resume后恰1次真实调用）', { run2Calls });
      const fin2 = await goalState(api, goalId2);
      a.eq(fin2.status, 'candidate_ready', '人工恢复后到达candidate_ready', { actual: fin2.status, version: fin2.version });
      const prov = pick(fin2.json, 'provider');
      a.eq(prov, 'simulation', '候选provider=simulation（真实经mock执行的候选）', { got: prov });
      ctx.log('[D-27b] 最终goal投影:' + String(JSON.stringify(fin2.json)).slice(0, 1200));
    },
  },
]);
runSuite(suite, import.meta.url);
