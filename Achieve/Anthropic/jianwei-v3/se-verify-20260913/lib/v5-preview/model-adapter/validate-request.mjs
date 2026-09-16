// analyze 请求校验(接口 v1 最小请求)。
// 只做结构与授权配置校验;不发起外部调用、不产生副作用。
import { canonicalJson } from './dedupe.mjs';

export const DEFAULT_ROLES = Object.freeze({
  viewmicro: { label: '见微', allowedPurposes: ['company_profile', 'risk_review'] },
  business: { label: '业务', allowedPurposes: ['event_intake', 'risk_review', 'question_next'] },
  policy: { label: '政策', allowedPurposes: ['policy_check', 'risk_review'] },
  credit: { label: '信审', allowedPurposes: ['credit_review', 'risk_review', 'question_next'] },
  commerce: { label: '商务', allowedPurposes: ['pricing_context', 'risk_review'] },
  asset: { label: '资产', allowedPurposes: ['asset_review', 'risk_review'] },
});

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isValidContextVersion(v) {
  return isNonEmptyString(v) || (Number.isInteger(v) && v > 0);
}

/**
 * 校验失败返回 { ok:false, code, message(中文), details? };
 * 通过返回 { ok:true, warnings:[], canonicalPayloadKey }。
 * 未知字段不拒绝(前向兼容),记入 warnings。
 */
export function validateAnalyzeRequest(request, { roles = DEFAULT_ROLES } = {}) {
  if (!isPlainObject(request)) {
    return { ok: false, code: 'REQUEST_INVALID', message: '请求必须是对象' };
  }
  const warnings = [];
  const known = new Set([
    'requestId', 'projectId', 'sessionId', 'generation', 'contextVersion',
    'role', 'purpose', 'text', 'evidenceRefs',
  ]);
  for (const key of Object.keys(request)) {
    if (!known.has(key)) warnings.push(`忽略未知字段:${key}`);
  }

  for (const field of ['requestId', 'projectId', 'sessionId', 'purpose']) {
    if (!isNonEmptyString(request[field])) {
      return { ok: false, code: 'REQUEST_INVALID', message: `缺少或非法字段:${field}`, details: { field } };
    }
  }
  if (!Number.isInteger(request.generation) || request.generation <= 0) {
    return { ok: false, code: 'REQUEST_INVALID', message: 'generation 必须是正整数,表示业务推进代次', details: { field: 'generation' } };
  }
  if (!isValidContextVersion(request.contextVersion)) {
    return { ok: false, code: 'REQUEST_INVALID', message: 'contextVersion 必须是非空字符串或正整数', details: { field: 'contextVersion' } };
  }
  if (typeof request.text !== 'string') {
    return { ok: false, code: 'REQUEST_INVALID', message: 'text 必须是字符串(允许为空串)', details: { field: 'text' } };
  }
  if (!Array.isArray(request.evidenceRefs)) {
    return { ok: false, code: 'REQUEST_INVALID', message: 'evidenceRefs 必须是数组(允许为空)', details: { field: 'evidenceRefs' } };
  }
  for (let i = 0; i < request.evidenceRefs.length; i += 1) {
    const ref = request.evidenceRefs[i];
    if (!isPlainObject(ref) || !isNonEmptyString(ref.id) || !isNonEmptyString(ref.version) || !isNonEmptyString(ref.hash)) {
      return {
        ok: false, code: 'REQUEST_INVALID',
        message: `evidenceRefs[${i}] 必须包含非空的 id、version、hash`,
        details: { field: 'evidenceRefs', index: i },
      };
    }
  }

  if (!isNonEmptyString(request.role)) {
    return { ok: false, code: 'REQUEST_INVALID', message: '缺少字段:role', details: { field: 'role' } };
  }
  const roleConf = roles[request.role];
  if (!roleConf) {
    return { ok: false, code: 'UNKNOWN_ROLE', message: `未配置的角色:${request.role}`, details: { role: request.role } };
  }
  const allowed = roleConf.allowedPurposes;
  const purposeAllowed = allowed === '*' || (Array.isArray(allowed) && allowed.includes(request.purpose));
  if (!purposeAllowed) {
    return {
      ok: false, code: 'PURPOSE_NOT_ALLOWED',
      message: `角色 ${request.role} 不允许用途 ${request.purpose}`,
      details: { role: request.role, purpose: request.purpose },
    };
  }

  const canonicalPayloadKey = canonicalJson({
    requestId: request.requestId,
    projectId: request.projectId,
    sessionId: request.sessionId,
    generation: request.generation,
    contextVersion: request.contextVersion,
    role: request.role,
    purpose: request.purpose,
    text: request.text,
    evidenceRefs: [...request.evidenceRefs].map((r) => ({ id: r.id, version: r.version, hash: r.hash })),
  });
  return { ok: true, warnings, roleConf, canonicalPayloadKey };
}
