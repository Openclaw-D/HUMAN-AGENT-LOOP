// 任务四 D2 ·「接通第一份原始文件」旅程驱动器 v2（本路所有；组合 02 路产品模块做集成验收）。
// 真实字节链路：generate-originals 产物 → Connectors intake/upload（HTTP，base64 原件字节）→
// 持久处理（register_material 经 aBridge 登记 A → unzip → parse → facts → analyze）→
// 断言取自三处只读侧：Connectors fact_assertions（业务真值）、parse_results/evidence_artifacts（字节 sha256）、
// a_links + A listArtifacts（同一原件在 A 的登记映射与 kind/grade）。
// 边界：只用合成身份与合成签名密钥；不动 01/02/03 源码；资源用本路登记段
// （jw-g04b-pg@15452 内 journey 专用库 jw_g04j / cnext_g04j；A@17933；Connectors@17935）。
// 检查分两类：gates（发布门禁，必须全过）与 defect 复现项（对应当前 DEFECTS.md 开放缺陷，
// 修复前保持失败=回归金丝雀；修复后自动转绿）。用法：node journey-first-file.mjs [--keep]
import { spawn, execFile } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const CONNECTORS = path.join(REPO, 'Back', 'Connectors');
const A_INDEX = path.join(REPO, 'Back', 'A', 'src', 'index.ts');

const KEEP = process.argv.includes('--keep');
const portArg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt; };
const PG = { container: 'jw-g04b-pg', port: 15452, user: 'jw', password: 'jw-local-demo' };
// 默认 17933/17935 与 goal-03 路登记栈共用；合流回归等场景用 --a-port/--conn-port 错峰（04 路）
const A_PORT = portArg('--a-port', 17933), CONN_PORT = portArg('--conn-port', 17935);
const A_DB = 'jw_g04j', C_DB = 'cnext_g04j';
const TENANT = 't1';
const CUST_LOCAL = 'journey-cust';
const OBJECT_DIR = path.join(HERE, '.originals', 'journey');
const RUN_DIR = path.join(HERE, '.run', 'first-file');
const EVIDENCE = path.join(REPO, 'docs', 'product-delivery', 'goal-04', 'evidence', 'd2');

const PRINCIPALS = [
  'tok-biz1=biz1:human:business:all:t1',
  'tok-svc1=svc1:service:policy+credit+commerce+asset:all:t1',
  'tok-cown=cown:human:customer:all:t1',
  'tok-cfin=cfin:human:customer:all:t1',
  'tok-cplt=cplt:human:customer:all:t1',
  'tok-adm1=adm1:human:admin:all:all',
].join(',');

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const js = (x) => JSON.stringify(x ?? null) ?? 'null';
const results = { startedAt: new Date().toISOString(), checks: [], observations: [], artifacts: [] };
const check = (id, ok, detail, defectId = null) => { results.checks.push({ id, ok: !!ok, defectId, detail: String(detail).slice(0, 500) }); console.log(`  ${ok ? '✓' : (defectId ? '⚑' : '✗')} ${id}${ok ? '' : ' — ' + String(detail).slice(0, 240)}`); return ok; };
const observe = (id, detail) => { results.observations.push({ id, detail: String(detail).slice(0, 800) }); console.log(`  · ${id}: ${String(detail).slice(0, 200)}`); };

