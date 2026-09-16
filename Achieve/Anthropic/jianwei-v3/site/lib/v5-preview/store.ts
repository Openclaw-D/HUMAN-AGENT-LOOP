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

export const V5_STORE_SCHEMA = 'v5-preview-rows-store@2';
export const V5_STORE_FILE_NAME = 'rows-store.json';
export const V5_IDEMPOTENCY_CAPACITY = 500;
/** @1 旧 schema 值：读取兼容（缺省字段补默认），写入一律 @2。 */
const V5_STORE_SCHEMA_V1 = 'v5-preview-rows-store@1';

// ---------------------------------------------------------------------------
// V6 REPAIR evening（A）：共享状态关联字段。
// storyCursor = 固定演示当前步的稳定标识（stepId）；展示文案/待办状态变化不再使演示脱离路线。
// sharedDemo = 当前专属演示会话指针（指向 remote-store 的 rs-* 会话）；重开仅清除该会话。
// 两个字段对 @1 文件缺省（cursor=null / sessionId=null），读取侧补默认不拒绝；写入一律 @2。
// ---------------------------------------------------------------------------

export interface V5StoryCursor {
  stepId: string;
  updatedAt: string;
}

export interface V5SharedDemoRef {
  sessionId: string | null;
}

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
      // V6-CTRL B：幂等响应的 overview 必须通过完整深递归校验；replayed（可选）必须是 boolean。
      validateProjectOverviewShape((response as { overview?: unknown }).overview);
      const replayed = (response as { replayed?: unknown }).replayed;
      if (replayed !== undefined && typeof replayed !== 'boolean') {
        throw corruptStore(`idempotency[${index}].response.replayed 必须是 boolean 或缺省`);
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
  /** 固定演示当前步稳定标识（null = 未定位：@1 旧文件由服务层签名回退定位后回填）。 */
  storyCursor: V5StoryCursor | null;
  /** 当前专属演示会话（null = 尚未建立，由共享事实层懒建）。 */
  sharedDemo: V5SharedDemoRef;
}

interface StoredShape {
  schema: string;
  overview: ProjectOverview;
  idempotency: V5IdempotencyEntry[];
  storyCursor?: V5StoryCursor | null;
  sharedDemo?: V5SharedDemoRef;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// V6-CTRL B：持久化结构的完整失败关闭校验（递归而非只查顶层）。
// 任何字段缺失/类型不符/枚举非法/空值伪装对象 → STORE_CORRUPT，不部分修复、不静默重置。
// 纯校验函数：无依赖、无 IO，可被测试与探针直接复用。
// ---------------------------------------------------------------------------

const V5_DOMAIN_IDS: readonly string[] = ['policy', 'credit', 'commerce', 'asset'];
const V5_SEGMENT_STATES: readonly string[] = ['done', 'current', 'pending'];
const V5_JUDGMENT_STATUSES: readonly string[] = ['green', 'yellow', 'red', 'gray'];
const V5_TODO_STATUSES: readonly string[] = ['待补充', '待复核', '已完成（演示）', '已结清（演示）'];
const V5_FROM_KINDS: readonly string[] = ['business', 'domain', 'system'];
const V5_SCENARIOS: readonly string[] = ['approval', 'post-rental', 'settled'];

function nonEmptyString(o: Record<string, unknown>, key: string, path: string): void {
  if (typeof o[key] !== 'string' || (o[key] as string).length === 0) {
    throw corruptStore(`${path}.${key} 必须是非空 string`);
  }
}

function inEnum(value: unknown, allowed: readonly string[], path: string): void {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw corruptStore(`${path} 必须是 ${allowed.join('/')} 之一，收到 ${JSON.stringify(value)}`);
  }
}

function validDateString(o: Record<string, unknown>, key: string, path: string): void {
  const value = o[key];
  if (typeof value !== 'string' || value.length === 0 || Number.isNaN(Date.parse(value))) {
    throw corruptStore(`${path}.${key} 必须是可解析的时间字符串`);
  }
}

