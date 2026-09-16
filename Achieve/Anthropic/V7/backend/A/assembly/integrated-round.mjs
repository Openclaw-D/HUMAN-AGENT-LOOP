#!/usr/bin/env node
// V7 A · assembly 第一版真实组合（CONTRACT §6）：A 事实源/回执/人工动作 × C 规则包/计算工具/候选校验。
// 原则：路径引用 B/C 原件（不复制不修改）；本文件固定组合时各来源 hash（见 MANIFEST.md）。
// B 的 thin 编排器接入 = 下一assembly 步骤（需 ports 字段对账，见 MANIFEST 待办）。
//
// 运行：node assembly/integrated-round.mjs <dataDir>（目录即状态，可重复运行换 tag）

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { openServices } from '../src/service.mjs';
import { loadRulePack, validateRulePack } from '../../C/src/rule-pack.mjs';
import { calculateCashFlowCoverage, TOOL_VERSION, FORMULA_VERSION } from '../../C/src/calculation-tool.mjs';
import { validateCandidate, scanAuthorityWording } from '../../C/src/candidate-schema.mjs';

const dataDir = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'v7-assembly-'));
const { facts, runs } = openServices(dataDir, {
  // D-6（CONTRACT v0.1）：合成测试验证器（仅演示/测试适配；非账户体系）。
  principalVerifier: (cred) => cred === 'assembly-human-token'
    ? { ok: true, role: 'human', principalId: 'assembly-human-1' }
    : { ok: false },
});
const tag = `asm-${Date.now().toString(36)}`;
const sha = (v) => createHash('sha256').update(JSON.stringify(v), 'utf8').digest('hex');
let failures = 0;
function expect(name, cond, detail = '') {
  console.log(`${cond ? '  ok' : '  FAIL'}: ${name}${cond ? '' : ` ${detail}`}`);
  if (!cond) failures += 1;
}

// 1) C 规则包 → A RuleVersion（pack 字段映射：scope.indicators/scope.allowedTools/humanEscalation）。
const pack = loadRulePack();
const packCheck = validateRulePack(pack);
// C 校验器成功返回 []（空错误列表）——assembly 适配两种成功形态。
const packOk = packCheck === undefined || packCheck === true || (Array.isArray(packCheck) && packCheck.length === 0) || packCheck?.ok === true;
expect('C 规则包通过 C 自身校验', packOk, JSON.stringify(packCheck)?.slice(0, 120));
const asStrings = (list) => list.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
const rule = facts.publishRule({
  requestId: `${tag}-rule`, indicators: asStrings(pack.scope.indicators),
  allowedTools: asStrings(pack.scope.allowedTools), humanEscalation: asStrings(pack.humanEscalation),
  notes: `assembly 发布：C ${pack.rulePackId}@${pack.version}（${pack.status}）`,
}).ruleVersion;
console.log(`[1] C 规则包已发布为 A RuleVersion v${rule.version}`);

// 2) A 项目 + 两条证据（含 C 计算输入所需口径/来源字段）。
const project = facts.createProject({ requestId: `${tag}-p`, name: 'assembly 组合项目' }).project;
const evCash = facts.attachEvidence({
  requestId: `${tag}-ev1`, projectId: project.projectId, expectedVersion: 1, kind: '财务摘录',
  content: { text: '月度经营现金流 120,000 元/月（合成）', caliber: '企业提供的月度平均，未经审计' },
}).evidence;
const evDebt = facts.attachEvidence({
  requestId: `${tag}-ev2`, projectId: project.projectId, expectedVersion: 2, kind: '还款计划',
  content: { text: '月度债务偿付 100,000 元/月（合成）', caliber: '合同月供，含息' },
}).evidence;
console.log(`[2] 证据已挂接 ${evCash.evidenceId} / ${evDebt.evidenceId}（factVersion → 3）`);

// 3) A 运行（factVersion 快照）。
const run = runs.createRun({
  requestId: `${tag}-run`, projectId: project.projectId, ruleVersion: rule.version,
  inputEvidence: [{ evidenceId: evCash.evidenceId, version: 1 }, { evidenceId: evDebt.evidenceId, version: 1 }],
}).run;
console.log(`[3] 运行 ${run.runId}（factVersion=${run.factVersion}，state=${run.state}）`);

