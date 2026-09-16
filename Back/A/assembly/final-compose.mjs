#!/usr/bin/env node
// final-compose.mjs — A×B×C 最终组合（03:05 监督纠偏版；CONTRACT §6 assembly）：
//   真实消费 B 的常驻 worker（node B/src/cli.mjs worker，只读使用 B 代码）+ C 的 mock transport（C/scripts/start-mock.mjs）
//   在 A 内核（真实 PostgreSQL + HTTP）上完成 4 目标 / 2 角色（business 执行 + approver 人工）场景：
//   - 执行器 = B worker（非 A 自有脚本）：events 拉取 → claim → LangGraph 执行（C mock 真实 socket）→ complete；
//   - 人工客户端 = approver principal：accept/decide/pause/resume/复核确认（UPSTREAM_STALE 门）；
//   - 覆盖：人工暂停 mitigations（无关目标 assess 照常被 B worker 执行）、恢复后 B 重新执行、
//           证据取代 → v1.3 传递 staleness → accept 被复核门拦截 → 显式 ack 放行 → 正式决定。
// 断言全部经 A HTTP 读路径 + 子进程存活；不采信 B 自报。
// 用法：node assembly/final-compose.mjs [--keep] [--watch]（--watch：每 5 分钟比对 B/src 哈希，
//       变化即自动重跑并重锁传递清单——05:00 监督：B 旧 hash 通过不可代替新版）
import { writeFileSync, rmSync, mkdirSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId, startKernel, TOKENS } from '../test/utils.mjs';

const sha256File = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
/** 传递消费清单：组合实际运行的 B/C 源码树逐文件 sha256（05:00 监督要求——旧 hash 通过不替代新版）。 */
function hashTree(root, relPrefix) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const full = path.join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else out.push({ file: `${relPrefix}/${path.relative(root, full).replace(/\\/g, '/')}`, sha256: sha256File(full) });
    }
  };
  walk(root);
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const A_ROOT = path.resolve(__dirname, '..');
const NEXT_ROOT = path.resolve(A_ROOT, '..');
const C_MOCK_PORT = 3735;
const B_CONFIG = path.join(__dirname, '.b-final-config.json');
const B_DATA = path.join(__dirname, '.b-final-runtime');

