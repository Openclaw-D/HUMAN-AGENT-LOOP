import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import { observationAnchor, type ModelAssistant } from '../../lib/workbench/takeoff-actions';
import type { DecisionResponse, FeedbackCommand } from '../../lib/workbench/decision-feedback';
import './decision-feedback.css';

function evidenceName(text: string, index: number): string {
  return /(?:^|\s)D\d{2}\s+([^\r\n]{1,40}?)(?=\s*主体[：:]|\r?\n|$)/.exec(text)?.[1]?.trim() || `原件 ${index + 1}`;
}

export interface DecisionPanelActions { selectCandidate: (id: string) => void }
export function DecisionFeedbackPanel({ wb, assistant, requiredQuestion, onStateChange, actionsRef, renderCandidates = true }: {
  wb: WbApi; assistant: ModelAssistant; requiredQuestion?: string;
  onStateChange?: (value: DecisionResponse['latest'], available: boolean) => void;
  actionsRef?: Ref<DecisionPanelActions>; renderCandidates?: boolean;
}) {
  const client = wb.client, customerId = wb.customerId;
  const [data, setData] = useState<DecisionResponse | null>(null);
  const [question, setQuestion] = useState(requiredQuestion ?? '基于当前材料，下一步优先核对什么？');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [note, setNote] = useState('正在读取候选与反馈…');
  const alive = useRef(true), inFlight = useRef(false);
  const anchor = observationAnchor(wb.snapshot);
  const anchorRef = useRef(anchor); anchorRef.current = anchor;
  const generation = useRef(0);

  function failure(error: unknown) {
    const code = (error as { code?: string }).code ?? 'NETWORK_UNKNOWN';
    const messages: Record<string, string> = {
      MODEL_NOT_CONFIGURED: '候选分析尚未接通模型服务。',
      DECISION_STORAGE_REQUIRED: '候选反馈服务尚未启用持久记录。',
      DECISION_UNAVAILABLE: '建议暂时不可用，请稍后刷新。',
      EVIDENCE_UNAVAILABLE: '当前没有可用于判断的获准原件，请先补充材料。',
      FORBIDDEN: '当前身份不能查看或记录这组候选。',
      VERSION_CONFLICT: '记录已变化，请先读取最新反馈再选择。',
      DECISION_STALE: '材料或候选已变化，请读取最新状态。',
      DECISION_PENDING: '已有一次分析尚未取得确定结果，请先核对回执。',
      DECISION_SEND_UNKNOWN: '分析结果还未确认。系统已保留本次请求，请先刷新查看进展。',
      EVIDENCE_MISSING: '还有必要材料未收到，请先补充材料。',
      EVIDENCE_NOT_AUTHORIZED: '材料尚未获得分析授权，请联系负责同事核对。',
      INVALID_RESPONSE: '返回内容未通过核对，暂不显示建议。请刷新后重试。',
    };
    return messages[code] ?? '本次结果尚未确认，请刷新查看进展，暂勿重复提交。';
  }
  async function checked(value: DecisionResponse, startAnchor: string) {
    const fresh = await client!.workspace(customerId!);
    if (observationAnchor(fresh.snapshot) !== startAnchor || anchorRef.current !== startAnchor) {
      return { ...value, latest: value.latest ? { ...value.latest, current: false, candidates: [], evidenceRefs: [] } : null };
    }
    return value;
  }
  async function read() {
    if (!client || !customerId || !wb.snapshot || inFlight.current) return;
    const epoch = ++generation.current, startAnchor = anchorRef.current;
    inFlight.current = true; setBusy(true); setReady(false);
    try {
      const result = await checked(await client.readDecisions(customerId, assistant), startAnchor);
      if (!alive.current || epoch !== generation.current) return;
      displayedAnchor.current = startAnchor;
      setData(result); setReady(true); setNote('');
      if (result.latest && !requiredQuestion) setQuestion(result.latest.question);
    } catch (e) { if (alive.current && epoch === generation.current) { setData(null); setNote(failure(e)); } }
    finally { if (epoch === generation.current) { inFlight.current = false; if (alive.current) setBusy(false); } }
  }
  useEffect(() => {
    alive.current = true; void read();
    return () => { alive.current = false; generation.current++; inFlight.current = false; };
  }, [client, customerId, assistant, anchor]);
  // A changed workspace invalidates the displayed selection immediately, without starting a paid call.
  const displayedAnchor = useRef(anchor);
  const staleLocally = displayedAnchor.current !== anchor;

  async function analyze(reconcile = false) {
    if (!client || !customerId || !data || inFlight.current || !ready || (!reconcile && data.pending)) return;
    if (!question.trim()) { setNote('请填写需要判断的问题。'); return; }
    const epoch = generation.current, startAnchor = anchorRef.current;
    inFlight.current = true; setBusy(true); setReady(false); setNote('正在基于原件生成候选…');
    try {
      const result = await checked(await client.analyzeDecisions(customerId, {
        assistant, question: reconcile ? data.pending!.question : question.trim(), expectedRevision: data.revision,
        operationId: reconcile ? data.pending!.operationId : crypto.randomUUID(),
      }), startAnchor);
      if (!alive.current || epoch !== generation.current) return;
      displayedAnchor.current = startAnchor; setData(result); setReady(true);
      setNote(result.error ? '运行结果仍未知，已保留本次身份；请核对回执。' : '');
    } catch (e) { if (alive.current && epoch === generation.current) setNote(failure(e)); }
    finally { if (epoch === generation.current) { inFlight.current = false; if (alive.current) setBusy(false); } }
  }
  async function feedback(action: FeedbackCommand['action'], candidateId?: string) {
    const set = data?.latest;
    if (!client || !customerId || !data || !set?.current || !ready || busy || inFlight.current || data.pending || staleLocally) return;
    const epoch = generation.current, startAnchor = anchorRef.current;
    inFlight.current = true; setBusy(true); setReady(false); setNote('正在保存你的选择…');
    try {
      await client.saveDecisionFeedback(customerId, { assistant, operationId: crypto.randomUUID(),
        expectedRevision: data.revision, decisionSetId: set.id, action, candidateId: candidateId ?? null, reason });
      const result = await checked(await client.readDecisions(customerId, assistant), startAnchor);
      if (!alive.current || epoch !== generation.current) return;
      setData(result); setReady(true); setNote('已从服务端读回反馈。');
    } catch (e) { if (alive.current && epoch === generation.current) setNote(failure(e)); }
    finally { if (epoch === generation.current) { inFlight.current = false; if (alive.current) setBusy(false); } }
  }
  const set = requiredQuestion && data?.latest?.question !== requiredQuestion ? null : data?.latest;
  const current = !!set?.current && !staleLocally;
  const selected = set?.feedback ? set.feedback.candidateId : set?.candidates[0]?.id;
  const locked = busy || !ready || !current || !!data?.pending;
  useImperativeHandle(actionsRef, () => ({ selectCandidate: (id) => { void feedback('select', id); } }));
  useEffect(() => { onStateChange?.(current ? set ?? null : null, !locked); }, [set, current, locked, onStateChange]);
  return <details className="tk-decisions" aria-label="候选判断与反馈" open>
    <summary className="tk-decision-summary">{requiredQuestion ? '路径预测' : '下一步建议'}</summary>
    {!requiredQuestion && <details className="tk-question-options"><summary>换个问题</summary><label>我想了解<textarea aria-label="候选判断问题" value={question} maxLength={2000}
      disabled={busy || !!data?.pending} onChange={e => setQuestion(e.target.value)} /></label></details>}
    <div className="tk-decision-actions">
      <button type="button" className="tk-btn small" disabled={busy || !ready || !!data?.pending || !wb.snapshot}
        onClick={() => void analyze()}>{requiredQuestion ? set ? '更新路径预测' : '预测后续路径' : set ? '更新建议' : '给我建议'}</button>
      <button type="button" className="tk-btn small ghost" aria-label="刷新建议" title="刷新建议" disabled={busy || !client} onClick={() => { displayedAnchor.current = anchorRef.current; void read(); }}>↻</button>
      {data?.pending && <button type="button" className="tk-btn small" disabled={busy || !ready} onClick={() => void analyze(true)}>核对本次运行回执</button>}
    </div>
    {note && <p role="status">{note}</p>}
    {data?.pending && <p role="status">本次运行尚未结束，暂不发起新分析或反馈。</p>}
    {set && !current && <p role="status">材料已变化或本次结果未通过核验，旧候选不可选择。</p>}
    {current && set && <>
      {set.model.status === 'simulated' && <p className="tk-decision-tag">模拟模型输出 · 非真实推理</p>}
      <details className="tk-decision-evidence"><summary>查看依据 · {set.evidenceRefs.length} 份原件</summary>
        {set.evidenceRefs.map((ref, index) => <details key={ref.id}>
          <summary>{evidenceName(ref.text, index)} · {ref.locator.page ? `第 ${ref.locator.page} 页` : '原文'}</summary>
          <p>{ref.text}</p>
        </details>)}
        {set.omitted.length > 0 && <p>还有材料未纳入本次上下文，不能将未读取的信息视为不存在。</p>}
      </details>
      <details className="tk-decision-caption"><summary>置信度仅供参考</summary><p>置信度为模型估计，尚未校准；各项独立评分，不要求相加为100%。引用可追溯不代表结论已核实。</p></details>
      {renderCandidates && <div className="tk-decision-list" role="group" aria-label="选择候选建议">
        {set.candidates.map((candidate, index) => <button type="button" className="tk-decision-card" key={candidate.id}
          aria-pressed={selected === candidate.id} disabled={locked} onClick={() => void feedback('select', candidate.id)}>
          <span className="tk-decision-card-heading"><strong>{candidate.label}</strong>
            <span>{candidate.confidence === null ? '置信度未提供' : `${Math.round(candidate.confidence * 100)}%`}</span></span>
          <span>{candidate.impact}</span>
          <small>依据：{candidate.evidenceRefIds.map(id => { const index = set.evidenceRefs.findIndex(r => r.id === id); return evidenceName(set.evidenceRefs[index]?.text ?? '', index); }).join('、')}</small>
          <small>{set.feedback?.candidateId === candidate.id ? '你的选择 · 已记录' : index === 0 ? '建议首选' : `候选${index + 1}`}</small>
        </button>)}
      </div>}
      {!set.candidates.length && <p>当前没有证据支持的有效候选，请补充材料或交专业人员核对。</p>}
      <details><summary>补充选择理由</summary><label>选择理由（可选）<textarea aria-label="候选选择理由" maxLength={500} value={reason} disabled={locked} onChange={e => setReason(e.target.value)} /></label></details>
      <div className="tk-decision-actions">
        <button type="button" className="tk-btn small" disabled={locked} onClick={() => void feedback('none')}>均不合适，需要补证</button>
        {set.feedback && <button type="button" className="tk-btn small" disabled={locked} onClick={() => void feedback('undo')}>撤销我的选择</button>}
      </div>
      {set.feedback && <div className="tk-decision-selected" role="status"><strong>当前下一步：{set.feedback.label}</strong>
        <p>{set.feedback.reason || '已保留选择记录。'} 后续同客户、同问题且证据不变的分析将参考此反馈；这不是正式审批。</p></div>}
      {set.feedbackUsed && <p>本次分析已参考此前本人反馈；不代表模型权重已更新。</p>}
      <p className="tk-decision-caption">生成时间：{new Date(set.at).toLocaleString('zh-CN',{hour12:false})}</p>
    </>}
  </details>;
}
