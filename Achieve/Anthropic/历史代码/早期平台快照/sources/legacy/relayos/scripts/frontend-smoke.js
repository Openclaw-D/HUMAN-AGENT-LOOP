import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { RelayService } from '../src/application/service.js';
import { MockExternalSystemAdapter } from '../src/connectors/mock-adapter.js';
import { loadScenarioConfigs } from '../src/config/scenario-loader.js';
import { createRelayHttpServer } from '../src/http/server.js';
import { EventStore } from '../src/persistence/event-store.js';

const directory = mkdtempSync(join(tmpdir(), 'relayos-p4-frontend-smoke-'));
const databasePath = join(directory, 'frontend.db');
let store;
let server;

async function json(base, path, options) {
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`${path} failed ${response.status}/${body.error?.code ?? 'unknown'}`);
  return body;
}

try {
  const seed = spawnSync(process.execPath, [resolve('scripts/seed-p4-demo.js'), '--db', databasePath], { cwd: resolve('.'), encoding: 'utf8', timeout: 20_000 });
  if (seed.status !== 0) throw new Error(`P4 seed failed: ${seed.stderr}`);
  store = new EventStore(databasePath);
  const service = new RelayService({
    store,
    scenarioConfigs: loadScenarioConfigs(resolve('scenarios')),
    connector: new MockExternalSystemAdapter(),
  });
  server = createRelayHttpServer({ service, publicDirectory: resolve('public') });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  const base = `http://127.0.0.1:${server.address().port}`;

  const root = await fetch(`${base}/`);
  if (root.status !== 200 || !(await root.text()).includes('连续性关系图')) throw new Error('P4 root static UI failed.');
  const cssHead = await fetch(`${base}/styles.css`, { method: 'HEAD' });
  if (cssHead.status !== 200 || !cssHead.headers.get('content-type')?.startsWith('text/css')) throw new Error('P4 CSS HEAD failed.');
  const ready = await json(base, '/health/ready');
  const cases = await json(base, '/api/work-cases');
  const offeredCase = cases.workCases.find((item) => item.state.handoffOffers.some((offer) => offer.status === 'offered'));
  if (!offeredCase) throw new Error('P4 seed did not create offered handoff state.');
  const before = await json(base, `/api/work-cases/${offeredCase.workCaseId}/graph`);
  if (before.fiveQuestions.owner.actorRef.id !== 'human-owner' || !before.fiveQuestions.pendingHandoff.ownerUnchanged) throw new Error('Offered handoff graph semantics failed.');

  const advisoryHash = before.source.projectionHash;
  const advisory = await json(base, '/api/advisories', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({
      providerRequestId: 'p4-frontend-smoke-advisory',
      operation: 'conflict.identify',
      workCaseId: offeredCase.workCaseId,
      goalVersion: before.rawRefs.acceptedGoalVersion,
      contextVersion: before.rawRefs.contextVersion,
      inputRefs: before.rawRefs.evidenceIds,
      outputSchemaVersion: 1,
      promptVersion: 'p4-ui-v1',
      evaluationVersion: 'p4-eval-v1',
      traceId: 'trace-p4-frontend-smoke-advisory',
      deadlineMs: 15_000,
      dataClassification: 'internal',
    }),
  });
  const afterAdvisory = await json(base, `/api/work-cases/${offeredCase.workCaseId}/graph`);
  if (advisory.authority !== 'none' || afterAdvisory.source.projectionHash !== advisoryHash) throw new Error('Advisory changed authoritative graph snapshot.');

  const offerId = before.fiveQuestions.pendingHandoff.offerId;
  await json(base, `/api/work-cases/${offeredCase.workCaseId}/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({
      commandId: 'p4-frontend-smoke-accept',
      idempotencyKey: 'p4-frontend-smoke-accept-idempotency',
      expectedStreamVersion: before.source.projectionVersion,
      configurationVersion: 1,
      commandType: 'handoff.accept',
      demoActorRef: { kind: 'human', id: 'human-reviewer' },
      identityAssurance: 'demo_unverified',
      traceId: 'trace-p4-frontend-smoke-accept',
      payload: { offerId, reason: 'frontend smoke 明确接受', nextAction: '从后端新投影继续推进' },
    }),
  });
  const accepted = await json(base, `/api/work-cases/${offeredCase.workCaseId}/graph`);
  if (accepted.fiveQuestions.owner.actorRef.id !== 'human-reviewer' || accepted.fiveQuestions.pendingHandoff.offerId !== null) throw new Error('Accepted handoff did not update backend-derived owner edge.');
  const receiptCase = cases.workCases.find((item) => item.state.executionReceipts.some((receipt) => receipt.status === 'unknown'));
  const receiptGraph = await json(base, `/api/work-cases/${receiptCase.workCaseId}/graph`);
  if (!receiptGraph.edges.some((edge) => edge.receiptStatus === 'unknown')) throw new Error('Unknown receipt is missing from graph.');

  process.stdout.write(`${JSON.stringify({
    status: 'passed', port: 0, seedCases: cases.workCases.length,
    staticRoot: 200, cssHead: 200, provider: ready.advisoryProvider.providerId,
    offeredOwnerBefore: before.fiveQuestions.owner.actorRef.id,
    acceptedOwnerAfter: accepted.fiveQuestions.owner.actorRef.id,
    advisoryAuthority: advisory.authority,
    advisoryGraphUnchanged: true,
    receiptStatus: 'unknown',
  })}\n`);
} finally {
  if (server?.listening) await new Promise((resolveClose) => server.close(resolveClose));
  try { store?.close(); } catch { /* already closed */ }
  rmSync(directory, { recursive: true, force: true });
}
