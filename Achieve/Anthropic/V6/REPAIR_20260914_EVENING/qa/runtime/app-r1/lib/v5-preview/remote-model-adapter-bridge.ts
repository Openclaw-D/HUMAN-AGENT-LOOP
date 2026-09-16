// R2_MODEL 冻结候选 ↔ 产品 createModelProviderAdapter 桥接层（R3-A-INT 接入）。
//
// 定位：把 `lib/v5-preview/model-adapter/`（R2_MODEL_20260913 原样拷贝的候选 .mjs，零第三方依赖）
// 包装成与 `remote-service.ts#createModelProviderAdapter` 同形状的接口
// （providerKind / state() / generateFollowUps(req, stateProbe) → ModelProviderResult）。
// 本模块是**可选接入**：产品既有 `createModelProviderAdapter`（fixed_stub）行为不变；
// 需要走候选通道时由调用方显式使用 `createBridgedModelAdapter()`。
//
// 真实接入声明：本层真实 import 并执行候选 adapter（默认走候选 simulated 通道，
// status=simulated 显著声明），不是转发 stub。状态映射逐条对齐 R2_MODEL INTEGRATION.md §3/§4
// 状态表与候选 `integration/product-mapping.mjs#statusToProductAction`。
//
// 两处主任务裁决（INTEGRATION.md §3 缺口 1/2，在本层执行）：
// 1. generation 偏移：产品 session.generation 初始为 0（协议要求正整数）→
//    候选代次 = 产品 generation + 1；请求与快照使用同一转换。
// 2. contextVersion：产品无该字段 → 取**同一次权威 store 读取**内的
//    `RemoteStoreState.version`（API 词汇 remoteVersion），防证据清单与快照撕裂。
//
// 状态映射（候选七状态 → 产品四状态；候选原状态保留在结果 `candidate.status` 元数据）：
//   succeeded               → ok       providerKind='real'（reply 标注模型输出、authority=none）
//   simulated               → ok       providerKind='simulation'（首条 reply 携带 SIMULATION 中文声明，不得隐藏）
//   failed / not_configured → failed   failureReason=候选中文 message（未配置显式"未配置模型服务"）
//   unknown                 → failed   强制"须人工核实、禁止自动重试"（productAction.mustHumanVerify=true）
//   stale / cancelled       → rejected 结构化拒绝（stale 保留 findings 供人工比对；与产品
//                                        stateRejection 的"状态变化 → rejected"语义同侧）
//   scope='preprocessing_only' / dissent 非空：不改状态，保留在元数据（scope/scopeNotice/dissent），
//   业务层据此把结果挡在正式判定通道外、把异议并列展示（产品待定列表只列双方、不裁决）。
//
// 多角色：候选契约每次 analyze 恰好单一角色；产品 req.domainRoles 有多角色 →
// 按角色逐次调用候选（requestId 派生含角色），成功结果经候选 `aggregateResults` 聚合
// （dissent 全量保留、pendingDecisions 只列双方不裁决）；部分角色失败 → 产品 partial。
//
// 边界：模型 authority=none；本层不产生任何批准/决定；不自动重试任何候选状态；
// 真实 provider 凭据与预算未配置（当前仅模拟通道），失败绝不回退生成 model_simulation 冒充成功。
import { createHash } from 'node:crypto';
import { readRemoteStoreState } from './remote-store.ts';
import type { EvidenceRecord } from './remote-types.ts';
import type { FollowUpStateProbe, ModelProviderRequest, ModelProviderResult } from './remote-service.ts';
// 候选模块（零第三方依赖纯 .mjs；allowJs 下按推断类型引用，调用点以窄接口收口）。
import { createModelAdapter } from './model-adapter/adapter.mjs';
import { createSimulatedTransport } from './model-adapter/simulated.mjs';
import { DEFAULT_ROLES } from './model-adapter/validate-request.mjs';
import { aggregateResults } from './model-adapter/aggregate.mjs';
import {
  evidenceToRefs,
  sessionToSnapshot,
  statusToProductAction,
} from './model-adapter/integration/product-mapping.mjs';

// ---------------------------------------------------------------------------
// 候选模块的类型收口（推断类型 → 本层窄接口；仅描述桥接实际用到的形状）
// ---------------------------------------------------------------------------

interface CandidateAnalyzeRequest {
  requestId: string;
  projectId: string;
  sessionId: string;
  generation: number;
  contextVersion: number;
  role: string;
  purpose: string;
  text: string;
  evidenceRefs: { id: string; version: string; hash: string }[];
}

