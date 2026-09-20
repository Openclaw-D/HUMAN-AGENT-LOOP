// goal-03c 客户工作本·纯逻辑层（可单测，零 React/DOM 依赖——btoa 由调用方注入或浏览器全局）。
// 纪律：颜色语义=绿(指定事项完成≠授信通过)/蓝(进行中)/红(明确禁止失败)/灰(未知未开始)，全部带文字；
// 候选≠批准≠可用 文案直出服务端字段；错误码→业务语言，不向用户暴露内部栈。
// 注意：本模块保持零 import（wb-logic.test.mjs 经 node strip-types 直载，ESM 不解析无扩展名导入）；
// 需要的展示小工具就地内联实现，不引 edge-logic。

/** IR-03-3 临时约定 v0：原件字节上限（与 Edge src/proxy.mjs transformOriginals 一致，客户端先行预检）。 */
export const MAX_ORIGINAL_BYTES = 512 * 1024;

/**
 * 演示租户常量：本轮受控演示部署的租户标识（A v2 命令要求请求帧携带 tenantId）。
 * 显示在页面页脚（演示租户），不由用户手填；生产部署须由身份目录/服务端下发（待任务01）。
 */
export const DEMO_TENANT = 't1';

export interface OriginalFileInput {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export interface OriginalEnvelope {
  name: string;
  mime: string;
  size: number;
  encoding: 'base64';
  data: string;
}

/** 浏览器 Uint8Array → base64（分块避免大参栈溢出）。仅用于 ≤512KB 的受限原件。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** 上传预检：客户端先按与 Edge 相同的规则拒绝，失败给业务语言（不触网）。 */
export function buildOriginalEnvelope(f: OriginalFileInput): { ok: true; envelope: OriginalEnvelope } | { ok: false; code: string; message: string } {
  if (!f.name || f.name.length > 200) return { ok: false, code: 'FILE_NAME_INVALID', message: '文件名需为 1..200 字符' };
  if (f.bytes.length === 0) return { ok: false, code: 'FILE_EMPTY', message: '文件内容为空' };
  if (f.bytes.length > MAX_ORIGINAL_BYTES) {
    return { ok: false, code: 'FILE_TOO_LARGE', message: `原件当前上限 ${Math.floor(MAX_ORIGINAL_BYTES / 1024)}KB（受限上传通道；更大原件待上游存储建设）` };
  }
  return {
    ok: true,
    envelope: { name: f.name, mime: f.mime || 'application/octet-stream', size: f.bytes.length, encoding: 'base64', data: bytesToBase64(f.bytes) },
  };
}

/** 服务端/网络错误码 → 业务语言（不含内部栈；未知码保守展示原码+通用文案）。 */
const ERROR_TEXT: Record<string, string> = {
  SESSION_REQUIRED: '登录已过期：请重新登录',
  SESSION_EXPIRED: '登录已过期：请重新登录',
  PRINCIPAL_UNTRUSTED: '身份未通过验证：请检查登录凭据',
  PERMISSION_DENIED: '当前身份无此操作权限（权限由后台目录裁决，页面不提供提权）',
  PROJECT_FORBIDDEN: '当前身份无此项目权限',
  NOT_FOUND: '对象不存在或当前身份无权查看',
  VERSION_CONFLICT: '数据已被他人更新：请刷新后重试',
  REQUEST_MISMATCH: '请求标识冲突：请刷新页面后重试',
  UPSTREAM_UNKNOWN: '后台结果未知：请勿重复提交，稍后用对账编号查询',
  UPSTREAM_DIRECTORY_NOT_AVAILABLE: '客户目录清单待后台提供：请用搜索或新建进入客户',
  IDENTITY_DIRECTORY_NOT_CONFIGURED: '受控身份目录未配置：请使用凭据登录',
  POLICY_PENDING: '政策未配置（必需域/权限矩阵/豁免政策等待业务批准录入）：不能假装通过',
  BASIS_PACKAGE_REQUIRED: '正式动作必须绑定依据包：请先冻结决策依据包',
  GATE_BLOCKED: 'Gate 未通过（存在缺口/待复核）：不能提交正式批准',
  GATE_HOLD_FOR_REVIEW: '存在待人工复核缺口：复核完成前不能正式批准',
  STALE_BASIS: '依据已过时（新材料已到或规则版本变化）：请刷新依据包后重试',
  GATE_STALE_RULES: '规则版本已更新：该域结论需按当前激活版本重新登记',
  REVIEW_REQUIRED: '存在未决差异：先完成差异复核',
  REVIEW_EVIDENCE_REQUIRED: '关闭该复核必须引用现行证据材料',
  COOLING_ACTIVE: '提额冷却期内：激活/恢复与向上提额暂不受理',
  LIMIT_INCREASE_IN_FLIGHT: '已有在途提额请求：不可重复发起',
  INSUFFICIENT_AVAILABLE_AMOUNT: '可用额度不足：无法预占该金额',
  FACILITY_NOT_ACTIVE: '额度设施非生效状态：不能新增用信',
  FILE_TOO_LARGE: '原件超过受限通道上限（512KB）',
  FILE_ENCODING_INVALID: '文件编码无效：请重新选择文件',
  FILE_REQUIRED: '请先选择文件',
  FILE_NAME_INVALID: '文件名需为 1..200 字符',
  FILE_EMPTY: '文件内容为空',
  AUDIENCE_MISMATCH: '该内容不允许发往所选受众',
  EXTERNAL_SEND_NOT_PERMITTED: '内部内容外发需要显式外发权限（当前身份未获准）',
  CSRF_ORIGIN_REJECTED: '请求来源校验未通过：请从工作台页面内操作',
  BODY_TOO_LARGE: '请求体超限',
  INVITATION_EXPIRED: '邀请已过期：请联系办理人重新邀请',
  INVITATION_REVOKED: '邀请已撤销：请联系办理人',
  INVITATION_ALREADY_USED: '该邀请已被使用（凭据只在首次兑换返回）：请用已保存的凭据登录',
  TOKEN_INVALID: '处理通道令牌无效：请核对办理人提供的通道令牌',
  TOKEN_EXPIRED: '处理通道令牌已过期：请联系办理人重新发起',
  INVALID_STATE: '当前状态不允许该操作：请按页面提示先完成前置步骤',
  ANALYSIS_RUN_NOT_COMPLETED: '该分析运行未完成（失败/超时不算完成）：不能作为域结论登记',
  ARTIFACT_SUPERSEDED: '材料已被取代或重复：依据包须引用现行件，先补正后再冻结',
  // ---- 方案R 统一上传链（任务02 冻结语义）：阻断/等待态与通道面错误 → 业务语言 ----
  CHANNEL_NOT_CONFIGURED: '处理通道未接入（部署未配置通道上游）：上传/处理链路暂不可用，如实等待补齐，不以档案登记冒充处理',
  ROLE_FORBIDDEN: '当前身份不可执行该处理动作（客户联系人无内部处理权限：邀请签发/转录/更正/复核/暂停）',
  CUSTOMER_MISMATCH: '材料归属与目标客户不一致：已拒绝，不登记到他人名下',
  CUSTOMER_REQUIRED: '缺少目标客户标识：逐资源授权失败关闭，请求未执行',
  A_CUSTOMER_NOT_IN_A: 'A 档案中未找到对应客户：材料停在通道等待关联登记，恢复后自动续跑（勿重复提交）',
  A_TENANT_MISMATCH: 'A 客户租户不匹配：材料停在通道等待处理，请核对建档租户（勿重复提交）',
  A_UNREACHABLE: 'A 暂不可达：材料停在通道，恢复后自动续跑登记（勿重复提交）',
  A_UPLOAD_PRINCIPAL_MISSING: 'A 登记凭据缺失：材料停在通道等待部署配置（勿重复提交）',
  // ---- TAKEOFF §13 预评估确认面 ----
  IDEMPOTENCY_REPLAY_CONFLICT: '同一编号曾提交过不同内容：服务端幂等保护拒绝重放。请刷新后用新编号提交（不要覆盖旧记录）',
  // NOT_READY 不映射：服务端按场景给出精确业务语言（先提交人工审阅 / 已确认终态），原样透传。
};

export function errorText(code: string | undefined | null, fallback?: string): string {
  if (!code) return fallback ?? '操作未成功：请稍后重试';
  return ERROR_TEXT[code] ?? `${fallback ?? '操作未成功'}（${code}）`;
}

export interface DecisionView {
  candidateText: string;
  approvedText: string;
  availableText: string;
  readinessText: string;
  readinessTone: 'good' | 'warn' | 'bad' | 'gray';
  blockers: string[];
  gateText: string;
  basisText: string;
}

/** 方案页核心语义：候选(candidate)≠批准(approved facility)≠可用(availableForNewDraw)——三行分开，不合并成"通过"。 */
export function decisionView(snap: {
  decisionStatus?: {
    basis?: { packageId?: string; revision?: number; basisVersion?: string; status?: string; decisionReadiness?: boolean; blockedActions?: string[]; gate?: { result?: string } | null } | null;
    facilityTotalsMinor?: { proposed?: number; approvedInactive?: number; active?: number; suspended?: number; available?: number } | null;
  } | null;
}, fmt: (minor: number | undefined | null) => string): DecisionView {
  const ds = snap?.decisionStatus ?? null;
  const ft = ds?.facilityTotalsMinor ?? null;
  const gate = ds?.basis?.gate ?? null;
  const gateResult = gate ? String(gate.result ?? 'unknown') : null;
  const gateText = gateResult === null
    ? 'Gate：未登记（尚无可信规则结论）'
    : gateResult === 'approved' ? 'Gate：通过（可信规则回执）'
      : gateResult === 'rejected' ? 'Gate：拒绝（终态，不显示通过）'
        : `Gate：${gateResult}（非通过状态）`;
  const blockers = Array.isArray(ds?.basis?.blockedActions) ? ds!.basis!.blockedActions!.map(String) : [];
  const readiness = ds?.basis?.decisionReadiness === true;
  return {
    candidateText: `候选方案：${fmt(ft?.proposed)}（候选≠批准，未经有权人决定不生效）`,
    approvedText: `已批准额度：${fmt(ft?.active)}（另有未激活 ${fmt(ft?.approvedInactive)}、暂停 ${fmt(ft?.suspended)}）`,
    availableText: `当前可用：${fmt(ft?.available)}（可用≠承诺，用信仍需逐笔申请与 gates）`,
    readinessText: readiness ? '决策就绪：依据包当前且必需域齐备' : '决策未就绪：存在缺口或依据过时（如实显示，不提供绕过）',
    readinessTone: readiness ? 'good' : blockers.length > 0 ? 'bad' : 'warn',
    blockers,
    gateText,
    basisText: ds?.basis?.packageId
      ? `依据包 ${ds.basis.packageId}（修订 r${ds.basis.revision ?? '?'} · 版本 ${ds.basis.basisVersion ?? '?'} · ${ds.basis.status ?? '未知状态'}）`
      : '依据包：未冻结（正式提案将被阻断 BASIS_PACKAGE_REQUIRED）',
  };
}

/** 稳定动作幂等键：同动作重复点击同一键 → 服务端幂等表吸收；跨动作不串。≤128 字符。 */
export function wbActionRequestId(prefix: string, customerId: string, action: string, nonce: string): string {
  return `${prefix}:${customerId}:${action}:${nonce}`.slice(0, 128);
}

export interface ConfirmPlan {
  title: string;
  lines: string[];
  confirmLabel: string;
  requestId: string;
}

/** 正式动作二次确认内容：动作、对象、金额/条件与幂等键全部先展示给有权人。 */
export function buildConfirmPlan(action: string, targetLabel: string, detailLines: string[], requestId: string): ConfirmPlan {
  const titles: Record<string, string> = {
    'facility.approve': '正式批准额度',
    'facility.activate': '激活额度设施',
    'facility.suspend': '暂停额度设施',
    'facility.reduce': '调减额度',
    'facility.propose': '提交额度提案（候选）',
    'fr.create': '创建用信申请',
    'fr.reserve': '预占额度',
    'fr.release': '释放预占',
    'fr.commit': '承诺用信',
    'fr.disburse': '出账（受控模拟）',
    'assessment.decide': '评估决定（拒绝/撤回）',
    'findings.resolve': '关闭差异复核',
    'package.freeze': '冻结决策依据包',
    'package.domain-result': '登记域意见（authority=none）',
    'grant.revoke': '撤销客户授权（级联停用其客户身份）',
    'channel.invite': '发起处理通道邀请',
    'channel.accept': '接受处理通道绑定',
    'channel.upload': '上传原件进处理通道',
    'channel.pause': '暂停/恢复处理通道',
    'evidence.manualEntry': '人工录入事实（转录≠核验）',
    'evidence.correctFact': '更正事实（修订链留痕）',
    'question.answer': '回答处理通道问题',
    'question.verify': '人工复核通道事实（verified 唯一来源）',
  };
  return {
    title: `确认：${titles[action] ?? action}`,
    // 幂等编号不再重复进 lines：ConfirmDialog 统一渲染"对账编号"块（含失败重试不换号说明）。
    lines: [...detailLines, `对象：${targetLabel}`, '提交后进入后台正式记录；结果未知时请用对账编号查询回执，不要换号重发。'],
    confirmLabel: '确认提交',
    requestId,
  };
}

/** 会话内沟通分列：对客户 / 内部 显式分开（无真实外部渠道：页面内办理，不显示"已送达企微"）。 */
export function audienceColumns(msgs: Array<{ audience: 'customer' | 'internal'; text: string; at: string; state: string }>): {
  customer: Array<{ text: string; at: string; state: string }>;
  internal: Array<{ text: string; at: string; state: string }>;
} {
  const cols = { customer: [] as Array<{ text: string; at: string; state: string }>, internal: [] as Array<{ text: string; at: string; state: string }> };
  for (const m of msgs) cols[m.audience].push({ text: m.text, at: m.at, state: m.state });
  return cols;
}

// ---------------------------------------------------------------------------
// 页内消息线程（goal-03e，DEF-G04N-05）：服务端线程为权威 + 本地在途发送合并。
// 纪律：远端行不隐藏、不排序造伪（按服务端 seq 升序）；本地 pending 只在"发送中/失败"态占位，
// 其 requestId 一旦出现在服务端线程即被远端行取代（幂等回执→线程行，不再双显示）。
// ---------------------------------------------------------------------------

export interface PendingSend {
  id: string;
  requestId: string;
  audience: 'customer' | 'internal';
  text: string;
  at: string;
  state: string;
}

export interface RemoteThreadMsg {
  messageId: string;
  seq?: number;
  requestId?: string;
  audience: 'customer' | 'internal';
  text: string;
  senderPrincipalId: string;
  at: string;
}

export interface ThreadRow {
  key: string;
  audience: 'customer' | 'internal';
  text: string;
  at: string;
  state: string;
  mine: boolean;
  senderLabel: string;
}

/** 远端线程行投影：mine=本人发送；senderLabel 以 principalId 据实标注（不猜测显示名）。 */
export function remoteThreadRows(remote: RemoteThreadMsg[], myPrincipalId: string): ThreadRow[] {
  return (remote ?? []).map((m) => {
    const mine = m.senderPrincipalId === myPrincipalId;
    return {
      key: `r:${m.messageId}`,
      audience: m.audience,
      text: m.text,
      at: m.at,
      state: mine ? '已送达（服务端回执）' : '在线',
      mine,
      senderLabel: mine ? '我' : m.senderPrincipalId,
    };
  });
}

/** 在途发送与远端线程合并：requestId 已被服务端留档的 pending 行退出（远端行取代）。
 * audience 参数过滤分列（biz 双列；门户只取 customer 列）。 */
export function mergeThread(
  pending: PendingSend[],
  remote: RemoteThreadMsg[],
  myPrincipalId: string,
): { customer: ThreadRow[]; internal: ThreadRow[] } {
  const acked = new Set((remote ?? []).map((m) => String(m.requestId ?? '')).filter(Boolean));
  const live = remoteThreadRows(remote, myPrincipalId);
  const pendingRows: ThreadRow[] = (pending ?? [])
    .filter((p) => !acked.has(p.requestId))
    .map((p) => ({
      key: `p:${p.id}`,
      audience: p.audience,
      text: p.text,
      at: p.at,
      state: p.state,
      mine: true,
      senderLabel: '我',
    }));
  const all = [...live, ...pendingRows];
  const cols: { customer: ThreadRow[]; internal: ThreadRow[] } = { customer: [], internal: [] };
  for (const r of all) cols[r.audience].push(r);
  return cols;
}


/** 材料行（A listArtifacts 投影）→ 工作本材料表行。 */
export interface ArtifactRow {
  artifactId: string;
  kind: string;
  factKey: string | null;
  grade: string | null;
  current: boolean;
  supersededBy: string | null;
  supersedes: string | null;
  objectRef: string | null;
  period: string | null;
  subject: string | null;
  createdAt: string | null;
  hasFile: boolean;
}

export function summarizeArtifacts(list: Array<Record<string, unknown>>): { rows: ArtifactRow[]; conflicts: Array<{ factKey: string; count: number }>; derivationGaps: number } {
  const rows: ArtifactRow[] = (list ?? []).map((a) => {
    const meta = (a.materialMeta ?? null) as { period?: string; subjectRef?: string } | null;
    const mm = a.materialFileMeta as { name?: string } | null;
    return {
      artifactId: String(a.artifactId ?? ''),
      kind: String(a.kind ?? ''),
      factKey: a.factKey == null ? null : String(a.factKey),
      grade: a.grade == null ? null : String(a.grade),
      current: a.current === true,
      supersededBy: a.supersededBy == null ? null : String(a.supersededBy),
      supersedes: a.supersedes == null ? null : String(a.supersedes),
      objectRef: a.objectRef && typeof a.objectRef === 'object' ? String((a.objectRef as { objectId?: string }).objectId ?? '') : null,
      period: meta?.period ?? null,
      subject: meta?.subjectRef ?? null,
      createdAt: a.createdAt == null ? null : String(a.createdAt),
      hasFile: Boolean(mm) || Boolean((a.content && typeof a.content === 'object' && (a.content as { materialFile?: unknown }).materialFile)),
    };
  });
  return { rows, conflicts: [], derivationGaps: 0 };
}

/** 会话角色授权：回答按钮仅当我的目录角色包含问题 target_role 时可点（服务端仍会再裁）。 */
export function canAnswerQuestion(myRoles: string[], targetRole: string | undefined): boolean {
  if (!targetRole) return false;
  return myRoles.includes(targetRole);
}

export function fmtWhen(at: string | null | undefined): string {
  if (!at) return '—';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? String(at) : d.toLocaleString('zh-CN', { hour12: false });
}

// ---------------------------------------------------------------------------
// goal-03d 处理通道（Connectors IR-02-C）投影：把 statusForCustomer/taskDetail 投成页面行。
// 只做展示投影：状态/分段/回执引用全部来自服务端字段，不推导业务结论。
// ---------------------------------------------------------------------------

export interface ChannelTaskRow {
  taskId: string;
  evidenceId: string;
  kind: string;
  status: string;
  statusText: string;
  tone: 'green' | 'blue' | 'red' | 'gray' | 'yellow';
  cursor: string;
  cursorText: string;
  attempts: number;
  failureCode: string | null;
  updatedAt: string | null;
  /** 方案R（任务02 冻结）：A 回写状态逐任务字段——aRegistered=bool、bridgeState=registered|unknown|failed|none。 */
  aRegistered: boolean | null;
  bridgeState: 'registered' | 'unknown' | 'failed' | 'none' | null;
  bridgeText: string;
  bridgeTone: 'green' | 'blue' | 'red' | 'gray' | 'yellow';
}

const CHANNEL_TASK_STATUS: Record<string, { text: string; tone: ChannelTaskRow['tone'] }> = {
  queued: { text: '排队中', tone: 'gray' },
  running: { text: '处理中', tone: 'blue' },
  done: { text: '已完成', tone: 'green' },
  needs_followup: { text: '待补件/转人工', tone: 'yellow' },
  blocked_unknown: { text: '对账中（上游结果未知，勿重复提交）', tone: 'yellow' },
  // 方案R 可恢复等待态（任务02 冻结）：等待态保留游标、退避自动重入，不消耗失败预算。
  blocked_link: { text: '被阻断（A 客户关联未建立：等映射登记后自动续跑，勿重复提交）', tone: 'yellow' },
  blocked_a_unavailable: { text: '被阻断（A 登记面不可用：恢复后自动续跑，勿重复提交）', tone: 'yellow' },
  failed: { text: '失败（原因见下）', tone: 'red' },
  skipped_duplicate: { text: '重复件已跳过', tone: 'gray' },
};

const CHANNEL_STAGE_TEXT: Record<string, string> = {
  register_material: 'A 材料登记',
  unzip: '解压',
  parse: '解析',
  facts: '事实提取',
  analyze: '四域分析',
  questions: '补证问题',
  register_results: 'A 结果登记（运行/Gate 回执）',
  done: '完成',
};

export function channelStageText(stage: string): string {
  return CHANNEL_STAGE_TEXT[stage] ?? stage;
}

/** A 回写状态 → 页面文字（任务02 冻结语义：done 且未回写 A 不得呈现为全链完成）。 */
export function channelBridgeView(
  status: string,
  aRegistered: boolean | null,
  bridgeState: ChannelTaskRow['bridgeState'],
): { text: string; tone: ChannelTaskRow['bridgeTone'] } {
  if (status === 'done' && (bridgeState === 'none' || aRegistered === false)) {
    return { text: '本地完成（未回写 A：不等于全链完成）', tone: 'yellow' };
  }
  switch (bridgeState) {
    case 'registered': return { text: '已回写 A 档案', tone: 'green' };
    case 'unknown': return { text: 'A 登记对账中（勿重复提交）', tone: 'yellow' };
    case 'failed': return { text: 'A 回写失败（原因见任务回执）', tone: 'red' };
    case 'none': return { text: '未回写 A', tone: 'gray' };
    default: return { text: 'A 回写状态未知', tone: 'gray' };
  }
}

export function channelTaskRows(tasks: Array<Record<string, unknown>>): ChannelTaskRow[] {
  return (tasks ?? []).map((t) => {
    const status = String(t.status ?? 'queued');
    const st = CHANNEL_TASK_STATUS[status] ?? { text: status, tone: 'gray' as const };
    const cursor = String(t.stage_cursor ?? '');
    const aRegistered = typeof t.aRegistered === 'boolean' ? t.aRegistered : null;
    const rawBridge = t.bridgeState == null ? null : String(t.bridgeState);
    const bridgeState = (rawBridge === 'registered' || rawBridge === 'unknown' || rawBridge === 'failed' || rawBridge === 'none')
      ? rawBridge as ChannelTaskRow['bridgeState']
      : null;
    const bridge = channelBridgeView(status, aRegistered, bridgeState);
    return {
      taskId: String(t.task_id ?? ''),
      evidenceId: String(t.evidence_id ?? ''),
      kind: String(t.kind ?? ''),
      status,
      statusText: st.text,
      tone: st.tone,
      cursor,
      cursorText: cursor ? channelStageText(cursor) : '—',
      attempts: Number(t.attempts ?? 0),
      failureCode: t.failure_code == null ? null : String(t.failure_code),
      updatedAt: t.updated_at == null ? null : String(t.updated_at),
      aRegistered,
      bridgeState,
      bridgeText: bridge.text,
      bridgeTone: bridge.tone,
    };
  });
}

export interface ChannelOpRow {
  entityType: string;
  entityTypeText: string;
  localId: string;
  aRef: string | null;
  requestId: string;
  status: string;
  statusText: string;
  detail: Record<string, unknown>;
}

const CHANNEL_OP_ENTITY: Record<string, string> = {
  artifact: 'A 工件登记',
  run: 'A 分析运行',
  gate: 'A Gate 回执',
  finding: 'A 差异复核项',
  domain_result: 'A 包域结果',
};

const CHANNEL_OP_STATUS: Record<string, string> = {
  registered: '已登记（有 a_ref）',
  unknown: '结果未知（对账中）',
  failed: '失败',
  pending: '进行中',
};

/** 任务 aOps → A 侧登记留痕行（同一原件可追溯到运行/Gate 回执——J1.3/J1.5 的页面依据）。 */
export function channelOpRows(aOps: Array<Record<string, unknown>>): ChannelOpRow[] {
  return (aOps ?? []).map((o) => {
    const entityType = String(o.entity_type ?? '');
    const status = String(o.status ?? '');
    let detail: Record<string, unknown> = {};
    try { detail = typeof o.detail === 'string' ? (JSON.parse(o.detail) as Record<string, unknown>) : ((o.detail ?? {}) as Record<string, unknown>); } catch { /* detail 缺失不阻塞列表 */ }
    return {
      entityType,
      entityTypeText: CHANNEL_OP_ENTITY[entityType] ?? entityType,
      localId: String(o.local_id ?? ''),
      aRef: o.a_ref == null ? null : String(o.a_ref),
      requestId: String(o.request_id ?? ''),
      status,
      statusText: CHANNEL_OP_STATUS[status] ?? status,
      detail,
    };
  });
}

/** 从通道 aOps 取最新的 Gate 回执引用（冻结依据包的 gateReceiptId 建议值）。 */
export function latestGateReceiptRef(aOps: Array<Record<string, unknown>>): string | null {
  const rows = channelOpRows(aOps).filter((r) => r.entityType === 'gate' && r.aRef && r.status === 'registered');
  return rows.length === 0 ? null : String(rows[rows.length - 1].aRef);
}

/** 从通道 aOps 取各域已完成的 A 分析运行引用（每域最新一个；域结果登记的 runId 建议值）。 */
export function completedRunRefs(aOps: Array<Record<string, unknown>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of channelOpRows(aOps)) {
    if (r.entityType !== 'run' || !r.aRef || r.status !== 'registered') continue;
    const m = r.localId.match(/^[^:]+:(policy|credit|commerce|asset)$/); // localId 形如 `${customerId}:${domain}`
    if (m) out[m[1]] = r.aRef;
  }
  return out;
}

