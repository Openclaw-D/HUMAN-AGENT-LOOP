// V6 R2 夜间 · 请求可靠性注册表（多请求并存，替代单 pending 槽）。
// 设计约束（验收 F1-主 + A 路教训）：
// - 同会话可同时存在多条"结果未知"请求，新操作不得覆盖旧记录；
// - 容量背压：仅淘汰已 confirmed/abandoned 的项，unknown 永不被挤掉；
// - 原样重试：同 op + 同业务载荷（去 requestId 比较）+ 同会话 → 复用冻结的 requestId 与载荷；
// - 草稿关联：{requestId, revision} 绑定，requestId/修订双不一致不清草稿；
// - create-session 请求失联后 session=null 仍可列出与重试；
// - 持久化经注入适配器（sessionStorage/内存），失败时退化为内存（本会话仍可重试）。
// 非业务事实源：注册表只是"客户端待确认命令"记录，服务端幂等表+版本门仍是唯一真相。

export interface RegistryEntry {
  requestId: string;
  op: string;
  path: string;
  body: Record<string, unknown>;
  ownerSessionId: string;
  savedAt: number;
  draftRevision: number | null;
  status: 'unknown' | 'confirmed' | 'abandoned';
}

export interface RegistryStorage {
  get(): string | null;
  set(value: string): void;
  remove(): void;
}

export interface RegistryDraftAssociation {
  requestId: string;
  revision: number;
}

export const REGISTRY_CAPACITY = 16;

export type RegistryBeginResult =
  | { ok: true; entry: RegistryEntry }
  | { ok: false; reason: 'backpressure'; unknownCount: number };

/** 业务载荷同一性：去掉 requestId 后逐字节比较（requestId 由注册表冻结）。 */
export function sameBusinessPayload(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const strip = (o: Record<string, unknown>) => {
    const { requestId: _r, ...rest } = o;
    return JSON.stringify(rest);
  };
  return strip(a) === strip(b);
}

export class RequestRegistry {
  private storage: RegistryStorage;
  private idFactory: () => string;
  private memory: RegistryEntry[] | null = null; // storage 不可用时的会话内退化
  private capacity: number;

  private draftStorage: { get(key: string): string | null; set(key: string, value: string): void } | null;

