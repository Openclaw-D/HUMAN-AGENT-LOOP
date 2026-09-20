// V0.3-Z1-MATERIAL-QA · 合成材料解析缺陷复核（只读复核；不修改任何产品代码/材料）。
// 复跑（JW 根目录）：
//   node docs/v0.3/zcode/material-qa/material-qa.test.mjs
// 退出码：0=基线确认（3个已知缺陷仍复现；对照组/诚实拒绝组与冻结基线一致）
//         1=行为漂移（某缺陷不再复现=可能已修复，或对照/诚实用例行为变化；对照 REPORT 重判）
//         2=环境漂移（输入文件或解析器源码 sha256 与冻结清单不符，结果不作本版本证据）
// 设计：反例断言"修复后应满足的精确预期"，当前被解析器违反 → 捕获 AssertionError 作为复现证据；
//       对照组证明同一构造在别名/无前缀/纯Flate下今天即可解析，锁定缺陷差异面。
import fs from 'node:fs';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { parseArtifactBytes } from '../../../../Back/C/src/parse/adapters.mjs';
import { projectSemanticFacts } from '../../../../Back/C/src/parse/semantic-facts.mjs';

const ROOT = 'C:/Users/22673/Desktop/JW';
const CASE_DIR = 'docs/materials/kashgar-demo-v1/KS-TEXTILE-200';
const CUST_NAME = '喀什示例棉纺有限公司'; // GOLD_ANSWERS KS-TEXTILE-200::legal_name（同源 D02 md 第7行）

// 冻结哈希（来源：docs/v0.3/zcode/material-qa/logs/hashes-pre.txt，与 docs/v0.3/material/PARSER_PROBE.json sources/逐文件 sha256 一致）
const FROZEN = {
  'Back/C/src/parse/adapters.mjs': '1d99d8edc8917d8da4b6ff9297508d9119f84fac76d7f763a916b10e663893c0',
  'Back/C/src/parse/semantic-facts.mjs': '42d758c91cfc616c6c2f826a74890e21a74866216d50dd97e7c5936ee4b02ff6',
  [`${CASE_DIR}/originals/银行流水.csv`]: '063d70a821ba07b739ba66e09a92ddb70e45219d7cdde89467cbcf7d4535e581',
  [`${CASE_DIR}/originals/D02-主体登记资料.pdf`]: '783b07fb4aeb85be2b92c7c1eff9d3754b1bdd4212ac84be9e77bdb47698a728',
  [`${CASE_DIR}/originals/接口财务2025.csv`]: '261c19507cca4915288fd80165c4d78ba085fb1f676d2b5013b91b9af265ad04',
  [`${CASE_DIR}/经营台账.xlsx`]: '16583064d8b4589408305f70e84101f7b344c58456eb0a0b7d5c47155219be29',
};
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const readInput = (p) => fs.readFileSync(`${ROOT}/${p}`);

// ---------------- 环境漂移门：输入/源码与冻结清单一致才继续 ----------------
let envOk = true;
for (const [p, want] of Object.entries(FROZEN)) {
  const got = sha256(readInput(p));
  if (got !== want) { console.log(`[ENV-DRIFT] ${p}\n  期望 ${want}\n  实际 ${got}`); envOk = false; }
}
if (!envOk) { console.log('=> 退出码 2：输入或源码与冻结基线不符，本运行不作本版本证据。'); process.exit(2); }
console.log(`[ENV] 解析器源码与7项输入 sha256 与冻结基线一致（adapters.mjs=${FROZEN['Back/C/src/parse/adapters.mjs'].slice(0, 12)}…）`);

