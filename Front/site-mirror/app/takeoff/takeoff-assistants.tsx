// TAKEOFF-FA-1.0.0 · 右侧六助手与输入区（02_FRONTEND_SPEC §5）：
// 业务/政策/信审/商务/资产 + 全局见微；一个消息区、一份草稿；切换助手不丢客户/评估/格子/材料引用。
// 助手平时安静：只有相关事件、点选调用或 @ 才处理内容；六助手不等于六个常驻进程。
// 工具栏保留入口结构：已接通=上传（统一提交链）；语音/表情/字体/聊天记录/Skill/MCP/compact/ToDo/Goals
// 未接通=明确禁用并标「未接入」，不伪装成功。Enter 发送 / Shift+Enter 换行；输入法候选确认不误发送。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import type { TakeoffSource } from '../../lib/workbench/takeoff-projection';
import { mergeThread, type PendingSend, type RemoteThreadMsg } from '../../lib/workbench/wb-logic';
import {
  ASSISTANT_BRIEF_NAMES,
  composeAssistantBrief,
  composeAssistantBriefError,
  type AssistantBriefKind,
  type AssistantBriefSource,
} from '../../lib/workbench/takeoff-assistant-brief';
import { WbError } from '../workbench/wb-parts';

const ASSISTANTS = [
  { id: 'business', name: '业务' },
  { id: 'policy', name: '政策' },
  { id: 'credit', name: '信审' },
  { id: 'commerce', name: '商务' },
  { id: 'asset', name: '资产' },
  { id: 'jianwei', name: '见微' },
] as const;

type AssistantId = (typeof ASSISTANTS)[number]['id'];

const NOT_WIRED: Array<{ key: string; label: string; why: string }> = [
  { key: 'voice', label: '语音', why: '语音输入未接入' },
  { key: 'emoji', label: '表情', why: '表情未接入' },
  { key: 'font', label: '字体', why: '字体设置未接入' },
  { key: 'history', label: '聊天记录', why: '独立聊天记录检索未接入（线程已在上方完整显示）' },
  { key: 'skill', label: 'Skill', why: 'Skill 扩展未接入' },
  { key: 'mcp', label: 'MCP', why: 'MCP 未接入（不经 MCP 绕过本轮授权）' },
  { key: 'compact', label: 'compact', why: '会话摘要压缩未接入（接入后也只压缩模型摘要，不删原件/决定/审计）' },
  { key: 'todo', label: 'ToDo', why: '待办管理未接入（办理待办见顶栏「待办」入口）' },
  { key: 'goals', label: 'Goals', why: 'Goals 未接入' },
];

/** 简报数据源：与主屏同一投影快照（不复制第二套业务状态）。 */
function briefSourceOf(source: TakeoffSource): AssistantBriefSource {
  const snap = source.snapshot;
  const list = snap?.assessments ?? [];
  return {
    customerName: snap?.customer?.displayName ?? null,
    assessment: list.length > 0 ? list[list.length - 1] : null,
    admission: snap?.admission ?? null,
  };
}

