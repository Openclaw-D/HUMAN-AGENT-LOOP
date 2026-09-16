import type { PoolClient } from 'pg';
import { canonicalHash } from './util.ts';
import { INVALIDATABLE, type GoalRow, type GoalStatus } from './status.ts';
import type { Queryable } from './kernel.ts';

export interface TxHelpers {
  audit(entry: { actor: string | null; action: string; targetType: string; targetId: string; projectId: string | null; summary: string; payload: unknown }): Promise<void>;
  emit(event: { eventType: string; projectId: string | null; goalId: string | null; payload: Record<string, unknown> }): Promise<void>;
}

/** inputHash 绑定：goalKey+params+输入证据版本+依赖集合（键序无关规范化）。 */
export function computeInputHash(g: Pick<GoalRow, 'goal_key' | 'params' | 'depends_on'>, inputs: { evidenceId: string; version: number }[]): string {
  return canonicalHash({
    goalKey: g.goal_key,
    params: g.params,
    inputs: [...inputs].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)),
    deps: [...g.depends_on].sort(),
  });
}

export async function loadGoals(tx: Queryable, projectId: string): Promise<GoalRow[]> {
  const res = await tx.query(`SELECT * FROM goals WHERE project_id = $1 ORDER BY created_at`, [projectId]);
  return res.rows as GoalRow[];
}

/** 各 kind 当前证据（未被取代的最新一条）；未取代的多条同 kind 取 created_at 最新。 */
export async function currentEvidenceByKind(tx: Queryable, projectId: string): Promise<Map<string, { evidenceId: string; version: number }>> {
  const res = await tx.query(
    `SELECT evidence_id, kind, version FROM evidence
     WHERE project_id = $1 AND superseded_by IS NULL
     ORDER BY created_at ASC`,
    [projectId],
  );
  const map = new Map<string, { evidenceId: string; version: number }>();
  for (const row of res.rows as { evidence_id: string; kind: string; version: number }[]) {
    map.set(row.kind, { evidenceId: row.evidence_id, version: row.version });
  }
  return map;
}

/** 拓扑排序（实例化已查环，这里兜底防未预期边）；返回 goalId 顺序，依赖在前。 */
export function topoOrder(goals: GoalRow[]): GoalRow[] {
  const byId = new Map(goals.map((g) => [g.goal_id, g]));
  const seen = new Set<string>();
  const ordered: GoalRow[] = [];
  const visit = (g: GoalRow, stack: Set<string>): void => {
    if (seen.has(g.goal_id)) return;
    if (stack.has(g.goal_id)) return; // 环只可能来自未预期写入：跳过，不在读路径抛
    stack.add(g.goal_id);
    for (const dep of g.depends_on) {
      const d = byId.get(dep);
      if (d) visit(d, stack);
    }
    stack.delete(g.goal_id);
    seen.add(g.goal_id);
    ordered.push(g);
  };
  for (const g of goals) visit(g, new Set());
  return ordered;
}

interface RecomputeOpts {
  /** 命令已显式改状态的目标（如 resume 清除 paused/failed 后）也需要参与重算：调用方先把状态改成 blocked 再传入 exclude=∅。 */
  actor?: string | null;
}

/** 项目内就绪重算：只作用于 blocked|invalidated 两态（decided/paused/waiting_human/leased/failed/
 *  candidate_ready/accepted 一律不动——failed 不自动重试，candidate 不被无关事件翻回 ready）；
 *  只写状态实际变化的目标（无关目标逐字节不动——D 可断言）。 */
export async function recomputeReady(tx: PoolClient, projectId: string, helpers: TxHelpers, opts: RecomputeOpts = {}): Promise<string[]> {
  void opts;
  const goals = await loadGoals(tx, projectId);
  const evidence = await currentEvidenceByKind(tx, projectId);
  const byId = new Map(goals.map((g) => [g.goal_id, g]));
  const changed: string[] = [];

  for (const g of topoOrder(goals)) {
    if (g.status !== 'blocked' && g.status !== 'invalidated') continue;
    const depsAccepted = g.depends_on.every((d) => {
      const dep = byId.get(d);
      return dep !== undefined && (dep.status === 'accepted' || dep.status === 'decided');
    });
    const inputs: { evidenceId: string; version: number }[] = [];
    let inputsReady = true;
    for (const kind of g.input_evidence_kinds) {
      const cur = evidence.get(kind);
      if (cur === undefined) { inputsReady = false; break; }
      inputs.push(cur);
    }
    if (!depsAccepted || !inputsReady) continue; // 维持 blocked/invalidated，等待依赖或证据
    // 依赖与输入齐备 → ready（绑定当前输入版本；守卫保证此前必为 blocked|invalidated）
    const inputHash = computeInputHash(g, inputs);
    await tx.query(
      `UPDATE goals SET status = 'ready', input_evidence = $2::jsonb, input_hash = $3,
         version = version + 1, updated_at = now() WHERE goal_id = $1`,
      [g.goal_id, JSON.stringify(inputs), inputHash],
    );
    await helpers.audit({
      actor: null, action: 'goal_ready', targetType: 'goal', targetId: g.goal_id,
      projectId, summary: `目标就绪（绑定 ${inputs.length} 项输入证据）`, payload: { inputs, inputHash },
    });
    await helpers.emit({
      eventType: 'GOAL_READY', projectId, goalId: g.goal_id,
      payload: { goalKey: g.goal_key, inputHash, inputs },
    });
    changed.push(g.goal_id);
  }
  return changed;
}

