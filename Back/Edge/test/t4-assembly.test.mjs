// 任务04 §三/§四·装配级 E0 测试（真实 edge-start/server 链路，stub 上游自足，无 docker/PG/A 实例）：
//   1) edge-start 透传 --connectors-url/--connectors-token-file（此前未透传 → 页面处理通道全部
//      误报 PROXY_ROUTE_NOT_DECLARED 的根因修复）；
//   2) readiness 分项：kernel-a / db / connectors（进程）/ connectors-channel（服务令牌前置）；
//      未配置通道时为 advisory 检查（如实显示，不参与聚合）；
//   3) 消息 + 幂等回执持久化：Edge 守护进程重启后线程仍在、同 requestId 重放仍返回原回执。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

// stub A 内核：健康/凭据探针/客户授权裁决（cust-1 可读、其他 403）。
function stubKernel() {
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, db: 'up', contractVersion: 'v1.3+stub' }));
    if (req.url.startsWith('/api/v2/receipts/')) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
    const m = req.url.match(/^\/api\/v2\/customers\/([^/?]+)/);
    if (m) {
      const okCustomer = decodeURIComponent(m[1]) === 'cust-1';
      return res.writeHead(okCustomer ? 200 : 403, { 'content-type': 'application/json' }).end(JSON.stringify(okCustomer ? { ok: true } : { ok: false, error: 'PERMISSION_DENIED' }));
    }
    res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: 'NOT_FOUND' }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, close: () => new Promise((r) => server.close(r)) }));
  });
}

// stub Connectors：健康 + 处理面（记录服务令牌）。
function stubChannel() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ path: req.url, method: req.method, token: req.headers['x-service-token'] ?? null });
      if (req.url === '/healthz') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, service: 'jw-connectors' }));
      if (req.url.startsWith('/api/connectors/processing/tasks/')) {
        return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, task: { task_id: 'tk-1', customer_id: 'cust-1', tenant_id: 't1' } }));
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, echo: body ? JSON.parse(body) : null }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port, close: () => new Promise((r) => server.close(r)) }));
  });
}

const run = (cmd, args, timeoutMs = 30000) => new Promise((resolve) => {
  execFile(cmd, args, { windowsHide: true, timeout: timeoutMs, cwd: EDGE_ROOT, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
    resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
  });
});

