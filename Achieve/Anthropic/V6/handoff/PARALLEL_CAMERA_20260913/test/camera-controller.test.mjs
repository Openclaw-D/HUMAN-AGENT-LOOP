// 并行任务B：相机控制器自动化测试。
// 全部使用假设备轨道与合成Blob，不开启任何物理摄像头/麦克风。
// 运行：node --test test/camera-controller.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  CameraController,
  detectCapabilities,
  CAMERA_STATES,
  SOURCE_METHODS,
  CAMERA_CONTROLLER_VERSION,
} from '../src/camera-controller.mjs';

const PHOTO_BYTES = Uint8Array.from({ length: 64 }, (_, i) => i);
const THUMB_BYTES = Uint8Array.from([200, 201, 202, 203, 204, 205, 206, 207]);

let streamSeq = 0;

function makeTrack() {
  return {
    kind: 'video',
    readyState: 'live',
    stopped: false,
    grabCalls: 0,
    grabFrame() {
      this.grabCalls += 1;
      return Promise.resolve(new Blob([new Uint8Array([9])], { type: 'image/jpeg' }));
    },
    stop() {
      this.stopped = true;
      this.readyState = 'ended';
    },
  };
}

function makeStream() {
  const track = makeTrack();
  const stream = {
    id: `fake-stream-${++streamSeq}`,
    getVideoTracks: () => [track],
    getTracks: () => [track],
  };
  return { stream, track };
}

function makeMediaDevices(options = {}) {
  const devices = {
    calls: [],
    tracks: [],
    getUserMedia(constraints) {
      devices.calls.push(constraints);
      if (options.rejectWith) return Promise.reject(options.rejectWith);
      if (options.neverSettle) return new Promise(() => {});
      const { stream, track } = makeStream();
      devices.tracks.push(track);
      return Promise.resolve(stream);
    },
  };
  return devices;
}

function makeUrlRegistry() {
  const map = new Map();
  let n = 0;
  return {
    map,
    createObjectURL(blob) {
      const url = `blob:fake-${++n}`;
      map.set(url, blob);
      return url;
    },
    revokeObjectURL(url) {
      map.delete(url);
    },
  };
}

function makeClock() {
  let t = 1000;
  return () => (t += 5);
}

