// R2-B｜SA2 资源核算测试套件（resource tracking）
// 任务口径（V6/ZCODE_R2_B_20260913.md）：
//   拒绝/取消/换文件/离开/超时/迟到全部清理——track与objectURL泄漏0、麦克风请求0、上传0。
// 方法：全部合成File/Blob与虚拟依赖（假MediaStreamTrack、URL注册表、getUserMedia调用记录、
//   fetch/XHR上传探针），不触真实设备、无浏览器、无新依赖。
// 被测：../src/camera-controller.mjs（v0.2.0-r2-candidate，SA1并行交付）。
// 约束：若控制器实现与本套件断言口径冲突，不改控制器，冲突记录进 evidence/handoff-to-main.md。
// 运行：cd V6/handoff/R2_CAMERA_20260913 && node --test test/resource-tracking.test.mjs
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { CameraController, CAMERA_CONTROLLER_VERSION } from '../src/camera-controller.mjs';

const PHOTO_BYTES = Uint8Array.from({ length: 64 }, (_, i) => i);
const THUMB_BYTES = Uint8Array.from([200, 201, 202, 203, 204, 205, 206, 207]);

// ---------- 全局核算账本（跨全部场景累计） ----------
const ALL_GUM_CALLS = []; // { tag, constraints } 每一次getUserMedia的完整constraints
const ALL_TRACKS = []; // 每一条创建过的假track

// ---------- 假设施 ----------
let streamSeq = 0;
let trackSeq = 0;

function makeTrack() {
  const track = {
    id: `fake-track-${++trackSeq}`,
    kind: 'video',
    label: 'fake-camera',
    enabled: true,
    readyState: 'live',
    stopped: false, // 仅stop()置位；外部ended不置位（泄漏判定用 stopped || readyState==='ended'）
    onended: null, // 兼容 onended 赋值式订阅
    _endedListeners: [], // 兼容 addEventListener('ended') 订阅
    addEventListener(type, fn) {
      if (type === 'ended' && typeof fn === 'function') track._endedListeners.push(fn);
    },
    removeEventListener(type, fn) {
      const i = track._endedListeners.indexOf(fn);
      if (i >= 0) track._endedListeners.splice(i, 1);
    },
    stop() {
      track.stopped = true;
      track.readyState = 'ended';
    },
  };
  ALL_TRACKS.push(track);
  return track;
}

// 模拟设备/浏览器向页面派发ended事件（外部结束，非controller.stop）
function fireEnded(track) {
  if (track.readyState === 'ended') return;
  track.readyState = 'ended';
  const ev = { type: 'ended', target: track };
  if (typeof track.onended === 'function') track.onended(ev);
  for (const fn of [...track._endedListeners]) fn(ev);
}

function makeDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeStream() {
  const track = makeTrack();
  const stream = {
    id: `fake-stream-${++streamSeq}`,
    get active() {
      return track.readyState !== 'ended';
    },
    getVideoTracks: () => [track],
    getTracks: () => [track],
  };
  return { stream, track };
}

