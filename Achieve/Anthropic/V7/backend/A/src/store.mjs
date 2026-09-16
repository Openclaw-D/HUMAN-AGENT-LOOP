// V7 A · 通用 JSON 文件存储引擎（CONTRACT §1；V5/V6 已验证模式的零依赖重实现）。
// 纪律：一个数据目录只归一个服务进程；失败关闭——schema/形状不符 → StoreCorruptError，
// 不静默重置；写入 = 临时文件 + renameSync 原子替换；每次命令重读盘（外部改坏立即暴露）。
// 幂等表：requestId → { hash, response }；同 id 同 hash 重放、异 hash REQUEST_MISMATCH；
// 容量 500，超出丢最旧。哈希 = sha256(canonical payload)。

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const IDEMPOTENCY_CAPACITY = 500;

export class StoreCorruptError extends Error {
  constructor(detail) {
    super(`存储文件损坏，已失败关闭（不自动重置）：${detail}`);
    this.name = 'StoreCorruptError';
    this.code = 'STORE_CORRUPT';
  }
}

export class StoreUnavailableError extends Error {
  constructor(op, cause) {
    super(`存储 ${op} 失败：${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`);
    this.name = 'StoreUnavailableError';
    this.code = 'STORE_UNAVAILABLE';
  }
}

export class RequestMismatchError extends Error {
  constructor() {
    super('同 requestId 但载荷不同：重试不得更换载荷');
    this.name = 'RequestMismatchError';
    this.code = 'REQUEST_MISMATCH';
  }
}

export function sha256(canonical) {
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** 规范化命令载荷（键序固定：由调用方以字面量构造保证），返回载荷哈希。 */
export function payloadHash(payload) {
  return sha256(JSON.stringify(payload));
}

function storePath(dataDir, fileName) {
  return join(dataDir, fileName);
}

function readFileRaw(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    throw new StoreUnavailableError('读取', error);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new StoreCorruptError(`文件不是合法 JSON（${error instanceof Error ? error.message : String(error)}）`);
  }
}

function writeFileAtomic(file, text) {
  try {
    mkdirSync(join(file, '..'), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, file);
  } catch (error) {
    throw new StoreUnavailableError('写入', error);
  }
}

/** 幂等表：加载时逐条校验（损坏失败关闭）；lookup/record/capacity。 */
export class IdempotencyTable {
  constructor() {
    this.entries = new Map();
  }

  static fromJSON(list, corrupt) {
    const table = new IdempotencyTable();
    if (!Array.isArray(list)) throw corrupt('idempotency 必须是数组');
    for (let i = 0; i < list.length; i += 1) {
      const raw = list[i];
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw corrupt(`idempotency[${i}] 必须是对象`);
      if (typeof raw.requestId !== 'string' || raw.requestId.length === 0) throw corrupt(`idempotency[${i}].requestId 必须是非空 string`);
      if (typeof raw.hash !== 'string' || raw.hash.length === 0) throw corrupt(`idempotency[${i}].hash 必须是非空 string`);
      if (raw.response === null || typeof raw.response !== 'object' || raw.response.ok !== true) throw corrupt(`idempotency[${i}].response.ok 必须是 true`);
      table.entries.set(raw.requestId, { hash: raw.hash, response: raw.response });
    }
    return table;
  }

  lookup(requestId, hash) {
    const hit = this.entries.get(requestId);
    if (hit === undefined) return { kind: 'miss' };
    if (hit.hash !== hash) throw new RequestMismatchError();
    return { kind: 'replay', response: hit.response };
  }

  record(requestId, hash, response) {
    this.entries.delete(requestId);
    this.entries.set(requestId, { hash, response });
    while (this.entries.size > IDEMPOTENCY_CAPACITY) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  toJSON() {
    return [...this.entries.entries()].map(([requestId, v]) => ({ requestId, hash: v.hash, response: v.response }));
  }
}

/**
 * 打开一个 store：文件不存在 → seed() 初始化落盘；存在 → validate 深校验后返回内存态。
 * 每次命令前调用 reload()（重读盘）；命令完成调用 save()（原子落盘）。
 */
export function openStore({ dataDir, fileName, schema, seed, validate }) {
  const file = storePath(dataDir, fileName);
  const corrupt = (detail) => new StoreCorruptError(`${fileName}: ${detail}`);

  function parse(parsed) {
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw corrupt('顶层必须是 JSON 对象');
    if (parsed.schema !== schema) throw corrupt(`schema 必须是 ${schema}，收到 ${JSON.stringify(parsed.schema)}`);
    const state = validate(parsed, corrupt);
    state.idempotency = IdempotencyTable.fromJSON(parsed.idempotency, corrupt);
    return state;
  }

  function reload() {
    if (!existsSync(file)) {
      const seeded = seed();
      const state = validate({ ...seeded, schema }, corrupt);
      state.idempotency = new IdempotencyTable();
      save(state);
      return state;
    }
    return parse(readFileRaw(file));
  }

  function save(state) {
    const stored = { ...state, schema, idempotency: state.idempotency.toJSON() };
    writeFileAtomic(file, `${JSON.stringify(stored, null, 2)}\n`);
  }

  return { file, reload, save };
}

/** 非负整数校验（版本/计数）。 */
export function reqVersion(value, label) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    const err = new Error(`${label} 必须是非负整数`);
    err.name = 'InvalidInput';
    err.code = 'INVALID_INPUT';
    throw err;
  }
  return value;
}

export function invalid(message) {
  const err = new Error(message);
  err.name = 'InvalidInput';
  err.code = 'INVALID_INPUT';
  throw err;
}

export function notFound(message) {
  const err = new Error(message);
  err.name = 'NotFound';
  err.code = 'NOT_FOUND';
  throw err;
}

export function forbidden(message) {
  const err = new Error(message);
  err.name = 'Forbidden';
  err.code = 'ROLE_FORBIDDEN';
  throw err;
}

export function conflict(code, message, serverVersion) {
  const err = new Error(message);
  err.name = 'Conflict';
  err.code = code;
  if (serverVersion !== undefined) err.serverVersion = serverVersion;
  throw err;
}
