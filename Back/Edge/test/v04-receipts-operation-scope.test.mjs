// V0.4 03-receipts · decisions 面 operationId/scope 语义 专项回归（真实 Edge HTTP 装配）。
// 被测：assistant-decisions.mjs 既有契约（只读核验）+ 回执围栏在 decisions 路径的表现。
// 断言口径：每次分析类 POST 的真实出站以替身命中数核对；验收目标：
//   同 operationId 同请求→重放零出站；同 operationId 异请求/kind→幂等冲突零出站；
//   未知后同 operationId 重试零出站（重启亦然）；未知 pending 未决阻断其他 operationId；
//   现行契约下“新 operationId=新身份=新请求”与“同身份不重发”的边界如实区分（D1 界定，不擅自改约）；
//   principal/客户作用域不串结果；材料变化后旧结果 current=false。
// 替身形态验证协议语义，不构成真实模型质量测试。
process.setMaxListeners?.(60);
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { startEdgeServer } from '../src/server.mjs';
import { createAssistantModel } from '../src/assistant-model.mjs';
import { createFixtureStore } from '../src/store.mjs';
import { createSessionStore } from '../src/session.mjs';
import { createAuditSink } from '../src/audit.mjs';
import { createDecisionFeedbackStore } from '../src/decision-feedback-store.mjs';
import { prepareEvidence } from '../src/assistant-evidence.mjs';
import { startTransportStub } from '../../B/test/v04-transport-stub.mjs';

const MATERIAL_TEXT = '合成客户申请设备回租500万元；开票与经营流水期间不同，需核对期间与重复交易。';
const materialHash = () => createHash('sha256').update(MATERIAL_TEXT).digest('hex');

