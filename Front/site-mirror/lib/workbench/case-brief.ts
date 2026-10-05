// V0.6-R2-02 · 四页统一业务简报（纯函数，零 import，与 takeoff-projection 同纪律）。
// 目标（docs/codex-handoff/v06-real-ai/02_FRONTEND.md §2）：
// - 每屏固定回答“这是什么客户／现在怎么样／为什么／下一步谁做什么”；
// - 四页共享同客户同版本解释；中文业务词，不倒 JSON，不显示内部 ID；
// - 只消费服务端读面字段；未知/未登记如实说（未知≠0），不编造金额、概率或操作人。
// R2 整改（ACCEPTANCE_REVIEW 阻断项1/2，01-back BUSINESS_EXPLANATION v1 §2.1）：
// - 五区进度与下一步优先消费 admission.arrow（Edge 与 advance-rounds 同快照同源）；
//   assessments 链仅在 arrow 缺失时回退，不得用旧评估覆盖已完成/陈旧/重选状态；
// - 当前评估=清单序首条非 superseded（A 清单按 assessment_id DESC 最新在前；与 Edge
//   admission-projection 同规则），不盲取末条；
// - 快照未读到=加载中，不冒充“未开始”；材料读取失败区分“无权限”与“暂时不可读”；
// - awaiting_confirmation≠completed≠stale/affectedDomains≠waiting_evidence≠unknown，
//   五态如实分列不合并；rule_rank 是规则排序非概率，不显示百分比。

/** admission.arrow 投影的最小形状（就地内联；缺字段=未知，不编造）。 */
export interface ArrowCandidateDomain {
  domain?: string | null;
  roundId?: string | null;
  basisVersion?: string | null;
  state?: string | null;
  tendency?: string | null;
  summary?: string | null;
  zoneCandidateCount?: number | null;
  zoneCandidateScoreType?: string | null;
  selection?: { decision?: string | null } | null;
  semantic?: { status?: string | null; model?: string | null; authority?: string | null } | null;
}

export interface ArrowProjection {
  found?: boolean;
  processId?: string | null;
  processStatus?: string | null;
  domains?: Array<{ domain?: string | null; state?: string | null; roundId?: string | null }> | null;
  candidateDomains?: Array<ArrowCandidateDomain | null> | null;
  needsReselection?: Array<{ domain?: string | null; reason?: string | null } | string | null | undefined> | null;
  affectedDomains?: Array<string | { domain?: string | null } | null | undefined> | null;
  note?: string | null;
}

/** TakeoffSource 的最小形状（就地内联，保持本模块零 import）。 */
export interface CaseBriefSource {
  customerName?: string | null;
  currentMaterials?: number | null;
  /** 材料清单读取失败的 HTTP 状态（403=当前身份无权读取；null/缺省=未失败）。 */
  materialsReadError?: number | null;
  factConflicts?: number;
  /** 冲突事实键列表（FINAL-02：服务端 factConflicts 元素含 {factKey,assertionCount}；
   * 用于把冲突下一步分派到事实实际所属专业的角色。缺省=旧调用方/键未知。 */
  factConflictKeys?: string[];
  /** 处理通道任务（TakeoffSource.channelTasks 同形；“已上传待分析”的在途信号，缺省=未知）。 */
  channelTasks?: Array<{ status?: string }> | null;
  /** NIGHT-FF2：advance-plan 计划面静态投影（available:false 且有已映射原因时由调用方传入）。
   * text=规则完整句/next=下一步完整句/short=顶部短句；来自共享 PLAN_REASON_CN，不新增制度。 */
  planBlock?: { domain?: string | null; reason?: string | null; text: string; next: string; short: string } | null;
  snapshot?: {
    customer?: { displayName?: string; status?: string } | null;
    assessments?: Array<{
      status?: string | null;
      stale?: boolean | null;
      requestedAmountMinor?: number | null;
      candidate?: {
        tendency?: string | null;
        supportableAmountMinor?: number | null;
        currency?: string | null;
        suggestedTermMonths?: number | null;
      } | null;
    }> | null;
    admission?: {
      request?: { requestedAmount?: number | null } | null;
      candidate?: {
        suggestedAmount?: number | null;
        suggestedTermMonths?: number | null;
        tendency?: string | null;
        conditions?: string[] | null;
        isCurrent?: boolean;
      } | null;
      arrow?: ArrowProjection | null;
      preassessment?: { outcome?: string | null; needsReview?: boolean | null } | null;
      frozen?: { active?: boolean; reasons?: string[] } | null;
    } | null;
    decisionStatus?: {
      basis?: {
        gate?: { result?: string | null } | null;
        blockedActions?: string[];
        currency?: Array<{ domain?: string; currency?: string; reasons?: string[] }>;
      } | null;
    } | null;
    session?: { openQuestions?: number } | null;
  } | null;
}

