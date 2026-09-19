// goal-03c 客户工作本主界面（任务书§4 布局）：客户为唯一工作上下文；
// 主体区=当前工作面板（材料/核验/问答/方案/结果），右栏=详情/待办/四域，底部=沟通常驻。
// 切客户由目录页发起（openCustomer 代际守卫：迟到响应不串入新客户）。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import { deriveCreditLines, deriveDecisionLines, deriveDomainRowsLive, deriveSessionActions, fmtAmount } from '../../lib/v5-preview/edge/edge-logic';
import { mergeThread, type PendingSend, type RemoteThreadMsg } from '../../lib/workbench/wb-logic';
import { DomainGrid } from '../v5-preview/domain-grid';
import { OriginalsPanel } from './originals-panel';
import { VerifyPanel } from './verify-panel';
import { QaPanel } from './qa-panel';
import { ProposalPanel } from './proposal-panel';
import { ResultPanel } from './result-panel';
import { InvitationsPanel } from './invitations-panel';
import { CustomerPortal } from './customer-portal';
import { WbDot, WbError } from './wb-parts';

type TabKey = 'originals' | 'verify' | 'qa' | 'proposal' | 'result' | 'invitations';
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'originals', label: '材料·原件' },
  { key: 'verify', label: '核验' },
  { key: 'qa', label: '问题·补证' },
  { key: 'proposal', label: '方案·决定' },
  { key: 'result', label: '结果' },
  { key: 'invitations', label: '受限邀请' },
];

export function CustomerWorkbench({ wb, onBackToDirectory, onLogout }: { wb: WbApi; onBackToDirectory: () => void; onLogout: () => void }) {
  const [tab, setTab] = useState<TabKey>('originals');
  const customerId = wb.customerId;
  if (!customerId) return null;
  // 客户联系人身份（roles=['customer']）：进入受限客户视图，不呈现内部工作本
  if ((wb.session?.roles ?? []).every((r) => r === 'customer')) {
    return <CustomerPortal wb={wb} customerId={customerId} onLogout={onLogout} />;
  }
  const snap = wb.snapshot;
  const customer = snap?.customer ?? null;
  const session = snap?.session ?? null;
  const phaseBadge = wb.phase === 'live' ? { cls: 'live', text: '实时连接' } : wb.phase === 'reconnecting' ? { cls: 'off', text: '重连中' } : wb.phase === 'connecting' ? { cls: 'off', text: '连接中' } : { cls: 'off', text: '未连接' };
  const openItems = snap?.openItems ?? [];
  const creditLines = deriveCreditLines(snap ?? {});
  const decisionLines = deriveDecisionLines(snap ?? null);
  const domainRows = deriveDomainRowsLive(snap ?? null);
  const sessionActions = session ? deriveSessionActions(session) : null;

  return (
    <div className="wb-root">
      <header className="wb-top">
        <h1>{customer?.displayName || '客户工作本'} <span className="wb-sub">{customerId}</span></h1>
        <span className={`wb-badge ${phaseBadge.cls}`}>{phaseBadge.text}</span>
        <span className="wb-sub">{customer?.status ? `状态：${customer.status}` : ''}</span>
        <span className="wb-spacer" />
        <span className="wb-sub">身份：{wb.session?.principalId}（角色 {wb.session?.roles.join('/') || '—'}）</span>
        <button className="wb-btn small ghost" onClick={onBackToDirectory}>返回目录</button>
        <button className="wb-btn small ghost" onClick={onLogout}>退出登录</button>
      </header>
      <WbError error={wb.error} onDismiss={() => wb.setError(null)} />
      <div className="wb-main">
        <section className="wb-panel" aria-label="当前工作面板">
          <div className="wb-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} className="wb-tab" onClick={() => setTab(t.key)}>{t.label}</button>
            ))}
          </div>
          {tab === 'originals' && <OriginalsPanel wb={wb} customerId={customerId} onChanged={() => void wb.refresh()} />}
          {tab === 'verify' && <VerifyPanel wb={wb} customerId={customerId} />}
          {tab === 'qa' && <QaPanel wb={wb} customerId={customerId} />}
          {tab === 'proposal' && <ProposalPanel wb={wb} customerId={customerId} />}
          {tab === 'result' && <ResultPanel wb={wb} customerId={customerId} />}
          {tab === 'invitations' && <InvitationsPanel wb={wb} customerId={customerId} />}
        </section>
        <aside className="wb-rail" aria-label="详情与待办">
          <div className="wb-panel">
            <h3 className="wb-h2">待办（服务端 next-actions 口径）</h3>
            {openItems.length === 0 && <p className="wb-note">无待办。</p>}
            <ul className="wb-note" style={{ paddingLeft: 18 }}>
              {(openItems as Array<Record<string, unknown>>).map((it, i) => (
                <li key={i}>{String(it.text ?? it.title ?? JSON.stringify(it).slice(0, 60))}</li>
              ))}
            </ul>
          </div>
          <div className="wb-panel">
            <h3 className="wb-h2">四域判定（绿=该域冻结结论当前；灰=未开始/未知，均非"通过"）</h3>
            <DomainGrid domains={domainRows} relatedTodo={null} />
          </div>
          <div className="wb-panel">
            <h3 className="wb-h2">额度与决策要点</h3>
            {creditLines.map((l) => <div key={l.label} className="wb-kv"><span className="k">{l.label}</span><span>{l.value}</span></div>)}
            {decisionLines.map((l, i) => <div key={`d${i}`} className="wb-kv"><span className="k">{l.label}</span><span>{l.value}</span></div>)}
          </div>
          {session && sessionActions && (
            <div className="wb-panel">
              <h3 className="wb-h2">检查会话操作（服务端 availableActions）</h3>
              <p className="wb-note">会话动作条在问题·补证页；可做性以服务端为准。</p>
            </div>
          )}
          {snap?.refsExhaustive === false && (
            <div className="wb-panel">
              <p className="wb-note warn">评估/申请清单来自事件窗口（非权威清单，IR-03-4）；决策状态与额度合计为服务端权威投影。</p>
            </div>
          )}
        </aside>
      </div>
      <BottomChat wb={wb} customerId={customerId} />
      <footer className="wb-sub" style={{ padding: '2px 16px 8px' }}>
        演示租户 t1 · Edge {wb.buildId ?? '—'} · 原件预览已接线（IR-03-3/§11.2 单件读回 + 通道签名 URL）· 视频/三维未接入
      </footer>
    </div>
  );
}

