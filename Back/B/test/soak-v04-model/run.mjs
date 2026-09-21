// V0.4 soak-03 · 长测编排器（唯一运行入口）。
// 职责：固定快照 hash 留档、替身生命周期（固定端口支持断点续跑身份稳定）、阶段调度与断点续跑、
// 故障恢复周期注入（仅本包子进程/本包替身）、宿主资源监测与降载、RESULTS.json 汇总。
// 硬不变量违规（幂等围栏/未知围栏/对账破坏/伪报语义）立即中止并留证；普通意外错误计数上报。
// 用法：node Back/B/test/soak-v04-model/run.mjs [--quick]   （--quick：90 秒冒烟自检）
import { startSoakStub } from './stub.mjs';
import { runReconciliation } from './reconcile.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..'); // → JW 项目根
const RUN_DIR = path.join(ROOT, '.local', 'soak-v04-model');
const STATE_DIR = path.join(RUN_DIR, 'state');
const SNAPSHOT_B = path.join(RUN_DIR, 'src-snapshot', 'Back', 'B', 'src');
const SNAPSHOT_EDGE = path.join(RUN_DIR, 'src-snapshot', 'Back', 'Edge', 'src');
const WORKER_MJS = path.join(HERE, 'worker.mjs');
const QUICK = process.argv.includes('--quick');

const MIN = 60000;
const ROTATION = ['normal', 'negative', 'replay', 'history'];
const rotationPlan = (durationMs) => ROTATION.map((p) => ({ profile: p, ms: Math.floor(durationMs / ROTATION.length) }));

/** 形态序列：按权重比例展开为固定长度序列 + 固定种子交错（确定性、去突发）。替身按命中序号循环。 */
function buildPattern(weights, size = 200) {
  const seq = [];
  for (const [form, w] of Object.entries(weights)) {
    const n = Math.max(1, Math.round(w * size));
    for (let i = 0; i < n; i++) seq.push(form);
  }
  let s = 12345;
  for (let i = seq.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [seq[i], seq[j]] = [seq[j], seq[i]];
  }
  return seq;
}
const PATTERNS = {
  normal: buildPattern({ ok: .585, delay50: .08, delay200: .07, delay1000: .05, no_usage: .03,
    status429: .04, status500: .03, error_json503: .02, malformed: .02, truncated: .02, destroy: .015, delay4000: .015 }),
  negative: buildPattern({ ok: .30, status429: .15, status500: .10, error_json503: .08, malformed: .07,
    truncated: .06, destroy: .06, delay4000: .06, no_usage: .05, delay50: .03, delay200: .02, delay1000: .02 }),
  replay: buildPattern({ ok: .70, delay50: .10, delay200: .08, no_usage: .04, status429: .03,
    delay1000: .03, malformed: .01, truncated: .005, destroy: .005 }),
  history: buildPattern({ ok: .68, delay50: .10, delay200: .08, delay1000: .04, no_usage: .04,
    status429: .03, error_json503: .01, malformed: .01, truncated: .005, destroy: .005 }),
};

const PHASES = [
  { name: 'P1-baseline-c1', kind: 'load', concurrency: 1, durationMs: 30 * MIN },
  { name: 'P2a-mixed-c2', kind: 'load', concurrency: 2, durationMs: 30 * MIN },
  { name: 'P2b-mixed-c4', kind: 'load', concurrency: 4, durationMs: 30 * MIN },
  { name: 'P2c-mixed-c8', kind: 'load', concurrency: 8, durationMs: 30 * MIN },
  { name: 'P3-fault-recovery', kind: 'faults' },
  { name: 'P4-closeout-c4', kind: 'load', concurrency: 4, durationMs: 80 * MIN },
];
if (QUICK) {
  PHASES.length = 0;
  PHASES.push(
    { name: 'Q1-smoke-c2', kind: 'load', concurrency: 2, durationMs: 60 * 1000 },
    { name: 'Q2-restart-probe', kind: 'faults', quick: true },
  );
}

