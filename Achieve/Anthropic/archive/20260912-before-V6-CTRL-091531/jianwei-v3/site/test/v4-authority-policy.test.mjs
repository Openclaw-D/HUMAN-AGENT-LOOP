import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateV4Authority } from '../lib/v4/authority-policy.ts';

const ORG_GROUP = ['group'];
const ORG_CREDIT = ['group', 'division-a', 'credit-team'];
const ORG_COMMERCIAL = ['group', 'division-a', 'commercial-team'];

function internalActor(overrides = {}) {
  return {
    actorId: 'actor-internal-001',
    kind: 'internal_human',
    organizationPath: ORG_CREDIT,
    externalInvitation: null,
    ...overrides,
  };
}

function externalActor(overrides = {}) {
  return {
    actorId: 'actor-external-001',
    kind: 'external_human',
    organizationPath: null,
    externalInvitation: {
      invitationId: 'INV-001',
      caseId: 'CASE-001',
      organizationPath: ORG_CREDIT,
    },
    ...overrides,
  };
}

function roleAssignment(role = 'team_manager', overrides = {}) {
  return {
    assignmentId: `ASSIGN-${role}`,
    actorId: 'actor-internal-001',
    role,
    scope: { mode: 'subtree', organizationPath: ORG_GROUP },
    ...overrides,
  };
}

function action(family = 'observe', name = 'observe_case') {
  return { family, name };
}

function caseResource(overrides = {}) {
  return {
    resourceType: 'case',
    resourceId: 'CASE-001',
    organizationPath: ORG_CREDIT,
    ...overrides,
  };
}

function organizationResource(overrides = {}) {
  return {
    resourceType: 'organization',
    resourceId: 'credit-team',
    organizationPath: ORG_CREDIT,
    ...overrides,
  };
}

function capabilityResource(overrides = {}) {
  return {
    resourceType: 'capability_version',
    resourceId: 'credit.material-gap-analyzer',
    capabilityVersion: '1.0.0',
    organizationPath: ORG_CREDIT,
    ...overrides,
  };
}

function accessResource(overrides = {}) {
  return {
    resourceType: 'access_grant',
    resourceId: 'GRANT-TARGET-001',
    organizationPath: ORG_CREDIT,
    ...overrides,
  };
}

function grant(grantedAction = action(), overrides = {}) {
  return {
    grantId: 'GRANT-001',
    actorId: 'actor-internal-001',
    action: grantedAction,
    resourceType: 'case',
    resourceId: '*',
    organizationScope: { mode: 'subtree', organizationPath: ORG_GROUP },
    policyVersion: 'POLICY-001',
    invitationId: null,
    ...overrides,
  };
}

function explicitDeny(deniedAction = action(), overrides = {}) {
  return {
    denyId: 'DENY-001',
    actorId: 'actor-internal-001',
    action: deniedAction,
    resourceType: 'case',
    resourceId: '*',
    organizationScope: { mode: 'subtree', organizationPath: ORG_GROUP },
    policyVersion: 'POLICY-001',
    invitationId: null,
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    actor: internalActor(),
    roleAssignments: [roleAssignment()],
    action: action(),
    resource: caseResource(),
    grants: [grant()],
    denies: [],
    policyVersion: 'POLICY-001',
    currentPolicyVersion: 'POLICY-001',
    expectedContextVersion: null,
    currentContextVersion: 'CTX-001',
    presentedInvitationId: null,
    ...overrides,
  };
}

function assertDecision(decision, outcome, reasonCode) {
  assert.equal(decision instanceof Promise, false);
  assert.equal(decision.outcome, outcome);
  assert.equal(decision.reasonCode, reasonCode);
}

test('role assignment alone never grants management or professional authority', () => {
  const manager = evaluateV4Authority(request({
    roleAssignments: [roleAssignment('team_manager'), roleAssignment('organization_director')],
    action: action('professional_decide', 'credit_decide'),
    grants: [],
    expectedContextVersion: 'CTX-001',
    currentContextVersion: 'CTX-001',
  }));
  assertDecision(manager, 'denied', 'MISSING_GRANT');
  assert.equal(manager.matchedGrantId, null);
});

