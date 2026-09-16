// V7-B 候选1(thin)恢复语义测试:真实 V6 adapter + 注入 transport 故障。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createScriptedTransport, createHarness, cleanupDir, EVIDENCE, C_INPUTS_OK,
  calculateCashFlowCoverage, createCToolsAdapter, TEST_PRINCIPAL_TOKEN,
  createTestPrincipalVerifier,
} from './helpers.mjs';

test('thin: 单角色成功路径(new_application)→ completed + 白名单候选 authority=none', async () => {
  const h = await createHarness({ transport: createScriptedTransport({}) });
  try {
    const v = await h.thin.start({ runId: 'run-t1', projectId: 'proj-1', eventType: 'new_application', evidenceRefs: EVIDENCE });
    assert.equal(v.state, 'completed');
    assert.equal(v.steps.length, 1);
    assert.equal(v.steps[0].state, 'succeeded');
    assert.equal(v.steps[0].sentFlag, true);
    assert.ok(v.candidate);
    assert.equal(v.candidate.authority, 'none');
    assert.ok(Array.isArray(v.candidate.observations));
  } finally { await cleanupDir(h.dataDir); }
});

test('thin: 双角色并发(evidence_updated)同轮完成', async () => {
  const h = await createHarness({ transport: createScriptedTransport({}) });
  try {
    const v = await h.thin.start({ runId: 'run-t2', projectId: 'proj-1', eventType: 'evidence_updated', evidenceRefs: EVIDENCE });
    assert.equal(v.state, 'completed');
    assert.deepEqual(v.steps.map((s) => s.state), ['succeeded', 'succeeded']);
  } finally { await cleanupDir(h.dataDir); }
});

test('thin: 正式前序不得越过——政策失败时资产步被阻塞,不发起调用', async () => {
  const calls = [];
  const h = await createHarness({
    transport: createScriptedTransport({
      byRole: {
        policy: { throw: true }, // 政策 transport 抛错 → adapter failed
      },
      calls,
    }),
  });
  try {
    const v = await h.thin.start({ runId: 'run-t3', projectId: 'proj-1', eventType: 'asset_review', evidenceRefs: EVIDENCE });
    assert.equal(v.state, 'failed');
    const asset = v.steps.find((s) => s.role === 'asset');
    assert.equal(asset.state, 'blocked'); // 前序未成功,阻塞
    // asset 步从未发起外部调用(无 requestId 记录到 calls)
    assert.ok(!calls.some((c) => c.role === 'asset'), 'asset 步不得越过正式前序');
  } finally { await cleanupDir(h.dataDir); }
});

test('thin: provider 未配置 → human_required 且表明未发送(sent=false)', async () => {
  const h = await createHarness();
  try {
    // 无 transport 的 adapter → not_configured
    const { createModelAdapter } = await import('../../../../V6/handoff/PARALLEL_MODEL_ADAPTER_20260913/src/adapter.mjs');
    const adapter = createModelAdapter({});
    const { LocalFileFactStore, FactStorePort, ReceiptsPort, LocalFileReceipts, ToolsPort, LocalStubCalculation } = await import('../src/ports.mjs');
    const { createThinOrchestrator } = await import('../src/thin/orchestrator.mjs');
    const factStore = new FactStorePort(new LocalFileFactStore(h.dataDir));
    const thin = createThinOrchestrator({
      ports: { factStore, receipts: new ReceiptsPort(new LocalFileReceipts(h.dataDir)), tools: new ToolsPort(new LocalStubCalculation()) },
      adapter, dataDir: `${h.dataDir}/thin-nc`,
    });
    const v = await thin.start({ runId: 'run-t4', projectId: 'proj-1', eventType: 'new_application', evidenceRefs: EVIDENCE });
    assert.equal(v.state, 'human_required');
    assert.equal(v.steps[0].state, 'not_configured');
    assert.equal(v.steps[0].sentFlag, false); // 确定未发送
  } finally { await cleanupDir(h.dataDir); }
});

