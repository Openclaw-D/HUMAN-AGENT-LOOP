import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { runP5ScenarioSuite } from './p5-scenario-suite.js';

const index = process.argv.indexOf('--db');
if (index === -1 || !process.argv[index + 1]) throw new Error('Usage: node scripts/seed-p5-scenarios.js --db <new-database-path>');
const databasePath = resolve(process.argv[index + 1]);
if (existsSync(databasePath)) throw new Error(`P5 seed refuses to overwrite existing database: ${databasePath}`);
const result = await runP5ScenarioSuite({ databasePath, cleanup: false, verbose: true });
console.log(JSON.stringify({ status: result.status, scenarios: `${result.passed}/${result.total}`, databasePath: result.databasePath }));
