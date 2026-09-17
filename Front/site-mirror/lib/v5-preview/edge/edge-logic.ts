// Edge 接线·纯逻辑层（任务三 C2 最小前端接线）：SSE 帧解析、连接状态机、
// 会话操作条可用动作、等待原因、额度/报告区投影。全部为纯函数——服务端数据是唯一事实源，
// 本层只做"形状转换与文案映射"，不发明状态、不本地改灯色（后端拒绝原样透出）。
// 对应消费面契约：Back/Edge/contract/consumed-surface-v1.json。

export type EdgePhase = 'off' | 'connecting' | 'live' | 'reconnecting' | 'ended';

export interface DomainVerdictShape {
  domain?: string; required?: boolean; currency?: string; reasons?: string[];
  reusable?: boolean; opinionVersion?: number | null; analysisRunRef?: string | null;
}

export interface EdgeSnapshotShapes {
  customer?: { customerId?: string; displayName?: string; status?: string } | null;
  facilities?: Array<{
    facilityId?: string; approvedAmountMinor?: number; currency?: string; status?: string;
    reservedMinor?: number; committedMinor?: number; outstandingMinor?: number;
    availableForNewDrawMinor?: number; overLimit?: boolean; staleBlockers?: string[];
  }>;
  totalsMinor?: { exposureNow?: number; outstanding?: number; committed?: number; reserved?: number } | null;
  decisionStatus?: {
    basis?: {
      packageId?: string; revision?: number; basisVersion?: string; status?: string;
      decisionReadiness?: boolean; gaps?: unknown[]; requiredActions?: unknown[]; blockedActions?: string[];
      candidate?: unknown; gate?: { result?: string; rulePackVersion?: string; reasonCodes?: string[] } | null;
      currency?: DomainVerdictShape[];
    } | null;
    facilityTotalsMinor?: { proposed?: number; approvedInactive?: number; active?: number; suspended?: number; available?: number } | null;
    reviewQueue?: Array<{ findingId?: string; findingType?: string; severity?: string; status?: string }>;
    reportRefs?: Array<{ reportId?: string; kind?: string; version?: number; subjectId?: string }>;
  } | null;
  findings?: Array<{ findingId?: string; findingType?: string; severity?: string; status?: string; summary?: string }>;
  objectInventory?: Array<{
    objectId?: string; objectType?: string; siteSnapshotId?: string | null; sceneVersion?: number | string | null;
    linkState?: string; customerSuperseded?: boolean; artifactId?: string | null;
  }>;
  listTruncated?: { findings?: boolean; objectInventory?: boolean };
  refsSource?: string;
  refsExhaustive?: boolean;
  assessments?: Array<{
    assessmentId?: string; status?: string; stale?: boolean; ruleVersion?: string | null;
    snapshotHash?: string | null; candidate?: {
      tendency?: string; supportableAmountMinor?: number; currency?: string;
      conditions?: string[]; warnings?: string[]; producedBy?: string;
    } | null;
  }>;
  session?: {
    sessionId?: string; version?: number; runStatus?: string; closureStatus?: string; title?: string;
    availableActions?: string[];
    outbound?: { paused?: boolean; dispatchGeneration?: number; inFlight?: Array<{ status?: string }> } | null;
    openQuestions?: number;
    followups?: Array<{ followupId?: string; ownerRole?: string; reason?: string; nextAction?: string }>;
    coverage?: { total?: number; required?: number; verified?: number; open?: number };
    items?: Array<{ itemId?: string; itemKey?: string; title?: string; status?: string; responsibleRole?: string }>;
  } | null;
  openItems?: Array<{ kind: string; ref?: string; needRole?: string; detail?: string; blockers?: string[] }>;
}

/** live 消息（Edge /messages 投递回执）：服务端状态是唯一事实源，本地不补写成功。 */
export interface EdgeLiveMessage {
  id: string;
  requestId: string;
  at: string;
  audience: 'customer' | 'internal';
  text: string;
  state: 'sending' | 'sent' | 'unknown' | 'failed';
  code?: string;
  replayed?: boolean;
}

const LIVE_MSG_STATE_LABEL: Record<EdgeLiveMessage['state'], string> = {
  sending: '投递中', sent: '已送达（服务端回执）', unknown: '结果未知·对账中', failed: '发送失败',
};

