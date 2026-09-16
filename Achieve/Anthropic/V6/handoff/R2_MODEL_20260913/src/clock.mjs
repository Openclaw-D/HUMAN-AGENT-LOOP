// 时钟注入:测试用手动时钟获得确定性超时,真实环境用系统时钟。
// 适配器只依赖该接口,不直接引用 Date.now / setTimeout。

export const systemClock = Object.freeze({
  kind: 'system',
  now() {
    return Date.now();
  },
  setTimeout(fn, ms) {
    return setTimeout(fn, ms);
  },
  clearTimeout(id) {
    clearTimeout(id);
  },
});

/**
 * 手动时钟:advance(ms) 按到期顺序同步触发到点任务(含任务执行中新注册的到点任务)。
 * 用于测试超时/迟到结果而不真实等待。
 */
export function createManualClock(startAtMs = 0) {
  let nowMs = startAtMs;
  let seq = 0;
  const timers = new Map(); // id -> { due, fn, cancelled }

  function fireDue() {
    for (;;) {
      let bestId = null;
      let best = null;
      for (const [id, t] of timers.entries()) {
        if (t.cancelled || t.due > nowMs) continue;
        if (!best || t.due < best.due || (t.due === best.due && id < bestId)) {
          bestId = id;
          best = t;
        }
      }
      if (!best) break;
      timers.delete(bestId);
      best.fn();
    }
  }

  return {
    kind: 'manual',
    now() {
      return nowMs;
    },
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { due: nowMs + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout(id) {
      const t = timers.get(id);
      if (t) t.cancelled = true;
    },
    advance(ms) {
      nowMs += ms;
      fireDue();
    },
    pendingCount() {
      let n = 0;
      for (const t of timers.values()) if (!t.cancelled) n += 1;
      return n;
    },
  };
}
