import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type Candidate, type Limits, type Role, type Scenario, type Session, type Summary, type Weights } from './api.ts';
import './style.css';

const roles: { id: Role; title: string; detail: string; mark: string }[] = [
  { id: 'facilitator', title: '协调者', detail: '设定目标、比较方案并留下人工决定。', mark: '◎' },
  { id: 'contributor', title: '参与者', detail: '参与讨论、提问助手、补充信息与目标偏好。', mark: '◇' },
  { id: 'observer', title: '观察者', detail: '查看目标、方案、证据和决定记录。', mark: '◌' },
];
const labels: Record<string, string> = { pending: '待比较', decided: '已人工选择', deferred: '已暂缓', needs_review: '需重新复核' };
const actionLabels: Record<string, string> = { analyze: '完成目标比较', evidence: '修订模拟假设', decide: '记录人工决定', feedback: '提交复核反馈', discuss: '记录参与者意见', ask: '与模拟助手交互' };
const metricLabels: Record<string, string> = { impactScore: '目标效果', effortPoints: '投入程度', flexibilityScore: '可调整性', dependencyScore: '依赖程度', informationCompleteness: '信息完整度' };
const metricValue = (key: string, n: number | null | undefined) => typeof n === 'number' ? `${n}${key === 'informationCompleteness' ? '%' : ' 分'}` : '未提供';
const time = (s: string) => new Date(s).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const weightDefaults: Weights = { impact: 40, effort: 30, flexibility: 20, independence: 10 };
const limitDefaults: Limits = { maxEffortPoints: 70, minFlexibilityScore: 40, maxDependencyScore: 60, minInformationPct: 80 };

export function TradeoffPlot({ candidates, selected, onSelect }: { candidates: Candidate[]; selected: string; onSelect: (id: string) => void }) {
  const points = candidates.filter(c => c.metrics.impactScore !== null && c.metrics.effortPoints !== null);
  return <figure className="plot"><figcaption>效果与投入程度 <span>越靠左，投入程度越低</span></figcaption>
    <svg viewBox="0 0 440 190" role="img" aria-label="方案的效果与投入程度比较图">
      {[0, 50, 100].map(n => <g key={n}><line x1="46" y1={154 - n * 1.2} x2="410" y2={154 - n * 1.2} stroke="#e5e7eb" /><text x="12" y={158 - n * 1.2}>{n}</text></g>)}
      {[0, 25, 50, 75, 100].map(n => <text key={n} x={46 + n * 3.6} y="178">{n}</text>)}
      <text x="48" y="18">目标效果 ↑</text><text x="308" y="188">投入程度 →</text>
      {points.map(c => <g key={c.id} role="button" tabIndex={c.eligible ? 0 : -1} aria-label={`选择${c.name}`} aria-disabled={!c.eligible}
        onClick={() => c.eligible && onSelect(c.id)} onKeyDown={e => { if (c.eligible && ['Enter', ' '].includes(e.key)) { e.preventDefault(); onSelect(c.id); } }}>
        <circle cx={46 + c.metrics.effortPoints! * 3.6} cy={154 - c.metrics.impactScore! * 1.2} r={selected === c.id ? 8 : 5} fill={!c.eligible ? '#a3a7ad' : selected === c.id ? '#111827' : '#0f766e'} />
        <text x={c.metrics.effortPoints! > 80 ? 34 + c.metrics.effortPoints! * 3.6 : 55 + c.metrics.effortPoints! * 3.6} textAnchor={c.metrics.effortPoints! > 80 ? 'end' : 'start'} y={c.id === 'explore' ? 166 - c.metrics.impactScore! * 1.2 : 149 - c.metrics.impactScore! * 1.2}>{c.name}</text>
      </g>)}
    </svg></figure>;
}

