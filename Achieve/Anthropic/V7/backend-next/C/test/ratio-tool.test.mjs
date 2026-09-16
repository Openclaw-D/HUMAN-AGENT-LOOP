// 通用比值工具测试（订单集中度/价格基准共用；行业无关）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRatio } from '../src/ratio-tool.mjs';

const src = (id, v) => ({ evidenceId: id, version: v });

test('ratio：集中度计算与确定性', () => {
  const input = {
    label: 'order_concentration',
    numerator: { value: 620, caliber: '近12个月对账单', source: src('L7-ev-top1', 1) },
    denominator: { value: 1000, caliber: '近12个月对账单', source: src('L7-ev-total', 1) },
  };
  const r1 = calculateRatio(input);
  const r2 = calculateRatio(structuredClone(input));
  assert.equal(r1.ok, true);
  assert.equal(r1.result.ratio, 0.62);
  assert.equal(r1.result.inputHash, r2.result.inputHash);
  assert.ok(r1.result.assumptions.some((a) => a.includes('口径相同')));
});

test('ratio：非租赁价格基准同样可用（工具行业无关）', () => {
  const r = calculateRatio({
    label: 'price_benchmark',
    numerator: { value: 12, caliber: '年度报价（万元）', source: src('nl-quote', 1) },
    denominator: { value: 10, caliber: '市场基准（万元）', source: src('nl-bench', 1) },
  });
  assert.equal(r.ok, true);
  assert.equal(r.result.ratio, 1.2);
});

test('ratio：结构化拒绝族', () => {
  const ok = { value: 10, caliber: 'c', source: src('e', 1) };
  assert.equal(calculateRatio(null).error.code, 'MISSING_INPUT');
  assert.equal(calculateRatio({ numerator: ok }).error.code, 'MISSING_INPUT');
  assert.equal(calculateRatio({ numerator: ok, denominator: { value: 0, caliber: 'c', source: src('e', 1) } }).error.code, 'NONPOSITIVE_DENOMINATOR');
  assert.equal(calculateRatio({ numerator: { value: 1, source: src('e', 1) }, denominator: ok }).error.code, 'MISSING_CALIBER');
  assert.equal(
    calculateRatio({ currency: 'CNY', numerator: { ...ok, currency: 'USD' }, denominator: ok }).error.code,
    'INVALID_CURRENCY',
  );
});
