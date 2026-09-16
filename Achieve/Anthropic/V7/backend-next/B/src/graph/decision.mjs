// V7 backend-next B 执行决策纯函数:就绪门/终局裁决/候选汇总/请求标识。
// 继承 V7/backend/B graph-def 的已验证语义(两候选同口径 47/47),去掉旧 EVENT_POLICIES
// (本轮由 router 规则表按任务路由生成执行计划,A 的 GoalInstance 持有目标级依赖,
// B 不复刻第二套目标调度)。本文件全部为纯函数,无 IO,无框架依赖。

import { STEP_STATE, TERMINAL_PRIORITY, CANDIDATE_FIELDS } from '../codes.mjs';

/**
 * 判定各步当前可执行性(纯函数)。
 * 前序不得越过:任一 dep 未 succeeded/simulated → 本步 blocked(不发起调用)。
 * deps: stepId → 前置 stepId 数组(线性计划由编排层展开)。
 */
export function computeReadiness(steps, deps) {
  const readiness = {};
  for (const step of steps) {
    const key = step.id ?? step.stepId; // 兼容两种命名(编排器创建时统一带 id)
    const depStates = (deps[key] || []).map((d) => steps.find((s) => (s.id ?? s.stepId) === d)?.state ?? 'pending');
    const depOk = depStates.every((st) => st === 'succeeded' || st === 'simulated');
    const depFailed = depStates.some((st) =>
      ['failed', 'unknown', 'not_configured', 'waiting_evidence', 'human_violation', 'stale', 'cancelled'].includes(st));
    if (step.state && step.state !== 'pending' && step.state !== 'blocked') {
      readiness[key] = step.state; // 已有终态的步保持(幂等重放)
    } else if (depFailed || !depOk) {
      readiness[key] = 'blocked';
    } else {
      readiness[key] = 'ready';
    }
  }
  return readiness;
}

/**
 * 由各步状态聚合运行终态(纯函数,确定性)。
 * 优先级按 TERMINAL_PRIORITY:unknown 最保守,completed 最后。
 */
export function decideRunTerminal(steps) {
  const states = steps.map((s) => s.state);
  const has = (st) => states.includes(st);
  if (has('unknown')) return { kind: 'unknown', reasonZh: '存在发送后结果不可知的调用,禁止自动重试,需人工核实' };
  if (has('not_configured')) return { kind: 'human_required', reasonZh: '模型服务未配置,调用未发送,需人工配置或改道' };
  if (has('human_violation')) return { kind: 'human_required', reasonZh: '调用输出未通过越权/结构校验,需人工处理' };
  if (has('stale')) return { kind: 'human_required', reasonZh: '存在版本过期/租约失效的结果,不得当现行,需人工核对' };
  if (has('cancelled')) return { kind: 'human_required', reasonZh: '调用在送达前取消,需人工恢复' };
  if (has('failed')) return { kind: 'failed', reasonZh: '存在失败步骤,失败关闭;人工可显式重试' };
  if (has('waiting_evidence')) return { kind: 'waiting_evidence', reasonZh: '存在补证等待:输入缺失,不得补造数值' };
  // blocked 不在此裁决:blocked 是暂态,其阻塞原因本身会产生更早的终态
  if (states.length > 0 && states.every((st) => st === 'succeeded' || st === 'simulated')) {
    return { kind: 'completed', reasonZh: '全部步骤完成' };
  }
  return null; // 仍在运行
}

/**
 * 候选意见汇总:只合并白名单字段,逐项带来源 role/step;authority 恒 none。
 * recommendedHumanAction 聚合:return_for_evidence > take_over > accept_candidate 取最保守,
 * 否则 none。任一步为模拟 → 整包显著标记 simulated,不与真实混写。
 */
export function aggregateCandidates(steps) {
  const merged = {
    authority: 'none',
    sourceMode: 'real',
    observations: [],
    evidenceRefs: [],
    assumptions: [],
    uncertainty: [],
    recommendedHumanAction: 'none',
  };
  const actionPriority = ['return_for_evidence', 'take_over', 'accept_candidate'];
  const rank = (a) => (a === 'none' ? actionPriority.length : actionPriority.indexOf(a));
  let sawSimulated = false;
  for (const step of steps) {
    const cand = step.candidate;
    if (!cand) continue;
    if (step.state === 'simulated') sawSimulated = true;
    const from = { stepId: step.id, role: step.role || `tool:${step.toolName}` };
    for (const key of ['observations', 'assumptions', 'uncertainty']) {
      for (const text of cand[key] || []) merged[key].push(`[${from.role}] ${text}`);
    }
    for (const ref of cand.evidenceRefs || []) {
      if (!merged.evidenceRefs.some((r) => r.id === ref.id && r.version === ref.version)) {
        merged.evidenceRefs.push({ ...ref });
      }
    }
    const action = cand.recommendedHumanAction;
    if (typeof action === 'string' && rank(action) < rank(merged.recommendedHumanAction)) {
      merged.recommendedHumanAction = action;
    }
  }
  if (sawSimulated) merged.sourceMode = 'simulated'; // 任一步为模拟→整包显著标记
  return merged;
}

/** 确定性请求标识:重放同 attempt 必然同 id(幂等);只有显式人工重试推进 attempt。 */
export function modelRequestId(runId, stepId, attempt) {
  return `${runId}::${stepId}::a${attempt}`;
}

/** 规范化 JSON 稳定序列化(键排序),用于输入指纹。 */
export function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
}

/** 断言候选只含白名单字段(authority 恒 none 由构造保证,这里防字段漂移)。 */
export function assertCandidateWhitelist(cand) {
  for (const key of Object.keys(cand)) {
    if (!CANDIDATE_FIELDS.includes(key)) throw new Error(`INTERNAL: candidate field ${key} 不在白名单`);
  }
}

export { STEP_STATE, TERMINAL_PRIORITY };
