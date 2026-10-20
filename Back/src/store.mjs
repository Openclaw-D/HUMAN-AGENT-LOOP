import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createScenarios, OBJECTIVES } from './scenarios.mjs';
import { evaluate, InputError, object, percentage, text, validatePreferences } from './analysis.mjs';
import { ASSISTANTS, assistantReply } from './assistants.mjs';

const ALLOWED = {
  analyze: ['weights', 'limits'],
  evidence: ['candidateId', 'field', 'value', 'note'],
  decide: ['candidateId', 'outcome', 'reason'],
  feedback: ['verdict', 'note'],
  discuss: ['message'],
  ask: ['assistantId', 'question'],
};
const canonical = x => x && typeof x === 'object' ? Array.isArray(x) ? x.map(canonical) : Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
export class DecisionStore {
  constructor(file = ':memory:') {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, actor TEXT NOT NULL, digest TEXT NOT NULL, response TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS participants (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, joined_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, at TEXT NOT NULL, details TEXT NOT NULL);`);
    if (this.db.prepare('SELECT count(*) AS n FROM cases').get().n === 0) {
      const put = this.db.prepare('INSERT INTO cases VALUES (?, ?)');
      this.db.exec('BEGIN IMMEDIATE');
      try { for (const c of createScenarios()) put.run(c.id, JSON.stringify(c)); this.db.exec('COMMIT'); }
      catch (e) { this.db.exec('ROLLBACK'); throw e; }
    }
  }
  close() { this.db.close(); }
  registerParticipant(actor) {
    this.db.prepare('INSERT INTO participants VALUES (?, ?, ?, ?)').run(actor.id, actor.displayName, actor.role, new Date().toISOString());
  }
  raw(id) {
    const row = this.db.prepare('SELECT state FROM cases WHERE id = ?').get(id);
    if (!row) throw new InputError('模拟情景不存在', 404, 'NOT_FOUND');
    return JSON.parse(row.state);
  }
  list() {
    return this.db.prepare('SELECT state FROM cases ORDER BY rowid').all().map(row => {
      const s = JSON.parse(row.state), d = s.decisions.at(-1);
      return { id: s.id, title: s.title, category: s.category, question: s.question, revision: s.revision,
        status: d ? d.inputVersion === s.inputVersion ? d.outcome === 'choose' ? 'decided' : 'deferred' : 'needs_review' : 'pending' };
    });
  }
  get(id) {
    const s = this.raw(id), d = s.decisions.at(-1);
    return { ...s, objectives: OBJECTIVES,
      analysisStale: !!s.analysis && s.analysis.inputVersion !== s.inputVersion,
      decisionNeedsReview: !!d && d.inputVersion !== s.inputVersion,
      discussion: s.discussion.map(m => ({ ...m, contextCurrent: m.inputVersion === s.inputVersion })),
      participants: this.db.prepare('SELECT p.id, p.name, p.role FROM participants p WHERE EXISTS (SELECT 1 FROM events e WHERE e.case_id = ? AND e.actor = p.id) ORDER BY p.joined_at DESC LIMIT 30').all(id),
      events: this.db.prepare('SELECT seq, actor, action, at, details FROM events WHERE case_id = ? ORDER BY seq DESC LIMIT 100').all(id).map(e => ({ ...e, details: JSON.parse(e.details) })) };
  }
  command(id, action, body, actor) {
    if (!ALLOWED[action]) throw new InputError('未知操作');
    if (!actor || !['facilitator', 'contributor'].includes(actor.role)) throw new InputError('当前角色只能读取', 403, 'FORBIDDEN');
    if (action === 'decide' && actor.role !== 'facilitator') throw new InputError('只有协调者可以确认选择', 403, 'HUMAN_DECISION_REQUIRED');
    object(body, ['requestId', 'expectedRevision', ...ALLOWED[action]], '请求');
    text(body.requestId, '请求标识', 8, 128);
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) throw new InputError('需要有效的当前修订号');
    const digest = createHash('sha256').update(JSON.stringify(canonical({ id, action, body, actor: actor.id }))).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.db.prepare('SELECT * FROM commands WHERE id = ?').get(body.requestId);
      if (prior) {
        if (prior.actor !== actor.id || prior.digest !== digest) throw new InputError('请求标识已用于其他操作', 409, 'REQUEST_CONFLICT');
        this.db.exec('COMMIT');
        return { ...JSON.parse(prior.response), replayed: true };
      }
      const s = this.raw(id);
      if (s.revision !== body.expectedRevision) throw new InputError('状态已更新，请刷新后再操作', 409, 'REVISION_CONFLICT');
      this.db.prepare('INSERT OR IGNORE INTO participants VALUES (?, ?, ?, ?)').run(actor.id, actor.displayName ?? actor.id, actor.role, new Date().toISOString());
      const at = new Date().toISOString();
      let details;
      if (action === 'analyze') {
        validatePreferences(body.weights, body.limits);
        if (JSON.stringify(canonical(s.weights)) !== JSON.stringify(canonical(body.weights)) || JSON.stringify(canonical(s.limits)) !== JSON.stringify(canonical(body.limits))) s.inputVersion++;
        s.weights = { ...body.weights }; s.limits = { ...body.limits };
        s.analysis = evaluate(s);
        details = { analysisId: s.analysis.id, inputVersion: s.inputVersion, recommendedId: s.analysis.recommendedId, eligible: s.analysis.candidates.filter(c => c.eligible).length };
      } else if (action === 'evidence') {
        const c = s.candidates.find(c => c.id === body.candidateId);
        if (!c) throw new InputError('方案不存在', 404, 'NOT_FOUND');
        if (![...OBJECTIVES.map(o => o.metric), 'informationCompleteness'].includes(body.field)) throw new InputError('未声明的指标');
        const note = text(body.note, '修订依据');
        if (body.value !== null) percentage(body.value, '模拟指标');
        const target = body.field === 'informationCompleteness' ? c : c.metrics;
        details = { id: randomUUID(), candidateId: c.id, field: body.field, before: target[body.field], value: body.value, note, sourceMode: 'synthetic', actor: actor.id, at };
        target[body.field] = body.value;
        s.evidenceChanges.push(details); s.inputVersion++;
      } else if (action === 'decide') {
        const reason = text(body.reason, '决定依据');
        if (!['choose', 'defer'].includes(body.outcome)) throw new InputError('决定必须为选择或暂缓');
        if (!s.analysis || s.analysis.inputVersion !== s.inputVersion) throw new InputError('请先按当前输入完成比较', 409, 'STALE_ANALYSIS');
        if (body.outcome === 'choose') {
          const c = evaluate(s).candidates.find(c => c.id === body.candidateId);
          if (!c || !c.eligible) throw new InputError('方案未通过硬约束或证据检查', 409, 'CONSTRAINT_BLOCKED');
        } else if (body.candidateId !== null) throw new InputError('暂缓时不应绑定方案');
        details = { id: randomUUID(), outcome: body.outcome, candidateId: body.candidateId, reason, actor: actor.id, analysisId: s.analysis.id, inputVersion: s.inputVersion, at, sourceMode: 'synthetic' };
        s.decisions.push(details);
      } else if (action === 'feedback') {
        if (!s.analysis) throw new InputError('请先完成一次方案比较', 409, 'ANALYSIS_REQUIRED');
        if (!['useful', 'adjust_priorities', 'wrong_assumption'].includes(body.verdict)) throw new InputError('未知反馈类型');
        details = { id: randomUUID(), verdict: body.verdict, note: text(body.note, '反馈内容'), analysisId: s.analysis.id, inputVersion: s.inputVersion, actor: actor.id, at };
        s.feedback.push(details);
      } else {
        const content = text(action === 'ask' ? body.question : body.message, action === 'ask' ? '助手问题' : '讨论内容');
        if (action === 'ask' && !Object.hasOwn(ASSISTANTS, body.assistantId)) throw new InputError('未知模拟助手');
        const human = { id: randomUUID(), kind: 'human', author: actor.displayName ?? actor.id, actorId: actor.id, role: actor.role, content, inputVersion: s.inputVersion, at };
        s.discussion.push(human);
        details = { messageId: human.id, author: human.author };
        if (action === 'ask') {
          const response = { id: randomUUID(), kind: 'assistant', author: ASSISTANTS[body.assistantId], assistantId: body.assistantId,
            mode: 'simulated', authority: 'none', content: assistantReply(s, body.assistantId, content), inputVersion: s.inputVersion, at };
          s.discussion.push(response); details.assistantId = body.assistantId; details.mode = 'simulated';
        }
      }
      details.actorName = actor.displayName ?? actor.id;
      s.revision++;
      this.db.prepare('UPDATE cases SET state = ? WHERE id = ?').run(JSON.stringify(s), id);
      this.db.prepare('INSERT INTO events(case_id, actor, action, at, details) VALUES (?, ?, ?, ?, ?)').run(id, actor.id, action, at, JSON.stringify(details));
      const response = { ok: true, revision: s.revision, inputVersion: s.inputVersion, replayed: false };
      this.db.prepare('INSERT INTO commands VALUES (?, ?, ?, ?)').run(body.requestId, actor.id, digest, JSON.stringify(response));
      this.db.exec('COMMIT'); return response;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
}
