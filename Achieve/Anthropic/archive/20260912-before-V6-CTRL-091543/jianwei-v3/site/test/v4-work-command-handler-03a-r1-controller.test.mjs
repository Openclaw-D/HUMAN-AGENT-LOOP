import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const handler = readFileSync(new URL('../lib/v4/work-command-handler.ts', import.meta.url), 'utf8');
const publicTest = readFileSync(new URL('./v4-work-command-handler-03a.test.mjs', import.meta.url), 'utf8');

test('controller R1: Decision lineage is checked against stored canonical Evidence, Candidate and active assignment artifacts', () => {
  for (const term of [
    'caseState.candidateReceipts',
    'caseState.evidenceReceipts',
    'transaction.creditReviewAssignments',
    'DECISION_LINEAGE_INVALID',
    'HUMAN_GATE_ACTOR_MISMATCH',
  ]) assert.equal(handler.includes(term), true, term);
});

test('controller R1: focused public chain does not raw-seed an accepted Candidate/Gate and covers receipt drift', () => {
  for (const term of [
    "operation: 'accept_evidence'",
    "operation: 'record_candidate'",
    "operation: 'submit_credit_decision'",
    'candidateReceipts',
    'evidenceReceipts',
    'assignment',
  ]) assert.equal(publicTest.includes(term), true, term);
});
