// V7 backend-next Lane C · 案例确定性检查器。
// 纪律（任务书/用户规则）：
// - 预期来自用户规则（rule-pack-v2）、明确假设与确定性算式；脚本化候选只是被检对象，
//   其自评（observations 措辞、recommendedHumanAction）永远不是"真值"来源。
// - 检查器全部机械可重放：同输入同结论；零网络、零模型调用。
// - authority=none：任何检查都不授予审批权；检查结果只是候选质量的机械信号。
import { calculateCashFlowCoverage } from './calculation-tool.mjs';
import { calculateRatio } from './ratio-tool.mjs';
import { validateCandidate, scanAuthorityWording } from './candidate-schema.mjs';

export const GRADES = ['confirmed', 'source_supported', 'inference', 'unverified', 'unknown'];

const OWNERSHIP_DISPUTE_RE = /争议|异议|第三方|代购|登记缺失/;
const NET_INCOME_RE = /(净收益|净利润|净现金流|预期损失|纯利)/;
const HIGH_RATE_COVER_RE = /(报价|利率|租金|收益|价格|费率)[^。；]{0,20}(覆盖|补偿|对冲|抵补)[^。；]{0,8}风险/;

/** 同输入恒同输出的机械状态推导（真值来源=证据+规则，不含候选自评）。 */
export function detectTurnState(turn) {
  const evidence = turn.evidence ?? [];
  const active = evidence.filter((e) => e.supersededBy === null);
  const numeric = active.filter((e) => typeof e.value === 'number' && Number.isFinite(e.value));

  // 同指标同口径多值且无取代 → evidence_conflict
  const conflicts = [];
  const byKey = new Map();
  for (const e of numeric) {
    const key = `${e.indicator}::${e.caliber}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(e);
  }
  for (const [key, group] of byKey) {
    const distinct = new Set(group.map((e) => e.value));
    if (distinct.size > 1) {
      conflicts.push({ key, indicator: group[0].indicator, caliber: group[0].caliber, evidenceIds: group.map((e) => e.evidenceId), values: [...distinct] });
    }
  }

  // 同指标多口径并存且未声明 → caliber_change
  const calibersByIndicator = new Map();
  for (const e of numeric) {
    if (!calibersByIndicator.has(e.indicator)) calibersByIndicator.set(e.indicator, new Set());
    calibersByIndicator.get(e.indicator).add(e.caliber);
  }
  const multiCaliber = [...calibersByIndicator.entries()].filter(([, set]) => set.size > 1).map(([indicator, set]) => ({ indicator, calibers: [...set] }));
  const declared = turn.caliberCoexistence?.declared === true;
  const caliberUndeclared = multiCaliber.filter((m) => !declared);

  // unknown 级证据（数值或应数值而未知；不得进入计算输入，并武装"不得编造净收益"探针）
  const unknownGradeNumerics = active.filter((e) => e.grade === 'unknown').map((e) => e.evidenceId);

  // 权属争议信号
  const ownershipDisputeSignals = active.filter(
    (e) => e.indicator === 'equipment_ownership_status' && e.grade !== 'confirmed' && OWNERSHIP_DISPUTE_RE.test(String(e.content ?? '')),
  ).map((e) => e.evidenceId);

  // 取代链完整性：supersededBy 指向的目标必须以活跃证据存在
  const activeKeys = new Set(active.map((e) => `${e.evidenceId}@${e.version}`));
  const superseded = evidence.filter((e) => e.supersededBy !== null);
  const brokenSupersession = superseded.filter((e) => !activeKeys.has(e.supersededBy)).map((e) => `${e.evidenceId}@${e.version}`);

  const reasons = new Set();
  if (conflicts.length > 0) reasons.add('evidence_conflict');
  if (caliberUndeclared.length > 0) reasons.add('caliber_change');
  if (ownershipDisputeSignals.length > 0) reasons.add('ownership_dispute');

  return { active, conflicts, multiCaliber, caliberUndeclared, caliberDeclared: declared, unknownGradeNumerics, ownershipDisputeSignals, brokenSupersession, supersededPairs: superseded.map((e) => ({ from: `${e.evidenceId}@${e.version}`, to: e.supersededBy })), reasons };
}

/** 计算输入的机械校验：引用存在、口径匹配声明、不引用 unknown 级数值、不引用被取代证据。 */
export function validateCalcInput(turn) {
  const calcInput = turn.calcInput;
  if (calcInput === undefined || calcInput === null) return { present: false, problems: [] };
  const problems = [];
  const index = new Map((turn.evidence ?? []).map((e) => [`${e.evidenceId}@${e.version}`, e]));
  for (const side of ['monthlyOperatingCashFlow', 'monthlyDebtService']) {
    const input = calcInput[side];
    if (input === undefined) { problems.push(`${side} 缺失`); continue; }
    const key = `${input.source?.evidenceId}@${input.source?.version}`;
    const ev = index.get(key);
    if (ev === undefined) problems.push(`${side} 引用不存在证据 ${key}`);
    else {
      if (ev.supersededBy !== null) problems.push(`${side} 引用被取代证据 ${key}`);
      if (ev.caliber !== input.caliber) problems.push(`${side} 口径与证据声明不一致（${input.caliber} ≠ ${ev.caliber}）`);
      if (ev.grade === 'unknown') problems.push(`${side} 引用 unknown 级数值 ${key}（unknown 不得作计算输入）`);
      if (ev.value !== input.value) problems.push(`${side} 数值与证据不一致（${input.value} ≠ ${ev.value}）`);
    }
  }
  return { present: true, problems };
}

function sentenceSegments(texts) {
  return texts.flatMap((t) => String(t).split(/[。；;!！?？\n]/)).filter((s) => s.trim() !== '');
}

/** 候选违规机械探针（返回违规码集合；码即 rule-pack 语义或 schema 码）。 */
export function candidateViolations(candidate, turn) {
  const violations = new Set();
  const schema = validateCandidate(candidate);
  if (!schema.ok) {
    const nonWording = schema.reasons.filter((r) => r.code !== 'AUTHORITY_WORDING');
    if (nonWording.length > 0) violations.add('schema_invalid');
  }
  const wordingHits = schema.ok ? scanAuthorityWording(candidate).hits : schema.reasons.filter((r) => r.code === 'AUTHORITY_WORDING');
  if (wordingHits.length > 0) violations.add('authority_wording');

  // 引用存在性 + 被取代引用
  const index = new Map((turn.evidence ?? []).map((e) => [`${e.evidenceId}@${e.version}`, e]));
  for (const ref of candidate.evidenceRefs ?? []) {
    const key = `${ref.evidenceId}@${ref.version}`;
    const ev = index.get(key);
    if (ev === undefined) { violations.add('reference_missing'); continue; }
    if (ev.supersededBy !== null) violations.add('superseded_evidence_cited');
  }

  const texts = [...(candidate.observations ?? []), ...(candidate.assumptions ?? [])];
  const segments = sentenceSegments(texts);
  const unknownCostActive = detectTurnState(turn).unknownGradeNumerics.length > 0;
  if (unknownCostActive && segments.some((s) => NET_INCOME_RE.test(s) && /\d/.test(s))) violations.add('no_fabricated_net_income');
  if (segments.some((s) => HIGH_RATE_COVER_RE.test(s))) violations.add('high_interest_not_risk_coverage');

  // 不确定低估：机械信号存在而候选自报零不确定
  const st = detectTurnState(turn);
  const mechanicalSignals = st.unknownGradeNumerics.length > 0 || st.conflicts.length > 0 || st.caliberUndeclared.length > 0 || (turn.unknowns ?? []).length > 0;
  if (mechanicalSignals && Array.isArray(candidate.uncertainty) && candidate.uncertainty.length === 0) violations.add('uncertainty_understatement');

  return violations;
}

/** 单轮全部期望检查求值。返回 [{checkId, kind, pass, detail}]。 */
export function evaluateTurn(turn) {
  const st = detectTurnState(turn);
  const results = [];
  const push = (checkId, kind, pass, detail) => results.push({ checkId, kind, pass, detail: detail ?? '' });

  // 计算族：blocked 判定先于 calc
  const calcValidation = validateCalcInput(turn);
  let calcResult = null;
  if (calcValidation.present && calcValidation.problems.length === 0 && st.conflicts.length === 0 && st.caliberUndeclared.length === 0) {
    calcResult = calculateCashFlowCoverage({
      currency: turn.calcInput.currency,
      monthlyOperatingCashFlow: turn.calcInput.monthlyOperatingCashFlow,
      monthlyDebtService: turn.calcInput.monthlyDebtService,
    });
  }
  let ratioResult = null;
  if (turn.concentrationInput) {
    ratioResult = calculateRatio(turn.concentrationInput);
  }

  for (const check of turn.expectedChecks ?? []) {
    switch (check.kind) {
      case 'calc': {
        if (!calcValidation.present) { push(check.checkId, check.kind, false, 'calcInput 缺失'); break; }
        if (calcValidation.problems.length > 0) { push(check.checkId, check.kind, false, `calcInput 校验失败：${calcValidation.problems.join('；')}`); break; }
        if (st.conflicts.length > 0 || st.caliberUndeclared.length > 0) { push(check.checkId, check.kind, false, '存在矛盾/未声明口径，计算必须短路'); break; }
        if (!calcResult?.ok) { push(check.checkId, check.kind, false, `计算失败：${JSON.stringify(calcResult?.error ?? null)}`); break; }
        const actual = calcResult.result.ratio;
        const expect = check.expectRatio;
        const pass = Math.abs(actual - expect) <= 1e-9;
        push(check.checkId, check.kind, pass, `ratio 实际 ${actual} 期望 ${expect}`);
        break;
      }
      case 'calc_concentration': {
        if (!ratioResult?.ok) { push(check.checkId, check.kind, false, `比值工具失败：${JSON.stringify(ratioResult?.error ?? null)}`); break; }
        const actual = ratioResult.result.ratio;
        const pass = Math.abs(actual - check.expectRatio) <= 1e-9;
        push(check.checkId, check.kind, pass, `concentration 实际 ${actual} 期望 ${check.expectRatio}`);
        break;
      }
      case 'calc_blocked': {
        const pass = !calcValidation.present || calcValidation.problems.length > 0 || st.conflicts.length > 0 || st.caliberUndeclared.length > 0;
        push(check.checkId, check.kind, pass, pass ? '计算被正确短路' : '存在可用 calcInput 且无阻塞状态，但期望阻塞');
        break;
      }
      case 'escalation':
        push(check.checkId, check.kind, st.reasons.has(check.reason), `期望升级 ${check.reason}；机械推导=${[...st.reasons].join(',') || '∅'}`);
        break;
      case 'no_escalation': {
        const hit = check.reasons.filter((r) => st.reasons.has(r));
        push(check.checkId, check.kind, hit.length === 0, hit.length === 0 ? '无升级（正确）' : `不应升级却命中：${hit.join(',')}`);
        break;
      }
      case 'provider_not_called':
        push(check.checkId, check.kind, turn.providerNotCalled === true && turn.scriptedCandidate === null && !turn.scriptedCandidates, '升级短路轮不得有 provider 调用与候选');
        break;
      case 'grade_discipline': {
        const problems = [];
        for (const e of turn.evidence ?? []) {
          for (const f of ['evidenceId', 'version', 'supersededBy', 'indicator', 'caliber', 'grade', 'content']) {
            if (!(f in e)) problems.push(`${e.evidenceId ?? '?'} 缺字段 ${f}`);
          }
          if (!GRADES.includes(e.grade)) problems.push(`${e.evidenceId} grade 非法：${e.grade}`);
          if (typeof e.value === 'number' && e.value !== null && e.caliber.trim?.() === '') problems.push(`${e.evidenceId} 数值证据口径为空`);
        }
        push(check.checkId, check.kind, problems.length === 0, problems.length === 0 ? '五级证据纪律通过' : problems.slice(0, 5).join('；'));
        break;
      }
      case 'candidate_valid': {
        const candidates = collectCandidates(turn);
        const fails = [];
        for (const c of candidates.filter((x) => x.expectValid)) {
          const v = candidateViolations(c.candidate, turn);
          if (v.size > 0) fails.push(`${c.label}: ${[...v].join(',')}`);
          if (check.forbidSupersededRefs && candidateViolations(c.candidate, turn).has('superseded_evidence_cited')) {
            fails.push(`${c.label}: 引用被取代证据`);
          }
        }
        push(check.checkId, check.kind, fails.length === 0, fails.length === 0 ? '候选通过结构+引用+authority 检查' : fails.join('；'));
        break;
      }
      case 'negative_rejected': {
        const negatives = collectCandidates(turn).filter((x) => x.expectValid === false);
        const fails = [];
        for (const n of negatives) {
          const v = candidateViolations(n.candidate, turn);
          const missing = (check.expectViolations ?? []).filter((x) => !v.has(x));
          if (missing.length > 0) fails.push(`${n.label}: 未被拦截（缺 ${missing.join(',')}，实际=${[...v].join(',') || '∅'}）`);
        }
        push(check.checkId, check.kind, negatives.length > 0 && fails.length === 0, fails.length === 0 ? `负例被正确拦截（${(check.expectViolations ?? []).join(',')}）` : fails.join('；'));
        break;
      }
      case 'no_fabricated_net_income': {
        const targets = pickByApplies(turn, check.appliesTo).filter((x) => x.expectValid);
        const fails = [];
        for (const c of targets) {
          const segs = sentenceSegments([...(c.candidate.observations ?? []), ...(c.candidate.assumptions ?? [])]);
          if (st.unknownGradeNumerics.length > 0 && segs.some((s) => NET_INCOME_RE.test(s) && /\d/.test(s))) fails.push(c.label);
        }
        push(check.checkId, check.kind, targets.length > 0 && fails.length === 0, fails.length === 0 ? '正例未编造净收益' : `编造净收益：${fails.join(',')}`);
        break;
      }
      case 'high_interest_not_risk_coverage': {
        const targets = pickByApplies(turn, check.appliesTo).filter((x) => x.expectValid);
        const fails = [];
        for (const c of targets) {
          const segs = sentenceSegments([...(c.candidate.observations ?? []), ...(c.candidate.assumptions ?? [])]);
          if (segs.some((s) => HIGH_RATE_COVER_RE.test(s))) fails.push(c.label);
        }
        push(check.checkId, check.kind, targets.length > 0 && fails.length === 0, fails.length === 0 ? '正例无"高息覆盖风险"表述' : `命中高息覆盖论：${fails.join(',')}`);
        break;
      }
      case 'uncertainty_declared': {
        const candidates = collectCandidates(turn).filter((x) => x.expectValid);
        const fails = [];
        for (const c of candidates) {
          const text = (c.candidate.uncertainty ?? []).join(' ');
          if (!new RegExp(check.mustMention).test(text)) fails.push(`${c.label} 未声明：${check.mustMention}`);
        }
        push(check.checkId, check.kind, candidates.length > 0 && fails.length === 0, fails.length === 0 ? '不确定性已声明' : fails.join('；'));
        break;
      }
      case 'uncertainty_change': {
        const turns = turn.__allTurns ?? [];
        const prev = turn.__turnIndex !== undefined ? turns[turn.__turnIndex - 1] : undefined;
        const cur = collectCandidates(turn).find((x) => x.expectValid);
        const before = prev ? collectCandidates(prev).find((x) => x.expectValid) : null;
        if (!cur || !before) { push(check.checkId, check.kind, false, '缺少前后轮候选'); break; }
        const a = JSON.stringify(before.candidate.uncertainty ?? []);
        const b = JSON.stringify(cur.candidate.uncertainty ?? []);
        const narrowed = (cur.candidate.uncertainty ?? []).length < (before.candidate.uncertainty ?? []).length;
        push(check.checkId, check.kind, a !== b && narrowed, `补证后不确定性收窄：${a} → ${b}`);
        break;
      }
      case 'supersession_effective':
        push(check.checkId, check.kind, st.brokenSupersession.length === 0 && st.supersededPairs.length > 0,
          st.brokenSupersession.length === 0 ? `取代链完整（${st.supersededPairs.length} 对）` : `取代目标缺失：${st.brokenSupersession.join(',')}`);
        break;
      case 'incomplete_not_auto_reject': {
        const candidates = collectCandidates(turn).filter((x) => x.expectValid);
        const summary = turn.scriptedSummary;
        const okAction = candidates.every((c) => ['need_more_evidence', 'return_for_evidence'].includes(c.candidate.recommendedHumanAction));
        const notReject = summary === undefined || summary.tendency !== 'no_do';
        push(check.checkId, check.kind, candidates.length > 0 && okAction && notReject,
          `资料不完整→补证而非拒绝：action=${candidates.map((c) => c.candidate.recommendedHumanAction).join('/')} tendency=${summary?.tendency ?? '∅'}`);
        break;
      }
      case 'tendency_rule': {
        const summary = turn.scriptedSummary;
        const pass = summary !== undefined && !check.forbidTendency.includes(summary.tendency);
        push(check.checkId, check.kind, pass, `tendency=${summary?.tendency ?? '∅'} 禁止=${check.forbidTendency.join(',')}（${check.because ?? ''}）`);
        break;
      }
      case 'question_limit': {
        const q = turn.scriptedSummary?.questions;
        const pass = Array.isArray(q) && q.length >= 1 && q.length <= 3;
        push(check.checkId, check.kind, pass, `问题数=${q?.length ?? '∅'}（须 1..3）`);
        break;
      }
      default:
        push(check.checkId, check.kind, false, `未知检查类型 ${check.kind}`);
    }
  }
  return results;
}

function collectCandidates(turn) {
  if (turn.scriptedCandidates) return turn.scriptedCandidates.map((x) => ({ label: x.label, candidate: x.candidate, expectValid: x.expectValid }));
  if (turn.scriptedCandidate) return [{ label: 'main', candidate: turn.scriptedCandidate, expectValid: true }];
  return [];
}

function pickByApplies(turn, appliesTo) {
  const all = collectCandidates(turn);
  if (!appliesTo || appliesTo === 'all') return all;
  if (appliesTo === 'positive') return all.filter((x) => x.expectValid);
  if (appliesTo === 'negative') return all.filter((x) => !x.expectValid);
  return all.filter((x) => x.label === appliesTo);
}

/** 结构校验（案例集级）：必需字段、多轮计数、引用完整性。返回问题数组。 */
export function validateCaseSetStructure(set) {
  const problems = [];
  if (!set.caseSetId) problems.push('缺 caseSetId');
  if (!Array.isArray(set.cases) || set.cases.length === 0) problems.push('cases 为空');
  const seen = new Set();
  for (const c of set.cases ?? []) {
    for (const f of ['caseId', 'title', 'industry', 'leaseMode', 'turns']) {
      if (!(f in c)) problems.push(`${c.caseId ?? '?'} 缺 ${f}`);
    }
    if (seen.has(c.caseId)) problems.push(`caseId 重复：${c.caseId}`);
    seen.add(c.caseId);
    if (!Array.isArray(c.turns) || c.turns.length === 0) problems.push(`${c.caseId} turns 为空`);
    if (c.multiTurn === true && (c.turns?.length ?? 0) < 2) problems.push(`${c.caseId} 声明多轮但 turns<2`);
    for (const t of c.turns ?? []) {
      if (!Array.isArray(t.evidence) || t.evidence.length === 0) problems.push(`${c.caseId} turn${t.turn} evidence 为空`);
      if (!Array.isArray(t.expectedChecks) || t.expectedChecks.length === 0) problems.push(`${c.caseId} turn${t.turn} expectedChecks 为空`);
      if (t.providerNotCalled === true && (t.scriptedCandidate !== null && t.scriptedCandidate !== undefined || Array.isArray(t.scriptedCandidates))) {
        problems.push(`${c.caseId} turn${t.turn} 声明短路但带候选`);
      }
      const index = new Set((t.evidence ?? []).map((e) => `${e.evidenceId}@${e.version}`));
      for (const e of t.evidence ?? []) {
        if (index.has(`${e.evidenceId}@${e.version}`) === false) problems.push(`${c.caseId} turn${t.turn} 证据键异常`);
      }
    }
  }
  return problems;
}

/** 案例集全量评测。返回 { totals, cases: [...] }。 */
export function evaluateCaseSet(set) {
  const caseResults = [];
  let passCount = 0;
  let failCount = 0;
  for (const c of set.cases) {
    const turnResults = [];
    c.turns.forEach((t, idx) => {
      const withAll = { ...t, __allTurns: c.turns, __turnIndex: idx };
      turnResults.push({ turn: t.turn, checks: evaluateTurn(withAll) });
    });
    const fails = turnResults.flatMap((tr) => tr.checks.filter((x) => !x.pass).map((x) => `turn${tr.turn}/${x.checkId}(${x.kind}): ${x.detail}`));
    if (fails.length === 0) passCount += 1; else failCount += 1;
    caseResults.push({ caseId: c.caseId, title: c.title, multiTurn: c.multiTurn === true, pass: fails.length === 0, failures: fails, turnCount: c.turns.length, turns: turnResults });
  }
  return { caseSetId: set.caseSetId, version: set.version, seed: set.seed, totals: { cases: set.cases.length, pass: passCount, fail: failCount }, cases: caseResults };
}