class FakeImageCapture {
  static instances = [];
  static takePhotoCalls = [];
  // 一次性故障注入：下一次takePhoto生效（实例在capture()时才构造，故用静态标记）。
  static nextFailWith = null;
  static nextEmpty = false;
  constructor(track) {
    this.track = track;
    FakeImageCapture.instances.push(this);
  }
  takePhoto() {
    FakeImageCapture.takePhotoCalls.push(this.track);
    if (FakeImageCapture.nextFailWith) return Promise.reject(FakeImageCapture.nextFailWith);
    if (FakeImageCapture.nextEmpty) return Promise.resolve(new Blob([], { type: 'image/jpeg' }));
    return Promise.resolve(new Blob([PHOTO_BYTES], { type: 'image/jpeg' }));
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(overrides = {}) {
  const urls = makeUrlRegistry();
  const events = { states: [], previews: [], errors: [], streams: [] };
  const deps = {
    mediaDevices: makeMediaDevices(),
    ImageCapture: FakeImageCapture,
    createObjectURL: urls.createObjectURL,
    revokeObjectURL: urls.revokeObjectURL,
    now: makeClock(),
    decodeImageMetadata: async () => ({ width: 4000, height: 3000 }),
    createThumbnail: async () => ({ blob: new Blob([THUMB_BYTES], { type: 'image/jpeg' }), width: 320, height: 240 }),
    isSecureContext: true,
    onStateChange: (s) => events.states.push(s.state),
    onPreview: (p) => events.previews.push(p),
    onError: (e) => events.errors.push(e),
    onStream: (s) => events.streams.push(s),
  };
  const controller = new CameraController({ ...deps, ...overrides });
  return { controller, urls, events, deps };
}

async function openAndAwait(controller) {
  const r = controller.openFromUserGesture();
  assert.equal(r.ok, true);
  await flush();
  return r;
}

beforeEach(() => {
  FakeImageCapture.instances.length = 0;
  FakeImageCapture.takePhotoCalls.length = 0;
  FakeImageCapture.nextFailWith = null;
  FakeImageCapture.nextEmpty = false;
});

test('生命周期常量包含九个必需状态', () => {
  for (const s of ['idle', 'requesting', 'ready', 'capturing', 'preview', 'denied', 'unsupported', 'error', 'disposed']) {
    assert.ok(CAMERA_STATES.includes(s), `缺少状态 ${s}`);
  }
  assert.equal(typeof CAMERA_CONTROLLER_VERSION, 'string');
});

test('默认idle：构造+能力检测对设备零调用，且检测不改状态', async () => {
  const md = makeMediaDevices();
  const { controller, urls, events } = setup({ mediaDevices: md });
  const caps = controller.detectCapabilities();
  assert.equal(controller.state, 'idle');
  assert.equal(md.calls.length, 0, '能力检测不得调用getUserMedia');
  assert.equal(urls.map.size, 0);
  assert.deepEqual(events.states, [], '检测不改变状态');
  assert.equal(caps.liveCameraSupported, true);
  assert.equal(caps.takePhotoSupported, true);
  assert.equal(caps.secureContext, true);
});

test('明确开启：一次getUserMedia、audio恒false、默认后摄期望、状态idle→requesting→ready', async () => {
  const md = makeMediaDevices();
  const { controller, events } = setup({ mediaDevices: md });
  const r = controller.openFromUserGesture();
  assert.equal(r.ok, true);
  assert.equal(controller.state, 'requesting');
  await flush();
  assert.equal(controller.state, 'ready');
  assert.equal(md.calls.length, 1);
  assert.equal(md.calls[0].audio, false, '永不申请麦克风');
  assert.equal(md.calls[0].video.facingMode, 'environment');
  assert.deepEqual(events.states, ['requesting', 'ready']);
  assert.equal(events.streams.length, 1);
  assert.equal(events.streams[0].id, 'fake-stream-1');
});

test('unsupported：缺少getUserMedia时明确回退选图且零调用', () => {
  const { controller, events } = setup({ mediaDevices: null, ImageCapture: null });
  assert.equal(controller.capabilities.getUserMedia, 'missing');
  const r = controller.openFromUserGesture();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'UNSUPPORTED');
  assert.equal(r.fallback, 'file_picker');
  assert.equal(controller.state, 'unsupported');
  assert.equal(events.errors.at(-1).code, 'UNSUPPORTED');
  assert.equal(events.errors.at(-1).fallbackHint, 'file_picker');
});

test('unsupported：非安全上下文不发起任何设备调用', () => {
  const md = makeMediaDevices();
  const { controller } = setup({ mediaDevices: md, isSecureContext: false });
  assert.equal(controller.capabilities.liveCameraSupported, false);
  const r = controller.openFromUserGesture();
  assert.equal(r.code, 'UNSUPPORTED');
  assert.equal(md.calls.length, 0);
  assert.equal(controller.state, 'unsupported');
});

test('拒绝权限：状态denied、只调用一次、绝不自动重试弹框', async () => {
  const denied = Object.assign(new Error('user denied'), { name: 'NotAllowedError' });
  const md = makeMediaDevices({ rejectWith: denied });
  const { controller, events } = setup({ mediaDevices: md });
  controller.openFromUserGesture();
  await flush();
  assert.equal(controller.state, 'denied');
  assert.equal(md.calls.length, 1);
  assert.equal(events.errors.at(-1).code, 'NOT_ALLOWED');
  await flush();
  await flush();
  assert.equal(md.calls.length, 1, '拒绝后不循环请求');
});

test('无设备/设备占用：映射为error且带明确错误码', async () => {
  for (const [name, code] of [
    ['NotFoundError', 'NO_DEVICE'],
    ['NotReadableError', 'DEVICE_BUSY'],
    ['AbortError', 'DEVICE_ABORTED'],
  ]) {
    const err = Object.assign(new Error(name), { name });
    const md = makeMediaDevices({ rejectWith: err });
    const { controller, events } = setup({ mediaDevices: md });
    controller.openFromUserGesture();
    await flush();
    assert.equal(controller.state, 'error', name);
    assert.equal(events.errors.at(-1).code, code, name);
  }
});

test('取消：立即退出requesting，迟到的授权流到货即停轨', async () => {
  const md = makeMediaDevices();
  const { controller, events } = setup({ mediaDevices: md });
  controller.openFromUserGesture();
  const r = controller.cancelRequest();
  assert.equal(r.ok, true);
  assert.equal(controller.state, 'idle');
  await flush();
  assert.equal(md.calls.length, 1);
  assert.equal(md.tracks[0].stopped, true, '迟到的流被立即停轨');
  assert.equal(controller.state, 'idle');
  assert.ok(!events.states.includes('ready'));
  assert.equal(events.streams.length, 0);
});

test('重复点击开启：同tick双击只发起一次请求，不开两组流', async () => {
  const md = makeMediaDevices();
  const { controller } = setup({ mediaDevices: md });
  const r1 = controller.openFromUserGesture();
  const r2 = controller.openFromUserGesture();
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, false);
  assert.equal(r2.code, 'ALREADY_PENDING');
  await flush();
  assert.equal(md.calls.length, 1);
  assert.equal(md.tracks.length, 1);
  assert.equal(controller.state, 'ready');
  const r3 = controller.openFromUserGesture();
  assert.equal(r3.ok, false);
  assert.equal(r3.code, 'ALREADY_OPEN', '已开启后再点不重复开流');
  assert.equal(md.calls.length, 1);
});

