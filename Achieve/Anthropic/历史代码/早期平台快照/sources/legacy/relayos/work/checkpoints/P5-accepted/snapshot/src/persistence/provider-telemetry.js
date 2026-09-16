import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const TELEMETRY_KEYS = new Set([
  'invocationId', 'providerRequestId', 'providerId', 'model', 'operation',
  'promptVersion', 'evaluationVersion', 'outputSchemaVersion', 'traceId',
  'startedAt', 'completedAt', 'latencyMs', 'status', 'errorCategory',
  'promptTokens', 'completionTokens', 'totalTokens', 'cachedTokens', 'cost',
  'inputHash', 'outputHash',
]);

function requireExactRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new TypeError('Provider telemetry record must be an object.');
  const unknown = Object.keys(record).filter((key) => !TELEMETRY_KEYS.has(key));
  if (unknown.length > 0) throw new TypeError('Provider telemetry contains forbidden fields.');
  for (const key of ['invocationId', 'providerRequestId', 'providerId', 'model', 'operation', 'promptVersion', 'evaluationVersion', 'traceId', 'startedAt', 'completedAt', 'status', 'inputHash']) {
    if (typeof record[key] !== 'string' || !record[key]) throw new TypeError(`Provider telemetry ${key} is required.`);
  }
  if (!Number.isInteger(record.outputSchemaVersion) || !Number.isFinite(record.latencyMs) || record.latencyMs < 0) throw new TypeError('Provider telemetry version/latency is invalid.');
  if (!['succeeded', 'failed'].includes(record.status)) throw new TypeError('Provider telemetry status is invalid.');
  return record;
}

export class ProviderTelemetryRepository {
  constructor(databasePath = ':memory:') {
    this.databasePath = databasePath === ':memory:' ? databasePath : resolve(databasePath);
    if (this.databasePath !== ':memory:') mkdirSync(dirname(this.databasePath), { recursive: true });
    this.db = new DatabaseSync(this.databasePath);
    this.closed = false;
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS provider_invocations (
        invocation_id TEXT PRIMARY KEY,
        provider_request_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model TEXT NOT NULL,
        operation TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        evaluation_version TEXT NOT NULL,
        output_schema_version INTEGER NOT NULL,
        trace_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('succeeded', 'failed')),
        error_category TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        cached_tokens INTEGER,
        cost REAL,
        input_hash TEXT NOT NULL,
        output_hash TEXT
      ) STRICT;
    `);
  }

  record(rawRecord) {
    const record = requireExactRecord(structuredClone(rawRecord));
    this.db.prepare(`
      INSERT INTO provider_invocations (
        invocation_id, provider_request_id, provider_id, model, operation,
        prompt_version, evaluation_version, output_schema_version, trace_id,
        started_at, completed_at, latency_ms, status, error_category,
        prompt_tokens, completion_tokens, total_tokens, cached_tokens, cost,
        input_hash, output_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.invocationId, record.providerRequestId, record.providerId, record.model, record.operation,
      record.promptVersion, record.evaluationVersion, record.outputSchemaVersion, record.traceId,
      record.startedAt, record.completedAt, Math.floor(record.latencyMs), record.status, record.errorCategory ?? null,
      record.promptTokens ?? null, record.completionTokens ?? null, record.totalTokens ?? null, record.cachedTokens ?? null,
      record.cost ?? null, record.inputHash, record.outputHash ?? null,
    );
  }

  count() {
    return this.db.prepare('SELECT COUNT(*) AS count FROM provider_invocations').get().count;
  }

  list() {
    return this.db.prepare(`
      SELECT invocation_id AS invocationId, provider_request_id AS providerRequestId,
             provider_id AS providerId, model, operation, prompt_version AS promptVersion,
             evaluation_version AS evaluationVersion, output_schema_version AS outputSchemaVersion,
             trace_id AS traceId, started_at AS startedAt, completed_at AS completedAt,
             latency_ms AS latencyMs, status, error_category AS errorCategory,
             prompt_tokens AS promptTokens, completion_tokens AS completionTokens,
             total_tokens AS totalTokens, cached_tokens AS cachedTokens, cost,
             input_hash AS inputHash, output_hash AS outputHash
      FROM provider_invocations ORDER BY rowid
    `).all();
  }

  health() {
    return { status: 'ready', storage: this.databasePath === ':memory:' ? 'memory' : 'independent_sqlite', count: this.count() };
  }

  close() {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }
}
