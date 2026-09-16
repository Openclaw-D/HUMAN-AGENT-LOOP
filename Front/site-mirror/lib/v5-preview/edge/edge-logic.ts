// Edge 接线·纯逻辑层（任务三 C2 最小前端接线）：SSE 帧解析、连接状态机、
// 会话操作条可用动作、等待原因、额度/报告区投影。全部为纯函数——服务端数据是唯一事实源，
// 本层只做"形状转换与文案映射"，不发明状态、不本地改灯色（后端拒绝原样透出）。
// 对应消费面契约：Back/Edge/contract/consumed-surface-v1.json。

export type EdgePhase = 'off' | 'connecting' | 'live' | 'reconnecting' | 'ended';

export interface EdgeSnapshotShapes {
  customer?: { customerId?: string; displayName?: string; status?: string } | null;
  facilities?: Array<{
    facilityId?: string; approvedAmountMinor?: number; currency?: string; status?: string;
    reservedMinor?: number; committedMinor?: number; outstandingMinor?: number;
    availableForNewDrawMinor?: number; overLimit?: boolean; staleBlockers?: string[];
  }>;
  totalsMinor?: { exposureNow?: number; outstanding?: number; committed?: number; reserved?: number } | null;
  assessments?: Array<{
    assessmentId?: string; status?: string; stale?: boolean; ruleVersion?: string | null;
    snapshotHash?: string | null; candidate?: {
      tendency?: string; supportableAmountMinor?: number; currency?: string;
      conditions?: string[]; warnings?: string[]; producedBy?: string;
    } | null;
  }>;
  session?: {
    sessionId?: string; version?: number; runStatus?: string; closureStatus?: string; title?: string;
    outbound?: { paused?: boolean; dispatchGeneration?: number; inFlight?: Array<{ status?: string }> } | null;
    openQuestions?: number;
    followups?: Array<{ followupId?: string; ownerRole?: string; reason?: string; nextAction?: string }>;
    coverage?: { total?: number; required?: number; verified?: number; open?: number };
    items?: Array<{ itemId?: string; itemKey?: string; title?: string; status?: string; responsibleRole?: string }>;
  } | null;
  openItems?: Array<{ kind: string; ref?: string; needRole?: string; detail?: string; blockers?: string[] }>;
}

/** SSE 原始文本 → 帧数组（event/data/id）。增量输入可反复调用（调用方持有缓冲）。 */
export function parseSseFrames(buffer: string): { frames: Array<{ event: string; data: string; id: string | null }>; rest: string } {
  const frames: Array<{ event: string; data: string; id: string | null }> = [];
  let rest = buffer;
  let idx: number;
  while ((idx = rest.indexOf('\n\n')) !== -1) {
    const raw = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const frame = { event: '', data: '', id: null as string | null };
    for (const line of raw.split('\n')) {
      if (line.startsWith(':')) continue; // 心跳/注释
      if (line.startsWith('event:')) frame.event = line.slice(6).trim();
      else if (line.startsWith('data:')) frame.data = line.slice(5).trim();
      else if (line.startsWith('id:')) frame.id = line.slice(3).trim();
    }
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

/** 会话操作条：由服务端快照推导可发起的命令（拒绝仍可能来自服务端，UI 只做发起）。 */
export function deriveSessionActions(session: NonNullable<EdgeSnapshotShapes['session']>): Array<{ key: string; label: string; kind: 'primary' | 'normal' }> {
  const run = session.runStatus;
  const acts: Array<{ key: string; label: string; kind: 'primary' | 'normal' }> = [];
  if (run === 'preparing' || run === 'ready') acts.push({ key: 'start', label: '开始会话', kind: 'primary' });
  if (run === 'in_progress') acts.push({ key: 'pause', label: '暂停自动提问', kind: 'primary' });
  if (run === 'suspended') acts.push({ key: 'resume', label: '恢复会话', kind: 'primary' });
  if (run === 'in_progress' || run === 'suspended') acts.push({ key: 'end', label: '结束本轮', kind: 'normal' });
  if (run === 'ended' && session.closureStatus !== 'closed') acts.push({ key: 'close', label: '收口归档', kind: 'normal' });
  return acts;
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
