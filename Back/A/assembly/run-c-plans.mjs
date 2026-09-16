#!/usr/bin/env node
// run-c-plans.mjs — A assembly：消费 C 路发布产物（只读），组合验证 CONTRACT §6。
//   1) 读取 C/templates/*.json（C 内部形状 v0）→ contract-adapter 投影为 A GoalTemplate（映射规则见 ADAPTER_NOTE）
//   2) admin 落库两个模板（商业融资租赁主模板 + 非租赁反例模板——核心配置化证明）
//   3) 顺序执行 C/scenarios/plans/*.plan.json 全部 8 案（createProject/submitEvidence/supersedeEvidence/createHumanRequest）
//   4) 对 L1 实例化全部目标并走 claim→complete→accept（C 模板上的完整目标闭环）
// 不修改 C 的任何文件；结果写 assembly/c-plans-result.json。
// 用法：node assembly/run-c-plans.mjs [--keep]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId, startKernel, TOKENS } from '../test/utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const C_ROOT = path.resolve(__dirname, '..', '..', 'C');

// ADAPTER_NOTE：C 内部形状 → A CONTRACT v0.1 GoalTemplate 投影规则（A 裁定，C 的 shapeNote 已预留）：
//   roles: roleId→roleKey, name→title；六角色均为人类职责岗 → isHumanRole:true
//   goalTypes: goalType→goalKey, executorType→executorKind（human_led|human_only→human；agent_tool|agent_candidate→agent）
//   inputs→inputEvidenceKinds；dependsOn→dependsOn；acceptanceRole=decisionRole='jianwei'（见微=全局协调/汇总岗，验收决定权威）
//   params 仅透传 {allowedTools, escalationOn, constraints}（禁用键扫描安全子集；acceptance 文本不入 params）
function adaptTemplate(cTemplate) {
  const roleMap = (r) => ({ roleKey: r.roleId, title: r.name, isHumanRole: true });
  const kindOf = (t) => (t.executorType === 'agent_tool' || t.executorType === 'agent_candidate' ? 'agent' : 'human');
  return {
    requestId: newId('tpl'),
    name: cTemplate.templateId,
    industry: cTemplate.domain,
    roles: cTemplate.roles.map(roleMap),
    goals: cTemplate.goalTypes.map((g) => ({
      goalKey: g.goalType,
      title: g.title,
      description: g.acceptance ?? '',
      responsibleRole: g.responsibleRole,
      executorKind: kindOf(g),
      acceptanceRole: 'jianwei',
      decisionRole: 'jianwei',
      inputEvidenceKinds: g.inputs ?? [],
      dependsOn: g.dependsOn ?? [],
      params: {
        ...(g.allowedTools ? { allowedTools: g.allowedTools } : {}),
        ...(g.escalationOn ? { escalationOn: g.escalationOn } : {}),
        ...(g.constraints ? { constraints: g.constraints } : {}),
      },
    })),
  };
}

