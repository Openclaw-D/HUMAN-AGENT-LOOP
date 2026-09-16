import { resolve } from 'node:path';

import { RelayService } from './application/service.js';
import { MockExternalSystemAdapter } from './connectors/mock-adapter.js';
import { loadScenarioConfigs } from './config/scenario-loader.js';
import { createRelayHttpServer } from './http/server.js';
import { shutdownRelayServer } from './http/shutdown.js';
import { EventStore } from './persistence/event-store.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 4178);
const databasePath = resolve(process.env.RELAYOS_DB_PATH ?? './data/relayos.db');
const scenarioDirectory = resolve(process.env.RELAYOS_SCENARIO_DIR ?? './scenarios');
const publicDirectory = resolve(process.env.RELAYOS_PUBLIC_DIR ?? './public');
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',').map((item) => item.trim()).filter(Boolean);

const store = new EventStore(databasePath);
const service = new RelayService({ store, scenarioConfigs: loadScenarioConfigs(scenarioDirectory), connector: new MockExternalSystemAdapter() });
const server = createRelayHttpServer({ service, allowedOrigins, publicDirectory });
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await shutdownRelayServer(server, store, { signal, timeoutMs: 10_000 });
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ level: 'error', code: error.code ?? 'SHUTDOWN_FAILED', signal, message: error.message })}\n`);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.listen(port, host, () => {
  const address = server.address();
  process.stdout.write(`${JSON.stringify({ level: 'info', service: 'relayos', gate: 'P2', host, port: address.port, databasePath, identityAssurance: 'demo_unverified' })}\n`);
});
