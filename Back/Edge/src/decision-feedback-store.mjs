import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, stable } from './assistant-receipts.mjs';

export const decisionError = (code, status = 409) => Object.assign(new Error(code), { code, status });

/** Feedback lives beside model receipts, never in the approval kernel. Atomic snapshot retains every event. */
export function createDecisionFeedbackStore(dir) {
  if (!dir) throw decisionError('DECISION_STORAGE_REQUIRED', 503);
  const root = path.resolve(dir, 'decision-feedback');
  const filename = scope => path.join(root, digest(scope) + '.json');
  async function read(scope) {
    try {
      const state = JSON.parse(await fs.readFile(filename(scope), 'utf8'));
      if (stable(state.scope) !== stable(scope) || !Array.isArray(state.events) || state.revision !== state.events.length)
        throw decisionError('DECISION_STORAGE_INVALID', 503);
      return state;
    } catch (e) {
      if (e.code === 'ENOENT') return { scope, revision: 0, events: [], pending: null, latest: null };
      throw e;
    }
  }
  return {
    read,
    async update(scope, expectedRevision, event, apply) {
      await fs.mkdir(root, { recursive: true });
      const target = filename(scope), lock = target + '.lock';
      let handle;
      try { handle = await fs.open(lock, 'wx'); }
      catch (e) { if (e.code === 'EEXIST') throw decisionError('DECISION_STORAGE_BUSY'); throw e; }
      await handle.close();
      let release = false;
      try {
        const state = await read(scope);
        const previous = state.events.find(e => e.id === event.id);
        if (previous) {
          if (previous.fingerprint !== digest(event)) throw decisionError('IDEMPOTENCY_CONFLICT');
          release = true; return state;
        }
        if (state.revision !== expectedRevision) throw decisionError('VERSION_CONFLICT');
        if (state.events.length >= 2000) throw decisionError('FEEDBACK_HISTORY_LIMIT', 503);
        const next = apply(structuredClone(state));
        next.events.push({ ...event, fingerprint: digest(event), at: new Date().toISOString() });
        next.revision++;
        const temp = target + '.' + randomUUID() + '.tmp';
        const writer = await fs.open(temp, 'wx');
        try { await writer.writeFile(JSON.stringify(next)); await writer.sync(); }
        finally { await writer.close(); }
        await fs.rename(temp, target);
        release = true;
        return next;
      } catch (e) {
        // Expected validation failures made no mutation. I/O uncertainty preserves the lock for reconciliation.
        if (e.status && e.code !== 'DECISION_STORAGE_INVALID') release = true;
        throw e;
      } finally { if (release) await fs.unlink(lock); }
    },
  };
}

function baseCandidate(c, ids, evidence) {
  if (!c || !/^[a-zA-Z0-9_-]{1,40}$/.test(c.id) || ids.has(c.id) ||
    typeof c.label !== 'string' || !c.label.trim() || c.label.length > 240 ||
    typeof c.impact !== 'string' || !c.impact.trim() || c.impact.length > 500 ||
    !(c.confidence === null || (typeof c.confidence === 'number' && Number.isFinite(c.confidence) && c.confidence >= 0 && c.confidence <= 1)) ||
    !Array.isArray(c.evidenceRefIds) || !c.evidenceRefIds.length || !c.evidenceRefIds.every(id => evidence.has(id)))
    throw decisionError('INVALID_DECISION_OUTPUT', 422);
  ids.add(c.id);
  return { id: c.id, label: c.label.trim(), impact: c.impact.trim(), confidence: c.confidence,
    evidenceRefIds: [...new Set(c.evidenceRefIds)], confidenceKind: 'model_estimate_uncalibrated' };
}

export function validateDecisionCandidates(value, pack) {
  if (!Array.isArray(value) || value.length > 5) throw decisionError('INVALID_DECISION_OUTPUT', 422);
  const evidence = new Set((pack?.snippets ?? []).map(s => s.id)), ids = new Set();
  return value.map(c => baseCandidate(c, ids, evidence)).sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1));
}

/** path_forecast 契约：每个候选必须携带完整 forecast（目标/条件/时间范围），任一缺失、空串、
 *  超长（targetState≤240、条件≤5项各≤240、horizon≤120）或引用无效即整体拒绝，不降级为行动建议。 */
export function validateForecastCandidates(value, pack) {
  if (!Array.isArray(value) || value.length > 5) throw decisionError('INVALID_DECISION_OUTPUT', 422);
  const evidence = new Set((pack?.snippets ?? []).map(s => s.id)), ids = new Set();
  const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;
  return value.map(c => {
    const f = c?.forecast;
    if (!f || typeof f !== 'object' || Array.isArray(f) || !text(f.targetState, 240) ||
      !Array.isArray(f.conditions) || !f.conditions.length || f.conditions.length > 5 || !f.conditions.every(t => text(t, 240)) ||
      !text(f.horizon, 120))
      throw decisionError('INVALID_DECISION_OUTPUT', 422);
    return { ...baseCandidate(c, ids, evidence),
      forecast: { targetState: f.targetState.trim(), conditions: f.conditions.map(t => t.trim()), horizon: f.horizon.trim() } };
  }).sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1));
}
