import assert from "node:assert/strict";
import test from "node:test";

import {
  V3_BACKGROUND_CASES,
  V3_BUSINESS_ITEM_TYPE,
  V3_CASES,
  V3_GOLDEN_CASE_ID,
  V3_PROCESS_IDS,
  V3_PROCESS_THREADS,
  V3_ROLE_IDS,
  buildAiRoute,
  buildRoleProjection,
} from "../lib/v3-shell-model.ts";

const contextVersion = "ctx-v3-001";
const allRoleIds = [...V3_ROLE_IDS];

function assertError(action, code) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof Error);
    assert.equal(error.code, code);
    return true;
  });
}

function thread(processId) {
  return V3_PROCESS_THREADS.find((candidate) => candidate.processId === processId);
}

test("uses FinancingLeasingCase as the only exported business item type", () => {
  assert.equal(V3_BUSINESS_ITEM_TYPE, "FinancingLeasingCase");
  assert.ok(V3_CASES.length >= 5);
  assert.ok(V3_CASES.every((item) => item.businessItemType === "FinancingLeasingCase"));
});

test("keeps one golden case and at least four independent read-only background cases", () => {
  assert.equal(V3_GOLDEN_CASE_ID, "FL-DEMO-001");
  assert.equal(V3_CASES.filter((item) => item.isGolden).length, 1);
  assert.ok(V3_BACKGROUND_CASES.length >= 4);

  const caseIds = V3_CASES.map((item) => item.caseId);
  assert.equal(new Set(caseIds).size, caseIds.length);
  assert.equal(V3_CASES.filter((item) => item.caseId === V3_GOLDEN_CASE_ID).length, 1);

  for (const backgroundCase of V3_BACKGROUND_CASES) {
    assert.notEqual(backgroundCase.caseId, V3_GOLDEN_CASE_ID);
    assert.equal(backgroundCase.isBackground, true);
    assert.equal(backgroundCase.readOnly, true);
    assert.notEqual(backgroundCase.readOnlySummary.trim(), "");
    assert.equal(backgroundCase.backendScope, "background-read-projection");
    assert.equal(backgroundCase.canEnterGoldenCaseBackend, false);
  }

  const golden = V3_CASES.find((item) => item.caseId === V3_GOLDEN_CASE_ID);
  assert.equal(golden.backendScope, "golden-case-authority");
  assert.equal(golden.canEnterGoldenCaseBackend, true);
});

test("creates different same-case projections for every role without changing context identity", () => {
  const projections = allRoleIds.map((roleId) => buildRoleProjection({
    caseId: V3_GOLDEN_CASE_ID,
    roleId,
    contextVersion,
  }));

  assert.equal(projections.length, 4);
  for (const projection of projections) {
    assert.equal(projection.caseId, V3_GOLDEN_CASE_ID);
    assert.equal(projection.contextVersion, contextVersion);
    assert.equal(projection.case.caseId, V3_GOLDEN_CASE_ID);
  }

  assert.equal(new Set(projections.map((projection) => projection.role)).size, 4);
  assert.notDeepEqual(projections[0], projections[1]);
  assert.notDeepEqual(projections[0], projections[2]);
  assert.notDeepEqual(projections[0], projections[3]);
  assert.notDeepEqual(projections[1], projections[2]);
  assert.notDeepEqual(projections[1], projections[3]);
  assert.notDeepEqual(projections[2], projections[3]);
});

test("gives opportunity and credit identical primary/heavy weight and does not equate the other lines", () => {
  const opportunity = thread("opportunity");
  const policy = thread("policy");
  const credit = thread("credit");
  const commercial = thread("commercial");
  const asset = thread("asset");

  assert.deepEqual(
    { weight: opportunity.weight, intensity: opportunity.intensity },
    { weight: "primary", intensity: "heavy" },
  );
  assert.deepEqual(
    { weight: credit.weight, intensity: credit.intensity },
    { weight: "primary", intensity: "heavy" },
  );
  assert.deepEqual(
    [policy, commercial, asset].map((item) => ({
      weight: item.weight,
      intensity: item.intensity,
    })),
    [
      { weight: "rules", intensity: "exception" },
      { weight: "commencement", intensity: "execution" },
      { weight: "auxiliary", intensity: "prediction" },
    ],
  );
  assert.notDeepEqual(opportunity, credit);
  assert.equal(opportunity.slots.every((slot, index) => slot.slotId !== credit.slots[index].slotId), true);
});

