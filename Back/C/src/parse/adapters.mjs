// goal-02（产品交付·任务二）· B2 真实输入解析适配器 v2（格式白名单制；确定性；零依赖零外部调用）。
// 硬边界（任务书 §四）：
// - 本轮必需白名单：可靠 CSV/TSV（引号内分隔符/换行/双写引号转义）、XLSX（固定合理表结构=第一个
//   工作表、表头行识别、Excel 序列日期、公式缺缓存值→该行拒绝）、TXT、可提取文本的 PDF；
//   ZIP 安全解包（协调层经 zipguard）；JPG/PNG/扫描 PDF 安全接收+预览（魔数嗅探、不解码、不 OCR）。
// - 扫描件/图片一律 FORMAT_UNSUPPORTED 如实转人工（无获准识别提供方：走"原件可见、来源可选、
//   人工录入/校正、获准复核"产品入口，不 mock、不交给开发者预填 JSON）。
// - 支持一种格式必须用原始文件测试：本模块消费原始字节（Buffer），不消费预填 declaredFacts。
// - 解析只产出"带来源的结构化行/聚合+声明事实候选"：机器可从原件确定性提取的数值
//   = source_supported（绑定原件哈希+parserVersion+行引用）；自由文本/表格声明 = declared。
//   银行流水聚合强制附"入账≠经营收入"口径注记；聚合不做设备匹配、不产出诚信结论。
// - 金额严格解析：千分位逗号只按标准分组接受；非法分组/混合符号 → 该行拒绝，不错列金额后仍成功。
// - 日期严格校历：2026-13-45、2 月 30 日、20260105 形态；非法 → badRow，不再静默规范化。
// - 合计/总计/小计行识别剔除（聚合不重复计数），并留旗标。
// - 期间对齐只定位差异（qualityFlags.period_mismatch），不自动改写声明期间、不下结论。
// - 同输入字节+同元数据 → 恒同输出（确定性；上游按此做解析缓存键）。

import { inflateSync, inflateRawSync } from 'node:zlib';
import { stableHash } from '../../domains/util.mjs';

export const PARSE_ADAPTERS_VERSION = 'parse-adapters@2';

/** 银行流水聚合强制口径注记（C/intake CALIBER_NOTES 同源）。 */
const BANK_CALIBER_NOTE = '银行流水口径：全部入账不直接当经营收入；与申报收入的口径差属待核验差异，不是自动欺诈结论';

const IMAGES = {
  png: { magic: [0x89, 0x50, 0x4e, 0x47], name: 'png' },
  jpg: { magic: [0xff, 0xd8, 0xff], name: 'jpg' },
  gif: { magic: [0x47, 0x49, 0x46, 0x38], name: 'gif' },
};
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

function startsWithMagic(buf, magic) {
  if (buf.length < magic.length) return false;
  return magic.every((b, i) => buf[i] === b);
}

function decodeText(buf) {
  const s = buf.toString('utf8');
  // 严格 UTF-8 解码失败会出 U+FFFD：出现替换符=二进制/编码不符，不当文本解析
  if (s.includes('\uFFFD')) return null;
  return s;
}

function extOf(fileName) {
  const m = /\.([a-z0-9]+)$/i.exec(String(fileName ?? '').trim());
  return m ? `.${m[1].toLowerCase()}` : '';
}

// ---------------------------------------------------------------------------
// 引号感知 CSV/TSV 行解析（RFC4180 风格状态机；无依赖）
// ---------------------------------------------------------------------------

/** 整表解析 → rows: string[][]。分隔符嗅探取首条记录（引号外）出现者：制表 > 分号 > 逗号。 */
export function parseDelimitedRows(text) {
  const s = String(text ?? '');
  const firstLineEnd = findRecordEnd(s, 0);
  const probe = s.slice(0, firstLineEnd < 0 ? s.length : firstLineEnd);
  const count = (ch) => countOutsideQuotes(probe, ch);
  const tab = count('\t'); const semi = count(';'); const comma = count(',');
  const delim = tab > 0 ? '\t' : (semi >= 1 && semi >= comma ? ';' : ',');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const pushField = () => { row.push(field.trim()); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += c === '\r' ? '' : c; i += 1; continue;
    }
    if (c === '"' && field === '') { inQuotes = true; i += 1; continue; }
    if (c === delim) { pushField(); i += 1; continue; }
    if (c === '\r') { if (s[i + 1] === '\n') i += 1; pushRow(); i += 1; continue; }
    if (c === '\n') { pushRow(); i += 1; continue; }
    field += c; i += 1;
  }
  if (field !== '' || row.length > 0) pushRow();
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function findRecordEnd(s, from) {
  let inQuotes = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '"') inQuotes = !inQuotes;
    else if ((c === '\n' || c === '\r') && !inQuotes) return i;
  }
  return -1;
}

function countOutsideQuotes(s, ch) {
  let n = 0; let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ch && !inQuotes) n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// 金额/日期严格解析
// ---------------------------------------------------------------------------

