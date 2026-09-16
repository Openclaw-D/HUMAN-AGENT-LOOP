function stalenessOf(req) { return req && req.stale ? { code: "GENERATION_CHANGED" } : null; }
export function earlyCheck(req) { return stalenessOf(req); }
  // MUTATION-ANCHOR:CACHE-REVALIDATE
export function lateCheck(req) { return MUTANT_D_NEUTRALIZED(req); }


// mutant-D 注入:缓存复核调用被短路,恒判定"未过期"(缺陷复现)
function MUTANT_D_NEUTRALIZED() { return null; }
