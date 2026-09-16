const CONTEXT_VERSION_ERROR = "INVALID_CONTEXT_VERSION";
const STAGE_COUNTS_ERROR = "INVALID_STAGE_COUNTS";
const COMPLETED_STEP_COUNT_ERROR = "INVALID_COMPLETED_STEP_COUNT";

const FLOW_IDS = {
  policy: [
    "policy-material",
    "policy-rules",
    "policy-quant",
    "policy-prereview",
    "policy-update",
  ],
  credit: [
    "credit-parse",
    "credit-fact",
    "credit-link",
    "credit-coordinate",
    "credit-review",
  ],
  commerce: [
    "commerce-contract",
    "commerce-logistics",
    "commerce-funding",
    "commerce-payment-check",
    "commerce-final-payment",
  ],
  asset: [
    "asset-onboard",
    "asset-rent",
    "asset-warning",
    "asset-collection",
    "asset-litigation",
  ],
} as const;

const STAGE_IDS = ["policy", "credit", "commerce", "asset"] as const;

type StageId = (typeof STAGE_IDS)[number];
type StageCounts = Record<StageId, number>;

export type SharedContextProjectionInput = {
  contextVersion: string;
  completedStepCountByStage: StageCounts;
};

export type SharedContextProjection = {
  contextVersion: string;
  stagePreparations: Array<{
    stageId: StageId;
    processRunId: string;
    contextVersion: string;
    currentFlowId: string;
    completedStepCount: number;
    prepProgressPercent: number;
    flows: Array<{
      flowId: string;
      prepState: "completed" | "active" | "locked";
      progressPercent: number;
    }>;
  }>;
};

function fail(code: string, message: string): never {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  throw error;
}

export function deriveSharedContextProjection(
  input: SharedContextProjectionInput,
): SharedContextProjection {
  let rawContextVersion: unknown;
  try {
    rawContextVersion = typeof input === "object" && input !== null
      ? input.contextVersion
      : undefined;
  } catch {
    fail(CONTEXT_VERSION_ERROR, "contextVersion must be a readable non-empty string");
  }
  if (
    typeof input !== "object" ||
    input === null ||
    typeof rawContextVersion !== "string" ||
    rawContextVersion.length === 0 ||
    rawContextVersion.trim().length === 0
  ) {
    fail(CONTEXT_VERSION_ERROR, "contextVersion must be a non-empty string");
  }

  const stageCounts = input.completedStepCountByStage;
  if (
    typeof stageCounts !== "object" ||
    stageCounts === null ||
    Array.isArray(stageCounts)
  ) {
    fail(STAGE_COUNTS_ERROR, "completedStepCountByStage must be a plain object");
  }

  let stageCountsPrototype: object | null;
  let stageKeys: (string | symbol)[];
  try {
    stageCountsPrototype = Object.getPrototypeOf(stageCounts);
    stageKeys = Reflect.ownKeys(stageCounts);
  } catch {
    fail(STAGE_COUNTS_ERROR, "completedStepCountByStage must be an inspectable plain object");
  }
  if (
    (stageCountsPrototype !== Object.prototype && stageCountsPrototype !== null) ||
    stageKeys.length !== STAGE_IDS.length ||
    !STAGE_IDS.every((stageId) => Object.prototype.hasOwnProperty.call(stageCounts, stageId))
  ) {
    fail(STAGE_COUNTS_ERROR, "completedStepCountByStage must contain exactly four stages");
  }

  const normalizedContextVersion = rawContextVersion.trim();
  const stagePreparations = STAGE_IDS.map((stageId) => {
    const completedStepCount = stageCounts[stageId];
    if (
      typeof completedStepCount !== "number" ||
      !Number.isSafeInteger(completedStepCount) ||
      completedStepCount < 0 ||
      completedStepCount > 5
    ) {
      fail(COMPLETED_STEP_COUNT_ERROR, `${stageId} completed step count must be an integer from 0 to 5`);
    }

    const prepProgressPercent = completedStepCount * 20;
    const flows = FLOW_IDS[stageId].map((flowId, flowIndex) => {
      if (flowIndex < completedStepCount) {
        return { flowId, prepState: "completed" as const, progressPercent: 100 };
      }
      if (flowIndex === completedStepCount) {
        return { flowId, prepState: "active" as const, progressPercent: prepProgressPercent };
      }
      return { flowId, prepState: "locked" as const, progressPercent: 0 };
    });

    const currentFlowId = FLOW_IDS[stageId][Math.min(completedStepCount, 4)];
    return {
      stageId,
      processRunId: `run-${stageId}-${normalizedContextVersion}`,
      contextVersion: normalizedContextVersion,
      currentFlowId,
      completedStepCount,
      prepProgressPercent,
      flows,
    };
  });

  return { contextVersion: normalizedContextVersion, stagePreparations };
}