// ---------------- 最小合成 fixture 构造器（全部在内存中生成，不落盘） ----------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** 零依赖 store(不压缩) ZIP（含本地头+中央目录+EOCD），entries=[{name,data:Buffer}] */
function buildZip(entries) {
  const chunks = []; const central = []; let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8'); const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));
    offset += 30 + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

const CONTENT_TYPES = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>';
const workbookXml = (p) => `<?xml version="1.0"?><${p}workbook xmlns:${p ? p.slice(0, -1) : ''}="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><${p}sheets><${p}sheet name="年度报表" sheetId="1" r:id="rId1"/></${p}sheets></${p}workbook>`;

/** 微型年度报表：表头[期间,收入元]，数据['2023',55667788]。prefixed=false 为正常对照。 */
function xlsxBytes(prefixed) {
  const t = prefixed ? 'x:' : '';
  const sheet = `<?xml version="1.0" encoding="utf-8"?><${t}worksheet xmlns:${t || 'x'}="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><${t}sheetData>`
    + `<${t}row r="1"><${t}c r="A1" t="inlineStr"><${t}is><${t}t>期间</${t}t></${t}is></${t}c><${t}c r="B1" t="inlineStr"><${t}is><${t}t>收入元</${t}t></${t}is></${t}c></${t}row>`
    + `<${t}row r="2"><${t}c r="A2" t="inlineStr"><${t}is><${t}t>2023</${t}t></${t}is></${t}c><${t}c r="B2"><${t}v>55667788</${t}v></${t}c></${t}row>`
    + `</${t}sheetData></${t}worksheet>`;
  return buildZip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES) },
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml(t)) },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet) },
  ]);
}

const a85encode = (buf) => {
  let out = '';
  for (let i = 0; i < buf.length; i += 4) {
    const g = [...buf.slice(i, i + 4)];
    while (g.length < 4) g.push(0);
    let v = ((g[0] << 24) | (g[1] << 16) | (g[2] << 8) | g[3]) >>> 0;
    const five = []; for (let k = 0; k < 5; k++) { five.unshift(String.fromCharCode((v % 85) + 33)); v = Math.floor(v / 85); }
    out += g.length < 4 ? five.slice(0, g.length + 1).join('') : five.join('');
  }
  return `${out}~>`;
};

