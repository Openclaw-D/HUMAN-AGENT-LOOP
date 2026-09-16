import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { SERVICE_NAME, SERVICE_VERSION } from '../version.js';
import { containsCredential } from './credential-scan.js';

const LEVEL_RANK = new Map([['debug', 10], ['info', 20], ['warn', 30], ['error', 40]]);
const FIELD_ALLOWLIST = new Set([
  'traceId', 'commandId', 'workCaseId', 'eventIds', 'streamVersion', 'component',
  'operation', 'authority', 'resultStatus', 'providerStatus', 'adapterStatus',
  'latencyMs', 'errorCode', 'httpMethod', 'httpPath', 'httpStatus', 'signal',
  'deadlineMs', 'inFlight', 'schemaVersion', 'journalMode', 'host', 'port',
  'identityAssurance', 'delivery', 'pendingActionIntentIds',
]);
const SENSITIVE_TEXT = /-----BEGIN [A-Z ]+PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]+|\bsk-[A-Za-z0-9_-]+|(?:api[_-]?key|authorization|cookie|password|secret|token)\s*[:=]\s*\S+/i;
const SENSITIVE_KEY = /authorization|apikey|cookie|password|secret|token|prompt|response/i;

function sensitiveKey(key) {
  return SENSITIVE_KEY.test(String(key).replace(/[^a-z0-9]/gi, ''));
}

function safeValue(value) {
  if (typeof value === 'string') return SENSITIVE_TEXT.test(value) || containsCredential(value) ? '[REDACTED]' : value.slice(0, 512);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !sensitiveKey(key)).slice(0, 50).map(([key, nested]) => [key, safeValue(nested)]));
  }
  return null;
}

export class JsonlLogger {
  constructor({
    level = 'info',
    path = '-',
    clock = () => new Date().toISOString(),
    sink = null,
  } = {}) {
    if (!LEVEL_RANK.has(level)) throw new TypeError('Invalid JSONL log level.');
    this.level = level;
    this.path = path === '-' ? path : resolve(path);
    this.clock = clock;
    this.closed = false;
    this.lastError = null;
    this.failureCount = 0;
    if (this.path !== '-') mkdirSync(dirname(this.path), { recursive: true });
    this.sink = sink ?? ((line) => {
      if (this.path === '-') process.stdout.write(line);
      else appendFileSync(this.path, line, { encoding: 'utf8' });
    });
  }

  log(level, event, fields = {}) {
    if (this.closed || LEVEL_RANK.get(level) < LEVEL_RANK.get(this.level)) return false;
    const record = {
      timestamp: this.clock(),
      level,
      service: SERVICE_NAME,
      serviceVersion: SERVICE_VERSION,
      event: safeValue(event),
      authority: safeValue(fields.authority ?? 'not_applicable'),
      resultStatus: safeValue(fields.resultStatus ?? 'observed'),
      latencyMs: Number.isFinite(fields.latencyMs) ? Math.max(0, Math.round(fields.latencyMs)) : 0,
      errorCode: safeValue(fields.errorCode ?? null),
    };
    for (const [key, value] of Object.entries(fields)) {
      if (FIELD_ALLOWLIST.has(key)) record[key] = safeValue(value);
    }
    try {
      this.sink(`${JSON.stringify(record)}\n`);
      return true;
    } catch (error) {
      this.lastError = error;
      this.failureCount += 1;
      return false;
    }
  }

  health() {
    return this.lastError
      ? { status: 'degraded', sink: this.path === '-' ? 'stdout' : 'jsonl_file', errorCode: 'LOG_SINK_FAILED', failureCount: this.failureCount }
      : { status: 'ready', sink: this.path === '-' ? 'stdout' : 'jsonl_file' };
  }

  close() {
    this.closed = true;
  }
}

export function createJsonlLogger(options) {
  return new JsonlLogger(options);
}
