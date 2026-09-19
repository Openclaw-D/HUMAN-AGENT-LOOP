import { createServer } from 'node:http';
import { ConnError } from '../errors.mjs';
import { newId, sha256Hex } from '../ids.mjs';
import { detectFormat } from '../../../C/src/parse/adapters.mjs';
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

export async function startServer(svc, { port = 48100, wecomConfig, trtcCallbackKey, serviceToken, callerBindings = null }) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    try {
      const body = await readBody(req);

      if (req.method === 'GET' && url.pathname === '/healthz') {
        // IR-04-2B：处理驱动只读观测（不改变既有字段；driverStarted=false 且未装配 processing 亦如实）
        return json(res, 200, {
          ok: true, service: 'jw-connectors',
          realWeCom: 'blocked_external_access', realTrtc: 'blocked_external_access',
          processing: svc.processing ? svc.processing.driverStatus() : { driverStarted: false, notWired: true },
        });
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

      // ---- 任务02 · actor 可信来源（IR-04-2A-3 冻结语义：token→调用方绑定）----
      // 服务令牌是服务间信任，不是资源授权；人类 actor 只能由"已认证网关"代理陈述，
      // 依据是部署配置的令牌→调用方绑定，不是任何新增 header 的存在性（存在≠可信）。
      // callerBindings: [{ token, caller, mayDelegateActor }]，每个绑定令牌都是独立的服务间凭据；
      // 未配置时默认把唯一 serviceToken 绑定为页面换权网关（本部署=Edge，会话→逐资源授权
      // 见 Back/Edge/src/channel-authz.mjs）。
      // 非代理调用方：自报人类 actor → 403 ACTOR_NOT_DELEGABLE（不静默改写审计语义）；
      // 未自报 → 以调用方服务身份生成（svc:<caller>，actorSource=token_binding）供内部自动化。
      // 显式配置 callerBindings 后，未绑定令牌在人工动作面一律 403 CALLER_NOT_TRUSTED（fail closed）。
      const callerBindingsMap = new Map(
        ((Array.isArray(callerBindings) && callerBindings.length > 0)
          ? callerBindings
          : [{ token: serviceToken, caller: 'edge-gateway', mayDelegateActor: true }]
        ).filter((x) => x?.token).map((x) => [x.token, x]),
      );
      const callerBindingOf = () => callerBindingsMap.get(req.headers['x-service-token']) ?? null;

      // 以下需服务令牌（唯一 serviceToken 或任一已绑定调用方令牌）。
      if (!serviceToken || !(req.headers['x-service-token'] === serviceToken || callerBindingsMap.has(req.headers['x-service-token']))) {
        return json(res, 403, { ok: false, error: 'PRINCIPAL_UNTRUSTED' });
      }
      const tid = url.searchParams.get('tid');
      const route = `${req.method} ${url.pathname}`;
      /** 人工动作 actor 上下文：返回 {actor, actorSource, caller} 注入请求体；网关未声明时返回 null=维持服务层原校验。 */
      const actorCtx = (b, field) => {
        const binding = callerBindingOf();
        if (!binding) throw new ConnError('CALLER_NOT_TRUSTED', '服务令牌未绑定调用方：人工动作面拒绝（callerBindings 未含此令牌）');
        const claimed = b?.[field];
        if (claimed != null && claimed !== '') {
          if (binding.mayDelegateActor !== true) {
            throw new ConnError('ACTOR_NOT_DELEGABLE', `调用方 ${binding.caller} 令牌无 actor 代理权：${field} 自报拒绝（依据 token 绑定，非 header 存在性）`);
          }
          return { actor: claimed, actorSource: 'gateway_delegated', caller: binding.caller };
        }
        if (binding.mayDelegateActor !== true) {
          return { actor: `svc:${binding.caller}`, actorSource: 'token_binding', caller: binding.caller };
        }
        return null;
      };

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
        //    IR-04-2A-1（任务02）：邀请归属客户必须与声明的 customerId 一致——伪造客户字段
        //    不得借他人邀请把材料登记到别的客户名下（跨户混淆口子闭合）。
        const anchors = [...(Array.isArray(b.objectRefs) ? b.objectRefs : []), ...(b.objectRef ? [b.objectRef] : [])];
        let invCustomerId = null;
        const scopeCheck = async (objectRef) => {
          const sc = await svc.intake.checkUploadScope({ tenantId: b.tenantId, invitationId: b.invitationId, kind: b.kind, objectRef });
          if (invCustomerId == null) invCustomerId = sc.customerId ?? null;
          else if (sc.customerId != null && sc.customerId !== invCustomerId) throw new ConnError('INTERNAL', '邀请归属客户不一致（数据异常）');
          return sc;
        };
        if (anchors.length === 0) {
          await scopeCheck(null);
        } else {
          for (const anchor of anchors) await scopeCheck(anchor);
        }
        if (!b.customerId) throw new ConnError('INVALID_INPUT', 'upload: customerId 必填');
        if (invCustomerId != null && invCustomerId !== b.customerId) {
          throw new ConnError('CUSTOMER_MISMATCH', `邀请 ${b.invitationId} 归属客户 ${invCustomerId}，与声明 customerId ${b.customerId} 不一致：拒绝（材料不落库）`);
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
        const act = actorCtx(b, 'verifiedBy');
        if (act) { b.verifiedBy = act.actor; b._actor = { source: act.actorSource, caller: act.caller }; }
        return json(res, 200, { ok: true, ...(await svc.evidence.verifyArtifact(b)) });
      }
      if (route === 'POST /api/connectors/evidence/coverage') {
        const b = JSON.parse(body);
        return json(res, 200, { ok: true, ...(await svc.evidence.evidenceCoverage(b)) });
      }

      // ---- goal-02（产品交付·任务二）· 人工路线：录入/更正/预览 ----
      if (route === 'POST /api/connectors/evidence/manual-entry') {
        if (!svc.evidence.manualEntry) throw new ConnError('INTERNAL', 'manualEntry not wired');
        const mb = JSON.parse(body);
        const act = actorCtx(mb, 'enteredBy');
        if (act) { mb.enteredBy = act.actor; mb._actor = { source: act.actorSource, caller: act.caller }; }
        return json(res, 200, { ok: true, ...(await svc.evidence.manualEntry(mb)) });
      }
      if (route === 'POST /api/connectors/evidence/correct-fact') {
        const b = JSON.parse(body);
        const actC = actorCtx(b, 'correctedBy');
        if (actC) b.correctedBy = actC.actor;
        if (!b.reason || !b.correctedBy) throw new ConnError('INVALID_INPUT', 'correct-fact: reason/correctedBy 必填（更正可回溯；更正≠核验完成）');
        // 更正事实继承原事实的锚定与来源（对象/期间/来源件不变），仅取值与理由更新
        const orig = (await svc.store.query(
          `SELECT customer_id, subject, predicate, object_ref, period_from, period_to, from_artifacts, unit FROM fact_assertions WHERE fact_id=$1 AND tenant_id=$2`,
          [b.correctsFactId, b.tenantId],
        )).rows[0];
        if (!orig) throw new ConnError('NOT_FOUND', `fact ${b.correctsFactId}`);
        // 任务02（IR-04-2A-3 资源归属面）：被更正事实必须归属声明客户——不得借更正他客户事实
        // 把修订链/新事实挂到别的客户名下（customerId 缺失时以事实归属为准，不另行推断）。
        if (!b.customerId) b.customerId = orig.customer_id;
        else if (orig.customer_id !== b.customerId) {
          throw new ConnError('CUSTOMER_MISMATCH', `fact ${b.correctsFactId} belongs to customer ${orig.customer_id}, not ${b.customerId}`);
        }
        const fact = {
          tenantId: b.tenantId, customerId: b.customerId,
          subject: b.fact?.subject ?? orig.subject,
          predicate: b.fact?.predicate ?? orig.predicate,
          objectValue: b.fact?.objectValue ?? b.fact?.value,
          unit: b.fact?.unit ?? orig.unit,
          fromArtifacts: Array.isArray(orig.from_artifacts) ? orig.from_artifacts : JSON.parse(orig.from_artifacts ?? '[]'),
          objectRef: orig.object_ref, periodFrom: orig.period_from, periodTo: orig.period_to,
          statement: `更正（${b.correctedBy}，理由：${String(b.reason).slice(0, 120)}）：${orig.subject} ${orig.predicate} = ${b.fact?.objectValue ?? b.fact?.value}（更正≠核验完成）`,
        };
        // 与 manualEntry 同公式的内容键：同证据同键同值的更正/重录确定性幂等（零重复候选）
        const fromArtifacts = Array.isArray(fact.fromArtifacts) ? fact.fromArtifacts : [];
        fact.contentKey = sha256Hex(JSON.stringify({
          t: b.tenantId, c: b.customerId, s: fact.subject, p: fact.predicate, v: fact.objectValue,
          u: fact.unit ?? null, pf: fact.periodFrom ?? null, pt: fact.periodTo ?? null,
          src: fromArtifacts[0] ?? null, mode: 'manual',
        }));
        const created = await svc.evidence.correctFact({ tenantId: b.tenantId, correctsFactId: b.correctsFactId, fact });
        // A 回写：被更正事实所在材料已在 A 登记 → 以取代关系登记更正版（业务凭据；登记≠核验）
        let aSync = 'skipped_no_bridge';
        if (svc.aBridge && created.factId) {
          // 来源件 = 原事实 from_artifacts 首件（evidence_artifacts 以 evidence_id 为键，无 artifact_id 列）
          const artId = Array.isArray(orig.from_artifacts) ? (orig.from_artifacts[0] ?? null)
            : (JSON.parse(orig.from_artifacts ?? '[]')[0] ?? null);
          const matLink = artId ? (await svc.store.query(
            `SELECT a_ref FROM a_links WHERE tenant_id=$1 AND entity_type IN ('material','supersede') AND local_id=$2 AND status='registered' AND a_ref IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
            [b.tenantId, artId],
          )).rows[0] : null;
          if (matLink?.a_ref) {
            const link = (await svc.store.query(
              `SELECT a_customer_id FROM a_customer_links WHERE tenant_id=$1 AND customer_id=$2`,
              [b.tenantId, b.customerId ?? ''],
            )).rows[0];
            if (link) {
              const requestId = `cor-${created.factId}`;
              try {
                const principalToken = svc.aBridge.principalOf('registrar');
                const r = await svc.aBridge.registerArtifactOp({
                  aCustomerId: link.a_customer_id,
                  kind: 'fact_correction',
                  factKey: `fact:${created.factId}`,
                  grade: 'unverified',
                  content: { connectorRef: { tenantId: b.tenantId, evidenceId: artId, factId: created.factId }, correctedValue: b.fact?.value ?? null, reason: String(b.reason).slice(0, 300), correctedBy: b.correctedBy },
                  provenance: { derivedFrom: [matLink.a_ref], generator: 'manual-correction', generationKind: 'derived' },
                  principalToken, requestId, timeoutMs: 5000,
                });
                await svc.store.query(
                  `INSERT INTO a_links (link_id, tenant_id, customer_id, task_id, entity_type, local_id, a_customer_id, a_ref, request_id, principal_id, status, detail)
                   VALUES ($1,$2,$3,NULL,'derived',$4,$5,$6,$7,'registrar','registered','{}')
                   ON CONFLICT (request_id) DO UPDATE SET status='registered', a_ref=$6, updated_at=now()`,
                  [`al-cor-${created.factId}`, b.tenantId, b.customerId ?? '', created.factId, link.a_customer_id, r.aArtifactId, requestId],
                );
                aSync = 'registered';
              } catch (e) {
                const unknown = e.code === 'A_UNKNOWN';
                await svc.store.query(
                  `INSERT INTO a_links (link_id, tenant_id, customer_id, task_id, entity_type, local_id, a_customer_id, request_id, principal_id, status, detail)
                   VALUES ($1,$2,$3,NULL,'derived',$4,$5,$6,'registrar',$7,$8)
                   ON CONFLICT (request_id) DO UPDATE SET status=$7, updated_at=now()`,
                  [`al-cor-${created.factId}`, b.tenantId, b.customerId ?? '', created.factId, link.a_customer_id, requestId,
                   unknown ? 'unknown' : 'failed', JSON.stringify({ code: e.code ?? 'A_ERROR', msg: String(e.message).slice(0, 160) })],
                );
                aSync = unknown ? 'unknown_reconcile_later' : 'failed_deterministic';
              }
            } else { aSync = 'skipped_no_customer_link'; }
          } else { aSync = 'skipped_material_not_registered'; }
        }
        return json(res, 200, { ok: true, ...created, aSync, note: '更正已留修订链；更正事实≠人工核验完成' });
      }
      if (route === 'GET /api/connectors/evidence/preview') {
        if (!tid || !url.searchParams.get('eid')) throw new ConnError('INVALID_INPUT', 'preview: tid/eid 必填');
        const art = (await svc.store.query(
          `SELECT object_ref, sha256, kind, completeness, customer_id FROM evidence_artifacts WHERE tenant_id=$1 AND evidence_id=$2`,
          [tid, url.searchParams.get('eid')],
        )).rows[0];
        if (!art) throw new ConnError('NOT_FOUND', 'evidence not found');
        // IR-04-2A-2（任务02）：工件归属客户必须与 cid 一致（与 evidence/media-url 同款对账）——
        // 不得为任意 (eid, cid) 组合铸造"合法"签名 URL。
        const cid = url.searchParams.get('cid') ?? '';
        if (art.customer_id !== cid) throw new ConnError('MEDIA_URL_CUSTOMER_MISMATCH', 'artifact belongs to another customer');
        let format = 'unknown'; let size = 0; let previewSafe = false;
        if (art.object_ref) {
          const buf = await svc.objectStore.get(art.object_ref);
          size = buf.length;
          const sniff = detectFormat(buf, {});
          format = sniff.name;
          previewSafe = sniff.previewSafe === true || sniff.family === 'pdf' || sniff.family === 'zipish' || sniff.family === 'csv' || sniff.family === 'text';
          const downloadUrl = svc.objectStore.sign({ objectRef: art.object_ref, op: 'get', tenantId: tid, customerId: cid, ttlSec: 120 });
          return json(res, 200, { ok: true, evidenceId: url.searchParams.get('eid'), customerId: art.customer_id, format, size, sha256: art.sha256, completeness: art.completeness, previewSafe, downloadUrl, note: '原件字节经短时签名 URL 获取（当前权限内），无公开媒体目录' });
        }
        return json(res, 200, { ok: true, evidenceId: url.searchParams.get('eid'), customerId: art.customer_id, format, size, sha256: art.sha256, completeness: art.completeness, previewSafe: false, downloadUrl: null });
      }

      // ---- 任务02 · 受控客户映射登记（映射场景专用；同 ID 场景由处理链权威核验自动接通）----
      if (route === 'POST /api/connectors/customers/link') {
        if (!svc.processing?.registerCustomerLink) throw new ConnError('INTERNAL', 'processing not wired');
        const b = JSON.parse(body);
        const act = actorCtx(b, 'requestedBy');
        if (act) b.requestedBy = act.actor;
        return json(res, 200, { ok: true, ...(await svc.processing.registerCustomerLink({
          tenantId: b.tenantId, customerId: b.customerId, aCustomerId: b.aCustomerId,
          legalEntityRef: b.legalEntityRef ?? null, requestedBy: b.requestedBy ?? 'api',
        })) });
      }
      // ---- IR-T01-3：按 requestId 查询通道动作回执（只读；a_links 对账簿）----
      if (route.startsWith('GET /api/connectors/processing/receipts/')) {
        if (!tid) throw new ConnError('INVALID_INPUT', 'tid（tenantId）必填');
        const requestId = url.pathname.slice('/api/connectors/processing/receipts/'.length);
        const row = (await svc.store.query(
          `SELECT link_id, tenant_id, customer_id, task_id, entity_type, local_id, a_customer_id, a_ref, request_id, principal_id, status, detail, created_at, updated_at
           FROM a_links WHERE tenant_id=$1 AND request_id=$2`,
          [tid, decodeURIComponent(requestId)],
        )).rows[0];
        if (!row) return json(res, 200, { ok: true, found: false, requestId: decodeURIComponent(requestId) });
        return json(res, 200, { ok: true, found: true, requestId: row.request_id, receipt: row, note: '通道动作对账簿（a_links）；A 动作回执在 A 侧 /receipts/:requestId' });
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
        const act = actorCtx(b, 'actor');
        if (act) b.actor = act.actor;
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
        const act = actorCtx(b, 'answerer');
        if (act) { b.answerer = act.actor; b._actor = { source: act.actorSource, caller: act.caller }; }
        return json(res, 200, { ok: true, ...(await svc.processing.recordAnswer({ tenantId: b.tenantId, customerId: b.customerId, questionKey: b.questionKey, answerText: b.answerText, answerer: b.answerer })) });
      }
      if (route === 'POST /api/connectors/questions/verify') {
        if (!svc.processing) throw new ConnError('INTERNAL', 'processing not wired');
        const b = JSON.parse(body);
        const act = actorCtx(b, 'verifiedBy');
        if (act) { b.verifiedBy = act.actor; b._actor = { source: act.actorSource, caller: act.caller }; }
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
