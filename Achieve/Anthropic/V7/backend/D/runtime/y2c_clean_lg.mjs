// Y-2C 干净目录（含 B 实际依赖）× 最终组合 lg-round
import { execSync } from "node:child_process";
import { mkdtempSync, cpSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const V7B = "C:/Users/22673/Desktop/Anthropic/V7/backend";
const base = process.env.TEMP || "C:/Users/22673/AppData/Local/Temp";
const clean = mkdtempSync(join(base, "dqa-clean-lg-"));
cpSync(join(V7B, "A/src"), join(clean, "A/src"), { recursive: true });
for (const f of ["integrated-round.mjs", "b-round.mjs", "lg-round.mjs"]) cpSync(join(V7B, "A/assembly", f), join(clean, "A/assembly", f));
cpSync(join(V7B, "C/src"), join(clean, "C/src"), { recursive: true });
cpSync(join(V7B, "C/rules/rule-pack-v1.json"), join(clean, "C/rules/rule-pack-v1.json"));
cpSync(join(V7B, "B/src"), join(clean, "B/src"), { recursive: true });
cpSync(join(V7B, "B/package.json"), join(clean, "B/package.json"));
cpSync(join(V7B, "B/package-lock.json"), join(clean, "B/package-lock.json"));
if (existsSync(join(V7B, "B/node_modules"))) cpSync(join(V7B, "B/node_modules"), join(clean, "B/node_modules"), { recursive: true });
console.log("[setup] B node_modules:", existsSync(join(clean, "B/node_modules/@langchain")));

let out = "", failures = [];
try {
  out = execSync(`node "${join(clean, "A/assembly/lg-round.mjs")}"`, { encoding: "utf8", timeout: 180000, cwd: clean });
} catch (e) { out = String(e.stdout || "") + "ERR:" + e.message; }
const okN = (out.match(/  ok:/g) || []).length;
const failN = (out.match(/FAIL:/g) || []).length;
console.log(`ok=${okN} FAIL=${failN}`);
if (failN > 0 || okN < 8) { console.log(out.slice(-600)); failures.push("lg-round not green"); }
console.log(`Y-2C 结果: ${failures.length === 0 ? "PASS" : "FAIL " + failures.join(",")}`);
process.exit(failures.length ? 1 : 0);
