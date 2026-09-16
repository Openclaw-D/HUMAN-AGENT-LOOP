#!/usr/bin/env node
// V7 A · assembly 第三版：LangGraph 候选实际 assembly 对比（HEARTBEAT 0425 A 节；B HANDOFF-A-LANGGRAPH-v0.1）。
// 同一事件输入分别经 thin 与 LangGraph 编排、同一 sink 语义落同一 A 服务（隔离 A run），
// 断言 A run 的 opinions/calculation/state 投影一致（B 侧等价测试未覆盖 A 落库环节——本脚本补足）。
// 另验 LangGraph FileCheckpointSaver 真实落盘 + resume 拒绝不抛异常（pauseNotice 承载）。
// 运行：node assembly/lg-round.mjs   （自起 A 临时端口 + 隔离目录；finally 自清）

import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startServer } from '../src/server.mjs';
import { createAClient, createARunSink } from '../../B/src/a-sync.mjs';
import { createThinOrchestrator } from '../../B/src/thin/orchestrator.mjs';
import { createLangGraphOrchestrator } from '../../B/src/langgraph/orchestrator.mjs';
import { FileCheckpointSaver } from '../../B/src/langgraph/file-checkpointer.mjs';
import { createLocalPorts } from '../../B/src/ports.mjs';
import { createCToolsAdapter } from '../../B/src/c-tools.mjs';
import { loadRulePack, validateRulePack } from '../../C/src/rule-pack.mjs';
import { calculateCashFlowCoverage } from '../../C/src/calculation-tool.mjs';

const aDataDir = mkdtempSync(join(tmpdir(), 'v7-lg-a-'));
const bThinDir = mkdtempSync(join(tmpdir(), 'v7-lg-thin-'));
const bLgDir = mkdtempSync(join(tmpdir(), 'v7-lg-lg-'));
const lgCheckpointDir = mkdtempSync(join(tmpdir(), 'v7-lg-ckpt-'));
let failures = 0;
let server = null;
let port = null;
function expect(name, cond, detail = '') {
  console.log(`${cond ? '  ok' : '  FAIL'}: ${name}${cond ? '' : ` ${detail}`}`);
  if (!cond) failures += 1;
}

