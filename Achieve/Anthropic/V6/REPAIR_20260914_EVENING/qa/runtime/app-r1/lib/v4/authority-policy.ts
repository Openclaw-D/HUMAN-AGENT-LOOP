import type {
  V4AccessGrant,
  V4AuthorityAction,
  V4AuthorityDecision,
  V4AuthorityRequest,
  V4ExplicitDeny,
  V4OrganizationScope,
  V4ResourceRef,
} from './authority-types.ts';

type PolicyEntry = V4AccessGrant | V4ExplicitDeny;

const ACTOR_KINDS = new Set<string>([
  'internal_human',
  'external_human',
  'authorized_rule',
  'system_service',
  'capability',
]);

const ROLE_IDS = new Set<string>([
  'business_worker',
  'policy_professional',
  'credit_professional',
  'commercial_professional',
  'asset_professional',
  'team_manager',
  'organization_director',
  'access_administrator',
  'system_owner',
  'capability_owner',
  'intelligence_operator',
  'release_approver',
  'audit_observer',
]);

const RESOURCE_TYPES = new Set<string>([
  'organization',
  'case',
  'capability_version',
  'access_grant',
]);

const ACTION_NAMES_BY_FAMILY = new Map<string, Set<string>>([
  ['observe', new Set<string>([
    'observe_organization',
    'observe_case',
    'observe_capability',
    'observe_access_grant',
  ])],
  ['prepare', new Set<string>([
    'prepare_evidence_draft',
    'prepare_candidate_draft',
  ])],
  ['manage_work', new Set<string>([
    'assign_work',
    'request_supplement',
    'escalate_work',
  ])],
  ['professional_decide', new Set<string>([
    'credit_decide',
    'commercial_decide',
    'asset_decide',
    'commencement_decide',
  ])],
  ['govern_access', new Set<string>([
    'propose_access',
    'approve_access',
    'revoke_access',
  ])],
  ['govern_capability', new Set<string>([
    'propose_capability',
    'evaluate_capability',
    'approve_capability',
    'release_capability',
    'suspend_capability',
    'rollback_capability',
    'retire_capability',
  ])],
  ['execute_authorized_action', new Set<string>([
    'execute_authorized_action',
  ])],
]);

const RESOURCE_TYPES_BY_ACTION_NAME = new Map<string, Set<string>>([
  ['observe_organization', new Set<string>(['organization'])],
  ['observe_case', new Set<string>(['case'])],
  ['observe_capability', new Set<string>(['capability_version'])],
  ['observe_access_grant', new Set<string>(['access_grant'])],
  ['prepare_evidence_draft', new Set<string>(['case'])],
  ['prepare_candidate_draft', new Set<string>(['case'])],
  ['assign_work', new Set<string>(['case'])],
  ['request_supplement', new Set<string>(['case'])],
  ['escalate_work', new Set<string>(['case'])],
  ['credit_decide', new Set<string>(['case'])],
  ['commercial_decide', new Set<string>(['case'])],
  ['asset_decide', new Set<string>(['case'])],
  ['commencement_decide', new Set<string>(['case'])],
  ['propose_access', new Set<string>(['access_grant'])],
  ['approve_access', new Set<string>(['access_grant'])],
  ['revoke_access', new Set<string>(['access_grant'])],
  ['propose_capability', new Set<string>(['capability_version'])],
  ['evaluate_capability', new Set<string>(['capability_version'])],
  ['approve_capability', new Set<string>(['capability_version'])],
  ['release_capability', new Set<string>(['capability_version'])],
  ['suspend_capability', new Set<string>(['capability_version'])],
  ['rollback_capability', new Set<string>(['capability_version'])],
  ['retire_capability', new Set<string>(['capability_version'])],
  ['execute_authorized_action', new Set<string>(['case'])],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidPath(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((entry) => isNonEmptyString(entry));
}

function samePath(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => entry === right[index]);
}

function isValidOrganizationScope(value: unknown): value is V4OrganizationScope {
  return isRecord(value)
    && (value.mode === 'exact' || value.mode === 'subtree')
    && isValidPath(value.organizationPath);
}

function scopeCoversPath(scope: unknown, path: string[]): boolean {
  if (!isValidOrganizationScope(scope)) {
    return false;
  }

  const scopePath = scope.organizationPath;
  if (scope.mode === 'exact') {
    return samePath(scopePath, path);
  }

  return scopePath.length <= path.length
    && scopePath.every((entry, index) => entry === path[index]);
}

function isValidExternalInvitation(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.invitationId)
    && isNonEmptyString(value.caseId)
    && isValidPath(value.organizationPath);
}

