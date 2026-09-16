// V7 Lane C · Candidate 结构校验与 authority 措辞扫描。
// 合同约束（R1 冻结 v0 / LONG_RUN_GOALS §C）：
// - Candidate 仅可含 observations/evidenceRefs/assumptions/uncertainty/recommendedHumanAction。
// - 禁止执行性审批措辞（作出批准/否决/定价/额度决定），但**不因讨论审批流程而拒绝判断**
//   （LONG_RUN_GOALS：不能只按词语命中粗暴拒绝所有判断）——扫描区分“执行性决定”与“流程性讨论”。
// 校验失败返回结构化原因列表；调用方（model-judgment）据此映射 human_required/model_output_invalid。
export const CANDIDATE_FIELDS = ['observations', 'evidenceRefs', 'assumptions', 'uncertainty', 'recommendedHumanAction'];
// 枚举对齐 CONTRACT v0 服务端实现（2026-09-15 实测：A 校验 accept_candidate/return_for_evidence/take_over/need_more_evidence；
// R1 草案的 'none' 未被 A 采纳——不存在"无需人工"出口，人工复核始终是下一站）。
export const HUMAN_ACTION_ENUM = ['accept_candidate', 'return_for_evidence', 'take_over', 'need_more_evidence'];

/** 执行性措辞模式：第一人称/系统主体 + 决定动词 + 宾语对象（对“人需审批”类流程讨论不命中）。 */
const PERFORMATIVE_PATTERNS = [
  { id: 'approval_decision', pattern: /(?:本系统|本工具|我们|笔者)?(?:据此|综上|因此)?(?:应当|应该|建议)?(?:批准|同意|否决|拒绝)(?:该|此|本)?(?:笔|项目|授信|申请|合同|租赁)/ },
  { id: 'quota_conclusion', pattern: /(?:额度|授信额度)(?:为|定为|应为|应定为)\s*[0-9一二三四五六七八九十百千万.]+/ },
  { id: 'pricing_conclusion', pattern: /(?:定价|费率|利率|租金)(?:为|定为|应为|应定为)\s*[0-9一二三四五六七八九十百千万.]+\s*(?:%|％|元|万|‰)?/ },
];

/**
 * 校验候选对象。
 * @returns {{ ok:true, candidate: object } | { ok:false, reasons: { code:string, detail:string }[] }}
 */
export function validateCandidate(value) {
  const reasons = [];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reasons: [{ code: 'NOT_OBJECT', detail: '候选必须为对象' }] };
  }
  const extra = Object.keys(value).filter((k) => !CANDIDATE_FIELDS.includes(k));
  if (extra.length > 0) reasons.push({ code: 'EXTRA_FIELD', detail: `含超出合同边界的字段：${extra.join('、')}` });
  const missing = CANDIDATE_FIELDS.filter((k) => !(k in value));
  if (missing.length > 0) reasons.push({ code: 'MISSING_FIELD', detail: `缺必需字段：${missing.join('、')}` });
  if (reasons.length > 0) return { ok: false, reasons };

  for (const key of ['observations', 'assumptions', 'uncertainty']) {
    const v = value[key];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
      reasons.push({ code: 'INVALID_FIELD', detail: `${key} 必须为字符串数组` });
    } else if (v.some((x) => x.trim() === '')) {
      reasons.push({ code: 'INVALID_FIELD', detail: `${key} 含空字符串项` });
    }
  }
  if (!Array.isArray(value.evidenceRefs)) {
    reasons.push({ code: 'INVALID_FIELD', detail: 'evidenceRefs 必须为数组' });
  } else {
    for (const ref of value.evidenceRefs) {
      if (typeof ref !== 'object' || ref === null || typeof ref.evidenceId !== 'string' || ref.evidenceId === '' || !Number.isInteger(ref.version)) {
        reasons.push({ code: 'INVALID_FIELD', detail: `evidenceRefs 项必须为 { evidenceId:string, version:int }，实际：${JSON.stringify(ref)}` });
      }
    }
  }
  if (!HUMAN_ACTION_ENUM.includes(value.recommendedHumanAction)) {
    reasons.push({ code: 'INVALID_FIELD', detail: `recommendedHumanAction 必须为 ${HUMAN_ACTION_ENUM.join('/')}` });
  }

  const wording = scanAuthorityWording(value);
  if (wording.hits.length > 0) {
    reasons.push({ code: 'AUTHORITY_WORDING', detail: `含执行性审批措辞：${wording.hits.map((h) => `${h.id}:"${h.matched}"`).join('；')}` });
  }

  return reasons.length === 0 ? { ok: true, candidate: value } : { ok: false, reasons };
}

/**
 * authority 措辞扫描：只命中“执行性决定”，返回命中明细供上层留痕与人工复核；
 * 流程性讨论（如“额度结论须由人工作出”）不应命中。
 */
export function scanAuthorityWording(candidate) {
  const texts = [
    ...candidate.observations ?? [],
    ...candidate.assumptions ?? [],
    ...candidate.recommendedHumanAction !== undefined ? [String(candidate.recommendedHumanAction)] : [],
  ];
  const hits = [];
  for (const text of texts) {
    for (const { id, pattern } of PERFORMATIVE_PATTERNS) {
      const m = text.match(pattern);
      if (m !== null) hits.push({ id, matched: m[0], source: text.slice(0, 60) });
    }
  }
  return { hits, scanned: texts.length };
}
