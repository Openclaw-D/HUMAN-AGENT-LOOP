// B 候选 · 四域矩阵（R-02）：四域行 × 四段状态格。格子接近正方形（较窄较高、6px 间隔），
// 状态 = 圆标（完成=绿圆白对号 / 进行=蓝圆扳手 / 未开始=白底描边圆问号）+ 可隐藏中文短词；
// 文字隐藏偏好下辅助名称保留（aria-label/title 恒完整，不依赖颜色）。展示列名沿用
// 输入/处理/协同/输出（呈现层映射，段内含义仍按域配置 segmentLabels）。
// 整行可点击/键盘展开：summary、四段全名状态、相关待办提示；展开为本地 UI 状态。
import { useState } from 'react';
import type { DomainRow as DomainRowData, SegmentState, TodoItem } from '../../lib/v5-preview/shared-types';
import { segmentStateLabel } from './rows-logic';
import { CheckIcon, ContractIcon, DiamondIcon, RulerIcon, ShieldIcon } from './se-icons';
import { QuestionIcon, WrenchIcon } from './home-icons';
import styles from './home-overview.module.css';

const PRESENTATION_COLUMNS: readonly string[] = ['输入', '处理', '协同', '输出'];

function DomainMark({ domainId }: { domainId: DomainRowData['domainId'] }) {
  if (domainId === 'policy') return <RulerIcon size={13} />;
  if (domainId === 'credit') return <ShieldIcon size={13} />;
  if (domainId === 'commerce') return <ContractIcon size={13} />;
  return <DiamondIcon size={13} />;
}

/** 状态圆标（与五阶段同一套语言）：done=绿圆白对号 / current=蓝圆扳手 / pending=白圆问号。 */
function CellBadge({ state }: { state: SegmentState }) {
  if (state === 'done') {
    return (
      <span className={styles.stateBadge} data-state="done">
        <CheckIcon size={10} />
      </span>
    );
  }
  if (state === 'current') {
    return (
      <span className={styles.stateBadge} data-state="current">
        <WrenchIcon size={11} />
      </span>
    );
  }
  return (
    <span className={styles.stateBadge} data-state="pending">
      <QuestionIcon size={11} />
    </span>
  );
}

export function DomainGrid({
  domains,
  relatedTodo,
  showCellText,
}: {
  domains: readonly DomainRowData[];
  relatedTodo: TodoItem | null;
  /** 显示偏好：格子内中文短词开关（关=只显示圆标；无障碍名称不受影响）。 */
  showCellText: boolean;
}) {
  return (
    <section className={styles.matrixSection} aria-label="四域总览（政策/信审/商务/资产，合成演示）">
      <div className={styles.matrixHead}>
        <span className={styles.matrixCorner}>四域</span>
        {PRESENTATION_COLUMNS.map((label) => (
          <span key={label} className={styles.colHead}>{label}</span>
        ))}
      </div>
      {domains.map((d) => (
        <DomainGridRow key={d.domainId} domain={d} relatedTodo={relatedTodo} showCellText={showCellText} />
      ))}
    </section>
  );
}

function DomainGridRow({
  domain,
  relatedTodo,
  showCellText,
}: {
  domain: DomainRowData;
  relatedTodo: TodoItem | null;
  showCellText: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = `jw-home-domain-panel-${domain.domainId}`;
  const segmentsText = domain.segments
    .map((state: SegmentState, i: number) => `${domain.segmentLabels[i]}：${segmentStateLabel(state)}`)
    .join('，');
  const related = relatedTodo !== null && relatedTodo.relatedDomain === domain.domainId ? relatedTodo : null;
  return (
    <article className={styles.domainWrap}>
      <button
        type="button"
        className={styles.domainRowBtn}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${domain.name}（${domain.judgmentText}）。${segmentsText}。点击${open ? '收起' : '展开'}该域说明`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.domainIdCell}>
          <span className={styles.domainNameLine}>
            <DomainMark domainId={domain.domainId} />
            <span className={styles.domainName}>{domain.name}</span>
          </span>
          <span className={styles.judgmentText} data-judgment={domain.judgmentStatus}>{domain.judgmentText}</span>
        </span>
        {domain.segments.map((state: SegmentState, i: number) => (
          <span
            key={`${domain.domainId}-${i}`}
            className={styles.cell}
            data-state={state}
            title={`${domain.segmentLabels[i]}：${segmentStateLabel(state)}${i === 3 ? '（输出格如实显示原状态，不等于正式通过）' : ''}`}
          >
            <CellBadge state={state} />
            {showCellText ? <span className={styles.cellWord}>{cellWord(state)}</span> : null}
          </span>
        ))}
      </button>
      {open ? (
        <div id={panelId} className={styles.domainExpanded}>
          <p className={styles.summaryText}>{domain.summary}</p>
          <ul className={styles.segChipList} aria-label={`${domain.name}四段状态（段名按该域配置）`}>
            {domain.segments.map((state: SegmentState, i: number) => (
              <li key={`${domain.domainId}-seg-${i}`} className={styles.segChip}>
                <CellBadge state={state} />
                {domain.segmentLabels[i]} · {segmentStateLabel(state)}
              </li>
            ))}
          </ul>
          {related !== null ? (
            <p className={styles.relatedHint} role="status">
              当前相关待办：{related.title}（{related.status}，合成演示）
            </p>
          ) : null}
          <button type="button" className={styles.collapseBtn} onClick={() => setOpen(false)}>
            收起
          </button>
        </div>
      ) : null}
    </article>
  );
}

/** 格内中文短词（两字内）：完成 / 进行 / 未开始（三字）。文字仅辅助，状态语义由圆标+aria 承载。 */
function cellWord(state: SegmentState): string {
  if (state === 'done') return '完成';
  if (state === 'current') return '进行';
  return '未开始';
}
