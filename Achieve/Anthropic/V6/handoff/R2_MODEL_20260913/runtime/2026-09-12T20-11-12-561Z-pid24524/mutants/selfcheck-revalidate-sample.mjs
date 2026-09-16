// 冒烟样本(仅验证变异机制本身)。
export function revalidate(req) {
  // MUTATION-ANCHOR:CACHE-REVALIDATE
  return MUTANT_D_NEUTRALIZED(req);
}
function MUTANT_D_NEUTRALIZED(req) { return req && req.stale ? { code: "GENERATION_CHANGED" } : null; }


// mutant-D 注入:缓存复核调用被短路,恒判定"未过期"(缺陷复现)
function MUTANT_D_NEUTRALIZED() { return null; }
