// R3精确小屏验证矩阵 v2：真Chrome + CDP DevTools仿真（零依赖，Node22内置WebSocket）。
// 与Playwright同级：Emulation.setDeviceMetricsOverride 设置真实布局视口402/390/360×DPR3，
// 非窗口钳制、非图片缩放。收据/测量经壳POST到自有服务落盘（evidence/collected/）。
// 自有进程+临时profile+用后清理；仅127.0.0.1。
// 用法：node tools/headless-shots.mjs [--chrome <路径>]
import { spawn, spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]+$/, '');
const batchDir = join(root, '..');
const shotsDir = join(batchDir, 'screenshots');
const evidenceDir = join(batchDir, 'evidence');
mkdirSync(shotsDir, { recursive: true });
mkdirSync(evidenceDir, { recursive: true });

const chromeArgIdx = process.argv.indexOf('--chrome');
const candidates = [
  chromeArgIdx > -1 ? process.argv[chromeArgIdx + 1] : null,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const chrome = candidates.find((p) => existsSync(p));
if (!chrome) {
  console.error('NO_CHROME_FOUND');
  process.exit(2);
}

// ---- 启动自有静态服务 ----
const server = spawn(process.execPath, [join(root, 'serve-standalone.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
let base = null;
server.stdout.on('data', (d) => {
  const m = String(d).match(/http:\/\/127\.0\.0\.1:(\d+)\//);
  if (m && !base) base = `http://127.0.0.1:${m[1]}`;
});
server.stderr.on('data', (d) => console.error('[server]', String(d).slice(0, 200)));
for (let i = 0; i < 40 && !base; i++) await new Promise((r) => setTimeout(r, 100));
if (!base) {
  console.error('SERVER_START_FAILED');
  server.kill();
  process.exit(2);
}
console.log(`[headless] browser=${chrome}`);
console.log(`[headless] server=${base}`);

// ---- 启动Chrome（CDP模式）并等待DevToolsActivePort ----
const profile = mkdtempSync(join(tmpdir(), 'r3-cdp-'));
const chromeProc = spawn(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${profile}`,
  '--remote-debugging-port=0',
  '--window-size=410,900',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] });
const portFile = join(profile, 'DevToolsActivePort');
let devPort = null;
for (let i = 0; i < 100 && !devPort; i++) {
  await new Promise((r) => setTimeout(r, 100));
  if (existsSync(portFile)) {
    const lines = readFileSync(portFile, 'utf8').trim().split('\n');
    if (lines[0]) devPort = lines[0].trim();
  }
}
if (!devPort) {
  console.error('DEVTOOLS_PORT_NOT_FOUND');
  chromeProc.kill();
  server.kill();
  process.exit(2);
}
console.log(`[headless] devtools=127.0.0.1:${devPort}`);

// ---- 极简CDP客户端 ----
const ver = await (await fetch(`http://127.0.0.1:${devPort}/json/version`)).json();
const wsUrl = ver.webSocketDebuggerUrl.replace('localhost', '127.0.0.1');
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = (e) => reject(new Error('WS_ERROR'));
});
let msgId = 0;
const pending = new Map();
const events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  } else if (msg.method) {
    events.push(msg);
  }
};
function cdp(method, params = {}, sessionId) {
  const id = ++msgId;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  ws.send(JSON.stringify(payload));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const scenarios = [
  { name: 'r3-01-idle-402x874-dpr3', q: '?measure=1', w: 402, h: 874, dpr: 3, shot: true },
  { name: 'r3-02-preview-402x874-dpr3', q: '?autoInject=png&measure=1', w: 402, h: 874, dpr: 3, shot: true },
  { name: 'r3-03-discard-contract-402x874-dpr3', q: '?autoInject=png&auto=wait:2500,click:discard,wait:400,receipt:discard&measure=1&collectWait=1', w: 402, h: 874, dpr: 3, shot: true, waitMs: 6500 },
  { name: 'r3-04-requesting-cancel-exit-402x874', q: '?fakeMedia=hang&auto=click:open,wait:600&measure=1', w: 402, h: 874, dpr: 3, shot: true, waitMs: 3500 },
  { name: 'r3-05-hangup-receipt-402x874', q: '?fakeMedia=hang&auto=click:open,wait:600,click:close,wait:400,receipt:hangup&measure=1', w: 402, h: 874, dpr: 3, shot: true, waitMs: 5000 },
  { name: 'r3-06-denied-402x874', q: '?fakeMedia=deny&auto=click:open,wait:400&measure=1', w: 402, h: 874, dpr: 3, shot: true, waitMs: 3000 },
  { name: 'r3-07-error-invalid-402x874', q: '?autoInject=bad&measure=1', w: 402, h: 874, dpr: 3, shot: true, waitMs: 3000 },
  { name: 'r3-08-unsupported-picker-ok-402x874', q: '?fakeMedia=none&auto=click:open,wait:400&measure=1', w: 402, h: 874, dpr: 3, shot: true, waitMs: 3000 },
  { name: 'r3-09-long-notice-not-blocking-402x874', q: '?fakeMedia=deny&longNotice=1&auto=click:open,wait:500,wait:2600&measure=1', w: 402, h: 874, dpr: 3, shot: true, waitMs: 6000 },
  { name: 'r3-10-preview-390x844-real', q: '?autoInject=png&measure=1', w: 390, h: 844, dpr: 3, shot: true },
  { name: 'r3-11-preview-360x800-real', q: '?autoInject=png&measure=1', w: 360, h: 800, dpr: 3, shot: true },
];

const results = [];
for (const s of scenarios) {
  const colName = `${s.name}.json`;
  const colPath = join(evidenceDir, 'collected', colName);
  if (existsSync(colPath)) rmSync(colPath);
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Page.enable', {}, sessionId);
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: s.w, height: s.h, deviceScaleFactor: s.dpr, mobile: true,
  }, sessionId);
  await cdp('Page.navigate', { url: `${base}/src/standalone/index.html${s.q}&collect=${s.name}` }, sessionId);
  const waitMs = s.waitMs ?? 2500;
  const steps = Math.ceil(waitMs / 200);
  for (let i = 0; i < steps && !existsSync(colPath); i++) await new Promise((r) => setTimeout(r, 200));
  // 额外等待真实网络/渲染收敛
  for (let i = 0; i < 25 && !existsSync(colPath); i++) await new Promise((r) => setTimeout(r, 200));
  let dumped = null;
  if (existsSync(colPath)) dumped = JSON.parse(readFileSync(colPath, 'utf8'));
  const measure = dumped?.measure ?? null;
  const receipt = dumped?.receipt ?? null;
  let png = null;
  if (s.shot) {
    const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
    const shotPath = join(shotsDir, `${s.name}.png`);
    writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    const b = readFileSync(shotPath);
    png = { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  const checks = {
    realLayoutViewport: measure ? measure.clientWidth === s.w : null,
    realDpr3: measure ? measure.devicePixelRatio === s.dpr : null,
    physicalSizeMatchesDpr3: png ? png.width === s.w * s.dpr && png.height === s.h * s.dpr : null,
    bodyFitsViewport: measure ? measure.bodyWidth <= s.w : null,
  };
  if (receipt) {
    checks.receiptMicZero = receipt.micRequests === 0;
    checks.receiptUploadsZero = receipt.uploadsAttempted === 0;
    const terminal = ['hangup', 'dispose', 'leave', 'close', 'discard'].includes(receipt.reason);
    if (terminal) {
      checks.receiptDanglingZero = receipt.danglingUrls === 0;
      checks.receiptTerminalClean = receipt.liveTracksAtEnd === 0 && receipt.urlsHeldAtEnd === 0 && receipt.stateAtEnd === 'disposed';
    } else if (s.q.includes('autoInject=png')) {
      // preview快照：照片被持有属预期（非泄漏）
      checks.snapshotHeldByDesign = receipt.urlsHeldAtEnd > 0 && receipt.stateAtEnd === 'preview';
    }
    checks.receiptReason = receipt.reason;
  }
  if (measure && measure.noticeLength > 100) {
    const n = measure.rects.notice;
    const ov = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    checks.longNoticeNotCoveringButtons = !ov(n, measure.rects.open) && !ov(n, measure.rects.shot) && !ov(n, measure.rects.close) && !ov(n, measure.rects.dispose);
  }
  results.push({ scenario: s.name, url: `${base}/src/standalone/index.html${s.q}`, requestedViewport: { w: s.w, h: s.h, dpr: s.dpr }, png, measure, receipt, checks });
  console.log(`[headless] ${s.name}: png=${png ? `${png.width}x${png.height}` : 'FAIL'} clientWidth=${measure?.clientWidth} dpr=${measure?.devicePixelRatio} checks=${JSON.stringify(checks)}`);
  await cdp('Target.closeTarget', { targetId });
}

writeFileSync(join(evidenceDir, 'headless-measure.json'), JSON.stringify({ generatedAt: new Date().toISOString(), chrome, base, emulation: 'CDP Emulation.setDeviceMetricsOverride (true layout, not image scaling)', results }, null, 2));
console.log(`[headless] written ${join(evidenceDir, 'headless-measure.json')}`);

// ---- 清理 ----
try { ws.close(); } catch {}
chromeProc.kill();
server.kill();
try { execSync(`taskkill /F /PID ${chromeProc.pid} /T`, { stdio: 'ignore' }); } catch {}
try { rmSync(profile, { recursive: true, force: true }); } catch {}
const failed = results.filter((r) => Object.entries(r.checks).some(([, v]) => v === false));
console.log(`[headless] DONE scenarios=${results.length} failedChecks=${failed.length}`);
process.exit(0);
