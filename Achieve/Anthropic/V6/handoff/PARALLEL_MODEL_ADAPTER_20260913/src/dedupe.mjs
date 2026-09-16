// 实例内请求注册表:同 requestId 相同载荷去重、变载荷冲突。
// 范围声明(写入契约):这里只是**本适配器实例、本进程内存内**的去重;
// 持久化幂等与跨进程恰好一次由主业务层负责持久记录,本模块不保证。
import { createHash } from 'node:crypto';

/** 稳定序列化:对象键递归排序,数组保序;用于载荷哈希。 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function payloadHash(payload) {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

/** 确定性结果才缓存:unknown/failed-after-send/cancelled 可被业务层人工重试,不缓存。 */
const CACHED_STATUSES = new Set(['succeeded', 'simulated', 'stale', 'failed']);

export class RequestRegistry {
  constructor({ maxEntries = 512 } = {}) {
    this.maxEntries = maxEntries;
    // requestId -> { payloadHash, result?|null, inFlight?:Promise }
    this.map = new Map();
  }

  /**
   * 返回:
   *  - { kind:'mismatch', registeredHash }          同ID不同载荷 → 调用方必须拒绝
   *  - { kind:'cache-hit', result, payloadHash }    同ID同载荷且确定性结果已缓存
   *  - { kind:'in-flight', promise, payloadHash }   同ID同载荷,共享在飞调用
   *  - { kind:'register', payloadHash }             新请求;调用方拿到 promise 后须调用 track()
   */
  lookup(requestId, hash) {
    const existing = this.map.get(requestId);
    if (!existing) return { kind: 'register', payloadHash: hash };
    if (existing.payloadHash !== hash) return { kind: 'mismatch', registeredHash: existing.payloadHash, payloadHash: hash };
    if (existing.inFlight) return { kind: 'in-flight', promise: existing.inFlight, payloadHash: hash };
    if (existing.result && CACHED_STATUSES.has(existing.result.status)) {
      return { kind: 'cache-hit', result: existing.result, payloadHash: hash };
    }
    // 非确定性结果(unknown/取消/送出后失败)不缓存:同ID同载荷允许业务层人工重试
    return { kind: 'register', payloadHash: hash };
  }

  track(requestId, payloadHash, promise) {
    this.#evictIfNeeded();
    const entry = { payloadHash, result: null, inFlight: promise };
    this.map.set(requestId, entry);
    return promise
      .then((result) => {
        if (CACHED_STATUSES.has(result.status)) entry.result = result;
        entry.inFlight = null;
        return result;
      })
      .then(null, () => {
        // analyze 内部已把异常折叠为 failed 结果,不会走到这里;防御兜底
        entry.inFlight = null;
      });
  }

  #evictIfNeeded() {
    while (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }
}

export function cloneResult(result) {
  return JSON.parse(JSON.stringify(result));
}
