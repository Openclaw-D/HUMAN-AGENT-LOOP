// 冒烟样本(仅验证变异机制本身,不参与交付语义)。
export function selectVictim(list) {
  for (const item of list) {
    // MUTATION-ANCHOR:EVICTION-SELECT
    if (true || !item.usable) continue;
    return item;
  }
  return null;
}
