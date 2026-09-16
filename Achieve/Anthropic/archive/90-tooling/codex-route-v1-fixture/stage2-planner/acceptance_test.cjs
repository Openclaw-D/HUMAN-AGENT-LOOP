'use strict';
const assert = require('node:assert/strict');
const { planJobs } = require('./planner.cjs');

const jobs = [
  { id: 'publish', dependsOn: ['build', 'audit'], payload: { lane: 3 } },
  { id: 'fetch', dependsOn: [], payload: { lane: 1 } },
  { id: 'build', dependsOn: ['fetch'], payload: { lane: 2 } },
  { id: 'audit', dependsOn: ['fetch'], payload: { lane: 2 } },
];
assert.deepStrictEqual(planJobs(jobs), {
  order: ['fetch', 'build', 'audit', 'publish'],
  layers: [['fetch'], ['build', 'audit'], ['publish']],
  jobs: [jobs[1], jobs[2], jobs[3], jobs[0]],
});
assert.deepStrictEqual(jobs[0].dependsOn, ['build', 'audit']);
console.log('stage2 planner acceptance passed');
