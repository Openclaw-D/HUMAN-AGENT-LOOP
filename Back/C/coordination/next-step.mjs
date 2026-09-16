// 任务 03 · S4 内部协调与单一下一步：见微（jianwei）汇总四域建议为一条下一步提示，
// 不自动拥有四域正式审批权；四域默认不同时对客户讲话（customer 受众须人工选择/授权发送）；
// 远程转现场/第三方核验 = targeted escalation，写清远程缺什么、现场解决什么。

const DOMAIN_LABEL = { policy: '政策', credit: '信审', commerce: '商务', asset: '资产' };

/**
 * 汇总单一下一步建议。
 * @param p.domainAnalyses 四域分析包（可含异常状态域）
 * @param p.gate Gate 结果
 * @param p.questionPlan planQuestions 产物
 * @param p.amountCandidate computeAmountCandidate 产物（可 null）
 */
export function coordinateNextStep({ domainAnalyses = {}, gate, questionPlan, amountCandidate = null }) {
  const disagreements = [];
  const domains = Object.keys(domainAnalyses);
  const positives = domains.filter((d) => domainAnalyses[d]?.assessment
    && (domainAnalyses[d].assessment.findingsSuspicion ?? []).length === 0
    && (domainAnalyses[d].assessment.contradictions ?? []).length === 0);
  const negatives = domains.filter((d) => domainAnalyses[d]?.assessment
    && ((domainAnalyses[d].assessment.findingsSuspicion ?? []).length > 0
      || (domainAnalyses[d].assessment.contradictions ?? []).length > 0));
  if (positives.length > 0 && negatives.length > 0) {
    // 展示分歧、依据与责任人，不简单多数表决（C19）
    disagreements.push({
      kind: 'domain_disagreement',
      positive: positives.map((d) => ({ domain: d, label: DOMAIN_LABEL[d] ?? d })),
      negative: negatives.map((d) => ({ domain: d, label: DOMAIN_LABEL[d] ?? d })),
      resolution: '分歧按各自依据与复核责任人呈现，由人裁决；不做多数表决',
    });
  }

  const customerQuestions = (questionPlan?.questions ?? []).filter((q) => q.audience === 'customer');
  const internalQuestions = (questionPlan?.questions ?? []).filter((q) => q.audience !== 'customer');
  const priorityOrder = { blocking: 0, high: 1, normal: 2 };
  const top = [...customerQuestions].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])[0] ?? null;

  const escalations = [];
  for (const d of negatives) {
    const a = domainAnalyses[d].assessment;
    for (const s of a.findingsSuspicion ?? []) {
      if (a.contradictions.length > 0 || s.note.includes('冲突') || s.note.includes('权属')) {
        escalations.push({
          escalateTo: 'onsite_or_third_party',
          domain: d,
          whatRemoteMissed: s.note,
          whatVerificationResolves: '现场盘点或第三方（登记机关/原厂）核验解决事实冲突',
          triggerEvidence: s.evidenceRefs ?? [],
          note: 'targeted escalation：仅当身份无法远程核实/资产连续性不足/权属冲突无法远程排除；不一遇问题就要求现场，也不为坚持全远程放行未知',
        });
      }
    }
  }

  const nextStep = gate.result === 'HARD_BLOCK'
    ? `硬门命中（规则 ${gate.ruleIds.join('/')}）：指定动作已阻断；下一步=事实纠正后重算或治理流程更新规则，无通用放行`
    : gate.result === 'HOLD_FOR_REVIEW'
      ? `暂停待复核（${gate.reasonCodes.join('/')}）：${top ? `建议向客户核验「${top.targetFact ?? top.questionId}」（${top.whyNeeded.detail}）` : '由复核人处理内部分歧/未完成域'}`
      : gate.result === 'NEEDS_EVIDENCE'
        ? `需补证（${gate.reasonCodes.join('/')}）：${top ? `建议请求「${top.expectedEvidence.kind}」以核验 ${top.targetFact}` : '等待证据'}`
        : '未发现命中（声明范围内）：可进入下一步人工流程；CLEAR 不等于保证安全';

  return {
    singleNextStep: nextStep,
    audienceQueues: {
      customer: {
        questions: customerQuestions,
        policy: '默认不自动发送；由人选择或按已授权规则发送；四域不同时对客户讲话',
      },
      internal: {
        questions: internalQuestions,
        disagreements,
        escalations,
        note: '内部风控意见不出站到客户侧；受众标记由服务端验证',
      },
    },
    amountHeadline: amountCandidate?.evaluable
      ? `候选可支持区间上限 ${amountCandidate.candidateRange.max} ${amountCandidate.candidateRange.currency}（演示公式，非批准）`
      : '金额候选不可评估（缺关键输入/未配置模型），只报缺口',
    jianweiRole: '见微=汇总与协调单一下一步提示；不自动拥有四域的正式审批权',
    customerInstructionBoundary: '客户自然语言指令不能修改政策、角色或审批（提权指令由确定性层忽略并留档）',
  };
}
