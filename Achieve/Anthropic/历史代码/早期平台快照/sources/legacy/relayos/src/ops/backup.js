import { createHash, randomUUID } from 'node:crypto';
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import { AppError, assert } from '../domain/errors.js';
import { EventStore } from '../persistence/event-store.js';
import { PERSISTENCE_SCHEMA_VERSION } from '../persistence/schema.js';

export const BACKUP_MANIFEST_VERSION = 1;

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function sameAudit(left, right) {
  return left.schemaVersion === right.schemaVersion
    && JSON.stringify(left.counts) === JSON.stringify(right.counts)
    && left.eventChainDigest === right.eventChainDigest
    && left.projectionDigest === right.projectionDigest
    && left.commandReceiptDigest === right.commandReceiptDigest
    && left.idempotencyDigest === right.idempotencyDigest
    && JSON.stringify(left.canonicalHashes) === JSON.stringify(right.canonicalHashes);
}

function validateManifest(manifest) {
  assert(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'BACKUP_MANIFEST_INVALID', 'backup manifest 必须是对象。', 400);
  const allowed = new Set([
    'manifestVersion', 'createdAt', 'creationMethod', 'databaseFile', 'databaseSha256',
    'schemaVersion', 'counts', 'eventChainDigest', 'projectionDigest',
    'commandReceiptDigest', 'idempotencyDigest', 'canonicalHashes', 'secretMaterial',
  ]);
  const unknown = Object.keys(manifest).filter((key) => !allowed.has(key));
  assert(unknown.length === 0, 'BACKUP_MANIFEST_INVALID', 'backup manifest 含未知字段。', 400, { unknown });
  assert(manifest.manifestVersion === BACKUP_MANIFEST_VERSION, 'BACKUP_MANIFEST_INVALID', 'backup manifest version 不受支持。', 400);
  assert(manifest.creationMethod === 'node:sqlite.backup-online-consistent', 'BACKUP_MANIFEST_INVALID', 'backup creation method 不受支持。', 400);
  assert(manifest.schemaVersion === PERSISTENCE_SCHEMA_VERSION, 'BACKUP_SCHEMA_INCOMPATIBLE', 'backup schema 与当前 binary 不兼容。', 409);
  assert(typeof manifest.databaseSha256 === 'string' && /^[a-f0-9]{64}$/.test(manifest.databaseSha256), 'BACKUP_MANIFEST_INVALID', 'backup SHA-256 无效。', 400);
  assert(manifest.secretMaterial === 'excluded', 'BACKUP_MANIFEST_INVALID', 'backup manifest 必须显式声明 secret excluded。', 400);
  return structuredClone(manifest);
}

