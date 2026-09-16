// D路 最终轮：manifest 覆盖审计 + 凭据泄漏反证（B resume-core 异常路径）
// 用法: node final_audit.mjs
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, cpSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { probeFreePort, waitPort, startProc, killTree, Ledger, caseBounded, http, delay } from "./harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const V7B = "C:/Users/22673/Desktop/Anthropic/V7/backend";
const EV = join(HERE, "..", "evidence");
const u = (p) => pathToFileURL(p).href;
const LED = new Ledger("final-audit");
const TOKEN = "dqa-synthetic-credential-MARKER-x7f3";

// ---------- M-1 manifest 逐项核对 ----------
try {
  const mf = readFileSync(join(V7B, "A/assembly/manifest-hashes.sha256"), "utf8").split("\n").filter((l) => l.trim());
  let match = 0, mismatch = [], missing = [];
  for (const line of mf) {
    const [h, rel] = line.trim().split(/\s+/).filter(Boolean).map((x) => x.replace(/^\*/, ""));
    const abs = join(V7B, rel);
    if (!existsSync(abs)) { missing.push(rel); continue; }
    const cur = createHash("sha256").update(readFileSync(abs)).digest("hex");
    if (cur === h) match += 1; else mismatch.push(rel);
  }
  LED.check(`M-1a manifest 23 项逐项核对（match=${match}）`, match === mf.length && mismatch.length === 0 && missing.length === 0, { total: mf.length, match, mismatch, missing });
  // M-1b 覆盖缺口：assembly 依赖图实际需要的文件 vs manifest
  const registered = new Set(mf.map((l) => l.trim().split(/\s+/).pop().replace(/^\*\*/, "").replace(/^\*/, "")));
  const required = [];
  // 解析 assembly 各脚本的 import（本地相对引用 → 实际文件）
  for (const script of ["integrated-round.mjs", "b-round.mjs", "lg-round.mjs", "recovery-round.mjs"]) {
    const src = readFileSync(join(V7B, "A/assembly", script), "utf8");
    for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      let rel = m[1];
      let abs = join(V7B, "A/assembly", rel);
      if (!existsSync(abs)) abs = join(V7B, "A", rel); // ../src/.. 从 A/ 出发
      if (!existsSync(abs)) abs = join(V7B, rel);      // ../../C|B 从 A/assembly 出发
      if (existsSync(abs) && abs.endsWith(".mjs")) required.push(relative(V7B, abs).replaceAll("\\", "/"));
    }
  }
  // 传递闭包：对每个已收集文件再解析其相对 import（2 跳）
  const uniqReq = [...new Set(required)].sort();
  for (const f of [...uniqReq]) {
    const src = readFileSync(join(V7B, f), "utf8");
    const base = join(V7B, f, "..");
    for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      let abs = join(base, m[1]);
      if (!existsSync(abs)) abs = abs.replace(/\.mjs$/, ".js");
      if (existsSync(abs) && abs.endsWith(".mjs")) {
        const rel = relative(V7B, abs).replaceAll("\\", "/");
        if (!uniqReq.includes(rel)) uniqReq.push(rel);
      }
    }
  }
  const uniqAll = [...new Set(uniqReq)].sort();
  const gaps = uniqAll.filter((r) => !registered.has(r));
  LED.check("M-1b assembly 传递依赖闭包 vs manifest 覆盖", gaps.length === 0, { gaps, requiredCount: uniqAll.length });
  // M-1c 锁定依赖：package.json/package-lock 是否在 manifest
  const depFiles = ["B/package.json", "B/package-lock.json"];
  const depGaps = depFiles.filter((f) => !registered.has(f));
  LED.check("M-1c 锁定依赖文件在 manifest（锁定版本可追溯）", depGaps.length === 0, { depGaps });
  LED.note(`M-1 汇总：registered=${mf.length} match=${match} missing=${missing.length} mismatch=${mismatch.length} depGaps=${JSON.stringify(depGaps)} importGaps=${JSON.stringify(gaps)}`);
} catch (e) { LED.check("M-1 manifest 审计", false, e.message); }

