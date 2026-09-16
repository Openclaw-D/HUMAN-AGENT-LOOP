import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const EXPECTED_COUNT = 89;
const EXPECTED_MANIFEST_SHA256 = '5D1A99CB23085D3CD3B0689812CEA3B3D4595C0B5375F4CEA31AC285631A21A3';
const projectRoot = resolve('.');
const checkpointRoot = resolve(projectRoot, 'work', 'checkpoints', 'P5-accepted');
const snapshotRoot = resolve(checkpointRoot, 'snapshot');
const manifestPath = resolve(checkpointRoot, 'manifest.sha256');
const infoPath = resolve(checkpointRoot, 'SNAPSHOT_INFO.json');

function descendant(parent, candidate) {
  const path = relative(parent, candidate);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function posix(path) {
  return path.split(sep).join('/');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function walk(root) {
  const stat = lstatSync(root);
  if (stat.isSymbolicLink()) throw new Error(`P5 verifier rejects symlinks and junctions: ${root}`);
  if (stat.isFile()) return [root];
  if (!stat.isDirectory()) throw new Error(`P5 verifier rejects non-file entries: ${root}`);
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`P5 verifier rejects symlinks and junctions: ${absolute}`);
    if (entry.isDirectory()) return walk(absolute);
    if (entry.isFile()) return [absolute];
    throw new Error(`P5 verifier rejects non-file entries: ${absolute}`);
  });
}

function parseManifest(text) {
  if (!text.endsWith('\n')) throw new Error('P5 manifest must end with a newline.');
  const map = new Map();
  for (const line of text.slice(0, -1).split('\n')) {
    const match = /^([0-9a-f]{64}) \*snapshot\/(.+)$/.exec(line);
    if (!match) throw new Error(`Malformed P5 manifest line: ${line}`);
    const path = match[2];
    if (path.includes('\\') || path.startsWith('/') || path.split('/').some((part) => part === '' || part === '.' || part === '..')) throw new Error(`Unsafe P5 manifest path: ${path}`);
    if (map.has(path)) throw new Error(`Duplicate P5 manifest path: ${path}`);
    map.set(path, match[1]);
  }
  return map;
}

function forbiddenPath(path) {
  return /(^|\/)(?:runtime|logs?|node_modules|\.git)(\/|$)|(^|\/)\.env(?:\..*)?$|(?:^|\/)(?:credentials?|secrets?|tokens?)(?:\.[^/]*)?$|(?:^|\/)(?:id_rsa|id_ed25519)$|\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm))?$|\.(?:wal|shm|log|jsonl|pem|key|p12|pfx)$/i.test(path);
}

function credentialContent(bytes) {
  const text = bytes.toString('utf8');
  if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i.test(text)) return true;
  if (/\bBearer\s+[A-Za-z0-9._~+\/-]{20,}/i.test(text)) return true;
  if (/\bsk-[A-Za-z0-9_-]{20,}\b/.test(text)) return true;
  return false;
}

if (!existsSync(checkpointRoot) || !descendant(projectRoot, checkpointRoot)) throw new Error('P5 accepted checkpoint is missing or unsafe.');
const expectedRealRoot = resolve(realpathSync(projectRoot), 'work', 'checkpoints', 'P5-accepted');
if (resolve(realpathSync(checkpointRoot)).toLowerCase() !== expectedRealRoot.toLowerCase()) throw new Error('P5 checkpoint resolves outside the project.');
for (const required of [snapshotRoot, manifestPath, infoPath]) if (!existsSync(required)) throw new Error(`Missing P5 accepted artifact: ${required}`);

const manifestBytes = readFileSync(manifestPath);
const manifestSha256 = sha256(manifestBytes).toUpperCase();
if (manifestSha256 !== EXPECTED_MANIFEST_SHA256) throw new Error(`P5 manifest hash changed: expected=${EXPECTED_MANIFEST_SHA256} actual=${manifestSha256}`);
const manifest = parseManifest(manifestBytes.toString('utf8'));
const files = walk(snapshotRoot);
const snapshot = new Map(files.map((file) => [posix(relative(snapshotRoot, file)), sha256(readFileSync(file))]));
const missing = [...manifest.keys()].filter((path) => !snapshot.has(path));
const extra = [...snapshot.keys()].filter((path) => !manifest.has(path));
const mismatch = [...manifest].filter(([path, hash]) => snapshot.has(path) && snapshot.get(path) !== hash).map(([path]) => path);
const forbiddenPaths = [...snapshot.keys()].filter(forbiddenPath);
const credentialFiles = files.filter((file) => credentialContent(readFileSync(file)));
if (manifest.size !== EXPECTED_COUNT || snapshot.size !== EXPECTED_COUNT || missing.length || extra.length || mismatch.length || forbiddenPaths.length || credentialFiles.length) {
  throw new Error(`P5 accepted checkpoint mismatch: manifest=${manifest.size} snapshot=${snapshot.size} missing=${missing.length} extra=${extra.length} mismatch=${mismatch.length} forbidden=${forbiddenPaths.length + credentialFiles.length}`);
}

let info;
try {
  info = JSON.parse(readFileSync(infoPath, 'utf8'));
} catch (error) {
  throw new Error(`Invalid P5 SNAPSHOT_INFO.json: ${error.message}`);
}
if (info?.gate !== 'P5-accepted' || info?.fileCount !== EXPECTED_COUNT || info?.manifestSha256 !== EXPECTED_MANIFEST_SHA256
  || info?.verification?.missing !== 0 || info?.verification?.extra !== 0 || info?.verification?.mismatch !== 0 || info?.verification?.runtimeDbWalShmLogSecret !== 0) {
  throw new Error('P5 SNAPSHOT_INFO no longer matches the fixed accepted checkpoint.');
}

process.stdout.write(`P5 accepted checkpoint verified read-only: ${EXPECTED_COUNT}/${EXPECTED_COUNT}, missing=0 extra=0 mismatch=0 forbidden=0, manifest SHA-256 ${EXPECTED_MANIFEST_SHA256}.\n`);
