#!/usr/bin/env node
/**
 * v4life-gate.mjs — V4 后端一键快速门禁。
 *
 * 用法:
 *   node scripts/v4life-gate.mjs          # 快速门禁: v4life 专注测试 + HTTP 质量门 + typecheck
 *   node scripts/v4life-gate.mjs --full   # 追加: 全量 npm test + npm run lint
 *
 * 行为:
 *   - 每步实时透传子进程 stdout/stderr;
 *   - 任一步失败不短路, 继续跑完剩余步骤;
 *   - 末尾打印汇总表 (每步 PASS/FAIL + 耗时 + 总耗时);
 *   - 退出码: 0 = 全绿, 1 = 任一步失败, 130 = 用户 Ctrl+C 中断。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';

/** @type {import('node:child_process').ChildProcess | null} */
let currentChild = null;
let interrupted = false;

/* ---------------------------------------------------------------- utils */

const line = (s = '') => console.log(s);
const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`);

function pad(str, width) {
  return String(str).length >= width ? String(str) : String(str) + ' '.repeat(width - String(str).length);
}

/* ------------------------------------------------- subprocess bootstrap */

/**
 * 规格要求 Windows 下 spawn `npm.cmd` 且 shell:false。
 * Node >= 18.20 / 20.12 / 22 (CVE-2024-27980) 对 .cmd/.bat 无 shell 直接 spawn
 * 会同步抛 EINVAL, 这里捕获后回退为 cross-spawn 同款模式:
 *   spawn(ComSpec, ['/d','/s','/c', `"cmd args"`], { shell:false, windowsVerbatimArguments:true })
 * 对调用方仍然等价于 "npm.cmd <args>, shell:false"。
 */
function spawnWithCmdFallback(cmd, args, options) {
  try {
    return spawn(cmd, args, { shell: false, ...options });
  } catch (err) {
    if (IS_WIN && err && err.code === 'EINVAL' && /\.cmd$/i.test(cmd)) {
      const comspec = process.env.ComSpec || 'cmd.exe';
      const needsQuote = (s) => /[\s"]/.test(s);
      const q = (s) => (needsQuote(s) ? `"${s}"` : s);
      const commandLine = [cmd, ...args].map(q).join(' ');
      return spawn(comspec, ['/d', '/s', '/c', `"${commandLine}"`], {
        shell: false,
        ...options,
        windowsVerbatimArguments: true,
      });
    }
    throw err;
  }
}

/** Windows: 在 PATH 中定位 npm.cmd, 找不到返回 null (用于给出明确错误)。 */
function findNpmCmd() {
  const dirs = [];
  if (process.env.PATH) dirs.push(...process.env.PATH.split(path.delimiter).filter(Boolean));
  dirs.push(path.dirname(process.execPath)); // 兜底: node 安装目录本身
  for (const dir of dirs) {
    const candidate = path.join(dir, 'npm.cmd');
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* not here, keep scanning */
    }
  }
  return null;
}

/**
 * 运行一条命令, 实时透传输出。resolve 为 { code, signal, error, failed }。
 * spawn 失败 (如 ENOENT) 不抛异常, 转为 failed 结果并带明确错误信息。
 */
function runCommand(cmd, args, { failHint = '' } = {}) {
  return new Promise((resolve) => {
    /** @type {{code: number|null, signal: string|null, error?: Error}} */
    let result = { code: null, signal: null };
    let settled = false;
    const finish = (patch) => {
      if (settled) return;
      settled = true;
      currentChild = null;
      resolve({ ...result, ...patch, failed: patch.error != null || (patch.code ?? 0) !== 0 || patch.signal != null });
    };

    let child;
    try {
      child = spawnWithCmdFallback(cmd, args, { cwd: ROOT, stdio: 'inherit', windowsHide: true });
    } catch (err) {
      finish({ code: 1, error: err });
      return;
    }
    currentChild = child;

    child.on('error', (err) => {
      const code = err && err.code === 'ENOENT' ? 127 : 1;
      finish({ code, error: err, signal: null, failHint: failHint || undefined });
    });
    child.on('close', (code, signal) => {
      if (interrupted && signal) finish({ code: null, signal });
      else finish({ code: code ?? (signal ? 1 : 1), signal });
    });
  });
}

/** node 脚本: 用 process.execPath, 不会 ENOENT。 */
const runNode = (args, opts = {}) => runCommand(process.execPath, args, opts);

/** npm 命令: Windows 用 npm.cmd (规格要求, shell:false; EINVAL 自动回退), 其他平台用 npm。 */
function runNpm(args, opts = {}) {
  if (!IS_WIN) return runCommand('npm', args, opts);
  const npmCmd = findNpmCmd();
  if (!npmCmd) {
    line(`[v4life-gate] 错误: 在 PATH 中找不到 npm.cmd。请确认 Node.js/npm 已安装并加入 PATH。`);
    return Promise.resolve({ code: 127, signal: null, error: new Error('npm.cmd not found on PATH'), failed: true });
  }
  return runCommand(npmCmd, args, opts);
}

/* ----------------------------------------------------------- step impls */

/** Step 1: 动态收集 test/v4life-*.test.mjs (不写死列表), 交给 node:test。 */
function collectV4lifeTests() {
  const testDir = path.join(ROOT, 'test');
  if (!fs.existsSync(testDir)) {
    return { error: `测试目录不存在: ${testDir}` };
  }
  const files = fs
    .readdirSync(testDir, { withFileTypes: true })
    .filter((e) => e.isFile() && /^v4life-.*\.test\.mjs$/.test(e.name))
    .map((e) => path.join(testDir, e.name))
    .sort();
  if (files.length === 0) {
    return { error: `在 ${testDir} 下没有匹配 ^v4life-.*\\.test\\.mjs$ 的测试文件` };
  }
  return { files };
}

const steps = [];

function buildSteps(full) {
  steps.push({
    name: 'v4life 专注测试',
    run: () => {
      const { files, error } = collectV4lifeTests();
      if (error) {
        line(`[v4life-gate] Step 1 收集测试文件失败: ${error}`);
        return Promise.resolve({ code: 1, signal: null, error: new Error(error), failed: true });
      }
      line(`[v4life-gate] Step 1 收集到 ${files.length} 个 v4life 测试文件:`);
      for (const f of files) line(`  - ${path.relative(ROOT, f)}`);
      return runNode(['--experimental-strip-types', '--test', '--experimental-test-isolation=none', ...files]);
    },
  });
  steps.push({
    name: 'HTTP 质量门',
    run: () => runNode(['scripts/v4life-http-quality.mjs']),
  });
  steps.push({
    name: 'typecheck (tsc --noEmit)',
    run: () => runNpm(['run', 'typecheck']),
  });
  if (full) {
    steps.push({
      name: '全量测试 (npm test)',
      run: () => runNpm(['test']),
    });
    steps.push({
      name: 'lint (eslint)',
      run: () => runNpm(['run', 'lint']),
    });
  }
}

/* --------------------------------------------------------------- Ctrl+C */

process.on('SIGINT', () => {
  if (interrupted) return;
  interrupted = true;
  line('\n[v4life-gate] 收到 Ctrl+C, 正在中止当前步骤…');
  const child = currentChild;
  if (child && child.exitCode === null && !child.killed) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* child already gone */
    }
  }
});

/* ----------------------------------------------------------------- main */

async function main() {
  const argv = process.argv.slice(2);
  const full = argv.includes('--full') || argv.includes('-f');
  const unknown = argv.filter((a) => a !== '--full' && a !== '-f');
  if (unknown.length > 0) {
    line(`[v4life-gate] 警告: 忽略未知参数: ${unknown.join(' ')}`);
  }

  buildSteps(full);

  line('================================================================');
  line(` V4 LIFE GATE — 共 ${steps.length} 步${full ? ' (--full)' : ' (快速模式, 用 --full 追加全量测试与 lint)'}`);
  line(` 工作目录: ${ROOT}`);
  line('================================================================');

  const results = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    line('');
    line(`===== [${i + 1}/${steps.length}] ${step.name} =====`);
    const t0 = Date.now();
    const r = await step.run();
    const ms = Date.now() - t0;
    results.push({ index: i + 1, name: step.name, ms, ...r });
    const status = r.failed ? 'FAIL' : 'PASS';
    line(`----- [${i + 1}/${steps.length}] ${step.name} => ${status} (${fmtMs(ms)}) -----`);
    if (r.error) {
      line(`[v4life-gate] 子进程错误: ${r.error.message}`);
      if (r.error.code === 'ENOENT') {
        line('[v4life-gate] 可执行文件不存在 (node/npm 未安装或不在 PATH), 请检查环境。');
      }
    }
    if (interrupted) break; // Ctrl+C: 不再继续剩余步骤
  }

  const totalMs = results.reduce((s, r) => s + r.ms, 0);
  const passCount = results.filter((r) => !r.failed).length;
  const anyFail = passCount !== results.length;

  line('');
  line('================================================================');
  line(' V4 LIFE GATE 汇总');
  line('================================================================');
  line(` ${pad('#', 3)}${pad('步骤', 28)}${pad('结果', 7)}耗时`);
  for (const r of results) {
    line(` ${pad(r.index, 3)}${pad(r.name, 28)}${pad(r.failed ? 'FAIL' : 'PASS', 7)}${fmtMs(r.ms)}`);
  }
  line('----------------------------------------------------------------');
  line(` 总耗时: ${fmtMs(totalMs)}    通过: ${passCount}/${results.length}`);
  if (interrupted) {
    line(' 结果: INTERRUPTED (用户 Ctrl+C 中断)');
    process.exitCode = 130;
  } else {
    line(anyFail ? ' 结果: FAILED (存在失败步骤)' : ' 结果: ALL GREEN');
    process.exitCode = anyFail ? 1 : 0;
  }
}

main().catch((err) => {
  console.error(`[v4life-gate] 未预期的脚本错误: ${err && err.stack ? err.stack : err}`);
  process.exitCode = 1;
});
