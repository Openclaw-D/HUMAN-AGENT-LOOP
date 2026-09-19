// 任务02 · 受控映射与全链验收（真实 A 内核 + 真实 PG + 真实 HTTP）。
// 断言铁律：映射必须经 A 权威核验（存在+租户归属+归属证明），无任何名称/前缀推断；
// done 恒以 aRegistered=true 为前提；重复提交不产生双份 A 业务效果；gate 全部来自真实规则评估
// （无预填事实、无固定 CLEAR、无伪造分析完成、无 legacy 免检）。
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { TENANT, makeProcessingHarness, setupInvitation, uploadBytes, driveToEnd, bankCsvBytes, declCsvBytes, declTxtBytes } from './processing-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const A_ROOT = path.resolve(__dirname, '../../A');

// 隔离环境门：A 管理库不可达 → 显式 SKIP，不计 PASS
const A_ADMIN_DB = process.env.JW_A_ADMIN_DB_URL ?? 'postgres://jwcc:jwcc-local-demo@127.0.0.1:15444/postgres';
async function pgReachable(cs) {
  try { const p = new pg.Pool({ connectionString: cs, max: 1, connectionTimeoutMillis: 2000 }); await p.query('SELECT 1'); await p.end(); return true; }
  catch { return false; }
}
if (!(await pgReachable(A_ADMIN_DB))) {
  console.log('# SKIP: A 管理库 15444 不可达（blocked_env，不计 PASS）');
  process.exit(0);
}

const POLICY_TOKEN = 'tok-pol2';
const BIZ_TOKEN = 'tok-biz2';
const CUST_TOKEN = 'tok-cust2';
const SVC_TOKEN = 'tok-svc2';
const PRINCIPAL_SPEC = [
  `${POLICY_TOKEN}=pol2:human:policy:all:all`,
  `${BIZ_TOKEN}=biz2:human:business:all:all`,
  `${CUST_TOKEN}=cust2:human:customer:all:all`,
  `${SVC_TOKEN}=svc2:service:policy+credit+commerce+asset:all:all`,
].join(',');
const RULE_PACK_VERSION = '1.0.0';

const A_PORT = 48350 + Math.floor(Math.random() * 40);
async function createAdb() {
  const name = `goal02_link_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: A_ADMIN_DB });
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const base = new URL(A_ADMIN_DB);
  base.pathname = `/${name}`;
  return { name, url: base.toString() };
}
const db = await createAdb();
const kernel = await (async () => {
  const child = spawn('node', ['src/index.ts', '--port', String(A_PORT), '--db', db.url, '--principal-tokens', PRINCIPAL_SPEC,
    '--required-domains-policy', 'goal02-synthetic-policy'], { cwd: A_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));
  const base = `http://127.0.0.1:${A_PORT}`;
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`${base}/healthz`); if (r.ok) return { child, base, logs }; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`A 内核未就绪：${logs.join('').slice(-800)}`);
})();
const adminPool = new pg.Pool({ connectionString: A_ADMIN_DB });
after(async () => {
  kernel.child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
  kernel.child.kill('SIGKILL');
  adminPool.end();
  const admin = new pg.Pool({ connectionString: A_ADMIN_DB });
  await admin.query(`DROP DATABASE IF EXISTS ${db.name} WITH (FORCE)`).catch(() => {});
  await admin.end();
});

