import { assert } from '../domain/errors.js';

const EVENT_LABELS = new Map([
  ['work_case.created', '事项建立'],
  ['goal.proposed', '目标提出'],
  ['goal.accepted', '目标接受'],
  ['evidence.attached', '证据接入'],
  ['context.published', '上下文发布'],
  ['handoff.offered', '交接提出'],
  ['handoff.accepted', '交接接受'],
  ['owner.changed', '负责人转移'],
  ['human_gate.opened', 'Human Gate 打开'],
  ['human_gate.resolved', 'Human Gate 处理'],
  ['action_intent.proposed', '外部动作提出'],
  ['action_intent.authorized', '外部动作授权'],
  ['action_intent.execution_started', '外部动作开始'],
  ['execution_receipt.recorded', '外部动作回执'],
  ['metric.observed', '指标观测'],
  ['exception.opened', '异常打开'],
  ['exception.resolved', '异常解决'],
]);

const STATUS_LABELS = new Map([
  ['active', '推进中'], ['blocked', '已阻断'], ['completed', '已完成'], ['closed', '已关闭'], ['cancelled', '已取消'],
]);
const GATE_STATUS_LABELS = new Map([
  ['open', '开放'], ['approved', '已批准'], ['rejected', '已拒绝'], ['revision_required', '需修订'], ['exception_approved', '例外已批准'], ['expired', '已过期'], ['cancelled', '已取消'],
]);

function receiptLabel(status) {
  return { succeeded: '成功', failed: '失败', unknown: '未知（unknown）', rejected: '已拒绝' }[status] ?? status;
}

function actorKey(ref) {
  return ref ? `${ref.kind}:${ref.id}` : null;
}

function displayActor(state, ref) {
  if (!ref) return { id: null, label: '未指定', kind: 'unknown' };
  const actor = state.actors.find((item) => item.kind === ref.kind && item.id === ref.id);
  return { id: actorKey(ref), label: actor?.displayName ?? ref.id, kind: ref.kind, ref: structuredClone(ref) };
}

function latestReceipt(state, actionIntentId) {
  return [...state.executionReceipts].reverse().find((item) => item.actionIntentId === actionIntentId) ?? null;
}

function eventSummary(event) {
  const payload = event.payload ?? {};
  switch (event.eventType) {
    case 'work_case.created': return payload.workCase?.title ?? '建立 WorkCase';
    case 'goal.proposed': return payload.goal?.statement ?? '提出目标';
    case 'goal.accepted': return `接受目标版本 v${payload.version}`;
    case 'evidence.attached': return payload.evidence?.summary ?? payload.evidence?.id ?? '接入证据';
    case 'context.published': return `${payload.context?.purpose ?? '上下文'} · v${payload.context?.version ?? '?'}`;
    case 'handoff.offered': return `交接给 ${payload.offer?.toActorRef?.id ?? '指定接收方'}；负责人尚未改变`;
    case 'handoff.accepted': return `接收 ${payload.acceptance?.offerId ?? '交接'}`;
    case 'owner.changed': return `负责人变为 ${payload.toActorRef?.id ?? '新 owner'}`;
    case 'human_gate.opened': return payload.gate?.question ?? '打开 Human Gate';
    case 'human_gate.resolved': return `Gate 结果：${payload.resolution?.decision ?? '已处理'}`;
    case 'action_intent.proposed': return `${payload.intent?.operation ?? '外部动作'} → ${payload.intent?.systemId ?? '外部系统'}`;
    case 'execution_receipt.recorded': return `回执：${receiptLabel(payload.receipt?.status ?? 'unknown')}`;
    case 'metric.observed': return `${payload.observation?.metricKey ?? '指标'} = ${payload.observation?.value ?? '—'}`;
    default: return EVENT_LABELS.get(event.eventType) ?? event.eventType;
  }
}

function buildNodes(state) {
  return [
    {
      id: `workcase:${state.id}`,
      type: 'WorkCase',
      label: state.title,
      eyebrow: '当前 WorkCase',
      detail: `v${state.streamVersion} · ${STATUS_LABELS.get(state.status) ?? state.status}`,
      sourceRef: { projectionField: 'state' },
    },
    ...state.actors.map((actor) => ({
      id: `${actor.kind}:${actor.id}`,
      type: actor.kind === 'human' ? 'HumanPrincipal' : 'RoutableAgent',
      label: actor.displayName,
      eyebrow: actor.kind === 'human' ? '具名人员' : '可路由 Agent',
      detail: actor.kind === 'human' ? '具名人员与权限主体' : '证据准备、建议与升级',
      sourceRef: { projectionField: 'state.actors', actorRef: { kind: actor.kind, id: actor.id } },
    })),
    ...state.externalSystems.map((system) => ({
      id: `system:${system.id}`,
      type: 'ExternalSystem',
      label: system.displayName,
      eyebrow: '外部事实系统',
      detail: `事实与外部动作来源 · ${system.kind.toUpperCase()}`,
      sourceRef: { projectionField: 'state.externalSystems', systemId: system.id },
    })),
  ];
}

