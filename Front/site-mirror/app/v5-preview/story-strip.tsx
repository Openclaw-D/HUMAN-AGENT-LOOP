// B 候选 · 固定演示条（承接 DemoStoryPanel 行为，重开入口移至页头图标）：
// 演示进度 + 主操作（推进 / 人工决定三选一）；free 模式 = 诚实说明 + 回到固定演示按钮。
// 纯展示组件：无自持业务状态；状态来源与写通道全部由 A 传入。固定演示=演示控制·非业务操作。
// R1：本组件紧凑放入下半"当前待办"页签；重开仍仅在 free 模式保留（页头重开已按批注删除）。
// REPAIR evening（A 兼容集成，同步自 site 集成版）：共享尽调事实条 shared prop + sharedWarning。
import type { ReactNode } from 'react';
import type { SharedFactsView, StoryStateView } from './api-client';
import styles from './home-overview.module.css';

// 共享尽调事实条（冻结映射的展示名，数据全部来自服务端投影）。
const FIXTURE_LABEL: Record<string, string> = {
  'fixture-inspection': '现场巡检',
  'fixture-equipment': '设备清单',
  'fixture-contract': '合同要素',
};

const FACT_STATUS_LABEL: Record<string, string> = {
  unverified: '待人工复核',
  human_verified: '人工已复核',
  contested: '纠正待复核',
};

function SharedFactsLine({ shared }: { shared: SharedFactsView | null }) {
  if (shared === null) return null;
  if (shared.sharedWarning !== undefined) {
    return <p className={styles.storyNotice} role="status">{shared.sharedWarning}</p>;
  }
  if (shared.facts.length === 0) return null;
  const chips: ReactNode[] = shared.facts.map((f, i) => (
    <span key={f.evidenceId}>
      {i > 0 ? '；' : ''}
      {FIXTURE_LABEL[f.fixtureId] ?? f.fixtureId} 第{f.chainVersion}次 · {FACT_STATUS_LABEL[f.status] ?? f.status}
    </span>
  ));
  return (
    <p className={styles.storyHint}>
      共享尽调（会话 {shared.demoSessionId ?? '—'}）：{chips}
      {shared.pendingReview.length > 0 ? `；旧结论待复核 ${shared.pendingReview.length} 项（人工复核后闭合）` : ''}
    </p>
  );
}

export function StoryStrip({
  state,
  shared,
  busy,
  error,
  notice,
  restarting,
  onAdvance,
  onDecide,
  onRestartFree,
}: {
  state: StoryStateView | null;
  shared: SharedFactsView | null;
  busy: boolean;
  error: string | null;
  notice: string | null;
  restarting: boolean;
  onAdvance: (fromStepId: string) => void;
  onDecide: (fromStepId: string, kind: 'confirm' | 'correct' | 'return') => void;
  /** free 模式下"回到固定演示"入口（A 的 restartStory）。 */
  onRestartFree: () => void;
}) {
  if (state === null) return null; // 未加载：不占位（页面其余功能照常）。

  if (state.mode === 'free') {
    return (
      <section className={styles.storyStrip} data-mode="free" aria-label="固定演示（未在固定路线）">
        <div className={styles.storyRow}>
          <span className={styles.storyChip} data-mode="free">固定演示</span>
          <span className={styles.storyTitle}>{state.freeNotice ?? '当前状态不在固定演示路线上。'}</span>
          <button type="button" className={styles.storyBtn} disabled={busy || restarting} onClick={onRestartFree}>
            回到固定演示
          </button>
        </div>
        <SharedFactsLine shared={shared} />
        {state.sharedWarning !== null && state.sharedWarning !== undefined ? (
          <p className={styles.storyNotice} role="status">{state.sharedWarning}</p>
        ) : null}
        {error !== null ? <p className={styles.storyError} role="alert">{error}</p> : null}
      </section>
    );
  }

  const step = state.step;
  if (step === null) return null;
  const isTerminal = step.stepIndex >= step.stepsTotal - 1;
  const awaiting = step.decision !== null;

  return (
    <section className={styles.storyStrip} data-mode="story" aria-label="固定演示主线">
      <div className={styles.storyRow}>
        <span className={styles.storyChip}>固定演示</span>
        <span className={styles.storyMeta}>
          第 {step.stepIndex + 1}/{step.stepsTotal} 步 · {step.stageLabel}
        </span>
        <span className={styles.storyTitle} title={step.title}>{step.title}</span>
        {awaiting ? (
          <span className={styles.storyWait}>等待人工决定</span>
        ) : (
          <button
            type="button"
            className={styles.storyBtn}
            disabled={busy || restarting}
            onClick={() => onAdvance(step.stepId)}
          >
            {busy ? '推进中…' : isTerminal ? '已完成' : '推进'}
          </button>
        )}
      </div>
      {awaiting && step.decision !== null ? (
        <div className={styles.storyDecide} role="group" aria-label="人工决定（演示）">
          <p className={styles.storyPrompt}>{step.decision.prompt}</p>
          <div className={styles.storyOptRow}>
            {step.decision.options.map((o) => (
              <button
                key={o.kind}
                type="button"
                className={styles.storyOpt}
                data-kind={o.kind}
                disabled={busy || restarting}
                onClick={() => onDecide(step.stepId, o.kind)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {step.hint !== null || step.evidenceRefs.length > 0 ? (
        <p className={styles.storyHint}>
          {step.hint}
          {step.hint !== null && step.evidenceRefs.length > 0 ? ' ' : ''}
          {step.evidenceRefs.join('；')}
        </p>
      ) : null}
      <SharedFactsLine shared={shared} />
      {notice !== null ? <p className={styles.storyNotice} role="status">{notice}</p> : null}
      {error !== null ? <p className={styles.storyError} role="alert">{error}</p> : null}
      {state.sharedWarning !== null && state.sharedWarning !== undefined ? (
        <p className={styles.storyNotice} role="status">{state.sharedWarning}</p>
      ) : null}
    </section>
  );
}