const dock = (sql, db = null) => new Promise((resolve) => {
  const a = ['exec', PG.container, 'psql', '-U', PG.user, ...(db ? ['-d', db] : []), '-v', 'ON_ERROR_STOP=1', '-c', sql];
  execFile('docker', a, { windowsHide: true, timeout: 30000 }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});
const waitListening = async (logFile, timeoutMs = 60000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (readFileSync(logFile, 'utf8').includes('listening http')) return true; } catch { }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

console.log('[1] 生成合成原件包');
execFile(process.execPath, [path.join(HERE, 'generate-originals.mjs'), '--out', OBJECT_DIR], { windowsHide: true }, (e) => { if (e) console.error(e.message); });
await new Promise((r) => { const t = setInterval(() => { if (existsSync(path.join(OBJECT_DIR, 'manifest.json'))) { clearInterval(t); r(); } }, 200); });
const manifest = JSON.parse(readFileSync(path.join(OBJECT_DIR, 'manifest.json'), 'utf8')).files;
results.originals = manifest;
console.log(`  ${Object.keys(manifest).length} 个原件就绪`);

console.log('[2] 准备 journey 专用库（jw-g04b-pg@15452）');
for (const db of [A_DB, C_DB]) {
  const dropped = await dock(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  if (dropped.err) throw new Error(`drop ${db}: ${dropped.stderr}`);
  const created = await dock(`CREATE DATABASE ${db}`);
  if (created.err) throw new Error(`create ${db}: ${created.stderr}`);
}
console.log(`  ${A_DB} / ${C_DB} 已重建`);

console.log('[3] 启动 A 内核 @17933');
mkdirSync(RUN_DIR, { recursive: true });
const kernelLog = openSync(path.join(RUN_DIR, 'kernel.log'), 'w');
const dsn = `postgres://${PG.user}:${PG.password}@127.0.0.1:${PG.port}/${A_DB}`;
const kernelArgs = [A_INDEX, '--port', String(A_PORT), '--db', dsn,
  '--principal-tokens', PRINCIPALS, '--credit-matrix', 'm-g04j', '--credit-concentration', 'c-g04j'];
const kernel = spawn(process.execPath, kernelArgs, { windowsHide: true, stdio: ['ignore', kernelLog, kernelLog] });
kernel.unref();
if (!await waitListening(path.join(RUN_DIR, 'kernel.log'))) throw new Error('A 内核未就绪（kernel.log）');
const kernelBase = `http://127.0.0.1:${A_PORT}`;
console.log('  A listening');

const aCall = async (token, method, p, body) => {
  const r = await fetch(`${kernelBase}${p}`, {
    method, headers: { 'content-type': 'application/json', 'x-principal-credential': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = null; try { j = await r.json(); } catch { }
  return { status: r.status, json: j };
};

console.log('[3.5] admin 一次性初始化：激活规则包版本（USER_JOURNEY J1 前置动作；无激活版本时 A fail-closed 拒绝分析运行）');
const packVersion = String(JSON.parse(readFileSync(
  path.join(REPO, 'Back', 'C', 'rules', 'four-domain-rule-pack-v1.json'), 'utf8')).version);
const act = await aCall('tok-adm1', 'POST', '/api/v2/rule-pack-versions/activate', {
  requestId: `g04j-rulepack-${Date.now().toString(36)}`, tenantId: TENANT, version: packVersion,
});
check('admin:rulepack-activated', act.status === 200 && act.json?.version === packVersion && act.json?.status === 'active',
  `激活规则包 ${packVersion}: ${js(act.json).slice(0, 180)}`);

console.log('[4] A 建客户（业务身份）+ Connectors 客户映射种子');
const cust = await aCall('tok-biz1', 'POST', '/api/v2/customers', {
  requestId: `g04j-cust-${Date.now().toString(36)}`, tenantId: TENANT,
  legalEntityRef: 'USCC-G04J-HUALIN', displayName: '合成旅程客户·华临（首件验收）',
});
if (!check('A-create-customer', cust.status === 200 && !!cust.json?.customerId, js(cust.json))) throw new Error('A 建客户失败，终止');
const aCustomerId = cust.json.customerId;
results.aCustomerId = aCustomerId;

console.log('[4.5] DEF-G04N-02 定向复测：真实邀请兑换 → cit 凭据按 material.<kind> 命名空间登记（跨路对齐）');
const inv02 = await aCall('tok-biz1', 'POST', `/api/v2/customers/${aCustomerId}/invitations`, {
  requestId: `g04n02-inv-${Date.now().toString(36)}`, tenantId: TENANT,
  role: 'customer-owner', allowedKinds: ['bank_statement'], note: 'G04N-02 namespace retest',
});
if (!check('g04n02:invitation-created', inv02.status === 200 && !!inv02.json?.invitation?.code, js(inv02.json).slice(0, 200))) throw new Error('邀请创建失败，终止');
const red02 = await fetch(`${kernelBase}/api/v2/invitations/redeem`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ requestId: `g04n02-redeem-${Date.now().toString(36)}`, code: inv02.json.invitation.code }),
});
const red02j = await red02.json().catch(() => null);
const citCred = red02j?.credential ?? null;
if (!check('g04n02:redeemed', red02.status === 200 && !!citCred && String(citCred).startsWith('cit_'), js(red02j).slice(0, 200))) throw new Error('邀请兑换失败，终止');
const artCall = async (credential, kind) => fetch(`${kernelBase}/api/v2/customers/${aCustomerId}/artifacts`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-principal-credential': credential },
  body: JSON.stringify({
    requestId: `g04n02-art-${Date.now().toString(36)}-${kind.replace(/[^a-z_]/g, '')}`, tenantId: TENANT,
    kind, content: { sha256: createHash('sha256').update(`g04n02:${kind}`).digest('hex'), bytes: 16, note: 'namespace retest' },
  }),
});
const artOk = await artCall(citCred, 'material.bank_statement');
const artOkJ = await artOk.json().catch(() => null);
check('g04n02:prefixed-granted-kind-accepted', artOk.status === 200 && !!artOkJ?.artifactId,
  `获准种类按 02 路发送的 material.<kind> 命名空间登记 → ${artOk.status} ${js(artOkJ).slice(0, 150)}`);
const artDeny = await artCall(citCred, 'material.ledger_book');
const artDenyJ = await artDeny.json().catch(() => null);
check('g04n02:prefixed-ungranted-kind-rejected', artDeny.status === 403,
  `未获准种类 material.ledger_book → ${artDeny.status} ${js(artDenyJ).slice(0, 150)}（服务端强制授予面，前缀不得成为越权通道）`);

console.log('[5] 组装 Connectors（进程内 compose + startServer）');
const { compose, FakeWecomTransport } = await import(pathToFileURL(path.join(CONNECTORS, 'src', 'compose.mjs')).href);
const { startServer } = await import(pathToFileURL(path.join(CONNECTORS, 'src', 'http', 'server.mjs')).href);
const SIGNING = 'g04j-signing-synthetic';
const svc = await compose({
  pg: { host: '127.0.0.1', port: PG.port, user: PG.user, password: PG.password, database: C_DB },
  objectRoot: path.join(RUN_DIR, 'objects'),
  signingSecret: SIGNING,
  serviceToken: 'g04j-service-token',
  wecomTransport: new FakeWecomTransport(),
  aBaseUrl: kernelBase,
  aCredential: 'tok-svc1',
  a: {
    tenantId: TENANT,
    credentials: {
      service: 'tok-svc1',
      upload: { customer_owner: 'tok-cown', customer_finance: 'tok-cfin', plant_manager: 'tok-cplt' },
      uploadFallback: 'tok-cown',
      registrar: 'tok-biz1',
    },
  },
  defaultTenantId: TENANT,
  processing: { aCustomerLinks: { [CUST_LOCAL]: { aCustomerId } }, aTimeoutMs: 8000 },
});
const server = await startServer(svc, {
  port: CONN_PORT,
  wecomConfig: { token: 'x', aesKey: 'x'.padEnd(32, 'x'), corpid: 'x', defaultTenantId: TENANT },
  trtcCallbackKey: SIGNING,
  serviceToken: 'g04j-service-token',
});
const connBase = `http://127.0.0.1:${server.port ?? CONN_PORT}`;
const conn = async (p, body, { method = 'POST', expect = null } = {}) => {
  const r = await fetch(`${connBase}${p}`, {
    method, headers: { 'content-type': 'application/json', 'x-service-token': 'g04j-service-token' },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
  let j = null; try { j = await r.json(); } catch { }
  return { status: r.status, json: j, expectHit: expect == null || r.status === expect };
};

console.log('[6] 受限邀请 → 客户接受 → 真实字节上传（一致组 + 失败样本）');
const KINDS = ['bank_statement', 'entity_register', 'ledger_book', 'purchase_contract', 'device_photo', 'site_photo', 'late_adverse', 'document_sample'];
const inv = await conn('/api/connectors/intake/invitations', {
  tenantId: TENANT, customerId: CUST_LOCAL, role: 'customer_owner',
  allowedEvidenceKinds: KINDS, objectRefs: [], ttlSec: 3600, createdBy: 'biz1-journey',
}, { expect: 200 });
check('intake-invitation', inv.expectHit && !!inv.json?.invitationId, js(inv.json).slice(0, 200));
const acc = await conn('/api/connectors/intake/accept', { tenantId: TENANT, token: inv.json.token, provider: 'wecom_kf', providerUserId: `wx-${inv.json.invitationId}` }, { expect: 200 });
check('intake-accept', acc.expectHit, js(acc.json).slice(0, 200));

const UPLOADS = [
  { file: 'A-statement-q3-plain.csv', kind: 'bank_statement', periodFrom: '2025-07-01', periodTo: '2025-09-30', caliber: '收付实现' },
  { file: 'A-statement-q3.csv', kind: 'bank_statement', periodFrom: '2025-07-01', periodTo: '2025-09-30', caliber: '收付实现', note: '引号+千分位' },
  { file: 'A-entity-register.txt', kind: 'entity_register' },
  { file: 'A-ledger-q3.xlsx', kind: 'ledger_book', periodFrom: '2025-07-01', periodTo: '2025-09-30' },
  { file: 'A-purchase-contract.pdf', kind: 'purchase_contract' },
  { file: 'A-device-plate.png', kind: 'device_photo' },
  { file: 'A-site-photo.png', kind: 'site_photo' },
  { file: 'X1-statement-bad-date.csv', kind: 'bank_statement', periodFrom: '2025-07-01', periodTo: '2025-09-30', note: '坏日期+错误TOTAL行' },
  { file: 'X2-statement-bad-row.csv', kind: 'bank_statement', note: '非数值金额行' },
  { file: 'X3-unknown-format.bin', kind: 'document_sample', note: '未知格式' },
  { file: 'X4-zip-traversal.zip', kind: 'document_sample', note: '路径穿越样本' },
  { file: 'L1-late-adverse.csv', kind: 'late_adverse', periodFrom: '2025-09-01', periodTo: '2025-09-30', note: '后到不利材料' },
];
const uploaded = [];
for (const u of UPLOADS) {
  const fp = path.join(OBJECT_DIR, u.file);
  if (!existsSync(fp)) { observe(`upload-${u.file}`, '文件缺失，跳过'); continue; }
  const up = await conn('/api/connectors/evidence/upload', {
    tenantId: TENANT, customerId: CUST_LOCAL, invitationId: inv.json.invitationId, kind: u.kind,
    contentBase64: readFileSync(fp).toString('base64'), contentType: 'application/octet-stream',
    periodFrom: u.periodFrom ?? null, periodTo: u.periodTo ?? null,
    currency: u.kind === 'bank_statement' ? 'CNY' : null, caliber: u.caliber ?? null,
  });
  const ok = up.status === 200 && up.json?.evidenceId;
  uploaded.push({ ...u, ok, evidenceId: up.json?.evidenceId ?? null, taskId: up.json?.processing?.taskId ?? null });
  check(`upload:${u.file}`, ok, js(up.json).slice(0, 220));
}

console.log('[7] tick 驱动处理至收敛');
const rounds = [];
for (let i = 0; i < 15; i++) {
  const r = await conn('/api/connectors/processing/tick', { maxTasks: 6 });
  rounds.push(r.json);
  if ((r.json?.claimed ?? 1) === 0) break;
}
const totalDone = rounds.reduce((s, r) => s + (r.claimed ?? 0), 0);
check('processing-advanced', totalDone >= 1, `tick 共认领 ${totalDone} 任务次 / ${rounds.length} 轮`);

// ---- 只读侧查询辅助（Connectors 库） ----
const factsOf = async (evidenceId) => (await svc.store.query(
  `SELECT fa.predicate, fa.object_value, fa.status FROM fact_assertions fa, jsonb_array_elements_text(fa.from_artifacts) aid
   WHERE aid = $1 ORDER BY fa.predicate`, [evidenceId])).rows;
const localArtifact = async (evidenceId) => (await svc.store.query(
  `SELECT evidence_id, kind, sha256, completeness FROM evidence_artifacts WHERE evidence_id=$1`, [evidenceId])).rows[0];
const parseResultOf = async (sha) => (await svc.store.query(
  `SELECT parse_key, format, ok, result FROM parse_results WHERE sha256=$1 ORDER BY created_at DESC LIMIT 1`, [sha])).rows[0];
const stagesOf = async (taskId) => {
  const r = await conn(`/api/connectors/processing/tasks/${taskId}?tid=${TENANT}`, null, { method: 'GET' });
  return { status: r.json?.task?.status, stages: (r.json?.task?.stages ?? []).map((s) => ({ stage: s.stage, status: s.status, code: s.detail?.code ?? null, detail: s.detail })) };
};
const num = (facts, predicate) => { const f = facts.find((x) => x.predicate === predicate); return f == null ? null : Number(f.object_value); };

console.log('[8] 逐件断言（业务真值经 fact_assertions/parse_results；人工路线不伪造事实）');
for (const u of uploaded) {
  if (!u.taskId) { observe(`detail:${u.file}`, '无处理任务'); continue; }
  const t = await stagesOf(u.taskId);
  const local = u.evidenceId ? await localArtifact(u.evidenceId) : null;
  const facts = u.evidenceId ? await factsOf(u.evidenceId) : [];
  const pr = local?.sha256 ? await parseResultOf(local.sha256) : null;
  const stage = (name) => t.stages.find((s) => s.stage === name);
  u.taskStatus = t.status;
  u.aRef = (stage('register_material')?.detail?.aRef) ?? null;
  results.artifacts.push({ file: u.file, evidenceId: u.evidenceId, taskStatus: t.status, aRef: u.aRef, sha256: local?.sha256, stages: t.stages });

  if (u.file === 'A-statement-q3-plain.csv') {
    check('plain:parse-bank-csv', stage('parse')?.status === 'done' && pr?.format === 'bank_statement_csv', `parse=${stage('parse')?.status} format=${pr?.format}`);
    check('plain:inflow-1664500', num(facts, 'bank_inflow_total') === 1664500, `inflow=${num(facts, 'bank_inflow_total')}`);
    check('plain:outflow-826900', num(facts, 'bank_outflow_total') === 826900, `outflow=${num(facts, 'bank_outflow_total')}`);
    check('plain:total-row-excluded', (pr?.result?.qualityFlags ?? []).some((f) => f.flag === 'total_rows_excluded') && pr?.result?.rows?.length === 12 && num(facts, 'bank_inflow_total') === 1664500,
      `合计行被显式剔除并留痕（total_rows_excluded 标记），12 行业务数据合计不受污染`);
    check('plain:fact-grade-candidate', (facts.find((f) => f.predicate === 'bank_inflow_total')?.status ?? '') === 'candidate', '解析聚合事实为候选级（不得冒充已核验）');
  }
  if (u.file === 'A-statement-q3.csv') {
    check('quoted:totals-correct', num(facts, 'bank_inflow_total') === 1664500 && num(facts, 'bank_outflow_total') === 826900,
      `引号+千分位：inflow=${num(facts, 'bank_inflow_total')} outflow=${num(facts, 'bank_outflow_total')}（正确解析；不得错列）`);
  }
  if (u.file === 'A-entity-register.txt') {
    check('entity:creditcode-fact', facts.some((f) => f.predicate === 'creditCode' && f.object_value === '91330100MA2G04XK71'), js(facts).slice(0, 260));
  }
  if (u.file === 'A-ledger-q3.xlsx') {
    const derived = (await svc.store.query(`SELECT evidence_id, kind FROM evidence_artifacts WHERE derived_from=$1`, [u.evidenceId])).rows;
    observe('xlsx:behavior', `任务止于 ${t.stages.map((s) => `${s.stage}:${s.status}`).join('→')}；派生子件 ${derived.length} 个`);
    // 缺陷复现项（金丝雀）：XLSX 不得进入 ZIP 容器路径、不得把 OOXML 部件解析为声明事实
    check('xlsx:no-zip-container-mishandling', derived.length === 0,
      `XLSX 被当 ZIP 解包出 ${derived.length} 个 XML 派生件并产生垃圾声明事实`, 'DEF-G04N-03');
  }
  if (u.file === 'A-purchase-contract.pdf') {
    const flat = facts.map((f) => [f.predicate.trim(), String(f.object_value)]);
    const has = (k, v) => flat.some(([p, o]) => p === k && String(o).includes(v));
    check('pdf:text-extracted-truth', has('TOTAL PRICE', '2180000.00') && has('EQUIPMENT SERIAL', 'DEV-2024-08871') && has('BUYER CREDIT CODE', '91330100MA2G04XK71'),
      `可提取文本 PDF 自动解析且与隐藏真值一致（facts=${flat.length}）`);
    check('pdf:grade-candidate', facts.every((f) => f.status === 'candidate'), 'PDF 抽取事实=候选级声明，不冒充已核验');
  }
  if (['A-device-plate.png', 'A-site-photo.png'].includes(u.file)) {
    check(`manual-route:${u.file}`, facts.length === 0 && stage('parse')?.detail?.manualEntry === true,
      `图片明确转人工入口（manualEntry=true，零伪造事实）`);
  }
  if (u.file === 'X1-statement-bad-date.csv') {
    check('x1:good-rows-kept-bad-dropped', num(facts, 'bank_inflow_total') === 621500 && num(facts, 'bank_outflow_total') === 198400 && (pr?.result?.badRows?.length ?? 0) >= 1,
      `3 个有效行保留（inflow=621500/outflow=198400），坏日期行进 badRows=${(pr?.result?.badRows ?? []).length}`);
  }
  if (u.file === 'X2-statement-bad-row.csv') {
    check('x2:nonnumeric-excluded', num(facts, 'bank_inflow_total') === 1000 && (pr?.result?.badRows?.length ?? 0) >= 1, `非数值行剔除，有效行保留（inflow=${num(facts, 'bank_inflow_total')}）`);
  }
  if (u.file === 'X3-unknown-format.bin') {
    check('x3:explicit-manual', facts.length === 0 && stage('parse')?.detail?.manualEntry === true, '未知格式明确转人工，不推断内容');
  }
  if (u.file === 'X4-zip-traversal.zip') {
    const escaped = existsSync(path.join(RUN_DIR, 'objects', 'escape.txt')) || existsSync(path.join(HERE, 'escape.txt')) || existsSync(path.join(RUN_DIR, 'escape.txt'));
    check('x4:traversal-rejected', stage('unzip')?.status === 'failed' && !escaped, `zipguard 拒绝穿越条目（unzip=${stage('unzip')?.status} code=${stage('unzip')?.code}），无 escape 落盘`);
  }
  if (u.file === 'L1-late-adverse.csv') {
    check('late-adverse:outflow-500000', num(facts, 'bank_outflow_total') === 500000, `后到不利材料解析 outflow=${num(facts, 'bank_outflow_total')}`);
    check('late-adverse:quality-flag', (pr?.result?.qualityFlags ?? []).some((f) => f.flag === 'period_mismatch'), '声明期间与内容期间不一致被标记（只定位不改写）');
  }
}

console.log('[9] A 侧可追溯性：字节 sha256 → 本地登记 → a_links → A 工件');
const list = await aCall('tok-biz1', 'GET', `/api/v2/customers/${aCustomerId}/artifacts`);
const aList = Array.isArray(list.json?.artifacts) ? list.json.artifacts : (Array.isArray(list.json) ? list.json : (list.json?.items ?? []));
let tracedN = 0, tracedOk = 0, kindOk = 0;
for (const u of uploaded) {
  if (!u.evidenceId) continue;
  const local = await localArtifact(u.evidenceId);
  const link = (await svc.store.query(
    `SELECT a_ref, status FROM a_links WHERE tenant_id=$1 AND entity_type IN ('material','supersede') AND local_id=$2 ORDER BY created_at DESC LIMIT 1`,
    [TENANT, u.evidenceId])).rows[0];
  if (!local?.sha256 || link?.status !== 'registered' || !link.a_ref) continue;
  tracedN += 1;
  if (local.sha256 === manifest[u.file]?.sha256) tracedOk += 1;
  const aArt = aList.find((a) => a.artifactId === link.a_ref);
  if (aArt && aArt.kind === `material.${u.kind}`) kindOk += 1;
  u.trace = { localSha: local.sha256, aRef: link.a_ref, aKind: aArt?.kind ?? null, aGrade: aArt?.grade ?? null };
}
check('trace:bytes-unmodified', tracedOk === tracedN && tracedN >= 1, `${tracedOk}/${tracedN} 件原件字节 sha256 与生成器 manifest 一致（受控对象存储未改动字节）`);
check('trace:a-registration', tracedN >= 1, `${tracedN}/${uploaded.length} 件经 a_links 幂等登记至 A`);
check('trace:a-kind-grade', kindOk === tracedN, `${kindOk}/${tracedN} 件 A 侧 kind=material.<种类>（客户上传 grade=unverified）`);

console.log('[10] 缺陷复现项（修复前保持失败=金丝雀）');
// DEF-G04N-01 探针只看「失败于 A 结果登记阶段」的任务；
// zipguard 等前置阶段按设计拒绝（如 X4 路径穿越样本 unzip:failed）不算本缺陷——那是 x4 门禁的通过条件。
const regFail = (await svc.store.query(
  `SELECT count(*)::int n FROM processing_stage_runs WHERE stage='register_results' AND status='failed'`)).rows[0].n;
const regFailMsg = (await svc.store.query(
  `SELECT t.last_error FROM processing_stage_runs s JOIN processing_tasks t ON t.task_id=s.task_id
   WHERE s.stage='register_results' AND s.status='failed' AND t.last_error IS NOT NULL LIMIT 1`)).rows[0]?.last_error ?? '';
check('kd:register-results-reaches-a', regFail === 0, `${regFail} 个任务失败于 A 结果登记阶段：${regFailMsg.slice(0, 160)}`, 'DEF-G04N-01');

results.finishedAt = new Date().toISOString();
results.defectProbes = results.checks.filter((c) => c.defectId).map((c) => ({ id: c.id, ok: c.ok, defectId: c.defectId }));
const gateChecks = results.checks.filter((c) => !c.defectId);
const failed = gateChecks.filter((c) => !c.ok);
mkdirSync(EVIDENCE, { recursive: true });
writeFileSync(path.join(EVIDENCE, `first-file-${Date.now()}.json`), JSON.stringify(results, null, 2));
console.log('──────────────────────────────');
console.log(`[journey-first-file] 门禁 ${gateChecks.length} 项：${gateChecks.length - failed.length} 过 / ${failed.length} 败；缺陷复现项 ${results.defectProbes.length}（${results.defectProbes.filter((d) => !d.ok).length} 仍复现）`);
if (failed.length) { console.log('失败项：'); for (const f of failed) console.log(`  ✗ ${f.id}: ${f.detail}`); }
console.log(`证据已写 ${EVIDENCE}`);

console.log('[11] 清理');
try { await svc.close(); } catch { }
try { server.close(); } catch { }
try { process.kill(kernel.pid); } catch { }
if (!KEEP) {
  await dock(`DROP DATABASE IF EXISTS ${A_DB} WITH (FORCE)`);
  await dock(`DROP DATABASE IF EXISTS ${C_DB} WITH (FORCE)`);
  rmSync(path.join(RUN_DIR, 'objects'), { recursive: true, force: true });
} else {
  console.log(`--keep：库 ${A_DB}/${C_DB} 与 ${RUN_DIR} 保留供复核`);
}
process.exit(failed.length ? 1 : 0);
