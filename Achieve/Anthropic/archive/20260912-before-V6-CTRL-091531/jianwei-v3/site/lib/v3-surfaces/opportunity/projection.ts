import {
  createSurfaceEmpty,
  createSurfaceError,
  createSurfaceLoading,
  createSurfaceReady,
  V3_BUSINESS_COORDINATION_ACTIONS,
  type V3ProfessionalRole,
  type V3SurfaceError,
} from '../shared/contracts.ts';
import {
  opportunityRoleForSession,
  getOpportunitySharedPort,
  type OpportunitySharedCase,
  type OpportunitySharedPort,
} from './shared-port.ts';
import type {
  OpportunityApiState,
  OpportunityNumericObservation,
  OpportunityOrchestrationAction,
  OpportunityReadModel,
  OpportunityRelationshipEdge,
  OpportunityRelationshipNode,
  OpportunityResponsibilityEntry,
  OpportunitySession,
  OpportunitySharedChatContext,
} from './types.ts';

export const OPPORTUNITY_BUSINESS_ACTIONS = Object.freeze(
  V3_BUSINESS_COORDINATION_ACTIONS.filter((action): action is OpportunityOrchestrationAction => action !== 'chat'),
);

const PROFESSIONAL_ROLES = Object.freeze([
  'policy',
  'credit',
  'commercial',
  'asset',
] satisfies V3ProfessionalRole[]);

const NODE_ORDER = new Map([
  ['customer', 0],
  ['opportunity', 1],
  ['supplier', 2],
  ['case', 3],
]);

function failure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function unavailableCompleteness(): OpportunityNumericObservation {
  return {
    availability: 'unavailable',
    value: null,
    display: '未提供',
    unit: 'evidence-coverage-band',
    valueClass: null,
    source: null,
    provenance: [],
    asOf: null,
  };
}

function opportunityIdForCase(caseId: string): string {
  return `OPP-${caseId}`;
}

function caseIdForOpportunity(opportunityId: string): string {
  if (!/^OPP-FL-(?:DEMO|BG)-\d{3}$/.test(opportunityId)) {
    throw failure('OPPORTUNITY_NOT_FOUND', '商机不存在');
  }
  return opportunityId.slice(4);
}

export function opportunityContextSelector(
  caseItem: OpportunitySharedCase,
  port: OpportunitySharedPort,
) {
  return {
    grain: 'case' as const,
    portfolioId: port.portfolioId,
    divisionId: caseItem.divisionId,
    caseId: caseItem.caseId,
  };
}

function relationshipGraph(caseItem: OpportunitySharedCase) {
  const opportunityId = opportunityIdForCase(caseItem.caseId);
  const customerNodeId = `CUSTOMER-${caseItem.caseId}`;
  const supplierNodeId = `SUPPLIER-${caseItem.caseId}`;
  const caseNodeId = `CASE-${caseItem.caseId}`;
  const sourceRef = `shared-case:${caseItem.caseId}`;
  const nodes = ([
    {
      nodeId: customerNodeId,
      kind: 'customer',
      label: '未提供',
      availability: 'unavailable',
      sourceRef,
    },
    {
      nodeId: opportunityId,
      kind: 'opportunity',
      label: `${caseItem.label}·商机`,
      availability: 'available',
      sourceRef,
    },
    {
      nodeId: supplierNodeId,
      kind: 'supplier',
      label: '未提供',
      availability: 'unavailable',
      sourceRef,
    },
    {
      nodeId: caseNodeId,
      kind: 'case',
      label: caseItem.label,
      availability: 'available',
      sourceRef,
    },
  ] satisfies OpportunityRelationshipNode[]).sort(
    (left, right) => (NODE_ORDER.get(left.kind) ?? 99) - (NODE_ORDER.get(right.kind) ?? 99),
  );
  const edges = ([
    {
      edgeId: `${opportunityId}->${caseNodeId}`,
      fromNodeId: opportunityId,
      toNodeId: caseNodeId,
      relationship: 'opens_case',
      sourceRef,
    },
  ] satisfies OpportunityRelationshipEdge[]).sort(
    (left, right) => left.edgeId.localeCompare(right.edgeId, 'en'),
  );
  return {
    nodes,
    edges,
    unavailableRelationships: ['customer', 'supplier'] as Array<'customer' | 'supplier'>,
  };
}

function responsibilityMatrix(port: OpportunitySharedPort): OpportunityResponsibilityEntry[] {
  const business = port.getRolePolicy('business');
  if (business.canConfirmProfessionalGate) {
    throw failure('SHARED_ROLE_CONTRACT_VIOLATION', '业务不得获得专业 Gate 权限');
  }
  return [
    { role: 'business', responsibility: 'orchestrates', canSubmitProfessionalGate: false },
    ...PROFESSIONAL_ROLES.map((role) => {
      const policy = port.getRolePolicy(role);
      if (!policy.canConfirmProfessionalGate || policy.professionalGateRole !== role) {
        throw failure('SHARED_ROLE_CONTRACT_VIOLATION', '专业 Gate 角色契约缺失');
      }
      return {
        role,
        responsibility: 'professional-judgment' as const,
        canSubmitProfessionalGate: true,
      };
    }),
  ];
}

