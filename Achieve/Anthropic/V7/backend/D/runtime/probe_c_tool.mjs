import { pathToFileURL } from "node:url";
const m = await import(pathToFileURL("C:/Users/22673/Desktop/Anthropic/V7/backend/C/src/calculation-tool.mjs").href);
const r = m.calculateCashFlowCoverage({
  monthlyOperatingCashFlow: { value: 120000, caliber: "月均", source: { evidenceId: "ev-a", version: 1 } },
  monthlyDebtService: { value: 100000, caliber: "月供", source: { evidenceId: "ev-b", version: 1 } },
  currency: "CNY", periodMonths: 1,
});
console.log("ok:", r.ok);
console.log("result keys:", Object.keys(r.result || {}));
console.log("tool:", r.result?.tool, "| formulaVersion:", r.result?.formulaVersion, "| toolVersion:", r.result?.toolVersion);
console.log("coverage:", JSON.stringify(r.result?.coverage ?? r.result?.ratio));
