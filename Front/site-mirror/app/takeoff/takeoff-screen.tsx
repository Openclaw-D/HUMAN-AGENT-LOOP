import { workRoleName } from './role-entry';
// TAKEOFF-FA-1.0.0 · 主屏（02路）：顶部客户与同版候选方案摘要；左侧二十格看板（~80%）；
// 右侧六助手（~20%）；两主体区向下铺满。流程/记录/材料/待办只做入口（抽屉内消费同源记录）。
// 数据：workspace 快照 + A artifacts/处理通道/依据包详情 真实读面；格子=只读投影，点击看真实事项。
// 结束=受控预评估结论确认：三类结论走 A confirm-preassessment（§13，绑定版本/候选修订+服务端硬门）；
// 行政撤回走既有 decide withdraw_assessment；绝不调用 facility.approve（本轮默认路径无正式额度操作）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import type { TakeoffCellView, TakeoffSource } from '../../lib/workbench/takeoff-projection';
import { CONFIRM_OUTCOME_LABEL, deriveTakeoffCells, deriveTakeoffTop, takeoffDomainName, takeoffRowName } from '../../lib/workbench/takeoff-projection';
import { wbActionRequestId } from '../../lib/workbench/wb-logic';
import { TakeoffBoard } from './takeoff-board';
import { TakeoffCellDetail } from './takeoff-detail';
import { TakeoffAssistants } from './takeoff-assistants';
import { AdmissionRequestPanel } from './admission-request-panel';
import { MaterialsDesk } from './materials-desk';
import { RoleFlow } from './role-flow';
import { WorkTimeline } from './work-timeline';
import { blockingPredecessor } from './cell-status';
import { RoleLogo, UiIcon, ObjectIcon } from './ui-icons';
import { FlowView, MaterialsView, RecordsView, TodoView, type PanelKey } from './takeoff-aux';
import { CustomerPortal } from '../workbench/customer-portal';
import { VerifyPanel } from '../workbench/verify-panel';
import { QaPanel } from '../workbench/qa-panel';
import { ProposalPanel } from '../workbench/proposal-panel';
import { ResultPanel } from '../workbench/result-panel';
import { WbError, useAction } from '../workbench/wb-parts';
import './takeoff.css';
import './glass.css';
import './compact-workspace.css';

type DrawerView =
  | { kind: 'cell'; cell: TakeoffCellView }
  | { kind: 'panel'; panel: PanelKey }
  | { kind: 'flow' }
  | { kind: 'records' }
  | { kind: 'todos' }
  | { kind: 'customer' }
  | { kind: 'admission' }
  | { kind: 'materialdesk' }
  | { kind: 'timeline' }
  | null;

const PANEL_TITLE: Record<PanelKey, string> = {
  materials: '上传与补充材料',
  verify: '核验材料',
  qa: '问题与补证',
  proposal: '建议方案',
  result: '办理结果',
};

