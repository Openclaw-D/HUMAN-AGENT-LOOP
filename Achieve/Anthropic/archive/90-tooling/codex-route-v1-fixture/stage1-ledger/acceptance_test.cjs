'use strict';

const assert = require('node:assert/strict');
const { reconcileCheckpoints } = require('./ledger.cjs');

const expected = [
  { id: 'alpha', requiredFiles: ['a.js', 'a.test.js'], requiredChecks: ['unit', 'lint'] },
  { id: 'beta', requiredFiles: ['b.py'], requiredChecks: ['unit'] },
  { id: 'gamma', requiredFiles: ['g.ps1'], requiredChecks: ['parser'] },
];

const observed = [
  { id: 'alpha', files: ['a.test.js', 'a.js', 'extra.md'], checks: ['lint', 'unit'], terminal: 'completed' },
  { id: 'beta', files: ['b.py'], checks: [], terminal: 'completed' },
  { id: 'orphan', files: ['x.txt'], checks: ['unit'], terminal: 'completed' },
];

assert.deepStrictEqual(reconcileCheckpoints(expected, observed), {
  accepted: ['alpha'],
  rejected: [{ id: 'beta', terminal: 'completed', missingFiles: [], missingChecks: ['unit'] }],
  missing: ['gamma'],
  unexpected: ['orphan'],
});

assert.deepStrictEqual(
  reconcileCheckpoints(
    [{ id: 'failed', requiredFiles: [], requiredChecks: [] }],
    [{ id: 'failed', files: [], checks: [], terminal: 'failed' }],
  ),
  {
    accepted: [],
    rejected: [{ id: 'failed', terminal: 'failed', missingFiles: [], missingChecks: [] }],
    missing: [],
    unexpected: [],
  },
);

assert.throws(
  () => reconcileCheckpoints([expected[0], expected[0]], []),
  { name: 'TypeError', message: /duplicate expected id/ },
);
assert.throws(
  () => reconcileCheckpoints([], [observed[0], observed[0]]),
  { name: 'TypeError', message: /duplicate observed id/ },
);
assert.throws(
  () => reconcileCheckpoints([{ id: '', requiredFiles: [], requiredChecks: [] }], []),
  { name: 'TypeError' },
);

console.log('stage1 acceptance passed');