export interface CaseBriefLine {
  key: string;
  label: string;
  text: string;
  /** 是否需要人工注意（冲突/缺件/红线/过时），前端可强调。 */
  attention: boolean;
}

export interface CaseBrief {
  /** 这是什么客户 */
  background: string;
  /** 现在怎么样 */
  situation: CaseBriefLine[];
  /** 为什么（原因；无原因时如实说尚未形成） */
  reasons: string[];
  /** 下一步谁做什么 */
  nextStep: { who: string; what: string; /** 顶部首显短句（原因+一项动作）；完整依据句仍在，展开区可达。 */ short?: string };
  /** 不确定性口径：候选未确认、概率未显示等。 */
  caution: string;
}

const ASSESSMENT_STATUS_CN: Record<string, string> = {
  collecting: '正在收集材料',
  candidate_ready: '已有建议方案',
  awaiting_human_review: '等待人工确认',
  preassessment_confirmed: '结论已确认',
  rejected: '不支持',
  superseded: '已撤回',
};

export function assessmentStatusCn(status: string | null | undefined): string {
  if (!status) return '状态未登记';
  return ASSESSMENT_STATUS_CN[String(status)] ?? `状态：${String(status)}`;
}

const GATE_RESULT_CN: Record<string, string> = {
  pass: '通过',
  rejected: '未通过',
  unknown: '结果未知',
};

export function gateResultCn(result: string | null | undefined): string {
  if (!result) return '';
  return GATE_RESULT_CN[String(result)] ?? String(result);
}

const TENDENCY_CN: Record<string, string> = {
  do: '可做（支持）',
  do_with_adjusted_terms: '可做（调整条件后支持）',
  do_not: '不做（负面）',
  review: '待复核',
};

const DOMAIN_CN: Record<string, string> = {
  business: '业务', opportunity: '商机', policy: '政策', credit: '信审', commerce: '商务', asset: '资产',
};

/** 五区 arrow 状态→中文（与 Edge admission-projection ARROW_STATE_OUTCOME 同口径，另含
 * advance 读面出现的 not_started/waiting_dependency；未知原样保留，不编造）。 */
const ARROW_STATE_CN: Record<string, string> = {
  awaiting_confirmation: '候选待人工确认',
  completed: '已确认',
  waiting_evidence: '等待补证',
  needs_reassessment: '待重评',
  stale: '依据已过期',
  rejected: '已拒绝',
  stopped: '已终止',
  unknown: '结果核对中',
  running: '分析中',
  queued: '已受理',
  failed: '失败',
  not_started: '未开始',
  waiting_dependency: '等待前序办理',
};

/** 需要人工介入的 arrow 状态（其余=系统在途或已收口）。 */
const ARROW_ATTENTION_STATES = new Set(['awaiting_confirmation', 'waiting_evidence', 'stale', 'needs_reassessment', 'failed']);

export function arrowStateCn(state: string | null | undefined): string {
  if (!state) return '状态未登记';
  return ARROW_STATE_CN[String(state)] ?? `状态：${String(state)}`;
}

export function tendencyCn(t: string | null | undefined): string {
  if (!t) return '倾向未登记';
  return TENDENCY_CN[String(t)] ?? `倾向：${String(t)}`;
}

function domainCn(d: string | null | undefined): string {
  if (!d) return '未登记域';
  return DOMAIN_CN[String(d)] ?? String(d);
}

/** 五区→对应专业角色（01-back PERMISSION_TABLE_R3：各区确认绑各域专业，仅预评估终点与
 * 明确拒绝属信审；R3-02 起下一步按真实角色指向，不把全部专业确认绑定信审审批）。 */
const DOMAIN_ROLE_CN: Record<string, string> = {
  business: '客户经理（业务）',
  policy: '政策合规专员',
  credit: '信审专员',
  commerce: '商务专员',
  asset: '资产评估专员',
};

function domainRolesCn(domains: string[]): string {
  const roles = [...new Set(domains.map((d) => DOMAIN_ROLE_CN[String(d)] ?? domainCn(d)))];
  return roles.join('、');
}