function isValidActor(request: V4AuthorityRequest): boolean {
  const actor = request.actor;
  if (!isRecord(actor) || !isNonEmptyString(actor.actorId) || !ACTOR_KINDS.has(actor.kind)) {
    return false;
  }

  if (actor.kind === 'external_human') {
    return actor.organizationPath === null
      && isValidExternalInvitation(actor.externalInvitation);
  }

  return actor.organizationPath !== null
    && isValidPath(actor.organizationPath)
    && actor.externalInvitation === null;
}

function isValidRequestIdentity(value: unknown): value is V4AuthorityRequest {
  return isRecord(value)
    && isValidActor(value as V4AuthorityRequest)
    && isNonEmptyString(value.policyVersion)
    && isNonEmptyString(value.currentPolicyVersion);
}

function hasInvalidRoleAssignment(
  request: V4AuthorityRequest,
  currentPath: string[] | null,
): boolean {
  const assignments = request.roleAssignments;
  if (!Array.isArray(assignments)) {
    return true;
  }

  const structurallyInvalid = assignments.some((assignment) => !(
    isRecord(assignment)
    && isNonEmptyString(assignment.assignmentId)
    && isNonEmptyString(assignment.actorId)
    && assignment.actorId === request.actor.actorId
    && isNonEmptyString(assignment.role)
    && ROLE_IDS.has(assignment.role)
    && isValidOrganizationScope(assignment.scope)
  ));
  if (structurallyInvalid) {
    return true;
  }

  return currentPath !== null
    && assignments.some((assignment) => !scopeCoversPath(assignment.scope, currentPath));
}

function isValidAction(value: unknown): value is V4AuthorityAction {
  if (!isRecord(value) || !isNonEmptyString(value.family) || !isNonEmptyString(value.name)) {
    return false;
  }

  const names = ACTION_NAMES_BY_FAMILY.get(value.family);
  return names !== undefined && names.has(value.name);
}

function sameAction(left: unknown, right: V4AuthorityAction): boolean {
  return isRecord(left)
    && left.family === right.family
    && left.name === right.name;
}

function isValidResourceValue(resource: unknown): resource is V4ResourceRef {
  return isRecord(resource)
    && isNonEmptyString(resource.resourceType)
    && RESOURCE_TYPES.has(resource.resourceType)
    && isNonEmptyString(resource.resourceId)
    && isValidPath(resource.organizationPath)
    && (resource.resourceType !== 'capability_version'
      || isNonEmptyString(resource.capabilityVersion));
}

function isValidResource(request: V4AuthorityRequest): boolean {
  return isValidResourceValue(request.resource);
}

function isExpectedResourceType(action: V4AuthorityAction, resourceType: string): boolean {
  const resourceTypes = RESOURCE_TYPES_BY_ACTION_NAME.get(action.name);
  return resourceTypes !== undefined && resourceTypes.has(resourceType);
}

function resourcePath(request: V4AuthorityRequest): string[] | null {
  const resource = request.resource;
  return isRecord(resource) && isValidPath(resource.organizationPath)
    ? resource.organizationPath
    : null;
}

function hasValidExternalRequestScope(request: V4AuthorityRequest): boolean {
  const invitation = request.actor.externalInvitation;
  const resource = request.resource;
  return isRecord(invitation)
    && request.presentedInvitationId === invitation.invitationId
    && isRecord(resource)
    && resource.resourceType === 'case'
    && resource.resourceId === invitation.caseId
    && samePath(resource.organizationPath, invitation.organizationPath);
}

function invitationIdIsEffective(entry: PolicyEntry, request: V4AuthorityRequest): boolean {
  if (request.actor.kind === 'external_human') {
    return entry.invitationId === request.actor.externalInvitation.invitationId;
  }

  return entry.invitationId === null;
}

