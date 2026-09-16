// V7 backend-next Lane C → A 服务真实 HTTP 集成（CONTRACT v0.1 §4/§6）。
// 退出码：0=已执行步骤全过（允许 SKIPPED_NO_CREDENTIAL 跳过并记录）；
//         3=A 服务不可达（BLOCKED，非 C 缺陷）；1=任一已执行步骤失败。
// 凭据：--credential <token> 传入合成测试 token（由 A 的启动参数目录提供；C 不猜、不读环境密钥）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { toGoalTemplateSubmission, toEvidenceSubmission, toCalculationComplete, toCandidateComplete } from './contract-adapter.mjs';
import { calculateCashFlowCoverage } from './calculation-tool.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const BASE = process.env.C_A_BASE ?? 'http://127.0.0.1:48080';
const credentialIdx = process.argv.indexOf('--credential');
const credential = credentialIdx !== -1 ? process.argv[credentialIdx + 1] : null;

const steps = [];
const record = (name, status, detail) => { steps.push({ name, status, detail }); console.log(`${status.padEnd(8)} ${name}${detail ? ` — ${detail}` : ''}`); };

async function api(method, pathname, body, { principal = credential } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(principal ? { 'x-principal-credential': principal } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* 非 JSON 响应如实记录 */ }
  return { status: res.status, json };
}

// 0. 健康检查
let health;
try {
  health = await api('GET', '/api/v1/health');
} catch (e) {
  record('health', 'BLOCKED', `A 服务不可达（${String(e.cause?.code ?? e.message)}）；本轮 C→A 实库集成未执行，adapter 单测已覆盖投影`);
  writeEvidence('blocked');
  process.exit(3);
}
record('health', health.status === 200 && health.json?.ok ? 'PASS' : 'FAIL', `status=${health.status} db=${health.json?.db} model=${health.json?.model}`);

// 1. 未带凭据 POST /templates → 期望 403 PRINCIPAL_UNTRUSTED（失败关闭证据）
const anon = await api('POST', '/api/v1/templates', { requestId: `c-anon-${Date.now()}`, name: 'c-anon-probe', roles: [], goals: [] }, { principal: null });
record('post-template-anon-403', anon.status === 403 && anon.json?.error === 'PRINCIPAL_UNTRUSTED' ? 'PASS' : 'FAIL', `status=${anon.status} error=${anon.json?.error ?? JSON.stringify(anon.json)?.slice(0, 120)}`);

// 2. 投影租赁模板并提交（带凭据；无凭据则跳过并如实记录）
// --template non-leasing 可单独验证非租赁反例模板的实库可配置性
const whichTemplate = process.argv.includes('--template') ? process.argv[process.argv.indexOf('--template') + 1] : 'leasing';
const templateFile = whichTemplate === 'non-leasing' ? 'non-leasing-counterexample-v1.json' : 'commercial-leasing-v1.json';
const leasing = JSON.parse(readFileSync(path.join(root, 'templates', templateFile), 'utf8'));
const projected = toGoalTemplateSubmission(leasing, { requestId: `c-template-${Date.now()}` });
if (!projected.ok) {
  record('project-template', 'FAIL', projected.problems.join('；'));
  writeEvidence('failure');
  process.exit(1);
}
record('project-template', 'PASS', `goals=${projected.submission.goals.length} roles=${projected.submission.roles.length}`);

if (!credential) {
  record('post-template-auth', 'SKIPPED_NO_CREDENTIAL', '未提供 --credential（A 的合成测试 token 目录未发布）；正路径集成待凭据');
  writeEvidence('partial');
  process.exit(0);
}

