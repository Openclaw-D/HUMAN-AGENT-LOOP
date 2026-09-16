import {
  V3_BUSINESS_COORDINATION_ACTIONS,
  type V3ProfessionalRole,
  type V3PersistedMessage,
  type V3RolePolicy,
  type V3RoleProjectionId,
} from './contracts.ts';

type ProjectableReceipt = {
  receiptType: string;
  formal: boolean;
  payload: Record<string, unknown>;
};

const PROFESSIONAL_ROLES: ReadonlySet<V3RoleProjectionId> = new Set([
  'policy',
  'credit',
  'commercial',
  'asset',
]);

const ROLE_POLICIES: Record<V3RoleProjectionId, Readonly<V3RolePolicy>> = {
  leadership: {
    role: 'leadership',
    defaultGrain: 'portfolio',
    visibleGrains: ['portfolio', 'division', 'case'],
    coordinationActions: ['view', 'drill_down', 'chat'],
    canConfirmProfessionalGate: false,
    professionalGateRole: null,
  },
  business: {
    role: 'business',
    defaultGrain: 'case',
    visibleGrains: ['portfolio', 'division', 'case'],
    coordinationActions: [...V3_BUSINESS_COORDINATION_ACTIONS],
    canConfirmProfessionalGate: false,
    professionalGateRole: null,
  },
  policy: professionalPolicy('policy'),
  credit: professionalPolicy('credit'),
  commercial: professionalPolicy('commercial'),
  asset: professionalPolicy('asset'),
  customer: externalPolicy('customer'),
  supplier: externalPolicy('supplier'),
};

function professionalPolicy(role: V3ProfessionalRole): V3RolePolicy {
  return {
    role,
    defaultGrain: 'case',
    visibleGrains: ['case'],
    coordinationActions: ['view', 'chat'],
    canConfirmProfessionalGate: true,
    professionalGateRole: role,
  };
}

function externalPolicy(role: 'customer' | 'supplier'): V3RolePolicy {
  return {
    role,
    defaultGrain: 'case',
    visibleGrains: ['case'],
    coordinationActions: ['view', 'chat', 'supplement'],
    canConfirmProfessionalGate: false,
    professionalGateRole: null,
  };
}

export function isV3RoleProjectionId(value: unknown): value is V3RoleProjectionId {
  return typeof value === 'string' && Object.hasOwn(ROLE_POLICIES, value);
}

export function isV3ProfessionalRole(value: unknown): value is V3ProfessionalRole {
  return isV3RoleProjectionId(value) && PROFESSIONAL_ROLES.has(value);
}

export function getV3RolePolicy(role: V3RoleProjectionId): V3RolePolicy {
  return structuredClone(ROLE_POLICIES[role]);
}

export function assertV3ProfessionalGateScope(
  actorRole: V3RoleProjectionId,
  gateRole: V3ProfessionalRole,
): void {
  const policy = ROLE_POLICIES[actorRole];
  if (!policy.canConfirmProfessionalGate || policy.professionalGateRole !== gateRole) {
    throw Object.assign(new Error('业务或其他角色不能替代专业人审 Gate'), {
      code: 'PROFESSIONAL_GATE_SCOPE_DENIED',
    });
  }
}

export function projectV3SharedConversation<TReceipt extends ProjectableReceipt>(
  role: V3RoleProjectionId,
  allMessages: V3PersistedMessage[],
  allReceipts: TReceipt[],
): { messages: V3PersistedMessage[]; receipts: TReceipt[] } {
  let messages = allMessages;
  if (role === 'customer' || role === 'supplier') {
    const mention = role === 'customer' ? '@客户' : '@供应商';
    const visibleIds = new Set(allMessages.filter((message) =>
      message.actorRole === role || (message.actorRole === 'business' && message.text.includes(mention)))
      .map((message) => message.messageId));
    for (const message of allMessages) {
      if (message.replyToMessageId && visibleIds.has(message.replyToMessageId)) visibleIds.add(message.messageId);
    }
    messages = allMessages.filter((message) => visibleIds.has(message.messageId));
  }
  const visibleMessageIds = new Set(messages.map((message) => message.messageId));
  const receipts = allReceipts.filter((receipt) => {
    if (role === 'customer' || role === 'supplier') {
      return !receipt.formal && typeof receipt.payload.messageId === 'string' && visibleMessageIds.has(receipt.payload.messageId);
    }
    if (role === 'policy' || role === 'credit' || role === 'commercial' || role === 'asset') {
      return !receipt.formal || (receipt.receiptType === 'human_gate' && receipt.payload.processId === role);
    }
    return true;
  });
  return { messages: structuredClone(messages), receipts: structuredClone(receipts) };
}

export function assertV3ExternalInvitationScope(
  role: V3RoleProjectionId,
  invitedCaseId: string | null | undefined,
  requestedCaseId: string | null,
): void {
  if ((role === 'customer' || role === 'supplier') && invitedCaseId !== requestedCaseId) {
    throw Object.assign(new Error('外部主体只能访问邀请范围'), { code: 'INVITATION_SCOPE_DENIED' });
  }
}
