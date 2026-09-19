// goal-02（缺陷判据回归）· DEF-G04N-01 / DEF-G04N-03 定向判据（04 路 DEFECTS.md R4 关闭项的常绿护栏）。
// - N1（原 DEF-G04N-01）：register_results 全部 A 操作 requestId 纪律——严格按 A v2kit 契约校验
//   （string 1..128，缺失/超长/非 string = 400 INVALID_INPUT，任务必失败不得掩绿）；每个操作
//   requestId 确定性；解析产物以 parse_extraction 派生件真实到达 A；重入零新写（幂等不换 ID）；
//   冲突 findings 走最长形态仍 ≤128。
//   IR-03-8①② 扩展（2026-09-19 续轮，判据随契约演进、纪律不变）：新增 G3 处理状态上报操作
//   （`a<attempt>-prc-<stage>`）；run/fin/gate/dres 追加收口作用域后缀 `-<finId>`——同输入重放同 ID
//   幂等、人工事实变更产生新收口=新 ID（合法新 A 写，不覆写历史回执）。
// - N2（原 DEF-G04N-03）：XLSX 是整体解析格式不是容器——unzip 段跳过（xlsx_whole_file）、零 OOXML
//   派生子件、零垃圾声明事实、解析=bank_statement_xlsx 且解析产物登记 A；真 ZIP 容器命运分离仍在。
// - N3（IR-03-8③）：intake 判重收敛客户级（跨客户同字节不得 skipped_duplicate；同客户同字节仍判重）+
//   绑定幂等回执（既有绑定后新邀请 accepted，可上传）。
// - N4（IR-03-8⑤）：客户映射种子经 a.customerLinks 透传（原被 start-connectors 丢弃）——
//   未配 processing.aCustomerLinks 时 a.customerLinks 生效，落 a_customer_links 表（权威）后全链到达 A。
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { pgAvailable } from './helpers.mjs';
import { resolveProcessingConfig } from '../src/compose.mjs';
import {
  TENANT, makeProcessingHarness, setupInvitation, uploadBytes, driveToEnd, makeZip, declTxtBytes, bankCsvBytes,
} from './processing-helpers.mjs';

const ok = await pgAvailable();
if (!ok) {
  console.log('# SKIP: PG 127.0.0.1:15443 不可达（blocked_env，不计 PASS）');
  process.exit(0);
}

const CUST = 'cust-proc-1';
const PORT = 48290;

// ---------- 严格 A（与 A v2kit 同契约：requestId 必须是 1..128 长度的 string） ----------

const REQID_RE = /^ptx-ptk-[0-9a-f]{16}-(mat|der|a[0-9]+-prc-(received|parsed|analyzed|needs_review|failed)|run-(policy|credit|commerce|asset)-[0-9a-f]{16}|fin-(policy|credit|commerce|asset)-[0-9a-f]{16}|gate-[0-9a-f]{16}|dres-(policy|credit|commerce|asset)-[0-9a-f]{16}|fnd-cfl_[0-9a-f]{20})$/;

/** 严格假 A：每个写请求校验 requestId+tenantId（违规=400 INVALID_INPUT，与真 A 同码同文案）；记录全部调用。 */
function strictAFetch() {
  const calls = [];
  let n = 0;
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : {};
    if (method === 'GET' && u.includes('/api/v2/receipts/')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, found: false }) };
    }
    if (method !== 'POST') return { ok: true, status: 200, json: async () => ({ ok: true }) };
    const rid = body.requestId;
    calls.push({ url: u, requestId: typeof rid === 'string' ? rid : null, body, rejected: false, artifactId: null });
    if (typeof rid !== 'string' || rid.length < 1 || rid.length > 128) {
      calls[calls.length - 1].rejected = true;
      return { ok: false, status: 400, json: async () => ({ ok: false, error: 'INVALID_INPUT', message: 'requestId 必须是 1..128 长度的 string' }) };
    }
    n += 1;
    if (u.endsWith('/artifacts')) {
      const artifactId = `aart-${n}`;
      calls[calls.length - 1].artifactId = artifactId;
      return { ok: true, status: 200, json: async () => ({ ok: true, artifactId, duplicateOf: null }) };
    }
    if (u.endsWith('/analysis-runs/start')) return { ok: true, status: 200, json: async () => ({ ok: true, runId: `run-${n}`, inputDigest: `dig-${n}` }) };
    if (/\/analysis-runs\/[^/]+\/finish$/.test(u)) return { ok: true, status: 200, json: async () => ({ ok: true, runId: body.runId ?? `run-${n}`, status: 'completed' }) };
    if (u.endsWith('/rule-gate-receipts')) return { ok: true, status: 200, json: async () => ({ ok: true, receiptId: `gr-${n}`, result: body.result, rulesetVersion: body.rulesetVersion }) };
    if (u.endsWith('/findings')) return { ok: true, status: 200, json: async () => ({ ok: true, findingId: `fnd-${n}` }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, resultId: `dres-${n}` }) };
  };
  return { fetchImpl, calls };
}

