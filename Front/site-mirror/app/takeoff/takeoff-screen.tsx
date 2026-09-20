import { workRoleName } from './role-entry';
// TAKEOFF-FA-1.0.0 · 主屏（02路）：顶部客户与同版候选方案摘要；左侧二十格看板（~80%）；
// 右侧六助手（~20%）；两主体区向下铺满。流程/记录/材料/待办只做入口（抽屉内消费同源记录）。
// 数据：workspace 快照 + A artifacts/处理通道/依据包详情 真实读面；格子=只读投影，点击看真实事项。
// 结束=受控预评估结论确认：三类结论走 A confirm-preassessment（§13，绑定版本/候选修订+服务端硬门）；
// 行政撤回走既有 decide withdraw_assessment；绝不调用 facility.approve（本轮默认路径无正式额度操作）。
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import type { TakeoffCellView, TakeoffSource } from '../../lib/workbench/takeoff-projection';
import { CONFIRM_OUTCOME_LABEL, deriveTakeoffCells, deriveTakeoffTop, takeoffDomainName, takeoffRowName } from '../../lib/workbench/takeoff-projection';
import { wbActionRequestId } from '../../lib/workbench/wb-logic';
import { TakeoffBoard } from './takeoff-board';
import { TakeoffCellDetail } from './takeoff-detail';
import { TakeoffAssistants } from './takeoff-assistants';
import { FlowView, MaterialsView, RecordsView, TodoView, type PanelKey } from './takeoff-aux';
import { CustomerPortal } from '../workbench/customer-portal';
import { VerifyPanel } from '../workbench/verify-panel';
import { QaPanel } from '../workbench/qa-panel';
import { ProposalPanel } from '../workbench/proposal-panel';
import { ResultPanel } from '../workbench/result-panel';
import { WbError, useAction } from '../workbench/wb-parts';
import './takeoff.css';

type DrawerView =
  | { kind: 'cell'; cell: TakeoffCellView }
  | { kind: 'panel'; panel: PanelKey }
  | { kind: 'flow' }
  | { kind: 'records' }
  | { kind: 'todos' }
  | { kind: 'customer' }
  | null;

const PANEL_TITLE: Record<PanelKey, string> = {
  materials: '材料·上传与处理链（A 权威清单同源）',
  verify: '核验（检查会话覆盖与留痕）',
  qa: '问题·补证（服务端线程）',
  proposal: '方案·决定（依据包/域意见/候选）',
  result: '结果·对账（回执与报告）',
};

