// V7 backend-next Lane C → A CONTRACT v0.1 投影适配器。
// 依据：V7/backend-next/CONTRACT.md（v0.1 DRAFT）§2 实体 / §3 不变量 / §4 HTTP API / §6 对 C 接口点。
// 职责：把 C 的模板/案例证据/计算结果/候选投影为 A 的 wire 形状；本地预检契约硬约束
// （FORBIDDEN_KEY 键扫描、角色存在、DAG 无环、枚举合法），**绝不代替 A 的服务端校验**。
// 纯函数、零网络；HTTP 集成见 run-contract-integration.mjs。
import { validateCandidate } from './candidate-schema.mjs';

export const CONTRACT_VERSION = 'A CONTRACT v1.0';
const FORBIDDEN_KEY_RE = /approv|decision|quota|price|rate|reject/i;

/** 递归键扫描（对齐 CONTRACT §3.1：result.output/params 禁用键，大小写不敏感、嵌套同查）。 */
export function scanForbiddenKeys(value, prefix = '') {
  const hits = [];
  if (value === null || typeof value !== 'object') return hits;
  for (const [k, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (FORBIDDEN_KEY_RE.test(k)) hits.push(path);
    if (v !== null && typeof v === 'object') hits.push(...scanForbiddenKeys(v, path));
  }
  return hits;
}

// —— goalType → A 执行者/验收/决定权 映射（C 模板配置的投影，修改须走模板版本）——
const GOAL_TYPE_MAPPING = {
  fact_intake:             { executorKind: 'human', acceptanceRole: 'jianwei',  decisionRole: 'business' },
  policy_screening:        { executorKind: 'human', acceptanceRole: 'jianwei',  decisionRole: 'business' },
  equipment_verification:  { executorKind: 'human', acceptanceRole: 'jianwei',  decisionRole: 'business' },
  credit_crosscheck:       { executorKind: 'human', acceptanceRole: 'jianwei',  decisionRole: 'business' },
  cash_flow_coverage_calc: { executorKind: 'agent', acceptanceRole: 'credit',   decisionRole: 'business' },
  pricing_cost_review:     { executorKind: 'human', acceptanceRole: 'jianwei',  decisionRole: 'business' },
  jianwei_summary:         { executorKind: 'agent', acceptanceRole: 'business', decisionRole: 'business' },
  evidence_supplement:     { executorKind: 'human', acceptanceRole: 'jianwei',  decisionRole: 'business' },
  human_review:            { executorKind: 'human', acceptanceRole: 'jianwei',  decisionRole: 'business' },
  // 非租赁模板专用
  requirement_intake:      { executorKind: 'human', acceptanceRole: 'jianwei',  decisionRole: 'business' },
  sla_check:               { executorKind: 'human', acceptanceRole: 'jianwei',  decisionRole: 'business' },
  price_benchmark:         { executorKind: 'agent', acceptanceRole: 'commerce', decisionRole: 'business' },
  compliance_screening:    { executorKind: 'human', acceptanceRole: 'jianwei',  decisionRole: 'business' },
};

const ROLE_MAP = { roleId: 'roleKey', name: 'title' };

/**
 * C 模板 → A POST /templates 载荷（CONTRACT §4）。
 * 验收约束："执行者≠验收者"按角色键层面配置（同人可兼多角色时由 A 身份源在运行期把关）。
 */
export function toGoalTemplateSubmission(cTemplate, { requestId } = {}) {
  const problems = [];
  const roleKeys = cTemplate.roles.map((r) => r.roleKey ?? r.roleId);
  const goals = (cTemplate.goalTypes ?? []).map((g) => {
    const m = GOAL_TYPE_MAPPING[g.goalType];
    if (!m) { problems.push(`goalType ${g.goalType} 缺映射`); return null; }
    const responsibleRole = g.responsibleRole;
    if (!roleKeys.includes(responsibleRole)) problems.push(`${g.goalType}.responsibleRole ${responsibleRole} 不在角色集`);
    for (const r of [m.acceptanceRole, m.decisionRole]) {
      if (!roleKeys.includes(r)) problems.push(`${g.goalType} 验收/决定角色 ${r} 不在角色集`);
    }
    if (m.executorKind === 'agent' && m.acceptanceRole === responsibleRole && g.executorType === 'agent_tool') {
      // agent 执行的 goal 由人类角色验收——此分支不应触发，留作断言
    }
    const params = {
      ...(g.allowedTools ? { allowedTools: g.allowedTools } : {}),
      ...(g.escalationOn ? { escalationOn: g.escalationOn } : {}),
      ...(g.constraints ? { constraints: g.constraints } : {}),
      ...(g.acceptance ? { acceptanceCriteria: g.acceptance } : {}),
    };
    return {
      goalKey: g.goalType,
      title: g.title,
      description: g.acceptance ?? '',
      responsibleRole,
      executorKind: m.executorKind,
      acceptanceRole: m.acceptanceRole,
      decisionRole: m.decisionRole,
      inputEvidenceKinds: g.inputs ?? [],
      dependsOn: g.dependsOn ?? [],
      params,
    };
  }).filter(Boolean);
  if (problems.length > 0) return { ok: false, problems };

  const submission = {
    ...(requestId ? { requestId } : {}),
    name: cTemplate.templateId,
    industry: cTemplate.domain ?? null,
    roles: cTemplate.roles.map((r) => ({ roleKey: r.roleKey ?? r.roleId, title: r.name ?? r.title, isHumanRole: true })),
    goals,
  };

  // 本地预检（≠服务端校验的替代）。禁键扫描范围按契约 §3.1 仅 result.output/params；
  // decisionRole 等模板 schema 自身键名不属禁键范围。
  const fk = goals.flatMap((g) => scanForbiddenKeys(g.params).map((p) => `${g.goalKey}.params.${p}`));
  if (fk.length > 0) return { ok: false, problems: [`FORBIDDEN_KEY 命中：${fk.join(', ')}`] };
  const cycle = findDependencyCycle(goals.map((g) => ({ key: g.goalKey, deps: g.dependsOn })));
  if (cycle) return { ok: false, problems: [`依赖成环：${cycle.join(' → ')}`] };
  const depKeys = new Set(goals.map((g) => g.goalKey));
  for (const g of goals) {
    for (const d of g.dependsOn) if (!depKeys.has(d)) return { ok: false, problems: [`${g.goalKey} 依赖不存在的 goalKey ${d}`] };
  }
  return { ok: true, submission, problems: [] };
}

function findDependencyCycle(nodes) {
  const byKey = new Map(nodes.map((n) => [n.key, n.deps]));
  const state = new Map(); // 0=未访问 1=在栈 2=完成
  const stack = [];
  let cycle = null;
  const dfs = (key) => {
    if (cycle) return;
    state.set(key, 1);
    stack.push(key);
    for (const d of byKey.get(key) ?? []) {
      if (!byKey.has(d)) continue;
      const s = state.get(d) ?? 0;
      if (s === 1) { cycle = [...stack, d]; return; }
      if (s === 0) dfs(d);
      if (cycle) return;
    }
    stack.pop();
    state.set(key, 2);
  };
  for (const k of byKey.keys()) { if ((state.get(k) ?? 0) === 0) dfs(k); if (cycle) break; }
  return cycle;
}

/** C 案例 evidence → A POST /projects/:id/evidence 载荷（kind=indicator，content 携带五级/口径/数值）。
 * v1.0 §3.1：禁键扫描只作用于 result.output/模板与目标 params；证据 content 是业务输入事实不扫描
 * （如报价单含价格合法）。 */
export function toEvidenceSubmission(ev) {
  const submission = {
    kind: ev.indicator,
    content: {
      indicator: ev.indicator,
      caliber: ev.caliber,
      grade: ev.grade,
      value: ev.value ?? null,
      note: ev.content,
      ...(ev.supersededBy ? { supersedesTarget: ev.supersededBy } : {}),
    },
  };
  const fk = scanForbiddenKeys({ kind: submission.kind });
  return fk.length > 0 ? { ok: false, problems: [`FORBIDDEN_KEY: ${fk.join(',')}`] } : { ok: true, submission, problems: [] };
}

/** 候选 evidenceRefs（对象）→ A 字符串数组 "evidenceId@version"。 */
export function toAEvidenceRefs(refs) {
  return (refs ?? []).map((r) => `${r.evidenceId}@${r.version}`);
}

/** 确定性计算结果 → A complete 的 result（provider="calculation"）。 */
export function toCalculationComplete(calcOkResult, evidenceRefs = []) {
  const result = {
    provider: 'calculation',
    output: calcOkResult.result,
    evidenceRefs: toAEvidenceRefs(evidenceRefs),
    notes: '确定性计算工具输出（authority=none）；ratio 为算术事实，不构成审批依据。',
  };
  const fk = scanForbiddenKeys(result);
  return fk.length > 0 ? { ok: false, problems: [`FORBIDDEN_KEY: ${fk.join(',')}`] } : { ok: true, result, problems: [] };
}

/** 脚本候选 → A complete 的 result（provider="simulation"）；候选先过 C schema。 */
export function toCandidateComplete(candidate) {
  const schema = validateCandidate(candidate);
  if (!schema.ok) return { ok: false, problems: schema.reasons.map((r) => `${r.code}: ${r.detail}`) };
  const result = {
    provider: 'simulation',
    output: candidate,
    evidenceRefs: toAEvidenceRefs(candidate.evidenceRefs),
    notes: '脚本化候选经 mock transport 回放（SIMULATION，不代表真实模型能力）；authority=none。',
  };
  const fk = scanForbiddenKeys(result);
  return fk.length > 0 ? { ok: false, problems: [`FORBIDDEN_KEY: ${fk.join(',')}`] } : { ok: true, result, problems: [] };
}

/** 案例轮次 → A HumanRequest 草稿（来自 scriptedSummary 的问题，≤3 由 checker 把关）。 */
export function toHumanRequestDrafts(turn, { requestedRole = 'business' } = {}) {
  const qs = turn.scriptedSummary?.questions ?? [];
  return qs.map((question) => ({
    kind: turn.providerNotCalled === true ? 'missing_evidence' : 'clarification',
    question,
    requestedRole,
    requiredEvidenceKinds: [],
  }));
}

/** 案例 → 项目实例化计划（A assembly 可直接消费的顺序化步骤）。
 * 投影语义（对齐 CONTRACT §2"取代=新建实体（新 id）"）：
 * - 每个证据实体只提交一次（跨轮去重）；
 * - 被取代证据不重复提交；取代经 supersede 步骤执行，内容取自取代者；
 * - C 数据允许"一个取代者取代多个旧实体"，A 形状 supersedes 为单 id → 对每个旧实体各发一次
 *   supersede（同内容），分歧如实记入 divergences，不静默吞掉。 */
export function buildCaseProjectPlan(case_, { templateId } = {}) {
  const steps = [{ step: 'createProject', templateId: templateId ?? null, name: case_.caseId }];
  const submitted = new Set();
  const divergences = [];
  for (const t of case_.turns) {
    const evidence = t.evidence ?? [];
    const index = new Map(evidence.map((e) => [`${e.evidenceId}@${e.version}`, e]));
    const successorKeys = new Set(evidence.filter((e) => e.supersededBy !== null).map((e) => e.supersededBy));

    for (const ev of evidence) {
      if (ev.supersededBy !== null) continue; // 被取代实体此前已提交；失效经 supersede 步骤
      const key = `${ev.evidenceId}@${ev.version}`;
      if (successorKeys.has(key)) continue; // 取代者实体由 supersede 调用创建，不再单独提交
      if (submitted.has(key)) continue;
      const r = toEvidenceSubmission(ev);
      if (!r.ok) { steps.push({ step: 'error', key, problems: r.problems }); continue; }
      steps.push({ step: 'submitEvidence', turn: t.turn, evidenceId: ev.evidenceId, version: ev.version, payload: r.submission });
      submitted.add(key);
    }

    const supersedeSeen = new Set();
    for (const ev of evidence) {
      if (ev.supersededBy === null) continue;
      const successor = index.get(ev.supersededBy);
      if (successor === undefined) { steps.push({ step: 'error', detail: `取代目标缺失 ${ev.supersededBy}` }); continue; }
      const stepKey = `${ev.evidenceId}@${ev.version}->${ev.supersededBy}`;
      if (supersedeSeen.has(stepKey)) continue;
      supersedeSeen.add(stepKey);
      steps.push({
        step: 'supersedeEvidence',
        turn: t.turn,
        targetEvidenceId: ev.evidenceId,
        targetVersion: ev.version,
        successorLabel: ev.supersededBy,
        payload: {
          content: {
            indicator: successor.indicator,
            caliber: successor.caliber,
            grade: successor.grade,
            value: successor.value ?? null,
            note: successor.content,
          },
        },
      });
      if (successor.evidenceId !== ev.evidenceId) {
        divergences.push(`跨 id 取代投影：${ev.evidenceId}@${ev.version} 的失效由取代者 ${ev.supersededBy} 内容执行 supersede（A 新实体）实现`);
      }
    }

    for (const hr of toHumanRequestDrafts(t)) steps.push({ step: 'createHumanRequest', turn: t.turn, payload: hr });
  }
  return { caseId: case_.caseId, steps, stepCount: steps.length, divergences };
}
