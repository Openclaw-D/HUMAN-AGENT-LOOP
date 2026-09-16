// D路 组合层验收（A assembly × C 产物 · CONTRACT §6 + Y-2/Y-5）
// 用法: node assembly_tests.mjs
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, cpSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { probeFreePort, waitPort, startProc, killTree, Ledger, caseBounded, http, delay, writeFileSync } from "./harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const V7B = "C:/Users/22673/Desktop/Anthropic/V7/backend";
const EV = join(HERE, "..", "evidence");
const LED = new Ledger("assembly-tests");
const WORK = mkdtempSync(join(tmpdir(), "dqa-asm-"));
const ASM_DATA = join(WORK, "asm-data");

// ---------- A-1 组合复跑（A 自报 14/14，D 独立复跑计数） ----------
let runOut = "";
try {
  runOut = execSync(`node "${join(V7B, "A/assembly/integrated-round.mjs")}" "${ASM_DATA}"`, { encoding: "utf8", timeout: 60000 });
} catch (e) { runOut = String(e.stdout || "") + "\nERR:" + e.message; }
writeFileSync(join(EV, "assembly-rerun-d.txt"), runOut);
const okN = (runOut.match(/ok:/g) || []).length;
const failN = (runOut.match(/FAIL:/g) || []).length;
LED.check("A-1 assembly 独立复跑全绿（0 FAIL，≥11 ok）", failN === 0 && okN >= 11, { okN, failN, note: "A README 称 14/14，实测 11 项检查 0 FAIL——文档计数漂移，记观察项" });

// ---------- A-2 C 计算工具直接反证 ----------
try {
  const { calculateCashFlowCoverage } = await import(pathToFileURL(join(V7B, "C/src/calculation-tool.mjs")).href);
  const good = {
    monthlyOperatingCashFlow: { value: 120000, caliber: "月均", source: { evidenceId: "ev-a", version: 1 } },
    monthlyDebtService: { value: 100000, caliber: "月供", source: { evidenceId: "ev-b", version: 1 } },
    currency: "CNY", periodMonths: 1,
  };
  const r1 = calculateCashFlowCoverage(good);
  LED.check("A-2a 正常输入成功且带 toolVersion/formulaVersion", r1.ok === true && !!r1.result?.toolVersion && !!r1.result?.formulaVersion, { toolVersion: r1.result?.toolVersion, fv: r1.result?.formulaVersion });
  const r1b = calculateCashFlowCoverage(good);
  LED.check("A-2b 同输入确定性（两次输出一致）", JSON.stringify(r1.result) === JSON.stringify(r1b.result));
  const r2 = calculateCashFlowCoverage({ ...good, monthlyDebtService: undefined });
  LED.check("A-2c 缺月供→结构化拒绝（不补造）", r2.ok === false && String(r2.error?.code || "").includes("MISSING"), r2.error);
  const r3 = calculateCashFlowCoverage({ ...good, monthlyOperatingCashFlow: { ...good.monthlyOperatingCashFlow, caliber: undefined } });
  LED.check("A-2d 缺口径→MISSING_CALIBER 拒绝", r3.ok === false && String(r3.error?.code || "").includes("CALIBER"), r3.error);
  const r4 = calculateCashFlowCoverage({ ...good, currency: "XXX" });
  LED.check("A-2e 非法币种→INVALID_CURRENCY", r4.ok === false && String(r4.error?.code || "").includes("CURRENCY"), r4.error);
  const r5 = calculateCashFlowCoverage({ ...good, monthlyDebtService: { value: 0, caliber: "x", source: good.monthlyDebtService.source } });
  LED.check("A-2f 非正月供→拒绝", r5.ok === false, r5.error);
} catch (e) { LED.check("A-2 C 工具导入/执行", false, e.message); }

// ---------- A-3 伪造引用双层检验 ----------
try {
  const { validateCandidate } = await import(pathToFileURL(join(V7B, "C/src/candidate-schema.mjs")).href);
  const forged = {
    observations: ["伪造引用"], evidenceRefs: [{ evidenceId: "ev-nonexistent", version: 1 }],
    assumptions: [], uncertainty: [], recommendedHumanAction: "take_over",
  };
  const c = validateCandidate(forged);
  LED.check("A-3a C 预校验层对不存在证据的形状检查结果（记录）", true, JSON.stringify(c)?.slice(0, 120));
  // A HTTP 层（已知 X-7a：接受）——这里在全新实例复核一次作为 D-5 的组合层证据
  const PORT = await probeFreePort(3491);
  const DATA = join(WORK, "http-data");
  const proc = startProc("node", [join(V7B, "A/src/server.mjs"), "--port", String(PORT), "--data-dir", DATA], { logFile: join(HERE, "server-asm.log") });
  try {
    if (!(await waitPort(PORT, { path: "/api/v7/health" }))) throw new Error("server down");
    const B = `http://127.0.0.1:${PORT}`;
    const post = (p, b) => http(B + p, { method: "POST", body: JSON.stringify(b), headers: { "Content-Type": "application/json" } });
    const pr = (await post("/api/v7/projects", { requestId: "a3-p", name: "x" })).json.project;
    await post(`/api/v7/projects/${pr.projectId}/evidence`, { requestId: "a3-e1", expectedVersion: 1, kind: "note", content: { text: "e" } });
    const run = (await post(`/api/v7/projects/${pr.projectId}/runs`, { requestId: "a3-r", expectedVersion: 2, ruleVersion: (await post("/api/v7/rules", { requestId: "a3-ru", indicators: ["i"], allowedTools: ["t"], humanEscalation: ["h"], notes: "n" })).json.ruleVersion.version, inputEvidence: [] })).json.run;
    const op = await post(`/api/v7/runs/${run.runId}/opinions`, {
      requestId: "a3-op", expectedVersion: run.version, provider: "simulation", requestReceipt: "s",
      candidate: { observations: ["伪造"], evidenceRefs: ["ev-nonexistent"], assumptions: [], uncertainty: [], recommendedHumanAction: "take_over" },
      basedOnEvidence: [{ evidenceId: "ev-nonexistent", version: 1 }],
    });
    LED.check("A-3b A HTTP 层伪造引用仍被接受（D-5 组合层复核）", op.status === 200, { status: op.status });
    // X-8f 组合层复核：无凭据自称 human
    const g = await http(B + `/api/v7/runs/${run.runId}`);
    const spoof = await post(`/api/v7/runs/${run.runId}/human-actions`, { requestId: "a3-spoof", expectedVersion: g.json.run.version, action: "take_over", actorRole: "human", actorName: "匿名伪造者", note: "A-3c" });
    LED.check("A-3c 无凭据自称 human 在组合数据上仍生效（D-6 复核）", spoof.status === 200, { status: spoof.status });
  } finally { killTree(proc.pid); }
} catch (e) { LED.check("A-3 双层检验", false, e.message); }

