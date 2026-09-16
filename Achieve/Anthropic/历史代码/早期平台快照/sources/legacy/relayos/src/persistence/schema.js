import { AppError } from '../domain/errors.js';

export const PERSISTENCE_SCHEMA_VERSION = 2;
export const MIN_MIGRATABLE_SCHEMA_VERSION = 1;

const VERSION_ONE_SCHEMA = `
  CREATE TABLE relay_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;

  CREATE TABLE event_streams (
    stream_id TEXT PRIMARY KEY,
    stream_type TEXT NOT NULL,
    current_version INTEGER NOT NULL CHECK (current_version >= 1),
    configuration_version INTEGER NOT NULL CHECK (configuration_version >= 1),
    last_event_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE business_events (
    global_sequence INTEGER PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    stream_id TEXT NOT NULL,
    stream_version INTEGER NOT NULL CHECK (stream_version >= 1),
    event_type TEXT NOT NULL,
    event_schema_version INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    previous_event_hash TEXT NOT NULL,
    event_hash TEXT NOT NULL UNIQUE,
    FOREIGN KEY (stream_id) REFERENCES event_streams(stream_id) DEFERRABLE INITIALLY DEFERRED,
    UNIQUE (stream_id, stream_version)
  ) STRICT;

  CREATE INDEX idx_business_events_stream_global
  ON business_events(stream_id, global_sequence);

  CREATE TABLE command_receipts (
    command_id TEXT PRIMARY KEY,
    stream_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    command_hash TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (stream_id) REFERENCES event_streams(stream_id),
    UNIQUE (stream_id, idempotency_key)
  ) STRICT;

  CREATE TABLE work_case_projections (
    stream_id TEXT PRIMARY KEY,
    projection_version INTEGER NOT NULL CHECK (projection_version >= 1),
    state_json TEXT NOT NULL,
    last_global_sequence INTEGER NOT NULL CHECK (last_global_sequence >= 1),
    canonical_state_hash TEXT NOT NULL,
    rebuilt_at TEXT NOT NULL,
    FOREIGN KEY (stream_id) REFERENCES event_streams(stream_id)
  ) STRICT;
`;

const VERSION_TWO_SCHEMA = `
  CREATE TABLE schema_migrations (
    migration_id TEXT PRIMARY KEY,
    from_version INTEGER NOT NULL,
    to_version INTEGER NOT NULL UNIQUE,
    applied_at TEXT NOT NULL,
    CHECK (to_version = from_version + 1)
  ) STRICT;
`;

const TABLE_COLUMNS = Object.freeze({
  relay_meta: [
    ['key', 'TEXT', 1, 1], ['value', 'TEXT', 1, 0],
  ],
  event_streams: [
    ['stream_id', 'TEXT', 1, 1], ['stream_type', 'TEXT', 1, 0],
    ['current_version', 'INTEGER', 1, 0], ['configuration_version', 'INTEGER', 1, 0],
    ['last_event_hash', 'TEXT', 1, 0], ['updated_at', 'TEXT', 1, 0],
  ],
  business_events: [
    ['global_sequence', 'INTEGER', 0, 1], ['event_id', 'TEXT', 1, 0],
    ['stream_id', 'TEXT', 1, 0], ['stream_version', 'INTEGER', 1, 0],
    ['event_type', 'TEXT', 1, 0], ['event_schema_version', 'INTEGER', 1, 0],
    ['payload_json', 'TEXT', 1, 0], ['metadata_json', 'TEXT', 1, 0],
    ['occurred_at', 'TEXT', 1, 0], ['payload_hash', 'TEXT', 1, 0],
    ['previous_event_hash', 'TEXT', 1, 0], ['event_hash', 'TEXT', 1, 0],
  ],
  command_receipts: [
    ['command_id', 'TEXT', 1, 1], ['stream_id', 'TEXT', 1, 0],
    ['idempotency_key', 'TEXT', 1, 0], ['command_hash', 'TEXT', 1, 0],
    ['response_json', 'TEXT', 1, 0], ['created_at', 'TEXT', 1, 0],
  ],
  work_case_projections: [
    ['stream_id', 'TEXT', 1, 1], ['projection_version', 'INTEGER', 1, 0],
    ['state_json', 'TEXT', 1, 0], ['last_global_sequence', 'INTEGER', 1, 0],
    ['canonical_state_hash', 'TEXT', 1, 0], ['rebuilt_at', 'TEXT', 1, 0],
  ],
  schema_migrations: [
    ['migration_id', 'TEXT', 1, 1], ['from_version', 'INTEGER', 1, 0],
    ['to_version', 'INTEGER', 1, 0], ['applied_at', 'TEXT', 1, 0],
  ],
});