test('重复点击拍照：capturing期间第二次capture被拒', async () => {
  const { controller } = setup();
  await openAndAwait(controller);
  const c1 = controller.capture();
  const c2 = controller.capture();
  assert.equal(c1.ok, true);
  assert.equal(c2.ok, false);
  assert.equal(c2.code, 'CAPTURE_IN_PROGRESS');
  await flush();
  assert.equal(FakeImageCapture.instances.length, 1);
  assert.equal(controller.state, 'preview');
  assert.equal(controller.getPreview().byteLength, PHOTO_BYTES.length);
});

test('拍摄失败：状态error、流保留可重试，重试成功出预览', async () => {
  const md = makeMediaDevices();
  const { controller, events } = setup({ mediaDevices: md });
  await openAndAwait(controller);
  FakeImageCapture.nextFailWith = new Error('sensor busy');
  controller.capture();
  await flush();
  assert.equal(controller.state, 'error');
  assert.equal(events.errors.at(-1).code, 'CAPTURE_FAILED');
  assert.equal(md.tracks[0].stopped, false, '拍摄失败不停流');
  FakeImageCapture.nextFailWith = null;
  const c2 = controller.capture();
  assert.equal(c2.ok, true, 'error状态且流存活时允许重试');
  await flush();
  assert.equal(controller.state, 'preview');
  assert.equal(events.previews.length, 1);
  assert.equal(events.previews[0].sourceMethod, SOURCE_METHODS.LIVE_TAKEPHOTO);
});

test('takePhoto返回空Blob：按拍摄失败处理', async () => {
  const { controller, events } = setup();
  await openAndAwait(controller);
  FakeImageCapture.nextEmpty = true;
  controller.capture();
  await flush();
  assert.equal(controller.state, 'error');
  assert.equal(events.errors.at(-1).code, 'CAPTURE_FAILED');
  assert.equal(events.previews.length, 0);
});

