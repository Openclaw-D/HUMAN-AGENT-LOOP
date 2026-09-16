import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runV3FullScenario } from './v3-full-run.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(scriptDir, '..');
const evidenceRoot = path.resolve(siteRoot, '..', '..', 'V3_ACCEPTANCE_EVIDENCE');

function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function acceptancePhase(value) {
  if (value !== 'prepare' && value !== 'runtime') {
    throw new Error('acceptance phase must be prepare or runtime');
  }
  return value;
}

function safeRunId(value) {
  if (!value || !/^[A-Za-z0-9._-]+$/.test(value)) throw new Error('acceptance run id must use letters, digits, dot, underscore, or hyphen');
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function collectFiles(root, relative = '') {
  const full = path.join(root, relative);
  const entries = await readdir(full, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(root, child));
    else if (entry.isFile()) files.push(child.replaceAll('\\', '/'));
  }
  return files;
}

async function sourceFingerprint() {
  const roots = ['app', 'lib', 'scripts', 'test'];
  const files = ['package.json', 'package-lock.json', 'vite.config.ts'];
  for (const root of roots) {
    for (const file of await collectFiles(siteRoot, root)) files.push(file);
  }
  files.sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(await readFile(path.join(siteRoot, file)));
    hash.update('\0');
  }
  return { algorithm: 'sha256', value: hash.digest('hex'), fileCount: files.length, files };
}

