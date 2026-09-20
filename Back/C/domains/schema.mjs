// 任务 03 · S1 输出契约：AnalysisRun / DomainAssessment 结构校验（C 路四域模块）。
// 边界（任务书 §3）：
// - 模型/分析输出恒为候选，authority 恒为 'none'；本模块在结构层拒绝任何非 none 声明。
// - “置信度 0.9”不是风险概率：schema 层不收 confidence 数值字段，分析层不做阈值放行。
// - 关键发现必须定位到材料页/字段或媒体时间片段；定位缺失只能作为假设，不得标已核验。
// 本文件为确定性纯校验，无 IO，无第三方依赖（对齐 C 路零依赖纪律）。

// TAKEOFF-FA-1.0.0（03路）：五列=商机/政策/信审/商务/资产；business 为加法扩展，
// 旧四域消费方按包含关系兼容（四域 ⊂ 五域），列顺序对齐看板五列。
export const DOMAINS = Object.freeze(['business', 'policy', 'credit', 'commerce', 'asset']);

/** TAKEOFF 前四域（兼容消费方：仍按旧四域语义工作的面可引用此常量）。 */
export const LEGACY_FOUR_DOMAINS = Object.freeze(['policy', 'credit', 'commerce', 'asset']);

/** 证据核验等级（由低到高）；等级语义对齐规则包 v2 evidence_five_grades。 */
export const VERIFICATION_LEVELS = Object.freeze(['unknown', 'declared', 'source_supported', 'verified']);
export const EXECUTION_STATUSES = Object.freeze([
  'completed', 'failed', 'timeout', 'not_configured', 'input_invalid',
]);
export const PROVIDER_MODES = Object.freeze(['simulation', 'real_http', 'calculation', 'deterministic']);
export const GATE_RESULTS = Object.freeze(['CLEAR', 'NEEDS_EVIDENCE', 'HOLD_FOR_REVIEW', 'HARD_BLOCK']);

function isStr(v) { return typeof v === 'string' && v.trim().length > 0; }
function isStrArray(v) { return Array.isArray(v) && v.every(isStr); }

/**
 * 校验 AnalysisRun（一次域分析执行的元数据）。
 * 必填：runId/customerId/sessionId/domain/providerMode/modelVersion/promptHash/
 *       rulesetVersion/inputSnapshotId/inputHash/inputWatermark/startedAt/executionStatus。
 * usage 可为 null（无外部调用）；completedAt 仅 executionStatus=completed 时必填。
 */
export function validateAnalysisRun(value) {
  const reasons = [];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reasons: [{ code: 'NOT_OBJECT', detail: 'AnalysisRun 必须为对象' }] };
  }
  for (const k of ['runId', 'customerId', 'sessionId', 'inputSnapshotId', 'inputHash', 'startedAt']) {
    if (!isStr(value[k])) reasons.push({ code: 'MISSING_FIELD', detail: `AnalysisRun.${k} 必须为非空字符串` });
  }
  // inputWatermark：非空字符串或非空对象（水位含 generation/材料哈希表）
  const wm = value.inputWatermark;
  const wmOk = isStr(wm) || (wm !== null && typeof wm === 'object' && !Array.isArray(wm) && Object.keys(wm).length > 0);
  if (!wmOk) reasons.push({ code: 'MISSING_FIELD', detail: 'AnalysisRun.inputWatermark 必须为非空字符串或非空对象' });
  if (!DOMAINS.includes(value.domain)) reasons.push({ code: 'INVALID_FIELD', detail: `domain 必须为 ${DOMAINS.join('/')}` });
  if (!PROVIDER_MODES.includes(value.providerMode)) reasons.push({ code: 'INVALID_FIELD', detail: `providerMode 必须为 ${PROVIDER_MODES.join('/')}` });
  if (!isStr(value.modelVersion)) reasons.push({ code: 'MISSING_FIELD', detail: 'modelVersion 必须为非空字符串（deterministic 管线亦须声明版本）' });
  if (!isStr(value.promptHash)) reasons.push({ code: 'MISSING_FIELD', detail: 'promptHash 必须为非空字符串（确定性管线=逻辑指纹）' });
  if (!isStr(value.rulesetVersion)) reasons.push({ code: 'MISSING_FIELD', detail: 'rulesetVersion 必须为非空字符串' });
  if (!EXECUTION_STATUSES.includes(value.executionStatus)) {
    reasons.push({ code: 'INVALID_FIELD', detail: `executionStatus 必须为 ${EXECUTION_STATUSES.join('/')}` });
  }
  if (value.executionStatus === 'completed' && !isStr(value.completedAt)) {
    reasons.push({ code: 'MISSING_FIELD', detail: 'executionStatus=completed 时 completedAt 必填' });
  }
  if (value.usage !== null && value.usage !== undefined) {
    if (typeof value.usage !== 'object' || Array.isArray(value.usage)) {
      reasons.push({ code: 'INVALID_FIELD', detail: 'usage 必须为对象或 null' });
    } else if (value.usage.externalCalls !== undefined && !(Number.isInteger(value.usage.externalCalls) && value.usage.externalCalls >= 0)) {
      reasons.push({ code: 'INVALID_FIELD', detail: 'usage.externalCalls 必须为非负整数' });
    }
  }
  return reasons.length === 0 ? { ok: true, value } : { ok: false, reasons };
}

