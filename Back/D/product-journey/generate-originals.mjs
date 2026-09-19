// 任务四 D1·合成验收原件包生成器（零依赖，确定性输出）。
// 产物：六类原件（执照扫描 PNG / 主体登记 TXT / 银行流水 CSV / 账表 XLSX / 购机合同 PDF /
//       设备铭牌 PNG + 现场照片 PNG）× 一致组与冲突组，另加后到不利材料与失败样本。
// 纪律：期望值（真值/期望观测）只写入 expectations.json 供测试断言侧使用；
//       本脚本不与被测系统通信、不预填任何业务事实进被测输入。
// 用法：node generate-originals.mjs --out <dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import path from 'node:path';

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const OUT = path.resolve(outIdx >= 0 ? argv[outIdx + 1] : '.originals/demo');

// ---------- 地面真值（一致组；修改这里 = 改原件 = 期望随之变化） ----------
const G = {
  customer: {
    nameEn: 'HUALIN PRECISION MFG CO',
    creditCode: '91330100MA2G04XK71', // 统一社会信用代码（位串可绘入位图）
    established: '2019-04-18',
    period: '2025-07..2025-09',
  },
  equipment: { model: 'XM-5021', serial: 'DEV-2024-08871' },
  contract: { amountCny: 2180000.0, date: '2025-06-20', delivery: '2025-10-15' },
  statement: {
    rows: [
      // [date, desc, debit, credit]  金额（元）
      ['2025-07-05', 'SALE RCPT CUST-A', 0, 205300.0],
      ['2025-07-18', 'SALE RCPT CUST-B', 0, 416200.0],
      ['2025-07-29', 'PAYROLL', 198400.0, 0],
      ['2025-08-08', 'SALE RCPT CUST-A', 0, 198700.0],
      ['2025-08-15', 'TAX PAY', 86500.0, 0],
      ['2025-08-22', 'SALE RCPT CUST-C', 0, 399300.0],
      ['2025-09-02', 'RAW MATERIAL', 264800.0, 0],
      ['2025-09-10', 'SALE RCPT CUST-B', 0, 217400.0],
      ['2025-09-19', 'PAYROLL', 191200.0, 0],
      ['2025-09-26', 'SALE RCPT CUST-A', 0, 227600.0],
      ['2025-09-29', 'RENT', 64900.0, 0],
      ['2025-09-30', 'UTILITY', 21100.0, 0],
    ],
    openingBalance: 1200000.0,
  },
  ledger: {
    rows: [
      ['2025-07', 'REVENUE', 621500.0],
      ['2025-08', 'REVENUE', 598000.0],
      ['2025-09', 'REVENUE', 445000.0],
    ],
    fixedAssetsEquipment: 2180000.0, // 与合同金额一致（一致组）
    totalLiabilities: 1203200.0,
  },
  conflict: {
    contractAmount: 2398000.0, // 合同额 vs 账表固定资产入账 2180000.00 → 金额冲突 218000.00
    equipmentSerial: 'DEV-2024-08817', // 与合同/台账序列换位 → 设备编号冲突
  },
  lateAdverse: {
    rows: [['2025-09-28', 'GUARANTEE COMPENSATION OUT', 500000.0, 0]], // 后到不利材料：对外担保代偿
  },
};

// ---------- 期望值计算（隐藏真值；测试断言侧唯一来源） ----------
const fmt = (n) => n.toFixed(2);
const creditsTotal = G.statement.rows.reduce((s, r) => s + r[3], 0);
const debitsTotal = G.statement.rows.reduce((s, r) => s + r[2], 0);
const closing = G.statement.openingBalance + creditsTotal - debitsTotal;
const revenueTotal = G.ledger.rows.reduce((s, r) => s + r[2], 0);

