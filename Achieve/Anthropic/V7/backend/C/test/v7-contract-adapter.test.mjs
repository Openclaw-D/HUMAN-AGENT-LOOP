// V7 Lane C · 合同适配器测试：C 产物 → CONTRACT v0 wire 形状投影。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRulePack } from '../src/rule-pack.mjs';
import { calculateCashFlowCoverage } from '../src/calculation-tool.mjs';
import { toRuleVersionSubmission, toCalculationCommand, toOpinionCommand, toStateCommand, toHumanActionCommand, scanForbiddenKeys } from '../src/contract-adapter.mjs';
import { runModelJudgment } from '../src/model-judgment.mjs';
import { createMockProvider, makeCandidate } from '../src/mock-provider.mjs';

const pack = loadRulePack();

test('规则包投影：RuleVersion 形状（indicators/allowedTools/humanEscalation 字符串数组/notes）', () => {
  const sub = toRuleVersionSubmission(pack, { requestId: 'r-1' });
  assert.deepEqual(Object.keys(sub).sort(), ['allowedTools', 'humanEscalation', 'indicators', 'notes', 'requestId']);
  assert.deepEqual(sub.indicators, pack.scope.indicators);
  assert.ok(sub.humanEscalation.every((h) => typeof h === 'string'));
  assert.ok(sub.humanEscalation.length >= 10);
});

test('计算命令投影：toolVersion/inputHash/output/assumptions 齐备', () => {
  const calc = calculateCashFlowCoverage({
    monthlyOperatingCashFlow: { value: 84, caliber: 'a', source: { evidenceId: 'e1', version: 1 } },
    monthlyDebtService: { value: 60, caliber: 'b', source: { evidenceId: 'e1', version: 1 } },
    currency: 'CNY',
  });
  const cmd = toCalculationCommand(calc, { requestId: 'c-1', expectedVersion: 1 });
  assert.equal(cmd.toolVersion, calc.result.toolVersion);
  assert.equal(cmd.inputHash, calc.result.inputHash);
  assert.equal(cmd.output.ratio, calc.result.ratio);
  assert.ok(Array.isArray(cmd.assumptions) && cmd.assumptions.length > 0);
  assert.throws(() => toCalculationCommand({ ok: false, error: {} }, { requestId: 'x', expectedVersion: 1 }), /成功计算结果/);
});

test('意见命令投影：candidate_ready → provider=simulation + evidenceRefs 字符串化（A 服务端要求）', async () => {
  const facts = { factVersion: 1, evidence: [{ evidenceId: 'e1', version: 1, supersededBy: null }] };
  const calc = calculateCashFlowCoverage({
    monthlyOperatingCashFlow: { value: 84, caliber: 'a', source: { evidenceId: 'e1', version: 1 } },
    monthlyDebtService: { value: 60, caliber: 'b', source: { evidenceId: 'e1', version: 1 } },
    currency: 'CNY',
  });
  const mp = createMockProvider({ script: { text: makeCandidate({ evidenceRefs: [{ evidenceId: 'e1', version: 1 }] }) } });
  const judgment = await runModelJudgment({ rulePack: pack, facts, calc, provider: mp.provider, requestId: 'j-1' });
  const cmd = toOpinionCommand(judgment, { requestId: 'o-1', expectedVersion: 1 });
  assert.equal(cmd.provider, 'simulation');
  assert.deepEqual(cmd.candidate.evidenceRefs, ['e1@1']);
  assert.deepEqual(cmd.basedOnEvidence, [{ evidenceId: 'e1', version: 1 }]);
  assert.ok(scanForbiddenKeys(cmd.candidate).length === 0);
  assert.throws(() => toOpinionCommand({ ...judgment, status: 'human_required' }, { requestId: 'x', expectedVersion: 1 }), /candidate_ready/);
});

test('状态命令投影：human_required/unknown 带 reason；candidate_ready 拒绝', () => {
  const s1 = toStateCommand({ status: 'human_required', reason: 'missing_input' }, { requestId: 's1', expectedVersion: 1 });
  assert.deepEqual(s1, { requestId: 's1', expectedVersion: 1, state: 'human_required', reason: 'missing_input' });
  const s2 = toStateCommand({ status: 'unknown', reason: 'call_unknown' }, { requestId: 's2', expectedVersion: 1 });
  assert.equal(s2.state, 'unknown');
  assert.throws(() => toStateCommand({ status: 'candidate_ready', reason: null }, { requestId: 'x', expectedVersion: 1 }), /human_required\|unknown\|failed/);
});

test('禁用键扫描：approval/decision/quota/price/rate 键全部命中', () => {
  const hits = scanForbiddenKeys({ approval: 1, decision: 2, ok: 3 });
  assert.deepEqual(hits, ['approval', 'decision']);
});

test('人工动作命令投影（v0.1 可信 principal 门）：凭据透传 + actorRole 固定 human', () => {
  const cmd = toHumanActionCommand({
    requestId: 'h-1', expectedVersion: 3, action: 'accept_candidate',
    actorName: '合成测试员', note: 'n', principalCredential: 'v7c-integ-synthetic-token-0426',
  });
  assert.equal(cmd.actorRole, 'human');
  assert.equal(cmd.principalCredential, 'v7c-integ-synthetic-token-0426');
  assert.deepEqual(Object.keys(cmd).sort(), ['action', 'actorName', 'actorRole', 'expectedVersion', 'note', 'principalCredential', 'requestId']);
});

test('人工动作负例：缺凭据必须本地拒绝（失败关闭，不盲发）', () => {
  assert.throws(() => toHumanActionCommand({ requestId: 'h-2', expectedVersion: 1, action: 'take_over', actorName: 'x', principalCredential: '' }), /principalCredential 缺失/);
  assert.throws(() => toHumanActionCommand({ requestId: 'h-3', expectedVersion: 1, action: 'take_over', actorName: 'x' }), /principalCredential 缺失/);
});

test('人工动作负例：非法 action 本地拒绝', () => {
  assert.throws(() => toHumanActionCommand({ requestId: 'h-4', expectedVersion: 1, action: 'auto_approve', actorName: 'x', principalCredential: 't' }), /accept_candidate\/return_for_evidence\/take_over/);
});
