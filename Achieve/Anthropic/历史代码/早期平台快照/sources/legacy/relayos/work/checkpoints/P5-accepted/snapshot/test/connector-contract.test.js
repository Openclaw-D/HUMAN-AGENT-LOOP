import test from 'node:test';
import assert from 'node:assert/strict';

import { assertAdapterContract, validateExecutionReceipt } from '../src/connectors/contract.js';
import { MockExternalSystemAdapter } from '../src/connectors/mock-adapter.js';

function intent(status) {
  return { id: `action-${status}`, systemId: 'core-system', operation: 'update', inputRef: { simulateStatus: status }, idempotencyKey: `external-${status}` };
}

test('MockExternalSystemAdapter contract returns explicit success/failed/unknown receipts', async () => {
  const adapter = assertAdapterContract(new MockExternalSystemAdapter({ clock: () => '2026-08-26T00:00:00.000Z' }));
  for (const status of ['succeeded', 'failed', 'unknown']) {
    const action = intent(status);
    const receipt = validateExecutionReceipt(await adapter.execute(action), action);
    assert.equal(receipt.status, status);
    assert.equal(receipt.actionIntentId, action.id);
    assert.equal(receipt.completedAt, status === 'succeeded' ? '2026-08-26T00:00:00.000Z' : null);
    assert.deepEqual(await adapter.execute(action), receipt, 'adapter idempotency must return the same receipt');
    assert.deepEqual(await adapter.getExecutionStatus(receipt.externalRequestId), receipt);
  }
  assert.equal((await adapter.health()).mode, 'deterministic_mock');
});

test('invalid adapter or fake non-success completion fails closed', () => {
  assert.throws(() => assertAdapterContract({ execute() {} }), (error) => error.code === 'ADAPTER_CONTRACT_INVALID');
  const action = intent('failed');
  assert.throws(() => validateExecutionReceipt({ actionIntentId: action.id, adapterId: 'bad', externalRequestId: 'x', status: 'failed', attemptedAt: '2026-08-26T00:00:00.000Z', completedAt: '2026-08-26T00:00:01.000Z' }, action), (error) => error.code === 'EXECUTION_RECEIPT_INVALID');
});
