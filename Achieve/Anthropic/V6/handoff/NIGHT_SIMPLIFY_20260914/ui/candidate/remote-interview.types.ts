// 任务B 候选 · 远程尽调页 props 类型（NIGHT_SIMPLIFY_20260914/ui）
// 约定：数据全部经 props；一切写操作经 A 冻结的回调；本组件不发 fetch、不含注册表。
// 字段命名尽量对齐现有 SessionDetail（remote-session/page.tsx:99-112），差异见 README.md。

import type { ReactNode } from 'react';

/** 页面四态（沿用现有语义）。 */
export type RivPhase = 'loading' | 'empty' | 'error' | 'ready';

/**
 * 视图模式（对齐 main/CONTRACT.md §6：客户视图不出现内部问答/复核/演示设置内容；
 * 切换为纯展示切换，非生产权限隔离——组件内以常驻标注呈现）。
 * business = 业务/风控使用（默认）；customer = 实控人/客户看到的最小面。
 */
export type RivViewMode = 'business' | 'customer';

/** 四域提示条目（远程尽调页内此前没有四域提示；形状为 B 提案，见 README 接口对齐点1）。 */
export interface RivDomainTip {
  id: string;
  text: string;
  level: 'info' | 'warn' | 'risk';
}

export interface RivDomain {
  domainId: string;
  /** 政策 / 信审 / 商务 / 资产 */
  label: string;
  /** 生命周期呈现态（可缺省；缺省不显示角标）。 */
  state?: 'done' | 'current' | 'pending';
  tips: RivDomainTip[];
}

export interface RivEvidence {
  evidenceId: string;
  title: string;
  version: number;
  verificationStatus: 'human_verified' | 'contested' | 'unverified';
  expired: boolean;
}

export interface RivReply {
  replyId: string;
  /** business | model_real | model_simulation | domain | 其他（原样显示）。 */
  kind: string;
  text: string;
}

export interface RivQuestion {
  annotationId: string;
  question: string;
  evidenceVersion: number;
  status: 'open' | 'closed';
  expired?: boolean;
  replies: RivReply[];
}

/** 人工待处理可见记录（转人工/暂停/恢复留痕；来自 reviews 数据）。 */
export interface RivReviewRecord {
  reviewId: string;
  /** 已映射的中文动作名，如 转人工 / 暂停本轮判断。 */
  label: string;
  targetVersion: number;
  opinion: string;
}

/** 结果未知请求（恢复条；状态由 A 传入，B 不持有注册表）。 */
export interface RivPendingRequest {
  requestId: string;
  /** 操作名（原样，如 reply-annotation）。 */
  op: string;
  savedAtLabel: string;
}

export interface RivTranscriptItem {
  at: string;
  who: string;
  text: string;
}

export interface RivInternalMessage {
  id: string;
  who: string;
  kindLabel: string;
  text: string;
  at: string;
}

/** 关键字段人工核对值（沿用现有"设备数量/报价"两字段）。 */
export interface RivFieldValues {
  deviceCount: string;
  quote: string;
}

export interface RemoteInterviewProps {
  /** 顶部标题（不含状态徽章）。 */
  title: string;
  /** 返回导航目标（Link href）。 */
  backHref: string;

  phase: RivPhase;
  /** 视图模式：business（默认）/ customer（最小面；隐藏全部内部内容）。 */
  viewMode?: RivViewMode;
  /** phase=error 时的中文错误话术。 */
  loadError?: string | null;

  // ---- ready 态数据 ----
  /** 项目标识行，如 "JW-2026-018"。 */
  projectId?: string;
  live: boolean;
  paused: boolean;
  /** 当前关键问题；null = 业务发起分支（无 open 问题）。 */
  currentQuestion: { question: string; basis: string; risk: string } | null;
  /** 除当前问题外仍 open 的数量（用于"另有 n 个待办"）。 */
  openQuestionCount: number;
  domains: RivDomain[];
  evidence: RivEvidence[];
  questions: RivQuestion[];
  reviews: RivReviewRecord[];
  pendingRequests: RivPendingRequest[];
  transcript: RivTranscriptItem[];
  internalMessages: RivInternalMessage[];
  /** 人工待处理徽标（顶部 + 待处理区）。 */
  humanPendingCount: number;

  // ---- 呈现控制 ----
  /** 模拟画面开关（受控；作用于画面区，不再只影响全屏）。 */
  simulationOn: boolean;
  /** 真实模型辅助分析是否可用（mode=real）；不可用时的中文原因（业务话术）。 */
  modelAnalysisAvailable: boolean;
  modelAnalysisReason?: string;
  busy: boolean;
  /** 成功/状态通知（role=status）。 */
  notice: string | null;
  /** 业务错误（role=alert）。 */
  actionError: string | null;
  /** 语音能力检测说明（点开后显示）；null = 未点开。 */
  voiceNote: string | null;
  /** A 可注入现有 CameraPanel（本地拍照）；不传则显示占位说明。 */
  cameraSlot?: ReactNode;

  // ---- A 冻结的回调（候选内只调用，不实现业务） ----
  onRetryLoad?: () => void;
  onCreateSession?: () => void;
  onSubmitRecord?: (text: string, fields: RivFieldValues) => void;
  onPauseRound?: () => void;
  onResumeRound?: () => void;
  onEscalateHuman?: () => void;
  onAskQuestion?: (text: string) => void;
  onAttachEvidence?: (fixtureId: 'fixture-inspection' | 'fixture-equipment') => void;
  onSelectEvidence?: (evidenceId: string) => void;
  onSimulateToggle?: (on: boolean) => void;
  onToggleVoiceNote?: () => void;
  onAnalyzeQuestion?: (annotationId: string) => void;
  onSimulateFollowups?: (annotationId: string) => void;
  onSendInternalMessage?: (text: string) => void;
  onRetryPending?: (requestId: string) => void;
  onDiscardPending?: (requestId: string) => void;
}
