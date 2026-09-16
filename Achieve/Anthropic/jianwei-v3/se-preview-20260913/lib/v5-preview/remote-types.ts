// V6 远程尽调 · 类型（REMOTE_DD_LONG_RUN）。
// 与 rows 域完全独立：会话/证据/标注/复核/规则/核算。合成演示，不执行正式审批；
// 模型 authority=none；客户陈述/模型提取/人工核实三类来源始终分开。
// 与既有写路径同构：requestId 幂等 + expectedVersion 乐观并发 + 失败关闭。

export type RemoteSessionStatus = 'scheduled' | 'live' | 'paused' | 'ended';

export type RemoteDomainRole =
  | 'coordinator' // 见微（协调，非支配）
  | 'business'
  | 'policy'
  | 'credit'
  | 'commerce'
  | 'asset'
  | 'customer-actual-controller'
  | 'customer-finance'
  | 'customer-production';

export type ParticipantKind = 'jianwei' | 'business' | 'domain' | 'customer';

export type AttendanceState = 'on_site_declared' | 'on_site_confirmed' | 'live_only' | 'pending' | 'absent';

export interface RemoteParticipant {
  participantId: string;
  displayName: string;
  kind: ParticipantKind;
  domainRole: RemoteDomainRole;
  attendance: AttendanceState;
  /** 自报 ≠ 核实：on_site_confirmed 必须由本轮依据支撑（演示中由人工复核动作确认）。 */
  attendanceVerified: boolean;
  joined: boolean;
}

export type VideoProviderKind = 'none' | 'simulation';
export type VideoAdapterState = 'not_configured' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'ended';

export interface RemoteVideoState {
  provider: VideoProviderKind;
  state: VideoAdapterState;
  /** provider='none' 时 message 说明"视频服务未接入"；simulation 显式标注模拟会议。 */
  message: string;
}

export interface RemoteSessionRecord {
  sessionId: string;
  projectId: string;
  title: string;
  status: RemoteSessionStatus;
  /** 暂停生命周期代：每次 pause_round +1；旧在途结果不得越过当前 generation。 */
  generation: number;
  participants: RemoteParticipant[];
  video: RemoteVideoState;
  createdAt: string;
  updatedAt: string;
}

export type EvidenceSourceType = 'simulation_fixture';

export type EvidenceVerificationStatus = 'unverified' | 'human_verified' | 'contested';

export interface EvidenceRecord {
  evidenceId: string;
  projectId: string;
  sessionId: string;
  fixtureId: string;
  title: string;
  sourceType: EvidenceSourceType;
  capturedAt: string;
  receivedAt: string;
  mime: 'image/svg+xml';
  width: number;
  height: number;
  sha256: string;
  version: number;
  /** 不可变原件：复核状态由服务端按复核记录现算，不写死在本记录（补充与确认不覆盖原件）。 */
  supersededBy: string | null;
  /** 取代链反向指针（仅重拍/补充的新证据携带）。 */
  supersedes?: string | null;
  /** 摘要语义：fixture_bytes = 实际返回原图字节 SHA256；fixture_meta_legacy = 历史元信息拼串（非原件摘要，如实标注）。 */
  digestOf?: 'fixture_bytes' | 'fixture_meta_legacy';
}

export interface AnnotationRect {
  /** 归一化坐标 0..1（相对原图自然尺寸）；缩放/横竖屏不改变所指区域。 */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 'model_real'：真实模型辅助分析回复（API_OVERNIGHT 20260913 CONTRACT §3；旧记录只有前三种，读取端兼容，无需迁移）。 */
export type ReplyKind = 'model_simulation' | 'model_real' | 'business' | 'domain';

export interface AnnotationReply {
  replyId: string;
  kind: ReplyKind;
  author: string;
  text: string;
  at: string;
}

export interface AnnotationRecord {
  annotationId: string;
  sessionId: string;
  evidenceId: string;
  evidenceVersion: number;
  rect: AnnotationRect;
  question: string;
  author: string;
  status: 'open' | 'resolved';
  version: number;
  createdAt: string;
  replies: AnnotationReply[];
}

export type ReviewAction =
  | 'confirm'
  | 'correct'
  | 'request_resupply'
  | 'request_retake'
  | 'pause_round'
  | 'escalate_human'
  | 'resume_round';

export interface ReviewRecord {
  reviewId: string;
  sessionId: string;
  targetType: 'evidence' | 'annotation';
  targetId: string;
  targetVersion: number;
  action: ReviewAction;
  opinion: string;
  reviewer: string;
  at: string;
}


/** 规则配置：四层分开，当前全部未配置（业务阈值 null ≠ 0）。 */
export interface RuleConfigRecord {
  version: 0;
  status: 'unconfigured';
  layers: {
    technicalQuality: null;
    evidenceSufficiency: null;
    businessRisk: null;
    economics: null;
  };
}

export type CalculationStatus = 'not_configured' | 'missing_inputs' | 'ready_for_review' | 'blocked' | 'stale';

export interface CalculationInput {
  label: string;
  value: number | null;
  unit: string;
  source: 'test_fixture' | 'unconfigured';
  version: number;
}

export interface CalculationRecord {
  calcId: string;
  sessionId: string;
  status: CalculationStatus;
  reasons: string[];
  /** 全部输入必须显式标注来源；test_fixture = 测试输入，非实际核算。 */
  inputs: CalculationInput[];
  inputDigest: string;
  /** 结果归属版本（F4）：方案/资料/规则变化后现算 stale，历史结果本身不被改写。 */
  basedOn: { remoteVersion: number; ruleConfigStatus: string; generation: number };
  /** 永远不产生可执行授信/期限/价格建议；result 仅承载确定性算术的中间观察。 */
  result: { kind: 'none' } | { kind: 'test_arithmetic_observation'; totalCashFlow: number; totalCost: number; net: number };
  at: string;
  version: number;
}

export interface RemoteIdempotencyEntry {
  requestId: string;
  hash: string;
  response: unknown;
}
