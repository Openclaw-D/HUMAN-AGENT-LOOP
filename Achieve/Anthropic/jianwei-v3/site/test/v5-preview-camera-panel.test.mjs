// R3-B-INT · lib/v5-preview/camera 冻结件接入语义测试（Node 环境，node:test）。
// 覆盖：
// 1) Node 下浏览器能力为 null 的优雅降级（detectCapabilities / openFromUserGesture→UNSUPPORTED 回退选图）；
// 2) mock 注入状态机：single 拍完自动关轨（成功/失败）、requestTimeoutMs 超时、cancelRequest、
//    acceptFile 作废在途拍照、外部轨道结束 TRACK_ENDED、dispose 幂等全清、capture 提示仅记录；
// 3) camera-panel.tsx 接线契约（源码断言）：唯一执行路径经 CameraController、lifecycle 四标注、
//    拍完默认关轨+连续须显式开启、本地预览不上传边界文案保留、页面不自管 URL。
// 运行：node --experimental-strip-types --test test/v5-preview-camera-panel.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const { CameraController, detectCapabilities, CAMERA_CONTROLLER_VERSION, CAMERA_STATES, SOURCE_METHODS, FILE_ORIGINS, buildResourceReceipt } =
  await import(new URL('../lib/v5-preview/camera/camera-controller.mjs', import.meta.url).href);

// ---------- 工具 ----------

const tick = () => new Promise((r) => setTimeout(r, 0));

async function waitFor(fn, ms = 1000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('waitFor 超时');
    await tick();
  }
}

function fakeBlob(size = 128, type = 'image/jpeg') {
  return { size, type, arrayBuffer: async () => new ArrayBuffer(size) };
}

/** 可注入假设备环境：轨道/流/objectURL 注册表/时钟/解码全部可控。 */
function makeEnv(overrides = {}) {
  const stopped = [];
  const revoked = [];
  let urlSeq = 0;
  function fakeTrack(label = 'track') {
    const listeners = new Map();
    return {
      label,
      readyState: 'live',
      stop() {
        this.readyState = 'ended';
        stopped.push(label);
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener() {},
      _emit(type) {
        for (const fn of listeners.get(type) ?? []) fn();
      },
    };
  }
  const fakeStream = (track) => ({ getTracks: () => [track], getVideoTracks: () => [track] });
  const deps = {
    mediaDevices: { getUserMedia: () => Promise.reject(new Error('env-not-configured')) },
    ImageCapture: null,
    createObjectURL: () => `blob:fake-${++urlSeq}`,
    revokeObjectURL: (u) => revoked.push(u),
    now: (() => { let t = 1000; return () => (t += 10); })(),
    decodeImageMetadata: async () => ({ width: 640, height: 480 }),
    createThumbnail: async () => ({ blob: fakeBlob(64, 'image/jpeg'), width: 64, height: 48 }),
    isSecureContext: true,
    ...overrides,
  };
  return { deps, stopped, revoked, fakeTrack, fakeStream };
}

// ---------- 1) 版本与 Node 优雅降级 ----------

test('接入版本校验：CAMERA_CONTROLLER_VERSION=0.3.0-r3-candidate（R4：discardPreview/资源收据版本）', () => {
  assert.equal(CAMERA_CONTROLLER_VERSION, '0.3.0-r3-candidate');
  // R4 资源收据契约：收据字段可由 buildResourceReceipt 构造（Node 下纯函数可执行）。
  assert.equal(typeof buildResourceReceipt, 'function');
  assert.deepEqual(
    [...CAMERA_STATES].sort(),
    ['capturing', 'denied', 'disposed', 'error', 'idle', 'preview', 'ready', 'requesting', 'unsupported'].sort(),
    '九态状态机不变',
  );
});

test('Node 下浏览器能力为 null：优雅降级为 UNSUPPORTED（fallback=file_picker），无权限申请、不崩溃', () => {
  const caps = detectCapabilities();
  assert.equal(caps.getUserMedia, 'missing');
  assert.equal(caps.imageCapture, 'missing');
  assert.equal(caps.liveCameraSupported, false);
  assert.equal(caps.takePhotoSupported, false);
  assert.equal(caps.secureContext, null, 'Node 未声明 isSecureContext → 未知，不据猜测判定可用');

  const states = [];
  const errors = [];
  const c = new CameraController({
    onStateChange: (s) => states.push(s.state),
    onError: (e) => errors.push({ code: e.code, hint: e.fallbackHint ?? null }),
  });
  assert.equal(c.state, 'idle');
  assert.equal(c.detectCapabilities().liveCameraSupported, false);

  const r = c.openFromUserGesture();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'UNSUPPORTED');
  assert.equal(r.fallback, 'file_picker');
  assert.equal(c.state, 'unsupported');
  assert.deepEqual(errors, [{ code: 'UNSUPPORTED', hint: 'file_picker' }]);
  const snap = c.getSnapshot();
  assert.equal(snap.hasLiveStream, false);
  assert.equal(snap.activePreviewId, null);
  assert.equal(snap.lastError.code, 'UNSUPPORTED');
  assert.equal(c.getResourceUsage().liveTracks, 0);
  assert.equal(c.getResourceUsage().urlsHeld, 0);
  c.dispose();
  assert.equal(c.state, 'disposed');
});

