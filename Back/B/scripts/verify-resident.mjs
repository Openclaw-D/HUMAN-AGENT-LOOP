#!/usr/bin/env node
// 常驻 worker 端到端自证(评审 03:05 B/D 交接段):被测对象是真实常驻进程
// `node src/cli.mjs worker`,本脚本只做驱动(A/C 的业务事实注入、kill/重启、断言)。
// 场景:
//   T1 正常:goal → 常驻 worker 消费 → A candidate_ready(provider=simulation);
//   T2 kill/重启/unknown:C mock 切 latency → goal 在途 → SIGKILL 常驻进程 →
//      重启(同 dataDir)→ 恢复扫描 → unknown → A fail+clarification 待办;
//      断言零盲重发(C mock 对该项目请求数不增);
//   T3 unknown 闭环:A 人工 resume → GOAL_RESUMED → worker 新 fencing 周期重执行 →
//      candidate_ready(新周期前 C 请求数不增,恰 +1 次且发生在 resume 之后);
//   T4 取消:CLI cancel 标志 → 常驻 worker 步边界取消 → fail 出口 + 人工待办。
// A 不可达 → exit 3 BLOCKED。证据写 evidence/resident-*。

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';

const A_BASE = process.env.A_BASE_URL ?? 'http://127.0.0.1:48080';
const C_PORT = Number(process.env.C_MOCK_PORT ?? 3731);
const C_BASE = `http://127.0.0.1:${C_PORT}`;
const B_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA_DIR = `${B_ROOT}runtime/resident`;
const CONFIG = `${DATA_DIR}/b-config.json`;
const WORKER_LOG = `${DATA_DIR}/worker.log`;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok' : 'not ok'} - ${name}${detail ? ` :: ${detail}` : ''}`);
  return ok;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rawCall(credential, method, path, body) {
  const res = await fetch(`${A_BASE}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), 'x-principal-credential': credential },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

let workerProc = null;
let workerPid = null;
function startWorker(tag) {
  const logFd = openSync(WORKER_LOG, 'a');
  workerProc = spawn(process.execPath, [`${B_ROOT}src/cli.mjs`, 'worker', '--data-dir', DATA_DIR, '--config', CONFIG], {
    cwd: B_ROOT, stdio: ['ignore', logFd, logFd],
  });
  closeSync(logFd);
  workerPid = workerProc.pid;
  console.log(`[driver] worker ${tag} 已启动 pid=${workerPid}`);
}
function killWorker() {
  if (workerPid) { try { process.kill(workerPid, 'SIGKILL'); } catch { /* 已退出 */ } }
  workerProc = null; workerPid = null;
}
async function cConfig(body) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${C_BASE}/__mock__/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return await res.json();
    } catch { await sleep(400); }
  }
  return null;
}
async function cRequests(projectId) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${C_BASE}/__mock__/requests?project=${encodeURIComponent(projectId)}&limit=100`);
      const j = await res.json();
      return j.requests ?? [];
    } catch { await sleep(400); }
  }
  return [];
}
async function goalStatus(goalId, cred = 'tok-agent') {
  const r = await rawCall(cred, 'GET', `/api/v1/goals/${goalId}`);
  return r.goal ?? {};
}
async function waitGoal(goalId, statuses, timeoutMs = 25000) {
  const t0 = Date.now();
  let last = {};
  while (Date.now() - t0 < timeoutMs) {
    last = await goalStatus(goalId);
    if (statuses.includes(last.status)) return last;
    await sleep(400);
  }
  return last;
}

