// TAKEOFF-FA-1.0.0 · 02路·二十格投影纯函数模块（可单测，零 import——wb-logic 同纪律：
// node strip-types 直载 ESM 不解析无扩展名导入，展示小工具就地内联）。
// 数据纪律（01_TAKEOFF_CORE_AUTHORITY §6/§7、03_BUSINESS_STATE_RULES §3/§4）：
// - 格子只是粗粒度展示投影；后端事实是具体事项。displayBucket 只从服务端字段计算，
//   分母未知=null 不伪造 0；100% 绿只在域收口条件（依据包内该域结论 current）满足时出现。
// - 未知不是零；技术失败不降额不拒绝；冻结≠拒绝；绿=工作完成≠支持融资。
// - 本模块是只读投影，不形成第二套业务状态机；01 契约冻结后仅改本模块与读面字段。
// 每格 basis 文本注明所依据的服务端字段来源，点击格子可见，不靠颜色单独表义。

// ---------------------------------------------------------------------------
// 固定结构：五列（01 §3）× 四行
// ---------------------------------------------------------------------------

export const TAKEOFF_DOMAINS = [
  { id: 'opportunity', name: '商机' },
  { id: 'policy', name: '政策' },
  { id: 'credit', name: '信审' },
  { id: 'commerce', name: '商务' },
  { id: 'asset', name: '资产' },
] as const;

export type TakeoffDomainId = (typeof TAKEOFF_DOMAINS)[number]['id'];

export const TAKEOFF_ROWS = [
  { id: 'input', name: '输入' },
  { id: 'analysis', name: '智能' },
  { id: 'human', name: '人工' },
  { id: 'closure', name: '完成' },
] as const;

export type TakeoffRowId = (typeof TAKEOFF_ROWS)[number]['id'];

export type TakeoffTone = 'green' | 'yellow' | 'red' | 'gray' | 'blue';

export interface TakeoffCellItem {
  key: string;
  label: string;
  tone: TakeoffTone;
  detail?: string;
}

export interface TakeoffCellView {
  domain: TakeoffDomainId;
  row: TakeoffRowId;
  /** 0|25|50|75|100|null；null=分母未知/不适用，不硬补进度。100 只在办结条件满足时出现。 */
  displayBucket: 0 | 25 | 50 | 75 | 100 | null;
  /** 运行中（浅黄细外环，按服务端处理链在途状态；不按计时推进）。 */
  running: boolean;
  /** 工作办结（唯一 100% 绿来源）。 */
  completed: boolean;
  /** 卡点 '!' 角标（保留正文进展，不整格染红）。 */
  needsReview: boolean;
  /** 白霜冻结（当前方案受影响格子；仍可读、补件、提问）。 */
  frozen: boolean;
  /** 途径入口（允许动作=打开对应真实办理面板，不做手工改状态按钮）。 */
  allowedActions: Array<{ key: 'materials' | 'verify' | 'qa' | 'proposal' | 'result'; label: string }>;
  /** 点击格子看到的真实事项清单（全部来自服务端字段）。 */
  items: TakeoffCellItem[];
  /** 状态依据（服务端字段/口径说明）。 */
  basis: string;
  /** 责任方（服务端角色字段；未知=未指派）。 */
  responsible: string | null;
}

export interface TakeoffTopSummary {
  customer: { customerId: string | null; displayName: string | null; status: string | null };
  /** 申请金额=客户本次提出的需求（首次回租需求登记待01接入前=待补，不拿融资申请冒充）。 */
  requestedAmount: { text: string; note: string };
  /** 建议额度=当前候选方案证据可支持值；没有判断时"待评估"，不是 0。 */
  suggestedAmount: { text: string; note: string };
  /** 建议期限：候选期限字段待01接入；不是授信有效期。 */
  suggestedTerm: { text: string; note: string };
  /** 参考价格：未配置口径时不编造利率。 */
  referencePrice: { text: string; note: string };
  /** 预计完成：无法估计显示"待估"；不给承诺式假倒计时。 */
  expect: { text: string; note: string };
  /** 方案标记（小字）：同一候选方案版本的版本/倾向/依据包/复核状态，不是统计卡。 */
  planMarks: string[];
  /** 依据包已变化（受影响格子白霜）的域列表。 */
  changedDomains: TakeoffDomainId[];
  /** 事实冲突数（同键多个现行断言）。 */
  factConflicts: number;
  gateResult: string | null;
  /** 预评估结论读回（§13：确认后只读；needsReview=确认依据被取代→需复核，不重开）。 */
  confirmed: {
    outcome: 'support' | 'support_with_conditions' | 'not_support';
    outcomeLabel: string;
    confirmationId: string | null;
    confirmedBy: string | null;
    confirmedAt: string | null;
    conditions: string[];
    needsReview: boolean;
    reviewReason: string | null;
  } | null;
  /** 评估当前状态与版本锚点（供结束确认绑定 assessmentVersion/candidateRevision/inputVersion）。 */
  assessment: { id: string | null; status: string | null; version: number | null; candidateRevision: number | null; inputVersion: number | null; ruleVersion: string | null; stale: boolean };
}