const sha256 = (file) => { try { return createHash('sha256').update(fsSync.readFileSync(file)).digest('hex'); } catch { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readState() {
  try { return JSON.parse(await fs.readFile(path.join(STATE_DIR, 'soak-state.json'), 'utf8')); }
  catch { return { stubPort: null, donePhases: [], startedAt: new Date().toISOString(), hardAborted: null }; }
}
async function writeState(s) { await fs.writeFile(path.join(STATE_DIR, 'soak-state.json'), JSON.stringify(s, null, 1)); }

let stub = null;
let state = null;
let abortReason = null;

function spawnWorker(args) {
  const child = spawn(process.execPath, [WORKER_MJS, JSON.stringify(args)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const events = [];
  let stderrTail = '';
  const done = new Promise((resolve) => {
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
        if (!line) continue;
        try { const ev = JSON.parse(line); events.push(ev); if (ev.ev === 'done') resolve(ev); } catch { /* 忽略非 JSON 行 */ }
      }
    });
    child.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-4000); });
    child.on('exit', (code) => resolve({ ev: 'exit', code }));
  });
  return { child, done, events, stderrTail: () => stderrTail, pid: child.pid };
}

async function runLoadSegment({ name, concurrency, durationMs, workerDir, ledgerPath, seed }) {
  const plan = rotationPlan(durationMs);
  stub.control.pattern = PATTERNS[plan[0].profile];
  let idx = 0;
  const rotator = setInterval(() => {
    idx = Math.min(idx + 1, plan.length - 1);
    stub.control.pattern = PATTERNS[plan[idx].profile];
  }, plan[0].ms);
  try {
    const args = {
      runDir: RUN_DIR, workerDir, snapshotEdgeDir: SNAPSHOT_EDGE, ledgerPath, stubUrl: stub.url,
      seed, phaseName: name, durationMs, concurrency,
      profilePlan: plan, shedFile: path.join(STATE_DIR, 'shed.json'),
      tenantId: 'soak-tenant-A', tenantProbeId: 'soak-tenant-B',
    };
    const w = spawnWorker(args);
    const res = await w.done;
    let result = null;
    try { result = JSON.parse(await fs.readFile(path.join(workerDir, `phase-result-${name}.json`), 'utf8')); } catch { }
    return { res, result, stderrTail: w.stderrTail() };
  } finally { clearInterval(rotator); }
}

async function runProbe({ probes, workerDir, ledgerPath, name }) {
  const args = {
    runDir: RUN_DIR, workerDir, snapshotEdgeDir: SNAPSHOT_EDGE, ledgerPath, stubUrl: stub.url,
    seed: 1, phaseName: name, durationMs: 0, concurrency: 1, mode: 'probe', probes,
  };
  const w = spawnWorker(args);
  const res = await w.done;
  let result = null;
  try { result = JSON.parse(await fs.readFile(path.join(workerDir, `phase-result-${name}.json`), 'utf8')); } catch { }
  return { res, result };
}

async function readRegistryTail(workerDir, n) {
  const file = path.join(workerDir, 'registry.jsonl');
  let text = '';
  try { text = await fs.readFile(file, 'utf8'); } catch { return []; }
  const lines = text.split('\n').filter((l) => l.trim());
  return lines.slice(-n).map((l) => JSON.parse(l));
}
async function readUnknownSample(workerDir, n) {
  const file = path.join(workerDir, 'registry.jsonl');
  let text = '';
  try { text = await fs.readFile(file, 'utf8'); } catch { return []; }
  const recs = text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((r) => r.status === 'unknown');
  const out = [];
  const step = Math.max(1, Math.floor(recs.length / n));
  for (let i = recs.length - 1; i >= 0 && out.length < n; i -= step) out.push(recs[i]);
  return out;
}

/** CY6：隔离坏行探针（独立探针账本，不触碰主账本）。 */
async function corruptLineProbe() {
  const glm = await import(pathToFileURL(path.join(SNAPSHOT_B, 'transport', 'glm.mjs')).href);
  const probePath = path.join(STATE_DIR, 'probe-ledger-corrupt.jsonl');
  await fs.copyFile(path.join(STATE_DIR, 'ledger-main.jsonl'), probePath);
  await fs.appendFile(probePath, '{"type":"reserve","amount":"not-a-number"}\n', 'utf8');
  const before = await fs.readFile(probePath, 'utf8');
  const hitsBefore = stub.hits();
  const t = glm.createModelTransport({ mode: 'mock', mock: { baseUrl: stub.url, timeoutMs: 2500 },
    budget: { maxTotalCost: 200, perCallEstimate: 0.01 }, costLogPath: probePath });
  const { request } = glm.buildModelRequest({ runId: 'run-soak-probe', stepId: 'cy6', attempt: 1,
    role: 'credit', purpose: 'auxiliary_review', projectId: 'soak-cy6', goalId: null,
    goalLabel: 'soak', factVersion: '0', evidenceRefs: [] });
  const r = await t.complete(request);
  const after = await fs.readFile(probePath, 'utf8');
  const ok = r.status === 'failed' && r.sentFlag === false && r.error?.code === 'BUDGET_LEDGER_CORRUPT'
    && stub.hits() === hitsBefore && after === before;
  await fs.rm(probePath, { force: true });
  return { cycle: 'CY6-corrupt-line-failclosed', ok,
    got: { status: r.status, sentFlag: r.sentFlag, code: r.error?.code ?? null },
    hitsDelta: stub.hits() - hitsBefore, fileUnchanged: after === before };
}

