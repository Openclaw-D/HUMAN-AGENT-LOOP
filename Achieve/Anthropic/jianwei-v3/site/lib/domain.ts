import { getLatestDecisionReceipt, resetDecisionRuntime } from './decision-runtime.ts';
import type { DecisionReceipt } from './decision-runtime.ts';
import { acceptEvidence, getSharedContextSnapshot, recordConfirmedFact, resetEvidenceRuntime } from './evidence-runtime.ts';
import type { EvidenceInput, EvidenceReceipt } from './evidence-runtime.ts';
import { FLOW_WORKSPACES } from './flow-workspaces.ts';
import type { FlowWorkspace } from './flow-workspaces.ts';
import { completeProductCandidate, isProductModelConfigured } from './product-model.ts';
import type { ProductModelContext } from './product-model.ts';
import { appendAuthorityEvent, getAuthorityEventCount } from './authority-event-ledger.ts';
import { listCandidateStageRuns } from './stage-run-runtime.ts';

export type StageId = 'policy' | 'credit' | 'commerce' | 'asset';
export type PrepState = 'completed' | 'active' | 'locked';
export type AuthorityState = 'waiting_dependency' | 'ready_for_gate' | 'approved';
export type Authority = 'none' | 'candidate' | 'confirmed';
export type RouteDecision = 'AUTO' | 'ASK_HUMAN' | 'HUMAN_GATE' | 'BLOCK';

export type PublicFlow = {
  id: string;
  label: string;
  owner: string;
  prepState: PrepState;
  progressPercent: number;
  status: string;
  agentWork: string;
  evidence: string;
  missingEvidence: string;
  humanGate: string;
  output: string;
  previousResult: string;
  nextStep: string;
  handoffTo: string;
  why: string;
  workspace: FlowWorkspace;
};

export type PublicStage = {
  id: StageId;
  label: string;
  summary: string;
  ruleVersion: string;
  completedStepCount: number;
  prepProgressPercent: number;
  authorityState: AuthorityState;
  processRunId: string;
  contextVersion: string;
  currentFlowId: string;
  flows: PublicFlow[];
};

export type PublicMaterial = {
  id: string;
  title: string;
  imageUrl: string;
  disclosure: '合成/脱敏演示材料';
  facts: Array<{ id: string; label: string; value: string; status: 'candidate' | 'confirmed'; confirmedBy?: string }>;
};

export type ContextPacket = ProductModelContext;

export type GlobalGraphNode = {
  id: string;
  label: string;
  stageId: StageId | 'shared';
  kind: 'context' | 'flow';
  prepState: PrepState | 'shared';
  x: number;
  y: number;
};

export type PublicProjection = {
  caseId: string;
  caseTitle: string;
  sharedContext: { contextVersion: string; evidenceEventId: string; consumerCount: 4 };
  stageRuns: Array<{ stageId: StageId; processRunId: string; contextVersion: string; currentFlowId: string; prepProgressPercent: number }>;
  stages: PublicStage[];
  globalGraph: {
    width: number;
    height: number;
    clusters: Array<{ stageId: StageId; label: string; x: number; y: number; width: number; height: number }>;
    nodes: GlobalGraphNode[];
    edges: Array<{ id: string; source: string; target: string; label: string; kind: 'shared' | 'sequence' | 'handoff' }>;
  };
  creditDimensions: Array<{ id: string; label: string; signal: string }>;
  materials: PublicMaterial[];
  readiness: { label: string; value: string; note: string };
  authority: { model: 'none' };
  modelRuntime: { mode: 'local_candidate' | 'live_unverified'; label: string; liveVerified: false };
  runtimeAudit: {
    persistence: 'in_memory_demo';
    authorityEventCount: number;
    stageRunRecordCount: number;
  };
  latestReceipt?: DecisionReceipt;
  latestEvidenceReceipt?: EvidenceReceipt;
};

export type CandidateMessageInput = { caseId: string; stageId: string; flowId: string; message: string; requestId: string };
export type CandidateMessageResponse = {
  caseId: string;
  stageId: StageId;
  flowId: string;
  messageId: string;
  status: 'candidate';
  answer: string;
  evidenceRefs: string[];
  nextActions: Array<{ title: string; detail: string }>;
  contextPacket: ContextPacket;
  modelRuntime: { mode: 'local_candidate' | 'live_unverified'; label: string; liveVerified: false; model?: string };
  requestId: string;
};

