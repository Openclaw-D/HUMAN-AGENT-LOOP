'use strict';

const assert = require('node:assert/strict');
const { reconcileCheckpoints } = require('./ledger.cjs');

const protoExpected = [{ id: '__proto__', requiredFiles: ['safe'], requiredChecks: ['gate'] }];
const protoObserved = [{ id: '__proto__', files: ['safe'], checks: ['gate'], terminal: 'completed' }];
const protoResult = reconcileCheckpoints(protoExpected, protoObserved);
assert.deepStrictEqual(protoResult, { accepted: ['__proto__'], rejected: [], missing: [], unexpected: [] });
assert.strictEqual(Object.getPrototypeOf({}), Object.prototype);

const expected = [{ id: 'clone', requiredFiles: ['a', 'b'], requiredChecks: ['x'] }];
const observed = [{ id: 'clone', files: ['a'], checks: ['x'], terminal: 'completed' }];
const result = reconcileCheckpoints(expected, observed);
assert.ok(!(result instanceof Promise), 'API must stay synchronous');
result.rejected[0].missingFiles.push('mutated');
assert.deepStrictEqual(expected[0].requiredFiles, ['a', 'b']);
assert.deepStrictEqual(observed[0].files, ['a']);

assert.throws(
  () => reconcileCheckpoints([{ id: 'x', requiredFiles: ['a', 'a'], requiredChecks: [] }], []),
  { name: 'TypeError', message: /duplicate requiredFiles/ },
);
assert.throws(
  () => reconcileCheckpoints([], [{ id: 'x', files: [], checks: [], terminal: 'unknown' }]),
  { name: 'TypeError', message: /terminal/ },
);
assert.throws(() => reconcileCheckpoints('not-array', []), { name: 'TypeError' });

console.log('stage1 controller passed');