/** live 消息 → 首页聊天形状（不伪装为任何本地模拟产物）。 */
export function toLiveChatMessage(m: EdgeLiveMessage): {
  id: string; fromKind: 'business' | 'domain' | 'system'; fromName: string; text: string; at: string; marks: string[]; origin: 'human' | 'preset' | 'model';
} {
  return {
    id: m.id,
    fromKind: 'business',
    fromName: '本会话（真实后台）',
    text: m.text,
    at: m.at,
    marks: [m.audience === 'customer' ? '受众:客户' : '受众:内部', LIVE_MSG_STATE_LABEL[m.state]],
    origin: 'human',
  };
}

/** SSE 原始文本 → 帧数组（event/data/id）。增量输入可反复调用（调用方持有缓冲）。
 *  按规范兼容 CRLF/CR 行尾与多行 data:（多行以 \n 连接）；行内冒号后可选单个空格。 */
export function parseSseFrames(buffer: string): { frames: Array<{ event: string; data: string; id: string | null }>; rest: string } {
  const frames: Array<{ event: string; data: string; id: string | null }> = [];
  // 规范化行尾（幂等）：\r\n → \n，孤立 \r → \n。调用方持 rest 跨调用，重复规范化安全。
  let rest = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let idx: number;
  while ((idx = rest.indexOf('\n\n')) !== -1) {
    const raw = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const frame = { event: '', data: '', id: null as string | null };
    const dataLines: string[] = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith(':')) continue; // 心跳/注释
      if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      else if (line.startsWith('event:')) frame.event = line.slice(6).trim();
      else if (line.startsWith('id:')) frame.id = line.slice(3).trim();
    }
    frame.data = dataLines.join('\n');
    if (frame.event) frames.push(frame);
  }
  return { frames, rest };
}

/** 连接状态机（纯转移函数；reconnecting 只由"曾 live 后失联"进入，不把失败伪装成成功）。 */
export function nextPhase(current: EdgePhase, ev: { type: 'connect' | 'opened' | 'drop' | 'stop' | 'auth-failed' }): EdgePhase {
  switch (ev.type) {
    case 'connect': return current === 'live' ? 'reconnecting' : 'connecting';
    case 'opened': return 'live';
    case 'drop': return current === 'off' || current === 'ended' ? 'off' : 'reconnecting';
    case 'stop': return 'off';
    case 'auth-failed': return 'off';
  }
}

/** 会话操作条动作定义（key 与服务端 availableActions 及动作代理路径对齐）。 */
export const SESSION_ACTION_DEFS: Record<string, { key: string; label: string; kind: 'primary' | 'normal' }> = {
  start: { key: 'start', label: '开始会话', kind: 'primary' },
  pause: { key: 'pause', label: '暂停自动提问', kind: 'primary' },
  resume: { key: 'resume', label: '恢复会话', kind: 'primary' },
  end: { key: 'end', label: '结束本轮', kind: 'normal' },
  close: { key: 'close', label: '收口归档', kind: 'normal' },
};

export interface SessionActionsResult {
  acts: Array<{ key: string; label: string; kind: 'primary' | 'normal' }>;
  /** true=按服务端 availableActions 投影（契约要求以服务端为准）；false=服务端未提供，本地推导兜底。 */
  fromServer: boolean;
}

/** 会话操作条：优先投影服务端 availableActions（UI 只做发起，拒绝来自服务端）；
 *  服务端未提供该字段时按 runStatus 本地推导兜底并如实标注 fromServer=false。 */
export function deriveSessionActions(session: NonNullable<EdgeSnapshotShapes['session']>): SessionActionsResult {
  const server = Array.isArray((session as { availableActions?: unknown }).availableActions)
    ? ((session as { availableActions: unknown[] }).availableActions.filter((k): k is string => typeof k === 'string'))
    : null;
  if (server !== null) {
    return { acts: server.map((k) => SESSION_ACTION_DEFS[k]).filter(Boolean), fromServer: true };
  }
  const run = session.runStatus;
  const acts: Array<{ key: string; label: string; kind: 'primary' | 'normal' }> = [];
  if (run === 'preparing' || run === 'ready') acts.push(SESSION_ACTION_DEFS.start);
  if (run === 'in_progress') acts.push(SESSION_ACTION_DEFS.pause);
  if (run === 'suspended') acts.push(SESSION_ACTION_DEFS.resume);
  if (run === 'in_progress' || run === 'suspended') acts.push(SESSION_ACTION_DEFS.end);
  if (run === 'ended' && session.closureStatus !== 'closed') acts.push(SESSION_ACTION_DEFS.close);
  return { acts: acts.filter(Boolean), fromServer: false };
}