// ---------- 2) single 模式状态机（拍完默认关轨） ----------

test('single 模式成功路径：requesting→ready→capturing→preview；拍完自动停轨+onStream(null)；再拍须重新开启', async () => {
  let resolveGUM;
  const { deps, stopped, fakeTrack, fakeStream } = makeEnv({
    mediaDevices: { getUserMedia: () => new Promise((res) => { resolveGUM = res; }) },
  });
  class FakeImageCapture {
    takePhoto() { return Promise.resolve(fakeBlob(256)); }
  }
  const states = [];
  const delivered = [];
  const previews = [];
  const c = new CameraController({
    ...deps,
    ImageCapture: FakeImageCapture,
    onStateChange: (s) => states.push(s.state),
    onStream: (s) => delivered.push(s),
    onPreview: (p) => previews.push(p),
  });

  assert.deepEqual(c.openFromUserGesture(), { ok: true, pending: true, seq: 1 });
  assert.equal(c.state, 'requesting');
  assert.equal(c.getResourceUsage().liveTracks, 0, 'requesting 期间尚无存活轨道');

  const track = fakeTrack('env');
  const stream = fakeStream(track);
  resolveGUM(stream);
  await waitFor(() => c.state === 'ready');
  assert.deepEqual(states, ['requesting', 'ready']);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0], stream);
  assert.equal(c.getResourceUsage().liveTracks, 1);

  const r = c.capture();
  assert.equal(r.ok, true);
  assert.equal(c.state, 'capturing');
  await waitFor(() => c.state === 'preview');

  const p = previews.at(-1);
  assert.equal(p.sourceMethod, SOURCE_METHODS.LIVE_TAKEPHOTO);
  assert.equal(p.origin, FILE_ORIGINS.LIVE_CAMERA_STREAM);
  assert.equal(p.provenance, 'unverified', '出处恒为未验证');
  assert.equal(p.capturedAt, null, '不解析 EXIF：拍摄时间恒未知');
  assert.equal(p.width, 640);
  assert.ok(p.url.startsWith('blob:fake-'));
  assert.equal(c.getSnapshot().activePreviewId, p.id);

  // v0.2.0 核心：single 模式拍完立即关轨（成功同样关）。
  await waitFor(() => delivered.includes(null));
  assert.ok(stopped.includes('env'), '轨道已 stop');
  assert.equal(delivered.at(-1), null, '必须回调 onStream(null) 让页面清空取景');
  assert.equal(c.getResourceUsage().liveTracks, 0);

  // preview 态（无流）再拍 → NO_STREAM（UI 应置灰按钮，不应依赖错误路径）。
  const r2 = c.capture();
  assert.equal(r2.ok, false);
  assert.equal(r2.code, 'NO_STREAM');

  // 再拍入口：preview(无流) 允许重新 openFromUserGesture，且仍须显式调用。
  assert.equal(c.openFromUserGesture().ok, true);
  assert.equal(c.state, 'requesting');
  c.dispose();
});

