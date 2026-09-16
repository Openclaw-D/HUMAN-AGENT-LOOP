// V5 ROWS_FULLSTACK 重启恢复与存储损坏回归（Verification worker 独占写面）。
// 被测冻结接口：V5/handoff/ROWS_FULLSTACK/IMPLEMENTATION.md §1/§2/§6（FROZEN 2026-09-11）。
//   持久化：单进程 JSON 文件，目录 = process.env.V5_PREVIEW_DATA_DIR，文件 rows-store.json。
//   1) 服务重启恢复：写入使 version 变化 → kill 自起实例 → 同数据目录重启 → GET 状态与重启前一致。
//   2) 存储损坏：rows-store.json 写入 '{broken' → 重启 → GET 500 且 body.error='STORE_CORRUPT'
//      → POST 也 5xx → 数据文件内容未被改写（不静默重置/清空/自动重建）。
//
// 本文件自起隔离 dev 实例（npm.cmd run dev:node -- --port 3398，真 Node next dev —— 主控裁决
// DEFECT-1：需持久化的运行统一用 dev:node；V5_PREVIEW_DATA_DIR=
// <site>/.v5-preview-data-recovery-test），只 kill 自己 spawn 的进程树
// （Windows: taskkill /PID <pid> /T /F），端口空闲/释放自检，不抢占未知服务。
//
// 运行：node --test test/v5-preview-recovery.test.mjs（独立运行，与 3399 实例互不影响）

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3398;
// 冻结任务规定轮询 http://localhost:3398；本机 dev server 绑定可达 localhost（双栈任一），
// Node fetch 对 localhost 自动选族可达。
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(SITE_ROOT, '.v5-preview-data-recovery-test');
const STORE_FILE = path.join(DATA_DIR, 'rows-store.json');
const READY_TIMEOUT_MS = 150_000;
const POLL_INTERVAL_MS = 1_000;
// next dev 项目级单实例锁（Next 16.2.6：setup-dev-bundler 在 <distDir>/lock 上持原生 flock）。
// 锁内容为 JSON serverInfo（含 pid）；持有进程死后句柄释放、锁即失效。
const NEXT_DEV_LOCK_FILE = path.join(SITE_ROOT, '.next', 'dev', 'lock');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// 自起服务生命周期（与 v5-preview-http.test.mjs 同款模式；只管理本文件的子进程）
// ---------------------------------------------------------------------------

/** @type {import('node:child_process').ChildProcess | null} */
let child = null;
let childPid = null;
/** 就绪时实际监听端口的进程 PID（next dev 本体）。taskkill /T 的树遍历跨 cmd.exe 边界
 *  可能断裂导致树杀不彻底，killServer 需对该 PID 直接精确补杀（主控整合例外，已记录）。 */
let servePid = null;
const serverLog = [];
const LIFECYCLE = [];

function pushServerLog(stream, chunk) {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (line.length > 0) serverLog.push(`[${stream}] ${line}`);
  }
  if (serverLog.length > 600) serverLog.splice(0, serverLog.length - 600);
}

function serverLogTail(lines = 40) {
  return serverLog.slice(-lines).join('\n');
}

