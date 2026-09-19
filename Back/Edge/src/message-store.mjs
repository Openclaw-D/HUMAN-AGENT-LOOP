// 页内消息线程存储（goal-03e，DEF-G04N-05 页面侧修复的 Edge 面）：此前 deliver 只进一次性
// sink（无读取端点）——发送方有服务端回执、对端永不渲染。本存储按客户保留线程（内存、有界），
// 由消息路由在投递成功后写入；GET /api/jw/v2/customers/:id/messages 读端点按会话角色裁决可见
// 受众（customer-only 只见 audience=customer，显式请求 internal → 403，边界由服务端强制）。
// 纪律：requestId 幂等由消息路由承担（重放不二次入栈）；本存储只追加、不撤回，送达未知不标已读。
import { randomUUID } from 'node:crypto';

export function createMessageStore({ maxPerCustomer = 500 } = {}) {
  const threads = new Map(); // customerId -> { items: [{seq, messageId, ...}], base: 已裁剪掉的最大 seq }

  const bucket = (customerId) => {
    let b = threads.get(customerId);
    if (!b) {
      b = { items: [], base: 0 };
      threads.set(customerId, b);
    }
    return b;
  };

  return {
    /** 投递成功后入栈（由消息路由调用）；返回带 seq/messageId/at 的完整记录。 */
    append({ customerId, audience, text, requestId, senderPrincipalId, senderRoles = [], threadId = null, deliverMessageId = null }) {
      const b = bucket(customerId);
      const seq = b.base + b.items.length + 1;
      const rec = {
        seq,
        messageId: typeof deliverMessageId === 'string' && deliverMessageId ? deliverMessageId : `msg-${randomUUID()}`,
        audience: audience === 'internal' ? 'internal' : 'customer',
        text: String(text),
        requestId: String(requestId ?? ''),
        senderPrincipalId: String(senderPrincipalId ?? 'unknown'),
        senderRoles: [...senderRoles],
        threadId,
        at: new Date().toISOString(),
      };
      b.items.push(rec);
      if (b.items.length > maxPerCustomer) {
        const drop = b.items.splice(0, b.items.length - maxPerCustomer);
        b.base += drop.length;
      }
      return rec;
    },

    /**
     * 线程读取：audience 过滤（customer|internal|null=全部）；afterSeq 严格之后增量；
     * limit 有界。返回 { messages, cursor }——cursor=当前最大 seq（无消息时为 '0'），
     * 客户端以 ?after=<cursor> 续拉，不漏不重。
     */
    list(customerId, { audience = null, afterSeq = 0, limit = 200 } = {}) {
      const b = threads.get(customerId);
      const maxLimit = Math.min(Number(limit) || 200, 500);
      if (!b) return { messages: [], cursor: String(b ? b.base : 0) };
      const from = Math.max(Number(afterSeq) || 0, b.base);
      let items = b.items.filter((m) => m.seq > from);
      if (audience === 'customer' || audience === 'internal') items = items.filter((m) => m.audience === audience);
      const window = items.slice(-maxLimit);
      const last = b.items[b.items.length - 1];
      return {
        messages: window.map((m) => structuredClone(m)),
        cursor: String(last ? last.seq : b.base),
      };
    },

    /** 部署/测试探针：线程数与总条数（不回传内容）。 */
    stats() {
      let count = 0;
      for (const b of threads.values()) count += b.items.length;
      return { threads: threads.size, messages: count };
    },
  };
}
