// B 候选 · 生命周期五阶段条（R-02 修正阶段显示）：每阶段 = 状态圆标（完成=绿圆白对号 /
// 进行=蓝圆扳手 / 未开始=白底描边圆问号，轮廓可见）+ 阶段名。
// 修正点 1（语义）：状态不再只靠颜色——圆标形状+图标+无障碍名称（"X，进行中"）三重表达；
// aria-current 标记当前阶段；阶段功能含义由阶段名本身表达，原装饰性功能图标移除（差异清单 D3）。
// 修正点 2（用户批注"阶段显示不能只换颜色"）：固定演示 story 驱动时，当前步所在阶段必须
// 显示"进行中"——旧 lifecyclePositionFromStory 把商机(0)映射为 currentIndex=-1，导致演示
// 第 1 步五阶段全部"未开始"（含当前阶段）。本组件对 story 分支直接按 stageIndex 推导
//（前序=完成、当前=进行中、后续=未开始、终点=已结清），不改 site rows-logic 既有函数及其
// 他调用方；free/未加载分支仍走 lifecyclePosition（情景推导，行为与旧版一致）。
import type { ProjectOverview } from '../../lib/v5-preview/shared-types';
import { lifecyclePosition } from './rows-logic';
import { CheckIcon } from './se-icons';
import { QuestionIcon, WrenchIcon } from './home-icons';
import styles from './home-overview.module.css';

const OPPORTUNITY_STAGE = { key: 'opportunity', label: '商机' };

type StageState = 'done' | 'current' | 'pending';

const STATE_WORD: Record<StageState, string> = {
  done: '已完成',
  current: '进行中',
  pending: '未开始',
};

function StateBadge({ state }: { state: StageState }) {
  if (state === 'done') {
    return (
      <span className={styles.stageBadge} data-state="done">
        <CheckIcon size={9} />
      </span>
    );
  }
  if (state === 'current') {
    return (
      <span className={styles.stageBadge} data-state="current">
        <WrenchIcon size={10} />
      </span>
    );
  }
  return (
    <span className={styles.stageBadge} data-state="pending">
      <QuestionIcon size={10} />
    </span>
  );
}

export function LifecycleStrip({
  overview,
  storyStage,
}: {
  overview: ProjectOverview;
  /** 固定演示主线阶段（A 传入 story.step）；null = 按情景推导（free/未加载）。 */
  storyStage: { stageIndex: number; settled: boolean } | null;
}) {
  const stages = [OPPORTUNITY_STAGE, ...lifecyclePosition(overview.scenario).stages];
  // story 分支：stageIndex 0..4 直接对应五阶段；无效值失败关闭 → 回退情景推导。
  const storyCurrent =
    storyStage !== null &&
    typeof storyStage.stageIndex === 'number' &&
    Number.isInteger(storyStage.stageIndex) &&
    storyStage.stageIndex >= 0 &&
    storyStage.stageIndex <= 4
      ? storyStage.stageIndex
      : null;
  const pos = lifecyclePosition(overview.scenario);
  const note =
    storyCurrent !== null
      ? '固定演示阶段标记·非时间/工作量比例·不构成起租或审批依据'
      : pos.note;
  const settled = storyCurrent !== null ? storyStage?.settled === true : pos.settled;
  return (
    <section
      className={styles.lifecycleRow}
      aria-label={`项目阶段：${stages.map((s) => s.label).join('→')}。${settled ? '已结清（项目完整终点）。' : ''}${note}`}
    >
      {stages.map((stage, i) => {
        let state: StageState;
        if (storyCurrent !== null) {
          state = settled || i < storyCurrent ? 'done' : i === storyCurrent ? 'current' : 'pending';
        } else {
          state =
            i === 0
              ? pos.settled || pos.currentIndex >= 0
                ? 'done'
                : 'pending'
              : pos.settled || i - 1 < pos.currentIndex
                ? 'done'
                : i - 1 === pos.currentIndex
                  ? 'current'
                  : 'pending';
        }
        const isCurrent = state === 'current';
        return (
          <span
            key={stage.key}
            className={styles.lifecycleStage}
            data-state={state}
            aria-current={isCurrent ? 'step' : undefined}
            title={`${stage.label}：${STATE_WORD[state]}`}
          >
            <StateBadge state={state} />
            <span className={styles.stageLabel}>{stage.label}</span>
            <span className={styles.srOnly}>，{STATE_WORD[state]}</span>
          </span>
        );
      })}
    </section>
  );
}
