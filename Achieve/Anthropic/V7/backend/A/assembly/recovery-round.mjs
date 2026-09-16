#!/usr/bin/env node
// V7 A · assembly 恢复链验证（HEARTBEAT 0725 A 节；B D-9 可信恢复接口）。
// thin 与 LangGraph 双候选各走完整恢复链，经同一 sink 语义落同一 A 服务（隔离 A run）：
//   真实暂停（模型步 unknown，发送后结果不可知）→ A 升级投影（unknown，不自动重发）
//   → 匿名/错凭据双门拒绝（B resume 门 + A principal 门，均无副作用）
//   → 可信 retry_step（新 requestId/新 attempt，不盲重发）→ B 内部 completed
//   → **A 保持 unknown：B 内部完成不冒充 A 正式人工审批**（D-4 意见门持续持住）
//   → A 正式人工动作（可信凭据）→ resolved。
// 运行：node assembly/recovery-round.mjs   （自起 A 临时端口 + 隔离目录；finally 自清）

import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startServer } from '../src/server.mjs';
import { createAClient, createARunSink } from '../../B/src/a-sync.mjs';
import { createThinOrchestrator } from '../../B/src/thin/orchestrator.mjs';
import { createLangGraphOrchestrator } from '../../B/src/langgraph/orchestrator.mjs';
import { FileCheckpointSaver } from '../../B/src/langgraph/file-checkpointer.mjs';
import { createLocalPorts } from '../../B/src/ports.mjs';
import { loadRulePack, validateRulePack } from '../../C/src/rule-pack.mjs';

const aDataDir = mkdtempSync(join(tmpdir(), 'v7-rec-a-'));
const thinDir = mkdtempSync(join(tmpdir(), 'v7-rec-thin-'));
const lgDir = mkdtempSync(join(tmpdir(), 'v7-rec-lg-'));
const lgCkptDir = mkdtempSync(join(tmpdir(), 'v7-rec-ckpt-'));
const CREDENTIAL = 'recovery-human-token'; // 合成测试凭据（非生产认证）
let failures = 0;
let server = null;
let port = null;
function expect(name, cond, detail = '') {
  console.log(`${cond ? '  ok' : '  FAIL'}: ${name}${cond ? '' : ` ${detail}`}`);
  if (!cond) failures += 1;
}

