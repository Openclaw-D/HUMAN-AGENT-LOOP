// soak-v04-data · worker 进程：compose（跳过迁移）+ 周期 tick + 心跳文件。
// 心跳含 RSS/heap/事件循环滞后(max/窗口)/tick 计数；driver 据此监测与判死。
import { compose, FakeWecomTransport } from '../../src/compose.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { soakConfig } from './harness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(process.env.SOAK04_WORKER_CFG);
const conf = soakConfig();
const workerId = cfg.workerId;
const statusPath = join(conf.runDir, 'status', `worker-${workerId}.json`);
mkdirSync(dirname(statusPath), { recursive: true });

const svc = await compose({
  pg: { ...conf.pg, ...cfg.pgOverride },
  objectRoot: conf.objectRoot,
  signingSecret: conf.signingSecret,
  skipMigration: true,
  wecomTransport: new FakeWecomTransport(),
  aBaseUrl: cfg.aBaseUrl,
  aCredential: conf.aCredentials.uploadFallback,
  a: { tenantId: conf.tenantId, bridge: true, credentials: conf.aCredentials },
  processing: {
    ...(cfg.aCustomerLinks ? { aCustomerLinks: cfg.aCustomerLinks } : {}),
    localOnlyCompletion: false,
    leaseSec: 120,
    maxAttempts: 3,
    blockedBackoffSec: 15,
    aTimeoutMs: 5000,
    ...(cfg.processing ?? {}),
  },
});

let tickErrors = 0; let ticks = 0; let lastResult = null; let lastError = null;
let lagMax = 0; let lastBeat = Date.now();
let crashSignals = 0;
// soak 仪表化：worker 无本地状态（全部状态在 PG），捕获后保活继续，同时把栈写到 stderr
// 供 driver 记录为产品信号（PG 硬断连下 unhandled rejection 崩溃行为，报告中如实呈现）。
process.on('unhandledRejection', (reason) => {
  crashSignals += 1;
  console.error(`[soak04-worker] unhandledRejection: ${String(reason?.stack ?? reason).slice(0, 600)}`);
});
process.on('uncaughtException', (err) => {
  crashSignals += 1;
  console.error(`[soak04-worker] uncaughtException: ${String(err?.stack ?? err).slice(0, 600)}`);
});
setInterval(() => { // 事件循环滞后采样（50ms 基准漂移）
  const now = Date.now();
  const lag = now - lastBeat - 50;
  if (lag > lagMax) lagMax = lag;
  lastBeat = now;
}, 50).unref();

let running = false;
async function tickLoop() {
  if (running) return;
  running = true;
  try {
    const r = await svc.processing.tick({ maxTasks: cfg.maxTasks ?? 2 });
    ticks += 1; lastResult = r; lastError = null;
  } catch (e) {
    ticks += 1; tickErrors += 1; lastError = String(e?.message ?? e).slice(0, 160);
  } finally {
    running = false;
  }
}
const driver = setInterval(() => { tickLoop(); }, cfg.tickIntervalMs ?? 2000);
driver.unref();

function heartbeat(final = false) {
  const mem = process.memoryUsage();
  const out = {
    ts: new Date().toISOString(), pid: process.pid, workerId, final,
    rssMb: Math.round(mem.rss / 1024 / 1024), heapMb: Math.round(mem.heapUsed / 1024 / 1024),
    lagMaxMs: lagMax, ticks, tickErrors, crashSignals, lastError, lastResult: lastResult ? { claimed: lastResult.claimed, done: lastResult.done, failed: lastResult.failed, needsFollowup: lastResult.needsFollowup } : null,
  };
  lagMax = 0;
  try { writeFileSync(statusPath, JSON.stringify(out)); } catch { /* 心跳失败不致命 */ }
  return out;
}
heartbeat();
const beat = setInterval(() => heartbeat(), 5000);
beat.unref();

process.on('SIGTERM', async () => {
  clearInterval(driver); clearInterval(beat);
  try { await svc.close(); } catch { /* 关闭失败不阻断退出 */ }
  heartbeat(true);
  process.exit(0);
});
process.on('SIGINT', async () => {
  clearInterval(driver); clearInterval(beat);
  try { await svc.close(); } catch { /* 关闭失败不阻断退出 */ }
  heartbeat(true);
  process.exit(0);
});
