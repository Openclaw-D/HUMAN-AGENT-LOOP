"use client";

// V5 PREVIEW · 横屏总览（F0-R1）：
// 顶部项目编号、进度四刻度、否决/通过位置（本轮禁用并说明）；
// 主体左侧约 75% 为政策/信审/商务/资产四列，每列四行 = 共用四阶段（与详情同一阶段对象派生）；
// 右侧约 25% 聊天及输入。格子点击携带域+阶段进入详情定位。
// compact 模式：手机四列候选布局（2026-09-07 决定的候选预览，未替代手机顺时针拼图）。
import styles from './preview.module.css';
import ProgressRuler from './progress-ruler';
import ChatPanel from './chat-panel';
import { DomainGlyph, miniStateClass, stateChipClass } from './overview-mobile';
import {
  FORMAL_NOTICE, LANDSCAPE_COLUMN_ORDER, WORK_STATE_LABELS,
  deriveDomainBlocker, deriveDomainStatus, deriveStageBlocks, usePreview,
  type DomainKey, type StageId,
} from './preview-state';

export default function OverviewLandscape({ onOpenDomain, onOpenBusiness, compact = false }: {
  onOpenDomain: (d: DomainKey, stage?: StageId) => void;
  onOpenBusiness: () => void;
  compact?: boolean;
}) {
  const { state, dispatch } = usePreview();

  return (
    <div className={`${styles.landOverview} ${compact ? styles.landCompact : ''}`}>
      <header className={styles.landHead}>
        <div className={styles.landHeadLeft}>
          <span className={styles.projectNo}>{state.projectNo}</span>
          <span className={styles.landCase}>新客回租 · 合成案例（演示）</span>
          <button type="button" className={styles.businessEntryInline} onClick={onOpenBusiness}>
            业务协调工作台 →
          </button>
        </div>
        <div className={styles.landHeadCenter}>
          <ProgressRuler percent={state.progressPercent} note={state.progressNote} />
        </div>
        <div className={styles.landHeadRight}>
          <button
            type="button"
            className={styles.formalBtn}
            disabled
            aria-label="否决（正式审批禁用）"
            title={FORMAL_NOTICE}
          >
            否决
          </button>
          <button
            type="button"
            className={styles.formalBtn}
            disabled
            aria-label="通过（正式审批禁用）"
            title={FORMAL_NOTICE}
          >
            通过
          </button>
          <details className={styles.formalExplain}>
            <summary>为何禁用？</summary>
            <p>{FORMAL_NOTICE}否决/通过保留草图位置，正式语义、作用对象与岗位权限未定义；本预览不产生 Decision/Receipt。</p>
          </details>
        </div>
      </header>

      {compact ? (
        <p className={styles.candidateNote}>
          候选布局预览：手机统一四列（2026-09-07 讨论方案），与横屏同一四列矩阵、同一状态对象；仅供与手机顺时针拼图比较，未替代原手机决定。
        </p>
      ) : null}

      <div className={styles.landBody}>
        <div className={styles.landMain}>
          {LANDSCAPE_COLUMN_ORDER.map((key) => {
            const d = state.domains[key];
            const status = deriveDomainStatus(d);
            return (
              <section key={key} className={`${styles.landCol} ${styles[`col-${key}`]}`} aria-label={`${d.name}列`}>
                <button type="button" className={styles.landColHead} onClick={() => onOpenDomain(key)}>
                  <span className={styles.pieceIcon}><DomainGlyph domain={key} /></span>
                  <b>{d.name}</b>
                  <em className={`${styles.stateChip} ${stateChipClass(status)}`}>{WORK_STATE_LABELS[status]}</em>
                </button>
                <p className={styles.landBlocker}>{deriveDomainBlocker(d)}</p>
                <div className={styles.landCells}>
                  {deriveStageBlocks(d).map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      className={`${styles.landCell} ${miniStateClass(b.state)}`}
                      onClick={() => onOpenDomain(key, b.stageId)}
                      aria-label={`${d.name}·${b.label}：${WORK_STATE_LABELS[b.state]}（${b.note}）`}
                      title={b.note}
                    >
                      <span>{b.label}</span>
                      <em>{WORK_STATE_LABELS[b.state]}</em>
                    </button>
                  ))}
                </div>
                <button type="button" className={styles.landEnter} onClick={() => onOpenDomain(key)}>
                  进入{d.name}详情 →
                </button>
              </section>
            );
          })}
        </div>
        <aside className={styles.landChat} aria-label="右侧聊天区（约25%）">
          <ChatPanel defaultOpen={!compact} collapsible={!compact} />
        </aside>
      </div>

      <footer className={styles.landFoot}>
        <span>交互预览 · 合成数据</span>
        <span>四行 = 四域共用四阶段：材料合规 → 模型校验 → 人工复核 → 正式通过（正式通过禁用）</span>
        <button type="button" className={styles.ghostBtn} onClick={() => dispatch({ type: 'formal-attempt', kind: 'approve' })}>
          查看正式审批边界说明
        </button>
        {state.formalNotice !== null ? <em className={styles.formalNotice}>{state.formalNotice}</em> : null}
      </footer>
    </div>
  );
}
