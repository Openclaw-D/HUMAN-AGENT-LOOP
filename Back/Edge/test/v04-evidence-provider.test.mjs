import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createAssistantEvidenceProvider } from '../src/assistant-evidence-provider.mjs';
import { prepareEvidence } from '../src/assistant-evidence.mjs';
import { digest, stable } from '../src/assistant-receipts.mjs';

const hashes = { 'art-a': 'a'.repeat(64), 'art-b': 'b'.repeat(64), 'art-c': 'c'.repeat(64) };
const textOf = { 'art-a': '甲客户销售合同未付余额118万元。', 'art-b': '乙客户申请金额500万元。', 'art-c': '丙客户抵押物为厂房设备。' };
const catalog = new Map(Object.entries(hashes).map(([artifactId, hash]) => [artifactId, {
  tenantId: 't', customerId: 'c', artifactId, evidenceId: 'e-' + artifactId.slice(-1), hash,
  parserVersion: 'v1', current: true, text: textOf[artifactId], pages: [], facts: [], limitations: [] }]));
const allMaterials = [...catalog.values()].sort((x, y) => x.evidenceId.localeCompare(y.evidenceId));
const snapshot = readable => ({ snapshot: { artifactsReadable: readable ?? true,
  artifacts: ['art-a', 'art-b', 'art-c'].map(artifactId => ({ artifactId })) } });
const policy = () => ({ allowedHashes: Object.values(hashes), maxChars: 12000 });

async function startStub(t) {
  const state = { hits: 0, bodies: [], mode: null, drop: new Set() };
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', d => body += d); req.on('end', () => {
      state.hits++;
      const parsed = JSON.parse(body);
      state.bodies.push(parsed);
      const send = (status, payload) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(payload)); };
      if (state.mode === 'http500') return send(500, { ok: false, error: 'EVIDENCE_PARSE_INVALID' });
      if (state.mode === 'okfalse') return send(200, { ok: false, error: 'EVIDENCE_INPUT_INVALID' });
      let materials = parsed.artifactIds.filter(id => catalog.has(id) && !state.drop.has(id)).map(id => catalog.get(id));
      if (state.mode === 'wrongCustomer') materials = materials.map(m => ({ ...m, customerId: 'other-c' }));
      if (state.mode === 'wrongTenant') materials = materials.map(m => ({ ...m, tenantId: 'other-t' }));
      if (state.mode === 'extra' && !parsed.artifactIds.includes('art-c')) materials = [...materials, catalog.get('art-c')];
      send(200, { ok: true, materials });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); return new Promise(r => server.close(r)); });
  const provider = createAssistantEvidenceProvider({ baseUrl: `http://127.0.0.1:${server.address().port}`,
    token: 'synthetic-token', policy });
  return { state, provider };
}

test('single material selection: only the selected artifact enters request body and evidence pack', async t => {
  const { state, provider } = await startStub(t);
  const pack = await provider({ snapshot: snapshot(), tenantId: 't', customerId: 'c', revision: 1, scope: { artifactIds: ['art-b'] } });
  assert.deepEqual(state.bodies[0], { tenantId: 't', customerId: 'c', artifactIds: ['art-b'] });
  assert.ok(pack.snippets.length >= 1);
  assert.ok(pack.snippets.every(s => s.artifactId === 'art-b' && s.evidenceId === 'e-b'));
  const serialized = stable(pack);
  assert.ok(!serialized.includes(textOf['art-a']) && !serialized.includes(textOf['art-c']));
  assert.deepEqual(pack.selection, { mode: 'explicit', artifactIds: ['art-b'], summary: digest({ v: 1, mode: 'explicit', artifactIds: ['art-b'] }) });
});

