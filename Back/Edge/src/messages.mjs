// 消息受众路由（任务04 S3 / D09 E0）：customer 与 internal 两种受众分别处理；
// 内部内容外发默认拒绝（403 AUDIENCE_MISMATCH），仅显式 confirmExternalSend 放行并强制审计；
// 送达未知如实返回，不标已读。真实通道（企微/RTC）属任务02——此处为 seam，语义不因通道实现改变。
export function createMessageRouter({ deliver, auditSink }) {
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
        threadId: typeof body.threadId === 'string' ? body.threadId : null,
      });

      // 可审计副作用：每次发送（含确认外发）都留审计；送达未知不标已读。
      auditSink.append({
        actorPrincipalId: session.principalId,
        action: audience === 'customer' ? 'message.sent.customer' : 'message.sent.internal',
        targetType: 'customer', targetId: customerId, customerId,
        summary: audience === 'customer'
          ? (body.confirmExternalSend === true && body.internalContent === true ? '内部内容经显式确认外发客户' : '消息发送至客户受众')
          : '内部消息',
        detail: { requestId, audience, messageId: result.messageId ?? 'unknown', confirmed: body.confirmExternalSend === true },
      });
      log(`[messages] ${audience} -> ${customerId} requestId=${requestId}`);

      return {
        status: 200,
        body: {
          ok: true,
          requestId,
          audience,
          delivery: { messageId: result.messageId ?? 'unknown', state: result.state || 'unknown' },
          note: '送达未知时不标已读；客户端以服务端状态为准',
        },
      };
    },
  };
}
