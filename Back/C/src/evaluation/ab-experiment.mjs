// 任务 03 · §8 最小可证伪对照实验：同一组 14 个冻结 held-out 场景，
// 「单助手 + 确定性规则」vs「四域 + 同一确定性规则」。
// 任务 02 · B4/W15 评测纪律修复（PR#3 审核 F07）：
// - 本实验是**功能消融（ablation）对照**：单助手臂刻意移除跨来源冲突保留/域完成性/内容去重，
//   实验结果只能证明这些功能在冻结集上的必要性，不能证明"多 Agent 编排"的因果优势。
// - 失败场景进入分母：任一臂管线失败按该臂 error 计入对比，不再 continue 丢弃；
// - 失败退出：四域臂劣于单助手臂（遗漏/警报/修正任一项更差或错误更多）、或存在管线错误、
//   或有效样本为 0 → 进程退出码 1（预置门未满足），不再无条件 exit0；
// - 诚实边界：两臂均为确定性实现（E1），不测真实模型质量；耗时/费用在零外部调用下无业务
//   含义，如实按 0 报告并注明（不把"未测"记成"已测为零成本"）。

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
    four: { missedRisk: 0, falseAlarm: 0, questions: 0, corrections: 0, pipelineErrors: 0 },
    single: { missedRisk: 0, falseAlarm: 0, questions: 0, corrections: 0, pipelineErrors: 0 },
  };
  let validPairs = 0;

  for (const s of held) {
    const round = s.rounds[0];
    const expectedLabel = round.expected.prelabel.label;
    const t0 = performance.now();
    // 两臂独立执行：任一臂失败 = 该臂 error 计入分母（不丢弃场景，F07 修复）
    let f;
    let g;
    try {
      f = runFourDomainPipeline({
        tenantId: 'tenant-demo', customerId: s.customerId, materials: round.materials,
        transaction: s.transaction ?? {}, asOf: s.asOf, rulePack: pack, ...(s.pipelineArgs ?? {}),
      });
    } catch (e) {
      f = { ok: false, stage: `exception:${e.code ?? 'UNKNOWN'}` };
    }
    try {
      g = runSingleAssistantPipeline({
        tenantId: 'tenant-demo', customerId: s.customerId, materials: round.materials,
        transaction: s.transaction ?? {}, asOf: s.asOf, rulePack: pack,
      });
    } catch (e) {
      g = { ok: false, stage: `exception:${e.code ?? 'UNKNOWN'}` };
    }
    const dt = performance.now() - t0;

    if (!f.ok || !g.ok) {
      if (!f.ok) tally.four.pipelineErrors += 1;
      if (!g.ok) tally.single.pipelineErrors += 1;
      rows.push({
        caseId: s.category ? s.caseId : s.caseId, category: s.category, expected: expectedLabel,
        four: f.ok ? LABEL[f.gate.result] : `pipeline_error:${f.stage ?? '?'}`,
        single: g.ok ? LABEL[g.gate.result] : `pipeline_error:${g.stage ?? '?'}`,
        pipelineError: true, durationMs: Math.round(dt),
      });
      continue;
    }
    validPairs += 1;
    const fourLabel = LABEL[f.gate.result];
    const singleLabel = LABEL[g.gate.result];
    const fourQ = f.questionPlan.questions.length;
    const singleQ = g.gate.releaseConditions.filter((rc) => rc.type === 'provide_evidence').length;

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
      durationMs: Math.round(dt),
    });
  }

  const divergent = rows.filter((r) => r.divergent);
  console.log('[ab] 冻结 held-out 功能消融对照（n=' + rows.length + '，有效配对 ' + validPairs + '，预标为 synthetic_prelabel_v1）：');
  console.log('[ab] 指标（预锁）        单助手+规则   四域+规则');
  console.log(`[ab] 必要风险遗漏        ${tally.single.missedRisk}           ${tally.four.missedRisk}`);
  console.log(`[ab] 错误警报            ${tally.single.falseAlarm}           ${tally.four.falseAlarm}`);
  console.log(`[ab] 人工修正场景        ${tally.single.corrections}           ${tally.four.corrections}`);
  console.log(`[ab] 追问数量(合计)      ${tally.single.questions}           ${tally.four.questions}`);
  console.log(`[ab] 管线错误(进分母)    ${tally.single.pipelineErrors}           ${tally.four.pipelineErrors}`);
  console.log(`[ab] 耗时/费用           未测（无真实模型）  未测（无真实模型）——零外部调用下时长无业务含义`);

  const fourWorse = tally.four.missedRisk > tally.single.missedRisk
    || tally.four.falseAlarm > tally.single.falseAlarm
    || tally.four.corrections > tally.single.corrections
    || tally.four.pipelineErrors > tally.single.pipelineErrors;
  const anyError = (tally.four.pipelineErrors + tally.single.pipelineErrors) > 0;
  const emptyDenominator = rows.length === 0;

  const report = {
    runAt: new Date().toISOString(),
    design: {
      experimentType: 'feature_ablation（功能消融）——不是"多 Agent vs 单 Agent"的因果实验',
      arms: 'single-assistant+rules（刻意移除冲突保留/域完成性/内容去重）vs four-domain+same-rules',
      scenarioSet: 'four-domain-cases-v1（仅 heldOut=true 的冻结分区）',
      prelockedMetrics: ['必要风险遗漏', '错误警报', '人工修正', '追问数量', '管线错误'],
      decisionRule: '四域臂在任一预锁指标上劣于单助手臂、或存在管线错误、或有效样本为 0 → 退出码 1（预置门未满足，需人工复核）',
    },
    limitations: [
      '功能消融结论只证被移除功能在冻结集上的必要性，不证明"多 Agent"因果优势（F07）',
      '两臂均为确定性实现（E1）；本实验不测真实模型质量（E2 须另行批准）',
      'n=14 且为合成场景；结论只对"本冻结集+本确定性规则"成立，不外推为真实世界效果',
      '预标为 synthetic_prelabel_v1 合成占位，待业务指定审核者复核',
      '耗时/费用在零外部调用下未测且无业务含义，不记为"已测 0"（W15/W16 诚实口径）',
    ],
    tallies: tally,
    validPairs,
    rows,
  };
  const evDir = path.join(root, 'evidence');
  mkdirSync(evDir, { recursive: true });
  const evFile = path.join(evDir, 'four-domain-ab-experiment.json');
  writeFileSync(evFile, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[ab] 证据已写 ${path.relative(root, evFile)}`);

  if (emptyDenominator) {
    console.error('[ab] 预置门未满足：有效样本为 0（冻结集为空或全部失败）→ 退出码 1');
    process.exit(1);
  }
  if (anyError) {
    console.error(`[ab] 预置门未满足：存在管线错误（四域 ${tally.four.pipelineErrors} / 单助手 ${tally.single.pipelineErrors}）→ 退出码 1`);
    process.exit(1);
  }
  console.log(`[ab] 预锁决策规则：四域臂 ${fourWorse ? '劣于' : '不劣于'}单助手臂（遗漏/警报/修正/错误）→ ${fourWorse ? '退出码 1，需人工复核是否缩减模型调用' : '保留四域分工；进入真实模型受控验证前先由业务复核本报告（消融结论不外推）'}`);
  process.exit(fourWorse ? 1 : 0);
}

main();
