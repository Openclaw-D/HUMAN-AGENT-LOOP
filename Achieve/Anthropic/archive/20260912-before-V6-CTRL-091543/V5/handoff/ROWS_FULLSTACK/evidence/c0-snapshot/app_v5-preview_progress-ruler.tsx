"use client";

// V5 PREVIEW · 项目进度四刻度（合成演示）。
// 四刻度是项目里程碑标记（25/50/75/100%），不是四域各 25%；
// 进度算法未定义，位置与推进均为演示口径，100% 不等于风险消失或全生命周期结束。
import styles from './preview.module.css';

const TICKS = [25, 50, 75, 100];

export default function ProgressRuler({ percent, note }: { percent: number; note: string }) {
  return (
    <div className={styles.progressWrap}>
      <div
        className={styles.progressTrack}
        role="img"
        aria-label={`项目演示进度 ${percent}%（口径仅为演示）`}
      >
        <div className={styles.progressFill} style={{ width: `${percent}%` }} />
        {TICKS.map((t) => (
          <span key={t} className={styles.progressTick} style={{ left: `${t}%` }}>
            <i className={styles.progressTickLine} />
            <b className={styles.progressTickLabel}>{t}%</b>
          </span>
        ))}
        <span className={styles.progressMarker} style={{ left: `${percent}%` }} />
      </div>
      <p className={styles.progressNote}>{note}</p>
    </div>
  );
}
