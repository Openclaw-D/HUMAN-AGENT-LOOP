import assert from 'node:assert/strict';
import test from 'node:test';
import {
  recordHumanDecision,
  getLatestDecisionReceipt,
  getDecisionReceipts,
  resetDecisionRuntime,
} from '../lib/decision-runtime.ts';

const FLOW_IDS = [
  'policy-material', 'policy-rules', 'policy-quant', 'policy-prereview', 'policy-update',
  'credit-parse', 'credit-fact', 'credit-link', 'credit-coordinate', 'credit-review',
  'commerce-contract', 'commerce-logistics', 'commerce-funding', 'commerce-payment-check', 'commerce-final-payment',
  'asset-onboard', 'asset-rent', 'asset-warning', 'asset-collection', 'asset-litigation',
];
const STAGES = ['policy', 'credit', 'commerce', 'asset'];
const RECEIPT_KEYS = ['gateId', 'receiptId', 'caseId', 'stageId', 'flowId', 'action', 'actor', 'status', 'requestId', 'recordedAt'];

function validInput(overrides = {}) {
  return { caseId: 'FL-DEMO-001', stageId: 'credit', flowId: 'credit-link', action: 'submit', actor: '林澈', requestId: 'req-1', ...overrides };
}

test('completed/active flows accept gates while locked flows fail closed', () => {
  resetDecisionRuntime();
  let idx = 0;
  let receiptCount = 0;
  const availableByStage = { policy: 2, credit: 3, commerce: 4, asset: 5 };
  for (const stage of STAGES) {
    for (let j = 0; j < 5; j++) {
      const flowId = FLOW_IDS[idx];
      const input = validInput({ stageId: stage, flowId, requestId: `req-flow-${idx}` });
      if (j < availableByStage[stage]) {
        receiptCount += 1;
        const r = recordHumanDecision(input);
        assert.equal(r.gateId, `gate-${stage}-${flowId}`);
        assert.equal(r.receiptId, `decision-${String(receiptCount).padStart(4, '0')}`);
      } else {
        assert.throws(() => recordHumanDecision(input), { code: 'FLOW_LOCKED' });
      }
      idx++;
    }
  }
  assert.equal(idx, 20);
  assert.equal(getDecisionReceipts().length, 14);
});

test('recordHumanDecision is synchronous and returns a non-Promise receipt', () => {
  resetDecisionRuntime();
  const r = recordHumanDecision(validInput({ requestId: 'req-sync' }));
  assert.ok(!(r instanceof Promise));
  assert.ok(typeof r.then !== 'function');
  assert.equal(typeof recordHumanDecision, 'function');
  assert.ok(!recordHumanDecision.toString().includes('async'));
});

