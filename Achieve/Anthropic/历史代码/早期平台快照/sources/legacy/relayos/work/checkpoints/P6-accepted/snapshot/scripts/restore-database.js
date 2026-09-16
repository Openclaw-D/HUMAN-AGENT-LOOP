import { existsSync, lstatSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { restoreConsistentBackup } from '../src/ops/backup.js';

const REQUIRED_ARGUMENTS = new Set(['backup', 'manifest', 'target']);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parseArguments(argv) {
  if (argv.length === 0 || argv.length % 2 !== 0) {
    fail('CLI_ARGUMENTS_INVALID', '必须提供 --backup、--manifest、--target 及其值。');
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
    fail('CLI_PATH_CONFLICT', '备份、manifest 与恢复目标路径必须彼此不同。');
  }
}

function assertExistingRegularFile(filePath, label) {
  if (!existsSync(filePath) || !lstatSync(filePath).isFile()) {
    fail('RESTORE_SOURCE_INVALID', `${label} 必须是已存在的普通文件。`);
  }
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

try {
  const args = parseArguments(process.argv.slice(2));
  assertDistinct(args);
  assertExistingRegularFile(args.backup, 'backup');
  assertExistingRegularFile(args.manifest, 'manifest');
  if (existsSync(args.target)) fail('RESTORE_TARGET_EXISTS', '恢复目标必须是全新路径。');

  const restored = restoreConsistentBackup({
    backupPath: args.backup,
    manifestPath: args.manifest,
    destinationPath: args.target,
  });
  process.stdout.write(`${JSON.stringify({
    status: restored.status,
    operation: 'verified-restore',
    backupFile: basename(args.backup),
    manifestFile: basename(args.manifest),
    restoredFile: basename(args.target),
    audit: publicAudit(restored.audit),
    secretMaterial: 'excluded',
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: 'error',
    code: error?.code ?? 'RESTORE_FAILED',
    message: error?.message ?? 'restore failed',
  })}\n`);
  process.exitCode = 1;
}
