// V5 ROWS_FULLSTACK 真实 HTTP 验证（Verification worker 独占写面）。
// 被测冻结接口：V5/handoff/ROWS_FULLSTACK/IMPLEMENTATION.md §2/§3/§6（FROZEN 2026-09-11）。
//   GET  /api/v5-preview/project           → 200 ProjectOverview（Cache-Control: no-store）
//   POST /api/v5-preview/notes             body=NoteRequest → 200 WriteResponse
//   POST /api/v5-preview/messages          body=MessageRequest → 200 WriteResponse
//   POST /api/v5-preview/demo/seed         body=SeedRequest → 200 WriteResponse（演示控制）
//   失败 = HTTP 状态码 + ApiError { ok:false, error, message, serverVersion? }
//   错误码：INVALID_INPUT 400 / ROLE_FORBIDDEN 403 / NOT_FOUND 404 / VERSION_CONFLICT 409(+serverVersion)
//           / REQUEST_MISMATCH 409 / NO_OPEN_TODO 409 / BAD_SCENARIO 400 / STORE_CORRUPT 500
//
// 全部走真实 HTTP：本文件自起隔离 dev 服务实例（npm.cmd run dev:node -- --port 3399，真 Node
// next dev —— 主控裁决 DEFECT-1：workerd 运行时不允许 node:fs 写入，需持久化的运行统一用
// dev:node；V5_PREVIEW_DATA_DIR=<site>/.v5-preview-data-http-test），只 kill 自己 spawn 的进程树
// （Windows: taskkill /PID <pid> /T /F），启动前后自检端口空闲/释放，不抢占未知服务。
// 数据为合成演示；断言依据 IMPLEMENTATION §3 种子数据与错误码表。
//
// 运行：node --test test/v5-preview-http.test.mjs（独立运行，不与其他测试文件共享服务/数据）

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3399;
// 冻结任务规定轮询 http://localhost:3399；本机 dev server 绑定可达 localhost（双栈任一），
// Node fetch 对 localhost 自动选族可达。
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(SITE_ROOT, '.v5-preview-data-http-test');
const READY_TIMEOUT_MS = 150_000; // dev 首次编译慢，任务规定 150s
const POLL_INTERVAL_MS = 1_000;
// next dev 项目级单实例锁（Next 16.2.6：setup-dev-bundler 在 <distDir>/lock 上持原生 flock）。
// 锁内容为 JSON serverInfo（含 pid）；持有进程死后句柄释放、锁即失效。
const NEXT_DEV_LOCK_FILE = path.join(SITE_ROOT, '.next', 'dev', 'lock');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// 自起服务生命周期（只管理本文件 spawn 的子进程；PID/端口全程记录）
// ---------------------------------------------------------------------------

/** @type {import('node:child_process').ChildProcess | null} */
let child = null;
let childPid = null;
/** 就绪时实际监听端口的进程 PID（next dev 本体）。taskkill /T 的树遍历跨 cmd.exe 边界
 *  可能断裂导致树杀不彻底，killServer 需对该 PID 直接精确补杀（主控整合例外，已记录）。 */
let servePid = null;
const serverLog = []; // 服务输出环形缓冲（诊断用）
const LIFECYCLE = []; // PID/端口生命周期事件，after() 统一打印进执行日志

function pushServerLog(stream, chunk) {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (line.length > 0) serverLog.push(`[${stream}] ${line}`);
  }
  if (serverLog.length > 600) serverLog.splice(0, serverLog.length - 600);
}

function serverLogTail(lines = 40) {
  return serverLog.slice(-lines).join('\n');
}

/** Windows 下 Node>=22 对 .cmd 无 shell 直接 spawn 抛 EINVAL（CVE-2024-27980），
 *  回退 cross-spawn 同款 ComSpec 模式（v4life-gate.mjs 先例）。 */
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

/** 只 kill 本文件 spawn 的子进程树；确认退出并释放端口。 */
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
// HTTP 调用辅助
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

function assertApiError(result, status, code) {
  assert.equal(
    result.res.status,
    status,
    `期望 HTTP ${status}，实际 ${result.res.status}；body=${(result.text || '').slice(0, 400)}`,
  );
  assert.equal(result.body?.ok, false, `失败响应应 ok:false，实际 ${JSON.stringify(result.body)}`);
  assert.equal(result.body?.error, code, `期望错误码 ${code}，实际 ${JSON.stringify(result.body)}`);
  assert.equal(typeof result.body?.message, 'string', `ApiError 应携带 message，实际 ${JSON.stringify(result.body)}`);
  return result.body;
}

