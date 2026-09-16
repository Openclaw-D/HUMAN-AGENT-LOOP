// V7-B 候选2(LangGraph)恢复语义测试:与 thin 同一场景矩阵 + FileCheckpointSaver 真实落盘。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createScriptedTransport, createHarness, cleanupDir, EVIDENCE, C_INPUTS_OK,
  calculateCashFlowCoverage, createCToolsAdapter, TEST_PRINCIPAL_TOKEN, createTestPrincipalVerifier,
} from './helpers.mjs';

test('langgraph: 单角色成功路径 → completed + checkpoint 文件真实落盘', async () => {
  const h = await createHarness({ transport: createScriptedTransport({}) });
  try {
    const v = await h.lg.start({ runId: 'run-l1', projectId: 'proj-1', eventType: 'new_application', evidenceRefs: EVIDENCE });
    assert.equal(v.state, 'completed');
    assert.equal(v.steps[0].state, 'succeeded');
    assert.equal(v.candidate.authority, 'none');
    // checkpoint 真实落盘验证
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(`${h.dataDir}/lg-ckpt`);
    const threadDir = files.find((f) => encodeURIComponent('run-l1') === f);
    assert.ok(threadDir, '必须有 thread 目录');
    const ckpts = await readdir(`${h.dataDir}/lg-ckpt/${threadDir}`);
    assert.ok(ckpts.some((f) => f.startsWith('ckpt_')), '必须有 checkpoint 文件');
  } finally { await cleanupDir(h.dataDir); }
});

test('langgraph: 双角色并发(evidence_updated)', async () => {
  const h = await createHarness({ transport: createScriptedTransport({}) });
  try {
    const v = await h.lg.start({ runId: 'run-l2', projectId: 'proj-1', eventType: 'evidence_updated', evidenceRefs: EVIDENCE });
    assert.equal(v.state, 'completed');
    assert.deepEqual([...v.steps.map((s) => s.state)].sort(), ['succeeded', 'succeeded']);
  } finally { await cleanupDir(h.dataDir); }
});

test('langgraph: 正式前序不得越过——政策失败时资产步阻塞且未调用', async () => {
  const calls = [];
  const h = await createHarness({
    transport: createScriptedTransport({ byRole: { policy: { throw: true } }, calls }),
  });
  try {
    const v = await h.lg.start({ runId: 'run-l3', projectId: 'proj-1', eventType: 'asset_review', evidenceRefs: EVIDENCE });
    assert.equal(v.state, 'failed');
    const asset = v.steps.find((s) => s.role === 'asset');
    assert.equal(asset.state, 'blocked');
    assert.ok(!calls.some((c) => c.role === 'asset'), 'asset 步不得越过正式前序');
  } finally { await cleanupDir(h.dataDir); }
});

test('langgraph: provider 未配置 → human_required 且未发送', async () => {
  const h = await createHarness({ transport: createScriptedTransport({}) });
  try {
    const { createModelAdapter } = await import('../../../../V6/handoff/PARALLEL_MODEL_ADAPTER_20260913/src/adapter.mjs');
    const { LocalFileFactStore, FactStorePort, ReceiptsPort, LocalFileReceipts, ToolsPort, LocalStubCalculation } = await import('../src/ports.mjs');
    const { createLangGraphOrchestrator } = await import('../src/langgraph/orchestrator.mjs');
    const { FileCheckpointSaver } = await import('../src/langgraph/file-checkpointer.mjs');
    const lg = createLangGraphOrchestrator({
      ports: { factStore: new FactStorePort(new LocalFileFactStore(h.dataDir)), receipts: new ReceiptsPort(new LocalFileReceipts(h.dataDir)), tools: new ToolsPort(new LocalStubCalculation()) },
      adapter: createModelAdapter({}),
      dataDir: `${h.dataDir}/lg-nc`,
      checkpointer: new FileCheckpointSaver(`${h.dataDir}/lg-nc-ckpt`),
    });
    const v = await lg.start({ runId: 'run-l4', projectId: 'proj-1', eventType: 'new_application', evidenceRefs: EVIDENCE });
    assert.equal(v.state, 'human_required');
    assert.equal(v.steps[0].state, 'not_configured');
    assert.equal(v.steps[0].sentFlag, false);
  } finally { await cleanupDir(h.dataDir); }
});

