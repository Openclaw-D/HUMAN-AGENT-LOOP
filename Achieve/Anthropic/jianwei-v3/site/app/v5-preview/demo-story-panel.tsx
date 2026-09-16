"use client";

// V6 NIGHT_SIMPLIFY · 固定演示条（A）。置于总览面板内、待办卡上方：
// 一行演示进度 + 主操作（推进/人工决定三选一）+ 重新开始；free 模式 = 诚实说明 + 回到固定演示。
// 状态来源：GET /api/v5-preview/demo/story（稳定步游标定位）；写操作经 page 层（requestId 幂等 +
// expectedVersion + fromStepId 步骤门）。纯展示组件：无自持业务状态，无轮询。
// REPAIR evening：新增共享尽调事实条（同一演示项目/会话的证据版本与待复核投影，来源
// GET /api/v5-preview/demo/shared-state）与同步降级诚实提示。
// 固定演示=演示控制·非业务操作；绿色/推进仅代表演示步骤完成，不构成正式审批语义。

import type { ReactNode } from 'react';
import type { SharedFactsView } from './api-client';
import styles from './se-overview.module.css';

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

export interface DemoStoryStepView {
  stepId: string;
  stepIndex: number;
  stepsTotal: number;
  stageIndex: number;
  stageLabel: string;
  title: string;
  hint: string | null;
  evidenceRefs: readonly string[];
  decision: {
    prompt: string;
    options: readonly { kind: 'confirm' | 'correct' | 'return'; label: string }[];
  } | null;
}

export interface DemoStoryStateView {
  mode: 'story' | 'free';
  version: number;
  step: DemoStoryStepView | null;
  freeNotice: string | null;
  /** REPAIR evening：共享尽调事实同步降级说明（可选，向后兼容旧响应）。 */
  sharedWarning?: string | null;
}

/** 共享尽调事实条（紧凑单行；数据全部来自服务端投影，不在 CSS 里伪装来源）。 */
function SharedFactsLine({ shared }: { shared: SharedFactsView | null }) {
  if (shared === null) return null;
  if (shared.sharedWarning !== undefined) {
    return <p className={styles.storyNotice} role="status">{shared.sharedWarning}</p>;
  }
  if (shared.facts.length === 0) return null;
  const chips = shared.facts.map((f) => (
    <span key={f.evidenceId}>
      {FIXTURE_LABEL[f.fixtureId] ?? f.fixtureId} 第{f.chainVersion}次 · {FACT_STATUS_LABEL[f.status] ?? f.status}
    </span>
  ));
  const chipNodes: ReactNode[] = chips.reduce<ReactNode[]>((acc, chip, i) => (i === 0 ? [chip] : [...acc, '；', chip]), []);
  return (
    <p className={styles.storyHint}>
      共享尽调（会话 {shared.demoSessionId ?? '—'}）：{chipNodes}
      {shared.pendingReview.length > 0 ? `；旧结论待复核 ${shared.pendingReview.length} 项（人工复核后闭合）` : ''}
    </p>
  );
}

export default function DemoStoryPanel({
  state,
  busy,
  error,
  notice,
  restarting,
  shared,
  onAdvance,
  onDecide,
  onRestart,
}: {
  state: DemoStoryStateView | null;
  busy: boolean;
  error: string | null;
  /** 人工决定结果提示（确认/纠正/退回各有明确不同的表述；推进时清除）。 */
  notice: string | null;
  restarting: boolean;
  /** REPAIR evening：共享尽调事实（同一演示项目/专属会话的真实证据版本与待复核投影）。 */
  shared: SharedFactsView | null;
  onAdvance: (fromStepId: string) => void;
  onDecide: (fromStepId: string, kind: 'confirm' | 'correct' | 'return') => void;
  onRestart: () => void;
}) {
  if (state === null) return null; // story 状态未加载完成：不占位（页面其余功能照常）。

  if (state.mode === 'free') {
    return (
      <section className={styles.storyStrip} data-mode="free" aria-label="固定演示（未在固定路线）">
        <div className={styles.storyRow}>
          <span className={styles.storyChip} data-mode="free">固定演示</span>
          <span className={styles.storyTitle}>{state.freeNotice ?? '当前状态不在固定演示路线上。'}</span>
          <button type="button" className={styles.storyBtn} disabled={busy || restarting} onClick={onRestart}>
            重新开始固定演示
          </button>
        </div>
        {error !== null ? <p className={styles.storyError} role="alert">{error}</p> : null}
        <SharedFactsLine shared={shared} />
        {state.sharedWarning !== null && state.sharedWarning !== undefined ? (
          <p className={styles.storyNotice} role="status">{state.sharedWarning}</p>
        ) : null}
      </section>
    );
  }

  const step = state.step;
  if (step === null) return null;
  const isTerminal = step.stepIndex >= step.stepsTotal - 1;
  const awaiting = step.decision !== null;

  return (
    <section className={styles.storyStrip} data-mode="story" data-decision={awaiting ? 'yes' : 'no'} aria-label="固定演示主线">
      <div className={styles.storyRow}>
        <span className={styles.storyChip}>固定演示</span>
        <span className={styles.storyMeta}>
          第 {step.stepIndex + 1}/{step.stepsTotal} 步 · {step.stageLabel}
        </span>
        <span className={styles.storyTitle}>{step.title}</span>
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
        <button type="button" className={styles.storyRestart} disabled={busy || restarting} onClick={onRestart}>
          重新开始
        </button>
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
