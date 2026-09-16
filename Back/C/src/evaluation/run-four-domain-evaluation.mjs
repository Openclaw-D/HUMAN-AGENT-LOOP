// 任务 03 · 四域场景评测 runner（确定性，零网络，零真实模型）。
// 用法：
//   node src/evaluation/run-four-domain-evaluation.mjs             → 主集（非 held-out）
//   node src/evaluation/run-four-domain-evaluation.mjs --heldout   → held-out（先校验冻结 manifest）
//   node src/evaluation/run-four-domain-evaluation.mjs --all       → 主集+held-out 连跑
// 退出码：0=全部通过；1=存在失败；2=held-out manifest 校验失败（视为被篡改，拒绝评测）。
// C16 全局纪律：任何面向事实的提问，其 targetFact 必须尚未达到所需核验等级
//（已充分核验的事实不得重复索要）——对所有场景机械断言。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runFourDomainPipeline } from '../../domains/pipeline.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}

const GATE_LABEL = { CLEAR: 'confirmed_clear', NEEDS_EVIDENCE: 'needs_evidence', HOLD_FOR_REVIEW: 'hold', HARD_BLOCK: 'hard_block' };

/** 单场景单轮执行（含跨客户双臂）。返回 { runs, checks:[{checkId, pass, detail}] } */
function runScenario(scenario) {
  const pack = JSON.parse(readFileSync(path.join(root, 'rules', 'four-domain-rule-pack-v1.json'), 'utf8'));
  const runs = [];
  const checks = [];
  const check = (id, pass, detail = '') => checks.push({ checkId: id, pass: !!pass, detail });

  const runOnce = (customerId, materials, round, extraArgs = {}) => runFourDomainPipeline({
    tenantId: 'tenant-demo',
    customerId,
    materials,
    transaction: scenario.transaction ?? {},
    asOf: scenario.asOf,
    rulePack: pack,
    ...(scenario.pipelineArgs ?? {}),
    ...extraArgs,
  });

  const roundResults = [];
  for (const round of scenario.rounds) {
    const r = runOnce(scenario.customerId, round.materials, round);
    roundResults.push({ roundId: round.roundId, result: r });
    runs.push({ arm: 'A', customerId: scenario.customerId, roundId: round.roundId });
    if (!r.ok) {
      check(`${round.roundId}:pipeline_ok`, false, `stage=${r.stage} problems=${JSON.stringify(r.problems ?? []).slice(0, 300)}`);
      continue;
    }
    evaluateChecks(check, { ...round, scenarioHasMultiCustomer: !!scenario.multiCustomer }, r, roundResults);
  }

  // 跨客户双臂（C25）
  if (scenario.multiCustomer) {
    const round = scenario.rounds[0];
    const matB = scenario.multiCustomer.materialsB === 'withAdverseDebt'
      ? [...round.materials, {
        materialId: 'XB-M20', kind: 'document', content: 'B 客户新增债务合同（合成）',
        sourceRef: { channel: '客户提交(合成)', capturedAt: '2026-09-10', field: '新增负债' },
        declaredFacts: [{ factKey: 'new_debt_monthly_payment', value: 25, unit: '万元', verificationLevel: 'source_supported' }],
        quality: {},
      }]
      : round.materials;
    const ra = runOnce(scenario.customerId, round.materials, round);
    const rb = runOnce(scenario.multiCustomer.customerB, matB, round);
    const mc = {
      cross_customer_isolated: () => [
        ra.snapshot.customerId === scenario.customerId
        && rb.snapshot.customerId === scenario.multiCustomer.customerB
        && ra.snapshot.snapshotId !== rb.snapshot.snapshotId,
        `A=${ra.snapshot.customerId}/${ra.snapshot.snapshotId} B=${rb.snapshot.customerId}/${rb.snapshot.snapshotId}`,
      ],
      gate_clear_both: () => [ra.gate.result === 'CLEAR' && rb.gate.result === 'CLEAR', `A=${ra.gate.result} B=${rb.gate.result}`],
      gate_hold_b: () => [ra.gate.result === 'CLEAR' && rb.gate.result === 'HOLD_FOR_REVIEW', `A=${ra.gate.result} B=${rb.gate.result}`],
      amount_b_lt_a: () => [
        (ra.amountCandidate.candidateRange?.max ?? -1) > (rb.amountCandidate.candidateRange?.max ?? -1),
        `maxA=${ra.amountCandidate.candidateRange?.max} maxB=${rb.amountCandidate.candidateRange?.max}`,
      ],
    };
    if (ra.ok && rb.ok) {
      // 只求值场景声明的跨客户判据（未声明的跨客户判据不参与判定）
      for (const c of round.expected.checks ?? []) {
        const head = c.split(':')[0];
        if (mc[head]) { const [pass, detail] = mc[head](); check(c, pass, detail); }
      }
    } else {
      check('cross_customer_isolated', false, '至少一臂流水线失败');
    }
  }
  return { runs, checks, roundResults };
}

