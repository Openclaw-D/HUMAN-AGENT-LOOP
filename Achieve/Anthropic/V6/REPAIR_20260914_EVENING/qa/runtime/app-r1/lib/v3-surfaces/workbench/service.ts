import { createDefaultSharedWorkbenchAdapter } from './adapter.ts';
import { PROFESSIONAL_PRINCIPALS } from './catalog.ts';
import { projectWorkbenchReadModel } from './projection.ts';
import {
  BUSINESS_ACTION_TYPES,
  PROFESSIONAL_ACTION_TYPES,
  PROFESSIONAL_PERSPECTIVES,
  WORKBENCH_PERSPECTIVES,
  type BusinessActionType,
  type ProfessionalActionType,
  type ProfessionalPerspective,
  type SharedWorkbenchAdapter,
  type WorkbenchActionRequest,
  type WorkbenchActionResult,
  type WorkbenchPerspective,
  type WorkbenchSession,
} from './types.ts';

const ROUTABLE_PRINCIPALS = new Set([
  'collaboration-manager',
  'business-owner',
  'risk-policy',
  'risk-credit',
  'risk-commercial',
  'risk-asset',
  'external-customer',
  'external-supplier',
]);

function failure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function assertPerspective(value: string): asserts value is WorkbenchPerspective {
  if (!WORKBENCH_PERSPECTIVES.includes(value as WorkbenchPerspective)) {
    throw failure('INVALID_PERSPECTIVE', 'Workbench perspective 无效');
  }
}

function assertInternalSession(session: WorkbenchSession): void {
  if (session.roleApplicationId === 'external') {
    throw failure('CASE_SCOPE_DENIED', '外联主体无权进入内部 Case Workbench');
  }
}

function assertCurrentContext(expectedContextVersion: string, actualContextVersion: string | null): void {
  if (!actualContextVersion || expectedContextVersion !== actualContextVersion) {
    throw failure('CONTEXT_VERSION_CONFLICT', 'Context Version 已变化');
  }
}

function actionMessage(input: WorkbenchActionRequest): string {
  const value = trimmed(input.message) || trimmed(input.rationale);
  if (!value) throw failure('INVALID_INPUT', '动作 message 或 rationale 不能为空');
  return value;
}

function targetPrincipal(value: unknown): string {
  const principalId = trimmed(value);
  if (!ROUTABLE_PRINCIPALS.has(principalId)) {
    throw failure('INVALID_TARGET_PRINCIPAL', '目标主体不可路由');
  }
  return principalId;
}

function gateDecision(actionType: ProfessionalActionType) {
  if (actionType === 'confirm') return 'confirm' as const;
  if (actionType === 'reject') return 'reject' as const;
  return 'return_for_evidence' as const;
}