interface CandidateAnalyzeContext {
  signal?: AbortSignal;
  snapshot?: () => { generation: number; contextVersion: number; paused: boolean };
}

interface CandidateResult {
  contractVersion?: string;
  requestId?: string | null;
  status: string;
  mode?: string;
  deduped?: boolean;
  error: { code?: string; message?: string; details?: unknown } | null;
  findings: { id?: string; text?: string; evidenceRefs?: unknown }[];
  questions: { id?: string; text?: string; evidenceRefs?: unknown }[];
  dissent?: unknown[];
  simulation?: { notice?: string } | null;
  scope?: string | null;
  scopeNotice?: string | null;
  generation?: number | null;
  contextVersion?: number | string | null;
  /** 真实调用的用量上报（候选 normalizeUsage 输出；模拟通道为 null——CONTRACT §3 usage 纪律）。 */
  usage?: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null } | null;
  usageUnknown?: boolean;
}

interface CandidateRoles {
  [role: string]: { label: string; allowedPurposes: readonly string[] };
}

type CandidateTransport = (call: { payload: CandidateAnalyzeRequest; role: string }) => Promise<unknown>;

interface CandidateAdapter {
  contractVersion?: string;
  analyze: (request: CandidateAnalyzeRequest, context?: CandidateAnalyzeContext) => Promise<CandidateResult>;
}

/** 产品代次 → 候选协议代次的偏移量（INTEGRATION §3 缺口1 主任务裁决：接入层 +1）。 */
const GENERATION_OFFSET = 1;
const SIMULATION_FALLBACK_NOTICE = '本结果由受控模拟生成（SIMULATED），不来自真实模型，不构成任何审批意见或业务决定。';

// 桥接默认角色表：产品六域 + 'follow_up_generation' 用途登记（产品 follow-ups 用途不在候选默认
// 表内，显式登记授权而非放行 '*'；未登记用途仍被候选 PURPOSE_NOT_ALLOWED 失败关闭）。
function defaultBridgeRoles(): CandidateRoles {
  const roles: CandidateRoles = {};
  for (const [id, conf] of Object.entries(DEFAULT_ROLES as unknown as CandidateRoles)) {
    const purposes = new Set<string>(conf.allowedPurposes);
    purposes.add('follow_up_generation');
    roles[id] = { label: conf.label, allowedPurposes: [...purposes] };
  }
  if (!roles.coordinator) {
    roles.coordinator = { label: '协调（桥接登记）', allowedPurposes: ['follow_up_generation', 'risk_review', 'company_profile'] };
  }
  return roles;
}

export interface BridgedModelProviderResult extends ModelProviderResult {
  providerKind: 'fixed_stub' | 'simulation' | 'real';
  /** 模拟通道中文声明（候选 result.simulation.notice 原文；INTEGRATION §3：不得隐藏）。 */
  notice?: string;
  /** 候选 statusToProductAction 输出：UI 动作 / 是否允许人工确认后重试 / 是否必须人工核验。 */
  productAction?: { uiAction: string; zh: string; allowRetry: boolean; mustHumanVerify: boolean };
  /** 候选侧原状态与关键元数据（审计与人工比对用；不参与产品四状态判定）。 */
  candidate?: {
    status: string;
    contractVersion?: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    deduped?: boolean;
    scope?: string | null;
    scopeNotice?: string | null;
    generation: number;
    contextVersion: number;
    requestIds: string[];
    perRole: { role: string; status: string; errorCode: string | null }[];
    dissent: unknown[];
    pendingDecisions: unknown[];
    /** 真实调用的用量（候选 normalizeUsage 输出；模拟为 null；缺失=usageUnknown）。 */
    usage?: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null } | null;
    usageUnknown?: boolean;
    /** stale 时保留的候选 findings（§4：供人工比对，不得当现行结论）。 */
    preservedFindings?: unknown[];
    downgrade?: string;
  };
}

export interface BridgedModelAdapter {
  providerKind: 'fixed_stub' | 'simulation' | 'real';
  state: () => 'not_configured' | 'ready';
  generateFollowUps: (req: ModelProviderRequest, stateProbe?: FollowUpStateProbe) => Promise<BridgedModelProviderResult>;
  /** 底层候选 adapter（注册表/账本审计入口；勿绕过桥接语义直接消费）。 */
  candidate: CandidateAdapter;
}

