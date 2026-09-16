// R3手机测试壳装配（402×874真实布局基准）：仅模块验证用，非产品页面。
// 进入页面不请求摄像头/麦克风；fakeMedia钩子在控制器创建前安装，永不触真实设备。
// R3新增：作废照片（discardPreview）、事件日志、上传探针、资源收据导出、auto序列、几何测量。
import {
  CameraController,
  detectCapabilities,
  buildResourceReceipt,
  CAMERA_CONTROLLER_VERSION,
} from '../camera-controller.mjs';

const $ = (id) => document.getElementById(id);
const stateEl = $('state');
const hintEl = $('hint');
const noticeEl = $('notice');
const capEl = $('cap');
const liveEl = $('live-indicator');
const video = $('vf');
const origBlock = $('orig-block');
const origImg = $('shot-img');
const origMeta = $('orig-meta');
const thumbBlock = $('thumb-block');
const thumbImg = $('thumb-img');
const thumbMeta = $('thumb-meta');
const btnOpen = $('open');
const btnShot = $('shot');
const btnClose = $('close');
const btnDiscard = $('discard');
const btnPickBtn = $('pick-btn');
const btnDispose = $('dispose');
const btnInjectPng = $('inject-png');
const btnInjectBad = $('inject-bad');
const fileInput = $('pick');
const continuousCb = $('continuous');
const receiptDump = $('receipt-dump');

const params = new URLSearchParams(location.search);
const fakeMode = params.get('fakeMedia');
const autoInject = params.get('autoInject');
const autoSeqParam = params.get('auto');
const measureOn = params.get('measure') === '1';
const longNotice = params.get('longNotice') === '1';

// ---- 上传探针（页面级）：仅计数非GET/HEAD的网络发送，供收据uploadsAttempted字段 ----
window.__uploadProbeHits = 0;
const origFetch = window.fetch?.bind(window);
if (origFetch) {
  window.fetch = (input, init = {}) => {
    const method = String(init.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') window.__uploadProbeHits += 1;
    return origFetch(input, init);
  };
}
if (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype?.open) {
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, ...rest) {
    const m = String(method || 'GET').toUpperCase();
    if (m !== 'GET' && m !== 'HEAD') window.__uploadProbeHits += 1;
    return origOpen.call(this, method, ...rest);
  };
}

// ---- 测试钩子：虚拟mediaDevices（仅fakeMedia参数时安装，且必须在控制器构造前） ----
let fakeInstalled = '无（真实浏览器API）';
if (fakeMode === 'hang' || fakeMode === 'deny' || fakeMode === 'none') {
  const fake =
    fakeMode === 'none'
      ? undefined // 模拟“无视频provider/未配置”：能力检测应为missing，且不得影响本地选图
      : {
          __fake: true,
          getUserMedia(constraints) {
            window.__fakeGumCalls = (window.__fakeGumCalls ?? 0) + 1;
            window.__fakeGumLastConstraints = constraints;
            ev('gum', { audio: constraints.audio });
            if (fakeMode === 'hang') return new Promise(() => {});
            return Promise.reject(Object.assign(new Error('denied by fake'), { name: 'NotAllowedError' }));
          },
        };
  try {
    Object.defineProperty(navigator, 'mediaDevices', { value: fake, configurable: true });
    fakeInstalled = `?fakeMedia=${fakeMode}（虚拟依赖，未触真实设备）`;
  } catch {
    fakeInstalled = `${fakeMode}（安装失败，回退真实API）`;
  }
}
$('hook-state').textContent = fakeInstalled;

// ---- 事件日志（资源收据原料） ----
const t0 = performance.now();
const eventLog = [];
function ev(kind, data = {}) {
  eventLog.push({ t: Math.round(performance.now() - t0), kind, ...data });
}

const STATE_LABELS = {
  idle: '待机（未请求设备）',
  requesting: '正在请求摄像头…',
  ready: '摄像头已开启',
  capturing: '正在拍照…',
  preview: '已获得照片（本地预览）',
  denied: '摄像头权限被拒绝',
  unsupported: '当前环境不支持直接调用摄像头',
  error: '出错',
  disposed: '已全部释放',
};

