#!/usr/bin/env node
// V7 A · assembly 第二版：B thin 编排器真实接入（CONTRACT v0.1 §6）。
// 组合面：A 事实源/回执/人工动作（HTTP）× B createThinOrchestrator（journal checkpoint +
// sinks 同步）× B createAClient/createARunSink（B 侧对账材料）× C 规则包/计算工具（c-tools 端口）。
// 原则：路径引用 B/C 原件不复制不修改；来源 hash 见 MANIFEST.md。
// D-8 修复：幂等验证读命令回执（GET /receipts/:requestId），不读 opinion 记录字段；
// finally 关闭本脚本自起的服务器并清理自有临时目录（不触碰任何未知进程）。
//
// 运行：node assembly/b-round.mjs   （自起 A 临时端口 + 隔离数据目录）

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startServer } from '../src/server.mjs';
import { createAClient, createARunSink } from '../../B/src/a-sync.mjs';
import { createThinOrchestrator } from '../../B/src/thin/orchestrator.mjs';
import { createLocalPorts } from '../../B/src/ports.mjs';
import { createCToolsAdapter } from '../../B/src/c-tools.mjs';
import { loadRulePack, validateRulePack } from '../../C/src/rule-pack.mjs';
import { calculateCashFlowCoverage } from '../../C/src/calculation-tool.mjs';

const aDataDir = mkdtempSync(join(tmpdir(), 'v7-asm-a-'));
const bDataDir = mkdtempSync(join(tmpdir(), 'v7-asm-b-')); // B journal/receipts（编排权威，独立于 A 事实源）
let failures = 0;
let server = null;
let port = null;
function expect(name, cond, detail = '') {
  console.log(`${cond ? '  ok' : '  FAIL'}: ${name}${cond ? '' : ` ${detail}`}`);
  if (!cond) failures += 1;
}

