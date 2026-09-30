// TAKEOFF-FA-1.0.0 · 六助手受控简报（确定性替身）纯函数。
// 边界（目标§4）：
// - 输入只来自服务端读面：03 收口 finalization（Edge 代理 tid/cid）+ Edge admission + A 评估读回；
// - 输出是解释文本与依据引用（finId/inputHash/artifactId 可追溯），不写任何业务状态；
// - 聊天文本/简报都不能修改方案、解除冻结或确认结论（命令链不在此处）；
// - 真实模型未获本轮授权（NOT_RUN）：接线结构=读→组答→展示回执；真实模型接入时替换点唯一=本组答函数；
// - 同一 finId 重复询问=去重，不重复全量推理；读取失败如实说，不伪造完成。

export type AssistantBriefKind = 'business' | 'policy' | 'credit' | 'commerce' | 'asset' | 'jianwei';

export const ASSISTANT_BRIEF_NAMES: Record<AssistantBriefKind, string> = {
  business: '业务', policy: '政策', credit: '信审', commerce: '商务', asset: '资产', jianwei: '见微',
};

/** 服务端读面的最小形状（只取本简报消费的字段；多余字段不进简报）。 */
export interface AssistantBriefSource {
  customerName?: string | null;
  assessment?: {
    assessmentId?: string; status?: string; stale?: boolean; version?: number | null;
    candidateRevision?: number | null; inputVersion?: number | null;
    requestedAmountMinor?: number | null; ruleVersion?: string | null;
  } | null;
  admission?: {
    request?: { requestedAmount?: number | null } | null;
    candidate?: {
      version?: number | null; suggestedAmount?: number | null; suggestedTermMonths?: number | null;
      referencePriceMinor?: number | null; priceUnit?: string | null; tendency?: string | null;
      conditions?: string[] | null;
    } | null;
    // 注：admission 侧字段多为「值 | null」联合；本简报只读，放宽 null 不改变语义。
    inputVersion?: number | null; candidateRevision?: number | null;
    preassessment?: { outcome?: string | null; confirmationId?: string | null; confirmedBy?: string | null; needsReview?: boolean | null } | null;
    stale?: boolean | null;
  } | null;
  finalization?: {
    finId?: string; authority?: string; rulesetVersion?: string | null; inputHash?: string | null;
    gate?: { result?: string; reasons?: string[] | null; ruleIds?: string[] | null } | null;
    amountCandidate?: {
      evaluable?: boolean; tendency?: string | null;
      supportable?: { min?: number | null; max?: number | null; currency?: string | null } | null;
      suggestedTerm?: { value?: number | null; unit?: string | null; basis?: string | null } | null;
      referencePrice?: { value?: number | null; currency?: string | null; basis?: string | null } | null;
      conditions?: string[] | null; gaps?: string[] | null;
      frozen?: boolean; frozenReasons?: string[] | null;
    } | null;
    nextStep?: { label?: string; detail?: string } | string | null;
    artifactRefs?: unknown;
  } | null;
}

export interface AssistantBrief {
  kind: AssistantBriefKind;
  /** 确定性解释文本（含依据引用；不编造数字，未知如实说）。 */
  text: string;
  /** 可追溯引用：finId / inputHash / artifactId / assessmentId。 */
  refs: string[];
  /** 与上次询问的收口相同=true（本次不做全量组答）。 */
  deduped: boolean;
  /** 恒 true：本实现是确定性替身，非真实模型。 */
  deterministic: true;
}

const fmtMinor = (m: number | null | undefined, currency?: string | null): string => {
  if (m == null) return '未知';
  const yuan = m / 100;
  const s = Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2);
  return `¥${s}${currency ? ` ${currency}` : ''}`;
};
// 03 收口 amountCandidate 的金额/价格单位=元（见 PROTOCOL §5 示例与最终栈实测 240.56）；与 A 候选的 minor 口径不同。
const fmtYuan = (m: number | null | undefined, currency?: string | null): string => {
  if (m == null) return '未知';
  const s = Number.isInteger(m) ? String(m) : m.toFixed(2);
  return `¥${s}${currency ? ` ${currency}` : ''}`;
};

