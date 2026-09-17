// goal-02 · B1 真实输入解析适配器（格式白名单制；确定性；零依赖零外部调用）。
// 硬边界（任务书 §三.3）：
// - 只支持显式登记的格式（csv/tsv、txt、zip 容器由协调层经 zipguard 解包后逐 entry 再进本模块）；
//   白名单外（pdf/图片/office/加密等）一律 FORMAT_UNSUPPORTED 如实转人工——不建设通用文档平台，
//   不写 OCR/ASR（无获准提供方，感知能力保留 BLOCKED，不 mock）。
// - 支持一种格式必须用原始文件测试：本模块消费原始字节（Buffer），不消费预填 declaredFacts。
// - 解析只产出"带来源的结构化行/聚合+声明事实候选"：机器可从原件确定性提取的数值
//   = source_supported（绑定原件哈希+parserVersion+行引用）；自由文本声明 = declared。
//   银行流水聚合强制附"入账≠经营收入"口径注记；聚合不做设备匹配、不产出诚信结论。
// - 期间对齐只定位差异（qualityFlags.period_mismatch），不自动改写声明期间、不下结论。
// - 同输入字节+同元数据 → 恒同输出（确定性；上游按此做解析缓存键）。

import { stableHash } from '../../domains/util.mjs';

export const PARSE_ADAPTERS_VERSION = 'parse-adapters@1';

/** 银行流水聚合强制口径注记（C/intake CALIBER_NOTES 同源）。 */
const BANK_CALIBER_NOTE = '银行流水口径：全部入账不直接当经营收入；与申报收入的口径差属待核验差异，不是自动欺诈结论';

const UNSUPPORTED = {
  pdf: { magic: [0x25, 0x50, 0x44, 0x46], name: 'pdf' },          // %PDF
  png: { magic: [0x89, 0x50, 0x4e, 0x47], name: 'png' },
  jpg: { magic: [0xff, 0xd8, 0xff], name: 'jpg' },
  gif: { magic: [0x47, 0x49, 0x46, 0x38], name: 'gif' },
  zip: { magic: [0x50, 0x4b, 0x03, 0x04], name: 'zip' },          // 容器：协调层解包，不在此解析
  docx: { magic: [0x50, 0x4b, 0x03, 0x04], name: 'docx' },        // 同 zip 魔数：容器族
};

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

/** 魔数识别（唯一真相，扩展名仅辅助）；zip/docx 容器族返回 container。 */
export function detectFormat(buf, { fileName = '', contentType = '' } = {}) {
  for (const info of Object.values(UNSUPPORTED)) {
    if (startsWithMagic(buf, info.magic)) {
      return { family: info.name === 'zip' || info.name === 'docx' ? 'container' : info.name, name: info.name };
    }
  }
  const ext = extOf(fileName);
  if (ext === '.tsv') return { family: 'csv', name: 'tsv', delimiter: '\t' };
  if (ext === '.csv') return { family: 'csv', name: 'csv' };
  const text = decodeText(buf);
  if (text != null) {
    if (ext === '.txt') return { family: 'text', name: 'txt' };
    const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
    if (/[\t;]/.test(firstLine) || /,/.test(firstLine)) return { family: 'csv', name: 'csv' };
    return { family: 'text', name: 'txt' };
  }
  return { family: 'unknown', name: 'unknown' };
}

function splitLine(line, delim) {
  if (delim) return line.split(delim).map((c) => c.trim());
  // 单一分隔符嗅探：制表 > 分号 > 逗号（取首行出现者；引号内分隔符不在本适配器契约内）
  for (const d of ['\t', ';', ',']) if (line.includes(d)) return line.split(d).map((c) => c.trim());
  return [line.trim()];
}

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

/** 在前 5 行内找表头行；返回 {rowIndex, map:{field:col}} 或 null。 */
function findHeaderRow(lines, delim) {
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const cells = splitLine(lines[i], delim).map(normHeader);
    const map = {};
    for (const [field, aliases] of Object.entries(HEADER_MAP)) {
      const col = cells.findIndex((c) => aliases.includes(c));
      if (col >= 0) map[field] = col;
    }
    if (map.date != null && (map.inflow != null || map.outflow != null)) return { rowIndex: i, map, delim };
  }
  return null;
}