/** 严格金额：千分位逗号仅按 \d{1,3}(,\d{3})+ 分组接受；括号/负号=负数；非法形态→null（badRow，不错列）。 */
export function parseAmountCell(s) {
  if (s == null) return null;
  let t = String(s).trim();
  if (t === '') return null;
  let sign = 1;
  const paren = /^\((.*)\)$/.exec(t);
  if (paren) { sign = -1; t = paren[1].trim(); }
  t = t.replace(/[￥¥$€\s]/g, '').replace(/－/g, '-');
  if (/^-/.test(t)) { sign = -sign; t = t.slice(1); }
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else if (t.includes(',')) return null; // 非千分位逗号（如 1,23）：拒绝，不猜
  if (!/^(\d+(\.\d+)?|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? sign * n : null;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function daysInMonth(y, m) {
  if (m === 2) {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return leap ? 29 : 28;
  }
  return DAYS_IN_MONTH[m - 1];
}

/** 严格日历校验：非法（13 月/2 月 30 日等）→ null（badRow），不静默规范化。 */
export function normDate(s) {
  const raw = String(s ?? '').trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(raw.replace(/年|月/g, '-').replace(/日/g, ''));
  if (!m) m = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Excel 序列日期（1900 系统）→ ISO；合理区间外（非日期数值）→ null。 */
export function excelSerialToIso(n) {
  if (!Number.isFinite(n) || n < 20000 || n > 60000) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function monthOf(dateStr) { return dateStr ? dateStr.slice(0, 7) : null; }

// ---------------------------------------------------------------------------
// 银行流水表：表头识别 + 行级提取 + 聚合（CSV/TSV/XLSX 共用）
// ---------------------------------------------------------------------------

const HEADER_MAP = {
  date: ['交易日期', '日期', '交易时间', '记账日期', 'date', 'transdate'],
  inflow: ['收入', '入账金额', '贷方发生额', '贷方', '收入金额', 'credit', 'deposit', 'inflow', 'amountcredit'],
  outflow: ['支出', '出账金额', '借方发生额', '借方', '支出金额', 'debit', 'withdrawal', 'outflow', 'amountdebit'],
  balance: ['余额', 'balance'],
  memo: ['摘要', '备注', '说明', 'description', 'memo', 'summary'],
};

function normHeader(h) {
  return String(h ?? '').replace(/\s+/g, '').toLowerCase();
}

/** 在前 5 行内找表头行；返回 {rowIndex, map} 或 null。 */
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const cells = (rows[i] ?? []).map(normHeader);
    const map = {};
    for (const [field, aliases] of Object.entries(HEADER_MAP)) {
      const col = cells.findIndex((c) => aliases.includes(c));
      if (col >= 0) map[field] = col;
    }
    if (map.date != null && (map.inflow != null || map.outflow != null)) return { rowIndex: i, map };
  }
  return null;
}

const TOTAL_ROW_RE = /^(合计|总计|小计|累计|总合计|total|subtotal|sum)$/i;

/**
 * 银行流水行提取+聚合（输入=已解析的行数组；cellOf(row,col) 取原始单元格字符串）。
 * 合计行剔除（不重复计入合计）；坏行不入合计并留明细；
 * opts.excludeRows（如 XLSX 公式缺缓存值的行号）整行拒绝——未知值绝不按 0 参与合计。
 */
export function extractBankStatement(rows, cellOf, opts = {}) {
  const head = findHeaderRow(rows);
  if (!head) return { ok: false, code: 'PARSE_FAILED', detail: '未识别出银行流水表头（日期+收入/支出列）' };
  const { rowIndex, map } = head;
  const outRows = [];
  const badRows = [];
  let totalsExcluded = 0;
  for (let i = rowIndex + 1; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    if (cells.some((c) => TOTAL_ROW_RE.test(String(c ?? '').trim()))) {
      totalsExcluded += 1;
      continue;
    }
    if (opts.excludeRows?.has(i + 1)) {
      badRows.push({ line: i + 1, detail: '公式缺缓存值：该行数值未知，整行拒绝，不入合计' });
      continue;
    }
    const memo = map.memo != null ? (cellOf(cells, map.memo) ?? null) : null;
    const date = normDate(cellOf(cells, map.date));
    const rawIn = map.inflow != null ? cellOf(cells, map.inflow) : null;
    const rawOut = map.outflow != null ? cellOf(cells, map.outflow) : null;
    const nonEmpty = (v) => v != null && String(v).trim() !== '';
    const inflow = nonEmpty(rawIn) ? parseAmountCell(rawIn) : null;
    const outflow = nonEmpty(rawOut) ? parseAmountCell(rawOut) : null;
    const balance = map.balance != null ? parseAmountCell(cellOf(cells, map.balance)) : null;
    const amountInvalid = (nonEmpty(rawIn) && inflow == null) || (nonEmpty(rawOut) && outflow == null);
    if (date == null || (!nonEmpty(rawIn) && !nonEmpty(rawOut)) || amountInvalid) {
      const why = date == null ? '日期非法/缺失' : (amountInvalid ? '金额不可解析（拒绝该行，不错列）' : '收入/支出均缺失');
      badRows.push({ line: i + 1, detail: `日期或金额不可解析（${why}，拒绝该行不入合计）` });
      continue;
    }
    void memo;
    outRows.push({ line: i + 1, date, inflow: inflow ?? 0, outflow: outflow ?? 0, balance, memo });
  }
  if (outRows.length === 0) {
    return { ok: false, code: 'PARSE_FAILED', detail: '表头后无有效数据行', badRows, totalsExcluded };
  }
  const dates = outRows.map((r) => r.date).sort();
  const inflowTotal = outRows.reduce((a, r) => a + r.inflow, 0);
  const outflowTotal = outRows.reduce((a, r) => a + r.outflow, 0);
  const monthCount = new Set(outRows.map((r) => monthOf(r.date))).size;
  return {
    ok: true,
    rows: outRows,
    badRows,
    totalsExcluded,
    aggregates: {
      rowCount: outRows.length,
      badRowCount: badRows.length,
      totalsExcluded,
      periodStart: dates[0],
      periodEnd: dates[dates.length - 1],
      monthCount,
      inflowTotal: Number(inflowTotal.toFixed(2)),
      outflowTotal: Number(outflowTotal.toFixed(2)),
    },
    caliberNote: BANK_CALIBER_NOTE,
  };
}

/** 兼容导出：文本 → 引号感知解析 → 流水提取。 */
export function parseBankStatementCsv(text, { delimiter = null } = {}) {
  void delimiter; // v2 起分隔符由引号感知嗅探统一决定
  return extractBankStatement(parseDelimitedRows(text), (cells, col) => cells[col]);
}

// ---------------------------------------------------------------------------
// key,value 声明提取（declared 级：内容是上传者的申报）
// ---------------------------------------------------------------------------

/** CSV key,value 声明表提取（任务02）：首行是 key/value 风格表头时按列定位（含可选 unit/caliber
 *  列——值列只取值，不再把 `,元,权责发生` 整段并入值导致数值不可判读）；否则回退逐行提取。 */
function extractKvCsvFacts(text) {
  const rows = parseDelimitedRows(text);
  if (rows.length >= 2) {
    const header = (rows[0] ?? []).map(normHeader);
    const keyCol = header.findIndex((h) => ['key', '键', '字段', '项目', '指标'].includes(h));
    const valCol = header.findIndex((h) => ['value', '值', '数值', '金额'].includes(h));
    if (keyCol >= 0 && valCol >= 0) {
      const unitCol = header.findIndex((h) => ['unit', '单位'].includes(h));
      const caliberCol = header.findIndex((h) => ['caliber', '口径'].includes(h));
      const facts = [];
      const problems = [];
      for (let i = 1; i < rows.length; i++) {
        const k = String(rows[i]?.[keyCol] ?? '').trim();
        const rawVal = String(rows[i]?.[valCol] ?? '').trim();
        if (k === '' && rawVal === '') continue;
        if (TOTAL_ROW_RE.test(k)) continue;
        if (k === '' || rawVal === '') { problems.push({ line: i + 1, detail: '空键或空值' }); continue; }
        const num = parseAmountCell(rawVal);
        const unit = unitCol >= 0 ? String(rows[i]?.[unitCol] ?? '').trim() : '';
        const caliber = caliberCol >= 0 ? String(rows[i]?.[caliberCol] ?? '').trim() : '';
        facts.push({
          factKey: k, value: num != null ? num : rawVal, verificationLevel: 'declared',
          unit: unit || null, caliber: caliber || null, sourceRefs: [i + 1],
        });
      }
      if (facts.length > 0) return { facts, problems };
    }
  }
  return extractKeyValueFacts(text);
}

function extractKeyValueFacts(text) {
  const facts = [];
  const problems = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const m = /^(.+?)\s*[=:，]\s*(.+)$/.exec(line) ?? (/^(.+?)\s*,\s*(.+)$/.exec(line));
    if (!m) { problems.push({ line: i + 1, detail: '无法按 key=value 解析' }); continue; }
    const key = m[1].trim();
    const rawVal = m[2].trim();
    if (key === '' || rawVal === '') { problems.push({ line: i + 1, detail: '空键或空值' }); continue; }
    const num = parseAmountCell(rawVal);
    facts.push({
      factKey: key,
      value: num != null ? num : rawVal,
      verificationLevel: 'declared',
      line: i + 1,
    });
  }
  return { facts, problems };
}

/** 期间错位检查：声明期间 vs 内容实际期间——只定位，不改写。 */
function checkPeriodMismatch(meta, actual) {
  const flags = [];
  if (!meta || actual == null) return flags;
  const declFrom = meta.periodFrom ? String(meta.periodFrom).slice(0, 10) : null;
  const declTo = meta.periodTo ? String(meta.periodTo).slice(0, 10) : null;
  if (declFrom && actual.periodStart && declFrom.slice(0, 7) !== String(actual.periodStart).slice(0, 7)) {
    flags.push({ flag: 'period_mismatch', detail: `声明期间起 ${declFrom} 与内容实际 ${actual.periodStart} 不一致（只定位，不改写）` });
  }
  if (declTo && actual.periodEnd && declTo.slice(0, 7) !== String(actual.periodEnd).slice(0, 7)) {
    flags.push({ flag: 'period_mismatch', detail: `声明期间止 ${declTo} 与内容实际 ${actual.periodEnd} 不一致（只定位，不改写）` });
  }
  return flags;
}

// ---------------------------------------------------------------------------
// ZIP 最小读取（中央目录；仅用于 XLSX 识别与读取；安全解包仍归协调层 zipguard）
// ---------------------------------------------------------------------------

function zipEntries(buf) {
  // 从尾部找 EOCD
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
    // local header：数据起点 = localOffset + 30 + nameLen + extraLen（本地 extra 长度可不同）
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) return null;
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    entries.set(name, { method, compSize, dataStart: localOffset + 30 + lNameLen + lExtraLen });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function zipRead(buf, e) {
  const raw = buf.slice(e.dataStart, e.dataStart + e.compSize);
  if (e.method === 0) return raw;
  if (e.method === 8) { try { return inflateRawSync(raw); } catch { return null; } }
  return null;
}

function isXlsxBuffer(buf) {
  const entries = zipEntries(buf);
  if (!entries) return false;
  const ct = entries.get('[Content_Types].xml');
  if (!ct || !entries.has('xl/workbook.xml')) return false;
  const data = zipRead(buf, ct);
  return data != null && data.toString('utf8').includes('spreadsheetml');
}

// ---------------------------------------------------------------------------
// XLSX（固定合理表结构：第一个工作表；共享字符串；公式缺缓存值→该行拒绝）
// ---------------------------------------------------------------------------

function colIndexOf(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(String(ref ?? '').trim().toUpperCase());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) };
}

