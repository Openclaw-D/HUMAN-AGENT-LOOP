import { randomBytes } from 'node:crypto';
import { newId, sha256Hex } from '../ids.mjs';
import { ConnError } from '../errors.mjs';
import { audit } from '../wecom/consent.mjs';

/**
 * 任务02 · B1/W01 分级邀请与已验证企业绑定。
 *
 * - 商机只负责触发：邀请永远引用既有 customerId（客户法律主档由 A 唯一持有，
 *   UNIQUE(tenant, legal_entity_ref)、禁止自动合并）；本服务不做主档归并。
 * - 分级：实控人/厂长/财务各自获得明确的证据 kind 上传范围与对象锚定范围，
 *   接受邀请不授予任何内部权限（客户侧身份仅此而已）。
 * - 接受 ≠ 验证：接受邀请只落 candidate 绑定（声明级关联）；只有操作者凭核验
 *   依据（evidenceRefs 非空）执行 verifyBinding 后才 active，才能被渠道 resolve。
 * - 邀请令牌一次性：token 原文只在签发响应出现一次，库中仅存 sha256。
 */

export const INTAKE_ROLES = Object.freeze([
  'customer_owner', 'plant_manager', 'customer_finance', 'customer_contact',
]);

export function makeIntakeService(store, { bindings }) {
  /** 签发分级邀请（内部操作者动作，服务令牌面）。返回 token 原文仅此一次。 */
  async function issueInvitation(i) {
    if (!i.tenantId || !i.customerId || !i.role || !Array.isArray(i.allowedEvidenceKinds) || i.allowedEvidenceKinds.length === 0) {
      throw new ConnError('INVALID_INPUT', 'issueInvitation: tenantId/customerId/role/allowedEvidenceKinds required');
    }
    if (!INTAKE_ROLES.includes(i.role)) throw new ConnError('INVALID_INPUT', `issueInvitation: role 必须是 ${INTAKE_ROLES.join('/')}`);
    for (const k of i.allowedEvidenceKinds) {
      if (typeof k !== 'string' || !k) throw new ConnError('INVALID_INPUT', 'issueInvitation: allowedEvidenceKinds 必须是非空字符串数组');
    }
    if (i.ttlSec == null || i.ttlSec <= 0) throw new ConnError('INVALID_INPUT', 'issueInvitation: ttlSec 必须为正数');
    const invitationId = newId('inv');
    const token = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + i.ttlSec * 1000);
    await store.query(
      `INSERT INTO intake_invitations
         (invitation_id, tenant_id, customer_id, session_id, role, allowed_evidence_kinds, object_refs,
          token_hash, status, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10)`,
      [invitationId, i.tenantId, i.customerId, i.sessionId ?? null, i.role,
       JSON.stringify(i.allowedEvidenceKinds), JSON.stringify(i.objectRefs ?? []),
       sha256Hex(token), expiresAt, i.createdBy ?? 'api'],
    );
    await audit(store, {
      tenantId: i.tenantId, actor: i.createdBy ?? 'api', action: 'INVITATION_ISSUED', targetType: 'invitation', targetId: invitationId,
      summary: `customer=${i.customerId} role=${i.role} kinds=${i.allowedEvidenceKinds.join(',')} objects=${(i.objectRefs ?? []).join(',') || '*'}`,
    });
    return { invitationId, token, role: i.role, expiresAt };
  }

  /** 客户侧接受邀请：换绑外部联系人 → candidate 绑定（声明级，未验证）。一次有效。 */
  async function acceptInvitation({ tenantId, token, provider, providerUserId, threadScope = null }) {
    if (!tenantId || !token || !provider || !providerUserId) {
      throw new ConnError('INVALID_INPUT', 'acceptInvitation: tenantId/token/provider/providerUserId required');
    }
    const rows = (await store.query(
      `SELECT invitation_id, customer_id, session_id, role, status, expires_at, accepted_binding_id
       FROM intake_invitations WHERE tenant_id=$1 AND token_hash=$2`,
      [tenantId, sha256Hex(token)],
    )).rows;
    if (rows.length === 0) throw new ConnError('TOKEN_INVALID', 'acceptInvitation: 邀请令牌无效');
    const inv = rows[0];
    if (inv.status === 'revoked') throw new ConnError('INVALID_STATE', 'acceptInvitation: 邀请已撤销');
    if (inv.status === 'accepted' || inv.accepted_binding_id) throw new ConnError('INVALID_STATE', 'acceptInvitation: 邀请已被使用（一次有效）');
    if (new Date(inv.expires_at).getTime() <= Date.now()) {
      await store.query(`UPDATE intake_invitations SET status='expired' WHERE invitation_id=$1 AND status='pending'`, [inv.invitation_id]);
      throw new ConnError('TOKEN_EXPIRED', 'acceptInvitation: 邀请已过期');
    }
    const bound = await bindings.bind({
      tenantId, provider, providerUserId, customerId: inv.customer_id,
      verifiedBy: `invitation:${inv.invitation_id}`, threadScope,
    });
    if (bound.existed) {
      // IR-03-8③ 绑定幂等回执：同联系人↔同客户的既有绑定（candidate/active）不使新邀请空转——
      // 本邀请显式推进 accepted 并挂接既有绑定（不新建、不二次推进绑定状态）；
      // 同 token 重放仍被上方"一次有效"拦截，语义不变。
      const upd = await store.query(
        `UPDATE intake_invitations SET status='accepted', accepted_binding_id=$3, accepted_at=now()
         WHERE invitation_id=$1 AND tenant_id=$2 AND status='pending' RETURNING invitation_id`,
        [inv.invitation_id, tenantId, bound.bindingId],
      );
      if (upd.rows.length > 0) {
        await audit(store, {
          tenantId, actor: `invitation:${inv.invitation_id}`, action: 'INVITATION_ACCEPTED', targetType: 'binding', targetId: bound.bindingId,
          summary: `customer=${inv.customer_id} role=${inv.role} binding=${bound.status}(既有绑定幂等挂接；未验证)`,
        });
      }
      return {
        invitationId: inv.invitation_id, bindingId: bound.bindingId, bindingStatus: bound.status,
        role: inv.role, customerId: inv.customer_id, existed: true,
        invitationAccepted: upd.rows.length > 0,
        note: upd.rows.length > 0 ? '既有绑定：本邀请已幂等挂接为 accepted（接受≠验证）' : '邀请此前已接受（幂等重放）',
      };
    }
    await store.query(`UPDATE participant_bindings SET status='candidate' WHERE binding_id=$1 AND tenant_id=$2`, [bound.bindingId, tenantId]);
    await store.query(
      `UPDATE intake_invitations SET status='accepted', accepted_binding_id=$3, accepted_at=now()
       WHERE invitation_id=$1 AND tenant_id=$2 AND status='pending'`,
      [inv.invitation_id, tenantId, bound.bindingId],
    );
    await audit(store, {
      tenantId, actor: `invitation:${inv.invitation_id}`, action: 'INVITATION_ACCEPTED', targetType: 'binding', targetId: bound.bindingId,
      summary: `customer=${inv.customer_id} role=${inv.role} binding=candidate(未验证)`,
    });
    return { invitationId: inv.invitation_id, bindingId: bound.bindingId, bindingStatus: 'candidate', role: inv.role, customerId: inv.customer_id, existed: false };
  }

  /** 操作者核验绑定：凭非空核验依据把 candidate → active（此后才能被渠道 resolve）。 */
  async function verifyBinding({ tenantId, bindingId, verifiedBy, evidenceRefs }) {
    if (!tenantId || !bindingId || !verifiedBy) throw new ConnError('INVALID_INPUT', 'verifyBinding: tenantId/bindingId/verifiedBy required');
    const refs = Array.isArray(evidenceRefs) ? evidenceRefs.filter((x) => typeof x === 'string' && x) : [];
    if (refs.length === 0) throw new ConnError('INVALID_INPUT', 'verifyBinding: evidenceRefs 必须非空（核验依据可回溯）');
    const rows = (await store.query(
      `SELECT status, customer_id FROM participant_bindings WHERE tenant_id=$1 AND binding_id=$2`,
      [tenantId, bindingId],
    )).rows;
    if (rows.length === 0) throw new ConnError('NOT_FOUND', `binding ${bindingId}`);
    if (rows[0].status === 'revoked') throw new ConnError('INVALID_STATE', 'verifyBinding: 绑定已撤销');
    await store.query(
      `UPDATE participant_bindings SET status='active', verified_by=$3, evidence_refs=$4 WHERE binding_id=$1 AND tenant_id=$2`,
      [bindingId, tenantId, verifiedBy, JSON.stringify(refs)],
    );
    await audit(store, {
      tenantId, actor: verifiedBy, action: 'BINDING_VERIFIED', targetType: 'binding', targetId: bindingId,
      summary: `customer=${rows[0].customer_id} evidence=${refs.join(',')}`,
    });
    return { ok: true, bindingId, status: 'active' };
  }

  /** 上传范围检查（供上传路径调用）：邀请必须 accepted、未过期未撤销、kind 在该角色的获准清单、对象在锚定范围。
   *  任务02（IR-04-2A-1）：返回邀请归属 customer_id——调用方必须与上传声明的 customerId 比对，
   *  不一致拒绝（伪造客户字段不得借他人邀请上传）。 */
  async function checkUploadScope({ tenantId, invitationId, kind, objectRef = null }) {
    if (!tenantId || !invitationId || !kind) throw new ConnError('INVALID_INPUT', 'checkUploadScope: tenantId/invitationId/kind required');
    const rows = (await store.query(
      `SELECT customer_id, role, allowed_evidence_kinds, object_refs, status, expires_at FROM intake_invitations
       WHERE tenant_id=$1 AND invitation_id=$2`,
      [tenantId, invitationId],
    )).rows;
    if (rows.length === 0) throw new ConnError('NOT_FOUND', `invitation ${invitationId}`);
    const inv = rows[0];
    if (inv.status !== 'accepted') throw new ConnError('INVALID_STATE', `checkUploadScope: 邀请状态 ${inv.status} 不允许上传`);
    if (new Date(inv.expires_at).getTime() <= Date.now()) throw new ConnError('TOKEN_EXPIRED', 'checkUploadScope: 邀请已过期');
    const kinds = inv.allowed_evidence_kinds ?? [];
    if (!Array.isArray(kinds) || !kinds.includes(kind)) {
      throw new ConnError('CUSTOMER_SCOPE_MISMATCH', `checkUploadScope: 角色 ${inv.role} 未获准上传 kind=${kind}`);
    }
    const objects = inv.object_refs ?? [];
    if (Array.isArray(objects) && objects.length > 0 && (objectRef == null || !objects.includes(objectRef))) {
      throw new ConnError('CUSTOMER_SCOPE_MISMATCH', `checkUploadScope: 对象 ${objectRef ?? '(无)'} 不在该邀请的锚定范围`);
    }
    return { ok: true, role: inv.role, customerId: inv.customer_id };
  }

  /** 撤销邀请：停用尚未接受的邀请；已接受的邀请撤销后其上传范围检查立即失效。 */
  async function revokeInvitation({ tenantId, invitationId, actor }) {
    const r = await store.query(
      `UPDATE intake_invitations SET status='revoked' WHERE tenant_id=$1 AND invitation_id=$2 AND status IN ('pending','accepted') RETURNING invitation_id`,
      [tenantId, invitationId],
    );
    if (r.rows.length === 0) throw new ConnError('NOT_FOUND', `invitation ${invitationId}（或已终态）`);
    await audit(store, { tenantId, actor: actor ?? 'api', action: 'INVITATION_REVOKED', targetType: 'invitation', targetId: invitationId, summary: 'status=revoked' });
    return { ok: true };
  }

  return { issueInvitation, acceptInvitation, verifyBinding, checkUploadScope, revokeInvitation, INTAKE_ROLES };
}