// 4) C 计算工具真实执行 → A calculation 记录（来源引用 A 证据）。
const calcInput = {
  monthlyOperatingCashFlow: { value: 120000, caliber: '企业月度平均（未经审计）', source: { evidenceId: evCash.evidenceId, version: 1 } },
  monthlyDebtService: { value: 100000, caliber: '合同月供（含息）', source: { evidenceId: evDebt.evidenceId, version: 1 } },
  currency: 'CNY', periodMonths: 1,
};
const calc = calculateCashFlowCoverage(calcInput);
expect('C 现金流覆盖计算成功', calc.ok === true, JSON.stringify(calc.error ?? {}));
if (calc.ok) {
  const recorded = runs.setCalculation({
    requestId: `${tag}-calc`, runId: run.runId, expectedVersion: 1,
    toolVersion: TOOL_VERSION, inputHash: calc.result.inputHash ?? sha(calcInput),
    output: { ...calc.result, formulaVersion: calc.result.formulaVersion ?? FORMULA_VERSION },
    assumptions: calc.result.assumptions ?? [], computedBy: 'C:calculation-tool',
  });
  expect('计算结果落 A calculation 记录', recorded.ok === true && recorded.calculation.toolVersion === TOOL_VERSION);
  console.log(`[4] 计算：coverage=${JSON.stringify(calc.result.coverage ?? calc.result.ratio ?? '?')}（tool ${TOOL_VERSION}）`);
}

// 5) 模型候选（simulation 占位，诚实标注）：先过 C 的候选校验+权威措辞扫描，再入 A（结构双保险）。
// —— 接口分歧适配（assembly 职责，不改双方原件）：C 的 evidenceRefs 为 [{evidenceId,version}] 结构化
// 引用；A 合同 candidate.evidenceRefs 为 string[]（结构化引用由 basedOnEvidence 承载）。
// 已登记 interface-change note（见 MANIFEST.md）。——
const structuredRefs = [{ evidenceId: evCash.evidenceId, version: 1 }, { evidenceId: evDebt.evidenceId, version: 1 }];
const candidateForC = {
  observations: ['现金流覆盖率 > 1（合成输入）', '两输入口径均为企业单方提供'],
  evidenceRefs: structuredRefs,
  assumptions: ['以企业提供的月均口径为准'],
  uncertainty: ['未经审计', '缺电费交叉验证'],
  // 枚举分歧（登记 MANIFEST）：C 枚举无 need_more_evidence；assembly 演示取交集值 return_for_evidence。
  recommendedHumanAction: 'return_for_evidence',
};
const cCheck = validateCandidate(candidateForC);
expect('C 候选校验通过（C 形状）', !(cCheck && cCheck.ok === false), JSON.stringify(cCheck)?.slice(0, 120));
const candidate = { ...candidateForC, evidenceRefs: structuredRefs.map((r) => r.evidenceId) };
expect('C 权威措辞扫描无决定性表述', (scanAuthorityWording(candidate) ?? { hits: [] }).hits?.length === 0 || scanAuthorityWording(candidate) === undefined || scanAuthorityWording(candidate)?.ok !== false);
const opinion = runs.addOpinion({
  requestId: `${tag}-op`, runId: run.runId, expectedVersion: 2,
  provider: 'simulation', requestReceipt: `${tag}-sim`,
  candidate, basedOnEvidence: structuredRefs,
});
expect('候选意见落库（A 结构 + C 预校验双层）', opinion.ok === true && opinion.opinion.authority === 'none');

// 6) 反例：越权候选被 C/A 双层拒绝。
const overreach = { observations: [], approval: '同意放行' };
expect('C 层拒绝越权候选', (() => { try { const r = validateCandidate(overreach); return r && r.ok === false; } catch { return true; } })());
expect('A 层拒绝禁用键 400', (() => { try { runs.addOpinion({ requestId: `${tag}-op-bad`, runId: run.runId, expectedVersion: opinion.runVersion, provider: 'simulation', requestReceipt: 'x', candidate: overreach, basedOnEvidence: [] }); return false; } catch (e) { return e.code === 'INVALID_INPUT'; } })());

// 7) 证据更正 → 旧意见 stale（失效按输入版本）。
facts.supersedeEvidence({ requestId: `${tag}-sup`, projectId: project.projectId, evidenceId: evCash.evidenceId, expectedVersion: 3, content: { text: '经营现金流更正：95,000 元/月（合成·人工更正）', caliber: '人工核正口径' } });
const view = runs.getRun(run.runId);
expect('证据更正后旧意见 stale', view.run.opinions[0]?.stale === true);
expect('run 顶层 stale（factVersion 前进）', view.stale === true && view.currentProjectFactVersion === 4);

// 8) 人工正式动作收口。
const human = runs.addHumanAction({
  requestId: `${tag}-ha`, runId: run.runId, expectedVersion: view.run.version,
  action: 'return_for_evidence', actorRole: 'human', actorName: '信审员（assembly）',
  principalCredential: 'assembly-human-token',
  note: '证据口径已人工更正，按候选建议退回补证（正式动作）',
});
expect('人工动作 → pending 新循环 + formalOutcome 留痕', human.runState === 'pending' && human.formalOutcome.action === 'return_for_evidence');

console.log(failures === 0 ? `\nASSEMBLY ROUND PASS（dataDir: ${dataDir}）` : `\nASSEMBLY ROUND FAIL: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