/** 冲突事实键→所属专业（CLOSE-02 修订：按后端权威域键集 Back/B/src/worker/column-dependencies.mjs
 * KEYSETS 对齐——冲突下一步的“谁”=该事实结论依赖的专业，与 advance-plan.affectedDomains 同语义；
 * FINAL_BACK_CONTRACT §3 实证 equipment_deal_amount 仅属 asset 键集（更正只打 asset 域）。
 * transaction_scope 为全局共享键（每域 deps 都含），冲突时影响五区→列全专业。
 * 键未知时返回空数组，由调用方如实兜底，不冒充已知归属、不泛指信审。 */
function factKeyDomains(keys: string[]): string[] {
  const KEYSETS: Record<string, string[]> = {
    business: ['revenue_annual_declared', 'new_order_amount_declared', 'litigation_pending_declared', 'total_assets_declared', 'total_liabilities_declared'],
    credit: ['monthly_operating_cash_flow', 'monthly_debt_service', 'new_debt_monthly_payment', 'top1_customer_revenue_share', 'video_liveliness', 'material_page_count'],
    commerce: ['lease_term_months', 'proposed_monthly_rent', 'funding_cost_annual', 'fees_known'],
    asset: ['equipment_ownership_verified', 'equipment_exists_observed', 'equipment_deal_amount', 'nameplate_serial', 'equipment_model'],
    policy: ['entity_identity_verified'],
  };
  const out = new Set<string>();
  for (const key of keys) {
    if (key === 'transaction_scope') { ['business', 'policy', 'credit', 'commerce', 'asset'].forEach((d) => out.add(d)); continue; }
    const hit = Object.keys(KEYSETS).find((domain) => KEYSETS[domain].includes(key));
    if (hit) out.add(hit);
  }
  return [...out];
}

function fmtMinorCn(minor: number | null | undefined, currency?: string | null): string {
  if (typeof minor !== 'number' || !Number.isFinite(minor)) return '待评估';
  const WAN = 1_000_000;
  const s = Math.abs(minor) >= WAN
    ? `${(minor / WAN).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 万元`
    : `${(minor / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 元`;
  return currency && currency !== 'CNY' ? `${s}（${currency}）` : s;
}

/** 当前评估=清单序首条非 superseded（A 清单按 assessment_id DESC 最新在前；空清单=null=尚未建立）。 */
export function currentAssessmentOf<T extends { status?: string | null }>(list: Array<T | null | undefined> | null | undefined): T | null {
  const arr = Array.isArray(list) ? list : [];
  const firstUsable = arr.find((a) => a && a.status !== 'superseded');
  return (firstUsable ?? arr[0] ?? null) as T | null;
}

interface ArrowFacts {
  usable: boolean;
  /** 域→状态（domains 为主，candidateDomains 补充缺字段域）。 */
  stateByDomain: Map<string, string>;
  /** 需重新选择/受依据变化影响的域（去重后）。 */
  reselectDomains: string[];
  /** 候选现行且待人工确认（尚无人工选择）的域。 */
  pendingConfirm: ArrowCandidateDomain[];
  waitingEvidence: string[];
  failed: string[];
  inFlight: string[];
  completedAll: boolean;
  anyCompleted: boolean;
  processRejected: boolean;
}

function collectArrowFacts(arrow: ArrowProjection | null | undefined): ArrowFacts {
  const stateByDomain = new Map<string, string>();
  const usable = arrow != null && (
    arrow.found === true
    || (Array.isArray(arrow.candidateDomains) && arrow.candidateDomains.length > 0)
    || (Array.isArray(arrow.domains) && arrow.domains.length > 0)
  );
  if (!usable) {
    return { usable: false, stateByDomain, reselectDomains: [], pendingConfirm: [], waitingEvidence: [], failed: [], inFlight: [], completedAll: false, anyCompleted: false, processRejected: false };
  }
  for (const d of Array.isArray(arrow?.domains) ? arrow!.domains! : []) {
    if (d?.domain) stateByDomain.set(String(d.domain), String(d.state ?? 'unknown'));
  }
  for (const c of Array.isArray(arrow?.candidateDomains) ? arrow!.candidateDomains! : []) {
    if (c?.domain && !stateByDomain.has(String(c.domain)) && c.state) stateByDomain.set(String(c.domain), String(c.state));
  }
  const reselect = new Set<string>();
  for (const r of Array.isArray(arrow?.needsReselection) ? arrow!.needsReselection! : []) {
    reselect.add(typeof r === 'string' ? r : String(r?.domain ?? ''));
  }
  for (const a of Array.isArray(arrow?.affectedDomains) ? arrow!.affectedDomains! : []) {
    reselect.add(typeof a === 'string' ? a : String(a?.domain ?? ''));
  }
  reselect.delete('');
  // 等待补证的域归补证出口（补齐后自动重算），不与“依据已更新须重选”混说。
  for (const d of [...reselect]) {
    const st = stateByDomain.get(d);
    if (st === 'waiting_evidence' || st === 'not_started' || st === 'waiting_dependency') reselect.delete(d);
  }
  const pendingConfirm: ArrowCandidateDomain[] = [];
  const waitingEvidence: string[] = [];
  const failed: string[] = [];
  const inFlight: string[] = [];
  let completedAll = stateByDomain.size >= 5;
  let anyCompleted = false;
  for (const [domain, state] of stateByDomain) {
    if (state === 'completed') anyCompleted = true;
    else completedAll = false;
    if (state === 'waiting_evidence') waitingEvidence.push(domain);
    if (state === 'failed') failed.push(domain);
    if (state === 'running' || state === 'queued') inFlight.push(domain);
  }
  for (const c of Array.isArray(arrow?.candidateDomains) ? arrow!.candidateDomains! : []) {
    if (c && c.state === 'awaiting_confirmation' && !c.selection) pendingConfirm.push(c);
  }
  return {
    usable: true,
    stateByDomain,
    reselectDomains: [...reselect],
    pendingConfirm,
    waitingEvidence,
    failed,
    inFlight,
    completedAll,
    anyCompleted,
    processRejected: arrow?.processStatus === 'rejected',
  };
}

