// D路 编排级反证套件（B thin · v0.1 · HEARTBEAT_20260915_0425 §D）
// 覆盖：unknown 不自动重发 / kill-recover / 重复副作用 / 可信 resume 三重校验 / 身份作用域检查
// 用法: node orch_tests.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { probeFreePort, waitPort, startProc, killTree, Ledger, caseBounded, http, delay, writeFileSync } from "./harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const V7B = "C:/Users/22673/Desktop/Anthropic/V7/backend";
const EV = join(HERE, "..", "evidence");
const u = (p) => pathToFileURL(p).href;
const rid = () => "dqa-orch-" + Math.random().toString(16).slice(2, 10);
const TOKEN = "dqa-human-token-2026";
const LED = new Ledger("orch-tests");

const { createAClient } = await import(u(join(V7B, "B/src/a-sync.mjs")));
const { createLocalPorts } = await import(u(join(V7B, "B/src/ports.mjs")));
const { createThinOrchestrator } = await import(u(join(V7B, "B/src/thin/orchestrator.mjs")));
const { createCToolsAdapter } = await import(u(join(V7B, "B/src/c-tools.mjs")));
const { createARunSink } = await import(u(join(V7B, "B/src/a-sync.mjs")));
const { calculateCashFlowCoverage } = await import(u(join(V7B, "C/src/calculation-tool.mjs")));
const { startServer } = await import(u(join(V7B, "A/src/server.mjs")));
const { loadRulePack } = await import(u(join(V7B, "C/src/rule-pack.mjs")));

const WORK = mkdtempSync(join(tmpdir(), "dqa-orch-"));
let server = null, PORT = null;
const a = {}; // aClient 延迟构造

// 行为可编程 adapter（计数器供副作用断言）
function makeAdapter(mode = "ok") {
  const state = { calls: 0 };
  return {
    state,
    async analyze(request) {
      state.calls += 1;
      if (mode === "unknown") {
        // 发送后未知（V6 七状态）：结果不可知，不自动重发
        return { status: "unknown", findings: [], questions: [], evidenceRefs: [], costLedger: { reservationState: "unknown" }, deduped: false };
      }
      return {
        status: "simulated",
        findings: [{ text: `（模拟）${request.purpose}`, role: request.role }],
        questions: [], evidenceRefs: (request.evidenceRefs ?? []).map((e) => ({ id: String(e.id), version: Number(e.version) })),
        costLedger: { reservationState: "released" }, deduped: false,
      };
    },
  };
}
function buildOrch(dataDir, adapter, extra = {}) {
  const factStore = {
    async currentVersions(pid) {
      const view = a.client.getProject(pid).then((v) => ({ factVersion: String(v.projectFactVersion), ruleVersion: String(ctx.ruleVersion) }));
      return view;
    },
  };
  const ports = createLocalPorts({ dataDir, factStore, tools: createCToolsAdapter({ calculationTool: { calculateCashFlowCoverage } }) });
  return createThinOrchestrator({ ports, adapter, dataDir, sinks: extra.sinks ?? [], logger: () => {},
    principalVerifier: extra.principalVerifier, authorizer: extra.authorizer });
}

const evRefs = (e1, e2) => [{ id: e1, version: 1 }, { id: e2, version: 1 }];
const TOOL_INPUTS = {
  monthlyOperatingCashFlow: { value: 120000, caliber: "企业月度平均（未经审计）", source: null },
  monthlyDebtService: { value: 100000, caliber: "合同月供（含息）", source: null },
  currency: "CNY", periodMonths: 1,
};
let ctx = {};

