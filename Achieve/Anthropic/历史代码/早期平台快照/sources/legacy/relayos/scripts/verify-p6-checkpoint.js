import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { containsCredential, isAllowedSyntheticCredential } from '../src/observability/credential-scan.js';

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

function lower(path) {
  return path.toLowerCase();
}

function descendant(parent, candidate) {
  const child = relative(parent, candidate);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function posix(path) {
  return path.split(sep).join('/');
}

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashFile(file) {
  return hashBytes(readFileSync(file));
}

function walk(root) {
  const stat = lstatSync(root);
  if (stat.isSymbolicLink()) throw new Error(`P6 verifier rejects symlinks and junctions: ${root}`);
  if (stat.isFile()) return [root];
  if (!stat.isDirectory()) throw new Error(`P6 verifier rejects non-file entries: ${root}`);
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`P6 verifier rejects symlinks and junctions: ${absolute}`);
    if (entry.isDirectory()) return walk(absolute);
    if (entry.isFile()) return [absolute];
    throw new Error(`P6 verifier rejects non-file entries: ${absolute}`);
  });
}

function mapFiles(root, relativeTo) {
  return new Map(walk(root)
    .map((file) => [posix(relative(relativeTo, file)), hashFile(file)])
    .sort(([left], [right]) => left.localeCompare(right, 'en')));
}

function acceptedSourceMap() {
  const map = new Map();
  for (const entry of acceptedSources) {
    const source = resolve(projectRoot, entry);
    if (!existsSync(source) || !descendant(projectRoot, source)) throw new Error(`Required accepted source missing or unsafe: ${entry}`);
    for (const file of walk(source)) {
      const path = posix(relative(projectRoot, file));
      if (map.has(path)) throw new Error(`Duplicate accepted source path: ${path}`);
      map.set(path, hashFile(file));
    }
  }
  return new Map([...map].sort(([left], [right]) => left.localeCompare(right, 'en')));
}

function parseManifest(text) {
  if (!text.endsWith('\n')) throw new Error('P6 manifest must end with exactly one newline.');
  const lines = text.slice(0, -1).split('\n');
  if (!lines.length || lines.some((line) => !line)) throw new Error('P6 manifest contains an empty or missing entry.');
  const map = new Map();
  for (const line of lines) {
    const match = /^([0-9a-f]{64}) \*snapshot\/(.+)$/.exec(line);
    if (!match) throw new Error(`Malformed P6 manifest line: ${line}`);
    const path = match[2];
    if (path.includes('\\') || path.startsWith('/') || path.split('/').some((part) => part === '' || part === '.' || part === '..')) {
      throw new Error(`Unsafe P6 manifest path: ${path}`);
    }
    if (map.has(path)) throw new Error(`Duplicate P6 manifest path: ${path}`);
    map.set(path, match[1]);
  }
  const sorted = [...map.keys()].sort((left, right) => left.localeCompare(right, 'en'));
  if ([...map.keys()].some((path, index) => path !== sorted[index])) throw new Error('P6 manifest entries are not sorted.');
  return map;
}

function compare(expected, actual, label) {
  const missing = [...expected.keys()].filter((path) => !actual.has(path));
  const extra = [...actual.keys()].filter((path) => !expected.has(path));
  const mismatch = [...expected].filter(([path, hash]) => actual.has(path) && actual.get(path) !== hash).map(([path]) => path);
  if (expected.size !== actual.size || missing.length || extra.length || mismatch.length) {
    throw new Error(`${label}: expected=${expected.size} actual=${actual.size} missing=${missing.length} extra=${extra.length} mismatch=${mismatch.length}`);
  }
}

function forbiddenPath(path) {
  return /(^|\/)(?:work|runtime|logs?|node_modules|\.git|credentials?|secrets?|tokens?)(\/|$)|(^|\/)\.env(?:\..*)?$|(?:^|\/)(?:id_rsa|id_ed25519)$|\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$|\.(?:wal|shm|log|jsonl|pem|key|p12|pfx)$/i.test(path);
}

function credentialContent(bytes) {
  return containsCredential(bytes, { allowSynthetic: isAllowedSyntheticCredential });
}

function assertClean(root, map, label) {
  const badPaths = [...map.keys()].filter(forbiddenPath);
  const badContent = [...map.keys()].filter((path) => credentialContent(readFileSync(resolve(root, path))));
  if (badPaths.length || badContent.length) throw new Error(`${label} forbidden material: paths=${badPaths.length} credentials=${badContent.length}`);
}

if (!existsSync(checkpointRoot) || !descendant(projectRoot, checkpointRoot)) throw new Error(`P6 checkpoint root is missing or unsafe: ${checkpointRoot}`);
const expectedRealRoot = resolve(realpathSync(projectRoot), 'work', 'checkpoints', 'P6-accepted');
if (lower(resolve(realpathSync(checkpointRoot))) !== lower(expectedRealRoot)) throw new Error('P6 checkpoint root resolves outside the expected project location.');

const allowedRootEntries = new Set(['snapshot', 'manifest.sha256', 'SNAPSHOT_INFO.json', 'backup-restore-evidence.manifest.json']);
const unexpectedRootEntries = readdirSync(checkpointRoot).filter((entry) => !allowedRootEntries.has(entry));
if (unexpectedRootEntries.length) throw new Error(`Unexpected P6 checkpoint root entries: ${unexpectedRootEntries.join(', ')}`);
for (const required of [snapshotRoot, manifestPath, snapshotInfoPath, evidencePath]) {
  if (!existsSync(required)) throw new Error(`Missing required P6 checkpoint artifact: ${required}`);
  const stat = lstatSync(required);
  if (stat.isSymbolicLink() || (required === snapshotRoot ? !stat.isDirectory() : !stat.isFile())) throw new Error(`Invalid P6 checkpoint artifact type: ${required}`);
}

