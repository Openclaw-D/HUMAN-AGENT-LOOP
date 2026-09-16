// V7 Lane C · 合同适配器：把 C 路产物投影为 CONTRACT v0（V7/backend/CONTRACT.md）的 wire 形状。
// 只做形状投影与键清理，不做业务判断；断言/幂等/状态机归 A 服务端。
// - 规则包 → POST /api/v7/rules 提交体（RuleVersion 形状，version int 由 A 全局单调分配）
// - 计算结果 → POST /runs/:id/calculation 提交体
// - 判断记录 → POST /runs/:id/opinions（candidate_ready）或 /runs/:id/state（human_required|unknown）
export const FORBIDDEN_CANDIDATE_KEYS = ['approval', 'approved', 'decision', 'quota', 'price', 'rate', 'approve', 'reject'];

/** 规则包 → RuleVersion 提交体（§2/§4：indicators/allowedTools/humanEscalation:string[]/notes）。 */
export function toRuleVersionSubmission(rulePack, { requestId }) {
  return {
    requestId,
    indicators: [...rulePack.scope.indicators],
    allowedTools: [...rulePack.scope.allowedTools],
    humanEscalation: rulePack.humanEscalation.map((h) => h.reason),
    notes: `[${rulePack.rulePackId}@${rulePack.version}|status:${rulePack.status}] ${rulePack.confirmedBoundaries.length} 条确认边界 / ${rulePack.experimentalAssumptions.length} 条实验假设；线索未晋升：${rulePack.scenarioLeads.items.join(',')}`,
  };
}

/**
 * 计算成功结果 → calculation 命令提交体（§2 calculation 形状）。
 * output = 工具结果剥离命令级字段后的完整对象（ratio/unit/formula/inputs/numericPrecision 等）。
 */
export function toCalculationCommand(calcResult, { requestId, expectedVersion, computedBy = 'v7-lane-c' }) {
  if (calcResult?.ok !== true) throw new Error('toCalculationCommand 只接受成功计算结果（拒绝走 state 命令）');
  const { toolVersion, inputHash, assumptions, ...output } = calcResult.result;
  return {
    requestId,
    expectedVersion,
    toolVersion,
    inputHash,
    output,
    assumptions: [...assumptions],
    computedAt: new Date().toISOString(),
    computedBy,
  };
}

/** 判断记录 → opinion 命令提交体（仅 candidate_ready；authority=none 由合同硬规则保障）。
 *  evidenceRefs 投影为 A 服务端要求的字符串数组（evidenceId@version；2026-09-15 实测对象被 400 拒绝）。 */
export function toOpinionCommand(judgment, { requestId, expectedVersion }) {
  if (judgment.status !== 'candidate_ready') throw new Error(`toOpinionCommand 只接受 candidate_ready，实际 ${judgment.status}`);
  if (judgment.candidate === null) throw new Error('candidate_ready 但 candidate 为空（结构损坏）');
  const candidate = structuredClone(judgment.candidate);
  candidate.evidenceRefs = candidate.evidenceRefs.map((r) => `${r.evidenceId}@${r.version}`);
  return {
    requestId,
    expectedVersion,
    provider: 'simulation',
    requestReceipt: judgment.requestReceipt ?? `no-receipt-${judgment.requestId}`,
    candidate,
    basedOnEvidence: judgment.candidate.evidenceRefs.map((r) => ({ evidenceId: r.evidenceId, version: r.version })),
  };
}

/** 判断记录 → state 命令提交体（human_required|unknown|failed；escalation 语义，不自动重试）。 */
export function toStateCommand(judgment, { requestId, expectedVersion }) {
  if (!['human_required', 'unknown', 'failed'].includes(judgment.status)) {
    throw new Error(`toStateCommand 只接受 human_required|unknown|failed，实际 ${judgment.status}`);
  }
  const reason = judgment.reason ?? 'unspecified';
  return { requestId, expectedVersion, state: judgment.status, reason };
}

/**
 * 人工动作 → human-actions 命令提交体（CONTRACT v0.1 可信 principal 门）。
 * principalCredential 为合成测试令牌或真实凭据持有方注入的凭据字符串——本适配器只透传，
 * 不生成、不存储、不写日志；C 路集成使用 CLI 注入的合成测试 token（非生产认证）。
 * actorRole 固定 'human'（服务端白名单；模型/系统不得冒充）。
 */
export function toHumanActionCommand({ requestId, expectedVersion, action, actorName, note = '', principalCredential }) {
  if (typeof principalCredential !== 'string' || principalCredential === '') {
    throw new Error('principalCredential 缺失：v0.1 下无凭据的正式动作必须失败关闭（不得省略后盲发）');
  }
  if (!['accept_candidate', 'return_for_evidence', 'take_over'].includes(action)) {
    throw new Error(`action 必须为 accept_candidate/return_for_evidence/take_over，实际 ${action}`);
  }
  return { requestId, expectedVersion, action, actorRole: 'human', actorName, note, principalCredential };
}

/** 合同禁用键扫描（服务端结构层也会拒绝；此处前置防呆，返回命中的键）。 */
export function scanForbiddenKeys(candidate) {
  return Object.keys(candidate ?? {}).filter((k) => FORBIDDEN_CANDIDATE_KEYS.includes(k.toLowerCase()));
}
