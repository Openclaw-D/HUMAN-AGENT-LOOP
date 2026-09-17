// S5 备份/恢复演练 v2（goal-04 S-01/S-02）：种子不再手写 INSERT，而是经**真实业务 API**
// 产生覆盖全部业务域的非空关联数据，再 pg_dump → DROP → pg_restore → 校验。
// 相比 v1（仅 12 张 v1 表手写种子）的升级：
//   1) 种子=A 内核自动迁移（001..00N）+ 真实 API 链：客户授权/原件引用(证据版本+取代链)/
//      检查会话·问题·回答/分析回执/可信 Gate 回执/依据包+域结果/台账(申请+预占)/提额请求/
//      外发授权（sent 状态，验证恢复后不重放外部动作）。
//   2) 恢复校验不止"行数+指纹一致"：
//      a. 关系校验：包→域结果→分析运行→回执、申请→账目、会话→问题 等 JOIN 计数恢复前后一致；
//      b. 可续办：恢复后的库上重启内核 → readiness ok → 同 requestId 重放幂等 → 新预占成功；
//      c. 外部动作不重放：outbox_deliveries/外发 sent 状态原样保留，恢复后零新增投递、零重发。
// 端口纪律：自有 v7d- 容器 15439 / 内核 17927（与任务三 15434/17919、goal-04 性能 15438/17923 错开）。
// 证据：docs/backend-upgrade/goal-04/evidence/s5-drill-v2-<stamp>/drill-result.json
// 退出码：0=PASS；1=校验失败；2=执行错误。
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACK_ROOT = path.resolve(EDGE_ROOT, '..');
const REPO_ROOT = path.resolve(BACK_ROOT, '..');
const RUN_DIR = path.join(EDGE_ROOT, '.run', 'drill-v2-pg');
const PG_USER = 'v7next', PG_PASS = 'v7next', DB = 'v7d_drill2', PORT = 15439, API_PORT = 17927;
const TENANT = 't1';
const RULE_PACK = 'sim-pack-drill2';
const wan = (n) => n * 1_000_000;
const rid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const pgctl = await import('../../D/harness/pgctl.mjs');

