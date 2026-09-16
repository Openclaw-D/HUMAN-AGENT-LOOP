import { assert } from './errors.js';
import { clone } from './canonical.js';

export const KERNEL_VERSION = 1;
export const IDENTITY_ASSURANCE = 'demo_unverified';
export const ACTOR_KINDS = new Set(['human', 'agent']);
export const METRIC_CATEGORIES = new Set(['business', 'risk', 'efficiency']);
export const RECEIPT_STATUSES = new Set(['succeeded', 'failed', 'unknown', 'rejected']);

function requiredString(value, code, label) {
  assert(typeof value === 'string' && value.trim(), code, `${label} 必须是非空字符串。`);
  return value.trim();
}

function requiredArray(value, code, label) {
  assert(Array.isArray(value), code, `${label} 必须是数组。`);
  return value;
}

function iso(value, code, label) {
  requiredString(value, code, label);
  assert(!Number.isNaN(Date.parse(value)), code, `${label} 必须是 ISO 时间。`);
  return value;
}

function sameRef(left, right) {
  return left?.kind === right?.kind && left?.id === right?.id;
}

function actor(state, ref) {
  assert(ref && ACTOR_KINDS.has(ref.kind) && typeof ref.id === 'string', 'ACTOR_REF_INVALID', 'actor ref 必须明确为 human 或 agent。');
  const found = state.actors.find((item) => item.kind === ref.kind && item.id === ref.id);
  assert(found, 'ACTOR_NOT_FOUND', `未找到 actor ${ref.kind}:${ref.id}。`, 404);
  return found;
}

function ownerCapable(state, ref) {
  const found = actor(state, ref);
  if (found.kind === 'agent') {
    assert(typeof found.accountableHumanId === 'string' && state.actors.some((item) => item.kind === 'human' && item.id === found.accountableHumanId), 'AGENT_ACCOUNTABLE_HUMAN_REQUIRED', 'Agent owner 必须关联具名 accountable human。');
  }
  return found;
}

function activeGrant(state, ref, action, at) {
  const matches = state.authorityGrants.filter((grant) => sameRef(grant.principalRef, ref)
    && grant.actions.includes(action)
    && (grant.scope?.workCaseId === '*' || grant.scope?.workCaseId === state.id)
    && Date.parse(grant.validFrom) <= Date.parse(at)
    && Date.parse(at) < Date.parse(grant.validUntil));
  assert(!matches.some((grant) => grant.effect === 'deny' && grant.status === 'active'), 'AUTHORITY_DENIED', `明确 deny policy 阻止 ${action}。`, 403);
  const grant = matches.find((item) => item.effect !== 'deny' && item.status === 'active');
  assert(grant, 'AUTHORITY_DENIED', `actor 没有 ${action} 的有效 temporal grant。`, 403);
  return grant;
}

function authorizedActor(state, command, action) {
  assert(command.identityAssurance === IDENTITY_ASSURANCE, 'IDENTITY_ASSURANCE_INVALID', 'P2 只接受 demo_unverified，并且它不是认证。', 403);
  const found = actor(state, command.demoActorRef);
  activeGrant(state, command.demoActorRef, action, command.occurredAt);
  return found;
}

function hasCapability(found, capability) {
  return Array.isArray(found.capabilities) && found.capabilities.includes(capability);
}

function ensureMutable(state) {
  assert(!['closed', 'cancelled'].includes(state.status), 'WORK_CASE_IMMUTABLE', 'closed/cancelled WorkCase 不接受普通 mutation。', 409);
}

function currentGoal(state) {
  return state.goalVersions.find((item) => item.version === state.acceptedGoalVersion) ?? null;
}

function currentContext(state) {
  return state.contextVersions.find((item) => item.version === state.currentContextVersion) ?? null;
}