/** 主账本完整性核对（行可解析、每 requestId 至多1次预占、客户/全局合计不越上限）。 */
async function ledgerIntegrity({ label }) {
  const ledgerPath = path.join(STATE_DIR, 'ledger-main.jsonl');
  let text = '';
  try { text = await fs.readFile(ledgerPath, 'utf8'); } catch (e) { return { label, ok: false, why: `账本不可读 ${e.code}` }; }
  const perCustomer = new Map(); let reserveSum = 0; let bad = 0; const dup = new Set(); let dupCount = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { bad++; continue; }
    if (e.type === 'reserve') {
      reserveSum += e.amount;
      if (dup.has(e.requestId)) dupCount++;
      dup.add(e.requestId);
      if (e.customerKey) perCustomer.set(e.customerKey, (perCustomer.get(e.customerKey) ?? 0) + e.amount);
    }
  }
  let overCustomers = 0;
  for (const v of perCustomer.values()) if (v > 8 + 1e-9) overCustomers++;
  const ok = bad === 0 && dupCount === 0 && overCustomers === 0 && reserveSum <= 200 + 1e-9;
  return { label, ok, badLines: bad, duplicateReserves: dupCount, overCustomerCaps: overCustomers,
    reserveSum: Math.round(reserveSum * 100) / 100, customers: perCustomer.size };
}

/** 宿主监测（每分钟）：内存/磁盘/CPU，越限写 shed.json 降载。 */
async function hostMonitorLoop(stopAt) {
  let prevCpu = os.cpus().map((c) => c.times);
  let cpuOver = 0;
  while (Date.now() < stopAt) {
    await sleep(60000);
    const cpu = os.cpus().map((c) => c.times);
    let dTot = 0, dIdle = 0;
    cpu.forEach((t, i) => {
      const p = prevCpu[i] ?? t;
      dTot += (t.user - p.user) + (t.nice - p.nice) + (t.sys - p.sys) + (t.irq - p.irq) + (t.idle - p.idle);
      dIdle += t.idle - (p.idle ?? t.idle);
    });
    prevCpu = cpu;
    const cpuPct = dTot > 0 ? Math.round((1 - dIdle / dTot) * 100) : null;
    const freememMB = Math.round(os.freemem() / 1048576);
    const totalmemMB = Math.round(os.totalmem() / 1048576);
    let diskFreePct = null;
    try { const s = await fs.statfs(RUN_DIR); diskFreePct = Math.round((s.bavail * s.bsize) / (s.blocks * s.bsize) * 1000) / 10; } catch { }
    const shed = freememMB < 2000 || freememMB < totalmemMB * 0.1 || (diskFreePct != null && diskFreePct < 5);
    cpuOver = cpuPct != null && cpuPct > 80 ? cpuOver + 1 : 0;
    const heavy = shed || cpuOver >= 5;
    try {
      if (heavy) await fs.writeFile(path.join(STATE_DIR, 'shed.json'), JSON.stringify({ rate: 2, at: new Date().toISOString() }));
      else await fs.rm(path.join(STATE_DIR, 'shed.json'), { force: true });
    } catch { }
    await fs.appendFile(path.join(RUN_DIR, 'host-samples.jsonl'), JSON.stringify({
      at: new Date().toISOString(), freememMB, totalmemMB, diskFreePct, cpuPct, shed: heavy,
    }) + '\n', 'utf8');
  }
}

