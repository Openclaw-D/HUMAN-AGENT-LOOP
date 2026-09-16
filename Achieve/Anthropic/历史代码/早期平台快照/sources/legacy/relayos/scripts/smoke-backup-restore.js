import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { RelayService } from '../src/application/service.js';
import { MockExternalSystemAdapter } from '../src/connectors/mock-adapter.js';
import { loadScenarioConfigs } from '../src/config/scenario-loader.js';
import { createConsistentBackup, restoreConsistentBackup } from '../src/ops/backup.js';
import { EventStore } from '../src/persistence/event-store.js';
import { containsCredential } from '../src/observability/credential-scan.js';
import { runP5ScenarioSuite } from './p5-scenario-suite.js';

const ROOT = resolve(import.meta.dirname, '..');

function parseArguments(argv) {
  if (argv.length === 0) return { evidencePath: null };
  if (argv.length !== 2 || argv[0] !== '--evidence' || !argv[1]) {
    throw new Error('Usage: node scripts/smoke-backup-restore.js [--evidence <new-json-path>]');
  }
  return { evidencePath: resolve(argv[1]) };
}

class CountingConnector extends MockExternalSystemAdapter {
  constructor() {
    super({ clock: () => '2026-08-26T10:00:00.000Z' });
    this.executeCount = 0;
  }

  async execute(intent, options) {
    this.executeCount += 1;
    return super.execute(intent, options);
  }
}

function sameAudit(left, right) {
  assert.equal(left.schemaVersion, right.schemaVersion);
  assert.deepEqual(left.counts, right.counts);
  assert.equal(left.eventChainDigest, right.eventChainDigest);
  assert.equal(left.projectionDigest, right.projectionDigest);
  assert.equal(left.commandReceiptDigest, right.commandReceiptDigest);
  assert.equal(left.idempotencyDigest, right.idempotencyDigest);
  assert.deepEqual(left.canonicalHashes, right.canonicalHashes);
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : entry.isFile() ? [path] : [];
  });
}

function scanTemporaryArtifacts(directory, sentinels) {
  const files = walkFiles(directory);
  let sentinelMatches = 0;
  let credentialPatternMatches = 0;
  for (const path of files) {
    const bytes = readFileSync(path);
    for (const sentinel of Object.values(sentinels)) if (bytes.includes(Buffer.from(sentinel))) sentinelMatches += 1;
    if (containsCredential(bytes)) credentialPatternMatches += 1;
  }
  assert.equal(sentinelMatches, 0, 'Runtime-only secret/credential/prompt/response sentinel leaked to a temporary artifact.');
  assert.equal(credentialPatternMatches, 0, 'Credential pattern appeared in a temporary artifact.');
  return { filesScanned: files.length, sentinelMatches, credentialPatternMatches };
}

function retryEnvelope(scenarioKey, configurationVersion, workCaseId) {
  return {
    commandId: `p6-restored-${scenarioKey}-unknown-retry`,
    idempotencyKey: `p5-${scenarioKey}-unknown-idem-8`,
    expectedStreamVersion: 999,
    configurationVersion,
    commandType: 'action.execute',
    demoActorRef: { kind: 'human', id: 'human-owner' },
    identityAssurance: 'demo_unverified',
    traceId: `trace-p6-restored-${scenarioKey}`,
    payload: { actionIntentId: `${workCaseId}:action:unknown` },
  };
}