export type EvidenceLoopResult = {
  fact: { id: string; status: 'candidate' | 'confirmed'; confirmedBy?: string; authority: Authority };
  receipt: { id: string; status: 'unknown' };
  routeDecision: RouteDecision;
  events: Array<{ id: string; type: string; at: string }>;
};
export type ConfirmCandidateFactInput = { caseId: string; factId: string; actor: string; requestId: string };
export type ConfirmCandidateFactResult = { id: string; status: 'confirmed'; confirmedBy: string; authority: 'confirmed' };

type InternalEvent = { id: string; type: string; at: string; payload: Record<string, string> };
type FlowDefinition = { id: string; label: string; evidence: string; output: string; previousResult: string };
type StageDefinition = { id: StageId; label: string; summary: string; ruleVersion: string; authorityState: AuthorityState; flows: FlowDefinition[] };

const CASE_ID = 'FL-DEMO-001';
const CASE_TITLE = '精密零件产线融资租赁协同复核';
const SYNTHETIC_TIME = '2026-08-20T10:00:00.000Z';
const MAX_MESSAGE_LENGTH = 600;
const MAX_REQUEST_ID_LENGTH = 160;
const MAX_ACTOR_LENGTH = 80;

const STAGE_DEFINITIONS: StageDefinition[] = [
  {
    id: 'policy', label: '政策', summary: '一次材料接入后完成解析、规则、量化、预审与版本回流。', ruleVersion: 'POLICY-RULES-v2.4', authorityState: 'ready_for_gate',
    flows: [
      { id: 'policy-material', label: '材料解析', evidence: '唯一 Evidence/Event 与字段定位', output: '共享材料字段版本', previousResult: '事项 FL-DEMO-001 已创建' },
      { id: 'policy-rules', label: '规则核验', evidence: '系统规则 v2.4 与共享字段', output: '规则命中与例外清单', previousResult: '材料字段已写入共享上下文' },
      { id: 'policy-quant', label: '量化评估', evidence: '规则裁定与六维原始值', output: '六维候选画像', previousResult: '规则例外等待具名裁定' },
      { id: 'policy-prereview', label: '智能预审', evidence: '六维画像与支持反对证据', output: '候选预审问题包', previousResult: '量化画像等待异常解释' },
      { id: 'policy-update', label: '智能更新', evidence: '四板块回流 Event 与 Receipt', output: '下一 Context Version', previousResult: '预审 Gate 尚未形成 Receipt' },
    ],
  },
  {
    id: 'credit', label: '信审', summary: '解析材料、核验事实、回链证据并进入具名复核。', ruleVersion: 'CREDIT-RULES-v3.1', authorityState: 'ready_for_gate',
    flows: [
      { id: 'credit-parse', label: '模型解析', evidence: '合成现场材料与政策共享字段', output: '候选字段包', previousResult: '政策共享版本已接入' },
      { id: 'credit-fact', label: '事实核验', evidence: '候选事实与申报材料', output: '已确认事实版本', previousResult: '模型已解析两份合成材料' },
      { id: 'credit-link', label: '证据回链', evidence: '银行流水索引与订单清单', output: '证据链索引', previousResult: '候选事实正在核验' },
      { id: 'credit-coordinate', label: '协调沟通', evidence: '缺口清单与责任人', output: '补证任务包', previousResult: '证据缺口已分类' },
      { id: 'credit-review', label: '人工复核', evidence: '规则、事实与证据链', output: '信审提交回执', previousResult: '协调结果尚未齐备' },
    ],
  },
  {
    id: 'commerce', label: '商务', summary: '围绕合同、物流、资金和付款形成履约候选与回执。', ruleVersion: 'COMMERCE-RULES-v1.8', authorityState: 'waiting_dependency',
    flows: [
      { id: 'commerce-contract', label: '合同审批', evidence: '合同草案与信审条件', output: '受控合同版本', previousResult: '信审候选条件已接收' },
      { id: 'commerce-logistics', label: '物流查验', evidence: '装运单与设备清单', output: '物流核验记录', previousResult: '合同设备清单候选已生成' },
      { id: 'commerce-funding', label: '资金匹配', evidence: '资金方案与成本测算', output: '资金匹配单', previousResult: '物流候选节点已接收' },
      { id: 'commerce-payment-check', label: '付款核验', evidence: '付款申请与账户信息', output: '付款候选指令', previousResult: '资金候选方案待 Gate' },
      { id: 'commerce-final-payment', label: '最终付款', evidence: '合同、物流、资金和账户回执', output: '付款回执', previousResult: '付款条件仍未齐备' },
    ],
  },
  {
    id: 'asset', label: '资产', summary: '从起租、租金监测到预警、催收与退出。', ruleVersion: 'ASSET-RULES-v2.0', authorityState: 'waiting_dependency',
    flows: [
      { id: 'asset-onboard', label: '起租建档', evidence: '起租单与设备台账', output: '资产档案', previousResult: '商务付款候选回执已接收' },
      { id: 'asset-rent', label: '租金监测', evidence: '租金计划与到账记录', output: '租金状态事件', previousResult: '资产档案候选已建立' },
      { id: 'asset-warning', label: '风险预警', evidence: '租金事件与巡检记录', output: '风险预警事件', previousResult: '租金候选状态已接入' },
      { id: 'asset-collection', label: '催收处置', evidence: '逾期天数与沟通记录', output: '催收处置记录', previousResult: '风险信号候选已形成' },
      { id: 'asset-litigation', label: '诉讼退出', evidence: '合同、催收与资产证据', output: '诉讼/退出回执', previousResult: '催收候选路径已整理' },
    ],
  },
];

