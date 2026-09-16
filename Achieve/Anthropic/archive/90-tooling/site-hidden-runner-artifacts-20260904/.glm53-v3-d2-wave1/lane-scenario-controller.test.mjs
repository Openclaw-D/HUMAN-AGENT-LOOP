import assert from "node:assert/strict";
import test from "node:test";

import {
  V3_SCENARIO_CASES,
  V3_SCENARIO_PRINCIPAL_IDS,
  V3_SCENARIO_PROCESS_IDS,
  V3_SCENARIO_REF,
  V3_SCENARIO_TRANSITIONS,
  getV3ScenarioBaseline,
} from "../lib/v3-demo-scenario.ts";

test("controller: scenario identity and five process contract are exact", () => {
  assert.deepEqual(V3_SCENARIO_REF, {
    scenarioId: "JW-V3-DL-GOLDEN-001",
    scenarioVersion: "1.0.0-macro",
    seed: "jw-v3-dl-golden-seed-001",
    businessItemType: "FinancingLeasingCase",
    caseId: "FL-DEMO-001",
    leaseMode: "direct-lease",
    dataClass: "synthetic_deidentified_demo",
  });
  assert.deepEqual(V3_SCENARIO_PROCESS_IDS, [
    "opportunity",
    "policy",
    "credit",
    "commercial",
    "asset",
  ]);
  assert.ok(V3_SCENARIO_PRINCIPAL_IDS.includes("collaboration-manager"));
});

test("controller: T1/T2/T3 authority and batching are frozen", () => {
  assert.equal(V3_SCENARIO_TRANSITIONS.length, 3);
  const [t1, t2, t3] = V3_SCENARIO_TRANSITIONS;
  assert.equal(t1.transitionCode, "T1");
  assert.equal(t1.commitPrincipalId, "business-owner");
  assert.equal(t1.maxContextCommits, 1);
  assert.equal(t2.transitionCode, "T2");
  assert.equal(t2.commitPrincipalId, "external-customer");
  assert.equal(t2.invitationId, "INV-CUSTOMER-RISK-001");
  assert.equal(t2.creditRegressionRequired, true);
  assert.equal(t3.transitionCode, "T3");
  assert.equal(t3.commitPrincipalId, "business-owner");
  assert.equal(t3.maxContextCommits, 1);
  assert.deepEqual(t3.evidencePrincipalIds, ["external-customer", "external-supplier"]);
});

test("controller: baseline is isolated and commenced summaries are consistent", () => {
  const first = getV3ScenarioBaseline();
  const second = getV3ScenarioBaseline();
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.cases, second.cases);
  first.cases[0].commencementBand = 5;
  assert.equal(second.cases[0].commencementBand, 0);
  assert.equal(second.contextSeq, 0);
  assert.deepEqual(second.receipts, []);

  const golden = V3_SCENARIO_CASES.find((item) => item.caseId === "FL-DEMO-001");
  assert.ok(golden);
  assert.equal(golden.readOnly, false);
  for (const item of V3_SCENARIO_CASES.filter((entry) => entry.caseTier === "background")) {
    assert.equal(item.readOnly, true);
  }
  for (const item of V3_SCENARIO_CASES.filter((entry) => ["active_lease", "closed"].includes(entry.lifecycleStatus))) {
    assert.equal(item.commencementBand, 5);
  }
});
