// 协议常量(唯一事实来源)。role 等协议标识与错误码一律英文;
// 面向用户的 message 文本一律中文(在调用点生成,不在此处)。

export const CONTRACT_VERSION = 'v1';

/** analyze 结果的七种显式状态(任务书要求必须可区分)。 */
export const STATUS = Object.freeze({
  NOT_CONFIGURED: 'not_configured', // provider 未注入/未配置,确定未发起任何外部调用
  SIMULATED: 'simulated',           // 结果来自受控模拟 provider(必须显著标记,不得当 succeeded)
  SUCCEEDED: 'succeeded',           // 结构与引用校验通过,且快照未过期
  FAILED: 'failed',                 // 请求非法 / transport 报错 / 输出校验失败(绝不伪装成功)
  UNKNOWN: 'unknown',               // 请求可能已送达外部,结果不可知(超时/送出后取消/transport 不可判定)
  STALE: 'stale',                   // 外部调用已发生且结果已取回,但返回时 generation/contextVersion/暂停态已变化
  CANCELLED: 'cancelled',           // 确定未送达外部即终止(送出前取消、会话暂停拒绝、transport 证明未发送)
});

/** 错误码(英文协议标识)。result.error.message 承载中文解释。 */
export const ERROR_CODES = Object.freeze({
  TRANSPORT_NOT_CONFIGURED: 'TRANSPORT_NOT_CONFIGURED',
  REQUEST_INVALID: 'REQUEST_INVALID',
  UNKNOWN_ROLE: 'UNKNOWN_ROLE',
  PURPOSE_NOT_ALLOWED: 'PURPOSE_NOT_ALLOWED',
  REQUEST_MISMATCH: 'REQUEST_MISMATCH',
  SESSION_PAUSED: 'SESSION_PAUSED',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  CANCELLED_BEFORE_SEND: 'CANCELLED_BEFORE_SEND',
  ABORTED_AFTER_SEND: 'ABORTED_AFTER_SEND',
  TIMEOUT: 'TIMEOUT',
  TRANSPORT_INDETERMINATE: 'TRANSPORT_INDETERMINATE',
  TRANSPORT_ERROR: 'TRANSPORT_ERROR',
  TRANSPORT_THROWN: 'TRANSPORT_THROWN',
  REGISTRY_AT_CAPACITY: 'REGISTRY_AT_CAPACITY',
  PROVIDER_STATUS_REFUSED: 'PROVIDER_STATUS_REFUSED',
  MALFORMED_OUTPUT: 'MALFORMED_OUTPUT',
  EMPTY_OUTPUT: 'EMPTY_OUTPUT',
  FINDING_TEXT_MISSING: 'FINDING_TEXT_MISSING',
  UNSOURCED_FINDING: 'UNSOURCED_FINDING',
  EVIDENCE_DANGLING: 'EVIDENCE_DANGLING',
  UNAUTHORIZED_OUTPUT: 'UNAUTHORIZED_OUTPUT',
  INTERNAL_ADAPTER_ERROR: 'INTERNAL_ADAPTER_ERROR',
});

/**
 * 确定性错误码(审计裁决 R1 矛盾):status='failed' 需按错误码细分缓存语义——
 * 校验类失败(同载荷重放必同错)可缓存;送出后失败(TRANSPORT_ERROR/THROWN)、
 * 背压与预算拒绝是**非确定性**(人工核实后同ID同载荷重试可能成功),不得缓存挡路。
 */
export const DETERMINISTIC_ERROR_CODES = Object.freeze([
  'REQUEST_INVALID',
  'UNKNOWN_ROLE',
  'PURPOSE_NOT_ALLOWED',
  'REQUEST_MISMATCH',
  'EMPTY_OUTPUT',
  'MALFORMED_OUTPUT',
  'FINDING_TEXT_MISSING',
  'UNSOURCED_FINDING',
  'EVIDENCE_DANGLING',
  'UNAUTHORIZED_OUTPUT',
]);

/** 账本预留状态。 */
export const RESERVATION_STATE = Object.freeze({
  REJECTED: 'rejected',     // 预留被拒(预算不足),从未占用
  RESERVED: 'reserved',     // 已预留,调用进行中
  COMMITTED: 'committed',   // 已按 provider 报告的 usage 结算
  UNKNOWN_HOLD: 'unknown_hold', // 外部调用可能已发生但 usage 未知:保留预留,不记 0、不释放
  RELEASED: 'released',     // 确定未发生外部调用,释放预留
});
