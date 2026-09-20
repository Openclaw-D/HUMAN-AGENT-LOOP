// goal-03c 客户工作本·HTTP 客户端：组合既有 Edge client（会话/SSE/动作/消息/回执），
// 增补受控登录（身份目录）、受限原件上传、白名单只读透传与目录前向探测。
// 纪律与 edge-client 相同：凭据只经会话交换一次；错误统一 EdgeHttpError。
import { createEdgeClient, EdgeHttpError, type EdgeClient, type EdgeSessionInfo } from '../v5-preview/edge/edge-client';
import type { AdmissionRequest, AssistantObservation, ModelAssistant } from './takeoff-actions';
import { validDecisionResponse, type DecisionResponse, type DecisionCommand, type FeedbackCommand } from './decision-feedback';

export interface IdentityMeta { principalId: string; roles: string[]; label: string; demo: boolean }

export interface DirectoryCustomer { customerId: string; displayName?: string | null; status?: string; createdBy?: string; createdAt?: string }

export type DirectoryResult =
  | { kind: 'ok'; customers: DirectoryCustomer[]; nextCursor?: string | null }
  | { kind: 'pending'; interfaceRequest: string }
  | { kind: 'unknown'; code: string };

export interface InvitationRow {
  invitationId: string; role: string; allowedKinds: string[]; subjectRef?: string | null; note?: string | null;
  expiresAt?: string; status: string; createdBy?: string; createdAt?: string; usedAt?: string | null;
  usedPrincipalId?: string | null;
}

