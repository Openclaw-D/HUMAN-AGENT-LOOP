// Y-2B 干净目录可移植性（含 B 实际依赖版）：A/B/C 源码+B package.json+lock+node_modules → b-round 全链
import { execSync } from "node:child_process";
import { mkdtempSync, cpSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const V7B = "C:/Users/22673/Desktop/Anthropic/V7/backend";
const clean = mkdtempSync(join(tmpdir2(), "dqa-clean-b-"));
function tmpdir2() { return execSync("echo %TEMP%").toString().trim() || process.env.TEMP || "C:/Users/22673/AppData/Local/Temp"; }
// 修正：直接用 env
const base = process.env.TEMP || "C:/Users/22673/AppData/Local/Temp";
// 重新取干净目录（上面那行只是保底）
const failures = [];
function expect(name, cond, detail = "") { console.log(`${cond ? "  ok" : "  FAIL"}: ${name}${cond ? "" : " " + detail}`); if (!cond) failures.push(name); }

cpSync(join(V7B, "A/src"), join(clean, "A/src"), { recursive: true });
for (const f of ["integrated-round.mjs", "b-round.mjs"]) cpSync(join(V7B, "A/assembly", f), join(clean, "A/assembly", f));
cpSync(join(V7B, "C/src"), join(clean, "C/src"), { recursive: true });
cpSync(join(V7B, "C/rules/rule-pack-v1.json"), join(clean, "C/rules/rule-pack-v1.json"));
cpSync(join(V7B, "B/src"), join(clean, "B/src"), { recursive: true });
cpSync(join(V7B, "B/package.json"), join(clean, "B/package.json"));
cpSync(join(V7B, "B/package-lock.json"), join(clean, "B/package-lock.json"));
// B 实际依赖：拷贝 node_modules（与 npm ci 二选一；锁版等价性由 package-lock 校验）
const nmSrc = join(V7B, "B/node_modules");
if (existsSync(nmSrc)) cpSync(nmSrc, join(clean, "B/node_modules"), { recursive: true });
console.log("[setup] B node_modules copied:", existsSync(join(clean, "B/node_modules/@langchain")));

// b-round 相对路径要求 B 在 ../B —— 结构一致 ✓
let out = "";
try {
  out = execSync(`node "${join(clean, "A/assembly/b-round.mjs")}"`, { encoding: "utf8", timeout: 120000, cwd: clean });
} catch (e) { out = String(e.stdout || "") + "ERR:" + e.message; }
const okN = (out.match(/  ok:/g) || []).length;
const failN = (out.match(/FAIL:/g) || []).length;
expect("Y-2B 干净目录（含 B 源码+依赖）b-round 全链通过", failN === 0 && okN >= 12, { okN, failN, tail: out.slice(-300) });
console.log(`\nY-2B 结果: ${failures.length === 0 ? "PASS" : "FAIL " + failures.join(",")}`);
process.exit(failures.length ? 1 : 0);