const creditDimensions = [
  { id: 'revenue', label: '营收', signal: '近四季收入与产线利用率待对齐' },
  { id: 'cashflow', label: '流水', signal: '回款周期出现两段异常间隔' },
  { id: 'debt', label: '负债', signal: '设备融资与担保余额待归集' },
  { id: 'production', label: '生产', signal: '两台关键设备的铭牌参数需现场复核' },
  { id: 'trade', label: '交易', signal: '三笔大额订单的交付条款需确认' },
];

const materials: PublicMaterial[] = [
  { id: 'material-workshop', title: '精密车间主照', imageUrl: '/materials/workshop.png', disclosure: '合成/脱敏演示材料', facts: [{ id: 'fact-workshop-line', label: '产线状态', value: '五轴加工单元连续作业', status: 'candidate' }] },
  { id: 'material-nameplate', title: '设备铭牌', imageUrl: '/materials/nameplate.png', disclosure: '合成/脱敏演示材料', facts: [{ id: 'fact-nameplate-capacity', label: '设备能力', value: '额定加工精度 0.005 毫米', status: 'candidate' }] },
];

let eventLog: InternalEvent[] = [];
let factVersions = new Map<string, { status: 'candidate' | 'confirmed'; confirmedBy?: string }>();
let messageRuns = new Map<string, { payloadKey: string; promise: Promise<CandidateMessageResponse> }>();
let confirmRuns = new Map<string, { signature: string; promise: Promise<ConfirmCandidateFactResult> }>();
let sequence = 0;

function failureOf(code: string, message: string): Error & { code: string } { return Object.assign(new Error(message), { code }); }
function clone<T>(value: T): T { return structuredClone(value); }
function appendEvent(type: string, payload: Record<string, string> = {}): InternalEvent {
  sequence += 1;
  const event = { id: `evt-${String(sequence).padStart(4, '0')}`, type, at: SYNTHETIC_TIME, payload };
  eventLog.push(event);
  return event;
}