function buildEdges(state) {
  const edges = [];
  const caseNode = `workcase:${state.id}`;
  const owner = displayActor(state, state.ownerActorRef);
  if (owner.id) edges.push({
    id: `owner:${owner.id}`,
    type: 'current_owner', from: owner.id, to: caseNode,
    label: '当前 owner', line: 'solid', weight: 5,
    sourceRef: { projectionField: 'state.ownerActorRef' },
  });

  for (const agent of state.actors.filter((item) => item.kind === 'agent')) {
    edges.push({
      id: `accountable:${agent.id}`,
      type: 'accountable_human', from: `agent:${agent.id}`, to: `human:${agent.accountableHumanId}`,
      label: '具名问责人', line: 'double', weight: 2,
      sourceRef: { projectionField: 'state.actors.accountableHumanId' },
    });
  }

  for (const grant of state.authorityGrants.filter((item) => item.status === 'active')) {
    edges.push({
      id: `authority:${grant.id}`,
      type: 'authority', from: actorKey(grant.principalRef), to: caseNode,
      label: grant.effect === 'deny' ? '明确禁止' : `权限范围 ${grant.actions.length} 项`,
      line: grant.effect === 'deny' ? 'dash' : 'solid', weight: 1,
      sourceRef: { projectionField: 'state.authorityGrants', grantId: grant.id },
    });
  }

  const context = state.contextVersions.find((item) => item.version === state.currentContextVersion);
  if (context && owner.id) edges.push({
    id: `context:${context.id}`,
    type: 'context_read', from: caseNode, to: owner.id,
    label: `上下文 / 只读证据 v${context.version}`, line: 'dot', weight: 1,
    sourceRef: { projectionField: 'state.contextVersions', contextId: context.id },
  });

  for (const offer of state.handoffOffers) {
    edges.push({
      id: `handoff:${offer.id}`,
      type: offer.status === 'accepted' ? 'handoff_accepted' : 'handoff_offered',
      from: actorKey(offer.fromActorRef), to: actorKey(offer.toActorRef),
      label: offer.status === 'accepted' ? '交接已接受' : offer.status === 'offered' ? '待接受，负责人未改变' : `交接：${offer.status}`,
      line: offer.status === 'accepted' ? 'solid' : 'dash', weight: offer.status === 'accepted' ? 3 : 2,
      sourceRef: { projectionField: 'state.handoffOffers', offerId: offer.id },
    });
  }

  for (const intent of state.actionIntents) {
    const receipt = latestReceipt(state, intent.id);
    edges.push({
      id: `action:${intent.id}`,
      type: 'action_write', from: actorKey(intent.requestedBy), to: `system:${intent.systemId}`,
      label: receipt ? `动作 / 写入 · 回执${receiptLabel(receipt.status)}` : `动作 / 写入 · ${intent.status}`,
      line: receipt?.status === 'succeeded' ? 'solid' : receipt ? 'dash' : 'dot', weight: 2,
      receiptStatus: receipt?.status ?? null,
      sourceRef: { projectionField: 'state.actionIntents', actionIntentId: intent.id, receiptId: receipt?.id ?? null },
    });
  }
  return edges.filter((edge) => edge.from && edge.to);
}

function buildControls(state) {
  const openGates = state.humanGates.filter((gate) => gate.status === 'open');
  const protectedActions = state.actionIntents.map((intent) => {
    const blockingGates = openGates.filter((gate) => gate.protectedActions.includes('action.authorize') || intent.requiredGateIds.includes(gate.id));
    return {
      actionIntentId: intent.id,
      status: intent.status,
      enabled: false,
      disabledReason: blockingGates.length > 0
        ? `开放 Human Gate 阻止授权：${blockingGates.map((gate) => gate.id).join('、')}`
        : '是否可执行必须由后端 authority、capability、context 与版本校验决定。',
      blockingGateIds: blockingGates.map((gate) => gate.id),
      sourceRef: { projectionField: 'state.actionIntents/state.humanGates' },
    };
  });
  return { protectedActions };
}

