import { newId } from '../ids.mjs';
import { ConnError } from '../errors.mjs';
import { audit } from '../wecom/consent.mjs';

/**
 * 留存到期 vs 法律保留（I25）：到期进入待处置；有 legal_hold → 保留并记录（不机械永久保存）；
 * 无 hold 的处置需审批人（approver）→ 删除对象 + 墓碑元数据 + 审计保留 sha256。
 */

export function makeRetentionService(store, { objectStore }) {
  async function setPolicy({ tenantId, dataCategory, retainDays, actor }) {
    await store.query(
      `INSERT INTO retention_policies (tenant_id, data_category, retain_days) VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id, data_category) DO UPDATE SET retain_days=$3`,
      [tenantId, dataCategory, retainDays],
    );
    await audit(store, { tenantId, actor: actor ?? 'retention-service', action: 'RETENTION_POLICY_SET', targetType: 'retention_policy', targetId: dataCategory, summary: `retainDays=${retainDays}` });
  }

  async function placeHold({ tenantId, customerId, reason, approvedBy }) {
    if (!approvedBy) throw new ConnError('INVALID_INPUT', 'legal hold requires approver identity');
    const holdId = newId('hold');
    await store.query(
      `INSERT INTO legal_holds (hold_id, tenant_id, customer_id, reason, approved_by) VALUES ($1,$2,$3,$4,$5)`,
      [holdId, tenantId, customerId, reason, approvedBy],
    );
    return { holdId };
  }

  async function releaseHold({ holdId, actor }) {
    const r = await store.query(`UPDATE legal_holds SET released_at=now() WHERE hold_id=$1 AND released_at IS NULL RETURNING hold_id`, [holdId]);
    if (r.rows.length === 0) throw new ConnError('NOT_FOUND', `open hold ${holdId}`);
    await audit(store, { actor: actor ?? 'retention-service', action: 'LEGAL_HOLD_RELEASED', targetType: 'legal_hold', targetId: holdId, summary: 'hold released; disposal may resume per policy' });
    return { ok: true };
  }

  /** 扫描到期证据 → {dispose_pending_approval | retained_by_hold}。不直接删除。 */
  async function scanDue({ tenantId, now = new Date() }) {
    const r = await store.query(
      `SELECT e.evidence_id, e.customer_id, e.kind, e.object_ref, e.sha256, p.retain_days, e.created_at
       FROM evidence_artifacts e JOIN retention_policies p ON p.tenant_id = e.tenant_id AND p.data_category = e.kind
       WHERE e.tenant_id=$1 AND e.created_at + (p.retain_days || ' days')::interval <= $2`,
      [tenantId, now],
    );
    const due = [];
    for (const row of r.rows) {
      const hold = await store.query(
        `SELECT hold_id FROM legal_holds WHERE tenant_id=$1 AND customer_id=$2 AND released_at IS NULL LIMIT 1`,
        [tenantId, row.customer_id],
      );
      if (hold.rows.length > 0) {
        await store.query(
          `INSERT INTO disposition_log (tenant_id, customer_id, evidence_id, action, detail) VALUES ($1,$2,$3,'retained_by_hold',$4)`,
          [tenantId, row.customer_id, row.evidence_id, JSON.stringify({ holdId: hold.rows[0].hold_id, retainDays: row.retain_days })],
        );
        due.push({ evidenceId: row.evidence_id, action: 'retained_by_hold' });
      } else {
        await store.query(
          `INSERT INTO disposition_log (tenant_id, customer_id, evidence_id, action, detail) VALUES ($1,$2,$3,'dispose_pending_approval',$4)`,
          [tenantId, row.customer_id, row.evidence_id, JSON.stringify({ retainDays: row.retain_days })],
        );
        due.push({ evidenceId: row.evidence_id, action: 'dispose_pending_approval' });
      }
    }
    return due;
  }

  /** 审批处置：删除对象与记录体；审计保留 sha256 摘要（不是无痕销毁，也不永久保存）。 */
  async function approveDisposal({ tenantId, evidenceId, approvedBy }) {
    if (!approvedBy) throw new ConnError('INVALID_INPUT', 'disposal requires approver');
    const pend = await store.query(
      `SELECT id FROM disposition_log WHERE tenant_id=$1 AND evidence_id=$2 AND action='dispose_pending_approval' ORDER BY id DESC LIMIT 1`,
      [tenantId, evidenceId],
    );
    if (pend.rows.length === 0) throw new ConnError('NOT_FOUND', `no pending disposal for ${evidenceId}`);
    const art = await store.query(`SELECT customer_id, object_ref, sha256 FROM evidence_artifacts WHERE evidence_id=$1 AND tenant_id=$2`, [evidenceId, tenantId]);
    const row = art.rows[0];
    const hold = await store.query(`SELECT hold_id FROM legal_holds WHERE tenant_id=$1 AND customer_id=$2 AND released_at IS NULL LIMIT 1`, [tenantId, row.customer_id]);
    if (hold.rows.length > 0) throw new ConnError('RETENTION_HOLD', 'legal hold active; disposal blocked');
    if (row.object_ref) {
      await objectStore.put(`${row.object_ref}.tombstone`, Buffer.from(`disposed:${evidenceId}`), { tenantId, contentType: 'text/plain' }).catch(() => {});
      await store.query(`DELETE FROM objects WHERE object_ref=$1`, [row.object_ref]);
    }
    await store.query(`DELETE FROM evidence_artifacts WHERE evidence_id=$1 AND tenant_id=$2`, [evidenceId, tenantId]);
    await store.query(`UPDATE disposition_log SET action='disposed', approved_by=$3, detail=detail || $4::jsonb WHERE id=$1 AND tenant_id=$2`, [pend.rows[0].id, tenantId, approvedBy, JSON.stringify({ sha256: row.sha256 })]);
    await audit(store, { tenantId, actor: approvedBy, action: 'EVIDENCE_DISPOSED', targetType: 'evidence', targetId: evidenceId, summary: `approved disposal; sha256 retained in audit: ${row.sha256}` });
    return { disposed: true };
  }

  return { setPolicy, placeHold, releaseHold, scanDue, approveDisposal };
}
