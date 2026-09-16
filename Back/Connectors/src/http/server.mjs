import { createServer } from 'node:http';
import { ConnError } from '../errors.mjs';
import { verifyCallback, verifyUrlEcho } from '../wecom/crypto.mjs';
import { verifyTrtcSignature, parseTrtcEvent } from '../rtc/trtc.mjs';

/**
 * Connectors HTTP 面（E1 真实服务）：
 * - /callbacks/wecom：企微回调（GET=URL验证 echo；POST=加密消息 → 验签/解密 → 收件箱）
 * - /callbacks/trtc：TRTC 录制回调（Sign 头校验 → 录制状态机）
 * - /api/connectors/**：服务令牌鉴权的业务操作（会话/发送/证据/录制）
 * - /objects/:ref：仅短时签名 URL 可读；无任何公开读路径
 * 所有读带 tenant 作用域；错误码统一 {ok:false,error}。
 */

export function startServer(svc, { port = 48100, wecomConfig, trtcCallbackKey, serviceToken }) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    try {
      const body = await readBody(req);

      if (req.method === 'GET' && url.pathname === '/healthz') {
        return json(res, 200, { ok: true, service: 'jw-connectors', realWeCom: 'blocked_external_access', realTrtc: 'blocked_external_access' });
      }

      if (url.pathname === '/callbacks/wecom') {
        if (req.method === 'GET') {
          const msg = verifyUrlEcho({
            token: wecomConfig.token, aesKey: wecomConfig.aesKey, receiveId: wecomConfig.corpid,
            msgSignature: url.searchParams.get('msg_signature'), timestamp: url.searchParams.get('timestamp'),
            nonce: url.searchParams.get('nonce'), echostr: url.searchParams.get('echostr'), nowMs: Date.now(),
          });
          res.writeHead(200, { 'content-type': 'text/plain' });
          return res.end(msg);
        }
        if (req.method === 'POST') {
          const parsed = JSON.parse(body);
          const plaintext = verifyCallback({
            token: wecomConfig.token, aesKey: wecomConfig.aesKey, receiveId: wecomConfig.corpid,
            signature: url.searchParams.get('msg_signature'), timestamp: url.searchParams.get('timestamp'),
            nonce: url.searchParams.get('nonce'), encrypt: parsed.encrypt, nowMs: Date.now(),
          });
          const event = JSON.parse(plaintext);
          const out = await svc.ingest.ingestMessage({ tenantId: event.tenantId ?? wecomConfig.defaultTenantId, provider: 'wecom_callback', seq: null, msg: event.message ?? event });
          return json(res, 200, { ok: true, ...(out.replayed ? { replayed: true } : {}) });
        }
      }

      if (req.method === 'POST' && url.pathname === '/callbacks/trtc') {
        if (!svc.recording) throw new ConnError('INTERNAL', 'recording service not wired');
        const out = await svc.recording.handleCallback({ tenantId: url.searchParams.get('tid') ?? wecomConfig.defaultTenantId, rawBody: body, signHeader: req.headers['sign'], callbackKey: trtcCallbackKey });
        return json(res, 200, { code: 0, ...out });
      }

      // 以下需服务令牌。
      if (!serviceToken || req.headers['x-service-token'] !== serviceToken) {
        return json(res, 403, { ok: false, error: 'PRINCIPAL_UNTRUSTED' });
      }
      const tid = url.searchParams.get('tid');
      const route = `${req.method} ${url.pathname}`;

      if (route === 'POST /api/connectors/sessions') {
        const b = JSON.parse(body);
        return json(res, 200, { ok: true, ...(await svc.sessions.createSession({ tenantId: b.tenantId, customerId: b.customerId, createdBy: b.createdBy ?? 'api', sourceMode: b.sourceMode ?? 'real' })) });
      }
      if (route === 'POST /api/connectors/sessions/invite') {
        const b = JSON.parse(body);
        return json(res, 200, { ok: true, ...(await svc.sessions.invite({ sessionId: b.sessionId, participantId: b.participantId, role: b.role, ttlSec: b.ttlSec })) });
      }
      if (route === 'POST /api/connectors/sessions/join') {
        const b = JSON.parse(body);
        return json(res, 200, { ok: true, ...(await svc.sessions.join({ token: b.token })) });
      }
      if (route === 'POST /api/connectors/sessions/device') {
        const b = JSON.parse(body);
        return json(res, 200, { ok: true, ...(await svc.sessions.reportDevice({ sessionId: b.sessionId, participantId: b.participantId, camera: b.camera, mic: b.mic })) });
      }
      if (route === 'POST /api/connectors/sessions/network') {
        const b = JSON.parse(body);
        return json(res, 200, { ok: true, ...(await svc.sessions.reportNetwork({ sessionId: b.sessionId, participantId: b.participantId, disconnected: b.disconnected })) });
      }
      if (route === 'POST /api/connectors/sessions/end') {
        const b = JSON.parse(body);
        return json(res, 200, { ok: true, ...(await svc.sessions.endSession({ sessionId: b.sessionId, actor: b.actor })) });
      }
      if (route === 'GET /api/connectors/sessions/snapshot') {
        return json(res, 200, { ok: true, snapshot: await svc.sessions.panelSnapshot({ sessionId: tid }) });
      }
      if (route === 'POST /api/connectors/recording/start') {
        const b = JSON.parse(body);
        return json(res, 200, { ok: true, ...(await svc.recording.requestRecording({ tenantId: b.tenantId, sessionId: b.sessionId, requestedBy: b.requestedBy })) });
      }
      if (route === 'POST /api/connectors/evidence/media-url') {
        const b = JSON.parse(body);
        const art = (await svc.store.query(`SELECT customer_id, tenant_id FROM evidence_artifacts WHERE evidence_id=$1 AND tenant_id=$2`, [b.evidenceId, b.tenantId])).rows[0];
        if (!art) throw new ConnError('NOT_FOUND', `evidence ${b.evidenceId}`);
        if (b.customerId !== art.customer_id) throw new ConnError('MEDIA_URL_CUSTOMER_MISMATCH', 'artifact belongs to another customer');
        return json(res, 200, { ok: true, url: svc.objectStore.sign({ objectRef: b.objectRef, op: 'get', tenantId: b.tenantId, customerId: b.customerId, ttlSec: b.ttlSec ?? 120 }) });
      }
      if (route === 'POST /api/connectors/send') {
        const b = JSON.parse(body);
        return json(res, 200, { ok: true, ...(await svc.send.send({ tenantId: b.tenantId, actor: b.actor, customerId: b.customerId, threadId: b.threadId, audience: b.audience, text: b.text, clientMsgId: b.clientMsgId })) });
      }

      if (req.method === 'GET' && url.pathname.startsWith('/objects/')) {
        const objectRef = decodeURIComponent(url.pathname.slice('/objects/'.length));
        const v = svc.objectStore.verify({
          objectRef, op: url.searchParams.get('op'), tid: url.searchParams.get('tid'), cid: url.searchParams.get('cid'),
          exp: url.searchParams.get('exp'), sig: url.searchParams.get('sig'), nowMs: Date.now(),
        });
        const buf = await svc.objectStore.get(objectRef);
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
        return res.end(buf);
      }

      return json(res, 404, { ok: false, error: 'NOT_FOUND' });
    } catch (e) {
      if (e instanceof ConnError) return json(res, e.http, { ok: false, error: e.code, message: e.message, ...(e.extra ?? {}) });
      return json(res, 500, { ok: false, error: 'INTERNAL', message: String(e.message).slice(0, 200) });
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { server, async close() { await new Promise((r) => server.close(r)); } };
}

function json(res, status, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(s);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 2 * 1024 * 1024) { reject(new ConnError('INVALID_INPUT', 'body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
