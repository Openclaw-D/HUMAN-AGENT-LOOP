import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSelection, validateUpstreamMaterials } from '../src/assistant-evidence-scope.mjs';
import { prepareEvidence, validateCitations } from '../src/assistant-evidence.mjs';
import { digest } from '../src/assistant-receipts.mjs';

const snapshot = (ids, readable = true) => ({ snapshot: { artifactsReadable: readable, artifacts: ids.map(id => ({ artifactId: id })) } });
const hash = 'a'.repeat(64);
const material = extra => ({ tenantId: 't', customerId: 'c', hash, evidenceId: 'e1', artifactId: 'art-a',
  parserVersion: 'v1', current: true, text: '合成客户申请500万元。', ...extra });

test('legacy: scope omitted or null keeps snapshot order and derives stable all-readable summary', () => {
  for (const snap of [snapshot(['art-b', 'art-a']), { artifactsReadable: true, artifacts: [{ artifactId: 'art-b' }, { artifactId: 'art-a' }] }]) {
    const s = normalizeSelection({ snapshot: snap, scope: undefined });
    assert.equal(s.mode, 'legacy');
    assert.deepEqual(s.artifactIds, ['art-b', 'art-a']);
    assert.equal(s.summary, digest({ v: 1, mode: 'legacy', artifactIds: ['art-a', 'art-b'] }));
    assert.deepEqual(normalizeSelection({ snapshot: snap, scope: null }), s);
  }
});

test('explicit: dedup, canonical order, order/dup-insensitive summary', () => {
  const a = normalizeSelection({ snapshot: snapshot(['art-a', 'art-b']), scope: { artifactIds: ['art-b', 'art-a', 'art-b'] } });
  const b = normalizeSelection({ snapshot: snapshot(['art-b', 'art-a']), scope: { artifactIds: ['art-a', 'art-b'] } });
  assert.equal(a.mode, 'explicit');
  assert.deepEqual(a.artifactIds, ['art-a', 'art-b']);
  assert.equal(a.summary, b.summary);
  assert.equal(a.summary, digest({ v: 1, mode: 'explicit', artifactIds: ['art-a', 'art-b'] }));
  assert.notEqual(a.summary, normalizeSelection({ snapshot: snapshot(['art-a', 'art-b']), scope: { artifactIds: ['art-a'] } }).summary);
});

test('explicit fails closed before any upstream work: empty, unauthorized, malformed, unreadable inventory', () => {
  const cases = [
    [{ artifactIds: [] }, /EVIDENCE_SCOPE_EMPTY/],
    [{ artifactIds: ['art-a', 'ghost', 'phantom'] }, /EVIDENCE_SCOPE_UNAUTHORIZED/],
    ['all', /EVIDENCE_SCOPE_INVALID/],
    [['art-a'], /EVIDENCE_SCOPE_INVALID/],
    [{}, /EVIDENCE_SCOPE_INVALID/],
    [{ artifactIds: 'art-a' }, /EVIDENCE_SCOPE_INVALID/],
    [{ artifactIds: [1] }, /EVIDENCE_SCOPE_INVALID/],
    [{ artifactIds: [''] }, /EVIDENCE_SCOPE_INVALID/],
  ];
  for (const [scope, pattern] of cases) {
    try { normalizeSelection({ snapshot: snapshot(['art-a']), scope }); assert.fail('should throw'); }
    catch (e) { assert.match(e.message, pattern); }
  }
  try { normalizeSelection({ snapshot: snapshot(['art-a']), scope: { artifactIds: ['art-a', 'ghost'] } }); assert.fail('should throw'); }
  catch (e) { assert.match(e.message, /EVIDENCE_SCOPE_UNAUTHORIZED/); assert.deepEqual(e.detail, ['ghost']); }
  assert.throws(() => normalizeSelection({ snapshot: snapshot(['art-a'], false), scope: { artifactIds: ['art-a'] } }), /EVIDENCE_INVENTORY_UNAUTHORIZED/);
});

