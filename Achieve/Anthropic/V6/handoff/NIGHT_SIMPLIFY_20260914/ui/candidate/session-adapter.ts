// 任务B 候选 · SessionDetail → RemoteInterviewProps 适配器（NIGHT_SIMPLIFY_20260914/ui）
// 供 A 集成使用：把现有 remote-service detail 响应（remote-session/page.tsx:99-112 的
// SessionDetail 形状，与 lib/v5-preview/remote-types.ts 对应）映射为候选组件 props。
// 设计原则：纯函数、零副作用；内部技术字段（sessionId 切片/provider/env 名）不进用户可见面；
// 中文文案沿用现有 page 的话术。A 可直接复制进产品并按需改名。

import type { RemoteInterviewProps, RivDomain, RivReviewRecord } from './remote-interview.types';

// ---- 结构类型（与 lib/v5-preview/remote-types.ts 对应；候选自包含不 import site） ----

export interface AdapterSessionDetail {
  ok: boolean;
  remoteVersion: number;
  session: {
    sessionId: string;
    projectId: string;
    title: string;
    status: string;
    generation: number;
    participants: { participantId: string; displayName: string; kind: string; domainRole: string; attendance: string; attendanceVerified: boolean; joined: boolean }[];
    video: { provider: string; state: string; message: string };
  };
  evidence: { evidenceId: string; fixtureId: string; title: string; version: number; verificationStatus: string; expired: boolean; sha256: string; supersededBy: string | null; capturedAt: string }[];
  annotations: { annotationId: string; evidenceId: string; evidenceVersion: number; question: string; author: string; status: string; version: number; expired?: boolean; replies: { replyId: string; kind: string; author: string; text: string; at: string }[] }[];
  reviews: { reviewId: string; targetType: string; targetId: string; targetVersion: number; action: string; opinion: string; reviewer: string; at: string }[];
  calculations: unknown[];
  ruleConfig: { status: string; layers: Record<string, unknown> };
}

export interface AdapterModelStatus {
  mode: 'real' | 'simulation';
  configured: boolean;
  missing: string[];
  modeConfigured: string;
}

/** 四域风险提示（B 提案；A 可从演示步骤表/overview.domains 组装，或先用空数组=全部"暂无提示"）。 */
export function buildDomains(input?: Partial<Record<'policy' | 'credit' | 'commerce' | 'asset', { state?: RivDomain['state']; tips?: RivDomain['tips'] }>>): RivDomain[] {
  const defs: { id: 'policy' | 'credit' | 'commerce' | 'asset'; label: string }[] = [
    { id: 'policy', label: '政策' },
    { id: 'credit', label: '信审' },
    { id: 'commerce', label: '商务' },
    { id: 'asset', label: '资产' },
  ];
  return defs.map((d) => ({
    domainId: d.id,
    label: d.label,
    state: input?.[d.id]?.state,
    tips: input?.[d.id]?.tips ?? [],
  }));
}

const REVIEW_ACTION_LABEL: Record<string, string> = {
  confirm: '确认可见内容',
  correct: '纠正',
  request_resupply: '要求补充',
  request_retake: '要求重拍',
  pause_round: '暂停本轮判断',
  resume_round: '恢复本轮',
  escalate_human: '转人工',
};

export function mapDetailToProps(
  detail: AdapterSessionDetail,
  opts: {
    viewMode?: RemoteInterviewProps['viewMode'];
    simulationOn: boolean;
    modelStatus: AdapterModelStatus | null;
    busy: boolean;
    notice: string | null;
    actionError: string | null;
    voiceNote: string | null;
    pendingRequests: RemoteInterviewProps['pendingRequests'];
    domains?: RivDomain[];
    cameraSlot?: RemoteInterviewProps['cameraSlot'];
    // 四域提示数据源（A 侧组装后传入；不经本适配器发明业务判断）
    humanPendingCount?: number;
  },
): RemoteInterviewProps {
  const { session } = detail;
  const paused = session.status === 'paused';
  const openQuestions = detail.annotations.filter((a) => !a.expired && a.status === 'open');
  const active = openQuestions[0] ?? null;
  const activeEvidence = active !== null ? detail.evidence.find((e) => e.evidenceId === active.evidenceId) : undefined;

  const basis = active !== null
    ? `依据：现场证据 v${active.evidenceVersion}${activeEvidence !== undefined
      ? ` · ${activeEvidence.verificationStatus === 'human_verified' ? '已人工核实' : activeEvidence.verificationStatus === 'contested' ? '有争议' : '未核实'}`
      : ''}`
    : '依据：信审待补充（合成演示状态）。';
  const risk = active !== null
    ? '风险提示：设备清单尚未补齐，相关判断处于待核实状态（不因资料增加自动放行）。'
    : '风险提示：关键资料未到位前，不做额度/价格结论。';

  const modelAnalysisAvailable = opts.modelStatus?.mode === 'real';
  const modelAnalysisReason = modelAnalysisAvailable
    ? undefined
    : opts.modelStatus === null
      ? '正在获取模型配置状态…'
      : opts.modelStatus.configured
        ? `真实调用未启用（当前模式非 real）：接线就绪，模拟入口照常可用`
        : '真实模型通道未配置：接线就绪，演示照常可用';

  const reviews: RivReviewRecord[] = detail.reviews.slice(-4).map((r) => ({
    reviewId: r.reviewId,
    label: REVIEW_ACTION_LABEL[r.action] ?? r.action,
    targetVersion: r.targetVersion,
    opinion: r.opinion,
  }));

  return {
    title: '远程尽调访谈',
    backHref: '/v5-preview',
    phase: 'ready',
    viewMode: opts.viewMode ?? 'business',
    projectId: session.projectId,
    live: session.status === 'live',
    paused,
    currentQuestion: active !== null
      ? { question: active.question, basis, risk }
      : null, // null = 业务发起分支（候选组件渲染发起问题 dock 与"当前待办"文案）
    openQuestionCount: Math.max(0, openQuestions.length - 1),
    domains: opts.domains ?? buildDomains(),
    evidence: detail.evidence
      .filter((e) => e.supersededBy === null)
      .map((e) => ({
        evidenceId: e.evidenceId,
        title: e.title,
        version: e.version,
        verificationStatus: (e.verificationStatus === 'human_verified' || e.verificationStatus === 'contested' ? e.verificationStatus : 'unverified') as 'human_verified' | 'contested' | 'unverified',
        expired: e.expired,
      })),
    questions: detail.annotations.map((a) => ({
      annotationId: a.annotationId,
      question: a.question,
      evidenceVersion: a.evidenceVersion,
      status: a.status === 'open' ? 'open' : 'closed',
      expired: a.expired ?? false,
      replies: a.replies.map((r) => ({ replyId: r.replyId, kind: r.kind, text: r.text })),
    })),
    reviews,
    pendingRequests: opts.pendingRequests,
    transcript: [],
    internalMessages: [],
    humanPendingCount: opts.humanPendingCount ?? (detail.reviews.some((r) => r.action === 'escalate_human') ? 1 : 0),
    simulationOn: opts.simulationOn,
    modelAnalysisAvailable,
    modelAnalysisReason,
    busy: opts.busy,
    notice: opts.notice,
    actionError: opts.actionError,
    voiceNote: opts.voiceNote,
    cameraSlot: opts.cameraSlot,
  };
}
