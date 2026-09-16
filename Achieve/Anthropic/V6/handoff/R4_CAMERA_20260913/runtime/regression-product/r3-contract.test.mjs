// R3契约测试（v0.3.0新增行为，SA-A独占写面）。
// 被测：../../src/camera-controller.mjs（v0.3.0-r3-candidate）。
// 范围（任务书1-8）：
//   1. discardPreview基本契约（撤销URL/回idle/幂等NO_PREVIEW/dispose后DISPOSED）
//   2. discardPreview流保持契约（continuous：state回ready、轨道不停、onStream不发null）
//   3. discardPreview作废在途照片ingest（seq超越：慢decode放行后无onPreview、无新URL）
//   4. URL释放边界（换图后旧URL撤销、当前展示不被破坏、原字节不变、provenance恒unverified）
//   5. 取消中切文件（acceptFile作废未决请求后cancelRequest返回NOT_PENDING；迟到流到货即停）
//   6. 连续点击峰值流≤1（open×3/close×1/switchCamera×2/capture×1；计数器与实际采纳一致）
//   7. 资源收据buildResourceReceipt（挂断会话收据断言 + 缺省uploadsAttempted必须null）
//   8. 计数器审计（任何gUM调用audio恒false→micConstraintViolations恒0）
// 方法：全部合成Blob与虚拟mediaDevices/轨道/URL注册表/clock/ImageCapture；
//   无浏览器、无真实设备、无网络、无新依赖。
// 运行：node --test test/r3-contract.test.mjs（或经 test/run-r3.mjs 与R2回归副本同跑）
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CameraController,
  CAMERA_CONTROLLER_VERSION,
  buildResourceReceipt,
} from "file:///C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/lib/v5-preview/camera/camera-controller.mjs";

// ---------- 假设施（自建独立，风格对齐R2 adversarial，不import其他测试内部工具） ----------

const FILE_BYTES = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const PHOTO_BYTES = Uint8Array.from({ length: 64 }, (_, i) => i * 2);
const THUMB_BYTES = Uint8Array.from([230, 231, 232, 233]);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const flush = () => wait(15); // 等微任务链（takePhoto→decode→thumbnail→ingest）稳定

function makeDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeFile() {
  return new Blob([FILE_BYTES], { type: 'image/jpeg' });
}

function makePhotoBlob() {
  return new Blob([PHOTO_BYTES], { type: 'image/jpeg' });
}

let trackSeq = 0;
let streamSeq = 0;

