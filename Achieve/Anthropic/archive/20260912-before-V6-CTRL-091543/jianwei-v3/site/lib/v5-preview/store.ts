// V5 ROWS · 隔离演示存储（Backend worker 拥有本文件；契约见 V5/handoff/ROWS_FULLSTACK/IMPLEMENTATION.md §1）。
// 单进程 JSON 文件存储，全部为合成演示数据：
//   - 目录 = process.env.V5_PREVIEW_DATA_DIR（测试隔离用），默认 <site>/.v5-preview-data（与源码分开，未跟踪）；
//   - 文件名固定 rows-store.json；
//   - 读取：文件不存在 → 用调用方提供的种子初始化（首次为 approval 情景）；存在但不可解析/形状不符
//     → 抛 V5PreviewStoreError('STORE_CORRUPT')，绝不静默重置/重建；
//   - 写入 = 同目录临时文件 + renameSync 原子替换；IO 失败 → V5PreviewStoreError('STORE_UNAVAILABLE')；
//   - 每次操作都重新读文件（无内存权威副本）：外部改坏文件在下次 GET 即暴露为 STORE_CORRUPT，
//     服务重启后状态天然恢复；
//   - 内置幂等表（requestId → 载荷哈希 + 响应），容量 500，超出丢最旧；随状态一并持久化；
//   - 单进程假设：Node 单线程 + 全同步读改写区（无 await 穿插）即可，无跨进程锁。
// 持久化等级如实声明：单进程、无并发多实例保证、无事务承诺（IMPLEMENTATION.md §1）。

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectOverview, WriteResponse } from './shared-types.ts';

export const V5_STORE_SCHEMA = 'v5-preview-rows-store@1';
export const V5_STORE_FILE_NAME = 'rows-store.json';
export const V5_IDEMPOTENCY_CAPACITY = 500;

/** 存储层错误：code 直接对应 ApiErrorCode 的存储分支（500 STORE_CORRUPT / 500 STORE_UNAVAILABLE）。 */
export class V5PreviewStoreError extends Error {
  readonly code: 'STORE_CORRUPT' | 'STORE_UNAVAILABLE';

  constructor(code: 'STORE_CORRUPT' | 'STORE_UNAVAILABLE', message: string) {
    super(message);
    this.name = 'V5PreviewStoreError';
    this.code = code;
  }
}

export function corruptStore(detail: string): V5PreviewStoreError {
  return new V5PreviewStoreError('STORE_CORRUPT', `v5-preview 存储文件损坏，已失败关闭（不自动重置）：${detail}`);
}

function storeUnavailable(action: string, error: unknown): V5PreviewStoreError {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return new V5PreviewStoreError('STORE_UNAVAILABLE', `v5-preview 存储 ${action} 失败：${detail}`);
}

/** 数据目录：环境变量优先（必须支持，测试隔离用）；空/未设置时回退 <site>/.v5-preview-data。 */
export function getV5PreviewDataDir(): string {
  const fromEnv = process.env.V5_PREVIEW_DATA_DIR;
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  // 默认假设 dev server 从 site 根目录启动（npm run dev 的标准方式）。
  return join(process.cwd(), '.v5-preview-data');
}

export function getV5PreviewStoreFilePath(): string {
  return join(getV5PreviewDataDir(), V5_STORE_FILE_NAME);
}

// ---------------------------------------------------------------------------
// 幂等表：requestId → { 载荷哈希, 原始 200 响应 }；容量 500，超出丢最旧。
// ---------------------------------------------------------------------------

export interface V5IdempotencyEntry {
  requestId: string;
  /** 载荷哈希（sha256 hex），由 service 层用规范化后的原始语义字段计算。 */
  hash: string;
  /** 原始成功响应（不含 replayed 标记）；重放时附带 replayed: true 返回。 */
  response: WriteResponse;
}

export class V5IdempotencyTable {
  private readonly entries = new Map<string, V5IdempotencyEntry>();

