// B 候选 · 页头（R1 修正）：仅一行标题，左右两端分布——左=项目名（新客回租），
// 右=项目编号（JW-2026-018）。R1 删除项：合成演示徽章、菜单按钮、重开图标/确认弹层，
// 不以同类控件替代；来源标注保留在消息徽章（人工/模型（演示）/预设），不假称真实模型。
// projectLine 旧逻辑不再适用：编号必须独立显示在右端——项目名内含编号时剥去后缀，
// 避免左右重复；编号为空时右侧不占位。375 宽下两侧各自完整可读，不被控件挤压。
import type { ProjectOverview } from '../../lib/v5-preview/shared-types';
import styles from './home-overview.module.css';

/** 拆分标题：左=项目名（剥去内嵌编号后缀），右=编号。 */
export function splitTitle(projectName: string, projectCode: string): { name: string; code: string } {
  if (projectCode !== '' && projectName.includes(projectCode)) {
    const stripped = projectName.replace(projectCode, '').replace(/[·\s]+$/, '').trimEnd();
    return { name: stripped === '' ? projectName : stripped, code: projectCode };
  }
  return { name: projectName, code: projectCode };
}

export function HomeHeader({ overview }: { overview: ProjectOverview }) {
  const { name, code } = splitTitle(overview.projectName, overview.projectCode);
  return (
    <header className={styles.header}>
      <h1 className={styles.headerTitle} title={name}>{name}</h1>
      {code !== '' ? (
        <span className={styles.headerCode} title={code}>{code}</span>
      ) : null}
    </header>
  );
}