/**
 * 定位引用：evidenceRef 必须可回溯到材料（materialId）并带页/字段或时间片段定位；
 * 无定位 = 只能作为假设（located=false），调用方不得据此标“已核验”。
 */
export function validateEvidenceRef(ref) {
  const reasons = [];
  if (ref === null || typeof ref !== 'object' || Array.isArray(ref)) {
    return { ok: false, located: false, reasons: [{ code: 'NOT_OBJECT', detail: 'evidenceRef 必须为对象' }] };
  }
  if (!isStr(ref.materialId)) reasons.push({ code: 'MISSING_FIELD', detail: 'evidenceRef.materialId 必填' });
  const loc = ref.location ?? null;
  let located = false;
  if (loc !== null) {
    if (typeof loc !== 'object' || Array.isArray(loc)) {
      reasons.push({ code: 'INVALID_FIELD', detail: 'location 必须为对象' });
    } else if (isStr(loc.page) || isStr(loc.field) || isStr(loc.timeSpan)) {
      located = true;
    } else {
      reasons.push({ code: 'INVALID_FIELD', detail: 'location 至少含 page/field/timeSpan 之一' });
    }
  }
  return { ok: reasons.length === 0, located, reasons };
}

/**
 * 校验 DomainAssessment（四域候选意见）。
 * 必填字段对齐任务书 §3 模型输出契约；authority 必须= 'none'（结构性，拒绝任何越权声明）。
 * 关键发现（findings）每条必须带 evidenceRefs；无定位的发现自动降级为 hypothesis（不标已核验）。
 */
