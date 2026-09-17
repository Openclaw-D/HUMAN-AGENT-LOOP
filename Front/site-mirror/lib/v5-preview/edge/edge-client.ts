// Edge 接线·HTTP/SSE 客户端（任务三 C2）：浏览器只持不透明会话 ID；
// 上游凭据永不出现在此层（Edge 服务端映射）。SSE 用 fetch 流 + 手动解析（需带会话头，
// EventSource 无法自定义头）；重连带 ?cursor= 旧游标，游标过期按 resync 事件重取快照。
import type { EdgeSnapshotShapes } from './edge-logic';

export interface EdgeClientOptions {
  baseUrl: string; // 例如 http://127.0.0.1:48200（部署形态下通常同源）
  fetchImpl?: typeof fetch;
}

export interface EdgeSessionInfo {
  sessionId: string;
  principalId: string;
  roles: string[];
  expiresAt: number;
}

export interface WorkspaceResponse {
  ok: boolean;
  customerId: string;
  principalId?: string;
  snapshot: EdgeSnapshotShapes;
  snapshotVersion: number | string; // kernel 模式为字符串 seq（bigint 精度），fixture 为数字
  eventCursor: string | null;
  source?: string;
  eventWindow?: {
    buffered: number; oldestSeq: string | null; newestSeq: string | null; gap: boolean; truncated: boolean; note?: string;
  };
  projection?: {
    notes?: string[];
    freshness?: Record<string, { ok: boolean; at: string; code?: string; note?: string }>;
    at?: string;
  };
  error?: string;
}

export interface ReadyzCheck { name: string; ok: boolean; detail?: Record<string, unknown> }
export interface ReadyzResponse {
  ok: boolean;
  checks: ReadyzCheck[];
  capabilities?: Record<string, unknown>;
  checkedAt?: string;
}

