// D路断言助手：所有断言进计数器，测试结束上报。零依赖。
export function makeAssert(testId) {
  const state = { count: 0, failures: [] };
  const ok = (msg) => { state.count++; };
  const bad = (msg, detail) => { state.count++; state.failures.push({ msg, detail: trim(detail) }); };
  const a = (cond, msg, detail) => { if (cond) ok(msg); else bad(msg, detail); return !!cond; };
  a.eq = (actual, expected, msg) => a(Object.is(actual, expected), msg || `expect ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`, { actual, expected });
  a.notEq = (actual, notExpected, msg) => a(!Object.is(actual, notExpected), msg || `expect not ${JSON.stringify(notExpected)}`, { actual });
  a.includes = (hay, needle, msg) => a(typeof hay === 'string' && hay.includes(needle), msg || `expect string to include ${JSON.stringify(needle)}`, { sample: String(hay).slice(0, 300) });
  a.status = (res, expected, msg) => a(res && res.status === expected, msg || `expect HTTP ${expected} got ${res ? res.status : 'no-response'}`, { body: res ? String(res.text || '').slice(0, 300) : null });
  a.statusIn = (res, list, msg) => a(res && list.includes(res.status), msg || `expect HTTP in [${list}] got ${res ? res.status : 'no-response'}`, { body: res ? String(res.text || '').slice(0, 300) : null });
  a.ok = ok;
  a.fail = (msg, detail) => { bad(msg, detail); throw new Error(`assert.fail: ${msg}`); };
  a.count = () => state.count;
  a.failures = state.failures;
  return a;
}
function trim(d) {
  if (d === undefined) return undefined;
  const s = typeof d === 'string' ? d : JSON.stringify(d);
  return s && s.length > 500 ? s.slice(0, 500) + '…' : s;
}