/** 当前服务端 version（GET 视角）。 */
async function currentVersion() {
  const { body } = await getProject();
  assert.ok(body && typeof body.version === 'number', `GET 应返回带 version 的 overview，实际 ${(body && JSON.stringify(body).slice(0, 200)) || '非 JSON'}`);
  return body.version;
}

// ---------------------------------------------------------------------------
// 服务生命周期：before 自起隔离实例；after 只清理自己 spawn 的进程
// ---------------------------------------------------------------------------

before(async () => {
  // 数据目录先删干净（与默认 .v5-preview-data 完全隔离）
  rmSync(DATA_DIR, { recursive: true, force: true });
  // spawn 前环境就绪（端口无 LISTENING + next dev 锁空闲，最多等 20s；不抢占未知服务）
  await startServerReady({ expectStatus: 200, label: 'GET /api/v5-preview/project → 200（approval 种子）' });
});

after(async () => {
  if (child) await killServer();
  console.log(`[lifecycle] ${JSON.stringify(LIFECYCLE)}`);
});

// ---------------------------------------------------------------------------
// 跨用例状态（用例按声明顺序串行执行，构成一次完整验收旅程）
// ---------------------------------------------------------------------------

let initialMessageCount = 0; // approval 种子消息数（用例 1 采集）
let seedPolicyRow = null; // 种子政策域快照（用例 1 采集，用例 2 验证不被改动）
const APPROVAL_NOTE = {
  requestId: 'v-001',
  expectedVersion: 7,
  todoId: 'todo-device-list',
  text: '设备清单：CNC 机床两台及辅助夹具（合成说明）。',
  actorRole: 'business',
};

// ---------------------------------------------------------------------------
// 1. GET 初态 = approval 种子
// ---------------------------------------------------------------------------

