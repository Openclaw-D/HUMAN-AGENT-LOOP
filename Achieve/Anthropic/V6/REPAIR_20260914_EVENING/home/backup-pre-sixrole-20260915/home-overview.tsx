// B 候选 · 首页组合根（HomeOverview）。
// R1 布局（替代旧自适应高度/宽屏两栏方案）：根布局固定可用视口上下各 50%（flex 等分，
// 扣除根 padding 与间隔后各半，无拖拽/resize 分隔——候选从未有过拖拽逻辑）。
// 上半 = 标题 + 生命周期五阶段 + 完整四域矩阵（行高/padding/gap 按可用高度收紧，内部可滚兜底，
// 不把下半挤走）；下半 = 项目沟通 / 当前待办 两页签（底部两个中文选项切换，只切内容、无分割拖动），
// 固定演示推进/人工决定紧凑放入"当前待办"页签。聊天历史内部滚动，无整页长滚动。
// 页头三控件（合成演示徽章/菜单/重开）已按 R1 删除且无替代；来源标注保留在消息徽章。
// 数据与全部写通道由 A 的页面层传入（props 契约见 home-contract.ts）；组件内无 API 调用。
import { useState } from 'react';
import { HomeHeader } from './home-header';
import { LifecycleStrip } from './lifecycle-strip';
import { DomainGrid } from './domain-grid';
import { StoryStrip } from './story-strip';
import { TodoRow } from './todo-row';
import { HomeChat } from './home-chat';
import type { HomeOverviewProps } from './home-contract';
import styles from './home-overview.module.css';

type BottomTab = 'chat' | 'todo';

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

  // 下半页签：项目沟通 / 当前待办（底部两个中文选项；只切内容，无分割拖动）。
  const [tab, setTab] = useState<BottomTab>('chat');

  const storyStep = story !== null && story.mode === 'story' ? story.step : null;
  const storySettled = storyStep !== null && storyStep.stepIndex >= storyStep.stepsTotal - 1;
  const storyStage = storyStep !== null ? { stageIndex: storyStep.stageIndex, settled: storySettled } : null;

  return (
    <div className={styles.root}>
      {banners.map((b) => (
        <p key={b.id} className={styles.banner} data-kind={b.kind} role={b.kind === 'soft' ? 'status' : 'alert'}>
          {b.text}
        </p>
      ))}

      {/* 上半 50%：标题 + 生命周期 + 完整四域矩阵。 */}
      <section className={styles.topArea} aria-label="项目总览（合成演示）">
        <HomeHeader overview={overview} />
        <div className={styles.band} aria-hidden="true" />
        <LifecycleStrip overview={overview} storyStage={storyStage} />
        <div className={styles.band} aria-hidden="true" />
        <DomainGrid domains={overview.domains} relatedTodo={overview.todo} />
      </section>

      {/* 下半 50%：沟通 / 待办页签内容 + 底部页签栏。 */}
      <section className={styles.bottomArea} aria-label="沟通与待办">
        <div className={styles.tabPanel}>
          {tab === 'chat' ? (
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
          ) : (
            <div className={styles.todoPane} aria-label="当前待办与固定演示">
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
            </div>
          )}
        </div>
        <div className={styles.tabBar} role="tablist" aria-label="下半内容切换">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'chat'}
            className={styles.tabBtn}
            data-active={tab === 'chat' ? 'true' : 'false'}
            onClick={() => setTab('chat')}
          >
            项目沟通
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'todo'}
            className={styles.tabBtn}
            data-active={tab === 'todo' ? 'true' : 'false'}
            onClick={() => setTab('todo')}
          >
            当前待办
          </button>
        </div>
      </section>
    </div>
  );
}
