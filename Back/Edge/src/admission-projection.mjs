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

export function deriveAdmission({ customerId, assessments = [], artifacts = [], findings = [], decisionStatus = null, at = new Date().toISOString() }) {
  const list = Array.isArray(assessments) ? assessments : [];
  // 评估范围：取当前评估（服务端清单序；无则 null=尚未建立首次回租评估范围）。
  const assessment = list.find((a) => a && a.status !== 'superseded') ?? list[0] ?? null;
  const current = currentArtifacts(artifacts);

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
    if (assessment) {
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
      isCurrent: true,
    }
    : null;

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
