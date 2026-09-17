import { createServer } from 'node:http';
import { ConnError } from '../errors.mjs';
import { newId } from '../ids.mjs';
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

export async function startServer(svc, { port = 48100, wecomConfig, trtcCallbackKey, serviceToken }) {
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

      // 签名 URL 读取：面向获准的浏览器/客户端（无服务令牌），安全性由 HMAC 签名 +
      // 租户/客户/操作/时效校验承担；必须在服务令牌门之前，否则签名 URL 永不可用。
      if (req.method === 'GET' && url.pathname.startsWith('/objects/')) {
        const objectRef = decodeURIComponent(url.pathname.slice('/objects/'.length));
        svc.objectStore.verify({
          objectRef, op: url.searchParams.get('op'), tid: url.searchParams.get('tid'), cid: url.searchParams.get('cid'),
          exp: url.searchParams.get('exp'), sig: url.searchParams.get('sig'), nowMs: Date.now(),
        });
        const buf = await svc.objectStore.get(objectRef);
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
        return res.end(buf);
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

      // ---- 任务02 · B1 进件域（W01/W02/W03/W10）----
      if (route === 'POST /api/connectors/intake/invitations') {
        const b = JSON.parse(body);
        return json(res, 200, { ok: true, ...(await svc.intake.issueInvitation(b)) });
      }
      if (route === 'POST /api/connectors/intake/accept') {
        const b = JSON.parse(body);
        return json(res, 200, { ok: true, ...(await svc.intake.acceptInvitation(b)) });
      }
      if (route === 'POST /api/connectors/intake/verify-binding') {
        const b = JSON.parse(body);
        return json(res, 200, { ok: true, ...(await svc.intake.verifyBinding(b)) });
      }
      if (route === 'POST /api/connectors/intake/revoke') {
        const b = JSON.parse(body);
        return json(res, 200, { ok: true, ...(await svc.intake.revokeInvitation(b)) });
      }
      if (route === 'POST /api/connectors/evidence/upload') {
        const b = JSON.parse(body);
        if (!svc.objectStore) throw new ConnError('INTERNAL', 'objectStore not wired');
        // 1) 范围门：邀请须 accepted、kind 获准、对象在锚定范围（W01）；多锚点逐一校验
        const anchors = [...(Array.isArray(b.objectRefs) ? b.objectRefs : []), ...(b.objectRef ? [b.objectRef] : [])];
        if (anchors.length === 0) {
          await svc.intake.checkUploadScope({ tenantId: b.tenantId, invitationId: b.invitationId, kind: b.kind, objectRef: null });
        } else {
          for (const anchor of anchors) {
            await svc.intake.checkUploadScope({ tenantId: b.tenantId, invitationId: b.invitationId, kind: b.kind, objectRef: anchor });
          }
        }
        // 2) 原件入受控对象存储（内容哈希由对象存储落库；get 时复核）
        let objectRef = b.objectRef ?? null;
        let sha256 = null;
        let readable = b.readable !== false;
        if (b.contentBase64 != null) {
          const buf = Buffer.from(b.contentBase64, 'base64');
          if (buf.length === 0) readable = false; // 空内容=不可读，不得编造
          objectRef = objectRef ?? newId('up');
          const put = await svc.objectStore.put(objectRef, buf, { tenantId: b.tenantId, contentType: b.contentType ?? 'application/octet-stream' });
          sha256 = put.sha256;
        } else if (objectRef == null) {
          throw new ConnError('INVALID_INPUT', 'upload: contentBase64 或 objectRef 必须提供其一');
        }
        // 3) 登记原件+口径元数据；不可读 → needs_followup（待补），绝不产生事实候选
        const reg = await svc.evidence.registerArtifact({
          tenantId: b.tenantId, customerId: b.customerId, sessionId: b.sessionId ?? null,
          sourceProvider: 'customer_upload', kind: b.kind,
          objectRef, sha256, sourceGroup: b.sourceGroup ?? `upload:${b.customerId}:${b.kind}`,
          derivedFrom: b.derivedFrom ?? null,
          capturedAt: b.capturedAt ?? null,
          periodFrom: b.periodFrom ?? null, periodTo: b.periodTo ?? null,
          currency: b.currency ?? null, unit: b.unit ?? null, caliber: b.caliber ?? null,
          pageFrom: b.pageFrom ?? null, pageTo: b.pageTo ?? null,
          uploaderRef: b.invitationId, uploadSource: 'customer_upload',
          objectRefs: b.objectRefs ?? (objectRef ? [objectRef] : []),
          completeness: readable ? b.completeness ?? 'complete' : 'needs_followup',
          readable,
          sourceMode: b.sourceMode ?? 'real',
        });
        // goal-02 · 修正原件：显式取代关系 → 旧件标 superseded_by（历史不改写；材料集只取现行件）
        if (b.supersedesEvidenceId) {
          const s = await svc.store.query(
            `UPDATE evidence_artifacts SET superseded_by=$3 WHERE tenant_id=$1 AND evidence_id=$2 AND superseded_by IS NULL RETURNING evidence_id`,
            [b.tenantId, b.supersedesEvidenceId, reg.evidenceId],
          );
          if (s.rows.length === 0) throw new ConnError('INVALID_STATE', `supersedesEvidenceId ${b.supersedesEvidenceId} 不存在或已被取代`);
        }
        return json(res, 200, {
          ok: true, ...reg,
          ...(svc.processing ? { processing: await svc.processing.enqueueArtifact({ tenantId: b.tenantId, customerId: b.customerId, evidenceId: reg.evidenceId, kind: b.kind }) } : {}),
          note: reg.completeness === 'needs_followup'
            ? '材料不可读/缺失：已登记待补，不产生任何事实候选'
            : '已登记为声明级未核验工件；处理（解压/解析/分析）由持久任务推进，传输完成≠解析完成',
        });
      }
      if (route === 'POST /api/connectors/evidence/verify') {
        const b = JSON.parse(body);
        return json(res, 200, { ok: true, ...(await svc.evidence.verifyArtifact(b)) });
      }
      if (route === 'POST /api/connectors/evidence/coverage') {
        const b = JSON.parse(body);
        return json(res, 200, { ok: true, ...(await svc.evidence.evidenceCoverage(b)) });
      }

      // ---- goal-02 · 处理协调面（持久任务/进度回执/问题准备/暂停）----
      if (route === 'POST /api/connectors/processing/tick') {
        if (!svc.processing) throw new ConnError('INTERNAL', 'processing not wired');
        const b = body ? JSON.parse(body) : {};
        return json(res, 200, { ok: true, ...(await svc.processing.tick({ maxTasks: b.maxTasks })) });
      }
      if (route === 'GET /api/connectors/processing/status') {
        if (!svc.processing) throw new ConnError('INTERNAL', 'processing not wired');
        if (!tid) throw new ConnError('INVALID_INPUT', 'tid（tenantId）必填');
        return json(res, 200, { ok: true, ...(await svc.processing.statusForCustomer({ tenantId: tid, customerId: url.searchParams.get('cid') })) });
      }
      if (route.startsWith('GET /api/connectors/processing/tasks/')) {
        if (!svc.processing) throw new ConnError('INTERNAL', 'processing not wired');
        const taskId = url.pathname.slice('/api/connectors/processing/tasks/'.length);
        const t = await svc.processing.getTask({ tenantId: tid, taskId });
        if (!t) throw new ConnError('NOT_FOUND', `task ${taskId}`);
        return json(res, 200, { ok: true, task: t });
      }
      if (route === 'POST /api/connectors/processing/pause') {
        if (!svc.processing) throw new ConnError('INTERNAL', 'processing not wired');
        const b = JSON.parse(body);
        return json(res, 200, { ok: true, ...(await svc.processing.setPause({ tenantId: b.tenantId, customerId: b.customerId ?? null, paused: b.paused === true, actor: b.actor ?? 'api' })) });
      }
      if (route === 'GET /api/connectors/questions/pending') {
        if (!svc.processing) throw new ConnError('INTERNAL', 'processing not wired');
        const st = await svc.processing.statusForCustomer({ tenantId: tid, customerId: url.searchParams.get('cid') });
        return json(res, 200, { ok: true, questions: st.questions, pause: st.pause });
      }
      if (route === 'POST /api/connectors/questions/answer') {
        if (!svc.processing) throw new ConnError('INTERNAL', 'processing not wired');
        const b = JSON.parse(body);
        return json(res, 200, { ok: true, ...(await svc.processing.recordAnswer({ tenantId: b.tenantId, customerId: b.customerId, questionKey: b.questionKey, answerText: b.answerText, answerer: b.answerer })) });
      }
      if (route === 'POST /api/connectors/questions/verify') {
        if (!svc.processing) throw new ConnError('INTERNAL', 'processing not wired');
        const b = JSON.parse(body);
        return json(res, 200, { ok: true, ...(await svc.processing.verifyQuestion({ tenantId: b.tenantId, customerId: b.customerId, questionKey: b.questionKey, verifiedBy: b.verifiedBy, note: b.note })) });
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