async function main() {
  const { evidencePath } = parseArguments(process.argv.slice(2));
  if (evidencePath && existsSync(evidencePath)) throw new Error(`Evidence target must be new: ${evidencePath}`);
  const directory = mkdtempSync(join(tmpdir(), 'relayos-p6-backup-restore-'));
  const databasePath = join(directory, 'source.db');
  const backupPath = join(directory, 'online-backup.db');
  const manifestPath = join(directory, 'online-backup.manifest.json');
  const restoredPath = join(directory, 'restored.db');
  const nonce = createHash('sha256').update(randomUUID()).digest('hex');
  const sentinels = {
    runtimeSecret: `p6_runtime_secret_${nonce}`,
    credential: `p6_credential_${nonce}`,
    prompt: `p6_complete_prompt_${nonce}`,
    response: `p6_complete_response_${nonce}`,
  };
  process.env.RELAYOS_ZAI_GENERAL_API_KEY = sentinels.runtimeSecret;
  let sourceStore;
  let restoredStore;
  const startedAt = Date.now();
  try {
    const suite = await runP5ScenarioSuite({ databasePath, cleanup: false, verbose: false });
    assert.equal(suite.status, 'PASS');
    assert.equal(suite.passed, 10);
    assert.equal(suite.eventChain.eventCount, 480);
    assert.equal(suite.replayRebuilt, 20);

    sourceStore = new EventStore(databasePath, { migrationMode: 'verify-only' });
    const sourceAudit = sourceStore.auditSnapshot();
    const sourceReadiness = sourceStore.readiness();
    assert.equal(sourceAudit.schemaVersion, 2);
    assert.deepEqual(sourceAudit.counts, { streams: 20, events: 480, projections: 20, commandReceipts: 440 });
    const created = await createConsistentBackup({ store: sourceStore, backupPath, manifestPath });
    assert.equal(created.manifest.creationMethod, 'node:sqlite.backup-online-consistent');
    assert.equal(created.manifest.secretMaterial, 'excluded');
    assert.equal(created.checkpoint.busy, 0);
    sourceStore.close();
    sourceStore = null;

    const restored = restoreConsistentBackup({ backupPath, manifestPath, destinationPath: restoredPath });
    sameAudit(sourceAudit, restored.audit);
    restoredStore = new EventStore(restoredPath, { migrationMode: 'verify-only' });
    const beforeRebuild = restoredStore.auditSnapshot();
    const rebuilt = restoredStore.rebuildProjections({ dropFirst: true });
    assert.equal(rebuilt.rebuilt, 20);
    assert(rebuilt.projections.every((item) => item.matches === true));
    const afterRebuild = restoredStore.auditSnapshot();
    sameAudit(beforeRebuild, afterRebuild);

    const scenario = suite.results[0];
    const config = loadScenarioConfigs(resolve(ROOT, 'scenarios')).get(scenario.scenarioKey);
    const connector = new CountingConnector();
    const service = new RelayService({
      store: restoredStore,
      scenarioConfigs: loadScenarioConfigs(resolve(ROOT, 'scenarios')),
      connector,
      clock: () => '2026-08-26T10:00:00.000Z',
    });
    const beforeRetry = restoredStore.auditSnapshot();
    const retry = await service.executeCommand(
      scenario.unknownWorkCaseId,
      retryEnvelope(scenario.scenarioKey, config.version, scenario.unknownWorkCaseId),
    );
    assert.equal(retry.state.executionReceipts.at(-1).status, 'unknown');
    assert.equal(retry.state.executionReceipts.at(-1).completedAt, null);
    assert.equal(connector.executeCount, 0);
    sameAudit(restoredStore.auditSnapshot(), beforeRetry);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const scan = scanTemporaryArtifacts(directory, sentinels);
    const canonicalHashes = [...manifest.canonicalHashes].sort((left, right) => left.workCaseId.localeCompare(right.workCaseId, 'en'));
    const sourceImplementation = Object.fromEntries([
      'src/ops/backup.js',
      'src/observability/credential-scan.js',
      'src/persistence/event-store.js',
      'src/persistence/schema.js',
      'scripts/smoke-backup-restore.js',
    ].map((path) => [path, sha256File(resolve(ROOT, path))]));
    const evidence = {
      evidenceVersion: 1,
      gate: 'P6-accepted',
      status: 'PASS',
      nodeVersion: process.versions.node,
      backupManifestVersion: manifest.manifestVersion,
      backupManifestSha256: sha256File(manifestPath),
      creationMethod: manifest.creationMethod,
      databaseSha256: manifest.databaseSha256,
      schemaVersion: manifest.schemaVersion,
      counts: manifest.counts,
      eventChainDigest: manifest.eventChainDigest,
      projectionDigest: manifest.projectionDigest,
      commandReceiptDigest: manifest.commandReceiptDigest,
      idempotencyDigest: manifest.idempotencyDigest,
      canonicalWorkCaseCount: canonicalHashes.length,
      canonicalHashes,
      sourceImplementation,
      scenarioSuite: { passed: suite.passed, total: suite.total, eventCount: suite.eventChain.eventCount },
      restore: { targetWasNew: true, logicalAuditMatches: true, commandReceiptSemanticVerification: sourceReadiness.commandReceipts.status },
      replayRebuild: { rebuilt: rebuilt.rebuilt, hashMismatches: 0 },
      receiptAndIdempotency: { status: 'unknown', completedAt: null, retryConnectorCalls: connector.executeCount, auditChangedByRetry: false },
      scan: { ...scan, sentinelsChecked: Object.keys(sentinels).sort() },
      retainedRuntimeDatabaseOrLog: false,
      elapsedMs: Date.now() - startedAt,
      cleanup: 'temporary source/backup/restored DB, WAL and SHM files removed after verification',
    };
    if (evidencePath) {
      mkdirSync(dirname(evidencePath), { recursive: true });
      writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    }
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    delete process.env.RELAYOS_ZAI_GENERAL_API_KEY;
    try { sourceStore?.close(); } catch { /* cleanup only */ }
    try { restoredStore?.close(); } catch { /* cleanup only */ }
    rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`[P6 backup/restore smoke] FAIL ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
