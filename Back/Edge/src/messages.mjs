// 消息受众路由（任务04 S3 / D09 E0；任务03 C2.5 收紧；任务04 §四·恢复重写幂等回执；R2-01 幂等与持久未知）：
// customer 与 internal 两种受众分别处理；内部内容外发默认拒绝（403 AUDIENCE_MISMATCH），
// 显式 confirmExternalSend 还须通过 messages:external-send 权限点（server 层校验）并强制审计；
// 送达未知如实返回，不标已读。validateTarget（live）：发往客户前以本会话凭据向 A 校验目标客户
// 可读，防错 customerId。
//
// requestId 幂等（R2-01 契约，见 docs/v0.4/results/r2-01-messages/CONTRACT-R2-01.md）：
//   - 回执绑定可信作用域 scope=(customerId, session.principalId, session.tenantId??'')；
//     body 中的 principalId/tenantId 声明一律忽略。指纹仍为 {audience, text, threadId, internalContent}。
//   - 同 scope 同指纹重放 → 原回执 + replayed:true（failed/unknown 原样重放，零二次发送）；
//     异 scope / 异载荷 → 409 REQUEST_ID_CONFLICT，不披露对方回执；
//     旧无作用域回执（principal_id=''）→ 409 失败关闭：零发送、不清账、不静默改键重发。
//   - 发送前原子 claim（SQLite 端 BEGIN IMMEDIATE + ON CONFLICT；内存端事件循环原子），
//     胜者持 owner_token；intent→terminal 仅 owner 可为。并发同 ID 只有一次真实发送。
//   - deliver 抛错 → owner 落持久 unknown，返回 502 DELIVERY_UNKNOWN；崩溃遗留 intent 经
//     租约（pendingLeaseMs，默认 15 分钟）原子收敛为 unknown；跨裁剪/重启不被遗忘、不盲重发。
// 未提供 receiptStore 时退回进程内同协议 ledger（E0 兼容，条目有界，pending/unknown 不逐出）。
import { randomUUID } from 'node:crypto';

// 进程内兜底 ledger：与 message-store 同一协议面（claim/owner finalize/租约回收/裁剪保护）。
function createVolatileReceiptLedger({ maxEntries = 1024 } = {}) {
  const rows = new Map(); // requestId -> record（插入序≈时间序）
  const trimmable = (r) => r.status === 'terminal' && r.state !== 'unknown';
  return {
    getReceiptRecord(requestId) {
      const r = rows.get(String(requestId));
      return r ? { ...r, scope: { ...r.scope } } : null;
    },
    claimReceipt(requestId, fingerprint, scope, { ownerToken } = {}) {
      const rid = String(requestId);
      const existing = rows.get(rid);
      if (existing) return { claimed: false, existing: { ...existing, scope: { ...existing.scope } } };
      rows.set(rid, {
        fingerprint: String(fingerprint), status: 'pending', scope: { ...scope },
        legacy: false, result: null, state: null, ownerToken: String(ownerToken ?? ''), claimedAt: new Date().toISOString(),
      });
      return { claimed: true };
    },
    finalizeReceipt(requestId, ownerToken, result, { state = 'sent' } = {}) {
      const r = rows.get(String(requestId));
      if (!r || r.status !== 'pending' || r.ownerToken !== String(ownerToken ?? '')) return false;
      r.status = 'terminal'; r.result = result; r.state = String(state ?? 'sent'); r.ownerToken = null; r.claimedAt = null;
      return true;
    },
    expirePendingReceipt(requestId, maxAgeMs, unknownResult) {
      const r = rows.get(String(requestId));
      if (!r || r.status !== 'pending') return false;
      if (!(r.claimedAt && Date.now() - Date.parse(r.claimedAt) > (Number(maxAgeMs) || 0))) return false;
      r.status = 'terminal'; r.state = 'unknown'; r.result = unknownResult; r.ownerToken = null; r.claimedAt = null;
      return true;
    },
    // 有界：仅逐出 terminal 且非 unknown 的最旧条目（pending/unknown 不因裁剪被遗忘）。
    trim() {
      if (rows.size <= maxEntries) return;
      for (const [k, r] of rows) {
        if (rows.size <= maxEntries) break;
        if (trimmable(r)) rows.delete(k);
      }
    },
  };
}