test('GET 初态：approval 种子（version 7、四域顺序 政策/信审/商务/资产、信审黄待补充、todo-device-list 待补充、消息含开场）', async () => {
  const { res, body, text } = await getProject();
  assert.equal(res.status, 200, `GET 应 200，实际 ${res.status}：${text.slice(0, 400)}`);
  assert.equal(res.headers.get('cache-control'), 'no-store', 'GET 必须 Cache-Control: no-store');

  // 抬头与情景（IMPLEMENTATION §3）
  assert.equal(body.customerName, '远山精密制造');
  assert.equal(body.projectCode, 'JW-2026-018');
  assert.equal(body.scenario, 'approval');
  assert.equal(body.version, 7, `种子 version 应为 7，实际 ${JSON.stringify(body.version)}`);
  assert.equal(body.overall.progressLabel, '审批推进中');
  assert.equal(
    body.overall.description,
    '政策已确认，信审待补充设备清单；总项目以资产管理流程结束为终点（合成演示，不使用数字总进度）',
  );

  // 四域恒 4 条、顺序 政策/信审/商务/资产
  assert.equal(body.domains.length, 4, `domains 应恰 4 条，实际 ${body.domains.length}`);
  assert.deepEqual(body.domains.map((d) => d.domainId), ['policy', 'credit', 'commerce', 'asset']);
  assert.deepEqual(body.domains.map((d) => d.name), ['政策', '信审', '商务', '资产']);

  const [policy, credit, commerce, asset] = body.domains;

  // 政策：全 done / 绿 / 已确认
  assert.deepEqual(policy.segmentLabels, ['适用条件', '灰区识别', '例外路径', '准出意见']);
  assert.deepEqual(policy.segments, ['done', 'done', 'done', 'done']);
  assert.equal(policy.judgmentStatus, 'green');
  assert.equal(policy.judgmentText, '已确认');
  assert.equal(policy.summary, '适用条件已确认（合成）');

  // 信审：黄 / 待补充
  assert.deepEqual(credit.segmentLabels, ['材料齐备性', '一致性核验', '偿付覆盖', '信审意见']);
  assert.deepEqual(credit.segments, ['done', 'done', 'pending', 'pending']);
  assert.equal(credit.judgmentStatus, 'yellow', '信审初态应为黄灯');
  assert.equal(credit.judgmentText, '待补充');
  assert.equal(credit.summary, '补充设备清单后继续核验（合成）');

  // 商务：灰 / 准备中
  assert.deepEqual(commerce.segments, ['current', 'pending', 'pending', 'pending']);
  assert.equal(commerce.judgmentStatus, 'gray');
  assert.equal(commerce.judgmentText, '准备中');
  assert.equal(commerce.summary, '合同要素同步准备（合成；无正式前序被绕过）');

  // 资产：灰 / 待启动
  assert.deepEqual(asset.segmentLabels, ['标的确认', '权属核验', '交付与起租', '巡检与结清']);
  assert.deepEqual(asset.segments, ['pending', 'pending', 'pending', 'pending']);
  assert.equal(asset.judgmentStatus, 'gray');
  assert.equal(asset.judgmentText, '待启动');
  assert.equal(asset.summary, '起租后持续管理至结清（合成）');

  // 待办
  assert.deepEqual(body.todo, {
    id: 'todo-device-list',
    title: '补充设备清单',
    detail: '资料更新后，同步相关专业判断；提交后信审转入待复核（合成演示）。',
    status: '待补充',
    relatedDomain: 'credit',
  });

  // 消息：system 开场 + 信审·张信审（合成）请求补充设备清单；时间正序
  assert.ok(Array.isArray(body.messages) && body.messages.length >= 2, `种子消息应至少 2 条，实际 ${JSON.stringify(body.messages)?.length}`);
  assert.ok(body.messages.some((m) => m.fromKind === 'system'), '应含 system 开场消息');
  const domainMsg = body.messages.find((m) => m.fromKind === 'domain');
  assert.ok(domainMsg, '应含 domain（信审）消息');
  assert.ok(domainMsg.text.includes('设备清单'), `信审消息应请求补充设备清单，实际：${domainMsg.text}`);
  for (let i = 1; i < body.messages.length; i += 1) {
    assert.ok(body.messages[i].at >= body.messages[i - 1].at, '消息必须时间正序');
  }

  // 采集跨用例状态
  initialMessageCount = body.messages.length;
  seedPolicyRow = policy;
});

// ---------------------------------------------------------------------------
// 2. 验收闭环：黄 → 提交 → 待复核（仍黄）
// ---------------------------------------------------------------------------

test('验收闭环：POST notes v-001 → 200，version 8、todo 待复核、信审 judgmentText 待复核且仍黄、messages +2、政策域不被改动', async () => {
  const { res, body, text } = await postJson('/api/v5-preview/notes', APPROVAL_NOTE);
  assert.equal(res.status, 200, `notes 应 200，实际 ${res.status}：${text.slice(0, 400)}`);
  assert.equal(body.ok, true, `WriteResponse 应 ok:true，实际 ${JSON.stringify(body).slice(0, 200)}`);
  assert.notEqual(body.replayed, true, '首次接受不得标 replayed:true');

  const ov = body.overview;
  assert.equal(ov.version, 8, `接受写入后 version 应 8，实际 ${JSON.stringify(ov.version)}`);
  assert.equal(ov.scenario, 'approval');

  // 待办 → 待复核
  assert.equal(ov.todo?.id, 'todo-device-list');
  assert.equal(ov.todo?.status, '待复核', `todo 应转待复核，实际 ${JSON.stringify(ov.todo)}`);

  // 信审 judgmentText 待复核且保持黄灯（不自动变绿）
  const credit = ov.domains.find((d) => d.domainId === 'credit');
  assert.equal(credit.judgmentText, '待复核', `信审 judgmentText 应待复核，实际 ${credit.judgmentText}`);
  assert.equal(credit.judgmentStatus, 'yellow', '信审必须保持黄灯，不自动变绿');

  // 消息追加两条：业务补充说明 + 系统记录
  assert.equal(ov.messages.length, initialMessageCount + 2, `应追加恰 2 条消息，实际 ${ov.messages.length}（种子 ${initialMessageCount}）`);
  const appended = ov.messages.slice(-2);
  assert.ok(
    appended.some((m) => m.fromKind === 'business' && m.text.includes('CNC 机床')),
    `追加消息应含业务补充说明（CNC 机床），实际 ${JSON.stringify(appended)}`,
  );
  assert.ok(appended.some((m) => m.fromKind === 'system'), `追加消息应含系统记录，实际 ${JSON.stringify(appended)}`);

  // 无关域（政策）不被改动
  const policy = ov.domains.find((d) => d.domainId === 'policy');
  assert.deepEqual(policy, seedPolicyRow, '政策域不得被 notes 提交改动（无关域不清零）');

  // GET（第二视口）读到同一状态
  const second = await getProject();
  assert.equal(second.res.status, 200);
  assert.equal(second.body.version, 8, 'GET 应读到同一 version 8');
  assert.equal(second.body.todo?.status, '待复核', 'GET 应读到待复核待办');
});

