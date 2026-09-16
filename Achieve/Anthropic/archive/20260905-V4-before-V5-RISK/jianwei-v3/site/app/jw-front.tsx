export type JwModuleId = 'opportunity' | 'collaboration' | 'insight' | 'business' | 'policy' | 'credit' | 'commercial' | 'asset' | 'value';

export function VinextSafeAnchor({ href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a href={href} {...props} />;
}

type JwModule = {
  name: string;
  en: string;
  icon: string;
  progress: 1 | 2 | 3 | 4;
  stage: string;
  description: string;
  rootLabel?: string;
  rootDetail?: string;
  rootRole?: string;
};

export const MODULES: Record<JwModuleId, JwModule> = {
  opportunity: { name: '商机', en: 'OPPORTUNITY', icon: 'route', progress: 3, stage: '入口', description: '客户与供应商前端信息从这里导入。', rootLabel: '商机', rootDetail: 'Case 入口', rootRole: 'ENTRY' },
  collaboration: { name: '协同', en: 'COLLABORATION', icon: 'person', progress: 3, stage: '支撑', description: '统筹目标、组织任务与跨专业协作；不替代专业判断。', rootLabel: '人员协同', rootDetail: '业务 / 专业 / 管理', rootRole: 'PEOPLE' },
  insight: { name: '见微', en: 'JIANWEI', icon: 'puzzle', progress: 3, stage: '支撑', description: '连接 AI、IT 与开发能力的中枢；模型 authority=none。', rootLabel: '见微', rootDetail: 'Evidence · Context · Audit', rootRole: 'INFRASTRUCTURE' },
  business: { name: '业务', en: 'BUSINESS', icon: 'folder', progress: 3, stage: '主线', description: 'Case Owner 与作战指挥中心，组织但不替代专业 Gate。', rootLabel: '业务 Case', rootDetail: '初始事实 · 沟通 · 尽调', rootRole: 'CASE' },
  policy: { name: '政策', en: 'POLICY', icon: 'strategy', progress: 2, stage: '贯穿', description: '准入与禁止边界。', rootLabel: '政策贯穿', rootDetail: '规则 · 例外 · 版本', rootRole: 'RULE SERVICE' },
  credit: { name: '信审', en: 'CREDIT', icon: 'shield', progress: 3, stage: '主线', description: '信用风险保护与独立专业判断。', rootLabel: '信审 Gate', rootDetail: '规则筛查 / 具名专业判断', rootRole: 'PROFESSIONAL GATE' },
  commercial: { name: '商务', en: 'COMMERCIAL', icon: 'contract', progress: 2, stage: '承接', description: '合同、报价与交易条件。', rootLabel: '商务', rootDetail: '接收信审 Receipt', rootRole: 'HANDOFF' },
  asset: { name: '资产', en: 'ASSET', icon: 'database', progress: 3, stage: '承接', description: '设备、资产与价值载体。', rootLabel: '资产', rootDetail: '交付 · 存续 · 处置', rootRole: 'HANDOFF' },
  value: { name: '价值', en: 'VALUE', icon: 'trophy', progress: 3, stage: 'III 输出', description: '健康、长期与全周期净利润。' },
};

export function JwIcon({ name, size = 30 }: { name: string; size?: number }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<string, React.ReactNode> = {
    key: <><circle {...common} cx="8" cy="9" r="4" /><path {...common} d="m11 12 8 8m-3-3 2-2m-5-1 2-2" /></>,
    handshake: <><path {...common} d="M3 9.5 7.4 5l4 2.4 2-1.2 4.4 3.1-4.5 4.8-3.2-2.2-2.3 2.2L3 9.5Z" /><path {...common} d="m8 14 2.2 2m-4.1-1 2.2 2m3.4-3.1 2.1 1.8" /></>,
    eye: <><path {...common} d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle {...common} cx="12" cy="12" r="2.6" /></>,
    crown: <path {...common} d="m3 7 5 4 4-7 4 7 5-4-2 12H5L3 7Zm2 12h14" />,
    x: <path {...common} d="m7 7 10 10m0-10L7 17" />,
    shield: <><path {...common} d="M12 3 19 6v5c0 4.6-3 7.7-7 10-4-2.3-7-5.4-7-10V6l7-3Z" /><path {...common} d="m9 12 2 2 4-4" /></>,
    contract: <><path {...common} d="M6 3h9l3 3v15H6z" /><path {...common} d="M15 3v4h4M9 11h6m-6 3h6m-6 3h4" /></>,
    diamond: <path {...common} d="m5 8 3-4h8l3 4-7 12L5 8Zm0 0h14M8 4l4 4 4-4m-4 4v12" />,
    trophy: <><path {...common} d="M7 4h10v5a5 5 0 0 1-10 0V4Zm0 2H3v2a4 4 0 0 0 4 4m10-6h4v2a4 4 0 0 1-4 4m-5 2v4m-4 2h8" /></>,
    robot: <><circle {...common} cx="12" cy="3.4" r="1" /><path {...common} d="M12 4.4V7M5 11H3v4h2m14-4h2v4h-2" /><rect {...common} x="5" y="7" width="14" height="11" rx="3" /><circle {...common} cx="9" cy="12" r="1" /><circle {...common} cx="15" cy="12" r="1" /><path {...common} d="M9 15.3h6M8 18v2h8v-2" /></>,
    person: <><circle {...common} cx="12" cy="7.2" r="3.4" /><path {...common} d="M5.2 20.5c.5-4.6 2.8-7.2 6.8-7.2s6.3 2.6 6.8 7.2" /></>,
    target: <><circle {...common} cx="11" cy="13" r="7" /><circle {...common} cx="11" cy="13" r="3" /><path {...common} d="m14 10 6-6m-3 0h3v3" /></>,
    route: <><circle {...common} cx="6" cy="17" r="2" /><circle {...common} cx="18" cy="7" r="2" /><path {...common} d="M8 17h3c5 0 2-10 5-10m-8 3H5a2 2 0 0 1-2-2V5" /></>,
    message: <path {...common} d="M4 5h16v11H9l-5 4V5Z" />,
    monitor: <><rect {...common} x="3" y="4" width="18" height="13" rx="1" /><path {...common} d="m6 11 3-3 3 5 3-4 3 2m-6 6v3m-4 0h8" /></>,
    schedule: <><rect {...common} x="4" y="5" width="16" height="15" rx="1" /><path {...common} d="M8 3v4m8-4v4M4 10h16m-12 4h3" /></>,
    permission: <><path {...common} d="M7 10V7a5 5 0 0 1 10 0v3" /><rect {...common} x="5" y="10" width="14" height="11" rx="2" /><path {...common} d="M12 14v3" /></>,
    strategy: <><path {...common} d="M4 6h16M4 12h16M4 18h16" /><circle {...common} cx="9" cy="6" r="2" /><circle {...common} cx="15" cy="12" r="2" /><circle {...common} cx="8" cy="18" r="2" /></>,
    folder: <path {...common} d="M3 6h7l2 2h9v11H3V6Z" />,
    puzzle: <path {...common} d="M4 4h6a2.5 2.5 0 1 1 4 0h6v6a2.5 2.5 0 1 0 0 4v6h-6a2.5 2.5 0 1 0-4 0H4v-6a2.5 2.5 0 1 1 0-4V4Z" />,
    database: <><ellipse {...common} cx="12" cy="5" rx="7" ry="3" /><path {...common} d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5m-14 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>,
  };
  return <svg className="jw-icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">{paths[name]}</svg>;
}

export function ProgressDisc({ filled }: { filled: number }) {
  const quarters = ['upper-right', 'lower-right', 'lower-left', 'upper-left'] as const;
  return <span className="jw-progress" role="img" aria-label={`四档粗粒度进度：第 ${filled} 档，顺时针从右上开始`}>{quarters.map((quarter, index) => <i key={quarter} data-quarter={quarter} className={index < filled ? 'is-filled' : ''} />)}</span>;
}

export function ModuleLink({ id, className = '' }: { id: JwModuleId; className?: string }) {
  const item = MODULES[id];
  const visualId = id === 'insight' ? 'intelligence' : id;
  return <VinextSafeAnchor href={`/${id}`} className={`jw-node jw-node-${visualId} ${className}`} aria-label={`进入${item.name}模块`}>
    <span className="jw-node-kind">{item.rootRole ?? item.en}</span>
    <span className="jw-node-label"><JwIcon name={item.icon} size={28} /><b>{item.rootLabel ?? item.name}</b></span>
    <small>{item.rootDetail ?? item.description}</small>
  </VinextSafeAnchor>;
}

const CAPABILITY_REGISTRY = [
  { label: '人员', detail: '业务 / 专业 / 管理', icon: 'person', kind: '组织主体' },
  { label: '系统部门', detail: '规则 · 数据 · API · 发布', icon: 'person', kind: '组织主体' },
  { label: '智能部门', detail: '模型 · Harness · evaluation', icon: 'person', kind: '组织主体' },
  { label: '系统资产', detail: '既有系统 · Adapter', icon: 'database', kind: '能力资产' },
  { label: '智能资产', detail: 'Agent · Skills · 版本', icon: 'puzzle', kind: '能力资产' },
] as const;

export function CapabilityRegistry() {
  return <section className="jw-capability-registry" aria-label="协作主体与能力资产">
    <header><b>协作主体与能力资产</b><span>组织责任与可调用资产分开</span></header>
    <div>{CAPABILITY_REGISTRY.map((item) => <article key={item.label} data-kind={item.kind === '组织主体' ? 'organization' : 'asset'}>
      <span>{item.kind}</span>
      <JwIcon name={item.icon} size={22} />
      <b>{item.label}</b>
      <small>{item.detail}</small>
    </article>)}</div>
    <p>Model / Agent authority=none · 正式改变需要 Human Gate + Receipt</p>
  </section>;
}

const MECHANISM_BANDS = [
  { id: 'surface-work', title: '作业面', subtitle: '现在这个 Case 发生了什么', note: 'Model / Agent authority=none', items: [['Evidence / Candidate', 'folder'], ['当前 Gate / 动作', 'permission'], ['Human Gate + Receipt', 'person'], ['仅信审通过，待商务 / 资产', 'route']] },
  { id: 'surface-manage', title: '管理面', subtitle: '哪些 Case 偏离，为什么', note: '事件与动作结果分开观察', items: [['Owner / 延误', 'person'], ['Events / Receipts', 'database'], ['返工 / 影响', 'monitor']] },
  { id: 'surface-evolve', title: '演进面', subtitle: '问题如何成为可回退版本', note: '业务 × 系统 × 智能共同演进', items: [['Problem / Proposal', 'message'], ['Evaluation / Approval', 'target'], ['Version / Observation', 'strategy'], ['Rollback', 'route'], ['系统部门发布', 'monitor']] },
] as const;

export function MechanismRail() {
  return <aside className="jw-mechanism" aria-label="作业管理演进三个产品表面">
    {MECHANISM_BANDS.map((band) => <section key={band.id} className={`jw-mechanism-band is-${band.id}`}>
      <h2>{band.title}</h2>
      <p>{band.subtitle}</p>
      <div className="jw-mechanism-grid">{band.items.map(([label, icon]) => <div key={label} className="jw-mechanism-item"><JwIcon name={icon} size={24} /><span>{label}</span></div>)}</div>
      <small>{band.note}</small>
    </section>)}
  </aside>;
}

export function RelationshipLayer() {
  const arrow = { markerEnd: 'url(#jw-arrow)' };
  return <svg className="jw-relations" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
    <defs><marker id="jw-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10" /></marker></defs>
    <path className="jw-policy-thread" d="M178 270 C340 206 690 206 832 270" />
    <line className="jw-policy-drop" x1="390" y1="235" x2="390" y2="326" />
    <line className="jw-policy-drop" x1="602" y1="235" x2="602" y2="326" />
    <line className="jw-relation" x1="250" y1="420" x2="310" y2="420" {...arrow} />
    <line className="jw-relation" x1="468" y1="420" x2="515" y2="420" {...arrow} />
    <line className="jw-relation" x1="688" y1="404" x2="734" y2="365" {...arrow} />
    <line className="jw-relation" x1="800" y1="407" x2="800" y2="448" {...arrow} />
    <line className="jw-support-link" x1="390" y1="545" x2="390" y2="492" />
    <line className="jw-support-link" x1="602" y1="545" x2="602" y2="492" />
    <line className="jw-support-link" x1="465" y1="610" x2="525" y2="610" />
  </svg>;
}

const MANAGEMENT_SUMMARY = [
  { label: '管辖事项', value: '24', note: '覆盖四个协同部门', tone: 'neutral' },
  { label: '异常事项', value: '6', note: '其中 2 件影响商务排期', tone: 'alert' },
  { label: '延误事项', value: '4', note: '最长延误 5 天', tone: 'warning' },
  { label: '发生返工', value: '3', note: '累计返工 5 次', tone: 'warning' },
] as const;

const BUSINESS_PORTFOLIO = [
  { mode: '直租', total: 10, normal: 5, watch: 2, delayed: 2, rework: 1 },
  { mode: '存回', total: 8, normal: 5, watch: 1, delayed: 1, rework: 1 },
  { mode: '新回', total: 6, normal: 4, watch: 1, delayed: 1, rework: 0 },
] as const;

const PRIORITY_CASES = [
  {
    caseId: 'V4-DEMO-DIRECT-EX-001',
    mode: '直租',
    state: '等待商务承接',
    reason: '设备回购安排含附加条件，规则无法自动覆盖',
    owner: '商务承接人待分配',
    delay: '延误未知',
    rework: '返工未知',
    impact: '仅信审通过，待商务/资产',
    severity: 'high',
    workLinked: true,
  },
  {
    caseId: 'JW-240829-12',
    mode: '存回',
    state: '商务待处理',
    reason: '客户版本与批准版本不一致',
    owner: '华南商务支持组 · 王毅',
    delay: '延误 2 天',
    rework: '返工 1 次',
    impact: '合同签署暂停',
    severity: 'high',
    workLinked: false,
  },
  {
    caseId: 'JW-240827-03',
    mode: '新回',
    state: '尽调待排期',
    reason: '联合现场尽调负责人未明确',
    owner: '责任人未知',
    delay: '延误 5 天',
    rework: '返工 0 次',
    impact: '业务与信审共同尽调无法排期',
    severity: 'high',
    workLinked: false,
  },
  {
    caseId: 'JW-240830-18',
    mode: '直租',
    state: '商务承接中',
    reason: '信审已通过，商务材料尚未齐备',
    owner: '华东商务支持组 · 赵婷',
    delay: '延误 1 天',
    rework: '返工 1 次',
    impact: '仅信审通过，待商务/资产',
    severity: 'medium',
    workLinked: false,
  },
] as const;

const ORGANIZATION_LOAD = [
  { name: '信审团队', active: 9, delayed: 3, load: 88, status: '负荷偏高' },
  { name: '业务团队', active: 8, delayed: 1, load: 72, status: '需要关注' },
  { name: '商务团队', active: 5, delayed: 0, load: 56, status: '负荷正常' },
  { name: '资产团队', active: 2, delayed: 0, load: 32, status: '负荷正常' },
] as const;

const MANAGEMENT_ARCHITECTURE = [
  { stage: '业务', responsibility: '组织事项与事实' },
  { stage: '政策', responsibility: '规则、例外与版本' },
  { stage: '信审', responsibility: '独立专业判断' },
  { stage: '商务', responsibility: '条款与合同承接' },
  { stage: '资产', responsibility: '交付与存续管理' },
] as const;

function DemoBadge() {
  return <span className="jw-demo-badge">演示数据</span>;
}

function ManagementArchitecture() {
  return (
    <section className="jw-architecture-strip" aria-labelledby="management-architecture-title">
      <div className="jw-architecture-heading">
        <span>先懂架构</span>
        <h2 id="management-architecture-title">事项如何被管理与支撑</h2>
      </div>

      <div className="jw-architecture-map">
        <div className="jw-architecture-scope">
          <span>管理对象</span>
          <b>多个融资租赁事项</b>
          <div><i>直租</i><i>存回</i><i>新回</i></div>
        </div>
        <span className="jw-architecture-arrow" aria-hidden="true">→</span>
        <div className="jw-professional-flow">
          <span>专业作业主线</span>
          <ol>
            {MANAGEMENT_ARCHITECTURE.map((item) => (
              <li key={item.stage}>
                <b>{item.stage}</b>
                <small>{item.responsibility}</small>
              </li>
            ))}
          </ol>
        </div>
        <span className="jw-architecture-arrow" aria-hidden="true">→</span>
        <div className="jw-architecture-observe">
          <span>管理观察</span>
          <b>发现偏差并下钻</b>
          <small>异常 · 延误 · 返工 · 责任 · 影响</small>
        </div>
      </div>

      <div className="jw-architecture-support">
        <span>共同支撑</span>
        <p><b>系统部门</b>维护规则、数据、API、集成、发布与运维</p>
        <p><b>智能部门</b>维护模型、Agent、评估与版本</p>
        <p className="jw-architecture-boundary"><b>权威边界</b>系统与智能能力不是审批人；正式动作由具名人员或组织授权规则确认。</p>
      </div>
    </section>
  );
}

export function ManagementOverview() {
  return (
    <main className="jw-manage-overview">
      <header className="jw-manage-header">
        <div>
          <span className="jw-manage-kicker">多事项 · 组织观察</span>
          <h1>管辖事项管理总览</h1>
          <p>发现异常、延误与返工，明确责任和影响，再进入作业执行或管理治理。</p>
        </div>
        <div className="jw-demo-notice">
          <DemoBadge />
          <span>本页全部事项、人员与指标均为静态合成示例，不代表真实经营数据。</span>
        </div>
      </header>

      <ManagementArchitecture />

      <section className="jw-scope-panel" aria-labelledby="manage-scope-title">
        <div className="jw-section-heading">
          <div><span>观察范围</span><h2 id="manage-scope-title">当前管辖范围</h2></div>
          <DemoBadge />
        </div>
        <dl className="jw-scope-grid">
          <div><dt>组织</dt><dd>全公司</dd></div>
          <div><dt>部门</dt><dd>业务、信审、商务、资产</dd></div>
          <div><dt>团队</dt><dd>未提供</dd></div>
          <div><dt>人员</dt><dd>全部责任人</dd></div>
          <div><dt>业务线</dt><dd><span>直租</span><span>存回</span><span>新回</span></dd></div>
          <div><dt>时间范围</dt><dd>本月</dd></div>
        </dl>
      </section>

      <section className="jw-summary-grid" aria-label="事项组合关键状态">
        {MANAGEMENT_SUMMARY.map((item) => (
          <article key={item.label} data-tone={item.tone}>
            <div><span>{item.label}</span><DemoBadge /></div>
            <strong>{item.value}</strong>
            <small>{item.note}</small>
          </article>
        ))}
      </section>

      <section className="jw-manage-body">
        <div className="jw-manage-primary">
          <section className="jw-panel jw-portfolio-panel" aria-labelledby="portfolio-title">
            <div className="jw-section-heading">
              <div><span>事项组合状态</span><h2 id="portfolio-title">三条业务线的状态分布</h2></div>
              <DemoBadge />
            </div>
            <div className="jw-portfolio-legend" aria-label="状态图例">
              <span><i className="is-normal" />正常</span>
              <span><i className="is-watch" />需关注</span>
              <span><i className="is-delayed" />延误</span>
              <span><i className="is-rework" />返工中</span>
            </div>
            <div className="jw-portfolio-list">
              {BUSINESS_PORTFOLIO.map((item) => (
                <article key={item.mode}>
                  <header><b>{item.mode}</b><span>共 {item.total} 件</span></header>
                  <div className="jw-status-bar" aria-label={`${item.mode}：正常 ${item.normal} 件，需关注 ${item.watch} 件，延误 ${item.delayed} 件，返工中 ${item.rework} 件`}>
                    <i className="is-normal" style={{ flex: item.normal }} />
                    <i className="is-watch" style={{ flex: item.watch }} />
                    <i className="is-delayed" style={{ flex: item.delayed }} />
                    {item.rework > 0 && <i className="is-rework" style={{ flex: item.rework }} />}
                  </div>
                  <footer><span>正常 {item.normal}</span><span>关注 {item.watch}</span><span>延误 {item.delayed}</span><span>返工 {item.rework}</span></footer>
                </article>
              ))}
            </div>
          </section>

          <section className="jw-panel jw-priority-panel" aria-labelledby="priority-title">
            <div className="jw-section-heading">
              <div><span>优先处置</span><h2 id="priority-title">需要下钻的事项</h2></div>
              <div className="jw-priority-meta"><DemoBadge /><span>按影响与延误排序</span></div>
            </div>
            <div className="jw-priority-table-wrap">
              <table>
                <thead><tr><th>事项</th><th>异常与原因</th><th>责任人 / 组织</th><th>延误 / 返工</th><th>影响</th><th><span className="jw-sr-only">操作</span></th></tr></thead>
                <tbody>
                  {PRIORITY_CASES.map((item) => (
                    <tr key={item.caseId} data-severity={item.severity}>
                      <td><b>{item.caseId}</b><span>{item.mode} · {item.state}</span></td>
                      <td>{item.reason}</td>
                      <td>{item.owner}</td>
                      <td><span>{item.delay}</span><span>{item.rework}</span></td>
                      <td>{item.impact}</td>
                      <td>{item.workLinked
                        ? <VinextSafeAnchor href={`/work?caseId=${encodeURIComponent(item.caseId)}`} aria-label={`进入事项 ${item.caseId}`}>进入事项</VinextSafeAnchor>
                        : <span className="jw-case-readonly">事项作业未接入</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="jw-manage-side" aria-label="组织负荷与改进效果">
          <section className="jw-panel jw-load-panel" aria-labelledby="load-title">
            <div className="jw-section-heading">
              <div><span>责任与负荷</span><h2 id="load-title">组织负荷</h2></div>
              <DemoBadge />
            </div>
            <div className="jw-load-list">
              {ORGANIZATION_LOAD.map((item) => (
                <article key={item.name}>
                  <header><b>{item.name}</b><span>{item.status}</span></header>
                  <div><i style={{ width: `${item.load}%` }} /></div>
                  <footer><span>在办 {item.active} 件</span><span>延误 {item.delayed} 件</span></footer>
                </article>
              ))}
            </div>
          </section>

          <section id="governance" className="jw-panel jw-improvement-panel" aria-labelledby="improvement-title">
            <div className="jw-section-heading">
              <div><span>改进效果观察</span><h2 id="improvement-title">补证清单 02</h2></div>
              <DemoBadge />
            </div>
            <p>针对“设备权属证明反复补充”的跨事项问题，当前处于演示观察期。</p>
            <div className="jw-improvement-verdict"><b>趋势变好，证据仍不足</b><span>样本 7 件 · 继续观察</span></div>
            <dl>
              <div><dt>平均返工</dt><dd><del>2.4 次</del><strong>1.6 次</strong></dd></div>
              <div><dt>延误占比</dt><dd><del>23%</del><strong>14%</strong></dd></div>
              <div><dt>影响范围</dt><dd>直租 · 信审与商务</dd></div>
            </dl>
            <VinextSafeAnchor href="#governance">治理模块将在后续检查点接入</VinextSafeAnchor>
          </section>

          <section className="jw-authority-note" aria-label="权威边界">
            <JwIcon name="shield" size={19} />
            <p><b>状态边界：</b>信审通过不等于起租；正式状态由具名人员或组织规则确认。</p>
          </section>
        </aside>
      </section>
    </main>
  );
}