test("keeps exactly five neutral configurable slots on every process thread", () => {
  assert.deepEqual(V3_PROCESS_THREADS.map((item) => item.processId), [...V3_PROCESS_IDS]);

  for (const item of V3_PROCESS_THREADS) {
    assert.equal(item.slotCount, 5);
    assert.equal(item.slots.length, 5);
    assert.deepEqual(
      item.slots.map((slot) => slot.presentationIndex),
      [0, 1, 2, 3, 4],
    );
    assert.equal(new Set(item.slots.map((slot) => slot.slotId)).size, 5);
    assert.ok(item.slots.every((slot) => slot.semanticName === null));
    assert.ok(item.slots.every((slot) => slot.sequence === null));
    assert.ok(item.slots.every((slot) => slot.configurable === true));
  }
});

test("keeps commencement band, lifecycle status, and percentage absence independent", () => {
  const golden = V3_CASES.find((item) => item.caseId === V3_GOLDEN_CASE_ID);
  const commencedBackground = V3_CASES.find((item) => item.caseId === "FL-BG-003");

  assert.equal(Number.isSafeInteger(golden.commencementBand), true);
  assert.ok(golden.commencementBand >= 0 && golden.commencementBand <= 5);
  assert.ok(V3_CASES.every((item) => Number.isSafeInteger(item.commencementBand)));
  assert.ok(V3_CASES.every((item) => item.commencementBand >= 0 && item.commencementBand <= 5));
  assert.ok(V3_CASES.every((item) => typeof item.leaseLifecycleStatus === "string"));
  assert.notEqual(golden.leaseLifecycleStatus, commencedBackground.leaseLifecycleStatus);
  assert.equal(commencedBackground.commencementBand, 5);
  assert.notEqual(golden.commencementBand, commencedBackground.commencementBand);
  assert.ok(!Object.keys(golden).some((key) => key.toLowerCase().includes("percent")));
  assert.ok(JSON.stringify(V3_CASES).toLowerCase().includes("percent") === false);
});

test("separates collaboration management from business and professional authority", () => {
  const leadership = buildRoleProjection({
    caseId: V3_GOLDEN_CASE_ID,
    roleId: "leadership",
    contextVersion,
  });
  const business = buildRoleProjection({
    caseId: V3_GOLDEN_CASE_ID,
    roleId: "business",
    contextVersion,
  });
  const risk = buildRoleProjection({
    caseId: V3_GOLDEN_CASE_ID,
    roleId: "risk",
    contextVersion,
  });
  const external = buildRoleProjection({
    caseId: V3_GOLDEN_CASE_ID,
    roleId: "external",
    contextVersion,
  });

  assert.equal(leadership.readOnly, false);
  assert.equal(leadership.principalId, "collaboration-manager");
  assert.equal(leadership.scope.canSubmitHumanGate, false);
  assert.equal(leadership.scope.canSubmitManagementAction, true);
  assert.equal(leadership.scope.access, "combined-observation");
  assert.deepEqual(leadership.allowedGateModes, ["view", "management-action"]);

  assert.equal(business.readOnly, false);
  assert.equal(business.scope.canSubmitHumanGate, false);
  assert.deepEqual(business.scope.canSubmitGateProcessIds, []);
  assert.equal(business.scope.access, "full-project-operation");
  assert.ok(business.scope.visibleProcessIds.includes("opportunity"));

  assert.equal(risk.readOnly, false);
  assert.equal(risk.scope.canActAsBusinessRole, false);
  assert.deepEqual(risk.scope.visibleProcessIds, [...V3_PROCESS_IDS]);
  assert.deepEqual(risk.scope.canSubmitGateProcessIds, ["credit"]);

  assert.equal(external.scope.canAccessInternalRiskJudgment, false);
  assert.equal(external.scope.canSubmitInvitedMaterials, true);
  assert.notDeepEqual(leadership.scope, business.scope);
  assert.notDeepEqual(business.scope, risk.scope);
  assert.notDeepEqual(risk.scope, external.scope);
  assert.notDeepEqual(leadership.allowedGateModes, business.allowedGateModes);
});