function policyEntryId(entry: unknown): unknown {
  return isRecord(entry) && entry.grantId !== undefined
    ? entry.grantId
    : isRecord(entry) ? entry.denyId : undefined;
}

function policyEntryMatchesExceptScope(entry: unknown, request: V4AuthorityRequest): boolean {
  if (!isRecord(entry)
    || !isNonEmptyString(policyEntryId(entry))
    || !isNonEmptyString(entry.actorId)
    || entry.actorId !== request.actor.actorId
    || !isValidAction(entry.action)
    || !sameAction(entry.action, request.action)
    || !isNonEmptyString(entry.resourceType)
    || !RESOURCE_TYPES.has(entry.resourceType)
    || entry.resourceType !== request.resource.resourceType
    || !(entry.resourceId === '*' || entry.resourceId === request.resource.resourceId)
    || !isNonEmptyString(entry.policyVersion)
    || entry.policyVersion !== request.policyVersion
    || !invitationIdIsEffective(entry as PolicyEntry, request)) {
    return false;
  }

  return true;
}

function policyEntryMatches(
  entry: unknown,
  request: V4AuthorityRequest,
  path: string[],
): boolean {
  return isRecord(entry)
    && policyEntryMatchesExceptScope(entry, request)
    && isValidOrganizationScope(entry.organizationScope)
    && scopeCoversPath(entry.organizationScope, path);
}

