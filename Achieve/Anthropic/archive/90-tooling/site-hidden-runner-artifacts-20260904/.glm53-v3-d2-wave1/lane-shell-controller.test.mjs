import assert from "node:assert/strict";
import test from "node:test";

import {
  V3_BACKGROUND_CASES,
  V3_PRINCIPAL_IDS,
  buildRoleProjection,
} from "../lib/v3-shell-model.ts";

test("controller: collaboration alias normalizes and exposes management only", () => {
  assert.ok(V3_PRINCIPAL_IDS.includes("collaboration-manager"));
  const canonical = buildRoleProjection({
    caseId: "FL-DEMO-001",
    roleId: "leadership",
    contextVersion: "CTX-0003",
  });
  assert.equal(canonical.principalId, "collaboration-manager");
  assert.equal(canonical.readOnly, false);
  assert.deepEqual(canonical.scope.canSubmitGateProcessIds, []);
  assert.equal(canonical.scope.canSubmitHumanGate, false);
  assert.ok(canonical.allowedGateModes.includes("management-action"));

  const alias = buildRoleProjection({
    caseId: "FL-DEMO-001",
    roleId: "leadership",
    principalId: "leadership-observer",
    contextVersion: "CTX-0003",
  });
  assert.equal(alias.principalId, "collaboration-manager");
});

test("controller: business cannot sign professional gates", () => {
  const projection = buildRoleProjection({
    caseId: "FL-DEMO-001",
    roleId: "business",
    principalId: "business-owner",
    contextVersion: "CTX-0003",
  });
  assert.equal(projection.scope.visibleProcessIds.length, 5);
  assert.equal(projection.scope.canSubmitHumanGate, false);
  assert.deepEqual(projection.scope.canSubmitGateProcessIds, []);
});

test("controller: commenced background case keeps five black bands", () => {
  const commenced = V3_BACKGROUND_CASES.find((item) => item.caseId === "FL-BG-003");
  assert.ok(commenced);
  assert.equal(commenced.leaseLifecycleStatus, "active-lease");
  assert.equal(commenced.commencementBand, 5);
});
