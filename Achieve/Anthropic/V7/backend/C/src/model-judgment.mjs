// V7 Lane C · 模型判断编排（规则前置门 → 注入 provider → 结构/依据/数值/不确定四类校验）。
// 职责边界：
// - 机械前置门（model 调用前）：rule_not_covered / missing_input / evidence_conflict / caliber_change
//   —— 命中即 human_required，不调用模型（升级短路，如实记录 providerPhase='not_called'）。
// - 模型调用经注入 provider（B 路网关或模拟桩）；未发送→human_required/call_not_sent；
//   发送后不可知→unknown（绝不自动重试为成功）。
// - 模型输出四类校验：①结构+authority 措辞（candidate-schema）②依据 grounding（引用存在且未被取代）
//   ③数值一致性（观察中引用的覆盖率必须与工具输出一致）④不确定下限（外部机械信号独立于模型自报置信）。
// 输出为判断记录（映射 ExperimentRecord.model / 升级理由），authority=none。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCandidate } from './candidate-schema.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(HERE, '..', 'prompts', 'candidate-prompt-v1.md');
export const PROMPT_VERSION = 'candidate-prompt-v1';

/** 组装提示词（模板读取一次缓存；占位替换后返回 { text, sha 留给调用方取证 }）。 */
let promptTemplateCache = null;
export function buildCandidatePrompt({ rulePack, facts, calc, requestId }) {
  if (promptTemplateCache === null) promptTemplateCache = readFileSync(PROMPT_PATH, 'utf8');
  const text = promptTemplateCache
    .replaceAll('{{RULE_VERSION}}', rulePack.version)
    .replaceAll('{{RULE_SCOPE.indicators}}', rulePack.scope.indicators.join('、'))
    .replaceAll('{{RULE_SCOPE.requiredEvidenceFields}}', rulePack.scope.requiredEvidenceFields.join('、'))
    .replaceAll('{{FACT_VERSION}}', String(facts.factVersion))
    .replaceAll('{{FACTS_JSON}}', JSON.stringify(facts.evidence, null, 2))
    .replaceAll('{{CALC_JSON}}', JSON.stringify(calc ?? { refused: true }, null, 2))
    .replaceAll('{{REQUEST_ID}}', requestId);
  return { text, promptVersion: PROMPT_VERSION, ruleVersion: rulePack.version, factVersion: facts.factVersion };
}

/**
 * 执行一次模型辅助判断。
 * @param {object} args
 * @param {object} args.rulePack 已加载规则包（loadRulePack 的产物）
 * @param {{ factVersion:number, evidence: Array<{ evidenceId:string, version:number, supersededBy:string|null, indicator?:string, caliber?:string, value?:number, content?:string }> }} args.facts
 * @param {object|null} args.calc calculation-tool 的返回（{ ok, result|error }）
 * @param {(req:{ prompt:string, requestId:string }) => Promise<ProviderOutcome>} args.provider 注入的模型通道
 * @param {string} args.requestId 请求标识（幂等由调用方/存储负责；本模块不重试）
 * @returns {Promise<JudgmentRecord>}
 */