function makeTrack() {
  const track = {
    id: `r3-track-${++trackSeq}`,
    kind: 'video',
    label: 'r3-fake-camera',
    readyState: 'live',
    stopped: false, // 仅stop()置位；泄漏判定用 stopped || readyState==='ended'
    onended: null,
    _endedListeners: [],
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
  return track;
}

function makeStream() {
  const track = makeTrack();
  const stream = {
    id: `r3-stream-${++streamSeq}`,
    getVideoTracks: () => [track],
    getTracks: () => [track],
  };
  return { stream, track };
}

// getUserMedia结果由测试手动控制的假设备：每次调用挂一个deferred，resolveStream()才交付流。
// options.rejectWith：返回rejected promise（不创建deferred，用于denied路径）。
function makeManualMediaDevices(options = {}) {
  const devices = {
    calls: [],
    deferreds: [],
    getUserMedia(constraints) {
      devices.calls.push(constraints);
      if (options.rejectWith) return Promise.reject(options.rejectWith);
      const d = makeDeferred();
      d.paired = null;
      d.resolveStream = () => {
        if (!d.paired) d.paired = makeStream();
        d.resolve(d.paired.stream);
      };
      devices.deferreds.push(d);
      return d.promise;
    },
  };
  return devices;
}

// URL注册表：记录全部create/revoke，可交叉核对控制器自报计数。
function makeUrlRegistry() {
  const map = new Map();
  const created = [];
  const revoked = [];
  let n = 0;
  return {
    map,
    created,
    revoked,
    createObjectURL() {
      const url = `blob:r3-${++n}`;
      created.push(url);
      map.set(url, true);
      return url;
    },
    revokeObjectURL(url) {
      revoked.push(url);
      map.delete(url);
    },
  };
}

function makeClock() {
  let t = 1000;
  return () => (t += 5);
}

// takePhoto自动成功的假ImageCapture。
class AutoImageCapture {
  constructor(track) {
    this.track = track;
  }
  takePhoto() {
    return Promise.resolve(makePhotoBlob());
  }
}

// takePhoto结果由测试手动控制的假ImageCapture（在途拍照竞态用）。
function makeManualImageCaptureClass() {
  const instances = [];
  class ManualImageCapture {
    constructor(track) {
      this.track = track;
      this.pending = null;
      instances.push(this);
    }
    takePhoto() {
      const d = makeDeferred();
      this.pending = d;
      return d.promise;
    }
  }
  return { cls: ManualImageCapture, instances };
}

// 可按blob挑拣“慢decode”的假解码器：shouldHold(blob)=true时挂起等待手动放行。
function makeSelectiveDecoder(shouldHold) {
  const held = [];
  const calls = [];
  const decode = (blob) => {
    calls.push(blob);
    if (!shouldHold(blob)) return Promise.resolve({ width: 10, height: 20 });
    const d = makeDeferred();
    d.blob = blob;
    held.push(d);
    return d.promise;
  };
  decode.held = held;
  decode.calls = calls;
  return decode;
}

async function fastThumbnail() {
  return { blob: new Blob([THUMB_BYTES], { type: 'image/jpeg' }), width: 4, height: 4 };
}

function createHarness(opts = {}) {
  const registry = makeUrlRegistry();
  const events = { state: [], error: [], preview: [], stream: [] };
  const eventLog = []; // {t, kind, ...}：任务书7的资源收据事件序列
  const guardFailures = [];
  const mediaDevices = makeManualMediaDevices(opts.deviceOptions);
  const clock = makeClock();
  const controller = new CameraController({
    mediaDevices,
    ImageCapture: opts.ImageCapture ?? null,
    createObjectURL: registry.createObjectURL,
    revokeObjectURL: registry.revokeObjectURL,
    now: clock,
    decodeImageMetadata: opts.decoder ?? (async () => ({ width: 10, height: 20 })),
    createThumbnail: opts.createThumbnail ?? fastThumbnail,
    isSecureContext: true,
    ...(opts.requestTimeoutMs !== undefined ? { requestTimeoutMs: opts.requestTimeoutMs } : {}),
    ...(opts.captureMode !== undefined ? { captureMode: opts.captureMode } : {}),
    onStateChange: (s) => {
      events.state.push(s.state);
      eventLog.push({ t: clock(), kind: 'state', state: s.state });
    },
    onPreview: (p) => {
      events.preview.push(p);
      eventLog.push({ t: clock(), kind: 'preview', id: p.id });
    },
    onError: (e) => {
      events.error.push(e);
      eventLog.push({ t: clock(), kind: 'error', code: e.code });
    },
    onStream: (s) => {
      events.stream.push(s);
      eventLog.push({ t: clock(), kind: 'stream', live: s !== null });
      if (opts.streamGuard) {
        try {
          opts.streamGuard(s);
        } catch (err) {
          guardFailures.push(err); // 回调内断言失败不外抛，收尾统一核对
        }
      }
    },
  });
  return { controller, registry, events, eventLog, guardFailures, mediaDevices, clock };
}

// 统一包装：断言失败也兜底dispose，避免遗留定时器/轨挂住测试进程。
async function withController(opts, fn) {
  const h = createHarness(opts);
  try {
    await fn(h);
  } finally {
    h.controller.dispose();
  }
  return h;
}

async function openToReady(h) {
  const r = h.controller.openFromUserGesture();
  assert.equal(r.ok, true, 'openFromUserGesture应受理');
  assert.equal(r.pending, true);
  const d = h.mediaDevices.deferreds[0];
  d.resolveStream();
  await flush();
  assert.equal(h.controller.state, 'ready');
  return d.paired; // { stream, track }
}

const allEndedOrStopped = (tracks, note) => {
  for (const t of tracks) {
    assert.ok(t.stopped || t.readyState === 'ended', `${note}: track泄漏（既未stop也未ended）: ${t.id}`);
  }
};

// ---------- 契约1｜discardPreview 基本契约 ----------

test('R3契约1｜discardPreview基本契约：撤销全部URL、state回idle、预览清空；幂等NO_PREVIEW；dispose后DISPOSED', async () => {
  await withController({}, async (h) => {
    const c = h.controller;
    // 前置：无预览时discard即NO_PREVIEW，且不外抛onError（内容作废不是错误）
    assert.deepEqual(c.discardPreview(), { ok: false, code: 'NO_PREVIEW' });
    assert.deepEqual(h.events.error, [], 'NO_PREVIEW不得外抛onError');
    assert.equal(h.mediaDevices.calls.length, 0, '全程不得触设备');

    const r = await c.acceptFile(makeFile());
    assert.equal(r.ok, true);
    assert.equal(c.state, 'preview');
    assert.equal(h.registry.map.size, 2, '原件+缩略图两个URL在册');
    const countersBefore = c.getResourceCounters();

    const d1 = c.discardPreview();
    assert.deepEqual(d1, { ok: true, hadPreview: true, hasLiveStream: false });
    assert.equal(h.registry.map.size, 0, 'URL注册表归0（原件与缩略图都撤销）');
    assert.equal(c.state, 'idle', '无流时回idle');
    assert.equal(c.getPreview(), null);
    assert.equal(c.getSnapshot().activePreviewId, null);
    assert.equal(c.getSnapshot().hasLiveStream, false);
    assert.equal(c.getSnapshot().lastError, null, '内容作废不得留成lastError');
    const countersAfter = c.getResourceCounters();
    assert.equal(countersAfter.urlsCreated, countersBefore.urlsCreated, 'discard不得新建URL');
    assert.equal(countersAfter.urlsRevoked, countersBefore.urlsCreated, '创建过的URL全部撤销');
    assert.ok(h.events.state.includes('idle'), 'onStateChange广播idle');
    assert.deepEqual(h.events.error, []);

    // 幂等：再次discard仍NO_PREVIEW且无副作用
    assert.deepEqual(c.discardPreview(), { ok: false, code: 'NO_PREVIEW' });
    assert.equal(c.state, 'idle');
    assert.equal(h.registry.map.size, 0);

    // dispose后：DISPOSED优先
    c.dispose();
    assert.deepEqual(c.discardPreview(), { ok: false, code: 'DISPOSED' });
    assert.equal(h.registry.map.size, 0);
  });
});

// ---------- 契约2｜discardPreview 流保持（continuous） ----------

test('R3契约2｜discardPreview流保持（continuous）：state回ready、liveTracks=1、轨道未stop、onStream未再发null', async () => {
  await withController({ captureMode: 'continuous', ImageCapture: AutoImageCapture }, async (h) => {
    const c = h.controller;
    const { stream, track } = await openToReady(h);
    const cr = c.capture();
    assert.equal(cr.ok, true);
    await flush();
    assert.equal(c.state, 'preview');
    assert.equal(c.getSnapshot().hasLiveStream, true);
    assert.deepEqual(h.events.stream, [stream], '此前仅交付一次流');

    const statesBefore = [...h.events.state];
    const d = c.discardPreview();
    assert.deepEqual(d, { ok: true, hadPreview: true, hasLiveStream: true });
    assert.equal(c.state, 'ready', '流存活时回ready');
    assert.deepEqual(h.events.state, [...statesBefore, 'ready'], '状态迁移恰为preview→ready');
    assert.equal(c.getResourceUsage().liveTracks, 1, '流保持存活');
    assert.equal(track.stopped, false, '轨道未被stop');
    assert.equal(track.readyState, 'live');
    assert.deepEqual(h.events.stream, [stream], 'onStream未再发null');
    assert.equal(c.getPreview(), null);
    assert.equal(h.registry.map.size, 0, '预览URL已撤销而流不动');
  });
});

// ---------- 契约3｜discardPreview 作废在途照片ingest ----------

test('R3契约3｜discardPreview作废在途照片ingest（continuous）：seq超越，慢decode放行后无onPreview、无新URL、流保持', async () => {
  const fileA = makeFile();
  // 仅挂起“非fileA”的blob：即capture在途照片（fileA立即decode）。
  const decoder = makeSelectiveDecoder((blob) => blob !== fileA);
  const { cls, instances } = makeManualImageCaptureClass();
  await withController({ captureMode: 'continuous', decoder, ImageCapture: cls }, async (h) => {
    const c = h.controller;
    const { track } = await openToReady(h);

    const rA = await c.acceptFile(fileA);
    assert.equal(rA.ok, true);
    assert.deepEqual(h.events.preview.map((p) => p.blob), [fileA]);
    assert.equal(h.registry.created.length, 2, 'A一组URL');

    // 拍照在途：takePhoto手动放行后ingest卡在慢decode
    const cap = c.capture();
    assert.equal(cap.ok, true);
    assert.equal(c.state, 'capturing');
    assert.equal(instances.length, 1);
    instances[0].pending.resolve(makePhotoBlob());
    await flush();
    assert.equal(decoder.held.length, 1, '在途照片ingest卡在decode');
    assert.equal(c.getPreview()?.blob, fileA, '此刻当前预览仍是A');

    // discard：作废当前预览A并超越在途ingest（seq超越）
    const d = c.discardPreview();
    assert.deepEqual(d, { ok: true, hadPreview: true, hasLiveStream: true });
    assert.equal(c.state, 'ready');
    assert.equal(h.registry.map.size, 0, 'A的URL已撤销');
    assert.equal(c.getPreview(), null);

    // 放行慢decode：在途ingest按SUPERSEDED终止——无onPreview、无新URL、无状态迁移
    const statesAtDiscard = h.events.state.length;
    const errorsAtDiscard = h.events.error.length;
    const createdAtDiscard = h.registry.created.length;
    decoder.held[0].resolve({ width: 1, height: 1 });
    await flush();
    assert.deepEqual(h.events.preview.map((p) => p.blob), [fileA], '慢decode放行后无新onPreview');
    assert.equal(h.registry.created.length, createdAtDiscard, '在途照片未创建任何URL');
    assert.equal(h.registry.map.size, 0);
    assert.equal(c.state, 'ready', '状态不被迟到照片扰乱');
    assert.equal(h.events.state.length, statesAtDiscard, '无状态迁移');
    assert.equal(h.events.error.length, errorsAtDiscard, '无新onError');
    assert.equal(c.getPreview(), null);
    assert.equal(track.stopped, false, 'continuous流保持');
    assert.equal(c.getResourceUsage().liveTracks, 1);
  });
});

// ---------- 契约4｜URL释放边界 ----------

test('R3契约4｜URL释放边界：换图后A的URL已撤销、B的URL仍在且当前展示不被破坏；B原字节逐字节一致；provenance恒unverified', async () => {
  await withController({}, async (h) => {
    const c = h.controller;
    const bytesA = Uint8Array.from({ length: 40 }, (_, i) => i + 1);
    const bytesB = Uint8Array.from({ length: 48 }, (_, i) => i * 3 + 7);
    const fileA = new Blob([bytesA], { type: 'image/png' });
    const fileB = new Blob([bytesB], { type: 'image/jpeg' });

    const rA = await c.acceptFile(fileA);
    assert.equal(rA.ok, true);
    const urlA = rA.preview.url;
    const thumbUrlA = rA.preview.thumbnail.url;
    assert.ok(h.registry.map.has(urlA), '前置：A的URL在册');
    assert.equal(h.mediaDevices.calls.length, 0, '选图路径零设备调用');

    const rB = await c.acceptFile(fileB);
    assert.equal(rB.ok, true);
    const pB = rB.preview;
    // A的URL已从注册表移除
    assert.ok(!h.registry.map.has(urlA), 'A的url已从注册表移除');
    assert.ok(!h.registry.map.has(thumbUrlA), 'A的缩略图url已移除');
    // B的URL仍在，当前展示不被破坏
    assert.ok(h.registry.map.has(pB.url), 'B的url仍在注册表');
    assert.ok(h.registry.map.has(pB.thumbnail.url), 'B的缩略图url仍在注册表');
    assert.equal(h.registry.map.size, 2, '注册表恰为一组2个');
    assert.equal(c.getPreview().url, pB.url, 'getPreview().url === B.url');
    assert.equal(c.getPreview().id, pB.id);
    assert.equal(c.state, 'preview');
    // B原字节逐字节等于输入
    const loaded = new Uint8Array(await pB.blob.arrayBuffer());
    assert.equal(loaded.length, bytesB.length);
    assert.equal(Buffer.compare(Buffer.from(loaded), Buffer.from(bytesB)), 0, 'B原字节逐字节等于输入');
    assert.equal(pB.byteLength, bytesB.length);
    assert.equal(pB.mime, 'image/jpeg');
    // 出处恒为未验证
    assert.equal(pB.provenance, 'unverified', 'provenance恒为unverified');
    assert.equal(pB.capturedAt, null, '不冒称拍摄时间');
    assert.deepEqual(h.events.preview.map((p) => p.id), [rA.preview.id, pB.id], 'onPreview序列A→B');
  });
});

// ---------- 契约5｜取消中切文件 ----------

test('R3契约5｜取消中切文件：acceptFile作废未决请求后cancelRequest返回NOT_PENDING；迟到流到货即停、状态不被扰乱', async () => {
  await withController({ requestTimeoutMs: null }, async (h) => {
    const c = h.controller;
    const r = c.openFromUserGesture();
    assert.equal(r.ok, true);
    assert.equal(c.state, 'requesting');
    assert.equal(h.mediaDevices.deferreds.length, 1);

    // 切文件：未决摄像头请求作废、预览交付
    const fr = await c.acceptFile(makeFile());
    assert.equal(fr.ok, true);
    assert.equal(c.state, 'preview', 'acceptFile已交付预览、请求已作废');

    // 此刻cancelRequest：已不在requesting → NOT_PENDING，且不改状态、不外抛
    assert.deepEqual(c.cancelRequest(), { ok: false, code: 'NOT_PENDING' });
    assert.equal(c.state, 'preview', 'NOT_PENDING不改变状态');
    assert.deepEqual(h.events.error, [], 'NOT_PENDING不是错误');

    // 迟到的授权流到货：立即停轨、状态不被扰乱
    const statesBefore = h.events.state.length;
    h.mediaDevices.deferreds[0].resolveStream();
    await flush();
    const track = h.mediaDevices.deferreds[0].paired.track;
    assert.equal(track.stopped, true, '迟到流立即停轨');
    assert.equal(c.state, 'preview', '状态不被扰乱');
    assert.equal(h.events.state.length, statesBefore, '无状态迁移');
    assert.ok(!h.events.state.includes('ready'), '不得出现ready');
    assert.deepEqual(h.events.stream, [], '迟到流不得交付页面');
    assert.deepEqual(h.events.error, [], '无误报');
  });
});

// ---------- 契约6｜连续点击峰值流≤1 ----------

test('R3契约6｜快速交替open×3/close×1/switchCamera×2/capture×1：同时存活流峰值≤1；streamsAdopted与实际采纳一致；dispose后归零', async () => {
  const live = new Set(); // onStream观测点：被采纳且未确认释放的track
  let peak = 0;
  const guard = (s) => {
    if (s) {
      for (const t of live) {
        assert.ok(t.stopped || t.readyState === 'ended', `不变量：采纳新流时旧track未释放（${t.id}）`);
      }
      live.add(s.getVideoTracks()[0]);
      if (live.size > peak) peak = live.size;
      assert.ok(live.size <= 1, `不变量：同时存活流>1（${live.size}）`);
    } else {
      for (const t of [...live]) if (t.stopped || t.readyState === 'ended') live.delete(t);
      assert.equal(live.size, 0, '不变量：onStream(null)后仍有未释放track');
    }
  };

  await withController({ streamGuard: guard }, async (h) => {
    const c = h.controller;

    // requesting窗口内的快速点击：open#1受理，open#2/switch#1被拒
    const r1 = c.openFromUserGesture(); // open#1
    assert.equal(r1.ok, true);
    const r2 = c.openFromUserGesture(); // open#2
    assert.deepEqual(r2, { ok: false, code: 'ALREADY_PENDING' });
    const sw1 = c.switchCamera(); // switchCamera#1
    assert.deepEqual(sw1, { ok: false, code: 'ALREADY_PENDING' });

    // open#1的流到货：S1被采纳（采纳1）
    h.mediaDevices.deferreds[0].resolveStream();
    await flush();
    assert.equal(c.state, 'ready');
    const s1stream = h.events.stream[0];
    const s1 = h.mediaDevices.deferreds[0].paired.track;
    assert.equal(c.getResourceCounters().streamsAdopted, 1);

    // switch#2（成功路径）：先停S1再发起请求；capture#1在requesting中无流可拍
    const sw2 = c.switchCamera(); // switchCamera#2
    assert.equal(sw2.ok, true);
    assert.equal(s1.stopped, true, 'switch先停旧轨');
    assert.deepEqual(h.events.stream, [s1stream, null], 'S1交付后紧接onStream(null)');
    assert.equal(c.state, 'requesting');
    const cap = c.capture(); // capture#1
    assert.deepEqual(cap, { ok: false, code: 'NO_STREAM' }, 'requesting中无流，capture拒绝');

    // close#1在requesting中：转cancelRequest，立即退出
    const cl = c.closeStream(); // close#1
    assert.deepEqual(cl, { ok: true });
    assert.equal(c.state, 'idle');

    // open#3：重新发起请求（D3在途，controller处于requesting）
    const r3 = c.openFromUserGesture(); // open#3
    assert.equal(r3.ok, true);

    // switch#2的流（D2）已被close作废：迟到到货即停，不交付、不扰乱open#3的在途状态
    h.mediaDevices.deferreds[1].resolveStream();
    await flush();
    const d2track = h.mediaDevices.deferreds[1].paired.track;
    assert.equal(d2track.stopped, true, '被作废请求的迟到流立即停轨');
    assert.deepEqual(h.events.stream, [s1stream, null], '迟到流不得交付页面');
    assert.equal(c.state, 'requesting', '迟到流不改变状态（open#3仍在途）');

    // open#3的流到货：S2被采纳（采纳2）
    h.mediaDevices.deferreds[2].resolveStream();
    await flush();
    assert.equal(c.state, 'ready');
    const s2stream = h.events.stream[2];
    const s2 = h.mediaDevices.deferreds[2].paired.track;

    // 终局dispose
    const d = c.dispose();
    assert.equal(d.ok, true);
    assert.deepEqual(
      { ...c.getResourceUsage() },
      { state: 'disposed', captureMode: 'single', liveTracks: 0, urlsHeld: 0 },
      'dispose后资源归零',
    );
    assert.deepEqual(h.events.stream, [s1stream, null, s2stream, null], '流交付与释放通知序列');

    // 计数器审计
    const counters = c.getResourceCounters();
    const actualAdoptions = h.events.stream.filter((s) => s !== null).length;
    assert.equal(counters.streamsAdopted, 2, 'streamsAdopted与实际采纳一致');
    assert.equal(actualAdoptions, 2);
    assert.equal(counters.gumCalls, 3, 'open#1/switch#2/open#3各一次getUserMedia');
    assert.equal(counters.urlsCreated - counters.urlsRevoked, 0, 'danglingUrls=0');
    assert.equal(h.registry.map.size, 0);
    assert.equal(peak, 1, '全程同时存活流峰值=1');
    assert.deepEqual(h.guardFailures, [], 'onStream守卫内无断言失败');
    allEndedOrStopped([s1, d2track, s2], '终局');
    assert.deepEqual(h.events.error, [], '全程无误报错误');
  });
});

// ---------- 契约7｜资源收据 buildResourceReceipt ----------

test('R3契约7a｜资源收据：open→capture→换图→closeStream→dispose挂断会话；micRequests/danglingUrls/终态归零、URL收支平衡、事件有序、上传探针实测0', async () => {
  // 上传探针：会话期间包裹fetch/XHR（沿用R2口径，实测上传尝试次数后喂给meta）
  const uploadCalls = [];
  const origFetch = globalThis.fetch;
  const origOpen = globalThis.XMLHttpRequest?.prototype?.open;
  globalThis.fetch = function r3ReceiptProbeFetch(...args) {
    uploadCalls.push(`fetch(${String(args[0])})`);
    return new Promise(() => {});
  };
  if (origOpen) {
    globalThis.XMLHttpRequest.prototype.open = function r3ReceiptProbeOpen(...args) {
      uploadCalls.push(`xhr.open(${String(args[0])} ${String(args[1])})`);
    };
  }
  try {
    await withController({ captureMode: 'continuous', ImageCapture: AutoImageCapture }, async (h) => {
      const c = h.controller;
      // 脚本化会话：open → capture成功 → acceptFile换图 → closeStream → dispose
      const o = c.openFromUserGesture();
      assert.equal(o.ok, true);
      h.mediaDevices.deferreds[0].resolveStream();
      await flush();
      assert.equal(c.state, 'ready');
      const cap = c.capture();
      assert.equal(cap.ok, true);
      await flush();
      assert.equal(c.state, 'preview');
      const rB = await c.acceptFile(makeFile()); // 换图
      assert.equal(rB.ok, true);
      const cl = c.closeStream(); // 挂断：停流
      assert.deepEqual(cl, { ok: true });
      assert.equal(c.state, 'preview', '有预览时挂断回preview');

      const d = c.dispose();
      assert.equal(d.ok, true);
      const counters = c.getResourceCounters(); // 收束时（dispose后）取计数：含dispose的撤销
      const finalUsage = c.getResourceUsage();

      const receipt = buildResourceReceipt({
        events: h.eventLog,
        finalUsage,
        counters,
        meta: { reason: 'hangup', uploadsAttempted: uploadCalls.length },
      });

      assert.equal(receipt.kind, 'camera-resource-receipt');
      assert.equal(receipt.version, CAMERA_CONTROLLER_VERSION);
      assert.equal(receipt.reason, 'hangup');
      // 麦克风与终态必须归零
      assert.equal(receipt.micRequests, 0, 'micRequests必须0');
      assert.equal(counters.micConstraintViolations, 0, 'micConstraintViolations必须0');
      assert.equal(receipt.danglingUrls, 0, 'danglingUrls必须0');
      assert.equal(receipt.liveTracksAtEnd, 0, 'liveTracksAtEnd必须0');
      assert.equal(receipt.urlsHeldAtEnd, 0, 'urlsHeldAtEnd必须0');
      assert.equal(receipt.stateAtEnd, 'disposed');
      // URL收支平衡：capture一组 + 换图一组，全部撤销
      assert.equal(receipt.urlsCreated, receipt.urlsRevoked);
      assert.ok(receipt.urlsCreated >= 4, `capture与换图各一组URL，实际${receipt.urlsCreated}`);
      // 上传：探针实测0
      assert.equal(receipt.uploadsAttempted, 0, 'uploadsAttempted=探针实测值0');
      assert.equal(uploadCalls.length, 0, '全程零上传尝试');
      // 事件日志非空且有序
      assert.ok(receipt.eventLog.length > 0, 'eventLog非空');
      for (let i = 1; i < receipt.eventLog.length; i += 1) {
        assert.ok(receipt.eventLog[i].t >= receipt.eventLog[i - 1].t, `eventLog必须按t有序（#${i}）`);
      }
      assert.equal(receipt.eventLog[0].kind, 'state');
      assert.equal(receipt.eventLog[0].state, 'requesting');
      assert.equal(receipt.eventLog.at(-1).kind, 'state');
      assert.equal(receipt.eventLog.at(-1).state, 'disposed');
      assert.ok(receipt.eventLog.some((e) => e.kind === 'stream' && e.live === true), '有流交付事件');
      assert.ok(receipt.eventLog.some((e) => e.kind === 'stream' && e.live === false), '有流释放事件');
      assert.ok(Object.isFrozen(receipt), '收据冻结');
      assert.ok(Object.isFrozen(receipt.eventLog), 'eventLog冻结');
      // 收据与计数器自洽
      assert.equal(receipt.gumCallsTotal, counters.gumCalls);
      assert.equal(receipt.streamsAdopted, counters.streamsAdopted);
      assert.equal(receipt.tracksStoppedByController, counters.tracksStoppedByController);
      assert.ok(receipt.tracksStoppedByController >= 1, '控制器实际停过轨');
    });
  } finally {
    if (origFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = origFetch;
    if (origOpen) globalThis.XMLHttpRequest.prototype.open = origOpen;
  }
});

test('R3契约7b｜buildResourceReceipt缺省uploadsAttempted必须为null（不冒称已测）；meta缺省reason回落dispose', () => {
  const receipt = buildResourceReceipt({
    events: [{ t: 1, kind: 'state', state: 'idle' }],
    finalUsage: { state: 'disposed', liveTracks: 0, urlsHeld: 0 },
    counters: {
      gumCalls: 1,
      micConstraintViolations: 0,
      streamsAdopted: 1,
      tracksStoppedByController: 1,
      urlsCreated: 2,
      urlsRevoked: 2,
    },
    meta: { reason: 'hangup' },
  });
  assert.equal(receipt.uploadsAttempted, null, '缺省uploadsAttempted必须null，不得缺省填0冒称已测');
  assert.equal(receipt.reason, 'hangup');
  assert.equal(receipt.micRequests, 0);
  assert.equal(receipt.danglingUrls, 0);
  assert.equal(receipt.liveTracksAtEnd, 0);
  assert.equal(receipt.urlsHeldAtEnd, 0);

  // 整个meta缺省：reason默认dispose，uploadsAttempted仍null
  const r2 = buildResourceReceipt({
    events: [],
    finalUsage: { state: 'disposed', liveTracks: 0, urlsHeld: 0 },
    counters: null,
  });
  assert.equal(r2.reason, 'dispose');
  assert.equal(r2.uploadsAttempted, null);
  assert.equal(r2.micRequests, 0, 'counters缺省按0计');
});

// ---------- 契约8｜计数器审计 ----------

test('R3契约8｜计数器审计：任何gUM调用audio恒false→micConstraintViolations恒0（成功/switch/拒绝/超时四路径）', async () => {
  const allConstraints = [];

  // 路径1：成功open + switchCamera
  await withController({}, async (h) => {
    const c = h.controller;
    await openToReady(h);
    const sw = c.switchCamera();
    assert.equal(sw.ok, true);
    h.mediaDevices.deferreds[1].resolveStream();
    await flush();
    assert.equal(c.state, 'ready');
    allConstraints.push(...h.mediaDevices.calls);
    const counters = c.getResourceCounters();
    assert.equal(counters.gumCalls, 2);
    assert.equal(counters.micConstraintViolations, 0);
  });

  // 路径2：权限拒绝
  const denied = Object.assign(new Error('deny'), { name: 'NotAllowedError' });
  await withController({ deviceOptions: { rejectWith: denied } }, async (h) => {
    h.controller.openFromUserGesture();
    await flush();
    assert.equal(h.controller.state, 'denied');
    allConstraints.push(...h.mediaDevices.calls);
    assert.equal(h.controller.getResourceCounters().micConstraintViolations, 0);
  });

  // 路径3：超时自动取消 + 迟到流
  await withController({ requestTimeoutMs: 20 }, async (h) => {
    h.controller.openFromUserGesture();
    await wait(60);
    assert.equal(h.controller.state, 'idle');
    assert.equal(h.events.error.at(-1).code, 'REQUEST_TIMEOUT');
    h.mediaDevices.deferreds[0].resolveStream();
    await flush();
    assert.equal(h.mediaDevices.deferreds[0].paired.track.stopped, true, '迟到流立即停轨');
    allConstraints.push(...h.mediaDevices.calls);
    assert.equal(h.controller.getResourceCounters().micConstraintViolations, 0);
  });

  // 设备侧真值：每一次getUserMedia的constraints.audio必须恒为false
  assert.ok(allConstraints.length >= 4, `覆盖前提：应≥4次gUM，实际${allConstraints.length}`);
  for (const cs of allConstraints) {
    assert.equal(cs.audio, false, `出现audio!==false的调用：${JSON.stringify(cs)}`);
  }

  // 计数器形状：恰6个键且冻结（只增计数，供buildResourceReceipt核对）
  await withController({}, async (h) => {
    const counters = h.controller.getResourceCounters();
    assert.deepEqual(Object.keys(counters).sort(), [
      'gumCalls',
      'micConstraintViolations',
      'streamsAdopted',
      'tracksStoppedByController',
      'urlsCreated',
      'urlsRevoked',
    ]);
    assert.ok(Object.isFrozen(counters), 'counters冻结');
  });
});
