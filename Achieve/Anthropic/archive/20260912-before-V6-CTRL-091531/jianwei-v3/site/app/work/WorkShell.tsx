'use client';

// /work 工作壳（主 Agent 串行整合层，2026-09-04）
// 唯一 client 边界：顶部 Case Context；桌面左主（角色看板/事项工作区）右辅（Case Chat）；
// Mobile 重排为「看板 / 事项 / 协同」三入口。canonical state 只来自服务端 Projection。

import React from 'react';

import { BusinessPanel } from './business/BusinessPanel';
import { DomainNetwork } from './domains/DomainNetwork';
import { DomainWorkbench } from './domains/DomainWorkbench';
import { InspectionRail } from './inspection/InspectionRail';
import {
  ConnectionDot,
  ErrorBlock,
  FeedbackBanner,
  LoadingBlock,
  StaleBanner,
} from './inspection/StatusPrimitives';
import {
  VerificationPanel,
  verificationSessionStorage,
  type VerificationCommand,
} from './VerificationPanel';
import { createVerificationPendingStore } from './verification-pending-store';
import {
  createWorkspaceClient,
  useCaseProjection,
  useWorkspaceActions,
} from './workspace-model';
import {
  WORK_ACTOR_ORDER,
  type V4LifeDomain,
  type WorkActorId,
} from './workspace-contract';
import { CaseChat } from './CaseChat';
import styles from './work-shell.module.css';

const FALLBACK_ACTOR_NAMES: Record<WorkActorId, string> = {
  'actor-business-chen': '陈经理（业务）',
  'actor-policy-li': '李审（政策）',
  'actor-credit-zhang': '张审（信审）',
  'actor-commerce-wang': '王经理（商务）',
  'actor-asset-zhou': '周工（资产）',
};

type MobileTab = 'board' | 'items' | 'collab';

function actorName(projection: ReturnType<typeof useCaseProjection>['projection'], actorId: WorkActorId): string {
  const actor = projection?.actors.find((entry) => entry.actorId === actorId);
  return actor?.displayName ?? FALLBACK_ACTOR_NAMES[actorId];
}

