import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { canonicalHash, canonicalJson } from './canonical.mjs';
import {
  P2Error,
  validationError,
  idempotencyConflict,
  versionConflict,
  integrityFailure,
  storageUnavailable,
  notFound,
} from './errors.mjs';
import { planCommand, validateCommandEnvelope, validateIdentity } from './commands.mjs';
import { replayEvents } from './projection.mjs';

const GENESIS_HASH = '0'.repeat(64);

function clone(value) {
  return structuredClone(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return value;
}

function requireOpen(store) {
  if (!store.#db) throw storageUnavailable('数据库已关闭。');
}

export class P2EventStore {
  constructor({ dbPath, clock, eventIdFactory } = {}) {
    if (typeof dbPath !== 'string' || dbPath.length === 0) {
      throw validationError('数据库路径必须为非空字符串。', { field: 'dbPath' });
    }
    if (clock !== undefined && typeof clock !== 'function') {
      throw validationError('时钟必须为函数。', { field: 'clock' });
    }
    if (eventIdFactory !== undefined && typeof eventIdFactory !== 'function') {
      throw validationError('事件标识工厂必须为函数。', { field: 'eventIdFactory' });
    }
    this.#clock = clock ?? (() => new Date().toISOString());
    this.#eventIdFactory = eventIdFactory ?? (() => crypto.randomUUID());
    this.#dbPath = dbPath;
    mkdirSync(dirname(dbPath), { recursive: true });
    this.#db = new DatabaseSync(dbPath);
    this.#db.exec('PRAGMA journal_mode = WAL;');
    this.#initSchema();
  }

  #db;
  #dbPath;
  #clock;
  #eventIdFactory;

  get dbPath() { return this.#dbPath; }
  get closed() { return this.#db === null; }

  #initSchema() {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS p2_events (
        workspace_id TEXT NOT NULL,
        case_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        prev_chain_hash TEXT NOT NULL,
        chain_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, case_id, sequence)
      );

      CREATE TABLE IF NOT EXISTS p2_command_receipts (
        workspace_id TEXT NOT NULL,
        case_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        result_body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, case_id, idempotency_key)
      );

      CREATE TRIGGER IF NOT EXISTS p2_events_no_update
        BEFORE UPDATE ON p2_events
      BEGIN
        SELECT RAISE(ABORT, 'p2_events is append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS p2_events_no_delete
        BEFORE DELETE ON p2_events
      BEGIN
        SELECT RAISE(ABORT, 'p2_events is append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS p2_receipts_no_update
        BEFORE UPDATE ON p2_command_receipts
      BEGIN
        SELECT RAISE(ABORT, 'p2_command_receipts is append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS p2_receipts_no_delete
        BEFORE DELETE ON p2_command_receipts
      BEGIN
        SELECT RAISE(ABORT, 'p2_command_receipts is append-only');
      END;
    `);
  }

  close() {
    if (this.#db) {
      try { this.#db.close(); } finally { this.#db = null; }
    }
  }

  #readRows(identity) {
    requireOpen(this);
    return this.#db.prepare(`
      SELECT sequence, event_id, type, occurred_at, actor_id, payload, prev_chain_hash, chain_hash
      FROM p2_events
      WHERE workspace_id = ? AND case_id = ?
      ORDER BY sequence ASC
    `).all(identity.workspaceId, identity.caseId);
  }

  #verifyAndParseRows(rows, identity) {
    let prevHash = GENESIS_HASH;
    const events = [];
    for (const row of rows) {
      let payload;
      try {
        payload = JSON.parse(row.payload);
      } catch {
        throw integrityFailure('事件载荷不是有效JSON。', {
          workspaceId: identity.workspaceId, caseId: identity.caseId, sequence: row.sequence,
        });
      }
      if (!isPlainObject(payload) || !isPlainObject(payload.identity)) {
        throw integrityFailure('事件载荷缺少identity。', { sequence: row.sequence });
      }
      if (payload.identity.workspaceId !== identity.workspaceId || payload.identity.caseId !== identity.caseId) {
        throw integrityFailure('事件行身份与载荷身份不一致。', { sequence: row.sequence });
      }
      const event = {
        eventId: row.event_id,
        sequence: row.sequence,
        type: row.type,
        occurredAt: row.occurred_at,
        actorId: row.actor_id,
        payload,
        prevChainHash: row.prev_chain_hash,
        chainHash: row.chain_hash,
      };
      if (event.prevChainHash !== prevHash) {
        throw integrityFailure('事件链prevChainHash不匹配，可能被篡改。', {
          sequence: event.sequence, expected: prevHash, actual: event.prevChainHash,
        });
      }
      const computedHash = canonicalHash({
        eventId: event.eventId,
        sequence: event.sequence,
        type: event.type,
        occurredAt: event.occurredAt,
        actorId: event.actorId,
        payload: event.payload,
        prevChainHash: event.prevChainHash,
      });
      if (computedHash !== event.chainHash) {
        throw integrityFailure('事件链hash不匹配，可能被篡改。', {
          sequence: event.sequence, expected: computedHash, actual: event.chainHash,
        });
      }
      prevHash = event.chainHash;
      events.push(event);
    }
    return events;
  }

  getEvents(identity) {
    const normalized = validateIdentity(identity);
    requireOpen(this);
    const rows = this.#readRows(normalized);
    if (rows.length === 0) return [];
    return this.#verifyAndParseRows(rows, normalized);
  }

  getProjection(identity) {
    const events = this.getEvents(identity);
    if (events.length === 0) return null;
    return deepFreeze(replayEvents(events));
  }

  listCases() {
    requireOpen(this);
    const rows = this.#db.prepare(`
      SELECT workspace_id, case_id, MIN(sequence) AS first_sequence
      FROM p2_events
      GROUP BY workspace_id, case_id
      ORDER BY workspace_id, case_id
    `).all();
    return rows.map((row) => {
      const identity = { workspaceId: row.workspace_id, caseId: row.case_id };
      const events = this.getEvents(identity);
      const first = events[0];
      return {
        identity,
        title: first?.payload?.case?.title ?? first?.payload?.case?.title ?? '未命名',
        scenarioId: first?.payload?.scenarioId ?? null,
        dataOrigin: first?.payload?.dataOrigin ?? 'user',
        version: events.length,
      };
    });
  }

  #insertEvent(identity, event) {
    requireOpen(this);
    this.#db.prepare(`
      INSERT INTO p2_events
        (workspace_id, case_id, sequence, event_id, type, occurred_at, actor_id, payload, prev_chain_hash, chain_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      identity.workspaceId,
      identity.caseId,
      event.sequence,
      event.eventId,
      event.type,
      event.occurredAt,
      event.actorId,
      canonicalJson(event.payload),
      event.prevChainHash,
      event.chainHash,
      this.#clock(),
    );
  }

  #materializeEvents(projection, drafts) {
    const events = [];
    let seq = projection.eventCursor;
    let prevHash = projection.chainHead ?? GENESIS_HASH;
    for (const draft of drafts) {
      seq += 1;
      const event = {
        eventId: this.#eventIdFactory(),
        sequence: seq,
        type: draft.type,
        occurredAt: this.#clock(),
        actorId: draft.actorId,
        payload: draft.payload,
        prevChainHash: prevHash,
        chainHash: null,
      };
      event.chainHash = canonicalHash({
        eventId: event.eventId,
        sequence: event.sequence,
        type: event.type,
        occurredAt: event.occurredAt,
        actorId: event.actorId,
        payload: event.payload,
        prevChainHash: event.prevChainHash,
      });
      prevHash = event.chainHash;
      events.push(event);
    }
    return events;
  }

  #priorReceipt(identity, idempotencyKey, requestHash) {
    requireOpen(this);
    const row = this.#db.prepare(`
      SELECT request_hash, status_code, result_body
      FROM p2_command_receipts
      WHERE workspace_id = ? AND case_id = ? AND idempotency_key = ?
    `).get(identity.workspaceId, identity.caseId, idempotencyKey);
    if (!row) return null;
    if (row.request_hash !== requestHash) {
      throw idempotencyConflict('同一幂等键已绑定不同的规范化请求。', { idempotencyKey });
    }
    return deepFreeze(JSON.parse(row.result_body));
  }

  #writeReceipt(identity, envelope, requestHash, result) {
    requireOpen(this);
    this.#db.prepare(`
      INSERT INTO p2_command_receipts
        (workspace_id, case_id, idempotency_key, request_hash, status_code, result_body, created_at)
      VALUES (?, ?, ?, ?, 200, ?, ?)
    `).run(
      identity.workspaceId,
      identity.caseId,
      envelope.idempotencyKey,
      requestHash,
      JSON.stringify(result),
      this.#clock(),
    );
  }

  commitCommand(request) {
    requireOpen(this);
    if (!isPlainObject(request)) {
      throw validationError('请求必须为对象。', { field: 'request' });
    }
    const required = ['identity', 'actorId', 'command'];
    for (const key of required) {
      if (!Object.hasOwn(request, key)) {
        throw validationError('请求缺少必要字段。', { field: `request.${key}` });
      }
    }
    const identity = validateIdentity(request.identity);
    if (typeof request.actorId !== 'string' || request.actorId.length < 1 || request.actorId.length > 128) {
      throw validationError('actorId必须为1..128字符的字符串。', { field: 'actorId' });
    }
    const envelope = validateCommandEnvelope(request.command);
    const requestHash = canonicalHash({ identity, actorId: request.actorId, command: envelope });

    return this.#safeTransaction(() => {
      const prior = this.#priorReceipt(identity, envelope.idempotencyKey, requestHash);
      if (prior) return prior;

      const rows = this.#readRows(identity);
      const events = this.#verifyAndParseRows(rows, identity);
      if (events.length === 0) {
        throw notFound('协同事项不存在。', { identity });
      }
      const projection = replayEvents(events);
      if (projection.version !== envelope.expectedVersion) {
        throw versionConflict('期望版本与当前权威版本不一致。', {
          expectedVersion: envelope.expectedVersion,
          currentVersion: projection.version,
        });
      }

      const drafts = planCommand(projection, request.actorId, envelope);
      const newEvents = this.#materializeEvents(projection, drafts);
      const nextProjection = replayEvents([...events, ...newEvents]);

      this.#db.exec('BEGIN');
      try {
        for (const event of newEvents) {
          this.#insertEvent(identity, event);
        }
        const result = deepFreeze({
          accepted: true,
          eventIds: newEvents.map((e) => e.eventId),
          projection: nextProjection,
        });
        this.#writeReceipt(identity, envelope, requestHash, result);
        this.#db.exec('COMMIT');
        return result;
      } catch (error) {
        this.#db.exec('ROLLBACK');
        throw error;
      }
    });
  }

  commitModelRunEvents(request) {
    requireOpen(this);
    if (!isPlainObject(request)) {
      throw validationError('请求必须为对象。', { field: 'request' });
    }
    const required = ['identity', 'actorId', 'command', 'plannedEvents'];
    for (const key of required) {
      if (!Object.hasOwn(request, key)) {
        throw validationError('请求缺少必要字段。', { field: `request.${key}` });
      }
    }
    const identity = validateIdentity(request.identity);
    if (typeof request.actorId !== 'string' || request.actorId.length < 1) {
      throw validationError('actorId必须为非空字符串。', { field: 'actorId' });
    }
    const envelope = validateCommandEnvelope(request.command);
    if (envelope.type !== 'model_run') {
      throw validationError('内部命令type必须为model_run。', { field: 'command.type' });
    }
    if (!Array.isArray(request.plannedEvents) || request.plannedEvents.length === 0) {
      throw validationError('plannedEvents必须为非空数组。', { field: 'plannedEvents' });
    }
    const requestHash = canonicalHash({
      identity,
      actorId: request.actorId,
      command: envelope,
      plannedEvents: request.plannedEvents,
    });

    return this.#safeTransaction(() => {
      const prior = this.#priorReceipt(identity, envelope.idempotencyKey, requestHash);
      if (prior) return prior;

      const rows = this.#readRows(identity);
      const events = this.#verifyAndParseRows(rows, identity);
      if (events.length === 0) {
        throw notFound('协同事项不存在。', { identity });
      }
      const projection = replayEvents(events);
      if (projection.version !== envelope.expectedVersion) {
        throw versionConflict('期望版本与当前权威版本不一致。', {
          expectedVersion: envelope.expectedVersion,
          currentVersion: projection.version,
        });
      }

      const newEvents = this.#materializeEvents(projection, request.plannedEvents);
      const nextProjection = replayEvents([...events, ...newEvents]);

      this.#db.exec('BEGIN');
      try {
        for (const event of newEvents) {
          this.#insertEvent(identity, event);
        }
        const result = deepFreeze({
          accepted: true,
          eventIds: newEvents.map((e) => e.eventId),
          projection: nextProjection,
        });
        this.#writeReceipt(identity, envelope, requestHash, result);
        this.#db.exec('COMMIT');
        return result;
      } catch (error) {
        this.#db.exec('ROLLBACK');
        throw error;
      }
    });
  }

  seedCase(identity, seedEvents) {
    requireOpen(this);
    if (!Array.isArray(seedEvents) || seedEvents.length === 0) {
      throw validationError('seedEvents必须为非空数组。', { field: 'seedEvents' });
    }
    const normalized = validateIdentity(identity);
    return this.#safeTransaction(() => {
      const existing = this.#readRows(normalized);
      if (existing.length > 0) return { seeded: false, eventCount: existing.length };

      let prevHash = GENESIS_HASH;
      this.#db.exec('BEGIN');
      try {
        for (let i = 0; i < seedEvents.length; i++) {
          const draft = seedEvents[i];
          if (!isPlainObject(draft) || typeof draft.type !== 'string' || typeof draft.actorId !== 'string') {
            throw validationError('seedEvents项必须包含type和actorId。', { index: i });
          }
          const event = {
            eventId: draft.eventId ?? this.#eventIdFactory(),
            sequence: i + 1,
            type: draft.type,
            occurredAt: draft.occurredAt ?? this.#clock(),
            actorId: draft.actorId,
            payload: draft.payload,
            prevChainHash: prevHash,
            chainHash: null,
          };
          event.chainHash = canonicalHash({
            eventId: event.eventId,
            sequence: event.sequence,
            type: event.type,
            occurredAt: event.occurredAt,
            actorId: event.actorId,
            payload: event.payload,
            prevChainHash: event.prevChainHash,
          });
          this.#insertEvent(normalized, event);
          prevHash = event.chainHash;
        }
        this.#db.exec('COMMIT');
        return { seeded: true, eventCount: seedEvents.length };
      } catch (error) {
        this.#db.exec('ROLLBACK');
        throw error;
      }
    });
  }

  #safeTransaction(fn) {
    try {
      return fn();
    } catch (error) {
      if (error instanceof P2Error) throw error;
      if (error?.message?.includes('SQLITE_CONSTRAINT') || error?.code?.startsWith('SQLITE_CONSTRAINT')) {
        throw integrityFailure('数据库约束拒绝写入。', { originalCode: error.code });
      }
      throw error;
    }
  }
}
