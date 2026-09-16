// V7 Lane C · 合同集成验证 v0.2（可复跑）：C 模块产物经 contract-adapter 投影，打真实 A 服务 HTTP。
// 前置：A 服务器以隔离数据目录 + 合成测试 principal token 运行（v0.2 码位澄清：resolved 意见门=RUN_RESOLVED）：
//   node A/src/server.mjs --port 3622 --data-dir <隔离目录> --principal-tokens v7c-integ-synthetic-token-0426
// 上游 hash 记录于 evidence/laneC-contract-integration.json 的 upstream 字段（CONTRACT + A/src 三件套）。
// 覆盖：规则提交 → 项目/证据/supersede → run → calculation → opinion(candidate_ready) →
//       幂等重放 → 匿名/伪造凭据/越权角色 403 负例 → 合成可信身份人工动作(resolved+formalOutcome) →
//       resolved 终态拒绝 → 意见状态门(RUN_RESOLVED/RUN_ESCALATED) → 伪造 basedOnEvidence 400 → 禁用键 400。
// 说明：v0 时代的 14/14 结果在 v0.1 下不再有效（无凭据人工动作现必须 403），以本脚本当前输出为准。
// 退出码 0=全部断言通过。全部数据合成；provider=simulation；token 为合成测试凭据，非真实密钥。
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRulePack } from './rule-pack.mjs';
import { calculateCashFlowCoverage } from './calculation-tool.mjs';
import { runModelJudgment } from './model-judgment.mjs';
import { createMockProvider, makeCandidate } from './mock-provider.mjs';
import { toRuleVersionSubmission, toCalculationCommand, toOpinionCommand, toStateCommand, toHumanActionCommand, scanForbiddenKeys } from './contract-adapter.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const BASE = process.argv[2] ?? 'http://127.0.0.1:3622';
const TAG = Date.now().toString(36); // 每轮唯一 requestId 后缀：幂等语义=同 id 必须同载荷
const rid = (name) => `int-${name}-${TAG}`;
const OUT = resolve(process.argv[3] ?? join(process.cwd(), '..', 'evidence'));
mkdirSync(OUT, { recursive: true });

const steps = [];
function record(step, request, response, assert) {
  steps.push({ step, request, response, assert });
  console.log(`${assert.ok === true ? 'PASS' : 'FAIL'}  ${step}`);
  if (assert.ok !== true) {
    console.log(`      ${JSON.stringify(assert)}`);
    console.log(`      response: ${JSON.stringify(response).slice(0, 400)}`);
  }
}
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}
const assertEq = (actual, expected, what) => ({ ok: actual === expected, what, actual, expected });

// 1. 提交规则包（投影 RuleVersion 形状）
const rulePack = loadRulePack();
const ruleSub = toRuleVersionSubmission(rulePack, { requestId: rid('rule') });
const r1 = await api('POST', '/api/v7/rules', ruleSub);
record('POST /rules（规则包投影）', ruleSub, r1, assertEq(r1.json?.ok, true, '规则提交成功'));

// 2. 建项目
const r2 = await api('POST', '/api/v7/projects', { requestId: rid('proj'), name: 'C路集成·合成现金流覆盖' });
record('POST /projects', null, r2, assertEq(r2.json?.ok, true, '项目创建'));
const projectId = r2.json.project.projectId;

// 3. 两条证据（经营现金流 84 / 月供 60，同口径）
const mkEvidence = (evidenceId, indicator, caliber, value, expectedVersion) => ({
  requestId: rid(`ev-${evidenceId}`), expectedVersion,
  kind: 'synthetic_financial', content: { evidenceId, indicator, caliber, value, currency: 'CNY' },
});
const r3a = await api('POST', `/api/v7/projects/${projectId}/evidence`, mkEvidence('ev-cf-001', 'monthly_operating_cash_flow', '经营现金流·租金后', 84, 1));
const r3b = await api('POST', `/api/v7/projects/${projectId}/evidence`, mkEvidence('ev-ds-001', 'monthly_debt_service', '月度租金+利息', 60, r3a.json.projectFactVersion));
record('POST /evidence ×2', null, [r3a, r3b], assertEq(r3a.json?.ok === true && r3b.json?.ok === true, true, '证据写入'));
const evCfId = r3a.json.evidence.evidenceId;
const evDsId = r3b.json.evidence.evidenceId;
const evCfVer = r3a.json.evidence.version;
const evDsVer = r3b.json.evidence.version;
const factVersion = r3b.json.projectFactVersion;