/** 校验单条消息（fromKind/文本/时间/marks 必须可被前端安全读取；null 不得伪装成有效对象）。 */
function validateMessageShape(value: unknown, path: string): void {
  if (!isPlainObject(value)) {
    throw corruptStore(`${path} 必须是对象`);
  }
  inEnum(value.fromKind, V5_FROM_KINDS, `${path}.fromKind`);
  nonEmptyString(value, 'fromName', path);
  nonEmptyString(value, 'text', path);
  validDateString(value, 'at', path);
  if (!Array.isArray(value.marks) || !value.marks.every((m) => typeof m === 'string')) {
    throw corruptStore(`${path}.marks 必须是 string 数组`);
  }
  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw corruptStore(`${path}.id 必须是非空 string`);
  }
}

/** 校验单个待办对象（非 null 时调用）。 */
function validateTodoShape(value: unknown, path: string): void {
  if (!isPlainObject(value)) {
    throw corruptStore(`${path} 必须是对象或 null，不得以其他类型伪装`);
  }
  nonEmptyString(value, 'id', path);
  nonEmptyString(value, 'title', path);
  nonEmptyString(value, 'detail', path);
  inEnum(value.status, V5_TODO_STATUSES, `${path}.status`);
  const related = value.relatedDomain;
  if (related !== null && !(typeof related === 'string' && V5_DOMAIN_IDS.includes(related))) {
    throw corruptStore(`${path}.relatedDomain 必须是四域之一或 null`);
  }
}

/** 校验完整 ProjectOverview（深递归）：项目字段、情景、版本、时间、整体进展、待办（或 null）、
 *  消息数组与恰好四个域（政策/信审/商务/资产按序各一次；每域四合法段状态+四非空段名+合法判断状态+非空文本/摘要）。 */
export function validateProjectOverviewShape(value: unknown): void {
  if (!isPlainObject(value)) {
    throw corruptStore('overview 必须是对象');
  }
  nonEmptyString(value, 'projectId', 'overview');
  nonEmptyString(value, 'customerName', 'overview');
  nonEmptyString(value, 'projectCode', 'overview');
  nonEmptyString(value, 'projectName', 'overview');
  nonEmptyString(value, 'scenarioLabel', 'overview');
  inEnum(value.scenario, V5_SCENARIOS, 'overview.scenario');
  if (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 0) {
    throw corruptStore('overview.version 必须是 >= 0 的整数');
  }
  validDateString(value, 'updatedAt', 'overview');
  if (!isPlainObject(value.overall)) {
    throw corruptStore('overview.overall 必须是对象');
  }
  nonEmptyString(value.overall, 'progressLabel', 'overview.overall');
  nonEmptyString(value.overall, 'description', 'overview.overall');
  if (!Array.isArray(value.domains) || value.domains.length !== 4) {
    throw corruptStore('overview.domains 必须是长度为 4 的数组（政策/信审/商务/资产）');
  }
  for (let index = 0; index < 4; index += 1) {
    const domain = value.domains[index];
    const path = `overview.domains[${index}]`;
    if (!isPlainObject(domain)) {
      throw corruptStore(`${path} 必须是对象`);
    }
    if (domain.domainId !== V5_DOMAIN_IDS[index]) {
      throw corruptStore(`${path}.domainId 必须是 ${V5_DOMAIN_IDS[index]}（四域按序各一次）`);
    }
    nonEmptyString(domain, 'name', path);
    if (!Array.isArray(domain.segmentLabels) || domain.segmentLabels.length !== 4
      || !domain.segmentLabels.every((s) => typeof s === 'string' && s.length > 0)) {
      throw corruptStore(`${path}.segmentLabels 必须是 4 个非空 string`);
    }
    if (!Array.isArray(domain.segments) || domain.segments.length !== 4
      || !domain.segments.every((s) => typeof s === 'string' && V5_SEGMENT_STATES.includes(s))) {
      throw corruptStore(`${path}.segments 必须是 4 个合法段状态（${V5_SEGMENT_STATES.join('/')}）`);
    }
    inEnum(domain.judgmentStatus, V5_JUDGMENT_STATUSES, `${path}.judgmentStatus`);
    nonEmptyString(domain, 'judgmentText', path);
    nonEmptyString(domain, 'summary', path);
  }
  if (value.todo !== null) {
    validateTodoShape(value.todo, 'overview.todo');
  }
  if (!Array.isArray(value.messages)) {
    throw corruptStore('overview.messages 必须是数组');
  }
  value.messages.forEach((m, i) => validateMessageShape(m, `overview.messages[${i}]`));
}