test('validation priority is fixed: CASE_NOT_FOUND → … → IDEMPOTENCY_CONFLICT', () => {
  resetDecisionRuntime();
  // Seed a valid call for conflict tests.
  recordHumanDecision(validInput({ requestId: 'req-seed' }));
  // 1 CASE_NOT_FOUND beats everything (bad stage + bad flow + bad action + empty actor + empty req).
  assert.throws(() => recordHumanDecision(validInput({ caseId: 'NOPE', stageId: 'x', flowId: 'x', action: 'x', actor: ' ', requestId: ' ' })), { code: 'CASE_NOT_FOUND' });
  // 2 INVALID_STAGE beats bad flow/action/actor/requestId.
  assert.throws(() => recordHumanDecision(validInput({ stageId: 'bad', flowId: 'bad', action: 'bad', actor: ' ', requestId: ' ' })), { code: 'INVALID_STAGE' });
  // 3 INVALID_FLOW beats bad action/actor/requestId.
  assert.throws(() => recordHumanDecision(validInput({ flowId: 'bad', action: 'bad', actor: ' ', requestId: ' ' })), { code: 'INVALID_FLOW' });
  assert.throws(() => recordHumanDecision(validInput({ stageId: 'policy', flowId: 'credit-review', requestId: 'req-cross-stage' })), { code: 'INVALID_FLOW' });
  // 4 INVALID_ACTION beats empty actor/requestId.
  assert.throws(() => recordHumanDecision(validInput({ action: 'approve', actor: ' ', requestId: ' ' })), { code: 'INVALID_ACTION' });
  // 5 INVALID_ACTOR beats empty requestId.
  assert.throws(() => recordHumanDecision(validInput({ actor: '   ', requestId: '   ' })), { code: 'INVALID_ACTOR' });
  // 6 INVALID_REQUEST_ID.
  assert.throws(() => recordHumanDecision(validInput({ requestId: '' })), { code: 'INVALID_REQUEST_ID' });
  // 7 IDEMPOTENCY_CONFLICT: same key, different normalized payload.
  assert.throws(() => recordHumanDecision(validInput({ requestId: 'req-seed', action: 'reject' })), { code: 'IDEMPOTENCY_CONFLICT' });
  // Prototype-chain stageId must also be rejected as INVALID_STAGE (fail closed).
  assert.throws(() => recordHumanDecision(validInput({ stageId: 'toString', requestId: 'req-proto' })), { code: 'INVALID_STAGE' });
});

test('success receipt has exact fields, correct gateId, status and sequence', () => {
  resetDecisionRuntime();
  const r = recordHumanDecision(validInput({ requestId: 'req-exact' }));
  assert.deepEqual(Object.keys(r).sort(), RECEIPT_KEYS.sort());
  assert.equal(r.gateId, 'gate-credit-credit-link');
  assert.equal(r.caseId, 'FL-DEMO-001');
  assert.equal(r.stageId, 'credit');
  assert.equal(r.flowId, 'credit-link');
  assert.equal(r.action, 'submit');
  assert.equal(r.actor, '林澈');
  assert.equal(r.status, 'recorded');
  assert.equal(r.requestId, 'req-exact');
  assert.equal(r.receiptId, 'decision-0001');
  assert.ok(!Number.isNaN(Date.parse(r.recordedAt)));
});

test('actor/requestId are trimmed and whitespace-only fails closed', () => {
  resetDecisionRuntime();
  const r = recordHumanDecision(validInput({ actor: '  林澈  ', requestId: '  req-trim  ' }));
  assert.equal(r.actor, '林澈');
  assert.equal(r.requestId, 'req-trim');
  // Trimmed replay with raw whitespace keys returns the same receipt.
  const replay = recordHumanDecision(validInput({ actor: '林澈', requestId: 'req-trim' }));
  assert.deepEqual(replay, r);
  // Whitespace-only actor/requestId fail closed.
  assert.throws(() => recordHumanDecision(validInput({ actor: '   ', requestId: 'req-a' })), { code: 'INVALID_ACTOR' });
  assert.throws(() => recordHumanDecision(validInput({ requestId: '   ' })), { code: 'INVALID_REQUEST_ID' });
  assert.throws(() => recordHumanDecision(validInput({ actor: '人'.repeat(81), requestId: 'req-long-actor' })), { code: 'INVALID_ACTOR' });
  assert.throws(() => recordHumanDecision(validInput({ requestId: 'r'.repeat(161) })), { code: 'INVALID_REQUEST_ID' });
});

test('same requestId + same normalized payload replays identically; receiptId does not advance', () => {
  resetDecisionRuntime();
  const a = recordHumanDecision(validInput({ requestId: 'req-replay' }));
  const b = recordHumanDecision(validInput({ requestId: 'req-replay' }));
  assert.deepEqual(b, a);
  assert.equal(b.receiptId, a.receiptId);
  assert.equal(getDecisionReceipts().length, 1);
});