// 4. 计算（C 工具）→ run → calculation 命令
const calc = calculateCashFlowCoverage({
  monthlyOperatingCashFlow: { value: 84, caliber: '经营现金流·租金后', source: { evidenceId: evCfId, version: evCfVer } },
  monthlyDebtService: { value: 60, caliber: '月度租金+利息', source: { evidenceId: evDsId, version: evDsVer } },
  currency: 'CNY',
});
assertEqWithThrow(calc.ok === true, '集成前置：计算应成功');
const r4 = await api('POST', `/api/v7/projects/${projectId}/runs`, {
  requestId: rid('run1'), expectedVersion: factVersion, ruleVersion: r1.json.ruleVersion.version,
  inputEvidence: [{ evidenceId: evCfId, version: evCfVer }, { evidenceId: evDsId, version: evDsVer }],
});
record('POST /runs', null, r4, assertEq(r4.json?.ok, true, 'run 创建'));
const runId = r4.json.run.runId;
const runVer0 = r4.json.run.version;

const r5 = await api('POST', `/api/v7/runs/${runId}/calculation`, toCalculationCommand(calc, { requestId: rid('calc'), expectedVersion: runVer0 }));
const runAfterCalcCmd = (await api('GET', `/api/v7/runs/${runId}`)).json.run;
record('POST /runs/:id/calculation', null, r5, assertEq(r5.json?.ok === true && runAfterCalcCmd.calculation?.inputHash === calc.result.inputHash, true, 'calculation 落库且 inputHash 一致'));

// 5. 模型判断（SIMULATION 桩）→ opinion 命令
const facts = { factVersion, evidence: [{ evidenceId: evCfId, version: evCfVer, supersededBy: null }, { evidenceId: evDsId, version: evDsVer, supersededBy: null }] };
const mp = createMockProvider({ script: { text: makeCandidate({ evidenceRefs: [{ evidenceId: evCfId, version: evCfVer }, { evidenceId: evDsId, version: evDsVer }] }) } });
const judgment = await runModelJudgment({ rulePack, facts, calc, provider: mp.provider, requestId: rid('judg1') });
assertEqWithThrow(judgment.status === 'candidate_ready', `集成前置：判断应 candidate_ready，实际 ${judgment.status}:${judgment.reason}`);
assertEqWithThrow(scanForbiddenKeys(judgment.candidate).length === 0, '集成前置：候选无合同禁用键');

const runAfterCalc = (await api('GET', `/api/v7/runs/${runId}`)).json.run;
const r6 = await api('POST', `/api/v7/runs/${runId}/opinions`, toOpinionCommand(judgment, { requestId: rid('op1'), expectedVersion: runAfterCalc.version }));
const runAfterOp = (await api('GET', `/api/v7/runs/${runId}`)).json.run;
record('POST /runs/:id/opinions', null, r6, assertEq(r6.json?.ok === true && runAfterOp.state === 'candidate_ready', true, 'opinion 落库 → candidate_ready'));

// 6. 幂等：同 requestId 同载荷重放
const r6b = await api('POST', `/api/v7/runs/${runId}/opinions`, toOpinionCommand(judgment, { requestId: rid('op1'), expectedVersion: runAfterCalc.version }));
const runAfterReplay = (await api('GET', `/api/v7/runs/${runId}`)).json.run;
record('同 requestId 重放', null, r6b, assertEq(r6b.json?.ok === true && runAfterReplay.opinions.length === 1, true, '幂等重放不重复追加（opinions 仍为 1 条）'));

// 7. 旧证据引用：supersede ev-cf-001 → 新 run → 引用 v1 的判断 → state human_required
const r7 = await api('POST', `/api/v7/projects/${projectId}/evidence/${evCfId}/supersede`, {
  requestId: rid('sup'), expectedVersion: factVersion, content: { evidenceId: 'ev-cf-001', indicator: 'monthly_operating_cash_flow', caliber: '经营现金流·租金后', value: 88, currency: 'CNY' },
});
record('POST /evidence/:eid/supersede', null, r7, assertEq(r7.json?.ok, true, '证据取代成功'));

