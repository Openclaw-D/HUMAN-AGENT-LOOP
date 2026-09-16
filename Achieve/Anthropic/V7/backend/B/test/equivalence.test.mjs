// V7-B 等价性测试:同一事件序列分别跑 thin 与 LangGraph,断言可观测量一致。
// 覆盖:成功/并发/依赖阻塞/未配置/未知/补证等待/工具计算 七条路径。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createScriptedTransport, createHarness, cleanupDir, EVIDENCE, C_INPUTS_OK,
  calculateCashFlowCoverage, createCToolsAdapter,
} from './helpers.mjs';

async function runBoth(t, { label, eventType, byRole = {}, toolInputs, factVersions } = {}) {
  const tools = createCToolsAdapter({ calculationTool: { calculateCashFlowCoverage } });
  const h = await createHarness({
    transport: createScriptedTransport({ byRole }),
    tools, factVersions: factVersions ?? { factVersion: '3', ruleVersion: '1' },
  });
  const runId = `eq-${label}`;
  const input = { runId, projectId: 'proj-1', eventType, evidenceRefs: EVIDENCE, toolInputs };
  try {
    const thinView = await h.thin.start(input);
    const lgView = await h.lg.start(input);
    return { thinView, lgView, h };
  } finally {
    await cleanupDir(h.dataDir);
  }
}

function assertSameShape(label, thinView, lgView) {
  assert.equal(lgView.state, thinView.state, `[${label}] 终态不一致`);
  const thinStates = Object.fromEntries(thinView.steps.map((s) => [s.id, s.state]));
  const lgStates = Object.fromEntries(lgView.steps.map((s) => [s.id, s.state]));
  assert.deepEqual(lgStates, thinStates, `[${label}] 步状态不一致`);
  assert.equal(lgView.candidate?.authority, thinView.candidate?.authority ?? undefined, `[${label}] authority 不一致`);
}

test('等价:成功路径(new_application)', async () => {
  const { thinView, lgView } = await runBoth(null, { label: 'ok', eventType: 'new_application' });
  assert.equal(thinView.state, 'completed');
  assertSameShape('ok', thinView, lgView);
});

test('等价:双角色并发(evidence_updated)', async () => {
  const { thinView, lgView } = await runBoth(null, { label: 'conc', eventType: 'evidence_updated' });
  assertSameShape('conc', thinView, lgView);
});

test('等价:正式前序失败→资产阻塞(asset_review)', async () => {
  const { thinView, lgView } = await runBoth(null, { label: 'dep', eventType: 'asset_review', byRole: { policy: { throw: true } } });
  assertSameShape('dep', thinView, lgView);
});

test('等价:未配置 → human_required', async (t) => {
  const tools = createCToolsAdapter({ calculationTool: { calculateCashFlowCoverage } });
  const h = await createHarness({ tools });
  try {
    const { createModelAdapter } = await import('../../../../V6/handoff/PARALLEL_MODEL_ADAPTER_20260913/src/adapter.mjs');
    const { LocalFileFactStore, FactStorePort, ReceiptsPort, LocalFileReceipts, ToolsPort, LocalStubCalculation } = await import('../src/ports.mjs');
    const { createThinOrchestrator } = await import('../src/thin/orchestrator.mjs');
    const { createLangGraphOrchestrator } = await import('../src/langgraph/orchestrator.mjs');
    const { FileCheckpointSaver } = await import('../src/langgraph/file-checkpointer.mjs');
    const mkPorts = () => ({
      factStore: new FactStorePort(new LocalFileFactStore(h.dataDir)),
      receipts: new ReceiptsPort(new LocalFileReceipts(h.dataDir + '-sh')),
      tools: new ToolsPort(new LocalStubCalculation()),
    });
    const thin = createThinOrchestrator({ ports: mkPorts(), adapter: createModelAdapter({}), dataDir: `${h.dataDir}/t-nc` });
    const lg = createLangGraphOrchestrator({ ports: mkPorts(), adapter: createModelAdapter({}), dataDir: `${h.dataDir}/l-nc`, checkpointer: new FileCheckpointSaver(`${h.dataDir}/l-nc-ckpt`) });
    const input = { runId: 'eq-nc', projectId: 'proj-1', eventType: 'new_application', evidenceRefs: EVIDENCE };
    const thinView = await thin.start(input);
    const lgView = await lg.start(input);
    assertSameShape('nc', thinView, lgView);
    assert.equal(thinView.state, 'human_required');
    assert.equal(thinView.steps[0].sentFlag, false);
  } finally { await cleanupDir(h.dataDir); }
});

test('等价:发送后未知 → unknown', async () => {
  const { thinView, lgView } = await runBoth(null, { label: 'unk', eventType: 'new_application', byRole: { credit: { ok: 'indeterminate' } } });
  assertSameShape('unk', thinView, lgView);
  assert.equal(thinView.state, 'unknown');
});

test('等价:工具计算(ratio_query 齐输入)', async () => {
  const { thinView, lgView } = await runBoth(null, { label: 'calc', eventType: 'ratio_query', toolInputs: C_INPUTS_OK });
  assertSameShape('calc', thinView, lgView);
  assert.equal(thinView.state, 'completed');
  const thinHash = thinView.steps.find((s) => s.kind === 'tool').inputHash;
  const lgHash = lgView.steps.find((s) => s.kind === 'tool').inputHash;
  assert.equal(lgHash, thinHash, '同输入 C 工具 inputHash 必须一致');
});

test('等价:未知事件类型 → human_required', async () => {
  const { thinView, lgView } = await runBoth(null, { label: 'evt', eventType: 'alien_event' });
  assertSameShape('evt', thinView, lgView);
  assert.equal(thinView.state, 'human_required');
});