export async function runModelJudgment({ rulePack, facts, calc, provider, requestId }) {
  const record = {
    requestId,
    ruleVersion: rulePack.version,
    factVersion: facts.factVersion,
    promptVersion: PROMPT_VERSION,
    providerPhase: 'not_called',
    status: 'human_required',
    reason: null,
    reasons: [],
    candidate: null,
    checks: { precondition: null, schema: null, grounding: null, calcConsistency: null, uncertaintyFloor: null },
  };

  // ---- 机械前置门（不调用模型） ----
  const pre = preconditionChecks(rulePack, facts, calc);
  record.checks.precondition = pre;
  if (pre.escalation !== null) {
    record.reason = pre.escalation;
    record.reasons = pre.notes;
    return record;
  }

  // ---- 调用模型（receipt 语义，不重试） ----
  const prompt = buildCandidatePrompt({ rulePack, facts, calc, requestId });
  let outcome;
  try {
    outcome = await provider({ prompt: prompt.text, requestId });
  } catch (e) {
    // provider 抛异常视为未发送（无回执即无发送证据），如实区分，不伪造 unknown。
    record.providerPhase = 'not_sent';
    record.reason = 'call_not_sent';
    record.reasons = [{ code: 'PROVIDER_THREW', detail: String(e?.message ?? e) }];
    return record;
  }

  if (outcome === null || typeof outcome !== 'object') {
    record.providerPhase = 'not_sent';
    record.reason = 'call_not_sent';
    record.reasons = [{ code: 'PROVIDER_INVALID_RETURN', detail: 'provider 返回非对象' }];
    return record;
  }
  if (outcome.ok !== true) {
    if (outcome.phase === 'sent_unknown') {
      record.providerPhase = 'sent_unknown';
      record.status = 'unknown';
      record.reason = 'call_unknown';
      record.reasons = [{ code: outcome.code ?? 'INDETERMINATE', detail: outcome.message ?? '发送后结果不可知' }];
      return record;
    }
    record.providerPhase = 'not_sent';
    record.reason = 'call_not_sent';
    record.reasons = [{ code: outcome.code ?? 'NOT_SENT', detail: outcome.message ?? '请求未发出' }];
    return record;
  }
  record.providerPhase = 'ok';
  if (typeof outcome.receiptId === 'string' && outcome.receiptId !== '') record.requestReceipt = outcome.receiptId;

  // ---- ① 结构 + authority 措辞 ----
  const parsed = parseCandidateJson(outcome.text);
  if (!parsed.ok) {
    record.reason = 'model_output_invalid';
    record.reasons = [{ code: 'JSON_PARSE', detail: parsed.detail }];
    return record;
  }
  const schema = validateCandidate(parsed.value);
  record.checks.schema = { ok: schema.ok, reasons: schema.ok ? [] : schema.reasons };
  if (!schema.ok) {
    record.reason = 'model_output_invalid';
    record.reasons = schema.reasons;
    return record;
  }
  record.candidate = schema.candidate;

  // ---- ② 依据 grounding ----
  const grounding = checkGrounding(schema.candidate, facts);
  record.checks.grounding = grounding;
  if (!grounding.ok) {
    record.reason = grounding.failure;
    record.reasons = grounding.issues;
    return record;
  }

  // ---- ③ 数值一致性（引用覆盖率必须等于工具输出） ----
  const consistency = checkCalcConsistency(schema.candidate, calc);
  record.checks.calcConsistency = consistency;
  if (!consistency.ok) {
    record.reason = 'calc_mismatch';
    record.reasons = consistency.issues;
    return record;
  }

  // ---- ④ 不确定下限（外部机械信号，不看模型自报置信） ----
  const floor = uncertaintyFloorSignals(facts, calc);
  const stated = schema.candidate.uncertainty.length;
  const floorOk = floor.required === 0 ? true : stated >= floor.required;
  record.checks.uncertaintyFloor = { ok: floorOk, requiredMinimum: floor.required, stated, signals: floor.signals };
  if (!floorOk) {
    record.reason = 'uncertainty_understatement';
    record.reasons = [{ code: 'UNCERTAINTY_FLOOR', detail: `机械信号 ${JSON.stringify(floor.signals)} 要求不确定声明≥${floor.required} 条，实际 ${stated} 条` }];
    return record;
  }

  record.status = 'candidate_ready';
  return record;
}

/** 机械前置门：工具在允许清单、计算成功、同口径无矛盾、同指标口径一致。 */
function preconditionChecks(rulePack, facts, calc) {
  const notes = [];
  // 工具身份可来自成功结果或显式拒绝（error.toolVersion）——拒绝也要先确认是"允许清单内工具的拒绝"。
  const toolVersion = calc?.result?.toolVersion ?? calc?.error?.toolVersion ?? '';
  const toolAllowed = rulePack.scope.allowedTools.includes(toolVersion);
  if (!toolAllowed) {
    notes.push({ code: 'TOOL_NOT_ALLOWED', detail: `计算工具 ${toolVersion || '缺失'} 不在规则允许清单` });
    return { escalation: 'rule_not_covered', notes };
  }
  if (calc !== null && calc.ok === false) {
    const refusalCodes = ['MISSING_INPUT', 'MISSING_CALIBER', 'INVALID_CURRENCY', 'NONPOSITIVE_DEBT_SERVICE', 'INVALID_PERIOD'];
    if (refusalCodes.includes(calc.error.code)) {
      notes.push({ code: calc.error.code, detail: calc.error.message });
      return { escalation: 'missing_input', notes };
    }
  }
  const numeric = facts.evidence.filter((e) => typeof e.indicator === 'string' && typeof e.value === 'number');
  const byIndicator = new Map();
  for (const e of numeric) {
    if (!rulePack.scope.indicators.includes(e.indicator)) {
      notes.push({ code: 'INDICATOR_OUT_OF_SCOPE', detail: `指标 ${e.indicator} 不在规则范围` });
      return { escalation: 'rule_not_covered', notes };
    }
    if (!byIndicator.has(e.indicator)) byIndicator.set(e.indicator, []);
    byIndicator.get(e.indicator).push(e);
  }
  for (const [indicator, list] of byIndicator) {
    const live = list.filter((e) => e.supersededBy === null);
    const calibers = [...new Set(live.map((e) => e.caliber).filter(Boolean))];
    if (calibers.length > 1) {
      notes.push({ code: 'CALIBER_DIFF', detail: `指标 ${indicator} 存在多个口径：${calibers.join(' / ')}，无声明换算` });
      return { escalation: 'caliber_change', notes };
    }
    const values = [...new Set(live.filter((e) => typeof e.caliber === 'string').map((e) => e.value))];
    if (live.length > 1 && values.length > 1) {
      notes.push({ code: 'VALUE_CONFLICT', detail: `指标 ${indicator} 同口径数值不一致：${values.join(' vs ')}，无取代关系` });
      return { escalation: 'evidence_conflict', notes };
    }
  }
  return { escalation: null, notes };
}

