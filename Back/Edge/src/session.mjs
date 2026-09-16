// 会话存储（任务04 S3）：浏览器只持有不透明 sessionId；credential→principal 的映射只存在
// 服务端内存（TTL），上游凭据永不出现在响应/静态资源中。真实身份源接入属部署形态（S5），当前
// 仅支持注入验证器，默认拒绝一切交换请求（fail-closed）。
import { randomUUID } from 'node:crypto';

export function createSessionStore({ ttlMs = 30 * 60 * 1000, now = () => Date.now() } = {}) {
  const sessions = new Map(); // sessionId -> { sessionId, principalId, roles, credential, createdAt, expiresAt }

  return {
    // verifyCredential: async ({credential}) => ({ok, principalId?, roles?}) —— 由调用方注入。
    // credential 原文保留在服务端会话记录内（转发上游用）；exchange 响应只含选定字段，绝不回传原文。
    async exchange(verifyCredential, credential) {
      const verdict = await verifyCredential({ credential });
      if (!verdict || verdict.ok !== true || !verdict.principalId) {
        return { ok: false, reason: (verdict && verdict.reason) || 'PRINCIPAL_UNTRUSTED' };
      }
      const sessionId = randomUUID();
      const rec = {
        sessionId,
        principalId: verdict.principalId,
        roles: verdict.roles || [],
        credential: String(credential),
        createdAt: now(),
        expiresAt: now() + ttlMs,
      };
      sessions.set(sessionId, rec);
      return { ok: true, session: { sessionId, principalId: rec.principalId, roles: rec.roles, expiresAt: rec.expiresAt } };
    },

    resolve(sessionId) {
      if (!sessionId) return null;
      const rec = sessions.get(sessionId);
      if (!rec) return null;
      if (now() > rec.expiresAt) {
        sessions.delete(sessionId);
        return null;
      }
      return rec;
    },

    // 权限变更即失效（任务04：会话过期与权限变更处理）。
    revoke(sessionId) {
      return sessions.delete(sessionId);
    },

    revokeAllFor(principalId) {
      for (const [id, rec] of sessions) if (rec.principalId === principalId) sessions.delete(id);
    },

    _size() { return sessions.size; },
  };
}
