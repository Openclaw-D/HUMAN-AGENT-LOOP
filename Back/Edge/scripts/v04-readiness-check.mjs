import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Metadata only: never read contents, enumerate directories, or print supplied paths.
export async function checkPersistence({ messagesFile, modelReceiptsDir } = {}, statPath = stat) {
  async function inspect(path, kind) {
    if (path === undefined) return { status: 'not_configured' };
    if (typeof path !== 'string' || !path.trim()) return { status: 'check_failed', reason: 'invalid_path' };
    try {
      const info = await statPath(path);
      if (!(kind === 'file' ? info.isFile() : info.isDirectory())) {
        return { status: 'check_failed', reason: 'wrong_path_type' };
      }
      return { status: 'configured_path_exists' };
    } catch (error) {
      if (error?.code === 'ENOENT') return { status: 'path_missing' };
      const reason = ['EACCES', 'EPERM'].includes(error?.code) ? 'access_denied' : 'metadata_error';
      return { status: 'check_failed', reason };
    }
  }
  const messages = await inspect(messagesFile, 'file');
  const modelReceipts = await inspect(modelReceiptsDir, 'directory');
  const statuses = [messages.status, modelReceipts.status];
  return {
    check: 'declared_paths_only',
    messages, modelReceipts,
    businessEvents: { status: 'not_checked', reason: 'database_and_runtime_out_of_scope' },
    runtimeReadiness: 'unknown',
    limitations: ['existence_does_not_prove_active_use', 'writability_not_checked', 'restart_recovery_not_checked'],
    exitCode: statuses.includes('check_failed') ? 1 : statuses.every(s => s === 'configured_path_exists') ? 0 : 2,
  };
}

export async function runCli(args, output = line => process.stdout.write(line + '\n')) {
  const options = {};
  const flags = { '--messages-file': 'messagesFile', '--model-receipts-dir': 'modelReceiptsDir' };
  for (let i = 0; i < args.length; i += 2) {
    const key = Object.hasOwn(flags, args[i]) ? flags[args[i]] : null;
    if (!key || Object.hasOwn(options, key) || !args[i + 1]?.trim() || args[i + 1].startsWith('--')) {
      output(JSON.stringify({ error: 'invalid_arguments', runtimeReadiness: 'unknown', exitCode: 1 }));
      return 1;
    }
    options[key] = args[i + 1];
  }
  const result = await checkPersistence(options);
  output(JSON.stringify(result, null, 2));
  return result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