function buildStages(): PublicStage[] {
  const shared = getSharedContextSnapshot();
  return STAGE_DEFINITIONS.map((definition) => {
    const preparation = shared.projection.stagePreparations.find((item) => item.stageId === definition.id);
    if (!preparation) throw failureOf('INTERNAL_ERROR', `缺少 ${definition.id} 准备度`);
    return {
      id: definition.id,
      label: definition.label,
      summary: definition.summary,
      ruleVersion: definition.ruleVersion,
      completedStepCount: preparation.completedStepCount,
      prepProgressPercent: preparation.prepProgressPercent,
      authorityState: definition.authorityState,
      processRunId: preparation.processRunId,
      contextVersion: preparation.contextVersion,
      currentFlowId: preparation.currentFlowId,
      flows: definition.flows.map((flowDefinition, index) => {
        const prep = preparation.flows[index];
        const workspace = FLOW_WORKSPACES[flowDefinition.id];
        if (!prep || !workspace || prep.flowId !== flowDefinition.id) throw failureOf('INTERNAL_ERROR', `缺少 ${flowDefinition.id} 工作页`);
        const status = prep.prepState === 'completed' ? '候选准备已完成' : prep.prepState === 'active' ? '当前候选处理' : '等待前序完成';
        return {
          id: flowDefinition.id,
          label: flowDefinition.label,
          owner: workspace.primaryHumanAction.owner,
          prepState: prep.prepState,
          progressPercent: prep.progressPercent,
          status,
          agentWork: workspace.aiCompleted.join('；'),
          evidence: flowDefinition.evidence,
          missingEvidence: workspace.primaryHumanAction.evidenceGap,
          humanGate: workspace.primaryHumanAction.humanGate,
          output: flowDefinition.output,
          previousResult: flowDefinition.previousResult,
          nextStep: workspace.primaryHumanAction.action,
          handoffTo: workspace.nextHandoff.target,
          why: workspace.whyMe,
          workspace,
        };
      }),
    };
  });
}

function stageAndFlow(stageId: string, flowId: string): { stage: PublicStage; selectedFlow: PublicFlow } {
  const stage = buildStages().find((item) => item.id === stageId);
  if (!stage) throw failureOf('INVALID_STAGE', '板块无效');
  const selectedFlow = stage.flows.find((item) => item.id === flowId);
  if (!selectedFlow) throw failureOf('INVALID_FLOW', '当前流程无效');
  return { stage, selectedFlow };
}

function normalizeActor(actor: unknown): string {
  if (typeof actor !== 'string' || actor.trim() === '') throw failureOf('INVALID_ACTOR', '确认人必须是非空具名人类');
  if (actor.trim().length > MAX_ACTOR_LENGTH) throw failureOf('INVALID_ACTOR', '确认人标识过长');
  return actor.trim();
}

function normalizeMessage(input: CandidateMessageInput): CandidateMessageInput & { stageId: StageId } {
  if (input?.caseId !== CASE_ID) throw failureOf('CASE_NOT_FOUND', '事项不存在');
  const { stage } = stageAndFlow(input?.stageId, input?.flowId);
  if (typeof input?.requestId !== 'string' || input.requestId.trim() === '') throw failureOf('INVALID_REQUEST_ID', '请求标识无效');
  if (input.requestId.trim().length > MAX_REQUEST_ID_LENGTH) throw failureOf('INVALID_REQUEST_ID', '请求标识过长');
  if (typeof input?.message !== 'string' || input.message.trim() === '') throw failureOf('EMPTY_MESSAGE', '请输入内容');
  if (input.message.length > MAX_MESSAGE_LENGTH) throw failureOf('MESSAGE_TOO_LONG', '内容过长');
  return { ...input, stageId: stage.id, requestId: input.requestId.trim(), message: input.message.trim() };
}

export function buildContextPacket(caseId: string, stageId: string, flowId: string): ContextPacket {
  if (caseId !== CASE_ID) throw failureOf('CASE_NOT_FOUND', '事项不存在');
  const { stage, selectedFlow } = stageAndFlow(stageId, flowId);
  const shared = getSharedContextSnapshot().sharedContext;
  const confirmedFacts = materials.flatMap((material) => material.facts)
    .filter((fact) => factVersions.get(fact.id)?.status === 'confirmed')
    .map((fact) => `${fact.label}：${fact.value}（${factVersions.get(fact.id)?.confirmedBy}）`);
  return {
    caseId: CASE_ID,
    caseTitle: CASE_TITLE,
    contextVersion: shared.contextVersion,
    evidenceEventId: shared.evidenceEventId,
    stageId: stage.id,
    stageLabel: stage.label,
    flowId: selectedFlow.id,
    flowLabel: selectedFlow.label,
    from: selectedFlow.previousResult,
    previousResult: selectedFlow.previousResult,
    ruleVersion: stage.ruleVersion,
    confirmedFacts,
    evidenceGaps: [...selectedFlow.workspace.evidenceGaps],
    automatedWork: [...selectedFlow.workspace.aiCompleted],
    humanDecision: `${selectedFlow.workspace.primaryHumanAction.action} · ${selectedFlow.workspace.primaryHumanAction.humanGate}`,
    handoffTo: `${selectedFlow.workspace.nextHandoff.target} · ${selectedFlow.workspace.nextHandoff.receiver}`,
  };
}