function amountCandidateLines(ac: NonNullable<AssistantBriefSource['finalization']>['amountCandidate']): string[] {
  if (!ac) return [];
  const lines: string[] = [];
  if (ac.evaluable === false) {
    lines.push(`金额候选不可评估（不凑数字）${Array.isArray(ac.gaps) && ac.gaps.length > 0 ? `：${ac.gaps.join('；')}` : ''}`);
  } else if (ac.supportable?.max != null || ac.supportable?.min != null) {
    const range = ac.supportable?.min != null && ac.supportable?.max != null && ac.supportable.min !== ac.supportable.max
      ? `${fmtYuan(ac.supportable.min)}–${fmtYuan(ac.supportable.max, ac.supportable.currency ?? undefined)}`
      : fmtYuan(ac.supportable?.max ?? ac.supportable?.min, ac.supportable?.currency ?? undefined);
    lines.push(`可支持区间 ${range}（authority=none，倾向 ${ac.tendency ?? '未声明'}）`);
  }
  if (ac.suggestedTerm?.value != null) lines.push(`建议期限 ${ac.suggestedTerm.value} ${ac.suggestedTerm.unit ?? 'month'}${ac.suggestedTerm.basis ? `（口径：${ac.suggestedTerm.basis}）` : ''}`);
  if (ac.referencePrice?.value != null) lines.push(`参考价格 ${fmtYuan(ac.referencePrice.value, ac.referencePrice.currency ?? undefined)}${ac.referencePrice.basis ? `（${ac.referencePrice.basis}）` : ''}`);
  if (Array.isArray(ac.conditions) && ac.conditions.length > 0) lines.push(`待满足条件：${ac.conditions.join('；')}`);
  if (Array.isArray(ac.gaps) && ac.gaps.length > 0 && ac.evaluable !== false) lines.push(`缺口（需补材料/事实）：${ac.gaps.join('；')}`);
  if (ac.frozen === true) lines.push(`已冻结：${Array.isArray(ac.frozenReasons) && ac.frozenReasons.length > 0 ? ac.frozenReasons.join('；') : '原因未声明'}——不可一键解除，解除须对应证据被取代/纠正并重新收口`);
  return lines;
}

/**
 * 组装某助手对当前客户/评估的确定性简报。
 * @param priorFinId 上次询问时的收口 id（同一客户内去重；客户/评估变化由调用方重置）。
 */
export function composeAssistantBrief(
  kind: AssistantBriefKind,
  src: AssistantBriefSource,
  priorFinId: string | null,
): AssistantBrief {
  const who = ASSISTANT_BRIEF_NAMES[kind];
  const fin = src.finalization ?? null;
  const as = src.assessment ?? null;
  const adm = src.admission ?? null;
  const ac = fin?.amountCandidate ?? null;

  // 收口读取失败的诚实路径：不伪造分析结论。
  if (fin === null || fin.finId == null) {
    return {
      kind, deterministic: true, deduped: false,
      refs: as?.assessmentId ? [as.assessmentId] : [],
      text: `${who}：处理链收口尚未读到（无 finId）——不能据此说分析已完成。可先上传/补证（统一提交链），处理链自动登记后本简报会引用新收口。`,
    };
  }

  const refs: string[] = [fin.finId];
  if (fin.inputHash) refs.push(`inputHash=${fin.inputHash}`);
  if (as?.assessmentId) refs.push(as.assessmentId);
  const artIds = Array.isArray(fin.artifactRefs)
    ? (fin.artifactRefs as Array<Record<string, unknown>>).map((r) => (typeof r === 'string' ? r : (r?.artifactId as string | undefined))).filter((x): x is string => x != null)
    : [];
  if (artIds.length > 0) refs.push(...artIds.slice(0, 5));

  if (priorFinId != null && fin.finId === priorFinId) {
    return {
      kind, deterministic: true, deduped: true, refs: [fin.finId],
      text: `${who}：收口未变化（finId=${fin.finId} 与上次相同）——不重复全量推理；有新材料或新事实后再问会引用新收口。`,
    };
  }

  const header = `【${who} · 确定性简报（服务端读面组答，非真实模型）】`;
  const body: string[] = [];

  if (kind === 'business' || kind === 'jianwei') {
    body.push(`客户 ${src.customerName ?? '（名称未读到）'}：${as?.status ? `评估 ${as.status}` : '评估状态未读到'}${as?.stale === true ? '，依据已过时（stale）' : ''}`);
    const reqAmount = adm?.request?.requestedAmount ?? as?.requestedAmountMinor ?? null;
    body.push(reqAmount != null ? `首次回租需求已登记：金额 ${fmtMinor(reqAmount)}（客户表述，非融资申请）` : '首次回租需求未录入（如实待补，不冒用融资申请）');
  }
  if (kind === 'policy' || kind === 'jianwei') {
    const g = fin.gate ?? null;
    body.push(g?.result
      ? `Gate ${g.result}${Array.isArray(g.reasons) && g.reasons.length > 0 ? `（${g.reasons.join('；')}）` : ''}${Array.isArray(g.ruleIds) && g.ruleIds.length > 0 ? ` 规则[${g.ruleIds.join(',')}]` : ''}`
      : `Gate 结果未读到${fin.rulesetVersion ? `（规则版本 ${fin.rulesetVersion}）` : ''}`);
  }
  if (kind === 'credit' || kind === 'jianwei') {
    body.push(as?.stale === true
      ? '评估依据已过时：正面确认会被 STALE_BASIS 阻断，需按当前输入重新评估后确认'
      : '评估依据当前性：未标记过时（服务端确认时仍会重查）');
    const pre = adm?.preassessment ?? null;
    body.push(pre?.confirmationId
      ? `预评估结论已确认：${pre.outcome ?? '未知'}（${pre.confirmedBy ?? '有权人'}）${pre.needsReview === true ? '，需复核：确认依据被取代（旧确认保留，不默认重开）' : ''}`
      : '预评估结论未确认（终点=有权人员确认；本助手不能代替确认）');
  }
  if (kind === 'commerce' || kind === 'jianwei') {
    body.push(...amountCandidateLines(ac));
    if (adm?.candidate?.version != null || as?.candidateRevision != null) {
      body.push(`同版锚：候选 r${adm?.candidate?.version ?? as?.candidateRevision} · 输入 v${adm?.inputVersion ?? as?.inputVersion ?? '?'}`);
    }
  }
  if (kind === 'asset' || kind === 'jianwei') {
    if (ac?.frozen === true) body.push(`资产相关冻结仍在：${Array.isArray(ac.frozenReasons) ? ac.frozenReasons.join('；') : '原因未声明'}——不可一键解除，解除须对应证据被取代/纠正并重新收口；权属/价值核验不等待商务，补证后自动续跑`);
    else body.push('资产核验（真实性/权属/价值）：以现行材料与处理链事实为准；补证后受影响格子会真实更新，无关格子不清零');
  }
  if (kind === 'jianwei') {
    const ns = fin.nextStep ?? null;
    body.push(typeof ns === 'string' ? `下一步：${ns}` : ns?.label ? `下一步：${ns.label}${ns.detail ? `（${ns.detail}）` : ''}` : '下一步：见待办（各专业助手按域处理）');
  }

  if (body.length === 0) body.push('当前授权范围内暂无可解释事项（收口无相关字段变化）。');
  return { kind, deterministic: true, deduped: false, refs, text: `${header}\n${body.map((b) => `· ${b}`).join('\n')}` };
}

