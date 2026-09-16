import { newId, nowIso } from '../ids.mjs';
import { ConnError } from '../errors.mjs';
import { audit } from './consent.mjs';

/**
 * 收件箱：先持久化后确认；处理幂等；游标按提供方语义推进。
 * seq 非连续 → 记 suspected_gap（不必然丢失）；可确认断档（如超5天窗口）→ archive_gap。
 * 媒体与正文分阶段：attachment_pending 不宣称资料完整（任务02 §4）。
 */

const MEDIA_KINDS = new Set(['image', 'voice', 'video', 'file']);
const ALLOWED_MSG_FIELDS = ['msgid', 'action', 'from', 'tolist', 'roomid', 'msgtime', 'msgtype'];

export function makeIngestService(store, { bindings, consent }) {
  /** 收件箱登记 + 处理。返回 {replayed, eventId?|quarantine?} */
  async function ingestMessage({ tenantId, provider = 'wecom_archive', seq = null, msg, receivedAt = null }) {
    if (!tenantId || !msg || !msg.msgid) throw new ConnError('INVALID_INPUT', 'ingestMessage: tenantId/msg.msgid required');
    const providerEventId = `${seq ?? 'x'}:${msg.msgid}:${msg.action ?? 'send'}`;
    const payload = msg;

    // 1) 收件箱先持久化（同事务登记，冲突即重放）。
    const ins = await store.query(
      `INSERT INTO inbox_events (tenant_id, provider, provider_event_id, seq, payload)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, provider, provider_event_id) DO UPDATE SET replay_count = inbox_events.replay_count + 1
       RETURNING id, xmax = 0 AS inserted, replay_count, status`,
      [tenantId, provider, providerEventId, seq, JSON.stringify(payload)],
    );
    const row = ins.rows[0];
    if (!row.inserted) {
      await audit(store, { tenantId, actor: 'ingest', action: 'INBOX_REPLAY', targetType: 'inbox', targetId: providerEventId, summary: `replay#${row.replay_count}; no new business effect` });
      return { replayed: true, replayCount: row.replay_count, priorStatus: row.status };
    }

    // 2) 处理（异常则保持 received，恢复重处理——不漏登记不重复效果）。
    try {
      const result = await processMessage({ tenantId, provider, seq, msg, inboxId: row.id, receivedAt });
      await store.query(`UPDATE inbox_events SET status=$2, processed_at=now() WHERE id=$1`, [row.id, result.quarantined ? 'quarantined' : 'processed']);
      return result;
    } catch (e) {
      await audit(store, { tenantId, actor: 'ingest', action: 'INBOX_PROCESS_ERROR', targetType: 'inbox', targetId: providerEventId, summary: String(e.message).slice(0, 200) });
      throw e;
    }
  }

  /** 消息 → 线程/绑定/授权/事件/附件。 */
  async function processMessage({ tenantId, provider, seq, msg, inboxId, receivedAt }) {
    const msgtype = String(msg.msgtype ?? 'unknown');
    const from = msg.from ?? null;

    // 同意流内事件：agree/disagree 先于内容处理。
    if (msgtype === 'agree') return handleAgreeChange({ tenantId, provider, seq, msg, agree: true });
    if (msgtype === 'disagree') return handleAgreeChange({ tenantId, provider, seq, msg, agree: false });

    // 解析外部参与方 → 绑定。
    const externalIds = collectExternalIds(msg);
    let customerId = null;
    let quarantined = null;
    let bindingResolution = null;
    if (externalIds.length > 0) {
      const res = await bindings.resolve({ tenantId, provider, providerUserId: externalIds[0] });
      bindingResolution = res;
      if (res.status === 'resolved') customerId = res.customerId;
      else if (res.status === 'ambiguous') quarantined = 'ambiguous';
      else quarantined = 'unassigned';
    }

    // 线程 upsert。
    const threadKey = msg.roomid ? `room:${msg.roomid}` : `dm:${[from, ...(msg.tolist ?? [])].filter(Boolean).sort().join('|')}`;
    const thread = await upsertThread({ tenantId, provider, threadKey, customerId, quarantine: quarantined });

    if (quarantined) {
      await audit(store, {
        tenantId, actor: 'ingest', action: quarantined === 'ambiguous' ? 'THREAD_QUARANTINE_AMBIGUOUS' : 'THREAD_QUARANTINE_UNASSIGNED',
        targetType: 'thread', targetId: thread.threadId,
        summary: quarantined === 'ambiguous' ? `contact matches multiple customers; awaiting explicit context binding` : `no controlled binding; not guessing customer`,
        payload: { externalIds },
      });
    }

    // 内容处理授权（存档归档目的）。未授权/撤回 → 事件登记为拒绝处理，不解析正文用途。
    const consentRefs = [];
    if (customerId) {
      const c = await consent.check({ tenantId, subjectId: customerId, channel: 'wecom_archive', purpose: 'archival' });
      if (!c.ok) {
        await audit(store, { tenantId, actor: 'ingest', action: 'PROCESS_BLOCKED_NO_CONSENT', targetType: 'thread', targetId: thread.threadId, summary: c.reason });
        return { quarantined: false, blocked: true, reason: 'CONSENT_REQUIRED', eventId: null, threadId: thread.threadId };
      }
      consentRefs.push(c.consentRef);
    }

    // 事件体：字段白名单——外部载荷中携带的业务 customerId 一律不采纳（I08）。
    const body = {};
    for (const k of ALLOWED_MSG_FIELDS) if (msg[k] !== undefined) body[k] = msg[k];
    body.payload = sanitizeTypePayload(msgtype, msg);
    const eventId = newId('cev');
    await store.query(
      `INSERT INTO communication_events
         (event_id, tenant_id, customer_id, thread_id, provider_event_id, provider_timestamp, received_at, source_type, source_from, source_to, direction, kind, body, completeness, consent_refs)
       VALUES ($1,$2,$3,$4,$5,to_timestamp($6::bigint/1000),coalesce($7::timestamptz, now()),$8,$9,$10,'inbound',$11,$12,$13,$14)`,
      [
        eventId, tenantId, customerId, thread.threadId, `${seq ?? 'x'}:${msg.msgid}:${msg.action ?? 'send'}`,
        msg.msgtime ?? null, receivedAt, `${provider}_msg`, from, JSON.stringify(msg.tolist ?? []), msgtype,
        JSON.stringify(body), MEDIA_KINDS.has(msgtype) ? 'attachment_pending' : 'complete', JSON.stringify(consentRefs),
      ],
    );

    // 媒体 → 附件队列（attachment_pending，直到 is_finish + 校验）。
    if (MEDIA_KINDS.has(msgtype)) {
      const media = msg[msgtype] ?? {};
      if (!media.sdkfileid) throw new ConnError('INVALID_INPUT', `media msg ${msg.msgid} missing sdkfileid`);
      await store.query(
        `INSERT INTO attachment_jobs (job_id, tenant_id, event_id, sdkfileid, media_kind) VALUES ($1,$2,$3,$4,$5)`,
        [newId('att'), tenantId, eventId, media.sdkfileid, msgtype],
      );
    }

    return { quarantined: Boolean(quarantined), eventId, threadId: thread.threadId, customerId };
  }

  async function handleAgreeChange({ tenantId, provider, seq, msg, agree }) {
    const externalIds = collectExternalIds(msg);
    const subject = externalIds[0] ?? msg?.agree?.user?.userid ?? null;
    if (subject && !agree) {
      // 撤回：停止该主体在存档通道的后续新处理；数据留存交 retention。
      await consent.revoke({ tenantId, subjectId: subject, channel: 'wecom_archive' });
    }
    if (subject && agree) {
      const existing = await store.query(
        `SELECT consent_id FROM consent_records WHERE tenant_id=$1 AND subject_id=$2 AND channel='wecom_archive' AND status='active' LIMIT 1`,
        [tenantId, subject],
      );
      if (existing.rows.length === 0) {
        await consent.grant({
          tenantId, subjectType: 'customer_participant', subjectId: subject, channel: 'wecom_archive',
          purposes: ['archival'], dataCategory: 'message_content', basis: 'wecom_archive_agree_message', source: 'in_stream_agree',
        });
      }
    }
    const threadKey = msg.roomid ? `room:${msg.roomid}` : `dm:${[msg.from, ...(msg.tolist ?? [])].filter(Boolean).sort().join('|')}`;
    const thread = await upsertThread({ tenantId, provider, threadKey, customerId: null, quarantine: null });
    const eventId = newId('cev');
    await store.query(
      `INSERT INTO communication_events (event_id, tenant_id, thread_id, provider_event_id, source_type, source_from, direction, kind, body)
       VALUES ($1,$2,$3,$4,$5,$6,'inbound',$7,$8)`,
      [eventId, tenantId, thread.threadId, `${seq ?? 'x'}:${msg.msgid}:${msg.action ?? 'send'}`, `${provider}_msg`, msg.from ?? null, msg.msgtype, JSON.stringify({ msgid: msg.msgid })],
    );
    return { quarantined: false, eventId, consentEvent: agree ? 'granted' : 'revoked' };
  }

  async function upsertThread({ tenantId, provider, threadKey, customerId, quarantine }) {
    const existing = await store.query(
      `SELECT thread_id, customer_id, quarantine FROM communication_threads WHERE tenant_id=$1 AND channel=$2 AND provider_thread_key=$3`,
      [tenantId, 'wecom_archive', threadKey],
    );
    if (existing.rows.length > 0) {
      const t = existing.rows[0];
      if (quarantine && !t.quarantine) {
        await store.query(`UPDATE communication_threads SET quarantine=$2 WHERE thread_id=$1`, [t.thread_id, quarantine]);
      }
      return { threadId: t.thread_id, customerId: t.customer_id };
    }
    const threadId = newId('thr');
    await store.query(
      `INSERT INTO communication_threads (thread_id, tenant_id, customer_id, channel, provider_thread_key, quarantine)
       VALUES ($1,$2,$3,'wecom_archive',$4,$5)`,
      [threadId, tenantId, customerId, threadKey, quarantine],
    );
    return { threadId, customerId };
  }

  /** 游标推进：拉取循环结束调用。gap 检测按"记录而非臆断"原则。 */
  async function advanceCheckpoint({ tenantId, provider, channel, throughSeq }) {
    const cur = await store.query(
      `SELECT last_seq, suspected_gaps, confirmed_gaps FROM ingestion_checkpoints WHERE tenant_id=$1 AND provider=$2 AND channel=$3 FOR UPDATE`,
      [tenantId, provider, channel],
    );
    if (cur.rows.length === 0) {
      await store.query(
        `INSERT INTO ingestion_checkpoints (tenant_id, provider, channel, last_seq) VALUES ($1,$2,$3,$4)`,
        [tenantId, provider, channel, throughSeq],
      );
      return { lastSeq: throughSeq, suspectedGap: false };
    }
    const prev = cur.rows[0];
    let suspectedGap = false;
    if (throughSeq > prev.last_seq + 1) {
      // 非连续：记录疑点，不必然当丢失，也不悄悄忽略。
      suspectedGap = true;
      await store.query(
        `UPDATE ingestion_checkpoints SET last_seq=$4, suspected_gaps=suspected_gaps+1, updated_at=now() WHERE tenant_id=$1 AND provider=$2 AND channel=$3`,
        [tenantId, provider, channel, throughSeq],
      );
      await audit(store, { tenantId, actor: 'ingest', action: 'CHECKPOINT_SEQ_JUMP', targetType: 'checkpoint', targetId: `${provider}/${channel}`, summary: `${prev.last_seq} -> ${throughSeq}; recorded as suspected_gap (not confirmed loss)` });
    } else if (throughSeq > prev.last_seq) {
      await store.query(
        `UPDATE ingestion_checkpoints SET last_seq=$4, updated_at=now() WHERE tenant_id=$1 AND provider=$2 AND channel=$3`,
        [tenantId, provider, channel, throughSeq],
      );
    }
    return { lastSeq: Math.max(prev.last_seq, throughSeq), suspectedGap };
  }

  /** 可确认断档（例如超官方5天窗口）：archive_gap，需补救流程（E2：重新授权窗口内人工补拉/业务补偿记录）。 */
  async function confirmArchiveGap({ tenantId, provider, channel, fromSeq, toSeq, reason }) {
    await store.query(
      `INSERT INTO ingestion_checkpoints (tenant_id, provider, channel, last_seq, confirmed_gaps)
       VALUES ($1,$2,$3,0,1)
       ON CONFLICT (tenant_id, provider, channel) DO UPDATE SET confirmed_gaps = ingestion_checkpoints.confirmed_gaps + 1, updated_at = now()`,
      [tenantId, provider, channel],
    );
    await audit(store, {
      tenantId, actor: 'ingest', action: 'ARCHIVE_GAP_CONFIRMED', targetType: 'checkpoint', targetId: `${provider}/${channel}`,
      summary: `confirmed gap ${fromSeq}..${toSeq}: ${reason}; remediation=manual backfill within provider window or business compensation record`,
    });
    return { status: 'archive_gap', fromSeq, toSeq, reason, remediation: 'manual_backfill_or_business_compensation' };
  }

  async function getCheckpoint({ tenantId, provider, channel }) {
    const r = await store.query(
      `SELECT * FROM ingestion_checkpoints WHERE tenant_id=$1 AND provider=$2 AND channel=$3`,
      [tenantId, provider, channel],
    );
    return r.rows[0] ?? { last_seq: 0, suspected_gaps: 0, confirmed_gaps: 0 };
  }

  /** 崩溃恢复：received 未 processed 的重新处理（幂等由唯一键保证）。 */
  async function recoverPending({ tenantId, provider = 'wecom_archive' }) {
    const r = await store.query(
      `SELECT id, seq, payload FROM inbox_events WHERE tenant_id=$1 AND provider=$2 AND status='received' ORDER BY id`,
      [tenantId, provider],
    );
    const out = [];
    for (const row of r.rows) {
      const result = await processMessage({ tenantId, provider, seq: row.seq, msg: row.payload, inboxId: row.id, receivedAt: null });
      await store.query(`UPDATE inbox_events SET status=$2, processed_at=now() WHERE id=$1`, [row.id, result.quarantined ? 'quarantined' : 'processed']);
      out.push({ inboxId: row.id, eventId: result.eventId ?? null, quarantined: result.quarantined ?? false, blocked: result.blocked ?? false });
    }
    return out;
  }

  /** 附件下载 worker：分片拉取，重试上限；完成后事件 completeness=complete；失败保持 incomplete（I04）。 */
  async function runAttachmentWorker({ tenantId, transport, maxRetries = 3 }) {
    const jobs = await store.query(
      `SELECT job_id, event_id, sdkfileid, media_kind, retries FROM attachment_jobs WHERE tenant_id=$1 AND status IN ('pending','downloading') ORDER BY job_id`,
      [tenantId],
    );
    const results = [];
    for (const job of jobs.rows) {
      try {
        await store.query(`UPDATE attachment_jobs SET status='downloading', updated_at=now() WHERE job_id=$1`, [job.job_id]);
        let indexbuf = '';
        const chunks = [];
        let isFinish = false;
        while (!isFinish) {
          const resp = await transport.getMediaData({ sdkfileid: job.sdkfileid, indexbuf });
          chunks.push(resp.data);
          indexbuf = resp.indexbuf;
          isFinish = resp.is_finish;
        }
        const buf = Buffer.concat(chunks);
        const { sha256Hex } = await import('../ids.mjs');
        const objectRef = `media/${job.job_id}`;
        await putObjectViaStore(store, { tenantId, objectRef, buf, contentType: job.media_kind });
        await store.tx(async (client) => {
          await client.query(
            `UPDATE attachment_jobs SET status='done', is_finish=TRUE, bytes_downloaded=$2, object_ref=$3, sha256=$4, updated_at=now() WHERE job_id=$1`,
            [job.job_id, buf.length, objectRef, sha256Hex(buf)],
          );
          await client.query(`UPDATE communication_events SET completeness='complete' WHERE event_id=$1`, [job.event_id]);
        });
        results.push({ jobId: job.job_id, status: 'done' });
      } catch (e) {
        const retries = job.retries + 1;
        const failed = retries >= maxRetries;
        await store.query(
          `UPDATE attachment_jobs SET retries=$2, status=$3, last_error=$4, updated_at=now() WHERE job_id=$1`,
          [job.job_id, retries, failed ? 'failed' : 'pending', String(e.message).slice(0, 200)],
        );
        results.push({ jobId: job.job_id, status: failed ? 'failed' : 'retry_scheduled', retries, error: String(e.message) });
      }
    }
    return results;
  }

  return { ingestMessage, advanceCheckpoint, confirmArchiveGap, getCheckpoint, recoverPending, runAttachmentWorker, processMessage };
}

