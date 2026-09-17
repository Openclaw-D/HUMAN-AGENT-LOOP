// goal-03 C3 测试：--serve-front 同源受控前端（frontHandler）。
// 只验证 Edge 服务行为（根挂载/SPA 回退/资产服务/API 404 不被遮蔽/harness 优先），不依赖 Front/dist。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const startWith = async (frontDir) => {
  const { startEdgeServer } = await import('../src/server.mjs');
  const { createStaticHandler } = await import('../src/static.mjs');
  const frontHandler = frontDir ? createStaticHandler({ rootDir: frontDir, urlPrefix: '' }) : null;
  return startEdgeServer({
    port: 0,
    seal: { buildId: 'test', capabilities: {} },
    store: { getWorkspace: async () => null, subscribe: () => () => {} },
    auth: async () => ({ ok: false, reason: 'PRINCIPAL_UNTRUSTED' }),
    frontHandler,
  });
};

test('C3 同源前端：/ 与资产由 Edge 同源服务；未知非 API 路径回退 index.html；API 404 不被遮蔽', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'jw-g03-front-'));
  try {
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><body>jw-g03-app</body></html>');
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
    const inst = await startWith(dir);
    const base = `http://127.0.0.1:${inst.port}`;
    const get = async (p) => {
      const r = await fetch(base + p);
      return { status: r.status, type: r.headers.get('content-type') ?? '', body: await r.text(), csp: r.headers.get('content-security-policy') };
    };
    const root = await get('/');
    assert.equal(root.status, 200);
    assert.match(root.type, /text\/html/);
    assert.match(root.body, /jw-g03-app/);
    assert.match(root.csp, /connect-src 'self'/); // CSP 不因同源托管放宽
    const asset = await get('/assets/app.js');
    assert.equal(asset.status, 200);
    assert.match(asset.type, /text\/javascript/);
    const spa = await get('/some/spa-route');
    assert.equal(spa.status, 200);
    assert.match(spa.body, /jw-g03-app/);
    const apiMiss = await get('/api/jw/v2/definitely-unknown');
    assert.equal(apiMiss.status, 404);
    assert.match(apiMiss.body, /NOT_FOUND/); // API 命名空间保持 JSON 404
    const vz = await get('/versionz');
    assert.equal(vz.status, 200); // 既有健康/版本面不受影响
    await inst.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('C3 未配置 frontHandler：行为与既有完全一致（未知路径 JSON 404）', async () => {
  const inst = await startWith(null);
  const r = await fetch(`http://127.0.0.1:${inst.port}/`);
  assert.equal(r.status, 404);
  assert.match(await r.text(), /NOT_FOUND/);
  await inst.close();
});
