import { useEffect, useRef, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import type { WbClient } from '../../lib/workbench/wb-client';
import { DecisionFeedbackPanel } from './decision-feedback-panel';
import { observationAnchor, takeoffError, verifiedObservationEvidence, type AssistantObservation, type ModelAssistant } from '../../lib/workbench/takeoff-actions';

type ObservationState = {
  anchor: string; assistant: ModelAssistant; question: string; at: string;
  plain?: boolean; busy: boolean; unknown: boolean; note: string; result: AssistantObservation | null;
};
// 身份会话分区，客户切换/抽屉重新挂载不能解除 unknown 防重发锁。
const observations = new WeakMap<WbClient, Map<string, ObservationState>>();
const names: Record<ModelAssistant, string> = { business: '业务', policy: '政策', credit: '信审', commerce: '商务', asset: '资产', jianwei: '见微' };

export function AssistantObservationPanel({ wb, assistant, chat = false, mention, onOpenMaterials }: { wb: WbApi; assistant: ModelAssistant; chat?: boolean; mention?: {id: ModelAssistant; nonce: number} | null; onOpenMaterials?: () => void }) {
  const client = wb.client;
  const customerId = wb.customerId ?? '';
  const key = `${wb.session?.sessionId}:${customerId}`;
  const registry = client ? (observations.get(client) ?? new Map<string, ObservationState>()) : null;
  if (client && registry) observations.set(client, registry);
  const [state, setState] = useState<ObservationState | null>(() => registry?.get(key) ?? null);
  const [question, setQuestion] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  useEffect(() => { if (mention) setQuestion(text => `@${names[mention.id]} ${text.replace(/^@(业务|政策|信审|商务|资产|见微)\s*/, '')}`); }, [mention]);
  const [history, setHistory] = useState<ObservationState[]>(() => registry?.get(key) ? [registry.get(key)!] : []);
  const messagesRef = useRef<HTMLDivElement>(null);
  const [validation, setValidation] = useState('');
  const mounted = useRef(true);
  const currentAnchor = observationAnchor(wb.snapshot);
  const anchorRef = useRef(currentAnchor);
  anchorRef.current = currentAnchor;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  function publish(next: ObservationState) {
    registry?.set(key, next);
    if (mounted.current) {
      setState(next);
      setHistory(previous => [...previous.filter(item => item.at !== next.at), next]);
    }
  }
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history]);

  async function observe(e: React.FormEvent) {
    e.preventDefault();
    if (!client || !customerId || registry?.get(key)?.busy || registry?.get(key)?.unknown) return;
    const text = question.trim();
    if (!text || text.length > 2000) { setValidation('请输入 1–2000 字的观察问题。'); return; }
    setValidation('');
    const targetName = chat ? text.match(/^@(业务|政策|信审|商务|资产|见微)(?:\s|$)/)?.[1] : null;
    const target = (Object.keys(names) as ModelAssistant[]).find(id => names[id] === targetName) ?? assistant;
    if (chat && !targetName) {
      const pending: ObservationState = { anchor: currentAnchor, assistant, question:text, at:new Date().toISOString(), busy:true, unknown:false, note:'正在发送…', result:null, plain:true };
      publish(pending); setQuestion('');
      try {
        const receipt = await client.sendMessage(customerId, {requestId:crypto.randomUUID(), audience:'internal', text, internalContent:true});
        const delivery = receipt.delivery?.state;
        publish({...pending,busy:false,unknown:!['delivered','sent','failed'].includes(delivery),note:delivery === 'delivered' || delivery === 'sent' ? '消息已送达' : delivery === 'failed' ? '消息发送失败' : '消息送达状态未知，请先核对记录。'});
      } catch (error) {
        const problem = takeoffError(error);
        publish({...pending,busy:false,unknown:problem.unknown,note:problem.message});
      }
      return;
    }
    const started: ObservationState = { anchor: currentAnchor, assistant: target, question: text, at: new Date().toISOString(), busy: true, unknown: false, note: '正在等待完整结果（非流式），通常需 10–60 秒。离开页面不会取消服务端调用。', result: null };
    publish(started);
    if (chat) setQuestion('');
    try {
      const result = await client.observeAssistant(customerId, target, text);
      const unknown = result.model.status === 'unknown' || result.model.sent === null;
      if (unknown) {
        publish({ ...started, busy: false, unknown: true, result, note: '结果未知，费用也可能未知。已停止再次触发；请由负责人核对服务端回执，不要改写问题或切换助手重发。' });
        return;
      }
      if (result.model.status === 'failed') {
        const code = result.model.error?.code ?? 'MODEL_FAILED';
        publish({ ...started, busy: false, result, note: code === 'BUDGET_EXCEEDED' ? '模型预算门已关闭，本次未发送。' : `观察未成功（${code}）；不影响规则简报和人工办理。` });
        return;
      }
      if (result.model.receiptVersion !== 2 || !/^[a-f0-9]{64}$/.test(result.model.contextHash ?? '') ||
        !/^[a-f0-9]{64}$/.test(result.model.configHash ?? '')) {
        publish({ ...started, busy: false, result, note: '收到未核验回执；接口缺少完整身份与当前性证明，暂不展示输出。' });
        return;
      }
      if (result.model.current !== true) {
        publish({ ...started, busy: false, result, note: '服务端确认依据已变化或结果不可用，本次输出已隐藏。刷新工作台后再核对。' });
        return;
      }
      try {
        const fresh = await client.workspace(customerId);
        const snap = fresh.snapshot as typeof wb.snapshot;
        const inputVersion = snap?.admission?.inputVersion;
        if (observationAnchor(snap) !== started.anchor || anchorRef.current !== started.anchor ||
          (inputVersion != null && String(inputVersion) !== result.model.contextVersion)) {
          publish({ ...started, busy: false, result, note: '需求、候选或证据版本已变化，本次输出已隐藏。核对当前工作台后再提出新观察。' });
          if (mounted.current) await wb.refresh();
          return;
        }
        publish({ ...started, busy: false, result, note: '' });
      } catch {
        publish({ ...started, busy: false, result, note: '已取得模型回执，但未能核对最新工作台，暂不展示输出。请刷新工作台并核对回执。' });
      }
    } catch (e) {
      const problem = takeoffError(e);
      const definitelyNotSent = ['MODEL_NOT_CONFIGURED', 'UPSTREAM_UNKNOWN', 'NO_SESSION', 'SESSION_REQUIRED', 'FORBIDDEN', 'NOT_FOUND', 'INVALID_QUESTION', 'INVALID_ASSISTANT'].includes(problem.code);
      const unknown = !definitelyNotSent && problem.unknown;
      publish({ ...started, busy: false, unknown, note: unknown
        ? '连接中断或等待超时，发送与结果未知。已停止再次触发；关闭页面不表示取消，请核对服务端回执。'
        : problem.code === 'UPSTREAM_UNKNOWN' ? '工作台上下文读取失败，模型未发起。请先恢复工作台连接。'
        : `${problem.message}（${problem.code}）` });
    }
  }

  const changed = Boolean(state && state.anchor !== currentAnchor);
  const result = state?.result;
  const showOutput = result && !changed && !state?.note && !state?.unknown && ['succeeded', 'simulated'].includes(result.model.status);
  if (chat) return <div className="tk-clean-chat">
    <div className="tk-chat-messages" ref={messagesRef} role="log" aria-label="助手对话" aria-live="polite">
      {history.length === 0 && <p className="tk-chat-empty">有什么想了解的？</p>}
      {history.map(item => {
        const available = item.result && item.anchor === currentAnchor && !item.note && !item.unknown && item.result.model.status === 'succeeded';
        return <div className="tk-chat-turn" key={item.at}>
          <div className="tk-chat-bubble mine">{item.question}</div>
          <div className="tk-chat-speaker">{item.plain ? "内部消息" : names[item.assistant]} <button type="button" className="tk-quote-message" aria-label="引用这条消息" onClick={() => setQuestion(`「${item.question.slice(0,500)}」\n`)}>引用</button></div>
          <div className="tk-chat-bubble">
            {item.plain ? item.note : item.busy ? '正在思考…' : available ? <>
              {item.result!.observations.map((value, index) => <p key={index}>{value.text}</p>)}
              {item.result!.questions.map((value, index) => <p key={`q-${index}`}>{value.text}</p>)}
              {verifiedObservationEvidence(item.result!).length > 0 && <details className="tk-chat-sources"><summary>查看依据</summary>
                {verifiedObservationEvidence(item.result!).map(ref => <p key={ref.id}>{ref.text}</p>)}
              </details>}
            </> : item.anchor !== currentAnchor ? '材料已更新，请重新提问。' : item.result?.model.status === 'simulated' ? '真实模型尚未接通，请联系负责人。' : item.note || '暂未取得可用回复。'}
          </div>
        </div>;
      })}
    </div>
    <div className="tk-chat-tools" role="toolbar" aria-label="聊天工具">
      <button type="button" aria-label="语音输入（尚未接通）" title="语音输入尚未接通" disabled>♩</button>
      <button type="button" aria-label="表情" title="表情" aria-expanded={emojiOpen} onClick={() => setEmojiOpen(v => !v)}>☺</button>
      <button type="button" aria-label="上传文件" title="上传文件" onClick={onOpenMaterials} disabled={!onOpenMaterials}>＋</button>
      <button type="button" aria-label="电话（尚未接通）" title="电话尚未接通" disabled>☎</button>
      <button type="button" aria-label="扫码（尚未接通）" title="扫码尚未接通" disabled>▦</button>
      <button type="button" aria-label="引用最近消息" title="引用最近消息" disabled={!history.length} onClick={() => setQuestion(`「${history[history.length-1].question.slice(0,500)}」\n`)}>❞</button>
      <button type="button" aria-label="点名当前助手" title={`@${names[assistant]}`} onClick={() => setQuestion(text => `@${names[assistant]} ${text.replace(/^@(业务|政策|信审|商务|资产|见微)\s*/, '')}`)}>＠</button>
    </div>
    {emojiOpen && <div className="tk-chat-emojis">{['😀','👍','🙏','✅','❤️','🤔'].map(emoji => <button type="button" key={emoji} onClick={() => {setQuestion(text => text + emoji);setEmojiOpen(false);}}>{emoji}</button>)}</div>}
    <form className="tk-chat-composer" onSubmit={e => void observe(e)}>
      <textarea aria-label="聊天消息" placeholder="发消息，@ 点名助手…" maxLength={2000} value={question}
        disabled={state?.busy || state?.unknown} onChange={e => setQuestion(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}/>
      <button type="submit" aria-label="发送消息" title="发送" disabled={!question.trim() || !client || !wb.snapshot || state?.busy || state?.unknown}>↑</button>
      {validation && <p role="alert">{validation}</p>}
    </form>
  </div>;
  return <><DecisionFeedbackPanel key={`${key}:${assistant}`} wb={wb} assistant={assistant} /><details className="tk-model-panel">
    <summary>模型辅助观察</summary>
    <p className="tk-asst-note">基于获准材料片段的辅助观察；引用可追溯不代表结论已核实，不产生审批或业务决定。</p>
    <form onSubmit={(e) => void observe(e)}>
      <label>给{names[assistant]}助手的问题<textarea aria-label="模型观察问题" maxLength={2000} value={question} onChange={(e) => setQuestion(e.target.value)} disabled={state?.busy || state?.unknown} /></label>
      <button className="tk-btn small" type="submit" disabled={!client || !wb.snapshot || state?.busy || state?.unknown}>{state?.busy ? '等待模型结果…' : '获取模型观察'}</button>
    </form>
    {validation && <p role="alert">{validation}</p>}
    {state && <article aria-label="模型观察回执" aria-live="polite">
      <p className="tk-meta">{names[state.assistant]}助手 · {new Date(state.at).toLocaleTimeString('zh-CN', { hour12: false })}</p>
      {changed && <p role="status">工作台依据已变化，旧观察不再展示为当前结果。</p>}
      {state.note && <p role="status">{state.note}</p>}
      {showOutput && <>
        <strong>{result.model.status === 'simulated' ? '模拟输出（离线替身）' : '模型辅助观察'}</strong>
        {result.observations.map((item, i) => <p key={`o-${i}`} className="tk-model-text">{item.text}</p>)}
        {result.questions.length > 0 && <><strong>待核验问题</strong>{result.questions.map((item, i) => <p key={`q-${i}`} className="tk-model-text">{item.text}</p>)}</>}
        {verifiedObservationEvidence(result).map(ref => <details key={ref.id} className="tk-technical">
          <summary>查看引用片段 · {ref.locator.kind === 'page_text' ? `第 ${ref.locator.page} 页` : '提取文本位置'} · {ref.locator.start}–{ref.locator.end}</summary>
          <p className="tk-model-text">{ref.text}</p>
        </details>)}
        {!verifiedObservationEvidence(result).length && <p className="tk-asst-note">无原件证据引用通过服务端核验；文字中的编号不视为已核验来源。</p>}
      </>}
      <details className="tk-technical"><summary>回执与权限边界</summary>
        <p>仅供辅助参考，正式结论由有权人员确认。</p>
        <p>客户：{wb.snapshot?.customer?.displayName ?? '当前客户'}</p>
        <p>发送状态：{result ? String(result.model.sent) : '未知'} · 结果：{result?.model.status ?? (state.busy ? '等待' : '未知')}</p>
        <p>来源：{result?.model.source?.mode ?? '未知'} · {result?.model.source?.model ?? '未知'}</p>
        <p>当时提问：{state.question}</p>
      </details>
    </article>}
  </details></>;
}