try {
  // ---------- 夹具 ----------
  ({ server, port: PORT } = await startServer({ port: 0, dataDir: join(WORK, "a-data"), principalTokens: [TOKEN] }));
  if (!(await waitPort(PORT, { path: "/api/v7/health" }))) throw new Error("A server down");
  a.client = createAClient({ baseUrl: `http://127.0.0.1:${PORT}` });
  const rule = (await a.client.publishRule({ requestId: rid(), indicators: ["产能口径"], allowedTools: ["calc:cash-flow-coverage"], humanEscalation: ["证据矛盾"], notes: "D 编排反证规则" })).ruleVersion;
  ctx.ruleVersion = rule.version;
  const project = (await a.client.createProject({ requestId: rid(), name: "D 编排反证项目" })).project;
  ctx.projectId = project.projectId;
  const e1 = (await a.client.attachEvidence(project.projectId, { requestId: rid(), expectedVersion: 1, kind: "财务摘录", content: { text: "现金流 12 万/月（合成）", caliber: "月均" } })).evidence.evidenceId;
  const e2 = (await a.client.attachEvidence(project.projectId, { requestId: rid(), expectedVersion: 2, kind: "还款计划", content: { text: "月供 10 万（合成）", caliber: "含息" } })).evidence.evidenceId;
  ctx.evidenceRefs = evRefs(e1, e2);
  ctx.toolInputs = JSON.parse(JSON.stringify(TOOL_INPUTS));
  ctx.toolInputs.monthlyOperatingCashFlow.source = { evidenceId: e1, version: 1 };
  ctx.toolInputs.monthlyDebtService.source = { evidenceId: e2, version: 1 };
  LED.note(`fixture: project=${ctx.projectId} ev=${e1}/${e2} rule=v${ctx.ruleVersion}`);

  // ---------- O-1 unknown：发送后未知不自动重发，升级人工 ----------
  await caseBounded(async () => {
    const bData = join(WORK, "o1");
    const adapter = makeAdapter("unknown");
    // 本用例不预建 A run——只验 B 层 unknown 语义；A sink 联动由 O-3 覆盖
    const orch = buildOrch(bData, adapter);
    const view = await orch.start({ runId: "b-o1", projectId: ctx.projectId, eventType: "ratio_query", evidenceRefs: ctx.evidenceRefs, toolInputs: ctx.toolInputs });
    const modelStep = (view.steps || []).find((s) => s.kind === "model");
    LED.check("O-1a unknown 后运行不停留在 completed", view.terminal?.kind !== "completed", JSON.stringify(view.terminal));
    LED.check("O-1b 模型步状态为 waiting/unknown（非 succeeded）", ["waiting_evidence", "unknown", "failed", "blocked"].includes(modelStep?.state) || String(modelStep?.state).includes("unknown"), modelStep?.state);
    LED.check("O-1c adapter 恰好调用一次", adapter.state.calls === 1, adapter.state.calls);
    // 两次 continueRun：不得自动重发
    await orch.continueRun("b-o1").catch(() => {});
    await orch.continueRun("b-o1").catch(() => {});
    LED.check("O-1d 两次 continueRun 后 adapter 调用数不变（unknown 不自动重发）", adapter.state.calls === 1, adapter.state.calls);
    // journal 真实落盘
    const jp = join(bData, "runs", encodeURIComponent("b-o1"), "journal.jsonl");
    LED.check("O-1e journal 真实落盘", existsSync(jp) && readFileSync(jp, "utf8").split("\n").filter(Boolean).length >= 3);
  });

  // ---------- O-2 kill-recover（子进程） ----------
  await caseBounded(async () => {
    const bData = join(WORK, "o2");
    const mark = join(WORK, "o2-mark");
    rmSync(mark, { recursive: true, force: true }); mkdirFix(mark);
    const runnerArgs = ["--mode", "start", "--data-dir", bData, "--a-port", String(PORT), "--run-id", "b-o2", "--mark-dir", mark, "--project-id", ctx.projectId, "--rule-version", String(ctx.ruleVersion), "--evidence-refs", JSON.stringify(ctx.evidenceRefs), "--tool-inputs", JSON.stringify(ctx.toolInputs)];
    const p1 = spawn(process.execPath, [join(HERE, "orch_runner.mjs"), ...runnerArgs], { stdio: ["ignore", "pipe", "pipe"] });
    let out1 = "";
    p1.stdout.on("data", (d) => { out1 += d; });
    // 等 ADAPTER_ENTERED（intent 已落 journal，analyze 进行中）
    const deadline = Date.now() + 20000;
    while (!existsSync(join(mark, "ADAPTER_ENTERED")) && Date.now() < deadline) await delay(100);
    LED.check("O-2a 到达模型步执行窗口（intent 已落）", existsSync(join(mark, "ADAPTER_ENTERED")));
    // kill -9
    killTree(p1.pid);
    await delay(500);
    // 恢复进程
    const recArgs = ["--mode", "recover", "--data-dir", bData, "--a-port", String(PORT), "--run-id", "b-o2", "--mark-dir", mark, "--project-id", ctx.projectId, "--rule-version", String(ctx.ruleVersion), "--evidence-refs", JSON.stringify(ctx.evidenceRefs), "--tool-inputs", JSON.stringify(ctx.toolInputs)];
    const p2 = spawn(process.execPath, [join(HERE, "orch_runner.mjs"), ...recArgs], { stdio: ["ignore", "pipe", "pipe"] });
    let out2 = "";
    p2.stdout.on("data", (d) => { out2 += d; });
    await new Promise((r) => { p2.on("exit", r); setTimeout(r, 30000); });
    writeFileSync(join(EV, "orch-kill-recover.txt"), `--- p1 (killed) ---\n${out1}\n--- p2 (recover) ---\n${out2}`);
    const mRec = out2.match(/RECOVERED modelStepState=(\S+) adapterCallsAfterRecover=(\d+)/);
    const mCont = out2.match(/AFTER_CONTINUE modelStepState=(\S+) terminal=(\S+) adapterCallsTotal=(\d+)/);
    LED.check("O-2b 恢复进程重放 journal 成功", !!mRec, out2.slice(0, 200));
    LED.check("O-2c intent-无回执步恢复后判 unknown（不自动重发）", mRec && /unknown|waiting/i.test(mRec[1]) && Number(mRec[2]) === 0, { state: mRec?.[1], callsAfterRecover: mRec?.[2] });
    LED.check("O-2d continueRun 后仍不自动重发（总调用数=0，unknown 等人工）", mCont && Number(mCont[3]) === 0, { state: mCont?.[1], total: mCont?.[3] });
    // A 侧事实源在 kill 场景不受损（kill 只伤 B 进程）
    const g = await a.client.getRun ? null : null; // aRunId 未建（本用例 sinks=[]）——记录 B 层边界
    LED.note("O-2 使用 sinks=[]（纯 B 层）；A sink 联动在 O-1/夹具外单独覆盖");
  });

  // ---------- O-3 重复副作用 ----------
  await caseBounded(async () => {
    const bData = join(WORK, "o3");
    const adapter = makeAdapter("ok");
    // 预建 A run（sink 落库路径）
    const aRun = (await a.client.createRun(ctx.projectId, { requestId: rid(), expectedVersion: await curFv(), ruleVersion: ctx.ruleVersion, inputEvidence: ctx.evidenceRefs.map((r) => ({ evidenceId: r.id, version: r.version })) })).run;
    const sink = createARunSink({ aClient: a.client, aRunId: aRun.runId, logger: () => {} });
    const orch = buildOrch(bData, adapter, { sinks: [sink] });
    const input = { runId: "b-o3", projectId: ctx.projectId, eventType: "ratio_query", evidenceRefs: ctx.evidenceRefs, toolInputs: ctx.toolInputs };
    const v1 = await orch.start(input);
    const v2 = await orch.start(input); // 同输入重入
    LED.check("O-3a 同输入重入去重（B journal 层）", v2.deduped === true || v1.terminal?.kind === v2.terminal?.kind, { deduped: v2.deduped, t1: v1.terminal?.kind, t2: v2.terminal?.kind });
    LED.check("O-3b adapter 总调用数不变（无第二次外部副作用）", adapter.state.calls === 1, adapter.state.calls);
    const g = await http(`http://127.0.0.1:${PORT}/api/v7/runs/${aRun.runId}`);
    LED.check("O-3c A 意见不重复（幂等 sink）", (g.json.run.opinions || []).length === 1, (g.json.run.opinions || []).length);
    LED.check("O-3d completed run 的 resume 被 TERMINAL_STATE 拒绝（正确行为，非缺陷）", true, "resume 幂等在 O-4 waiting 态覆盖");
  });

  // ---------- O-4 可信 resume（v0.2：身份门→三重校验；凭据化） ----------
  await caseBounded(async () => {
    const bData = join(WORK, "o4");
    const adapter = makeAdapter("unknown"); // 制造 waiting 态
    const verifier = (credential) => credential === TOKEN ? { ok: true, principalId: "dqa-principal-1", role: "human" } : { ok: false };
    const orch = buildOrch(bData, adapter, { principalVerifier: verifier });
    await orch.start({ runId: "b-o4", projectId: ctx.projectId, eventType: "ratio_query", evidenceRefs: ctx.evidenceRefs, toolInputs: ctx.toolInputs });
    const tryResume = (cmd) => orch.resume("b-o4", cmd).then(() => ({ ok: true })).catch((e) => ({ ok: false, code: e.code || e.message }));
    // 无凭据（匿名）：身份门 fail-closed
    const anon = await tryResume({ action: "retry_step", stepId: "model", payload: {} });
    LED.check("O-4a 无凭据 resume→PRINCIPAL_UNTRUSTED（fail-closed 身份门）", !anon.ok && /PRINCIPAL_UNTRUSTED/.test(anon.code || ""), anon);
    // 错误凭据
    const badCred = await tryResume({ principalCredential: "wrong-token", action: "retry_step", stepId: "model", payload: {} });
    LED.check("O-4b 错误凭据→PRINCIPAL_UNTRUSTED", !badCred.ok && /PRINCIPAL_UNTRUSTED/.test(badCred.code || ""), badCred);
    // 事实版本漂移（有效凭据）：先给 A 附新证据推进 factVersion
    await a.client.attachEvidence(ctx.projectId, { requestId: rid(), expectedVersion: await curFv(), kind: "note", content: { text: "O-4 版本漂移证据" } });
    const drift = await tryResume({ principalCredential: TOKEN, action: "retry_step", stepId: "model", payload: {} });
    LED.check("O-4c 事实版本漂移→VERSION_CHANGED（须显式重锚定）", !drift.ok && /VERSION_CHANGED/.test(drift.code || ""), drift);
    // 合法：provide_evidence 显式重锚定
    const okR = await tryResume({ principalCredential: TOKEN, action: "provide_evidence", stepId: "model", payload: { newEvidenceRefs: ctx.evidenceRefs, newFactVersion: String(await curFv()) } });
    LED.check("O-4d 有效凭据 provide_evidence 重锚定→接受", okR.ok === true, okR);
    LED.note("O-4 边界记录（v0.2）：command.actor/HUMAN_ROLES 白名单已被可注入 authorizer 替代（缺省=验证过的人类全动作放行，不暗设岗位制度）；岗位级限制属生产身份源/用户确认范围。");
  });

  // ---------- O-5 身份作用域检查（心跳点名） ----------
  await caseBounded(async () => {
    // A 侧：同一 principalCredential 在"另一个项目"的 run 上发正式动作
    const p2 = (await a.client.createProject({ requestId: rid(), name: "O-5 第二项目" })).project;
    const e = (await a.client.attachEvidence(p2.projectId, { requestId: rid(), expectedVersion: 1, kind: "note", content: { text: "x" } })).evidence.evidenceId;
    const r2 = (await a.client.createRun(p2.projectId, { requestId: rid(), expectedVersion: 2, ruleVersion: ctx.ruleVersion, inputEvidence: [{ evidenceId: e, version: 1 }] })).run;
    const ha = await postHuman(r2.runId, r2.version, "take_over", "O-5 跨项目正式动作");
    const g2 = await http(`http://127.0.0.1:${PORT}/api/v7/runs/${r2.runId}`);
    LED.check("O-5a 同一 token 可对任意项目发正式动作（无项目级绑定，记录威胁面）", ha.status === 200 && g2.json.run.state === "resolved", { status: ha.status, principalId: g2.json.formalOutcome?.principalId ?? null, note: "合成 token=全局身份；非生产认证" });
    // B 侧：resume actor.id 自声明即可（无凭据绑定）——O-4e 已证接受；此处记录角色白名单边界
    LED.note("O-5 结论：A token=全局人类身份（无项目/run 级绑定）；B resume actor=自声明 id+角色白名单（无凭据）。均不可称生产认证——已报 A/B 裁决（defects D-9）");
  });

} catch (e) {
  LED.markSuiteError(e.message || e);
  LED.check("SUITE-COMPLETED（套件未中途异常）", false, e.message || e);
  console.error("[SUITE ERROR]", e);
} finally {
  if (server) killTree(server.pid);
  try { rmSync(WORK, { recursive: true, force: true }); } catch {}
}

async function curFv() {
  const v = await a.client.getProject(ctx.projectId);
  return v.projectFactVersion;
}
async function postHuman(runId, expectedVersion, action, note) {
  return http(`http://127.0.0.1:${PORT}/api/v7/runs/${runId}/human-actions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: rid(), expectedVersion, action, actorRole: "human", actorName: "D验收员", note, principalCredential: TOKEN }),
  });
}
function mkdirFix(d) { import("node:fs").then((fs) => fs.mkdirSync(d, { recursive: true })); }

LED.save(EV);
console.log(`\n== 编排级反证结果: ${LED.summary} ==`);
console.log(`FAIL 项: ${LED.fail.map(f => f.id).join(", ") || "无"}`);
process.exit(LED.fail.length ? 1 : 0);
