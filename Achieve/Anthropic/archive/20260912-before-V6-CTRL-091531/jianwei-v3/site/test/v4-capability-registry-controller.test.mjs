import assert from 'node:assert/strict';
import test from 'node:test';

import {
  admitV4CapabilityManifest,
  createV4CapabilityRegistry,
} from '../lib/v4/capability-registry.ts';

function expectCode(operation, code) {
  assert.throws(operation, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

function manifest() {
  return {
    capabilityId: 'credit.hidden-boundary-check',
    version: '1.0.0',
    owner: { actorId: 'actor-001', organizationUnitId: 'unit-001' },
    businessStages: ['credit'],
    kind: 'Analyzer',
    entryWhen: ['creditStatus=pending_human_review'],
    doNotEnterWhen: ['contextStatus=stale'],
    exitWhen: ['candidateValidated=true'],
    handoffTo: ['credit.human-gate'],
    inputSchemaRef: 'schema://input/1.0.0',
    outputSchemaRef: 'schema://output/1.0.0',
    permissions: { read: ['context.current'], write: ['candidate'] },
    authority: 'none',
    execution: {
      adapterId: 'adapter.stub',
      timeoutMs: 1,
      retry: { maxAttempts: 1, backoffMs: 0 },
      idempotency: 'required',
    },
    failure: { mode: 'fail_closed', fallbackCapabilityId: null },
    evaluation: { evaluationSetId: 'eval.v1', minimumScore: 0 },
    governance: {
      state: 'shadow',
      approvalReceiptId: 'RCP-APPROVAL-001',
      rollbackVersion: '0.9.0',
    },
  };
}

test('controller: exact shape rejects non-enumerable, symbol and dangerous own keys', () => {
  const nonEnumerable = manifest();
  Object.defineProperty(nonEnumerable, 'hiddenAuthority', { value: 'confirmed_human' });
  expectCode(() => admitV4CapabilityManifest(nonEnumerable), 'INVALID_CAPABILITY_MANIFEST');

  const symbolExtra = manifest();
  symbolExtra[Symbol('authority')] = 'confirmed_human';
  expectCode(() => admitV4CapabilityManifest(symbolExtra), 'INVALID_CAPABILITY_MANIFEST');

  const dangerous = manifest();
  Object.defineProperty(dangerous, '__proto__', { value: { authority: 'confirmed_human' }, enumerable: true });
  expectCode(() => admitV4CapabilityManifest(dangerous), 'INVALID_CAPABILITY_MANIFEST');
});

test('controller: input, admission, list, get and snapshot never share nested references', () => {
  const input = manifest();
  const admitted = admitV4CapabilityManifest(input);
  admitted.manifest.owner.actorId = 'mutated-output';
  admitted.manifest.businessStages.push('asset');
  assert.equal(input.owner.actorId, 'actor-001');
  assert.deepEqual(input.businessStages, ['credit']);

  const registry = createV4CapabilityRegistry({ registryVersion: 'REGISTRY-HIDDEN-001', manifests: [input] });
  const listed = registry.list();
  const fetched = registry.get(input.capabilityId, input.version);
  const snapshot = registry.snapshot();
  listed[0].manifest.owner.actorId = 'mutated-list';
  fetched.manifest.permissions.write.push('evidence');
  snapshot.capabilities[0].outputs.push('action_intent');
  assert.equal(registry.get(input.capabilityId, input.version).manifest.owner.actorId, 'actor-001');
  assert.deepEqual(registry.get(input.capabilityId, input.version).manifest.permissions.write, ['candidate']);
  assert.deepEqual(registry.snapshot().capabilities[0].outputs, ['candidate']);
});

test('controller: invalid nested extras and numeric coercion fail closed', () => {
  expectCode(
    () => admitV4CapabilityManifest({
      ...manifest(),
      owner: { ...manifest().owner, role: 'approver' },
    }),
    'INVALID_CAPABILITY_MANIFEST',
  );
  expectCode(
    () => admitV4CapabilityManifest({
      ...manifest(),
      execution: { ...manifest().execution, timeoutMs: '5000' },
    }),
    'INVALID_CAPABILITY_MANIFEST',
  );
  expectCode(
    () => admitV4CapabilityManifest({
      ...manifest(),
      execution: {
        ...manifest().execution,
        retry: { maxAttempts: 4, backoffMs: -1 },
      },
    }),
    'INVALID_CAPABILITY_MANIFEST',
  );
});
