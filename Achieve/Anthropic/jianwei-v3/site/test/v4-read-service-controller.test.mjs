import assert from 'node:assert/strict';
import test from 'node:test';

import { readV4CaseProjection } from '../lib/v4/read-service.ts';

test('controller: inherited object keys are never resolved as server sessions', () => {
  for (const sessionId of ['__proto__', 'constructor', 'prototype', 'toString']) {
    assert.throws(
      () => readV4CaseProjection({ sessionId, caseId: 'CASE-V4-SYNTH-001' }),
      (error) => {
        assert.equal(error?.code, 'SESSION_NOT_FOUND', sessionId);
        return true;
      },
    );
  }
});