function policyEntries(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function ordinalComparison(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasFreshContext(request: V4AuthorityRequest): boolean {
  return isNonEmptyString(request.expectedContextVersion)
    && isNonEmptyString(request.currentContextVersion)
    && request.expectedContextVersion === request.currentContextVersion;
}

function isCaseContextAction(action: V4AuthorityAction): boolean {
  return action.family === 'prepare'
    || action.family === 'manage_work'
    || action.family === 'professional_decide'
    || action.family === 'execute_authorized_action';
}

function cloneAction(value: V4AuthorityAction): V4AuthorityAction {
  return structuredClone(value);
}

function cloneResource(value: V4ResourceRef): V4ResourceRef {
  const organizationPath = Array.isArray(value.organizationPath)
    ? [...value.organizationPath]
    : [];

  if (value.resourceType === 'capability_version') {
    return {
      resourceType: value.resourceType,
      resourceId: value.resourceId,
      capabilityVersion: value.capabilityVersion,
      organizationPath,
    };
  }

  return {
    resourceType: value.resourceType,
    resourceId: value.resourceId,
    organizationPath,
  };
}

function decision(
  request: V4AuthorityRequest,
  outcome: V4AuthorityDecision['outcome'],
  reasonCode: V4AuthorityDecision['reasonCode'],
  matchedGrantId: string | null = null,
  matchedDenyId: string | null = null,
): V4AuthorityDecision {
  const requestRecord: Record<string, unknown> = isRecord(request) ? request : {};
  const action: V4AuthorityAction = isValidAction(requestRecord.action)
    ? requestRecord.action
    : { family: 'observe', name: 'observe_case' };
  const resource: V4ResourceRef = isValidResourceValue(requestRecord.resource)
    ? requestRecord.resource
    : { resourceType: 'case', resourceId: '', organizationPath: [] };

  return {
    outcome,
    reasonCode,
    policyVersion: typeof requestRecord.policyVersion === 'string' ? requestRecord.policyVersion : '',
    actorId: isRecord(requestRecord.actor) && typeof requestRecord.actor.actorId === 'string'
      ? requestRecord.actor.actorId
      : '',
    currentContextVersion: typeof requestRecord.currentContextVersion === 'string'
      ? requestRecord.currentContextVersion
      : null,
    matchedGrantId,
    matchedDenyId,
    action: cloneAction(action),
    resource: cloneResource(resource),
  };
}

export function evaluateV4Authority(request: V4AuthorityRequest): V4AuthorityDecision {
  if (!isValidRequestIdentity(request)) {
    return decision(request, 'denied', 'INVALID_IDENTITY');
  }

  const path = resourcePath(request);
  if (hasInvalidRoleAssignment(request, path)) {
    return decision(request, 'denied', 'INVALID_ROLE_ASSIGNMENT');
  }

  if (!isValidResource(request)
    || !isValidAction(request.action)
    || !isExpectedResourceType(request.action, request.resource.resourceType)
    || (request.actor.kind === 'external_human'
      && ((request.action.family === 'observe' && request.action.name === 'observe_case')
        || request.action.family === 'prepare')
      && !hasValidExternalRequestScope(request))) {
    return decision(request, 'denied', 'RESOURCE_SCOPE_MISMATCH');
  }

  const effectivePath = path as string[];
  const hasOutOfScopePolicyEntry = [
    ...policyEntries(request.grants),
    ...policyEntries(request.denies),
  ].some((entry) => isRecord(entry)
    && policyEntryMatchesExceptScope(entry, request)
    && (!isValidOrganizationScope(entry.organizationScope)
      || !scopeCoversPath(entry.organizationScope, effectivePath)));
  if (hasOutOfScopePolicyEntry) {
    return decision(request, 'denied', 'RESOURCE_SCOPE_MISMATCH');
  }

  const matchingDenies = policyEntries(request.denies)
    .filter((entry) => policyEntryMatches(entry, request, effectivePath))
    .map((entry) => entry as V4ExplicitDeny)
    .sort((left, right) => ordinalComparison(left.denyId, right.denyId));
  if (matchingDenies.length > 0) {
    return decision(
      request,
      'denied',
      'EXPLICIT_DENY',
      null,
      matchingDenies[0].denyId,
    );
  }

  const matchingGrants = policyEntries(request.grants)
    .filter((entry) => policyEntryMatches(entry, request, effectivePath))
    .map((entry) => entry as V4AccessGrant)
    .sort((left, right) => ordinalComparison(left.grantId, right.grantId));
  if (matchingGrants.length === 0) {
    return decision(request, 'denied', 'MISSING_GRANT');
  }

  const matchedGrant = matchingGrants[0];
  if (isCaseContextAction(request.action) && !hasFreshContext(request)) {
    return decision(
      request,
      'denied',
      'STALE_CONTEXT',
      matchedGrant.grantId,
    );
  }

  if (request.policyVersion !== request.currentPolicyVersion) {
    return decision(
      request,
      'denied',
      'STALE_POLICY',
      matchedGrant.grantId,
    );
  }

  if (request.actor.kind === 'authorized_rule' || request.actor.kind === 'system_service') {
    return decision(
      request,
      'unknown',
      'AUTHORITY_SOURCE_UNKNOWN',
      matchedGrant.grantId,
    );
  }

  if (request.actor.kind === 'external_human') {
    const invitation = request.actor.externalInvitation;
    const isAllowedExternalAction = (request.action.family === 'observe'
      && request.action.name === 'observe_case')
      || request.action.family === 'prepare';
    const isExactInvitationUse = request.presentedInvitationId === invitation.invitationId
      && matchedGrant.invitationId === invitation.invitationId
      && request.resource.resourceType === 'case'
      && request.resource.resourceId === invitation.caseId
      && samePath(effectivePath, invitation.organizationPath)
      && matchedGrant.organizationScope.mode === 'exact'
      && samePath(matchedGrant.organizationScope.organizationPath, invitation.organizationPath);

    if (!isAllowedExternalAction || !isExactInvitationUse) {
      return decision(
        request,
        'denied',
        'EXTERNAL_SCOPE_RESTRICTED',
        matchedGrant.grantId,
      );
    }
  }

  if (request.actor.kind === 'capability') {
    const isPrepare = request.action.family === 'prepare';
    const isExactCaseGrant = request.resource.resourceType === 'case'
      && matchedGrant.resourceId === request.resource.resourceId
      && matchedGrant.organizationScope.mode === 'exact'
      && samePath(matchedGrant.organizationScope.organizationPath, effectivePath);

    if (!isPrepare || !isExactCaseGrant || !hasFreshContext(request)) {
      return decision(
        request,
        'denied',
        'CAPABILITY_PREPARE_ONLY',
        matchedGrant.grantId,
      );
    }
  }

  return decision(
    request,
    'allowed',
    'ALLOWED',
    matchedGrant.grantId,
  );
}
