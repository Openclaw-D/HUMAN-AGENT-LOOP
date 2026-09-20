// TAKEOFF-FA-1.0.0 · 格子详情面板（02_FRONTEND_SPEC §4 单击分层顺序）：
// 当前问题 → 依据位置 → 需要谁做什么 → 允许动作 → 本轮输出与历史。
// 动作=打开复用的真实办理面板（材料/核验/补证/方案/对账），不做手工改状态按钮；
// 输出与历史消费同源记录（评估候选/域结果/处理链任务），不另写一份状态。
import type { WbApi } from '../../lib/workbench/use-workbench';
import type { TakeoffCellView } from '../../lib/workbench/takeoff-projection';
import { takeoffDomainName, takeoffRowName } from '../../lib/workbench/takeoff-projection';


const DOMAIN_TODO: Record<string, string> = {
  opportunity: '补充客户主体、融资需求与回租设备资料',
  policy: '核对准入条件与政策要求，未明确的条件先确认',
  credit: '核对经营现金流与负债线索材料；必要时回答/发起补证',
  commerce: '在风险与资产边界内试算方案；未核验条件只作候选/待复核',
  asset: '核验回租设备存在性、权属、同一性与价值支持材料',
};

export function TakeoffCellDetail({ wb, cell, onOpenPanel, onOpenAssistant, onViewMaterials }: {
  wb: WbApi;
  cell: TakeoffCellView;
  onOpenPanel: (key: 'materials' | 'verify' | 'qa' | 'proposal' | 'result') => void;
  onOpenAssistant?: () => void;
  onViewMaterials?: () => void;
}) {
  const snap = wb.snapshot;
  const latestAssessment = (snap?.assessments ?? []).length > 0 ? (snap?.assessments ?? [])[(snap?.assessments ?? []).length - 1] : null;
  const chanFollowups = (snap?.session?.followups ?? []).filter((f) => f?.ownerRole === cell.domain);
  // 当前问题：卡点/冻结/待补优先；无卡点时给该域当前的真实进展（事项清单首条）。
  const problems = cell.items.filter((i) => i.tone === 'red' || i.tone === 'yellow');
  const progress = cell.items.filter((i) => i.tone !== 'red' && i.tone !== 'yellow');
  return (
    <div aria-label={`${takeoffDomainName(cell.domain)}${takeoffRowName(cell.row)}格详情`}>
      <div className="tk-detail-sec">
        <h3>待处理</h3>
        {cell.frozen && <div className="tk-item"><span className="tk-dot yellow" />依据有变化，需复核后继续确认。你仍可查看或补充材料。</div>}
        {problems.length === 0 && !cell.frozen && <div className="tk-item"><span className="tk-dot gray" />{cell.completed ? '本项已完成。' : '本项尚未完成，已取得的结果见下方。'}</div>}
        {problems.map((p) => (
          <div key={p.key} className="tk-item"><span className={`tk-dot ${p.tone === 'green' && !cell.completed ? 'gray' : p.tone}`} />{p.label.replace(/（[^）]*(?:A |authority|adoption|stale=|03协议|scope=)[^）]*）/g, '')}{p.detail && <details className="tk-technical"><summary>详情</summary>{p.detail}</details>}</div>
        ))}
      </div>
      <div className="tk-detail-sec">
        <h3>下一步</h3>
        <div className="tk-item"><span className="tk-dot gray" />{DOMAIN_TODO[cell.domain] ?? '—'}</div>
        {chanFollowups.map((f, i) => (
          <div key={i} className="tk-item"><span className="tk-dot yellow" />转会后待办：{f.reason ?? '—'} → {f.nextAction ?? '待定'}</div>
        ))}
        <div className="tk-toolbar">
          {cell.row === 'analysis' && onOpenAssistant && <button className="tk-btn primary" onClick={onOpenAssistant}>查看{takeoffDomainName(cell.domain)}分析</button>}
          {cell.row === 'input' && onViewMaterials && <button className="tk-btn" onClick={onViewMaterials}>查看材料原件</button>}
          {cell.allowedActions.filter(() => cell.row !== 'analysis' || !onOpenAssistant).map((a) => (
            <button key={a.key} className="tk-btn small" onClick={() => onOpenPanel(a.key)}>{{materials:'补充材料',verify:'核验材料',qa:'问题与补证',proposal:'查看建议方案',result:'查看办理结果'}[a.key]}</button>
          ))}
          {cell.allowedActions.length === 0 && !(cell.row === 'analysis' && onOpenAssistant) && <span className="tk-asst-note">暂无可办理动作。</span>}
        </div>
      </div>
      <div className="tk-detail-sec">
        <h3>已取得的结果</h3>
        {progress.length === 0 && <div className="tk-item"><span className="tk-dot gray" />暂无已登记产出。</div>}
        {progress.map((p) => (
          <div key={p.key} className="tk-item"><span className={`tk-dot ${p.tone === 'green' && !cell.completed ? 'gray' : p.tone}`} />{p.label.replace(/（[^）]*(?:A |authority|adoption|stale=|03协议|scope=)[^）]*）/g, '')}{p.detail && <details className="tk-technical"><summary>详情</summary>{p.detail}</details>}</div>
        ))}
        {(cell.domain === 'credit' || cell.domain === 'commerce') && latestAssessment && (
          <div className="tk-item">
            <span className="tk-dot blue" />
            评估状态：{({ collecting: '材料收集中', candidate_ready: '已有建议方案', awaiting_human_review: '待人工确认', preassessment_confirmed: '结论已确认', rejected: '不支持', superseded: '已撤回' } as Record<string,string>)[String(latestAssessment.status)] ?? '待核实'}
            {latestAssessment.stale === true ? '（依据已过时，需复核）' : ''}
          </div>
        )}
        <div className="tk-item"><span className="tk-dot gray" />历史变更见「时间轴」。</div>
      </div>
    </div>
  );
}
