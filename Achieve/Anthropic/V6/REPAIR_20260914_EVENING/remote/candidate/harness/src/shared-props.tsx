// harness 共享合成 props（单一来源；全部数据为合成演示）。
// v3：新增 participants/progress/superseded/expiredOpinion/tech 区；移除 internalMessages。
import type { RemoteInterviewProps } from '../../../candidate/remote-interview.types';

const noop = () => undefined;

export function baseProps(opts: { log?: (msg: string) => void } = {}): RemoteInterviewProps {
  const log = opts.log ?? noop;
  return {
    title: '远程尽调访谈',
    backHref: '/v5-preview',
    phase: 'ready',
    projectId: 'JW-2026-018',
    live: true,
    paused: false,
    currentQuestion: {
      annotationId: 'a2',
      question: '请说明现场设备的具体数量、现状与检修计划（对应照片区块）。',
      basis: '依据：现场证据 v2 · 未核实',
      risk: '风险提示：设备清单尚未补齐，相关判断处于待核实状态（不因资料增加自动放行）。',
    },
    openQuestionCount: 1,
    domains: [
      { domainId: 'policy', label: '政策', state: 'done', tips: [{ id: 'p1', text: '租赁物准入清单已更新：该类设备属于可做范围。', level: 'info' }] },
      { domainId: 'credit', label: '信审', state: 'current', tips: [{ id: 'c1', text: '设备清单未补齐前不做额度结论。', level: 'warn' }, { id: 'c2', text: '实控人征信已有查询授权（演示）。', level: 'info' }] },
      { domainId: 'commerce', label: '商务', state: 'pending', tips: [{ id: 'b1', text: '报价以人工核对字段为准，模型不定价。', level: 'info' }] },
      { domainId: 'asset', label: '资产', state: 'pending', tips: [] },
    ],
    evidence: [
      { evidenceId: 'ev1', title: '现场巡检照片（合成）', version: 2, verificationStatus: 'unverified', expired: false },
      { evidenceId: 'ev2', title: '设备清单 v1（合成）', version: 1, verificationStatus: 'contested', expired: false },
      { evidenceId: 'ev3', title: '租赁合同关键页（合成）', version: 3, verificationStatus: 'human_verified', expired: false },
    ],
    questions: [
      {
        annotationId: 'a1',
        question: '照片区块中的设备目前是否正常运行？',
        evidenceVersion: 1,
        status: 'closed',
        replies: [
          { replyId: 'r1', kind: 'business', text: '实控人口述：三台均正常运行，一台近期保养（合成）。' },
          { replyId: 'r2', kind: 'model_simulation', text: '建议追问保养书面记录与最近一次检修时间（SIMULATION）。' },
        ],
      },
      {
        annotationId: 'a2',
        question: '请说明现场设备的具体数量、现状与检修计划（对应照片区块）。',
        evidenceVersion: 2,
        status: 'open',
        replies: [
          { replyId: 'r3', kind: 'controller', text: '（合成）三台都在用，一台上月刚保养。', at: '19:02' },
          { replyId: 'r4', kind: 'controller', text: '（合成）检修计划回去找设备部要书面记录。', at: '19:03' },
          { replyId: 'r5', kind: 'model_simulation', text: '建议追问：保养记录编号与最近一次大修时间（SIMULATION）。', at: '19:04' },
        ],
      },
    ],
    participants: [
      { participantId: 'p1', displayName: '李敏', kind: 'business', domainRole: '业务主办', attendance: 'present', attendanceVerified: true, joined: true },
      { participantId: 'p2', displayName: '实控人·王总', kind: 'controller', domainRole: '经营现场', attendance: 'on_site', attendanceVerified: true, joined: true },
      { participantId: 'p3', displayName: '王工', kind: 'domain', domainRole: '信审', attendance: 'remote', attendanceVerified: false, joined: false },
    ],
    progress: { answered: 1, total: 2, round: 2 },
    reviews: [
      { reviewId: 'rv1', label: '要求补充', targetVersion: 2, opinion: '补充设备清单后再核（合成演示）' },
    ],
    pendingRequests: [],
    transcript: [
      { at: '19:02:11', who: '实控人（合成）', text: '设备运行正常，共三台。' },
    ],
    humanPendingCount: 0,
    supersededEvidenceCount: 0,
    expiredOpinionCount: 0,
    simulationOn: false,
    modelAnalysisAvailable: false,
    modelAnalysisReason: '真实模型通道未启用：接线就绪，等待端点与密钥配置（演示照常）',
    busy: false,
    notice: null,
    actionError: null,
    voiceNote: null,
    techNote: '会话 sess-0a12…（合成） · 项目 JW-2026-018 · 远端 v7 · 视频 not_configured（provider: none）',
    modelStatusLine: '真实模型通道：未启用真实调用（接线就绪，模拟入口照常可用）',
    calculations: [
      { calcId: 'calc-1', status: 'refused', stale: false, reasons: ['模型通道未配置：未执行核算（合成演示）'] },
    ],
    defaultToolOpen: null,
    onRetryLoad: () => log('onRetryLoad'),
    onCreateSession: () => log('onCreateSession'),
    onSubmitRecord: (text, fields) => log(`onSubmitRecord(${text.slice(0, 18)}…, ${JSON.stringify(fields)})`),
    onPauseRound: () => log('onPauseRound'),
    onResumeRound: () => log('onResumeRound'),
    onEscalateHuman: () => log('onEscalateHuman'),
    onAskQuestion: (t) => log(`onAskQuestion(${t.slice(0, 18)}…)`),
    onAttachEvidence: (f) => log(`onAttachEvidence(${f})`),
    onSelectEvidence: (id) => log(`onSelectEvidence(${id})`),
    onSimulateToggle: (on) => log(`onSimulateToggle(${String(on)})`),
    onToggleVoiceNote: () => log('onToggleVoiceNote'),
    onAnalyzeQuestion: (id) => log(`onAnalyzeQuestion(${id})`),
    onSimulateFollowups: (id) => log(`onSimulateFollowups(${id})`),
    onRetryPending: (id) => log(`onRetryPending(${id})`),
    onDiscardPending: (id) => log(`onDiscardPending(${id})`),
    onAttemptCalculation: () => log('onAttemptCalculation'),
    onAddTranscriptDemo: () => log('onAddTranscriptDemo'),
  };
}