test('invalid role assignments fail closed before scope, deny or grant evaluation', () => {
  const wrongActor = evaluateV4Authority(request({
    roleAssignments: [roleAssignment('team_manager', { actorId: 'actor-other' })],
    denies: [explicitDeny()],
  }));
  assertDecision(wrongActor, 'denied', 'INVALID_ROLE_ASSIGNMENT');

  const wrongScope = evaluateV4Authority(request({
    roleAssignments: [roleAssignment('team_manager', {
      scope: { mode: 'exact', organizationPath: ORG_COMMERCIAL },
    })],
  }));
  assertDecision(wrongScope, 'denied', 'INVALID_ROLE_ASSIGNMENT');

  const malformedAssignment = evaluateV4Authority(request({
    roleAssignments: [roleAssignment('team_manager', { assignmentId: '' })],
  }));
  assertDecision(malformedAssignment, 'denied', 'INVALID_ROLE_ASSIGNMENT');
});

test('an exact observe grant can cover an organization subtree', () => {
  const decision = evaluateV4Authority(request());
  assertDecision(decision, 'allowed', 'ALLOWED');
  assert.equal(decision.matchedGrantId, 'GRANT-001');
  assert.equal(decision.matchedDenyId, null);
  assert.equal(decision.currentContextVersion, 'CTX-001');

  const outside = evaluateV4Authority(request({
    resource: caseResource({ organizationPath: ['group', 'division-b', 'credit-team'] }),
    grants: [grant(undefined, {
      organizationScope: { mode: 'subtree', organizationPath: ['group', 'division-a'] },
    })],
  }));
  assertDecision(outside, 'denied', 'RESOURCE_SCOPE_MISMATCH');
});

test('action and resource compatibility is fail-closed before deny or grant evaluation', () => {
  for (const [incompatibleAction, resource] of [
    [action('professional_decide', 'credit_decide'), capabilityResource()],
    [action('govern_capability', 'release_capability'), caseResource()],
    [action('observe', 'observe_case'), organizationResource()],
  ]) {
    const matchingGrant = grant(incompatibleAction, {
      resourceType: resource.resourceType,
      resourceId: resource.resourceId,
      organizationScope: { mode: 'exact', organizationPath: resource.organizationPath },
    });
    const matchingDeny = explicitDeny(incompatibleAction, {
      resourceType: resource.resourceType,
      resourceId: resource.resourceId,
      organizationScope: { mode: 'exact', organizationPath: resource.organizationPath },
    });
    const decision = evaluateV4Authority(request({
      action: incompatibleAction,
      resource,
      grants: [matchingGrant],
      denies: [matchingDeny],
      expectedContextVersion: null,
    }));
    assertDecision(decision, 'denied', 'RESOURCE_SCOPE_MISMATCH');
  }
});

test('explicit deny has priority over grants, stale versions and role assignments', () => {
  const input = request({
    roleAssignments: [roleAssignment('organization_director')],
    grants: [grant(), grant(action(), { grantId: 'GRANT-000' })],
    denies: [
      explicitDeny(action(), { denyId: 'DENY-002', policyVersion: 'POLICY-OLD' }),
      explicitDeny(action(), { policyVersion: 'POLICY-OLD' }),
    ],
    policyVersion: 'POLICY-OLD',
    currentPolicyVersion: 'POLICY-NEW',
  });
  const before = structuredClone(input);
  const decision = evaluateV4Authority(input);
  assertDecision(decision, 'denied', 'EXPLICIT_DENY');
  assert.equal(decision.matchedDenyId, 'DENY-001');
  assert.equal(decision.matchedGrantId, null);
  assert.deepEqual(input, before);
});

