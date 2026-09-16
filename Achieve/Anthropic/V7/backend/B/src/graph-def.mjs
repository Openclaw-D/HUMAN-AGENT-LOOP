// V7-B 共享用例定义:两个候选(thin / LangGraph)必须实现同一张图,保证对比同口径。
// 事件→按需选角色(六角色不强制全跑)→模型与计算工具→补证等待/人工中断→恢复。
// 依赖允许的步骤并发;正式前序不得越过(dep 未成功时后序 BLOCKED,不执行)。
// 本文件全部为纯函数,无 IO,无框架依赖。

/**
 * 事件策略表(合成分类法,不含真实业务阈值)。
 * steps: 编排步;model 步 id 形如 `model:<role>:<purpose>`,role/purpose 必须在
 * 既有 adapter DEFAULT_ROLES 允许范围内(V6 契约 §2);tool 步 id 形如 `tool:<name>`。
 * deps: stepId → 前置 stepId 数组(正式前序,未成功不得越过)。
 * 无依赖关系的步允许并发。
 */
export const EVENT_POLICIES = Object.freeze({
  // 单角色:信审风险复核
  new_application: {
    label: '新申请',
    steps: [{ id: 'model:credit:risk_review', kind: 'model', role: 'credit', purpose: 'risk_review' }],
    deps: {},
  },
  // 两角色并发:政策核查 ∥ 信审复核
  evidence_updated: {
    label: '证据更新',
    steps: [
      { id: 'model:policy:policy_check', kind: 'model', role: 'policy', purpose: 'policy_check' },
      { id: 'model:credit:credit_review', kind: 'model', role: 'credit', purpose: 'credit_review' },
    ],
    deps: {},
  },
  // 并发 + 正式前序:政策核查 ∥ 信审;资产评估必须在政策核查成功之后
  asset_review: {
    label: '资产评估',
    steps: [
      { id: 'model:policy:policy_check', kind: 'model', role: 'policy', purpose: 'policy_check' },
      { id: 'model:credit:risk_review', kind: 'model', role: 'credit', purpose: 'risk_review' },
      { id: 'model:asset:asset_review', kind: 'model', role: 'asset', purpose: 'asset_review' },
    ],
    deps: { 'model:asset:asset_review': ['model:policy:policy_check'] },
  },
  // 模型→工具:商务定价语境后接可验证覆盖倍数计算(toolName 对齐 C 路 TOOL_ID)
  ratio_query: {
    label: '比率查询',
    steps: [
      { id: 'model:commerce:pricing_context', kind: 'model', role: 'commerce', purpose: 'pricing_context' },
      { id: 'tool:calc:cash-flow-coverage', kind: 'tool', toolName: 'calc:cash-flow-coverage' },
    ],
    deps: { 'tool:calc:cash-flow-coverage': ['model:commerce:pricing_context'] },
  },
});

/** 按事件类型选择编排步;未知事件类型返回 null(由调用方升级人工,不猜)。 */
export function selectSteps(eventType) {
  const policy = EVENT_POLICIES[eventType];
  if (!policy) return null;
  return { label: policy.label, steps: policy.steps, deps: policy.deps };
}

/**
 * 判定各步当前可执行性(纯函数)。
 * 正式前序不得越过:任一 dep 未 succeeded/simulated → 本步 blocked(不发起调用)。
 */
export function computeReadiness(steps, deps) {
  const readiness = {};
  for (const step of steps) {
    const depStates = (deps[step.id] || []).map((d) => steps.find((s) => s.id === d)?.state ?? 'pending');
    const depOk = depStates.every((st) => st === 'succeeded' || st === 'simulated');
    const depFailed = depStates.some((st) =>
      ['failed', 'unknown', 'not_configured', 'waiting_evidence', 'human_violation'].includes(st));
    if (step.state && step.state !== 'pending' && step.state !== 'blocked') {
      readiness[step.id] = step.state; // 已有终态的步保持(幂等重放)
    } else if (depFailed) {
      readiness[step.id] = 'blocked';
    } else if (!depOk) {
      readiness[step.id] = 'blocked';
    } else {
      readiness[step.id] = 'ready';
    }
  }
  return readiness;
}

/**
 * 由各步状态聚合运行终态(纯函数,确定性;两个候选共用同一裁决)。
 * 优先级见 TERMINAL_PRIORITY:unknown 最保守,completed 最后。
 */
export function decideRunTerminal(steps) {
  const states = steps.map((s) => s.state);
  const has = (st) => states.includes(st);
  if (has('unknown')) return { kind: 'unknown', reasonZh: '存在发送后结果不可知的模型调用,禁止自动重试,需人工核实' };
  if (has('not_configured')) return { kind: 'human_required', reasonZh: '模型服务未配置,调用未发送,需人工配置或改道' };
  if (has('human_violation')) return { kind: 'human_required', reasonZh: '模型输出未通过越权/结构校验,需人工处理' };
  if (has('stale')) return { kind: 'human_required', reasonZh: '存在版本过期已取回的结果,不得当现行,需人工核对' };
  if (has('cancelled')) return { kind: 'human_required', reasonZh: '调用在送达前取消(会话暂停),需人工恢复' };
  if (has('failed')) return { kind: 'failed', reasonZh: '存在失败步骤,失败关闭;人工可显式重试' };
  if (has('waiting_evidence')) return { kind: 'waiting_evidence', reasonZh: '存在补证等待:输入缺失,不得补造数值' };
  // blocked 不在此裁决:blocked 是暂态(其阻塞原因 failed/unknown/... 本身会产生更早的终态);
  // 依赖恢复后 blocked 步会在后续轮次变 ready 继续执行
  if (states.length > 0 && states.every((st) => st === 'succeeded' || st === 'simulated')) {
    return { kind: 'completed', reasonZh: '全部步骤完成' };
  }
  return null; // 仍在运行
}

/**
 * 候选意见汇总:只合并白名单字段,逐项带来源 role/step;authority 恒 none。
 * recommendedHumanAction 为单枚举聚合:任一步建议 return_for_evidence/take_over/
 * accept_candidate 优先级从高到低取第一个,否则 none。
 * 合成/模拟来源显式标记,不与真实混写。
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
