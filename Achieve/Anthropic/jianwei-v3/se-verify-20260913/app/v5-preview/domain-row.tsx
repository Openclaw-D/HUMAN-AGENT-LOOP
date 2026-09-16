// V6 SE_REBUILD · 四域矩阵行（紧凑 44px）：左侧域名+域图标（文字左、功能图标右）+判断徽章，
// 右侧四步状态格与列头（输入/处理/协同/输出，呈现层映射；段内部含义仍是 接收/处理/协同/核验）
// 对齐。polish-1：四步格默认首屏可读——小状态图标+可见中文状态（done=绿对号+完成/输入列"已收"，
// current=蓝时钟+进行中，pending=灰"未开始"），只用真实 segment 状态；整域"待补充"不复制到步骤，
// 步骤级黄提示/红叉仅在实际数据给出时出现（当前 SegmentState 枚举无此状态，不伪造）。
// 旧"四步格只允许黑白灰"注释被本轮替代：状态格获准适量状态色。
// 整行可点击/键盘展开（hit area≥44px）：展开显示 summary、四段 segmentLabels 与状态、
// 当前相关待办提示；展开状态为本地 UI 状态，数据刷新（同 domainId）不重置。
// 无专业详情入口：业务只能看授权总览，不做任何跳转到专业工作台的链接。
import { useState } from 'react';
import type { DomainId, DomainRow as DomainRowData, JudgmentStatus, SegmentState, TodoItem } from '../../lib/v5-preview/shared-types';
import { segmentStateLabel } from './rows-logic';
import {
  CheckIcon,
  ClockIcon,
  ContractIcon,
  CrossIcon,
  DiamondIcon,
  RulerIcon,
  ShieldIcon,
  WarnIcon,
} from './se-icons';
import styles from './se-overview.module.css';

/** 四段呈现列名（仅展示层映射：输入/处理/协同/输出；不改任何字段/枚举/API）。 */
const PRESENTATION_COLUMNS: readonly string[] = ['输入', '处理', '协同', '输出'];

function DomainMark({ domainId }: { domainId: DomainId }) {
  if (domainId === 'policy') return <RulerIcon size={13} />;
  if (domainId === 'credit') return <ShieldIcon size={13} />;
  if (domainId === 'commerce') return <ContractIcon size={13} />;
  return <DiamondIcon size={13} />;
}

/** 判断徽章图标（r6）：green=小圆对号（圆润统一款）/ yellow=叹号 / red=叉（仅实际 red 才红叉，
 *  不伪造）/ gray=灰点；徽章在其文字左侧。不把所有专业标成完成——只按真实判断状态。 */
function JudgmentMark({ status }: { status: JudgmentStatus }) {
  if (status === 'green')
    return (
      <span className={styles.roundCheckBadge}>
        <CheckIcon size={8} />
      </span>
    );
  if (status === 'yellow') return <WarnIcon size={10} />;
  if (status === 'red') return <CrossIcon size={10} />;
  return <span className={styles.judgmentDot} aria-hidden="true" />;
}

/** 步骤格内容（真实 segment 状态）：r6 完成格只显示居中小圆对号（绿圆白勾），不再显示
 *  "已收/完成"文字——完整含义保留在行按钮的无障碍名称（aria-label）与 title 中；
 *  current/pending 仍显示文字。浅绿完成底色与格子边界由 .cell[data-state='done'] 保留。 */
function CellMark({ state }: { state: SegmentState }) {
  if (state === 'done') {
    return (
      <span className={styles.roundCheckBadge}>
        <CheckIcon size={8} />
      </span>
    );
  }
  if (state === 'current') {
    return (
      <>
        <ClockIcon size={11} />
        <span>进行中</span>
      </>
    );
  }
  if (state === 'pending') {
    return <span>未开始</span>;
  }
  return <span>未知</span>;
}

export default function DomainRow({ domain, relatedTodo = null }: { domain: DomainRowData; relatedTodo?: TodoItem | null }) {
  const [open, setOpen] = useState(false);
  const panelId = `v5-se-domain-panel-${domain.domainId}`;
  const segmentsText = domain.segments
    .map((state: SegmentState, i: number) => `${PRESENTATION_COLUMNS[i]}：${segmentStateLabel(state)}`)
    .join('，');
  const related = relatedTodo !== null && relatedTodo.relatedDomain === domain.domainId ? relatedTodo : null;
  return (
    <article className={styles.domainWrap}>
      <button
        type="button"
        className={styles.domainBtn}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${domain.name}（${domain.judgmentText}）。${segmentsText}。点击${open ? '收起' : '展开'}该域说明`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.matrixGrid}>
          <span className={styles.domainIdCell}>
            <span className={styles.domainNameLine}>
              <span className={styles.domainName}>{domain.name}</span>
              <DomainMark domainId={domain.domainId} />
            </span>
            <span className={styles.judgmentBadge} data-judgment={domain.judgmentStatus} title={domain.judgmentText}>
              <JudgmentMark status={domain.judgmentStatus} />
              <span>{domain.judgmentText}</span>
            </span>
          </span>
          {domain.segments.map((state: SegmentState, i: number) => (
            <span
              key={`${domain.domainId}-${i}`}
              className={styles.cell}
              data-state={state}
              title={`${PRESENTATION_COLUMNS[i]}（${domain.segmentLabels[i]}）：${segmentStateLabel(state)}${i === 3 ? '（输出格如实显示原状态，如待核验，不等于正式通过）' : ''}`}
              aria-hidden="true"
            >
              <CellMark state={state} />
            </span>
          ))}
        </span>
      </button>
      {open ? (
        <div id={panelId} className={styles.domainExpanded}>
          <h2 className={styles.srOnly}>{domain.name}</h2>
          <p className={styles.summaryText}>{domain.summary}</p>
          <ul className={styles.segChipList} aria-label={`${domain.name}四段状态（段名按该域配置）`}>
            {domain.segments.map((state: SegmentState, i: number) => (
              <li key={`${domain.domainId}-seg-${i}`} className={styles.segChip} data-state={state}>
                <span className={styles.segChipDot} aria-hidden="true" />
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
