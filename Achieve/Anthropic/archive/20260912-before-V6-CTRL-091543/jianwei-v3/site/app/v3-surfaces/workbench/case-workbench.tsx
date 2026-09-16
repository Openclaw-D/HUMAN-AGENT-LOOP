'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { V3DemoSessionDto } from '../../../lib/v3-client';
import type {
  BusinessActionType,
  ProfessionalActionType,
  WorkbenchActionResult,
  WorkbenchProfessionalProjection,
  WorkbenchReadModel,
} from '../../../lib/v3-surfaces/workbench/types';
import { JwIcon } from '../../jw-front';
import { SharedChatPanel, type SharedChatSnapshot } from '../shared/shared-chat';
import { SharedSurfaceShell } from '../shared/surface-shell';
import { SURFACE_ROLES, type SurfacePrincipalId, type V3QuarterProgress } from '../shared/surface-model';
import { createWorkbenchSession, readWorkbench, submitWorkbenchAction } from './workbench-client';
import {
  BUSINESS_ACTION_LABELS,
  PRINCIPAL_ROLE,
  PROFESSIONAL_ACTION_LABELS,
  ROUTE_PRINCIPAL,
  WORKBENCH_ROUTES,
  coarseProgressLabel,
  pathStateLabel,
  quarterThresholdLevel,
  safeDisplay,
  type ProfessionalId,
  type WorkbenchMode,
  type WorkbenchRouteId,
} from './workbench-model';
import styles from './workbench.module.css';

const PROFESSIONAL_IDS = ['policy', 'credit', 'commercial', 'asset'] as const;
const WORKBENCH_TABS = (Object.entries(WORKBENCH_ROUTES) as Array<[WorkbenchRouteId, (typeof WORKBENCH_ROUTES)[WorkbenchRouteId]]>)
  .map(([entryId, item]) => ({ entryId, label: item.label, icon: item.icon }));
const INTERNAL_TARGETS = [
  ['business-owner', '业务'], ['risk-policy', '政策'], ['risk-credit', '信审'],
  ['risk-commercial', '商务'], ['risk-asset', '资产'],
] as const;

function progressStyle(level: number | null): CSSProperties {
  return { '--workbench-progress-level': level ?? 0 } as CSSProperties;
}

function RelationshipView({
  model,
  active,
  onSelect,
}: {
  model: WorkbenchReadModel;
  active: ProfessionalId | null;
  onSelect: (id: ProfessionalId) => void;
}) {
  return (
    <section className={styles.relationshipView} aria-label="业务与四专业固定四象限关系图">
      <div className={styles.orbit} aria-hidden="true" />
      <div className={styles.crossHorizontal} aria-hidden="true" />
      <div className={styles.crossVertical} aria-hidden="true" />
      {PROFESSIONAL_IDS.map((id) => {
        const item = model.professionalProjections[id];
        const level = quarterThresholdLevel(item.rollup.quarterThreshold);
        return (
          <button
            key={id}
            type="button"
            className={`${styles.professionalNode} ${styles[item.quadrant]} ${active === id ? styles.activeNode : ''}`}
            onClick={() => onSelect(id)}
            aria-label={`${item.label}，${coarseProgressLabel(item.rollup.quarterThreshold)}`}
          >
            <span className={styles.nodeIcon}><JwIcon name={WORKBENCH_ROUTES[id].icon} size={22} /></span>
            <span><b>{item.label}</b><small>{safeDisplay(item.principalId)}</small></span>
            <span className={styles.nodeSignal}>{safeDisplay(item.result)}</span>
            <i className={styles.progressTrack} style={progressStyle(level)} aria-hidden="true" />
          </button>
        );
      })}
      <div className={styles.businessNode}>
        <span className={styles.crown}><JwIcon name="crown" size={28} /></span>
        <p>Case Owner</p>
        <h2>业务</h2>
        <span>组织同一事项</span>
        <small>不替代专业 Gate</small>
      </div>
    </section>
  );
}

