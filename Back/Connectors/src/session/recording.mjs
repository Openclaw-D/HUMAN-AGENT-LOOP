import { newId } from '../ids.mjs';
import { ConnError } from '../errors.mjs';
import { verifyTrtcSignature, parseTrtcEvent } from '../rtc/trtc.mjs';
import { audit } from '../wecom/consent.mjs';

/**
 * 录制状态机（独立于通话状态）：not_requested → pending → recording → (gapped) → finalizing → complete | failed。
 * 只有"文件存在、可读、校验通过且无未补缺口"才 complete（I13/I14）。
 * 回调重复/乱序/延迟：dedupe_key 幂等 + 事件按语义收敛，不出现假 complete。
 */

export function makeRecordingService(store, { objectStore, adapter }) {
  async function requestRecording({ tenantId, sessionId, requestedBy }) {
    const s = await getSession(tenantId, sessionId);
    if (s.recording_state !== 'not_requested') return { taskId: s.recording_task_id, state: s.recording_state, idempotent: true };
    const consent = await store.query(
      `SELECT consent_id FROM consent_records WHERE tenant_id=$1 AND subject_id=$2 AND channel='video_session' AND status='active' AND purposes::jsonb ? 'recording' LIMIT 1`,
      [tenantId, s.customer_id],
    );
    if (consent.rows.length === 0) throw new ConnError('CONSENT_REQUIRED', `no active video_session/recording consent for ${s.customer_id}`);
    await store.query(
      `UPDATE diligence_sessions SET recording_state='pending', updated_at=now() WHERE session_id=$1 AND tenant_id=$2`,
      [sessionId, tenantId],
    );
    const started = adapter ? await adapter.startTask?.({ roomId: s.room_id, tenantId, sessionId }).catch((e) => { throw e; }) : undefined;
    const taskId = started?.taskId ?? newId('rect');
    await store.query(
      `UPDATE diligence_sessions SET recording_task_id=$3, updated_at=now() WHERE session_id=$1 AND tenant_id=$2`,
      [sessionId, tenantId, taskId],
    );
    await audit(store, { tenantId, actor: requestedBy ?? 'recording-service', action: 'RECORDING_REQUESTED', targetType: 'session', targetId: sessionId, summary: `task=${taskId}` });
    return { taskId, state: 'pending' };
  }

  async function getSession(tenantId, sessionId) {
    const r = await store.query(`SELECT * FROM diligence_sessions WHERE session_id=$1 AND tenant_id=$2`, [sessionId, tenantId]);
    if (r.rows.length === 0) throw new ConnError('SESSION_NOT_FOUND', sessionId);
    return r.rows[0];
  }

  async function setState(tenantId, sessionId, state, extra = {}) {
    await store.query(
      `UPDATE diligence_sessions SET recording_state=$3, recording_incomplete=$4, updated_at=now() WHERE session_id=$1 AND tenant_id=$2`,
      [sessionId, tenantId, state, extra.incomplete ?? false],
    );
  }

  /** 缺口标记持久化：只在 305 Status=2 或后续 310 Status=0 明确恢复时关闭（I12/I14 判据）。 */
  async function markGap(tenantId, sessionId, open, state) {
    await store.query(
      `UPDATE diligence_sessions SET recording_gap_open=$3, recording_state=$4, updated_at=now() WHERE session_id=$1 AND tenant_id=$2`,
      [sessionId, tenantId, open, state],
    );
  }

  /** 官方回调入口（已被 HTTP 层做 Sign 验证）。幂等 + 乱序安全。 */
  async function handleCallback({ tenantId, rawBody, signHeader, callbackKey }) {
    verifyTrtcSignature({ key: callbackKey, rawBody, signHeader });
    const evt = parseTrtcEvent(rawBody);
    const info = evt.EventInfo ?? {};
    const taskId = info.TaskId ?? null;
    const dedupeKey = `${evt.EventType}:${taskId}:${info.FileName ?? ''}:${evt.CallbackTs ?? JSON.stringify(info).length}`;
    const ins = await store.query(
      `INSERT INTO recording_event_log (tenant_id, provider, dedupe_key, event_type, task_id, payload)
       VALUES ($1,'trtc',$2,$3,$4,$5)
       ON CONFLICT (tenant_id, provider, dedupe_key) DO UPDATE SET received_at=now()
       RETURNING xmax = 0 AS inserted`,
      [tenantId, dedupeKey, evt.EventType, taskId, rawBody],
    );
    if (!ins.rows[0].inserted) return { replayed: true };

    const session = taskId
      ? (await store.query(`SELECT * FROM diligence_sessions WHERE recording_task_id=$1 AND tenant_id=$2`, [taskId, tenantId])).rows[0]
      : null;

    switch (evt.EventType) {
      case 301: // 录制开始
        if (session && ['pending', 'recording'].includes(session.recording_state)) {
          await setState(tenantId, session.session_id, 'recording');
        }
        break;
      case 305: // Status: 0正常 / 1至少一片滞留(gap) / 2滞留恢复
        if (session) {
          if (info.Status === 1) await markGap(tenantId, session.session_id, true, 'gapped');
          if (info.Status === 2 && session.recording_state === 'gapped') {
            await markGap(tenantId, session.session_id, false, 'recording'); // 缺口恢复；过程记录保留在 event log
          }
        }
        break;
      case 310: { // 文件上传 COS 完成；Status 1=至少一片滞留
        const files = info.FileList ?? [];
        for (const f of files) {
          const fileId = newId('rf');
          await store.query(
            `INSERT INTO recording_files (file_id, tenant_id, task_id, session_id, file_name, track_type, media_id, start_ms, end_ms, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'declared')
             ON CONFLICT (tenant_id, task_id, file_name) DO UPDATE SET session_id=$4, track_type=$6, media_id=$7`,
            [fileId, tenantId, taskId, session?.session_id ?? null, f.FileName, f.TrackType, f.MediaId, f.StartTimeStamp, f.EndTimeStamp],
          );
          try {
            const bytes = await adapter.fetchRecordingFile({ fileName: f.FileName, taskId });
            const objectRef = `recording/${taskId}/${f.FileName}`;
            await objectStore.put(objectRef, bytes, { tenantId, contentType: 'video/mp4' });
            const meta = await objectStore.stat(objectRef);
            await store.query(
              `UPDATE recording_files SET object_ref=$3, sha256=$4, size_bytes=$5, status='stored' WHERE file_id=$1 AND tenant_id=$2`,
              [fileId, tenantId, objectRef, meta.sha256, meta.size_bytes],
            );
          } catch (e) {
            await store.query(`UPDATE recording_files SET status='missing', sha256=NULL WHERE file_id=$1 AND tenant_id=$2`, [fileId, tenantId]);
            await audit(store, { tenantId, actor: 'recording-service', action: 'RECORDING_FILE_MISSING', targetType: 'recording_file', targetId: fileId, summary: String(e.message).slice(0, 160) });
          }
        }
        if (session && info.Status === 1) {
          await markGap(tenantId, session.session_id, true, 'gapped');
        }
        if (session && info.Status === 0) {
          await markGap(tenantId, session.session_id, false, session.recording_state === 'gapped' ? 'recording' : session.recording_state);
        }
        break;
      }
      case 311: { // VOD 提交。注意官方文档：回调后约 30s~3min 文件才可播放 → 不据此置 complete。
        if (session && info.Status === 1) {
          await markGap(tenantId, session.session_id, true, 'gapped');
        }
        break;
      }
      case 302: // 房间退出（LeaveCode 记录）
      case 306: // Failover 迁移
      case 307:
      case 309:
      case 312: { // 任务结束 → finalizing + 裁决
        if (session && ['recording', 'gapped', 'pending'].includes(session.recording_state)) {
          await setState(tenantId, session.session_id, 'finalizing');
          const verdict = await finalize(tenantId, session.session_id);
          return { applied: evt.EventType, verdict };
        }
        break;
      }
      default:
        break; // 801-804 页面录制与未知事件：记录不处理
    }
    return { applied: evt.EventType };
  }

  async function finalize(tenantId, sessionId) {
    const files = await store.query(`SELECT file_name, status FROM recording_files WHERE session_id=$1 AND tenant_id=$2`, [sessionId, tenantId]);
    const s = await getSession(tenantId, sessionId);
    const declared = files.rows;
    const allStored = declared.length > 0 && declared.every((f) => f.status === 'stored');
    const readableCheck = [];
    for (const f of declared) {
      if (f.status !== 'stored') continue;
      const r = await store.query(`SELECT object_ref, sha256 FROM recording_files WHERE session_id=$1 AND tenant_id=$2 AND file_name=$3`, [sessionId, tenantId, f.file_name]);
      const meta = r.rows[0];
      try {
        await objectStore.get(meta.object_ref); // 读取 + 内部 sha256 校验（可读且检查通过）
        readableCheck.push({ file: f.file_name, ok: true });
      } catch {
        await store.query(`UPDATE recording_files SET status='missing' WHERE session_id=$1 AND tenant_id=$2 AND file_name=$3`, [sessionId, tenantId, f.file_name]);
        readableCheck.push({ file: f.file_name, ok: false });
      }
    }
    const allReadable = readableCheck.length > 0 && readableCheck.every((x) => x.ok);
    const gapped = s.recording_gap_open || declared.some((f) => f.status !== 'stored') || declared.length === 0;
    if (allStored && allReadable && !gapped) {
      await setState(tenantId, sessionId, 'complete');
      return { state: 'complete' };
    }
    await setState(tenantId, sessionId, 'failed', { incomplete: true });
    await audit(store, {
      tenantId, actor: 'recording-service', action: 'RECORDING_INCOMPLETE', targetType: 'session', targetId: sessionId,
      summary: `declared=${declared.length} stored=${declared.filter((f) => f.status === 'stored').length} readable=${readableCheck.filter((x) => x.ok).length}/${readableCheck.length} gapped=${gapped}; cannot be treated as complete evidence`,
    });
    return { state: 'failed', reason: 'recording_incomplete', details: { declared: declared.length, readable: readableCheck, gapped } };
  }

  async function statusOf({ tenantId, sessionId }) {
    const s = await getSession(tenantId, sessionId);
    const files = await store.query(`SELECT file_name, status, sha256, size_bytes FROM recording_files WHERE session_id=$1 AND tenant_id=$2`, [sessionId, tenantId]);
    return { recordingState: s.recording_state, incomplete: s.recording_incomplete, taskId: s.recording_task_id, files: files.rows };
  }

  return { requestRecording, handleCallback, statusOf, finalize };
}
