/** Candidate read adapter; installation requires a real per-request upload authorization source. */
export function createUploadContextReader({ sessionOf, authorizeUpload, fetchContext }) {
  return async ({ req, customerId }) => {
    const session = sessionOf(req);
    const fail = (status, error) => ({ status, body: { ok: false, error } });
    if (!session) return fail(401, 'SESSION_REQUIRED');
    if (typeof authorizeUpload !== 'function' || typeof fetchContext !== 'function')
      return fail(503, 'UPLOAD_AUTHZ_UNAVAILABLE');
    try {
      const grant = await authorizeUpload({ credential: session.credential, principalId: session.principalId, customerId });
      if (!grant?.ok || grant.canRead !== true || grant.canUpload !== true ||
          grant.customerId !== customerId || grant.principalId !== session.principalId || !grant.tenantId)
        return fail(403, 'UPLOAD_FORBIDDEN');
      const context = await fetchContext({ tenantId: grant.tenantId, customerId, principalId: session.principalId });
      // Recheck revocation across the upstream read, not just at request start.
      const current = sessionOf(req);
      if (!current || current.sessionId !== session.sessionId || current.principalId !== session.principalId)
        return fail(401, 'SESSION_REQUIRED');
      const finalGrant = await authorizeUpload({ credential: current.credential, principalId: current.principalId, customerId });
      if (!finalGrant?.ok || finalGrant.canRead !== true || finalGrant.canUpload !== true ||
          finalGrant.customerId !== customerId || finalGrant.principalId !== current.principalId || finalGrant.tenantId !== grant.tenantId)
        return fail(403, 'UPLOAD_FORBIDDEN');
      if (context?.customerId !== customerId || typeof context.available !== 'boolean') return fail(502, 'UPLOAD_CONTEXT_INVALID');
      // Allowlist output; provider IDs, credentials and invitation tokens never reach the browser.
      return { status: 200, body: { ok: true, customerId, available: context.available, reason: context.reason,
        bindingRef: context.available ? context.bindingRef : null, invitationId: context.available ? context.invitationId : null,
        allowedKinds: context.available ? context.allowedKinds : [], allowedObjects: context.available ? context.allowedObjects : [],
        expiresAt: context.available ? context.expiresAt : null } };
    } catch { return fail(503, 'UPLOAD_CONTEXT_UNAVAILABLE'); }
  };
}
