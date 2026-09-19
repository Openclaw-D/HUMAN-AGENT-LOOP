// 任务02 · blocked 等待态语义与恢复：A 未配置/缺映射/受控登记/健康观测/回执查询（真实 PG + 真 HTTP + 脚本化假 A）。
// 断言铁律：blocked_* 是可恢复等待态（游标保留、不烧失败预算、sweep 自动重入）；
// status='done' 且 aRegistered=false 不可达（严格默认）；A 上线/映射建立后恢复必须真实续跑全链。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compose } from '../src/compose.mjs';
import { startServer } from '../src/http/server.mjs';
import { createTestDatabase, dropTestDatabase } from '../src/store/pg.mjs';
import { TENANT, BASE_PG, SIGNING_SECRET, setupInvitation, uploadBytes, driveToEnd, bankCsvBytes, declTxtBytes } from './processing-helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CUST = 'cust-blocked-1';
const PORT = 48291;

// ---------- 工具：在同一 PG 库上手动 compose/start（重启场景复用库与对象根） ----------

async function boot({ dbName, objectRoot, aBaseUrl = null, aFetchImpl = null, aConfig = null, processing = {}, port = PORT }) {
  const svc = await compose({
    pg: { ...BASE_PG, database: dbName },
    objectRoot,
    signingSecret: SIGNING_SECRET,
    serviceToken: 'proc_service_token',
    wecomTransport: { kfSendMsg: async () => { throw new Error('blocked'); }, kfSyncMsg: async () => { throw new Error('blocked'); } },
    aBaseUrl,
    aCredential: aBaseUrl ? (aConfig?.credentials?.uploadFallback ?? 'tok-connector') : null,
    aFetchImpl,
    a: aBaseUrl ? { defaultTenantId: TENANT, ...(aConfig ?? {}) } : null,
    processing,
  });
  const { server } = await startServer(svc, {
    port, wecomConfig: { token: 'x', aesKey: 'x'.repeat(32), corpid: 'x', defaultTenantId: TENANT },
    trtcCallbackKey: SIGNING_SECRET, serviceToken: 'proc_service_token',
  });
  const api = async (path, body, { token = 'proc_service_token', expect = 200, method = 'POST' } = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { 'content-type': 'application/json', 'x-service-token': token },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (r.status !== expect) throw new Error(`${path} → ${r.status}（期望 ${expect}）: ${JSON.stringify(j).slice(0, 300)}`);
    return j;
  };
  return {
    svc, server, api,
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(() => r()));
      await svc.close();
    },
  };
}

// 脚本化假 A：全链支持 + 客户 GET 可切换（存在/不存在）+ 客户档案可配置
function fakeA({ customerLegalRef = 'LE-blocked-1', customerTenant = TENANT } = {}) {
  const calls = [];
  let customerExists = false;
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    const method = init.method ?? 'GET';
    calls.push({ method, url: u, reqId: (() => { try { return JSON.parse(init.body ?? '{}').requestId ?? ''; } catch { return ''; } })() });
    if (method === 'GET' && /\/api\/v2\/customers\/[^/]+$/.test(u)) {
      if (!customerExists) return { ok: true, status: 404, json: async () => ({ ok: false, error: 'NOT_FOUND' }) };
      return { ok: true, status: 200, json: async () => ({ ok: true, customer: { customerId: u.split('/').pop(), tenantId: customerTenant, legalEntityRef: customerLegalRef, displayName: '合成客户' } }) };
    }
    if (method === 'GET' && u.includes('/api/v2/receipts/')) return { ok: true, status: 200, json: async () => ({ ok: true, found: false }) };
    if (method !== 'POST') return { ok: true, status: 404, json: async () => ({ ok: false, error: 'NOT_FOUND' }) };
    const body = JSON.parse(init.body ?? '{}');
    if (u.endsWith('/artifacts')) return { ok: true, status: 200, json: async () => ({ ok: true, artifactId: `aart-${calls.length}`, duplicateOf: null }) };
    if (u.endsWith('/analysis-runs/start')) return { ok: true, status: 200, json: async () => ({ ok: true, runId: `run-${calls.length}`, inputDigest: 'dig' }) };
    if (/\/analysis-runs\/[^/]+\/finish$/.test(u)) return { ok: true, status: 200, json: async () => ({ ok: true, runId: body.runId, status: 'completed' }) };
    if (u.endsWith('/rule-gate-receipts')) return { ok: true, status: 200, json: async () => ({ ok: true, receiptId: `gr-${calls.length}`, result: body.result }) };
    if (u.endsWith('/findings')) return { ok: true, status: 200, json: async () => ({ ok: true, findingId: `fnd-${calls.length}` }) };
    return { ok: true, status: 404, json: async () => ({ ok: false, error: 'NOT_FOUND' }) };
  };
  return { fetchImpl, calls, setCustomerExists: (v) => { customerExists = v; } };
}

