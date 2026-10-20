import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Keep retired terminology out of current product copy, fixtures and artifacts.
const retired = [[0x878d,0x8d44,0x79df,0x8d41],[0x79df,0x91d1],[0x56de,0x79df],[0x76f4,0x79df],[0x79df,0x8d41],[0x91d1,0x878d],[0x98ce,0x63a7],[0x98ce,0x9669]].map(x => String.fromCodePoint(...x));
const obsolete = ['commercial' + '_leasing', 'sale' + '_leaseback', 'direct' + '_lease', 'lease' + '_term_months', 'proposed' + '_monthly_rent'];
const terms = [...retired, ...obsolete];
const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))];
const failures = []; let scanned = 0;
for (const name of files) {
  const p = resolve(root, name);
  if (!existsSync(p) || !statSync(p).isFile()) continue;
  if (terms.some(t => name.includes(t))) failures.push(`${name}: retired path`);
  if (!['.md','.mjs','.js','.json','.html','.tsx','.ts','.css','.txt','.cmd','.ps1','.svg'].includes(extname(name))) continue;
  const content = readFileSync(p, 'utf8'); scanned++;
  if (terms.some(t => content.includes(t))) failures.push(`${name}: retired terminology`);
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Current scope verified across ${scanned} text files. No retired terminology found.`);