test('combined selection: canonical ids upstream, both materials packed, unselected excluded', async t => {
  const { state, provider } = await startStub(t);
  const pack = await provider({ snapshot: snapshot(), tenantId: 't', customerId: 'c', revision: 1, scope: { artifactIds: ['art-b', 'art-a'] } });
  assert.deepEqual(state.bodies[0].artifactIds, ['art-a', 'art-b']);
  assert.deepEqual(pack.snippets.map(s => s.evidenceId).filter((v, i, a) => a.indexOf(v) === i).sort(), ['e-a', 'e-b']);
  assert.ok(!stable(pack).includes(textOf['art-c']));
  const { selection, ...packWithoutSelection } = pack;
  assert.deepEqual(packWithoutSelection,
    prepareEvidence({ tenantId: 't', customerId: 'c', revision: 1, materials: [catalog.get('art-a'), catalog.get('art-b')], ...policy() }));
});

test('legacy call (no scope): byte-compatible request order and pack identical to direct prepareEvidence', async t => {
  const { state, provider } = await startStub(t);
  const pack = await provider({ snapshot: snapshot(), tenantId: 't', customerId: 'c', revision: 1 });
  assert.deepEqual(state.bodies[0], { tenantId: 't', customerId: 'c', artifactIds: ['art-a', 'art-b', 'art-c'] });
  assert.equal(pack.selection, undefined);
  assert.deepEqual(pack, prepareEvidence({ tenantId: 't', customerId: 'c', revision: 1, materials: allMaterials, ...policy() }));
});

test('duplicate and out-of-order ids normalize to one canonical selection with stable summary', async t => {
  const { state, provider } = await startStub(t);
  const messy = await provider({ snapshot: snapshot(), tenantId: 't', customerId: 'c', revision: 1, scope: { artifactIds: ['art-b', 'art-a', 'art-b', 'art-a'] } });
  const clean = await provider({ snapshot: snapshot(), tenantId: 't', customerId: 'c', revision: 1, scope: { artifactIds: ['art-a', 'art-b'] } });
  assert.equal(state.hits, 2);
  assert.ok(state.bodies.every(b => JSON.stringify(b.artifactIds) === JSON.stringify(['art-a', 'art-b'])));
  assert.deepEqual(messy, clean);
  assert.equal(messy.selection.summary, clean.selection.summary);
});

test('empty selection rejected before any upstream call, never falls back to all materials', async t => {
  const { state, provider } = await startStub(t);
  await assert.rejects(provider({ snapshot: snapshot(), tenantId: 't', customerId: 'c', revision: 1, scope: { artifactIds: [] } }), /EVIDENCE_SCOPE_EMPTY/);
  assert.equal(state.hits, 0);
});

test('partially illegal selection rejected whole with zero upstream calls and no silent widening', async t => {
  const { state, provider } = await startStub(t);
  try {
    await provider({ snapshot: snapshot(), tenantId: 't', customerId: 'c', revision: 1, scope: { artifactIds: ['art-a', 'ghost'] } });
    assert.fail('should reject');
  } catch (e) {
    assert.match(e.message, /EVIDENCE_SCOPE_UNAUTHORIZED/);
    assert.deepEqual(e.detail, ['ghost']);
  }
  assert.equal(state.hits, 0);
  assert.ok(state.bodies.every(b => !b.artifactIds.includes('art-c')));
});

test('cross-customer and cross-tenant ids fail closed; upstream wrong-owner materials rejected item by item', async t => {
  {
    const { state, provider } = await startStub(t);
    const otherCustomerSnapshot = { snapshot: { artifactsReadable: true, artifacts: [{ artifactId: 'art-a' }] } };
    await assert.rejects(provider({ snapshot: otherCustomerSnapshot, tenantId: 't', customerId: 'c', revision: 1, scope: { artifactIds: ['art-b'] } }),
      /EVIDENCE_SCOPE_UNAUTHORIZED/);
    assert.equal(state.hits, 0);
  }
  for (const mode of ['wrongCustomer', 'wrongTenant']) {
    const { state, provider } = await startStub(t);
    state.mode = mode;
    await assert.rejects(provider({ snapshot: snapshot(), tenantId: 't', customerId: 'c', revision: 1, scope: { artifactIds: ['art-a'] } }),
      /EVIDENCE_NOT_AUTHORIZED/);
    assert.equal(state.hits, 1);
  }
});

