import {
  type V3CandidateReply,
  type V3ChatRouteState,
  type V3ContextSelector,
  type V3ProfessionalRole,
  type V3RoleProjectionId,
  type V3SendMessageResult,
} from '../v3-surfaces/shared/contracts.ts';
import { getV3RolePolicy, isV3RoleProjectionId } from '../v3-surfaces/shared/role-policies.ts';
import { V3SqliteStore, stableV3Json } from './sqlite-store.ts';

export type V3CandidateAdapterResult =
  | { status: 'candidate'; text: string }
  | { status: 'busy'; message?: string }
  | { status: 'error'; code?: string; message?: string; retryable?: boolean };

export type V3CandidateAdapter = (input: {
  target: 'jw' | V3ProfessionalRole;
  text: string;
  contextVersion: string;
  retryOfMessageId: string | null;
}) => V3CandidateAdapterResult | Promise<V3CandidateAdapterResult>;

export type V3SharedRuntimeOptions = {
  databasePath?: string;
  now?: () => string;
  candidateAdapter?: V3CandidateAdapter;
};

export type V3SendMessageInput = {
  requestId: string;
  actorRole: V3RoleProjectionId;
  context: V3ContextSelector;
  text: string;
};

export type V3RetryMessageInput = {
  requestId: string;
  actorRole: V3RoleProjectionId;
  originalMessageId: string;
};

export type V3HumanGateInput = {
  requestId: string;
  actorRole: V3ProfessionalRole;
  principalId: string;
  processId: V3ProfessionalRole;
  context: V3ContextSelector;
  expectedContextVersion: string;
  decision: 'confirm' | 'reject' | 'return_for_evidence';
  rationale: string;
  evidenceReceiptIds: string[];
};

const HUMAN_MENTIONS: ReadonlyArray<[string, V3RoleProjectionId]> = [
  ['领导', 'leadership'],
  ['业务', 'business'],
  ['客户', 'customer'],
  ['供应商', 'supplier'],
];

const PROFESSIONAL_MENTIONS: ReadonlyArray<[string, V3ProfessionalRole]> = [
  ['政策', 'policy'],
  ['信审', 'credit'],
  ['商务', 'commercial'],
  ['资产', 'asset'],
];

function failure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export function assertV3DemoResetSession(session: { principalId: string } | null | undefined): void {
  if (!session) throw failure('DEMO_SESSION_REQUIRED', '需要选择演示账号');
  if (session.principalId !== 'collaboration-manager') {
    throw failure('ACTION_SCOPE_DENIED', '只有协同演示控制账号可以 reset');
  }
}

function normalizedText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw failure('INVALID_INPUT', `${field} 无效`);
  }
  return value.trim();
}

function defaultCandidateAdapter(input: Parameters<V3CandidateAdapter>[0]): V3CandidateAdapterResult {
  const label = input.target === 'jw' ? '见微' : {
    policy: '政策',
    credit: '信审',
    commercial: '商务',
    asset: '资产',
  }[input.target];
  return {
    status: 'candidate',
    text: `${label}本地演示候选：已按 ${input.contextVersion} 上下文接收消息；任何正式判断仍需具名专业人审与 Gate。`,
  };
}

function targetKey(route: V3ChatRouteState): string {
  return `${route.target}:${route.targetRole ?? ''}`;
}

function parseRoutes(text: string): V3ChatRouteState[] {
  const routes: V3ChatRouteState[] = [];
  if (/@jw\b/i.test(text) || text.includes('@见微')) {
    routes.push({ target: 'jw', targetRole: 'jw', status: 'candidate_ready', retryable: false, error: null });
  }
  for (const [mention, role] of PROFESSIONAL_MENTIONS) {
    if (text.includes(`@${mention}`)) {
      routes.push({ target: role, targetRole: role, status: 'candidate_ready', retryable: false, error: null });
    }
  }
  for (const [mention, role] of HUMAN_MENTIONS) {
    if (text.includes(`@${mention}`)) {
      routes.push({ target: 'human_role', targetRole: role, status: 'delivered', retryable: false, error: null });
    }
  }
  if (routes.length === 0) {
    routes.push({ target: 'group', targetRole: null, status: 'delivered', retryable: false, error: null });
  }
  return [...new Map(routes.map((route) => [targetKey(route), route])).values()];
}