/** 等待原因（只回显服务端状态，不推测结论）。 */
export function deriveWaitReason(session: NonNullable<EdgeSnapshotShapes['session']>): string | null {
  if (session.runStatus === 'suspended') return '已暂停：自动提问停发（在途外发单独列明），等待人工恢复';
  if (session.runStatus === 'preparing' || session.runStatus === 'ready') return '会话未开始：材料前提齐备后才可开始';
  if (session.runStatus === 'ended') {
    const n = session.followups?.length ?? 0;
    return n > 0 ? `会话已结束：${n} 项未决转会后待办（补证后新依据包可复核）` : '会话已结束';
  }
  const inFlight = session.outbound?.inFlight?.length ?? 0;
  if (session.outbound?.paused) return `自动提问已暂停；在途外发 ${inFlight} 条（sent 不可撤回，unknown 须对账）`;
  if ((session.openQuestions ?? 0) > 0) return `等待回答：开放问题 ${session.openQuestions} 个`;
  const open = session.coverage?.open ?? 0;
  if (open > 0) return `等待核验：${open} 项必要核验未完成`;
  return null;
}

const WAN = 1_000_000; // 1 万元 = 1e6 分

/** 金额（分）→ 展示串；非 CNY 原样标注币种，不换算。 */
export function fmtAmount(minor: number | undefined | null, currency?: string): string {
  if (typeof minor !== 'number' || !Number.isFinite(minor)) return '未知';
  const yuan = minor / 100;
  const wanStr = Math.abs(minor) >= WAN ? `${(minor / WAN).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 万元` : `${yuan.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 元`;
  return currency && currency !== 'CNY' ? `${wanStr}（${currency}）` : wanStr;
}

const FACILITY_STATUS_LABEL: Record<string, string> = {
  proposed: '已提案（待批准）', approved_inactive: '已批准·未激活', active: '已激活',
  suspended: '已暂停', expired: '已过期', closed: '已关闭',
};

const BLOCKER_LABEL: Record<string, string> = {
  stale_basis: '依据已失效', over_limit: '超限', facility_status_suspended: '设施暂停',
};

/** 额度/报告区行（候选=评估候选，已批准=设施，可用=服务端推导 availableForNewDrawMinor）。 */
export function deriveCreditLines(snap: EdgeSnapshotShapes): Array<{ label: string; value: string; tone: 'neutral' | 'warn' | 'info' }> {
  const lines: Array<{ label: string; value: string; tone: 'neutral' | 'warn' | 'info' }> = [];
  const latestAssessment = snap.assessments?.[snap.assessments.length - 1];
  if (latestAssessment?.candidate) {
    const c = latestAssessment.candidate;
    lines.push({
      label: '候选（模型/Agent·非正式审批）',
      value: `${fmtAmount(c.supportableAmountMinor, c.currency)} · 依据规则 ${latestAssessment.ruleVersion ?? '未知'} · 快照 ${(latestAssessment.snapshotHash ?? '').slice(0, 8) || '未知'}`,
      tone: 'info',
    });
  }
  for (const f of snap.facilities ?? []) {
    const blockers = (f.staleBlockers ?? []).map((b) => BLOCKER_LABEL[b] ?? b);
    lines.push({
      label: `已批准额度（${FACILITY_STATUS_LABEL[f.status ?? ''] ?? f.status ?? '未知'}）`,
      value: `${fmtAmount(f.approvedAmountMinor, f.currency)} · 已预占 ${fmtAmount(f.reservedMinor, f.currency)} · 可用 ${fmtAmount(f.availableForNewDrawMinor, f.currency)}${blockers.length > 0 ? ` · 阻断：${blockers.join('、')}` : ''}`,
      tone: blockers.length > 0 || f.overLimit ? 'warn' : 'neutral',
    });
  }
  const t = snap.totalsMinor;
  if (t) {
    lines.push({ label: '客户合计在途敞口', value: fmtAmount(t.exposureNow, 'CNY'), tone: 'neutral' });
  }
  return lines;
}

/** 动作命令的 requestId（同动作重试必须复用同 ID——由调用方保存映射）。 */
export function actionRequestId(sessionId: string, action: string, nonce: string): string {
  return `ui-${sessionId}-${action}-${nonce}`.slice(0, 128);
}

/** 模式徽标：如实呈现——Live=真实后台；本地=合成模拟；回放/训练=未建（不冒充）。 */
export function modeBadge(phase: EdgePhase): { text: string; tone: 'live' | 'local' | 'off' } {
  if (phase === 'live' || phase === 'reconnecting') return { text: phase === 'live' ? 'Live · 真实后台' : '重连中 · 真实后台', tone: 'live' };
  return { text: '本地合成演示（未接真实后台）', tone: 'local' };
}

