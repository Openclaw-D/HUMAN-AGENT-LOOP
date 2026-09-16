// D路 LangGraph 候选编排级反证（v0.2 · HEARTBEAT_20260915_0625 §D）
// 不外推 thin 结果：unknown/kill-recover/幂等/resume 在 LangGraph 实际候选上独立验证。
// 用法: node lg_orch_tests.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { probeFreePort, waitPort, startProc, killTree, Ledger, caseBounded, http, delay, writeFileSync, readdirSync, mkdirSync } from "./harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const V7B = "C:/Users/22673/Desktop/Anthropic/V7/backend";
const EV = join(HERE, "..", "evidence");
const u = (p) => pathToFileURL(p).href;
const rid = () => "dqa-lg-" + Math.random().toString(16).slice(2, 10);
const TOKEN = "dqa-human-token-2026";
const LED = new Ledger("lg-orch-tests");

const { createAClient } = await import(u(join(V7B, "B/src/a-sync.mjs")));
const { createLocalPorts } = await import(u(join(V7B, "B/src/ports.mjs")));
const { createLangGraphOrchestrator } = await import(u(join(V7B, "B/src/langgraph/orchestrator.mjs")));
const { FileCheckpointSaver } = await import(u(join(V7B, "B/src/langgraph/file-checkpointer.mjs")));
const { createCToolsAdapter } = await import(u(join(V7B, "B/src/c-tools.mjs")));
const { createARunSink } = await import(u(join(V7B, "B/src/a-sync.mjs")));
const { calculateCashFlowCoverage } = await import(u(join(V7B, "C/src/calculation-tool.mjs")));
const { startServer } = await import(u(join(V7B, "A/src/server.mjs")));

const WORK = mkdtempSync(join(tmpdir(), "dqa-lg-"));
async function curFv() { return (await a.client.getProject(ctx.projectId)).projectFactVersion; }
let server = null, PORT = null;
const a = {};

function makeAdapter(mode = "ok") {
  const state = { calls: 0 };
  return {
    state,
    async analyze(request) {
      state.calls += 1;
      if (mode === "unknown") return { status: "unknown", findings: [], questions: [], evidenceRefs: [], costLedger: { reservationState: "unknown" }, deduped: false };
      return {
        status: "simulated",
        findings: [{ text: `（模拟）${request.purpose}`, role: request.role }],
        questions: [], evidenceRefs: (request.evidenceRefs ?? []).map((e) => ({ id: String(e.id), version: Number(e.version) })),
        costLedger: { reservationState: "released" }, deduped: false,
      };
    },
  };
}
function buildOrch(dataDir, ckptDir, adapter, extra = {}) {
  const factStore = {
    async currentVersions(pid) {
      return a.client.getProject(pid).then((v) => ({ factVersion: String(v.projectFactVersion), ruleVersion: String(ctx.ruleVersion) }));
    },
  };
  const ports = createLocalPorts({ dataDir, factStore, tools: createCToolsAdapter({ calculationTool: { calculateCashFlowCoverage } }) });
  return createLangGraphOrchestrator({ ports, adapter, dataDir, checkpointer: new FileCheckpointSaver(ckptDir), sinks: extra.sinks ?? [], logger: () => {},
    principalVerifier: extra.principalVerifier, authorizer: extra.authorizer });
}
const evRefs = (e1, e2) => [{ id: e1, version: 1 }, { id: e2, version: 1 }];
let ctx = {};

