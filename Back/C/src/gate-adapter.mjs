// 任务 02 · B2.1/F06 显式有版本适配器：C 生产者实际输出 → A 消费面形状。
// 审核依据（AUDIT_PR3 F06 / 反例 X04）：C Gate 输出 rulesetVersion + scope.blockedActions，
// A validateGateInput 要求 rulePackVersion（1..64 string）+ 顶层 blockedActions——直送即断。
// 纪律（任务书 B2.1）：
// - 用显式有版本的适配器，不改 C 生产者语义，也不代替 A 服务端校验；
// - 适配失败必须明确拒绝（problems 非空 + ok:false），禁止编造缺省值蒙混；
// - 消费者契约测试以生产者实际输出为输入（见 test/gate-adapter.test.mjs），不手写"看似一样"的 fixture。
// 另一缺口（同源核对发现）：A validateAnalysisRunShallow 要求 inputWatermark 为非空 string，
// C AnalysisRun 的水位是对象 {generation, materials}——本适配器给确定性字符串投影，对象原件保留在
// cOriginal 供追溯；非 completed 的 Run 拒绝投影为可登记结果（B2.5：只有真实完成且输入未失效的
// Run 能提交有效候选）。

import { GATE_RESULTS, DOMAINS, EXECUTION_STATUSES } from '../domains/schema.mjs';
import { stableStringify, stableHash } from '../domains/util.mjs';

export const GATE_ADAPTER_VERSION = 'c-to-a-gate-adapter@1';

function isStr(v) { return typeof v === 'string' && v.trim().length > 0; }
function strArr(v) { return Array.isArray(v) && v.every((x) => typeof x === 'string'); }

/** 水位对象 → 确定性字符串投影：`wm:<generation>:<hash16>`（A 要求非空 string；可由原件重算核对）。 */
export function toAInputWatermarkString(watermark) {
  if (typeof watermark === 'string' && watermark.trim().length > 0) return watermark;
  if (watermark !== null && typeof watermark === 'object' && !Array.isArray(watermark) && Object.keys(watermark).length > 0) {
    return `wm:${Number(watermark.generation ?? 0)}:${stableHash(stableStringify(watermark)).slice(0, 16)}`;
  }
  return null;
}

/**
 * C evaluateGate 产物 → A GateInput（decision-support.ts validateGateInput 消费形状）。
 * @returns {ok:true, aGateInput} | {ok:false, problems}
 */
export function toAGateInput(gate) {
  const problems = [];
  if (gate === null || typeof gate !== 'object' || Array.isArray(gate)) {
    return { ok: false, problems: ['gate 输出必须为对象'] };
  }
  if (!GATE_RESULTS.includes(gate.result)) problems.push(`gate.result 必须 ${GATE_RESULTS.join('/')}（收到 ${JSON.stringify(gate.result ?? null)}）`);
  // F06 主缺口：rulesetVersion → rulePackVersion（缺失/超长明确拒绝，不编造）
  if (!isStr(gate.rulesetVersion)) problems.push('gate.rulesetVersion 必须为非空字符串（A 侧 rulePackVersion 来源）');
  else if (gate.rulesetVersion.length > 64) problems.push(`gate.rulesetVersion 超过 A 侧 64 字符上限（${gate.rulesetVersion.length}）`);
  // F06 主缺口：scope.blockedActions → 顶层 blockedActions
  const enforced = gate.scope?.blockedActions;
  if (!strArr(enforced)) problems.push('gate.scope.blockedActions 必须为字符串数组（A 侧顶层 blockedActions 来源）');
  if (!strArr(gate.reasonCodes ?? [])) problems.push('gate.reasonCodes 必须为字符串数组');
  if (!strArr(gate.ruleIds ?? [])) problems.push('gate.ruleIds 必须为字符串数组');
  if (gate.evaluatedAt !== undefined && typeof gate.evaluatedAt !== 'string') problems.push('gate.evaluatedAt 必须为字符串');
  if (!Array.isArray(gate.evidenceRefs ?? [])) problems.push('gate.evidenceRefs 必须为数组');
  if (problems.length > 0) return { ok: false, problems };

  const aGateInput = {
    result: gate.result,
    rulePackVersion: gate.rulesetVersion,
    blockedActions: [...enforced],
    reasonCodes: [...(gate.reasonCodes ?? [])],
    ruleIds: [...(gate.ruleIds ?? [])],
    ...(typeof gate.evaluatedAt === 'string' ? { evaluatedAt: gate.evaluatedAt } : {}),
    evidenceRefs: [...(gate.evidenceRefs ?? [])],
    // A validateGateInput 只消费以上字段；以下为无损透传（供 Edge 投影/对账，A 端忽略）
    cPassthrough: {
      adapterVersion: GATE_ADAPTER_VERSION,
      gateId: gate.gateId ?? null,
      blockedActionsProposed: gate.scope?.blockedActionsProposed ?? [],
      releaseConditions: gate.releaseConditions ?? [],
      unsupportedRuleRefs: gate.unsupportedRuleRefs ?? [],
      domainStatus: gate.domainStatus ?? {},
      transaction: gate.scope?.transaction ?? {},
      disclaimers: gate.disclaimers ?? [],
    },
  };
  return { ok: true, aGateInput };
}

