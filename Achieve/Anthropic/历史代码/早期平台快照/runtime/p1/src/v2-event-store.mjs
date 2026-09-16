import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  V2Error,
  canonicalV2Json,
  planV2Command,
  validateV2CommandEnvelope,
  validateV2Identity,
  validateV2InternalCommandEnvelope,
} from './v2-commands.mjs';
import {
  V2_EVENT_TYPES,
  createV2SampleEvents,
  replayV2Events,
} from './v2-projection.mjs';
import { scenarioPacks } from './v2-scenarios.mjs';

const MODEL_RUN_EVENT_TYPES = new Set([
  'ModelRunRequested',
  'ModelRunStarted',
  'ModelRunArtifactProduced',
  'ModelRunCompleted',
  'ModelRunFailed',
  'ModelRunUnknown',
  'ModelRunCancelRequested',
  'ModelRunCancelled',
]);

const EVENT_FIELDS = Object.freeze([
  'eventId',
  'sequence',
  'type',
  'occurredAt',
  'actorId',
  'payload',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function storeError(message, details = {}) {
  return new V2Error(503, 'EVENT_STORE_UNAVAILABLE', message, details);
}

function integrityError(message, details = {}) {
  return new V2Error(500, 'EVENT_STORE_INTEGRITY', message, details);
}

function workNotFound(identity) {
  return new V2Error(404, 'WORK_NOT_FOUND', '未找到指定的协同事项。', clone(identity));
}

function projectionVersionConflict(expected, current, idempotencyKey) {
  return new V2Error(
    409,
    'PROJECTION_VERSION_CONFLICT',
    '期望投影版本与当前权威投影不一致，请刷新后重试。',
    {
      expectedProjectionVersion: expected,
      currentProjectionVersion: current,
      idempotencyKey,
    },
  );
}

function idempotencyConflict(idempotencyKey) {
  return new V2Error(
    409,
    'IDEMPOTENCY_CONFLICT',
    '同一幂等键已绑定不同的规范化请求，拒绝写入。',
    { idempotencyKey },
  );
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) {
    throw new V2Error(400, 'VALIDATION_ERROR', '输入必须为对象。', { field: name });
  }
}

function assertKeys(value, keys, name) {
  const keySet = new Set(keys);
  const actual = Object.keys(value);
  if (actual.length !== keySet.size || actual.some((key) => !keySet.has(key))) {
    throw new V2Error(
      400,
      'VALIDATION_ERROR',
      '输入字段与契约不一致。',
      { field: name, expectedFields: [...keys], actualFields: actual },
    );
  }
}

function requireId(value, name) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new V2Error(
      400,
      'VALIDATION_ERROR',
      '输入文本长度不在允许范围内。',
      { field: name },
    );
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return value;
}

function rowToEvent(row) {
  let payload;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    throw integrityError('事件载荷不是有效数据，已拒绝重建投影。', {
      workspaceId: row.workspace_id,
      workId: row.work_id,
      sequence: row.sequence,
    });
  }
  assertPlainObject(payload, '事件载荷');
  assertPlainObject(payload.identity, '事件身份');
  if (
    payload.identity.workspaceId !== row.workspace_id
    || payload.identity.workId !== row.work_id
  ) {
    throw integrityError('事件行身份与载荷身份不一致，已拒绝重建投影。', {
      rowIdentity: {
        workspaceId: row.workspace_id,
        workId: row.work_id,
      },
      payloadIdentity: clone(payload.identity),
      sequence: row.sequence,
    });
  }
  return {
    eventId: row.event_id,
    sequence: row.sequence,
    type: row.type,
    occurredAt: row.occurred_at,
    actorId: row.actor_id,
    payload,
  };
}

function sameEvent(left, right) {
  return left.eventId === right.eventId
    && left.sequence === right.sequence
    && left.type === right.type
    && left.occurredAt === right.occurredAt
    && left.actorId === right.actorId
    && canonicalV2Json(left.payload) === canonicalV2Json(right.payload);
}

