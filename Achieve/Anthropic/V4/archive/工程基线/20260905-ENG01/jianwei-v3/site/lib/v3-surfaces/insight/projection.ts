import type {
  InsightAuthorityRecord,
  InsightEdge,
  InsightGrain,
  InsightMetricValue,
  InsightNode,
  InsightProvenance,
  InsightRuntimeInput,
  InsightSource,
  InsightSourceKind,
  InsightValueClass,
} from './contracts.ts';

type ProjectionOptions = {
  grain?: InsightGrain;
  caseId?: string;
};

function failure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function assertIso(value: string | null, code = 'INVALID_RUNTIME_TIMESTAMP'): void {
  if (value !== null && Number.isNaN(Date.parse(value))) throw failure(code, 'Runtime 时间字段无效');
}

function sharedSource(input: InsightRuntimeInput, refs: Array<string>): InsightSource {
  return {
    sourceType: 'shared-runtime',
    sourceMode: input.sourceMode,
    system: 'v3-authority-runtime',
    refs: [...new Set(refs)].sort(),
  };
}

function missingSource(): InsightSource {
  return {
    sourceType: 'not-provided',
    sourceMode: 'not_connected',
    system: '未提供',
    refs: [],
  };
}

function provenance(input: InsightRuntimeInput): InsightProvenance {
  return {
    derivedBy: 'v3-insight-deterministic-projection-v1',
    runtimeEpoch: input.runtimeEpoch,
    contextVersion: input.currentContext.contextVersion,
  };
}

function metric(
  input: InsightRuntimeInput,
  valueClass: InsightValueClass,
  value: number | null,
  unit: string,
  refs: Array<string>,
  asOf: string | null,
): InsightMetricValue {
  return {
    valueClass,
    availability: value === null ? 'unavailable' : 'provided',
    value,
    displayValue: value === null ? '未提供' : value,
    unit,
    source: value === null ? missingSource() : sharedSource(input, refs),
    provenance: provenance(input),
    asOf,
  };
}

function actorKind(roleApplicationId: string, principalId: string): InsightSourceKind {
  if (roleApplicationId === 'system') return 'system';
  if (principalId === '@JW' || principalId.includes('agent')) return 'agent';
  return 'human';
}

function processIdFromPayload(payload: Record<string, unknown>): string | null {
  return typeof payload.processId === 'string' && payload.processId.trim().length > 0
    ? payload.processId.trim()
    : null;
}

function latestRunByProcess(input: InsightRuntimeInput, runs: InsightRuntimeInput['processRuns']) {
  const latest = new Map<string, InsightRuntimeInput['processRuns'][number]>();
  for (const run of [...runs].sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) return left.updatedAt.localeCompare(right.updatedAt);
    return left.runId.localeCompare(right.runId);
  })) {
    if (run.boundContextVersion === input.currentContext.contextVersion || !latest.has(run.processId)) {
      latest.set(run.processId, run);
    }
  }
  return latest;
}