function ProfessionalPathView({ projection }: { projection: WorkbenchProfessionalProjection }) {
  return (
    <section className={styles.pathView} aria-label={`${projection.label}材料到人审路径`}>
      <header className={styles.professionalIntro}>
        <span className={styles.largeIcon}><JwIcon name={WORKBENCH_ROUTES[projection.perspective].icon} size={32} /></span>
        <div>
          <p>{projection.label} · SERVER PROFESSIONAL PATH</p>
          <h2>{safeDisplay(projection.professionalContent.rulePurpose)}</h2>
        </div>
        <aside><span>{coarseProgressLabel(projection.rollup.quarterThreshold)}</span><strong>{safeDisplay(projection.result)}</strong></aside>
      </header>
      <div className={styles.pathCanvas}>
        <div className={styles.pathLine} aria-hidden="true" />
        {projection.path.map((step, index) => (
          <article key={step.stepId} className={`${styles.stageCard} ${styles[`stage${index + 1}`]}`} data-step-status={step.status}>
            <div className={styles.stageNumber}>0{index + 1}</div>
            <p>{step.authority === 'confirmed_human' ? 'NAMED HUMAN AUTHORITY' : 'AUTHORITY NONE'}</p>
            <h3>{step.label}</h3>
            <span>{safeDisplay(step.result)}</span>
            <small>{pathStateLabel(step)} · {safeDisplay(step.contextVersion)}</small>
          </article>
        ))}
        <aside className={styles.gateReceipt}>
          <span>Human Gate</span>
          <strong>{safeDisplay(projection.professionalContent.humanGateLabel)}</strong>
          <p>{safeDisplay(projection.humanGate.principalId)}</p>
          <small>{safeDisplay(projection.humanGate.receiptId)}</small>
        </aside>
      </div>
    </section>
  );
}

function ProfessionalMatrixView({ projection }: { projection: WorkbenchProfessionalProjection }) {
  const evidence = projection.evidenceSources.map((item) => `${item.evidenceName}：${item.availability === 'available' ? safeDisplay(item.sourceRef) : '未提供'}`).join('；') || '未提供';
  const rows = [
    { layer: '材料', definition: evidence, output: `${projection.evidenceSources.filter((item) => item.availability === 'available').length} 项已提供`, authority: 'Evidence Receipt' },
    { layer: '规则', definition: projection.professionalContent.ruleName, output: projection.professionalContent.rulePurpose, authority: '规则不自动批准' },
    { layer: '模型', definition: projection.professionalContent.modelTask, output: projection.modelCandidate.result, authority: 'candidate · authority none' },
    { layer: '人审', definition: projection.professionalContent.humanGateLabel, output: projection.humanGate.result, authority: projection.humanGate.authority === 'confirmed_human' ? '具名 Human Gate' : '未提供' },
  ];
  return (
    <section className={styles.matrixView} aria-label={`${projection.label} server projection 矩阵`}>
      <header className={styles.matrixHeader}>
        <div><p>SERVER MATRIX · {projection.label}</p><h2>材料、规则、模型与具名人审严格分层</h2></div>
        <aside><span>{coarseProgressLabel(projection.rollup.quarterThreshold)}</span><strong>{safeDisplay(projection.result)}</strong></aside>
      </header>
      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>层级</th><th>Server DTO 定义</th><th>当前投影</th><th>Authority</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.layer}><th>{row.layer}</th><td>{safeDisplay(row.definition)}</td><td>{safeDisplay(row.output)}</td><td>{row.authority}</td></tr>)}</tbody>
        </table>
      </div>
      <footer className={styles.matrixFooter}>
        <span>{safeDisplay(projection.principalId)}</span>
        <strong>{safeDisplay(projection.professionalContent.humanGateLabel)}</strong>
        <small>{safeDisplay(projection.humanGate.receiptId)}</small>
      </footer>
    </section>
  );
}