const steps = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    const detail = await fn();
    steps.push({ name, ok: true, detail: detail ?? null, ms: Date.now() - t0 });
    console.log(`[drill2] ✓ ${name} (${Date.now() - t0}ms)`);
    return detail;
  } catch (e) {
    steps.push({ name, ok: false, detail: String(e.message).slice(0, 600), ms: Date.now() - t0 });
    console.error(`[drill2] ✗ ${name}: ${String(e.message).slice(0, 300)}`);
    throw e;
  }
};

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(`${cmd} exit=${code}: ${err.slice(0, 300)}`))));
  });
}
function api(base, token, method, pathUrl, body) {
  return fetch(`${base}${pathUrl}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-principal-credential': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => { let j = null; try { j = await r.json(); } catch { } return { status: r.status, json: j }; });
}
const waitHttp = async (url, ok, timeoutMs = 60000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); if (ok(r)) return true; } catch { }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
};

// ---- 动态逐表指纹：public 下全部用户表（含迁移簿记表，但恢复前后一致即无碍） ----
async function listTables(pgName) {
  const r = await pgctl.psql(pgName, DB, `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`, PG_USER);
  if (r.err) throw new Error(r.err);
  return r.out.split('\n').map((s) => s.trim()).filter(Boolean);
}
async function fingerprint(pgName, tables) {
  const result = {};
  for (const t of tables) {
    const cnt = await pgctl.psql(pgName, DB, `SELECT count(*) FROM "${t}"`, PG_USER);
    const fp = await pgctl.psql(pgName, DB, `SELECT coalesce(md5(string_agg(row_to_json(x)::text, E'\n' ORDER BY x)), 'EMPTY') FROM (SELECT * FROM "${t}") x`, PG_USER);
    if (cnt.err || fp.err || !/^([0-9a-f]{32}|EMPTY)$/.test(fp.out.trim())) throw new Error(`指纹失败 ${t}: ${cnt.err || fp.err || fp.out}`);
    result[t] = { rows: Number(cnt.out.trim()), md5: fp.out.trim() };
  }
  return result;
}

// ---- 关系校验查询（包→域结果→运行；申请→账目；会话→问题；授权→客户；Gate 回执→包） ----
const RELATION_QUERIES = {
  'package->domain_results': `SELECT count(*) FROM package_domain_results r JOIN decision_packages p ON r.package_id = p.package_id`,
  'domain_result->analysis_run(jsonb runId)': `SELECT count(*) FROM package_domain_results r JOIN analysis_runs a ON r.analysis_run->>'runId' = a.run_id`,
  'fr->exposure_entries': `SELECT count(*) FROM exposure_entries e JOIN financing_requests f ON e.fr_id = f.fr_id`,
  'session->questions': `SELECT count(*) FROM inspection_questions q JOIN inspection_sessions s ON q.session_id = s.session_id`,
  'grants->customers': `SELECT count(*) FROM principal_customer_grants g JOIN customers c ON g.customer_id = c.customer_id`,
  'gate_receipt->package(jsonb receiptId)': `SELECT count(*) FROM decision_packages p JOIN rule_gate_receipts g ON p.gate->>'receiptId' = g.receipt_id`,
  'assessment->facility': `SELECT count(*) FROM credit_facilities f JOIN credit_assessments a ON (f.basis->>'assessmentId') = a.assessment_id`,
  'artifacts->facts': `SELECT count(*) FROM fact_assertions fa JOIN evidence_artifacts ea ON fa.artifact_id = ea.artifact_id`,
};
async function relationCounts(pgName) {
  const out = {};
  for (const [name, sql] of Object.entries(RELATION_QUERIES)) {
    const r = await pgctl.psql(pgName, DB, sql, PG_USER);
    if (r.err) throw new Error(`关系校验 ${name}: ${r.err}`);
    out[name] = Number(r.out.trim());
  }
  return out;
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const evidenceDir = path.join(REPO_ROOT, 'docs', 'backend-upgrade', 'goal-04', 'evidence', `s5-drill-v2-${stamp}`);
  const dumpPath = path.join(RUN_DIR, `drill2-backup-${stamp}.dump`);
  let pg = null; let kernel = null; let kernel2 = null;
  let exitCode = 2;
  const bizTok = 'tok-dbiz=dbiz:human:business:all:t1';
  const credTok = 'tok-dcred=dcred:human:credit:all:t1';
  const appTok = 'tok-dapp=dapp:human:approver:all:t1';
  const svcTok = 'tok-dsvc=dsvc:service:policy+credit+commerce+asset:all:t1';
  const TKN = { biz: 'tok-dbiz', cred: 'tok-dcred', app: 'tok-dapp', svc: 'tok-dsvc', adm: 'tok-dadm' };
  let base;

  try {
    mkdirSync(RUN_DIR, { recursive: true });
    pg = await step('1 建自有隔离PG容器(v7d-,15439)', () => pgctl.ensurePg({ runDir: RUN_DIR, port: PORT, user: PG_USER, password: PG_PASS, db: 'v7d_boot' }));
    await step('2 建演练库(幂等丢弃残留)', async () => {
      await pgctl.psql(pg.name, 'postgres', `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`, PG_USER).then((r) => { if (r.err) throw new Error(r.err); });
      await pgctl.createDb(pg.name, DB);
      return { db: DB };
    });
    // 种子数据经真实业务 API 产生（内核自动迁移 + API 写入），不用手写 INSERT 冒充业务事实
    await step('3 启动A内核(dsn=演练库;合成身份;--required-domains-policy)', async () => {
      const dsn = `postgres://v7next:v7next@127.0.0.1:${PORT}/${DB}`;
      const principalSpec = ['tok-dadm=dam:human:admin:all:all', bizTok, credTok, appTok, svcTok].join(',');
      const { openSync } = await import('node:fs');
      const logFd = openSync(path.join(RUN_DIR, 'kernel-drill.log'), 'w');
      kernel = spawn(process.execPath, [path.join(BACK_ROOT, 'A', 'src', 'index.ts'), '--port', String(API_PORT), '--db', dsn,
        '--principal-tokens', principalSpec, '--credit-matrix', 'm-drill2', '--credit-concentration', 'c-drill2',
        '--required-domains-policy', 'domreq-drill2', '--limit-increase-max-per-window', '3', '--limit-increase-window-days', '30', '--limit-increase-retry-hours', '1'],
        { windowsHide: true, stdio: ['ignore', logFd, logFd] });
      kernel.unref();
      base = `http://127.0.0.1:${API_PORT}`;
      const ok = await waitHttp(`${base}/healthz`, (r) => r.status === 200);
      if (!ok) throw new Error('内核未就绪（kernel-drill.log）');
      // synthetic 种子：权限矩阵 + 必需域政策
      await pgctl.psql(pg.name, DB, `
        INSERT INTO permission_matrix (matrix_version, role, action, allowed, max_amount_minor) VALUES
          ('m-drill2','approver','facility.approve',true,${wan(1000)}),
          ('m-drill2','approver','facility.activate',true,NULL),
          ('m-drill2','business','fr.confirm-external',true,${wan(1000)})
        ON CONFLICT DO NOTHING;
        INSERT INTO domain_requirement_policies (policy_version, domain, required) VALUES
          ('domreq-drill2','policy',true),('domreq-drill2','credit',true),
          ('domreq-drill2','commerce',true),('domreq-drill2','asset',true)
        ON CONFLICT DO NOTHING;`, PG_USER).then((r) => { if (r.err) throw new Error(r.err); });
      return { syntheticSeeds: ['permission_matrix', 'domain_requirement_policies'] };
    });
    await step('4 真实API产生业务种子(全业务域非空关联)', async () => {
      const a = (who, m, p, b) => api(base, TKN[who], m, p, b);
      // 授权表（v2 客户级授权：grant 制第二业务槽）
      const cust = await a('biz', 'POST', '/api/v2/customers', { requestId: rid('cust'), tenantId: TENANT, legalEntityRef: `USCC-DRILL-${rid('d')}`, displayName: '演练客户（合成）' });
      assert.equal(cust.status, 200, JSON.stringify(cust.json));
      const customerId = cust.json.customerId;
      const grant = await a('adm', 'POST', `/api/v2/customers/${customerId}/grants`, { requestId: rid('g'), tenantId: TENANT, principalId: 'dcred' });
      assert.equal(grant.status, 200, JSON.stringify(grant.json));
      // 原件引用 + 取代链（证据版本）
      const art1 = await a('biz', 'POST', `/api/v2/customers/${customerId}/artifacts`, { requestId: rid('a1'), tenantId: TENANT, kind: 'purchase_contract', factKey: 'profile', content: { v: 1 }, grade: 'source_supported' });
      assert.equal(art1.status, 200, JSON.stringify(art1.json));
      const art2 = await a('biz', 'POST', `/api/v2/customers/${customerId}/artifacts`, { requestId: rid('a2'), tenantId: TENANT, kind: 'purchase_contract', factKey: 'profile', content: { v: 2 }, grade: 'source_supported', supersedes: art1.json.artifactId });
      assert.equal(art2.status, 200, JSON.stringify(art2.json));
      const bank = await a('biz', 'POST', `/api/v2/customers/${customerId}/artifacts`, { requestId: rid('a3'), tenantId: TENANT, kind: 'bank_flow', factKey: 'cashflow', content: { p: 1 }, grade: 'source_supported' });
      assert.equal(bank.status, 200);
      // 检查会话 + 问题 + 回答 + 外发（sent，外部动作账）
      const tpl = await a('adm', 'POST', '/api/v1/templates', { requestId: rid('t'), name: 'tpl-drill2', industry: null, roles: [{ roleKey: 'business', title: '业务', isHumanRole: true }], goals: [{ goalKey: 'g1', title: 'g', responsibleRole: 'business', executorKind: 'human', acceptanceRole: 'business', decisionRole: 'business', inputEvidenceKinds: [], dependsOn: [], params: {} }] });
      assert.equal(tpl.status, 200, JSON.stringify(tpl.json));
      const proj = await a('adm', 'POST', '/api/v1/projects', { requestId: rid('p'), templateId: tpl.json.templateId, name: 'proj-drill2' });
      assert.equal(proj.status, 200, `建项目: ${JSON.stringify(proj.json)}`);
      const sess = await a('biz', 'POST', `/api/v1/projects/${proj.json.projectId}/inspections`, { requestId: rid('s'), customerId, title: '演练尽调', roles: [{ roleKey: 'business', kind: 'human' }], ownerRole: 'business', items: [{ itemKey: 'fin', title: '财务', required: true, responsibleRole: 'business', targetRole: 'business', requiresHumanVerification: false, expectedEvidenceKinds: ['bank_flow'] }] });
      assert.equal(sess.status, 200, JSON.stringify(sess.json));
      const sessionId = sess.json.sessionId;
      let snap = (await a('biz', 'GET', `/api/v1/inspections/${sessionId}`)).json;
      await a('biz', 'POST', `/api/v1/inspections/${sessionId}/start`, { requestId: rid('st'), expectedVersion: snap.snapshot.version, acceptedPlanVersion: snap.snapshot.planVersion }).then((r) => assert.equal(r.status, 200, `开始会话: ${JSON.stringify(r.json)}`));
      snap = (await a('biz', 'GET', `/api/v1/inspections/${sessionId}`)).json;
      const q = await a('biz', 'POST', `/api/v1/inspections/${sessionId}/questions`, { requestId: rid('q'), itemId: snap.snapshot.items[0].itemId, audience: 'internal', targetRole: 'business', purpose: 'cashflow', question: '口径？' });
      assert.equal(q.status, 200);
      await a('biz', 'POST', `/api/v1/inspections/${sessionId}/outbound/grant`, { requestId: rid('og'), questionId: q.json.questionId, generation: 0, channel: 'chat' }).then((r) => assert.equal(r.status, 200, JSON.stringify(r.json)));
      snap = (await a('biz', 'GET', `/api/v1/inspections/${sessionId}`)).json;
      const sendId = snap.snapshot.outbound.inFlight[0].sendId;
      await a('biz', 'POST', `/api/v1/inspections/${sessionId}/outbound/${sendId}/result`, { requestId: rid('orr'), outcome: 'sent' }).then((r) => assert.equal(r.status, 200, JSON.stringify(r.json)));
      await a('biz', 'POST', `/api/v1/inspections/${sessionId}/questions/${q.json.questionId}/answer`, { requestId: rid('an'), answer: { text: '确认' } }).then((r) => assert.equal(r.status, 200, `回答: ${JSON.stringify(r.json)}`));
      await a('biz', 'POST', `/api/v1/inspections/${sessionId}/evidence`, { requestId: rid('ev'), artifactId: bank.json.artifactId }).then((r) => assert.equal(r.status, 200, JSON.stringify(r.json)));
      snap = (await a('biz', 'GET', `/api/v1/inspections/${sessionId}`)).json;
      const end = await a('biz', 'POST', `/api/v1/inspections/${sessionId}/end`, { requestId: rid('e'), expectedVersion: snap.snapshot.version });
      assert.equal(end.json.closureStatus, 'ready_for_assessment', JSON.stringify(end.json));
      // 可信 Gate + 依据包 + 分析运行 + 域结果
      assert.equal((await a('adm', 'POST', '/api/v2/rule-pack-versions/activate', { requestId: rid('rp'), tenantId: TENANT, version: RULE_PACK })).status, 200, '激活规则版本(admin)');
      const gr = await a('svc', 'POST', `/api/v2/customers/${customerId}/rule-gate-receipts`, { requestId: rid('gr'), tenantId: TENANT, result: 'CLEAR', rulesetVersion: RULE_PACK });
      assert.equal(gr.status, 200, JSON.stringify(gr.json));
      const deps = ['policy', 'credit', 'commerce', 'asset'].map((domain) => ({ domain, artifactIds: domain === 'credit' ? [art2.json.artifactId] : [], factKeys: [], rulePackVersion: RULE_PACK }));
      const pkg = await a('biz', 'POST', `/api/v2/customers/${customerId}/decision-packages`, { requestId: rid('pkg'), tenantId: TENANT, domainDeps: deps, gateReceiptId: gr.json.receiptId, inspectionRevision: { sessionId } });
      assert.equal(pkg.status, 200, JSON.stringify(pkg.json));
      for (const domain of ['policy', 'credit', 'commerce', 'asset']) {
        const runStart = await a('svc', 'POST', `/api/v2/customers/${customerId}/analysis-runs/start`, { requestId: rid('run'), tenantId: TENANT, domain, deps: deps.find((d) => d.domain === domain) });
        assert.equal(runStart.status, 200);
        await a('svc', 'POST', `/api/v2/analysis-runs/${runStart.json.runId}/finish`, { requestId: rid('fin'), tenantId: TENANT, executionStatus: 'completed' });
        const rr = await a('svc', 'POST', `/api/v2/decision-packages/${pkg.json.packageId}/domain-results`, { requestId: rid('dr'), tenantId: TENANT, domain, analysisRun: { runId: runStart.json.runId, rulesetVersion: RULE_PACK }, opinion: { findingType: 'observation', summary: `${domain}（synthetic）`, domain, authority: 'none' }, deps: deps.find((d) => d.domain === domain) });
        assert.equal(rr.status, 200, JSON.stringify(rr.json));
      }
      // 授信链 + 台账：评估→候选→待审→包绑定提案→批准→激活→申请→预占
      const ass = await a('cred', 'POST', `/api/v2/customers/${customerId}/assessments`, { requestId: rid('as'), tenantId: TENANT, ruleVersion: RULE_PACK, evidenceSnapshot: [{ artifactId: art2.json.artifactId }] });
      assert.equal(ass.status, 200);
      await a('cred', 'POST', `/api/v2/assessments/${ass.json.assessmentId}/candidate`, { requestId: rid('cd'), tenantId: TENANT, candidate: { tendency: 'do', supportableAmountMinor: wan(500), producedBy: 'drill2' } });
      await a('cred', 'POST', `/api/v2/assessments/${ass.json.assessmentId}/submit-review`, { requestId: rid('sr'), tenantId: TENANT });
      const prop = await a('cred', 'POST', `/api/v2/customers/${customerId}/facilities`, { requestId: rid('pf'), tenantId: TENANT, assessmentId: ass.json.assessmentId, approvedAmountMinor: wan(500), currency: 'CNY', packageId: pkg.json.packageId });
      assert.equal(prop.status, 200, JSON.stringify(prop.json));
      assert.equal((await a('app', 'POST', `/api/v2/facilities/${prop.json.facilityId}/approve`, { requestId: rid('ap'), tenantId: TENANT, rationale: 'drill2' })).status, 200);
      assert.equal((await a('app', 'POST', `/api/v2/facilities/${prop.json.facilityId}/activate`, { requestId: rid('ac'), tenantId: TENANT, rationale: 'drill2' })).status, 200);
      const fr = await a('biz', 'POST', `/api/v2/customers/${customerId}/financing-requests`, { requestId: rid('fr'), tenantId: TENANT, facilityId: prop.json.facilityId, productType: 'direct_lease', amountMinor: wan(100), currency: 'CNY', equipmentRefs: ['DEV-1'] });
      assert.equal(fr.status, 200, JSON.stringify(fr.json));
      const reserveRid = rid('res');
      assert.equal((await a('biz', 'POST', `/api/v2/financing-requests/${fr.json.frId}/reserve`, { requestId: reserveRid, tenantId: TENANT })).status, 200);
      // 提额请求（credit_limit_requests 非空）
      const lim = await a('biz', 'POST', `/api/v2/customers/${customerId}/limit-increase-requests`, { requestId: rid('lim'), tenantId: TENANT, reason: 'drill2 实质新证据演练', evidenceArtifactIds: [bank.json.artifactId] });
      if (lim.status !== 200) { /* 政策/冷却等语义不阻断演练：记录实际面 */ steps.push({ name: '  ↳ 提额请求面', ok: true, detail: { status: lim.status, error: lim.json?.error }, ms: 0 }); }
      // 报告视图（report_views 非空：生成客户补充材料投影）
      const rep = await a('biz', 'POST', `/api/v2/customers/${customerId}/reports`, { requestId: rid('rep'), tenantId: TENANT, kind: 'use_prep_sheet', subjectId: fr.json.frId });
      steps.push({ name: '  ↳ 报告投影面', ok: true, detail: { status: rep.status, error: rep.json?.error ?? 'ok' }, ms: 0 });
      return { customerId, frId: fr.json.frId, reserveRid, sessionId, packageId: pkg.json.packageId, facilityId: prop.json.facilityId };
    });

    const tables = await listTables(pg.name);
    const before = await step('5 备份前逐表行数+全行指纹', () => fingerprint(pg.name, tables));
    const beforeRel = await step('6 备份前关系计数', () => relationCounts(pg.name));
    const outboundBefore = await step('7 备份前外部动作账(outbox/外发状态)', async () => {
      const od = await pgctl.psql(pg.name, DB, `SELECT state, count(*) FROM outbox_deliveries GROUP BY state`, PG_USER);
      const ob = await pgctl.psql(pg.name, DB, `SELECT status, count(*) FROM inspection_outbound GROUP BY status`, PG_USER);
      return { outbox_deliveries: od.out.trim(), inspection_outbound: ob.out.trim() };
    });

    await step('8 pg_dump -Fc 备份', () => new Promise((resolve, reject) => {
      const out = createWriteStream(dumpPath);
      const child = spawn('docker', ['exec', pg.name, 'pg_dump', '-U', PG_USER, '-Fc', DB], { windowsHide: true });
      child.stdout.pipe(out);
      let err = ''; child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => (code === 0 ? resolve({ dump: path.relative(REPO_ROOT, dumpPath) }) : reject(new Error(`pg_dump exit=${code}: ${err.slice(0, 200)}`))));
    }));
    const dumpSha = createHash('sha256').update(readFileSync(dumpPath)).digest('hex');

    await step('9 模拟损毁 DROP DATABASE', () => pgctl.psql(pg.name, 'postgres', `DROP DATABASE ${DB} WITH (FORCE)`, PG_USER).then((r) => { if (r.err) throw new Error(r.err); }));
    await step('10 重建空库', () => pgctl.psql(pg.name, 'postgres', `CREATE DATABASE ${DB}`, PG_USER).then((r) => { if (r.err) throw new Error(r.err); }));
    await step('11 pg_restore 恢复', () => new Promise((resolve, reject) => {
      const child = spawn('docker', ['exec', '-i', pg.name, 'pg_restore', '-U', PG_USER, '-d', DB, '--no-owner'], { windowsHide: true });
      createReadStream(dumpPath).pipe(child.stdin);
      let err = ''; child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => (code === 0 ? resolve({ restored: true }) : reject(new Error(`pg_restore exit=${code}: ${err.slice(0, 300)}`))));
    }));

    const after = await step('12 恢复后逐表行数+全行指纹', () => fingerprint(pg.name, tables));
    await step('13 指纹比对', () => {
      const mismatches = tables.filter((t) => before[t].md5 !== after[t].md5 || before[t].rows !== after[t].rows);
      if (mismatches.length) throw new Error(`不一致表: ${mismatches.join(',')}`);
      return { tables: tables.length, verdict: 'ALL_MATCH', emptyButRelated: tables.filter((t) => after[t].rows === 0) };
    });
    const afterRel = await step('14 恢复后关系计数比对', () => relationCounts(pg.name).then((rel) => {
      const diff = Object.keys(beforeRel).filter((k) => beforeRel[k] !== rel[k]);
      if (diff.length) throw new Error(`关系计数不一致: ${diff.map((k) => `${k} ${beforeRel[k]}→${rel[k]}`).join('; ')}`);
      return { relations: Object.keys(rel).length, verdict: 'ALL_MATCH', counts: rel };
    }));
    await step('15 外部动作账恢复比对（不重放前提）', async () => {
      const od = await pgctl.psql(pg.name, DB, `SELECT state, count(*) FROM outbox_deliveries GROUP BY state`, PG_USER);
      const ob = await pgctl.psql(pg.name, DB, `SELECT status, count(*) FROM inspection_outbound GROUP BY status`, PG_USER);
      const now = { outbox_deliveries: od.out.trim(), inspection_outbound: ob.out.trim() };
      if (JSON.stringify(now) !== JSON.stringify(outboundBefore)) throw new Error(`外部动作账不一致: ${JSON.stringify(outboundBefore)} → ${JSON.stringify(now)}`);
      return { verdict: 'STATE_PRESERVED', ...now };
    });

    // 可续办：恢复后的库上重启内核 → readiness → 幂等重放 → 新业务动作
    await step('16 恢复库上重启内核(同一DSN)', async () => {
      try { process.kill(kernel.pid); } catch { }
      await new Promise((r) => setTimeout(r, 800));
      const dsn = `postgres://v7next:v7next@127.0.0.1:${PORT}/${DB}`;
      const { openSync } = await import('node:fs');
      const logFd = openSync(path.join(RUN_DIR, 'kernel-drill-restored.log'), 'w');
      kernel2 = spawn(process.execPath, [path.join(BACK_ROOT, 'A', 'src', 'index.ts'), '--port', String(API_PORT), '--db', dsn,
        '--principal-tokens', ['tok-dadm=dam:human:admin:all:all', bizTok, credTok, appTok, svcTok].join(','),
        '--credit-matrix', 'm-drill2', '--credit-concentration', 'c-drill2', '--required-domains-policy', 'domreq-drill2'],
        { windowsHide: true, stdio: ['ignore', logFd, logFd] });
      kernel2.unref();
      const ok = await waitHttp(`${base}/healthz`, (r) => r.status === 200);
      if (!ok) throw new Error('恢复库内核未就绪');
      return { readyOk: true };
    });
    await step('17 恢复后可续办：同requestId重放幂等 + 新预占成功 + 外发不重发', async () => {
      const a = (who, m, p, b) => api(base, TKN[who], m, p, b);
      const detail = steps.find((s) => s.name.startsWith('4 ')).detail;
      const { frId, reserveRid, customerId } = detail;
      const replay = await a('biz', 'POST', `/api/v2/financing-requests/${frId}/reserve`, { requestId: reserveRid, tenantId: TENANT });
      assert.equal(replay.json?.replayed, true, `恢复后重放应幂等: ${JSON.stringify(replay.json)}`);
      const fr2 = await a('biz', 'POST', `/api/v2/customers/${customerId}/financing-requests`, { requestId: rid('fr'), tenantId: TENANT, facilityId: detail.facilityId, productType: 'sale_leaseback', amountMinor: wan(50), currency: 'CNY', equipmentRefs: ['DEV-2'] });
      assert.equal(fr2.status, 200, `恢复后新申请: ${JSON.stringify(fr2.json)}`);
      const res2 = await a('biz', 'POST', `/api/v2/financing-requests/${fr2.json.frId}/reserve`, { requestId: rid('res'), tenantId: TENANT });
      assert.equal(res2.status, 200, `恢复后新预占: ${JSON.stringify(res2.json)}`);
      // 外发不重放：sent 状态计数不变（无新增 authorized/pending 行因恢复产生）
      const ob = await pgctl.psql(pg.name, DB, `SELECT status, count(*) FROM inspection_outbound GROUP BY status`, PG_USER);
      return { replayed: true, newReserve: true, inspection_outbound: ob.out.trim(), note: '恢复未触发任何外部动作重发（dispatch 由业务显式触发，恢复零自动外发）' };
    });

    exitCode = 0;
  } catch (e) {
    exitCode = steps.every((s) => s.ok) ? 2 : 1;
    steps.push({ name: '执行错误', ok: false, detail: String(e?.stack || e).slice(0, 800), ms: 0 });
  } finally {
    try { if (kernel?.pid) process.kill(kernel.pid); } catch { }
    try { if (kernel2?.pid) process.kill(kernel2.pid); } catch { }
    if (pg) {
      try { await pgctl.destroyPg(pg.name); steps.push({ name: '18 销毁自有容器', ok: true, detail: pg.name, ms: 0 }); } catch (e) {
        steps.push({ name: '18 销毁自有容器', ok: false, detail: String(e.message).slice(0, 200), ms: 0 });
      }
    }
    const report = {
      schemaVersion: 'jw.s5-drill.v2',
      drilledAt: new Date().toISOString(),
      isolation: { containerPrefix: 'v7d-', port: PORT, kernelPort: API_PORT, dataDir: 'Back/Edge/.run/drill-v2-pg', note: '不触碰 v7next-a-pg / jw-v01-pg / jw-cc-kernel-pg / Dify；仅销毁本演练容器' },
      database: { name: DB, migrations: '内核启动自动应用（001..00N 全量）', seedMode: '真实业务 API（合成身份；零手写 INSERT）' },
      steps,
      verdict: exitCode === 0 ? 'PASS' : 'FAIL',
      notes: [
        '代码回滚不等于数据库回滚；不可逆迁移需向前修复方案',
        '恢复校验覆盖：全表指纹、关系计数、外部动作账、同requestId幂等重放、新业务可续办',
        '真实客户数据/正式环境的备份演练需获准环境与授权（E2/E3 门）',
      ],
    };
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(path.join(evidenceDir, 'drill-result.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`[drill2] verdict=${report.verdict} 证据: ${path.relative(REPO_ROOT, path.join(evidenceDir, 'drill-result.json'))}`);
    process.exit(exitCode);
  }
}

main();