const factVersionAfterSup = r7.json.projectFactVersion;
// 合同 supersede 语义：创建新证据实体（新 id/v1，supersedes=旧id）；旧实体 supersededBy 指向新 id。
const evCf2Id = r7.json.evidence.evidenceId;
const factsAfter = { factVersion: factVersionAfterSup, evidence: [
  { evidenceId: evCfId, version: evCfVer, supersededBy: evCf2Id },
  { evidenceId: evCf2Id, version: 1, supersededBy: null },
  { evidenceId: evDsId, version: evDsVer, supersededBy: null },
] };
const mpSup = createMockProvider({ script: { text: makeCandidate({ evidenceRefs: [{ evidenceId: evCfId, version: 1 }] }) } });
const judgmentSup = await runModelJudgment({ rulePack, facts: factsAfter, calc, provider: mpSup.provider, requestId: rid('judg2') });
assertEqWithThrow(judgmentSup.status === 'human_required' && judgmentSup.reason === 'superseded_evidence_cited', `旧证据引用应 human_required/superseded_evidence_cited，实际 ${judgmentSup.status}:${judgmentSup.reason}`);
const run2 = await api('POST', `/api/v7/projects/${projectId}/runs`, {
  requestId: rid('run2'), expectedVersion: factVersionAfterSup, ruleVersion: r1.json.ruleVersion.version,
  inputEvidence: [{ evidenceId: evCf2Id, version: 1 }, { evidenceId: evDsId, version: evDsVer }],
});
if (run2.json?.ok !== true) { console.log('run2 response:', JSON.stringify(run2).slice(0, 300)); assertEqWithThrow(false, 'run2 创建失败'); }
const r8 = await api('POST', `/api/v7/runs/${run2.json.run.runId}/state`, toStateCommand(judgmentSup, { requestId: rid('state1'), expectedVersion: run2.json.run.version }));
const run2Get = (await api('GET', `/api/v7/runs/${run2.json.run.runId}`)).json.run;
record('POST /runs/:id/state（human_required + reason）', null, r8, assertEq(r8.json?.ok === true && run2Get.state === 'human_required', true, '升级落库'));

// 8. unknown 语义落库（另一 run）
const run3 = await api('POST', `/api/v7/projects/${projectId}/runs`, {
  requestId: rid('run3'), expectedVersion: factVersionAfterSup, ruleVersion: r1.json.ruleVersion.version,
  inputEvidence: [{ evidenceId: evCf2Id, version: 1 }, { evidenceId: evDsId, version: evDsVer }],
});
if (run3.json?.ok !== true) { console.log('run3 response:', JSON.stringify(run3).slice(0, 300)); assertEqWithThrow(false, 'run3 创建失败'); }
const r9 = await api('POST', `/api/v7/runs/${run3.json.run.runId}/state`, { requestId: rid('state2'), expectedVersion: run3.json.run.version, state: 'unknown', reason: 'call_unknown' });
const run3Get = (await api('GET', `/api/v7/runs/${run3.json.run.runId}`)).json.run;
record('POST /runs/:id/state（unknown）', null, r9, assertEq(r9.json?.ok === true && run3Get.state === 'unknown', true, 'unknown 落库（不伪造成败）'));

// ---- CONTRACT v0.1 可信 principal 门 ----
// 合成测试凭据：经 CLI --principal-tokens 注入 A 服务器（仅 sha256 落盘）；非生产认证、非真实密钥。
const SYNTHETIC_PRINCIPAL_TOKEN = process.env.V7_C_INTEG_TOKEN ?? 'v7c-integ-synthetic-token-0426';

// 9. 匿名负例（先于正例）：无凭据 → 403 PRINCIPAL_UNTRUSTED（失败关闭；v0 下无此门时该命令曾 200）
const run1Get0 = (await api('GET', `/api/v7/runs/${runId}`)).json.run;
const rAnon = await api('POST', `/api/v7/runs/${runId}/human-actions`, {
  requestId: rid('ha-anon'), expectedVersion: run1Get0.version, action: 'accept_candidate', actorRole: 'human', actorName: '匿名自声明', note: '无凭据：必须失败关闭',
});
record('匿名（无凭据）人工动作拒绝', null, rAnon, assertEq(rAnon.status === 403 && rAnon.json?.error === 'PRINCIPAL_UNTRUSTED', true, `403 PRINCIPAL_UNTRUSTED（实际 ${rAnon.status} ${rAnon.json?.error ?? ''}）`));