  constructor(options?: {
    storage?: RegistryStorage;
    idFactory?: () => string;
    capacity?: number;
    /** 草稿关联存储注入（浏览器缺省用 sessionStorage；Node 测试注入内存实现）。 */
    draftStorage?: { get(key: string): string | null; set(key: string, value: string): void } | null;
  }) {
    this.storage = options?.storage ?? { get: () => null, set: () => undefined, remove: () => undefined };
    this.idFactory = options?.idFactory ?? (() => `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
    this.capacity = options?.capacity ?? REGISTRY_CAPACITY;
    this.draftStorage = options?.draftStorage !== undefined ? options.draftStorage : windowDraftStorage();
  }

  private load(): RegistryEntry[] {
    if (this.memory !== null) return this.memory;
    const raw = this.storage.get();
    if (raw === null) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((e) => typeof e === 'object' && e !== null) as RegistryEntry[];
    } catch {
      return [];
    }
  }

  private save(entries: RegistryEntry[]): void {
    this.memory = entries;
    try {
      this.storage.set(JSON.stringify(entries));
    } catch {
      // 持久失败：保留内存副本（本会话重试可用），刷新后丢失——由调用方如实提示。
    }
  }

  /** 冻结并记录一条新请求（发送前调用）。容量背压：unknown 满 → 拒绝（不挤掉在途）。 */
  begin(input: { op: string; path: string; body: Record<string, unknown>; ownerSessionId: string; draftRevision?: number | null }): RegistryBeginResult {
    const entries = this.load();
    const unknownCount = entries.filter((e) => e.status === 'unknown').length;
    if (unknownCount >= this.capacity) {
      return { ok: false, reason: 'backpressure', unknownCount };
    }
    const entry: RegistryEntry = {
      requestId: this.idFactory(),
      op: input.op,
      path: input.path,
      body: input.body,
      ownerSessionId: input.ownerSessionId,
      savedAt: Date.now(),
      draftRevision: input.draftRevision ?? null,
      status: 'unknown',
    };
    entries.push(entry);
    this.save(entries);
    return { ok: true, entry };
  }

  /** 原样重试查找：同 op + 同业务载荷 + 同会话 + status=unknown 的记录（复用其 requestId/载荷）。 */
  findRetry(op: string, body: Record<string, unknown>, ownerSessionId: string): RegistryEntry | null {
    const entries = this.load();
    return (
      entries.find(
        (e) => e.status === 'unknown' && e.op === op && e.ownerSessionId === ownerSessionId && sameBusinessPayload(e.body, body),
      ) ?? null
    );
  }

  /** 确定性结果（成功/明确失败）→ 标记并清理；NETWORK 未知 → 保持 unknown。 */
  resolve(requestId: string, outcome: 'confirmed' | 'dropped'): void {
    const entries = this.load();
    const kept = entries.filter((e) => {
      if (e.requestId !== requestId) return true;
      return outcome !== 'confirmed' && outcome !== 'dropped' ? true : false;
    });
    this.save(kept);
  }

  /** 显式放弃（用户知情后）。 */
  abandon(requestId: string): void {
    this.resolve(requestId, 'dropped');
  }

  listUnknown(ownerSessionId?: string): RegistryEntry[] {
    return this.load().filter((e) => e.status === 'unknown' && (ownerSessionId === undefined || e.ownerSessionId === ownerSessionId));
  }

  /** 会话创建请求失联（owner 为空串）时的重试入口：session=null 也能列出。 */
  listUndefinedOwner(): RegistryEntry[] {
    return this.load().filter((e) => e.status === 'unknown' && e.ownerSessionId === '');
  }

  getByRequest(requestId: string): RegistryEntry | null {
    return this.load().find((e) => e.requestId === requestId) ?? null;
  }

  /** 草稿-请求关联（含会话内持久化，供刷新后恢复判断）；draftStorage 为 null 时仅内存。 */
  private draftMemory = new Map<string, string>();

  associateDraft(ownerSessionId: string, requestId: string, revision: number): void {
    const key = `jw:v5-preview:remote-draft-assoc:${ownerSessionId}`;
    const value = JSON.stringify({ requestId, revision });
    this.draftMemory.set(key, value);
    if (this.draftStorage !== null) {
      try {
        this.draftStorage.set(key, value);
      } catch {
        // 持久失败：内存副本仍可用（本会话判定不受影响）。
      }
    }
  }

  readDraftAssociation(ownerSessionId: string): RegistryDraftAssociation | null {
    const key = `jw:v5-preview:remote-draft-assoc:${ownerSessionId}`;
    const raw = this.draftStorage !== null ? this.draftStorage.get(key) : (this.draftMemory.get(key) ?? null);
    const source = raw ?? this.draftMemory.get(key) ?? null;
    if (source === null) return null;
    try {
      const parsed = JSON.parse(source) as RegistryDraftAssociation;
      if (typeof parsed.requestId !== 'string' || typeof parsed.revision !== 'number') return null;
      return parsed;
    } catch {
      return null;
    }
  }
}

/** 浏览器缺省草稿存储（Node/测试无 window 时返回 null → 内存退化）。 */
function windowDraftStorage(): { get(key: string): string | null; set(key: string, value: string): void } | null {
  const w = globalThis as { sessionStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } };
  if (w.sessionStorage) return { get: (k) => w.sessionStorage!.getItem(k), set: (k, v) => w.sessionStorage!.setItem(k, v) };
  return null;
}

/** 草稿清空判定：关联存在 + requestId 一致 + 修订未前进。 */
export function shouldClearDraftForRequest(
  assoc: RegistryDraftAssociation | null,
  confirmedRequestId: string | undefined,
  currentRevision: number,
): boolean {
  if (assoc === null || confirmedRequestId === undefined) return false;
  if (assoc.requestId !== confirmedRequestId) return false;
  return assoc.revision === currentRevision;
}
