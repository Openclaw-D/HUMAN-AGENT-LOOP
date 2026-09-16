import { AppError, assert } from '../domain/errors.js';

function closeListener(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections?.();
  });
}

export function shutdownRelayServer(server, store, {
  signal = 'manual',
  timeoutMs = 10_000,
  operationTracker = server.operationTracker,
  advisoryRuntime = server.advisoryRuntime,
  logger = null,
} = {}) {
  if (server.shutdownPromise) return server.shutdownPromise;
  const startedAt = Date.now();
  server.shutdownPromise = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      const pending = operationTracker?.snapshot?.() ?? { count: null, counts: {}, pendingActionIntentIds: [] };
      operationTracker?.abortKinds?.(['provider', 'connector'], Object.assign(new Error('Shutdown hard deadline.'), { code: 'SHUTDOWN_ABORT' }));
      server.closeAllConnections?.();
      logger?.log('error', 'runtime.shutdown.timed_out', {
        signal, component: 'runtime', resultStatus: 'failed', errorCode: 'SHUTDOWN_TIMEOUT',
        latencyMs: Date.now() - startedAt, deadlineMs: timeoutMs,
        inFlight: pending.counts, pendingActionIntentIds: pending.pendingActionIntentIds,
      });
      try { store.checkpoint('TRUNCATE'); } catch { /* hard-timeout cleanup is best effort */ }
      try { store.close(); } catch { /* hard-timeout cleanup is best effort */ }
      try { advisoryRuntime?.close?.(); } catch { /* hard-timeout cleanup is best effort */ }
      try { logger?.close?.(); } catch { /* hard-timeout cleanup is best effort */ }
      finish(() => reject(new AppError('SHUTDOWN_TIMEOUT', `Graceful shutdown exceeded ${timeoutMs}ms.`, 500, {
        signal, pending: pending.count, pendingActionIntentIds: pending.pendingActionIntentIds,
      })));
    }, timeoutMs);

    operationTracker?.stopAccepting?.();
    const initial = operationTracker?.snapshot?.() ?? { counts: {}, pendingActionIntentIds: [] };
    logger?.log('info', 'runtime.shutdown.started', {
      signal, component: 'runtime', resultStatus: 'draining', deadlineMs: timeoutMs,
      inFlight: initial.counts, pendingActionIntentIds: initial.pendingActionIntentIds,
    });
    const listenerClosed = closeListener(server);
    operationTracker?.abortKinds?.(['provider', 'connector'], Object.assign(new Error('RelayOS shutdown requested.'), { code: 'SHUTDOWN_ABORT' }));
    const operationsDrained = (operationTracker?.waitForIdle?.() ?? Promise.resolve()).then(() => {
      server.closeIdleConnections?.();
    });

    Promise.all([listenerClosed, operationsDrained])
      .then(() => {
        if (settled) return;
        const checkpoint = store.checkpoint('TRUNCATE');
        assert(checkpoint.busy === 0, 'WAL_CHECKPOINT_BUSY', 'WAL checkpoint 在 shutdown 时仍 busy。', 500, checkpoint);
        store.close();
        advisoryRuntime?.close?.();
        const elapsed = Date.now() - startedAt;
        assert(elapsed <= timeoutMs, 'SHUTDOWN_TIMEOUT', `Graceful shutdown exceeded ${timeoutMs}ms.`, 500);
        logger?.log('info', 'runtime.shutdown.completed', {
          signal, component: 'runtime', resultStatus: 'completed', latencyMs: elapsed,
          journalMode: 'wal', inFlight: {},
        });
        logger?.close?.();
        finish(() => resolve({ signal, checkpoint, elapsedMs: elapsed, pendingActionIntentIds: [] }));
      })
      .catch((error) => {
        if (settled) return;
        logger?.log('error', 'runtime.shutdown.failed', {
          signal, component: 'runtime', resultStatus: 'failed',
          errorCode: error.code ?? 'SHUTDOWN_FAILED', latencyMs: Date.now() - startedAt,
        });
        finish(() => reject(error));
      });
  });
  return server.shutdownPromise;
}

export function registerShutdownSignals(requestShutdown, emitter = process) {
  if (typeof requestShutdown !== 'function') throw new TypeError('requestShutdown must be a function.');
  const handlers = new Map([
    ['SIGINT', () => requestShutdown('SIGINT')],
    ['SIGTERM', () => requestShutdown('SIGTERM')],
  ]);
  for (const [signal, handler] of handlers) emitter.on(signal, handler);
  return () => {
    for (const [signal, handler] of handlers) emitter.removeListener(signal, handler);
  };
}
