'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { V3LeadershipSurfaceProjection } from '../../../lib/v3-surfaces/leadership/projections';
import type { V3ProfessionalRole, V3RoleProjectionId } from '../../../lib/v3-surfaces/shared/contracts';
import { JwIcon } from '../../jw-front';
import { SharedChatPanel, type SharedChatSnapshot } from '../shared/shared-chat';
import { SharedSurfaceShell } from '../shared/surface-shell';
import { SURFACE_ROLES, type SurfaceMode, type SurfacePrincipalId } from '../shared/surface-model';
import styles from './insight-runtime.module.css';

const PRINCIPAL_ROLE: Record<SurfacePrincipalId, V3RoleProjectionId> = {
  'collaboration-manager': 'leadership', 'business-owner': 'business', 'risk-policy': 'policy',
  'risk-credit': 'credit', 'risk-commercial': 'commercial', 'risk-asset': 'asset',
  'external-customer': 'customer', 'external-supplier': 'supplier',
};
const PROFESSIONAL_LABELS: Record<V3ProfessionalRole, string> = {
  policy: '政策', credit: '信审', commercial: '商务', asset: '资产',
};
const GOLDEN_QUERY = 'grain=case&portfolioId=PORTFOLIO-JW-DEMO&divisionId=DIV-EAST&caseId=FL-DEMO-001';

function bandLevel(threshold: number | null): 0 | 1 | 2 | 3 | 4 | null {
  if (threshold === null) return null;
  return Math.min(4, Math.max(0, Math.round(threshold / (100 / 4)))) as 0 | 1 | 2 | 3 | 4;
}

function bandLabel(threshold: number | null): string {
  const level = bandLevel(threshold);
  return level === null ? '未提供' : level === 0 ? '尚未推进' : `第 ${level} 档`;
}

function StatePanel({ kind, detail, retry }: { kind: 'loading' | 'error'; detail: string; retry?: () => void }) {
  return <div className={styles.state} data-state={kind} role={kind === 'error' ? 'alert' : 'status'} aria-live={kind === 'error' ? 'assertive' : 'polite'}><JwIcon name={kind === 'error' ? 'permission' : 'monitor'} size={28} /><h2>{kind === 'loading' ? '正在载入 System Projection' : 'Projection fail closed'}</h2><p>{detail}</p>{retry ? <button type="button" onClick={retry}>重试</button> : null}</div>;
}

function Relationship({ data }: { data: V3LeadershipSurfaceProjection }) {
  const paths = data.readModel.professionalPaths;
  return <div className={styles.relationship} data-chart-count={data.readModel.charts.length}>
    <section className={styles.runtimeMap} aria-label="System Relationship">
      <div className={styles.jwNode}><JwIcon name="eye" size={26} /><b>见微</b><small>连接中枢 · authority none</small></div>
      <div className={styles.businessNode}><JwIcon name="crown" size={22} /><b>业务</b><small>组织 Case · 不替 Gate</small></div>
      {paths.map((path) => <article key={path.role} data-role={path.role}><strong>{PROFESSIONAL_LABELS[path.role]}</strong><span>{bandLabel(path.frontendQuarterThreshold)}</span><small>材料 → 规则 → 模型 → 人审</small></article>)}
    </section>
    <section className={styles.chartGrid} aria-label="最多四个 System charts">
      {data.readModel.charts.map((chart) => {
        const maxValue = Math.max(1, ...chart.data.flatMap((datum) => typeof datum.value === 'number' ? [Math.abs(datum.value)] : []));
        return <article key={chart.chartId} data-chart={chart.chartKind}><header><span>{chart.chartKind.toUpperCase()}</span><h3>{chart.title}</h3><small>Metric · 图内相对尺度 · 非四档进度</small></header>{chart.data.map((datum) => <p key={datum.datumId}><b>{datum.label}</b><i aria-label="图内相对尺度"><span style={{ transform: `scaleX(${typeof datum.value === 'number' ? Math.abs(datum.value) / maxValue : 0})` }} /></i><strong>{datum.displayValue}{datum.unit ? ` ${datum.unit}` : ''}</strong><small>source {datum.provenance.sourceRefs.join(', ') || datum.provenance.sourceKind} · asOf {datum.provenance.asOf ?? '未提供'}</small></p>)}</article>;
      })}
    </section>
  </div>;
}