test('professional grants authorize only the exact professional action', () => {
  const creditAction = action('professional_decide', 'credit_decide');
  const creditGrant = grant(creditAction);
  const allowed = evaluateV4Authority(request({
    roleAssignments: [roleAssignment('credit_professional')],
    action: creditAction,
    grants: [creditGrant],
    expectedContextVersion: 'CTX-001',
    currentContextVersion: 'CTX-001',
  }));
  assertDecision(allowed, 'allowed', 'ALLOWED');

  for (const name of ['commercial_decide', 'asset_decide', 'commencement_decide']) {
    const crossProfessional = evaluateV4Authority(request({
      roleAssignments: [roleAssignment('credit_professional')],
      action: action('professional_decide', name),
      grants: [creditGrant],
      expectedContextVersion: 'CTX-001',
      currentContextVersion: 'CTX-001',
    }));
    assertDecision(crossProfessional, 'denied', 'MISSING_GRANT');
  }
});

test('prepare actions require an exact Case resource grant and fresh Context', () => {
  const prepareAction = action('prepare', 'prepare_evidence_draft');
  const prepareGrant = grant(prepareAction, {
    resourceId: 'CASE-001',
    organizationScope: { mode: 'exact', organizationPath: ORG_CREDIT },
  });
  const prepared = evaluateV4Authority(request({
    action: prepareAction,
    grants: [prepareGrant],
    expectedContextVersion: 'CTX-001',
  }));
  assertDecision(prepared, 'allowed', 'ALLOWED');

  const stale = evaluateV4Authority(request({
    action: prepareAction,
    grants: [prepareGrant],
    expectedContextVersion: 'CTX-OLD',
  }));
  assertDecision(stale, 'denied', 'STALE_CONTEXT');

  const nonCase = capabilityResource();
  const nonCaseGrant = grant(prepareAction, {
    resourceType: 'capability_version',
    resourceId: nonCase.resourceId,
    organizationScope: { mode: 'exact', organizationPath: ORG_CREDIT },
  });
  const rejected = evaluateV4Authority(request({
    action: prepareAction,
    resource: nonCase,
    grants: [nonCaseGrant],
    expectedContextVersion: 'CTX-001',
  }));
  assertDecision(rejected, 'denied', 'RESOURCE_SCOPE_MISMATCH');
});

test('capability can prepare drafts but remains hard-denied for formal or governance actions', () => {
  const actor = internalActor({
    actorId: 'capability-001',
    kind: 'capability',
    organizationPath: ORG_CREDIT,
  });
  const prepareAction = action('prepare', 'prepare_candidate_draft');
  const prepared = evaluateV4Authority(request({
    actor,
    roleAssignments: [],
    action: prepareAction,
    grants: [grant(prepareAction, {
      actorId: actor.actorId,
      resourceId: 'CASE-001',
      organizationScope: { mode: 'exact', organizationPath: ORG_CREDIT },
    })],
    expectedContextVersion: 'CTX-001',
  }));
  assertDecision(prepared, 'allowed', 'ALLOWED');

  for (const formalAction of [
    action('manage_work', 'assign_work'),
    action('professional_decide', 'credit_decide'),
    action('govern_access', 'approve_access'),
    action('govern_capability', 'release_capability'),
    action('execute_authorized_action', 'execute_authorized_action'),
  ]) {
    const resource = formalAction.family === 'govern_capability'
      ? capabilityResource()
      : formalAction.family === 'govern_access'
        ? accessResource()
        : caseResource();
    const denied = evaluateV4Authority(request({
      actor,
      roleAssignments: [],
      action: formalAction,
      resource,
      grants: [grant(formalAction, {
        actorId: actor.actorId,
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
      })],
      expectedContextVersion: resource.resourceType === 'case' ? 'CTX-001' : null,
      currentContextVersion: resource.resourceType === 'case' ? 'CTX-001' : null,
    }));
    assertDecision(denied, 'denied', 'CAPABILITY_PREPARE_ONLY');
  }
});

