// V6 NIGHT_SIMPLIFY · 固定演示主线：最小数据形状（main/CONTRACT.md §3，2026-09-14 01:58 冻结）。
// 全部复用 shared-types.ts 既有类型（DomainRow/TodoItem/OverviewMessage），不新建工作流引擎：
// 只有固定步骤表 + 人工决定点的确定性后继（≤3 类：confirm/correct/return）。
// 全部数据为合成演示；不执行正式审批；演示推进属演示控制（与 demo/seed 同性质，非业务写入）。

import type { DomainId, DomainRow, OverviewMessage, TodoItem } from './shared-types.ts';

export type StoryStageIndex = 0 | 1 | 2 | 3 | 4; // 商机/预审/尽调/签约/租后（LIFECYCLE_STAGES 前 0=商机）

export type StoryDecisionKind = 'confirm' | 'correct' | 'return';

export interface StoryDecisionOption {
  kind: StoryDecisionKind;
  /** 按钮文案（演示条内直接可读）。 */
  label: string;
  /** 确定性后继步骤。 */
  nextStepId: string;
}

export interface StoryDecision {
  /** 决定问题文案（含依据与风险提示，业务可读）。 */
  prompt: string;
  /** 恰 3 项：confirm / correct / return 各一。 */
  options: readonly StoryDecisionOption[];
}

export interface DemoStoryStep {
  stepId: string; // 's00'..'sNN'（URL/日志安全字符）
  stageIndex: StoryStageIndex;
  stageLabel: string; // '尽调' 等（演示条展示）
  /** 写入 overview.scenarioLabel。 */
  scenarioLabel: string;
  /** 写入 overview.overall.progressLabel。 */
  progressLabel: string;
  /** 步骤写入 overview.scenario（缺省 'approval'；终点步为 'settled'）。 */
  scenario?: 'approval' | 'settled';
  /** 演示条一句话（本轮常规动作）。 */
  title: string;
  /** 次行说明（可省）。 */
  hint?: string;
  /** 人工动作步（C 机制 DD-01/DD-03/DD-RT-1/SG-RT）：自动推进链在此步应用后停止，
   *  下一步推进需显式点击——人工动作各自成点击边界，不与常规动作捆绑。 */
  holdForHuman?: boolean;
  /** 无 decision 步的确定性后继（缺省 = 数组下一项；分支步必须显式指定）。 */
  nextStepId?: string;
  /** 恰 4 条（政策/信审/商务/资产），完整替换。 */
  domains: readonly DomainRow[];
  /** 完整替换（null = 无待办）。 */
  todo: TodoItem | null;
  /** 本步预设消息（追加；服务端落库时 id 加 requestId 后缀防重复）。 */
  messages: readonly OverviewMessage[];
  /** 远程尽调证据版本引用（仅展示文案；不跨 store 写入）。 */
  evidenceRefs?: readonly string[];
  /** 人工决定点：推进到此步后暂停等人（展示中 = 正在等待）。 */
  decision?: StoryDecision;
}

/** 步骤内容签名（服务端确定性推导当前步）：仅含步骤完全定义的字段；
 *  消息不参与签名（用户随时可追加项目沟通，不中断演示）。 */
export interface StoryOverviewSignature {
  scenario: string;
  todoId: string | null;
  todoStatus: string | null;
  progressLabel: string;
  domainSig: string;
}

export function storyStepSignatureParts(step: DemoStoryStep): StoryOverviewSignature {
  return {
    scenario: step.scenario ?? 'approval',
    todoId: step.todo?.id ?? null,
    todoStatus: step.todo?.status ?? null,
    progressLabel: step.progressLabel,
    domainSig: step.domains
      .map((d) => `${d.domainId}:${d.segments.join(',')}|${d.judgmentStatus}|${d.judgmentText}`)
      .join(';'),
  };
}

export function storyStepSignature(step: DemoStoryStep): string {
  return JSON.stringify(storyStepSignatureParts(step));
}

export function overviewSignature(overview: {
  scenario: string;
  todo: TodoItem | null;
  overall: { progressLabel: string };
  domains: readonly { domainId: DomainId; segments: readonly string[]; judgmentStatus: string; judgmentText: string }[];
}): string {
  return JSON.stringify({
    scenario: overview.scenario,
    todoId: overview.todo?.id ?? null,
    todoStatus: overview.todo?.status ?? null,
    progressLabel: overview.overall.progressLabel,
    domainSig: overview.domains
      .map((d) => `${d.domainId}:${d.segments.join(',')}|${d.judgmentStatus}|${d.judgmentText}`)
      .join(';'),
  });
}
