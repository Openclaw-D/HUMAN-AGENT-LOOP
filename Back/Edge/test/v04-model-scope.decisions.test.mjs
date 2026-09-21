// R2-03 材料scope贯穿模型调用与回执摘要 · 决策HTTP层专项（本地可计数替身，零真实出站）。
// 全栈：startEdgeServer → assistant-decisions(materialScope) → provider(02路) → Connectors替身
//       → assistant-model(selection复核) → B transport替身 → 决策仓库（文件持久，支持整栈重启）。
// 每例断言模型替身真实出站命中数（不以 HTTP 返回码代替）；Connectors替身断言请求正文与失败关闭。
// 不含 observe 路径（server 请求参数挂载留串行集成）；替身不构成真实模型质量测试。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createAssistantModel } from '../src/assistant-model.mjs';
import { createAssistantEvidenceProvider } from '../src/assistant-evidence-provider.mjs';
import { createDecisionFeedbackStore } from '../src/decision-feedback-store.mjs';
import { startEdgeServer } from '../src/server.mjs';
import { createFixtureStore } from '../src/store.mjs';
import { createSessionStore } from '../src/session.mjs';
import { startTransportStub } from '../../B/test/v04-transport-stub.mjs';

const TEXT_A = '合成材料甲：申请设备回租500万元，合同未付余额为应收，需核对付款流水与发票一致。';
const TEXT_B = '合成材料乙：开票期间与经营流水期间不同，需核对期间归属与重复交易。';
const hashOf = t => createHash('sha256').update(t).digest('hex');
const HASH_A = hashOf(TEXT_A), HASH_B = hashOf(TEXT_B);

