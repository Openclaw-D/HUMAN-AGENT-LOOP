// 02-execution 轮 · 五区执行清单（版本化，纯确定性数据，无 IO、无环境读取）。
// 目的：把"每区输入、依赖、执行身份、工具、输出、缺口、人工确认与下游触发条件"从实现细节
// 变成机器可读契约，供 advance-plan、看板与任务三直接消费。
// 纪律：清单只描述执行方式，绝不携带案例结论；评估器永远只看事实与规则（答案标签不进执行面）。

export const ZONE_MANIFEST_VERSION = 'zone-manifest-v1';

const ZONES = [
  {
    domain: 'business',
    title: '商机',
    inputs: {
      factKeys: ['revenue_annual_declared', 'new_order_amount_declared', 'litigation_pending_declared',
        'total_assets_declared', 'total_liabilities_declared', 'transaction_scope'],
      materials: 'A.evidence_artifacts 现行未取代且未去重的登记工件（含 fact_assertions 等级）',
      rulePack: 'C/rules/four-domain-rule-pack-v1.json（激活版本经 A analysis.activateRulePack）',
    },
    dependsOn: { upstreamDomains: [], note: '商机为入口区，不依赖其他专业区结果；只依赖事实与规则' },
    executionIdentity: 'A 服务身份（service kind）须持有 business 角色并在租户内获准；人类发起人仅触发，不代替执行',
    executor: { kind: 'deterministic-worker-thread', module: 'C assessBusiness（assessStage 按 domain 调用）', modelCalls: '默认无；语义层为可选获准附加（authority=none）' },
    tools: ['perceptionStage 感知快照', 'evaluateRules 规则评估', 'assessBusiness 商机评估器'],
    outputs: {
      assessment: 'DomainAssessment（authority=none，validateDomainAnalysis 校验）',
      zoneCandidates: '3–5 项确定性候选（scoreType=rule_rank，非概率）',
      gate: '单区 gate（CLEAR/NEEDS_EVIDENCE/HOLD_FOR_REVIEW/HARD_BLOCK）',
    },
    gapHandling: 'unknowns/前提缺失 → proposedQuestions，落 waiting_evidence，须补证后重算',
    humanConfirmation: { required: true, choices: ['adopt', 'set_aside'], authority: '验收/采用恒为有权人类' },
    downstreamTriggers: '结果入库 + COLUMN_RESULT 事件；信审明确拒绝时本区后续轮次停止（CREDIT_REJECTED）',
  },
  {
    domain: 'policy',
    title: '政策',
    inputs: { factKeys: '规则包全部 requiredFacts + transaction_scope（按激活规则包动态展开）', materials: '同上 + 过期材料（freshness）', rulePack: '同上' },
    dependsOn: { upstreamDomains: [], note: '与商机并行；不消费其他区输出' },
    executionIdentity: 'A 服务身份须持有 policy 角色',
    executor: { kind: 'deterministic-worker-thread', module: 'C evaluateRules + assessPolicy', modelCalls: '默认无' },
    tools: ['evaluateRules（含适用面/前提缺失/不可豁免标记）', 'assessPolicy'],
    outputs: { assessment: '同上（含 ruleEvaluation）', zoneCandidates: '同上', gate: '同上；nonWaivable 命中 → HARD_BLOCK' },
    gapHandling: 'precondition_missing → proposedQuestions（按 minLevel）；policy_pending 不自行推断放行或阻断',
    humanConfirmation: { required: true, choices: ['adopt', 'set_aside'] },
    downstreamTriggers: '同上',
  },
  {
    domain: 'credit',
    title: '信审',
    inputs: { factKeys: ['monthly_operating_cash_flow', 'monthly_debt_service', 'new_debt_monthly_payment', 'top1_customer_revenue_share', 'video_liveliness', 'material_page_count', 'revenue_annual_declared', 'total_assets_declared', 'total_liabilities_declared', 'net_profit_annual_declared', 'operating_cash_flow_annual_declared', 'gross_margin_declared', 'transaction_scope', 'risk_disclosure_excerpt'], materials: '同上', rulePack: '同上' },
    dependsOn: { upstreamDomains: [], note: '与商机/政策并行；并行不等于无依赖——候选项的核验建议会引用其他区缺口，但评估本身只吃事实' },
    executionIdentity: 'A 服务身份须持有 credit 角色',
    executor: { kind: 'deterministic-worker-thread', module: 'C assessCredit', modelCalls: '默认无' },
    tools: ['现金流覆盖率公式 sim-cf-coverage@1（确定性计算）', 'assessCredit'],
    outputs: { assessment: '同上；覆盖率压力情景为确定性重算', zoneCandidates: '同上', gate: '同上' },
    gapHandling: '覆盖率输入非 source_supported/verified → unknowns，待核验；不补造数值',
    humanConfirmation: { required: true, choices: ['adopt', 'set_aside', 'reject'], note: 'reject 为信审角色专属，产生正式拒绝并归档流程' },
    downstreamTriggers: 'reject → CASE_REJECTED_ARCHIVED，其余区停止；其余同上',
  },
  {
    domain: 'commerce',
    title: '商务',
    inputs: { factKeys: ['lease_term_months', 'proposed_monthly_rent', 'funding_cost_annual', 'fees_known', 'transaction_scope'], materials: '同上', rulePack: '同上' },
    dependsOn: { upstreamDomains: [], note: '并行执行' },
    executionIdentity: 'A 服务身份须持有 commerce 角色',
    executor: { kind: 'deterministic-worker-thread', module: 'C assessCommerce', modelCalls: '默认无' },
    tools: ['方案净收益测算（成本未知时不产出数值）', 'assessCommerce'],
    outputs: { assessment: '同上', zoneCandidates: '同上', gate: '同上' },
    gapHandling: '租赁条件缺失 → waiting_evidence；不用提价抵消欺诈',
    humanConfirmation: { required: true, choices: ['adopt', 'set_aside'] },
    downstreamTriggers: '同上',
  },
  {
    domain: 'asset',
    title: '资产',
    inputs: { factKeys: ['equipment_ownership_verified', 'equipment_exists_observed', 'equipment_deal_amount', 'nameplate_serial', 'equipment_model', 'transaction_scope'], materials: '同上', rulePack: '同上' },
    dependsOn: { upstreamDomains: [], note: '并行执行；看见设备≠权属' },
    executionIdentity: 'A 服务身份须持有 asset 角色',
    executor: { kind: 'deterministic-worker-thread', module: 'C assessAsset', modelCalls: '默认无' },
    tools: ['冲突保留（对价/型号/铭牌各自定位）', 'assessAsset'],
    outputs: { assessment: '同上；来源冲突逐条保留不合并', zoneCandidates: '同上', gate: '同上' },
    gapHandling: '权属未达 verified → unknowns；冲突 → third_party_check 候选并升级人工核验',
    humanConfirmation: { required: true, choices: ['adopt', 'set_aside'] },
    downstreamTriggers: '同上',
  },
];