capEl.textContent = `版本 ${CAMERA_CONTROLLER_VERSION}\n${JSON.stringify(detectCapabilities(), null, 2)}`;

let prevState = 'idle';
function notice(text) {
  noticeEl.textContent = text;
}

let controller = null;

function buildController() {
  const c = new CameraController({
    captureMode: continuousCb.checked ? 'continuous' : 'single',
    onStateChange: (snapshot) => {
      ev('state', { from: prevState, to: snapshot.state });
      prevState = snapshot.state;
      render(snapshot);
    },
    onPreview: (preview) => {
      ev('preview', { id: preview.id, byteLength: preview.byteLength });
      renderPreview(preview);
    },
    onError: (err) => {
      ev('error', { code: err.code });
      notice(
        err.fallbackHint === 'file_picker'
          ? `${err.message}（请改用“选择文件”）`
          : err.message,
      );
    },
    onStream: (stream) => {
      ev('stream', { present: Boolean(stream) });
      video.srcObject = stream;
      video.hidden = !stream;
      if (stream) video.play().catch(() => {});
    },
  });
  return c;
}

controller = buildController();

function render(snapshot = controller.getSnapshot()) {
  stateEl.textContent = STATE_LABELS[snapshot.state] ?? snapshot.state;
  hintEl.textContent = snapshot.activePreviewId ?? '无';
  liveEl.hidden = !snapshot.hasLiveStream;
  const openable =
    snapshot.state === 'idle' ||
    snapshot.state === 'denied' ||
    snapshot.state === 'error' ||
    (snapshot.state === 'preview' && !snapshot.hasLiveStream);
  btnOpen.disabled = !openable;
  btnShot.disabled = !(snapshot.hasLiveStream && (snapshot.state === 'ready' || snapshot.state === 'preview'));
  btnClose.disabled = !(snapshot.hasLiveStream || snapshot.state === 'requesting');
  btnDiscard.disabled = !snapshot.activePreviewId || snapshot.state === 'disposed';
  btnDispose.disabled = snapshot.state === 'disposed';
}

