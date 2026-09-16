import assert from 'node:assert/strict';
import test from 'node:test';

import { GET as readCase } from '../app/api/v4/cases/[caseId]/route.ts';
import { GET as readManagement } from '../app/api/v4/management/projection/route.ts';

async function assertProjectionFailure(response) {
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: 'PROJECTION_INVALID' } });
}

test('controller: lookalike error codes on unexpected exceptions never bypass 503 fail-closed mapping', async () => {
  const lookalike = Object.assign(new Error('unexpected internal failure'), {
    code: 'READ_DENIED',
  });

  await assertProjectionFailure(await readCase(
    new Request('https://example.test/api/v4/cases/CASE-V4-SYNTH-001', {
      headers: { 'x-v4-session-id': 'SESSION-CASE-ALLOWED' },
    }),
    { params: Promise.reject(lookalike) },
  ));

  await assertProjectionFailure(await readManagement({
    get url() {
      throw lookalike;
    },
    headers: new Headers({ 'x-v4-session-id': 'SESSION-MANAGEMENT-ALLOWED' }),
  }));
});