/** 期望块 checks 解释器（确定性判据，不采信被测物自评）。 */
function evaluateChecks(check, round, r, roundResults) {
  const gate = r.gate;
  const before = roundResults[roundResults.length - 2]?.result ?? null;
  const serialized = stable(r);

  const MULTI_CUSTOMER_CHECKS = ['cross_customer_isolated', 'gate_clear_both', 'gate_hold_b', 'amount_b_lt_a'];
  for (const c of (round.expected.checks ?? []).filter((k) => !(round.scenarioHasMultiCustomer && MULTI_CUSTOMER_CHECKS.includes(k.split(':')[0])))) {
    const [head, ...rest] = c.split(':');
    const arg = rest.join(':');
    switch (head) {
      case 'gate_clear': check(c, gate.result === 'CLEAR'); break;
      case 'gate_needs_evidence': check(c, gate.result === 'NEEDS_EVIDENCE'); break;
      case 'reason_includes': check(c, gate.reasonCodes.includes(arg)); break;
      case 'rule_hit': check(c, r.ruleEvaluation.results.some((x) => x.ruleId === arg && x.outcome === 'hit')); break;
      case 'rule_not_hit': check(c, r.ruleEvaluation.results.some((x) => x.ruleId === arg && x.outcome !== 'hit' && x.outcome !== null)); break;
      case 'rule_inactive': {
        const [ruleId, reason] = arg.split(':');
        check(c, r.ruleEvaluation.results.some((x) => x.ruleId === ruleId && x.activated === false && x.inactiveReason === reason));
        break;
      }
      case 'rule_scope_not_applied':
        check(c, r.ruleEvaluation.results.some((x) => x.ruleId === arg && x.activated === true && x.scopeApplied === false));
        break;
      case 'policy_pending_false': check(c, r.ruleEvaluation.policyPending === false); break;
      case 'blocked_actions_include': check(c, gate.scope.blockedActions.includes(arg)); break;
      case 'rule_ids_eq_0': check(c, gate.ruleIds.length === 0, `ruleIds=${gate.ruleIds.join(',')}`); break;
      case 'duplicate_groups_ge_1': check(c, r.snapshot.duplicateGroups.length >= 1); break;
      case 'independent_sources_eq_1': {
        // 独立来源数：同 factKey 的材料按重复组去重后计数（perception.independentSourceCount 的镜像）
        const ids = [...new Set(r.projections.policy.items.filter((i) => i.factKey === arg).map((i) => i.materialId))];
        const counted = new Set();
        let n = 0;
        for (const id of ids) {
          const g = r.snapshot.duplicateGroups.find((x) => x.materialIds.includes(id));
          if (!g) n += 1;
          else if (!counted.has(g.contentHash)) { n += 1; counted.add(g.contentHash); }
        }
        check(c, n === 1, `独立来源=${n}`);
        break;
      }
      case 'conflicts_ge_1': check(c, r.snapshot.conflicts.length >= 1); break;
      case 'conflicts_eq_0': check(c, r.snapshot.conflicts.length === 0); break;
      case 'conflict_values_have_locations': {
        const ok = r.snapshot.conflicts.length > 0 && r.snapshot.conflicts.every((cf) => cf.values.every((v) => v.materialId && v.sourceRef && (v.sourceRef.page || v.sourceRef.field || v.sourceRef.timeSpan)));
        check(c, ok);
        break;
      }
      case 'unreadable_ge_1': check(c, r.snapshot.unreadable.length >= 1); break;
      case 'superseded_items_ge_1': check(c, r.snapshot.supersededItems.length >= 1); break;
      case 'quality_flagged_ge_1': check(c, r.snapshot.qualitySummary.flaggedMaterials.length >= 1); break;
      case 'commerce_unknowns_ge_1': check(c, (r.analyses.commerce?.assessment?.unknowns ?? []).length >= 1); break;
      case 'coverage_cmp': {
        // coverage_cmp:<round>:<op>:<value>
        const [, rnd, op, val] = c.split(':');
        const fact = r.ruleEvaluation.facts.cash_coverage_ratio?.[0];
        const v = fact?.value ?? null;
        const pass = v !== null && (op === 'lt' ? v < Number(val) : op === 'gt' ? v > Number(val) : op === 'gte' ? v >= Number(val) : v <= Number(val));
        check(c, pass, `coverage(${rnd})=${v}`);
        break;
      }
      case 'amount_evaluable_true': check(c, r.amountCandidate.evaluable === true); break;
      case 'amount_evaluable_false': check(c, r.amountCandidate.evaluable === false); break;
      case 'amount_gaps_ge_1': check(c, (r.amountCandidate.gaps ?? []).length >= 1); break;
      case 'amount_max_eq': check(c, r.amountCandidate.candidateRange?.max === Number(arg), `max=${r.amountCandidate.candidateRange?.max}`); break;
      case 'amount_max_round2_lt_round1': {
        const prev = before?.amountCandidate?.candidateRange?.max ?? null;
        check(c, prev !== null && (r.amountCandidate.candidateRange?.max ?? -1) < prev, `r1=${prev} r2=${r.amountCandidate.candidateRange?.max}`);
        break;
      }
      case 'questions_target_include':
        check(c, r.questionPlan.questions.some((q) => q.targetFact === arg), `questions=${r.questionPlan.questions.map((q) => q.targetFact).join(',')}`);
        break;
      case 'questions_customer_eq_0': check(c, r.questionPlan.questions.filter((q) => q.audience === 'customer').length === 0); break;
      case 'questions_internal_ge_1': check(c, r.questionPlan.questions.some((q) => q.audience !== 'customer')); break;
      case 'no_outbound_uri': check(c, !/https?:\/\/|wss?:\/\//.test(serialized)); break;
      case 'text_absent': check(c, !serialized.includes(arg)); break;
      case 'no_integrity_wording': {
        const texts = JSON.stringify([r.analyses.policy?.assessment?.summary, r.analyses.credit?.assessment?.summary,
          r.analyses.commerce?.assessment?.summary, r.analyses.asset?.assessment?.summary]);
        check(c, !/(欺诈|骗局|不诚信|造假充分)/.test(texts ?? ''), '域意见不含诚信/欺诈断言');
        break;
      }
      case 'assessment_contains': {
        const [, domain, field, ...sub] = c.split(':');
        const arr = r.analyses?.[domain]?.assessment?.[field] ?? [];
        check(c, arr.some((x) => String(typeof x === 'string' ? x : JSON.stringify(x)).includes(sub.join(':'))));
        break;
      }
      case 'next_step_mentions': check(c, r.nextStep.singleNextStep.includes(arg)); break;
      case 'escalation_present': check(c, r.nextStep.audienceQueues.internal.escalations.length >= 1); break;
      case 'escalation_absent': check(c, r.nextStep.audienceQueues.internal.escalations.length === 0); break;
      case 'gate_clear': check(c, gate.result === 'CLEAR'); break;
      default:
        check(c, false, `未知检查类型 ${head}（判据拼写错误按失败处理，不静默放行）`);
    }
  }
  // Gate 主判据 + 预标一致性
  check(`${round.roundId}:gate`, gate.result === round.expected.gate, `期望 ${round.expected.gate}，实际 ${gate.result}（reasons=${gate.reasonCodes.join('/')}）`);
  check(`${round.roundId}:prelabel`, GATE_LABEL[gate.result] === round.expected.prelabel.label);
  // C16 全局纪律：面向事实的提问目标必须未达所需等级
  for (const q of r.questionPlan.questions) {
    if (!q.targetFact) continue;
    const need = q.expectedEvidence?.minLevel ?? 'source_supported';
    const rankMap = { unknown: 0, declared: 1, source_supported: 2, verified: 3 };
    const satisfied = r.projections.policy.items.some((it) => it.factKey === q.targetFact && rankMap[it.verificationLevel] >= rankMap[need]);
    check(`C16:no_reask:${q.questionId}`, !satisfied, satisfied ? `事实 ${q.targetFact} 已达 ${need} 仍被索要` : '');
  }
}

function verifyHeldoutManifest(set, manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const problems = [];
  const held = set.scenarios.filter((s) => s.heldOut);
  for (const s of held) {
    const expect = manifest.entries[s.caseId];
    if (!expect) { problems.push(`${s.caseId} 不在冻结 manifest 中`); continue; }
    const actual = createHash('sha256').update(stable(s.rounds.map((r) => r.expected))).digest('hex');
    if (actual !== expect) problems.push(`${s.caseId} 期望块哈希不符（被改动？）`);
  }
  for (const caseId of Object.keys(manifest.entries)) {
    if (!held.some((s) => s.caseId === caseId)) problems.push(`manifest 含未知场景 ${caseId}`);
  }
  return problems;
}

function runPartition(set, partition, heldout) {
  const cases = [];
  let pass = 0;
  let fail = 0;
  for (const s of set.scenarios.filter((x) => (heldout ? x.heldOut : !x.heldOut))) {
    const { checks } = runScenario(s);
    const cFail = checks.filter((c) => !c.pass);
    cases.push({ caseId: s.caseId, category: s.category, group: s.group, matrixRef: s.matrixRef, checks: checks.length, failures: cFail });
    if (cFail.length === 0) pass += 1; else fail += 1;
  }
  return { partition, cases, totals: { pass, fail, checks: cases.reduce((a, c) => a + c.checks, 0) } };
}

function computeMetrics(report, set) {
  // 质量指标（任务书 §7）：全部给出分母；不单报“准确率 99%”式数字。
  const all = [];
  for (const part of report) for (const c of part.cases) all.push({ ...c, scenario: set.scenarios.find((s) => s.caseId === c.caseId) });
  const totalChecks = all.reduce((a, c) => a + c.checks, 0);
  const failedChecks = all.reduce((a, c) => a + c.failures.length, 0);

  // 关键发现证据定位正确率：要求 conflict_values_have_locations / 定位类检查的场景中的通过率
  const locationChecks = all.flatMap((c) => c.failures.filter((f) => f.checkId.includes('conflict_values_have_locations') || f.checkId.includes('assessment_contains')));
  const locationTotal = all.filter((c) => c.scenario.rounds.some((r) => (r.expected.checks ?? []).some((k) => k.startsWith('conflict_values_have_locations') || k.startsWith('assessment_contains')))).length;
  const locationBad = new Set(locationChecks.map((f) => f.caseId ?? '')).size;

  // 必须提示的风险检出（预标 hold/hard_block 的场景中 Gate 正确比例）
  const riskCases = all.filter((c) => ['hold', 'hard_block'].includes(c.scenario.rounds[0].expected.prelabel.label));
  const riskCaught = riskCases.filter((c) => c.failures.length === 0).length;

  // 误报/不必要追问：CLEAR 预标场景被判 HOLD/BLOCK，或提问目标已核验（C16 检查失败）
  const falseAlarmCases = all.filter((c) => c.scenario.rounds[0].expected.prelabel.label === 'confirmed_clear' && c.failures.some((f) => f.checkId.endsWith(':gate'))).length;
  const unnecessaryAsk = all.reduce((a, c) => a + c.failures.filter((f) => f.checkId.startsWith('C16:no_reask')).length, 0);

  // 数值抽取与否定词错误：negation 类场景的失败轮数（分母=该类场景轮数）
  const negScen = all.filter((c) => c.scenario.category === 'chinese-number-negation');
  const negErrors = negScen.reduce((a, c) => a + c.failures.length, 0);
  const negRounds = negScen.reduce((a, c) => a + c.scenario.rounds.length, 0);

  // 人工纠正次数：失败场景即需要人工纠正的合成案例数
  const humanCorrections = all.filter((c) => c.failures.length > 0).length;

  // 每客户外部调用数/耗时/费用：确定性管线零外部调用（如实 0，不是未知）
  const externalCalls = 0;

  return {
    note: '全部指标给出分母；预标为合成占位（synthetic_prelabel_v1），通过率不构成真实业务质量结论',
    evidence_location_accuracy: { correct: locationTotal - locationBad, total: locationTotal, note: '分母=含定位类判据的场景数' },
    must_flag_risk_recall: { caught: riskCaught, total: riskCases.length, note: '分母=预标 hold/hard_block 的场景数' },
    false_alarm_on_clear: { count: falseAlarmCases, total: all.filter((c) => c.scenario.rounds[0].expected.prelabel.label === 'confirmed_clear').length },
    unnecessary_reask_violations: { count: unnecessaryAsk, total: totalChecks, note: 'C16 机械纪律违规次数' },
    negation_numeric_errors: { failed_checks: negErrors, rounds: negRounds },
    human_correction_cases: { count: humanCorrections, total: all.length },
    external_calls_per_customer: { count: externalCalls, note: '确定性管线零外部调用（E1；真实模型调用属 E2，未授权不运行）' },
    totals: { checks: totalChecks, failed: failedChecks, scenarios: all.length },
  };
}

// ---- main ----
const mode = process.argv.includes('--heldout') ? 'heldout' : process.argv.includes('--all') ? 'all' : 'main';
const setPath = path.join(root, 'scenarios', 'four-domain-cases-v1.json');
const set = JSON.parse(readFileSync(setPath, 'utf8'));
console.log(`[eval4d] 场景集 ${set.scenarioSetId}@${set.version}：${set.counts.total} 场景（held-out ${set.counts.heldOut}）`);
console.log(`[eval4d] 预标状态：${set.prelabelStatus}`);

let exitCode = 0;
const report = [];
if (mode === 'main' || mode === 'all') report.push(runPartition(set, 'main', false));
if (mode === 'heldout' || mode === 'all') {
  const problems = verifyHeldoutManifest(set, path.join(root, 'scenarios', 'four-domain-heldout-manifest.json'));
  if (problems.length > 0) {
    console.error('[eval4d] held-out 冻结校验失败（拒绝评测，防“看到失败后改标准”）：');
    for (const p of problems) console.error('  -', p);
    process.exit(2);
  }
  report.push(runPartition(set, 'heldout', true));
}

for (const part of report) {
  console.log(`[eval4d] ${part.partition}：场景 ${part.totals.pass}/${part.totals.pass + part.totals.fail} 通过，检查断言 ${part.totals.checks} 项`);
  for (const c of part.cases) {
    if (c.failures.length > 0) {
      console.log(`  FAIL ${c.caseId}（${c.category}${c.matrixRef ? '/' + c.matrixRef : ''}）`);
      for (const f of c.failures) console.log(`    - ${f.checkId}: ${f.detail}`);
      exitCode = 1;
    }
  }
}
const metrics = computeMetrics(report, set);
console.log('[eval4d] 质量指标（含分母）：');
console.log(`  证据定位正确 ${metrics.evidence_location_accuracy.correct}/${metrics.evidence_location_accuracy.total}`);
console.log(`  必报风险检出 ${metrics.must_flag_risk_recall.caught}/${metrics.must_flag_risk_recall.total}`);
console.log(`  CLEAR 误报 ${metrics.false_alarm_on_clear.count}/${metrics.false_alarm_on_clear.total}`);
console.log(`  不必要追问违规 ${metrics.unnecessary_reask_violations.count}`);
console.log(`  否定/数值错误 ${metrics.negation_numeric_errors.failed_checks}/${metrics.negation_numeric_errors.rounds} 轮`);
console.log(`  需人工纠正场景 ${metrics.human_correction_cases.count}/${metrics.human_correction_cases.total}`);
console.log(`  外部调用 ${metrics.external_calls_per_customer.count}（E1 确定性管线）`);

const evidence = {
  runAt: new Date().toISOString(),
  set: { id: set.scenarioSetId, version: set.version, counts: set.counts },
  mode,
  parts: report,
  metrics,
  heldoutManifest: mode === 'heldout' || mode === 'all' ? 'verified' : 'not-checked-this-run',
};
const evDir = path.join(root, 'evidence');
mkdirSync(evDir, { recursive: true });
const evFile = path.join(evDir, `four-domain-eval-${mode}.json`);
writeFileSync(evFile, JSON.stringify(evidence, null, 2), 'utf8');
console.log(`[eval4d] 证据已写 ${path.relative(root, evFile)}`);
process.exit(exitCode);
