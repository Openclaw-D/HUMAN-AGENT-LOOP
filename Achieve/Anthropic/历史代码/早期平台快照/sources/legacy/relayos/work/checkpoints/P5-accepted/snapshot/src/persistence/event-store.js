import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { canonicalHash, canonicalJson, clone } from '../domain/canonical.js';
import { AppError, assert } from '../domain/errors.js';
import { applyBusinessEvent } from '../domain/kernel.js';
import { initializeSchema, PERSISTENCE_SCHEMA_VERSION } from './schema.js';

const ZERO_HASH = '0'.repeat(64);

function parseJson(value) {
  return JSON.parse(value);
}

function rowToEvent(row) {
  return {
    eventId: row.event_id,
    globalSequence: row.global_sequence,
    streamId: row.stream_id,
    streamVersion: row.stream_version,
    eventType: row.event_type,
    eventSchemaVersion: row.event_schema_version,
    payload: parseJson(row.payload_json),
    metadata: parseJson(row.metadata_json),
    occurredAt: row.occurred_at,
    payloadHash: row.payload_hash,
    previousEventHash: row.previous_event_hash,
    eventHash: row.event_hash,
  };
}

function eventWithoutHash(event) {
  const { eventHash: _ignored, ...body } = event;
  return body;
}

export class EventStore {
  constructor(databasePath, { faultInjector = null } = {}) {
    this.databasePath = resolve(databasePath);
    this.faultInjector = faultInjector;
    this.closed = false;
    mkdirSync(dirname(this.databasePath), { recursive: true });
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
    initializeSchema(this.db);
    this.preflightError = null;
    this.readiness();
  }

  get journalMode() {
    return this.db.prepare('PRAGMA journal_mode').get().journal_mode;
  }

