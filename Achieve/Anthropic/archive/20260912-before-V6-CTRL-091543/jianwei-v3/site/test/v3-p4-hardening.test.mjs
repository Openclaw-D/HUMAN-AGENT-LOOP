import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';

import { assertV3DemoResetSession, createV3SharedRuntime, V3SqliteStore } from '../lib/v3-runtime/index.ts';
import { createV3DemoSession, resetV3DemoRuntime, resolveV3DemoSession } from '../lib/v3-demo-backend.ts';
import { projectWorkbenchReadModel } from '../lib/v3-surfaces/workbench/projection.ts';
import { V3_SCENARIO_CASES } from '../lib/v3-demo-scenario.ts';
import { assertV3ExternalInvitationScope, projectV3SharedConversation } from '../lib/v3-surfaces/shared/role-policies.ts';

const roots = [];

function databasePath() {
  const root = mkdtempSync(join(tmpdir(), 'jw-v3-p4-'));
  roots.push(root);
  return join(root, 'runtime.sqlite');
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const CASE_CONTEXT = {
  grain: 'case',
  portfolioId: 'PORTFOLIO-JW-DEMO',
  divisionId: 'DIV-EAST',
  caseId: 'FL-DEMO-001',
};

const ACTORS = {
  business: { principalId: 'business-owner', roleApplicationId: 'business' },
  customer: {
    principalId: 'external-customer', roleApplicationId: 'external',
    invitation: {
      invitationId: 'INV-P4-CUSTOMER', caseId: 'FL-DEMO-001', principalId: 'external-customer',
      workstepProcessId: 'opportunity', allowedActionTypes: ['chat', 'submit_evidence', 'confirm_fact'], status: 'active',
    },
  },
  supplier: {
    principalId: 'external-supplier', roleApplicationId: 'external',
    invitation: {
      invitationId: 'INV-P4-SUPPLIER', caseId: 'FL-DEMO-001', principalId: 'external-supplier',
      workstepProcessId: 'commercial', allowedActionTypes: ['chat', 'submit_evidence', 'confirm_fact'], status: 'active',
    },
  },
  asset: { principalId: 'risk-asset', roleApplicationId: 'risk' },
};

function accept(runtime, actor, suffix, processId) {
  return runtime.authorityRuntime.acceptEvidence({
    ...actor,
    caseId: 'FL-DEMO-001',
    requestId: `P4-EVIDENCE-${suffix}`,
    evidenceId: `P4-EV-${suffix}`,
    evidenceType: `p4-${suffix}`,
    sourceRef: `synthetic://p4/${suffix}`,
    contentHash: `sha256-p4-${suffix}`,
    processId,
  });
}

function driveToT3(runtime) {
  const t1 = accept(runtime, ACTORS.business, 'T1', 'policy');
  runtime.authorityRuntime.commitContext({
    ...ACTORS.business, caseId: 'FL-DEMO-001', requestId: 'P4-COMMIT-T1', transitionCode: 'T1',
    expectedContextVersion: 'CTX-0000', evidenceReceiptIds: [t1.receiptId], rationale: 'P4 T1',
  });
  const t2 = accept(runtime, ACTORS.customer, 'T2', 'opportunity');
  runtime.authorityRuntime.commitContext({
    ...ACTORS.customer, caseId: 'FL-DEMO-001', requestId: 'P4-COMMIT-T2', transitionCode: 'T2',
    expectedContextVersion: 'CTX-0001', evidenceReceiptIds: [t2.receiptId], rationale: 'P4 T2',
  });
  const customerT3 = accept(runtime, ACTORS.customer, 'T3-CUSTOMER', 'opportunity');
  const supplierT3 = accept(runtime, ACTORS.supplier, 'T3-SUPPLIER', 'commercial');
  runtime.authorityRuntime.commitContext({
    ...ACTORS.business, caseId: 'FL-DEMO-001', requestId: 'P4-COMMIT-T3', transitionCode: 'T3',
    expectedContextVersion: 'CTX-0002', evidenceReceiptIds: [customerT3.receiptId, supplierT3.receiptId], rationale: 'P4 T3',
  });
  const current = runtime.authorityRuntime.snapshot().currentContext.contextVersion;
  for (const run of runtime.authorityRuntime.snapshot().processRuns.filter((item) =>
    item.boundContextVersion === current && item.status !== 'superseded')) {
    runtime.authorityRuntime.updateProcessRun({
      caseId: 'FL-DEMO-001', requestId: `P4-${run.processId}-START`, runId: run.runId,
      status: 'running', readinessBand: 1, riskBand: 'unknown', evidenceCoverageBand: 1, summary: 'P4 running',
    });
    runtime.authorityRuntime.updateProcessRun({
      caseId: 'FL-DEMO-001', requestId: `P4-${run.processId}-READY`, runId: run.runId,
      status: 'ready_for_gate', readinessBand: 4, riskBand: 'medium', evidenceCoverageBand: 4, summary: 'P4 ready',
    });
  }
  return { t1, t2, customerT3, supplierT3 };
}

describe('V3 P4 canonical SQLite kernel', () => {
  it('keeps authority, shared Context and Workbench references on one persisted epoch', () => {
    const path = databasePath();
    const runtime = createV3SharedRuntime({ databasePath: path, now: () => '2026-08-30T12:00:00.000Z' });
    const evidence = driveToT3(runtime);
    const gate = runtime.authorityRuntime.recordHumanGate({
      ...ACTORS.asset, caseId: 'FL-DEMO-001', requestId: 'P4-GATE-ASSET', expectedContextVersion: 'CTX-0003',
      processId: 'asset', gateMode: 'HUMAN_DECIDE', decision: 'reject', rationale: 'P4 lineage accepted',
      evidenceReceiptIds: [evidence.customerT3.receiptId],
    });
    const snapshot = runtime.authorityRuntime.snapshot();
    const sharedContext = runtime.store.resolveContext(CASE_CONTEXT);
    assert.equal(sharedContext.contextVersion, snapshot.currentContext.contextVersion);
    assert.equal(snapshot.runtimeEpoch, runtime.store.getRuntimeEpoch());
    assert.ok(gate.receiptId.startsWith(snapshot.runtimeEpoch));
    assert.equal(runtime.store.listReceipts().find((item) => item.receiptId === gate.receiptId)?.payload.contextVersion, 'CTX-0003');
    runtime.close();

    const reopened = createV3SharedRuntime({ databasePath: path });
    assert.equal(reopened.authorityRuntime.snapshot().currentContext.contextVersion, 'CTX-0003');
    assert.equal(reopened.authorityRuntime.snapshot().receipts.some((item) => item.receiptId === gate.receiptId), true);
    reopened.close();
  });

  it('enforces the Human Gate Evidence lineage matrix and cross-Case isolation', async () => {
    const runtime = createV3SharedRuntime({ databasePath: databasePath() });
    const evidence = driveToT3(runtime);
    const sharedDelivery = await runtime.sendMessage({
      requestId: 'P4-DELIVERY', actorRole: 'business', context: CASE_CONTEXT, text: '普通 message delivery',
    });
    const base = {
      ...ACTORS.asset, caseId: 'FL-DEMO-001', expectedContextVersion: 'CTX-0003', processId: 'asset',
      gateMode: 'HUMAN_DECIDE', decision: 'reject', rationale: 'P4 lineage matrix',
    };
    for (const [requestId, receiptId, code] of [
      ['P4-GATE-MESSAGE', sharedDelivery.receiptId, 'EVIDENCE_RECEIPT_NOT_FOUND'],
      ['P4-GATE-CANDIDATE', 'candidate-not-a-receipt', 'EVIDENCE_RECEIPT_NOT_FOUND'],
      ['P4-GATE-UNKNOWN', 'missing-receipt', 'EVIDENCE_RECEIPT_NOT_FOUND'],
      ['P4-GATE-EXPIRED', evidence.t1.receiptId, 'EVIDENCE_CONTEXT_EXPIRED'],
    ]) {
      await assert.rejects(Promise.resolve().then(() => runtime.authorityRuntime.recordHumanGate({
        ...base, requestId, evidenceReceiptIds: [receiptId],
      })), (error) => error.code === code);
    }
    const evidenceEditor = new DatabaseSync(runtime.store.databasePath);
    evidenceEditor.prepare(`UPDATE authority_evidence SET status = 'revoked' WHERE receipt_id = ?`)
      .run(evidence.customerT3.receiptId);
    evidenceEditor.close();
    await assert.rejects(Promise.resolve().then(() => runtime.authorityRuntime.recordHumanGate({
      ...base, requestId: 'P4-GATE-REVOKED', evidenceReceiptIds: [evidence.customerT3.receiptId],
    })), (error) => error.code === 'EVIDENCE_STATUS_INVALID');
    const evidenceRestorer = new DatabaseSync(runtime.store.databasePath);
    evidenceRestorer.prepare(`UPDATE authority_evidence SET status = 'accepted' WHERE receipt_id = ?`)
      .run(evidence.customerT3.receiptId);
    evidenceRestorer.close();
    await assert.rejects(Promise.resolve().then(() => runtime.authorityRuntime.recordHumanGate({
      ...base, caseId: 'FL-BG-001', requestId: 'P4-GATE-OTHER-CASE', evidenceReceiptIds: [evidence.customerT3.receiptId],
    })), (error) => error.code === 'EVIDENCE_CASE_MISMATCH');
    const accepted = runtime.authorityRuntime.recordHumanGate({
      ...base, requestId: 'P4-GATE-VALID', evidenceReceiptIds: [evidence.customerT3.receiptId],
    });
    assert.equal(accepted.receiptType, 'human_gate');
    runtime.close();
  });

  it('singleflights eight concurrent same-key candidate requests', async () => {
    let adapterCalls = 0;
    const runtime = createV3SharedRuntime({
      databasePath: databasePath(),
      candidateAdapter: async () => {
        adapterCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 15));
        return { status: 'candidate', text: 'singleflight candidate' };
      },
    });
    const input = { requestId: 'P4-SINGLEFLIGHT', actorRole: 'business', context: CASE_CONTEXT, text: '@见微 并发测试' };
    const results = await Promise.all(Array.from({ length: 8 }, () => runtime.sendMessage(input)));
    assert.equal(adapterCalls, 1);
    assert.equal(new Set(results.map((item) => item.message.messageId)).size, 1);
    assert.equal(runtime.store.listMessages('CTX-FL-DEMO-001').filter((item) => item.actorKind === 'human').length, 1);
    runtime.close();
  });
});