const aApi = async (token, method, path, body) => {
  const r = await fetch(`${kernel.base}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(token ? { 'x-principal-credential': token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
// 规则包正式激活（policy 人类行为；gate 回执的 rulesetVersion 必须与 A 激活版本一致，否则 STALE_BASIS 如实失败）
const actSeed = await aApi(POLICY_TOKEN, 'POST', '/api/v2/rule-pack-versions/activate', {
  requestId: `seed-act-${randomBytes(6).toString('hex')}`, version: RULE_PACK_VERSION, tenantId: TENANT,
});
if (actSeed.status !== 200) throw new Error(`规则包激活失败：${JSON.stringify(actSeed.body).slice(0, 200)}`);
const A_ARTIFACTS_OF = async (aCustomerId, token = BIZ_TOKEN) =>
  (await aApi(token, 'GET', `/api/v2/customers/${aCustomerId}/artifacts`)).body.artifacts ?? [];
const aCustomerMaterials = async (aCustomerId) =>
  (await A_ARTIFACTS_OF(aCustomerId)).filter((a) => String(a.kind ?? '').startsWith('material.'));

/** 建 A 客户（人类业务凭据；返回 aCustomerId）。 */
async function createACustomer(legalEntityRef, displayName, tenantId = TENANT) {
  const r = await aApi(BIZ_TOKEN, 'POST', '/api/v2/customers', {
    requestId: `seed-${randomBytes(6).toString('hex')}`, legalEntityRef, displayName, tenantId,
  });
  assert.equal(r.status, 200, `建 A 客户：${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body.customerId;
}
const bridgeCfg = () => ({
  tenantId: TENANT,
  credentials: {
    service: SVC_TOKEN, registrar: BIZ_TOKEN, reviewer: BIZ_TOKEN,
    upload: { customer_finance: CUST_TOKEN, customer_owner: CUST_TOKEN },
    uploadFallback: CUST_TOKEN,
  },
});
const harnessOpts = (extra = {}) => ({ port: 48295, aBaseUrl: kernel.base, aConfig: bridgeCfg(), processing: { aTimeoutMs: 8000, ...extra } });

test('L1 零配置新客户：不预建映射，首次上传经 A 权威同 ID 核验自动接通并到达 A', { timeout: 120_000 }, async (t) => {
  const aCustomerId = await createACustomer('le-l1-auto', 'L1 零配置合成客户');
  const h = await makeProcessingHarness(harnessOpts());
  t.after(() => h.dispose());
  // 关键：Connectors 侧无 aCustomerLinks 种子/表记录；customerId=A 建档原 ID
  const inv = await setupInvitation(h.api, { customerId: aCustomerId });
  const up = await uploadBytes(h.api, inv, { bytes: bankCsvBytes(), customerId: aCustomerId });
  await driveToEnd(h.api, { maxRounds: 16 });
  const st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${aCustomerId}`, null, { method: 'GET' });
  const task = st.tasks.find((x) => x.task_id === up.processing.taskId);
  assert.equal(task.status, 'done', `零配置首传全链完成：${task.status}/${task.failure_code ?? ''}`);
  assert.equal(task.aRegistered, true, 'A 登记完成（可见性字段）');
  assert.equal(task.bridgeState, 'registered');
  const mats = await aCustomerMaterials(aCustomerId);
  assert.equal(mats.length, 1, `材料恰登记 A 一次：${JSON.stringify(mats.map((m) => m.kind))}`);
  // 表为准：自动核验链接落库（auto_authoritative_same_id），重放零新登记
  const link = (await h.store.query(`SELECT linked_by, a_customer_id FROM a_customer_links WHERE tenant_id=$1 AND customer_id=$2`, [TENANT, aCustomerId])).rows[0];
  assert.equal(link.a_customer_id, aCustomerId, '同 customerId 沿用');
  assert.equal(link.linked_by, 'auto_authoritative_same_id');
});

test('L2 映射场景：本地客户 ID → blocked_link（A 客户不存在）→ 受控登记（归属证明）恢复；伪造/劫持/跨租户拒绝', { timeout: 120_000 }, async (t) => {
  const aCustomerId = await createACustomer('le-l2-mapped', 'L2 映射合成客户');
  const otherTenantCust = await createACustomer('le-l2-t2', 'L2 跨租户客户', 't2');
  const LOCAL = 'cust-local-l2';
  const h = await makeProcessingHarness(harnessOpts());
  t.after(() => h.dispose());
  const inv = await setupInvitation(h.api, { customerId: LOCAL });
  const up = await uploadBytes(h.api, inv, { bytes: declTxtBytes({ note_l2: 'ok' }), kind: 'document', customerId: LOCAL });
  await driveToEnd(h.api, { maxRounds: 6 });
  const st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${LOCAL}`, null, { method: 'GET' });
  const task = st.tasks.find((x) => x.task_id === up.processing.taskId);
  assert.equal(task.status, 'blocked_link', `缺映射=可恢复等待态：${task.status}/${task.failure_code ?? ''}`);
  assert.equal(task.failure_code, 'A_CUSTOMER_NOT_IN_A', 'A 权威答复无此本地 ID（不推断）');

  // 伪造归属证明 → 422，不落链接
  const forged = await fetch(`${'http://127.0.0.1:48295'}/api/connectors/customers/link`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': 'proc_service_token' },
    body: JSON.stringify({ tenantId: TENANT, customerId: LOCAL, aCustomerId, legalEntityRef: 'le-FORGED' }),
  });
  assert.equal(forged.status, 422, `伪造归属证明拒绝：${forged.status}`);
  // 跨租户 A 客户 → 拒绝（归属=租户级，先于主体比对）
  const cross = await fetch(`${'http://127.0.0.1:48295'}/api/connectors/customers/link`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': 'proc_service_token' },
    body: JSON.stringify({ tenantId: TENANT, customerId: LOCAL, aCustomerId: otherTenantCust, legalEntityRef: 'le-l2-t2' }),
  });
  assert.equal(cross.status, 403, `跨租户映射拒绝：${cross.status}`);
  const rows0 = (await h.store.query(`SELECT 1 FROM a_customer_links WHERE tenant_id=$1 AND customer_id=$2`, [TENANT, LOCAL])).rows;
  assert.equal(rows0.length, 0, '两次拒绝均未落链接');

  // 正确归属证明 → 成功 + 即时重入 + 全链到达 A
  const linked = await h.api('/api/connectors/customers/link', {
    tenantId: TENANT, customerId: LOCAL, aCustomerId, legalEntityRef: 'le-l2-mapped', requestedBy: 'op-1',
  });
  assert.equal(linked.ok, true);
  assert.ok(linked.requeuedTasks >= 1, 'blocked_link 即时重入');
  await driveToEnd(h.api, { maxRounds: 16 });
  const st2 = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${LOCAL}`, null, { method: 'GET' });
  assert.equal(st2.tasks[0].status, 'done');
  assert.equal(st2.tasks[0].aRegistered, true);
  assert.equal((await aCustomerMaterials(aCustomerId)).length, 1, '材料到达 A（映射客户）');
  // 劫持拒绝：已映射客户改绑同租户其他 A 客户 → 409（跨租户的是 403，已在上文覆盖）
  const aCustThird = await createACustomer('le-l2-third', 'L2 同租户第三客户');
  const hijack = await fetch(`${'http://127.0.0.1:48295'}/api/connectors/customers/link`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': 'proc_service_token' },
    body: JSON.stringify({ tenantId: TENANT, customerId: LOCAL, aCustomerId: aCustThird }),
  });
  assert.equal(hijack.status, 409, '已有映射不可覆盖/劫持');
});

test('L3 重复提交/同字节不同元数据/跨客户同字节：无双份 A 业务效果，各自语义正确', { timeout: 120_000 }, async (t) => {
  const aCust = await createACustomer('le-l3-dup', 'L3 判重合成客户');
  const aCustB = await createACustomer('le-l3-b', 'L3 客户B');
  const h = await makeProcessingHarness(harnessOpts());
  t.after(() => h.dispose());
  const inv = await setupInvitation(h.api, { customerId: aCust });
  // ① 同客户同字节同元数据 ×2：第二件 A 不重复登记材料，任务 skipped_duplicate
  const up1 = await uploadBytes(h.api, inv, { bytes: bankCsvBytes(), customerId: aCust });
  const up2 = await uploadBytes(h.api, inv, { bytes: bankCsvBytes(), customerId: aCust });
  await driveToEnd(h.api, { maxRounds: 16 });
  const st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${aCust}`, null, { method: 'GET' });
  const t1 = st.tasks.find((x) => x.task_id === up1.processing.taskId);
  const t2 = st.tasks.find((x) => x.task_id === up2.processing.taskId);
  assert.equal(t1.status, 'done');
  assert.equal(t2.status, 'skipped_duplicate', '同字节同声明元数据=重复收口');
  assert.equal(t2.aRegistered, false, '重复件未在 A 重复登记材料（无双份业务效果）');
  assert.equal(t1.aRegistered, true);
  // ② 同字节不同声明元数据（期间不同）：照常处理（新锚点），A 各自登记
  const up3 = await uploadBytes(h.api, inv, { bytes: bankCsvBytes({ year: 2025 }), periodFrom: '2025-01-01', periodTo: '2025-02-28', customerId: aCust });
  await driveToEnd(h.api, { maxRounds: 16 });
  const st3 = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${aCust}`, null, { method: 'GET' });
  const t3 = st3.tasks.find((x) => x.task_id === up3.processing.taskId);
  assert.equal(t3.status, 'done', `同字节不同元数据照常处理：${t3.status}/${t3.failure_code ?? ''}`);
  assert.equal(t3.aRegistered, true);
  // ③ 跨客户同字节：客户B 独立全链（不判重、不共用 A 工件）
  const invB = await setupInvitation(h.api, { customerId: aCustB });
  const upB = await uploadBytes(h.api, invB, { bytes: bankCsvBytes(), customerId: aCustB });
  await driveToEnd(h.api, { maxRounds: 16 });
  const stB = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${aCustB}`, null, { method: 'GET' });
  const tB = stB.tasks.find((x) => x.task_id === upB.processing.taskId);
  assert.equal(tB.status, 'done', `跨客户同字节各自处理：${tB.status}/${tB.failure_code ?? ''}`);
  // A 侧清点：客户A=2 份材料（首件+不同期间件），客户B=1 份
  assert.equal((await aCustomerMaterials(aCust)).length, 2, '客户A 材料数=2（重复件不计）');
  assert.equal((await aCustomerMaterials(aCustB)).length, 1, '客户B 材料数=1');
});

