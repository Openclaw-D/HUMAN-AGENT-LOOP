// R2-B｜SA6 压力循环测试套件（stress loop｜工作包6）
// 任务口径（V6/ZCODE_GOAL_B_TO_0700_20260913.md 工作包6 + SA6任务书）：
//   固定seed伪随机压力循环≥40轮，累计统计与终局审计；各路径必须实际发生
//   （开流/拍照/选图/换图/关流/取消/作废/mid-op dispose），不以循环次数替代覆盖。
// 全程累计不变量：
//   (a) 任何时刻被采纳的存活流≤1；(b) 每条曾创建的fake track终局stopped/ended；
//   (c) URL注册表终局为0且任意时刻≤2组(4个)；(d) 全部getUserMedia的constraints.audio恒false；
//   (e) fetch/XHR上传探针全程0（逐轮包裹恢复）；(f) 操作返回码全在预定义合法集合内、
//   unhandledRejection计0。
// 确定性复核：同seed重跑，操作序列与每步{op,ok,code}结果摘要deepEqual完全一致。
// 方法：mulberry32固定seed PRNG驱动操作池与故障注入；全部合成Blob与虚拟设备；
//   无浏览器、无真实设备、无网络、无新依赖。
// 被测：../../src/camera-controller.mjs（v0.2.0-r2-candidate）。
// 运行：cd V6/handoff/R2_CAMERA_20260913 && node --test test/stress-loop.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { CameraController, CAMERA_CONTROLLER_VERSION } from '../../src/camera-controller.mjs';

// ---------- 常量与PRNG ----------

// seed=20260913：任务执行日期（2026-09-13），固定以保证操作序列与结果可复现。
const STRESS_SEED = 20260913;
const ROUNDS = 42; // 任务书要求≥40轮
const CAPTURE_FAIL_RATE = 0.1; // takePhoto注入失败率10%（任务书口径）
const DISPOSE_RATE = 0.1; // 每步之后mid-op dispose+重建概率10%（任务书口径）
const SLOW_TICKS = 3; // 慢落定延迟宏任务hop数：open/takePhoto被规划为慢落定时保持requesting/capturing在途窗口

// mulberry32：可复现伪随机数发生器（确定性、无外部依赖）。
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 全局核算（跨两次run + 专项） ----------

const UNHANDLED_REJECTIONS = [];
process.on('unhandledRejection', (reason) => {
  UNHANDLED_REJECTIONS.push(reason instanceof Error ? reason.message : String(reason));
});

let UPLOAD_TOTAL = 0; // 全部场景上传探针命中总数
const ALL_WORLDS = []; // 终局审计用

// ---------- 假设施 ----------

const THUMB_BYTES = Uint8Array.from([200, 201, 202, 203, 204, 205, 206, 207]);
// ≥5个预生成的不同合成Blob池（这里7个：字节数、内容、mime互不相同）。
const FILE_POOL = Array.from({ length: 7 }, (_, i) => {
  const len = 24 + i * 16;
  const bytes = Uint8Array.from({ length: len }, (_, k) => (k * (i + 2) + i * 5) % 251);
  return new Blob([bytes], { type: i % 2 === 0 ? 'image/jpeg' : 'image/png' });
});