test("gives all four risk accounts five-thread visibility but only their own gate authority", () => {
  const accounts = [
    ["risk-policy", "policy"],
    ["risk-credit", "credit"],
    ["risk-commercial", "commercial"],
    ["risk-asset", "asset"],
  ];

  for (const [principalId, ownedProcessId] of accounts) {
    const riskProjection = buildRoleProjection({
      caseId: V3_GOLDEN_CASE_ID,
      roleId: "risk",
      principalId,
      contextVersion,
    });
    assert.deepEqual(riskProjection.scope.visibleProcessIds, [...V3_PROCESS_IDS]);
    assert.deepEqual(riskProjection.scope.canSubmitGateProcessIds, [ownedProcessId]);
    assert.equal(riskProjection.principalId, principalId);

    const ownRoute = buildAiRoute({
      caseId: V3_GOLDEN_CASE_ID,
      roleId: "risk",
      principalId,
      processId: ownedProcessId,
      contextVersion,
      task: "Review owned gate",
    });
    const opportunityRoute = buildAiRoute({
      caseId: V3_GOLDEN_CASE_ID,
      roleId: "risk",
      principalId,
      processId: "opportunity",
      contextVersion,
      task: "Observe opportunity context",
    });
    assert.equal(ownRoute.canSubmitHumanGate, true);
    assert.deepEqual(ownRoute.allowedGateModes, ["view", "submit"]);
    assert.equal(opportunityRoute.routeAuthorized, true);
    assert.equal(opportunityRoute.canSubmitHumanGate, false);
    assert.deepEqual(opportunityRoute.allowedGateModes, ["view"]);
  }
});

test("scopes customer and supplier projections to one invited external workstep", () => {
  const customer = buildRoleProjection({
    caseId: V3_GOLDEN_CASE_ID,
    roleId: "external",
    principalId: "external-customer",
    contextVersion,
  });
  const supplier = buildRoleProjection({
    caseId: V3_GOLDEN_CASE_ID,
    roleId: "external",
    principalId: "external-supplier",
    contextVersion,
  });

  assert.deepEqual(customer.scope.visibleProcessIds, ["opportunity"]);
  assert.deepEqual(supplier.scope.visibleProcessIds, ["commercial"]);
  assert.equal(customer.scope.canAccessInternalRiskJudgment, false);
  assert.equal(supplier.scope.canAccessInternalRiskJudgment, false);
  assert.equal(customer.scope.canSubmitInvitedMaterials, true);
  assert.equal(supplier.scope.canSubmitInvitedMaterials, true);
});

test("preserves the frozen five-part AI route and keeps authority on the backend", () => {
  const route = buildAiRoute({
    caseId: V3_GOLDEN_CASE_ID,
    roleId: "business",
    processId: "opportunity",
    contextVersion,
    task: "Assess opportunity facts",
  });

  assert.equal(route.caseId, V3_GOLDEN_CASE_ID);
  assert.equal(route.role, "business");
  assert.equal(route.process, "opportunity");
  assert.equal(route.contextVersion, contextVersion);
  assert.equal(route.task, "Assess opportunity facts");
  assert.equal(route.readOnly, false);
  assert.deepEqual(route.allowedGateModes, ["view", "material-submit"]);
  assert.equal(route.authority, "backend");
  assert.equal(route.frontendAuthority, false);
  assert.equal(route.requiresBackendAuthority, true);
  assert.equal(route.canSubmitHumanGate, false);

  const leadershipRoute = buildAiRoute({
    caseId: V3_GOLDEN_CASE_ID,
    roleId: "leadership",
    processId: "credit",
    contextVersion,
    task: "Observe credit projection",
  });
  assert.equal(leadershipRoute.readOnly, false);
  assert.deepEqual(leadershipRoute.allowedGateModes, ["view", "management-action"]);
  assert.equal(leadershipRoute.routeAuthorized, true);
  assert.equal(leadershipRoute.canSubmitHumanGate, false);

  const externalRoute = buildAiRoute({
    caseId: V3_GOLDEN_CASE_ID,
    roleId: "external",
    processId: "opportunity",
    contextVersion,
    task: "Submit invited material",
  });
  assert.equal(externalRoute.routeAuthorized, true);
  assert.equal(externalRoute.canSubmitHumanGate, false);
  assert.equal(externalRoute.canSubmitInvitedMaterials, true);
  assert.deepEqual(externalRoute.allowedGateModes, ["view", "material-submit"]);
});