function localCandidateAnswer(stage: PublicStage, selectedFlow: PublicFlow, message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('[error]')) throw failureOf('ADAPTER_FAILURE', '候选处理失败，已安全停止');
  if (lower.includes('[timeout]')) throw failureOf('ADAPTER_TIMEOUT', '候选处理超时，已安全停止');
  if (message.includes('缺口') || message.includes('证据')) {
    return `${stage.label}·${selectedFlow.label}当前缺口是“${selectedFlow.workspace.evidenceGaps.join('；')}”。候选处理已完成“${selectedFlow.workspace.aiCompleted.join('；')}”，仍需进入 ${selectedFlow.workspace.primaryHumanAction.humanGate}。`;
  }
  return `已将输入纳入${stage.label}·${selectedFlow.label}的本地候选推理。模型没有业务权威；正式动作仍由 ${selectedFlow.workspace.primaryHumanAction.owner} 决定。`;
}

async function processCandidateMessage(clean: CandidateMessageInput & { stageId: StageId }): Promise<CandidateMessageResponse> {
  const { stage, selectedFlow } = stageAndFlow(clean.stageId, clean.flowId);
  const contextPacket = buildContextPacket(clean.caseId, clean.stageId, clean.flowId);
  const messageReceivedEvent = appendEvent('MESSAGE_RECEIVED', { requestId: clean.requestId, caseId: clean.caseId });
  appendAuthorityEvent({
    eventId: `authority-${messageReceivedEvent.id}`,
    caseId: CASE_ID,
    type: 'MESSAGE_RECEIVED',
    actor: { kind: 'system', id: 'demo-web-channel', authority: 'none' },
    correlationId: clean.requestId,
    causationId: contextPacket.evidenceEventId,
    contextVersion: contextPacket.contextVersion,
    payload: { flowId: clean.flowId, stageId: clean.stageId, status: 'received' },
  });
  appendEvent('CONTEXT_PACKED', { stageId: clean.stageId, flowId: clean.flowId, contextVersion: contextPacket.contextVersion });
  let answer: string;
  let model: string | undefined;
  if (isProductModelConfigured()) {
    const result = await completeProductCandidate({ message: clean.message, context: contextPacket });
    answer = result.answer;
    model = result.model;
  } else {
    answer = localCandidateAnswer(stage, selectedFlow, clean.message);
  }
  sequence += 1;
  const response: CandidateMessageResponse = {
    caseId: CASE_ID,
    stageId: stage.id,
    flowId: selectedFlow.id,
    messageId: `msg-${String(sequence).padStart(4, '0')}`,
    status: 'candidate',
    answer,
    evidenceRefs: [selectedFlow.evidence, contextPacket.evidenceEventId, ...selectedFlow.workspace.evidenceGaps],
    nextActions: selectedFlow.workspace.nextActions.slice(0, 3).map((detail, index) => ({ title: index === 0 ? '当前首要动作' : index === 1 ? '补齐当前证据' : '准备下一接续', detail })),
    contextPacket,
    modelRuntime: isProductModelConfigured()
      ? { mode: 'live_unverified', label: 'Live GLM 已配置 · 本地尚未验证', liveVerified: false, model }
      : { mode: 'local_candidate', label: '本地候选推理', liveVerified: false },
    requestId: clean.requestId,
  };
  const answerRecordedEvent = appendEvent('ANSWER_RECORDED', { messageId: response.messageId });
  appendAuthorityEvent({
    eventId: `authority-${answerRecordedEvent.id}`,
    caseId: CASE_ID,
    type: 'CANDIDATE_ANSWER_RECORDED',
    actor: { kind: 'agent', id: 'candidate-answer-agent', authority: 'none' },
    correlationId: clean.requestId,
    causationId: `authority-${messageReceivedEvent.id}`,
    contextVersion: contextPacket.contextVersion,
    payload: {
      flowId: clean.flowId,
      messageId: response.messageId,
      runtime: model ? 'live_unverified' : 'local_candidate',
      stageId: clean.stageId,
      status: response.status,
    },
  });
  return clone(response);
}

