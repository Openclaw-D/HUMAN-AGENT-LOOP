// 容量注册表(R2 修复验收):in-flight 任何情况不得淘汰;cached 最老优先、其次 uncached 最老优先;
// 容量满且无可安全淘汰条目 → { kind:'capacity' } 明确背压(不静默、不挂起、不抛)。
// 范围声明:直测 src/dedupe.mjs 的 RequestRegistry,不经 adapter
// (adapter 由并行任务 Agent-LIFECYCLE 修改,本文件不 import adapter.mjs 及其依赖)。
// 全部调度使用固定 seed 的确定性伪随机(LCG),不发网络、不写 runtime/ 以外路径。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RequestRegistry, payloadHash } from '../../src/dedupe.mjs';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const hashOf = (o) => payloadHash(o);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 固定 seed 的 32 位 LCG(数值方法规范常数):跨平台逐位一致的确定性伪随机。 */
function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 按类别登记一个条目:inflight 保持 pending;cached/uncached settle 并等分类落定。返回其 deferred 供收尾。 */
async function seedEntry(reg, id, cls, hash) {
  const d = deferred();
  const t = reg.track(id, hash, d.promise);
  assert.equal(t.kind, 'registered');
  if (cls === 'cached') d.resolve({ status: 'succeeded', marker: id });
  else if (cls === 'uncached') d.resolve({ status: 'unknown', marker: id });
  if (cls !== 'inflight') await flush();
  return d;
}

/**
 * 参考模型:独立于实现地计算期望受害者。
 * specs 按登记顺序(即 seq 递增):cached 最老优先,其次 uncached 最老优先;in-flight 不可选。
 */
function expectedVictim(specs) {
  const rank = (cls) => (cls === 'cached' ? 0 : 1);
  const evictable = specs.filter((s) => s.cls !== 'inflight');
  if (evictable.length === 0) return null;
  evictable.sort((a, b) => (rank(a.cls) !== rank(b.cls) ? rank(a.cls) - rank(b.cls) : a.order - b.order));
  return evictable[0].id;
}

test('容量2:两个 in-flight 时新ID → capacity 背压;任一 settle 为 cached 后可注册,被淘汰的是 cached 而非 in-flight', async () => {
  const reg = new RequestRegistry({ maxEntries: 2 });
  const ha = hashOf({ id: 'a' });
  const hb = hashOf({ id: 'b' });
  const da = deferred();
  const db = deferred();
  assert.equal(reg.track('a', ha, da.promise).kind, 'registered');
  assert.equal(reg.track('b', hb, db.promise).kind, 'registered');
  assert.equal(reg.map.size, 2);

  // 满载期间,既有在途条目的 join 与 mismatch 不受影响(去重语义优先于背压)
  assert.equal(reg.lookup('a', ha).kind, 'in-flight');
  assert.equal(reg.lookup('a', hashOf({ id: 'a-tampered' })).kind, 'mismatch');

  // 第三个新ID:全部在途、无可安全淘汰 → 明确 capacity,不新增、不抛、不挂起
  const hc = hashOf({ id: 'c' });
  assert.deepEqual(reg.lookup('c', hc), { kind: 'capacity', payloadHash: hc });
  assert.deepEqual(reg.track('c', hc, deferred().promise), { kind: 'capacity', payloadHash: hc });
  assert.equal(reg.map.size, 2, '背压不得新增条目');
  assert.ok(!reg.map.has('c'));

  // a settle 为确定性成功(cached);b 必须仍在途
  da.resolve({ status: 'succeeded', marker: 'ra' });
  await flush();
  assert.equal(reg.map.get('b').inFlight, db.promise, '在途 b 不得被 settle 之外的任何路径移除');

  // 再次注册 c:唯一可安全淘汰者是 cached 的 a → 淘汰 a,保留在途 b
  assert.equal(reg.lookup('c', hc).kind, 'register');
  const dc = deferred();
  assert.equal(reg.track('c', hc, dc.promise).kind, 'registered');
  assert.ok(!reg.map.has('a'), '被淘汰的必须是 cached 条目');
  assert.ok(reg.map.has('b'), 'in-flight 条目任何情况不得淘汰');
  assert.ok(reg.map.has('c'));

  // 收尾,避免悬挂 pending
  db.resolve({ status: 'unknown', marker: 'rb' });
  dc.resolve({ status: 'succeeded', marker: 'rc' });
  await flush();
  await flush();
});

