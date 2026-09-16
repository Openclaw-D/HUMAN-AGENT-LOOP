// 任务三 C11·稳定性执行器：完整贯穿场景（E1）重复 N 轮，或定时 M 分钟连续循环。
// 每轮独立数据（bootStack 自建隔离库、用后即毁）；统计 PASS/FAIL 轮数与失败轮日志路径，
// 写证据 JSON。不用反复刷新等待偶然通过：任何一轮 FAIL 即如实记录。
// 用法：node scripts/repeat-scenario.mjs --rounds 10 | --minutes 60 [--evidence <dir>]
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(EDGE_ROOT, '..', '..');
const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};
const rounds = Number(argOf('--rounds') ?? 0);
const minutes = Number(argOf('--minutes') ?? 0);
if (!rounds && !minutes) {
  console.error('用法：--rounds N 或 --minutes M（二选一）');
  process.exit(2);
}
const evidenceDir = argOf('--evidence') ?? path.join(REPO_ROOT, 'docs', 'customer-next', 'acceptance', 'evidence', `task3-stability-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')}`);
mkdirSync(evidenceDir, { recursive: true });

const startedAt = Date.now();
const deadline = minutes ? startedAt + minutes * 60_000 : null;
const results = [];
let round = 0;
for (; ;) {
  round += 1;
  if (deadline && Date.now() >= deadline) break;
  if (!deadline && round > rounds) break;
  const logPath = path.join(evidenceDir, `round-${String(round).padStart(2, '0')}.log`);
  console.log(`[stability] 第 ${round} 轮开始 ${deadline ? `（剩余 ${Math.max(0, Math.round((deadline - Date.now()) / 60000))} 分钟）` : ''}`);
  const r = spawnSync(process.execPath, ['--test', path.join(EDGE_ROOT, 'test', 'e1', 'e1-task3-scenario.test.mjs')], {
    cwd: EDGE_ROOT, encoding: 'utf8', timeout: 600_000,
  });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  writeFileSync(logPath, out);
  const pass = r.status === 0 && /# fail 0/.test(out);
  const failMsg = pass ? 'PASS' : `FAIL (exit ${r.status}，日志 ${path.relative(REPO_ROOT, logPath)})`;
  results.push({ round, pass, exitCode: r.status, log: path.relative(REPO_ROOT, logPath) });
  console.log(`[stability] 第 ${round} 轮：${failMsg}`);
  if (deadline && Date.now() >= deadline) break;
}
const summary = {
  schemaVersion: 'jw.task3.stability.v1',
  startedAt: new Date(startedAt).toISOString(),
  finishedAt: new Date().toISOString(),
  mode: deadline ? `连续 ${minutes} 分钟` : `重复 ${rounds} 轮`,
  totalRounds: results.length,
  pass: results.filter((x) => x.pass).length,
  fail: results.filter((x) => !x.pass).length,
  note: '每轮独立隔离库/端口，无人工改库补状态；结论只覆盖本次执行时段，不证明永久无故障',
  rounds: results,
};
const summaryPath = path.join(evidenceDir, 'stability-summary.json');
writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(`[stability] 汇总：${summary.pass}/${summary.totalRounds} PASS → ${path.relative(REPO_ROOT, summaryPath)}`);
process.exit(summary.fail > 0 ? 1 : 0);