async function main() {
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.mkdir(path.join(RUN_DIR, 'results-raw'), { recursive: true });
  state = await readState();
  const t0 = Date.now();

  // 输入 hash 留档（结果绑定快照 hash；同时记录在制源码实时 hash 以监测并行 writer 漂移）
  const hashRecords = {
    at: new Date().toISOString(),
    snapshot: {
      glm: sha256(path.join(SNAPSHOT_B, 'transport', 'glm.mjs')),
      receipts: sha256(path.join(SNAPSHOT_EDGE, 'assistant-receipts.mjs')),
      assistantModel: sha256(path.join(SNAPSHOT_EDGE, 'assistant-model.mjs')),
    },
    live: {
      glm: sha256(path.join(ROOT, 'Back', 'B', 'src', 'transport', 'glm.mjs')),
      receipts: sha256(path.join(ROOT, 'Back', 'Edge', 'src', 'assistant-receipts.mjs')),
      assistantModel: sha256(path.join(ROOT, 'Back', 'Edge', 'src', 'assistant-model.mjs')),
    },
  };
  await fs.writeFile(path.join(RUN_DIR, 'results-raw', 'input-hashes.json'), JSON.stringify(hashRecords, null, 1));

  // 替身：固定端口（断点续跑身份稳定：configHash 含 baseUrl）
  stub = await startSoakStub({ stateDir: STATE_DIR, preferredPort: state.stubPort ?? null });
  state.stubPort = stub.port;
  if (!state.startedAt) state.startedAt = new Date().toISOString();
  await writeState(state);
  console.log(`[soak-run] stub=127.0.0.1:${stub.port} quick=${QUICK} donePhases=${state.donePhases.length}`);

  const stopMonitorAt = Date.now() + (QUICK ? 5 * MIN : 8 * 60 * MIN);
  const monitor = hostMonitorLoop(stopMonitorAt).catch(() => { });

  const phaseReports = state.phaseReports ?? (state.phaseReports = []);
  let exitCode = 0;

  for (const phase of PHASES) {
    if (state.donePhases.includes(phase.name)) { console.log(`[soak-run] 跳过已完成 ${phase.name}`); continue; }
    if (abortReason) break;
    console.log(`[soak-run] ▶ ${phase.name} 开始 ${new Date().toISOString()}`);
    let report = { name: phase.name, kind: phase.kind };

    if (phase.kind === 'load') {
      const seed = 20260921 + phase.name.length;
      const { res, result, stderrTail } = await runLoadSegment({
        name: phase.name, concurrency: phase.concurrency, durationMs: phase.durationMs,
        workerDir: path.join(STATE_DIR, 'worker-main'), ledgerPath: path.join(STATE_DIR, 'ledger-main.jsonl'), seed,
      });
      const effectiveMs = result?.effectiveMs ?? 0;
      const complete = effectiveMs >= phase.durationMs - 90 * 1000 && res?.ev === 'done';
      const hardViolations = (result?.counters?.violations ?? []).filter((v) => ['GUARD', 'RECONCILE', 'PROBE'].includes(v.kind));
      report = { ...report, complete, effectiveMs, plannedMs: phase.durationMs, res,
        violationCount: result?.counters?.violationCount ?? -1, hardViolations };
      if (!complete) console.log(`[soak-run] worker stderr 尾部: ${(stderrTail?.() ?? '').slice(-1500)}`);
      if (hardViolations.length) { abortReason = `${phase.name} 硬不变量违规`; report.aborted = true; }
      else if (!complete) { abortReason = `${phase.name} 阶段未达计划时长（effectiveMs=${effectiveMs}）`; report.incomplete = true; }
    }

    if (phase.kind === 'faults') {
      report = { ...report, cycles: [] };
      const mainDir = path.join(STATE_DIR, 'worker-main');
      const mainLedger = path.join(STATE_DIR, 'ledger-main.jsonl');
      const seg = (name2, conc, ms) => runLoadSegment({ name: name2, concurrency: conc, durationMs: ms,
        workerDir: mainDir, ledgerPath: mainLedger, seed: 20260921 + name2.length });
      const push = (o) => report.cycles.push(o);

      if (phase.quick) { // 冒烟：一次优雅重启 + 探针
        const s1 = await seg('Q2-seg1', 2, 25 * 1000);
        const w = spawnWorker({ runDir: RUN_DIR, workerDir: mainDir, snapshotEdgeDir: SNAPSHOT_EDGE, ledgerPath: mainLedger,
          stubUrl: stub.url, seed: 7, phaseName: 'Q2-seg2', durationMs: 20 * 1000, concurrency: 2,
          profilePlan: [{ profile: 'normal', ms: 20 * 1000 }], shedFile: path.join(STATE_DIR, 'shed.json') });
        await sleep(8000);
        w.child.kill('SIGTERM');
        await w.done;
        const probes = await readRegistryTail(mainDir, 20);
        const pr = await runProbe({ probes, workerDir: mainDir, ledgerPath: mainLedger, name: 'Q2-probe' });
        push({ cycle: 'Q2-graceful-restart+probe', probe: pr.result?.probeResults?.slice(0, 5), probesOk: pr.result?.probesOk, probesFailed: pr.result?.probesFailed });
        report.complete = (pr.result?.probesFailed ?? 1) === 0;
      } else {
        // CY1 优雅重启（排空后重启，围栏/预算跨进程生效）
        const s1 = await seg('P3-seg1-c2', 2, 5 * MIN);
        push({ cycle: 'CY1-graceful-restart', before: s1.res, note: 'SIGTERM 排空后重启' });
        const s2 = await seg('P3-seg2-c2', 2, 5 * MIN);
        push({ cycle: 'CY1-after-restart', seg: s2.res, hard: s2.result?.counters?.violationCount });

        // CY2 SIGKILL 硬杀 + 意图/终端间隙探针
        {
          const w = spawnWorker({ runDir: RUN_DIR, workerDir: mainDir, snapshotEdgeDir: SNAPSHOT_EDGE, ledgerPath: mainLedger,
            stubUrl: stub.url, seed: 20260922, phaseName: 'P3-seg3-c2', durationMs: 5 * MIN, concurrency: 2,
            profilePlan: rotationPlan(5 * MIN), shedFile: path.join(STATE_DIR, 'shed.json') });
          await sleep(4 * MIN);
          w.child.kill('SIGKILL');
          await w.done;
          push({ cycle: 'CY2-sigkill', killed: true });
          const probes = await readRegistryTail(mainDir, 40);
          const pr = await runProbe({ probes, workerDir: mainDir, ledgerPath: mainLedger, name: 'P3-cy2-probe' });
          push({ cycle: 'CY2-crash-probe', probesOk: pr.result?.probesOk, probesFailed: pr.result?.probesFailed,
            sample: pr.result?.probeResults?.slice(0, 6) });
        }

        // CY3 替身同端口重启（在途→未知；空窗→未发送；计数与预算持续）
        {
          const w = spawnWorker({ runDir: RUN_DIR, workerDir: mainDir, snapshotEdgeDir: SNAPSHOT_EDGE, ledgerPath: mainLedger,
            stubUrl: stub.url, seed: 20260923, phaseName: 'P3-seg4-c2', durationMs: 4 * MIN, concurrency: 2,
            profilePlan: rotationPlan(4 * MIN), shedFile: path.join(STATE_DIR, 'shed.json') });
          await sleep(90 * 1000);
          const restartRes = await stub.restart({ gapMs: 700 });
          await w.done;
          push({ cycle: 'CY3-stub-restart', restartRes, stubRestarts: stub.restarts() });
        }

        // CY4 双进程竞争（独立回执仓、共享账本与锁；同客户预算跨进程互斥）
        {
          const w1 = spawnWorker({ runDir: RUN_DIR, workerDir: mainDir, snapshotEdgeDir: SNAPSHOT_EDGE, ledgerPath: mainLedger,
            stubUrl: stub.url, seed: 20260924, phaseName: 'P3-seg5-c2', durationMs: 10 * MIN, concurrency: 2,
            profilePlan: rotationPlan(10 * MIN), shedFile: path.join(STATE_DIR, 'shed.json') });
          const compDir = path.join(STATE_DIR, 'worker-comp');
          const w2 = spawnWorker({ runDir: RUN_DIR, workerDir: compDir, snapshotEdgeDir: SNAPSHOT_EDGE, ledgerPath: mainLedger,
            stubUrl: stub.url, seed: 20260925, phaseName: 'P3-comp-c2', durationMs: 8 * MIN, concurrency: 2,
            profilePlan: rotationPlan(8 * MIN), shedFile: path.join(STATE_DIR, 'shed.json'),
            tenantId: 'soak-tenant-C2', tenantProbeId: 'soak-tenant-D' });
          const r2 = await w2.done;
          w1.child.kill('SIGTERM');
          const r1 = await w1.done;
          const integ = await ledgerIntegrity({ label: 'CY4-after-competition' });
          push({ cycle: 'CY4-process-competition', comp: r2, main: r1, ledgerIntegrity: integ });
          if (!integ.ok) { abortReason = 'CY4 账本完整性破坏'; }
        }

        // CY5 双杀恢复（两进程同时硬杀→只重启主进程，预算只增不减、账本不绕过）
        {
          const w1 = spawnWorker({ runDir: RUN_DIR, workerDir: mainDir, snapshotEdgeDir: SNAPSHOT_EDGE, ledgerPath: mainLedger,
            stubUrl: stub.url, seed: 20260926, phaseName: 'P3-seg6-c2', durationMs: 3 * MIN, concurrency: 2,
            profilePlan: rotationPlan(3 * MIN), shedFile: path.join(STATE_DIR, 'shed.json') });
          const compDir = path.join(STATE_DIR, 'worker-comp');
          const w2 = spawnWorker({ runDir: RUN_DIR, workerDir: compDir, snapshotEdgeDir: SNAPSHOT_EDGE, ledgerPath: mainLedger,
            stubUrl: stub.url, seed: 20260927, phaseName: 'P3-comp2-c2', durationMs: 3 * MIN, concurrency: 2,
            profilePlan: rotationPlan(3 * MIN), shedFile: path.join(STATE_DIR, 'shed.json'),
            tenantId: 'soak-tenant-C2', tenantProbeId: 'soak-tenant-D' });
          await sleep(100 * 1000);
          w1.child.kill('SIGKILL'); w2.child.kill('SIGKILL');
          await Promise.all([w1.done, w2.done]);
          const integ = await ledgerIntegrity({ label: 'CY5-after-double-kill' });
          push({ cycle: 'CY5-double-kill', ledgerIntegrity: integ });
          const s7 = await seg('P3-seg7-c2', 2, 4 * MIN);
          push({ cycle: 'CY5-recover-load', seg: s7.res, hard: s7.result?.counters?.violationCount });
        }

        // CY6 隔离坏行失败关闭探针
        try { push(await corruptLineProbe()); } catch (e) { push({ cycle: 'CY6-corrupt-line-failclosed', ok: false, why: String(e).slice(0, 300) }); }

        // CY7 未知围栏持久探针（跨重启抽 20 个历史 unknown 身份）
        {
          const probes = await readUnknownSample(mainDir, 20);
          const pr = await runProbe({ probes, workerDir: mainDir, ledgerPath: mainLedger, name: 'P3-cy7-probe' });
          push({ cycle: 'CY7-unknown-fence', probesOk: pr.result?.probesOk, probesFailed: pr.result?.probesFailed,
            sample: pr.result?.probeResults?.slice(0, 6) });
          if ((pr.result?.probesFailed ?? 0) > 0) abortReason = 'CY7 未知围栏探针失败';
        }
        report.complete = !abortReason;
      }
    }

    phaseReports.push(report);
    state.donePhases.push(phase.name);
    await writeState(state);
    console.log(`[soak-run] ■ ${phase.name} 结束 complete=${report.complete} ${new Date().toISOString()}`);
    if (abortReason) { exitCode = 3; break; }
  }

  // 收尾：全量命中流落盘 + 终局对账 + RESULTS
  const allHits = drainAllHitsSafe();
  const finalStubStats = stub.stats();
  const finalIntegrity = await ledgerIntegrity({ label: 'final' });
  const reconciliation = await runReconciliation({
    runDir: RUN_DIR, stateDir: STATE_DIR, allHits: await allHits, finalIntegrity,
  }).catch((e) => ({ error: String(e).slice(0, 500) }));

  const results = {
    task: 'V0.4 soak 03_MODEL 模型调用链/回执/预算效率长程测试',
    startedAt: state.startedAt, endedAt: new Date().toISOString(),
    wallMs: Date.now() - t0, quick: QUICK,
    inputHashes: hashRecords,
    stub: { url: stub.url, finalStats: finalStubStats },
    phases: phaseReports,
    finalLedgerIntegrity: finalIntegrity,
    reconciliation,
    abortReason,
  };
  await fs.writeFile(path.join(ROOT, 'docs', 'v0.4', 'soak', 'results', '03-model', 'RESULTS.json'),
    JSON.stringify(results, null, 1));
  console.log(`[soak-run] 完成 exit=${exitCode} abort=${abortReason ?? '无'}`);
  await stub.close();
  process.exit(exitCode);
}

async function drainAllHitsSafe() {
  const all = [];
  let cursor = 0;
  for (;;) {
    const { next, items } = stub.hitStream(cursor);
    all.push(...items);
    if (items.length === 0 || next >= cursor + items.length && items.length < 5000) { cursor = next; break; }
    cursor = next;
  }
  await fs.writeFile(path.join(RUN_DIR, 'all-hits.json'), JSON.stringify(all));
  return { count: all.length, file: '.local/soak-v04-model/all-hits.json' };
}

main().catch((e) => { console.error('[soak-run] 致命错误', e); process.exit(2); });