/** 校验/规范化共享状态字段：@1 文件缺省 → 默认值；@2 文件存在但形状非法 → 失败关闭。 */
function parseSharedBlocks(parsed: Record<string, unknown>): { storyCursor: V5StoryCursor | null; sharedDemo: V5SharedDemoRef } {
  const rawCursor = parsed.storyCursor;
  if (rawCursor === undefined) {
    // @1 旧文件：游标缺省，由服务层签名回退定位。
    return { storyCursor: null, sharedDemo: { sessionId: null } };
  }
  if (rawCursor === null) {
    return { storyCursor: null, sharedDemo: parseSharedDemoRef(parsed.sharedDemo) };
  }
  if (!isPlainObject(rawCursor)) {
    throw corruptStore('storyCursor 必须是对象或 null');
  }
  nonEmptyString(rawCursor, 'stepId', 'storyCursor');
  validDateString(rawCursor, 'updatedAt', 'storyCursor');
  return {
    storyCursor: { stepId: rawCursor.stepId as string, updatedAt: rawCursor.updatedAt as string },
    sharedDemo: parseSharedDemoRef(parsed.sharedDemo),
  };
}

function parseSharedDemoRef(value: unknown): V5SharedDemoRef {
  if (value === undefined || value === null) {
    return { sessionId: null };
  }
  if (!isPlainObject(value)) {
    throw corruptStore('sharedDemo 必须是对象');
  }
  const sessionId = value.sessionId;
  if (sessionId === null) return { sessionId: null };
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw corruptStore('sharedDemo.sessionId 必须是非空 string 或 null');
  }
  return { sessionId };
}

/** 失败关闭的形状校验：顶层 schema（@1 读取兼容 / @2）+ overview 深递归校验（V6-CTRL B）+ 幂等表逐项校验。
 *  任何字段缺失/类型不符/枚举非法/空值伪装对象都视为文件损坏（STORE_CORRUPT），不做部分恢复。 */
function parseStoredState(parsed: unknown): V5StoreState {
  if (!isPlainObject(parsed)) {
    throw corruptStore('顶层必须是 JSON 对象');
  }
  if (parsed.schema !== V5_STORE_SCHEMA && parsed.schema !== V5_STORE_SCHEMA_V1) {
    throw corruptStore(`schema 必须是 ${V5_STORE_SCHEMA}（兼容读取 @1），收到 ${JSON.stringify(parsed.schema)}`);
  }
  // 深递归校验：代替旧的顶层浅检查——四个 null 域、缺失嵌套字段、畸形幂等响应一律拒绝。
  validateProjectOverviewShape(parsed.overview);
  if (!Array.isArray(parsed.idempotency)) {
    throw corruptStore('idempotency 必须是数组');
  }
  const shared = parseSharedBlocks(parsed);
  return {
    overview: parsed.overview as unknown as ProjectOverview,
    idempotency: V5IdempotencyTable.fromJSON(parsed.idempotency),
    storyCursor: shared.storyCursor,
    sharedDemo: shared.sharedDemo,
  };
}

function serializeState(state: V5StoreState): string {
  const stored: StoredShape = {
    schema: V5_STORE_SCHEMA,
    overview: state.overview,
    idempotency: state.idempotency.toJSON(),
    storyCursor: state.storyCursor,
    sharedDemo: state.sharedDemo,
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
    persist({ overview: seeded, idempotency: new V5IdempotencyTable(), storyCursor: null, sharedDemo: { sessionId: null } });
    return { overview: seeded, idempotency: new V5IdempotencyTable(), storyCursor: null, sharedDemo: { sessionId: null } };
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
