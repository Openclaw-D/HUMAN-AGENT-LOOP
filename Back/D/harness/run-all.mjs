// 套件编排：隔离子进程逐套件执行，聚合结果与退出码。用法：node harness/run-all.mjs [runName]
// 聚合退出码：任一套件fail→1；全套件0断言→3；编排自身异常→2。
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const D_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EV_ROOT = path.join(D_ROOT, 'evidence');
const runName = process.argv[2] || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const runDir = path.join(EV_ROOT, runName);
mkdirSync(runDir, { recursive: true });

const suitesDir = path.join(D_ROOT, 'suites');
const only = (process.env.D_SUITES || '').split(',').map(s => s.trim()).filter(Boolean);
const suiteFiles = readdirSync(suitesDir).filter(f => f.endsWith('.test.mjs'))
  .filter(f => !only.length || only.some(o => f.startsWith(o)));

console.log(`[run-all] run=${runName} suites=${suiteFiles.join(', ')}`);
// 自动冻结SUT版本（A/B/C/CONTRACT源hash快照）
try {
  const fz = spawnSync(process.execPath, [path.join(D_ROOT, 'harness', 'freeze.mjs'), runDir, `run-${runName}`], { encoding: 'utf8', timeout: 120000, windowsHide: true });
  console.log(`[run-all] freeze: ${(fz.stdout || '').trim().split('\n').pop() || fz.status}`);
} catch (e) { console.log(`[run-all] freeze skipped: ${e.message}`); }
const aggregates = [];
let anyFail = false, anyCrash = false, totalAssertions = 0;

for (const f of suiteFiles) {
  const r = spawnSync(process.execPath, [path.join(suitesDir, f)], {
    env: { ...process.env, D_RUN_DIR: runDir },
    encoding: 'utf8', timeout: 30 * 60 * 1000, windowsHide: true,
  });
  const resPath = path.join(runDir, f.replace('.test.mjs', '.result.json'));
  let res = null;
  try { res = JSON.parse(readFileSync(resPath, 'utf8')); } catch { }
  const crashed = r.status === null || r.status === 2 || !res;
  if (crashed) anyCrash = true;
  if (r.status === 1 || (res && res.fail > 0)) anyFail = true;
  if (res) totalAssertions += res.totalAssertions || 0;
  aggregates.push({ file: f, exitCode: r.status, crashed, res, stderrTail: (r.stderr || '').slice(-2000) });
  console.log(`[run-all] ${f} exit=${r.status} pass=${res ? res.pass : '?'} fail=${res ? res.fail : '?'} assertions=${res ? res.totalAssertions : '?'}`);
}

const agg = {
  run: runName, startedUtc: runName, endedUtc: new Date().toISOString(),
  suites: aggregates,
  totals: {
    suites: aggregates.length, crashed: aggregates.filter(a => a.crashed).length,
    pass: aggregates.reduce((n, a) => n + (a.res ? a.res.pass : 0), 0),
    fail: aggregates.reduce((n, a) => n + (a.res ? a.res.fail : 0), 0),
    skip: aggregates.reduce((n, a) => n + (a.res ? a.res.skip : 0), 0),
    blocked: aggregates.reduce((n, a) => n + (a.res ? a.res.blocked : 0), 0),
    totalAssertions,
  },
};
// 汇总到扁平表，方便写RESULT
const flat = [];
for (const a of aggregates) {
  if (a.crashed) flat.push({ id: a.file, state: 'crash', note: `套件崩溃 exit=${a.exitCode}` });
  else for (const r of a.res.results) flat.push({ id: r.id, title: r.title, severity: r.severity, owner: r.owner, state: r.state, assertions: r.assertions, ms: r.ms, note: r.note || undefined, failures: r.failures && r.failures.length ? r.failures : undefined });
}
writeFileSync(path.join(runDir, 'AGGREGATE.json'), JSON.stringify({ ...agg, flat }, null, 2));
writeFileSync(path.join(EV_ROOT, 'LATEST.txt'), runName);

let code = 0;
if (anyCrash) code = 2;
if (anyFail) code = 1;
if (totalAssertions === 0) code = 3;
console.log(`[run-all] AGGREGATE pass=${agg.totals.pass} fail=${agg.totals.fail} skip=${agg.totals.skip} blocked=${agg.totals.blocked} assertions=${totalAssertions} -> exit=${code}`);
process.exit(code);