export function createMessageRouter({ deliver, auditSink, validateTarget = null, threadStore = null, receiptStore = null, pendingLeaseMs = 15 * 60 * 1000 }) {
  const receipts = receiptStore ?? createVolatileReceiptLedger();
  const fingerprintOf = (body) => JSON.stringify({ audience: body.audience, text: body.text, threadId: body.threadId ?? null, internalContent: body.internalContent === true });
  const scopeOf = (session, customerId) => ({
    customerId: String(customerId ?? ''),
    principalId: String(session?.principalId ?? ''),
    tenantId: String(session?.tenantId ?? ''),
  });
  const sameScopeFingerprint = (record, fp, scope) => record.fingerprint === fp
    && record.scope.customerId === scope.customerId
    && record.scope.principalId === scope.principalId
    && record.scope.tenantId === scope.tenantId;
  const unknownDeliveryBody = (requestId, audience) => ({
    ok: true,
    requestId,
    audience,
    delivery: { messageId: 'unknown', state: 'unknown' },
    note: '送达未知时不标已读；客户端以服务端状态为准',
  });

  // 未决回执（pending intent）裁决：同 scope 同指纹且租约已过 → 原子收敛为 unknown 后按 unknown
  // 重放；未到期 → 409 IN_FLIGHT；异 scope/异指纹 → 409 CONFLICT（不回收、不披露）。
  const resolvePending = (requestId, record, fp, scope, audience) => {
    if (sameScopeFingerprint(record, fp, scope)) {
      const unknownBody = unknownDeliveryBody(requestId, audience);
      if (receipts.expirePendingReceipt(requestId, pendingLeaseMs, unknownBody)) {
        return { status: 200, body: { ...unknownBody, replayed: true } };
      }
      return {
        status: 409,
        body: { ok: false, error: 'REQUEST_ID_IN_FLIGHT', note: '同 requestId 的首次发送尚未决出结果：不重发、不重放；待其终态后再试' },
      };
    }
    return { status: 409, body: { ok: false, error: 'REQUEST_ID_CONFLICT', note: '同 requestId 正被其他作用域使用：拒绝执行' } };
  };

  // 已有回执裁决（terminal/pending/legacy 统一入口）；无既有回执返回 null。
  const resolvePrior = (requestId, record, fp, scope, audience) => {
    if (!record) return null;
    if (record.status === 'pending') return resolvePending(requestId, record, fp, scope, audience);
    if (record.legacy) {
      return {
        status: 409,
        body: { ok: false, error: 'REQUEST_ID_CONFLICT', note: '该 requestId 存在无作用域旧回执：失败关闭，不重发、不清账；换新 ID 前先人工核对' },
      };
    }
    if (!sameScopeFingerprint(record, fp, scope)) {
      return { status: 409, body: { ok: false, error: 'REQUEST_ID_CONFLICT', note: '同 requestId 已用于不同载荷或不同作用域：拒绝执行，换新 ID 前先核对' } };
    }
    return { status: 200, body: { ...record.result, replayed: true } };
  };

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

      // requestId 幂等（R2-01）：鉴权与受众守卫先行（撤权后重放不得借缓存）；命中回执按
      // 契约裁决——重放不二次投递、不二次入栈；冲突/在途/旧无作用域一律零发送。
      const fp = fingerprintOf(body);
      const scope = scopeOf(session, customerId);
      const resolved = resolvePrior(requestId, receipts.getReceiptRecord(requestId), fp, scope, audience);
      if (resolved) return resolved;

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

      // 原子认领（R2-01）：胜者才允许发送；败者按既有记录裁决（pending=IN_FLIGHT/CONFLICT，
      // terminal=重放或冲突），绝不并发进入 deliver。
      const ownerToken = randomUUID();
      const claim = receipts.claimReceipt(requestId, fp, scope, { ownerToken });
      if (!claim.claimed) {
        const again = resolvePrior(requestId, claim.existing, fp, scope, audience);
        return again ?? { status: 409, body: { ok: false, error: 'REQUEST_ID_CONFLICT', note: '同 requestId 已被并发使用：拒绝执行' } };
      }

      let result;
      try {
        result = await deliver({
          customerId,
          audience,
          text,
          requestId,
          senderPrincipalId: session.principalId,
          threadId,
        });
      } catch (e) {
        // 发送后异常（R2-01）：结果不明 → owner 落持久 unknown（裁剪/重启都不遗忘），如实返回 502。
        const unknownBody = unknownDeliveryBody(requestId, audience);
        receipts.finalizeReceipt(requestId, ownerToken, unknownBody, { state: 'unknown' });
        log(`[messages] delivery unknown after error requestId=${requestId} (${e?.message ?? e})`);
        return { status: 502, body: { ...unknownBody, ok: false, error: 'DELIVERY_UNKNOWN', note: '发送通道异常，结果未知：已持久记录，重放不二次发送' } };
      }

      // 线程留档（DEF-G04N-05）：投递成功才入栈——对端读端点据此渲染；重放（上方早退）不重复入栈。
      if (threadStore) {
        threadStore.append({
          customerId, audience, text, requestId,
          senderPrincipalId: session.principalId,
          senderRoles: session.roles ?? [],
          threadId,
          deliverMessageId: result.messageId ?? null,
        });
      }

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
      receipts.finalizeReceipt(requestId, ownerToken, responseBody, { state: result.state || 'unknown' });
      receipts.trim?.();
      return { status: 200, body: responseBody };
    },
  };
}
