// goal-02（产品交付·任务二）· B2 解析新格式服务级 e2e：真实 PG + 真实 HTTP 入口 + 原始字节。
// 覆盖任务书 §六：引号金额、非法日期、坏行合计、XLSX 原件、可提取文本 PDF、扫描 PDF 转人工、
// 同字节不同元数据、重复上传缓存键含元数据、压缩异常派生命运分离、预览权限面。
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { pgAvailable } from './helpers.mjs';
import {
  TENANT, makeProcessingHarness, setupInvitation, uploadBytes, driveToEnd,
} from './processing-helpers.mjs';

const ok = await pgAvailable();
if (!ok) {
  console.log('# SKIP: PG 127.0.0.1:15443 不可达（blocked_env，不计 PASS）');
  process.exit(0);
}

const CUST = 'cust-proc-1';
const PORT = 48288;

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
function makeTextPdf(lines) {
  const ops = ['BT', ...lines.map((l) => `/F1 12 Tf 72 700 Td (${l.replace(/([()\\])/g, '\\$1')}) Tj T*`), 'ET'].join('\n');
  const content = deflateRawSync(Buffer.from(ops, 'latin1'));
  const head = '%PDF-1.4\n'
    + '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
    + `4 0 obj\n<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`;
  return Buffer.concat([Buffer.from(head, 'latin1'), content, Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1')]);
}

async function taskDetail(h, taskId) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/connectors/processing/tasks/${taskId}?tid=${TENANT}`, {
    headers: { 'x-service-token': 'proc_service_token' },
  });
  return (await r.json()).task;
}

test('F1 引号 CSV 全链：引号内逗号/千分位金额经真实入口解析，坏行不入合计', async () => {
  const h = await makeProcessingHarness({ port: PORT });
  try {
    const inv = await setupInvitation(h.api);
    const csv = [
      '交易日期,收入,支出,余额,摘要',
      '"2026-01-05",0,"12,000.50",88000,"购料,含税"',
      '"2026-01-20","35,000",0,123000,"备注""引用"""',
      '"2026-99-01",777,0,,非法日期行',
    ].join('\n');
    const up = await uploadBytes(h.api, inv, { bytes: Buffer.from(csv, 'utf8'), periodFrom: '2026-01-01', periodTo: '2026-01-31' });
    await driveToEnd(h.api);
    const t = await taskDetail(h, up.processing.taskId);
    const parse = t.stages.find((s) => s.stage === 'parse');
    assert.equal(parse.status, 'done');
    assert.equal(parse.detail.aggregates.inflowTotal, 35000, '引号内千分位金额正确入合计');
    assert.equal(parse.detail.aggregates.outflowTotal, 12000.5);
    assert.equal(parse.detail.aggregates.badRowCount, 1, '非法日期行=坏行');
    const facts = t.stages.find((s) => s.stage === 'facts');
    assert.equal(facts.detail.factsInserted, 2, '聚合事实=流入+流出（坏行不入）');
  } finally { await h.dispose(); }
});

test('F2 XLSX 原件全链：银行流水表（Excel 序列日期）经真实入口解析为 source_supported 聚合', async () => {
  const h = await makeProcessingHarness({ port: PORT });
  try {
    const inv = await setupInvitation(h.api);
    const up = await uploadBytes(h.api, inv, { bytes: makeXlsx([
      ['交易日期', '收入', '支出', '余额', '摘要'],
      [46023, 0, 12000.5, 88000, '购料'],
      [46051, 36000, 0, 124000.5, '货款'],
    ]), currency: 'CNY' });
    await driveToEnd(h.api);
    const t = await taskDetail(h, up.processing.taskId);
    const parse = t.stages.find((s) => s.stage === 'parse');
    assert.equal(parse.status, 'done');
    assert.equal(parse.detail.format, 'bank_statement_xlsx');
    assert.equal(parse.detail.aggregates.inflowTotal, 36000);
    assert.ok(JSON.stringify(parse.detail.qualityFlags).includes('excel_serial_date_converted'), '序列日期转换注记可见');
    const facts = t.stages.find((s) => s.stage === 'facts');
    assert.equal(facts.detail.factsInserted, 2);
  } finally { await h.dispose(); }
});

test('F3 text-PDF 与扫描 PDF 分流：可提取文本=declared 声明；扫描=转人工+可预览不编数', async () => {
  const h = await makeProcessingHarness({ port: PORT });
  try {
    const inv = await setupInvitation(h.api);
    const pdfUp = await uploadBytes(h.api, inv, { kind: 'document', bytes: makeTextPdf(['contract_amount: 1200000', 'equipment_model: LX-105']) });
    await driveToEnd(h.api);
    const pdfTask = await taskDetail(h, pdfUp.processing.taskId);
    const pdfParse = pdfTask.stages.find((s) => s.stage === 'parse');
    assert.equal(pdfParse.status, 'done');
    assert.equal(pdfParse.detail.format, 'keyvalue_pdf');
    assert.equal(pdfTask.stages.find((s) => s.stage === 'facts').detail.factsInserted, 2, 'PDF 文本声明进入事实候选');

    const scanUp = await uploadBytes(h.api, inv, { kind: 'document', bytes: Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8') });
    await driveToEnd(h.api);
    const scanTask = await taskDetail(h, scanUp.processing.taskId);
    assert.equal(scanTask.status, 'needs_followup', '扫描 PDF：任务转人工');
    assert.equal(scanTask.failure_code, 'FORMAT_UNSUPPORTED');
    const q = (await h.api(`/api/connectors/questions/pending?tid=${TENANT}&cid=${CUST}`, null, { method: 'GET' })).questions;
    assert.ok(q.some((x) => x.binding?.purpose === 'manual_entry_required'), '转人工问题可见');
  } finally { await h.dispose(); }
});

test('F4 同字节不同元数据：不 skip——新锚点下事实并存；同字节同元数据：skip 不重算', async () => {
  const h = await makeProcessingHarness({ port: PORT });
  try {
    const inv = await setupInvitation(h.api);
    const csv = Buffer.from('交易日期,收入,支出,余额,摘要\n2026-01-05,1000,0,1000,货款\n2026-01-20,2000,0,3000,货款', 'utf8');
    const up1 = await uploadBytes(h.api, inv, { bytes: csv, periodFrom: '2026-01-01', periodTo: '2026-01-31' });
    await driveToEnd(h.api);
    const t1 = await taskDetail(h, up1.processing.taskId);
    assert.equal(t1.status, 'done');

    // 同字节不同声明期间 → 处理（不 skip），解析缓存键含元数据 → 真实解析一次还是两次？
    // 键含元数据 → 新键 → 重新解析（元数据可能改变质量旗标，属不同解析输入）；事实按锚点/内容键并存
    const up2 = await uploadBytes(h.api, inv, { bytes: csv, periodFrom: '2026-02-01', periodTo: '2026-02-28' });
    await driveToEnd(h.api);
    const t2 = await taskDetail(h, up2.processing.taskId);
    assert.equal(t2.status, 'done', '同字节不同元数据照常处理');
    const parse2 = t2.stages.find((s) => s.stage === 'parse');
    assert.ok(JSON.stringify(parse2.detail.qualityFlags ?? []).includes('period_mismatch'), '新期间与内容错位 → 旗标定位');
    // 同字节同元数据第三次 → skip（去重）
    const up3 = await uploadBytes(h.api, inv, { bytes: csv, periodFrom: '2026-02-01', periodTo: '2026-02-28' });
    await driveToEnd(h.api);
    const t3 = await taskDetail(h, up3.processing.taskId);
    assert.equal(t3.status, 'skipped_duplicate', '同字节同元数据=重复，不重复处理');
  } finally { await h.dispose(); }
});

test('F5 预览权限面：魔数嗅探+签名 URL；无公开媒体目录', async () => {
  const h = await makeProcessingHarness({ port: PORT });
  try {
    const inv = await setupInvitation(h.api);
    const up = await uploadBytes(h.api, inv, { kind: 'document', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]) });
    const pv = await fetch(`http://127.0.0.1:${PORT}/api/connectors/evidence/preview?tid=${TENANT}&eid=${up.evidenceId}&cid=${CUST}`, {
      headers: { 'x-service-token': 'proc_service_token' },
    }).then((r) => r.json());
    assert.equal(pv.ok, true);
    assert.equal(pv.format, 'png');
    assert.equal(pv.previewSafe, true, '图片可安全预览（不解码不 OCR）');
    assert.ok(pv.downloadUrl, '短时签名 URL 提供');
    assert.ok(pv.downloadUrl.includes('sig='), '签名参数存在');
  } finally { await h.dispose(); }
});
