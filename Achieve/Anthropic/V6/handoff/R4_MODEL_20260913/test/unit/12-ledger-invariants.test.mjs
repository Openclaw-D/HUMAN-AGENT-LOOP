// 成本账本不变量验证(任务 A / Agent-LEDGER,零新增依赖)。
// 目标:用固定 seed 的并发混合压力测试证明 R1 账本(src/ledger.mjs)的不变量,
// 重点覆盖 R2 验收指标:"未知费用释放 0"在并发混合场景下成立,
// 且对每种(操作 × 发起时状态)组合核对调用计数与保留状态,不只测结果字符串。
//
// 确定性:自实现 32 位 LCG(seed 显式),不使用无种子 Math.random / Date.now;
// 同 seed 重跑操作序列与结果逐位一致(有专门测试断言)。
//
// 并发模型说明:账本是单线程同步内存实现(方法内无 await),操作不可被打断,
// "并发混合"因此等价于任意交错的操作序列;固定 seed 保证交错序列可复现。
// 自测命令:node --test test/unit/12-ledger-invariants.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryLedger } from '../../src/ledger.mjs';
import { RESERVATION_STATE } from '../../src/codes.mjs';

// ---------------- §1 确定性随机源 ----------------
// Numerical Recipes 参数的 32 位 LCG:state = (state * 1664525 + 1013904223) mod 2^32
function createLcg(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000; // 均匀 [0,1)
  };
}
function nextInt(rng, maxExclusive) {
  return Math.floor(rng() * maxExclusive);
}