test('ImageCapture缺失：明确回退file_picker，绝不截帧冒充照片', async () => {
  const md = makeMediaDevices();
  const { controller, events } = setup({ mediaDevices: md, ImageCapture: null });
  await openAndAwait(controller);
  const track = md.tracks[0];
  const r = controller.capture();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'IMAGECAPTURE_UNSUPPORTED');
  assert.equal(r.fallback, 'file_picker');
  assert.equal(controller.state, 'ready', '流未破坏');
  assert.equal(events.errors.at(-1).code, 'IMAGECAPTURE_UNSUPPORTED');
  assert.equal(events.errors.at(-1).fallbackHint, 'file_picker');
  await flush();
  assert.equal(track.grabCalls, 0, '不得grabFrame冒充takePhoto');
  assert.equal(md.calls.length, 1);
});

test('dispose后迟到的授权流：立即停轨、无ready、无流通知、URL为零', async () => {
  const md = makeMediaDevices();
  const { controller, urls, events } = setup({ mediaDevices: md });
  controller.openFromUserGesture();
  const d = controller.dispose();
  assert.equal(d.code, 'DISPOSED');
  assert.equal(controller.state, 'disposed');
  await flush();
  assert.equal(md.tracks[0].stopped, true);
  assert.ok(!events.states.includes('ready'), '迟到结果不得产生ready');
  assert.equal(events.streams.length, 0);
  assert.equal(urls.map.size, 0);
  assert.equal(controller.openFromUserGesture().code, 'DISPOSED');
  assert.equal(controller.capture().code, 'DISPOSED');
  assert.equal(md.calls.length, 1, 'dispose后不再有新调用');
});

test('dispose后迟到的权限拒绝：静默清理，不报错不循环', async () => {
  const denied = Object.assign(new Error('late deny'), { name: 'NotAllowedError' });
  const md = makeMediaDevices({ rejectWith: denied });
  const { controller, events } = setup({ mediaDevices: md });
  controller.openFromUserGesture();
  controller.dispose();
  await flush();
  await flush();
  assert.equal(controller.state, 'disposed');
  assert.ok(!events.errors.some((e) => e.code === 'NOT_ALLOWED'), '迟到的拒绝不外抛');
});

test('dispose后迟到的照片：不产生预览、不创建URL', async () => {
  const { controller, urls, events } = setup();
  await openAndAwait(controller);
  controller.capture();
  controller.dispose();
  await flush();
  assert.equal(events.previews.length, 0);
  assert.equal(urls.map.size, 0);
  assert.equal(controller.state, 'disposed');
});

test('换设备：先停旧轨再请求新facingMode，新流可用', async () => {
  const md = makeMediaDevices();
  const { controller, events } = setup({ mediaDevices: md });
  await openAndAwait(controller);
  const t1 = md.tracks[0];
  const s1 = events.streams[0];
  const r = controller.switchCamera({ facingMode: 'user' });
  assert.equal(r.ok, true);
  assert.equal(t1.stopped, true, '旧轨在发起新请求前停止');
  assert.equal(controller.state, 'requesting');
  assert.equal(events.streams.at(-1), null, '页面收到清空通知');
  await flush();
  assert.equal(md.calls.length, 2);
  assert.equal(md.calls[1].video.facingMode, 'user');
  assert.equal(md.calls[1].audio, false);
  assert.equal(controller.state, 'ready');
  assert.equal(md.tracks[0].stopped, true);
  assert.equal(md.tracks[1].stopped, false);
  assert.notEqual(events.streams.at(-1), s1);
});

test('closeStream：无预览回idle；有预览停在preview；页面收到清空通知', async () => {
  const md = makeMediaDevices();
  const { controller, events } = setup({ mediaDevices: md });
  await openAndAwait(controller);
  const t1 = md.tracks[0];
  const r = controller.closeStream();
  assert.equal(r.ok, true);
  assert.equal(t1.stopped, true);
  assert.equal(controller.state, 'idle');
  assert.equal(events.streams.at(-1), null);
  // 有预览的情况
  await openAndAwait(controller);
  controller.capture();
  await flush();
  assert.equal(controller.state, 'preview');
  const r2 = controller.closeStream();
  assert.equal(r2.ok, true);
  assert.equal(controller.state, 'preview', '保留本地预览');
  assert.equal(controller.getSnapshot().hasLiveStream, false);
  assert.equal(md.tracks[1].stopped, true);
});

