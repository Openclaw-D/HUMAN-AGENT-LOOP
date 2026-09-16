// D路发布检测：源码hash漂移 + 3467指纹 + A/B/C交付信号
// 用法: node check_publish.mjs
import { execSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const QA = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // .../qa
const PKG = path.dirname(QA); // REPAIR_20260914_EVENING
const SITE = "C:/Users/22673/Desktop/Anthropic/jianwei-v3/site";
const sha = (s) => createHash("sha256").update(s).digest("hex");

// 1) 源码漂移（对比 A写入前基线）
const baselineText = readFileSync(path.join(QA, "source-baseline-2230.sha256"), "utf8");
const baseline = new Map();
for (const line of baselineText.split("\n")) {
  const m = line.match(/^([0-9a-f]{64}) \*(.+)$/);
  if (m) baseline.set(m[2].replaceAll("\\", "/"), m[1]);
}
const drifted = [];
for (const [rel, old] of baseline) {
  const abs = path.join(SITE, rel);
  if (!existsSync(abs)) { drifted.push(`${rel} :: DELETED`); continue; }
  const cur = sha(readFileSync(abs));
  if (cur !== old) drifted.push(`${rel} :: ${old.slice(0, 8)} -> ${cur.slice(0, 8)}`);
}
console.log(`[source] 基线15文件: ${drifted.length === 0 ? "无漂移（A未写site）" : `漂移 ${drifted.length} 项`}`);
for (const d of drifted) console.log("  " + d);

// 2) 3467 指纹（GET 只读）
try {
  const res = await fetch("http://127.0.0.1:3467/v5-preview", { signal: AbortSignal.timeout(8000) });
  let html = await res.text();
  // 每请求随机值剥离后才是稳定指纹
  const stable = html.replace(/self\.__next_r="[^"]*"/g, "");
  const fp = sha(stable).slice(0, 16);
  const cssChunk = (stable.match(/se-overview_module_[a-z0-9]+\.css/) || ["?"])[0];
  console.log(`[3467] GET /v5-preview ${res.status} 稳定指纹=${fp} 基准(22:45剥离随机值)=f6b4c707f872c320 ${fp === "f6b4c707f872c320" ? "(未变)" : "(已变!)"} CSS=${cssChunk}`);
  const res2 = await fetch("http://127.0.0.1:3467/v5-preview/remote-session", { signal: AbortSignal.timeout(8000) });
  console.log(`[3467] GET /remote-session ${res2.status}`);
} catch (e) {
  console.log(`[3467] 不可达: ${e.message}`);
}

// 3) A/B/C 交付信号
for (const [dir, files] of [
  ["main", ["BASELINE_GATE.md", "INTERFACE.md", "STATUS.md", "RESULT.md", "ADOPTION.md"]],
  ["home", null], ["remote", null],
]) {
  const abs = path.join(PKG, dir);
  if (!existsSync(abs)) { console.log(`[pkg/${dir}] 不存在`); continue; }
  const entries = readdirSync(abs).join(", ");
  console.log(`[pkg/${dir}] 存在: ${entries}`);
  if (files) for (const f of files) {
    const fp2 = path.join(abs, f);
    if (existsSync(fp2)) {
      const t = readFileSync(fp2, "utf8");
      const testable = /可测|可复测|发布|可验收/.test(t);
      console.log(`  -> ${f} 存在(${t.length}B)${testable ? " 含可测/发布字样" : ""}`);
    }
  }
}