test('R1 严格默认：A 未配置 → blocked_a_unavailable（游标保留）；A 上线重启后 sweep 重入续跑全链，A 登记恰一次', { timeout: 60_000 }, async (t) => {
  const created = await createTestDatabase(BASE_PG);
  const objectRoot = join(ROOT, '.run', `test-objects-${created.dbName}`);
  mkdirSync(objectRoot, { recursive: true });
  const closes = [];
  t.after(async () => {
    for (const c of closes.reverse()) { try { await c(); } catch { /* 清理互不阻断 */ } }
    await dropTestDatabase(BASE_PG, created.dbName);
    rmSync(objectRoot, { recursive: true, force: true });
  });

  // ① 阶段1：无 A（严格默认，不传 localOnlyCompletion）→ 任务不得以任何"完成"态收口
  const phase1 = await boot({ dbName: created.dbName, objectRoot, processing: { blockedBackoffSec: 1 } });
  closes.push(() => phase1.close());
  let blockedTaskId = null;
  try {
    const inv = await setupInvitation(phase1.api, { customerId: CUST });
    const up = await uploadBytes(phase1.api, inv, { bytes: bankCsvBytes(), customerId: CUST });
    blockedTaskId = up.processing.taskId;
    await driveToEnd(phase1.api, { maxRounds: 6 });
    const st = await phase1.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    const task = st.tasks.find((x) => x.task_id === up.processing.taskId);
    assert.equal(task.status, 'blocked_a_unavailable', `A 未配置须为等待态：${task.status}/${task.failure_code ?? ''}`);
    assert.equal(task.failure_code, 'A_NOT_CONFIGURED');
    assert.equal(task.aRegistered, false, 'A 未配置：材料未登记 A');
    assert.equal(task.bridgeState, 'none');
    assert.notEqual(task.stage_cursor, 'done', '等待态必须保留游标（恢复续跑的前提）');
    const detail = await phase1.api(`/api/connectors/processing/tasks/${up.processing.taskId}?tid=${TENANT}`, null, { method: 'GET' });
    assert.equal(detail.task.stage_cursor, 'register_material', '游标停在登记段（等待恢复）');
  } finally { await phase1.close(); }

  // ② 阶段2：A 上线（重启=新 compose 同库同对象根）→ sweep 自动重入 → 全链完成
  const fake = fakeA();
  const phase2 = await boot({
    dbName: created.dbName, objectRoot, aBaseUrl: 'http://127.0.0.1:48090', aFetchImpl: fake.fetchImpl,
    aConfig: { tenantId: TENANT, credentials: { service: 'tok-svc', registrar: 'tok-reg', uploadFallback: 'tok-upl' } },
    processing: { blockedBackoffSec: 1, aCustomerLinks: { [CUST]: { aCustomerId: 'cus-a-1' } }, aTimeoutMs: 1000 },
  });
  closes.push(() => phase2.close());
  const inv2 = await setupInvitation(phase2.api, { customerId: CUST });
  const up2 = await uploadBytes(phase2.api, inv2, { bytes: declTxtBytes({ note_restart: 'ok' }), kind: 'document', customerId: CUST });
  await new Promise((r) => setTimeout(r, 1200)); // 退避窗口（blockedBackoffSec=1）
  await driveToEnd(phase2.api, { maxRounds: 16 });
  const st2 = await phase2.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
  const task2 = st2.tasks.find((x) => x.task_id === blockedTaskId);
  assert.equal(task2.status, 'done', `A 上线后恢复完成全链：${task2.status}/${task2.failure_code ?? ''}`);
  assert.equal(task2.aRegistered, true, '恢复后材料已登记 A（done≠桥接成功的口径闭合）');
  assert.equal(task2.bridgeState, 'registered');
  const matPosts = fake.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/artifacts') && c.reqId.endsWith('-mat'));
  assert.equal(matPosts.length, 2, '重启后新件照常登记；原等待件恢复续跑不重复登记（1+1=各一次）');
  const matById = (await phase2.svc.store.query(
    `SELECT request_id FROM a_links WHERE tenant_id=$1 AND entity_type='material' AND status='registered'`, [TENANT],
  )).rows.map((r) => r.request_id);
  assert.equal(new Set(matById).size, matById.length, 'A 登记幂等：requestId 零重复');
});

