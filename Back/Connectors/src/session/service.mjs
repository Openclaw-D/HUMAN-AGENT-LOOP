import { createHmac, randomUUID } from 'node:crypto';
import { newId } from '../ids.mjs';
import { ConnError } from '../errors.mjs';
import { audit } from '../wecom/consent.mjs';

/**
 * DiligenceSession：归属来自受控绑定的 customerId，不由前端当前选中案例推断（任务02 §5）。
 * 令牌：HMAC 签名 + 短时 + 绑定 (sessionId,participantId,role,roomId) + 一次性（I09）。
 * 通话状态与录制/分析状态分离；live 要求客户参与者有活跃媒体轨（I10）。
 * 面板操作不重建会话；重复加入幂等（I11 本地部分）。
 */

const CALL_FLOW = {
  created: ['invited', 'ended'],
  invited: ['connecting', 'ended'],
  connecting: ['live', 'reconnecting', 'ended'],
  live: ['connecting', 'reconnecting', 'ended'],   // connecting=客户主动停媒体（设备关闭，如实降级）
  reconnecting: ['live', 'ended'],
  ended: [],
};

export function makeSessionService(store, { signingSecret, clock = () => Date.now() }) {
  function b64url(s) { return Buffer.from(s).toString('base64url'); }

  function issueToken({ session, participantId, role, ttlSec = 300 }) {
    const jti = randomUUID();
    const exp = clock() + ttlSec * 1000;
    // session 可能是 DB 行（snake_case）：显式归一，绝不让 undefined 混进令牌载荷
    const sessionId = session.session_id ?? session.sessionId;
    const roomId = session.room_id ?? session.roomId;
    const payload = { sessionId, participantId, role, roomId, exp, jti };
    const body = b64url(JSON.stringify(payload));
    const sig = createHmac('sha256', signingSecret).update(body).digest('base64url');
    return { token: `${body}.${sig}`, jti, exp };
  }

  function verifyToken(token) {
    const [body, sig] = String(token ?? '').split('.');
    if (!body || !sig) throw new ConnError('TOKEN_INVALID');
    const expected = createHmac('sha256', signingSecret).update(body).digest('base64url');
    if (expected !== sig) throw new ConnError('TOKEN_INVALID', 'signature mismatch');
    let payload;
    try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw new ConnError('TOKEN_INVALID', 'payload undecodable'); }
    if (payload.exp < clock()) throw new ConnError('TOKEN_EXPIRED', `expired at ${new Date(payload.exp).toISOString()}`);
    return payload;
  }

  async function createSession({ tenantId, customerId, createdBy, sourceMode = 'real' }) {
    if (!tenantId || !customerId) throw new ConnError('INVALID_INPUT', 'createSession: tenantId/customerId required');
    const bound = await store.query(`SELECT 1 FROM participant_bindings WHERE tenant_id=$1 AND customer_id=$2 AND status='active' LIMIT 1`, [tenantId, customerId]);
    if (bound.rows.length === 0) throw new ConnError('CUSTOMER_SCOPE_MISMATCH', `session requires controlled binding for ${customerId}`);
    const sessionId = newId('ses');
    const roomId = newId('room');
    await store.query(
      `INSERT INTO diligence_sessions (session_id, tenant_id, customer_id, room_id, source_mode, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [sessionId, tenantId, customerId, roomId, sourceMode, createdBy],
    );
    return { sessionId, roomId, callState: 'created', sourceMode };
  }

  async function getSession(sessionId) {
    const r = await store.query(`SELECT * FROM diligence_sessions WHERE session_id=$1`, [sessionId]);
    if (r.rows.length === 0) throw new ConnError('SESSION_NOT_FOUND', sessionId);
    return r.rows[0];
  }

  async function invite({ sessionId, participantId, role, ttlSec, actor }) {
    const session = await getSession(sessionId);
    if (!['customer', 'expert', 'observer'].includes(role)) throw new ConnError('INVALID_INPUT', `role ${role}`);
    if (session.call_state === 'ended') throw new ConnError('INVALID_STATE', 'session ended');
    const { token, jti, exp } = issueToken({ session, participantId, role, ttlSec });
    await store.query(
      `INSERT INTO session_tokens (jti, session_id, participant_id, role, room_id, expires_at) VALUES ($1,$2,$3,$4,$5,to_timestamp($6/1000.0))`,
      [jti, sessionId, participantId, role, session.room_id, exp],
    );
    if (session.call_state === 'created') {
      // 仅 created → invited；已有 invite 时重复邀请其他参与者保持 invited（多人邀请合法）
      await transition(session, 'invited', `invite ${role}`);
    }
    await audit(store, { tenantId: session.tenant_id, actor: actor ?? 'session-service', action: 'SESSION_INVITED', targetType: 'session', targetId: sessionId, summary: `role=${role} participant=${participantId}` });
    return { token, jti, expiresInSec: ttlSec ?? 300 };
  }

  async function transition(session, to, note) {
    const from = session.call_state;
    if (!CALL_FLOW[from]?.includes(to)) throw new ConnError('INVALID_STATE', `${from} -> ${to}`);
    await store.query(`UPDATE diligence_sessions SET call_state=$2, updated_at=now() WHERE session_id=$1`, [session.session_id, to]);
    await audit(store, { tenantId: session.tenant_id, actor: 'session-service', action: `CALL_${to.toUpperCase()}`, targetType: 'session', targetId: session.session_id, summary: note ?? `${from}->${to}` });
    session.call_state = to;
  }

  /** 加入：令牌校验（签名/过期/一次性/房间/角色）→ 幂等登记 → 状态推进。 */
  async function join({ token }) {
    const payload = verifyToken(token);
    const session = await getSession(payload.sessionId);
    if (session.room_id !== payload.roomId) throw new ConnError('TOKEN_ROOM_MISMATCH', 'token bound to another room');
    const tok = await store.query(`SELECT used_at, used_count, expires_at FROM session_tokens WHERE jti=$1`, [payload.jti]);
    if (tok.rows.length === 0) throw new ConnError('TOKEN_INVALID', 'jti unknown');
    const t = tok.rows[0];
    if (t.used_at) throw new ConnError('TOKEN_REUSED', `jti ${payload.jti} already used at ${t.used_at.toISOString()}`);

    const existing = await store.query(
      `SELECT id FROM session_participants WHERE session_id=$1 AND participant_id=$2`,
      [session.session_id, payload.participantId],
    );
    let idempotent = false;
    if (existing.rows.length > 0) {
      idempotent = true; // 重复加入命令幂等（I11）
    } else {
      await store.query(
        `INSERT INTO session_participants (session_id, participant_id, role, joined_at) VALUES ($1,$2,$3,now())`,
        [session.session_id, payload.participantId, payload.role],
      );
    }
    await store.query(`UPDATE session_tokens SET used_at=now(), used_count=used_count+1 WHERE jti=$1`, [payload.jti]);

    const next = session.call_state === 'created' ? 'connecting' : session.call_state === 'invited' ? 'connecting' : session.call_state;
    if (next !== session.call_state) await transition(session, next, `join ${payload.role}`);

    // 状态真实性：live 只在客户参与者有活跃媒体轨时成立（I10/I11 的判据之一）。
    await recomputeLive(session.session_id);
    return { sessionId: session.session_id, participantId: payload.participantId, role: payload.role, idempotent, callState: next };
  }

  async function recomputeLive(sessionId) {
    const session = await getSession(sessionId);
    if (!['connecting', 'live', 'reconnecting'].includes(session.call_state)) return session.call_state;
    const r = await store.query(
      `SELECT COUNT(*)::int AS n FROM session_participants WHERE session_id=$1 AND role='customer' AND jsonb_array_length(media_tracks) > 0`,
      [sessionId],
    );
    const hasCustomerMedia = r.rows[0].n > 0;
    const target = hasCustomerMedia ? 'live' : 'connecting';
    if (session.call_state !== target && CALL_FLOW[session.call_state]?.includes(target)) {
      await transition(session, target, hasCustomerMedia ? 'customer media active' : 'no customer media (device/permission status truthful)');
    } else if (hasCustomerMedia && session.call_state === 'reconnecting') {
      await transition(session, 'live', 'recovered');
    }
    return (await getSession(sessionId)).call_state;
  }

  /** 设备权限上报：如实记录；拒绝 ≠ live。 */
  async function reportDevice({ sessionId, participantId, camera, mic }) {
    await getSession(sessionId);
    await store.query(
      `UPDATE session_participants SET device_status=$3 WHERE session_id=$1 AND participant_id=$2`,
      [sessionId, participantId, JSON.stringify({ camera, mic, at: new Date().toISOString() })],
    );
    const tracks = [];
    if (camera === 'granted') tracks.push('video');
    if (mic === 'granted') tracks.push('audio');
    await store.query(`UPDATE session_participants SET media_tracks=$3::jsonb WHERE session_id=$1 AND participant_id=$2`, [sessionId, participantId, JSON.stringify(tracks)]);
    const state = await recomputeLive(sessionId);
    return { camera, mic, mediaTracks: tracks, callState: state };
  }

  /** 弱网/断线（I12）：客户媒体全断 → reconnecting；绑定不动；结束由显式命令。 */
  async function reportNetwork({ sessionId, participantId, disconnected }) {
    const session = await getSession(sessionId);
    await store.query(`UPDATE session_participants SET network=$3 WHERE session_id=$1 AND participant_id=$2`, [sessionId, participantId, JSON.stringify({ disconnected, at: new Date().toISOString() })]);
    if (disconnected && session.call_state === 'live') {
      await store.query(`UPDATE session_participants SET media_tracks='[]'::jsonb WHERE session_id=$1 AND participant_id=$2`, [sessionId, participantId]);
      await transition(session, 'reconnecting', `participant ${participantId} disconnected`);
    }
    if (!disconnected) {
      const r = await store.query(`SELECT role FROM session_participants WHERE session_id=$1 AND participant_id=$2`, [sessionId, participantId]);
      if (r.rows[0]?.role === 'customer') await reportDevice({ sessionId, participantId, camera: 'granted', mic: 'granted' });
    }
    return { callState: (await getSession(sessionId)).call_state };
  }

  async function endSession({ sessionId, actor }) {
    const session = await getSession(sessionId);
    if (session.call_state !== 'ended') await transition(session, 'ended', `ended by ${actor ?? 'user'}`);
    await store.query(`UPDATE session_participants SET left_at=now() WHERE session_id=$1 AND left_at IS NULL`, [sessionId]);
    return { callState: 'ended' };
  }

  /** 面板操作：只读快照——打开面板不重建/不干扰会话（I11）。 */
  async function panelSnapshot({ sessionId }) {
    const session = await getSession(sessionId);
    const parts = await store.query(`SELECT participant_id, role, joined_at, device_status, media_tracks, network FROM session_participants WHERE session_id=$1`, [sessionId]);
    return {
      sessionId, roomId: session.room_id, customerId: session.customer_id, sourceMode: session.source_mode,
      callState: session.call_state, recordingState: session.recording_state, recordingIncomplete: session.recording_incomplete,
      participants: parts.rows, // 客户链接侧不得携带内部授信字段——这里只给会话面数据
    };
  }

  /** 回看：独立 replay 标记，不打断实时（由调用方证明音轨持续）。 */
  async function requestReplay({ sessionId, rangeMs, actor }) {
    const session = await getSession(sessionId);
    await audit(store, { tenantId: session.tenant_id, actor: actor ?? 'session-service', action: 'REPLAY_REQUESTED', targetType: 'session', targetId: sessionId, summary: `range=${JSON.stringify(rangeMs ?? null)}` });
    return { replay: true, livePreserved: session.call_state === 'live', range: rangeMs ?? null };
  }

  return { createSession, getSession, invite, join, reportDevice, reportNetwork, endSession, panelSnapshot, requestReplay, recomputeLive, verifyToken };
}