test('L4 伪造拒绝：借他人邀请上传/CUSTOMER_MISMATCH、越权材料种类、跨租户读取隔离', { timeout: 120_000 }, async (t) => {
  const aCustA = await createACustomer('le-l4-a', 'L4 客户A');
  const aCustB = await createACustomer('le-l4-b', 'L4 客户B');
  const h = await makeProcessingHarness(harnessOpts());
  t.after(() => h.dispose());
  const invA = await setupInvitation(h.api, { customerId: aCustA });
  // 借 A 客户邀请向 B 客户上传 → 403 CUSTOMER_MISMATCH，材料不落库
  const r = await fetch('http://127.0.0.1:48295/api/connectors/evidence/upload', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': 'proc_service_token' },
    body: JSON.stringify({
      tenantId: TENANT, customerId: aCustB, invitationId: invA.invitationId, kind: 'statement',
      contentBase64: bankCsvBytes().toString('base64'), contentType: 'application/octet-stream',
    }),
  });
  assert.equal(r.status, 403, `伪造客户字段拒绝：${r.status}`);
  assert.equal((await r.json()).error, 'CUSTOMER_MISMATCH');
  const evCount = (await h.store.query(`SELECT count(*)::int n FROM evidence_artifacts WHERE tenant_id=$1 AND customer_id=$2`, [TENANT, aCustB])).rows[0].n;
  assert.equal(evCount, 0, '伪造上传零落库（对象存储与证据登记均未发生）');
  // 越权材料种类：邀请只给 document → 上传 statement 被拒
  const invDoc = await setupInvitation(h.api, { customerId: aCustA, kinds: ['document'] });
  const r2 = await fetch('http://127.0.0.1:48295/api/connectors/evidence/upload', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': 'proc_service_token' },
    body: JSON.stringify({
      tenantId: TENANT, customerId: aCustA, invitationId: invDoc.invitationId, kind: 'statement',
      contentBase64: bankCsvBytes().toString('base64'), contentType: 'application/octet-stream',
    }),
  });
  assert.equal(r2.status, 403, `越权种类拒绝：${r2.status}`);
  assert.equal((await r2.json()).error, 'CUSTOMER_SCOPE_MISMATCH');
  // 跨租户读取隔离：其他租户名下无任务/问题
  const stOther = await h.api(`/api/connectors/processing/status?tid=tenant-other&cid=${aCustA}`, null, { method: 'GET' });
  assert.equal(stOther.tasks.length, 0, '跨租户查询零结果（不泄露）');
  // 预览归属对账（IR-04-2A-2）：B 客户 cid + A 客户工件 → 拒绝
  const upA = await uploadBytes(h.api, invA, { bytes: bankCsvBytes(), customerId: aCustA });
  await driveToEnd(h.api, { maxRounds: 10 });
  const pv = await fetch(`http://127.0.0.1:48295/api/connectors/evidence/preview?tid=${TENANT}&eid=${upA.evidenceId}&cid=${aCustB}`, {
    headers: { 'x-service-token': 'proc_service_token' },
  });
  assert.equal(pv.status, 403, '预览归属不一致拒绝（不为任意组合铸签名 URL）');
});

