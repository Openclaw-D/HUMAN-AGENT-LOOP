import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, relative, resolve, sep } from 'node:path';

const projectRoot = resolve('.');
const checkpointRoot = resolve(projectRoot, 'work', 'checkpoints', 'P4-accepted');
const snapshotRoot = resolve(checkpointRoot, 'snapshot');
const expectedSuffix = ['work', 'checkpoints', 'P4-accepted', 'snapshot'].join(sep);

if (!snapshotRoot.endsWith(expectedSuffix) || !snapshotRoot.startsWith(`${projectRoot}${sep}`)) {
  throw new Error(`Unsafe checkpoint target: ${snapshotRoot}`);
}

const acceptedSources = [
  'PRODUCT_CONSTITUTION.md',
  'SCENARIO_MATRIX.md',
  'ARCHITECTURE_CONTRACT.md',
  'DELIVERY_GATES.md',
  'README.md',
  'package.json',
  'src',
  'scenarios',
  'public',
  'scripts',
  'test'
];

mkdirSync(checkpointRoot, { recursive: true });
rmSync(snapshotRoot, { recursive: true, force: true });
mkdirSync(snapshotRoot, { recursive: true });

for (const entry of acceptedSources) {
  const source = resolve(projectRoot, entry);
  const destination = resolve(snapshotRoot, entry);
  if (statSync(source).isDirectory()) {
    cpSync(source, destination, { recursive: true });
  } else {
    mkdirSync(resolve(destination, '..'), { recursive: true });
    copyFileSync(source, destination);
  }
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

const manifestLines = walk(snapshotRoot)
  .sort((left, right) => left.localeCompare(right, 'en'))
  .map((file) => {
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
    const path = relative(checkpointRoot, file).split(sep).join('/');
    return `${hash} *${path}`;
  });

writeFileSync(resolve(checkpointRoot, 'manifest.sha256'), `${manifestLines.join('\n')}\n`, 'utf8');
writeFileSync(resolve(checkpointRoot, 'SNAPSHOT_INFO.json'), `${JSON.stringify({
  gate: 'P4-accepted',
  snapshotDirectory: basename(snapshotRoot),
  fileCount: manifestLines.length,
  excludes: ['runtime databases', 'logs', 'secrets', 'visual screenshots'],
  rollbackBoundary: 'public/display/static/read-only composition; domain and event schema unchanged'
}, null, 2)}\n`, 'utf8');

process.stdout.write(`P4 accepted snapshot created: ${manifestLines.length} files with SHA-256 manifest.\n`);
