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

export function TakeoffCellDetail({ wb, cell, onOpenPanel }: {
  wb: WbApi;
  cell: TakeoffCellView;
  onOpenPanel: (key: 'materials' | 'verify' | 'qa' | 'proposal' | 'result') => void;
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
        <h3>当前问题</h3>
        {cell.frozen && <div className="tk-item"><span className="tk-dot yellow" />依据有变化，需复核后继续确认。你仍可查看或补充材料。</div>}
        {problems.length === 0 && !cell.frozen && <div className="tk-item"><span className="tk-dot gray" />暂无待处理问题，办理进展见下方。</div>}
        {problems.map((p) => (
          <div key={p.key} className="tk-item"><span className={`tk-dot ${p.tone === 'green' && !cell.completed ? 'gray' : p.tone}`} />{p.label.replace(/（[^）]*(?:A |authority|adoption|stale=|03协议|scope=)[^）]*）/g, '')}{p.detail && <details className="tk-technical"><summary>详情</summary>{p.detail}</details>}</div>
        ))}
      </div>
      <div className="tk-detail-sec">
        <h3>依据位置</h3>
        <p className="tk-basis">查看原始材料、分析记录及本次评估，核对判断依据。</p><details className="tk-technical"><summary>查看依据细节</summary><p>{cell.basis}</p></details>
        <div className="tk-item" style={{ marginTop: 4 }}>
          <span className="tk-dot gray" />
          <span>材料与记录均可在对应入口查看。</span>
        </div>
      </div>
      <div className="tk-detail-sec">
        <h3>需要谁做什么</h3>
        <div className="tk-item"><span className="tk-dot gray" />责任方：{cell.responsible ?? '待指派'}</div>
        <div className="tk-item"><span className="tk-dot gray" />该域工作：{DOMAIN_TODO[cell.domain] ?? '—'}</div>
        {chanFollowups.map((f, i) => (
          <div key={i} className="tk-item"><span className="tk-dot yellow" />转会后待办：{f.reason ?? '—'} → {f.nextAction ?? '待定'}</div>
        ))}
      </div>
      <div className="tk-detail-sec">
        <h3>下一步</h3>
        <div className="tk-toolbar">
          {cell.allowedActions.map((a) => (
            <button key={a.key} className="tk-btn small" onClick={() => onOpenPanel(a.key)}>{a.label}</button>
          ))}
          {cell.allowedActions.length === 0 && <span className="tk-asst-note">暂无可办理动作。</span>}
          <button className="tk-btn small ghost" onClick={() => onOpenPanel('result')}>对账查询</button>
        </div>
      </div>
      <div className="tk-detail-sec">
        <h3>办理进展</h3>
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
        <div className="tk-item"><span className="tk-dot gray" />历次处理和变更保存在「记录」中。</div>
      </div>
    </div>
  );
}