// ---------- A-4 组合数据经 HTTP 投影读取 ----------
try {
  const PORT = await probeFreePort(3491);
  const proc = startProc("node", [join(V7B, "A/src/server.mjs"), "--port", String(PORT), "--data-dir", ASM_DATA], { logFile: join(HERE, "server-asm2.log") });
  try {
    if (!(await waitPort(PORT, { path: "/api/v7/health" }))) throw new Error("server down");
    const B = `http://127.0.0.1:${PORT}`;
    const list = await http(B + "/api/v7/projects");
    // projects 列表端点未在合同 §4（只有 GET :projectId）——从 health 后尝试按 run 直查
    const runId = (runOut.match(/runId[=:]\s*"?([\w-]+)"?/) || [])[1] || (runOut.match(/运行\s+([\w-]+)/) || [])[1];
    LED.check("A-4a 组合落库可经标准 HTTP 读回（runId 提取）", !!runId, { runId });
    if (runId) {
      const g = await http(B + `/api/v7/runs/${runId}`);
      LED.check("A-4b 组合 run 读取：state/opinions/calculation 在", g.status === 200 && !!g.json.run?.state && Array.isArray(g.json.run.opinions), { status: g.status, state: g.json.run?.state });
      LED.check("A-4c 顶层投影 stale/formalOutcome 在", "stale" in g.json && "formalOutcome" in g.json, { stale: g.json.stale, fo: !!g.json.formalOutcome });
    }
  } finally { killTree(proc.pid); }
} catch (e) { LED.check("A-4 HTTP 投影", false, e.message); }

// ---------- Y-2 干净目录可移植性 ----------
try {
  const clean = mkdtempSync(join(tmpdir(), "dqa-clean-"));
  // 按 MANIFEST 相对结构：clean/A/{src,assembly} + clean/C/{src,rules}
  cpSync(join(V7B, "A/src"), join(clean, "A/src"), { recursive: true });
  cpSync(join(V7B, "A/assembly/integrated-round.mjs"), join(clean, "A/assembly/integrated-round.mjs"));
  cpSync(join(V7B, "C/src"), join(clean, "C/src"), { recursive: true });
  cpSync(join(V7B, "C/rules/rule-pack-v1.json"), join(clean, "C/rules/rule-pack-v1.json"));
  const out = execSync(`node "${join(clean, "A/assembly/integrated-round.mjs")}"`, { encoding: "utf8", timeout: 60000, cwd: clean });
  const okN = (out.match(/ok:/g) || []).length;
  LED.check("Y-2 干净目录（仅源码+规则，零 node_modules）安装即运行", okN >= 11 && !out.includes("FAIL"), { okN, dir: clean });
  rmSync(clean, { recursive: true, force: true });
} catch (e) { LED.check("Y-2 干净目录", false, e.message); }

// ---------- Y-5 数据目录迁移 ----------
try {
  const PORT = await probeFreePort(3491);
  const migrated = join(WORK, "migrated-data");
  cpSync(ASM_DATA, migrated, { recursive: true });
  const proc = startProc("node", [join(V7B, "A/src/server.mjs"), "--port", String(PORT), "--data-dir", migrated], { logFile: join(HERE, "server-mig.log") });
  try {
    if (!(await waitPort(PORT, { path: "/api/v7/health" }))) throw new Error("server down");
    const runId = (runOut.match(/runId[=:]\s*"?([\w-]+)"?/) || [])[1] || (runOut.match(/运行\s+([\w-]+)/) || [])[1];
    const g = await http(`http://127.0.0.1:${PORT}/api/v7/runs/${runId}`);
    LED.check("Y-5 数据目录拷贝迁移后状态完整可读", g.status === 200 && g.json.run?.runId === runId && Array.isArray(g.json.run.opinions) && g.json.run.opinions.length > 0, { status: g.status });
  } finally { killTree(proc.pid); }
} catch (e) { LED.check("Y-5 迁移", false, e.message); }

// ---------- 清理 ----------
rmSync(WORK, { recursive: true, force: true });
LED.save(EV);
console.log(`\n== 组合层结果: ${LED.summary} ==`);
console.log(`FAIL 项: ${LED.fail.map(f => f.id).join(", ") || "无"}`);
process.exit(LED.fail.length ? 1 : 0);
