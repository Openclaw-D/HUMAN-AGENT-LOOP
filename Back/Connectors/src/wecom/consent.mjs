import { newId, nowIso } from '../ids.mjs';
import { ConnError } from '../errors.mjs';

/**
 * ConsentRecord：按 目的(purpose)×数据类别(dataCategory)×通道(channel)×主体(subject)×时效 建模。
 * 不存在万能 consent=true。撤回后立即停止"新"的采集/处理；留存与删除由 retention 模块按
 * 合法依据/保留期/legal hold 独立裁决（任务02 §4）。
 */

export const PURPOSES = ['archival', 'transcription', 'recording', 'image_analysis', 'model_processing', 'external_disclosure'];
export const CHANNELS = ['wecom_archive', 'wecom_kf', 'video_session'];
export const DATA_CATEGORIES = ['message_content', 'media', 'audio_transcript', 'video_record', 'image'];

export function makeConsentService(store) {
  async function grant({ tenantId, subjectType, subjectId, channel, purposes, dataCategory, basis, expiresInDays, source }) {
    if (!tenantId || !subjectId || !channel || !Array.isArray(purposes) || purposes.length === 0) {
      throw new ConnError('INVALID_INPUT', 'grant: tenantId/subjectId/channel/purposes required');
    }
    for (const p of purposes) if (!PURPOSES.includes(p)) throw new ConnError('INVALID_INPUT', `unknown purpose ${p}`);
    const consentId = newId('cns');
    const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86400e3) : null;
    await store.query(
      `INSERT INTO consent_records (consent_id, tenant_id, subject_type, subject_id, channel, purposes, data_category, basis, status, granted_at, expires_at, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',now(),$9,$10)`,
      [consentId, tenantId, subjectType, subjectId, channel, JSON.stringify(purposes), dataCategory, basis, expiresAt, source],
    );
    await audit(store, { tenantId, actor: 'consent-service', action: 'CONSENT_GRANTED', targetType: 'consent', targetId: consentId, summary: `${channel}:${purposes.join('+')}` });
    return { consentId, status: 'active', expiresAt };
  }

  async function revoke({ tenantId, subjectId, channel }) {
    const r = await store.query(
      `UPDATE consent_records SET status='revoked', revoked_at=now()
       WHERE tenant_id=$1 AND subject_id=$2 AND ($3::text IS NULL OR channel=$3) AND status='active'
       RETURNING consent_id`,
      [tenantId, subjectId, channel ?? null],
    );
    for (const row of r.rows) {
      await audit(store, { tenantId, actor: 'consent-service', action: 'CONSENT_REVOKED', targetType: 'consent', targetId: row.consent_id, summary: 'revoked; new processing stopped; retention per policy' });
    }
    return { revoked: r.rows.map((x) => x.consent_id) };
  }

  /**
   * 处理门：主体在该通道下是否有覆盖 purpose 的 active 同意。撤销/过期/缺失 → 拒绝。
   */
  async function check({ tenantId, subjectId, channel, purpose }) {
    const r = await store.query(
      `SELECT consent_id, purposes, expires_at FROM consent_records
       WHERE tenant_id=$1 AND subject_id=$2 AND channel=$3 AND status='active'
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY granted_at DESC`,
      [tenantId, subjectId, channel],
    );
    for (const row of r.rows) {
      const purposes = row.purposes;
      if (Array.isArray(purposes) && purposes.includes(purpose)) return { ok: true, consentRef: row.consent_id };
    }
    return { ok: false, reason: `no active consent for ${channel}/${purpose}` };
  }

  /** 过期清理：expired 标记（不删除数据——留 retention 决定）。 */
  async function expireSweep() {
    const r = await store.query(
      `UPDATE consent_records SET status='expired' WHERE status='active' AND expires_at IS NOT NULL AND expires_at <= now() RETURNING consent_id`,
    );
    return r.rows.map((x) => x.consent_id);
  }

  return { grant, revoke, check, expireSweep };
}

export async function audit(store, { tenantId = null, actor, action, targetType = null, targetId = null, summary, payload }) {
  await store.query(
    `INSERT INTO audit_log (tenant_id, actor, action, target_type, target_id, summary, payload_sha256)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [tenantId, actor, action, targetType, targetId, summary, payload ? (await import('../ids.mjs')).sha256Hex(JSON.stringify(payload)) : null],
  );
}

export { nowIso };