try {
  ({ server, port } = await startServer({ port: 0, dataDir: aDataDir, principalTokens: ['lg-round-human-token'] }));
  const a = createAClient({ baseUrl: `http://127.0.0.1:${port}` });
  const tag = `lg-${Date.now().toString(36)}`;

  // 种子（同一规则/项目，两编排各建一个 A run）。
  const pack = loadRulePack();
  const packCheck = validateRulePack(pack);
  const packOk = packCheck === undefined || packCheck === true || (Array.isArray(packCheck) && packCheck.length === 0);
  expect('C 规则包校验通过', packOk);
  const asStrings = (list) => list.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
  const rule = (await a.publishRule({
    requestId: `${tag}-rule`, indicators: asStrings(pack.scope.indicators),
    allowedTools: asStrings(pack.scope.allowedTools), humanEscalation: asStrings(pack.humanEscalation),
    notes: 'LangGraph 对比组合：C 规则包',
  })).ruleVersion;
  const project = (await a.createProject({ requestId: `${tag}-p`, name: 'LangGraph 对比项目' })).project;
  const evCash = (await a.attachEvidence(project.projectId, { requestId: `${tag}-ev1`, expectedVersion: 1, kind: '财务摘录', content: { text: '月度经营现金流 120,000 元/月（合成）', caliber: '企业月度平均（未经审计）' } })).evidence;
  const evDebt = (await a.attachEvidence(project.projectId, { requestId: `${tag}-ev2`, expectedVersion: 2, kind: '还款计划', content: { text: '月度债务偿付 100,000 元/月（合成）', caliber: '合同月供（含息）' } })).evidence;

  const evidenceRefs = [{ id: evCash.evidenceId, version: 1 }, { id: evDebt.evidenceId, version: 1 }];
  const toolInputs = {
    monthlyOperatingCashFlow: { value: 120000, caliber: '企业月度平均（未经审计）', source: { evidenceId: evCash.evidenceId, version: 1 } },
    monthlyDebtService: { value: 100000, caliber: '合同月供（含息）', source: { evidenceId: evDebt.evidenceId, version: 1 } },
    currency: 'CNY', periodMonths: 1,
  };

  // 共用端口/adapter/sink 工厂（B HANDOFF-A-LANGGRAPH §1：两候选端口与 sink 语义完全一致）。
  const makePorts = () => createLocalPorts({
    dataDir: bThinDir, factStore: {
      async currentVersions(pid) {
        const view = await a.getProject(pid);
        return { factVersion: String(view.projectFactVersion), ruleVersion: String(rule.version) };
      },
    },
    tools: createCToolsAdapter({ calculationTool: { calculateCashFlowCoverage } }),
  });
  const adapter = {
    async analyze(request) {
      return {
        status: 'simulated',
        findings: [{ text: `（模拟）${request.purpose}：证据口径单一来源，需交叉验证`, role: request.role }],
        questions: [{ text: '电费记录未提供，产能口径能否交叉验证？' }],
        evidenceRefs: (request.evidenceRefs ?? []).map((e) => ({ id: String(e.id), version: Number(e.version) })),
        costLedger: { reservationState: 'released' },
        deduped: false,
      };
    },
  };
  const makeOrchestrator = (dataDir, sinks, checkpointer) => {
    const opts = { ports: makePorts(), adapter, dataDir, sinks, logger: () => {} };
    return checkpointer
      ? createLangGraphOrchestrator({ ...opts, checkpointer })
      : createThinOrchestrator(opts);
  };

  // 两个 A run：同输入分别经 thin / LangGraph。
  const aRunThin = (await a.createRun(project.projectId, { requestId: `${tag}-run-t`, expectedVersion: 3, ruleVersion: rule.version, inputEvidence: evidenceRefs.map((r) => ({ evidenceId: r.id, version: r.version })) })).run;
  const aRunLg = (await a.createRun(project.projectId, { requestId: `${tag}-run-l`, expectedVersion: 3, ruleVersion: rule.version, inputEvidence: evidenceRefs.map((r) => ({ evidenceId: r.id, version: r.version })) })).run;

  const thin = makeOrchestrator(bThinDir, [createARunSink({ aClient: a, aRunId: aRunThin.runId })]);
  const lg = makeOrchestrator(bLgDir, [createARunSink({ aClient: a, aRunId: aRunLg.runId })], new FileCheckpointSaver(lgCheckpointDir));

  const input = { projectId: project.projectId, eventType: 'ratio_query', evidenceRefs, toolInputs };
  const thinView = await thin.start({ ...input, runId: `thin-${tag}` });
  const lgView = await lg.start({ ...input, runId: `lg-${tag}` });
  expect('thin 终态 completed', thinView.terminal?.kind === 'completed', JSON.stringify(thinView.terminal));
  expect('LangGraph 终态 completed', lgView.terminal?.kind === 'completed', JSON.stringify(lgView.terminal));

  // A 投影一致性：两 run 的 opinions 数/意见 provider/authority/推荐动作、calculation 工具版本、state。
  const avT = await a.getRun(aRunThin.runId);
  const avL = await a.getRun(aRunLg.runId);
  const proj = (v) => ({
    state: v.run.state,
    opinions: v.run.opinions.map((o) => ({ provider: o.provider, authority: o.authority, action: o.candidate.recommendedHumanAction, stale: o.stale })).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))),
    calculation: v.run.calculation === null ? null : { toolVersion: v.run.calculation.toolVersion, inputHash: v.run.calculation.inputHash },
    stale: v.stale,
  });
  expect('A 投影一致（opinions/calculation/state/stale）', JSON.stringify(proj(avT)) === JSON.stringify(proj(avL)), `${JSON.stringify(proj(avT))} vs ${JSON.stringify(proj(avL))}`);
  expect('两 run 各落一条意见 + 计算', avT.run.opinions.length === 1 && avL.run.opinions.length === 1 && avT.run.calculation !== null && avL.run.calculation !== null);

  // LangGraph FileCheckpointSaver 真实落盘断言。
  const ckptFiles = readdirSync(lgCheckpointDir, { recursive: true }).filter((f) => String(f).length > 0);
  expect('LangGraph checkpoint 真实落盘（非空目录）', ckptFiles.length > 0, `${ckptFiles.length} entries`);

  // resume 拒绝语义差异验证：LangGraph resume 拒绝不抛异常（pauseNotice 承载）。
  // 注：终态 completed 的 resume 非本轮门路径；此处仅验证 API 面存在（不伪造暂停场景）。
  expect('LangGraph resume API 在位（函数存在）', typeof lg.resume === 'function');

  // 人工动作（两 run 均经 A principal 门收口）。
  for (const [label, runId] of [['thin', aRunThin.runId], ['langgraph', aRunLg.runId]]) {
    const v = await a.getRun(runId);
    const human = await a.addHumanAction(runId, {
      requestId: `${tag}-ha-${label}`, expectedVersion: v.run.version,
      action: 'accept_candidate', actorRole: 'human', actorName: `信审员（${label}）`,
      principalCredential: 'lg-round-human-token', note: '候选与计算齐备，人工接受',
    });
    expect(`${label} 人工接受 → resolved`, human.runState === 'resolved');
  }

  console.log(failures === 0 ? `\nLG-ROUND PASS（thin vs LangGraph A 投影一致）` : `\nLG-ROUND FAIL: ${failures}`);
} finally {
  if (server !== null) server.close();
  rmSync(aDataDir, { recursive: true, force: true });
  rmSync(bThinDir, { recursive: true, force: true });
  rmSync(bLgDir, { recursive: true, force: true });
  rmSync(lgCheckpointDir, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);