  static fromJSON(value: unknown): V5IdempotencyTable {
    const table = new V5IdempotencyTable();
    if (!Array.isArray(value)) {
      throw corruptStore('idempotency 必须是数组');
    }
    for (let index = 0; index < value.length; index += 1) {
      const raw = value[index];
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw corruptStore(`idempotency[${index}] 必须是对象`);
      }
      const entry = raw as Record<string, unknown>;
      const requestId = entry.requestId;
      const hash = entry.hash;
      const response = entry.response;
      if (typeof requestId !== 'string' || requestId.length === 0) {
        throw corruptStore(`idempotency[${index}].requestId 必须是非空 string`);
      }
      if (typeof hash !== 'string' || hash.length === 0) {
        throw corruptStore(`idempotency[${index}].hash 必须是非空 string`);
      }
      if (typeof response !== 'object' || response === null || Array.isArray(response)) {
        throw corruptStore(`idempotency[${index}].response 必须是对象`);
      }
      if ((response as { ok?: unknown }).ok !== true) {
        throw corruptStore(`idempotency[${index}].response.ok 必须是 true`);
      }
      table.entries.set(requestId, { requestId, hash, response: response as WriteResponse });
    }
    return table;
  }

  lookup(requestId: string): V5IdempotencyEntry | undefined {
    return this.entries.get(requestId);
  }

  /** 记录新条目：同 id 先删后插（刷新位置）；超过容量丢弃最旧（Map 插入序首项）。 */
  record(entry: V5IdempotencyEntry): void {
    this.entries.delete(entry.requestId);
    this.entries.set(entry.requestId, entry);
    while (this.entries.size > V5_IDEMPOTENCY_CAPACITY) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) {
        break;
      }
      this.entries.delete(oldest.value);
    }
  }

  toJSON(): V5IdempotencyEntry[] {
    return Array.from(this.entries.values());
  }
}

// ---------------------------------------------------------------------------
// 状态文件读写
// ---------------------------------------------------------------------------

export interface V5StoreState {
  overview: ProjectOverview;
  idempotency: V5IdempotencyTable;
}

interface StoredShape {
  schema: string;
  overview: ProjectOverview;
  idempotency: V5IdempotencyEntry[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 失败关闭的形状校验：任何字段缺失/类型不符都视为文件损坏（STORE_CORRUPT），不做部分恢复。 */
function parseStoredState(parsed: unknown): V5StoreState {
  if (!isPlainObject(parsed)) {
    throw corruptStore('顶层必须是 JSON 对象');
  }
  if (parsed.schema !== V5_STORE_SCHEMA) {
    throw corruptStore(`schema 必须是 ${V5_STORE_SCHEMA}，收到 ${JSON.stringify(parsed.schema)}`);
  }
  const overview = parsed.overview;
  if (!isPlainObject(overview)) {
    throw corruptStore('overview 必须是对象');
  }
  if (typeof overview.projectId !== 'string' || overview.projectId.length === 0) {
    throw corruptStore('overview.projectId 必须是非空 string');
  }
  if (typeof overview.version !== 'number' || !Number.isInteger(overview.version) || overview.version < 0) {
    throw corruptStore('overview.version 必须是 >= 0 的整数');
  }
  if (!Array.isArray(overview.domains) || overview.domains.length !== 4) {
    throw corruptStore('overview.domains 必须是长度为 4 的数组（政策/信审/商务/资产）');
  }
  if (!Array.isArray(parsed.idempotency)) {
    throw corruptStore('idempotency 必须是数组');
  }
  return {
    overview: overview as unknown as ProjectOverview,
    idempotency: V5IdempotencyTable.fromJSON(parsed.idempotency),
  };
}

function serializeState(state: V5StoreState): string {
  const stored: StoredShape = {
    schema: V5_STORE_SCHEMA,
    overview: state.overview,
    idempotency: state.idempotency.toJSON(),
  };
  return `${JSON.stringify(stored, null, 2)}\n`;
}

function persist(state: V5StoreState): void {
  const dir = getV5PreviewDataDir();
  const file = join(dir, V5_STORE_FILE_NAME);
  try {
    mkdirSync(dir, { recursive: true });
    // 临时文件带 pid（单进程假设下不必要，但可避免 dev server 多进程实例互相覆盖半写文件），
    // 同目录 renameSync 原子替换，目标存在时覆盖。
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, serializeState(state), 'utf8');
    renameSync(tmp, file);
  } catch (error) {
    throw storeUnavailable('写入', error);
  }
}

/**
 * 读取当前状态。文件不存在 → 用 seed() 初始化并落盘返回；存在但不可解析/形状不符 → STORE_CORRUPT。
 * 每次调用都重新读文件：外部把文件改坏后，下一次 GET/POST 即返回 STORE_CORRUPT，不静默重置。
 */
export function readV5StoreState(options: { seed: () => ProjectOverview }): V5StoreState {
  const file = getV5PreviewStoreFilePath();
  let raw: string;
  if (!existsSync(file)) {
    const seeded = options.seed();
    persist({ overview: seeded, idempotency: new V5IdempotencyTable() });
    return { overview: seeded, idempotency: new V5IdempotencyTable() };
  }
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    throw storeUnavailable('读取', error);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw corruptStore(`文件不是合法 JSON（${error instanceof Error ? error.message : String(error)}）`);
  }
  return parseStoredState(parsed);
}

/** 写入当前状态（临时文件 + rename 原子替换）。 */
export function writeV5StoreState(state: V5StoreState): void {
  persist(state);
}

// ---------------------------------------------------------------------------
// 载荷哈希：service 层用规范化后的原始语义字段调用；字段顺序由调用方固定构造保证稳定。
// ---------------------------------------------------------------------------

export function hashV5Payload(canonical: string): string {
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
