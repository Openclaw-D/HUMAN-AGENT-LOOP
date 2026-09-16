/** Connectors 错误码。HTTP 映射在 http/server.mjs。 */
export const ERR = {
  CALLBACK_BAD_SIGNATURE: { code: 'CALLBACK_BAD_SIGNATURE', http: 403 },
  CALLBACK_EXPIRED: { code: 'CALLBACK_EXPIRED', http: 403 },
  CALLBACK_RECEIVEID_MISMATCH: { code: 'CALLBACK_RECEIVEID_MISMATCH', http: 403 },
  TOKEN_INVALID: { code: 'TOKEN_INVALID', http: 403 },
  TOKEN_EXPIRED: { code: 'TOKEN_EXPIRED', http: 403 },
  TOKEN_ROLE_MISMATCH: { code: 'TOKEN_ROLE_MISMATCH', http: 403 },
  TOKEN_ROOM_MISMATCH: { code: 'TOKEN_ROOM_MISMATCH', http: 403 },
  TOKEN_REUSED: { code: 'TOKEN_REUSED', http: 403 },
  SESSION_NOT_FOUND: { code: 'SESSION_NOT_FOUND', http: 404 },
  INVALID_STATE: { code: 'INVALID_STATE', http: 409 },
  CONSENT_REQUIRED: { code: 'CONSENT_REQUIRED', http: 403 },
  BINDING_AMBIGUOUS: { code: 'BINDING_AMBIGUOUS', http: 409 },
  BINDING_QUARANTINED: { code: 'BINDING_QUARANTINED', http: 409 },
  CUSTOMER_SCOPE_MISMATCH: { code: 'CUSTOMER_SCOPE_MISMATCH', http: 403 },
  TENANT_SCOPE_MISMATCH: { code: 'TENANT_SCOPE_MISMATCH', http: 403 },
  AUDIENCE_MISMATCH: { code: 'AUDIENCE_MISMATCH', http: 403 },
  MEDIA_URL_EXPIRED: { code: 'MEDIA_URL_EXPIRED', http: 403 },
  MEDIA_URL_BAD_SIGNATURE: { code: 'MEDIA_URL_BAD_SIGNATURE', http: 403 },
  MEDIA_URL_CUSTOMER_MISMATCH: { code: 'MEDIA_URL_CUSTOMER_MISMATCH', http: 403 },
  ZIP_UNSAFE: { code: 'ZIP_UNSAFE', http: 422 },
  ARCHIVE_GAP: { code: 'ARCHIVE_GAP', http: 409 },
  OUTBOUND_BLOCKED: { code: 'OUTBOUND_BLOCKED', http: 403 },
  BLOCKED_EXTERNAL: { code: 'BLOCKED_EXTERNAL', http: 501 },
  INVALID_INPUT: { code: 'INVALID_INPUT', http: 400 },
  NOT_FOUND: { code: 'NOT_FOUND', http: 404 },
  RETENTION_HOLD: { code: 'RETENTION_HOLD', http: 409 },
  INTERNAL: { code: 'INTERNAL', http: 500 },
};

export class ConnError extends Error {
  constructor(key, message, extra) {
    super(message || key);
    this.key = key;
    this.http = ERR[key]?.http ?? 500;
    this.code = ERR[key]?.code ?? key;
    if (extra) this.extra = extra;
  }
}