const TABLE_INDEXES = Object.freeze({
  relay_meta: ['pk:1:key'],
  event_streams: ['pk:1:stream_id'],
  business_events: ['c:0:stream_id,global_sequence', 'u:1:event_hash', 'u:1:event_id', 'u:1:stream_id,stream_version'],
  command_receipts: ['pk:1:command_id', 'u:1:stream_id,idempotency_key'],
  work_case_projections: ['pk:1:stream_id'],
  schema_migrations: ['pk:1:migration_id', 'u:1:to_version'],
});

const TABLE_FOREIGN_KEYS = Object.freeze({
  relay_meta: [],
  event_streams: [],
  business_events: ['stream_id:event_streams:stream_id:NO ACTION:NO ACTION:NONE'],
  command_receipts: ['stream_id:event_streams:stream_id:NO ACTION:NO ACTION:NONE'],
  work_case_projections: ['stream_id:event_streams:stream_id:NO ACTION:NO ACTION:NONE'],
  schema_migrations: [],
});

function normalizeSchemaSql(sql) {
  return String(sql).trim().replace(/\s+/g, ' ').toLowerCase();
}

function declaredSchemaSql(version) {
  const source = version >= 2 ? `${VERSION_ONE_SCHEMA}\n${VERSION_TWO_SCHEMA}` : VERSION_ONE_SCHEMA;
  return source.split(';').map((statement) => statement.trim()).filter(Boolean).map((statement) => {
    const match = statement.match(/^CREATE\s+(TABLE|INDEX)\s+([a-z0-9_]+)/i);
    if (!match) throw new Error('Internal schema declaration contains an unsupported statement.');
    return [`${match[1].toLowerCase()}:${match[2]}`, normalizeSchemaSql(statement)];
  }).sort((left, right) => left[0].localeCompare(right[0], 'en'));
}