export async function handleCandidateMessage(input: CandidateMessageInput): Promise<CandidateMessageResponse> {
  const clean = normalizeMessage(input);
  const payloadKey = JSON.stringify({ caseId: clean.caseId, stageId: clean.stageId, flowId: clean.flowId, message: clean.message });
  const existingRun = messageRuns.get(clean.requestId);
  if (existingRun) {
    if (existingRun.payloadKey !== payloadKey) throw failureOf('IDEMPOTENCY_CONFLICT', '同一请求标识已绑定其他内容');
    return clone(await existingRun.promise);
  }
  const promise = processCandidateMessage(clean);
  messageRuns.set(clean.requestId, { payloadKey, promise });
  return clone(await promise);
}

function buildGlobalGraph(stages: PublicStage[], contextVersion: string) {
  const width = 1500;
  const height = 700;
  const clusters = stages.map((stage, stageIndex) => ({ stageId: stage.id, label: stage.label, x: 30 + stageIndex * 365, y: 105, width: 320, height: 555 }));
  const nodes: GlobalGraphNode[] = [{ id: 'shared-context', label: `共享上下文 ${contextVersion}`, stageId: 'shared', kind: 'context', prepState: 'shared', x: 750, y: 45 }];
  for (const [stageIndex, stage] of stages.entries()) {
    for (const [flowIndex, flow] of stage.flows.entries()) {
      nodes.push({ id: flow.id, label: flow.label, stageId: stage.id, kind: 'flow', prepState: flow.prepState, x: 190 + stageIndex * 365, y: 155 + flowIndex * 100 });
    }
  }
  const edges: PublicProjection['globalGraph']['edges'] = [];
  for (const stage of stages) {
    edges.push({ id: `shared-${stage.id}`, source: 'shared-context', target: stage.flows[0].id, label: '同一版本消费', kind: 'shared' });
    stage.flows.slice(0, -1).forEach((flow, index) => edges.push({ id: `${stage.id}-sequence-${index}`, source: flow.id, target: stage.flows[index + 1].id, label: '顺序接续', kind: 'sequence' }));
  }
  stages.slice(0, -1).forEach((stage, index) => edges.push({ id: `handoff-${stage.id}`, source: stage.flows[4].id, target: stages[index + 1].flows[0].id, label: '板块接续', kind: 'handoff' }));
  return { width, height, clusters, nodes, edges };
}

export function getProjection(caseId: string): PublicProjection {
  if (caseId !== CASE_ID) throw failureOf('CASE_NOT_FOUND', '事项不存在');
  const stages = buildStages();
  const shared = getSharedContextSnapshot();
  const latestReceipt = getLatestDecisionReceipt();
  const authorityEventCount = getAuthorityEventCount();
  const stageRunRecordCount = listCandidateStageRuns().length;
  const stageRuns = stages.map((stage) => ({ stageId: stage.id, processRunId: stage.processRunId, contextVersion: stage.contextVersion, currentFlowId: stage.currentFlowId, prepProgressPercent: stage.prepProgressPercent }));
  return clone({
    caseId: CASE_ID,
    caseTitle: CASE_TITLE,
    sharedContext: shared.sharedContext,
    stageRuns,
    stages,
    globalGraph: buildGlobalGraph(stages, shared.sharedContext.contextVersion),
    creditDimensions,
    materials: materials.map((material) => ({ ...material, facts: material.facts.map((fact) => {
      const version = factVersions.get(fact.id);
      return version?.status === 'confirmed' ? { ...fact, status: 'confirmed' as const, confirmedBy: version.confirmedBy } : { ...fact, status: 'candidate' as const };
    }) })),
    readiness: { label: '候选准备', value: '四路共享上下文并异步处理', note: '不是批准概率' },
    authority: { model: 'none' as const },
    modelRuntime: isProductModelConfigured()
      ? { mode: 'live_unverified' as const, label: 'Live GLM 已配置 · 本地尚未验证', liveVerified: false as const }
      : { mode: 'local_candidate' as const, label: '本地候选推理', liveVerified: false as const },
    runtimeAudit: {
      persistence: 'in_memory_demo' as const,
      authorityEventCount,
      stageRunRecordCount,
    },
    ...(latestReceipt ? { latestReceipt } : {}),
    ...(shared.latestEvidenceReceipt ? { latestEvidenceReceipt: shared.latestEvidenceReceipt } : {}),
  });
}

