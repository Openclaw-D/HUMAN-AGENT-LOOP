// B 候选预览 · 演示数据：形状按 2026-09-14 3467 实测 /api/v5-preview/project 与 /demo/story
//（合成演示，非真实资料）。含 origin/summary 扩展示例与超长原文（验证 1–2 句折叠+展开）。
import type { ProjectOverview } from '../site-mirror/app/v5-preview/home-contract';
import type { StoryStateView } from '../site-mirror/app/v5-preview/home-contract';
import type { MessageOrigin } from '../site-mirror/app/v5-preview/home-contract';

export interface DemoMessageExtra {
  id: string;
  origin?: MessageOrigin;
  summary?: string;
}

export const demoOverview: ProjectOverview = {
  projectId: 'demo-jw-2026-018',
  customerName: '远山精密制造',
  projectCode: 'JW-2026-018',
  projectName: '新客回租 · JW-2026-018',
  scenario: 'approval',
  scenarioLabel: '审批推进中',
  version: 154,
  updatedAt: '2026-09-14T20:40:00+08:00',
  overall: {
    progressLabel: '审批推进中',
    description:
      '政策已确认；信审待补充；商务准备中；资产待启动（合成演示；总项目以资产管理流程结束为终点，不使用数字总进度）',
  },
  domains: [
    {
      domainId: 'policy',
      name: '政策',
      segmentLabels: ['政策受理', '清单比对', '限额校验', '口径核验'],
      segments: ['done', 'done', 'done', 'done'],
      judgmentStatus: 'green',
      judgmentText: '已确认',
      summary: '政策口径已确认：设备清单属于可回租范围，限额校验通过（合成演示）。',
    },
    {
      domainId: 'credit',
      name: '信审',
      segmentLabels: ['资料接收', '偿付测算', '交叉核对', '意见核验'],
      segments: ['done', 'done', 'current', 'pending'],
      judgmentStatus: 'yellow',
      judgmentText: '待补充',
      summary: '偿付测算已过半：等待设备清单补充后完成交叉核对与意见核验（合成演示）。',
    },
    {
      domainId: 'commerce',
      name: '商务',
      segmentLabels: ['需求接收', '方案拟定', '商务协同', '报价核验'],
      segments: ['current', 'pending', 'pending', 'pending'],
      judgmentStatus: 'gray',
      judgmentText: '准备中',
      summary: '商务方案拟定中：报价口径以信审结论为准，未提前锁定（合成演示）。',
    },
    {
      domainId: 'asset',
      name: '资产',
      segmentLabels: ['标的接收', '残值评估', '处置协同', '租后核验'],
      segments: ['pending', 'pending', 'pending', 'pending'],
      judgmentStatus: 'gray',
      judgmentText: '待启动',
      summary: '资产评估待尽调资料齐备后启动（合成演示）。',
    },
  ],
  todo: {
    id: 'todo-device-list',
    title: '补充设备清单',
    detail: '资料更新后，同步相关专业判断；提交后信审转入待复核（合成演示）。',
    status: '待补充',
    relatedDomain: 'credit',
  },
  messages: [
    {
      id: 'm-init',
      fromKind: 'system',
      fromName: '系统',
      text: '合成演示项目已初始化：本页全部为合成数据，不执行正式审批。',
      at: '2026-09-14T18:02:11+08:00',
      marks: ['演示情景'],
    },
    {
      id: 'm-domain-preset',
      fromKind: 'domain',
      fromName: '信审 · 张信审（合成）',
      text: '请补充设备清单，资料更新后我们同步推进专业判断。',
      at: '2026-09-14T18:05:30+08:00',
      marks: ['合成判断'],
    },
    {
      id: 'm-domain-model',
      fromKind: 'domain',
      fromName: '信审 · 模型辅助（演示）',
      text: '已按设备清单初稿完成偿付测算：按 36 期测算，租金覆盖倍数为 1.32，处于可接受区间下沿；若设备清单金额上调超过 12%，建议重新测算并复核交叉核对结论。以上为模型辅助分析（演示数据），不构成正式信审意见，正式意见以人工复核为准。',
      at: '2026-09-14T19:12:45+08:00',
      marks: ['模型分析（演示）'],
    },
    {
      id: 'm-business-human',
      fromKind: 'business',
      fromName: '业务 · 我（演示身份）',
      text: '设备清单初稿已同步给各专业域；金额口径以增值税不含税价填写，与租赁物发票一致。清单终稿预计明早提交，如各域对清单字段有额外要求请今天下班前反馈，我统一合并后一次提交，避免多次退回。',
      at: '2026-09-14T19:30:08+08:00',
      marks: [],
    },
  ],
};

export const demoMessageExtras: Record<string, { origin?: MessageOrigin; summary?: string }> = {
  'm-init': { origin: 'preset', summary: '演示数据已就绪：本页全部为合成数据。' },
  'm-domain-preset': { origin: 'preset', summary: '信审要求补充设备清单后再继续判断。' },
  'm-domain-model': {
    origin: 'model',
    summary: '模型辅助测算：覆盖倍数 1.32 处于下沿，金额上调超 12% 需重新测算（演示）。',
  },
  'm-business-human': { origin: 'human' }, // 无摘要：正文按两行折叠，可展开看完整原文。
};

/** 固定演示（preview 本地模拟）：4 步脚本含一个"等待人工决定"步骤。 */
export function demoStoryAt(stepIndex: number): StoryStateView {
  const steps = [
    {
      stepId: 's1',
      stageIndex: 0,
      stageLabel: '商机',
      title: '商机登记',
      hint: '演示开始后按「推进」逐步完成',
      evidenceRefs: ['M1-DOC-01 v1'],
    },
    {
      stepId: 's2',
      stageIndex: 1,
      stageLabel: '预审',
      title: '预审意见人工判断',
      hint: null,
      evidenceRefs: ['M2-CREDIT-OP v1'],
    },
    {
      stepId: 's3',
      stageIndex: 2,
      stageLabel: '尽调',
      title: '远程尽调访谈',
      hint: '尽调现场主体与接入边界见远程尽调页',
      evidenceRefs: ['M3-REMOTE-01 v2', 'M3-EVID-07 v3'],
    },
    {
      stepId: 's4',
      stageIndex: 4,
      stageLabel: '租后',
      title: '租后资产巡检（终点）',
      hint: null,
      evidenceRefs: ['M4-ASSET-02 v1'],
    },
  ] as const;
  const idx = Math.max(0, Math.min(stepIndex, steps.length - 1));
  const step = steps[idx];
  return {
    mode: 'story',
    version: 154 + idx,
    step: {
      stepId: step.stepId,
      stepIndex: idx,
      stepsTotal: steps.length,
      stageIndex: step.stageIndex,
      stageLabel: step.stageLabel,
      title: step.title,
      hint: step.hint,
      evidenceRefs: step.evidenceRefs,
      decision:
        step.stepId === 's2'
          ? {
              prompt: '信审给出「待补充」意见：请人工判断按现意见继续、纠正口径或退回补充。',
              options: [
                { kind: 'confirm', label: '确认意见' },
                { kind: 'correct', label: '纠正口径' },
                { kind: 'return', label: '退回补充' },
              ],
            }
          : null,
    },
    freeNotice: null,
  };
}