test('容量2(Codex probe 修复证明):a 在途期间注册 b(cached)与 c 成功 → 被淘汰的是 b、a 保留:a 同ID同载荷仍 join、变载荷仍 mismatch', async () => {
  const reg = new RequestRegistry({ maxEntries: 2 });
  const ha = hashOf({ id: 'a' });
  const da = deferred();
  assert.equal(reg.track('a', ha, da.promise).kind, 'registered');

  // b 注册并 settle 为 cached(容量满:a 在途 + b cached)
  const hb = hashOf({ id: 'b' });
  const db = await seedEntry(reg, 'b', 'cached', hb);

  // c 注册:唯一可安全淘汰者是 cached 的 b → b 被淘汰、在途 a 受保护(R1 正是在此处删掉了 a)
  const hc = hashOf({ id: 'c' });
  assert.equal(reg.lookup('c', hc).kind, 'register');
  const dc = deferred();
  assert.equal(reg.track('c', hc, dc.promise).kind, 'registered');
  assert.ok(reg.map.has('a') && reg.map.has('c') && !reg.map.has('b'), '必须淘汰 cached 的 b,而不是在途的 a');

  // 修复证明一:a 的同ID同载荷仍 join 同一在飞 promise → 同ID并发 transport 恰 1
  const join = reg.lookup('a', ha);
  assert.equal(join.kind, 'in-flight');
  assert.equal(join.promise, da.promise, '必须共享原始在飞 promise');

  // 修复证明二:a 的同ID变载荷仍被拒(指纹未随淘汰丢失)
  const hBad = hashOf({ id: 'a', tampered: true });
  assert.deepEqual(reg.lookup('a', hBad), { kind: 'mismatch', registeredHash: ha, payloadHash: hBad });

  // 收尾
  da.resolve({ status: 'succeeded', marker: 'ra' });
  db.resolve({ status: 'succeeded' });
  dc.resolve({ status: 'succeeded' });
  await flush();
  await flush();
});

