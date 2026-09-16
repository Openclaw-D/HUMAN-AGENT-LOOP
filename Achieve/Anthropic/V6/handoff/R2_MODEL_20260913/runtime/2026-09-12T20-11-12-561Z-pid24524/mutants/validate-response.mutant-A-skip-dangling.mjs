// provider 输出守门:结构校验 + 证据引用核查 + 越权输出拒绝。
// 原则:验证失败不伪装成功——任何违规都让上层得到 failed,绝不降级输出。
// 说明:越权批准拦截是启发式护栏(决定性表述/保留字段);最终防线仍是产品层
// "模型 authority=none、意见无审批效力"。默认词表偏保守,可按业务配置收严。
import { ERROR_CODES } from '../../../src/codes.mjs';

/** 顶层保留字段:出现即拒绝(模型不得给出决定/批准类结论)。 */
export const FORBIDDEN_OUTPUT_KEYS = Object.freeze([
  'decision', 'decisionValue', 'finalDecision', 'approved', 'approval',
  'approvalStatus', 'granted', 'clearToLend', 'creditDecision', 'recommendApproval',
]);

/** 决定性批准表述(默认词表;启发式,已知局限:无法覆盖所有表达,也可能误伤引用性文字)。 */
export const DEFAULT_FORBIDDEN_APPROVAL_PATTERNS = Object.freeze([
  /审批通过/, /予以批准/, /批准该笔/, /同意放款/, /核准通过/, /建议批准/,
  /准予通过/, /final\s+approval/i, /\bis\s+approved\b/i, /\bwe\s+approve\b/i,
]);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function refKeyOf(ref) {
  return `${ref.id}\u0000${ref.version}\u0000${ref.hash}`;
}

function matchForbiddenApprovalText(text, patterns) {
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) return m[0];
  }
  return null;
}

function normalizeRefs(refs) {
  return (refs || []).map((r) => ({ id: r.id, version: r.version, hash: r.hash }));
}

/**
 * 校验 provider 输出。
 * 返回 { ok:true, normalized } 或 { ok:false, violations:[{code, message, path?, detail?}] }。
 * 规则:
 *  1. findings/questions 至少其一非空(完全空输出拒绝);
 *  2. 每条 finding 必须携带文本与至少一个证据引用,且引用必须精确匹配本次输入的
 *     {id,version,hash}(拒绝未给出的证据与无来源事实);
 *  3. question 可以无引用(问句不是事实断言),但给出引用时同样必须合法;
 *  4. 顶层 evidenceRefs 必须是输入子集;
 *  5. 出现保留字段或决定性批准表述 → UNAUTHORIZED_OUTPUT。
 */
