import assert from 'node:assert/strict';

import { runP5ScenarioSuite } from './p5-scenario-suite.js';

const result = await runP5ScenarioSuite({ verbose: true });
assert.equal(result.status, 'PASS');
assert.equal(result.passed, 10);
assert.equal(result.total, 10);
assert.equal(result.results.every((item) => item.kernelVersion === 1), true);
assert.equal(result.results.every((item) => item.advisoryChecks.success.zeroAuthoritativeWrite), true);
assert.equal(result.results.every((item) => item.failurePaths.connectorUnknown), true);
assert.equal(result.results.every((item) => item.replayHash.length === 64), true);
console.log(`[P5 integration] PASS scenarios=${result.passed}/${result.total} kernelVersion=${result.kernelVersion} events=${result.eventChain.eventCount} replay=${result.replayRebuilt}/20`);