/** 简报读取失败（网络/上游/权限）的诚实回执文本——与成功简报同形，供调用方直接展示。 */
export function composeAssistantBriefError(kind: AssistantBriefKind, status: number | null, errCode?: string | null): string {
  const who = ASSISTANT_BRIEF_NAMES[kind];
  return `【${who} · 受控简报读取失败】状态 ${status ?? '未知'}${errCode ? ` ${errCode}` : ''}：服务端读面不可达或无权限——如实转达，不伪造分析结果；可稍后重试或改用材料面板核对原件。`;
}

// ---------------------------------------------------------------------------
// 建议提问（2026-09-29 · 01-front）：2–3 条与当前状态相关的只读问题。
// 只消费服务端读面结构字段（TakeoffSource 的最小形状，就地内联保持本模块零 import）；
// 点击=填入输入框由用户发送，不自动执行、不推进任何业务状态（聊天文字不算审批）。
// ---------------------------------------------------------------------------
export interface SuggestionSource {
  customerName?: string | null;
  currentMaterials?: number | null;
  factConflicts?: number;
  snapshot?: {
    assessments?: Array<{ status?: string | null; stale?: boolean | null }> | null;
    admission?: {
      request?: { requestedAmount?: number | null } | null;
      candidate?: { tendency?: string | null; conditions?: string[] | null } | null;
    } | null;
    decisionStatus?: {
      basis?: { gate?: { result?: string | null } | null; blockedActions?: string[] } | null;
    } | null;
  } | null;
}

const SUGGESTION_BY_KIND: Record<AssistantBriefKind, string[]> = {
  business: ['这位客户的经营与订单情况怎么样？', '本次首次回租需求登记的金额和用途是什么？'],
  policy: ['这位客户符合准入边界吗？有哪些政策限制？', '本次交易在区域和行业上有什么要求？'],
  credit: ['信审现在最关注什么风险？', '现金流覆盖率是怎么算出来的？'],
  commerce: ['建议额度和期限是怎么得出的？', '参考价格的口径是什么？'],
  asset: ['设备权属与价值核验进展如何？', '资产核验还缺哪些材料？'],
  jianwei: ['当前办理整体进展如何？', '下一步建议先处理什么？'],
};