test('superseded material: explicit scope rejects incomplete set; legacy keeps historical subset semantics', async t => {
  {
    const { state, provider } = await startStub(t);
    state.drop.add('art-b');
    try {
      await provider({ snapshot: snapshot(), tenantId: 't', customerId: 'c', revision: 1, scope: { artifactIds: ['art-a', 'art-b'] } });
      assert.fail('should reject');
    } catch (e) {
      assert.match(e.message, /EVIDENCE_SCOPE_INCOMPLETE/);
      assert.deepEqual(e.detail, ['art-b']);
    }
  }
  {
    const { state, provider } = await startStub(t);
    state.drop.add('art-b');
    const pack = await provider({ snapshot: snapshot(), tenantId: 't', customerId: 'c', revision: 1 });
    assert.ok(pack.snippets.some(s => s.evidenceId === 'e-a'));
    assert.ok(!pack.snippets.some(s => s.evidenceId === 'e-b'));
    assert.equal(pack.selection, undefined);
  }
});

test('upstream returning more than requested rejected as mapping invalid', async t => {
  const { state, provider } = await startStub(t);
  state.mode = 'extra';
  await assert.rejects(provider({ snapshot: snapshot(), tenantId: 't', customerId: 'c', revision: 1, scope: { artifactIds: ['art-a'] } }),
    /EVIDENCE_MAPPING_INVALID/);
});

test('upstream failure surfaces as unavailable (http 500) and ok:false body as mapping invalid', async t => {
  {
    const { state, provider } = await startStub(t);
    state.mode = 'http500';
    await assert.rejects(provider({ snapshot: snapshot(), tenantId: 't', customerId: 'c', revision: 1, scope: { artifactIds: ['art-a'] } }),
      /EVIDENCE_UPSTREAM_UNAVAILABLE/);
  }
  {
    const { state, provider } = await startStub(t);
    state.mode = 'okfalse';
    await assert.rejects(provider({ snapshot: snapshot(), tenantId: 't', customerId: 'c', revision: 1, scope: { artifactIds: ['art-a'] } }),
      /EVIDENCE_MAPPING_INVALID/);
  }
});

test('context truncation under explicit selection: 8-snippet cap, disclosed omissions, traceable provenance', async t => {
  const { provider } = await startStub(t);
  catalog.get('art-a').text = '甲'.repeat(20000);
  try {
    const pack = await provider({ snapshot: snapshot(), tenantId: 't', customerId: 'c', revision: 1, scope: { artifactIds: ['art-a'] } });
    assert.equal(pack.snippets.length, 8);
    assert.ok(pack.snippets.every(s => s.text.length === 800 && s.artifactId === 'art-a'));
    assert.deepEqual(pack.omitted[0], { evidenceId: 'e-a', reason: 'CONTEXT_LIMIT' });
    assert.match(pack.snippets[0].hash, /^[a-f0-9]{64}$/);
    assert.equal(pack.snippets[0].locator.kind, 'extracted_text');
  } finally { catalog.get('art-a').text = textOf['art-a']; }
});

test('unreadable inventory fails closed for both legacy and explicit; malformed scope rejected', async t => {
  const { state, provider } = await startStub(t);
  await assert.rejects(provider({ snapshot: snapshot(false), tenantId: 't', customerId: 'c', revision: 1 }), /EVIDENCE_INVENTORY_UNAUTHORIZED/);
  await assert.rejects(provider({ snapshot: snapshot(false), tenantId: 't', customerId: 'c', revision: 1, scope: { artifactIds: ['art-a'] } }),
    /EVIDENCE_INVENTORY_UNAUTHORIZED/);
  await assert.rejects(provider({ snapshot: snapshot(), tenantId: 't', customerId: 'c', revision: 1, scope: 'all' }), /EVIDENCE_SCOPE_INVALID/);
  assert.equal(state.hits, 0);
});