// ---------------------------------------------------------------------------
// 3. 幂等重放
// ---------------------------------------------------------------------------

test('幂等重放：同 requestId v-001 同载荷 → 200 replayed=true，GET 确认消息数与 version 不变', async () => {
  const { res, body, text } = await postJson('/api/v5-preview/notes', APPROVAL_NOTE);
  assert.equal(res.status, 200, `重放应 200，实际 ${res.status}：${text.slice(0, 400)}`);
  assert.equal(body.ok, true);
  assert.equal(body.replayed, true, `重放必须标 replayed:true，实际 ${JSON.stringify(body).slice(0, 200)}`);
  assert.equal(body.overview.version, 8, '重放返回原接受版本 8，不再 +1');

  const after = await getProject();
  assert.equal(after.body.version, 8, '重放不得推进 version');
  assert.equal(after.body.messages.length, initialMessageCount + 2, '重放不得重复追加消息');
  assert.equal(after.body.todo?.status, '待复核', '重放不改变待办状态');
});

// ---------------------------------------------------------------------------
// 4. 同 requestId 换载荷 → REQUEST_MISMATCH
// ---------------------------------------------------------------------------

test('REQUEST_MISMATCH：同 requestId v-001 换 text → 409 REQUEST_MISMATCH', async () => {
  const result = await postJson('/api/v5-preview/notes', {
    ...APPROVAL_NOTE,
    expectedVersion: 8, // 用当前版本，隔离出"换载荷"这一种冲突
    text: '被替换的补充说明（重试不得换载荷，应被拒绝）。',
  });
  assertApiError(result, 409, 'REQUEST_MISMATCH');
  assert.equal((await currentVersion()), 8, '幂等冲突不得推进 version');
});

// ---------------------------------------------------------------------------
// 5. 过期版本 → VERSION_CONFLICT + serverVersion
// ---------------------------------------------------------------------------

test('VERSION_CONFLICT：expectedVersion=7（已过期，服务端 8）→ 409 且 body.serverVersion=8', async () => {
  const result = await postJson('/api/v5-preview/notes', {
    requestId: 'v-stale-1',
    expectedVersion: 7,
    todoId: 'todo-device-list',
    text: '过期版本提交的补充说明（应 409 并返回 serverVersion）。',
    actorRole: 'business',
  });
  const errBody = assertApiError(result, 409, 'VERSION_CONFLICT');
  assert.equal(errBody.serverVersion, 8, `VERSION_CONFLICT 应带 serverVersion=8，实际 ${JSON.stringify(errBody.serverVersion)}`);
  assert.equal((await currentVersion()), 8, '版本冲突不得推进 version');
});

// ---------------------------------------------------------------------------
// 6. 畸形输入 → 400 INVALID_INPUT
// ---------------------------------------------------------------------------

test('INVALID_INPUT：空 text / 超 2000 text / 缺 requestId / 缺 actorRole → 400 INVALID_INPUT（version 不变）', async () => {
  const versionBefore = await currentVersion();
  const base = {
    requestId: 'v-inv-base',
    expectedVersion: versionBefore,
    todoId: 'todo-device-list',
    text: '形状合法的补充说明（合成）。',
    actorRole: 'business',
  };
  const noRequestId = { ...base };
  delete noRequestId.requestId;
  const noActorRole = { ...base };
  delete noActorRole.actorRole;
  const cases = [
    ['空 text（trim 后为空）', { ...base, requestId: 'v-inv-empty', text: '   ' }],
    ['超 2000 text（2001 字符）', { ...base, requestId: 'v-inv-long', text: 'x'.repeat(2001) }],
    ['缺 requestId', noRequestId],
    ['缺 actorRole', noActorRole],
  ];
  for (const [, payload] of cases) {
    const result = await postJson('/api/v5-preview/notes', payload);
    assertApiError(result, 400, 'INVALID_INPUT');
  }
  assert.equal((await currentVersion()), versionBefore, '非法输入不得推进 version');
});

