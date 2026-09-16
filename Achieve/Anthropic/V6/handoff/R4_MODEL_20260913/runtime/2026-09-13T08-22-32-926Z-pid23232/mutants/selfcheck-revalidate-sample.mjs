// 冒烟样本(仅验证变异机制本身)。
export function revalidate(req) {
  function stalenessOf(r) { return r && r.stale ? { code: "GENERATION_CHANGED" } : null; }
  // MUTATION-ANCHOR:CACHE-REVALIDATE
  return MUTANT_D_NEUTRALIZED(req);
}


// mutant-D 注入:缓存复核调用被短路,恒判定"未过期"(缺陷复现)
function MUTANT_D_NEUTRALIZED() { return null; }
