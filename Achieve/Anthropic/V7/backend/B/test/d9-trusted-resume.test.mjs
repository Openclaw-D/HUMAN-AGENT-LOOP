// V7-B D-9 可信恢复身份:两候选对称正反例。
// 矩阵:无验证器/错凭据/伪造 actor 自声明/验证器异常/错项目/错动作 → 一律失败关闭,
// 且不触发任何外部调用;合成可信正例可恢复;凭据零落盘(journal/snapshot/回执/checkpoint)。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createScriptedTransport, createTestAdapter, createHarness, cleanupDir,
  makeTempDir, EVIDENCE, TEST_PRINCIPAL_TOKEN, createTestPrincipalVerifier, createDenyAuthorizer,
} from './helpers.mjs';
import { createThinOrchestrator } from '../src/thin/orchestrator.mjs';
import { createLangGraphOrchestrator } from '../src/langgraph/orchestrator.mjs';
import { FileCheckpointSaver } from '../src/langgraph/file-checkpointer.mjs';
import { LocalFileFactStore, FactStorePort, ReceiptsPort, LocalFileReceipts, ToolsPort, LocalStubCalculation } from '../src/ports.mjs';

const STEP = 'model:credit:risk_review';
const RESUME = { principalCredential: TEST_PRINCIPAL_TOKEN, action: 'retry_step', stepId: STEP, payload: {} };

/** 断言 B 侧所有落盘文件不含凭据明文。 */
async function assertCredentialNotOnDisk(dirs, credential) {
  const { readdir, readFile } = await import('node:fs/promises');
  const hits = [];
  async function walk(d) {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) await walk(p);
      else {
        let text;
        try { text = await readFile(p, 'utf8'); } catch { continue; }
        if (text.includes(credential)) hits.push(p);
      }
    }
  }
  for (const d of dirs) await walk(d);
  assert.deepEqual(hits, [], `凭据不得落盘,命中:${hits.join(',')}`);
}

test('D-9 thin:无验证器/错凭据/伪造actor/验证器异常 → 全部失败关闭且零外部调用', async () => {
  const calls = [];
  const h = await createHarness({
    transport: createScriptedTransport({ byRole: { credit: { ok: 'indeterminate' } }, calls }),
  });
  try {
    await h.thin.start({ runId: 'd9-t1', projectId: 'proj-1', eventType: 'new_application', evidenceRefs: EVIDENCE });
    const callsBefore = calls.length;

    // 1) 无验证器(未注入身份源) → 失败关闭
    const { LocalFileFactStore, FactStorePort, ReceiptsPort, LocalFileReceipts, ToolsPort, LocalStubCalculation } = await import('../src/ports.mjs');
    const mkPorts = () => ({
      factStore: new FactStorePort(new LocalFileFactStore(h.dataDir)),
      receipts: new ReceiptsPort(new LocalFileReceipts(h.dataDir)),
      tools: new ToolsPort(new LocalStubCalculation()),
    });
    const noVerifier = createThinOrchestrator({
      ports: mkPorts(), adapter: createTestAdapter(createScriptedTransport({})),
      dataDir: `${h.dataDir}/thin`, principalVerifier: null,
    });
    await assert.rejects(
      () => noVerifier.resume('d9-t1', RESUME),
      (e) => e.code === 'PRINCIPAL_UNTRUSTED' && /未配置可信身份验证器/.test(e.message),
    );

    // 2) 错凭据 → 失败关闭
    await assert.rejects(
      () => h.thin.resume('d9-t1', { ...RESUME, principalCredential: 'forged-token' }),
      (e) => e.code === 'PRINCIPAL_UNTRUSTED',
    );

    // 3) 伪造 actor 自声明(无凭据) → 失败关闭:自声明字段不构成授权
    await assert.rejects(
      () => h.thin.resume('d9-t1', { actor: { id: 'attacker', role: 'coordinator' }, action: 'retry_step', stepId: STEP, payload: {} }),
      (e) => e.code === 'PRINCIPAL_UNTRUSTED',
    );

    // 4) 验证器异常 → 失败关闭
    const throwingVerifier = () => { throw new Error('身份源不可达(注入)'); };
    const throwOrch = createThinOrchestrator({
      ports: mkPorts(), adapter: createTestAdapter(createScriptedTransport({})),
      dataDir: `${h.dataDir}/thin`, principalVerifier: throwingVerifier,
    });
    await assert.rejects(
      () => throwOrch.resume('d9-t1', RESUME),
      (e) => e.code === 'PRINCIPAL_UNTRUSTED' && /身份源不可达/.test(e.message),
    );

    // 全部拒绝后:未知步不得被重试、不得产生任何新外部调用
    assert.equal(calls.length, callsBefore, '拒绝的 resume 不得触发外部调用');
    const view = await h.thin.view('d9-t1');
    assert.equal(view.steps[0].attempt, 0, 'attempt 不得被无效 resume 推进');
    // 凭据零落盘
    await assertCredentialNotOnDisk([`${h.dataDir}/thin`, h.dataDir.replace(/[^/\\]+$/, '') + '/x-nonexist'].filter((_, i) => i === 0), 'forged-token');
  } finally { await cleanupDir(h.dataDir); }
});

