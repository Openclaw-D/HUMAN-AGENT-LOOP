import styles from './surface-shell.module.css';

type QuadrantProgressProps = {
  label: string;
  level: 0 | 1 | 2 | 3 | 4 | null;
};

export function QuadrantProgress({ label, level }: QuadrantProgressProps) {
  const stateLabel = level === null ? '未提供' : level === 0 ? '尚未推进' : `第 ${level} 档`;
  return (
    <span className={styles.professionalProgress} aria-label={`${label}进度：${stateLabel}`}>
      <span className={styles.progressDisc} data-level={level ?? 'missing'} aria-hidden="true">
        {[1, 2, 3, 4].map((quadrant) => (
          <i key={quadrant} data-filled={level !== null && level >= quadrant} />
        ))}
      </span>
      <span><b>{label}</b><small>{stateLabel}</small></span>
    </span>
  );
}
