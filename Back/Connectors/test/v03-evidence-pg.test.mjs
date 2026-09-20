import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { TENANT, makeProcessingHarness, setupInvitation, uploadBytes, driveToEnd } from './processing-helpers.mjs';
import { ASYNC_PARSE_VERSION } from '../../C/src/parse/adapters-async.mjs';

test('V03 isolated PG: original PDF upload → async parser persistence → registered evidence HTTP', {
  skip: !process.env.CONNECTORS_TEST_PG_PORT && 'requires explicitly isolated PostgreSQL',
}, async () => {
  const h = await makeProcessingHarness({ port: 0 });
  try {
    const customerId = 'KS-LASER-500';
    const bytes = await fs.readFile(new URL('../../../docs/materials/kashgar-demo-v1/KS-LASER-500/originals/D02-主体登记资料.pdf', import.meta.url));
    const inv = await setupInvitation(h.api, { customerId, kinds: ['document'] });
    const uploaded = await uploadBytes(h.api, inv, { customerId, kind: 'document', bytes });
    await driveToEnd(h.api);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const parsed = (await h.store.query('SELECT result, parser_version FROM parse_results WHERE tenant_id=$1 AND customer_id=$2 AND sha256=$3', [TENANT, customerId, hash])).rows;
    assert.equal(parsed.length, 1); assert.equal(parsed[0].result.ok, true);
    assert.ok(parsed[0].result.text.includes('喀什示例金属加工有限公司'));
    assert.ok(parsed[0].parser_version.startsWith(ASYNC_PARSE_VERSION));
    const request = { tenantId: TENANT, customerId, artifactIds: ['a-synthetic'] };
    assert.deepEqual((await h.api('/api/connectors/internal/assistant-evidence', request)).materials, []);
    // Explicit fixture for A's registered mapping; this does not stand in for a live A acceptance.
    await h.store.query(`INSERT INTO a_links(link_id,tenant_id,customer_id,entity_type,local_id,a_customer_id,a_ref,request_id,principal_id,status)
      VALUES ('fixture-link',$1,$2,'material',$3,$2,'a-synthetic','fixture-register','synthetic-uploader','registered')`, [TENANT, customerId, uploaded.evidenceId]);
    const evidence = await h.api('/api/connectors/internal/assistant-evidence', request);
    assert.equal(evidence.materials.length, 1); assert.equal(evidence.materials[0].hash, hash);
    assert.equal(evidence.materials[0].pages[0].page, 1);
    assert.deepEqual((await h.api('/api/connectors/internal/assistant-evidence', { ...request, customerId: 'another' })).materials, []);
    assert.deepEqual((await h.api('/api/connectors/internal/assistant-evidence', { ...request, tenantId: 'another' })).materials, []);
    await h.store.query('UPDATE evidence_artifacts SET superseded_by=$1 WHERE evidence_id=$2', ['replacement', uploaded.evidenceId]);
    assert.deepEqual((await h.api('/api/connectors/internal/assistant-evidence', request)).materials, []);
  } finally { await h.dispose(); }
});
