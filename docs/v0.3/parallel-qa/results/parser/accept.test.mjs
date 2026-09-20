// V0.3-Z2 解析器独立验收（任务书 docs/v0.3/parallel-qa/02_PARSER_REGRESSION.md）。
// 只读消费 Back/C/src/parse/{adapters,adapters-async}.mjs 与 docs/materials/kashgar-demo-v1 原件；
// 全部写入仅在本目录（fixtures/ 为本目录生成的最小异常样本，results.json 为实际结果）。
// 退出码：0=全部验收项通过；1=存在验收项失败（行为不符）；2=输入/源码哈希完整性破坏（结果不作本版本证据）。
// 不改生产解析器、不改原材料、不装依赖、不调用模型、不用数据库。
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { inflateRawSync, deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseArtifactBytes, parseXlsxRows } from '../../../../../Back/C/src/parse/adapters.mjs';
import { parseArtifactBytesAsync, ASYNC_PARSE_VERSION } from '../../../../../Back/C/src/parse/adapters-async.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..'); // JW 根
const MAT = path.join(ROOT, 'docs/materials/kashgar-demo-v1');
const FIX = path.join(HERE, 'fixtures');
fs.mkdirSync(FIX, { recursive: true });

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const readBuf = (p) => fs.readFileSync(p);

// ---------------------------------------------------------------- 用例登记 ---
const cases = [];
let integrityBroken = false;
async function record(id, fn) {
  const entry = { id, status: 'PASS', checks: [], detail: {} };
  const t0 = Date.now();
  try {
    const detail = await fn(entry);
    Object.assign(entry.detail, detail ?? {});
  } catch (e) {
    entry.status = 'FAIL';
    entry.error = String(e && e.message ? e.message : e);
  }
  entry.ms = Date.now() - t0;
  cases.push(entry);
  console.log(`CASE ${id} ${entry.status} (${entry.ms}ms)${entry.status === 'FAIL' ? ' :: ' + entry.error : ''}`);
  return entry;
}
/** 断言助手：不满足即抛出（逐条留痕到该用例 checks）。 */
function expect(entry, cond, label) {
  entry.checks.push({ label, pass: !!cond });
  if (!cond) throw new Error('断言失败: ' + label);
}

// ------------------------------------------------------------ 哈希冻结准备 ---
const SRC_FILES = [
  'Back/C/src/parse/adapters.mjs',
  'Back/C/src/parse/adapters-async.mjs',
  'Back/C/src/parse/pdf-worker.mjs',
  'Back/C/src/parse/semantic-facts.mjs',
  'Back/C/domains/util.mjs',
];
const INPUT_FILES = [
  'docs/materials/kashgar-demo-v1/KS-TEXTILE-200/originals/银行流水.csv',
  'docs/materials/kashgar-demo-v1/KS-TEXTILE-200/经营台账.xlsx',
  'docs/materials/kashgar-demo-v1/KS-TEXTILE-200/originals/D02-主体登记资料.pdf',
  'docs/materials/kashgar-demo-v1/KS-TEXTILE-200/originals/D02-主体登记资料.md',
  'docs/materials/kashgar-demo-v1/KS-LASER-500/originals/D02-主体登记资料.pdf',
  'docs/materials/kashgar-demo-v1/KS-LASER-500/originals/D02-主体登记资料.md',
  'docs/materials/kashgar-demo-v1/KS-INJECTION-1000/originals/D02-主体登记资料.pdf',
  'docs/materials/kashgar-demo-v1/KS-INJECTION-1000/originals/D02-主体登记资料.md',
];
const pre = {};
for (const rel of [...SRC_FILES, ...INPUT_FILES]) pre[rel] = sha256(readBuf(path.join(ROOT, rel)));

// 输入与冻结清单 SHA256SUMS.txt 核对（清单路径=相对 kashgar-demo-v1）。
const sumsTxt = fs.readFileSync(path.join(MAT, 'SHA256SUMS.txt'), 'utf8');
const sums = new Map();
for (const line of sumsTxt.split(/\r?\n/)) {
  const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
  if (m) sums.set(m[2].replace(/\\/g, '/'), m[1]);
}
const inputChecks = [];
for (const rel of INPUT_FILES) {
  const relInMat = rel.replace('docs/materials/kashgar-demo-v1/', '');
  const frozen = sums.get(relInMat);
  inputChecks.push({ file: relInMat, actual: pre[rel], frozen: frozen ?? '(清单缺失)', match: frozen ? frozen === pre[rel] : null });
  if (frozen && frozen !== pre[rel]) integrityBroken = true;
}

// ------------------------------------------- 独立对照工装（不经被测解析器） ---

