// V7 Lane C · 规则包完整性测试。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRulePack, validateRulePack } from '../src/rule-pack.mjs';

const pack = loadRulePack();

test('规则包 v1 加载：版本/状态/区块完整', () => {
  assert.equal(pack.rulePackId, 'v7-rule-pack');
  assert.equal(pack.version, '1.1.0');
  assert.equal(pack.status, 'experimental');
});

test('确认边界与实验假设分离且均可区分', () => {
  assert.ok(pack.confirmedBoundaries.length >= 3);
  assert.ok(pack.experimentalAssumptions.length >= 2);
  const boundaryText = pack.confirmedBoundaries.join();
  assert.match(boundaryText, /authority=none/);
  assert.match(boundaryText, /不得补造数值/);
});

test('升级条件齐全且为类别描述（无数值阈值）', () => {
  const reasons = pack.humanEscalation.map((h) => h.reason);
  for (const r of ['rule_not_covered', 'missing_input', 'caliber_change', 'evidence_conflict', 'superseded_evidence_cited', 'model_output_invalid', 'call_not_sent', 'call_unknown', 'calc_mismatch', 'uncertainty_understatement']) {
    assert.ok(reasons.includes(r), `缺升级类别 ${r}`);
  }
  assert.equal(validateRulePack(pack).length, 0);
});

test('场景线索（3D打印/液冷/印刷）不进入指标与允许工具，仅作待验证线索', () => {
  const leads = pack.scenarioLeads.items;
  assert.deepEqual(leads, ['3d_printing', 'liquid_cooling_precision_machining', 'printing_industry_shandong']);
  for (const lead of leads) {
    assert.ok(!pack.scope.indicators.includes(lead));
    assert.ok(!pack.scope.allowedTools.includes(lead));
  }
  assert.match(pack.scenarioLeads.note, /不构成/);
});

test('scope 强制口径声明；币种白名单存在；期间有界', () => {
  assert.equal(pack.scope.inputCaliberRequired, true);
  assert.ok(pack.scope.currencyAllowList.includes('CNY'));
  assert.equal(pack.scope.period.unit, 'month');
  assert.ok(pack.scope.period.max <= 36);
});

test('候选字段边界与 R1 合同一致（五字段）', () => {
  assert.deepEqual(pack.outputBoundary.candidateFields, ['observations', 'evidenceRefs', 'assumptions', 'uncertainty', 'recommendedHumanAction']);
});

test('损坏 JSON 失败关闭', () => {
  assert.throws(() => loadRulePack('/nonexistent/rule-pack.json'), /ENOENT|规则包/);
});