test('600 步混合调度(seed=42,48 个ID,容量512):在途去重恰一、变载荷拒绝100%、零 capacity 误报', async () => {
  const reg = new RequestRegistry({ maxEntries: 512 });
  const rand = lcg(42);
  const IDS = Array.from({ length: 48 }, (_, i) => `id-${String(i).padStart(2, '0')}`);
  // 模型状态:absent | { phase:'in-flight', hash, exec } | { phase:'cached'|'uncached', hash, result }
  const model = new Map();
  const pending = []; // { id, d, hash }
  let joinCount = 0;
  let cacheHitCount = 0;
  let mismatchCount = 0;
  let varyCount = 0;
  let reRegisterCount = 0;
  let freshRegisterCount = 0;
  let transportCalls = 0;
  let varySeq = 0;

  /** 变载荷探测:必须 mismatch(指纹未淘汰前提下 100% 拒绝)。 */
  const expectMismatch = (step, id, registeredHash) => {
    varySeq += 1;
    const bad = hashOf({ id, vary: varySeq });
    const res = reg.lookup(id, bad);
    assert.deepEqual(
      res,
      { kind: 'mismatch', registeredHash, payloadHash: bad },
      `变载荷必须拒绝:step=${step} id=${id}`,
    );
    mismatchCount += 1;
    varyCount += 1;
  };

  for (let step = 0; step < 600; step++) {
    // 1) 以伪随机概率 settle 一个在途调用(结果 75% 确定性成功 / 25% unknown)
    if (pending.length > 0 && rand() < 0.6) {
      const k = Math.floor(rand() * pending.length);
      const job = pending.splice(k, 1)[0];
      const cached = rand() < 0.75;
      const result = cached ? { status: 'succeeded', marker: job.id } : { status: 'unknown', marker: job.id };
      job.d.resolve(result);
      await flush(); // 等 track 的 settle watcher 落定条目分类
      model.set(job.id, { phase: cached ? 'cached' : 'uncached', hash: job.hash, result });
    }

    // 2) 伪随机挑选操作;前 48 步固定逐个引入全部 ID(保证覆盖)
    const id = step < IDS.length ? IDS[step] : IDS[Math.floor(rand() * IDS.length)];
    const st = model.get(id);
    const roll = rand();
    if (!st) {
      // 新 ID:必须 register 并发起 transport(并发窗口开启)
      const hash = hashOf({ id, v: 0 });
      const res = reg.lookup(id, hash);
      assert.equal(res.kind, 'register', `新 ID 必须 register:step=${step} id=${id} 实得=${res.kind}`);
      assert.equal(res.payloadHash, hash);
      const d = deferred();
      assert.equal(reg.track(id, hash, d.promise).kind, 'registered');
      model.set(id, { phase: 'in-flight', hash, exec: d.promise });
      pending.push({ id, d, hash });
      transportCalls += 1;
      freshRegisterCount += 1;
    } else if (st.phase === 'in-flight') {
      if (roll < 0.6) {
        // 在途 join:必须 in-flight 且共享同一 promise,transport 不得再次发起
        const res = reg.lookup(id, st.hash);
        assert.equal(res.kind, 'in-flight', `在途期间同ID同载荷必须 join:step=${step} id=${id} 实得=${res.kind}`);
        assert.equal(res.promise, st.exec, `必须共享原始在飞 promise:step=${step} id=${id}`);
        joinCount += 1;
      } else {
        expectMismatch(step, id, st.hash);
      }
    } else if (st.phase === 'cached') {
      if (roll < 0.6) {
        const res = reg.lookup(id, st.hash);
        assert.equal(res.kind, 'cache-hit', `确定性结果必须命中缓存:step=${step} id=${id} 实得=${res.kind}`);
        assert.deepEqual(res.result, st.result);
        assert.equal(res.payloadHash, st.hash);
        cacheHitCount += 1;
      } else {
        expectMismatch(step, id, st.hash);
      }
    } else {
      // uncached(unknown 等):同ID同载荷人工重试是新的完整调用,复用既有条目
      if (roll < 0.6) {
        const entryBefore = reg.map.get(id);
        const res = reg.lookup(id, st.hash);
        assert.equal(res.kind, 'register', `unknown 后同ID同载荷重试仍 register:step=${step} id=${id} 实得=${res.kind}`);
        assert.equal(res.payloadHash, st.hash);
        const d = deferred();
        assert.equal(reg.track(id, st.hash, d.promise).kind, 'registered');
        assert.ok(reg.map.get(id) === entryBefore, `uncached 重试必须复用既有条目:step=${step} id=${id}`);
        model.set(id, { phase: 'in-flight', hash: st.hash, exec: d.promise });
        pending.push({ id, d, hash: st.hash });
        transportCalls += 1;
        reRegisterCount += 1;
      } else {
        expectMismatch(step, id, st.hash);
      }
    }
  }

  // 收尾:settle 全部在途
  while (pending.length > 0) {
    const job = pending.shift();
    job.d.resolve({ status: 'succeeded', marker: job.id });
    await flush();
    model.set(job.id, { phase: 'cached', hash: job.hash, result: { status: 'succeeded', marker: job.id } });
  }

  // 全局断言:容量充足 → 零 capacity 误报、零淘汰(全部指纹保留)、不变量成立
  assert.ok(reg.map.size <= 512, '条目数不得超过 maxEntries');
  assert.equal(reg.map.size, IDS.length, '容量充足时零淘汰:每个指纹都必须保留');
  assert.equal(mismatchCount, varyCount, '变载荷拒绝必须 100%');
  assert.ok(freshRegisterCount === IDS.length, `每个 ID 恰一次全新注册,实得 ${freshRegisterCount}`);
  assert.equal(transportCalls, freshRegisterCount + reRegisterCount, 'transport 次数 = 全新注册 + uncached 重试(在途期间零重复发起)');
  assert.ok(joinCount > 0, `调度必须覆盖在途 join(实际 ${joinCount} 次)`);
  assert.ok(cacheHitCount > 0, `调度必须覆盖缓存命中(实际 ${cacheHitCount} 次)`);
  assert.ok(reRegisterCount > 0, `调度必须覆盖 uncached 重试(实际 ${reRegisterCount} 次)`);
  assert.ok(mismatchCount > 0, `调度必须覆盖变载荷拒绝(实际 ${mismatchCount} 次)`);
});

const CLASSES = ['inflight', 'cached', 'uncached'];

