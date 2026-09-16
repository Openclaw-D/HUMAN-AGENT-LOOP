// 审计 sink（任务04 S3/S5 E0）：只追加；对外发送客户消息等可审计副作用必须先落审计再生效。
// 真实持久化（DB 表/文件）随任务01内核落地替换此 seam；条目不含凭据原文。
import { randomUUID } from 'node:crypto';

export function createAuditSink({ now = () => new Date().toISOString() } = {}) {
  const entries = [];
  return {
    append({ actorPrincipalId, action, targetType, targetId, customerId, summary, detail }) {
      const entry = {
        seq: entries.length + 1,
        at: now(),
        actorPrincipalId: actorPrincipalId || null,
        action,
        targetType: targetType || null,
        targetId: targetId || null,
        customerId: customerId || null,
        summary: summary || '',
        detail: detail || null,
        auditId: randomUUID(),
      };
      entries.push(entry);
      return entry;
    },
    list({ limit = 100, customerId } = {}) {
      const arr = customerId ? entries.filter((e) => e.customerId === customerId) : entries;
      return arr.slice(-limit).map((e) => ({ ...e }));
    },
    _size() { return entries.length; },
  };
}