/** 五区现状一句话（按状态归组计数，不合并五态语义；标签已含“五区推进”，正文不再重复前缀）。 */
function arrowSituationText(facts: ArrowFacts): string {
  const groups = new Map<string, string[]>();
  for (const [domain, state] of facts.stateByDomain) {
    const list = groups.get(state) ?? [];
    list.push(domainCn(domain));
    groups.set(state, list);
  }
  const parts: string[] = [];
  for (const [state, names] of groups) {
    const cn = ARROW_STATE_CN[state] ?? `状态：${state}`;
    parts.push(names.length > 1 ? `${names.join('、')}${cn}` : `${names[0]}${cn}`);
  }
  return parts.length > 0 ? parts.join('；') : '各分区状态未登记';
}

function channelRunningCount(tasks: Array<{ status?: string }> | null | undefined): number | null {
  if (!Array.isArray(tasks)) return null; // 未知≠0
  return tasks.filter((t) => t && ['queued', 'running'].includes(String(t.status ?? ''))).length;
}

/** V0.6-C1-02 · 单区下一步与四页简报同源：按 arrow 该区现行状态给出与 deriveCaseBrief
 * 相同词汇的“谁做什么”；arrow 不可用或该区状态未知/未开始时返回 null，由调用方回退
 * 本专业日常职责文案（不编造状态）。不推进业务，只读。 */
export function domainNextStepCn(domain: string, arrow: ArrowProjection | null | undefined): { who: string; what: string } | null {
  const facts = collectArrowFacts(arrow);
  if (!facts.usable) return null;
  const d = domain === 'opportunity' ? 'business' : domain;
  const state = facts.stateByDomain.get(d);
  if (!state) return null;
  const cn = domainCn(d);
  const role = domainRolesCn([d]);
  if (facts.reselectDomains.includes(d)) return { who: role, what: `${cn}区依据已更新：请按当前材料重新分析并重新选择候选，旧结论确认前须先重选` };
  if (facts.pendingConfirm.some((c) => String(c.domain ?? '') === d)) return { who: role, what: `确认${cn}区现行候选（默认建议不等于批准，确认须绑定当前版本）` };
  if (state === 'waiting_evidence') return { who: '业务人员', what: `${cn}区等待补证：补齐所需材料后会自动重新分析` };
  if (state === 'failed') return { who: role, what: `${cn}区上次分析失败：请重跑分析或核对失败原因（失败如实显示，不冒充完成）` };
  if (state === 'running' || state === 'queued') return { who: '系统（处理链）', what: `${cn}区分析进行中，完成后本简报与决策页会同步更新` };
  if (state === 'stale' || state === 'needs_reassessment') return { who: role, what: `${cn}区结论依据已标记过时/待重评：按当前材料重新核对本专业结论后才能确认` };
  if (state === 'completed') return { who: role, what: `${cn}区已确认收口；正式额度审批是另行流程，预评估结论不产生授信` };
  if (state === 'rejected') return { who: '业务人员', what: `${cn}区已按本轮结论拒绝并归档；如需继续办理，另起新一轮并按当前材料重新评估` };
  // not_started/waiting_dependency/unknown：回退本专业日常职责，不冒充已知进度。
  return null;
}

