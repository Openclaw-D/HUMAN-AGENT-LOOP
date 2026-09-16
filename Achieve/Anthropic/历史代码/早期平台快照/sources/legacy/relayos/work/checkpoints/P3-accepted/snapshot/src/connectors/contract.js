import { assert } from '../domain/errors.js';
import { RECEIPT_STATUSES } from '../domain/kernel.js';

export function validateExecutionReceipt(receipt, actionIntent) {
  assert(receipt && typeof receipt === 'object', 'EXECUTION_RECEIPT_INVALID', 'adapter receipt 必须是对象。', 502);
  assert(RECEIPT_STATUSES.has(receipt.status), 'EXECUTION_RECEIPT_INVALID', 'adapter receipt status 无效。', 502);
  assert(receipt.actionIntentId === actionIntent.id, 'EXECUTION_RECEIPT_INVALID', 'receipt 必须关联 ActionIntent。', 502);
  assert(typeof receipt.adapterId === 'string' && receipt.adapterId, 'EXECUTION_RECEIPT_INVALID', 'adapterId 缺失。', 502);
  assert(typeof receipt.externalRequestId === 'string' && receipt.externalRequestId, 'EXECUTION_RECEIPT_INVALID', 'externalRequestId 缺失。', 502);
  assert(typeof receipt.attemptedAt === 'string' && !Number.isNaN(Date.parse(receipt.attemptedAt)), 'EXECUTION_RECEIPT_INVALID', 'attemptedAt 无效。', 502);
  if (receipt.status !== 'succeeded') {
    assert(receipt.completedAt === null, 'EXECUTION_RECEIPT_INVALID', '非 succeeded receipt 不能伪造 completedAt。', 502);
  }
  return structuredClone(receipt);
}

export function assertAdapterContract(adapter) {
  for (const method of ['readEvidence', 'execute', 'getExecutionStatus', 'health']) {
    assert(typeof adapter?.[method] === 'function', 'ADAPTER_CONTRACT_INVALID', `adapter 缺少 ${method}。`, 500);
  }
  return adapter;
}