test('technical governance authority remains orthogonal to Case professional decisions', () => {
  const governAction = action('govern_access', 'approve_access');
  const governanceGrant = grant(governAction, {
    resourceType: 'access_grant',
    resourceId: 'GRANT-TARGET-001',
  });
  const governance = evaluateV4Authority(request({
    roleAssignments: [roleAssignment('access_administrator')],
    action: governAction,
    resource: accessResource(),
    grants: [governanceGrant],
  }));
  assertDecision(governance, 'allowed', 'ALLOWED');

  const professional = evaluateV4Authority(request({
    roleAssignments: [roleAssignment('access_administrator')],
    action: action('professional_decide', 'credit_decide'),
    grants: [governanceGrant],
    expectedContextVersion: 'CTX-001',
    currentContextVersion: 'CTX-001',
  }));
  assertDecision(professional, 'denied', 'MISSING_GRANT');
});

test('external actor is isolated to an exact invitation and Case for observe or prepare only', () => {
  const actor = externalActor();
  const externalGrant = grant(action(), {
    actorId: actor.actorId,
    resourceId: 'CASE-001',
    organizationScope: { mode: 'exact', organizationPath: ORG_CREDIT },
    invitationId: 'INV-001',
  });
  const observed = evaluateV4Authority(request({
    actor,
    roleAssignments: [],
    grants: [externalGrant],
    presentedInvitationId: 'INV-001',
  }));
  assertDecision(observed, 'allowed', 'ALLOWED');

  const prepareAction = action('prepare', 'prepare_candidate_draft');
  const prepared = evaluateV4Authority(request({
    actor,
    roleAssignments: [],
    action: prepareAction,
    grants: [grant(prepareAction, {
      actorId: actor.actorId,
      resourceId: 'CASE-001',
      organizationScope: { mode: 'exact', organizationPath: ORG_CREDIT },
      invitationId: 'INV-001',
    })],
    expectedContextVersion: 'CTX-001',
    presentedInvitationId: 'INV-001',
  }));
  assertDecision(prepared, 'allowed', 'ALLOWED');

  for (const mismatch of [
    { presentedInvitationId: 'INV-WRONG' },
    { resource: caseResource({ resourceId: 'CASE-OTHER' }), presentedInvitationId: 'INV-001' },
  ]) {
    const denied = evaluateV4Authority(request({
      actor,
      roleAssignments: [],
      grants: [externalGrant],
      ...mismatch,
    }));
    assertDecision(denied, 'denied', 'RESOURCE_SCOPE_MISMATCH');
  }

  for (const restrictedAction of [
    action('manage_work', 'assign_work'),
    action('professional_decide', 'credit_decide'),
    action('govern_access', 'approve_access'),
    action('execute_authorized_action', 'execute_authorized_action'),
  ]) {
    const resource = restrictedAction.family === 'govern_access' ? accessResource() : caseResource();
    const formal = evaluateV4Authority(request({
      actor,
      roleAssignments: [],
      action: restrictedAction,
      resource,
      grants: [grant(restrictedAction, {
        actorId: actor.actorId,
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
        organizationScope: { mode: 'exact', organizationPath: ORG_CREDIT },
        invitationId: 'INV-001',
      })],
      expectedContextVersion: resource.resourceType === 'case' ? 'CTX-001' : null,
      currentContextVersion: resource.resourceType === 'case' ? 'CTX-001' : null,
      presentedInvitationId: 'INV-001',
    }));
    assertDecision(formal, 'denied', 'EXTERNAL_SCOPE_RESTRICTED');
  }
});

