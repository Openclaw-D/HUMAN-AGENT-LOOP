import { resolve } from 'node:path';

import { startRelayRuntime } from '../../src/index.js';

const [databasePath, logPath] = process.argv.slice(2);
if (!databasePath || !logPath) throw new Error('Usage: ops-hard-timeout-child.mjs <db> <log>');

const runtime = await startRelayRuntime({
  env: {
    PORT: '0',
    RELAYOS_DB_PATH: databasePath,
    RELAYOS_SCENARIO_DIR: resolve('scenarios'),
    RELAYOS_PUBLIC_DIR: resolve('public'),
    RELAYOS_LOG_PATH: logPath,
    RELAYOS_SHUTDOWN_TIMEOUT_MS: '1000',
    ADVISORY_PROVIDER: 'mock',
    RELAYOS_CONNECTOR: 'mock',
    RELAYOS_DEMO_MODE: 'true',
  },
  installSignalHandlers: true,
});

runtime.operationTracker.begin('transaction', { workCaseId: 'hard-timeout-case' });
setInterval(() => {}, 60_000);
process.send?.({ type: 'hard-timeout.ready', host: runtime.config.host, port: runtime.address.port });
process.on('message', (message) => {
  if (message?.type === 'hard-timeout.trigger') process.emit('SIGTERM');
});
