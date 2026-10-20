import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DecisionStore } from '../src/store.mjs';
import { createScenarios, DEFAULT_WEIGHTS, DEFAULT_LIMITS } from '../src/scenarios.mjs';
import { evaluate, validatePreferences } from '../src/analysis.mjs';

const actor = { id: 'person-a', displayName: '参与者甲', role: 'facilitator' };
function command(store, action, payload, id = 'shared-choice', who = actor) {
  const body = { requestId: randomUUID(), expectedRevision: store.get(id).revision, ...payload };
  return { response: store.command(id, action, body, who), body };
}
const analyze = s => command(s, 'analyze', { weights: { ...DEFAULT_WEIGHTS }, limits: { ...DEFAULT_LIMITS } });

test('changing goals changes the recommendation; hard boundaries override the highest score', () => {
  const s = createScenarios()[0], original = evaluate(s);
  assert.equal(original.authority, 'none');
  assert.equal(original.candidates.find(c => c.id === 'expand').eligible, false);
  s.weights = { impact: 100, effort: 0, flexibility: 0, independence: 0 };
  const changed = evaluate(s);
  assert.equal(changed.recommendedId, 'balanced');
  assert.notEqual(changed.recommendedId, original.recommendedId);
  assert.equal(changed.candidates.find(c => c.id === 'expand').score, 95);
  assert.notEqual(changed.recommendedId, 'expand');
});
test('unknown input remains unknown; an empty feasible set produces no recommendation', () => {
  const s = createScenarios()[2], before = structuredClone(s);
  const a = evaluate(s);
  assert.equal(a.recommendedId, null);
  assert.ok(a.candidates.every(c => c.score === null && !c.eligible));
  assert.deepEqual(s, before);
});
test('Pareto frontier excludes a dominated candidate without excluding tradeoffs', () => {
  const s = createScenarios()[0];
  s.candidates.push({ ...structuredClone(s.candidates[0]), id: 'dominated', metrics: { impactScore: 50, effortPoints: 30, flexibilityScore: 70, dependencyScore: 30 } });
  const a = evaluate(s);
  assert.equal(a.candidates.find(c => c.id === 'dominated').pareto, false);
  assert.ok(a.candidates.filter(c => c.eligible && c.pareto).length > 1);
});
test('zero totals, missing limits, unknown fields and nonfinite weights fail validation', () => {
  for (const weights of [{ impact: 0, effort: 0, flexibility: 0, independence: 0 }, { ...DEFAULT_WEIGHTS, impact: Infinity }, { ...DEFAULT_WEIGHTS, injected: 1 }]) {
    assert.throws(() => validatePreferences(weights, DEFAULT_LIMITS));
  }
  assert.throws(() => validatePreferences(DEFAULT_WEIGHTS, {}));
});
test('decision authority, idempotency ownership and revision conflicts are enforced atomically', () => {
  const s = new DecisionStore();
  try {
    analyze(s);
    const blocked = { candidateId: 'expand', outcome: 'choose', reason: '尝试选择不满足边界的方案' };
    assert.throws(() => command(s, 'decide', blocked), e => e.code === 'CONSTRAINT_BLOCKED');
    const candidateId = s.get('shared-choice').analysis.recommendedId;
    assert.throws(() => command(s, 'decide', { candidateId, outcome: 'choose', reason: '参与者不能替协调者确认' }, 'shared-choice', { ...actor, id: 'person-b', role: 'contributor' }), e => e.status === 403);
    const { body, response } = command(s, 'decide', { candidateId, outcome: 'choose', reason: '接受此方案的目标取舍' });
    const replay = s.command('shared-choice', 'decide', body, actor);
    assert.equal(replay.replayed, true); assert.equal(replay.revision, response.revision);
    assert.equal(s.get('shared-choice').decisions.length, 1);
    const before = s.get('shared-choice');
    assert.throws(() => s.command('shared-choice', 'decide', { ...body, reason: '更换载荷不能复用请求标识' }, actor), e => e.code === 'REQUEST_CONFLICT');
    assert.throws(() => s.command('shared-choice', 'feedback', { requestId: randomUUID(), expectedRevision: 1, verdict: 'useful', note: '旧修订不能覆盖新决定' }, actor), e => e.code === 'REVISION_CONFLICT');
    assert.deepEqual(s.get('shared-choice'), before);
  } finally { s.close(); }
});
test('a changed assumption invalidates old analysis and flags the preserved human decision', () => {
  const s = new DecisionStore();
  try {
    analyze(s);
    command(s, 'decide', { candidateId: 'balanced', outcome: 'choose', reason: '依据当前共同假设选择' });
    const original = structuredClone(s.get('shared-choice').decisions[0]);
    command(s, 'evidence', { candidateId: 'balanced', field: 'effortPoints', value: 99, note: '在模拟中补入更高投入要求' });
    const changed = s.get('shared-choice');
    assert.equal(changed.analysisStale, true); assert.equal(changed.decisionNeedsReview, true);
    assert.deepEqual(changed.decisions[0], original);
    assert.throws(() => command(s, 'decide', { candidateId: 'balanced', outcome: 'choose', reason: '不能按过期比较继续' }), e => e.code === 'STALE_ANALYSIS');
    analyze(s);
    assert.equal(s.get('shared-choice').analysis.candidates.find(c => c.id === 'balanced').eligible, false);
  } finally { s.close(); }
});
test('missing information can be explicitly deferred and later restored through recorded changes', () => {
  const s = new DecisionStore(), id = 'missing-information';
  try {
    command(s, 'analyze', { weights: DEFAULT_WEIGHTS, limits: DEFAULT_LIMITS }, id);
    command(s, 'decide', { outcome: 'defer', candidateId: null, reason: '关键信息尚不完整' }, id);
    command(s, 'evidence', { candidateId: 'explore', field: 'effortPoints', value: 25, note: '模拟补充投入估计' }, id);
    command(s, 'evidence', { candidateId: 'explore', field: 'informationCompleteness', value: 100, note: '模拟资料已按清单补全' }, id);
    command(s, 'analyze', { weights: DEFAULT_WEIGHTS, limits: DEFAULT_LIMITS }, id);
    assert.equal(s.get(id).analysis.recommendedId, 'explore');
    assert.equal(s.get(id).evidenceChanges.length, 2);
    assert.equal(s.get(id).decisionNeedsReview, true);
  } finally { s.close(); }
});
test('people share discussion; simulated assistants cannot create a human decision', () => {
  const s = new DecisionStore(), b = { id: 'person-b', displayName: '参与者乙', role: 'contributor' };
  try {
    s.registerParticipant(actor); s.registerParticipant(b);
    command(s, 'discuss', { message: '我更看重方案后续可调整。' }, 'shared-choice', b);
    command(s, 'discuss', { message: '另一情景的独立讨论。' }, 'limited-resources', { id: 'person-c', displayName: '参与者丙', role: 'contributor' });
    for (const assistantId of ['planner', 'challenger', 'summarizer']) command(s, 'ask', { assistantId, question: '请结合大家的意见解释取舍。' });
    let state = s.get('shared-choice');
    assert.equal(state.participants.length, 2);
    assert.equal(state.discussion[0].author, '参与者乙');
    const replies = state.discussion.filter(m => m.kind === 'assistant');
    assert.equal(replies.length, 3);
    assert.ok(replies.every(m => m.mode === 'simulated' && m.authority === 'none' && m.contextCurrent));
    assert.equal(state.decisions.length, 0);
    command(s, 'evidence', { candidateId: 'explore', field: 'impactScore', value: 50, note: '共同修订效果假设' });
    state = s.get('shared-choice');
    assert.ok(state.discussion.filter(m => m.kind === 'assistant').every(m => !m.contextCurrent));
  } finally { s.close(); }
});
test('records, decision history and command receipts survive a storage restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'decision-store-')), file = join(dir, 'state.sqlite');
  let s = new DecisionStore(file);
  try {
    analyze(s);
    const { body } = command(s, 'decide', { outcome: 'choose', candidateId: 'explore', reason: '先用较小投入验证' });
    command(s, 'feedback', { verdict: 'useful', note: '明确了目标之间的取舍' });
    const before = s.get('shared-choice'); s.close(); s = new DecisionStore(file);
    assert.deepEqual(s.get('shared-choice'), before);
    assert.equal(s.command('shared-choice', 'decide', body, actor).replayed, true);
    assert.equal(s.list().length, 3);
  } finally { s.close(); rmSync(dir, { recursive: true, force: true }); }
});