const source = acceptedSourceMap();
const snapshot = mapFiles(snapshotRoot, snapshotRoot);
compare(source, snapshot, 'P6 source/snapshot mismatch');
assertClean(snapshotRoot, snapshot, 'P6 snapshot');

const manifestBytes = readFileSync(manifestPath);
const manifest = parseManifest(manifestBytes.toString('utf8'));
compare(manifest, snapshot, 'P6 manifest/snapshot mismatch');
const manifestSha256 = hashBytes(manifestBytes).toUpperCase();

let info;
try {
  info = JSON.parse(readFileSync(snapshotInfoPath, 'utf8'));
} catch (error) {
  throw new Error(`Invalid P6 SNAPSHOT_INFO.json: ${error.message}`);
}
if (info?.gate !== 'P6-accepted' || info?.snapshotDirectory !== 'snapshot' || info?.fileCount !== snapshot.size || info?.manifestSha256 !== manifestSha256) {
  throw new Error('P6 SNAPSHOT_INFO core fields do not match the independently verified snapshot.');
}
if (info?.verification?.missing !== 0 || info?.verification?.extra !== 0 || info?.verification?.mismatch !== 0 || info?.verification?.dbWalShmLogEnvPrivateKeyToken !== 0) {
  throw new Error('P6 SNAPSHOT_INFO verification result is not zero-clean.');
}

const evidenceBytes = readFileSync(evidencePath);
if (credentialContent(evidenceBytes)) throw new Error('P6 backup/restore evidence contains a credential pattern.');
let evidence;
try {
  evidence = JSON.parse(evidenceBytes.toString('utf8'));
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new Error('not an object');
  const serialized = JSON.stringify(evidence);
  if (/[A-Za-z]:\\Users\\|(?:^|["'])\/(?:home|Users|tmp)\//i.test(serialized)) throw new Error('contains a host-specific runtime path');
} catch (error) {
  throw new Error(`Invalid P6 backup/restore evidence JSON: ${error.message}`);
}
const evidenceHex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
if (evidence.evidenceVersion !== 1 || evidence.gate !== 'P6-accepted' || evidence.status !== 'PASS'
  || evidence.backupManifestVersion !== 1 || !evidenceHex(evidence.backupManifestSha256)
  || evidence.creationMethod !== 'node:sqlite.backup-online-consistent' || !evidenceHex(evidence.databaseSha256)
  || evidence.schemaVersion !== 2
  || JSON.stringify(evidence.counts) !== JSON.stringify({ streams: 20, events: 480, projections: 20, commandReceipts: 440 })
  || !evidenceHex(evidence.eventChainDigest) || !evidenceHex(evidence.projectionDigest)
  || !evidenceHex(evidence.commandReceiptDigest) || !evidenceHex(evidence.idempotencyDigest)) {
  throw new Error('P6 backup/restore evidence core manifest fields are incomplete or invalid.');
}
if (evidence.canonicalWorkCaseCount !== 20 || !Array.isArray(evidence.canonicalHashes) || evidence.canonicalHashes.length !== 20) {
  throw new Error('P6 backup/restore evidence must retain all 20 canonical WorkCase hashes.');
}
const evidenceWorkCaseIds = evidence.canonicalHashes.map((item) => {
  if (!item || typeof item.workCaseId !== 'string' || !Number.isInteger(item.projectionVersion) || item.projectionVersion < 1 || !evidenceHex(item.canonicalStateHash)) {
    throw new Error('P6 backup/restore evidence canonical hash entry is invalid.');
  }
  return item.workCaseId;
});
if (new Set(evidenceWorkCaseIds).size !== 20
  || JSON.stringify(evidenceWorkCaseIds) !== JSON.stringify([...evidenceWorkCaseIds].sort((left, right) => left.localeCompare(right, 'en')))) {
  throw new Error('P6 backup/restore evidence canonical hashes must be unique and sorted.');
}
const evidenceImplementationPaths = ['src/ops/backup.js', 'src/observability/credential-scan.js', 'src/persistence/event-store.js', 'src/persistence/schema.js', 'scripts/smoke-backup-restore.js'];
if (!evidence.sourceImplementation || Object.keys(evidence.sourceImplementation).sort().join('|') !== [...evidenceImplementationPaths].sort().join('|')) {
  throw new Error('P6 backup/restore evidence source binding is missing.');
}
for (const path of evidenceImplementationPaths) {
  if (!evidenceHex(evidence.sourceImplementation[path]) || evidence.sourceImplementation[path] !== hashFile(resolve(projectRoot, path))) {
    throw new Error(`P6 backup/restore evidence is stale for ${path}.`);
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
  throw new Error('P6 backup/restore evidence acceptance assertions are incomplete or failed.');
}
const evidenceSha256 = hashBytes(evidenceBytes).toUpperCase();
if (info?.backupRestoreEvidence?.file !== 'backup-restore-evidence.manifest.json'
  || info?.backupRestoreEvidence?.sha256 !== evidenceSha256
  || info?.backupRestoreEvidence?.includedInSnapshot !== false) {
  throw new Error('P6 backup/restore evidence hash or snapshot exclusion declaration does not match SNAPSHOT_INFO.');
}

process.stdout.write(`P6 checkpoint independently verified: ${snapshot.size}/${snapshot.size}, missing=0 extra=0 mismatch=0 forbidden=0, manifest SHA-256 ${manifestSha256}, evidence SHA-256 ${evidenceSha256}.\n`);