export interface TakeoffTodoRow {
  key: string;
  who: string;
  what: string;
  doneWhen: string;
  action: string;
  /** 回原格子（域+行）；无可映射格子时给入口目标。 */
  cell: { domain: TakeoffDomainId; row: TakeoffRowId } | null;
  entry: 'materials' | 'verify' | 'qa' | 'proposal' | 'result' | null;
}

/** Edge admission 投影（04路 §13.3 聚合面，snapshot.admission）：本路只消费不复制其语义。 */
export interface TakeoffAdmissionView {
  scope?: { customerId?: string; assessmentId?: string; revision?: number | null; sourceStatus?: string };
  request?: { requestedAmount?: number | null; equipmentRefs?: unknown };
  assessmentState?: string | null;
  stale?: boolean;
  staleReasons?: unknown;
  inputVersion?: number | null;
  candidateRevision?: number | null;
  candidate?: {
    version?: number | null;
    suggestedAmount?: number | null;
    suggestedTermMonths?: number | null;
    referencePriceMinor?: number | null;
    priceUnit?: string | null;
    priceBasis?: string | null;
    conditions?: string[] | null;
    tendency?: string | null;
    inputVersion?: number | null;
    isCurrent?: boolean;
  } | null;
  preassessment?: {
    confirmationId?: string | null;
    outcome?: string | null;
    scope?: string;
    conditions?: string[];
    rationale?: string | null;
    confirmedBy?: string | null;
    confirmedAt?: string | null;
    needsReview?: boolean;
    reviewReason?: string | null;
  } | null;
  frozen?: { active?: boolean; reasons?: string[]; scope?: string[] };
  cells?: Array<{ domain?: string; row?: string; satisfiedItemCount?: number | null; running?: boolean; blockers?: Array<{ scope?: string; reason?: string; detail?: string | null }> }>;
  blockers?: Array<{ scope?: string; reason?: string; detail?: string | null }>;
}

export interface TakeoffSourceSnapshot {
  admission?: TakeoffAdmissionView | null;
  customer?: { customerId?: string; displayName?: string; status?: string } | null;
  decisionStatus?: {
    basis?: {
      packageId?: string;
      revision?: number;
      basisVersion?: string;
      status?: string;
      decisionReadiness?: boolean;
      blockedActions?: string[];
      gate?: { result?: string; rulePackVersion?: string } | null;
      currency?: Array<{ domain?: string; currency?: string; reasons?: string[] }>;
    } | null;
    reviewQueue?: unknown[];
  } | null;
  assessments?: Array<{
    assessmentId?: string;
    status?: string;
    stale?: boolean;
    ruleVersion?: string | null;
    version?: number;
    candidateRevision?: number | null;
    inputVersion?: number | null;
    requestedAmountMinor?: number | null;
    preassessment?: TakeoffAdmissionView['preassessment'];
    candidate?: {
      tendency?: string;
      supportableAmountMinor?: number;
      currency?: string;
      producedBy?: string;
      suggestedTermMonths?: number | null;
      referencePriceMinor?: number | null;
      priceUnit?: string | null;
      priceBasis?: string | null;
      revision?: number | null;
    } | null;
  }> | null;
  session?: {
    runStatus?: string;
    openQuestions?: number;
    coverage?: { total?: number; required?: number; verified?: number; open?: number };
    followups?: Array<{ ownerRole?: string; reason?: string; nextAction?: string }>;
  } | null;
  openItems?: Array<{ kind?: string; ref?: string; needRole?: string; detail?: string; blockers?: string[] }>;
  findings?: Array<{ findingId?: string; severity?: string; status?: string; summary?: string }>;
}

/** 依据包详情（client.packageDetail 读回）中的域结果子集。 */
export interface TakeoffPackageDetail {
  domainResults?: Array<{
    domain?: string;
    opinionVersion?: number;
    adoption?: { adopted?: boolean; rationale?: string } | null;
    opinion?: { findingType?: string; summary?: string };
  }>;
  gaps?: string[];
}

export interface TakeoffSource {
  snapshot: TakeoffSourceSnapshot | null;
  packageDetail: TakeoffPackageDetail | null;
  /** 处理通道任务（client.channelStatus 读回）最小字段。 */
  channelTasks: Array<{ status?: string }>;
  /** 现行材料件数（A artifacts 清单；读取失败=null，不冒充 0）。 */
  currentMaterials: number | null;
  /** 事实冲突数（factConflicts）。 */
  factConflicts: number;
}