/** 从通道 aOps 取各域全部已登记的 A 分析运行引用（按出现顺序；供域结果登记下拉选择，不手填）。 */
export function collectRunRefs(aOps: Array<Record<string, unknown>>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of channelOpRows(aOps)) {
    if (r.entityType !== 'run' || !r.aRef || r.status !== 'registered') continue;
    const m = r.localId.match(/^[^:]+:(policy|credit|commerce|asset)$/);
    if (!m) continue;
    const list = out[m[1]] ?? (out[m[1]] = []);
    if (!list.includes(r.aRef)) list.push(r.aRef);
  }
  return out;
}

/** 勾选材料 → 该域依赖的 factKeys（所选材料 factKey 去重；无则空）。 */
export function pickedFactKeys(rows: ArtifactRow[], pickedIds: string[]): string[] {
  const keys = new Set<string>();
  for (const r of rows) {
    if (pickedIds.includes(r.artifactId) && r.factKey) keys.add(r.factKey);
  }
  return [...keys];
}

/** 通道分段进度文本：cursor 阶段序 + 中文说明；blocked_unknown 如实显示"对账中"。 */
export function channelCursorSummary(cursor: string): string {
  if (!cursor || cursor === 'done') return cursor === 'done' ? '全部完成' : '—';
  return `当前段：${channelStageText(cursor)}`;
}