export function createWorkbenchService(adapter: SharedWorkbenchAdapter = createDefaultSharedWorkbenchAdapter()) {
  return {
    async read(
      session: WorkbenchSession,
      caseId: string,
      perspectiveInput: string,
    ) {
      assertInternalSession(session);
      assertPerspective(perspectiveInput);
      const snapshot = await adapter.readCase(caseId);
      return projectWorkbenchReadModel(snapshot, session, perspectiveInput, adapter.integration);
    },

    async act(
      session: WorkbenchSession,
      caseId: string,
      perspectiveInput: string,
      input: WorkbenchActionRequest,
    ): Promise<WorkbenchActionResult> {
      assertInternalSession(session);
      assertPerspective(perspectiveInput);
      const requestId = trimmed(input.requestId);
      const expectedContextVersion = trimmed(input.expectedContextVersion);
      if (!requestId || !expectedContextVersion) {
        throw failure('INVALID_INPUT', 'requestId 与 expectedContextVersion 必填');
      }
      const snapshot = await adapter.readCase(caseId);
      if (snapshot.caseItem.readOnly) throw failure('BACKGROUND_CASE_READ_ONLY', '背景事项只允许读取投影');
      assertCurrentContext(expectedContextVersion, snapshot.currentContext?.contextVersion ?? null);

      if (perspectiveInput === 'business') {
        if (session.principalId !== 'business-owner' || session.roleApplicationId !== 'business') {
          throw failure('ACTION_SCOPE_DENIED', '只有具名业务 Owner 可提交业务协调动作');
        }
        if (!BUSINESS_ACTION_TYPES.includes(input.actionType as BusinessActionType)) {
          throw failure('INVALID_ACTION_TYPE', '业务动作类型无效');
        }
        const target = targetPrincipal(input.targetPrincipalId);
        const record = await adapter.recordCoordinationAction({
          requestId,
          caseId,
          contextVersion: expectedContextVersion,
          actor: session,
          perspective: 'business',
          actionType: input.actionType as BusinessActionType,
          targetPrincipalId: target,
          message: actionMessage(input),
        });
        return {
          requestId,
          caseId,
          contextVersion: record.contextVersion,
          perspective: 'business',
          actionType: input.actionType,
          status: 'routed',
          result: input.actionType === 'terminate'
            ? '终止请求已路由；shared SQLite workflow mutation 待 Leadership Back 接点，当前未改变流程状态'
            : '业务协调动作已路由；未替代专业判断或 Human Gate',
          authority: 'none',
          authoritativeStateChanged: false,
          eventId: record.eventId,
          receiptId: null,
          route: { threadId: `${caseId}-INTERNAL`, targetPrincipalId: target },
          retry: { retryable: false },
        };
      }

      const perspective = perspectiveInput as ProfessionalPerspective;
      if (!PROFESSIONAL_PERSPECTIVES.includes(perspective)) {
        throw failure('INVALID_PERSPECTIVE', '专业 perspective 无效');
      }
      if (
        session.roleApplicationId !== 'risk' ||
        session.principalId !== PROFESSIONAL_PRINCIPALS[perspective]
      ) {
        throw failure('ACTION_SCOPE_DENIED', '只有本专业具名角色可提交该动作');
      }
      if (!PROFESSIONAL_ACTION_TYPES.includes(input.actionType as ProfessionalActionType)) {
        throw failure('INVALID_ACTION_TYPE', '专业动作类型无效');
      }
      const actionType = input.actionType as ProfessionalActionType;
      if (actionType === 'request-evidence') {
        const target = targetPrincipal(input.targetPrincipalId);
        const record = await adapter.recordCoordinationAction({
          requestId,
          caseId,
          contextVersion: expectedContextVersion,
          actor: session,
          perspective,
          actionType,
          targetPrincipalId: target,
          message: actionMessage(input),
        });
        return {
          requestId,
          caseId,
          contextVersion: record.contextVersion,
          perspective,
          actionType,
          status: 'routed',
          result: '具名补证请求已路由；未形成专业 Gate 结论',
          authority: 'none',
          authoritativeStateChanged: false,
          eventId: record.eventId,
          receiptId: null,
          route: { threadId: `${caseId}-INTERNAL`, targetPrincipalId: target },
          retry: { retryable: false },
        };
      }

      const rationale = trimmed(input.rationale);
      if (!rationale) throw failure('INVALID_INPUT', '专业 Gate rationale 必填');
      if (!Array.isArray(input.evidenceReceiptIds) || input.evidenceReceiptIds.length === 0) {
        throw failure('EVIDENCE_REQUIRED', '专业 Gate 必须引用具名 Evidence Receipt');
      }
      const record = await adapter.recordProfessionalGate({
        requestId,
        caseId,
        expectedContextVersion,
        actor: session,
        processId: perspective,
        decision: gateDecision(actionType),
        rationale,
        evidenceReceiptIds: input.evidenceReceiptIds.map(String),
      });
      return {
        requestId,
        caseId,
        contextVersion: record.contextVersion,
        perspective,
        actionType,
        status: 'recorded',
        result: record.status === 'confirm'
          ? '专业 Human Gate 已确认'
          : record.status === 'reject'
            ? '专业 Human Gate 已拒绝'
            : '专业 Human Gate 已退回补证',
        authority: 'confirmed_human',
        authoritativeStateChanged: true,
        eventId: record.eventId,
        receiptId: record.receiptId,
        route: { threadId: `${caseId}-INTERNAL`, targetPrincipalId: record.principalId },
        retry: { retryable: false },
      };
    },
  };
}

let defaultService: ReturnType<typeof createWorkbenchService> | undefined;

export function getDefaultWorkbenchService() {
  defaultService ??= createWorkbenchService();
  return defaultService;
}
