import test from 'node:test';
import assert from 'node:assert/strict';
import { runBusinessColumn } from '../src/worker/column-runner.mjs';

const base = () => ({ customer: { customer_id: 'c', tenant_id: 't', legal_entity_ref: 'SYNTHETIC-column' },
  evaluatedAt: '2026-09-21T10:00:00.000Z',
  materials: [{ artifact_id: 'a', sha256: 'hash-a', kind: 'financial_statement', created_at: '2026-09-21T09:00:00Z',
    content: { declaredFacts: [{ factKey: 'revenue_annual_declared', value: 20000000, verificationLevel: 'verified' }] } }], facts: [] });

test('uploaded verification claims are not facts; real registered facts carry source and grade', () => {
  const input=base();
  const missing=runBusinessColumn(input);
  assert.equal(missing.ok,true);assert.equal(missing.assessment.knownFacts.length,0);
  input.facts=[{ assertion_id:'f',artifact_id:'a',fact_key:'revenue_annual_declared',value:20000000,grade:'unverified' }];
  const actual=runBusinessColumn(input);
  assert.equal(actual.ok,true);assert.ok(actual.assessment.knownFacts[0].includes('declared'));
  assert.ok(actual.assessment.unknowns.some(x=>x.includes('verified')));
  assert.equal(actual.assessment.evidenceRefs[0].materialId,'a');
  assert.equal(actual.analysisRun.completedAt,input.evaluatedAt);
  assert.equal(actual.assessment.authority,'none');assert.equal(actual.analysisRun.usage.externalCalls,0);
});

test('superseded material is not used and non-synthetic scope fails closed', () => {
  const input=base();input.materials[0].superseded_by='replacement';
  assert.equal(runBusinessColumn(input).ok,false);
  input.customer.legal_entity_ref='real';assert.throws(()=>runBusinessColumn(input),/SYNTHETIC_ONLY/);
});