const DOMAIN_NAME: Record<TakeoffDomainId, string> = {
  opportunity: '商机', policy: '政策', credit: '信审', commerce: '商务', asset: '资产',
};
const ROW_NAME: Record<TakeoffRowId, string> = { input: '输入', analysis: '智能', human: '人工', closure: '完成' };
const BACKEND_DOMAINS: TakeoffDomainId[] = ['policy', 'credit', 'commerce', 'asset'];
const DOMAIN_ROLE: Record<string, TakeoffDomainId> = { policy: 'policy', credit: 'credit', commerce: 'commerce', asset: 'asset' };

/** 金额（分）→ 展示串（与 edge-logic fmtAmount 同口径的内联版；本模块零 import）。 */
export function fmtMinor(minor: number | undefined | null, currency?: string): string {
  if (typeof minor !== 'number' || !Number.isFinite(minor)) return '待评估';
  const WAN = 1_000_000;
  const s = Math.abs(minor) >= WAN
    ? `${(minor / WAN).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 万元`
    : `${(minor / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 元`;
  return currency && currency !== 'CNY' ? `${s}（${currency}）` : s;
}

const TENDENCY_LABEL: Record<string, string> = {
  do: '可做（支持）',
  do_with_adjusted_terms: '可做（调整条件）',
  do_not: '不做（负面）',
  review: '待复核',
};

export function tendencyLabel(t: string | null | undefined): string {
  if (!t) return '未登记';
  return TENDENCY_LABEL[t] ?? `未知倾向：${t}`;
}

interface DomainFacts {
  currency: string | null;
  currencyReasons: string[];
  resultCount: number;
  adopted: boolean;
  followups: number;
}

function collectFacts(src: TakeoffSource): Record<string, DomainFacts> {
  const basis = src.snapshot?.decisionStatus?.basis ?? null;
  const verdicts = Array.isArray(basis?.currency) ? basis!.currency! : [];
  const results = Array.isArray(src.packageDetail?.domainResults) ? src.packageDetail!.domainResults! : [];
  const followups = Array.isArray(src.snapshot?.session?.followups) ? src.snapshot!.session!.followups! : [];
  const out: Record<string, DomainFacts> = {};
  for (const d of BACKEND_DOMAINS) {
    const v = verdicts.find((x) => x?.domain === d);
    const drs = results.filter((r) => r?.domain === d);
    out[d] = {
      currency: v && typeof v.currency === 'string' ? v.currency : null,
      currencyReasons: v && Array.isArray(v.reasons) ? v.reasons.map(String) : [],
      resultCount: drs.length,
      adopted: drs.some((r) => r.adoption?.adopted === true),
      followups: followups.filter((f) => f?.ownerRole === d).length,
    };
  }
  return out;
}

function channelRunState(tasks: Array<{ status?: string }>): { running: number; followup: number; blocked: number; done: number } {
  let running = 0, followup = 0, blocked = 0, done = 0;
  for (const t of tasks ?? []) {
    const s = String(t?.status ?? '');
    if (s === 'queued' || s === 'running') running += 1;
    else if (s === 'needs_followup') followup += 1;
    else if (s.startsWith('blocked_')) blocked += 1;
    else if (s === 'done') done += 1;
  }
  return { running, followup, blocked, done };
}


