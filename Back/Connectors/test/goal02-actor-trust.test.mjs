// 任务02 · actor 可信来源与人工动作资源归属（IR-04-2A-3 冻结语义）：真实 PG + 真 HTTP。
// 断言铁律：人类 actor 只能由 token 绑定的网关调用方代理陈述（不是 header 存在性）；
// 非代理调用方自报人类 actor 一律拒绝；人工录入/更正不得跨客户借材料/借事实。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compose } from '../src/compose.mjs';
import { startServer } from '../src/http/server.mjs';
import { createTestDatabase, dropTestDatabase } from '../src/store/pg.mjs';
import { TENANT, BASE_PG, SIGNING_SECRET, setupInvitation, uploadBytes, bankCsvBytes, declTxtBytes } from './processing-helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = 48293;

/** 显式 callerBindings 装配：tok-gw=网关（可代理 actor）；tok-ops=内部（不可代理）。 */
async function boot({ dbName, objectRoot }) {
  const svc = await compose({
    pg: { ...BASE_PG, database: dbName },
    objectRoot,
    signingSecret: SIGNING_SECRET,
    serviceToken: 'tok-gw',
    wecomTransport: { kfSendMsg: async () => { throw new Error('blocked'); }, kfSyncMsg: async () => { throw new Error('blocked'); } },
  });
  const { server } = await startServer(svc, {
    port: PORT,
    wecomConfig: { token: 'x', aesKey: 'x'.repeat(32), corpid: 'x', defaultTenantId: TENANT },
    trtcCallbackKey: SIGNING_SECRET,
    serviceToken: 'tok-gw',
    callerBindings: [
      { token: 'tok-gw', caller: 'edge-gateway', mayDelegateActor: true },
      { token: 'tok-ops', caller: 'internal-ops', mayDelegateActor: false },
    ],
  });
  const call = async (path, body, { token = 'tok-gw', expect = 200, method = 'POST' } = {}) => {
    const r = await fetch(`http://127.0.0.1:${PORT}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-service-token': token },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, body: j, expectOk: r.status === expect };
  };
  const api = async (path, body, opts = {}) => {
    const r = await call(path, body, opts);
    if (!r.expectOk) throw new Error(`${path} → ${r.status}（期望 ${opts.expect ?? 200}）: ${JSON.stringify(r.body).slice(0, 300)}`);
    return r.body;
  };
  return {
    svc, server, api, call,
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(() => r()));
      await svc.close();
    },
  };
}

test('T1 actor 可信来源：网关令牌代理 actor 通过；内部令牌自报人类 actor 拒绝；未声明以服务身份执行；未绑定令牌 fail closed', { timeout: 60_000 }, async (t) => {
  const created = await createTestDatabase(BASE_PG);
  const objectRoot = join(ROOT, '.run', `test-objects-${created.dbName}`);
  mkdirSync(objectRoot, { recursive: true });
  const h = await boot({ dbName: created.dbName, objectRoot });
  t.after(async () => {
    await h.close();
    await dropTestDatabase(BASE_PG, created.dbName);
    rmSync(objectRoot, { recursive: true, force: true });
  });
  const CUST = 'cust-actor-1';
  const inv = await setupInvitation(h.api, { customerId: CUST });
  const up = await uploadBytes(h.api, inv, { kind: 'document', bytes: declTxtBytes({ note_actor: 'ok' }), customerId: CUST });

  // ① 网关令牌（tok-gw）代理 enteredBy → 通过（页面人工录入经 Edge 换权的正常形态）
  const gw = await h.api('/api/connectors/evidence/manual-entry', {
    tenantId: TENANT, customerId: CUST, evidenceId: up.evidenceId,
    facts: [{ factKey: 'equipment_model', value: 'LX-105', location: '第1页' }],
    enteredBy: 'staff-wang', reason: '扫描件人工转录',
  });
  assert.equal(gw.ok, true, '网关代理 actor 通过');

  // ② 内部令牌（tok-ops）自报人类 actor → 403 ACTOR_NOT_DELEGABLE（拒绝而非静默改写）
  const opsSelf = await h.call('/api/connectors/evidence/manual-entry', {
    tenantId: TENANT, customerId: CUST, evidenceId: up.evidenceId,
    facts: [{ factKey: 'equipment_model', value: 'LX-200', location: '第1页' }],
    enteredBy: 'staff-forged', reason: '伪造内部人工录入',
  }, { token: 'tok-ops', expect: 403 });
  assert.equal(opsSelf.body.error, 'ACTOR_NOT_DELEGABLE', `内部令牌自报 actor 须拒绝：${JSON.stringify(opsSelf.body).slice(0, 160)}`);
  const forgedCount = (await h.svc.store.query(
    `SELECT count(*)::int n FROM fact_assertions WHERE tenant_id=$1 AND predicate='equipment_model' AND object_value='LX-200'`, [TENANT],
  )).rows[0].n;
  assert.equal(forgedCount, 0, '被拒请求零事实落库');

  // ③ 内部令牌不自报 actor → 以服务身份执行（svc:internal-ops），可审计
  const opsSvc = await h.api('/api/connectors/evidence/manual-entry', {
    tenantId: TENANT, customerId: CUST, evidenceId: up.evidenceId,
    facts: [{ factKey: 'equipment_model', value: 'LX-300', location: '第2页' }],
    reason: '内部自动化补录（服务身份）',
  }, { token: 'tok-ops' });
  assert.equal(opsSvc.ok, true, '内部令牌服务身份执行通过');
  const svcFact = (await h.svc.store.query(
    `SELECT statement FROM fact_assertions WHERE tenant_id=$1 AND predicate='equipment_model' AND object_value='LX-300'`, [TENANT],
  )).rows[0];
  assert.ok(String(svcFact?.statement).includes('svc:internal-ops'), `服务身份可审计：${svcFact?.statement?.slice(0, 80)}`);
  const svcAudit = (await h.svc.store.query(
    `SELECT actor FROM audit_log WHERE tenant_id=$1 AND action='FACTS_MANUAL_ENTERED' AND actor LIKE 'svc:%' ORDER BY at DESC LIMIT 1`, [TENANT],
  )).rows[0];
  assert.equal(svcAudit?.actor, 'svc:internal-ops', '审计 actor=svc:internal-ops（token 绑定生成，非自报）');

  // ④ 显式 callerBindings 下未绑定令牌 → 服务令牌门即拒（403 fail closed；人工动作面不可达）
  const unknown = await h.call('/api/connectors/evidence/manual-entry', {
    tenantId: TENANT, customerId: CUST, evidenceId: up.evidenceId,
    facts: [{ factKey: 'equipment_model', value: 'LX-400' }], reason: '未绑定令牌',
  }, { token: 'tok-unknown', expect: 403 });
  assert.ok(['CALLER_NOT_TRUSTED', 'PRINCIPAL_UNTRUSTED'].includes(unknown.body.error),
    `未绑定令牌 fail closed：${unknown.body.error}（CALLER_NOT_TRUSTED 为纵深防御冗余）`);

  // ⑤ questions/verify 同一语义：内部令牌自报复核人 → 拒绝
  await h.svc.store.query(
    `INSERT INTO prepared_questions (tenant_id, customer_id, question_key, binding, tier, status, note)
     VALUES ($1,$2,'q-actor-verify','{"questionId":"q-manual-x"}','human_gate','needs_human','actor-trust 测试')`,
    [TENANT, CUST],
  );
  const opsVerify = await h.call('/api/connectors/questions/verify', {
    tenantId: TENANT, customerId: CUST, questionKey: 'q-actor-verify',
    verifiedBy: 'staff-forged', note: '伪造获准复核',
  }, { token: 'tok-ops', expect: 403 });
  assert.equal(opsVerify.body.error, 'ACTOR_NOT_DELEGABLE', '复核升级同样受 actor 代理权约束');
});

test('T2 人工动作资源归属：manual-entry 借他客户材料、correct-fact 借他客户事实 → 403 零落库；问题回答天然客户作用域', { timeout: 60_000 }, async (t) => {
  const created = await createTestDatabase(BASE_PG);
  const objectRoot = join(ROOT, '.run', `test-objects-${created.dbName}`);
  mkdirSync(objectRoot, { recursive: true });
  const h = await boot({ dbName: created.dbName, objectRoot });
  t.after(async () => {
    await h.close();
    await dropTestDatabase(BASE_PG, created.dbName);
    rmSync(objectRoot, { recursive: true, force: true });
  });
  const CUST_A = 'cust-own-a';
  const CUST_B = 'cust-own-b';
  const invA = await setupInvitation(h.api, { customerId: CUST_A });
  const upA = await uploadBytes(h.api, invA, { bytes: bankCsvBytes(), customerId: CUST_A });
  const invB = await setupInvitation(h.api, { customerId: CUST_B });

  // ① manual-entry：B 客户声明 + A 客户材料 → 403 CUSTOMER_MISMATCH，B 零事实零观测
  const cross = await h.call('/api/connectors/evidence/manual-entry', {
    tenantId: TENANT, customerId: CUST_B, evidenceId: upA.evidenceId,
    facts: [{ factKey: 'monthly_operating_cash_flow', value: 999, location: '借用他户材料' }],
    enteredBy: 'staff-wang', reason: '跨客户录入尝试',
  }, { expect: 403 });
  assert.equal(cross.body.error, 'CUSTOMER_MISMATCH', `借材料录入须拒绝：${JSON.stringify(cross.body).slice(0, 160)}`);
  const factsB = (await h.svc.store.query(
    `SELECT count(*)::int n FROM fact_assertions WHERE tenant_id=$1 AND customer_id=$2`, [TENANT, CUST_B],
  )).rows[0].n;
  assert.equal(factsB, 0, 'B 客户零事实（拒绝发生在任何写入之前）');
  const obsB = (await h.svc.store.query(
    `SELECT count(*)::int n FROM evidence_observations o JOIN evidence_artifacts a ON a.evidence_id=o.artifact_id AND a.tenant_id=o.tenant_id
     WHERE o.tenant_id=$1 AND a.customer_id=$2`, [TENANT, CUST_A],
  )).rows[0].n;
  assert.equal(obsB, 0, 'A 客户材料上零脏观测');

  // ② correct-fact：先在 A 客户产生一条事实（合法录入），再用 B 客户声明更正 → 403
  const entry = await h.api('/api/connectors/evidence/manual-entry', {
    tenantId: TENANT, customerId: CUST_A, evidenceId: upA.evidenceId,
    facts: [{ factKey: 'monthly_debt_service', value: 18000, unit: '元', location: '第1页' }],
    enteredBy: 'staff-wang', reason: '基线录入',
  });
  assert.equal(entry.ok, true);
  const factA = (await h.svc.store.query(
    `SELECT fact_id FROM fact_assertions WHERE tenant_id=$1 AND customer_id=$2 AND predicate='monthly_debt_service' ORDER BY created_at DESC LIMIT 1`,
    [TENANT, CUST_A],
  )).rows[0];
  const crossFix = await h.call('/api/connectors/evidence/correct-fact', {
    tenantId: TENANT, customerId: CUST_B, correctsFactId: factA.fact_id,
    fact: { value: 0 }, correctedBy: 'staff-wang', reason: '跨客户更正尝试',
  }, { expect: 403 });
  assert.equal(crossFix.body.error, 'CUSTOMER_MISMATCH', `借事实更正须拒绝：${JSON.stringify(crossFix.body).slice(0, 160)}`);
  const supersededCount = (await h.svc.store.query(
    `SELECT count(*)::int n FROM fact_assertions WHERE fact_id=$1 AND status='superseded'`, [factA.fact_id],
  )).rows[0].n;
  assert.equal(supersededCount, 0, '被更正事实未被跨客户更正触碰（修订链零污染）');
  // customerId 缺省时以事实归属为准（不推断）：省略 customerId 合法更正
  const ownFix = await h.api('/api/connectors/evidence/correct-fact', {
    tenantId: TENANT, correctsFactId: factA.fact_id,
    fact: { value: 0 }, correctedBy: 'staff-wang', reason: '该笔月供重复录入，实际为 0',
  });
  assert.equal(ownFix.ok, true, '归属客户（缺省=事实归属）更正通过');

  // ③ questions/answer：问题绑定客户，跨客户回答 0 行 → INVALID_STATE（归属内建于作用域）
  await h.svc.store.query(
    `INSERT INTO prepared_questions (tenant_id, customer_id, question_key, binding, tier, status, note)
     VALUES ($1,$2,'q-ownership-1','{"questionId":"q-manual-y"}','human_gate','sent_ok','T2 归属测试')`,
    [TENANT, CUST_A],
  );
  const crossAns = await h.call('/api/connectors/questions/answer', {
    tenantId: TENANT, customerId: CUST_B, questionKey: 'q-ownership-1', answerText: '冒充回答',
  }, { expect: 409 });
  assert.equal(crossAns.body.error, 'INVALID_STATE', '跨客户回答无行可更新（客户作用域拒绝）');
  const stillOpen = (await h.svc.store.query(
    `SELECT status FROM prepared_questions WHERE tenant_id=$1 AND question_key='q-ownership-1'`, [TENANT],
  )).rows[0];
  assert.equal(stillOpen.status, 'sent_ok', '问题状态未被跨客户回答改写');
  const ownAns = await h.api('/api/connectors/questions/answer', {
    tenantId: TENANT, customerId: CUST_A, questionKey: 'q-ownership-1', answerText: '本月新增贷款已结清', answerer: 'customer-a',
  });
  assert.equal(ownAns.ok, true, '归属客户回答通过');

  // ④ 读面租户隔离：task 详情与 receipts 对其他租户不泄露
  const tOther = await h.call(`/api/connectors/processing/tasks/ptx-nonexistent?tid=tenant-other`, null, { method: 'GET', expect: 404 });
  assert.equal(tOther.body.error, 'NOT_FOUND');
  const rOther = await h.api(`/api/connectors/processing/receipts/ptx-anything-mat?tid=tenant-other`, null, { method: 'GET' });
  assert.equal(rOther.found, false, '其他租户查询回执零泄露（found:false）');
});
