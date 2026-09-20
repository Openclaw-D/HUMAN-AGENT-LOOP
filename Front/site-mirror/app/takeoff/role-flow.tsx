import { StatusObject } from './status-object';
import { useRef, useState } from 'react';
import { TAKEOFF_DOMAINS, TAKEOFF_ROWS, type TakeoffCellView, type TakeoffTopSummary } from '../../lib/workbench/takeoff-projection';
import { RoleLogo, UiIcon } from './ui-icons';
import { cellStatus } from './cell-status';

type FlowTop = Pick<TakeoffTopSummary, 'changedDomains' | 'gateResult'> & { confirmed?: { outcomeLabel?: string; needsReview?: boolean } | null };
const stageNames = { input: '收集材料', analysis: '辅助分析', human: '人工核验', closure: '专业收口' };
const descriptions = ['了解需求与客户主体', '核对准入与适用政策', '评估偿付能力与风险', '形成可讨论的条件', '核验设备、价值与权属'];

export function RoleFlow({ cells, top, onSelect }: { cells: TakeoffCellView[]; top: FlowTop; onSelect?: (cell: TakeoffCellView) => void }) {
  const [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const getCell = (domain: string, row: string) => cells.find((c) => c.domain === domain && c.row === row);
  return <section className="tk-flow-page" aria-label="横向角色流程树">
    <header className="tk-view-heading"><div><span className="tk-section-kicker">角色流程</span><h1>谁来做，接着怎么走。</h1><p>五个专业可以并行。点击任一步，查看材料、责任与下一步。</p></div><div className="tk-canvas-controls"><button aria-label="缩小流程图" onClick={() => setZoom((n) => Math.max(0.5, +(n - 0.1).toFixed(1)))}>−</button><output>{Math.round(zoom * 100)}%</output><button aria-label="放大流程图" onClick={() => setZoom((n) => Math.min(1.8, +(n + 0.1).toFixed(1)))}>＋</button><button onClick={() => { setZoom(1); if (viewport.current) { viewport.current.scrollLeft = 0; viewport.current.scrollTop = 0; } }}>还原视图</button></div></header>
    <div className="tk-roleflow-scroll" ref={viewport} onPointerDown={(e) => { if ((e.target as HTMLElement).closest('button') || e.button !== 0) return; pan.current = { x:e.clientX,y:e.clientY,left:e.currentTarget.scrollLeft,top:e.currentTarget.scrollTop }; e.currentTarget.setPointerCapture?.(e.pointerId); }} onPointerMove={(e) => { if (pan.current) { const scale = e.currentTarget.getBoundingClientRect().width / e.currentTarget.clientWidth; e.currentTarget.scrollLeft = pan.current.left - (e.clientX-pan.current.x)/scale; e.currentTarget.scrollTop = pan.current.top - (e.clientY-pan.current.y)/scale; } }} onPointerUp={() => { pan.current=null; }} onPointerCancel={() => { pan.current=null; }}>
      <div style={{ width:1760*zoom,height:630*zoom }}><div className="tk-roleflow-world" style={{transform:`scale(${zoom})`}}>
        <svg className="tk-roleflow-lines" width="1760" height="630" role="img" aria-label="首次预评估只读流程图（五专业并行，从左到右汇入人工确认）">
          <defs><marker id="role-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 6 3 0 6" fill="#a8aaa8"/></marker></defs>
          {TAKEOFF_DOMAINS.map((d,i) => <g key={d.id}><path d={`M205 315H242V${75+i*116}H290`} markerEnd="url(#role-arrow)"/><path d={`M1328 ${75+i*116}H1392V315H1450`} markerEnd="url(#role-arrow)"/></g>)}
        </svg>
        <div className="tk-flow-bookend start"><UiIcon name="materials" size={34}/><h3>同一位客户</h3><p>需求与材料<br/>一起进入专业协作</p><span>共享事实，各司其职</span></div>
        {TAKEOFF_DOMAINS.map((domain,i) => <div className="tk-roleflow-lane" style={{top:20+i*116}} key={domain.id}>
          <div className="tk-flow-role"><RoleLogo role={domain.id} size={30}/><div><h3>{domain.name === '商机' ? '业务' : domain.name}</h3><p>{descriptions[i]}</p></div></div>
          <div className="tk-flow-steps">{TAKEOFF_ROWS.map((row) => { const cell=getCell(domain.id,row.id); const state=cell ? cellStatus(cell,cells) : {color:'gray',icon:'lock' as const,label:'尚未开始'}; return <button key={row.id} className="tk-flow-step" disabled={!cell || !onSelect} onClick={() => cell && onSelect?.(cell)} aria-label={`${domain.name} · ${stageNames[row.id]} · ${state.label}`} title={state.label}><span className={`tk-step-index tk-status-icon ${state.color}`} aria-hidden="true"><StatusObject kind={state.icon} size={48}/></span><strong>{stageNames[row.id]}</strong></button>; })}</div>
        </div>)}
        <div className={`tk-flow-bookend end${top.confirmed ? ' confirmed' : ''}`}><UiIcon name={top.confirmed ? 'check' : 'credit'} size={34}/><h3>{top.confirmed ? '预评估已确认' : '汇入人工确认'}</h3><p>{top.confirmed?.outcomeLabel ?? '各专业意见汇总后，由有权人员确认预评估结论。'}</p><span>{top.confirmed?.needsReview ? '依据有变化 · 需复核' : '最终决定属于人'}</span></div>
      </div></div>
    </div>
    <footer className="tk-status-legend"><span><span className="tk-status-icon gray"><StatusObject kind="lock" size={28}/></span>未开始</span><span><span className="tk-status-icon blue"><StatusObject kind="wrench" size={28}/></span>处理中</span><span><span className="tk-status-icon green"><StatusObject kind="check" size={28}/></span>已完成</span><span><StatusObject kind="cross" size={28}/>不通过</span></footer>
  </section>;
}
