// board-round-02 任务01·业务视角横屏二维作业看板（复用真实工作本，v5-preview home-overview 仅借布局语言）：
// 单一客户/项目上下文——顶部摘要（客户/连接/融资与额度分列）；阶段概览条（商机→尽调→政策→信审→
// 商务→资产→结清，职责可并行不强制流水线，后端未支持能力如实标注）；主区=当前事项卡（点开进入
// 原面板，不造第二套办理状态机）；右栏=选中事项的依据/版本/动作（未选中时=待办+四域）；底部沟通
// 可折叠（默认收起为一条栏，不固定吃掉半屏）。默认业务身份，不要求切换五身份办理。
// 数据纪律：卡片摘要只做服务端字段的展示投影；颜色语义全部带文字；不做泳道编辑器/概率/定时假完成。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import { deriveCreditLines, deriveDecisionLines, deriveDomainRowsLive, deriveSessionActions, fmtAmount } from '../../lib/v5-preview/edge/edge-logic';
import { mergeThread, type PendingSend, type RemoteThreadMsg } from '../../lib/workbench/wb-logic';
import { deriveBoardSummary, deriveLifecycleStages, type LifecycleStageRow } from '../../lib/workbench/wb-logic';
import { DomainGrid } from '../v5-preview/domain-grid';
import { OriginalsPanel } from './originals-panel';
import { VerifyPanel } from './verify-panel';
import { QaPanel } from './qa-panel';
import { ProposalPanel } from './proposal-panel';
import { ResultPanel } from './result-panel';
import { InvitationsPanel } from './invitations-panel';
import { CustomerPortal } from './customer-portal';
import { WbDot, WbError } from './wb-parts';

type MatterKey = 'originals' | 'verify' | 'qa' | 'proposal' | 'result' | 'invitations';

const MATTERS: Array<{ key: MatterKey; label: string; hint: string }> = [
  { key: 'originals', label: '材料·处理', hint: '一次提交进处理链，自动回写档案' },
  { key: 'verify', label: '核验', hint: '检查会话核验与必要项' },
  { key: 'qa', label: '问题·补证', hint: '补证问题回答与跟进' },
  { key: 'proposal', label: '方案·决定', hint: '依据包冻结与域意见登记' },
  { key: 'result', label: '结果·对账', hint: '回执对账与报告导出' },
  { key: 'invitations', label: '受限邀请', hint: '客户人员授权与撤权' },
];

interface MatterSummary {
  tone: 'green' | 'blue' | 'red' | 'gray' | 'yellow';
  lines: string[];
}

