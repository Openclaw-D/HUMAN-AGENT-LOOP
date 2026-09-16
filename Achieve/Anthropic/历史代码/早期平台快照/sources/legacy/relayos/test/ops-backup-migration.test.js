import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { RelayService } from '../src/application/service.js';
import { MockExternalSystemAdapter } from '../src/connectors/mock-adapter.js';
import { loadScenarioConfigs } from '../src/config/scenario-loader.js';
import { createConsistentBackup, restoreConsistentBackup } from '../src/ops/backup.js';
import { EventStore } from '../src/persistence/event-store.js';
import { createHarness, createWorkCase, dispatch, envelope, seedGoalAndContext } from './helpers.js';

const P5_ROOT = resolve('work/checkpoints/P5-accepted/snapshot');
const OLD_STORE_URL = pathToFileURL(resolve(P5_ROOT, 'src/persistence/event-store.js')).href;

async function createLegacyDatabase(databasePath, id = 'legacy-case') {
  const [{ EventStore: OldStore }, { RelayService: OldService }, { MockExternalSystemAdapter: OldAdapter }, { loadScenarioConfigs: oldLoadConfigs }] = await Promise.all([
    import(OLD_STORE_URL),
    import(pathToFileURL(resolve(P5_ROOT, 'src/application/service.js')).href),
    import(pathToFileURL(resolve(P5_ROOT, 'src/connectors/mock-adapter.js')).href),
    import(pathToFileURL(resolve(P5_ROOT, 'src/config/scenario-loader.js')).href),
  ]);
  const store = new OldStore(databasePath);
  const service = new OldService({
    store,
    scenarioConfigs: oldLoadConfigs(resolve('scenarios')),
    connector: new OldAdapter({ clock: () => '2026-08-26T00:00:00.000Z' }),
    clock: () => '2026-08-26T00:00:00.000Z',
  });
  const result = await service.executeCommand(id, envelope('workCase.create', {
    id, organizationId: 'org-demo', scenarioKey: 'supplyChain', title: 'legacy v1 migration source',
    ownerActorRef: { kind: 'human', id: 'human-owner' }, nextAction: 'migrate',
    trigger: {
      id: `${id}:trigger`, type: 'representativeTrigger', sourceRef: { systemId: 'core-system' },
      observedAt: '2026-08-26T00:00:00.000Z', dedupeKey: `legacy:${id}`,
      payloadRef: { systemId: 'core-system', recordType: 'legacy', recordId: id, observedVersion: '1' },
    },
    scenarioExtensions: {},
  }, 0));
  const stats = store.getStats();
  store.close();
  return { result, stats };
}

function schemaState(databasePath) {
  const db = new DatabaseSync(databasePath);
  try {
    return {
      version: db.prepare("SELECT value FROM relay_meta WHERE key='schema_version'").get()?.value ?? null,
      tables: db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name),
    };
  } finally { db.close(); }
}

