import assert from "node:assert/strict";
import test from "node:test";

import { deriveSharedContextProjection } from "../lib/shared-context-projection.ts";

const contextVersion = "ctx-001";
const baseInput = {
  contextVersion: `  ${contextVersion}  `,
  completedStepCountByStage: {
    policy: 0,
    credit: 1,
    commerce: 3,
    asset: 5,
  },
};

function flowIds(stageId) {
  const flowIdsByStage = {
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
  };
  return flowIdsByStage[stageId];
}

function buildInput(counts, contextVersionInput = baseInput.contextVersion) {
  return {
    contextVersion: contextVersionInput,
    completedStepCountByStage: {
      policy: counts.policy,
      credit: counts.credit,
      commerce: counts.commerce,
      asset: counts.asset,
    },
  };
}

test("derives the frozen four-stage and twenty-flow projection", () => {
  const result = deriveSharedContextProjection(buildInput(baseInput.completedStepCountByStage));

  assert.deepEqual(
    result.stagePreparations.map((stage) => stage.stageId),
    ["policy", "credit", "commerce", "asset"],
  );
  assert.deepEqual(result.stagePreparations.flatMap((stage) => stage.flows.map((flow) => flow.flowId)), [
    ...flowIds("policy"),
    ...flowIds("credit"),
    ...flowIds("commerce"),
    ...flowIds("asset"),
  ]);
  assert.equal(result.contextVersion, contextVersion);
  assert.ok(result.stagePreparations.every((stage) => stage.contextVersion === contextVersion));
  assert.ok(
    result.stagePreparations.every(
      (stage) => stage.processRunId === `run-${stage.stageId}-${contextVersion}`,
    ),
  );
});

test("derives completed, optional active, and locked states for all counts", () => {
  const counts = [0, 1, 2, 3, 4, 5];
  const result = deriveSharedContextProjection(buildInput({
    policy: counts[0],
    credit: counts[1],
    commerce: counts[2],
    asset: counts[3],
  }));
  void result;

  for (const count of counts) {
    const stageResult = deriveSharedContextProjection(buildInput({
      policy: count,
      credit: count,
      commerce: count,
      asset: count,
    })).stagePreparations[0];

    assert.equal(stageResult.completedStepCount, count);
    assert.equal(stageResult.prepProgressPercent, count * 20);
    assert.deepEqual(
      stageResult.flows.map((flow) => flow.prepState),
      Array.from({ length: 5 }, (_, index) =>
        index < count ? "completed" : index === count ? "active" : "locked",
      ),
    );
    assert.deepEqual(
      stageResult.flows.map((flow) => flow.progressPercent),
      Array.from({ length: 5 }, (_, index) =>
        index < count ? 100 : index === count ? count * 20 : 0,
      ),
    );
    assert.equal(stageResult.currentFlowId, flowIds("policy")[Math.min(count, 4)]);
  }
});

test("keeps every stage preparation aligned with its own count and current flow", () => {
  const result = deriveSharedContextProjection(buildInput(baseInput.completedStepCountByStage));
  const expected = [
    ["policy", 0],
    ["credit", 1],
    ["commerce", 3],
    ["asset", 5],
  ];

  for (const [index, [stageId, count]] of expected.entries()) {
    const stage = result.stagePreparations[index];
    assert.equal(stage.stageId, stageId);
    assert.equal(stage.completedStepCount, count);
    assert.equal(stage.prepProgressPercent, count * 20);
    assert.equal(stage.currentFlowId, flowIds(stageId)[Math.min(count, 4)]);
    assert.equal(stage.flows.filter((flow) => flow.prepState === "active").length, count === 5 ? 0 : 1);
    assert.equal(stage.flows[4].prepState, count === 5 ? "completed" : "locked");
  }
});

test("returns synchronously and does not return a Promise", () => {
  const result = deriveSharedContextProjection(buildInput(baseInput.completedStepCountByStage));
  assert.ok(!(result instanceof Promise));
  assert.equal(typeof result, "object");
});

function assertError(input, code) {
  assert.throws(() => deriveSharedContextProjection(input), (error) => {
    assert.ok(error instanceof Error);
    assert.equal(error.code, code);
    return true;
  });
}

test("rejects invalid context versions before stage-count and count validation", () => {
  const counts = baseInput.completedStepCountByStage;
  for (const value of [undefined, null, "", "   ", 1, true]) {
    assertError({ contextVersion: value, completedStepCountByStage: counts }, "INVALID_CONTEXT_VERSION");
  }

  assertError(
    {
      contextVersion: "",
      completedStepCountByStage: { policy: "bad", credit: {}, commerce: [], asset: null },
    },
    "INVALID_CONTEXT_VERSION",
  );
  assertError(
    {
      contextVersion: "  ",
      completedStepCountByStage: { credit: 0, commerce: 0, asset: 0 },
    },
    "INVALID_CONTEXT_VERSION",
  );
});

