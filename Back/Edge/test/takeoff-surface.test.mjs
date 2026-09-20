// TAKEOFF-FA-1.0.0 路04 · Edge 接线 E0 测试（自足：stub 上游/通道，无 docker/PG/A）：
//   1) 准入投影纯函数：kind→域冻结映射、取代/判重不入输入行、stale/needsReview/关键发现→阻断+霜冻、
//      分母未知=null、本投影绝不产生 100%绿（03业务规则§4 / 01契约§7）；
//   2) confirm-preassessment 动作代理：白名单登记、路径映射、requestId 强制、未登记路径拒绝；
//   3) 候选修订历史读口与 03 收口读面（cid/tid → customerId/tenantId 映射 + 服务令牌/逐客户校验）。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startEdgeServer } from '../src/server.mjs';
import { createSessionStore } from '../src/session.mjs';
import { createUpstreamProxy, ACTION_ROUTES } from '../src/proxy.mjs';
import { createReadProxy, READ_ROUTES, CONNECTORS_READ_ROUTES } from '../src/readproxy.mjs';
import { createChannelAuthorizers } from '../src/channel-authz.mjs';
import { deriveAdmission, DOMAIN_BY_EVIDENCE_KIND, TAKEOFF_DOMAINS } from '../src/admission-projection.mjs';

// ---------- 1) 准入投影纯函数 ----------

const baseAssessment = { assessmentId: 'ass-1', tenantId: 't1', status: 'awaiting_human_review', version: 4, stale: false, inputVersion: 1, candidateRevision: 2, candidate: { tendency: 'increase', supportableAmountMinor: 5_000_00, suggestedTermMonths: 36, referencePriceMinor: 8_50, priceUnit: 'per_annum_rate_bps', conditions: ['X'] } };

test('投影：五域×四行全生成；取代/判重件不进输入行；分母未知=null；绝不产生100%或completed', () => {
  const artifacts = [
    { artifactId: 'a1', kind: 'legal_document' },
    { artifactId: 'a2', kind: 'equipment_list' },
    { artifactId: 'a3', kind: 'equipment_list', supersededBy: 'a2' }, // 被 C1 取代（T08）
    { artifactId: 'a4', kind: 'ownership_document', duplicateOf: 'a0' }, // D1 判重（T05）
    { artifactId: 'a5', kind: 'mystery_kind' }, // 未知 kind：保守不映射
  ];
  const adm = deriveAdmission({ customerId: 'c1', assessments: [baseAssessment], artifacts });
  assert.equal(adm.cells.length, TAKEOFF_DOMAINS.length * 4);
  const asset = adm.cells.filter((c) => c.domain === 'asset');
  const input = asset.find((c) => c.row === 'input');
  assert.equal(input.satisfiedItemCount, 1, 'a2 现行；a3 取代、a4 判重、a5 未映射均不计');
  assert.equal(input.requiredItemCount, null, '必要集合无权威分母 → null');
  for (const c of adm.cells) {
    assert.notEqual(c.displayBucket, 100, '投影不产生办结绿');
    assert.equal(c.completed, false);
  }
  assert.equal(adm.scope.assessmentId, 'ass-1');
  assert.equal(adm.candidate.version, 2);
  assert.equal(adm.candidate.suggestedTermMonths, 36, '同版期限来自同一候选（01契约 §13.2）');
});

test('投影：无评估=无范围如实；stale/needsReview/关键发现 → 阻断与霜冻；outcome 三态映射', () => {
  const empty = deriveAdmission({ customerId: 'c1', assessments: [], artifacts: [] });
  assert.equal(empty.scope.sourceStatus, 'no_assessment');
  assert.equal(empty.candidate, null);

  const stale = deriveAdmission({
    customerId: 'c1',
    assessments: [{ ...baseAssessment, stale: true, staleReasons: ['artifact_superseded'] }],
    artifacts: [],
  });
  assert.equal(stale.frozen.active, true);
  assert.ok(stale.frozen.reasons.includes('STALE_BASIS'));
  assert.ok(stale.blockers.some((b) => b.reason === 'STALE_BASIS'));

  const flagged = deriveAdmission({
    customerId: 'c1',
    assessments: [{ ...baseAssessment, preassessment: { confirmationId: 'pac-1', outcome: 'support', scope: 'preassessment_only', needsReview: true, reviewReason: 'snapshot_artifact_superseded' } }],
    artifacts: [],
  });
  assert.equal(flagged.preassessment.needsReview, true);
  assert.equal(flagged.frozen.active, true, '确认后依据被取代 → 显示需复核+霜冻投影（历史确认不覆盖）');

  const neg = deriveAdmission({
    customerId: 'c1',
    assessments: [{ ...baseAssessment, preassessment: { confirmationId: 'pac-2', outcome: 'not_support', scope: 'preassessment_only' } }],
    artifacts: [],
  });
  const negCell = neg.cells.filter((c) => c.row === 'completion');
  assert.ok(negCell.every((c) => c.outcome === '负面'), '负面也是结论（不要求刷绿）');

  const critical = deriveAdmission({
    customerId: 'c1',
    assessments: [baseAssessment],
    artifacts: [],
    findings: [{ findingId: 'f1', findingType: 'FACT_CONFLICT', severity: 'critical', status: 'open' }],
  });
  assert.ok(critical.blockers.some((b) => b.scope === 'finding' && b.reason === 'FACT_CONFLICT'));
  assert.ok(critical.frozen.active, '未处理关键冲突 → 霜冻投影（控制逻辑在 A 确认门序）');
});

