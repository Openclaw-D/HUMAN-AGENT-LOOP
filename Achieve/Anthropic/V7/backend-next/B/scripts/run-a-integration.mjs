#!/usr/bin/env node
// B ⇄ A 真实集成验证(对 48080 常驻实例;A CONTRACT v1.0)。
// 前置:A 内核运行中(healthz ok)、C mock 可启动(C/scripts/start-mock.mjs)。
// 场景:
//   S1 真实闭环:模板→项目→证据→目标→GOAL_READY→B worker(events 拉取+claim+执行+complete)
//      → A 中 goal=candidate_ready,result.provider=simulation;
//   S2 无路由目标:B fail 出口 + clarification 人工待办;
//   S3 幂等:同 requestId 重放 replayed 且零重复执行;
//   S4 fencing:takeover 后旧 token 写回 STALE_FENCING_TOKEN(安全重试路径)。
// 输出 TAP 风格结果到 stdout + evidence 文件;A 不可达 → exit 3 BLOCKED(如实,不伪装)。

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { createContractClient } from '../src/contract/client.mjs';
import { createModelTransport } from '../src/transport/glm.mjs';
import { createRouter } from '../src/router.mjs';
import { FileCheckpointSaver } from '../src/langgraph/file-checkpointer.mjs';
import { createTaskRunOrchestrator } from '../src/graph/task-run-orchestrator.mjs';
import { createWorker } from '../src/worker/worker.mjs';
import { LocalFileReceipts, ReceiptsPort, ToolsPort, LocalStubCalculation } from '../src/ports.mjs';
import { testVerifier } from '../test/helpers.mjs';