function validateCreate(command, config) {
  const payload = command.payload;
  requiredString(payload.id, 'WORK_CASE_ID_REQUIRED', 'WorkCase.id');
  requiredString(payload.organizationId, 'ORGANIZATION_ID_REQUIRED', 'organizationId');
  requiredString(payload.scenarioKey, 'SCENARIO_KEY_REQUIRED', 'scenarioKey');
  assert(payload.scenarioKey === config.scenarioKey, 'SCENARIO_CONFIG_MISMATCH', 'scenarioKey 与冻结配置不匹配。');
  requiredString(payload.title, 'TITLE_REQUIRED', 'title');
  iso(command.occurredAt, 'OCCURRED_AT_INVALID', 'occurredAt');
  const actors = [...config.humanPrincipals.map((item) => ({ ...clone(item), kind: 'human' })), ...config.routableAgents.map((item) => ({ ...clone(item), kind: 'agent' }))];
  const seed = { actors, id: payload.id };
  actor(seed, command.demoActorRef);
  const owner = ownerCapable(seed, payload.ownerActorRef);
  const accountableHumanId = owner.kind === 'human' ? owner.id : owner.accountableHumanId;
  const triggerInput = clone(payload.trigger ?? {});
  assert(triggerInput.sourceRef && typeof triggerInput.sourceRef === 'object', 'TRIGGER_SOURCE_REQUIRED', 'trigger.sourceRef 必须是对象。');
  assert(triggerInput.payloadRef && typeof triggerInput.payloadRef === 'object', 'TRIGGER_PAYLOAD_REF_REQUIRED', 'trigger.payloadRef 必须是对象。');
  const trigger = {
    id: requiredString(triggerInput.id, 'TRIGGER_ID_REQUIRED', 'trigger.id'),
    workCaseId: payload.id,
    type: requiredString(triggerInput.type, 'TRIGGER_TYPE_REQUIRED', 'trigger.type'),
    sourceRef: clone(triggerInput.sourceRef),
    observedAt: iso(triggerInput.observedAt, 'TRIGGER_OBSERVED_AT_INVALID', 'trigger.observedAt'),
    dedupeKey: requiredString(triggerInput.dedupeKey, 'TRIGGER_DEDUPE_KEY_REQUIRED', 'trigger.dedupeKey'),
    payloadRef: clone(triggerInput.payloadRef),
  };
  assert(command.identityAssurance === IDENTITY_ASSURANCE, 'IDENTITY_ASSURANCE_INVALID', 'P2 create 必须保留 demo_unverified。', 403);
  return {
    eventType: 'work_case.created',
    payload: {
      workCase: {
        schemaVersion: 1,
        kernelVersion: KERNEL_VERSION,
        id: payload.id,
        organizationId: payload.organizationId,
        scenarioKey: payload.scenarioKey,
        title: payload.title,
        status: 'active',
        ownerActorRef: clone(payload.ownerActorRef),
        accountableHumanId,
        acceptedGoalVersion: null,
        currentContextVersion: null,
        nextAction: payload.nextAction ?? null,
        configurationVersion: command.configurationVersion,
        createdAt: command.occurredAt,
        scenarioExtensions: clone(payload.scenarioExtensions ?? {}),
      },
      actors,
      externalSystems: clone(config.externalSystems),
      controlObjects: clone(config.controlObjects),
      authorityGrants: clone(config.authorityGrants),
      trigger,
    },
  };
}

