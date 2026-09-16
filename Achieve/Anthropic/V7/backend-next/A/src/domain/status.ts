export const GOAL_STATUSES = [
  'blocked', 'ready', 'leased', 'waiting_human', 'candidate_ready',
  'accepted', 'decided', 'invalidated', 'paused', 'failed',
] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const TERMINAL_STATUSES: readonly GoalStatus[] = ['decided'];
/** 可被证据失效命中置回 invalidated 的状态（decided 永不；accepted 只置 stale 标记）。 */
export const INVALIDATABLE: readonly GoalStatus[] = [
  'blocked', 'ready', 'leased', 'waiting_human', 'candidate_ready', 'failed', 'invalidated',
];

export const RECOMPUTABLE: readonly GoalStatus[] = ['blocked', 'invalidated', 'ready', 'failed'];

export interface GoalRow {
  goal_id: string;
  project_id: string;
  goal_key: string;
  title: string;
  responsible_role: string;
  executor_kind: 'agent' | 'human';
  acceptance_role: string;
  decision_role: string;
  params: Record<string, unknown>;
  depends_on: string[];
  input_evidence_kinds: string[];
  input_evidence: { evidenceId: string; version: number }[];
  input_hash: string | null;
  status: GoalStatus;
  version: number;
  stale: boolean;
  result: Record<string, unknown> | null;
  formal_decision: Record<string, unknown> | null;
  receipt_count: number;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
}
