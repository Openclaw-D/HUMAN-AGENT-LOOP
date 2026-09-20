// TAKEOFF-FA-1.0.0 · 格子详情面板（02_FRONTEND_SPEC §4 单击分层顺序）：
// 当前问题 → 依据位置 → 需要谁做什么 → 允许动作 → 本轮输出与历史。
// 动作=打开复用的真实办理面板（材料/核验/补证/方案/对账），不做手工改状态按钮；
// 输出与历史消费同源记录（评估候选/域结果/处理链任务），不另写一份状态。
import type { WbApi } from '../../lib/workbench/use-workbench';
import type { TakeoffCellView } from '../../lib/workbench/takeoff-projection';
import { takeoffDomainName, takeoffRowName } from '../../lib/workbench/takeoff-projection';
import { WbDot } from '../workbench/wb-parts';

const DOMAIN_TODO: Record<string, string> = {
  opportunity: '补齐主体与首次回租需求登记（字段待01接入前人工登记材料）',
  policy: '核对机构已配置政策要求；未配置政策如实标注（POLICY_PENDING 不冒充通过）',
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
        {cell.frozen && <div className="tk-item"><span className="tk-dot yellow" />该格已冻结（依据变化）：禁止相关正面确认；仍可看证据、补件、提问。</div>}
        {problems.length === 0 && !cell.frozen && <div className="tk-item"><span className="tk-dot gray" />暂无卡点（无卡点≠通过；进展见下）。</div>}
        {problems.map((p) => (
          <div key={p.key} className="tk-item"><span className={`tk-dot ${p.tone}`} />{p.label}{p.detail ? ` — ${p.detail}` : ''}</div>
        ))}
      </div>
      <div className="tk-detail-sec">
        <h3>依据位置</h3>
        <div className="tk-basis">{cell.basis}</div>
        <div className="tk-item" style={{ marginTop: 4 }}>
          <span className="tk-dot gray" />
          <span>同源记录：记录页时间轴与材料页清单为同一服务端事实的投影，不在本页另存状态。</span>
        </div>
      </div>
      <div className="tk-detail-sec">
        <h3>需要谁做什么</h3>
        <div className="tk-item"><span className="tk-dot gray" />责任方：{cell.responsible ?? '待指派（服务端未登记责任角色）'}</div>
        <div className="tk-item"><span className="tk-dot gray" />该域工作：{DOMAIN_TODO[cell.domain] ?? '—'}</div>
        {chanFollowups.map((f, i) => (
          <div key={i} className="tk-item"><span className="tk-dot yellow" />转会后待办：{f.reason ?? '—'} → {f.nextAction ?? '待定'}</div>
        ))}
      </div>
      <div className="tk-detail-sec">
        <h3>允许动作（打开真实办理面板；不做手工改状态）</h3>
        <div className="tk-toolbar">
          {cell.allowedActions.map((a) => (
            <button key={a.key} className="tk-btn small" onClick={() => onOpenPanel(a.key)}>{a.label}</button>
          ))}
          {cell.allowedActions.length === 0 && <span className="tk-asst-note">该格暂无可办理动作（待01/03字段接入）。</span>}
          <button className="tk-btn small ghost" onClick={() => onOpenPanel('result')}>对账查询</button>
        </div>
      </div>
      <div className="tk-detail-sec">
        <h3>本轮输出与历史（同源记录投影）</h3>
        {progress.length === 0 && <div className="tk-item"><span className="tk-dot gray" />暂无已登记产出。</div>}
        {progress.map((p) => (
          <div key={p.key} className="tk-item"><span className={`tk-dot ${p.tone}`} />{p.label}{p.detail ? ` — ${p.detail}` : ''}</div>
        ))}
        {(cell.domain === 'credit' || cell.domain === 'commerce') && latestAssessment && (
          <div className="tk-item">
            <span className="tk-dot blue" />
            评估 {String(latestAssessment.assessmentId ?? '').slice(0, 18)}… 状态 {String(latestAssessment.status ?? '—')}
            {latestAssessment.stale === true ? '（依据已过时，需复核）' : ''}
          </div>
        )}
        <div className="tk-item"><span className="tk-dot gray" />历史以服务端记录为准（历史被推翻不静默改写）；本页只投影当前可见事实。</div>
      </div>
      <WbDot tone="gray" text={`连接：${wb.phase === 'live' ? '实时' : wb.phase === 'reconnecting' ? '重连中' : '未连接'}（投影随服务端刷新，本地不补写状态）`} />
    </div>
  );
}
