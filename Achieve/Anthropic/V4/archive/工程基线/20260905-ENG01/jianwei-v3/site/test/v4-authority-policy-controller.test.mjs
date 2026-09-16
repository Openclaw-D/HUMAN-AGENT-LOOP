import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateV4Authority } from '../lib/v4/authority-policy.ts';

const ORG_CASE = ['group', 'division-a', 'credit-team'];

function action(family = 'observe', name = 'observe_case') {
  return { family, name };
}

function caseResource(overrides = {}) {
  return {
    resourceType: 'case',
    resourceId: 'CASE-001',
    organizationPath: ORG_CASE,
    ...overrides,
  };
}

function internalActor(overrides = {}) {
  return {
    actorId: 'actor-001',
    kind: 'internal_human',
    organizationPath: ORG_CASE,
    externalInvitation: null,
    ...overrides,
  };
}

function externalActor(overrides = {}) {
  return {
    actorId: 'external-001',
    kind: 'external_human',
    organizationPath: null,
    externalInvitation: {
      invitationId: 'INV-001',
      caseId: 'CASE-001',
      organizationPath: ORG_CASE,
    },
    ...overrides,
  };
}

function grant(grantedAction = action(), overrides = {}) {
  return {
    grantId: 'GRANT-001',
    actorId: 'actor-001',
    action: grantedAction,
    resourceType: 'case',
    resourceId: 'CASE-001',
    organizationScope: { mode: 'exact', organizationPath: ORG_CASE },
    policyVersion: 'POLICY-001',
    invitationId: null,
    ...overrides,
  };
}

function deny(deniedAction = action(), overrides = {}) {
  return {
    denyId: 'DENY-001',
    actorId: 'actor-001',
    action: deniedAction,
    resourceType: 'case',
    resourceId: 'CASE-001',
    organizationScope: { mode: 'exact', organizationPath: ORG_CASE },
    policyVersion: 'POLICY-001',
    invitationId: null,
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    actor: internalActor(),
    roleAssignments: [],
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

test('controller gate: a role assignment scope must cover the current resource', () => {
  const decision = evaluateV4Authority(request({
    roleAssignments: [{
      assignmentId: 'ASSIGN-001',
      actorId: 'actor-001',
      role: 'team_manager',
      scope: { mode: 'exact', organizationPath: ['group', 'division-b'] },
    }],
    denies: [deny()],
  }));

  assert.equal(decision.outcome, 'denied');
  assert.equal(decision.reasonCode, 'INVALID_ROLE_ASSIGNMENT');
});

test('controller gate: external invitation mismatch is rejected at resource scope priority', () => {
  const actor = externalActor();
  const externalGrant = grant(action(), {
    actorId: actor.actorId,
    invitationId: 'INV-001',
  });
  const externalDeny = deny(action(), {
    actorId: actor.actorId,
    invitationId: 'INV-001',
  });

  for (const mismatch of [
    { presentedInvitationId: 'INV-WRONG' },
    { resource: caseResource({ resourceId: 'CASE-WRONG' }), presentedInvitationId: 'INV-001' },
    { resource: caseResource({ organizationPath: ['group', 'division-b'] }), presentedInvitationId: 'INV-001' },
  ]) {
    const decision = evaluateV4Authority(request({
      actor,
      grants: [externalGrant],
      denies: [externalDeny],
      ...mismatch,
    }));
    assert.equal(decision.outcome, 'denied');
    assert.equal(decision.reasonCode, 'RESOURCE_SCOPE_MISMATCH');
  }
});

test('controller gate: malformed action names fail closed before policy matching', () => {
  const malformedAction = { family: 'observe', name: 'observe_everything' };
  const decision = evaluateV4Authority(request({
    action: malformedAction,
    grants: [grant(malformedAction)],
    denies: [deny(malformedAction)],
  }));

  assert.equal(decision.outcome, 'denied');
  assert.equal(decision.reasonCode, 'RESOURCE_SCOPE_MISMATCH');
});

test('controller gate: matching identifiers use ordinal deterministic ordering', () => {
  const decision = evaluateV4Authority(request({
    grants: [
      grant(action(), { grantId: 'GRANT-a' }),
      grant(action(), { grantId: 'GRANT-Z' }),
    ],
  }));

  assert.equal(decision.outcome, 'allowed');
  assert.equal(decision.matchedGrantId, 'GRANT-Z');
});
