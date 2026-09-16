export const PERSISTENCE_SCHEMA_VERSION = 1;

export function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS relay_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS event_streams (
      stream_id TEXT PRIMARY KEY,
      stream_type TEXT NOT NULL,
      current_version INTEGER NOT NULL CHECK (current_version >= 1),
      configuration_version INTEGER NOT NULL CHECK (configuration_version >= 1),
      last_event_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS business_events (
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

    CREATE INDEX IF NOT EXISTS idx_business_events_stream_global
    ON business_events(stream_id, global_sequence);

    CREATE TABLE IF NOT EXISTS command_receipts (
      command_id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      command_hash TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (stream_id) REFERENCES event_streams(stream_id),
      UNIQUE (stream_id, idempotency_key)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS work_case_projections (
      stream_id TEXT PRIMARY KEY,
      projection_version INTEGER NOT NULL CHECK (projection_version >= 1),
      state_json TEXT NOT NULL,
      last_global_sequence INTEGER NOT NULL CHECK (last_global_sequence >= 1),
      canonical_state_hash TEXT NOT NULL,
      rebuilt_at TEXT NOT NULL,
      FOREIGN KEY (stream_id) REFERENCES event_streams(stream_id)
    ) STRICT;
  `);

  const row = db.prepare('SELECT value FROM relay_meta WHERE key = ?').get('schema_version');
  if (!row) {
    db.prepare('INSERT INTO relay_meta (key, value) VALUES (?, ?)').run('schema_version', String(PERSISTENCE_SCHEMA_VERSION));
  } else if (Number(row.value) !== PERSISTENCE_SCHEMA_VERSION) {
    throw new Error(`Unsupported persistence schema version ${row.value}.`);
  }
}