/** 主区事项卡摘要：全部来自服务端字段投影；需要清单的卡自行轻量拉取，失败如实显示不编造。 */
function useMatterSummaries(wb: WbApi, customerId: string | null): Record<MatterKey, MatterSummary | null> {
  const [channel, setChannel] = useState<{ tasks: Array<Record<string, unknown>>; err: string | null }>({ tasks: [], err: null });
  const [artifactCount, setArtifactCount] = useState<number | null>(null);
  const [reportCount, setReportCount] = useState<number | null>(null);
  const [inviteCount, setInviteCount] = useState<number | null>(null);

  const refreshExtras = useCallback(async () => {
    const c = wb.client;
    if (!c || !customerId) return;
    try {
      const j = await c.read(`/api/jw/v2/customers/${encodeURIComponent(customerId)}/artifacts`);
      setArtifactCount(Array.isArray(j.artifacts) ? j.artifacts.length : null);
    } catch { setArtifactCount(null); }
    try {
      const j = await c.channelStatus(customerId);
      setChannel({ tasks: (Array.isArray(j.tasks) ? j.tasks : []) as Array<Record<string, unknown>>, err: null });
    } catch (e) {
      setChannel({ tasks: [], err: (e as { code?: string }).code ?? 'CHANNEL_READ_FAILED' });
    }
    try {
      const j = await c.read(`/api/jw/v2/customers/${encodeURIComponent(customerId)}/reports`);
      setReportCount(Array.isArray(j.reports) ? j.reports.length : null);
    } catch { setReportCount(null); }
    try {
      const j = await c.listInvitations(customerId);
      const list = (Array.isArray(j.invitations) ? j.invitations : []) as Array<{ status?: string }>;
      setInviteCount(list.filter((i) => i.status === 'active' || i.status === 'issued').length || list.filter((i) => i.status !== 'revoked' && i.status !== 'expired').length);
    } catch { setInviteCount(null); }
  }, [wb.client, customerId]);

  useEffect(() => { void refreshExtras(); }, [refreshExtras, wb.snapshotVersion]);

  const snap = wb.snapshot;
  const session = snap?.session ?? null;
  const basis = snap?.decisionStatus?.basis ?? null;
  const coverage = session?.coverage ?? null;
  const openQuestions = session?.openQuestions ?? 0;
  const followups = session?.followups?.length ?? 0;
  const reviewQueue = snap?.decisionStatus?.reviewQueue?.length ?? 0;

  const channelTasks = channel.tasks.map((t) => String(t.status ?? ''));
  const running = channelTasks.filter((s) => s === 'queued' || s === 'running').length;
  const blocked = channelTasks.filter((s) => s.startsWith('blocked_')).length;
  const doneReg = channel.tasks.filter((t) => t.status === 'done' && t.aRegistered === true).length;
  const needsFollowup = channelTasks.filter((s) => s === 'needs_followup').length;

  return {
    originals: channel.err
      ? { tone: 'gray', lines: [`处理链不可读（${channel.err}）：如实显示，不以档案状态冒充处理`, artifactCount != null ? `档案登记 ${artifactCount} 件` : '档案清单不可读'] }
      : channel.tasks.length === 0 && artifactCount === 0
        ? { tone: 'gray', lines: ['尚无材料。进入后一次提交，自动登记并推进处理'] }
        : {
          tone: blocked > 0 ? 'yellow' : running > 0 ? 'blue' : 'green',
          lines: [
            `档案登记 ${artifactCount ?? '—'} 件 · 处理任务 ${channel.tasks.length} 个`,
            running > 0 ? `处理中 ${running}` : null,
            blocked > 0 ? `被阻断等待恢复 ${blocked}（自动续跑，勿重复提交）` : null,
            needsFollowup > 0 ? `待补件/转人工 ${needsFollowup}` : null,
            doneReg > 0 ? `完成且已回写 A ${doneReg}` : null,
          ].filter((x): x is string => x !== null),
        },
    verify: coverage
      ? {
        tone: (coverage.open ?? 0) > 0 ? 'blue' : (coverage.required ?? 0) > 0 ? 'green' : 'gray',
        lines: [`必要核验 ${coverage.required ?? 0} · 已核验 ${coverage.verified ?? 0} · 未完成 ${coverage.open ?? 0}`],
      }
      : { tone: 'gray', lines: ['尚无检查会话覆盖数据'] },
    qa: {
      tone: openQuestions > 0 ? 'blue' : followups > 0 ? 'yellow' : 'gray',
      lines: [`开放问题 ${openQuestions} · 转会后待办 ${followups}`],
    },
    proposal: {
      tone: basis?.decisionReadiness === true ? 'green' : (basis?.blockedActions?.length ?? 0) > 0 ? 'red' : basis?.packageId ? 'yellow' : 'gray',
      lines: [
        basis?.packageId ? `依据包 ${basis.packageId}（r${basis.revision ?? '?'}）` : '依据包未冻结（正式提案将被阻断）',
        `Gate：${basis?.gate ? String(basis.gate.result ?? '未知') : '未登记'}`,
        `复核队列 ${reviewQueue} 项`,
      ],
    },
    result: { tone: 'gray', lines: [`报告 ${reportCount ?? '—'} 份 · 提交回执按对账编号查询`] },
    invitations: { tone: inviteCount ? 'blue' : 'gray', lines: [`在册邀请 ${inviteCount ?? '—'} 个 · 撤权即刻生效`] },
  };
}

