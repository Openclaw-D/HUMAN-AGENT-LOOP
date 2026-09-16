// V7 Lane C · 案例运行与评估报告测试（含“正常运行不受场景线索污染”断言）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadRulePack } from '../src/rule-pack.mjs';
import { runCase, runCaseSet } from '../src/case-runner.mjs';
import { buildEvalReport } from '../src/eval-report.mjs';

const pack = loadRulePack();
const caseSet = JSON.parse(readFileSync(new URL('../cases/cases-v1.json', import.meta.url), 'utf8'));

test('案例集结构：8 案且覆盖五类要求异常 + 三类边界', () => {
  const cats = caseSet.cases.map((c) => c.category);
  for (const need of ['normal', 'evidence_conflict', 'missing_input', 'caliber_change', 'superseded_evidence', 'uncertainty_understatement', 'call_unknown', 'rule_not_covered']) {
    assert.ok(cats.includes(need), `缺用例类别 ${need}`);
  }
  assert.equal(caseSet.cases.length, 8);
});

test('全部用例按预期通过（真实执行，非快照）', async () => {
  const run = await runCaseSet(pack, caseSet);
  const failed = run.records.filter((r) => !r.pass);
  assert.deepEqual(failed.map((r) => `${r.caseId}: ${r.diffs.join('; ')}`), []);
  assert.equal(run.passed, 8);
  assert.equal(run.failed, 0);
});

test('升级短路可证：矛盾/缺参/口径/规则不覆盖用例模型零调用', async () => {
  for (const caseId of ['C2-evidence-conflict', 'C3-missing-param', 'C4-caliber-change', 'C8-rule-not-covered']) {
    const c = caseSet.cases.find((x) => x.caseId === caseId);
    const r = await runCase(pack, c);
    assert.equal(r.actual.providerCalls, 0, `${caseId} 应短路不调用模型`);
    assert.equal(r.actual.providerPhase, 'not_called');
  }
});

test('unknown 用例：恰好一次调用（不自动重试）', async () => {
  const c = caseSet.cases.find((x) => x.caseId === 'C7-call-unknown');
  const r = await runCase(pack, c);
  assert.equal(r.actual.providerCalls, 1);
  assert.equal(r.actual.status, 'unknown');
});

test('场景线索不产生用例：case-runner 只执行 cases 数组，leads 不参与', () => {
  const leadIds = pack.scenarioLeads.items;
  for (const c of caseSet.cases) {
    for (const lead of leadIds) {
      assert.ok(!JSON.stringify(c).includes(lead), `用例 ${c.caseId} 不得引用场景线索 ${lead}`);
    }
  }
});

test('评估报告：五项能力全部可证，未验证范围如实列出', async () => {
  const run = await runCaseSet(pack, caseSet);
  const report = buildEvalReport(run, pack);
  assert.equal(report.summary.passed, 8);
  assert.equal(report.capabilities.deterministicCalculation.verified, true);
  assert.equal(report.capabilities.citationVerification.verified, true);
  assert.equal(report.capabilities.uncertaintyExternalSignal.verified, true);
  assert.equal(report.capabilities.unknownNoAutoRetry.verified, true);
  const escalation = report.capabilities.escalationReasoning.verified;
  for (const need of ['evidence_conflict', 'missing_input', 'caliber_change', 'rule_not_covered', 'superseded_evidence_cited', 'uncertainty_understatement', 'call_unknown']) {
    assert.ok(escalation.includes(need), `升级理由验证缺 ${need}`);
  }
  assert.ok(report.unverified.some((u) => u.includes('真实 HTTP')));
});