export function composeAssistantSuggestions(kind: AssistantBriefKind, src: SuggestionSource): string[] {
  const out: string[] = [];
  const basis = src.snapshot?.decisionStatus?.basis ?? null;
  if ((src.factConflicts ?? 0) > 0) out.push(`材料里有 ${src.factConflicts} 处内容互相矛盾，应该以哪份为准？`);
  if (basis?.gate?.result === 'rejected') out.push('这次准入为什么被规则阻断？依据是哪些规则？');
  if (Array.isArray(basis?.blockedActions) && basis!.blockedActions!.length > 0) out.push('目前有哪些办理动作被暂缓了？恢复需要什么？');
  const conditions = src.snapshot?.admission?.candidate?.conditions ?? null;
  if (Array.isArray(conditions) && conditions.length > 0) out.push(`待满足的条件（${conditions.slice(0, 2).join('、')}）目前进展如何？`);
  if (src.currentMaterials === 0) out.push('还没有现行材料：第一步应该准备哪些材料？');
  if (src.snapshot?.admission?.request?.requestedAmount == null) out.push('首次回租需求还没登记，需要客户补充哪些信息？');
  for (const q of SUGGESTION_BY_KIND[kind]) {
    if (out.length >= 3) break;
    out.push(q);
  }
  return out.slice(0, 3);
}

const ASSESSMENT_STATUS_TEXT: Record<string, string> = {
  collecting: '材料收集中', candidate_ready: '已有建议方案', awaiting_human_review: '待人工确认',
  preassessment_confirmed: '结论已确认', rejected: '不支持', superseded: '已撤回',
};

/**
 * 无模型时的确定性"案例说明"（2026-09-30-final）：从服务端读面投影回答"现在什么情况/为什么/能做什么"。
 * 来源固定标注"案例说明（服务端读面，非真实模型）"；不编造数字，未知如实；不推进业务。
 */
export function composeCaseExplanation(kind: AssistantBriefKind, src: SuggestionSource): string {
  const who = ASSISTANT_BRIEF_NAMES[kind];
  const basis = src.snapshot?.decisionStatus?.basis ?? null;
  const lines: string[] = [];
  const latest = (src.snapshot?.assessments ?? []).length > 0 ? (src.snapshot?.assessments ?? [])[(src.snapshot?.assessments ?? []).length - 1]! : null;
  lines.push(`当前客户：${src.customerName ?? '（名称未读到）'}${latest?.status ? `；评估状态：${ASSESSMENT_STATUS_TEXT[String(latest.status)] ?? String(latest.status)}${latest.stale === true ? '（依据已过时，需复核）' : ''}` : ''}`);
  const materials = src.currentMaterials;
  lines.push(materials == null ? '现行材料数暂时无法读取（未知≠零）。' : `现行材料 ${materials} 份${materials === 0 ? '：还没有可分析的原件，先上传材料。' : ''}。`);
  const req = src.snapshot?.admission?.request?.requestedAmount ?? null;
  lines.push(req != null ? `首次回租需求已登记（金额以需求登记为准）。` : '首次回租需求尚未登记（如实待补）。');
  if (basis?.gate?.result) lines.push(`准入规则门：${basis.gate.result}${basis.gate.result === 'rejected' ? '——本次按规则不能通过，不能强制放行。' : ''}`);
  if (Array.isArray(basis?.blockedActions) && basis!.blockedActions!.length > 0) lines.push(`暂缓动作：${basis!.blockedActions!.join('、')}（需先解除前置条件）。`);
  const conditions = src.snapshot?.admission?.candidate?.conditions ?? null;
  if (Array.isArray(conditions) && conditions.length > 0) lines.push(`候选待满足条件：${conditions.join('；')}。`);
  if ((src.factConflicts ?? 0) > 0) lines.push(`有 ${src.factConflicts} 处材料内容互相矛盾：需人工复核后才能继续确认。`);
  const suggestion = composeAssistantSuggestions(kind, src)[0];
  if (suggestion) lines.push(`可继续的事：${suggestion}`);
  return `【案例说明 · 服务端读面组答（非真实模型） · ${who}】\n${lines.map((l) => `· ${l}`).join('\n')}\n（自由模型问答未配置：以上为当前真实投影说明；可查看材料原件、按页面按钮办理，或请负责人接入模型。）`;
}