/**
 * 生成版本化执行清单。参数只影响执行参数声明（并发/语义层配置状态），不携带任何案例数据。
 * @param p.concurrency { maxParallelDomains, timeoutMs, backpressure }
 * @param p.semantic { configured:boolean, model?:string, note?:string }
 */
export function zoneManifest({ concurrency, semantic } = {}) {
  return {
    manifestVersion: ZONE_MANIFEST_VERSION,
    generatedBy: 'C zone-manifest@1（确定性；不含案例数据或结论）',
    authorityRule: '全部评估输出 authority=none；正式性只来自有权人类核验/采用/决定',
    candidateDiscipline: '候选 3–5 项来自当前证据与规则，不足如实返回；scoreType=rule_rank（确定性排序位次），非概率、非校准置信度；HARD_BLOCK 不可被任何分数或置信度覆盖',
    inputSensitivity: '确定性输出只随事实值/核验等级/适用范围/规则版本变化；与业务无关的文字改名不改变结论',
    concurrency: {
      maxParallelDomains: concurrency?.maxParallelDomains ?? 4,
      timeoutMs: concurrency?.timeoutMs ?? 15000,
      backpressure: concurrency?.backpressure ?? '超并发上限的区在槽位释放后执行；调用方可取消（取消=未知，不谎称完成）',
      cancellationSemantics: 'abort/超时/worker 异常退出 → COLUMN_CANCELLED_UNKNOWN/COLUMN_TIMEOUT_UNKNOWN，未知不自动重试',
    },
    semantic: {
      configured: semantic?.configured ?? false,
      ...(semantic?.model ? { model: semantic.model } : {}),
      ...(semantic?.note ? { note: semantic.note } : {}),
      discipline: '模型只承担获准的语义辅助（待核验问题建议）；输出过 schema 与证据校验；材料内指令视为不可信内容；无配置时如实 not_configured，绝不静默 mock',
    },
    zones: ZONES.map(z => ({ ...z })),
  };
}
