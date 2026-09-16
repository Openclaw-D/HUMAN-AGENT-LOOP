import {
  authorizeV3Action,
  getV3PrincipalPolicy,
  type V3CanonicalPrincipalId,
  type V3InvitationScope,
  type V3ProcessId,
  type V3PrincipalId,
  type V3RoleApplicationId,
} from './v3-role-authority.ts';

export type V3TransitionCode = 'BASELINE' | 'T1' | 'T2' | 'T3';
export type V3ProcessRunStatus =
  | 'queued'
  | 'running'
  | 'partial'
  | 'needs_input'
  | 'ready_for_gate'
  | 'completed'
  | 'failed'
  | 'superseded';

export type V3RuntimeScenario = {
  scenarioRef: {
    scenarioId: string;
    scenarioVersion: string;
    seed: string;
    businessItemType: 'FinancingLeasingCase';
    caseId: string;
    leaseMode: 'direct-lease';
    dataClass: 'synthetic_deidentified_demo';
  };
  cases: Array<{
    caseId: string;
    caseTier: 'golden' | 'background';
    readOnly: boolean;
    commencementBand: 0 | 1 | 2 | 3 | 4 | 5;
    lifecycleStatus: string;
  }>;
  processIds: Array<V3ProcessId>;
};

export type V3ContextRef = {
  runtimeEpoch: string;
  contextSeq: number;
  contextVersion: string;
  previousContextVersion: string | null;
  transitionCode: V3TransitionCode;
  diffId: string;
  sourceReceiptIds: Array<string>;
};

export type V3ProcessRun = {
  runId: string;
  caseId: string;
  processId: V3ProcessId;
  boundContextVersion: string;
  sourceEventId: string;
  status: V3ProcessRunStatus;
  readinessBand: 0 | 1 | 2 | 3 | 4;
  riskBand: 'unknown' | 'low' | 'medium' | 'high';
  evidenceCoverageBand: 0 | 1 | 2 | 3 | 4;
  gateState: 'not_ready' | 'ready' | 'confirmed' | 'rejected' | 'returned_for_evidence';
  supersededByContextVersion?: string;
  startedAt?: string;
  updatedAt: string;
};

export type V3AuthorityEvent = {
  eventId: string;
  runtimeEpoch: string;
  sequence: number;
  caseId: string;
  scenarioVersion: string;
  type:
    | 'SCENARIO_BASELINE_INITIALIZED'
    | 'EVIDENCE_ACCEPTED'
    | 'CONTEXT_COMMIT_RECORDED'
    | 'PROCESS_RUNS_SUPERSEDED'
    | 'PROCESS_RUNS_TRIGGERED'
    | 'PROCESS_RUN_STATUS_CHANGED'
    | 'HUMAN_GATE_RECORDED'
    | 'MANAGEMENT_ACTION_RECORDED'
    | 'LEASE_COMMENCEMENT_RECORDED'
    | 'MESSAGE_RECEIVED';
  actor: {
    principalId: string;
    roleApplicationId: V3RoleApplicationId | 'system';
    authority: 'confirmed' | 'none';
  };
  correlationId: string;
  causationId: string | null;
  contextVersion?: string;
  recordedAt: string;
  payload: Record<string, unknown>;
};

export type V3Receipt = {
  receiptId: string;
  receiptType: 'evidence' | 'context_commit' | 'human_gate' | 'management_action' | 'commencement';
  eventId: string;
  caseId: string;
  contextVersion: string;
  principalId: string;
  processId?: V3ProcessId;
  actionType?: string;
  invitationId?: string;
  status: string;
  evidenceReceiptIds: Array<string>;
  recordedAt: string;
  details: Record<string, unknown>;
};

type RuntimeOptions = {
  scenario: V3RuntimeScenario;
  requiredCommencementGateProcesses?: Array<'policy' | 'credit' | 'commercial' | 'asset'>;
  now?: () => string;
  runtimeEpochFactory?: () => string;
};

type ActorInput = {
  principalId: V3PrincipalId;
  roleApplicationId: V3RoleApplicationId;
  invitation?: V3InvitationScope;
};

const REQUIRED_PROCESS_IDS: Array<V3ProcessId> = [
  'opportunity',
  'policy',
  'credit',
  'commercial',
  'asset',
];

