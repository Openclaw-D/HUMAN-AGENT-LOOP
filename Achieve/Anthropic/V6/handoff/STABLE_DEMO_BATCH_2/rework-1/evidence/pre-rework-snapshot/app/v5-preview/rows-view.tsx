// V5 ROWS · 主视图：顶部客户/项目/演示标注 + 项目进展（灰度示意条+文字，无数字）
// + 四条宽横条域卡 + 最重要待办 + 项目沟通 + 合成数据页脚。
// 桌面（≥900px）仅加宽容器，仍为纵向横条；不做四列/拼图/详情页。
import type { ReactNode } from 'react';
import type { ProjectOverview } from '../../lib/v5-preview/shared-types';
import DomainRow from './domain-row';
import { formatMessageTime, projectLine, scenarioProgressWidth } from './rows-logic';
import styles from './preview.module.css';

export default function RowsView({ overview, children }: { overview: ProjectOverview; children?: ReactNode }) {
  const fillPct = scenarioProgressWidth(overview.scenario);
  return (
    <main className={styles.rowsMain}>
      <header className={styles.projHead}>
        <p className={styles.pageKicker}>项目总览 · {overview.scenarioLabel}</p>
        <h1 className={styles.customer}>{overview.customerName}</h1>
        <p className={styles.projLine}>{projectLine(overview.projectName, overview.projectCode)}</p>
        <p className={styles.demoMark}>演示项目</p>
      </header>

      {/* CP3：手机端总体说明收纳进进展行 aria（视觉隐藏）；桌面正常显示。 */}
      <section
        className={styles.progressRow}
        aria-label={`项目进展：${overview.overall.progressLabel}（演示示意·非计算）。${overview.overall.description}`}
      >
        <span className={styles.progressTitle}>项目进展</span>
        <span className={styles.track} aria-hidden="true">
          <span className={styles.trackFill} style={{ width: `${fillPct}%` }} />
        </span>
        <span className={styles.progressLabel}>{overview.overall.progressLabel}</span>
        <span className={styles.progressHint}>演示示意·非计算</span>
      </section>
      <p className={styles.overallDesc}>{overview.overall.description}</p>

      <section className={styles.domainList} aria-label="四域总览（政策/信审/商务/资产，合成演示）">
        {overview.domains.map((d) => (
          <DomainRow key={d.domainId} domain={d} />
        ))}
      </section>

      {children}

      <footer className={styles.foot}>
        <span className={styles.footBadge}>合成数据 · 交互预览</span>
        <span className={styles.footMeta}>版本 v{overview.version} · 更新于 {formatMessageTime(overview.updatedAt)}</span>
      </footer>
    </main>
  );
}
