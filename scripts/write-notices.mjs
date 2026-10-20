import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const notices = ['Third-party notices\n\nThis frontend includes the following software. These notices apply to the named third-party components.'];
for (const name of ['react', 'react-dom', 'scheduler']) {
  const folder = resolve(root, 'Front/node_modules', name);
  const pkg = JSON.parse(readFileSync(resolve(folder, 'package.json'), 'utf8'));
  notices.push(`${name} ${pkg.version}\n\n${readFileSync(resolve(folder, 'LICENSE'), 'utf8')}`);
}
mkdirSync(resolve(root, 'Front/preview/public'), { recursive: true });
writeFileSync(resolve(root, 'Front/preview/public/THIRD_PARTY_NOTICES.txt'), notices.join('\n\n----------------------------------------\n\n'));
console.log('Third-party notices prepared.');