export class V2EventStore {
  constructor({ dbPath, clock, eventIdFactory, idFactory } = {}) {
    if (typeof dbPath !== 'string' || dbPath.length === 0) {
      throw new V2Error(400, 'VALIDATION_ERROR', '数据库路径必须为非空字符串。', {
        field: 'dbPath',
      });
    }
    const factory = eventIdFactory ?? idFactory;
    if (factory !== undefined && typeof factory !== 'function') {
      throw new V2Error(400, 'VALIDATION_ERROR', '事件标识工厂必须为函数。', {
        field: 'eventIdFactory',
      });
    }
    if (clock !== undefined && typeof clock !== 'function') {
      throw new V2Error(400, 'VALIDATION_ERROR', '时间工厂必须为函数。', { field: 'clock' });
    }

    this.dbPath = dbPath;
    this.clock = clock ?? (() => new Date().toISOString());
    this.eventIdFactory = factory ?? (() => randomUUID());
    this.closed = false;
    this.db = null;

    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    try {
      this.db = new DatabaseSync(dbPath);
      this.#initializeDatabase();
    } catch (error) {
      if (this.db) this.db.close();
      this.db = null;
      this.closed = true;
      if (error instanceof V2Error) throw error;
      throw storeError('事件存储初始化失败。', { reason: error.message });
    }
  }