export function TakeoffScreen({ wb, onBackToDirectory, onLogout }: {
  wb: WbApi;
  onBackToDirectory: () => void;
  onLogout: () => void;
}) {
  const customerId = wb.customerId;
  const [drawer, setDrawer] = useState<DrawerView>(null);
  const [zoomed, setZoomed] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [source, setSource] = useState<TakeoffSource>({ snapshot: null, packageDetail: null, channelTasks: [], currentMaterials: null, factConflicts: 0 });
  const act = useAction();

  useEffect(() => { setDrawer(null); setEndOpen(false); }, [customerId]);

  // 真实读面装配：artifacts（现行件数/冲突）+ 处理通道任务 + 依据包详情（域结果/采用）。
  // 读取失败 → 对应计数=null/空，投影如实显示未知，不冒充 0。
  const loadSource = useCallback(async () => {
    const client = wb.client;
    if (!client || !customerId) return;
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
    setSource(next);
  }, [wb.client, wb.snapshot, customerId]);

  useEffect(() => { void loadSource(); }, [loadSource, wb.snapshotVersion]);

  const cells = useMemo(() => deriveTakeoffCells(source), [source]);
  const top = useMemo(() => deriveTakeoffTop(source), [source]);
  const todosSource = source;

  if (!customerId) return null;
  // 客户联系人身份（roles=['customer']）：受限客户门户（保留既有真实门户，不呈现内部看板）。
  if ((wb.session?.roles ?? []).every((r) => r === 'customer')) {
    return <CustomerPortal wb={wb} customerId={customerId} onLogout={onLogout} />;
  }

  const phaseText = wb.phase === 'live' ? '实时连接' : wb.phase === 'reconnecting' ? '重连中' : wb.phase === 'connecting' ? '连接中' : '未连接';

  const openCell = (c: TakeoffCellView) => { setDrawer({ kind: 'cell', cell: c }); };
  const openPanel = (k: PanelKey) => { setDrawer({ kind: 'panel', panel: k }); };
  const closeDrawer = () => { setDrawer(null); setZoomed(false); };

  const drawerTitle = drawer === null ? ''
    : drawer.kind === 'cell' ? `${takeoffDomainName(drawer.cell.domain)} · ${takeoffRowName(drawer.cell.row)} 格事项`
    : drawer.kind === 'panel' ? PANEL_TITLE[drawer.panel]
    : drawer.kind === 'flow' ? '办理流程'
    : drawer.kind === 'records' ? '办理记录'
    : drawer.kind === 'todos' ? '待办事项'
    : '客户主体信息';

  return (
    <div className="tk-root">
      <header className="tk-top">
        <div className="tk-summary">
          <button className="tk-cust-name" onClick={() => setDrawer({ kind: 'customer' })} title={top.customer.displayName || '客户详情'}>{top.customer.displayName || '客户工作区'}</button>
          <div className="tk-summary-fields">
            {[['申请金额', top.requestedAmount], ['建议额度', top.suggestedAmount], ['建议期限', top.suggestedTerm], ['参考价格', top.referencePrice], ['预计', top.expect]].map(([label, value]) => {
              const field = value as { text: string; note?: string };
              return <span className="tk-kv" key={String(label)} title={field.note}><span className="k">{String(label)}</span><span className="v">{field.text}</span></span>;
            })}
          </div>
          <button className="tk-btn small ghost tk-role-switch" onClick={onLogout}>{workRoleName(wb.session?.roles)} · 切换角色</button>
        </div>
        <div className="tk-workbar">
          <span className="tk-context-label">首次回租 · 准入预评估</span>
          <button className="tk-plan-link" onClick={() => openPanel('proposal')} title={top.planMarks.join(' · ')}>{top.changedDomains.length ? '方案待复核' : '查看建议方案'} ↗</button>
          <span className="tk-top-entries">
            {wb.phase !== 'live' && <span className="tk-badge">{phaseText}</span>}
            <button className="tk-btn small ghost" onClick={() => setDrawer({ kind: 'flow' })}>流程</button>
            <button className="tk-btn small ghost" onClick={() => setDrawer({ kind: 'records' })}>记录</button>
            <button className="tk-btn small ghost" onClick={() => openPanel('materials')}>材料</button>
            <button className="tk-btn small ghost" onClick={() => setDrawer({ kind: 'todos' })}>待办</button>
            <button className="tk-btn small ghost" onClick={onBackToDirectory}>切换客户</button>
            <button className="tk-btn small primary" onClick={() => setEndOpen(true)}>结束</button>
          </span>
        </div>
      </header>
      <WbError error={wb.error} onDismiss={() => wb.setError(null)} />
      <div className="tk-body">
        <TakeoffBoard cells={cells} selected={drawer?.kind === 'cell' ? { domain: drawer.cell.domain, row: drawer.cell.row } : null} onSelect={openCell} />
        <TakeoffAssistants
          wb={wb}
          customerId={customerId}
          source={source}
          onOpenMaterials={() => openPanel('materials')}
          cellContext={drawer?.kind === 'cell' ? `${takeoffDomainName(drawer.cell.domain)}·${takeoffRowName(drawer.cell.row)}` : null}
        />
      </div>

      {drawer !== null && (
        <>
          <div className="tk-drawer-veil" onClick={closeDrawer} />
          <div className="tk-drawer" role="dialog" aria-modal="true" aria-label={drawerTitle} style={{ width: zoomed ? '92%' : '46%', minWidth: 380 }}>
            <div className="tk-drawer-head">
              <h2>{drawerTitle}</h2>
              <span style={{ flex: 1 }} />
              <button className="tk-btn small ghost" onClick={() => setZoomed((z) => !z)}>{zoomed ? '还原' : '放大'}</button>
              <button className="tk-btn small ghost" onClick={closeDrawer}>关闭</button>
            </div>
            <div className="tk-drawer-body">
              {drawer.kind === 'cell' && (
                <TakeoffCellDetail wb={wb} cell={drawer.cell} onOpenPanel={openPanel} />
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
              {drawer.kind === 'customer' && <CustomerInfo wb={wb} />}
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
        <div className="wb-kv"><span className="k">客户ID</span><span>{c?.customerId ?? '—'}（稳定唯一；简称不作数据库键）</span></div>
        <div className="wb-kv"><span className="k">展示名</span><span>{c?.displayName ?? '—'}（四字简称只是展示名）</span></div>
        <div className="wb-kv"><span className="k">状态</span><span>{c?.status ?? '—'}</span></div>
        <div className="wb-kv"><span className="k">主体标识</span><span>企业全称与统一社会信用代码待01客户主档字段投影（当前读面未含：如实标注，不猜全称）</span></div>
        <p className="wb-note">不同主体同名不能自动合并：以客户ID与主体标识为准（服务端授权确定当前客户）。</p>
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
    if (confirmed) return { ok: false, why: '预评估结论已确认为终态：不可重复确认（撤回同样不再受理，服务端 NOT_READY）' };
    if (!client || !a.id || a.version == null) return { ok: false, why: '评估或版本信息未知：请刷新页面后重试' };
    if (o === 'not_support') {
      const ok = ['collecting', 'candidate_ready', 'awaiting_human_review'].includes(a.status ?? '');
      return { ok, why: ok ? '' : `评估当前 ${a.status ?? '未知'}：已终结/已确认，不可再记录负面结论` };
    }
    if (a.status !== 'awaiting_human_review') {
      return { ok: false, why: `评估当前 ${a.status ?? '未知'}：正/附条件确认前须先提交人工审阅（方案·决定页「提交复核」；服务端 NOT_READY 同口径）` };
    }
    if (a.stale || top.changedDomains.length > 0 || top.factConflicts > 0) {
      return { ok: false, why: '存在依据变化/未解决事实冲突：先按待办补证、更新域结论（服务端 STALE_BASIS/REVIEW_REQUIRED 同口径；不可豁免门不能一键解除）' };
    }
    return { ok: true, why: '' };
  };

  const withdrawGate = confirmed
    ? { ok: false, why: '已确认的预评估结论为终态：行政撤回不再受理（服务端 NOT_READY）' }
    : { ok: Boolean(a.id) && Boolean(client), why: a.id ? '' : '尚无在册评估可撤回' };

  const submit = (o: ConfirmOutcome) => {
    if (!client || !a.id || a.version == null) return;
    const assessmentId: string = a.id;
    const assessmentVersion: number = a.version;
    if (!rationale.trim()) { setLocalErr('确认理由（rationale）必填：记录当前版本结论的依据（正式性属人）。'); return; }
    const conds = conditions.split('\n').map((x) => x.trim()).filter(Boolean);
    if (o === 'support_with_conditions' && conds.length === 0) { setLocalErr('附条件支持必须至少给出一条条件（服务端同口径拒绝）。'); return; }
    const requestId = wbActionRequestId('tk-confirm', customerId, `confirm:${o}`, String(Date.now()));
    act.open(
      {
        title: `确认：预评估结论——${CONFIRM_OUTCOME_LABEL[o]}`,
        lines: [
          `评估：${a.id}（版本 v${a.version}${a.candidateRevision != null ? ` · 候选 r${a.candidateRevision}` : ' · 无候选'}${a.inputVersion != null ? ` · 输入 v${a.inputVersion}` : ''}）`,
          `客户：${top.customer.displayName ?? '—'}（${top.customer.customerId ?? '—'}）`,
          o === 'support_with_conditions' ? `条件（${conds.length} 条）：${conds.join('；')}` : '条件：无（附条件只属于 support_with_conditions）',
          `结论依据：${rationale.trim().slice(0, 80)}${rationale.trim().length > 80 ? '…' : ''}`,
          'scope=preassessment_only：不创建/激活/预占任何额度、不建融资申请、不写敞口账本（服务端机器断言零变化）',
          '确认权=服务端目录 credit 角色（服务端重查人类身份与版本/硬门；无权限将得到业务语言拒绝）',
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
          `对象：评估 ${a.id.slice(0, 22)}…（客户 ${customerId.slice(0, 16)}…）`,
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
          <li>客户：{top.customer.displayName ?? '—'}（{top.customer.customerId ?? '—'}）</li>
          <li>当前候选：{top.suggestedAmount.text}{top.suggestedTerm.text !== '待评估' ? ` · ${top.suggestedTerm.text}` : ''}（金额/期限/价格绑定同一方案版本{a.candidateRevision != null ? `，候选 r${a.candidateRevision}` : ''}）</li>
          <li>{top.suggestedAmount.note}</li>
        </ul>
        {confirmed && (
          <div className={`wb-card ${confirmed.needsReview ? 'bad' : 'good'}`} role="status">
            <div className="wb-kv"><span className="k">已确认结论</span><span>{confirmed.outcomeLabel}（{confirmed.confirmationId ?? 'confirmationId 未知'}）</span></div>
            <div className="wb-kv"><span className="k">确认人/时间</span><span>{confirmed.confirmedBy ?? '有权人'}{confirmed.confirmedAt ? ` · ${new Date(confirmed.confirmedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}</span></div>
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
                      placeholder="确认理由（rationale，必填）：当前版本结论依据哪些材料/事实/域结论"
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
        <p className="wb-note">确认≠正式授信批准≠额度激活≠可提款；确认后不修改信用设施、融资申请或敞口账本（scope=preassessment_only，服务端机器断言）。后续重要证据推翻确认依据时，旧确认保留、只显示需复核，不默认重开。</p>
        <div className="wb-actions">
          <button className="tk-btn small ghost" onClick={onClose}>取消（继续办理）</button>
        </div>
      </div>
    </div>
  );
}
