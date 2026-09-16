import {
  copyFileSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, relative, resolve, sep } from 'node:path';

const projectRoot = resolve('.');
const checkpointRoot = resolve(projectRoot, 'work', 'checkpoints', 'P5-accepted');
const snapshotRoot = resolve(checkpointRoot, 'snapshot');
const expectedSuffix = ['work', 'checkpoints', 'P5-accepted', 'snapshot'].join(sep);

if (!snapshotRoot.endsWith(expectedSuffix) || !snapshotRoot.startsWith(`${projectRoot}${sep}`)) {
  throw new Error(`Unsafe checkpoint target: ${snapshotRoot}`);
}

const acceptedSources = [
  'PRODUCT_CONSTITUTION.md',
  'SCENARIO_MATRIX.md',
  'ARCHITECTURE_CONTRACT.md',
  'DELIVERY_GATES.md',
  'P5_ACCEPTANCE.md',
  'P5_VISUAL_ACCEPTANCE.md',
  'README.md',
  'package.json',
  'src',
  'scenarios',
  'public',
  'scripts',
  'test',
];

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function sourceFiles() {
  return acceptedSources.flatMap((entry) => {
    const source = resolve(projectRoot, entry);
    if (!source.startsWith(`${projectRoot}${sep}`)) throw new Error(`Source escapes project root: ${source}`);
    return statSync(source).isDirectory() ? walk(source) : [source];
  });
}

mkdirSync(checkpointRoot, { recursive: true });
rmSync(snapshotRoot, { recursive: true, force: true });
mkdirSync(snapshotRoot, { recursive: true });

for (const entry of acceptedSources) {
  const source = resolve(projectRoot, entry);
  const destination = resolve(snapshotRoot, entry);
  if (statSync(source).isDirectory()) cpSync(source, destination, { recursive: true });
  else {
    mkdirSync(resolve(destination, '..'), { recursive: true });
    copyFileSync(source, destination);
  }
}

const sources = sourceFiles().sort((left, right) => left.localeCompare(right, 'en'));
const snapshots = walk(snapshotRoot).sort((left, right) => left.localeCompare(right, 'en'));
const sourceMap = new Map(sources.map((file) => [relative(projectRoot, file).split(sep).join('/'), sha256(file)]));
const snapshotMap = new Map(snapshots.map((file) => [relative(snapshotRoot, file).split(sep).join('/'), sha256(file)]));
const missing = [...sourceMap.keys()].filter((path) => !snapshotMap.has(path));
const extra = [...snapshotMap.keys()].filter((path) => !sourceMap.has(path));
const mismatch = [...sourceMap].filter(([path, hash]) => snapshotMap.has(path) && snapshotMap.get(path) !== hash).map(([path]) => path);
if (missing.length || extra.length || mismatch.length || sourceMap.size !== snapshotMap.size) {
  throw new Error(`P5 snapshot mismatch: source=${sourceMap.size} snapshot=${snapshotMap.size} missing=${missing.length} extra=${extra.length} mismatch=${mismatch.length}`);
}

const forbiddenPaths = [...snapshotMap.keys()].filter((path) => /(^|\/)(?:runtime|logs?)(\/|$)|(?:^|\/)(?:\.env(?:\..*)?|[^/]+\.(?:db|sqlite|db-wal|db-shm|wal|shm|log))$/i.test(path));
const secretContent = snapshots.filter((file) => {
  const bytes = readFileSync(file);
  if (bytes.includes(0)) return false;
  const text = bytes.toString('utf8');
  return /-----BEGIN [A-Z ]+PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{20,}|\bsk-[A-Za-z0-9_-]{20,}/i.test(text);
}).map((file) => relative(snapshotRoot, file).split(sep).join('/'));
if (forbiddenPaths.length || secretContent.length) {
  throw new Error(`P5 snapshot contains forbidden material: paths=${forbiddenPaths.length} secretPatterns=${secretContent.length}`);
}

const manifestLines = snapshots.map((file) => `${sha256(file)} *snapshot/${relative(snapshotRoot, file).split(sep).join('/')}`);
writeFileSync(resolve(checkpointRoot, 'manifest.sha256'), `${manifestLines.join('\n')}\n`, 'utf8');
const manifestHash = createHash('sha256').update(readFileSync(resolve(checkpointRoot, 'manifest.sha256'))).digest('hex').toUpperCase();
writeFileSync(resolve(checkpointRoot, 'SNAPSHOT_INFO.json'), `${JSON.stringify({
  gate: 'P5-accepted',
  snapshotDirectory: basename(snapshotRoot),
  fileCount: manifestLines.length,
  manifestSha256: manifestHash,
  verification: { missing: 0, extra: 0, mismatch: 0, runtimeDbWalShmLogSecret: 0 },
  excludes: ['runtime databases', 'WAL/SHM', 'logs', 'secrets', 'visual screenshots'],
  rollbackBoundary: 'ten versioned configs + deidentified fixtures + shared kernel/API/provider/connector/renderer; no P6 work',
}, null, 2)}\n`, 'utf8');

process.stdout.write(`P5 accepted snapshot verified: ${manifestLines.length}/${manifestLines.length}, missing=0 extra=0 mismatch=0 forbidden=0, manifest SHA-256 ${manifestHash}.\n`);
