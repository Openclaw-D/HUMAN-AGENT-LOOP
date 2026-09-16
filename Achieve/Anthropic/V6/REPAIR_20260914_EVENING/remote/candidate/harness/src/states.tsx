// harness 状态集：覆盖 C_GOAL 要求的关键状态（全部合成演示数据，回调为桩）。
// 布局态（04/05/09/10/12/13/14）+ 四态骨架（01/02/03）+ 恢复（07/11）。
import type { ReactElement } from 'react';
import RemoteInterviewStagePage from '../../../candidate/RemoteInterviewStagePage';
import type { RemoteInterviewProps } from '../../../candidate/remote-interview.types';
import { baseProps } from './shared-props';

const base = baseProps();

type PropsOf = RemoteInterviewProps;

function variant(patch: Partial<PropsOf>): PropsOf {
  return { ...base, ...patch };
}

const LONG_TEXT = '这是用于溢出检查的较长提示文本：设备为 2019 年购入的数控折弯机三台与激光切割机一台，账面原值合计约 486 万元，已使用约六年，日常保养由设备部按月执行，最近一次大修为 2025 年 11 月，实控人口述与现场照片初步一致，但仍需书面保养记录与电费单交叉核对后方可作为额度依据（合成演示长文本）。';

export const STATES: { name: string; label: string; element: ReactElement }[] = [
  { name: '01-loading', label: '加载中', element: <RemoteInterviewStagePage {...variant({ phase: 'loading' })} /> },
  {
    name: '02-error', label: '加载失败（可重试）',
    element: <RemoteInterviewStagePage {...variant({ phase: 'error', loadError: '远程尽调数据暂不可用，请稍后重试' })} />,
  },
  { name: '03-empty', label: '空态（创建会话）', element: <RemoteInterviewStagePage {...variant({ phase: 'empty' })} /> },
  { name: '04-ready-live', label: '正常 · 未接入画面（默认；字段折叠 F1 / 标题静态 F2）', element: <RemoteInterviewStagePage {...base} /> },
  { name: '05-ready-sim', label: '模拟画面开启', element: <RemoteInterviewStagePage {...variant({ simulationOn: true })} /> },
  {
    name: '06-ready-paused', label: '已暂停 + 人工待处理',
    element: <RemoteInterviewStagePage {...variant({
      paused: true,
      live: false,
      humanPendingCount: 1,
      reviews: [...base.reviews, { reviewId: 'rv2', label: '暂停本轮判断', targetVersion: 3, opinion: '关键问题待人工闭环（合成演示）' }],
      notice: '已提交转人工复核（合成演示；模型无审批权）',
    })} />,
  },
  {
    name: '07-ready-pending-req', label: '未知请求恢复条',
    element: <RemoteInterviewStagePage {...variant({
      pendingRequests: [{ requestId: 'req-1', op: 'reply-annotation', savedAtLabel: '19:05:42' }],
    })} />,
  },
  {
    name: '08-ready-no-question', label: '业务发起分支（无 open 问题）',
    element: <RemoteInterviewStagePage {...variant({ currentQuestion: null, openQuestionCount: 0 })} />,
  },
  {
    name: '09-tools-evidence', label: '工具面板：证据（含 cameraSlot 占位）',
    element: <RemoteInterviewStagePage {...variant({ defaultToolOpen: 'evidence' })} />,
  },
  {
    name: '10-tools-domains-longtext', label: '工具面板：四域 + 长文本',
    element: <RemoteInterviewStagePage {...variant({
      defaultToolOpen: 'domains',
      currentQuestion: { ...base.currentQuestion!, question: LONG_TEXT },
      domains: base.domains.map((d, i) => ({
        ...d,
        tips: i === 1
          ? [{ id: 'c1', text: LONG_TEXT, level: 'warn' as const }, ...d.tips]
          : [...d.tips, { id: `${d.domainId}-x`, text: LONG_TEXT, level: 'info' as const }],
      })),
      questions: base.questions.map((q) => (q.annotationId === 'a2' ? { ...q, question: LONG_TEXT } : q)),
    })} />,
  },
  {
    name: '11-ready-write-error', label: '提交错误反馈',
    element: <RemoteInterviewStagePage {...variant({
      actionError: '状态已被其他窗口更新，请重试（内容已保留）',
    })} />,
  },
  {
    name: '12-ready-customer', label: '客户视图（最小面 · 非生产权限隔离）',
    element: <RemoteInterviewStagePage {...variant({
      viewMode: 'customer',
      defaultToolOpen: 'participants',
      transcript: [
        { at: '19:02:11', who: '实控人（合成）', text: '设备运行正常，共三台。' },
        { at: '19:03:47', who: '业务（合成）', text: '收到；请说明检修计划。' },
      ],
    })} />,
  },
  {
    name: '13-ready-superseded', label: '旧版证据已更新 + 旧意见待复核',
    element: <RemoteInterviewStagePage {...variant({
      supersededEvidenceCount: 1,
      expiredOpinionCount: 1,
      questions: [...base.questions, {
        annotationId: 'a0',
        question: '（旧）设备清单是否已提供？',
        evidenceVersion: 1,
        status: 'open',
        expired: true,
        replies: [],
      }],
      progress: { answered: 1, total: 2, round: 2 },
    })} />,
  },
  {
    name: '14-tools-participants', label: '工具面板：参会信息',
    element: <RemoteInterviewStagePage {...variant({ defaultToolOpen: 'participants' })} />,
  },
];
