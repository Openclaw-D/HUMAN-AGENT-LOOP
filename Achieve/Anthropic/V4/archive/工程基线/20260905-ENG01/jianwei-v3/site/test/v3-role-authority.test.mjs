import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorizeV3Action,
  getV3PrincipalPolicy,
  normalizeV3PrincipalId,
} from '../lib/v3-role-authority.ts';

function expectCode(operation, code) {
  assert.throws(operation, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

function base(overrides = {}) {
  return {
    caseId: 'FL-DEMO-001',
    caseTier: 'golden',
    roleApplicationId: 'business',
    principalId: 'business-owner',
    actionType: 'confirm_fact',
    processId: 'opportunity',
    ...overrides,
  };
}

test('normalizes the legacy collaboration alias without returning shared policy arrays', () => {
  assert.equal(normalizeV3PrincipalId(' leadership-observer '), 'collaboration-manager');
  const first = getV3PrincipalPolicy('collaboration-manager');
  const second = getV3PrincipalPolicy('collaboration-manager');
  first.visibleProcessIds.length = 0;
  first.allowedActionTypes.length = 0;
  assert.equal(second.visibleProcessIds.length, 5);
  assert.deepEqual(second.allowedActionTypes, ['chat', 'management_action', 'view_replay']);
  expectCode(() => getV3PrincipalPolicy('unknown'), 'UNKNOWN_PRINCIPAL');
});

test('separates management action, business confirmation and professional gates', () => {
  assert.equal(authorizeV3Action(base()).canonicalPrincipalId, 'business-owner');
  expectCode(
    () => authorizeV3Action(base({ actionType: 'professional_gate', processId: 'credit' })),
    'ACTION_SCOPE_DENIED',
  );

  assert.equal(authorizeV3Action(base({
    roleApplicationId: 'leadership',
    principalId: 'collaboration-manager',
    actionType: 'management_action',
    processId: undefined,
  })).allowed, true);
  expectCode(
    () => authorizeV3Action(base({
      roleApplicationId: 'leadership',
      principalId: 'collaboration-manager',
      actionType: 'professional_gate',
      processId: 'policy',
    })),
    'ACTION_SCOPE_DENIED',
  );
});

test('allows each risk principal to sign only its own professional gate', () => {
  const pairs = [
    ['risk-policy', 'policy'],
    ['risk-credit', 'credit'],
    ['risk-commercial', 'commercial'],
    ['risk-asset', 'asset'],
  ];
  for (const [principalId, processId] of pairs) {
    assert.equal(authorizeV3Action(base({
      roleApplicationId: 'risk',
      principalId,
      actionType: 'professional_gate',
      processId,
    })).allowed, true);
    const otherProcess = processId === 'credit' ? 'policy' : 'credit';
    expectCode(
      () => authorizeV3Action(base({
        roleApplicationId: 'risk',
        principalId,
        actionType: 'professional_gate',
        processId: otherProcess,
      })),
      'PROCESS_SCOPE_DENIED',
    );
  }
});

test('restricts commencement to the commercial principal and process', () => {
  assert.equal(authorizeV3Action(base({
    roleApplicationId: 'risk',
    principalId: 'risk-commercial',
    actionType: 'commencement_action',
    processId: 'commercial',
  })).allowed, true);
  expectCode(
    () => authorizeV3Action(base({
      roleApplicationId: 'risk',
      principalId: 'risk-commercial',
      actionType: 'commencement_action',
      processId: 'asset',
    })),
    'PROCESS_SCOPE_DENIED',
  );
  expectCode(
    () => authorizeV3Action(base({
      roleApplicationId: 'risk',
      principalId: 'risk-asset',
      actionType: 'commencement_action',
      processId: 'commercial',
    })),
    'ACTION_SCOPE_DENIED',
  );
});

test('fails closed for role mismatch, background writes and external invitation errors', () => {
  expectCode(
    () => authorizeV3Action(base({ roleApplicationId: 'risk' })),
    'ROLE_PRINCIPAL_MISMATCH',
  );
  expectCode(
    () => authorizeV3Action(base({ caseTier: 'background' })),
    'BACKGROUND_CASE_READ_ONLY',
  );

  const external = base({
    roleApplicationId: 'external',
    principalId: 'external-customer',
    actionType: 'submit_evidence',
    processId: 'opportunity',
  });
  expectCode(() => authorizeV3Action(external), 'INVITATION_REQUIRED');
  const invitation = {
    invitationId: 'INV-CUSTOMER-RISK-001',
    caseId: 'FL-DEMO-001',
    principalId: 'external-customer',
    workstepProcessId: 'opportunity',
    allowedActionTypes: ['chat', 'submit_evidence', 'confirm_fact'],
    status: 'active',
    expiresAt: '2030-01-01T00:00:00.000Z',
  };
  assert.equal(authorizeV3Action({ ...external, invitation, now: '2029-01-01T00:00:00.000Z' }).invitationId, invitation.invitationId);
  expectCode(
    () => authorizeV3Action({ ...external, invitation: { ...invitation, caseId: 'FL-BG-001' } }),
    'INVITATION_SCOPE_DENIED',
  );
  expectCode(
    () => authorizeV3Action({ ...external, invitation, now: '2031-01-01T00:00:00.000Z' }),
    'INVITATION_EXPIRED',
  );
});