test('小容量确定性模型:容量2 全 9 种两两组合,淘汰/背压决策与参考模型一致、决策确定且在途零淘汰', async () => {
  for (const clsA of CLASSES) {
    for (const clsB of CLASSES) {
      const outcomes = [];
      for (let trial = 0; trial < 2; trial++) {
        const reg = new RequestRegistry({ maxEntries: 2 });
        const d1 = await seedEntry(reg, 'a', clsA, hashOf({ k: 'a' }));
        const d2 = await seedEntry(reg, 'b', clsB, hashOf({ k: 'b' }));
        const hNew = hashOf({ probe: `${clsA}+${clsB}` });
        const beforeKeys = [...reg.map.keys()];
        const res = reg.lookup('c', hNew);
        const victim = expectedVictim([
          { id: 'a', cls: clsA, order: 0 },
          { id: 'b', cls: clsB, order: 1 },
        ]);
        if (victim === null) {
          assert.deepEqual(res, { kind: 'capacity', payloadHash: hNew }, `全在途组合 [${clsA}+${clsB}] 必须明确背压`);
          assert.deepEqual([...reg.map.keys()], beforeKeys, `背压组合 [${clsA}+${clsB}] 不得改动任何条目`);
        } else {
          // lookup 是只读判定:存在可淘汰条目 → register,实际淘汰发生在 track
          assert.equal(res.kind, 'register', `组合 [${clsA}+${clsB}] 存在可淘汰条目,应注册新ID`);
          assert.deepEqual([...reg.map.keys()].sort(), beforeKeys.sort(), `组合 [${clsA}+${clsB}]:lookup 阶段不得有淘汰副作用`);
        }
        // 完整两步语义:背压组合 track 同样背压;可注册组合 track 执行淘汰并在册
        const dc = deferred();
        const tracked = reg.track('c', hNew, dc.promise);
        const expectedTrackKind = res.kind === 'register' ? 'registered' : res.kind;
        assert.equal(tracked.kind, expectedTrackKind, `组合 [${clsA}+${clsB}]:track 决策必须与 lookup 一致`);
        if (victim === null) {
          assert.deepEqual([...reg.map.keys()].sort(), beforeKeys.sort(), `背压组合 [${clsA}+${clsB}]:track 不得新增或淘汰`);
        } else {
          assert.ok(!reg.map.has(victim), `组合 [${clsA}+${clsB}]:被淘汰者必须是 ${victim}`);
          assert.ok(reg.map.has('c'), `组合 [${clsA}+${clsB}]:track 后新条目必须已注册`);
          for (const s of [
            ['a', clsA],
            ['b', clsB],
          ]) {
            if (s[1] === 'inflight') assert.ok(reg.map.has(s[0]), `在途 ${s[0]} 在组合 [${clsA}+${clsB}] 中不得被淘汰`);
          }
        }
        dc.resolve({ status: 'unknown' });
        await flush();
        outcomes.push({ kind: res.kind, keys: [...reg.map.keys()] });
        // 收尾,避免悬挂 pending
        d1.resolve({ status: 'unknown' });
        d2.resolve({ status: 'unknown' });
        await flush();
      }
      assert.deepEqual(outcomes[0], outcomes[1], `组合 [${clsA}+${clsB}] 决策必须逐次确定一致`);
    }
  }
});

test('容量3 关键组合:cached 优先于 uncached、同类最老优先、全在途背压、有空位零淘汰', async () => {
  const scenarios = [
    { specs: ['inflight', 'inflight', 'inflight'], expect: 'capacity', victim: null },
    { specs: ['cached', 'cached', 'inflight'], expect: 'register', victim: 's0' },
    { specs: ['cached', 'uncached', 'inflight'], expect: 'register', victim: 's0' },
    { specs: ['uncached', 'cached', 'inflight'], expect: 'register', victim: 's1' }, // cached 优先于更老的 uncached
    { specs: ['uncached', 'uncached', 'uncached'], expect: 'register', victim: 's0' }, // 同类最老优先
    { specs: ['inflight', 'cached', 'uncached'], expect: 'register', victim: 's1' },
    { specs: ['inflight', 'inflight', 'cached'], expect: 'register', victim: 's2' },
  ];
  for (const sc of scenarios) {
    const reg = new RequestRegistry({ maxEntries: 3 });
    const ds = [];
    for (let i = 0; i < sc.specs.length; i++) {
      ds.push(await seedEntry(reg, `s${i}`, sc.specs[i], hashOf({ s: i })));
    }
    const res = reg.lookup('new-id', hashOf({ probe: sc.specs.join('+') }));
    assert.equal(res.kind, sc.expect, `组合 [${sc.specs}] 期望 ${sc.expect}`);
    // lookup 只读判定(不淘汰不注册);track 才执行决策
    const dNew = deferred();
    const tracked = reg.track('new-id', hashOf({ probe: sc.specs.join('+') }), dNew.promise);
    const expectedTrackKind = sc.expect === 'register' ? 'registered' : sc.expect;
    assert.equal(tracked.kind, expectedTrackKind, `组合 [${sc.specs}]:track 决策必须与 lookup 一致`);
    if (sc.victim === null) {
      assert.equal(reg.map.size, 3, `组合 [${sc.specs}]:背压不得淘汰或新增`);
    } else {
      assert.ok(!reg.map.has(sc.victim), `组合 [${sc.specs}]:受害者必须是 ${sc.victim}`);
      assert.ok(reg.map.has('new-id'), `组合 [${sc.specs}]:track 后新条目必须已注册`);
      sc.specs.forEach((cls, i) => {
        if (cls === 'inflight') assert.ok(reg.map.has(`s${i}`), `在途 s${i} 在 [${sc.specs}] 中不得被淘汰`);
      });
    }
    for (const d of ds) d.resolve({ status: 'unknown' });
    dNew.resolve({ status: 'unknown' });
    await flush();
  }

  // 有空位:容量3 只放 2 条 → 新 ID 注册且零淘汰
  const reg2 = new RequestRegistry({ maxEntries: 3 });
  const db = await seedEntry(reg2, 'a', 'cached', hashOf({ k: 'a' }));
  const dc2 = await seedEntry(reg2, 'b', 'inflight', hashOf({ k: 'b' }));
  assert.equal(reg2.lookup('c', hashOf({ k: 'c' })).kind, 'register');
  const dSlot = deferred();
  assert.equal(reg2.track('c', hashOf({ k: 'c' }), dSlot.promise).kind, 'registered');
  assert.ok(reg2.map.has('a') && reg2.map.has('b') && reg2.map.has('c'), '有空位时不得淘汰任何条目');
  db.resolve({ status: 'succeeded' });
  dc2.resolve({ status: 'unknown' });
  dSlot.resolve({ status: 'succeeded' });
  await flush();
});