test("fails closed on invalid identifiers, empty versions, and empty tasks", () => {
  const validRoleInput = {
    caseId: V3_GOLDEN_CASE_ID,
    roleId: "business",
    contextVersion,
  };

  for (const caseId of [undefined, null, "", "   ", "UNKNOWN-CASE", 1, true]) {
    assertError(() => buildRoleProjection({ ...validRoleInput, caseId }), "INVALID_CASE_ID");
  }
  for (const roleId of [undefined, null, "", "   ", "admin", 1, true]) {
    assertError(() => buildRoleProjection({ ...validRoleInput, roleId }), "INVALID_ROLE_ID");
  }
  for (const contextVersion of [undefined, null, "", "   ", 1, true]) {
    assertError(() => buildRoleProjection({ ...validRoleInput, contextVersion }), "INVALID_CONTEXT_VERSION");
  }
  for (const principalId of ["risk-policy", "external-supplier", "admin", 1, true]) {
    assertError(() => buildRoleProjection({ ...validRoleInput, principalId }), "INVALID_PRINCIPAL_ID");
  }

  const validRouteInput = {
    caseId: V3_GOLDEN_CASE_ID,
    roleId: "business",
    processId: "opportunity",
    contextVersion,
    task: "Assess",
  };
  for (const processId of [undefined, null, "", "   ", "unknown", 1, true]) {
    assertError(() => buildAiRoute({ ...validRouteInput, processId }), "INVALID_PROCESS_ID");
  }
  for (const task of [undefined, null, "", "   ", 1, true]) {
    assertError(() => buildAiRoute({ ...validRouteInput, task }), "INVALID_TASK");
  }
});

test("isolates exported data and function results from nested mutation", () => {
  assert.ok(Object.isFrozen(V3_CASES));
  assert.ok(Object.isFrozen(V3_BACKGROUND_CASES));
  assert.ok(Object.isFrozen(V3_PROCESS_THREADS));
  for (const caseItem of V3_CASES) {
    assert.ok(Object.isFrozen(caseItem));
  }
  for (const processThread of V3_PROCESS_THREADS) {
    assert.ok(Object.isFrozen(processThread));
    assert.ok(processThread.slots.every((slot) => Object.isFrozen(slot)));
  }

  const firstProjection = buildRoleProjection({
    caseId: V3_GOLDEN_CASE_ID,
    roleId: "business",
    contextVersion,
  });
  assert.ok(Object.isFrozen(firstProjection));
  assert.ok(Object.isFrozen(firstProjection.case));
  assert.ok(Object.isFrozen(firstProjection.scope));

  const firstRoute = buildAiRoute({
    caseId: V3_GOLDEN_CASE_ID,
    roleId: "business",
    processId: "opportunity",
    contextVersion,
    task: "First",
  });
  assert.ok(Object.isFrozen(firstRoute));

  const secondProjection = buildRoleProjection({
    caseId: V3_GOLDEN_CASE_ID,
    roleId: "business",
    contextVersion,
  });
  const secondRoute = buildAiRoute({
    caseId: V3_GOLDEN_CASE_ID,
    roleId: "business",
    processId: "opportunity",
    contextVersion,
    task: "Second",
  });
  assert.notEqual(firstProjection.case, secondProjection.case);
  assert.notEqual(firstProjection.scope, secondProjection.scope);
  assert.deepEqual(
    secondProjection.case,
    V3_CASES.find((item) => item.caseId === V3_GOLDEN_CASE_ID),
  );
  assert.equal(secondRoute.task, "Second");
  assert.notDeepEqual(firstRoute, secondRoute);
});

test("normalizes the legacy leadership principal to the canonical collaboration manager", () => {
  const input = {
    caseId: V3_GOLDEN_CASE_ID,
    roleId: "leadership",
    contextVersion: "route-v2",
  };
  const canonical = buildRoleProjection({ ...input, principalId: "collaboration-manager" });
  const alias = buildRoleProjection({ ...input, principalId: "leadership-observer" });

  assert.equal(canonical.principalId, "collaboration-manager");
  assert.equal(canonical.roleId, "leadership");
  assert.equal(canonical.readOnly, false);
  assert.deepEqual(canonical.scope.visibleProcessIds, ["opportunity", "policy", "credit", "commercial", "asset"]);
  assert.deepEqual(canonical.allowedGateModes, ["view", "management-action"]);
  assert.equal(canonical.scope.canSubmitManagementAction, true);
  assert.equal(canonical.scope.canSubmitHumanGate, false);
  assert.deepEqual(canonical.scope.canSubmitGateProcessIds, []);
  assert.deepEqual(alias, canonical);
});

