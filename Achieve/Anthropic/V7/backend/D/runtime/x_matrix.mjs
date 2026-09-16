// D路 X矩阵 E2E（V7 backend · CONTRACT v0 黑盒验收）v2 —— 适配实测响应形状
// 自包含：自起 A server（空闲端口+全新数据目录）→ 全部用例 → 自清理。
// 用法: node x_matrix.mjs [--keep]
import { rmSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { probeFreePort, waitPort, startProc, killTree, Ledger, caseBounded, http, delay } from "./harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const A_SRC = "C:/Users/22673/Desktop/Anthropic/V7/backend/A/src";
const KEEP = process.argv.includes("--keep");
const EV = join(HERE, "..", "evidence");
const rid = () => "dqa-" + Math.random().toString(16).slice(2, 10);
const LED = new Ledger("x-matrix");

const PORT = await probeFreePort(3491);
const DATA = join(HERE, "data-x-" + Date.now());
const LOG = join(HERE, `server-x-${PORT}.log`);
let proc = null;
async function startServer() {
  proc = startProc("node", [join(A_SRC, "server.mjs"), "--port", String(PORT), "--data-dir", DATA,
    "--principal-tokens", "dqa-human-token-2026"], { logFile: LOG });
  if (!(await waitPort(PORT, { path: "/api/v7/health", timeoutMs: 20000 }))) throw new Error("server failed to start; see " + LOG);
}
async function stopServer() { if (proc) { killTree(proc.pid); proc = null; await delay(800); } }

const B = `http://127.0.0.1:${PORT}`;
const post = (p, body) => http(B + p, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const get = (p) => http(B + p);
const fvOf = (r) => r.json.project?.factVersion ?? r.json.projectFactVersion ?? null;   // GET→project.factVersion；POST→projectFactVersion
const fv = async () => fvOf(await get(`/api/v7/projects/${ctx.projectId}`));
const runV = async (id) => (await get(`/api/v7/runs/${id}`)).json.run.version;

let ctx = {};
try {
  await startServer();
  LED.note(`server up port=${PORT} data=${DATA}`);

  // ---------- 夹具 ----------
  await caseBounded(async () => {
    const r1 = await post("/api/v7/rules", { requestId: rid(), indicators: ["产能口径"], allowedTools: ["calc.basic"], humanEscalation: ["证据矛盾"], notes: "D测试规则 v1" });
    ctx.ruleVersion = r1.json.ruleVersion?.version;
    LED.check("FIX-1 发布规则版本", r1.status === 200 && Number.isInteger(ctx.ruleVersion), r1.json);
    const r2 = await post("/api/v7/projects", { requestId: rid(), name: "D路X矩阵项目" });
    ctx.projectId = r2.json.project?.projectId;
    LED.check("FIX-2 创建项目(factVersion=1)", r2.status === 200 && !!ctx.projectId && r2.json.project.factVersion === 1, r2.json);
    const ev = await post(`/api/v7/projects/${ctx.projectId}/evidence`, { requestId: rid(), expectedVersion: 1, kind: "note", content: { text: "产能记录：月产值约450万元" } });
    ctx.ev1 = ev.json.evidence?.evidenceId;
    LED.check("FIX-3 附着证据v1(factVersion→2)", ev.status === 200 && ev.json.evidence?.version === 1 && ev.json.projectFactVersion === 2, ev.json);
    const run = await post(`/api/v7/projects/${ctx.projectId}/runs`, { requestId: rid(), expectedVersion: 2, ruleVersion: ctx.ruleVersion, inputEvidence: [{ evidenceId: ctx.ev1, version: 1 }] });
    ctx.runId = run.json.run?.runId;
    LED.check("FIX-4 创建run(pending,快照factVersion=2)", run.status === 200 && run.json.run?.state === "pending" && run.json.run?.factVersion === 2, run.json);
  });

  // ---------- X-1 双客户端共享事实 ----------
  await caseBounded(async () => {
    const w = await post(`/api/v7/projects/${ctx.projectId}/evidence`, { requestId: rid(), expectedVersion: await fv(), kind: "note", content: { text: "X-1 甲端写入" } });
    LED.check("X-1pre 甲端写成功", w.status === 200, w.json);
    const gB = await get(`/api/v7/projects/${ctx.projectId}`); // 乙端读
    LED.check("X-1a 乙端读到同 factVersion", fvOf(gB) === w.json.projectFactVersion, { wrote: w.json.projectFactVersion, read: fvOf(gB) });
    LED.check("X-1b 乙端证据列表含新写入", (gB.json.evidence || []).length >= 2, (gB.json.evidence || []).length);
    const [ra, rb] = await Promise.all([get(`/api/v7/projects/${ctx.projectId}`), get(`/api/v7/projects/${ctx.projectId}`)]);
    LED.check("X-1c 两客户端同刻读取一致", JSON.stringify(ra.json) === JSON.stringify(rb.json));
  });

  // ---------- X-2 重复/并发提交 ----------
  await caseBounded(async () => {
    const fv0 = await fv();
    const body = { requestId: rid(), expectedVersion: fv0, kind: "note", content: { text: "X-2 幂等探针" } };
    const r1 = await post(`/api/v7/projects/${ctx.projectId}/evidence`, body);
    const r2 = await post(`/api/v7/projects/${ctx.projectId}/evidence`, body);
    LED.check("X-2a 同requestId同载荷重放=replayed:true", r1.status === 200 && r2.status === 200 && r2.json.replayed === true, { r1: r1.status, r2: r2.status, replayed: r2.json.replayed });
    LED.check("X-2b 重放不重复记账(factVersion只+1)", (await fv()) === fv0 + 1, { before: fv0, after: await fv() });
    const r3 = await post(`/api/v7/projects/${ctx.projectId}/evidence`, { ...body, content: { text: "换载荷" } });
    LED.check("X-2c 同requestId换载荷→409 REQUEST_MISMATCH", r3.status === 409 && r3.json.error === "REQUEST_MISMATCH", r3.json);
    const fv1 = await fv();
    const b2 = { requestId: rid(), expectedVersion: fv1, kind: "note", content: { text: "X-2 并发探针" } };
    const rs = await Promise.all(Array.from({ length: 4 }, () => post(`/api/v7/projects/${ctx.projectId}/evidence`, b2)));
    const okOnce = rs.filter(r => r.status === 200 && r.json.replayed !== true).length;
    const replayN = rs.filter(r => r.json.replayed === true).length;
    LED.check("X-2d 并发4×同requestId：恰好一次生效版本只+1", okOnce === 1 && (await fv()) === fv1 + 1, { okOnce, replayN, statuses: rs.map(r => r.status), before: fv1, after: await fv() });
    const rc = await get(`/api/v7/receipts/${b2.requestId}?store=facts`);
    LED.check("X-2e 回执查询命中幂等记录", rc.status === 200 && rc.json.ok === true && !!rc.json.receipt, { found: rc.json.found, hasReceipt: !!rc.json.receipt });
    const rc2 = await get(`/api/v7/receipts/${rid()}?store=facts`);
    LED.check("X-2f 未知requestId→found:false（不伪装命中）", rc2.status === 200 && rc2.json.found === false, rc2.json);
    const stale = await post(`/api/v7/projects/${ctx.projectId}/evidence`, { requestId: rid(), expectedVersion: 1, kind: "note", content: { text: "X-2 过期版本" } });
    LED.check("X-2g 过期版本→409 VERSION_CONFLICT+serverVersion", stale.status === 409 && stale.json.error === "VERSION_CONFLICT" && Number.isInteger(stale.json.serverVersion), stale.json);
  });

  // ---------- X-3 重启恢复 ----------
  await caseBounded(async () => {
    const fvBefore = await fv();
    const req = rid();
    const w1 = await post(`/api/v7/projects/${ctx.projectId}/evidence`, { requestId: req, expectedVersion: fvBefore, kind: "note", content: { text: "X-3 重启前写" } });
    await stopServer();
    await startServer();
    LED.check("X-3a 重启后事实恢复版本一致", (await fv()) === fvBefore + 1, { before: fvBefore, after: await fv() });
    const r = await get(`/api/v7/runs/${ctx.runId}`);
    LED.check("X-3b run恢复(opinions/humanActions在)", r.status === 200 && r.json.run?.runId === ctx.runId && Array.isArray(r.json.run.opinions), { state: r.json.run?.state });
    const w2 = await post(`/api/v7/projects/${ctx.projectId}/evidence`, { requestId: req, expectedVersion: fvBefore, kind: "note", content: { text: "X-3 重启前写" } });
    LED.check("X-3c 重启后同requestId仍幂等重放", w2.status === 200 && w2.json.replayed === true, { status: w2.status, replayed: w2.json.replayed });
    LED.check("X-3d 重放不重复记账", (await fv()) === fvBefore + 1, { now: await fv() });
    const fvNow = await fv();
    const w3 = await post(`/api/v7/projects/${ctx.projectId}/evidence`, { requestId: rid(), expectedVersion: fvNow, kind: "note", content: { text: "X-3 重启后新写" } });
    LED.check("X-3e 重启后新写版本单调+1", w3.status === 200 && (await fv()) === fvNow + 1);
  });

  // ---------- 夹具2：opinion/calculation ----------
  await caseBounded(async () => {
    const op = await post(`/api/v7/runs/${ctx.runId}/opinions`, {
      requestId: rid(), expectedVersion: await runV(ctx.runId), provider: "simulation", requestReceipt: "sim-" + rid(),
      candidate: { observations: ["月产值450万与申报基本满负荷存在口径差异"], evidenceRefs: [ctx.ev1], assumptions: ["按月度口径"], uncertainty: ["台账未核实"], recommendedHumanAction: "need_more_evidence" },
      basedOnEvidence: [{ evidenceId: ctx.ev1, version: 1 }],
    });
    LED.check("FIX-5 写入模型候选意见", op.status === 200 && op.json.ok === true, op.json);
    const gRun = await get(`/api/v7/runs/${ctx.runId}`);
    LED.check("FIX-6 run=candidate_ready 且 authority=none", gRun.json.run.state === "candidate_ready" && (gRun.json.run.opinions || [])[0]?.authority === "none", { state: gRun.json.run.state });
    const calc = await post(`/api/v7/runs/${ctx.runId}/calculation`, { requestId: rid(), expectedVersion: await runV(ctx.runId), toolVersion: "calc.basic@1", inputHash: "sha256-" + rid(), output: { value: 450, unit: "万元/月" }, assumptions: ["月度口径"] });
    LED.check("FIX-7 写入可验证计算(带公式版本)", calc.status === 200 && calc.json.ok === true, calc.json);
  });

  // ---------- X-4 unknown 语义 ----------
  await caseBounded(async () => {
    const run = await post(`/api/v7/projects/${ctx.projectId}/runs`, { requestId: rid(), expectedVersion: await fv(), ruleVersion: ctx.ruleVersion, inputEvidence: [{ evidenceId: ctx.ev1, version: 1 }] });
    const runId = run.json.run?.runId;
    const st = await post(`/api/v7/runs/${runId}/state`, { requestId: rid(), expectedVersion: run.json.run.version, state: "unknown", reason: "X-4 模拟发送后未知" });
    LED.check("X-4a escalation→unknown 被接受", st.status === 200 && st.json.ok === true, st.json);
    let g1 = await get(`/api/v7/runs/${runId}`);
    LED.check("X-4b run.state=unknown（非failed非success）", g1.json.run.state === "unknown", g1.json.run.state);
    await delay(1500);
    g1 = await get(`/api/v7/runs/${runId}`);
    LED.check("X-4c 无自动重试（1.5s后仍unknown）", g1.json.run.state === "unknown", g1.json.run.state);
    const op = await post(`/api/v7/runs/${runId}/opinions`, {
      requestId: rid(), expectedVersion: g1.json.run.version, provider: "simulation", requestReceipt: "sim-x4",
      candidate: { observations: ["x4探针"], evidenceRefs: [], assumptions: [], uncertainty: [], recommendedHumanAction: "take_over" },
      basedOnEvidence: [],
    });
    LED.check("X-4d unknown 态写意见被拒（状态机门，非pending）", op.status === 409, { status: op.status, err: op.json.error });
    const ha = await post(`/api/v7/runs/${runId}/human-actions`, { requestId: rid(), expectedVersion: (await get(`/api/v7/runs/${runId}`)).json.run.version, action: "take_over", actorRole: "human", actorName: "D验收员", note: "X-4 人工接管unknown", principalCredential: "dqa-human-token-2026" });
    g1 = await get(`/api/v7/runs/${runId}`);
    LED.check("X-4e unknown 后人工 take_over→resolved", ha.status === 200 && g1.json.run.state === "resolved", { ha: ha.status, state: g1.json.run.state });
  });

  // ---------- X-5 证据替换→旧意见过期 ----------
  await caseBounded(async () => {
    const sp = await post(`/api/v7/projects/${ctx.projectId}/evidence/${ctx.ev1}/supersede`, { requestId: rid(), expectedVersion: await fv(), content: { text: "产能记录更正：月产值约450万元（台账核实版）" } });
    ctx.ev2 = sp.json.evidence?.evidenceId;
    LED.check("X-5a supersede 生成新证据且 supersedes 链接正确", sp.status === 200 && sp.json.evidence?.supersedes === ctx.ev1, { supersedes: sp.json.evidence?.supersedes });
    const gRun = await get(`/api/v7/runs/${ctx.runId}`);
    const run = gRun.json.run;
    const op = (run.opinions || [])[0];
    LED.check("X-5b 基于被取代证据的 opinion stale:true", op?.stale === true, { stale: op?.stale });
    LED.check("X-5c run 事实过期信号（响应顶层 stale，合同'run 顶层'实现取响应顶层）", gRun.json.stale === true, { topStale: gRun.json.stale, runStale: run.stale, currentFv: gRun.json.currentProjectFactVersion, runFv: run.factVersion });
    LED.check("X-5d 历史意见保留未删（只追加）", (run.opinions || []).length === 1 && !!op?.candidate, (run.opinions || []).length);
    const run2 = await post(`/api/v7/projects/${ctx.projectId}/runs`, { requestId: rid(), expectedVersion: await fv(), ruleVersion: ctx.ruleVersion, inputEvidence: [{ evidenceId: ctx.ev2, version: 1 }] });
    ctx.runId2 = run2.json.run?.runId;
    const g2 = await get(`/api/v7/runs/${ctx.runId2}`);
    LED.check("X-5e 基于新证据的新 run 不 stale（未命中不失效）", g2.json.run.stale !== true, { stale: g2.json.run.stale });
    const sp2 = await post(`/api/v7/projects/${ctx.projectId}/evidence/${ctx.ev1}/supersede`, { requestId: rid(), expectedVersion: await fv(), content: { text: "重复取代" } });
    LED.check("X-5f 已取代证据再取代→409 EVIDENCE_SUPERSEDED", sp2.status === 409 && sp2.json.error === "EVIDENCE_SUPERSEDED", sp2.json);
  });

  // ---------- X-6 计算输入完整性 ----------
  await caseBounded(async () => {
    const rv = await runV(ctx.runId2);
    const miss = await post(`/api/v7/runs/${ctx.runId2}/calculation`, { requestId: rid(), expectedVersion: rv, inputHash: "sha256-x", output: { value: 1, unit: "万元" }, assumptions: [] });
    LED.check("X-6a 缺 toolVersion→400", miss.status === 400 && miss.json.error === "INVALID_INPUT", miss.json);
    const bad = await post(`/api/v7/runs/${ctx.runId2}/calculation`, { requestId: rid(), expectedVersion: rv, toolVersion: "calc.basic@1", output: { value: 1, unit: "万元" }, assumptions: [] });
    LED.check("X-6b 缺 inputHash→400", bad.status === 400, bad.json);
    const noOut = await post(`/api/v7/runs/${ctx.runId2}/calculation`, { requestId: rid(), expectedVersion: rv, toolVersion: "calc.basic@1", inputHash: "sha256-x", assumptions: [] });
    LED.check("X-6c 缺 output→400（不补造数值）", noOut.status === 400, noOut.json);
    const g = await get(`/api/v7/runs/${ctx.runId2}`);
    LED.check("X-6d 失败计算未落库", g.json.run.calculation === null || g.json.run.calculation === undefined, g.json.run.calculation);
  });

  // ---------- X-7 伪造引用/禁用键 ----------
  await caseBounded(async () => {
    const mkOp = async (extra = {}, be = [{ evidenceId: "ev-nonexistent", version: 1 }], refs = ["ev-nonexistent"]) =>
      post(`/api/v7/runs/${ctx.runId2}/opinions`, {
        requestId: rid(), expectedVersion: await runV(ctx.runId2), provider: "simulation", requestReceipt: "sim-" + rid(),
        candidate: { observations: ["伪造引用探针"], evidenceRefs: refs, assumptions: [], uncertainty: [], recommendedHumanAction: "need_more_evidence", ...extra },
        basedOnEvidence: be,
      });
    const forge = await mkOp();
    LED.check("X-7a 引用不存在的证据被拒", forge.status !== 200, { status: forge.status, err: forge.json.error });
    LED.check("X-7b 伪造引用未落库", ((await get(`/api/v7/runs/${ctx.runId2}`)).json.run.opinions || []).length === 0);
    const baseN = ((await get(`/api/v7/runs/${ctx.runId2}`)).json.run.opinions || []).length; // X-7a 缺陷产生的伪造意见计入基线
    for (const key of ["approval", "approved", "decision", "quota", "price", "rate"]) {
      const bad = await mkOp({ [key]: "yes" }, [], []);
      const afterN = ((await get(`/api/v7/runs/${ctx.runId2}`)).json.run.opinions || []).length;
      LED.check(`X-7c 禁用键 "${key}" 结构拒绝且未落库`, bad.status !== 200 && afterN === baseN, { status: bad.status, baseN, afterN });
    }
  });

  // ---------- X-8 越权人工动作 ----------
  await caseBounded(async () => {
    const rv = await runV(ctx.runId2);
    const fake = await post(`/api/v7/runs/${ctx.runId2}/human-actions`, { requestId: rid(), expectedVersion: rv, action: "accept_candidate", actorRole: "model", actorName: "伪造模型", note: "X-8 越权" });
    LED.check("X-8a actorRole=model→403 ROLE_FORBIDDEN", fake.status === 403 && fake.json.error === "ROLE_FORBIDDEN", fake.json);
    let g = await get(`/api/v7/runs/${ctx.runId2}`);
    LED.check("X-8b 越权未落库 formalOutcome=null", (g.json.run.humanActions || []).length === 0 && (g.json.run.formalOutcome ?? null) === null, { n: (g.json.run.humanActions || []).length });
    const stale = await post(`/api/v7/runs/${ctx.runId2}/human-actions`, { requestId: rid(), expectedVersion: rv + 999, action: "take_over", actorRole: "human", actorName: "D", note: "过期版本", principalCredential: "dqa-human-token-2026" });
    LED.check("X-8c 有效凭据+过期版本→409", stale.status === 409, stale.json);
    const op = await post(`/api/v7/runs/${ctx.runId2}/opinions`, {
      requestId: rid(), expectedVersion: await runV(ctx.runId2), provider: "simulation", requestReceipt: "sim-x8",
      candidate: { observations: ["更正版一致"], evidenceRefs: [ctx.ev2], assumptions: [], uncertainty: [], recommendedHumanAction: "accept_candidate" },
      basedOnEvidence: [{ evidenceId: ctx.ev2, version: 1 }],
    });
    g = await get(`/api/v7/runs/${ctx.runId2}`);
    const ha = await post(`/api/v7/runs/${ctx.runId2}/human-actions`, { requestId: rid(), expectedVersion: g.json.run.version, action: "accept_candidate", actorRole: "human", actorName: "信审员（演示）", note: "X-8 正式接受", principalCredential: "dqa-human-token-2026" });
    g = await get(`/api/v7/runs/${ctx.runId2}`);
    LED.check("X-8d 正式人工动作→resolved 且 formalOutcome=最近humanAction（响应顶层）", ha.status === 200 && g.json.run.state === "resolved" && g.json.formalOutcome?.action === "accept_candidate", { ha: ha.status, state: g.json.run.state, foTop: g.json.formalOutcome?.action, foRun: g.json.run.formalOutcome });
    const late = await post(`/api/v7/runs/${ctx.runId2}/human-actions`, { requestId: rid(), expectedVersion: g.json.run.version, action: "take_over", actorRole: "human", actorName: "D", note: "resolved后再动作", principalCredential: "dqa-human-token-2026" });
    LED.check("X-8e resolved 终态+有效凭据再动作被拒（D-3 终态保护）", late.status === 409, { status: late.status, err: late.json.error });
    // X-8f 身份=自声明字段（心跳反证）：无任何凭据的黑盒客户端自称 actorRole:"human" 即可发正式动作
    const gBefore = await get(`/api/v7/runs/${ctx.runId2}`);
    const spoof = await post(`/api/v7/runs/${ctx.runId2}/human-actions`, { requestId: rid(), expectedVersion: gBefore.json.run.version, action: "return_for_evidence", actorRole: "human", actorName: "匿名伪造者（无凭据）", note: "X-8f 无凭据自称human" });
    const gAfter = await get(`/api/v7/runs/${ctx.runId2}`);
    LED.check("X-8f 无凭据自称human被拒（D-6 修复验证）", spoof.status === 403 && gAfter.json.run.state === gBefore.json.run.state,
      { status: spoof.status, err: spoof.json.error, before: gBefore.json.run.state, after: gAfter.json.run.state });
  });

  // ---------- X-9 错误不伪装成功 ----------
  await caseBounded(async () => {
    const bad = await post(`/api/v7/projects/${ctx.projectId}/evidence`, { requestId: rid(), expectedVersion: await fv(), kind: "", content: {} });
    LED.check("X-9a 非法载荷→400 且 ok:false+error", bad.status === 400 && bad.json.ok === false && !!bad.json.error, bad.json);
    const nf = await get(`/api/v7/runs/run-nonexistent`);
    LED.check("X-9b 不存在资源→404 NOT_FOUND", nf.status === 404 && nf.json.error === "NOT_FOUND", nf.json);
    const raw = await fetch(B + `/api/v7/projects/${ctx.projectId}`);
    LED.check("X-9c Cache-Control: no-store", (raw.headers.get("cache-control") || "").includes("no-store"), raw.headers.get("cache-control"));
    const badJson = await fetch(B + `/api/v7/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{broken" });
    LED.check("X-9d 破损JSON体→400（不500不静默）", badJson.status === 400, badJson.status);
  });

  // ---------- X-10 损坏注入 ----------
  await caseBounded(async () => {
    await stopServer();
    const factsPath = join(DATA, "facts.json");
    const runsPath = join(DATA, "runs.json");
    const origFacts = readFileSync(factsPath, "utf8");
    const origRuns = readFileSync(runsPath, "utf8");
    writeFileSync(factsPath, "{broken json!!");
    await startServer();
    const r = await get(`/api/v7/projects/${ctx.projectId}`);
    LED.check("X-10a 损坏 facts.json→500 STORE_CORRUPT", r.status === 500 && r.json.error === "STORE_CORRUPT", { status: r.status, err: r.json.error });
    LED.check("X-10b 不静默重置损坏文件", readFileSync(factsPath, "utf8") === "{broken json!!");
    await stopServer();
    writeFileSync(factsPath, origFacts);
    writeFileSync(runsPath, "{broken runs!!");
    await startServer();
    const r2 = await get(`/api/v7/runs/${ctx.runId}`);
    LED.check("X-10c 损坏 runs.json→500 STORE_CORRUPT", r2.status === 500 && r2.json.error === "STORE_CORRUPT", { status: r2.status });
    await stopServer();
    writeFileSync(runsPath, origRuns);
    await startServer();
    const ok = await get(`/api/v7/runs/${ctx.runId}`);
    LED.check("X-10d 恢复文件后服务恢复", ok.status === 200 && ok.json.run?.runId === ctx.runId, ok.status);
  });

} catch (e) {
  LED.markSuiteError(e.message || e);
  LED.check("SUITE-COMPLETED（套件未中途异常）", false, e.message || e);
  console.error("[SUITE ERROR]", e);
} finally {
  if (!KEEP) { await stopServer(); try { rmSync(DATA, { recursive: true, force: true }); } catch {} }
  else LED.note(`KEEP: port=${PORT} data=${DATA}`);
}

LED.save(EV);
console.log(`\n== X矩阵结果: ${LED.summary} ==`);
console.log(`FAIL 项: ${LED.fail.map(f => f.id).join(", ") || "无"}`);
process.exit(LED.fail.length ? 1 : 0);
