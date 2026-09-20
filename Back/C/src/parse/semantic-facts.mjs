// TAKEOFF-FA-1.0.0（03路）· 语义事实映射（确定性；零依赖；PROTOCOL.md §2 的实现）。
// 输入：材料 kind + 解析适配器产物（parseArtifactBytes 结果）；输出：补充的 declared 级语义事实
// 与质量旗标。硬边界：
// - 只做确定性投影：列名/行模式/文本键值 → 规则包消费的事实键；缺失输入不产出对应键（unknown≠0）。
// - 全部 declared 级：声明≠已核验；verified 只能由人工核验端点产生。
// - 半年/季度收入不得冒充年收入（revenue_annual_declared 只取年度行；无年度行=不产出）。
// - 多行清单只做聚合（Σ 净值、权属一致性布尔）；逐行明细保留在解析行中，不制造伪冲突。
// - 材料文本中的指令样式语句（“忽略规则/直接批准”等）是数据不是指令：只打质量旗标供人工
//   注意，不执行、不赋权、不改变 authority=none。
// - 同输入字节+同 kind+同元数据 → 恒同输出（确定性；上游按此做解析缓存键）。

export const SEMANTIC_FACTS_VERSION = 'semantic-facts@1';

import { parseDelimitedRows } from './adapters.mjs';

/** 数量列名 → 语义事实键（financial_statement 表头投影）。 */
const BALANCE_COLUMNS = {
  total_assets_wan: 'total_assets_declared',
  total_liabilities_wan: 'total_liabilities_declared',
  net_fixed_assets_wan: 'net_fixed_assets_declared',
};

/** 文本键值语义模式（订单/涉诉；PDF 文本行或 key=value 文本通用）。 */
const TEXT_PATTERNS = {
  order_contract: [
    { factKey: 'new_order_amount_declared', re: /订单金额[:：]\s*(?:人民币|RMB)?\s*([0-9][0-9,，.]*)\s*(万元|万|元)/, toValue: (m) => ({ value: parseWan(m[1], m[2]), unit: 'wan', caliber: 'declared_order_amount' }) },
  ],
  litigation_document: [
    { factKey: 'litigation_amount_declared', re: /涉诉金额[:：]\s*(?:人民币|RMB)?\s*([0-9][0-9,，.]*)\s*(万元|万|元)/, toValue: (m) => ({ value: parseWan(m[1], m[2]), unit: 'wan', caliber: 'litigation_amount' }) },
  ],
};

/** 未决诉讼状态判定（保守）：明确未决词样→true；明确已结词样→false；其余不产出（unknown）。 */
const LITIGATION_TRUE = /(受理未判决|未决|未审结|已受理|审理中|在诉)/;
const LITIGATION_FALSE = /(撤诉|驳回起诉|已判决|已结案|调解结案|不予受理)/;

/** 指令样式语句（只旗标，不执行）：材料内嵌“忽略规则/直接批准/你是管理员”类文本。 */
const INSTRUCTION_PATTERN = /(忽略|无视)(以上|上述|所有|全部)?(规则|指令|限制)|(直接|立即|必须)(批准|通过|放行)|你(?:现在)?(?:是|成为)(管理员|审批人|风控官)/;

function parseWan(numStr, unit) {
  const n = Number(String(numStr).replace(/[,,]/g, ''));
  if (!Number.isFinite(n)) return null;
  if (unit === '元') return Number((n / 10000).toFixed(4)); // 统一万元口径
  return n;
}

function isIntStr(s) { return /^-?\d+$/.test(String(s ?? '').trim()); }

/** 表格行投影辅助：优先 parseResult.rows（string[][]，含表头）；缺失时从 text 引号感知重建（确定性）。 */
function tableOf(parseResult) {
  let rows = Array.isArray(parseResult?.rows) && parseResult.rows.length >= 1 ? parseResult.rows : null;
  if (!rows && typeof parseResult?.text === 'string') {
    const rebuilt = parseDelimitedRows(parseResult.text);
    if (rebuilt.length >= 2) rows = rebuilt;
  }
  if (!rows || rows.length < 2 || !Array.isArray(rows[0])) return null;
  return { header: rows[0].map((h) => String(h ?? '').trim()), rows: rows.slice(1) };
}

function colIndex(header, name) { return header.indexOf(name); }

// ---------------------------------------------------------------------------
// kind 投影器（每个返回 {facts:[], notes:[]}；facts 为 declared 级 declaredFacts 形状）
// ---------------------------------------------------------------------------