/** 二十格投影：全部字段来自服务端读面；分母未知=null；100% 绿只在 currency=current（域收口）时出现。 */
export function deriveTakeoffCells(src: TakeoffSource): TakeoffCellView[] {
  const snap = src.snapshot ?? {};
  const basis = snap.decisionStatus?.basis ?? null;
  const hasBasis = Boolean(basis?.packageId);
  const facts = collectFacts(src);
  const chan = channelRunState(src.channelTasks);
  const changedSet = new Set(BACKEND_DOMAINS.filter((d) => facts[d].currency === 'changed'));
  const latest = (snap.assessments ?? []).length > 0 ? (snap.assessments ?? [])[(snap.assessments ?? []).length - 1] : null;
  const gate = basis?.gate ?? null;
  const cells: TakeoffCellView[] = [];

  for (const d of TAKEOFF_DOMAINS) {
    const isBackend = d.id !== 'opportunity';
    const f = isBackend ? facts[d.id] : null;

    // ---- 输入行 ----
    const inputItems: TakeoffCellItem[] = [];
    if (d.id === 'opportunity') {
      inputItems.push(snap.customer?.customerId
        ? { key: 'cust', label: '客户已建档', tone: 'green' }
        : { key: 'cust', label: '客户主体档案未打开', tone: 'gray' });
      const reqAmount = snap.admission?.request?.requestedAmount ?? latest?.requestedAmountMinor ?? null;
      inputItems.push(reqAmount != null
        ? { key: 'req', label: `首次回租需求已登记：金额 ${fmtMinor(reqAmount)}（客户表述，非融资申请）`, tone: 'green', detail: '以客户提供的申请金额、用途和设备范围为准，可在需求登记中补充。' }
        : { key: 'req', label: '首次回租需求登记（金额/用途/设备范围）', tone: 'gray', detail: '首次回租需求登记未录入：如实待补，不用融资申请冒充需求（未知≠0）' });
    } else {
      inputItems.push({
        key: 'mat',
        label: src.currentMaterials == null ? '材料暂时无法读取' : `客户现行记录 ${src.currentMaterials} 份`,
        tone: src.currentMaterials == null ? 'gray' : src.currentMaterials > 0 ? 'green' : 'gray',
        detail: '查看材料原件，核对是否满足本专业要求。',
      });
      if (src.currentMaterials === 0) inputItems.push({ key: 'mat0', label: '尚无材料：上传第一份原件后处理链自动登记', tone: 'gray' });
    }
    if (src.factConflicts > 0) {
      inputItems.push({ key: 'conf', label: `有 ${src.factConflicts} 处材料内容需要核对`, tone: 'red', detail: '互相矛盾的材料不按"最后上传者覆盖"处理：需人工复核' });
    }
    if (chan.blocked > 0) inputItems.push({ key: 'blk', label: `处理链被阻断等待恢复 ${chan.blocked} 项`, tone: 'yellow', detail: '自动续跑，勿重复提交（材料页可见逐任务回执）' });
    if (chan.followup > 0) inputItems.push({ key: 'fup', label: `待补件/转人工 ${chan.followup} 项`, tone: 'yellow' });
    cells.push({
      domain: d.id, row: 'input',
      displayBucket: null,
      running: chan.running > 0,
      completed: false,
      needsReview: src.factConflicts > 0,
      frozen: false,
      allowedActions: [{ key: 'materials', label: '打开材料·上传' }],
      items: inputItems,
      basis: d.id === 'opportunity'
        ? '依据：A customers 客户档案；首次回租需求登记待01接入（未知≠零，不伪造需求字段）'
        : '依据：A evidence_artifacts 现行材料清单 + Connectors 处理链任务状态；进度分母未知=null（材料未分域）',
      responsible: d.id === 'opportunity' ? 'business' : null,
    });

    // ---- 智能行 ----
    const analysisItems: TakeoffCellItem[] = [];
    if (!isBackend) {
      analysisItems.push({ key: 'na', label: '尚未取得业务分析结果', tone: 'gray', detail: '业务分析结果尚未登记。' });
    } else {
      if (f!.resultCount > 0) {
        analysisItems.push({ key: 'dr', label: `已有专业意见 ${f!.resultCount} 条`, tone: 'blue', detail: '意见供参考，确认后才能用于办理。' });
      } else {
        analysisItems.push({ key: 'dr0', label: chan.running > 0 ? '处理链分析进行中（尚无登记产出）' : '该域暂无分析产出登记', tone: chan.running > 0 ? 'blue' : 'gray', detail: '分析由处理链按事件触发；无报错不等于通过，未运行不是绿灯' });
      }
      if (changedSet.has(d.id)) analysisItems.push({ key: 'stale', label: '依据已变化：受影响分析须按当前证据更新', tone: 'yellow' });
    }
    cells.push({
      domain: d.id, row: 'analysis',
      displayBucket: null,
      running: isBackend && chan.running > 0 && f!.resultCount === 0,
      completed: false,
      needsReview: false,
      frozen: false,
      allowedActions: isBackend ? [{ key: 'proposal', label: '查看域意见与运行引用' }] : [],
      items: analysisItems,
      basis: isBackend
        ? '依据：A 包域结果（domainResults，引用 analysisRun）+ Connectors 处理链在途状态；分析运行分母未知=null'
        : '依据：商机域结构化分析待01/03接入',
      responsible: isBackend ? d.id : null,
    });

    // ---- 人工行 ----
    const humanItems: TakeoffCellItem[] = [];
    if (!isBackend) {
      humanItems.push({ key: 'nh', label: '尚未取得业务核验记录', tone: 'gray', detail: '输入/智能/人工按实际事项局部推进，不锁整行' });
    } else {
      if (f!.adopted) humanItems.push({ key: 'ad', label: '已采用本专业意见', tone: 'green', detail: '采用人和理由已保存在办理记录中。' });
      else if (f!.resultCount > 0) humanItems.push({ key: 'ad0', label: '该域意见尚无人工采用记录', tone: 'gray' });
      else humanItems.push({ key: 'ad1', label: '尚无该域人工核验记录', tone: 'gray' });
      if (f!.followups > 0) humanItems.push({ key: 'fu', label: `待办 ${f!.followups} 项`, tone: 'yellow', detail: '谁处理/完成证据见待办页；点击回原格子' });
      if (changedSet.has(d.id)) humanItems.push({ key: 'rv', label: '需人工复核：依据版本已变化', tone: 'yellow' });
    }
    const openQ = snap.session?.openQuestions ?? 0;
    if (isBackend && openQ > 0) humanItems.push({ key: 'q', label: `开放补证问题 ${openQ} 个（按角色应答）`, tone: 'blue' });
    cells.push({
      domain: d.id, row: 'human',
      displayBucket: null,
      running: false,
      completed: false,
      needsReview: isBackend && (f!.followups > 0 || changedSet.has(d.id)),
      frozen: false,
      allowedActions: isBackend ? [{ key: 'verify', label: '打开核验' }, { key: 'qa', label: '打开问题·补证' }] : [],
      items: humanItems,
      basis: isBackend
        ? '依据：A 包域结果采用记录（adoption）+ 检查会话 followups/openQuestions；人工核验分母未知=null'
        : '依据：商机域人工核验事项待01字段接入',
      responsible: isBackend ? d.id : null,
    });

    // ---- 完成行 ----
    const closureItems: TakeoffCellItem[] = [];
    let completed = false;
    let bucket: TakeoffCellView['displayBucket'] = null;
    let frozen = false;
    let needsReview = false;
    if (!isBackend) {
      closureItems.push({ key: 'nc', label: '业务办理尚未完成', tone: 'gray' });
    } else if (f!.currency === 'current') {
      completed = true;
      bucket = 100;
      closureItems.push({ key: 'cur', label: '本专业办理已完成', tone: 'green', detail: '绿=该格工作完成，≠支持融资；负面结论同样可完成' });
    } else if (f!.currency === 'changed') {
      frozen = true;
      needsReview = true;
      closureItems.push({ key: 'chg', label: '冻结（依据已变化）：禁止相关正面确认', tone: 'yellow', detail: `解冻所需动作：按当前有效证据更新该域结论${f!.currencyReasons.length > 0 ? `（原因：${f!.currencyReasons.join('、')}）` : ''}；仍可看证据、补件、提问` });
    } else if (f!.currency === 'missing') {
      closureItems.push({ key: 'miss', label: '本专业结论尚未登记', tone: 'gray', detail: '未闭合二态：登记域结果或有效豁免后才能闭合' });
    } else {
      closureItems.push({ key: 'unc', label: '本专业尚未完成', tone: 'gray', detail: '完成行=本域本轮收口汇总；没有独立任务时保持未闭合，不造审批步骤' });
    }
    if (isBackend && f!.currency == null && hasBasis) closureItems.push({ key: 'nb', label: '本专业结论尚待核对', tone: 'gray' });
    if (gate && gate.result === 'rejected' && d.id === 'commerce') {
      closureItems.push({ key: 'gate', label: '准入规则未通过', tone: 'red', detail: '拒绝不显示绿灯；依据见 Gate 回执' });
    }
    if ((d.id === 'credit' || d.id === 'commerce') && latest?.candidate) {
      closureItems.push({ key: 'cand', label: `建议：${tendencyLabel(latest.candidate.tendency)}`, tone: latest.candidate.tendency === 'do_not' ? 'red' : 'blue', detail: latest.candidate.supportableAmountMinor != null ? `候选支撑金额 ${fmtMinor(latest.candidate.supportableAmountMinor, latest.candidate.currency)}` : '候选金额未知（未知≠0）' });
    }
    if ((snap.assessments ?? []).some((a) => a.stale === true) && d.id === 'credit') {
      needsReview = true;
      closureItems.push({ key: 'stale', label: '材料已变化，需要重新核对', tone: 'yellow' });
    }
    cells.push({
      domain: d.id, row: 'closure',
      displayBucket: bucket,
      running: false,
      completed,
      needsReview,
      frozen,
      allowedActions: isBackend ? [{ key: 'proposal', label: '打开方案·决定' }] : [],
      items: closureItems,
      basis: isBackend
        ? `依据：A decision-status basis.currency[${d.id}]${hasBasis ? `（依据包 ${String(basis?.packageId).slice(0, 18)}… r${basis?.revision ?? '?'}）` : '（未冻结依据包）'}；绿=域收口≠批准`
        : '依据：商机域收口待01字段接入',
      responsible: isBackend ? d.id : null,
    });
  }
  // ---- §13.3 Edge admission 投影合并（04路聚合面：权威事实叠加；不改"分母未知=null"纪律） ----
  const adm = src.snapshot?.admission ?? null;
  if (adm) {
    const ADM_DOMAIN: Record<string, TakeoffDomainId> = { business: 'opportunity', policy: 'policy', credit: 'credit', commerce: 'commerce', asset: 'asset' };
    const ADM_ROW: Record<string, TakeoffRowId> = { input: 'input', intelligence: 'analysis', manual: 'human', completion: 'closure' };
    for (const ac of adm.cells ?? []) {
      const d = ADM_DOMAIN[String(ac?.domain ?? '')];
      const r = ADM_ROW[String(ac?.row ?? '')];
      if (!d || !r) continue;
      const c = cells.find((x) => x.domain === d && x.row === r);
      if (!c) continue;
      if (r === 'input' && ac.satisfiedItemCount != null && ac.satisfiedItemCount > 0) {
        c.items.unshift({ key: 'adm-cnt', label: `按域可推导到件 ${ac.satisfiedItemCount} 件（03协议 kind→域映射）`, tone: 'green' });
      }
      if (ac.running === true) c.running = true;
      for (const b of ac.blockers ?? []) {
        if (b?.reason === 'PROCESSING_FAILED') {
          c.items.push({ key: `adm-pb-${String(b.detail ?? '').slice(0, 16)}`, label: '处理失败（材料页可见逐件回执）', tone: 'red', detail: b.detail ?? undefined });
          c.needsReview = true;
        }
      }
    }
    const pre = adm.preassessment ?? null;
    if (pre) {
      const label = CONFIRM_OUTCOME_LABEL[pre.outcome ?? ''] ?? String(pre.outcome);
      for (const c of cells.filter((x) => x.row === 'closure')) {
        c.items.unshift({
          key: 'pac',
          label: `预评估结论：${label}（scope=preassessment_only${pre.confirmationId ? ` · ${pre.confirmationId}` : ''}）`,
          tone: pre.outcome === 'not_support' ? 'red' : 'green',
          detail: pre.needsReview
            ? `需复核（不重开）：${pre.reviewReason ?? '确认依据被取代'}`
            : `确认人 ${pre.confirmedBy ?? '有权人'}；结论≠正式批准`,
        });
      }
      if (pre.needsReview === true) {
        for (const c of cells.filter((x) => x.row === 'closure' || x.row === 'analysis')) { c.needsReview = true; c.frozen = true; }
      }
    }
    const reasons = adm.frozen?.reasons ?? [];
    if (reasons.includes('STALE_BASIS')) {
      for (const c of cells.filter((x) => x.domain === 'credit' && (x.row === 'analysis' || x.row === 'closure'))) c.frozen = true;
    }
    if ((adm.blockers ?? []).some((b) => b?.scope === 'finding')) {
      for (const c of cells.filter((x) => x.row === 'human' && x.domain !== 'opportunity')) c.needsReview = true;
    }
  }
  return cells;
}