test('L5 解析后服务重启：任务不丢、A 登记零重复（崩溃注入 parse 段后重启续跑）', { timeout: 120_000 }, async (t) => {
  const { compose } = await import('../src/compose.mjs');
  const { startServer } = await import('../src/http/server.mjs');
  const { createTestDatabase, dropTestDatabase } = await import('../src/store/pg.mjs');
  const { mkdirSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');

  const created = await createTestDatabase({
    host: '127.0.0.1', port: Number(process.env.CONNECTORS_TEST_PG_PORT ?? 15443),
    user: process.env.CONNECTORS_TEST_PG_USER ?? 'cnext', password: process.env.CONNECTORS_TEST_PG_PASSWORD ?? 'cnext',
    database: process.env.CONNECTORS_TEST_PG_DATABASE ?? 'cnext',
  });
  const objectRoot = join(__dirname, '..', '.run', `test-objects-${created.dbName}`);
  mkdirSync(objectRoot, { recursive: true });
  const closes = [];
  t.after(async () => {
    for (const c of closes.reverse()) { try { await c(); } catch { /* 清理互不阻断 */ } }
    await dropTestDatabase({
      host: '127.0.0.1', port: Number(process.env.CONNECTORS_TEST_PG_PORT ?? 15443),
      user: process.env.CONNECTORS_TEST_PG_USER ?? 'cnext', password: process.env.CONNECTORS_TEST_PG_PASSWORD ?? 'cnext',
      database: process.env.CONNECTORS_TEST_PG_DATABASE ?? 'cnext',
    }, created.dbName);
    rmSync(objectRoot, { recursive: true, force: true });
  });

  const bootPhase = async (port, { crashAfterParse = false } = {}) => {
    let crashed = false;
    const svc = await compose({
      pg: { ...created }, objectRoot,
      signingSecret: 'proc_test_signing_secret', serviceToken: 'proc_service_token',
      wecomTransport: { kfSendMsg: async () => { throw new Error('blocked'); }, kfSyncMsg: async () => { throw new Error('blocked'); } },
      aBaseUrl: kernel.base, aCredential: CUST_TOKEN, a: bridgeCfg(),
      processing: {
        aTimeoutMs: 8000,
        ...(crashAfterParse ? { hookAfterStage: async (_task, stage) => { if (stage === 'parse' && !crashed) { crashed = true; throw new Error('simulated crash after parse'); } } } : {}),
      },
    });
    const { server } = await startServer(svc, {
      port, wecomConfig: { token: 'x', aesKey: 'x'.repeat(32), corpid: 'x', defaultTenantId: TENANT },
      trtcCallbackKey: 'proc_test_signing_secret', serviceToken: 'proc_service_token',
    });
    const api = async (p, body = {}, { method = 'POST', expect = 200 } = {}) => {
      const rr = await fetch(`http://127.0.0.1:${port}${p}`, {
        method, headers: { 'content-type': 'application/json', 'x-service-token': 'proc_service_token' },
        body: method === 'POST' ? JSON.stringify(body) : undefined,
      });
      const jj = await rr.json().catch(() => ({}));
      if (rr.status !== expect) throw new Error(`${p} → ${rr.status}: ${JSON.stringify(jj).slice(0, 200)}`);
      return jj;
    };
    return { svc, server, api, close: async () => { server.closeAllConnections(); await new Promise((r) => server.close(() => r())); await svc.close(); } };
  };

  // ① 阶段1：parse 完成后崩溃注入
  const aCust = await createACustomer('le-l5-restart', 'L5 重启合成客户');
  const phase1 = await bootPhase(48296, { crashAfterParse: true });
  closes.push(() => phase1.close());
  const inv = await setupInvitation(phase1.api, { customerId: aCust });
  const up = await uploadBytes(phase1.api, inv, { bytes: bankCsvBytes(), customerId: aCust });
  // 只跑一轮且 maxTasks=1：崩溃注入后任务回队；同 tick 不重认领（否则第二次认领无注入直接完成，
  // 破坏"崩溃后任务保持回队"的断言前提）
  await driveToEnd(phase1.api, { maxRounds: 1, maxTasks: 1 });
  const st = await phase1.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${aCust}`, null, { method: 'GET' });
  const task = st.tasks.find((x) => x.task_id === up.processing.taskId);
  assert.equal(task.status, 'queued', `崩溃后任务回队（不丢）：${task.status}`);
  assert.equal(task.stage_cursor, 'facts', 'parse 已完成：游标在 facts（零重复解析的前提）');
  const factsAfterCrash = (await phase1.svc.store.query(`SELECT count(*)::int n FROM fact_assertions WHERE tenant_id=$1 AND customer_id=$2`, [TENANT, aCust])).rows[0].n;
  assert.equal(factsAfterCrash, 0, `parse 段后崩溃：游标已指向 facts 而事实尚未落库（解析结果已缓存持久化）: ${factsAfterCrash}`);
  await phase1.close();

  // ② 阶段2：重启（同 PG 库、同对象根、同 A 内核）→ 续跑到终态
  const phase2 = await bootPhase(48297);
  closes.push(() => phase2.close());
  for (let i = 0; i < 16; i++) { const r = await phase2.api('/api/connectors/processing/tick', { maxTasks: 4 }); if (r.claimed === 0) break; }
  const st2 = await phase2.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${aCust}`, null, { method: 'GET' });
  const task2 = st2.tasks.find((x) => x.task_id === up.processing.taskId);
  assert.equal(task2.status, 'done', `重启续跑完成：${task2.status}/${task2.failure_code ?? ''}`);
  assert.equal(task2.aRegistered, true);
  assert.equal((await aCustomerMaterials(aCust)).length, 1, 'A 材料恰 1 份（崩溃+重启不重复登记）');
  const factsFinal = (await phase2.svc.store.query(`SELECT count(*)::int n FROM fact_assertions WHERE tenant_id=$1 AND customer_id=$2`, [TENANT, aCust])).rows[0].n;
  assert.ok(factsFinal >= 1, `重启续跑后事实落库一次：${factsFinal}`);
  const dupFacts = (await phase2.svc.store.query(
    `SELECT count(*)::int n FROM (SELECT predicate, object_value FROM fact_assertions WHERE tenant_id=$1 AND customer_id=$2 GROUP BY predicate, object_value HAVING count(*) > 1) d`,
    [TENANT, aCust],
  )).rows[0].n;
  assert.equal(dupFacts, 0, `事实零重复（崩溃+重启不产生重复候选）：${dupFacts}`);
});

