import type {
  AcquisitionSource,
  BusinessMode,
  DueDiligenceMode,
  ReviewPath,
  V4AttemptReceipt,
  V4AuthorizedRule,
  V4Candidate,
  V4Case,
  V4CaseClassification,
  V4Decision,
  V4DecisionAction,
  V4DecisionCommand,
  V4DecisionReceipt,
  V4LifecycleState,
  V4NamedActor,
  V4ResubmissionReceipt,
  V4SupplementRequest,
  V4TransitionResult,
} from './types.ts';

const BUSINESS_MODES: ReadonlySet<BusinessMode> = new Set([
  'direct',
  'existing_return',
  'new_return',
]);
const ACQUISITION_SOURCES: ReadonlySet<AcquisitionSource> = new Set([
  'supplier_referral',
  'existing_contract_list',
  'market_acquisition',
  'relationship_maintenance',
  'other',
]);
const REVIEW_PATHS: ReadonlySet<ReviewPath> = new Set(['standard', 'exception']);
const DUE_DILIGENCE_MODES: ReadonlySet<DueDiligenceMode> = new Set([
  'business_site',
  'joint_business_credit_site',
  'remote_plus_site',
]);

export class V4DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'V4DomainError';
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new V4DomainError(code, message);
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) fail('INVALID_INPUT', `${field} 无效`);
  return value.trim();
}

