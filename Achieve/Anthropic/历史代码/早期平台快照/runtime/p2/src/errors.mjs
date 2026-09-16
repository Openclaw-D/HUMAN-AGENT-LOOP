export class P2Error extends Error {
  constructor(statusCode, code, message, details = {}) {
    super(message);
    this.name = 'P2Error';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function validationError(message, details = {}) {
  return new P2Error(400, 'VALIDATION_ERROR', message, details);
}

export function unauthorized(message, details = {}) {
  return new P2Error(401, 'AUTHENTICATION_REQUIRED', message, details);
}

export function authorityDenied(message, details = {}) {
  return new P2Error(403, 'AUTHORITY_DENIED', message, details);
}

export function notFound(message, details = {}) {
  return new P2Error(404, 'NOT_FOUND', message, details);
}

export function idempotencyConflict(message, details = {}) {
  return new P2Error(409, 'IDEMPOTENCY_CONFLICT', message, details);
}

export function versionConflict(message, details = {}) {
  return new P2Error(409, 'VERSION_CONFLICT', message, details);
}

export function invalidTransition(message, details = {}) {
  return new P2Error(409, 'INVALID_TRANSITION', message, details);
}

export function unsupportedMediaType(message, details = {}) {
  return new P2Error(415, 'UNSUPPORTED_MEDIA_TYPE', message, details);
}

export function payloadTooLarge(message, details = {}) {
  return new P2Error(413, 'PAYLOAD_TOO_LARGE', message, details);
}

export function integrityFailure(message, details = {}) {
  return new P2Error(500, 'INTEGRITY_FAILURE', message, details);
}

export function internalError(message, details = {}) {
  return new P2Error(500, 'INTERNAL_ERROR', message, details);
}

export function storageUnavailable(message, details = {}) {
  return new P2Error(503, 'STORAGE_UNAVAILABLE', message, details);
}

export function modelUnavailable(message, details = {}) {
  return new P2Error(503, 'MODEL_UNAVAILABLE', message, details);
}
