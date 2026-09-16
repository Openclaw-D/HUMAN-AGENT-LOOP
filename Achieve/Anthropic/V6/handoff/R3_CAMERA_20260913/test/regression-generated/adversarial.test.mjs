// R2-B｜SA3 相机控制器对抗测试套件（adversarial）
// 任务口径：只测对抗路径，不测happy path；全部合成/虚拟依赖，绝不触真实设备。
// 覆盖：永不resolve超时/手动取消、getUserMedia与takePhoto与ImageCapture同步throw、
//       外部轨道ended（addEventListener与onended两种注册、我方stop不误报）、
//       慢decode竞态、dispose竞态、畸形返回值；每条用例交叉核对轨与URL资源。
// 被测：../../src/camera-controller.mjs（v0.2.0-r2-candidate，只读；与口径冲突时以真实代码为准）。
// 说明：本文件自建独立fake设施，不import其他测试文件的内部工具，避免耦合。
// 运行：cd V6/handoff/R2_CAMERA_20260913 && node --test test/adversarial.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CameraController, CAMERA_CONTROLLER_VERSION } from '../../src/camera-controller.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const flush = () => wait(15); // 等微任务链（decode→thumbnail→ingest）稳定

const FILE_BYTES = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const PHOTO_BYTES = Uint8Array.from({ length: 64 }, (_, i) => i * 2);
const THUMB_BYTES = Uint8Array.from([210, 211, 212, 213]);

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

// ---------- 假轨道 ----------
// options.legacy    ：无addEventListener，控制器应回退到onended属性注册
// options.endOnStop ：'sync'|'microtask'，stop()时自动派发ended（验证我方停轨不误报）
let trackSeq = 0;
function makeTrack(options = {}) {
  const listeners = [];
  const track = {
    id: `adv-track-${++trackSeq}`,
    kind: 'video',
    readyState: 'live',
    stopped: false,
    stopAttempts: 0,
    grabFrameCalls: 0,
    onended: null,
    stop() {
      track.stopAttempts += 1;
      const firstEnd = track.readyState !== 'ended';
      track.stopped = true;
      track.readyState = 'ended';
      if (firstEnd && options.endOnStop === 'sync') track.fireEnded();
      else if (firstEnd && options.endOnStop === 'microtask') queueMicrotask(() => track.fireEnded());
    },
    grabFrame() {
      track.grabFrameCalls += 1;
      return Promise.resolve(new Blob([new Uint8Array([9, 9])], { type: 'image/jpeg' }));
    },
  };
  if (!options.legacy) {
    track.addEventListener = (type, fn) => {
      if (type === 'ended' && typeof fn === 'function') listeners.push(fn);
    };
    track.removeEventListener = (type, fn) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }
  // 模拟设备/系统向页面派发ended（外部结束，非controller.stop）。
  track.fireEnded = () => {
    track.readyState = 'ended';
    const ev = { type: 'ended', target: track };
    for (const fn of [...listeners]) fn(ev);
    if (typeof track.onended === 'function') track.onended(ev);
  };
  return track;
}

function makeStream(trackOptions) {
  const track = makeTrack(trackOptions);
  const stream = {
    id: `adv-stream-${track.id}`,
    getVideoTracks: () => [track],
    getTracks: () => [track],
  };
  return { stream, track };
}

// getUserMedia结果由测试手动控制的假设备；throwOnCall=同步throw。
function makeManualMediaDevices(options = {}) {
  const devices = {
    calls: [],
    deferreds: [],
    getUserMedia(constraints) {
      devices.calls.push(constraints);
      if (options.throwOnCall) throw options.throwOnCall;
      const d = makeDeferred();
      d.paired = null;
      d.resolveStream = () => {
        if (!d.paired) d.paired = makeStream(options.trackOptions);
        d.resolve(d.paired.stream);
      };
      devices.deferreds.push(d);
      return d.promise;
    },
  };
  return devices;
}

