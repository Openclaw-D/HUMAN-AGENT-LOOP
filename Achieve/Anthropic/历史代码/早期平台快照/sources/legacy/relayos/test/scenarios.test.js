import test from 'node:test';
import assert from 'node:assert/strict';

import { runP5ScenarioSuite } from '../scripts/p5-scenario-suite.js';

test('P5 ten scenarios complete the shared full-stack sequence and BusinessEvent-only replay', { timeout: 120_000 }, async () => {
  const result = await runP5ScenarioSuite({ verbose: true });
  assert.equal(result.status, 'PASS');
  assert.equal(result.passed, 10);
  assert.equal(result.total, 10);
  assert.equal(result.kernelVersion, 1);
  assert.equal(result.replayRebuilt, 20);
  assert.equal(result.results.length, 10);
  for (const scenario of result.results) {
    assert.equal(scenario.status, 'PASS');
    assert.deepEqual(scenario.boundaries, { F: 1, I: 1, H: 1 });
    assert.equal(scenario.metrics.length, 3);
    assert.equal(Object.values(scenario.failurePaths).every(Boolean), true);
    assert.equal(scenario.extension.ratio <= 0.2, true);
    assert.deepEqual(scenario.branchRatios, { domainState: 0, transition: 0, api: 0, ui: 0 });
    assert.match(scenario.replayHash, /^[a-f0-9]{64}$/);
  }
});