async function sha256Hex(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function renderPreview(preview) {
  notice('');
  origBlock.hidden = false;
  origBlock.open = true;
  origImg.src = preview.url ?? '';
  origMeta.textContent = [
    `来源方式 sourceMethod: ${preview.sourceMethod}`,
    `出处 origin: ${preview.origin}（未验证，不能证明现场拍摄）`,
    `尺寸: ${preview.width ?? '未知'}×${preview.height ?? '未知'}`,
    `类型: ${preview.mime || '未知'}`,
    `字节: ${preview.byteLength}`,
    `原件SHA-256: 计算中…`,
    `接收时间 receivedAt: ${new Date(preview.receivedAt).toLocaleString()}`,
    `拍摄时间: 未知（未读取EXIF，不用本机时间冒充）`,
    `capture提示: ${preview.captureHint ? preview.captureHint.capture : '无'}（仅记录，非出处证明）`,
    `警告: ${preview.warnings.length ? preview.warnings.join(', ') : '无'}`,
    `尚未入库：仅本地预览，刷新后丢失。`,
  ].join('\n');
  sha256Hex(preview.blob).then((hex) => {
    origMeta.textContent = origMeta.textContent.replace('原件SHA-256: 计算中…', `原件SHA-256: ${hex}`);
  });
  if (preview.thumbnail) {
    thumbBlock.hidden = false;
    thumbImg.src = preview.thumbnail.url ?? '';
    thumbMeta.textContent = [
      `缩略图尺寸: ${preview.thumbnail.width ?? '未知'}×${preview.thumbnail.height ?? '未知'}`,
      `缩略图字节: ${preview.thumbnail.blob.size}（与原件独立：${preview.thumbnail.blob.size === preview.byteLength ? '异常' : '不同副本'}）`,
      `说明: 缩略图为另建的有损副本，不覆盖原件字节。`,
    ].join('\n');
  } else {
    thumbBlock.hidden = true;
  }
}

btnOpen.addEventListener('click', () => {
  const r = controller.openFromUserGesture();
  if (!r.ok && r.code !== 'ALREADY_PENDING' && r.code !== 'ALREADY_OPEN' && r.code !== 'UNSUPPORTED') {
    notice(`开启未执行：${r.code}`);
  }
  if (r.ok) ev('action', { op: 'open' });
});

btnShot.addEventListener('click', () => {
  const r = controller.capture();
  ev('action', { op: 'capture', ok: r.ok, code: r.ok ? null : r.code });
  if (!r.ok) notice(`拍照未执行：${r.code}`);
});

btnClose.addEventListener('click', () => {
  if (controller.getSnapshot().state === 'requesting') {
    const r = controller.cancelRequest();
    ev('action', { op: 'cancel', ok: r.ok, code: r.ok ? null : r.code });
    notice(r.ok ? '已取消请求，未保留任何设备或URL资源。' : `取消未执行：${r.code}`);
    return;
  }
  const r = controller.closeStream();
  ev('action', { op: 'close', ok: r.ok, code: r.ok ? null : r.code });
  if (!r.ok) notice(`关闭未执行：${r.code}`);
});

btnDiscard.addEventListener('click', () => {
  const r = controller.discardPreview();
  ev('action', { op: 'discard', ok: r.ok, code: r.ok ? null : r.code, hasLiveStream: r.hasLiveStream });
  notice(
    r.ok
      ? `已作废照片内容（仅内容）：本地URL已撤销；摄像头${r.hasLiveStream ? '仍开启（见状态条）' : '当前未开启'}。`
      : `作废未执行：${r.code}`,
  );
});

btnPickBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const captureAttr = fileInput.getAttribute('capture');
  const r = await controller.acceptFile(file, { captureHint: captureAttr ? { capture: captureAttr } : null });
  if (!r.ok) notice(`文件未被接受：${r.code}`);
  fileInput.value = '';
});

btnDispose.addEventListener('click', () => {
  ev('action', { op: 'dispose' });
  controller.dispose();
  notice('已释放全部轨道与URL（挂断语义：不留任何隐形采集）。');
});

continuousCb.addEventListener('change', () => {
  const hadLive = controller.getSnapshot().hasLiveStream;
  controller.dispose();
  controller = buildController();
  window.__R3_TEST.controller = controller;
  notice(
    `已按${continuousCb.checked ? '连续' : '单次'}模式重建控制器；${hadLive ? '原摄像头已关闭，' : ''}需重新点击“开启摄像头”。`,
  );
});