function Path({ data }: { data: V3LeadershipSurfaceProjection }) {
  return <div className={styles.paths} data-stage-order="材料-规则-模型-人审" data-chart-count="0">{data.readModel.professionalPaths.map((path) => {
    const level = bandLevel(path.frontendQuarterThreshold);
    return <article key={path.role}><header><span>{path.role.toUpperCase()}</span><h2>{PROFESSIONAL_LABELS[path.role]}专业路径</h2><strong>{bandLabel(path.frontendQuarterThreshold)}</strong></header><ol>{path.stepLabels.map((label, index) => <li key={label} data-reached={level !== null && level >= index + 1}><i>{index + 1}</i><b>{label}</b><small>{label === '模型' ? 'candidate · authority none' : label === '人审' ? 'Named Human Gate' : 'shared source'}</small></li>)}</ol></article>;
  })}</div>;
}

function Matrix({ data }: { data: V3LeadershipSurfaceProjection }) {
  return <div className={styles.matrix} data-chart-count="0"><table><thead><tr><th>Role</th><th>Shared Context</th><th>Backend metric</th><th>Scale</th><th>Frontend band</th><th>Authority</th><th>Source / asOf</th></tr></thead><tbody>{data.readModel.professionalPaths.map((path) => <tr key={path.role}><th>{PROFESSIONAL_LABELS[path.role]}</th><td>{data.readModel.context.contextVersion}</td><td>{path.backendContinuousProgress ?? '未提供'}</td><td>continuous points · 0–100</td><td>{bandLabel(path.frontendQuarterThreshold)}</td><td>candidate none / Human Gate required</td><td>{data.readModel.scenarioRef.scenarioVersion} / {data.readModel.charts[0]?.data[0]?.provenance.sourceRefs.join(', ') || '未提供'} / {data.readModel.charts[0]?.data[0]?.provenance.asOf ?? '未提供'}</td></tr>)}</tbody></table></div>;
}

export default function InsightRuntime() {
  const [mode, setMode] = useState<SurfaceMode>('relationship');
  const [principalId, setPrincipalId] = useState<SurfacePrincipalId>('collaboration-manager');
  const [data, setData] = useState<V3LeadershipSurfaceProjection | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [chatSnapshot, setChatSnapshot] = useState<SharedChatSnapshot | null>(null);
  const actorRole = PRINCIPAL_ROLE[principalId];

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v3/insight?role=${actorRole}&${GOLDEN_QUERY}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as V3LeadershipSurfaceProjection & { error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message || `Insight HTTP ${response.status}`);
        return body;
      })
      .then((next) => { setData(next); setStatus('ready'); })
      .catch((caught: unknown) => { if (!controller.signal.aborted) { setData(null); setStatus('error'); setError(caught instanceof Error ? caught.message : 'Insight 载入失败'); } });
    return () => controller.abort();
  }, [actorRole, attempt]);

  const progress = useMemo(() => Object.fromEntries((data?.readModel.professionalPaths ?? []).map((path) => [path.role, bandLevel(path.frontendQuarterThreshold)])) as Record<V3ProfessionalRole, 0 | 1 | 2 | 3 | 4 | null>, [data]);
  const onContext = useCallback((snapshot: SharedChatSnapshot) => setChatSnapshot(snapshot), []);
  const main = status === 'loading'
    ? <StatePanel kind="loading" detail="正在读取 canonical shared SQLite projection。" />
    : status === 'error' || !data
      ? <StatePanel kind="error" detail={error || '未提供'} retry={() => { setStatus('loading'); setError(''); setAttempt((value) => value + 1); }} />
      : mode === 'relationship' ? <Relationship data={data} /> : mode === 'path' ? <Path data={data} /> : <Matrix data={data} />;

  return <SharedSurfaceShell
    entryId="insight" family="insight" pageTitle="见微 · System Runtime"
    currentObjective="观察 shared context、Agent candidate 与 Human Gate 边界"
    defaultMode={mode}
    quarterProgress={{ policy: progress.policy ?? null, credit: progress.credit ?? null, commercial: progress.commercial ?? null, asset: progress.asset ?? null }}
    context={{ label: '共享上下文', value: chatSnapshot?.context.contextVersion ?? data?.readModel.context.contextVersion ?? (status === 'loading' ? '载入中' : '未提供') }}
    role={{ principalId, label: 'Role Projection', options: SURFACE_ROLES, busy: status === 'loading', onChange: (next) => {
      if (next === principalId) return;
      setStatus('loading'); setError(''); setPrincipalId(next as SurfacePrincipalId);
    } }}
    boundaryNote="System Projection · AI candidate / authority none · source/provenance 可追溯"
    onModeChange={setMode} mainContent={<div className={styles.mainContent}><h1 className={styles.srOnly}>见微智能运行视图</h1>{main}</div>}
    chat={<SharedChatPanel key={actorRole} actorRole={actorRole} onContext={onContext} />}
  />;
}
