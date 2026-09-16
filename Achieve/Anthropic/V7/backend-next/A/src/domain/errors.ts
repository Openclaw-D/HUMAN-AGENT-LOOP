// 统一错误：code 映射 CONTRACT §4 错误码表；message 面向调用方，绝不内嵌凭据。
export type ErrorCode =
  | 'INVALID_INPUT' | 'FORBIDDEN_KEY' | 'DEPENDENCY_CYCLE'
  | 'PRINCIPAL_UNTRUSTED' | 'ROLE_FORBIDDEN' | 'PROJECT_FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT' | 'REQUEST_MISMATCH' | 'GOAL_EXISTS' | 'NOT_READY'
  | 'LEASE_EXPIRED' | 'STALE_FENCING_TOKEN' | 'PROJECT_PAUSED'
  | 'EVIDENCE_SUPERSEDED' | 'HUMAN_REQUEST_CLOSED' | 'MODEL_NOT_CONFIGURED'
  | 'UPSTREAM_STALE'
  | 'TERMINAL_STATE' | 'DB_UNAVAILABLE' | 'INTERNAL';

const HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400, FORBIDDEN_KEY: 400, DEPENDENCY_CYCLE: 400,
  PRINCIPAL_UNTRUSTED: 403, ROLE_FORBIDDEN: 403, PROJECT_FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409, REQUEST_MISMATCH: 409, GOAL_EXISTS: 409, NOT_READY: 409,
  LEASE_EXPIRED: 409, STALE_FENCING_TOKEN: 409, PROJECT_PAUSED: 409,
  EVIDENCE_SUPERSEDED: 409, HUMAN_REQUEST_CLOSED: 409, MODEL_NOT_CONFIGURED: 409,
  UPSTREAM_STALE: 409,
  TERMINAL_STATE: 409, DB_UNAVAILABLE: 500, INTERNAL: 500,
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
