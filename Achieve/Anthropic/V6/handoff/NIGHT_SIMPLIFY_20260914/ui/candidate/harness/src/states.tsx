// harness 状态集：覆盖 SIMPLIFICATION.md §三 的关键状态（全部合成演示数据，回调为桩）。
import type { ReactElement } from 'react';
import RemoteInterviewPage from '../../../candidate/RemoteInterviewPage';
import { baseProps } from './shared-props';

const base = baseProps();

function variant(patch: Parameters<typeof baseProps>[0] extends never ? never : Partial<RemoteInterviewPropsOf>): typeof base {
  return { ...base, ...patch };
}

type RemoteInterviewPropsOf = ReturnType<typeof baseProps>;

const LONG_TEXT = '这是用于溢出检查的较长提示文本：设备为 2019 年购入的数控折弯机三台与激光切割机一台，账面原值合计约 486 万元，已使用约六年，日常保养由设备部按月执行，最近一次大修为 2025 年 11 月，实控人口述与现场照片初步一致，但仍需书面保养记录与电费单交叉核对后方可作为额度依据（合成演示长文本）。';

export const STATES: { name: string; label: string; element: ReactElement }[] = [
  { name: '01-loading', label: '加载中', element: <RemoteInterviewPage {...variant({ phase: 'loading' })} /> },
  {
    name: '02-error', label: '加载失败（可重试）',
    element: <RemoteInterviewPage {...variant({ phase: 'error', loadError: '远程尽调数据暂不可用，请稍后重试' })} />,
  },
  { name: '03-empty', label: '空态（创建会话）', element: <RemoteInterviewPage {...variant({ phase: 'empty' })} /> },
  { name: '04-ready-live', label: '正常 · 未接入画面（默认）', element: <RemoteInterviewPage {...base} /> },
  { name: '05-ready-sim', label: '模拟画面开启', element: <RemoteInterviewPage {...variant({ simulationOn: true })} /> },
  {
    name: '06-ready-paused', label: '已暂停 + 人工待处理',
    element: <RemoteInterviewPage {...variant({
      paused: true,
      live: false,
      humanPendingCount: 1,
      reviews: [...base.reviews, { reviewId: 'rv2', label: '暂停本轮判断', targetVersion: 3, opinion: '关键问题待人工闭环（合成演示）' }],
      notice: '已提交转人工复核（合成演示；模型无审批权）',
    })} />,
  },
  {
    name: '07-ready-pending-req', label: '未知请求恢复条',
    element: <RemoteInterviewPage {...variant({
      pendingRequests: [{ requestId: 'req-1', op: 'reply-annotation', savedAtLabel: '19:05:42' }],
    })} />,
  },
  {
    name: '08-ready-no-question', label: '业务发起分支（无 open 问题）',
    element: <RemoteInterviewPage {...variant({ currentQuestion: null, openQuestionCount: 0 })} />,
  },
  {
    name: '09-ready-domains-empty', label: '四域提示全空',
    element: <RemoteInterviewPage {...variant({
      domains: base.domains.map((d) => ({ ...d, tips: [] })),
    })} />,
  },
  {
    name: '10-ready-domains-many', label: '四域提示较多 + 长文本',
    element: <RemoteInterviewPage {...variant({
      domains: base.domains.map((d, i) => ({
        ...d,
        tips: i === 1
          ? [{ id: 'c1', text: LONG_TEXT, level: 'warn' as const }, ...d.tips, { id: 'c9', text: '设备清单核对完成前，额度结论保持待定。', level: 'risk' as const }]
          : [...d.tips, { id: `${d.domainId}-x`, text: LONG_TEXT, level: 'info' as const }],
      })),
    })} />,
  },
  {
    name: '11-ready-write-error', label: '提交错误反馈',
    element: <RemoteInterviewPage {...variant({
      actionError: '状态已被其他窗口更新，请重试（内容已保留）',
    })} />,
  },
  {
    name: '12-ready-customer', label: '客户视图（最小面 · 非生产权限隔离）',
    element: <RemoteInterviewPage {...variant({
      viewMode: 'customer',
      transcript: [
        { at: '19:02:11', who: '实控人（合成）', text: '设备运行正常，共三台。' },
        { at: '19:03:47', who: '业务（合成）', text: '收到；请说明检修计划。' },
      ],
    })} />,
  },
];
