// 履约·结清·返单面板（2026-09-30-final · 01-front）：客户周期（cycles）页面动作。
// 接口=TASK3_INTERFACES §6（GET cycles + fulfill/external-receipt/settle/close + reorderOf 返单）。
// 展示纪律：awaiting_external_receipt 必须显示"待外部回执（外部收付款未连接）"，不得显示已完成；
// 未确认回执时 settle 不可发（页面禁用+服务端 409 双保险）；模拟回执须来源明确，不冒充实际收款；
// 返单=开启独立新周期（reorderOf），历史不覆盖。全部动作二次确认 + requestId 幂等。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import { wbActionRequestId } from '../../lib/workbench/wb-logic';
import { WbError, useAction } from '../workbench/wb-parts';

interface CycleRow {
  cycleId?: string;
  state?: string;
  reorderOfCycleId?: string | null;
  externalReceipt?: { ref?: string; source?: string; recordedBy?: string } | null;
  createdAt?: string;
  settledAt?: string | null;
  closedAt?: string | null;
  [key: string]: unknown;
}

const STATE_LABEL: Record<string, string> = {
  open: '进行中（履约办理）', active: '进行中（履约办理）', fulfilled: '履约完成，待回执',
  awaiting_external_receipt: '待外部回执（外部收付款未连接）', external_receipt_recorded: '回执已登记，可结清',
  ready_to_settle: '回执已登记，可结清', settled: '已结清', closed: '已关闭', reordered: '已由新周期接续',
};

function canFulfill(s: string | undefined) { return ['open', 'active'].includes(s ?? ''); }
function canReceipt(s: string | undefined) { return s === 'awaiting_external_receipt'; }
function canSettle(s: string | undefined) { return ['external_receipt_recorded', 'ready_to_settle'].includes(s ?? ''); }
function canClose(s: string | undefined) { return s === 'settled'; }

