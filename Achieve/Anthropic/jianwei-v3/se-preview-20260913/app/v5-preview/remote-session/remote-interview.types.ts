// C 路候选 · 远程尽调页 props 类型（REPAIR_20260914_EVENING/remote，v3）
// 约定：数据全部经 props（只读）；一切写操作经回调；本组件不发 fetch、不含注册表、不持有业务事实。
// 相对旧 ui 候选 v2（NIGHT_SIMPLIFY_20260914/ui/candidate，tsx 53fa8727…）的差异：
// 1) 新增参会人（participants）、进度（progress）、旧版证据/过期意见计数 props；
// 2) 关键字段核对默认折叠（F1 落地为默认态）；
// 3) 移除 internalMessages/onSendInternalMessage（无后端数据源；聊天由访谈对话流承担，见 README）；
// 4) 新增可选受控草稿 drafts/onDraftsChange（页面层可继续 sessionStorage 持久，组件仍零存储）；
// 5) 聊天来源标签对连续同源消息只标一次（避免重复系统标签）。

import type { ReactNode } from 'react';

/** 页面四态（沿用现有语义）。 */
export type RivPhase = 'loading' | 'empty' | 'error' | 'ready';

/**
 * 视图模式（对齐 NIGHT_SIMPLIFY main/CONTRACT.md §6：客户视图不出现内部问答/复核/演示设置；
 * 切换为纯展示切换，非生产权限隔离——组件内以常驻标注呈现）。
 */
export type RivViewMode = 'business' | 'customer';

/** 右侧紧凑工具面板标识（单开；null=全收起）。 */
export type RivToolId = 'domains' | 'evidence' | 'participants';

/** 四域提示条目。 */
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
  /** 可缺省；提供时在时间列显示。 */
  at?: string;
}

export interface RivQuestion {
  annotationId: string;
  question: string;
  evidenceVersion: number;
  status: 'open' | 'closed';
  expired?: boolean;
  replies: RivReply[];
}

/** 参会人（来自 session.participants；诚实呈现到场与核实状态，不发明在线状态）。 */
export interface RivParticipant {
  participantId: string;
  displayName: string;
  /** business | controller | domain | model | 其他（原样显示中文映射）。 */
  kind: string;
  domainRole: string;
  attendance: string;
  attendanceVerified: boolean;
  joined: boolean;
}

/** 访谈进度（A 从 annotations/generation 计算；组件不做业务推导）。 */
export interface RivProgress {
  /** 已闭环问题数（closed 且未过期）。 */
  answered: number;
  /** 问题总数（未过期）。 */
  total: number;
  /** 会话轮次（session.generation）。 */
  round: number;
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

/** 关键字段人工核对值（沿用现有"设备数量/报价"两字段）。 */
export interface RivFieldValues {
  deviceCount: string;
  quote: string;
}

/** 受控草稿（可选）：不传时组件内部自持；传入时由页面层持久（组件仍零存储）。 */
export interface RivDrafts {
  answer: string;
  ask: string;
  fields: RivFieldValues;
}

export interface RemoteInterviewProps {
  /** 顶部标题（不含状态徽章）。 */
  title: string;
  /** 返回导航目标（Link href）。 */
  backHref: string;

  phase: RivPhase;
  /** 视图模式：business（默认）/ customer（最小面；隐藏全部内部内容）。 */
  viewMode?: RivViewMode;
  /** 视图切换回调（顶部切换按钮；页面层经 viewMode prop 驱动实际切换）。 */
  onViewModeChange?: (mode: RivViewMode) => void;
  /** phase=error 时的中文错误话术。 */
  loadError?: string | null;

  // ---- ready 态数据 ----
  /** 项目标识行，如 "JW-2026-018"。 */
  projectId?: string;
  live: boolean;
  paused: boolean;
  /**
   * 当前关键问题；null = 业务发起分支。
   * question 只在画面浮层主要呈现一次（F2）；basis/risk 在画面下方细节条呈现（不含问题文本）。
   * annotationId 供当前问题的「模型辅助分析/模拟追问」按钮定位（v2 无此字段，v3 新增）。
   */
  currentQuestion: { annotationId: string; question: string; basis: string; risk: string } | null;
  /** 除当前问题外仍 open 的数量（用于"另有 n 个待办"）。 */
  openQuestionCount: number;
  domains: RivDomain[];
  evidence: RivEvidence[];
  questions: RivQuestion[];
  participants: RivParticipant[];
  progress: RivProgress;
  reviews: RivReviewRecord[];
  pendingRequests: RivPendingRequest[];
  transcript: RivTranscriptItem[];
  /** 人工待处理徽标（顶部 + 进度行）。 */
  humanPendingCount: number;
  /** 已被新版本取代的证据数（旧版本不进清单，仅计数呈现"旧版已更新"）。 */
  supersededEvidenceCount: number;
  /** 基于过期证据的旧意见数（简短提示"待复核"）。 */
  expiredOpinionCount: number;

  // ---- 呈现控制 ----
  /** 模拟画面开关（受控）。 */
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
  /** A 注入现有 CameraPanel（本地拍照）；不传则显示占位说明。 */
  cameraSlot?: ReactNode;
  /** 受控草稿（可选，见 RivDrafts）。 */
  drafts?: RivDrafts;
  /** 草稿变更回调（受控时必配；组件不持久化）。 */
  onDraftsChange?: (patch: Partial<RivDrafts>) => void;
  /** 工具面板初始开合（仅初始态；测试/演示用，运行中由组件内部单开逻辑管理）。 */
  defaultToolOpen?: RivToolId | null;

  // ---- 演示设置区（可选；不传则该区仅保留说明行，能力由页面层保留原实现） ----
  /** 页面层技术摘要文本（会话/项目/远端版本/视频状态等），组件原样呈现。 */
  techNote?: string | null;
  /** 真实模型通道状态行（业务话术，页面层组装）。 */
  modelStatusLine?: string | null;
  /** 最近一次核算尝试结果（如实呈现未配置/过期）。 */
  calculations?: { calcId: string; status: string; stale?: boolean; reasons: string[] }[];
  /** 尝试核算回调（走 A 接口 attempt-calculation）。 */
  onAttemptCalculation?: () => void;

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
  onRetryPending?: (requestId: string) => void;
  onDiscardPending?: (requestId: string) => void;
  /** 添加合成转写演示事件（页面层演示数据；组件不持有转写事实）。 */
  onAddTranscriptDemo?: () => void;
}
