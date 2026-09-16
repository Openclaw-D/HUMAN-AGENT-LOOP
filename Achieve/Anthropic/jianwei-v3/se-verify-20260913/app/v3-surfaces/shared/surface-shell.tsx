'use client';

import type { ReactNode } from 'react';

import { JwIcon, VinextSafeAnchor } from '../../jw-front';
import { QuadrantProgress } from './quadrant-progress';
import {
  PROFESSIONAL_QUADRANTS,
  type SurfaceMode,
  type V3QuarterProgress,
  type V3SurfaceEntryId,
  type V3SurfaceFamily,
  type V3SurfaceRoleOption,
} from './surface-model';
import styles from './surface-shell.module.css';

export type V3SurfaceEntryTab = {
  entryId: V3SurfaceEntryId;
  label: string;
  icon: string;
};

export type V3SurfaceRoleControl = {
  principalId: string;
  label: string;
  options: readonly V3SurfaceRoleOption[];
  busy?: boolean;
  onChange: (principalId: string) => void;
};

export type V3SharedSurfaceShellProps = {
  entryId: V3SurfaceEntryId;
  family: V3SurfaceFamily;
  pageTitle: string;
  currentObjective: string;
  defaultMode: SurfaceMode;
  quarterProgress: V3QuarterProgress;
  context: { label: string; value: string };
  role: V3SurfaceRoleControl;
  entryTabs?: readonly V3SurfaceEntryTab[];
  boundaryNote: string;
  onEntryChange?: (entryId: V3SurfaceEntryId) => void;
  onModeChange: (mode: SurfaceMode) => void;
  mainContent: ReactNode;
  chat: ReactNode;
};

const MODES = [
  { id: 'relationship', label: '关系', icon: 'route' },
  { id: 'path', label: '路径', icon: 'schedule' },
  { id: 'matrix', label: '矩阵', icon: 'strategy' },
] as const;

export function SharedSurfaceShell(props: V3SharedSurfaceShellProps) {
  return (
    <main className={styles.page} data-surface-entry={props.entryId} data-surface-family={props.family}>
      <header className={styles.shellHeader} data-testid="shared-shell-header">
        <div className={styles.primaryRow}>
          <VinextSafeAnchor href="/" className={styles.brand} aria-label="返回见微总入口">见微</VinextSafeAnchor>
          {props.entryTabs?.length ? <div className={styles.surfaceSwitch} aria-label="同页一级视图">
            {props.entryTabs.map((entry) => (
              <button
                key={entry.entryId}
                type="button"
                className={props.entryId === entry.entryId ? styles.activeSection : undefined}
                aria-pressed={props.entryId === entry.entryId}
                onClick={() => props.onEntryChange?.(entry.entryId)}
              >
                <JwIcon name={entry.icon} size={15} />
                {entry.label}
              </button>
            ))}
          </div> : null}
          <div className={styles.currentPage}>
            <span>CURRENT VIEW</span>
            <strong>{props.pageTitle}</strong>
          </div>
          <div className={styles.objective} title={props.currentObjective}>
            <span>当前目标</span>
            <strong>{props.currentObjective}</strong>
          </div>
          <label className={styles.rolePicker}>
            <span>{props.role.label}</span>
            <select
              value={props.role.principalId}
              disabled={props.role.busy}
              onChange={(event) => props.role.onChange(event.target.value)}
            >
              {props.role.options.map((role) => (
                <option key={role.principalId} value={role.principalId}>{role.label} · {role.application}</option>
              ))}
            </select>
          </label>
          <div className={styles.contextBadge}><span>{props.context.label}</span><strong>{props.context.value}</strong></div>
        </div>

        <div className={styles.secondaryRow}>
          <nav className={styles.modeSwitch} aria-label="主视图模式">
            {MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={props.defaultMode === mode.id ? styles.activeMode : undefined}
                aria-pressed={props.defaultMode === mode.id}
                onClick={() => props.onModeChange(mode.id)}
              >
                <JwIcon name={mode.icon} size={14} />{mode.label}
              </button>
            ))}
          </nav>
          <p className={styles.authorityBoundary}>
            <JwIcon name="permission" size={13} />{props.boundaryNote}
          </p>
          <div className={styles.professionalCompass} aria-label="四专业阈值进度，资产左上、政策右上、商务左下、信审右下">
            {PROFESSIONAL_QUADRANTS.map((item) => (
              <span key={item.processId} data-area={item.area}>
                <QuadrantProgress label={item.label} level={props.quarterProgress[item.processId]} />
              </span>
            ))}
          </div>
        </div>
      </header>

      <div className={styles.workArea} data-testid="shared-shell-workarea">
        <section className={styles.mainViewport}>{props.mainContent}</section>
        <aside className={styles.chatViewport}>{props.chat}</aside>
      </div>
    </main>
  );
}