async function waitLive(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz/live`, { signal: AbortSignal.timeout(800) });
      if (r.status === 200) return true;
    } catch { /* 未就绪继续等 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

test('装配 E0：透传通道配置→readiness 分项含 connectors；通道读写经会话与逐资源授权；重启恢复消息与回执', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'jw-edge-assembly-'));
  const runDir = path.join(tmp, 'run');
  const messagesFile = path.join(runDir, 'edge-messages.db');
  const authFile = path.join(tmp, 'edge-auth.json');
  writeFileSync(authFile, JSON.stringify({ entries: [{ credential: 'tok-biz-acc', principalId: 'biz-acc', roles: ['business'] }] }));
  const kernel = await stubKernel();
  const channel = await stubChannel();
  const edgePort = await freePort();
  const base = `http://127.0.0.1:${edgePort}`;

  const startArgs = () => [
    path.join(EDGE_ROOT, 'scripts', 'edge-start.mjs'),
    '--port', String(edgePort), '--live',
    '--kernel-port', String(kernel.port), '--db-port', String(kernel.port),
    '--auth-file', authFile,
    '--connectors-url', `http://127.0.0.1:${channel.port}`,
    '--connectors-token-file', path.join(tmp, 'channel-token.txt'),
    '--connectors-tenant', 't1',
    '--messages-file', messagesFile,
    '--run-dir', runDir,
  ];
  writeFileSync(path.join(tmp, 'channel-token.txt'), 'svc-token-assembly');
  const stop = async () => run(process.execPath, [path.join(EDGE_ROOT, 'scripts', 'edge-stop.mjs'), '--run-dir', runDir]);

  try {
    // —— 第一次启动：透传生效 + readiness 分项 ——
    const up1 = await run(process.execPath, startArgs());
    assert.ok(!up1.err, `edge-start 应成功：${up1.stderr.slice(0, 300)}`);
    assert.ok(await waitLive(edgePort), 'Edge 守护进程应在 20s 内 live');

    const ready = await (await fetch(`${base}/healthz/ready`)).json();
    const names = ready.checks.map((c) => c.name);
    assert.ok(names.includes('kernel-a') && names.includes('db'), `readiness 分项应含 kernel-a/db：${names}`);
    assert.ok(names.includes('connectors') && names.includes('connectors-channel'), `readiness 分项应含 connectors/connectors-channel：${names}`);
    const byName = Object.fromEntries(ready.checks.map((c) => [c.name, c]));
    assert.equal(byName['connectors'].ok, true, '通道进程检查通过');
    assert.equal(byName['connectors-channel'].ok, true, '服务令牌前置检查通过');
    assert.equal(ready.ok, true, '全部分项通过 → 聚合就绪');

    const vz = await (await fetch(`${base}/versionz`)).json();
    assert.match(String(vz.capabilities?.channel ?? ''), /wired/, '能力位如实标 wired');

    // 无会话 → 401（通道代理已接线；不再是 404 PROXY_ROUTE_NOT_DECLARED 兜底）。
    const anon = await fetch(`${base}/api/jw/v2/connectors/processing/status?tid=t1&cid=cust-1`);
    assert.equal(anon.status, 401);

    // 登录后：读面归属校验 + 写面转发（服务令牌只在服务端附加）。
    const login = await fetch(`${base}/api/jw/v2/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: 'tok-biz-acc' }) });
    const loginBody = await login.json();
    assert.equal(login.status, 200, `live 会话交换应成功（stub A 探针）：${JSON.stringify(loginBody)}`);
    const sid = loginBody.session.sessionId;

    const task = await fetch(`${base}/api/jw/v2/connectors/processing/tasks/tk-1?tid=t1`, { headers: { 'x-jw-session': sid } });
    assert.equal(task.status, 200);
    assert.equal((await task.json()).task.customer_id, 'cust-1');

    const upload = await fetch(`${base}/api/jw/v2/actions/connectors/evidence/upload`, {
      method: 'POST', headers: { 'x-jw-session': sid, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'asm-u1', tenantId: 't1', customerId: 'cust-1', invitationId: 'inv-1', kind: 'invoice', contentBase64: 'aGk=' }),
    });
    assert.equal(upload.status, 200);
    assert.ok(channel.seen.some((s) => s.token === 'svc-token-assembly'), '上游看到服务端附加的服务令牌');

    // 消息：发送 + 读回。
    const send = await fetch(`${base}/api/jw/v2/customers/cust-1/messages`, {
      method: 'POST', headers: { 'x-jw-session': sid, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'asm-m1', audience: 'customer', text: '重启前消息' }),
    });
    assert.equal(send.status, 200);
    const read1 = await (await fetch(`${base}/api/jw/v2/customers/cust-1/messages`, { headers: { 'x-jw-session': sid } })).json();
    assert.equal(read1.messages.length, 1);
    assert.equal(read1.messages[0].text, '重启前消息');

    // —— 重启：Edge 停止 → 重新 start（同一 messages 库）→ 消息与幂等回执仍在 ——
    const down1 = await stop();
    assert.ok(!down1.err, `edge-stop 应成功：${down1.stderr.slice(0, 200)}`);
    assert.ok(!(await waitLive(edgePort, 3000)), '停止后端口不再服务');

    const up2 = await run(process.execPath, startArgs());
    assert.ok(!up2.err, `重启应成功：${up2.stderr.slice(0, 300)}`);
    assert.ok(await waitLive(edgePort), '重启后 live');

    const login2 = await fetch(`${base}/api/jw/v2/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: 'tok-biz-acc' }) });
    const sid2 = (await login2.json()).session.sessionId;
    const read2 = await (await fetch(`${base}/api/jw/v2/customers/cust-1/messages`, { headers: { 'x-jw-session': sid2 } })).json();
    assert.equal(read2.messages.length, 1, '重启后消息线程仍在（不再用内存 Map）');
    assert.equal(read2.messages[0].text, '重启前消息');

    const replay = await fetch(`${base}/api/jw/v2/customers/cust-1/messages`, {
      method: 'POST', headers: { 'x-jw-session': sid2, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'asm-m1', audience: 'customer', text: '重启前消息' }),
    });
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).replayed, true, '重启后同 requestId 重放仍返回原回执（持久幂等）');
    const read3 = await (await fetch(`${base}/api/jw/v2/customers/cust-1/messages`, { headers: { 'x-jw-session': sid2 } })).json();
    assert.equal(read3.messages.length, 1, '重放不二次入栈');

    const down2 = await stop();
    assert.ok(!down2.err, `二次停止应成功：${down2.stderr.slice(0, 200)}`);
  } finally {
    await stop().catch(() => { });
    // 兜底：run-dir 内 pidfile 若仍在则按标记复核后清理（仅本测试自己的守护进程）。
    try {
      const { readFileSync, existsSync } = await import('node:fs');
      const pf = path.join(runDir, 'edge.pid');
      if (existsSync(pf)) {
        const rec = JSON.parse(readFileSync(pf, 'utf8'));
        try { process.kill(rec.pid); } catch { /* 已退出 */ }
      }
    } catch { /* 清理尽力而为 */ }
    await kernel.close();
    await channel.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});