export function App() {
  const [session, setSession] = useState<Session | null>(null), [starting, setStarting] = useState(true);
  const [cases, setCases] = useState<Summary[]>([]), [current, setCurrent] = useState<Scenario | null>(null);
  const [weights, setWeights] = useState<Weights>(weightDefaults), [limits, setLimits] = useState<Limits>(limitDefaults);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [selection, setSelection] = useState(''), [outcome, setOutcome] = useState<'choose' | 'defer'>('choose'), [reason, setReason] = useState('');
  const [evidenceCandidate, setEvidenceCandidate] = useState('explore'), [field, setField] = useState('effortPoints'), [value, setValue] = useState(''), [basis, setBasis] = useState('');
  const [verdict, setVerdict] = useState('useful'), [feedback, setFeedback] = useState('');
  const [displayName, setDisplayName] = useState('参与者甲'), [message, setMessage] = useState(''), [recipient, setRecipient] = useState('people');
  const [remoteRevision, setRemoteRevision] = useState(false);
  const active = useRef(''), readSequence = useRef(0);
  const revision = useRef(0);
  const readonly = session?.role === 'observer';

  function apply(s: Scenario, preserveDrafts = false) {
    setCurrent(s); revision.current = s.revision; setRemoteRevision(false);
    if (preserveDrafts) return;
    setWeights(s.weights); setLimits(s.limits);
    const decision = s.decisions.at(-1);
    setSelection(decision?.outcome === 'choose' && decision.inputVersion === s.inputVersion ? decision.candidateId ?? '' : s.analysis?.recommendedId ?? '');
    setOutcome('choose'); setReason(''); setBasis(''); setValue(''); setFeedback('');
    setEvidenceCandidate(s.candidates[0]?.id ?? ''); setMessage('');
  }
  async function load(id: string) {
    active.current = id; const seq = ++readSequence.current;
    setLoading(true); setError(''); setNotice(''); setCurrent(null);
    try { const data = await api<{ case: Scenario }>(`/api/cases/${id}`); if (seq === readSequence.current) apply(data.case); }
    catch (e) { if (seq === readSequence.current) setError((e as Error).message); }
    finally { if (seq === readSequence.current) setLoading(false); }
  }
  async function enter(role?: Role) {
    setBusy(true); setError('');
    try {
      const s = await api<{ session: Session }>('/api/session', role ? { role, displayName } : undefined);
      const list = await api<{ cases: Summary[] }>('/api/cases');
      setSession(s.session); setCases(list.cases);
      if (list.cases.length) await load(list.cases[0].id);
    } catch (e) { if (!(e instanceof ApiError && e.status === 401 && !role)) setError((e as Error).message); }
    finally { setBusy(false); setStarting(false); }
  }
  useEffect(() => { void enter(); }, []);
  useEffect(() => {
    if (!session) return;
    let cancelled = false, polling = false;
    const timer = setInterval(async () => {
      if (polling) return; polling = true;
      try {
        const list = await api<{ cases: Summary[] }>('/api/cases');
        if (!cancelled) {
          setCases(list.cases);
          const row = list.cases.find(c => c.id === active.current);
          if (row && row.revision > revision.current) setRemoteRevision(true);
        }
      } catch { /* Explicit refresh retains drafts if another session or server ends. */ }
      finally { polling = false; }
    }, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [session]);

  async function command(action: string, payload: Record<string, unknown>) {
    if (!current || busy || loading) return;
    const id = current.id; setBusy(true); setError(''); setNotice('');
    try {
      await api(`/api/cases/${id}/${action}`, { ...payload, requestId: crypto.randomUUID(), expectedRevision: current.revision });
      const [detail, list] = await Promise.all([api<{ case: Scenario }>(`/api/cases/${id}`), api<{ cases: Summary[] }>('/api/cases')]);
      setCases(list.cases);
      if (active.current === id) {
        apply(detail.case, ['discuss', 'ask', 'feedback'].includes(action));
        if (['discuss', 'ask'].includes(action)) setMessage('');
        if (action === 'feedback') setFeedback('');
        setNotice(`${actionLabels[action]}，记录已保存。`);
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const candidates = current?.analysis && !current.analysisStale ? current.analysis.candidates : [];
  const selected = candidates.find(c => c.id === selection);
  const lastDecision = current?.decisions.at(-1);
  const canDecide = session?.role === 'facilitator' && !!current?.analysis && !current.analysisStale && (outcome === 'defer' || selected?.eligible);
  const dirty = current && (JSON.stringify(weights) !== JSON.stringify(current.weights) || JSON.stringify(limits) !== JSON.stringify(current.limits));

  if (!session) return <main className="entry"><div className="wordmark"><span className="symbol">◉</span> HUMAN AGENT LOOP</div><div className="entry-copy"><span className="eyebrow">HUMAN-CENTERED DECISIONS</span><h1>先看清取舍，<br />再由人决定。</h1><p>多个人类与模拟助手共用一份讨论、方案和决定记录。看清不同目标的取舍，再由人确认。</p><span className="simulation">全部使用合成假设 · 无外部执行</span></div>
    {error && <div role="alert" className="error">{error}</div>}
    <label className="participant-name field-label">你的模拟参与者代号<input aria-label="参与者代号" value={displayName} maxLength={40} onChange={e => setDisplayName(e.target.value)} placeholder="例如：参与者甲，请勿填写真实个人资料" /></label>
    <div className="role-grid">{roles.map(r => <button key={r.id} className="role-card" disabled={busy || starting || !displayName.trim()} onClick={() => void enter(r.id)}><span className="role-mark">{r.mark}</span><strong>{r.title}</strong><span>{r.detail}</span><b>进入模拟 →</b></button>)}</div>
    <p className="entry-note">角色选择仅用于本机模拟，不代表真实身份认证或业务授权。</p></main>;

  return <div className="shell"><aside className="sidebar"><div className="wordmark"><span className="symbol">◉</span><span>HUMAN<br />AGENT LOOP</span></div><div className="nav-heading">模拟情景 <span>{cases.length}</span></div>
    <nav aria-label="模拟情景">{cases.map((c, i) => <button className={`case-link ${active.current === c.id ? 'active' : ''}`} key={c.id} disabled={busy} onClick={() => void load(c.id)}><span className="case-number">0{i + 1}</span><span><strong>{c.title}</strong><small>{labels[c.status]}</small></span></button>)}</nav>
    <div className="sidebar-bottom"><span className="simulation">仅限模拟研究</span><p>不使用真实人员资料，<br />不执行实际外部操作。</p><button className="quiet" disabled={busy} onClick={() => { readSequence.current++; active.current = ''; setSession(null); setCurrent(null); setNotice(''); setError(''); }}>切换模拟角色 ↗</button></div></aside>
    <main className="workspace"><header className="topbar"><span>模拟协作决策 <span className="slash">/</span> 多目标工作台</span><span className="role-pill">{session.displayName} · {session.label}</span></header>
      {error && <div role="alert" className="error">{error}<button className="quiet" disabled={busy} onClick={() => active.current && void load(active.current)}>刷新当前情景</button></div>}
      {notice && <div role="status" className="notice">{notice}</div>}
      {remoteRevision && <div role="status" className="review-banner update-banner">其他参与者更新了这个情景。当前输入草稿保留，请刷新后继续操作。<button className="quiet" disabled={busy} onClick={() => void load(active.current)}>读取最新共同记录</button></div>}
      {loading && <div className="loading" role="status">正在读取模拟记录…</div>}
      {!loading && current && <><section className="page-heading"><div><span className="eyebrow">{current.category} · SYNTHETIC SCENARIO</span><h1>{current.title}</h1><p>{current.question}</p></div><span className="outline-pill">{current.decisions.length && current.decisionNeedsReview ? '输入已变更 · 需复核' : lastDecision ? lastDecision.outcome === 'choose' ? '人工已选择' : '人工已暂缓' : '等待人工判断'}</span></section>
        <div className="disclaimer">所有数值均为公开合成假设。比较得分不是概率、置信度或实际行动承诺。</div>
        <div className="work-grid"><div className="main-column"><section className="panel discussion-panel"><div className="section-heading"><div><span className="step">◎</span><h2>人和助手一起讨论</h2></div><span className="tag">模拟助手 · 非真实模型</span></div>
          <div className="participants" aria-label="模拟参与记录">{current.participants.map(p => <span key={p.id}>{p.name}<small>{roles.find(r => r.id === p.role)?.title}</small></span>)}<span className="assistant-chip">规划助手</span><span className="assistant-chip">质疑助手</span><span className="assistant-chip">归纳助手</span></div>
          <div className="discussion" role="log" aria-label="共同讨论记录">{!current.discussion.length ? <div className="discussion-empty">先说说你在意什么，再邀请助手解释取舍或质疑假设。<small>不同浏览器会话可以作为不同模拟参与者，共享同一份讨论与决定记录。</small></div> : current.discussion.slice(-30).map(m => <article className={`message ${m.kind}`} key={m.id}><header><strong>{m.author}</strong><span>{m.kind === 'assistant' ? '规则生成的模拟回复' : '人的意见'} · {time(m.at)}</span></header><p>{m.content}</p>{m.kind === 'assistant' && !m.contextCurrent && <small className="stale-message">此回复基于较早的假设，需结合最新信息复核。</small>}</article>)}</div>
          {!readonly && <form className="discussion-form" onSubmit={e => { e.preventDefault(); void command(recipient === 'people' ? 'discuss' : 'ask', recipient === 'people' ? { message } : { assistantId: recipient, question: message }); }}><label className="field-label">发给<select aria-label="讨论对象" value={recipient} onChange={e => setRecipient(e.target.value)}><option value="people">所有参与者</option><option value="planner">规划助手 · 梳理目标与方案</option><option value="challenger">质疑助手 · 检查假设与缺口</option><option value="summarizer">归纳助手 · 整理意见与决定</option></select></label><label className="field-label">你的意见或问题<textarea aria-label="讨论内容" value={message} maxLength={800} onChange={e => setMessage(e.target.value)} placeholder="例如：我更看重可调整性。请解释轻量探索与均衡推进的取舍。" /></label><div className="panel-actions"><span className="hint">助手只读取已保存的共同记录，不替人确认，也不表示大家已达成共识。</span><button className="secondary" disabled={busy || remoteRevision || message.trim().length < 2}>{recipient === 'people' ? '发送给大家' : '提问模拟助手'}</button></div></form>}
        </section><section className="panel"><div className="section-heading"><div><span className="step">01</span><h2>明确共同目标</h2></div><span className="hint">权重自动归一化</span></div><p className="section-copy">{current.description}</p>
          <div className="objective-grid">{current.objectives.map(o => <label key={o.id} className="objective"><span>{o.label}<b>{weights[o.id]}</b></span><input aria-label={`${o.label}权重`} type="range" min="0" max="100" value={weights[o.id]} disabled={readonly || busy} onChange={e => setWeights(w => ({ ...w, [o.id]: Number(e.target.value) }))} /><small>{o.direction === 'max' ? '越高越好' : o.id === 'effort' ? '所需投入越少越好' : '所需依赖越少越好'}</small></label>)}</div>
          <details className="constraints" open><summary>硬约束 <span>高分不能覆盖边界</span></summary><div className="constraint-grid">{([
            ['maxEffortPoints', '投入程度上限'], ['minFlexibilityScore', '可调整性下限'], ['maxDependencyScore', '依赖程度上限'], ['minInformationPct', '信息完整度下限'],
          ] as [keyof Limits, string][]).map(([key, label]) => <label key={key}>{label}<span><input aria-label={label} type="number" min="0" max="100" value={limits[key]} disabled={readonly || busy} onChange={e => setLimits(x => ({ ...x, [key]: Number(e.target.value) }))} />{key === 'minInformationPct' ? '%' : '分'}</span></label>)}</div></details>
          <div className="panel-actions"><span className="hint">{readonly ? '观察者可查看；分析与修改需要其他模拟角色。' : dirty ? '目标或边界已修改，请重新比较。' : '可调整目标和边界，观察选择如何变化。'}</span><button className="primary" disabled={readonly || busy || Object.values(weights).every(v => v === 0)} onClick={() => void command('analyze', { weights, limits })}>{busy ? '正在保存…' : '比较模拟方案 →'}</button></div>
        </section>
        <section className="panel"><div className="section-heading"><div><span className="step">02</span><h2>看清方案之间的取舍</h2></div><span className="hint">系统推荐不构成人工决定</span></div>
          {!current.analysis ? <div className="empty">设定目标后，点击“比较模拟方案”。<small>不会自动替你作出决定。</small></div> : current.analysisStale ? <div className="review-banner">模拟假设已变化，之前的比较已过期。请重新比较；历史决定仍然保留。</div> : <>
            <TradeoffPlot candidates={candidates} selected={selection} onSelect={setSelection} />
            <div className="candidate-grid">{candidates.map(c => <label key={c.id} className={`candidate ${selection === c.id && c.eligible ? 'selected' : ''} ${!c.eligible ? 'blocked' : ''}`}><div className="candidate-title"><strong>{c.name}</strong><input aria-label={`选择方案：${c.name}`} type="radio" name="candidate" checked={selection === c.id} disabled={!c.eligible || readonly || busy} onChange={() => setSelection(c.id)} /></div><p>{c.description}</p><div className="candidate-badges">{c.id === current.analysis?.recommendedId && <span className="tag dark">当前权重首选</span>}{c.eligible && c.pareto && <span className="tag">Pareto 可行前沿</span>}{!c.eligible && <span className="tag warning">暂不可选</span>}</div>
              <div className="score"><strong>{c.score?.toFixed(1) ?? '—'}</strong><span>目标效用 / 100</span></div>
              <dl className="metrics">{Object.entries(c.metrics).map(([key, n]) => <div key={key}><dt>{metricLabels[key]}</dt><dd>{metricValue(key, n)}</dd></div>)}<div><dt>信息完整度</dt><dd>{metricValue('informationCompleteness', c.informationCompleteness)}</dd></div></dl>
              {!!c.blockers.length && <ul className="blockers">{c.blockers.map(b => <li key={b}>{b}</li>)}</ul>}
            </label>)}</div><p className="method">{current.analysis.explanation}</p>
          </>}
        </section>
        <section className="panel"><div className="section-heading"><div><span className="step">03</span><h2>由人确认选择</h2></div><span className="hint">决定与计算结果分别记录</span></div>
          {lastDecision && <div className={`decision-record ${current.decisionNeedsReview ? 'needs-review' : ''}`}><strong>{current.decisionNeedsReview ? '原决定需复核' : lastDecision.outcome === 'choose' ? `已选择：${current.candidates.find(c => c.id === lastDecision.candidateId)?.name}` : '已明确暂缓'}</strong><p>{lastDecision.reason}</p><small>{lastDecision.actorName} · {time(lastDecision.at)} · 历史记录保留</small></div>}
          {session.role === 'facilitator' ? <><div className="decision-mode"><label><input type="radio" name="outcome" checked={outcome === 'choose'} onChange={() => setOutcome('choose')} /> 选择当前方案{selected && ` · ${selected.name}`}</label><label><input type="radio" name="outcome" checked={outcome === 'defer'} onChange={() => setOutcome('defer')} /> 暂缓决定</label></div><label className="field-label">人工决定依据<textarea aria-label="人工决定依据" value={reason} maxLength={800} onChange={e => setReason(e.target.value)} placeholder="说明你接受的取舍、仍然存在的不确定性，或暂缓的原因。" /></label><div className="panel-actions"><span className="hint">{dirty ? '界面目标已修改，先重新比较后才能确认。' : '提交后保存当前依据与操作者；后续变更将提示复核。'}</span><button className="primary" disabled={!canDecide || !!dirty || busy || reason.trim().length < 2} onClick={() => void command('decide', { outcome, candidateId: outcome === 'choose' ? selection : null, reason })}>{outcome === 'choose' ? '确认模拟选择' : '记录暂缓决定'}</button></div></> : <p className="section-copy">当前角色可以复核或查看；人工选择由协调者确认。</p>}
        </section></div>
        <aside className="support-column"><section className="panel evidence-panel"><div className="section-heading"><h2>模拟证据与假设</h2><span className="tag">{current.evidenceChanges.length} 次修订</span></div>{current.evidence.map(e => <div className="source-card" key={e.id}><strong>{e.title}</strong><p>{e.note}</p></div>)}
          {!readonly && <form onSubmit={e => { e.preventDefault(); if (value.trim() === '') return; const parsed = value.trim() === 'unknown' ? null : Number(value); if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0 || parsed > 100)) { setError('请输入 0–100 的数值，或用 unknown 表示未知。'); return; } void command('evidence', { candidateId: evidenceCandidate, field, value: parsed, note: basis }); }}>
            <label className="field-label">修订方案<select aria-label="修订方案" value={evidenceCandidate} onChange={e => setEvidenceCandidate(e.target.value)}>{current.candidates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="field-label">模拟指标<select aria-label="模拟指标" value={field} onChange={e => setField(e.target.value)}>{Object.entries(metricLabels).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
            <label className="field-label">修订值<input aria-label="修订值" type="text" inputMode="decimal" value={value} maxLength={16} onChange={e => setValue(e.target.value)} placeholder="0–100；unknown 表示未知" /></label>
            <label className="field-label">修订依据<textarea aria-label="修订依据" value={basis} maxLength={800} onChange={e => setBasis(e.target.value)} placeholder="仅记录本次模拟假设的改变及其原因。" /></label><button className="secondary full" disabled={busy || !value.trim() || basis.trim().length < 2}>保存模拟修订</button><p className="hint">修订会使旧比较过期，不自动推进人工决定。</p>
          </form>}
          {!!current.evidenceChanges.length && <details><summary>查看修订记录</summary>{current.evidenceChanges.slice().reverse().slice(0, 8).map(e => <div className="history-item" key={e.id}><strong>{metricLabels[e.field]} · {metricValue(e.field, e.before)} → {metricValue(e.field, e.value)}</strong><p>{e.note}</p><small>{time(e.at)}</small></div>)}</details>}
        </section>
        <section className="panel"><div className="section-heading"><h2>反馈与复核</h2></div><p className="section-copy">反馈用于留痕和下一轮调整，不自动学习或修改规则。</p>{!readonly && <form onSubmit={e => { e.preventDefault(); void command('feedback', { verdict, note: feedback }); }}><label className="field-label">反馈类型<select aria-label="反馈类型" value={verdict} onChange={e => setVerdict(e.target.value)}><option value="useful">比较有帮助</option><option value="adjust_priorities">需要调整目标权重</option><option value="wrong_assumption">需要修正模拟假设</option></select></label><label className="field-label">复核意见<textarea aria-label="复核意见" value={feedback} maxLength={800} onChange={e => setFeedback(e.target.value)} placeholder="哪些取舍值得保留，哪些依据需要重新检查？" /></label><button className="secondary full" disabled={busy || !current.analysis || feedback.trim().length < 2}>记录反馈</button></form>}{current.feedback.slice().reverse().slice(0, 4).map(f => <div className="history-item" key={f.id}><p>{f.note}</p><small>{time(f.at)}</small></div>)}</section>
        <section className="panel"><div className="section-heading"><h2>决定轨迹</h2><span className="hint">{current.events.length} 条</span></div>{!current.events.length ? <p className="hint">完成比较、修订或人工决定后，记录将在这里显示。</p> : <ol className="timeline">{current.events.slice(0, 12).map(e => <li key={e.seq}><strong>{actionLabels[e.action]}</strong><small>{time(e.at)}</small></li>)}</ol>}</section>
        </aside></div></>}
      <footer>人设目标，人定边界，人作决定。<span>合成协作场景 · 不连接外部执行</span></footer>
    </main></div>;
}