function userSchemaObjects(db) {
  return db.prepare(`
    SELECT type, name, tbl_name AS tableName, sql
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all();
}

function userTables(db) {
  return userSchemaObjects(db).filter((row) => row.type === 'table').map((row) => row.name).sort();
}

function indexSignatures(db, table) {
  return db.prepare(`PRAGMA index_list(${table})`).all().map((index) => {
    const columns = db.prepare(`PRAGMA index_info(${index.name})`).all().map((row) => row.name).join(',');
    return `${index.origin}:${index.unique}:${columns}`;
  }).sort();
}

function foreignKeySignatures(db, table) {
  return db.prepare(`PRAGMA foreign_key_list(${table})`).all().map((row) => (
    `${row.from}:${row.table}:${row.to}:${row.on_update}:${row.on_delete}:${row.match}`
  )).sort();
}

function assertSchemaShape(db, version) {
  const tableNames = Object.keys(TABLE_COLUMNS).filter((name) => version >= 2 || name !== 'schema_migrations').sort();
  const expectedObjects = [
    ...tableNames.map((name) => `table:${name}:${name}`),
    'index:idx_business_events_stream_global:business_events',
  ].sort();
  const actualObjects = userSchemaObjects(db).map((row) => `${row.type}:${row.name}:${row.tableName}`).sort();
  if (JSON.stringify(actualObjects) !== JSON.stringify(expectedObjects)) {
    throw new AppError('SCHEMA_SHAPE_INVALID', `RelayOS schema ${version} objects 不完整或含未知对象；拒绝迁移/启动。`, 500, {
      expectedObjectCount: expectedObjects.length,
      actualObjectCount: actualObjects.length,
    });
  }
  const actualSql = userSchemaObjects(db).map((row) => [`${row.type}:${row.name}`, normalizeSchemaSql(row.sql)])
    .sort((left, right) => left[0].localeCompare(right[0], 'en'));
  if (JSON.stringify(actualSql) !== JSON.stringify(declaredSchemaSql(version))) {
    throw new AppError('SCHEMA_SHAPE_INVALID', `RelayOS schema ${version} DDL 语义与当前 binary 不匹配；拒绝迁移/启动。`, 500);
  }
  const strictTables = new Map(db.prepare('PRAGMA table_list').all().map((row) => [row.name, row.strict]));
  for (const table of tableNames) {
    const columns = db.prepare(`PRAGMA table_xinfo(${table})`).all().map((row) => [row.name, row.type, row.notnull, row.pk]);
    if (JSON.stringify(columns) !== JSON.stringify(TABLE_COLUMNS[table]) || strictTables.get(table) !== 1) {
      throw new AppError('SCHEMA_SHAPE_INVALID', `RelayOS schema ${version} table ${table} shape 不匹配；拒绝迁移/启动。`, 500);
    }
    if (JSON.stringify(indexSignatures(db, table)) !== JSON.stringify([...TABLE_INDEXES[table]].sort())) {
      throw new AppError('SCHEMA_SHAPE_INVALID', `RelayOS schema ${version} table ${table} index 不匹配；拒绝迁移/启动。`, 500);
    }
    if (JSON.stringify(foreignKeySignatures(db, table)) !== JSON.stringify([...TABLE_FOREIGN_KEYS[table]].sort())) {
      throw new AppError('SCHEMA_SHAPE_INVALID', `RelayOS schema ${version} table ${table} foreign key 不匹配；拒绝迁移/启动。`, 500);
    }
  }
  if (version >= 2) {
    const migrations = db.prepare('SELECT migration_id, from_version, to_version, applied_at FROM schema_migrations ORDER BY to_version').all();
    const valid = migrations.length === 1
      && migrations[0].migration_id === 'schema-1-to-2'
      && migrations[0].from_version === 1
      && migrations[0].to_version === 2
      && typeof migrations[0].applied_at === 'string'
      && migrations[0].applied_at.length > 0
      && migrations[0].applied_at === migrations[0].applied_at.trim();
    if (!valid) throw new AppError('SCHEMA_MIGRATION_HISTORY_INVALID', 'schema migration history 缺失、歧义或与当前 binary 不匹配；拒绝启动/写入。', 500);
  }
}

function readVersion(db) {
  const objects = userSchemaObjects(db);
  if (objects.length === 0) return null;
  if (!objects.some((row) => row.type === 'table' && row.name === 'relay_meta')) {
    throw new AppError('SCHEMA_VERSION_MISSING', '数据库包含未知表但缺少 RelayOS schema version；拒绝启动。', 500);
  }
  const row = db.prepare('SELECT value FROM relay_meta WHERE key = ?').get('schema_version');
  if (!row || !/^\d+$/.test(row.value)) {
    throw new AppError('SCHEMA_VERSION_INVALID', 'RelayOS schema version 缺失或无效；拒绝启动。', 500);
  }
  return Number(row.value);
}

function transaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* no active transaction */ }
    throw error;
  }
}

function createFreshSchema(db, appliedAt) {
  return transaction(db, () => {
    db.exec(VERSION_ONE_SCHEMA);
    db.prepare('INSERT INTO relay_meta (key, value) VALUES (?, ?)').run('schema_version', String(MIN_MIGRATABLE_SCHEMA_VERSION));
    db.exec(VERSION_TWO_SCHEMA);
    db.prepare('INSERT INTO schema_migrations (migration_id, from_version, to_version, applied_at) VALUES (?, ?, ?, ?)')
      .run('schema-1-to-2', 1, 2, appliedAt);
    db.prepare('UPDATE relay_meta SET value = ? WHERE key = ?').run(String(PERSISTENCE_SCHEMA_VERSION), 'schema_version');
    assertSchemaShape(db, PERSISTENCE_SCHEMA_VERSION);
    return { mode: 'fresh', fromVersion: 0, toVersion: PERSISTENCE_SCHEMA_VERSION, applied: ['schema-1-to-2'] };
  });
}

function migrateOneToTwo(db, { appliedAt, faultInjector }) {
  return transaction(db, () => {
    db.exec(VERSION_TWO_SCHEMA);
    faultInjector?.('migration:1-to-2:after-ddl');
    db.prepare('INSERT INTO schema_migrations (migration_id, from_version, to_version, applied_at) VALUES (?, ?, ?, ?)')
      .run('schema-1-to-2', 1, 2, appliedAt);
    db.prepare('UPDATE relay_meta SET value = ? WHERE key = ?').run('2', 'schema_version');
    faultInjector?.('migration:1-to-2:after-version-update');
    assertSchemaShape(db, 2);
    return { mode: 'migrated', fromVersion: 1, toVersion: 2, applied: ['schema-1-to-2'] };
  });
}

export function initializeSchema(db, {
  migrationMode = 'auto',
  faultInjector = null,
  clock = () => new Date().toISOString(),
} = {}) {
  if (!['auto', 'verify-only'].includes(migrationMode)) {
    throw new AppError('SCHEMA_CONFIGURATION_INVALID', 'migrationMode 必须是 auto 或 verify-only。', 500);
  }
  const initialVersion = readVersion(db);
  if (initialVersion === null) {
    if (migrationMode === 'verify-only') {
      throw new AppError('SCHEMA_INITIALIZATION_REQUIRED', 'verify-only 模式拒绝初始化空数据库。', 500);
    }
    return createFreshSchema(db, clock());
  }
  if (initialVersion > PERSISTENCE_SCHEMA_VERSION) {
    throw new AppError('SCHEMA_VERSION_FUTURE', `数据库 schema version ${initialVersion} 高于当前 binary 支持的 ${PERSISTENCE_SCHEMA_VERSION}；拒绝启动。`, 500);
  }
  if (initialVersion < MIN_MIGRATABLE_SCHEMA_VERSION) {
    throw new AppError('SCHEMA_VERSION_TOO_OLD', `数据库 schema version ${initialVersion} 低于可迁移下限 ${MIN_MIGRATABLE_SCHEMA_VERSION}；拒绝启动。`, 500);
  }
  assertSchemaShape(db, initialVersion);
  if (initialVersion === PERSISTENCE_SCHEMA_VERSION) {
    return { mode: 'verified', fromVersion: initialVersion, toVersion: initialVersion, applied: [] };
  }
  if (migrationMode === 'verify-only') {
    throw new AppError('SCHEMA_MIGRATION_REQUIRED', `数据库 schema version ${initialVersion} 需要迁移到 ${PERSISTENCE_SCHEMA_VERSION}。`, 500);
  }
  if (initialVersion === 1) {
    try {
      return migrateOneToTwo(db, { appliedAt: clock(), faultInjector });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('SCHEMA_MIGRATION_FAILED', 'schema 1→2 migration 失败并已原子回滚。', 500, { fromVersion: 1, toVersion: 2 });
    }
  }
  throw new AppError('SCHEMA_VERSION_UNSUPPORTED', `数据库 schema version ${initialVersion} 不受支持。`, 500);
}

export function readSchemaHistory(db) {
  const version = readVersion(db);
  if (version === null) throw new AppError('SCHEMA_VERSION_MISSING', 'RelayOS schema version 缺失；拒绝 readiness。', 500);
  assertSchemaShape(db, version);
  const migrations = userTables(db).includes('schema_migrations')
    ? db.prepare('SELECT migration_id AS migrationId, from_version AS fromVersion, to_version AS toVersion, applied_at AS appliedAt FROM schema_migrations ORDER BY to_version').all()
    : [];
  return { schemaVersion: version, migrations };
}
