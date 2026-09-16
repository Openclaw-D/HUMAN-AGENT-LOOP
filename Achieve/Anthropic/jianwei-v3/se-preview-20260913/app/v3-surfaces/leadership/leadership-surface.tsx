'use client';

import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import type {
  V3CollaborationThreadEntryDto,
  V3InternalCollaborationProjectionDto,
  V3KpiMetricDto,
} from '../../../lib/v3-client';
import { JwIcon } from '../../jw-front';
import {
  getCollaborationClient,
  initializeLeadershipSurface,
  loadSurfaceRole,
  type LeadershipSurfaceData,
  type SurfaceRoleSnapshot,
} from './leadership-adapter';
import { SharedSurfaceShell } from '../shared/surface-shell';
import {
  PROFESSIONAL_PATH,
  SURFACE_ROLES,
  processProjectionFor,
  progressLevelForProcess,
  valueChartCount,
  type SurfaceMode,
  type SurfacePrincipalId,
} from '../shared/surface-model';
import styles from './leadership-surface.module.css';

type LeadershipSection = 'collaboration' | 'value';
type LeadershipSurfaceProps = { initialSection?: LeadershipSection };
type LoadState = 'loading' | 'ready' | 'error';
type ScopeLevel = 'portfolio' | 'business-unit' | string;

const PROCESS_LABELS: Record<string, string> = {
  opportunity: '业务',
  policy: '政策',
  credit: '信审',
  commercial: '商务',
  asset: '资产',
};

const STATUS_LABELS: Record<string, string> = {
  queued: '已排队',
  running: '处理中',
  partial: '部分完成',
  needs_input: '待补充',
  ready_for_gate: '待人审',
  completed: '已完成',
  failed: '失败',
  not_started: '未开始',
  not_ready: '未就绪',
  ready: '待确认',
  confirmed: '已确认',
  rejected: '已拒绝',
  returned_for_evidence: '退回补证',
};

const GRAINS = ['day', 'week', 'month', 'quarter', 'half-year', 'year'] as const;
const GRAIN_LABELS: Record<(typeof GRAINS)[number], string> = {
  day: '日', week: '周', month: '月', quarter: '季', 'half-year': '半年', year: '年',
};

function StatePanel({ kind, title, detail, onRetry }: {
  kind: 'loading' | 'error' | 'empty';
  title: string;
  detail: string;
  onRetry?: () => void;
}) {
  return (
    <div className={styles.statePanel} data-state={kind} role={kind === 'error' ? 'alert' : undefined}>
      {kind === 'loading' ? <i /> : <JwIcon name={kind === 'error' ? 'x' : 'database'} size={25} />}
      <strong>{title}</strong>
      <p>{detail}</p>
      {onRetry ? <button type="button" onClick={onRetry}>重试</button> : null}
    </div>
  );
}

function ScenarioBadge({ tier }: { tier: 'golden' | 'background' }) {
  return <span className={styles.scenarioBadge}>{tier === 'golden' ? 'GOLDEN' : 'BACKGROUND'} · SCENARIO</span>;
}

function ScopeNavigator({ role, scope, onScopeChange }: {
  role: SurfaceRoleSnapshot;
  scope: ScopeLevel;
  onScopeChange: (scope: ScopeLevel) => void;
}) {
  const selectedCase = role.casePanel.items.find((item) => item.caseId === scope);
  return (
    <div className={styles.scopeNavigator} aria-label="Portfolio 到 Case 下钻">
      <button type="button" className={scope === 'portfolio' ? styles.activeScope : undefined} onClick={() => onScopeChange('portfolio')}>Portfolio</button>
      <i>›</i>
      <button type="button" className={scope === 'business-unit' ? styles.activeScope : undefined} onClick={() => onScopeChange('business-unit')}>小微事业部</button>
      <i>›</i>
      <select value={selectedCase?.caseId ?? ''} onChange={(event) => event.target.value && onScopeChange(event.target.value)} aria-label="选择 Scenario Case">
        <option value="">选择 Case</option>
        {role.casePanel.items.map((item) => <option key={item.caseId} value={item.caseId}>{item.title}</option>)}
      </select>
    </div>
  );
}

