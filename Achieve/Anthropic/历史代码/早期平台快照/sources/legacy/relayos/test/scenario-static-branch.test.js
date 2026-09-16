import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { scanScenarioBranches } from '../scripts/p5-scenario-suite.js';
import { loadScenarioConfigs } from '../src/config/scenario-loader.js';

test('P5 runtime has zero scenario-specific domain/API/UI branches and one renderer', () => {
  const configs = loadScenarioConfigs(resolve('scenarios'));
  assert.equal(configs.size, 10);
  const result = scanScenarioBranches([...configs.keys()]);
  assert.equal(result.scenarioLiteralBranches, 0);
  assert.equal(result.scenarioConditionalBranches, 0);
  assert.equal(result.scenarioSpecificDomainStates, 0);
  assert.equal(result.scenarioSpecificTransitions, 0);
  assert.equal(result.scenarioSpecificRoutes, 0);
  assert.equal(result.scenarioSpecificUiBranches, 0);
  assert.equal(result.rendererCount, 1);
});
