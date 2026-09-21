import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPlan, entries, validateEntries, quotePowerShell } from '../scripts/v04-test-plan.mjs';

test('manifest rejects traversal, wrong module, duplicates and shell syntax', () => {
  validateEntries(entries);
  for (const file of ['Back/Edge/test/../x.test.mjs', '/tmp/x.test.mjs', 'Back/A/test/x.test.mjs', 'Back/Edge/test/x;evil.test.mjs', 'Back\\Edge\\test\\x.test.mjs']) {
    assert.throws(() => validateEntries([{ module: 'Edge', file }]), /invalid_test_path/);
  }
  assert.throws(() => validateEntries([entries[0], entries[0]]), /duplicate/);
});

test('PowerShell quote preserves apostrophes, dollars and spaces literally', () => {
  assert.equal(quotePowerShell("C:/a b/O'Brien/$x.mjs"), "'C:/a b/O''Brien/$x.mjs'");
});

test('missing, wrong type and escaped physical path get no executable command; files are never imported', async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jw-plan O'Brien-"));
  const outside = await mkdtemp(path.join(tmpdir(), 'jw-plan-outside-'));
  try {
    const dir = path.join(root, 'Back/Edge/test');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'exists.test.mjs'), 'throw new Error("must never execute");');
    await mkdir(path.join(dir, 'directory.test.mjs'));
    await symlink(outside, path.join(dir, 'escape'), 'junction');
    await writeFile(path.join(outside, 'x.test.mjs'), '');
    const items = ['exists.test.mjs', 'missing.test.mjs', 'directory.test.mjs', 'escape/x.test.mjs'].map(name => ({ module: 'Edge', file: `Back/Edge/test/${name}` }));
    const plan = await buildPlan(root, items);
    assert.deepEqual(plan.tests.map(t => t.existence), ['exists', 'missing', 'wrong_type', 'out_of_scope']);
    assert.equal(plan.exitCode, 2);
    assert.ok(plan.tests[0].command.endsWith(quotePowerShell(path.join(dir, 'exists.test.mjs'))));
    assert.ok(plan.tests.slice(1).every(t => t.command === null));
    assert.ok(plan.tests.every(t => t.result === 'NOT_RUN'));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('CLI only prints plan; no execution switch accepted', () => {
  const script = fileURLToPath(new URL('../scripts/v04-test-plan.mjs', import.meta.url));
  const child = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.ok([0, 2].includes(child.status));
  const plan = JSON.parse(child.stdout);
  assert.equal(plan.mode, 'plan_only');
  assert.equal(plan.tests.length, entries.length);
  assert.ok(plan.tests.every(t => t.result === 'NOT_RUN'));
  assert.equal(spawnSync(process.execPath, [script, '--run'], { encoding: 'utf8' }).status, 1);
});