/** 组装四页共享的业务简报：全部来自服务端读面，未知如实，不推进业务。 */
export function deriveCaseBrief(src: CaseBriefSource): CaseBrief {
  const snap = src.snapshot;

  // 加载中：快照尚未读到时如实说加载，绝不冒充“尚未开始”（加载≠空数据）。
  if (snap == null) {
    return {
      background: '正在读取客户档案与当前办理状态…',
      situation: [{ key: 'loading', label: '加载中', text: '服务端当前状态尚未读到；读到之前不显示任何进度结论（不是未开始，也不是没有材料）', attention: false }],
      reasons: ['读取完成后，这里显示真实的办理状态、原因与下一步。'],
      nextStep: { who: '请稍候', what: '正在从服务端读取当前工作本快照；如长时间未完成请刷新或检查连接' },
      caution: '加载中：本简报的结论区域尚未就绪，不显示猜测状态。',
    };
  }

  const name = src.customerName ?? snap.customer?.displayName ?? null;
  const latest = currentAssessmentOf(snap.assessments);
  const adm = snap.admission ?? null;
  const basis = snap.decisionStatus?.basis ?? null;
  const arrowFacts = collectArrowFacts(adm?.arrow ?? null);
  const cand = adm?.candidate ?? latest?.candidate ?? null;

  // 背景：这是什么客户（不编造行业/规模；只有登记过的信息）。
  const reqAmount = adm?.request?.requestedAmount ?? latest?.requestedAmountMinor ?? null;
  const background = name
    ? `客户「${name}」正在办理首次回租准入${reqAmount != null ? `，本次提出的需求金额为 ${fmtMinorCn(reqAmount)}` : '，需求金额尚未登记'}。`
    : '客户档案尚未打开，暂无客户背景可说明。';

  // 现状：发生了什么（五区 arrow 现行状态优先；评估/材料/结论/红线如实分列）。
  const situation: CaseBriefLine[] = [];

  if (arrowFacts.usable) {
    const attention = [...arrowFacts.stateByDomain.values()].some((st) => ARROW_ATTENTION_STATES.has(st));
    situation.push({ key: 'zones', label: '五区推进', text: arrowSituationText(arrowFacts), attention });
    // 预评估链与五区推进是两条真实链：各自如实分列，不互相覆盖（预评估终点=有权人员确认结论）。
    if (latest && ['awaiting_human_review', 'candidate_ready', 'collecting'].includes(String(latest.status))) {
      situation.push({
        key: 'assess',
        label: '预评估',
        text: `${assessmentStatusCn(latest.status)}${latest.stale === true ? '（评估依据已标记过时，以服务端复核为准）' : ''}`,
        attention: false,
      });
    }
  } else {
    // LT-02 F2：arrow 轮次面缺失（如 Edge 侧数据面被清）但 A 依据包仍有现行专业结论时，
    // 不得只说“尚未开始”与同屏看板办结绿格矛盾；用与看板同词汇如实带出（≠正式批准）。
    const closedDomains = (Array.isArray(basis?.currency) ? basis!.currency! : [])
      .filter((x) => x?.currency === 'current')
      .map((x) => DOMAIN_CN[String(x.domain)] ?? String(x.domain ?? ''))
      .filter((s) => s && s !== 'undefined');
    const closureNote = closedDomains.length > 0
      ? `；${closedDomains.join('、')}已有现行专业结论（看板办结行绿色，≠正式批准）`
      : '';
    const statusText = latest
      ? `预评估${assessmentStatusCn(latest.status)}${latest.stale === true ? '，且材料后来有变化，需要重新核对' : ''}`
      : `预评估尚未开始${closureNote}`;
    situation.push({ key: 'assess', label: '办理进度', text: statusText, attention: latest?.stale === true });
  }

  // 现行候选（金额/期间是必看项，常驻顶部不折叠；两条链任一有候选即显示；isCurrent=false 时标注基于较早材料）。
  const candAmt = cand as { suggestedAmount?: number | null; supportableAmountMinor?: number | null } | null;
  const candTerm = (cand as { suggestedTermMonths?: number | null } | null)?.suggestedTermMonths ?? null;
  if (cand && (candAmt?.suggestedAmount != null || candAmt?.supportableAmountMinor != null || cand.tendency)) {
    const amtMinor = candAmt?.suggestedAmount ?? candAmt?.supportableAmountMinor ?? null;
    situation.push({
      key: 'candidate',
      label: '现行候选',
      text: `${tendencyCn(cand.tendency ?? null)}${amtMinor != null ? ` · 建议额度 ${fmtMinorCn(amtMinor)}` : ''}${candTerm != null ? ` · 建议期限 ${candTerm} 个月` : ''}${adm?.candidate?.isCurrent === false ? '（基于较早材料生成，需按当前材料重新核对后才能使用）' : ''}`,
      attention: adm?.candidate?.isCurrent === false,
    });
  }

  const materials = src.currentMaterials;
  const materialsText = src.materialsReadError === 403
    ? '当前身份无权读取材料清单（是权限不足，不是没有材料）'
    : src.materialsReadError != null
      ? `材料清单读取失败（状态 ${src.materialsReadError}），是否缺件以原件页为准`
      : materials == null
        ? '材料清单暂时无法读取（不是没有材料）'
        : materials === 0
          ? '还没有登记任何材料原件，需要先上传'
          : `已登记 ${materials} 份现行材料`;
  situation.push({
    key: 'materials',
    label: '材料',
    text: materialsText,
    attention: materials === 0 || materials == null || src.materialsReadError != null,
  });

  if ((src.factConflicts ?? 0) > 0) {
    const conflictDomains = factKeyDomains(src.factConflictKeys ?? []);
    situation.push({
      key: 'conflict',
      label: '内容冲突',
      text: `有 ${src.factConflicts} 处材料内容互相矛盾${conflictDomains.length > 0 ? `（涉及${conflictDomains.map(domainCn).join('、')}专业事实）` : ''}，需人工核对后才能继续`,
      attention: true,
    });
  }

  const pre = adm?.preassessment ?? null;
  if (pre?.outcome) {
    situation.push({
      key: 'pre',
      label: '预评估结论',
      text: `已确认：${tendencyCn(pre.outcome)}${pre.needsReview === true ? '，但依据后来被取代，需要复核' : ''}（这是预评估结论，不等于正式批准）`,
      attention: pre.needsReview === true,
    });
  }

  const gate = basis?.gate?.result ? gateResultCn(basis.gate.result) : '';
  if (gate) {
    situation.push({
      key: 'gate',
      label: '准入规则',
      text: gate === '未通过' ? '本次按准入规则不能通过，系统不能强制放行' : `准入规则检查${gate}`,
      attention: gate === '未通过',
    });
  }
  // NIGHT-FF2：计划面静态投影（advance-plan available:false 的已映射原因）——确定性阻断
  // 置于现状首位（它主导本次能否推进），只显示服务端已返回的原因，前端不猜制度。
  if (src.planBlock?.text) {
    situation.unshift({ key: 'plan_block', label: '办理规则', text: src.planBlock.text, attention: true });
  }

  // 为什么：原因（规则/依据/冻结原因），没有就说还没形成。
  const reasons: string[] = [];
  if (cand) {
    const amt = cand as { suggestedAmount?: number | null; supportableAmountMinor?: number | null };
    const amtMinor = amt.suggestedAmount ?? amt.supportableAmountMinor ?? null;
    const staleNote = adm?.candidate?.isCurrent === false ? '（该建议基于较早的材料生成，需按当前材料重新核对后才能使用）' : '';
    reasons.push(`当前建议来自最新一轮专业分析：${tendencyCn(cand.tendency ?? latest?.candidate?.tendency ?? null)}${amtMinor != null ? `，建议额度 ${fmtMinorCn(amtMinor)}` : '，建议额度尚未形成'}${staleNote}`);
  }
  if (arrowFacts.usable && arrowFacts.pendingConfirm.length > 0) {
    const zones = [...new Set(arrowFacts.pendingConfirm.map((c) => domainCn(c.domain)))].join('、');
    const first = arrowFacts.pendingConfirm[0]!;
    const countNote = first.zoneCandidateCount != null ? `共 ${first.zoneCandidateCount} 项候选按${first.zoneCandidateScoreType === 'rule_rank' || first.zoneCandidateScoreType == null ? '规则排序' : String(first.zoneCandidateScoreType)}列出` : '';
    reasons.push(`${zones}区的候选已生成、等待有权人员确认（${tendencyCn(first.tendency ?? null)}${first.summary ? `；${first.summary}` : ''}${countNote ? `；${countNote}` : ''}；默认推荐不等于正式审批）`);
    const model = first.semantic?.model ?? null;
    if (first.semantic?.status === 'succeeded' && model) reasons.push(`该候选含真实语义分析结果（${model}，仅供参考，权威在人工确认）`);
  }
  if (arrowFacts.usable && arrowFacts.reselectDomains.length > 0) {
    reasons.push(`${arrowFacts.reselectDomains.map(domainCn).join('、')}区的依据材料后来发生了变化，旧结论/旧选择不再现行，须按当前材料重新分析或重新选择`);
  }
  if (arrowFacts.usable && arrowFacts.waitingEvidence.length > 0) {
    reasons.push(`${arrowFacts.waitingEvidence.map(domainCn).join('、')}区等待补证：补齐所需材料后会自动重新分析（无现行候选的域如实等待，不用旧候选补位）`);
  }
  const blocked = Array.isArray(basis?.blockedActions) ? basis!.blockedActions! : [];
  if (blocked.length > 0) {
    const BLOCKED_ACTION_CN: Record<string, string> = {
      submit_package: '提交材料包',
      confirm_preassessment: '确认预评估结论',
      facility_approve: '正式额度审批',
      revise_assessment: '更新评估',
    };
    reasons.push(`有 ${blocked.length} 项办理动作被暂缓：${blocked.map((c) => BLOCKED_ACTION_CN[c] ?? '待明确动作').join('、')}（需先解除前置条件）`);
  }
  const changedDomains = (Array.isArray(basis?.currency) ? basis!.currency! : [])
    .filter((x) => x?.currency === 'changed')
    .map((x) => DOMAIN_CN[String(x.domain)] ?? '相关');
  if (changedDomains.length > 0) reasons.push(`${[...new Set(changedDomains)].join('、')}专业的依据材料后来发生了变化，相关结论需要按新证据更新后才能使用`);
  const conditions = adm?.candidate?.conditions ?? null;
  if (Array.isArray(conditions) && conditions.length > 0) reasons.push(`建议附带条件：${conditions.join('；')}`);
  if (reasons.length === 0) reasons.push('尚未形成正式判断原因：材料齐全并完成专业分析后，这里会说明判断依据。');

  // 下一步：谁做什么（五区 arrow 现行状态优先；只说真实可做的事，不替人决定）。
  // 默认兜底仅在材料状态未知时到达（NIGHT-02 F3：有已登记材料时不得再说“先上传”）。
  let nextStep: CaseBrief['nextStep'] = { who: '业务人员', what: '材料清单暂时无法读取：在材料页核对当前原件与缺件状态后，按页面动作开始或继续办理' };
  const channelRunning = channelRunningCount(src.channelTasks);
  // NIGHT-FF2：计划面确定性阻断优先于一切常规下一步（规则句已含解除路径；短句进顶部）。
  if (src.planBlock) nextStep = { who: '业务人员', what: src.planBlock.next, short: src.planBlock.short };
  else if (gate === '未通过') nextStep = { who: '业务人员', what: '与客户核对情况；按准入规则本次不能通过，无法补件放行' };
  else if ((src.factConflicts ?? 0) > 0) {
    // FINAL-02：冲突下一步按冲突事实实际所属专业分派（不泛指信审）；收口走人工核对+显式更正登记，
    // 不按“最后上传者覆盖”自动采用（与 API_HANDOFF_R3 §9.2 人工核验登记/显式 supersedes 同口径）。
    // LT-02 UI-B：顶部首显缩为“原因+一项动作”，核验/留痕/不自动采信完整依据句保留在展开区。
    const conflictDomains = factKeyDomains(src.factConflictKeys ?? []);
    nextStep = conflictDomains.length > 0
      ? { who: domainRolesCn(conflictDomains), what: `先核对${conflictDomains.map(domainCn).join('、')}区互相矛盾的材料内容：以“核验材料”人工核对登记或显式更正收口（原结论保留留痕，不按最后上传自动采用），再继续分析`, short: `材料内容互相矛盾：先核对${conflictDomains.map(domainCn).join('、')}区并登记更正` }
      : { who: '具备该事实核验权限的专业岗位', what: `先核对互相矛盾的材料内容${(src.factConflictKeys ?? []).length > 0 ? `（涉及事实项：${(src.factConflictKeys ?? []).join('、')}）` : ''}，以人工核验登记或显式更正收口后再继续分析`, short: '材料内容互相矛盾：先核对并登记更正' };
  }
  else if (arrowFacts.usable && arrowFacts.processRejected) nextStep = { who: '业务人员', what: '本轮按信审结论拒绝并归档；如需继续与该客户办理，另起新一轮并按当前材料重新评估' };
  else if (arrowFacts.usable && arrowFacts.reselectDomains.length > 0) nextStep = { who: domainRolesCn(arrowFacts.reselectDomains), what: `${arrowFacts.reselectDomains.map(domainCn).join('、')}区依据已更新：请按当前材料重新分析并重新选择候选，旧结论确认前须先重选`, short: `${arrowFacts.reselectDomains.map(domainCn).join('、')}区依据已更新：重新分析并重选候选` };
  else if (arrowFacts.usable && arrowFacts.pendingConfirm.length > 0) {
    // R3-02（PERMISSION_TABLE_R3）：各区确认=各域专业角色，不把专业确认绑定信审审批。
    const pendingDomains = [...new Set(arrowFacts.pendingConfirm.map((c) => String(c.domain ?? '')))].filter(Boolean);
    nextStep = { who: domainRolesCn(pendingDomains), what: `确认${pendingDomains.map(domainCn).join('、')}区现行候选（默认建议不等于批准，确认须绑定当前版本）`, short: `确认${pendingDomains.map(domainCn).join('、')}区现行候选` };
  }
  else if (arrowFacts.usable && arrowFacts.waitingEvidence.length > 0) nextStep = { who: '业务人员', what: `${arrowFacts.waitingEvidence.map(domainCn).join('、')}区等待补证：补齐所需材料后会自动重新分析` };
  else if (arrowFacts.usable && arrowFacts.failed.length > 0) nextStep = { who: domainRolesCn(arrowFacts.failed), what: `${arrowFacts.failed.map(domainCn).join('、')}区上次分析失败：请重跑分析或核对失败原因（失败如实显示，不冒充完成）` };
  else if (arrowFacts.usable && arrowFacts.completedAll && !pre?.outcome && latest?.status === 'awaiting_human_review') nextStep = { who: '信审专员（有权人员）', what: '五区推进已全部确认，请在“更多 → 确认预评估结论”中确认本轮预评估结论（默认建议不等于批准）', short: '五区已全部确认：在“更多”中确认预评估结论' };
  else if (arrowFacts.usable && arrowFacts.completedAll) nextStep = { who: '业务人员', what: '本轮五区推进已全部确认；正式额度审批是另行流程，本次预评估结论不产生授信' };
  else if (arrowFacts.usable && arrowFacts.inFlight.length > 0) nextStep = { who: '系统（处理链）', what: `${arrowFacts.inFlight.map(domainCn).join('、')}区分析进行中，完成后本简报与决策页会同步更新` };
  else if (latest?.stale === true || changedDomains.length > 0) nextStep = { who: '对应专业角色', what: '按最新材料重新核对本专业结论，解除冻结后才能确认' };
  else if (pre?.outcome && pre.needsReview !== true) nextStep = { who: '业务人员', what: '预评估已结束；如客户情况变化，可发起新一轮复核' };
  else if (latest?.status === 'awaiting_human_review') nextStep = { who: '信审专员（有权人员）', what: '在“更多 → 确认预评估结论”中确认结论（默认建议不等于批准）' };
  else if (latest?.status === 'candidate_ready') nextStep = { who: '信审专员', what: '查看建议方案并提交复核，再由信审专员（有权人员）确认' };
  else if (materials === 0) nextStep = { who: '业务人员', what: '上传第一份材料原件，开始办理' };
  else if (src.materialsReadError === 403) nextStep = { who: '业务人员或管理员', what: '当前身份无权读取材料清单：请由有权人员核对授权，或切换有权限的身份' };
  else if (channelRunning != null && channelRunning > 0) nextStep = { who: '系统（处理链）', what: '材料已上传，登记与分析进行中；完成后建议方案会出现在决策页（本简报同步更新）' };
  else if (latest?.status === 'collecting') nextStep = { who: '业务人员', what: '材料已登记，处理链按事件触发登记分析；如长时间无进展可在材料页核对逐件回执' };
  // NIGHT-02 F3（03 终验发现）：有已登记现行材料但无分析/无候选时，不得再要求“先上传材料”。
  // 指向真实页面动作“提交材料并分析”；登记不等于核验完成——核验状态以材料页原件为准，不以数量冒充。
  else if (materials != null && materials > 0) nextStep = { who: '业务人员', what: `已登记 ${materials} 份现行材料（登记不等于核验完成，原件与核验状态以材料页为准）：材料已就绪，点“提交材料并分析”开始本轮分析`, short: `材料已就绪：点“提交材料并分析”开始本轮分析` };

  // 口径说明收敛为一句（R3-02：不再常驻整段免责长文；完整口径随简报条展开区展示）。
  const caution = '系统候选仅供参考，不等于正式审批；概率类数字未校准，因此不显示。';

  return { background, situation, reasons, nextStep, caution };
}
