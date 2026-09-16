// V7-B ⇄ A 活集成(合同 v0.1):起 A 服务(临时端口/隔离数据目录/合成 principal token 允许列表),
// B 编排 + C 工具 + sink 落库全链路。
// v0.1 断言:
//   - 正式人工动作必须携带 principalCredential(D-6:服务端 principalVerifier 同步验证;
//     未配置身份源=默认失败关闭 403 PRINCIPAL_UNTRUSTED,自声明 actorRole:"human" 不构成授权)
//   - 匿名/错误凭据负例 → 403 PRINCIPAL_UNTRUSTED,run 不进入 resolved
//   - 凭据隔离:token 不出现在 B journal/snapshot/回执等任何落盘文件
//   - 意见状态门(D-4):escalation 后意见落库 409 RUN_ESCALATED(B sink 语义=SINK_ERROR 不伪装成功)
// ⚠️ 合成测试 token 仅用于本机隔离测试适配(存 sha256 于 A 服务内存),非生产账户体系。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScriptedTransport, createTestAdapter, cleanupDir, EVIDENCE, C_INPUTS_OK, calculateCashFlowCoverage, createCToolsAdapter, makeTempDir } from './helpers.mjs';
import { createAClient, createARunSink } from '../src/a-sync.mjs';
import { createThinOrchestrator } from '../src/thin/orchestrator.mjs';
import { LocalFileFactStore, FactStorePort, ReceiptsPort, LocalFileReceipts, ToolsPort, LocalStubCalculation } from '../src/ports.mjs';

const TEST_PRINCIPAL_TOKEN = 'v7b-synthetic-test-principal-token'; // 合成测试凭据(非真实身份/密钥)

async function startA({ withPrincipal = true } = {}) {
  const { startServer } = await import('../../../../V7/backend/A/src/server.mjs');
  const dataDir = await makeTempDir('v7b-a-store');
  const { server, port } = await startServer({
    port: 0,
    dataDir,
    principalTokens: withPrincipal ? [TEST_PRINCIPAL_TOKEN] : [], // 未注入=默认失败关闭(负例基线)
  });
  return { server, port, dataDir, client: createAClient({ baseUrl: `http://127.0.0.1:${port}` }) };
}

async function assertTokenNotOnDisk(dirs, token) {
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
        if (text.includes(token)) hits.push(p);
      }
    }
  }
  for (const d of dirs) await walk(d);
  assert.deepEqual(hits, [], `principal token 不得落盘(B journal/snapshot/回执),命中:${hits.join(',')}`);
}