// options:
//   rejectWith  —— getUserMedia 返回 rejected promise（不创建轨）
//   neverSettle —— getUserMedia 永不resolve（不创建轨）
//   manual      —— 返回手动deferred；d.resolveStream() 时才创建并交付流（迟到场景用）
function makeMediaDevices(tag = '', options = {}) {
  const devices = {
    tag,
    calls: [],
    tracks: [],
    manual: [],
    getUserMedia(constraints) {
      devices.calls.push(constraints);
      ALL_GUM_CALLS.push({ tag, constraints });
      if (options.rejectWith) return Promise.reject(options.rejectWith);
      if (options.neverSettle) return new Promise(() => {});
      if (options.manual) {
        const d = makeDeferred();
        d._made = null;
        d.makeStream = () => {
          if (!d._made) {
            d._made = makeStream();
            devices.tracks.push(d._made.track);
          }
          return d._made;
        };
        d.resolveStream = () => {
          const s = d.makeStream();
          d.resolve(s.stream);
        };
        devices.manual.push(d);
        return d.promise;
      }
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
    created: 0,
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
  static nextFailWith = null;
  static nextEmpty = false;
  static manualMode = false; // takePhoto返回手动deferred（dispose竞态用）
  static manual = [];
  constructor(track) {
    this.track = track;
    FakeImageCapture.instances.push(this);
  }
  takePhoto() {
    FakeImageCapture.takePhotoCalls.push(this.track);
    if (FakeImageCapture.nextFailWith) return Promise.reject(FakeImageCapture.nextFailWith);
    if (FakeImageCapture.nextEmpty) return Promise.resolve(new Blob([], { type: 'image/jpeg' }));
    if (FakeImageCapture.manualMode) {
      const d = makeDeferred();
      FakeImageCapture.manual.push(d);
      return d.promise;
    }
    return Promise.resolve(new Blob([PHOTO_BYTES], { type: 'image/jpeg' }));
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const flushx = async () => {
  await flush();
  await flush();
  await flush();
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(cond, timeoutMs = 3000, stepMs = 5) {
  const start = Date.now();
  for (;;) {
    if (cond()) return true;
    if (Date.now() - start >= timeoutMs) return cond();
    await sleep(stepMs);
  }
}

function makeBlob(bytes, type = 'image/jpeg') {
  return new Blob([bytes], { type });
}

function setup(overrides = {}) {
  const urls = makeUrlRegistry();
  const md = overrides.mediaDevices !== undefined ? overrides.mediaDevices : makeMediaDevices();
  const events = { states: [], previews: [], errors: [], streams: [] };
  const deps = {
    mediaDevices: md,
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
  const { mediaDevices: _replaced, ...rest } = overrides;
  const controller = new CameraController({ ...deps, ...rest });
  return { controller, urls, events, md };
}

// ---------- 核算断言 ----------

// 麦克风0：每一次getUserMedia的constraints.audio必须恒为false（true/undefined都算泄漏）
function assertNoMic(md, note) {
  for (const c of md.calls) {
    assert.equal(c.audio, false, `${note}: 出现audio!==false的getUserMedia调用（麦克风请求泄漏）: ${JSON.stringify(c)}`);
  }
}

// getResourceUsage()（若可用）与注入状态双重核对
function assertUsage(controller, expected, note) {
  if (typeof controller.getResourceUsage !== 'function') return;
  const u = controller.getResourceUsage();
  if (expected.state !== undefined) assert.equal(u.state, expected.state, `${note}: getResourceUsage().state`);
  if (expected.captureMode !== undefined) assert.equal(u.captureMode, expected.captureMode, `${note}: getResourceUsage().captureMode`);
  if (expected.liveTracks !== undefined) assert.equal(u.liveTracks, expected.liveTracks, `${note}: getResourceUsage().liveTracks`);
  if (expected.urlsHeld !== undefined) assert.equal(u.urlsHeld, expected.urlsHeld, `${note}: getResourceUsage().urlsHeld`);
}

// 场景收尾（“离开”）：dispose后轨全停、URL全撤、占用归零、幂等
function closeOut(controller, { tracks = [], urls, note }) {
  const d = controller.dispose();
  assert.equal(d.ok, true, `${note}: dispose应成功`);
  for (const t of tracks) {
    assert.ok(t.stopped === true || t.readyState === 'ended', `${note}: track泄漏（既未stop也未ended）`);
  }
  assert.equal(urls.map.size, 0, `${note}: objectURL泄漏（注册表非空）`);
  assertUsage(controller, { state: 'disposed', liveTracks: 0, urlsHeld: 0 }, note);
  const again = controller.dispose();
  assert.equal(again.ok, true, `${note}: dispose幂等`);
  assert.equal(controller.state, 'disposed', `${note}: dispose后状态必须为disposed`);
}

// 场景包装：运行前临时包裹 globalThis.fetch / XMLHttpRequest.prototype.open 为抛错探针，结束后恢复；
// 断言场景期间零上传尝试。
function resourceScenario(name, fn, options = {}) {
  test(name, { timeout: options.timeout ?? 15000 }, async () => {
    const uploadCalls = [];
    const origFetch = globalThis.fetch;
    const origOpen = globalThis.XMLHttpRequest?.prototype?.open;
    globalThis.fetch = function uploadProbeFetch(...args) {
      uploadCalls.push(`fetch(${String(args[0])})`);
      throw new Error(`UPLOAD_PROBE 场景「${name}」：出现上传尝试 fetch(${String(args[0])})`);
    };
    if (origOpen) {
      globalThis.XMLHttpRequest.prototype.open = function uploadProbeOpen(...args) {
        uploadCalls.push(`xhr.open(${String(args[0])} ${String(args[1])})`);
        throw new Error(`UPLOAD_PROBE 场景「${name}」：出现上传尝试 xhr.open`);
      };
    }
    try {
      await fn();
    } finally {
      if (origFetch === undefined) delete globalThis.fetch;
      else globalThis.fetch = origFetch;
      if (origOpen) globalThis.XMLHttpRequest.prototype.open = origOpen;
    }
    assert.equal(uploadCalls.length, 0, `场景「${name}」检测到上传尝试：${uploadCalls.join(' | ')}`);
  });
}

beforeEach(() => {
  FakeImageCapture.instances.length = 0;
  FakeImageCapture.takePhotoCalls.length = 0;
  FakeImageCapture.nextFailWith = null;
  FakeImageCapture.nextEmpty = false;
  FakeImageCapture.manualMode = false;
  FakeImageCapture.manual.length = 0;
});

// ---------- 口径0：v0.2.0基线与零调用保持 ----------

resourceScenario('口径0 v0.2.0基线：版本号与getResourceUsage形状（single默认、零占用）', () => {
  assert.ok(String(CAMERA_CONTROLLER_VERSION).startsWith('0.2.0'), `版本应为0.2.0.x，实际 ${CAMERA_CONTROLLER_VERSION}`);
  const { controller, urls } = setup();
  assert.equal(controller.state, 'idle');
  assert.equal(typeof controller.getResourceUsage, 'function', 'v0.2.0必须提供getResourceUsage()');
  assert.deepEqual(controller.getResourceUsage(), { state: 'idle', captureMode: 'single', liveTracks: 0, urlsHeld: 0 });
  assert.equal(urls.map.size, 0);
  controller.dispose();
});

resourceScenario('口径0 构造与能力检测对设备零调用（保持项）', () => {
  const md = makeMediaDevices('zero-call');
  const { controller } = setup({ mediaDevices: md });
  assert.equal(controller.state, 'idle');
  assert.equal(md.calls.length, 0, '构造不得调用getUserMedia');
  const caps = controller.detectCapabilities();
  assert.equal(md.calls.length, 0, '能力检测不得调用getUserMedia');
  assert.equal(caps.liveCameraSupported, true);
  assertUsage(controller, { state: 'idle', captureMode: 'single', liveTracks: 0, urlsHeld: 0 }, '口径0');
});

// ---------- 场景1-5：开流路径的清理 ----------

resourceScenario('场景1 显式开启ready→dispose：重复点击不重复开流，轨停/URL零/占用归零', async () => {
  const md = makeMediaDevices('s1');
  const { controller, urls, events } = setup({ mediaDevices: md });
  const r = controller.openFromUserGesture();
  assert.equal(r.ok, true);
  assert.equal(controller.state, 'requesting');
  await flushx();
  assert.equal(controller.state, 'ready');
  assert.equal(md.calls.length, 1);
  assertNoMic(md, '场景1');
  const r2 = controller.openFromUserGesture();
  assert.equal(r2.ok, false, '已开启后再次点击不得重复开流');
  assert.equal(md.calls.length, 1, '双击合并：仍只有一次getUserMedia');
  assertUsage(controller, { state: 'ready', captureMode: 'single', liveTracks: 1, urlsHeld: 0 }, '场景1 ready');
  closeOut(controller, { tracks: md.tracks, urls, note: '场景1' });
  assert.equal(events.streams.at(-1), null, 'dispose必须onStream(null)');
});

resourceScenario('场景2 权限拒绝：单次请求、不循环、无轨无URL', async () => {
  const denied = Object.assign(new Error('user denied'), { name: 'NotAllowedError' });
  const md = makeMediaDevices('s2', { rejectWith: denied });
  const { controller, urls, events } = setup({ mediaDevices: md });
  controller.openFromUserGesture();
  await flushx();
  assert.equal(controller.state, 'denied');
  assert.equal(events.errors.at(-1).code, 'NOT_ALLOWED');
  assert.equal(md.calls.length, 1);
  assertNoMic(md, '场景2');
  await flushx();
  await flushx();
  assert.equal(md.calls.length, 1, '拒绝后不得自动重试弹框');
  assert.equal(md.tracks.length, 0, '拒绝路径不得创建任何轨');
  assert.equal(urls.map.size, 0);
  assertUsage(controller, { state: 'denied', liveTracks: 0, urlsHeld: 0 }, '场景2');
  closeOut(controller, { tracks: md.tracks, urls, note: '场景2' });
});

resourceScenario('场景3 用户取消：迟到授权流到货即停，无ready无onStream', async () => {
  const md = makeMediaDevices('s3', { manual: true });
  const { controller, urls, events } = setup({ mediaDevices: md });
  controller.openFromUserGesture();
  assert.equal(controller.state, 'requesting');
  const r = controller.cancelRequest();
  assert.equal(r.ok, true);
  assert.equal(controller.state, 'idle');
  assert.equal(md.manual.length, 1);
  md.manual[0].resolveStream(); // 迟到的授权
  await flushx();
  assert.equal(md.tracks[0].stopped, true, '迟到流必须立即停轨');
  assert.equal(controller.state, 'idle');
  assert.ok(!events.states.includes('ready'), '取消后不得出现ready');
  assert.equal(events.streams.filter((s) => s !== null).length, 0, '迟到流不得交付页面');
  assert.equal(md.calls.length, 1, '取消后不得再次请求');
  assert.equal(urls.map.size, 0);
  assertUsage(controller, { state: 'idle', liveTracks: 0, urlsHeld: 0 }, '场景3');
  closeOut(controller, { tracks: md.tracks, urls, note: '场景3' });
});

resourceScenario('场景4 请求超时：REQUEST_TIMEOUT自动回idle，迟到授权流到货即停', async () => {
  const md = makeMediaDevices('s4', { manual: true });
  const { controller, urls, events } = setup({ mediaDevices: md, requestTimeoutMs: 20 });
  controller.openFromUserGesture();
  assert.equal(controller.state, 'requesting');
  const exited = await waitFor(() => controller.state !== 'requesting', 3000);
  assert.ok(exited, '超时后必须自动退出requesting');
  assert.equal(controller.state, 'idle', 'getUserMedia超时自动取消应回idle');
  assert.equal(events.errors.at(-1)?.code, 'REQUEST_TIMEOUT', '必须发出REQUEST_TIMEOUT错误码');
  assert.ok(!events.states.includes('ready'));
  const d = md.manual[0];
  d.resolveStream(); // 超时之后才到货的授权
  await flushx();
  assert.equal(md.tracks[0].stopped, true, '超时后迟到的流必须停轨');
  assert.equal(controller.state, 'idle');
  assert.equal(events.streams.length, 0, '迟到流不得交付页面');
  assert.equal(md.calls.length, 1);
  assert.equal(urls.map.size, 0);
  assertUsage(controller, { state: 'idle', liveTracks: 0, urlsHeld: 0 }, '场景4');
  closeOut(controller, { tracks: md.tracks, urls, note: '场景4' });
});

resourceScenario('场景4b requestTimeoutMs:null禁用超时：永不resolve不被误杀，显式取消后零残留', async () => {
  const md = makeMediaDevices('s4b', { neverSettle: true });
  const { controller, urls, events } = setup({ mediaDevices: md, requestTimeoutMs: null });
  controller.openFromUserGesture();
  assert.equal(controller.state, 'requesting');
  await sleep(120);
  assert.equal(controller.state, 'requesting', 'null禁用超时：不得自动退出requesting');
  assert.equal(events.errors.some((e) => e.code === 'REQUEST_TIMEOUT'), false, 'null禁用下不得出现REQUEST_TIMEOUT');
  const r = controller.cancelRequest();
  assert.equal(r.ok, true);
  assert.equal(controller.state, 'idle');
  assert.equal(md.tracks.length, 0, '从未到货即无轨');
  assert.equal(urls.map.size, 0);
  closeOut(controller, { tracks: md.tracks, urls, note: '场景4b' });
});

resourceScenario('场景5 unsupported：零设备调用、零轨、零URL（无getUserMedia/非安全上下文两变体）', async () => {
  // 变体1：无getUserMedia
  {
    const { controller, urls, events } = setup({ mediaDevices: null, ImageCapture: null });
    const r = controller.openFromUserGesture();
    assert.equal(r.ok, false);
    assert.equal(r.code, 'UNSUPPORTED');
    assert.equal(r.fallback, 'file_picker');
    assert.equal(controller.state, 'unsupported');
    assert.equal(events.errors.at(-1).fallbackHint, 'file_picker');
    assert.equal(urls.map.size, 0);
    assertUsage(controller, { state: 'unsupported', liveTracks: 0, urlsHeld: 0 }, '场景5a');
    closeOut(controller, { tracks: [], urls, note: '场景5a' });
  }
  // 变体2：非安全上下文
  {
    const md = makeMediaDevices('s5b');
    const { controller, urls } = setup({ mediaDevices: md, isSecureContext: false });
    const r = controller.openFromUserGesture();
    assert.equal(r.ok, false);
    assert.equal(r.code, 'UNSUPPORTED');
    assert.equal(md.calls.length, 0, '非安全上下文不得发起任何设备调用');
    assert.equal(md.tracks.length, 0);
    assert.equal(urls.map.size, 0);
    closeOut(controller, { tracks: md.tracks, urls, note: '场景5b' });
  }
});

// ---------- 场景6-8：single/continuous拍照的资源口径 ----------

resourceScenario('场景6 single拍成功：立即停轨+onStream(null)，URL恰一组，preview后再拍NO_STREAM', async () => {
  const md = makeMediaDevices('s6');
  const { controller, urls, events } = setup({ mediaDevices: md }); // captureMode默认single
  controller.openFromUserGesture();
  await flushx();
  assert.equal(controller.state, 'ready');
  const r = controller.capture();
  assert.equal(r.ok, true);
  await flushx();
  assert.equal(controller.state, 'preview');
  assert.equal(md.tracks[0].stopped, true, 'single模式拍成功后必须立即停轨');
  assert.equal(events.streams.at(-1), null, '拍完必须onStream(null)');
  assert.equal(events.streams.filter((s) => s !== null).length, 1, '整个流程只交付过一次流');
  assert.equal(md.calls.length, 1);
  assertNoMic(md, '场景6');
  assertUsage(controller, { state: 'preview', captureMode: 'single', liveTracks: 0, urlsHeld: 2 }, '场景6 preview');
  assert.equal(urls.map.size, 2, '预览原件+缩略图共2个URL');
  const c2 = controller.capture();
  assert.equal(c2.ok, false, 'single模式preview后capture必须NO_STREAM');
  assert.equal(c2.code, 'NO_STREAM');
  closeOut(controller, { tracks: md.tracks, urls, note: '场景6' });
});

resourceScenario('场景7 single拍失败：立即停轨+onStream(null)、零URL、无预览、重拍NO_STREAM', async () => {
  const md = makeMediaDevices('s7');
  const { controller, urls, events } = setup({ mediaDevices: md });
  controller.openFromUserGesture();
  await flushx();
  assert.equal(controller.state, 'ready');
  FakeImageCapture.nextFailWith = Object.assign(new Error('sensor busy'), { name: 'SensorError' });
  controller.capture();
  await flushx();
  assert.equal(md.tracks[0].stopped, true, 'single模式拍失败后也必须立即停轨');
  assert.equal(events.streams.at(-1), null, '拍失败也必须onStream(null)');
  assert.equal(events.errors.at(-1).code, 'CAPTURE_FAILED');
  assert.equal(events.previews.length, 0, '失败不得产生预览');
  assert.equal(urls.map.size, 0, '失败路径零URL');
  assert.notEqual(controller.state, 'ready', '流已关不得停在ready');
  assertUsage(controller, { liveTracks: 0, urlsHeld: 0 }, '场景7');
  const c2 = controller.capture();
  assert.equal(c2.ok, false);
  assert.equal(c2.code, 'NO_STREAM', '流已关，重拍必须NO_STREAM');
  closeOut(controller, { tracks: md.tracks, urls, note: '场景7' });
});

resourceScenario('场景8 continuous拍成功：轨保持live，直到dispose才全部清理', async () => {
  const md = makeMediaDevices('s8');
  const { controller, urls, events } = setup({ mediaDevices: md, captureMode: 'continuous' });
  controller.openFromUserGesture();
  await flushx();
  assert.equal(controller.state, 'ready');
  const r = controller.capture();
  assert.equal(r.ok, true);
  await flushx();
  assert.equal(controller.state, 'preview');
  assert.equal(md.tracks[0].stopped, false, '连续模式拍成功后轨保持live');
  assert.ok(!events.streams.includes(null), '连续模式拍完不得onStream(null)');
  assertUsage(controller, { state: 'preview', captureMode: 'continuous', liveTracks: 1, urlsHeld: 2 }, '场景8 preview');
  assert.equal(urls.map.size, 2);
  closeOut(controller, { tracks: md.tracks, urls, note: '场景8' });
  assert.equal(events.streams.at(-1), null, '只有dispose才onStream(null)');
});

// ---------- 场景9-10：外部ended与作废 ----------

resourceScenario('场景9 外部轨道ended：无预览回idle/有预览回preview，onStream(null)+TRACK_ENDED', async () => {
  // 变体1：ready无预览 → idle
  {
    const md = makeMediaDevices('s9a');
    const { controller, urls, events } = setup({ mediaDevices: md });
    controller.openFromUserGesture();
    await flushx();
    assert.equal(controller.state, 'ready');
    fireEnded(md.tracks[0]);
    await flushx();
    assert.equal(controller.state, 'idle', '无预览时外部ended应回idle');
    assert.equal(events.errors.at(-1)?.code, 'TRACK_ENDED', '必须发出TRACK_ENDED错误码');
    assert.equal(events.streams.at(-1), null, '外部ended必须onStream(null)');
    assertUsage(controller, { state: 'idle', liveTracks: 0, urlsHeld: 0 }, '场景9a');
    assert.equal(urls.map.size, 0);
    closeOut(controller, { tracks: md.tracks, urls, note: '场景9a' });
  }
  // 变体2：有预览（选图、流仍存活） → preview
  {
    const md = makeMediaDevices('s9b');
    const { controller, urls, events } = setup({ mediaDevices: md });
    controller.openFromUserGesture();
    await flushx();
    const fr = await controller.acceptFile(makeBlob(Uint8Array.from([1, 2, 3])));
    assert.equal(fr.ok, true);
    assert.equal(controller.state, 'preview');
    assert.equal(md.tracks[0].stopped, false, '有预览且流存活时轨尚未结束');
    fireEnded(md.tracks[0]);
    await flushx();
    assert.equal(controller.state, 'preview', '有预览时外部ended应回preview');
    assert.equal(events.errors.at(-1)?.code, 'TRACK_ENDED');
    assert.equal(events.streams.at(-1), null, '外部ended必须onStream(null)');
    assertUsage(controller, { state: 'preview', liveTracks: 0, urlsHeld: 2 }, '场景9b');
    closeOut(controller, { tracks: md.tracks, urls, note: '场景9b' });
  }
});

resourceScenario('场景10 acceptFile作废requesting：迟到流到货即停，不得ready', async () => {
  const md = makeMediaDevices('s10');
  const { controller, urls, events } = setup({ mediaDevices: md });
  controller.openFromUserGesture();
  assert.equal(controller.state, 'requesting');
  const r = await controller.acceptFile(makeBlob(Uint8Array.from([1, 2, 3, 4])));
  assert.equal(r.ok, true);
  await flushx();
  assert.equal(controller.state, 'preview');
  assert.equal(md.tracks[0].stopped, true, '被作废的请求到货即停轨');
  assert.ok(!events.states.includes('ready'), '作废后不得ready');
  assert.equal(events.streams.filter((s) => s !== null).length, 0, '被作废的流不得交付页面');
  assertUsage(controller, { state: 'preview', liveTracks: 0, urlsHeld: 2 }, '场景10');
  closeOut(controller, { tracks: md.tracks, urls, note: '场景10' });
});

// ---------- 场景11-13：URL生命周期 ----------

resourceScenario('场景11 换图3次：旧URL即时释放、始终只持有一组，dispose后0', async () => {
  const { controller, urls, events } = setup();
  const prevs = [];
  for (let i = 1; i <= 3; i++) {
    const r = await controller.acceptFile(makeBlob(Uint8Array.from({ length: i + 1 }, (_, k) => k), 'image/png'));
    assert.equal(r.ok, true);
    prevs.push(r.preview);
    assert.equal(urls.map.size, 2, `第${i}次换图后只应持有一组URL（原件+缩略图）`);
    assertUsage(controller, { state: 'preview', liveTracks: 0, urlsHeld: 2 }, `场景11 第${i}张`);
    for (const old of prevs.slice(0, -1)) {
      assert.ok(!urls.map.has(old.url), '旧预览URL必须已撤销');
      assert.ok(!urls.map.has(old.thumbnail?.url ?? ''), '旧缩略图URL必须已撤销');
    }
  }
  assert.equal(events.previews.length, 3);
  closeOut(controller, { tracks: [], urls, note: '场景11' });
});

resourceScenario('场景12 无效文件拒绝：零URL、零预览、状态不变', async () => {
  const { controller, urls, events } = setup();
  const r1 = await controller.acceptFile(makeBlob(new Uint8Array([1]), 'video/mp4'));
  assert.equal(r1.ok, false);
  assert.equal(r1.code, 'NOT_AN_IMAGE');
  const r2 = await controller.acceptFile(makeBlob(new Uint8Array([]), 'image/jpeg'));
  assert.equal(r2.ok, false);
  assert.equal(r2.code, 'EMPTY_FILE');
  const r3 = await controller.acceptFile('not-a-blob');
  assert.equal(r3.ok, false);
  assert.equal(r3.code, 'NOT_AN_IMAGE');
  assert.equal(controller.state, 'idle', '拒绝不得改变状态');
  assert.equal(events.previews.length, 0);
  assert.equal(urls.map.size, 0);
  assertUsage(controller, { state: 'idle', liveTracks: 0, urlsHeld: 0 }, '场景12');
  closeOut(controller, { tracks: [], urls, note: '场景12' });
});

resourceScenario('场景13 slow decode被supersede：A不交付、不新增URL，URL数等于B一组', async () => {
  const gates = [];
  let decodeCount = 0;
  const { controller, urls, events } = setup({
    decodeImageMetadata: () => {
      decodeCount += 1;
      if (decodeCount === 1) {
        const d = makeDeferred();
        gates.push(d);
        return d.promise; // A：手动放行的慢decode
      }
      return Promise.resolve({ width: 4000, height: 3000 }); // B及之后：立即返回
    },
  });
  const blobA = makeBlob(Uint8Array.from([10, 11, 12]));
  const blobB = makeBlob(Uint8Array.from([20, 21, 22, 23]));
  const rA = controller.acceptFile(blobA); // 挂在慢decode上
  await flushx();
  assert.equal(gates.length, 1, 'A应卡在慢decode');
  const rB = await controller.acceptFile(blobB); // B覆盖并完成
  assert.equal(rB.ok, true);
  assert.equal(controller.getPreview().id, rB.preview.id);
  assert.equal(urls.map.size, 2, 'B一组URL（原件+缩略图）');
  gates[0].resolve({ width: 111, height: 111 }); // 手动放行A的decode
  const resA = await rA;
  await flushx();
  assert.equal(resA.ok, false, '被超越的A不得成功交付');
  assert.equal(events.previews.length, 1, '只有B交付预览');
  assert.equal(controller.getPreview().id, rB.preview.id, '当前预览仍是B');
  assert.equal(urls.map.size, 2, 'A迟到完成不得新增URL（仍等于B一组）');
  assertUsage(controller, { state: 'preview', liveTracks: 0, urlsHeld: 2 }, '场景13');
  closeOut(controller, { tracks: [], urls, note: '场景13' });
});

// ---------- 场景14-18：dispose竞态 ----------

resourceScenario('场景14 dispose竞态requesting：迟到resolve/ended全部静默', async () => {
  const md = makeMediaDevices('s14', { manual: true });
  const { controller, urls, events } = setup({ mediaDevices: md });
  controller.openFromUserGesture();
  assert.equal(controller.state, 'requesting');
  controller.dispose();
  const statesAtDispose = events.states.length;
  md.manual[0].resolveStream();
  await flushx();
  assert.equal(md.tracks[0].stopped, true, '迟到流到货即停');
  assert.equal(events.states.length, statesAtDispose, 'dispose后不得再有状态迁移');
  assert.equal(events.streams.length, 0, '迟到流不得交付页面');
  assert.equal(events.errors.length, 0, '迟到流不得报错');
  assert.equal(urls.map.size, 0);
  fireEnded(md.tracks[0]); // 迟到ended也必须静默
  await flushx();
  assert.equal(events.states.length, statesAtDispose, 'ended后仍不得有状态迁移');
  assert.equal(events.streams.length, 0);
  closeOut(controller, { tracks: md.tracks, urls, note: '场景14' });
});

resourceScenario('场景15 dispose竞态requesting：迟到reject静默无onError', async () => {
  const md = makeMediaDevices('s15', { manual: true });
  const { controller, urls, events } = setup({ mediaDevices: md });
  controller.openFromUserGesture();
  controller.dispose();
  md.manual[0].reject(Object.assign(new Error('late deny'), { name: 'NotAllowedError' }));
  await flushx();
  assert.equal(controller.state, 'disposed');
  assert.equal(events.errors.length, 0, '迟到拒绝不得外抛onError');
  assert.ok(!events.states.includes('denied'), '迟到拒绝不得产生denied状态');
  assert.equal(md.tracks.length, 0, '从未交付即无轨');
  assert.equal(urls.map.size, 0);
  closeOut(controller, { tracks: md.tracks, urls, note: '场景15' });
});

resourceScenario('场景16 dispose竞态capturing：迟到照片不产预览不产URL', async () => {
  const md = makeMediaDevices('s16');
  const { controller, urls, events } = setup({ mediaDevices: md });
  controller.openFromUserGesture();
  await flushx();
  assert.equal(controller.state, 'ready');
  FakeImageCapture.manualMode = true;
  controller.capture();
  assert.equal(controller.state, 'capturing');
  controller.dispose();
  const statesAtDispose = events.states.length;
  FakeImageCapture.manual[0].resolve(makeBlob(PHOTO_BYTES));
  await flushx();
  assert.equal(events.previews.length, 0, '迟到照片不得交付预览');
  assert.equal(urls.map.size, 0, '迟到照片不得创建URL');
  assert.equal(events.states.length, statesAtDispose, '不得有新状态迁移');
  closeOut(controller, { tracks: md.tracks, urls, note: '场景16' });
});

resourceScenario('场景17 dispose竞态capturing：迟到reject无CAPTURE_FAILED', async () => {
  const md = makeMediaDevices('s17');
  const { controller, urls, events } = setup({ mediaDevices: md });
  controller.openFromUserGesture();
  await flushx();
  FakeImageCapture.manualMode = true;
  controller.capture();
  controller.dispose();
  FakeImageCapture.manual[0].reject(new Error('late sensor failure'));
  await flushx();
  assert.equal(controller.state, 'disposed');
  assert.equal(events.errors.some((e) => e.code === 'CAPTURE_FAILED'), false, '迟到reject不得外抛');
  assert.equal(events.previews.length, 0);
  assert.equal(urls.map.size, 0);
  closeOut(controller, { tracks: md.tracks, urls, note: '场景17' });
});

resourceScenario('场景18 dispose竞态decode：迟到ingest不创建URL不交付预览', async () => {
  const gates = [];
  const { controller, urls, events } = setup({
    decodeImageMetadata: () => {
      const d = makeDeferred();
      gates.push(d);
      return d.promise; // 全部手动放行
    },
  });
  const pending = controller.acceptFile(makeBlob(Uint8Array.from([1, 2, 3])));
  await flushx();
  assert.equal(gates.length, 1, '应卡在decode');
  controller.dispose();
  gates[0].resolve({ width: 50, height: 50 });
  const res = await pending;
  await flushx();
  assert.equal(res.ok, false, 'dispose后acceptFile不得成功');
  assert.equal(events.previews.length, 0, 'dispose后不得交付预览');
  assert.equal(urls.map.size, 0, 'dispose后迟到ingest不得创建URL');
  assert.equal(controller.state, 'disposed');
  assertUsage(controller, { state: 'disposed', liveTracks: 0, urlsHeld: 0 }, '场景18');
  closeOut(controller, { tracks: [], urls, note: '场景18' });
});

// ---------- 全程核算（跨所有场景累计） ----------

after('全程核算：麦克风请求0 + 无任何存活track残留', () => {
  assert.ok(ALL_GUM_CALLS.length > 0, '核算前提：本套件应发起过getUserMedia（否则覆盖不足）');
  const badMic = ALL_GUM_CALLS.filter((c) => c.constraints?.audio !== false);
  assert.equal(
    badMic.length,
    0,
    `麦克风请求泄漏：${badMic.length}次调用audio!==false：${JSON.stringify(badMic.map((c) => ({ tag: c.tag, constraints: c.constraints })))}`,
  );
  const liveTracks = ALL_TRACKS.filter((t) => !(t.stopped === true || t.readyState === 'ended'));
  assert.equal(liveTracks.length, 0, `track泄漏：${liveTracks.length}条轨仍存活：${liveTracks.map((t) => t.id).join(',')}`);
});
