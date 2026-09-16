// 传递 staleness 计算（DEF-01 v1.3 候选，读时计算不落库标记；语义 PENDING-USER-RULING）：
// stale(goal) = 自身输入引用已被取代的证据 OR 任一传递依赖 stale。
// decided/accepted 也计算（决定/验收不改写，仅"依据事后被推翻"对读方可见）。
import type { GoalRow } from './status.ts';

export interface StaleInfo {
  stale: boolean;
  /** 失效根因目标（自身输入失效，或传递依赖中自身输入失效者）。 */
  roots: { goalId: string; goalKey: string }[];
}

export type EvidenceSupersededIndex = Map<string, boolean>; // evidenceId -> 是否已被取代

export function ownInputsStale(g: GoalRow, superseded: EvidenceSupersededIndex): boolean {
  return g.input_evidence.some((ref) => superseded.get(ref.evidenceId) === true);
}

/** memo 化 DFS：项目内全量 goals + 证据取代索引 → goalId → StaleInfo。 */
export function computeStaleMap(goals: GoalRow[], superseded: EvidenceSupersededIndex): Map<string, StaleInfo> {
  const byId = new Map(goals.map((g) => [g.goal_id, g]));
  const memo = new Map<string, StaleInfo>();
  const visiting = new Set<string>(); // 环兜底（实例化已查环）
  const visit = (g: GoalRow): StaleInfo => {
    const hit = memo.get(g.goal_id);
    if (hit !== undefined) return hit;
    if (visiting.has(g.goal_id)) return { stale: false, roots: [] }; // 环：不放大
    visiting.add(g.goal_id);
    const own = ownInputsStale(g, superseded);
    const roots: { goalId: string; goalKey: string }[] = own ? [{ goalId: g.goal_id, goalKey: g.goal_key }] : [];
    let stale = own;
    for (const depId of g.depends_on) {
      const dep = byId.get(depId);
      if (dep === undefined) continue; // unresolved: 前缀——依赖尚未实例化，无staleness信息
      const depInfo = visit(dep);
      if (depInfo.stale) {
        stale = true;
        for (const r of depInfo.roots) {
          if (!roots.some((x) => x.goalId === r.goalId)) roots.push(r);
        }
      }
    }
    visiting.delete(g.goal_id);
    const info: StaleInfo = { stale, roots };
    memo.set(g.goal_id, info);
    return info;
  };
  for (const g of goals) visit(g);
  return memo;
}