function buildGraph(
  input: InsightRuntimeInput,
  runs: InsightRuntimeInput['processRuns'],
  focusCaseId: string | null,
  asOf: string | null,
) {
  const source = sharedSource(input, input.events.map((event) => event.eventId));
  const nodeMap = new Map<string, InsightNode>();
  const addNode = (node: InsightNode) => nodeMap.set(node.id, node);
  const common = { source, provenance: provenance(input), asOf };
  addNode({
    id: `system:${input.runtimeEpoch}`,
    kind: 'system',
    label: 'System Runtime',
    caseId: focusCaseId,
    processId: null,
    status: 'observed',
    authority: 'none',
    ...common,
  });
  addNode({
    id: 'agent:@JW',
    kind: 'agent',
    label: '@JW candidate agent',
    caseId: focusCaseId,
    processId: null,
    status: 'candidate-only',
    authority: 'none',
    ...common,
  });

  const collaboration = focusCaseId && focusCaseId !== input.scenarioRef.caseId
    ? null
    : input.collaboration;
  for (const member of collaboration?.members ?? []) {
    addNode({
      id: `human:${member.principalId}`,
      kind: 'human',
      label: `${member.label} · ${member.ownerLabel}`,
      caseId: focusCaseId ?? input.scenarioRef.caseId,
      processId: member.processId,
      status: 'named-human',
      authority: 'none',
      ...common,
    });
  }
  for (const event of input.events) {
    if (actorKind(event.actor.roleApplicationId, event.actor.principalId) !== 'human') continue;
    const id = `human:${event.actor.principalId}`;
    if (!nodeMap.has(id)) {
      addNode({
        id,
        kind: 'human',
        label: event.actor.principalId,
        caseId: event.caseId,
        processId: processIdFromPayload(event.payload),
        status: 'observed-human',
        authority: event.actor.authority,
        ...common,
      });
    }
  }

  const latestRuns = latestRunByProcess(input, runs);
  const workItems = collaboration?.workItems ?? [];
  const processes = new Set<string>([
    ...workItems.map((item) => item.processId),
    ...runs.map((run) => run.processId),
  ]);
  for (const processId of [...processes].sort()) {
    const item = workItems.find((candidate) => candidate.processId === processId);
    const run = latestRuns.get(processId);
    addNode({
      id: `task:${focusCaseId ?? input.scenarioRef.caseId}:${processId}`,
      kind: 'task',
      label: item?.task ?? `${processId} runtime task`,
      caseId: focusCaseId ?? run?.caseId ?? input.scenarioRef.caseId,
      processId,
      status: run?.status ?? item?.runStatus ?? 'not_started',
      authority: 'none',
      source: sharedSource(input, [run?.runId, item ? `work-item:${processId}` : null].filter((value): value is string => value !== null && value !== undefined)),
      provenance: provenance(input),
      asOf: run?.updatedAt ?? asOf,
    });
  }

  const edges: Array<InsightEdge> = [];
  const edgeIds = new Set<string>();
  const addEdge = (edge: InsightEdge) => {
    if (!edgeIds.has(edge.id)) {
      edgeIds.add(edge.id);
      edges.push(edge);
    }
  };
  addEdge({
    id: `edge:${input.runtimeEpoch}:controls:@JW`,
    source: `system:${input.runtimeEpoch}`,
    target: 'agent:@JW',
    relation: 'controls',
    authority: 'none',
  });
  for (const processId of [...processes].sort()) {
    const taskId = `task:${focusCaseId ?? input.scenarioRef.caseId}:${processId}`;
    addEdge({
      id: `edge:@JW:supports:${processId}`,
      source: 'agent:@JW',
      target: taskId,
      relation: 'supports',
      authority: 'none',
    });
    const member = collaboration?.members.find((candidate) => candidate.processId === processId);
    if (member) {
      addEdge({
        id: `edge:${member.principalId}:owns:${processId}`,
        source: `human:${member.principalId}`,
        target: taskId,
        relation: 'owns',
        authority: 'none',
      });
    }
    addEdge({
      id: `edge:${processId}:projects-to:runtime`,
      source: taskId,
      target: `system:${input.runtimeEpoch}`,
      relation: 'projects-to',
      authority: 'none',
    });
  }
  const nodes = [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw failure('INSIGHT_DANGLING_EDGE', 'System Runtime graph 存在悬空引用');
    }
  }
  return { nodes, edges: edges.sort((left, right) => left.id.localeCompare(right.id)) };
}

function buildAuthorityRecords(
  input: InsightRuntimeInput,
  events: InsightRuntimeInput['events'],
  runs: InsightRuntimeInput['processRuns'],
) {
  const records: Array<InsightAuthorityRecord> = [];
  for (const event of events) {
    const kind = actorKind(event.actor.roleApplicationId, event.actor.principalId);
    if (event.actor.authority === 'confirmed' && kind !== 'human') {
      throw failure('AUTHORITY_SOURCE_INVALID', 'Agent/System 不得冒充 Human authority');
    }
    const base = {
      caseId: event.caseId,
      processId: processIdFromPayload(event.payload),
      source: { kind, principalId: event.actor.principalId, refId: event.eventId },
      status: event.type,
      asOf: event.recordedAt,
    };
    records.push({ id: `event:${event.eventId}`, authorityType: 'event', authority: event.actor.authority, ...base });
    if (event.type === 'HUMAN_GATE_RECORDED' || event.type === 'LEASE_COMMENCEMENT_RECORDED') {
      if (kind !== 'human' || event.actor.authority !== 'confirmed') {
        throw failure('DECISION_AUTHORITY_INVALID', 'Decision 必须来自具名 Human authority');
      }
      records.push({ id: `decision:${event.eventId}`, authorityType: 'decision', authority: 'confirmed', ...base });
    }
  }
  for (const run of runs) {
    records.push({
      id: `task:${run.runId}`,
      authorityType: 'task',
      authority: 'none',
      caseId: run.caseId,
      processId: run.processId,
      source: { kind: 'system', principalId: 'process-run-runtime', refId: run.runId },
      status: run.status,
      asOf: run.updatedAt,
    });
    if (!['queued', 'running', 'superseded'].includes(run.status)) {
      records.push({
        id: `proposal:${run.runId}`,
        authorityType: 'proposal',
        authority: 'none',
        caseId: run.caseId,
        processId: run.processId,
        source: { kind: 'agent', principalId: '@JW', refId: run.runId },
        status: run.status,
        asOf: run.updatedAt,
      });
    }
  }
  return records.sort((left, right) => left.id.localeCompare(right.id));
}