function MainHeader({ section, role, scope, onScopeChange }: {
  section: LeadershipSection;
  role: SurfaceRoleSnapshot;
  scope: ScopeLevel;
  onScopeChange: (scope: ScopeLevel) => void;
}) {
  const roleLabel = SURFACE_ROLES.find((item) => item.principalId === role.principalId)?.label ?? role.principalId;
  return (
    <header className={styles.mainHeader}>
      <div>
        <span>{section === 'collaboration' ? 'COLLABORATION SURFACE' : 'VALUE SURFACE'} · {roleLabel} Role Projection</span>
        <h1>{section === 'collaboration' ? '经营协同主视图' : '可验证价值主视图'}</h1>
        <p>{role.projection.caseSummary || '未提供'}</p>
      </div>
      <ScopeNavigator role={role} scope={scope} onScopeChange={onScopeChange} />
    </header>
  );
}

function CaseGrid({ role, onDrilldown }: { role: SurfaceRoleSnapshot; onDrilldown: (caseId: string) => void }) {
  if (!role.casePanel.items.length) {
    return <StatePanel kind="empty" title="Case Projection 为空" detail="Back shared contract 未提供可见事项；界面未补造默认事项。" />;
  }
  return (
    <div className={styles.caseGrid}>
      {role.casePanel.items.map((item) => (
        <button key={item.caseId} type="button" className={item.caseTier === 'golden' ? styles.goldenCase : undefined} onClick={() => onDrilldown(item.caseId)}>
          <span className={styles.caseTopline}><ScenarioBadge tier={item.caseTier} /><em>{item.signal === 'elevated' ? '风险上浮' : item.signal === 'attention' ? '需关注' : '常规'}</em></span>
          <strong>{item.title}</strong>
          <small>{item.caseId} · {item.phase}</small>
          <p>{item.roleScopedSummary || '未提供'}</p>
          <span className={styles.nextMilestone}>下一节点：{item.nextMilestone || '未提供'}</span>
        </button>
      ))}
    </div>
  );
}

function internalProjection(role: SurfaceRoleSnapshot): V3InternalCollaborationProjectionDto | null {
  const projection = role.projection.collaborationProjection;
  return projection?.mode === 'internal-five-thread' ? projection : null;
}

function CollaborationRelationship({ role, scope, onDrilldown }: {
  role: SurfaceRoleSnapshot;
  scope: ScopeLevel;
  onDrilldown: (caseId: string) => void;
}) {
  if (scope === 'portfolio' || scope === 'business-unit') return <CaseGrid role={role} onDrilldown={onDrilldown} />;
  const caseItem = role.casePanel.items.find((item) => item.caseId === scope);
  if (!caseItem) return <StatePanel kind="empty" title="Case 未提供" detail="当前 Role Projection 中不存在所选事项。" />;
  if (caseItem.caseTier === 'background') {
    return (
      <div className={styles.backgroundSummary}>
        <ScenarioBadge tier="background" />
        <JwIcon name="case" size={32} />
        <h2>{caseItem.title}</h2>
        <p>{caseItem.roleScopedSummary || '未提供'}</p>
        <dl><div><dt>当前阶段</dt><dd>{caseItem.phase || '未提供'}</dd></div><div><dt>下一节点</dt><dd>{caseItem.nextMilestone || '未提供'}</dd></div></dl>
        <small>Background Case 仅有只读摘要；工作项、Gate 与 Receipt 未由 Back Projection 提供。</small>
      </div>
    );
  }
  const collaboration = internalProjection(role);
  if (!collaboration?.workItems.length) {
    const externalTask = role.projection.scope?.externalTask;
    return (
      <div className={styles.backgroundSummary}>
        <ScenarioBadge tier="golden" />
        <JwIcon name="collaboration" size={32} />
        <h2>{caseItem.title}</h2>
        <p>{externalTask ? `受邀工作项：${externalTask.workstepProcessId}` : '当前 Role Projection 未提供内部协同关系。'}</p>
        <small>外部角色只呈现邀请范围，不显示内部工作项或专业判断。</small>
      </div>
    );
  }
  return (
    <div className={styles.relationshipMap}>
      <article className={styles.objectiveNode}>
        <span>共同目标 · SCENARIO</span>
        <strong>{collaboration.objective.title}</strong>
        <p>{collaboration.objective.description}</p>
      </article>
      <div className={styles.workNodes}>
        {collaboration.workItems.map((item) => (
          <article key={item.processId}>
            <span>{item.label}</span>
            <strong>{item.task || '未提供'}</strong>
            <small>{STATUS_LABELS[item.runStatus] ?? item.runStatus} · Gate {STATUS_LABELS[item.gateState] ?? item.gateState}</small>
          </article>
        ))}
      </div>
    </div>
  );
}

