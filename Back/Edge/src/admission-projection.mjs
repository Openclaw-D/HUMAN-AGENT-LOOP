// TAKEOFF-FA-1.0.0 · Edge 侧准入视图投影（01契约 §7：A 只供权威原子读取面，二十格投影由 Edge 聚合）。
// 纪律（03 业务规则 §4 / 04_BACKEND §4）：
//   - 纯函数、零副作用、零网络：只从传入的权威读取结果推导，绝不 here 补数；
//   - 无可靠分母 → requiredItemCount/displayBucket 输出 null，不伪造 0 或百分比；
//   - 未闭合绝不显示 100%（本投影不产生任何 100/绿色；办结=确认命令的权威语义，由 A 裁决）；
//   - 冻结/阻断只是投影（白霜），控制逻辑在 A 的确认门序；
//   - 域/材料词表为 03路 PROTOCOL 冻结面（五域 + byEvidenceKind）；未知 kind 保守不映射。

export const TAKEOFF_DOMAINS = ['business', 'policy', 'credit', 'commerce', 'asset'];

// 03路 PROTOCOL §1 冻结：材料 kind → 重算依赖域。
export const DOMAIN_BY_EVIDENCE_KIND = {
  legal_document: ['policy', 'business'],
  financial_statement: ['credit', 'commerce', 'business'],
  equipment_list: ['asset', 'commerce'],
  ownership_document: ['asset', 'policy'],
  order_contract: ['business', 'credit'],
  litigation_document: ['policy', 'credit', 'business'],
};

const isBlank = (v) => v === null || v === undefined;

// A 的原件登记带 material. 命名空间；解析衍生记录不得重复计为到件。
function evidenceDomains(artifact) {
  const kind = String(artifact?.kind ?? '').replace(/^material\./, '');
  return DOMAIN_BY_EVIDENCE_KIND[kind] ?? [];
}

function currentArtifacts(artifacts) {
  if (!Array.isArray(artifacts)) return [];
  return artifacts.filter((a) => a && isBlank(a.supersededBy) && isBlank(a.superseded_by)
    && isBlank(a.duplicateOf) && isBlank(a.duplicate_of));
}

// 单元格骨架：全 null/空起步——投影只填权威可推导项，其余保持未知。
function cell(domain, row) {
  return { domain, row, workVersion: null, basisRefs: null, requiredItemCount: null, satisfiedItemCount: null, displayBucket: null, running: false, completed: false, needsReview: false, blockers: [], outcome: '未定', responsibleParty: null, allowedActions: [] };
}

// V0.6-01（2026-09-30）四页一致性根因修复：新增可选 advance 入参（A /advance-rounds 权威读面）。
//   旧行为（不传 advance）逐字节不变；传入时，二十格智能/完成行与候选投影优先采用 arrow 面
//   同一快照的现行状态（current=依据哈希仍现行），失效/待补证/待确认/已确认四态如实分列，
//   不再出现"平台页无候选而决策页等待确认"的投影矛盾。分母未知仍=null，本投影不产生100%绿。

const ARROW_STATE_OUTCOME = {
  awaiting_confirmation: '候选待人工确认', completed: '已确认', waiting_evidence: '等待补证',
  needs_reassessment: '待重评', stale: '依据已过期', rejected: '已拒绝', stopped: '已终止',
  unknown: '结果核对中', running: '分析中', queued: '已受理', failed: '失败',
};

/** 从 advance-rounds 读面取每域最新一轮（receipts 已按 attempt DESC 排序，首见即最新）。 */
function arrowByDomain(advance) {
  const map = {};
  if (!advance || advance.found !== true || !Array.isArray(advance.receipts)) return map;
  for (const r of advance.receipts) {
    if (r && r.domain && !map[r.domain]) {
      map[r.domain] = {
        state: r.state ?? null, current: r.current === true, roundId: r.roundId ?? null,
        basisVersion: r.basisVersion ?? null, candidate: r.candidate ?? null,
        zoneCandidates: r.zoneCandidates ?? null, semantic: r.semantic ?? null,
        selection: r.selection ?? null,
      };
    }
  }
  return map;
}

