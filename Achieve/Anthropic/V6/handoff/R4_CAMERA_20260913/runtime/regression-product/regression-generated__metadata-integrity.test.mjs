// R2-B｜SA6 元数据完整性测试套件（metadata integrity｜工作包2）
// 任务口径（V6/ZCODE_GOAL_B_TO_0700_20260913.md 工作包2 + SA6任务书）：
//   同图多次选择、损坏图降级、大合成图字节核对、空/非图片拒绝、objectURL错误降级、
//   预览元数据字段冻结（15字段恰set、frozen、receivedAt来自注入时钟、captureHint只记录）。
// 方法：全部合成File/Blob与注入依赖（URL注册表、时钟、decode/缩略图假实现）；
//   零设备调用、零上传、无浏览器、无新依赖。每条终局断言资源归零。
// 被测：../../src/camera-controller.mjs（v0.2.0-r2-candidate）。
// 运行：cd V6/handoff/R2_CAMERA_20260913 && node --test test/metadata-integrity.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { CameraController, SOURCE_METHODS } from "file:///C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/lib/v5-preview/camera/camera-controller.mjs";

// ---------- 常量 ----------

// 预览对象冻结字段（与控制器 _ingestPreview 冻结集一致，15个，多key/少key都判失败）。
const EXPECTED_PREVIEW_KEYS = [
  'id',
  'blob',
  'url',
  'thumbnail',
  'width',
  'height',
  'mime',
  'byteLength',
  'sourceMethod',
  'captureHint',
  'origin',
  'capturedAt',
  'receivedAt',
  'provenance',
  'warnings',
].sort();

const META_THUMB_BYTES = Uint8Array.from([90, 91, 92, 93, 94, 95, 96, 97]);
const BIG_SIZE = 2882143; // 与evidence/assets/synthetic-800x1200.png同尺寸量级（2,882,143字节，纯合成）

// ---------- 假设施 ----------

// mulberry32：确定性PRNG（损坏图垃圾字节填充用，独立于stress seed）。
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALL_WORLDS = [];

// 构造一个acceptFile-only假世界：零设备调用（getUserMedia一被调用即记录并可发现）、
// URL注册表、注入时钟、可注入decode/缩略图。
function makeWorld(overrides = {}) {
  const urlMap = new Map();
  const gumCalls = [];
  const events = { previews: [], errors: [], states: [], streams: [] };
  const ticks = []; // 注入时钟每次返回值的流水
  let urlSeq = 0;

  const clock = () => {
    const v = 60000 + ticks.length * 25;
    ticks.push(v);
    return v;
  };

  const deps = {
    // 本套件只走acceptFile：任何getUserMedia调用都视为设备误触，记录后在closeOut断言为0。
    mediaDevices: {
      getUserMedia(constraints) {
        gumCalls.push(constraints);
        return Promise.reject(Object.assign(new Error('metadata suite must not open camera'), { name: 'NotAllowedError' }));
      },
    },
    ImageCapture: null,
    createObjectURL(blob) {
      const url = `blob:meta-${++urlSeq}`;
      urlMap.set(url, blob);
      return url;
    },
    revokeObjectURL(url) {
      urlMap.delete(url);
    },
    now: clock,
    decodeImageMetadata: async () => ({ width: 640, height: 480 }),
    createThumbnail: async () => ({ blob: new Blob([META_THUMB_BYTES], { type: 'image/png' }), width: 96, height: 72 }),
    isSecureContext: true,
    onStateChange: (s) => events.states.push(s.state),
    onPreview: (p) => events.previews.push(p),
    onError: (e) => events.errors.push(e),
    onStream: (s) => events.streams.push(s),
    ...(overrides.deps ?? {}),
  };
  const controller = new CameraController(deps);
  const world = { controller, urlMap, gumCalls, events, ticks };
  ALL_WORLDS.push(world);
  return world;
}