function startServer() {
  // 主控裁决（DEFECT-1）：需持久化的运行统一用 dev:node（真 Node next dev）——workerd 运行时
  // 不允许 node:fs 写入。next dev 有项目级单实例锁（.next/dev/lock），锁竞争由
  // waitForEnvReady（spawn 前等待）+ waitForServer（already running 自动重试一次）处理。
  const args = ['run', 'dev:node', '--', '--port', String(PORT)];
  const options = {
    cwd: SITE_ROOT,
    env: {
      ...process.env,
      V5_PREVIEW_DATA_DIR: DATA_DIR,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: false,
  };
  try {
    child = spawn('npm.cmd', args, options);
  } catch (err) {
    if (process.platform === 'win32' && err && err.code === 'EINVAL') {
      const comspec = process.env.ComSpec || 'cmd.exe';
      const commandLine = ['npm.cmd', ...args]
        .map((part) => (/[\s"]/.test(part) ? `"${part}"` : part))
        .join(' ');
      child = spawn(comspec, ['/d', '/s', '/c', `"${commandLine}"`], {
        ...options,
        windowsVerbatimArguments: true,
      });
    } else {
      throw err;
    }
  }
  childPid = child.pid;
  LIFECYCLE.push({ event: 'spawn', pid: childPid, port: PORT, dataDir: DATA_DIR, at: new Date().toISOString() });
  child.stdout?.on('data', (chunk) => pushServerLog('out', chunk));
  child.stderr?.on('data', (chunk) => pushServerLog('err', chunk));
  child.on('exit', (code, signal) => {
    LIFECYCLE.push({ event: 'exit', pid: childPid, code, signal, at: new Date().toISOString() });
  });
  return childPid;
}

/** 解析 `netstat -ano`：返回目标端口处于 LISTENING 的 PID 列表；检测失败返回 null（未知态）。 */
function listListeningPids(port) {
  try {
    const out = execSync('netstat -ano', { windowsHide: true, encoding: 'utf8', timeout: 8000 });
    const pids = new Set();
    const suffix = `:${port}`;
    for (const line of out.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue;
      const cols = line.trim().split(/\s+/);
      const local = cols[1] ?? '';
      const pid = Number(cols[cols.length - 1]);
      if (local.endsWith(suffix) && Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
    return [...pids];
  } catch {
    return null;
  }
}

/** next dev 锁是否仍被活进程持有：lock 文件 JSON.serverInfo.pid 探活（pid 死 = flock 随句柄释放）。 */
function nextDevLockHeld() {
  if (!existsSync(NEXT_DEV_LOCK_FILE)) return false;
  let raw;
  try {
    raw = readFileSync(NEXT_DEV_LOCK_FILE, 'utf8');
  } catch {
    return false;
  }
  try {
    const info = JSON.parse(raw);
    if (info && Number.isInteger(info.pid) && info.pid > 0) {
      try {
        process.kill(info.pid, 0);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  } catch {
    return false; // 非 JSON 残留：无活锁
  }
}

/** 主控加固 ①（终版）：spawn 前等待环境就绪——**端口无 LISTENING = 硬条件**，满足即可尝试 spawn。
 *  锁文件存在/pid 探活降级为信息记录、不阻塞：flock 随真正的监听进程死亡即释放，残留 lock 文件的
 *  serverInfo.pid 可能是存活但已不持锁的包装进程（探活假阳性）。真被锁住的情形由既有兜底承接：
 *  spawn 立即退出含 "already running" → waitForServer 等 3s 重试一次 → 仍失败才报错。 */
async function waitForEnvReady({ timeoutMs = 45_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const listening = listListeningPids(PORT);
    if (listening === null || listening.length === 0) {
      if (nextDevLockHeld()) {
        LIFECYCLE.push({ event: 'lock-file-present-nonblocking', port: PORT, at: new Date().toISOString() });
      }
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `spawn 前环境未就绪（等待 ${timeoutMs / 1000}s 超时）：端口 ${PORT} 仍 LISTENING=${JSON.stringify(listening)}；` +
          '若为锁竞争，spawn 后的 already-running 自动重试会再兜底一次',
      );
    }
    await sleep(500);
  }
}

/** expectStatus=null 表示"服务可达即可"（任意 HTTP 状态，用于损坏存储场景的 500 就绪）。
 *  主控加固 ②：spawn 后进程立即退出且输出含 "already running"（项目级 dev 锁竞态残留）时，
 *  清理后等 3s 自动重试，仅重试一次。 */
async function waitForServer({ expectStatus = null, timeoutMs = READY_TIMEOUT_MS, label = '', alreadyRetried = false } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '未发起请求';
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      const logText = serverLog.join('\n');
      if (!alreadyRetried && /already running/i.test(logText)) {
        LIFECYCLE.push({ event: 'lock-race-retry', pid: childPid, at: new Date().toISOString() });
        await killServer(); // 清理退出的包装进程与其树（含对端口残留的补刀）
        await sleep(3_000);
        startServer();
        return waitForServer({ expectStatus, timeoutMs, label, alreadyRetried: true });
      }
      throw new Error(`dev 进程就绪前退出（code=${child.exitCode}）。服务输出尾部：\n${serverLogTail()}`);
    }
    try {
      const res = await fetch(`${BASE}/api/v5-preview/project`, { signal: AbortSignal.timeout(60_000) });
      last = `HTTP ${res.status}`;
      if (expectStatus === null || res.status === expectStatus) {
        servePid = listListeningPids(PORT)[0] ?? null;
        LIFECYCLE.push({ event: 'ready', pid: childPid, servePid, status: res.status, at: new Date().toISOString() });
        return res.status;
      }
    } catch (err) {
      last = `${err?.name ?? 'Error'}: ${err?.message ?? err}`;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `服务未在 ${timeoutMs / 1000}s 内就绪（${label || '等待中'}，最后状态：${last}）。服务输出尾部：\n${serverLogTail()}`,
  );
}

/** 每次 spawn 的完整入口：环境就绪等待（加固①）→ spawn → 就绪轮询（含加固②重试）。 */
async function startServerReady({ expectStatus = null, timeoutMs = READY_TIMEOUT_MS, label = '' } = {}) {
  await waitForEnvReady();
  startServer();
  return waitForServer({ expectStatus, timeoutMs, label });
}

async function killServer() {
  if (!child) return;
  const pid = childPid;
  const pidToServe = servePid;
  // 包装进程可能已经退出（如启动即失败）：'exit' 事件不会再触发，不能等它。
  const alreadyExited = child.exitCode !== null || child.signalCode !== null;
  const exited = alreadyExited
    ? Promise.resolve('already-exited')
    : new Promise((resolve) => child.once('exit', resolve));
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.once('exit', resolve);
      killer.once('error', resolve);
    });
    // 主控整合例外修正：/T 树遍历跨 cmd.exe 边界可能断裂（中间进程已退出时后裔被孤立），
    // 对就绪时捕获的 next dev 本体 PID 直接精确补杀并等待其退出——不等 5s 延迟、不留火忘。
    if (pidToServe && Number.isInteger(pidToServe) && pidToServe > 0) {
      try {
        process.kill(pidToServe, 0);
        await new Promise((resolve) => {
          const killer = spawn('taskkill', ['/PID', String(pidToServe), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
          killer.once('exit', resolve);
          killer.once('error', resolve);
        });
        LIFECYCLE.push({ event: 'direct-serve-kill', pid: pidToServe, at: new Date().toISOString() });
      } catch {
        // servePid 已死：无需补杀
      }
    }
  } else {
    child.kill('SIGTERM');
  }
  const exitResult = await Promise.race([exited, sleep(20_000).then(() => 'timeout')]);
  if (exitResult === 'timeout') {
    throw new Error(`taskkill /PID ${pid} /T /F 后 20s 进程仍未退出（须人工核查，不得结束未知进程）`);
  }
  LIFECYCLE.push({ event: 'killed', pid, at: new Date().toISOString() });
  child = null;
  servePid = null;
  // 兜底：轮询确认端口无 LISTENING 再返回；残留者必是自己实例树中逃脱的成员，立即定向补杀（等待退出）。
  const deadline = Date.now() + 30_000;
  let followUpKilled = false;
  for (;;) {
    const listening = listListeningPids(PORT);
    if (listening !== null && listening.length === 0) {
      LIFECYCLE.push({ event: 'port-released', port: PORT, at: new Date().toISOString() });
      return;
    }
    if (!followUpKilled && listening !== null && listening.length > 0) {
      for (const leftover of listening) {
        LIFECYCLE.push({ event: 'follow-up-taskkill', port: PORT, pid: leftover, at: new Date().toISOString() });
        await new Promise((resolve) => {
          const killer = spawn('taskkill', ['/PID', String(leftover), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
          killer.once('exit', resolve);
          killer.once('error', resolve);
        });
      }
      followUpKilled = true;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `端口 ${PORT} 在进程退出后 30s 仍 LISTENING（${JSON.stringify(listening)}；补刀=${followUpKilled}，须人工核查）`,
      );
    }
    await sleep(500);
  }
}

// ---------------------------------------------------------------------------
// HTTP 辅助
// ---------------------------------------------------------------------------

async function getProject() {
  const res = await fetch(`${BASE}/api/v5-preview/project`);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* 保持 null，由断言给出证据 */
  }
  return { res, body, text };
}

async function postJson(pathname, payload) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* 保持 null */
  }
  return { res, body, text };
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------

before(async () => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  // spawn 前环境就绪（端口无 LISTENING + next dev 锁空闲，最多等 20s；不抢占未知服务）
  await waitForEnvReady();
});

after(async () => {
  if (child) await killServer();
  // 损坏的数据文件保留在 .v5-preview-data-recovery-test/ 作为证据（目录未跟踪，可整目录删除）。
  console.log(`[lifecycle] ${JSON.stringify(LIFECYCLE)}`);
});

// ---------------------------------------------------------------------------
// 1. 服务重启恢复
// ---------------------------------------------------------------------------

test('重启恢复：POST message 使 version 变化 → kill 自起实例 → 同数据目录重启 → GET version/消息/情景与重启前一致', async () => {
  // 首次启动（全新隔离数据目录）
  await startServerReady({ expectStatus: 200, label: '首次启动：GET → 200' });

  const before = await getProject();
  assert.equal(before.res.status, 200, `重启前 GET 应 200：${before.text.slice(0, 400)}`);
  assert.equal(before.body.scenario, 'approval', '全新数据目录应为 approval 种子');
  const versionBeforeWrite = before.body.version;

  // 写入一条 message 使 version 变化
  const write = await postJson('/api/v5-preview/messages', {
    requestId: 'recovery-msg-1',
    expectedVersion: versionBeforeWrite,
    text: '重启恢复验证：重启前写入的合成沟通。',
    actorRole: 'business',
  });
  assert.equal(write.res.status, 200, `重启前写入应 200，实际 ${write.res.status}：${write.text.slice(0, 400)}`);
  const written = write.body.overview;
  assert.equal(written.version, versionBeforeWrite + 1, '写入后 version 应 +1');
  assert.equal(written.messages.length, before.body.messages.length + 1, '写入后应恰多一条消息');

  // 持久化文件应存在（单文件 JSON 存储，与源码分离）
  assert.ok(existsSync(STORE_FILE), `持久化文件应存在：${STORE_FILE}（若落在他处，说明 V5_PREVIEW_DATA_DIR 隔离未生效）`);

  // kill 自己起的实例
  await killServer();

  // 同数据目录重启（spawn 前环境就绪 + 锁竞态自动重试）
  await startServerReady({ expectStatus: 200, label: '重启后：GET → 200' });

  const afterRestart = await getProject();
  assert.equal(afterRestart.res.status, 200, `重启后 GET 应 200：${afterRestart.text.slice(0, 400)}`);
  const ov = afterRestart.body;
  assert.equal(ov.version, written.version, `重启后 version 应与重启前一致（${written.version}），实际 ${JSON.stringify(ov.version)}`);
  assert.equal(ov.scenario, written.scenario, '重启后情景应一致');
  assert.deepEqual(ov.messages, written.messages, '重启后消息列表应与重启前逐条一致');
  assert.deepEqual(ov.todo, written.todo, '重启后待办应与重启前一致');
  assert.deepEqual(ov.overall, written.overall, '重启后整体里程碑应与重启前一致');
  assert.deepEqual(ov.domains, written.domains, '重启后四域应与重启前一致');
  // 服务留给用例 2（其先 kill 再损坏存储）
});

// ---------------------------------------------------------------------------
// 2. 存储损坏：500 STORE_CORRUPT，不静默重置
// ---------------------------------------------------------------------------

test('存储损坏：rows-store.json 写入 {broken → 重启 → GET 500 STORE_CORRUPT、POST 5xx、文件内容未被改写（不静默重置）', async () => {
  // kill 用例 1 重启的实例
  await killServer();

  // 损坏数据文件（前置：正常路径下该文件已由首次启动初始化；不存在即说明存储从未成功初始化）
  assert.ok(
    existsSync(STORE_FILE),
    `待损坏的存储文件应已存在：${STORE_FILE}。实际不存在——服务从未成功初始化存储（见用例 1 失败证据），损坏注入无法进行`,
  );
  const BROKEN = '{broken';
  writeFileSync(STORE_FILE, BROKEN, 'utf8');

  // 重启（同数据目录）：服务可达即可（预期业务路由返回 500；spawn 前环境就绪 + 锁竞态自动重试）
  await startServerReady({ label: '损坏存储重启：服务可达（预期 GET 500）' });

  // GET → 500 STORE_CORRUPT
  const get = await getProject();
  assert.equal(get.res.status, 500, `损坏存储 GET 应 500，实际 ${get.res.status}：${get.text.slice(0, 400)}`);
  assert.equal(get.body?.error, 'STORE_CORRUPT', `GET 错误码应 STORE_CORRUPT，实际 ${JSON.stringify(get.body)}`);
  assert.equal(get.body?.ok, false, '失败响应应 ok:false');

  // 写入也失败（5xx），不得在损坏存储上成功记账
  const post = await postJson('/api/v5-preview/messages', {
    requestId: 'corrupt-post-1',
    expectedVersion: 1,
    text: '损坏存储期间的写入（必须失败，不得静默重建）。',
    actorRole: 'business',
  });
  assert.ok(
    post.res.status >= 500 && post.res.status < 600,
    `损坏存储 POST 应 5xx，实际 ${post.res.status}：${(post.text || '').slice(0, 400)}`,
  );
  assert.equal(post.body?.error, 'STORE_CORRUPT', `POST 错误码应 STORE_CORRUPT，实际 ${JSON.stringify(post.body)}`);

  // 未静默重置：数据文件内容逐字节未被改写
  const rawAfter = readFileSync(STORE_FILE, 'utf8');
  assert.equal(rawAfter, BROKEN, `存储文件内容必须保持损坏原样（不静默清空/重建），实际：${JSON.stringify(rawAfter.slice(0, 100))}`);

  // 清理自己起的实例
  await killServer();
});
