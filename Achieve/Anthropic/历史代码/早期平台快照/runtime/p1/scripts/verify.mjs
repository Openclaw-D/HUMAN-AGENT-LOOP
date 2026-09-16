import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { P1Core } from '../src/core.mjs';
import {
  ensureSampleData,
  sampleWorkspaceId,
  sampleWorkIds,
  scenarioCatalog,
  selectProjectionView,
} from '../src/scenarios.mjs';
import { validateWorkProjection } from '../src/schema.mjs';

const runtimeRoot = fileURLToPath(new URL('..', import.meta.url));
const verifyDirectory = join(runtimeRoot, '.test-data', `verify-${process.pid}`);
const databasePath = join(verifyDirectory, 'verify.sqlite');

function loadAndValidate(core) {
  const projections = {};
  for (const [scenarioId, workId] of Object.entries(sampleWorkIds)) {
    const projection = core.replayProjection(sampleWorkspaceId, workId);
    const validation = validateWorkProjection(projection);
    assert.equal(validation.valid, true, `${scenarioId}: ${JSON.stringify(validation.errors)}`);
    assert.equal(projection.fixture, false);
    assert.equal(projection.dataOrigin, 'sample');
    assert.equal(projection.projectionVersion, projection.eventCursor);
    projections[scenarioId] = projection;
  }
  return projections;
}

rmSync(verifyDirectory, { recursive: true, force: true });
let core;
try {
  assert.equal(scenarioCatalog.length, 10);
  assert.deepEqual(
    scenarioCatalog.map(({ runtimeAvailability }) => runtimeAvailability),
    ['active', 'active', 'active', 'catalog-only', 'catalog-only', 'catalog-only', 'catalog-only', 'catalog-only', 'catalog-only', 'catalog-only'],
  );

  core = new P1Core({ dbPath: databasePath });
  ensureSampleData(core);
  const beforeRestart = loadAndValidate(core);

  assert.equal(beforeRestart.risk.signals.receipt.status, 'unknown');
  assert.notEqual(beforeRestart.risk.work.status, 'completed');
  assert.equal(beforeRestart.dev.signals.receipt.status, 'failed');
  assert.notEqual(beforeRestart.dev.work.status, 'completed');

  for (const view of ['relation', 'progress', 'matrix']) {
    const selected = selectProjectionView(beforeRestart.risk, view);
    assert.deepEqual(selected.projectionIdentity, beforeRestart.risk.projectionIdentity);
    assert.equal(selected.projectionVersion, beforeRestart.risk.projectionVersion);
    assert.equal(selected.eventCursor, beforeRestart.risk.eventCursor);
  }

  core.close();
  core = new P1Core({ dbPath: databasePath });
  const afterRestart = loadAndValidate(core);
  assert.deepEqual(afterRestart, beforeRestart);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    schemaVersion: 'work-projection.v1',
    workspaceId: sampleWorkspaceId,
    works: Object.fromEntries(Object.entries(afterRestart).map(([id, projection]) => [id, {
      workId: projection.projectionIdentity.workId,
      projectionVersion: projection.projectionVersion,
      eventCursor: projection.eventCursor,
      receipt: projection.signals.receipt?.status ?? null,
    }])),
    restartReplayEqual: true,
    selectorsShareProjection: true,
  }, null, 2)}\n`);
} finally {
  core?.close();
  rmSync(verifyDirectory, { recursive: true, force: true });
}
