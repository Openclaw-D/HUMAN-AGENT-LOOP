// 消息受众路由（任务04 S3 / D09 E0；任务03 C2.5 收紧）：customer 与 internal 两种受众分别处理；
// 内部内容外发默认拒绝（403 AUDIENCE_MISMATCH），显式 confirmExternalSend 还须通过
// messages:external-send 权限点（server 层校验）并强制审计；送达未知如实返回，不标已读。
// validateTarget（live）：发往客户前以本会话凭据向 A 校验目标客户可读，防错 customerId。
// requestId 幂等：同 ID 同载荷重放 → 原结果 + replayed:true；同 ID 异载荷 → 409 冲突。
export function createMessageRouter({ deliver, auditSink, validateTarget = null }) {
  const seen = new Map(); // requestId -> { fingerprint, result }（进程内幂等表，条目有界）
  const fingerprintOf = (body) => JSON.stringify({ audience: body.audience, text: body.text, threadId: body.threadId ?? null, internalContent: body.internalContent === true });

  return {
    async handle({ session, customerId, body, log = () => { } }) {
      const requestId = body.requestId;
      if (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 128) {
        return { status: 400, body: { ok: false, error: 'REQUEST_ID_REQUIRED' } };
      }
      const audience = body.audience;
      if (audience !== 'customer' && audience !== 'internal') {
        return { status: 400, body: { ok: false, error: 'INVALID_AUDIENCE', note: 'audience 必须是 customer|internal' } };
      }
      const text = body.text;
      if (typeof text !== 'string' || text.length < 1 || text.length > 4000) {
        return { status: 400, body: { ok: false, error: 'INVALID_TEXT' } };
      }
      const threadId = typeof body.threadId === 'string' && body.threadId.length <= 128 ? body.threadId : null;

      // 目标校验（C2.5/U07）：customerId 必须对本会话凭据可读（A 裁决），拒绝任意/错挂目标。
      if (validateTarget) {
        const target = await validateTarget(session, customerId);
        if (!target?.ok) {
          auditSink.append({
            actorPrincipalId: session.principalId,
            action: 'message.target_refused',
            targetType: 'customer', targetId: customerId, customerId,
            summary: `消息目标客户校验未通过（${target?.code ?? 'UNKNOWN'}）`,
            detail: { requestId },
          });
          return { status: target?.status === 403 ? 403 : target?.status === 404 ? 404 : 502, body: { ok: false, error: target?.code || 'TARGET_UNVERIFIED', note: '目标客户对本会话不可读或校验失败：不投递' } };
        }
      }

      // requestId 幂等表（有界：1024 条，超出丢最旧）
      const fp = fingerprintOf(body);
      const prior = seen.get(requestId);
      if (prior) {
        if (prior.fingerprint !== fp) {
          return { status: 409, body: { ok: false, error: 'REQUEST_ID_CONFLICT', note: '同 requestId 已用于不同载荷：拒绝执行，换新 ID 前先核对' } };
        }
        return { status: 200, body: { ...prior.result, replayed: true } };
      }

      // 受众守卫：标记为内部内容（internalContent）的消息发往客户 → 默认拒绝。
      if (audience === 'customer' && body.internalContent === true && body.confirmExternalSend !== true) {
        auditSink.append({
          actorPrincipalId: session.principalId,
          action: 'message.external_send_refused',
          targetType: 'customer', targetId: customerId, customerId,
          summary: '内部内容发往客户被受众校验拒绝（未显式确认）',
          detail: { requestId },
        });
        return {
          status: 403,
          body: {
            ok: false,
            error: 'AUDIENCE_MISMATCH',
            note: '内部内容不可外发客户；如确需，须显式 confirmExternalSend=true 并留审计',
          },
        };
      }

      const result = await deliver({
        customerId,
        audience,
        text,
        requestId,
        senderPrincipalId: session.principalId,
        threadId,
      });

      // 可审计副作用：每次发送（含确认外发）都留审计；送达未知不标已读。
      auditSink.append({
        actorPrincipalId: session.principalId,
        action: audience === 'customer' ? 'message.sent.customer' : 'message.sent.internal',
        targetType: 'customer', targetId: customerId, customerId,
        summary: audience === 'customer'
          ? (body.confirmExternalSend === true && body.internalContent === true ? '内部内容经显式确认外发客户' : '消息发送至客户受众')
          : '内部消息',
        detail: { requestId, audience, messageId: result.messageId ?? 'unknown', confirmed: body.confirmExternalSend === true, threadId },
      });
      log(`[messages] ${audience} -> ${customerId} requestId=${requestId}`);

      const responseBody = {
        ok: true,
        requestId,
        audience,
        delivery: { messageId: result.messageId ?? 'unknown', state: result.state || 'unknown' },
        note: '送达未知时不标已读；客户端以服务端状态为准',
      };
      if (seen.size >= 1024) seen.delete(seen.keys().next().value);
      seen.set(requestId, { fingerprint: fp, result: responseBody });
      return { status: 200, body: responseBody };
    },
  };
}