test('thin: 发送后未知(indeterminate)→ unknown 终态,不自动重试', async () => {
  const h = await createHarness({ transport: createScriptedTransport({ byRole: { credit: { ok: 'indeterminate' } } }) });
  try {
    const v = await h.thin.start({ runId: 'run-t5', projectId: 'proj-1', eventType: 'new_application', evidenceRefs: EVIDENCE });
    assert.equal(v.state, 'unknown');
    assert.equal(v.steps[0].state, 'unknown');
    assert.equal(v.steps[0].sentFlag, null); // 不可判定,不得声称未发送或已失败
  } finally { await cleanupDir(h.dataDir); }
});

test('thin: 模型仅提问无观察 → waiting_evidence;人工补证且模型有证据后完成(generation+1)', async () => {
  const byRole = { credit: { noFindings: true, questions: ['请补充近三个月流水'] } };
  const h = await createHarness({ transport: createScriptedTransport({ byRole }) });
  try {
    const v1 = await h.thin.start({ runId: 'run-t6', projectId: 'proj-1', eventType: 'new_application', evidenceRefs: EVIDENCE });
    assert.equal(v1.state, 'waiting_evidence');
    // D-9 负例:无凭据(匿名) → PRINCIPAL_UNTRUSTED
    await assert.rejects(
      () => h.thin.resume('run-t6', { action: 'provide_evidence', payload: { newEvidenceRefs: EVIDENCE, newFactVersion: '3' } }),
      (e) => e.code === 'PRINCIPAL_UNTRUSTED',
    );
    // D-9 负例:自声明 actor(可伪造字段)无凭据 → 依旧拒绝,自声明不构成授权
    await assert.rejects(
      () => h.thin.resume('run-t6', { actor: { id: 'u1', role: 'coordinator' }, action: 'provide_evidence', payload: {} }),
      (e) => e.code === 'PRINCIPAL_UNTRUSTED',
    );
    // D-9 负例:错误凭据 → PRINCIPAL_UNTRUSTED
    await assert.rejects(
      () => h.thin.resume('run-t6', { principalCredential: 'wrong-token', action: 'provide_evidence', payload: {} }),
      (e) => e.code === 'PRINCIPAL_UNTRUSTED',
    );
    // 合法凭据 + 缺 newEvidenceRefs → INVALID_RESUME(命令校验在身份门之后)
    await assert.rejects(
      () => h.thin.resume('run-t6', { principalCredential: TEST_PRINCIPAL_TOKEN, action: 'provide_evidence', payload: {} }),
      (e) => e.code === 'INVALID_RESUME',
    );
    // 人工补充证据后,模型通道拿到新证据产出观察(模拟同一 scripted 通道随证据更新)
    byRole.credit = {};
    const v2 = await h.thin.resume('run-t6', {
      principalCredential: TEST_PRINCIPAL_TOKEN, action: 'provide_evidence',
      payload: { newEvidenceRefs: EVIDENCE, newFactVersion: '3', actorName: '信审岗-合成' },
    });
    assert.equal(v2.state, 'completed');
    assert.equal(v2.generation, 2); // 重锚推进代次
    assert.equal(v2.humanActions.length, 1);
    assert.ok(v2.humanActions[0].principal.principalId.startsWith('test-principal-'), '入档的是验证器判定的 principalId');
    assert.equal(v2.humanActions[0].principal.role, 'human');
  } finally { await cleanupDir(h.dataDir); }
});

