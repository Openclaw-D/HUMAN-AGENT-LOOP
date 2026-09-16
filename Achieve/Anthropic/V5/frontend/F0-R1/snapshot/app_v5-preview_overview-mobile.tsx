"use client";

// V5 PREVIEW · 手机总览（390×844 优先）：
// 顶部项目进度四刻度；中部四域顺时针拼图（左上资产·钻石 / 右上政策·尺子 /
// 右下信审·盾牌 / 左下商务·合同），每域四个可见小分区；底部聊天及输入。
// 拼图表达状态与共同推进，不靠点击拼图完成业务；点击进入该域工作详情。
import styles from './preview.module.css';
import ProgressRuler from './progress-ruler';
import ChatPanel from './chat-panel';
import { DiamondIcon, CoordinateIcon, RulerIcon, ShieldIcon, ContractIcon } from './icons';
import { MOBILE_QUADRANTS, WORK_STATE_LABELS, usePreview, type DomainKey } from './preview-state';

const QUADRANT_CLASS: Record<DomainKey, string> = {
  asset: styles.pieceAsset,
  policy: styles.piecePolicy,
  credit: styles.pieceCredit,
  commerce: styles.pieceCommerce,
};

const QUADRANT_POSITION: Record<DomainKey, string> = {
  asset: '左上',
  policy: '右上',
  credit: '右下',
  commerce: '左下',
};

export default function OverviewMobile({ onOpenDomain, onOpenBusiness }: { onOpenDomain: (d: DomainKey) => void; onOpenBusiness: () => void }) {
  const { state } = usePreview();
  const quadrants = MOBILE_QUADRANTS;

  return (
    <div className={styles.mobileOverview}>
      <header className={styles.mobileHead}>
        <div className={styles.projectNo}>{state.projectNo}</div>
        <ProgressRuler percent={state.progressPercent} note={state.progressNote} />
      </header>

      <button type="button" className={styles.businessEntry} onClick={onOpenBusiness}>
        <CoordinateIcon size={16} />
        业务协调工作台（查看四域待办并回应 · 合成示例）
        <span className={styles.entryArrow} aria-hidden>→</span>
      </button>

      <div className={styles.puzzleGrid}>
        {(Object.keys(quadrants) as Array<keyof typeof quadrants>).map((pos) => {
          const d = state.domains[quadrants[pos]];
          return (
            <button
              key={pos}
              type="button"
              className={`${styles.piece} ${QUADRANT_CLASS[d.key]}`}
              onClick={() => onOpenDomain(d.key)}
              aria-label={`${QUADRANT_POSITION[d.key]}·${d.name}：${WORK_STATE_LABELS[d.status]}，${d.blocker}。进入${d.name}详情`}
            >
              <span className={styles.pieceHead}>
                <span className={styles.pieceIcon}><DomainGlyph domain={d.key} /></span>
                <b className={styles.pieceName}>{d.name}</b>
                <em className={`${styles.stateChip} ${stateChipClass(d.status)}`}>{WORK_STATE_LABELS[d.status]}</em>
              </span>
              <span className={styles.pieceBlocker}>{d.blocker}</span>
              <span className={styles.miniBlocks}>
                {d.blocks.map((b) => (
                  <span key={b.id} className={`${styles.miniBlock} ${miniStateClass(b.state)}`}>{b.label}</span>
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <p className={styles.overviewFootnote}>
        拼图表达状态与共同推进，点击进入详情工作；正式审批禁用（待权限及对象约定）。
      </p>

      <div className={styles.mobileChat}>
        <ChatPanel defaultOpen={false} />
      </div>
    </div>
  );
}

export function DomainGlyph({ domain }: { domain: DomainKey }) {
  if (domain === 'policy') return <RulerIcon size={18} />;
  if (domain === 'credit') return <ShieldIcon size={18} />;
  if (domain === 'commerce') return <ContractIcon size={18} />;
  return <DiamondIcon size={18} />;
}

export function stateChipClass(state: string): string {
  if (state === 'awaiting') return styles.chipAwaiting;
  if (state === 'returned') return styles.chipReturned;
  if (state === 'ready') return styles.chipReady;
  if (state === 'working') return styles.chipWorking;
  return styles.chipTodo;
}

export function miniStateClass(state: string): string {
  if (state === 'awaiting') return styles.miniAwaiting;
  if (state === 'returned') return styles.miniReturned;
  if (state === 'ready') return styles.miniReady;
  if (state === 'working') return styles.miniWorking;
  return styles.miniTodo;
}