// ---------------- §2 影子账本:独立于实现的期望模型 ----------------
// 只按"应当成立的语义"记账;每步与实现互核,一旦实现偏离语义即失配。
function createShadowLedger() {
  const entries = new Map(); // reservationId -> { state, estimateTokens, usageTokens, history[] }
  function occupiedOf(e) {
    if (e.state === RESERVATION_STATE.RESERVED || e.state === RESERVATION_STATE.UNKNOWN_HOLD) {
      return e.estimateTokens;
    }
    if (e.state === RESERVATION_STATE.COMMITTED) return e.usageTokens;
    return 0; // released / rejected 从不占用
  }
  return {
    entries,
    get: (id) => entries.get(id) || null,
    add(id, estimateTokens) {
      entries.set(id, {
        state: RESERVATION_STATE.RESERVED,
        estimateTokens,
        usageTokens: null,
        history: [RESERVATION_STATE.RESERVED],
      });
    },
    addRejected(id, estimateTokens) {
      entries.set(id, {
        state: RESERVATION_STATE.REJECTED,
        estimateTokens,
        usageTokens: null,
        history: [RESERVATION_STATE.REJECTED],
      });
    },
    commit(id, usageTokens) {
      const e = entries.get(id);
      e.state = RESERVATION_STATE.COMMITTED;
      e.usageTokens = usageTokens;
      e.history.push(RESERVATION_STATE.COMMITTED);
    },
    holdUnknown(id) {
      const e = entries.get(id);
      e.state = RESERVATION_STATE.UNKNOWN_HOLD;
      e.history.push(RESERVATION_STATE.UNKNOWN_HOLD);
    },
    release(id) {
      const e = entries.get(id);
      e.state = RESERVATION_STATE.RELEASED;
      e.history.push(RESERVATION_STATE.RELEASED);
    },
    occupied() {
      let s = 0;
      for (const e of entries.values()) s += occupiedOf(e);
      return s;
    },
    // 与 ledger.totals() 同形的期望值,但来源是影子账本自己的推演
    expectedTotals(maxReservedTokens) {
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
  };
}

// 状态机单向性:条目生命周期只允许这些迁移链(历史链必须整体合法)。
// rejected 是独立分支:从未占用,也不得再迁移到任何其他状态。
const LEGAL_HISTORIES = new Set([
  RESERVATION_STATE.REJECTED,
  RESERVATION_STATE.RESERVED,
  `${RESERVATION_STATE.RESERVED}>${RESERVATION_STATE.RELEASED}`,
  `${RESERVATION_STATE.RESERVED}>${RESERVATION_STATE.COMMITTED}`,
  `${RESERVATION_STATE.RESERVED}>${RESERVATION_STATE.UNKNOWN_HOLD}`,
  `${RESERVATION_STATE.RESERVED}>${RESERVATION_STATE.UNKNOWN_HOLD}>${RESERVATION_STATE.COMMITTED}`,
]);
function assertLegalHistories(shadow, ctxLabel) {
  for (const [id, e] of shadow.entries) {
    const chain = e.history.join('>');
    assert.ok(
      LEGAL_HISTORIES.has(chain),
      `${ctxLabel}: 条目 ${id} 出现非法迁移链 ${chain}(状态机必须单向)`
    );
  }
}

// ---------------- §3 逐步全量不变量核对 ----------------
// 每一步都用 totals()/entries()/get() 查实现内部的保留状态,与影子账本逐字段比对。
function verifyLedgerInvariants(ledger, shadow, ctxLabel) {
  const max = ledger.maxReservedTokens;
  const t = ledger.totals();
  const want = shadow.expectedTotals(max);
  // 不变量 A:totals 七项与影子账本逐字段一致
  assert.equal(t.reservedTokens, want.reservedTokens, `${ctxLabel}: reservedTokens 与影子账本不一致`);
  assert.equal(t.committedTokens, want.committedTokens, `${ctxLabel}: committedTokens 与影子账本不一致`);
  assert.equal(t.unknownHoldTokens, want.unknownHoldTokens, `${ctxLabel}: unknownHoldTokens 与影子账本不一致`);
  assert.equal(t.releasedTokens, want.releasedTokens, `${ctxLabel}: releasedTokens 与影子账本不一致`);
  assert.equal(t.rejectedCount, want.rejectedCount, `${ctxLabel}: rejectedCount 与影子账本不一致`);
  // 不变量 B:occupiedTokens 恒等式(查状态算出来的占用,不是回执转述)
  assert.equal(
    t.occupiedTokens,
    t.reservedTokens + t.committedTokens + t.unknownHoldTokens,
    `${ctxLabel}: occupiedTokens ≠ reserved + committed + unknownHold`
  );
  assert.equal(t.occupiedTokens, want.occupiedTokens, `${ctxLabel}: occupiedTokens 与影子账本不一致`);
  // 不变量 C:预留闸门从未放行超限。
  // 语义边界:commit 按供应商实际 usage 如实结算,实际用量可以超出 estimate(结算发生在调用之后,
  // 账本只能记录真相、不能拒绝现实),因此 occupied 本身允许瞬时超过上限;
  // 但超出部分必须完全由"committed usage 超出该条目 estimate 的差额"解释——
  // 即"按 estimate 计量的占用"(reserved + unknownHold + Σ committed 的 min(usage, estimate))永不突破上限。
  let settleOverage = 0;
  for (const e of shadow.entries.values()) {
    if (e.state === RESERVATION_STATE.COMMITTED && e.usageTokens > e.estimateTokens) {
      settleOverage += e.usageTokens - e.estimateTokens;
    }
  }
  assert.ok(
    t.occupiedTokens - settleOverage <= max,
    `${ctxLabel}: 按 estimate 计量的占用 ${t.occupiedTokens - settleOverage} 突破上限 ${max}(结算超出 ${settleOverage} 不能解释全部越限)`
  );
  // 逐条目核对:实现的每条记录与影子模型一致
  const live = ledger.entries();
  assert.equal(live.length, shadow.entries.size, `${ctxLabel}: 条目总数不一致`);
  for (const e of live) {
    const s = shadow.get(e.id);
    assert.ok(s, `${ctxLabel}: 影子账本缺少实现条目 ${e.id}`);
    assert.equal(e.state, s.state, `${ctxLabel}: 条目 ${e.id} 状态 实现=${e.state} 影子=${s.state}`);
    assert.equal(e.estimateTokens, s.estimateTokens, `${ctxLabel}: 条目 ${e.id} estimateTokens 不一致`);
    assert.equal(e.usageTokens, s.usageTokens, `${ctxLabel}: 条目 ${e.id} usageTokens 不一致`);
    // 不变量 D(核心):released 条目此前绝不能经过 committed / unknown_hold——"未知费用释放 0"
    if (e.state === RESERVATION_STATE.RELEASED) {
      const polluted =
        s.history.includes(RESERVATION_STATE.COMMITTED) ||
        s.history.includes(RESERVATION_STATE.UNKNOWN_HOLD);
      assert.ok(
        !polluted,
        `${ctxLabel}: released 条目 ${e.id} 历史为 ${s.history.join('→')},曾 commit/holdUnknown 却被释放`
      );
    }
    // rejected 条目必须携带 BUDGET_EXCEEDED 审计原因,且从未占用(不在任何 token 桶里)
    if (e.state === RESERVATION_STATE.REJECTED) {
      assert.equal(e.reason, 'BUDGET_EXCEEDED', `${ctxLabel}: 被拒条目 ${e.id} 缺少 BUDGET_EXCEEDED 原因`);
    }
  }
  return t;
}

// ---------------- §4 固定 seed 压力执行器 ----------------
// 操作空间:reserve(随机 requestId/estimate)、commit、holdUnknown、release、totals()。
// 每步操作后无条件做 §3 的全量核对;组合计数表记录 (操作 × 发起时影子状态) 的尝试/成功次数。
function runStress({ seed, steps, maxReservedTokens }) {
  const rng = createLcg(seed);
  const ledger = createMemoryLedger({ maxReservedTokens });
  const shadow = createShadowLedger();
  const trace = []; // 逐步操作与结果的确定性记录(用于同 seed 重跑逐位比对)
  const knownIds = []; // 出现过的全部 reservationId(含 rejected:对它操作必须被拒)
  const stats = {
    seed,
    steps,
    maxReservedTokens,
    reserveAttempts: 0,
    reserveSuccess: 0,
    reserveRejected: 0,
    commitAttempts: 0,
    holdUnknownAttempts: 0,
    releaseAttempts: 0,
    totalsOpCalls: 0,
    notFoundResponses: 0,
    invalidTransitionResponses: 0,
    // 关键组合计数:每种 (操作 × 来源状态) 都查调用计数,不只看结果字符串
    combo: {
      commit: { from: Object.create(null), ok: Object.create(null) },
      holdUnknown: { from: Object.create(null), ok: Object.create(null) },
      release: { from: Object.create(null), ok: Object.create(null) },
    },
  };
  const bump = (m, k) => {
    m[k] = (m[k] || 0) + 1;
  };
  const keyOf = (id) => {
    const s = shadow.get(id);
    return s ? s.state : 'not_found';
  };
  // 按状态取目标池(覆盖导向选目标用)
  const idsInState = (state) => {
    const out = [];
    for (const [id, e] of shadow.entries) {
      if (e.state === state) out.push(id);
    }
    return out;
  };
  const pickFrom = (pool) => (pool.length ? pool[nextInt(rng, pool.length)] : knownIds[nextInt(rng, knownIds.length)]);
  const pickReserved = () => pickFrom(idsInState(RESERVATION_STATE.RESERVED));
  const pickUnknownHold = () => pickFrom(idsInState(RESERVATION_STATE.UNKNOWN_HOLD));
  // 覆盖导向目标选择:核心负向组合(unknown_hold/committed 上的 release 等)必须有确定性分母;
  // 合法迁移以 reserved 池为目标(维持周转:释放/结算腾出额度,后续 reserve 才能继续成功)。
  const pickTarget = (kind, step) => {
    if (rng() < 0.15) return `ghost-${seed}-${step}`; // 不存在的 id:RESERVATION_NOT_FOUND 组合
    const aim = rng();
    if (kind === 'commit') {
      if (aim < 0.45) return pickReserved(); // reserved → 合法 commit(正常结算)
      if (aim < 0.55) return pickUnknownHold(); // unknown_hold → 合法 commit(对账补录)
      if (aim < 0.67) return pickFrom(idsInState(RESERVATION_STATE.COMMITTED)); // 须拒
      if (aim < 0.75) return pickFrom(idsInState(RESERVATION_STATE.RELEASED)); // 须拒
      return pickFrom(idsInState(RESERVATION_STATE.REJECTED)); // 须拒
    }
    if (kind === 'holdUnknown') {
      if (aim < 0.47) return pickReserved(); // reserved → 合法 holdUnknown
      if (aim < 0.59) return pickFrom(idsInState(RESERVATION_STATE.UNKNOWN_HOLD)); // 须拒
      if (aim < 0.71) return pickFrom(idsInState(RESERVATION_STATE.COMMITTED)); // 须拒
      if (aim < 0.85) return pickFrom(idsInState(RESERVATION_STATE.RELEASED)); // 须拒
      return pickFrom(idsInState(RESERVATION_STATE.REJECTED)); // 须拒
    }
    // release:核心负向组合(unknown_hold/committed)保持高权重,同时以 reserved 为主维持成功分母
    if (aim < 0.45) return pickReserved(); // reserved → 合法 release
    if (aim < 0.6) return pickUnknownHold(); // 须拒:未知费用释放
    if (aim < 0.72) return pickFrom(idsInState(RESERVATION_STATE.COMMITTED)); // 须拒:已结算释放
    if (aim < 0.86) return pickFrom(idsInState(RESERVATION_STATE.REJECTED)); // 须拒
    return pickFrom(idsInState(RESERVATION_STATE.RELEASED)); // 须拒
  };

  for (let step = 1; step <= steps; step++) {
    const roll = rng();
    let kind;
    if (knownIds.length === 0) kind = 'reserve'; // 前置:没有可操作条目时先 reserve
    else if (roll < 0.38) kind = 'reserve';
    else if (roll < 0.56) kind = 'commit';
    else if (roll < 0.7) kind = 'holdUnknown';
    else if (roll < 0.92) kind = 'release';
    else kind = 'totals';
    const rec = { s: step, op: kind };

    if (kind === 'reserve') {
      stats.reserveAttempts += 1;
      const estimate = nextInt(rng, 21) * 10; // 0..200,步长 10(含 0:零预留合法);相对上限 6000 留足并发槽位与全程结算量空间,避免永久饱和死锁
      const requestId = `rq-${nextInt(rng, 0x10000).toString(16)}-${step}`;
      const pre = shadow.occupied();
      const predictedOk = pre + estimate <= maxReservedTokens;
      const r = ledger.reserve({ requestId, role: 'credit', purpose: 'risk_review', estimateTokens: estimate });
      rec.est = estimate;
      rec.ok = r.ok === true;
      if (predictedOk) {
        assert.equal(r.ok, true, `step ${step}: 影子预测可预留(占用 ${pre}+${estimate} ≤ ${maxReservedTokens})但实现拒绝:${JSON.stringify(r)}`);
        stats.reserveSuccess += 1;
        assert.equal(r.estimateTokens, estimate, `step ${step}: 成功预留回执的 estimateTokens 不一致`);
        shadow.add(r.reservationId, estimate);
        knownIds.push(r.reservationId);
        rec.id = r.reservationId;
      } else {
        assert.equal(r.ok, false, `step ${step}: 影子预测超限(占用 ${pre}+${estimate} > ${maxReservedTokens})但实现允许预留`);
        assert.equal(r.code, 'BUDGET_EXCEEDED', `step ${step}: 超限预留必须返回 BUDGET_EXCEEDED`);
        stats.reserveRejected += 1;
        // 不变量:BUDGET_EXCEEDED 的请求从不动用预算——拒绝回执里的占用等于预占用
        assert.equal(r.occupiedTokens, pre, `step ${step}: 拒绝回执 occupiedTokens(${r.occupiedTokens})≠ 预占用 ${pre},被拒请求动用了预算`);
        assert.equal(r.maxReservedTokens, maxReservedTokens, `step ${step}: 拒绝回执缺少 maxReservedTokens 审计字段`);
        shadow.addRejected(r.reservationId, estimate);
        knownIds.push(r.reservationId);
        rec.id = r.reservationId;
        rec.code = r.code;
      }
    } else {
      // 目标选择:覆盖导向(核心负向组合必有分母,合法迁移保持充足分母)
      const id = pickTarget(kind, step);
      rec.id = id;
      const fromState = keyOf(id);
      if (kind === 'commit') {
        stats.commitAttempts += 1;
        bump(stats.combo.commit.from, fromState);
        const usage = nextInt(rng, 161); // 0..160;usage=0 是"对账后显式结算为 0",与"缺失记 0"不同,合法
        rec.use = usage;
        const r = ledger.commit({ reservationId: id, usageTokens: usage, note: `step-${step}` });
        if (fromState === 'not_found') {
          assert.equal(r.ok, false, `step ${step}: 不存在的预留竞能 commit:${JSON.stringify(r)}`);
          assert.equal(r.code, 'RESERVATION_NOT_FOUND', `step ${step}: 缺失预留的 commit 必须返回 RESERVATION_NOT_FOUND`);
          stats.notFoundResponses += 1;
        } else if (fromState === RESERVATION_STATE.RESERVED || fromState === RESERVATION_STATE.UNKNOWN_HOLD) {
          assert.equal(r.ok, true, `step ${step}: 从 ${fromState} commit 应成功:${JSON.stringify(r)}`);
          assert.equal(r.state, RESERVATION_STATE.COMMITTED, `step ${step}: commit 回执状态不是 committed`);
          assert.equal(r.usageTokens, usage, `step ${step}: commit 回执 usageTokens 不一致`);
          bump(stats.combo.commit.ok, fromState);
          shadow.commit(id, usage);
        } else {
          assert.equal(r.ok, false, `step ${step}: 从终态/被拒 ${fromState} commit 竟然成功:${JSON.stringify(r)}`);
          assert.equal(r.code, 'INVALID_TRANSITION', `step ${step}: 非法迁移必须返回 INVALID_TRANSITION`);
          assert.equal(r.from, fromState, `step ${step}: INVALID_TRANSITION 的 from(${r.from})≠ 实际状态 ${fromState}`);
          stats.invalidTransitionResponses += 1;
        }
        rec.ok = r.ok === true;
        if (!r.ok) rec.code = r.code;
      } else if (kind === 'holdUnknown') {
        stats.holdUnknownAttempts += 1;
        bump(stats.combo.holdUnknown.from, fromState);
        const r = ledger.holdUnknown({ reservationId: id, note: `step-${step}` });
        if (fromState === 'not_found') {
          assert.equal(r.ok, false, `step ${step}: 不存在的预留竞能 holdUnknown:${JSON.stringify(r)}`);
          assert.equal(r.code, 'RESERVATION_NOT_FOUND', `step ${step}: 缺失预留的 holdUnknown 必须返回 RESERVATION_NOT_FOUND`);
          stats.notFoundResponses += 1;
        } else if (fromState === RESERVATION_STATE.RESERVED) {
          assert.equal(r.ok, true, `step ${step}: 从 reserved holdUnknown 应成功:${JSON.stringify(r)}`);
          assert.equal(r.state, RESERVATION_STATE.UNKNOWN_HOLD, `step ${step}: holdUnknown 回执状态不是 unknown_hold`);
          bump(stats.combo.holdUnknown.ok, fromState);
          shadow.holdUnknown(id);
        } else {
          assert.equal(r.ok, false, `step ${step}: 从 ${fromState} holdUnknown 竟然成功:${JSON.stringify(r)}`);
          assert.equal(r.code, 'INVALID_TRANSITION', `step ${step}: 非法迁移必须返回 INVALID_TRANSITION`);
          assert.equal(r.from, fromState, `step ${step}: INVALID_TRANSITION 的 from(${r.from})≠ 实际状态 ${fromState}`);
          stats.invalidTransitionResponses += 1;
        }
        rec.ok = r.ok === true;
        if (!r.ok) rec.code = r.code;
      } else if (kind === 'release') {
        stats.releaseAttempts += 1;
        bump(stats.combo.release.from, fromState);
        const r = ledger.release({ reservationId: id, note: `step-${step}` });
        if (fromState === 'not_found') {
          assert.equal(r.ok, false, `step ${step}: 不存在的预留竞能 release:${JSON.stringify(r)}`);
          assert.equal(r.code, 'RESERVATION_NOT_FOUND', `step ${step}: 缺失预留的 release 必须返回 RESERVATION_NOT_FOUND`);
          stats.notFoundResponses += 1;
        } else if (fromState === RESERVATION_STATE.RESERVED) {
          assert.equal(r.ok, true, `step ${step}: 从 reserved release 应成功:${JSON.stringify(r)}`);
          assert.equal(r.state, RESERVATION_STATE.RELEASED, `step ${step}: release 回执状态不是 released`);
          bump(stats.combo.release.ok, fromState);
          shadow.release(id);
        } else {
          // 核心负向:committed / unknown_hold / rejected 上的 release 一律必须拒绝
          assert.equal(r.ok, false, `step ${step}: 从 ${fromState} release 竟然成功(未知/已结算/被拒不得释放):${JSON.stringify(r)}`);
          assert.equal(r.code, 'INVALID_TRANSITION', `step ${step}: 非法迁移必须返回 INVALID_TRANSITION`);
          assert.equal(r.from, fromState, `step ${step}: INVALID_TRANSITION 的 from(${r.from})≠ 实际状态 ${fromState}`);
          stats.invalidTransitionResponses += 1;
        }
        rec.ok = r.ok === true;
        if (!r.ok) rec.code = r.code;
      } else {
        stats.totalsOpCalls += 1; // totals 显式调用;全量核对每步都在做,无需额外动作
      }
    }

    // 每步之后无条件全量核对
    const t = verifyLedgerInvariants(ledger, shadow, `step ${step}(${kind})`);
    rec.occ = t.occupiedTokens;
    trace.push(rec);
  }

  // 终局核对:全部条目的历史链必须落在单向状态机的合法集合内
  assertLegalHistories(shadow, `seed=${seed} 终局`);
  return { ledger, shadow, stats, trace, finalTotals: ledger.totals() };
}

// ---------------- §5 统计输出 ----------------
function formatStats(stats) {
  const c = stats.combo;
  const f = (m, k) => m.from[k] || 0;
  const o = (m, k) => m.ok[k] || 0;
  const releaseOnLost = f(c.release, 'unknown_hold') + f(c.release, 'committed');
  return [
    `[12-ledger-invariants] 压力分母(seed=${stats.seed}, ${stats.steps} 步, maxReservedTokens=${stats.maxReservedTokens}):`,
    `  reserve : 尝试 ${stats.reserveAttempts} = 成功 ${stats.reserveSuccess} + BUDGET_EXCEEDED 拒绝 ${stats.reserveRejected}`,
    `  commit  : 尝试 ${stats.commitAttempts};成功/尝试 按来源状态 reserved=${o(c.commit, 'reserved')}/${f(c.commit, 'reserved')} unknown_hold(对账补录)=${o(c.commit, 'unknown_hold')}/${f(c.commit, 'unknown_hold')};须拒 committed=${f(c.commit, 'committed')} released=${f(c.commit, 'released')} rejected=${f(c.commit, 'rejected')} 不存在=${f(c.commit, 'not_found')}`,
    `  holdUnknown: 尝试 ${stats.holdUnknownAttempts};成功/尝试 reserved=${o(c.holdUnknown, 'reserved')}/${f(c.holdUnknown, 'reserved')};须拒 committed=${f(c.holdUnknown, 'committed')} unknown_hold=${f(c.holdUnknown, 'unknown_hold')} released=${f(c.holdUnknown, 'released')} rejected=${f(c.holdUnknown, 'rejected')} 不存在=${f(c.holdUnknown, 'not_found')}`,
    `  release : 尝试 ${stats.releaseAttempts};成功 reserved=${o(c.release, 'reserved')}/${f(c.release, 'reserved')};unknown_hold+committed 上尝试 ${releaseOnLost} 次、成功 0(未知费用释放 0);另须拒 released=${f(c.release, 'released')} rejected=${f(c.release, 'rejected')} 不存在=${f(c.release, 'not_found')}`,
    `  totals 显式调用 ${stats.totalsOpCalls};逐步全量核对 ${stats.steps} 次;RESERVATION_NOT_FOUND ${stats.notFoundResponses};INVALID_TRANSITION ${stats.invalidTransitionResponses}`,
  ].join('\n');
}

// ---------------- §6 测试 ----------------

test('固定 seed 并发混合压力:500 步随机操作序列,逐步校验账本不变量', () => {
  const { stats, finalTotals } = runStress({ seed: 1337, steps: 500, maxReservedTokens: 6000 });

  // 组合级断言(查调用计数与保留状态,不只测结果字符串):
  // 1) release 成功的来源状态必须只有 reserved —— "未知费用释放 0"
  assert.deepEqual(
    Object.keys(stats.combo.release.ok).sort(),
    ['reserved'],
    `release 成功的来源状态必须只有 reserved,实际:${JSON.stringify(stats.combo.release.ok)}`
  );
  // 2) 压力序列必须真正覆盖关键组合(检查有分母、不是退化序列)
  assert.ok(
    (stats.combo.release.from[RESERVATION_STATE.UNKNOWN_HOLD] || 0) >= 5,
    '压力序列未充分覆盖 unknown_hold 上的 release 尝试:核心不变量未被实际测试'
  );
  assert.ok(
    (stats.combo.release.from[RESERVATION_STATE.COMMITTED] || 0) >= 5,
    '压力序列未充分覆盖 committed 上的 release 尝试:核心不变量未被实际测试'
  );
  assert.ok(
    (stats.combo.commit.ok[RESERVATION_STATE.UNKNOWN_HOLD] || 0) >= 1,
    '压力序列未覆盖 unknown_hold → commit 的对账补录路径'
  );
  assert.ok(
    (stats.combo.holdUnknown.from[RESERVATION_STATE.UNKNOWN_HOLD] || 0) >= 1,
    '压力序列未覆盖 unknown_hold 上的 holdUnknown 尝试(须拒)'
  );
  assert.ok((stats.combo.release.from[RESERVATION_STATE.RELEASED] || 0) >= 3, '压力序列未覆盖 released 上的 release 尝试(须拒)');
  assert.ok((stats.combo.release.from.rejected || 0) >= 3, '压力序列未覆盖 rejected 上的 release 尝试(须拒)');
  assert.ok((stats.combo.commit.from[RESERVATION_STATE.COMMITTED] || 0) >= 3, '压力序列未覆盖 committed 上的 commit 尝试(须拒)');
  assert.ok((stats.combo.commit.from[RESERVATION_STATE.RELEASED] || 0) >= 3, '压力序列未覆盖 released 上的 commit 尝试(须拒)');
  assert.ok((stats.combo.commit.from.rejected || 0) >= 3, '压力序列未覆盖 rejected 上的 commit 尝试(须拒)');
  assert.ok((stats.combo.holdUnknown.from[RESERVATION_STATE.COMMITTED] || 0) >= 3, '压力序列未覆盖 committed 上的 holdUnknown 尝试(须拒)');
  assert.ok((stats.combo.holdUnknown.from[RESERVATION_STATE.RELEASED] || 0) >= 3, '压力序列未覆盖 released 上的 holdUnknown 尝试(须拒)');
  // 3) reserve 两个分支都必须出现(预算压力真实存在)
  assert.ok(stats.reserveSuccess >= 1 && stats.reserveRejected >= 1, '压力序列未同时覆盖预留成功与 BUDGET_EXCEEDED');
  // 4) 数量下限(seed=1337 实测值留约四成安全余量):防止未来改动让序列退化成无效压力
  assert.ok(stats.reserveSuccess >= 80, `reserve 成功数 ${stats.reserveSuccess} 过低,压力不达标`);
  assert.ok(stats.reserveRejected >= 30, `BUDGET_EXCEEDED 数 ${stats.reserveRejected} 过低,预算约束未被充分测试`);
  assert.ok(stats.commitAttempts >= 60, `commit 尝试数 ${stats.commitAttempts} 过低`);
  assert.ok(stats.holdUnknownAttempts >= 40, `holdUnknown 尝试数 ${stats.holdUnknownAttempts} 过低`);
  assert.ok(stats.releaseAttempts >= 60, `release 尝试数 ${stats.releaseAttempts} 过低`);
  // 合法迁移的成功分母
  assert.ok((stats.combo.release.ok.reserved || 0) >= 20, `release 合法成功 ${stats.combo.release.ok.reserved} 过低`);
  assert.ok((stats.combo.commit.ok.reserved || 0) >= 15, `commit 正常结算 ${stats.combo.commit.ok.reserved} 过低`);
  assert.ok((stats.combo.holdUnknown.ok.reserved || 0) >= 15, `holdUnknown 合法成功 ${stats.combo.holdUnknown.ok.reserved} 过低`);

  console.log(formatStats(stats));
  console.log(`[12-ledger-invariants] 终态 totals = ${JSON.stringify(finalTotals)}`);
});

test('确定性:同 seed 重跑逐位一致;不同 seed 序列不同', () => {
  const a = runStress({ seed: 1337, steps: 500, maxReservedTokens: 6000 });
  const b = runStress({ seed: 1337, steps: 500, maxReservedTokens: 6000 });
  assert.equal(
    JSON.stringify(a.trace),
    JSON.stringify(b.trace),
    '同 seed 两次运行的逐步 trace 不一致:测试不具备确定性'
  );
  assert.deepEqual(a.stats, b.stats, '同 seed 两次运行的统计不一致');
  assert.deepEqual(a.finalTotals, b.finalTotals, '同 seed 两次运行的终态 totals 不一致');

  const other = runStress({ seed: 20260913, steps: 500, maxReservedTokens: 6000 });
  assert.notEqual(
    JSON.stringify(a.trace),
    JSON.stringify(other.trace),
    '不同 seed 产生了完全相同的操作序列:seed 未真正参与生成'
  );
});

test('交错语义:满足因果约束的全部交错序列下,预算上限与状态机均不破', () => {
  const max = 220;
  // 固定脚本:reserveA/B/C 各预留 80;commitA 按实际 usage=50 结算;releaseB 释放 B 的预留。
  // 因果约束:commitA 必须在 reserveA 之后;releaseB 必须在 reserveB 之后。
  // 枚举全部满足因果约束的交错(线性扩展),预算上限必须在"任意交错"下都不破。
  const ops = ['reserveA', 'reserveB', 'commitA', 'reserveC', 'releaseB'];

  // Heap 算法生成全排列
  function* permutations(arr) {
    const a = [...arr];
    const n = a.length;
    const c = new Array(n).fill(0);
    yield [...a];
    let i = 1;
    while (i < n) {
      if (c[i] < i) {
        const k = i % 2 === 0 ? 0 : c[i];
        [a[i], a[k]] = [a[k], a[i]];
        yield [...a];
        c[i] += 1;
        i = 1;
      } else {
        c[i] = 0;
        i += 1;
      }
    }
  }

  let cases = 0;
  let casesWithRejection = 0;
  for (const perm of permutations(ops)) {
    if (perm.indexOf('commitA') < perm.indexOf('reserveA')) continue;
    if (perm.indexOf('releaseB') < perm.indexOf('reserveB')) continue;
    cases += 1;
    const ledger = createMemoryLedger({ maxReservedTokens: max });
    const shadow = createShadowLedger();
    const ids = Object.create(null);
    let sawRejection = false;
    for (let i = 0; i < perm.length; i++) {
      const op = perm[i];
      const label = `交错[${perm.join('→')}] 第${i + 1}步 ${op}`;
      const pre = shadow.occupied();
      if (op === 'reserveA' || op === 'reserveB' || op === 'reserveC') {
        const r = ledger.reserve({ requestId: op, role: 'credit', purpose: 'risk_review', estimateTokens: 80 });
        const predictedOk = pre + 80 <= max;
        assert.equal(r.ok, predictedOk, `${label}: 预留结果必须由当前占用决定(占用 ${pre}+80 vs ${max})`);
        if (r.ok) {
          ids[op] = r.reservationId;
          shadow.add(r.reservationId, 80);
        } else {
          assert.equal(r.code, 'BUDGET_EXCEEDED', `${label}: 超限必须返回 BUDGET_EXCEEDED`);
          ids[op] = r.reservationId;
          shadow.addRejected(r.reservationId, 80);
          sawRejection = true;
        }
      } else if (op === 'commitA') {
        const r = ledger.commit({ reservationId: ids.reserveA, usageTokens: 50, note: '实际 usage 50' });
        if (shadow.get(ids.reserveA).state === RESERVATION_STATE.RESERVED) {
          assert.equal(r.ok, true, `${label}: reserved → commit 应成功`);
          shadow.commit(ids.reserveA, 50);
        } else {
          // reserveA 被预算拒绝时,后续 commit 必须以 INVALID_TRANSITION(rejected)拒绝
          assert.equal(r.ok, false, `${label}: 对被拒预留 commit 竟然成功`);
          assert.equal(r.code, 'INVALID_TRANSITION', `${label}: 必须返回 INVALID_TRANSITION`);
          assert.equal(r.from, RESERVATION_STATE.REJECTED, `${label}: from 应为 rejected`);
        }
      } else if (op === 'releaseB') {
        const r = ledger.release({ reservationId: ids.reserveB });
        if (shadow.get(ids.reserveB).state === RESERVATION_STATE.RESERVED) {
          assert.equal(r.ok, true, `${label}: reserved → release 应成功`);
          shadow.release(ids.reserveB);
        } else {
          assert.equal(r.ok, false, `${label}: 对被拒预留 release 竟然成功`);
          assert.equal(r.code, 'INVALID_TRANSITION', `${label}: 必须返回 INVALID_TRANSITION`);
          assert.equal(r.from, RESERVATION_STATE.REJECTED, `${label}: from 应为 rejected`);
        }
      }
      // 每步全量核对(该脚本 usage=50 恒小于 estimate=80,无结算超出,严格上限必须成立)
      verifyLedgerInvariants(ledger, shadow, label);
    }
    if (sawRejection) casesWithRejection += 1;
    assertLegalHistories(shadow, `交错[${perm.join('→')}]`);
    // 终态复核:该交错下 released 的条目历史必须纯净(从未 commit/holdUnknown)
    for (const e of ledger.entries()) {
      if (e.state === RESERVATION_STATE.RELEASED) {
        const h = shadow.get(e.id).history;
        assert.ok(
          !h.includes(RESERVATION_STATE.COMMITTED) && !h.includes(RESERVATION_STATE.UNKNOWN_HOLD),
          `交错[${perm.join('→')}: released 条目 ${e.id} 历史 ${h.join('→')} 不纯净`
        );
      }
    }
  }
  // 5 个操作、2 条独立因果约束 → 线性扩展恰 5!/2!/2! = 30 条
  assert.equal(cases, 30, '满足因果约束的交错数应为 30,枚举器有缺陷');
  assert.ok(casesWithRejection >= 1, '没有任何交错触发 BUDGET_EXCEEDED:预算上限根本没被测试到');
});

test('对账补录:unknown_hold → commit 以实际值替换 estimate,totals 随之一致', () => {
  const ledger = createMemoryLedger({ maxReservedTokens: 500 });
  const r = ledger.reserve({ requestId: 'rec-1', role: 'credit', purpose: 'risk_review', estimateTokens: 300 });
  assert.equal(r.ok, true);
  assert.equal(ledger.totals().occupiedTokens, 300, '预留后占用应为 estimate');

  const h = ledger.holdUnknown({ reservationId: r.reservationId, note: '超时,usage 未知' });
  assert.equal(h.ok, true);
  assert.equal(h.state, RESERVATION_STATE.UNKNOWN_HOLD);
  let t = ledger.totals();
  assert.equal(t.unknownHoldTokens, 300, '未知费用必须保留预留(不记 0、不释放)');
  assert.equal(t.occupiedTokens, 300, 'unknown_hold 仍占预算');
  assert.equal(t.releasedTokens, 0, '未知费用绝不能进入 released');

  // 对账补录:实际 usage=42(与 estimate=300 不同),committed 按实际值计占用
  const c = ledger.commit({ reservationId: r.reservationId, usageTokens: 42, note: '对账补录' });
  assert.equal(c.ok, true, 'unknown_hold → commit(对账补录)必须合法');
  assert.equal(c.state, RESERVATION_STATE.COMMITTED);
  t = ledger.totals();
  assert.equal(t.unknownHoldTokens, 0, '补录后 unknown_hold 归零');
  assert.equal(t.committedTokens, 42, 'committed 按实际 usage 计入,而非 estimate');
  assert.equal(t.occupiedTokens, 42, '占用切换为实际值');
  assert.equal(t.occupiedTokens, t.reservedTokens + t.committedTokens + t.unknownHoldTokens);

  // 终态确认:committed 之后 holdUnknown / release 一律拒绝,状态不可逆
  const hu = ledger.holdUnknown({ reservationId: r.reservationId });
  assert.equal(hu.ok, false, 'committed 之后不得 holdUnknown');
  assert.equal(hu.code, 'INVALID_TRANSITION');
  const rel = ledger.release({ reservationId: r.reservationId });
  assert.equal(rel.ok, false, 'committed 之后不得 release');
  assert.equal(rel.code, 'INVALID_TRANSITION');
  const e = ledger.get(r.reservationId);
  assert.equal(e.state, RESERVATION_STATE.COMMITTED);
  assert.equal(e.usageTokens, 42);
  assert.equal(e.estimateTokens, 300, 'estimate 保留原值供审计,但不再计入占用');

  // 补录按实际值腾出的差额预算可复用:42 + 458 = 500 ≤ 上限
  const r2 = ledger.reserve({ requestId: 'rec-2', role: 'credit', purpose: 'risk_review', estimateTokens: 458 });
  assert.equal(r2.ok, true, '补录后按实际值占用,差额预算应可复用');
  assert.equal(ledger.totals().occupiedTokens, 500);
});

test('极限:maxReservedTokens=0 时正 estimate 全拒;estimate=0 合法且占 0', () => {
  const ledger = createMemoryLedger({ maxReservedTokens: 0 });

  // 上限为 0:任何正 estimate 的预留都必须拒绝,且不动用预算
  const r1 = ledger.reserve({ requestId: 'z1', role: 'credit', purpose: 'risk_review', estimateTokens: 1 });
  assert.equal(r1.ok, false, '上限为 0 时正 estimate 必须拒绝');
  assert.equal(r1.code, 'BUDGET_EXCEEDED');
  assert.equal(ledger.totals().occupiedTokens, 0, '被拒请求不得动用预算');
  assert.equal(ledger.totals().rejectedCount, 1, '被拒请求必须留下可审计的 rejected 条目');

  // estimate=0 合法:预留成功(0+0 ≤ 0),占用恒为 0
  const r2 = ledger.reserve({ requestId: 'z2', role: 'credit', purpose: 'risk_review', estimateTokens: 0 });
  assert.equal(r2.ok, true, 'estimate=0 的预留合法,应成功');
  let t = ledger.totals();
  assert.equal(t.reservedTokens, 0, 'estimate=0 不产生 token 占用');
  assert.equal(t.occupiedTokens, 0);
  assert.equal(t.occupiedTokens, t.reservedTokens + t.committedTokens + t.unknownHoldTokens);

  // estimate=0 的 holdUnknown:状态保留为 unknown_hold(未知不释放),但占 0
  const h = ledger.holdUnknown({ reservationId: r2.reservationId, note: '零成本调用结果未知' });
  assert.equal(h.ok, true);
  assert.equal(h.state, RESERVATION_STATE.UNKNOWN_HOLD);
  t = ledger.totals();
  assert.equal(t.unknownHoldTokens, 0, 'estimate=0 的未知保留占 0');
  const e = ledger.get(r2.reservationId);
  assert.equal(e.state, RESERVATION_STATE.UNKNOWN_HOLD, '未知必须保留条目状态,而不是释放或记 0');
  assert.equal(ledger.release({ reservationId: r2.reservationId }).ok, false, 'unknown_hold 占 0 也不得 release');

  // estimate=0 的多个预留可在上限 0 下并存
  const r3 = ledger.reserve({ requestId: 'z3', role: 'credit', purpose: 'risk_review', estimateTokens: 0 });
  assert.equal(r3.ok, true, '第二个 estimate=0 预留仍应成功(不占用预算)');
  assert.equal(ledger.totals().occupiedTokens, 0);

  // 入参守卫:负数 / 非整数 estimate 必须抛 TypeError,不产生任何条目
  assert.throws(() => ledger.reserve({ requestId: 'z4', role: 'credit', purpose: 'risk_review', estimateTokens: -1 }), TypeError);
  assert.throws(() => ledger.reserve({ requestId: 'z5', role: 'credit', purpose: 'risk_review', estimateTokens: 1.5 }), TypeError);
  assert.equal(ledger.totals().rejectedCount, 1, '入参校验失败不得追加 rejected 条目');
});

test('负控制:故意错误断言必须被抓——证明测试自身有抓错能力', () => {
  const ledger = createMemoryLedger({});

  // 负控制 1:故意断言"unknown_hold 可以 release"(真实账本语义明确禁止)。
  // 若实现或测试 Harness 失灵导致该违规不被抓,本测试失败。
  const r1 = ledger.reserve({ requestId: 'nc-1', role: 'credit', purpose: 'risk_review', estimateTokens: 100 });
  assert.equal(r1.ok, true);
  ledger.holdUnknown({ reservationId: r1.reservationId });
  assert.throws(
    () => {
      const rel = ledger.release({ reservationId: r1.reservationId });
      assert.equal(rel.ok, true, '故意错误断言:unknown_hold 绝不能 release 成功');
    },
    assert.AssertionError,
    '负控制 1 未生效:故意放行 unknown_hold 释放的错误断言没有被抓住'
  );

  // 对照组:同一断言模板作用在合法路径(reserved → release)则不得抛出,
  // 证明负控制 1 抛错来自"断言被抓",而不是 release 方法本身抛异常。
  const r2 = ledger.reserve({ requestId: 'nc-2', role: 'credit', purpose: 'risk_review', estimateTokens: 100 });
  assert.doesNotThrow(() => {
    const rel = ledger.release({ reservationId: r2.reservationId });
    assert.equal(rel.ok, true, 'reserved → release 是合法迁移,必须成功');
  });

  // 负控制 2:故意断言 totals 的错误数值,同样必须被抓。
  assert.throws(
    () => assert.equal(ledger.totals().occupiedTokens, 99999, '故意错误断言:占用不可能是 99999'),
    assert.AssertionError,
    '负控制 2 未生效:totals 错误断言没有被抓住'
  );
});
