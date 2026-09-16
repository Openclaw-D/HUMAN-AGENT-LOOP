// V7-B 协议常量(B lane 本地)。协议标识/错误码英文;面向用户文本中文。
// 注意:A 的 CONTRACT.md 未发布;此文件是 B 本地实现细节,待 A 合同发布后对账,
// 不构成第二套共享合同(见 HANDOFF-A.md 的接口变更请求流程)。

/** 编排运行终态(与 R1 参考接口的 state 语义对齐,字段名待与 A 对账)。 */
export const RUN_STATE = Object.freeze({
  RUNNING: 'running',
  WAITING_EVIDENCE: 'waiting_evidence', // 补证等待:可恢复,不依赖浏览器连接
  HUMAN_REQUIRED: 'human_required',     // 人工中断:需校验身份/版本的显式 resume
  UNKNOWN: 'unknown',                   // 发送后结果不可知:禁止自动重试
  FAILED: 'failed',                     // 失败关闭(未发送或明确失败)
  COMPLETED: 'completed',               // 全部步骤成功,候选意见汇总(authority=none)
});

/** 单步状态。模型步直接复用 adapter 七状态 + 编排补充态。 */
export const STEP_STATE = Object.freeze({
  PENDING: 'pending',
  BLOCKED: 'blocked',                 // 正式前序未成功,本步不得越过
  INTENT: 'intent',                   // 已记发送意图,尚无回执(崩溃恢复时视为发送后未知)
  NOT_CONFIGURED: 'not_configured',   // 确定未发送
  CANCELLED: 'cancelled',             // 证明未送达即终止
  SUCCEEDED: 'succeeded',
  SIMULATED: 'simulated',             // 受控模拟输出,显著标记,不当 succeeded
  FAILED: 'failed',
  UNKNOWN: 'unknown',
  STALE: 'stale',                     // 结果已取回但版本已变化,不得当现行
  HUMAN_VIOLATION: 'human_violation', // 输出越权/结构违规,需人工处理(非普通失败)
  WAITING_EVIDENCE: 'waiting_evidence', // 工具/模型缺输入,不得补造
});

/** 终态优先级:越靠前越保守(对外部世界的不确定性优先如实上报)。 */
export const TERMINAL_PRIORITY = Object.freeze([
  'unknown',
  'human_required',
  'failed',
  'waiting_evidence',
  'completed',
]);

/** 人工动作(B 本地 v0;A 合同的 humanAction 对账项)。 */
export const HUMAN_ACTION = Object.freeze({
  PROVIDE_EVIDENCE: 'provide_evidence',
  RETRY_STEP: 'retry_step',               // 显式人工重试(unknown 核实后 / failed 后)
  ACCEPT_AND_COMPLETE: 'accept_and_complete', // 记录人工接受决定;不改变模型 authority=none
  ABORT: 'abort',
});

export const ERROR_CODES = Object.freeze({
  RUN_NOT_FOUND: 'RUN_NOT_FOUND',
  RUN_NOT_RESUMABLE: 'RUN_NOT_RESUMABLE',
  ACTOR_REQUIRED: 'ACTOR_REQUIRED',
  ACTOR_ROLE_UNAUTHORIZED: 'ACTOR_ROLE_UNAUTHORIZED',
  ACTION_NOT_ALLOWED: 'ACTION_NOT_ALLOWED',
  VERSION_CHANGED: 'VERSION_CHANGED',
  TERMINAL_STATE: 'TERMINAL_STATE',
  INVALID_RESUME: 'INVALID_RESUME',
  // D-9 可信恢复身份:身份验证失败(未配置验证器/缺凭据/验证失败/非 human)与授权拒绝分列
  PRINCIPAL_UNTRUSTED: 'PRINCIPAL_UNTRUSTED',
  AUTHORIZATION_DENIED: 'AUTHORIZATION_DENIED',
});

/** 候选意见白名单:模型输出只能落到这些字段,authority 恒为 none。
 *  recommendedHumanAction 为单字符串枚举,对齐 A 合同 v0 与 C candidate-schema:
 *  'accept_candidate' | 'return_for_evidence' | 'take_over' | 'none'。 */
export const CANDIDATE_FIELDS = Object.freeze([
  'observations',
  'evidenceRefs',
  'assumptions',
  'uncertainty',
  'recommendedHumanAction',
]);

export const HUMAN_ACTION_ENUM = Object.freeze(['accept_candidate', 'return_for_evidence', 'take_over', 'need_more_evidence']);
// 注:2026-09-15 实测 A 服务端与 C(candidate-schema v1.1.0)枚举已一致(need_more_evidence,
// 无 none)。B 内部 'none' 仅是"无建议"哨兵:A 边界省略该键;C 边界由调用方显式投影
// (见 toCCandidate 的 whenNone)。待 A 把该枚举写进合同文本(ICR-1 已改为文档澄清请求)。
