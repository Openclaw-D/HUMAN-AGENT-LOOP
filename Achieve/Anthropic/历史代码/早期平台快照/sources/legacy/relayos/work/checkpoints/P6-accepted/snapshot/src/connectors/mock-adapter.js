import { canonicalHash } from '../domain/canonical.js';
import { validateExecutionReceipt } from './contract.js';

export class MockExternalSystemAdapter {
  constructor({ adapterId = 'mock-external-system-v1', clock = () => new Date().toISOString() } = {}) {
    this.adapterId = adapterId;
    this.clock = clock;
    this.receipts = new Map();
  }

  async readEvidence(query) {
    return { items: [], nextCursor: null, queryHash: canonicalHash(query) };
  }

  async execute(actionIntent, { signal } = {}) {
    if (signal?.aborted) throw Object.assign(new Error('Mock connector aborted.'), { code: 'CONNECTOR_ABORTED' });
    const existing = this.receipts.get(actionIntent.idempotencyKey);
    if (existing) return structuredClone(existing);
    const attemptedAt = this.clock();
    const status = actionIntent.inputRef?.simulateStatus ?? 'succeeded';
    const receipt = {
      id: `${actionIntent.id}:receipt:mock`,
      actionIntentId: actionIntent.id,
      adapterId: this.adapterId,
      externalRequestId: `mock:${actionIntent.idempotencyKey}`,
      status,
      externalRecordRefs: status === 'succeeded' ? [{ systemId: actionIntent.systemId, recordType: 'mock-result', recordId: actionIntent.id, observedVersion: '1' }] : [],
      resultHash: canonicalHash({ actionIntentId: actionIntent.id, status }),
      attemptedAt,
      completedAt: status === 'succeeded' ? attemptedAt : null,
      errorClass: status === 'failed' ? 'mock_failure' : status === 'unknown' ? 'mock_unknown' : null,
    };
    const validated = validateExecutionReceipt(receipt, actionIntent);
    this.receipts.set(actionIntent.idempotencyKey, validated);
    return structuredClone(validated);
  }

  async getExecutionStatus(externalRequestId) {
    return structuredClone([...this.receipts.values()].find((item) => item.externalRequestId === externalRequestId) ?? null);
  }

  async health({ signal } = {}) {
    if (signal?.aborted) throw Object.assign(new Error('Mock connector health aborted.'), { code: 'CONNECTOR_ABORTED' });
    return { status: 'ok', adapterId: this.adapterId, mode: 'deterministic_mock' };
  }
}
