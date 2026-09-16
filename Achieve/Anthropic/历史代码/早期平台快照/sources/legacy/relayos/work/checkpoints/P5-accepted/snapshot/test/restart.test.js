import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { EventStore } from '../src/persistence/event-store.js';

test('real child process exit then reopen recovers owner/goal/handoff/Gate/receipt', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relayos-p2-restart-'));
  const databasePath = join(directory, 'restart.db');
  try {
    const child = spawnSync(process.execPath, [resolve('test/fixtures/restart-writer.mjs'), databasePath], { cwd: resolve('.'), encoding: 'utf8', timeout: 20_000 });
    assert.equal(child.status, 0, child.stderr);
    const childEvidence = JSON.parse(child.stdout.trim());
    const store = new EventStore(databasePath);
    try {
      const projection = store.getProjection('case-process-restart');
      assert.equal(projection.canonicalStateHash, childEvidence.canonicalStateHash);
      assert.equal(projection.projectionVersion, childEvidence.streamVersion);
      assert.equal(projection.state.ownerActorRef.id, 'human-reviewer');
      assert.equal(projection.state.acceptedGoalVersion, 1);
      assert.equal(projection.state.handoffOffers[0].status, 'accepted');
      assert.equal(projection.state.humanGates[0].status, 'approved');
      assert.equal(projection.state.executionReceipts[0].status, 'unknown');
      assert.equal(store.replayStream('case-process-restart').canonicalStateHash, projection.canonicalStateHash);
      assert.equal(store.readiness().status, 'ready');
    } finally { store.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