test('R2 缺映射：A 客户不存在 → blocked_link；受控登记（归属校验/冲突拒绝/幂等）建立映射后即时恢复', { timeout: 60_000 }, async (t) => {
  const fake = fakeA({ customerLegalRef: 'LE-real-1' });
  const created = await createTestDatabase(BASE_PG);
  const objectRoot = join(ROOT, '.run', `test-objects-${created.dbName}`);
  mkdirSync(objectRoot, { recursive: true });
  const h = await boot({
    dbName: created.dbName, objectRoot,
    aBaseUrl: 'http://127.0.0.1:48091', aFetchImpl: fake.fetchImpl,
    aConfig: { tenantId: TENANT, credentials: { service: 'tok-svc', registrar: 'tok-reg', uploadFallback: 'tok-upl' } },
    processing: { blockedBackoffSec: 1, aTimeoutMs: 1000 },
  });
  t.after(async () => {
    await h.close();
    await dropTestDatabase(BASE_PG, created.dbName);
    rmSync(objectRoot, { recursive: true, force: true });
  });
  // 负路径助手：返回 {status, body} 不抛
  const apiRaw = async (path, body) => {
    const r = await fetch(`http://127.0.0.1:${PORT}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': 'proc_service_token' },
      body: JSON.stringify(body ?? {}),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  t.after(async () => { await h.close(); await dropTestDatabase(BASE_PG, created.dbName); rmSync(objectRoot, { recursive: true, force: true }); });
  try {
    const inv = await setupInvitation(h.api, { customerId: CUST });
    const up = await uploadBytes(h.api, inv, { bytes: bankCsvBytes(), customerId: CUST });
    await driveToEnd(h.api, { maxRounds: 6 });
    const st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    const task = st.tasks.find((x) => x.task_id === up.processing.taskId);
    assert.equal(task.status, 'blocked_link', `缺映射须为等待态而非静默跳过：${task.status}/${task.failure_code ?? ''}`);
    assert.equal(task.failure_code, 'A_CUSTOMER_NOT_IN_A', 'A 权威答复无此客户（非推断非猜测）');
    assert.equal(task.aRegistered, false);

    // 受控登记：A 客户先出现
    fake.setCustomerExists(true);
    // 归属证明错误 → 422（确定性拒绝，不落链接）
    const forged = await apiRaw('/api/connectors/customers/link', {
      tenantId: TENANT, customerId: CUST, aCustomerId: 'cust-a-real-1', legalEntityRef: 'LE-FORGED', requestedBy: 'op-x',
    });
    assert.equal(forged.status, 422, `归属证明失败须 422：${JSON.stringify(forged.body).slice(0, 120)}`);
    assert.equal(forged.body.error, 'LINK_OWNERSHIP_MISMATCH');
    const linkRows0 = (await h.svc.store.query(`SELECT a_customer_id FROM a_customer_links WHERE tenant_id=$1 AND customer_id=$2`, [TENANT, CUST])).rows;
    assert.equal(linkRows0.length, 0, '归属校验失败不落任何链接');

    // 跨租户声明 → 拒绝（桥租户检查；A 客户在桥租户外不建立映射）
    const crossTenant = await apiRaw('/api/connectors/customers/link', {
      tenantId: 'tenant-other', customerId: CUST, aCustomerId: 'cust-a-real-1',
    });
    assert.equal(crossTenant.status, 403, `跨租户登记须拒绝：${JSON.stringify(crossTenant.body).slice(0, 120)}`);

    // 正确归属证明 → 成功 + blocked_link 任务即时重入
    const linked = await h.api('/api/connectors/customers/link', {
      tenantId: TENANT, customerId: CUST, aCustomerId: 'cust-a-real-1', legalEntityRef: 'LE-real-1', requestedBy: 'op-1',
    });
    assert.equal(linked.ok, true);
    assert.equal(linked.verified.legalEntityMatch, true);
    assert.ok(linked.requeuedTasks >= 1, `受控登记后 blocked_link 即时重入：${linked.requeuedTasks}`);
    await driveToEnd(h.api, { maxRounds: 16 });
    const st2 = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    assert.equal(st2.tasks[0].status, 'done', `映射建立后恢复全链：${st2.tasks[0].status}/${st2.tasks[0].failure_code ?? ''}`);
    assert.equal(st2.tasks[0].aRegistered, true);

    // LINK_CONFLICT：同客户映射到不同 A 客户 → 409（不覆盖不劫持）
    const conflict = await apiRaw('/api/connectors/customers/link', {
      tenantId: TENANT, customerId: CUST, aCustomerId: 'cust-a-OTHER', legalEntityRef: 'LE-real-1',
    });
    assert.equal(conflict.status, 409, `映射劫持须 409：${JSON.stringify(conflict.body).slice(0, 120)}`);
    assert.equal(conflict.body.error, 'LINK_CONFLICT');
    // 幂等：同参数重复登记 → ok（不新建不报错）
    const again = await h.api('/api/connectors/customers/link', {
      tenantId: TENANT, customerId: CUST, aCustomerId: 'cust-a-real-1', legalEntityRef: 'LE-real-1',
    });
    assert.equal(again.ok, true);
    assert.equal(again.existed, true, '同映射重复登记=幂等成功');
  } finally { /* t.after 统一清理 */ }
});

test('R3 观测面：/healthz 处理驱动分项（IR-04-2B）+ requestId 通道回执查询（IR-T01-3）', { timeout: 60_000 }, async (t) => {
  const created = await createTestDatabase(BASE_PG);
  const objectRoot = join(ROOT, '.run', `test-objects-${created.dbName}`);
  mkdirSync(objectRoot, { recursive: true });
  const h = await boot({ dbName: created.dbName, objectRoot, processing: { blockedBackoffSec: 1 } });
  t.after(async () => {
    await h.close();
    await dropTestDatabase(BASE_PG, created.dbName);
    rmSync(objectRoot, { recursive: true, force: true });
  });
  try {
    const health = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.json());
    assert.equal(health.ok, true);
    assert.equal(health.processing.driverStarted, false, '未 startDriver 时如实报告（手动 tick 模式）');
    await h.api('/api/connectors/processing/tick', {});
    const health2 = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.json());
    assert.ok(health2.processing.lastTickAt, 'tick 后 lastTickAt 可观测');

    const inv = await setupInvitation(h.api);
    const up = await uploadBytes(h.api, inv, { bytes: declTxtBytes({ note_r3: 'ok' }), kind: 'document' });
    // 回执查询：按 requestId 查 a_links（found:false = 尚无操作；blocked 态无 unknown 行属正常）
    const miss = await h.api(`/api/connectors/processing/receipts/ptx-nonexistent-mat?tid=${TENANT}`, null, { method: 'GET' });
    assert.equal(miss.found, false);
    // 触发一次 tick 后任务在等待态；a_links 无行 → found:false；不 404 不 500
    await h.api('/api/connectors/processing/tick', {});
    const got = await h.api(`/api/connectors/processing/receipts/${encodeURIComponent(`ptx-${up.processing.taskId}-mat`)}?tid=${TENANT}`, null, { method: 'GET' });
    assert.equal(got.found, false, 'blocked 等待态无 A 操作行（未发出=无回执，如实）');
  } finally { /* t.after 关闭 */ }
});
