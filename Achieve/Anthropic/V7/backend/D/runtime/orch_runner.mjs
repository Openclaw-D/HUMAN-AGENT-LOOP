// D路 编排 kill-recover 子进程 runner（v2）
// 用法: node orch_runner.mjs --mode start|recover --data-dir <dir> --a-port <port> --run-id <id> --mark-dir <dir> --project-id <pid> --rule-version <n>
// mode start: 慢 adapter（入口写 ADAPTER_ENTERED 标记后停 3s——intent 已落 journal 的窗口）供主套件 kill。
// mode recover: 同 dataDir 重建编排器 → recover(runId) 重放 → 输出模型步状态与恢复进程 adapter 调用数 → continueRun。
import { pathToFileURL } from "node:url";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > -1 ? process.argv[i + 1] : d; };
const mode = arg("mode", "start");
const dataDir = arg("data-dir");
const aPort = arg("a-port");
const runId = arg("run-id");
const markDir = arg("mark-dir");
const projectId = arg("project-id");
const ruleVersion = arg("rule-version", "1");

const V7B = "C:/Users/22673/Desktop/Anthropic/V7/backend";
const u = (p) => pathToFileURL(p).href;
const { createAClient } = await import(u(`${V7B}/B/src/a-sync.mjs`));
const { createLocalPorts } = await import(u(`${V7B}/B/src/ports.mjs`));
const { createThinOrchestrator } = await import(u(`${V7B}/B/src/thin/orchestrator.mjs`));
const { createCToolsAdapter } = await import(u(`${V7B}/B/src/c-tools.mjs`));
const { calculateCashFlowCoverage } = await import(u(`${V7B}/C/src/calculation-tool.mjs`));

let adapterCalls = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const a = createAClient({ baseUrl: `http://127.0.0.1:${aPort}` });
const evidenceRefs = JSON.parse(arg("evidence-refs", "[]"));
const toolInputs = JSON.parse(arg("tool-inputs", "{}"));

function buildAdapter(slow) {
  return {
    async analyze(request) {
      adapterCalls += 1;
      if (slow) writeFileSync(join(markDir, "ADAPTER_ENTERED"), `calls=${adapterCalls} at=${Date.now()}`);
      if (slow) await sleep(3000);
      return {
        status: "simulated",
        findings: [{ text: `（模拟）${request.purpose}`, role: request.role }],
        questions: [], evidenceRefs: (request.evidenceRefs ?? []).map((e) => ({ id: String(e.id), version: Number(e.version) })),
        costLedger: { reservationState: "released" }, deduped: false,
      };
    },
  };
}
function buildOrchestrator(adapter) {
  const factStore = {
    async currentVersions(pid) {
      const view = await a.getProject(pid);
      return { factVersion: String(view.projectFactVersion), ruleVersion };
    },
  };
  const ports = createLocalPorts({ dataDir, factStore, tools: createCToolsAdapter({ calculationTool: { calculateCashFlowCoverage } }) });
  return createThinOrchestrator({ ports, adapter, dataDir, sinks: [], logger: () => {} });
}

if (mode === "start") {
  const orchestrator = buildOrchestrator(buildAdapter(true));
  (async () => { while (!existsSync(join(markDir, "ADAPTER_ENTERED"))) await sleep(80); })();
  try {
    const view = await orchestrator.start({ runId, projectId, eventType: "ratio_query", evidenceRefs, toolInputs });
    console.log(`STARTED terminal=${JSON.stringify(view.terminal)} adapterCalls=${adapterCalls}`);
  } catch (e) { console.log(`START_ERROR ${e.message}`); }
  console.log(`ADAPTER_CALLS=${adapterCalls}`);
  await sleep(30000);
  process.exit(0);
}

if (mode === "recover") {
  const orchestrator = buildOrchestrator(buildAdapter(false));
  const view = await orchestrator.recover(runId);
  const modelStep = (view.steps || []).find((s) => s.kind === "model");
  console.log(`RECOVERED modelStepState=${modelStep?.state} adapterCallsAfterRecover=${adapterCalls}`);
  let v2 = view;
  try { v2 = await orchestrator.continueRun(runId); } catch (e) { console.log(`CONTINUE_ERROR ${e.message}`); }
  const m2 = (v2.steps || []).find((s) => s.kind === "model");
  console.log(`AFTER_CONTINUE modelStepState=${m2?.state} terminal=${JSON.stringify(v2.terminal)} adapterCallsTotal=${adapterCalls}`);
  const jp = join(dataDir, "runs", encodeURIComponent(runId), "journal.jsonl");
  console.log(`JOURNAL_EVENTS=${existsSync(jp) ? readFileSync(jp, "utf8").split("\n").filter(Boolean).length : 0}`);
  process.exit(0);
}
