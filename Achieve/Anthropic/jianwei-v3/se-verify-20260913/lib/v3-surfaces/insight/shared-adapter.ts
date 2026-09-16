import {
  getV3DemoRuntime,
  getV3RoleCaseProjection,
  type V3DemoSession,
} from '../../v3-demo-backend.ts';
import type {
  InsightChatContext,
  InsightCollaborationEntry,
  InsightCollaborationMember,
  InsightRuntimeInput,
  InsightWorkItem,
} from './contracts.ts';

function failure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw failure(code, '共享 Context 字段缺失');
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readInternalCollaboration(projection: unknown) {
  const root = objectValue(projection);
  const collaboration = objectValue(root?.collaborationProjection);
  const thread = objectValue(collaboration?.thread);
  if (collaboration?.mode !== 'internal-five-thread' || !thread) {
    throw failure('SHARED_CHAT_CONTEXT_UNAVAILABLE', '共享本地群聊 Context 不可用');
  }
  if (!Array.isArray(thread.members) || !Array.isArray(thread.entries) || !Array.isArray(collaboration.workItems)) {
    throw failure('SHARED_CHAT_CONTEXT_INVALID', '共享本地群聊 Context 结构无效');
  }

  const members = thread.members.map((value): InsightCollaborationMember => {
    const member = objectValue(value);
    return {
      principalId: requiredString(member?.principalId, 'SHARED_CHAT_CONTEXT_INVALID'),
      processId: requiredString(member?.processId, 'SHARED_CHAT_CONTEXT_INVALID'),
      label: requiredString(member?.label, 'SHARED_CHAT_CONTEXT_INVALID'),
      ownerLabel: requiredString(member?.ownerLabel, 'SHARED_CHAT_CONTEXT_INVALID'),
    };
  });
  const entries = thread.entries.map((value): InsightCollaborationEntry => {
    const entry = objectValue(value);
    if (entry?.authority !== 'none') {
      throw failure('SHARED_CHAT_AUTHORITY_INVALID', '共享群聊消息不得被提升为业务权威');
    }
    return {
      entryId: requiredString(entry.entryId, 'SHARED_CHAT_CONTEXT_INVALID'),
      actorLabel: requiredString(entry.actorLabel, 'SHARED_CHAT_CONTEXT_INVALID'),
      processId: optionalString(entry.processId),
      text: requiredString(entry.text, 'SHARED_CHAT_CONTEXT_INVALID'),
      kind: requiredString(entry.kind, 'SHARED_CHAT_CONTEXT_INVALID'),
      contextVersion: requiredString(entry.contextVersion, 'SHARED_CHAT_CONTEXT_INVALID'),
      recordedAt: optionalString(entry.recordedAt),
      authority: 'none',
    };
  });
  const workItems = collaboration.workItems.map((value): InsightWorkItem => {
    const workItem = objectValue(value);
    return {
      processId: requiredString(workItem?.processId, 'SHARED_CHAT_CONTEXT_INVALID'),
      label: requiredString(workItem?.label, 'SHARED_CHAT_CONTEXT_INVALID'),
      task: requiredString(workItem?.task, 'SHARED_CHAT_CONTEXT_INVALID'),
      runStatus: requiredString(workItem?.runStatus, 'SHARED_CHAT_CONTEXT_INVALID'),
      gateState: requiredString(workItem?.gateState, 'SHARED_CHAT_CONTEXT_INVALID'),
    };
  });
  return {
    threadId: requiredString(thread.threadId, 'SHARED_CHAT_CONTEXT_INVALID'),
    members,
    entries,
    workItems,
  };
}

function assertInternalSession(session: V3DemoSession): void {
  if (session.roleApplicationId === 'external') {
    throw failure('ACTION_SCOPE_DENIED', '外联账号无权访问 System Runtime');
  }
}

export function readSharedInsightRuntimeInput(
  session: V3DemoSession,
  caseId = 'FL-DEMO-001',
): InsightRuntimeInput {
  assertInternalSession(session);
  const snapshot = getV3DemoRuntime().snapshot();
  if (!snapshot.cases.some((item) => item.caseId === caseId)) {
    throw failure('CASE_NOT_FOUND', '事项不存在');
  }
  const collaboration = readInternalCollaboration(getV3RoleCaseProjection(session, snapshot.scenarioRef.caseId));
  return structuredClone({
    scenarioRef: snapshot.scenarioRef,
    runtimeEpoch: snapshot.runtimeEpoch,
    currentContext: snapshot.currentContext,
    cases: snapshot.cases.map((item) => ({ caseId: item.caseId })),
    processRuns: snapshot.processRuns,
    receipts: snapshot.receipts,
    events: snapshot.events,
    collaboration,
    sourceMode: 'in_memory_demo' as const,
    telemetryContract: {
      // The shared runtime does not yet expose the eligible-agent denominator explicitly.
      humanTakeoverDenominatorComplete: false,
      slaTargetMinutes: null,
      forecastThroughputPerHour: null,
      scenarioThroughputPerHour: null,
    },
  });
}

export function readSharedInsightChatContext(
  session: V3DemoSession,
  caseId: string,
): InsightChatContext {
  assertInternalSession(session);
  const projection = getV3RoleCaseProjection(session, caseId);
  const root = objectValue(projection);
  const collaboration = readInternalCollaboration(projection);
  const runtimeEpoch = requiredString(root?.runtimeEpoch, 'SHARED_CHAT_CONTEXT_INVALID');
  const contextVersion = requiredString(root?.contextVersion, 'SHARED_CHAT_CONTEXT_INVALID');
  const runtimeAsOf = getV3DemoRuntime().snapshot().events.at(-1)?.recordedAt ?? null;
  return structuredClone({
    caseId,
    contextVersion,
    runtimeEpoch,
    threadId: collaboration.threadId,
    entries: collaboration.entries,
    asOf: runtimeAsOf,
  });
}
