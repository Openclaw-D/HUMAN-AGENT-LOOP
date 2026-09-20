// TAKEOFF-FA-1.0.0 验收夹具生成器（路04）。
// 产出 Back/Edge/test/fixtures/takeoff/materials/ 下的真实字节合成材料 + SHA256SUMS。
// 确定性：同样输入永远产出同样字节（无时间戳/随机数），便于验收快照比对与复现。
// 全部内容为合成测试数据，文件内文字显式标注 SYNTHETIC / 合成测试，不使用任何真实客户资料。
// 运行：node scripts/acceptance/gen-fixtures.mjs [--out test/fixtures/takeoff]
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const argOut = process.argv.includes('--out')
  ? resolve(process.argv[process.argv.indexOf('--out') + 1])
  : resolve(here, '..', '..', 'test', 'fixtures', 'takeoff');
const outDir = join(argOut, 'materials');
mkdirSync(outDir, { recursive: true });

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ---------- 最小合法 PDF（单页 Helvetica 多行文本；无时间戳，字节确定） ----------
function makePdf(title, lines) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = ['BT', '/F1 12 Tf', '72 760 Td', '18 TL',
    `(${esc(title)}) Tj`, ...lines.map((l) => `(${esc(l)}) Tj T*`), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  // DEF-03-01 修复（2026-09-20，03路交叉发现）：中文文本层须按 UTF-8 落盘；二进制注释标记
  // %\xE2\xE3\xCF\xD3 紧随 %PDF 头之后按原始字节拼接（经字符串整体编码会被放大成双字节损坏，
  // 且标记绝不能置于 %PDF 魔数之前——否则格式嗅探失败）。
  // 文件偏移 = 头(9B) + 标记(6B) + 前缀 UTF-8 字节数，恒一致。
  const HEADER = Buffer.from('%PDF-1.4\n', 'utf8');
  const MARKER = Buffer.from([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]);
  const byteLen = (s) => HEADER.length + MARKER.length + Buffer.byteLength(s, 'utf8');
  let out = '';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(byteLen(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = byteLen(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.concat([HEADER, MARKER, Buffer.from(out, 'utf8')]);
}

// ---------- 最小合法 PNG（RGB 纯色块；手工 chunk+CRC，字节确定） ----------
function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}
function makePng(w, h, [r, g, b]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3)]);
  for (let x = 0; x < w; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 合成材料定义 ----------
// kind 为拟用工件类型词表（最终以03路冻结的处理协议为准登记，验收前核对一次）。
const PDF_NOTE = ['SYNTHETIC TEST DOCUMENT / 合成测试文件', 'NOT A REAL BUSINESS RECORD / 非真实业务记录', 'TAKEOFF-FA-1.0.0 acceptance fixture (lane 04)'];
const materials = [
  { file: 'N1-business-license.pdf', mime: 'application/pdf', kind: 'legal_document',
    label: '主体资料：营业执照副本（合成）',
    pdf: ['营业执照副本（ SYNTHETIC ）', ...PDF_NOTE,
      '统一社会信用代码：91330100SYNTHETIC01X', '名称：恒锐精密机械制造（合成测试）有限公司',
      '住所：浙江省杭州市合成区合成路88号（虚构）', '经营范围：精密机械零部件制造（合成演示）'] },
  { file: 'N2-balance-sheet.csv', mime: 'text/csv', kind: 'financial_statement',
    label: '经营/负债资料：近两年资产负债简表（合成）',
    text: ['period,total_assets_wan,total_liabilities_wan,net_fixed_assets_wan,revenue_wan,note',
      '2024,3860,1720,2100,3050,SYNTHETIC fixture lane04',
      '2025H1,4020,1755,2050,1680,SYNTHETIC fixture lane04'].join('\n') },
  { file: 'N3-equipment-list.csv', mime: 'text/csv', kind: 'equipment_list',
    label: '设备范围：拟回租设备清单 v1（合成；净值待C1纠正下调）',
    text: ['line,equipment,model,qty,original_cost_wan,net_book_value_wan,ownership,note',
      '1,五轴加工中心,DMG-MORI-DMU50,2,560,448,self-owned,SYNTHETIC fixture lane04',
      '2,数控车床,CK6150,6,360,288,self-owned,SYNTHETIC fixture lane04',
      '3,三坐标测量机,ZEISS-CALIPRO,1,180,144,self-owned,SYNTHETIC fixture lane04'].join('\n') },
  { file: 'N4-ownership-invoice.png', mime: 'image/png', kind: 'ownership_document',
    label: '权属支持：设备购置发票扫描样张（合成纯色图，无法可靠解析→转人工）', png: [0xb0, 0x8c, 0x5a] },
  { file: 'N5-entity-identity-license.png', mime: 'image/png', kind: 'legal_document',
    label: '主体身份：执照扫描样张（合成纯色图，无法可靠解析→转人工；verified 级唯一来源=人工转录+核验）', png: [0x8c, 0xb0, 0x5a] },
  { file: 'P1-new-order-contract.pdf', mime: 'application/pdf', kind: 'order_contract',
    label: '改善证据：新签订单合同（合成；支持候选上调）',
    pdf: ['设备销售框架订单（ SYNTHETIC ）', ...PDF_NOTE,
      '甲方：合成动力装备（演示）有限公司', '乙方：恒锐精密机械制造（合成测试）有限公司',
      '订单金额：人民币 1,860 万元（合成数字，非真实报价）', '交付期：2026Q4–2027Q2（合成排期）'] },
  { file: 'A1-litigation-notice.pdf', mime: 'application/pdf', kind: 'litigation_document',
    label: '不利/冲突证据：未决诉讼通知（合成；与经营向好证据冲突→T06冻结）',
    pdf: ['应诉通知书（ SYNTHETIC ）', ...PDF_NOTE,
      '案由：买卖合同纠纷（合成案情，仅测试用）', '涉诉金额：人民币 620 万元（合成数字）',
      '状态：已受理未判决（合成状态）'] },
  { file: 'A2-litigation-withdrawal.pdf', mime: 'application/pdf', kind: 'litigation_document',
    label: '解除证据：法院准予撤诉裁定（合成；supersedes A1；T06 解除须有新有效依据，不一键豁免）',
    pdf: ['民事裁定书（ SYNTHETIC ）', ...PDF_NOTE,
      '案由：买卖合同纠纷（合成案情，仅测试用）', '裁定结果：准许原告撤诉（合成裁定）',
      '本案已结案（合成状态）'] },
  { file: 'D1-ownership-invoice-copy.png', mime: 'image/png', kind: 'ownership_document',
    label: '重复材料：与N4同字节不同文件名（T05：重复不增加证明力）', png: [0xb0, 0x8c, 0x5a], sameBytesOf: 'N4-ownership-invoice.png' },
  { file: 'C1-equipment-list-v2.csv', mime: 'text/csv', kind: 'equipment_list',
    label: '纠正材料：设备清单 v2（净值下调；supersedes N3；T04可减/T08新旧竞争）',
    text: ['line,equipment,model,qty,original_cost_wan,net_book_value_wan,ownership,note',
      '1,五轴加工中心,DMG-MORI-DMU50,2,560,403,self-owned,SYNTHETIC fixture lane04 revised valuation',
      '2,数控车床,CK6150,6,360,259,self-owned,SYNTHETIC fixture lane04 revised valuation',
      '3,三坐标测量机,ZEISS-CALIPRO,1,180,130,self-owned,SYNTHETIC fixture lane04 revised valuation',
      'correction_of,N3-equipment-list.csv,reason,valuation recheck (synthetic),supersedes,v1'].join('\n') },
];

const generated = [];
for (const m of materials) {
  let buf;
  if (m.pdf) buf = makePdf(m.label, m.pdf);
  else if (m.text !== undefined) buf = Buffer.from(m.text, 'utf8');
  else if (m.png) buf = makePng(96, 64, m.png);
  else throw new Error(`材料 ${m.file} 无内容类型`);
  if (m.sameBytesOf) {
    const src = generated.find((g) => g.file === m.sameBytesOf);
    buf = src.buf; // T05 重复件：与原件逐字节相同
  }
  writeFileSync(join(outDir, m.file), buf);
  generated.push({ file: m.file, buf, ...m });
}

const manifest = {
  note: 'TAKEOFF-FA-1.0.0 路04 验收夹具。全部合成。kind 词表已按03路 PROTOCOL v1.1 §1 冻结面核对一致。PDF 生成器于 2026-09-20 修复 DEF-03-01（UTF-8 文本层，中文可提取，03路探针实测通过）后重新生成。',
  syntheticCustomer: {
    displayName: '恒锐精密机械制造（合成测试）有限公司',
    legalEntityRef: 'SYNTHETIC-HRJM-2026-001',
    profile: '小微制造业新客户，首次售后回租需求；全部数字为测试值，不代表任何机构制度或真实报价。',
  },
  materials: generated.map((g) => ({
    file: g.file, mime: g.mime, kind: g.kind, label: g.label,
    sha256: sha256(g.buf), bytes: g.buf.length,
  })),
  injectionOrder: ['N1', 'N2', 'N3', 'N4', 'P1', 'A1', 'D1', 'C1'],
};
writeFileSync(join(argOut, 'fixture-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(argOut, 'SHA256SUMS.txt'),
  generated.map((g) => `${sha256(g.buf)}  materials/${g.file}`).join('\n') + '\n');
console.log(`fixtures -> ${argOut}`);
for (const g of generated) console.log(`  ${g.file}  ${g.buf.length}B  ${sha256(g.buf).slice(0, 12)}…`);
