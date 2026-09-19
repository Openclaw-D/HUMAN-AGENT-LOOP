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
  // 任务02 受控映射链 + 上传归属一致性（IR-04-2A-1）
  CUSTOMER_MISMATCH: { code: 'CUSTOMER_MISMATCH', http: 403 },          // 上传声明 customerId 与邀请归属客户不一致
  LINK_CONFLICT: { code: 'LINK_CONFLICT', http: 409 },                  // 客户已映射到不同 A 客户（不覆盖不劫持）
  LINK_OWNERSHIP_MISMATCH: { code: 'LINK_OWNERSHIP_MISMATCH', http: 422 }, // legalEntityRef 与 A 档案不一致
  A_UNREACHABLE: { code: 'A_UNREACHABLE', http: 503 },                  // A 权威核验不可达（可重试）
  // 任务02 actor 可信来源（IR-04-2A-3）：token→调用方绑定，非代理调用方不得自报人类 actor
  ACTOR_NOT_DELEGABLE: { code: 'ACTOR_NOT_DELEGABLE', http: 403 },      // 该调用方令牌无 actor 代理权（自报被拒）
  CALLER_NOT_TRUSTED: { code: 'CALLER_NOT_TRUSTED', http: 403 },        // 显式 callerBindings 未含此令牌（人工动作面 fail closed）
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