test('投影：处理失败件进输入行阻断并带 nextAction；kind→域映射与 03 PROTOCOL §1 冻结面一致', () => {
  const adm = deriveAdmission({
    customerId: 'c1',
    assessments: [baseAssessment],
    artifacts: [{ artifactId: 'a9', kind: 'financial_statement', procStage: 'failed', procFailureReason: 'CSV_MALFORMED', procNextAction: 'manual_entry' }],
  });
  const creditInput = adm.cells.find((c) => c.domain === 'credit' && c.row === 'input');
  assert.ok(creditInput.blockers.some((b) => b.reason === 'PROCESSING_FAILED' && b.requiredAction === 'manual_entry'));
  assert.equal(DOMAIN_BY_EVIDENCE_KIND.equipment_list.includes('asset'), true);
  assert.equal(DOMAIN_BY_EVIDENCE_KIND.litigation_document.includes('policy'), true);
  assert.equal(DOMAIN_BY_EVIDENCE_KIND.unknown_kind, undefined);
});

// ---------- 2) confirm-preassessment 动作代理 ----------

function stubUpstream() {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ path: req.url, credential: req.headers['x-principal-credential'] ?? null, actor: req.headers['x-jw-actor-principal'] ?? null, body: body ? JSON.parse(body) : null });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, confirmationId: 'pac-test', scope: 'preassessment_only' }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, received, port: server.address().port, close: () => new Promise((r) => server.close(r)) })));
}