function BottomChat({ wb, customerId }: { wb: WbApi; customerId: string }) {
  const [audience, setAudience] = useState<'customer' | 'internal'>('internal');
  const [pending, setPending] = useState<PendingSend[]>([]);
  const [remote, setRemote] = useState<RemoteThreadMsg[]>([]);
  const [pollNote, setPollNote] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const client = wb.client;
  const cursorRef = useRef<string | null>(null);

  // 双向拉取（DEF-G04N-05 修复）：线程以服务端为权威，游标增量续拉；轮询 + 发送后即拉。
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
  }, [pollThread, customerId, wb.snapshotVersion]);

  const send = async () => {
    if (!client || !text.trim()) return;
    const localId = `m-${Date.now()}`;
    const requestId = `wb-msg-${customerId}-${Date.now()}`.slice(0, 128);
    const at = new Date().toISOString();
    const body = text.trim();
    setPending((prev) => [...prev, { id: localId, requestId, audience, text: body, at, state: '发送中' }]);
    setText('');
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

  const myPrincipalId = wb.session?.principalId ?? '';
  const cols = mergeThread(pending, remote, myPrincipalId);

  const renderCol = (col: 'customer' | 'internal') => (
    <div>
      <div className="wb-row">
        <button
          className={`wb-btn small ${audience === col ? '' : 'ghost'}`}
          onClick={() => setAudience(col)}
          aria-pressed={audience === col}
        >{col === 'customer' ? '对客户' : '内部协作'}</button>
        <span className="wb-sub">{col === 'customer' ? '客户可见' : '仅内部可见'}</span>
      </div>
      <div className="wb-chat-list" aria-label={col === 'customer' ? '对客户消息' : '内部消息'}>
        {cols[col].length === 0 && <span className="wb-note">（空）</span>}
        {cols[col].map((m) => (
          <div key={m.key} className="wb-msg">
            <div>{m.text}</div>
            <div className="meta">
              {m.senderLabel} · {new Date(m.at).toLocaleTimeString('zh-CN', { hour12: false })} ·{' '}
              <WbDot
                tone={m.state.startsWith('发送失败') ? 'red' : m.state.startsWith('发送中') ? 'blue' : 'green'}
                text={m.state}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="wb-bottom" aria-label="沟通（常驻底部）">
      <div className="wb-row">
        <h3 className="wb-h2" style={{ margin: 0 }}>沟通</h3>
        <span className="wb-note">页面内消息办理（无真实外部渠道——不显示"已送达企业微信"）；对客户/内部显式分列，双向以服务端线程为准。</span>
        {pollNote && <span className="wb-sub">{pollNote}</span>}
      </div>
      <div className="wb-chat-cols">
        {renderCol('customer')}
        {renderCol('internal')}
      </div>
      <div className="wb-row" style={{ marginTop: 6 }}>
        <input
          className="wb-input" style={{ flex: 1 }} value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
          placeholder={`向${audience === 'customer' ? '客户' : '内部协作'}发送消息…`}
          aria-label="消息输入"
        />
        <button className="wb-btn" onClick={() => void send()} disabled={!text.trim()}>发送</button>
      </div>
      <WbError error={err} onDismiss={() => setErr(null)} />
      <div className="wb-sub">敞口合计：{fmtAmount(wb.snapshot?.totalsMinor?.exposureNow)}（服务端权威投影）</div>
    </div>
  );
}
