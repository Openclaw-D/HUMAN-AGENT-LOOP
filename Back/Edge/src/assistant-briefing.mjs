// V0.5 收尾轮（03路）· 助手确定性说明（无模型时的案例说明层）。
// 边界（00_SCOPE §接口与协作）：
// - 不是模型回答：只从服务端现行工作本快照（登记事实/现行材料/解析信封）确定性组装，authority=none。
// - 来源显式标注"案例说明"；自由问答未配置模型时如实标注不可用——不伪装真实模型答复、
//   不包装校准概率、不产生审批效力。
// - 同快照同问题 → 同输出（确定性）；零模型出站；模型已配置时本模块不参与（走既有 observe 链）。

export const BRIEFING_SOURCE = 'server_state_briefing（案例说明，非模型回答）';

const DOMAIN_TITLES = {
  business: '商机', policy: '政策', credit: '信审', commerce: '商务', asset: '资产', jianwei: '见微',
};

/** 从工作本快照抽取现行事实（A 登记工件 factKey 行 + 01路 parse 信封 declaredFactSummaries 展开）。 */
export function currentFacts(snapshot) {
  const snap = snapshot?.snapshot ?? snapshot ?? {};
  const arts = Array.isArray(snap.artifacts) ? snap.artifacts : [];
  const facts = [];
  const seen = new Map();
  for (const a of arts) {
    if (a.current === false || a.supersededBy || a.duplicateOf) continue;
    const fk = a.factKey ?? a.fact_key ?? null;
    if (fk && !String(fk).startsWith('parse:') && !String(fk).startsWith('material.')) {
      const v = a.value ?? a.content?.value ?? null;
      const val = v && typeof v === 'object' && Object.hasOwn(v, 'value') ? v.value : v;
      const unit = v && typeof v === 'object' ? (v.unit ?? null) : null;
      facts.push({ factKey: String(fk), value: val, unit, grade: a.grade ?? null, current: a.current !== false });
    }
    const dfs = a.value?.declaredFactSummaries;
    if (Array.isArray(dfs)) {
      for (const d of dfs) {
        if (!d?.factKey || String(d.factKey).includes('，') || String(d.factKey).length > 60) continue; // keyvalue 噪声键不入说明
        seen.set(d.factKey, { factKey: d.factKey, value: d.value, unit: d.unit ?? null, grade: d.level ?? 'declared', current: true });
      }
    }
  }
  // 有明确登记行时不重复展示解析摘要；多个现行断言全部呈现，不能以最后一条冒充已消除冲突。
  const registered = new Set(facts.map(f => f.factKey));
  return [...seen.values()].filter(f => !registered.has(f.factKey)).concat(facts);
}