function parseNumCell(s) {
  if (s == null) return null;
  const t = String(s).replace(/[,\s￥¥]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function normDate(s) {
  const t = String(s ?? '').trim().replace(/\//g, '-').replace(/\./g, '-');
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function monthOf(dateStr) { return dateStr ? dateStr.slice(0, 7) : null; }

/**
 * CSV/TSV 银行流水解析：行级确定性提取 + 聚合。
 * 聚合事实（source_supported）只描述流水本身（流入/流出合计），不映射经营收入。
 */
export function parseBankStatementCsv(text, { delimiter = null } = {}) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const head = findHeaderRow(lines, delimiter);
  if (!head) return { ok: false, code: 'PARSE_FAILED', detail: '未识别出银行流水表头（日期+收入/支出列）' };
  const { rowIndex, map, delim } = head;
  const rows = [];
  const badRows = [];
  for (let i = rowIndex + 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], delim);
    const date = normDate(cells[map.date]);
    const inflow = map.inflow != null ? parseNumCell(cells[map.inflow]) : null;
    const outflow = map.outflow != null ? parseNumCell(cells[map.outflow]) : null;
    const balance = map.balance != null ? parseNumCell(cells[map.balance]) : null;
    const memo = map.memo != null ? (cells[map.memo] ?? null) : null;
    if (date == null || (inflow == null && outflow == null)) {
      badRows.push({ line: i + 1, detail: '日期或金额不可解析' });
      continue;
    }
    rows.push({ line: i + 1, date, inflow: inflow ?? 0, outflow: outflow ?? 0, balance, memo });
  }
  if (rows.length === 0) return { ok: false, code: 'PARSE_FAILED', detail: '表头后无有效数据行', badRows };
  const dates = rows.map((r) => r.date).sort();
  const inflowTotal = rows.reduce((a, r) => a + r.inflow, 0);
  const outflowTotal = rows.reduce((a, r) => a + r.outflow, 0);
  const monthCount = new Set(rows.map((r) => monthOf(r.date))).size;
  return {
    ok: true,
    format: 'bank_statement_csv',
    parserVersion: `${PARSE_ADAPTERS_VERSION}:bank-statement@1`,
    rows,
    badRows,
    aggregates: {
      rowCount: rows.length,
      badRowCount: badRows.length,
      periodStart: dates[0],
      periodEnd: dates[dates.length - 1],
      monthCount,
      inflowTotal: Number(inflowTotal.toFixed(2)),
      outflowTotal: Number(outflowTotal.toFixed(2)),
    },
    caliberNote: BANK_CALIBER_NOTE,
  };
}

/** key,value / key = value / key: value 声明事实提取（declared 级：内容是上传者的申报）。 */
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
    const num = parseNumCell(rawVal);
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

/**
 * 统一入口：原始字节 + 声明元数据 → 解析产物（或如实失败）。
 * @param p.meta {fileName, contentType, periodFrom, periodTo, currency, unit, caliber, subjectId}
 */
export function parseArtifactBytes(buf, meta = {}) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return { ok: false, code: 'PARSE_FAILED', detail: '空字节/非 Buffer：不可读，不编数', manualEntry: true };
  }
  const fmt = detectFormat(buf, meta);
  if (fmt.family === 'container') {
    return { ok: false, code: 'IS_CONTAINER', detail: 'ZIP 容器：由协调层安全解包后逐 entry 重入', format: 'zip' };
  }
  if (fmt.family !== 'csv' && fmt.family !== 'text') {
    return {
      ok: false, code: 'FORMAT_UNSUPPORTED',
      detail: `格式 ${fmt.name} 不在解析白名单（csv/tsv/txt）：转人工入口，不推断内容`,
      manualEntry: true, format: fmt.name,
    };
  }
  const text = decodeText(buf);
  if (text == null) {
    return { ok: false, code: 'PARSE_FAILED', detail: 'UTF-8 解码失败（二进制或非 UTF-8 编码）：转人工', manualEntry: true };
  }

  if (fmt.family === 'csv') {
    const bank = parseBankStatementCsv(text, { delimiter: fmt.delimiter ?? null });
    if (bank.ok) {
      const qualityFlags = checkPeriodMismatch(meta, bank.aggregates);
      const facts = [
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
      return {
        ok: true, format: bank.format, parserVersion: bank.parserVersion, text,
        rows: bank.rows, aggregates: bank.aggregates, declaredFacts: facts,
        qualityFlags, badRows: bank.badRows, caliberNote: bank.caliberNote,
        parseId: `prs-${stableHash({ sha: stableHash(text), v: bank.parserVersion }).slice(0, 16)}`,
      };
    }
    // 非银行流水 CSV → key,value 声明表
    const { facts, problems } = extractKeyValueFacts(text);
    if (facts.length === 0) {
      return { ok: false, code: 'PARSE_FAILED', detail: 'CSV 既非银行流水表头也无可解析的 key,value 行', problems, manualEntry: true };
    }
    return {
      ok: true, format: 'keyvalue_csv',
      parserVersion: `${PARSE_ADAPTERS_VERSION}:keyvalue-csv@1`, text,
      declaredFacts: facts.map((f) => ({
        factKey: f.factKey, value: f.value, verificationLevel: 'declared',
        unit: meta.unit ?? null, caliber: meta.caliber ?? null, sourceRefs: [f.line],
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

/** 解析缓存键（协调层持久化用）：不跨客户共用，绑定处理版本。 */
export function parseCacheKey({ tenantId, customerId, sha256, parserVersion }) {
  for (const [k, v] of Object.entries({ tenantId, customerId, sha256, parserVersion })) {
    if (!v || typeof v !== 'string') throw Object.assign(new Error(`parseCacheKey 缺 ${k}`), { code: 'PARSE_KEY_INCOMPLETE' });
  }
  return `pc-${stableHash({ tenantId, customerId, sha256, parserVersion }).slice(0, 24)}`;
}