const PROCESS_TRANSITIONS: Record<V3ProcessRunStatus, ReadonlySet<V3ProcessRunStatus>> = {
  queued: new Set(['running', 'failed', 'superseded']),
  running: new Set(['partial', 'needs_input', 'ready_for_gate', 'completed', 'failed', 'superseded']),
  partial: new Set(['running', 'needs_input', 'ready_for_gate', 'completed', 'failed', 'superseded']),
  needs_input: new Set(['running', 'partial', 'ready_for_gate', 'failed', 'superseded']),
  ready_for_gate: new Set(['completed', 'needs_input', 'failed', 'superseded']),
  completed: new Set(['superseded']),
  failed: new Set(['superseded']),
  superseded: new Set(),
};

function failure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function contextVersion(sequence: number): string {
  return `CTX-${String(sequence).padStart(4, '0')}`;
}

function validateScenario(scenario: V3RuntimeScenario): void {
  if (scenario.scenarioRef.businessItemType !== 'FinancingLeasingCase') {
    throw failure('INVALID_SCENARIO', '业务事项类型无效');
  }
  if (new Set(scenario.processIds).size !== REQUIRED_PROCESS_IDS.length) {
    throw failure('INVALID_SCENARIO', '五路定义无效');
  }
  for (const processId of REQUIRED_PROCESS_IDS) {
    if (!scenario.processIds.includes(processId)) throw failure('INVALID_SCENARIO', '五路定义无效');
  }
  const golden = scenario.cases.filter((item) => item.caseId === scenario.scenarioRef.caseId);
  if (golden.length !== 1 || golden[0].caseTier !== 'golden' || golden[0].readOnly) {
    throw failure('INVALID_SCENARIO', 'Golden Case 定义无效');
  }
  for (const item of scenario.cases) {
    if (item.caseTier === 'background' && !item.readOnly) {
      throw failure('INVALID_SCENARIO', '背景事项必须只读');
    }
    if (['active_lease', 'closed', 'active-lease'].includes(item.lifecycleStatus) && item.commencementBand !== 5) {
      throw failure('INVALID_SCENARIO', '已起租事项必须保持起租完成');
    }
  }
}