export async function createConsistentBackup({
  store,
  backupPath,
  manifestPath,
  clock = () => new Date().toISOString(),
}) {
  assert(store instanceof EventStore, 'BACKUP_SOURCE_INVALID', 'backup source 必须是 EventStore。', 500);
  const destination = resolve(backupPath);
  const manifestDestination = resolve(manifestPath);
  const token = `${process.pid}-${randomUUID()}`;
  const backupStaging = `${destination}.backup-${token}`;
  const manifestStaging = `${manifestDestination}.backup-${token}`;
  assert(!existsSync(destination), 'BACKUP_TARGET_EXISTS', 'backup target 必须是全新路径。', 409);
  assert(!existsSync(manifestDestination), 'BACKUP_MANIFEST_EXISTS', 'backup manifest target 必须是全新路径。', 409);
  const checkpoint = store.checkpoint('PASSIVE');
  let backupStore;
  mkdirSync(dirname(destination), { recursive: true });
  mkdirSync(dirname(manifestDestination), { recursive: true });
  let backupPublished = false;
  try {
    await store.backupTo(backupStaging);
    backupStore = new EventStore(backupStaging, { migrationMode: 'verify-only' });
    const audit = backupStore.auditSnapshot();
    const backupCheckpoint = backupStore.checkpoint('TRUNCATE');
    assert(backupCheckpoint.busy === 0, 'BACKUP_CHECKPOINT_BUSY', 'backup staging WAL checkpoint busy。', 500);
    backupStore.close();
    backupStore = null;
    const manifest = {
      manifestVersion: BACKUP_MANIFEST_VERSION,
      createdAt: clock(),
      creationMethod: 'node:sqlite.backup-online-consistent',
      databaseFile: basename(destination),
      databaseSha256: sha256File(backupStaging),
      schemaVersion: audit.schemaVersion,
      counts: audit.counts,
      eventChainDigest: audit.eventChainDigest,
      projectionDigest: audit.projectionDigest,
      commandReceiptDigest: audit.commandReceiptDigest,
      idempotencyDigest: audit.idempotencyDigest,
      canonicalHashes: audit.canonicalHashes,
      secretMaterial: 'excluded',
    };
    writeFileSync(manifestStaging, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    assert(!existsSync(destination), 'BACKUP_TARGET_EXISTS', 'backup target 在发布前已存在。', 409);
    assert(!existsSync(manifestDestination), 'BACKUP_MANIFEST_EXISTS', 'backup manifest target 在发布前已存在。', 409);
    renameSync(backupStaging, destination);
    backupPublished = true;
    renameSync(manifestStaging, manifestDestination);
    return { manifest, checkpoint };
  } catch (error) {
    if (backupPublished) {
      try { rmSync(destination, { force: true }); } catch { /* preserve original publication error */ }
    }
    throw error;
  } finally {
    backupStore?.close();
    for (const path of [backupStaging, `${backupStaging}-wal`, `${backupStaging}-shm`, manifestStaging]) {
      try { rmSync(path, { force: true }); } catch { /* preserve backup result */ }
    }
  }
}

export function restoreConsistentBackup({ backupPath, manifestPath, destinationPath }) {
  const source = resolve(backupPath);
  const destination = resolve(destinationPath);
  const staging = `${destination}.restore-${process.pid}-${randomUUID()}`;
  assert(existsSync(source), 'BACKUP_NOT_FOUND', 'backup file 不存在。', 404);
  assert(existsSync(resolve(manifestPath)), 'BACKUP_MANIFEST_NOT_FOUND', 'backup manifest 不存在。', 404);
  assert(!existsSync(destination), 'RESTORE_TARGET_EXISTS', 'restore target 必须是全新路径。', 409);
  assert(source !== destination, 'RESTORE_TARGET_INVALID', 'restore target 不能与 backup 相同。', 400);
  let manifest;
  try {
    manifest = validateManifest(JSON.parse(readFileSync(resolve(manifestPath), 'utf8')));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('BACKUP_MANIFEST_INVALID', 'backup manifest 不是有效 JSON。', 400);
  }
  assert(sha256File(source) === manifest.databaseSha256, 'BACKUP_HASH_MISMATCH', 'backup SHA-256 与 manifest 不一致。', 409);
  mkdirSync(dirname(destination), { recursive: true });
  let restored;
  try {
    copyFileSync(source, staging, constants.COPYFILE_EXCL);
    assert(sha256File(staging) === manifest.databaseSha256, 'RESTORE_COPY_HASH_MISMATCH', 'restore staging copy SHA-256 与 manifest 不一致。', 500);
    restored = new EventStore(staging, { migrationMode: 'verify-only' });
    const audit = restored.auditSnapshot();
    const expectedAudit = {
      schemaVersion: manifest.schemaVersion,
      counts: manifest.counts,
      eventChainDigest: manifest.eventChainDigest,
      projectionDigest: manifest.projectionDigest,
      commandReceiptDigest: manifest.commandReceiptDigest,
      idempotencyDigest: manifest.idempotencyDigest,
      canonicalHashes: manifest.canonicalHashes,
    };
    assert(sameAudit(audit, expectedAudit), 'RESTORE_VERIFICATION_FAILED', 'restore 后 event/projection/receipt/idempotency 证据不一致。', 500);
    const checkpoint = restored.checkpoint('TRUNCATE');
    assert(checkpoint.busy === 0, 'RESTORE_CHECKPOINT_BUSY', 'restore staging WAL checkpoint busy。', 500);
    restored.close();
    restored = null;
    renameSync(staging, destination);
    return { status: 'verified', destination, audit };
  } finally {
    restored?.close();
    for (const path of [staging, `${staging}-wal`, `${staging}-shm`]) {
      try { rmSync(path, { force: true }); } catch { /* do not mask restore verification error */ }
    }
  }
}
