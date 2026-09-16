export function shutdownRelayServer(server, store, { signal = 'manual', timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error(`Graceful shutdown timed out after ${timeoutMs}ms.`), { code: 'SHUTDOWN_TIMEOUT', signal })), timeoutMs);
    server.close((error) => {
      if (error) {
        clearTimeout(timer);
        reject(error);
        return;
      }
      try {
        const checkpoint = store.checkpoint();
        store.close();
        clearTimeout(timer);
        resolve({ signal, checkpoint });
      } catch (closeError) {
        clearTimeout(timer);
        reject(closeError);
      }
    });
  });
}