function validateRole(role: unknown): asserts role is V3RoleProjectionId {
  if (!isV3RoleProjectionId(role)) throw failure('INVALID_ROLE', '角色投影无效');
}

function assertContextVisible(actorRole: V3RoleProjectionId, grain: V3ContextSelector['grain']): void {
  const policy = getV3RolePolicy(actorRole);
  if (!policy.visibleGrains.includes(grain)) {
    throw failure('CONTEXT_SCOPE_DENIED', '当前角色不能读写该上下文粒度');
  }
}

export function createV3SharedRuntime(options: V3SharedRuntimeOptions = {}) {
  const store = new V3SqliteStore(options.databasePath);
  const now = options.now ?? (() => new Date().toISOString());
  const candidateAdapter = options.candidateAdapter ?? defaultCandidateAdapter;
  const singleflight = new Map<string, { signature: string; promise: Promise<V3SendMessageResult> }>();

  async function executeRoutes(
    routes: V3ChatRouteState[],
    text: string,
    contextVersion: string,
    retryOfMessageId: string | null,
  ): Promise<{ routes: V3ChatRouteState[]; candidateDrafts: Array<{ routedTo: V3CandidateReply['routedTo']; text: string }> }> {
    const resolvedRoutes: V3ChatRouteState[] = [];
    const candidateDrafts: Array<{ routedTo: V3CandidateReply['routedTo']; text: string }> = [];
    for (const route of routes) {
      if (route.target !== 'jw' && !PROFESSIONAL_MENTIONS.some(([, role]) => role === route.target)) {
        resolvedRoutes.push(structuredClone(route));
        continue;
      }
      const target = route.target as 'jw' | V3ProfessionalRole;
      let result: V3CandidateAdapterResult;
      try {
        result = await candidateAdapter({ target, text, contextVersion, retryOfMessageId });
      } catch (error) {
        result = {
          status: 'error',
          code: 'CANDIDATE_ADAPTER_ERROR',
          message: error instanceof Error ? error.message : '候选服务失败',
          retryable: true,
        };
      }
      if (result.status === 'candidate') {
        candidateDrafts.push({ routedTo: target, text: normalizedText(result.text, 'candidate text', 1200) });
        resolvedRoutes.push({ ...route, status: 'candidate_ready', retryable: false, error: null });
      } else if (result.status === 'busy') {
        resolvedRoutes.push({
          ...route,
          status: 'busy',
          retryable: true,
          error: { code: 'CANDIDATE_BUSY', message: result.message ?? '候选服务忙，可重试', retryable: true },
        });
      } else {
        const retryable = result.retryable ?? true;
        resolvedRoutes.push({
          ...route,
          status: 'error',
          retryable,
          error: {
            code: result.code ?? 'CANDIDATE_ERROR',
            message: result.message ?? '候选服务失败',
            retryable,
          },
        });
      }
    }
    return { routes: resolvedRoutes, candidateDrafts };
  }

  async function sendMessage(input: V3SendMessageInput): Promise<V3SendMessageResult> {
    const requestId = normalizedText(input.requestId, 'requestId', 128);
    const text = normalizedText(input.text, 'message', 600);
    validateRole(input.actorRole);
    assertContextVisible(input.actorRole, input.context.grain);
    const context = store.resolveContext(input.context);
    if (context.caseId && store.getCase(context.caseId).readOnly) {
      throw failure('BACKGROUND_CASE_READ_ONLY', '背景 Case 只提供可追踪的场景投影');
    }
    const baseRoutes = parseRoutes(text);
    const signature = stableV3Json({ actorRole: input.actorRole, context: input.context, text });
    const replay = store.getIdempotentMessageResult('chat', requestId, signature);
    if (replay) return replay;
    const key = `chat:${requestId}`;
    const active = singleflight.get(key);
    if (active) {
      if (active.signature !== signature) throw failure('IDEMPOTENCY_CONFLICT', '同一 requestId 的载荷不一致');
      return active.promise;
    }
    const promise = (async () => {
      const executed = await executeRoutes(baseRoutes, text, context.contextVersion, null);
      return store.persistChat({
        requestId,
        signature,
        context,
        actorRole: input.actorRole,
        text,
        routes: executed.routes,
        candidateDrafts: executed.candidateDrafts,
        now: now(),
      });
    })();
    singleflight.set(key, { signature, promise });
    try {
      return await promise;
    } finally {
      if (singleflight.get(key)?.promise === promise) singleflight.delete(key);
    }
  }

  async function retryMessage(input: V3RetryMessageInput): Promise<V3SendMessageResult> {
    const requestId = normalizedText(input.requestId, 'requestId', 128);
    const originalMessageId = normalizedText(input.originalMessageId, 'originalMessageId', 160);
    validateRole(input.actorRole);
    const originalMessage = store.getMessage(originalMessageId);
    if (originalMessage.actorKind !== 'human' || originalMessage.actorRole !== input.actorRole) {
      throw failure('MESSAGE_RETRY_SCOPE_DENIED', '只能重试当前角色的原始人类消息');
    }
    const signature = stableV3Json({ actorRole: input.actorRole, originalMessageId });
    const replay = store.getIdempotentMessageResult('retry', requestId, signature);
    if (replay) return replay;
    const baseRoutes = parseRoutes(originalMessage.text).filter((route) =>
      route.target === 'jw' || PROFESSIONAL_MENTIONS.some(([, role]) => role === route.target));
    if (baseRoutes.length === 0) throw failure('MESSAGE_NOT_RETRYABLE', '原始消息没有 AI candidate 路由');
    const key = `retry:${requestId}`;
    const active = singleflight.get(key);
    if (active) {
      if (active.signature !== signature) throw failure('IDEMPOTENCY_CONFLICT', '同一 requestId 的载荷不一致');
      return active.promise;
    }
    const promise = (async () => {
      const executed = await executeRoutes(
        baseRoutes,
        originalMessage.text,
        originalMessage.contextVersion,
        originalMessage.messageId,
      );
      return store.persistRetry({
        requestId,
        signature,
        originalMessage,
        routes: executed.routes,
        candidateDrafts: executed.candidateDrafts,
        now: now(),
      });
    })();
    singleflight.set(key, { signature, promise });
    try {
      return await promise;
    } finally {
      if (singleflight.get(key)?.promise === promise) singleflight.delete(key);
    }
  }

  return {
    store,
    sendMessage,
    retryMessage,
    recordHumanGate(input: V3HumanGateInput) {
      return store.persistHumanGate({ ...input, evidenceReceiptIds: [...input.evidenceReceiptIds], now: now() });
    },
    demoReset(input: Omit<Parameters<V3SqliteStore['demoReset']>[0], 'now'>) {
      return store.demoReset({ ...input, now: now() });
    },
    authorityRuntime: {
      snapshot() {
        return store.getAuthoritySnapshot();
      },
      listEvents(afterSequence = 0, limit = 100) {
        return store.listAuthorityEvents(afterSequence, limit);
      },
      acceptEvidence(input: Parameters<V3SqliteStore['authorityAcceptEvidence']>[0]) {
        return store.authorityAcceptEvidence(input, now());
      },
      commitContext(input: Parameters<V3SqliteStore['authorityCommitContext']>[0]) {
        return store.authorityCommitContext(input, now());
      },
      updateProcessRun(input: Parameters<V3SqliteStore['authorityUpdateProcessRun']>[0]) {
        return store.authorityUpdateProcessRun(input, now());
      },
      recordHumanGate(input: Parameters<V3SqliteStore['authorityRecordHumanGate']>[0]) {
        return store.authorityRecordHumanGate(input, now());
      },
      recordManagementAction(input: Parameters<V3SqliteStore['authorityRecordManagementAction']>[0]) {
        return store.authorityRecordManagementAction(input, now());
      },
      recordMessage(input: Parameters<V3SqliteStore['authorityRecordMessage']>[0]) {
        return store.authorityRecordMessage(input, now());
      },
      recordCommencement(input: Parameters<V3SqliteStore['authorityRecordCommencement']>[0]) {
        return store.authorityRecordCommencement(input, now());
      },
    },
    close() {
      store.close();
    },
  };
}
