import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { containsCredential as scanCredential, isAllowedSyntheticCredential } from '../src/observability/credential-scan.js';

const projectRoot = resolve('.');
const checkpointRoot = resolve(projectRoot, 'work', 'checkpoints', 'P6-accepted');
const snapshotRoot = resolve(checkpointRoot, 'snapshot');
const manifestPath = resolve(checkpointRoot, 'manifest.sha256');
const snapshotInfoPath = resolve(checkpointRoot, 'SNAPSHOT_INFO.json');
const evidencePath = resolve(checkpointRoot, 'backup-restore-evidence.manifest.json');

const acceptedSources = Object.freeze([
  'PRODUCT_CONSTITUTION.md',
  'SCENARIO_MATRIX.md',
  'ARCHITECTURE_CONTRACT.md',
  'DELIVERY_GATES.md',
  'P5_ACCEPTANCE.md',
  'P5_VISUAL_ACCEPTANCE.md',
  'P6_ACCEPTANCE.md',
  'OPS.md',
  'README.md',
  'package.json',
  'src',
  'scenarios',
  'public',
  'scripts',
  'test',
]);

const token = `${process.pid}-${Date.now()}`;
const stagingRoot = resolve(checkpointRoot, `.snapshot-staging-${token}`);
const previousSnapshot = resolve(checkpointRoot, `.snapshot-previous-${token}`);
const stagingManifest = resolve(checkpointRoot, `.manifest-staging-${token}`);
const previousManifest = resolve(checkpointRoot, `.manifest-previous-${token}`);
const stagingInfo = resolve(checkpointRoot, `.info-staging-${token}`);
const previousInfo = resolve(checkpointRoot, `.info-previous-${token}`);

function normalized(path) {
  return path.toLowerCase();
}

function isDescendant(parent, candidate) {
  const child = relative(parent, candidate);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function assertCheckpointRoot() {
  const expectedSuffix = ['work', 'checkpoints', 'P6-accepted'].join(sep);
  if (!checkpointRoot.endsWith(expectedSuffix) || !isDescendant(projectRoot, checkpointRoot)) {
    throw new Error(`Unsafe P6 checkpoint root: ${checkpointRoot}`);
  }
  if (!existsSync(checkpointRoot)) {
    throw new Error(`P6 checkpoint root does not exist; create the sanitized backup evidence first: ${checkpointRoot}`);
  }
  const actual = resolve(realpathSync(checkpointRoot));
  const expected = resolve(realpathSync(projectRoot), 'work', 'checkpoints', 'P6-accepted');
  if (normalized(actual) !== normalized(expected)) {
    throw new Error(`P6 checkpoint root resolves outside the expected location: ${actual}`);
  }
}

function assertManagedTarget(target) {
  const absolute = resolve(target);
  if (!isDescendant(checkpointRoot, absolute)) {
    throw new Error(`Refusing destructive checkpoint operation outside P6-accepted: ${absolute}`);
  }
  const parent = resolve(absolute, '..');
  if (normalized(resolve(realpathSync(parent))) !== normalized(checkpointRoot)) {
    throw new Error(`Managed target parent is not the real P6 checkpoint root: ${absolute}`);
  }
  if (existsSync(absolute)) {
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Managed checkpoint target is a symlink/junction: ${absolute}`);
    const real = resolve(realpathSync(absolute));
    if (!isDescendant(checkpointRoot, real)) throw new Error(`Managed checkpoint target resolves outside P6-accepted: ${absolute}`);
  }
  return absolute;
}

function safeRemove(target, recursive = false) {
  const absolute = assertManagedTarget(target);
  if (existsSync(absolute)) rmSync(absolute, { recursive, force: true });
}

function safeRename(source, destination) {
  const from = assertManagedTarget(source);
  const to = assertManagedTarget(destination);
  renameSync(from, to);
}

function toPosix(path) {
  return path.split(sep).join('/');
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256File(file) {
  return sha256Bytes(readFileSync(file));
}

function walkFiles(root) {
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink()) throw new Error(`Symlink or junction is not accepted in the P6 snapshot: ${root}`);
  if (rootStat.isFile()) return [root];
  if (!rootStat.isDirectory()) throw new Error(`Unsupported source entry type: ${root}`);
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink or junction is not accepted in the P6 snapshot: ${absolute}`);
    if (entry.isDirectory()) return walkFiles(absolute);
    if (entry.isFile()) return [absolute];
    throw new Error(`Unsupported source entry type: ${absolute}`);
  });
}