// 上传探针：包裹 globalThis.fetch / XMLHttpRequest.prototype.open，只记录不转发，
// fetch返回永不落定的promise——绝不发起真实网络请求。结束后恢复并断言0命中。
async function withUploadProbe(world, name, fn) {
  const calls = [];
  const origFetch = globalThis.fetch;
  const origXhrOpen = globalThis.XMLHttpRequest?.prototype?.open;
  globalThis.fetch = function stressUploadProbeFetch(...args) {
    calls.push(`fetch(${String(args[0])})`);
    return new Promise(() => {});
  };
  if (origXhrOpen) {
    globalThis.XMLHttpRequest.prototype.open = function stressUploadProbeOpen(...args) {
      calls.push(`xhr.open(${String(args[0])} ${String(args[1])})`);
    };
  }
  try {
    return await fn();
  } finally {
    if (origFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = origFetch;
    if (origXhrOpen) globalThis.XMLHttpRequest.prototype.open = origXhrOpen;
    world.stats.uploadCalls += calls.length;
    UPLOAD_TOTAL += calls.length;
    assert.equal(calls.length, 0, `压力轮「${name}」出现上传尝试：${calls.join(' | ')}`);
  }
}

function createWorld(rng) {
  const tracks = []; // 本run曾创建的每一条fake track（终局审计对象）
  const gumCalls = []; // 每一次getUserMedia的完整constraints
  const urlMap = new Map(); // objectURL注册表
  const adopted = new Set(); // 已被控制器采纳且尚未确认释放的track
  const handlerFailures = []; // 事件回调内断言失败（避免变成unhandledRejection）
  const events = { previews: [], errors: [], states: [], streams: [] };
  const stats = {
    ops: 0,
    adoptions: 0,
    liveSamples: [], // 每次采纳时的存活流计数
    invalidateDuringRequesting: 0,
    invalidateDuringCapturing: 0,
    midDispose: 0,
    acceptOk: 0,
    cancelNotPending: 0,
    uploadCalls: 0,
  };
  let urlPeak = 0;
  let urlSeq = 0;
  let trackSeq = 0;
  let streamSeq = 0;
  let gumTicks = 0; // >0：getUserMedia延迟N个宏任务hop后落定（requesting在途窗口）
  let photoTicks = 0; // >0：takePhoto延迟N个宏任务hop后落定（capturing在途窗口）

  function noteUrls() {
    if (urlMap.size > urlPeak) urlPeak = urlMap.size;
  }

  function makeTrack() {
    const track = {
      id: `stress-track-${++trackSeq}`,
      kind: 'video',
      label: 'stress-fake-camera',
      enabled: true,
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
    tracks.push(track);
    return track;
  }

  function makeStream() {
    const track = makeTrack();
    const stream = {
      id: `stress-stream-${++streamSeq}`,
      getVideoTracks: () => [track],
      getTracks: () => [track],
    };
    return { stream, track };
  }

  // 延迟N个宏任务hop后用make()构造值并resolve（0=立即）。
  function afterTicks(ticks, make) {
    if (ticks <= 0) return Promise.resolve(make());
    return new Promise((resolve) => {
      let n = 0;
      const step = () => {
        n += 1;
        if (n >= ticks) resolve(make());
        else setTimeout(step, 0);
      };
      setTimeout(step, 0);
    });
  }

  const mediaDevices = {
    getUserMedia(constraints) {
      gumCalls.push(constraints);
      return afterTicks(gumTicks, () => makeStream().stream);
    },
  };

  const registry = {
    createObjectURL() {
      const url = `blob:stress-${++urlSeq}`;
      urlMap.set(url, true);
      noteUrls();
      return url;
    },
    revokeObjectURL(url) {
      urlMap.delete(url);
      noteUrls();
    },
  };

  const clock = (() => {
    let t = 9000;
    return () => (t += 11);
  })();

  const world = {
    rng,
    tracks,
    gumCalls,
    urlMap,
    adopted,
    handlerFailures,
    events,
    stats,
    mediaDevices,
    registry,
    clock,
    // 慢落定开关必须路由到闭包变量（getUserMedia/takePhoto在调用时刻读取）
    get gumTicks() {
      return gumTicks;
    },
    set gumTicks(v) {
      gumTicks = v;
    },
    get photoTicks() {
      return photoTicks;
    },
    set photoTicks(v) {
      photoTicks = v;
    },
    get urlPeak() {
      return urlPeak;
    },
    liveCount() {
      let n = 0;
      for (const t of adopted) if (!(t.stopped || t.readyState === 'ended')) n += 1;
      return n;
    },
    // 不变量(a)的唯一观测点：onStream(流)即采纳，onStream(null)即释放确认。
    onStreamValue(stream) {
      if (stream) {
        for (const t of adopted) {
          assert.ok(
            t.stopped || t.readyState === 'ended',
            `不变量(a)：采纳新流时旧被采纳track未释放（${t.id}）`,
          );
        }
        adopted.add(stream.getVideoTracks()[0]);
        stats.adoptions += 1;
        stats.liveSamples.push(world.liveCount());
        assert.ok(adopted.size <= 1, `不变量(a)：被采纳流集合>1（${adopted.size}）`);
      } else {
        for (const t of [...adopted]) if (t.stopped || t.readyState === 'ended') adopted.delete(t);
        assert.equal(adopted.size, 0, 'onStream(null)后仍有未释放的被采纳track');
      }
    },
    tickOnce: () => new Promise((resolve) => setTimeout(resolve, 0)),
    async flushx() {
      for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };

  class FakeImageCapture {
    constructor(track) {
      this.track = track;
    }
    takePhoto() {
      const fail = rng() < CAPTURE_FAIL_RATE; // 10%注入失败；draw顺序确定→可复现
      const make = () =>
        new Blob([Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 254)], { type: 'image/jpeg' });
      if (fail) return Promise.reject(Object.assign(new Error('stress sensor failure'), { name: 'SensorStressError' }));
      return photoTicks > 0 ? afterTicks(photoTicks, make) : Promise.resolve(make());
    }
  }
  world.FakeImageCapture = FakeImageCapture;
  ALL_WORLDS.push(world);
  return world;
}

function buildController(world) {
  return new CameraController({
    mediaDevices: world.mediaDevices,
    ImageCapture: world.FakeImageCapture,
    createObjectURL: world.registry.createObjectURL,
    revokeObjectURL: world.registry.revokeObjectURL,
    now: world.clock,
    decodeImageMetadata: async () => ({ width: 4000, height: 3000 }),
    createThumbnail: async () => ({ blob: new Blob([THUMB_BYTES], { type: 'image/jpeg' }), width: 64, height: 48 }),
    isSecureContext: true,
    onStateChange: (s) => {
      world.events.states.push(s.state);
    },
    onPreview: (p) => {
      world.events.previews.push(p);
    },
    onError: (e) => {
      world.events.errors.push(e);
    },
    onStream: (s) => {
      // 回调内断言失败不能变成unhandledRejection：先记录，步骤末统一断言。
      try {
        world.onStreamValue(s);
      } catch (err) {
        world.handlerFailures.push(err);
      }
    },
    // requestTimeoutMs保持默认45s：本套件所有请求都会落定或被取消/dispose清除，定时器不会触发。
  });
}

// ---------- 操作池与合法返回码 ----------

// 每类操作的全部合法返回码（f：任何返回值必须落在集合内）。
const LEGAL_CODES = {
  open: {
    okCode: 'OK',
    fail: ['DISPOSED', 'ALREADY_PENDING', 'ALREADY_OPEN', 'UNSUPPORTED', 'NOT_ALLOWED', 'NO_DEVICE', 'DEVICE_BUSY', 'DEVICE_ABORTED', 'GETUSERMEDIA_FAILED'],
  },
  capture: {
    okCode: 'OK',
    fail: ['DISPOSED', 'CAPTURE_IN_PROGRESS', 'NO_STREAM', 'IMAGECAPTURE_UNSUPPORTED', 'CAPTURE_FAILED'],
  },
  accept: { okCode: 'OK', fail: ['DISPOSED', 'NOT_AN_IMAGE', 'EMPTY_FILE', 'SUPERSEDED', 'PREVIEW_BUILD_FAILED'] },
  invalidate: { okCode: 'OK', fail: ['DISPOSED', 'NOT_AN_IMAGE', 'EMPTY_FILE', 'SUPERSEDED', 'PREVIEW_BUILD_FAILED'] },
  close: { okCode: 'OK', fail: ['DISPOSED', 'CAPTURE_IN_PROGRESS', 'NO_STREAM'] },
  cancel: { okCode: 'OK', fail: ['DISPOSED', 'NOT_PENDING'] },
  dispose: { okCode: 'DISPOSED', fail: [] },
};

const norm = (op, r) => ({ op, ok: r?.ok === true, code: r?.code ?? (r?.ok ? 'OK' : '<missing>') });

const OPERATIONS = {
  // 开流（默认约束）。step.slow=true时慢落定：保持requesting在途窗口给后续作废/取消。
  async open(world, ctl, step) {
    world.gumTicks = step.slow ? SLOW_TICKS : 0;
    const r = ctl.openFromUserGesture();
    if (step.slow && r.ok) await world.tickOnce();
    else await world.flushx();
    return norm('open', r);
  },
  // 拍照（takePhoto合成Blob，10%注入失败）。step.slow=true时慢落定：保持capturing在途窗口。
  async capture(world, ctl, step) {
    world.photoTicks = step.slow ? SLOW_TICKS : 0;
    const r = ctl.capture();
    if (step.slow && r.ok) await world.tickOnce();
    else await world.flushx();
    return norm('capture', r);
  },
  // 普通选图（从预生成池抽取）。
  accept(world, ctl) {
    return acceptLike(world, ctl, 'accept');
  },
  // 作废插入：在requesting/capturing在途时acceptFile使在途open/capture作废。
  invalidate(world, ctl) {
    return acceptLike(world, ctl, 'invalidate');
  },
  async close(world, ctl) {
    const r = ctl.closeStream();
    await world.flushx();
    return norm('close', r);
  },
  async cancel(world, ctl) {
    const r = ctl.cancelRequest();
    if (!r.ok) {
      // 无效态必须精确返回NOT_PENDING/DISPOSED（任务书口径）
      assert.ok(r.code === 'NOT_PENDING' || r.code === 'DISPOSED', `cancelRequest无效态返回码必须为NOT_PENDING/DISPOSED，实际${r.code}`);
      if (r.code === 'NOT_PENDING') world.stats.cancelNotPending += 1;
    }
    await world.flushx();
    return norm('cancel', r);
  },
};

async function acceptLike(world, ctl, opName) {
  const stateBefore = ctl.state;
  if (opName === 'invalidate') {
    if (stateBefore === 'requesting') world.stats.invalidateDuringRequesting += 1;
    if (stateBefore === 'capturing') world.stats.invalidateDuringCapturing += 1;
  }
  const blob = FILE_POOL[Math.floor(world.rng() * FILE_POOL.length)];
  const r = await ctl.acceptFile(blob);
  await world.flushx();
  if (r.ok) {
    world.stats.acceptOk += 1;
    // 原件字节不变：preview.blob与输入池Blob逐字节一致、mime一致
    const loaded = new Uint8Array(await r.preview.blob.arrayBuffer());
    const src = new Uint8Array(await blob.arrayBuffer());
    assert.equal(Buffer.compare(Buffer.from(loaded), Buffer.from(src)), 0, `${opName}: preview.blob字节与输入不一致`);
    assert.equal(r.preview.mime, blob.type, `${opName}: preview.mime与输入type不一致`);
    assert.deepEqual(r.preview.warnings, [...r.preview.warnings], 'warnings必须可枚举');
    assert.equal(ctl.getPreview()?.id, r.preview.id, `${opName}: 当前预览应为本次交付`);
    assert.ok(world.urlMap.size <= 2, `${opName}: accept成功后注册表不得超过一组(2个)URL`);
  } else if (r.code === 'SUPERSEDED') {
    // 被更新的acceptFile超越：合法失败码
  }
  return norm(opName, r);
}

// ---------- 压力轮次规划 ----------

function planRounds(rng) {
  const POOL = ['open', 'capture', 'accept', 'close', 'cancel', 'invalidate'];
  const rounds = [];
  for (let i = 0; i < ROUNDS; i += 1) {
    const n = 1 + Math.floor(rng() * 3); // 每轮1..3个操作
    const ops = [];
    for (let j = 0; j < n; j += 1) ops.push({ op: POOL[Math.floor(rng() * POOL.length)], slow: false });
    // 特意插入作废并配对慢落定，保证在途作废路径被实际执行：
    // - open后有后继且后继不是capture：插入invalidate并强制open慢落定
    //   → invalidate必然在requesting中作废未决请求；
    // - capture后有后继：插入invalidate并强制capture慢落定
    //   → capture成功时invalidate必然在capturing中作废在途takePhoto；
    // - open后紧跟capture不插入：让流先被采纳，保证capture可成功进入capturing。
    for (let k = 0; k < ops.length - 1; k += 1) {
      const cur = ops[k];
      const next = ops[k + 1];
      if (cur.op === 'open' && next.op === 'invalidate') {
        cur.slow = true;
      } else if (cur.op === 'open' && next.op !== 'capture') {
        ops.splice(k + 1, 0, { op: 'invalidate', slow: false });
        cur.slow = true;
        k += 1;
      } else if (cur.op === 'capture' && next.op === 'invalidate') {
        cur.slow = true;
      } else if (cur.op === 'capture' && next.op !== 'invalidate') {
        ops.splice(k + 1, 0, { op: 'invalidate', slow: false });
        cur.slow = true;
        k += 1;
      }
    }
    rounds.push(ops);
  }
  return rounds;
}

// ---------- 单次完整压力run（含全部累计断言与终局审计） ----------

async function runStress() {
  const world = createWorld(mulberry32(STRESS_SEED));
  const plan = planRounds(world.rng);
  let ctl = buildController(world);
  const ops = [];

  const checkInvariants = (note) => {
    assert.ok(world.liveCount() <= 1, `${note}: 存活被采纳流>1`);
    assert.ok(world.adopted.size <= 1, `${note}: 被采纳集合>1`);
    assert.ok(world.urlMap.size <= 4, `${note}: URL注册表>2组(4个)：${world.urlMap.size}`);
    assert.deepEqual(world.handlerFailures, [], `${note}: 事件回调内出现断言失败`);
  };

  const disposeAndRecord = (note) => {
    const d = ctl.dispose();
    ops.push({ op: 'dispose', ok: d.ok === true, code: d.code });
    assert.equal(d.ok, true, `${note}: dispose应成功`);
    assert.deepEqual(
      { ...ctl.getResourceUsage() },
      { state: 'disposed', captureMode: 'single', liveTracks: 0, urlsHeld: 0 },
      `${note}: dispose后资源必须归零`,
    );
    assert.equal(world.urlMap.size, 0, `${note}: dispose后注册表必须清空`);
    assert.equal(world.adopted.size, 0, `${note}: dispose后被采纳集合必须清空`);
    return d;
  };

  for (let i = 0; i < plan.length; i += 1) {
    await withUploadProbe(world, `第${i + 1}轮`, async () => {
      for (const step of plan[i]) {
        const rec = await OPERATIONS[step.op](world, ctl, step);
        ops.push(rec);
        world.stats.ops += 1;
        const legal = LEGAL_CODES[step.op];
        if (rec.ok) {
          assert.equal(rec.code, legal.okCode, `第${i + 1}轮 ${step.op}: 成功返回码应为${legal.okCode}，实际${rec.code}`);
        } else {
          assert.ok(legal.fail.includes(rec.code), `第${i + 1}轮 ${step.op}: 非法失败码 ${rec.code}`);
        }
        checkInvariants(`第${i + 1}轮 ${step.op}后`);
        // 低概率mid-op dispose后重建控制器继续（同一fake world，核算跨实例累计）
        if (world.rng() < DISPOSE_RATE) {
          disposeAndRecord(`第${i + 1}轮 ${step.op}后mid-dispose`);
          world.stats.midDispose += 1;
          ctl = buildController(world);
        }
      }
    });
  }

  // 收尾：最终dispose + 终局审计
  disposeAndRecord('终局');
  const notEnded = world.tracks.filter((t) => !(t.stopped || t.readyState === 'ended'));
  assert.equal(notEnded.length, 0, `终局审计(b)：track泄漏 ${notEnded.map((t) => t.id).join(',')}`);
  assert.equal(world.urlMap.size, 0, '终局审计(c)：URL注册表必须为0');
  assert.ok(world.urlPeak <= 4, `终局审计(c)：任意时刻URL注册表峰值>2组(4个)：${world.urlPeak}`);
  assert.ok(world.gumCalls.length > 0, '终局审计(d)前提：应发生过getUserMedia');
  for (const c of world.gumCalls) {
    assert.equal(c.audio, false, `终局审计(d)：出现audio!==false的getUserMedia：${JSON.stringify(c)}`);
  }
  assert.equal(world.adopted.size, 0, '终局审计(a)：被采纳集合非空');
  for (const sample of world.stats.liveSamples) {
    assert.ok(sample <= 1, `终局审计(a)：存活流计数样本>1：${sample}`);
  }
  assert.equal(world.handlerFailures.length, 0, '终局：事件回调内出现断言失败');

  // dispose后一切操作必须立即返回DISPOSED（合法码集合的负样本验证）
  const probeResults = [
    norm('open', ctl.openFromUserGesture()),
    norm('capture', ctl.capture()),
    norm('close', ctl.closeStream()),
    norm('cancel', ctl.cancelRequest()),
  ];
  ops.push(...probeResults);
  ops.push(norm('accept', await ctl.acceptFile(FILE_POOL[0])));
  for (const rec of [...probeResults, ops[ops.length - 1]]) {
    assert.equal(rec.ok, false, 'dispose后操作不得成功');
    assert.equal(rec.code, 'DISPOSED', `dispose后返回码必须为DISPOSED，实际${rec.code}`);
    checkInvariants('dispose后探针');
  }

  const counts = {};
  for (const o of ops) counts[o.op] = (counts[o.op] ?? 0) + 1;
  return {
    ops,
    counts,
    rounds: plan.length,
    stats: {
      ...world.stats,
      peakLive: Math.max(0, ...world.stats.liveSamples),
      urlPeak: world.urlPeak,
      gumCalls: world.gumCalls.length,
      tracksCreated: world.tracks.length,
      captureFailed: world.events.errors.filter((e) => e.code === 'CAPTURE_FAILED').length,
      previewsDelivered: world.events.previews.length,
    },
  };
}

// ---------- 用例 ----------

test('压力循环：固定seed 42轮确定性操作序列，全程资源/行为不变量与累计统计', { timeout: 120000 }, async () => {
  assert.ok(String(CAMERA_CONTROLLER_VERSION).startsWith('0.3'), `被测版本应为0.2.0.x，实际${CAMERA_CONTROLLER_VERSION}`);
  const run1 = await runStress();
  // 留证：单行累计统计（同seed下两次run的该行输出完全一致，可作确定性旁证）
  console.log(
    `SA6_STRESS_STATS rounds=${run1.rounds} ops=${run1.stats.ops}` +
      ` gumCalls=${run1.stats.gumCalls} adoptions=${run1.stats.adoptions}` +
      ` invalidate@requesting=${run1.stats.invalidateDuringRequesting}` +
      ` invalidate@capturing=${run1.stats.invalidateDuringCapturing}` +
      ` midDispose=${run1.stats.midDispose} acceptOk=${run1.stats.acceptOk}` +
      ` cancelNotPending=${run1.stats.cancelNotPending} captureFailed=${run1.stats.captureFailed}` +
      ` previews=${run1.stats.previewsDelivered} tracks=${run1.stats.tracksCreated}` +
      ` peakLiveStreams=${run1.stats.peakLive} peakUrls=${run1.stats.urlPeak}` +
      ` uploads=${run1.stats.uploadCalls}`,
  );

  // 轮次与覆盖（不以循环次数替代覆盖：每类路径必须实际发生）
  assert.ok(run1.rounds >= 40, `压力轮数必须≥40，实际${run1.rounds}`);
  for (const op of ['open', 'capture', 'accept', 'invalidate', 'close', 'cancel', 'dispose']) {
    assert.ok((run1.counts[op] ?? 0) >= 1, `覆盖不足：操作「${op}」未实际发生`);
  }
  assert.ok(run1.stats.gumCalls >= 1, '覆盖不足：未发生getUserMedia');
  assert.ok(run1.stats.adoptions >= 1, '覆盖不足：无流被采纳');
  assert.ok(run1.stats.invalidateDuringRequesting >= 1, '覆盖不足：requesting在途中作废未发生');
  assert.ok(run1.stats.invalidateDuringCapturing >= 1, '覆盖不足：capturing在途中作废未发生');
  assert.ok(run1.stats.midDispose >= 1, '覆盖不足：mid-op dispose未发生');
  assert.ok(run1.stats.cancelNotPending >= 1, '覆盖不足：cancelRequest无效态NOT_PENDING未发生');
  assert.ok(run1.stats.acceptOk >= 1, '覆盖不足：无成功预览交付');
  assert.equal(run1.stats.uploadCalls, 0, '上传探针命中必须为0');
  assert.equal(Math.min(...run1.stats.liveSamples) >= 0 && run1.stats.peakLive <= 1, true, `存活流峰值必须≤1：${run1.stats.peakLive}`);

  // 确定性复核：同seed重跑，操作序列与每步{op,ok,code}摘要完全一致
  const run2 = await runStress();
  assert.equal(run2.rounds, run1.rounds, '同seed重跑轮数必须一致');
  assert.deepEqual(run2.ops, run1.ops, '同seed重跑：操作序列与{op,ok,code}结果摘要必须完全一致');
  assert.equal(UPLOAD_TOTAL, 0, '全程（两次run）上传探针命中必须为0');
});

test('专项：连续换图60轮——注册表恒一组2个URL、预览id单调推进、逐轮字节一致', { timeout: 60000 }, async () => {
  const world = createWorld(mulberry32(STRESS_SEED)); // 专项独立world；本用例不消耗takePhoto注入
  const ctl = buildController(world);
  const SRC_A = Uint8Array.from({ length: 200 }, (_, i) => (i * 3 + 1) % 256);
  const SRC_B = Uint8Array.from({ length: 333 }, (_, i) => (i * 11 + 7) % 256);
  const blobA = new Blob([SRC_A], { type: 'image/png' });
  const blobB = new Blob([SRC_B], { type: 'image/jpeg' });
  const SOURCES = [SRC_A, SRC_B];

  let prevPreview = null;
  let prevSeq = 0;
  for (let i = 1; i <= 60; i += 1) {
    const idx = (i - 1) % 2; // 交替两个不同合成Blob
    const src = idx === 0 ? blobA : blobB;
    const r = await ctl.acceptFile(src);
    assert.equal(r.ok, true, `第${i}轮换图必须成功`);
    const p = r.preview;

    // 注册表恰好当前一组2个URL，旧URL已撤销
    assert.equal(world.urlMap.size, 2, `第${i}轮：注册表必须恰为一组2个URL，实际${world.urlMap.size}`);
    assert.ok(world.urlMap.has(p.url), `第${i}轮：当前原件URL必须在册`);
    assert.ok(world.urlMap.has(p.thumbnail.url), `第${i}轮：当前缩略图URL必须在册`);
    if (prevPreview) {
      assert.ok(!world.urlMap.has(prevPreview.url), `第${i}轮：旧预览URL必须已撤销`);
      assert.ok(!world.urlMap.has(prevPreview.thumbnail.url), `第${i}轮：旧缩略图URL必须已撤销`);
    }

    // 预览id单调推进（按pv-<seq>-<t>中的seq数字比较，不用字符串序）
    const m = /^pv-(\d+)-/.exec(p.id);
    assert.ok(m, `第${i}轮：预览id格式异常：${p.id}`);
    const seq = Number(m[1]);
    assert.ok(seq > prevSeq, `第${i}轮：预览id必须单调推进（${prevSeq}→${seq}）`);

    // preview.blob与当轮输入逐字节一致（arrayBuffer对比）
    const loaded = new Uint8Array(await p.blob.arrayBuffer());
    assert.equal(loaded.length, SOURCES[idx].length, `第${i}轮：字节数不一致`);
    assert.equal(Buffer.compare(Buffer.from(loaded), Buffer.from(SOURCES[idx])), 0, `第${i}轮：字节内容不一致`);
    assert.equal(p.byteLength, SOURCES[idx].length, `第${i}轮：byteLength不一致`);

    prevPreview = p;
    prevSeq = seq;
  }

  const d = ctl.dispose();
  assert.equal(d.ok, true, '专项收尾dispose应成功');
  assert.deepEqual(
    { ...ctl.getResourceUsage() },
    { state: 'disposed', captureMode: 'single', liveTracks: 0, urlsHeld: 0 },
    '专项收尾资源必须归零',
  );
  assert.equal(world.urlMap.size, 0, '专项收尾注册表必须为0');
  assert.equal(world.gumCalls.length, 0, '专项全程不得触发getUserMedia');
});

after('全程核算：unhandledRejection计0 + 全部world注册表归零 + 上传0', () => {
  assert.equal(UNHANDLED_REJECTIONS.length, 0, `出现未处理rejection：${UNHANDLED_REJECTIONS.join(' | ')}`);
  assert.equal(UPLOAD_TOTAL, 0, '全程上传探针命中必须为0');
  for (const w of ALL_WORLDS) {
    assert.equal(w.urlMap.size, 0, '终局核算：存在未清空的对象URL注册表');
    const live = w.tracks.filter((t) => !(t.stopped || t.readyState === 'ended'));
    assert.equal(live.length, 0, `终局核算：存在未释放track：${live.map((t) => t.id).join(',')}`);
  }
  assert.ok(ALL_WORLDS.length >= 3, '核算前提：应至少有两次压力run与一次专项');
});