/** 独立银行流水求和：首行表头按列名定位；剔除合计行；不经被测解析器。 */
function independentBank(text) {
  const t = text.replace(/^\uFEFF/, '');
  const lines = t.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = lines[0].split(',').map((h) => h.trim());
  const cDate = header.indexOf('日期');
  const cIn = header.indexOf('收入元');
  const cOut = header.indexOf('支出元');
  if (cDate < 0 || (cIn < 0 && cOut < 0)) throw new Error('独立求和：表头定位失败');
  const TOTAL_RE = /^(合计|总计|小计|累计|总合计|total|subtotal|sum)$/i;
  const data = [];
  const totalRows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (c.some((x) => TOTAL_RE.test(String(x ?? '').trim()))) { totalRows.push(i + 1); continue; }
    const din = c[cIn] ?? '';
    const dout = c[cOut] ?? '';
    if (din.trim() === '' && dout.trim() === '') continue;
    data.push({ line: i + 1, date: (c[cDate] ?? '').trim(), in: Number(din || 0), out: Number(dout || 0) });
  }
  const dates = data.map((r) => r.date).sort();
  return {
    rows: data.length,
    inflow: data.reduce((a, r) => a + r.in, 0),
    outflow: data.reduce((a, r) => a + r.out, 0),
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
    totalRows,
  };
}

