import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { loadScenarioConfigs } from '../src/config/scenario-loader.js';
import { loadScenarioFixtures } from '../src/config/scenario-fixture-loader.js';

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(resolve(directory, entry.name)) : [resolve(directory, entry.name)]);
}

const publicDirectory = resolve('public');
const sourceFiles = [
  ...walk(resolve('src')),
  ...walk(resolve('scripts')),
  ...walk(publicDirectory),
  ...walk(resolve('test', 'fixtures')),
].filter((file) => ['.js', '.mjs'].includes(extname(file)));
for (const file of sourceFiles) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(`Syntax check failed for ${file}: ${check.stderr}`);
  const text = readFileSync(file, 'utf8');
  if (/from\s+['"](?!node:|\.\.?\/)/.test(text)) throw new Error(`Third-party import is forbidden: ${file}`);
}

const indexHtml = readFileSync(resolve(publicDirectory, 'index.html'), 'utf8');
for (const asset of ['/styles.css', '/app.js']) {
  if (!indexHtml.includes(asset) || !existsSync(resolve(publicDirectory, asset.slice(1)))) {
    throw new Error(`P6 static shell is missing required asset ${asset}.`);
  }
}
if (/<(?:script|link)[^>]+(?:src|href)=['"]https?:\/\//i.test(indexHtml)) {
  throw new Error('P6 public shell must not load third-party remote UI or graph dependencies.');
}
const scenarios = loadScenarioConfigs(resolve('scenarios'));
if (scenarios.size !== 10) throw new Error('P6 build requires the accepted ten scenario configs.');
const fixtures = loadScenarioFixtures(resolve('test/fixtures/scenarios'), scenarios);
if (fixtures.size !== 10) throw new Error('P6 build requires the accepted ten deidentified fixtures.');
const staticAssets = walk(publicDirectory);
process.stdout.write(`P6 build check passed: ${sourceFiles.length} JavaScript/ESM files, ${scenarios.size} scenario configs, ${fixtures.size} deidentified fixtures, ${staticAssets.length} static assets, zero third-party imports.\n`);