async function startConnectorsStub() {
  let hits = 0;
  const requests = [];
  const control = { omit: [], status500: false };
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c);
    req.on('end', async () => {
      hits++; const body = JSON.parse(raw); requests.push(body);
      if (control.status500) { res.writeHead(500); res.end(JSON.stringify({ ok: false, error: 'STUB_DOWN' })); return; }
      const materials = body.artifactIds.filter(id => !control.omit.includes(id)).map(id => ({
        tenantId: body.tenantId, customerId: body.customerId, artifactId: id,
        evidenceId: 'ev-' + id, hash: id === 'art-a' ? HASH_A : HASH_B,
        parserVersion: 'v04-test-v1', current: true, text: id === 'art-a' ? TEXT_A : TEXT_B,
        facts: [], limitations: [],
      }));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, materials }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const close = async () => { server.closeAllConnections(); return new Promise(r => server.close(r)); };
  return { url: `http://127.0.0.1:${server.address().port}`, hits: () => hits, requests, control, close };
}

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'v04-msd-'));
  t.after(async () => { assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(dir, { recursive: true, force: true }); });
  const conn = await startConnectorsStub();
  t.after(() => conn.close());
  const modelStub = await startTransportStub({ label: 'v04-decisions-scope' });
  modelStub.control.decisions = true;
  t.after(() => modelStub.close());
  const modelConfigPath = path.join(dir, 'model-config.json');
  await fs.writeFile(modelConfigPath, JSON.stringify({
    transport: { mode: 'mock', mock: { baseUrl: modelStub.url, timeoutMs: 2000 } },
    evidencePolicy: { allowedHashes: [HASH_A, HASH_B] },
  }));
  const snapshot = { customer: { name: '合成客户' }, artifactsReadable: true,
    artifacts: [{ artifactId: 'art-a' }, { artifactId: 'art-b' }],
    admission: { inputVersion: 1, scope: { tenantId: 'tenant', revision: 1 }, cells: [], blockers: [] } };
  let edge = null;
  // 整栈（重）启动：新模型实例（回执自盘载入）、新 Edge、新会话存储；决策仓库/回执目录持久。
  const startEdge = async () => {
    const model = await createAssistantModel({ configPath: modelConfigPath, receiptsDir: path.join(dir, 'model-state'), requireEvidence: true, log: () => { } });
    const provider = createAssistantEvidenceProvider({ baseUrl: conn.url, token: 'synthetic-token', policy: model.evidencePolicy });
    const store = createFixtureStore(); store.upsertCustomer('customer', snapshot);
    return startEdgeServer({ port: 0, seal: {}, probes: [], store, sessionStore: createSessionStore({}),
      verifyCredential: async ({ credential }) => ({ ok: true, principalId: credential, roles: ['credit'], tenantId: 'tenant' }),
      auth: async ({ session }) => ({ ok: !!session }), assistantModel: model, assistantEvidence: provider,
      decisionRepository: createDecisionFeedbackStore(dir) });
  };
  edge = await startEdge();
  const base = () => `http://127.0.0.1:${edge.port}`;
  let sid;
  const login = async (credential = 'operator') => {
    const r = await fetch(base() + '/api/jw/v2/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }) });
    return (await r.json()).session.sessionId;
  };
  sid = await login();
  const call = async (body, suffix = '', token = sid) => {
    const r = await fetch(base() + '/api/jw/v2/actions/customers/customer/assistant/decisions' + suffix, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-jw-session': token }, body: JSON.stringify(body) });
    return { status: r.status, ...(await r.json()) };
  };
  const getStatus = async (token = sid) => {
    const r = await fetch(base() + '/api/jw/v2/customers/customer/assistant/decisions?assistant=credit', { headers: { 'x-jw-session': token } });
    return { status: r.status, ...(await r.json()) };
  };
  const analyze = (operationId, expectedRevision = 0, materialScope, question = '下一步核对什么？') =>
    call({ assistant: 'credit', operationId, expectedRevision, question, ...(materialScope === undefined ? {} : { materialScope }) });
  const restart = async () => {
    edge.server.closeAllConnections();
    await new Promise(r => edge.server.close(r));
    edge = await startEdge();
    sid = await login();
  };
  t.after(async () => { edge.server.closeAllConnections(); await new Promise(r => edge.server.close(r)); });
  return { dir, conn, modelStub, snapshot, call, getStatus, analyze, restart };
}

test('MS-D-01 单件/组合/乱序去重/缺省全链：请求正文、提示词与候选证据各自绑定所选材料', async t => {
  const f = await fixture(t);
  const single = await f.analyze('op_single_01', 0, { artifactIds: ['art-b'] });
  assert.equal(single.status, 200);
  assert.equal(single.latest.current, true);
  assert.deepEqual(f.conn.requests[0].artifactIds, ['art-b'], '上游请求只含所选ID');
  assert.equal(f.modelStub.hits(), 1);
  assert.ok(f.modelStub.requests[0].body.includes(TEXT_B));
  assert.ok(!f.modelStub.requests[0].body.includes(TEXT_A), '模型上下文不含未选材料');
  assert.equal(single.latest.evidenceRefs.length, 1, '候选证据仅来自所选材料');
  // GET 为 legacy（全量）视角：scoped 决策集在全量基线下如实投影 current=false、候选不展示（契约§2.4）
  const scopedView = await f.getStatus();
  assert.equal(scopedView.latest.current, false);
  assert.deepEqual(scopedView.latest.candidates, []);
  assert.equal(f.modelStub.hits(), 1, 'GET 零模型出站');
  const replay = await f.analyze('op_single_01', single.revision, { artifactIds: ['art-b'] });
  assert.equal(replay.replayed, true, '同scope同operationId重放');
  assert.equal(replay.latest.current, true, '带同scope的POST按同基线投影当前性');
  const both = await f.analyze('op_both_001', single.revision, { artifactIds: ['art-b', 'art-a', 'art-b', 'art-a'] });
  assert.equal(both.status, 200);
  assert.deepEqual(f.conn.requests.at(-1).artifactIds, ['art-a', 'art-b'], '乱序重复输入canonical化');
  assert.equal(f.modelStub.hits(), 2);
  assert.ok(f.modelStub.requests[1].body.includes(TEXT_A) && f.modelStub.requests[1].body.includes(TEXT_B));
  assert.notEqual(both.latest.id, single.latest.id, '不同选择产生不同决策集');
  const legacy = await f.analyze('op_legacy_1', both.revision);
  assert.equal(legacy.status, 200);
  assert.deepEqual(f.conn.requests.at(-1).artifactIds, ['art-a', 'art-b'], '缺省=全量legacy语义');
  assert.equal(f.modelStub.hits(), 3);
  assert.notEqual(legacy.latest.id, both.latest.id, '缺省与显式全量是不同基线');
  assert.equal((await f.getStatus()).latest.current, true, 'legacy决策集在全量视角下当前');
});

test('MS-D-02 重放零出站；同op换scope幂等冲突；新op（含不同scope）为合法独立新任务；反馈按基线校验', async t => {
  const f = await fixture(t);
  const first = await f.analyze('op_first_001', 0, { artifactIds: ['art-a'] });
  assert.equal(first.status, 200);
  assert.equal(f.modelStub.hits(), 1);
  const replay = await f.analyze('op_first_001', first.revision, { artifactIds: ['art-a'] });
  assert.equal(replay.replayed, true);
  assert.equal(f.modelStub.hits(), 1, '同operationId同scope重放零出站');
  const clash = await f.analyze('op_first_001', first.revision, { artifactIds: ['art-b'] });
  assert.equal(clash.status, 409);
  assert.equal(clash.error, 'IDEMPOTENCY_CONFLICT', '同operationId换材料选择=幂等冲突，不命中同一旧输出');
  assert.equal(f.modelStub.hits(), 1);
  const independent = await f.analyze('op_second_01', first.revision, { artifactIds: ['art-b'] });
  assert.equal(independent.status, 200);
  assert.equal(f.modelStub.hits(), 2, '新operationId+不同选择=合法独立新任务（D1现行契约）');
  const sameScopeNewOp = await f.analyze('op_third_01', independent.revision, { artifactIds: ['art-a'] });
  assert.equal(sameScopeNewOp.status, 200);
  assert.equal(f.modelStub.hits(), 3, '同scope新operationId同样是新身份新出站');
  // scoped 决策集的反馈须带相同 scope（basis一致）；不带/带错scope按基线不符 DECISION_STALE 拒绝
  const fbBody = { assistant: 'credit', operationId: 'fb_00000001', expectedRevision: sameScopeNewOp.revision,
    decisionSetId: sameScopeNewOp.latest.id, action: 'select', candidateId: sameScopeNewOp.latest.candidates[0].id, reason: '先核对' };
  const wrongScopeFb = await f.call({ ...fbBody, materialScope: { artifactIds: ['art-b'] } }, '/feedback');
  assert.equal(wrongScopeFb.status, 409, 'scope与决策集基线不符的反馈被拒');
  const okFb = await f.call({ ...fbBody, materialScope: { artifactIds: ['art-a'] } }, '/feedback');
  assert.equal(okFb.status, 200);
  assert.equal(f.modelStub.hits(), 3, '反馈零模型出站');
});

test('MS-D-03 非法形状/越权/空集/上游不可用：失败关闭，精确错误码，零模型出站', async t => {
  const f = await fixture(t);
  const malformed = [
    ['字符串', 'art-a'], ['裸数组', ['art-a']], ['缺artifactIds', {}], ['非数组artifactIds', { artifactIds: 'art-a' }],
    ['非字符串元素', { artifactIds: ['art-a', 5] }], ['空串元素', { artifactIds: ['art-a', ''] }], ['null', null],
  ];
  for (const [name, ms] of malformed) {
    const r = await f.analyze('op_bad_' + Math.random().toString(36).slice(2, 9), 0, ms);
    assert.equal(r.status, 400, name);
    assert.equal(r.error, 'INVALID_MATERIAL_SCOPE', name);
  }
  assert.equal(f.conn.hits(), 0, '形状门在任何上游调用之前');
  assert.equal(f.modelStub.hits(), 0);
  const empty = await f.analyze('op_empty_001', 0, { artifactIds: [] });
  assert.equal(empty.status, 422);
  assert.equal(empty.error, 'EVIDENCE_SCOPE_EMPTY', '空集由provider精确拒绝');
  const ghost = await f.analyze('op_ghost_001', 0, { artifactIds: ['art-a', 'ghost-id'] });
  assert.equal(ghost.status, 422);
  assert.equal(ghost.error, 'EVIDENCE_SCOPE_UNAUTHORIZED');
  assert.deepEqual(ghost.detail, ['ghost-id'], '越权ID如实透出');
  assert.equal(f.conn.hits(), 0, '越权选择零上游调用');
  assert.equal(f.modelStub.hits(), 0);
  f.conn.control.status500 = true;
  const down = await f.analyze('op_down_0001', 0, { artifactIds: ['art-a'] });
  assert.equal(down.status, 422);
  assert.equal(down.error, 'EVIDENCE_UPSTREAM_UNAVAILABLE', '上游不可用如实透出不冒充');
  f.conn.control.status500 = false;
  assert.equal(f.modelStub.hits(), 0, '证据层失败全部零模型出站');
  const ok = await f.analyze('op_ok_00001', 0, { artifactIds: ['art-a'] });
  assert.equal(ok.status, 200);
  assert.equal(f.modelStub.hits(), 1, '失败关闭后正常请求不受影响');
});

test('MS-D-04 材料失效：事前失效整次拒绝零出站；中途失效current=false不冒充成功、候选不泄露、无死锁', async t => {
  const f = await fixture(t);
  f.conn.control.omit = ['art-b']; // 取代模拟：上游静默省略所选件
  const pre = await f.analyze('op_pre_fail1', 0, { artifactIds: ['art-a', 'art-b'] });
  assert.equal(pre.status, 422);
  assert.equal(pre.error, 'EVIDENCE_SCOPE_INCOMPLETE');
  assert.deepEqual(pre.detail, ['art-b']);
  assert.equal(f.modelStub.hits(), 0, '证据不完整不触发模型调用');
  const single = await f.analyze('op_pre_fail2', 0, { artifactIds: ['art-a'] });
  assert.equal(single.status, 200, '未失效的单件选择仍可用');
  assert.equal(f.modelStub.hits(), 1);
  f.conn.control.omit = [];
  // 中途失效：模型已出站，checkCurrent 复验发现所选材料不可读 → current=false；
  // finish 如实落库（valid=false），respond 阶段按证据层失败关闭 422，不冒充成功
  f.modelStub.control.onHit = () => { f.conn.control.omit = ['art-b']; };
  const mid = await f.analyze('op_mid_fail1', single.revision, { artifactIds: ['art-a', 'art-b'] });
  assert.equal(mid.status, 422);
  assert.equal(mid.error, 'EVIDENCE_SCOPE_INCOMPLETE');
  assert.equal(f.modelStub.hits(), 2);
  f.modelStub.control.onHit = null;
  const view = await f.getStatus();
  assert.equal(view.latest.valid, false, '失效决策集如实落库为无效');
  assert.deepEqual(view.latest.candidates, [], '失效候选不展示不泄露');
  const fresh = await f.analyze('op_mid_fail2', view.revision, { artifactIds: ['art-a'] });
  assert.equal(fresh.status, 200, '失效后新任务（未失效选择）不受阻，无死锁');
  assert.equal(f.modelStub.hits(), 3);
});

test('MS-D-05 未知围栏：pending未决换operationId（含换scope）阻断零出站；pending重试换scope按冻结basis重放；跨重启持久', async t => {
  const f = await fixture(t);
  f.modelStub.control.mode = 'destroy';
  const unknown = await f.analyze('op_unknown_1', 0, { artifactIds: ['art-a'] });
  assert.equal(unknown.status, 200);
  assert.ok(unknown.pending);
  assert.equal(unknown.error, 'DECISION_SEND_UNKNOWN');
  assert.equal(f.modelStub.hits(), 1, '发送后未知：请求已到达');
  const retry = await f.analyze('op_unknown_1', unknown.revision, { artifactIds: ['art-a'] });
  assert.ok(retry.pending);
  assert.equal(f.modelStub.hits(), 1, '同operationId重试走回执围栏零出站');
  const scopeSwap = await f.analyze('op_unknown_1', unknown.revision, { artifactIds: ['art-b'] });
  assert.ok(scopeSwap.pending);
  assert.equal(f.modelStub.hits(), 1, 'pending重试换scope使用冻结basis重放，不重定向不绕过');
  const other = await f.analyze('op_other_001', unknown.revision, { artifactIds: ['art-b'] });
  assert.equal(other.status, 409);
  assert.equal(other.error, 'DECISION_PENDING', 'pending未决换operationId（含换scope）阻断');
  assert.equal(f.modelStub.hits(), 1);
  await f.restart();
  const afterRestart = await f.analyze('op_unknown_1', unknown.revision, { artifactIds: ['art-a'] });
  assert.ok(afterRestart.pending);
  assert.equal(f.modelStub.hits(), 1, '跨重启未知围栏持久');
  const stillBlocked = await f.analyze('op_other_002', unknown.revision, { artifactIds: ['art-a'] });
  assert.equal(stillBlocked.status, 409);
  assert.equal(f.modelStub.hits(), 1, '重启后pending仍阻断新任务（D1既有限制，如实呈现不发明解除）');
});