const results = { startedAt: new Date().toISOString(), steps: [], passed: 0, failed: 0, failures: [] };
const step = async (name, fn) => {
  results.steps.push({ name, status: 'running' });
  try {
    await fn();
    results.steps[results.steps.length - 1].status = 'pass';
    results.passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    results.steps[results.steps.length - 1].status = 'fail';
    results.steps[results.steps.length - 1].error = msg;
    results.failed += 1;
    results.failures.push(`${name}: ${msg}`);
    console.error(`  ✗ ${name}: ${msg}`);
  }
};
const must = (c, m) => { if (!c) throw new Error(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const kernel = await startKernel({ portOffset: 30 });
const base = kernel.base;
console.log(`[final] kernel @ ${base}  db=${kernel.dbName}`);
const call = (token) => async (method, p, body) => {
  const res = await fetch(base + p, {
    method, headers: { 'content-type': 'application/json', 'x-principal-credential': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const admin = call(TOKENS.admin);
const business = call(TOKENS.business);
const human = call(TOKENS.approver);

// C mock（C 路发布产物，只读消费）
console.log('[final] 启动 C mock...');
const cproc = spawn(process.execPath, [path.join(NEXT_ROOT, 'C', 'scripts', 'start-mock.mjs'), '--port', String(C_MOCK_PORT)],
  { cwd: path.join(NEXT_ROOT, 'C'), stdio: 'ignore' });
let cUp = false;
for (let i = 0; i < 20; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${C_MOCK_PORT}/__mock__/health`, { signal: AbortSignal.timeout(500) });
    if ((await r.json()).ok === true) { cUp = true; break; }
  } catch { await sleep(300); }
}
must(cUp, 'C mock 未就绪');

// B 配置（写在 A assembly；消费 B 代码与其 config schema，不写 B/**）
mkdirSync(B_DATA, { recursive: true });
const bConfig = {
  _comment: 'A assembly 最终组合用 B worker 配置（由 A 生成；指向本组合的 A 内核与 C mock）',
  transport: { mode: 'mock', mock: { baseUrl: `http://127.0.0.1:${C_MOCK_PORT}`, timeoutMs: 8000, model: 'mock-glm-5.2' } },
  routes: {
    roles: ['business', 'approver'],
    rules: ['b_intake', 'b_assess', 'b_mitigations', 'b_recommendation'].map((k) => ({
      ruleId: `R-${k}`,
      when: { taskKind: k },
      plan: [{ stepId: `model:business:${k}`, kind: 'model', role: 'business', purpose: k }],
    })),
  },
  contract: { mode: 'http', baseUrl: base, principalCredential: TOKENS.agent, projectFilter: [] },
  identity: { mode: 'synthetic' },
  worker: { workerId: 'b-final-compose', concurrency: 1, pollIntervalMs: 300, taskTimeoutMs: 30000, maxReclaims: 1 },
};
writeFileSync(B_CONFIG, JSON.stringify(bConfig, null, 2));
rmSync(B_DATA, { recursive: true, force: true });

// 启动 B worker（首跑游标=当前事件头，随后产生的事件才会被消费——与 B 集成脚本同序）
console.log('[final] 启动 B worker（真实执行器）...');
const bproc = spawn(process.execPath, [path.join(NEXT_ROOT, 'B', 'src', 'cli.mjs'), 'worker',
  '--config', B_CONFIG, '--data-dir', B_DATA], { cwd: NEXT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
const bLogs = [];
bproc.stdout.on('data', (d) => bLogs.push(d.toString()));
bproc.stderr.on('data', (d) => bLogs.push(d.toString()));
const bAlive = () => bproc.exitCode === null && !bproc.killed;
await sleep(1500); // worker 启动+游标快进
must(bAlive(), `B worker 启动失败：\n${bLogs.join('').slice(-600)}`);

const waitFor = async (goalKey, pred, label, deadlineMs = 90000) => {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const r = await human('GET', `/api/v1/goals/${goalId[goalKey]}`);
    if (pred(r.json.goal)) return r.json.goal;
    await sleep(250);
  }
  throw new Error(`超时等待 ${label}（goalKey=${goalKey}）`);
};

let project, goalId = {};

await step('F1 模板（4目标/2角色）+项目+证据', async () => {
  const tpl = await admin('POST', '/api/v1/templates', {
    requestId: newId('r'), name: 'final-compose', industry: null,
    roles: [
      { roleKey: 'business', title: '业务执行', isHumanRole: false },
      { roleKey: 'approver', title: '验收决定', isHumanRole: true },
    ],
    goals: [
      { goalKey: 'b_intake', title: '受理', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: ['facts'], dependsOn: [], params: {} },
      { goalKey: 'b_assess', title: '评估', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: ['facts'], dependsOn: ['b_intake'], params: {} },
      { goalKey: 'b_mitigations', title: '缓释', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: [], dependsOn: [], params: {} },
      { goalKey: 'b_recommendation', title: '建议', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: [], dependsOn: ['b_assess', 'b_mitigations'], params: {} },
    ],
  });
  must(tpl.status === 200, `模板失败：${JSON.stringify(tpl.json)}`);
  const pr = await business('POST', '/api/v1/projects', { requestId: newId('r'), templateId: tpl.json.templateId, name: 'final-compose-p' });
  project = pr.json.projectId;
  const ev = await business('POST', `/api/v1/projects/${project}/evidence`, { requestId: newId('r'), expectedVersion: 1, kind: 'facts', content: { doc: 'v1' } });
  must(ev.status === 200, '证据失败');
  for (const key of ['b_intake', 'b_assess', 'b_mitigations', 'b_recommendation']) {
    const g = await business('POST', `/api/v1/projects/${project}/goals`, { requestId: newId('r'), goalKey: key });
    must(g.status === 200, `实例化 ${key} 失败`);
    goalId[key] = g.json.goal.goalId;
  }
});

await step('F2 B worker 真实执行：intake/mitigations 被 claim+执行（C mock）+complete→candidate_ready（provider=simulation）', async () => {
  const intake = await waitFor('b_intake', (g) => g.status === 'candidate_ready', 'intake candidate');
  must(intake.result !== null && intake.result.provider === 'simulation', `intake result 来源异常：${JSON.stringify(intake.result)}`);
  must(intake.assignedTo !== null, 'intake 应有 assignee（B worker）');
  must(bAlive(), 'B worker 进程应在运行');
});

await step('F3 人工暂停 mitigations（business 人类岗）→ B worker 不再触碰；assess 链照常推进（无关目标不冻结）', async () => {
  const mit = await human('GET', `/api/v1/goals/${goalId.b_mitigations}`);
  // 暂停要求 responsibleRole 的人类 principal（tok-business=bob，human kind）
  const paused = await business('POST', `/api/v1/goals/${goalId.b_mitigations}/pause`, { requestId: newId('r'), expectedVersion: mit.json.goal.version });
  must(paused.status === 200, `暂停失败：${JSON.stringify(paused.json)}`);
  // 人工验收 intake（approver 验收岗）→ assess 解锁 → B worker 自行执行
  const intakeCur = await human('GET', `/api/v1/goals/${goalId.b_intake}`);
  const acc2 = await human('POST', `/api/v1/goals/${goalId.b_intake}/accept`, { requestId: newId('r'), expectedVersion: intakeCur.json.goal.version });
  must(acc2.status === 200 && acc2.json.status === 'accepted', `intake 验收失败：${JSON.stringify(acc2.json)}`);
  const assess = await waitFor('b_assess', (g) => g.status === 'candidate_ready', 'assess candidate（B worker 执行）');
  must(assess.result !== null, 'assess 无候选');
  const mitAfter = await human('GET', `/api/v1/goals/${goalId.b_mitigations}`);
  must(mitAfter.json.goal.status === 'paused', `mitigations 应保持 paused：${mitAfter.json.goal.status}`);
});

await step('F4 人工恢复 mitigations（business 人类岗）→ B worker 重新领取执行 → candidate_ready', async () => {
  const mit = await human('GET', `/api/v1/goals/${goalId.b_mitigations}`);
  const res = await business('POST', `/api/v1/goals/${goalId.b_mitigations}/resume`, { requestId: newId('r'), expectedVersion: mit.json.goal.version });
  must(res.status === 200, `恢复失败：${JSON.stringify(res.json)}`);
  const mit2 = await waitFor('b_mitigations', (g) => g.status === 'candidate_ready', 'mitigations 恢复后重执行');
  must(mit2.result !== null, 'mitigations 无候选');
  must(bAlive(), 'B worker 应存活');
});

await step('F5 人工验收 assess + mitigations → recommendation 就绪 → B worker 执行', async () => {
  const assess = await human('GET', `/api/v1/goals/${goalId.b_assess}`);
  const acc = await human('POST', `/api/v1/goals/${goalId.b_assess}/accept`, { requestId: newId('r'), expectedVersion: assess.json.goal.version });
  must(acc.status === 200, `assess 验收失败：${JSON.stringify(acc.json)}`);
  const mit = await human('GET', `/api/v1/goals/${goalId.b_mitigations}`);
  const accM = await human('POST', `/api/v1/goals/${goalId.b_mitigations}/accept`, { requestId: newId('r'), expectedVersion: mit.json.goal.version });
  must(accM.status === 200, `mitigations 验收失败：${JSON.stringify(accM.json)}`);
  await waitFor('b_recommendation', (g) => g.status === 'candidate_ready', 'recommendation candidate');
});

await step('F6 DEF-01 v1.3 门（真实场景）：取代 facts → 下游 candidate 验收被 UPSTREAM_STALE 拦截 → 显式复核确认放行', async () => {
  const proj = await business('GET', `/api/v1/projects/${project}`);
  const facts = proj.json.evidence.find((e) => e.kind === 'facts' && e.current);
  const sup = await business('POST', `/api/v1/projects/${project}/evidence/${facts.evidenceId}/supersede`, {
    requestId: newId('r'), expectedVersion: proj.json.project.projectInputVersion, content: { doc: 'v2' },
  });
  must(sup.status === 200, `取代失败：${JSON.stringify(sup.json.json ?? sup.json)}`);
  const intake = await human('GET', `/api/v1/goals/${goalId.b_intake}`);
  must(intake.json.goal.status === 'decided' || intake.json.goal.status === 'accepted', 'intake 状态异常');
  const rec = await human('GET', `/api/v1/goals/${goalId.b_recommendation}`);
  must(rec.json.goal.stale === true, `recommendation 应可见传递 stale：${JSON.stringify(rec.json.goal.stale)}`);
  const gated = await human('POST', `/api/v1/goals/${goalId.b_recommendation}/accept`, { requestId: newId('r'), expectedVersion: rec.json.goal.version });
  must(gated.status === 409 && gated.json.error === 'UPSTREAM_STALE', `应被复核门拦截：${JSON.stringify(gated.json)}`);
  const ack = await human('POST', `/api/v1/goals/${goalId.b_recommendation}/accept`, {
    requestId: newId('r'), expectedVersion: rec.json.goal.version, staleReviewAck: { note: '组合复核：已知悉 intake 依据被取代' },
  });
  must(ack.status === 200 && ack.json.status === 'accepted', `ack 后验收失败：${JSON.stringify(ack.json)}`);
});

await step('F7 intake 正式决定（ack）→ decided 终态；B worker 收尾存活', async () => {
  const intake = await human('GET', `/api/v1/goals/${goalId.b_intake}`);
  const dec = await human('POST', `/api/v1/goals/${goalId.b_intake}/decide`, {
    requestId: newId('r'), expectedVersion: intake.json.goal.version, decision: 'approved', note: '最终组合正式决定',
    staleReviewAck: { note: '正式决定知悉依据取代' },
  });
  must(dec.status === 200 && dec.json.status === 'decided', `决定失败：${JSON.stringify(dec.json)}`);
  must(bAlive(), 'B worker 应存活至收尾');
  bproc.kill('SIGTERM');
  await sleep(800);
});

const proj = await business('GET', `/api/v1/projects/${project}`);
results.finalProjection = proj.json.goals.map((g) => ({ goalKey: g.goalKey, status: g.status, stale: g.stale, executor: 'b-worker', provider: g.result?.provider ?? null }));
// 传递消费清单（交 D 的锁定对象）：B 执行器源码树 + C mock 源码树 + A 生成的 worker 配置
results.consumedArtifacts = {
  bExecutorTree: hashTree(path.join(NEXT_ROOT, 'B', 'src'), 'B/src'),
  cMockTree: hashTree(path.join(NEXT_ROOT, 'C', 'src'), 'C/src').concat([
    { file: 'C/scripts/start-mock.mjs', sha256: sha256File(path.join(NEXT_ROOT, 'C', 'scripts', 'start-mock.mjs')) },
  ]),
  aGeneratedConfig: { file: 'assembly/.b-final-config.json', sha256: sha256File(B_CONFIG) },
  bTransportGlm: { file: 'B/src/transport/glm.mjs', sha256: sha256File(path.join(NEXT_ROOT, 'B', 'src', 'transport', 'glm.mjs')) },
};
results.finishedAt = new Date().toISOString();
// 传递消费清单（交 D 锁定）单独落盘
const cmpManifest = {
  manifestVersion: '1.0.0', kind: 'final-compose 传递消费清单',
  lane: 'V7/backend-next/A assembly', generatedAt: results.finishedAt,
  bTransportGlm: results.consumedArtifacts.bTransportGlm,
  files: [
    ...results.consumedArtifacts.bExecutorTree,
    ...results.consumedArtifacts.cMockTree,
    results.consumedArtifacts.aGeneratedConfig,
  ],
};
writeFileSync(path.join(__dirname, 'final-compose-manifest.json'), JSON.stringify(cmpManifest, null, 2));
results.bWorkerLogTail = bLogs.join('').split('\n').filter(Boolean).slice(-40);
writeFileSync(path.join(__dirname, 'final-compose-result.json'), JSON.stringify(results, null, 2));
console.log(`\n[final] ${results.passed} pass / ${results.failed} fail → assembly/final-compose-result.json`);
console.log('[final] 最终投影：', JSON.stringify(results.finalProjection));
if (results.failed > 0) {
  console.log('[final] B worker 日志尾部：\n' + results.bWorkerLogTail.join('\n'));
  const rejects = kernel.logs.join('').split('\n').filter((l) => l.includes('[reject]'));
  console.log('[final] kernel [reject] 行（最近10条）：\n' + rejects.slice(-10).join('\n'));
  results.kernelRejects = rejects.slice(-10);
}
try { cproc.kill(); } catch { /* 已退 */ }
await kernel.stop();

// --watch：B 预算修复迭代期间，B/src 树哈希变化即自动重跑组合重锁清单（05:00 监督：旧 hash 通过不可代替新版）
if (process.argv.includes('--watch')) {
  const last = JSON.stringify(results.consumedArtifacts.bExecutorTree);
  for (let i = 0; i < 26; i++) { // ~05:15→07:00，每 5 分钟比对
    await sleep(300000);
    const cur = JSON.stringify(hashTree(path.join(NEXT_ROOT, 'B', 'src'), 'B/src'));
    if (cur === last) continue;
    console.log('[watch] B/src 变化 → 重跑组合重锁清单');
    const rerun = spawnSync('node', [path.join(__dirname, 'final-compose.mjs')], { encoding: 'utf8' });
    const tail = (rerun.stdout ?? '').split('\n').filter(Boolean).slice(-2).join(' | ');
    console.log('[watch] 重跑 exit=' + rerun.status + ' ' + tail);
    if (rerun.status !== 0) { console.error('[watch] 重跑失败，停止 watch'); process.exit(1); }
    break; // 重跑已含最新哈希；后续变化由下一轮 watch 捕获
  }
  console.log('[watch] 窗口结束');
}
process.exit(results.failed > 0 ? 1 : 0);