/**
 * C 域分析包（AnalysisRun + DomainAssessment）→ A recordDomainResult 登记帧字段。
 * B2.5：只有 executionStatus=completed 的 Run 能投影为有效候选登记；其余明确拒绝（不冒充完成）。
 * @param p.deps {artifactIds:string[], factKeys:string[]} 登记依赖声明（由调用方按包冻结声明给出）
 * @returns {ok:true, frame:{domain, analysisRun, opinion, deps}} | {ok:false, problems}
 */
export function toADomainResultRegistration({ domain, analysisRun, assessment, deps = {} }) {
  const problems = [];
  if (!DOMAINS.includes(domain)) problems.push(`domain 必须 ${DOMAINS.join('/')}`);
  if (analysisRun === null || typeof analysisRun !== 'object' || Array.isArray(analysisRun)) {
    return { ok: false, problems: ['analysisRun 必须为对象'] };
  }
  for (const k of ['runId', 'inputHash', 'rulesetVersion']) {
    if (!isStr(analysisRun[k])) problems.push(`analysisRun.${k} 必须为非空字符串`);
  }
  const wmString = toAInputWatermarkString(analysisRun.inputWatermark);
  if (wmString === null) problems.push('analysisRun.inputWatermark 必须为非空字符串或非空对象（A 侧要求 string，本适配器投影）');
  if (!EXECUTION_STATUSES.includes(analysisRun.executionStatus)) {
    problems.push(`analysisRun.executionStatus 必须 ${EXECUTION_STATUSES.join('/')}`);
  } else if (analysisRun.executionStatus !== 'completed') {
    problems.push(`executionStatus=${analysisRun.executionStatus} 的 Run 不得登记为有效候选（B2.5：只有真实完成且输入未失效的 Run 能提交）；请走显式运行状态上报`);
  }
  if (assessment !== null && typeof assessment === 'object' && !Array.isArray(assessment)) {
    if (assessment.authority !== undefined && assessment.authority !== 'none') {
      problems.push(`opinion.authority 必须恒为 none（收到 ${JSON.stringify(assessment.authority)}）`);
    }
    if (isStr(analysisRun.domain) && assessment.domain !== analysisRun.domain) {
      problems.push('assessment.domain 与 analysisRun.domain 不一致');
    }
  } else {
    problems.push('assessment（opinion）必须为对象');
  }
  if (!strArr(deps.artifactIds ?? [])) problems.push('deps.artifactIds 必须为字符串数组');
  if (!strArr(deps.factKeys ?? [])) problems.push('deps.factKeys 必须为字符串数组');
  // 登记冻结的规则版本必须显式给到（包冻结声明上的 rulePackVersion）；域 Run 自身版本戳
  // 可能是阈值包版本（如 sim-business@0.3），两者语义不同，不允许隐式混用（B2.2/B2.5）
  if (!isStr(deps.rulePackVersion)) problems.push('deps.rulePackVersion 必须显式提供（依据包冻结声明的规则包版本，≤64 字符）');
  else if (deps.rulePackVersion.length > 64) problems.push('deps.rulePackVersion 超过 64 字符上限');
  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    frame: {
      domain,
      analysisRun: {
        runId: analysisRun.runId,
        domain,
        inputHash: analysisRun.inputHash,
        inputWatermark: wmString,
        rulesetVersion: analysisRun.rulesetVersion,
        executionStatus: analysisRun.executionStatus,
        ...(analysisRun.inputSnapshotId ? { inputSnapshotId: analysisRun.inputSnapshotId } : {}),
        ...(analysisRun.completedAt ? { completedAt: analysisRun.completedAt } : {}),
      },
      // 原始对象水位保留在 cOriginal（登记帧外追溯用；A 帧不收）
      cOriginal: { inputWatermarkObject: analysisRun.inputWatermark ?? null, adapterVersion: GATE_ADAPTER_VERSION },
      opinion: assessment,
      deps: {
        artifactIds: [...(deps.artifactIds ?? [])],
        factKeys: [...(deps.factKeys ?? [])],
        rulePackVersion: deps.rulePackVersion,
      },
    },
  };
}