test('upstream response: extra, malformed and duplicated materials rejected; explicit subset rejected with detail', () => {
  const legacy = { mode: 'legacy', artifactIds: ['art-a'] };
  const explicit = { mode: 'explicit', artifactIds: ['art-a', 'art-b'] };
  assert.throws(() => validateUpstreamMaterials({ selection: legacy, materials: null }), /EVIDENCE_MAPPING_INVALID/);
  assert.throws(() => validateUpstreamMaterials({ selection: legacy, materials: 'x' }), /EVIDENCE_MAPPING_INVALID/);
  assert.throws(() => validateUpstreamMaterials({ selection: legacy, materials: [null] }), /EVIDENCE_MAPPING_INVALID/);
  assert.throws(() => validateUpstreamMaterials({ selection: legacy, materials: [{ artifactId: 'art-z' }] }), /EVIDENCE_MAPPING_INVALID/);
  // legacy 容忍子集（旧语义）；explicit 不容忍（上游静默省略即整次拒绝）
  assert.doesNotThrow(() => validateUpstreamMaterials({ selection: legacy, materials: [] }));
  assert.throws(() => validateUpstreamMaterials({ selection: explicit, materials: [{ artifactId: 'art-a' }] }), /EVIDENCE_SCOPE_INCOMPLETE/);
  try { validateUpstreamMaterials({ selection: explicit, materials: [{ artifactId: 'art-a' }] }); }
  catch (e) { assert.deepEqual(e.detail, ['art-b']); }
  assert.doesNotThrow(() => validateUpstreamMaterials({ selection: explicit, materials: [{ artifactId: 'art-b' }, { artifactId: 'art-a' }] }));
  assert.throws(() => validateUpstreamMaterials({ selection: explicit, materials: [{ artifactId: 'art-a' }, { artifactId: 'art-a' }] }), /EVIDENCE_MAPPING_INVALID/);
});

test('response materials re-validated item by item: cross-owner, stale, unapproved hash, missing parser', () => {
  const input = extra => ({ tenantId: 't', customerId: 'c', revision: 1,
    materials: [material(extra)], allowedHashes: [hash] });
  for (const patch of [{ customerId: 'other-c' }, { tenantId: 'other-t' }, { current: false },
    { hash: 'b'.repeat(64) }, { parserVersion: null }, { artifactId: null }])
    assert.throws(() => prepareEvidence(input(patch)), /NOT_AUTHORIZED/);
});

test('selected-material pack keeps hash/locator/omission traceable and citations source-bound under truncation', () => {
  const pack = prepareEvidence({ tenantId: 't', customerId: 'c', revision: 1,
    materials: [material({ evidenceId: 'e-big', text: '甲'.repeat(20000) })], allowedHashes: [hash] });
  assert.equal(pack.snippets.length, 8);
  for (const s of pack.snippets) {
    assert.match(s.hash, /^[a-f0-9]{64}$/);
    assert.equal(s.artifactId, 'art-a');
    assert.equal(s.evidenceId, 'e-big');
    assert.equal(s.parserVersion, 'v1');
    assert.equal(s.locator.end - s.locator.start, 800);
    assert.ok(['page_text', 'extracted_text'].includes(s.locator.kind));
    assert.equal(digest({ artifactId: s.artifactId, evidenceId: s.evidenceId, hash: s.hash, parserVersion: s.parserVersion,
      locator: s.locator, text: s.text, limitations: s.limitations }), s.id);
  }
  assert.equal(pack.omitted[0].evidenceId, 'e-big');
  assert.equal(pack.omitted[0].reason, 'CONTEXT_LIMIT');
  const result = validateCitations({ findings: [{ text: '有来源', evidenceRefIds: [pack.snippets[0].id] }, { text: '伪造', evidenceRefIds: ['fake'] }] }, pack);
  assert.equal(result.findings.length, 1);
  assert.equal(result.citationChecks[1].reason, 'UNVERIFIED_REFERENCE');
  assert.equal(result.evidenceRefs[0].hash, hash);
});