try {
  // D-6（CONTRACT v0.1）：assembly 注入合成 token 允许列表（测试适配；非账户体系）。
  ({ server, port } = await startServer({ port: 0, dataDir: aDataDir, principalTokens: ['b-round-human-token'] }));
  const a = createAClient({ baseUrl: `http://127.0.0.1:${port}` });
  const tag = `brd-${Date.now().toString(36)}`;

  // 1) 种子：C 规则包 → A RuleVersion；项目 + 两条带口径证据。
  const pack = loadRulePack();
  const packCheck = validateRulePack(pack);
  const packOk = packCheck === undefined || packCheck === true || (Array.isArray(packCheck) && packCheck.length === 0);
  expect('C 规则包校验通过', packOk);
  const asStrings = (list) => list.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
  const rule = (await a.publishRule({
    requestId: `${tag}-rule`, indicators: asStrings(pack.scope.indicators),
    allowedTools: asStrings(pack.scope.allowedTools), humanEscalation: asStrings(pack.humanEscalation),
    notes: `assembly/B-round 发布：C ${pack.rulePackId}@${pack.version}`,
  })).ruleVersion;

  const project = (await a.createProject({ requestId: `${tag}-p`, name: 'B 接入组合项目' })).project;
  const evCash = (await a.attachEvidence(project.projectId, {
    requestId: `${tag}-ev1`, expectedVersion: 1, kind: '财务摘录',
    content: { text: '月度经营现金流 120,000 元/月（合成）', caliber: '企业月度平均（未经审计）' },
  })).evidence;
  const evDebt = (await a.attachEvidence(project.projectId, {
    requestId: `${tag}-ev2`, expectedVersion: 2, kind: '还款计划',
    content: { text: '月度债务偿付 100,000 元/月（合成）', caliber: '合同月供（含息）' },
  })).evidence;
  console.log(`[seed] 项目 ${project.projectId}，证据 ${evCash.evidenceId}/${evDebt.evidenceId}，规则 v${rule.version}`);

  // 2) A 运行先行创建（B sink 需要 aRunId；合同：编排 checkpoint 不替代事实源）。
  const aRun = (await a.createRun(project.projectId, {
    requestId: `${tag}-run`, expectedVersion: 3, ruleVersion: rule.version,
    inputEvidence: [{ evidenceId: evCash.evidenceId, version: 1 }, { evidenceId: evDebt.evidenceId, version: 1 }],
  })).run;
  console.log(`[run] A run ${aRun.runId}（factVersion=${aRun.factVersion}，v${aRun.version}）`);

  // 3) B 端口：事实源读数实时来自 A（单一真相）；工具端口接 C 真实计算。
  const factStore = {
    async currentVersions(projectId) {
      const view = await a.getProject(projectId);
      return { factVersion: String(view.projectFactVersion), ruleVersion: String(rule.version) };
    },
  };
  const ports = createLocalPorts({
    dataDir: bDataDir,
    factStore,
    tools: createCToolsAdapter({ calculationTool: { calculateCashFlowCoverage } }),
  });

  // 模拟 adapter（V6 契约七状态；真实通道由 B real-http 承担，凭据未授权——诚实 simulated）。
  const adapter = {
    async analyze(request) {
      return {
        status: 'simulated',
        findings: [
          { text: `（模拟）${request.purpose}：证据口径单一来源，需交叉验证`, role: request.role },
        ],
        questions: [{ text: '电费记录未提供，产能口径能否交叉验证？' }],
        evidenceRefs: (request.evidenceRefs ?? []).map((e) => ({ id: String(e.id), version: Number(e.version) })),
        costLedger: { reservationState: 'released' }, // 确定未发生外部调用
        deduped: false,
      };
    },
  };

  // 4) B sink（对账材料 createARunSink）+ thin 编排器；ratio_query = 模型步 → C 工具步（正式前序）。
  const sink = createARunSink({ aClient: a, aRunId: aRun.runId, logger: (m) => console.log(`  ${m}`) });
  const orchestrator = createThinOrchestrator({
    ports, adapter, dataDir: bDataDir, sinks: [sink],
    logger: (m) => console.log(`  ${m}`),
  });

  const toolInputs = {
    monthlyOperatingCashFlow: { value: 120000, caliber: '企业月度平均（未经审计）', source: { evidenceId: evCash.evidenceId, version: 1 } },
    monthlyDebtService: { value: 100000, caliber: '合同月供（含息）', source: { evidenceId: evDebt.evidenceId, version: 1 } },
    currency: 'CNY', periodMonths: 1,
  };
  const bRunId = `b-${tag}`;
  const bView = await orchestrator.start({
    runId: bRunId, projectId: project.projectId, eventType: 'ratio_query',
    evidenceRefs: [{ id: evCash.evidenceId, version: 1 }, { id: evDebt.evidenceId, version: 1 }],
    toolInputs,
  });
  expect('B 编排跑至 completed（模型 simulated + 工具 succeeded + 前序满足）', bView.terminal?.kind === 'completed', JSON.stringify(bView.terminal));

  // 5) A 事实源核对。D-8 修复：幂等验证读命令回执（GET /receipts/:requestId），不读 opinion 记录字段
  //（opinions[] 记录不含命令 requestId——CONTRACT v0.1 §2 明示）。
  // sink 确定性 requestId 规则 = `${orchRunId}::op:${stepId}:a${attempt}`。
  const modelStep = bView.steps.find((s) => s.kind === 'model');
  const expectedOpRequestId = `${bRunId}::op:${modelStep.id}:a${modelStep.attempt}`;
  const opReceipt = await a.getReceipt(expectedOpRequestId, 'runs');
  expect('意见命令回执可查（确定性 requestId）', opReceipt.found === true && opReceipt.receipt?.opinion?.authority === 'none', JSON.stringify(opReceipt)?.slice(0, 160));
  expect('回执 requestReceipt 关联 B 网关标识（两者非同一 ID 体系，ICR-3）', opReceipt.receipt?.opinion?.requestReceipt === modelStep.requestId);

  const aView = await a.getRun(aRun.runId);
  expect('模型候选意见经 sink 落库（provider=simulation, authority=none）', aView.run.opinions.length === 1 && aView.run.opinions[0]?.provider === 'simulation' && aView.run.opinions[0]?.authority === 'none', JSON.stringify(aView.run.opinions)?.slice(0, 200));
  expect('C 计算经 sink 落 A calculation（toolVersion 一致）', aView.run.calculation !== null && aView.run.calculation.toolVersion === 'calc:cash-flow-coverage@1', JSON.stringify(aView.run.calculation)?.slice(0, 120));
  expect('状态 candidate_ready（completed 终态不自动升级正式状态）', aView.run.state === 'candidate_ready');
  expect('基于证据失效引用在位（2 条）', aView.run.opinions[0].basedOnEvidence.length === 2);

  // 6) 重复编排启动（同输入）：B journal 去重 + A 意见不重复记账。
  const bView2 = await orchestrator.start({
    runId: bRunId, projectId: project.projectId, eventType: 'ratio_query',
    evidenceRefs: [{ id: evCash.evidenceId, version: 1 }, { id: evDebt.evidenceId, version: 1 }],
    toolInputs,
  });
  expect('B 重入去重（deduped）', bView2.deduped === true);
  const aView2 = await a.getRun(aRun.runId);
  expect('A 意见不重复（幂等 sink + B 去重）', aView2.run.opinions.length === 1 && aView2.run.calculation !== null);

  // 7) D-6 负例：无凭据自声明 human → 403 PRINCIPAL_UNTRUSTED；正例凭据 → resolved。
  let unauthRejected = false;
  try {
    await a.addHumanAction(aRun.runId, { requestId: `${tag}-ha-bad`, expectedVersion: aView2.run.version, action: 'accept_candidate', actorRole: 'human', actorName: '匿名伪造者' });
  } catch (e) {
    unauthRejected = e.code === 'PRINCIPAL_UNTRUSTED';
  }
  expect('无凭据正式动作失败关闭（403 PRINCIPAL_UNTRUSTED）', unauthRejected);

  const human = await a.addHumanAction(aRun.runId, {
    requestId: `${tag}-ha`, expectedVersion: aView2.run.version,
    action: 'accept_candidate', actorRole: 'human', actorName: '信审员（B 接入组合）',
    principalCredential: 'b-round-human-token',
    note: '候选意见与计算齐备，人工接受（正式动作）',
  });
  expect('人工接受 → resolved + formalOutcome（principalId 留痕）', human.runState === 'resolved' && human.formalOutcome.action === 'accept_candidate' && human.formalOutcome.principalId === 'token-principal-' + (await import('node:crypto')).createHash('sha256').update('b-round-human-token').digest('hex').slice(0, 8));

  console.log(failures === 0 ? `\nB-ROUND PASS（A data: ${aDataDir} | B journal: ${bDataDir}）` : `\nB-ROUND FAIL: ${failures}`);
} finally {
  // D-8：finally 关闭本脚本自起的服务器并清理自有临时目录；不触碰任何未知进程。
  if (server !== null) server.close();
  rmSync(aDataDir, { recursive: true, force: true });
  rmSync(bDataDir, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);
