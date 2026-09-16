export type V3RoleApplicationId = 'leadership' | 'business' | 'risk' | 'external';
export type V3ProcessId = 'opportunity' | 'policy' | 'credit' | 'commercial' | 'asset';
export type V3CanonicalPrincipalId =
  | 'collaboration-manager'
  | 'business-owner'
  | 'risk-policy'
  | 'risk-credit'
  | 'risk-commercial'
  | 'risk-asset'
  | 'external-customer'
  | 'external-supplier';
export type V3PrincipalId = V3CanonicalPrincipalId | 'leadership-observer';
export type V3ActionType =
  | 'chat'
  | 'submit_evidence'
  | 'confirm_fact'
  | 'professional_gate'
  | 'management_action'
  | 'commencement_action'
  | 'view_replay';

export type V3PrincipalPolicy = {
  principalId: V3CanonicalPrincipalId;
  roleApplicationId: V3RoleApplicationId;
  visibleProcessIds: Array<V3ProcessId>;
  professionalGateProcessIds: Array<V3ProcessId>;
  allowedActionTypes: Array<V3ActionType>;
  requiresInvitation: boolean;
};

export type V3InvitationScope = {
  invitationId: string;
  caseId: string;
  principalId: 'external-customer' | 'external-supplier';
  workstepProcessId: V3ProcessId;
  allowedActionTypes: Array<'chat' | 'submit_evidence' | 'confirm_fact'>;
  status: 'active' | 'expired' | 'revoked' | 'completed';
  expiresAt?: string;
};

export type V3ActionAuthorizationInput = {
  caseId: string;
  caseTier: 'golden' | 'background';
  roleApplicationId: V3RoleApplicationId;
  principalId: V3PrincipalId;
  actionType: V3ActionType;
  processId?: V3ProcessId;
  invitation?: V3InvitationScope;
  now?: string;
};

export type V3ActionAuthorization = {
  allowed: true;
  canonicalPrincipalId: V3CanonicalPrincipalId;
  roleApplicationId: V3RoleApplicationId;
  actionType: V3ActionType;
  processId: V3ProcessId | null;
  invitationId: string | null;
};

const PROCESS_IDS: ReadonlySet<V3ProcessId> = new Set([
  'opportunity',
  'policy',
  'credit',
  'commercial',
  'asset',
]);

const POLICIES: Record<V3CanonicalPrincipalId, Readonly<V3PrincipalPolicy>> = {
  'collaboration-manager': {
    principalId: 'collaboration-manager',
    roleApplicationId: 'leadership',
    visibleProcessIds: ['opportunity', 'policy', 'credit', 'commercial', 'asset'],
    professionalGateProcessIds: [],
    allowedActionTypes: ['chat', 'management_action', 'view_replay'],
    requiresInvitation: false,
  },
  'business-owner': {
    principalId: 'business-owner',
    roleApplicationId: 'business',
    visibleProcessIds: ['opportunity', 'policy', 'credit', 'commercial', 'asset'],
    professionalGateProcessIds: [],
    allowedActionTypes: ['chat', 'submit_evidence', 'confirm_fact', 'view_replay'],
    requiresInvitation: false,
  },
  'risk-policy': {
    principalId: 'risk-policy',
    roleApplicationId: 'risk',
    visibleProcessIds: ['opportunity', 'policy', 'credit', 'commercial', 'asset'],
    professionalGateProcessIds: ['policy'],
    allowedActionTypes: ['chat', 'professional_gate', 'view_replay'],
    requiresInvitation: false,
  },
  'risk-credit': {
    principalId: 'risk-credit',
    roleApplicationId: 'risk',
    visibleProcessIds: ['opportunity', 'policy', 'credit', 'commercial', 'asset'],
    professionalGateProcessIds: ['credit'],
    allowedActionTypes: ['chat', 'professional_gate', 'view_replay'],
    requiresInvitation: false,
  },
  'risk-commercial': {
    principalId: 'risk-commercial',
    roleApplicationId: 'risk',
    visibleProcessIds: ['opportunity', 'policy', 'credit', 'commercial', 'asset'],
    professionalGateProcessIds: ['commercial'],
    allowedActionTypes: ['chat', 'professional_gate', 'commencement_action', 'view_replay'],
    requiresInvitation: false,
  },
  'risk-asset': {
    principalId: 'risk-asset',
    roleApplicationId: 'risk',
    visibleProcessIds: ['opportunity', 'policy', 'credit', 'commercial', 'asset'],
    professionalGateProcessIds: ['asset'],
    allowedActionTypes: ['chat', 'professional_gate', 'view_replay'],
    requiresInvitation: false,
  },
  'external-customer': {
    principalId: 'external-customer',
    roleApplicationId: 'external',
    visibleProcessIds: ['opportunity'],
    professionalGateProcessIds: [],
    allowedActionTypes: ['chat', 'submit_evidence', 'confirm_fact'],
    requiresInvitation: true,
  },
  'external-supplier': {
    principalId: 'external-supplier',
    roleApplicationId: 'external',
    visibleProcessIds: ['commercial'],
    professionalGateProcessIds: [],
    allowedActionTypes: ['chat', 'submit_evidence', 'confirm_fact'],
    requiresInvitation: true,
  },
};