test('single 模式失败路径：takePhoto 拒绝 → CAPTURE_FAILED 且立即关轨（不同于 v0.1.0 的"流保留"）', async () => {
  const { deps, stopped, fakeTrack, fakeStream } = makeEnv();
  class FakeImageCapture {
    takePhoto() { return Promise.reject(Object.assign(new Error('boom'), { name: 'PhotoError' })); }
  }
  const errors = [];
  const delivered = [];
  const c = new CameraController({
    ...deps,
    ImageCapture: FakeImageCapture,
    mediaDevices: { getUserMedia: () => Promise.resolve(fakeStream(fakeTrack('env'))) },
    onError: (e) => errors.push(e.code),
    onStream: (s) => delivered.push(s),
  });
  assert.equal(c.openFromUserGesture().ok, true);
  await waitFor(() => c.state === 'ready');

  assert.equal(c.capture().ok, true);
  await waitFor(() => c.state === 'error');
  assert.ok(errors.includes('CAPTURE_FAILED'));
  await waitFor(() => delivered.includes(null));
  assert.ok(stopped.includes('env'), 'single 模式失败也必须关轨');
  assert.equal(c.getResourceUsage().liveTracks, 0);
  c.dispose();
});

test('无 ImageCapture：capture → IMAGECAPTURE_UNSUPPORTED 显式回退选图，不改状态、不截帧冒充', async () => {
  const { deps, fakeTrack, fakeStream } = makeEnv();
  const errors = [];
  const c = new CameraController({
    ...deps,
    mediaDevices: { getUserMedia: () => Promise.resolve(fakeStream(fakeTrack('env'))) },
    onError: (e) => errors.push(e.code),
  });
  assert.equal(c.openFromUserGesture().ok, true);
  await waitFor(() => c.state === 'ready');
  const r = c.capture();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'IMAGECAPTURE_UNSUPPORTED');
  assert.equal(r.fallback, 'file_picker');
  assert.equal(c.state, 'ready', 'IMAGECAPTURE_UNSUPPORTED 不改状态');
  assert.ok(errors.includes('IMAGECAPTURE_UNSUPPORTED'));
  assert.equal(c.getResourceUsage().liveTracks, 1, '流保留（未拍照）');
  c.dispose();
});

// ---------- 3) 请求超时 / 用户取消 / 作废在途 ----------

test('requestTimeoutMs：getUserMedia 挂起超时 → 自动取消回 idle + REQUEST_TIMEOUT；迟到授权流立即停轨', async () => {
  let resolveGUM;
  const { deps, stopped, fakeTrack, fakeStream } = makeEnv({
    mediaDevices: { getUserMedia: () => new Promise((res) => { resolveGUM = res; }) },
  });
  const errors = [];
  const c = new CameraController({ ...deps, requestTimeoutMs: 30, onError: (e) => errors.push(e.code) });

  assert.equal(c.openFromUserGesture().ok, true);
  assert.equal(c.state, 'requesting');
  await waitFor(() => c.state === 'idle', 500);
  assert.ok(errors.includes('REQUEST_TIMEOUT'));
  assert.equal(c.getResourceUsage().liveTracks, 0);

  // 超时后迟到的授权流：立即停轨，不改状态、不通知。
  resolveGUM(fakeStream(fakeTrack('late')));
  await tick();
  await tick();
  assert.ok(stopped.includes('late'), '迟到授权流必须停轨');
  assert.equal(c.state, 'idle');
  c.dispose();
});

test('cancelRequest：requesting 中显式取消回 idle；迟到的授权流被停轨丢弃', async () => {
  let resolveGUM;
  const { deps, stopped, fakeTrack, fakeStream } = makeEnv({
    mediaDevices: { getUserMedia: () => new Promise((res) => { resolveGUM = res; }) },
  });
  const c = new CameraController({ ...deps });
  assert.equal(c.openFromUserGesture().ok, true);
  assert.equal(c.cancelRequest().ok, true);
  assert.equal(c.state, 'idle');
  assert.equal(c.cancelRequest().code, 'NOT_PENDING', '非 requesting 再取消 → NOT_PENDING');

  resolveGUM(fakeStream(fakeTrack('late')));
  await tick();
  await tick();
  assert.ok(stopped.includes('late'));
  assert.equal(c.state, 'idle');
  c.dispose();
});

