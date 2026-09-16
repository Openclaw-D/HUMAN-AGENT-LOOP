import {
  V3ClientApiError,
  type V3ApiFetch,
  type V3CasePanelDto,
  type V3CasePanelItemDto,
  type V3DemoSessionDto,
  v3Api,
} from '../../../lib/v3-client.ts';
import type {
  OpportunityApiState,
  OpportunityChatResult,
  OpportunityReadModel,
  OpportunitySharedChatContext,
} from '../../../lib/v3-surfaces/opportunity/types.ts';
import type { V3CandidateReply, V3ChatRouteState } from '../../../lib/v3-surfaces/shared/contracts.ts';

export const OPPORTUNITY_GOLDEN_CASE_ID = 'FL-DEMO-001' as const;
export const OPPORTUNITY_GOLDEN_ID = `OPP-${OPPORTUNITY_GOLDEN_CASE_ID}` as const;

export type OpportunityReadyDto = {
  sessionId: string;
  goldenCase: V3CasePanelItemDto;
  backgroundCases: V3CasePanelItemDto[];
  readModel: OpportunityReadModel;
  chatCapability: { enabled: boolean; denialCode: string | null };
  candidateReplies: V3CandidateReply[];
  routeStates: V3ChatRouteState[];
  lastMessageEventId: string | null;
};

export type OpportunityClient = {
  initialize(signal?: AbortSignal): Promise<OpportunityReadyDto>;
  reload(sessionId: string, signal?: AbortSignal): Promise<OpportunityReadyDto>;
  sendMessage(input: {
    sessionId: string;
    requestId?: string;
    message: string;
    signal?: AbortSignal;
  }): Promise<OpportunityReadyDto>;
};

type ClientOptions = { fetchImpl?: V3ApiFetch; createRequestId?: () => string };

type MessageResponseDto = {
  [Key in keyof OpportunityChatResult]?: OpportunityChatResult[Key];
};

function invalidResponse(code: string, message: string, retryable = false): V3ClientApiError {
  return new V3ClientApiError({ code, message, status: 200, retryable });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function defaultRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new V3ClientApiError({ code: 'REQUEST_ID_UNAVAILABLE', message: '当前环境无法生成唯一请求标识', status: 0, retryable: false });
  }
  return `opportunity-${globalThis.crypto.randomUUID()}`;
}

function validateSession(value: unknown): asserts value is V3DemoSessionDto {
  if (
    !isRecord(value) || !isNonEmptyString(value.sessionId) || value.principalId !== 'business-owner' ||
    value.roleApplicationId !== 'business' || value.invitation !== null
  ) throw invalidResponse('INVALID_OPPORTUNITY_SESSION', '商机会话身份与请求不一致');
}

function validateCasePanel(value: unknown): asserts value is V3CasePanelDto {
  if (!isRecord(value) || value.roleApplicationId !== 'business' || value.principalId !== 'business-owner' || !Array.isArray(value.items)) {
    throw invalidResponse('INVALID_OPPORTUNITY_CASE_PANEL', '商机列表投影结构无效');
  }
  const golden = value.items.filter((item) => item.caseTier === 'golden');
  const background = value.items.filter((item) => item.caseTier === 'background');
  if (
    golden.length !== 1 || golden[0]?.caseId !== OPPORTUNITY_GOLDEN_CASE_ID ||
    background.length < 4 || background.length > 6 || background.some((item) => !item.readOnly)
  ) throw invalidResponse('INVALID_OPPORTUNITY_CASE_SET', '商机列表必须包含一个 Golden Case 与 4–6 个只读背景摘要');
}

function validateReadModelState(value: unknown): asserts value is OpportunityApiState<OpportunityReadModel> & { status: 'ready' } {
  if (!isRecord(value) || value.status !== 'ready' || !isRecord(value.data)) {
    throw invalidResponse('INVALID_OPPORTUNITY_STATE', 'Opportunity API 未返回 ready projection');
  }
  const data = value.data;
  if (
    data.projectionType !== 'OpportunityReadModel' || data.grain !== 'Opportunity' ||
    data.opportunityId !== OPPORTUNITY_GOLDEN_ID || data.caseId !== OPPORTUNITY_GOLDEN_CASE_ID ||
    data.caseTier !== 'golden' || data.readOnly !== false || !isNonEmptyString(data.projectionVersion) ||
    !isRecord(data.relationships) || !isRecord(data.materials) || !Array.isArray(data.responsibilityMatrix) ||
    !Array.isArray(data.allowedBusinessActions) || !Array.isArray(data.forbiddenBusinessActions) || !isRecord(data.chatContext)
  ) throw invalidResponse('INVALID_OPPORTUNITY_PROJECTION', 'Opportunity projection 与 Golden Case 不一致');
}