export function validateProviderOutput({ output, request, forbiddenPatterns = DEFAULT_FORBIDDEN_APPROVAL_PATTERNS } = {}) {
  const violations = [];
  if (!isPlainObject(output)) {
    return { ok: false, violations: [{ code: ERROR_CODES.MALFORMED_OUTPUT, message: '模型输出必须是 JSON 对象' }] };
  }

  const findings = Array.isArray(output.findings) ? output.findings : null;
  const questions = Array.isArray(output.questions) ? output.questions : null;
  if (!findings || !questions) {
    violations.push({ code: ERROR_CODES.MALFORMED_OUTPUT, message: '模型输出必须包含 findings 与 questions 数组' });
  }
  if ((findings ? findings.length : 0) + (questions ? questions.length : 0) === 0) {
    violations.push({ code: ERROR_CODES.EMPTY_OUTPUT, message: '模型输出为空:既没有发现也没有追问' });
  }
  if (violations.length > 0) {
    return { ok: false, violations };
  }

  const knownRefs = new Set((request.evidenceRefs || []).map(refKeyOf));

  function checkRefs(refs, path) {
    const checked = [];
    for (let i = 0; i < refs.length; i += 1) {
      const ref = refs[i];
      if (!isPlainObject(ref) || typeof ref.id !== 'string' || typeof ref.version !== 'string' || typeof ref.hash !== 'string') {
        violations.push({ code: ERROR_CODES.MALFORMED_OUTPUT, message: `${path}[${i}] 引用格式非法,需要 id/version/hash`, path: `${path}[${i}]` });
        continue;
      }
      const refKey = refKeyOf(ref);
      if (false) { // MUTANT-A: deliberately skip dangling check
        violations.push({
          code: ERROR_CODES.EVIDENCE_DANGLING,
          message: `引用了本次输入中不存在的证据:${ref.id}(版本 ${ref.version})`,
          path: `${path}[${i}]`,
          detail: { id: ref.id, version: ref.version, hash: ref.hash },
        });
        continue;
      }
      checked.push({ id: ref.id, version: ref.version, hash: ref.hash });
    }
    return checked;
  }

  const normFindings = [];
  for (let i = 0; i < findings.length; i += 1) {
    const f = findings[i];
    const path = `findings[${i}]`;
    if (!isPlainObject(f)) {
      violations.push({ code: ERROR_CODES.MALFORMED_OUTPUT, message: `${path} 必须是对象`, path });
      continue;
    }
    if (typeof f.text !== 'string' || f.text.trim() === '') {
      violations.push({ code: ERROR_CODES.FINDING_TEXT_MISSING, message: `${path} 缺少中文说明文本`, path });
    }
    let checked = [];
    if (!Array.isArray(f.evidenceRefs) || f.evidenceRefs.length === 0) {
      violations.push({ code: ERROR_CODES.UNSOURCED_FINDING, message: `${path} 没有引用任何证据,属于无来源事实`, path });
    } else {
      checked = checkRefs(f.evidenceRefs, `${path}.evidenceRefs`);
    }
    const hit = typeof f.text === 'string' ? matchForbiddenApprovalText(f.text, forbiddenPatterns) : null;
    if (hit) {
      violations.push({ code: ERROR_CODES.UNAUTHORIZED_OUTPUT, message: `${path} 包含越权批准类表述「${hit}」;模型无审批权限`, path, detail: { match: hit } });
    }
    normFindings.push({
      id: typeof f.id === 'string' ? f.id : `F${i + 1}`,
      text: typeof f.text === 'string' ? f.text : '',
      evidenceRefs: checked,
    });
  }

  const normQuestions = [];
  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i];
    const path = `questions[${i}]`;
    if (!isPlainObject(q)) {
      violations.push({ code: ERROR_CODES.MALFORMED_OUTPUT, message: `${path} 必须是对象`, path });
      continue;
    }
    if (typeof q.text !== 'string' || q.text.trim() === '') {
      violations.push({ code: ERROR_CODES.FINDING_TEXT_MISSING, message: `${path} 缺少中文问句文本`, path });
    }
    let checked = [];
    if (Array.isArray(q.evidenceRefs) && q.evidenceRefs.length > 0) {
      checked = checkRefs(q.evidenceRefs, `${path}.evidenceRefs`);
    }
    const qHit = typeof q.text === 'string' ? matchForbiddenApprovalText(q.text, forbiddenPatterns) : null;
    if (qHit) {
      violations.push({ code: ERROR_CODES.UNAUTHORIZED_OUTPUT, message: `${path} 包含越权批准类表述「${qHit}」;模型无审批权限`, path, detail: { match: qHit } });
    }
    normQuestions.push({
      id: typeof q.id === 'string' ? q.id : `Q${i + 1}`,
      text: typeof q.text === 'string' ? q.text : '',
      evidenceRefs: checked,
    });
  }

  const topLevelRefs = Array.isArray(output.evidenceRefs) ? checkRefs(output.evidenceRefs, 'evidenceRefs') : [];

  const forbiddenKeyHit = FORBIDDEN_OUTPUT_KEYS.find((k) => k in output);
  if (forbiddenKeyHit !== undefined) {
    violations.push({
      code: ERROR_CODES.UNAUTHORIZED_OUTPUT,
      message: `输出包含越权决定字段「${forbiddenKeyHit}」;模型无审批权限,只可输出发现与追问`,
      path: String(forbiddenKeyHit),
      detail: { key: forbiddenKeyHit },
    });
  }
  const approvalTextHit = [output.summary, output.conclusion]
    .filter((t) => typeof t === 'string')
    .map((t) => matchForbiddenApprovalText(t, forbiddenPatterns))
    .find(Boolean);
  if (approvalTextHit) {
    violations.push({
      code: ERROR_CODES.UNAUTHORIZED_OUTPUT,
      message: `输出包含越权批准类表述「${approvalTextHit}」;模型无审批权限`,
      detail: { match: approvalTextHit },
    });
  }

  if (violations.length > 0) return { ok: false, violations };
  return {
    ok: true,
    normalized: {
      findings: normFindings,
      questions: normQuestions,
      evidenceRefs: topLevelRefs,
    },
  };
}
