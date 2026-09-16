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

function manifest(overrides = {}) {
  return {
    capabilityId: 'credit.material-gap-analyzer',
    version: '1.0.0',
    owner: {
      actorId: 'actor-intelligence-owner-001',
      organizationUnitId: 'unit-intelligence-001',
    },
    businessStages: ['credit'],
    kind: 'Analyzer',
    entryWhen: ['reviewPath=exception', 'creditStatus=pending_human_review'],
    doNotEnterWhen: ['contextStatus=stale', 'attemptStatus!=active'],
    exitWhen: ['candidateValidated=true', 'runStatus=failed'],
    handoffTo: ['credit.human-gate'],
    inputSchemaRef: 'schema://v4/credit/material-gap-input/1.0.0',
    outputSchemaRef: 'schema://v4/credit/material-gap-candidate/1.0.0',
    permissions: {
      read: ['case.classification', 'context.current', 'evidence.accepted'],
      write: ['candidate'],
    },
    authority: 'none',
    execution: {
      adapterId: 'adapter.local-deterministic-stub',
      timeoutMs: 5_000,
      retry: { maxAttempts: 2, backoffMs: 100 },
      idempotency: 'required',
    },
    failure: {
      mode: 'fail_closed',
      fallbackCapabilityId: null,
    },
    evaluation: {
      evaluationSetId: 'eval.credit-material-gap.v1',
      minimumScore: 0.85,
    },
    governance: {
      state: 'active',
      approvalReceiptId: 'RCP-CAPABILITY-APPROVAL-001',
      rollbackVersion: '0.9.0',
    },
    ...overrides,
  };
}

test('admits an exact active manifest while preserving the non-authoritative output boundary', () => {
  const input = manifest();
  const result = admitV4CapabilityManifest(input);
  assert.equal(result instanceof Promise, false);
  assert.deepEqual(Object.keys(result), ['manifest', 'admission']);
  assert.deepEqual(result.admission, {
    status: 'admitted',
    checks: [
      'manifest-exact-shape',
      'authority-none',
      'output-boundary',
      'governance-eligible',
    ],
  });
  assert.equal(result.manifest.authority, 'none');
  assert.deepEqual(result.manifest.permissions.write, ['candidate']);
  assert.notEqual(result.manifest, input);
  assert.notEqual(result.manifest.owner, input.owner);
  assert.notEqual(result.manifest.permissions.write, input.permissions.write);
});

test('fails closed when a capability claims authority or canonical receipt writes', () => {
  expectCode(
    () => admitV4CapabilityManifest(manifest({ authority: 'confirmed_human' })),
    'CAPABILITY_AUTHORITY_FORBIDDEN',
  );
  expectCode(
    () => admitV4CapabilityManifest(manifest({
      permissions: { read: ['context.current'], write: ['candidate', 'receipt'] },
    })),
    'CAPABILITY_OUTPUT_FORBIDDEN',
  );
});

test('admits only shadow or active versions with approval and rollback evidence', () => {
  expectCode(
    () => admitV4CapabilityManifest(manifest({
      governance: { ...manifest().governance, state: 'approved' },
    })),
    'CAPABILITY_NOT_ADMISSIBLE',
  );
  expectCode(
    () => admitV4CapabilityManifest(manifest({
      governance: { ...manifest().governance, approvalReceiptId: '' },
    })),
    'INVALID_CAPABILITY_MANIFEST',
  );
  expectCode(
    () => admitV4CapabilityManifest(manifest({
      governance: { ...manifest().governance, rollbackVersion: '' },
    })),
    'INVALID_CAPABILITY_MANIFEST',
  );
});

test('validates exact manifest shape and bounded execution/evaluation fields', () => {
  expectCode(
    () => admitV4CapabilityManifest({ ...manifest(), unexpected: true }),
    'INVALID_CAPABILITY_MANIFEST',
  );
  const missing = manifest();
  delete missing.entryWhen;
  expectCode(() => admitV4CapabilityManifest(missing), 'INVALID_CAPABILITY_MANIFEST');
  for (const timeoutMs of [0, 300_001, 1.5, Number.NaN, true]) {
    expectCode(
      () => admitV4CapabilityManifest(manifest({
        execution: { ...manifest().execution, timeoutMs },
      })),
      'INVALID_CAPABILITY_MANIFEST',
    );
  }
  for (const minimumScore of [-0.01, 1.01, Number.NaN, true]) {
    expectCode(
      () => admitV4CapabilityManifest(manifest({
        evaluation: { ...manifest().evaluation, minimumScore },
      })),
      'INVALID_CAPABILITY_MANIFEST',
    );
  }
});

test('registry rejects duplicate capability versions and returns stable cloned projections', () => {
  const second = manifest({
    capabilityId: 'credit.fact-extractor',
    kind: 'Extractor',
    permissions: { read: ['evidence.accepted'], write: ['evidence'] },
  });
  const registry = createV4CapabilityRegistry({
    registryVersion: 'REGISTRY-V4-001',
    manifests: [manifest(), second],
  });
  assert.equal(registry instanceof Promise, false);
  assert.equal(registry.registryVersion, 'REGISTRY-V4-001');
  assert.deepEqual(registry.list().map(({ manifest: item }) => item.capabilityId), [
    'credit.fact-extractor',
    'credit.material-gap-analyzer',
  ]);
  assert.equal(registry.get('credit.material-gap-analyzer', '1.0.0').manifest.authority, 'none');
  assert.deepEqual(registry.snapshot(), {
    registryVersion: 'REGISTRY-V4-001',
    capabilities: [
      {
        capabilityId: 'credit.fact-extractor',
        version: '1.0.0',
        owner: second.owner,
        businessStages: ['credit'],
        kind: 'Extractor',
        governanceState: 'active',
        authority: 'none',
        outputs: ['evidence'],
      },
      {
        capabilityId: 'credit.material-gap-analyzer',
        version: '1.0.0',
        owner: manifest().owner,
        businessStages: ['credit'],
        kind: 'Analyzer',
        governanceState: 'active',
        authority: 'none',
        outputs: ['candidate'],
      },
    ],
  });
  expectCode(
    () => createV4CapabilityRegistry({
      registryVersion: 'REGISTRY-V4-002',
      manifests: [manifest(), manifest()],
    }),
    'DUPLICATE_CAPABILITY_VERSION',
  );
  expectCode(() => registry.get('missing.capability', '1.0.0'), 'CAPABILITY_NOT_FOUND');
});
