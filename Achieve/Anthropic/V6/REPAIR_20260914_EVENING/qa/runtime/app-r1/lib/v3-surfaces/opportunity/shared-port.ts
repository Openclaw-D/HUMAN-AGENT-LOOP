import {
  V3_SHARED_DEMO_CASES,
  V3_SHARED_PORTFOLIO,
  V3_SHARED_SCENARIO_REF,
} from '../shared/demo-fixtures.ts';
import { getV3RolePolicy } from '../shared/role-policies.ts';
import type {
  V3ContextReadModel,
  V3ContextSelector,
  V3PersistedMessage,
  V3RolePolicy,
  V3RoleProjectionId,
  V3SendMessageResult,
} from '../shared/contracts.ts';
import {
  getV3SharedRuntime,
  type createV3SharedRuntime,
} from '../../v3-runtime/index.ts';
import type { OpportunitySession } from './types.ts';

type SharedRuntime = ReturnType<typeof createV3SharedRuntime>;
export type OpportunitySharedCase = (typeof V3_SHARED_DEMO_CASES)[number];

export type OpportunitySharedPort = {
  scenarioRef: typeof V3_SHARED_SCENARIO_REF;
  portfolioId: typeof V3_SHARED_PORTFOLIO.portfolioId;
  getRuntimeEpoch(): string;
  listCases(): OpportunitySharedCase[];
  resolveContext(selector: V3ContextSelector): V3ContextReadModel;
  listMessages(contextId: string): V3PersistedMessage[];
  getRolePolicy(role: V3RoleProjectionId): V3RolePolicy;
  sendMessage(input: {
    requestId: string;
    actorRole: V3RoleProjectionId;
    context: V3ContextSelector;
    text: string;
  }): Promise<V3SendMessageResult>;
};

export function opportunityRoleForSession(session: OpportunitySession): V3RoleProjectionId {
  if (session.roleApplicationId === 'leadership') return 'leadership';
  if (session.roleApplicationId === 'business') return 'business';
  if (session.roleApplicationId === 'risk') {
    const role = session.principalId.replace('risk-', '');
    if (role === 'policy' || role === 'credit' || role === 'commercial' || role === 'asset') return role;
  }
  if (session.roleApplicationId === 'external') {
    if (session.principalId === 'external-customer') return 'customer';
    if (session.principalId === 'external-supplier') return 'supplier';
  }
  throw Object.assign(new Error('商机角色投影无效'), { code: 'INVALID_OPPORTUNITY_ROLE' });
}

export function createOpportunitySharedPort(runtime: SharedRuntime): OpportunitySharedPort {
  return {
    scenarioRef: V3_SHARED_SCENARIO_REF,
    portfolioId: V3_SHARED_PORTFOLIO.portfolioId,
    getRuntimeEpoch: () => runtime.store.getRuntimeEpoch(),
    listCases: () => runtime.store.listCases(),
    resolveContext: (selector) => runtime.store.resolveContext(selector),
    listMessages: (contextId) => runtime.store.listMessages(contextId),
    getRolePolicy: getV3RolePolicy,
    sendMessage: (input) => runtime.sendMessage(input),
  };
}

export function getOpportunitySharedPort(): OpportunitySharedPort {
  return createOpportunitySharedPort(getV3SharedRuntime());
}
