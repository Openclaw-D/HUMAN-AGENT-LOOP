// TAKEOFF-FA-1.0.0 · 辅助页（02_FRONTEND_SPEC §6）：只通过顶栏入口进入，相同业务记录的投影，
// 不保存另一份可独立修改的办理状态。
// - 流程：从左到右只读依赖图，节点固定布局、按钮缩放+水平滚动；不可拖节点/编辑连线；
//   显示并行依赖（资产与信审并列）与阻断，不伪装严格流水线。
// - 记录：从早到晚纵向时间轴（A events-page 分页直读）；可定位最新。
// - 材料：A 权威清单复用 OriginalsPanel（上传/预览/处理状态）+ 受限邀请入口。
// - 待办：谁处理/处理什么/什么证据算完成/当前可执行动作；点击回原格子。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import type { TakeoffCellView, TakeoffDomainId, TakeoffSource, TakeoffTodoRow } from '../../lib/workbench/takeoff-projection';
import { TAKEOFF_DOMAINS, deriveTakeoffTodos, takeoffDomainName } from '../../lib/workbench/takeoff-projection';
import { OriginalsPanel } from '../workbench/originals-panel';
import { InvitationsPanel } from '../workbench/invitations-panel';
import { WbError } from '../workbench/wb-parts';

export type PanelKey = 'materials' | 'verify' | 'qa' | 'proposal' | 'result';

// ---------------------------------------------------------------------------
// 流程（只读）
// ---------------------------------------------------------------------------

const LANE_GAP = 52;
const FLOW_W = 860;
const FLOW_H = 60 + TAKEOFF_DOMAINS.length * LANE_GAP;

interface FlowNode { id: string; x: number; y: number; w: number; h: number; label: string; state: 'done' | 'active' | 'pending' | 'frozen' | 'na'; title: string }