try {
  ({ server, port } = await startServer({ port: 0, dataDir: aDataDir, principalTokens: [CREDENTIAL] }));
  const a = createAClient({ baseUrl: `http://127.0.0.1:${port}` });
  const tag = `rec-${Date.now().toString(36)}`;

  // 种子：C 规则包 → A；项目 + 证据。
  const pack = loadRulePack();
  const packCheck = validateRulePack(pack);
  expect('C 规则包校验通过', packCheck === undefined || packCheck === true || (Array.isArray(packCheck) && packCheck.length === 0));
  const asStrings = (list) => list.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
  const rule = (await a.publishRule({
    requestId: `${tag}-rule`, indicators: asStrings(pack.scope.indicators),
    allowedTools: asStrings(pack.scope.allowedTools), humanEscalation: asStrings(pack.humanEscalation),
    notes: '恢复链组合：C 规则包',
  })).ruleVersion;
  const project = (await a.createProject({ requestId: `${tag}-p`, name: '恢复链组合项目' })).project;
  const ev = (await a.attachEvidence(project.projectId, { requestId: `${tag}-ev`, expectedVersion: 1, kind: '现场记录', content: { text: '首版证据（合成）', caliber: '企业自述' } })).evidence;

  // 有状态模拟 adapter：同 run 首次调用 → unknown（发送后结果不可知，不伪造失败/成功）；
  // 人工核实标记后 → simulated（authority=none）。调用计数暴露"unknown 不自动重发"。
  const callsByRun = new Map();
  const verifiedRuns = new Set();
  const adapter = {
    async analyze(request) {
      callsByRun.set(request.sessionId, (callsByRun.get(request.sessionId) ?? 0) + 1);
      if (!verifiedRuns.has(request.sessionId)) {
        return { status: 'unknown', costLedger: { reservationState: 'unknown_hold' }, deduped: false, error: { code: 'RESULT_UNKNOWN', messageZh: '发送后超时，结果不可知' } };
      }
      return {
        status: 'simulated',
        findings: [{ text: `（模拟）${request.purpose}：人工核实后重试成功`, role: request.role }],
        questions: [],
        evidenceRefs: (request.evidenceRefs ?? []).map((x) => (typeof x === 'string' ? x : `${x.id}@v${x.version}`)),
        costLedger: { reservationState: 'released' },
        deduped: false,
      };
    },
  };
  const makePorts = (dataDir) => createLocalPorts({
    dataDir, factStore: {
      async currentVersions(pid) {
        const view = await a.getProject(pid);
        return { factVersion: String(view.projectFactVersion), ruleVersion: String(rule.version) };
      },
    },
  });
  // D-9 合成 verifier/授权策略（assembly 注入；非生产认证）。
  const principalVerifier = (credential, ctx) => credential === CREDENTIAL
    ? { ok: true, role: 'human', principalId: `recovery-principal(${ctx?.action ?? '?'})` }
    : { ok: false };
  const authorizer = (verdict, ctx) => ({ ok: true }); // 合成策略：验证通过即授权（不发明生产岗位规则）

  async function runCandidate(kind, makeOrchestrator, dataDir, checkpointer) {
    console.log(`\n=== ${kind} 候选恢复链 ===`);
    const aRun = (await a.createRun(project.projectId, {
      requestId: `${tag}-run-${kind}`, expectedVersion: await (async () => (await a.getProject(project.projectId)).projectFactVersion)(),
      ruleVersion: rule.version, inputEvidence: [{ evidenceId: ev.evidenceId, version: 1 }],
    })).run;
    const bRunId = `${kind}-${tag}`;
    const sink = createARunSink({ aClient: a, aRunId: aRun.runId, logger: () => {} });
    const opts = { ports: makePorts(dataDir), adapter, dataDir, sinks: [sink], logger: () => {}, principalVerifier, authorizer };
    const orch = checkpointer ? createLangGraphOrchestrator({ ...opts, checkpointer }) : createThinOrchestrator(opts);

    // 1) 真实暂停：首调 unknown → 终态 unknown → sink 升级 A。
    const view = await orch.start({ runId: bRunId, projectId: project.projectId, eventType: 'new_application', evidenceRefs: [{ id: ev.evidenceId, version: 1 }] });
    expect(`${kind}: 真实暂停（终态 unknown）`, view.terminal?.kind === 'unknown', JSON.stringify(view.terminal));
    let av = await a.getRun(aRun.runId);
    expect(`${kind}: 暂停投影进 A（state=unknown）`, av.run.state === 'unknown', av.run.state);
    expect(`${kind}: unknown 不自动重发（adapter 仅 1 次调用）`, callsByRun.get(bRunId) === 1, callsByRun.get(bRunId));

    // 2) 负例（B 门）：错凭据 resume → PRINCIPAL_UNTRUSTED；无副作用。
    let bRejected = false;
    try {
      await orch.resume(bRunId, { principalCredential: 'wrong-token', action: 'retry_step', stepId: 'model:credit:risk_review' });
    } catch (e) {
      // 两候选身份门（包装层）同为 throw；LangGraph 的"不抛异常/pauseNotice"仅指节点内命令拒绝。
      bRejected = e.code === 'PRINCIPAL_UNTRUSTED';
    }
    expect(`${kind}: 错凭据 resume 被拒（身份门 throw PRINCIPAL_UNTRUSTED）`, bRejected);
    av = await a.getRun(aRun.runId);
    expect(`${kind}: B 门拒绝无 A 副作用`, av.run.version === 2 && av.run.state === 'unknown' && callsByRun.get(bRunId) === 1);

    // 3) 负例（A 门）：匿名正式动作 → 403 PRINCIPAL_UNTRUSTED，无副作用。
    let aRejected = false;
    try {
      await a.addHumanAction(aRun.runId, { requestId: `${tag}-ha-bad-${kind}`, expectedVersion: av.run.version, action: 'accept_candidate', actorRole: 'human', actorName: '匿名伪造者' });
    } catch (e) {
      aRejected = e.code === 'PRINCIPAL_UNTRUSTED';
    }
    expect(`${kind}: A 门匿名正式动作失败关闭（403 无副作用）`, aRejected && (await a.getRun(aRun.runId)).run.version === av.run.version);

    // 4) 可信恢复：retry_step（人工核实后显式重试；新 attempt=新 requestId，不盲重发）。
    verifiedRuns.add(bRunId);
    const resumeView = await orch.resume(bRunId, { principalCredential: CREDENTIAL, action: 'retry_step', stepId: 'model:credit:risk_review' });
    const terminalKind = resumeView.terminal?.kind ?? (await orch.view(bRunId))?.terminal?.kind ?? (await orch.view(bRunId))?.state;
    expect(`${kind}: 可信恢复后 B 内部 completed`, String(terminalKind).includes('completed') || resumeView.state === 'completed', JSON.stringify(resumeView.terminal ?? resumeView.state));
    expect(`${kind}: 重试产生第二次模型调用（显式重试非盲发）`, callsByRun.get(bRunId) === 2, callsByRun.get(bRunId));

    // 5) A 投影：B 内部完成**不冒充 A 正式人工审批**——A 保持 unknown；D-4 意见门持住（重试意见被 409 拒，未入库）。
    av = await a.getRun(aRun.runId);
    expect(`${kind}: A 保持 unknown（B completed 不改正式状态）`, av.run.state === 'unknown', av.run.state);
    expect(`${kind}: 升级态意见门持住（重试候选未入库）`, av.run.opinions.length === 0);

    // 6) A 正式人工动作（可信凭据）收口。
    const human = await a.addHumanAction(aRun.runId, {
      requestId: `${tag}-ha-${kind}`, expectedVersion: av.run.version,
      action: 'accept_candidate', actorRole: 'human', actorName: `信审员（${kind} 恢复链）`,
      principalCredential: CREDENTIAL, note: '人工核实 unknown 后接受（正式动作）',
    });
    expect(`${kind}: A 正式审批 → resolved + principalId 留痕`, human.runState === 'resolved' && String(human.formalOutcome.principalId ?? '').startsWith('token-principal-'));
    return { aRunId: aRun.runId };
  }

  await runCandidate('thin', null, thinDir, null);
  await runCandidate('langgraph', null, lgDir, new FileCheckpointSaver(lgCkptDir));

  // LangGraph 附加：凭据零落盘断言（checkpoint 目录全文件扫描不含凭据串）。
  let leak = false;
  for (const f of readdirSync(lgCkptDir, { recursive: true })) {
    const full = join(lgCkptDir, String(f));
    try {
      if (readFileSync(full, 'utf8').includes(CREDENTIAL)) { leak = true; break; }
    } catch { /* 二进制/目录跳过 */ }
  }
  expect('LangGraph: 凭据零落盘（checkpoint 全文扫描无凭据串）', !leak);

  console.log(failures === 0 ? '\nRECOVERY-ROUND PASS（thin + LangGraph 恢复链 × A 全部通过）' : `\nRECOVERY-ROUND FAIL: ${failures}`);
} finally {
  if (server !== null) server.close();
  rmSync(aDataDir, { recursive: true, force: true });
  rmSync(thinDir, { recursive: true, force: true });
  rmSync(lgDir, { recursive: true, force: true });
  rmSync(lgCkptDir, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);