test('langgraph: 发送后未知 → unknown;人工核实后显式重试成功', async () => {
  const byRole = { credit: { ok: 'indeterminate' } };
  const h = await createHarness({ transport: createScriptedTransport({ byRole }) });
  try {
    const v1 = await h.lg.start({ runId: 'run-l5', projectId: 'proj-1', eventType: 'new_application', evidenceRefs: EVIDENCE });
    assert.equal(v1.state, 'unknown');
    assert.equal(v1.steps[0].sentFlag, null);
    // D-9 负例:无凭据在边界即拒绝(不进图,不产生 checkpoint 写入)
    await assert.rejects(
      () => h.lg.resume('run-l5', { action: 'retry_step', stepId: 'model:credit:risk_review', payload: {} }),
      (e) => e.code === 'PRINCIPAL_UNTRUSTED',
    );
    let view = await h.lg.view('run-l5');
    assert.equal(view.state, 'unknown'); // 仍在人工门,未被推进
    const { LocalFileFactStore } = await import('../src/ports.mjs');
    await h.factStore.setVersions('proj-1', '9', '1'); // 事实漂移
    await h.lg.resume('run-l5', { principalCredential: TEST_PRINCIPAL_TOKEN, action: 'retry_step', stepId: 'model:credit:risk_review', payload: {} });
    // 版本漂移后 retry 被正确拒绝(必须先 provide_evidence 重锚) → 再 interrupt
    view = await h.lg.view('run-l5');
    assert.match(view.pauseNotice ?? '', /事实版本|VERSION_CHANGED/);
    // 人工先重锚(provide_evidence + ack 新版本),版本对齐后 retry 才被接受
    const vAnchor = await h.lg.resume('run-l5', { principalCredential: TEST_PRINCIPAL_TOKEN, action: 'provide_evidence', payload: { newEvidenceRefs: EVIDENCE, newFactVersion: '9' } });
    assert.equal(vAnchor.requiredVersions.factVersion, '9');
    // 人工核实外部结果后通道恢复 → 显式重试 → 新 attempt 成功
    byRole.credit = {};
    const v2 = await h.lg.resume('run-l5', { principalCredential: TEST_PRINCIPAL_TOKEN, action: 'retry_step', stepId: 'model:credit:risk_review', payload: {} });
    assert.equal(v2.state, 'completed');
    const credit = v2.steps.find((s) => s.role === 'credit');
    assert.equal(credit.attempt, 1);
    assert.ok(credit.requestId.endsWith('::a1'));
  } finally { await cleanupDir(h.dataDir); }
});

test('langgraph: 模型仅提问 → waiting_evidence(interrupt 落盘);重启新实例后 provide_evidence 继续', async () => {
  const byRole = { credit: { noFindings: true, questions: ['请补充流水'] } };
  const h = await createHarness({ transport: createScriptedTransport({ byRole }) });
  try {
    const v1 = await h.lg.start({ runId: 'run-l6', projectId: 'proj-1', eventType: 'new_application', evidenceRefs: EVIDENCE });
    assert.equal(v1.state, 'waiting_evidence');
    // 进程重启模拟:全新实例挂同一 checkpointer 目录,直接 resume
    byRole.credit = {};
    const { createTestAdapter } = await import('./helpers.mjs');
    const { LocalFileFactStore, FactStorePort, ReceiptsPort, LocalFileReceipts, ToolsPort, LocalStubCalculation } = await import('../src/ports.mjs');
    const { createLangGraphOrchestrator } = await import('../src/langgraph/orchestrator.mjs');
    const { FileCheckpointSaver } = await import('../src/langgraph/file-checkpointer.mjs');
    const lg2 = createLangGraphOrchestrator({
      ports: { factStore: new FactStorePort(new LocalFileFactStore(h.dataDir)), receipts: new ReceiptsPort(new LocalFileReceipts(h.dataDir)), tools: new ToolsPort(new LocalStubCalculation()) },
      adapter: createTestAdapter(createScriptedTransport({ byRole })),
      dataDir: `${h.dataDir}/lg2`,
      checkpointer: new FileCheckpointSaver(`${h.dataDir}/lg-ckpt`), // 同一落盘目录
      principalVerifier: createTestPrincipalVerifier(),
    });
    const v2 = await lg2.resume('run-l6', { principalCredential: TEST_PRINCIPAL_TOKEN, action: 'provide_evidence', payload: { newEvidenceRefs: EVIDENCE, newFactVersion: '3' } });
    assert.equal(v2.state, 'completed');
    assert.equal(v2.generation, 2);
  } finally { await cleanupDir(h.dataDir); }
});

