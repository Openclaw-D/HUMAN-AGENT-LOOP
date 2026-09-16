// 独立成本账本(内存实现,接口与持久化实现等价)。
// 关键不变量(任务书第6条):
// - 外部调用可能已发生(unknown/stale/failed-after-send/succeeded)时:usage 存在则结算,
//   usage 缺失则进入 unknown_hold——绝不记 0、绝不释放预留。
// - 只有"确定未发生外部调用"(取消于送出前/暂停拒绝/transport 证明未发送)才允许 release。
// - unknown_hold 不允许直接 release(未知不能当未发生);业务层对账后只能走 commit 补结算。
// - 预算上限约束 reserved + committed + unknown_hold 的总占用,并发预留同样受控。
import { RESERVATION_STATE } from './codes.mjs';

export function createMemoryLedger({ maxReservedTokens = Number.POSITIVE_INFINITY, label = 'memory' } = {}) {
  let seq = 0;
  const entries = new Map(); // reservationId -> entry

  function occupiedTokens() {
    let sum = 0;
    for (const e of entries.values()) {
      if (e.state === RESERVATION_STATE.RESERVED || e.state === RESERVATION_STATE.UNKNOWN_HOLD) {
        sum += e.estimateTokens;
      } else if (e.state === RESERVATION_STATE.COMMITTED) {
        sum += e.usageTokens;
      }
    }
    return sum;
  }

  function snapshotEntry(e) {
    return Object.freeze({ ...e });
  }

  return {
    kind: 'memory-ledger',
    label,
    maxReservedTokens,

    /** 预留;失败返回 { ok:false, code:'BUDGET_EXCEEDED' },绝不部分预留。 */
    reserve({ requestId, role, purpose, estimateTokens }) {
      if (!Number.isInteger(estimateTokens) || estimateTokens < 0) {
        throw new TypeError('estimateTokens 必须是非负整数');
      }
      if (occupiedTokens() + estimateTokens > maxReservedTokens) {
        const rejected = {
          id: `rej-${++seq}`,
          requestId,
          role,
          purpose,
          estimateTokens,
          state: RESERVATION_STATE.REJECTED,
          reason: 'BUDGET_EXCEEDED',
          usageTokens: null,
          createdAt: null,
        };
        entries.set(rejected.id, rejected);
        return { ok: false, code: 'BUDGET_EXCEEDED', reservationId: rejected.id, occupiedTokens: occupiedTokens(), maxReservedTokens };
      }
      const entry = {
        id: `res-${++seq}`,
        requestId,
        role,
        purpose,
        estimateTokens,
        usageTokens: null,
        state: RESERVATION_STATE.RESERVED,
        reason: null,
        createdAt: null, // 由调用方时钟注入,账本自身不取系统时间,保持可测
      };
      entries.set(entry.id, entry);
      return { ok: true, reservationId: entry.id, estimateTokens };
    },

    /** 按实际 usage 结算。committed 之后不可再迁移(冲销是业务层账务流程,不在本模块)。 */
    commit({ reservationId, usageTokens, note = null }) {
      const e = entries.get(reservationId);
      if (!e) return { ok: false, code: 'RESERVATION_NOT_FOUND' };
      if (e.state !== RESERVATION_STATE.RESERVED && e.state !== RESERVATION_STATE.UNKNOWN_HOLD) {
        return { ok: false, code: 'INVALID_TRANSITION', from: e.state };
      }
      if (!Number.isInteger(usageTokens) || usageTokens < 0) {
        return { ok: false, code: 'INVALID_USAGE' };
      }
      e.state = RESERVATION_STATE.COMMITTED;
      e.usageTokens = usageTokens;
      e.settleNote = note;
      return { ok: true, reservationId, state: e.state, usageTokens };
    },

    /** 外部调用可能已发生但 usage 未知:保留预留。 */
    holdUnknown({ reservationId, note = null }) {
      const e = entries.get(reservationId);
      if (!e) return { ok: false, code: 'RESERVATION_NOT_FOUND' };
      if (e.state !== RESERVATION_STATE.RESERVED) {
        return { ok: false, code: 'INVALID_TRANSITION', from: e.state };
      }
      e.state = RESERVATION_STATE.UNKNOWN_HOLD;
      e.settleNote = note;
      return { ok: true, reservationId, state: e.state };
    },

    /** 仅限确定未发生外部调用。对 committed/unknown_hold 拒绝(缺 usage 不得释放)。 */
    release({ reservationId, note = null }) {
      const e = entries.get(reservationId);
      if (!e) return { ok: false, code: 'RESERVATION_NOT_FOUND' };
      if (e.state !== RESERVATION_STATE.RESERVED) {
        return { ok: false, code: 'INVALID_TRANSITION', from: e.state };
      }
      e.state = RESERVATION_STATE.RELEASED;
      e.settleNote = note;
      return { ok: true, reservationId, state: e.state };
    },

    totals() {
      const t = {
        reservedTokens: 0,
        committedTokens: 0,
        unknownHoldTokens: 0,
        releasedTokens: 0,
        rejectedCount: 0,
        occupiedTokens: 0,
        maxReservedTokens,
      };
      for (const e of entries.values()) {
        if (e.state === RESERVATION_STATE.RESERVED) t.reservedTokens += e.estimateTokens;
        else if (e.state === RESERVATION_STATE.COMMITTED) t.committedTokens += e.usageTokens;
        else if (e.state === RESERVATION_STATE.UNKNOWN_HOLD) t.unknownHoldTokens += e.estimateTokens;
        else if (e.state === RESERVATION_STATE.RELEASED) t.releasedTokens += e.estimateTokens;
        else if (e.state === RESERVATION_STATE.REJECTED) t.rejectedCount += 1;
      }
      t.occupiedTokens = t.reservedTokens + t.committedTokens + t.unknownHoldTokens;
      return t;
    },

    entries() {
      return [...entries.values()].map(snapshotEntry);
    },

    get(reservationId) {
      const e = entries.get(reservationId);
      return e ? snapshotEntry(e) : null;
    },
  };
}