/** 独立 ZIP 读取（store/deflate；中央目录），仅用于独立对照核对原材料结构。 */
function zipReadEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.slice(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    entries.set(name, { method, compSize, dataStart: localOffset + 30 + lNameLen + lExtraLen });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  const read = (name) => {
    const e = entries.get(name);
    if (!e) return null;
    const raw = buf.slice(e.dataStart, e.dataStart + e.compSize);
    return e.method === 8 ? inflateRawSync(raw) : raw;
  };
  return { names: [...entries.keys()], read };
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = buf[i] ^ (c >>> 8) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}
/** 独立构造最小 ZIP（本目录夹具/内存合成件用；与被测解析器无关）。 */
function makeZip(entries) {
  const locals = []; const centrals = []; let offset = 0;
  for (const { name, data, deflate } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const body = deflate ? deflateRawSync(data) : data;
    const method = deflate ? 8 : 0;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
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

/** 组装最小 PDF（对象数组→精确 xref；流二进制安全）。objects.trailer 为 trailer 附加串。 */
function assemblePdf(objects) {
  const parts = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offs = [];
  objects.forEach((o, i) => {
    offs[i] = Buffer.concat(parts).length;
    parts.push(Buffer.from(`${i + 1} 0 obj\n${o.dict}\n`, 'latin1'));
    if (o.stream) {
      parts.push(Buffer.from('stream\n', 'latin1'), o.stream, Buffer.from('\nendstream\nendobj\n', 'latin1'));
    } else {
      parts.push(Buffer.from('endobj\n', 'latin1'));
    }
  });
  const xrefPos = Buffer.concat(parts).length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 0; i < objects.length; i++) xref += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  parts.push(Buffer.from(xref + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${objects.trailer ?? ''}>>\nstartxref\n${xrefPos}\n%%EOF`, 'latin1'));
  return Buffer.concat(parts);
}

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
/** 前缀化（x:）最小工作簿字节。rows=行数组（inlineStr）；formulaRows=放无缓存公式的行号（1基）。 */
function makePrefixedXlsx({ rows, formulaRows = [], ns = NS_MAIN }) {
  const sheetRows = rows.map((r, i) => {
    const cells = r.map((cell, j) => {
      if (cell == null || cell === '') return '';
      const ref = `${String.fromCharCode(65 + j)}${i + 1}`;
      return `<x:c r="${ref}" t="inlineStr"><x:is><x:t>${cell}</x:t></x:is></x:c>`;
    }).join('');
    return `<x:row r="${i + 1}">${cells}</x:row>`;
  });
  for (const fr of formulaRows) {
    sheetRows[fr - 1] = `<x:row r="${fr}"><x:c r="A${fr}"><x:f>SUM(B1,B1)</x:f></x:c></x:row>`;
  }
  const sheetXml = `<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="${ns}"><x:sheetData>${sheetRows.join('')}</x:sheetData></x:worksheet>`;
  const workbook = `<?xml version="1.0" encoding="utf-8"?><x:workbook xmlns:x="${ns}"><x:sheets><x:sheet name="Sheet1" sheetId="1" /></x:sheets></x:workbook>`;
  const ct = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;
  return makeZip([
    { name: '[Content_Types].xml', data: Buffer.from(ct, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml, 'utf8'), deflate: true },
  ]);
}

// ---------------------------------------------------- RC4/加密最小 PDF 样本 ---
function rc4(key, data) {
  const S = [...Array(256).keys()];
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
    out[k] = data[k] ^ S[(S[i] + S[j]) & 0xff];
  }
  return out;
}
const PAD = Buffer.from([0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a]);
function padPassword(pw) {
  return Buffer.concat([Buffer.from(String(pw), 'latin1'), PAD]).subarray(0, 32);
}
/** PDF 标准安全处理器 R2/V1（40位）：需 userPw 才能打开的加密最小 PDF。 */
function makeEncryptedPdf(userPw, text) {
  const md5 = (b) => createHash('md5').update(b).digest();
  const P = -44;
  const O = rc4(md5(padPassword(userPw + '-owner')).subarray(0, 5), padPassword(userPw));
  const id0 = createHash('md5').update('z2-enc-fixture').digest();
  const pBuf = Buffer.alloc(4);
  pBuf.writeInt32LE(P, 0);
  const fileKey = md5(Buffer.concat([padPassword(userPw), O, pBuf, id0])).subarray(0, 5);
  const U = rc4(fileKey, PAD);
  const objKey = (n, g) => {
    const nb = Buffer.alloc(3); nb.writeUIntLE(n, 0, 3);
    const gb = Buffer.alloc(2); gb.writeUIntLE(g, 0, 2);
    return md5(Buffer.concat([fileKey, nb, gb])).subarray(0, 10);
  };
  const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  const content = Buffer.from(`BT /F1 12 Tf 20 100 Td (legal_name=${text}) Tj ET`, 'latin1');
  const encContent = rc4(objKey(6, 0), content);
  const objects = [
    { dict: '<< /Type /Catalog /Pages 2 0 R >>' },
    { dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { dict: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>' },
    { dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
    { dict: `<< /Filter /Standard /V 1 /R 2 /O <${hex(O)}> /U <${hex(U)}> /P ${P} >>` },
    { dict: `<< /Length ${encContent.length} >>`, stream: encContent },
  ];
  objects.trailer = `/Encrypt 5 0 R /ID [<${hex(id0)}> <${hex(id0)}>] `;
  return assemblePdf(objects);
}

/** 扫描样本：仅图片 XObject、无文本算子的单页 PDF（未压缩 8x8 RGB）。 */
function makeScannedPdf() {
  const img = Buffer.alloc(8 * 8 * 3, 0x7f);
  const objects = [
    { dict: '<< /Type /Catalog /Pages 2 0 R >>' },
    { dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { dict: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>' },
    { dict: '<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ' + img.length + ' >>', stream: img },
    { dict: '<< /Length 32 >>', stream: Buffer.from('q 100 0 0 100 0 0 cm /Im0 Do Q', 'latin1') },
  ];
  return assemblePdf(objects);
}

// ============================================================ 用例 0：输入完整性 ===
await record('HASH-INPUTS-FROZEN', (e) => {
  const bad = inputChecks.filter((c) => c.match === false);
  expect(e, bad.length === 0, `8 项输入与 SHA256SUMS.txt 一致（不符=${bad.map((b) => b.file).join(',')}）`);
  expect(e, sums.size > 100, `冻结清单读取完整（${sums.size} 条）`);
  return { inputChecks };
});

// ============================================================ 用例 1：纺织流水 CSV ===
const BANK_CSV = path.join(MAT, 'KS-TEXTILE-200/originals/银行流水.csv');
const bankBytes = readBuf(BANK_CSV);
const bankIndep = independentBank(bankBytes.toString('utf8'));

await record('CSV-REAL-TEXTILE', (e) => {
  expect(e, bankIndep.rows === 484, `独立求和数据行=484（实际 ${bankIndep.rows}）`);
  expect(e, bankIndep.inflow === 77343360, `独立求和入账=77343360（实际 ${bankIndep.inflow}）`);
  expect(e, bankIndep.outflow === 74065856, `独立求和出账=74065856（实际 ${bankIndep.outflow}）`);
  const r = parseArtifactBytes(bankBytes, { fileName: '银行流水.csv', currency: '元' });
  expect(e, r.ok === true, `解析 ok=true（实际 ok=${r.ok} code=${r.code ?? ''} detail=${r.detail ?? ''}）`);
  expect(e, r.format === 'bank_statement_csv', `format=bank_statement_csv（实际 ${r.format}）`);
  expect(e, r.aggregates.rowCount === 484, `rowCount=484（实际 ${r.aggregates?.rowCount}）`);
  expect(e, r.aggregates.inflowTotal === 77343360, `inflowTotal=77343360（实际 ${r.aggregates?.inflowTotal}）`);
  expect(e, r.aggregates.outflowTotal === 74065856, `outflowTotal=74065856（实际 ${r.aggregates?.outflowTotal}）`);
  expect(e, r.aggregates.periodStart === bankIndep.periodStart, `periodStart 与独立求和一致=${bankIndep.periodStart}（实际 ${r.aggregates?.periodStart}）`);
  expect(e, r.aggregates.periodEnd === bankIndep.periodEnd, `periodEnd 与独立求和一致=${bankIndep.periodEnd}（实际 ${r.aggregates?.periodEnd}）`);
  const fIn = (r.declaredFacts ?? []).find((f) => f.factKey === 'bank_inflow_total');
  const fOut = (r.declaredFacts ?? []).find((f) => f.factKey === 'bank_outflow_total');
  expect(e, !!fIn && fIn.value === 77343360 && fIn.verificationLevel === 'source_supported', `产出 bank_inflow_total=77343360 source_supported（实际 ${fIn && fIn.value}/${fIn && fIn.verificationLevel}）`);
  expect(e, !!fOut && fOut.value === 74065856 && fOut.verificationLevel === 'source_supported', `产出 bank_outflow_total=74065856 source_supported（实际 ${fOut && fOut.value}/${fOut && fOut.verificationLevel}）`);
  return { aggregates: r.aggregates, format: r.format, parserVersion: r.parserVersion, parseId: r.parseId, independent: bankIndep, factCount: (r.declaredFacts ?? []).length };
});

await record('CSV-REAL-TOTALS-HONESTY', (e) => {
  // 任务要求"确认合计行不重复计入"：真件经独立核验不含合计行——如实记录；
  // 剔除机制以最小合成件验证（下一用例）。
  expect(e, bankIndep.totalRows.length === 0, `真件无合计行（独立核验 totalRows=${JSON.stringify(bankIndep.totalRows)}）`);
  const nonEmpty = bankBytes.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '').length;
  expect(e, bankIndep.rows + 1 === nonEmpty, `真件行数=表头1+数据484（${nonEmpty} 行，无其他行）`);
  const r = parseArtifactBytes(bankBytes, { fileName: '银行流水.csv' });
  expect(e, r.aggregates?.totalsExcluded === 0, `解析器如实报 totalsExcluded=0（实际 ${r.aggregates?.totalsExcluded}）`);
  expect(e, r.aggregates?.badRowCount === 0, `无坏行 badRowCount=0（实际 ${r.aggregates?.badRowCount}）`);
  return { realFileTotalRows: bankIndep.totalRows, totalsExcluded: r.aggregates?.totalsExcluded, note: 'Z1 报告预期"合计行剔除≥1"与实物不符：真件没有合计行；剔除机制见 CSV-SYN-TOTALS-EXCLUDED' };
});

await record('CSV-SYN-TOTALS-EXCLUDED', (e) => {
  // 最小合成件：2 数据行 + 1 合计行。独立求和（剔除合计）=1500000/200000。
  const syn = '日期,收入元,支出元,余额元\n2026-01-05,1000000,200000,800000\n2026-01-06,500000,0,1300000\n合计,1500000,9999999,\n';
  const indep = independentBank(syn);
  expect(e, indep.totalRows.length === 1 && indep.rows === 2, `独立求和：合计行1被剔除、数据2行（实际 ${indep.rows}/${indep.totalRows.length}）`);
  expect(e, indep.inflow === 1500000 && indep.outflow === 200000, `独立求和剔除合计后 1500000/200000（实际 ${indep.inflow}/${indep.outflow}）`);
  const r = parseArtifactBytes(Buffer.from(syn, 'utf8'), { fileName: 'syn.csv' });
  expect(e, r.ok === true && r.format === 'bank_statement_csv', `解析为 bank_statement_csv（实际 ${r.format}）`);
  expect(e, r.aggregates.rowCount === 2, `rowCount=2（实际 ${r.aggregates?.rowCount}）`);
  expect(e, r.aggregates.inflowTotal === 1500000, `inflowTotal=1500000（实际 ${r.aggregates?.inflowTotal}；与独立求和相等=合计行未重复计入）`);
  expect(e, r.aggregates.outflowTotal === 200000, `outflowTotal=200000（实际 ${r.aggregates?.outflowTotal}；9999999 未混入）`);
  expect(e, r.aggregates.totalsExcluded === 1, `totalsExcluded=1（实际 ${r.aggregates?.totalsExcluded}）`);
  const flag = (r.qualityFlags ?? []).find((f) => f.flag === 'total_rows_excluded');
  expect(e, !!flag, `留旗标 total_rows_excluded（实际 ${JSON.stringify(r.qualityFlags ?? [])}）`);
  return { aggregates: r.aggregates, flags: r.qualityFlags };
});

// ============================================================ 用例 2：代表 XLSX ===
const LEDGER_XLSX = path.join(MAT, 'KS-TEXTILE-200/经营台账.xlsx');
const ledgerBytes = readBuf(LEDGER_XLSX);
const ledgerZip = zipReadEntries(ledgerBytes);
const readZipText = (z, name) => {
  const b = z.read(name);
  return b == null ? null : b.toString('utf8');
};
const wbXml = readZipText(ledgerZip, 'xl/workbook.xml');
const relsXml = readZipText(ledgerZip, 'xl/_rels/workbook.xml.rels') ?? '';
const sheetOrder = [...wbXml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?sheet\s[^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"[^>]*?\/>/g)].map((m) => ({ name: m[1], rid: m[2] }));
const ridToTarget = new Map([...relsXml.matchAll(/<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"[^>]*?\/>/g)].map((m) => [m[1], m[2]]));
if (ridToTarget.size === 0) {
  // 属性顺序可能是 Target 在前（artifact-tool 变体）：逐标签提取两属性，不依赖顺序。
  for (const tag of relsXml.matchAll(/<Relationship\b([^>]*?)\/>/g)) {
    const id = /\bId="([^"]+)"/.exec(tag[1])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(tag[1])?.[1];
    if (id && target) ridToTarget.set(id, target);
  }
}
const ordered = sheetOrder.map((s) => ({ name: s.name, target: ridToTarget.get(s.rid) ?? `(缺rels:${s.rid})` }));
const FIRST = ordered[0] ?? { name: null, target: null };

function sheetGrid(xml, sharedStrings) {
  // 独立读取（朴素前缀剥离，仅用于独立对照，非被测代码路径）。
  const s = xml.replace(/<(\/?)([A-Za-z_][\w.-]*):/g, '<$1');
  const out = [];
  const rowRe = /<row[^>]*?r="(\d+)"[^>]*?>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(s)) != null) {
    const rowNum = Number(rm[1]);
    const cells = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(rm[2])) != null) {
      const attrs = cm[1] ?? '';
      const inner = cm[2] ?? '';
      const refM = /\sr="([A-Z]+)(\d+)"/.exec(attrs);
      const col = refM ? refM[1].split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1 : cells.length;
      const typeM = /\st="([a-zA-Z]+)"/.exec(attrs);
      const vM = /<v>([\s\S]*?)<\/v>/.exec(inner);
      const isM = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/.exec(inner);
      let v = null;
      if (isM) v = isM[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      else if (vM) v = typeM?.[1] === 's' ? (sharedStrings[Number(vM[1])] ?? null) : vM[1];
      cells[col] = v == null ? '' : String(v);
    }
    out[rowNum - 1] = (cells ?? []).map((x) => x ?? '');
  }
  return out;
}

await record('XLSX-REAL-LEDGER', (e) => {
  const z = ledgerZip;
  expect(e, !!z, '独立解包成功');
  const sheetEntries = z.names.filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
  expect(e, ordered.length === 11 && sheetEntries.length === 11, `工作表共11个（order=${ordered.length}, files=${sheetEntries.length}）`);
  expect(e, FIRST.name === '年度报表', `工作簿顺序首表=年度报表（实际 ${FIRST.name} → ${FIRST.target}）`);
  const sharedXml = readZipText(z, 'xl/sharedStrings.xml');
  const shared = [];
  if (sharedXml) {
    const sx = sharedXml.replace(/<(\/?)x:/g, '<$1');
    for (const m of sx.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) {
      if (m[1] === undefined) { shared.push(''); continue; }
      shared.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
    }
  }
  const firstFile = 'xl/' + String(FIRST.target).replace(/^\//, '').replace(/^xl\//, '');
  const firstXml = readZipText(z, firstFile);
  expect(e, firstXml != null, `独立读取首表文件 ${firstFile}`);
  const indepLines = sheetGrid(firstXml, shared).map((r) => r.join('\t'));
  expect(e, indepLines.some((l) => l.includes('期间')), '独立核验首表含"期间"');
  expect(e, indepLines.some((l) => l.includes('21834032')), '独立核验首表含 21834032');

  const r = parseArtifactBytes(ledgerBytes, { fileName: '经营台账.xlsx' });
  expect(e, r.ok === true, `解析 ok=true（实际 ok=${r.ok} code=${r.code ?? ''} detail=${r.detail ?? ''}）`);
  expect(e, /xlsx$/.test(String(r.format)), `format=${r.format} 为 xlsx 族`);
  expect(e, r.text.includes('期间'), '提取文本含"期间"');
  expect(e, r.text.includes('21834032'), '提取文本含 21834032');
  // 首表范围：提取文本 == 首表内容（逐行一致），不泄漏其他工作表内容。
  const parserLines = r.text.split('\n');
  const same = parserLines.length === indepLines.length && parserLines.every((l, i) => l === indepLines[i]);
  expect(e, same, `提取文本与独立读取的首表逐行一致（parser ${parserLines.length} 行 vs 独立 ${indepLines.length} 行${same ? '' : '，首差=' + JSON.stringify(parserLines.find((l, i) => l !== indepLines[i]) ?? '')}）`);
  const second = ordered[1];
  const secondFile = 'xl/' + String(second.target).replace(/^\//, '').replace(/^xl\//, '');
  const secondVals = sheetGrid(readZipText(z, secondFile), shared).flat().filter((v) => v !== '');
  const leak = secondVals.find((v) => !indepLines.some((l) => l.includes(v)));
  if (leak != null) expect(e, !r.text.includes(leak), `第2表（${second.name}）独有值未泄漏到首表提取文本`);
  return { format: r.format, parserVersion: r.parserVersion, parseId: r.parseId, sheetOrder: ordered.map((o) => o.name), firstSheetFile: firstFile, textLines: parserLines.length, secondSheetUniqueToken: leak ?? '(无独有值,跳过泄漏断言)' };
});

await record('XLSX-SYN-FORMULA-NOCACHE', (e) => {
  // 公式缺缓存值 + 前缀命名空间：数值未知→整行拒绝，不编数；前缀与默认命名空间提取一致。
  const buf = makePrefixedXlsx({ rows: [['期间', '21834032']], formulaRows: [2] });
  const rows = parseXlsxRows(buf);
  expect(e, JSON.stringify(rows.rows[0]) === JSON.stringify(['期间', '21834032']), `前缀件首行提取 ${JSON.stringify(rows.rows[0])}`);
  expect(e, JSON.stringify(rows.formulaRows) === '[2]', `公式缺缓存行=第2行（实际 ${JSON.stringify(rows.formulaRows)}）`);
  expect(e, !rows.rows[1] || rows.rows[1].every((v) => v === ''), '第2行无数值被编造（空行）');
  const r = parseArtifactBytes(buf, { fileName: 'syn.xlsx' });
  expect(e, r.ok === true, `解析 ok=true（实际 ok=${r.ok} code=${r.code ?? ''} detail=${r.detail ?? ''}）`);
  const flagged = JSON.stringify(r).includes('公式缺缓存') || (r.problems ?? []).length > 0 || !!r.note;
  expect(e, flagged, `异常如实留痕（${JSON.stringify({ note: r.note, problems: r.problems })}）`);
  const plain = makePrefixedXlsx({ rows: [['期间', '21834032']] });
  const a = parseXlsxRows(buf);
  const b = parseXlsxRows(plain);
  // 同一数据（首行）两种命名空间形态提取一致（前缀件多出的第2行是公式异常行，不参与比较）。
  expect(e, JSON.stringify(a.rows.slice(0, 1)) === JSON.stringify(b.rows), '前缀件与默认命名空间件对同一数据行提取一致');
  return { formulaRows: rows.formulaRows, format: r.format, note: r.note ?? null, problems: r.problems ?? null };
});

await record('XLSX-SYN-UNTRUSTED-NS', (e) => {
  // 命名空间异常如实处理：x: 绑定到非 SpreadsheetML → 不解读为单元格，诚实失败转人工。
  const buf = makePrefixedXlsx({ rows: [['期间', '21834032']], ns: 'http://example.com/not-spreadsheetml' });
  let caught = null;
  let r = null;
  try {
    r = parseArtifactBytes(buf, { fileName: 'bad.xlsx' });
  } catch (err) {
    caught = err;
  }
  if (r) {
    expect(e, r.ok === false, `诚实失败 ok=false（实际 ok=${r.ok} format=${r.format}）`);
    expect(e, r.manualEntry === true, '转人工 manualEntry=true');
    expect(e, (r.detail ?? '').includes('XLSX') || r.code === 'PARSE_FAILED', `失败语义清晰（code=${r.code} detail=${r.detail}）`);
  } else {
    expect(e, !!caught && caught.code === 'XLSX_INVALID', `抛 XLSX_INVALID（实际 ${caught && caught.code}）`);
  }
  return { ok: r ? r.ok : false, code: r ? r.code : (caught && caught.code), detail: r ? r.detail : String(caught) };
});

// ============================================================ 用例 3：三客户主体 PDF ===
const CUSTOMERS = ['KS-TEXTILE-200', 'KS-LASER-500', 'KS-INJECTION-1000'];
const mdExpectations = {};
for (const c of CUSTOMERS) {
  const md = fs.readFileSync(path.join(MAT, c, 'originals/D02-主体登记资料.md'), 'utf8');
  const kv = {};
  for (const m of md.matchAll(/^([a-z_]+)=(.+)$/gm)) kv[m[1]] = m[2].trim();
  const prose = {};
  for (const m of md.matchAll(/^(设立日期|注册地址|登记状态)[：:](.+)$/gm)) prose[m[1]] = m[2].trim();
  mdExpectations[c] = { kv, prose };
}

const goodTextByCustomer = {};
for (const c of CUSTOMERS) {
  await record(`PDF-REAL-${c}`, async (e) => {
    const bytes = readBuf(path.join(MAT, c, 'originals/D02-主体登记资料.pdf'));
    const fileHash = sha256(bytes);
    const r = await parseArtifactBytesAsync(bytes);
    expect(e, r.ok === true, `解析 ok=true（实际 ok=${r.ok} code=${r.code ?? ''} detail=${r.detail ?? ''}）`);
    expect(e, r.format === 'keyvalue_pdf', `format=keyvalue_pdf（实际 ${r.format}）`);
    expect(e, r.parserVersion === ASYNC_PARSE_VERSION, `parserVersion=${ASYNC_PARSE_VERSION}（实际 ${r.parserVersion}）`);
    expect(e, r.artifactHash === fileHash, `artifactHash=原件SHA-256（${fileHash.slice(0, 12)}…）`);
    // 中文与原件一致（md 为同源原件）：key=value 全量 + 散文关键值。
    const exp = mdExpectations[c];
    for (const [k, v] of Object.entries(exp.kv)) {
      expect(e, r.text.includes(v), `md 字段 ${k}=${v} 出现在提取文本`);
    }
    const dateVal = /(\d{4}-\d{2}-\d{2})/.exec(exp.prose['设立日期'] ?? '')?.[1];
    if (dateVal) expect(e, r.text.includes(dateVal), `设立日期 ${dateVal} 出现在提取文本`);
    // 页码/提取位置：页号连续、locator=page、页hash=原件hash、页textHash一致、拼回=全文。
    expect(e, r.pages.length >= 1, `页数≥1（实际 ${r.pages.length}）`);
    r.pages.forEach((p, i) => {
      if (p.page !== i + 1) throw new Error(`页号不连续：pages[${i}].page=${p.page}`);
      if (!p.locator || p.locator.kind !== 'page' || p.locator.start !== i + 1 || p.locator.end !== i + 1) throw new Error(`pages[${i}].locator 异常：${JSON.stringify(p.locator)}`);
      if (p.artifactHash !== fileHash) throw new Error(`pages[${i}].artifactHash 与原件不符`);
      if (p.textHash !== sha256(Buffer.from(p.text, 'utf8'))) throw new Error(`pages[${i}].textHash 与页文本不符`);
    });
    const joined = r.pages.map((p) => p.text).join('\n');
    expect(e, joined === r.text, '逐页文本拼回=全文（提取位置可追溯）');
    const namePage = r.pages.findIndex((p) => p.text.includes(exp.kv.legal_name));
    expect(e, namePage >= 0, `legal_name 所在页定位成功（第 ${namePage + 1} 页）`);
    goodTextByCustomer[c] = r.text;
    return { ok: true, format: r.format, artifactHash: fileHash, pages: r.pages.length, legalName: exp.kv.legal_name, legalNamePage: namePage + 1, parserVersion: r.parserVersion, parseId: r.parseId, textChars: r.text.length, kvChecked: Object.keys(exp.kv) };
  });
}

// ---- 异常样本（本目录生成最小件；哈希记录在 results.json 之外另存清单） ----
const scanned = makeScannedPdf();
fs.writeFileSync(path.join(FIX, 'scanned-no-text.pdf'), scanned);
const encrypted = makeEncryptedPdf('z2-secret', '加密样本公司甲');
fs.writeFileSync(path.join(FIX, 'encrypted-userpw.pdf'), encrypted);
const realD02 = readBuf(path.join(MAT, 'KS-TEXTILE-200/originals/D02-主体登记资料.pdf'));
const corruptTrunc = realD02.subarray(0, Math.floor(realD02.length * 0.6));
fs.writeFileSync(path.join(FIX, 'corrupt-truncated-D02.pdf'), corruptTrunc);
const corruptZero = Buffer.from(realD02);
corruptZero.subarray(Math.floor(corruptZero.length / 3), Math.floor(corruptZero.length / 3) + 2048).fill(0);
fs.writeFileSync(path.join(FIX, 'corrupt-midzero-D02.pdf'), corruptZero);
fs.writeFileSync(path.join(FIX, 'fixtures.sha256.txt'),
  ['scanned-no-text.pdf', 'encrypted-userpw.pdf', 'corrupt-truncated-D02.pdf', 'corrupt-midzero-D02.pdf']
    .map((n) => `${sha256(fs.readFileSync(path.join(FIX, n)))}  ${n}`).join('\n') + '\n');

await record('PDF-ANOM-SCANNED', async (e) => {
  const r = await parseArtifactBytesAsync(scanned);
  expect(e, r.ok === false, `扫描件不产正文 ok=false（实际 ok=${r.ok}）`);
  expect(e, r.code === 'FORMAT_UNSUPPORTED', `code=FORMAT_UNSUPPORTED（实际 ${r.code}）`);
  expect(e, r.manualEntry === true, '转人工 manualEntry=true');
  expect(e, !String(r.text ?? '').trim(), '无任何伪正文');
  return { code: r.code, detail: r.detail };
});

await record('PDF-ANOM-ENCRYPTED', async (e) => {
  const r = await parseArtifactBytesAsync(encrypted);
  expect(e, r.ok === false, `加密件不产正文 ok=false（实际 ok=${r.ok} code=${r.code ?? ''} detail=${r.detail ?? ''}）`);
  expect(e, r.manualEntry === true, '转人工 manualEntry=true');
  expect(e, !String(r.text ?? '').includes('加密样本'), '解密内容未泄漏（无伪正文）');
  const r2 = parseArtifactBytes(encrypted, { fileName: 'enc.pdf' });
  expect(e, r2.ok === false && r2.manualEntry === true, `同步路径同样诚实拒绝（ok=${r2.ok} code=${r2.code}）`);
  return { asyncCode: r.code, asyncDetail: r.detail, syncCode: r2.code };
});

for (const [id, bytes] of [['TRUNC', corruptTrunc], ['MIDZERO', corruptZero]]) {
  await record(`PDF-ANOM-CORRUPT-${id}`, async (e) => {
    const r = await parseArtifactBytesAsync(bytes);
    if (r.ok === false) {
      expect(e, r.manualEntry === true, `失败即转人工 manualEntry=true（code=${r.code}）`);
      expect(e, !String(r.text ?? '').includes('喀什示例'), '无伪正文泄漏');
      return { mode: 'fail-closed', code: r.code, detail: r.detail };
    }
    // 若部分恢复：只允许恢复出原件真实文本，不得出现原件之外的内容（伪正文）。
    const good = goodTextByCustomer['KS-TEXTILE-200'] ?? '';
    const lines = String(r.text ?? '').split('\n').map((l) => l.trim()).filter((l) => l !== '');
    const fabricated = lines.filter((l) => !good.includes(l));
    expect(e, fabricated.length === 0, `部分恢复时不得产生原件之外的正文（伪行=${JSON.stringify(fabricated.slice(0, 3))}）`);
    return { mode: 'partial-real-text-only', pages: r.pages.length, textChars: r.text.length };
  });
}

// ============================================================ 汇总 ===
const post = {};
for (const rel of [...SRC_FILES, ...INPUT_FILES]) post[rel] = sha256(readBuf(path.join(ROOT, rel)));
const drift = Object.keys(post).filter((k) => post[k] !== pre[k]);
if (drift.length > 0) integrityBroken = true;

const failed = cases.filter((c) => c.status === 'FAIL');
const summary = {
  total: cases.length,
  pass: cases.filter((c) => c.status === 'PASS').length,
  fail: failed.length,
  integrityBroken,
  exitCode: integrityBroken ? 2 : failed.length > 0 ? 1 : 0,
  exitSemantics: '0=全部通过; 1=存在行为不符; 2=输入/源码哈希完整性破坏',
  sourceHashes: Object.fromEntries(SRC_FILES.map((k) => [k, pre[k]])),
  inputHashes: Object.fromEntries(INPUT_FILES.map((k) => [k, pre[k]])),
  driftFiles: drift,
};
const out = {
  meta: {
    task: 'V0.3-Z2 解析器独立验收',
    generatedAt: new Date().toISOString(),
    node: process.version,
    ASYNC_PARSE_VERSION,
    pdfEntry: 'parseArtifactBytesAsync (pdfjs-dist worker; 生产入口 Back/Connectors/src/processing/coordinator.mjs:844)',
  },
  inputChecks,
  cases,
  summary,
};
fs.writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(out, null, 2));
console.log('\nSUMMARY ' + JSON.stringify({ total: summary.total, pass: summary.pass, fail: summary.fail, exitCode: summary.exitCode }));
if (failed.length > 0) console.log('FAILED: ' + failed.map((f) => f.id).join(', '));
process.exitCode = summary.exitCode;