export function TakeoffAssistants({ wb, customerId, source, onOpenMaterials, cellContext }: {
  wb: WbApi;
  customerId: string;
  /** 投影源（与主屏同源；简报只读，不复制第二套业务状态）。 */
  source: TakeoffSource;
  onOpenMaterials: () => void;
  /** 当前所选格子上下文（随点选变化；助手共享该引用，不各存一份）。 */
  cellContext: string | null;
}) {
  const [assistant, setAssistant] = useState<AssistantId>('business');
  const [audience, setAudience] = useState<'customer' | 'internal'>('internal');
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingSend[]>([]);
  const [remote, setRemote] = useState<RemoteThreadMsg[]>([]);
  const [pollNote, setPollNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [imeNote, setImeNote] = useState(false);
  const [briefs, setBriefs] = useState<Array<{ key: string; kind: AssistantBriefKind; text: string; at: string }>>([]);
  const [briefBusy, setBriefBusy] = useState(false);
  const lastFinRef = useRef<{ customerId: string; finByKind: Partial<Record<AssistantBriefKind, string>> }>({ customerId: '', finByKind: {} });
  const client = wb.client;
  const cursorRef = useRef<string | null>(null);
  const pressTimer = useRef<number | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  // 服务端线程为权威：游标增量续拉；轮询 + 发送后即拉（与既有工作本同纪律）。
  const pollThread = useCallback(async () => {
    if (!client || !client.session) return;
    try {
      const j = await client.listMessages(customerId, cursorRef.current ? { after: cursorRef.current } : { limit: 200 });
      const items = (Array.isArray(j.messages) ? j.messages : []) as RemoteThreadMsg[];
      if (typeof j.cursor === 'string' && j.cursor) cursorRef.current = j.cursor;
      if (items.length > 0) {
        setRemote((prev) => {
          const seen = new Set(prev.map((m) => m.messageId));
          return [...prev, ...items.filter((m) => !seen.has(m.messageId))];
        });
      }
      setPollNote(null);
    } catch (e) {
      const code = (e as { code?: string }).code;
      setPollNote(code === 'FORBIDDEN' ? '当前身份不可读该客户消息线程' : null);
    }
  }, [client, customerId]);

  useEffect(() => {
    setRemote([]);
    cursorRef.current = null;
    void pollThread();
    const t = window.setInterval(() => void pollThread(), 4000);
    return () => window.clearInterval(t);
  }, [pollThread, wb.snapshotVersion]);

  const send = async () => {
    if (!client || !draft.trim()) return;
    const localId = `m-${Date.now()}`;
    const requestId = `wb-msg-${customerId}-${Date.now()}`.slice(0, 128);
    const body = draft.trim();
    setPending((prev) => [...prev, { id: localId, requestId, audience, text: body, at: new Date().toISOString(), state: '发送中' }]);
    setDraft('');
    try {
      const r = await client.sendMessage(customerId, { requestId, audience, text: body });
      setPending((prev) => prev.map((m) => (m.id === localId ? { ...m, state: r.replayed ? '已送达（重放确认）' : '已送达（服务端回执）' } : m)));
      await pollThread();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setPending((prev) => prev.map((m) => (m.id === localId ? { ...m, state: `发送失败：${code ?? ''}` } : m)));
      setErr(`消息未送达：${(e as Error).message}`);
    }
  };

  const insertMention = (name: string) => {
    setDraft((d) => (d.endsWith('@') || d === '' ? `${d}@${name} ` : `${d} @${name} `));
  };

  // ---- 受控简报（D-02 收尾）：读服务端收口面→确定性组答（替身）→本地展示 ----
  // 只读不写：简报/聊天都不能修改方案、解除冻结或确认结论；受控动作=上传补证（统一提交链）。
  // 客户切换清空简报与去重锚；同一 finId 重复询问=短答去重，不重复全量推理。
  const pushBrief = useCallback((kind: AssistantBriefKind, text: string) => {
    const key = `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setBriefs((prev) => [{ key, kind, text, at: new Date().toISOString() }, ...prev].slice(0, 20));
  }, []);

  const requestBrief = useCallback(async () => {
    if (!client || !customerId || briefBusy) return;
    const kind = assistant as AssistantBriefKind;
    setBriefBusy(true);
    try {
      const j = await client.read(`/api/jw/v2/connectors/analysis/finalization?tid=${encodeURIComponent('t1')}&cid=${encodeURIComponent(customerId)}`);
      const fin = ((j as { finalization?: unknown })?.finalization ?? null) as AssistantBriefSource['finalization'];
      const prior = lastFinRef.current.customerId === customerId ? (lastFinRef.current.finByKind[kind] ?? null) : null;
      const brief = composeAssistantBrief(kind, { ...briefSourceOf(source), finalization: fin }, prior);
      if (!brief.deduped) lastFinRef.current = { customerId, finByKind: { ...lastFinRef.current.finByKind, [kind]: fin?.finId ?? '' } };
      pushBrief(kind, brief.text);
    } catch (e) {
      const status = (e as { status?: number }).status ?? null;
      const code = (e as { code?: string }).code ?? null;
      if (status === 404 || code === 'NO_FINALIZATION') {
        pushBrief(kind, composeAssistantBrief(kind, { ...briefSourceOf(source), finalization: null }, null).text);
      } else {
        pushBrief(kind, composeAssistantBriefError(kind, status, code));
      }
    } finally {
      setBriefBusy(false);
    }
  }, [client, customerId, source, assistant, briefBusy, pushBrief]);

  useEffect(() => {
    setBriefs([]);
    lastFinRef.current = { customerId: '', finByKind: {} };
  }, [customerId]);

  const startPress = (name: string) => {
    pressTimer.current = window.setTimeout(() => { insertMention(name); pressTimer.current = null; }, 500);
  };
  const cancelPress = () => {
    if (pressTimer.current !== null) { window.clearTimeout(pressTimer.current); pressTimer.current = null; }
  };

  const myPrincipalId = wb.session?.principalId ?? '';
  const cols = mergeThread(pending, remote, myPrincipalId);
  const rows = cols[audience];

  // 新消息到达时贴底（仅当本就接近底部，不打断回看）。
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [rows.length, audience]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 输入法候选确认不误发送：composing 状态（isComposing / keyCode 229）不触发发送。
    if (e.nativeEvent.isComposing || e.keyCode === 229) { setImeNote(true); return; }
    setImeNote(false);
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="tk-right">
      <div className="tk-asst-tabs" role="tablist" aria-label="助手（共用一个工作区；单击切换，长按插入@）">
        {ASSISTANTS.map((a) => (
          <button
            key={a.id}
            role="tab"
            aria-selected={assistant === a.id}
            className="tk-asst-tab"
            onClick={() => setAssistant(a.id)}
            onPointerDown={() => startPress(a.name)}
            onPointerUp={cancelPress}
            onPointerLeave={cancelPress}
            title={`${a.name}助手：单击切换；长按或用 @ 按钮在草稿中提及`}
          >{a.name}</button>
        ))}
      </div>
      <div className="tk-asst-body">
        <div className="tk-asst-note">
          当前助手：<strong>{ASSISTANTS.find((a) => a.id === assistant)?.name}</strong>（助手平时安静：仅相关事件/@/点选触发；「受控简报」=服务端读面确定性组答，真实模型未授权 NOT_RUN，不伪装流式/自动回复；聊天文本不改变任何业务状态）
          {cellContext ? ` · 上下文：${cellContext}` : ''}
        </div>
        <div className="tk-audience">
          <button className="tk-btn small" aria-pressed={audience === 'internal'} onClick={() => setAudience('internal')}>内部协作</button>
          <button className="tk-btn small" aria-pressed={audience === 'customer'} onClick={() => setAudience('customer')}>对客户</button>
          <span className="tk-asst-note">内部讨论不自动发客户；页内消息办理（无真实外部渠道，不显示“已送达企业微信”）</span>
        </div>
        <div className="tk-thread" ref={threadRef} aria-label={audience === 'customer' ? '对客户消息' : '内部消息'} aria-live="polite">
          {briefs.length > 0 && (
            <div className="tk-briefs" role="list" aria-label="助手受控简报（确定性替身，本地展示不入服务端线程）">
              {briefs.map((b) => (
                <div key={b.key} role="listitem" className="tk-msg brief">
                  <div style={{ whiteSpace: 'pre-line' }}>{b.text}</div>
                  <div className="tk-meta">{ASSISTANT_BRIEF_NAMES[b.kind]} · {new Date(b.at).toLocaleTimeString('zh-CN', { hour12: false })} · 确定性简报（只读；不入服务端线程，不产生业务写入）</div>
                </div>
              ))}
            </div>
          )}
          {rows.length === 0 && briefs.length === 0 && <span className="tk-asst-note">（{audience === 'customer' ? '对客户' : '内部'}线程为空）</span>}
          {rows.map((m) => (
            <div key={m.key} className={`tk-msg${m.mine ? ' mine' : ''}`}>
              <div>{m.text}</div>
              <div className="tk-meta">{m.mine ? '我' : m.senderLabel} · {new Date(m.at).toLocaleTimeString('zh-CN', { hour12: false })} · {m.state}</div>
            </div>
          ))}
        </div>
        {pollNote && <span className="tk-asst-note">{pollNote}</span>}
        <div className="tk-toolbar" aria-label="工具栏（未接入能力明确禁用）">
          <button className="tk-tool" disabled={briefBusy || !client} onClick={() => void requestBrief()} title="受控简报：读取当前客户收口/评估读面后确定性组答（替身，非真实模型；同一收口自动去重；只读不写）">{briefBusy ? '读取中…' : '受控简报'}</button>
          <button className="tk-tool" onClick={onOpenMaterials} title="上传原件（统一提交链，一次上传）">上传</button>
          <button className="tk-tool" onClick={() => insertMention(ASSISTANTS.find((a) => a.id === assistant)?.name ?? '')} title="在草稿中@当前助手（长按助手标签同效；@不是唯一入口）">@</button>
          <span style={{ flex: 1 }} />
          <span className="tk-menu">
            <button className="tk-tool" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>⋯ 更多</button>
            {menuOpen && (
              <div className="tk-menu-pop" role="menu" aria-label="更多工具（未接入项禁用）">
                {NOT_WIRED.map((t) => (
                  <button key={t.key} role="menuitem" className="tk-tool" disabled title={t.why} onClick={() => { /* 未接入：明确禁用，不做假成功 */ }}>
                    {t.label}（未接入）
                  </button>
                ))}
              </div>
            )}
          </span>
        </div>
        <textarea
          className="tk-draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`向${audience === 'customer' ? '客户' : '内部协作'}发送消息…（Enter 发送，Shift+Enter 换行）`}
          aria-label="消息草稿"
        />
        {imeNote && <span className="tk-asst-note">输入法候选确认不会误发送。</span>}
        <div className="tk-sendrow">
          <span className="tk-asst-note" style={{ flex: 1 }}>草稿在切换助手时保留（一份草稿共用）。</span>
          <button className="tk-btn primary" disabled={!draft.trim()} onClick={() => void send()}>发送</button>
        </div>
        <WbError error={err} onDismiss={() => setErr(null)} />
      </div>
    </div>
  );
}