// ---------------------------------------------------------------------------
// 任务03 C3/C4：live 投影纯函数——只做服务端数据到展示形状的转换，不发明状态。
// ---------------------------------------------------------------------------

const FOUR_DOMAINS: Array<{ id: 'policy' | 'credit' | 'commerce' | 'asset'; name: string }> = [
  { id: 'policy', name: '政策' },
  { id: 'credit', name: '信审' },
  { id: 'commerce', name: '商务' },
  { id: 'asset', name: '资产' },
];

const CURRENCY_TEXT: Record<string, string> = {
  current: '依据当前·可复用（≠批准）',
  changed: '依据已变化：须更新后再用',
  missing: '缺失：本轮须先出域结果',
};

/** live 四域矩阵：决策依据包的逐域 currency 判定（服务端 evaluateDomainCurrency 原样投影）。
 *  无依据包/域缺失 → 灰色"未开始"，不借本地 scenario 灯色；分段不伪造流水线进度。 */
export function deriveDomainRowsLive(
  snap: EdgeSnapshotShapes | null,
): Array<{ domainId: 'policy' | 'credit' | 'commerce' | 'asset'; name: string; segmentLabels: [string, string, string, string]; segments: ['pending', 'pending', 'pending', 'pending']; judgmentStatus: 'green' | 'yellow' | 'red' | 'gray'; judgmentText: string; summary: string }> {
  const verdicts = snap?.decisionStatus?.basis?.currency as DomainVerdictShape[] | undefined;
  const byDomain = new Map<string, DomainVerdictShape>();
  for (const v of Array.isArray(verdicts) ? verdicts : []) {
    if (typeof v?.domain === 'string') byDomain.set(v.domain, v);
  }
  const hasBasis = Boolean(snap?.decisionStatus?.basis);
  return FOUR_DOMAINS.map((d) => {
    const v = byDomain.get(d.id);
    if (!hasBasis || !v) {
      return {
        domainId: d.id, name: d.name,
        segmentLabels: ['依据', '—', '—', '—'], segments: ['pending', 'pending', 'pending', 'pending'] as ['pending', 'pending', 'pending', 'pending'],
        judgmentStatus: 'gray' as const,
        judgmentText: hasBasis ? '未开始：该域无冻结状态' : '未开始：尚无决策依据包',
        summary: '服务端无该域判定记录；灰色=未知/未开始（非通过）',
      };
    }
    const cur = String(v.currency ?? 'missing');
    const status = cur === 'current' ? 'green' as const : cur === 'changed' ? 'yellow' as const : 'gray' as const;
    const reasons = Array.isArray(v.reasons) && v.reasons.length > 0 ? `（${v.reasons.join('、')}）` : '';
    return {
      domainId: d.id, name: d.name,
      segmentLabels: ['依据', '—', '—', '—'], segments: ['pending', 'pending', 'pending', 'pending'] as ['pending', 'pending', 'pending', 'pending'],
      judgmentStatus: status,
      judgmentText: CURRENCY_TEXT[cur] ?? `未知状态：${cur}`,
      summary: `版本 ${v.opinionVersion ?? '无'}${v.reusable === false ? ' · 不可复用' : ' · 可复用'}${reasons}`,
    };
  });
}

const RUN_STATUS_LABEL: Record<string, string> = {
  preparing: '准备中', ready: '就绪待开始', in_progress: '进行中', suspended: '已暂停', ended: '已结束·待收口', closed: '已收口',
};

/** live 生命周期：检查会话 runStatus/closureStatus → 阶段映射（服务端状态，非本地轮次推导）。 */
export function deriveLifecycleLive(session: EdgeSnapshotShapes['session']): { stageIndex: number; settled: boolean; label: string } {
  if (!session) return { stageIndex: 0, settled: false, label: '无进行中检查会话（服务端窗口内无会话事件）' };
  const run = String(session.runStatus ?? 'unknown');
  const closed = session.closureStatus === 'closed';
  const stageIndex = closed ? 4 : run === 'ended' ? 3 : run === 'in_progress' || run === 'suspended' ? 2 : 1;
  const label = RUN_STATUS_LABEL[run] ?? `未知运行状态：${run}`;
  return { stageIndex, settled: closed, label: closed ? '已收口归档' : label };
}

