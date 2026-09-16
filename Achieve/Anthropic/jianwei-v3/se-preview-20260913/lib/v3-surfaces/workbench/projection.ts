import type { V3ProcessRun, V3Receipt } from '../../v3-authority-runtime.ts';
import {
  PROFESSIONAL_QUADRANTS,
  PROFESSIONAL_SPECS,
} from './catalog.ts';
import {
  BUSINESS_ACTION_TYPES,
  PROFESSIONAL_PERSPECTIVES,
  type ProfessionalPerspective,
  type QuarterThreshold,
  type SharedWorkbenchAdapter,
  type SharedWorkbenchSnapshot,
  type WorkbenchEvidenceSource,
  type WorkbenchPathStep,
  type WorkbenchPerspective,
  type WorkbenchProfessionalProjection,
  type WorkbenchReadModel,
  type WorkbenchRollup,
  type WorkbenchSession,
} from './types.ts';

const MISSING = '未提供';

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

export function toQuarterThreshold(value: number): QuarterThreshold {
  const clamped = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (Math.floor(clamped / 25) * 25) as QuarterThreshold;
}

function stepStatus(
  completionPercent: number | null,
  override?: WorkbenchPathStep['status'],
): WorkbenchPathStep['status'] {
  if (override) return override;
  if (completionPercent === null) return 'not_started';
  if (completionPercent >= 100) return 'completed';
  if (completionPercent > 0) return 'in_progress';
  return 'not_started';
}

function modelCompletion(run: V3ProcessRun | undefined): number | null {
  if (!run) return null;
  switch (run.status) {
    case 'queued': return 0;
    case 'running': return 25;
    case 'partial': return 50;
    case 'needs_input': return 75;
    case 'ready_for_gate':
    case 'completed':
    case 'failed':
      return 100;
    case 'superseded': return null;
  }
}

function runCompletionStatus(run: V3ProcessRun | undefined, hasGate: boolean) {
  if (hasGate || run?.status === 'completed') return 'completed' as const;
  if (run && run.status !== 'queued' && run.status !== 'superseded') return 'in_progress' as const;
  return 'not_started' as const;
}

function humanGateStatus(receipt: V3Receipt | undefined) {
  if (!receipt) return 'not_recorded' as const;
  if (receipt.status === 'confirm') return 'confirmed' as const;
  if (receipt.status === 'reject') return 'rejected' as const;
  return 'returned_for_evidence' as const;
}

function humanGateResult(receipt: V3Receipt | undefined): string {
  if (!receipt) return MISSING;
  if (receipt.status === 'confirm') return '已确认';
  if (receipt.status === 'reject') return '已拒绝';
  if (receipt.status === 'return_for_evidence') return '已退回补证';
  return MISSING;
}

function latestRun(snapshot: SharedWorkbenchSnapshot, perspective: ProfessionalPerspective) {
  if (!snapshot.currentContext) return undefined;
  return snapshot.processRuns
    .filter((run) =>
      run.processId === perspective &&
      run.boundContextVersion === snapshot.currentContext?.contextVersion &&
      run.status !== 'superseded')
    .at(-1);
}

function latestGateReceipt(snapshot: SharedWorkbenchSnapshot, perspective: ProfessionalPerspective) {
  if (!snapshot.currentContext) return undefined;
  return snapshot.receipts
    .filter((receipt) =>
      receipt.receiptType === 'human_gate' &&
      receipt.processId === perspective &&
      receipt.contextVersion === snapshot.currentContext?.contextVersion)
    .at(-1);
}

function latestSharedGateReceipt(snapshot: SharedWorkbenchSnapshot, perspective: ProfessionalPerspective) {
  return snapshot.sharedReceipts
    ?.filter((receipt) => receipt.receiptType === 'human_gate' && receipt.payload.processId === perspective)
    .at(-1);
}