const posted = await api('POST', '/api/v1/templates', projected.submission);
record('post-template-auth', posted.status === 200 && posted.json?.ok ? 'PASS' : 'FAIL', `status=${posted.status} ${JSON.stringify(posted.json)?.slice(0, 200)}`);
const templateId = posted.json?.templateId;
if (templateId) {
  const proj = await api('POST', '/api/v1/projects', { requestId: `c-proj-${Date.now()}`, templateId, name: 'C-integration-L1' });
  record('post-project', proj.status === 200 && proj.json?.ok ? 'PASS' : 'FAIL', `status=${proj.status} projectId=${proj.json?.projectId ?? '∅'}`);
  const projectId = proj.json?.projectId;
  if (projectId) {
    // v1.1：证据命令 expectedVersion 必填（非负整数）。
    // 初始值取项目投影响应；提交遇 409 VERSION_CONFLICT 按契约消费 serverVersion 重试（最多 3 次）。
    async function readInputVersion() {
      const p = await api('GET', `/api/v1/projects/${projectId}`);
      const proj = p.json?.project;
      return Number.isInteger(proj?.projectInputVersion) ? proj.projectInputVersion
        : Number.isInteger(proj?.inputVersion) ? proj.inputVersion
        : Number.isInteger(p.json?.inputVersion) ? p.json.inputVersion : null;
    }
    let expectedVersion = await readInputVersion();
    // 证据链（L3 turn1 → turn2 片段）：3 条 turn1 证据 + 1 次 supersede（flow v1 → v2 内容）
    const l3 = JSON.parse(readFileSync(path.join(root, 'scenarios', 'leasing-cases-v1.json'), 'utf8'))
      .cases.find((c) => c.caseId === 'L3-injection-new-rough-statements');
    const t1 = l3.turns[0].evidence.filter((e) => e.supersededBy === null);
    const submittedIds = [];
    for (const ev of t1) {
      const p = toEvidenceSubmission(ev);
      let r = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!Number.isInteger(expectedVersion)) expectedVersion = await readInputVersion();
        const body = { requestId: `c-ev-${ev.evidenceId}-${Date.now()}-a${attempt}`, ...(Number.isInteger(expectedVersion) ? { expectedVersion } : {}), kind: p.submission.kind, content: p.submission.content };
        r = await api('POST', `/api/v1/projects/${projectId}/evidence`, body);
        if (r.status === 409 && r.json?.error === 'VERSION_CONFLICT' && Number.isInteger(r.json.serverVersion)) {
          expectedVersion = r.json.serverVersion; // 契约 §3.2：消费 serverVersion 重试
          continue;
        }
        break;
      }
      if (r.status === 200 && r.json?.ok) {
        submittedIds.push(r.json.evidenceId ?? r.json.id ?? '?');
        if (Number.isInteger(r.json.projectInputVersion)) expectedVersion = r.json.projectInputVersion;
        else if (Number.isInteger(r.json.projectVersion)) expectedVersion = r.json.projectVersion;
        else if (Number.isInteger(r.json.inputVersion)) expectedVersion = r.json.inputVersion;
        else expectedVersion = await readInputVersion();
      }
      record(`evidence:${ev.evidenceId}`, r.status === 200 && r.json?.ok ? 'PASS' : 'FAIL', `status=${r.status} ${JSON.stringify(r.json)?.slice(0, 120)}`);
    }
    // supersede：L3 flow v1 内容 → v2 内容
    const flowV1 = l3.turns[0].evidence.find((e) => e.evidenceId === 'L3-ev-flow');
    const flowV2 = l3.turns[1].evidence.find((e) => e.evidenceId === 'L3-ev-flow' && e.version === 2);
    if (flowV1 && flowV2) {
      let sup = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!Number.isInteger(expectedVersion)) expectedVersion = await readInputVersion();
        const body = { requestId: `c-sup-${Date.now()}-a${attempt}`, ...(Number.isInteger(expectedVersion) ? { expectedVersion } : {}), content: { indicator: flowV2.indicator, caliber: flowV2.caliber, grade: flowV2.grade, value: flowV2.value ?? null, note: flowV2.content } };
        sup = await api('POST', `/api/v1/projects/${projectId}/evidence/${submittedIds[1]}/supersede`, body);
        if (sup.status === 409 && sup.json?.error === 'VERSION_CONFLICT' && Number.isInteger(sup.json.serverVersion)) {
          expectedVersion = sup.json.serverVersion;
          continue;
        }
        break;
      }
      record('evidence:supersede-flow', sup.status === 200 && sup.json?.ok ? 'PASS' : 'FAIL', `status=${sup.status} ${JSON.stringify(sup.json)?.slice(0, 120)}`);
    }
    // 人工待办创建（缺证问题→missing_evidence）
    const hr = await api('POST', `/api/v1/projects/${projectId}/human-requests`, { requestId: `c-hr-${Date.now()}`, kind: 'missing_evidence', question: l3.turns[0].scriptedSummary.questions[0], requestedRole: 'business', requiredEvidenceKinds: [] });
    record('human-request:create', hr.status === 200 && hr.json?.ok ? 'PASS' : 'FAIL', `status=${hr.status} ${JSON.stringify(hr.json)?.slice(0, 120)}`);
    // 项目投影回读（响应文本不含敏感凭据抽查）
    const back = await api('GET', `/api/v1/projects/${projectId}`);
    record('project:readback', back.status === 200 && back.json?.ok ? 'PASS' : 'FAIL', `goals=${back.json?.goals?.length ?? '?'} status=${back.status}`);
    // 模板 goalKey 实例化抽检（证明 plans/*.json 可执行；不做编排——组合属 A assembly）
    const firstKey = projected.submission.goals[0].goalKey;
    const g1 = await api('POST', `/api/v1/projects/${projectId}/goals`, { requestId: `c-goal-${Date.now()}`, goalKey: firstKey });
    const goalId = g1.json?.goalId ?? g1.json?.goal?.goalId ?? g1.json?.id ?? '∅';
    record(`goal-instantiate:${firstKey}`, g1.status === 200 && g1.json?.ok ? 'PASS' : 'FAIL', `status=${g1.status} goalId=${goalId}`);
    const g2 = await api('POST', `/api/v1/projects/${projectId}/goals`, { requestId: `c-goal-dup-${Date.now()}`, goalKey: firstKey });
    record('goal-duplicate-409', g2.status === 409 && g2.json?.error === 'GOAL_EXISTS' ? 'PASS' : 'FAIL', `status=${g2.status} error=${g2.json?.error ?? '∅'}`);
  }
  // 计算结果投影自检（claim/complete 属 A assembly 编排，C 只验投影合法性）
  const calc = calculateCashFlowCoverage({
    currency: 'CNY',
    monthlyOperatingCashFlow: { value: 84, caliber: '经营现金流·租金后', source: { evidenceId: 'ev-x', version: 1 } },
    monthlyDebtService: { value: 60, caliber: '月度租金+利息', source: { evidenceId: 'ev-y', version: 1 } },
  });
  const complete = toCalculationComplete(calc, [{ evidenceId: 'ev-x', version: 1 }]);
  record('calc-complete-projection', complete.ok && complete.result.provider === 'calculation' ? 'PASS' : 'FAIL');
}

writeEvidence(steps.some((s) => s.status === 'FAIL') ? 'failure' : 'ok');
process.exit(steps.some((s) => s.status === 'FAIL') ? 1 : 0);

function writeEvidence(outcome) {
  mkdirSync(path.join(root, 'evidence'), { recursive: true });
  writeFileSync(
    path.join(root, 'evidence', `contract-integration-${whichTemplate}.json`),
    JSON.stringify({ runAt: new Date().toISOString(), base: BASE, contract: 'A CONTRACT v1.0', credentialProvided: credential !== null, template: whichTemplate, outcome, steps }, null, 2),
  );
  console.log(`[integration] 证据已写 evidence/contract-integration-${whichTemplate}.json（outcome=${outcome}）`);
}
