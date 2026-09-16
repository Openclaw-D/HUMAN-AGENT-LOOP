// V7 backend-next B 协议常量(B lane 本地)。协议标识/错误码英文;面向用户文本中文。
// 对账状态:A 尚未发布 backend-next CONTRACT.md(2026-09-16 夜间启动时不存在);
// 本文件是 B 本地实现语义,待 A 合同发布后逐项对账,不构成第二套共享合同。
// 继承 V7/backend/B 的三分发送语义(47/47 验证过的语义不动),新增 worker/fencing 常量。

/** 编排运行终态(保守优先级见 TERMINAL_PRIORITY)。 */
export const RUN_STATE = Object.freeze({
  RUNNING: 'running',
  WAITING_EVIDENCE: 'waiting_evidence', // 补证等待:可恢复,不依赖进程存活
  HUMAN_REQUIRED: 'human_required',     // 人工中断:需校验身份/版本的显式 resume
  UNKNOWN: 'unknown',                   // 发送后结果不可知:禁止自动重试
  FAILED: 'failed',                     // 失败关闭(未发送或明确失败)
  COMPLETED: 'completed',               // 全部步骤成功,候选意见汇总(authority=none)
});

/** 单步状态。三分原则:未发送 ≠ 失败 ≠ 发送后未知,不可合并。 */
export const STEP_STATE = Object.freeze({
  PENDING: 'pending',
  BLOCKED: 'blocked',                 // 前序未成功,本步不得越过
  INTENT: 'intent',                   // 已记发送意图,尚无回执(崩溃恢复视为发送后未知)
  NOT_CONFIGURED: 'not_configured',   // 确定未发送
  CANCELLED: 'cancelled',             // 证明未送达即终止
  SUCCEEDED: 'succeeded',
  SIMULATED: 'simulated',             // 受控模拟输出,显著标记,不当 succeeded
  FAILED: 'failed',
  UNKNOWN: 'unknown',
  STALE: 'stale',                     // 结果已取回但版本已过期/fencing 失效,不得当现行
  HUMAN_VIOLATION: 'human_violation', // 输出越权/结构违规,需人工处理(非普通失败)
  WAITING_EVIDENCE: 'waiting_evidence', // 工具/模型缺输入,不得补造
});

/** 终态优先级:越靠前越保守(对外部世界的不确定性优先如实上报)。 */
export const TERMINAL_PRIORITY = Object.freeze([
  'unknown', 'human_required', 'failed', 'waiting_evidence', 'completed',
]);

/** 人工动作(B 本地 v0;A 合同的 HumanRequest 回应对账项)。 */
export const HUMAN_ACTION = Object.freeze({
  PROVIDE_EVIDENCE: 'provide_evidence',
  RETRY_STEP: 'retry_step',               // 显式人工重试(unknown 核实后 / failed 后)
  ACCEPT_AND_COMPLETE: 'accept_and_complete', // 记录人工接受;不改变模型 authority=none
  ABORT: 'abort',
});

export const ERROR_CODES = Object.freeze({
  RUN_NOT_FOUND: 'RUN_NOT_FOUND',
  RUN_NOT_RESUMABLE: 'RUN_NOT_RESUMABLE',
  ACTION_NOT_ALLOWED: 'ACTION_NOT_ALLOWED',
  VERSION_CHANGED: 'VERSION_CHANGED',
  TERMINAL_STATE: 'TERMINAL_STATE',
  INVALID_RESUME: 'INVALID_RESUME',
  // D-9 可信恢复身份:身份验证失败与授权拒绝分列,均失败关闭
  PRINCIPAL_UNTRUSTED: 'PRINCIPAL_UNTRUSTED',
  AUTHORIZATION_DENIED: 'AUTHORIZATION_DENIED',
  // B 新增:任务领取/回执/fencing(A 合同对账项)
  NO_ROUTE: 'NO_ROUTE',                     // 规则表无路由:不猜,升级人工
  LEASE_LOST: 'LEASE_LOST',                 // lease 续期失败:本 worker 停止写回
  FENCING_STALE: 'FENCING_STALE',           // A 拒绝:过期 worker 写回(结果按 stale 丢弃)
  VERSION_CONFLICT: 'VERSION_CONFLICT',     // A 拒绝:乐观版本冲突
  TRANSPORT_NOT_CONFIGURED: 'TRANSPORT_NOT_CONFIGURED',
});

/** 候选意见白名单:模型输出只能落到这些字段,authority 恒为 none。 */
export const CANDIDATE_FIELDS = Object.freeze([
  'observations', 'evidenceRefs', 'assumptions', 'uncertainty', 'recommendedHumanAction',
]);

/** 任务执行器类型(路由表的合法取值;超出即拒绝,不猜)。 */
export const EXECUTOR_KINDS = Object.freeze(['model', 'tool']);

/** 回执阶段。intent-无-terminal = 发送状态不可判定(恢复时判 unknown,不自动重发)。 */
export const RECEIPT_PHASE = Object.freeze({ INTENT: 'intent', TERMINAL: 'terminal' });
