export type V4ActorKind =
  | 'internal_human'
  | 'external_human'
  | 'authorized_rule'
  | 'system_service'
  | 'capability';

export type V4RoleId =
  | 'business_worker'
  | 'policy_professional'
  | 'credit_professional'
  | 'commercial_professional'
  | 'asset_professional'
  | 'team_manager'
  | 'organization_director'
  | 'access_administrator'
  | 'system_owner'
  | 'capability_owner'
  | 'intelligence_operator'
  | 'release_approver'
  | 'audit_observer';

export type V4OrganizationScope = {
  mode: 'exact' | 'subtree';
  organizationPath: string[];
};

export type V4ExternalInvitationScope = {
  invitationId: string;
  caseId: string;
  organizationPath: string[];
};

export type V4ActorIdentity =
  | {
      actorId: string;
      kind: Exclude<V4ActorKind, 'external_human'>;
      organizationPath: string[];
      externalInvitation: null;
    }
  | {
      actorId: string;
      kind: 'external_human';
      organizationPath: null;
      externalInvitation: V4ExternalInvitationScope;
    };

export type V4RoleAssignment = {
  assignmentId: string;
  actorId: string;
  role: V4RoleId;
  scope: V4OrganizationScope;
};

export type V4ObserveAction =
  | { family: 'observe'; name: 'observe_organization' }
  | { family: 'observe'; name: 'observe_case' }
  | { family: 'observe'; name: 'observe_capability' }
  | { family: 'observe'; name: 'observe_access_grant' };

export type V4PrepareAction = {
  family: 'prepare';
  name: 'prepare_evidence_draft' | 'prepare_candidate_draft';
};

export type V4ManageWorkAction = {
  family: 'manage_work';
  name: 'assign_work' | 'request_supplement' | 'escalate_work';
};

export type V4ProfessionalDecisionAction = {
  family: 'professional_decide';
  name:
    | 'credit_decide'
    | 'commercial_decide'
    | 'asset_decide'
    | 'commencement_decide';
};

export type V4GovernAccessAction = {
  family: 'govern_access';
  name: 'propose_access' | 'approve_access' | 'revoke_access';
};

export type V4GovernCapabilityAction = {
  family: 'govern_capability';
  name:
    | 'propose_capability'
    | 'evaluate_capability'
    | 'approve_capability'
    | 'release_capability'
    | 'suspend_capability'
    | 'rollback_capability'
    | 'retire_capability';
};

export type V4ExecuteAuthorizedAction = {
  family: 'execute_authorized_action';
  name: 'execute_authorized_action';
};

export type V4AuthorityAction =
  | V4ObserveAction
  | V4PrepareAction
  | V4ManageWorkAction
  | V4ProfessionalDecisionAction
  | V4GovernAccessAction
  | V4GovernCapabilityAction
  | V4ExecuteAuthorizedAction;

export type V4ActionResourceCompatibility =
  | { action: Extract<V4ObserveAction, { name: 'observe_organization' }>; resourceType: 'organization' }
  | { action: Extract<V4ObserveAction, { name: 'observe_case' }>; resourceType: 'case' }
  | { action: Extract<V4ObserveAction, { name: 'observe_capability' }>; resourceType: 'capability_version' }
  | { action: Extract<V4ObserveAction, { name: 'observe_access_grant' }>; resourceType: 'access_grant' }
  | { action: V4PrepareAction; resourceType: 'case' }
  | { action: V4ManageWorkAction; resourceType: 'case' }
  | { action: V4ProfessionalDecisionAction; resourceType: 'case' }
  | { action: V4GovernAccessAction; resourceType: 'access_grant' }
  | { action: V4GovernCapabilityAction; resourceType: 'capability_version' }
  | { action: V4ExecuteAuthorizedAction; resourceType: 'case' };

export type V4ResourceRef =
  | {
      resourceType: 'organization';
      resourceId: string;
      organizationPath: string[];
    }
  | {
      resourceType: 'case';
      resourceId: string;
      organizationPath: string[];
    }
  | {
      resourceType: 'capability_version';
      resourceId: string;
      capabilityVersion: string;
      organizationPath: string[];
    }
  | {
      resourceType: 'access_grant';
      resourceId: string;
      organizationPath: string[];
    };

export type V4AccessGrant = {
  grantId: string;
  actorId: string;
  action: V4AuthorityAction;
  resourceType: V4ResourceRef['resourceType'];
  resourceId: string | '*';
  organizationScope: V4OrganizationScope;
  policyVersion: string;
  invitationId: string | null;
};

export type V4ExplicitDeny = {
  denyId: string;
  actorId: string;
  action: V4AuthorityAction;
  resourceType: V4ResourceRef['resourceType'];
  resourceId: string | '*';
  organizationScope: V4OrganizationScope;
  policyVersion: string;
  invitationId: string | null;
};

export type V4AuthorityRequest = {
  actor: V4ActorIdentity;
  roleAssignments: V4RoleAssignment[];
  action: V4AuthorityAction;
  resource: V4ResourceRef;
  grants: V4AccessGrant[];
  denies: V4ExplicitDeny[];
  policyVersion: string;
  currentPolicyVersion: string;
  expectedContextVersion: string | null;
  currentContextVersion: string | null;
  presentedInvitationId: string | null;
};

export type V4AuthorityReasonCode =
  | 'INVALID_IDENTITY'
  | 'INVALID_ROLE_ASSIGNMENT'
  | 'RESOURCE_SCOPE_MISMATCH'
  | 'EXPLICIT_DENY'
  | 'MISSING_GRANT'
  | 'STALE_CONTEXT'
  | 'STALE_POLICY'
  | 'CAPABILITY_PREPARE_ONLY'
  | 'EXTERNAL_SCOPE_RESTRICTED'
  | 'AUTHORITY_SOURCE_UNKNOWN'
  | 'ALLOWED';

export type V4AuthorityDecision = {
  outcome: 'allowed' | 'denied' | 'unknown';
  reasonCode: V4AuthorityReasonCode;
  policyVersion: string;
  actorId: string;
  action: V4AuthorityAction;
  resource: V4ResourceRef;
  currentContextVersion: string | null;
  matchedGrantId: string | null;
  matchedDenyId: string | null;
};