export function acceptCanonicalEvidence(input: EvidenceInput): EvidenceReceipt {
  return acceptEvidence(input);
}

export function resetSyntheticRuntime(): void {
  eventLog = [];
  factVersions = new Map();
  messageRuns = new Map();
  confirmRuns = new Map();
  sequence = 0;
  resetEvidenceRuntime();
  resetDecisionRuntime();
}

export function simulateEvidenceLoop(options: { confirm: boolean; actor?: string }): EvidenceLoopResult {
  const factId = 'fact-nameplate-capacity';
  const actor = options.confirm ? normalizeActor(options.actor) : undefined;
  const existing = factVersions.get(factId);
  if (existing?.status === 'confirmed' && options.confirm && existing.confirmedBy !== actor) throw failureOf('FACT_ALREADY_CONFIRMED', '事实已由其他具名人员确认');
  const status = options.confirm ? 'confirmed' : existing?.status ?? 'candidate';
  if (!existing) {
    appendEvent('WORK_ITEM_OPENED', { stage: '事实核验' });
    appendEvent('FACT_CREATED', { factId, authority: 'candidate' });
    appendEvent('ACTION_REQUESTED', { action: '人工确认设备能力' });
    appendEvent('RECEIPT_PENDING', { receiptId: 'receipt-unknown-001' });
  }
  if (options.confirm) appendEvent('FACT_CONFIRMED', { factId, actor: actor ?? '' });
  factVersions.set(factId, { status, confirmedBy: actor ?? existing?.confirmedBy });
  return { fact: { id: factId, status, confirmedBy: actor ?? existing?.confirmedBy, authority: status === 'confirmed' ? 'confirmed' : 'none' }, receipt: { id: 'receipt-unknown-001', status: 'unknown' }, routeDecision: options.confirm ? 'HUMAN_GATE' : 'ASK_HUMAN', events: eventLog.map(({ id, type, at }) => ({ id, type, at })) };
}

export async function confirmCandidateFact(input: ConfirmCandidateFactInput): Promise<ConfirmCandidateFactResult> {
  if (input?.caseId !== CASE_ID) throw failureOf('CASE_NOT_FOUND', '事项不存在');
  const actor = normalizeActor(input.actor);
  if (typeof input?.requestId !== 'string' || input.requestId.trim() === '') throw failureOf('INVALID_REQUEST_ID', '请求标识无效');
  if (input.requestId.trim().length > MAX_REQUEST_ID_LENGTH) throw failureOf('INVALID_REQUEST_ID', '请求标识过长');
  const knownFact = materials.flatMap((material) => material.facts).find((fact) => fact.id === input.factId);
  if (!knownFact) throw failureOf('FACT_NOT_FOUND', '候选事实不存在');
  const requestId = input.requestId.trim();
  const signature = JSON.stringify([input.factId, actor]);
  const existingRun = confirmRuns.get(requestId);
  if (existingRun) {
    if (existingRun.signature !== signature) throw failureOf('IDEMPOTENCY_CONFLICT', '同一请求标识已绑定其他确认内容');
    return clone(await existingRun.promise);
  }
  const promise = (async () => {
    const existing = factVersions.get(input.factId);
    if (existing?.status === 'confirmed' && existing.confirmedBy !== actor) throw failureOf('FACT_ALREADY_CONFIRMED', '事实已由其他具名人员确认');
    if (existing?.status !== 'confirmed') {
      const context = recordConfirmedFact({ factId: input.factId, actor, requestId });
      appendEvent('FACT_CONFIRMED', {
        factId: input.factId,
        actor,
        contextVersion: context.contextVersion,
        contextEventId: context.contextEventId,
      });
    }
    factVersions.set(input.factId, { status: 'confirmed', confirmedBy: actor });
    return { id: input.factId, status: 'confirmed' as const, confirmedBy: actor, authority: 'confirmed' as const };
  })();
  confirmRuns.set(requestId, { signature, promise });
  return clone(await promise);
}
