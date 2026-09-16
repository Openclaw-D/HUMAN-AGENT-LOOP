// 极小standalone样例：仅用于模块联调与人工验收，不是产品页面，也不是第二套产品前端。
// 进入页面不请求摄像头/麦克风；只有按钮点击才触发对应动作。
import { CameraController, detectCapabilities, CAMERA_CONTROLLER_VERSION } from '../camera-controller.mjs';

const $ = (id) => document.getElementById(id);
const stateEl = $('state');
const hintEl = $('hint');
const noticeEl = $('notice');
const capEl = $('cap');
const metaEl = $('meta');
const video = $('vf');
const img = $('shot-img');
const btnOpen = $('open');
const btnShot = $('shot');
const btnClose = $('close');
const btnPickBtn = $('pick-btn');
const btnDispose = $('dispose');
const fileInput = $('pick');

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

const controller = new CameraController({
  onStateChange: (snapshot) => render(snapshot),
  onPreview: (preview) => renderPreview(preview),
  onError: (err) => {
    noticeEl.textContent = err.message;
  },
  onStream: (stream) => {
    video.srcObject = stream;
    video.hidden = !stream;
    if (stream) video.play().catch(() => {});
  },
});

function render(snapshot = controller.getSnapshot()) {
  stateEl.textContent = STATE_LABELS[snapshot.state] ?? snapshot.state;
  hintEl.textContent = snapshot.activePreviewId ?? '无';
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

function renderPreview(preview) {
  noticeEl.textContent = '';
  img.hidden = false;
  img.src = preview.url ?? '';
  metaEl.textContent = [
    `来源方式 sourceMethod: ${preview.sourceMethod}`,
    `出处 origin: ${preview.origin}（未验证，不能证明现场拍摄）`,
    `尺寸: ${preview.width ?? '未知'}×${preview.height ?? '未知'}`,
    `类型: ${preview.mime || '未知'}`,
    `字节: ${preview.byteLength}`,
    `接收时间 receivedAt: ${new Date(preview.receivedAt).toLocaleString()}`,
    `拍摄时间: 未知（未读取EXIF，不用本机时间冒充）`,
    `capture提示: ${preview.captureHint ? preview.captureHint.capture : '无'}（仅提示，非出处证明）`,
    `警告: ${preview.warnings.length ? preview.warnings.join(', ') : '无'}`,
    `尚未入库：仅本地预览，刷新后丢失。`,
  ].join('\n');
}

btnOpen.addEventListener('click', () => {
  const r = controller.openFromUserGesture();
  if (!r.ok && r.code !== 'ALREADY_PENDING' && r.code !== 'ALREADY_OPEN') {
    noticeEl.textContent = `开启未执行：${r.code}`;
  }
});

btnShot.addEventListener('click', () => {
  const r = controller.capture();
  if (!r.ok) {
    noticeEl.textContent =
      r.code === 'IMAGECAPTURE_UNSUPPORTED'
        ? '当前浏览器不支持takePhoto增强，请改用“选择文件（系统拍照/相册）”。'
        : `拍照未执行：${r.code}`;
  }
});

btnClose.addEventListener('click', () => {
  const r = controller.closeStream();
  if (!r.ok) noticeEl.textContent = `关闭未执行：${r.code}`;
});

btnPickBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const captureAttr = fileInput.getAttribute('capture');
  const r = await controller.acceptFile(file, { captureHint: captureAttr ? { capture: captureAttr } : null });
  if (!r.ok) noticeEl.textContent = `文件未被接受：${r.code}`;
  fileInput.value = '';
});

btnDispose.addEventListener('click', () => controller.dispose());

// 关页/离开时释放全部轨道与URL。
window.addEventListener('pagehide', () => controller.dispose());

render();