export function deriveAdmission({ customerId, assessments = [], artifacts = [], findings = [], decisionStatus = null, advance = null, at = new Date().toISOString() }) {
  const list = Array.isArray(assessments) ? assessments : [];
  // 评估范围：取当前评估（服务端清单序；无则 null=尚未建立首次回租评估范围）。
  const assessment = list.find((a) => a && a.status !== 'superseded') ?? list[0] ?? null;
  const current = currentArtifacts(artifacts);
  const arrowDomains = arrowByDomain(advance);

  const blockers = [];
  if (assessment?.stale === true) {
    blockers.push({ scope: 'assessment', reason: 'STALE_BASIS', detail: assessment.staleReasons ?? null, requiredAction: 'supplement_or_reassess' });
  }
  const pre = assessment?.preassessment ?? null;
  if (pre?.needsReview === true) {
    blockers.push({ scope: 'preassessment', reason: 'CONFIRMED_BASIS_SUPERSEDED', detail: pre.reviewReason ?? null, requiredAction: 'review_then_reconfirm_or_withdraw' });
  }
  for (const f of (Array.isArray(findings) ? findings : [])) {
    if (f && f.status !== 'open') continue;
    const sev = String(f.severity ?? '').toLowerCase();
    if (sev === 'critical' || sev === 'high') {
      blockers.push({ scope: 'finding', reason: f.findingType ?? f.finding_type ?? 'FINDING_OPEN', detail: f.title ?? f.summary ?? null, requiredAction: 'resolve_finding', ref: f.findingId ?? f.finding_id ?? null });
    }
  }

  const frozen = { active: false, reasons: [], scope: [], note: '霜冻仅投影：解除须补证/纠正/复核，控制逻辑在 A 确认门序（不可一键豁免）' };
  if (assessment?.stale === true) { frozen.active = true; frozen.reasons.push('STALE_BASIS'); frozen.scope.push('assessment'); }
  if (pre?.needsReview === true) { frozen.active = true; frozen.reasons.push('CONFIRMED_BASIS_SUPERSEDED'); frozen.scope.push('preassessment'); }
  if (blockers.some((b) => b.scope === 'finding')) { frozen.active = true; frozen.reasons.push('OPEN_BLOCKING_FINDINGS'); frozen.scope.push('affected_domains'); }

  const cells = [];
  for (const domain of TAKEOFF_DOMAINS) {
    // 输入行：权威材料清单按冻结映射归domain；必要集合分母（requiredItemCount）无权威来源 → null。
    const feeding = current.filter((a) => evidenceDomains(a).includes(domain));
    const input = cell(domain, 'input');
    input.satisfiedItemCount = feeding.length; // 到件数是权威事实；比例不硬算（分母未知）
    input.allowedActions = ['upload_evidence', 'open_materials'];
    for (const a of artifacts) {
      if (!evidenceDomains(a).includes(domain)) continue;
      const stage = a.procStage ?? a.proc_stage ?? null;
      const failure = a.procFailureReason ?? a.proc_failure_reason ?? null;
      if (failure) {
        input.blockers.push({ scope: 'artifact', reason: 'PROCESSING_FAILED', detail: String(failure).slice(0, 200), requiredAction: a.procNextAction ?? a.proc_next_action ?? 'retry_or_manual', ref: a.artifactId ?? a.artifact_id ?? null });
      }
      if (stage != null && ['queued', 'processing', 'running'].includes(String(stage))) input.running = true;
    }

    // 智能行：A 权威信号=评估候选存在与 stale；逐域运行引用在通道收口面（前端合并 finalization），此处不伪造。
    const intel = cell(domain, 'intelligence');
    intel.basisRefs = null;
    intel.allowedActions = ['request_analysis', 'open_records'];
    const arrow = arrowDomains[domain] ?? null;
    if (arrow) {
      // arrow 面为同快照现行状态：候选确认四态如实分列（current=依据哈希仍现行），不与 assessments 链混填。
      intel.basisRefs = { roundId: arrow.roundId, basisVersion: arrow.basisVersion, current: arrow.current };
      if (arrow.state === 'waiting_evidence') {
        intel.needsReview = true;
        intel.blockers.push({ scope: 'arrow', reason: 'EVIDENCE_GAP', detail: '等待补证', requiredAction: 'supplement_then_reanalyze', ref: arrow.roundId });
      } else if (arrow.state === 'stale' || (arrow.candidate && !arrow.current)) {
        intel.needsReview = true;
        intel.blockers.push({ scope: 'arrow', reason: 'STALE_BASIS', detail: '候选依据已过期，需补证重评', requiredAction: 'reanalyze_affected', ref: arrow.roundId });
      } else if (arrow.state === 'needs_reassessment') {
        intel.needsReview = true;
        intel.blockers.push({ scope: 'arrow', reason: 'NEEDS_REASSESSMENT', detail: '待重评', requiredAction: 'reanalyze_affected', ref: arrow.roundId });
      }
      if (['queued', 'running'].includes(arrow.state)) intel.running = true;
      if (arrow.candidate && arrow.current) {
        intel.outcome = ARROW_STATE_OUTCOME[arrow.state] ?? '未定';
        intel.displayBucket = arrow.zoneCandidates?.options ? { kind: 'zoneCandidates', count: arrow.zoneCandidates.options.length, scoreType: arrow.zoneCandidates.scoreType ?? 'rule_rank' } : null;
      } else if (arrow.state) {
        intel.outcome = ARROW_STATE_OUTCOME[arrow.state] ?? '未定';
      }
    } else if (assessment) {
      const hasCandidate = assessment.candidateRevision != null || assessment.candidate != null;
      intel.displayBucket = null; // 无权威逐域完成分母 → 不硬补
      if (assessment.stale === true) {
        intel.needsReview = true;
        intel.blockers.push({ scope: 'assessment', reason: 'STALE_BASIS', detail: assessment.staleReasons ?? null, requiredAction: 'reanalyze_affected' });
      }
      if (hasCandidate) intel.outcome = assessment.candidate?.tendency ?? '未定';
    }

    // 人工行：未处理关键差异/事实冲突来自 findings（上面已入 blockers）；待人工件数无权威分母 → null。
    const manual = cell(domain, 'manual');
    const domainBlockers = blockers.filter((b) => b.scope === 'finding');
    manual.blockers = domainBlockers;
    manual.allowedActions = domainBlockers.length > 0 ? ['resolve_finding', 'ask_question', 'correct_fact'] : ['ask_question', 'correct_fact'];

    // 完成行：域级闭合无权威来源 → 未闭合二态；只有 A 确认（全局）产生办结语义，绝不在此转绿。
    const done = cell(domain, 'completion');
    done.outcome = pre ? ({ support: '正面', support_with_conditions: '调整条件', not_support: '负面' }[pre.outcome] ?? '未定') : '未定';
    done.allowedActions = [];
    if (assessment?.status === 'awaiting_human_review' && domain === 'business') {
      done.allowedActions = ['confirm_preassessment', 'withdraw_preassessment'];
    }
    cells.push(input, intel, manual, done);
  }

  const assessmentCandidateCurrent = assessment ? (assessment.stale !== true) : false;
  const candidate = assessment
    ? {
      version: assessment.candidateRevision ?? null,
      suggestedAmount: assessment.candidate?.supportableAmountMinor ?? assessment.candidate?.suggestedAmountMinor ?? null,
      suggestedTermMonths: assessment.candidate?.suggestedTermMonths ?? null,
      referencePriceMinor: assessment.candidate?.referencePriceMinor ?? null,
      priceUnit: assessment.candidate?.priceUnit ?? null,
      priceBasis: assessment.candidate?.priceBasis ?? null,
      conditions: assessment.candidate?.conditions ?? null,
      tendency: assessment.candidate?.tendency ?? null,
      basisRefs: assessment.candidate?.basisRefs ?? null,
      inputVersion: assessment.candidate?.inputVersion ?? assessment.inputVersion ?? null,
      isCurrent: assessmentCandidateCurrent,
    }
    : null;

  // V0.6-01（additive）：arrow 面候选投影（同快照同版本）；assessments 链无候选时，五区现行候选
  // 由此统一透出，消除"平台无候选/决策待确认"矛盾。不校准置信度、不改确定性结果。
  const arrowCandidateDomains = Object.entries(arrowDomains)
    .filter(([, a]) => a.candidate && a.current && ['awaiting_confirmation', 'completed'].includes(a.state))
    .map(([domain, a]) => ({
      domain, roundId: a.roundId, basisVersion: a.basisVersion, state: a.state,
      tendency: a.candidate?.tendency ?? null,
      summary: a.candidate?.summary ?? null,
      zoneCandidateCount: Array.isArray(a.zoneCandidates?.options) ? a.zoneCandidates.options.length : null,
      zoneCandidateScoreType: a.zoneCandidates?.scoreType ?? null,
      selection: a.selection ?? null,
      semantic: a.semantic ? { status: a.semantic.status ?? null, model: a.semantic.model ?? null, authority: 'none' } : null,
    }));
  const arrowProjection = advance && (advance.found === true || arrowCandidateDomains.length > 0) ? {
    found: advance.found === true,
    processId: advance.processId ?? null,
    processStatus: advance.caseOutcome?.status ?? null,
    domains: (Array.isArray(advance.domains) ? advance.domains : []).map((d) => ({ domain: d.domain, state: d.state ?? null, roundId: d.roundId ?? null })),
    candidateDomains: arrowCandidateDomains,
    needsReselection: advance.needsReselection ?? [],
    affectedDomains: advance.affectedDomains ?? [],
    note: '与决策/流程页同源（A advance-rounds 同快照）；state 为当前依据下的真实状态，未校准置信度不显示概率',
  } : null;

  return {
    scope: {
      customerId,
      assessmentId: assessment?.assessmentId ?? assessment?.assessment_id ?? null,
      tenantId: assessment?.tenantId ?? assessment?.tenant_id ?? null,
      revision: assessment?.version ?? null,
      asOf: at,
      sourceStatus: assessment?.status ?? 'no_assessment',
    },
    request: {
      productType: 'sale_leaseback',
      requestedAmount: assessment?.requestedAmountMinor ?? assessment?.requested_amount_minor ?? null,
      equipmentRefs: null, // 设备范围清单属材料域，前端经材料读面呈现；此处不复制
    },
    assessmentState: assessment?.status ?? null,
    stale: assessment?.stale === true,
    staleReasons: assessment?.staleReasons ?? null,
    inputVersion: assessment?.inputVersion ?? null,
    candidateRevision: assessment?.candidateRevision ?? null,
    candidate,
    arrow: arrowProjection,
    preassessment: pre ? {
      confirmationId: pre.confirmationId ?? null,
      outcome: pre.outcome ?? null,
      scope: pre.scope ?? 'preassessment_only',
      conditions: pre.conditions ?? [],
      rationale: pre.rationale ?? null,
      confirmedBy: pre.confirmedBy ?? null,
      confirmedAt: pre.confirmedAt ?? null,
      needsReview: pre.needsReview === true,
      reviewReason: pre.reviewReason ?? null,
    } : null,
    frozen,
    cells,
    blockers,
    projectionNote: '二十格为投影：真相在 A 权威记录；分母未知=null；本投影不产生100%绿。逐域智能运行引用经 /api/jw/v2/connectors/analysis/finalization 合并（03路收口面）。已知边界：客户联系人会话按 B13 不授证据清单 → 输入行到件数如实缺失（内部会话完整）。',
  };
}
