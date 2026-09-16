import { resolve } from 'node:path';

import { RelayService } from '../../src/application/service.js';
import { MockExternalSystemAdapter } from '../../src/connectors/mock-adapter.js';
import { loadScenarioConfigs } from '../../src/config/scenario-loader.js';
import { EventStore } from '../../src/persistence/event-store.js';

const [databasePath, suffix] = process.argv.slice(2);
const store = new EventStore(resolve(databasePath));
const service = new RelayService({ store, scenarioConfigs: loadScenarioConfigs(resolve('scenarios')), connector: new MockExternalSystemAdapter(), clock: () => '2026-08-26T02:00:00.000Z' });
await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
try {
  const result = await service.executeCommand('case-concurrent', {
    commandId: `cmd-concurrent-${suffix}`,
    idempotencyKey: `idem-concurrent-${suffix}`,
    expectedStreamVersion: 1,
    configurationVersion: 1,
    commandType: 'goal.propose',
    demoActorRef: { kind: 'human', id: 'human-owner' },
    identityAssurance: 'demo_unverified',
    traceId: `trace-concurrent-${suffix}`,
    payload: { id: `goal-concurrent-${suffix}`, statement: `concurrent ${suffix}`, constraints: [], evidenceIds: [] },
  });
  process.stdout.write(`${JSON.stringify({ ok: true, streamVersion: result.streamVersion })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, code: error.code ?? error.name })}\n`);
} finally {
  store.close();
}