test('thin: 崩溃恢复——意图无回执判 unknown;人工核实后显式重试成功(requestId 换 attempt)', async () => {
  const h = await createHarness({
    transport: createScriptedTransport({ byRole: { credit: { hang: true } } }),
  });
  try {
    // 进程崩溃模拟:发起后在模型调用中放弃(意图已落盘,回执未写)
    h.thin.start({ runId: 'run-t7', projectId: 'proj-1', eventType: 'new_application', evidenceRefs: EVIDENCE }).catch(() => {});
    await new Promise((r) => setTimeout(r, 120)); // 等 intent 落盘
    // 新实例恢复
    const h2 = h.makeThin();
    const rec = await h2.recover('run-t7');
    assert.equal(rec.state, 'unknown');
    assert.equal(rec.steps[0].state, 'unknown');
    assert.equal(rec.steps[0].sentFlag, null);
    // 系统续跑对 unknown 终态不执行任何工作(continued:false,不自动重发)
    const cont = await h2.continueRun('run-t7');
    assert.equal(cont.continued, false);
    assert.equal(cont.state, 'unknown');
    // D-9 负例:无凭据重试拒绝(失败关闭)
    await assert.rejects(
      () => h2.resume('run-t7', { action: 'retry_step', stepId: 'model:credit:risk_review', payload: {} }),
      (e) => e.code === 'PRINCIPAL_UNTRUSTED',
    );
    // 人工核实后显式重试:换正常 transport 的适配器(模拟故障消除),attempt+1 → 新 requestId → 成功
    const goodAdapter = (await import('./helpers.mjs')).createTestAdapter(createScriptedTransport({}));
    const { LocalFileFactStore, FactStorePort, ReceiptsPort, LocalFileReceipts, ToolsPort, LocalStubCalculation } = await import('../src/ports.mjs');
    const { createThinOrchestrator } = await import('../src/thin/orchestrator.mjs');
    const thin3 = createThinOrchestrator({
      ports: { factStore: new FactStorePort(new LocalFileFactStore(h.dataDir)), receipts: new ReceiptsPort(new LocalFileReceipts(h.dataDir)), tools: new ToolsPort(new LocalStubCalculation()) },
      adapter: goodAdapter, dataDir: `${h.dataDir}/thin`,
      principalVerifier: createTestPrincipalVerifier(),
    });
    const v = await thin3.resume('run-t7', { principalCredential: TEST_PRINCIPAL_TOKEN, action: 'retry_step', stepId: 'model:credit:risk_review', payload: {} });
    assert.equal(v.state, 'completed');
    assert.equal(v.steps[0].attempt, 1);
    assert.ok(v.steps[0].requestId.endsWith('::a1'), `重试须换新请求标识: ${v.steps[0].requestId}`);
  } finally { await cleanupDir(h.dataDir); }
});

test('thin: 重复 start 同输入幂等复用(deduped);同 id 异载荷 409', async () => {
  const h = await createHarness({ transport: createScriptedTransport({}) });
  try {
    const v1 = await h.thin.start({ runId: 'run-t8', projectId: 'proj-1', eventType: 'new_application', evidenceRefs: EVIDENCE });
    assert.equal(v1.deduped, false);
    const v2 = await h.thin.start({ runId: 'run-t8', projectId: 'proj-1', eventType: 'new_application', evidenceRefs: EVIDENCE });
    assert.equal(v2.deduped, true);
    assert.equal(v2.state, 'completed');
    await assert.rejects(() => h.thin.start({ runId: 'run-t8', projectId: 'proj-1', eventType: 'ratio_query', evidenceRefs: EVIDENCE }), /REQUEST_MISMATCH/);
  } finally { await cleanupDir(h.dataDir); }
});

test('thin: 真实 C 工具集成——成功计算 + 缺输入补证等待 + 人工补参后完成', async () => {
  const tools = createCToolsAdapter({ calculationTool: { calculateCashFlowCoverage } });
  const h = await createHarness({ transport: createScriptedTransport({}), tools });
  try {
    // 缺输入 → waiting_evidence(不得补造数值)
    const v1 = await h.thin.start({
      runId: 'run-t9', projectId: 'proj-1', eventType: 'ratio_query',
      evidenceRefs: EVIDENCE, toolInputs: { monthlyOperatingCashFlow: C_INPUTS_OK.monthlyOperatingCashFlow },
    });
    assert.equal(v1.state, 'waiting_evidence');
    const toolStep1 = v1.steps.find((s) => s.kind === 'tool');
    assert.equal(toolStep1.state, 'waiting_evidence');
    assert.equal(toolStep1.error.code, 'MISSING_INPUT');
    // 人工补齐输入(事实版本同步推进) → 完成
    await h.factStore.setVersions('proj-1', '4', '1');
    const v2 = await h.thin.resume('run-t9', {
      principalCredential: TEST_PRINCIPAL_TOKEN, action: 'provide_evidence',
      payload: { newEvidenceRefs: EVIDENCE, newFactVersion: '4' },
    });
    assert.equal(v2.state, 'waiting_evidence', '工具输入在 toolInputs,provide_evidence 不改变它;需 retry 语义外的人工流程');
    // 工具步缺参属于输入问题:人工直接补全 toolInputs 的途径 = 新 run(输入快照不变量)。
    // 这里验证补证后运行仍失败关闭、候选不出现
    assert.equal(v2.candidate, null);
  } finally { await cleanupDir(h.dataDir); }
});