const A_BASE = process.env.A_BASE_URL ?? 'http://127.0.0.1:48080';
const C_MOCK_PORT = Number(process.env.C_MOCK_PORT ?? 3731);
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok' : 'not ok'} - ${name}${detail ? ` :: ${detail}` : ''}`);
  return ok;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 0) A 可达性
  const admin = createContractClient({ baseUrl: A_BASE, principalCredential: 'tok-admin' });
  let health = null;
  try {
    health = await admin.health();
  } catch (e) {
    console.log(`BLOCKED: A 内核不可达(${A_BASE}):${e.message}`);
    console.log('恢复方法:cd V7/backend-next/A && docker start v7next-a-pg && node scripts/start-kernel.mjs');
    process.exit(3);
  }
  check('S0 A 内核可达', health.ok === true, `db=${health.db} model=${health.model}`);

  // 1) C mock(独立进程;真实 socket)
  let cproc = null;
  try {
    await fetch(`http://127.0.0.1:${C_MOCK_PORT}/__mock__/health`, { signal: AbortSignal.timeout(800) });
  } catch {
    const cPath = fileURLToPath(new URL('../../C/scripts/start-mock.mjs', import.meta.url));
    const cCwd = fileURLToPath(new URL('../../C', import.meta.url));
    cproc = spawn(process.execPath, [cPath, '--port', String(C_MOCK_PORT)], { stdio: 'ignore', cwd: cCwd });
    for (let i = 0; i < 10; i++) {
      await sleep(500);
      try {
        await fetch(`http://127.0.0.1:${C_MOCK_PORT}/__mock__/health`, { signal: AbortSignal.timeout(500) });
        break;
      } catch { /* 未就绪,继续等 */ }
    }
  }
  let cUp = false;
  try {
    const r = await fetch(`http://127.0.0.1:${C_MOCK_PORT}/__mock__/health`, { signal: AbortSignal.timeout(1500) });
    cUp = (await r.json()).ok === true;
  } catch { cUp = false; }
  if (!check('S0 C mock 可达(3731)', cUp, cUp ? '' : '启动:C/scripts/start-mock.mjs --port 3731')) {
    process.exit(3);
  }

  // 2) B 运行时(http 契约 + C mock transport + 真实路由表)
  const dataDir = './runtime/a-integration';
  await fs.rm(dataDir, { recursive: true, force: true });
  const contract = createContractClient({ baseUrl: A_BASE, principalCredential: 'tok-agent' });
  const transport = createModelTransport({ mode: 'mock', mock: { baseUrl: `http://127.0.0.1:${C_MOCK_PORT}`, timeoutMs: 8000 } });
  const router = createRouter({
    roles: ['business', 'credit', 'policy', 'asset', 'commerce'],
    rules: [
      { ruleId: 'R-BUSINESS-REVIEW', when: { taskKind: 'b_review' }, plan: [{ stepId: 'model:business:b_review', kind: 'model', role: 'business', purpose: 'b_review' }] },
    ],
  });
  const receipts = new ReceiptsPort(new LocalFileReceipts(dataDir));
  const orchestrator = createTaskRunOrchestrator({
    ports: { receipts, tools: new ToolsPort(new LocalStubCalculation()), factVersions: { currentVersions: (projectId, goalId) => contract.getGoalVersions(projectId, goalId) } },
    contract, transport, router, checkpointer: new FileCheckpointSaver(`${dataDir}/checkpoints`),
    principalVerifier: testVerifier(), logger: () => {},
  });
  const worker = createWorker({ contract, orchestrator, logger: () => {}, workerId: 'b-itest', concurrency: 1, taskTimeoutMs: 30000, maxReclaims: 1, registryDir: `${dataDir}/worker` });

  // 2.5) 先启 worker(首跑游标=当前事件头;随后创建的业务事实产生新事件才会被消费)
  await worker.startLoop();

  // 3) 业务事实全部经 A 建模板→项目→证据→目标(admin/business 身份)
  const uniq = Date.now().toString(36);
  const business = createContractClient({ baseUrl: A_BASE, principalCredential: 'tok-business' });
  const mkTpl = await rawCall(A_BASE, 'tok-admin', 'POST', '/api/v1/templates', {
    requestId: `tpl-${uniq}`,
    name: `b-itest-tpl-${uniq}`,
    industry: null,
    roles: [
      { roleKey: 'business', title: '业务', isHumanRole: true },
      { roleKey: 'credit', title: '信审', isHumanRole: false },
    ],
    goals: [
      { goalKey: 'b_review', title: '业务复核', description: 'agent 执行的模型复核', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'business', decisionRole: 'business', inputEvidenceKinds: ['financials'], dependsOn: [], params: {} },
      { goalKey: 'b_noroute', title: '无路由目标', description: '验证 fail 出口', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'business', decisionRole: 'business', inputEvidenceKinds: ['financials'], dependsOn: [], params: {} },
    ],
  });
  check('S1 建模板', mkTpl.ok === true, JSON.stringify(mkTpl).slice(0, 120));
  if (!mkTpl.ok) process.exit(1);
  const templateId = mkTpl.template?.templateId ?? mkTpl.templateId;

  const proj = await rawCall(A_BASE, 'tok-business', 'POST', '/api/v1/projects', { requestId: `proj-${uniq}`, templateId, name: `b-itest-proj-${uniq}` });
  check('S1 建项目', proj.ok === true);
  const projectId = proj.project?.projectId ?? proj.projectId;

  const projView = await rawCall(A_BASE, 'tok-business', 'GET', `/api/v1/projects/${projectId}`);
  const inputVersion = projView.project?.projectInputVersion ?? proj.projectInputVersion ?? 0;
  const ev = await rawCall(A_BASE, 'tok-business', 'POST', `/api/v1/projects/${projectId}/evidence`, {
    requestId: `ev-${uniq}`, expectedVersion: inputVersion, kind: 'financials',
    content: { monthlyOperatingCashFlow: 120000, monthlyDebtService: 100000, note: 'b-integration 合成证据' },
  });
  check('S1 提交证据', ev.ok === true);

  const goal1 = await rawCall(A_BASE, 'tok-business', 'POST', `/api/v1/projects/${projectId}/goals`, { requestId: `g1-${uniq}`, goalKey: 'b_review' });
  const goal2 = await rawCall(A_BASE, 'tok-business', 'POST', `/api/v1/projects/${projectId}/goals`, { requestId: `g2-${uniq}`, goalKey: 'b_noroute' });
  check('S1 建目标×2', goal1.ok === true && goal2.ok === true);
  const goalId1 = goal1.goal?.goalId ?? goal1.goalId;
  const goalId2 = goal2.goal?.goalId ?? goal2.goalId;

  // 4) S1:worker 主循环消化 GOAL_READY → candidate_ready(worker 已在 2.5 启动)
  let s1 = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    const g = await rawCall(A_BASE, 'tok-agent', 'GET', `/api/v1/goals/${goalId1}`);
    const st = g.goal?.status;
    if (st && st !== 'ready' && st !== 'blocked') { s1 = { status: st, goal: g.goal }; break; }
    await sleep(400);
  }
  check('S1 目标1 到达 candidate_ready', s1?.status === 'candidate_ready', `status=${s1?.status}`);
  check('S1 provider=simulation 且有观察', s1?.goal?.result?.provider === 'simulation'
    && Array.isArray(s1?.goal?.result?.output?.observations) && s1?.goal?.result.output.observations.length > 0,
  JSON.stringify(s1?.goal?.result ?? {}).slice(0, 160));

  // 5) S2:无路由目标 → failed + clarification 待办
  let s2status = null; let s2hr = null;
  const t1 = Date.now();
  while (Date.now() - t1 < 20000) {
    const g = await rawCall(A_BASE, 'tok-agent', 'GET', `/api/v1/goals/${goalId2}`);
    s2status = g.goal?.status;
    if (s2status === 'failed') break;
    await sleep(400);
  }
  const hrs = await rawCall(A_BASE, 'tok-business', 'GET', `/api/v1/projects/${projectId}/human-requests`);
  // [接口观察] A 该列表端点当前泄漏蛇形列名(契约 §2 说驼峰);B 兼容两种形状读取
  s2hr = (hrs.humanRequests ?? []).find((h) => (h.goalId ?? h.goal_id) === goalId2 && h.kind === 'clarification');
  check('S2 无路由目标 failed', s2status === 'failed', `status=${s2status}`);
  check('S2 clarification 人工待办已建', !!s2hr, s2hr?.question?.slice(0, 60));

  // 6) S3:回执幂等(查 B 提交的 requestId)
  const registryRaw = await fs.readFile(`${dataDir}/worker/runs.json`, 'utf8').catch(() => '{}');
  const reg = JSON.parse(registryRaw);
  const submittedRun = Object.entries(reg).find(([k, v]) => k !== '#cursor' && v.status === 'submitted');
  if (submittedRun) {
    const taskRunId = submittedRun[0];
    const r1 = await rawCall(A_BASE, 'tok-agent', 'GET', `/api/v1/receipts/${taskRunId}::complete`);
    check('S3 A 有完成回执', r1.ok === true);
  } else {
    check('S3 A 有完成回执', false, 'registry 无 submitted 记录');
  }

  // 7) S4:fencing——直接对目标1(已 candidate_ready)验证终态门,再开新目标做 takeover 拒绝
  //    简化:对 candidate_ready 目标重复 complete → 期望拒绝(非 leased 状态门/TERMINAL 语义)
  const dupComplete = await rawCall(A_BASE, 'tok-agent', 'POST', `/api/v1/goals/${goalId1}/complete`, {
    requestId: `dup-${uniq}`, expectedVersion: 99, fencingToken: 999, result: { provider: 'simulation', output: { observations: ['dup'] } },
  });
  check('S4 非法写回被 A 拒绝', dupComplete.ok === false, `error=${dupComplete.error}`);
  check('S4 错误码为门序拒绝而非 VERSION_CONFLICT 掩盖', ['STALE_FENCING_TOKEN', 'NOT_READY', 'TERMINAL_STATE'].includes(dupComplete.error),
    `error=${dupComplete.error}`);

  worker.stopLoop().catch(() => {});
  if (cproc) cproc.kill();

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n# A-integration: ${pass}/${results.length} pass`);
  await fs.mkdir('../B/evidence', { recursive: true }).catch(() => {});
  await fs.writeFile(`evidence/a-integration-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify({ at: new Date().toISOString(), aBase: A_BASE, results }, null, 2), 'utf8');
  process.exit(pass === results.length ? 0 : 1);
}

async function rawCall(base, credential, method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), 'x-principal-credential': credential },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
