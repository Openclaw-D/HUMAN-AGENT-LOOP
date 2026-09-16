// V7 Lane C · calculation-tool 测试（node --test；全部合成数据）。
// 覆盖：可重放（同输入同 hash 同输出）、缺参/缺口径/非法币种/非正月供显式拒绝、
// 负分子合法、口径不同留假设、输出不含风险结论。
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCashFlowCoverage, TOOL_VERSION, FORMULA_VERSION } from '../src/calculation-tool.mjs';

const SRC = () => ({ evidenceId: 'ev-001', version: 2 });
const baseInput = () => ({
  monthlyOperatingCashFlow: { value: 84, caliber: '经营现金流·租金后', source: SRC() },
  monthlyDebtService: { value: 60, caliber: '月度租金+利息', source: SRC() },
  currency: 'CNY',
  periodMonths: 1,
});

test('正常输入：确定性结果，ratio/unit/版本/hash 齐备', () => {
  const r = calculateCashFlowCoverage(baseInput());
  assert.equal(r.ok, true);
  assert.equal(r.result.ratio, 1.4);
  assert.equal(r.result.unit, 'dimensionless');
  assert.equal(r.result.toolVersion, TOOL_VERSION);
  assert.equal(r.result.formulaVersion, FORMULA_VERSION);
  assert.equal(r.result.currency, 'CNY');
  assert.equal(typeof r.result.inputHash, 'string');
  assert.match(r.result.inputHash, /^[0-9a-f]{64}$/);
});

test('可重放：同输入两次调用输出与 inputHash 完全一致', () => {
  const a = calculateCashFlowCoverage(baseInput());
  const b = calculateCashFlowCoverage(baseInput());
  assert.deepEqual(a.result, b.result);
  assert.equal(a.result.inputHash, b.result.inputHash);
});

test('输入值变化 → inputHash 变化（同 key 排序规范化）', () => {
  const a = calculateCashFlowCoverage(baseInput());
  const mod = baseInput();
  mod.monthlyOperatingCashFlow.value = 90;
  const b = calculateCashFlowCoverage(mod);
  assert.notEqual(a.result.inputHash, b.result.inputHash);
});

test('缺参：缺 monthlyDebtService → MISSING_INPUT 且列出字段', () => {
  const i = baseInput();
  delete i.monthlyDebtService;
  const r = calculateCashFlowCoverage(i);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'MISSING_INPUT');
  assert.match(r.error.field, /monthlyDebtService/);
});

test('缺口径：caliber 缺失 → MISSING_CALIBER（不得补造口径）', () => {
  const i = baseInput();
  delete i.monthlyDebtService.caliber;
  const r = calculateCashFlowCoverage(i);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'MISSING_CALIBER');
});

test('缺来源：source 缺 evidenceId → MISSING_INPUT', () => {
  const i = baseInput();
  delete i.monthlyOperatingCashFlow.source.evidenceId;
  const r = calculateCashFlowCoverage(i);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'MISSING_INPUT');
  assert.match(r.error.field, /source/);
});

test('非法币种：JPY → INVALID_CURRENCY；输入币种不一致同理', () => {
  const a = calculateCashFlowCoverage({ ...baseInput(), currency: 'JPY' });
  assert.equal(a.ok, false);
  assert.equal(a.error.code, 'INVALID_CURRENCY');
  const i = baseInput();
  i.monthlyOperatingCashFlow.currency = 'USD';
  const b = calculateCashFlowCoverage(i);
  assert.equal(b.ok, false);
  assert.equal(b.error.code, 'INVALID_CURRENCY');
});

test('非正月供：0 与 -5 → NONPOSITIVE_DEBT_SERVICE（覆盖率无定义，不除零）', () => {
  for (const v of [0, -5]) {
    const i = baseInput();
    i.monthlyDebtService.value = v;
    const r = calculateCashFlowCoverage(i);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'NONPOSITIVE_DEBT_SERVICE');
  }
});

test('负经营现金流：合法计算（ratio 为负）并留算术假设，不拒绝', () => {
  const i = baseInput();
  i.monthlyOperatingCashFlow.value = -12;
  const r = calculateCashFlowCoverage(i);
  assert.equal(r.ok, true);
  assert.equal(r.result.ratio, -0.2);
  assert.ok(r.result.assumptions.some((a) => a.includes('分子为负')));
});

test('口径不同：合法但留"不得作为同口径结论引用"假设', () => {
  const i = baseInput();
  i.monthlyOperatingCashFlow.caliber = '经营现金流·租金前';
  const r = calculateCashFlowCoverage(i);
  assert.equal(r.ok, true);
  assert.ok(r.result.assumptions.some((a) => a.includes('口径不同')));
});

test('期间校验：0/37/1.5 → INVALID_PERIOD；缺省=1 个月', () => {
  for (const p of [0, 37, 1.5]) {
    const r = calculateCashFlowCoverage({ ...baseInput(), periodMonths: p });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'INVALID_PERIOD');
  }
  const r = calculateCashFlowCoverage({ ...baseInput(), periodMonths: undefined });
  assert.equal(r.ok, true);
  assert.deepEqual(r.result.period, { unit: 'month', months: 1 });
});

test('输出无风险结论：成功结果不含批准/拒绝/额度/定价字样', () => {
  const r = calculateCashFlowCoverage(baseInput());
  const text = JSON.stringify(r.result);
  for (const w of ['批准', '拒绝', '额度', '定价', '建议审批']) {
    assert.ok(!text.includes(w), `结果不得包含风险结论字样：${w}`);
  }
});
