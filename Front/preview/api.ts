export type Role = 'facilitator' | 'contributor' | 'observer';
export type Session = { role: Role; label: string; displayName: string };
export type ObjectiveId = 'impact' | 'effort' | 'flexibility' | 'independence';
export type Weights = Record<ObjectiveId, number>;
export type Limits = { maxEffortPoints: number; minFlexibilityScore: number; maxDependencyScore: number; minInformationPct: number };
export type Metrics = { impactScore: number | null; effortPoints: number | null; flexibilityScore: number | null; dependencyScore: number | null };
export type Candidate = { id: string; name: string; description: string; metrics: Metrics; informationCompleteness: number | null; eligible: boolean; blockers: string[]; score: number | null; pareto: boolean; contributions: Record<ObjectiveId, number | null> };
export type Summary = { id: string; title: string; category: string; question: string; revision: number; status: 'pending' | 'decided' | 'deferred' | 'needs_review' };
export type Decision = { id: string; outcome: 'choose' | 'defer'; candidateId: string | null; reason: string; actor: string; actorName: string; inputVersion: number; at: string };
export type Scenario = Omit<Summary, 'status'> & { description: string; sourceMode: 'synthetic'; inputVersion: number; weights: Weights; limits: Limits;
  objectives: { id: ObjectiveId; label: string; metric: keyof Metrics; direction: 'max' | 'min'; unit: string; scale: number[] }[];
  candidates: Candidate[];
  analysis: { id: string; inputVersion: number; authority: 'none'; recommendedId: string | null; explanation: string; candidates: Candidate[] } | null;
  analysisStale: boolean; decisionNeedsReview: boolean; decisions: Decision[];
  feedback: { id: string; verdict: string; note: string; at: string }[];
  evidence: { id: string; title: string; note: string }[];
  evidenceChanges: { id: string; candidateId: string; field: string; before: number | null; value: number | null; note: string; at: string }[];
  participants: { id: string; name: string; role: Role }[];
  discussion: { id: string; kind: 'human' | 'assistant'; author: string; content: string; at: string; mode?: 'simulated'; contextCurrent: boolean }[];
  events: { seq: number; actor: string; action: string; at: string; details: Record<string, unknown> }[];
};
export class ApiError extends Error { constructor(message: string, public status: number, public code: string) { super(message); } }
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new ApiError(data.message ?? '操作未完成', res.status, data.error);
  return data as T;
}
