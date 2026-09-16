// V6 SE_REBUILD · 总览主视图：一块连续紧凑面板 = 客户与编号（单行）→ 生命周期四阶段
// （唯一阶段进度表达）→ 四域矩阵（共享列头 输入/处理/协同/输出 + 四条 44px 域行）→
// 状态/待办（children）。演示控制/技术说明经 demoControls 收进客户行右缘二级下拉，
// 不占主操作行；合成标记小而清楚（下拉 chip 本身）。无第二条总进度条、无装饰留白。
// 桌面（≥700px）仅加宽居中容器，仍为纵向紧凑面板。
import { type ReactNode } from 'react';
import type { ProjectOverview } from '../../lib/v5-preview/shared-types';
import DomainRow from './domain-row';
import { lifecyclePosition, projectLine } from './rows-logic';
import {
  ChatBubbleIcon,
  ChecklistIcon,
  CycleIcon,
  GearIcon,
  InboxIcon,
  MagnifierIcon,
  NodesIcon,
  OutboxIcon,
  PenIcon,
} from './se-icons';
import styles from './se-overview.module.css';

/** 商机阶段（r5 呈现补充）：数据模型无独立商机字段。现有演示情景均表示项目已进入
 *  风控流程（预审起，currentIndex>=0）或已结清——商机阶段先于预审，按"当前阶段之前
 *  均为已完成"的同一规则推导为完成；currentIndex=-1（无阶段到达）时如实显示未开始，
 *  不硬编码为完成。仅呈现补充，不新增业务判断、不构成四域串行门禁（各专业参与
 *  不依赖该排列）。 */
const OPPORTUNITY_STAGE: readonly { key: string; label: string } = { key: 'opportunity', label: '商机' };

/** 四段呈现列（仅展示层映射：输入/处理/协同/输出；段内部含义仍是 接收/处理/协同/核验）。 */
const PRESENTATION_COLUMNS: readonly { key: string; label: string }[] = [
  { key: 'in', label: '输入' },
  { key: 'process', label: '处理' },
  { key: 'collab', label: '协同' },
  { key: 'out', label: '输出' },
];

function ColumnIcon({ index }: { index: number }) {
  if (index === 0) return <InboxIcon size={12} />;
  if (index === 1) return <GearIcon size={12} />;
  if (index === 2) return <NodesIcon size={12} />;
  return <OutboxIcon size={12} />;
}

/** 生命周期阶段功能图标（固定于阶段名称右侧）：商机气泡/预审清单/尽调放大镜/签约笔/租后循环。 */
function StageIcon({ stageKey }: { stageKey: string }) {
  if (stageKey === 'opportunity') return <ChatBubbleIcon size={12} />;
  if (stageKey === 'pre_review') return <ChecklistIcon size={12} />;
  if (stageKey === 'due_diligence') return <MagnifierIcon size={12} />;
  if (stageKey === 'signing') return <PenIcon size={12} />;
  return <CycleIcon size={12} />;
}

export default function RowsView({
  overview,
  demoControls,
  children,
}: {
  overview: ProjectOverview;
  /** 演示控制二级收纳（page 持有情景切换确认流状态，经此槽位嵌入客户行右缘）。 */
  demoControls?: ReactNode;
  children?: ReactNode;
}) {
  const pos = lifecyclePosition(overview.scenario);
  return (
    <div className={styles.mainWrap}>
      <div className={styles.panel}>
        {/* 客户与编号：单行；长名称省略号 + title 完整值。 */}
        <header className={styles.customerRow}>
          <h1 className={styles.customerName} title={overview.customerName}>{overview.customerName}</h1>
          <span className={styles.customerCode} title={projectLine(overview.projectName, overview.projectCode)}>
            {projectLine(overview.projectName, overview.projectCode)}
          </span>
          {/* 总体进展语义保留（原进展行文字），视觉隐藏不占行高。 */}
          <span className={styles.srOnly}>
            项目进展：{overview.overall.progressLabel}（演示示意·非计算）。{overview.overall.description}
          </span>
          {demoControls}
        </header>

        <div className={styles.band} aria-hidden="true" />

        {/* 生命周期：商机/预审/尽调/签约/租后 五等宽（各20%，2px间隔+小圆角；非任选阶段
            按钮；无连接线）。商机为 r5 呈现补充（见 OPPORTUNITY_STAGE 注释）；既有四阶段
            状态推导保持原索引映射（新增一项不引起错位）。顶部表达业务阶段，下方四域矩阵
            表达专业协作，两维度独立，不构成串行门禁。 */}
        <section
          className={styles.lifecycleRow}
          aria-label={`总生命周期：${[OPPORTUNITY_STAGE, ...pos.stages].map((s) => s.label).join('→')}。${pos.settled ? '已结清（项目完整终点）· ' : ''}${pos.note}`}
        >
          {[OPPORTUNITY_STAGE, ...pos.stages].map((stage, i) => {
            // i=0 为商机：流程已开始（currentIndex>=0）或已结清 → 完成；否则未开始。
            const state =
              i === 0
                ? pos.settled || pos.currentIndex >= 0
                  ? 'done'
                  : 'pending'
                : pos.settled || i - 1 < pos.currentIndex
                  ? 'done'
                  : i - 1 === pos.currentIndex
                    ? 'current'
                    : 'pending';
            return (
              <span key={stage.key} className={styles.lifecycleStage} data-state={state} aria-current={i - 1 === pos.currentIndex && !pos.settled ? 'step' : undefined}>
                {stage.label}
                <StageIcon stageKey={stage.key} />
              </span>
            );
          })}
        </section>

        <div className={styles.band} aria-hidden="true" />

        {/* 四域矩阵：共用一行列头（呈现标签 输入/处理/协同/输出）；四个专业域各一行，与列头对齐。 */}
        <section className={styles.matrixSection} aria-label="四域总览（政策/信审/商务/资产，合成演示）">
          <div className={`${styles.matrixGrid} ${styles.matrixHead}`}>
            <span className={styles.matrixCorner}>四域</span>
            {PRESENTATION_COLUMNS.map((col, i) => (
              <span key={col.key} className={styles.colHead}>
                {col.label}
                <ColumnIcon index={i} />
              </span>
            ))}
          </div>
          {overview.domains.map((d) => (
            <DomainRow key={d.domainId} domain={d} relatedTodo={overview.todo} />
          ))}
        </section>

        <div className={styles.band} aria-hidden="true" />

        {children}
      </div>
    </div>
  );
}