export function TakeoffScreen({ wb, onBackToDirectory, onLogout }: {
  wb: WbApi;
  onBackToDirectory: () => void;
  onLogout: () => void;
}) {
  const customerId = wb.customerId;
  const [drawer, setDrawer] = useState<DrawerView>(null);
  const [zoomed, setZoomed] = useState(false);
  const [assistantCollapsed, setAssistantCollapsed] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [page, setPage] = useState<'board'|'materials'|'flow'|'records'>('board');
  const [source, setSource] = useState<TakeoffSource>({ snapshot: null, packageDetail: null, channelTasks: [], currentMaterials: null, factConflicts: 0 });
  const act = useAction();
  const sourceSequence = useRef(0);
  const drawerElement = useRef<HTMLDivElement>(null);
  const drawerOpen = drawer !== null;

  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    drawerElement.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [drawerOpen]);

  useEffect(() => { setDrawer(null); setEndOpen(false); setPage('board'); }, [customerId]);

  // 真实读面装配：artifacts（现行件数/冲突）+ 处理通道任务 + 依据包详情（域结果/采用）。
  // 读取失败 → 对应计数=null/空，投影如实显示未知，不冒充 0。
  const loadSource = useCallback(async () => {
    const client = wb.client;
    if (!client || !customerId) return;
    const sequence = ++sourceSequence.current;
    // snapshot 经 cast 携带 Edge admission 投影（§13.3）；投影语义由 takeoff-projection 消费。
    const next: TakeoffSource = { snapshot: (wb.snapshot ?? null) as unknown as TakeoffSource['snapshot'], packageDetail: null, channelTasks: [], currentMaterials: null, factConflicts: 0 };
    await Promise.all([
      (async () => {
        try {
          const j = await client.read(`/api/jw/v2/customers/${encodeURIComponent(customerId)}/artifacts`);
          const arts = (Array.isArray(j.artifacts) ? j.artifacts : []) as Array<Record<string, unknown>>;
          next.currentMaterials = arts.filter((a) => a.current === true).length;
          const conflicts = j.factConflicts;
          next.factConflicts = Array.isArray(conflicts) ? conflicts.length : 0;
        } catch { /* 未知保持 null */ }
      })(),
      (async () => {
        try {
          const j = await client.channelStatus(customerId);
          next.channelTasks = (Array.isArray(j.tasks) ? j.tasks : []) as Array<{ status?: string }>;
        } catch { /* 通道未接入：任务=空，投影显示不可读 */ }
      })(),
      (async () => {
        try {
          const pkgId = (wb.snapshot?.decisionStatus?.basis?.packageId ?? null) as string | null;
          if (pkgId) next.packageDetail = await client.packageDetail(pkgId) as TakeoffSource['packageDetail'];
        } catch { /* 包详情读取失败：域结果=空 */ }
      })(),
    ]);
    if (sourceSequence.current === sequence) setSource(next);
  }, [wb.client, wb.snapshot, customerId]);

  useEffect(() => { void loadSource(); return () => { sourceSequence.current += 1; }; }, [loadSource, wb.snapshotVersion]);

  const currentSource = useMemo(() => source.snapshot?.customer?.customerId === customerId ? source : { snapshot: wb.snapshot as TakeoffSource['snapshot'], packageDetail: null, channelTasks: [], currentMaterials: null, factConflicts: 0 }, [source, customerId, wb.snapshot]);
  const cells = useMemo(() => deriveTakeoffCells(currentSource), [currentSource]);
  const top = useMemo(() => deriveTakeoffTop(currentSource), [currentSource]);
  const todosSource = currentSource;

  if (!customerId) return null;
  // 客户联系人身份（roles=['customer']）：受限客户门户（保留既有真实门户，不呈现内部看板）。
  if ((wb.session?.roles ?? []).every((r) => r === 'customer')) {
    return <CustomerPortal wb={wb} customerId={customerId} onLogout={onLogout} />;
  }

  const phaseText = wb.phase === 'live' ? '实时连接' : wb.phase === 'reconnecting' ? '重连中' : wb.phase === 'connecting' ? '连接中' : '未连接';

  const openCell = (c: TakeoffCellView) => { setDrawer({ kind: 'cell', cell: c }); };
  const openPanel = (k: PanelKey) => { setDrawer({ kind: 'panel', panel: k }); };
  const closeDrawer = () => { setDrawer(null); setZoomed(false); };
  const role = wb.session?.roles.find((r) => ['business', 'policy', 'credit', 'commerce', 'asset'].includes(r)) ?? 'business';

  const drawerTitle = drawer === null ? ''
    : drawer.kind === 'cell' ? `${takeoffDomainName(drawer.cell.domain)} · ${{ input: '材料', analysis: '分析', human: '核验', closure: '办结' }[drawer.cell.row]}`
    : drawer.kind === 'panel' ? PANEL_TITLE[drawer.panel]
    : drawer.kind === 'flow' ? '办理流程'
    : drawer.kind === 'records' ? '办理记录'
    : drawer.kind === 'todos' ? '待办事项'
    : drawer.kind === 'materialdesk' ? '整理材料'
    : drawer.kind === 'timeline' ? '办理记录'
    : drawer.kind === 'admission' ? '首次回租需求登记'
    : '客户主体信息';
  const predecessor = drawer?.kind === 'cell' ? blockingPredecessor(drawer.cell, cells) : null;

  return (
    <div className="tk-root tk-workspace">
      <header className="tk-top tk-compact-top">
        <button className="tk-back-client" onClick={onBackToDirectory} aria-label="切换客户"><UiIcon name="back" size={20}/></button>
        <span className="tk-appbrand"><UiIcon name="jianwei" size={26}/></span>
        <button className="tk-cust-name" onClick={() => setDrawer({ kind: 'customer' })} title={top.customer.displayName || '客户详情'}>{top.customer.displayName || '客户工作区'}</button>
        <nav className="tk-mainnav" aria-label="客户工作区">{([['board','平台','board'],['materials','材料','materials'],['flow','决策','flow'],['records','流程','timeline']] as const).map(([id,label,icon])=><button key={id} aria-current={page===id?'page':undefined} title={{board:'工作台',materials:'材料清单',flow:'角色流程／决策树',records:'时间轴'}[id]} onClick={()=>{setPage(id);closeDrawer();}}>{icon==='materials'?<ObjectIcon name="materials" size={25}/>:<UiIcon name={icon} size={22}/>}<span>{label}</span></button>)}</nav>
        <details className="tk-work-actions tk-customer-summary"><summary>申请 <span>{top.requestedAmount.text}</span></summary><div>{[['建议额度',top.suggestedAmount],['建议期限',top.suggestedTerm],['参考价格',top.referencePrice]].map(([label,value]) => <p key={String(label)}>{String(label)} · <span>{(value as {text:string}).text}</span></p>)}</div></details>
        <button className="tk-btn small" onClick={() => openPanel('materials')}>补材料</button>
        <details className="tk-work-actions"><summary>办理</summary><div><button onClick={() => setDrawer({kind:'materialdesk'})}>整理材料</button><button onClick={() => setDrawer({kind:'timeline'})}>办理记录</button><button onClick={() => setDrawer({kind:'todos'})}>待办</button><button onClick={() => setDrawer({kind:'admission'})}>需求登记</button><button onClick={() => openPanel('proposal')}>建议方案</button><button onClick={() => setEndOpen(true)}>结束</button><span>{phaseText}</span></div></details>
        <button className="tk-role-identity" onClick={onLogout} title="切换角色"><RoleLogo role={role} size={23}/><span>{workRoleName(wb.session?.roles)}</span></button>
      </header>
      <WbError error={wb.error} onDismiss={() => wb.setError(null)} />
      <div className={`tk-unified-workspace${assistantCollapsed ? ' assistant-collapsed' : ''}`}>
        <main className="tk-page-content">
          <div className="tk-board-page" hidden={page!=='board'}><TakeoffBoard key={customerId} cells={cells} selected={drawer?.kind==='cell'?{domain:drawer.cell.domain,row:drawer.cell.row}:null} onSelect={openCell}/></div>
          {page==='materials'&&<MaterialsDesk key={`${wb.session?.sessionId}:${customerId}`} wb={wb} customerId={customerId} onUpload={()=>openPanel('materials')}/>}
          {page==='flow'&&<RoleFlow key={`${wb.session?.sessionId}:${customerId}`} wb={wb} cells={cells} top={top} onSelect={openCell}/>}
          {page==='records'&&<WorkTimeline key={customerId} wb={wb} customerId={customerId}/>}
        </main>
        <aside className="tk-global-assistant" aria-label="常驻助手">
          <button className="tk-edge-toggle" aria-label={assistantCollapsed ? '展开右侧助手' : '收起右侧助手'} aria-expanded={!assistantCollapsed} onClick={() => setAssistantCollapsed(v => !v)}>{assistantCollapsed ? '‹' : '›'}</button>
          <div className={`tk-assistant-shell${page==='flow'?' tk-canvas-assistant':''}`} hidden={assistantCollapsed}>
            <div id="tk-decision-detail-slot"/>
            <div className="tk-shared-assistants" hidden={page==='flow'}>
        <TakeoffAssistants
          key={`${wb.session?.sessionId}:${customerId}`}
          wb={wb}
          customerId={customerId}
          source={currentSource}
          onOpenMaterials={() => openPanel('materials')}
          cellContext={drawer?.kind === 'cell' ? `${takeoffDomainName(drawer.cell.domain)}·${takeoffRowName(drawer.cell.row)}` : null}
          focusAssistant={drawer?.kind === 'cell' ? drawer.cell.domain === 'opportunity' ? 'business' : drawer.cell.domain : undefined}
        />
            </div>
          </div>
        </aside>
      </div>

      {drawer !== null && (
        <>
          <div className="tk-drawer-veil" onClick={closeDrawer} />
          <div ref={drawerElement} tabIndex={-1} className="tk-drawer" role="dialog" aria-modal="true" aria-label={drawerTitle} style={{ width: zoomed ? '92%' : '46%', minWidth: 380 }} onKeyDown={(e) => {
            if (e.key === 'Escape') { e.stopPropagation(); closeDrawer(); }
            if (e.key !== 'Tab') return;
            const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex="0"]')).filter((el) => el.getClientRects().length > 0);
            const first = controls[0]; const last = controls[controls.length - 1];
            if (!first) { e.preventDefault(); return; }
            if (e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)) { e.preventDefault(); last.focus(); }
            if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          }}>
            <div className="tk-drawer-head">
              <h2>{drawerTitle}</h2>
              <span style={{ flex: 1 }} />
              <button className="tk-btn small ghost" onClick={() => setZoomed((z) => !z)}>{zoomed ? '还原' : '放大'}</button>
              <button className="tk-btn small ghost" onClick={closeDrawer}>关闭</button>
            </div>
            <div className="tk-drawer-body">
              {predecessor && <div className="tk-next-action"><span>前序事项还没处理好</span><button className="tk-btn" onClick={() => openCell(predecessor)}>先处理{{input:'材料',analysis:'分析',human:'核验',closure:'办结'}[predecessor.row]} <UiIcon name="arrow" size={18}/></button></div>}
              {drawer.kind === 'cell' && (
                <TakeoffCellDetail wb={wb} cell={drawer.cell} onOpenPanel={openPanel}
                  onOpenAssistant={closeDrawer} onViewMaterials={() => setDrawer({kind:'materialdesk'})} />
              )}
              {drawer.kind === 'panel' && drawer.panel === 'materials' && <MaterialsView wb={wb} customerId={customerId} />}
              {drawer.kind === 'panel' && drawer.panel === 'verify' && <VerifyPanel wb={wb} customerId={customerId} />}
              {drawer.kind === 'panel' && drawer.panel === 'qa' && <QaPanel wb={wb} customerId={customerId} />}
              {drawer.kind === 'panel' && drawer.panel === 'proposal' && <ProposalPanel wb={wb} customerId={customerId} />}
              {drawer.kind === 'panel' && drawer.panel === 'result' && <ResultPanel wb={wb} customerId={customerId} />}
              {drawer.kind === 'flow' && <FlowView cells={cells} top={top} />}
              {drawer.kind === 'records' && <RecordsView wb={wb} customerId={customerId} />}
              {drawer.kind === 'todos' && (
                <TodoView
                  source={todosSource}
                  cells={cells}
                  onGotoCell={(c) => { setDrawer({ kind: 'cell', cell: c }); setZoomed(false); }}
                  onOpenPanel={openPanel}
                />
              )}
              {drawer.kind === 'materialdesk' && <MaterialsDesk key={customerId} wb={wb} customerId={customerId} onUpload={() => openPanel('materials')}/>}
              {drawer.kind === 'timeline' && <WorkTimeline wb={wb} customerId={customerId}/>}
              {drawer.kind === 'customer' && <CustomerInfo wb={wb} />}
              {drawer.kind === 'admission' && <AdmissionRequestPanel wb={wb} onOpenProposal={() => openPanel('proposal')} />}
            </div>
          </div>
        </>
      )}

      {/* 动作确认对话框/错误条：全局单实例（结束撤回等动作在无抽屉时也须可确认） */}
      {act.node}

      {endOpen && (
        <EndDialog
          wb={wb}
          top={top}
          onClose={() => setEndOpen(false)}
          act={act}
        />
      )}
    </div>
  );
}