// URL注册表：记录全部create/revoke，可交叉核对控制器自报口径。
function makeUrlRegistry() {
  const created = [];
  const revoked = [];
  let n = 0;
  return {
    created,
    revoked,
    createObjectURL() {
      const url = `blob:adv-${++n}`;
      created.push(url);
      return url;
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
    get liveCount() {
      return created.length - revoked.length;
    },
  };
}

// 可按blob挑拣"慢decode"的假解码器：shouldHold(blob)=true时挂起等待手动放行。
// 注意：返回值本身是可调用函数（直接作为decodeImageMetadata依赖注入），held/calls挂在函数属性上。
function makeSelectiveDecoder(shouldHold) {
  const held = [];
  const calls = [];
  const decode = (blob) => {
    calls.push(blob);
    if (!shouldHold(blob)) return Promise.resolve({ width: 11, height: 21 });
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

// takePhoto结果由测试手动控制的假ImageCapture。
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

// takePhoto同步throw的假ImageCapture。
class SyncThrowTakePhoto {
  constructor(track) {
    this.track = track;
  }
  takePhoto() {
    throw new Error('sensor sync failure');
  }
}

// ImageCapture构造函数同步throw的假实现。
class ThrowingImageCaptureConstructor {
  constructor() {
    throw new Error('ImageCapture constructor unavailable');
  }
}

function makeClock() {
  let t = 1000;
  return () => (t += 7);
}

function createHarness(opts = {}) {
  const registry = makeUrlRegistry();
  const events = { state: [], error: [], preview: [], stream: [] };
  const mediaDevices = opts.mediaDevices ?? makeManualMediaDevices(opts.deviceOptions);
  const controller = new CameraController({
    mediaDevices,
    ImageCapture: opts.ImageCapture ?? null,
    createObjectURL: registry.createObjectURL,
    revokeObjectURL: registry.revokeObjectURL,
    now: makeClock(),
    decodeImageMetadata: opts.decoder ?? (async () => ({ width: 10, height: 20 })),
    createThumbnail: opts.createThumbnail ?? fastThumbnail,
    isSecureContext: true,
    ...(opts.requestTimeoutMs !== undefined ? { requestTimeoutMs: opts.requestTimeoutMs } : {}),
    ...(opts.captureMode !== undefined ? { captureMode: opts.captureMode } : {}),
    onStateChange: (s) => events.state.push(s),
    onPreview: (p) => events.preview.push(p),
    onError: (e) => events.error.push(e),
    onStream: (s) => events.stream.push(s),
  });
  return { controller, registry, events, mediaDevices };
}

// 统一包装：断言失败也能兜底dispose，避免遗留45s默认定时器挂住测试进程。
async function withController(opts, fn) {
  const h = createHarness(opts);
  try {
    await fn(h);
  } finally {
    h.controller.dispose();
  }
}

function errorCodes(h) {
  return h.events.error.map((e) => e.code);
}

// 资源核对：控制器自报（getResourceUsage）与假注册表交叉一致、无重复撤销。
function checkResources(h, expectTracks, expectUrls, message = '') {
  const usage = h.controller.getResourceUsage();
  assert.equal(usage.liveTracks, expectTracks, `liveTracks期望${expectTracks}｜${message}`);
  assert.equal(usage.urlsHeld, expectUrls, `urlsHeld期望${expectUrls}｜${message}`);
  assert.equal(h.registry.liveCount, expectUrls, `假URL注册表活跃数应与控制器一致（${message}）`);
  assert.equal(new Set(h.registry.revoked).size, h.registry.revoked.length, 'URL不得被重复撤销');
  assert.ok(Object.isFrozen(usage), 'getResourceUsage返回冻结快照');
  return usage;
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

// ---------- 对抗0｜被测对象确认 ----------

test('对抗0｜被测版本为v0.2.0-r2-candidate，getUserMedia约束恒为audio:false', async () => {
  assert.equal(CAMERA_CONTROLLER_VERSION, '0.3.0-r3-candidate');
  await withController({}, async (h) => {
    h.controller.openFromUserGesture();
    assert.equal(h.mediaDevices.calls.length, 1);
    assert.equal(h.mediaDevices.calls[0].audio, false, '任何路径都不得申请麦克风');
    checkResources(h, 0, 0, '未交付流前无资源');
  });
});

// ---------- 对抗1｜getUserMedia永不resolve ----------

test('对抗1a｜requestTimeoutMs=25ms：永pending的gUM超时自动取消，迟到授权流立即停轨', async () => {
  await withController({ requestTimeoutMs: 25 }, async (h) => {
    const r = h.controller.openFromUserGesture();
    assert.equal(r.ok, true);
    assert.equal(h.controller.state, 'requesting');

    await wait(150); // > 25ms：等待超时定时器必然触发
    assert.equal(h.controller.state, 'idle', '超时后应回到idle');
    assert.deepEqual(errorCodes(h), ['REQUEST_TIMEOUT'], '应自动取消并报REQUEST_TIMEOUT');
    checkResources(h, 0, 0, '超时后无任何资源');

    // 超时后再手动取消：已不在requesting，应拒绝而非重复取消
    assert.deepEqual(h.controller.cancelRequest(), { ok: false, code: 'NOT_PENDING' });

    // 迟到的授权流：到货即停轨，无状态迁移、无新错误、无onStream
    const stateEventsBefore = h.events.state.length;
    const errorsBefore = h.events.error.length;
    h.mediaDevices.deferreds[0].resolveStream();
    await flush();
    const track = h.mediaDevices.deferreds[0].paired.track;
    assert.equal(track.stopped, true, '迟到授权流必须立即停轨');
    assert.equal(h.controller.state, 'idle', '迟到流不得改变状态');
    assert.equal(h.events.state.length, stateEventsBefore, '迟到流不得触发状态迁移');
    assert.equal(h.events.error.length, errorsBefore, '迟到流不得新增onError');
    assert.equal(h.events.stream.length, 0, '迟到流不得回调onStream');
    checkResources(h, 0, 0, '迟到流停轨后资源归零');
  });
});

test('对抗1b｜requestTimeoutMs=null：停留requesting不超时，手动cancelRequest后迟到流停轨', async () => {
  await withController({ requestTimeoutMs: null }, async (h) => {
    const r = h.controller.openFromUserGesture();
    assert.equal(r.ok, true);
    assert.equal(h.controller.state, 'requesting');

    await wait(60); // 若错误地启用了超时也会在此窗口内暴露（本用例超时值即60ms级）
    assert.equal(h.controller.state, 'requesting', 'null应禁用超时，停留requesting');
    assert.deepEqual(errorCodes(h), [], '不得出现REQUEST_TIMEOUT');

    assert.deepEqual(h.controller.cancelRequest(), { ok: true }, '手动取消应成功');
    assert.equal(h.controller.state, 'idle');

    // 迟到的授权流：停轨静默丢弃
    h.mediaDevices.deferreds[0].resolveStream();
    await flush();
    const track = h.mediaDevices.deferreds[0].paired.track;
    assert.equal(track.stopped, true, '取消后迟到流必须立即停轨');
    assert.equal(h.events.stream.length, 0, '取消后迟到流不得回调onStream');
    assert.deepEqual(errorCodes(h), [], '取消路径不得误报错误');
    assert.equal(h.controller.state, 'idle');
    checkResources(h, 0, 0, '取消+迟到流后资源归零');
  });
});

// ---------- 对抗2｜同步throw ----------

test('对抗2a｜getUserMedia同步throw NotAllowedError：denied/NOT_ALLOWED，不崩溃', async () => {
  const deniedErr = Object.assign(new Error('user denied'), { name: 'NotAllowedError' });
  await withController({ deviceOptions: { throwOnCall: deniedErr } }, async (h) => {
    const r = h.controller.openFromUserGesture();
    assert.deepEqual(r, { ok: false, code: 'NOT_ALLOWED' }, '同步throw应与异步失败同映射');
    assert.equal(h.controller.state, 'denied');
    assert.deepEqual(errorCodes(h), ['NOT_ALLOWED']);
    assert.equal(h.mediaDevices.calls.length, 1, '调用确实发生过（同步throw前）');
    assert.equal(h.events.stream.length, 0);
    checkResources(h, 0, 0, '同步throw不产生任何资源');
  });
});

test('对抗2b｜getUserMedia同步throw普通Error：error/GETUSERMEDIA_FAILED，不崩溃', async () => {
  await withController({ deviceOptions: { throwOnCall: new Error('boom') } }, async (h) => {
    const r = h.controller.openFromUserGesture();
    assert.deepEqual(r, { ok: false, code: 'GETUSERMEDIA_FAILED' });
    assert.equal(h.controller.state, 'error');
    assert.deepEqual(errorCodes(h), ['GETUSERMEDIA_FAILED']);
    checkResources(h, 0, 0, '同步throw不产生任何资源');
  });
});

test('对抗2c｜ImageCapture构造同步throw：IMAGECAPTURE_UNSUPPORTED+file_picker回退，grabFrame计数0', async () => {
  await withController({ ImageCapture: ThrowingImageCaptureConstructor }, async (h) => {
    const { stream, track } = await openToReady(h);

    const r = h.controller.capture();
    assert.deepEqual(
      r,
      { ok: false, code: 'IMAGECAPTURE_UNSUPPORTED', fallback: 'file_picker' },
      '构造throw应明确回退到系统选图',
    );
    assert.deepEqual(errorCodes(h), ['IMAGECAPTURE_UNSUPPORTED']);
    assert.equal(h.events.error[0].fallbackHint, 'file_picker', '错误应携带file_picker回退提示');
    assert.equal(track.grabFrameCalls, 0, '绝不允许grabFrame截帧冒充takePhoto');
    assert.equal(h.controller.state, 'ready', '未进入takePhoto阶段，状态保持ready（如实断言实现行为）');
    assert.deepEqual(h.events.stream, [stream], '流保留，供用户改走选图回退');
    checkResources(h, 1, 0, '回退场景流仍在，无URL');
  });
});

test('对抗2d-single｜takePhoto同步throw（默认单拍模式）：CAPTURE_FAILED，轨已停+onStream(null)', async () => {
  await withController({ ImageCapture: SyncThrowTakePhoto }, async (h) => {
    const { stream, track } = await openToReady(h);

    const r = h.controller.capture();
    assert.deepEqual(r, { ok: false, code: 'CAPTURE_FAILED' });
    assert.equal(h.controller.state, 'error');
    assert.deepEqual(errorCodes(h), ['CAPTURE_FAILED']);
    assert.deepEqual(h.events.stream, [stream, null], 'single模式失败必须关轨并通知onStream(null)');
    assert.equal(track.stopped, true, 'single模式失败必须停轨');
    checkResources(h, 0, 0, '失败关轨后资源归零');
  });
});

test('对抗2d-continuous｜takePhoto同步throw（显式连续模式）：CAPTURE_FAILED，轨保留', async () => {
  await withController({ ImageCapture: SyncThrowTakePhoto, captureMode: 'continuous' }, async (h) => {
    const { stream, track } = await openToReady(h);

    const r = h.controller.capture();
    assert.deepEqual(r, { ok: false, code: 'CAPTURE_FAILED' });
    assert.equal(h.controller.state, 'error');
    assert.deepEqual(errorCodes(h), ['CAPTURE_FAILED']);
    assert.deepEqual(h.events.stream, [stream], 'continuous模式失败保留流，可重试');
    assert.equal(track.stopped, false, 'continuous模式失败不得停轨');
    checkResources(h, 1, 0, 'continuous失败后流保留');
  });
});

// ---------- 对抗3｜外部轨道结束 ----------

test('对抗3a｜addEventListener注册的轨道外部ended：TRACK_ENDED+onStream(null)+idle', async () => {
  await withController({}, async (h) => {
    const { stream, track } = await openToReady(h);
    assert.deepEqual(h.events.stream, [stream]);

    track.fireEnded(); // 模拟设备断开/系统回收
    assert.equal(h.controller.state, 'idle');
    assert.deepEqual(errorCodes(h), ['TRACK_ENDED'], '外部结束必须明确报错');
    assert.deepEqual(h.events.stream, [stream, null], '必须通知页面清空video');
    checkResources(h, 0, 0, '外部结束引用清空');
  });
});

test('对抗3b｜onended属性注册（legacy轨道无addEventListener）外部ended：同样TRACK_ENDED', async () => {
  await withController({ deviceOptions: { trackOptions: { legacy: true } } }, async (h) => {
    const { stream, track } = await openToReady(h);
    assert.equal(typeof track.addEventListener, 'undefined', '前置：legacy轨道确实没有addEventListener');
    assert.equal(typeof track.onended, 'function', '控制器应回退到onended属性注册');

    track.fireEnded();
    assert.equal(h.controller.state, 'idle');
    assert.deepEqual(errorCodes(h), ['TRACK_ENDED']);
    assert.deepEqual(h.events.stream, [stream, null]);
    checkResources(h, 0, 0, '外部结束引用清空');
  });
});

test('对抗3c｜有预览时外部ended：state=preview且hasLiveStream=false', async () => {
  await withController({}, async (h) => {
    const file = makeFile();
    const rFile = await h.controller.acceptFile(file);
    assert.equal(rFile.ok, true);
    assert.equal(h.controller.state, 'preview');
    checkResources(h, 0, 2, '预览占用原图+缩略图两个URL');

    const { stream, track } = await openToReady(h);
    assert.equal(h.controller.state, 'ready');

    track.fireEnded();
    assert.equal(h.controller.state, 'preview', '有预览时外部结束回到preview');
    const snapshot = h.controller.getSnapshot();
    assert.equal(snapshot.hasLiveStream, false, '预览态下流已不在');
    assert.deepEqual(errorCodes(h), ['TRACK_ENDED']);
    assert.deepEqual(h.events.stream, [stream, null]);
    assert.equal(h.controller.getPreview().blob, file, '预览不受流结束影响');
    checkResources(h, 0, 2, '流结束但预览URL仍合法持有');
  });
});

test('对抗3d-1｜我方closeStream（stop同步派发ended）不得误报TRACK_ENDED', async () => {
  await withController({ deviceOptions: { trackOptions: { endOnStop: 'sync' } } }, async (h) => {
    const { stream } = await openToReady(h);

    const r = h.controller.closeStream();
    assert.deepEqual(r, { ok: true });
    assert.equal(h.controller.state, 'idle');
    assert.deepEqual(errorCodes(h), [], '我方主动关轨绝不得误报TRACK_ENDED');
    assert.deepEqual(h.events.stream, [stream, null], '关轨恰好通知一次onStream(null)');
    await flush(); // 同步派发已在stop窗口内被_expectTrackEnd吸收
    assert.deepEqual(errorCodes(h), [], 'flush后仍无误报');
    checkResources(h, 0, 0, '关轨后资源归零');
  });
});

test('对抗3d-2｜我方closeStream（stop微任务派发ended）不得误报TRACK_ENDED', async () => {
  await withController({ deviceOptions: { trackOptions: { endOnStop: 'microtask' } } }, async (h) => {
    const { stream } = await openToReady(h);

    const r = h.controller.closeStream();
    assert.deepEqual(r, { ok: true });
    await flush(); // 微任务期派发的ended由"当前轨道引用"判别兜底
    assert.equal(h.controller.state, 'idle');
    assert.deepEqual(errorCodes(h), [], '异步派发的ended也不得误报');
    assert.deepEqual(h.events.stream, [stream, null], '不得出现第二次onStream(null)');
    checkResources(h, 0, 0, '关轨后资源归零');
  });
});

test('对抗3e｜我方dispose（stop同步/微任务派发ended两种轨道）不得误报TRACK_ENDED', async () => {
  // 同步派发变体
  await withController({ deviceOptions: { trackOptions: { endOnStop: 'sync' } } }, async (h) => {
    const { stream } = await openToReady(h);
    const r = h.controller.dispose();
    assert.deepEqual(r, { ok: true, code: 'DISPOSED' });
    await flush();
    assert.deepEqual(errorCodes(h), [], 'dispose不得误报TRACK_ENDED');
    assert.deepEqual(h.events.stream, [stream, null]);
    assert.equal(h.controller.state, 'disposed');
    checkResources(h, 0, 0, 'dispose后资源归零');
  });
  // 微任务派发变体
  await withController({ deviceOptions: { trackOptions: { endOnStop: 'microtask' } } }, async (h) => {
    const { stream } = await openToReady(h);
    h.controller.dispose();
    await flush();
    assert.deepEqual(errorCodes(h), [], 'dispose后异步派发的ended也不得误报');
    assert.deepEqual(h.events.stream, [stream, null]);
    checkResources(h, 0, 0, 'dispose后资源归零');
  });
});

// ---------- 对抗4｜decode慢返回 ----------

test('对抗4a｜慢decode(A)被快decode(B)超越：只交付B；A迟到resolve后无A预览、URL仅B一组', async () => {
  const fileA = makeFile();
  const fileB = makeFile();
  const decoder = makeSelectiveDecoder((blob) => blob === fileA);
  await withController({ decoder }, async (h) => {
    const pA = h.controller.acceptFile(fileA); // 慢：decode挂起，未await
    assert.equal(decoder.held.length, 1);
    assert.equal(decoder.held[0].blob, fileA);

    const rB = await h.controller.acceptFile(fileB); // 快：直接完成
    assert.equal(rB.ok, true, '后选文件应正常交付');
    assert.equal(h.controller.getPreview().blob, fileB, '当前预览是B');
    assert.deepEqual(h.events.preview.map((p) => p.blob), [fileB], '只交付B的onPreview');
    checkResources(h, 0, 2, 'B交付：原图+缩略图共2个URL');

    // 放行A的decode：ingest在seq判别处终止，不得创建URL/交付预览（先放行再await，避免挂起）
    decoder.held[0].resolve({ width: 1, height: 1 });
    const rA = await pA;
    assert.deepEqual(rA, { ok: false, code: 'SUPERSEDED' }, '被超越的A应返回SUPERSEDED');
    assert.deepEqual(h.events.preview.map((p) => p.blob), [fileB], 'A迟到后仍只有B预览');
    checkResources(h, 0, 2, 'A未创建任何URL');

    await flush(); // 兜底等待A的ingest残余微任务
    assert.equal(h.controller.getPreview().blob, fileB, '放行A后预览仍是B');
    assert.deepEqual(h.events.preview.map((p) => p.blob), [fileB]);
    checkResources(h, 0, 2, 'A的迟到decode不产生URL');
  });
});

test('对抗4b｜慢decode期间dispose：resolve后无onPreview、URL归0、无状态迁移', async () => {
  const fileC = makeFile();
  const decoder = makeSelectiveDecoder(() => true);
  await withController({ decoder }, async (h) => {
    const pC = h.controller.acceptFile(fileC);
    assert.equal(decoder.held.length, 1);

    const stateEventsBeforeDispose = h.events.state.length;
    const rDispose = h.controller.dispose();
    assert.deepEqual(rDispose, { ok: true, code: 'DISPOSED' });
    assert.equal(h.controller.state, 'disposed');
    checkResources(h, 0, 0, 'dispose即时清账（尚未创建URL）');

    decoder.held[0].resolve({ width: 3, height: 3 });
    const rC = await pC;
    assert.deepEqual(rC, { ok: false, code: 'SUPERSEDED' }, 'dispose后ingest不得再建URL');
    assert.equal(h.events.preview.length, 0, 'dispose后迟到decode不得交付预览');
    assert.equal(h.events.state.length, stateEventsBeforeDispose + 1, 'dispose之后不得再有任何状态迁移');
    assert.equal(h.controller.state, 'disposed');
    checkResources(h, 0, 0, '迟到resolve后仍为0');
  });
});

test('对抗4c｜capture在途时acceptFile：takePhoto迟到结果丢弃、文件预览交付（如实核对single轨清理路径）', async () => {
  const { cls, instances } = makeManualImageCaptureClass();
  const fileF = makeFile();
  await withController({ ImageCapture: cls }, async (h) => {
    const { stream, track } = await openToReady(h);

    const rCap = h.controller.capture();
    assert.equal(rCap.ok, true);
    assert.equal(h.controller.state, 'capturing');
    assert.equal(instances.length, 1);

    // 文件选择使在途takePhoto作废
    const rFile = await h.controller.acceptFile(fileF);
    assert.equal(rFile.ok, true, 'acceptFile应正常交付');
    assert.equal(h.controller.state, 'preview');
    assert.deepEqual(h.events.preview.map((p) => p.blob), [fileF]);
    checkResources(h, 1, 2, '文件交付时摄像头流尚未被主动关闭');

    // 迟到的takePhoto结果：直接丢弃，不建URL、不交付预览
    instances[0].pending.resolve(makePhotoBlob());
    await flush();
    assert.deepEqual(h.events.preview.map((p) => p.blob), [fileF], '迟到照片不得覆盖/追加预览');
    assert.equal(h.registry.created.length, 2, '迟到照片不得创建URL');
    assert.equal(h.controller.state, 'preview');

    // 如实断言single模式实际行为：被acceptFile作废的takePhoto迟到结果不会触发关轨
    // （v0.1.0"acceptFile使在途takePhoto作废"语义优先，残留流需显式closeStream/dispose释放）。
    assert.equal(track.stopped, false, '实际行为：迟到照片被丢弃时轨未自动停');
    assert.equal(h.controller.getResourceUsage().liveTracks, 1, '实际行为：流仍存活');

    // 残留流经closeStream显式释放
    const rClose = h.controller.closeStream();
    assert.deepEqual(rClose, { ok: true });
    assert.equal(track.stopped, true, 'closeStream应停掉残留流');
    assert.equal(h.controller.state, 'preview', '有预览时关流回到preview');
    assert.deepEqual(h.events.stream, [stream, null]);
    assert.deepEqual(errorCodes(h), [], '整条竞态链不得误报错误');
    checkResources(h, 0, 2, '流清零，文件预览URL保留');
  });
});

// ---------- 对抗5｜dispose竞态 ----------

test('对抗5a｜requesting中dispose：迟到resolve静默停轨，无事件、无状态迁移、注册表0', async () => {
  await withController({}, async (h) => {
    const r = h.controller.openFromUserGesture();
    assert.equal(r.ok, true);
    assert.equal(h.controller.state, 'requesting');

    const rDispose = h.controller.dispose();
    assert.deepEqual(rDispose, { ok: true, code: 'DISPOSED' });
    assert.deepEqual(errorCodes(h), []);
    const stateEventsAfterDispose = h.events.state.length;
    const streamEventsAfterDispose = h.events.stream.length;

    h.mediaDevices.deferreds[0].resolveStream();
    await flush();
    const track = h.mediaDevices.deferreds[0].paired.track;
    assert.equal(track.stopped, true, '迟到授权流必须被停轨');
    assert.equal(h.events.state.length, stateEventsAfterDispose, '不得有新状态迁移');
    assert.equal(h.events.stream.length, streamEventsAfterDispose, '不得有新onStream');
    assert.deepEqual(errorCodes(h), []);
    assert.equal(h.controller.state, 'disposed');
    checkResources(h, 0, 0, '迟到resolve后注册表与轨全零');
  });
});

test('对抗5a2｜requesting中dispose：迟到reject静默，无新onError', async () => {
  await withController({}, async (h) => {
    const r = h.controller.openFromUserGesture();
    assert.equal(r.ok, true);
    h.controller.dispose();
    const errorsAfterDispose = h.events.error.length;

    h.mediaDevices.deferreds[0].reject(Object.assign(new Error('late failure'), { name: 'NotReadableError' }));
    await flush();
    assert.equal(h.events.error.length, errorsAfterDispose, '迟到reject不得新抛onError');
    assert.equal(h.controller.state, 'disposed');
    checkResources(h, 0, 0, '无资源');
  });
});

test('对抗5b｜capturing中dispose：迟到照片resolve/reject/外部ended全部静默', async () => {
  // resolve变体
  const cap1 = makeManualImageCaptureClass();
  await withController({ ImageCapture: cap1.cls }, async (h) => {
    await openToReady(h);
    const rCap = h.controller.capture();
    assert.equal(rCap.ok, true);
    h.controller.dispose();
    const countsAtDispose = {
      state: h.events.state.length,
      error: h.events.error.length,
      preview: h.events.preview.length,
      stream: h.events.stream.length,
    };
    assert.equal(h.events.stream[countsAtDispose.stream - 1], null, 'dispose已通知清空video');

    cap1.instances[0].pending.resolve(makePhotoBlob());
    await flush();
    assert.equal(h.events.preview.length, countsAtDispose.preview, '迟到照片不得产生onPreview');
    assert.equal(h.events.state.length, countsAtDispose.state, '不得有新状态迁移');
    assert.equal(h.events.error.length, countsAtDispose.error, '不得有新onError');
    checkResources(h, 0, 0, '迟到照片未建任何URL');
  });

  // reject + 外部ended变体
  const cap2 = makeManualImageCaptureClass();
  await withController({ ImageCapture: cap2.cls }, async (h) => {
    const { track } = await openToReady(h);
    const rCap = h.controller.capture();
    assert.equal(rCap.ok, true);
    h.controller.dispose();
    const countsAtDispose = {
      state: h.events.state.length,
      error: h.events.error.length,
      stream: h.events.stream.length,
    };

    cap2.instances[0].pending.reject(new Error('late sensor failure'));
    await flush();
    assert.equal(h.events.error.length, countsAtDispose.error, '迟到reject不得新抛onError');

    track.fireEnded(); // dispose后外部ended：必须静默
    await flush();
    assert.equal(h.events.error.length, countsAtDispose.error, 'dispose后ended不得误报TRACK_ENDED');
    assert.equal(h.events.state.length, countsAtDispose.state, 'ended不得触发状态迁移');
    assert.equal(h.events.stream.length, countsAtDispose.stream, 'ended不得再次onStream(null)');
    assert.equal(h.controller.state, 'disposed');
    checkResources(h, 0, 0, '全零');
  });
});

test('对抗5d｜dispose后所有方法返回DISPOSED或幂等，二次dispose无新增事件', async () => {
  await withController({}, async (h) => {
    const c = h.controller;
    const rDispose = c.dispose();
    assert.deepEqual(rDispose, { ok: true, code: 'DISPOSED' });
    const stateEventsAtDispose = h.events.state.length;

    assert.deepEqual(c.openFromUserGesture(), { ok: false, code: 'DISPOSED' });
    assert.deepEqual(c.cancelRequest(), { ok: false, code: 'DISPOSED' });
    assert.deepEqual(c.capture(), { ok: false, code: 'DISPOSED' });
    assert.deepEqual(c.closeStream(), { ok: false, code: 'DISPOSED' });
    assert.deepEqual(c.switchCamera(), { ok: false, code: 'DISPOSED' });
    const rFile = await c.acceptFile(makeFile());
    assert.deepEqual(rFile, { ok: false, code: 'DISPOSED' });

    assert.deepEqual(errorCodes(h), [], 'dispose后一切调用不得新抛onError');
    assert.equal(h.events.preview.length, 0);
    assert.deepEqual(c.getResourceUsage(), {
      state: 'disposed',
      captureMode: 'single',
      liveTracks: 0,
      urlsHeld: 0,
    });

    const rSecond = c.dispose();
    assert.deepEqual(rSecond, { ok: true, code: 'DISPOSED' }, '二次dispose幂等');
    assert.equal(h.events.state.length, stateEventsAtDispose, '二次dispose不得新增onStateChange');
    checkResources(h, 0, 0, '保持全零');
  });
});

// ---------- 对抗6｜畸形返回 ----------

// 畸形takePhoto返回值的统一断言：CAPTURE_FAILED、无预览、关轨、零URL。
async function assertMalformedTakePhoto(label, value) {
  const { cls, instances } = makeManualImageCaptureClass();
  await withController({ ImageCapture: cls }, async (h) => {
    const { stream, track } = await openToReady(h);

    const rCap = h.controller.capture();
    assert.equal(rCap.ok, true);
    instances[0].pending.resolve(value);
    await flush();

    assert.equal(h.controller.state, 'error', `畸形值${label}应落入error态`);
    assert.deepEqual(errorCodes(h), ['CAPTURE_FAILED'], `畸形值${label}应报CAPTURE_FAILED`);
    assert.equal(h.events.preview.length, 0, '畸形值不得生成预览');
    assert.deepEqual(h.events.stream, [stream, null], 'single模式失败关轨并onStream(null)');
    assert.equal(track.stopped, true);
    assert.equal(h.registry.created.length, 0, '畸形值不得创建URL');
    checkResources(h, 0, 0, `畸形值${label}资源归零`);
  });
}

test('对抗6a｜takePhoto resolve字符串：CAPTURE_FAILED并关轨', async () => {
  await assertMalformedTakePhoto('字符串', 'not-a-blob');
});

test('对抗6b｜takePhoto resolve undefined：CAPTURE_FAILED并关轨', async () => {
  await assertMalformedTakePhoto('undefined', undefined);
});

test('对抗6c｜takePhoto resolve null：CAPTURE_FAILED并关轨', async () => {
  await assertMalformedTakePhoto('null', null);
});

test('对抗6d｜takePhoto resolve空Blob(size=0)：CAPTURE_FAILED并关轨', async () => {
  await assertMalformedTakePhoto('空Blob(size=0)', new Blob([], { type: 'image/jpeg' }));
});

test('对抗6e｜acceptFile收到缺arrayBuffer的伪Blob对象：NOT_AN_IMAGE，decode未被调用', async () => {
  const decoder = makeSelectiveDecoder(() => false);
  await withController({ decoder }, async (h) => {
    const pseudoBlob = { size: 10, type: 'image/png' }; // 缺arrayBuffer：不是合法Blob
    const r = await h.controller.acceptFile(pseudoBlob);
    assert.deepEqual(r, { ok: false, code: 'NOT_AN_IMAGE' });
    assert.deepEqual(errorCodes(h), ['NOT_AN_IMAGE']);
    assert.equal(decoder.calls.length, 0, '非法入参不得进入解码');
    assert.equal(h.events.preview.length, 0);
    assert.equal(h.controller.state, 'idle', '入参校验失败不改变状态');
    checkResources(h, 0, 0, '非法入参零资源');
  });
});
