// 实例内请求注册表:同 requestId 相同载荷去重、变载荷冲突。
// 范围声明(写入契约):这里只是**本适配器实例、本进程内存内**的去重;
// 持久化幂等与跨进程恰好一次由主业务层负责持久记录,本模块不保证。
//
// R2 容量策略(修复 R1"容量满时无条件淘汰最老条目、连在途也删"的缺陷):
//  - 条目三分类:in-flight(promise 未 settle)/ cached(settled 且确定性结果已缓存)/
//    uncached(settled 且非确定性,仅保留载荷指纹)。
//  - 淘汰只允许:cached 最老优先,其次 uncached 最老优先;in-flight 任何情况不得淘汰。
//  - 容量满且无可安全淘汰条目(全是 in-flight)→ lookup/track 返回
//    { kind:'capacity', payloadHash } 明确背压:不静默淘汰、不挂起、不抛异常。
import { createHash } from 'node:crypto';
import { DETERMINISTIC_ERROR_CODES } from './codes.mjs';

/** 稳定序列化:对象键递归排序,数组保序;用于载荷哈希。 */
export function canonicalJson(value) {
  // JSON.stringify(undefined) 返回 undefined(非字符串):包一层稳定占位,保证 payloadHash 永不崩。
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') {
    const s = JSON.stringify(value);
    // 函数/symbol 同样会让 JSON.stringify 返回 undefined:降级为稳定类型占位,不抛错。
    return s === undefined ? `"${typeof value}"` : s;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function payloadHash(payload) {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

/**
 * 确定性结果才缓存;succeeded/simulated/stale 恒缓存;
 * failed 按错误码细分(审计裁决):校验类确定性失败缓存,送出后失败/背压/预算拒绝
 * 属非确定性——业务层人工核实后同ID同载荷重试可能成功,不得缓存挡路。
 */
const DETERMINISTIC = new Set(DETERMINISTIC_ERROR_CODES);

function isDeterministicResult(result) {
  if (!result || typeof result.status !== 'string') return false;
  if (result.status === 'succeeded' || result.status === 'simulated' || result.status === 'stale') return true;
  if (result.status === 'failed') {
    return Boolean(result.error && DETERMINISTIC.has(result.error.code));
  }
  return false;
}

export class RequestRegistry {
  constructor({ maxEntries = 512 } = {}) {
    this.maxEntries = maxEntries;
    // requestId -> { payloadHash, result|null, inFlight:Promise|null, cached:boolean, seq:number }
    // cached=true 表示 settled 且确定性结果已缓存(result 非 null);
    // cached=false 且 inFlight=null 表示 settled 非确定性(仅指纹,uncached)。
    // seq 为条目创建序号(单调递增),"最老"即 seq 最小;uncached 同ID重试复用条目时 seq 保留。
    this.map = new Map();
    this.#nextSeq = 1;
  }

  #nextSeq;

  /**
   * 返回值枚举(消费方按此分发,冻结于 INTERFACE_R2 §1):
   *  - { kind:'register', payloadHash }                  新请求(含 settled-uncached 的同ID同载荷重试:复用既有条目,不新增,指纹保留);调用方拿到 promise 后须调用 track()
   *  - { kind:'mismatch', registeredHash, payloadHash }  同ID不同载荷 → 调用方必须拒绝
   *  - { kind:'cache-hit', result, payloadHash }         同ID同载荷且确定性结果已缓存
   *  - { kind:'in-flight', promise, payloadHash }        同ID同载荷,共享在飞调用
   *  - { kind:'capacity', payloadHash }                  容量满且无可安全淘汰条目 → 明确背压(不新增条目)
   */
  lookup(requestId, hash) {
    const existing = this.map.get(requestId);
    if (!existing) {
      // 新 ID 才需要插入槽位:只读判定——存在可安全淘汰条目则可注册,否则背压;
      // 实际淘汰推迟到 track() 执行,lookup 本身不产生任何副作用。
      if (this.map.size >= this.maxEntries && !this.#hasEvictable()) {
        return { kind: 'capacity', payloadHash: hash };
      }
      return { kind: 'register', payloadHash: hash };
    }
    if (existing.payloadHash !== hash) return { kind: 'mismatch', registeredHash: existing.payloadHash, payloadHash: hash };
    if (existing.inFlight) return { kind: 'in-flight', promise: existing.inFlight, payloadHash: hash };
    if (existing.cached && existing.result && isDeterministicResult(existing.result)) {
      return { kind: 'cache-hit', result: existing.result, payloadHash: hash };
    }
    // 非确定性结果(unknown/取消/送出后失败)不缓存:同ID同载荷允许业务层人工重试,
    // 仍返回 register 并复用既有条目(不新增、指纹与 seq 保留)。
    return { kind: 'register', payloadHash: hash };
  }

  /**
   * 登记一次执行(调用方先 lookup 得到 'register' 再调用本方法)。
   * 返回:
   *  - { kind:'registered', payloadHash, promise }  已登记(新条目或复用 uncached 条目)
   *  - { kind:'mismatch', registeredHash, payloadHash }  防御:与既有条目指纹不一致时失败关闭,不覆写指纹
   *  - { kind:'capacity', payloadHash }             容量满且无可安全淘汰条目 → 明确背压,不新增、不挂起
   */
  track(requestId, payloadHash, promise) {
    const existing = this.map.get(requestId);
    if (existing) {
      // 同ID重注册:只允许指纹一致(uncached 重试复用既有条目);不一致属调用方违约,失败关闭。
      if (existing.payloadHash !== payloadHash) {
        return { kind: 'mismatch', registeredHash: existing.payloadHash, payloadHash };
      }
      existing.result = null;
      existing.cached = false;
      existing.inFlight = promise;
      this.#watch(existing, promise);
      return { kind: 'registered', payloadHash, promise };
    }
    if (this.map.size >= this.maxEntries && !this.#makeInsertSlot()) {
      return { kind: 'capacity', payloadHash };
    }
    const entry = { payloadHash, result: null, inFlight: promise, cached: false, seq: this.#nextSeq++ };
    this.map.set(requestId, entry);
    this.#watch(entry, promise);
    return { kind: 'registered', payloadHash, promise };
  }

  /** settle 后更新条目分类:确定性 → cached;非确定性/异常 → uncached(仅指纹)。 */
  #watch(entry, promise) {
    return promise
      .then((result) => {
        // 条目可能已被同ID重注册接管:此时迟到者不得改写条目状态。
        if (entry.inFlight !== promise) return result;
        if (isDeterministicResult(result)) {
          entry.result = result;
          entry.cached = true;
        } else {
          entry.result = null;
          entry.cached = false;
        }
        entry.inFlight = null;
        return result;
      })
      .then(null, () => {
        if (entry.inFlight !== promise) return;
        // analyze 内部已把异常折叠为 failed 结果,不会走到这里;防御兜底 → uncached(仅指纹)
        entry.result = null;
        entry.cached = false;
        entry.inFlight = null;
      });
  }

  /** 只读判定:是否存在可安全淘汰条目(cached/uncached);in-flight 不算。 */
  #hasEvictable() {
    for (const entry of this.map.values()) {
      if (this.#evictionKey(entry) !== null) return true;
    }
    return false;
  }

  /** 腾出插入槽位;返回 false 表示容量满且只剩 in-flight(不可淘汰)→ 调用方必须背压。 */
  #makeInsertSlot() {
    while (this.map.size >= this.maxEntries) {
      const victimId = this.#selectEvictionCandidate();
      if (victimId === null) return false; // 全部在途:不静默淘汰、不挂起,交由调用方明确背压
      this.map.delete(victimId);
    }
    return true;
  }

  // 淘汰候选选择:遍历全部条目,按"类别优先(cached 先于 uncached),同类最老(seq 最小)"
  // 选出唯一受害者;无可淘汰条目返回 null(全部在途,不可动)。
  #selectEvictionCandidate() {
    let victimId = null;
    let victimKey = null;
    for (const [id, entry] of this.map) {
      // 判定表达式:候选资格与优先级键;in-flight 键为 null → 任何情况不得入选。
      // MUTATION-ANCHOR:EVICTION-SELECT
      const key = this.#evictionKey(entry);
      if (key === null) continue; // 在途条目任何情况不得淘汰
      if (victimKey === null || key.cat < victimKey.cat || (key.cat === victimKey.cat && key.seq < victimKey.seq)) {
        victimId = id;
        victimKey = key;
      }
    }
    return victimId;
  }

  /** 淘汰优先级键:cached=0、uncached=1,age 取条目 seq;in-flight 返回 null(不可淘汰)。 */
  #evictionKey(entry) {
    if (entry.inFlight) return null;
    return { cat: entry.cached && entry.result ? 0 : 1, seq: entry.seq };
  }
}

export function cloneResult(result) {
  return JSON.parse(JSON.stringify(result));
}