// ---------- 通用工具 ----------
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const files = new Map(); // relPath -> Buffer
function put(rel, data) { files.set(rel, Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')); }

// ---------- PNG（位图字体渲染；确定性、无时间戳） ----------
const FONT5x7 = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11100', '10010', '10001', '10001', '10001', '10010', '11100'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c; }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}
function png(lines, scale = 4, width = 640, height = 400) {
  const W = width, H = height;
  const px = Buffer.alloc(H * (1 + W * 3)); // 每行 filter byte 0
  px.fill(255);
  let y = 20;
  for (const line of lines) {
    let x = 20;
    for (const ch of line) {
      const glyph = FONT5x7[ch] || FONT5x7[' '];
      for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
        if (glyph[r][c] === '1') {
          for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
            const py = y + r * scale + dy, pxx = x + c * scale + dx;
            if (py < H && pxx < W) { const o = py * (1 + W * 3) + 1 + pxx * 3; px[o] = px[o + 1] = px[o + 2] = 10; }
          }
        }
      }
      x += 6 * scale;
    }
    y += 10 * scale;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; // 8bit RGB
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(px, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- PDF（标准字体，可提取文本） ----------
function pdf(title, lines) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  let text = `BT /F1 16 Tf 50 780 Td (${esc(title)}) Tj ET\n`;
  let y = 750;
  for (const line of lines) { text += `BT /F1 11 Tf 50 ${y} Td (${esc(line)}) Tj ET\n`; y -= 20; }
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}endstream`,
  ];
  let body = '%PDF-1.4\n'; const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

// ---------- ZIP（store，供 XLSX 与安全反例） ----------
function zip(entries) { // entries: [{name, data:Buffer}]
  const locals = []; const centrals = []; let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'); const crc = crc32(e.data);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt32LE(20, 4); l.writeUInt32LE(0, 6); l.writeUInt32LE(0, 8);
    l.writeUInt32LE(crc, 14); l.writeUInt32LE(e.data.length, 18); l.writeUInt32LE(e.data.length, 22);
    l.writeUInt16LE(name.length, 26);
    locals.push(l, name, e.data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(e.data.length, 20); c.writeUInt32LE(e.data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    centrals.push(c, name);
    off += 30 + name.length + e.data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
const xmlEsc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function xlsx(sheetRows) { // [[..cells]] cell: string | number
  const header = `<row r="1">${sheetRows[0].map((c, i) =>
    `<c r="${String.fromCharCode(65 + i)}1" t="inlineStr"><is><t>${xmlEsc(String(c))}</t></is></c>`).join('')}</row>`;
  const body = sheetRows.slice(1).map((row, ri) =>
    `<row r="${ri + 2}">${row.map((c, ci) => {
      const ref = `${String.fromCharCode(65 + ci)}${ri + 2}`;
      return typeof c === 'number'
        ? `<c r="${ref}" t="n"><v>${c}</v></c>`
        : `<c r="${ref}" t="inlineStr"><is><t>${xmlEsc(String(c))}</t></is></c>`;
    }).join('')}</row>`).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${header}${body}</sheetData></worksheet>`;
  return zip([
    { name: '[Content_Types].xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`) },
    { name: '_rels/.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: 'xl/workbook.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="LEDGER" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`) },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet) },
  ]);
}

// ---------- CSV ----------
function csv(header, rows, { quote = false, totalRow = null } = {}) {
  const q = (v) => { const s = String(v); return quote && /[\d]/.test(s) && /^-?[\d,]+\.?\d*$/.test(s) ? `"${Number(s.replace(/,/g, '')).toLocaleString('en-US', { minimumFractionDigits: 2 })}"` : s; };
  const lines = [header.join(',')];
  for (const r of rows) lines.push(r.map(q).join(','));
  if (totalRow) lines.push(totalRow.map(q).join(','));
  return lines.join('\r\n') + '\r\n';
}
const money = (n) => fmt(n);

// ---------- 组装一致组 / 冲突组 / 失败样本 ----------
function buildSet(kind) { // kind = 'consistent' | 'conflict'
  const tag = kind === 'consistent' ? 'A' : 'B';
  const cc = G.customer.creditCode;
  const serial = kind === 'consistent' ? G.equipment.serial : G.conflict.equipmentSerial;
  const amount = kind === 'consistent' ? G.contract.amountCny : G.conflict.contractAmount;

  put(`${tag}-license-scan.png`, png([
    'CERTIFICATE OF REGISTRATION (SYNTHETIC SCAN)',
    `CREDIT CODE: ${cc}`,
    `ESTABLISHED: ${G.customer.established}`,
    'NAME: HUALIN PRECISION MFG',
  ]));
  put(`${tag}-entity-register.txt`, [
    '# SYNTHETIC ENTITY REGISTER (machine-readable)',
    `creditCode=${cc}`,
    `nameEn=${G.customer.nameEn}`,
    `established=${G.customer.established}`,
    `industry=GENERAL_EQUIPMENT_MFG`,
    `period=${G.customer.period}`,
  ].join('\n') + '\n');
  const stmtRows = G.statement.rows;
  put(`${tag}-statement-q3.csv`, csv(
    ['date', 'description', 'debit', 'credit'], stmtRows,
    { quote: true, totalRow: ['TOTAL', '', money(debitsTotal), money(creditsTotal)] }));
  // 无引号正例变体：真实解析适配器按朴素分隔符切列；引号+千分位属已知反例（见 expectations.failureSamples）
  put(`${tag}-statement-q3-plain.csv`, csv(
    ['date', 'description', 'debit', 'credit'], stmtRows,
    { quote: false, totalRow: ['TOTAL', '', money(debitsTotal), money(creditsTotal)] }));
  put(`${tag}-ledger-q3.xlsx`, xlsx([
    ['PERIOD', 'ITEM', 'AMOUNT_CNY'],
    ...G.ledger.rows,
    ['Q3', 'FIXED_ASSETS_EQUIPMENT', kind === 'consistent' ? G.ledger.fixedAssetsEquipment : G.ledger.fixedAssetsEquipment],
    ['Q3', 'TOTAL_LIABILITIES', G.ledger.totalLiabilities],
  ]));
  put(`${tag}-purchase-contract.pdf`, pdf('EQUIPMENT PURCHASE CONTRACT (SYNTHETIC)', [
    `BUYER: ${G.customer.nameEn}`,
    `BUYER CREDIT CODE: ${cc}`,
    `EQUIPMENT MODEL: ${G.equipment.model}`,
    `EQUIPMENT SERIAL: ${G.equipment.serial}`,
    `CONTRACT DATE: ${G.contract.date}`,
    `TOTAL PRICE: CNY ${money(amount)}`,
    `DELIVERY DATE: ${G.contract.delivery}`,
    'NOTE: SYNTHETIC DOCUMENT FOR ACCEPTANCE TEST ONLY. NOT A REAL CONTRACT.',
  ]));
  put(`${tag}-device-plate.png`, png([
    'DEVICE NAMEPLATE (SYNTHETIC)',
    `MODEL: ${G.equipment.model}`,
    `S/N: ${serial}`,
    'RATED: 380V 50HZ',
    'MFG DATE: 2024-08',
  ]));
  put(`${tag}-site-photo.png`, png([
    'SITE PHOTO (SYNTHETIC)',
    `SUBJECT: ${G.customer.nameEn}`,
    'TAKEN: 2025-09-12',
  ]));
}

function buildExtras() {
  // 失败样本
  const badDate = [['2025-13-40', 'BAD DATE ROW', 0, 99999.0], ...G.statement.rows.slice(0, 3)];
  put('X1-statement-bad-date.csv', csv(['date', 'description', 'debit', 'credit'], badDate, { quote: true, totalRow: ['TOTAL', '', '0.00', money(99999 + G.statement.rows.slice(0, 3).reduce((s, r) => s + r[3], 0))] }));
  const badRow = [['2025-07-05', 'NOT-A-NUMBER AMOUNT', 0, 'abc'], ['2025-07-06', 'OK ROW', 0, 1000.0]];
  put('X2-statement-bad-row.csv', csv(['date', 'description', 'debit', 'credit'], badRow));
  put('X3-unknown-format.bin', Buffer.from([0x00, 0x01, 0x02, 0xfe, 0xff, 0x37, 0x7f, 0x80, 0x11, 0x22]));
  put('X4-zip-traversal.zip', zip([{ name: '../escape.txt', data: Buffer.from('traversal attempt') }, { name: 'normal.txt', data: Buffer.from('ok') }]));
  // 后到不利材料（决定后追加）
  put('L1-late-adverse.csv', csv(['date', 'description', 'debit', 'credit'], G.lateAdverse.rows, { quote: true }));
}

// ---------- manifest + expectations ----------
function manifest() {
  const m = {};
  for (const [rel, buf] of files) m[rel] = { bytes: buf.length, sha256: sha256(buf) };
  return m;
}
function expectations() {
  return {
    _note: 'HIDDEN EXPECTATIONS — 仅测试断言侧加载；禁止进入被测系统输入（任务书 §2）。',
    version: 1,
    customer: G.customer,
    equipment: G.equipment,
    contract: G.contract,
    derived: {
      statementCreditsTotal: Number(fmt(creditsTotal)),
      statementDebitsTotal: Number(fmt(debitsTotal)),
      statementClosingBalance: Number(fmt(closing)),
      statementRowCount: G.statement.rows.length,
      ledgerRevenueTotal: Number(fmt(revenueTotal)),
    },
    consistent: {
      contractAmountEqualsLedgerFixedAssets: G.contract.amountCny === G.ledger.fixedAssetsEquipment,
      revenueEqualsStatementCredits: fmt(revenueTotal) === fmt(creditsTotal),
      expectObserved: { creditCode: G.customer.creditCode, equipmentSerial: G.equipment.serial, contractAmount: G.contract.amountCny },
      statementPlainFile: {
        file: 'A-statement-q3-plain.csv',
        expectParse: { format: 'bank_statement_csv', inflowTotal: Number(fmt(creditsTotal)), outflowTotal: Number(fmt(debitsTotal)), rowCount: 12, badRowsExplanation: 'TOTAL 合计行必须落入坏行/被忽略，不得计入合计' },
      },
    },
    conflict: {
      expectObserved: { creditCode: G.customer.creditCode, equipmentSerialOnPlate: G.conflict.equipmentSerial, contractAmount: G.conflict.contractAmount },
      expectFindings: [
        { type: 'AMOUNT_CONFLICT', detail: `contract ${fmt(G.conflict.contractAmount)} vs ledger fixed assets ${fmt(G.ledger.fixedAssetsEquipment)}` },
        { type: 'DEVICE_CONFLICT', detail: `plate ${G.conflict.equipmentSerial} vs contract ${G.equipment.serial}` },
      ],
    },
    manualRoute: {
      licenseScan: '无获准识别提供方 → 页面人工录入 creditCode + 标注人工',
      devicePlate: '同上；铭牌序列以 PNG 可见内容为准',
    },
    failureSamples: {
      'A/B-statement-q3.csv（引号+千分位变体）': { expect: '要么正确解析且合计=真值，要么明确拒绝/转人工路线；绝不产出错误合计仍标记成功' },
      'X1-statement-bad-date.csv': { expect: '非法日期行被拒/标坏行；有效行金额不静默失真', badDateCell: '2025-13-40' },
      'X2-statement-bad-row.csv': { expect: '非数值金额行标坏行，不参与合计；不得整文件静默成功', badAmountCell: 'abc' },
      'X3-unknown-format.bin': { expect: '不静默解析；进入失败或人工路线' },
      'X4-zip-traversal.zip': { expect: '路径穿越条目被拒绝；不得解出 escape.txt' },
      'L1-late-adverse.csv': { expect: '决定后追加 → 历史不改写，当前依据按规则受限（J1.6）', adverseFact: { date: '2025-09-28', debit: 500000.0 } },
      duplicateUpload: { expect: '同字节重复上传幂等/去重，不产生双份事实' },
    },
  };
}

// ---------- main ----------
buildSet('consistent');
buildSet('conflict');
buildExtras();
mkdirSync(OUT, { recursive: true });
for (const [rel, buf] of files) {
  const p = path.join(OUT, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, buf);
}
writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ generatedBy: 'Back/D/product-journey/generate-originals.mjs v1', deterministic: true, files: manifest() }, null, 2));
writeFileSync(path.join(OUT, 'expectations.json'), JSON.stringify(expectations(), null, 2));
console.log(`[generate-originals] ${files.size + 2} files -> ${OUT}`);
console.log(`[generate-originals] creditsTotal=${fmt(creditsTotal)} debitsTotal=${fmt(debitsTotal)} closing=${fmt(closing)} ledgerRevenue=${fmt(revenueTotal)}`);
