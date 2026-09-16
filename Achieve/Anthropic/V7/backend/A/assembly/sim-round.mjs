// V7 A · assembly 组合缝（CONTRACT §6）：一轮完整的"事实→模型候选→人工"最小回路。
// 本模块演示 B/C 产物的接入面：B 的编排器替换 runSimulatedRound 中的 provider/意见生成部分
//（走同一 openServices 命令或同一 HTTP 端点）；C 的规则包替换 seedDemoRule 内容、
// 计算工具替换 demo 占位 calculation。本模块不复制不修改 B/C 原件。
// 用法（模块）：import { runSimulatedRound } from './sim-round.mjs'; runSimulatedRound(dataDir)

import { openServices } from '../src/service.mjs';

export function runSimulatedRound(dataDir, { tag = Date.now().toString(36) } = {}) {
  const { facts, runs } = openServices(dataDir);

  const project = facts.createProject({ requestId: `asm-p-${tag}`, name: `assembly 演示项目 ${tag}` }).project;
  const rule = facts.publishRule({
    requestId: `asm-rule-${tag}`,
    indicators: ['产能口径一致性'],
    allowedTools: ['cashflow-coverage'],
    humanEscalation: ['证据矛盾', '模型结果不可知'],
    notes: 'assembly 种子规则包（C 路正式规则包交付后替换）',
  }).ruleVersion;
  const ev = facts.attachEvidence({
    requestId: `asm-ev-${tag}`, projectId: project.projectId, expectedVersion: 1,
    kind: '现场巡检', content: { text: '产能口径：基本满负荷（合成）', source: 'assembly 合成证据' },
  }).evidence;

  const run = runs.createRun({
    requestId: `asm-run-${tag}`, projectId: project.projectId, ruleVersion: rule.version,
    inputEvidence: [{ evidenceId: ev.evidenceId, version: 1 }],
  }).run;

  // —— B 接入点：以下 opinion 由 B 的编排器（模型通道）产生；
  // simulation provider 是 B 未接入时的诚实占位，不冒充真实调用。——
  const opinion = runs.addOpinion({
    requestId: `asm-op-${tag}`, runId: run.runId, expectedVersion: 1,
    provider: 'simulation', requestReceipt: `asm-sim-${tag}`,
    candidate: {
      observations: ['证据口径单一来源，未见交叉验证信号'],
      evidenceRefs: [ev.evidenceId],
      assumptions: ['以现场巡检为准'],
      uncertainty: ['缺电费记录交叉验证'],
      recommendedHumanAction: 'need_more_evidence',
    },
    basedOnEvidence: [{ evidenceId: ev.evidenceId, version: 1 }],
  });

  const human = runs.addHumanAction({
    requestId: `asm-ha-${tag}`, runId: run.runId, expectedVersion: opinion.runVersion,
    action: 'return_for_evidence', actorRole: 'human', actorName: '信审员（assembly 演示）',
    note: '按候选建议退回补证（正式动作）',
  });

  return {
    projectId: project.projectId, ruleVersion: rule.version, evidenceId: ev.evidenceId,
    runId: run.runId, opinionId: opinion.opinion.opinionId,
    runState: human.runState, formalOutcome: human.formalOutcome,
  };
}
