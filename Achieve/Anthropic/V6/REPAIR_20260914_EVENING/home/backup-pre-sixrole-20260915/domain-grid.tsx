// B 候选 · 四域矩阵（R1 修正）：四域行 × 四段状态格。
// R1-3：16 格删除所有可见状态文字，仅留完成绿勾 / 进行蓝扳手 / 未开始圆问号；
// aria 名称与 title 恒完整（不依赖颜色）；旧 localStorage 偏好已随代码删除，无法再打开文字。
// R1-4：左侧域区 = 大图标（约占该区域一半）+ 缩小的域名字，删除已确认/待补充/准备中/待启动
// 等重复进度文案（进度由右侧格子展示）；判断状态文字保留在行内展开详情中（既有详情交互）。
// 整行可点击/键盘展开：summary、判断状态、四段全名状态、相关待办提示；展开为本地 UI 状态。
import { useState } from 'react';
import type { DomainRow as DomainRowData, SegmentState, TodoItem } from '../../lib/v5-preview/shared-types';
import { segmentStateLabel } from './rows-logic';
import { CheckIcon, ContractIcon, DiamondIcon, RulerIcon, ShieldIcon } from './se-icons';
import { QuestionIcon, WrenchIcon } from './home-icons';
import styles from './home-overview.module.css';

const PRESENTATION_COLUMNS: readonly string[] = ['输入', '处理', '协同', '输出'];

function DomainMark({ domainId }: { domainId: DomainRowData['domainId'] }) {
  if (domainId === 'policy') return <RulerIcon size={24} />;
  if (domainId === 'credit') return <ShieldIcon size={24} />;
  if (domainId === 'commerce') return <ContractIcon size={24} />;
  return <DiamondIcon size={24} />;
}

/** 状态圆标（与五阶段同一套语言）：done=绿圆白对号 / current=蓝圆扳手 / pending=白圆问号。 */
function CellBadge({ state }: { state: SegmentState }) {
  if (state === 'done') {
    return (
      <span className={styles.stateBadge} data-state="done">
        <CheckIcon size={11} />
      </span>
    );
  }
  if (state === 'current') {
    return (
      <span className={styles.stateBadge} data-state="current">
        <WrenchIcon size={12} />
      </span>
    );
  }
  return (
    <span className={styles.stateBadge} data-state="pending">
      <QuestionIcon size={12} />
    </span>
  );
}

export function DomainGrid({
  domains,
  relatedTodo,
}: {
  domains: readonly DomainRowData[];
  relatedTodo: TodoItem | null;
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
        <DomainGridRow key={d.domainId} domain={d} relatedTodo={relatedTodo} />
      ))}
    </section>
  );
}

function DomainGridRow({
  domain,
  relatedTodo,
}: {
  domain: DomainRowData;
  relatedTodo: TodoItem | null;
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
        aria-label={`${domain.name}。${segmentsText}。点击${open ? '收起' : '展开'}该域说明`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.domainIdCell}>
          <DomainMark domainId={domain.domainId} />
          <span className={styles.domainName}>{domain.name}</span>
        </span>
        {domain.segments.map((state: SegmentState, i: number) => (
          <span
            key={`${domain.domainId}-${i}`}
            className={styles.cell}
            data-state={state}
            title={`${domain.segmentLabels[i]}：${segmentStateLabel(state)}${i === 3 ? '（输出格如实显示原状态，不等于正式通过）' : ''}`}
          >
            <CellBadge state={state} />
          </span>
        ))}
      </button>
      {open ? (
        <div id={panelId} className={styles.domainExpanded}>
          <p className={styles.summaryText}>
            判断状态：{domain.judgmentText}。{domain.summary}
          </p>
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