  close() {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  checkpoint() {
    return this.db.prepare('PRAGMA wal_checkpoint(FULL)').get();
  }

  assertHealthy() {
    assert(this.preflightError === null, 'EVENT_CORRUPTION', '启动校验未通过，权威路径 fail closed。', 503, { cause: this.preflightError?.code ?? this.preflightError?.message });
  }

  findCommandReceipt(commandId) {
    this.assertHealthy();
    const row = this.db.prepare('SELECT command_hash, response_json FROM command_receipts WHERE command_id = ?').get(commandId);
    return row ? { commandHash: row.command_hash, response: parseJson(row.response_json) } : null;
  }

  findIdempotencyReceipt(streamId, idempotencyKey) {
    this.assertHealthy();
    const row = this.db.prepare('SELECT command_hash, response_json FROM command_receipts WHERE stream_id = ? AND idempotency_key = ?').get(streamId, idempotencyKey);
    return row ? { commandHash: row.command_hash, response: parseJson(row.response_json) } : null;
  }

  assertCommandPreconditions(streamId, { expectedStreamVersion, configurationVersion }) {
    this.assertHealthy();
    const stream = this.db.prepare('SELECT current_version, configuration_version FROM event_streams WHERE stream_id = ?').get(streamId);
    const currentVersion = stream?.current_version ?? 0;
    assert(currentVersion === expectedStreamVersion, 'VERSION_CONFLICT', `Expected stream version ${expectedStreamVersion}, current version is ${currentVersion}.`, 409, { expectedStreamVersion, currentStreamVersion: currentVersion });
    if (stream) assert(stream.configuration_version === configurationVersion, 'CONFIGURATION_VERSION_CONFLICT', 'configurationVersion 与 stream 不匹配。', 409);
    return { currentVersion, configurationVersion: stream?.configuration_version ?? configurationVersion };
  }

  executeCommand({ streamId, commandId, idempotencyKey, commandHash, expectedStreamVersion, configurationVersion, occurredAt, metadata, decide }) {
    this.assertHealthy();
    for (const [value, code, label] of [[streamId, 'STREAM_ID_REQUIRED', 'streamId'], [commandId, 'COMMAND_ID_REQUIRED', 'commandId'], [idempotencyKey, 'IDEMPOTENCY_KEY_REQUIRED', 'idempotencyKey'], [commandHash, 'COMMAND_HASH_REQUIRED', 'commandHash'], [occurredAt, 'OCCURRED_AT_INVALID', 'occurredAt']]) {
      assert(typeof value === 'string' && value.trim(), code, `${label} 必须是非空字符串。`);
    }
    assert(Number.isInteger(expectedStreamVersion) && expectedStreamVersion >= 0, 'EXPECTED_VERSION_REQUIRED', 'expectedStreamVersion 必须是非负整数。');
    assert(Number.isInteger(configurationVersion) && configurationVersion >= 1, 'CONFIGURATION_VERSION_INVALID', 'configurationVersion 必须是正整数。');
    assert(typeof decide === 'function', 'DECIDE_REQUIRED', 'executeCommand 需要 deterministic decide callback。', 500);

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const commandReceipt = this.db.prepare('SELECT command_hash, response_json FROM command_receipts WHERE command_id = ?').get(commandId);
      if (commandReceipt) {
        assert(commandReceipt.command_hash === commandHash, 'IDEMPOTENCY_CONFLICT', 'commandId 已用于不同 canonical payload。', 409);
        const response = parseJson(commandReceipt.response_json);
        this.db.exec('COMMIT');
        return response;
      }

      const keyReceipt = this.db.prepare('SELECT command_id, command_hash, response_json FROM command_receipts WHERE stream_id = ? AND idempotency_key = ?').get(streamId, idempotencyKey);
      if (keyReceipt) {
        assert(keyReceipt.command_hash === commandHash, 'IDEMPOTENCY_CONFLICT', 'idempotencyKey 已用于不同 canonical payload。', 409);
        const response = parseJson(keyReceipt.response_json);
        this.db.exec('COMMIT');
        return response;
      }

      const stream = this.db.prepare('SELECT current_version, configuration_version, last_event_hash FROM event_streams WHERE stream_id = ?').get(streamId);
      const currentVersion = stream?.current_version ?? 0;
      assert(currentVersion === expectedStreamVersion, 'VERSION_CONFLICT', `Expected stream version ${expectedStreamVersion}, current version is ${currentVersion}.`, 409, { expectedStreamVersion, currentStreamVersion: currentVersion });
      if (stream) assert(stream.configuration_version === configurationVersion, 'CONFIGURATION_VERSION_CONFLICT', 'configurationVersion 与 stream 不匹配。', 409);

      let state = null;
      if (currentVersion > 0) {
        const projection = this.db.prepare('SELECT projection_version, state_json, canonical_state_hash FROM work_case_projections WHERE stream_id = ?').get(streamId);
        assert(projection && projection.projection_version === currentVersion, 'PROJECTION_CORRUPT', 'projection 缺失或版本不匹配。', 500);
        state = parseJson(projection.state_json);
        assert(canonicalHash(state) === projection.canonical_state_hash, 'PROJECTION_CORRUPT', 'projection canonical hash 不匹配。', 500);
      }

      const drafts = decide(state === null ? null : clone(state));
      assert(Array.isArray(drafts) && drafts.length > 0, 'EVENT_REQUIRED', '每个成功 command 至少产生一个 BusinessEvent。', 500);
      const nextGlobalRow = this.db.prepare('SELECT COALESCE(MAX(global_sequence), 0) + 1 AS next_sequence FROM business_events').get();
      let globalSequence = nextGlobalRow.next_sequence;
      let streamVersion = currentVersion;
      let previousEventHash = stream?.last_event_hash ?? ZERO_HASH;
      const events = [];

      for (let index = 0; index < drafts.length; index += 1) {
        const draft = drafts[index];
        assert(draft && typeof draft.eventType === 'string' && draft.eventType && draft.payload && typeof draft.payload === 'object', 'EVENT_DRAFT_INVALID', 'event draft 必须包含 eventType/payload。', 500);
        streamVersion += 1;
        const event = {
          eventId: `${commandId}:${index + 1}`,
          globalSequence,
          streamId,
          streamVersion,
          eventType: draft.eventType,
          eventSchemaVersion: 1,
          payload: clone(draft.payload),
          metadata: clone(metadata ?? {}),
          occurredAt,
          payloadHash: canonicalHash(draft.payload),
          previousEventHash,
        };
        event.eventHash = canonicalHash(event);
        this.db.prepare(`
          INSERT INTO business_events (
            global_sequence, event_id, stream_id, stream_version, event_type,
            event_schema_version, payload_json, metadata_json, occurred_at,
            payload_hash, previous_event_hash, event_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(event.globalSequence, event.eventId, event.streamId, event.streamVersion, event.eventType, event.eventSchemaVersion, canonicalJson(event.payload), canonicalJson(event.metadata), event.occurredAt, event.payloadHash, event.previousEventHash, event.eventHash);
        state = applyBusinessEvent(state, event);
        events.push(event);
        previousEventHash = event.eventHash;
        globalSequence += 1;
      }
      this.faultInjector?.('after-event-append', { streamId, commandId });

      if (stream) {
        const update = this.db.prepare('UPDATE event_streams SET current_version = ?, last_event_hash = ?, updated_at = ? WHERE stream_id = ? AND current_version = ?').run(streamVersion, previousEventHash, occurredAt, streamId, currentVersion);
        assert(update.changes === 1, 'VERSION_CONFLICT', 'stream 在事务中发生并发变化。', 409);
      } else {
        this.db.prepare('INSERT INTO event_streams (stream_id, stream_type, current_version, configuration_version, last_event_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(streamId, 'work_case', streamVersion, configurationVersion, previousEventHash, occurredAt);
      }

      const lastGlobalSequence = events.at(-1).globalSequence;
      const canonicalStateHash = canonicalHash(state);
      this.db.prepare(`
        INSERT INTO work_case_projections (stream_id, projection_version, state_json, last_global_sequence, canonical_state_hash, rebuilt_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(stream_id) DO UPDATE SET
          projection_version = excluded.projection_version,
          state_json = excluded.state_json,
          last_global_sequence = excluded.last_global_sequence,
          canonical_state_hash = excluded.canonical_state_hash,
          rebuilt_at = excluded.rebuilt_at
      `).run(streamId, streamVersion, canonicalJson(state), lastGlobalSequence, canonicalStateHash, occurredAt);
      this.faultInjector?.('after-projection-update', { streamId, commandId });

      const response = {
        workCaseId: streamId,
        streamVersion,
        eventIds: events.map((event) => event.eventId),
        globalSequence: lastGlobalSequence,
        canonicalStateHash,
        state: clone(state),
        identityAssurance: metadata?.identityAssurance ?? null,
        demoActorRef: clone(metadata?.demoActorRef ?? null),
      };
      this.db.prepare('INSERT INTO command_receipts (command_id, stream_id, idempotency_key, command_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(commandId, streamId, idempotencyKey, commandHash, canonicalJson(response), occurredAt);
      this.faultInjector?.('after-command-receipt', { streamId, commandId });
      this.db.exec('COMMIT');
      return response;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* no active transaction */ }
      throw error;
    }
  }

  getProjection(streamId) {
    const row = this.db.prepare('SELECT stream_id, projection_version, state_json, last_global_sequence, canonical_state_hash, rebuilt_at FROM work_case_projections WHERE stream_id = ?').get(streamId);
    return row ? {
      workCaseId: row.stream_id,
      projectionVersion: row.projection_version,
      state: parseJson(row.state_json),
      lastGlobalSequence: row.last_global_sequence,
      canonicalStateHash: row.canonical_state_hash,
      rebuiltAt: row.rebuilt_at,
    } : null;
  }

  listProjections(filters = {}) {
    const projections = this.db.prepare('SELECT stream_id, projection_version, state_json, last_global_sequence, canonical_state_hash, rebuilt_at FROM work_case_projections ORDER BY stream_id').all().map((row) => ({
      workCaseId: row.stream_id,
      projectionVersion: row.projection_version,
      state: parseJson(row.state_json),
      lastGlobalSequence: row.last_global_sequence,
      canonicalStateHash: row.canonical_state_hash,
      rebuiltAt: row.rebuilt_at,
    }));
    return projections.filter((item) => (!filters.scenario || item.state.scenarioKey === filters.scenario)
      && (!filters.status || item.state.status === filters.status)
      && (!filters.owner || item.state.ownerActorRef?.id === filters.owner));
  }

  getEvents(streamId, { afterGlobalSequence = 0 } = {}) {
    return this.db.prepare(`
      SELECT global_sequence, event_id, stream_id, stream_version, event_type,
             event_schema_version, payload_json, metadata_json, occurred_at,
             payload_hash, previous_event_hash, event_hash
      FROM business_events
      WHERE stream_id = ? AND global_sequence > ?
      ORDER BY stream_version
    `).all(streamId, afterGlobalSequence).map(rowToEvent);
  }

  #validateAndReplay(events, { requireGlobalContinuity = false } = {}) {
    const streams = new Map();
    let expectedGlobal = 1;
    for (const event of events) {
      if (requireGlobalContinuity) assert(event.globalSequence === expectedGlobal, 'EVENT_CHAIN_CORRUPT', 'globalSequence 断号。', 500);
      expectedGlobal = event.globalSequence + 1;
      assert(event.eventSchemaVersion === 1, 'EVENT_SCHEMA_UNKNOWN', `未知 event schema ${event.eventSchemaVersion}。`, 500);
      const current = streams.get(event.streamId) ?? { version: 0, hash: ZERO_HASH, state: null, lastGlobalSequence: 0 };
      assert(event.streamVersion === current.version + 1, 'EVENT_CHAIN_CORRUPT', 'streamVersion 断号。', 500);
      assert(event.payloadHash === canonicalHash(event.payload), 'EVENT_CHAIN_CORRUPT', 'payloadHash 不匹配。', 500);
      assert(event.previousEventHash === current.hash, 'EVENT_CHAIN_CORRUPT', 'previousEventHash 不匹配。', 500);
      assert(event.eventHash === canonicalHash(eventWithoutHash(event)), 'EVENT_CHAIN_CORRUPT', 'eventHash 不匹配。', 500);
      const state = applyBusinessEvent(current.state, event);
      streams.set(event.streamId, { version: event.streamVersion, hash: event.eventHash, state, lastGlobalSequence: event.globalSequence });
    }
    return streams;
  }

  replayStream(streamId) {
    const events = this.getEvents(streamId);
    assert(events.length > 0, 'WORK_CASE_NOT_FOUND', `WorkCase ${streamId} 不存在。`, 404);
    const replayed = this.#validateAndReplay(events).get(streamId);
    return {
      workCaseId: streamId,
      projectionVersion: replayed.version,
      state: clone(replayed.state),
      lastGlobalSequence: replayed.lastGlobalSequence,
      canonicalStateHash: canonicalHash(replayed.state),
      rebuiltAt: null,
    };
  }

  verifyEventChain() {
    const events = this.db.prepare(`
      SELECT global_sequence, event_id, stream_id, stream_version, event_type,
             event_schema_version, payload_json, metadata_json, occurred_at,
             payload_hash, previous_event_hash, event_hash
      FROM business_events ORDER BY global_sequence
    `).all().map(rowToEvent);
    const replayed = this.#validateAndReplay(events, { requireGlobalContinuity: true });
    const streamRows = this.db.prepare('SELECT stream_id, current_version, last_event_hash FROM event_streams ORDER BY stream_id').all();
    assert(streamRows.length === replayed.size, 'EVENT_CHAIN_CORRUPT', 'event_streams 与 BusinessEvent stream 数量不一致。', 500);
    for (const row of streamRows) {
      const current = replayed.get(row.stream_id);
      assert(current && current.version === row.current_version && current.hash === row.last_event_hash, 'EVENT_CHAIN_CORRUPT', `stream tail ${row.stream_id} 不一致。`, 500);
      const projection = this.getProjection(row.stream_id);
      assert(projection && projection.projectionVersion === current.version && projection.canonicalStateHash === canonicalHash(current.state) && canonicalHash(projection.state) === projection.canonicalStateHash, 'PROJECTION_CORRUPT', `projection ${row.stream_id} 与 event replay 不一致。`, 500);
    }
    return { status: 'verified', eventCount: events.length, streamCount: replayed.size, projectionCount: streamRows.length };
  }

  rebuildProjections({ dropFirst = true } = {}) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const before = new Map(this.listProjections().map((item) => [item.workCaseId, item.canonicalStateHash]));
      const events = this.db.prepare(`
        SELECT global_sequence, event_id, stream_id, stream_version, event_type,
               event_schema_version, payload_json, metadata_json, occurred_at,
               payload_hash, previous_event_hash, event_hash
        FROM business_events ORDER BY global_sequence
      `).all().map(rowToEvent);
      const replayed = this.#validateAndReplay(events, { requireGlobalContinuity: true });
      for (const row of this.db.prepare('SELECT stream_id, current_version, last_event_hash FROM event_streams').all()) {
        const current = replayed.get(row.stream_id);
        assert(current && current.version === row.current_version && current.hash === row.last_event_hash, 'EVENT_CHAIN_CORRUPT', `stream tail ${row.stream_id} 不一致。`, 500);
      }
      if (dropFirst) this.db.exec('DELETE FROM work_case_projections');
      const results = [];
      const rebuiltAt = new Date(0).toISOString();
      for (const [streamId, current] of replayed) {
        const hash = canonicalHash(current.state);
        this.db.prepare(`
          INSERT INTO work_case_projections (stream_id, projection_version, state_json, last_global_sequence, canonical_state_hash, rebuilt_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(stream_id) DO UPDATE SET
            projection_version = excluded.projection_version,
            state_json = excluded.state_json,
            last_global_sequence = excluded.last_global_sequence,
            canonical_state_hash = excluded.canonical_state_hash,
            rebuilt_at = excluded.rebuilt_at
        `).run(streamId, current.version, canonicalJson(current.state), current.lastGlobalSequence, hash, rebuiltAt);
        results.push({ streamId, beforeHash: before.get(streamId) ?? null, afterHash: hash, matches: before.has(streamId) ? before.get(streamId) === hash : null });
      }
      this.db.exec('COMMIT');
      this.preflightError = null;
      return { rebuilt: results.length, projections: results };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* no active transaction */ }
      throw error;
    }
  }

  readiness() {
    try {
      const schema = this.db.prepare('SELECT value FROM relay_meta WHERE key = ?').get('schema_version');
      assert(Number(schema?.value) === PERSISTENCE_SCHEMA_VERSION, 'SCHEMA_VERSION_UNSUPPORTED', 'persistence schema version 不支持。', 500);
      const eventChain = this.verifyEventChain();
      this.preflightError = null;
      return { status: 'ready', database: 'sqlite', journalMode: this.journalMode, schemaVersion: PERSISTENCE_SCHEMA_VERSION, eventChain, projections: { status: 'consistent', count: eventChain.projectionCount } };
    } catch (error) {
      this.preflightError = error;
      return { status: 'error', database: 'sqlite', journalMode: this.journalMode, schemaVersion: PERSISTENCE_SCHEMA_VERSION, eventChain: { status: 'error', code: error.code ?? 'INTERNAL_ERROR', message: error.message }, projections: { status: 'unknown' } };
    }
  }

  getStats() {
    return {
      streams: this.db.prepare('SELECT COUNT(*) AS count FROM event_streams').get().count,
      events: this.db.prepare('SELECT COUNT(*) AS count FROM business_events').get().count,
      projections: this.db.prepare('SELECT COUNT(*) AS count FROM work_case_projections').get().count,
      commandReceipts: this.db.prepare('SELECT COUNT(*) AS count FROM command_receipts').get().count,
    };
  }
}