function evidenceSources(
  snapshot: SharedWorkbenchSnapshot,
  perspective: ProfessionalPerspective,
): Array<WorkbenchEvidenceSource> {
  const receipts = snapshot.receipts.filter((receipt) =>
    receipt.receiptType === 'evidence' && receipt.processId === perspective);
  return PROFESSIONAL_SPECS[perspective].evidenceRequirements.map((requirement, index) => {
    const receipt = receipts[index];
    return {
      ...requirement,
      availability: receipt ? 'available' : 'missing',
      sourceRef: receipt && typeof receipt.details.sourceRef === 'string'
        ? receipt.details.sourceRef
        : MISSING,
      evidenceReceiptId: receipt?.receiptId ?? null,
    };
  });
}

function latestModelResult(
  snapshot: SharedWorkbenchSnapshot,
  run: V3ProcessRun | undefined,
): string {
  if (!run) return MISSING;
  const event = snapshot.events
    .filter((item) =>
      item.type === 'PROCESS_RUN_STATUS_CHANGED' &&
      item.payload.runId === run.runId &&
      typeof item.payload.summary === 'string')
    .at(-1);
  if (event && typeof event.payload.summary === 'string') return event.payload.summary;
  return `候选状态：${run.status}`;
}

function makeRollup(path: Array<WorkbenchPathStep>): WorkbenchRollup {
  const provided = path.flatMap((step) => step.completionPercent === null ? [] : [step.completionPercent]);
  const continuousPercent = provided.length === 0
    ? null
    : clampPercent(provided.reduce((total, value) => total + value, 0) / provided.length);
  return {
    continuousPercent,
    quarterThreshold: continuousPercent === null ? null : toQuarterThreshold(continuousPercent),
    completedStepCount: path.filter((step) => step.completionPercent !== null && step.completionPercent >= 100).length,
    totalStepCount: 4,
    weightPercent: 25,
    weightedContribution: continuousPercent === null ? null : clampPercent(continuousPercent * 0.25),
  };
}

