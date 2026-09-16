// V5 ROWS · 四域宽横条域卡：域名 + 判断状态灯 + 四段灰度分段条 + 一句话摘要。
// 颜色纪律：红黄绿（信号色）仅用于判断状态灯圆点/文字；分段条只允许黑白灰。
// 无专业详情入口：业务只能看授权总览，不做任何跳转到专业工作台的链接。
// V6-CTRL E：四段名称手机端无需悬停即可查看——点击横条轻量展开"段名·状态"折叠行，
// 默认收起保持紧凑；不展示任何专业详情、不加跳转。
import { useState } from 'react';
import type { DomainRow as DomainRowData, SegmentState } from '../../lib/v5-preview/shared-types';
import { segmentStateLabel } from './rows-logic';
import styles from './preview.module.css';

const SEGMENT_CLASS: Record<SegmentState, string> = {
  done: styles.segDone,
  current: styles.segCurrent,
  pending: styles.segPending,
};

function segmentClass(state: SegmentState): string {
  // 未知段状态失败关闭：按浅灰呈现，aria 文本标"未知"，不猜测为完成。
  return SEGMENT_CLASS[state] ?? styles.segPending;
}

function lampClass(status: DomainRowData['judgmentStatus']): string {
  switch (status) {
    case 'green':
      return styles.lampGreen;
    case 'yellow':
      return styles.lampYellow;
    case 'red':
      return styles.lampRed;
    default:
      return styles.lampGray;
  }
}

export default function DomainRow({ domain }: { domain: DomainRowData }) {
  const [namesOpen, setNamesOpen] = useState(false);
  const ariaText = domain.segments
    .map((state: SegmentState, i: number) => `${domain.segmentLabels[i]}：${segmentStateLabel(state)}`)
    .join('，');
  return (
    <article className={styles.domainCard}>
      <header className={styles.domainHead}>
        <h2 className={styles.domainName}>{domain.name}</h2>
        <span className={`${styles.lamp} ${lampClass(domain.judgmentStatus)}`}>
          <span className={styles.lampDot} aria-hidden="true" />
          <span>{domain.judgmentText}</span>
        </span>
      </header>
      <button
        type="button"
        className={styles.segToggle}
        aria-expanded={namesOpen}
        aria-label={`${domain.name}分段含义（点击${namesOpen ? '收起' : '展开'}）`}
        onClick={() => setNamesOpen((v) => !v)}
      >
        <span className={styles.segments} role="img" aria-label={`${domain.name}分段进度：${ariaText}`}>
          {domain.segments.map((state: SegmentState, i: number) => (
            <span
              key={`${domain.domainId}-${i}`}
              className={`${styles.seg} ${segmentClass(state)}`}
              title={domain.segmentLabels[i]}
            />
          ))}
        </span>
        <span className={styles.segToggleHint}>{namesOpen ? '收起段名' : '段名'}</span>
      </button>
      {namesOpen ? (
        <>
          <p className={styles.segNames}>
            {domain.segments.map((state: SegmentState, i: number) => (
              <span key={`${domain.domainId}-name-${i}`} className={styles.segNameChip}>
                {domain.segmentLabels[i]} · {segmentStateLabel(state)}
              </span>
            ))}
          </p>
          {/* CP3：手机端 summary 收纳进展开区（桌面仍常驻显示） */}
          <p className={`${styles.domainSummary} ${styles.domainSummaryExpanded}`}>{domain.summary}</p>
        </>
      ) : null}
      <p className={styles.domainSummary}>{domain.summary}</p>
    </article>
  );
}