test('A 活集成 v0.1:编排落库 + 合法动作显式凭据 + 匿名/错凭据负例 + 凭据零落盘', async () => {
  const a = await startA();
  let bDirs = [];
  try {
    await a.client.health();
    // A 侧:建项目/证据/规则(projectId/evidenceId 由 A 生成)
    const proj = await a.client.createProject({ requestId: 'seed-p', name: '合成项目A' });
    const projectId = proj.project.projectId;
    for (const [i, note] of ['证据一(合成)', '证据二(合成)'].entries()) {
      await a.client.attachEvidence(projectId, { requestId: `seed-e${i}`, expectedVersion: i + 1, kind: 'synthetic', content: { note } });
    }
    const rule = await a.client.publishRule({ requestId: 'seed-r1', indicators: ['monthly_operating_cash_flow', 'monthly_debt_service', 'cash_flow_coverage'], allowedTools: ['calc:cash-flow-coverage@1'], humanEscalation: ['missing_input', 'call_unknown'], notes: '测试规则包' });

    // 从 A 读回真实证据清单(id/version/sha256)→ 构建 B 的证据引用三元组(D-5:引用须真实存在)
    const projView = await a.client.getProject(projectId);
    const liveRefs = projView.evidence.map((e) => ({ id: e.evidenceId, version: e.version, hash: e.sha256 ?? e.hash ?? 'na' }));
    assert.ok(liveRefs.length >= 2);
    const cInputs = {
      monthlyOperatingCashFlow: { ...C_INPUTS_OK.monthlyOperatingCashFlow, source: { evidenceId: liveRefs[0].id, version: liveRefs[0].version } },
      monthlyDebtService: { ...C_INPUTS_OK.monthlyDebtService, source: { evidenceId: liveRefs[1].id, version: liveRefs[1].version } },
      currency: 'CNY',
      periodMonths: 1,
    };

    const runResp = await a.client.createRun(projectId, {
      requestId: 'seed-run1', expectedVersion: 1, ruleVersion: rule.ruleVersion.version,
      inputEvidence: liveRefs.map((e) => ({ evidenceId: e.id, version: e.version })),
    });
    const aRunId = runResp.run.runId;

    // B 侧:事实端口指向 A(经 HTTP),工具用真 C,sink 落库
    const factStore = new FactStorePort({
      async currentVersions(pid) {
        const p = await a.client.getProject(pid);
        return { factVersion: String(p.projectFactVersion), ruleVersion: String(rule.ruleVersion.version) };
      },
    });
    const tools = createCToolsAdapter({ calculationTool: { calculateCashFlowCoverage } });
    const receiptsDir = await makeTempDir('v7b-b-rcpt');
    const thinDataDir = await makeTempDir('v7b-b-data');
    bDirs = [receiptsDir, thinDataDir];
    const sink = createARunSink({ aClient: a.client, aRunId });
    const thin = createThinOrchestrator({
      ports: { factStore, receipts: new ReceiptsPort(new LocalFileReceipts(receiptsDir)), tools },
      adapter: createTestAdapter(createScriptedTransport({})),
      dataDir: thinDataDir,
      sinks: [sink],
    });

    const v = await thin.start({
      runId: 'a-live-1', projectId, eventType: 'ratio_query',
      evidenceRefs: liveRefs, toolInputs: cInputs,
    });
    assert.equal(v.state, 'completed');

    // A 侧断言:1 意见(commerce) + 1 计算(工具);requestReceipt=B 网关请求标识
    const runNow = await a.client.getRun(aRunId);
    assert.equal(runNow.run.opinions.length, 1);
    assert.equal(runNow.run.opinions[0].provider, 'real_http');
    assert.match(runNow.run.opinions[0].requestReceipt, /^a-live-1::model:commerce:pricing_context::a0$/);
    assert.equal(runNow.run.opinions[0].authority, 'none');
    assert.equal(runNow.run.state, 'candidate_ready'); // completed 不改状态,正式决定留人工
    assert.ok(runNow.run.calculation);
    assert.equal(runNow.run.calculation.toolVersion, 'calc:cash-flow-coverage@1');

    // 幂等:同内容再同步一次 → A 原响应重放,不重复记账
    const before = (await a.client.getRun(aRunId)).run.version;
    await sink.onStepOutcome(v, v.steps.find((s) => s.kind === 'model'));
    assert.equal((await a.client.getRun(aRunId)).run.version, before, '重复同步不得新增意见');

    // D-6 负例1:匿名(无 principalCredential) → 403 PRINCIPAL_UNTRUSTED,run 不变 resolved
    await assert.rejects(
      () => a.client.addHumanAction(aRunId, {
        requestId: 'ha-anon', expectedVersion: before, action: 'accept_candidate',
        actorRole: 'human', actorName: '冒充者', note: '无凭据自声明',
      }),
      (e) => e.code === 'PRINCIPAL_UNTRUSTED' && e.status === 403,
    );
    // D-6 负例2:错误凭据 → 403 PRINCIPAL_UNTRUSTED
    await assert.rejects(
      () => sink.submitHumanAction({ runId: 'a-live-1' }, {
        action: 'accept_candidate', actorName: '信审岗-测试', note: '错凭据',
        principalCredential: 'wrong-token',
      }),
      (e) => e.code === 'PRINCIPAL_UNTRUSTED',
    );
    assert.notEqual((await a.client.getRun(aRunId)).run.state, 'resolved', '失败关闭:run 不得因无效凭据进入 resolved');

    // 合法动作:显式凭据(经 sink 幂等提交)→ resolved + formalOutcome 在响应顶层(D-3 投影)
    const ha = await sink.submitHumanAction({ runId: 'a-live-1' }, {
      action: 'accept_candidate', actorName: '信审岗-测试', note: '接受候选意见(合成)',
      principalCredential: TEST_PRINCIPAL_TOKEN,
    });
    assert.equal(ha.runState, 'resolved');
    assert.equal(ha.formalOutcome.action, 'accept_candidate');
    // sink 幂等重放:同 requestId 同载荷(含凭据)→ replayed,不抛 409
    const haReplay = await sink.submitHumanAction({ runId: 'a-live-1' }, {
      action: 'accept_candidate', actorName: '信审岗-测试', note: '接受候选意见(合成)',
      principalCredential: TEST_PRINCIPAL_TOKEN,
    });
    assert.equal(haReplay.runState, 'resolved');

    // D-6 正例细节:principalId 由服务端记录(A 记 token 指纹,非明文)
    const finalRun = await a.client.getRun(aRunId);
    assert.ok(finalRun.run.humanActions.some((h) => h.principalId && h.principalId.startsWith('token-principal-')), '服务端记录 principal 指纹');

    // 凭据零落盘:B 侧任何 journal/snapshot/回执文件不含 token 明文
    await assertTokenNotOnDisk(bDirs, TEST_PRINCIPAL_TOKEN);
  } finally {
    a.server.close();
    await cleanupDir(a.dataDir);
    for (const d of bDirs) await cleanupDir(d);
  }
});

