// S1 E0 自检：liveness/readiness 拆分（任务04 §3 / D02 判据种子）与方法白名单。
// 核心判据：依赖全挂时 liveness 仍 ok（进程活着），readiness 必须不 ok 且逐依赖给出原因。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function withServer(deps, fn) {
  const { startEdgeServer } = await import('../src/server.mjs');
  const started = await startEdgeServer({ port: 0, ...deps });
  try {
    return await fn(started.port);
  } finally {
    await started.close();
  }
}

const failingProbe = { name: 'db', ok: false, detail: { error: 'ECONNREFUSED' } };
const passingProbe = { name: 'events-queue', ok: true, detail: { status: 'warm' } };

test('DB 探针失败时：liveness 正常、readiness 不 ok 且逐依赖给原因（D02 种子）', async () => {
  await withServer({
    seal: { buildId: 't', capabilities: { video: 'not_wired', credit: 'not_wired' } },
    probes: [async () => failingProbe, async () => passingProbe],
    store: null,
  }, async (port) => {
    const live = await fetch(`http://127.0.0.1:${port}/healthz/live`);
    const liveBody = await live.json();
    assert.equal(live.status, 200);
    assert.equal(liveBody.ok, true, '进程存活时 liveness 必须 ok');
    assert.equal(liveBody.liveness, true);

    const ready = await fetch(`http://127.0.0.1:${port}/healthz/ready`);
    const readyBody = await ready.json();
    assert.equal(ready.status, 200, 'readiness 用 200 + ok:false 表达（机器可读），不用 5xx 伪装崩溃');
    assert.equal(readyBody.ok, false, '任一必需依赖不可用 → 业务 readiness 不可 ok');
    assert.equal(readyBody.checks.length, 2);
    const db = readyBody.checks.find((c) => c.name === 'db');
    const q = readyBody.checks.find((c) => c.name === 'events-queue');
    assert.equal(db.ok, false);
    assert.equal(q.ok, true);
    assert.ok(readyBody.capabilities && 'video' in readyBody.capabilities, '能力位独立展示');
    assert.equal(readyBody.capabilities.all_ok, undefined, '禁止汇总式 all_ok 字段');
  });
});

test('全部依赖健康时 readiness ok，且 ok 由逐项结果推导', async () => {
  await withServer({
    seal: { buildId: 't', capabilities: {} },
    probes: [async () => ({ ...failingProbe, ok: true, detail: { status: 200 } }), async () => passingProbe],
    store: null,
  }, async (port) => {
    const body = await (await fetch(`http://127.0.0.1:${port}/healthz/ready`)).json();
    assert.equal(body.ok, true);
    assert.ok(body.checks.every((c) => c.ok));
  });
});

test('方法白名单：非 GET 一律 405；未知路径 404；响应 no-store', async () => {
  await withServer({
    seal: { buildId: 't', capabilities: {} }, probes: [], store: null,
  }, async (port) => {
    const base = `http://127.0.0.1:${port}`;
    const post = await fetch(`${base}/versionz`, { method: 'POST' });
    assert.equal(post.status, 405);
    const del = await fetch(`${base}/healthz/live`, { method: 'DELETE' });
    assert.equal(del.status, 405);
    const nf = await fetch(`${base}/no/such/route`);
    assert.equal(nf.status, 404);
    assert.equal((await nf.json()).error, 'NOT_FOUND');
    assert.equal(post.headers.get('cache-control'), 'no-store');
  });
});
