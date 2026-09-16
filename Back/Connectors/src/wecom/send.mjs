import { newId } from '../ids.mjs';
import { ConnError } from '../errors.mjs';
import { audit } from './consent.mjs';

/**
 * 对外发送：audience 二元（customer|internal）在服务端强制（I22）；
 * 发送状态三态 sent_ok / send_failed / unknown——绝不伪造 sent/read（I21，官方无对外已读回执）。
 */

export function makeSendService(store, { transport, bindings, consent }) {
  async function send({ tenantId, actor, customerId, threadId, audience, text, clientMsgId }) {
    if (!tenantId || !customerId || !audience || !text) throw new ConnError('INVALID_INPUT', 'send: tenantId/customerId/audience/text required');
    if (!['customer', 'internal'].includes(audience)) throw new ConnError('INVALID_INPUT', `audience must be customer|internal`);

    // I22：内部受众不允许经客户通道外发；内部消息只登记。
    if (audience === 'internal') {
      const eventId = newId('cev');
      await store.query(
        `INSERT INTO communication_events (event_id, tenant_id, customer_id, thread_id, provider_event_id, source_type, direction, kind, body, completeness)
         VALUES ($1,$2,$3,$4,$5,'internal_note','outbound','internal_note',$6,'complete')`,
        [eventId, tenantId, customerId, threadId ?? 'none', `internal:${clientMsgId ?? eventId}`, JSON.stringify({ text, audience: 'internal' })],
      );
      return { audience: 'internal', delivery: 'recorded_only', eventId, note: 'internal audience never leaves via customer channel' };
    }

    // 客户受众：通道授权（微信客服通道）+ 客户范围一致性。
    const c = await consent.check({ tenantId, subjectId: customerId, channel: 'wecom_kf', purpose: 'external_disclosure' });
    if (!c.ok) throw new ConnError('CONSENT_REQUIRED', c.reason);

    // I08：customerId 必须由受控绑定取得且在租户内。
    const b = await store.query(
      `SELECT 1 FROM participant_bindings WHERE tenant_id=$1 AND customer_id=$2 AND status='active' LIMIT 1`,
      [tenantId, customerId],
    );
    if (b.rows.length === 0) throw new ConnError('CUSTOMER_SCOPE_MISMATCH', `no active binding for customer ${customerId} in tenant`);

    const msgId = clientMsgId ?? newId('snd');
    const eventId = newId('cev');
    let delivery;
    try {
      const resp = await transport.kfSendMsg({ touser: await resolveProviderUserId(tenantId, customerId), open_kfid: 'kf_service', msgid: msgId, msgtype: 'text', text: { content: text } });
      if (resp.errcode === 0 && resp.msgid) delivery = { state: 'sent_ok', providerMsgId: resp.msgid };
      else if (resp.errcode === 0 && !resp.msgid) delivery = { state: 'unknown', reason: 'provider returned no msgid/status' };
      else delivery = { state: 'send_failed', errcode: resp.errcode, failType: resp.fail_type ?? null };
    } catch (e) {
      delivery = { state: 'unknown', reason: `transport error: ${String(e.message).slice(0, 120)}` };
    }

    await store.query(
      `INSERT INTO communication_events (event_id, tenant_id, customer_id, thread_id, provider_event_id, source_type, direction, kind, body, completeness)
       VALUES ($1,$2,$3,$4,$5,'wecom_kf_msg','outbound','text',$6,'complete')`,
      [eventId, tenantId, customerId, threadId ?? 'none', `send:${msgId}`, JSON.stringify({ text, audience: 'customer', delivery, clientMsgId: msgId })],
    );
    await audit(store, { tenantId, actor: actor ?? 'send-service', action: `SEND_${delivery.state.toUpperCase()}`, targetType: 'communication_event', targetId: eventId, summary: `audience=customer state=${delivery.state}` });
    return { audience: 'customer', delivery, eventId };
  }

  /** 从客户客服消息流拉取（含 msg_send_fail 事件 → 回写原消息 delivery=send_failed）。 */
  async function pullKfEvents({ tenantId, cursor = '' }) {
    const resp = await transport.kfSyncMsg({ cursor });
    if (resp.errcode !== 0) throw new ConnError('INTERNAL', `kf sync err ${resp.errcode}`);
    const applied = [];
    for (const m of resp.msg_list ?? []) {
      if (m.msgtype === 'msg_send_fail') {
        const failedMsgId = m.msg_send_fail?.msgid;
        const r = await store.query(
          `UPDATE communication_events SET body = jsonb_set(body, '{delivery}', $3::jsonb)
           WHERE tenant_id=$1 AND provider_event_id=$2 RETURNING event_id`,
          [tenantId, `send:${failedMsgId}`, JSON.stringify({ state: 'send_failed', failType: m.msg_send_fail?.fail_type ?? null, source: 'msg_send_fail_event' })],
        );
        applied.push({ type: 'send_fail', failedMsgId, updated: r.rows.length > 0 });
      } else if (m.msgtype === 'text') {
        applied.push({ type: 'inbound_text', msgid: m.msgid, from: m.external_userid });
      }
    }
    return { nextCursor: resp.next_cursor, applied };
  }

  async function resolveProviderUserId(tenantId, customerId) {
    const r = await store.query(
      `SELECT provider_user_id FROM participant_bindings WHERE tenant_id=$1 AND customer_id=$2 AND status='active' AND provider='wecom_kf' LIMIT 1`,
      [tenantId, customerId],
    );
    if (r.rows.length === 0) throw new ConnError('CUSTOMER_SCOPE_MISMATCH', `no wecom_kf binding for ${customerId}`);
    return r.rows[0].provider_user_id;
  }

  return { send, pullKfEvents };
}
