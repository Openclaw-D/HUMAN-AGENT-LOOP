import assert from 'node:assert/strict';
import test from 'node:test';

import {
  V3_BUSINESS_COORDINATION_ACTIONS,
  V3_PROFESSIONAL_PATH_STEPS,
  V3_ROLE_PROJECTION_IDS,
  createSurfaceEmpty,
  createSurfaceError,
  createSurfaceLoading,
  createSurfaceReady,
  missingChartDatum,
  toFrontendQuarterThreshold,
} from '../lib/v3-surfaces/shared/contracts.ts';
import {
  assertV3ProfessionalGateScope,
  getV3RolePolicy,
} from '../lib/v3-surfaces/shared/role-policies.ts';

test('freezes eight Role Projections and keeps business outside professional Gate authority', () => {
  assert.deepEqual(V3_ROLE_PROJECTION_IDS, [
    'leadership', 'business', 'policy', 'credit', 'commercial', 'asset', 'customer', 'supplier',
  ]);
  const business = getV3RolePolicy('business');
  assert.deepEqual(business.coordinationActions, [...V3_BUSINESS_COORDINATION_ACTIONS]);
  assert.equal(business.canConfirmProfessionalGate, false);
  assert.throws(
    () => assertV3ProfessionalGateScope('business', 'credit'),
    (error) => error.code === 'PROFESSIONAL_GATE_SCOPE_DENIED',
  );
  assert.doesNotThrow(() => assertV3ProfessionalGateScope('credit', 'credit'));
  assert.throws(
    () => assertV3ProfessionalGateScope('credit', 'policy'),
    (error) => error.code === 'PROFESSIONAL_GATE_SCOPE_DENIED',
  );
  assert.deepEqual(V3_PROFESSIONAL_PATH_STEPS, ['material', 'rule', 'model', 'human_review']);
});

test('separates continuous backend progress from coarse frontend quarter thresholds', () => {
  assert.equal(toFrontendQuarterThreshold(null), null);
  assert.equal(toFrontendQuarterThreshold(0), 0);
  assert.equal(toFrontendQuarterThreshold(24.9), 0);
  assert.equal(toFrontendQuarterThreshold(25), 25);
  assert.equal(toFrontendQuarterThreshold(63), 50);
  assert.equal(toFrontendQuarterThreshold(99.9), 75);
  assert.equal(toFrontendQuarterThreshold(100), 100);
  assert.throws(() => toFrontendQuarterThreshold(101), (error) => error.code === 'INVALID_PROGRESS');
});

test('freezes loading, ready, empty, error and explicit missing-data shapes', () => {
  assert.deepEqual(createSurfaceLoading(), { status: 'loading', data: null, error: null, empty: null });
  assert.deepEqual(createSurfaceReady({ id: 1 }), { status: 'ready', data: { id: 1 }, error: null, empty: null });
  assert.deepEqual(createSurfaceEmpty(), { status: 'empty', data: null, error: null, empty: { message: '未提供' } });
  assert.deepEqual(createSurfaceError({ code: 'X', message: 'x', retryable: true }), {
    status: 'error', data: null, empty: null, error: { code: 'X', message: 'x', retryable: true },
  });
  const missing = missingChartDatum('missing', '缺失指标');
  assert.equal(missing.value, null);
  assert.equal(missing.displayValue, '未提供');
  assert.equal(missing.provenance.availability, 'not_provided');
});