function validateMessageResult(value: unknown, requestId: string, message: string): asserts value is OpportunityChatResult {
  if (
    !isRecord(value) || value.status !== 'accepted' || value.completion !== 'message_persisted' || value.authority !== 'none' ||
    !isRecord(value.message) || !isNonEmptyString(value.message.messageId) || value.message.requestId !== requestId ||
    value.message.actorKind !== 'human' || value.message.actorRole !== 'business' || value.message.authority !== 'none' ||
    value.message.text !== message || !isNonEmptyString(value.message.contextVersion) ||
    !Array.isArray(value.routes) || !Array.isArray(value.candidates) || !isRecord(value.chatContext) ||
    value.candidates.some((candidate) => !isRecord(candidate) || candidate.kind !== 'ai_candidate' ||
      candidate.status !== 'candidate' || candidate.completion !== 'not_formal_completion' ||
      candidate.authority !== 'none' || candidate.disclaimer !== 'AI candidate · authority none')
  ) throw invalidResponse('INVALID_OPPORTUNITY_MESSAGE_RESPONSE', 'Opportunity 消息结果违反共享 contract');
}

function validateChatContext(value: unknown, messageId: string): asserts value is OpportunitySharedChatContext {
  if (
    !isRecord(value) || value.availability !== 'available' || !isNonEmptyString(value.contextId) ||
    !isNonEmptyString(value.contextVersion) || !Array.isArray(value.messages) ||
    !value.messages.some((entry) => isRecord(entry) && entry.messageId === messageId && entry.authority === 'none')
  ) throw invalidResponse('OPPORTUNITY_MESSAGE_RECONCILIATION_FAILED', '消息已写入，但共享 Opportunity 群聊尚未包含该事件', true);
}

export function createOpportunityClient(options: ClientOptions = {}): OpportunityClient {
  const fetchImpl = options.fetchImpl;
  const createRequestId = options.createRequestId ?? defaultRequestId;

  async function readReady(
    sessionId: string,
    signal?: AbortSignal,
    lastMessage?: OpportunityChatResult['message'] | null,
    candidateReplies?: V3CandidateReply[],
    routeStates?: V3ChatRouteState[],
  ): Promise<OpportunityReadyDto> {
    const [casePanel, state] = await Promise.all([
      v3Api<V3CasePanelDto>('/api/v3/cases', { sessionId, signal, fetchImpl }),
      v3Api<OpportunityApiState<OpportunityReadModel>>(`/api/v3/opportunity/${OPPORTUNITY_GOLDEN_ID}/projection`, { sessionId, signal, fetchImpl }),
    ]);
    validateCasePanel(casePanel);
    validateReadModelState(state);
    if (lastMessage) {
      validateChatContext(state.data.chatContext, lastMessage.messageId);
      if (state.data.chatContext.contextVersion !== lastMessage.contextVersion) {
        throw invalidResponse('OPPORTUNITY_CONTEXT_MISMATCH', '消息与 Opportunity projection 不属于同一 Context', true);
      }
    }
    return {
      sessionId,
      goldenCase: casePanel.items.find((item) => item.caseTier === 'golden')!,
      backgroundCases: casePanel.items.filter((item) => item.caseTier === 'background'),
      readModel: state.data,
      chatCapability: {
        enabled: !state.data.readOnly,
        denialCode: null,
      },
      candidateReplies: candidateReplies ?? [],
      routeStates: routeStates ?? [],
      lastMessageEventId: lastMessage?.messageId ?? null,
    };
  }

  return {
    async initialize(signal) {
      const payload = await v3Api<{ session?: V3DemoSessionDto }>('/api/v3/demo/session', {
        method: 'POST', body: { principalId: 'business-owner' }, signal, fetchImpl,
      });
      validateSession(payload?.session);
      return readReady(payload.session.sessionId, signal);
    },
    reload(sessionId, signal) { return readReady(sessionId, signal); },
    async sendMessage({ sessionId, requestId: requestIdInput, message, signal }) {
      const normalizedMessage = typeof message === 'string' ? message.trim() : '';
      if (!normalizedMessage) throw new V3ClientApiError({ code: 'INVALID_MESSAGE', message: '消息不能为空', status: 0, retryable: false });
      const requestId = (requestIdInput ?? createRequestId()).trim();
      if (!requestId) throw new V3ClientApiError({ code: 'INVALID_REQUEST_ID', message: '请求标识不能为空', status: 0, retryable: false });
      const payload = await v3Api<MessageResponseDto>(`/api/v3/opportunity/${OPPORTUNITY_GOLDEN_ID}/messages`, {
        sessionId, method: 'POST', body: { requestId, message: normalizedMessage }, signal, fetchImpl,
      });
      validateMessageResult(payload, requestId, normalizedMessage);
      validateChatContext(payload.chatContext, payload.message.messageId);
      return readReady(sessionId, signal, payload.message, payload.candidates, payload.routes);
    },
  };
}