export function createWbClient({ baseUrl, fetchImpl = fetch }: { baseUrl: string; fetchImpl?: typeof fetch }) {
  const inner: EdgeClient = createEdgeClient({ baseUrl, fetchImpl });
  const root = baseUrl.replace(/\/$/, '');

  // 登录身份的权威租户（Edge 会话透出 tenantId）；未携带时回退旧演示租户（兼容历史测试栈）。
  const currentTenant = (): string => (inner.session && (inner.session as { tenantId?: string | null }).tenantId) || 't1';
  const authedHeaders = (): Record<string, string> => {
    const s = inner.session;
    if (!s) throw new EdgeHttpError(0, 'NO_SESSION', '尚未登录');
    return { 'x-jw-session': s.sessionId };
  };

  const getJson = async (path: string): Promise<Record<string, unknown>> => {
    const r = await fetchImpl(`${root}${path}`, { headers: authedHeaders() });
    const j = await r.json().catch(() => ({ ok: false, error: 'INVALID_RESPONSE' }));
    if (!r.ok) {
      throw new EdgeHttpError(r.status, String(j.error ?? 'REQUEST_FAILED'), String(j.note ?? j.message ?? '请求失败'), typeof j.requestId === 'string' ? j.requestId : undefined);
    }
    return j;
  };

  async function decisionRequest(customerId: string, assistant: ModelAssistant, body?: DecisionCommand | FeedbackCommand): Promise<DecisionResponse> {
    const feedback = body && 'decisionSetId' in body;
    const url = body
      ? `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/assistant/decisions${feedback ? '/feedback' : ''}`
      : `/api/jw/v2/customers/${encodeURIComponent(customerId)}/assistant/decisions?assistant=${encodeURIComponent(assistant)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), body && !feedback ? 75_000 : 15_000);
    try {
      const r = await fetchImpl(root + url, { method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json', ...authedHeaders() },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
      const value = await r.json();
      if (!r.ok) throw new EdgeHttpError(r.status, String(value.error ?? 'REQUEST_FAILED'), '候选或反馈请求未完成');
      if (!validDecisionResponse(value, customerId, assistant)) throw new EdgeHttpError(0, 'INVALID_RESPONSE', '候选响应不完整或归属不匹配');
      return value;
    } finally { clearTimeout(timer); }
  }

  return {
    inner,
    readDecisions: (customerId: string, assistant: ModelAssistant) => decisionRequest(customerId, assistant),
    analyzeDecisions: (customerId: string, body: DecisionCommand) => decisionRequest(customerId, body.assistant, body),
    saveDecisionFeedback: (customerId: string, body: FeedbackCommand) => decisionRequest(customerId, body.assistant, body),
    get session(): EdgeSessionInfo | null { return inner.session; },
    endSession: () => inner.endSession(),

    /** 受控身份目录（无凭据明文）。未配置 → null（登录页退化为仅手输凭据）。 */
    async identities(): Promise<IdentityMeta[] | null> {
      const r = await fetchImpl(`${root}/api/jw/v2/auth/identities`);
      if (r.status === 404) return null;
      const j = await r.json().catch(() => ({ ok: false }));
      if (!r.ok || !j.ok) return null;
      return (j.identities as IdentityMeta[]) ?? [];
    },

    /** 受控登录：按 principalId 由 Edge 服务端查目录凭据换会话（本层采纳会话态供后续调用）。 */
    async exchangeByPrincipal(principalId: string): Promise<EdgeSessionInfo> {
      const r = await fetchImpl(`${root}/api/jw/v2/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ principalId }),
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'INVALID_RESPONSE' }));
      if (!r.ok || !j.ok) throw new EdgeHttpError(r.status, String(j.error ?? 'EXCHANGE_FAILED'), String(j.note ?? '登录失败'));
      const s = j.session as EdgeSessionInfo;
      inner.adoptSession(s);
      return s;
    },

    /** 手输凭据登录（真实身份；角色由服务端目录决定，无页面提权）。 */
    exchangeCredential: (credential: string) => inner.exchange(credential),

    /** 客户目录前向探测：上游有清单端点 → ok；未实现 → pending(IR-03-1)。 */
    /** 客户目录：A v2.4 G1 权威分页查询（内部身份；grant 身份仅见在册客户）。 */
    async directory(search: string, cursor?: string): Promise<DirectoryResult> {
      try {
        const q = new URLSearchParams();
        if (search) q.set('search', search);
        if (cursor) q.set('cursor', cursor);
        const qs = q.toString();
        const j = await getJson(`/api/jw/v2/customers${qs ? `?${qs}` : ''}`);
        const customers = (Array.isArray(j.customers) ? j.customers : []) as DirectoryCustomer[];
        return { kind: 'ok', customers, nextCursor: (j.nextCursor as string | null) ?? null };
      } catch (e) {
        const err = e as EdgeHttpError;
        if (err.status === 501 && err.code === 'UPSTREAM_DIRECTORY_NOT_AVAILABLE') return { kind: 'pending', interfaceRequest: 'IR-03-1' };
        if (err.status === 403) return { kind: 'pending', interfaceRequest: 'A-G1(内部身份专用)' };
        if (err.status === 502) return { kind: 'unknown', code: err.code };
        throw e;
      }
    },

    /** 创建受限邀请（业务/管理员；code 明文仅此一次出现于响应）。 */
    createInvitation: (customerId: string, body: { requestId: string; role: string; allowedKinds: string[]; expiresInHours?: number; note?: string; subjectRef?: string }) =>
      inner.action<{ ok: boolean; invitation?: { invitationId: string; code: string; expiresAt?: string; role: string; allowedKinds: string[] } }>(
        `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/invitations`, { tenantId: currentTenant(), ...body },
      ),

    /** 撤销邀请（即刻生效）。 */
    revokeInvitation: (invitationId: string, requestId: string) =>
      inner.action<{ ok: boolean }>(`/api/jw/v2/actions/invitations/${encodeURIComponent(invitationId)}/revoke`, { requestId, tenantId: currentTenant() }),

    /** 邀请清单（只读透传，不含 code）。 */
    listInvitations: (customerId: string) => getJson(`/api/jw/v2/customers/${encodeURIComponent(customerId)}/invitations`),

    /** 邀请码兑换（匿名；凭据明文仅此一次返回给兑换者）。 */
    async redeemInvitation(code: string): Promise<{ ok: boolean; credential?: string; principalId?: string; customerId?: string; customerName?: string | null; role?: string; allowedKinds?: string[]; replayed?: boolean; note?: string }> {
      const r = await fetchImpl(`${root}/api/jw/v2/invitations/redeem`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }),
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'INVALID_RESPONSE' }));
      if (!r.ok) throw new EdgeHttpError(r.status, String(j.error ?? 'REDEEM_FAILED'), String(j.message ?? j.note ?? '兑换失败'));
      return j;
    },

    /** 客户联系人获准披露材料（仅客户身份；内部 403 由 A 保证）。 */
    myMaterials: () => getJson('/api/jw/v2/my/materials'),

    /** 单件材料处理状态（内部读）。 */
    artifactProcessing: (customerId: string, artifactId: string) =>
      getJson(`/api/jw/v2/customers/${encodeURIComponent(customerId)}/artifacts/${encodeURIComponent(artifactId)}/processing`),

    /** 工件单件读回（IR-03-3 / CONTRACT §11.2）：信封件 materialFile base64 投影；非信封件为 null+content 原样。 */
    artifactContent: (customerId: string, artifactId: string) =>
      getJson(`/api/jw/v2/customers/${encodeURIComponent(customerId)}/artifacts/${encodeURIComponent(artifactId)}/content`),

    /** 打开客户工作台快照（404=无权/不存在，原样上抛由 UI 呈现）。 */
    workspace: (customerId: string) => inner.workspace(customerId),

    /** 新建客户（既有 v2 建档；tenant 为部署演示租户常量，界面显示、不需用户手填）。 */
    async createCustomer(body: { tenantId: string; legalEntityRef: string; displayName: string; requestId: string }): Promise<{ customerId?: string }> {
      return inner.action<{ ok: boolean; customerId?: string }>('/api/jw/v2/actions/customers', body);
    },

    /** 受限原件上传（IR-03-3 临时信封 v0；文件字节真实落 A 工件 content）。 */
    async uploadOriginal(customerId: string, body: {
      requestId: string; kind: string; factKey?: string; materialMeta?: Record<string, unknown>;
      file: { name: string; mime: string; dataBase64: string };
    }): Promise<{ artifactId?: string; replayed?: boolean }> {
      return inner.action<{ ok: boolean; artifactId?: string; replayed?: boolean }>(
        `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/originals`, { tenantId: currentTenant(), ...body },
      );
    },

    updateAdmissionRequest: (assessmentId: string, body: { requestId: string; assessmentVersion: number; request: AdmissionRequest }) =>
      inner.action<{ ok: boolean; assessmentId: string; assessmentVersion: number; revision: number }>(
        `/api/jw/v2/actions/assessments/${encodeURIComponent(assessmentId)}/admission-request`, { tenantId: currentTenant(), ...body }),

    // 同源会话；单次非流式等待，无自动重试。浏览器断开不表示服务端取消。
    async observeAssistant(customerId: string, assistant: ModelAssistant, question: string): Promise<AssistantObservation> {
      const headers = { 'content-type': 'application/json', ...authedHeaders() };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 75_000);
      try {
        const r = await fetchImpl(`${root}/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/assistant/observe`, {
          method: 'POST', headers, body: JSON.stringify({ assistant, question }), signal: controller.signal,
        });
        const j = await r.json();
        if (!r.ok) throw new EdgeHttpError(r.status, String(j.error ?? 'REQUEST_FAILED'), String(j.note ?? j.message ?? '观察请求未完成'));
        if (!j.ok || j.authority !== 'none' || j.scope !== 'preassessment_only' || j.customerId !== customerId || j.assistant !== assistant ||
          !['succeeded', 'simulated', 'failed', 'unknown'].includes(j.model?.status) || ![true, false, null].includes(j.model?.sent) ||
          !Array.isArray(j.observations) || !Array.isArray(j.questions) || !Array.isArray(j.evidenceRefs) ||
          [...j.observations, ...j.questions].some((item) => !item || typeof item.text !== 'string')) {
          throw new EdgeHttpError(0, 'INVALID_RESPONSE', '模型回执不完整或归属不匹配，结果未知。');
        }
        return j as AssistantObservation;
      } finally { clearTimeout(timer); }
    },

    /** TAKEOFF §13（A CONTRACT v2.6）：独立预评估确认——scope=preassessment_only，不产生任何授信效力。
     * 服务端重查：人类身份+目录 credit 角色、assessmentVersion 乐观锁、候选修订当前性、结果相关硬门。 */
    confirmPreassessment: (assessmentId: string, body: {
      requestId: string;
      outcome: 'support' | 'support_with_conditions' | 'not_support';
      assessmentVersion: number;
      candidateRevision?: number;
      inputVersion?: number;
      ruleVersion?: string;
      conditions?: string[];
      rationale: string;
    }) => inner.action<{ ok: boolean; confirmationId: string; scope: string; outcome: string; status: string; assessmentVersion: number; confirmedBy?: string; confirmedAt?: string }>(
      `/api/jw/v2/actions/assessments/${encodeURIComponent(assessmentId)}/confirm-preassessment`, { tenantId: currentTenant(), ...body },
    ),

    /** 白名单只读透传（材料清单/报告/检查会话/评估/设施/依据包/发现）。 */
    read: (path: string) => getJson(path),

    /** 工件登记（登记取代件/派生件等结构化补录；不含文件字节时用）。 */
    registerArtifact: (customerId: string, body: Record<string, unknown>) =>
      inner.action(`/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/artifacts`, body),

    // ---- goal-03d 决策链面（A 权威只读 + 冻结/域结果写面） ----

    /** 客户决策状态权威投影（含当前依据包 basis/gaps/blockedActions）。 */
    decisionStatus: (customerId: string) => getJson(`/api/jw/v2/customers/${encodeURIComponent(customerId)}/decision-status`),

    /** 依据包详情（四域意见 domainResults/域当前性 currency/缺口 gaps）。 */
    packageDetail: (packageId: string) => getJson(`/api/jw/v2/decision-packages/${encodeURIComponent(packageId)}`),

    /** 有效域豁免清单（冻结时可引用 {exemptionId}；批准人/范围以服务端登记为准）。 */
    listDomainExemptions: (customerId: string) => getJson(`/api/jw/v2/customers/${encodeURIComponent(customerId)}/domain-exemptions`),

    /** 登记域豁免（human；服务端记批准人与有效期）。 */
    registerDomainExemption: (customerId: string, body: { requestId: string; domain: string; reason: string; scopeDays?: number; note?: string }) =>
      inner.action(`/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/domain-exemptions`, { tenantId: currentTenant(), ...body }),

    /** 冻结决策依据包（credit/business；gate 只收服务端回执引用）。 */
    freezePackage: (customerId: string, body: {
      requestId: string; gateReceiptId?: string; domainDeps: Array<{ domain: string; artifactIds: string[]; factKeys?: string[]; rulePackVersion?: string | null }>;
      inspectionRevision?: { sessionId: string; summaryRef?: string }; exemptions?: Array<{ exemptionId: string; note?: string }>; assessmentId?: string;
    }) => inner.action<{ ok: boolean; packageId?: string; revision?: number; basisVersion?: string; decisionReadiness?: boolean; gaps?: unknown[] }>(
      `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/decision-packages`, { tenantId: currentTenant(), ...body },
    ),

    /** 登记包域结果（域目录角色；analysisRun 只收真实运行引用；authority 恒 none 由 A 强制）。 */
    recordDomainResult: (packageId: string, body: {
      requestId: string; domain: string; analysisRun: { runId: string; rulesetVersion?: string };
      opinion: Record<string, unknown>; deps: { artifactIds: string[]; factKeys?: string[]; rulePackVersion?: string | null };
      adoption?: { adopted: boolean; rationale: string };
    }) => inner.action(`/api/jw/v2/actions/decision-packages/${encodeURIComponent(packageId)}/domain-results`, { tenantId: currentTenant(), ...body }),

    /** 页面化撤权（IR-03-7）：admin 撤客户 grants，级联停用其客户身份（即刻生效）。 */
    async revokeGrant(customerId: string, principalId: string, requestId: string): Promise<Record<string, unknown>> {
      const s = inner.session;
      if (!s) throw new EdgeHttpError(0, 'NO_SESSION', '尚未登录');
      const r = await fetchImpl(`/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/grants/${encodeURIComponent(principalId)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', 'x-jw-session': s.sessionId },
        body: JSON.stringify({ requestId, tenantId: currentTenant() }),
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'INVALID_RESPONSE' }));
      if (!r.ok) throw new EdgeHttpError(r.status, String(j.error ?? 'REVOKE_FAILED'), String(j.note ?? j.message ?? '撤权未成功'));
      return j;
    },

    // ---- goal-03d 处理通道面（Connectors IR-02-C；服务令牌在 Edge 服务端） ----

    /** 分段进度 + 通道补证问题 + 暂停态（?tid&cid）。 */
    channelStatus: (customerId: string) => getJson(`/api/jw/v2/connectors/processing/status?tid=${encodeURIComponent(currentTenant())}&cid=${encodeURIComponent(customerId)}`),

    /** 逐任务回执：阶段留痕 stages + A 侧登记留痕 aOps（运行/Gate 回执引用）。 */
    channelTask: (taskId: string) => getJson(`/api/jw/v2/connectors/processing/tasks/${encodeURIComponent(taskId)}?tid=${encodeURIComponent(currentTenant())}`),

    /** 原件预览（魔数嗅探 + 短时签名 downloadUrl；Edge 不经手字节）。 */
    channelPreview: (evidenceId: string, customerId: string) => getJson(`/api/jw/v2/connectors/evidence/preview?tid=${encodeURIComponent(currentTenant())}&eid=${encodeURIComponent(evidenceId)}&cid=${encodeURIComponent(customerId)}`),

    /** 通道对象字节（签名 URL 归一后的 Edge 代理路径；会话必需，签名/有效期由 Connectors 验证）。 */
    async fetchChannelObject(path: string): Promise<{ status: number; contentType: string; bytes: Uint8Array }> {
      const s = inner.session;
      if (!s) throw new EdgeHttpError(0, 'NO_SESSION', '尚未登录');
      const r = await fetchImpl(`${root}${path}`, { headers: { 'x-jw-session': s.sessionId } });
      const bytes = new Uint8Array(await r.arrayBuffer());
      return { status: r.status, contentType: r.headers.get('content-type') ?? 'application/octet-stream', bytes };
    },

    /** 通道动作（邀请/绑定/上传/录入/更正/问答/暂停）——同一 requestId 纪律。 */
    channelAction: <T = Record<string, unknown>>(path: string, body: Record<string, unknown>) =>
      inner.action<T>(`/api/jw/v2/actions/connectors/${path}`, body),

    /** 通道回执按对账编号查询（IR-T01-3 消费面）。页面面路由由 Edge 白名单登记；
     *  未登记/未配置时 404/503 原样上抛，调用方如实显示"对账口未接线"，不冒充查无回执。 */
    channelReceipt: (requestId: string) =>
      getJson(`/api/jw/v2/connectors/processing/receipts/${encodeURIComponent(requestId)}?tid=${encodeURIComponent(currentTenant())}`),

    action: <T = Record<string, unknown>>(path: string, body: Record<string, unknown>) => inner.action<T>(path, body),
    sendMessage: (customerId: string, body: Parameters<EdgeClient['sendMessage']>[1]) => inner.sendMessage(customerId, body),
    /** 页内消息线程读（DEF-G04N-05 修复面）：?audience 过滤 + ?after 游标增量；受众边界由服务端裁决。 */
    listMessages: (customerId: string, opts?: { audience?: 'customer' | 'internal'; after?: string; limit?: number }) => {
      const q = new URLSearchParams();
      if (opts?.audience) q.set('audience', opts.audience);
      if (opts?.after) q.set('after', opts.after);
      if (opts?.limit) q.set('limit', String(opts.limit));
      const qs = q.toString();
      return getJson(`/api/jw/v2/customers/${encodeURIComponent(customerId)}/messages${qs ? `?${qs}` : ''}`);
    },
    receipt: (requestId: string) => inner.receipt(requestId),
    eventsPage: (customerId: string, afterSeq?: string, limit?: number) => inner.eventsPage(customerId, afterSeq, limit),
    versionz: () => inner.versionz(),
    readyz: () => inner.readyz(),
    openEvents: (...a: Parameters<EdgeClient['openEvents']>) => inner.openEvents(a[0], a[1], a[2]),
  };
}

export type WbClient = ReturnType<typeof createWbClient>;