test('A 活集成 v0.1:D-4 意见状态门(escalation 后闭门) + 未注入 verifier 默认失败关闭', async () => {
  const a = await startA();
  try {
    await a.client.health();
    const proj = await a.client.createProject({ requestId: 'u-p', name: '合成项目U' });
    const rule = await a.client.publishRule({ requestId: 'u-r1', indicators: ['x'], allowedTools: [], humanEscalation: [], notes: '' });
    const runResp = await a.client.createRun(proj.project.projectId, {
      requestId: 'u-run1', expectedVersion: 1, ruleVersion: rule.ruleVersion.version, inputEvidence: [],
    });
    const aRunId = runResp.run.runId;
    const sink = createARunSink({ aClient: a.client, aRunId });
    await sink.onTerminal({
      runId: 'a-live-2',
      terminal: { kind: 'unknown', reasonZh: '模型调用发送后未知(合成注入)' },
      evidenceRefs: [],
    });
    const runNow = await a.client.getRun(aRunId);
    assert.equal(runNow.run.state, 'unknown');
    const receipt = await a.client.getReceipt('a-live-2::esc:unknown', 'runs');
    assert.ok(receipt.ok === true || receipt.receipt, 'A 回执可查(合同 §4 receipts)');

    // D-4:escalation 期间意见落库被 409 RUN_ESCALATED 闭门(B sink 会记 SINK_ERROR,不伪装成功)
    await assert.rejects(
      () => a.client.addOpinion(aRunId, {
        requestId: 'late-opinion', expectedVersion: runNow.run.version, provider: 'simulation',
        requestReceipt: 'fake-receipt', candidate: { observations: ['迟到的意见'] },
        basedOnEvidence: [],
      }),
      (e) => e.code === 'RUN_ESCALATED' && e.status === 409,
    );

    // 正式动作在未注入 token 的实例上:即使带凭据也失败关闭(服务端无身份源)
    const aNoPrincipal = await startA({ withPrincipal: false });
    try {
      await aNoPrincipal.client.health();
      const p2 = await aNoPrincipal.client.createProject({ requestId: 'np-p', name: '无身份源项目' });
      const r2 = await aNoPrincipal.client.publishRule({ requestId: 'np-r1', indicators: [], allowedTools: [], humanEscalation: [], notes: '' });
      const run2 = await aNoPrincipal.client.createRun(p2.project.projectId, {
        requestId: 'np-run1', expectedVersion: 1, ruleVersion: r2.ruleVersion.version, inputEvidence: [],
      });
      await assert.rejects(
        () => aNoPrincipal.client.addHumanAction(run2.run.runId, {
          requestId: 'np-ha1', expectedVersion: 1, action: 'accept_candidate',
          actorRole: 'human', actorName: '测试', note: '带凭据但服务端无身份源',
          principalCredential: TEST_PRINCIPAL_TOKEN,
        }),
        (e) => e.code === 'PRINCIPAL_UNTRUSTED' && e.status === 403,
        '未注入验证器=默认失败关闭,合成凭据也不得通过',
      );
    } finally {
      aNoPrincipal.server.close();
      await cleanupDir(aNoPrincipal.dataDir);
    }
  } finally {
    a.server.close();
    await cleanupDir(a.dataDir);
  }
});