test('langgraph: resume 校验失败 → 再 interrupt(pauseNotice),随后合法 resume 完成', async () => {
  const byRole = { credit: { ok: 'indeterminate' } };
  const h = await createHarness({ transport: createScriptedTransport({ byRole }) });
  try {
    await h.lg.start({ runId: 'run-l7', projectId: 'proj-1', eventType: 'new_application', evidenceRefs: EVIDENCE });
    // D-9 负例:错误凭据在边界即拒绝(不进图、不产生 checkpoint 写入)
    await assert.rejects(
      () => h.lg.resume('run-l7', { principalCredential: 'wrong-token', action: 'retry_step', stepId: 'model:credit:risk_review', payload: {} }),
      (e) => e.code === 'PRINCIPAL_UNTRUSTED',
    );
    const view = await h.lg.view('run-l7');
    assert.equal(view.state, 'unknown'); // 仍在人工门,未被错误凭据推进
    // 人工核实后通道恢复 → 合法重试 → 完成
    byRole.credit = {};
    const v2 = await h.lg.resume('run-l7', { principalCredential: TEST_PRINCIPAL_TOKEN, action: 'retry_step', stepId: 'model:credit:risk_review', payload: {} });
    assert.equal(v2.state, 'completed');
  } finally { await cleanupDir(h.dataDir); }
});

test('langgraph: C 工具集成——缺输入 waiting_evidence;齐全则 succeeded + inputHash 可重放', async () => {
  const tools = createCToolsAdapter({ calculationTool: { calculateCashFlowCoverage } });
  const h = await createHarness({ transport: createScriptedTransport({}), tools });
  try {
    const v1 = await h.lg.start({
      runId: 'run-l8', projectId: 'proj-1', eventType: 'ratio_query',
      evidenceRefs: EVIDENCE, toolInputs: { monthlyOperatingCashFlow: C_INPUTS_OK.monthlyOperatingCashFlow },
    });
    assert.equal(v1.state, 'waiting_evidence');
    const toolStep = v1.steps.find((s) => s.kind === 'tool');
    assert.equal(toolStep.state, 'waiting_evidence');
    assert.equal(toolStep.error.code, 'MISSING_INPUT');

    const v2 = await h.lg.start({
      runId: 'run-l9', projectId: 'proj-1', eventType: 'ratio_query',
      evidenceRefs: EVIDENCE, toolInputs: C_INPUTS_OK,
    });
    assert.equal(v2.state, 'completed');
    const ok = v2.steps.find((s) => s.kind === 'tool');
    assert.equal(ok.state, 'succeeded');
    assert.equal(ok.toolVersion, 'calc:cash-flow-coverage@1');
    assert.match(ok.inputHash, /^[0-9a-f]{64}$/);
  } finally { await cleanupDir(h.dataDir); }
});

test('langgraph: 重复 start 同输入幂等(状态保持);view 读盘一致', async () => {
  const h = await createHarness({ transport: createScriptedTransport({}) });
  try {
    const v1 = await h.lg.start({ runId: 'run-l10', projectId: 'proj-1', eventType: 'new_application', evidenceRefs: EVIDENCE });
    assert.equal(v1.state, 'completed');
    const v2 = await h.lg.start({ runId: 'run-l10', projectId: 'proj-1', eventType: 'new_application', evidenceRefs: EVIDENCE });
    assert.equal(v2.state, 'completed'); // intake 幂等:不重建不重跑
    const v3 = await h.lg.view('run-l10');
    assert.equal(v3.state, 'completed');
  } finally { await cleanupDir(h.dataDir); }
});

test('langgraph: 崩溃重启续跑(无 pending interrupt)→ intent 无回执判 unknown', async () => {
  const byRole = { credit: { hang: true } };
  const h = await createHarness({ transport: createScriptedTransport({ byRole }) });
  try {
    h.lg.start({ runId: 'run-l11', projectId: 'proj-1', eventType: 'new_application', evidenceRefs: EVIDENCE }).catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
    // 全新实例(模拟新进程)+ 同 checkpointer:系统续跑
    const { createTestAdapter } = await import('./helpers.mjs');
    const { LocalFileFactStore, FactStorePort, ReceiptsPort, LocalFileReceipts, ToolsPort, LocalStubCalculation } = await import('../src/ports.mjs');
    const { createLangGraphOrchestrator } = await import('../src/langgraph/orchestrator.mjs');
    const { FileCheckpointSaver } = await import('../src/langgraph/file-checkpointer.mjs');
    const lg2 = createLangGraphOrchestrator({
      ports: { factStore: new FactStorePort(new LocalFileFactStore(h.dataDir)), receipts: new ReceiptsPort(new LocalFileReceipts(h.dataDir)), tools: new ToolsPort(new LocalStubCalculation()) },
      adapter: createTestAdapter(createScriptedTransport({ byRole: { credit: { hang: true } } })), // 仍挂:证明不自动重发
      dataDir: `${h.dataDir}/lg2`,
      checkpointer: new FileCheckpointSaver(`${h.dataDir}/lg-ckpt`),
    });
    const cont = await lg2.continueRun('run-l11');
    // 重跑节点 → 回执端口发现 intent 无 receipt → unknown → 人工门,不重发
    assert.equal(cont.state, 'unknown');
    assert.equal(cont.steps[0].state, 'unknown');
  } finally { await cleanupDir(h.dataDir); }
});
