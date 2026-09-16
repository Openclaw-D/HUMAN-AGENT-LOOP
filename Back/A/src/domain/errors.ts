// 统一错误：code 映射 CONTRACT §4 错误码表；message 面向调用方，绝不内嵌凭据。
export type ErrorCode =
  | 'INVALID_INPUT' | 'FORBIDDEN_KEY' | 'DEPENDENCY_CYCLE'
  | 'PRINCIPAL_UNTRUSTED' | 'ROLE_FORBIDDEN' | 'PROJECT_FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT' | 'REQUEST_MISMATCH' | 'GOAL_EXISTS' | 'NOT_READY'
  | 'LEASE_EXPIRED' | 'STALE_FENCING_TOKEN' | 'PROJECT_PAUSED'
  | 'EVIDENCE_SUPERSEDED' | 'HUMAN_REQUEST_CLOSED' | 'MODEL_NOT_CONFIGURED'
  | 'UPSTREAM_STALE'
  | 'TERMINAL_STATE' | 'DB_UNAVAILABLE' | 'INTERNAL'
  // ---- v2 客户授信内核（任务01；S1_API_V2_SCHEMA_PROPOSAL §5）----
  | 'PERMISSION_DENIED'            // 403 角色/金额档不满足（A19）
  | 'CUSTOMER_SCOPE_VIOLATION'     // 403/404 跨租户/客户越权（A10）
  | 'POLICY_PENDING'               // 409 权限矩阵/政策缺失，不猜测（P-03/P-05）
  | 'IDEMPOTENCY_REPLAY_CONFLICT'  // 409 同 requestId 异载荷（A09）
  | 'CUSTOMER_EXISTS'              // 409 同一法定主体重复建档
  | 'FACILITY_NOT_ACTIVE'          // 409 非 active/过期/暂停下新增支用（A14/A17）
  | 'INSUFFICIENT_AVAILABLE_AMOUNT'// 409 可用额不足（A07/A01）
  | 'PRODUCT_CAP_EXCEEDED'         // 409 超 1,000 万产品上限（A06）
  | 'STALE_BASIS'                  // 409 依据已失效须重评（A15）
  | 'RESERVATION_IRREVERSIBLE_STATE' // 409 外部 unknown，禁自动释放/盲重发（A12）
  | 'CURRENCY_MISMATCH'            // 409 币种不一致（A06）
  | 'CONCENTRATION_BLOCKED'        // 409 关联组/集中度约束未过（A24）
  | 'ARTIFACT_SUPERSEDED'          // 409 工件已被更正版取代
  // ---- 检查会话域（任务一；docs/INSPECTION_SESSION_V1.md §4）----
  | 'PLAN_CHANGED'                 // 409 开始时计划版本已前移：拒绝过时开始或显式接受新计划（A03）
  | 'OUTBOUND_PAUSED'              // 409 会话外发已暂停：不授予新的自动外发（A04）
  | 'STALE_DISPATCH_GENERATION'    // 409 旧调度代际申请外发被拒（A04）
  | 'SEND_UNKNOWN_RECONCILE'       // 409 发送结果未知：先对账/转人工，不得换 requestId 重问（A05）
  | 'QUESTION_CLOSED'              // 409 问题已答/已关，不接受新回答（A05 重复回调不重复记账）
  | 'FOLLOWUP_LIMIT_REACHED'       // 409 追问/等待越界：转一次待办，不无限重试（A07）
  | 'ANSWER_REQUIRES_HUMAN'        // 403 真人关键核验不得由 Agent 代答
  | 'SCENE_ANCHOR_STALE'           // 409 场景版本前移后旧锚定动作被拒，须显式重关联（A11）
  | 'SESSION_NOT_RUNNING'          // 409 会话不在 in_progress：命令与运行状态不符
  | 'INSPECTION_CLOSED'            // 409 会话已收口（closed）后的业务写被拒
  // ---- 任务02 决策闭环（Back/A/docs/DECISION_LOOP_V1.md §5）----
  | 'REVIEW_REQUIRED'              // 409 差异复核/域依赖更新未完成：正式动作阻断，返回具体缺口
  | 'REVIEW_EVIDENCE_REQUIRED'     // 409 无所需证据不能关闭关键复核；ack/口述不算核验（B04）
  | 'GATE_BLOCKED'                 // 409 Gate HARD_BLOCK/NEEDS_EVIDENCE：无通用放行（3.4/B04）
  | 'COOLING_ACTIVE';              // 409 提额冷却期内：新动作不得生效（B11；冷却不豁免复核）

const HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400, FORBIDDEN_KEY: 400, DEPENDENCY_CYCLE: 400,
  PRINCIPAL_UNTRUSTED: 403, ROLE_FORBIDDEN: 403, PROJECT_FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409, REQUEST_MISMATCH: 409, GOAL_EXISTS: 409, NOT_READY: 409,
  LEASE_EXPIRED: 409, STALE_FENCING_TOKEN: 409, PROJECT_PAUSED: 409,
  EVIDENCE_SUPERSEDED: 409, HUMAN_REQUEST_CLOSED: 409, MODEL_NOT_CONFIGURED: 409,
  UPSTREAM_STALE: 409,
  TERMINAL_STATE: 409, DB_UNAVAILABLE: 500, INTERNAL: 500,
  PERMISSION_DENIED: 403, CUSTOMER_SCOPE_VIOLATION: 403, POLICY_PENDING: 409,
  IDEMPOTENCY_REPLAY_CONFLICT: 409, CUSTOMER_EXISTS: 409, FACILITY_NOT_ACTIVE: 409,
  INSUFFICIENT_AVAILABLE_AMOUNT: 409, PRODUCT_CAP_EXCEEDED: 409, STALE_BASIS: 409,
  RESERVATION_IRREVERSIBLE_STATE: 409, CURRENCY_MISMATCH: 409, CONCENTRATION_BLOCKED: 409,
  ARTIFACT_SUPERSEDED: 409,
  PLAN_CHANGED: 409, OUTBOUND_PAUSED: 409, STALE_DISPATCH_GENERATION: 409, SEND_UNKNOWN_RECONCILE: 409,
  QUESTION_CLOSED: 409, FOLLOWUP_LIMIT_REACHED: 409, ANSWER_REQUIRES_HUMAN: 403,
  SCENE_ANCHOR_STALE: 409, SESSION_NOT_RUNNING: 409, INSPECTION_CLOSED: 409,
  REVIEW_REQUIRED: 409, REVIEW_EVIDENCE_REQUIRED: 409, GATE_BLOCKED: 409, COOLING_ACTIVE: 409,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly extra: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.status = HTTP_STATUS[code];
    this.extra = extra;
  }
}

export const invalid = (m: string) => new AppError('INVALID_INPUT', m);
export const conflict = (code: ErrorCode, m: string, extra: Record<string, unknown> = {}) => new AppError(code, m, extra);
export const forbidden = (code: ErrorCode, m: string) => new AppError(code, m);
export const notFound = (m: string) => new AppError('NOT_FOUND', m);