function CustomerInfo({ wb }: { wb: WbApi }) {
  const c = wb.snapshot?.customer ?? null;
  return (
    <div aria-label="客户主体信息">
      <div className="wb-card">
        <div className="wb-kv"><span className="k">客户名称</span><span>{c?.displayName ?? '名称待补充'}</span></div>
        <div className="wb-kv"><span className="k">状态</span><span>{c?.status === 'active' ? '正在协作' : '待核实'}</span></div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 结束（受控结论确认）：本轮终点=有权人员确认预评估结论。
// 正面/附条件/负面确认走 01 的 confirm-preassessment（§13 冻结契约；服务端重查权限/版本/硬门）；
// 行政撤回（客户撤回本轮）用既有 decide withdraw_assessment（superseded 语义），二次确认+幂等。
// 本对话框不产生/不激活任何正式授信设施，不调用 facility.approve。
// ---------------------------------------------------------------------------

type ConfirmOutcome = 'support' | 'support_with_conditions' | 'not_support';

function EndDialog({ wb, top, onClose, act }: {
  wb: WbApi;
  top: ReturnType<typeof deriveTakeoffTop>;
  onClose: () => void;
  act: ReturnType<typeof useAction>;
}) {
  const client = wb.client;
  const customerId = wb.customerId ?? '';
  const a = top.assessment;
  const confirmed = top.confirmed;
  const [outcome, setOutcome] = useState<ConfirmOutcome | null>(null);
  const [rationale, setRationale] = useState('');
  const [conditions, setConditions] = useState('');
  const [localErr, setLocalErr] = useState<string | null>(null);

  // 状态门只做诚实提示（页面不提权、不替服务端裁决）：正/附条件须 awaiting_human_review 且无未解冲突；
  // not_support 允许 collecting/candidate_ready/awaiting_human_review（有依据的负面终结不被冻结阻断）。
  const statusGate = (o: ConfirmOutcome): { ok: boolean; why: string } => {
    if (confirmed) return { ok: false, why: '本次预评估已经结束，不能重复确认或撤回。' };
    if (!client || !a.id || a.version == null) return { ok: false, why: '评估或版本信息未知：请刷新页面后重试' };
    if (o === 'not_support') {
      const ok = ['collecting', 'candidate_ready', 'awaiting_human_review'].includes(a.status ?? '');
      return { ok, why: ok ? '' : '当前评估不可再次确认，请刷新查看办理结果。' };
    }
    if (a.status !== 'awaiting_human_review') {
      return { ok: false, why: '请先在方案中提交复核，再确认结论。' };
    }
    if (a.stale || top.changedDomains.length > 0 || top.factConflicts > 0) {
      return { ok: false, why: '材料有变化或内容不一致，请先按待办补充材料并更新专业意见。' };
    }
    return { ok: true, why: '' };
  };

  const withdrawGate = confirmed
    ? { ok: false, why: '本次预评估已经结束，不能再撤回。' }
    : { ok: Boolean(a.id) && Boolean(client), why: a.id ? '' : '尚无在册评估可撤回' };

  const submit = (o: ConfirmOutcome) => {
    if (!client || !a.id || a.version == null) return;
    const assessmentId: string = a.id;
    const assessmentVersion: number = a.version;
    if (!rationale.trim()) { setLocalErr('请填写确认理由。'); return; }
    const conds = conditions.split('\n').map((x) => x.trim()).filter(Boolean);
    if (o === 'support_with_conditions' && conds.length === 0) { setLocalErr('附条件支持必须至少给出一条条件（服务端同口径拒绝）。'); return; }
    const requestId = wbActionRequestId('tk-confirm', customerId, `confirm:${o}`, String(Date.now()));
    act.open(
      {
        title: `确认：预评估结论——${CONFIRM_OUTCOME_LABEL[o]}`,
        lines: [
          '评估：本次首次回租预评估',
          `客户：${top.customer.displayName ?? '当前客户'}`,
          o === 'support_with_conditions' ? `条件（${conds.length} 条）：${conds.join('；')}` : '条件：无',
          `结论依据：${rationale.trim().slice(0, 80)}${rationale.trim().length > 80 ? '…' : ''}`,
          '本次仅确认预评估结论，不批准正式额度。',
          '由有权信审人员确认。',
        ],
        confirmLabel: '确认预评估结论',
        requestId,
      },
      async () => {
        await client.confirmPreassessment(assessmentId, {
          requestId,
          outcome: o,
          assessmentVersion,
          ...(a.candidateRevision != null ? { candidateRevision: a.candidateRevision } : {}),
          ...(o === 'support_with_conditions' ? { conditions: conds } : {}),
          rationale: rationale.trim(),
        });
        await wb.refresh();
        onClose();
      },
    );
  };

  const withdraw = () => {
    if (!client || !a.id) return;
    const requestId = wbActionRequestId('tk-end', customerId, 'withdraw_assessment', String(Date.now()));
    act.open(
      {
        title: '确认：行政撤回本轮首次预评估',
        lines: [
          `客户：${top.customer.displayName ?? '当前客户'}，本次预评估`,
          '语义：客户撤回=行政结束（superseded），不伪装风险拒绝，不删除客户档案与历史',
          '撤回不产生/不修改任何正式授信设施、融资申请或敞口账本',
        ],
        confirmLabel: '确认撤回本轮',
        requestId,
      },
      async () => {
        await client.action(`/api/jw/v2/actions/assessments/${encodeURIComponent(a.id!)}/decide`, {
          requestId, tenantId: 't1', decision: 'withdraw_assessment',
        });
        await wb.refresh();
        onClose();
      },
    );
  };

  const gates: Array<{ o: ConfirmOutcome; label: string; hint: string }> = [
    { o: 'support', label: '支持（正面预评估结论）', hint: '绑定当前候选修订与评估版本；快照内不得有未解决冲突' },
    { o: 'support_with_conditions', label: '附条件支持（调整条件后支持）', hint: '必须至少给出一条条件（服务端同口径拒绝）' },
    { o: 'not_support', label: '不支持（有依据的负面预评估结论）', hint: '负面终结不要求无价值工作刷绿；不适用正面硬门' },
  ];

  return (
    <div className="wb-dialog" role="dialog" aria-modal="true" aria-label="结束本次预评估（受控结论确认）">
      <div className="box" style={{ maxWidth: 620 }}>
        <h3>结束本次评估：受控预评估结论确认</h3>
        <ul>
          <li>客户：{top.customer.displayName ?? '—'}</li>
          <li>当前候选：{top.suggestedAmount.text}{top.suggestedTerm.text !== '待评估' ? ` · ${top.suggestedTerm.text}` : ''}</li>
          <li>{top.suggestedAmount.note}</li>
        </ul>
        {confirmed && (
          <div className={`wb-card ${confirmed.needsReview ? 'bad' : 'good'}`} role="status">
            <div className="wb-kv"><span className="k">已确认结论</span><span>{confirmed.outcomeLabel}</span></div>
            <div className="wb-kv"><span className="k">确认人/时间</span><span>{wb.identities?.find((person) => person.principalId === confirmed.confirmedBy)?.label ?? '有权信审人员'}{confirmed.confirmedAt ? ` · ${new Date(confirmed.confirmedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}</span></div>
            {confirmed.conditions.length > 0 && <div className="wb-kv"><span className="k">条件</span><span>{confirmed.conditions.join('；')}</span></div>}
            {confirmed.needsReview && <div className="wb-kv"><span className="k">需复核</span><span>{confirmed.reviewReason ?? '确认依据被取代'}（旧确认保留，只显示需复核，不默认重开）</span></div>}
          </div>
        )}
        <div className="tk-end-choices" role="group" aria-label="预评估结论">
          {gates.map((g) => {
            const gate = statusGate(g.o);
            const active = outcome === g.o;
            return (
              <div key={g.o} className="tk-end-choice" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{g.label}<span className="why" style={{ marginLeft: 8 }}>{g.hint}</span></span>
                  <button
                    className="tk-btn small"
                    disabled={!gate.ok}
                    title={gate.ok ? '' : gate.why}
                    onClick={() => { setOutcome(active ? null : g.o); setLocalErr(null); }}
                  >{active ? '收起' : '发起确认'}</button>
                </div>
                {!gate.ok && <div className="why">{gate.why}</div>}
                {active && gate.ok && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <textarea
                      className="wb-textarea"
                      rows={2}
                      value={rationale}
                      onChange={(e) => setRationale(e.target.value)}
                      placeholder="请填写结论依据"
                      aria-label="确认理由"
                    />
                    {g.o === 'support_with_conditions' && (
                      <textarea
                        className="wb-textarea"
                        rows={2}
                        value={conditions}
                        onChange={(e) => setConditions(e.target.value)}
                        placeholder={'放款前提条件（每行一条，至少一条）：如 补齐设备权属登记后生效'}
                        aria-label="确认条件"
                      />
                    )}
                    <div className="wb-actions">
                      <button className="tk-btn small primary" onClick={() => submit(g.o)}>进入二次确认</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <div className="tk-end-choice">
            <span>行政撤回（客户撤回本轮；与拒绝分开，不删客户）</span>
            <button className="tk-btn small" disabled={!withdrawGate.ok} onClick={withdraw} title={withdrawGate.why}>撤回本轮</button>
          </div>
        </div>
        <WbError error={localErr} onDismiss={() => setLocalErr(null)} />
        <p className="wb-note">本次仅确认预评估结论，不批准正式额度。后续材料发生重要变化时，需要重新复核。</p>
        <div className="wb-actions">
          <button className="tk-btn small ghost" onClick={onClose}>取消（继续办理）</button>
        </div>
      </div>
    </div>
  );
}
