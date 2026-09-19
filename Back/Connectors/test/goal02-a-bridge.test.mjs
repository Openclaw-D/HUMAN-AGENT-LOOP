// goal-02（产品交付·任务二）· A 桥集成 e2e：真实 A 内核 + 真实 PG + 真实 HTTP 全链。
// 断言铁律（任务书 §六）：四域→A 贯通必须在 A 侧读到持久回执——只读直查 A 库
// analysis_runs / rule_gate_receipts / evidence_artifacts / decision_findings；
// 不向被测链路预填事实/Gate/分析终态，全部产物来自原始字节上传后的真实执行。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { TENANT, makeProcessingHarness, setupInvitation, uploadBytes, driveToEnd, bankCsvBytes, declTxtBytes, makeZip } from './processing-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const A_ROOT = path.resolve(__dirname, '../../A');
const CUST = 'cust-proc-1';

// 隔离环境门：A 管理库（jw-cc-kernel-pg@15444）不可达 → 显式 SKIP，不计 PASS
const A_ADMIN_DB = process.env.JW_A_ADMIN_DB_URL ?? 'postgres://jwcc:jwcc-local-demo@127.0.0.1:15444/postgres';

async function pgReachable(cs) {
  try {
    const p = new pg.Pool({ connectionString: cs, max: 1, connectionTimeoutMillis: 2000 });
    await p.query('SELECT 1');
    await p.end();
    return true;
  } catch { return false; }
}

const ok = await pgReachable(A_ADMIN_DB);
if (!ok) {
  console.log('# SKIP: A 管理库 15444 不可达（blocked_env，不计 PASS）');
  process.exit(0);
}

const ADMIN_TOKEN = 'tok-adm2';
const POLICY_TOKEN = 'tok-pol2';
const BIZ_TOKEN = 'tok-biz2';
const CUST_TOKEN = 'tok-cust2';
const SVC_TOKEN = 'tok-svc2';
const PRINCIPAL_SPEC = [
  `${ADMIN_TOKEN}=adm2:human:admin:all:all`,
  `${POLICY_TOKEN}=pol2:human:policy:all:all`,
  `${BIZ_TOKEN}=biz2:human:business:all:all`,
  `${CUST_TOKEN}=cust2:human:customer:all:all`,
  `${SVC_TOKEN}=svc2:service:policy+credit+commerce+asset:all:all`,
].join(',');
const RULE_PACK_VERSION = '1.0.0'; // C/rules/four-domain-rule-pack-v1.json 的 version；A 侧正式激活后 deps 才可声明

const A_PORT = 48310 + Math.floor(Math.random() * 40);

async function createAdb() {
  const name = `goal02_a_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: A_ADMIN_DB });
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const base = new URL(A_ADMIN_DB);
  base.pathname = `/${name}`;
  return { name, url: base.toString() };
}

async function startKernel(dbUrl) {
  const args = ['src/index.ts', '--port', String(A_PORT), '--db', dbUrl, '--principal-tokens', PRINCIPAL_SPEC,
    '--required-domains-policy', 'goal02-synthetic-policy'];
  const child = spawn('node', args, { cwd: A_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));
  const base = `http://127.0.0.1:${A_PORT}`;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${base}/healthz`);
      if (r.ok) return { child, base, logs };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`A 内核未就绪：${logs.join('').slice(-800)}`);
}

