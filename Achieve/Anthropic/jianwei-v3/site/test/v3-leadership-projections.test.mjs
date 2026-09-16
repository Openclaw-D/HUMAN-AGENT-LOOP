import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createV3SharedRuntime } from '../lib/v3-runtime/shared-runtime.ts';
import {
  createV3SurfaceProjection,
  leadershipDefaultContextSelector,
} from '../lib/v3-surfaces/leadership/projections.ts';

test('leadership defaults to Portfolio and drills into division and Case with provenance', () => {
  const directory = mkdtempSync(join(tmpdir(), 'jw-v3-projection-'));
  const runtime = createV3SharedRuntime({ databasePath: join(directory, 'projection.sqlite') });
  try {
    assert.deepEqual(leadershipDefaultContextSelector(), {
      grain: 'portfolio', portfolioId: 'PORTFOLIO-JW-DEMO', divisionId: null, caseId: null,
    });
    const portfolio = createV3SurfaceProjection({
      store: runtime.store, surface: 'collaboration', role: 'leadership',
    });
    assert.equal(portfolio.defaultContextGrain, 'portfolio');
    assert.equal(portfolio.readModel.context.grain, 'portfolio');
    assert.equal(portfolio.hierarchy.length, 8);
    assert.equal(portfolio.readModel.charts.length, 2);
    assert.ok(portfolio.readModel.charts.length <= 4);
    assert.deepEqual(portfolio.readModel.professionalPaths.map((path) => path.role), [
      'policy', 'credit', 'commercial', 'asset',
    ]);
    assert.ok(portfolio.readModel.professionalPaths.every((path) =>
      path.steps.join('>') === 'material>rule>model>human_review'));

    const division = createV3SurfaceProjection({
      store: runtime.store,
      surface: 'value',
      role: 'leadership',
      context: { grain: 'division', portfolioId: 'PORTFOLIO-JW-DEMO', divisionId: 'DIV-EAST', caseId: null },
    });
    assert.equal(division.readModel.context.label, '华东事业部');
    assert.equal(division.readModel.charts.length, 3);
    for (const chart of division.readModel.charts) {
      for (const datum of chart.data) {
        assert.ok(['provided', 'not_provided'].includes(datum.provenance.availability));
        assert.equal(datum.provenance.dataClass, 'synthetic_deidentified_demo');
        assert.equal(datum.provenance.connectionStatus, 'scenario_only');
        assert.ok(datum.provenance.asOf === null || Number.isFinite(Date.parse(datum.provenance.asOf)));
        if (datum.value === null) assert.equal(datum.displayValue, '未提供');
      }
    }

    const golden = createV3SurfaceProjection({
      store: runtime.store,
      surface: 'collaboration',
      role: 'business',
      context: { grain: 'case', portfolioId: 'PORTFOLIO-JW-DEMO', divisionId: 'DIV-EAST', caseId: 'FL-DEMO-001' },
    });
    const credit = golden.readModel.professionalPaths.find((path) => path.role === 'credit');
    const asset = golden.readModel.professionalPaths.find((path) => path.role === 'asset');
    assert.equal(credit.backendContinuousProgress, 63);
    assert.equal(credit.frontendQuarterThreshold, 50);
    assert.equal(asset.backendContinuousProgress, null);
    assert.equal(asset.frontendQuarterThreshold, null);
    assert.equal(asset.missingDisplay, '未提供');
    assert.equal(golden.readModel.roleProjection.canConfirmProfessionalGate, false);
    assert.throws(() => createV3SurfaceProjection({
      store: runtime.store, surface: 'value', role: 'customer',
    }), (error) => error.code === 'CONTEXT_SCOPE_DENIED');
    const customer = createV3SurfaceProjection({
      store: runtime.store,
      surface: 'collaboration',
      role: 'customer',
      context: { grain: 'case', portfolioId: 'PORTFOLIO-JW-DEMO', divisionId: 'DIV-EAST', caseId: 'FL-DEMO-001' },
    });
    assert.equal(customer.hierarchy.length, 1);
    assert.equal(customer.hierarchy[0].caseId, 'FL-DEMO-001');
  } finally {
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
