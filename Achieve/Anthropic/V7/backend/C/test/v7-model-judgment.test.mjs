// V7 Lane C · model-judgment 测试（mock provider 注入；全部合成数据）。
// 覆盖：正常 candidate_ready、前置门四类短路、not_sent/sent_unknown、JSON 不合格、
// 越权措辞、伪造引用、旧证据引用、数值不一致、不确定低估、unknown 不自动重试。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRulePack } from '../src/rule-pack.mjs';
import { runModelJudgment, buildCandidatePrompt, PROMPT_VERSION } from '../src/model-judgment.mjs';
import { calculateCashFlowCoverage } from '../src/calculation-tool.mjs';
import { createMockProvider, makeCandidate } from '../src/mock-provider.mjs';

const pack = loadRulePack();

const SRC = (id, v) => ({ evidenceId: id, version: v });
const baseFacts = () => ({
  factVersion: 7,
  evidence: [
    { evidenceId: 'ev-001', version: 2, supersededBy: null, indicator: 'monthly_operating_cash_flow', caliber: '经营现金流·租金后', value: 84 },
    { evidenceId: 'ev-001', version: 2, supersededBy: null, indicator: 'monthly_debt_service', caliber: '月度租金+利息', value: 60 },
  ],
});
const baseCalc = () => calculateCashFlowCoverage({
  monthlyOperatingCashFlow: { value: 84, caliber: '经营现金流·租金后', source: SRC('ev-001', 2) },
  monthlyDebtService: { value: 60, caliber: '月度租金+利息', source: SRC('ev-001', 2) },
  currency: 'CNY',
});

test('正常路径：合格候选 → candidate_ready，回执保留，providerPhase=ok', async () => {
  const mp = createMockProvider({ script: { text: makeCandidate() } });
  const r = await runModelJudgment({ rulePack: pack, facts: baseFacts(), calc: baseCalc(), provider: mp.provider, requestId: 'req-ok-1' });
  assert.equal(r.status, 'candidate_ready');
  assert.equal(r.providerPhase, 'ok');
  assert.equal(r.requestReceipt, 'mock-receipt-req-ok-1');
  assert.equal(r.checks.grounding.ok, true);
  assert.equal(r.checks.calcConsistency.ok, true);
});

test('规则不覆盖：工具不在允许清单 → 短路，不调用模型', async () => {
  const mp = createMockProvider({ script: { text: makeCandidate() } });
  const badCalc = { ok: true, result: { toolVersion: 'calc:made-up@9' } };
  const r = await runModelJudgment({ rulePack: pack, facts: baseFacts(), calc: badCalc, provider: mp.provider, requestId: 'req-cov' });
  assert.equal(r.status, 'human_required');
  assert.equal(r.reason, 'rule_not_covered');
  assert.equal(r.providerPhase, 'not_called');
  assert.equal(mp.calls.length, 0);
});

test('缺参：计算 MISSING_INPUT → human_required/missing_input，不调用模型', async () => {
  const mp = createMockProvider({ script: null });
  const refused = calculateCashFlowCoverage({ monthlyOperatingCashFlow: { value: 84, caliber: 'x', source: SRC('ev-001', 2) }, currency: 'CNY' });
  const r = await runModelJudgment({ rulePack: pack, facts: baseFacts(), calc: refused, provider: mp.provider, requestId: 'req-miss' });
  assert.equal(r.status, 'human_required');
  assert.equal(r.reason, 'missing_input');
  assert.equal(mp.calls.length, 0);
});

test('证据矛盾：同口径两证据数值不一致 → 短路 evidence_conflict', async () => {
  const mp = createMockProvider({ script: { text: makeCandidate() } });
  const facts = baseFacts();
  facts.evidence.push({ evidenceId: 'ev-002', version: 1, supersededBy: null, indicator: 'monthly_operating_cash_flow', caliber: '经营现金流·租金后', value: 70 });
  const r = await runModelJudgment({ rulePack: pack, facts, calc: baseCalc(), provider: mp.provider, requestId: 'req-conf' });
  assert.equal(r.status, 'human_required');
  assert.equal(r.reason, 'evidence_conflict');
  assert.equal(mp.calls.length, 0);
});