function copyTree(source, destination) {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`Symlink or junction is not accepted in the P6 snapshot: ${source}`);
  if (stat.isFile()) {
    mkdirSync(resolve(destination, '..'), { recursive: true });
    copyFileSync(source, destination);
    return;
  }
  if (!stat.isDirectory()) throw new Error(`Unsupported source entry type: ${source}`);
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Symlink or junction is not accepted in the P6 snapshot: ${resolve(source, entry.name)}`);
    copyTree(resolve(source, entry.name), resolve(destination, entry.name));
  }
}

function sourceMap() {
  const map = new Map();
  for (const entry of acceptedSources) {
    const source = resolve(projectRoot, entry);
    if (!isDescendant(projectRoot, source) || !existsSync(source)) throw new Error(`Required P6 accepted source is missing or unsafe: ${entry}`);
    for (const file of walkFiles(source)) {
      const path = toPosix(relative(projectRoot, file));
      if (map.has(path)) throw new Error(`Duplicate accepted source path: ${path}`);
      map.set(path, sha256File(file));
    }
  }
  return new Map([...map].sort(([left], [right]) => left.localeCompare(right, 'en')));
}

function snapshotMap(root) {
  return new Map(walkFiles(root)
    .map((file) => [toPosix(relative(root, file)), sha256File(file)])
    .sort(([left], [right]) => left.localeCompare(right, 'en')));
}

function compareMaps(sources, snapshots, label) {
  const missing = [...sources.keys()].filter((path) => !snapshots.has(path));
  const extra = [...snapshots.keys()].filter((path) => !sources.has(path));
  const mismatch = [...sources].filter(([path, hash]) => snapshots.has(path) && snapshots.get(path) !== hash).map(([path]) => path);
  if (sources.size !== snapshots.size || missing.length || extra.length || mismatch.length) {
    throw new Error(`${label}: source=${sources.size} snapshot=${snapshots.size} missing=${missing.length} extra=${extra.length} mismatch=${mismatch.length}`);
  }
  return { missing: 0, extra: 0, mismatch: 0 };
}

function forbiddenPath(path) {
  return /(^|\/)(?:work|runtime|logs?|node_modules|\.git|credentials?|secrets?|tokens?)(\/|$)|(^|\/)\.env(?:\..*)?$|(?:^|\/)(?:id_rsa|id_ed25519)$|\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$|\.(?:wal|shm|log|jsonl|pem|key|p12|pfx)$/i.test(path);
}

function containsCredential(bytes) {
  return scanCredential(bytes, { allowSynthetic: isAllowedSyntheticCredential });
}

function assertNoForbiddenMaterial(root, map, label) {
  const forbiddenPaths = [...map.keys()].filter(forbiddenPath);
  const credentialFiles = [...map.keys()].filter((path) => containsCredential(readFileSync(resolve(root, path))));
  if (forbiddenPaths.length || credentialFiles.length) {
    throw new Error(`${label} contains forbidden material: paths=${forbiddenPaths.length} credentialPatterns=${credentialFiles.length}`);
  }
}

function assertSanitizedEvidence() {
  if (!existsSync(evidencePath) || !lstatSync(evidencePath).isFile()) {
    throw new Error(`Sanitized backup/restore evidence manifest is required: ${evidencePath}`);
  }
  const bytes = readFileSync(evidencePath);
  if (forbiddenPath(toPosix(relative(checkpointRoot, evidencePath))) || containsCredential(bytes)) {
    throw new Error('Backup/restore evidence manifest contains forbidden credential material.');
  }
  let evidence;
  try {
    evidence = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Backup/restore evidence manifest is not valid JSON: ${error.message}`);
  }
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('Backup/restore evidence manifest must be a JSON object.');
  }
  const hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (evidence.evidenceVersion !== 1 || evidence.gate !== 'P6-accepted' || evidence.status !== 'PASS'
    || evidence.backupManifestVersion !== 1 || !hex(evidence.backupManifestSha256)
    || evidence.creationMethod !== 'node:sqlite.backup-online-consistent' || !hex(evidence.databaseSha256)
    || evidence.schemaVersion !== 2
    || JSON.stringify(evidence.counts) !== JSON.stringify({ streams: 20, events: 480, projections: 20, commandReceipts: 440 })
    || !hex(evidence.eventChainDigest) || !hex(evidence.projectionDigest) || !hex(evidence.commandReceiptDigest) || !hex(evidence.idempotencyDigest)) {
    throw new Error('Backup/restore evidence core manifest fields are incomplete or invalid.');
  }
  if (evidence.canonicalWorkCaseCount !== 20 || !Array.isArray(evidence.canonicalHashes) || evidence.canonicalHashes.length !== 20) {
    throw new Error('Backup/restore evidence must retain all 20 canonical WorkCase hashes.');
  }
  const workCaseIds = evidence.canonicalHashes.map((item) => {
    if (!item || typeof item.workCaseId !== 'string' || !Number.isInteger(item.projectionVersion) || item.projectionVersion < 1 || !hex(item.canonicalStateHash)) {
      throw new Error('Backup/restore evidence contains an invalid canonical WorkCase hash entry.');
    }
    return item.workCaseId;
  });
  if (new Set(workCaseIds).size !== 20 || JSON.stringify(workCaseIds) !== JSON.stringify([...workCaseIds].sort((left, right) => left.localeCompare(right, 'en')))) {
    throw new Error('Backup/restore evidence canonical WorkCase hashes must be unique and sorted.');
  }
  const requiredImplementationPaths = ['src/ops/backup.js', 'src/observability/credential-scan.js', 'src/persistence/event-store.js', 'src/persistence/schema.js', 'scripts/smoke-backup-restore.js'];
  if (!evidence.sourceImplementation || Object.keys(evidence.sourceImplementation).sort().join('|') !== [...requiredImplementationPaths].sort().join('|')) {
    throw new Error('Backup/restore evidence source implementation binding is missing.');
  }
  for (const path of requiredImplementationPaths) {
    if (!hex(evidence.sourceImplementation[path]) || evidence.sourceImplementation[path] !== sha256File(resolve(projectRoot, path))) {
      throw new Error(`Backup/restore evidence is stale for ${path}.`);
    }
  }
  if (evidence.scenarioSuite?.passed !== 10 || evidence.scenarioSuite?.total !== 10 || evidence.scenarioSuite?.eventCount !== 480
    || evidence.restore?.targetWasNew !== true || evidence.restore?.logicalAuditMatches !== true || evidence.restore?.commandReceiptSemanticVerification !== 'verified'
    || evidence.replayRebuild?.rebuilt !== 20 || evidence.replayRebuild?.hashMismatches !== 0
    || evidence.receiptAndIdempotency?.status !== 'unknown' || evidence.receiptAndIdempotency?.completedAt !== null
    || evidence.receiptAndIdempotency?.retryConnectorCalls !== 0 || evidence.receiptAndIdempotency?.auditChangedByRetry !== false
    || !Number.isInteger(evidence.scan?.filesScanned) || evidence.scan.filesScanned < 4
    || evidence.scan?.sentinelMatches !== 0 || evidence.scan?.credentialPatternMatches !== 0
    || JSON.stringify(evidence.scan?.sentinelsChecked) !== JSON.stringify(['credential', 'prompt', 'response', 'runtimeSecret'])
    || evidence.retainedRuntimeDatabaseOrLog !== false) {
    throw new Error('Backup/restore evidence acceptance assertions are incomplete or failed.');
  }
  const serialized = JSON.stringify(evidence);
  if (/[A-Za-z]:\\Users\\|(?:^|["'])\/(?:home|Users|tmp)\//i.test(serialized)) {
    throw new Error('Backup/restore evidence manifest must not retain host-specific runtime paths.');
  }
  return sha256Bytes(bytes).toUpperCase();
}

function manifestText(map) {
  return `${[...map].map(([path, hash]) => `${hash} *snapshot/${path}`).join('\n')}\n`;
}

assertCheckpointRoot();
const evidenceSha256 = assertSanitizedEvidence();
for (const acceptedArtifact of [snapshotRoot, manifestPath, snapshotInfoPath]) {
  if (existsSync(acceptedArtifact)) throw new Error(`P6 accepted checkpoint is immutable and already exists: ${acceptedArtifact}`);
}
for (const transient of [stagingRoot, previousSnapshot, stagingManifest, previousManifest, stagingInfo, previousInfo]) {
  assertManagedTarget(transient);
  if (existsSync(transient)) throw new Error(`Refusing to overwrite an unexpected P6 checkpoint transient: ${transient}`);
}

mkdirSync(stagingRoot);
try {
  for (const entry of acceptedSources) copyTree(resolve(projectRoot, entry), resolve(stagingRoot, entry));

  const sourcesBeforeInstall = sourceMap();
  const staged = snapshotMap(stagingRoot);
  compareMaps(sourcesBeforeInstall, staged, 'P6 staging snapshot mismatch');
  assertNoForbiddenMaterial(stagingRoot, staged, 'P6 staging snapshot');

  const nextManifest = manifestText(staged);
  writeFileSync(stagingManifest, nextManifest, 'utf8');
  const manifestSha256 = sha256Bytes(Buffer.from(nextManifest, 'utf8')).toUpperCase();
  const nextInfo = {
    gate: 'P6-accepted',
    snapshotDirectory: 'snapshot',
    fileCount: staged.size,
    manifestSha256,
    backupRestoreEvidence: {
      file: 'backup-restore-evidence.manifest.json',
      sha256: evidenceSha256,
      includedInSnapshot: false,
    },
    verification: {
      missing: 0,
      extra: 0,
      mismatch: 0,
      dbWalShmLogEnvPrivateKeyToken: 0,
    },
    excludes: ['work/runtime', 'runtime databases', 'WAL/SHM', 'logs/JSONL', '.env', 'private keys and credentials'],
    rollbackBoundary: 'P6 single-node unauthenticated demo/controlled-pilot operations boundary; no P7 work',
  };
  writeFileSync(stagingInfo, `${JSON.stringify(nextInfo, null, 2)}\n`, 'utf8');

  const backups = [];
  const installed = [];
  let committed = false;
  try {
    for (const [current, previous] of [
      [snapshotRoot, previousSnapshot],
      [manifestPath, previousManifest],
      [snapshotInfoPath, previousInfo],
    ]) {
      if (existsSync(current)) {
        safeRename(current, previous);
        backups.push([previous, current]);
      }
    }
    for (const [stagedPath, finalPath] of [
      [stagingRoot, snapshotRoot],
      [stagingManifest, manifestPath],
      [stagingInfo, snapshotInfoPath],
    ]) {
      safeRename(stagedPath, finalPath);
      installed.push(finalPath);
    }

    const sourcesAfterInstall = sourceMap();
    const installedSnapshot = snapshotMap(snapshotRoot);
    compareMaps(sourcesAfterInstall, installedSnapshot, 'P6 installed snapshot mismatch');
    assertNoForbiddenMaterial(snapshotRoot, installedSnapshot, 'P6 installed snapshot');
    if (readFileSync(manifestPath, 'utf8') !== manifestText(installedSnapshot)) throw new Error('Installed P6 manifest does not exactly match the snapshot.');
    if (sha256File(evidencePath).toUpperCase() !== evidenceSha256) throw new Error('Backup/restore evidence changed while creating the P6 checkpoint.');
    committed = true;
  } catch (error) {
    const rollbackErrors = [];
    for (const installedPath of [...installed].reverse()) {
      try {
        safeRemove(installedPath, installedPath === snapshotRoot);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    for (const [previous, current] of [...backups].reverse()) {
      try {
        if (existsSync(previous)) safeRename(previous, current);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'P6 checkpoint installation failed and rollback was incomplete; previous artifacts were preserved where possible.');
    throw error;
  }

  if (committed) {
    for (const [previous] of [...backups].reverse()) safeRemove(previous, previous === previousSnapshot);
  }

  process.stdout.write(`P6 accepted snapshot created and verified: ${staged.size}/${staged.size}, missing=0 extra=0 mismatch=0 forbidden=0, manifest SHA-256 ${manifestSha256}, evidence SHA-256 ${evidenceSha256}.\n`);
} finally {
  safeRemove(stagingRoot, true);
  safeRemove(stagingManifest);
  safeRemove(stagingInfo);
}
