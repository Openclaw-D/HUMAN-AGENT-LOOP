import { getV3SharedRuntime } from '../../v3-runtime/index.ts';
import type { V3ScenarioCase } from '../../v3-demo-scenario.ts';
import { V3_SHARED_PORTFOLIO } from '../shared/demo-fixtures.ts';
import type { V3RoleProjectionId } from '../shared/contracts.ts';
import type {
  SharedCoordinationActionInput,
  SharedCoordinationRecord,
  SharedProfessionalGateInput,
  SharedProfessionalGateRecord,
  SharedWorkbenchAdapter,
  SharedWorkbenchSnapshot,
  WorkbenchIntegrationState,
} from './types.ts';

function failure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

const INTEGRATION_STATE: WorkbenchIntegrationState = Object.freeze({
  authorityRuntime: { status: 'connected', implementation: 'canonical-shared-sqlite', persistence: 'sqlite-local-demo' },
  chat: { status: 'connected', implementation: 'shared-v3-sqlite-chat' },
  sqlite: { status: 'connected', owner: 'V3 Shared Runtime', implementation: 'canonical-shared-sqlite' },
});

const PRINCIPAL_ROLE: Record<string, V3RoleProjectionId> = {
  'collaboration-manager': 'leadership', 'business-owner': 'business', 'risk-policy': 'policy',
  'risk-credit': 'credit', 'risk-commercial': 'commercial', 'risk-asset': 'asset',
  'external-customer': 'customer', 'external-supplier': 'supplier',
};
const TARGET_MENTION: Record<string, string> = {
  'collaboration-manager': '领导', 'business-owner': '业务', 'risk-policy': '政策',
  'risk-credit': '信审', 'risk-commercial': '商务', 'risk-asset': '资产',
  'external-customer': '客户', 'external-supplier': '供应商',
};

function scenarioCase(caseId: string): V3ScenarioCase {
  const item = getV3SharedRuntime().store.getCase(caseId);
  const lifecycleStatus = item.phase === '正常在租' ? 'active_lease' : item.phase === '已关闭' ? 'closed' : 'pre_commencement';
  return {
    businessItemType: 'FinancingLeasingCase', caseId: item.caseId, caseTier: item.caseTier,
    readOnly: item.readOnly, backendScope: item.readOnly ? 'background-read-projection' : 'golden-case-authority',
    title: item.label, counterparty: '未提供', industry: '未提供', region: item.divisionLabel,
    amount: '未提供', summary: 'canonical shared SQLite synthetic demo projection', phase: item.phase,
    signal: item.attention, nextMilestone: '未提供',
    commencementBand: lifecycleStatus === 'active_lease' || lifecycleStatus === 'closed' ? 5 : 0,
    lifecycleStatus,
  };
}

function currentContext(caseId: string) {
  const runtime = getV3SharedRuntime();
  const stored = runtime.store.getCase(caseId);
  if (stored.readOnly) return null;
  return runtime.authorityRuntime.snapshot().currentContext;
}

export function createDefaultSharedWorkbenchAdapter(): SharedWorkbenchAdapter {
  return {
    integration: INTEGRATION_STATE,
    async readCase(caseId: string): Promise<SharedWorkbenchSnapshot> {
      const runtime = getV3SharedRuntime();
      const sharedCase = runtime.store.getCase(caseId);
      const context = currentContext(caseId);
      const contextId = `CTX-${caseId}`;
      const authority = runtime.authorityRuntime.snapshot();
      const isCanonicalCase = caseId === authority.scenarioRef.caseId;
      return {
        caseItem: scenarioCase(caseId), runtimeEpoch: runtime.store.getRuntimeEpoch(), currentContext: context,
        processRuns: isCanonicalCase ? authority.processRuns : [],
        receipts: isCanonicalCase ? authority.receipts : [],
        events: isCanonicalCase ? authority.events : [],
        sharedCase,
        sharedMessages: runtime.store.listMessages(contextId),
        sharedReceipts: runtime.store.listReceipts().filter((receipt) => receipt.contextId === contextId),
        sharedEvents: runtime.store.listEvents().filter((event) => event.contextId === contextId),
      };
    },
    async recordCoordinationAction(input: SharedCoordinationActionInput): Promise<SharedCoordinationRecord> {
      const actorRole = PRINCIPAL_ROLE[input.actor.principalId];
      if (!actorRole) throw failure('INVALID_ROLE', 'Workbench actor 未映射到 shared Role Projection');
      const runtime = getV3SharedRuntime();
      const item = runtime.store.getCase(input.caseId);
      const result = await runtime.sendMessage({
        requestId: input.requestId, actorRole,
        context: { grain: 'case', portfolioId: V3_SHARED_PORTFOLIO.portfolioId, divisionId: item.divisionId, caseId: item.caseId },
        text: `[${input.actionType}] @${TARGET_MENTION[input.targetPrincipalId] ?? input.targetPrincipalId} ${input.message}`,
      });
      const event = runtime.store.listEvents().find((entry) => entry.payload.messageId === result.message.messageId);
      return { eventId: event?.eventId ?? result.message.messageId, contextVersion: result.message.contextVersion, status: 'routed', authority: 'none' };
    },
    async recordProfessionalGate(input: SharedProfessionalGateInput): Promise<SharedProfessionalGateRecord> {
      const runtime = getV3SharedRuntime();
      const item = runtime.store.getCase(input.caseId);
      const result = runtime.recordHumanGate({
        requestId: input.requestId,
        actorRole: input.processId,
        principalId: input.actor.principalId,
        processId: input.processId,
        context: { grain: 'case', portfolioId: V3_SHARED_PORTFOLIO.portfolioId, divisionId: item.divisionId, caseId: item.caseId },
        expectedContextVersion: input.expectedContextVersion,
        decision: input.decision,
        rationale: input.rationale,
        evidenceReceiptIds: [...input.evidenceReceiptIds],
      });
      return {
        receiptId: result.receiptId, eventId: result.eventId, contextVersion: result.contextVersion,
        principalId: result.principalId, processId: result.processId, status: result.decision,
      };
    },
  };
}