export function decideCommand(state, command, config) {
  assert(command && typeof command === 'object', 'COMMAND_INVALID', 'command 必须是对象。');
  requiredString(command.commandType, 'COMMAND_TYPE_REQUIRED', 'commandType');
  iso(command.occurredAt, 'OCCURRED_AT_INVALID', 'occurredAt');
  assert(Number.isInteger(command.configurationVersion) && command.configurationVersion >= 1, 'CONFIGURATION_VERSION_INVALID', 'configurationVersion 必须是正整数。');
  if (command.commandType === 'workCase.create') {
    assert(state === null, 'WORK_CASE_EXISTS', 'WorkCase 已存在。', 409);
    return [validateCreate(command, config)];
  }
  assert(state, 'WORK_CASE_NOT_FOUND', 'WorkCase 不存在。', 404);
  assert(state.configurationVersion === command.configurationVersion, 'CONFIGURATION_VERSION_CONFLICT', 'configurationVersion 已变化。', 409);
  ensureMutable(state);
  const payload = command.payload ?? {};
  const found = authorizedActor(state, command, command.commandType);

  switch (command.commandType) {
    case 'goal.propose': {
      const version = state.goalVersions.length + 1;
      return [{ eventType: 'goal.proposed', payload: { goal: { id: requiredString(payload.id, 'GOAL_ID_REQUIRED', 'goal.id'), workCaseId: state.id, version, status: 'proposed', statement: requiredString(payload.statement, 'GOAL_STATEMENT_REQUIRED', 'goal.statement'), constraints: requiredArray(payload.constraints ?? [], 'GOAL_CONSTRAINTS_INVALID', 'constraints'), proposedBy: clone(command.demoActorRef), acceptedBy: null, evidenceIds: requiredArray(payload.evidenceIds ?? [], 'GOAL_EVIDENCE_INVALID', 'evidenceIds'), createdAt: command.occurredAt, acceptedAt: null } } }];
    }
    case 'goal.accept': {
      assert(found.kind === 'human', 'HUMAN_PRINCIPAL_REQUIRED', '只有 HumanPrincipal 能接受目标。', 403);
      const goal = state.goalVersions.find((item) => item.id === payload.goalId);
      assert(goal?.status === 'proposed', 'GOAL_NOT_PROPOSED', '目标不存在或已处理。', 409);
      return [{ eventType: 'goal.accepted', payload: { goalId: goal.id, version: goal.version, acceptedBy: clone(command.demoActorRef), acceptedAt: command.occurredAt, supersededVersion: state.acceptedGoalVersion } }];
    }
    case 'evidence.attach': {
      const evidence = clone(payload.evidence ?? {});
      requiredString(evidence.id, 'EVIDENCE_ID_REQUIRED', 'evidence.id');
      assert(!state.evidence.some((item) => item.id === evidence.id), 'EVIDENCE_EXISTS', 'Evidence id 已存在。', 409);
      evidence.workCaseId = state.id;
      evidence.observedAt = iso(evidence.observedAt, 'EVIDENCE_OBSERVED_AT_INVALID', 'evidence.observedAt');
      requiredString(evidence.contentHash, 'EVIDENCE_HASH_REQUIRED', 'contentHash');
      requiredString(evidence.classification, 'EVIDENCE_CLASSIFICATION_REQUIRED', 'classification');
      evidence.attachedBy = clone(command.demoActorRef);
      return [{ eventType: 'evidence.attached', payload: { evidence } }];
    }
    case 'context.publish': {
      const version = state.contextVersions.length + 1;
      const evidenceIds = requiredArray(payload.evidenceIds, 'CONTEXT_EVIDENCE_REQUIRED', 'context.evidenceIds');
      assert(evidenceIds.every((id) => state.evidence.some((item) => item.id === id)), 'CONTEXT_EVIDENCE_NOT_FOUND', 'ContextVersion 引用了不存在的 Evidence。');
      return [{ eventType: 'context.published', payload: { context: { id: requiredString(payload.id, 'CONTEXT_ID_REQUIRED', 'context.id'), workCaseId: state.id, version, evidenceIds: clone(evidenceIds), purpose: requiredString(payload.purpose, 'CONTEXT_PURPOSE_REQUIRED', 'purpose'), allowedDecisionUses: requiredArray(payload.allowedDecisionUses ?? [], 'CONTEXT_USES_INVALID', 'allowedDecisionUses'), freshnessPolicy: clone(payload.freshnessPolicy ?? {}), createdBy: clone(command.demoActorRef), createdAt: command.occurredAt } } }];
    }
    case 'authority.grant': {
      assert(found.kind === 'human', 'HUMAN_PRINCIPAL_REQUIRED', '只有具名 HumanPrincipal 能授予 P2 temporal grant。', 403);
      const grant = clone(payload.grant ?? {});
      requiredString(grant.id, 'GRANT_ID_REQUIRED', 'grant.id');
      actor(state, grant.principalRef);
      requiredArray(grant.actions, 'GRANT_ACTIONS_REQUIRED', 'grant.actions');
      iso(grant.validFrom, 'GRANT_TIME_INVALID', 'validFrom');
      iso(grant.validUntil, 'GRANT_TIME_INVALID', 'validUntil');
      assert(Date.parse(grant.validFrom) < Date.parse(grant.validUntil), 'GRANT_TIME_INVALID', 'validFrom 必须早于 validUntil。');
      grant.grantedBy = clone(command.demoActorRef);
      grant.status = grant.status ?? 'active';
      grant.effect = grant.effect ?? 'allow';
      return [{ eventType: 'authority.granted', payload: { grant } }];
    }
    case 'handoff.offer': {
      assert(sameRef(state.ownerActorRef, command.demoActorRef), 'OWNER_REQUIRED', '只有当前 owner 能提出交接。', 403);
      ownerCapable(state, payload.toActorRef);
      assert(Number.isInteger(state.acceptedGoalVersion) && Number.isInteger(state.currentContextVersion), 'HANDOFF_VERSIONS_REQUIRED', '交接前必须有 accepted goal 与 current context。', 409);
      const offer = { id: requiredString(payload.id, 'HANDOFF_ID_REQUIRED', 'handoff.id'), workCaseId: state.id, fromActorRef: clone(state.ownerActorRef), toActorRef: clone(payload.toActorRef), goalVersion: state.acceptedGoalVersion, contextVersion: state.currentContextVersion, package: clone(payload.package ?? {}), offeredAt: command.occurredAt, expiresAt: iso(payload.expiresAt, 'HANDOFF_EXPIRY_INVALID', 'expiresAt'), supersedesOfferId: payload.supersedesOfferId ?? null, status: 'offered' };
      assert(Date.parse(offer.expiresAt) > Date.parse(command.occurredAt), 'HANDOFF_EXPIRY_INVALID', 'handoff 必须在未来过期。');
      return [{ eventType: 'handoff.offered', payload: { offer } }];
    }
    case 'handoff.accept': {
      const offer = state.handoffOffers.find((item) => item.id === payload.offerId);
      assert(offer?.status === 'offered', 'HANDOFF_NOT_OPEN', 'handoff offer 不存在或已终结。', 409);
      assert(sameRef(offer.toActorRef, command.demoActorRef), 'HANDOFF_RECIPIENT_REQUIRED', '只有指定接收方能接受。', 403);
      assert(sameRef(offer.fromActorRef, state.ownerActorRef) && offer.goalVersion === state.acceptedGoalVersion && offer.contextVersion === state.currentContextVersion && Date.parse(command.occurredAt) < Date.parse(offer.expiresAt), 'HANDOFF_OFFER_STALE', 'owner、目标、上下文或有效期已变化，请重新提出交接。', 409);
      return [
        { eventType: 'handoff.accepted', payload: { acceptance: { id: payload.acceptanceId ?? `${offer.id}:acceptance`, offerId: offer.id, acceptedBy: clone(command.demoActorRef), acceptedAt: command.occurredAt, reason: requiredString(payload.reason, 'HANDOFF_REASON_REQUIRED', 'reason'), nextAction: requiredString(payload.nextAction, 'NEXT_ACTION_REQUIRED', 'nextAction') } } },
        { eventType: 'owner.changed', payload: { fromActorRef: clone(state.ownerActorRef), toActorRef: clone(offer.toActorRef), accountableHumanId: found.kind === 'human' ? found.id : found.accountableHumanId, offerId: offer.id, nextAction: payload.nextAction } },
      ];
    }
    case 'handoff.reject':
    case 'handoff.clarify': {
      const offer = state.handoffOffers.find((item) => item.id === payload.offerId);
      assert(offer?.status === 'offered', 'HANDOFF_NOT_OPEN', 'handoff offer 不存在或已终结。', 409);
      assert(sameRef(offer.toActorRef, command.demoActorRef), 'HANDOFF_RECIPIENT_REQUIRED', '只有指定接收方能拒绝或澄清。', 403);
      return [{ eventType: command.commandType === 'handoff.reject' ? 'handoff.rejected' : 'handoff.clarification_requested', payload: { offerId: offer.id, by: clone(command.demoActorRef), reason: requiredString(payload.reason, 'HANDOFF_REASON_REQUIRED', 'reason'), at: command.occurredAt } }];
    }
    case 'gate.open': {
      assert(state.actors.some((item) => item.kind === 'human' && item.id === payload.assignedHumanId), 'GATE_ASSIGNEE_INVALID', 'Gate 必须分配给具名 HumanPrincipal。');
      const gate = { id: requiredString(payload.id, 'GATE_ID_REQUIRED', 'gate.id'), workCaseId: state.id, policyId: requiredString(payload.policyId, 'GATE_POLICY_REQUIRED', 'policyId'), question: requiredString(payload.question, 'GATE_QUESTION_REQUIRED', 'question'), assignedHumanId: payload.assignedHumanId, protectedActions: requiredArray(payload.protectedActions, 'GATE_ACTIONS_REQUIRED', 'protectedActions'), evidenceIds: requiredArray(payload.evidenceIds ?? [], 'GATE_EVIDENCE_INVALID', 'evidenceIds'), status: 'open', openedAt: command.occurredAt, resolution: null };
      return [{ eventType: 'human_gate.opened', payload: { gate } }];
    }
    case 'gate.resolve': {
      assert(found.kind === 'human', 'HUMAN_PRINCIPAL_REQUIRED', 'RoutableAgent/provider/system 不能解决 Human Gate。', 403);
      const gate = state.humanGates.find((item) => item.id === payload.gateId);
      assert(gate?.status === 'open', 'GATE_NOT_OPEN', 'Human Gate 不存在或已终结。', 409);
      assert(gate.assignedHumanId === found.id, 'GATE_ASSIGNEE_REQUIRED', '只有具名 assignee 能解决 Gate。', 403);
      assert(['approved', 'rejected', 'revision_required', 'exception_approved', 'expired', 'cancelled'].includes(payload.decision), 'GATE_DECISION_INVALID', 'Gate decision 无效。');
      return [{ eventType: 'human_gate.resolved', payload: { gateId: gate.id, resolution: { decision: payload.decision, decidedBy: clone(command.demoActorRef), rationale: requiredString(payload.rationale, 'GATE_RATIONALE_REQUIRED', 'rationale'), evidenceIds: requiredArray(payload.evidenceIds ?? [], 'GATE_EVIDENCE_INVALID', 'evidenceIds'), decidedAt: command.occurredAt, nextAction: payload.nextAction ?? null } } }];
    }
    case 'action.propose': {
      assert(state.externalSystems.some((item) => item.id === payload.systemId), 'EXTERNAL_SYSTEM_NOT_FOUND', 'ExternalSystem 不存在。', 404);
      const intent = { id: requiredString(payload.id, 'ACTION_ID_REQUIRED', 'action.id'), workCaseId: state.id, systemId: payload.systemId, operation: requiredString(payload.operation, 'ACTION_OPERATION_REQUIRED', 'operation'), inputRef: clone(payload.inputRef), requestedBy: clone(command.demoActorRef), authorityEvidence: [], requiredGateIds: requiredArray(payload.requiredGateIds ?? [], 'ACTION_GATES_INVALID', 'requiredGateIds'), idempotencyKey: requiredString(payload.idempotencyKey, 'ACTION_IDEMPOTENCY_REQUIRED', 'action.idempotencyKey'), status: 'proposed', createdAt: command.occurredAt };
      return [{ eventType: 'action_intent.proposed', payload: { intent } }];
    }
    case 'action.authorize': {
      const intent = state.actionIntents.find((item) => item.id === payload.actionIntentId);
      assert(intent?.status === 'proposed', 'ACTION_NOT_PROPOSED', 'ActionIntent 不存在或状态不是 proposed。', 409);
      const capability = `system.write:${intent.systemId}:${intent.operation}`;
      assert(hasCapability(found, capability), 'CAPABILITY_DENIED', `actor 缺少 ${capability} capability。`, 403);
      const context = currentContext(state);
      assert(context?.allowedDecisionUses.includes('action.authorize'), 'CONTEXT_USE_DENIED', '当前 ContextVersion 未授权 action.authorize 用途。', 403);
      const blocking = state.humanGates.filter((gate) => gate.status === 'open' && (gate.protectedActions.includes('action.authorize') || intent.requiredGateIds.includes(gate.id)));
      assert(blocking.length === 0, 'GATE_BLOCKING', '开放 Human Gate 阻止 action.authorize。', 409, { gateIds: blocking.map((item) => item.id) });
      return [{ eventType: 'action_intent.authorized', payload: { actionIntentId: intent.id, authorizedBy: clone(command.demoActorRef), authorityEvidence: [activeGrant(state, command.demoActorRef, 'action.authorize', command.occurredAt).id], authorizedAt: command.occurredAt } }];
    }
    case 'action.execute': {
      const intent = state.actionIntents.find((item) => item.id === payload.actionIntentId);
      assert(intent?.status === 'authorized', 'ACTION_NOT_AUTHORIZED', '只有 authorized ActionIntent 可以执行。', 409);
      const receipt = clone(payload._connectorReceipt);
      assert(receipt && RECEIPT_STATUSES.has(receipt.status), 'EXECUTION_RECEIPT_INVALID', 'adapter 必须返回 succeeded/failed/unknown/rejected receipt。', 502);
      receipt.id = receipt.id ?? `${intent.id}:receipt:${state.executionReceipts.length + 1}`;
      receipt.actionIntentId = intent.id;
      return [
        { eventType: 'action_intent.execution_started', payload: { actionIntentId: intent.id, adapterId: receipt.adapterId, attemptedAt: receipt.attemptedAt } },
        { eventType: 'execution_receipt.recorded', payload: { receipt } },
      ];
    }
    case 'exception.open': {
      const exception = { id: requiredString(payload.id, 'EXCEPTION_ID_REQUIRED', 'exception.id'), workCaseId: state.id, type: requiredString(payload.type, 'EXCEPTION_TYPE_REQUIRED', 'exception.type'), severity: requiredString(payload.severity, 'EXCEPTION_SEVERITY_REQUIRED', 'exception.severity'), sourceRefs: requiredArray(payload.sourceRefs ?? [], 'EXCEPTION_REFS_INVALID', 'sourceRefs'), status: 'open', openedAt: command.occurredAt, resolution: null };
      return [{ eventType: 'exception.opened', payload: { exception } }];
    }
    case 'exception.acknowledge':
    case 'exception.resolve': {
      const exception = state.exceptions.find((item) => item.id === payload.exceptionId);
      assert(exception && (command.commandType === 'exception.acknowledge' ? exception.status === 'open' : ['open', 'acknowledged'].includes(exception.status)), 'EXCEPTION_STATE_INVALID', 'Exception 状态不允许该操作。', 409);
      return [{ eventType: command.commandType === 'exception.resolve' ? 'exception.resolved' : 'exception.acknowledged', payload: { exceptionId: exception.id, by: clone(command.demoActorRef), at: command.occurredAt, resolution: payload.resolution ?? null } }];
    }
    case 'escalation.offer': {
      assert(state.exceptions.some((item) => item.id === payload.exceptionId), 'EXCEPTION_NOT_FOUND', 'Escalation 必须关联 Exception。', 404);
      assert(state.actors.some((item) => item.kind === 'human' && item.id === payload.assignedHumanId), 'ESCALATION_ASSIGNEE_INVALID', 'Escalation 必须分配给具名 HumanPrincipal。');
      const escalation = { id: requiredString(payload.id, 'ESCALATION_ID_REQUIRED', 'escalation.id'), exceptionId: payload.exceptionId, assignedHumanId: payload.assignedHumanId, reason: requiredString(payload.reason, 'ESCALATION_REASON_REQUIRED', 'reason'), dueAt: iso(payload.dueAt, 'ESCALATION_DUE_INVALID', 'dueAt'), status: 'offered', acknowledgedAt: null, resolvedAt: null };
      return [{ eventType: 'escalation.offered', payload: { escalation } }];
    }
    case 'escalation.acknowledge': {
      assert(found.kind === 'human', 'HUMAN_PRINCIPAL_REQUIRED', '只有 HumanPrincipal 能确认 Escalation。', 403);
      const escalation = state.escalations.find((item) => item.id === payload.escalationId);
      assert(escalation?.status === 'offered' && escalation.assignedHumanId === found.id, 'ESCALATION_ASSIGNEE_REQUIRED', '只有具名 recipient 能确认 Escalation。', 403);
      return [{ eventType: 'escalation.acknowledged', payload: { escalationId: escalation.id, acknowledgedBy: clone(command.demoActorRef), acknowledgedAt: command.occurredAt } }];
    }
    case 'metric.observe': {
      assert(METRIC_CATEGORIES.has(payload.category), 'METRIC_CATEGORY_INVALID', 'Metric category 必须是 business/risk/efficiency。');
      const observation = { id: requiredString(payload.id, 'METRIC_ID_REQUIRED', 'metric.id'), workCaseId: state.id, metricKey: requiredString(payload.metricKey, 'METRIC_KEY_REQUIRED', 'metricKey'), category: payload.category, value: payload.value, unit: requiredString(payload.unit, 'METRIC_UNIT_REQUIRED', 'unit'), sourceRef: clone(payload.sourceRef), observedAt: iso(payload.observedAt ?? command.occurredAt, 'METRIC_TIME_INVALID', 'observedAt'), window: clone(payload.window ?? null), definitionVersion: payload.definitionVersion ?? 1 };
      return [{ eventType: 'metric.observed', payload: { observation } }];
    }
    case 'workCase.block':
      assert(state.humanGates.some((item) => item.status === 'open') || state.exceptions.some((item) => ['open', 'acknowledged'].includes(item.status)) || state.escalations.some((item) => ['offered', 'acknowledged'].includes(item.status)), 'BLOCKER_REQUIRED', 'blocked 需要开放 Gate/Exception/Escalation。', 409);
      return [{ eventType: 'work_case.blocked', payload: { reason: requiredString(payload.reason, 'REASON_REQUIRED', 'reason') } }];
    case 'workCase.complete':
      assert(requiredArray(payload.resultEvidenceIds, 'RESULT_EVIDENCE_REQUIRED', 'resultEvidenceIds').every((id) => state.evidence.some((item) => item.id === id)), 'RESULT_EVIDENCE_NOT_FOUND', '完成所需 evidence 不存在。');
      assert(!state.actionIntents.some((item) => ['authorized', 'executing', 'unknown'].includes(item.status)), 'ACTION_RECEIPT_UNRESOLVED', '存在未解决或 unknown 的 ActionIntent，不能假定外部动作成功。', 409);
      assert(requiredArray(payload.succeededActionIds ?? [], 'ACTION_SUCCESS_ASSERTION_INVALID', 'succeededActionIds').every((id) => state.actionIntents.some((item) => item.id === id && item.status === 'succeeded')), 'ACTION_SUCCESS_ASSERTION_INVALID', '只有 succeeded receipt 可以被声明为外部动作成功。', 409);
      return [{ eventType: 'work_case.completed', payload: { resultEvidenceIds: clone(payload.resultEvidenceIds), succeededActionIds: clone(payload.succeededActionIds ?? []) } }];
    case 'workCase.close':
      assert(state.status === 'completed' && !state.humanGates.some((item) => item.status === 'open') && new Set(state.metricObservations.map((item) => item.category)).size === 3, 'WORK_CASE_CLOSE_BLOCKED', 'close 需要 completed、无开放 Gate 且三类指标齐全。', 409);
      return [{ eventType: 'work_case.closed', payload: { closedAt: command.occurredAt } }];
    case 'workCase.cancel':
      assert(found.kind === 'human', 'HUMAN_PRINCIPAL_REQUIRED', '取消必须由具名 HumanPrincipal 决定。', 403);
      return [{ eventType: 'work_case.cancelled', payload: { reason: requiredString(payload.reason, 'REASON_REQUIRED', 'reason'), cancelledAt: command.occurredAt, cancelledBy: clone(command.demoActorRef) } }];
    default:
      assert(false, 'COMMAND_TYPE_UNSUPPORTED', `P2 不支持 commandType ${command.commandType}。`, 400);
  }
}