test('entry 形状兼容:{ payloadHash, result, inFlight, cached, seq };registrySnapshot 消费字段(e.payloadHash / Boolean(e.result))不破坏', async () => {
  const reg = new RequestRegistry({ maxEntries: 8 });
  const h = hashOf({ op: 'shape' });
  const d = deferred();
  assert.equal(reg.track('x', h, d.promise).kind, 'registered');
  let e = reg.map.get('x');
  assert.equal(e.payloadHash, h);
  assert.equal(e.result, null);
  assert.equal(e.cached, false);
  assert.equal(typeof e.seq, 'number');
  assert.equal(e.inFlight, d.promise);
  assert.equal(reg.lookup('x', h).kind, 'in-flight');

  d.resolve({ status: 'succeeded', marker: 'm' });
  await flush();
  e = reg.map.get('x');
  assert.equal(e.inFlight, null);
  assert.equal(e.cached, true);
  assert.equal(e.result.marker, 'm');
  // registrySnapshot 的读取方式:payloadHash 直读、Boolean(e.result)
  assert.equal(e.payloadHash, h);
  assert.equal(Boolean(e.result), true);
  assert.equal(reg.lookup('x', h).kind, 'cache-hit');

  // uncached settle:result 保持 null(仅指纹),Boolean(e.result) === false
  const reg2 = new RequestRegistry({ maxEntries: 8 });
  const d2 = deferred();
  reg2.track('y', h, d2.promise);
  d2.resolve({ status: 'unknown' });
  await flush();
  const e2 = reg2.map.get('y');
  assert.equal(e2.result, null);
  assert.equal(e2.cached, false);
  assert.equal(Boolean(e2.result), false);
  assert.equal(e2.inFlight, null);
});

test('track 防御:指纹不一致失败关闭不覆写;条目被同ID重注册接管后,旧 promise 迟到 settle 不得改写条目', async () => {
  const reg = new RequestRegistry({ maxEntries: 8 });
  const h1 = hashOf({ op: 't1' });
  const d1 = deferred();
  reg.track('k', h1, d1.promise);
  // 指纹不一致的 track:失败关闭,返回 mismatch,原指纹原样保留
  const res = reg.track('k', hashOf({ op: 'tampered' }), deferred().promise);
  assert.equal(res.kind, 'mismatch');
  assert.equal(reg.map.get('k').payloadHash, h1);
  assert.equal(reg.lookup('k', h1).kind, 'in-flight');
  d1.resolve({ status: 'succeeded', marker: 'first' });
  await flush();
  assert.equal(reg.map.get('k').result.marker, 'first');

  // 接管场景(合法流程不发生,防御直调 misuse):同指纹在途期间再次 track = 接管
  const reg3 = new RequestRegistry({ maxEntries: 8 });
  const da = deferred();
  const db = deferred();
  reg3.track('z', h1, da.promise);
  reg3.track('z', h1, db.promise);
  da.resolve({ status: 'succeeded', marker: 'old' });
  await flush();
  let ez = reg3.map.get('z');
  assert.equal(ez.cached, false, '被接管的旧 settle 不得改写条目');
  assert.equal(ez.inFlight, db.promise, '条目必须仍由新执行持有');
  assert.equal(ez.result, null);
  db.resolve({ status: 'succeeded', marker: 'new' });
  await flush();
  ez = reg3.map.get('z');
  assert.equal(ez.result.marker, 'new', '接管者的 settle 正常落定');
});