function xmlText(s) {
  return String(s ?? '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

function parseSharedStrings(xml) {
  const out = [];
  const re = /<si>([\s\S]*?)<\/si>|<si\/>/g;
  let m;
  while ((m = re.exec(xml)) != null) {
    if (m[1] === undefined) { out.push(''); continue; }
    const ts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => xmlText(x[1]));
    out.push(ts.join(''));
  }
  return out;
}

function parseSheetRows(xml) {
  const rows = [];
  const rowRe = /<row[^>]*?>([\s\S]*?)<\/row>|<row[^>]*?\/>/g;
  let rm;
  while ((rm = rowRe.exec(xml)) != null) {
    const rowAttr = /^<row[^>]*?\sr="(\d+)"/.exec(rm[0]);
    const rowNum = rowAttr ? Number(rowAttr[1]) : rows.length + 1;
    const cells = [];
    if (rm[1] !== undefined) {
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cm;
      let pos = 0;
      while ((cm = cellRe.exec(rm[1])) != null) {
        const attrs = cm[1] ?? '';
        const inner = cm[2] ?? '';
        const refM = /\sr="([A-Z]+\d+)"/i.exec(attrs);
        const typeM = /\st="([a-z]+)"/.exec(attrs);
        const posCol = pos;
        pos += 1;
        const ref = refM ? colIndexOf(refM[1]) : { col: posCol, row: rowNum };
        if (!ref) continue;
        const vM = /<v>([\s\S]*?)<\/v>/.exec(inner);
        const hasFormula = /<f[\s>]/.test(inner);
        const isM = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/.exec(inner);
        cells.push({
          col: ref.col, row: ref.row,
          type: typeM?.[1] ?? 'n',
          raw: vM ? xmlText(vM[1]) : null,
          inline: isM ? xmlText(isM[1]) : null,
          formulaNoCache: hasFormula && vM == null && isM == null,
        });
      }
    }
    rows.push({ rowNum, cells });
  }
  return rows;
}

/** XLSX → rows: string[][]（值都转字符串呈现；日期列序列值转 ISO）。 */
export function parseXlsxRows(buf) {
  const entries = zipEntries(buf);
  if (!entries || !entries.has('xl/workbook.xml')) throw Object.assign(new Error('XLSX 无 workbook'), { code: 'XLSX_INVALID' });
  const shared = entries.get('xl/sharedStrings.xml');
  const sharedStrings = shared ? parseSharedStrings(zipRead(buf, shared)?.toString('utf8') ?? '') : [];
  const sheetName = [...entries.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetName) throw Object.assign(new Error('XLSX 无工作表'), { code: 'XLSX_INVALID' });
  const sheetXml = zipRead(buf, entries.get(sheetName))?.toString('utf8') ?? '';
  // 护栏：内容不是 XML（压缩标记与实际不符/文件损坏）→ 诚实拒绝，不静默当空表
  if (!sheetXml.includes('<row') && !sheetXml.includes('<sheetData')) {
    throw Object.assign(new Error('工作表内容不是可读 XML'), { code: 'XLSX_INVALID' });
  }
  const parsed = parseSheetRows(sheetXml);
  if (parsed.length === 0) throw Object.assign(new Error('工作表无数据行'), { code: 'XLSX_INVALID' });
  const maxCol = parsed.reduce((a, r) => Math.max(a, ...r.cells.map((c) => c.col + 1)), 0);
  const grid = [];
  const formulaRows = [];
  for (const r of parsed) {
    const line = new Array(maxCol).fill(null);
    let invalid = false;
    for (const c of r.cells) {
      if (c.formulaNoCache) {
        invalid = true; // 公式缺缓存值：该单元格数值未知，拒绝整行（不错列金额）
        continue;
      }
      let v = null;
      if (c.type === 's') v = sharedStrings[Number(c.raw)] ?? null;
      else if (c.type === 'inlineStr') v = c.inline;
      else if (c.type === 'str') v = c.raw;
      else if (c.type === 'b') v = c.raw === '1' ? 'TRUE' : 'FALSE';
      else v = c.raw; // 数字/日期按原始字符串，后续按列语义转换
      if (v != null) line[c.col] = String(v);
    }
    if (invalid) formulaRows.push(r.rowNum);
    grid[r.rowNum - 1] = line;
  }
  // 稀疏行归并（去掉 undefined 槽）
  const rows = grid.map((line) => (line ?? []).map((v) => (v == null ? '' : v)));
  return { rows, formulaRows };
}

/** 日期列（表头命中 date 别名）内的 Excel 序列数值 → ISO（留转换注记）。 */
function convertSerialDates(rows, headMap) {
  const flags = [];
  if (!headMap || headMap.date == null) return flags;
  for (let i = headMap.rowIndex + 1; i < rows.length; i++) {
    const raw = rows[i]?.[headMap.date];
    if (raw == null || raw === '') continue;
    if (/^\d+(\.\d+)?$/.test(raw)) {
      const iso = excelSerialToIso(Number(raw));
      if (iso) {
        rows[i][headMap.date] = iso;
        flags.push({ flag: 'excel_serial_date_converted', detail: `第 ${i + 1} 行日期列 Excel 序列值 ${raw} → ${iso}` });
      }
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// PDF 文本提取（可提取文本的 PDF；加密/纯扫描 → 如实转人工）
// ---------------------------------------------------------------------------

function decodePdfLiteral(s) {
  const unescaped = s
    .replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c] ?? c))
    .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
  // 内容流经 latin1 读取：多字节 UTF-8 文本（中文业务材料）须按字节还原；
  // 还原出现 U+FFFD 视为非 UTF-8（PDFDocEncoding 扩展段）：保原始 latin1，不猜。
  const utf8 = Buffer.from(unescaped, 'latin1').toString('utf8');
  return utf8.includes('\uFFFD') ? unescaped : utf8;
}

function decodePdfHexString(s) {
  const hex = s.replace(/[^0-9a-fA-F]/g, '');
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2).padEnd(2, '0'), 16));
  }
  const buf = Buffer.from(bytes);
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return buf.slice(2).swap16().toString('utf16le'); // UTF-16BE → 主机序
  }
  return buf.toString('latin1');
}

