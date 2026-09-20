import { ConnError } from '../errors.mjs';

// Only gateway-established JW identities qualify. External provider IDs are not JW principals.
export const JW_UPLOAD_PROVIDER = 'jw_principal';

export function delegatedUploadPrincipal({ callerBindings, serviceToken, tenantId, actorPrincipal }) {
  const binding = Array.isArray(callerBindings) ? callerBindings.find(b => b.token === serviceToken) : null;
  if (!binding || !serviceToken || binding.mayDelegateActor !== true)
    throw new ConnError('ACTOR_NOT_DELEGABLE', '上传上下文要求显式代理凭据');
  if (!Array.isArray(binding.tenantIds) || !binding.tenantIds.includes(tenantId))
    throw new ConnError('TENANT_SCOPE_MISMATCH', '代理凭据未获准该租户');
  if (typeof actorPrincipal !== 'string' || !actorPrincipal.trim())
    throw new ConnError('CALLER_NOT_TRUSTED', '缺少可信登录身份');
  return actorPrincipal;
}

export function makeUploadContextService(store, { now = () => Date.now(), lock = false } = {}) {
  async function read({ tenantId, customerId, principalId }) {
    const unavailable = reason => ({ customerId, available: false, reason, bindingRef: null,
      invitationId: null, allowedKinds: [], allowedObjects: [], expiresAt: null });
    if (![tenantId, customerId, principalId].every(v => typeof v === 'string' && v.length > 0))
      return unavailable('IDENTITY_UNPROVEN');
    // Read only: never create, renew, accept or pick the latest invitation.
    const { rows } = await store.query(`
      SELECT b.binding_id, b.status AS binding_status, i.invitation_id,
             i.status AS invitation_status, i.allowed_evidence_kinds, i.object_refs, i.expires_at
      FROM participant_bindings b JOIN intake_invitations i
        ON i.accepted_binding_id=b.binding_id AND i.tenant_id=b.tenant_id AND i.customer_id=b.customer_id
      WHERE b.tenant_id=$1 AND b.customer_id=$2 AND b.provider=$3 AND b.provider_user_id=$4
        AND b.thread_scope IS NULL${lock ? ' FOR SHARE OF b, i' : ''}`, [tenantId, customerId, JW_UPLOAD_PROVIDER, principalId]);
    const valid = rows.filter(row => row.binding_status === 'active' && row.invitation_status === 'accepted' &&
      Number.isFinite(new Date(row.expires_at).getTime()) && new Date(row.expires_at).getTime() > now());
    if (!valid.length) return unavailable('NO_ACTIVE_UPLOAD_BINDING');
    if (valid.length !== 1) return unavailable('AMBIGUOUS_UPLOAD_BINDING');
    const row = valid[0];
    if (!Array.isArray(row.allowed_evidence_kinds) || !row.allowed_evidence_kinds.length ||
        !row.allowed_evidence_kinds.every(v => typeof v === 'string' && v.length > 0) ||
        !Array.isArray(row.object_refs) || !row.object_refs.every(v => typeof v === 'string' && v.length > 0))
      return unavailable('INVALID_UPLOAD_SCOPE');
    return { customerId, available: true, reason: null, bindingRef: row.binding_id,
      invitationId: row.invitation_id, allowedKinds: [...row.allowed_evidence_kinds],
      allowedObjects: [...row.object_refs], expiresAt: new Date(row.expires_at).toISOString() };
  }

  async function assertUpload({ tenantId, customerId, principalId, invitationId, bindingRef, kind, objectRefs = [] }) {
    const context = await read({ tenantId, customerId, principalId });
    if (!context.available || context.invitationId !== invitationId ||
        (bindingRef != null && context.bindingRef !== bindingRef))
      throw new ConnError('CUSTOMER_SCOPE_MISMATCH', '上传授权不存在、失效、歧义或不属于当前身份');
    if (!context.allowedKinds.includes(kind) || !Array.isArray(objectRefs) ||
        !objectRefs.every(v => typeof v === 'string' && v.length > 0) ||
        (context.allowedObjects.length && (!objectRefs.length || objectRefs.some(v => !context.allowedObjects.includes(v)))))
      throw new ConnError('CUSTOMER_SCOPE_MISMATCH', '上传类型或对象不在授权范围');
    return context;
  }
  // The caller must use this transaction for all DB writes; no external side effects in the callback.
  async function withAuthorizedUpload(input, write) {
    if (typeof store.tx !== 'function') throw new ConnError('INTERNAL', '事务存储未装配');
    return store.tx(async tx => {
      const context = await makeUploadContextService(tx, { now, lock: true }).assertUpload(input);
      return write(tx, context);
    });
  }
  return { read, assertUpload, withAuthorizedUpload };
}