export class EdgeHttpError extends Error {
  status: number;
  code: string;
  requestId?: string;
  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export function createEdgeClient({ baseUrl, fetchImpl = fetch }: EdgeClientOptions) {
  const root = baseUrl.replace(/\/$/, '');
  let session: EdgeSessionInfo | null = null;

  const authed = (): EdgeSessionInfo => {
    if (!session) throw new EdgeHttpError(0, 'NO_SESSION', '尚未建立 Edge 会话');
    return session;
  };

  return {
    get session(): EdgeSessionInfo | null { return session; },

    /** 凭据换取不透明会话（凭据只经此一次，不落地；失败显示原因）。 */
    async exchange(credential: string): Promise<EdgeSessionInfo> {
      const r = await fetchImpl(`${root}/api/jw/v2/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credential }),
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'INVALID_RESPONSE' }));
      if (!r.ok || !j.ok) throw new EdgeHttpError(r.status, String(j.error ?? 'EXCHANGE_FAILED'), String(j.note ?? '会话建立失败'));
      session = { sessionId: j.session.sessionId, principalId: j.session.principalId, roles: j.session.roles ?? [], expiresAt: j.session.expiresAt };
      return session;
    },

    /** 显式结束会话（本地状态清除；服务端 TTL 到期自然失效）。 */
    endSession(): void { session = null; },

    async workspace(customerId: string): Promise<WorkspaceResponse> {
      const s = authed();
      const r = await fetchImpl(`${root}/api/jw/v2/customers/${encodeURIComponent(customerId)}/workspace`, {
        headers: { 'x-jw-session': s.sessionId },
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'INVALID_RESPONSE' }));
      if (!r.ok) throw new EdgeHttpError(r.status, String(j.error ?? 'WORKSPACE_FAILED'), String(j.error ?? '工作台获取失败'));
      return j as WorkspaceResponse;
    },

    /** 服务端回执查询（动作丢响应后的对账依据）。 */
    async receipt(requestId: string): Promise<{ found: boolean; receipt?: unknown }> {
      const s = authed();
      const r = await fetchImpl(`${root}/api/jw/v2/receipts/${encodeURIComponent(requestId)}`, {
        headers: { 'x-jw-session': s.sessionId },
      });
      const j = await r.json().catch(() => ({ ok: false }));
      if (!r.ok) throw new EdgeHttpError(r.status, String(j.error ?? 'RECEIPT_FAILED'), '回执查询失败');
      return j;
    },

    /** 消息（受众路由）：customer/internal 分离；内部外发需服务端外发权限点，拒绝原样抛出。 */
    async sendMessage(customerId: string, body: { requestId: string; audience: 'customer' | 'internal'; text: string; threadId?: string; internalContent?: boolean; confirmExternalSend?: boolean }): Promise<{ ok: boolean; requestId: string; audience: string; delivery: { messageId: string; state: string }; replayed?: boolean }> {
      const s = authed();
      const r = await fetchImpl(`${root}/api/jw/v2/customers/${encodeURIComponent(customerId)}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-jw-session': s.sessionId },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'INVALID_RESPONSE' }));
      if (!r.ok) throw new EdgeHttpError(r.status, String(j.error ?? 'SEND_FAILED'), String(j.note ?? j.message ?? '消息未送达'), typeof j.requestId === 'string' ? j.requestId : undefined);
      return j;
    },

    /** 大历史分页（live）：A after/limit 逐页直读，逐请求鉴权；不假装知道总数。 */
    async eventsPage(customerId: string, afterSeq = '0', limit = 200): Promise<{ ok: boolean; events: Array<{ eventId: string; payloadRef?: { type?: string }; payload?: unknown; aggregateVersion: string }>; nextAfterSeq: string; hasMore: boolean }> {
      const s = authed();
      const q = new URLSearchParams({ afterSeq: String(afterSeq), limit: String(limit) });
      const r = await fetchImpl(`${root}/api/jw/v2/customers/${encodeURIComponent(customerId)}/events-page?${q}`, {
        headers: { 'x-jw-session': s.sessionId },
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'INVALID_RESPONSE' }));
      if (!r.ok) throw new EdgeHttpError(r.status, String(j.error ?? 'PAGE_FAILED'), String(j.note ?? '分页事件获取失败'));
      return j;
    },

    /** readiness 逐依赖检查（C1.6：组件级独立显示，无 all_ok 汇总位）。 */
    async readyz(): Promise<ReadyzResponse> {
      const r = await fetchImpl(`${root}/healthz/ready`);
      return await r.json();
    },

    /** 动作（白名单代理）：必带 requestId；上游未知 502 时抛出并保留原 ID 供重试。 */
    async action<T = Record<string, unknown>>(path: string, body: Record<string, unknown>): Promise<T> {
      const s = authed();
      const r = await fetchImpl(`${root}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-jw-session': s.sessionId },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'INVALID_RESPONSE' }));
      if (!r.ok) {
        throw new EdgeHttpError(r.status, String(j.error ?? 'ACTION_FAILED'), String(j.message ?? j.note ?? '动作未成功'), typeof j.requestId === 'string' ? j.requestId : undefined);
      }
      return j as T;
    },

    /**
     * 事件流：cursor=null 时服务端先发 cursor 基线；重连时传上次游标。
     * 返回 stop()。onOpen：SSE 响应就绪（200）即回调——调用方借此把重连态转回 live。
     * onResync：游标过期（Edge 重启/窗口裁剪）→ 调用方重取快照再重订。
     * onDrop(reason, status?)：status 为 HTTP 状态码；401/403=会话失效，调用方应转终态而非无限重连。
     */
    openEvents(customerId: string, cursor: string | null, handlers: {
      onEvent: (envelope: { eventId: string; payloadRef?: { type?: string }; payload?: unknown }) => void;
      onCursor: (cursor: string, snapshotVersion: number | string) => void;
      onOpen?: () => void;
      onResync: () => void;
      /** status 为 HTTP 状态码（可得时）；401/403=会话失效，调用方应转终态而非无限重连。 */
      onDrop: (reason: string, status?: number) => void;
      /** 服务端 auth 帧（撤权/会话过期）：终止性，调用方应转未连接态并要求重认证，不得自动重连。 */
      onAuth?: (info: { code?: string; note?: string }) => void;
    }, fetchCtor = fetchImpl): () => void {
      const s = authed();
      const controller = new AbortController();
      void (async () => {
        try {
          const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
          const r = await fetchCtor(`${root}/api/jw/v2/customers/${encodeURIComponent(customerId)}/events${q}`, {
            headers: { 'x-jw-session': s.sessionId, accept: 'text/event-stream' },
            signal: controller.signal,
          });
          if (!r.ok || !r.body) {
            handlers.onDrop(`HTTP ${r.status}`, r.status);
            return;
          }
          handlers.onOpen?.();
          const reader = r.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          for (; ;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            // 逐帧切割交给纯逻辑层（可单测）
            const { parseSseFrames } = await import('./edge-logic');
            const parsed = parseSseFrames(buf);
            buf = parsed.rest;
            for (const f of parsed.frames) {
              if (f.event === 'cursor') {
                try { const d = JSON.parse(f.data); handlers.onCursor(String(d.eventCursor ?? ''), d.snapshotVersion ?? 0); } catch { /* 忽略坏帧 */ }
              } else if (f.event === 'resync') {
                handlers.onResync();
              } else if (f.event === 'auth') {
                // 终止性事件（C1.2）：撤权/会话过期——不再消费后续帧，由调用方决定重认证
                try { const d = JSON.parse(f.data); handlers.onAuth?.({ code: String(d.code ?? 'AUTH'), note: String(d.note ?? '') }); } catch { handlers.onAuth?.({}); }
                return;
              } else if (f.event === 'business') {
                try { handlers.onEvent(JSON.parse(f.data)); } catch { /* 忽略坏帧 */ }
              }
            }
          }
          handlers.onDrop('stream ended');
        } catch (e) {
          if (!controller.signal.aborted) handlers.onDrop(String((e as Error).message ?? e));
        }
      })();
      return () => controller.abort();
    },

    /** 版本封存（连接/模式提示展示 buildId；capabilities 逐能力独立展示，无 all_ok）。 */
    async versionz(): Promise<{ buildId?: string; contractVersion?: string | null; capabilities?: Record<string, unknown>; delivery?: { rulePack?: { version?: string | null } } }> {
      const r = await fetchImpl(`${root}/versionz`);
      return await r.json();
    },
  };
}

export type EdgeClient = ReturnType<typeof createEdgeClient>;