// ---------------------------------------------------------------------------
// 7. 越权角色 → 403 ROLE_FORBIDDEN
// ---------------------------------------------------------------------------

test('越权：actorRole=credit → 403 ROLE_FORBIDDEN（演示受控身份：服务端只授权业务）', async () => {
  const versionBefore = await currentVersion();
  const result = await postJson('/api/v5-preview/notes', {
    requestId: 'v-role-1',
    expectedVersion: versionBefore,
    todoId: 'todo-device-list',
    text: '自称信审角色提交的补充说明（服务端必须拒绝）。',
    actorRole: 'credit',
  });
  assertApiError(result, 403, 'ROLE_FORBIDDEN');
  assert.equal((await currentVersion()), versionBefore, '越权请求不得推进 version');
});

// ---------------------------------------------------------------------------
// 8. 项目沟通追加
// ---------------------------------------------------------------------------

test('messages：POST 正常追加 → version+1，GET 顺序含新消息', async () => {
  const before = await getProject();
  const versionBefore = before.body.version;
  const payload = {
    requestId: 'msg-001',
    expectedVersion: versionBefore,
    text: '请同步设备清单补充的接收进展（合成沟通）。',
    actorRole: 'business',
  };
  const { res, body, text } = await postJson('/api/v5-preview/messages', payload);
  assert.equal(res.status, 200, `messages 应 200，实际 ${res.status}：${text.slice(0, 400)}`);
  assert.equal(body.ok, true);
  assert.equal(body.overview.version, versionBefore + 1, `消息写入应 version+1，实际 ${JSON.stringify(body.overview.version)}`);
  assert.equal(body.overview.messages.length, before.body.messages.length + 1, '应恰追加 1 条消息');

  const after = await getProject();
  assert.equal(after.body.version, versionBefore + 1);
  const last = after.body.messages.at(-1);
  assert.ok(last, 'GET 消息列表应非空');
  assert.ok(
    last.fromKind === 'business' && last.text.includes('接收进展'),
    `最新消息应为业务沟通（含"接收进展"），实际 ${JSON.stringify(last)}`,
  );
  assert.ok(after.body.messages.at(-2).at <= last.at, '新消息应追加在时间正序末尾');
});

// ---------------------------------------------------------------------------
// 9. seed settled：无开放待办
// ---------------------------------------------------------------------------

test('seed settled：todo=null、overall 已结清（演示）；随后 notes → 409 NO_OPEN_TODO；messages 仍可 200', async () => {
  const { res, body, text } = await postJson('/api/v5-preview/demo/seed', { scenario: 'settled' });
  assert.equal(res.status, 200, `seed settled 应 200，实际 ${res.status}：${text.slice(0, 400)}`);
  assert.equal(body.ok, true);
  const ov = body.overview;
  assert.equal(ov.scenario, 'settled');
  assert.equal(ov.version, 41, `settled 种子 version=41，实际 ${JSON.stringify(ov.version)}`);
  assert.equal(ov.todo, null, `已结清情景 todo 应为 null，实际 ${JSON.stringify(ov.todo)}`);
  assert.equal(ov.overall.progressLabel, '已结清（演示）');
  assert.deepEqual(
    ov.domains.map((d) => [d.judgmentStatus, d.judgmentText]),
    [
      ['green', '已确认'],
      ['green', '已通过'],
      ['green', '已结清'],
      ['green', '已结清'],
    ],
    `已结清情景四域应全绿，实际 ${JSON.stringify(ov.domains.map((d) => [d.judgmentStatus, d.judgmentText]))}`,
  );

  // 无开放待办仍提交 notes → 409 NO_OPEN_TODO
  const noteResult = await postJson('/api/v5-preview/notes', {
    requestId: 'settled-note-1',
    expectedVersion: ov.version,
    todoId: 'todo-device-list',
    text: '已结清情景仍提交补充说明（应 409 NO_OPEN_TODO）。',
    actorRole: 'business',
  });
  assertApiError(noteResult, 409, 'NO_OPEN_TODO');

  // messages 仍可追加留档
  const msgResult = await postJson('/api/v5-preview/messages', {
    requestId: 'settled-msg-1',
    expectedVersion: ov.version,
    text: '结清后留档沟通（合成）。',
    actorRole: 'business',
  });
  assert.equal(msgResult.res.status, 200, `已结清情景 messages 应仍 200，实际 ${msgResult.res.status}`);
  assert.equal(msgResult.body.overview.version, ov.version + 1, '留档消息应 version+1');
});

