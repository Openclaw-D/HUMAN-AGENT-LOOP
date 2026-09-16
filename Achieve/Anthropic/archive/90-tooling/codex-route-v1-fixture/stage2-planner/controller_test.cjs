'use strict';
const assert = require('node:assert/strict');
const { planJobs } = require('./planner.cjs');
function expectCode(fn, code) { assert.throws(fn, (e) => e && e.name === 'PlannerError' && e.code === code); }

expectCode(() => planJobs(null), 'INVALID_JOBS');
expectCode(() => planJobs([{ id: '', dependsOn: [], payload: {} }]), 'INVALID_JOB_ID');
expectCode(() => planJobs([
  { id: '__proto__', dependsOn: [], payload: {} },
  { id: '__proto__', dependsOn: [], payload: {} },
]), 'DUPLICATE_JOB_ID');
expectCode(() => planJobs([{ id: 'a', dependsOn: ['a'], payload: {} }]), 'SELF_DEPENDENCY');
expectCode(() => planJobs([{ id: 'a', dependsOn: ['missing'], payload: {} }]), 'UNKNOWN_DEPENDENCY');

assert.throws(
  () => planJobs([
    { id: 'a', dependsOn: ['b'], payload: {} },
    { id: 'b', dependsOn: ['a'], payload: {} },
    { id: 'free', dependsOn: [], payload: {} },
  ]),
  (e) => e && e.name === 'PlannerError' && e.code === 'CYCLE' && assert.deepStrictEqual(e.details, { remainingIds: ['a', 'b'] }) === undefined,
);

const jobs = [
  { id: '__proto__', dependsOn: [], payload: { nested: [1] } },
  { id: 'second', dependsOn: [], payload: { nested: [2] } },
];
const result = planJobs(jobs);
jobs[0].payload.nested.push(9);
result.layers[0].push('mutated');
result.jobs[0].payload.nested.push(8);
assert.deepStrictEqual(planJobs([
  { id: '__proto__', dependsOn: [], payload: { nested: [1] } },
  { id: 'second', dependsOn: [], payload: { nested: [2] } },
]), {
  order: ['__proto__', 'second'],
  layers: [['__proto__', 'second']],
  jobs: [
    { id: '__proto__', dependsOn: [], payload: { nested: [1] } },
    { id: 'second', dependsOn: [], payload: { nested: [2] } },
  ],
});
assert.strictEqual(Object.getPrototypeOf({}), Object.prototype);
console.log('stage2 planner controller passed');