function ProfessionalPaths({ role }: { role: SurfaceRoleSnapshot }) {
  const professionalIds = ['policy', 'credit', 'commercial', 'asset'] as const;
  return (
    <div className={styles.professionalPaths}>
      <header><span>PROFESSIONAL PATHS ONLY</span><h2>四专业内部路径</h2><p>“材料 → 规则 → 模型 → 人审”只属于政策、信审、商务、资产；业务不代替任何专业人审。</p></header>
      <div>
        {professionalIds.map((processId) => {
          const process = processProjectionFor(role.projection, processId);
          return (
            <article key={processId}>
              <div className={styles.pathTitle}><strong>{PROCESS_LABELS[processId]}</strong><span>{process ? STATUS_LABELS[process.runStatus] ?? process.runStatus : '未提供'}</span></div>
              <ol>
                {PROFESSIONAL_PATH.map((step, index) => (
                  <li key={step} data-reached={process ? process.evidenceCoverageBand > index : false}><i>{index + 1}</i><b>{step}</b></li>
                ))}
              </ol>
              <p>Gate：{process ? STATUS_LABELS[process.gateState] ?? process.gateState : '未提供'} · Human required：{process ? (process.needsHuman ? '是' : '否') : '未提供'}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function CollaborationMatrix({ role }: { role: SurfaceRoleSnapshot }) {
  const collaboration = internalProjection(role);
  if (!collaboration?.workItems.length) return <StatePanel kind="empty" title="矩阵未提供" detail="当前 Role Projection 未返回内部协同工作项，界面 fail closed。" />;
  return (
    <div className={styles.matrixWrap}>
      <table><thead><tr><th>主体</th><th>当前任务</th><th>运行状态</th><th>Gate</th><th>Receipt</th></tr></thead>
        <tbody>{collaboration.workItems.map((item) => <tr key={item.processId}><th scope="row">{item.label}</th><td>{item.task || '未提供'}</td><td>{STATUS_LABELS[item.runStatus] ?? item.runStatus}</td><td>{STATUS_LABELS[item.gateState] ?? item.gateState}</td><td>未提供</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function MetricComparison({ metric }: { metric: V3KpiMetricDto }) {
  const maximum = Math.max(Math.abs(metric.target), Math.abs(metric.due), Math.abs(metric.value), 1);
  const rows = [
    ['目标', metric.target, styles.targetBar],
    ['应达', metric.due, styles.dueBar],
    ['当前', metric.value, styles.currentBar],
  ] as const;
  return (
    <article className={styles.metricChart} data-chart="metric-comparison">
      <div><span>{metric.valueClass.toUpperCase()} · {metric.periodGrain}</span><strong>{metric.label}</strong><em>{metric.value} {metric.unit}</em></div>
      <div className={styles.barRows}>{rows.map(([label, value, barClass]) => <p key={label}><b>{label}</b><i><span className={barClass} style={{ width: `${Math.max(4, Math.abs(value) / maximum * 100)}%` }} /></i><small>{value}</small></p>)}</div>
      <footer>较应达 {metric.deltaToDue >= 0 ? '+' : ''}{metric.deltaToDue} · {metric.dataCoverage.status === 'synthetic_demo_only' ? 'Scenario data' : metric.dataCoverage.status}</footer>
    </article>
  );
}

function WindowChart({ title, metricClass, role }: {
  title: string;
  metricClass: V3KpiMetricDto['metricClass'];
  role: SurfaceRoleSnapshot;
}) {
  const points = GRAINS.map((grain) => role.portfolio?.kpiWindows?.[grain]?.find((metric) => metric.metricClass === metricClass) ?? null);
  const max = Math.max(...points.map((metric) => Math.abs(metric?.value ?? 0)), 1);
  const hasData = points.some(Boolean);
  return (
    <article className={styles.windowChart} data-chart="window-comparison">
      <header><span>SCENARIO WINDOW COMPARISON</span><strong>{title}</strong></header>
      {hasData ? <div>{points.map((metric, index) => <p key={GRAINS[index]}><i style={{ height: `${Math.max(8, Math.abs(metric?.value ?? 0) / max * 100)}%` }} /><b>{metric?.value ?? '未提供'}</b><small>{GRAIN_LABELS[GRAINS[index]]}</small></p>)}</div> : <p className={styles.missingValue}>未提供</p>}
    </article>
  );
}

function ValueRelationship({ role }: { role: SurfaceRoleSnapshot }) {
  const metrics = role.portfolio?.kpis ?? [];
  if (!metrics.length) return <StatePanel kind="empty" title="价值指标未提供" detail={role.portfolioAccess === 'denied-by-contract' ? '当前外部 Role 无权访问经营组合 Projection。' : 'Back Projection 对当前 Role 未提供 KPI；界面未补造数值。'} />;
  return (
    <div className={styles.valueRelationship} data-chart-count={metrics.length}>
      <header><span>NORTH STAR · {role.portfolio?.northStar}</span><p>短期为主、长期为辅；全部数值来自本地 synthetic Scenario Projection，不代表生产财务结论。</p></header>
      <div className={styles.metricGrid}>{metrics.map((metric) => <MetricComparison key={metric.metricId} metric={metric} />)}</div>
      <div className={styles.caseContributionNote}><strong>Case contribution / profit waterfall</strong><span>未提供</span><p>Back contract 尚未返回 Case 级净利润归因或 waterfall；此处不按金额、风险或阶段推算贡献。</p></div>
    </div>
  );
}

function ValuePath({ role }: { role: SurfaceRoleSnapshot }) {
  if (!role.portfolio?.kpiWindows) return <StatePanel kind="empty" title="价值路径未提供" detail="当前 Role Projection 没有 KPI 时间窗口。" />;
  return (
    <div className={styles.valuePath} data-chart-count="2">
      <WindowChart title="可验证净收入 · 各观察窗口" metricClass="net_income" role={role} />
      <WindowChart title="单位资产产出效率 · 各观察窗口" metricClass="unit_asset_net_income" role={role} />
      <article className={styles.valueCaveat}><span>DATA COVERAGE</span><strong>财务 / 资产台账未对账</strong><p>缺失数据明确来自 `missingSystems`；当前仅用于 Scenario 演示，不形成 Receipt 或经营确认。</p></article>
    </div>
  );
}

function ValueMatrix({ role }: { role: SurfaceRoleSnapshot }) {
  const metrics = role.portfolio?.kpis ?? [];
  if (!metrics.length) return <StatePanel kind="empty" title="价值矩阵未提供" detail="当前 Role Projection 未返回可用 KPI 矩阵。" />;
  return (
    <div className={styles.valueMatrix} data-chart-count="0">
      <table><thead><tr><th>指标</th><th>口径</th><th>目标</th><th>应达</th><th>当前</th><th>差异</th><th>数据覆盖</th></tr></thead>
        <tbody>{metrics.map((metric) => <tr key={metric.metricId}><th scope="row">{metric.label}</th><td>{metric.formula}</td><td>{metric.target} {metric.unit}</td><td>{metric.due}</td><td>{metric.value}</td><td>{metric.deltaToDue}</td><td>{metric.dataCoverage.missingSystems.length ? `未连接：${metric.dataCoverage.missingSystems.join(' / ')}` : '未提供'}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function SurfaceMain({ section, mode, role, scope, onScopeChange }: {
  section: LeadershipSection;
  mode: SurfaceMode;
  role: SurfaceRoleSnapshot;
  scope: ScopeLevel;
  onScopeChange: (scope: ScopeLevel) => void;
}) {
  return (
    <div className={styles.mainSurface} data-mode={mode} data-chart-count={section === 'value' ? valueChartCount(mode) : 0}>
      <MainHeader section={section} role={role} scope={scope} onScopeChange={onScopeChange} />
      <div className={styles.surfaceContent}>
        {section === 'collaboration' && mode === 'relationship' ? <CollaborationRelationship role={role} scope={scope} onDrilldown={onScopeChange} /> : null}
        {section === 'collaboration' && mode === 'path' ? <ProfessionalPaths role={role} /> : null}
        {section === 'collaboration' && mode === 'matrix' ? <CollaborationMatrix role={role} /> : null}
        {section === 'value' && mode === 'relationship' ? <ValueRelationship role={role} /> : null}
        {section === 'value' && mode === 'path' ? <ValuePath role={role} /> : null}
        {section === 'value' && mode === 'matrix' ? <ValueMatrix role={role} /> : null}
      </div>
    </div>
  );
}

function messageBadge(entry: V3CollaborationThreadEntryDto): string {
  const looksLikeAi = /AI|模型|见微/.test(entry.actorLabel);
  if (looksLikeAi) return 'candidate · authority none';
  return `${entry.kind === 'scenario' ? 'Scenario' : 'Human message'} · authority none`;
}

function ChatPanel({ data, role, message, busy, sendError, onMessageChange, onSend }: {
  data: LeadershipSurfaceData;
  role: SurfaceRoleSnapshot;
  message: string;
  busy: boolean;
  sendError: string;
  onMessageChange: (value: string) => void;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const collaboration = internalProjection(role);
  const externalTask = role.projection.scope?.externalTask;
  const canSend = role.principalId === 'collaboration-manager' && data.collaboration.creditFlowAvailable;
  const entries = collaboration?.thread.entries ?? [];
  return (
    <div className={styles.chatPanel} data-role={role.principalId}>
      <header><div><span>CURRENT CONTEXT CHAT</span><h2>当前上下文群聊</h2></div><em>{collaboration ? `${collaboration.memberCount} 人` : '邀请范围'}</em><p>{collaboration?.thread.title ?? (externalTask ? `受邀工作项 · ${externalTask.workstepProcessId}` : '未提供')}</p></header>
      <div className={styles.roleBoundary}><strong>{SURFACE_ROLES.find((item) => item.principalId === role.principalId)?.label}</strong><span>{role.projection.scope?.visibleProcessIds.join(' / ') || '未提供'}</span></div>
      <div className={styles.memberRow}>{collaboration?.thread.members.length ? collaboration.thread.members.map((member) => <span key={member.principalId}>{member.label} · {member.ownerLabel}</span>) : <small>{externalTask ? '外部协同仅显示邀请范围，不显示内部成员。' : '成员未提供'}</small>}</div>
      <div className={styles.chatLog} aria-live="polite">
        {entries.length ? entries.map((entry) => <article key={entry.entryId} className={entry.kind === 'human-message' ? styles.humanMessage : undefined} data-authority={entry.authority}><b>{entry.actorLabel}</b><p>{entry.text}</p><small>{messageBadge(entry)} · {entry.contextVersion}</small></article>) : <StatePanel kind="empty" title="群聊消息未提供" detail={externalTask ? '当前外部 Role 仅获得受邀任务 Projection。' : 'Back Projection 未返回群聊消息。'} />}
      </div>
      <p className={styles.chatAuthority}>AI reply 若出现，只能是 <b>candidate · authority none</b>；群聊不生成 Authority / Context Packet / Receipt / Gate。</p>
      <form className={styles.chatForm} onSubmit={onSend}>
        <textarea value={message} onChange={(event) => onMessageChange(event.target.value)} placeholder={canSend ? '向当前项目群聊发送协同问题…' : '当前 Role 在此 shared surface 中为只读 Projection'} maxLength={600} disabled={!canSend || busy} aria-label="当前上下文群聊消息" />
        <button type="submit" disabled={!canSend || busy || !message.trim()}>{busy ? '发送中' : '发送'}</button>
      </form>
      {sendError ? <p className={styles.sendError} role="alert">{sendError}</p> : null}
    </div>
  );
}

export default function LeadershipSurface({ initialSection = 'collaboration' }: LeadershipSurfaceProps) {
  const [section, setSection] = useState<LeadershipSection>(initialSection);
  const [mode, setMode] = useState<SurfaceMode>('relationship');
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [data, setData] = useState<LeadershipSurfaceData | null>(null);
  const [role, setRole] = useState<SurfaceRoleSnapshot | null>(null);
  const [roleBusy, setRoleBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [scope, setScope] = useState<ScopeLevel>('portfolio');
  const [message, setMessage] = useState('');
  const [pendingRequest, setPendingRequest] = useState<{ message: string; requestId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState('');
  const roleRequest = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    void initializeLeadershipSurface(controller.signal).then((next) => {
      setData(next);
      setRole(next.role);
      setLoadState('ready');
    }).catch((caught: unknown) => {
      if (controller.signal.aborted) return;
      setData(null);
      setRole(null);
      setLoadState('error');
      setError(caught instanceof Error ? caught.message : 'shared surface 载入失败');
    });
    return () => controller.abort();
  }, [loadAttempt]);

  function retryLoad() {
    setLoadState('loading');
    setError('');
    setLoadAttempt((attempt) => attempt + 1);
  }

  const progressLevels = useMemo(() => ({
    policy: progressLevelForProcess(role?.projection ?? null, 'policy'),
    credit: progressLevelForProcess(role?.projection ?? null, 'credit'),
    commercial: progressLevelForProcess(role?.projection ?? null, 'commercial'),
    asset: progressLevelForProcess(role?.projection ?? null, 'asset'),
  }), [role]);

  function changeSection(next: LeadershipSection) {
    setSection(next);
    setMode('relationship');
    setScope('portfolio');
    const path = next === 'collaboration' ? '/collaboration' : '/value';
    globalThis.history?.replaceState(null, '', path);
  }

  async function changeRole(principalId: SurfacePrincipalId) {
    if (principalId === role?.principalId) return;
    const requestId = ++roleRequest.current;
    setRoleBusy(true);
    setError('');
    setMessage('');
    setSendError('');
    try {
      const next = await loadSurfaceRole(principalId);
      if (requestId !== roleRequest.current) return;
      setRole(next);
      setScope(principalId.startsWith('external-') ? next.casePanel.items[0]?.caseId ?? 'portfolio' : 'portfolio');
    } catch (caught) {
      if (requestId !== roleRequest.current) return;
      setRole(null);
      setError(caught instanceof Error ? caught.message : 'Role Projection 载入失败');
    } finally {
      if (requestId === roleRequest.current) setRoleBusy(false);
    }
  }

  function changeMessage(value: string) {
    setMessage(value);
    setSendError('');
    setPendingRequest((current) => current && current.message === value.trim() ? current : null);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = message.trim();
    if (!data || !role || role.principalId !== 'collaboration-manager' || !normalized || busy) return;
    setBusy(true);
    setSendError('');
    try {
      const intent = pendingRequest?.message === normalized ? pendingRequest : {
        message: normalized,
        requestId: `collaboration-${globalThis.crypto.randomUUID()}`,
      };
      setPendingRequest(intent);
      const collaboration = await getCollaborationClient().sendMessage({ sessionId: data.collaboration.sessionId, requestId: intent.requestId, message: normalized });
      setData((current) => current ? { ...current, collaboration } : current);
      setRole((current) => {
        if (!current) return current;
        const currentCollaboration = internalProjection(current);
        if (!currentCollaboration) return current;
        const nextCollaboration: V3InternalCollaborationProjectionDto = {
          ...currentCollaboration,
          thread: {
            ...currentCollaboration.thread,
            title: collaboration.thread.title,
            members: collaboration.thread.members,
            entries: collaboration.thread.entries,
          },
        };
        return {
          ...current,
          projection: { ...current.projection, collaborationProjection: nextCollaboration },
        };
      });
      setMessage('');
      setPendingRequest(null);
    } catch (caught) {
      setSendError(caught instanceof Error ? caught.message : '消息发送失败');
    } finally {
      setBusy(false);
    }
  }

  const objective = data?.collaboration.objective.title ?? (loadState === 'loading' ? '正在载入当前目标' : '未提供');
  const contextLabel = role?.projection.contextVersion ?? (roleBusy || loadState === 'loading' ? '载入中' : '未提供');
  const main = loadState === 'loading' || roleBusy
    ? <StatePanel kind="loading" title="正在载入 Projection" detail="协同、价值与 Role Projection 必须通过 Back contract coherence Gate。" />
    : loadState === 'error' || !data || !role
      ? <StatePanel kind="error" title="shared surface fail closed" detail={error || 'Projection 未提供'} onRetry={retryLoad} />
      : <SurfaceMain section={section} mode={mode} role={role} scope={scope} onScopeChange={setScope} />;
  const chat = loadState === 'loading' || roleBusy
    ? <StatePanel kind="loading" title="正在载入当前上下文群聊" detail="群聊容器保留，内容在 Role Projection 完成前不显示。" />
    : loadState === 'error' || !data || !role
      ? <StatePanel kind="error" title="群聊 fail closed" detail={error || '当前上下文未提供'} />
      : <ChatPanel data={data} role={role} message={message} busy={busy} sendError={sendError} onMessageChange={changeMessage} onSend={sendMessage} />;

  return (
    <SharedSurfaceShell
      entryId={section}
      family="leadership"
      pageTitle={section === 'collaboration' ? '经营协同' : '价值验证'}
      currentObjective={objective}
      defaultMode={mode}
      quarterProgress={progressLevels}
      context={{ label: '共享上下文', value: contextLabel }}
      role={{
        principalId: role?.principalId ?? 'collaboration-manager',
        label: 'Role Projection',
        options: SURFACE_ROLES,
        busy: roleBusy || loadState === 'loading',
        onChange: (principalId) => void changeRole(principalId as SurfacePrincipalId),
      }}
      entryTabs={[
        { entryId: 'collaboration', label: '协同', icon: 'collaboration' },
        { entryId: 'value', label: '价值', icon: 'value' },
      ]}
      boundaryNote="Projection only · AI candidate / authority none · 专业 Gate 由具名人完成"
      onEntryChange={(entryId) => changeSection(entryId as LeadershipSection)}
      onModeChange={setMode}
      mainContent={main}
      chat={chat}
    />
  );
}
