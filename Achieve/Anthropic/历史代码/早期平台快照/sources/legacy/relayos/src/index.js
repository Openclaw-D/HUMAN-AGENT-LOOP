import { pathToFileURL } from 'node:url';

import { RelayService } from './application/service.js';
import { MockExternalSystemAdapter } from './connectors/mock-adapter.js';
import { loadRuntimeConfig } from './config/runtime-config.js';
import { loadScenarioConfigs } from './config/scenario-loader.js';
import { createRelayHttpServer } from './http/server.js';
import { registerShutdownSignals, shutdownRelayServer } from './http/shutdown.js';
import { createJsonlLogger } from './observability/jsonl-logger.js';
import { OperationTracker } from './ops/operation-tracker.js';
import { EventStore } from './persistence/event-store.js';
import { DELIVERY_GATE, SERVICE_NAME, SERVICE_VERSION } from './version.js';

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server.address());
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

export async function startRelayRuntime({ env = process.env, installSignalHandlers = true } = {}) {
  const config = loadRuntimeConfig(env);
  const logger = createJsonlLogger({ level: config.logLevel, path: config.logPath });
  const operationTracker = new OperationTracker();
  let store;
  let server;
  try {
    store = new EventStore(config.databasePath, { migrationMode: config.migrationMode });
    const connector = new MockExternalSystemAdapter();
    const service = new RelayService({
      store,
      scenarioConfigs: loadScenarioConfigs(config.scenarioDirectory),
      connector,
      operationTracker,
      logger,
      connectorDeadlineMs: config.connectorDeadlineMs,
    });
    server = createRelayHttpServer({
      service,
      advisoryConfig: config.provider,
      allowedOrigins: config.allowedOrigins,
      publicDirectory: config.publicDirectory,
      bodyLimit: config.bodyLimit,
      operationTracker,
      logger,
    });
    const address = await listen(server, config.port, config.host);
    logger.log('info', 'runtime.started', {
      component: 'runtime', resultStatus: 'ready', host: config.host, port: address.port,
      schemaVersion: store.readiness().schemaVersion, journalMode: store.journalMode,
      identityAssurance: 'demo_unverified', authority: 'deterministic',
    });

    let shutdownRequested = false;
    const requestShutdown = async (signal = 'manual') => {
      if (shutdownRequested) return server.shutdownPromise;
      shutdownRequested = true;
      try {
        const result = await shutdownRelayServer(server, store, {
          signal,
          timeoutMs: config.shutdownTimeoutMs,
          operationTracker,
          advisoryRuntime: server.advisoryRuntime,
          logger,
        });
        process.send?.({
          type: 'relayos.stopped', signal, status: 'completed', elapsedMs: result.elapsedMs,
          checkpointBusy: result.checkpoint.busy, storeClosed: store.closed,
          advisoryClosed: server.advisoryRuntime?.closed ?? true, loggerClosed: logger.closed,
        });
        return result;
      } catch (error) {
        process.send?.({ type: 'relayos.stopped', signal, status: 'failed', errorCode: error.code ?? 'SHUTDOWN_FAILED' });
        throw error;
      }
    };
    const removeSignalHandlers = installSignalHandlers
      ? registerShutdownSignals((signal) => {
        requestShutdown(signal).then(() => {
          process.exitCode = 0;
          process.disconnect?.();
        }).catch(() => process.exit(1));
      })
      : () => {};

    return {
      config, logger, operationTracker, store, service, server,
      address, requestShutdown, removeSignalHandlers,
    };
  } catch (error) {
    try { server?.closeAllConnections?.(); } catch { /* startup cleanup */ }
    try { server?.advisoryRuntime?.close?.(); } catch { /* startup cleanup */ }
    try { store?.close(); } catch { /* startup cleanup */ }
    logger.close();
    throw error;
  }
}

async function main() {
  const runtime = await startRelayRuntime();
  process.send?.({
    type: 'relayos.ready',
    host: runtime.config.host,
    port: runtime.address.port,
    gate: DELIVERY_GATE,
    serviceVersion: SERVICE_VERSION,
  });
  process.on('message', (message) => {
    if (message?.type !== 'relayos.shutdown') return;
    const signal = message.signal === 'SIGTERM' ? 'SIGTERM' : message.signal === 'SIGINT' ? 'SIGINT' : 'manual';
    runtime.requestShutdown(signal).then(() => {
      process.exitCode = 0;
      process.disconnect?.();
    }).catch(() => {
      process.exit(1);
    });
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    const known = typeof error?.code === 'string';
    process.stderr.write(`${JSON.stringify({
      timestamp: new Date().toISOString(), level: 'error', service: SERVICE_NAME,
      serviceVersion: SERVICE_VERSION, event: 'runtime.startup.failed',
      resultStatus: 'failed', authority: 'not_applicable', latencyMs: 0,
      errorCode: known ? error.code : 'STARTUP_FAILED',
      message: known ? error.message : 'RelayOS startup failed.',
    })}\n`);
    process.exitCode = 1;
    process.disconnect?.();
  });
}