const GATE_RESULT_TEXT: Record<string, { text: string; tone: 'green' | 'yellow' | 'red' | 'gray' }> = {
  approved: { text: 'Gate 通过（规则包判定）', tone: 'green' },
  rejected: { text: 'Gate 拒绝（终态·不显示批准绿灯）', tone: 'red' },
  hold: { text: 'Gate HOLD：待人工复核', tone: 'yellow' },
  hold_for_review: { text: 'Gate HOLD：待人工复核', tone: 'yellow' },
};

/** live 决策状态行（C3.3）：候选/已批准/可用/可支用分列；拒绝/HOLD/阻断如实呈现，不给假绿灯。 */
export function deriveDecisionLines(snap: EdgeSnapshotShapes | null): Array<{ label: string; value: string; tone: 'neutral' | 'warn' | 'info' | 'good' | 'bad' }> {
  const lines: Array<{ label: string; value: string; tone: 'neutral' | 'warn' | 'info' | 'good' | 'bad' }> = [];
  const basis = snap?.decisionStatus?.basis ?? null;
  if (!basis) {
    lines.push({ label: '决策依据包', value: '未开始：尚无依据包（不推定任何批准）', tone: 'neutral' });
  } else {
    lines.push({ label: '决策依据包', value: `${basis.basisVersion ?? basis.packageId ?? '未知'} · 状态 ${basis.status ?? '未知'}`, tone: 'info' });
    const gate = basis.gate ?? null;
    const g = gate && gate.result ? GATE_RESULT_TEXT[String(gate.result)] : undefined;
    if (g) {
      const ver = gate?.rulePackVersion ? ` · 规则包 ${gate.rulePackVersion}` : '';
      lines.push({ label: 'Gate 结论', value: `${g.text}${ver}`, tone: g.tone === 'green' ? 'good' : g.tone === 'red' ? 'bad' : g.tone === 'yellow' ? 'warn' : 'neutral' });
    } else {
      lines.push({ label: 'Gate 结论', value: '未录入（灰=未知，非通过）', tone: 'neutral' });
    }
    lines.push({
      label: '决策就绪',
      value: basis.decisionReadiness === true
        ? '服务端判定：就绪（仍须有权人正式决定，非自动批准）'
        : `未就绪${Array.isArray(basis.gaps) && basis.gaps.length > 0 ? `：缺口 ${basis.gaps.length} 项` : ''}`,
      tone: basis.decisionReadiness === true ? 'good' : 'warn',
    });
    const blocked = Array.isArray(basis.blockedActions) ? basis.blockedActions : [];
    if (blocked.length > 0) {
      lines.push({ label: '阻断动作', value: blocked.join('、'), tone: 'bad' });
    }
  }
  const ft = snap?.decisionStatus?.facilityTotalsMinor ?? null;
  if (ft) {
    lines.push({
      label: '额度构成（服务端账本）',
      value: `已激活 ${fmtAmount(ft.active, 'CNY')} · 已批未激活 ${fmtAmount(ft.approvedInactive, 'CNY')} · 提案中 ${fmtAmount(ft.proposed, 'CNY')} · 可支用（新用信） ${fmtAmount(ft.available, 'CNY')}`,
      tone: 'neutral',
    });
  }
  const reports = snap?.decisionStatus?.reportRefs ?? [];
  if (reports.length > 0) {
    lines.push({ label: '报告', value: `${reports.length} 份（${reports.map((r) => r.kind ?? '未知').join('、')}）· 经服务端 audience 分权取阅`, tone: 'info' });
  }
  return lines;
}

const CAP_LABEL: Record<string, string> = {
  model: '模型', video: '视频', recording: '录制', policy: '规则包', credit: '授信内核',
};

/** 能力位 chips（C1.6/C3.5）：每个能力独立如实标注，无 all_ok；未知值原样显示。 */
export function capabilityChips(capabilities: Record<string, unknown> | null | undefined): Array<{ key: string; text: string; tone: 'off' | 'warn' | 'info' }> {
  if (!capabilities) return [];
  const out: Array<{ key: string; text: string; tone: 'off' | 'warn' | 'info' }> = [];
  for (const [key, raw] of Object.entries(capabilities)) {
    if (key === 'note' || typeof raw !== 'string') continue;
    const label = CAP_LABEL[key] ?? key;
    const v = raw.toLowerCase();
    const tone: 'off' | 'warn' | 'info' = v.includes('not_configured') || v.includes('not_wired') || v.includes('absent') || v.includes('blocked')
      ? 'off'
      : v.includes('simulation') || v.includes('synthetic') ? 'warn' : 'info';
    out.push({ key, text: `${label}：${raw}`, tone });
  }
  return out;
}