test('acceptFile 作废在途拍照（后选文件优先）：迟到照片被丢弃，仅文件预览生效', async () => {
  let resolvePhoto;
  class FakeImageCapture {
    takePhoto() { return new Promise((res) => { resolvePhoto = res; }); }
  }
  const { deps, fakeTrack, fakeStream } = makeEnv();
  const previews = [];
  const c = new CameraController({
    ...deps,
    ImageCapture: FakeImageCapture,
    mediaDevices: { getUserMedia: () => Promise.resolve(fakeStream(fakeTrack('env'))) },
    onPreview: (p) => previews.push(p),
  });
  assert.equal(c.openFromUserGesture().ok, true);
  await waitFor(() => c.state === 'ready');
  assert.equal(c.capture().ok, true);
  assert.equal(c.state, 'capturing');

  const done = await c.acceptFile(fakeBlob(64), {});
  assert.equal(done.ok, true);
  assert.equal(done.preview.sourceMethod, SOURCE_METHODS.FILE_PICKER);
  assert.equal(c.state, 'preview');

  resolvePhoto(fakeBlob(256)); // 迟到照片（与候选测试一致：takePhoto 直接 resolve Blob）
  await tick();
  await tick();
  assert.equal(previews.length, 1, '迟到照片不得产生第二个预览');
  assert.equal(previews[0].sourceMethod, SOURCE_METHODS.FILE_PICKER);
  c.dispose();
});

// ---------- 4) 外部轨道结束 / dispose ----------

test('外部轨道结束（设备回收）：TRACK_ENDED + onStream(null)；无预览回 idle、有预览回 preview', async () => {
  // 情形 A：无预览 → idle
  let gumTrackA;
  const { deps: depsA, fakeTrack: fakeTrackA, fakeStream: fakeStreamA } = makeEnv({
    mediaDevices: { getUserMedia: () => Promise.resolve(fakeStreamA(gumTrackA)) },
  });
  const errorsA = [];
  const deliveredA = [];
  const cA = new CameraController({ ...depsA, onError: (e) => errorsA.push(e.code), onStream: (s) => deliveredA.push(s) });
  gumTrackA = fakeTrackA('camA');
  assert.equal(cA.openFromUserGesture().ok, true);
  await waitFor(() => cA.state === 'ready');
  gumTrackA._emit('ended'); // 外部结束（非我方 stop）
  await tick();
  assert.ok(errorsA.includes('TRACK_ENDED'));
  assert.equal(deliveredA.at(-1), null);
  assert.equal(cA.state, 'idle', '无预览时回 idle');
  assert.equal(cA.getResourceUsage().liveTracks, 0);
  cA.dispose();

  // 情形 B：有预览（先选图再开流）→ 回 preview
  let gumTrackB;
  const { deps, fakeTrack, fakeStream } = makeEnv({
    mediaDevices: { getUserMedia: () => Promise.resolve(fakeStream(gumTrackB)) },
  });
  const errorsB = [];
  const deliveredB = [];
  const cB = new CameraController({ ...deps, onError: (e) => errorsB.push(e.code), onStream: (s) => deliveredB.push(s) });
  await cB.acceptFile(fakeBlob(64), {});
  assert.equal(cB.state, 'preview');
  gumTrackB = fakeTrack('camB');
  assert.equal(cB.openFromUserGesture().ok, true);
  await waitFor(() => cB.state === 'ready');

  gumTrackB._emit('ended');
  await tick();
  assert.ok(errorsB.includes('TRACK_ENDED'));
  assert.equal(deliveredB.at(-1), null, '必须通知页面清空取景');
  assert.equal(cB.state, 'preview', '有预览时回 preview');
  assert.equal(cB.getResourceUsage().liveTracks, 0);
  cB.dispose();
});