function assertReceiptAuthority(
  receipts: InsightRuntimeInput['receipts'],
  events: InsightRuntimeInput['events'],
): void {
  const eventById = new Map(events.map((event) => [event.eventId, event]));
  for (const receipt of receipts) {
    if (receipt.receiptType !== 'human_gate' && receipt.receiptType !== 'commencement') continue;
    const event = eventById.get(receipt.eventId);
    const expectedType = receipt.receiptType === 'human_gate'
      ? 'HUMAN_GATE_RECORDED'
      : 'LEASE_COMMENCEMENT_RECORDED';
    if (
      !event ||
      event.type !== expectedType ||
      event.actor.authority !== 'confirmed' ||
      actorKind(event.actor.roleApplicationId, event.actor.principalId) !== 'human' ||
      event.actor.principalId !== receipt.principalId
    ) {
      throw failure('RECEIPT_AUTHORITY_INVALID', 'Human Gate/Receipt 必须回链具名 Human authority Event');
    }
  }
}

function throughputSeries(input: InsightRuntimeInput, events: InsightRuntimeInput['events']) {
  const buckets = new Map<string, Array<{ eventId: string; recordedAt: string }>>();
  for (const event of events) {
    assertIso(event.recordedAt);
    const bucket = `${event.recordedAt.slice(0, 13)}:00:00.000Z`;
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), { eventId: event.eventId, recordedAt: event.recordedAt }]);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([bucketStart, items]) => ({
      bucketStart,
      valueClass: 'actual' as const,
      observedCount: items.length,
      unit: 'authority-events/hour',
      source: sharedSource(input, items.map((item) => item.eventId)),
      provenance: provenance(input),
      asOf: items.map((item) => item.recordedAt).sort().at(-1) ?? null,
    }));
}

function observedCycleTimeMinutes(runs: InsightRuntimeInput['processRuns']): { value: number | null; refs: Array<string> } {
  const durations: Array<{ value: number; ref: string }> = [];
  for (const run of runs) {
    if (!run.startedAt || !['completed', 'failed', 'ready_for_gate', 'needs_input'].includes(run.status)) continue;
    assertIso(run.startedAt);
    assertIso(run.updatedAt);
    const duration = (Date.parse(run.updatedAt) - Date.parse(run.startedAt)) / 60_000;
    if (duration >= 0) durations.push({ value: duration, ref: run.runId });
  }
  if (durations.length === 0) return { value: null, refs: [] };
  return {
    value: Number((durations.reduce((sum, item) => sum + item.value, 0) / durations.length).toFixed(2)),
    refs: durations.map((item) => item.ref),
  };
}