// 9b. 错误凭据负例：伪造 token → 403 PRINCIPAL_UNTRUSTED
const rBad = await api('POST', `/api/v7/runs/${runId}/human-actions`, {
  requestId: rid('ha-bad'), expectedVersion: run1Get0.version, action: 'accept_candidate', actorRole: 'human', actorName: '伪造凭据', note: '错误 token', principalCredential: 'forged-token-not-in-allowlist',
});
record('伪造凭据人工动作拒绝', null, rBad, assertEq(rBad.status === 403 && rBad.json?.error === 'PRINCIPAL_UNTRUSTED', true, `403 PRINCIPAL_UNTRUSTED（实际 ${rBad.status} ${rBad.json?.error ?? ''}）`));

// 9c. 越权角色负例：actorRole=model（即便带凭据也必须 ROLE_FORBIDDEN）
const rRole = await api('POST', `/api/v7/runs/${runId}/human-actions`, {
  requestId: rid('ha-role'), expectedVersion: run1Get0.version, action: 'take_over', actorRole: 'model', actorName: '模型冒充', note: '角色白名单', principalCredential: SYNTHETIC_PRINCIPAL_TOKEN,
});
record('非 human actorRole 拒绝', null, rRole, assertEq(rRole.status === 403 && rRole.json?.error === 'ROLE_FORBIDDEN', true, `403 ROLE_FORBIDDEN（实际 ${rRole.status} ${rRole.json?.error ?? ''}）`));

// 9d. 正例：合成可信身份 + 合法凭据 → resolved + formalOutcome
const r10 = await api('POST', `/api/v7/runs/${runId}/human-actions`, toHumanActionCommand({
  requestId: rid('ha1'), expectedVersion: run1Get0.version, action: 'accept_candidate',
  actorName: '集成验证员（合成测试身份）', note: '接受候选：数值与证据一致（合成演示）', principalCredential: SYNTHETIC_PRINCIPAL_TOKEN,
}));
record('POST /runs/:id/human-actions（合成可信身份）', null, r10, assertEq(r10.json?.ok === true && r10.json.runState === 'resolved' && r10.json.formalOutcome?.action === 'accept_candidate', true, '人工动作 → resolved + formalOutcome（命令响应）'));
// 合同 §4：GET /runs/:runId 的 stale/formalOutcome 投影在【响应顶层】现算（非 run 实体内）——正向断言。
const run1Top = (await api('GET', `/api/v7/runs/${runId}`));
const run1After = run1Top.json.run;
record('GET /runs/:id 顶层投影（stale + formalOutcome）', null, { json: { keys: Object.keys(run1Top.json), formalOutcome: run1Top.json.formalOutcome, stale: run1Top.json.stale } }, assertEq(typeof run1Top.json.formalOutcome?.action === 'string' && typeof run1Top.json.stale === 'boolean', true, 'formalOutcome/stale 在响应顶层'));

// 9e. resolved 终态负例（D-3）：resolved 后再追加工动作必须失败关闭（A 实测：409 RUN_RESOLVED + 明确消息）
const rResolvedHa = await api('POST', `/api/v7/runs/${runId}/human-actions`, toHumanActionCommand({
  requestId: rid('ha-resolved'), expectedVersion: run1After.version, action: 'take_over',
  actorName: '集成验证员（合成测试身份）', note: 'resolved 终态不得追加', principalCredential: SYNTHETIC_PRINCIPAL_TOKEN,
}));
record('resolved 终态追加人工动作拒绝', null, rResolvedHa, assertEq(rResolvedHa.json?.ok === false && rResolvedHa.status === 409 && rResolvedHa.json?.error === 'RUN_RESOLVED', true, `409 RUN_RESOLVED（实际 ${rResolvedHa.status} ${rResolvedHa.json?.error ?? ''}）`));

// 9f. 意见状态门（D-4）：resolved run 上写 opinion → 409 RUN_RESOLVED。
// CONTRACT v0.2 码位澄清采纳 C v3 观察 #4：RUN_RESOLVED 与人工动作终态保护同码；RUN_ESCALATED 仅指升级态。
const rOpResolved = await api('POST', `/api/v7/runs/${runId}/opinions`, toOpinionCommand(judgment, { requestId: rid('op-resolved'), expectedVersion: run1After.version }));
record('resolved 上写意见拒绝', null, rOpResolved, assertEq(rOpResolved.status === 409 && rOpResolved.json?.error === 'RUN_RESOLVED', true, `409 RUN_RESOLVED（实际 ${rOpResolved.status} ${rOpResolved.json?.error ?? ''}）`));

