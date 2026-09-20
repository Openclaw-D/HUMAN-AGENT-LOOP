import type { ModelAssistant, ObservationEvidence } from './takeoff-actions';

export interface DecisionCandidate {
  id: string; label: string; confidence: number | null; impact: string; evidenceRefIds: string[];
  confidenceKind: 'model_estimate_uncalibrated';
}
export interface DecisionFeedback {
  action: 'select' | 'none'; candidateId: string | null; label: string; reason: string; eventId: string; at: string;
}
export interface DecisionResponse {
  ok: true; authority: 'none'; customerId: string; assistant: ModelAssistant; revision: number;
  pending: { operationId: string; question: string } | null;
  error?: string;
  latest: {
    id: string; question: string; current: boolean; valid: boolean; at: string;
    candidates: DecisionCandidate[]; evidenceRefs: ObservationEvidence[];
    omitted: Array<{ reason: string }>; feedback: DecisionFeedback | null; feedbackUsed: string | null;
    model: { status: string; contextVersion: string; source?: { model?: string; mode?: string }; requestId?: string; error?: string | null };
  } | null;
}
export interface DecisionCommand { assistant: ModelAssistant; operationId: string; expectedRevision: number; question: string }
export interface FeedbackCommand {
  assistant: ModelAssistant; operationId: string; expectedRevision: number; decisionSetId: string;
  action: 'select' | 'none' | 'undo'; candidateId?: string | null; reason?: string;
}
export function validDecisionResponse(value: unknown, customerId: string, assistant: ModelAssistant): value is DecisionResponse {
  const v = value as DecisionResponse | null;
  if (!v || v.ok !== true || v.authority !== 'none' || v.customerId !== customerId || v.assistant !== assistant ||
    !Number.isSafeInteger(v.revision) || v.revision < 0 ||
    (v.pending !== null && (!v.pending || typeof v.pending.operationId !== 'string' || typeof v.pending.question !== 'string'))) return false;
  const s = v.latest;
  if (s === null) return true;
  if (!s || typeof s.id !== 'string' || typeof s.question !== 'string' || typeof s.current !== 'boolean' ||
    !s.model || !Array.isArray(s.candidates) || s.candidates.length > 5 || !Array.isArray(s.evidenceRefs) || !Array.isArray(s.omitted)) return false;
  const ids = new Set<string>();
  for (const c of s.candidates) {
    if (!c || typeof c.id !== 'string' || ids.has(c.id) || typeof c.label !== 'string' || typeof c.impact !== 'string' ||
      c.confidenceKind !== 'model_estimate_uncalibrated' || !Array.isArray(c.evidenceRefIds) ||
      !(c.confidence === null || (typeof c.confidence === 'number' && Number.isFinite(c.confidence) && c.confidence >= 0 && c.confidence <= 1))) return false;
    ids.add(c.id);
  }
  if (!s.evidenceRefs.every(r => r && typeof r.id === 'string' && typeof r.text === 'string' && r.locator &&
    Number.isInteger(r.locator.start) && Number.isInteger(r.locator.end) && /^[a-f0-9]{64}$/.test(r.hash))) return false;
  if (!s.candidates.every(c => c.evidenceRefIds.length && c.evidenceRefIds.every(id => s.evidenceRefs.some(r => r.id === id)))) return false;
  if (s.feedback !== null && (!s.feedback || !['select', 'none'].includes(s.feedback.action) ||
    typeof s.feedback.eventId !== 'string' || typeof s.feedback.label !== 'string' ||
    (s.current && s.feedback.action === 'select' && !ids.has(s.feedback.candidateId ?? '')))) return false;
  return true;
}