test('dispose：停轨+撤销全部 URL+状态 disposed，幂等；dispose 后一切操作 no-op（DISPOSED）', async () => {
  const base = makeEnv();
  // 控制器一：选图产生 2 个 URL，dispose 时全部撤销。
  const c1 = new CameraController({ ...base.deps });
  await c1.acceptFile(fakeBlob(64), { captureHint: { capture: 'environment' } });
  assert.equal(c1.getResourceUsage().urlsHeld, 2, '原件+缩略图两个 URL');
  c1.dispose();
  assert.equal(base.revoked.length, 2, '全部 URL 已撤销');
  assert.equal(c1.getResourceUsage().urlsHeld, 0);

  // 控制器二：开流后 dispose → 停轨 + 一切操作 no-op。
  let gumTrack;
  const { deps, stopped, fakeTrack, fakeStream } = makeEnv({
    mediaDevices: { getUserMedia: () => Promise.resolve(fakeStream(gumTrack)) },
  });
  const c2 = new CameraController({ ...deps });
  gumTrack = fakeTrack('cam');
  assert.equal(c2.openFromUserGesture().ok, true);
  await waitFor(() => c2.state === 'ready');
  await c2.acceptFile(fakeBlob(64), {}); // 预览 + 存活流并存

  const r = c2.dispose();
  assert.equal(r.ok, true);
  assert.equal(r.code, 'DISPOSED');
  assert.equal(c2.state, 'disposed');
  assert.ok(stopped.includes('cam'), '轨道已停');
  assert.equal(c2.getResourceUsage().liveTracks, 0);
  assert.equal(c2.getResourceUsage().urlsHeld, 0);

  assert.equal(c2.dispose().code, 'DISPOSED', 'dispose 幂等');
  assert.equal(c2.openFromUserGesture().code, 'DISPOSED');
  assert.equal(c2.capture().code, 'DISPOSED');
  assert.equal(c2.cancelRequest().code, 'DISPOSED');
  assert.equal(c2.closeStream().code, 'DISPOSED');
  assert.equal((await c2.acceptFile(fakeBlob(64), {})).code, 'DISPOSED');
  assert.equal(c2.getSnapshot().state, 'disposed');
});

// ---------- 5) acceptFile 校验与 capture 提示语义 ----------

test('acceptFile：非图片/空文件拒绝；capture 提示仅记录（provenance 恒 unverified，不写"已现场拍摄"）', async () => {
  const { deps } = makeEnv();
  const c = new CameraController({ ...deps });

  assert.equal((await c.acceptFile({ size: 5, type: 'text/plain', arrayBuffer: async () => new ArrayBuffer(5) }, {})).code, 'NOT_AN_IMAGE');
  assert.equal((await c.acceptFile(fakeBlob(0), {})).code, 'EMPTY_FILE');
  assert.equal(c.state, 'idle', '校验失败不改状态');

  const ok = await c.acceptFile(fakeBlob(64), { captureHint: { capture: 'environment' } });
  assert.equal(ok.ok, true);
  assert.equal(ok.preview.captureHint.capture, 'environment', 'capture 提示仅登记');
  assert.equal(ok.preview.sourceMethod, SOURCE_METHODS.FILE_PICKER);
  assert.equal(ok.preview.origin, FILE_ORIGINS.USER_FILE_SELECTION);
  assert.equal(ok.preview.provenance, 'unverified');
  assert.equal(ok.preview.capturedAt, null);
  assert.equal(ok.preview.byteLength, 64);
  assert.deepEqual([...ok.preview.warnings], [], '注入解码可用时无警告');
  c.dispose();
});