/** 单页微型 PDF：唯一内容流，/Filter 可选 ASCII85Decode 前置。marker 出现在字面串 Tj。 */
function pdfBytes({ ascii85 = false, withStream = true, encrypted = false }) {
  const content = 'BT /F1 12 Tf 20 100 Td (legal_name=测试客户甲公司) Tj ET';
  let data = Buffer.from(content, 'utf8');
  let filter = '';
  if (ascii85) { data = Buffer.from(a85encode(deflateSync(data)), 'latin1'); filter = ' /Filter [ /ASCII85Decode /FlateDecode ]'; }
  else if (withStream) { data = deflateSync(data); filter = ' /Filter /FlateDecode'; }
  const objs = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >> endobj',
    withStream ? `4 0 obj << /Length ${data.length}${filter} >>\nstream\n${data.toString('latin1')}\nendstream\nendobj` : '4 0 obj << /Length 0 >> endobj',
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    encrypted ? '9 0 obj << /Filter /Standard /V 1 /R 2 /O (x) /U (y) /P -1 >> endobj' : null,
  ].filter(Boolean);
  let pdf = '%PDF-1.4\n';
  for (const o of objs) pdf += o + '\n';
  pdf += `trailer << /Size 10 /Root 1 0 R${encrypted ? ' /Encrypt 9 0 R' : ''} >>\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

// 银行流水合成件：仅表头别名不同，其余完全一致（差异面锁定）
const bankBody = 'B001,2026-01-05,下游甲,销售回款,1000000,0,1000000\nB002,2026-02-10,下游乙,销售回款,500000,200000,1300000\n合计,,,,1500000,200000,\n';
const bankSynDefect = Buffer.from(`流水号,日期,对手方,摘要,收入元,支出元,余额元\n${bankBody}`, 'utf8');
const bankSynCtrl = Buffer.from(`流水号,日期,对手方,摘要,收入,支出,余额\n${bankBody}`, 'utf8');

/** 真件银行流水的独立预期值：不经被测解析器，直接按字节求和。 */
function independentBankTotals(rel) {
  const lines = fs.readFileSync(`${ROOT}/${rel}`, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const hdr = lines[0].split(',');
  const iD = hdr.indexOf('日期'); const iI = hdr.indexOf('收入元'); const iO = hdr.indexOf('支出元');
  let ti = 0; let to = 0; let n = 0;
  for (const l of lines.slice(1)) { const c = l.split(','); ti += Number(c[iI]); to += Number(c[iO]); n++; }
  return { rows: n, first: lines[1].split(',')[iD], last: lines[lines.length - 1].split(',')[iD], inflow: ti, outflow: to };
}

// ---------------- 用例执行器 ----------------
const results = [];
function runCase({ id, cls, expectDesc, assertFn, actualFn }) {
  let met = true; let err = null;
  try { assertFn(); } catch (e) { met = false; err = e; }
  let actual = null; let crash = null;
  try { actual = actualFn ? actualFn() : null; } catch (e) { crash = e; }
  let status;
  if (crash) status = 'ERROR';
  else if (cls === 'DEFECT') status = met ? 'FIXED（行为漂移：缺陷不再复现）' : 'REPRODUCED（缺陷复现：精确预期未达）';
  else status = met ? 'PASS' : 'DRIFT（对照/诚实行为与基线不符）';
  results.push({ id, cls, status, met, expectDesc, err: err ? err.message : null, crash: crash ? crash.message : null, actual });
  console.log(`\n[CASE] ${id} · ${cls} → ${status}`);
  console.log(`[期望] ${expectDesc}`);
  console.log(`[实际] ${crash ? `执行异常: ${crash.message}` : JSON.stringify(actual)}`);
  if (err && cls === 'DEFECT') console.log(`[断言失败原文] ${err.message}`);
}

// ======== 缺陷1：银行流水 CSV 表头别名缺「收入元/支出元/余额元」→ 整表降级 keyvalue 垃圾声明，ok=true 掩盖 ========
const bankRel = `${CASE_DIR}/originals/银行流水.csv`;
const ind = independentBankTotals(bankRel); // 预期来源：原件字节独立求和（484 数据行）
const bankMeta = { fileName: '银行流水.csv', currency: 'CNY', unit: 'yuan', subjectId: 'KS-TEXTILE-200' };

runCase({
  id: 'DEFECT-BANK-CSV-REAL', cls: 'DEFECT',
  expectDesc: `银行流水.csv（sha256 ${FROZEN[bankRel].slice(0, 12)}…）应解析为 bank_statement_csv：rowCount=${ind.rows}，inflowTotal=${ind.inflow}，outflowTotal=${ind.outflow}，periodStart=${ind.first}，periodEnd=${ind.last}，并产出 bank_inflow_total source_supported 事实。预期值来源=原件字节独立求和（不经被测解析器）。`,
  assertFn() {
    const out = parseArtifactBytes(readInput(bankRel), bankMeta);
    assert.equal(out.ok, true, `ok 应为 true，实际 ${out.ok} code=${out.code}`);
    assert.equal(out.format, 'bank_statement_csv', `format 应为 bank_statement_csv，实际 ${out.format}`);
    assert.equal(out.aggregates.rowCount, ind.rows, `流水行数应为 ${ind.rows}，实际 ${out.aggregates?.rowCount}`);
    assert.equal(out.aggregates.inflowTotal, ind.inflow, `收入合计应为 ${ind.inflow}，实际 ${out.aggregates?.inflowTotal}`);
    assert.equal(out.aggregates.outflowTotal, ind.outflow, `支出合计应为 ${ind.outflow}，实际 ${out.aggregates?.outflowTotal}`);
    assert.equal(out.aggregates.periodStart, ind.first, `期间起应为 ${ind.first}，实际 ${out.aggregates?.periodStart}`);
    assert.equal(out.aggregates.periodEnd, ind.last, `期间止应为 ${ind.last}，实际 ${out.aggregates?.periodEnd}`);
    const f = (out.declaredFacts ?? []).find((x) => x.factKey === 'bank_inflow_total');
    assert.ok(f && f.value === ind.inflow, '应产出 bank_inflow_total source_supported 事实');
  },
  actualFn() {
    const out = parseArtifactBytes(readInput(bankRel), bankMeta);
    return { ok: out.ok, format: out.format, factCount: out.declaredFacts?.length, sampleFacts: out.declaredFacts?.slice(0, 2), aggregates: out.aggregates ?? null, qualityFlags: out.qualityFlags };
  },
});

runCase({
  id: 'DEFECT-BANK-CSV-SYN', cls: 'DEFECT',
  expectDesc: '最小合成流水（表头含 收入元/支出元/余额元，2数据行+合计行）应解析为 bank_statement_csv：rowCount=2，inflowTotal=1500000，outflowTotal=200000，totalsExcluded=1。',
  assertFn() {
    const out = parseArtifactBytes(bankSynDefect, { fileName: '流水.csv', currency: 'CNY', unit: 'yuan' });
    assert.equal(out.format, 'bank_statement_csv', `format 应为 bank_statement_csv，实际 ${out.format}`);
    assert.equal(out.aggregates?.rowCount, 2, `行数应为 2，实际 ${out.aggregates?.rowCount}`);
    assert.equal(out.aggregates?.inflowTotal, 1500000, `收入合计应为 1500000，实际 ${out.aggregates?.inflowTotal}`);
    assert.equal(out.aggregates?.outflowTotal, 200000, `支出合计应为 200000，实际 ${out.aggregates?.outflowTotal}`);
    assert.equal(out.aggregates?.totalsExcluded, 1, `合计行应剔除 1 行，实际 ${out.aggregates?.totalsExcluded}`);
  },
  actualFn() {
    const out = parseArtifactBytes(bankSynDefect, { fileName: '流水.csv', currency: 'CNY', unit: 'yuan' });
    return { ok: out.ok, format: out.format, factCount: out.declaredFacts?.length, sampleFacts: out.declaredFacts?.slice(0, 2) };
  },
});

runCase({
  id: 'CONTROL-BANK-CSV-ALIAS', cls: 'CONTROL',
  expectDesc: '同一流水体仅表头改为 收入/支出/余额（现别名表覆盖）→ 今天即应 bank_statement_csv 且聚合正确（证明缺陷仅在别名差异）。',
  assertFn() {
    const out = parseArtifactBytes(bankSynCtrl, { fileName: '流水.csv', currency: 'CNY', unit: 'yuan' });
    assert.equal(out.ok, true);
    assert.equal(out.format, 'bank_statement_csv');
    assert.equal(out.aggregates.rowCount, 2);
    assert.equal(out.aggregates.inflowTotal, 1500000);
    assert.equal(out.aggregates.outflowTotal, 200000);
    assert.equal(out.aggregates.totalsExcluded, 1);
  },
  actualFn() {
    const out = parseArtifactBytes(bankSynCtrl, { fileName: '流水.csv', currency: 'CNY', unit: 'yuan' });
    return { ok: out.ok, format: out.format, aggregates: out.aggregates };
  },
});

// ======== 缺陷2：PDF 内容流 /Filter [ /ASCII85Decode /FlateDecode ] 链不被支持 → 整页文本静默丢弃（真件还混入字体流乱码冒充文本，ok=true） ========
const pdfRel = `${CASE_DIR}/originals/D02-主体登记资料.pdf`;
const pdfMeta = { fileName: 'D02-主体登记资料.pdf', currency: 'CNY', unit: 'yuan', subjectId: 'KS-TEXTILE-200' };

runCase({
  id: 'DEFECT-PDF-REAL', cls: 'DEFECT',
  expectDesc: `D02 主体PDF（sha256 ${FROZEN[pdfRel].slice(0, 12)}…）提取文本应含客户名「${CUST_NAME}」。预期来源=GOLD_ANSWERS KS-TEXTILE-200::legal_name（同源 D02-主体登记资料.md 第7行 legal_name=…；PDF 内容流解压后确有 legal_name= 行）。`,
  assertFn() {
    const out = parseArtifactBytes(readInput(pdfRel), pdfMeta);
    assert.equal(out.ok, true, `ok 应为 true，实际 ${out.ok}`);
    assert.ok((out.text ?? '').includes(CUST_NAME), `提取文本应含「${CUST_NAME}」，实际 text 长度 ${(out.text ?? '').length}`);
  },
  actualFn() {
    const out = parseArtifactBytes(readInput(pdfRel), pdfMeta);
    const mdText = fs.readFileSync(`${ROOT}/${CASE_DIR}/originals/D02-主体登记资料.md`, 'utf8');
    return { ok: out.ok, format: out.format, textLen: (out.text ?? '').length, nameInText: (out.text ?? '').includes(CUST_NAME), nameInSameOriginMd: mdText.includes(CUST_NAME) };
  },
});

runCase({
  id: 'DEFECT-PDF-SYN', cls: 'DEFECT',
  expectDesc: '最小合成 PDF（唯一内容流，/Filter [ /ASCII85Decode /FlateDecode ]，文本 legal_name=测试客户甲公司）提取文本应含「测试客户甲公司」。',
  assertFn() {
    const out = parseArtifactBytes(pdfBytes({ ascii85: true }), { fileName: 'x.pdf' });
    assert.ok((out.text ?? '').includes('测试客户甲公司'), `文本应含标记，实际 ok=${out.ok} code=${out.code ?? ''} textLen=${(out.text ?? '').length}`);
  },
  actualFn() {
    const out = parseArtifactBytes(pdfBytes({ ascii85: true }), { fileName: 'x.pdf' });
    return { ok: out.ok, code: out.code ?? null, detail: out.detail ?? null, textLen: (out.text ?? '').length, nameInText: (out.text ?? '').includes('测试客户甲公司') };
  },
});

runCase({
  id: 'CONTROL-PDF-PLAINFLATE', cls: 'CONTROL',
  expectDesc: '同一内容的纯 /Filter /FlateDecode PDF → 今天即应提取出「测试客户甲公司」（证明缺陷仅在 ASCII85 过滤链不被处理）。',
  assertFn() {
    const out = parseArtifactBytes(pdfBytes({}), { fileName: 'x.pdf' });
    assert.equal(out.ok, true);
    assert.ok((out.text ?? '').includes('测试客户甲公司'), `实际 text=${JSON.stringify((out.text ?? '').slice(0, 80))}`);
  },
  actualFn() {
    const out = parseArtifactBytes(pdfBytes({}), { fileName: 'x.pdf' });
    return { ok: out.ok, format: out.format, text: out.text };
  },
});

// ======== 缺陷3：XLSX 工作表 XML 用命名空间前缀（<x:row>/<x:sheetData>）→ 护栏子串匹配失败，合法文件被误判「结构无效」转人工 ========
const xlsRel = `${CASE_DIR}/经营台账.xlsx`;
const xlsMeta = { fileName: '经营台账.xlsx', currency: 'CNY', unit: 'yuan', subjectId: 'KS-TEXTILE-200' };

runCase({
  id: 'DEFECT-XLSX-REAL', cls: 'DEFECT',
  expectDesc: `经营台账.xlsx（sha256 ${FROZEN[xlsRel].slice(0, 12)}…，11个工作表，首个=年度报表）应 ok=true 且提取文本含首表 2023 年收入 21834032。预期来源=workbook-data.json tables[1](年度报表).rows[0]=["2023",21834032,…]。`,
  assertFn() {
    const out = parseArtifactBytes(readInput(xlsRel), xlsMeta);
    assert.equal(out.ok, true, `ok 应为 true，实际 ok=${out.ok} code=${out.code} detail=${out.detail}`);
    assert.ok((out.text ?? '').includes('21834032'), `提取文本应含 21834032，实际 textLen=${(out.text ?? '').length}`);
    assert.ok((out.text ?? '').includes('期间'), '提取文本应含首表表头「期间」');
  },
  actualFn() {
    const out = parseArtifactBytes(readInput(xlsRel), xlsMeta);
    const wb = JSON.parse(fs.readFileSync(`${ROOT}/${CASE_DIR}/workbook-data.json`, 'utf8'));
    return { ok: out.ok, code: out.code ?? null, detail: out.detail ?? null, manualEntry: out.manualEntry ?? null, goldFirstSheetRow0: wb.tables[1].rows[0].slice(0, 2) };
  },
});

runCase({
  id: 'DEFECT-XLSX-SYN', cls: 'DEFECT',
  expectDesc: '最小合成 XLSX（<x:row>/<x:sheetData> 命名空间前缀，数据 2023→55667788）应 ok=true 且提取文本含 55667788（不被误判 XLSX_INVALID）。',
  assertFn() {
    const out = parseArtifactBytes(xlsxBytes(true), { fileName: 't.xlsx' });
    assert.equal(out.ok, true, `ok 应为 true，实际 code=${out.code} detail=${out.detail}`);
    assert.ok((out.text ?? '').includes('55667788'), `文本应含 55667788，实际 format=${out.format}`);
  },
  actualFn() {
    const out = parseArtifactBytes(xlsxBytes(true), { fileName: 't.xlsx' });
    return { ok: out.ok, code: out.code ?? null, detail: out.detail ?? null, manualEntry: out.manualEntry ?? null };
  },
});

runCase({
  id: 'CONTROL-XLSX-PLAIN', cls: 'CONTROL',
  expectDesc: '同一单元格数据、无命名空间前缀的最小 XLSX → 今天即应 ok=true 且文本含 55667788（证明缺陷仅在前缀兼容）。',
  assertFn() {
    const out = parseArtifactBytes(xlsxBytes(false), { fileName: 't.xlsx' });
    assert.equal(out.ok, true);
    assert.equal(out.format, 'table_xlsx');
    assert.ok((out.text ?? '').includes('55667788'));
  },
  actualFn() {
    const out = parseArtifactBytes(xlsxBytes(false), { fileName: 't.xlsx' });
    return { ok: out.ok, format: out.format, textHead: (out.text ?? '').slice(0, 40) };
  },
});

// ======== 正常对照（真件已通路径）：接口财务 CSV × GOLD_ANSWERS 交叉 ========
runCase({
  id: 'CONTROL-KV-CSV-GOLD', cls: 'CONTROL',
  expectDesc: '接口财务2025.csv（keyvalue_csv 正常路径）语义投影 revenue_annual_declared=1848.0308 万元、total_assets_declared=1475.4932 万元。预期来源=GOLD_ANSWERS revenue_2025=18480308 元（CNY-yuan）及年度报表 2025 行资产 14754932 元（万元换算一致）。',
  assertFn() {
    const finRel = `${CASE_DIR}/originals/接口财务2025.csv`;
    const out = parseArtifactBytes(readInput(finRel), { fileName: '接口财务2025.csv', currency: 'CNY', unit: 'wan', subjectId: 'KS-TEXTILE-200' });
    assert.equal(out.ok, true);
    assert.equal(out.format, 'keyvalue_csv');
    const sem = projectSemanticFacts({ kind: 'financial_statement', parseResult: out });
    const rev = sem.facts.find((f) => f.factKey === 'revenue_annual_declared');
    const assets = sem.facts.find((f) => f.factKey === 'total_assets_declared');
    assert.ok(rev, '应产出 revenue_annual_declared');
    assert.equal(rev.value, 1848.0308, `年收入应 1848.0308 万，实际 ${rev.value}`);
    assert.equal(assets.value, 1475.4932, `总资产应 1475.4932 万，实际 ${assets.value}`);
    assert.equal(rev.unit, 'wan');
  },
  actualFn() {
    const finRel = `${CASE_DIR}/originals/接口财务2025.csv`;
    const out = parseArtifactBytes(readInput(finRel), { fileName: '接口财务2025.csv', currency: 'CNY', unit: 'wan', subjectId: 'KS-TEXTILE-200' });
    const sem = projectSemanticFacts({ kind: 'financial_statement', parseResult: out });
    return { format: out.format, semanticFacts: sem.facts.map((f) => ({ factKey: f.factKey, value: f.value, unit: f.unit })) };
  },
});

// ======== 缺件/不可读/不支持：诚实拒绝路径（这些是「不支持」，不是缺陷） ========
runCase({
  id: 'HONEST-EMPTY-BUFFER', cls: 'HONEST',
  expectDesc: '空字节 → PARSE_FAILED（空字节/非 Buffer），manualEntry=true。',
  assertFn() {
    const out = parseArtifactBytes(Buffer.alloc(0), { fileName: 'e.csv' });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'PARSE_FAILED');
    assert.equal(out.manualEntry, true);
  },
  actualFn() { return parseArtifactBytes(Buffer.alloc(0), { fileName: 'e.csv' }); },
});

runCase({
  id: 'HONEST-NONUTF8-CSV', cls: 'HONEST',
  expectDesc: '含非法 UTF-8 字节（0xFF 0xFE）的 .csv → PARSE_FAILED（UTF-8 解码失败），不编数。',
  assertFn() {
    const buf = Buffer.from([0x61, 0x2c, 0xff, 0xfe, 0x62, 0x0a]);
    const out = parseArtifactBytes(buf, { fileName: 'bad.csv' });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'PARSE_FAILED');
    assert.ok(/UTF-8|解码/.test(out.detail ?? ''));
  },
  actualFn() { return parseArtifactBytes(Buffer.from([0x61, 0x2c, 0xff, 0xfe, 0x62, 0x0a]), { fileName: 'bad.csv' }); },
});

runCase({
  id: 'HONEST-CSV-NEITHER', cls: 'HONEST',
  expectDesc: '既非流水表头也无可解析 key,value 的 CSV → PARSE_FAILED（诚实失败，不硬造事实）。',
  assertFn() {
    const out = parseArtifactBytes(Buffer.from('备注清单\n只有文字没有键值\n', 'utf8'), { fileName: 'm.csv' });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'PARSE_FAILED');
  },
  actualFn() { return parseArtifactBytes(Buffer.from('备注清单\n只有文字没有键值\n', 'utf8'), { fileName: 'm.csv' }); },
});

runCase({
  id: 'HONEST-PNG-UNSUPPORTED', cls: 'HONEST',
  expectDesc: 'PNG 图片 → FORMAT_UNSUPPORTED（不做识别，转人工录入），属「不支持」而非缺陷。',
  assertFn() {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 7)]);
    const out = parseArtifactBytes(png, { fileName: 'photo.png' });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'FORMAT_UNSUPPORTED');
    assert.equal(out.manualEntry, true);
    assert.equal(out.previewSafe, true);
  },
  actualFn() {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 7)]);
    return parseArtifactBytes(png, { fileName: 'photo.png' });
  },
});

runCase({
  id: 'HONEST-SCAN-PDF-UNSUPPORTED', cls: 'HONEST',
  expectDesc: '无可提取文本层的 PDF（无内容流）→ FORMAT_UNSUPPORTED「无可提取文本层」，不做 OCR，转人工。',
  assertFn() {
    const out = parseArtifactBytes(pdfBytes({ withStream: false }), { fileName: 'scan.pdf' });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'FORMAT_UNSUPPORTED');
    assert.equal(out.manualEntry, true);
  },
  actualFn() { return parseArtifactBytes(pdfBytes({ withStream: false }), { fileName: 'scan.pdf' }); },
});

runCase({
  id: 'HONEST-ENCRYPTED-PDF', cls: 'HONEST',
  expectDesc: '含 /Encrypt 的加密 PDF → PARSE_FAILED「PDF 已加密」，manualEntry=true。',
  assertFn() {
    const out = parseArtifactBytes(pdfBytes({ encrypted: true }), { fileName: 'enc.pdf' });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'PARSE_FAILED');
    assert.ok(/加密/.test(out.detail ?? ''));
  },
  actualFn() { return parseArtifactBytes(pdfBytes({ encrypted: true }), { fileName: 'enc.pdf' }); },
});

// ---------------- 汇总与退出码 ----------------
const repro = results.filter((r) => r.cls === 'DEFECT' && r.status.startsWith('REPRODUCED'));
const fixed = results.filter((r) => r.cls === 'DEFECT' && r.status.startsWith('FIXED'));
const err = results.filter((r) => r.status === 'ERROR');
const drift = results.filter((r) => r.cls !== 'DEFECT' && (r.status.startsWith('DRIFT') || r.status === 'ERROR'));
console.log(`\n===== 汇总：共 ${results.length} 用例｜缺陷复现 ${repro.length}/6（3类×真件+最小合成）｜对照+诚实通过 ${results.filter((r) => r.cls !== 'DEFECT' && r.status === 'PASS').length}/${results.length - 6} =====`);
for (const r of results) console.log(`  [${r.cls}] ${r.id} → ${r.status}`);
if (fixed.length || err.length || drift.length) {
  console.log('=> 退出码 1：行为漂移（缺陷可能已被修复，或对照/诚实用例行为与冻结基线不符）。请对照 REPORT.md 重新核判并更新基线。');
  process.exit(1);
}
console.log('=> 退出码 0：三个已知解析缺陷全部仍复现；对照组与缺件/不可读/不支持路径与冻结基线一致。');
process.exit(0);
