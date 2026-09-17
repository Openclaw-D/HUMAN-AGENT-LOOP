// 任务 02 · B4/W15 评测器纪律回归：消融实验不再无条件 exit0，报告为功能消融口径。
// 运行：cd Back/C && node --test test/eval-discipline.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

test('W15 消融实验在当前冻结集上以诚实口径运行且退出码 0（四域臂不劣于单助手臂）', () => {
  const r = spawnSync(process.execPath, [path.join(root, 'src', 'evaluation', 'ab-experiment.mjs')], { timeout: 120000, encoding: 'utf8' });
  // 当前冻结集：四域臂 0 遗漏/0 警报/0 修正 vs 单助手臂 4 遗漏 → 不劣于 → 0
  assert.equal(r.status, 0, `exit=${r.status} stderr=${r.stderr.slice(0, 400)}`);
  const report = JSON.parse(readFileSync(path.join(root, 'evidence', 'four-domain-ab-experiment.json'), 'utf8'));
  assert.ok(report.design.experimentType.includes('功能消融'), '报告必须声明消融性质，不冒充多Agent因果证明');
  assert.ok(report.design.decisionRule.includes('退出码 1'), '预锁决策规则必须含失败退出');
  assert.ok(report.limitations.some((l) => l.includes('不证明')), '限制声明必须含因果边界');
  assert.equal(typeof report.validPairs, 'number');
  assert.ok(report.validPairs > 0, '有效配对进入分母');
  // 管线错误计数进分母（字段存在即纪律；当前为 0）
  assert.equal(report.tallies.four.pipelineErrors, 0);
  assert.equal(report.tallies.single.pipelineErrors, 0);
});
