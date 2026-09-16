export class AppError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function assert(condition, code, message, status = 400, details = undefined) {
  if (!condition) throw new AppError(code, message, status, details);
}

export function asErrorEnvelope(error, traceId = null) {
  const known = error instanceof AppError;
  return {
    status: known ? error.status : 500,
    body: {
      error: {
        code: known ? error.code : 'INTERNAL_ERROR',
        message: known ? error.message : 'RelayOS 遇到未预期错误。',
        ...(known && error.details !== undefined ? { details: error.details } : {}),
        traceId,
      },
    },
  };
}