test('D-9 thin:授权器拒绝错项目/错动作(AUTHORIZATION_DENIED);合成可信正例可恢复', async () => {
  const calls = [];
  const byRole = { credit: { ok: 'indeterminate' } };
  const h = await createHarness({
    transport: createScriptedTransport({ byRole, calls }),
    authorizer: createDenyAuthorizer({ projects: ['proj-forbidden'], actions: ['take_over'] }),
  });
  try {
    await h.thin.start({ runId: 'd9-t2', projectId: 'proj-1', eventType: 'new_application', evidenceRefs: EVIDENCE });
    // 错项目(授权器按上下文拒绝)
    const projDenied = createThinOrchestrator({
      ports: {
        factStore: new FactStorePort({
          async currentVersions() { return { factVersion: '3', ruleVersion: '1' }; },
        }),
        receipts: new ReceiptsPort(new LocalFileReceipts(await makeTempDir('d9-rcpt'))),
        tools: new ToolsPort(new LocalStubCalculation()),
      },
      adapter: createTestAdapter(createScriptedTransport({})),
      dataDir: `${h.dataDir}/thin`,
      principalVerifier: createTestPrincipalVerifier(),
      authorizer: createDenyAuthorizer({ projects: ['proj-1'] }), // 本策略明确拒绝 proj-1
    });
    await assert.rejects(
      () => projDenied.resume('d9-t2', RESUME),
      (e) => e.code === 'AUTHORIZATION_DENIED',
    );
    // 错动作(授权器拒绝 take_over;retry_step 被放行)
    await assert.rejects(
      () => h.thin.resume('d9-t2', { ...RESUME, action: 'take_over' }),
      (e) => e.code === 'AUTHORIZATION_DENIED' && /take_over/.test(e.message),
    );
    // 合成可信正例:凭据+授权通过 → 恢复执行(人工核实后通道恢复)
    byRole.credit = {};
    const v = await h.thin.resume('d9-t2', RESUME);
    assert.equal(v.state, 'completed');
    assert.equal(v.steps[0].attempt, 1);
    assert.ok(v.steps[0].requestId.endsWith('::a1'));
    assert.equal(v.humanActions[0].principal.role, 'human');
    await assertCredentialNotOnDisk([`${h.dataDir}/thin`], TEST_PRINCIPAL_TOKEN);
  } finally { await cleanupDir(h.dataDir); }
});

