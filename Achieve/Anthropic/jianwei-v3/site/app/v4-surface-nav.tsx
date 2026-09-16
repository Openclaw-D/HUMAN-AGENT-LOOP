import Link from 'next/link';
import styles from './v4-surface-nav.module.css';

export type V4SurfaceId = 'manage' | 'work';

const SURFACES: ReadonlyArray<{
  id: V4SurfaceId;
  href: string;
  label: string;
  englishLabel: string;
}> = [
  { id: 'work', href: '/work', label: '作业执行', englishLabel: 'Work Execution' },
  { id: 'manage', href: '/', label: '管理与治理', englishLabel: 'Management & Governance' },
];

export function V4SurfaceNav({ active }: { active: V4SurfaceId }) {
  return (
    <nav className={styles.nav} aria-label="两个应用">
      <Link className={styles.brand} href="/" aria-label="见微首页">见微</Link>
      <div className={styles.links}>
        {SURFACES.map((surface) => (
          <Link
            key={surface.id}
            href={surface.href}
            aria-current={surface.id === active ? 'page' : undefined}
            className={surface.id === active ? styles.active : undefined}
          >
            <span>{surface.label}</span>
            <small>{surface.englishLabel}</small>
          </Link>
        ))}
      </div>
    </nav>
  );
}
