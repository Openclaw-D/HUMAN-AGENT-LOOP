// R4产品/壳两用资源序列验证harness(零依赖,Node22内置WebSocket+fetch)。
// 用法:
//   node tools/verify-product.mjs                       # 自测靶=R3独立壳(evidenceClass=harness-selftest)
//   node tools/verify-product.mjs --entry <产品URL> --inputs <R4_MAIN批次目录>
//                                                       # 产品验证(evidenceClass=product,须提供inputs以引用批次hash)
// 输出:runtime/product-verify/<run>/summary.json + summary.normalized.json(去时间戳,重跑hash稳定)
// 纪律:仅127.0.0.1;自有Chrome进程+临时profile,结束时taskkill记录PID;不触碰共享端口。
import { spawn, spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]+$/, '');
const batchDir = join(root, '..');
const outRoot = join(batchDir, 'runtime', 'product-verify');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : def;
}
const entryArg = arg('entry', null);
const inputsDir = arg('inputs', null);
const W = Number(arg('w', 402));
const H = Number(arg('h', 874));
const DPR = Number(arg('dpr', 3));

// evidenceClass判定:提供inputs目录且存在=product;否则harness-selftest
let evidenceClass = 'harness-selftest';
let inputsInfo = null;
if (inputsDir) {
  const abs = inputsDir.startsWith('/') || /^[A-Za-z]:/.test(inputsDir) ? inputsDir : join(batchDir, inputsDir);
  if (existsSync(abs)) {
    evidenceClass = 'product';
    inputsInfo = { dir: abs };
    try {
      const entries = fsList(abs);
      const manifest = entries.find((f) => /manifest|inputs\.json$/i.test(f));
      if (manifest) inputsInfo.manifestSha256 = sha256(manifest);
      inputsInfo.files = entries.map((f) => f.replace(abs, ''));
    } catch {}
  } else {
    console.error(`[verify] --inputs 目录不存在:${abs}(按harness-selftest继续)`);
  }
}

function fsList(dir) {
  const out = [];
  for (const e of execSync(`dir /s /b "${dir}"`, { shell: 'cmd.exe' }).toString().split(/\r?\n/).filter(Boolean)) out.push(e);
  return out;
}
function sha256(file) {
  return execSync(`certutil -hashfile "${file}" SHA256`).toString().split(/\r?\n/)[1].replace(/\s+/g, '');
}

