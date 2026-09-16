// B 候选 · 页头（R-01）：单行紧凑抬头 = 项目名（左）+ 轻量演示标识 + 项目菜单 + 重开图标（右）。
// 移除项（用户批注）：原客户信息整行（客户名收进菜单"项目详情"）、原"合成演示·控制"下拉
//（情景切换等合成控制不再占用页头；固定演示重开经右上图标+轻量确认）。
// 菜单只含实际可用项：项目详情（真实 overview 字段）+ 显示偏好（格子文字开关，localStorage
// 持久化）；不做无功能的假菜单项。菜单面板限高且锚定顶部，不遮挡底部输入框。
import { useEffect, useRef, useState } from 'react';
import type { ProjectOverview } from '../../lib/v5-preview/shared-types';
import { formatMessageTime, projectLine } from './rows-logic';
import { MenuIcon, RestartIcon } from './home-icons';
import styles from './home-overview.module.css';

export const CELL_TEXT_PREF_KEY = 'jw:home:cell-text';

export function readCellTextPref(): boolean {
  try {
    const stored = window.localStorage.getItem(CELL_TEXT_PREF_KEY);
    return stored === null ? true : stored === '1'; // 缺省显示文字（无障碍友好）。
  } catch {
    return true;
  }
}

export function HomeHeader({
  overview,
  storyStageLabel,
  showCellText,
  onToggleCellText,
  restarting,
  onRestart,
}: {
  overview: ProjectOverview;
  /** 当前阶段名（来自固定演示条/情景推导，菜单内展示）。 */
  storyStageLabel: string;
  showCellText: boolean;
  onToggleCellText: (next: boolean) => void;
  restarting: boolean;
  onRestart: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // 菜单：外点关闭 + Esc 关闭（轻量、无遮罩层）。
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current !== null && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className={styles.header}>
      <h1 className={styles.headerTitle} title={projectLine(overview.projectName, overview.projectCode)}>
        {projectLine(overview.projectName, overview.projectCode)}
      </h1>
      <span className={styles.demoChip} title="合成演示数据，不执行正式审批">合成演示</span>
      <span className={styles.srOnly}>
        项目进展：{overview.overall.progressLabel}（演示示意·非计算）。{overview.overall.description}
      </span>

      <div className={styles.headerActions} ref={menuRef}>
        <button
          type="button"
          className={styles.menuBtn}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls="jw-home-menu"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <MenuIcon size={15} />
          <span className={styles.menuBtnText}>菜单</span>
        </button>
        <button
          type="button"
          className={styles.restartBtn}
          aria-haspopup="dialog"
          onClick={() => setConfirmOpen(true)}
          disabled={restarting}
          title="重新开始固定演示"
        >
          <RestartIcon size={15} />
          <span className={styles.srOnly}>重新开始固定演示（演示控制·非业务操作）</span>
        </button>

        {menuOpen ? (
          <div id="jw-home-menu" className={styles.menuPanel} role="menu" aria-label="项目菜单">
            <section className={styles.menuSection} aria-label="项目详情">
              <h2 className={styles.menuSectionTitle}>项目详情</h2>
              <dl className={styles.menuDetailList}>
                <div className={styles.menuDetailRow}>
                  <dt>客户</dt>
                  <dd>{overview.customerName}</dd>
                </div>
                <div className={styles.menuDetailRow}>
                  <dt>项目</dt>
                  <dd>{overview.projectName}</dd>
                </div>
                <div className={styles.menuDetailRow}>
                  <dt>编号</dt>
                  <dd>{overview.projectCode === '' ? '未编号' : overview.projectCode}</dd>
                </div>
                <div className={styles.menuDetailRow}>
                  <dt>当前情景</dt>
                  <dd>{overview.scenarioLabel}</dd>
                </div>
                <div className={styles.menuDetailRow}>
                  <dt>当前阶段</dt>
                  <dd>{storyStageLabel}</dd>
                </div>
                <div className={styles.menuDetailRow}>
                  <dt>总体状态</dt>
                  <dd>{overview.overall.progressLabel}</dd>
                </div>
              </dl>
              <p className={styles.menuNote}>{overview.overall.description}</p>
              <p className={styles.menuVersion}>
                版本 v{overview.version} · 更新于 {formatMessageTime(overview.updatedAt)}
              </p>
            </section>
            <section className={styles.menuSection} aria-label="显示偏好">
              <h2 className={styles.menuSectionTitle}>显示偏好</h2>
              <label className={styles.menuToggleRow}>
                <input
                  type="checkbox"
                  checked={showCellText}
                  onChange={(e) => onToggleCellText(e.target.checked)}
                />
                <span>四域格子内显示状态文字</span>
              </label>
              <p className={styles.menuNote}>关闭后格子仅显示状态图标；无障碍读法保持不变。</p>
            </section>
          </div>
        ) : null}
      </div>

      {confirmOpen ? (
        <div className={styles.confirmCard} role="alertdialog" aria-label="确认重新开始固定演示">
          <p className={styles.confirmTitle}>重新开始固定演示？</p>
          <p className={styles.confirmDetail}>
            作用域＝当前专属演示：固定演示进度与首页四域状态回到演示起点（此前演示记录不保留），当前专属演示会话及其证据/复核记录将被清除；其他尽调会话与其记录不受影响、不被重置（合成演示·非业务操作）。
          </p>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className={styles.btnSecondary}
              disabled={restarting}
              onClick={() => setConfirmOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={restarting}
              onClick={() => {
                setConfirmOpen(false);
                onRestart();
              }}
            >
              {restarting ? '重启中…' : '确认重开'}
            </button>
          </div>
        </div>
      ) : null}
    </header>
  );
}
