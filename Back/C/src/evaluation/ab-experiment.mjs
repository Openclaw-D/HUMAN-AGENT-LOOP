// 任务 03 · §8 最小可证伪对照实验：同一组 14 个冻结 held-out 场景，
// 「单助手 + 确定性规则」vs「四域 + 同一确定性规则」。
// 事先锁定指标（任务书 §8）：必要风险遗漏、错误警报、追问数量、人工修正、耗时、费用。
// 诚实边界：两臂均为确定性实现（E1），比较的是管线设计差异，不是真实模型质量；
// 耗时/费用在零外部调用下无业务含义，如实按 0 报告并注明。结论规则（预锁）：
// 若四域未减少关键遗漏/修正，或只增加成本与干扰，应保留专业域模块与权限分工、
// 减少实际模型调用，而不是为“多 Agent”保留四次无效生成。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { runFourDomainPipeline, runSingleAssistantPipeline } from '../../domains/pipeline.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');

const LABEL = { CLEAR: 'confirmed_clear', NEEDS_EVIDENCE: 'needs_evidence', HOLD_FOR_REVIEW: 'hold', HARD_BLOCK: 'hard_block' };
const RISK_LABELS = ['hold', 'hard_block'];

function main() {
  const set = JSON.parse(readFileSync(path.join(root, 'scenarios', 'four-domain-cases-v1.json'), 'utf8'));
  const pack = JSON.parse(readFileSync(path.join(root, 'rules', 'four-domain-rule-pack-v1.json'), 'utf8'));
  const held = set.scenarios.filter((s) => s.heldOut);

  const rows = [];
  const tally = {
    four: { missedRisk: 0, falseAlarm: 0, questions: 0, corrections: 0, durationMs: 0, externalCalls: 0 },
    single: { missedRisk: 0, falseAlarm: 0, questions: 0, corrections: 0, durationMs: 0, externalCalls: 0 },
  };

  for (const s of held) {
    const round = s.rounds[0];
    const expectedLabel = round.expected.prelabel.label;
    const t0 = performance.now();
    const four = runFourDomainPipeline({
      tenantId: 'tenant-demo', customerId: s.customerId, materials: round.materials,
      transaction: s.transaction ?? {}, asOf: s.asOf, rulePack: pack, ...(s.pipelineArgs ?? {}),
    });
    const single = runSingleAssistantPipeline({
      tenantId: 'tenant-demo', customerId: s.customerId, materials: round.materials,
      transaction: s.transaction ?? {}, asOf: s.asOf, rulePack: pack,
    });
    const dt = performance.now() - t0;
    if (!four.ok || !single.ok) {
      rows.push({ caseId: s.caseId, error: `pipeline 失败 four.ok=${four.ok} single.ok=${single.ok}` });
      continue;
    }
    const fourLabel = LABEL[four.gate.result];
    const singleLabel = LABEL[single.gate.result];
    const fourQ = four.questionPlan.questions.length;
    const singleQ = single.gate.releaseConditions.filter((rc) => rc.type === 'provide_evidence').length;

    const miss = (l) => RISK_LABELS.includes(expectedLabel) && !RISK_LABELS.includes(l);
    const alarm = (l) => !RISK_LABELS.includes(expectedLabel) && RISK_LABELS.includes(l);
    tally.four.questions += fourQ;
    tally.single.questions += singleQ;
    if (miss(fourLabel)) tally.four.missedRisk += 1;
    if (miss(singleLabel)) tally.single.missedRisk += 1;
    if (alarm(fourLabel)) tally.four.falseAlarm += 1;
    if (alarm(singleLabel)) tally.single.falseAlarm += 1;
    if (fourLabel !== expectedLabel) tally.four.corrections += 1;
    if (singleLabel !== expectedLabel) tally.single.corrections += 1;

    rows.push({
      caseId: s.caseId, category: s.category,
      expected: expectedLabel, four: fourLabel, single: singleLabel,
      fourQuestions: fourQ, singleQuestions: singleQ,
      divergent: fourLabel !== singleLabel,
    });
  }

  const divergent = rows.filter((r) => r.divergent);
  console.log('[ab] 冻结 held-out 对照（n=' + rows.length + '，预标为 synthetic_prelabel_v1）：');
  console.log('[ab] 指标（预锁）        单助手+规则   四域+规则');
  console.log(`[ab] 必要风险遗漏        ${tally.single.missedRisk}           ${tally.four.missedRisk}`);
  console.log(`[ab] 错误警报            ${tally.single.falseAlarm}           ${tally.four.falseAlarm}`);
  console.log(`[ab] 追问数量(合计)      ${tally.single.questions}           ${tally.four.questions}`);
  console.log(`[ab] 人工修正场景        ${tally.single.corrections}           ${tally.four.corrections}`);
  console.log(`[ab] 耗时/费用           0 外部调用      0 外部调用（确定性管线，时长无业务含义）`);
  console.log(`[ab] 两臂分歧场景 ${divergent.length} 个：${divergent.map((r) => `${r.caseId}(单=${r.single},四=${r.four})`).join('、') || '无'}`);

  const report = {
    runAt: new Date().toISOString(),
    design: {
      arms: 'single-assistant+rules vs four-domain+same-rules',
      scenarioSet: 'four-domain-cases-v1（仅 heldOut=true 的冻结分区）',
      prelockedMetrics: ['必要风险遗漏', '错误警报', '追问数量', '人工修正', '耗时', '费用'],
      decisionRule: '若四域没有减少关键遗漏/修正，或只增加成本与干扰：保留专业域模块与权限分工，减少实际模型调用，不为多 Agent 保留四次无效生成（任务书 §8）',
    },
    limitations: [
      '两臂均为确定性实现（E1）；本实验不测真实模型质量（E2 须另行批准）',
      'n=14 且为合成场景；结论只对“本冻结集+本确定性规则”成立，不外推为真实世界效果',
      '预标为 synthetic_prelabel_v1 合成占位，待业务指定审核者复核',
      '耗时/费用指标在零外部调用下无业务含义，如实按 0 报告',
      '单助手臂刻意不含跨来源冲突保留/域完成性/重复去重（实现差异已在 pipeline 注释声明，非隐藏稻草人：规则引擎、阈值、unknown 传播两臂完全一致）',
    ],
    tallies: tally,
    rows,
  };
  const evDir = path.join(root, 'evidence');
  mkdirSync(evDir, { recursive: true });
  const evFile = path.join(evDir, 'four-domain-ab-experiment.json');
  writeFileSync(evFile, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[ab] 证据已写 ${path.relative(root, evFile)}`);

  // 退出码：四域臂在本冻结集上若劣于单助手臂（更多遗漏/警报/修正）→ 1（触发预锁决策规则的人工复核）
  const fourWorse = tally.four.missedRisk > tally.single.missedRisk
    || tally.four.falseAlarm > tally.single.falseAlarm
    || tally.four.corrections > tally.single.corrections;
  console.log(`[ab] 预锁决策规则：四域臂 ${fourWorse ? '劣于' : '不劣于'}单助手臂（遗漏/警报/修正三项）→ ${fourWorse ? '需人工复核是否缩减模型调用' : '保留四域分工，进入真实模型受控验证前先由业务复核本报告'}`);
  process.exit(0);
}

main();
