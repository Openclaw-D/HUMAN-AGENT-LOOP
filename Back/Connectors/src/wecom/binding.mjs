import { newId } from '../ids.mjs';
import { ConnError } from '../errors.mjs';
import { audit } from './consent.mjs';

/**
 * ParticipantBinding：external contact（联系人）≠ 客户法律主体。
 * customerId 只能来自受控绑定；外部回调携带的任何业务 customerId 一律忽略（I08）。
 * 同一 providerUserId 命中多个 active 全局绑定 → ambiguous，进入隔离区，等待显式
 * thread 上下文绑定，绝不"选最像的客户"（I07）。
 */

export function makeBindingService(store) {
  async function bind({ tenantId, provider, providerUserId, customerId, verifiedBy, consentRef = null, threadScope = null }) {
    if (!tenantId || !provider || !providerUserId || !customerId || !verifiedBy) {
      throw new ConnError('INVALID_INPUT', 'bind: tenantId/provider/providerUserId/customerId/verifiedBy required');
    }
    const existing = await store.query(
      `SELECT binding_id, status FROM participant_bindings
       WHERE tenant_id=$1 AND provider=$2 AND provider_user_id=$3 AND customer_id=$4 AND COALESCE(thread_scope,'')=COALESCE($5,'')`,
      [tenantId, provider, providerUserId, customerId, threadScope],
    );
    if (existing.rows.length > 0) return { bindingId: existing.rows[0].binding_id, status: existing.rows[0].status, existed: true };
    const bindingId = newId('bnd');
    await store.query(
      `INSERT INTO participant_bindings (binding_id, tenant_id, provider, provider_user_id, customer_id, thread_scope, status, verified_by, consent_ref)
       VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8)`,
      [bindingId, tenantId, provider, providerUserId, customerId, threadScope, verifiedBy, consentRef],
    );
    await audit(store, { tenantId, actor: verifiedBy, action: 'BINDING_CREATED', targetType: 'binding', targetId: bindingId, summary: `${provider}:${providerUserId} -> ${customerId}${threadScope ? ` @${threadScope}` : ''}` });
    return { bindingId, status: 'active', existed: false };
  }

  async function setStatus({ tenantId, bindingId, status, actor }) {
    const r = await store.query(
      `UPDATE participant_bindings SET status=$3 WHERE tenant_id=$1 AND binding_id=$2 RETURNING binding_id`,
      [tenantId, bindingId, status],
    );
    if (r.rows.length === 0) throw new ConnError('NOT_FOUND', `binding ${bindingId}`);
    await audit(store, { tenantId, actor, action: `BINDING_${status.toUpperCase()}`, targetType: 'binding', targetId: bindingId, summary: `status=${status}` });
    return { ok: true };
  }

  /**
   * 解析：返回 {status:'resolved', customerId, consentRef} | {status:'ambiguous', candidates} | {status:'unbound'}
   * threadId 上下文可命中 thread-scope 绑定；全局歧义必须人工通过 threadScope 绑定消除。
   */
  async function resolve({ tenantId, provider, providerUserId, threadId = null }) {
    const r = await store.query(
      `SELECT binding_id, customer_id, thread_scope, status, consent_ref FROM participant_bindings
       WHERE tenant_id=$1 AND provider=$2 AND provider_user_id=$3 AND status='active'`,
      [tenantId, provider, providerUserId],
    );
    const scoped = threadId ? r.rows.filter((x) => x.thread_scope === threadId) : [];
    if (scoped.length === 1) return { status: 'resolved', customerId: scoped[0].customer_id, consentRef: scoped[0].consent_ref, via: 'thread_scope' };
    const global = r.rows.filter((x) => x.thread_scope == null);
    if (global.length === 1) return { status: 'resolved', customerId: global[0].customer_id, consentRef: global[0].consent_ref, via: 'global' };
    if (global.length > 1) {
      return { status: 'ambiguous', candidates: global.map((x) => ({ bindingId: x.binding_id, customerId: x.customer_id })) };
    }
    return { status: 'unbound' };
  }

  return { bind, setStatus, resolve };
}