// 提取 PDF 文本（内容流 Tj 与 TJ 与引号算子；十六进制串；Td/TD/T-star/ET 定位算子→换行）。
export function extractPdfText(buf) {
  const raw = buf.toString('latin1');
  if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(raw)) return { ok: false, encrypted: true };
  const chunks = [];
  const streamRe = /stream\r?\n/g;
  let sm;
  while ((sm = streamRe.exec(raw)) != null) {
    const dictStart = Math.max(0, sm.index - 800);
    const dict = raw.slice(dictStart, sm.index);
    const end = raw.indexOf('endstream', sm.index);
    if (end < 0) break;
    // 数据起点=关键字之后（'stream\n' 属流声明不是流内容；混入会破坏 Flate 解码——能否解出全凭字节运气）
    const dataStart = sm.index + sm[0].length;
    const data = buf.slice(dataStart, Buffer.byteLength(raw.slice(0, end), 'latin1'));
    let content = null;
    if (/FlateDecode/.test(dict)) {
      try { content = inflateSync(data); } catch { try { content = inflateRawSync(data); } catch { content = null; } }
    } else if (!/(DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode|Image)/.test(dict)) {
      content = data; // 无压缩内容流
    }
    if (content != null) {
      chunks.push(extractTextOps(content.toString('latin1')));
    }
    streamRe.lastIndex = end;
  }
  const text = chunks.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { ok: true, text };
}