async function injectPng() {
  try {
    const res = await fetch('/evidence/assets/synthetic-800x1200.png');
    if (!res.ok) throw new Error(`素材HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const file = new File([bytes], 'synthetic-800x1200.png', { type: 'image/png' });
    const r = await controller.acceptFile(file, { captureHint: { capture: 'environment' } });
    if (!r.ok) notice(`文件未被接受：${r.code}`);
  } catch (e) {
    notice(`注入失败：${e.message}`);
  }
}

function injectBad() {
  const file = new File([new Uint8Array([1, 2, 3])], 'fake.mp4', { type: 'video/mp4' });
  controller.acceptFile(file).then((r) => {
    notice(r.ok ? '异常：非图片文件被接受。' : `文件已被拒绝：${r.code}（预期行为）`);
  });
}

btnInjectPng.addEventListener('click', () => injectPng());
btnInjectBad.addEventListener('click', () => injectBad());

if (autoInject === 'png') setTimeout(() => injectPng(), 500);
if (autoInject === 'bad') setTimeout(() => injectBad(), 500);

// ---- 资源收据与几何测量导出 ----
function rectOf(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}

function measureInfo() {
  const n = (noticeEl.textContent || '').trim();
  return {
    href: location.href,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight,
    devicePixelRatio: window.devicePixelRatio,
    bodyWidth: Math.round(document.body.getBoundingClientRect().width),
    noticeLength: n.length,
    rects: {
      notice: rectOf('notice'),
      state: rectOf('state'),
      open: rectOf('open'),
      shot: rectOf('shot'),
      pickBtn: rectOf('pick-btn'),
      close: rectOf('close'),
      dispose: rectOf('dispose'),
    },
  };
}

function buildReceipt(reason = 'dispose') {
  return buildResourceReceipt({
    events: eventLog,
    finalUsage: controller.getResourceUsage(),
    counters: controller.getResourceCounters(),
    meta: {
      reason,
      startedAt: Math.round(t0),
      endedAt: Math.round(performance.now()),
      version: CAMERA_CONTROLLER_VERSION,
      uploadsAttempted: window.__uploadProbeHits,
    },
  });
}

function dumpReceipt(reason = 'dispose') {
  const payload = {
    receipt: buildReceipt(reason),
    measure: measureOn ? measureInfo() : null,
  };
  receiptDump.hidden = false;
  receiptDump.textContent = JSON.stringify(payload, null, 2);
  return payload;
}

window.addEventListener('pagehide', () => controller.dispose());

// ---- auto序列调度器（headless真布局矩阵的交互驱动） ----
async function runAuto() {
  if (!autoSeqParam) return;
  for (const step of autoSeqParam.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [op, arg] = step.split(':');
    if (op === 'click') {
      const el = document.getElementById(arg);
      if (el) el.click();
    } else if (op === 'wait') {
      await new Promise((r) => setTimeout(r, Number(arg) || 200));
    } else if (op === 'receipt') {
      dumpReceipt(arg || 'dispose');
    }
  }
}

if (longNotice) {
  // 超长提示样本：验证长文案在文档流内换行、不覆盖任何按钮（配合?measure=1的矩形断言）。
  // 延迟到auto动作之后注入，避免被动作自身的报错覆盖。
  setTimeout(() => {
    noticeEl.textContent =
      '提示样本（长文案压力）：当前浏览器不支持直接调用摄像头增强，且权限请求已被策略拒绝。' +
      '请在系统或浏览器设置中允许摄像头访问后，再次点击“开启摄像头”；若所在环境为非安全上下文（例如通过局域网IP以HTTP访问），' +
      '直接调用将被永久禁用，此时请改用“选择文件（系统拍照/相册）”路径完成照片采集。本提示用于验证超长错误文案在移动端竖屏下完整换行显示，' +
      '不产生横向滚动，也不遮挡或覆盖下方任何操作按钮，用户始终可以直接点击挂断与拍照相关控件完成操作。';
  }, autoSeqParam ? 2500 : 200);
}

// ---- headless矩阵回收：?collect=<name> 在auto序列结束后POST收据+测量给自有服务 ----
const collectName = (params.get('collect') || '').toLowerCase();
const TERMINAL_REASONS = ['hangup', 'dispose', 'leave', 'close', 'discard'];
async function sendCollect(reason) {
  // 优先级：显式receipt参数 > auto序列内的receipt:reason步骤 > snapshot（会话仍开）
  const autoMatch = (autoSeqParam || '').match(/receipt:([a-z]+)/);
  const r = reason || params.get('receipt') || (autoMatch ? autoMatch[1] : '') || 'snapshot';
  if (TERMINAL_REASONS.includes(r)) controller.dispose(); // 挂断/作废类：先终结再快照计数
  const payload = { receipt: buildReceipt(r), measure: measureInfo() };
  try {
    await fetch(`/__collect?name=${encodeURIComponent(collectName)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // 回收失败不影响页面；runner侧以文件缺失为准。
  }
}
if (collectName) {
  setTimeout(() => {
    if (autoSeqParam) runAuto().then(() => sendCollect());
    else sendCollect();
  }, 600);
} else if (autoSeqParam) {
  setTimeout(runAuto, 600);
} else if (params.get('receipt')) {
  setTimeout(() => dumpReceipt(params.get('receipt')), 800);
}

// 自动化调试句柄（仅测试壳提供）
window.__R3_TEST = {
  controller,
  buildReceipt,
  measureInfo,
  pageInfo() {
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      userAgent: navigator.userAgent,
      href: location.href,
    };
  },
};

render();