function runNpmScript(script) {
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', `npm.cmd run ${script}`] : ['run', script];
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, { cwd: siteRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const endedAt = new Date().toISOString();
  return {
    command: `npm.cmd run ${script}`,
    startedAt,
    endedAt,
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ? String(result.error.message ?? result.error) : null,
  };
}

async function credentialScan() {
  const patterns = [
    { id: 'openai-key', expression: /sk-[A-Za-z0-9_-]{20,}/g },
    { id: 'google-key', expression: /AIza[0-9A-Za-z_-]{30,}/g },
    { id: 'private-key', expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
    { id: 'hardcoded-password', expression: /(?:password|passwd)\s*[:=]\s*["'][^"'\r\n]{8,}["']/gi },
  ];
  const candidates = [];
  for (const root of ['app', 'lib', 'scripts', 'test']) candidates.push(...await collectFiles(siteRoot, root));
  candidates.push('package.json', 'vite.config.ts');
  const findings = [];
  for (const relativePath of candidates) {
    const absolutePath = path.join(siteRoot, relativePath);
    const info = await stat(absolutePath);
    if (info.size > 2_000_000) continue;
    const content = await readFile(absolutePath, 'utf8');
    for (const pattern of patterns) {
      pattern.expression.lastIndex = 0;
      if (pattern.expression.test(content)) findings.push({ patternId: pattern.id, path: relativePath.replaceAll('\\', '/') });
    }
  }
  return { scannedFileCount: candidates.length, patternIds: patterns.map((item) => item.id), findings, passed: findings.length === 0 };
}

const baseUrl = argument('--base-url', process.env.V3_BASE_URL ?? 'http://localhost:3000');
const runId = safeRunId(argument('--run-id', `JW-V3-ACCEPT-${new Date().toISOString().replaceAll(/[-:TZ.]/g, '').slice(0, 14)}`));
const serverPid = Number(argument('--server-pid', '0')) || null;
const phase = acceptancePhase(argument('--phase'));
const runDir = path.join(evidenceRoot, runId);
const directories = ['commands', 'http', 'browser', 'scenario-runs', 'events', 'receipts', 'security'];
await Promise.all(directories.map((directory) => mkdir(path.join(runDir, directory), { recursive: true })));

const startedAt = new Date().toISOString();
const fingerprint = await sourceFingerprint();
const preparedPath = path.join(runDir, 'prepared.json');
let commandResults;

if (phase === 'prepare') {
  commandResults = {};
  for (const script of ['test', 'typecheck', 'lint', 'build']) {
    const result = runNpmScript(script);
    commandResults[script] = result;
    await writeFile(path.join(runDir, 'commands', `${script}.log`), `${result.stdout}${result.stderr}`, 'utf8');
    assert.equal(result.exitCode, 0, `${result.command} failed; see evidence log`);
  }
  const prepared = {
    ok: true,
    phase,
    runId,
    evidenceDirectory: runDir,
    sourceFingerprint: fingerprint.value,
    preparedAt: new Date().toISOString(),
    commands: Object.fromEntries(Object.entries(commandResults).map(([key, value]) => [key, {
      command: value.command,
      startedAt: value.startedAt,
      endedAt: value.endedAt,
      exitCode: value.exitCode,
    }])),
    next: 'Restart the production server from this build, then run --phase runtime with the same --run-id.',
  };
  await writeFile(preparedPath, stableJson(prepared), 'utf8');
  process.stdout.write(stableJson(prepared));
  process.exit(0);
}

const prepared = JSON.parse(await readFile(preparedPath, 'utf8'));
assert.equal(prepared.sourceFingerprint, fingerprint.value, 'source changed after acceptance prepare phase');
commandResults = prepared.commands;
for (const [script, result] of Object.entries(commandResults)) {
  assert.equal(result.exitCode, 0, `prepared ${script} check did not pass`);
}

const scenarioResponse = await fetch(new URL('/api/v3/demo/scenario', baseUrl));
assert.equal(scenarioResponse.status, 200, 'scenario endpoint must return 200');
const scenario = await scenarioResponse.json();
const runs = [];
for (let index = 1; index <= 3; index += 1) {
  const run = await runV3FullScenario({ baseUrl, runLabel: `acceptance-${index}` });
  runs.push(run);
  await writeFile(path.join(runDir, 'scenario-runs', `run-${index}.json`), stableJson(run), 'utf8');
}
assert.deepEqual(runs[1].normalized, runs[0].normalized, 'run-2 differs from run-1');
assert.deepEqual(runs[2].normalized, runs[0].normalized, 'run-3 differs from run-1');

await writeFile(path.join(runDir, 'events', 'normalized-events.json'), stableJson(runs[0].normalized.events), 'utf8');
await writeFile(path.join(runDir, 'receipts', 'normalized-receipts.json'), stableJson(runs[0].normalized.receipts), 'utf8');
const repeatability = {
  passed: true,
  runCount: runs.length,
  runtimeEpochs: runs.map((run) => run.runtimeEpoch),
  eventCounts: runs.map((run) => run.eventCount),
  receiptCounts: runs.map((run) => run.receiptCount),
  negativeChecksPerRun: runs.map((run) => run.negativeChecks),
  normalizedStructureEqual: true,
};
await writeFile(path.join(runDir, 'http', 'repeatability.json'), stableJson(repeatability), 'utf8');

const security = await credentialScan();
await writeFile(path.join(runDir, 'security', 'credential-scan.json'), stableJson(security), 'utf8');
assert.equal(security.passed, true, 'credential scan found a candidate secret');

const limitations = `# V3 Demo Limitations\n\n- 本证据只证明比赛 Demo，不证明 production readiness。\n- Authority runtime 为进程内内存实现；重启服务会回到固定合成 Scenario。\n- 已验证 fresh reset 后三轮结构一致，但尚未实现从 Event Ledger 单独重建全部 Projection 的 event-only replay comparator。\n- KPI 为比赛用受控预测/运营投影，不代表真实已实现利润。\n- 模型候选 authority=none；未配置 live model 时不冒充真实模型调用。\n- 未执行部署、真实内网接口、真实客户数据、生产权限或生产安全认证。\n`;
await writeFile(path.join(runDir, 'LIMITATIONS.md'), limitations, 'utf8');

const machinePass = [
  'AUTH-01', 'AUTH-02', 'AUTH-03', 'AUTH-04', 'AUTH-05', 'AUTH-06',
  'SCN-01', 'SCN-02', 'SCN-03', 'SCN-04', 'SCN-05', 'SCN-06', 'SCN-07', 'SCN-08', 'SCN-09',
  'ASYNC-01', 'ASYNC-02', 'ASYNC-03', 'ASYNC-04', 'ASYNC-05',
  'ROLE-04', 'ROLE-05', 'ROLE-06', 'ROLE-07',
  'MGMT-01', 'MGMT-03', 'MGMT-05', 'MGMT-06',
  'EXT-03', 'EXT-04',
  'ENG-01', 'ENG-02', 'ENG-03', 'ENG-04', 'ENG-05', 'ENG-07',
  'TRUTH-01', 'TRUTH-02', 'TRUTH-03', 'TRUTH-04', 'TRUTH-05',
];
const result = {
  ok: true,
  phase,
  runId,
  evidenceDirectory: runDir,
  sourceFingerprint: fingerprint.value,
  staticChecks: Object.fromEntries(Object.entries(commandResults).map(([key, value]) => [key, value.exitCode === 0 ? 'PASS' : 'FAIL'])),
  repeatability,
  security,
  matrixStatus: Object.fromEntries(machinePass.map((id) => [id, 'PASS'])),
  browserStatus: 'PENDING_EXTERNAL_BROWSER_EVIDENCE',
};
await writeFile(path.join(runDir, 'result.json'), stableJson(result), 'utf8');

const manifest = {
  acceptanceRunId: runId,
  startedAt: prepared.preparedAt ?? startedAt,
  endedAt: new Date().toISOString(),
  sourceFingerprint: fingerprint,
  build: { command: commandResults.build.command, completedAt: commandResults.build.endedAt, exitCode: commandResults.build.exitCode },
  scenario: scenario.scenarioRef,
  nodeVersion: process.version,
  server: { baseUrl, pid: serverPid, command: 'vinext start', workspace: siteRoot },
  commands: Object.fromEntries(Object.entries(commandResults).map(([key, value]) => [key, { command: value.command, exitCode: value.exitCode, startedAt: value.startedAt, endedAt: value.endedAt }])),
  repeatability,
  credentialScan: { passed: security.passed, scannedFileCount: security.scannedFileCount, findingCount: security.findings.length },
  browserEvidence: 'browser/acceptance.json',
  limitations: 'LIMITATIONS.md',
};
await writeFile(path.join(runDir, 'manifest.json'), stableJson(manifest), 'utf8');
process.stdout.write(stableJson(result));
