// goal-02（产品交付·任务二）· B2 解析适配器 v2 单元测试（自包含，零依赖）。
// 全部用原始字节：引号 CSV、非法日期、合计行、XLSX（真实 ZIP+sharedStrings+deflate+公式缺缓存）、
// 可提取文本 PDF（真实 FlateDecode 流）、扫描 PDF（无文本层）、Excel 序列日期、严格金额。
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  parseArtifactBytes, parseDelimitedRows, parseAmountCell, normDate, excelSerialToIso,
} from '../src/parse/adapters.mjs';

// ---------- 真实 ZIP/XLSX/PDF 字节构造（store/deflate + CRC32，零依赖） ----------

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = c ^ buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** entries: [{name, data:Buffer, deflate?}] → 真实 ZIP 字节。 */
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
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8); central.writeUInt16LE(method, 10); central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24);
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

/** rows: (string|number|{__formula})[][] → 最小 XLSX（sheet1 deflate 压缩）。 */
function makeXlsx(rows) {
  const shared = [];
  const colL = ['A', 'B', 'C', 'D', 'E', 'F'];
  const sheetRows = rows.map((r, i) => r.map((cell, j) => {
    if (cell == null || cell === '') return '';
    const ref = `${colL[j]}${i + 1}`;
    if (cell && cell.__formula) return `<c r="${ref}"><f>SUM(1,2)</f></c>`;
    if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`;
    let idx = shared.indexOf(cell);
    if (idx < 0) { idx = shared.length; shared.push(cell); }
    return `<c r="${ref}" t="s"><v>${idx}</v></c>`;
  }).join('')).map((cells, i) => `<row r="${i + 1}">${cells}</row>`).join('');
  const sharedXml = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((s) => `<si><t>${xmlEscape(s)}</t></si>`).join('')}</sst>`;
  const sheetXml = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;
  const workbook = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  return makeZipEx([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8') },
    { name: 'xl/sharedStrings.xml', data: Buffer.from(sharedXml, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml, 'utf8'), deflate: true },
  ]);
}

/** 最小 text-PDF：FlateDecode 内容流 + Tj/T* 文本算子（真实可提取文本层）。 */
function makeTextPdf(lines) {
  const ops = ['BT', ...lines.map((l) => `/F1 12 Tf 72 700 Td (${l.replace(/([()\\])/g, '\\$1')}) Tj T*`), 'ET'].join('\n');
  const content = deflateRawSync(Buffer.from(ops, 'latin1'));
  const head = '%PDF-1.4\n'
    + '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
    + '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'
    + '3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n'
    + `4 0 obj\n<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`;
  return Buffer.concat([Buffer.from(head, 'latin1'), content, Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1')]);
}

test('引号感知 CSV：引号内逗号/双写引号都是内容；千分位金额正确', () => {
  const csv = [
    '交易日期,收入,支出,余额,摘要',
    '"2026-01-05",0,"12,000.50",88000,"购料,含税"',
    '"2026-01-20","35,000",0,123000,"备注""引用"""',
  ].join('\n');
  const rows = parseDelimitedRows(csv);
  assert.equal(rows.length, 3, '引号内逗号不切行');
  assert.equal(rows[1][4], '购料,含税');
  assert.equal(rows[2][4], '备注"引用"', '双写引号转义');
  const r = parseArtifactBytes(Buffer.from(csv, 'utf8'), { fileName: 'bank.csv', currency: 'CNY' });
  assert.equal(r.ok, true);
  assert.equal(r.aggregates.inflowTotal, 35000);
  assert.equal(r.aggregates.outflowTotal, 12000.5, '引号内千分位金额正确');
});

test('严格金额与日期：千分位外逗号拒绝；非法日期 badRow 不入合计；合计行剔除', () => {
  assert.equal(parseAmountCell('1,2345'), null, '非千分位分组拒绝');
  assert.equal(parseAmountCell('12,345.67'), 12345.67);
  assert.equal(parseAmountCell('(500)'), -500, '括号=负数');
  assert.equal(parseAmountCell('－30'), -30, '全角负号');
  assert.equal(parseAmountCell(''), null);
  assert.equal(normDate('2026-13-05'), null, '13 月拒绝');
  assert.equal(normDate('2026-02-30'), null, '2 月 30 日拒绝');
  assert.equal(normDate('2026-02-29'), null, '非闰年拒绝');
  assert.equal(normDate('2024-02-29'), '2024-02-29', '闰年通过');
  assert.equal(normDate('20260105'), '2026-01-05', '紧凑形态');
  assert.equal(excelSerialToIso(46023), '2026-01-01');

  const csv = [
    '交易日期,收入,支出,余额,摘要',
    '2026-01-05,1000,0,1000,货款',
    '2026-01-99,999,0,1999,非法日期行',
    '2026-01-20,2000,0,3000,货款',
    '合计,3000,0,,自动合计',
    '2026-13-01,888,0,,错月',
  ].join('\n');
  const r = parseArtifactBytes(Buffer.from(csv, 'utf8'), {});
  assert.equal(r.ok, true, '存在有效数据行：整体解析成功');
  assert.equal(r.aggregates.rowCount, 2, '坏行/合计行不入行集');
  assert.equal(r.aggregates.inflowTotal, 3000, '合计=有效行 1000+2000（合计行 3000 不重复计）');
  assert.equal(r.aggregates.badRowCount, 2);
  assert.ok(r.qualityFlags.some((f) => f.flag === 'bad_rows_present'));
  assert.ok(r.qualityFlags.some((f) => f.flag === 'total_rows_excluded'));
});

test('XLSX 原件：流水表/声明表解析；Excel 序列日期转换；公式缺缓存值整行拒绝', () => {
  const bank = parseArtifactBytes(makeXlsx([
    ['交易日期', '收入', '支出', '余额', '摘要'],
    [46023, 0, 12000.5, 88000, '购料'],
    [46051, 36000, 0, 124000.5, '货款'],
    ['2026-02-10', 41000, 0, 165000, '货款'],
  ]), { currency: 'CNY' });
  assert.equal(bank.ok, true);
  assert.equal(bank.format, 'bank_statement_xlsx');
  assert.equal(bank.aggregates.inflowTotal, 77000);
  assert.equal(bank.aggregates.outflowTotal, 12000.5);
  assert.ok(bank.qualityFlags.some((f) => f.flag === 'excel_serial_date_converted'), '序列日期转换注记');
  assert.equal(bank.rows[0].date, '2026-01-01', '46023 → 2026-01-01');

  const kv = parseArtifactBytes(makeXlsx([
    ['key', 'value'],
    ['monthly_operating_cash_flow', '46000'],
    ['monthly_debt_service', 18000],
  ]), {});
  assert.equal(kv.ok, true);
  assert.equal(kv.format, 'keyvalue_xlsx');
  assert.equal(kv.declaredFacts[0].value, 46000, '字符串数值被严格金额解析为数值');
  assert.equal(kv.declaredFacts[1].value, 18000, '数值单元格保持数值');

  const f = parseArtifactBytes(makeXlsx([
    ['交易日期', '收入', '支出', '余额', '摘要'],
    ['2026-01-05', 1000, 0, 1000, '货款'],
    ['2026-01-20', { __formula: true }, 0, 2000, '公式无缓存'],
  ]), {});
  assert.equal(f.ok, true);
  assert.equal(f.aggregates.rowCount, 1, '公式缺缓存值行整行拒绝');
  assert.equal(f.aggregates.inflowTotal, 1000, '未知公式值不猜不入合计');
});

test('可提取文本 PDF：真实 FlateDecode 流提取 key=value 声明；扫描 PDF/图片如实转人工且可预览', () => {
  const pdf = parseArtifactBytes(makeTextPdf(['contract_amount: 1200000', 'equipment_model: LX-105']), {});
  assert.equal(pdf.ok, true);
  assert.equal(pdf.format, 'keyvalue_pdf');
  const byKey = Object.fromEntries(pdf.declaredFacts.map((f) => [f.factKey, f]));
  assert.equal(byKey.contract_amount.value, 1200000, 'PDF 文本声明为 declared 级（金额形态为数值）');
  assert.ok(pdf.previewSafe);

  const scanned = parseArtifactBytes(Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'utf8'), {});
  assert.equal(scanned.ok, false);
  assert.equal(scanned.code, 'FORMAT_UNSUPPORTED');
  assert.equal(scanned.manualEntry, true, '无文本层=扫描：转人工录入，不 OCR 不编数');
  assert.equal(scanned.previewSafe, true);

  const png = parseArtifactBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), {});
  assert.equal(png.ok, false);
  assert.equal(png.previewSafe, true, '图片安全接收+可预览');
  assert.equal(png.manualEntry, true);
});

test('P3 回归：PDF 谓词 normalize——键/值无尾随或前导空白（下游按谓词精确匹配不失配）', () => {
  // 形态复刻 journey 购机合同（DEFECTS.md P3 观察出处）：冒号前带空格、行首缩进、多空白分隔
  const pdf = parseArtifactBytes(makeTextPdf([
    'TOTAL PRICE : CNY 1,234,567.00',
    '   EQUIPMENT MODEL :   LX-105  ',
    'DELIVERY DATE:2026-03-01',
  ]), {});
  assert.equal(pdf.ok, true);
  assert.equal(pdf.format, 'keyvalue_pdf');
  assert.ok(pdf.declaredFacts.length >= 3, `三条声明全部提取：${pdf.declaredFacts.length}`);
  for (const f of pdf.declaredFacts) {
    assert.equal(f.factKey, f.factKey.trim(), `谓词无前导/尾随空白：${JSON.stringify(f.factKey)}`);
    assert.equal(f.factKey.includes('<?xml'), false, '谓词不是垃圾部件名');
  }
  const byKey = Object.fromEntries(pdf.declaredFacts.map((f) => [f.factKey, f]));
  assert.equal(byKey['TOTAL PRICE'].value, 'CNY 1,234,567.00', '谓词精确匹配可用（TOTAL PRICE，无尾随空格）');
  assert.equal(byKey['EQUIPMENT MODEL'].value, 'LX-105', '值两端空白同样 normalize');
  assert.equal(byKey['DELIVERY DATE'].value, '2026-03-01');
});