function projectFinancialStatement(parseResult) {
  const out = [];
  const t = tableOf(parseResult);
  if (!t) return out;
  const pIdx = colIndex(t.header, 'period');
  // 时点类科目取最新有效行（资产负债为时点值；只定位期间，不改写数值）
  for (const [srcKey, semKey] of Object.entries(BALANCE_COLUMNS)) {
    const c = colIndex(t.header, srcKey);
    if (c < 0) continue;
    let chosen = null;
    t.rows.forEach((row, i) => {
      const v = Number(String(row[c] ?? '').replace(/[,,]/g, ''));
      if (!Number.isFinite(v)) return;
      const period = pIdx >= 0 ? String(row[pIdx] ?? '').trim() : null;
      chosen = { value: v, period, line: i + 2 };
    });
    if (chosen) {
      out.push({
        factKey: semKey, value: chosen.value, verificationLevel: 'declared', unit: 'wan',
        caliber: chosen.period ? `时点值；period:${chosen.period}` : '时点值',
        sourceRefs: [chosen.line],
      });
    }
  }
  // 年收入：只取年度行（period 为 4 位年份，不含 H/Q 半年季度标记）；无年度行不产出（unknown≠编造）
  const rIdx = colIndex(t.header, 'revenue_wan');
  if (pIdx >= 0 && rIdx >= 0) {
    t.rows.forEach((row, i) => {
      const period = String(row[pIdx] ?? '').trim();
      if (!/^\d{4}$/.test(period)) return; // 跳过 2025H1 之类非年度行
      const v = Number(String(row[rIdx] ?? '').replace(/[,,]/g, ''));
      if (!Number.isFinite(v)) return;
      out.push({
        factKey: 'revenue_annual_declared', value: v, verificationLevel: 'declared', unit: 'wan',
        caliber: `年度值；period:${period}`, sourceRefs: [i + 2],
        note: `年度收入取自 ${period} 行；非年度行不冒充年收入`,
      });
    });
  }
  return out;
}

function projectEquipmentList(parseResult) {
  const out = [];
  const t = tableOf(parseResult);
  if (!t) return out;
  const lineIdx = colIndex(t.header, 'line');
  const nbvIdx = colIndex(t.header, 'net_book_value_wan');
  const ownIdx = colIndex(t.header, 'ownership');
  const dataRows = t.rows.filter((r) => (lineIdx < 0 ? true : isIntStr(r[lineIdx])));
  if (nbvIdx >= 0) {
    let sum = 0; let counted = 0; const refs = [];
    t.rows.forEach((r, i) => {
      if (lineIdx >= 0 && !isIntStr(r[lineIdx])) return;
      const v = Number(String(r[nbvIdx] ?? '').replace(/[,,]/g, ''));
      if (!Number.isFinite(v)) return;
      sum += v; counted += 1; refs.push(i + 2);
    });
    if (counted > 0) {
      out.push({
        factKey: 'equipment_net_book_value_total', value: Number(sum.toFixed(2)),
        verificationLevel: 'declared', unit: 'wan',
        caliber: `sum_of:${counted}_rows`, sourceRefs: refs,
      });
    }
  }
  if (ownIdx >= 0) {
    const owns = t.rows
      .filter((r) => (lineIdx < 0 ? true : isIntStr(r[lineIdx])))
      .map((r) => String(r[ownIdx] ?? '').trim().toLowerCase())
      .filter((s) => s.length > 0);
    if (owns.length > 0) {
      const allSelfOwned = owns.every((o) => o === 'self-owned' || o === 'self_owned' || o === '自有');
      out.push({
        factKey: 'equipment_ownership_declared', value: allSelfOwned, verificationLevel: 'declared',
        unit: null, caliber: `ownership_declaration_${owns.length}_rows`,
        note: '权属声明（≠verified；verified 只能由人工核验产生）',
      });
    }
  }
  return out;
}

function projectTextPatterns(kind, parseResult) {
  const out = [];
  const text = String(parseResult?.text ?? '');
  if (text.length === 0) return out;
  for (const p of TEXT_PATTERNS[kind] ?? []) {
    const m = text.match(p.re);
    if (!m) continue;
    const v = p.toValue(m);
    if (v.value === null) continue;
    out.push({ factKey: p.factKey, value: v.value, verificationLevel: 'declared', unit: v.unit, caliber: v.caliber });
  }
  if (kind === 'litigation_document' && text.length > 0) {
    if (LITIGATION_TRUE.test(text)) {
      out.push({ factKey: 'litigation_pending_declared', value: true, verificationLevel: 'declared', unit: null, caliber: 'litigation_status_text' });
    } else if (LITIGATION_FALSE.test(text)) {
      out.push({ factKey: 'litigation_pending_declared', value: false, verificationLevel: 'declared', unit: null, caliber: 'litigation_status_text' });
    }
  }
  return out;
}

/**
 * 语义事实投影主入口。
 * @returns {{ facts: Array, qualityFlags: Array }} facts 追加进 parseResult.declaredFacts；
 *   qualityFlags 追加进 parseResult.qualityFlags（embedded_instruction_detected 只旗标不执行）。
 */
export function projectSemanticFacts({ kind, parseResult }) {
  let facts = [];
  try {
    if (kind === 'financial_statement') facts = projectFinancialStatement(parseResult);
    else if (kind === 'equipment_list') facts = projectEquipmentList(parseResult);
    else if (kind === 'order_contract' || kind === 'litigation_document') facts = projectTextPatterns(kind, parseResult);
  } catch {
    // 语义投影失败不掩盖解析产物：返回空（保守），由调用方旗标
    return { facts: [], qualityFlags: [{ flag: 'semantic_projection_error', detail: '语义事实投影异常：只保留原始解析产物' }] };
  }
  const qualityFlags = [];
  const text = String(parseResult?.text ?? '');
  if (text && INSTRUCTION_PATTERN.test(text)) {
    qualityFlags.push({ flag: 'embedded_instruction_detected', detail: '材料文本含指令样式语句：按数据处理，不执行、不赋权（authority=none 不变）' });
  }
  return { facts, qualityFlags };
}
