#!/usr/bin/env node
// e2e-compose.mjs — A 路最终组合验证（CONTRACT §6 assembly）：
//   4 目标 / 2 角色（business + approver）/ 2 个独立 HTTP 客户端（执行者 agent + 人工 approver）端到端。
//   覆盖：依赖链原子释放、人工待办期间无关目标继续、证据取代定向失效+重绑、正式决定终态、CLI 介入通道。
//   另跑一个非租赁小模板（通用文档审阅）验证核心无行业硬编码。
// 用法：node assembly/e2e-compose.mjs [--keep]（自建隔离内核+测试库，结束后清理并写 assembly/e2e-result.json）
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId, simpleTemplate, startKernel, TOKENS } from '../test/utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const A_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(A_ROOT, 'scripts', 'goal-client.mjs');

const results = { startedAt: new Date().toISOString(), steps: [], passed: 0, failed: 0, failures: [] };
function step(name, fn) {
  results.steps.push({ name, status: 'running' });
  return (async () => {
    try {
      await fn();
      results.steps[results.steps.length - 1].status = 'pass';
      results.passed += 1;
      console.log(`  ✓ ${name}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      results.steps[results.steps.length - 1].status = 'fail';
      results.steps[results.steps.length - 1].error = msg;
      results.failed += 1;
      results.failures.push(`${name}: ${msg}`);
      console.error(`  ✗ ${name}: ${msg}`);
    }
  })();
}
function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

function clientFor(base, token) {
  return async (method, p, body) => {
    const res = await fetch(base + p, {
      method, headers: { 'content-type': 'application/json', 'x-principal-credential': token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
}

/** 组合模板：4 目标（行业无关的"立项评估"泛化流程），2 角色。 */
function composeTemplate() {
  return {
    requestId: newId('tpl'),
    name: 'composition-generic-assessment',
    industry: null,
    roles: [
      { roleKey: 'business', title: '业务执行', isHumanRole: false },
      { roleKey: 'approver', title: '验收决定', isHumanRole: true },
    ],
    goals: [
      { goalKey: 'intake', title: '材料受理', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: ['facts'], dependsOn: [], params: {} },
      { goalKey: 'assess', title: '评估分析', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: ['facts'], dependsOn: ['intake'], params: { depth: 'standard' } },
      { goalKey: 'mitigations', title: '缓释核对', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: [], dependsOn: [], params: {} },
      { goalKey: 'recommendation', title: '综合建议', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: ['facts'], dependsOn: ['assess', 'mitigations'], params: {} },
    ],
  };
}

async function runCli(token, args) {
  const res = spawnSync('node', [CLI, '--base', globalThis.__base, '--token', token, ...args], { encoding: 'utf8' });
  return res.stdout + (res.stderr ?? '');
}

const keep = process.argv.includes('--keep');
const kernel = await startKernel({ portOffset: 5, dispatch: true });
globalThis.__base = kernel.base;
console.log(`[e2e] kernel @ ${kernel.base}  db=${kernel.dbName}`);
const admin = clientFor(kernel.base, TOKENS.admin);
const business = clientFor(kernel.base, TOKENS.business);
// —— 两个独立客户端：执行客户端（agent worker）与人工客户端（approver）——
const executor = clientFor(kernel.base, TOKENS.agent);
const human = clientFor(kernel.base, TOKENS.approver);

let project, goalId = {};

await step('S1 模板与项目创建（admin+business）', async () => {
  const tpl = await admin('POST', '/api/v1/templates', composeTemplate());
  must(tpl.status === 200, `模板创建失败 ${JSON.stringify(tpl.json)}`);
  const pr = await business('POST', '/api/v1/projects', { requestId: newId('r'), templateId: tpl.json.templateId, name: 'composition-e2e' });
  must(pr.status === 200, `项目创建失败 ${JSON.stringify(pr.json)}`);
  project = pr.json.projectId;
});

await step('S2 证据提交与 4 目标实例化（intake/mitigations ready；assess/recommendation blocked）', async () => {
  const ev = await business('POST', `/api/v1/projects/${project}/evidence`, { requestId: newId('r'), expectedVersion: 1, kind: 'facts', content: { doc: 'v1' } });
  must(ev.status === 200, '证据提交失败');
  for (const key of ['intake', 'assess', 'mitigations', 'recommendation']) {
    const g = await business('POST', `/api/v1/projects/${project}/goals`, { requestId: newId('r'), goalKey: key });
    must(g.status === 200, `实例化 ${key} 失败`);
    goalId[key] = g.json.goal.goalId;
    if (key === 'intake' || key === 'mitigations') must(g.json.goal.status === 'ready', `${key} 应 ready，实为 ${g.json.goal.status}`);
    else must(g.json.goal.status === 'blocked', `${key} 应 blocked，实为 ${g.json.goal.status}`);
  }
});

await step('S3 执行客户端领取 intake；blocked 目标领取被拒', async () => {
  const c1 = await executor('POST', `/api/v1/goals/${goalId.intake}/claim`, { requestId: newId('r'), expectedVersion: 2 });
  must(c1.status === 200, `领取失败：${JSON.stringify(c1.json)}`);
  const blocked = await executor('POST', `/api/v1/goals/${goalId.assess}/claim`, { requestId: newId('r'), expectedVersion: 1 });
  must(blocked.status === 409 && blocked.json.error === 'NOT_READY', `blocked 目标应不可领取：${JSON.stringify(blocked.json)}`);
});

await step('S4 intake 执行完成→候选；人工客户端验收→assess 原子就绪', async () => {
  let r = await executor('POST', `/api/v1/goals/${goalId.intake}/complete`, {
    requestId: newId('r'), expectedVersion: 3, fencingToken: 1,
    result: { provider: 'simulation', output: { checklist: 'complete' }, notes: '受理完成' },
  });
  must(r.status === 200 && r.json.status === 'candidate_ready', `intake 完成异常：${JSON.stringify(r.json)}`);
  r = await human('POST', `/api/v1/goals/${goalId.intake}/accept`, { requestId: newId('r'), expectedVersion: 4 });
  must(r.status === 200 && r.json.status === 'accepted', `intake 验收异常：${JSON.stringify(r.json)}`);
  const assess = await human('GET', `/api/v1/goals/${goalId.assess}`);
  must(assess.json.goal.status === 'ready', `assess 未随验收原子就绪：${assess.json.goal.status}`);
});

/** 动态读当前 goal 版本（避免硬编码脆弱断言）。 */
const cur = async (goalKey) => {
  const r = await human('GET', `/api/v1/goals/${goalId[goalKey]}`);
  return { status: r.json.goal.status, version: r.json.goal.version };
};

await step('S5 执行客户端对 mitigations 发起人工待办→waiting_human；assess 照常领取执行（无关任务不冻结）', async () => {
  const hr = await executor('POST', `/api/v1/projects/${project}/human-requests`, {
    requestId: newId('r'), goalId: goalId.mitigations, kind: 'missing_evidence',
    question: '缺缓释措施佐证', requestedRole: 'approver', requiredEvidenceKinds: ['mitigation-proof'],
  });
  must(hr.status === 200, `待办创建失败 ${JSON.stringify(hr.json)}`);
  must((await cur('mitigations')).status === 'waiting_human', 'mitigations 应 waiting_human');
  const assess = await cur('assess');
  const c = await executor('POST', `/api/v1/goals/${goalId.assess}/claim`, { requestId: newId('r'), expectedVersion: assess.version });
  must(c.status === 200, `assess 领取应不受待办影响：${JSON.stringify(c.json)}`);
  const done = await executor('POST', `/api/v1/goals/${goalId.assess}/complete`, {
    requestId: newId('r'), expectedVersion: c.json.goalVersion, fencingToken: c.json.fencingToken,
    result: { provider: 'calculation', output: { score: 82, band: 'medium' } },
  });
  must(done.status === 200, `assess 完成失败：${JSON.stringify(done.json)}`);
});

await step('S6 证据 facts 被取代：assess 定向失效→重绑 v2 回 ready；accepted intake 只置 stale；recommendation 级联失效', async () => {
  const proj = await business('GET', `/api/v1/projects/${project}`);
  const oldFacts = proj.json.evidence.find((e) => e.kind === 'facts');
  const sup = await business('POST', `/api/v1/projects/${project}/evidence/${oldFacts.evidenceId}/supersede`, {
    requestId: newId('r'), expectedVersion: proj.json.project.projectInputVersion, content: { doc: 'v2' },
  });
  must(sup.status === 200, `取代失败 ${JSON.stringify(sup.json)}`);
  const assess = await cur('assess');
  must(assess.status === 'ready', `assess 应重绑回 ready：${assess.status}`);
  const detail = await human('GET', `/api/v1/goals/${goalId.assess}`);
  must(detail.json.goal.inputEvidence[0].evidenceId === sup.json.newEvidenceId, 'assess 未绑定新证据');
  const intake = await human('GET', `/api/v1/goals/${goalId.intake}`);
  must(intake.json.goal.status === 'accepted' && intake.json.goal.stale === true, `intake 应 accepted+stale：${intake.json.goal.status}/${intake.json.goal.stale}`);
  must((await cur('mitigations')).status === 'waiting_human', 'mitigations 未绑定 facts，不应受影响');
  must((await cur('recommendation')).status === 'invalidated', 'recommendation 应随上游级联失效');
});

await step('S7 人工补证+回应→mitigations 恢复 ready；assess 失效后重做；CLI 验收 assess', async () => {
  const ev2 = await business('POST', `/api/v1/projects/${project}/evidence`, { requestId: newId('r'), expectedVersion: 3, kind: 'mitigation-proof', content: { proof: 'ok' } });
  must(ev2.status === 200, '补证失败');
  const proj = await business('GET', `/api/v1/projects/${project}`);
  const hrs = proj.json.humanRequests.filter((h) => h.status === 'open');
  must(hrs.length === 1, `应有 1 个 open 待办：${hrs.length}`);
  const resp = await human('POST', `/api/v1/human-requests/${hrs[0].hrequestId}/respond`, {
    requestId: newId('r'), answer: { text: '佐证已补', evidenceRefs: [{ evidenceId: ev2.json.evidenceId, version: 1 }] },
  });
  must(resp.status === 200 && resp.json.goalStatus === 'ready', `回应后未恢复：${JSON.stringify(resp.json)}`);
  // mitigations 执行
  let m = await cur('mitigations');
  let c = await executor('POST', `/api/v1/goals/${goalId.mitigations}/claim`, { requestId: newId('r'), expectedVersion: m.version });
  must(c.status === 200, `mitigations 领取失败：${JSON.stringify(c.json)}`);
  let done = await executor('POST', `/api/v1/goals/${goalId.mitigations}/complete`, {
    requestId: newId('r'), expectedVersion: c.json.goalVersion, fencingToken: c.json.fencingToken,
    result: { provider: 'simulation', output: { verified: true } },
  });
  must(done.status === 200, `mitigations 完成失败：${JSON.stringify(done.json)}`);
  // assess 失效重做（invalidation 后重新执行——旧的候选不再被信任）
  const assess = await cur('assess');
  c = await executor('POST', `/api/v1/goals/${goalId.assess}/claim`, { requestId: newId('r'), expectedVersion: assess.version });
  must(c.status === 200, `assess 重做领取失败：${JSON.stringify(c.json)}`);
  done = await executor('POST', `/api/v1/goals/${goalId.assess}/complete`, {
    requestId: newId('r'), expectedVersion: c.json.goalVersion, fencingToken: c.json.fencingToken,
    result: { provider: 'calculation', output: { score: 85, band: 'medium' }, notes: '基于 facts v2 重算' },
  });
  must(done.status === 200, `assess 重做完成失败：${JSON.stringify(done.json)}`);
  // CLI 通道：人工客户端用 CLI 验收 assess——依据链含 stale 的 intake，须显式复核确认（DEF-01 v1.3 门）
  const after = await cur('assess');
  must(after.status === 'candidate_ready', `assess 重做后应 candidate_ready：${after.status}`);
  const gatedCli = await runCli(TOKENS.approver, ['accept', '--goal', goalId.assess, '--expectedVersion', String(after.version)]);
  must(gatedCli.includes('UPSTREAM_STALE'), `无 ack 验收应被复核门拦截：${gatedCli}`);
  const out = await runCli(TOKENS.approver, ['accept', '--goal', goalId.assess, '--expectedVersion', String(after.version), '--ack', '人工复核失效链后确认']);
  must(!out.includes('[ERR]'), `CLI 验收失败：${out}`);
});

await step('S8 综合建议就绪→执行→验收→intake 正式决定 approved（终态；stale 链逐级人工复核确认）', async () => {
  // 验收 mitigations（独立目标，不在失效链上→无需 ack）→ recommendation 两上游齐备 → ready
  const mit = await cur('mitigations');
  const accM = await human('POST', `/api/v1/goals/${goalId.mitigations}/accept`, { requestId: newId('r'), expectedVersion: mit.version });
  must(accM.status === 200, `mitigations 验收失败：${JSON.stringify(accM.json)}`);
  const rec = await cur('recommendation');
  must(rec.status === 'ready', `recommendation 应 ready（两上游 accepted）：${rec.status}`);
  const c = await executor('POST', `/api/v1/goals/${goalId.recommendation}/claim`, { requestId: newId('r'), expectedVersion: rec.version });
  must(c.status === 200, 'recommendation 领取失败');
  const done = await executor('POST', `/api/v1/goals/${goalId.recommendation}/complete`, {
    requestId: newId('r'), expectedVersion: c.json.goalVersion, fencingToken: c.json.fencingToken,
    result: { provider: 'simulation', output: { suggestion: 'proceed-with-conditions' } },
  });
  must(done.status === 200, 'recommendation 完成失败');
  // recommendation 在 intake 失效链下游 → 验收须显式复核确认
  const accNoAck = await human('POST', `/api/v1/goals/${goalId.recommendation}/accept`, { requestId: newId('r'), expectedVersion: done.json.goalVersion });
  must(accNoAck.status === 409 && accNoAck.json.error === 'UPSTREAM_STALE', `recommendation 验收应被复核门拦截：${JSON.stringify(accNoAck.json)}`);
  const acc = await human('POST', `/api/v1/goals/${goalId.recommendation}/accept`, {
    requestId: newId('r'), expectedVersion: done.json.goalVersion, staleReviewAck: { note: '复核失效链，接受建议候选' },
  });
  must(acc.status === 200, 'recommendation 验收失败');
  const intake = await cur('intake');
  const decNoAck = await human('POST', `/api/v1/goals/${goalId.intake}/decide`, { requestId: newId('r'), expectedVersion: intake.version, decision: 'approved' });
  must(decNoAck.status === 409 && decNoAck.json.error === 'UPSTREAM_STALE', `intake 决定应被复核门拦截：${JSON.stringify(decNoAck.json)}`);
  const dec = await human('POST', `/api/v1/goals/${goalId.intake}/decide`, {
    requestId: newId('r'), expectedVersion: intake.version, decision: 'approved', note: '组合 E2E 正式决定',
    staleReviewAck: { note: '正式决定知悉 intake 输入已被取代，人工复核后批准' },
  });
  must(dec.status === 200 && dec.json.status === 'decided' && dec.json.formalDecision.decision === 'approved', `正式决定异常：${JSON.stringify(dec.json)}`);
  // 终态保护：再写被拒
  const again = await executor('POST', `/api/v1/goals/${goalId.intake}/complete`, {
    requestId: newId('r'), expectedVersion: dec.json.goalVersion, fencingToken: 1, result: { provider: 'simulation', output: {} },
  });
  must(again.status === 409 && again.json.error === 'TERMINAL_STATE', '终态保护失效');
});

await step('S9 非租赁小模板（通用文档审阅）由同一内核跑通——核心无行业硬编码', async () => {
  const tpl = await admin('POST', '/api/v1/templates', simpleTemplate('generic-doc-review'));
  must(tpl.status === 200, '小模板创建失败');
  const pr = await business('POST', '/api/v1/projects', { requestId: newId('r'), templateId: tpl.json.templateId, name: 'doc-review-mini' });
  must(pr.status === 200, '小模板项目失败');
  const pid = pr.json.projectId;
  await business('POST', `/api/v1/projects/${pid}/evidence`, { requestId: newId('r'), expectedVersion: 1, kind: 'doc', content: { title: 'any-document' } });
  const g = await business('POST', `/api/v1/projects/${pid}/goals`, { requestId: newId('r'), goalKey: 'review' });
  must(g.json.goal.status === 'ready', '小模板 review 未就绪');
  const c = await executor('POST', `/api/v1/goals/${g.json.goal.goalId}/claim`, { requestId: newId('r'), expectedVersion: g.json.goal.version });
  must(c.status === 200, '小模板领取失败');
  const done = await executor('POST', `/api/v1/goals/${g.json.goal.goalId}/complete`, {
    requestId: newId('r'), expectedVersion: c.json.goalVersion, fencingToken: c.json.fencingToken,
    result: { provider: 'simulation', output: { verdict: 'readable' } },
  });
  must(done.status === 200, '小模板完成失败');
});

await step('S10 事件链与审计完整（outbox ≥ 15 条；目标全链 receipts 留痕）', async () => {
  const events = await admin('GET', '/api/v1/events?after=0&limit=500');
  must(events.status === 200 && events.json.events.length >= 15, `事件过少：${events.json.events.length}`);
  const types = new Set(events.json.events.map((e) => e.eventType));
  for (const t of ['TEMPLATE_CREATED', 'PROJECT_CREATED', 'EVIDENCE_SUBMITTED', 'EVIDENCE_SUPERSEDED', 'GOAL_CLAIMED', 'GOAL_CANDIDATE_READY', 'GOAL_ACCEPTED', 'GOAL_DECIDED', 'HUMAN_REQUEST_CREATED', 'HUMAN_REQUEST_ANSWERED']) {
    must(types.has(t), `缺事件类型 ${t}（实有：${[...types].join(',')}）`);
  }
  const g = await human('GET', `/api/v1/goals/${goalId.intake}`);
  must(g.json.receipts.length >= 2, `intake 回执链不完整：${g.json.receipts.length}`); // claimed + execution_completed（验收/决定走 audit+事件，不写执行回执）
  must(g.json.receipts.some((r) => r.kind === 'claimed') && g.json.receipts.some((r) => r.kind === 'execution_completed'), '回执类型不全');
});

const proj = await business('GET', `/api/v1/projects/${project}`);
results.finalProjection = proj.json.goals.map((g) => ({ goalKey: g.goalKey, status: g.status, stale: g.stale, formalDecision: g.formalDecision }));
results.finishedAt = new Date().toISOString();
writeFileSync(path.join(__dirname, 'e2e-result.json'), JSON.stringify(results, null, 2));
console.log(`\n[e2e] ${results.passed} pass / ${results.failed} fail → assembly/e2e-result.json`);
console.log('[e2e] 最终投影：', JSON.stringify(results.finalProjection));
if (!keep) await kernel.stop();
process.exit(results.failed > 0 ? 1 : 0);
