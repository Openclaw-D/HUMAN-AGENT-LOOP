import { existsSync, lstatSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { createConsistentBackup } from '../src/ops/backup.js';
import { EventStore } from '../src/persistence/event-store.js';

const REQUIRED_ARGUMENTS = new Set(['db', 'backup', 'manifest']);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parseArguments(argv) {
  if (argv.length === 0 || argv.length % 2 !== 0) {
    fail('CLI_ARGUMENTS_INVALID', '必须提供 --db、--backup、--manifest 及其值。');
  }
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!/^--[a-z-]+$/.test(flag)) fail('CLI_ARGUMENTS_INVALID', '参数必须使用 --name value 格式。');
    const name = flag.slice(2);
    if (!REQUIRED_ARGUMENTS.has(name)) fail('CLI_ARGUMENT_UNKNOWN', `不支持参数 ${flag}。`);
    if (Object.hasOwn(parsed, name)) fail('CLI_ARGUMENT_DUPLICATE', `参数 ${flag} 不能重复。`);
    if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
      fail('CLI_ARGUMENT_VALUE_INVALID', `参数 ${flag} 必须有非空路径值。`);
    }
    parsed[name] = resolve(value);
  }
  for (const name of REQUIRED_ARGUMENTS) {
    if (!Object.hasOwn(parsed, name)) fail('CLI_ARGUMENT_REQUIRED', `缺少参数 --${name}。`);
  }
  return parsed;
}

function comparablePath(filePath) {
  return process.platform === 'win32' ? filePath.toLowerCase() : filePath;
}

function assertDistinct(paths) {
  const values = Object.values(paths).map(comparablePath);
  if (new Set(values).size !== values.length) {
    fail('CLI_PATH_CONFLICT', '数据库、备份与 manifest 路径必须彼此不同。');
  }
}

function assertExistingRegularFile(filePath, code) {
  if (!existsSync(filePath) || !lstatSync(filePath).isFile()) {
    fail(code, '源数据库必须是已存在的普通文件。');
  }
}

function assertFreshTarget(filePath, code) {
  if (existsSync(filePath)) fail(code, '备份与 manifest 目标必须是全新路径。');
}

function publicAudit(audit) {
  return {
    schemaVersion: audit.schemaVersion,
    counts: audit.counts,
    eventChainDigest: audit.eventChainDigest,
    projectionDigest: audit.projectionDigest,
    commandReceiptDigest: audit.commandReceiptDigest,
    idempotencyDigest: audit.idempotencyDigest,
  };
}

let store;
try {
  const args = parseArguments(process.argv.slice(2));
  assertDistinct(args);
  assertExistingRegularFile(args.db, 'BACKUP_SOURCE_INVALID');
  assertFreshTarget(args.backup, 'BACKUP_TARGET_EXISTS');
  assertFreshTarget(args.manifest, 'BACKUP_MANIFEST_EXISTS');

  store = new EventStore(args.db, { migrationMode: 'verify-only' });
  const { manifest, checkpoint } = await createConsistentBackup({
    store,
    backupPath: args.backup,
    manifestPath: args.manifest,
  });
  process.stdout.write(`${JSON.stringify({
    status: 'created',
    operation: 'online-consistent-backup',
    sourceFile: basename(args.db),
    backupFile: basename(args.backup),
    manifestFile: basename(args.manifest),
    creationMethod: manifest.creationMethod,
    databaseSha256: manifest.databaseSha256,
    audit: publicAudit(manifest),
    checkpoint: { busy: checkpoint.busy, log: checkpoint.log, checkpointed: checkpoint.checkpointed },
    secretMaterial: 'excluded',
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: 'error',
    code: error?.code ?? 'BACKUP_FAILED',
    message: error?.message ?? 'backup failed',
  })}\n`);
  process.exitCode = 1;
} finally {
  store?.close();
}