// ---- 自测模式:自建内联服务(R3壳静态文件 + /__collect回收端点;不依赖冻结工具) ----
let server = null;
let base = null;
let entry = entryArg;
if (!entry) {
  const r3Dir = join(root, '..', '..', 'R3_CAMERA_20260913');
  const { createServer } = await import('node:http');
  const { readFile } = await import('node:fs/promises');
  const { extname, normalize, sep } = await import('node:path');
  const r3Root = join(r3Dir).replace(/[\\/]+$/, '');
  const mimes = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.json': 'application/json; charset=utf-8' };
  const collectedDir = join(batchDir, 'runtime', 'product-verify', 'collected');
  const srv = createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      let p = decodeURIComponent(u.pathname);
      if (req.method === 'POST' && p === '/__collect') {
        const name = (u.searchParams.get('name') || '').toLowerCase();
        if (!/^[a-z0-9._-]{1,120}$/.test(name)) { res.writeHead(400); res.end(); return; }
        let body = '';
        for await (const ch of req) body += ch;
        JSON.parse(body);
        mkdirSync(collectedDir, { recursive: true });
        writeFileSync(join(collectedDir, name), body);
        res.writeHead(204); res.end(); return;
      }
      if (p === '/') p = '/src/standalone/index.html';
      const fp = normalize(join(r3Root, p));
      if (!fp.startsWith(r3Root + sep)) { res.writeHead(403); res.end(); return; }
      const data = await readFile(fp);
      res.writeHead(200, { 'content-type': mimes[extname(fp).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    } catch {
      res.writeHead(404); res.end();
    }
  });
  server = srv;
  srv.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${srv.address().port}`;
  });
  for (let i = 0; i < 40 && !base; i++) await new Promise((r) => setTimeout(r, 100));
  if (!base) {
    console.error('SELFTEST_SERVER_FAILED');
    stopServer();
    process.exit(2);
  }
  entry = `${base}/src/standalone/index.html`;
  console.log(`[verify] selftest entry=${entry}`);
} else {
  console.log(`[verify] product entry=${entry}`);
}


function stopServer() {
  if (!server) return;
  try { if (typeof server.kill === 'function') server.kill(); else server.close(); } catch {}
}

// ---- 启动Chrome CDP ----
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
  stopServer();
  process.exit(2);
}
const profile = mkdtempSync(join(tmpdir(), 'r4verify-'));
const chromeProc = spawn(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${profile}`,
  '--remote-debugging-port=0',
  `--window-size=${W + 8},${H + 8}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] });
const portFile = join(profile, 'DevToolsActivePort');
let devPort = null;
for (let i = 0; i < 100 && !devPort; i++) {
  await new Promise((r) => setTimeout(r, 100));
  if (existsSync(portFile)) devPort = readFileSync(portFile, 'utf8').trim().split('\n')[0]?.trim();
}
if (!devPort) {
  console.error('DEVTOOLS_PORT_NOT_FOUND');
  chromeProc.kill();
  stopServer();
  process.exit(2);
}
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
const waitFor = (file, ms) => new Promise((r) => { const t0 = Date.now(); const t = () => existsSync(file) ? r(true) : (Date.now() - t0 > ms ? r(false) : setTimeout(t, 150)); t(); });
let collectSeq = 0;

// 序列执行:每序列新target+仿真+navigate+等collect
async function runSequence(seq) {
  const colName = `seq-${seq.id}-${++collectSeq}.json`;
  const colPath = join(batchDir, 'runtime', 'product-verify', 'collected', colName);
  if (existsSync(colPath)) rmSync(colPath);
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Page.enable', {}, sessionId);
  await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: true }, sessionId);
  const url = seq.url(entry, colName);
  await cdp('Page.navigate', { url }, sessionId);
  if (seq.waitMs) {
    for (let i = 0; i < Math.ceil(seq.waitMs / 150) && !existsSync(colPath); i++) await sleep(150);
    await sleep(500);
  }
  let collected = null;
  if (existsSync(colPath)) collected = JSON.parse(readFileSync(colPath, 'utf8'));
  let png = null;
  if (seq.shot) {
    const shot = await cdp('Page.captureScreenshot', { format: 'png' }, sessionId);
    const shotPath = join(outDir, `${seq.id}.png`);
    writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    png = { path: `${seq.id}.png`, bytes: Buffer.byteLength(shot.data, 'base64') };
  }
  // 读取页面内真实控制器状态(若在)
  let live = null;
  try {
    live = await cdp('Runtime.evaluate', {
      expression: `(window.__CAMERA_TEST && window.__CAMERA_TEST.controller) ? { state: window.__CAMERA_TEST.controller.getSnapshot().state, usage: window.__CAMERA_TEST.controller.getResourceUsage(), counters: window.__CAMERA_TEST.controller.getResourceCounters?.() ?? null } : null`,
      returnByValue: true,
    }, sessionId);
    live = live.result?.value ?? null;
  } catch { live = null; }
  let post = null;
  if (seq.post) {
    try { post = await seq.post(targetId, sessionId); } catch (e) { post = { postError: String(e.message || e) }; }
  }
  await cdp('Target.closeTarget', { targetId });
  return { seq: seq.id, url, collected, live, png, post };
}

let outDir = join(outRoot, arg('out', evidenceClass === 'product' ? 'product-' : 'selftest-') + Date.now());
if (arg('out')) outDir = join(outRoot, arg('out'));
mkdirSync(outDir, { recursive: true });

// ---- 序列定义 ----
const withCollect = (e, colName, q) => {
  const joiner = e.includes('?') ? '&' : '?';
  return `${e}${joiner}collect=${colName}${q ? '&' + q : ''}`;
};
const sequences = [];
// S1 idle零调用(通用)
sequences.push({
  id: 'S1-idle-no-device-call',
  url: (e, col) => withCollect(e, col, 'measure=1'),
  waitMs: 2500,
  shot: true,
  assert(d) {
    const gum = d?.receipt ? d.receipt.gumCallsTotal : null;
    return { gumCallsTotal: gum, expectedZero: gum === 0 };
  },
});
// S7 选图注入→预览持有(需要壳autoInject或MAIN注入钩子)
sequences.push({
  id: 'S7-select-photo-preview-held',
  shellHooksOnly: true,
  url: (e, col) => withCollect(e, col, 'autoInject=png&measure=1'),
  waitMs: 4000,
  shot: true,
  assert(d) {
    if (!d) return { skipped: 'SKIPPED_PAGE_NO_HOOK(需要页面注入钩子)' };
    const r = d.receipt;
    return { held: r.urlsHeldAtEnd > 0 && r.stateAtEnd === 'preview', urlsHeldAtEnd: r.urlsHeldAtEnd, stateAtEnd: r.stateAtEnd };
  },
});
// S8 作废(注入→discard→终态)
sequences.push({
  id: 'S8-discard-terminal-clean',
  shellHooksOnly: true,
  url: (e, col) => withCollect(e, col, 'autoInject=png&auto=wait:2200,click:discard,wait:400,receipt:discard&measure=1'),
  waitMs: 5000,
  shot: true,
  assert(d) {
    if (!d) return { skipped: 'SKIPPED_PAGE_NO_HOOK' };
    const r = d.receipt;
    return { terminalClean: r.danglingUrls === 0 && r.liveTracksAtEnd === 0 && r.urlsHeldAtEnd === 0, reason: r.reason };
  },
});
// S4+S5 挂断收据(取消+dispose)
sequences.push({
  id: 'S5-hangup-receipt',
  shellHooksOnly: true,
  url: (e, col) => withCollect(e, col, 'fakeMedia=hang&auto=click:open,wait:600,click:close,wait:400,receipt:hangup&measure=1'),
  waitMs: 5000,
  shot: true,
  assert(d) {
    if (!d) return { skipped: 'SKIPPED_PAGE_NO_HOOK(产品挂断路径需MAIN钩子或按钮选择子)' };
    const r = d.receipt;
    return { hangupClean: r.micRequests === 0 && r.danglingUrls === 0 && r.liveTracksAtEnd === 0 && r.urlsHeldAtEnd === 0 && r.stateAtEnd === 'disposed', reason: r.reason, eventLogLen: r.eventLog?.length ?? 0 };
  },
});
// S3 授权迟到注入:壳fakeMedia=hang即授权永不返回;产品需虚拟流钩子→SKIPPED
sequences.push({
  id: 'S3-late-auth-skip-note',
  url: (e) => e,
  waitMs: 0,
  assert() { return { skipped: 'SKIPPED_PAGE_NO_HOOK(需MAIN提供虚拟/挂起媒体钩子;真实设备禁用)' }; },
});
// S6 离页:离开前快照+离开后重进新实例零残留
sequences.push({
  id: 'S6-leave-no-residual',
  url: (e, col) => withCollect(e, col, 'autoInject=png&measure=1'),
  waitMs: 4000,
  shot: true,
  async post() {
    // 离开→回进:新target=全新页面实例,应为干净idle(上一实例已随target销毁;产品若有常驻控制器则为缺陷面)
    const { targetId: t2 } = await cdp('Target.createTarget', { url: 'about:blank' });
    const { sessionId: s2 } = await cdp('Target.attachToTarget', { targetId: t2, flatten: true });
    await cdp('Page.enable', {}, s2);
    await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: true }, s2);
    const reenterUrl = entry.includes('?') ? entry.slice(0, entry.indexOf('?')) : entry;
    await cdp('Page.navigate', { url: reenterUrl }, s2);
    await sleep(1500);
    const live = await cdp('Runtime.evaluate', {
      expression: `(window.__CAMERA_TEST && window.__CAMERA_TEST.controller) ? { state: window.__CAMERA_TEST.controller.getSnapshot().state, counters: window.__CAMERA_TEST.controller.getResourceCounters() } : { state: 'no-instance-yet' }`,
      returnByValue: true,
    }, s2);
    await cdp('Target.closeTarget', { targetId: t2 });
    return { freshInstanceState: live.result?.value ?? null };
  },
  assert(d, live, post) {
    const held = d?.receipt ? d.receipt.urlsHeldAtEnd : null;
    return { beforeLeavePreviewHeld: held !== null ? held > 0 : null, afterReenter: post?.freshInstanceState?.state ?? null, countersAfterReenter: post?.freshInstanceState?.counters ?? null };
  },
});

const summary = {
  schema: 'r4-camera-verify/v1',
  evidenceClass,
  inputs: inputsInfo,
  entry,
  viewport: { width: W, height: H, dpr: DPR },
  chrome,
  sequences: [],
};
for (const seq of sequences) {
  if (seq.shellHooksOnly && evidenceClass === 'product') {
    summary.sequences.push({ seq: seq.id, skipped: 'SKIPPED_PAGE_NO_HOOK(产品页需MAIN提供对应注入钩子)' });
    console.log(`[verify] ${seq.id}: SKIPPED_PAGE_NO_HOOK`);
    continue;
  }
  try {
    const { collected, live, png } = await runSequence(seq);
    let post = null;
    if (seq.post) post = await seq.post();
    const assertion = seq.assert(collected, live, post);
    summary.sequences.push({ seq: seq.id, assertion, collected, liveState: live, png });
    console.log(`[verify] ${seq.id}: ${JSON.stringify(assertion).slice(0, 220)}`);
  } catch (e) {
    summary.sequences.push({ seq: seq.id, error: String(e.message || e) });
    console.error(`[verify] ${seq.id} ERROR: ${e.message}`);
  }
}

const normalized = { schema: summary.schema, evidenceClass, entry, viewport: summary.viewport, sequences: summary.sequences.map((x) => ({ seq: x.seq, ...(x.assertion ?? {}), ...(x.skipped ? { skipped: x.skipped } : {}), ...(x.error ? { error: x.error } : {}) })) };
const normalizedSha256 = createHash('sha256').update(Buffer.from(JSON.stringify(normalized))).digest('hex');
summary.normalizedSha256 = normalizedSha256;
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(outDir, 'summary.normalized.json'), JSON.stringify(normalized, null, 2));
console.log(`[verify] out=${outDir} normalizedSha256=${normalizedSha256.slice(0, 12)}…`);

// ---- 清理 ----
try { ws.close(); } catch {}
chromeProc.kill();
try { execSync(`taskkill /F /PID ${chromeProc.pid} /T`, { stdio: 'ignore' }); } catch {}
stopServer();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
console.log(`[verify] DONE chromePid=${chromeProc.pid}(已终止)`);
process.exit(0);
