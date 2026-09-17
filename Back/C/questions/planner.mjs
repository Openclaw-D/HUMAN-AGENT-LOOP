// 任务 03 · S4 下一步提问计划：每问服务一个明确不确定点，带 whyNeeded/expectedEvidence/
// targetFact/优先级/是否可选/客户负担/停止条件。已充分核验的事实停止重复索要（C16）；
// 拒绝不必要资料不作为任何额度输入（结构上不进入金额候选器）。

import { VERIFICATION_LEVELS } from '../domains/schema.mjs';

function rank(l) { return VERIFICATION_LEVELS.indexOf(l); }

/**
 * 生成提问计划。
 * @param p.gate evaluateGate 产物
 * @param p.projection 当前感知投影（判“已核验”）
 * @param p.minLevels { factKey: minLevel } 规则前提要求的核验等级（来自规则结果）
 * @returns { questions:[...], dedupedCount, note }
 */
export function planQuestions({ gate, projection, minLevels = {} }) {
  const raw = [];
  for (const d of Object.keys(gate.domainStatus ?? {})) {
    const st = gate.domainStatus[d];
    if (st.status === 'missing' || (st.status !== 'completed' && st.status !== undefined)) {
      raw.push({
        questionId: `q-internal-${d}-rerun`,
        audience: 'internal',
        whyNeeded: { type: 'domain_incomplete', detail: `必需域 ${d} 未完成（${st.status}）：正式评估须满足必需域的当前版本覆盖` },
        expectedEvidence: { kind: 'system', note: '重算该域（非客户负担）' },
        targetFact: null,
        priority: 'blocking',
        optional: false,
        customerBurden: 'none',
        stopCondition: `domain_completed:${d}`,
      });
    }
  }
  for (const rc of gate.releaseConditions ?? []) {
    if (rc.type === 'provide_evidence') {
      raw.push({
        questionId: `q-evidence-${rc.factKey}`,
        audience: 'customer',
        whyNeeded: { type: 'rule_precondition', ruleId: rc.ruleId ?? null, detail: `事实 ${rc.factKey} 需达 ${rc.minLevel} 级核验` },
        expectedEvidence: { kind: 'document', factKey: rc.factKey, minLevel: rc.minLevel },
        targetFact: rc.factKey,
        priority: 'high',
        optional: false,
        customerBurden: 'medium',
        stopCondition: `fact_verified:${rc.factKey}`,
      });
    } else if (rc.type === 'clarify_transaction_scope') {
      // W04：适用面维度缺失（机构/地区/产品/客户区间）→ 内部澄清，不是客户负担
      raw.push({
        questionId: `q-scope-clarify-${rc.ruleId}`,
        audience: 'internal',
        whyNeeded: { type: 'transaction_scope_unknown', ruleId: rc.ruleId ?? null, detail: `交易适用面缺 ${(rc.dims ?? []).join('/')}：规则 ${rc.ruleId} 适用性待核验，不能当"不适用"处理` },
        expectedEvidence: { kind: 'system', note: '补充交易适用面声明后重算' },
        targetFact: null,
        priority: 'high',
        optional: false,
        customerBurden: 'none',
        stopCondition: `transaction_scope_complete:${(rc.dims ?? []).join('|')}`,
      });
    } else if (rc.type === 'correct_rule_input') {
      // W04：条件类型不符（非数值/非布尔/类型不一致）→ 内部数据质量纠正，不编造换算
      raw.push({
        questionId: `q-input-correct-${rc.ruleId}`,
        audience: 'internal',
        whyNeeded: { type: 'rule_input_type_error', ruleId: rc.ruleId ?? null, detail: `规则 ${rc.ruleId} 条件求值类型错误（${rc.errorCode}）：不转安全结论，纠正输入后重算` },
        expectedEvidence: { kind: 'system', note: '纠正输入数值类型/单位口径后重算' },
        targetFact: null,
        priority: 'high',
        optional: false,
        customerBurden: 'none',
        stopCondition: `rule_input_corrected:${rc.ruleId}`,
      });
    }
  }
  for (const uc of gate.unsupportedRuleRefs ?? []) {
    raw.push({
      questionId: `q-internal-unsupported-${uc}`,
      audience: 'internal',
      whyNeeded: { type: 'unsupported_rule_ref', detail: `分析引用了规则包外条文（${uc}）：不激活，需人工确认是否有正式依据` },
      expectedEvidence: { kind: 'governance', note: '正式规则来源核验' },
      targetFact: null,
      priority: 'normal',
      optional: true,
      customerBurden: 'none',
      stopCondition: 'rule_governance_resolved',
    });
  }

  // 去重 + 已核验停止：目标事实已达标 → 不再索要（C16）
  const seen = new Set();
  const questions = [];
  let dedupedCount = 0;
  for (const q of raw) {
    const key = q.targetFact ?? q.questionId;
    if (seen.has(key)) { dedupedCount += 1; continue; }
    seen.add(key);
    if (q.targetFact) {
      const entries = projection.items.filter((it) => it.factKey === q.targetFact);
      const need = rank(minLevels[q.targetFact] ?? q.expectedEvidence?.minLevel ?? 'source_supported');
      if (entries.some((it) => rank(it.verificationLevel) >= need)) {
        dedupedCount += 1;
        continue;
      }
    }
    questions.push(q);
  }
  return {
    questions,
    dedupedCount,
    note: '已充分核验的事实不重复索要；客户拒绝可选问题不触发降额（金额候选器不消费提问应答率）',
  };
}