async function login(port, credential) {
  const res = await fetch(`http://127.0.0.1:${port}/api/jw/v2/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }),
  });
  return (await res.json()).session;
}

test('TAKEOFF 确认命令经白名单转发：路径映射正确、requestId 强制、可信actor头服务端派生；白名单外拒绝', async (t) => {
  assert.ok(ACTION_ROUTES.some((r) => r.pattern.test('/api/jw/v2/actions/assessments/ass-1/confirm-preassessment')), '路由已登记');
  assert.ok(ACTION_ROUTES.some((r) => r.pattern.test('/api/jw/v2/actions/assessments/ass-1/admission-request')), '§13.5 需求登记命令已登记');
  const up = await stubUpstream();
  const { buildEdge } = await import('./helpers.mjs');
  const edge = await buildEdge({ upstreamPort: up.port });
  await t.test('inner', async () => {
    const base = `http://127.0.0.1:${edge.port}`;
    const sess = await login(edge.port, 'tok-demo');
    const okRes = await fetch(`${base}/api/jw/v2/actions/assessments/ass-1/confirm-preassessment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-jw-session': sess.sessionId },
      body: JSON.stringify({ requestId: 'rq-confirm-1', tenantId: 't1', assessmentVersion: 4, outcome: 'support', rationale: 'x' }),
    });
    assert.equal(okRes.status, 200);
    assert.equal(up.received[0].path, '/api/v2/assessments/ass-1/confirm-preassessment');
    assert.equal(up.received[0].body.requestId, 'rq-confirm-1');
    assert.equal(up.received[0].credential, 'cred-for-demo-user');
    assert.equal(up.received[0].actor, 'demo-user', '可信actor由服务端会话派生');

    const noId = await fetch(`${base}/api/jw/v2/actions/assessments/ass-1/confirm-preassessment`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-jw-session': sess.sessionId }, body: '{}',
    });
    assert.equal(noId.status, 400);
    assert.equal((await noId.json()).error, 'REQUEST_ID_REQUIRED');

    const evil = await fetch(`${base}/api/jw/v2/actions/assessments/ass-1/approve-facility-secretly`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-jw-session': sess.sessionId }, body: JSON.stringify({ requestId: 'rq-x' }),
    });
    assert.equal(evil.status, 404);
    assert.equal((await evil.json()).error, 'PROXY_ROUTE_NOT_DECLARED');
  });
  edge.close();
  up.close();
});

// ---------- 3) 候选历史读口 + 03 收口读面（通道参数映射 + 逐客户校验） ----------

function stubChannel() {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ path: req.url, token: req.headers['x-service-token'] ?? null });
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, finalization: { amountCandidate: { evaluable: true } } }));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port, close: () => new Promise((r) => server.close(r)) })));
}

test('读面：assessments/:id/candidates 白名单登记；finalization 面tid/cid透传并逐客户校验', async () => {
  assert.ok(READ_ROUTES.some((r) => r.pattern.test('/api/jw/v2/assessments/ass-1/candidates')), '候选历史读口已登记');
  const up = await stubUpstream();
  const channel = await stubChannel();
  const sessionStore = createSessionStore({});
  const verifyCredential = async ({ credential }) => (credential === 'tok-biz' ? { ok: true, principalId: 'p-biz', roles: ['business'] } : { ok: false, reason: 'PRINCIPAL_UNTRUSTED' });
  const store = {
    checkCustomer: async (customerId, { credential } = {}) => (credential === 'tok-biz' && customerId === 'cust-1' ? { ok: true } : { ok: false, status: 403, code: 'PERMISSION_DENIED' }),
  };
  const { writeAuthorize, readAuthorize } = createChannelAuthorizers({ store });
  const proxy = createUpstreamProxy({ baseUrl: `http://127.0.0.1:${up.port}`, credentialFor: (s) => `cred-for-${s.principalId}` });
  const readProxy = createReadProxy({ baseUrl: `http://127.0.0.1:${up.port}`, credentialFor: (s) => `cred-for-${s.principalId}`, routes: READ_ROUTES });
  const connectorsReadProxy = createReadProxy({
    baseUrl: `http://127.0.0.1:${channel.port}`, credentialFor: () => 'svc-token-x', headerName: 'X-Service-Token',
    routes: CONNECTORS_READ_ROUTES, authorize: readAuthorize,
  });
  const started = await startEdgeServer({
    port: 0, seal: { buildId: 'test-takeoff', capabilities: {} }, probes: [], store,
    auth: async () => ({ ok: true }), sessionStore, verifyCredential, proxy, readProxy, connectorsReadProxy,
  });
  try {
    const base = `http://127.0.0.1:${started.port}`;
    const sess = await login(started.port, 'tok-biz');
    const h = { 'x-jw-session': sess.sessionId };

    const cand = await fetch(`${base}/api/jw/v2/assessments/ass-1/candidates`, { headers: h });
    assert.equal(cand.status, 200);
    assert.equal(up.received.at(-1).path, '/api/v2/assessments/ass-1/candidates');

    const fin = await fetch(`${base}/api/jw/v2/connectors/analysis/finalization?tid=tt1&cid=cust-1`, { headers: h });
    assert.equal(fin.status, 200);
    assert.equal(channel.seen[0].path, '/api/connectors/analysis/finalization?tid=tt1&cid=cust-1', 'tid/cid 原样透传（03面上游参数名）');
    assert.equal(channel.seen[0].token, 'svc-token-x', '服务令牌只由服务端附加');

    const alien = await fetch(`${base}/api/jw/v2/connectors/analysis/finalization?tid=tt1&cid=cust-other`, { headers: h });
    assert.equal(alien.status, 403, '跨客户读拒绝（不转发）');
    assert.equal(channel.seen.length, 1, '拒绝时上游零触达');
  } finally {
    started.close();
    up.close();
    channel.close();
  }
});

test('真实 A 原件 material.kind 归域，解析衍生件不重复计数，未知分母不伪造进度', () => {
  const result = deriveAdmission({customerId:'synthetic-c',artifacts:[
    {artifactId:'a',kind:'material.financial_statement'},
    {artifactId:'b',kind:'material.equipment_list'},
    {artifactId:'parsed',kind:'parse_extraction'},
    {artifactId:'old',kind:'material.equipment_list',supersededBy:'b'},
    {artifactId:'duplicate',kind:'material.equipment_list',duplicateOf:'b'},
    {artifactId:'unknown',kind:'material.unconfigured_kind'},
  ]});
  for (const [domain,count] of [['business',1],['credit',1],['commerce',2],['asset',1],['policy',0]]) {
    const cell=result.cells.find(c=>c.domain===domain&&c.row==='input');
    assert.equal(cell.satisfiedItemCount,count,domain);
    assert.equal(cell.displayBucket,null); assert.equal(cell.completed,false);
  }
});