// ---------------------------------------------------------------------------
// 10. seed post-rental
// ---------------------------------------------------------------------------

test('seed post-rental：资产黄观察中、todo-inspection 待补充、overall 起租后资产管理', async () => {
  const { res, body, text } = await postJson('/api/v5-preview/demo/seed', { scenario: 'post-rental' });
  assert.equal(res.status, 200, `seed post-rental 应 200，实际 ${res.status}：${text.slice(0, 400)}`);
  assert.equal(body.ok, true);
  const ov = body.overview;
  assert.equal(ov.scenario, 'post-rental');
  assert.equal(ov.version, 23, `post-rental 种子 version=23，实际 ${JSON.stringify(ov.version)}`);
  assert.equal(ov.overall.progressLabel, '起租后资产管理');

  assert.deepEqual(
    ov.domains.map((d) => d.judgmentStatus),
    ['green', 'green', 'green', 'yellow'],
    'post-rental：政策/信审/商务绿、资产黄',
  );
  const asset = ov.domains.find((d) => d.domainId === 'asset');
  assert.deepEqual(asset.segments, ['done', 'done', 'current', 'pending']);
  assert.equal(asset.judgmentText, '观察中');

  assert.equal(ov.todo?.id, 'todo-inspection', `应开放 todo-inspection，实际 ${JSON.stringify(ov.todo)}`);
  assert.equal(ov.todo?.status, '待补充');
  assert.equal(ov.todo?.relatedDomain, 'asset');
});

// ---------------------------------------------------------------------------
// 11. 非法情景 → 400 BAD_SCENARIO
// ---------------------------------------------------------------------------

test('BAD_SCENARIO：seed {scenario:"bad"} → 400 BAD_SCENARIO（当前情景与版本不被破坏）', async () => {
  const result = await postJson('/api/v5-preview/demo/seed', { scenario: 'bad' });
  assertApiError(result, 400, 'BAD_SCENARIO');
  const after = await getProject();
  assert.equal(after.body.scenario, 'post-rental', '非法 seed 不得改变当前情景');
  assert.equal(after.body.version, 23, '非法 seed 不得改变当前 version');
});

// ---------------------------------------------------------------------------
// 12. 畸形 JSON body → 400
// ---------------------------------------------------------------------------

test('畸形 JSON body → 400（ApiError INVALID_INPUT，不 5xx）', async () => {
  const res = await fetch(`${BASE}/api/v5-preview/notes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{broken',
  });
  const text = await res.text();
  assert.equal(res.status, 400, `畸形 JSON 应 400，实际 ${res.status}：${text.slice(0, 400)}`);
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* 由下方断言给出证据 */
  }
  assert.equal(body?.ok, false, `失败响应应 ok:false，实际 ${text.slice(0, 400)}`);
  assert.equal(body?.error, 'INVALID_INPUT', `畸形 JSON 应报 INVALID_INPUT，实际 ${text.slice(0, 400)}`);
});

// ---------------------------------------------------------------------------
// 13. 清理（必须作为本文件最后一个测试）：isolation=none 下文件级 after() 被推迟到
//     整个 run 结束才执行，会在多文件串行时把 3399 实例泄漏给后续文件（锁冲突）。
//     在这里按顺序显式停服；after() 保留作失败安全网（child 已空时为 no-op）。
// ---------------------------------------------------------------------------

test('清理：停止本文件自起的服务实例并确认端口释放', async () => {
  await killServer();
  const listening = listListeningPids(PORT);
  assert.ok(listening === null || listening.length === 0, `端口 ${PORT} 应已释放，实际 LISTENING=${JSON.stringify(listening)}`);
});