function closeOut(world, note) {
  const d = world.controller.dispose();
  assert.equal(d.ok, true, `${note}: dispose应成功`);
  assert.deepEqual(
    { ...world.controller.getResourceUsage() },
    { state: 'disposed', captureMode: 'single', liveTracks: 0, urlsHeld: 0 },
    `${note}: 终局资源必须归零`,
  );
  assert.equal(world.urlMap.size, 0, `${note}: 终局URL注册表必须清空`);
  const again = world.controller.dispose();
  assert.equal(again.ok, true, `${note}: dispose幂等`);
  assert.equal(world.controller.state, 'disposed', `${note}: 终态必须为disposed`);
  assert.equal(world.gumCalls.length, 0, `${note}: 本套件不得触发任何getUserMedia`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// ---------- 用例1：同图多次选择 ----------

test('元数据1 同图多次选择：两次交付、id不同、注册表恒2、字节逐字节一致、capturedAt恒null、provenance恒unverified', async () => {
  const world = makeWorld();
  const SRC = Uint8Array.from({ length: 512 }, (_, i) => (i * 7 + 3) % 256);
  const blob = new Blob([SRC], { type: 'image/png' });

  const r1 = await world.controller.acceptFile(blob);
  assert.equal(r1.ok, true, '第一次选择同一图必须交付');
  assert.equal(world.urlMap.size, 2, '第一次交付后注册表恒为2（原件+缩略图）');

  const r2 = await world.controller.acceptFile(blob);
  assert.equal(r2.ok, true, '第二次选择同一图必须交付');
  const p1 = r1.preview;
  const p2 = r2.preview;
  assert.notEqual(p1.id, p2.id, '两次交付id必须不同');

  // 旧URL被撤销，注册表恒2
  assert.equal(world.urlMap.size, 2, '第二次交付后注册表恒为2');
  assert.ok(!world.urlMap.has(p1.url), '第一次预览URL必须已撤销');
  assert.ok(!world.urlMap.has(p1.thumbnail.url), '第一次缩略图URL必须已撤销');
  assert.ok(world.urlMap.has(p2.url), '第二次预览URL必须在册');
  assert.ok(world.urlMap.has(p2.thumbnail.url), '第二次缩略图URL必须在册');

  // 字节逐字节一致（同一Blob两次交付）
  const bytes1 = new Uint8Array(await p1.blob.arrayBuffer());
  const bytes2 = new Uint8Array(await p2.blob.arrayBuffer());
  assert.equal(bytes1.length, SRC.length);
  assert.equal(bytes2.length, SRC.length);
  assert.equal(Buffer.compare(Buffer.from(bytes1), Buffer.from(SRC)), 0, 'p1字节必须与原件一致');
  assert.equal(Buffer.compare(Buffer.from(bytes2), Buffer.from(SRC)), 0, 'p2字节必须与原件一致');
  assert.equal(Buffer.compare(Buffer.from(bytes1), Buffer.from(bytes2)), 0, '两次交付字节必须一致');

  // byteLength/mime一致
  assert.equal(p1.byteLength, SRC.length);
  assert.equal(p2.byteLength, SRC.length);
  assert.equal(p1.mime, 'image/png');
  assert.equal(p2.mime, 'image/png');

  // 元数据口径：capturedAt恒null（不解析EXIF，不用本机时间冒充拍摄时间）、出处恒unverified
  assert.equal(p1.capturedAt, null, 'capturedAt必须恒为null');
  assert.equal(p2.capturedAt, null, 'capturedAt必须恒为null');
  assert.equal(p1.provenance, 'unverified', 'provenance必须恒为unverified');
  assert.equal(p2.provenance, 'unverified', 'provenance必须恒为unverified');
  assert.equal(p1.sourceMethod, SOURCE_METHODS.FILE_PICKER);
  assert.equal(p2.sourceMethod, SOURCE_METHODS.FILE_PICKER);
  assert.deepEqual([...p1.warnings], [], 'decode/缩略图正常时不得有警告');

  closeOut(world, '元数据1');
});

// ---------- 用例2：损坏图降级 ----------

test('元数据2 损坏图：decode返回null/直接throw、缩略图null——预览仍交付、width/height null、警告正确、原字节不变', async () => {
  // 确定性伪随机垃圾字节（seed=424242，损坏图专用）
  const garbage = new Uint8Array(300);
  const rand = mulberry32(424242);
  for (let i = 0; i < garbage.length; i += 1) garbage[i] = Math.floor(rand() * 256);
  const SRC = Uint8Array.from(garbage);
  const blob = new Blob([SRC], { type: 'image/png' }); // type声称png、内容是垃圾

  // 变体A：decode返回null
  {
    const world = makeWorld({ deps: { decodeImageMetadata: async () => null } });
    const r = await world.controller.acceptFile(blob);
    assert.equal(r.ok, true, 'decode null时预览仍必须交付');
    const p = r.preview;
    assert.equal(p.width, null, 'decode null时width必须为null');
    assert.equal(p.height, null, 'decode null时height必须为null');
    assert.ok([...p.warnings].includes('metadata_unavailable'), 'warnings必须含metadata_unavailable');
    const loaded = new Uint8Array(await p.blob.arrayBuffer());
    assert.equal(Buffer.compare(Buffer.from(loaded), Buffer.from(SRC)), 0, '原字节必须不变');
    assert.ok(world.urlMap.has(p.url), 'URL必须已创建');
    assert.ok(p.url !== null && typeof p.url === 'string');
    closeOut(world, '元数据2A');
  }
  // 变体B：decode直接throw
  {
    const world = makeWorld({ deps: { decodeImageMetadata: async () => { throw new Error('decoder crash'); } } });
    const r = await world.controller.acceptFile(blob);
    assert.equal(r.ok, true, 'decode throw时预览仍必须交付');
    const p = r.preview;
    assert.equal(p.width, null);
    assert.equal(p.height, null);
    assert.ok([...p.warnings].includes('metadata_unavailable'), 'warnings必须含metadata_unavailable');
    const loaded = new Uint8Array(await p.blob.arrayBuffer());
    assert.equal(Buffer.compare(Buffer.from(loaded), Buffer.from(SRC)), 0, '原字节必须不变');
    closeOut(world, '元数据2B');
  }
  // 变体C：缩略图注入返回null（decode正常）
  {
    const world = makeWorld({ deps: { createThumbnail: async () => null } });
    const r = await world.controller.acceptFile(blob);
    assert.equal(r.ok, true, '缩略图null时预览仍必须交付');
    const p = r.preview;
    assert.equal(p.thumbnail, null, '缩略图必须为null');
    assert.ok([...p.warnings].includes('thumbnail_unavailable'), 'warnings必须含thumbnail_unavailable');
    assert.equal(p.width, 640, 'decode正常时width不受缩略图影响');
    assert.equal(p.height, 480);
    assert.ok(![...p.warnings].includes('metadata_unavailable'), 'decode正常时不得误报metadata_unavailable');
    closeOut(world, '元数据2C');
  }
  // 变体D：decode与缩略图同时不可用
  {
    const world = makeWorld({
      deps: { decodeImageMetadata: async () => null, createThumbnail: async () => { throw new Error('thumb boom'); } },
    });
    const r = await world.controller.acceptFile(blob);
    assert.equal(r.ok, true);
    const p = r.preview;
    assert.equal(p.width, null);
    assert.equal(p.height, null);
    assert.equal(p.thumbnail, null);
    assert.ok([...p.warnings].includes('metadata_unavailable'));
    assert.ok([...p.warnings].includes('thumbnail_unavailable'));
    closeOut(world, '元数据2D');
  }
});

// ---------- 用例3：大合成图 ----------

test('元数据3 大合成图2,882,143字节：byteLength精确、分块hash逐字节一致、sha256前后相同、缩略图独立、资源归零', async () => {
  // 确定性大数组：简单整数函数填充（纯合成，非真实PNG）
  const SRC = new Uint8Array(BIG_SIZE);
  for (let i = 0; i < BIG_SIZE; i += 1) SRC[i] = (i * 131 + 17) % 256;
  const shaBefore = sha256(SRC);
  const blob = new Blob([SRC], { type: 'image/png' });

  const world = makeWorld({
    deps: {
      decodeImageMetadata: async () => ({ width: 800, height: 1200 }),
      // 缩略图独立：注入fake返回小Blob（控制器不得把原件当缩略图）
      createThumbnail: async () => ({ blob: new Blob([META_THUMB_BYTES], { type: 'image/jpeg' }), width: 53, height: 80 }),
    },
  });
  const r = await world.controller.acceptFile(blob);
  assert.equal(r.ok, true, '大图必须交付');
  const p = r.preview;

  // byteLength精确相等
  assert.equal(p.byteLength, BIG_SIZE, `byteLength必须精确等于${BIG_SIZE}`);
  assert.equal(p.width, 800);
  assert.equal(p.height, 1200);

  // 原件就是传入Blob本身（未被复制替换/改写），并整体sha256前后相同
  assert.equal(p.blob, blob, 'preview.blob必须就是传入的Blob对象');
  const loaded = new Uint8Array(await p.blob.arrayBuffer());
  assert.equal(loaded.length, BIG_SIZE);
  assert.equal(sha256(loaded), shaBefore, 'sha256前后必须相同（整体）');

  // 分块hash对比：64KiB分块逐块sha256一致（逐字节等价的分块证明）
  const CHUNK = 65536;
  let chunks = 0;
  for (let off = 0; off < BIG_SIZE; off += CHUNK) {
    const end = Math.min(off + CHUNK, BIG_SIZE);
    const hSrc = sha256(SRC.subarray(off, end));
    const hLoad = sha256(loaded.subarray(off, end));
    assert.equal(hLoad, hSrc, `分块#${chunks}（偏移${off}）hash不一致`);
    chunks += 1;
  }
  assert.equal(chunks, Math.ceil(BIG_SIZE / CHUNK), '分块数必须覆盖全文件');
  assert.ok(chunks >= 40, `分块数应≥40证明真实覆盖，实际${chunks}`);

  // 缩略图独立：小Blob、独立URL、与原件尺寸量级分离
  assert.notEqual(p.thumbnail.blob, blob, '缩略图不得是原件本身');
  assert.equal(p.thumbnail.blob.size, META_THUMB_BYTES.length, '缩略图必须是注入的小Blob');
  assert.equal(p.thumbnail.width, 53);
  assert.equal(p.thumbnail.height, 80);
  assert.ok(world.urlMap.has(p.thumbnail.url), '缩略图URL必须在册');
  assert.ok(world.urlMap.has(p.url), '原件URL必须在册');
  assert.equal(world.urlMap.size, 2, '交付后注册表应恰为一组2个');

  // 终局：资源归零，原数组sha256不变
  closeOut(world, '元数据3');
  assert.equal(sha256(SRC), shaBefore, 'dispose后原数组sha256必须仍不变');
});

// ---------- 用例4：空文件与非图片 ----------

test('元数据4 空文件与非图片：EMPTY_FILE、NOT_AN_IMAGE(video/mp4)、缺arrayBuffer伪对象、空type Blob放行且mime为空串', async () => {
  const world = makeWorld();

  // size 0 → EMPTY_FILE
  const empty = new Blob([], { type: 'image/jpeg' });
  const r1 = await world.controller.acceptFile(empty);
  assert.equal(r1.ok, false, '空文件必须拒绝');
  assert.equal(r1.code, 'EMPTY_FILE');

  // type='video/mp4' → NOT_AN_IMAGE
  const video = new Blob([Uint8Array.from({ length: 100 }, (_, i) => i)], { type: 'video/mp4' });
  const r2 = await world.controller.acceptFile(video);
  assert.equal(r2.ok, false, '非图片类型必须拒绝');
  assert.equal(r2.code, 'NOT_AN_IMAGE');
  assert.ok(world.events.errors.at(-1).message.includes('video/mp4'), '拒绝文案应包含实际mime');

  // 缺arrayBuffer伪对象 → NOT_AN_IMAGE（looksLikeBlob不通过）
  const pseudo = { size: 10 };
  const r3 = await world.controller.acceptFile(pseudo);
  assert.equal(r3.ok, false, '缺arrayBuffer伪对象必须拒绝');
  assert.equal(r3.code, 'NOT_AN_IMAGE');

  // 三次拒绝：零URL、零预览、状态不变
  assert.equal(world.urlMap.size, 0, '拒绝路径不得创建URL');
  assert.equal(world.events.previews.length, 0, '拒绝路径不得交付预览');
  assert.equal(world.controller.state, 'idle', '拒绝不得改变状态');

  // type为空串的Blob放行：mime为''、warnings不误报
  const SRC = Uint8Array.from({ length: 72 }, (_, i) => (i * 5 + 2) % 256);
  const noType = new Blob([SRC]); // 未声明type → ''
  const r4 = await world.controller.acceptFile(noType);
  assert.equal(r4.ok, true, '空type Blob应放行（不因mime缺失拒绝）');
  const p = r4.preview;
  assert.equal(p.mime, '', '空type Blob的mime必须为空串');
  assert.deepEqual([...p.warnings], [], '正常decode/缩略图注入下warnings不得误报');
  assert.equal(p.byteLength, SRC.length);
  const loaded = new Uint8Array(await p.blob.arrayBuffer());
  assert.equal(Buffer.compare(Buffer.from(loaded), Buffer.from(SRC)), 0, '空type Blob字节必须不变');

  closeOut(world, '元数据4');
});

// ---------- 用例5：objectURL错误 ----------

test('元数据5 objectURL错误：createObjectURL抛错→url null+object_url_unavailable且预览仍交付；revokeObjectURL抛错→换图与dispose不崩', async () => {
  // 变体A：createObjectURL抛错
  {
    const world = makeWorld({
      deps: {
        createObjectURL() {
          throw new Error('url quota exceeded');
        },
      },
    });
    const SRC = Uint8Array.from({ length: 64 }, (_, i) => i + 1);
    const r = await world.controller.acceptFile(new Blob([SRC], { type: 'image/png' }));
    assert.equal(r.ok, true, 'createObjectURL抛错时预览仍必须交付');
    const p = r.preview;
    assert.equal(p.url, null, 'url必须为null');
    assert.deepEqual([...p.warnings], ['object_url_unavailable'], 'warnings必须恰含object_url_unavailable');
    assert.equal(world.controller.getPreview()?.id, p.id, '预览必须已登记');
    assert.equal(world.events.previews.length, 1, 'onPreview必须已回调');
    const loaded = new Uint8Array(await p.blob.arrayBuffer());
    assert.equal(Buffer.compare(Buffer.from(loaded), Buffer.from(SRC)), 0, '原字节必须不变');
    // dispose不崩
    const d = world.controller.dispose();
    assert.equal(d.ok, true, 'dispose在URL缺失下不得崩');
    assert.deepEqual({ ...world.controller.getResourceUsage() }, { state: 'disposed', captureMode: 'single', liveTracks: 0, urlsHeld: 0 });
    assert.equal(world.gumCalls.length, 0, '变体A不得触发getUserMedia');
  }
  // 变体B：revokeObjectURL抛错（注销前先从注册表移除：撤销失败但URL已失效）
  {
    const urlMap = new Map();
    let n = 0;
    const world = makeWorld({
      deps: {
        createObjectURL(blob) {
          const url = `blob:meta-revoke-${++n}`;
          urlMap.set(url, blob);
          return url;
        },
        revokeObjectURL(url) {
          urlMap.delete(url); // 先失效再抛错：模拟“撤销调用失败”而不残留僵尸URL
          throw new Error('revoke boom');
        },
      },
    });
    const SRC_A = Uint8Array.from({ length: 40 }, (_, i) => i * 2);
    const SRC_B = Uint8Array.from({ length: 48 }, (_, i) => i * 3 + 1);
    const blobA = new Blob([SRC_A], { type: 'image/png' });
    const blobB = new Blob([SRC_B], { type: 'image/jpeg' });

    const r1 = await world.controller.acceptFile(blobA);
    assert.equal(r1.ok, true, '换图A必须成功');
    assert.equal(urlMap.size, 2, 'A交付后恰一组URL');

    // 换图（触发对旧URL的revoke抛错）不得崩，新预览正常
    const r2 = await world.controller.acceptFile(blobB);
    assert.equal(r2.ok, true, 'revoke抛错时换图必须不崩且成功');
    const p2 = r2.preview;
    assert.ok(p2.url !== null, '新预览URL必须正常');
    assert.deepEqual([...p2.warnings], [], 'revoke抛错不得给新预览制造警告');
    assert.equal(urlMap.size, 2, '换图后注册表应恰为新一组2个');
    assert.ok(!urlMap.has(r1.preview.url), '旧URL必须已失效');
    const loaded = new Uint8Array(await p2.blob.arrayBuffer());
    assert.equal(Buffer.compare(Buffer.from(loaded), Buffer.from(SRC_B)), 0, '新预览字节必须与B一致');

    // dispose不崩
    const d = world.controller.dispose();
    assert.equal(d.ok, true, 'dispose在revoke抛错下不得崩');
    assert.equal(urlMap.size, 0, 'dispose后注册表必须清空');
    assert.deepEqual({ ...world.controller.getResourceUsage() }, { state: 'disposed', captureMode: 'single', liveTracks: 0, urlsHeld: 0 });
    world.urlMap.clear(); // 该world使用外部urlMap，保持全程核算口径一致
    assert.equal(world.gumCalls.length, 0, '变体B不得触发getUserMedia');
  }
});

// ---------- 用例6：元数据字段冻结 ----------

test('元数据6 预览字段冻结：恰15字段且frozen、receivedAt来自注入时钟、captureHint只记录不改sourceMethod', async () => {
  const world = makeWorld();
  const SRC = Uint8Array.from({ length: 96 }, (_, i) => (i * 13 + 5) % 256);
  const blob = new Blob([SRC], { type: 'image/jpeg' });

  const r = await world.controller.acceptFile(blob, { captureHint: { sensor: 'wide', zoom: 2 } });
  assert.equal(r.ok, true);
  const p = r.preview;

  // 字段集合恰为15个：多key/少key都会失败
  assert.deepEqual(
    Object.keys(p).sort(),
    EXPECTED_PREVIEW_KEYS,
    `预览字段集合必须恰为15个冻结字段，实际：${Object.keys(p).sort().join(',')}`,
  );

  // 冻结：对象及其嵌套记录均frozen；写入/新增在strict下必须抛TypeError
  assert.equal(Object.isFrozen(p), true, 'preview必须被冻结');
  assert.equal(Object.isFrozen(p.warnings), true, 'warnings必须被冻结');
  assert.equal(Object.isFrozen(p.thumbnail), true, 'thumbnail必须被冻结');
  assert.equal(Object.isFrozen(p.captureHint), true, 'captureHint必须被冻结');
  assert.throws(() => {
    p.capturedAt = '2026-01-01T00:00:00Z';
  }, TypeError, '改写冻结字段必须抛TypeError');
  assert.throws(() => {
    Object.defineProperty(p, 'extraKey', { value: 1 });
  }, TypeError, '新增字段必须抛TypeError');

  // receivedAt来自注入时钟：等于时钟流水最后一笔
  const lastTick = world.ticks[world.ticks.length - 1];
  assert.ok(world.ticks.includes(p.receivedAt), 'receivedAt必须来自注入时钟');
  assert.equal(p.receivedAt, lastTick, 'receivedAt必须是构建时刻时钟流水最后一笔');

  // captureHint只记录，不改sourceMethod；origin为用户选择
  assert.deepEqual({ ...p.captureHint }, { sensor: 'wide', zoom: 2 }, 'captureHint必须原样记录');
  assert.equal(p.sourceMethod, SOURCE_METHODS.FILE_PICKER, 'captureHint不得改变sourceMethod');
  assert.equal(p.origin, 'user_file_selection');

  // 不带captureHint的对照：captureHint为null
  const r2 = await world.controller.acceptFile(new Blob([SRC], { type: 'image/jpeg' }));
  assert.equal(r2.ok, true);
  assert.equal(r2.preview.captureHint, null, '无提示时captureHint必须为null');
  assert.equal(r2.preview.sourceMethod, SOURCE_METHODS.FILE_PICKER);

  closeOut(world, '元数据6');
});

// ---------- 全程核算 ----------

after('元数据全程核算：全部world注册表归零、零设备调用、零上传、合成无浏览器', () => {
  assert.ok(ALL_WORLDS.length >= 6, '核算前提：world数量不足');
  let gumTotal = 0;
  let previewsTotal = 0;
  for (const w of ALL_WORLDS) {
    gumTotal += w.gumCalls.length;
    previewsTotal += w.events.previews.length;
    assert.equal(w.urlMap.size, 0, '终局核算：存在未清空的URL注册表');
    assert.equal(w.controller.state, 'disposed', '终局核算：存在未dispose的控制器');
    for (const s of w.events.streams) assert.equal(s, undefined, '本套件不得产生任何流事件');
  }
  assert.equal(gumTotal, 0, '元数据套件全程不得触发getUserMedia');
  assert.ok(previewsTotal >= 6, `核算前提：预览交付数应≥6，实际${previewsTotal}`);
});