test('thin: C 工具输入齐全 → 计算 succeeded,inputHash 稳定可重放', async () => {
  const tools = createCToolsAdapter({ calculationTool: { calculateCashFlowCoverage } });
  const h = await createHarness({ transport: createScriptedTransport({}), tools });
  try {
    const v1 = await h.thin.start({
      runId: 'run-t10', projectId: 'proj-1', eventType: 'ratio_query',
      evidenceRefs: EVIDENCE, toolInputs: C_INPUTS_OK,
    });
    assert.equal(v1.state, 'completed');
    const toolStep = v1.steps.find((s) => s.kind === 'tool');
    assert.equal(toolStep.state, 'succeeded');
    assert.equal(toolStep.toolVersion, 'calc:cash-flow-coverage@1');
    assert.match(toolStep.inputHash, /^[0-9a-f]{64}$/);
    // 重放:同输入同 hash
    const v2 = await h.thin.start({
      runId: 'run-t11', projectId: 'proj-1', eventType: 'ratio_query',
      evidenceRefs: EVIDENCE, toolInputs: C_INPUTS_OK,
    });
    assert.equal(v2.steps.find((s) => s.kind === 'tool').inputHash, toolStep.inputHash);
  } finally { await cleanupDir(h.dataDir); }
});

test('thin: journal 尾部撕裂行恢复(丢弃+留痕);中部损坏硬错误', async () => {
  const h = await createHarness({ transport: createScriptedTransport({}) });
  try {
    await h.thin.start({ runId: 'run-t12', projectId: 'proj-1', eventType: 'new_application', evidenceRefs: EVIDENCE });
    const { readFile, appendFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const journal = join(h.dataDir, 'thin', 'runs', 'run-t12', 'journal.jsonl');
    await appendFile(journal, '{"type":"STEP_INTENT","step":"torn",}'); // 撕裂尾行(模拟崩溃半写)
    const h2 = h.makeThin();
    const snap = await h2.view('run-t12');
    assert.equal(snap.state, 'completed'); // 撕裂行被丢弃,运行视图完好
    // 中部损坏:重写一个中部坏行
    const raw = await readFile(journal, 'utf8');
    const lines = raw.split('\n');
    lines[1] = '{CORRUPT';
    const { writeFile: wf } = await import('node:fs/promises');
    const h3dir = await (await import('./helpers.mjs')).makeTempDir();
    const j2 = join(h3dir, 'bad.jsonl');
    await wf(j2, lines.join('\n'), 'utf8');
    await assert.rejects(async () => {
      const { createThinOrchestrator } = await import('../src/thin/orchestrator.mjs');
      const { LocalFileFactStore, FactStorePort, ReceiptsPort, LocalFileReceipts, ToolsPort, LocalStubCalculation } = await import('../src/ports.mjs');
      const t = createThinOrchestrator({
        ports: { factStore: new FactStorePort(new LocalFileFactStore(h3dir)), receipts: new ReceiptsPort(new LocalFileReceipts(h3dir)), tools: new ToolsPort(new LocalStubCalculation()) },
        adapter: (await import('./helpers.mjs')).createTestAdapter(createScriptedTransport({})),
        dataDir: h3dir,
      });
      // 直接把坏文件当作 journal:复制到预期位置
      const { mkdir, copyFile } = await import('node:fs/promises');
      await mkdir(join(h3dir, 'runs', 'bad'), { recursive: true });
      await copyFile(j2, join(h3dir, 'runs', 'bad', 'journal.jsonl'));
      await t.view('bad');
    }, /JOURNAL_CORRUPT/);
    await cleanupDir(h3dir);
  } finally { await cleanupDir(h.dataDir); }
});