test('same requestId + different payload throws IDEMPOTENCY_CONFLICT and does not write', () => {
  resetDecisionRuntime();
  recordHumanDecision(validInput({ requestId: 'req-conflict' }));
  const before = getDecisionReceipts();
  assert.throws(() => recordHumanDecision(validInput({ requestId: 'req-conflict', flowId: 'credit-parse' })), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.throws(() => recordHumanDecision(validInput({ requestId: 'req-conflict', actor: '别人' })), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.throws(() => recordHumanDecision(validInput({ requestId: 'req-conflict', action: 'reject' })), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(getDecisionReceipts(), before);
});

test('8 synchronous repeated calls share one receipt and do not duplicate', () => {
  resetDecisionRuntime();
  const input = validInput({ requestId: 'req-x8' });
  const results = Array.from({ length: 8 }, () => recordHumanDecision(input));
  const first = JSON.stringify(results[0]);
  assert.ok(results.every((r) => JSON.stringify(r) === first));
  assert.equal(getDecisionReceipts().length, 1);
});

test('latest and list reads return deep clones; mutation does not pollute runtime', () => {
  resetDecisionRuntime();
  recordHumanDecision(validInput({ requestId: 'req-clone-a' }));
  recordHumanDecision(validInput({ requestId: 'req-clone-b' }));
  const latest1 = getLatestDecisionReceipt();
  latest1.actor = '篡改';
  latest1.status = 'hacked';
  const latest2 = getLatestDecisionReceipt();
  assert.equal(latest2.actor, '林澈');
  assert.equal(latest2.status, 'recorded');

  const list1 = getDecisionReceipts();
  list1.pop();
  list1[0].receiptId = 'decision-9999';
  const list2 = getDecisionReceipts();
  assert.equal(list2.length, 2);
  assert.equal(list2[0].receiptId, 'decision-0001');
  assert.equal(list2[1].receiptId, 'decision-0002');
  assert.equal(getLatestDecisionReceipt().receiptId, 'decision-0002');
});

test('resetDecisionRuntime fully clears receipts and restarts sequence from decision-0001', () => {
  resetDecisionRuntime();
  recordHumanDecision(validInput({ requestId: 'req-pre-reset' }));
  recordHumanDecision(validInput({ requestId: 'req-pre-reset-2' }));
  assert.equal(getDecisionReceipts().length, 2);
  resetDecisionRuntime();
  assert.equal(getDecisionReceipts().length, 0);
  assert.equal(getLatestDecisionReceipt(), undefined);
  // Old requestId is forgotten after reset — a fresh call is a new record, not a replay.
  const fresh = recordHumanDecision(validInput({ requestId: 'req-pre-reset' }));
  assert.equal(fresh.receiptId, 'decision-0001');
});

test('failures do not write receipts and do not advance the sequence', () => {
  resetDecisionRuntime();
  recordHumanDecision(validInput({ requestId: 'req-ok' }));
  const snapshot = getDecisionReceipts();
  const badCalls = [
    () => recordHumanDecision(validInput({ caseId: 'OTHER', requestId: 'req-bad1' })),
    () => recordHumanDecision(validInput({ stageId: 'unknown', requestId: 'req-bad2' })),
    () => recordHumanDecision(validInput({ flowId: 'unknown-flow', requestId: 'req-bad3' })),
    () => recordHumanDecision(validInput({ action: 'maybe', requestId: 'req-bad4' })),
    () => recordHumanDecision(validInput({ actor: '', requestId: 'req-bad5' })),
    () => recordHumanDecision(validInput({ requestId: '' })),
  ];
  for (const call of badCalls) assert.throws(call);
  assert.deepEqual(getDecisionReceipts(), snapshot);
  assert.equal(getDecisionReceipts().length, 1);
  // Next valid call continues from decision-0002 (failures consumed no sequence).
  const next = recordHumanDecision(validInput({ requestId: 'req-after-failures' }));
  assert.equal(next.receiptId, 'decision-0002');
});