/** 顶部摘要：同一候选方案版本（§13.2 同版金额/期限/价格）；未知=待评估/待补/待估，不是 0，不给假倒计时。
 * 数据优先级：Edge admission 投影（snapshot.admission，权威聚合）> 快照 assessments 旧字段。 */
export function deriveTakeoffTop(src: TakeoffSource): TakeoffTopSummary {
  const snap = src.snapshot ?? {};
  const adm = snap.admission ?? null;
  const basis = snap.decisionStatus?.basis ?? null;
  const assessments = snap.assessments ?? [];
  const latest = assessments.length > 0 ? assessments[assessments.length - 1] : null;
  const facts = collectFacts(src);
  const changedDomains = BACKEND_DOMAINS.filter((d) => facts[d].currency === 'changed');
  const cand = adm?.candidate ?? null;
  const pre = adm?.preassessment ?? latest?.preassessment ?? null;
  const marks: string[] = [];
  const tendency = cand?.tendency ?? latest?.candidate?.tendency ?? null;
  if (tendency != null || latest?.candidate) {
    marks.push(`候选倾向：${tendencyLabel(tendency)}（authority=none）`);
    if (latest?.ruleVersion) marks.push(`规则 ${latest.ruleVersion}`);
    if (latest?.status) marks.push(`评估 ${latest.status}`);
    if (latest?.stale === true) marks.push('评估依据已过时');
  } else {
    marks.push('尚无候选方案（待评估，不是 0）');
  }
  const candRev = cand?.version ?? latest?.candidateRevision ?? null;
  const inV = adm?.inputVersion ?? latest?.inputVersion ?? null;
  if (candRev != null || inV != null) marks.push(`候选 r${candRev ?? '?'} · 输入 v${inV ?? '?'}`);
  marks.push(basis?.packageId
    ? `依据包 r${basis.revision ?? '?'} · ${basis.status ?? '未知状态'}${basis.decisionReadiness === true ? ' · 就绪' : ' · 未就绪'}`
    : '依据包未冻结');
  if (changedDomains.length > 0) marks.push(`待复核：${changedDomains.map((d) => DOMAIN_NAME[d]).join('/')}依据已变化`);
  const blocked = Array.isArray(basis?.blockedActions) ? basis!.blockedActions! : [];
  if (blocked.length > 0) marks.push(`阻断动作：${blocked.join('、')}`);
  marks.push('预评估候选 ≠ 正式批准（scope=preassessment_only）');

  const confirmed = pre ? {
    outcome: (pre.outcome ?? 'support') as 'support' | 'support_with_conditions' | 'not_support',
    outcomeLabel: CONFIRM_OUTCOME_LABEL[pre.outcome ?? ''] ?? String(pre.outcome),
    confirmationId: pre.confirmationId ?? null,
    confirmedBy: pre.confirmedBy ?? null,
    confirmedAt: pre.confirmedAt ?? null,
    conditions: Array.isArray(pre.conditions) ? pre.conditions : [],
    needsReview: pre.needsReview === true,
    reviewReason: pre.reviewReason ?? null,
  } : null;
  if (confirmed) {
    marks.unshift(`预评估结论：${confirmed.outcomeLabel}（${confirmed.confirmedBy ?? '有权人'}${confirmed.confirmedAt ? ` · ${fmtWhenIso(confirmed.confirmedAt)}` : ''}）`);
    if (confirmed.needsReview) marks.splice(1, 0, `需复核（不重开）：${confirmed.reviewReason ?? '确认依据被取代'}`);
  }

  const requested = adm?.request?.requestedAmount ?? latest?.requestedAmountMinor ?? null;
  const term = cand?.suggestedTermMonths ?? latest?.candidate?.suggestedTermMonths ?? null;
  const price = cand?.referencePriceMinor ?? latest?.candidate?.referencePriceMinor ?? null;
  const rawPriceUnit = cand?.priceUnit ?? latest?.candidate?.priceUnit ?? null;
  const priceUnit = rawPriceUnit === 'cny_per_annum' ? '年' : rawPriceUnit?.replace(/^(?:元|人民币元|CNY)\s*[/／]\s*/i, '');
  const priceBasis = cand?.priceBasis ?? latest?.candidate?.priceBasis ?? null;
  return {
    customer: {
      customerId: snap.customer?.customerId ?? null,
      displayName: snap.customer?.displayName ?? null,
      status: snap.customer?.status ?? null,
    },
    requestedAmount: requested != null
      ? { text: fmtMinor(requested), note: '客户本次首次回租需求金额（A 权威登记）' }
      : { text: '待补', note: '首次回租需求登记未录入：客户本次需求不冒用融资申请/授信额度' },
    suggestedAmount: (cand?.suggestedAmount ?? latest?.candidate?.supportableAmountMinor) != null
      ? { text: fmtMinor((cand?.suggestedAmount ?? latest?.candidate?.supportableAmountMinor) as number, latest?.candidate?.currency), note: '建议值，等待有权人员确认' }
      : { text: '待评估', note: '尚无候选金额判断：待评估≠0' },
    suggestedTerm: term != null
      ? { text: `${term} 个月`, note: '候选方案建议融资期限（§13.2 同版；期限≠授信有效期）' }
      : { text: '待评估', note: '候选尚未登记建议期限（§13.2 字段）；期限≠授信有效期' },
    referencePrice: price != null
      ? { text: `${fmtMinor(price)}${priceUnit ? ` / ${priceUnit}` : ''}`, note: `价格口径：${priceBasis ?? '未声明'}（同版候选；不编造利率）` }
      : { text: '口径未配置', note: '价格口径/单位/含费未配置：不编造利率' },
    expect: { text: '待估', note: '评估预计完成时间无法估计（不给承诺式假倒计时）' },
    planMarks: marks,
    changedDomains,
    factConflicts: src.factConflicts,
    gateResult: basis?.gate?.result ?? null,
    confirmed,
    assessment: {
      id: adm?.scope?.assessmentId ?? latest?.assessmentId ?? null,
      status: adm?.assessmentState ?? latest?.status ?? null,
      version: adm?.scope?.revision ?? latest?.version ?? null,
      candidateRevision: candRev,
      inputVersion: inV,
      ruleVersion: latest?.ruleVersion ?? null,
      stale: latest?.stale === true,
    },
  };
}