const A_CFG = {
  tenantId: TENANT,
  credentials: { service: 'tok-svc', registrar: 'tok-reg', reviewer: 'tok-reg', uploadFallback: 'tok-upl' },
};

async function taskDetail(h, taskId) {
  return (await fetch(`http://127.0.0.1:${PORT}/api/connectors/processing/tasks/${taskId}?tid=${TENANT}`, {
    headers: { 'x-service-token': 'proc_service_token' },
  }).then((r) => r.json())).task;
}

const writesOf = (calls) => calls.filter((c) => c.requestId !== null || c.rejected);

test('N1(DEF-G04N-01) register_results requestId 纪律：严格 A 契约下全链 done；解析产物到达 A；重入零新写；冲突 findings 同纪律', async () => {
  const a = strictAFetch();
  const h = await makeProcessingHarness({
    port: PORT,
    aBaseUrl: 'http://127.0.0.1:48081',
    aFetchImpl: a.fetchImpl,
    aConfig: A_CFG,
    processing: { aCustomerLinks: { [CUST]: { aCustomerId: 'cus-a-1' } } },
  });
  try {
    // ① 普通流水上传：mat→der→run×4(start/finish)→gate 全部经确定性 requestId 到 A
    const inv = await setupInvitation(h.api);
    const csv = Buffer.from('交易日期,收入,支出,余额,摘要\n2026-01-05,1000,0,1000,货款\n2026-01-20,2000,0,3000,货款', 'utf8');
    const up = await uploadBytes(h.api, inv, { bytes: csv });
    await driveToEnd(h.api, { maxRounds: 16 });
    const st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    const task = st.tasks.find((x) => x.task_id === up.processing.taskId);
    assert.equal(task.status, 'done', `严格 A 契约（requestId 缺失/超长=400）下任务必须 done，实际 ${task.status}/${task.failure_code ?? ''}`);

    const writes = writesOf(a.calls);
    assert.ok(writes.length >= 11, `材料+派生件+4域start/finish+Gate 至少 11 次写：${writes.length}`);
    for (const c of writes) {
      assert.equal(c.rejected, false, `零 requestId 违规（缺失/超长/非 string）：${c.url}`);
      assert.match(c.requestId, REQID_RE, `requestId 非确定性纪律形态：${c.requestId} @ ${c.url}`);
      assert.ok(c.requestId.length <= 128, 'requestId ≤128（超长纪律）');
    }
    // 判据核心：解析产物以 parse_extraction 派生件到达 A（缺陷本体=解析结果永不到达 A）
    const mat = writes.find((c) => c.requestId.endsWith('-mat'));
    const der = writes.find((c) => c.requestId.endsWith('-der'));
    assert.ok(mat && der, '材料与派生解析件均登记 A');
    assert.equal(der.body.kind, 'parse_extraction', '解析产物 kind=parse_extraction');
    const matARef = mat.artifactId; // 严格 A 发号随调用记录，不受 G3 上报调用交错影响
    assert.equal(der.body.provenance?.derivedFrom?.[0], matARef, '派生件 provenance 指向材料件 A 工件');
    assert.ok(Array.isArray(der.body.content?.declaredFactSummaries) && der.body.content.declaredFactSummaries.length >= 2, '解析事实摘要随件到达 A');
    // G3 处理状态上报到达 A（IR-03-8①）：received→parsed→analyzed，service 身份，runRef=任务+尝试
    const prc = writes.filter((c) => c.requestId.includes('-prc-'));
    for (const stage of ['received', 'parsed', 'analyzed']) {
      const hit = prc.find((c) => c.requestId.endsWith(`-prc-${stage}`));
      assert.ok(hit, `G3 上报 ${stage} 到达 A`);
      assert.equal(hit.body.stages?.[0]?.stage, stage);
      assert.match(hit.body.stages?.[0]?.runRef ?? '', /:a[0-9]+$/, 'runRef=<taskId>:a<attempt>（新尝试可重开）');
    }
    // 四域 start/finish + Gate 全部到达（requestId 带收口作用域后缀 <finId>：同输入幂等、新收口新 ID）
    const finRow = (await h.store.query(
      `SELECT fin_id FROM analysis_finalizations WHERE tenant_id=$1 AND customer_id=$2 ORDER BY created_at DESC LIMIT 1`,
      [TENANT, CUST],
    )).rows[0];
    assert.ok(finRow, '存在四域收口');
    const finTag = String(finRow.fin_id).replace(/^fin-/, '');
    for (const d of ['policy', 'credit', 'commerce', 'asset']) {
      assert.ok(writes.some((c) => c.requestId === `ptx-${task.task_id}-run-${d}-${finTag}`), `域 ${d} 运行 start 到 A`);
      assert.ok(writes.some((c) => c.requestId === `ptx-${task.task_id}-fin-${d}-${finTag}`), `域 ${d} 运行 finish 到 A`);
    }
    assert.ok(writes.some((c) => c.requestId === `ptx-${task.task_id}-gate-${finTag}`), 'Gate 回执到 A');

    // ② 重入零新写：a_links 全 registered，幂等不换 ID 不重发
    const before = writes.length;
    await driveToEnd(h.api, { maxRounds: 4 });
    assert.equal(writesOf(a.calls).length, before, '重入零新写（确定性 requestId 幂等）');

    // ③ 冲突 findings：最长 requestId 形态（ptx-<taskId>-fnd-cfl_<20hex>）仍守纪律
    const conflictZip = makeZip([
      { name: 'a.txt', data: declTxtBytes({ monthly_operating_cash_flow: '46000' }) },
      { name: 'b.txt', data: declTxtBytes({ monthly_operating_cash_flow: '99000' }) },
    ]);
    await uploadBytes(h.api, inv, { kind: 'document', bytes: conflictZip });
    await driveToEnd(h.api, { maxRounds: 16 });
    await driveToEnd(h.api, { maxRounds: 8 });
    const all = writesOf(a.calls);
    const fnds = all.filter((c) => c.requestId.includes('-fnd-'));
    assert.ok(fnds.length >= 1, `事实冲突登记 A 复核队列：${fnds.length}`);
    for (const c of fnds) {
      assert.match(c.requestId, REQID_RE);
      assert.ok(c.requestId.length <= 128, `findings 最长 requestId ≤128：len=${c.requestId.length}`);
    }
  } finally { await h.dispose(); }
});

