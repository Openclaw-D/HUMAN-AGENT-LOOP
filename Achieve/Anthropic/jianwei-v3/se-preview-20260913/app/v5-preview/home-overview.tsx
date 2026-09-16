// B 候选 · 首页组合根（HomeOverview）：页头（菜单/重开）→ 生命周期五阶段 → 四域矩阵 →
// 固定演示条 → 当前待办 → 项目沟通。数据与全部写通道由 A 的页面层传入（props 契约见
// home-contract.ts）；组件内无 API 调用、无第二事实源。
// REPAIR evening（A 兼容集成）：StoryStrip 增加共享尽调事实条（shared prop）。
// 布局（R-01/R-08）：取消旧版上下两块 calc((100dvh-22px)/2) 硬半屏——顶部内容自适应高度，
// 沟通区占剩余空间（min-height 保底、内部滚动），内容超出时整页可滚（合理聊天留白不算断层）。
// 桌面 ≥1024px 为非对称两栏（11fr/9fr，非 50/50）；无任何固定画布 transform 缩放。
import { useCallback, useState } from 'react';
import { HomeHeader, readCellTextPref } from './home-header';
import { LifecycleStrip } from './lifecycle-strip';
import { DomainGrid } from './domain-grid';
import { StoryStrip } from './story-strip';
import { TodoRow } from './todo-row';
import { HomeChat } from './home-chat';
import type { HomeOverviewProps } from './home-contract';
import styles from './home-overview.module.css';

export default function HomeOverview(props: HomeOverviewProps) {
  const {
    overview,
    story,
    shared,
    storyBusy,
    storyError,
    storyNotice,
    onAdvance,
    onDecide,
    onRestart,
    restarting,
    onSubmitNote,
    pendingNote,
    onResolvePendingNote,
    onDismissPendingNote,
    resolvingPendingNote,
    onSendMessage,
    pendingMessage,
    onResolvePendingMessage,
    onDismissPendingMessage,
    resolvingPendingMessage,
    recoveryPersistFailed,
    banners,
    remoteHref,
    messageExtras,
  } = props;

  // 显示偏好：四域格子文字开关（localStorage 持久化；读取失败缺省开）。
  const [showCellText, setShowCellText] = useState(readCellTextPref);
  const toggleCellText = useCallback((next: boolean) => {
    setShowCellText(next);
    try { window.localStorage.setItem('jw:home:cell-text', next ? '1' : '0'); } catch { /* 忽略 */ }
  }, []);

  const storyStep = story !== null && story.mode === 'story' ? story.step : null;
  const storySettled = storyStep !== null && storyStep.stepIndex >= storyStep.stepsTotal - 1;
  const storyStage = storyStep !== null ? { stageIndex: storyStep.stageIndex, settled: storySettled } : null;
  const storyStageLabel =
    storyStep !== null
      ? `第 ${storyStep.stepIndex + 1}/${storyStep.stepsTotal} 步 · ${storyStep.stageLabel}`
      : overview.scenarioLabel;

  return (
    <div className={styles.root}>
      {banners.map((b) => (
        <p key={b.id} className={styles.banner} data-kind={b.kind} role={b.kind === 'soft' ? 'status' : 'alert'}>
          {b.text}
        </p>
      ))}

      <div className={styles.topArea}>
        <section className={styles.panel} aria-label="项目总览（合成演示）">
          <HomeHeader
            overview={overview}
            storyStageLabel={storyStageLabel}
            showCellText={showCellText}
            onToggleCellText={toggleCellText}
            restarting={restarting}
            onRestart={onRestart}
          />
          <div className={styles.band} aria-hidden="true" />
          <LifecycleStrip overview={overview} storyStage={storyStage} />
          <div className={styles.band} aria-hidden="true" />
          <DomainGrid domains={overview.domains} relatedTodo={overview.todo} showCellText={showCellText} />
          <div className={styles.band} aria-hidden="true" />
          <StoryStrip
            state={story}
            shared={shared}
            busy={storyBusy}
            error={storyError}
            notice={storyNotice}
            restarting={restarting}
            onAdvance={onAdvance}
            onDecide={onDecide}
            onRestartFree={onRestart}
          />
          <TodoRow
            todo={overview.todo}
            onSubmitNote={onSubmitNote}
            pendingNote={pendingNote}
            onResolvePendingNote={onResolvePendingNote}
            onDismissPendingNote={onDismissPendingNote}
            resolvingPending={resolvingPendingNote}
            recoveryPersistFailed={recoveryPersistFailed}
          />
        </section>
      </div>

      <div className={styles.chatArea}>
        <HomeChat
          messages={overview.messages}
          messageExtras={messageExtras}
          onSendMessage={onSendMessage}
          pendingMessage={pendingMessage}
          onResolvePendingMessage={onResolvePendingMessage}
          onDismissPendingMessage={onDismissPendingMessage}
          resolvingPending={resolvingPendingMessage}
          recoveryPersistFailed={recoveryPersistFailed}
          remoteHref={remoteHref}
        />
      </div>
    </div>
  );
}