function schemaObjects(databasePath) {
  const db = new DatabaseSync(databasePath);
  try {
    return db.prepare("SELECT type, name, tbl_name AS tableName, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
  } finally { db.close(); }
}

test('v1 to v2 migration succeeds without changing event/domain canonical state', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relayos-p6-migrate-success-'));
  const databasePath = join(directory, 'legacy.db');
  try {
    const before = await createLegacyDatabase(databasePath);
    assert.equal(schemaState(databasePath).version, '1');
    const store = new EventStore(databasePath, { schemaClock: () => '2026-08-26T06:00:00.000Z' });
    try {
      assert.deepEqual(store.schemaInitialization, { mode: 'migrated', fromVersion: 1, toVersion: 2, applied: ['schema-1-to-2'] });
      assert.equal(store.readiness().schemaVersion, 2);
      assert.equal(store.getProjection('legacy-case').canonicalStateHash, before.result.canonicalStateHash);
      assert.deepEqual(store.getStats(), before.stats);
    } finally { store.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('migration fault rolls back DDL and version atomically', async () => {
  for (const faultLabel of ['migration:1-to-2:after-ddl', 'migration:1-to-2:after-version-update']) {
    const directory = mkdtempSync(join(tmpdir(), 'relayos-p6-migrate-fault-'));
    const databasePath = join(directory, 'legacy.db');
    try {
      await createLegacyDatabase(databasePath, `legacy-fault-${faultLabel.split(':').at(-1)}`);
      const before = schemaState(databasePath);
      assert.throws(() => new EventStore(databasePath, { migrationFaultInjector(label) { if (label === faultLabel) throw new Error('fault'); } }), (error) => error.code === 'SCHEMA_MIGRATION_FAILED');
      const after = schemaState(databasePath);
      assert.deepEqual(after, before);
      assert.equal(after.tables.includes('schema_migrations'), false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});

test('partial v1 and non-table schema objects fail before migration or fresh initialization writes', () => {
  for (const mode of ['partial-v1', 'unknown-view']) {
    const directory = mkdtempSync(join(tmpdir(), `relayos-p6-schema-shape-${mode}-`));
    const databasePath = join(directory, 'shape.db');
    const db = new DatabaseSync(databasePath);
    if (mode === 'partial-v1') {
      db.exec('CREATE TABLE relay_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;');
      db.prepare('INSERT INTO relay_meta (key, value) VALUES (?, ?)').run('schema_version', '1');
    } else db.exec('CREATE VIEW unknown_view AS SELECT 1 AS value;');
    const before = db.prepare("SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
    db.close();
    try {
      const expectedCode = mode === 'partial-v1' ? 'SCHEMA_SHAPE_INVALID' : 'SCHEMA_VERSION_MISSING';
      assert.throws(() => new EventStore(databasePath), (error) => error.code === expectedCode);
      const check = new DatabaseSync(databasePath);
      assert.deepEqual(check.prepare("SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all(), before);
      check.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});

test('v1 DDL semantic drift is rejected before migration writes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relayos-p6-schema-ddl-drift-'));
  const databasePath = join(directory, 'drift.db');
  try {
    await createLegacyDatabase(databasePath, 'legacy-ddl-drift');
    const db = new DatabaseSync(databasePath);
    db.exec('PRAGMA writable_schema=ON');
    db.prepare("UPDATE sqlite_schema SET sql = replace(sql, ' CHECK (current_version >= 1)', '') WHERE type = 'table' AND name = 'event_streams'").run();
    db.exec('PRAGMA writable_schema=RESET');
    db.close();
    const before = schemaObjects(databasePath);
    assert.throws(() => new EventStore(databasePath), (error) => error.code === 'SCHEMA_SHAPE_INVALID');
    assert.deepEqual(schemaObjects(databasePath), before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('v2 migration ledger is a required readiness and startup integrity anchor', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relayos-p6-schema-ledger-'));
  const databasePath = join(directory, 'ledger.db');
  try {
    const store = new EventStore(databasePath);
    store.db.exec('DELETE FROM schema_migrations');
    assert.equal(store.readiness().status, 'error');
    assert.equal(store.readiness().eventChain.code, 'SCHEMA_MIGRATION_HISTORY_INVALID');
    store.close();
    assert.throws(() => new EventStore(databasePath, { migrationMode: 'verify-only' }), (error) => error.code === 'SCHEMA_MIGRATION_HISTORY_INVALID');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('missing command receipt makes readiness and backup fail closed', async () => {
  const harness = createHarness();
  const backupPath = join(harness.directory, 'must-not-exist.db');
  const manifestPath = join(harness.directory, 'must-not-exist.manifest.json');
  try {
    await createWorkCase(harness, { id: 'case-missing-receipt' });
    harness.store.db.exec('DELETE FROM command_receipts');
    assert.throws(() => harness.store.verifyCommandReceipts(), (error) => error.code === 'COMMAND_RECEIPT_CORRUPT');
    await assert.rejects(() => createConsistentBackup({ store: harness.store, backupPath, manifestPath }), (error) => error.code === 'EVENT_CORRUPTION');
    assert.equal(existsSync(backupPath), false);
    assert.equal(existsSync(manifestPath), false);
    const ready = harness.store.readiness();
    assert.equal(ready.status, 'error');
    assert.equal(ready.eventChain.code, 'COMMAND_RECEIPT_CORRUPT');
  } finally { harness.close(); }
});

test('missing, too-old and future schemas fail closed before adding RelayOS tables', () => {
  for (const mode of ['missing', 'old', 'future']) {
    const directory = mkdtempSync(join(tmpdir(), `relayos-p6-schema-${mode}-`));
    const databasePath = join(directory, 'schema.db');
    const db = new DatabaseSync(databasePath);
    if (mode === 'missing') db.exec('CREATE TABLE unknown_table (id INTEGER) STRICT;');
    else {
      db.exec('CREATE TABLE relay_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;');
      db.prepare('INSERT INTO relay_meta (key, value) VALUES (?, ?)').run('schema_version', mode === 'old' ? '0' : '999');
    }
    const before = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    db.close();
    try {
      const expected = mode === 'missing' ? 'SCHEMA_VERSION_MISSING' : mode === 'old' ? 'SCHEMA_VERSION_TOO_OLD' : 'SCHEMA_VERSION_FUTURE';
      assert.throws(() => new EventStore(databasePath), (error) => error.code === expected);
      const check = new DatabaseSync(databasePath);
      assert.deepEqual(check.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all(), before);
      check.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});

test('P5 old binary explicitly rejects a P6 v2 database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relayos-p6-old-binary-'));
  const databasePath = join(directory, 'v2.db');
  try {
    const store = new EventStore(databasePath);
    store.close();
    const result = spawnSync(process.execPath, [resolve('test/fixtures/open-event-store.mjs'), OLD_STORE_URL, databasePath], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unsupported persistence schema version 2/);
    const current = new EventStore(databasePath, { migrationMode: 'verify-only' });
    assert.equal(current.readiness().status, 'ready');
    current.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('online backup restores event/hash/projection/receipt/idempotency to a new path', async () => {
  class CountingAdapter extends MockExternalSystemAdapter {
    constructor() { super({ clock: () => '2026-08-26T00:10:00.000Z' }); this.executeCount = 0; }
    async execute(intent, options) { this.executeCount += 1; return super.execute(intent, options); }
  }
  const harness = createHarness({ connector: new CountingAdapter() });
  const id = 'case-backup-restore';
  const backupPath = join(harness.directory, 'online-backup.db');
  const manifestPath = join(harness.directory, 'online-backup.manifest.json');
  const restorePath = join(harness.directory, 'restored', 'relayos.db');
  const secretCanary = 'runtime-secret-canary-p6-never-persist';
  let restoredStore;
  try {
    await createWorkCase(harness, { id });
    await seedGoalAndContext(harness, id);
    await dispatch(harness, id, 'action.propose', {
      id: 'backup-action', systemId: 'core-system', operation: 'update',
      inputRef: { simulateStatus: 'unknown' }, requiredGateIds: [], idempotencyKey: 'backup-external-idem',
    });
    await dispatch(harness, id, 'action.authorize', { actionIntentId: 'backup-action' });
    const version = harness.store.getProjection(id).projectionVersion;
    const executeEnvelope = envelope('action.execute', { actionIntentId: 'backup-action' }, version, { kind: 'human', id: 'human-owner' }, {
      commandId: 'backup-action-execute', idempotencyKey: 'backup-command-idem', traceId: 'trace-backup-action',
    });
    const executed = await harness.service.executeCommand(id, executeEnvelope);
    assert.equal(executed.state.executionReceipts.at(-1).status, 'unknown');
    const before = harness.store.auditSnapshot();
    const created = await createConsistentBackup({ store: harness.store, backupPath, manifestPath, clock: () => '2026-08-26T06:30:00.000Z' });
    assert.equal(created.manifest.creationMethod, 'node:sqlite.backup-online-consistent');
    assert.equal(created.manifest.schemaVersion, 2);
    assert.deepEqual(created.manifest.counts, before.counts);
    assert.equal(readFileSync(backupPath).includes(Buffer.from(secretCanary)), false);
    assert.equal(readFileSync(manifestPath, 'utf8').includes(secretCanary), false);
    const tamperedManifestPath = join(harness.directory, 'tampered-logical.manifest.json');
    const rejectedRestorePath = join(harness.directory, 'rejected', 'relayos.db');
    writeFileSync(tamperedManifestPath, `${JSON.stringify({
      ...created.manifest,
      counts: { ...created.manifest.counts, streams: created.manifest.counts.streams + 1 },
    }, null, 2)}\n`);
    assert.throws(() => restoreConsistentBackup({ backupPath, manifestPath: tamperedManifestPath, destinationPath: rejectedRestorePath }), (error) => error.code === 'RESTORE_VERIFICATION_FAILED');
    assert.equal(existsSync(rejectedRestorePath), false);
    assert.equal(readdirSync(dirname(rejectedRestorePath)).some((name) => name.startsWith(`${basename(rejectedRestorePath)}.restore-`)), false);
    const restored = restoreConsistentBackup({ backupPath, manifestPath, destinationPath: restorePath });
    assert.deepEqual(restored.audit, before);

    restoredStore = new EventStore(restorePath, { migrationMode: 'verify-only' });
    const adapter = new CountingAdapter();
    const restoredService = new RelayService({ store: restoredStore, scenarioConfigs: loadScenarioConfigs(resolve('scenarios')), connector: adapter, clock: () => '2026-08-26T00:00:00.000Z' });
    const retry = { ...structuredClone(executeEnvelope), commandId: 'backup-action-retry', expectedStreamVersion: 999 };
    assert.deepEqual(await restoredService.executeCommand(id, retry), executed);
    assert.equal(adapter.executeCount, 0);
    const hashBeforeRebuild = restoredStore.getProjection(id).canonicalStateHash;
    restoredStore.db.exec('DELETE FROM work_case_projections');
    restoredStore.rebuildProjections({ dropFirst: false });
    assert.equal(restoredStore.getProjection(id).canonicalStateHash, hashBeforeRebuild);
  } finally {
    restoredStore?.close();
    harness.close();
  }
});