test('L6 不利材料与人工更正：Gate 真实变化（NEEDS_EVIDENCE→HARD_BLOCK→回落），A 侧回执逐次留痕，历史不覆写', { timeout: 120_000 }, async (t) => {
  const aCust = await createACustomer('le-l6-adverse', 'L6 不利材料合成客户');
  const h = await makeProcessingHarness(harnessOpts());
  t.after(() => h.dispose());
  const inv = await setupInvitation(h.api, { customerId: aCust });
  // 基线：扫描件人工录入（转录=source_supported，规则前置达级）：现金流充足、无新增债务
  const upScan = await uploadBytes(h.api, inv, { kind: 'document', bytes: Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8'), customerId: aCust });
  await driveToEnd(h.api, { maxRounds: 12 });
  await h.api('/api/connectors/evidence/manual-entry', {
    tenantId: TENANT, customerId: aCust, evidenceId: upScan.evidenceId,
    facts: [
      { factKey: 'monthly_operating_cash_flow', value: 76000, unit: '元', location: '扫描件第1页 经营现金流栏' },
      { factKey: 'monthly_debt_service', value: 18000, unit: '元', location: '扫描件第1页 偿债栏' },
      { factKey: 'top1_customer_revenue_share', value: 45, unit: '%', location: '扫描件第2页 客户集中度' },
      { factKey: 'entity_identity_verified', value: true, location: '扫描件第1页 主体信息' },
      { factKey: 'equipment_ownership_verified', value: true, location: '扫描件第2页 权属页' },
    ],
    enteredBy: 'staff-wang', reason: '扫描件无文本层，人工读取录入',
  });
  await driveToEnd(h.api, { maxRounds: 16 });
  let fins = (await h.store.query(`SELECT fin_id, input_hash, gate->>'result' AS result FROM analysis_finalizations WHERE tenant_id=$1 AND customer_id=$2 ORDER BY created_at`, [TENANT, aCust])).rows;
  assert.ok(fins.length >= 1, '基线收口存在');
  const gate1 = fins[fins.length - 1].result;
  assert.notEqual(gate1, 'HARD_BLOCK', `基线非硬阻断：${gate1}`);
  const gateReceipts1 = (await h.store.query(`SELECT count(*)::int n FROM a_links WHERE tenant_id=$1 AND customer_id=$2 AND entity_type='gate' AND status='registered'`, [TENANT, aCust])).rows[0].n;
  assert.ok(gateReceipts1 >= 1, '基线 Gate 已登记 A');

  // 不利材料（新上传声明件）：新增大额月供 → 压力覆盖率 76000/(18000+120000)=0.55 <1
  // → SIM-CASH-COVERAGE-STRESSED-01 命中。冻结规则包 v1.0.0 该门 nonWaivable=false
  // → RULE_HIT_REVIEW=HOLD_FOR_REVIEW（人工复核，非 HARD_BLOCK——不私改制度阈值/豁免性）。
  // Gate 依严重度恶化：NEEDS_EVIDENCE(1) → HOLD_FOR_REVIEW(2)，新增不利材料即时进入分析。
  const inv2 = await setupInvitation(h.api, { customerId: aCust });
  const upDebt = await uploadBytes(h.api, inv2, {
    bytes: declCsvBytes({ monthly_operating_cash_flow: '76000', monthly_debt_service: '18000', new_debt_monthly_payment: '120000', top1_customer_revenue_share: '45', entity_identity_verified: 'yes', equipment_ownership_verified: 'yes' }),
    customerId: aCust,
  });
  await driveToEnd(h.api, { maxRounds: 16 });
  fins = (await h.store.query(`SELECT fin_id, input_hash, gate->>'result' AS result, created_at FROM analysis_finalizations WHERE tenant_id=$1 AND customer_id=$2 ORDER BY created_at`, [TENANT, aCust])).rows;
  const gate2 = fins[fins.length - 1].result;
  assert.equal(gate2, 'HOLD_FOR_REVIEW', `新增不利材料后 Gate 恶化（压力门命中=HOLD）：${gate2}（收口序列 ${JSON.stringify(fins.map((f) => f.result))}）`);
  assert.notEqual(fins[0].input_hash, fins[fins.length - 1].input_hash, '新输入=新收口');
  const gateReceipts2 = (await h.store.query(`SELECT count(*)::int n FROM a_links WHERE tenant_id=$1 AND customer_id=$2 AND entity_type='gate' AND status='registered'`, [TENANT, aCust])).rows[0].n;
  assert.ok(gateReceipts2 > gateReceipts1, `A 侧 Gate 回执增加：${gateReceipts1}→${gateReceipts2}`);

  // 人工更正：更正新增月供为 0 → 压力覆盖恢复 76000/18000>1 → 压力门不再命中 → Gate 回落
  // （低于 HOLD_FOR_REVIEW）；旧事实/旧收口保留（superseded 修订链）
  const debtFact = (await h.store.query(
    `SELECT fact_id FROM fact_assertions WHERE tenant_id=$1 AND customer_id=$2 AND predicate='new_debt_monthly_payment' AND entry_mode IS NULL AND status='candidate' ORDER BY created_at DESC LIMIT 1`,
    [TENANT, aCust],
  )).rows[0];
  assert.ok(debtFact, '找到更正目标事实（parse 声明）');
  await h.api('/api/connectors/evidence/correct-fact', {
    tenantId: TENANT, customerId: aCust, correctsFactId: debtFact.fact_id,
    fact: { value: 0 }, correctedBy: 'staff-wang', reason: '该笔新增债务实际未获批，录入有误（来源：银行确认函）',
  });
  await driveToEnd(h.api, { maxRounds: 16 });
  const fins3 = (await h.store.query(`SELECT input_hash, gate->>'result' AS result FROM analysis_finalizations WHERE tenant_id=$1 AND customer_id=$2 ORDER BY created_at`, [TENANT, aCust])).rows;
  assert.ok(fins3.length > fins.length, '更正触发新收口（历史保留）');
  const gate3 = fins3[fins3.length - 1].result;
  assert.notEqual(gate3, 'HOLD_FOR_REVIEW', `更正后压力门回落：${gate3}（收口序列 ${JSON.stringify(fins3.map((f) => f.result))}）`);
  assert.notEqual(gate3, 'HARD_BLOCK', `更正后无硬阻断：${gate3}`);
  const oldFact = (await h.store.query(`SELECT status FROM fact_assertions WHERE fact_id=$1`, [debtFact.fact_id])).rows[0];
  assert.equal(oldFact.status, 'superseded', '旧事实保留（superseded 修订链）');
  const gateReceipts3 = (await h.store.query(`SELECT count(*)::int n FROM a_links WHERE tenant_id=$1 AND customer_id=$2 AND entity_type='gate' AND status='registered'`, [TENANT, aCust])).rows[0].n;
  assert.ok(gateReceipts3 > gateReceipts2, 'A 侧 Gate 回执再增（更正后新收口）');
  void upDebt;
});
