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
  snapshot: EdgeSnapshotShapes;
  snapshotVersion: number;
  eventCursor: string | null;
  source?: string;
  projection?: { notes?: string[] };
  error?: string;
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
     * 返回 stop()。onResync：游标过期（Edge 重启/窗口裁剪）→ 调用方重取快照再重订。
     */
    openEvents(customerId: string, cursor: string | null, handlers: {
      onEvent: (envelope: { eventId: string; payloadRef?: { type?: string }; payload?: unknown }) => void;
      onCursor: (cursor: string, snapshotVersion: number) => void;
      onResync: () => void;
      onDrop: (reason: string) => void;
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
            handlers.onDrop(`HTTP ${r.status}`);
            return;
          }
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
                try { const d = JSON.parse(f.data); handlers.onCursor(String(d.eventCursor ?? ''), Number(d.snapshotVersion ?? 0)); } catch { /* 忽略坏帧 */ }
              } else if (f.event === 'resync') {
                handlers.onResync();
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

    /** 版本封存（连接/模式提示展示 buildId，观众可核对运行版本）。 */
    async versionz(): Promise<{ buildId?: string; contractVersion?: string | null; delivery?: { rulePack?: { version?: string | null } } }> {
      const r = await fetchImpl(`${root}/versionz`);
      return await r.json();
    },
  };
}

export type EdgeClient = ReturnType<typeof createEdgeClient>;