function collectExternalIds(msg) {
  const ids = [];
  if (typeof msg.from === 'string' && /^w[omd]/.test(msg.from)) ids.push(msg.from);
  for (const t of msg.tolist ?? []) if (typeof t === 'string' && /^w[omd]/.test(t)) ids.push(t);
  if (msg.msgtype === 'agree' || msg.msgtype === 'disagree') {
    const u = msg[msg.msgtype]?.user?.userid;
    if (typeof u === 'string' && /^w[omd]/.test(u)) ids.push(u);
  }
  return ids;
}

/** 类型载荷白名单：只取官方字段，丢弃未知/业务字段（防 customerId 串入）。 */
function sanitizeTypePayload(msgtype, msg) {
  const src = msg[msgtype];
  if (src == null || typeof src !== 'object') return {};
  const allow = {
    text: ['content'], image: ['sdkfileid', 'md5sum', 'filesize'], voice: ['sdkfileid', 'voice_size', 'voiceformat', 'play_length'],
    video: ['sdkfileid', 'sdkfilesize', 'play_length'], file: ['sdkfileid', 'filename', 'fileext', 'filesize'],
    revoke: ['pre_msgid'], agree: ['user'], disagree: ['user'], voiptext: ['invitetype', 'callduration', 'text'],
    meeting_voice_call: ['endts', 'sdkfileid', 'sdkfilesize'], emotion: ['type', 'width', 'imagesize', 'sdkfileid', 'md5sum'],
    link: ['title', 'description', 'url'], location: ['longitude', 'latitude', 'address', 'title'], card: ['corpname', 'userid'],
  };
  const fields = allow[msgtype] ?? [];
  const out = {};
  for (const f of fields) if (src[f] !== undefined) out[f] = src[f];
  return out;
}

/** 直接落对象存储表（供附件 worker 与录制文件复用；FS 路径由 config 提供）。 */
async function putObjectViaStore(store, { tenantId, objectRef, buf, contentType }) {
  const { sha256Hex } = await import('../ids.mjs');
  const storagePath = store.objectRoot ? `${store.objectRoot}/${objectRef}` : null;
  if (!storagePath) throw new ConnError('INTERNAL', 'store.objectRoot not configured for object writes');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(storagePath), { recursive: true });
  await writeFile(storagePath, buf);
  await store.query(
    `INSERT INTO objects (object_ref, tenant_id, sha256, size_bytes, content_type, storage_path) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (object_ref) DO UPDATE SET sha256=$3, size_bytes=$4`,
    [objectRef, tenantId, sha256Hex(buf), buf.length, contentType, storagePath],
  );
}
