// 任务 03 · S3 选择性重算规划器（纯函数）：按证据类型与事实依赖触发相关域重算，
// 不因一条无关留言让四个 Agent 全量重跑（C09）。域运行频率按事件与当前任务优先级控制。
// 依赖映射默认内置（evidenceKind/factKey → 受影响域 + 优先级）；策略可注入覆盖。
// 旧结果保护：结果携带输入水位（watermark/generation），isResultCurrent 判定当前性——
// 已失效候选不能被旧 worker 回写覆盖新候选（C10 的机械基础；缓存层同样执行）。

export const DEFAULT_DEPENDENCY_MAP = Object.freeze({
  byEvidenceKind: Object.freeze({
    document: ['policy', 'credit', 'commerce', 'asset'],
    transcript: ['policy', 'credit', 'asset'],
    message: [],                       // 无事实声明的留言不影响任何域（C09）
    device_observation: ['asset'],
    image: ['asset'],
    video: ['asset'],
    audio: ['credit'],
    // goal-02：进件真实材料 kind（Connectors evidence kind 与此处词汇一致）
    statement: ['credit', 'commerce'],              // 银行流水：经营/负债面（口径注记随事实走）
    tax_filing: ['policy', 'credit'],               // 税报：政策适用面+申报收入
    sales_purchase: ['credit', 'commerce'],         // 进销项：集中度/经营规模
    accounting_ledger: ['credit'],                  // 报表/科目余额：偿债与经营
    equipment_contract: ['asset', 'commerce'],      // 购机合同：资产权属+商务条款
    site_evidence: ['asset'],                       // 现场证据：存在性/铭牌
    media: ['asset'],                               // 现场媒体（与 image 同面）
  }),
  byFactKey: Object.freeze({
    entity_identity_verified: ['policy'],
    equipment_ownership_verified: ['asset', 'policy'],
    equipment_model: ['asset'],
    equipment_deal_amount: ['asset', 'commerce'],
    monthly_operating_cash_flow: ['credit', 'commerce'],
    monthly_debt_service: ['credit', 'commerce'],
    new_debt_monthly_payment: ['credit', 'commerce'],
    top1_customer_revenue_share: ['credit'],
    proposed_monthly_rent: ['commerce'],
    lease_registration_done: ['asset'],
  }),
  policyUpdate: ['policy', 'gate'],   // 规则版本更新 → 政策域重评 + 受影响评估重新核验（C11）
});

/**
 * 规划一次选择性重算。
 * @param p.event {type:'evidence_submitted'|'evidence_superseded'|'message_posted'|'policy_updated',
 *                  evidenceKind?, factKeys?, priority?}
 * @param p.dependencyMap 可选覆盖（须含 byEvidenceKind/byFactKey/policyUpdate）
 * @param p.currentDomainStatus { domain: {watermark, stale} } 当前各域运行状态
 * @returns {recompute:[domain], unchanged:[domain], reasons:[{domain, because}], priority}
 *   recompute 为去重后的受影响域清单；未受影响域进 unchanged（不重跑）。
 */
export function planRecalc({ event, dependencyMap = DEFAULT_DEPENDENCY_MAP, currentDomainStatus = {} }) {
  if (!event || typeof event.type !== 'string') {
    return { recompute: [], unchanged: Object.keys(currentDomainStatus), reasons: [], priority: 'normal', error: '事件缺 type:不猜' };
  }
  const affected = new Map(); // domain → because
  const add = (domain, because, priority) => {
    if (!affected.has(domain) || priority === 'high') affected.set(domain, { because, priority });
  };
  let priority = event.priority ?? 'normal';

  switch (event.type) {
    case 'evidence_submitted':
    case 'evidence_superseded': {
      const kinds = event.evidenceKind ? [event.evidenceKind] : [];
      for (const k of kinds) {
        for (const d of dependencyMap.byEvidenceKind[k] ?? []) add(d, `evidence_kind:${k}`, 'normal');
      }
      for (const fk of event.factKeys ?? []) {
        for (const d of dependencyMap.byFactKey[fk] ?? []) add(d, `fact_key:${fk}`, 'high');
      }
      // 取代事件：所有消费旧版本的域都要重算（旧候选失效）
      if (event.type === 'evidence_superseded' && affected.size === 0) {
        for (const d of ['policy', 'credit', 'commerce', 'asset']) add(d, 'superseded_unknown_consumer', 'high');
      }
      break;
    }
    case 'message_posted': {
      // 留言只在声明影响事实时才触发（默认依赖映射下 message → 空）；带 factKeys 才有资格
      for (const fk of event.factKeys ?? []) {
        for (const d of dependencyMap.byFactKey[fk] ?? []) add(d, `message_fact:${fk}`, 'normal');
      }
      break;
    }
    case 'policy_updated': {
      for (const d of dependencyMap.policyUpdate) add(d, 'policy_updated', 'high');
      priority = 'high';
      break;
    }
    default:
      return { recompute: [], unchanged: Object.keys(currentDomainStatus), reasons: [], priority: 'normal', error: `未知事件类型 ${event.type}:不猜` };
  }

  // 已 stale 或缺水位的域无条件加入重算（陈旧结果不信任）
  for (const [domain, st] of Object.entries(currentDomainStatus)) {
    if (st?.stale === true && !affected.has(domain)) add(domain, 'status_stale', 'high');
  }

  const recompute = [...affected.keys()];
  const unchanged = Object.keys(currentDomainStatus).filter((d) => !recompute.includes(d));
  return {
    recompute,
    unchanged,
    reasons: recompute.map((d) => ({ domain: d, because: affected.get(d).because })),
    priority,
  };
}

/**
 * 结果当前性判定：结果携带的输入水位与当前水位一致才有效（C10/C11 机械判据）。
 * generation 不同 或 规则版本不同 → stale（旧 worker 回写会被缓存/收口层拒绝）。
 */
export function isResultCurrent({ resultWatermark, currentWatermark, resultRulesetVersion, currentRulesetVersion }) {
  if (!resultWatermark || !currentWatermark) return { current: false, because: 'missing_watermark' };
  if (Number(resultWatermark.generation) !== Number(currentWatermark.generation)) {
    return { current: false, because: `generation ${resultWatermark.generation} != ${currentWatermark.generation}` };
  }
  if (resultRulesetVersion !== undefined && currentRulesetVersion !== undefined && resultRulesetVersion !== currentRulesetVersion) {
    return { current: false, because: `ruleset ${resultRulesetVersion} != ${currentRulesetVersion}` };
  }
  return { current: true, because: 'match' };
}