/** 确定性说明正文（按助手域聚焦；全部来自现行快照，无推测、无编造）。 */
export function buildBriefing({ snapshot, customerId, assistant, question }) {
  const snap = snapshot?.snapshot ?? snapshot ?? {};
  const customer = snap.customer ?? snap.admission?.customer ?? {};
  const name = customer.displayName ?? customer.display_name ?? '当前客户';
  const facts = currentFacts(snapshot);
  const arts = Array.isArray(snap.artifacts) ? snap.artifacts : [];
  const materials = arts.filter((a) => String(a.factKey ?? a.fact_key ?? '').startsWith('material.') || (!a.factKey && !a.fact_key && a.sha256));
  const title = DOMAIN_TITLES[assistant] ?? assistant;
  const lines = [];
  lines.push(`【${title}视角 · 案例说明】以下是服务端当前登记状态的确定性说明（非模型回答，不构成审批意见）。`);
  lines.push(`客户：${name}。`);
  // 聚焦域的事实键（与 C zone-manifest 消费面对应的常用键；其余归入"其他登记"）
  const FOCUS = {
    business: ['revenue_annual_declared', 'new_order_amount_declared', 'litigation_pending_declared', 'total_assets_declared', 'total_liabilities_declared'],
    policy: ['transaction_scope', 'equipment_ownership_verified', 'entity_identity_verified', 'monthly_operating_cash_flow', 'monthly_debt_service'],
    credit: ['monthly_operating_cash_flow', 'monthly_debt_service', 'new_debt_monthly_payment', 'top1_customer_revenue_share'],
    commerce: ['proposed_monthly_rent', 'lease_term_months', 'funding_cost_annual', 'fees_known'],
    asset: ['equipment_ownership_verified', 'equipment_exists_observed', 'equipment_deal_amount', 'nameplate_serial', 'equipment_net_book_value_total'],
    jianwei: [],
  };
  const want = FOCUS[assistant] ?? [];
  const focused = facts.filter((f) => want.includes(f.factKey));
  const labels = { revenue_annual_declared: '申报年收入', total_assets_declared: '申报资产总额', total_liabilities_declared: '申报负债总额', new_order_amount_declared: '在手订单金额', litigation_pending_declared: '存在待决诉讼', entity_identity_verified: '主体身份核验', equipment_ownership_verified: '设备权属核验', monthly_operating_cash_flow: '月经营现金流', monthly_debt_service: '月偿债金额', new_debt_monthly_payment: '新增债务月付款', top1_customer_revenue_share: '最大客户收入占比', proposed_monthly_rent: '拟定月租金', lease_term_months: '租赁期限', funding_cost_annual: '年度资金成本', fees_known: '费用是否明确', equipment_exists_observed: '设备已观察存在', equipment_deal_amount: '设备交易对价', nameplate_serial: '设备铭牌编号', equipment_net_book_value_total: '设备账面净值' };
  const grades = { confirmed: '已核验', verified: '已核验', source_supported: '有来源支持', unverified: '待核验', declared: '申报值' };
  const fmt = (f) => `${labels[f.factKey] ?? f.factKey}：${typeof f.value === 'boolean' ? f.value ? '是' : '否' : JSON.stringify(f.value) ?? String(f.value)}${f.unit ? ` ${f.unit === 'CNY' ? '元' : f.unit === 'wan' ? '万元' : f.unit}` : ''}（${grades[f.grade] ?? f.grade ?? '等级未标'}）`;
  if (focused.length > 0) {
    lines.push(`本专业关注的现行登记事实（${focused.length} 项）：`);
    for (const f of focused) lines.push(`· ${fmt(f)}`);
  } else {
    lines.push(`本专业暂无已登记的聚焦事实（未知不补数）。`);
  }
  lines.push(`现行材料 ${materials.length} 件；全部事实以"材料"页原件与解析记录为准。`);
  // 步骤解释：当前问题若命中事实键，指到对应事实；否则给通用只读指引
  const q = String(question ?? '');
  const hit = facts.find((f) => q.includes(f.factKey));
  if (hit) {
    lines.push(`你的问题涉及登记事实：${fmt(hit)}。可到"材料"页查看其来源原件与解析依据。`);
  } else {
    lines.push(`说明与下一步：查看"平台/决策"页当前专业候选与所需人工动作；本说明只读，不代替人工确认。`);
  }
  lines.push(`（自由问答需要配置模型；当前未配置——本条为确定性案例说明，来源：服务端现行状态。）`);
  return {
    ok: true,
    mode: 'deterministic_briefing',
    authority: 'none',
    scope: 'preassessment_only',
    customerId: customerId ?? customer.customerId ?? null,
    assistant,
    sent: false,
    model: null,
    answer: lines.join('\n'),
    source: BRIEFING_SOURCE,
    freeFormAvailable: false,
    basis: { facts: facts.length, materials: materials.length, assistant, generatedAt: new Date().toISOString() },
    note: '自由问答未配置模型：以上为基于服务端现行登记状态的确定性说明（案例说明），非模型回答、非审批意见',
  };
}