function buildReplay(state, events) {
  const goal = state.goalVersions.find((item) => item.version === state.acceptedGoalVersion) ?? null;
  const context = state.contextVersions.find((item) => item.version === state.currentContextVersion) ?? null;
  const owner = displayActor(state, state.ownerActorRef);
  const gateText = state.humanGates.length === 0
    ? '没有 Human Gate 记录'
    : state.humanGates.map((gate) => `${gate.question}（${gate.assignedHumanId}：${GATE_STATUS_LABELS.get(gate.status) ?? gate.status}）`).join('；');
  const receiptText = state.executionReceipts.length === 0
    ? '尚无外部动作回执'
    : state.executionReceipts.map((receipt) => `${receipt.actionIntentId}：${receiptLabel(receipt.status)}`).join('；');
  return {
    sixQuestions: [
      { key: 'what', question: '发生了什么', answer: `${state.title} 已进入“${STATUS_LABELS.get(state.status) ?? state.status}”状态。`, source: 'WorkCase projection' },
      { key: 'why', question: '为什么', answer: goal?.statement ?? '尚未接受目标，原因待补充。', source: goal ? `GoalVersion v${goal.version}` : 'WorkCase projection' },
      { key: 'who', question: '谁负责', answer: `${owner.label}；具名问责人：${state.accountableHumanId ?? '未指定'}。`, source: 'ownerActorRef/accountableHumanId' },
      { key: 'basis', question: '依据什么', answer: context ? `${context.evidenceIds.length} 条证据组成 ContextVersion v${context.version}。` : '尚无当前 ContextVersion。', source: context?.id ?? 'WorkCase projection' },
      { key: 'approved', question: '谁批准', answer: gateText, source: 'HumanGate projection' },
      { key: 'result', question: '结果与下一步', answer: `${receiptText}；下一步：${state.nextAction ?? '待具名负责人确定'}。`, source: 'ExecutionReceipt/nextAction' },
    ],
    timeline: events.map((event) => ({
      eventId: event.eventId,
      globalSequence: event.globalSequence,
      streamVersion: event.streamVersion,
      type: event.eventType,
      label: EVENT_LABELS.get(event.eventType) ?? event.eventType,
      summary: eventSummary(event),
      occurredAt: event.occurredAt,
      identityAssurance: event.metadata?.identityAssurance ?? null,
    })),
  };
}

export function projectContinuityGraph({ projection, replay, events }) {
  assert(projection?.state && replay?.state && Array.isArray(events), 'GRAPH_SOURCE_INVALID', '关系图需要 WorkCase projection、replay 与 events。', 500);
  const state = projection.state;
  assert(state.id === replay.state.id, 'GRAPH_SOURCE_INVALID', 'projection 与 replay 的 WorkCase 不一致。', 500);
  const goal = state.goalVersions.find((item) => item.version === state.acceptedGoalVersion) ?? null;
  const owner = displayActor(state, state.ownerActorRef);
  const pending = state.handoffOffers.find((item) => item.status === 'offered') ?? null;
  const openGates = state.humanGates.filter((item) => item.status === 'open');
  return {
    schemaVersion: 1,
    source: {
      workCaseId: state.id,
      projectionVersion: projection.projectionVersion,
      projectionHash: projection.canonicalStateHash,
      replayHash: replay.canonicalStateHash,
      stale: projection.canonicalStateHash !== replay.canonicalStateHash,
      derivedFrom: ['WorkCaseProjection', 'BusinessEvent', 'ReplayProjection'],
    },
    scenarioKey: state.scenarioKey,
    workCase: { id: state.id, title: state.title, status: state.status, streamVersion: state.streamVersion },
    identityAssurance: 'demo_unverified',
    fiveQuestions: {
      goal: { label: '当前目标', value: goal?.statement ?? '尚未接受目标', sourceRef: goal ? { goalId: goal.id, version: goal.version } : null },
      owner: { label: '当前 owner', value: owner.label, actorRef: owner.ref, accountableHumanId: state.accountableHumanId, sourceRef: 'state.ownerActorRef' },
      pendingHandoff: pending ? {
        label: '待接受交接', value: `${displayActor(state, pending.fromActorRef).label} → ${displayActor(state, pending.toActorRef).label}`,
        offerId: pending.id, toActorRef: structuredClone(pending.toActorRef), ownerUnchanged: true,
        sourceRef: 'state.handoffOffers',
      } : { label: '待接受交接', value: '无', offerId: null, ownerUnchanged: true, sourceRef: 'state.handoffOffers' },
      openGate: {
        label: '开放 Gate', value: openGates.length === 0 ? '无' : `${openGates.length} 个`,
        gates: openGates.map((gate) => ({ id: gate.id, question: gate.question, assignedHumanId: gate.assignedHumanId, protectedActions: structuredClone(gate.protectedActions) })),
        sourceRef: 'state.humanGates',
      },
      nextStep: { label: '下一步', value: state.nextAction ?? '待具名负责人确定', sourceRef: 'state.nextAction' },
    },
    nodes: buildNodes(state),
    edges: buildEdges(state),
    controls: buildControls(state),
    replay: buildReplay(state, events),
    rawRefs: {
      evidenceIds: state.evidence.map((item) => item.id),
      acceptedGoalVersion: state.acceptedGoalVersion,
      contextVersion: state.currentContextVersion,
      receiptStatuses: state.executionReceipts.map((item) => ({ id: item.id, status: item.status })),
    },
  };
}