function extractTextOps(content) {
  let out = '';
  // 分组：1=字面串内容 2=其算子；3=TJ 数组体；4=十六进制串内容；5=定位/换行算子（hex 串算子为非捕获）
  const re = /\(((?:\\.|[^\\()])*)\)\s*(Tj|TJ|'|")|\[((?:[^\]\\]|\\.)*)\]\s*TJ|<([0-9a-fA-F\s]*)>\s*(?:Tj|TJ)|(T\*|Td|TD|ET|BT)/g;
  let m;
  while ((m = re.exec(content)) != null) {
    if (m[5] !== undefined) { out += '\n'; continue; } // T*/Td/TD/ET/BT → 换行
    if (m[1] !== undefined) { out += decodePdfLiteral(m[1]); if (m[2] === "'" || m[2] === '"') out += '\n'; continue; }
    if (m[3] !== undefined) {
      const parts = [...m[3].matchAll(/\(((?:\\.|[^\\()])*)\)|<([0-9a-fA-F\s]*)>/g)];
      out += parts.map((p) => (p[1] !== undefined ? decodePdfLiteral(p[1]) : decodePdfHexString(p[2]))).join('');
      continue;
    }
    if (m[4] !== undefined) { out += decodePdfHexString(m[4]); continue; }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 格式识别与统一入口
// ---------------------------------------------------------------------------

/** 魔数识别（唯一真相，扩展名仅辅助）。 */
export function detectFormat(buf, { fileName = '', contentType = '' } = {}) {
  void contentType;
  for (const info of Object.values(IMAGES)) {
    if (startsWithMagic(buf, info.magic)) return { family: 'image', name: info.name, previewSafe: true };
  }
  if (startsWithMagic(buf, PDF_MAGIC)) return { family: 'pdf', name: 'pdf', previewSafe: true };
  if (startsWithMagic(buf, ZIP_MAGIC)) return { family: 'zipish', name: isXlsxBuffer(buf) ? 'xlsx' : 'zip' };
  const ext = extOf(fileName);
  if (ext === '.tsv') return { family: 'csv', name: 'tsv', delimiter: '\t' };
  if (ext === '.csv') return { family: 'csv', name: 'csv' };
  const text = decodeText(buf);
  if (text != null) {
    if (ext === '.txt') return { family: 'text', name: 'txt' };
    if (/[\t;,]/.test(text.split(/\r?\n/, 1)[0] ?? '')) return { family: 'csv', name: 'csv' };
    return { family: 'text', name: 'txt' };
  }
  return { family: 'unknown', name: 'unknown' };
}

function bankFacts(bank, meta) {
  return [
    {
      factKey: 'bank_inflow_total',
      value: bank.aggregates.inflowTotal,
      verificationLevel: 'source_supported',
      unit: meta.currency ?? '元',
      caliber: 'bank_receipts',
      periodFrom: bank.aggregates.periodStart,
      periodTo: bank.aggregates.periodEnd,
      sourceRefs: bank.rows.map((r) => r.line),
      caliberNote: BANK_CALIBER_NOTE,
    },
    {
      factKey: 'bank_outflow_total',
      value: bank.aggregates.outflowTotal,
      verificationLevel: 'source_supported',
      unit: meta.currency ?? '元',
      caliber: 'bank_receipts',
      periodFrom: bank.aggregates.periodStart,
      periodTo: bank.aggregates.periodEnd,
      sourceRefs: bank.rows.map((r) => r.line),
      caliberNote: BANK_CALIBER_NOTE,
    },
  ];
}

function assembleBank(bank, format, parserVersion, text, extraFlags = [], meta = {}) {
  const qualityFlags = [...extraFlags];
  if (bank.aggregates.badRowCount > 0) {
    qualityFlags.push({ flag: 'bad_rows_present', detail: `${bank.aggregates.badRowCount} 行无法解析（已排除，不入合计）：${bank.badRows.slice(0, 3).map((b) => `L${b.line}`).join(',')}` });
  }
  if (bank.aggregates.totalsExcluded > 0) {
    qualityFlags.push({ flag: 'total_rows_excluded', detail: `${bank.aggregates.totalsExcluded} 行合计/小计已剔除（不重复计入聚合）` });
  }
  return {
    ok: true, format, parserVersion, text,
    rows: bank.rows, badRows: bank.badRows, aggregates: bank.aggregates,
    declaredFacts: bankFacts(bank, meta),
    qualityFlags, caliberNote: bank.caliberNote,
    parseId: `prs-${stableHash({ sha: stableHash(text), v: parserVersion }).slice(0, 16)}`,
  };
}

/**
 * 统一入口：原始字节 + 声明元数据 → 解析产物（或如实失败）。
 * @param p.meta {fileName, contentType, periodFrom, periodTo, currency, unit, caliber, subjectId}
 */
export function parseArtifactBytes(buf, meta = {}) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return { ok: false, code: 'PARSE_FAILED', detail: '空字节/非 Buffer：不可读，不编数', manualEntry: true };
  }
  const fmt = detectFormat(buf, meta);

  // 图片：安全接收+预览（不解码不 OCR）；转人工录入
  if (fmt.family === 'image') {
    return {
      ok: false, code: 'FORMAT_UNSUPPORTED', format: fmt.name,
      detail: `图片 ${fmt.name} 不做自动识别（无获准提供方）：原件已安全接收可预览，请走人工录入/校正入口`,
      manualEntry: true, previewSafe: true, previewFormat: fmt.name,
    };
  }

  // PDF：可提取文本 → keyvalue 声明；加密/纯扫描 → 如实转人工（可预览）
  if (fmt.family === 'pdf') {
    const pdf = extractPdfText(buf);
    if (!pdf.ok && pdf.encrypted) {
      return { ok: false, code: 'PARSE_FAILED', format: 'pdf', detail: 'PDF 已加密：不可解析，不编数', manualEntry: true, previewSafe: true, previewFormat: 'pdf' };
    }
    const text = pdf.text ?? '';
    const meaningful = text.replace(/[\s\u0000]/g, '');
    if (meaningful.length < 2) {
      return {
        ok: false, code: 'FORMAT_UNSUPPORTED', format: 'pdf',
        detail: 'PDF 无可提取文本层（扫描/图片型）：不做 OCR（无获准提供方），原件可预览，请走人工录入/校正入口',
        manualEntry: true, previewSafe: true, previewFormat: 'pdf',
      };
    }
    const { facts, problems } = extractKeyValueFacts(text);
    return {
      ok: true, format: 'keyvalue_pdf', parserVersion: `${PARSE_ADAPTERS_VERSION}:pdf-text@1`, text,
      declaredFacts: facts.map((f) => ({
        factKey: f.factKey, value: f.value, verificationLevel: 'declared',
        unit: meta.unit ?? null, caliber: meta.caliber ?? null, sourceRefs: [f.line],
      })),
      qualityFlags: checkPeriodMismatch(meta, null), problems,
      previewSafe: true, previewFormat: 'pdf',
      note: '可提取文本 PDF：key=value 声明为 declared 级（上传者申报）；表格结构未重构，全文留存观测',
      parseId: `prs-${stableHash({ sha: stableHash(text), v: `${PARSE_ADAPTERS_VERSION}:pdf-text@1` }).slice(0, 16)}`,
    };
  }

  // ZIP 族：XLSX（内容含 spreadsheetml）就地解析；其余交回协调层安全解包
  if (fmt.family === 'zipish') {
    if (fmt.name === 'xlsx') {
      try {
        const { rows, formulaRows } = parseXlsxRows(buf);
        const head = findHeaderRow(rows);
        const serialFlags = head ? convertSerialDates(rows, { date: head.map.date, rowIndex: head.rowIndex }) : [];
        const bank = head ? extractBankStatement(rows, (cells, col) => cells[col], { excludeRows: new Set(formulaRows) }) : { ok: false };
        if (bank.ok) {
          return assembleBank(bank, 'bank_statement_xlsx', `${PARSE_ADAPTERS_VERSION}:bank-statement-xlsx@1`,
            rows.map((r) => r.join('\t')).join('\n'), serialFlags);
        }
        // 非流水表：两列表（key/键/字段 + value/值）→ 声明事实；否则结构化表格留存（诚实无事实）
        const kv = extractKvTable(rows);
        if (kv) {
          return {
            ok: true, format: 'keyvalue_xlsx', parserVersion: `${PARSE_ADAPTERS_VERSION}:keyvalue-xlsx@1`,
            text: rows.map((r) => r.join('\t')).join('\n'),
            declaredFacts: kv.facts.map((f) => ({ ...f, unit: f.unit ?? meta.unit ?? null, caliber: f.caliber ?? meta.caliber ?? null })),
            qualityFlags: [...checkPeriodMismatch(meta, null), ...serialFlags], problems: kv.problems,
            ...(formulaRows.length > 0 ? { note: `公式缺缓存值行已拒绝：${formulaRows.join(',')}` } : {}),
            parseId: `prs-${stableHash({ sha: stableHash(buf.toString('latin1')), v: `${PARSE_ADAPTERS_VERSION}:keyvalue-xlsx@1` }).slice(0, 16)}`,
          };
        }
        return {
          ok: true, format: 'table_xlsx', parserVersion: `${PARSE_ADAPTERS_VERSION}:table-xlsx@1`,
          text: rows.map((r) => r.join('\t')).join('\n'),
          declaredFacts: [], rows,
          qualityFlags: [...checkPeriodMismatch(meta, null), ...serialFlags],
          ...(formulaRows.length > 0 ? { problems: [{ line: formulaRows.join(','), detail: '公式缺缓存值：相关单元格数值未知（已标注，不推断）' }] } : {}),
          note: 'XLSX 表格已结构化提取（首个工作表）；未识别出业务表头，不产生事实候选（转人工可读）',
          parseId: `prs-${stableHash({ sha: stableHash(buf.toString('latin1')), v: `${PARSE_ADAPTERS_VERSION}:table-xlsx@1` }).slice(0, 16)}`,
        };
      } catch (e) {
        if (e.code === 'XLSX_INVALID') {
          return { ok: false, code: 'PARSE_FAILED', format: 'xlsx', detail: `XLSX 结构无效：${e.message}`, manualEntry: true, previewSafe: false };
        }
        return { ok: false, code: 'IS_CONTAINER', detail: 'ZIP 容器：由协调层安全解包后逐 entry 重入', format: 'zip' };
      }
    }
    return { ok: false, code: 'IS_CONTAINER', detail: 'ZIP 容器：由协调层安全解包后逐 entry 重入', format: 'zip' };
  }

  if (fmt.family !== 'csv' && fmt.family !== 'text') {
    return {
      ok: false, code: 'FORMAT_UNSUPPORTED',
      detail: `格式 ${fmt.name} 不在解析白名单：转人工入口，不推断内容`,
      manualEntry: true, format: fmt.name,
    };
  }
  const text = decodeText(buf);
  if (text == null) {
    return { ok: false, code: 'PARSE_FAILED', detail: 'UTF-8 解码失败（二进制或非 UTF-8 编码）：转人工', manualEntry: true };
  }

  if (fmt.family === 'csv') {
    const rows = parseDelimitedRows(text);
    const bank = extractBankStatement(rows, (cells, col) => cells[col]);
    if (bank.ok) {
      return assembleBank(bank, 'bank_statement_csv', `${PARSE_ADAPTERS_VERSION}:bank-statement@1`, text, checkPeriodMismatch(meta, bank.aggregates), meta);
    }
    // 非银行流水 CSV → key,value 声明表（任务02：表头感知——首行为 key/value[/unit/caliber]
    // 表头时按列提取，值列不再吞并单位/口径列；无表头回退逐行 key=value）
    const { facts, problems } = extractKvCsvFacts(text);
    if (facts.length === 0) {
      return { ok: false, code: 'PARSE_FAILED', detail: 'CSV 既非银行流水表头也无可解析的 key,value 行', problems, manualEntry: true };
    }
    return {
      ok: true, format: 'keyvalue_csv',
      parserVersion: `${PARSE_ADAPTERS_VERSION}:keyvalue-csv@1`, text,
      declaredFacts: facts.map((f) => ({
        factKey: f.factKey, value: f.value, verificationLevel: 'declared',
        unit: f.unit ?? meta.unit ?? null, caliber: f.caliber ?? meta.caliber ?? null,
        sourceRefs: f.sourceRefs ?? [f.line],
      })),
      qualityFlags: checkPeriodMismatch(meta, null), problems,
      note: 'key,value 声明表：全部为 declared 级（上传者申报），非原件机器提取',
      parseId: `prs-${stableHash({ sha: stableHash(text), v: `${PARSE_ADAPTERS_VERSION}:keyvalue-csv@1` }).slice(0, 16)}`,
    };
  }

  // text：key = value / key: value 自由文本声明
  const { facts, problems } = extractKeyValueFacts(text);
  if (facts.length === 0) {
    return {
      ok: true, format: 'free_text', parserVersion: `${PARSE_ADAPTERS_VERSION}:free-text@1`, text,
      declaredFacts: [], qualityFlags: [], problems,
      note: '自由文本无可提取的 key=value 声明：只留观测，不产事实候选（转人工可读）',
    };
  }
  return {
    ok: true, format: 'keyvalue_text',
    parserVersion: `${PARSE_ADAPTERS_VERSION}:keyvalue-text@1`, text,
    declaredFacts: facts.map((f) => ({
      factKey: f.factKey, value: f.value, verificationLevel: 'declared',
      unit: meta.unit ?? null, caliber: meta.caliber ?? null, sourceRefs: [f.line],
    })),
    qualityFlags: [], problems,
    note: '文本声明：declared 级（上传者申报）',
    parseId: `prs-${stableHash({ sha: stableHash(text), v: `${PARSE_ADAPTERS_VERSION}:keyvalue-text@1` }).slice(0, 16)}`,
  };
}

/** 表格 key/value 声明提取（XLSX 与 CSV 共用）：表头含 key/键/字段 列与 value/值/金额 列。
 *  任务02 修复：值只取"值"列（此前 CSV 走自由文本正则，把"值,单位,口径"整段当值、表头行变
 *  垃圾事实）；unit/caliber 列存在时逐行附着（声明列优先于上传元数据）。 */
function extractKvTable(rows) {
  if (rows.length < 2) return null;
  const header = (rows[0] ?? []).map(normHeader);
  const keyCol = header.findIndex((h) => ['key', '键', '字段', '项目', '指标'].includes(h));
  const valCol = header.findIndex((h) => ['value', '值', '数值', '金额'].includes(h));
  if (keyCol < 0 || valCol < 0) return null;
  const unitCol = header.findIndex((h) => ['unit', '单位'].includes(h));
  const caliberCol = header.findIndex((h) => ['caliber', '口径'].includes(h));
  const facts = [];
  const problems = [];
  for (let i = 1; i < rows.length; i++) {
    const k = String(rows[i]?.[keyCol] ?? '').trim();
    const rawVal = String(rows[i]?.[valCol] ?? '').trim();
    if (k === '' && rawVal === '') continue;
    if (TOTAL_ROW_RE.test(k)) continue;
    if (k === '' || rawVal === '') { problems.push({ line: i + 1, detail: '空键或空值' }); continue; }
    const num = parseAmountCell(rawVal);
    facts.push({
      factKey: k, value: num != null ? num : rawVal, verificationLevel: 'declared', sourceRefs: [i + 1],
      ...(unitCol >= 0 ? { unit: String(rows[i]?.[unitCol] ?? '').trim() || null } : {}),
      ...(caliberCol >= 0 ? { caliber: String(rows[i]?.[caliberCol] ?? '').trim() || null } : {}),
    });
  }
  if (facts.length === 0) return null;
  return { facts, problems };
}

/** 解析缓存键（协调层持久化用）：不跨客户共用，绑定处理版本 + 会改变结果的声明元数据。 */
export function parseCacheKey({ tenantId, customerId, sha256, parserVersion, meta = null }) {
  for (const [k, v] of Object.entries({ tenantId, customerId, sha256, parserVersion })) {
    if (!v || typeof v !== 'string') throw Object.assign(new Error(`parseCacheKey 缺 ${k}`), { code: 'PARSE_KEY_INCOMPLETE' });
  }
  return `pc-${stableHash({ tenantId, customerId, sha256, parserVersion, meta }).slice(0, 24)}`;
}
