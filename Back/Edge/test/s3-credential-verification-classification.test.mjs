// 步骤0 错误分类整改（2026-09-20）：A 内核不可达时登录不得折叠为 PRINCIPAL_UNTRUSTED(403)。
// 三态探针：200→核实通过；401/403→凭据被拒(403)；不可达/超时/5xx→CREDENTIAL_VERIFICATION_UNAVAILABLE(503)。
// 背景：jw-takeoff-pg 容器退出 → A 内核 ECONNREFUSED → 登录 403 曾被误读为凭据错误。
// 全部自足（随机端口可控上游/关闭端口，无 docker/PG/真实 A）。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createLiveCredentialVerifier, startEdgeServer } from '../src/server.mjs';
import { createFixtureStore } from '../src/store.mjs';
import { createSessionStore } from '../src/session.mjs';
import { createAuditSink } from '../src/audit.mjs';

// 可控 A 内核替身：按配置状态码应答探针（GET /api/v2/receipts/__jw-edge-probe__）。
function startProbeKernel({ status = 200 } = {}) {
  const probes = [];
  const server = http.createServer((req, res) => {
    probes.push({ path: req.url, credential: req.headers['x-principal-credential'] || null });
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: status === 200 }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, probes, port: server.address().port, close: () => new Promise((r) => server.close(r)) }));
  });
}

const directory = () => ({
  byHash: new Map([[
    createHash('sha256').update('tk-biz1').digest('hex'),
    { principalId: 'biz1', roles: ['business'], tenantId: 'tt1' },
  ]]),
  byPrincipal: new Map([['biz1', { principalId: 'biz1', roles: ['business'], tenantId: 'tt1', credential: 'tk-biz1' }]]),
  list: [{ principalId: 'biz1', roles: ['business'] }],
});

test('探针200→核实通过：verdict ok 且返回 principal/tenant', async () => {
  const kernel = await startProbeKernel({ status: 200 });
  try {
    const verify = createLiveCredentialVerifier({ kernelBase: `http://127.0.0.1:${kernel.port}`, directory: directory() });
    const v = await verify({ credential: 'tk-biz1' });
    assert.equal(v.ok, true);
    assert.equal(v.principalId, 'biz1');
    assert.equal(v.tenantId, 'tt1');
    assert.equal(kernel.probes.length, 1);
    assert.equal(kernel.probes[0].credential, 'tk-biz1');
  } finally { await kernel.close(); }
});

test('探针401/403→A 明确拒绝：PRINCIPAL_UNTRUSTED（凭据错误类）', async () => {
  for (const status of [401, 403]) {
    const kernel = await startProbeKernel({ status });
    try {
      const verify = createLiveCredentialVerifier({ kernelBase: `http://127.0.0.1:${kernel.port}`, directory: directory() });
      const v = await verify({ credential: 'tk-biz1' });
      assert.equal(v.ok, false);
      assert.equal(v.reason, 'PRINCIPAL_UNTRUSTED');
    } finally { await kernel.close(); }
  }
});

test('探针500→基础设施不可用：CREDENTIAL_VERIFICATION_UNAVAILABLE（非凭据错误）', async () => {
  const kernel = await startProbeKernel({ status: 500 });
  try {
    const verify = createLiveCredentialVerifier({ kernelBase: `http://127.0.0.1:${kernel.port}`, directory: directory() });
    const v = await verify({ credential: 'tk-biz1' });
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'CREDENTIAL_VERIFICATION_UNAVAILABLE');
  } finally { await kernel.close(); }
});

test('A 内核连接拒绝（容器退出形态）→ CREDENTIAL_VERIFICATION_UNAVAILABLE', async () => {
  // 先占一个端口再关闭，得到确定拒绝连接的端口（避免碰真实服务端口）
  const gate = await startProbeKernel({});
  const deadPort = gate.port;
  await gate.close();
  const verify = createLiveCredentialVerifier({ kernelBase: `http://127.0.0.1:${deadPort}`, directory: directory() });
  const v = await verify({ credential: 'tk-biz1' });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'CREDENTIAL_VERIFICATION_UNAVAILABLE');
  assert.match(v.note, /非凭据错误/);
});

test('目录无此凭据→PRINCIPAL_UNTRUSTED 且不发探针', async () => {
  const kernel = await startProbeKernel({ status: 200 });
  try {
    const verify = createLiveCredentialVerifier({ kernelBase: `http://127.0.0.1:${kernel.port}`, directory: directory() });
    const v = await verify({ credential: 'tk-unknown' });
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'PRINCIPAL_UNTRUSTED');
    assert.equal(kernel.probes.length, 0);
  } finally { await kernel.close(); }
});

// HTTP 面：不可达类映射 503，凭据拒绝映射 403；两码可辨供前端分支提示。
async function buildEdgeWithVerify(verifyCredential) {
  return startEdgeServer({
    port: 0,
    seal: { buildId: 'test-cred-classification', capabilities: { note: 'test' } },
    probes: [],
    store: createFixtureStore(),
    auth: async () => ({ ok: true }),
    sessionStore: createSessionStore({}),
    verifyCredential,
    auditSink: createAuditSink(),
  });
}
async function exchange(edgePort, body) {
  const r = await fetch(`http://127.0.0.1:${edgePort}/api/jw/v2/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}

test('会话交换：CREDENTIAL_VERIFICATION_UNAVAILABLE→503；PRINCIPAL_UNTRUSTED→403', async () => {
  const unavailable = await buildEdgeWithVerify(async () => ({ ok: false, reason: 'CREDENTIAL_VERIFICATION_UNAVAILABLE' }));
  try {
    const r503 = await exchange(unavailable.port, { credential: 'tk-biz1' });
    assert.equal(r503.status, 503);
    assert.equal(r503.json.error, 'CREDENTIAL_VERIFICATION_UNAVAILABLE');
  } finally { await unavailable.close(); }

  const rejected = await buildEdgeWithVerify(async () => ({ ok: false, reason: 'PRINCIPAL_UNTRUSTED' }));
  try {
    const r403 = await exchange(rejected.port, { credential: 'tk-biz1' });
    assert.equal(r403.status, 403);
    assert.equal(r403.json.error, 'PRINCIPAL_UNTRUSTED');
  } finally { await rejected.close(); }
});
