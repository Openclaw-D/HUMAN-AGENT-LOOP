"use client";

// V5 PREVIEW · 横屏总览（1920×1080 / 平板横屏）：
// 顶部项目编号、进度四刻度、否决/通过位置（本轮禁用并说明）；
// 主体左侧约 75% 为政策/信审/商务/资产四列、纵向四行；右侧约 25% 聊天及输入。
import styles from './preview.module.css';
import ProgressRuler from './progress-ruler';
import ChatPanel from './chat-panel';
import { DomainGlyph, miniStateClass, stateChipClass } from './overview-mobile';
import { FORMAL_NOTICE, LANDSCAPE_COLUMN_ORDER, WORK_STATE_LABELS, usePreview, type DomainKey } from './preview-state';

export default function OverviewLandscape({ onOpenDomain, onOpenBusiness }: { onOpenDomain: (d: DomainKey) => void; onOpenBusiness: () => void }) {
  const { state, dispatch } = usePreview();

  return (
    <div className={styles.landOverview}>
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

      <div className={styles.landBody}>
        <div className={styles.landMain}>
          {LANDSCAPE_COLUMN_ORDER.map((key) => {
            const d = state.domains[key];
            return (
              <section key={key} className={`${styles.landCol} ${styles[`col-${key}`]}`} aria-label={`${d.name}列`}>
                <button type="button" className={styles.landColHead} onClick={() => onOpenDomain(key)}>
                  <span className={styles.pieceIcon}><DomainGlyph domain={key} /></span>
                  <b>{d.name}</b>
                  <em className={`${styles.stateChip} ${stateChipClass(d.status)}`}>{WORK_STATE_LABELS[d.status]}</em>
                </button>
                <p className={styles.landBlocker}>{d.blocker}</p>
                <div className={styles.landCells}>
                  {d.blocks.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      className={`${styles.landCell} ${miniStateClass(b.state)}`}
                      onClick={() => onOpenDomain(key)}
                      aria-label={`${d.name}·${b.label}：${WORK_STATE_LABELS[b.state]}`}
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
          <ChatPanel defaultOpen collapsible={false} />
        </aside>
      </div>

      <footer className={styles.landFoot}>
        <span>交互预览 · 合成数据</span>
        <button type="button" className={styles.ghostBtn} onClick={() => dispatch({ type: 'formal-attempt', kind: 'approve' })}>
          查看正式审批边界说明
        </button>
        {state.formalNotice !== null ? <em className={styles.formalNotice}>{state.formalNotice}</em> : null}
      </footer>
    </div>
  );
}