/** 依据校验：按 evidenceId+version 精确匹配；被取代版本引用单独归因 superseded_evidence_cited。 */
function checkGrounding(candidate, facts) {
  const issues = [];
  let superseded = false;
  for (const ref of candidate.evidenceRefs) {
    const sameId = facts.evidence.filter((e) => e.evidenceId === ref.evidenceId);
    if (sameId.length === 0) {
      issues.push({ code: 'REF_NOT_FOUND', detail: `引用不存在的证据：${ref.evidenceId}` });
      continue;
    }
    const exact = sameId.find((e) => e.version === ref.version);
    if (exact === undefined) {
      issues.push({ code: 'REF_VERSION_MISMATCH', detail: `${ref.evidenceId} 引用 v${ref.version}，当前事实仅含版本 ${sameId.map((e) => e.version).join('/')}` });
      continue;
    }
    if (exact.supersededBy !== null && exact.supersededBy !== undefined) {
      superseded = true;
      issues.push({ code: 'REF_SUPERSEDED', detail: `${ref.evidenceId} v${ref.version} 已被 ${exact.supersededBy} 取代` });
    }
  }
  if (issues.length === 0) return { ok: true, issues: [] };
  return { ok: false, failure: superseded ? 'superseded_evidence_cited' : 'model_output_invalid', issues };
}

/** 数值一致性：观察中“覆盖/ratio”邻近数字必须与工具 ratio 一致（容差 1e-9；未引用数值不判罚）。 */
function checkCalcConsistency(candidate, calc) {
  const issues = [];
  const ratio = calc?.ok === true ? calc.result.ratio : null;
  const texts = candidate.observations ?? [];
  let cited = 0;
  const re = /(?:覆盖|比率|ratio|coverage)[^\d\-]{0,8}(-?\d+(?:\.\d+)?)/gi;
  for (const text of texts) {
    for (const m of text.matchAll(re)) {
      cited += 1;
      const citedNum = Number(m[1]);
      if (ratio === null || Math.abs(citedNum - ratio) > 1e-9) {
        issues.push({ code: 'RATIO_MISMATCH', detail: `观察引用覆盖率 ${citedNum}，工具输出 ${String(ratio)}` });
      }
    }
  }
  return { ok: issues.length === 0, issues, citedCount: cited };
}

/** 不确定下限的机械信号（独立于模型自报）：口径不同、负分子、输入来自不同证据、历史存在取代关系。 */
function uncertaintyFloorSignals(facts, calc) {
  const signals = {};
  if (calc?.ok === true) {
    signals.differentCalibers = calc.result.assumptions.some((a) => a.includes('口径不同'));
    signals.negativeNumerator = calc.result.ratio < 0;
    const srcs = new Set([
      calc.result.inputs.monthlyOperatingCashFlow.source.evidenceId,
      calc.result.inputs.monthlyDebtService.source.evidenceId,
    ]);
    signals.inputsFromDifferentEvidence = srcs.size > 1;
  }
  signals.supersededInHistory = facts.evidence.some((e) => e.supersededBy !== null && e.supersededBy !== undefined);
  const required = Object.values(signals).some(Boolean) ? 1 : 0;
  return { signals, required };
}

/** 从模型文本中解析候选 JSON（容忍 ```json 围栏；其余不合格）。 */
function parseCandidateJson(text) {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, detail: '模型输出为空' };
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence !== null) raw = fence[1];
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, detail: `JSON 解析失败：${String(e.message)}` };
  }
}

/**
 * @typedef {Object} ProviderOutcome
 * @property {boolean} ok
 * @property {'not_sent'|'sent_unknown'} [phase]
 * @property {string} [receiptId] 发送成功时的请求回执
 * @property {string} [text] 模型原始文本（不得含密钥；由 provider 层保证）
 * @property {string} [code]
 * @property {string} [message]
 */
/**
 * @typedef {Object} JudgmentRecord
 * @property {string} requestId
 * @property {string} ruleVersion
 * @property {number} factVersion
 * @property {string} promptVersion
 * @property {'not_called'|'ok'|'not_sent'|'sent_unknown'} providerPhase
 * @property {'candidate_ready'|'human_required'|'unknown'|'failed'} status
 * @property {string|null} reason
 * @property {Array<{code:string,detail:string}>} reasons
 * @property {object|null} candidate
 * @property {object} checks
 */