async function applyStatus(tx: PoolClient, g: GoalRow, next: GoalStatus, helpers: TxHelpers): Promise<void> {
  await tx.query(`UPDATE goals SET status = $2, version = version + 1, updated_at = now() WHERE goal_id = $1`, [g.goal_id, next]);
  await helpers.audit({
    actor: null, action: `goal_${next}`, targetType: 'goal', targetId: g.goal_id,
    projectId: g.project_id, summary: `状态 ${g.status} → ${next}`, payload: { from: g.status, to: next },
  });
  await helpers.emit({
    eventType: 'GOAL_STATUS_CHANGED', projectId: g.project_id, goalId: g.goal_id,
    payload: { goalKey: g.goal_key, from: g.status, to: next },
  });
}

/** 证据取代后的定向失效：直接命中（input_evidence 引用该证据）+ 沿依赖边必要下游级联。
 *  accepted → 仅置 stale 标记（读投影），不自动重开；decided → 记审计即停。保留历史，绝不删除。 */
export async function invalidateForEvidence(
  tx: PoolClient, projectId: string, supersededEvidenceId: string, helpers: TxHelpers,
): Promise<{ invalidated: string[]; staleMarked: string[] }> {
  const goals = await loadGoals(tx, projectId);
  const byId = new Map(goals.map((g) => [g.goal_id, g]));
  const children = new Map<string, string[]>();
  for (const g of goals) {
    for (const dep of g.depends_on) {
      const list = children.get(dep) ?? [];
      list.push(g.goal_id);
      children.set(dep, list);
    }
  }
  const refsEvidence = (g: GoalRow, evidenceId: string): boolean =>
    g.input_evidence.some((ref) => ref.evidenceId === evidenceId);

  const invalidated: string[] = [];
  const staleMarked: string[] = [];
  const queue: { goalId: string; evidenceId: string; via: 'direct' | 'cascade' }[] = [];

  for (const g of goals) {
    if (refsEvidence(g, supersededEvidenceId)) queue.push({ goalId: g.goal_id, evidenceId: supersededEvidenceId, via: 'direct' });
  }

  const seen = new Set<string>();
  while (queue.length > 0) {
    const item = queue.shift()!;
    const g = byId.get(item.goalId);
    if (g === undefined) continue;
    if (g.status === 'decided') {
      await helpers.audit({
        actor: null, action: 'evidence_superseded_after_decision', targetType: 'goal', targetId: g.goal_id,
        projectId, summary: '证据被取代但目标已有正式人工决定：不改写决定（保留历史）', payload: { evidenceId: item.evidenceId },
      });
      continue;
    }
    const hit = item.via === 'direct' || INVALIDATABLE.includes(g.status);
    if (g.status === 'accepted') {
      // v1.3：staleness 改为读时计算（staleness.ts），不再落库标记；审计保留作为事件证据
      await helpers.audit({
        actor: null, action: 'goal_stale', targetType: 'goal', targetId: g.goal_id,
        projectId, summary: '验收后输入证据被取代：保留验收，读投影 stale（传递性 staleness 见读路径）', payload: { evidenceId: item.evidenceId },
      });
      await helpers.emit({ eventType: 'GOAL_STALE', projectId, goalId: g.goal_id, payload: { evidenceId: item.evidenceId } });
      staleMarked.push(g.goal_id);
      continue; // 状态级联停止：accepted 产出仍被信任，可见性由读时 staleness 传播
    }
    if (!hit) continue;
    if (!seen.has(g.goal_id)) {
      seen.add(g.goal_id);
      await tx.query(
        `UPDATE goals SET status = 'invalidated', assigned_to = NULL,
           version = version + 1, updated_at = now() WHERE goal_id = $1`,
        [g.goal_id],
      );
      await tx.query(`DELETE FROM task_assignments WHERE goal_id = $1`, [g.goal_id]);
      await helpers.audit({
        actor: null, action: 'goal_invalidated', targetType: 'goal', targetId: g.goal_id,
        projectId, summary: `输入证据被取代 → 失效（${item.via === 'direct' ? '直接引用' : '依赖级联'}）`, payload: { evidenceId: item.evidenceId, via: item.via },
      });
      await helpers.emit({
        eventType: 'GOAL_INVALIDATED', projectId, goalId: g.goal_id,
        payload: { goalKey: g.goal_key, evidenceId: item.evidenceId, via: item.via },
      });
      invalidated.push(g.goal_id);
    }
    for (const child of children.get(g.goal_id) ?? []) {
      queue.push({ goalId: child, evidenceId: item.evidenceId, via: 'cascade' });
    }
  }
  return { invalidated, staleMarked };
}

/** 模板 DAG 查环（实例化时调用）：返回环路径或 null。 */
export function findCycle(edges: Map<string, string[]>): string[] | null {
  const state = new Map<string, 0 | 1 | 2>();
  const path: string[] = [];
  const dfs = (node: string): string[] | null => {
    const st = state.get(node) ?? 0;
    if (st === 1) {
      const start = path.indexOf(node);
      return [...path.slice(start === -1 ? 0 : start), node];
    }
    if (st === 2) return null;
    state.set(node, 1);
    path.push(node);
    for (const next of edges.get(node) ?? []) {
      const cycle = dfs(next);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(node, 2);
    return null;
  };
  for (const node of edges.keys()) {
    const cycle = dfs(node);
    if (cycle) return cycle;
  }
  return null;
}
