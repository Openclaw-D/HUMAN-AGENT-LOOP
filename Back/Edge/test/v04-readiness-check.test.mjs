import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkPersistence, runCli } from '../scripts/v04-readiness-check.mjs';

test('missing declarations stay unknown without probing the system', async () => {
  const result = await checkPersistence({}, () => { throw new Error('must not inspect'); });
  assert.equal(result.messages.status, 'not_configured');
  assert.equal(result.modelReceipts.status, 'not_configured');
  assert.equal(result.runtimeReadiness, 'unknown');
  assert.equal(result.exitCode, 2);
});

test('real temporary paths: existence, type errors, missing paths, no writes or content disclosure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jw-readiness-'));
  try {
    const file = join(root, 'messages.sqlite');
    const dir = join(root, 'receipts');
    await writeFile(file, 'PRIVATE_CONTENT_SENTINEL');
    await mkdir(dir);
    const before = await readdir(root);
    const result = await checkPersistence({ messagesFile: file, modelReceiptsDir: dir });
    assert.equal(result.exitCode, 0);
    assert.equal(result.messages.status, 'configured_path_exists');
    assert.equal(result.modelReceipts.status, 'configured_path_exists');
    assert.equal(result.runtimeReadiness, 'unknown');
    assert.equal(result.businessEvents.status, 'not_checked');
    assert.equal(JSON.stringify(result).includes(root), false);
    assert.equal(JSON.stringify(result).includes('PRIVATE_CONTENT_SENTINEL'), false);
    const wrong = await checkPersistence({ messagesFile: dir, modelReceiptsDir: file });
    assert.equal(wrong.exitCode, 1);
    assert.equal(wrong.messages.reason, 'wrong_path_type');
    assert.equal(wrong.modelReceipts.reason, 'wrong_path_type');
    const missing = await checkPersistence({ messagesFile: join(root, 'absent'), modelReceiptsDir: join(root, 'absent-dir') });
    assert.equal(missing.exitCode, 2);
    assert.equal(missing.messages.status, 'path_missing');
    assert.equal(missing.modelReceipts.status, 'path_missing');
    assert.deepEqual(await readdir(root), before);
    assert.deepEqual(await readdir(dir), []);
    assert.equal(await readFile(file, 'utf8'), 'PRIVATE_CONTENT_SENTINEL');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('permission and metadata failures redact paths and error text (injected, no ACL changes)', async () => {
  for (const code of ['EACCES', 'EPERM', 'EIO']) {
    const result = await checkPersistence({ messagesFile: 'PRIVATE_PATH' }, async () => {
      throw Object.assign(new Error('PRIVATE_ERROR'), { code });
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.messages.reason, code === 'EIO' ? 'metadata_error' : 'access_denied');
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  }
});

test('invalid CLI arguments fail without reflecting user values', async () => {
  for (const args of [['--secret', 'PRIVATE'], ['--messages-file'], ['--messages-file', ''], ['--messages-file', 'x', '--messages-file', 'PRIVATE']]) {
    const lines = [];
    assert.equal(await runCli(args, line => lines.push(line)), 1);
    assert.equal(JSON.parse(lines[0]).error, 'invalid_arguments');
    assert.equal(lines.join('').includes('PRIVATE'), false);
  }
});

test('actual CLI exit code and JSON with no arguments', () => {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/v04-readiness-check.mjs', import.meta.url))], { encoding: 'utf8' });
  assert.equal(child.status, 2);
  assert.equal(child.stderr, '');
  assert.equal(JSON.parse(child.stdout).runtimeReadiness, 'unknown');
});