export const CONFIRM_OUTCOME_LABEL: Record<string, string> = {
  support: '支持（正面预评估结论）',
  support_with_conditions: '附条件支持（调整条件）',
  not_support: '不支持（负面预评估结论）',
};

function fmtWhenIso(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : d.toLocaleString('zh-CN', { hour12: false });
}

/** 待办行：谁处理/处理什么/什么证据算完成/当前可执行动作；可回原格子或指定入口。 */
export function deriveTakeoffTodos(src: TakeoffSource): TakeoffTodoRow[] {
  const snap = src.snapshot ?? {};
  const rows: TakeoffTodoRow[] = [];
  const facts = collectFacts(src);
  for (const [i, it] of (snap.openItems ?? []).entries()) {
    const role = it?.needRole ? DOMAIN_ROLE[String(it.needRole)] : undefined;
    rows.push({
      key: `oi-${i}`,
      who: String(it?.needRole ?? '待指派'),
      what: String(it?.detail ?? it?.kind ?? '服务端待办'),
      doneWhen: it?.blockers && it.blockers.length > 0 ? `解除：${it.blockers.join('、')}` : '按 needRole 完成对应核验/补证（服务端核销）',
      action: '打开对应格子办理',
      cell: role ? { domain: role, row: 'human' } : null,
      entry: role ? null : 'materials',
    });
  }
  for (const [i, f] of (snap.session?.followups ?? []).entries()) {
    const role = f?.ownerRole ? DOMAIN_ROLE[String(f.ownerRole)] : undefined;
    rows.push({
      key: `fu-${i}`,
      who: String(f?.ownerRole ?? '待指派'),
      what: String(f?.reason ?? '转会后待办'),
      doneWhen: String(f?.nextAction ?? '补证后由新依据包复核核销'),
      action: '回原格子',
      cell: role ? { domain: role, row: 'human' } : null,
      entry: role ? null : 'qa',
    });
  }
  const chan = channelRunState(src.channelTasks);
  if (chan.followup > 0) {
    rows.push({
      key: 'chan-fup', who: 'business', what: `处理链待补件/转人工 ${chan.followup} 项`,
      doneWhen: '按材料页逐任务回执补齐后自动续跑', action: '打开材料面板', cell: null, entry: 'materials',
    });
  }
  if (chan.blocked > 0) {
    rows.push({
      key: 'chan-blk', who: '系统（自动续跑）', what: `处理链被阻断等待恢复 ${chan.blocked} 项`,
      doneWhen: '上游恢复后自动续跑（勿重复提交）', action: '查看材料页任务回执', cell: null, entry: 'materials',
    });
  }
  if ((snap.session?.openQuestions ?? 0) > 0) {
    rows.push({
      key: 'qa', who: '按问题 target_role', what: `回答处理链补证问题 ${snap.session?.openQuestions} 个`,
      doneWhen: '回答经人工复核（verified 唯一来源）', action: '打开问题·补证', cell: null, entry: 'qa',
    });
  }
  if (src.factConflicts > 0) {
    rows.push({
      key: 'conf', who: 'business/credit', what: `复核事实冲突 ${src.factConflicts} 处（同键多现行断言）`,
      doneWhen: '冲突断言经更正/复核收口（不以最后上传覆盖）', action: '打开材料面板', cell: null, entry: 'materials',
    });
  }
  for (const d of BACKEND_DOMAINS) {
    if (facts[d].currency === 'changed') {
      rows.push({
        key: `chg-${d}`, who: d, what: `${DOMAIN_NAME[d]}域依据已变化：更新该域结论以解冻`,
        doneWhen: '按当前有效证据重新登记域结果（引用现行运行）', action: '回原格子', cell: { domain: d, row: 'closure' }, entry: null,
      });
    }
  }
  return rows;
}

/** 行列中文名（组件与测试共用）。 */
export function takeoffDomainName(d: TakeoffDomainId): string { return DOMAIN_NAME[d]; }
export function takeoffRowName(r: TakeoffRowId): string { return ROW_NAME[r]; }

/** 格子无障碍名称：状态/档位/原因可读，不只靠颜色。 */
export function cellAriaLabel(c: TakeoffCellView): string {
  const parts: string[] = [DOMAIN_NAME[c.domain], ROW_NAME[c.row]];
  if (c.completed) parts.push('已完成（绿=工作完成，≠批准）');
  else if (c.displayBucket != null) parts.push(`进度档位 ${c.displayBucket}%`);
  else parts.push('进度未知（分母未知，未硬补）');
  if (c.running) parts.push('运行中');
  if (c.needsReview) parts.push('有卡点待处理');
  if (c.frozen) parts.push('已冻结（依据变化，可补件可提问）');
  return `${parts.join('，')}。点击查看事项`;
}