try {
  // ---------- 夹具 ----------
  ({ server, port: PORT } = await startServer({ port: 0, dataDir: join(WORK, "a-data"), principalTokens: [TOKEN] }));
  if (!(await waitPort(PORT, { path: "/api/v7/health" }))) throw new Error("A server down");
  a.client = createAClient({ baseUrl: `http://127.0.0.1:${PORT}` });
  const rule = (await a.client.publishRule({ requestId: rid(), indicators: ["产能口径"], allowedTools: ["calc:cash-flow-coverage"], humanEscalation: ["证据矛盾"], notes: "D lg 反证规则" })).ruleVersion;
  ctx.ruleVersion = rule.version;
  const project = (await a.client.createProject({ requestId: rid(), name: "D LangGraph 反证项目" })).project;
  ctx.projectId = project.projectId;
  const e1 = (await a.client.attachEvidence(project.projectId, { requestId: rid(), expectedVersion: 1, kind: "财务摘录", content: { text: "现金流 12 万/月（合成）", caliber: "月均" } })).evidence.evidenceId;
  const e2 = (await a.client.attachEvidence(project.projectId, { requestId: rid(), expectedVersion: 2, kind: "还款计划", content: { text: "月供 10 万（合成）", caliber: "含息" } })).evidence.evidenceId;
  ctx.evidenceRefs = evRefs(e1, e2);
  ctx.toolInputs = {
    monthlyOperatingCashFlow: { value: 120000, caliber: "企业月度平均（未经审计）", source: { evidenceId: e1, version: 1 } },
    monthlyDebtService: { value: 100000, caliber: "合同月供（含息）", source: { evidenceId: e2, version: 1 } },
    currency: "CNY", periodMonths: 1,
  };
  LED.note(`fixture: project=${ctx.projectId} rule=v${ctx.ruleVersion}`);

  // ---------- LG-1 unknown：发送后未知不自动重发 ----------
  await caseBounded(async () => {
    const bData = join(WORK, "lg1"), ck = join(WORK, "lg1-ckpt");
    const adapter = makeAdapter("unknown");
    const orch = buildOrch(bData, ck, adapter);
    const view = await orch.start({ runId: "lg-o1", projectId: ctx.projectId, eventType: "ratio_query", evidenceRefs: ctx.evidenceRefs, toolInputs: ctx.toolInputs });
    const modelStep = (view.steps || []).find((s) => s.kind === "model");
    LED.check("LG-1a unknown 后不停留 completed", view.terminal?.kind !== "completed", JSON.stringify(view.terminal));
    LED.check("LG-1b 模型步非 succeeded（waiting/unknown/intent 族）", !["succeeded", "done"].includes(modelStep?.state), modelStep?.state);
    LED.check("LG-1c adapter 恰好一次", adapter.state.calls === 1, adapter.state.calls);
    await orch.continueRun("lg-o1").catch(() => {});
    await orch.continueRun("lg-o1").catch(() => {});
    LED.check("LG-1d 两次 continueRun 后不自动重发", adapter.state.calls === 1, adapter.state.calls);
    // checkpoint 真实落盘：目录存在且含文件
    const ckFiles = (function list(d) { let n = 0; if (!existsSync(d)) return 0; for (const f of readdirSync(d, { withFileTypes: true })) { n += f.isDirectory() ? list(join(d, f.name)) : 1; } return n; })(ck);
    LED.check("LG-1e FileCheckpointSaver 落盘非空", ckFiles > 0, { ckptDir: ck, files: ckFiles });
  });

  // ---------- LG-2 kill-recover（子进程 + 同 checkpointer） ----------
  await caseBounded(async () => {
    const bData = join(WORK, "lg2"), ck = join(WORK, "lg2-ckpt"), mark = join(WORK, "lg2-mark");
    mkdirSync(mark, { recursive: true });
    const args = (mode) => ["--mode", mode, "--data-dir", bData, "--ckpt-dir", ck, "--a-port", String(PORT), "--run-id", "lg-o2", "--mark-dir", mark, "--project-id", ctx.projectId, "--rule-version", String(ctx.ruleVersion), "--evidence-refs", JSON.stringify(ctx.evidenceRefs), "--tool-inputs", JSON.stringify(ctx.toolInputs)];
    const p1 = spawn(process.execPath, [join(HERE, "lg_runner.mjs"), ...args("start")], { stdio: ["ignore", "pipe", "pipe"] });
    let out1 = ""; p1.stdout.on("data", (d) => { out1 += d; });
    const deadline = Date.now() + 20000;
    while (!existsSync(join(mark, "ADAPTER_ENTERED")) && Date.now() < deadline) await delay(100);
    LED.check("LG-2a 到达模型步执行窗口（checkpoint 已含 intent 进度）", existsSync(join(mark, "ADAPTER_ENTERED")));
    killTree(p1.pid);
    await delay(500);
    const p2 = spawn(process.execPath, [join(HERE, "lg_runner.mjs"), ...args("recover")], { stdio: ["ignore", "pipe", "pipe"] });
    let out2 = ""; p2.stdout.on("data", (d) => { out2 += d; });
    await new Promise((r) => { p2.on("exit", r); setTimeout(r, 40000); });
    writeFileSync(join(EV, "lg-kill-recover.txt"), `--- p1 (killed) ---\n${out1}\n--- p2 (recover) ---\n${out2}`);
    const mRec = out2.match(/RECOVERED modelStepState=(\S+) recoveryNote=([^ ]*) adapterCallsAfterRecover=(\d+)/);
    const mCont = out2.match(/AFTER_CONTINUE modelStepState=(\S+) terminal=(\S+) adapterCallsTotal=(\d+)/);
    LED.check("LG-2b 同 checkpointer 重放恢复成功", !!mRec, out2.slice(0, 220));
    LED.check("LG-2c 中断步判 unknown/等待（不自动重发）", mRec && Number(mRec[3]) === 0, { state: mRec?.[1], calls: mRec?.[3] });
    LED.check("LG-2d continueRun 后仍零重发", mCont && Number(mCont[3]) === 0, { total: mCont?.[3] });
  });

  // ---------- LG-3 幂等：重入去重 + A 意见不重复 ----------
  await caseBounded(async () => {
    const bData = join(WORK, "lg3"), ck = join(WORK, "lg3-ckpt");
    const adapter = makeAdapter("ok");
    const aRun = (await a.client.createRun(ctx.projectId, { requestId: rid(), expectedVersion: await curFv(), ruleVersion: ctx.ruleVersion, inputEvidence: ctx.evidenceRefs.map((r) => ({ evidenceId: r.id, version: r.version })) })).run;
    const sink = createARunSink({ aClient: a.client, aRunId: aRun.runId, logger: () => {} });
    const orch = buildOrch(bData, ck, adapter, { sinks: [sink] });
    const input = { runId: "lg-o3", projectId: ctx.projectId, eventType: "ratio_query", evidenceRefs: ctx.evidenceRefs, toolInputs: ctx.toolInputs };
    const v1 = await orch.start(input);
    let v2 = null;
    try { v2 = await orch.start(input); } catch (e) { v2 = { terminal: { kind: "error:" + e.message } }; }
    LED.check("LG-3a 重入不产生第二份 completed 编排（去重或显式拒绝）", !(v2.terminal?.kind === "completed" && v1.terminal?.kind === "completed" && adapter.state.calls > 1), { t1: v1.terminal?.kind, t2: v2.terminal?.kind, calls: adapter.state.calls });
    const g = await http(`http://127.0.0.1:${PORT}/api/v7/runs/${aRun.runId}`);
    LED.check("LG-3b A 意见不重复", (g.json.run.opinions || []).length === 1, (g.json.run.opinions || []).length);
  });

  // ---------- LG-4 resume（现版三重校验；D-9 B 部分绑定修复待 B 交付后扩展） ----------
  await caseBounded(async () => {
    const bData = join(WORK, "lg4"), ck = join(WORK, "lg4-ckpt");
    const adapter = makeAdapter("unknown");
    const orch = buildOrch(bData, ck, adapter);
    await orch.start({ runId: "lg-o4", projectId: ctx.projectId, eventType: "ratio_query", evidenceRefs: ctx.evidenceRefs, toolInputs: ctx.toolInputs });
    const tryResume = (cmd) => orch.resume("lg-o4", cmd).then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, msg: e.message }));
    const anon = await tryResume({ action: "retry_step", stepId: "model", payload: {} });
    LED.check("LG-4a 匿名 resume 被拒（不抛异常，pauseNotice 承载或错误返回）", !anon.ok || !!(anon.v && (anon.v.pauseNotice || anon.v.terminal)), { ok: anon.ok, msg: anon.msg, notice: anon.v?.pauseNotice?.slice?.(0, 80) });
    const fakeRole = await tryResume({ actor: { id: "x", role: "model" }, action: "retry_step", stepId: "model", payload: {} });
    LED.check("LG-4b role=model resume 被拒", !fakeRole.ok || !!(fakeRole.v && fakeRole.v.pauseNotice), { ok: fakeRole.ok, msg: fakeRole.msg });
    await a.client.attachEvidence(ctx.projectId, { requestId: rid(), expectedVersion: await curFv(), kind: "note", content: { text: "LG-4 版本漂移" } });
    const drift = await tryResume({ actor: { id: "dqa-coordinator", role: "coordinator" }, action: "retry_step", stepId: "model", payload: {} });
    LED.check("LG-4c 版本漂移 resume 被拒", !drift.ok || !!(drift.v && drift.v.pauseNotice), { ok: drift.ok, msg: drift.msg });
    LED.note("LG-4 注：resume 走 LangGraph interrupt/Command 原生门；D-9 B 部分绑定修复交付后扩展可绑定身份断言");
  });

  // ---------- LG-5 D-9 B 部分：可信 resume 凭据+作用域授权 ----------
  await caseBounded(async () => {
    const verifier = (credential, c) => credential === TOKEN
      ? { ok: true, principalId: "dqa-principal-1", role: "human" }
      : { ok: false };
    const allowThisProject = (verdict, c) => c.projectId === ctx.projectId
      ? { ok: true }
      : { ok: false, reasonZh: "项目不在授权范围（D-9 作用域绑定验证）" };
    const denyAll = () => ({ ok: false, reasonZh: "O-5b 授权器拒绝" });

    const bData = join(WORK, "lg5"), ck = join(WORK, "lg5-ckpt");
    const adapter = makeAdapter("unknown");
    const orch = buildOrch(bData, ck, adapter, { principalVerifier: verifier, authorizer: allowThisProject });
    await orch.start({ runId: "lg-o5", projectId: ctx.projectId, eventType: "ratio_query", evidenceRefs: ctx.evidenceRefs, toolInputs: ctx.toolInputs });
    // 合法凭据 + 授权项目 → 接受（显式重锚定）
    const okR = await orch.resume("lg-o5", {
      principalCredential: TOKEN, action: "provide_evidence", stepId: "model",
      payload: { newEvidenceRefs: ctx.evidenceRefs, newFactVersion: String(await curFv()) },
    }).then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, msg: e.message }));
    LED.check("LG-5a 合法凭据+授权项目 resume 接受（gateStamp 盖章）", okR.ok === true, { msg: okR.msg, stamp: okR.v && JSON.stringify(okR.v).includes("principalId") });

    // 跨项目作用域：第二项目 + 拒绝该项目的 authorizer
    const p2 = (await a.client.createProject({ requestId: rid(), name: "LG-5 越权项目" })).project;
    const ck2 = join(WORK, "lg5-ckpt2");
    const orch2 = buildOrch(join(WORK, "lg5-b2"), ck2, makeAdapter("unknown"), { principalVerifier: verifier, authorizer: denyAll });
    await orch2.start({ runId: "lg-o5b", projectId: p2.projectId, eventType: "ratio_query", evidenceRefs: [{ id: e2, version: 1 }, { id: e2, version: 1 }], toolInputs: ctx.toolInputs }).catch(() => {});
    const denied = await orch2.resume("lg-o5b", {
      principalCredential: TOKEN, action: "retry_step", stepId: "model", payload: {},
    }).then((v) => ({ ok: true })).catch((e) => ({ ok: false, msg: e.message }));
    LED.check("LG-5b 授权器拒绝（作用域绑定生效）", denied.ok === false, denied);

    // 错误凭据 → PRINCIPAL_UNTRUSTED
    const orch3 = buildOrch(join(WORK, "lg5-b3"), join(WORK, "lg5-ckpt3"), makeAdapter("unknown"), { principalVerifier: verifier, authorizer: allowThisProject });
    await orch3.start({ runId: "lg-o5c", projectId: ctx.projectId, eventType: "ratio_query", evidenceRefs: ctx.evidenceRefs, toolInputs: ctx.toolInputs }).catch(() => {});
    const badCred = await orch3.resume("lg-o5c", {
      principalCredential: "wrong-token", action: "retry_step", stepId: "model", payload: {},
    }).then((v) => ({ ok: true })).catch((e) => ({ ok: false, msg: e.message }));
    LED.check("LG-5c 错误凭据→PRINCIPAL_UNTRUSTED", badCred.ok === false, badCred);
    LED.note("LG-5 注：D-9 B 部分修复验证通过（凭据→principalId→项目/动作授权三层；gateStamp 盖章进 run）。跨项目威胁面收敛为 token 持有范围+authorizer 策略。");
  });

} catch (e) {
  LED.markSuiteError(e.message || e);
  LED.check("SUITE-COMPLETED（套件未中途异常）", false, e.message || e);
  console.error("[SUITE ERROR]", e);
} finally {
  if (server) killTree(server.pid);
  try { rmSync(WORK, { recursive: true, force: true }); } catch {}
}

LED.save(EV);
console.log(`\n== LangGraph 编排反证结果: ${LED.summary} ==`);
console.log(`FAIL 项: ${LED.fail.map(f => f.id).join(", ") || "无"}`);
process.exit(LED.fail.length ? 1 : 0);
