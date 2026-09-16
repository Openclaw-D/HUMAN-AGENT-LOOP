// D路 有界测试 runner + 故障注入助手（接口无关，合同发布后复用）
// 设计约束：所有 I/O 有界超时；PASS/FAIL 台账 + JSON 输出；无自动重试（调用方自行决定）。
import { spawn, execSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readdirSync } from "node:fs";
import net from "node:net";

export const DEFAULTS = { httpTimeoutMs: 10_000, procTimeoutMs: 30_000, caseTimeoutMs: 60_000 };
export { existsSync, mkdirSync, writeFileSync, appendFileSync, readdirSync, delay };

// ---- 有界 HTTP ----
export async function http(url, { method = "GET", body, headers, timeoutMs = DEFAULTS.httpTimeoutMs } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
    return { status: res.status, json, text };
  } finally { clearTimeout(timer); }
}

// ---- 端口探测/等待 ----
export function probeFreePort(start = 3490, end = 3499) {
  return new Promise((resolve, reject) => {
    const tryPort = (p) => {
      const srv = net.createServer();
      srv.once("error", () => (p < end ? tryPort(p + 1) : reject(new Error("no free port 3490-3499"))));
      srv.once("listening", () => srv.close(() => resolve(p)));
      srv.listen(p, "127.0.0.1");
    };
    tryPort(start);
  });
}
export async function waitPort(port, { timeoutMs = DEFAULTS.procTimeoutMs, path = "/" } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await http(`http://127.0.0.1:${port}${path}`, { timeoutMs: 2000 }); return true; }
    catch { await delay(400); }
  }
  return false;
}

// ---- 进程故障注入 ----
export function startProc(cmd, args, { cwd, env, logFile } = {}) {
  if (logFile) mkdirSync(logFile.replace(/[/\\][^/\\]+$/, ""), { recursive: true });
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", logFile ? "pipe" : "ignore", logFile ? "pipe" : "ignore"] });
  if (logFile && child.stdout) {
    child.stdout.on("data", (d) => appendFileSync(logFile, d));
    child.stderr.on("data", (d) => appendFileSync(logFile, d));
  }
  return child;
}
export function killTree(pid) {
  try { execSync(`taskkill /T /F /PID ${pid}`, { stdio: "ignore" }); }
  catch { try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ } }
}

// ---- 台账 ----
export class Ledger {
  constructor(name) { this.name = name; this.pass = []; this.fail = []; this.notes = []; this.t0 = Date.now(); this.suiteError = null; }
  markSuiteError(msg) { this.suiteError = String(msg).slice(0, 300); }
  check(id, cond, detail = "", cls = "工程") {
    (cond ? this.pass : this.fail).push({ id, cls, detail: typeof detail === "string" ? detail.slice(0, 400) : detail });
    console.log(`[${cond ? "PASS" : "FAIL"}] ${id}${cond ? "" : " | " + JSON.stringify(detail).slice(0, 300)}`);
  }
  note(msg) { this.notes.push({ at: new Date().toISOString(), msg }); console.log("[note]", msg); }
  save(outDir) {
    mkdirSync(outDir, { recursive: true });
    const out = { name: this.name, at: new Date().toISOString(), durationMs: Date.now() - this.t0, suiteError: this.suiteError, pass: this.pass, fail: this.fail, notes: this.notes };
    writeFileSync(`${outDir}/${this.name}.json`, JSON.stringify(out, null, 2));
    return out;
  }
  get summary() { return `PASS=${this.pass.length} FAIL=${this.fail.length}`; }
}

// ---- 有界用例包装 ----
export async function caseBounded(fn, { timeoutMs = DEFAULTS.caseTimeoutMs } = {}) {
  return Promise.race([
    fn(),
    delay(timeoutMs).then(() => { throw new Error(`CASE_TIMEOUT ${timeoutMs}ms`); }),
  ]);
}

export { existsSync as exists };