function buildProfessionalProjection(
  snapshot: SharedWorkbenchSnapshot,
  perspective: ProfessionalPerspective,
): WorkbenchProfessionalProjection {
  const spec = PROFESSIONAL_SPECS[perspective];
  const run = latestRun(snapshot, perspective);
  const gateReceipt = latestGateReceipt(snapshot, perspective);
  const sharedGateReceipt = latestSharedGateReceipt(snapshot, perspective);
  const sources = evidenceSources(snapshot, perspective);
  const sharedProgress = snapshot.sharedCase?.backendProgress[perspective] ?? null;
  const availableEvidenceCount = sources.filter((source) => source.availability === 'available').length;
  const materialCompletion = sharedProgress === null
    ? run || availableEvidenceCount > 0
      ? clampPercent(Math.max(
          run ? run.evidenceCoverageBand * 25 : 0,
          (availableEvidenceCount / sources.length) * 100,
        ))
      : null
    : clampPercent(sharedProgress * 4);
  const ruleCompletion = sharedProgress === null
    ? run ? clampPercent(run.readinessBand * 25) : null
    : clampPercent((sharedProgress - 25) * 4);
  const modelProgress = sharedProgress === null ? modelCompletion(run) : clampPercent((sharedProgress - 50) * 4);
  const candidateResult = sharedProgress === null
    ? latestModelResult(snapshot, run)
    : `shared backend progress ${sharedProgress}；模型结果未提供`;
  const sharedDecision = sharedGateReceipt?.payload.decision;
  const gateResult = sharedDecision === 'confirm' ? '已确认'
    : sharedDecision === 'reject' ? '已拒绝'
      : sharedDecision === 'return_for_evidence' ? '已退回补证'
        : humanGateResult(gateReceipt);
  const hasGate = Boolean(gateReceipt || sharedGateReceipt);
  const contextVersion = snapshot.currentContext?.contextVersion ?? null;
  const path: Array<WorkbenchPathStep> = [
    {
      stepId: 'material',
      label: '材料',
      completionPercent: materialCompletion,
      status: stepStatus(materialCompletion),
      result: sources.some((source) => source.availability === 'available')
        ? `已接收 ${sources.filter((source) => source.availability === 'available').length} 项具名 Evidence`
        : MISSING,
      authority: 'none',
      contextVersion,
      receiptId: null,
    },
    {
      stepId: 'rule',
      label: '规则',
      completionPercent: ruleCompletion,
      status: stepStatus(ruleCompletion, run?.status === 'failed' ? 'failed' : undefined),
      result: run && run.riskBand !== 'unknown' ? `候选规则结果：${run.riskBand}` : MISSING,
      authority: 'none',
      contextVersion,
      receiptId: null,
    },
    {
      stepId: 'model',
      label: '模型',
      completionPercent: modelProgress,
      status: stepStatus(
        modelProgress,
        run?.status === 'failed' ? 'failed' : run?.status === 'needs_input' ? 'blocked' : undefined,
      ),
      result: candidateResult,
      authority: 'none',
      contextVersion,
      receiptId: null,
    },
    {
      stepId: 'human',
      label: '人审',
      completionPercent: hasGate ? 100 : null,
      status: hasGate ? 'completed' : 'not_started',
      result: gateResult,
      authority: hasGate ? 'confirmed_human' : 'none',
      contextVersion: gateReceipt?.contextVersion ?? (typeof sharedGateReceipt?.payload.contextVersion === 'string' ? sharedGateReceipt.payload.contextVersion : contextVersion),
      receiptId: gateReceipt?.receiptId ?? sharedGateReceipt?.receiptId ?? null,
    },
  ];
  const rollup = makeRollup(path);
  return {
    perspective,
    label: spec.label,
    quadrant: spec.quadrant,
    principalId: spec.principalId,
    readOnly: snapshot.caseItem.readOnly,
    runId: run?.runId ?? null,
    runStatus: run?.status ?? (sharedProgress === null ? 'not_started' : sharedProgress >= 100 ? 'completed' : 'running'),
    completionStatus: hasGate ? 'completed' : sharedProgress === null ? runCompletionStatus(run, false) : sharedProgress >= 100 ? 'completed' : sharedProgress > 0 ? 'in_progress' : 'not_started',
    result: hasGate ? gateResult : candidateResult,
    authority: hasGate ? 'confirmed_human' : 'none',
    professionalContent: {
      ruleName: spec.ruleName,
      rulePurpose: spec.rulePurpose,
      modelTask: spec.modelTask,
      humanGateLabel: spec.humanGateLabel,
    },
    modelCandidate: { result: candidateResult, authority: 'none' },
    humanGate: {
      status: sharedDecision === 'confirm' ? 'confirmed' : sharedDecision === 'reject' ? 'rejected' : sharedDecision === 'return_for_evidence' ? 'returned_for_evidence' : humanGateStatus(gateReceipt),
      result: gateResult,
      contextVersion: gateReceipt?.contextVersion ?? (typeof sharedGateReceipt?.payload.contextVersion === 'string' ? sharedGateReceipt.payload.contextVersion : null),
      receiptId: gateReceipt?.receiptId ?? sharedGateReceipt?.receiptId ?? null,
      principalId: gateReceipt?.principalId ?? (typeof sharedGateReceipt?.payload.principalId === 'string' ? sharedGateReceipt.payload.principalId : null),
      authority: hasGate ? 'confirmed_human' : 'none',
    },
    evidenceSources: sources,
    path,
    rollup,
  };
}

function chatEntries(snapshot: SharedWorkbenchSnapshot) {
  if (snapshot.sharedMessages) {
    return snapshot.sharedMessages.map((message) => ({
      eventId: snapshot.sharedEvents?.find((event) => event.payload.messageId === message.messageId)?.eventId ?? message.messageId,
      principalId: message.actorRole,
      processId: message.actorKind === 'agent' ? String(message.actorRole) : null,
      message: message.text,
      contextVersion: message.contextVersion,
      authority: 'none' as const,
    }));
  }
  return snapshot.events
    .filter((event) => event.type === 'MESSAGE_RECEIVED' && typeof event.payload.message === 'string')
    .map((event) => ({
      eventId: event.eventId,
      principalId: event.actor.principalId,
      processId: typeof event.payload.processId === 'string' ? event.payload.processId : null,
      message: event.payload.message as string,
      contextVersion: event.contextVersion ?? null,
      authority: 'none' as const,
    }));
}

