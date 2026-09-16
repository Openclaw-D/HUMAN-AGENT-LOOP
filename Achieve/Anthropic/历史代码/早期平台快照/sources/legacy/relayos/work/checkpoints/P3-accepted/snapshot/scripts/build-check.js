import { readdirSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { loadScenarioConfigs } from '../src/config/scenario-loader.js';

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(resolve(directory, entry.name)) : [resolve(directory, entry.name)]);
}

const sourceFiles = [...walk(resolve('src')), ...walk(resolve('scripts'))].filter((file) => extname(file) === '.js');
for (const file of sourceFiles) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(`Syntax check failed for ${file}: ${check.stderr}`);
  const text = readFileSync(file, 'utf8');
  if (/from\s+['"](?!node:|\.\.?\/)/.test(text)) throw new Error(`Third-party import is forbidden in P2: ${file}`);
}
const scenarios = loadScenarioConfigs(resolve('scenarios'));
if (scenarios.size < 3) throw new Error('P2 build requires at least three representative scenario configs.');
process.stdout.write(`Build check passed: ${sourceFiles.length} JavaScript files, ${scenarios.size} scenario configs, zero third-party imports.\n`);