test("reads contextVersion exactly once before validation and normalization", () => {
  let reads = 0;
  const result = deriveSharedContextProjection({
    get contextVersion() {
      reads += 1;
      return reads === 1 ? "  ctx-single-read  " : "   ";
    },
    completedStepCountByStage: {
      policy: 0,
      credit: 1,
      commerce: 2,
      asset: 3,
    },
  });
  assert.equal(reads, 1);
  assert.equal(result.contextVersion, "ctx-single-read");

  assertError({
    get contextVersion() {
      throw new Error("getter failed");
    },
    completedStepCountByStage: baseInput.completedStepCountByStage,
  }, "INVALID_CONTEXT_VERSION");
});

test("rejects invalid stage-count containers and exact stage keys before count validation", () => {
  const containers = [
    undefined,
    null,
    [],
    new Date(),
    Object.create(null),
    Object.create({ policy: 0 }),
    (() => {
      const polluted = Object.create(null);
      Object.defineProperty(polluted, "__proto__", {
        value: {},
        enumerable: true,
        configurable: true,
        writable: true,
      });
      return polluted;
    })(),
  (() => {
    const extra = { policy: 0, credit: 0, commerce: 0, asset: 0, extra: 0 };
    Object.setPrototypeOf(extra, null);
    return extra;
  })(),
  (() => {
    const extra = { policy: 0, credit: 0, commerce: 0, asset: 0 };
    Object.defineProperty(extra, "hiddenExtra", {
      value: 0,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    return extra;
  })(),
  (() => {
    const extra = { policy: 0, credit: 0, commerce: 0, asset: 0 };
    extra[Symbol("extra")] = 0;
    return extra;
  })(),
  { policy: 0, credit: 0, commerce: 0 },
    { policy: 0, credit: 0, commerce: 0, asset: 0, __proto__: {} },
  ];

  for (const completedStepCountByStage of containers) {
    assertError({ contextVersion, completedStepCountByStage }, "INVALID_STAGE_COUNTS");
  }

  assertError(
    {
      contextVersion,
      completedStepCountByStage: { policy: "bad", credit: "bad", commerce: "bad", asset: "bad" },
    },
    "INVALID_COMPLETED_STEP_COUNT",
  );

  const reordered = deriveSharedContextProjection({
    contextVersion,
    completedStepCountByStage: { credit: 1, asset: 3, policy: 0, commerce: 2 },
  });
  assert.deepEqual(reordered.stagePreparations.map((stage) => stage.stageId), ["policy", "credit", "commerce", "asset"]);

  const nullPrototype = Object.create(null);
  Object.assign(nullPrototype, { policy: 0, credit: 1, commerce: 2, asset: 3 });
  assert.equal(
    deriveSharedContextProjection({ contextVersion, completedStepCountByStage: nullPrototype })
      .stagePreparations[3].prepProgressPercent,
    60,
  );
});

test("rejects invalid completed step counts after valid stage keys are confirmed", () => {
  const invalidCounts = [-1, 6, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "1", null];
  for (const count of invalidCounts) {
    for (const stageId of ["policy", "credit", "commerce", "asset"]) {
      assertError(
        {
          contextVersion,
          completedStepCountByStage: {
            policy: 0,
            credit: 0,
            commerce: 0,
            asset: 0,
            [stageId]: count,
          },
        },
        "INVALID_COMPLETED_STEP_COUNT",
      );
    }
  }
});

test("isolates every call and exported constants from nested mutation", () => {
  const first = deriveSharedContextProjection(buildInput(baseInput.completedStepCountByStage));
  first.stagePreparations[0].stageId = "changed";
  first.stagePreparations[0].contextVersion = "changed";
  first.stagePreparations[0].flows[0].flowId = "changed";
  first.stagePreparations[0].flows[0].prepState = "locked";

  const second = deriveSharedContextProjection(buildInput(baseInput.completedStepCountByStage));
  assert.equal(second.stagePreparations[0].stageId, "policy");
  assert.equal(second.stagePreparations[0].contextVersion, contextVersion);
  assert.equal(second.stagePreparations[0].flows[0].flowId, "policy-material");
  assert.equal(second.stagePreparations[0].flows[0].prepState, "active");
  assert.notEqual(first.stagePreparations, second.stagePreparations);
  assert.notEqual(first.stagePreparations[0].flows, second.stagePreparations[0].flows);
  assert.notEqual(first.stagePreparations[0].flows[0], second.stagePreparations[0].flows[0]);
});