export function applyBusinessEvent(previousState, event) {
  assert(event.eventSchemaVersion === 1, 'EVENT_SCHEMA_UNKNOWN', `未知 event schema ${event.eventSchemaVersion}。`, 500);
  let state = previousState === null ? null : clone(previousState);
  const payload = event.payload;
  switch (event.eventType) {
    case 'work_case.created':
      assert(state === null, 'EVENT_TRANSITION_INVALID', 'work_case.created 只能应用到空 state。', 500);
      state = { ...clone(payload.workCase), actors: clone(payload.actors), externalSystems: clone(payload.externalSystems), controlObjects: clone(payload.controlObjects), authorityGrants: clone(payload.authorityGrants), triggers: [clone(payload.trigger)], goalVersions: [], evidence: [], contextVersions: [], handoffOffers: [], handoffAcceptances: [], humanGates: [], actionIntents: [], executionReceipts: [], exceptions: [], escalations: [], metricObservations: [] };
      break;
    case 'goal.proposed': state.goalVersions.push(clone(payload.goal)); break;
    case 'goal.accepted': {
      for (const goal of state.goalVersions) {
        if (goal.version === payload.supersededVersion) goal.status = 'superseded';
        if (goal.id === payload.goalId) Object.assign(goal, { status: 'accepted', acceptedBy: clone(payload.acceptedBy), acceptedAt: payload.acceptedAt });
      }
      state.acceptedGoalVersion = payload.version;
      break;
    }
    case 'evidence.attached': state.evidence.push(clone(payload.evidence)); break;
    case 'context.published': state.contextVersions.push(clone(payload.context)); state.currentContextVersion = payload.context.version; break;
    case 'authority.granted': state.authorityGrants.push(clone(payload.grant)); break;
    case 'handoff.offered': state.handoffOffers.push(clone(payload.offer)); break;
    case 'handoff.rejected':
    case 'handoff.clarification_requested': {
      const offer = state.handoffOffers.find((item) => item.id === payload.offerId);
      assert(offer?.status === 'offered', 'EVENT_TRANSITION_INVALID', 'handoff 终结状态无效。', 500);
      offer.status = event.eventType === 'handoff.rejected' ? 'rejected' : 'clarification_requested';
      offer.resolution = clone(payload);
      break;
    }
    case 'handoff.accepted': {
      const offer = state.handoffOffers.find((item) => item.id === payload.acceptance.offerId);
      assert(offer?.status === 'offered', 'EVENT_TRANSITION_INVALID', 'handoff acceptance 无开放 offer。', 500);
      offer.status = 'accepted';
      state.handoffAcceptances.push(clone(payload.acceptance));
      break;
    }
    case 'owner.changed': state.ownerActorRef = clone(payload.toActorRef); state.accountableHumanId = payload.accountableHumanId; state.nextAction = payload.nextAction; break;
    case 'human_gate.opened': state.humanGates.push(clone(payload.gate)); break;
    case 'human_gate.resolved': {
      const gate = state.humanGates.find((item) => item.id === payload.gateId);
      assert(gate?.status === 'open', 'EVENT_TRANSITION_INVALID', 'Gate resolution 无开放 Gate。', 500);
      gate.status = payload.resolution.decision;
      gate.resolution = clone(payload.resolution);
      break;
    }
    case 'action_intent.proposed': state.actionIntents.push(clone(payload.intent)); break;
    case 'action_intent.authorized': {
      const intent = state.actionIntents.find((item) => item.id === payload.actionIntentId);
      assert(intent?.status === 'proposed', 'EVENT_TRANSITION_INVALID', 'Action authorization 状态无效。', 500);
      intent.status = 'authorized'; intent.authorityEvidence = clone(payload.authorityEvidence); intent.authorizedBy = clone(payload.authorizedBy); intent.authorizedAt = payload.authorizedAt;
      break;
    }
    case 'action_intent.execution_started': {
      const intent = state.actionIntents.find((item) => item.id === payload.actionIntentId);
      assert(intent?.status === 'authorized', 'EVENT_TRANSITION_INVALID', 'Action execution start 状态无效。', 500);
      intent.status = 'executing'; intent.adapterId = payload.adapterId; intent.executionAttemptedAt = payload.attemptedAt;
      break;
    }
    case 'execution_receipt.recorded': {
      const intent = state.actionIntents.find((item) => item.id === payload.receipt.actionIntentId);
      assert(intent?.status === 'executing', 'EVENT_TRANSITION_INVALID', 'receipt 没有 executing ActionIntent。', 500);
      state.executionReceipts.push(clone(payload.receipt));
      intent.status = payload.receipt.status;
      break;
    }
    case 'exception.opened': state.exceptions.push(clone(payload.exception)); break;
    case 'exception.acknowledged': {
      const item = state.exceptions.find((entry) => entry.id === payload.exceptionId); assert(item, 'EVENT_TRANSITION_INVALID', 'Exception 不存在。', 500); item.status = 'acknowledged'; item.acknowledgement = clone(payload); break;
    }
    case 'exception.resolved': {
      const item = state.exceptions.find((entry) => entry.id === payload.exceptionId); assert(item, 'EVENT_TRANSITION_INVALID', 'Exception 不存在。', 500); item.status = 'resolved'; item.resolution = clone(payload); break;
    }
    case 'escalation.offered': state.escalations.push(clone(payload.escalation)); break;
    case 'escalation.acknowledged': {
      const item = state.escalations.find((entry) => entry.id === payload.escalationId); assert(item?.status === 'offered', 'EVENT_TRANSITION_INVALID', 'Escalation 状态无效。', 500); item.status = 'acknowledged'; item.acknowledgedAt = payload.acknowledgedAt; break;
    }
    case 'metric.observed': state.metricObservations.push(clone(payload.observation)); break;
    case 'work_case.blocked': state.status = 'blocked'; break;
    case 'work_case.completed': state.status = 'completed'; state.resultEvidenceIds = clone(payload.resultEvidenceIds); break;
    case 'work_case.closed': state.status = 'closed'; state.closedAt = payload.closedAt; break;
    case 'work_case.cancelled': state.status = 'cancelled'; state.cancelled = clone(payload); break;
    default:
      assert(false, 'EVENT_TYPE_UNKNOWN', `未知 event type ${event.eventType}。`, 500);
  }
  state.streamVersion = event.streamVersion;
  return state;
}

export function replayEvents(events) {
  let state = null;
  let expectedVersion = 1;
  for (const event of events) {
    assert(event.streamVersion === expectedVersion, 'EVENT_SEQUENCE_CORRUPT', 'event streamVersion 断号。', 500);
    state = applyBusinessEvent(state, event);
    expectedVersion += 1;
  }
  return state;
}
