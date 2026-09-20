import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareEvidence, validateCitations } from '../src/assistant-evidence.mjs';
import { runAssistantAnalysis } from '../../B/src/graph/assistant-analysis.mjs';

const hash = 'a'.repeat(64);
const material = { tenantId: 't', customerId: 'c', hash, evidenceId: 'e', artifactId: 'a', parserVersion: 'v', current: true, text: '合成客户申请500万元。' };
const input = extra => ({ tenantId: 't', customerId: 'c', revision: 1, materials: [material], allowedHashes: [hash], ...extra });
test('stable provenance identity, page and extracted-text positions', () => {
  const pack = prepareEvidence(input());
  assert.deepEqual(pack, prepareEvidence(input()));
  assert.equal(pack.snippets[0].locator.kind, 'extracted_text');
  assert.equal(pack.snippets[0].text, material.text);
  assert.notEqual(pack.hash, prepareEvidence(input({ revision: 2 })).hash);
  const paged = prepareEvidence(input({ materials: [{ ...material, pages: [{ page: 3, text: material.text }] }] }));
  assert.equal(paged.snippets[0].locator.page, 3);
});
test('fail closed on cross-customer, stale, unapproved hash or missing original', () => {
  for (const patch of [{ customerId: 'other' }, { tenantId: 'other' }, { current: false }, { artifactId: null }, { hash: 'b'.repeat(64) }])
    assert.throws(() => prepareEvidence(input({ materials: [{ ...material, ...patch }] })), /NOT_AUTHORIZED/);
  assert.throws(() => prepareEvidence(input({ materials: [] })), /MISSING/);
});
test('limits select complete source spans and disclose omissions', () => {
  const pack = prepareEvidence(input({ materials: [{ ...material, text: '甲'.repeat(20000) }] }));
  assert.equal(pack.snippets.length, 8);
  assert.ok(pack.snippets.every(s => s.text.length === 800 && s.locator.end - s.locator.start === 800));
  assert.equal(pack.omitted[0].reason, 'CONTEXT_LIMIT');
});
test('forged and missing citations become questions, never valid observations', () => {
  const pack = prepareEvidence(input());
  const result = validateCitations({ findings: [{ text: '有来源', evidenceRefIds: [pack.snippets[0].id] }, { text: '伪造', evidenceRefIds: ['fake'] }, { text: '无依据' }] }, pack);
  assert.equal(result.findings.length, 1);
  assert.equal(result.questions.length, 2);
  assert.equal(result.evidenceRefs[0].hash, hash);
});
test('actual LangGraph executes six ordered nodes, with one controlled call and no retry', async () => {
  const names = ['prepare_evidence', 'validate_input', 'controlled_model_call', 'validate_citations', 'check_current', 'output_receipt'];
  const seen = [];
  const steps = Object.fromEntries(names.map(n => [n, async () => { seen.push(n); return {}; }]));
  const result = await runAssistantAnalysis(steps);
  assert.deepEqual(seen, names);
  assert.deepEqual(result.trace.map(t => t.node), names);
  let calls = 0;
  await assert.rejects(runAssistantAnalysis({ ...steps, controlled_model_call: async () => { calls++; throw new Error('unknown'); } }), /unknown/);
  assert.equal(calls, 1);
});