test('acceptFile：原字节不变、元数据齐全、缩略图独立、URL登记', async () => {
  const bytes = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
  const file = new Blob([bytes], { type: 'image/jpeg' });
  const { controller, urls, events } = setup();
  const r = await controller.acceptFile(file, { captureHint: { capture: 'environment' } });
  assert.equal(r.ok, true);
  const p = r.preview;
  assert.equal(events.previews.length, 1);
  assert.equal(p.byteLength, 32);
  assert.equal(p.mime, 'image/jpeg');
  assert.equal(p.width, 4000);
  assert.equal(p.height, 3000);
  assert.equal(p.capturedAt, null, '读不到的拍摄时间保持未知');
  assert.equal(typeof p.receivedAt, 'number');
  assert.equal(p.sourceMethod, SOURCE_METHODS.FILE_PICKER);
  assert.equal(p.captureHint?.capture, 'environment', 'capture提示仅作记录');
  assert.equal(p.provenance, 'unverified', '出处恒为未验证');
  assert.equal(p.origin, 'user_file_selection');
  assert.notEqual(p.sourceMethod, SOURCE_METHODS.LIVE_TAKEPHOTO, '系统选图不得冒充现场拍摄');
  const roundTrip = new Uint8Array(await p.blob.arrayBuffer());
  assert.deepEqual(roundTrip, bytes, '原始字节保持不变');
  assert.ok(p.thumbnail);
  assert.deepEqual(new Uint8Array(await p.thumbnail.blob.arrayBuffer()), THUMB_BYTES, '缩略图是另建的独立Blob');
  assert.notEqual(p.thumbnail.url, p.url);
  assert.equal(urls.map.size, 2, '原件与缩略图各一个URL');
  assert.equal(controller.state, 'preview');
});

test('换图释放：旧预览的URL立即撤销，新预览可用', async () => {
  const { controller, urls } = setup();
  await controller.acceptFile(new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' }));
  const first = controller.getPreview();
  await controller.acceptFile(new Blob([Uint8Array.from([4, 5, 6, 7])], { type: 'image/jpeg' }));
  const second = controller.getPreview();
  assert.notEqual(second.id, first.id);
  assert.equal(urls.map.size, 2, '只剩第二组的两个URL');
  assert.ok(!urls.map.has(first.url));
  assert.ok(!urls.map.has(first.thumbnail.url));
  assert.ok(urls.map.has(second.url));
  assert.ok(urls.map.has(second.thumbnail.url));
  assert.equal(controller.state, 'preview');
});

test('非图片/空文件/非Blob：明确拒绝且无副作用', async () => {
  const { controller, urls, events } = setup();
  const r1 = await controller.acceptFile(new Blob([new Uint8Array([1])], { type: 'video/mp4' }));
  assert.equal(r1.code, 'NOT_AN_IMAGE');
  const r2 = await controller.acceptFile(new Blob([], { type: 'image/jpeg' }));
  assert.equal(r2.code, 'EMPTY_FILE');
  const r3 = await controller.acceptFile('not-a-blob');
  assert.equal(r3.code, 'NOT_AN_IMAGE');
  assert.equal(controller.state, 'idle', '拒绝不改状态');
  assert.equal(urls.map.size, 0);
  assert.equal(events.previews.length, 0);
  assert.equal(controller.getPreview(), null);
});

test('解码/缩略图不可用：优雅降级，预览仍交付并带警告', async () => {
  const { controller } = setup({
    decodeImageMetadata: async () => null,
    createThumbnail: async () => {
      throw new Error('no canvas');
    },
  });
  const r = await controller.acceptFile(new Blob([new Uint8Array([1, 2])], { type: 'image/jpeg' }));
  assert.equal(r.ok, true);
  const p = r.preview;
  assert.equal(p.width, null);
  assert.equal(p.height, null);
  assert.equal(p.thumbnail, null);
  assert.ok(p.warnings.includes('metadata_unavailable'));
  assert.ok(p.warnings.includes('thumbnail_unavailable'));
  assert.ok(p.url, '原件URL仍可用');
  assert.equal(controller.state, 'preview');
});

test('无objectURL环境：url为null并记录警告，不崩溃', async () => {
  const { controller } = setup({ createObjectURL: null, revokeObjectURL: null });
  const r = await controller.acceptFile(new Blob([new Uint8Array([1, 2])], { type: 'image/jpeg' }));
  assert.equal(r.ok, true);
  assert.equal(r.preview.url, null);
  assert.ok(r.preview.warnings.includes('object_url_unavailable'));
});

test('preview状态且流存活时可连续再拍，旧预览URL随换释放', async () => {
  const { controller, urls } = setup();
  await openAndAwait(controller);
  controller.capture();
  await flush();
  const first = controller.getPreview();
  const c2 = controller.capture();
  assert.equal(c2.ok, true);
  await flush();
  assert.equal(controller.state, 'preview');
  const second = controller.getPreview();
  assert.notEqual(second.id, first.id);
  assert.equal(urls.map.size, 2);
  assert.ok(!urls.map.has(first.url));
});

test('requesting期间选择文件：未决摄像头请求作废，迟到流到货即停', async () => {
  const md = makeMediaDevices();
  const { controller } = setup({ mediaDevices: md });
  controller.openFromUserGesture();
  assert.equal(controller.state, 'requesting');
  const r = await controller.acceptFile(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }));
  assert.equal(r.ok, true);
  assert.equal(controller.state, 'preview');
  await flush();
  assert.equal(md.calls.length, 1);
  assert.equal(md.tracks[0].stopped, true, '被作废的请求到货即清理');
  assert.equal(controller.state, 'preview');
  assert.equal(controller.getPreview().byteLength, 3);
});