test("projects the commenced background case with a full commencement band", () => {
  const caseItem = V3_BACKGROUND_CASES.find((item) => item.caseId === "FL-BG-003");
  const projection = buildRoleProjection({
    caseId: "FL-BG-003",
    roleId: "business",
    contextVersion: "route-v2",
  });

  assert.equal(caseItem.commencementBand, 5);
  assert.equal(caseItem.leaseLifecycleStatus, "active-lease");
  assert.equal(projection.case.commencementBand, 5);
  assert.equal(projection.case.leaseLifecycleStatus, "active-lease");
});

test("gives business collaboration across five routes without professional gate signing", () => {
  const projection = buildRoleProjection({
    caseId: V3_GOLDEN_CASE_ID,
    roleId: "business",
    principalId: "business-owner",
    contextVersion: "route-v2",
  });

  assert.equal(projection.principalId, "business-owner");
  assert.deepEqual(projection.scope.visibleProcessIds, ["opportunity", "policy", "credit", "commercial", "asset"]);
  assert.deepEqual(projection.allowedGateModes, ["view", "material-submit"]);
  assert.equal(projection.scope.canSubmitManagementAction, false);
  assert.equal(projection.scope.canSubmitHumanGate, false);
  assert.deepEqual(projection.scope.canSubmitGateProcessIds, []);

  for (const processId of ["opportunity", "policy", "credit", "commercial", "asset"]) {
    const route = buildAiRoute({
      caseId: V3_GOLDEN_CASE_ID,
      roleId: "business",
      principalId: "business-owner",
      processId,
      contextVersion: "route-v2",
      task: `Assess ${processId}`,
    });
    assert.equal(route.routeAuthorized, true);
    assert.equal(route.canSubmitHumanGate, false);
  }
});

test("scopes each risk principal to its own professional gate while preserving five-route visibility", () => {
  const expectedGates = {
    "risk-policy": "policy",
    "risk-credit": "credit",
    "risk-commercial": "commercial",
    "risk-asset": "asset",
  };

  for (const [principalId, gateProcessId] of Object.entries(expectedGates)) {
    const projection = buildRoleProjection({
      caseId: V3_GOLDEN_CASE_ID,
      roleId: "risk",
      principalId,
      contextVersion: "route-v2",
    });
    assert.deepEqual(projection.scope.visibleProcessIds, ["opportunity", "policy", "credit", "commercial", "asset"]);
    assert.equal(projection.scope.canSubmitHumanGate, true);
    assert.deepEqual(projection.scope.canSubmitGateProcessIds, [gateProcessId]);
    assert.equal(projection.scope.canSubmitManagementAction, false);

    for (const processId of ["opportunity", "policy", "credit", "commercial", "asset"]) {
      const route = buildAiRoute({
        caseId: V3_GOLDEN_CASE_ID,
        roleId: "risk",
        principalId,
        processId,
        contextVersion: "route-v2",
        task: `Assess ${processId}`,
      });
      assert.equal(route.routeAuthorized, true);
      assert.equal(route.canSubmitHumanGate, processId === gateProcessId);
      assert.deepEqual(
        route.allowedGateModes,
        processId === gateProcessId ? ["view", "submit"] : ["view"],
      );
    }
  }
});

test("keeps external collaboration invitation-scoped and outside human gates", () => {
  const projection = buildRoleProjection({
    caseId: V3_GOLDEN_CASE_ID,
    roleId: "external",
    principalId: "external-customer",
    contextVersion: "route-v2",
  });
  const route = buildAiRoute({
    caseId: V3_GOLDEN_CASE_ID,
    roleId: "external",
    principalId: "external-customer",
    processId: "opportunity",
    contextVersion: "route-v2",
    task: "Submit invited material",
  });

  assert.equal(projection.scope.canSubmitHumanGate, false);
  assert.deepEqual(projection.scope.canSubmitGateProcessIds, []);
  assert.equal(projection.scope.canAccessInternalRiskJudgment, false);
  assert.equal(route.canSubmitHumanGate, false);
  assert.equal(route.canSubmitInvitedMaterials, true);
});

test("continues to isolate returned projections and cases from seed mutation", () => {
  const first = buildRoleProjection({
    caseId: V3_GOLDEN_CASE_ID,
    roleId: "business",
    contextVersion: "route-v2",
  });
  const second = buildRoleProjection({
    caseId: V3_GOLDEN_CASE_ID,
    roleId: "business",
    contextVersion: "route-v2",
  });

  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.scope));
  assert.notEqual(first.case, second.case);
  assert.notEqual(first.scope, second.scope);
  assert.deepEqual(second.case, V3_CASES.find((item) => item.caseId === V3_GOLDEN_CASE_ID));
});
