// S3 E0：browser-harness 静态服务（穿越防护/CSP）+ 页面关键 API 流程可走通（工程验证页，非视觉验收）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { startFixtureUpstream, buildEdge } from './helpers.mjs';

test('静态服务：页面可达、资源类型正确、带 CSP 与 nosniff', async () => {
  const up = await startFixtureUpstream();
  const edge = await buildEdge({ upstreamPort: up.port });
  try {
    const base = `http://127.0.0.1:${edge.port}`;
    const page = await fetch(`${base}/harness/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    const html = await page.text();
    assert.ok(html.includes('browser-harness'), '标题标识存在');
    assert.ok(html.includes('/harness/app.js'), '页面引用同源脚本');

    const js = await fetch(`${base}/harness/app.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);
    assert.ok((await js.text()).includes('EventSource'), '脚本含 SSE 订阅逻辑');
  } finally {
    await edge.close();
    await up.close();
  }
});

test('路径穿越防护：编码绕过不落文件内容；越出根目录一律拒绝', async () => {
  const up = await startFixtureUpstream();
  const edge = await buildEdge({ upstreamPort: up.port });
  try {
    const base = `http://127.0.0.1:${edge.port}`;
    // WHATWG URL 规范化后越出 /harness 前缀 → 落回 404 JSON，不泄露文件
    const r1 = await fetch(`${base}/harness/../src/version.mjs`);
    assert.equal(r1.status, 404);
    // 保留百分号编码的穿越尝试：不解码即按字面文件名查找 → 404，绝无源码内容
    const r2 = await fetch(`${base}/harness/%2e%2e/%2e%2e/src/version.mjs`);
    assert.equal(r2.status, 404);
    const t2 = await r2.text();
    assert.equal(t2.includes('collectVersionSeal'), false, '源码内容不得泄露');
  } finally {
    await edge.close();
    await up.close();
  }
});

test('页面关键 API 流程可走通：登录→快照→订阅→发消息→审计（app.js 同款调用序列）', async () => {
  const up = await startFixtureUpstream();
  const edge = await buildEdge({ upstreamPort: up.port });
  try {
    const base = `http://127.0.0.1:${edge.port}`;
    const j = async (path, opts) => { const r = await fetch(`${base}${path}`, opts); return { status: r.status, body: await r.json(), headers: r.headers }; };

    const login = await j('/api/jw/v2/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: 'tok-demo' }) });
    assert.equal(login.status, 200);
    const H = { 'content-type': 'application/json', 'x-jw-session': login.body.session.sessionId };

    const ws = await j('/api/jw/v2/customers/cust-1001/workspace', { headers: H });
    assert.equal(ws.status, 200);
    assert.ok(ws.body.snapshot.domains, '快照含四域状态（页面渲染源）');

    const msg = await j('/api/jw/v2/customers/cust-1001/messages', { method: 'POST', headers: H, body: JSON.stringify({ requestId: 'flow-1', audience: 'customer', text: '请补充发票' }) });
    assert.equal(msg.status, 200);

    const audit = await j('/api/jw/v2/audit', { headers: H });
    assert.equal(audit.status, 200);
    assert.ok(audit.body.entries.some((e) => e.detail && e.detail.requestId === 'flow-1'), '审计包含刚发送的消息');
  } finally {
    await edge.close();
    await up.close();
  }
});