export function buildInsightProjection(input: InsightRuntimeInput, options: ProjectionOptions = {}) {
  if (!input || typeof input !== 'object') throw failure('INVALID_INSIGHT_INPUT', 'System Runtime input 无效');
  const grain = options.grain ?? 'system-runtime';
  if (grain !== 'system-runtime' && grain !== 'case') throw failure('INVALID_GRAIN', 'grain 无效');
  const caseId = options.caseId?.trim() || null;
  if (grain === 'case' && !caseId) throw failure('CASE_ID_REQUIRED', 'Case grain 需要 caseId');
  if (caseId && !input.cases.some((item) => item.caseId === caseId)) throw failure('CASE_NOT_FOUND', '事项不存在');

  const focusCaseId = grain === 'case' ? caseId : null;
  const events = input.events.filter((event) => !focusCaseId || event.caseId === focusCaseId);
  const runs = input.processRuns.filter((run) => !focusCaseId || run.caseId === focusCaseId);
  const receipts = input.receipts.filter((receipt) => !focusCaseId || receipt.caseId === focusCaseId);
  assertReceiptAuthority(receipts, events);
  const asOfCandidates = [
    ...events.map((event) => event.recordedAt),
    ...runs.map((run) => run.updatedAt),
  ];
  for (const value of asOfCandidates) assertIso(value);
  const asOf = asOfCandidates.sort().at(-1) ?? null;
  const graph = buildGraph(input, runs, focusCaseId, asOf);
  const authorityRecords = buildAuthorityRecords(input, events, runs);
  const series = throughputSeries(input, events);
  const latestThroughput = series.at(-1);
  const throughputRefs = latestThroughput?.source.refs ?? [];
  const throughputActual = latestThroughput?.observedCount ?? null;
  const cycleTime = observedCycleTimeMinutes(runs);

  const eligibleRuns = runs.filter((run) => ['ready_for_gate', 'needs_input'].includes(run.status));
  const humanGateEvents = events.filter((event) => event.type === 'HUMAN_GATE_RECORDED');
  const denominatorComplete = input.telemetryContract.humanTakeoverDenominatorComplete;
  if (denominatorComplete && humanGateEvents.length > eligibleRuns.length) {
    throw failure('INVALID_HUMAN_TAKEOVER_DENOMINATOR', 'Human takeover 分母小于已观测分子');
  }
  const takeoverRatio = denominatorComplete && eligibleRuns.length > 0
    ? Number((humanGateEvents.length / eligibleRuns.length).toFixed(4))
    : null;
  const takeoverRefs = [...eligibleRuns.map((run) => run.runId), ...humanGateEvents.map((event) => event.eventId)];

  const exceptions = runs
    .filter((run) => run.status === 'failed' || run.status === 'needs_input')
    .map((run) => ({
      exceptionId: `exception:${run.runId}`,
      caseId: run.caseId,
      processId: run.processId,
      type: run.status === 'failed' ? 'runtime-failure' as const : 'human-input-required' as const,
      severity: run.status === 'failed' ? 'high' as const : 'attention' as const,
      status: run.status,
      authority: 'none' as const,
      source: sharedSource(input, [run.runId]),
      provenance: provenance(input),
      asOf: run.updatedAt,
    }));

  const missingData = [
    input.telemetryContract.slaTargetMinutes === null ? 'sla.targetMinutes' : null,
    input.telemetryContract.forecastThroughputPerHour === null ? 'throughput.forecast' : null,
    input.telemetryContract.scenarioThroughputPerHour === null ? 'throughput.scenario' : null,
    denominatorComplete ? null : 'humanTakeover.denominatorCompleteness',
  ].filter((value): value is string => value !== null);

  return structuredClone({
    projectionType: 'InsightSystemRuntimeProjection',
    projectionVersion: `${input.runtimeEpoch}:${input.currentContext.contextVersion}:${events.length}:${runs.length}`,
    grain,
    grainLabel: grain === 'system-runtime' ? 'System Runtime' as const : 'Case' as const,
    availableGrains: [
      { id: 'system-runtime' as const, label: 'System Runtime' },
      { id: 'case' as const, label: 'Case' },
    ],
    focusCaseId,
    defaultGrain: 'system-runtime' as const,
    runtimeEpoch: input.runtimeEpoch,
    contextVersion: input.currentContext.contextVersion,
    sourceMode: input.sourceMode,
    dataClass: input.scenarioRef.dataClass,
    productionStatus: 'local_in_memory_demo_only' as const,
    asOf,
    source: sharedSource(input, throughputRefs),
    provenance: provenance(input),
    graph,
    throughput: {
      definition: '按 UTC 小时统计 shared Authority Event 记录数；不是业务产能或生产 SLA。',
      series,
      actual: metric(input, 'actual', throughputActual, 'authority-events/hour', throughputRefs, asOf),
      forecast: metric(input, 'forecast', input.telemetryContract.forecastThroughputPerHour, 'authority-events/hour', [], asOf),
      scenario: metric(input, 'scenario', input.telemetryContract.scenarioThroughputPerHour, 'authority-events/hour', [], asOf),
    },
    sla: {
      definition: 'Process Run 从 startedAt 到 terminal/ready status updatedAt 的平均分钟数；target 仅接受 shared contract 明示值。',
      target: metric(input, 'scenario', input.telemetryContract.slaTargetMinutes, 'minutes', [], asOf),
      observed: metric(input, 'actual', cycleTime.value, 'minutes', cycleTime.refs, asOf),
      status: input.telemetryContract.slaTargetMinutes === null || cycleTime.value === null
        ? 'unknown' as const
        : cycleTime.value <= input.telemetryContract.slaTargetMinutes
          ? 'within-target' as const
          : 'breached' as const,
    },
    exceptions,
    humanTakeover: {
      definition: 'Human Gate events / eligible Agent proposals (ready_for_gate or needs_input).',
      numerator: humanGateEvents.length,
      denominator: denominatorComplete ? eligibleRuns.length : null,
      denominatorCompleteness: denominatorComplete ? 'complete' as const : 'incomplete' as const,
      ratio: takeoverRatio,
      displayValue: takeoverRatio === null ? '未提供' as const : takeoverRatio,
      authority: 'none' as const,
      source: denominatorComplete ? sharedSource(input, takeoverRefs) : missingSource(),
      provenance: provenance(input),
      asOf,
    },
    authorityRecords,
    authorityTypeCounts: {
      event: authorityRecords.filter((record) => record.authorityType === 'event').length,
      proposal: authorityRecords.filter((record) => record.authorityType === 'proposal').length,
      decision: authorityRecords.filter((record) => record.authorityType === 'decision').length,
      task: authorityRecords.filter((record) => record.authorityType === 'task').length,
    },
    missingData,
  });
}