async function fixture(tag) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'v04-op-' + tag + '-'));
  const stub = await startTransportStub();
  stub.control.decisions = true;
  const receiptsDir = path.join(dir, 'model-state');
  const modelArgs = {
    configPath: path.join(dir, 'model-config.json'),
    receiptsDir,
    costLedgerPath: path.join(dir, 'cost-ledger.jsonl'),
    requireEvidence: true,
    log: () => {},
  };
  await fs.writeFile(modelArgs.configPath, JSON.stringify({
    transport: { mode: 'mock', mock: { baseUrl: stub.url, timeoutMs: 1500 } },
    evidencePolicy: { allowedHashes: [materialHash()] },
    budget: { maxTotalCost: 10, perCallEstimate: 0.01 },
  }));
  const store = createFixtureStore();
  const snapshotOf = (customerId) => ({ customer: { name: '合成客户-' + customerId },
    admission: { inputVersion: 0, scope: { revision: 0, tenantId: 'v04-tenant-A' }, assessmentState: 'awaiting_human_review',
      candidate: { version: 1, suggestedAmount: 1000000, suggestedTermMonths: 36, tendency: 'cautious_do' },
      cells: [], blockers: [] } });
  for (const c of ['v04cust-1', 'v04cust-2']) store.upsertCustomer(c, snapshotOf(c));

  const model = await createAssistantModel(modelArgs);
  const evidence = async ({ snapshot, tenantId, customerId, revision }) => {
    const pol = model.evidencePolicy();
    return prepareEvidence({ tenantId, customerId, revision, allowedHashes: pol.allowedHashes, maxChars: pol.maxChars,
      materials: [{ tenantId, customerId, hash: materialHash(), artifactId: 'art-v04', evidenceId: 'ev-v04',
        parserVersion: 'v04-test-v1', current: true, text: MATERIAL_TEXT }] });
  };
  const sessionStore = createSessionStore({});
  const verifyCredential = async ({ credential }) => {
    if (credential === 'v04-cred-a') return { ok: true, principalId: 'v04-op-a', roles: ['admin'], tenantId: 'v04-tenant-A' };
    if (credential === 'v04-cred-b') return { ok: true, principalId: 'v04-op-b', roles: ['admin'], tenantId: 'v04-tenant-A' };
    return { ok: false, reason: 'PRINCIPAL_UNTRUSTED' };
  };
  const audit = createAuditSink();

  const startEdge = async (repoDir, withModel = model) => startEdgeServer({
    port: 0, seal: { buildId: 'v04-03-receipts' }, probes: [], store, sessionStore, verifyCredential,
    auth: async ({ session }) => ({ ok: !!session }),
    assistantModel: withModel, assistantEvidence: evidence,
    decisionRepository: createDecisionFeedbackStore(repoDir),
    auditSink: audit, log: () => {},
  });
  let repoDir = path.join(dir, 'decision-repo-1');
  let edge = await startEdge(repoDir);
  let base = `http://127.0.0.1:${edge.port}`;

  const closeEdge = async () => { edge.server.closeAllConnections(); await new Promise((r) => edge.server.close(r)); };
  const close = async () => { await closeEdge(); await stub.close(); await fs.rm(dir, { recursive: true, force: true }); };

  const login = async (credential = 'v04-cred-a') => {
    const r = await fetch(base + '/api/jw/v2/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }) });
    const body = await r.json();
    assert.ok(body?.session?.sessionId, '会话交换失败');
    return body.session.sessionId;
  };
  const getDecisions = async (customerId, sid) => {
    const r = await fetch(`${base}/api/jw/v2/customers/${customerId}/assistant/decisions?assistant=credit`,
      { headers: { 'x-jw-session': sid } });
    assert.equal(r.status, 200);
    return r.json();
  };
  const postDecisions = async (customerId, sid, body) => {
    const r = await fetch(`${base}/api/jw/v2/actions/customers/${customerId}/assistant/decisions`,
      { method: 'POST', headers: { 'content-type': 'application/json', 'x-jw-session': sid }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const analyze = async (customerId, sid, { operationId, question = '请核对当前候选方案', taskKind, revision } = {}) => {
    const state = revision === undefined ? (await getDecisions(customerId, sid)).revision : revision;
    return postDecisions(customerId, sid, { assistant: 'credit', question, operationId, expectedRevision: state,
      ...(taskKind ? { taskKind } : {}) });
  };
  /** 换仓重启：同一回执目录与账本，决策仓库可换新目录（模拟仓库重置而回执保留）。 */
  const respawn = async ({ freshRepo = false } = {}) => {
    await closeEdge();
    if (freshRepo) repoDir = path.join(dir, 'decision-repo-' + (await fs.readdir(dir)).filter((n) => n.startsWith('decision-repo-')).length + 1);
    const freshModel = await createAssistantModel(modelArgs);
    edge = await startEdge(repoDir, freshModel);
    base = `http://127.0.0.1:${edge.port}`;
  };
  return { dir, stub, store, snapshotOf, modelArgs, receiptsDir, modelArgs_path: modelArgs.configPath,
    costLedgerPath: modelArgs.costLedgerPath, login, getDecisions, postDecisions, analyze, respawn, close,
    getBase: () => base };
}

const readLedger = async (file) => (await fs.readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('V04-OP-01 同operationId同请求→重放零出站', async () => {
  const f = await fixture('replay');
  try {
    const sid = await f.login();
    const a = await f.analyze('v04cust-1', sid, { operationId: 'v04op-replay1' });
    assert.equal(a.status, 200);
    assert.equal(a.body.latest.current, true);
    assert.equal(a.body.latest.candidates.length, 2);
    assert.equal(f.stub.hits(), 1);
    const b = await f.analyze('v04cust-1', sid, { operationId: 'v04op-replay1' });
    assert.equal(b.status, 200);
    assert.equal(b.body.replayed, true);
    assert.equal(f.stub.hits(), 1, '同operationId重放零出站');
  } finally { await f.close(); }
});

test('V04-OP-02 同operationId不同问题→409 IDEMPOTENCY_CONFLICT 零出站', async () => {
  const f = await fixture('conflict-q');
  try {
    const sid = await f.login();
    await f.analyze('v04cust-1', sid, { operationId: 'v04op-confli1' });
    assert.equal(f.stub.hits(), 1);
    const r = await f.analyze('v04cust-1', sid, { operationId: 'v04op-confli1', question: '换成另一个问题' });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'IDEMPOTENCY_CONFLICT');
    assert.equal(f.stub.hits(), 1, '幂等冲突不产生新出站');
  } finally { await f.close(); }
});

test('V04-OP-03 同operationId换taskKind→409 零出站（预测kind进requestHash）', async () => {
  const f = await fixture('conflict-kind');
  try {
    const sid = await f.login();
    const a = await f.analyze('v04cust-1', sid, { operationId: 'v04op-kind001' });
    assert.equal(a.status, 200);
    assert.equal(f.stub.hits(), 1);
    const r = await f.analyze('v04cust-1', sid, { operationId: 'v04op-kind001', taskKind: 'path_forecast' });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'IDEMPOTENCY_CONFLICT');
    assert.equal(f.stub.hits(), 1);
  } finally { await f.close(); }
});

test('V04-OP-04 未知后：同operationId重试零出站（重启亦然）；新operationId被DECISION_PENDING阻断', async () => {
  const f = await fixture('unknown-pending');
  try {
    f.stub.control.mode = 'destroy';
    const sid = await f.login();
    const a = await f.analyze('v04cust-1', sid, { operationId: 'v04op-unknown1' });
    assert.equal(a.status, 200);
    assert.equal(a.body.error, 'DECISION_SEND_UNKNOWN');
    assert.equal(a.body.pending.operationId, 'v04op-unknown1');
    assert.equal(f.stub.hits(), 1);
    const retry = await f.analyze('v04cust-1', sid, { operationId: 'v04op-unknown1' });
    assert.equal(retry.body.error, 'DECISION_SEND_UNKNOWN');
    assert.equal(f.stub.hits(), 1, '未知重试零出站');
    const other = await f.analyze('v04cust-1', sid, { operationId: 'v04op-other001' });
    assert.equal(other.status, 409);
    assert.equal(other.body.error, 'DECISION_PENDING', 'pending未决阻断其他operationId');
    assert.equal(f.stub.hits(), 1);
    // 重启（同回执+同决策仓库）
    await f.respawn();
    const sid2 = await f.login();
    const retry2 = await f.analyze('v04cust-1', sid2, { operationId: 'v04op-unknown1' });
    assert.equal(retry2.body.error, 'DECISION_SEND_UNKNOWN');
    const other2 = await f.analyze('v04cust-1', sid2, { operationId: 'v04op-other002' });
    assert.equal(other2.status, 409);
    assert.equal(f.stub.hits(), 1, '重启后围栏与pending均持久');
  } finally { await f.close(); }
});

test('V04-OP-05 D1界定（现行契约，不改动）：决策仓库无pending时新operationId=新身份=新出站；同operationId靠回执围栏零出站', async () => {
  const f = await fixture('d1-boundary');
  try {
    f.stub.control.mode = 'destroy';
    const sid = await f.login();
    await f.analyze('v04cust-1', sid, { operationId: 'v04op-d1case01' });
    assert.equal(f.stub.hits(), 1);
    // 仓库重置（新目录、无pending），回执目录保留——R03/D1 的历史现场
    await f.respawn({ freshRepo: true });
    f.stub.control.mode = 'ok';
    const sid2 = await f.login();
    // (a) 新operationId同问题：身份含 decisionTask.operationId → 新requestId → 现行契约允许新出站
    const fresh = await f.analyze('v04cust-1', sid2, { operationId: 'v04op-d1case02' });
    assert.equal(fresh.status, 200);
    assert.equal(fresh.body.latest.current, true);
    assert.equal(f.stub.hits(), 2, 'D1灰区：新operationId在无pending仓库中产生新出站（范围锁属CTRL裁决，本路不改约）');
    // (b) 老operationId同问题：身份与历史unknown回执完全一致 → 回执围栏零出站
    const same = await f.analyze('v04cust-1', sid2, { operationId: 'v04op-d1case01' });
    assert.equal(same.body.error, 'DECISION_SEND_UNKNOWN');
    assert.equal(f.stub.hits(), 2, '同身份（含同operationId）未知围栏跨仓库成立');
  } finally { await f.close(); }
});

test('V04-OP-06 不同principal同客户：结果互不串用；反馈按principal绑定', async () => {
  const f = await fixture('principal');
  try {
    const sidA = await f.login('v04-cred-a');
    const a = await f.analyze('v04cust-1', sidA, { operationId: 'v04op-prin-a1' });
    assert.equal(a.status, 200);
    assert.equal(f.stub.hits(), 1);
    const sidB = await f.login('v04-cred-b');
    const b = await f.analyze('v04cust-1', sidB, { operationId: 'v04op-prin-b1' });
    assert.equal(b.status, 200);
    assert.equal(f.stub.hits(), 2, 'principal参与身份：各自新出站，不跨principal复用回执');
    // A 点选反馈后重跑：反馈进A的身份（新出站）；B重跑不携带A的反馈（各自新出站）
    const stateA = await f.getDecisions('v04cust-1', sidA);
    const fb = await fetch(`${f.getBase()}/api/jw/v2/actions/customers/v04cust-1/assistant/decisions/feedback`,
      { method: 'POST', headers: { 'content-type': 'application/json', 'x-jw-session': sidA },
        body: JSON.stringify({ assistant: 'credit', operationId: 'v04op-prinfb1', expectedRevision: stateA.revision,
          decisionSetId: stateA.latest.id, action: 'select', candidateId: a.body.latest.candidates[0].id, reason: '合成点选' }) });
    assert.equal(fb.status, 200);
    const rerunA = await f.analyze('v04cust-1', sidA, { operationId: 'v04op-prin-a2' });
    assert.equal(rerunA.status, 200);
    assert.equal(rerunA.body.latest.feedbackUsed, 'feedback:v04op-prinfb1', 'A的重跑绑定A的反馈');
    const rerunB = await f.analyze('v04cust-1', sidB, { operationId: 'v04op-prin-b2' });
    assert.equal(rerunB.status, 200);
    assert.equal(rerunB.body.latest.feedbackUsed, null, 'B的重跑不带入A的反馈');
    assert.equal(f.stub.hits(), 4, '反馈使身份变化：A/B重跑各一次新出站');
  } finally { await f.close(); }
});

test('V04-OP-07 材料变化后旧结果 current=false 且候选清空（R21b语义，零出站）', async () => {
  const f = await fixture('currency');
  try {
    const sid = await f.login();
    const a = await f.analyze('v04cust-1', sid, { operationId: 'v04op-currency1' });
    assert.equal(a.body.latest.current, true);
    assert.equal(f.stub.hits(), 1);
    // 权威投影变化（scope.revision + 候选版本）
    const snapshot = f.store.getWorkspace ? null : null; // fixture store 直接用 upsert 覆盖
    const fresh = f.snapshotOf('v04cust-1');
    fresh.admission.scope.revision = 99;
    fresh.admission.candidate.version = 2;
    f.store.upsertCustomer('v04cust-1', fresh);
    const g = await f.getDecisions('v04cust-1', sid);
    assert.equal(g.latest.current, false, '材料变化后旧结果不当前');
    assert.deepEqual(g.latest.candidates, [], '失效候选清空不可选');
    assert.equal(f.stub.hits(), 1, '当前性核对不产生新出站');
  } finally { await f.close(); }
});

test('V04-OP-08 决策全链账本与替身计数可核对：reserve数=出站数、success各有actual', async () => {
  const f = await fixture('ledger');
  try {
    const sid = await f.login();
    await f.analyze('v04cust-1', sid, { operationId: 'v04op-ledger01' });
    // 新身份（候选版本变化）再走一次成功出站
    const fresh = f.snapshotOf('v04cust-1');
    fresh.admission.candidate.version = 3;
    f.store.upsertCustomer('v04cust-1', fresh);
    const second = await f.analyze('v04cust-1', sid, { operationId: 'v04op-ledger02' });
    assert.equal(second.status, 200);
    assert.equal(f.stub.hits(), 2);
    const entries = await readLedger(f.costLedgerPath);
    const reserves = entries.filter((e) => e.type === 'reserve');
    const actuals = entries.filter((e) => e.type === 'actual');
    assert.equal(reserves.length, f.stub.hits());
    assert.equal(actuals.length, 2);
    assert.equal(new Set(reserves.map((e) => e.requestId)).size, 2, '两次出站requestId各自独立');
    assert.ok(reserves.reduce((a, e) => a + e.amount, 0) === 0.02);
  } finally { await f.close(); }
});