const aApi = async (base, token, method, path, body) => {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { 'x-principal-credential': token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
};

test('G-A1 全链贯通：原始字节上传 → A 材料/派生件/4 域已完成运行/Gate 回执；冲突 → A 复核队列', { timeout: 180_000 }, async (t) => {
  const db = await createAdb();
  const kernel = await startKernel(db.url);
  const pgPool = new pg.Pool({ connectionString: db.url });
  // ① 种子（测试 setup，显式声明）：C 规则包版本经 policy 人类正式激活；建 A 客户
  const act = await aApi(kernel.base, POLICY_TOKEN, 'POST', '/api/v2/rule-pack-versions/activate', { requestId: `seed-act-${randomBytes(4).toString('hex')}`, version: RULE_PACK_VERSION, tenantId: TENANT });
  assert.equal(act.status, 200, `规则包激活：${JSON.stringify(act.body).slice(0, 200)}`);
  const cust = await aApi(kernel.base, BIZ_TOKEN, 'POST', '/api/v2/customers', { requestId: `seed-cust-${randomBytes(4).toString('hex')}`, legalEntityRef: 'synthetic-ent-1', displayName: 'goal02 集成合成客户', tenantId: TENANT });
  assert.equal(cust.status, 200, `建 A 客户：${JSON.stringify(cust.body).slice(0, 200)}`);
  const aCustomerId = cust.body.customerId;

  const h = await makeProcessingHarness({
    port: 48285,
    aBaseUrl: kernel.base,
    aConfig: {
      tenantId: TENANT,
      credentials: {
        service: SVC_TOKEN, registrar: BIZ_TOKEN, reviewer: BIZ_TOKEN,
        upload: { customer_finance: CUST_TOKEN, customer_owner: CUST_TOKEN },
        uploadFallback: CUST_TOKEN,
      },
    },
    processing: { aCustomerLinks: { [CUST]: { aCustomerId } }, aTimeoutMs: 8000 },
  });
  t.after(async () => {
    await h.dispose();
    pgPool.end();
    kernel.child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    kernel.child.kill('SIGKILL');
    const admin = new pg.Pool({ connectionString: A_ADMIN_DB });
    await admin.query(`DROP DATABASE IF EXISTS ${db.name} WITH (FORCE)`).catch(() => {});
    await admin.end();
  });

  // ② 上传真实银行流水（原始字节）→ 处理链推进到 A
  const inv = await setupInvitation(h.api, { role: 'customer_finance' });
  const up = await uploadBytes(h.api, inv, { bytes: bankCsvBytes(), periodFrom: '2026-01-01', periodTo: '2026-02-28' });
  assert.ok(up.processing?.taskId);
  const rounds = await driveToEnd(h.api, { maxRounds: 16 });
  const st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
  if (st.tasks[0].status !== 'done') {
    const dbg = await fetch(`http://127.0.0.1:48285/api/connectors/processing/tasks/${st.tasks[0].task_id}?tid=${TENANT}`, { headers: { 'x-service-token': 'proc_service_token' } }).then((r) => r.json());
    assert.fail(`处理链未完成：${JSON.stringify({ task: st.tasks[0], stages: dbg.task?.stages, aOps: dbg.task?.aOps })}`);
  }
  assert.equal(st.tasks[0].status, 'done');

  // ③ A 侧只读断言：材料 + 派生解析件（等级≤上游=unverified；provenance 指向原件）
  const arts = await aApi(kernel.base, BIZ_TOKEN, 'GET', `/api/v2/customers/${aCustomerId}/artifacts`);
  assert.equal(arts.status, 200);
  const artList = arts.body.artifacts ?? [];
  const mat = artList.find((a) => a.kind === 'material.statement');
  assert.ok(mat, `A 有材料工件：${artList.map((a) => a.kind).join(',')}`);
  assert.equal(mat.grade, 'unverified', '客户上传恒 unverified（机器不冒充核验）');
  const der = artList.find((a) => a.kind === 'parse_extraction');
  assert.ok(der, 'A 有派生解析工件（解析产物进 A）');
  assert.equal(der.provenance?.derivedFrom?.[0], mat.artifactId, '派生件 provenance 指向原件');
  assert.equal(der.provenance?.generator?.includes('processing'), true);

  // ④ A 侧只读断言：4 域 analysis_runs 全部 completed（真实执行产物，A start 时盖章 input_digest）
  const runs = (await pgPool.query(`SELECT domain, status, rule_version, input_digest FROM analysis_runs WHERE customer_id=$1 ORDER BY domain`, [aCustomerId])).rows;
  if (runs.length !== 4) {
    const dbg = await fetch(`http://127.0.0.1:48285/api/connectors/processing/tasks/${st.tasks[0].task_id}?tid=${TENANT}`, { headers: { 'x-service-token': 'proc_service_token' } }).then((r) => r.json());
    const rr = await h.store.query(`SELECT domain, artifact_refs, input_hash FROM domain_analyses WHERE tenant_id=$1 AND customer_id=$2`, [TENANT, CUST]);
    assert.fail(`四域运行不足：${JSON.stringify({ runs, stages: dbg.task?.stages?.filter((x) => x.stage === 'register_results'), aOps: dbg.task?.aOps, localDomains: rr.rows })}`);
  }
  assert.equal(runs.length, 4, `四域各一条运行：${JSON.stringify(runs)}`);
  for (const r of runs) {
    assert.equal(r.status, 'completed', `${r.domain} 运行 completed`);
    assert.equal(r.rule_version, RULE_PACK_VERSION);
    assert.ok(r.input_digest, 'A 已盖章输入摘要');
  }

  // ⑤ A 侧只读断言：Gate 回执（service 身份登记；C 收口结论 1:1）
  const gates = (await pgPool.query(`SELECT result, ruleset_version, input_digest, registered_by FROM rule_gate_receipts WHERE customer_id=$1`, [aCustomerId])).rows;
  assert.equal(gates.length, 1, 'Gate 回执恰一条（同输入幂等）');
  assert.ok(['CLEAR', 'NEEDS_EVIDENCE', 'HOLD_FOR_REVIEW', 'HARD_BLOCK'].includes(gates[0].result));
  assert.equal(gates[0].ruleset_version, RULE_PACK_VERSION);
  assert.equal(gates[0].registered_by, 'svc2', 'Gate 回执由 service 身份登记');

  // ⑥ 幂等重入：重复 tick 零新增（a_links 全 registered，不换 ID 重发）
  await driveToEnd(h.api, { maxRounds: 4 });
  const runs2 = (await pgPool.query(`SELECT count(*)::int n FROM analysis_runs WHERE customer_id=$1`, [aCustomerId])).rows[0].n;
  assert.equal(runs2, 4, '重入零新增运行');
  const gates2 = (await pgPool.query(`SELECT count(*)::int n FROM rule_gate_receipts WHERE customer_id=$1`, [aCustomerId])).rows[0].n;
  assert.equal(gates2, 1, '重入零新增 Gate 回执');

  // ⑦ 冲突 → A findings：同批 ZIP 内两份声明同键不同值 → 事实冲突 → 复核队列
  const conflictZip = makeZip([
    { name: 'a.txt', data: declTxtBytes({ monthly_operating_cash_flow: '46000' }) },
    { name: 'b.txt', data: declTxtBytes({ monthly_operating_cash_flow: '99000' }) },
  ]);
  const up2 = await uploadBytes(h.api, inv, { kind: 'document', bytes: conflictZip });
  await driveToEnd(h.api, { maxRounds: 16 });
  const st2 = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
  const zipTask = st2.tasks.find((x) => x.task_id === up2.processing.taskId);
  assert.equal(zipTask.status, 'done', '容器任务完成（派生件各自推进）');
  const localConflicts = (await h.store.query(`SELECT count(*)::int n FROM fact_conflicts WHERE tenant_id=$1 AND customer_id=$2 AND state='open'`, [TENANT, CUST])).rows[0].n;
  assert.ok(localConflicts >= 1, `本地存在事实冲突：${localConflicts}`);
  await driveToEnd(h.api, { maxRounds: 8 });
  const findings = (await pgPool.query(`SELECT finding_type, assertion, created_by FROM decision_findings WHERE customer_id=$1`, [aCustomerId])).rows;
  assert.ok(findings.length >= 1, '事实冲突已登记 A 复核队列（service 可建、人类处理）');
  assert.equal(findings[0].finding_type, 'material_conflict');
  assert.equal(findings[0].created_by, 'svc2');
});

test('G-A2 确定性拒绝如实失败：规则版本未激活 → 任务 failed（不降级不伪造）', { timeout: 120_000 }, async (t) => {
  const db = await createAdb();
  const kernel = await startKernel(db.url); // 不激活规则包
  const h = await makeProcessingHarness({
    port: 48286,
    aBaseUrl: kernel.base,
    aConfig: {
      tenantId: TENANT,
      credentials: { service: SVC_TOKEN, registrar: BIZ_TOKEN, uploadFallback: CUST_TOKEN },
    },
    processing: { aCustomerLinks: { [CUST]: { aCustomerId: 'will-fail' } }, aTimeoutMs: 8000 },
  });
  t.after(async () => {
    await h.dispose();
    kernel.child.kill('SIGKILL');
    const admin = new pg.Pool({ connectionString: A_ADMIN_DB });
    await admin.query(`DROP DATABASE IF EXISTS ${db.name} WITH (FORCE)`).catch(() => {});
    await admin.end();
  });
  // 该测试不建 A 客户 → 材料登记确定性 404 → 任务 failed（如实失败，不静默跳过、不伪造成功）
  const inv = await setupInvitation(h.api);
  const up = await uploadBytes(h.api, inv, { bytes: bankCsvBytes() });
  await driveToEnd(h.api, { maxRounds: 12 });
  const st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
  const task = st.tasks.find((x) => x.task_id === up.processing.taskId);
  assert.equal(task.status, 'failed', 'A 确定性拒绝 → failed（不重试掩盖）');
  assert.equal(task.failure_code, 'NOT_FOUND', '失败码=NOT_FOUND（A 客户不存在）');
  const op = (await h.store.query(`SELECT status FROM a_links WHERE request_id=$1`, [`ptx-${task.task_id}-mat`])).rows[0];
  assert.equal(op.status, 'failed', 'a_links 留痕确定性失败');
});

// IR-03-8①+②（2026-09-19 续轮）：G3 处理状态写口真实推进 + 人工事实并入四域输入使 Gate 可被人工路线满足。
// 种子经 a.customerLinks 形态透传（IR-03-8⑤，原 start-connectors 丢弃路径），不配 processing.aCustomerLinks。
test('G-A3 ①G3 状态推进（received→needs_review→analyzed；service 身份；按尝试重开；幂等重入零新增）+ ②人工路线 NEEDS_EVIDENCE→CLEAR 到达 A', { timeout: 180_000 }, async (t) => {
  const db = await createAdb();
  const kernel = await startKernel(db.url);
  const pgPool = new pg.Pool({ connectionString: db.url });
  const act = await aApi(kernel.base, POLICY_TOKEN, 'POST', '/api/v2/rule-pack-versions/activate', { requestId: `seed-act-${randomBytes(4).toString('hex')}`, version: RULE_PACK_VERSION, tenantId: TENANT });
  assert.equal(act.status, 200, `规则包激活：${JSON.stringify(act.body).slice(0, 200)}`);
  const cust = await aApi(kernel.base, BIZ_TOKEN, 'POST', '/api/v2/customers', { requestId: `seed-cust-${randomBytes(4).toString('hex')}`, legalEntityRef: 'synthetic-ent-ga3', displayName: 'goal02 G-A3 合成客户', tenantId: TENANT });
  assert.equal(cust.status, 200);
  const aCustomerId = cust.body.customerId;

  const h = await makeProcessingHarness({
    port: 48287,
    aBaseUrl: kernel.base,
    aConfig: {
      tenantId: TENANT,
      credentials: {
        service: SVC_TOKEN, registrar: BIZ_TOKEN, reviewer: BIZ_TOKEN,
        upload: { customer_finance: CUST_TOKEN, customer_owner: CUST_TOKEN },
        uploadFallback: CUST_TOKEN,
      },
      customerLinks: { [CUST]: { aCustomerId } }, // ⑤：种子走 a.customerLinks（compose 侧透传）
    },
    processing: { aTimeoutMs: 8000 },
  });
  t.after(async () => {
    await h.dispose();
    pgPool.end();
    kernel.child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    kernel.child.kill('SIGKILL');
    const admin = new pg.Pool({ connectionString: A_ADMIN_DB });
    await admin.query(`DROP DATABASE IF EXISTS ${db.name} WITH (FORCE)`).catch(() => {});
    await admin.end();
  });

  const histOf = async (artifactId) => (await pgPool.query(
    `SELECT run_ref, stage, failure_reason, next_action, registered_by FROM artifact_processing WHERE artifact_id=$1 ORDER BY id`,
    [artifactId],
  )).rows;

  // ① 扫描件：received（A 登记）→ 解析转人工 needs_review（failureReason+nextAction，页面可解释下一动作）
  const inv = await setupInvitation(h.api, { role: 'customer_finance' });
  const up = await uploadBytes(h.api, inv, { kind: 'document', bytes: Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8') });
  await driveToEnd(h.api, { maxRounds: 12 });
  const st0 = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
  const task0 = st0.tasks.find((x) => x.task_id === up.processing.taskId);
  assert.equal(task0.status, 'needs_followup', '扫描件转人工');
  const arts0 = await aApi(kernel.base, BIZ_TOKEN, 'GET', `/api/v2/customers/${aCustomerId}/artifacts`);
  const scanArt = (arts0.body.artifacts ?? []).find((a) => a.kind === 'material.document');
  assert.ok(scanArt, '扫描件已登记 A');
  let hist = await histOf(scanArt.artifactId);
  assert.deepEqual(hist.map((r) => r.stage), ['received', 'needs_review'], `G3 阶段序列（尝试1）：${JSON.stringify(hist)}`);
  assert.match(hist[0].run_ref, new RegExp(`^${task0.task_id}:a1$`), 'runRef=<taskId>:a<attempt>');
  assert.equal(hist[1].failure_reason, 'FORMAT_UNSUPPORTED', 'needs_review 携带失败原因');
  assert.ok((hist[1].next_action ?? '').includes('人工录入'), 'needs_review 携带下一动作');
  assert.equal(hist[0].registered_by, 'svc2', 'G3 由 service 身份登记（human 403 不许伪造进度）');

  // ② 人工录入规则前置事实（转录=source_supported）→ 重入分析 → analyzed（尝试2）→ Gate#1 NEEDS_EVIDENCE 到 A
  await h.api('/api/connectors/evidence/manual-entry', {
    tenantId: TENANT, customerId: CUST, evidenceId: up.evidenceId,
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
  const st1 = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
  assert.equal(st1.tasks.find((x) => x.task_id === up.processing.taskId).status, 'done', '人工事实成为分析输入后全链完成');
  hist = await histOf(scanArt.artifactId);
  assert.deepEqual(hist.map((r) => r.stage), ['received', 'needs_review', 'analyzed'], '尝试2 上报 analyzed（新 runRef 重开）');
  assert.match(hist[2].run_ref, /:a2$/, 'analyzed 属尝试2 runRef');
  const gates1 = (await pgPool.query(`SELECT result FROM rule_gate_receipts WHERE customer_id=$1 ORDER BY created_at`, [aCustomerId])).rows;
  assert.equal(gates1.length, 1, 'Gate#1 已登记 A');
  assert.equal(gates1[0].result, 'NEEDS_EVIDENCE', 'source_supported 满足其级前置；verified 级规则仍缺证（不冒充通过）');
  const runs1 = (await pgPool.query(`SELECT domain, deps FROM analysis_runs WHERE customer_id=$1`, [aCustomerId])).rows;
  assert.equal(runs1.length, 4, '四域运行已登记');
  for (const r of runs1) {
    const depArts = r.deps?.artifactIds ?? [];
    assert.ok(depArts.includes(scanArt.artifactId), `${r.domain} 运行 deps 覆盖人工事实来源件（不伪造缩小依赖面）`);
  }

  // ② 获准复核 verified → 转录事实升级 → 重入分析 → Gate#2 CLEAR 到 A（正向批准前置成立）
  const q = (await h.api(`/api/connectors/questions/pending?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' })).questions
    .find((x) => x.binding?.purpose === 'manual_entry_required');
  await h.api('/api/connectors/questions/verify', {
    tenantId: TENANT, customerId: CUST, questionKey: q.question_key, verifiedBy: 'reviewer-li', note: '已对照原件逐项复核',
  });
  await driveToEnd(h.api, { maxRounds: 16 });
  const gates2 = (await pgPool.query(`SELECT result FROM rule_gate_receipts WHERE customer_id=$1 ORDER BY created_at`, [aCustomerId])).rows;
  assert.equal(gates2.length, 2, '复核升级=新收口=新 Gate 回执（历史保留）');
  assert.equal(gates2[1].result, 'CLEAR', `Gate 可被人工路线满足（CLEAR 到达 A）：${gates2[1].result}`);
  hist = await histOf(scanArt.artifactId);
  assert.equal(hist[hist.length - 1].stage, 'analyzed', '终态 analyzed');

  // ① 幂等重入：重复 tick 零新增 G3 行（同 requestId 确定性；绝不重复上报/换 ID）
  const prcCount = (await pgPool.query(`SELECT count(*)::int n FROM artifact_processing WHERE artifact_id=$1`, [scanArt.artifactId])).rows[0].n;
  await driveToEnd(h.api, { maxRounds: 4 });
  const prcCount2 = (await pgPool.query(`SELECT count(*)::int n FROM artifact_processing WHERE artifact_id=$1`, [scanArt.artifactId])).rows[0].n;
  assert.equal(prcCount2, prcCount, '重入零新增处理状态（A 侧单调/幂等纪律）');
  const runs2 = (await pgPool.query(`SELECT count(*)::int n FROM analysis_runs WHERE customer_id=$1`, [aCustomerId])).rows[0].n;
  assert.equal(runs2, 8, '重入零新增运行（两轮收口各 4）');
});

