import assert from 'node:assert/strict';
import test from 'node:test';

import {
  V3_SCENARIO_CASES,
  V3_SCENARIO_PRINCIPAL_IDS,
  V3_SCENARIO_PROCESS_IDS,
  V3_SCENARIO_REF,
  V3_SCENARIO_TRANSITIONS,
  getV3ScenarioBaseline,
} from '../lib/v3-demo-scenario.ts';

test('freezes the fixed Golden Scenario identity and five process routes', () => {
  assert.equal(V3_SCENARIO_REF.scenarioId, 'JW-V3-DL-GOLDEN-001');
  assert.equal(V3_SCENARIO_REF.caseId, 'FL-DEMO-001');
  assert.equal(V3_SCENARIO_REF.leaseMode, 'direct-lease');
  assert.equal(V3_SCENARIO_REF.dataClass, 'synthetic_deidentified_demo');
  assert.deepEqual(V3_SCENARIO_PROCESS_IDS, ['opportunity', 'policy', 'credit', 'commercial', 'asset']);
  assert.equal(new Set(V3_SCENARIO_PRINCIPAL_IDS).size, 8);
});

test('keeps one Golden Case and four independent sparse background cases', () => {
  assert.equal(V3_SCENARIO_CASES.length, 5);
  assert.equal(V3_SCENARIO_CASES.filter((item) => item.caseTier === 'golden').length, 1);
  assert.equal(V3_SCENARIO_CASES.filter((item) => item.caseTier === 'background').length, 4);
  assert.equal(new Set(V3_SCENARIO_CASES.map((item) => item.caseId)).size, 5);
  assert.ok(V3_SCENARIO_CASES.filter((item) => item.caseTier === 'background').every((item) => item.readOnly));
  assert.ok(V3_SCENARIO_CASES.filter((item) => ['active_lease', 'closed'].includes(item.lifecycleStatus)).every((item) => item.commencementBand === 5));
});

test('freezes T1/T2/T3 principals, one-commit batching and credit regression', () => {
  assert.deepEqual(V3_SCENARIO_TRANSITIONS.map((item) => item.transitionCode), ['T1', 'T2', 'T3']);
  assert.ok(V3_SCENARIO_TRANSITIONS.every((item) => item.maxContextCommits === 1));
  assert.equal(V3_SCENARIO_TRANSITIONS[0].commitPrincipalId, 'business-owner');
  assert.equal(V3_SCENARIO_TRANSITIONS[1].commitPrincipalId, 'external-customer');
  assert.equal(V3_SCENARIO_TRANSITIONS[1].invitationId, 'INV-CUSTOMER-RISK-001');
  assert.equal(V3_SCENARIO_TRANSITIONS[1].creditRegressionRequired, true);
  assert.deepEqual(V3_SCENARIO_TRANSITIONS[2].evidencePrincipalIds, ['external-customer', 'external-supplier']);
  assert.equal(V3_SCENARIO_TRANSITIONS[2].commitPrincipalId, 'business-owner');
});

test('returns isolated mutable baseline snapshots without polluting constants', () => {
  const first = getV3ScenarioBaseline();
  const second = getV3ScenarioBaseline();
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.cases, second.cases);
  first.cases[0].commencementBand = 5;
  first.receipts.push({ receiptId: 'changed' });
  assert.equal(second.cases[0].commencementBand, 0);
  assert.deepEqual(second.receipts, []);
  assert.equal(V3_SCENARIO_CASES[0].commencementBand, 0);
});