// 9g. 意见状态门（D-4）：human_required run 上写 opinion → 409 RUN_ESCALATED
const run2GetEsc = (await api('GET', `/api/v7/runs/${run2.json.run.runId}`)).json.run;
const rOpEsc = await api('POST', `/api/v7/runs/${run2.json.run.runId}/opinions`, toOpinionCommand(judgment, { requestId: rid('op-esc'), expectedVersion: run2GetEsc.version }));
record('human_required 上写意见拒绝', null, rOpEsc, assertEq(rOpEsc.status === 409 && rOpEsc.json?.error === 'RUN_ESCALATED', true, `409 RUN_ESCALATED（实际 ${rOpEsc.status} ${rOpEsc.json?.error ?? ''}）`));

// 9h. 伪造引用负例（D-5）：须发到 pending|candidate_ready 态的 run（状态门先于证据校验）。
// 新建 run4（保持 pending），basedOnEvidence 指向不存在的证据 → 400 INVALID_INPUT。
const run4 = await api('POST', `/api/v7/projects/${projectId}/runs`, {
  requestId: rid('run4'), expectedVersion: factVersionAfterSup, ruleVersion: r1.json.ruleVersion.version,
  inputEvidence: [{ evidenceId: evCf2Id, version: 1 }, { evidenceId: evDsId, version: evDsVer }],
});
if (run4.json?.ok !== true) { console.log('run4 response:', JSON.stringify(run4).slice(0, 300)); assertEqWithThrow(false, 'run4 创建失败'); }
const rFakeRef = await api('POST', `/api/v7/runs/${run4.json.run.runId}/opinions`, {
  requestId: rid('op-fake'), expectedVersion: run4.json.run.version, provider: 'simulation', requestReceipt: 'x',
  candidate: { observations: ['覆盖率 1.4'], evidenceRefs: ['ev-fake-999@1'], assumptions: [], uncertainty: ['u'], recommendedHumanAction: 'need_more_evidence' },
  basedOnEvidence: [{ evidenceId: 'ev-fake-999', version: 1 }],
});
record('伪造 basedOnEvidence 拒绝', null, rFakeRef, assertEq(rFakeRef.status === 400 && rFakeRef.json?.error === 'INVALID_INPUT', true, `400 INVALID_INPUT（实际 ${rFakeRef.status} ${rFakeRef.json?.error ?? ''}）`));

// 10. 禁用键候选 → 400（服务端结构层）
const r12 = await api('POST', `/api/v7/runs/${runId}/opinions`, {
  requestId: rid('opbad'), expectedVersion: run1After.version, provider: 'simulation', requestReceipt: 'x',
  candidate: { observations: [], evidenceRefs: [], assumptions: [], uncertainty: [], recommendedHumanAction: 'none', approval: 'approved' },
  basedOnEvidence: [],
});
record('禁用键候选拒绝', null, r12, assertEq(r12.status === 400, true, `服务端拒绝禁用键（HTTP ${r12.status}）`));

const failed = steps.filter((s) => s.assert.ok !== true);
const observations = [
  { what: 'GET /runs/:runId 的 stale/formalOutcome 在响应顶层现算（合同 §4 语义正确；C 初版误报已撤回，与 D 路经历一致）', actualKeys: Object.keys(run1Top.json) },
];
// 上游 hash（CONTRACT v0.2 + A 服务源三件套）：证据绑定当前被测实现版本。
const { createHash } = await import('node:crypto');
const hashFile = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const upstream = {
  contract: { path: 'V7/backend/CONTRACT.md', sha256: hashFile(join(HERE, '..', '..', 'CONTRACT.md')) },
  aServer: {
    'A/src/server.mjs': hashFile(join(HERE, '..', '..', 'A', 'src', 'server.mjs')),
    'A/src/service.mjs': hashFile(join(HERE, '..', '..', 'A', 'src', 'service.mjs')),
    'A/src/store.mjs': hashFile(join(HERE, '..', '..', 'A', 'src', 'store.mjs')),
  },
};
const summary = { runAt: new Date().toISOString(), base: BASE, contractVersion: 'v0.2', upstream, total: steps.length, passed: steps.length - failed.length, failed: failed.length, steps, observations };
const outFile = join(OUT, 'laneC-contract-integration.json');
writeFileSync(outFile, JSON.stringify(summary, null, 2));
console.log(`\nintegration: ${summary.passed}/${summary.total} passed -> ${outFile}`);
process.exit(failed.length === 0 ? 0 : 1);

function assertEqWithThrow(cond, msg) {
  if (!cond) { console.error(`FATAL  ${msg}`); process.exit(2); }
}
