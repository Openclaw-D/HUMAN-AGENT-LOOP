// R4三viewport按钮可见量测(CDP真仿真,零依赖)。evidenceClass语义同verify-product。
// 用法: node tools/measure-viewport.mjs [--entry <URL>] [--viewports 402x874x3,390x844x3,360x800x3] [--inputs <dir>]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]+$/, '');
const batchDir = join(root, '..');
const outDir = join(batchDir, 'runtime', 'product-verify');
mkdirSync(outDir, { recursive: true });

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : def;
}
const entryArg = arg('entry', null);
const inputsDir = arg('inputs', null);
const viewports = String(arg('viewports', '402x874x3,390x844x3,360x800x3')).split(',').map((s) => {
  const [w, h, dpr] = s.split('x').map(Number);
  return { w, h, dpr };
});

let evidenceClass = 'harness-selftest';
let inputsInfo = null;
if (inputsDir) {
  const abs = /^[A-Za-z]:/.test(inputsDir) || inputsDir.startsWith('/') ? inputsDir : join(batchDir, inputsDir);
  if (existsSync(abs)) {
    evidenceClass = 'product';
    inputsInfo = { dir: abs };
  } else console.error(`[measure] inputs目录不存在:${abs}(按harness-selftest继续)`);
}

// ---- 自测靶服务(同verify-product的内联服务) ----
let server = null;
let base = null;
let entry = entryArg;
if (!entry) {
  const r3Dir = join(root, '..', '..', 'R3_CAMERA_20260913');
  const { createServer } = await import('node:http');
  const { readFile } = await import('node:fs/promises');
  const { extname, normalize, sep } = await import('node:path');
  const r3Root = join(r3Dir).replace(/[\\/]+$/, '');
  const mimes = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png' };
  const srv = createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      let p = decodeURIComponent(u.pathname);
      if (p === '/') p = '/src/standalone/index.html';
      const fp = normalize(join(r3Root, p));
      if (!fp.startsWith(r3Root + sep)) { res.writeHead(403); res.end(); return; }
      const data = await readFile(fp);
      res.writeHead(200, { 'content-type': mimes[extname(fp).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  server = srv;
  srv.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${srv.address().port}`; });
  for (let i = 0; i < 40 && !base; i++) await new Promise((r) => setTimeout(r, 100));
  entry = `${base}/src/standalone/index.html`;
  console.log(`[measure] selftest entry=${entry}`);
} else {
  console.log(`[measure] product entry=${entry}`);
}

// ---- Chrome CDP ----
const chromeArgIdx = process.argv.indexOf('--chrome');
const candidates = [
  chromeArgIdx > -1 ? process.argv[chromeArgIdx + 1] : null,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const chrome = candidates.find((p) => existsSync(p));
if (!chrome) { console.error('NO_CHROME_FOUND'); if (server) server.close(); process.exit(2); }
const profile = mkdtempSync(join(tmpdir(), 'r4measure-'));
const chromeProc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] });
const portFile = join(profile, 'DevToolsActivePort');
let devPort = null;
for (let i = 0; i < 100 && !devPort; i++) {
  await new Promise((r) => setTimeout(r, 100));
  if (existsSync(portFile)) devPort = readFileSync(portFile, 'utf8').trim().split('\n')[0]?.trim();
}
if (!devPort) { console.error('DEVTOOLS_PORT_NOT_FOUND'); chromeProc.kill(); if (server) server.close(); process.exit(2); }
const ver = await (await fetch(`http://127.0.0.1:${devPort}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WS_ERROR')); });
let msgId = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
};
const cdp = (method, params = {}, sessionId) => {
  const id = ++msgId;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  ws.send(JSON.stringify(payload));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
for (const vp of viewports) {
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Page.enable', {}, sessionId);
  await cdp('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr, mobile: true }, sessionId);
  await cdp('Page.navigate', { url: entry }, sessionId);
  await sleep(9000);
  const measure = await cdp('Runtime.evaluate', {
    expression: `(() => {
      const vv = window.visualViewport;
      const rectOf = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 }; };
      const buttons = [...document.querySelectorAll('button')].map((b) => ({ id: b.id || null, text: (b.textContent || '').trim().slice(0, 24), disabled: b.disabled, ...rectOf(b) }));
      const hangupLike = buttons.find((b) => /挂断|释放全部|结束/.test(b.text)) || null;
      return {
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight,
        innerWidth: window.innerWidth,
        devicePixelRatio: window.devicePixelRatio,
        visualViewportHeight: vv ? Math.round(vv.height) : null,
        bodyWidth: Math.round(document.body.getBoundingClientRect().width),
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        buttons,
        hangupInFirstScreen: hangupLike ? (hangupLike.y + hangupLike.h <= (vv ? vv.height : window.innerHeight)) : null,
        hangupRect: hangupLike ? { y: hangupLike.y, h: hangupLike.h } : null,
        hookType: typeof window.__CAMERA_TEST,
        hookKeys: window.__CAMERA_TEST ? Object.keys(window.__CAMERA_TEST) : null,
        bodyTextProbe: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 400),
      };
    })()`,
    returnByValue: true,
  }, sessionId);
  const m = measure.result?.value ?? null;
  const shot = await cdp('Page.captureScreenshot', { format: 'png' }, sessionId);
  const shotPath = join(outDir, `measure-${vp.w}x${vp.h}-dpr${vp.dpr}.png`);
  writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
  const b = readFileSync(shotPath);
  const png = { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  const checks = {
    realLayoutViewport: m ? m.clientWidth === vp.w : null,
    realDpr: m ? m.devicePixelRatio === vp.dpr : null,
    physicalSizeMatches: png.width === vp.w * vp.dpr && png.height === vp.h * vp.dpr,
    noHorizontalOverflow: m ? !m.horizontalOverflow : null,
    hangupVisibleFirstScreen: m ? m.hangupInFirstScreen : null,
    buttonCount: m ? m.buttons.length : 0,
  };
  results.push({ viewport: vp, entry, checks, measure: m, png, screenshot: `measure-${vp.w}x${vp.h}-dpr${vp.dpr}.png` });
  console.log(`[measure] ${vp.w}x${vp.h}@${vp.dpr}: clientWidth=${m?.clientWidth} buttons=${m?.buttons.length} hangupFirstScreen=${checks.hangupVisibleFirstScreen} checks=${JSON.stringify(checks)}`);
  await cdp('Target.closeTarget', { targetId });
}

const normalized = { schema: 'r4-measure/v1', evidenceClass, entry, inputs: inputsInfo, results: results.map((r) => ({ viewport: r.viewport, checks: r.checks, measure: r.measure })) };
const normalizedSha256 = createHash('sha256').update(Buffer.from(JSON.stringify(normalized))).digest('hex');
writeFileSync(join(outDir, `measure-summary-${evidenceClass}.json`), JSON.stringify({ generatedAt: new Date().toISOString(), normalizedSha256, ...normalized }, null, 2));
console.log(`[measure] DONE evidenceClass=${evidenceClass} normalizedSha256=${normalizedSha256.slice(0, 12)}…`);
try { ws.close(); } catch {}
chromeProc.kill();
try { execSync ? null : null; } catch {}
try { const { execSync: ex } = await import('node:child_process'); ex(`taskkill /F /PID ${chromeProc.pid} /T`, { stdio: 'ignore' }); } catch {}
if (server) server.close();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
