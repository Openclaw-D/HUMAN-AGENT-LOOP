import assert from 'node:assert/strict';
import { runV3FullScenario } from './v3-full-run.mjs';

function parseBaseUrl(argv) {
  const index = argv.indexOf('--base-url');
  return index >= 0 ? argv[index + 1] : process.env.V3_BASE_URL ?? 'http://localhost:3000';
}

const baseUrl = parseBaseUrl(process.argv);
const runs = [];
for (let index = 1; index <= 3; index += 1) {
  runs.push(await runV3FullScenario({ baseUrl, runLabel: `run-${index}` }));
}
assert.deepEqual(runs[1].normalized, runs[0].normalized, 'run-2 normalized structure differs from run-1');
assert.deepEqual(runs[2].normalized, runs[0].normalized, 'run-3 normalized structure differs from run-1');

process.stdout.write(`${JSON.stringify({
  ok: true,
  baseUrl,
  runCount: runs.length,
  runtimeEpochs: runs.map((run) => run.runtimeEpoch),
  eventCounts: runs.map((run) => run.eventCount),
  receiptCounts: runs.map((run) => run.receiptCount),
  negativeChecksPerRun: runs.map((run) => run.negativeChecks),
  normalizedStructureEqual: true,
}, null, 2)}\n`);