export function createBridgedModelAdapter(options: {
  /** 自定义候选 transport（默认：候选 createSimulatedTransport 模拟通道）。 */
  transport?: CandidateTransport;
  /** 模拟通道脚本（仅默认 transport 时生效；透传候选 createSimulatedTransport）。 */
  script?: (call: { payload: CandidateAnalyzeRequest; role: string }) => unknown;
  /** 候选角色表（默认：六域 + follow_up_generation 用途登记）。 */
  roles?: CandidateRoles;
  /** 候选成本账本（缺省：候选内存账本）。 */
  ledger?: unknown;
  /** 候选超时毫秒（缺省 20000，对齐 INTEGRATION 示例口径）。 */
  timeoutMs?: number;
  /** 候选请求登记容量（缺省 512；满载显式背压 failed/REGISTRY_AT_CAPACITY）。 */
  maxEntries?: number;
  /** 候选时钟注入（测试用手动时钟获得确定性超时）。 */
  clock?: unknown;
} = {}): BridgedModelAdapter {
  const timeoutMs = options.timeoutMs ?? 20000;
  const roles = options.roles ?? defaultBridgeRoles();
  const channelKind: 'simulation' | 'real' = options.transport ? 'real' : 'simulation';
  const transport = options.transport
    ?? (createSimulatedTransport as unknown as (o: { script?: (call: { payload: CandidateAnalyzeRequest; role: string }) => unknown }) => CandidateTransport)(
      { script: options.script });

  const createAdapter = createModelAdapter as unknown as (deps: {
    transport: CandidateTransport;
    roles: CandidateRoles;
    ledger?: unknown;
    timeoutMs: number;
    maxEntries?: number;
    clock?: unknown;
  }) => CandidateAdapter;
  const candidate = createAdapter({
    transport,
    roles,
    ledger: options.ledger,
    timeoutMs,
    maxEntries: options.maxEntries,
    clock: options.clock,
  });

  const sha256Of = (canonical: string): string => createHash('sha256').update(canonical).digest('hex');

  /** 候选侧确定性 requestId：产品身份 + 角色 + 候选代次 + contextVersion 全入散列——
   *  同一上下文重放 → 命中候选缓存/去重复核；上下文（store 版本）推进 → 新调用身份，
   *  不落入候选 REQUEST_MISMATCH 陷阱（版本推进后的合法重试是完整新调用，F4 教训）。 */
  function candidateRequestIdOf(req: ModelProviderRequest, role: string, generation: number, contextVersion: number): string {
    return `brid-${sha256Of(JSON.stringify({
      v: 1, requestId: req.requestId ?? null, sessionId: req.sessionId, annotationId: req.annotationId,
      role, generation, contextVersion, purpose: req.purpose,
    })).slice(0, 32)}`;
  }

  /** 与产品 createModelProviderAdapter#stateRejection 同语义同文案的状态门
   *  （证据版本过期优先于暂停，与结果返回时再判定顺序一致）。 */
  function stateRejection(req: ModelProviderRequest, status?: string, currentVersion?: number): BridgedModelProviderResult | undefined {
    if (currentVersion !== undefined && req.evidenceRef.version !== currentVersion) {
      return {
        providerKind: channelKind, status: 'rejected', requestId: req.requestId, replies: [],
        failureReason: `evidence version expired（客户端 v${req.evidenceRef.version}，当前 v${currentVersion}）`,
        candidate: { status: 'state_gate', generation: 0, contextVersion: 0, requestIds: [], perRole: [], dissent: [], pendingDecisions: [], downgrade: 'pre-call state gate（桥接层状态门，未调用候选）' },
      };
    }
    if (status === 'paused') {
      return {
        providerKind: channelKind, status: 'rejected', requestId: req.requestId, replies: [],
        failureReason: 'session paused（暂停中禁止模型推进）',
        candidate: { status: 'state_gate', generation: 0, contextVersion: 0, requestIds: [], perRole: [], dissent: [], pendingDecisions: [], downgrade: 'pre-call state gate（桥接层状态门，未调用候选）' },
      };
    }
    return undefined;
  }

  return {
    providerKind: channelKind,
    state: () => 'ready',
    candidate,
    async generateFollowUps(req: ModelProviderRequest, stateProbe?: FollowUpStateProbe): Promise<BridgedModelProviderResult> {
      // ---- 0) 产品状态门预判（probe 注入优先，退回请求快照字段；与产品语义一致，未调用候选）。
      const initialProbe = stateProbe !== undefined ? stateProbe() : null;
      const preGate = stateRejection(req, initialProbe?.sessionStatus ?? req.sessionStatus, initialProbe?.currentEvidenceVersion ?? req.currentVersion);
      if (preGate !== undefined) return preGate;

      // ---- 1) 权威 store 读取（单次读取内取证据 + contextVersion，防撕裂）。
      let state: ReturnType<typeof readRemoteStoreState>;
      try {
        state = readRemoteStoreState();
      } catch (error) {
        return { providerKind: channelKind, status: 'failed', requestId: req.requestId, replies: [], failureReason: `store 读取失败关闭（${error instanceof Error ? error.message : 'unknown'}）` };
      }
      const contextVersion = state.version;
      const session = state.sessions.find((s) => s.sessionId === req.sessionId);
      if (session === undefined) {
        return { providerKind: channelKind, status: 'rejected', requestId: req.requestId, replies: [], failureReason: 'session not found（会话不存在，跨会话不可访问）' };
      }
      if (!Array.isArray(req.domainRoles) || req.domainRoles.length === 0) {
        return { providerKind: channelKind, status: 'failed', requestId: req.requestId, replies: [], failureReason: 'domainRoles 为空：候选契约每次 analyze 恰好单一角色，无角色可派生调用' };
      }

      // ---- 2) 证据解析（失败关闭）：标注优先回链 evidenceId；否则按 (sessionId,fixtureId,sha256,version) 解析。
      //      fixtureId 是可重复的种类标识，绝不当作唯一 id（FIELD_MAPPING §1）。
      const annotation = state.annotations.find((a) => a.annotationId === req.annotationId && a.sessionId === req.sessionId);
      let evidence: EvidenceRecord;
      if (annotation !== undefined) {
        const linked = state.evidence.find((e) => e.evidenceId === annotation.evidenceId);
        if (linked === undefined) {
          return { providerKind: channelKind, status: 'rejected', requestId: req.requestId, replies: [], failureReason: `annotation evidence missing（标注 ${req.annotationId} 指向的证据不存在）` };
        }
        if (linked.sha256 !== req.evidenceRef.sha256) {
          return { providerKind: channelKind, status: 'rejected', requestId: req.requestId, replies: [], failureReason: 'evidence reference mismatch（客户端 sha256 与标注证据原件不一致）' };
        }
        evidence = linked;
      } else {
        const matches = state.evidence.filter((e) => e.sessionId === req.sessionId
          && e.fixtureId === req.evidenceRef.fixtureId
          && e.sha256 === req.evidenceRef.sha256
          && String(e.version) === String(req.evidenceRef.version));
        if (matches.length === 0) {
          return { providerKind: channelKind, status: 'rejected', requestId: req.requestId, replies: [], failureReason: `unknown evidence reference（fixtureId=${req.evidenceRef.fixtureId || 'empty'}）` };
        }
        evidence = matches[matches.length - 1]; // 同 fixture 多次采集取最新一条（store 内追加序）
      }
      if (evidence.supersededBy !== null) {
        return { providerKind: channelKind, status: 'rejected', requestId: req.requestId, replies: [], failureReason: `evidence version expired（证据已被 ${evidence.supersededBy} 取代，不构成当前引用）` };
      }
      const mappedRefs = (evidenceToRefs as unknown as (items: unknown[], opts?: { source?: string }) => { ok: boolean; evidenceRefs?: { id: string; version: string; hash: string }[]; message?: string })([evidence], { source: 'remote-model-adapter-bridge' });
      if (!mappedRefs.ok || mappedRefs.evidenceRefs === undefined) {
        return { providerKind: channelKind, status: 'failed', requestId: req.requestId, replies: [], failureReason: mappedRefs.message ?? '证据映射失败关闭（MAPPING_MISSING_FIELDS）' };
      }

      // ---- 3) 会话快照映射（候选 sessionToSnapshot；generation 在入参侧执行 +1 裁决偏移）。
      const mappedSnapshot = (sessionToSnapshot as unknown as (
        s: Record<string, unknown>, o: { source?: string; contextVersion?: number }
      ) => { ok: boolean; snapshot?: { generation: number; contextVersion: number; paused: boolean }; message?: string })(
        { ...session, generation: session.generation + GENERATION_OFFSET } as Record<string, unknown>,
        { source: 'remote-model-adapter-bridge', contextVersion },
      );
      if (!mappedSnapshot.ok || mappedSnapshot.snapshot === undefined) {
        return { providerKind: channelKind, status: 'failed', requestId: req.requestId, replies: [], failureReason: mappedSnapshot.message ?? '会话快照映射失败关闭（MAPPING_MISSING_FIELDS）' };
      }
      const candidateGeneration = mappedSnapshot.snapshot.generation;
      // 候选每次 snapshot() 重新读权威 store（发起前/返回时/缓存复核共用）——
      // 会话推进、暂停、上下文变化都会被候选 staleness 判定捕获（stale/暂停拒绝）。
      const snapshotForCandidate = (): { generation: number; contextVersion: number; paused: boolean } => {
        const fresh = readRemoteStoreState();
        const freshSession = fresh.sessions.find((s) => s.sessionId === req.sessionId);
        return {
          generation: (freshSession ? freshSession.generation : session.generation) + GENERATION_OFFSET,
          contextVersion: fresh.version,
          paused: freshSession ? freshSession.status === 'paused' : false,
        };
      };

      // ---- 4) 按角色逐次真实调用候选 adapter（单一 provider 实例服务所有角色）。
      const text = annotation !== undefined ? annotation.question : '';
      const roleResults: { role: string; result: CandidateResult }[] = [];
      const requestIds: string[] = [];
      for (const role of req.domainRoles) {
        const requestId = candidateRequestIdOf(req, role, candidateGeneration, contextVersion);
        requestIds.push(requestId);
        const result = await candidate.analyze({
          requestId,
          projectId: session.projectId,
          sessionId: req.sessionId,
          generation: candidateGeneration,
          contextVersion,
          role,
          purpose: req.purpose,
          text,
          evidenceRefs: mappedRefs.evidenceRefs,
        }, { snapshot: snapshotForCandidate });
        roleResults.push({ role, result });
      }

      // ---- 5) 候选七状态 → 产品四状态分桶（INTEGRATION §3/§4 表）。
      const okEntries = roleResults.filter((e) => e.result.status === 'succeeded' || e.result.status === 'simulated');
      const rejectedEntries = roleResults.filter((e) => e.result.status === 'stale' || e.result.status === 'cancelled');
      const failedEntries = roleResults.filter((e) => e.result.status === 'failed' || e.result.status === 'unknown' || e.result.status === 'not_configured');
      const productStatus: 'ok' | 'partial' | 'failed' | 'rejected' = (() => {
        if (okEntries.length > 0) return rejectedEntries.length + failedEntries.length > 0 ? 'partial' : 'ok';
        if (rejectedEntries.length > 0 && failedEntries.length === 0) return 'rejected';
        return 'failed';
      })();
      const primaryEntry = okEntries[0] ?? rejectedEntries[0] ?? failedEntries[0];
      const primaryResult = primaryEntry?.result;
      const primaryStatus = primaryResult?.status ?? 'failed';

      // ---- 6) 聚合（仅成功类结果进候选 aggregateResults：dissent 全量保留、问题去重不吞关键项、
      //      pendingDecisions 只列双方不裁决）。
      let dissent: unknown[] = [];
      let pendingDecisions: unknown[] = [];
      if (okEntries.length > 0) {
        const aggregate = (aggregateResults as unknown as (
          results: unknown[], opts?: { dedupeQuestions?: boolean }
        ) => { dissent: unknown[]; pendingDecisions: unknown[] })(okEntries.map((e) => e.result));
        dissent = aggregate.dissent;
        pendingDecisions = aggregate.pendingDecisions;
      }
      const preservedFindings: unknown[] | undefined = primaryStatus === 'stale'
        ? JSON.parse(JSON.stringify(primaryResult?.findings ?? []))
        : undefined;

      // ---- 7) replies（产品 model_simulation 标注）：模拟通道首条 reply 承载 SIMULATION 中文声明。
      const replies: ModelProviderResult['replies'] = [];
      const simulatedEntry = okEntries.find((e) => e.result.status === 'simulated');
      if (simulatedEntry !== undefined) {
        replies.push({
          kind: 'model_simulation',
          domainRole: simulatedEntry.role,
          text: simulatedEntry.result.simulation?.notice ?? SIMULATION_FALLBACK_NOTICE,
          author: '模型通道声明（SIMULATED · 显著标记）',
        });
      }
      for (const { role, result } of okEntries) {
        for (const f of result.findings) {
          if (typeof f.text !== 'string' || f.text.length === 0) continue;
          replies.push({
            kind: 'model_simulation',
            domainRole: role,
            text: f.text,
            author: result.status === 'simulated'
              ? `模型发现（候选 R2 · ${role} · 模拟，authority=none）`
              : `模型发现（候选 R2 · ${role}，authority=none，须人工复核）`,
          });
        }
        for (const q of result.questions) {
          if (typeof q.text !== 'string' || q.text.length === 0) continue;
          replies.push({
            kind: 'model_simulation',
            domainRole: role,
            text: q.text,
            author: result.status === 'simulated'
              ? `模型追问（候选 R2 · ${role} · 模拟，authority=none）`
              : `模型追问（候选 R2 · ${role}，authority=none，须人工复核）`,
          });
        }
      }

      // ---- 8) failureReason（展示候选中文 message）与 productAction（候选 statusToProductAction）。
      let failureReason: string | undefined;
      if (productStatus === 'partial') {
        const dropped = [...rejectedEntries, ...failedEntries].map((e) => `${e.role}=${e.result.status}`).join(', ');
        const firstNotOk = failedEntries[0]?.result ?? rejectedEntries[0]?.result;
        failureReason = `部分角色结果未采纳（${dropped}）：${firstNotOk?.error?.message ?? ''}`;
      } else if (failedEntries.length > 0) {
        const first = failedEntries[0].result;
        failureReason = first.status === 'not_configured'
          ? `未配置模型服务：${first.error?.message ?? ''}`
          : first.status === 'unknown'
            ? `结果未知：${first.error?.message ?? '外部调用可能已发生，需人工核实'}（禁止自动重试）`
            : first.error?.message ?? `候选失败（${first.status}）`;
      } else if (rejectedEntries.length > 0 && okEntries.length === 0) {
        failureReason = rejectedEntries[0].result.error?.message ?? `候选拒绝（${rejectedEntries[0].result.status}）`;
      }
      let productAction: BridgedModelProviderResult['productAction'];
      try {
        productAction = (statusToProductAction as unknown as (s: string) => { uiAction: string; zh: string; allowRetry: boolean; mustHumanVerify: boolean })(primaryStatus);
      } catch {
        productAction = undefined; // 七状态之外不应出现；防御性留空，不改变主状态
      }

      const result: BridgedModelProviderResult = {
        providerKind: simulatedEntry !== undefined ? 'simulation' : okEntries.length > 0 ? 'real' : channelKind,
        status: productStatus,
        requestId: req.requestId,
        replies,
        ...(failureReason !== undefined ? { failureReason } : {}),
        ...(simulatedEntry !== undefined ? { notice: simulatedEntry.result.simulation?.notice ?? SIMULATION_FALLBACK_NOTICE } : {}),
        productAction,
        candidate: {
          status: primaryStatus,
          contractVersion: primaryResult?.contractVersion,
          errorCode: primaryResult?.error?.code ?? null,
          errorMessage: primaryResult?.error?.message ?? null,
          deduped: primaryResult?.deduped === true,
          scope: primaryResult?.scope ?? null,
          scopeNotice: primaryResult?.scopeNotice ?? null,
          generation: candidateGeneration,
          contextVersion,
          requestIds,
          perRole: roleResults.map((e) => ({ role: e.role, status: e.result.status, errorCode: e.result.error?.code ?? null })),
          dissent,
          pendingDecisions,
          usage: primaryResult?.usage ?? null,
          usageUnknown: primaryResult?.usageUnknown === true,
          ...(preservedFindings !== undefined ? { preservedFindings } : {}),
        },
      };

      // ---- 9) 产品结果返回前 probe 再判定（与产品 finalize 同序：ok/partial 才复核；证据版本过期优先）。
      if (result.status === 'ok' || result.status === 'partial') {
        const probe = stateProbe !== undefined ? stateProbe() : null;
        if (probe !== null && probe !== undefined) {
          const downgrade = stateRejection(req, probe.sessionStatus, probe.currentEvidenceVersion);
          if (downgrade !== undefined) {
            return {
              ...downgrade,
              candidate: {
                ...(result.candidate ?? { status: primaryStatus, generation: candidateGeneration, contextVersion, requestIds, perRole: roleResults.map((e) => ({ role: e.role, status: e.result.status, errorCode: e.result.error?.code ?? null })), dissent, pendingDecisions }),
                status: primaryStatus,
                downgrade: 'post-await state recheck：候选成功结果按此刻探测改判 rejected（绝不把过期结果当成功返回）',
              },
            };
          }
        }
      }
      return result;
    },
  };
}