// ---------- 6) camera-panel.tsx 接线契约（源码断言） ----------

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('面板接线契约：唯一执行路径经 CameraController；页面不自管轨道/URL；lifecycle 四标注齐备', () => {
  const src = readFileSync(`${siteRoot}app/v5-preview/remote-session/camera-panel.tsx`, 'utf8');
  const visible = stripComments(src);

  // 唯一执行路径：从冻结件导入控制器；淘汰手写 getUserMedia/takePhoto。
  assert.match(src, /lib\/v5-preview\/camera\/camera-controller\.mjs/, '必须从 lib/v5-preview/camera 冻结件导入');
  assert.doesNotMatch(visible, /mediaDevices\s*\.\s*getUserMedia/, '面板不得手写 getUserMedia');
  assert.doesNotMatch(visible, /new\s+ImageCapture/, '面板不得手写 ImageCapture');
  assert.doesNotMatch(visible, /createObjectURL\s*\(/, '页面不得自建 object URL（控制器拥有）');
  assert.doesNotMatch(visible, /revokeObjectURL\s*\(/, '页面不得撤销控制器的 URL');
  assert.doesNotMatch(visible, /trackRef|streamRef/, '面板不得自持轨道/流引用');
  assert.match(visible, /onStream: \(stream[^\n]*\) => attachStream\(stream\)/, 'onStream 回调必须接线');
  assert.match(visible, /srcObject = stream/, '取景流必须挂到 video.srcObject（无流即清空）');
  assert.match(src, /pagehide/, 'pagehide→dispose 是页面义务');
  assert.match(visible, /dispose\(\)/);

  // 版本防误接：面板展示冻结件版本号。
  assert.match(visible, /CAMERA_CONTROLLER_VERSION/);

  // P2 lifecycle 语义标注（四态齐备）。
  for (const label of ['capture_confirmed', 'user_cancelled', 'discarded', 'session_hangup']) {
    assert.match(visible, new RegExp(label), `缺少 lifecycle 标注：${label}`);
  }
  // 收起≠释放：生命周期不变。
  assert.match(visible, /收起面板不改变生命周期/);

  // 拍完默认关轨（single 默认）；连续模式必须显式开启且为构造依赖（切换=重建）。
  assert.match(visible, /buildController\('single'\)/, '默认必须 single（拍完自动关轨）');
  assert.match(visible, /captureMode/, 'captureMode 经构造依赖传入');
  assert.match(visible, /'continuous'/, '连续模式显式取值');
  assert.match(visible, /连续拍摄（显式开启；默认拍完关轨）/, '连续开关必须标注显式开启');
  assert.match(visible, /摄像头开启中（视频轨道存活）/, '开启期间必须有持续"摄像头开启中"提示');
});

test('面板边界文案契约：本地预览不上传/能力检测不申请权限/来源未知标注/清除释放全部保留', () => {
  const src = readFileSync(`${siteRoot}app/v5-preview/remote-session/camera-panel.tsx`, 'utf8');
  const visible = stripComments(src);
  assert.match(visible, /不上传、不入库、不提交模型/, '"本地预览不上传"边界标注保留');
  assert.match(visible, /检测本机拍照能力（不申请权限）/, '能力检测入口保留');
  assert.match(visible, /不证明设备或现场真实性/, '"原件"边界说明保留');
  assert.match(visible, /从图库选择（来源未知）/);
  assert.match(visible, /来源：\{sourceLabel\(preview\)\}/, '来源标注按预览对象渲染');
  assert.match(visible, /未验证（不证明现场拍摄）/, 'provenance=unverified 如实展示');
  assert.match(visible, /拍摄时间：/, 'capturedAt 未知如实展示');
  assert.match(visible, /清除本地预览（释放内存）/, '清除释放入口保留');
  assert.match(visible, /关闭相机/);
  assert.match(visible, /拍照（takePhoto）/);
  assert.match(visible, /挂断并释放全部（停轨\+撤 URL）/);
  assert.match(visible, /选择\/拍摄图片/);
  assert.match(visible, /capture="environment"/, '系统拍照 capture 提示入口保留');
  assert.match(visible, /export default function CameraPanel\(\)/, '面板 props 接口不变（无 props）');
  assert.doesNotMatch(visible, /fetch\(/, '面板不发任何网络请求');
  assert.doesNotMatch(visible, /已现场拍摄/, '不得声明"已现场拍摄"');
});