export function projectWorkbenchReadModel(
  snapshot: SharedWorkbenchSnapshot,
  session: WorkbenchSession,
  defaultPerspective: WorkbenchPerspective,
  integration: SharedWorkbenchAdapter['integration'],
): WorkbenchReadModel {
  const professionalProjections = Object.fromEntries(
    PROFESSIONAL_PERSPECTIVES.map((perspective) => [
      perspective,
      buildProfessionalProjection(snapshot, perspective),
    ]),
  ) as WorkbenchReadModel['professionalProjections'];
  const contributions = PROFESSIONAL_PERSPECTIVES.flatMap((perspective) => {
    const value = professionalProjections[perspective].rollup.weightedContribution;
    return value === null ? [] : [value];
  });
  const continuousPercent = contributions.length === 0
    ? null
    : clampPercent(contributions.reduce((total, value) => total + value, 0));
  const asOf = [
    snapshot.sharedMessages?.at(-1)?.createdAt,
    snapshot.sharedEvents?.at(-1)?.createdAt,
    snapshot.sharedReceipts?.at(-1)?.createdAt,
    snapshot.events.at(-1)?.recordedAt,
  ].filter((value): value is string => Boolean(value)).sort().at(-1) ?? MISSING;
  const writablePerspectives: Array<WorkbenchPerspective> = snapshot.caseItem.readOnly
    ? []
    : session.principalId === 'business-owner'
      ? ['business']
      : PROFESSIONAL_PERSPECTIVES.filter((perspective) =>
          PROFESSIONAL_SPECS[perspective].principalId === session.principalId);
  return {
    schemaVersion: 'v3-case-workbench-1',
    businessItemType: 'FinancingLeasingCase',
    caseId: snapshot.caseItem.caseId,
    caseTier: snapshot.caseItem.caseTier,
    readOnly: snapshot.caseItem.readOnly,
    defaultPerspective,
    runtimeEpoch: snapshot.runtimeEpoch,
    contextVersion: snapshot.currentContext?.contextVersion ?? null,
    provenance: {
      source: snapshot.sharedCase ? 'shared-v3-sqlite' : 'scenario-background-read-model',
      dataClass: 'synthetic_deidentified_demo',
      asOf,
      runtimeEpoch: snapshot.runtimeEpoch,
      contextVersion: snapshot.currentContext?.contextVersion ?? null,
    },
    roleProjection: {
      principalId: session.principalId,
      roleApplicationId: session.roleApplicationId,
      visiblePerspectives: ['business', ...PROFESSIONAL_PERSPECTIVES],
      writablePerspectives,
    },
    caseContext: {
      title: snapshot.caseItem.title,
      counterparty: snapshot.caseItem.counterparty,
      industry: snapshot.caseItem.industry,
      region: snapshot.caseItem.region,
      amount: snapshot.caseItem.amount,
      lifecycleStatus: snapshot.caseItem.lifecycleStatus,
      phase: snapshot.caseItem.phase,
      nextMilestone: snapshot.caseItem.nextMilestone,
    },
    businessOverview: {
      ownerPrincipalId: 'business-owner',
      professionalWeightPercent: 25,
      continuousPercent,
      quarterThreshold: continuousPercent === null ? null : toQuarterThreshold(continuousPercent),
      allowedActions: session.principalId === 'business-owner' && !snapshot.caseItem.readOnly
        ? [...BUSINESS_ACTION_TYPES]
        : [],
      professionalQuadrants: { ...PROFESSIONAL_QUADRANTS },
    },
    professionalProjections,
    currentChatContext: {
      threadId: `${snapshot.caseItem.caseId}-INTERNAL`,
      receiptIds: snapshot.sharedReceipts?.map((receipt) => receipt.receiptId) ?? [],
      candidateIds: snapshot.sharedMessages?.filter((message) => message.actorKind === 'agent').map((message) => message.messageId) ?? [],
      entries: chatEntries(snapshot),
    },
    integration: structuredClone(integration),
  };
}