  #initializeDatabase() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS v2_events (
        workspace_id TEXT NOT NULL,
        work_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        event_id TEXT NOT NULL,
        type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload TEXT NOT NULL CHECK (
          json_valid(payload)
          AND json_type(payload, '$.identity.workspaceId') = 'text'
          AND json_type(payload, '$.identity.workId') = 'text'
          AND json_extract(payload, '$.identity.workspaceId') = workspace_id
          AND json_extract(payload, '$.identity.workId') = work_id
        ),
        command_id TEXT,
        idempotency_key TEXT,
        PRIMARY KEY (workspace_id, work_id, sequence),
        UNIQUE (workspace_id, work_id, event_id),
        UNIQUE (event_id)
      );
      CREATE INDEX IF NOT EXISTS v2_events_work_type_idx
        ON v2_events (workspace_id, work_id, type);

      CREATE TABLE IF NOT EXISTS v2_command_receipts (
        workspace_id TEXT NOT NULL,
        work_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        result_body TEXT NOT NULL CHECK (json_valid(result_body)),
        created_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, work_id, idempotency_key)
      );

      CREATE TRIGGER IF NOT EXISTS v2_events_no_update
      BEFORE UPDATE ON v2_events
      BEGIN
        SELECT RAISE(ABORT, 'v2_events is append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS v2_events_no_delete
      BEFORE DELETE ON v2_events
      BEGIN
        SELECT RAISE(ABORT, 'v2_events is append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS v2_events_sequence_continuous
      BEFORE INSERT ON v2_events
      WHEN NEW.sequence != COALESCE((
        SELECT MAX(sequence) + 1
        FROM v2_events
        WHERE workspace_id = NEW.workspace_id AND work_id = NEW.work_id
      ), 1)
      BEGIN
        SELECT RAISE(ABORT, 'v2_events sequence must be continuous');
      END;
      CREATE TRIGGER IF NOT EXISTS v2_receipts_no_update
      BEFORE UPDATE ON v2_command_receipts
      BEGIN
        SELECT RAISE(ABORT, 'v2_command_receipts is append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS v2_receipts_no_delete
      BEFORE DELETE ON v2_command_receipts
      BEGIN
        SELECT RAISE(ABORT, 'v2_command_receipts is append-only');
      END;
    `);

    const tables = this.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map((row) => row.name);
    const allowed = new Set(['v2_command_receipts', 'v2_events']);
    if (tables.some((name) => !allowed.has(name))) {
      throw integrityError('数据库中存在事件与收据之外的持久化表，拒绝启动。', {
        tables,
      });
    }
  }

  close() {
    if (!this.closed && this.db) {
      this.db.close();
      this.db = null;
      this.closed = true;
    }
  }

  #requireOpen() {
    if (this.closed || !this.db) {
      throw storeError('SQLite事件存储已关闭。', { reason: 'database is closed' });
    }
  }

  #runTransaction(operation) {
    this.#requireOpen();
    this.db.exec('BEGIN IMMEDIATE');
    let committed = false;
    try {
      const value = operation();
      this.db.exec('COMMIT');
      committed = true;
      return value;
    } catch (error) {
      if (!committed) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          // 保留原始失败，避免掩盖事务前的异常。
        }
      }
      throw error;
    }
  }

  #safeTransaction(operation) {
    try {
      return this.#runTransaction(operation);
    } catch (error) {
      if (error instanceof V2Error) throw error;
      throw storeError('事件存储事务失败，已回滚全部未提交写入。', {
        reason: error.message,
      });
    }
  }

  #readRows(identity) {
    const rows = this.db.prepare(`
      SELECT workspace_id, work_id, sequence, event_id, type, actor_id, occurred_at, payload
      FROM v2_events
      WHERE workspace_id = ? AND work_id = ?
      ORDER BY sequence
    `).all(identity.workspaceId, identity.workId);
    return rows.map(rowToEvent);
  }

  #replayRows(rows, identity) {
    if (rows.length === 0) throw workNotFound(identity);
    for (let index = 0; index < rows.length; index += 1) {
      if (rows[index].sequence !== index + 1) {
        throw integrityError('事件序号不连续，已拒绝重建投影。', {
          expectedSequence: index + 1,
          actualSequence: rows[index].sequence,
        });
      }
    }
    try {
      const projection = replayV2Events(rows);
      if (
        projection.projectionIdentity.workspaceId !== identity.workspaceId
        || projection.projectionIdentity.workId !== identity.workId
        || projection.projectionVersion !== rows.at(-1).sequence
        || projection.eventCursor !== rows.at(-1).sequence
      ) {
        throw new Error('投影身份、版本或事件游标校验失败');
      }
      return deepFreeze(projection);
    } catch (error) {
      if (error instanceof V2Error) throw error;
      throw integrityError('事件链重放失败，已拒绝返回投影。', {
        reason: error.message,
      });
    }
  }

  getEvents(identity) {
    this.#requireOpen();
    const normalizedIdentity = validateV2Identity(identity);
    try {
      const rows = this.#readRows(normalizedIdentity);
      if (rows.length === 0) throw workNotFound(normalizedIdentity);
      this.#replayRows(rows, normalizedIdentity);
      return deepFreeze(rows);
    } catch (error) {
      if (error instanceof V2Error) throw error;
      throw storeError('读取事件链失败。', { reason: error.message });
    }
  }

  replayProjection(identity) {
    this.#requireOpen();
    const normalizedIdentity = validateV2Identity(identity);
    try {
      return this.#replayRows(this.#readRows(normalizedIdentity), normalizedIdentity);
    } catch (error) {
      if (error instanceof V2Error) throw error;
      throw storeError('重放权威投影失败。', { reason: error.message });
    }
  }

  getProjection(identity) {
    return this.replayProjection(identity);
  }

  listWorks({ workspaceId } = {}) {
    this.#requireOpen();
    if (workspaceId !== undefined) requireId(workspaceId, 'workspaceId');
    return this.#safeTransaction(() => {
      const identities = this.db.prepare(`
        SELECT workspace_id, work_id, MIN(rowid) AS first_rowid
        FROM v2_events
        WHERE (? IS NULL OR workspace_id = ?)
        GROUP BY workspace_id, work_id
        ORDER BY first_rowid, workspace_id, work_id
      `).all(workspaceId ?? null, workspaceId ?? null);

      return identities.map(({ workspace_id, work_id }) => {
        const identity = { workspaceId: workspace_id, workId: work_id };
        const projection = this.#replayRows(this.#readRows(identity), identity);
        return deepFreeze({
          identity,
          dataOrigin: projection.dataOrigin,
          scenarioId: projection.scenario.id,
          scenarioDisplayName: projection.scenario.displayName,
          title: projection.work.title,
          status: projection.work.status,
          statusLabel: projection.work.statusLabel,
          ownerActorId: projection.work.ownerActorId,
          goalVersion: projection.work.goalVersion,
          projectionVersion: projection.projectionVersion,
          eventCursor: projection.eventCursor,
          updatedAt: projection.work.updatedAt,
        });
      });
    });
  }

  seedScenarioSamples() {
    this.#requireOpen();
    let seededCount = 0;
    let alreadyPresentCount = 0;

    this.#safeTransaction(() => {
      for (const pack of scenarioPacks) {
        const expectedEvents = createV2SampleEvents(pack.id);
        const identity = validateV2Identity(expectedEvents[0].payload.identity);
        const existing = this.#readRows(identity);
        if (existing.length > 0) {
          const sameFrozenPrefix = existing.length >= expectedEvents.length
            && expectedEvents.every((expected, index) => sameEvent(existing[index], expected));
          if (!sameFrozenPrefix) {
            throw new V2Error(
              409,
              'INVALID_TRANSITION',
              '样例事件链已存在但与冻结定义不一致，拒绝覆盖。',
              {
                identity,
                existingEventCount: existing.length,
                expectedEventCount: expectedEvents.length,
              },
            );
          }
          alreadyPresentCount += 1;
          continue;
        }

        this.#replayRows(expectedEvents, identity);
        for (const event of expectedEvents) {
          this.#insertEvent(event, {
            commandId: `seed:${pack.id}`,
            idempotencyKey: null,
          });
        }
        seededCount += 1;
      }
    });

    return {
      seededCount,
      alreadyPresentCount,
      totalCount: scenarioPacks.length,
    };
  }

  #now() {
    const occurredAt = this.clock();
    if (typeof occurredAt !== 'string' || occurredAt.length === 0) {
      throw new V2Error(400, 'VALIDATION_ERROR', '事件时间必须为非空字符串。', {
        field: 'occurredAt',
      });
    }
    return occurredAt;
  }

  #newEventId() {
    const eventId = this.eventIdFactory();
    return requireId(eventId, 'eventId');
  }

  #materializeDrafts(projection, drafts, { modelRunEventsOnly = false } = {}) {
    if (!Array.isArray(drafts) || drafts.length === 0) {
      throw new V2Error(400, 'VALIDATION_ERROR', '计划事件必须为非空数组。', {
        field: 'plannedEvents',
      });
    }
    const identity = clone(projection.projectionIdentity);
    return drafts.map((draft, index) => {
      assertPlainObject(draft, 'plannedEvents项');
      assertKeys(draft, ['type', 'actorId', 'payload'], 'plannedEvents项');
      const type = requireId(draft.type, 'plannedEvents项.type');
      const actorId = requireId(draft.actorId, 'plannedEvents项.actorId');
      assertPlainObject(draft.payload, 'plannedEvents项.payload');
      if (!V2_EVENT_TYPES.includes(type)) {
        throw new V2Error(400, 'VALIDATION_ERROR', '计划事件类型不在当前事件语义内。', {
          eventType: type,
        });
      }
      if (modelRunEventsOnly && !MODEL_RUN_EVENT_TYPES.has(type)) {
        throw new V2Error(
          403,
          'AUTHORITY_DENIED',
          '内部计划事件入口只允许追加模型运行生命周期事件。',
          { eventType: type },
        );
      }
      const sequence = projection.eventCursor + index + 1;
      if (modelRunEventsOnly && type === 'ModelRunRequested') {
        const actualProjectionVersion = draft.payload.projectionVersion;
        if (!Number.isInteger(actualProjectionVersion) || actualProjectionVersion !== sequence) {
          throw new V2Error(
            400,
            'VALIDATION_ERROR',
            '模型运行请求事件的投影版本必须等于该事件写入后的序号。',
            {
              field: `plannedEvents[${index}].payload.projectionVersion`,
              eventIndex: index,
              eventType: type,
              expectedProjectionVersion: sequence,
              actualProjectionVersion: actualProjectionVersion ?? null,
            },
          );
        }
      }
      if (draft.payload.identity !== undefined) {
        const draftIdentity = validateV2Identity(
          draft.payload.identity,
          'plannedEvents项.payload.identity',
        );
        if (
          draftIdentity.workspaceId !== identity.workspaceId
          || draftIdentity.workId !== identity.workId
        ) {
          throw new V2Error(
            400,
            'VALIDATION_ERROR',
            '计划事件身份与当前工作不一致。',
            { expectedIdentity: identity, actualIdentity: draftIdentity },
          );
        }
      }
      const payload = { identity, ...clone(draft.payload) };
      canonicalV2Json(payload);
      return {
        eventId: this.#newEventId(),
        sequence,
        type,
        occurredAt: this.#now(),
        actorId,
        payload,
      };
    });
  }

  #insertEvent(event, { commandId = null, idempotencyKey = null } = {}) {
    assertKeys(event, EVENT_FIELDS, 'event');
    requireId(event.eventId, 'event.eventId');
    if (!Number.isInteger(event.sequence) || event.sequence < 1) {
      throw new V2Error(400, 'VALIDATION_ERROR', '事件序号必须是正整数。', {
        field: 'event.sequence',
      });
    }
    requireId(event.type, 'event.type');
    requireId(event.actorId, 'event.actorId');
    if (typeof event.occurredAt !== 'string' || event.occurredAt.length === 0) {
      throw new V2Error(400, 'VALIDATION_ERROR', '事件时间必须为非空字符串。', {
        field: 'event.occurredAt',
      });
    }
    if (commandId !== null) requireId(commandId, 'event.commandId');
    if (idempotencyKey !== null) requireId(idempotencyKey, 'event.idempotencyKey');

    this.db.prepare(`
      INSERT INTO v2_events (
        workspace_id, work_id, sequence, event_id, type, actor_id, occurred_at, payload,
        command_id, idempotency_key
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.payload.identity.workspaceId,
      event.payload.identity.workId,
      event.sequence,
      event.eventId,
      event.type,
      event.actorId,
      event.occurredAt,
      canonicalV2Json(event.payload),
      commandId,
      idempotencyKey,
    );
  }

  #priorReceipt(identity, idempotencyKey, requestHash) {
    const prior = this.db.prepare(`
      SELECT request_hash, status_code, result_body
      FROM v2_command_receipts
      WHERE workspace_id = ? AND work_id = ? AND idempotency_key = ?
    `).get(identity.workspaceId, identity.workId, idempotencyKey);
    if (!prior) return null;
    if (prior.request_hash !== requestHash) throw idempotencyConflict(idempotencyKey);
    try {
      return JSON.parse(prior.result_body);
    } catch {
      throw integrityError('幂等成功收据损坏，已拒绝返回结果。', { idempotencyKey });
    }
  }

  #writeReceipt(identity, command, requestHash, result) {
    const body = canonicalV2Json(result);
    this.db.prepare(`
      INSERT INTO v2_command_receipts (
        workspace_id, work_id, idempotency_key, request_hash, status_code, result_body, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      identity.workspaceId,
      identity.workId,
      command.idempotencyKey,
      requestHash,
      200,
      body,
      this.#now(),
    );
  }

  commitCommand(request = {}) {
    this.#requireOpen();
    assertPlainObject(request, 'request');
    assertKeys(request, ['identity', 'actorId', 'command'], 'request');
    const { identity, actorId, command } = request;
    const normalizedIdentity = validateV2Identity(identity);
    requireId(actorId, 'actorId');
    const envelope = validateV2CommandEnvelope(command);
    const requestHash = sha256(canonicalV2Json({
      identity: normalizedIdentity,
      actorId,
      command: envelope,
    }));

    return this.#safeTransaction(() => {
      const prior = this.#priorReceipt(normalizedIdentity, envelope.idempotencyKey, requestHash);
      if (prior) return prior;

      const rows = this.#readRows(normalizedIdentity);
      const projection = this.#replayRows(rows, normalizedIdentity);
      if (projection.projectionVersion !== envelope.expectedProjectionVersion) {
        throw projectionVersionConflict(
          envelope.expectedProjectionVersion,
          projection.projectionVersion,
          envelope.idempotencyKey,
        );
      }

      const drafts = planV2Command(projection, actorId, envelope);
      const events = this.#materializeDrafts(projection, drafts);
      if (events.some((event) => MODEL_RUN_EVENT_TYPES.has(event.type))) {
        throw new V2Error(
          403,
          'AUTHORITY_DENIED',
          '外部命令不能绕过模型运行策略直接追加模型生命周期事件。',
          { commandType: envelope.type },
        );
      }
      const nextProjection = this.#replayRows([...rows, ...events], normalizedIdentity);
      for (const event of events) {
        this.#insertEvent(event, {
          commandId: envelope.commandId,
          idempotencyKey: envelope.idempotencyKey,
        });
      }
      const result = deepFreeze({
        accepted: true,
        eventIds: events.map((event) => event.eventId),
        projection: nextProjection,
      });
      this.#writeReceipt(normalizedIdentity, envelope, requestHash, result);
      return result;
    });
  }

  #normalizePlannedEvents(plannedEvents) {
    if (!Array.isArray(plannedEvents) || plannedEvents.length === 0) {
      throw new V2Error(400, 'VALIDATION_ERROR', '内部计划事件必须为非空数组。', {
        field: 'plannedEvents',
      });
    }
    return plannedEvents.map((draft) => {
      assertPlainObject(draft, 'plannedEvents项');
      assertKeys(draft, ['type', 'actorId', 'payload'], 'plannedEvents项');
      requireId(draft.type, 'plannedEvents项.type');
      requireId(draft.actorId, 'plannedEvents项.actorId');
      assertPlainObject(draft.payload, 'plannedEvents项.payload');
      canonicalV2Json(draft.payload);
      return clone(draft);
    });
  }

  commitPlannedEvents(request = {}) {
    this.#requireOpen();
    assertPlainObject(request, 'request');
    assertKeys(
      request,
      ['identity', 'actorId', 'command', 'plannedEvents'],
      'request',
    );
    const { identity, actorId, command, plannedEvents } = request;
    const normalizedIdentity = validateV2Identity(identity);
    requireId(actorId, 'actorId');
    const envelope = validateV2InternalCommandEnvelope(command);
    const drafts = this.#normalizePlannedEvents(plannedEvents);
    const requestHash = sha256(canonicalV2Json({
      identity: normalizedIdentity,
      actorId,
      command: envelope,
      plannedEvents: drafts,
    }));

    return this.#safeTransaction(() => {
      const prior = this.#priorReceipt(normalizedIdentity, envelope.idempotencyKey, requestHash);
      if (prior) return prior;

      const rows = this.#readRows(normalizedIdentity);
      const projection = this.#replayRows(rows, normalizedIdentity);
      if (projection.projectionVersion !== envelope.expectedProjectionVersion) {
        throw projectionVersionConflict(
          envelope.expectedProjectionVersion,
          projection.projectionVersion,
          envelope.idempotencyKey,
        );
      }

      const events = this.#materializeDrafts(projection, drafts, { modelRunEventsOnly: true });
      const nextProjection = this.#replayRows([...rows, ...events], normalizedIdentity);
      for (const event of events) {
        this.#insertEvent(event, {
          commandId: envelope.commandId,
          idempotencyKey: envelope.idempotencyKey,
        });
      }
      const result = deepFreeze({
        accepted: true,
        eventIds: events.map((event) => event.eventId),
        projection: nextProjection,
      });
      this.#writeReceipt(normalizedIdentity, envelope, requestHash, result);
      return result;
    });
  }

  appendPlannedEvents(request) {
    return this.commitPlannedEvents(request);
  }
}

export default V2EventStore;
