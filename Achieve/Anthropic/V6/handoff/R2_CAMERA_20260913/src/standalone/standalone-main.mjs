// R2手机测试壳装配（402×874基准）：仅模块验证用，非产品页面。
// 进入页面不请求摄像头/麦克风；fakeMedia钩子在控制器创建前安装，永不触真实设备。
import { CameraController, detectCapabilities, CAMERA_CONTROLLER_VERSION } from '../camera-controller.mjs';

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
const btnPickBtn = $('pick-btn');
const btnDispose = $('dispose');
const btnInjectPng = $('inject-png');
const btnInjectBad = $('inject-bad');
const fileInput = $('pick');
const continuousCb = $('continuous');

const params = new URLSearchParams(location.search);
const fakeMode = params.get('fakeMedia');
const autoInject = params.get('autoInject');

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

function notice(text) {
  noticeEl.textContent = text;
}

let controller = null;

function buildController() {
  const c = new CameraController({
    captureMode: continuousCb.checked ? 'continuous' : 'single',
    onStateChange: (snapshot) => render(snapshot),
    onPreview: (preview) => renderPreview(preview),
    onError: (err) => {
      notice(
        err.fallbackHint === 'file_picker'
          ? `${err.message}（请改用“选择文件”）`
          : err.message,
      );
    },
    onStream: (stream) => {
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
  btnDispose.disabled = snapshot.state === 'disposed';
}

async function sha256Hex(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function renderPreview(preview) {
  notice('');
  origBlock.hidden = false;
  origBlock.open = true; // 新预览到达时展开；用户手动收起后不再强制展开（收起不销毁状态）
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
  // UNSUPPORTED等已由onError给出中文提示，不覆盖；仅补充无提示的失败码。
  if (!r.ok && r.code !== 'ALREADY_PENDING' && r.code !== 'ALREADY_OPEN' && r.code !== 'UNSUPPORTED') {
    notice(`开启未执行：${r.code}`);
  }
});

btnShot.addEventListener('click', () => {
  const r = controller.capture();
  if (!r.ok) notice(`拍照未执行：${r.code}`);
});

btnClose.addEventListener('click', () => {
  // requesting期间=取消请求；有流时=关轨。均立即释放。
  if (controller.getSnapshot().state === 'requesting') {
    const r = controller.cancelRequest();
    notice(r.ok ? '已取消请求，未保留任何设备或URL资源。' : `取消未执行：${r.code}`);
    return;
  }
  const r = controller.closeStream();
  if (!r.ok) notice(`关闭未执行：${r.code}`);
});

btnDispose.addEventListener('click', () => {
  controller.dispose();
  notice('已释放全部轨道与URL。');
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

continuousCb.addEventListener('change', () => {
  // captureMode是构造依赖：切换=释放旧实例并按新模式重建（页面须重新显式开启摄像头）。
  const hadLive = controller.getSnapshot().hasLiveStream;
  controller.dispose();
  controller = buildController();
  window.__R2_TEST.controller = controller;
  notice(
    `已按${continuousCb.checked ? '连续' : '单次'}模式重建控制器；${hadLive ? '原摄像头已关闭，' : ''}需重新点击“开启摄像头”。`,
  );
});

async function injectPng() {
  try {
    const res = await fetch('/evidence/assets/synthetic-800x1200.png');
    if (!res.ok) throw new Error(`素材HTTP ${res.status}（主agent尚未生成或路径不符）`);
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

window.addEventListener('pagehide', () => controller.dispose());

// 自动化调试句柄（仅测试壳提供）
window.__R2_TEST = {
  controller,
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