export function WorkShell({ caseId }: { caseId: string }) {
  const [selectedActorId, setSelectedActorId] = React.useState<WorkActorId>('actor-business-chen');
  const [selectedDomain, setSelectedDomain] = React.useState<V4LifeDomain>('policy');
  const [mobileTab, setMobileTab] = React.useState<MobileTab>('board');
  const [resetArmed, setResetArmed] = React.useState(false);
  // 材料核验未决命令：单一共享状态（上提至此），desktop/mobile 两实例受控同步，入口切换不可绕过。
  const [verificationPendingCommand, setVerificationPendingCommand] =
    React.useState<VerificationCommand | null>(null);
  // R1：hydrate 落定标志与存储错误（失败关闭）——owner 层持有，恰一次恢复。
  const [verificationHydrated, setVerificationHydrated] = React.useState(false);
  const [verificationStorageError, setVerificationStorageError] = React.useState<string | null>(
    null,
  );
  // R1：单一共享 in-flight 锁（owner 持有），两实例共用；发送中一端阻塞两端提交/重试。
  const [verificationInFlight, setVerificationInFlight] = React.useState(false);

  // R1：owner 恢复未决命令恰一次（client effect 内经 microtask 订阅外部存储；
  // SSR 渲染路径零 window 访问）。只建立未决态、不自动发送；
  // empty 之外的恢复失败一律显式存储错误并禁用新提交。
  React.useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) {
        return;
      }
      const store = createVerificationPendingStore(verificationSessionStorage());
      const result = store.load();
      if (result.ok) {
        setVerificationPendingCommand(result.command);
      } else if (result.reason !== 'empty') {
        setVerificationStorageError(result.reason);
      }
      setVerificationHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { projection, connection, error, refresh } = useCaseProjection(caseId);
  const actions = useWorkspaceActions(caseId, {
    actorId: selectedActorId,
    refresh,
  });

  const client = React.useMemo(() => createWorkspaceClient(caseId), [caseId]);
  const loadEvents = React.useCallback(
    (afterSeq: number, limit: number) => client.fetchEvents(afterSeq, limit),
    [client],
  );

  const isBusiness = selectedActorId === 'actor-business-chen';

  // R1：存在以下任一情形禁止演示 reset（未决命令可能尚藏在存储里，恢复未完成或存储
  // 错误时同样不放行），避免清掉服务端 journal 后放行旧命令重试；禁用即保护，未决
  // 记录不因 reset 静默丢失。
  const resetBlocked =
    verificationPendingCommand !== null ||
    verificationInFlight ||
    !verificationHydrated ||
    verificationStorageError !== null;

  function handleReset(): void {
    if (resetBlocked) {
      return;
    }
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    setResetArmed(false);
    void actions.resetDemo();
  }

  const contextBar = (
    <header className={styles.contextBar}>
      <div className={styles.contextRow}>
        <span className={styles.demoBadge}>合成演示 · 非真实客户</span>
        <h1 className={styles.caseName}>
          {projection?.case.displayName ?? '小微四域协同工作台'}
        </h1>
        {projection !== null && (
          <span className={styles.caseMeta}>
            ¥{projection.case.financingAmountCny.toLocaleString('zh-CN')} · rev {projection.rev} ·
            事件 {projection.eventCount} · 材料 {projection.evidenceCount}
          </span>
        )}
      </div>
      <div className={styles.contextActions}>
        <ConnectionDot connection={connection} />
        <button type="button" className={styles.ghostButton} onClick={() => void refresh()}>
          手动刷新
        </button>
        <button
          type="button"
          className={resetArmed ? styles.dangerArmed : styles.ghostButton}
          onClick={handleReset}
          onBlur={() => setResetArmed(false)}
          disabled={resetBlocked}
          title={resetBlocked ? '存在未决核验命令或发送中，暂不能重置' : undefined}
        >
          {resetBlocked
            ? '重置合成演示（存在未决核验）'
            : resetArmed
              ? '确认重置合成演示？'
              : '重置合成演示'}
        </button>
      </div>
      <p className={styles.upstreamNote}>
        {projection?.case.upstreamNote ?? '业务已按现行制度完成受理与必要尽调核验。'}
        {'　'}
        {projection?.case.disclaimer}
      </p>
    </header>
  );

  if (projection === null) {
    if (connection === 'error') {
      return (
        <div className={styles.shell}>
          {contextBar}
          <ErrorBlock
            code={error?.code ?? 'UNKNOWN'}
            message={error?.code === 'CASE_NOT_FOUND' ? `未找到演示 Case：${caseId}` : undefined}
            onRetry={() => void refresh()}
          />
        </div>
      );
    }
    return (
      <div className={styles.shell}>
        {contextBar}
        <LoadingBlock label="正在读取 canonical Projection…" />
      </div>
    );
  }

  const workbenchProps = {
    projection,
    actorId: selectedActorId,
    actions,
    connection,
    feedback: actions.feedback,
  };

  const actorSwitcher = (
    <nav className={styles.actorSwitcher} aria-label="演示身份切换">
      {WORK_ACTOR_ORDER.map((id) => (
        <button
          key={id}
          type="button"
          className={id === selectedActorId ? styles.actorChipActive : styles.actorChip}
          aria-pressed={id === selectedActorId}
          onClick={() => setSelectedActorId(id)}
        >
          {actorName(projection, id)}
        </button>
      ))}
      <span className={styles.switchHint}>demo role switch · 不代表生产认证</span>
    </nav>
  );

  const network = (
    <DomainNetwork
      {...workbenchProps}
      selectedDomain={selectedDomain}
      onDomainSelect={(domain) => {
        setSelectedDomain(domain);
        setMobileTab('items');
      }}
    />
  );

  const workArea = isBusiness ? (
    <BusinessPanel {...workbenchProps} />
  ) : (
    <DomainWorkbench
      {...workbenchProps}
      selectedDomain={selectedDomain}
      onDomainSelect={setSelectedDomain}
    />
  );

  const inspection = <InspectionRail {...workbenchProps} loadEvents={loadEvents} />;
  const chat = <CaseChat projection={projection} actorId={selectedActorId} />;

  // 窄「材料核验」区域：desktop 事项区尾部与 mobile「事项」入口共用同一节点；
  // 未决命令状态上提至此（单一 useState），两个挂载实例共享，viewport/入口切换不可绕过。
  const verification = (
    <VerificationPanel
      caseId={caseId}
      actorId={selectedActorId}
      projection={projection}
      onRefresh={() => void refresh()}
      pendingCommand={verificationPendingCommand}
      onPendingCommandChange={setVerificationPendingCommand}
      hydrated={verificationHydrated}
      storageError={verificationStorageError}
      onStorageErrorChange={setVerificationStorageError}
      inFlight={verificationInFlight}
      onInFlightChange={setVerificationInFlight}
    />
  );

  return (
    <div className={styles.shell} data-actor={selectedActorId}>
      {contextBar}
      {connection === 'stale' && <StaleBanner onRefresh={() => void refresh()} />}
      {actorSwitcher}
      <FeedbackBanner feedback={actions.feedback} />

      {/* 桌面：左主（看板+事项+检查轨）右辅（Case Chat） */}
      <div className={styles.desktopGrid}>
        <main className={styles.mainCol}>
          {network}
          {workArea}
          {verification}
          {inspection}
        </main>
        <aside className={styles.chatCol} aria-label="Case 协同">
          {chat}
        </aside>
      </div>

      {/* 移动：看板 / 事项 / 协同 三入口（桌面隐藏） */}
      <nav className={styles.mobileTabs} aria-label="移动端入口">
        {(
          [
            ['board', '看板'],
            ['items', '事项'],
            ['collab', '协同'],
          ] as const
        ).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            className={mobileTab === tab ? styles.mobileTabActive : styles.mobileTab}
            aria-current={mobileTab === tab ? 'page' : undefined}
            onClick={() => setMobileTab(tab)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className={styles.mobilePane} hidden={mobileTab !== 'board'}>
        {network}
      </div>
      <div className={styles.mobilePane} hidden={mobileTab !== 'items'}>
        {workArea}
        {verification}
      </div>
      <div className={styles.mobilePane} hidden={mobileTab !== 'collab'}>
        {chat}
        {inspection}
      </div>
    </div>
  );
}
