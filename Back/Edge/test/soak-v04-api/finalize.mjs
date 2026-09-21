// V0.4 长程测试 02_API 包 · 收尾聚合：读 state/ 生成 RESULTS.json（docs 交付目录）。
// 用法：node Back/Edge/test/soak-v04-api/finalize.mjs --run-dir .local/soak-v04-api/run [--stable-minutes 60]
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');
const ARG = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) ARG[process.argv[i].slice(2)] = (process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) ? process.argv[i + 1] : true;
}
const RUN_DIR = path.resolve(ARG['run-dir'] || path.join(REPO, '.local', 'soak-v04-api', 'run'));
const STATE = path.join(RUN_DIR, 'state');
const OUT = path.join(REPO, 'docs', 'v0.4', 'soak', 'results', '02-api');
const STABLE_MIN = Number(ARG['stable-minutes'] || 60);
const sha = (p) => { try { return createHash('sha256').update(readFileSync(p)).digest('hex'); } catch { return null; } };

const results = JSON.parse(await readFile(path.join(STATE, 'results.json'), 'utf8'));
const phaseIds = Object.keys(results.phases);

// ---- 跨相位端点聚合 ----
const agg = {};
for (const pid of phaseIds) {
  for (const [ep, e] of Object.entries(results.phases[pid].byEndpoint)) {
    const a = (agg[ep] ??= { n: 0, ok: 0, expectedReject: 0, unexpected: 0, lat: [] });
    a.n += e.n; a.ok += e.ok; a.expectedReject += e.expectedReject; a.unexpected += e.unexpected;
  }
}
// 分位数需逐请求数据：从 windows 累计行取 p95 末值近似 + 各相位 p95 汇总表
const totals = {
  requests: Object.values(agg).reduce((s, e) => s + e.n, 0),
  ok: Object.values(agg).reduce((s, e) => s + e.ok, 0),
  expectedReject: Object.values(agg).reduce((s, e) => s + e.expectedReject, 0),
  unexpected: Object.values(agg).reduce((s, e) => s + e.unexpected, 0),
};
const effectiveSeconds = phaseIds.reduce((s, pid) => s + results.phases[pid].seconds, 0);

// ---- 稳定窗核验（P7 末段 STABLE_MIN 分钟非预期增量）----
let stableWindow = null;
if (existsSync(path.join(STATE, 'windows-P7.jsonl'))) {
  const rows = (await readFile(path.join(STATE, 'windows-P7.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  const phaseStart = Date.parse(results.phases.P7.startedAt);
  const cutoff = Date.parse(rows.at(-1).ts) - STABLE_MIN * 60_000;
  const atOrAfter = (ts) => rows.filter((r) => Date.parse(r.ts) <= ts).at(-1);
  const beforeCut = atOrAfter(cutoff);
  const endRow = rows.at(-1);
  const sum = (row) => row ? Object.values(row.byEp).reduce((s, e) => s + e.unexpected, 0) : 0;
  const endSum = (row) => row ? Object.values(row.byEp).reduce((s, e) => s + e.n, 0) : 0;
  stableWindow = {
    minutes: STABLE_MIN,
    unexpectedDelta: sum(endRow) - sum(beforeCut),
    requestsInWindow: endSum(endRow) - endSum(beforeCut),
    passed: sum(endRow) - sum(beforeCut) === 0,
  };
}

// ---- 资源趋势（edge/host 采样）----
const resource = {};
const edgeRows = existsSync(path.join(STATE, 'edge-metrics.jsonl'))
  ? (await readFile(path.join(STATE, 'edge-metrics.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l)) : [];
if (edgeRows.length) {
  const rss = edgeRows.map((r) => r.rss);
  const lag = edgeRows.map((r) => r.eventloopLagMs);
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  resource.edge = {
    rssMinMB: Math.min(...rss) / 1e6, rssMedianMB: med(rss) / 1e6, rssMaxMB: Math.max(...rss) / 1e6,
    eventloopLagMaxMs: Math.max(...lag), serverConnsMax: Math.max(...edgeRows.map((r) => r.serverConns)),
    activeHandlesMax: Math.max(...edgeRows.map((r) => r.activeHandles)),
    kernelBucketsMax: Math.max(...edgeRows.map((r) => r.kernelBuckets)),
    kernelBufferedMax: Math.max(...edgeRows.map((r) => r.kernelBuffered)),
    upstreamQueriesTotal: edgeRows.at(-1).qTotal,
    sessionsMax: Math.max(...edgeRows.map((r) => r.sessions)),
  };
}
const hostRows = existsSync(path.join(STATE, 'host-metrics.jsonl'))
  ? (await readFile(path.join(STATE, 'host-metrics.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l)) : [];
if (hostRows.length) {
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  resource.host = {
    cpuPctMedian: med(hostRows.map((r) => r.hostCpuPct).filter((v) => v != null)),
    cpuPctMax: Math.max(...hostRows.map((r) => r.hostCpuPct).filter((v) => v != null)),
    freeMemMinGB: Math.min(...hostRows.map((r) => r.hostFreeMem)) / 1e9,
    runDirMaxMB: Math.max(...hostRows.map((r) => r.runDirBytes)) / 1e6,
    samples: hostRows.length,
  };
}

// ---- hash 与漂移 ----
const SRC = path.join(REPO, 'Back', 'Edge', 'src');
const hashEnd = {
  'kernel-store.mjs': sha(path.join(SRC, 'kernel-store.mjs')),
  'customer-activity.mjs': sha(path.join(SRC, 'customer-activity.mjs')),
};
const whitelistDrift = results.whitelistHashStart && {
  'kernel-store.mjs': results.whitelistHashStart['kernel-store.mjs'] !== hashEnd['kernel-store.mjs'],
  'customer-activity.mjs': results.whitelistHashStart['customer-activity.mjs'] !== hashEnd['customer-activity.mjs'],
};
let runDirBytes = 0;
for (const f of await readdir(RUN_DIR, { withFileTypes: true }).catch(() => [])) {
  const fp = path.join(RUN_DIR, f.name);
  runDirBytes += f.isDirectory() ? 0 : (await stat(fp).catch(() => ({ size: 0 }))).size;
}

const out = {
  ...results,
  totals: { ...totals, effectiveSeconds, effectiveMinutes: Math.round(effectiveSeconds / 60), phasesRun: phaseIds },
  stableWindow,
  resource,
  hashEnd,
  whitelistDrift,
  whitelistHashStart: results.whitelistHashStart,
  retained: { runDir: RUN_DIR, runDirBytes, note: '运行副本/SQLite/日志保留作证据；driver 已停所有本包子进程' },
  generatedAt: new Date().toISOString(),
};
await writeFile(path.join(OUT, 'RESULTS.json'), JSON.stringify(out, null, 1));
console.log(`RESULTS.json → ${path.join(OUT, 'RESULTS.json')}`);
console.log(`有效长测 ${out.totals.effectiveMinutes}min，请求 ${totals.requests}（ok=${totals.ok} 预期拒绝=${totals.expectedReject} 非预期=${totals.unexpected}）`);
console.log(`稳定窗（末${STABLE_MIN}min）非预期增量=${stableWindow?.unexpectedDelta} passed=${stableWindow?.passed}`);
console.log(`whitelist drift：kernel-store=${whitelistDrift?.['kernel-store.mjs']} customer-activity=${whitelistDrift?.['customer-activity.mjs']}`);
