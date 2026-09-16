// 计算工具测试（复用旧 C 工具的纪律：缺口径不补造、显式拒绝、确定性可重放）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCashFlowCoverage } from '../src/calculation-tool.mjs';

const src = (id, v) => ({ evidenceId: id, version: v });

test('calc：正常计算与确定性（同输入同 ratio 同 inputHash）', () => {
  const input = {
    currency: 'CNY',
    monthlyOperatingCashFlow: { value: 84, caliber: '经营现金流·租金后', source: src('ev-a', 1) },
    monthlyDebtService: { value: 60, caliber: '月度租金+利息', source: src('ev-b', 2) },
  };
  const r1 = calculateCashFlowCoverage(input);
  const r2 = calculateCashFlowCoverage(structuredClone(input));
  assert.equal(r1.ok, true);
  assert.equal(r1.result.ratio, 1.4);
  assert.equal(r1.result.inputHash, r2.result.inputHash, '同输入必须同 hash');
  assert.equal(r1.result.toolVersion, 'calc:cash-flow-coverage@1');
  assert.ok(r1.result.assumptions.length >= 2);
});

test('calc：结构化拒绝族（不默认值兜底）', () => {
  const ok = { value: 10, caliber: 'c', source: src('e', 1) };
  assert.equal(calculateCashFlowCoverage(null).error.code, 'MISSING_INPUT');
  assert.equal(calculateCashFlowCoverage({ currency: 'CNY', monthlyOperatingCashFlow: ok }).error.code, 'MISSING_INPUT');
  const noCaliber = { value: 10, source: src('e', 1) };
  assert.equal(
    calculateCashFlowCoverage({ currency: 'CNY', monthlyOperatingCashFlow: noCaliber, monthlyDebtService: ok }).error.code,
    'MISSING_CALIBER',
    '缺口径不得补造',
  );
  assert.equal(
    calculateCashFlowCoverage({ currency: 'JPY', monthlyOperatingCashFlow: ok, monthlyDebtService: ok }).error.code,
    'INVALID_CURRENCY',
  );
  assert.equal(
    calculateCashFlowCoverage({ currency: 'CNY', monthlyOperatingCashFlow: ok, monthlyDebtService: { value: 0, caliber: 'c', source: src('e', 1) } }).error.code,
    'NONPOSITIVE_DEBT_SERVICE',
  );
  assert.equal(
    calculateCashFlowCoverage({ currency: 'CNY', periodMonths: 48, monthlyOperatingCashFlow: ok, monthlyDebtService: ok }).error.code,
    'INVALID_PERIOD',
  );
  assert.equal(
    calculateCashFlowCoverage({ currency: 'CNY', monthlyOperatingCashFlow: { value: 1, caliber: 'c', source: { evidenceId: 'e' } }, monthlyDebtService: ok }).error.code,
    'MISSING_INPUT',
    '来源缺 version 不得通过',
  );
});

test('calc：负分子是合法算术事实且留假设', () => {
  const r = calculateCashFlowCoverage({
    currency: 'CNY',
    monthlyOperatingCashFlow: { value: -12, caliber: '经营现金流·租金后', source: src('e', 1) },
    monthlyDebtService: { value: 60, caliber: '月度租金+利息', source: src('e', 1) },
  });
  assert.equal(r.ok, true);
  assert.equal(r.result.ratio, -0.2);
  assert.ok(r.result.assumptions.some((a) => a.includes('负')));
});