test('口径变化：同指标两口径 → 短路 caliber_change', async () => {
  const mp = createMockProvider({ script: { text: makeCandidate() } });
  const facts = baseFacts();
  facts.evidence.push({ evidenceId: 'ev-003', version: 1, supersededBy: null, indicator: 'monthly_operating_cash_flow', caliber: '经营现金流·租金前', value: 84 });
  const r = await runModelJudgment({ rulePack: pack, facts, calc: baseCalc(), provider: mp.provider, requestId: 'req-cal' });
  assert.equal(r.status, 'human_required');
  assert.equal(r.reason, 'caliber_change');
  assert.equal(mp.calls.length, 0);
});

test('未配置：not_sent → human_required/call_not_sent，如实标注未发送', async () => {
  const mp = createMockProvider({ script: null, notConfigured: true });
  const r = await runModelJudgment({ rulePack: pack, facts: baseFacts(), calc: baseCalc(), provider: mp.provider, requestId: 'req-nc' });
  assert.equal(r.status, 'human_required');
  assert.equal(r.reason, 'call_not_sent');
  assert.equal(r.providerPhase, 'not_sent');
});

test('发送后不可知：sent_unknown → status=unknown（不伪造失败/成功）', async () => {
  const mp = createMockProvider({ script: { phase: 'sent_unknown', code: 'TIMEOUT_AFTER_SEND' } });
  const r = await runModelJudgment({ rulePack: pack, facts: baseFacts(), calc: baseCalc(), provider: mp.provider, requestId: 'req-unk' });
  assert.equal(r.status, 'unknown');
  assert.equal(r.reason, 'call_unknown');
  assert.equal(r.providerPhase, 'sent_unknown');
  assert.equal(mp.calls.length, 1, '不得自动重试：provider 恰好调用一次');
});

test('JSON 不合格：非 JSON 文本 → human_required/model_output_invalid', async () => {
  const mp = createMockProvider({ script: { text: '抱歉，我认为这个项目风险较低……（无结构输出）' } });
  const r = await runModelJudgment({ rulePack: pack, facts: baseFacts(), calc: baseCalc(), provider: mp.provider, requestId: 'req-bad' });
  assert.equal(r.status, 'human_required');
  assert.equal(r.reason, 'model_output_invalid');
  assert.match(r.reasons[0].code, /JSON_PARSE/);
});

test('越权措辞：候选含“建议批准该笔授信” → model_output_invalid + AUTHORITY_WORDING', async () => {
  const mp = createMockProvider({ script: { text: makeCandidate({ observations: ['覆盖率 1.4。综上：建议批准该笔授信。'] }) } });
  const r = await runModelJudgment({ rulePack: pack, facts: baseFacts(), calc: baseCalc(), provider: mp.provider, requestId: 'req-auth' });
  assert.equal(r.status, 'human_required');
  assert.equal(r.reason, 'model_output_invalid');
  assert.ok(r.reasons.some((x) => x.code === 'AUTHORITY_WORDING'));
});

test('伪造引用：引用不存在的证据 → model_output_invalid/REF_NOT_FOUND', async () => {
  const mp = createMockProvider({ script: { text: makeCandidate({ evidenceRefs: [{ evidenceId: 'ev-999', version: 1 }] }) } });
  const r = await runModelJudgment({ rulePack: pack, facts: baseFacts(), calc: baseCalc(), provider: mp.provider, requestId: 'req-fake' });
  assert.equal(r.status, 'human_required');
  assert.equal(r.reason, 'model_output_invalid');
});