test('D-9 langgraph:无验证器/错凭据/伪造actor → 边界拒绝,零 checkpoint 写入,零外部调用', async () => {
  const calls = [];
  const h = await createHarness({
    transport: createScriptedTransport({ byRole: { credit: { ok: 'indeterminate' } }, calls }),
  });
  try {
    await h.lg.start({ runId: 'd9-l1', projectId: 'proj-1', eventType: 'new_application', evidenceRefs: EVIDENCE });
    const callsBeforeLg = calls.length;
    const ckptDir = `${h.dataDir}/lg-ckpt`;
    const { readdirSync } = await import('node:fs');
    const filesBefore = readdirSync(ckptDir, { recursive: true }).length;

    const { LocalFileFactStore, FactStorePort, ReceiptsPort, LocalFileReceipts, ToolsPort, LocalStubCalculation } = await import('../src/ports.mjs');
    const mkPorts = () => ({
      factStore: new FactStorePort(new LocalFileFactStore(h.dataDir)),
      receipts: new ReceiptsPort(new LocalFileReceipts(h.dataDir)),
      tools: new ToolsPort(new LocalStubCalculation()),
    });
    // 1) 无验证器
    const noVerifier = createLangGraphOrchestrator({
      ports: mkPorts(), adapter: createTestAdapter(createScriptedTransport({})),
      dataDir: `${h.dataDir}/lg2`, checkpointer: new FileCheckpointSaver(ckptDir), // 同目录才能读到 run
      principalVerifier: null,
    });
    await assert.rejects(() => noVerifier.resume('d9-l1', RESUME), (e) => e.code === 'PRINCIPAL_UNTRUSTED');
    // 2) 错凭据
    await assert.rejects(
      () => h.lg.resume('d9-l1', { ...RESUME, principalCredential: 'forged-token' }),
      (e) => e.code === 'PRINCIPAL_UNTRUSTED',
    );
    // 3) 伪造 actor 自声明
    await assert.rejects(
      () => h.lg.resume('d9-l1', { actor: { id: 'attacker', role: 'coordinator' }, action: 'retry_step', stepId: STEP, payload: {} }),
      (e) => e.code === 'PRINCIPAL_UNTRUSTED',
    );

    assert.equal(calls.length, callsBeforeLg, '拒绝的 resume 不得触发外部调用(start 本身的调用为基准)');
    const view = await h.lg.view('d9-l1');
    assert.equal(view.steps[0].attempt, 0);
    const filesAfter = readdirSync(ckptDir, { recursive: true }).length;
    assert.equal(filesAfter, filesBefore, '拒绝的 resume 不得产生任何 checkpoint 写入');
    await assertCredentialNotOnDisk([ckptDir], 'forged-token');
  } finally { await cleanupDir(h.dataDir); }
});

test('D-9 langgraph:错项目/错动作授权拒绝;合成可信正例恢复 + 凭据零落盘(含 checkpoint)', async () => {
  const byRole = { credit: { ok: 'indeterminate' } };
  const h = await createHarness({
    transport: createScriptedTransport({ byRole }),
    authorizer: createDenyAuthorizer({ projects: ['proj-forbidden'], actions: ['take_over'] }),
  });
  try {
    await h.lg.start({ runId: 'd9-l2', projectId: 'proj-1', eventType: 'new_application', evidenceRefs: EVIDENCE });
    // 错动作
    await assert.rejects(
      () => h.lg.resume('d9-l2', { ...RESUME, action: 'take_over' }),
      (e) => e.code === 'AUTHORIZATION_DENIED',
    );
    // 错项目(独立实例,策略拒绝 proj-1)
    const { LocalFileFactStore, FactStorePort, ReceiptsPort, LocalFileReceipts, ToolsPort, LocalStubCalculation } = await import('../src/ports.mjs');
    const projDenied = createLangGraphOrchestrator({
      ports: {
        factStore: new FactStorePort({ async currentVersions() { return { factVersion: '3', ruleVersion: '1' }; } }),
        receipts: new ReceiptsPort(new LocalFileReceipts(await makeTempDir('d9-rcpt-lg'))),
        tools: new ToolsPort(new LocalStubCalculation()),
      },
      adapter: createTestAdapter(createScriptedTransport({})),
      dataDir: `${h.dataDir}/lg3`,
      checkpointer: new FileCheckpointSaver(`${h.dataDir}/lg-ckpt`), // 同目录才能读到 run
      principalVerifier: createTestPrincipalVerifier(),
      authorizer: createDenyAuthorizer({ projects: ['proj-1'] }),
    });
    await assert.rejects(() => projDenied.resume('d9-l2', RESUME), (e) => e.code === 'AUTHORIZATION_DENIED');
    // 合成可信正例(人工核实后通道恢复)
    byRole.credit = {};
    const v = await h.lg.resume('d9-l2', RESUME);
    assert.equal(v.state, 'completed');
    const credit = v.steps.find((s) => s.role === 'credit');
    assert.equal(credit.attempt, 1);
    assert.ok(credit.requestId.endsWith('::a1'));
    assert.equal(v.humanActions[0].principal.role, 'human');
    // 凭据零落盘:journal(thin 无)、checkpoint 目录(LangGraph 全部落盘文件)
    await assertCredentialNotOnDisk([`${h.dataDir}/lg-ckpt`, `${h.dataDir}/lg`], TEST_PRINCIPAL_TOKEN);
  } finally { await cleanupDir(h.dataDir); }
});
