export class OperationTracker {
  constructor() {
    this.accepting = true;
    this.sequence = 0;
    this.operations = new Map();
    this.waiters = new Set();
  }

  begin(kind, metadata = {}, { abort = null } = {}) {
    const id = `${kind}:${++this.sequence}`;
    const operation = { id, kind, metadata: structuredClone(metadata), abort, startedAt: Date.now() };
    this.operations.set(id, operation);
    let ended = false;
    return {
      id,
      end: () => {
        if (ended) return;
        ended = true;
        this.operations.delete(id);
        if (this.operations.size === 0) {
          for (const resolve of this.waiters) resolve();
          this.waiters.clear();
        }
      },
    };
  }

  stopAccepting() {
    this.accepting = false;
  }

  abortKinds(kinds, reason = new Error('RelayOS is shutting down.')) {
    const allowed = new Set(kinds);
    for (const operation of this.operations.values()) {
      if (allowed.has(operation.kind)) {
        try { operation.abort?.(reason); } catch { /* abort is best effort */ }
      }
    }
  }

  snapshot() {
    const counts = {};
    const pendingActionIntentIds = [];
    for (const operation of this.operations.values()) {
      counts[operation.kind] = (counts[operation.kind] ?? 0) + 1;
      if (operation.metadata?.actionIntentId) pendingActionIntentIds.push(operation.metadata.actionIntentId);
    }
    return { accepting: this.accepting, count: this.operations.size, counts, pendingActionIntentIds: [...new Set(pendingActionIntentIds)].sort() };
  }

  waitForIdle() {
    if (this.operations.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.add(resolve));
  }
}