function failure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clonePolicy(policy: Readonly<V3PrincipalPolicy>): V3PrincipalPolicy {
  return {
    ...policy,
    visibleProcessIds: [...policy.visibleProcessIds],
    professionalGateProcessIds: [...policy.professionalGateProcessIds],
    allowedActionTypes: [...policy.allowedActionTypes],
  };
}

export function normalizeV3PrincipalId(value: unknown): V3CanonicalPrincipalId {
  const principalId = trimmed(value);
  if (principalId === 'leadership-observer') return 'collaboration-manager';
  if (!Object.hasOwn(POLICIES, principalId)) {
    throw failure('UNKNOWN_PRINCIPAL', '未知协同主体');
  }
  return principalId as V3CanonicalPrincipalId;
}

export function getV3PrincipalPolicy(value: unknown): V3PrincipalPolicy {
  return clonePolicy(POLICIES[normalizeV3PrincipalId(value)]);
}

function validateInvitation(
  invitation: V3InvitationScope | undefined,
  policy: V3PrincipalPolicy,
  input: V3ActionAuthorizationInput,
): V3InvitationScope {
  if (!invitation) throw failure('INVITATION_REQUIRED', '外联操作需要有效邀请');
  if (invitation.status === 'expired') throw failure('INVITATION_EXPIRED', '邀请已过期');
  if (invitation.status !== 'active') throw failure('INVITATION_SCOPE_DENIED', '邀请不可用于当前操作');
  if (
    invitation.caseId !== input.caseId ||
    invitation.principalId !== policy.principalId ||
    !invitation.allowedActionTypes.includes(
      input.actionType as 'chat' | 'submit_evidence' | 'confirm_fact',
    ) ||
    input.processId === undefined ||
    invitation.workstepProcessId !== input.processId
  ) {
    throw failure('INVITATION_SCOPE_DENIED', '邀请不覆盖当前事项或动作');
  }
  if (invitation.expiresAt !== undefined) {
    const expiresAt = Date.parse(invitation.expiresAt);
    const now = Date.parse(input.now ?? new Date().toISOString());
    if (Number.isNaN(expiresAt) || Number.isNaN(now)) {
      throw failure('INVALID_INPUT', '邀请时间无效');
    }
    if (expiresAt <= now) throw failure('INVITATION_EXPIRED', '邀请已过期');
  }
  return invitation;
}

export function authorizeV3Action(input: V3ActionAuthorizationInput): V3ActionAuthorization {
  if (!input || typeof input !== 'object') throw failure('INVALID_INPUT', '权限请求无效');
  const caseId = trimmed(input.caseId);
  if (!caseId) throw failure('INVALID_INPUT', 'caseId 无效');
  const policy = getV3PrincipalPolicy(input.principalId);
  if (policy.roleApplicationId !== input.roleApplicationId) {
    throw failure('ROLE_PRINCIPAL_MISMATCH', '角色应用与主体不匹配');
  }
  if (input.caseTier === 'background') {
    throw failure('BACKGROUND_CASE_READ_ONLY', '背景事项只允许读取摘要');
  }
  if (!policy.allowedActionTypes.includes(input.actionType)) {
    throw failure('ACTION_SCOPE_DENIED', '主体无权执行当前动作');
  }
  if (input.processId !== undefined && !PROCESS_IDS.has(input.processId)) {
    throw failure('INVALID_INPUT', 'processId 无效');
  }
  if (input.actionType === 'professional_gate') {
    if (
      input.processId === undefined ||
      !policy.professionalGateProcessIds.includes(input.processId)
    ) {
      throw failure('PROCESS_SCOPE_DENIED', '主体无权确认当前专业 Gate');
    }
  }
  if (input.actionType === 'commencement_action' && input.processId !== 'commercial') {
    throw failure('PROCESS_SCOPE_DENIED', '正式起租只能由商务专业提交');
  }
  const invitation = policy.requiresInvitation
    ? validateInvitation(input.invitation, policy, input)
    : undefined;

  return {
    allowed: true,
    canonicalPrincipalId: policy.principalId,
    roleApplicationId: policy.roleApplicationId,
    actionType: input.actionType,
    processId: input.processId ?? null,
    invitationId: invitation?.invitationId ?? null,
  };
}