export function FlowView({ cells, top }: { cells: TakeoffCellView[]; top: { changedDomains: TakeoffDomainId[]; gateResult: string | null; confirmed?: { outcomeLabel?: string; needsReview?: boolean } | null } }) {
  const [zoom, setZoom] = useState(1);
  const byKey = new Map(cells.map((c) => [`${c.domain}:${c.row}`, c]));
  const stateOf = (d: TakeoffDomainId, row: 'input' | 'analysis' | 'human' | 'closure'): FlowNode['state'] => {
    const c = byKey.get(`${d}:${row}`);
    if (!c) return 'pending';
    if (c.frozen) return 'frozen';
    if (c.completed) return 'done';
    if (c.running) return 'active';
    return 'pending';
  };
  const nodes: FlowNode[] = [];
  const edges: Array<{ x1: number; y1: number; x2: number; y2: number; dashed?: boolean }> = [];
  const nx = [64, 210, 356, 502];
  TAKEOFF_DOMAINS.forEach((d, i) => {
    const y = 40 + i * LANE_GAP;
    const isOpp = d.id === 'opportunity';
    const states: Array<FlowNode['state']> = isOpp
      ? [stateOf(d.id, 'input'), 'na', 'na', stateOf(d.id, 'closure')]
      : [stateOf(d.id, 'input'), stateOf(d.id, 'analysis'), stateOf(d.id, 'human'), stateOf(d.id, 'closure')];
    const labels = isOpp
      ? ['需求/主体输入', '分析（待接入）', '人工（待接入）', '域收口（待接入）']
      : ['材料输入', '分析/智能', '人工核验', '域收口'];
    labels.forEach((label, j) => {
      nodes.push({
        id: `${d.id}-${j}`, x: nx[j], y, w: 108, h: 30, label,
        state: states[j],
        title: `${takeoffDomainName(d.id)} · ${label}（${states[j] === 'done' ? '完成' : states[j] === 'active' ? '进行中' : states[j] === 'frozen' ? '冻结' : states[j] === 'na' ? '待接入' : '未开始/未知'}）`,
      });
      if (j > 0) edges.push({ x1: nx[j - 1] + 108, y1: y + 15, x2: nx[j], y2: y + 15, dashed: isOpp && j > 0 });
    });
  });
  const midY = 40 + ((TAKEOFF_DOMAINS.length - 1) / 2) * LANE_GAP + 15;
  const hasBasis = byKey.get('credit:closure')?.basis.includes('（依据包') ?? false;
  nodes.push({ id: 'freeze', x: 640, y: midY - 15, w: 96, h: 30, label: '依据包冻结', state: top.changedDomains.length > 0 ? 'frozen' : hasBasis ? 'done' : 'pending', title: `依据包冻结（${hasBasis ? '已有冻结包；受变化影响的域以霜标注' : '未冻结'}）` });
  nodes.push({ id: 'confirm', x: 768, y: midY - 15, w: 88, h: 30, label: '预评估确认', state: top.confirmed ? 'done' : 'pending', title: top.confirmed ? `预评估结论已确认（${top.confirmed.outcomeLabel}，scope=preassessment_only${top.confirmed.needsReview ? '；需复核' : ''}）` : '预评估确认（终点=有权人员在「结束」对话框确认；不借正式批准）' });
  TAKEOFF_DOMAINS.forEach((d, i) => {
    const y = 40 + i * LANE_GAP + 15;
    edges.push({ x1: nx[3] + 108, y1: y, x2: 640, y2: midY });
  });
  edges.push({ x1: 736, y1: midY, x2: 768, y2: midY, dashed: true });
  const fill = (s: FlowNode['state']) => s === 'done' ? 'var(--tk-done)' : s === 'active' ? 'var(--tk-progress-soft)' : s === 'frozen' ? 'var(--tk-white)' : 'color-mix(in srgb, var(--tk-white) 70%, var(--tk-paper))';
  const stroke = (s: FlowNode['state']) => s === 'done' ? 'var(--tk-done)' : s === 'frozen' ? 'var(--tk-white)' : s === 'na' ? 'var(--tk-line)' : 'var(--tk-dim)';
  return (
    <div>
      <div className="tk-flow-zoom">
        <span className="tk-asst-note">只读依赖/办理图：节点固定布局；同域内部“取得材料→分析→人工→收口”有实际前置，域与域之间并行（资产不等待商务）。不可拖动节点或编辑连线。</span>
        <span style={{ flex: 1 }} />
        <button className="tk-btn small" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(2)))} aria-label="缩小流程图">－</button>
        <span className="tk-asst-note">{Math.round(zoom * 100)}%</span>
        <button className="tk-btn small" onClick={() => setZoom((z) => Math.min(2, +(z + 0.2).toFixed(2)))} aria-label="放大流程图">＋</button>
      </div>
      <div className="tk-flow-scroll">
        <svg width={FLOW_W * zoom} height={FLOW_H * zoom} viewBox={`0 0 ${FLOW_W} ${FLOW_H}`} role="img" aria-label="首次预评估只读流程图（并行依赖与阻断如实呈现）">
          {edges.map((e, i) => (
            <line key={i} className="tk-flow-edge" x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} strokeDasharray={e.dashed ? '4 3' : undefined} />
          ))}
          {nodes.map((n) => (
            <g key={n.id} className="tk-flow-node">
              <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={8} fill={fill(n.state)} stroke={stroke(n.state)} strokeWidth={n.state === 'frozen' ? 2.5 : 1.2}>
                <title>{n.title}</title>
              </rect>
              <text x={n.x + n.w / 2} y={n.y + 19} textAnchor="middle">{n.label}</text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 记录（A events-page 分页直读；从早到晚，可定位最新）
// ---------------------------------------------------------------------------

export function RecordsView({ wb, customerId }: { wb: WbApi; customerId: string }) {
  const [events, setEvents] = useState<Array<{ eventId: string; type: string; at: string | null; seq: string }>>([]);
  const [err, setErr] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>('0');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const loadPage = useCallback(async (afterSeq: string, append: boolean) => {
    if (!wb.client) return;
    setLoading(true);
    setErr(null);
    try {
      const j = await wb.client.eventsPage(customerId, afterSeq, 200);
      const items = (Array.isArray(j.events) ? j.events : []).map((e) => ({
        eventId: String(e.eventId ?? ''),
        type: String(e.payloadRef?.type ?? '未知类型'),
        at: extractAt(e.payload),
        seq: String(e.aggregateVersion ?? ''),
      }));
      setEvents((prev) => (append ? [...prev, ...items] : items));
      setAfter(j.nextAfterSeq ?? null);
      setHasMore(j.hasMore === true);
    } catch (e) {
      setErr(`事件窗口读取失败：${(e as { code?: string }).code ?? ''}（记录以服务端为准，不本地补写）`);
    } finally {
      setLoading(false);
    }
  }, [wb.client, customerId]);

  useEffect(() => { void loadPage('0', false); }, [loadPage]);

  const locateLatest = () => { endRef.current?.scrollIntoView({ block: 'nearest' }); };

  return (
    <div aria-label="记录（从早到晚时间轴）">
      <div className="tk-row" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <span className="tk-asst-note">记录=材料、事实、分析、方案与人工操作的服务端事件投影（同源，不另存状态）。方案变更显示增减；报价建议变更≠正式额度批准。</span>
        <span style={{ flex: 1 }} />
        <button className="tk-btn small" onClick={locateLatest}>定位最新</button>
        {hasMore && <button className="tk-btn small" disabled={loading} onClick={() => after && void loadPage(after, true)}>{loading ? '读取中…' : '载入更早历史'}</button>}
      </div>
      <WbError error={err} onDismiss={() => setErr(null)} />
      {events.length === 0 && !err && <p className="tk-asst-note">{loading ? '读取中…' : '窗口内暂无事件记录。'}</p>}
      <div className="tk-tl">
        {events.map((e) => (
          <div key={e.eventId} className="tk-tl-item">
            <div>{EVENT_TYPE_TEXT[e.type] ?? e.type}</div>
            <div className="tk-t">{e.at ? new Date(e.at).toLocaleString('zh-CN', { hour12: false }) : '时间未记录'} · seq {e.seq}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

const EVENT_TYPE_TEXT: Record<string, string> = {
  customer_created: '客户建档', customer_grant_created: '客户授权登记', relationship_declared: '关系登记',
  artifact_registered: '材料登记', assessment_created: '评估创建', assessment_candidate: '候选方案登记（authority=none）',
  assessment_submitted: '评估送审', assessment_decided: '评估决定（拒绝/撤回）',
  facility_proposed: '额度提案（历史兼容面）', domain_result_recorded: '包域结果登记', package_frozen: '依据包冻结',
};

function extractAt(payload: unknown): string | null {
  if (payload && typeof payload === 'object') {
    const at = (payload as { at?: unknown; occurredAt?: unknown }).at ?? (payload as { occurredAt?: unknown }).occurredAt;
    if (typeof at === 'string') return at;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 材料（复用 OriginalsPanel + 受限邀请入口）
// ---------------------------------------------------------------------------

export function MaterialsView({ wb, customerId }: { wb: WbApi; customerId: string }) {
  const [showInvitations, setShowInvitations] = useState(false);
  return (
    <div aria-label="材料（A 权威清单同源投影）">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <button className="tk-btn small" aria-pressed={showInvitations} onClick={() => setShowInvitations((v) => !v)}>
          {showInvitations ? '← 返回材料清单' : '受限邀请（客户人员授权）'}
        </button>
        <span className="tk-asst-note">上传只有一个入口（下方统一提交链）；清单/预览/处理状态为 A 档案同源投影。</span>
      </div>
      {showInvitations
        ? <InvitationsPanel wb={wb} customerId={customerId} />
        : <OriginalsPanel wb={wb} customerId={customerId} onChanged={() => void wb.refresh()} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 待办（回原格子）
// ---------------------------------------------------------------------------

export function TodoView({ source, cells, onGotoCell, onOpenPanel }: {
  source: TakeoffSource;
  cells: TakeoffCellView[];
  onGotoCell: (c: TakeoffCellView) => void;
  onOpenPanel: (k: PanelKey) => void;
}) {
  const rows: TakeoffTodoRow[] = deriveTakeoffTodos(source);
  return (
    <div aria-label="待办（谁处理/处理什么/什么算完成/当前动作）">
      {rows.length === 0 && <p className="tk-asst-note">当前无待办（服务端 open-items/followups/处理链/冲突/冻结均无未决项）。</p>}
      {rows.map((r) => (
        <div key={r.key} className="wb-card" style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span className="tk-badge">谁处理：{r.who}</span>
            <strong style={{ fontSize: 13 }}>{r.what}</strong>
          </div>
          <div className="tk-asst-note">完成判据：{r.doneWhen}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            {r.cell && (() => {
              const cell = cells.find((c) => c.domain === r.cell!.domain && c.row === r.cell!.row);
              return cell ? <button className="tk-btn small" onClick={() => onGotoCell(cell)}>回原格子（{takeoffDomainName(cell.domain)}·{cell.row === 'input' ? '输入' : cell.row === 'analysis' ? '智能' : cell.row === 'human' ? '人工' : '完成'}）</button> : null;
            })()}
            {r.entry && <button className="tk-btn small ghost" onClick={() => onOpenPanel(r.entry as PanelKey)}>打开{r.entry === 'materials' ? '材料' : r.entry === 'qa' ? '问题·补证' : r.entry === 'verify' ? '核验' : r.entry === 'proposal' ? '方案·决定' : '对账'}</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
