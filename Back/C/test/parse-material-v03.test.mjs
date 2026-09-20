import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { parseArtifactBytes, parseXlsxRows } from '../src/parse/adapters.mjs';
const prefixed = xml => xml.replace(/xmlns=/, 'xmlns:x=').replace(/<(\/?)([a-zA-Z][\w]*)/g, '<$1x:$2');
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
function makeXlsx(rows, prefix = false) {
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
    { name: 'xl/sharedStrings.xml', data: Buffer.from(prefix ? prefixed(sharedXml) : sharedXml, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(prefix ? prefixed(sheetXml) : sheetXml, 'utf8'), deflate: true },
  ]);
}


test('03A: original textile bank bytes yield exact rows, totals and dates', async()=>{
 const bytes=await fs.readFile(new URL('../../../Materials/kashgar-demo-v1/KS-TEXTILE-200/originals/银行流水.csv',import.meta.url));
 const r=parseArtifactBytes(bytes,{fileName:'bank.csv'});
 assert.equal(r.format,'bank_statement_csv');assert.equal(r.rows.length,484);
 assert.equal(r.aggregates.inflowTotal,77343360);assert.equal(r.aggregates.outflowTotal,74065856);
 assert.equal(r.aggregates.periodStart,'2023-01-12');assert.equal(r.aggregates.periodEnd,'2026-08-25');
 assert.equal(r.aggregates.totalsExcluded,0);assert.match(r.caliberNote,/入账不直接当经营收入/);
});
test('03A: original prefixed workbook recovers first-sheet text and numbers',async()=>{
 const bytes=await fs.readFile(new URL('../../../Materials/kashgar-demo-v1/KS-TEXTILE-200/经营台账.xlsx',import.meta.url));
 const r=parseArtifactBytes(bytes,{fileName:'book.xlsx'});
 assert.equal(r.ok,true);assert.match(r.text,/期间/);assert.match(r.text,/21834032/);
});
test('03A: prefixed and default namespaces preserve identical rows and formula rejection',()=>{
 const rows=[['日期','收入元','支出元'],['2026-01-01',10,2],['2026-01-02',{__formula:true},1]];
 assert.deepEqual(parseXlsxRows(makeXlsx(rows,true)),parseXlsxRows(makeXlsx(rows)));
 assert.deepEqual(parseXlsxRows(makeXlsx(rows,true)).formulaRows,[3]);
});
test('03A: inline strings and formula without cache in prefixed cells',()=>{
 const sheet='<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>期间</x:t></x:is></x:c><x:c r="B1"><x:v>21834032</x:v></x:c></x:row><x:row r="2"><x:c r="A2"><x:f/></x:c></x:row></x:sheetData></x:worksheet>';
 const b=makeZipEx([{name:'xl/workbook.xml',data:Buffer.from('<workbook/>')},{name:'xl/worksheets/sheet1.xml',data:Buffer.from(sheet)}]);
 const r=parseXlsxRows(b);assert.deepEqual(r.rows[0],['期间','21834032']);assert.deepEqual(r.formulaRows,[2]);
});
test('03A: untrusted namespace is not interpreted as worksheet',()=>{
 const b=makeZipEx([{name:'xl/workbook.xml',data:Buffer.from('<workbook/>')},{name:'xl/worksheets/sheet1.xml',data:Buffer.from('<x:worksheet xmlns:x="urn:other"><x:sheetData><x:row/></x:sheetData></x:worksheet>')}]);
 assert.throws(()=>parseXlsxRows(b),/不是可读 XML/);
});

test('03A: yuan aliases keep totals excluded and invalid dates rejected',()=>{
 const r=parseArtifactBytes(Buffer.from('日期,收入元,支出元,余额元\n2026-01-01,10,2,8\n合计,10,2,8\n2026-02-30,999,0,0'),{fileName:'bank.csv'});
 assert.equal(r.rows.length,1);assert.equal(r.aggregates.inflowTotal,10);
 assert.equal(r.aggregates.totalsExcluded,1);assert.equal(r.badRows.length,1);
});