export function CustomerWorkbench({ wb, onBackToDirectory, onLogout }: { wb: WbApi; onBackToDirectory: () => void; onLogout: () => void }) {
  const [matter, setMatter] = useState<MatterKey | null>(null);
  const customerId = wb.customerId;
  useEffect(() => { setMatter(null); }, [customerId]);
  // Hooks 全部在条件返回之前（Rules of Hooks）；未打开客户时摘要保持空态。
  const summaries = useMatterSummaries(wb, customerId);
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
  const stages: LifecycleStageRow[] = deriveLifecycleStages(snap ?? null);
  const boardSummary = deriveBoardSummary(snap ?? null);
  const matterMeta = matter ? MATTERS.find((m) => m.key === matter) ?? null : null;

  const openMatter = (key: MatterKey) => { setMatter(key); };
  const backToBoard = () => { setMatter(null); };

  const railForMatter = (key: MatterKey) => {
    const basis = snap?.decisionStatus?.basis ?? null;
    const gate = basis?.gate ?? null;
    switch (key) {
      case 'originals':
        return {
          title: '材料·处理：依据与动作',
          rows: [
            ['依据', 'A evidence_artifacts 权威清单 + 处理链任务回执（aBridge 自动回写）'],
            ['提交', '唯一入口=面板内「材料提交与处理链」：一次上传，不选链路、不重复上传'],
            ['对账', 'A 动作回执在「结果·对账」按编号查询；链路任务在材料页逐任务回执核对'],
          ] as Array<[string, string]>,
        };
      case 'verify':
        return {
          title: '核验：依据与动作',
          rows: [
            ['依据', '检查会话覆盖与核验留痕（服务端权威）'],
            ['版本', session?.version != null ? `会话版本 v${session.version}` : '会话未开始'],
            ['动作', '核验操作在主面板；可做性以服务端 availableActions 为准'],
          ] as Array<[string, string]>,
        };
      case 'qa':
        return {
          title: '问题·补证：依据与动作',
          rows: [
            ['依据', `开放问题 ${session?.openQuestions ?? 0} 个 · 转会后待办 ${session?.followups?.length ?? 0} 项`],
            ['动作', '回答/补证在主面板；回答权限按服务端目录角色裁决'],
          ] as Array<[string, string]>,
        };
      case 'proposal':
        return {
          title: '方案·决定：依据与动作',
          rows: [
            ['依据', basis?.packageId ? `依据包 ${basis.packageId}（修订 r${basis.revision ?? '?'} · 版本 ${basis.basisVersion ?? '?'}）` : '依据包未冻结'],
            ['Gate', gate ? `${String(gate.result ?? '未知')}${gate.rulePackVersion ? ` · 规则包 ${gate.rulePackVersion}` : ''}` : '未登记（尚无可信规则结论）'],
            ['版本', snap?.decisionStatus?.basis?.currency?.length ? '域当前性以依据包 currency 判定为准' : '无域当前性判定'],
            ['动作', '冻结依据包/登记域意见/豁免在主面板；authority=none 由服务端强制'],
          ] as Array<[string, string]>,
        };
      case 'result':
        return {
          title: '结果·对账：依据与动作',
          rows: [
            ['依据', '正式历史只追加（事件窗口 + 回执表）'],
            ['动作', 'A 动作回执按对账编号查询；通道回执按任务留痕核对；报告分受众导出'],
          ] as Array<[string, string]>,
        };
      case 'invitations':
        return {
          title: '受限邀请：依据与动作',
          rows: [
            ['依据', 'A 客户授权（grants）与受限邀请记录'],
            ['动作', '发起邀请/撤销/页面化撤权在主面板；code 明文仅创建响应一次'],
          ] as Array<[string, string]>,
        };
    }
  };
  const rail = matter ? (railForMatter(matter) ?? null) : null;

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
      <section className="wb-stages" aria-label="阶段概览（职责可并行，非强制流水线）">
        <div className="wb-stages-row">
          {stages.map((s) => (
            <span key={s.key} className="wb-stage" data-state={s.state} title={s.basis}>
              <span className="wb-stage-dot" data-state={s.state} aria-hidden="true" />
              {s.label}
              {s.state === 'unsupported' && <em className="wb-stage-flag">未支持</em>}
            </span>
          ))}
          <span className="wb-note" style={{ marginLeft: 'auto' }}>阶段按当前职责呈现，可并行推进；灰色=未开始/未知，绿=该段有当前产出（≠批准）。</span>
        </div>
        <div className="wb-stages-row wb-sub">
          {boardSummary.map((l) => <span key={l.label} className="wb-kv inline"><span className="k">{l.label}</span>{l.value}</span>)}
        </div>
      </section>
      <div className="wb-main">
        <section className="wb-panel" aria-label="当前事项">
          {matter === null ? (
            <div className="wb-cards" role="list" aria-label="事项卡（点击进入办理）">
              {MATTERS.map((m) => {
                const s = summaries[m.key];
                return (
                  <button key={m.key} role="listitem" className="wb-matter" onClick={() => openMatter(m.key)} aria-label={`进入${m.label}`}>
                    <span className="wb-matter-head">
                      <WbDot tone={s?.tone ?? 'gray'} text="" />
                      <strong>{m.label}</strong>
                      <span className="wb-sub">{m.hint}</span>
                    </span>
                    <span className="wb-matter-body">
                      {s === null ? <span className="wb-note">读取中…</span> : s.lines.map((l, i) => <span key={i} className="wb-note">{l}</span>)}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <div className="wb-row" style={{ marginBottom: 8 }}>
                <button className="wb-btn small ghost" onClick={backToBoard}>← 返回看板</button>
                <strong>{matterMeta?.label}</strong>
                <span className="wb-sub">{matterMeta?.hint}</span>
              </div>
              {matter === 'originals' && <OriginalsPanel wb={wb} customerId={customerId} onChanged={() => void wb.refresh()} />}
              {matter === 'verify' && <VerifyPanel wb={wb} customerId={customerId} />}
              {matter === 'qa' && <QaPanel wb={wb} customerId={customerId} />}
              {matter === 'proposal' && <ProposalPanel wb={wb} customerId={customerId} />}
              {matter === 'result' && <ResultPanel wb={wb} customerId={customerId} />}
              {matter === 'invitations' && <InvitationsPanel wb={wb} customerId={customerId} />}
            </>
          )}
        </section>
        <aside className="wb-rail" aria-label="详情与待办">
          {rail ? (
            <div className="wb-panel">
              <h3 className="wb-h2">{rail.title}</h3>
              {rail.rows.map(([k, v]) => (
                <div key={k} className="wb-kv"><span className="k">{k}</span><span>{v}</span></div>
              ))}
            </div>
          ) : (
            <div className="wb-panel">
              <h3 className="wb-h2">待办（服务端 next-actions 口径）</h3>
              {openItems.length === 0 && <p className="wb-note">无待办。</p>}
              <ul className="wb-note" style={{ paddingLeft: 18 }}>
                {(openItems as Array<Record<string, unknown>>).map((it, i) => (
                  <li key={i}>{String(it.text ?? it.title ?? JSON.stringify(it).slice(0, 60))}</li>
                ))}
              </ul>
            </div>
          )}
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
  const [expanded, setExpanded] = useState(false); // 默认收起：沟通不固定吃掉半屏；展开只为本条栏的展开动画
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

  if (!expanded) {
    return (
      <div className="wb-chatbar" aria-label="沟通（收起）">
        <button className="wb-btn small" onClick={() => setExpanded(true)} aria-expanded={false}>沟通 ▸ 展开</button>
        <span className="wb-sub">对客户 {cols.customer.length} 条 · 内部 {cols.internal.length} 条（页面内消息办理，服务端线程为准）</span>
        {pollNote && <span className="wb-sub">{pollNote}</span>}
        <span className="wb-spacer" />
        <span className="wb-sub">敞口合计：{fmtAmount(wb.snapshot?.totalsMinor?.exposureNow)}（服务端权威投影）</span>
      </div>
    );
  }

  return (
    <div className="wb-bottom" aria-label="沟通（展开）">
      <div className="wb-row">
        <button className="wb-btn small ghost" onClick={() => setExpanded(false)} aria-expanded={true}>沟通 ▴ 收起</button>
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
