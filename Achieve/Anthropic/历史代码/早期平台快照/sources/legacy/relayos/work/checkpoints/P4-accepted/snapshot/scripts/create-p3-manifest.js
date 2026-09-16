import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve('.');
const checkpoint = resolve('work/checkpoints/P3-accepted');
const roots = [
  'PRODUCT_CONSTITUTION.md',
  'SCENARIO_MATRIX.md',
  'ARCHITECTURE_CONTRACT.md',
  'DELIVERY_GATES.md',
  'README.md',
  'package.json',
  'src',
  'scenarios',
  'test',
  'scripts',
];

function collect(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(path, entry.name);
    return entry.isDirectory() ? collect(child) : [child];
  });
}

const files = roots.flatMap((entry) => {
  const absolute = resolve(entry);
  return statSync(absolute).isDirectory() ? collect(absolute) : [absolute];
}).filter((file) => !/(^|[\\/])(data|node_modules|logs?|runtime)([\\/]|$)|\.env($|\.)|secret|\.db($|-wal$|-shm$)/i.test(relative(root, file))).sort();

const lines = files.map((file) => {
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
  return `${hash} *${relative(root, file).replaceAll('\\', '/')}`;
});

mkdirSync(checkpoint, { recursive: true });
writeFileSync(resolve(checkpoint, 'manifest.sha256'), `${lines.join('\n')}\n`, 'utf8');
process.stdout.write(`P3 manifest created: ${lines.length} files; runtime DB/log/secret paths excluded.\n`);