export function opportunityChatContext(input: {
  contextId: string;
  contextVersion: string;
  port: OpportunitySharedPort;
}): OpportunitySharedChatContext {
  const messages = input.port.listMessages(input.contextId)
    .map((message) => structuredClone(message))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt, 'en') || left.messageId.localeCompare(right.messageId, 'en'));
  if (messages.some((message) => message.authority !== 'none' || message.contextVersion !== input.contextVersion)) {
    throw failure('SHARED_CHAT_CONTRACT_VIOLATION', '共享群聊消息契约验证失败');
  }
  return {
    availability: 'available',
    contextId: input.contextId,
    contextVersion: input.contextVersion,
    messages,
    source: 'shared-v3-sqlite-chat',
  };
}

export function authorizeOpportunityBusinessAction(input: {
  actorRole: 'business' | V3ProfessionalRole;
  action: OpportunityOrchestrationAction | 'professional_review' | 'professional_gate';
}): { allowed: true; authority: 'orchestration-only' } {
  if (input.actorRole !== 'business') {
    throw failure('OPPORTUNITY_ACTION_DENIED', '仅业务 Case Owner 可组织商机协同');
  }
  if (!OPPORTUNITY_BUSINESS_ACTIONS.includes(input.action as OpportunityOrchestrationAction)) {
    throw failure('PROFESSIONAL_AUTHORITY_DENIED', '业务不得代替专业人审或 Gate');
  }
  return { allowed: true, authority: 'orchestration-only' };
}

export function buildOpportunityReadModel(
  session: OpportunitySession,
  opportunityId: string,
  port: OpportunitySharedPort = getOpportunitySharedPort(),
): OpportunityReadModel {
  const caseId = caseIdForOpportunity(opportunityId);
  const caseItem = port.listCases().find((item) => item.caseId === caseId);
  if (!caseItem) throw failure('OPPORTUNITY_NOT_FOUND', '商机不存在');
  if (session.roleApplicationId === 'external' && session.invitation?.caseId !== caseId) {
    throw failure('CONTEXT_SCOPE_DENIED', '外联邀请不覆盖当前商机');
  }
  const role = opportunityRoleForSession(session);
  const policy = port.getRolePolicy(role);
  if (!policy.visibleGrains.includes('case')) throw failure('CONTEXT_SCOPE_DENIED', '当前角色不可读取 Opportunity');
  const context = port.resolveContext(opportunityContextSelector(caseItem, port));
  if (context.caseId !== caseItem.caseId || context.scenarioRef.scenarioId !== port.scenarioRef.scenarioId) {
    throw failure('SHARED_PROJECTION_CONTRACT_VIOLATION', '共享上下文与 Opportunity 主键不一致');
  }
  const chatContext = opportunityChatContext({
    contextId: context.contextId,
    contextVersion: context.contextVersion,
    port,
  });
  const latestMessageId = chatContext.messages.at(-1)?.messageId ?? 'no-message';
  return {
    projectionType: 'OpportunityReadModel',
    projectionVersion: `${port.getRuntimeEpoch()}:${context.contextVersion}:${latestMessageId}`,
    grain: 'Opportunity',
    opportunityId,
    caseId,
    caseTier: caseItem.caseTier,
    readOnly: caseItem.readOnly,
    scenarioRef: structuredClone(context.scenarioRef),
    title: caseItem.label,
    stage: caseItem.phase,
    nextAction: '未提供',
    relationships: relationshipGraph(caseItem),
    materials: {
      items: [],
      completeness: unavailableCompleteness(),
      emptyDisplay: '未提供',
    },
    responsibilityMatrix: responsibilityMatrix(port),
    allowedBusinessActions: [...OPPORTUNITY_BUSINESS_ACTIONS],
    forbiddenBusinessActions: ['professional_review', 'professional_gate'],
    chatContext,
  };
}

export function opportunityLoadingState<T>(): OpportunityApiState<T> {
  return createSurfaceLoading<T>();
}

export function opportunityReadyState<T>(data: T): OpportunityApiState<T> {
  return createSurfaceReady(data);
}

export function opportunityEmptyState<T>(reason = '未提供'): OpportunityApiState<T> {
  return createSurfaceEmpty<T>(reason);
}

export function opportunityErrorState<T>(error: unknown): OpportunityApiState<T> {
  const normalized: V3SurfaceError = {
    code: error && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : 'OPPORTUNITY_UNAVAILABLE',
    message: error instanceof Error ? error.message : '商机投影暂不可用',
    retryable: false,
  };
  return createSurfaceError<T>(normalized);
}