function nonEmptyList(values: string[], field: string): string[] {
  if (!Array.isArray(values) || values.length === 0) fail('INVALID_INPUT', `${field} 不能为空`);
  const normalized = values.map((value) => nonEmpty(value, field));
  if (new Set(normalized).size !== normalized.length) fail('INVALID_INPUT', `${field} 不能重复`);
  return normalized;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function validateV4CaseClassification(
  classification: V4CaseClassification,
): V4CaseClassification {
  if (!classification || typeof classification !== 'object') {
    fail('INVALID_CLASSIFICATION', 'Case classification 无效');
  }
  if (!BUSINESS_MODES.has(classification.businessMode)) {
    fail('INVALID_CLASSIFICATION', 'businessMode 无效');
  }
  if (!ACQUISITION_SOURCES.has(classification.acquisitionSource)) {
    fail('INVALID_CLASSIFICATION', 'acquisitionSource 无效');
  }
  if (!REVIEW_PATHS.has(classification.reviewPath)) {
    fail('INVALID_CLASSIFICATION', 'reviewPath 无效');
  }
  if (!DUE_DILIGENCE_MODES.has(classification.dueDiligenceMode)) {
    fail('INVALID_CLASSIFICATION', 'dueDiligenceMode 无效');
  }
  if (
    classification.businessMode === 'new_return' &&
    classification.dueDiligenceMode !== 'joint_business_credit_site'
  ) {
    fail('DUE_DILIGENCE_CONSTRAINT_VIOLATION', '新回需要支持业务与信审共同现场尽调');
  }
  return clone(classification);
}

export function createV4Case(input: {
  caseId: string;
  attemptId: string;
  contextVersion: string;
  classification: V4CaseClassification;
}): V4Case {
  const caseId = nonEmpty(input.caseId, 'caseId');
  const attemptId = nonEmpty(input.attemptId, 'attemptId');
  const contextVersion = nonEmpty(input.contextVersion, 'contextVersion');
  return {
    caseId,
    attemptId,
    classification: validateV4CaseClassification(input.classification),
    lifecycle: {
      creditStatus: 'rule_screening',
      commercialStatus: 'not_started',
      assetStatus: 'not_started',
      commencementStatus: 'not_started',
    },
    currentStage: 'credit',
    contextVersion,
    authorityState: 'waiting',
    attemptLineage: {
      rootAttemptId: attemptId,
      previousAttemptId: null,
      sourceDecisionId: null,
      terminalDecisionId: null,
      inheritedEvidenceReceiptIds: [],
      status: 'active',
    },
  };
}

export function createV4P0LiveCell(input: {
  caseId: string;
  attemptId: string;
  contextVersion: string;
  acquisitionSource: AcquisitionSource;
  dueDiligenceMode: DueDiligenceMode;
}): V4Case {
  return createV4Case({
    caseId: input.caseId,
    attemptId: input.attemptId,
    contextVersion: input.contextVersion,
    classification: {
      businessMode: 'direct',
      acquisitionSource: input.acquisitionSource,
      reviewPath: 'exception',
      dueDiligenceMode: input.dueDiligenceMode,
    },
  });
}

export function createV4Candidate(input: Omit<V4Candidate, 'authoritySource' | 'authority'>): V4Candidate {
  return {
    candidateId: nonEmpty(input.candidateId, 'candidateId'),
    caseId: nonEmpty(input.caseId, 'caseId'),
    attemptId: nonEmpty(input.attemptId, 'attemptId'),
    contextVersion: nonEmpty(input.contextVersion, 'contextVersion'),
    modelVersion: nonEmpty(input.modelVersion, 'modelVersion'),
    rationale: nonEmpty(input.rationale, 'rationale'),
    evidenceReceiptIds: nonEmptyList(input.evidenceReceiptIds, 'evidenceReceiptIds'),
    authoritySource: 'candidate_model',
    authority: 'none',
  };
}

function assertCommandIdentity(current: V4Case, command: V4DecisionCommand): void {
  if (nonEmpty(command.caseId, 'caseId') !== current.caseId) {
    fail('CASE_ID_MISMATCH', '决定不属于当前 Case');
  }
  if (nonEmpty(command.attemptId, 'attemptId') !== current.attemptId) {
    fail('ATTEMPT_ID_MISMATCH', '决定不属于当前 attempt');
  }
  if (nonEmpty(command.contextVersion, 'contextVersion') !== current.contextVersion) {
    fail('STALE_CONTEXT', 'Context Version 已过期');
  }
  if (current.attemptLineage.status === 'terminated') {
    fail('ATTEMPT_TERMINATED', '当前 attempt 已终止');
  }
  if (current.attemptLineage.status === 'final') {
    fail('CASE_VETOED_FINAL', '当前 Case 已终局否决');
  }
}

function assertDecisionState(current: V4Case, action: V4DecisionAction): void {
  const status = current.lifecycle.creditStatus;
  const reviewable = new Set(['rule_screening', 'pending_human_review', 'resubmitted']);
  if (!reviewable.has(status)) {
    fail('INVALID_CREDIT_TRANSITION', `${status} 不能执行 ${action}`);
  }
  if (action !== 'approve_credit' && status === 'rule_screening') {
    fail('HUMAN_REVIEW_REQUIRED', '该动作需要先进入具名人工审查');
  }
}

function assertAuthorizedRule(
  rule: V4AuthorizedRule,
  current: V4Case,
  action: V4DecisionAction,
): { actorId: string; policyVersion: string } {
  const validMetadata =
    rule?.deterministic === true &&
    Boolean(rule.ruleId?.trim()) &&
    Boolean(rule.version?.trim()) &&
    Boolean(rule.scope?.scopeId?.trim()) &&
    Array.isArray(rule.scope?.businessModes) &&
    rule.scope.businessModes.length > 0 &&
    Array.isArray(rule.scope?.reviewPaths) &&
    rule.scope.reviewPaths.length > 0 &&
    Array.isArray(rule.scope?.actions) &&
    rule.scope.actions.length > 0 &&
    Boolean(rule.approval?.approvalId?.trim()) &&
    Boolean(rule.approval?.approvedByActorId?.trim()) &&
    !Number.isNaN(Date.parse(rule.approval?.approvedAt ?? '')) &&
    Boolean(rule.rollback?.rollbackId?.trim()) &&
    Boolean(rule.rollback?.previousVersion?.trim()) &&
    Boolean(rule.rollback?.procedureRef?.trim());
  if (!validMetadata) {
    fail('RULE_AUTHORIZATION_INVALID', '授权规则缺少 version、scope、approval 或 rollback 信息');
  }
  if (action !== 'approve_credit' || current.classification.reviewPath !== 'standard') {
    fail('RULE_SCOPE_DENIED', '授权规则不覆盖当前决定');
  }
  if (
    !rule.scope.businessModes.includes(current.classification.businessMode) ||
    !rule.scope.reviewPaths.includes(current.classification.reviewPath) ||
    !rule.scope.actions.includes('approve_credit')
  ) {
    fail('RULE_SCOPE_DENIED', '授权规则不覆盖当前 Case scope');
  }
  return { actorId: `rule:${rule.ruleId.trim()}`, policyVersion: rule.version.trim() };
}

function assertNamedActor(actor: V4NamedActor): V4NamedActor {
  return {
    actorId: nonEmpty(actor?.actorId, 'actor.actorId'),
    displayName: nonEmpty(actor?.displayName, 'actor.displayName'),
  };
}

function authorizeDecision(
  current: V4Case,
  command: V4DecisionCommand,
): Pick<V4Decision, 'authoritySource' | 'actorId' | 'policyVersion'> {
  if (command.authoritySource === 'candidate_model') {
    fail('CANDIDATE_HAS_NO_AUTHORITY', '模型或 Agent candidate 不能产生正式决定');
  }
  if (command.authoritySource === 'authorized_rule') {
    return {
      authoritySource: 'authorized_rule',
      ...assertAuthorizedRule(command.rule, current, command.action),
    };
  }

  const actor = assertNamedActor(command.actor);
  let evaluation: ReturnType<typeof command.policy>;
  try {
    evaluation = command.policy({ actor, action: command.action, case: clone(current) });
  } catch {
    fail('POLICY_FAILURE', '权限 policy 执行失败');
  }
  if (!evaluation || typeof evaluation !== 'object') {
    fail('POLICY_UNKNOWN', '权限 policy 未返回可识别结果');
  }
  if (evaluation.outcome === 'allowed' && !evaluation.policyVersion?.trim()) {
    fail('POLICY_UNKNOWN', '权限 policy 缺少版本');
  }
  const policyVersion = evaluation.policyVersion?.trim() ?? '';
  if (evaluation.outcome !== 'allowed') {
    const codes = {
      denied: 'ACTION_SCOPE_DENIED',
      failure: 'POLICY_FAILURE',
      timeout: 'POLICY_TIMEOUT',
      unknown: 'POLICY_UNKNOWN',
    } as const;
    fail(codes[evaluation.outcome] ?? 'POLICY_UNKNOWN', '权限 policy 未明确允许当前动作');
  }
  return {
    authoritySource: 'confirmed_human',
    actorId: actor.actorId,
    policyVersion,
  };
}

function normalizeSupplementRequest(
  action: V4DecisionAction,
  value: V4SupplementRequest | undefined,
): V4SupplementRequest | null {
  if (action !== 'return_for_supplement') {
    if (value !== undefined) fail('INVALID_INPUT', '当前动作不能携带 supplementRequest');
    return null;
  }
  if (!value) fail('SUPPLEMENT_REQUEST_REQUIRED', '退回必须说明补充要求、责任人、截止时间和 Evidence lineage');
  const dueAt = nonEmpty(value.dueAt, 'supplementRequest.dueAt');
  if (Number.isNaN(Date.parse(dueAt))) fail('INVALID_INPUT', 'supplementRequest.dueAt 无效');
  return {
    requiredItems: nonEmptyList(value.requiredItems, 'supplementRequest.requiredItems'),
    ownerActorId: nonEmpty(value.ownerActorId, 'supplementRequest.ownerActorId'),
    dueAt,
    evidenceLineage: nonEmptyList(value.evidenceLineage, 'supplementRequest.evidenceLineage'),
  };
}

function nextCreditStatus(
  action: V4DecisionAction,
  authoritySource: V4Decision['authoritySource'],
): V4LifecycleState['creditStatus'] {
  if (action === 'approve_credit') {
    return authoritySource === 'authorized_rule' ? 'approved_by_rule' : 'approved_by_human';
  }
  if (action === 'return_for_supplement') return 'returned_for_supplement';
  if (action === 'reject_current_attempt') return 'rejected_current_attempt';
  return 'vetoed_final';
}

export function applyV4CreditDecision(
  currentInput: V4Case,
  command: V4DecisionCommand,
): V4TransitionResult<V4DecisionReceipt> {
  const current = clone(currentInput);
  assertCommandIdentity(current, command);
  assertDecisionState(current, command.action);
  const evidenceReceiptIds = nonEmptyList(command.evidenceReceiptIds, 'evidenceReceiptIds');
  const rationale = nonEmpty(command.rationale, 'rationale');
  const supplementRequest = normalizeSupplementRequest(command.action, command.supplementRequest);
  const authority = authorizeDecision(current, command);
  const decision: V4Decision = {
    decisionId: nonEmpty(command.decisionId, 'decisionId'),
    caseId: current.caseId,
    attemptId: current.attemptId,
    contextVersion: current.contextVersion,
    action: command.action,
    ...authority,
    rationale,
    evidenceReceiptIds,
    supplementRequest,
  };
  const lifecycle: V4LifecycleState = {
    ...current.lifecycle,
    creditStatus: nextCreditStatus(command.action, authority.authoritySource),
  };
  const terminalDecisionId = command.action === 'reject_current_attempt' || command.action === 'veto_final'
    ? decision.decisionId
    : current.attemptLineage.terminalDecisionId;
  const attemptStatus = command.action === 'reject_current_attempt'
    ? 'terminated'
    : command.action === 'veto_final'
      ? 'final'
      : current.attemptLineage.status;
  const next: V4Case = {
    ...current,
    lifecycle,
    authorityState: 'decided',
    attemptLineage: {
      ...current.attemptLineage,
      terminalDecisionId,
      status: attemptStatus,
    },
  };
  return {
    case: next,
    receipt: {
      receiptId: nonEmpty(command.receiptId, 'receiptId'),
      receiptType: 'credit_decision',
      caseId: current.caseId,
      attemptId: current.attemptId,
      contextVersion: current.contextVersion,
      status: 'succeeded',
      decision,
      resultingLifecycle: clone(lifecycle),
    },
  };
}

export function markV4PendingHumanReview(currentInput: V4Case): V4Case {
  const current = clone(currentInput);
  if (current.attemptLineage.status !== 'active' || current.lifecycle.creditStatus !== 'rule_screening') {
    fail('INVALID_CREDIT_TRANSITION', '当前 Case 不能进入人工审查');
  }
  return {
    ...current,
    lifecycle: { ...current.lifecycle, creditStatus: 'pending_human_review' },
    authorityState: 'gate_required',
  };
}

export function resubmitV4Supplement(input: {
  current: V4Case;
  expectedContextVersion: string;
  newContextVersion: string;
  actor: V4NamedActor;
  evidenceReceiptIds: string[];
  receiptId: string;
}): V4TransitionResult<V4ResubmissionReceipt> {
  const current = clone(input.current);
  if (nonEmpty(input.expectedContextVersion, 'expectedContextVersion') !== current.contextVersion) {
    fail('STALE_CONTEXT', 'Context Version 已过期');
  }
  if (current.lifecycle.creditStatus !== 'returned_for_supplement' || current.attemptLineage.status !== 'active') {
    fail('INVALID_CREDIT_TRANSITION', '只有退回补证中的 active attempt 可以重新提交');
  }
  const actor = assertNamedActor(input.actor);
  const contextVersion = nonEmpty(input.newContextVersion, 'newContextVersion');
  if (contextVersion === current.contextVersion) fail('INVALID_INPUT', '重新提交必须形成新的 Context Version');
  const evidenceReceiptIds = nonEmptyList(input.evidenceReceiptIds, 'evidenceReceiptIds');
  return {
    case: {
      ...current,
      contextVersion,
      lifecycle: { ...current.lifecycle, creditStatus: 'resubmitted' },
      authorityState: 'gate_required',
    },
    receipt: {
      receiptId: nonEmpty(input.receiptId, 'receiptId'),
      receiptType: 'supplement_resubmitted',
      caseId: current.caseId,
      attemptId: current.attemptId,
      previousContextVersion: current.contextVersion,
      contextVersion,
      actorId: actor.actorId,
      evidenceReceiptIds,
      status: 'succeeded',
    },
  };
}

export function startV4AttemptAfterRejection(input: {
  current: V4Case;
  newAttemptId: string;
  newContextVersion: string;
  sourceDecisionId: string;
  inheritedEvidenceReceiptIds: string[];
  receiptId: string;
}): V4TransitionResult<V4AttemptReceipt> {
  const current = clone(input.current);
  if (current.attemptLineage.status === 'final' || current.lifecycle.creditStatus === 'vetoed_final') {
    fail('CASE_VETOED_FINAL', '终局否决后不能创建新 attempt');
  }
  if (
    current.attemptLineage.status !== 'terminated' ||
    current.lifecycle.creditStatus !== 'rejected_current_attempt'
  ) {
    fail('ATTEMPT_NOT_REJECTED', '只有被驳回的当前 attempt 可以重新发起');
  }
  const sourceDecisionId = nonEmpty(input.sourceDecisionId, 'sourceDecisionId');
  if (sourceDecisionId !== current.attemptLineage.terminalDecisionId) {
    fail('DECISION_LINEAGE_MISMATCH', '新 attempt 必须引用终止原 attempt 的决定');
  }
  const attemptId = nonEmpty(input.newAttemptId, 'newAttemptId');
  if (attemptId === current.attemptId) fail('ATTEMPT_ID_CONFLICT', '新 attemptId 必须不同');
  const contextVersion = nonEmpty(input.newContextVersion, 'newContextVersion');
  if (contextVersion === current.contextVersion) fail('INVALID_INPUT', '新 attempt 必须形成新的 Context Version');
  const inheritedEvidenceReceiptIds = nonEmptyList(
    input.inheritedEvidenceReceiptIds,
    'inheritedEvidenceReceiptIds',
  );
  const next: V4Case = {
    ...current,
    attemptId,
    contextVersion,
    lifecycle: {
      creditStatus: 'rule_screening',
      commercialStatus: 'not_started',
      assetStatus: 'not_started',
      commencementStatus: 'not_started',
    },
    currentStage: 'credit',
    authorityState: 'waiting',
    attemptLineage: {
      rootAttemptId: current.attemptLineage.rootAttemptId,
      previousAttemptId: current.attemptId,
      sourceDecisionId,
      terminalDecisionId: null,
      inheritedEvidenceReceiptIds,
      status: 'active',
    },
  };
  return {
    case: next,
    receipt: {
      receiptId: nonEmpty(input.receiptId, 'receiptId'),
      receiptType: 'attempt_started',
      caseId: current.caseId,
      previousAttemptId: current.attemptId,
      attemptId,
      sourceDecisionId,
      contextVersion,
      inheritedEvidenceReceiptIds: [...inheritedEvidenceReceiptIds],
      status: 'succeeded',
    },
  };
}
