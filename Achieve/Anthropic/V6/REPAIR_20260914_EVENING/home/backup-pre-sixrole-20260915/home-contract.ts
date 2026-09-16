// B 候选 · 首页契约（类型层）。类型全部复用既有 FROZEN 契约（type-only import，单事实源）；
// import 路径与 site/app/v5-preview/*.tsx 完全一致——A 采用时把本目录组件原样拷入
// site/app/v5-preview/ 即可编译（隔离预览由 preview/vite.config.mjs 的 resolveId 插件
// 把这些路径映射到 site 真文件，见 preview 说明）。B 不建第二套 API client。

import type { OverviewMessage, ProjectOverview } from '../../lib/v5-preview/shared-types';
import type { MessageRecoverySlot, NoteRecoverySlot, ResolveOutcome, SubmitOutcome } from './rows-logic';
import type { SharedFactsView, StoryStateView } from './api-client';

export type { MessageRecoverySlot, NoteRecoverySlot, ResolveOutcome, StoryStateView, SubmitOutcome };
export type { OverviewMessage, ProjectOverview };

/** 消息来源精确标注（R-03）：人工 / 模型（演示）/ 预设。
 *  数据由 A 供给；缺省时 B 按保守规则推导：business→human，system→preset，
 *  domain→preset（合成演示里的专业域内容是脚本预设，不得标成真实模型）。
 *  仅当 A 的数据明确 origin='model' 时才显示「模型（演示）」。 */
export type MessageOrigin = 'human' | 'model' | 'preset';

/** B 需要 A 供给的消息扩展（可选字段，缺省走保守推导，不阻塞集成）。 */
export interface HomeMessage extends OverviewMessage {
  /** 精确来源标注。缺省推导规则见 MessageOrigin。 */
  origin?: MessageOrigin;
  /** 1–2 句摘要（A 供给）。缺省时 B 不自造摘要：正文按至多两行折叠，可展开看完整原文；
   *  摘要不得改变风险含义——这是 A 的数据责任，B 只负责"原文永远可展开"。 */
  summary?: string;
}

/** 页面级提示横幅（409 冲突 / 轮询失败 / seed 提示等，由 A 的 page 层产生）。 */
export interface HomeBanner {
  id: string;
  kind: 'warn' | 'soft' | 'danger';
  text: string;
}

export interface HomeOverviewProps {
  /** GET /api/v5-preview/project 的业务总览（唯一数据源，A 传入）。 */
  overview: ProjectOverview;
  /** GET /api/v5-preview/demo/story 的固定演示状态（A 传入；null=未加载，演示条隐藏）。
   *  R1：story 推进/人工决定紧凑放入下半"当前待办"页签。 */
  story: StoryStateView | null;
  /** REPAIR evening（A 集成版同步）：共享尽调事实（同一演示项目/专属会话的证据版本与待复核投影）。
   *  随固定演示条展示在"当前待办"页签。 */
  shared: SharedFactsView | null;
  /** 固定演示写通道（A 的 runStoryCommand）。 */
  storyBusy: boolean;
  storyError: string | null;
  storyNotice: string | null;
  onAdvance: (fromStepId: string) => void;
  onDecide: (fromStepId: string, kind: 'confirm' | 'correct' | 'return') => void;
  /** 仅固定演示 free 模式"回到固定演示"入口使用（R1 已删除页头重开图标与其确认弹层，
   *  且不以同类控件替代；本回调只服务 story 恢复，A 的 restartStory=seed approval）。 */
  onRestart: () => void;
  restarting: boolean;

  /** 补充说明通道（A 的 submitNote）；R1 起待办位于下半"当前待办"页签。 */
  onSubmitNote: (todoId: string, text: string) => Promise<SubmitOutcome>;
  pendingNote: NoteRecoverySlot;
  onResolvePendingNote: () => Promise<ResolveOutcome>;
  onDismissPendingNote: () => void;
  resolvingPendingNote: boolean;

  /** 项目沟通通道（A 的 sendMessage）；R1 起沟通位于下半"项目沟通"页签。 */
  onSendMessage: (text: string) => Promise<SubmitOutcome>;
  pendingMessage: MessageRecoverySlot;
  onResolvePendingMessage: () => Promise<ResolveOutcome>;
  onDismissPendingMessage: () => void;
  resolvingPendingMessage: boolean;

  /** 恢复记录无法写入 sessionStorage（A 传入，如实提示）。 */
  recoveryPersistFailed: boolean;
  /** 页面级横幅（冲突/轮询/seed），A 产生。 */
  banners: HomeBanner[];
  /** 远程尽调入口链接（A 传入，如 /v5-preview/remote-session；缺省隐藏入口）。 */
  remoteHref?: string;
  /** 消息扩展（origin/summary）。A 可直接把扩展字段并入 overview.messages（推荐），
   *  或经此覆盖列表按 id 补充。 */
  messageExtras?: Record<string, { origin?: MessageOrigin; summary?: string }>;
}