async function main() {
  // 0) 前置
  try {
    const h = await rawCall('tok-admin', 'GET', '/api/v1/health');
    if (!check('S0 A 内核可达', h.ok === true, `db=${h.db}`)) process.exit(3);
  } catch (e) {
    console.log(`BLOCKED: A 不可达 ${e.message};恢复:cd ../A && docker start v7next-a-pg && node scripts/start-kernel.mjs`);
    process.exit(3);
  }
  let cproc = null;
  try {
    await fetch(`${C_BASE}/__mock__/health`, { signal: AbortSignal.timeout(600) });
  } catch {
    cproc = spawn(process.execPath, [fileURLToPath(new URL('../../C/scripts/start-mock.mjs', import.meta.url)), '--port', String(C_PORT)], { stdio: 'ignore', cwd: fileURLToPath(new URL('../../C', import.meta.url)) });
    for (let i = 0; i < 10; i++) { await sleep(500); try { await fetch(`${C_BASE}/__mock__/health`, { signal: AbortSignal.timeout(400) }); break; } catch { /* wait */ } }
  }
  if (!check('S0 C mock 可达', !!(await fetch(`${C_BASE}/__mock__/health`).then((r) => r.json()).catch(() => null))?.ok)) process.exit(3);
  await cConfig({ defaultScenario: 'success', latencyMs: 0 }); // 复位

  // 1) 数据目录 + 先建业务事实(项目)→ 回填 projectFilter → 写配置 → 再启 worker
  await fs.rm(DATA_DIR, { recursive: true, force: true });
  await fs.mkdir(DATA_DIR, { recursive: true });
  const uniq = `rz${Date.now().toString(36)}`;
  const tpl = await rawCall('tok-admin', 'POST', '/api/v1/templates', {
    requestId: `t-${uniq}`, name: `b-resident-${uniq}`, industry: null,
    roles: [{ roleKey: 'business', title: '业务', isHumanRole: true }],
    goals: [
      { goalKey: 'b_review', title: '业务复核', description: 'resident e2e T1', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'business', decisionRole: 'business', inputEvidenceKinds: ['financials'], dependsOn: [], params: {} },
      { goalKey: 'b_review2', title: '业务复核2', description: 'resident e2e T2/T3', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'business', decisionRole: 'business', inputEvidenceKinds: ['financials'], dependsOn: [], params: {} },
      { goalKey: 'b_review3', title: '业务复核3', description: 'resident e2e T4', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'business', decisionRole: 'business', inputEvidenceKinds: ['financials'], dependsOn: [], params: {} },
    ],
  });
  const templateId = tpl.templateId ?? tpl.template?.templateId;
  const proj = await rawCall('tok-business', 'POST', '/api/v1/projects', { requestId: `p-${uniq}`, templateId, name: `b-resident-${uniq}` });
  const projectId = proj.projectId ?? proj.project?.projectId;
  const pv = await rawCall('tok-business', 'GET', `/api/v1/projects/${projectId}`);
  const iv = pv.project?.projectInputVersion ?? 0;
  const ev = await rawCall('tok-business', 'POST', `/api/v1/projects/${projectId}/evidence`, { requestId: `e-${uniq}`, expectedVersion: iv, kind: 'financials', content: { note: 'resident e2e 合成证据' } });
  check('S1 建模板/项目/证据', !!templateId && !!projectId && ev.ok === true, JSON.stringify(ev).slice(0, 100));
  if (!projectId) process.exit(1);

  const sample = JSON.parse(await fs.readFile(`${B_ROOT}config/b-config.http-sample.json`, 'utf8'));
  sample.transport.mock.baseUrl = C_BASE;
  sample.worker.pollIntervalMs = 300;
  // T2/T3/T4 用独立 goalKey(A 每 key 每项目仅一实例,GOAL_EXISTS 幂等防重);路由同 R1 计划
  sample.routes.rules.push(
    { ruleId: 'R-BUSINESS-REVIEW-2', when: { taskKind: 'b_review2' }, plan: [{ stepId: 'model:business:b_review2', kind: 'model', role: 'business', purpose: 'b_review2' }] },
    { ruleId: 'R-BUSINESS-REVIEW-3', when: { taskKind: 'b_review3' }, plan: [{ stepId: 'model:business:b_review3', kind: 'model', role: 'business', purpose: 'b_review3' }] },
  );
  sample.contract.projectFilter = [projectId]; // 只消费本项目(护栏)
  await fs.writeFile(CONFIG, JSON.stringify(sample, null, 2), 'utf8');

  // 2) 常驻 worker R1(先于 goal 创建;游标快进,新 goal 事件才被消费)
  startWorker('R1');
  await sleep(2500);

  // T1 正常
  const g1 = await rawCall('tok-business', 'POST', `/api/v1/projects/${projectId}/goals`, { requestId: `g1-${uniq}`, goalKey: 'b_review' });
  const goal1 = g1.goalId ?? g1.goal?.goalId;
  if (!check('T1 goal1 创建', !!goal1, JSON.stringify(g1).slice(0, 120))) process.exit(1);
  const s1 = await waitGoal(goal1, ['candidate_ready', 'failed', 'waiting_human']);
  check('T1 正常消费→candidate_ready', s1.status === 'candidate_ready', `status=${s1.status}`);
  check('T1 provider=simulation', s1.result?.provider === 'simulation');

  // T2 kill/重启/unknown(恢复对 unknown 持牌待重试:诚实升级待办,不抢先 fail)
  await cConfig({ defaultScenario: 'latency', latencyMs: 9000 });
  const g2 = await rawCall('tok-business', 'POST', `/api/v1/projects/${projectId}/goals`, { requestId: `g2-${uniq}`, goalKey: 'b_review2' });
  const goal2 = g2.goalId ?? g2.goal?.goalId;
  if (!check('T2 goal2 创建', !!goal2, JSON.stringify(g2).slice(0, 120))) process.exit(1);
  const leased = await waitGoal(goal2, ['leased', 'failed'], 10000);
  check('T2 goal2 已被常驻 worker 领取', leased.status === 'leased', `status=${leased.status}`);
  await sleep(1200); // 等模型调用在途(intent 已写、回执未写)
  const cReqsBefore = (await cRequests(projectId)).length;
  const killedPid = workerPid;
  killWorker();
  console.log(`[driver] 已 SIGKILL 常驻 worker(pid=${killedPid},goal2 在途);C 项目内请求=${cReqsBefore}`);
  await sleep(500);
  startWorker('R2'); // 重启(同 dataDir:checkpoint+registry+回执仍在)
  await sleep(3000);
  const s2 = await goalStatus(goal2);
  check('T2 unknown 持牌待重试(goal 留 leased,不冻结不抢跑)', s2.status === 'leased', `status=${s2.status}`);
  const cReqsAfterRecover = (await cRequests(projectId)).length;
  check('T2 零盲重发(恢复期 C 请求数不增)', cReqsAfterRecover === cReqsBefore, `before=${cReqsBefore} after=${cReqsAfterRecover}`);
  const hrs = await rawCall('tok-business', 'GET', `/api/v1/projects/${projectId}/human-requests`);
  const hr2 = (hrs.humanRequests ?? []).find((h) => (h.goalId ?? h.goal_id) === goal2);
  check('T2 clarification 人工待办已建', !!hr2);
  check('T2 待办问题含不可知语义', !!hr2 && /不可知|unknown/.test(hr2.question ?? ''), hr2?.question?.slice(0, 60));

  // T3 DEF-03 精确配方:可信人工 CLI retry_step → 恰一次重发 → A candidate_ready
  const reg2 = JSON.parse(await fs.readFile(`${DATA_DIR}/worker/runs.json`, 'utf8'));
  const heldRunId = Object.keys(reg2).find((k) => k.includes(`:${goal2}:`));
  check('T3 registry 有持牌 run', !!heldRunId, heldRunId);
  // 负例:无凭据 → 拒绝(exit 2),零新增调用
  const negProc = spawn(process.execPath, [`${B_ROOT}src/cli.mjs`, 'resume', heldRunId, 'retry_step', '--step', 'model:business:b_review2', '--data-dir', DATA_DIR, '--config', CONFIG], { cwd: B_ROOT, stdio: 'ignore', env: { ...process.env, B_RESUME_CREDENTIAL: '' } });
  await new Promise((r) => { negProc.on('exit', r); });
  const negCalls = (await cRequests(projectId)).length;
  check('T3 无凭据被拒且零新增调用', negCalls === cReqsBefore, `calls=${negCalls}`);
  // 正例:可信凭据 retry_step(CLI;DEF-03 的重发腿)
  await cConfig({ defaultScenario: 'success', latencyMs: 0 });
  let retryExit = null;
  const retryProc = spawn(process.execPath, [`${B_ROOT}src/cli.mjs`, 'resume', heldRunId, 'retry_step', '--step', 'model:business:b_review2', '--data-dir', DATA_DIR, '--config', CONFIG], {
    cwd: B_ROOT, stdio: 'ignore', env: { ...process.env, B_RESUME_CREDENTIAL: 'cred:boss' },
  });
  await new Promise((r) => { retryProc.on('exit', (c) => { retryExit = c; r(); }); });
  check('T3 授权 retry_step CLI exit 0', retryExit === 0, `exit=${retryExit}`);
  const s3 = await waitGoal(goal2, ['candidate_ready', 'failed'], 40000);
  check('T3 人工恢复后到达 candidate_ready', s3.status === 'candidate_ready', `status=${s3.status}`);
  const cReqsFinal = (await cRequests(projectId)).length;
  check('T3 授权重发恰一次(总调用=1中断+1授权重发)', cReqsFinal === cReqsBefore + 1, `expected=${cReqsBefore + 1} actual=${cReqsFinal}`);
  // 负例:重复授权(已完成)→ 拒绝且零新增调用
  let dupExit = null;
  const dupProc = spawn(process.execPath, [`${B_ROOT}src/cli.mjs`, 'resume', heldRunId, 'retry_step', '--step', 'model:business:b_review2', '--data-dir', DATA_DIR, '--config', CONFIG], {
    cwd: B_ROOT, stdio: 'ignore', env: { ...process.env, B_RESUME_CREDENTIAL: 'cred:boss' },
  });
  await new Promise((r) => { dupProc.on('exit', (c) => { dupExit = c; r(); }); });
  check('T3 重复授权被拒(exit≠0)', dupExit !== 0, `exit=${dupExit}`);
  check('T3 重复授权零新增调用', (await cRequests(projectId)).length === cReqsFinal);

  // T4 取消(CLI 标志 → 常驻 worker 步边界取消)
  await cConfig({ defaultScenario: 'latency', latencyMs: 9000 });
  const g3 = await rawCall('tok-business', 'POST', `/api/v1/projects/${projectId}/goals`, { requestId: `g3-${uniq}`, goalKey: 'b_review3' });
  const goal3 = g3.goalId ?? g3.goal?.goalId;
  if (!check('T4 goal3 创建', !!goal3, JSON.stringify(g3).slice(0, 120))) process.exit(1);
  const leased3 = await waitGoal(goal3, ['leased', 'failed'], 10000);
  check('T4 goal3 已领取', leased3.status === 'leased', `status=${leased3.status}`);
  await sleep(1500); // 等模型调用在途
  const cancelProc = spawn(process.execPath, [`${B_ROOT}src/cli.mjs`, 'cancel', goal3, '--reason', 'T4 评审取消反证', '--data-dir', DATA_DIR, '--config', CONFIG], { cwd: B_ROOT, stdio: 'ignore' });
  await new Promise((r) => { cancelProc.on('exit', r); });
  const s4 = await waitGoal(goal3, ['failed', 'candidate_ready'], 60000);
  check('T4 取消→fail 出口', s4.status === 'failed', `status=${s4.status}`);
  const hrs4 = await rawCall('tok-business', 'GET', `/api/v1/projects/${projectId}/human-requests`);
  const hr4 = (hrs4.humanRequests ?? []).find((h) => (h.goalId ?? h.goal_id) === goal3);
  check('T4 取消产生人工待办', !!hr4);

  // T5 A-resume 腿:failed 目标(取消产物)经 A 人工 resume → 常驻 worker 新周期 → candidate_ready
  await cConfig({ defaultScenario: 'success', latencyMs: 0 });
  const g3cur = await goalStatus(goal3);
  const res5 = await rawCall('tok-business', 'POST', `/api/v1/goals/${goal3}/resume`, { requestId: `rz5-${goal3}`, expectedVersion: g3cur.version });
  check('T5 A resume 受理(failed→ready)', res5.ok === true, JSON.stringify(res5).slice(0, 120));
  const s5 = await waitGoal(goal3, ['candidate_ready', 'failed'], 40000);
  check('T5 新周期→candidate_ready', s5.status === 'candidate_ready', `status=${s5.status}`);

  killWorker();
  if (cproc) cproc.kill();
  await cConfig({ defaultScenario: 'success', latencyMs: 0 });

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n# resident-verify: ${pass}/${results.length} pass`);
  await fs.mkdir(`${B_ROOT}evidence`, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await fs.writeFile(`${B_ROOT}evidence/resident-verify-${stamp}.json`, JSON.stringify({ at: new Date().toISOString(), projectId, results }, null, 2), 'utf8');
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); killWorker(); process.exit(1); });