test('prepare, management, professional and execution Case actions require fresh Context', () => {
  for (const contextAction of [
    action('prepare', 'prepare_evidence_draft'),
    action('manage_work', 'assign_work'),
    action('professional_decide', 'credit_decide'),
    action('execute_authorized_action', 'execute_authorized_action'),
  ]) {
    const stale = evaluateV4Authority(request({
      action: contextAction,
      grants: [grant(contextAction)],
      expectedContextVersion: 'CTX-OLD',
      currentContextVersion: 'CTX-001',
    }));
    assertDecision(stale, 'denied', 'STALE_CONTEXT');
  }
});

test('stale Context has priority over stale policy after an exact grant matches', () => {
  const professionalAction = action('professional_decide', 'credit_decide');
  const staleContext = evaluateV4Authority(request({
    action: professionalAction,
    grants: [grant(professionalAction, { policyVersion: 'POLICY-OLD' })],
    expectedContextVersion: 'CTX-001',
    currentContextVersion: 'CTX-002',
    policyVersion: 'POLICY-OLD',
    currentPolicyVersion: 'POLICY-NEW',
  }));
  assertDecision(staleContext, 'denied', 'STALE_CONTEXT');

  const stalePolicy = evaluateV4Authority(request({
    action: professionalAction,
    grants: [grant(professionalAction, { policyVersion: 'POLICY-OLD' })],
    expectedContextVersion: 'CTX-001',
    currentContextVersion: 'CTX-001',
    policyVersion: 'POLICY-OLD',
    currentPolicyVersion: 'POLICY-NEW',
  }));
  assertDecision(stalePolicy, 'denied', 'STALE_POLICY');
});

test('authorized_rule and system_service remain unknown even when an ordinary grant matches', () => {
  for (const kind of ['authorized_rule', 'system_service']) {
    const actor = internalActor({ actorId: `${kind}-001`, kind });
    for (const grantedAction of [
      action('observe', 'observe_case'),
      action('execute_authorized_action', 'execute_authorized_action'),
    ]) {
      const decision = evaluateV4Authority(request({
        actor,
        roleAssignments: [],
        action: grantedAction,
        grants: [grant(grantedAction, { actorId: actor.actorId })],
        expectedContextVersion: grantedAction.family === 'execute_authorized_action' ? 'CTX-001' : null,
      }));
      assertDecision(decision, 'unknown', 'AUTHORITY_SOURCE_UNKNOWN');
    }
  }
});

test('invalid actor identity has the highest priority and all outputs are deterministic deep clones', () => {
  const invalid = evaluateV4Authority(request({
    actor: internalActor({ actorId: '' }),
    roleAssignments: [roleAssignment('team_manager', { actorId: 'actor-other' })],
    grants: [],
    denies: [explicitDeny()],
  }));
  assertDecision(invalid, 'denied', 'INVALID_IDENTITY');

  const input = request({
    grants: [grant(action(), { grantId: 'GRANT-002' }), grant()],
  });
  const reversed = { ...structuredClone(input), grants: [...input.grants].reverse() };
  const first = evaluateV4Authority(input);
  const second = evaluateV4Authority(reversed);
  assert.deepEqual(first, second);
  assert.equal(first.matchedGrantId, 'GRANT-001');
  assert.notEqual(first.action, input.action);
  assert.notEqual(first.resource, input.resource);
  first.action.name = 'observe_organization';
  first.resource.organizationPath.push('mutated');
  assert.equal(input.action.name, 'observe_case');
  assert.deepEqual(input.resource.organizationPath, ORG_CREDIT);
});

test('actor identity shape invariants reject conflicting invitations and malformed organization paths', () => {
  const invitation = {
    invitationId: 'INV-001',
    caseId: 'CASE-001',
    organizationPath: ORG_CREDIT,
  };
  for (const actor of [
    internalActor({ externalInvitation: invitation }),
    externalActor({ externalInvitation: null }),
    internalActor({ organizationPath: ['group', '', 'credit-team'] }),
  ]) {
    const decision = evaluateV4Authority(request({
      actor,
      roleAssignments: [],
      denies: [explicitDeny()],
    }));
    assertDecision(decision, 'denied', 'INVALID_IDENTITY');
  }
});