export function createV3AuthorityRuntime(options: RuntimeOptions) {
  validateScenario(options.scenario);
  const scenario = clone(options.scenario);
  const now = options.now ?? (() => new Date().toISOString());
  let epochSequence = 0;
  const makeEpoch = options.runtimeEpochFactory ?? (() => `RUNTIME-${String(++epochSequence).padStart(4, '0')}`);
  const requiredGateProcesses = options.requiredCommencementGateProcesses ?? ['policy', 'credit', 'commercial'];

  let runtimeEpoch = '';
  let eventSequence = 0;
  let receiptSequence = 0;
  let runSequence = 0;
  let diffSequence = 0;
  let events: Array<V3AuthorityEvent> = [];
  let receipts = new Map<string, V3Receipt>();
  let contexts: Array<V3ContextRef> = [];
  let runs = new Map<string, V3ProcessRun>();
  let currentRunIds = new Map<V3ProcessId, string>();
  let idempotency = new Map<string, { signature: string; result: unknown }>();
  let evidenceIdentity = new Map<string, { signature: string; receipt: V3Receipt }>();
  let commencement = {
    band: 0 as 0 | 1 | 2 | 3 | 4 | 5,
    status: 'pre_commencement' as 'pre_commencement' | 'commenced',
    lifecycleStatus: 'pre_commencement',
    conditionSetVersion: 'DIRECT-LEASE-DEMO-1',
    commencementReceiptId: null as string | null,
  };

  function currentContext(): V3ContextRef {
    const value = contexts.at(-1);
    if (!value) throw failure('RUNTIME_NOT_INITIALIZED', '运行时尚未初始化');
    return value;
  }

  function appendEvent(input: Omit<V3AuthorityEvent, 'eventId' | 'runtimeEpoch' | 'sequence' | 'scenarioVersion' | 'recordedAt'>): V3AuthorityEvent {
    const event: V3AuthorityEvent = {
      ...clone(input),
      eventId: `${runtimeEpoch}-EVT-${String(++eventSequence).padStart(4, '0')}`,
      runtimeEpoch,
      sequence: eventSequence,
      scenarioVersion: scenario.scenarioRef.scenarioVersion,
      recordedAt: now(),
    };
    events.push(event);
    return clone(event);
  }

  function makeReceipt(input: Omit<V3Receipt, 'receiptId' | 'recordedAt'>): V3Receipt {
    const receipt: V3Receipt = {
      ...clone(input),
      receiptId: `${runtimeEpoch}-RCP-${String(++receiptSequence).padStart(4, '0')}`,
      recordedAt: now(),
    };
    receipts.set(receipt.receiptId, receipt);
    return clone(receipt);
  }

  function canonicalActor(actor: ActorInput) {
    const policy = getV3PrincipalPolicy(actor.principalId);
    if (policy.roleApplicationId !== actor.roleApplicationId) {
      throw failure('ROLE_PRINCIPAL_MISMATCH', '角色应用与主体不匹配');
    }
    return policy;
  }

  function replayOrConflict<T>(scope: string, requestId: unknown, payload: unknown): T | null {
    const normalizedRequestId = trimmed(requestId);
    if (!normalizedRequestId) throw failure('INVALID_INPUT', 'requestId 无效');
    const key = `${runtimeEpoch}:${scope}:${normalizedRequestId}`;
    const signature = stableJson(payload);
    const existing = idempotency.get(key);
    if (!existing) return null;
    if (existing.signature !== signature) throw failure('IDEMPOTENCY_CONFLICT', '同一 requestId 的载荷不一致');
    return clone(existing.result) as T;
  }

  function remember<T>(scope: string, requestId: string, payload: unknown, result: T): T {
    idempotency.set(`${runtimeEpoch}:${scope}:${requestId.trim()}`, {
      signature: stableJson(payload),
      result: clone(result),
    });
    return clone(result);
  }

  function reset() {
    runtimeEpoch = makeEpoch();
    if (!trimmed(runtimeEpoch)) throw failure('INVALID_RUNTIME_EPOCH', 'runtime epoch 无效');
    eventSequence = 0;
    receiptSequence = 0;
    runSequence = 0;
    diffSequence = 0;
    events = [];
    receipts = new Map();
    contexts = [];
    runs = new Map();
    currentRunIds = new Map();
    idempotency = new Map();
    evidenceIdentity = new Map();
    commencement = {
      band: 0,
      status: 'pre_commencement',
      lifecycleStatus: 'pre_commencement',
      conditionSetVersion: 'DIRECT-LEASE-DEMO-1',
      commencementReceiptId: null,
    };
    const baseline: V3ContextRef = {
      runtimeEpoch,
      contextSeq: 0,
      contextVersion: contextVersion(0),
      previousContextVersion: null,
      transitionCode: 'BASELINE',
      diffId: `${runtimeEpoch}-DIFF-0000`,
      sourceReceiptIds: [],
    };
    contexts.push(baseline);
    appendEvent({
      caseId: scenario.scenarioRef.caseId,
      type: 'SCENARIO_BASELINE_INITIALIZED',
      actor: { principalId: 'scenario-controller', roleApplicationId: 'system', authority: 'none' },
      correlationId: `${runtimeEpoch}-RESET`,
      causationId: null,
      contextVersion: baseline.contextVersion,
      payload: { scenarioId: scenario.scenarioRef.scenarioId, seed: scenario.scenarioRef.seed },
    });
    return snapshot();
  }

  function acceptEvidence(input: ActorInput & {
    requestId: string;
    evidenceId: string;
    evidenceType: string;
    sourceRef: string;
    contentHash: string;
    processId?: V3ProcessId;
  }) {
    const replay = replayOrConflict<V3Receipt>('evidence', input.requestId, input);
    if (replay) return replay;
    const policy = canonicalActor(input);
    if (policy.requiresInvitation) {
      authorizeV3Action({
        caseId: scenario.scenarioRef.caseId,
        caseTier: 'golden',
        roleApplicationId: input.roleApplicationId,
        principalId: input.principalId,
        actionType: 'submit_evidence',
        processId: input.processId,
        invitation: input.invitation,
      });
    } else if (!policy.allowedActionTypes.includes('submit_evidence')) {
      throw failure('ACTION_SCOPE_DENIED', '主体无权提交 Evidence');
    }
    const evidenceId = trimmed(input.evidenceId);
    const evidenceType = trimmed(input.evidenceType);
    const sourceRef = trimmed(input.sourceRef);
    const contentHash = trimmed(input.contentHash);
    if (!evidenceId || !evidenceType || !sourceRef || !contentHash) {
      throw failure('INVALID_INPUT', 'Evidence 字段无效');
    }
    const evidenceSignature = stableJson({
      evidenceId,
      evidenceType,
      sourceRef,
      contentHash,
      processId: input.processId ?? null,
      principalId: policy.principalId,
      invitationId: input.invitation?.invitationId ?? null,
    });
    const existingEvidence = evidenceIdentity.get(evidenceId);
    if (existingEvidence) {
      if (existingEvidence.signature !== evidenceSignature) {
        throw failure('EVIDENCE_ID_CONFLICT', '同一 evidenceId 的载荷不一致');
      }
      return remember('evidence', input.requestId, input, existingEvidence.receipt);
    }
    const event = appendEvent({
      caseId: scenario.scenarioRef.caseId,
      type: 'EVIDENCE_ACCEPTED',
      actor: {
        principalId: policy.principalId,
        roleApplicationId: policy.roleApplicationId,
        authority: 'confirmed',
      },
      correlationId: input.requestId.trim(),
      causationId: null,
      contextVersion: currentContext().contextVersion,
      payload: { evidenceId, evidenceType, sourceRef, contentHash, invitationId: input.invitation?.invitationId ?? null },
    });
    const receipt = makeReceipt({
      receiptType: 'evidence',
      eventId: event.eventId,
      caseId: scenario.scenarioRef.caseId,
      contextVersion: currentContext().contextVersion,
      principalId: policy.principalId,
      processId: input.processId,
      invitationId: input.invitation?.invitationId,
      status: 'accepted',
      evidenceReceiptIds: [],
      details: { evidenceId, evidenceType, sourceRef, contentHash },
    });
    evidenceIdentity.set(evidenceId, { signature: evidenceSignature, receipt: clone(receipt) });
    return remember('evidence', input.requestId, input, receipt);
  }

  function validateTransitionActor(code: Exclude<V3TransitionCode, 'BASELINE'>, principalId: V3CanonicalPrincipalId) {
    const expected = code === 'T2' ? 'external-customer' : 'business-owner';
    if (principalId !== expected) throw failure('ACTION_SCOPE_DENIED', `${code} 的确认主体无权`);
  }

  function commitContext(input: ActorInput & {
    requestId: string;
    transitionCode: 'T1' | 'T2' | 'T3';
    expectedContextVersion: string;
    evidenceReceiptIds: Array<string>;
    confirmedFactIds?: Array<string>;
    rationale: string;
  }) {
    const replay = replayOrConflict<{ context: V3ContextRef; receipt: V3Receipt; runs: Array<V3ProcessRun> }>('context', input.requestId, input);
    if (replay) return replay;
    const policy = canonicalActor(input);
    validateTransitionActor(input.transitionCode, policy.principalId);
    authorizeV3Action({
      caseId: scenario.scenarioRef.caseId,
      caseTier: 'golden',
      roleApplicationId: input.roleApplicationId,
      principalId: input.principalId,
      actionType: 'confirm_fact',
      processId: 'opportunity',
      invitation: input.invitation,
    });
    const current = currentContext();
    if (input.expectedContextVersion !== current.contextVersion) {
      throw failure('CONTEXT_VERSION_CONFLICT', 'Context Version 已变化');
    }
    const expectedCode = current.transitionCode === 'BASELINE' ? 'T1' : current.transitionCode === 'T1' ? 'T2' : current.transitionCode === 'T2' ? 'T3' : null;
    if (input.transitionCode !== expectedCode) throw failure('INVALID_TRANSITION', 'Context transition 顺序无效');
    if (!Array.isArray(input.evidenceReceiptIds) || input.evidenceReceiptIds.length === 0) {
      throw failure('EVIDENCE_REQUIRED', 'ContextCommit 缺少 Evidence Receipt');
    }
    const sourceReceipts = input.evidenceReceiptIds.map((receiptId) => {
      const receipt = receipts.get(receiptId);
      if (!receipt || receipt.receiptType !== 'evidence') throw failure('EVIDENCE_RECEIPT_NOT_FOUND', 'Evidence Receipt 不存在');
      return receipt;
    });
    const principalSet = new Set(sourceReceipts.map((receipt) => receipt.principalId));
    if (input.transitionCode === 'T2' && !principalSet.has('external-customer')) {
      throw failure('EVIDENCE_SCOPE_DENIED', 'T2 必须引用客户 Evidence');
    }
    if (input.transitionCode === 'T3' && (!principalSet.has('external-customer') || !principalSet.has('external-supplier'))) {
      throw failure('EVIDENCE_SCOPE_DENIED', 'T3 必须同时引用客户与供应商 Evidence');
    }
    const rationale = trimmed(input.rationale);
    if (!rationale) throw failure('INVALID_INPUT', 'ContextCommit rationale 无效');

    const nextSequence = current.contextSeq + 1;
    const nextVersion = contextVersion(nextSequence);
    const supersededRunIds: Array<string> = [];
    for (const runId of currentRunIds.values()) {
      const run = runs.get(runId);
      if (run && run.status !== 'superseded') supersededRunIds.push(runId);
    }
    const diffId = `${runtimeEpoch}-DIFF-${String(++diffSequence).padStart(4, '0')}`;
    const commitEvent = appendEvent({
      caseId: scenario.scenarioRef.caseId,
      type: 'CONTEXT_COMMIT_RECORDED',
      actor: { principalId: policy.principalId, roleApplicationId: policy.roleApplicationId, authority: 'confirmed' },
      correlationId: input.requestId.trim(),
      causationId: sourceReceipts.at(-1)?.eventId ?? null,
      contextVersion: nextVersion,
      payload: {
        transitionCode: input.transitionCode,
        previousContextVersion: current.contextVersion,
        diffId,
        evidenceReceiptIds: [...input.evidenceReceiptIds],
        confirmedFactIds: [...(input.confirmedFactIds ?? [])],
        rationale,
      },
    });
    const nextContext: V3ContextRef = {
      runtimeEpoch,
      contextSeq: nextSequence,
      contextVersion: nextVersion,
      previousContextVersion: current.contextVersion,
      transitionCode: input.transitionCode,
      diffId,
      sourceReceiptIds: [...input.evidenceReceiptIds],
    };
    contexts.push(nextContext);

    if (supersededRunIds.length > 0) {
      for (const runId of supersededRunIds) {
        const run = runs.get(runId)!;
        run.status = 'superseded';
        run.supersededByContextVersion = nextVersion;
        run.updatedAt = now();
      }
      appendEvent({
        caseId: scenario.scenarioRef.caseId,
        type: 'PROCESS_RUNS_SUPERSEDED',
        actor: { principalId: 'process-orchestrator', roleApplicationId: 'system', authority: 'none' },
        correlationId: input.requestId.trim(),
        causationId: commitEvent.eventId,
        contextVersion: nextVersion,
        payload: { runIds: supersededRunIds, supersededByContextVersion: nextVersion },
      });
    }

    const triggerEvent = appendEvent({
      caseId: scenario.scenarioRef.caseId,
      type: 'PROCESS_RUNS_TRIGGERED',
      actor: { principalId: 'process-orchestrator', roleApplicationId: 'system', authority: 'none' },
      correlationId: input.requestId.trim(),
      causationId: commitEvent.eventId,
      contextVersion: nextVersion,
      payload: { processIds: [...REQUIRED_PROCESS_IDS] },
    });
    currentRunIds = new Map();
    const newRuns = REQUIRED_PROCESS_IDS.map((processId) => {
      const timestamp = now();
      const run: V3ProcessRun = {
        runId: `${runtimeEpoch}-RUN-${String(++runSequence).padStart(4, '0')}`,
        caseId: scenario.scenarioRef.caseId,
        processId,
        boundContextVersion: nextVersion,
        sourceEventId: triggerEvent.eventId,
        status: 'queued',
        readinessBand: 0,
        riskBand: 'unknown',
        evidenceCoverageBand: 0,
        gateState: 'not_ready',
        updatedAt: timestamp,
      };
      runs.set(run.runId, run);
      currentRunIds.set(processId, run.runId);
      return clone(run);
    });
    const receipt = makeReceipt({
      receiptType: 'context_commit',
      eventId: commitEvent.eventId,
      caseId: scenario.scenarioRef.caseId,
      contextVersion: nextVersion,
      principalId: policy.principalId,
      actionType: 'context_commit',
      status: 'committed',
      evidenceReceiptIds: [...input.evidenceReceiptIds],
      details: { transitionCode: input.transitionCode, diffId, runIds: newRuns.map((run) => run.runId), rationale },
    });
    return remember('context', input.requestId, input, { context: clone(nextContext), receipt, runs: newRuns });
  }

  function updateProcessRun(input: {
    requestId: string;
    runId: string;
    status: Exclude<V3ProcessRunStatus, 'superseded'>;
    readinessBand: 0 | 1 | 2 | 3 | 4;
    riskBand: 'unknown' | 'low' | 'medium' | 'high';
    evidenceCoverageBand: 0 | 1 | 2 | 3 | 4;
    summary: string;
  }) {
    const replay = replayOrConflict<V3ProcessRun>('run', input.requestId, input);
    if (replay) return replay;
    const run = runs.get(input.runId);
    if (!run) throw failure('RUN_NOT_FOUND', 'Process Run 不存在');
    if (run.status === 'superseded') throw failure('RUN_SUPERSEDED', '旧 Context Run 已被取代');
    if (run.boundContextVersion !== currentContext().contextVersion) throw failure('RUN_SUPERSEDED', '旧 Context Run 已被取代');
    if (!PROCESS_TRANSITIONS[run.status].has(input.status)) throw failure('INVALID_RUN_TRANSITION', 'Process Run 状态转换无效');
    if (![0, 1, 2, 3, 4].includes(input.readinessBand) || ![0, 1, 2, 3, 4].includes(input.evidenceCoverageBand)) {
      throw failure('INVALID_INPUT', 'Process Run band 无效');
    }
    if (!trimmed(input.summary)) throw failure('INVALID_INPUT', 'Process Run summary 无效');
    if (currentContext().transitionCode === 'T2' && run.processId === 'credit' && input.status !== 'needs_input') {
      const prior = [...runs.values()]
        .filter((candidate) => candidate.processId === 'credit' && candidate.boundContextVersion === 'CTX-0001')
        .at(-1);
      if (prior && input.readinessBand >= prior.readinessBand) {
        throw failure('T2_CREDIT_REGRESSION_REQUIRED', 'T2 信审必须回退或进入补件');
      }
    }
    run.status = input.status;
    run.readinessBand = input.readinessBand;
    run.riskBand = input.riskBand;
    run.evidenceCoverageBand = input.evidenceCoverageBand;
    run.gateState = input.status === 'ready_for_gate' ? 'ready' : input.status === 'needs_input' ? 'returned_for_evidence' : run.gateState;
    if (input.status === 'running' && run.startedAt === undefined) run.startedAt = now();
    run.updatedAt = now();
    appendEvent({
      caseId: scenario.scenarioRef.caseId,
      type: 'PROCESS_RUN_STATUS_CHANGED',
      actor: { principalId: 'process-orchestrator', roleApplicationId: 'system', authority: 'none' },
      correlationId: input.requestId.trim(),
      causationId: run.sourceEventId,
      contextVersion: run.boundContextVersion,
      payload: {
        runId: run.runId,
        processId: run.processId,
        status: run.status,
        readinessBand: run.readinessBand,
        riskBand: run.riskBand,
        evidenceCoverageBand: run.evidenceCoverageBand,
        summary: input.summary.trim(),
      },
    });
    return remember('run', input.requestId, input, clone(run));
  }

  function recordHumanGate(input: ActorInput & {
    requestId: string;
    expectedContextVersion: string;
    processId: 'policy' | 'credit' | 'commercial' | 'asset';
    gateMode: 'HUMAN_CONFIRM' | 'HUMAN_DECIDE';
    decision: 'confirm' | 'reject' | 'return_for_evidence';
    rationale: string;
    evidenceReceiptIds: Array<string>;
  }) {
    const replay = replayOrConflict<V3Receipt>('gate', input.requestId, input);
    if (replay) return replay;
    const authorization = authorizeV3Action({
      caseId: scenario.scenarioRef.caseId,
      caseTier: 'golden',
      roleApplicationId: input.roleApplicationId,
      principalId: input.principalId,
      actionType: 'professional_gate',
      processId: input.processId,
    });
    if (!['HUMAN_CONFIRM', 'HUMAN_DECIDE'].includes(input.gateMode)) {
      throw failure('INVALID_GATE_MODE', 'Gate mode 无效');
    }
    if (!['confirm', 'reject', 'return_for_evidence'].includes(input.decision)) {
      throw failure('INVALID_GATE_DECISION', 'Gate decision 无效');
    }
    if (!Array.isArray(input.evidenceReceiptIds) || input.evidenceReceiptIds.length === 0) {
      throw failure('EVIDENCE_REQUIRED', 'Human Gate 必须引用 Evidence Receipt');
    }
    if (commencement.status === 'commenced') throw failure('ALREADY_COMMENCED', '正式起租后不能追加专业 Gate');
    const current = currentContext();
    if (input.expectedContextVersion !== current.contextVersion) throw failure('CONTEXT_VERSION_CONFLICT', 'Context Version 已变化');
    if (current.transitionCode !== 'T3') throw failure('GATE_NOT_READY', '专业 Gate 必须绑定 T3');
    const runId = currentRunIds.get(input.processId);
    const run = runId ? runs.get(runId) : undefined;
    if (!run || !['ready_for_gate', 'completed'].includes(run.status)) throw failure('GATE_NOT_READY', '本专业候选尚未 ready');
    if (!trimmed(input.rationale)) throw failure('INVALID_INPUT', 'Gate rationale 无效');
    for (const receiptId of input.evidenceReceiptIds) {
      const receipt = receipts.get(receiptId);
      if (!receipt || receipt.receiptType !== 'evidence') {
        throw failure('EVIDENCE_RECEIPT_NOT_FOUND', 'Gate 引用的 Evidence Receipt 不存在');
      }
    }
    const event = appendEvent({
      caseId: scenario.scenarioRef.caseId,
      type: 'HUMAN_GATE_RECORDED',
      actor: { principalId: authorization.canonicalPrincipalId, roleApplicationId: authorization.roleApplicationId, authority: 'confirmed' },
      correlationId: input.requestId.trim(),
      causationId: run.sourceEventId,
      contextVersion: current.contextVersion,
      payload: { processId: input.processId, gateMode: input.gateMode, decision: input.decision, rationale: input.rationale.trim() },
    });
    run.gateState = input.decision === 'confirm' ? 'confirmed' : input.decision === 'reject' ? 'rejected' : 'returned_for_evidence';
    run.updatedAt = now();
    const receipt = makeReceipt({
      receiptType: 'human_gate',
      eventId: event.eventId,
      caseId: scenario.scenarioRef.caseId,
      contextVersion: current.contextVersion,
      principalId: authorization.canonicalPrincipalId,
      processId: input.processId,
      actionType: 'professional_gate',
      status: input.decision,
      evidenceReceiptIds: [...input.evidenceReceiptIds],
      details: { gateMode: input.gateMode, rationale: input.rationale.trim() },
    });
    return remember('gate', input.requestId, input, receipt);
  }

  function recordManagementAction(input: ActorInput & {
    requestId: string;
    expectedContextVersion: string;
    actionCode: string;
    targetPrincipalIds: Array<string>;
    rationale: string;
    evidenceOrProjectionRefs: Array<string>;
  }) {
    const replay = replayOrConflict<V3Receipt>('management', input.requestId, input);
    if (replay) return replay;
    const authorization = authorizeV3Action({
      caseId: scenario.scenarioRef.caseId,
      caseTier: 'golden',
      roleApplicationId: input.roleApplicationId,
      principalId: input.principalId,
      actionType: 'management_action',
    });
    const current = currentContext();
    if (input.expectedContextVersion !== current.contextVersion) throw failure('CONTEXT_VERSION_CONFLICT', 'Context Version 已变化');
    if (!trimmed(input.actionCode) || !trimmed(input.rationale) || input.targetPrincipalIds.length === 0) {
      throw failure('INVALID_INPUT', 'Management Action 字段无效');
    }
    const event = appendEvent({
      caseId: scenario.scenarioRef.caseId,
      type: 'MANAGEMENT_ACTION_RECORDED',
      actor: { principalId: authorization.canonicalPrincipalId, roleApplicationId: authorization.roleApplicationId, authority: 'confirmed' },
      correlationId: input.requestId.trim(),
      causationId: null,
      contextVersion: current.contextVersion,
      payload: { actionCode: input.actionCode.trim(), targetPrincipalIds: [...input.targetPrincipalIds], rationale: input.rationale.trim() },
    });
    const receipt = makeReceipt({
      receiptType: 'management_action',
      eventId: event.eventId,
      caseId: scenario.scenarioRef.caseId,
      contextVersion: current.contextVersion,
      principalId: authorization.canonicalPrincipalId,
      actionType: 'management_action',
      status: 'recorded',
      evidenceReceiptIds: [],
      details: {
        actionCode: input.actionCode.trim(),
        targetPrincipalIds: [...input.targetPrincipalIds],
        rationale: input.rationale.trim(),
        evidenceOrProjectionRefs: [...input.evidenceOrProjectionRefs],
      },
    });
    return remember('management', input.requestId, input, receipt);
  }

  function recordMessage(input: ActorInput & {
    requestId: string;
    message: string;
    processId?: V3ProcessId;
  }) {
    const replay = replayOrConflict<V3AuthorityEvent>('message', input.requestId, input);
    if (replay) return replay;
    const authorization = authorizeV3Action({
      caseId: scenario.scenarioRef.caseId,
      caseTier: 'golden',
      roleApplicationId: input.roleApplicationId,
      principalId: input.principalId,
      actionType: 'chat',
      processId: input.processId,
      invitation: input.invitation,
    });
    const message = trimmed(input.message);
    if (!message) throw failure('INVALID_INPUT', '消息不能为空');
    const event = appendEvent({
      caseId: scenario.scenarioRef.caseId,
      type: 'MESSAGE_RECEIVED',
      actor: {
        principalId: authorization.canonicalPrincipalId,
        roleApplicationId: authorization.roleApplicationId,
        authority: 'none',
      },
      correlationId: input.requestId.trim(),
      causationId: null,
      contextVersion: currentContext().contextVersion,
      payload: { message, processId: input.processId ?? null, invitationId: authorization.invitationId },
    });
    return remember('message', input.requestId, input, event);
  }

  function recordCommencement(input: ActorInput & {
    requestId: string;
    expectedContextVersion: string;
    conditionSetVersion: string;
    requiredReceiptIds: Array<string>;
    rationale: string;
  }) {
    const replay = replayOrConflict<V3Receipt>('commencement', input.requestId, input);
    if (replay) return replay;
    const authorization = authorizeV3Action({
      caseId: scenario.scenarioRef.caseId,
      caseTier: 'golden',
      roleApplicationId: input.roleApplicationId,
      principalId: input.principalId,
      actionType: 'commencement_action',
      processId: 'commercial',
    });
    const current = currentContext();
    if (input.expectedContextVersion !== current.contextVersion) throw failure('CONTEXT_VERSION_CONFLICT', 'Context Version 已变化');
    if (current.transitionCode !== 'T3') throw failure('COMMENCEMENT_NOT_READY', '正式起租必须绑定 T3');
    if (commencement.status === 'commenced') throw failure('ALREADY_COMMENCED', '事项已经正式起租');
    if (input.conditionSetVersion !== commencement.conditionSetVersion) throw failure('CONDITION_SET_CONFLICT', '起租条件版本不匹配');
    const requiredGateReceipts = requiredGateProcesses.map((processId) => {
      const runId = currentRunIds.get(processId);
      const run = runId ? runs.get(runId) : undefined;
      if (!run || run.gateState !== 'confirmed') return undefined;
      return [...receipts.values()].filter((receipt) =>
        receipt.receiptType === 'human_gate' &&
        receipt.processId === processId &&
        receipt.contextVersion === current.contextVersion
      ).at(-1);
    });
    if (requiredGateReceipts.some((receipt) => receipt?.status !== 'confirm')) {
      throw failure('COMMENCEMENT_NOT_READY', '必要专业 Gate 的最新决定不是确认');
    }
    if (requiredGateReceipts.some((receipt) => !receipt)) throw failure('COMMENCEMENT_NOT_READY', '必要专业 Gate 尚未完成');
    const supplied = new Set(input.requiredReceiptIds);
    if (requiredGateReceipts.some((receipt) => !supplied.has(receipt!.receiptId))) {
      throw failure('COMMENCEMENT_RECEIPTS_INCOMPLETE', '起租 Receipt 引用不完整');
    }
    for (const receiptId of input.requiredReceiptIds) {
      if (!receipts.has(receiptId)) throw failure('RECEIPT_NOT_FOUND', '上游 Receipt 不存在');
    }
    if (!trimmed(input.rationale)) throw failure('INVALID_INPUT', '起租 rationale 无效');
    const event = appendEvent({
      caseId: scenario.scenarioRef.caseId,
      type: 'LEASE_COMMENCEMENT_RECORDED',
      actor: { principalId: authorization.canonicalPrincipalId, roleApplicationId: authorization.roleApplicationId, authority: 'confirmed' },
      correlationId: input.requestId.trim(),
      causationId: requiredGateReceipts.at(-1)!.eventId,
      contextVersion: current.contextVersion,
      payload: { conditionSetVersion: input.conditionSetVersion, requiredReceiptIds: [...input.requiredReceiptIds], rationale: input.rationale.trim() },
    });
    const receipt = makeReceipt({
      receiptType: 'commencement',
      eventId: event.eventId,
      caseId: scenario.scenarioRef.caseId,
      contextVersion: current.contextVersion,
      principalId: authorization.canonicalPrincipalId,
      processId: 'commercial',
      actionType: 'commencement_action',
      status: 'commenced',
      evidenceReceiptIds: [...input.requiredReceiptIds],
      details: { conditionSetVersion: input.conditionSetVersion, rationale: input.rationale.trim() },
    });
    commencement = {
      ...commencement,
      band: 5,
      status: 'commenced',
      lifecycleStatus: 'active_lease',
      commencementReceiptId: receipt.receiptId,
    };
    return remember('commencement', input.requestId, input, receipt);
  }

  function snapshot() {
    return clone({
      scenarioRef: scenario.scenarioRef,
      runtimeEpoch,
      cases: scenario.cases,
      currentContext: currentContext(),
      contexts,
      processRuns: [...runs.values()],
      receipts: [...receipts.values()],
      events,
      commencement,
    });
  }

  function listEvents(afterSequence = 0, limit = 100) {
    if (!Number.isInteger(afterSequence) || afterSequence < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw failure('INVALID_PAGINATION', 'Event pagination 无效');
    }
    const items = events.filter((event) => event.sequence > afterSequence).slice(0, limit);
    return clone({
      items,
      nextSequence: items.length === limit ? items.at(-1)!.sequence : null,
      hasMore: events.some((event) => event.sequence > (items.at(-1)?.sequence ?? afterSequence)),
    });
  }

  reset();

  return {
    reset,
    acceptEvidence,
    commitContext,
    updateProcessRun,
    recordHumanGate,
    recordManagementAction,
    recordMessage,
    recordCommencement,
    snapshot,
    listEvents,
  };
}