test('全量释放：dispose撤销全部URL、停全部轨道、幂等且后续no-op', async () => {
  const md = makeMediaDevices();
  const { controller, urls } = setup({ mediaDevices: md });
  await openAndAwait(controller);
  controller.capture();
  await flush();
  await controller.acceptFile(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }));
  assert.ok(urls.map.size > 0);
  controller.dispose();
  assert.equal(urls.map.size, 0, '全部URL已撤销');
  for (const t of md.tracks) assert.equal(t.stopped, true, '全部轨道已停止');
  assert.equal(controller.state, 'disposed');
  const again = controller.dispose();
  assert.equal(again.code, 'DISPOSED');
  assert.equal(again.ok, true);
  assert.equal(urls.map.size, 0);
  assert.equal(controller.capture().code, 'DISPOSED');
});

test('capture无流时明确NO_STREAM，不构造ImageCapture', async () => {
  const { controller } = setup();
  const r = controller.capture();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NO_STREAM');
  assert.equal(FakeImageCapture.instances.length, 0);
});

test('detectCapabilities：纯函数、注入组合结果诚实', () => {
  const md = makeMediaDevices();
  const full = detectCapabilities({ mediaDevices: md, ImageCapture: FakeImageCapture, isSecureContext: true });
  assert.deepEqual(full, {
    secureContext: true,
    getUserMedia: 'available',
    imageCapture: 'available',
    liveCameraSupported: true,
    takePhotoSupported: true,
  });
  assert.equal(md.calls.length, 0, '检测零调用');
  const noIC = detectCapabilities({ mediaDevices: md, ImageCapture: null, isSecureContext: true });
  assert.equal(noIC.takePhotoSupported, false);
  assert.equal(noIC.liveCameraSupported, true);
  const insecure = detectCapabilities({ mediaDevices: md, ImageCapture: FakeImageCapture, isSecureContext: false });
  assert.equal(insecure.liveCameraSupported, false);
  assert.equal(insecure.takePhotoSupported, false);
  assert.equal(insecure.secureContext, false);
  const noApi = detectCapabilities({ mediaDevices: null, ImageCapture: FakeImageCapture, isSecureContext: true });
  assert.equal(noApi.getUserMedia, 'missing');
  assert.equal(noApi.liveCameraSupported, false);
});