const kernel = await startKernel({ portOffset: 10, dispatch: true });
const admin = (m, p, b) => call(TOKENS.admin, m, p, b);
const business = (m, p, b) => call(TOKENS.business, m, p, b);
const executor = (m, p, b) => call(TOKENS.agent, m, p, b);
const human = (m, p, b) => call(TOKENS.approver, m, p, b);
async function call(token, method, p, body) {
  const res = await fetch(kernel.base + p, {
    method, headers: { 'content-type': 'application/json', 'x-principal-credential': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

const result = { startedAt: new Date().toISOString(), templates: {}, plans: {}, failures: [] };
try {
  // 1) 模板落库
  for (const file of ['commercial-leasing-v1.json', 'non-leasing-counterexample-v1.json']) {
    const raw = JSON.parse(readFileSync(path.join(C_ROOT, 'templates', file), 'utf8'));
    const adapted = adaptTemplate(raw);
    const r = await admin('POST', '/api/v1/templates', adapted);
    must(r.status === 200, `模板 ${file} 落库失败：${JSON.stringify(r.json)}`);
    result.templates[raw.templateId] = { serverTemplateId: r.json.templateId, goals: adapted.goals.length, roles: adapted.roles.length };
    console.log(`[tpl] ${raw.templateId} → ${r.json.templateId}（${adapted.goals.length} 目标/${adapted.roles.length} 角色）`);
    if (raw.templateId.startsWith('goal-template-commercial-leasing')) {
      result.serverLeasingTemplateId = r.json.templateId;
    }
    if (raw.templateId.startsWith('goal-template-non-leasing')) {
      result.serverNonLeasingTemplateId = r.json.templateId;
    }
  }

  // 2) 执行全部 8 份计划
  const plansDir = path.join(C_ROOT, 'scenarios', 'plans');
  for (const file of readdirSync(plansDir).filter((f) => f.endsWith('.plan.json')).sort()) {
    const plan = JSON.parse(readFileSync(path.join(plansDir, file), 'utf8'));
    const projectId = await execPlan(plan);
    result.plans[plan.caseId] = { projectId, steps: plan.steps.length, status: 'ok' };
    console.log(`[plan] ${plan.caseId}: ${plan.steps.length} 步全部通过 → project ${projectId}`);
  }

  // 3) L1 全目标实例化 + 首目标闭环（C 模板在 A 内核上的真实 claim/complete/accept）
  const l1 = result.plans['L1-metal-direct-mature'];
  const proj = await business('GET', `/api/v1/projects/${l1.projectId}`);
  const tplInfo = await admin('GET', `/api/v1/templates/${result.serverLeasingTemplateId}`);
  const goalKeys = tplInfo.json.template.goals.map((g) => g.goalKey);
  const instantiated = {};
  for (const key of goalKeys) {
    const g = await business('POST', `/api/v1/projects/${l1.projectId}/goals`, { requestId: newId('r'), goalKey: key });
    must(g.status === 200 || g.json.error === 'GOAL_EXISTS', `实例化 ${key} 异常：${JSON.stringify(g.json)}`);
    instantiated[key] = g.json.goal !== undefined ? g.json.goal.goalId : (proj.json.goals.find((x) => x.goalKey === key)?.goalId);
  }
  // fact_intake 需要 C 声明的四类输入证据——合成补齐（L1 已有证据 kind 不同，说明 kind→inputs 映射按模板声明生效）
  const intakeDef = tplInfo.json.template.goals.find((g) => g.goalKey === 'fact_intake');
  for (const kind of intakeDef.inputEvidenceKinds) {
    const ev = await business('POST', `/api/v1/projects/${l1.projectId}/evidence`, {
      requestId: newId('r'), expectedVersion: (await business('GET', `/api/v1/projects/${l1.projectId}`)).json.project.projectInputVersion,
      kind, content: { indicator: kind, caliber: '合成', grade: 'confirmed', value: 100 },
    });
    must(ev.status === 200, `补齐 ${kind} 失败：${JSON.stringify(ev.json)}`);
  }
  const intakeId = instantiated['fact_intake'];
  const cur = await human('GET', `/api/v1/goals/${intakeId}`);
  must(cur.json.goal.status === 'ready', `fact_intake 应 ready：${cur.json.goal.status}（输入 kind 齐备自动就绪）`);
  // human_led 目标（executorKind=human）由业务岗人类 principal 领取执行；验收由 jianwei 岗执行
  const c = await business('POST', `/api/v1/goals/${intakeId}/claim`, { requestId: newId('r'), expectedVersion: cur.json.goal.version });
  must(c.status === 200, `fact_intake 领取失败：${JSON.stringify(c.json)}`);
  const done = await business('POST', `/api/v1/goals/${intakeId}/complete`, {
    requestId: newId('r'), expectedVersion: c.json.goalVersion, fencingToken: c.json.fencingToken,
    result: { provider: 'simulation', output: { intakeComplete: true }, notes: 'A assembly 业务岗执行' },
  });
  must(done.status === 200 && done.json.status === 'candidate_ready', `fact_intake 完成异常：${JSON.stringify(done.json)}`);
  const accept = await call('tok-jianwei', 'POST', `/api/v1/goals/${intakeId}/accept`, { requestId: newId('r'), expectedVersion: done.json.goalVersion });
  must(accept.status === 200 && accept.json.status === 'accepted', `fact_intake 验收异常：${JSON.stringify(accept.json)}`);
  result.l1ClosedLoop = { goal: 'fact_intake', claimed: true, completed: true, accepted: true };
  console.log('[loop] L1 fact_intake：claim→complete→accept 全通（C 模板 × A 内核闭环）');

  result.finishedAt = new Date().toISOString();
  result.ok = true;
} catch (error) {
  result.failures.push(String(error instanceof Error ? error.message : error));
  result.ok = false;
  console.error('[c-plans] FAIL:', error instanceof Error ? error.message : error);
}
writeFileSync(path.join(__dirname, 'c-plans-result.json'), JSON.stringify(result, null, 2));
if (!process.argv.includes('--keep')) await kernel.stop();
process.exit(result.ok ? 0 : 1);

// ---- 计划步骤执行（C 计划步骤 → A API；evidenceId 为 C 侧标签，映射服务端 id）----
async function execPlan(plan) {
  let projectId = null;
  const evidenceMap = new Map(); // C 标签 → 服务端 evidenceId
  let currentInputVersion = 1;
  for (const step of plan.steps) {
    if (step.step === 'createProject') {
      const r = await business('POST', '/api/v1/projects', {
        requestId: newId('r'), templateId: result.serverLeasingTemplateId, name: step.name,
      });
      must(r.status === 200, `${plan.caseId} createProject 失败：${JSON.stringify(r.json)}`);
      projectId = r.json.projectId;
      currentInputVersion = 1;
    } else if (step.step === 'submitEvidence') {
      const r = await executor('POST', `/api/v1/projects/${projectId}/evidence`, {
        requestId: newId('r'), expectedVersion: currentInputVersion,
        kind: step.payload.kind, content: step.payload.content,
      });
      must(r.status === 200, `${plan.caseId} submitEvidence(${step.evidenceId}) 失败：${JSON.stringify(r.json)}`);
      evidenceMap.set(step.evidenceId, r.json.evidenceId);
      currentInputVersion = r.json.projectInputVersion;
    } else if (step.step === 'supersedeEvidence') {
      const target = evidenceMap.get(step.targetEvidenceId);
      must(target !== undefined, `${plan.caseId} supersede 未知证据标签 ${step.targetEvidenceId}`);
      const r = await business('POST', `/api/v1/projects/${projectId}/evidence/${target}/supersede`, {
        requestId: newId('r'), expectedVersion: currentInputVersion, content: step.payload.content,
      });
      must(r.status === 200, `${plan.caseId} supersede(${step.targetEvidenceId}) 失败：${JSON.stringify(r.json)}`);
      evidenceMap.set(`${step.targetEvidenceId}@${step.targetVersion + 1}`, r.json.newEvidenceId);
      currentInputVersion = r.json.projectInputVersion;
    } else if (step.step === 'createHumanRequest') {
      const r = await executor('POST', `/api/v1/projects/${projectId}/human-requests`, {
        requestId: newId('r'), goalId: null, kind: step.payload.kind, question: step.payload.question,
        requestedRole: step.payload.requestedRole, requiredEvidenceKinds: step.payload.requiredEvidenceKinds ?? [],
      });
      must(r.status === 200, `${plan.caseId} createHumanRequest 失败：${JSON.stringify(r.json)}`);
    } else {
      throw new Error(`${plan.caseId} 未知步骤 ${step.step}`);
    }
  }
  must(projectId !== null, `${plan.caseId} 无 createProject`);
  return projectId;
}