// ---------- L-1 凭据泄漏反证（B resume-core 异常路径，合成标记） ----------
try {
  const { createLocalPorts } = await import(u(join(V7B, "B/src/ports.mjs")));
  const { createThinOrchestrator } = await import(u(join(V7B, "B/src/thin/orchestrator.mjs")));
  const { createAClient, createARunSink } = await import(u(join(V7B, "B/src/a-sync.mjs")));
  const { createCToolsAdapter } = await import(u(join(V7B, "B/src/c-tools.mjs")));
  const { calculateCashFlowCoverage } = await import(u(join(V7B, "C/src/calculation-tool.mjs")));
  const { startServer } = await import(u(join(V7B, "A/src/server.mjs")));
  const rid = () => "dqa-leak-" + Math.random().toString(16).slice(2, 8);

  const PORT2 = await probeFreePort(3491);
  const srv = startProc("node", [join(V7B, "A/src/server.mjs"), "--port", String(PORT2), "--data-dir", join(HERE, "leak-a-data"), "--principal-tokens", TOKEN], { logFile: join(HERE, "leak-server.log") });
  if (!(await waitPort(PORT2, { path: "/api/v7/health" }))) throw new Error("server down");
  const a = createAClient({ baseUrl: `http://127.0.0.1:${PORT2}` });

  const bData = mkdtempSync(join(tmpdir2(), "dqa-leak-b-"));
  // 验证器异常消息内嵌合成凭据标记（模拟真实世界"错误信息里带了密钥"）
  const throwingVerifier = (credential, c) => { throw new Error(`verifier backend unreachable while checking credential=${credential} project=${c?.projectId}`); };
  const factStore = { async currentVersions(pid) { const v = await a.getProject(pid); return { factVersion: String(v.projectFactVersion), ruleVersion: "1" }; } };
  const rule = (await a.publishRule({ requestId: rid(), indicators: ["i"], allowedTools: ["t"], humanEscalation: ["h"], notes: "leak" })).ruleVersion;
  const project = (await a.createProject({ requestId: rid(), name: "leak" })).project;
  const e1 = (await a.attachEvidence(project.projectId, { requestId: rid(), expectedVersion: 1, kind: "note", content: { text: "x" } })).evidence.evidenceId;
  const aRun = (await a.createRun(project.projectId, { requestId: rid(), expectedVersion: 2, ruleVersion: rule.version, inputEvidence: [{ evidenceId: e1, version: 1 }] })).run;
  const sink = createARunSink({ aClient: a, aRunId: aRun.runId, logger: () => {} });
  const ports = createLocalPorts({ dataDir: bData, factStore, tools: createCToolsAdapter({ calculationTool: { calculateCashFlowCoverage } }) });
  const orch = createThinOrchestrator({ ports, adapter: { async analyze() { return { status: "unknown", findings: [], questions: [], evidenceRefs: [], costLedger: {}, deduped: false }; } }, dataDir: bData, sinks: [sink], logger: () => {}, principalVerifier: throwingVerifier });
  await orch.start({ runId: "b-leak", projectId: project.projectId, eventType: "ratio_query", evidenceRefs: [{ id: e1, version: 1 }], toolInputs: { monthlyOperatingCashFlow: { value: 1, caliber: "x", source: { evidenceId: e1, version: 1 } }, monthlyDebtService: { value: 1, caliber: "x", source: { evidenceId: e1, version: 1 } }, currency: "CNY", periodMonths: 1 } });

  // 恢复（验证器抛异常，异常文本内嵌凭据标记）
  let resumeErr = null;
  try { await orch.resume("b-leak", { principalCredential: TOKEN, action: "retry_step", stepId: "model", payload: {} }); } catch (e) { resumeErr = e.message || String(e); }
  const inErrMsg = resumeErr ? resumeErr.includes(TOKEN) : false;
  LED.check("L-1a 验证器异常文本内嵌凭据 → 传播进 resume 错误消息", inErrMsg === true, { leakInMessage: inErrMsg, head: (resumeErr || "").slice(0, 160) });
  // journal/snapshot 持久化面扫描
  let persisted = [];
  const scan = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) scan(p); else { try { const c = readFileSync(p, "utf8"); if (c.includes(TOKEN)) { const i = c.indexOf(TOKEN); persisted.push({ file: p, snippet: c.slice(Math.max(0, i - 100), i + 40) }); } } catch {} } } };
  scan(bData);
  LED.check("L-1b B journal/snapshot 落盘文件无凭据明文", persisted.length === 0, persisted);
  // A 侧存储扫描（resume 失败不应写 A）
  let aPersisted = [];
  scan2(join(HERE, "leak-a-data"));
  function scan2(d) { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) aPersisted = aPersisted.concat(scan2(p)); else { try { if (readFileSync(p, "utf8").includes(TOKEN)) aPersisted.push(p); } catch {} } } }
  LED.check("L-1c A 存储无凭据明文", aPersisted.length === 0, aPersisted);
  // A HTTP 门：错误凭据的 403 响应体不含凭据回显
  const r = await http(`http://127.0.0.1:${PORT2}/api/v7/runs/${aRun.runId}/human-actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: rid(), expectedVersion: aRun.version, action: "take_over", actorRole: "human", actorName: "x", note: TOKEN, principalCredential: "wrong-cred-" + TOKEN.slice(0, 8) }) });
  LED.check("L-1d A 403 响应体不回显凭据", !(r.text || "").includes(TOKEN) && !(r.text || "").includes("wrong-cred-"), (r.text || "").slice(0, 120));
  // A 服务器日志扫描
  const slog = readFileSync(join(HERE, "leak-server.log"), "utf8");
  LED.check("L-1e A 服务器日志无凭据明文", !slog.includes(TOKEN));
  killTree(srv.pid);

  function tmpdir2() { return process.env.TEMP || "C:/Users/22673/AppData/Local/Temp"; }
} catch (e) { LED.check("L-1 凭据泄漏反证", false, e.message); }
function tmpdir2() { return process.env.TEMP || "C:/Users/22673/AppData/Local/Temp"; }

// ---------- Y-2D 干净目录（recovery-round + B 实际依赖；拷贝≠干净安装≠跨机器） ----------
try {
  const clean = mkdtempSync(join(tmpdir2(), "dqa-final-clean-"));
  cpSync(join(V7B, "A/src"), join(clean, "A/src"), { recursive: true });
  for (const f of ["integrated-round.mjs", "b-round.mjs", "lg-round.mjs", "recovery-round.mjs"]) cpSync(join(V7B, "A/assembly", f), join(clean, "A/assembly", f));
  cpSync(join(V7B, "A/assembly/manifest-hashes.sha256"), join(clean, "A/assembly/manifest-hashes.sha256"));
  cpSync(join(V7B, "C/src"), join(clean, "C/src"), { recursive: true });
  cpSync(join(V7B, "C/rules/rule-pack-v1.json"), join(clean, "C/rules/rule-pack-v1.json"));
  cpSync(join(V7B, "C/cases"), join(clean, "C/cases"), { recursive: true });
  cpSync(join(V7B, "B/src"), join(clean, "B/src"), { recursive: true });
  cpSync(join(V7B, "B/package.json"), join(clean, "B/package.json"));
  cpSync(join(V7B, "B/package-lock.json"), join(clean, "B/package-lock.json"));
  if (existsSync(join(V7B, "B/node_modules"))) cpSync(join(V7B, "B/node_modules"), join(clean, "B/node_modules"), { recursive: true });
  const hasDeps = existsSync(join(clean, "B/node_modules/@langchain/langgraph"));
  let out = "";
  try { out = execSync(`node "${join(clean, "A/assembly/recovery-round.mjs")}"`, { encoding: "utf8", timeout: 180000, cwd: clean }); }
  catch (e) { out = String(e.stdout || "") + "ERR:" + e.message; }
  const okN = (out.match(/  ok:/g) || []).length;
  const failN = (out.match(/FAIL:/g) || []).length;
  LED.check("Y-2D 干净目录（含 B 实际依赖）recovery-round 全链通过", failN === 0 && okN >= 24 && hasDeps, { okN, failN, hasDeps, label: "复制已有 node_modules ≠ npm 干净安装 ≠ 第二机器证明（如实标注）" });
  rmSync(clean, { recursive: true, force: true });
} catch (e) { LED.check("Y-2D 干净目录", false, e.message); }

LED.save(EV);
console.log(`\n== 最终审计结果: ${LED.summary} ==`);
console.log(`FAIL 项: ${LED.fail.map(f => f.id).join(", ") || "无"}`);
process.exit(LED.fail.length ? 1 : 0);