test('旧证据引用：引用已被取代版本 → superseded_evidence_cited（旧意见失效）', async () => {
  const mp = createMockProvider({ script: { text: makeCandidate({ evidenceRefs: [{ evidenceId: 'ev-001', version: 1 }], observations: ['按 v1 证据覆盖率 1.4。'] }) } });
  const facts = baseFacts();
  facts.evidence.push({ evidenceId: 'ev-001', version: 1, supersededBy: 'ev-001@2', indicator: 'monthly_operating_cash_flow', caliber: '经营现金流·租金后', value: 90 });
  const r = await runModelJudgment({ rulePack: pack, facts, calc: baseCalc(), provider: mp.provider, requestId: 'req-sup' });
  assert.equal(r.status, 'human_required');
  assert.equal(r.reason, 'superseded_evidence_cited');
});

test('数值不一致：观察引用覆盖率 2.1 与工具 1.4 不符 → calc_mismatch', async () => {
  const mp = createMockProvider({ script: { text: makeCandidate({ observations: ['本次计算：覆盖率 2.1，处于可覆盖区间。'] }) } });
  const r = await runModelJudgment({ rulePack: pack, facts: baseFacts(), calc: baseCalc(), provider: mp.provider, requestId: 'req-mm' });
  assert.equal(r.status, 'human_required');
  assert.equal(r.reason, 'calc_mismatch');
});

test('不确定低估：口径不同（合法计算）+ 模型零不确定 → uncertainty_understatement', async () => {
  const i = {
    monthlyOperatingCashFlow: { value: 84, caliber: '经营现金流·租金前', source: SRC('ev-001', 2) },
    monthlyDebtService: { value: 60, caliber: '月度租金+利息', source: SRC('ev-001', 2) },
    currency: 'CNY',
  };
  const calc = calculateCashFlowCoverage(i);
  assert.equal(calc.ok, true); // 口径不同合法，但留假设
  const mp = createMockProvider({ script: { text: makeCandidate({ uncertainty: [], assumptions: [] }) } });
  const r = await runModelJudgment({ rulePack: pack, facts: baseFacts(), calc, provider: mp.provider, requestId: 'req-uf' });
  assert.equal(r.status, 'human_required');
  assert.equal(r.reason, 'uncertainty_understatement');
  assert.equal(r.checks.uncertaintyFloor.requiredMinimum, 1);
});

test('不确定如实：同样口径不同但模型列明不确定 → candidate_ready（不得粗暴拒绝判断）', async () => {
  const i = {
    monthlyOperatingCashFlow: { value: 84, caliber: '经营现金流·租金前', source: SRC('ev-001', 2) },
    monthlyDebtService: { value: 60, caliber: '月度租金+利息', source: SRC('ev-001', 2) },
    currency: 'CNY',
  };
  const calc = calculateCashFlowCoverage(i);
  const mp = createMockProvider({ script: { text: makeCandidate({ uncertainty: ['分子分母口径不同，比率解释依赖口径差异确认。'] }) } });
  const r = await runModelJudgment({ rulePack: pack, facts: baseFacts(), calc, provider: mp.provider, requestId: 'req-uf-ok' });
  assert.equal(r.status, 'candidate_ready');
});

test('提示词组装：包含规则版本/事实版本/请求标识与五字段边界', () => {
  const p = buildCandidatePrompt({ rulePack: pack, facts: baseFacts(), calc: baseCalc(), requestId: 'req-p' });
  assert.equal(p.promptVersion, PROMPT_VERSION);
  assert.match(p.text, new RegExp(pack.version.replaceAll('.', '.')));
  assert.match(p.text, /req-p/);
  assert.match(p.text, /recommendedHumanAction/);
  assert.ok(!p.text.includes('{{RULE_VERSION}}'), '占位符必须全部替换');
});

test('provider 抛异常视为未发送（无回执即无发送证据）', async () => {
  const throwing = async () => { throw new Error('socket hang up'); };
  const r = await runModelJudgment({ rulePack: pack, facts: baseFacts(), calc: baseCalc(), provider: throwing, requestId: 'req-throw' });
  assert.equal(r.status, 'human_required');
  assert.equal(r.reason, 'call_not_sent');
  assert.equal(r.providerPhase, 'not_sent');
});