describe('V3 P4 SQLite hardening', () => {
  it('reads Case readOnly and division from SQLite after fixture seeding', () => {
    const path = databasePath();
    const store = new V3SqliteStore(path);
    const editor = new DatabaseSync(path);
    editor.prepare(`UPDATE cases SET read_only = 1, division_id = 'DIV-CENTRAL' WHERE case_id = 'FL-DEMO-001'`).run();
    editor.close();
    const item = store.getCase('FL-DEMO-001');
    assert.equal(item.readOnly, true);
    assert.equal(item.divisionId, 'DIV-CENTRAL');
    assert.equal(item.businessItemType, 'FinancingLeasingCase');
    store.close();
  });

  it('authorizes both reset routes from server session only and ignores body role claims', async () => {
    assert.throws(() => assertV3DemoResetSession(null), (error) => error.code === 'DEMO_SESSION_REQUIRED');
    const business = createV3DemoSession('business-owner');
    assert.throws(() => assertV3DemoResetSession(business), (error) => error.code === 'ACTION_SCOPE_DENIED');
    const controller = createV3DemoSession('collaboration-manager');
    assert.doesNotThrow(() => assertV3DemoResetSession(controller));
    const runtime = createV3SharedRuntime({ databasePath: databasePath() });
    assert.throws(() => runtime.demoReset({ requestId: '', actorRole: 'leadership', confirmation: 'RESET_DEMO' }),
      (error) => error.code === 'INVALID_INPUT');
    runtime.close();
    const sharedResetSource = readFileSync(new URL('../app/api/v3/shared/demo-reset/route.ts', import.meta.url), 'utf8');
    const legacyResetSource = readFileSync(new URL('../app/api/v3/demo/reset/route.ts', import.meta.url), 'utf8');
    const backendSource = readFileSync(new URL('../lib/v3-demo-backend.ts', import.meta.url), 'utf8');
    assert.match(sharedResetSource, /resolveV3RequestSession/);
    assert.match(sharedResetSource, /assertV3DemoResetSession/);
    assert.doesNotMatch(sharedResetSource, /parseSharedRole|body\.actorRole|body\.role/);
    assert.match(legacyResetSource, /resolveV3RequestSession/);
    assert.match(legacyResetSource, /resetV3DemoRuntime/);
    assert.match(backendSource, /getV3SharedRuntime\(\)\.demoReset/);
  });

  it('projects external shared chat to invitation scope and hides formal Human Gate receipts', async () => {
    const runtime = createV3SharedRuntime({ databasePath: databasePath() });
    const evidence = driveToT3(runtime);
    runtime.authorityRuntime.recordHumanGate({
      ...ACTORS.asset, caseId: 'FL-DEMO-001', requestId: 'P4-EXTERNAL-HIDDEN-GATE', expectedContextVersion: 'CTX-0003',
      processId: 'asset', gateMode: 'HUMAN_DECIDE', decision: 'reject', rationale: 'internal only',
      evidenceReceiptIds: [evidence.customerT3.receiptId],
    });
    await runtime.sendMessage({ requestId: 'P4-INTERNAL-CHAT', actorRole: 'business', context: CASE_CONTEXT, text: '@政策 内部讨论' });
    await runtime.sendMessage({ requestId: 'P4-CUSTOMER-INVITE', actorRole: 'business', context: CASE_CONTEXT, text: '@客户 请补充材料' });
    await runtime.sendMessage({ requestId: 'P4-CUSTOMER-REPLY', actorRole: 'customer', context: CASE_CONTEXT, text: '客户已补充' });
    const projection = projectV3SharedConversation(
      'customer',
      runtime.store.listMessages('CTX-FL-DEMO-001'),
      runtime.store.listReceipts().filter((item) => item.contextId === 'CTX-FL-DEMO-001'),
    );
    assert.equal(projection.messages.some((item) => item.requestId === 'P4-INTERNAL-CHAT'), false);
    assert.equal(projection.messages.some((item) => item.requestId === 'P4-CUSTOMER-INVITE'), true);
    assert.equal(projection.messages.some((item) => item.requestId === 'P4-CUSTOMER-REPLY'), true);
    assert.equal(projection.receipts.some((item) => item.formal || item.receiptType === 'human_gate'), false);

    assert.throws(() => assertV3ExternalInvitationScope('customer', 'FL-DEMO-001', 'FL-BG-001'),
      (error) => error.code === 'INVITATION_SCOPE_DENIED');
    runtime.close();
  });

  it('migrates an older fixture, records the ledger, and rejects unknown future schemas', () => {
    const oldPath = databasePath();
    const old = new DatabaseSync(oldPath);
    old.exec('PRAGMA user_version = 1');
    old.close();
    const migrated = new V3SqliteStore(oldPath);
    migrated.close();
    const verified = new DatabaseSync(oldPath);
    assert.equal(verified.prepare('PRAGMA user_version').get().user_version, 5);
    assert.deepEqual(verified.prepare('SELECT version FROM migration_ledger ORDER BY version').all().map((row) => row.version), [1, 2, 3, 4, 5]);
    assert.equal(verified.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    verified.close();

    const futurePath = databasePath();
    const future = new DatabaseSync(futurePath);
    future.exec('PRAGMA user_version = 99');
    future.close();
    assert.throws(() => new V3SqliteStore(futurePath), (error) => error.code === 'SCHEMA_VERSION_UNSUPPORTED');
    const unchangedFuture = new DatabaseSync(futurePath);
    assert.equal(unchangedFuture.prepare('PRAGMA user_version').get().user_version, 99);
    assert.equal(unchangedFuture.prepare(`SELECT COUNT(*) AS count FROM sqlite_schema WHERE name = 'migration_ledger'`).get().count, 0);
    unchangedFuture.close();
  });

  it('bounds lock waits and normalizes SQLite busy as retryable', () => {
    const path = databasePath();
    const store = new V3SqliteStore(path);
    const locker = new DatabaseSync(path);
    locker.exec('BEGIN IMMEDIATE');
    assert.throws(() => store.demoReset({
      requestId: 'P4-LOCKED-RESET', actorRole: 'leadership', confirmation: 'RESET_DEMO', now: '2026-08-30T12:30:00.000Z',
    }), (error) => error.code === 'SQLITE_BUSY_RETRYABLE' && error.retryable === true);
    locker.exec('ROLLBACK');
    locker.close();
    store.close();
  });

  it('shares sessions across isolated SQLite owners and fails closed for expired or mismatched records', () => {
    const path = databasePath();
    const creator = new V3SqliteStore(path);
    const resolver = new V3SqliteStore(path);
    const base = {
      sessionId: 'V3-DEMO-SESSION-ROUTE-ISOLATION',
      principalId: 'business-owner',
      roleApplicationId: 'business',
      invitation: null,
      createdAt: '2026-08-30T12:00:00.000Z',
      expiresAt: '2026-08-30T20:00:00.000Z',
    };
    creator.createDemoSession(base);
    assert.deepEqual(resolver.resolveDemoSession(base.sessionId, '2026-08-30T12:01:00.000Z'), base);
    assert.throws(
      () => resolver.resolveDemoSession('V3-DEMO-SESSION-UNKNOWN', '2026-08-30T12:01:00.000Z'),
      (error) => error.code === 'DEMO_SESSION_NOT_FOUND',
    );
    assert.throws(
      () => resolver.resolveDemoSession(base.sessionId, '2026-08-30T20:00:00.000Z'),
      (error) => error.code === 'DEMO_SESSION_EXPIRED',
    );
    const editor = new DatabaseSync(path);
    editor.prepare(`UPDATE demo_sessions SET role_application_id = 'leadership' WHERE session_id = ?`).run(base.sessionId);
    editor.close();
    assert.throws(
      () => resolver.resolveDemoSession(base.sessionId, '2026-08-30T12:01:00.000Z'),
      (error) => error.code === 'DEMO_SESSION_MISMATCH',
    );
    resolver.close();
    creator.close();
  });

  it('resolves a session created by a separate route-like Node process after restart', () => {
    const path = databasePath();
    const common = {
      cwd: process.cwd(),
      env: { ...process.env, JIANWEI_V3_SQLITE_PATH: path },
      encoding: 'utf8',
    };
    const created = spawnSync(process.execPath, [
      '--experimental-strip-types',
      '--input-type=module',
      '--eval',
      "import { createV3DemoSession } from './lib/v3-demo-backend.ts'; process.stdout.write(JSON.stringify(createV3DemoSession('business-owner')));",
    ], common);
    assert.equal(created.status, 0, created.stderr);
    const session = JSON.parse(created.stdout);
    const resolved = spawnSync(process.execPath, [
      '--experimental-strip-types',
      '--input-type=module',
      '--eval',
      "import { getV3RoleCaseProjection, resolveV3DemoSession } from './lib/v3-demo-backend.ts'; const session = resolveV3DemoSession(process.env.TEST_SESSION_ID); const projection = getV3RoleCaseProjection(session, 'FL-DEMO-001'); process.stdout.write(JSON.stringify({ session, caseId: projection.caseId }));",
    ], {
      ...common,
      env: { ...common.env, TEST_SESSION_ID: session.sessionId },
    });
    assert.equal(resolved.status, 0, resolved.stderr);
    assert.deepEqual(JSON.parse(resolved.stdout), { session, caseId: 'FL-DEMO-001' });
  });

  it('rejects an external session whose persisted invitation escapes the Golden Case', () => {
    const store = new V3SqliteStore(databasePath());
    store.createDemoSession({
      sessionId: 'V3-DEMO-SESSION-CASE-MISMATCH',
      principalId: 'external-customer',
      roleApplicationId: 'external',
      invitation: {
        invitationId: 'INV-MISMATCH',
        caseId: 'FL-BG-001',
        principalId: 'external-customer',
        workstepProcessId: 'opportunity',
        allowedActionTypes: ['chat'],
        status: 'active',
      },
      createdAt: '2026-08-30T12:00:00.000Z',
      expiresAt: '2026-08-30T20:00:00.000Z',
    });
    assert.throws(
      () => store.resolveDemoSession('V3-DEMO-SESSION-CASE-MISMATCH', '2026-08-30T12:01:00.000Z'),
      (error) => error.code === 'DEMO_SESSION_MISMATCH',
    );
    store.close();
  });

  it('keeps server-resolved collaboration-manager authorization across Demo Reset', () => {
    const controller = createV3DemoSession('collaboration-manager');
    assert.equal(resolveV3DemoSession(controller.sessionId).principalId, 'collaboration-manager');
    resetV3DemoRuntime();
    assert.equal(resolveV3DemoSession(controller.sessionId).roleApplicationId, 'leadership');
  });

  it('keeps genuinely missing progress null and displays 未提供', () => {
    const background = structuredClone(V3_SCENARIO_CASES[1]);
    const model = projectWorkbenchReadModel({
      caseItem: background, runtimeEpoch: null, currentContext: null,
      processRuns: [], receipts: [], events: [],
    }, {
      sessionId: 'P4-READ', principalId: 'risk-asset', roleApplicationId: 'risk',
    }, 'asset', {
      authorityRuntime: { status: 'connected', implementation: 'canonical-shared-sqlite', persistence: 'sqlite-local-demo' },
      chat: { status: 'connected', implementation: 'shared-v3-sqlite-chat' },
      sqlite: { status: 'connected', owner: 'V3 Shared Runtime', implementation: 'canonical-shared-sqlite' },
    });
    assert.equal(model.professionalProjections.asset.rollup.continuousPercent, null);
    assert.equal(model.professionalProjections.asset.rollup.quarterThreshold, null);
    assert.equal(model.professionalProjections.asset.result, '未提供');
  });
});