// ---------------------------------------------------------------------------
// 原件预览（goal-03e，IR-03-3 / CONTRACT §11.2 消费投影）：信封件 materialFile →
// 页面内联（image=data:URL，CSP img-src 'self' data: 允许；text=解码后 <pre>）或下载兜底。
// 只做展示投影：字节/元数据来自 A 单件读回，不转码、不伪造。
// ---------------------------------------------------------------------------

export type PreviewKind = 'image' | 'text' | 'download';

export function previewKind(mime: string | null | undefined, name: string | null | undefined): PreviewKind {
  const m = String(mime ?? '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('text/') || m === 'application/json' || m === 'application/csv' || /\.(txt|csv|json|md|log)$/i.test(String(name ?? ''))) return 'text';
  return 'download';
}

/** base64 信封 → data: URL（图片内联用；CSP img-src data: 放行，不经外部域）。 */
export function envelopeDataUrl(mime: string | null | undefined, dataBase64: string): string {
  return `data:${String(mime ?? 'application/octet-stream')};base64,${dataBase64}`;
}

/** 浏览器侧 base64 → 字节（文本解码/下载 Blob 用；仅 ≤512KB 受限信封）。 */
export function base64ToBytes(dataBase64: string): Uint8Array {
  const bin = atob(dataBase64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 对象字节魔数嗅探：上游 /objects 常回 octet-stream，按 PNG/JPEG/GIF 魔数识别图片 mime（供内联 data:URL）。 */
export function sniffImageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/gif' | null {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  return null;
}

