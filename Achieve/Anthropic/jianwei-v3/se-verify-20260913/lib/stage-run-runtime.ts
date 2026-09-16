import { deriveSharedContextProjection } from './shared-context-projection.ts';

const CASE_ID = 'FL-DEMO-001';
const CONTEXT_VERSION_PATTERN = /^CTX-\d{4,}$/;
const MAX_SOURCE_EVENT_ID_LENGTH = 160;
const STAGE_IDS = ['policy', 'credit', 'commerce', 'asset'] as const;

export type StageId = (typeof STAGE_IDS)[number];

export type CandidateStageRun = {
  caseId: typeof CASE_ID;
  contextVersion: string;
  sourceEventId: string;
  stageId: StageId;
  processRunId: string;
  status: 'candidate_ready';
  currentFlowId: string;
  prepProgressPercent: number;
  completedStepCount: number;
  recordedAt: string;
};

type StageCounts = Record<StageId, number>;
type CandidateStageRunInput = {
  caseId: unknown;
  contextVersion: unknown;
  sourceEventId: unknown;
  completedStepCountByStage: unknown;
};
type Batch = {
  signature: string;
  records: CandidateStageRun[];
};

let batchesByContextVersion = new Map<string, Batch>();
let allRecords: CandidateStageRun[] = [];

function failure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readField(input: CandidateStageRunInput, key: keyof CandidateStageRunInput): {
  ok: boolean;
  value?: unknown;
} {
  try {
    return { ok: true, value: input[key] };
  } catch {
    return { ok: false };
  }
}

function hasExactEnumerableKeys(value: object, expectedKeys: readonly (string | symbol)[]): boolean {
  let ownKeys: (string | symbol)[];
  try {
    ownKeys = Reflect.ownKeys(value);
  } catch {
    return false;
  }

  if (ownKeys.length !== expectedKeys.length) return false;
  const remaining = new Set(ownKeys);
  for (const key of expectedKeys) {
    if (!remaining.delete(key)) return false;
    try {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable) return false;
    } catch {
      return false;
    }
  }
  return remaining.size === 0;
}

function validateStageCounts(value: unknown): StageCounts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw failure('INVALID_STAGE_COUNTS', 'completedStepCountByStage must be a plain object');
  }

  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    throw failure('INVALID_STAGE_COUNTS', 'completedStepCountByStage must be inspectable');
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw failure('INVALID_STAGE_COUNTS', 'completedStepCountByStage must have exact stage keys');
  }
  if (!hasExactEnumerableKeys(value, STAGE_IDS)) {
    throw failure('INVALID_STAGE_COUNTS', 'completedStepCountByStage must contain exactly four stages');
  }

  const counts = {} as StageCounts;
  for (const stageId of STAGE_IDS) {
    let rawCount: unknown;
    try {
      rawCount = (value as Record<StageId, unknown>)[stageId];
    } catch {
      throw failure('INVALID_STAGE_COUNTS', `${stageId} completed step count must be readable`);
    }
    if (
      typeof rawCount !== 'number' ||
      !Number.isSafeInteger(rawCount) ||
      rawCount < 0 ||
      rawCount > 5
    ) {
      throw failure('INVALID_COMPLETED_STEP_COUNT', `${stageId} completed step count must be an integer from 0 to 5`);
    }
    counts[stageId] = rawCount;
  }
  return counts;
}

function validateInput(input: CandidateStageRunInput): {
  contextVersion: string;
  sourceEventId: string;
  completedStepCountByStage: StageCounts;
} {
  const caseResult = readField(input, 'caseId');
  if (!caseResult.ok || caseResult.value !== CASE_ID) {
    throw failure('CASE_NOT_FOUND', '事项不存在');
  }

  let ownKeys: (string | symbol)[] | undefined;
  try {
    ownKeys = Reflect.ownKeys(input);
  } catch {
    ownKeys = undefined;
  }

  const contextResult = readField(input, 'contextVersion');
  const contextVersion = contextResult.ok ? trimmed(contextResult.value) : '';
  if (!contextResult.ok || !CONTEXT_VERSION_PATTERN.test(contextVersion)) {
    throw failure('INVALID_CONTEXT_VERSION', 'contextVersion must match CTX and at least four digits');
  }

  const sourceResult = readField(input, 'sourceEventId');
  const sourceEventId = sourceResult.ok ? trimmed(sourceResult.value) : '';
  if (
    !sourceResult.ok ||
    sourceEventId.length === 0 ||
    sourceEventId.length > MAX_SOURCE_EVENT_ID_LENGTH
  ) {
    throw failure('INVALID_SOURCE_EVENT_ID', 'sourceEventId must be a trimmed non-empty string of at most 160 characters');
  }

  const countResult = readField(input, 'completedStepCountByStage');
  const completedStepCountByStage = validateStageCounts(
    countResult.ok ? countResult.value : undefined,
  );

  const expectedInputKeys = [
    'caseId',
    'contextVersion',
    'sourceEventId',
    'completedStepCountByStage',
  ] as const;
  if (
    !ownKeys ||
    !hasExactEnumerableKeys(input, expectedInputKeys)
  ) {
    throw failure('INVALID_STAGE_COUNTS', 'input must contain exactly the four stage-run fields');
  }

  return { contextVersion, sourceEventId, completedStepCountByStage };
}

function signature(contextVersion: string, sourceEventId: string, counts: StageCounts): string {
  return JSON.stringify({
    caseId: CASE_ID,
    contextVersion,
    sourceEventId,
    completedStepCountByStage: {
      policy: counts.policy,
      credit: counts.credit,
      commerce: counts.commerce,
      asset: counts.asset,
    },
  });
}

export function recordCandidateStageRuns(
  input: CandidateStageRunInput,
): CandidateStageRun[] {
  const clean = validateInput(input);
  const payloadSignature = signature(
    clean.contextVersion,
    clean.sourceEventId,
    clean.completedStepCountByStage,
  );
  const existingBatch = batchesByContextVersion.get(clean.contextVersion);
  if (existingBatch) {
    if (existingBatch.signature !== payloadSignature) {
      throw failure('CONTEXT_VERSION_CONFLICT', 'contextVersion已绑定其他候选处理载荷');
    }
    return structuredClone(existingBatch.records);
  }

  const projection = deriveSharedContextProjection({
    contextVersion: clean.contextVersion,
    completedStepCountByStage: clean.completedStepCountByStage,
  });
  const recordedAt = new Date().toISOString();
  const records: CandidateStageRun[] = projection.stagePreparations.map((preparation) => ({
    caseId: CASE_ID,
    contextVersion: preparation.contextVersion,
    sourceEventId: clean.sourceEventId,
    stageId: preparation.stageId,
    processRunId: preparation.processRunId,
    status: 'candidate_ready',
    currentFlowId: preparation.currentFlowId,
    prepProgressPercent: preparation.prepProgressPercent,
    completedStepCount: preparation.completedStepCount,
    recordedAt,
  }));

  allRecords.push(...records);
  batchesByContextVersion.set(clean.contextVersion, {
    signature: payloadSignature,
    records,
  });
  return structuredClone(records);
}

export function getLatestCandidateStageRuns(): CandidateStageRun[] {
  if (allRecords.length === 0) return [];
  return structuredClone(allRecords.slice(-STAGE_IDS.length));
}

export function listCandidateStageRuns(): CandidateStageRun[] {
  return structuredClone(allRecords);
}

export function resetCandidateStageRuns(): void {
  batchesByContextVersion = new Map();
  allRecords = [];
}