// ---------- XLSX 构造（与 goal02-parsing 同法：真实 ZIP+sharedStrings+deflate） ----------

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) { c = c ^ buf[i]; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
  return (c ^ 0xffffffff) >>> 0;
}
function makeZipEx(entries) {
  const locals = []; const centrals = []; let offset = 0;
  for (const { name, data, deflate } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const body = deflate ? deflateRawSync(data) : data;
    const method = deflate ? 8 : 0;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(0, 6);
    central.writeUInt16LE(0, 8); central.writeUInt16LE(method, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cdStart = offset;
  const cdSize = centrals.reduce((a, b) => a + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}
function xmlEscape(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function makeXlsx(rows) {
  const shared = [];
  const colL = ['A', 'B', 'C', 'D', 'E', 'F'];
  const sheetRows = rows.map((r, i) => r.map((cell, j) => {
    if (cell == null || cell === '') return '';
    const ref = `${colL[j]}${i + 1}`;
    if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`;
    let idx = shared.indexOf(cell);
    if (idx < 0) { idx = shared.length; shared.push(cell); }
    return `<c r="${ref}" t="s"><v>${idx}</v></c>`;
  }).join('')).map((cells, i) => `<row r="${i + 1}">${cells}</row>`).join('');
  const sharedXml = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}">${shared.map((s) => `<si><t>${xmlEscape(s)}</t></si>`).join('')}</sst>`;
  const sheetXml = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
  const contentTypes = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;
  const workbook = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Sheet1" sheetId="1"/></sheets></workbook>`;
  return makeZipEx([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8') },
    { name: 'xl/sharedStrings.xml', data: Buffer.from(sharedXml, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml, 'utf8'), deflate: true },
  ]);
}

test('N2(DEF-G04N-03) XLSX 整体解析不当容器：unzip 跳过零派生子件零垃圾事实，解析产物登记 A；真 ZIP 命运分离', async () => {
  const a = strictAFetch();
  const h = await makeProcessingHarness({
    port: PORT,
    aBaseUrl: 'http://127.0.0.1:48081',
    aFetchImpl: a.fetchImpl,
    aConfig: A_CFG,
    processing: { aCustomerLinks: { [CUST]: { aCustomerId: 'cus-a-1' } } },
  });
  try {
    const inv = await setupInvitation(h.api);
    // ① XLSX 账表（银行流水表，Excel 序列日期）——缺陷本体：曾被魔数识别解出 5 个 OOXML 部件
    const up = await uploadBytes(h.api, inv, { bytes: makeXlsx([
      ['交易日期', '收入', '支出', '余额', '摘要'],
      [46023, 0, 12000.5, 88000, '购料'],
      [46051, 36000, 0, 124000.5, '货款'],
    ]), currency: 'CNY' });
    await driveToEnd(h.api, { maxRounds: 16 });
    const st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    const task = st.tasks.find((x) => x.task_id === up.processing.taskId);
    assert.equal(task.status, 'done', `XLSX 全链完成，实际 ${task.status}/${task.failure_code ?? ''}`);
    const detail = await taskDetail(h, task.task_id);
    const unzip = detail.stages.find((s) => s.stage === 'unzip');
    assert.equal(unzip.status, 'skipped', 'unzip 段跳过（XLSX 不是容器）');
    assert.equal(unzip.detail.reason, 'xlsx_whole_file', '跳过原因=xlsx_whole_file');
    assert.ok(!Array.isArray(unzip.detail.children), '零派生子件（不再解出 OOXML 部件）');
    const parse = detail.stages.find((s) => s.stage === 'parse');
    assert.equal(parse.status, 'done');
    assert.equal(parse.detail.format, 'bank_statement_xlsx', 'XLSX 专用适配器结构化解析');
    assert.equal(parse.detail.aggregates.inflowTotal, 36000);
    // 零垃圾声明事实：谓词不得是 XML 部件名/`<?xml version` 形态
    const factRows = (await h.store.query(
      `SELECT predicate FROM fact_assertions WHERE tenant_id=$1 AND customer_id=$2 AND from_artifacts ? $3`,
      [TENANT, CUST, up.evidenceId],
    )).rows;
    for (const f of factRows) {
      assert.equal(/xml|rels|Content_Types|worksheet/i.test(f.predicate), false, `谓词须是业务事实键，非 XML 垃圾：${f.predicate}`);
      assert.equal(f.predicate, String(f.predicate).trim(), '谓词无尾随/前导空白（P3 normalize）');
    }
    assert.ok(factRows.length >= 2, `流水聚合事实入库：${factRows.map((f) => f.predicate).join(',')}`);
    // XLSX 解析产物以 parse_extraction 登记 A（原缺陷=永不到达 A）
    const derLink = (await h.store.query(`SELECT status FROM a_links WHERE request_id=$1`, [`ptx-${task.task_id}-der`])).rows[0];
    assert.ok(derLink, 'XLSX 解析派生件登记 A（a_links 有 der 操作）');
    assert.equal(derLink.status, 'registered');
    const derived = (await h.store.query(
      `SELECT count(*)::int n FROM evidence_artifacts WHERE tenant_id=$1 AND derived_from=$2`,
      [TENANT, up.evidenceId],
    )).rows[0].n;
    assert.equal(derived, 0, '本侧零 OOXML 派生件');

    // ② 命运分离对照：真 ZIP 容器仍然安全解包派生（XLSX 跳过不是一刀切禁解包）
    const upZip = await uploadBytes(h.api, inv, { kind: 'document', bytes: makeZip([
      { name: 'a.txt', data: declTxtBytes({ equipment_model: 'LX-105' }) },
    ]) });
    await driveToEnd(h.api, { maxRounds: 16 });
    const st2 = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    const zipTask = st2.tasks.find((x) => x.task_id === upZip.processing.taskId);
    assert.equal(zipTask.status, 'done', '容器任务完成');
    const zipDetail = await taskDetail(h, zipTask.task_id);
    const zipUnzip = zipDetail.stages.find((s) => s.stage === 'unzip');
    assert.equal(zipUnzip.status, 'done', '真 ZIP 仍解包');
    assert.ok(zipUnzip.detail.dispatched >= 1, `真 ZIP 派生 entry 照常派发：${zipUnzip.detail.dispatched}`);
    void a;
  } finally { await h.dispose(); }
});

// ---------- IR-03-8③：intake 判重客户级 + 绑定幂等回执 ----------

test('N3(IR-03-8③) 判重收敛客户级：跨客户同字节各自处理；同客户同字节仍判重。既有绑定后新邀请 accepted（幂等回执，可上传）', async () => {
  const h = await makeProcessingHarness({ port: PORT });
  try {
    // ① 跨客户同字节：A/B 两客户各自上传同字节 CSV——都不得误判 skipped_duplicate（原缺陷=租户级判重）
    const invA = await setupInvitation(h.api, { customerId: 'cust-A' });
    const invB = await setupInvitation(h.api, { customerId: 'cust-B' });
    const csv = bankCsvBytes();
    const upA1 = await uploadBytes(h.api, invA, { bytes: csv, customerId: 'cust-A' });
    const upB1 = await uploadBytes(h.api, invB, { bytes: csv, customerId: 'cust-B' });
    await driveToEnd(h.api, { maxRounds: 16 });
    const st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=cust-A`, null, { method: 'GET' });
    const stB = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=cust-B`, null, { method: 'GET' });
    const tA1 = st.tasks.find((x) => x.task_id === upA1.processing.taskId);
    const tB1 = stB.tasks.find((x) => x.task_id === upB1.processing.taskId);
    assert.equal(tA1.status, 'done', `客户A 首件全链完成：${tA1.status}/${tA1.failure_code ?? ''}`);
    assert.equal(tB1.status, 'done', `客户B 同字节件照常全链处理（不判 duplicate）：${tB1.status}/${tB1.failure_code ?? ''}`);
    const dupA = (await h.store.query(`SELECT duplicate_of FROM evidence_artifacts WHERE tenant_id=$1 AND evidence_id=$2`, [TENANT, upA1.evidenceId])).rows[0];
    const dupB = (await h.store.query(`SELECT duplicate_of FROM evidence_artifacts WHERE tenant_id=$1 AND evidence_id=$2`, [TENANT, upB1.evidenceId])).rows[0];
    assert.equal(dupA.duplicate_of, null, '客户A 工件无 duplicate 标注');
    assert.equal(dupB.duplicate_of, null, '客户B 工件无 duplicate 标注（跨客户不判重）');
    // 同客户第三次同字节 → 仍判重（客户级判重语义保留）
    const upA2 = await uploadBytes(h.api, invA, { bytes: csv, customerId: 'cust-A' });
    await driveToEnd(h.api, { maxRounds: 8 });
    const stA2 = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=cust-A`, null, { method: 'GET' });
    const tA2 = stA2.tasks.find((x) => x.task_id === upA2.processing.taskId);
    assert.equal(tA2.status, 'skipped_duplicate', '同客户同字节同元数据=重复（判重收敛不取消判重）');

    // ② 绑定幂等回执：既有绑定（同一联系人↔同客户）后新邀请接受 → accepted（原缺陷=幂等空转恒 pending）
    const invA3 = await h.api('/api/connectors/intake/invitations', {
      tenantId: TENANT, customerId: 'cust-A', role: 'customer_finance', allowedEvidenceKinds: ['statement', 'document'], objectRefs: [], ttlSec: 3600, createdBy: 'op-1',
    });
    const acc3 = await h.api('/api/connectors/intake/accept', {
      tenantId: TENANT, token: invA3.token, provider: 'wecom_kf', providerUserId: `wx-${invA.invitationId}`,
    });
    assert.equal(acc3.existed, true, '命中既有绑定');
    assert.equal(acc3.invitationAccepted, true, '新邀请显式幂等回执 accepted（不空转）');
    const invRow = (await h.store.query(
      `SELECT status, accepted_binding_id FROM intake_invitations WHERE tenant_id=$1 AND invitation_id=$2`,
      [TENANT, invA3.invitationId],
    )).rows[0];
    assert.equal(invRow.status, 'accepted', '邀请状态推进 accepted');
    assert.equal(invRow.accepted_binding_id, acc3.bindingId, '挂接既有绑定（不新建）');
    // 接受即可用：新邀请的上传范围检查通过（原缺陷卡在"状态 pending 不允许上传"）
    const upA3 = await uploadBytes(h.api, invA3, { bytes: declTxtBytes({ note_from_new_invite: 'ok' }), kind: 'document', customerId: 'cust-A' });
    assert.ok(upA3.evidenceId || upA3.processing?.taskId, '新邀请上传范围检查通过');
    await driveToEnd(h.api, { maxRounds: 8 });
  } finally { await h.dispose(); }
});

// ---------- IR-03-8⑤：客户映射种子透传（a.customerLinks → a_customer_links 表为权威） ----------

test('N4(IR-03-8⑤) 种子透传：resolveProcessingConfig 优先级 + a.customerLinks 种子落表后全链到达 A', async () => {
  // 纯函数：优先级裁决（显式 processing.aCustomerLinks > a.customerLinks > 空）
  assert.deepEqual(
    resolveProcessingConfig({ a: { customerLinks: { c1: { aCustomerId: 'a-1' } } } }),
    { aCustomerLinks: { c1: { aCustomerId: 'a-1' } } },
    'a.customerLinks 兼容透传',
  );
  assert.deepEqual(
    resolveProcessingConfig({ processing: { aCustomerLinks: { c2: { aCustomerId: 'a-2' } } }, a: { customerLinks: { c1: { aCustomerId: 'a-1' } } } }),
    { aCustomerLinks: { c2: { aCustomerId: 'a-2' } } },
    '显式 processing.aCustomerLinks 优先',
  );
  assert.deepEqual(resolveProcessingConfig({ processing: {} }), {}, '无种子=空对象（不产 undefined 键）');

  // 运行时：不配 processing.aCustomerLinks，只配 a.customerLinks（03 路部署形态）→ 全链到达 A
  const a = strictAFetch();
  const h = await makeProcessingHarness({
    port: PORT,
    aBaseUrl: 'http://127.0.0.1:48081',
    aFetchImpl: a.fetchImpl,
    aConfig: { tenantId: TENANT, credentials: A_CFG.credentials, customerLinks: { [CUST]: { aCustomerId: 'cus-a-n4' } } },
    processing: {},
  });
  try {
    const inv = await setupInvitation(h.api);
    const up = await uploadBytes(h.api, inv, { bytes: bankCsvBytes() });
    await driveToEnd(h.api, { maxRounds: 16 });
    const st = await h.api(`/api/connectors/processing/status?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' });
    const task = st.tasks.find((x) => x.task_id === up.processing.taskId);
    assert.equal(task.status, 'done', `种子经 a.customerLinks 生效、全链 done：${task.status}/${task.failure_code ?? ''}`);
    const link = (await h.store.query(
      `SELECT a_customer_id, linked_by FROM a_customer_links WHERE tenant_id=$1 AND customer_id=$2`,
      [TENANT, CUST],
    )).rows[0];
    assert.equal(link?.a_customer_id, 'cus-a-n4', '种子落 a_customer_links（表为权威）');
    assert.equal(link?.linked_by, 'config_seed');
    const mat = (await h.store.query(`SELECT status, a_ref FROM a_links WHERE request_id=$1`, [`ptx-${task.task_id}-mat`])).rows[0];
    assert.equal(mat?.status, 'registered', '材料经映射登记 A');
    assert.ok(mat?.a_ref, 'A 工件引用取回');
  } finally { await h.dispose(); }
});