function BusinessDetailView({ model, mode }: { model: WorkbenchReadModel; mode: WorkbenchMode }) {
  return (
    <section className={styles.businessDetail} aria-label="业务宏观 server projection">
      <header><p>BUSINESS MACRO VIEW · {mode.toUpperCase()}</p><h2>业务组织四专业推进，不替代任何专业结论</h2></header>
      <div className={styles.businessGrid}>
        {PROFESSIONAL_IDS.map((id) => {
          const item = model.professionalProjections[id];
          return <article key={id}><span>{item.label}</span><strong>{safeDisplay(item.result)}</strong><p>{coarseProgressLabel(item.rollup.quarterThreshold)}</p><small>{safeDisplay(item.professionalContent.humanGateLabel)}</small></article>;
        })}
      </div>
    </section>
  );
}

function ActionPanel({
  model,
  route,
  sessionId,
  onRefresh,
}: {
  model: WorkbenchReadModel;
  route: WorkbenchRouteId;
  sessionId: string;
  onRefresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [target, setTarget] = useState(route === 'business' ? 'risk-credit' : 'business-owner');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const projection = route === 'business' ? null : model.professionalProjections[route];
  const receiptIds = projection?.evidenceSources.flatMap((source) => source.evidenceReceiptId ? [source.evidenceReceiptId] : []) ?? [];
  const writable = model.roleProjection.writablePerspectives.includes(route) && !model.readOnly && Boolean(model.contextVersion);

  async function act(actionType: BusinessActionType | ProfessionalActionType) {
    const text = draft.trim();
    if (!model.contextVersion || !text || busy) return;
    setBusy(actionType);
    setNotice(null);
    try {
      const base = {
        requestId: `workbench-${globalThis.crypto.randomUUID()}`,
        expectedContextVersion: model.contextVersion,
        actionType,
      };
      let result: WorkbenchActionResult;
      if (route === 'business') {
        result = await submitWorkbenchAction(route, sessionId, { ...base, targetPrincipalId: target, message: text });
      } else if (actionType === 'request-evidence') {
        result = await submitWorkbenchAction(route, sessionId, { ...base, targetPrincipalId: target, message: text });
      } else {
        result = await submitWorkbenchAction(route, sessionId, { ...base, rationale: text, evidenceReceiptIds: receiptIds });
      }
      setNotice({ tone: 'success', text: `${result.result} · ${result.authority === 'none' ? 'authority none' : '具名 Human authority'} · ${safeDisplay(result.receiptId)}` });
      setDraft('');
      try {
        await onRefresh();
      } catch (refreshError) {
        setNotice({
          tone: 'error',
          text: `动作已由 server 接收，但刷新失败：${refreshError instanceof Error ? refreshError.message : '未提供'}`,
        });
      }
    } catch (caught) {
      setNotice({ tone: 'error', text: caught instanceof Error ? caught.message : '动作提交失败' });
    } finally {
      setBusy(null);
    }
  }

  if (!model.roleProjection.visiblePerspectives.includes(route)) {
    return <div className={styles.actionBoundary}>当前 Role Projection 无权查看此 Workbench。</div>;
  }
  if (!writable) {
    return <div className={styles.actionBoundary}>只读 Projection · 当前角色不能提交此页面动作；AI/chat candidate authority=none。</div>;
  }

  return (
    <section className={styles.actionPanel} aria-label="Workbench server action">
      <label><span>{route === 'business' ? '协调说明' : '专业依据 / 补证说明'}</span><input value={draft} maxLength={600} onChange={(event) => { setDraft(event.target.value); setNotice(null); }} placeholder="输入将随 command 写入 server；不会只保存在本地" /></label>
      <label><span>路由对象</span><select value={target} onChange={(event) => setTarget(event.target.value)}>{INTERNAL_TARGETS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div className={styles.actionButtons}>
        {route === 'business' ? model.businessOverview.allowedActions.map((action) => (
          <button key={action} type="button" disabled={!draft.trim() || Boolean(busy)} onClick={() => void act(action)}>{busy === action ? '提交中…' : BUSINESS_ACTION_LABELS[action]}</button>
        )) : (
          <>
            <button type="button" disabled={!draft.trim() || Boolean(busy)} onClick={() => void act('request-evidence')}>{busy === 'request-evidence' ? '路由中…' : PROFESSIONAL_ACTION_LABELS['request-evidence']}</button>
            {(['confirm', 'return', 'reject'] as const).map((action) => <button key={action} type="button" disabled={!draft.trim() || Boolean(busy) || receiptIds.length === 0} onClick={() => void act(action)}>{busy === action ? '记录中…' : PROFESSIONAL_ACTION_LABELS[action]}</button>)}
          </>
        )}
      </div>
      {route !== 'business' && receiptIds.length === 0 ? <small>专业 Gate disabled：具名 Evidence Receipt 未提供；仅可请求补证。</small> : null}
      {notice ? <p className={notice.tone === 'error' ? styles.actionError : styles.actionSuccess} role={notice.tone === 'error' ? 'alert' : 'status'} aria-live="polite">{notice.text}</p> : null}
    </section>
  );
}

function ExternalBoundary({ role }: { role: 'customer' | 'supplier' }) {
  return (
    <section className={styles.externalBoundary}>
      <JwIcon name="permission" size={28} />
      <h2>{role === 'customer' ? '客户' : '供应商'}受邀协同 Projection</h2>
      <p>外部角色不进入内部 Case Workbench。右侧只读取 server invitation-scoped projection，不返回内部消息或内部 Receipt。</p>
    </section>
  );
}

export function CaseWorkbench({ initialRoute }: { initialRoute: WorkbenchRouteId }) {
  const router = useRouter();
  const route = WORKBENCH_ROUTES[initialRoute];
  const [mode, setMode] = useState<WorkbenchMode>(route.defaultMode);
  const [principalId, setPrincipalId] = useState<SurfacePrincipalId>(ROUTE_PRINCIPAL[initialRoute]);
  const [session, setSession] = useState<V3DemoSessionDto | null>(null);
  const [model, setModel] = useState<WorkbenchReadModel | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [chatSnapshot, setChatSnapshot] = useState<SharedChatSnapshot | null>(null);
  const actorRole = PRINCIPAL_ROLE[principalId];
  const external = actorRole === 'customer' || actorRole === 'supplier';

  useEffect(() => {
    const controller = new AbortController();
    void createWorkbenchSession(principalId, controller.signal)
      .then(async (nextSession) => {
        if (controller.signal.aborted) return;
        setSession(nextSession);
        if (external) return null;
        return readWorkbench(initialRoute, nextSession.sessionId, controller.signal);
      })
      .then((nextModel) => {
        if (controller.signal.aborted) return;
        setModel(nextModel ?? null);
        setStatus('ready');
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setStatus('error');
        setError(caught instanceof Error ? caught.message : 'Workbench server projection 不可用');
      });
    return () => controller.abort();
  }, [external, initialRoute, principalId, attempt]);

  const refresh = useCallback(async () => {
    if (!session || external) return;
    const next = await readWorkbench(initialRoute, session.sessionId);
    setModel(next);
  }, [external, initialRoute, session]);

  const quarterProgress = useMemo<V3QuarterProgress>(() => ({
    policy: quarterThresholdLevel(model?.professionalProjections.policy.rollup.quarterThreshold ?? null),
    credit: quarterThresholdLevel(model?.professionalProjections.credit.rollup.quarterThreshold ?? null),
    commercial: quarterThresholdLevel(model?.professionalProjections.commercial.rollup.quarterThreshold ?? null),
    asset: quarterThresholdLevel(model?.professionalProjections.asset.rollup.quarterThreshold ?? null),
  }), [model]);

  let mainContent;
  if (status === 'loading') {
    mainContent = <section className={styles.mainSurface}><div className={styles.loadState}><JwIcon name="monitor" size={28} /><h2>正在载入 canonical Workbench DTO</h2><p>server source · fail closed</p></div></section>;
  } else if (status === 'error') {
    mainContent = <section className={styles.mainSurface}><div className={styles.loadState} role="alert"><JwIcon name="permission" size={28} /><h2>Workbench fail closed</h2><p>{safeDisplay(error)}</p><button type="button" onClick={() => { setStatus('loading'); setError(''); setModel(null); setSession(null); setAttempt((value) => value + 1); }}>重试</button></div></section>;
  } else if (external) {
    mainContent = <section className={styles.mainSurface}><ExternalBoundary role={actorRole} /></section>;
  } else if (!model || !session) {
    mainContent = <section className={styles.mainSurface}><div className={styles.loadState} role="alert"><h2>Workbench DTO 未提供</h2></div></section>;
  } else {
    const professional = initialRoute === 'business' ? null : model.professionalProjections[initialRoute];
    mainContent = (
      <section className={styles.mainSurface} data-workbench-route={initialRoute} data-workbench-source={model.provenance.source}>
        <header className={styles.surfaceHeader}>
          <div>
            <p>{route.label} · CANONICAL CASE WORKBENCH</p>
            <h1 data-testid="workbench-heading">{route.heading}</h1>
            <small>Scenario · {model.provenance.dataClass}（合成去标识演示） · {model.integration.authorityRuntime.persistence} · 非 production/live · asOf {safeDisplay(model.provenance.asOf)}</small>
          </div>
          <dl className={styles.caseFacts}><div><dt>Case</dt><dd>{model.caseId}</dd></div><div><dt>阶段</dt><dd>{safeDisplay(model.caseContext.phase)}</dd></div><div><dt>对手方</dt><dd>{safeDisplay(model.caseContext.counterparty)}</dd></div></dl>
        </header>
        <ActionPanel model={model} route={initialRoute} sessionId={session.sessionId} onRefresh={refresh} />
        <div className={styles.visualSurface}>
          {initialRoute === 'business' && mode === 'relationship' ? <RelationshipView model={model} active={null} onSelect={(id) => router.push(`/${id}`)} /> : null}
          {initialRoute === 'business' && mode !== 'relationship' ? <BusinessDetailView model={model} mode={mode} /> : null}
          {professional && mode === 'relationship' ? <RelationshipView model={model} active={professional.perspective} onSelect={(id) => router.push(`/${id}`)} /> : null}
          {professional && mode === 'path' ? <ProfessionalPathView projection={professional} /> : null}
          {professional && mode === 'matrix' ? <ProfessionalMatrixView projection={professional} /> : null}
        </div>
      </section>
    );
  }

  const roleLabel = SURFACE_ROLES.find((item) => item.principalId === principalId)?.label ?? principalId;
  const chat = status === 'ready' && session ? (
    <SharedChatPanel key={`${actorRole}-${session.sessionId}`} actorRole={actorRole} onContext={setChatSnapshot} />
  ) : <div className={styles.chatPending}>群聊等待 server session…</div>;

  return (
    <SharedSurfaceShell
      entryId={initialRoute}
      family="workbench"
      pageTitle={route.pageTitle}
      currentObjective={`${route.label} · FL-DEMO-001 · ${roleLabel} Projection`}
      defaultMode={mode}
      quarterProgress={quarterProgress}
      context={{ label: '共享上下文', value: chatSnapshot?.context.contextVersion ?? model?.contextVersion ?? (status === 'loading' ? '载入中' : '未提供') }}
      role={{
        principalId,
        label: 'Role Projection',
        options: SURFACE_ROLES,
        busy: status === 'loading',
        onChange: (next) => {
          if (!(next in PRINCIPAL_ROLE)) return;
          setStatus('loading');
          setError('');
          setModel(null);
          setSession(null);
          setChatSnapshot(null);
          setPrincipalId(next as SurfacePrincipalId);
        },
      }}
      entryTabs={WORKBENCH_TABS}
      boundaryNote="Business 不批准专业 Gate · AI/chat candidate authority none"
      onEntryChange={(entryId) => router.push(`/${entryId}`)}
      onModeChange={setMode}
      mainContent={mainContent}
      chat={chat}
    />
  );
}