export function validateDomainAssessment(value) {
  const reasons = [];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, value: null, reasons: [{ code: 'NOT_OBJECT', detail: 'DomainAssessment 必须为对象' }] };
  }
  for (const k of ['findingType', 'summary']) {
    if (!isStr(value[k])) reasons.push({ code: 'MISSING_FIELD', detail: `DomainAssessment.${k} 必须为非空字符串` });
  }
  if (!DOMAINS.includes(value.domain)) reasons.push({ code: 'INVALID_FIELD', detail: `domain 必须为 ${DOMAINS.join('/')}` });
  if (value.authority !== 'none') {
    reasons.push({ code: 'AUTHORITY_VIOLATION', detail: `authority 必须恒为 'none'（收到 ${JSON.stringify(value.authority ?? null)}）` });
  }
  if (typeof value.stale !== 'boolean') reasons.push({ code: 'INVALID_FIELD', detail: 'stale 必须为布尔' });

  const refs = Array.isArray(value.evidenceRefs) ? value.evidenceRefs : null;
  if (refs === null) reasons.push({ code: 'INVALID_FIELD', detail: 'evidenceRefs 必须为数组' });
  let locatedCount = 0;
  const locatedRefs = [];
  if (refs) {
    refs.forEach((r, i) => {
      const v = validateEvidenceRef(r);
      if (!v.ok) reasons.push(...v.reasons.map((x) => ({ ...x, detail: `evidenceRefs[${i}]: ${x.detail}` })));
      if (v.located) locatedCount += 1;
      locatedRefs.push(v.located);
    });
  }

  for (const k of ['knownFacts', 'unknowns', 'contradictions']) {
    if (!Array.isArray(value[k])) reasons.push({ code: 'INVALID_FIELD', detail: `${k} 必须为数组` });
  }
  if (Array.isArray(value.contradictions)) {
    value.contradictions.forEach((c, i) => {
      if (c === null || typeof c !== 'object' || !isStr(c.factKey) || !Array.isArray(c.values)) {
        reasons.push({ code: 'INVALID_FIELD', detail: `contradictions[${i}] 必须为 { factKey, values[] }` });
      }
    });
  }
  if (!Array.isArray(value.proposedQuestions)) reasons.push({ code: 'INVALID_FIELD', detail: 'proposedQuestions 必须为数组' });
  if (!Array.isArray(value.proposedActions)) reasons.push({ code: 'INVALID_FIELD', detail: 'proposedActions 必须为数组' });
  if (Array.isArray(value.proposedActions)) {
    value.proposedActions.forEach((a, i) => {
      if (a === null || typeof a !== 'object' || !isStr(a.action)) {
        reasons.push({ code: 'INVALID_FIELD', detail: `proposedActions[${i}] 必须为 { action, ... }` });
      }
    });
  }
  if (value.confidence !== undefined) {
    reasons.push({ code: 'CONFIDENCE_FORBIDDEN', detail: '不收 confidence：模型置信度不是风险概率，禁止进入阈值判断' });
  }

  const ok = reasons.length === 0;
  // 结构合法时回写定位降级信息：无定位的引用在 findings 内只能作假设
  return ok
    ? { ok: true, value: { ...value, _locatedRefCount: locatedCount, _refLocated: locatedRefs } }
    : { ok: false, value: null, reasons };
}

/**
 * 校验一个域的完整分析包（AnalysisRun + DomainAssessment 成对）。
 * inputSnapshotId/inputHash 必须与快照一致：四域必须消费同一可追溯输入（任务书 §9 E1）。
 */
export function validateDomainAnalysis({ analysisRun, assessment }, snapshot) {
  const r1 = validateAnalysisRun(analysisRun);
  const r2 = validateDomainAssessment(assessment);
  const reasons = [...(r1.ok ? [] : r1.reasons.map((x) => ({ ...x, detail: `analysisRun: ${x.detail}` }))),
    ...(r2.ok ? [] : r2.reasons.map((x) => ({ ...x, detail: `assessment: ${x.detail}` })))];
  if (r1.ok && r2.ok && snapshot) {
    if (analysisRun.inputSnapshotId !== snapshot.snapshotId) {
      reasons.push({ code: 'SNAPSHOT_MISMATCH', detail: `analysisRun.inputSnapshotId(${analysisRun.inputSnapshotId}) ≠ 快照 ${snapshot.snapshotId}` });
    }
    if (analysisRun.inputHash !== snapshot.inputHash) {
      reasons.push({ code: 'SNAPSHOT_MISMATCH', detail: 'analysisRun.inputHash 与快照 inputHash 不一致：四域必须消费同一可追溯输入' });
    }
    if (analysisRun.domain !== assessment.domain) {
      reasons.push({ code: 'DOMAIN_MISMATCH', detail: 'analysisRun.domain 与 assessment.domain 不一致' });
    }
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