export function CyclesPanel({ wb, customerId }: { wb: WbApi; customerId: string }) {
  const client = wb.client;
  const [cycles, setCycles] = useState<CycleRow[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [receiptRef, setReceiptRef] = useState('');
  const [receiptSource, setReceiptSource] = useState('模拟演练回执（外部收付款未连接）');
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reorderNote, setReorderNote] = useState('');
  const seq = useRef(0);
  const act = useAction();

  const load = useCallback(async () => {
    if (!client?.listCycles) { setLoadErr('周期服务未接通（本环境未启用履约周期）。'); return; }
    const my = ++seq.current;
    setLoadErr(null);
    try {
      const j = await client.listCycles(customerId);
      if (my !== seq.current) return;
      setCycles(Array.isArray(j.cycles) ? j.cycles as CycleRow[] : Array.isArray(j) ? j as CycleRow[] : []);
    } catch (e) {
      if (my !== seq.current) return;
      const err = e as { status?: number };
      setLoadErr(err.status === 404 ? '周期服务未开通：当前环境未启用履约/结清/返单。' : '周期清单读取失败：服务端不可达或无权限。');
      setCycles(null);
    }
  }, [client, customerId]);
  useEffect(() => { void load(); return () => { seq.current += 1; }; }, [load]);

  const runCycleAction = (cycle: CycleRow, action: 'fulfill' | 'settle' | 'close') => {
    if (!client || !cycle.cycleId) return;
    const id = cycle.cycleId;
    const titles = {
      fulfill: { title: '确认：履约完成', lines: [`周期 ${id.slice(0, 12)}…`, '标记本周期租赁履约完成；此后进入"待外部回执"状态。'], label: '履约完成' },
      settle: { title: '确认：结清本周期', lines: [`周期 ${id.slice(0, 12)}…`, '前提：外部回执已确认。结清后本周期进入可关闭状态。'], label: '结清' },
      close: { title: '确认：关闭本周期', lines: [`周期 ${id.slice(0, 12)}…`, '关闭为行政收尾；历史记录保留，可在关闭后开启返单新周期。'], label: '关闭周期' },
    }[action];
    const requestId = wbActionRequestId('cycle', customerId, `${action}:${id}`, String(Date.now()));
    act.open(
      { ...titles, confirmLabel: titles.label, requestId },
      async () => {
        setBusyId(id);
        try {
          if (action === 'fulfill') await client.fulfillCycle(customerId, id, requestId);
          if (action === 'settle') await client.settleCycle(customerId, id, requestId);
          if (action === 'close') await client.closeCycle(customerId, id, requestId);
          await load();
          await wb.refresh();
        } finally { setBusyId(null); }
      },
    );
  };

  const registerReceipt = (cycle: CycleRow) => {
    if (!client || !cycle.cycleId) return;
    if (!receiptRef.trim()) { setFormErr('请填写回执编号/凭据号（模拟回执也须来源可追溯）。'); return; }
    const id = cycle.cycleId;
    const requestId = wbActionRequestId('cycle', customerId, `receipt:${id}`, String(Date.now()));
    act.open(
      {
        title: '确认：登记外部回执（模拟演练）',
        lines: [
          `周期 ${id.slice(0, 12)}…`,
          `回执编号：${receiptRef.trim()}`,
          `来源：${receiptSource.trim() || '未声明'}`,
          '外部收付款系统未连接：本回执为受控模拟演练记录，不冒充实际收款；结清以此回执确认为前提。',
        ],
        confirmLabel: '登记回执',
        requestId,
      },
      async () => {
        setBusyId(id);
        try {
          await client.recordExternalReceipt(customerId, id, { requestId, ref: receiptRef.trim(), source: receiptSource.trim() || undefined });
          setReceiptRef('');
          await load();
          await wb.refresh();
        } finally { setBusyId(null); }
      },
    );
  };

  const reorder = (cycle: CycleRow) => {
    if (!client || !cycle.cycleId) return;
    const id = cycle.cycleId;
    const requestId = wbActionRequestId('cycle', customerId, `reorder:${id}`, String(Date.now()));
    act.open(
      {
        title: '确认：继续返单办理',
        lines: [
          `以前序周期 ${id.slice(0, 12)}… 继续办理返单`,
          '先发起新一轮五区评审；确认全部专业意见后，再继续本动作开启独立新周期。旧周期历史保留。',
        ],
        confirmLabel: '继续返单办理',
        requestId,
      },
      async () => {
        setBusyId(id);
        try {
          const plan = await client.advance.plan(customerId, 'business');
          if (plan.priorCase && plan.priorCase.processId === cycle.sourceProcessId) {
            if (!plan.available || plan.allowedActions.some(a => a.requiresHumanConfirmation)) throw new Error(plan.reason || '请先完成当前专业确认');
            await client.advance.advance(customerId, plan, requestId);
            setReorderNote('返单评审已开始。请在平台页逐专业核对并确认新一轮意见，五区完成后再开启新周期；原周期记录保留。');
            window.dispatchEvent(new CustomEvent('jw:round-supplement', { detail: { customerId, domain: 'business' } }));
          } else {
            await client.createCycle(customerId, { requestId, reorderOf: id });
            setReorderNote('返单新周期已开启，五区依据与原周期历史分别保留。');
          }
          await load();
          await wb.refresh();
        } finally { setBusyId(null); }
      },
    );
  };

  if (!client) return null;
  return <div aria-label="履约·结清·返单">
    <h3 className="wb-h2">履约周期（本客户）</h3>
    <WbError error={loadErr} onDismiss={() => setLoadErr(null)} />
    {!loadErr && cycles === null && <p className="wb-note">正在读取周期…</p>}
    {Array.isArray(cycles) && cycles.length === 0 && <p className="wb-note">本客户尚无履约周期：预评估收口后可开启周期办理履约/结清/返单。</p>}
    {(cycles ?? []).map((c) => {
      const id = String(c.cycleId ?? '—');
      const state = c.state === 'awaiting_external_receipt' && c.externalReceipt ? 'ready_to_settle' : c.state ? String(c.state) : undefined;
      const label = STATE_LABEL[state ?? ''] ?? (state ? `状态：${state}` : '状态未知');
      const busy = busyId === id;
      return <div key={id} className="wb-card">
        <div className="wb-row"><strong>周期 {id.slice(0, 14)}{id.length > 14 ? '…' : ''}</strong><span className="wb-badge off">{label}</span></div>
        {c.reorderOfCycleId ? <div className="wb-sub">返单周期 · 前序 {String(c.reorderOfCycleId).slice(0, 14)}…</div> : null}
        {c.externalReceipt && <div className="wb-note">回执：{c.externalReceipt.ref} · 来源：{c.externalReceipt.source || '未声明'} · 登记人员见办理记录</div>}
        {canReceipt(state) && <div className="wb-note">外部收付款未连接：登记受控模拟回执后才能结清（服务端同样拦截未确认结清）。</div>}
        {canReceipt(state) && <div className="wb-row" style={{ marginTop: 6 }}>
          <div className="wb-field" style={{ width: 220 }}><label>回执编号/凭据号</label>
            <input className="wb-input" aria-label="回执编号" value={receiptRef} onChange={(e) => setReceiptRef(e.target.value)} placeholder="如 SIM-RECEIPT-0001" />
          </div>
          <div className="wb-field" style={{ flex: 1 }}><label>回执来源</label>
            <input className="wb-input" aria-label="回执来源" value={receiptSource} onChange={(e) => setReceiptSource(e.target.value)} />
          </div>
        </div>}
        <div className="wb-actions">
          {canFulfill(state) && <button className="wb-btn small" disabled={busy} onClick={() => runCycleAction(c, 'fulfill')}>履约完成</button>}
          {canReceipt(state) && <button className="wb-btn small" disabled={busy} onClick={() => registerReceipt(c)}>登记外部回执…</button>}
          {canSettle(state) && <button className="wb-btn small" disabled={busy} onClick={() => runCycleAction(c, 'settle')}>结清</button>}
          {canClose(state) && <button className="wb-btn small ghost" disabled={busy} onClick={() => runCycleAction(c, 'close')}>关闭周期</button>}
          {['settled', 'closed'].includes(state ?? '') && <button className="wb-btn small" disabled={busy} onClick={() => reorder(c)}>返单（新周期）</button>}
        </div>
      </div>;
    })}
    <WbError error={formErr} onDismiss={() => setFormErr(null)} />
    {act.node}
    {reorderNote && <p role="status">{reorderNote}</p>}
    <p className="wb-note">确认回执后方可结清。返单须先完成新一轮五区评审，原周期和材料历史始终保留。本演示的回执为明确标注来源的模拟记录。</p>
  </div>;
}
