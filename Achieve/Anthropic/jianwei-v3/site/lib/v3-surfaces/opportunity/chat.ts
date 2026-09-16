import type { V3SendMessageResult } from '../shared/contracts.ts';
import {
  opportunityRoleForSession,
  getOpportunitySharedPort,
  type OpportunitySharedPort,
} from './shared-port.ts';
import {
  opportunityChatContext,
  opportunityContextSelector,
} from './projection.ts';
import type {
  OpportunityChatResult,
  OpportunitySession,
} from './types.ts';

function failure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function assertSharedMessageResult(input: {
  result: V3SendMessageResult;
  requestId: string;
  actorRole: ReturnType<typeof opportunityRoleForSession>;
  contextId: string;
  contextVersion: string;
}): void {
  const { result } = input;
  if (
    result.message.requestId !== input.requestId ||
    result.message.contextId !== input.contextId ||
    result.message.contextVersion !== input.contextVersion ||
    result.message.actorKind !== 'human' ||
    result.message.actorRole !== input.actorRole ||
    result.message.authority !== 'none' ||
    result.candidates.some((candidate) =>
      candidate.status !== 'candidate' ||
      candidate.authority !== 'none' ||
      candidate.disclaimer !== 'AI candidate · authority none' ||
      candidate.contextVersion !== input.contextVersion) ||
    result.routes.some((route) => route.status === 'candidate_ready' && route.target !== 'jw' && ![
      'policy', 'credit', 'commercial', 'asset',
    ].includes(route.target))
  ) {
    throw failure('SHARED_CHAT_CONTRACT_VIOLATION', '共享群聊返回了不可接受的权限或上下文');
  }
}

export async function sendOpportunityChatMessage(input: {
  session: OpportunitySession;
  opportunityId: string;
  requestId: string;
  message: string;
  port?: OpportunitySharedPort;
}): Promise<OpportunityChatResult> {
  const port = input.port ?? getOpportunitySharedPort();
  const requestId = input.requestId.trim();
  const message = input.message.trim();
  if (!requestId) throw failure('INVALID_REQUEST_ID', 'requestId 不能为空');
  if (!message) throw failure('INVALID_MESSAGE', '消息不能为空');
  const caseId = input.opportunityId.startsWith('OPP-') ? input.opportunityId.slice(4) : '';
  const caseItem = port.listCases().find((item) => item.caseId === caseId);
  if (!caseItem) throw failure('OPPORTUNITY_NOT_FOUND', '商机不存在');
  if (caseItem.readOnly) throw failure('BACKGROUND_CASE_READ_ONLY', '背景 Case 只提供可追踪的场景投影');
  if (input.session.roleApplicationId === 'external' && input.session.invitation?.caseId !== caseId) {
    throw failure('CONTEXT_SCOPE_DENIED', '外联邀请不覆盖当前商机');
  }
  const actorRole = opportunityRoleForSession(input.session);
  const contextSelector = opportunityContextSelector(caseItem, port);
  const context = port.resolveContext(contextSelector);
  const result = await port.sendMessage({
    requestId,
    actorRole,
    context: contextSelector,
    text: message,
  });
  assertSharedMessageResult({
    result,
    requestId,
    actorRole,
    contextId: context.contextId,
    contextVersion: context.contextVersion,
  });
  const chatContext = opportunityChatContext({
    contextId: context.contextId,
    contextVersion: context.contextVersion,
    port,
  });
  if (!chatContext.messages.some((item) => item.messageId === result.message.messageId)) {
    throw failure('SHARED_CHAT_RECONCILIATION_FAILED', '消息已返回但未能从共享 SQLite 回读');
  }
  return { ...result, chatContext };
}
